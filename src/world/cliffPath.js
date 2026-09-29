import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, Rng } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { mergeParts, mat4 } from './builders.js';

// The Dome's ledge path (in place of world/features.js buildLedge): a shelf on the cliff, wider than the old ledge,
// paved with flagstones (materials().path: a sheen when the sun is low), a rough rock underside, and a low wall of
// rough stone blocks along its outer edge (and across its far end), like an old mountain path.
//
// samples: [{ theta, depth, width }] along the path, as buildLedge takes them. The shelf is set into the cliff the same
// way (1.6 m into the wall, from the analytic cliffRadius, which the built wall matches in the protected arc).

// Metres of path per flagstone texture tile. The paving is mapped in world x/z (the texture has no direction), so the
// cave's floor (world/cliffCave.js) carries on the same stones.
export const PATH_TILE = 2.4;
const LIP_IN = 0.32;     // the wall's centre, in from the shelf's outer edge

// stairs (optional): { from, to, n } in theta, where the samples' depth falls linearly: the fall is built as n rough
// stone treads across the paving (each one's top level with the path where it starts, so the paving's ramp stays under
// them) and they are what you walk on there, a step at a time.
export function buildCliffPath(stack, samples, batcher, collider, { seed = 7, endCap = true, stairs = null } = {}) {
  const M = materials();
  const top = { pos: [], uv: [], idx: [] }, side = { pos: [], col: [], uv: [], idx: [] };
  // Across the shelf (o: metres out from the wall line; dy: height): the paved top, cambered a little, then the edge
  // and the underside back into the wall.
  const topProf = (w) => [[-1.6, 0], [-0.3, 0], [w * 0.3, 0.012], [w * 0.65, 0.01], [w - 0.12, -0.015]];
  const sideProf = (w) => [[w - 0.12, -0.015], [w + 0.02, -0.14], [w + 0.14, -0.55], [w * 0.8, -1.6], [w * 0.35, -2.6], [-1.6, -3.8]];
  const nT = topProf(1).length, nS = sideProf(1).length;
  const rails = [];            // per sample: the lip's line (world), for placing the blocks
  let arc = 0, prev = null;
  samples.forEach((s, i) => {
    const er = stack.edgeR(s.theta);
    const R = stack.cliffRadius(s.theta, s.depth, er) - 0.1;
    const cx = Math.cos(s.theta), cz = Math.sin(s.theta);
    const y0 = stack.top - s.depth;
    const here = new THREE.Vector3(stack.cx + cx * R, y0, stack.cz + cz * R);
    if (prev) arc += here.distanceTo(prev);
    prev = here;
    topProf(s.width).forEach(([o, dy]) => {
      const r = R + o;
      top.pos.push(stack.cx + cx * r, y0 + dy, stack.cz + cz * r);
      top.uv.push((stack.cx + cx * r) / PATH_TILE, (stack.cz + cz * r) / PATH_TILE);
    });
    sideProf(s.width).forEach(([o, dy], k) => {
      const jag = k > 1 ? noise2(arc * 0.4, k * 3.1, seed) * 0.35 : 0;
      const r = R + o + jag;
      side.pos.push(stack.cx + cx * r, y0 + dy, stack.cz + cz * r);
      const g = 0.43 + noise2(arc * 0.3, k, seed + 2) * 0.04;
      side.col.push(g, g * 0.96, g * 0.92);
      side.uv.push(arc / 4, (o + dy) / 4);
    });
    rails.push({ p: new THREE.Vector3(stack.cx + cx * (R + s.width - LIP_IN), y0, stack.cz + cz * (R + s.width - LIP_IN)), radial: new THREE.Vector3(cx, 0, cz), w: s.width, R, y0 });
    if (i > 0) {
      for (const [g, n] of [[top, nT], [side, nS]]) {
        const a = (i - 1) * n, b = i * n;
        for (let k = 0; k < n - 1; k++) g.idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
    }
  });
  const finish = (g, faceUp) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    if (g.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    geo.computeVertexNormals();
    // Wind the faces up (the top) or out (the rest) whichever way the samples run.
    const n = geo.attributes.normal;
    if ((faceUp ? n.getY(1) : n.getY(1) + 0.001) < 0) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
      geo.index.needsUpdate = true;
      geo.computeVertexNormals();
    }
    return geo;
  };
  const topGeo = finish(top, true);
  const sideGeo = finish(side, false);
  batcher.add(topGeo, M.path);
  batcher.add(sideGeo, M.stone);
  collider?.addGeometry(topGeo);
  collider?.addGeometry(sideGeo);

  // ---- the low wall: rough blocks along the outer edge, set end to end with narrow gaps ----
  const rng = new Rng(seed * 13 + 5);
  const line = new THREE.CatmullRomCurve3(rails.map((r) => r.p), false, 'centripetal');
  const L = line.getLength();
  const parts = [];
  const block = (len, h, d, x, y, z, ry, tint) => {
    let g = new THREE.BoxGeometry(len, h, d, 3, 2, 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    const p = g.attributes.position, v = new THREE.Vector3(), n0 = rng.float(0, 100);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      // Knock the corners off and roughen the faces: chunks of broken stone, not bricks.
      const ex = Math.abs(v.x) / (len / 2), ey = Math.abs(v.y) / (h / 2), ez = Math.abs(v.z) / (d / 2);
      const corner = Math.max(0, ex + ey + ez - 2.2) * 0.35;
      const k = 1 - corner * 0.45 + noise2(v.x * 5 + n0, v.y * 5 + v.z * 4, seed + 9) * 0.16 + noise2(v.x * 13 + n0, v.z * 13, seed + 10) * 0.05;
      v.set(v.x * k, v.y * (v.y > 0 ? k : 1), v.z * k);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g = g.toNonIndexed();
    g.computeVertexNormals();
    // Box-mapped texture coordinates for the rock map.
    const q = g.attributes.position, nn = g.attributes.normal, uv = new Float32Array(q.count * 2);
    for (let i = 0; i < q.count; i++) {
      const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i));
      const [a, b] = ax > 0.6 ? [q.getZ(i), q.getY(i)] : ay > 0.6 ? [q.getX(i), q.getZ(i)] : [q.getX(i), q.getY(i)];
      uv[i * 2] = a * 0.9 + n0; uv[i * 2 + 1] = b * 0.9;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    parts.push({ geo: g, matrix: mat4(x, y, z, ry, 1, 1, 1, rng.float(-0.04, 0.04), rng.float(-0.05, 0.05)), color: tint });
  };
  const tint = () => new THREE.Color().setRGB(0.95, 0.9, 0.84).multiplyScalar(rng.float(0.75, 1.1));
  const at = (t) => {
    const u = THREE.MathUtils.clamp(t / L, 0, 1);
    const p = line.getPointAt(u), tg = line.getTangentAt(u);
    return { p, ry: Math.atan2(-tg.z, tg.x) };
  };
  for (let t = 0.3; t < L - 0.25;) {
    const len = rng.float(0.4, 0.85), gap = rng.float(0.02, 0.1);
    const h = rng.float(0.32, 0.56), d = rng.float(0.3, 0.44);
    const { p, ry } = at(t + len / 2);
    block(len, h, d, p.x, p.y + h / 2 - 0.08, p.z, ry + rng.float(-0.12, 0.12), tint());
    t += len + gap;
  }
  // Across the far end, from the wall to the lip.
  if (endCap) {
    const e = rails[rails.length - 1];
    const along = new THREE.Vector3().subVectors(rails[rails.length - 1].p, rails[rails.length - 2].p).setY(0).normalize();
    for (let o = -0.1; o < e.w - LIP_IN - 0.2;) {
      const len = rng.float(0.45, 0.7), h = rng.float(0.4, 0.55);
      const c = new THREE.Vector3(stack.cx, e.y0, stack.cz).addScaledVector(e.radial, e.R + o + len / 2).addScaledVector(along, -0.15);
      block(len, h, rng.float(0.32, 0.4), c.x, c.y + h / 2 - 0.08, c.z, Math.atan2(-e.radial.z, e.radial.x), tint());
      o += len + 0.05;
    }
  }
  const lip = mergeParts(parts);
  batcher.add(lip, M.stone);
  collider?.addGeometry(lip);

  // ---- stairs: rough slabs across the path, from the wall to the lip's inner face ----
  let steps = null;
  if (stairs) {
    const sr = new Rng(seed * 29 + 3), tread = [];
    // Path frame at theta (linear between samples): the wall line R, its height and width there.
    const at = (th) => {
      let i = 1;
      const asc = samples[samples.length - 1].theta > samples[0].theta;
      while (i < samples.length - 1 && (asc ? samples[i].theta < th : samples[i].theta > th)) i++;
      const a = samples[i - 1], b = samples[i], u = THREE.MathUtils.clamp((th - a.theta) / (b.theta - a.theta), 0, 1);
      const depth = a.depth + (b.depth - a.depth) * u, width = a.width + (b.width - a.width) * u;
      return { R: stack.cliffRadius(th, depth, stack.edgeR(th)) - 0.1, y: stack.top - depth, w: width };
    };
    const { from, to, n } = stairs;
    for (let k = 0; k < n; k++) {
      const ta = from + (to - from) * (k / n), tb = from + (to - from) * ((k + 1) / n), tm = (ta + tb) / 2;
      const A = at(ta), Bm = at(tm);
      const r0 = Bm.R - 0.35, r1 = Bm.R + Bm.w - LIP_IN - 0.2;
      const run = Math.abs(tb - ta) * (Bm.R + Bm.w / 2) + 0.03;   // a hair of overlap: no gap between treads
      const h = 0.34, top = A.y + 0.006 + sr.float(-0.004, 0.004);
      let g = new THREE.BoxGeometry(run, h, r1 - r0, 2, 1, 3);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      g = mergeVertices(g, 1e-4);
      // Worn: the nosing rounded off and the top dished a little in the middle, the ends rougher.
      const p = g.attributes.position, v = new THREE.Vector3(), n0 = sr.float(0, 100);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const ez = Math.abs(v.z) / ((r1 - r0) / 2);
        if (v.y > 0) v.y -= (1 - ez) * 0.008 + noise2(v.x * 9 + n0, v.z * 7, seed + 21) * 0.006;
        v.z *= 1 + noise2(v.x * 4 + n0, v.y * 4, seed + 22) * 0.05 * ez;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g = g.toNonIndexed();
      g.computeVertexNormals();
      const q = g.attributes.position, nn = g.attributes.normal, uv = new Float32Array(q.count * 2);
      for (let i = 0; i < q.count; i++) {
        const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i));
        const [a, b] = ax > 0.6 ? [q.getZ(i), q.getY(i)] : ay > 0.6 ? [q.getX(i), q.getZ(i)] : [q.getX(i), q.getY(i)];
        uv[i * 2] = a * 0.9 + n0; uv[i * 2 + 1] = b * 0.9;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      // Centred across the path at tm, its length along the path's tangent there (the local x).
      const rc = (r0 + r1) / 2, cxm = stack.cx + Math.cos(tm) * rc, czm = stack.cz + Math.sin(tm) * rc;
      tread.push({ geo: g, matrix: mat4(cxm, top - h / 2, czm, Math.atan2(-Math.cos(tm), -Math.sin(tm)) + sr.float(-0.03, 0.03)), color: new THREE.Color().setRGB(0.95, 0.9, 0.84).multiplyScalar(sr.float(0.8, 1.05)) });
    }
    steps = mergeParts(tread);
    batcher.add(steps, M.stone);
    collider?.addGeometry(steps);
  }
  return { top: topGeo, side: sideGeo, lip, steps, length: arc };
}
