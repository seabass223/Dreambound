import * as THREE from 'three';
import { Rng, clamp, lerp, smoothstep, makeAngularNoise } from '../core/rng.js';
import { foliageMaterial, patchMaterial } from '../render/materials.js';
import { tfbm, tnoiseA, tfbmA, heightField, toCanvas, normalFromHeight, tex, once } from '../render/textures.js';

// A giant sequoia with the Rocks elevator set into the foot of its trunk.
// Geometry is built in "door space": trunk axis at the origin, ground at y = 0, the door facing +Z. Plate space
// (the elevator root) is door space moved DP along +Z and PLATE_Y down.

const R = 3.4;                                  // column radius the elevator recipe is sized for
const RC = R * 0.98;                            // collision wall radius
const DP = Math.sqrt(RC * RC - 1.45 * 1.45);    // the wall crosses the plate plane at |x| 1.45, behind the car's front panels
const GAP = Math.asin(0.93 / RC);               // a 0.93 m half-chord lets the capsule through to the 0.68 m door
const PLATE_Y = -0.02;
const DOOR = { hw: 1.9, y0: -0.1, y1: 3.35, back: -0.3, rows: 12 };  // bark carved from plate space |x| < hw, y0..y1, z > back
const JAMB = 0.28;                              // the jambs stand this far proud of the plate
const SHROUD = { hw: 1.28, h: 2.72, back: -2.62 };  // bark box around the car, all that shows once the elevator LOD-hides
const TRUNK_H = 47;
const SEGS = 112, DOOR_SEGS = 18;
const TILE = 1.3, TILE_V = 2.4, AROUND = 16;     // bark tile size across / along the fibres (m); whole tiles around
const ROOT_CLEAR = 1.2;                         // no buttress roots within this angle of the door
const CARD_DENSITY = 12;                        // foliage cards per clump = CARD_DENSITY * radius²
const TAU = Math.PI * 2;

const wrap = (a) => a - Math.round(a / TAU) * TAU;

// Columnar trunk: 3.4 m up to 4 m, ~1.5 m at 35 m, then quickly thin inside the crown.
function column(y) {
  const c = R - 1.9 * Math.pow(Math.max(0, y - 4) / 31, 1.1);
  return c * (1 - 0.92 * smoothstep(36, TRUNK_H, y));
}
const swell = (y) => 0.45 * (1 - smoothstep(-0.5, 5.5, y));

function trunkShape(rng) {
  const lumps = makeAngularNoise(rng.int(1, 99999), 8, 2, 1.2);
  const drift = makeAngularNoise(rng.int(1, 99999), 5, 1, 1);
  const roots = [];
  for (let i = 0; i < 8; i++) {
    const a = ROOT_CLEAR + ((i + 0.5 + rng.float(-0.25, 0.25)) / 8) * (TAU - 2 * ROOT_CLEAR);
    roots.push({ a, e: rng.float(1.0, 1.6), h: rng.float(3.2, 5) });
  }
  const jambR = Math.hypot(DOOR.hw, DP + JAMB);
  const lintel = PLATE_Y + DOOR.y1;
  return {
    scar: rng.float(2.2, 4.1),
    // Surface radius at door-space angle phi and height y; out.ridge is 0 in a bark furrow and 1 on a ridge.
    at(phi, y, out) {
      phi = wrap(phi);
      const door = 1 - smoothstep(0.62, 1.15, Math.abs(phi));
      const calm = 1 - 0.8 * door;
      const col = column(y), base = col + swell(y);
      let r = base;
      // The trunk swells around the doorway so the jambs stand proud of the plate.
      if (door > 0 && y < lintel + 3.5) {
        const yy = Math.min(y, lintel);
        r += Math.max(0, jambR - column(yy) - swell(yy)) * (1 - smoothstep(lintel, lintel + 3.5, y)) * door;
      }
      // Buttress roots: rounded lobes at the ground that broaden into the trunk, with hollow flutes between.
      let root = 0, lobe = 0;
      for (const rt of roots) {
        const t = Math.max(0, y) / rt.h;
        if (t >= 1) continue;
        const d = (wrap(phi - rt.a) * base) / lerp(0.85, 1.7, t);
        const gs = Math.exp(-0.5 * d * d);
        root = Math.max(root, rt.e * Math.pow(1 - t, 1.4) * gs);
        lobe = Math.max(lobe, gs);
      }
      r += root - 0.38 * (1 - smoothstep(0, 4.5, y)) * (1 - lobe) * calm;
      r += 0.12 * (1 - smoothstep(0, 8, y)) * Math.cos(12 * phi + 0.9 * Math.sin(0.35 * y + 2 * phi)) * calm;
      // Deep vertical furrows that wander along the height.
      const wob = 0.6 * Math.sin(0.23 * y + 2 * phi) + 0.25 * Math.sin(0.61 * y - 3 * phi + 1.7) + drift(phi, y * 0.3);
      const ridge = Math.sqrt(Math.abs(Math.sin(9 * phi + wob)));
      r += (0.13 * (ridge - 0.7) + lumps(phi, y * 0.12) * 0.12) * clamp(col / R, 0.2, 1) * calm;
      out.r = Math.max(0.04, r);
      out.ridge = ridge;
      return out;
    },
  };
}

// Angle on the given side of the door where the bark is exactly DOOR.hw from the plate's centre line.
function jambAngle(shape, y, side, s) {
  let phi = 0.5;
  for (let i = 0; i < 8; i++) phi = Math.asin(Math.min(1, DOOR.hw / shape.at(side * phi, y, s).r));
  return side * phi;
}

function barkShade(shape, phi, y, s, col, o) {
  const k = (0.58 + 0.42 * s.ridge) * (0.55 + 0.45 * smoothstep(-0.4, 1.4, y)) * (1 - 0.12 * smoothstep(12, 30, y));
  // An old fire scar ("catface") on the far side of the base.
  const w = 1.8 * (1 - y / 8);
  const burn = w > 0 ? smoothstep(w, w * 0.45, Math.abs(wrap(phi - shape.scar)) * s.r) : 0;
  col[o] = k * lerp(1, 0.17, burn); col[o + 1] = k * lerp(1, 0.2, burn); col[o + 2] = k * lerp(1, 0.25, burn);
}

// Lathe-like trunk. Columns jL/jR follow plate-space x = ∓hw exactly up to the lintel row, so removing the
// quads between them leaves a clean rectangular doorway.
function trunkGeometry(shape) {
  const rows = [-1.3, -0.7];
  const kLo = rows.length;
  for (let i = 0; i <= DOOR.rows; i++) rows.push(PLATE_Y + DOOR.y0 + (i / DOOR.rows) * (DOOR.y1 - DOOR.y0));
  const kHi = rows.length - 1;
  for (let h = rows[kHi], step = 0.3; h < TRUNK_H - 1e-3;) {
    step = Math.min(1.8, step * 1.14);
    h = Math.min(TRUNK_H, h + step);
    rows.push(h);
  }
  const n = SEGS + 1, jL = (SEGS - DOOR_SEGS) / 2, jR = jL + DOOR_SEGS;
  const count = rows.length * n;
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), col = new Float32Array(count * 3);
  const s = {}, pU = (Math.PI * DOOR_SEGS) / SEGS;
  for (let k = 0; k < rows.length; k++) {
    const y = rows[k];
    const blend = smoothstep(DOOR.y1, DOOR.y1 + 2.5, y - PLATE_Y);
    const pL = blend < 1 ? lerp(jambAngle(shape, y, -1, s), -pU, blend) : -pU;
    const pR = blend < 1 ? lerp(jambAngle(shape, y, 1, s), pU, blend) : pU;
    for (let j = 0; j < n; j++) {
      const phi = j <= jL ? -Math.PI + (j / jL) * (pL + Math.PI)
        : j <= jR ? pL + ((j - jL) / DOOR_SEGS) * (pR - pL)
          : pR + ((j - jR) / (SEGS - jR)) * (Math.PI - pR);
      shape.at(phi, y, s);
      const i = k * n + j;
      pos[i * 3] = s.r * Math.sin(phi); pos[i * 3 + 1] = y; pos[i * 3 + 2] = s.r * Math.cos(phi);
      uv[i * 2] = ((phi + Math.PI) / TAU) * AROUND; uv[i * 2 + 1] = y / TILE_V;
      barkShade(shape, phi, y, s, col, i * 3);
    }
  }
  const full = [], cut = [];
  for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < SEGS; j++) {
    const a = k * n + j, b = a + 1, c = a + n, d = c + 1;
    full.push(a, b, c, b, d, c);
    if (!(k >= kLo && k < kHi && j >= jL && j < jR)) cut.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Normals from the uncut surface, so the doorway edge shades like the trunk around it.
  geo.setIndex(full);
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let k = 0; k < rows.length; k++) {
    const a = k * n, b = a + SEGS;
    v.set(nor.getX(a) + nor.getX(b), nor.getY(a) + nor.getY(b), nor.getZ(a) + nor.getZ(b)).normalize();
    nor.setXYZ(a, v.x, v.y, v.z); nor.setXYZ(b, v.x, v.y, v.z);
  }
  geo.setIndex(cut);
  const vtx = (k, j) => new THREE.Vector3().fromArray(pos, (k * n + j) * 3);
  let jambFront = -Infinity;
  for (let k = kLo; k <= kHi; k++) for (const j of [jL, jR]) jambFront = Math.max(jambFront, vtx(k, j).z - DP);
  return { geo, kLo, kHi, jL, jR, vtx, jambFront };
}

// Small indexed mesh accumulator (position, normal, uv, colour).
function builder() {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const b = {
    vert(p, n, u, v, c) {
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(u, v); col.push(c[0], c[1], c[2]);
      return pos.length / 3 - 1;
    },
    tri(a, c, d) { idx.push(a, c, d); },
    // A flat quad, corners in order around its edge, facing n; uv is planar in the two axes across n.
    quad(ps, n, shades) {
      const ax = Math.abs(n.x) > 0.5 ? ['z', 'y'] : Math.abs(n.y) > 0.5 ? ['x', 'z'] : ['x', 'y'];
      const i = ps.map((p, k) => b.vert(p, n, p[ax[0]] / TILE, p[ax[1]] / (ax[1] === 'y' ? TILE_V : TILE), [shades[k], shades[k], shades[k]]));
      const e1 = ps[1].clone().sub(ps[0]), e2 = ps[2].clone().sub(ps[0]);
      if (e1.cross(e2).dot(n) > 0) { b.tri(i[0], i[1], i[2]); b.tri(i[0], i[2], i[3]); } else { b.tri(i[0], i[2], i[1]); b.tri(i[0], i[3], i[2]); }
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return g;
    },
  };
  return b;
}

// The doorway recess (jambs, lintel, threshold, back wall) and a closed bark box around the car, so the
// trunk never reads as hollow when the elevator plate is hidden in the distance.
function recessGeometry(tr) {
  const b = builder();
  const P = (x, y, z) => new THREE.Vector3(x, y + PLATE_Y, z + DP);
  const back = (e) => new THREE.Vector3(e.x, e.y, DP + DOOR.back);
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const EDGE = 0.72, DEEP = 0.42, SLAB = 0.38, BOX = 0.24;
  for (const j of [tr.jL, tr.jR]) {
    const n = j === tr.jL ? X : X.clone().negate();
    for (let k = tr.kLo; k < tr.kHi; k++) {
      const e0 = tr.vtx(k, j), e1 = tr.vtx(k + 1, j);
      b.quad([e0, e1, back(e1), back(e0)], n, [EDGE, EDGE, DEEP, DEEP]);
    }
  }
  for (let j = tr.jL; j < tr.jR; j++) {
    const l0 = tr.vtx(tr.kHi, j), l1 = tr.vtx(tr.kHi, j + 1);
    b.quad([l0, l1, back(l1), back(l0)], Y.clone().negate(), [EDGE, EDGE, DEEP, DEEP]);
    const t0 = tr.vtx(tr.kLo, j), t1 = tr.vtx(tr.kLo, j + 1);
    b.quad([t0, t1, back(t1), back(t0)], Y, [EDGE, EDGE, DEEP, DEEP]);
  }
  const { hw, y0, y1 } = DOOR, zb = DOOR.back, s = SHROUD;
  const slab = (x0, x1, ya, yb) => b.quad([P(x0, ya, zb), P(x1, ya, zb), P(x1, yb, zb), P(x0, yb, zb)], Z, [SLAB, SLAB, SLAB, SLAB]);
  slab(-hw, -s.hw, y0, y1);
  slab(s.hw, hw, y0, y1);
  slab(-s.hw, s.hw, s.h, y1);
  const box = [BOX, BOX, BOX, BOX];
  for (const sx of [-1, 1]) {
    const x = sx * s.hw;
    b.quad([P(x, y0, zb), P(x, y0, s.back), P(x, s.h, s.back), P(x, s.h, zb)], sx < 0 ? X : X.clone().negate(), box);
  }
  b.quad([P(-s.hw, s.h, zb), P(s.hw, s.h, zb), P(s.hw, s.h, s.back), P(-s.hw, s.h, s.back)], Y.clone().negate(), box);
  b.quad([P(-s.hw, y0, zb), P(s.hw, y0, zb), P(s.hw, y0, s.back), P(-s.hw, y0, s.back)], Y, box);
  b.quad([P(-s.hw, y0, s.back), P(s.hw, y0, s.back), P(s.hw, s.h, s.back), P(-s.hw, s.h, s.back)], Z, box);
  return b.geometry();
}

// Tapered tube along pts (parallel-transport frames); cap (a colour) closes the far end.
function tube(b, pts, radii, sides, shade, cap = null) {
  const t = new THREE.Vector3(), n = new THREE.Vector3(), bn = new THREE.Vector3(), d = new THREE.Vector3(), p = new THREE.Vector3();
  const rings = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i < pts.length - 1) t.subVectors(pts[i + 1], pts[i]); else t.subVectors(pts[i], pts[i - 1]);
    t.normalize();
    if (i === 0) n.set(0, 1, 0);
    n.addScaledVector(t, -n.dot(t));
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0).addScaledVector(t, -t.x);
    n.normalize();
    bn.crossVectors(t, n);
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const ring = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * TAU;
      d.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(bn, Math.sin(a));
      ring.push(b.vert(p.copy(pts[i]).addScaledVector(d, radii[i]), d, (k / sides) * 2, len / TILE_V, shade));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) {
    b.tri(rings[i][k], rings[i][k + 1], rings[i + 1][k]);
    b.tri(rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
  }
  if (cap) {
    const last = rings[rings.length - 1], r = radii[radii.length - 1];
    const c = b.vert(p.copy(pts[pts.length - 1]).addScaledVector(t, r * 0.25), t, 0.5, 0.5, cap);
    for (let k = 0; k < sides; k++) b.tri(c, last[k], last[k + 1]);
  }
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
}

// Old-growth crown: widest in its middle and dome-topped, not a young tree's spire.
const crownRadius = (y) => 9.5 * Math.sqrt(Math.max(0, 1 - ((y - 33) / 18) ** 2));

// Broken stubs on the bare lower trunk, then short stout limbs (the lower ones drooping, then upturned)
// through the crown. Returns the bark geometry and the foliage clumps it carries.
function limbGeometry(rng) {
  const b = builder(), clumps = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dirOf = (a) => new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  // Only three stubs are kept (in a row, five read as ladder rungs), but all five draws are made so the crown
  // below keeps its layout.
  for (let i = 0; i < 5; i++) {
    const y = rng.float(7, 17);
    let a = rng.float(-Math.PI, Math.PI);
    if (y < 10 && Math.abs(a) < 0.8) a += Math.PI;
    const d = dirOf(a), rt = column(y), len = rng.float(0.7, 1.7) * 0.55, r0 = rng.float(0.16, 0.32);
    const p0 = d.clone().multiplyScalar(rt * 0.7).setY(y);
    const p2 = d.clone().multiplyScalar(rt + len).setY(y + (rng.float(-0.25, 0.1) - 0.3) * len);
    const p1 = p0.clone().lerp(p2, 0.5);
    if (i % 2 === 0) tube(b, [p0, p1, p2], [r0 * 1.3, r0, r0 * 0.6], 6, [0.8, 0.8, 0.8], [1, 0.82, 0.68]);
  }
  const N = 30, a0 = rng.float(0, TAU);
  for (let i = 0; i < N; i++) {
    const f = (i + rng.float(0.15, 0.85)) / N;
    const y = 19.5 + f * 25.5;
    const a = a0 + i * 2.39996 + rng.float(-0.3, 0.3);
    const d = dirOf(a), rt = column(y);
    const tipR = lerp(2.5, 2.1, f) * rng.float(0.85, 1.15);
    const reach = Math.max(rt + 1.2, crownRadius(y) * rng.float(0.82, 1.12) - tipR * 0.75);
    const L = reach - rt * 0.5;
    // Open tube ends must stay buried: in the trunk here, in the limb for the side branch below.
    const rb = Math.min(lerp(0.55, 0.26, f) * rng.float(0.85, 1.15), rt * 0.45);
    const droop = f < 0.55 && rng.next() < 0.65;
    const p0 = d.clone().multiplyScalar(rt * 0.3).setY(y);
    const c1 = p0.clone().addScaledVector(d, 0.35 * L).addScaledVector(up, (droop ? -0.14 : 0.08) * L);
    const c2 = p0.clone().addScaledVector(d, 0.72 * L).addScaledVector(up, (droop ? -0.16 : 0.22) * L);
    const p3 = p0.clone().addScaledVector(d, L).addScaledVector(up, (droop ? 0.02 : 0.38) * L);
    const pts = [], radii = [];
    for (let k = 0; k <= 6; k++) {
      pts.push(bezier(p0, c1, c2, p3, k / 6));
      radii.push(lerp(rb, 0.07, Math.pow(k / 6, 0.8)) * (k === 0 ? 1.3 : 1));
    }
    const shade = [0.72, 0.72, 0.72];
    tube(b, pts, radii, 7, shade, shade);
    clumps.push({ pos: p3.clone().addScaledVector(up, tipR * 0.3), r: tipR });
    clumps.push({ pos: bezier(p0, c1, c2, p3, 0.62).addScaledVector(up, tipR * 0.55), r: tipR * 0.72 });
    // One side branch with its own tuft.
    const pb = bezier(p0, c1, c2, p3, 0.5);
    const yaw = a + rng.sign() * rng.float(0.55, 0.95), el = rng.float(0.15, 0.5);
    const d2 = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    const l2 = L * rng.float(0.35, 0.5);
    const tip = pb.clone().addScaledVector(d2, l2);
    const rs = lerp(rb, 0.07, Math.pow(0.5, 0.8)) * 0.7;
    tube(b, [pb, pb.clone().addScaledVector(d2, l2 * 0.5).addScaledVector(up, -0.06 * l2), tip], [rs, rs * 0.65, 0.05], 5, shade, shade);
    clumps.push({ pos: tip.addScaledVector(up, tipR * 0.25), r: tipR * 0.7 });
  }
  // Tufts on the trunk between the limbs, and the broad rounded top: big clumps spread round the leader.
  for (let i = 0; i < 14; i++) {
    const y = rng.float(23, 43), a = rng.float(0, TAU), rr = column(y) + 1.2;
    clumps.push({ pos: new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr), r: rng.float(1.6, 2.2) });
  }
  for (let i = 0; i < 5; i++) {
    const a = a0 + i * 1.33 + (i % 2) * 0.35, rr = 2 + ((i * 3) % 5) * 0.375;
    clumps.push({ pos: new THREE.Vector3(Math.sin(a) * rr, 46 + ((i * 2) % 5) * 0.75, Math.cos(a) * rr), r: 2.3 + (i % 3) * 0.25 });
  }
  return { geo: b.geometry(), clumps };
}

// Alpha cards in rounded cloud masses: domed tops, flatter undersides, darker inside, normals rounded outward
// from both the clump and the crown axis so the masses shade as volumes.
function canopyGeometry(clumps, rng) {
  let total = 0;
  for (const c of clumps) { c.n = Math.max(6, Math.round(CARD_DENSITY * c.r * c.r)); total += c.n; }
  const pos = new Float32Array(total * 12), nor = new Float32Array(total * 12), col = new Float32Array(total * 12);
  const uv = new Float32Array(total * 8), idx = new Uint32Array(total * 6);
  const o = new THREE.Vector3(), p = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3();
  const v = new THREE.Vector3(), a = new THREE.Vector3(), h = new THREE.Vector3();
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const UV = [0, 1, 1, 1, 0, 0, 1, 0], SX = [-1, 1, -1, 1], SY = [1, 1, -1, -1];
  let vi = 0, ii = 0;
  for (const c of clumps) {
    const blue = rng.float(-1, 1) * 0.05;
    const tint = [1 - blue, 1, 1 + blue];
    const size = clamp(c.r / 1.8, 0.8, 1.2);
    for (let i = 0; i < c.n; i++) {
      do o.set(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)); while (o.lengthSq() > 1 || o.lengthSq() < 0.01);
      o.normalize();
      const f = 0.35 + 0.65 * Math.sqrt(rng.next());
      p.set(o.x * f * c.r, o.y * f * c.r * (o.y < 0 ? 0.55 : 0.8), o.z * f * c.r).add(c.pos);
      const w = rng.float(0.5, 0.75) * size;
      e.set(rng.float(-0.9, 0.9), rng.float(0, TAU), rng.float(-0.5, 0.5), 'YXZ');
      q.setFromEuler(e);
      ax.set(w, 0, 0).applyQuaternion(q);
      ay.set(0, w, 0).applyQuaternion(q);
      const shade = (0.6 + 0.4 * f) * (o.y < 0 ? 0.82 + 0.18 * (1 + o.y) : 1) * (0.84 + 0.16 * clamp((p.y - 18) / 33, 0, 1));
      for (let k = 0; k < 4; k++) {
        v.copy(p).addScaledVector(ax, SX[k]).addScaledVector(ay, SY[k]);
        a.subVectors(v, c.pos);
        if (a.lengthSq() < 1e-8) a.set(0, 1, 0);
        h.set(v.x, 0, v.z);
        if (h.lengthSq() < 1e-8) h.copy(a);
        a.normalize().multiplyScalar(0.55).addScaledVector(h.normalize(), 0.45);
        a.y += 0.3;
        a.normalize();
        const j = (vi + k) * 3;
        pos[j] = v.x; pos[j + 1] = v.y; pos[j + 2] = v.z;
        nor[j] = a.x; nor[j + 1] = a.y; nor[j + 2] = a.z;
        col[j] = shade * tint[0]; col[j + 1] = shade * tint[1]; col[j + 2] = shade * tint[2];
        uv[(vi + k) * 2] = UV[k * 2]; uv[(vi + k) * 2 + 1] = UV[k * 2 + 1];
      }
      idx.set([vi, vi + 2, vi + 1, vi + 2, vi + 3, vi + 1], ii);
      vi += 4; ii += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Redwood bark, one tile (TILE across, TILE_V along the fibres): cinnamon fibrous ridges, deep dark furrows,
// grey weathered strips.
const barkTextures = () => once('sequoiaBark', () => {
  const S = 256;
  const h = heightField(S, (u, v) => {
    // Two sets of wandering strands (4 and 6 per tile) merge and split; furrows open where both fall away.
    const wa = (tfbmA(u, v, 4, 1, 3, 41) - 0.5) * 1.6, wb = (tfbmA(u, v, 3, 1, 3, 71) - 0.5) * 2.2;
    const sa = Math.abs(Math.sin((u * 4 + wa) * Math.PI)), sb = Math.abs(Math.sin((u * 6 + wb) * Math.PI));
    const strands = Math.max(smoothstep(0.3, 0.85, sa), smoothstep(0.35, 0.9, sb) * 0.9);
    const fib = tnoiseA(u, v, 96, 3, 47) * 0.5 + tnoiseA(u, v, 192, 5, 53) * 0.5;
    const peel = smoothstep(0.6, 0.8, tnoiseA(u, v, 10, 5, 59));
    return strands * (0.62 + fib * 0.26 - peel * 0.18) + fib * 0.08;
  });
  const col = toCanvas(S, (x, y) => {
    const k = h[y * S + x], u = x / S, v = y / S;
    const weather = smoothstep(0.5, 0.72, tfbm(u, v, 4, 3, 61)) * smoothstep(0.5, 0.8, k) * 0.6;
    const warm = tfbm(u, v, 3, 2, 67);
    const f = 0.2 + k * 0.88;
    const r = (150 + warm * 40) * f, g = (78 + warm * 18) * f, b = (54 + warm * 6) * f;
    return [r + (140 - r) * weather, g + (112 - g) * weather, b + (100 - b) * weather];
  });
  return { map: tex(col), normal: tex(normalFromHeight(S, h, 4), { srgb: false }) };
});

// Clumped sprays of scale-like needles hanging from the card's top edge, blue-green with sun-bleached tips.
const sprayTexture = () => once('sequoiaSpray', () => {
  const S = 256, PAD = 20;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = new Rng(71);
  // Strokes are bucketed by colour and drawn back to front: shaded cords, scales, bleached tips.
  const buckets = [
    { style: 'rgb(26,50,44)', width: 7, segs: [] },
    { style: 'rgb(42,76,66)', width: 2.6, segs: [] },
    { style: 'rgb(56,94,80)', width: 2.2, segs: [] },
    { style: 'rgb(72,110,92)', width: 2, segs: [] },
    { style: 'rgb(112,128,90)', width: 1.8, segs: [] },
  ];
  const branch = (x, y, a, len, depth) => {
    const step = 2.5;
    for (let d = 0; d < len; d += step) {
      const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
      if (nx < PAD || nx > S - PAD || ny < PAD || ny > S - PAD) return;
      buckets[0].segs.push(x, y, nx, ny);
      const t = d / len;
      for (let k = 0; k < 4; k++) {
        const sa = a + r.sign() * r.float(0.3, 0.9), sl = r.float(5, 10) * (1 - t * 0.35);
        const bk = depth > 0 && t > 0.8 && r.next() < 0.5 ? 4 : r.int(1, 3);
        buckets[bk].segs.push(x, y, x + Math.cos(sa) * sl, y + Math.sin(sa) * sl);
      }
      if (depth < 2 && r.next() < 0.09) branch(x, y, a + r.sign() * r.float(0.5, 0.9), len * r.float(0.3, 0.5) * (1 - t), depth + 1);
      a += r.float(-0.1, 0.1) + (Math.PI / 2 - a) * 0.01;
      x = nx; y = ny;
    }
  };
  // Branchlets fan out and droop from a few attachment points along the top edge.
  for (let i = 0; i < 11; i++) {
    const f = i / 10 - 0.5;
    branch(S * (0.5 + f * 0.3) + r.float(-8, 8), PAD + r.float(0, 8), Math.PI / 2 + f * 2.3 + r.float(-0.15, 0.15), r.float(150, 230), 0);
  }
  g.lineCap = 'round';
  for (const bk of buckets) {
    g.strokeStyle = bk.style;
    g.lineWidth = bk.width;
    g.beginPath();
    for (let i = 0; i < bk.segs.length; i += 4) { g.moveTo(bk.segs[i], bk.segs[i + 1]); g.lineTo(bk.segs[i + 2], bk.segs[i + 3]); }
    g.stroke();
  }
  return tex(c, { repeat: false });
});

let barkMat = null;
// No wind: M.bark bends by world height², which would swing a 50 m trunk by metres.
function barkMaterial() {
  if (barkMat) return barkMat;
  const t = barkTextures();
  barkMat = patchMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.93, envMapIntensity: 0.6,
  }));
  return barkMat;
}

// (x, y, z): trunk base centre on the ground; doorDir: unit horizontal direction the elevator door faces.
// Adds trunk, limbs and doorway to `batcher` (world space) and the trunk walls to `collider`; the canopy goes to
// ctx.surface. Returns where the elevator plate goes and the tree's extent.
export function buildSequoia(ctx, { x, y, z, doorDir, batcher, collider }) {
  const rng = new Rng(3137);
  const rot = Math.atan2(doorDir.x, doorDir.z);
  const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)), right = new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot));
  const toWorld = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  const shape = trunkShape(rng);

  const bark = barkMaterial();
  const trunk = trunkGeometry(shape);
  batcher.add(trunk.geo, bark, toWorld);
  batcher.add(recessGeometry(trunk), bark, toWorld);
  const limbs = limbGeometry(rng);
  batcher.add(limbs.geo, bark, toWorld);

  const geo = canopyGeometry(limbs.clumps, rng);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationY(rot));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const map = sprayTexture();
  // Bend is local y² * sway: about 0.2 m at the crown top in a strong gust.
  const fm = foliageMaterial(map, 0.00007, 0.0008, 0xe4ece6);
  fm.vertexColors = true;
  fm.alphaToCoverage = true;
  const canopy = new THREE.Mesh(geo, fm);
  canopy.name = 'sequoia-canopy';
  canopy.position.set(x, y, z);
  canopy.castShadow = true;
  canopy.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  ctx.surface.add(canopy);

  // Collision: the trunk wall with its door gap, jamb blocks beside the plate, and a vertical wall around the
  // buttresses (sloped bark would be climbable).
  const plate = (lx, lz) => new THREE.Vector3(x, y, z).addScaledVector(right, lx).addScaledVector(fwd, lz + DP);
  collider.addCylinder(x, y - 1, z, RC, 5, 32, rot + GAP, TAU - 2 * GAP);
  const jz0 = -0.35, jz1 = trunk.jambFront + 0.08;
  for (const side of [-1, 1]) {
    const c = plate(side * (DOOR.hw + 0.4), (jz0 + jz1) / 2);
    collider.addBox(c.x, y + 2, c.z, 0.8, 6, jz1 - jz0, rot);
  }
  const s = {}, M = 96;
  const reachAt = (phi, dphi) => {
    let m = 0;
    for (const yy of [0.25, 0.7, 1.2, 1.8]) for (const k of [-0.5, 0, 0.5]) m = Math.max(m, shape.at(phi + k * dphi, yy, s).r);
    return m - 0.05;
  };
  // Wall ends sit inside the jamb blocks (plate-space |x| = 2.3).
  let e0 = 0.6, e1 = 0.6;
  for (let i = 0; i < 8; i++) {
    e0 = Math.asin(Math.min(1, 2.3 / reachAt(e0, 0.05)));
    e1 = Math.asin(Math.min(1, 2.3 / reachAt(-e1, 0.05)));
  }
  const wall = [], wallIdx = [];
  for (let i = 0; i <= M; i++) {
    const phi = e0 + (i / M) * (TAU - e0 - e1), rr = reachAt(phi, (TAU - e0 - e1) / M);
    wall.push(rr * Math.sin(phi), -1, rr * Math.cos(phi), rr * Math.sin(phi), 5, rr * Math.cos(phi));
    if (i < M) wallIdx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
  wallGeo.setIndex(wallIdx);
  collider.addGeometry(wallGeo, toWorld);

  let footprintR = 0;
  for (let i = 0; i < 360; i++) footprintR = Math.max(footprintR, shape.at((i / 360) * TAU, 0, s).r);
  return {
    platePos: plate(0, 0).setY(y + PLATE_Y),
    plateRot: rot,
    height: geo.boundingBox.max.y,
    footprintR,
    canopy: [canopy],
  };
}
