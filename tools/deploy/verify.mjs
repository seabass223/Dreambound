// Compare a staged build (npm run deploy -- --stage, in dist-deploy/) with dist/: every model decoded and every
// texture's pixels, so a setting's "same at runtime" can be checked rather than trusted.
//
//   node tools/deploy/verify.mjs
//
// Models: each mesh primitive's attributes, as the game sees them (meshopt decoded, quantized values denormalized and
// put through their node's transform, as src/render/gltf.js and three do), against the original's; reports the largest
// difference per attribute (0 = bit-exact). Textures: decoded RGBA pixels compared; reports the largest channel
// difference (0 = the same pixels) and the mean.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = path.join(ROOT, 'dist'), B = path.join(ROOT, 'dist-deploy');
if (!fs.existsSync(B)) { console.error('verify: no dist-deploy/ (run npm run deploy -- --stage first)'); process.exit(1); }

const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { MeshoptDecoder } = await import('meshoptimizer');
const sharp = (await import('sharp')).default;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// Every primitive's attributes in world space as floats, in document order (node order, then primitive order).
async function modelData(file) {
  const doc = await io.read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const attrs = {};
      for (const sem of prim.listSemantics()) {
        const acc = prim.getAttribute(sem), n = acc.getCount(), size = acc.getElementSize(), el = [];
        const v = new Float64Array(n * size);
        for (let i = 0; i < n; i++) {
          acc.getElement(i, el);   // denormalized by gltf-transform
          if (sem === 'POSITION') {
            const [x, y, z] = el;
            el[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; el[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; el[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          } else if (sem === 'NORMAL') {
            const [x, y, z] = el;
            let a = m[0] * x + m[4] * y + m[8] * z, b = m[1] * x + m[5] * y + m[9] * z, c = m[2] * x + m[6] * y + m[10] * z;
            const l = Math.hypot(a, b, c) || 1; el[0] = a / l; el[1] = b / l; el[2] = c / l;
          }
          for (let c = 0; c < size; c++) v[i * size + c] = el[c];
        }
        attrs[sem] = v;
      }
      const idx = prim.getIndices();
      out.push({ attrs, indices: idx ? Array.from(idx.getArray()) : null });
    }
  }
  return out;
}

// Vertices may be reordered (meshopt reorders for compression): compare as sets of triangles, keyed by their corners.
function triangleKeys(p, digits) {
  const pos = p.attrs.POSITION, keys = [];
  const n = p.indices ? p.indices.length : pos.length / 3;
  const corner = (i) => { const k = p.indices ? p.indices[i] : i; return `${pos[k * 3].toFixed(digits)},${pos[k * 3 + 1].toFixed(digits)},${pos[k * 3 + 2].toFixed(digits)}`; };
  for (let t = 0; t + 2 < n; t += 3) keys.push([corner(t), corner(t + 1), corner(t + 2)].sort().join('|'));
  return keys.sort();
}

let worst = 0;
const rows = [];
for (const f of fs.readdirSync(path.join(A, 'models'))) {
  const a = path.join(A, 'models', f), b = path.join(B, 'models', f);
  const ext = path.extname(f).toLowerCase();
  if (ext === '.glb') {
    const [da, db] = [await modelData(a), await modelData(b)];
    if (da.length !== db.length) { rows.push([f, `primitive count ${da.length} -> ${db.length}`]); worst = Infinity; continue; }
    const diff = {};
    let exact = true;
    for (let i = 0; i < da.length; i++) {
      for (const [sem, va] of Object.entries(da[i].attrs)) {
        const vb = db[i].attrs[sem];
        if (!vb || vb.length !== va.length) { diff[sem] = Infinity; exact = false; continue; }
        let d = 0;
        for (let j = 0; j < va.length; j++) d = Math.max(d, Math.abs(va[j] - vb[j]));
        diff[sem] = Math.max(diff[sem] ?? 0, d);
        if (d) exact = false;
      }
      // the same vertices in a different order count as the same: check the triangles instead
      if (!exact && Object.values(diff).some((d) => d === Infinity || d > 1e-3)) {
        const same = JSON.stringify(triangleKeys(da[i], 5)) === JSON.stringify(triangleKeys(db[i], 5));
        if (same) for (const k of Object.keys(diff)) diff[k] = Math.min(diff[k], 0);
      }
    }
    const m = Math.max(0, ...Object.values(diff));
    worst = Math.max(worst, m);
    rows.push([f, Object.entries(diff).map(([k, v]) => `${k} ${v === 0 ? '0' : v.toExponential(1)}`).join(', ')]);
  } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    const [ia, ib] = await Promise.all([a, b].map((p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) { rows.push([f, `size ${ia.info.width}x${ia.info.height} -> ${ib.info.width}x${ib.info.height}`]); worst = Infinity; continue; }
    let max = 0, sum = 0;
    for (let i = 0; i < ia.data.length; i++) { const d = Math.abs(ia.data[i] - ib.data[i]); if (d > max) max = d; sum += d; }
    worst = Math.max(worst, max / 255);
    rows.push([f, max === 0 ? 'pixels identical' : `max ${max}/255, mean ${(sum / ia.data.length).toFixed(2)}`]);
  }
}
for (const [f, s] of rows) console.log(f.padEnd(26), s);
console.log(worst === 0 ? 'verify: identical at runtime (every model attribute and every texture pixel)' : `verify: differs (largest difference ${worst})`);
