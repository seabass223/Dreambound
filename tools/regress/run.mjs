// Stack walls regression runner. Every variant runs in a fresh Node process, because src/config.js reads the
// WALLS flags once at module evaluation and ES modules are cached per process.
//
//   node tools/regress/run.mjs                          check: determinism, then compare ?walls=0 with the baseline
//   node tools/regress/run.mjs --variant 0 [--out f]    record anchors for one variant (0, 1, +bake,-shader, default)
//   node tools/regress/run.mjs --variant 0 --routes     record routes instead
//   node tools/regress/run.mjs --compare [--variant 0,+uv]   record a variant (default 0), compare with the baseline
//   node tools/regress/run.mjs --stages                 every flag alone and cumulative, each against the baseline
//   node tools/regress/run.mjs --determinism            build twice (anchors and routes), require identical files
//   node tools/regress/run.mjs --update-baseline        write baseline.json + baseline_routes.json from ?walls=0
// The baseline is baseline.json / baseline_routes.json next to this file; --base <anchors.json> and
// --routes-base <routes.json> compare against other recordings (routes are skipped without a routes baseline).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compareFiles } from './compare.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const FLAG_ORDER = ['uv', 'bake', 'shader', 'geo', 'calmSmooth', 'relief', 'shoulder'];

const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const rel = (f) => path.relative(ROOT, f);
const fileFor = (kind, spec, tag = '') => path.join(OUT, `${kind}_${(spec ?? 'default').replace(/[^\w+-]+/g, '_')}${tag}.json`);
const BASELINE = { anchors: path.join(HERE, 'baseline.json'), routes: path.join(HERE, 'baseline_routes.json') };
const BASE = arg('--base') ? { anchors: path.resolve(arg('--base')), routes: arg('--routes-base') && path.resolve(arg('--routes-base')) } : BASELINE;

// One variant in its own process. spec 'default' (or undefined) = config defaults.
function record(kind, spec, file, extra = []) {
  const script = path.join(HERE, kind === 'routes' ? 'routes.mjs' : 'anchors.mjs');
  const args = [script, '--out', file, ...(spec === undefined || spec === 'default' ? [] : ['--walls', spec]), ...extra];
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${kind} ${spec ?? 'default'} exited with ${code}`))));
  });
}

// Hash of everything under src/ (and the models), to tell nondeterminism from a tree edited mid-run.
function treeHash() {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else h.update(e.name).update(fs.readFileSync(f));
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'public/models'));
  return h.digest('hex').slice(0, 16);
}

// Two builds must be byte-identical; `stable` is false when src/ changed under the run (then neither proves much).
async function determinism() {
  const before = treeHash();
  const files = [1, 2].flatMap((i) => ['anchors', 'routes'].map((k) => [k, fileFor(k, '0', `.det${i}`)]));
  const t0 = performance.now();
  await Promise.all(files.map(([k, f], i) => record(k, '0', f, i < 2 ? [] : ['--quiet'])));
  const secs = (performance.now() - t0) / 1000;
  const after = treeHash();
  let ok = true;
  for (const k of ['anchors', 'routes']) {
    const [a, b] = files.filter(([kk]) => kk === k).map(([, f]) => fs.readFileSync(f));
    const same = a.equals(b);
    console.log(`determinism ${k}: ${same ? 'identical' : 'DIFFERENT'} (${a.length} bytes)`);
    ok &&= same;
  }
  const stable = before === after;
  if (!stable) console.log(`determinism: src/ changed during the run (someone is editing)${ok ? '' : ', so the difference may be the edit: run again'}`);
  console.log(`determinism: ${ok ? 'PASS' : 'FAIL'} in ${secs.toFixed(1)} s (two builds of anchors and routes, in parallel)`);
  return { ok, stable, tree: after };
}

// Records the variants (up to `jobs` processes at once), then compares each with the baseline.
async function compareVariants(specs, jobs = 8) {
  if (!fs.existsSync(BASE.anchors)) {
    console.log(`no ${rel(BASE.anchors)} yet: record one with --update-baseline once the tree is ready`);
    return false;
  }
  const doRoutes = BASE.routes && fs.existsSync(BASE.routes);
  const tasks = specs.flatMap((s) => [() => record('anchors', s, fileFor('anchors', s)), doRoutes && (() => record('routes', s, fileFor('routes', s), ['--quiet']))]).filter(Boolean);
  await Promise.all(Array.from({ length: jobs }, async () => { while (tasks.length) await tasks.shift()(); }));
  let ok = true;
  const results = [];
  console.log(`tree now ${treeHash()}; baseline from ${JSON.parse(fs.readFileSync(BASE.anchors, 'utf8')).tree ?? 'an unrecorded tree'}`);
  for (const s of specs) {
    if (specs.length > 1) console.log(`\n### variant ${s}`);
    let r = compareFiles(BASE.anchors, fileFor('anchors', s));
    if (doRoutes) r = compareFiles(BASE.routes, fileFor('routes', s)) && r;
    results.push(`${r ? 'PASS' : 'FAIL'}  ${s}`);
    ok &&= r;
  }
  if (specs.length > 1) console.log('\n' + results.join('\n'));
  return ok;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = performance.now();
  const spec = arg('--variant');
  let ok = true;
  if (has('--update-baseline')) {
    const d = await determinism();
    if (!d.ok) throw new Error('not writing a baseline from a nondeterministic run');
    if (!d.stable) throw new Error('not writing a baseline from a tree edited during the run: run again');
    // The tree the baseline came from goes into both files (compare.mjs reports it and ignores it).
    for (const k of ['anchors', 'routes']) {
      const data = JSON.parse(fs.readFileSync(fileFor(k, '0', '.det1'), 'utf8'));
      fs.writeFileSync(BASELINE[k], JSON.stringify({ ...data, tree: d.tree }, null, 1) + '\n');
    }
    console.log(`wrote ${rel(BASELINE.anchors)} and ${rel(BASELINE.routes)} (tree ${d.tree})`);
  } else if (has('--determinism')) {
    ok = (await determinism()).ok;
  } else if (has('--compare')) {
    ok = await compareVariants([spec ?? '0']);
  } else if (has('--stages')) {
    // Each flag alone, then cumulative in stage order (shader always with uv, which it requires).
    const alone = FLAG_ORDER.map((f) => (f === 'shader' ? '0,+uv,+shader' : `0,+${f}`));
    const cumulative = FLAG_ORDER.map((_, i) => '0,' + FLAG_ORDER.slice(0, i + 1).map((f) => '+' + f).join(','));
    ok = await compareVariants(['0', ...new Set([...alone, ...cumulative])]);
  } else if (spec !== undefined) {
    const kind = has('--routes') ? 'routes' : 'anchors';
    await record(kind, spec, path.resolve(arg('--out') ?? fileFor(kind, spec)));
  } else {
    ok = (await determinism()).ok;
    if (fs.existsSync(BASE.anchors)) ok = (await compareVariants(['0'])) && ok;
    else console.log(`no ${rel(BASE.anchors)} yet (record it with --update-baseline); determinism is the whole check until then`);
  }
  console.log(`run: ${ok ? 'PASS' : 'FAIL'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return ok;
}

main().then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(e.message); process.exit(2); });
