import * as THREE from 'three';
import { fbm3, noise2, Rng } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { mat4, mergeParts } from './builders.js';

const DIRT = new THREE.Color(0.24, 0.18, 0.12);

// A rocky shelf running along a cliff face. samples: [{ theta, depth, width }]
export function buildLedge(stack, samples, batcher, collider, seed = 1) {
  const pos = [], col = [], uv = [], idx = [];
  const prof = (w) => [
    [-1.6, 0.0], [0, 0.0], [w * 0.5, 0.02], [w - 0.25, -0.02], [w, -0.18], [w + 0.15, -0.6],
    [w * 0.75, -1.6], [w * 0.3, -2.6], [-1.6, -3.8],
  ];
  const P = prof(1).length;
  let arc = 0;
  let prev = null;
  samples.forEach((s, i) => {
    const er = stack.edgeR(s.theta);
    const R = stack.cliffRadius(s.theta, s.depth, er) - 0.1;
    const cx = Math.cos(s.theta), cz = Math.sin(s.theta);
    const y0 = stack.top - s.depth;
    const here = new THREE.Vector3(stack.cx + cx * R, y0, stack.cz + cz * R);
    if (prev) arc += here.distanceTo(prev);
    prev = here;
    prof(s.width).forEach(([o, dy], k) => {
      const jag = k > 3 ? noise2(arc * 0.4, k * 3.1, seed) * 0.35 : noise2(arc * 0.7, k, seed) * 0.04;
      const r = R + o + (k > 3 ? jag : 0);
      pos.push(stack.cx + cx * r, y0 + dy + (k <= 3 ? jag : 0), stack.cz + cz * r);
      const top = k >= 1 && k <= 3;
      const c = top ? DIRT : new THREE.Color(0.45, 0.43, 0.41);
      col.push(c.r, c.g, c.b);
      uv.push(arc / 4, (o + dy) / 4);
    });
    if (i > 0) {
      const a = (i - 1) * P, b = i * P;
      for (let k = 0; k < P - 1; k++) {
        // Winding so faces point outward/upward; the ledge runs with increasing theta or not.
        idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Make the winding face up regardless of direction of travel.
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (n.getY(1) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  batcher.add(g, materials().stone);
  collider?.addGeometry(g);
  return g;
}

// Build an inward-facing tunnel along a curve with a flat floor. Returns geometry (world space).
export function tunnelGeometry(points, { radius = 1.8, floor = 1.15, noise = 0.35, seed = 1, radial = 14, spacing = 1.2, lights = [], baseLight = 0.02, tint = [1, 0.8, 0.55] } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const len = curve.getLength();
  const segs = Math.max(4, Math.ceil(len / spacing));
  const tube = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const p = tube.attributes.position, nrm = tube.attributes.normal;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, c);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.set(p.getX(k), p.getY(k), p.getZ(k));
      d.subVectors(v, c);
      const nz = fbm3(v.x * 0.35, v.y * 0.35, v.z * 0.35, 3, seed);
      v.addScaledVector(d.normalize(), nz * noise);
      const fy = c.y - floor;
      if (v.y < fy) v.y = fy + noise2(v.x * 0.8, v.z * 0.8, seed) * 0.03;
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  // Flip to face inward.
  const idx = tube.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  tube.computeVertexNormals();
  for (let k = 0; k < p.count; k++) {
    v.set(p.getX(k), p.getY(k), p.getZ(k));
    let L = baseLight;
    for (const l of lights) {
      const dd = v.distanceToSquared(l.pos);
      L += (l.power ?? 1) * 6 / (1 + dd * (l.falloff ?? 0.35));
    }
    const ao = 0.75 + fbm3(v.x * 0.6, v.y * 0.6, v.z * 0.6, 2, seed + 3) * 0.5;
    col[k * 3] = L * ao * tint[0]; col[k * 3 + 1] = L * ao * tint[1]; col[k * 3 + 2] = L * ao * tint[2];
  }
  tube.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tube.deleteAttribute('uv');
  const uvs = new Float32Array(p.count * 2);
  for (let i = 0; i <= segs; i++) for (let j = 0; j <= radial; j++) {
    const k = i * (radial + 1) + j;
    uvs[k * 2] = (i / segs) * len / 3; uvs[k * 2 + 1] = j / radial * 3;
  }
  tube.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  tube.userData.curve = curve;
  return tube;
}

// Remove triangles of `geo` near an opening (point + axis) so a tunnel can pass through.
export function carveOpening(geo, mouth, axis, radius, { minY = -Infinity, tMin = -1.5, tMax = 4 } = {}) {
  const p = geo.attributes.position;
  const src = geo.index ? geo.index.array : [...Array(p.count).keys()];
  const keep = [];
  const c = new THREE.Vector3(), rel = new THREE.Vector3();
  for (let i = 0; i < src.length; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(p.getX(src[i + k]), p.getY(src[i + k]), p.getZ(src[i + k])));
    c.multiplyScalar(1 / 3);
    rel.subVectors(c, mouth);
    const t = rel.dot(axis);
    const perp = rel.addScaledVector(axis, -t).length();
    if (t > tMin && t < tMax && perp < radius && c.y > minY) continue;
    keep.push(src[i], src[i + 1], src[i + 2]);
  }
  geo.setIndex(keep);
  return geo;
}

// The rock round a cave's tunnel (see buildCave): a shell swept along the tube's axis, 0.35 m clear of the tube's
// rough wall at its lip and 1-3 m thick behind it, much thicker toward `toward` (into the cliff) and on top, with
// ragged, set-back edges at the mouth. Its lip is stitched to the tube's first ring, vertex for vertex, and the back
// is capped, so it is closed everywhere. `tube` is tunnelGeometry(pts, { radial: 14 }).
function caveShell(pts, tube, { seed = 1, toward = null, ceiling = null, radial = 14 }) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const fr = curve.computeFrenetFrames(1, false);
  const N = fr.normals[0], B = fr.binormals[0], T = curve.getTangentAt(0).normalize();
  const L = curve.getLength();
  const K = 4, R2 = radial * K;   // shell vertices per tube vertex round the lip
  // TubeGeometry's direction for angle v (so the shell's angles line up with the tube's vertices).
  const dirOf = (v, out) => out.set(0, 0, 0).addScaledVector(N, -Math.cos(v)).addScaledVector(B, Math.sin(v));
  const into = new THREE.Vector3();
  const pos = [], idx = [];
  const put = (v) => { pos.push(v.x, v.y, v.z); return pos.length / 3 - 1; };
  const P = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const _n = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
  // A triangle, wound so it faces `facing`.
  const tri = (a, b, c, facing) => {
    const A = P(a);
    _n.crossVectors(_e1.subVectors(P(b), A), _e2.subVectors(P(c), A));
    if (_n.dot(facing) < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  const c = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Vector3();
  const inner0 = 1.75 + 0.35;
  // The rock's outer surface along direction dv (unit, across the tunnel): the nearest of a few rough slab planes,
  // so the cross-section is a craggy buttress standing out of the cliff rather than a ring round a pipe: a face toward
  // the open air, a roof leaning back into the cliff, a chamfer and a bottom just under the ledge, and (buried) the
  // cliff side. Each plane is pushed about by noise; then crags on top. t: metres along the tunnel from its open end.
  const UP = new THREE.Vector3(0, 1, 0), sea = new THREE.Vector3(), roof = new THREE.Vector3(), cham = new THREE.Vector3();
  const planes = [];
  const outerR = (j, t, dv) => {
    q.copy(c).addScaledVector(dv, 2.5);
    const n1 = fbm3(q.x * 0.5, q.y * 0.5, q.z * 0.5, 3, seed + 21), n2 = fbm3(q.x * 0.5 + 7.1, q.y * 0.5, q.z * 0.5, 3, seed + 25);
    const crag = fbm3(q.x * 1.6, q.y * 1.6, q.z * 1.6, 2, seed + 22), grit = fbm3(q.x * 3.4, q.y * 3.4, q.z * 3.4, 2, seed + 24);
    let r = Infinity;
    for (const [n, h] of planes) {
      const k = dv.dot(n);
      if (k > 0.05) r = Math.min(r, h / k);
    }
    r = Math.min(r, 6.2);   // (directions nearly along every plane would otherwise shoot out as slivers)
    r += 0.55 * n1 + 0.35 * crag + 0.15 * grit;
    if (ceiling != null && dv.y > 0.05) r = Math.min(r, (ceiling - c.y) / dv.y);   // under the stack's top
    r = Math.max(r, inner0 + 0.15 + 0.1 * n2);
    // Near the mouth the rock is barely drawn in (the face round the opening is a broken face, not a rolled rim).
    return inner0 + (r - inner0) * (0.82 + 0.18 * THREE.MathUtils.smoothstep(t, 0.0, 0.8));
  };
  const setPlanes = () => {
    // into: toward the cliff (horizontal). Without it, a plain rough collar all round.
    if (!toward) { planes.length = 0; for (const n of [UP, UP.clone().negate(), N, N.clone().negate(), B, B.clone().negate()]) planes.push([n, 2.9]); return; }
    sea.copy(into).negate();
    roof.copy(UP).addScaledVector(into, -0.2).normalize();
    cham.copy(UP).negate().addScaledVector(into, -1).normalize();
    planes.length = 0;
    planes.push([sea, 2.9], [roof, 3.1], [UP.clone().negate(), 1.45], [cham, 2.6], [into, 6.0], [UP.clone().addScaledVector(into, 1).normalize(), 5.5]);
  };
  const nS = Math.max(8, Math.ceil(L / 0.22));
  const rings = [];
  for (let i = 0; i <= nS; i++) {
    const s = i / nS;
    curve.getPointAt(s, c);
    if (toward) into.set(toward.x - c.x, 0, toward.z - c.z).normalize();
    setPlanes();
    const ring = [];
    for (let j = 0; j < R2; j++) {
      dirOf((j / R2) * Math.PI * 2, d);
      const rr = outerR(j, s * L, d);   // (outerR uses q: take the radius before building the point)
      ring.push(put(q.copy(c).addScaledVector(d, rr)));
    }
    rings.push(ring);
  }
  // The mouth's face: the first ring set back unevenly along the tunnel, a broken edge (less than the ring spacing, or
  // the surface would fold over into fins).
  const jagAt = (j, k) => fbm3(Math.cos((j / R2) * 6.283) * 1.9, Math.sin((j / R2) * 6.283) * 1.9, seed * 0.37 + k, 2, seed + 23);
  for (let j = 0; j < R2; j++) {
    const i = rings[0][j], back = (0.5 + 0.5 * jagAt(j, 0)) * 0.8 * (L / nS);
    pos[i * 3] += T.x * back; pos[i * 3 + 1] += T.y * back; pos[i * 3 + 2] += T.z * back;
  }
  // Round the back: a few shrinking rings and a pole beyond the tube's end.
  const end = curve.getPointAt(1, new THREE.Vector3());
  for (const [k, back] of [[0.8, 0.5], [0.5, 0.9], [0.2, 1.15]]) {
    const ring = rings[rings.length - 1].map((vi) => {
      const v = P(vi).sub(end);
      const along = v.dot(T);
      v.addScaledVector(T, -along).multiplyScalar(k);
      return put(v.add(end).addScaledVector(T, along + back));
    });
    rings.push(ring);
  }
  const pole = put(end.clone().addScaledVector(T, 1.25));
  const axisAt = (vi) => { const v = P(vi); return end.clone().addScaledVector(T, v.clone().sub(end).dot(T)); };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < R2; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % R2], c2 = rings[i + 1][j], d2 = rings[i + 1][(j + 1) % R2];
      const out = P(a).sub(axisAt(a));
      tri(a, b, d2, out); tri(a, d2, c2, out);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < R2; j++) tri(last[j], last[(j + 1) % R2], pole, T);
  // The lip: the tube's first ring (its own vertices, so no gap) to the shell's first ring, facing out of the mouth.
  const tp = tube.attributes.position;
  const inner = [];
  for (let j = 0; j <= radial; j++) inner.push(put(new THREE.Vector3(tp.getX(j), tp.getY(j), tp.getZ(j))));
  const lipFacing = T.clone().negate();
  // A rugged band midway across the face (pushed in and out along the tunnel), between the tube and the rim.
  const o = rings[0], mid = [];
  for (let j = 0; j < R2; j++) {
    const vo = P(o[j]), vi = P(inner[Math.min(radial, Math.round(j / K))]);
    const m = vo.lerp(vi, 0.45 + 0.1 * jagAt(j, 3.1));
    m.addScaledVector(T, 0.25 * jagAt(j, 7.3) + 0.12);
    mid.push(put(m));
  }
  for (let j = 0; j < R2; j++) {
    const n = (j + 1) % R2;
    tri(mid[j], o[j], o[n], lipFacing); tri(mid[j], o[n], mid[n], lipFacing);
  }
  for (let j = 0; j < radial; j++) {
    const a = inner[j], b = inner[j + 1], m = K * j + K / 2;
    for (let k = K * j; k < m; k++) tri(a, mid[k], mid[(k + 1) % R2], lipFacing);
    tri(a, mid[m], b, lipFacing);
    for (let k = m; k < K * j + K; k++) tri(b, mid[k], mid[(k + 1) % R2], lipFacing);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Faceted, like broken rock (and like the cliff's own relief), rather than a smooth mound.
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  // Texture coordinates for the rock map: each face projected along its dominant axis (a box mapping).
  const fp = flat.attributes.position, fn = flat.attributes.normal, uv = new Float32Array(fp.count * 2), S = 0.45;
  for (let i = 0; i < fp.count; i += 3) {
    const ax = Math.abs(fn.getX(i)), ay = Math.abs(fn.getY(i)), az = Math.abs(fn.getZ(i));
    for (let k = i; k < i + 3; k++) {
      const x = fp.getX(k), y = fp.getY(k), z = fp.getZ(k);
      const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
      uv[k * 2] = u * S; uv[k * 2 + 1] = v * S;
    }
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return mergeParts([{ geo: flat, color: 0x8a8378 }]);
}

// A lumpy rock mass (for cave hoods and outcrops), outward-only displacement.
export function rockMass(center, radii, seed = 1, detail = 4, color = 0x6e6860) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = fbm3(v.x * 1.7, v.y * 1.7, v.z * 1.7, 4, seed) * 0.5 + 0.5;
    const k = 1 + n * 0.28;
    p.setXYZ(i, center.x + v.x * radii.x * k, center.y + v.y * radii.y * k, center.z + v.z * radii.z * k);
  }
  g.computeVertexNormals();
  return mergeParts([{ geo: g, color }]);
}

// Wooden ladder leaning flat against a wall. base = bottom center at the wall; n = outward normal.
// material: another batch material (the power tower's is steel). topFacing: how squarely you must face out
// (away from the wall) to get on from the top; lower it where you walk past the top along a walkway.
export function buildLadder(ctx, { base, n, height, zone = 'surface', batcher, material = null, topFacing = 0.2 }) {
  const M = materials();
  const ry = Math.atan2(n.x, n.z);
  const parts = [];
  const railOff = 0.26;
  for (const s of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(0.07, height + 0.9, 0.09), matrix: mat4(s * railOff, (height + 0.9) / 2, 0.22) });
  for (let y = 0.3; y < height + 0.5; y += 0.32) parts.push({ geo: new THREE.CylinderGeometry(0.025, 0.025, railOff * 2 + 0.06, 6), matrix: mat4(0, y, 0.22, 0, 1, 1, 1, 0, Math.PI / 2) });
  const g = mergeParts(parts);
  g.applyMatrix4(mat4(base.x, base.y, base.z, ry));
  batcher.add(g, material ?? M.wood);
  ctx.physics.ladders.push({ base: base.clone(), n: n.clone().setY(0).normalize(), height, width: 0.7, zone, topFacing });
}

// Scatter helper for pebbles/rocks as instanced meshes.
export function makeRockGeometry(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const r = new Rng(seed);
  const sq = new THREE.Vector3(r.float(0.8, 1.2), r.float(0.55, 0.8), r.float(0.8, 1.2));
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + fbm3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3, 3, seed) * 0.35;
    p.setXYZ(i, v.x * k * sq.x, v.y * k * sq.y, v.z * k * sq.z);
  }
  g.computeVertexNormals();
  return mergeParts([{ geo: g, color: 0x8c867e }]);
}

// Rock wall framing an elevator plate so it seals the end of a passage.
export function endWallGeometry(platePos, rotY) {
  const g = mergeParts([
    { geo: new THREE.BoxGeometry(1.0, 4.6, 0.6), matrix: mat4(-2.3, 1.6, -0.42) },
    { geo: new THREE.BoxGeometry(1.0, 4.6, 0.6), matrix: mat4(2.3, 1.6, -0.42) },
    { geo: new THREE.BoxGeometry(5.6, 0.8, 0.6), matrix: mat4(0, 3.55, -0.42) },
    { geo: new THREE.BoxGeometry(5.6, 0.8, 0.6), matrix: mat4(0, -0.42, -0.42) },
  ]);
  g.applyMatrix4(mat4(platePos.x, platePos.y, platePos.z, rotY));
  return g;
}

// A dirt trail ribbon draped over a stack cap.
export function buildTrail(stack, path, batcher, { width = 1.3, spacing = 0.7, color = [0.19, 0.145, 0.1], lift = 0.035 } = {}) {
  const pos = [], col = [], uv = [], idx = [];
  const n = Math.max(2, Math.ceil(path.total / spacing));
  const across = 5;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * path.total;
    const p = path.pointAt(t);
    const len = Math.hypot(p.dx, p.dz) || 1;
    const sx = -p.dz / len, sz = p.dx / len;
    const wob = noise2(t * 0.3, 0, 5) * 0.25;
    for (let j = 0; j < across; j++) {
      const f = j / (across - 1) - 0.5;
      const edge = Math.abs(f) > 0.4;
      const w = width * (1 + (edge ? noise2(t * 1.3, j, 9) * 0.35 : 0));
      const x = p.x + sx * (f * w + wob), z = p.z + sz * (f * w + wob);
      const y = (stack.heightAt(x, z) ?? p.y ?? stack.top) + lift;
      pos.push(x, y, z);
      const k = 0.85 + noise2(x * 2, z * 2, 3) * 0.2;
      col.push(color[0] * k, color[1] * k, color[2] * k);
      uv.push(x * 0.3, z * 0.3);
    }
    if (i > 0) {
      const a = (i - 1) * across, b = i * across;
      for (let j = 0; j < across - 1; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  if (nrm.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  batcher.add(g, trailMaterial());
  return g;
}

let _trailMat = null;
function trailMaterial() {
  if (_trailMat) return _trailMat;
  const m = materials().cap.clone();
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  m.onBeforeCompile = materials().cap.onBeforeCompile;
  m.customProgramCacheKey = materials().cap.customProgramCacheKey;
  _trailMat = m;
  return m;
}

// Random points on a stack cap passing `accept`.
export function scatter(stack, count, rng, accept = () => true, { margin = 3, tries = 20 } = {}) {
  const out = [];
  for (let i = 0; i < count * tries && out.length < count; i++) {
    const a = rng.float(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * stack.r * 1.1;
    const x = stack.cx + Math.cos(a) * d, z = stack.cz + Math.sin(a) * d;
    if (stack.edgeDist(x, z) < margin) continue;
    if (!accept(x, z)) continue;
    const y = stack.heightAt(x, z);
    if (y === null) continue;
    out.push({ x, y, z });
  }
  return out;
}

// Cave passage: a short tunnel covered by a rock hood, ending at an elevator plate.
// mouth = floor-level point at the opening; dir = horizontal heading into the cave.
// toward: the stack's centre (the cliff side); the shell grows into the wall that way.
export function buildCave(ctx, { mouth, dir, length = 4.6, batcher, collider, seed = 1, toward = null }) {
  const M = materials();
  const up = new THREE.Vector3(0, 1, 0);
  const c0 = mouth.clone().addScaledVector(up, 1.15);
  const pts = [c0.clone().addScaledVector(dir, -1.0), c0.clone().addScaledVector(dir, length * 0.5), c0.clone().addScaledVector(dir, length - 0.05)];
  const tube = tunnelGeometry(pts, { radius: 1.75, floor: 1.15, noise: 0.3, seed, lights: [], baseLight: 1 });
  // Darken toward the back so the cave reads as a cave under daylight shading.
  const p = tube.attributes.position, col = tube.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const t = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(mouth).dot(dir) / length;
    const k = 0.62 - Math.min(1, Math.max(0, t)) * 0.5;   // (the mouth's rock is no lighter than the face round it)
    col.setXYZ(i, k, k * 0.97, k * 0.94);
  }
  batcher.add(tube, M.stone);
  collider.addGeometry(tube);
  // The rock round the tunnel: a thick, rough shell swept along it (caveShell), built on the tube's own open end so
  // there is no seam to see through, thickening into the cliff behind so it reads as part of it.
  const hood = caveShell(pts, tube, { seed, toward, ceiling: toward ? toward.y - 0.9 : null });
  batcher.add(hood, M.cliff);
  collider.addGeometry(hood);
  const platePos = mouth.clone().addScaledVector(dir, length);
  const plateRot = Math.atan2(-dir.x, -dir.z);
  batcher.add(endWallGeometry(platePos, plateRot), M.stone, null, 0x6a6560);
  return { platePos, plateRot };
}
