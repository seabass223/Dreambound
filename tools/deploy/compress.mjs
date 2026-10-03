// The deploy's compression stage (tools/deploy/deploy.mjs): from the built dist/ to the bytes that get uploaded, file by
// file. Three independent knobs, each opt-in and each reported:
//
//   meshopt   off | lossless | quantize   .glb models. lossless: EXT_meshopt_compression on the vertices as they are
//             (its codec is lossless; the game decodes the same floats). quantize: positions rounded to 14 bits and
//             normals to 10 within each mesh's bounds (KHR_mesh_quantization) first, then the same compression: smaller,
//             not bit-exact. Texture coordinates and colours are never rounded (the shaders read ids packed into them).
//             src/render/gltf.js decodes both and hands the game Float32 positions and normals either way.
//   textures  off | webp-lossless | webp  .png and .jpg files matching the include/exclude globs, re-encoded as WebP at
//             the same size under the same name (browsers decode an image by its contents, so the game's loaders don't
//             change; the blob's Content-Type says image/webp). webp-lossless keeps every pixel; webp is lossy at
//             webpQuality. A file is only replaced when the WebP is smaller.
//   encode    none | br | gzip   transfer compression for text and models (html, js, css, json, svg, glb...): stored
//             compressed with a Content-Encoding header, so the browser unpacks it to the same bytes. Images are
//             skipped (already compressed).

import path from 'node:path';
import zlib from 'node:zlib';

export const OPTIONS = {
  encode: ['none', 'br', 'gzip'],
  meshopt: ['off', 'lossless', 'quantize'],
  textures: ['off', 'webp-lossless', 'webp'],
};

// Presets: a whole setting at once, for comparing.
export const PRESETS = {
  raw: { encode: 'none', meshopt: 'off', textures: 'off' },                  // exactly the build, nothing compressed
  lossless: { encode: 'br', meshopt: 'lossless', textures: 'webp-lossless' }, // smaller, and the same at runtime
  small: { encode: 'br', meshopt: 'quantize', textures: 'webp' },            // smallest: rounded meshes, lossy textures
};

const ENCODABLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt', '.glb', '.gltf', '.bin', '.wasm', '.hdr', '.exr', '.wav']);
const TEXTURE = new Set(['.png', '.jpg', '.jpeg']);

const matches = (rel, globs) => globs.some((g) => path.posix.matchesGlob(rel, g));

let gltf = null;   // the glTF tools, loaded only when meshopt is on
async function gltfTools() {
  if (gltf) return gltf;
  const [{ NodeIO }, { ALL_EXTENSIONS, EXTMeshoptCompression }, { quantize }, { MeshoptEncoder }] = await Promise.all([
    import('@gltf-transform/core'), import('@gltf-transform/extensions'), import('@gltf-transform/functions'), import('meshoptimizer'),
  ]);
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  gltf = { io, EXTMeshoptCompression, quantize };
  return gltf;
}

// Returns { body, note }. Rounding is skipped (lossless compression only) for a model it would restructure: an animated
// one (the quantize step wraps animated nodes in new ones to carry its scale, which changes the hierarchy the game
// drives, e.g. the tor's blast), or any whose node count changes.
async function compressModel(body, mode) {
  const { io, EXTMeshoptCompression, quantize } = await gltfTools();
  const doc = await io.readBinary(new Uint8Array(body));
  let note = '';
  if (mode === 'quantize') {
    const root = doc.getRoot(), nodes = root.listNodes().length;
    if (root.listAnimations().length) note = 'animated, not rounded';
    else {
      await doc.transform(quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }));
      if (root.listNodes().length !== nodes) return { ...(await compressModel(body, 'lossless')), note: 'rounding changed its nodes, not rounded' };
    }
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return { body: Buffer.from(await io.writeBinary(doc)), note };
}

let sharp = null;
async function compressTexture(body, mode, quality) {
  sharp ??= (await import('sharp')).default;
  // exact: keep the colour under fully transparent pixels (WebP drops it by default, and filtering samples it)
  return sharp(body).webp(mode === 'webp-lossless' ? { lossless: true, effort: 6, exact: true } : { quality, effort: 6, alphaQuality: 100, exact: true }).toBuffer();
}

function encodeBody(body, how) {
  if (how === 'br') return zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
  return zlib.gzipSync(body, { level: 9 });
}

// files: [{ rel, body }] (rel is the path in dist/, forward slashes). Returns the same list with body replaced where a
// stage applied, plus type (a Content-Type override), encoding (a Content-Encoding) and notes, and a summary.
export async function stage(files, opts, { log = () => {} } = {}) {
  const out = [];
  const sum = { meshopt: [0, 0, 0], textures: [0, 0, 0], encode: [0, 0, 0] };   // [files, bytes before, bytes after]
  const add = (k, a, b) => { sum[k][0]++; sum[k][1] += a; sum[k][2] += b; };
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    let body = f.body, type = null, encoding = null;
    const notes = [];
    if (ext === '.glb' && opts.meshopt !== 'off') {
      const { body: next, note } = await compressModel(body, opts.meshopt);
      add('meshopt', body.length, next.length);
      notes.push(`meshopt ${opts.meshopt} ${kb(body.length)} -> ${kb(next.length)}` + (note ? ` (${note})` : ''));
      body = next;
    }
    if (TEXTURE.has(ext) && opts.textures !== 'off' && matches(f.rel, opts.textureInclude) && !matches(f.rel, opts.textureExclude)) {
      const next = await compressTexture(body, opts.textures, opts.webpQuality);
      if (next.length < body.length) {
        add('textures', body.length, next.length);
        notes.push(`${opts.textures} ${kb(body.length)} -> ${kb(next.length)}`);
        body = next; type = 'image/webp';
      } else notes.push(`${opts.textures} kept the original (WebP was not smaller)`);
    }
    if (ENCODABLE.has(ext) && opts.encode !== 'none' && body.length > 256) {
      const next = encodeBody(body, opts.encode);
      if (next.length < body.length * 0.95) {
        add('encode', body.length, next.length);
        notes.push(`${opts.encode} ${kb(body.length)} -> ${kb(next.length)}`);
        body = next; encoding = opts.encode;
      }
    }
    if (notes.length) log(`  ${f.rel}: ${notes.join(', ')}`);
    out.push({ ...f, body, type, encoding });
  }
  return { files: out, sum };
}

const kb = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';

// Resolve the settings: the config file, then a preset, then single flags.
export function resolveOptions(config, argv) {
  const o = {
    encode: config.encode ?? 'br', meshopt: config.meshopt ?? 'off', textures: config.textures ?? 'off',
    webpQuality: config.webpQuality ?? 90, textureInclude: config.textureInclude ?? ['**/*'], textureExclude: config.textureExclude ?? [],
  };
  const val = (name) => {
    const hit = argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
    return hit.length ? hit : null;
  };
  const preset = val('preset')?.at(-1);
  if (preset) {
    if (!PRESETS[preset]) throw new Error(`--preset=${preset}: use ${Object.keys(PRESETS).join(', ')}`);
    Object.assign(o, PRESETS[preset]);
  }
  for (const k of Object.keys(OPTIONS)) {
    const v = val(k)?.at(-1);
    if (v != null) o[k] = v;
    if (!OPTIONS[k].includes(o[k])) throw new Error(`${k} "${o[k]}" isn't one of ${OPTIONS[k].join(', ')}`);
  }
  const q = val('webp-quality')?.at(-1);
  if (q != null) o.webpQuality = Number(q);
  if (!(o.webpQuality >= 1 && o.webpQuality <= 100)) throw new Error(`webpQuality must be 1 to 100 (got ${o.webpQuality})`);
  const inc = val('texture-include'), exc = val('texture-exclude');
  if (inc) o.textureInclude = inc.flatMap((s) => s.split(',')).filter(Boolean);
  if (exc) o.textureExclude = exc.flatMap((s) => s.split(',')).filter(Boolean);
  return o;
}
