// Build the game, compress it as configured, and upload it to Azure Blob Storage, in one go:
//
//   npm run deploy                         build, compress (tools/deploy/deploy.config.json), upload what changed
//   npm run deploy -- --preset=lossless    a whole compression setting at once: raw | lossless | small (compress.mjs)
//   npm run deploy -- --encode=br --meshopt=quantize --textures=webp --webp-quality=85
//   npm run deploy -- --texture-exclude="**/*normal*.png" --texture-include="models/*"   (globs on paths in dist/)
//   npm run deploy -- --stage              build and compress into dist-deploy/ to play-test locally; no key needed
//   npm run deploy -- --dry-run            everything but the upload: what would be sent and pruned
//   npm run deploy -- --no-build           use the dist/ that's already there
//   npm run deploy -- --prune              also delete blobs under the prefix the build no longer has (old bundles)
//
// The key: tools/deploy/.env (git-ignored; see .env.example), or the same names in the environment:
//   DEPLOY_SAS      container SAS URL, permissions Create + Write + List (sp=cwl), plus Delete (d) for --prune.
//                   The $web container (the account's static website) serves the game at the site's root.
//   DEPLOY_PREFIX   optional folder inside the container, e.g. "dreambound" (no leading or trailing slash)
// The SAS is a write key: it stays in that file. Nothing here prints it (URLs are logged without their query).
//
// How it goes: `vite build --base=<where the files will be served from>` (the game loads its models through
// import.meta.env.BASE_URL, so they're found under a prefix or a plain container too); the compression stage
// (compress.mjs: meshopt for models, WebP for textures, brotli/gzip for transfer, each off unless set); then every file
// is compared with the container's listing by MD5 of what would be sent, and only new or changed ones are uploaded, 6 at
// a time, with a Content-Type, a Content-Encoding when compressed for transfer, and a Cache-Control (hashed bundles in
// assets/ cached for a year, everything else revalidated). index.html goes last, so a visitor never gets a page that
// points at bundles not uploaded yet.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stage, resolveOptions } from './compress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DIST = path.join(ROOT, 'dist');
const STAGE_DIR = path.join(ROOT, 'dist-deploy');
const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY = args.has('--dry-run'), BUILD = !args.has('--no-build'), PRUNE = args.has('--prune'), STAGE_ONLY = args.has('--stage');
const API = '2023-11-03';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

function fail(msg) { console.error('deploy: ' + msg); process.exit(1); }
const clean = (u) => `${u.origin}${u.pathname}`;   // a URL without its SAS query, for logs and errors
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

// ---- the compression settings ----
let opts;
try {
  const cfgFile = path.join(HERE, 'deploy.config.json');
  const config = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  opts = resolveOptions(config, argv);
} catch (err) { fail(err.message); }

// ---- the key (not needed to stage) ----
let SAS = null, container = '$web', prefix = '';
if (!STAGE_ONLY) {
  const envFile = path.join(HERE, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const sasRaw = process.env.DEPLOY_SAS?.trim();
  if (!sasRaw) fail(`DEPLOY_SAS is not set. Copy tools/deploy/.env.example to tools/deploy/.env and paste a container SAS URL into it (or use --stage to compress locally).`);
  try { SAS = new URL(sasRaw); } catch { fail('DEPLOY_SAS is not a URL (it should look like https://<account>.blob.core.windows.net/<container>?sv=...&sig=...)'); }
  if (!SAS.searchParams.get('sig')) fail('DEPLOY_SAS has no signature (sig=): use the full SAS URL, not just the container URL');
  container = SAS.pathname.replace(/^\/+|\/+$/g, '');
  if (!container || container.includes('/')) fail('DEPLOY_SAS must name a container (…/<container>?sv=…), not the account or a blob');
  prefix = (process.env.DEPLOY_PREFIX ?? '').trim().replace(/^\/+|\/+$/g, '');
  const se = SAS.searchParams.get('se');
  if (se && new Date(se) < new Date()) fail(`DEPLOY_SAS expired at ${se}: make a new one`);
  const perms = SAS.searchParams.get('sp') ?? '';
  if (perms && !/[cw]/.test(perms)) fail(`DEPLOY_SAS can't write (sp=${perms}): it needs Create and Write (sp=cwl)`);
  if (PRUNE && perms && !perms.includes('d')) fail(`--prune needs Delete in the SAS (sp=${perms}): add d, or deploy without --prune`);
}

// Where the site will be served from: the static website ($web) serves the container at the root, the blob endpoint
// serves it under /<container>/. A local stage is served from the root (vite preview).
const base = STAGE_ONLY ? '/' : (container === '$web' ? '/' : `/${container}/`) + (prefix ? prefix + '/' : '');
const blobUrl = (name, extra = {}) => {
  const u = new URL(SAS);
  u.pathname = `/${container}/` + name.split('/').map(encodeURIComponent).join('/');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u;
};

// ---- build ----
if (BUILD) {
  console.log(`deploy: building (base ${base})`);
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) fail('vite is not installed: run npm install first');
  const r = spawnSync(process.execPath, [vite, 'build', '--base', base], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('the build failed, nothing uploaded');
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('dist/index.html is missing: build first (or drop --no-build)');

// ---- what's local, through the compression stage ----
const paths = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else paths.push(p);
  }
})(DIST);
const built = paths.map((p) => ({ rel: path.relative(DIST, p).split(path.sep).join('/'), body: fs.readFileSync(p) }));
const rawSize = built.reduce((s, f) => s + f.body.length, 0);
console.log(`deploy: compression: encode ${opts.encode}, meshopt ${opts.meshopt}, textures ${opts.textures}` +
  (opts.textures === 'webp' ? ` (quality ${opts.webpQuality})` : '') +
  (opts.textures !== 'off' ? `; textures in [${opts.textureInclude.join(', ')}]` + (opts.textureExclude.length ? ` except [${opts.textureExclude.join(', ')}]` : '') : ''));
const t0 = Date.now();
const verbose = args.has('--verbose') || DRY || STAGE_ONLY;
const staged = await stage(built, STAGE_ONLY ? { ...opts, encode: 'none' } : opts, { log: verbose ? console.log : () => {} })
  .catch((err) => fail(`compression failed: ${err.stack ?? err.message}`));
for (const [k, [n, a, b]] of Object.entries(staged.sum)) if (n) console.log(`deploy: ${k}: ${n} files, ${mb(a)} -> ${mb(b)} (${Math.round(100 - (100 * b) / a)}% smaller)`);
const sentSize = staged.files.reduce((s, f) => s + f.body.length, 0);
console.log(`deploy: ${built.length} files, ${mb(rawSize)} built -> ${mb(sentSize)} to serve (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

if (STAGE_ONLY) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  for (const f of staged.files) {
    const p = path.join(STAGE_DIR, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.body);
  }
  console.log(`deploy: staged in dist-deploy/ (transfer encoding left off, so it serves locally). Play it with:\n  npx vite preview --outDir dist-deploy`);
  process.exit(0);
}

const local = staged.files.map((f) => ({
  ...f, name: (prefix ? prefix + '/' : '') + f.rel, size: f.body.length,
  md5: crypto.createHash('md5').update(f.body).digest('base64'),
}));

// ---- what's there (by MD5 of what we'd send, so unchanged files aren't sent again) ----
async function request(url, init = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'x-ms-version': API, ...init.headers }, signal: AbortSignal.timeout(300000) });
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      if (i >= tries) return res;
    } catch (err) {
      if (i >= tries) throw new Error(`${init.method ?? 'GET'} ${clean(url)}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
}
const errorOf = async (res) => { const t = await res.text().catch(() => ''); return `HTTP ${res.status} ${/<Code>([^<]+)/.exec(t)?.[1] ?? ''}`.trim(); };

async function listRemote() {
  const out = new Map();
  let marker = '';
  do {
    const u = blobUrl('', { restype: 'container', comp: 'list', maxresults: '5000', ...(prefix ? { prefix: prefix + '/' } : {}), ...(marker ? { marker } : {}) });
    u.pathname = `/${container}`;
    const res = await request(u);
    if (!res.ok) return { map: null, why: await errorOf(res) };
    const xml = await res.text();
    for (const m of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
      const name = /<Name>([^<]*)<\/Name>/.exec(m[1])?.[1];
      const md5 = /<Content-MD5>([^<]*)<\/Content-MD5>/.exec(m[1])?.[1] ?? '';
      if (name) out.set(name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"), md5);
    }
    marker = /<NextMarker>([^<]*)<\/NextMarker>/.exec(xml)?.[1] ?? '';
  } while (marker);
  return { map: out };
}

const cacheFor = (rel) => rel === 'index.html' ? 'no-cache'
  : rel.startsWith('assets/') ? 'public, max-age=31536000, immutable'   // hashed by vite
  : 'public, max-age=0, must-revalidate';                               // models etc.: same names, new contents

async function upload(f) {
  const headers = {
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-blob-content-type': f.type ?? TYPES[path.extname(f.rel).toLowerCase()] ?? 'application/octet-stream',
    'x-ms-blob-cache-control': cacheFor(f.rel),
    'Content-MD5': f.md5,
    'x-ms-blob-content-md5': f.md5,
  };
  if (f.encoding) headers['x-ms-blob-content-encoding'] = f.encoding;
  const res = await request(blobUrl(f.name), { method: 'PUT', headers, body: f.body });
  if (!res.ok) throw new Error(`upload ${f.rel}: ${await errorOf(res)}`);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const t1 = Date.now();
console.log(`deploy: -> ${clean(blobUrl(prefix ? prefix + '/' : ''))}`);
const { map: remote, why } = await listRemote();
if (!remote && /AuthenticationFailed|404|ContainerNotFound|ResourceNotFound/.test(why)) {
  fail(why.includes('AuthenticationFailed') ? `the storage account rejected DEPLOY_SAS (${why}): check it was pasted whole, or make a new one`
    : `the container doesn't exist (${why}): create "${container}" first (for $web, turn on the account's static website)`);
}
if (!remote) console.log(`deploy: couldn't list the container (${why}; the SAS needs List, l), so everything is uploaded`);
const todo = local.filter((f) => !remote || remote.get(f.name) !== f.md5);
const stale = PRUNE && remote ? [...remote.keys()].filter((n) => !local.some((f) => f.name === n)) : [];
console.log(`deploy: ${todo.length} to upload (${mb(todo.reduce((s, f) => s + f.size, 0))}), ${local.length - todo.length} unchanged` + (PRUNE ? `, ${stale.length} to prune` : ''));

if (DRY) {
  for (const f of todo) console.log('  upload ' + f.rel + (f.encoding ? ` (${f.encoding})` : '') + (f.type ? ` (${f.type})` : ''));
  for (const n of stale) console.log('  prune  ' + n);
  console.log('deploy: dry run, nothing sent');
  process.exit(0);
}

// everything but index.html first, then the page
const page = todo.filter((f) => f.rel === 'index.html'), rest = todo.filter((f) => f.rel !== 'index.html');
let done = 0;
const tty = process.stdout.isTTY;
const tick = () => {
  done++;
  if (tty) process.stdout.write(`\rdeploy: uploaded ${done}/${todo.length}`);
  else if (done % 20 === 0 || done === todo.length) console.log(`deploy: uploaded ${done}/${todo.length}`);
};
try {
  await pool(rest, 6, async (f) => { await upload(f); tick(); });
  for (const f of page) { await upload(f); tick(); }
} catch (err) {
  if (tty) console.log('');
  fail(`${err.message} (${done} of ${todo.length} uploaded; run it again to finish)`);
}
if (tty && todo.length) console.log('');
for (const n of stale) {
  const res = await request(blobUrl(n), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) fail(`prune ${n}: ${await errorOf(res)}`);
}
if (stale.length) console.log(`deploy: pruned ${stale.length}`);
const site = container === '$web' ? `the storage account's static website${prefix ? ` under /${prefix}/` : ''}` : clean(blobUrl((prefix ? prefix + '/' : '') + 'index.html'));
console.log(`deploy: uploaded in ${((Date.now() - t1) / 1000).toFixed(1)} s. Live at ${site}`);
