import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, clamp, lerp, smoothstep, makeAngularNoise } from '../core/rng.js';
import { foliageMaterial, patchMaterial } from '../render/materials.js';
import { tfbm, tnoiseA, tfbmA, heightField, toCanvas, normalFromHeight, tex, once } from '../render/textures.js';
import { FAR_BAND } from '../render/lod.js';

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
const TRUNK_H = 50;
const SEGS = 112, DOOR_SEGS = 18;
const TILE = 1.3, TILE_V = 2.4, AROUND = 16;     // bark tile size across / along the fibres (m); whole tiles around
const ROOT_CLEAR = 1.2;                         // no buttress roots within this angle of the door
const CARD_DENSITY = 10;                        // foliage cards per lobe of a mass = CARD_DENSITY * radius²
const FAR_CARDS = 0.2, FAR_SIZE = 1.8;          // the far card set: this share of the cards, this much bigger
const MASS_TILE = 1.4;                          // metres per tile of the foliage masses' texture
const TAU = Math.PI * 2;

const wrap = (a) => a - Math.round(a / TAU) * TAU;

// Columnar trunk: 3.4 m up to 4 m, ~1.5 m at 35 m, ~1 m at 41 m, then thin inside the top of the crown.
function column(y) {
  const c = R - 1.9 * Math.pow(Math.max(0, y - 4) / 31, 1.1);
  return c * (1 - 0.9 * smoothstep(38, 51, y));
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

// Tapered tube along pts (parallel-transport frames); cap (a colour) closes the far end; `around` bark tiles
// wrap it.
function tube(b, pts, radii, sides, shade, cap = null, around = 2) {
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
      ring.push(b.vert(p.copy(pts[i]).addScaledVector(d, radii[i]), d, (k / sides) * around, len / TILE_V, shade));
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

// Old-growth crown: about 22 m across, widest a little below its middle, with a broad, rounded top.
const crownRadius = (y) => 11 * Math.sqrt(Math.max(0, 1 - ((y - 31) / 22) ** 2));

// Broken stubs on the bare lower trunk, then massive, gnarled limbs through the crown: the low ones run out level
// or dip and turn up at the end, the high ones sweep up. Each forks into a few upswept side branches, and every
// branch end carries a foliage mass. Returns the bark geometry and the masses ({ pos, r }).
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
    const d = dirOf(a), rt = column(y), len = rng.float(0.7, 1.7) * 0.8, r0 = rng.float(0.26, 0.42);
    const p0 = d.clone().multiplyScalar(rt * 0.6).setY(y);
    const p2 = d.clone().multiplyScalar(rt + len).setY(y + (rng.float(-0.25, 0.1) - 0.3) * len);
    const p1 = p0.clone().lerp(p2, 0.5);
    if (i % 2 === 0) tube(b, [p0, p1, p2], [r0 * 1.4, r0, r0 * 0.7], 8, [0.8, 0.8, 0.8], [1, 0.82, 0.68], 3);
  }
  const N = 26, M = 10, a0 = rng.float(0, TAU);
  const side = new THREE.Vector3(), shade = [0.7, 0.7, 0.7];
  for (let i = 0; i < N; i++) {
    const f = (i + rng.float(0.15, 0.85)) / N;
    const y = 18.5 + f * 25;
    const a = a0 + i * 2.39996 + rng.float(-0.3, 0.3);
    const d = dirOf(a), rt = column(y);
    const tipR = lerp(3.1, 2.5, f) * rng.float(0.88, 1.12);
    // Rise of the two control points and of the tip, and the tip's reach, as fractions of the limb's length.
    const j = () => rng.float(-0.06, 0.06);
    const r1 = lerp(-0.12, 0.2, f) + j(), r2 = lerp(-0.08, 0.42, f) + j(), r3 = lerp(0.2, 0.6, f) + j();
    const out = lerp(1, 0.85, f), k = rng.float(0.8, 1.06);
    let L = 8;
    for (let it = 0; it < 3; it++) L = Math.max(rt + 1.2, crownRadius(y + r3 * L) * k - tipR * 0.5 - rt * 0.2) / out;
    // Up to 1.5 m thick where it leaves the trunk, with a flared collar; its open end stays buried in the trunk.
    const rb = Math.min(lerp(0.72, 0.3, f) * rng.float(0.85, 1.15), rt * 0.36);
    const exitU = (rt * 0.8) / L;
    const p0 = d.clone().multiplyScalar(rt * 0.2).setY(y);
    const c1 = p0.clone().addScaledVector(d, 0.35 * L).addScaledVector(up, r1 * L);
    const c2 = p0.clone().addScaledVector(d, 0.7 * L).addScaledVector(up, r2 * L);
    const p3 = p0.clone().addScaledVector(d, out * L).addScaledVector(up, r3 * L);
    // Gnarled: bent across and up and down by a few smooth waves that vanish at both ends.
    const amp = Math.min(0.9, 0.08 * L) * rng.float(0.6, 1.2);
    const gs = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)], gu = [rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)];
    side.set(d.z, 0, -d.x);
    const pts = [], radii = [];
    for (let s = 0; s <= M; s++) {
      const u = s / M;
      let ws = 0, wu = 0;
      for (let h = 0; h < 3; h++) { const w = Math.sin((h + 1) * Math.PI * u) / (h + 1); ws += gs[h] * w; wu += gu[h] * w; }
      pts.push(bezier(p0, c1, c2, p3, u).addScaledVector(side, ws * amp).addScaledVector(up, wu * amp * 0.6));
      radii.push(rb * lerp(1, 0.3, Math.pow(u, 0.9)) * (1 + 0.45 * (1 - smoothstep(0, exitU + 0.12, u))));
    }
    tube(b, pts, radii, rb > 0.45 ? 10 : 8, shade, shade, Math.max(2, Math.round((TAU * rb) / TILE)));
    const at = (u) => { const x = u * M, s = Math.min(M - 1, Math.floor(x)); return pts[s].clone().lerp(pts[s + 1], x - s); };
    const rAt = (u) => { const x = u * M, s = Math.min(M - 1, Math.floor(x)); return lerp(radii[s], radii[s + 1], x - s); };
    clumps.push({ pos: pts[M].clone().addScaledVector(up, tipR * 0.25), r: tipR });
    if (L > 5) { const cr = tipR * rng.float(0.62, 0.78); clumps.push({ pos: at(0.6).addScaledVector(up, cr * 0.55), r: cr }); }
    // Side branches, alternating left and right, swept up off the limb, each with its own foliage mass.
    const nSide = L > 6 ? 3 : 2, s0 = rng.sign();
    for (let q = 0; q < nSide; q++) {
      const u = lerp(0.38, 0.9, (q + rng.float(0.2, 0.8)) / nSide);
      const pb = at(u), tn = at(Math.min(1, u + 0.05)).sub(at(Math.max(0, u - 0.05)));
      const yaw = Math.atan2(tn.x, tn.z) + s0 * (q % 2 ? -1 : 1) * rng.float(0.5, 1.1), el = rng.float(0.3, 0.85);
      const d2 = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
      const l2 = Math.max(2.2, L * rng.float(0.28, 0.42)), rs = rAt(u) * 0.6;
      const wob = () => new THREE.Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).multiplyScalar(0.08 * l2);
      const tip = pb.clone().addScaledVector(d2, l2).addScaledVector(up, 0.1 * l2);
      const m1 = pb.clone().addScaledVector(d2, 0.35 * l2).addScaledVector(up, -0.04 * l2).add(wob());
      const m2 = pb.clone().addScaledVector(d2, 0.68 * l2).add(wob());
      tube(b, [pb, m1, m2, tip], [rs, rs * 0.78, rs * 0.55, rs * 0.35], 7, shade, shade);
      const cr = tipR * rng.float(0.7, 0.86);
      clumps.push({ pos: tip.addScaledVector(up, cr * 0.25), r: cr });
    }
  }
  // Masses round the trunk between the limbs, filling the crown out, and the broad rounded top round the leader.
  for (let i = 0; i < 16; i++) {
    const y = rng.float(22, 46), a = rng.float(0, TAU), r = rng.float(2, 2.8), rr = column(y) + r * rng.float(0.5, 1.4);
    clumps.push({ pos: new THREE.Vector3(Math.sin(a) * rr, y, Math.cos(a) * rr), r });
  }
  for (let i = 0; i < 6; i++) {
    const a = a0 + i * 1.05 + rng.float(-0.2, 0.2), rr = rng.float(1.8, 3.6);
    clumps.push({ pos: new THREE.Vector3(Math.sin(a) * rr, rng.float(48, 50.5), Math.cos(a) * rr), r: rng.float(2.5, 3.1) });
  }
  clumps.push({ pos: new THREE.Vector3(0, 51.5, 0), r: 2.6 });
  return { geo: b.geometry(), clumps: billow(clumps, rng) };
}

// Each mass is a main lobe with one to three smaller ones round it and a little lower: billowed, not a ball.
function billow(clumps, rng) {
  const out = [];
  for (const c of clumps) {
    out.push(c);
    const n = rng.int(1, 3), a0 = rng.float(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = a0 + i * rng.float(1.8, 2.6), d = c.r * rng.float(0.55, 0.75);
      out.push({ pos: new THREE.Vector3(Math.sin(a) * d, -c.r * rng.float(0.05, 0.2), Math.cos(a) * d).add(c.pos), r: c.r * rng.float(0.55, 0.72) });
    }
  }
  return out;
}

// A foliage mass is an ellipsoid round c.pos: c.r across, UP of that above its centre, DOWN below (flat-bottomed).
const UP = 0.7, DOWN = 0.5;
const _h = new THREE.Vector3();
// Shading normal at v on or near mass c: out of the mass, blended with out from the crown's axis and tipped up,
// so each mass shades as a volume inside a rounded crown (lit top and outer side, dark underside).
function massNormal(v, c, out) {
  out.subVectors(v, c.pos);
  out.y /= out.y < 0 ? DOWN * DOWN : UP * UP;
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
  out.normalize().multiplyScalar(0.38);
  _h.set(v.x, 0, v.z);
  if (_h.lengthSq() > 1e-8) out.addScaledVector(_h.normalize(), 0.55);
  out.y += 0.3;
  return out.normalize();
}
// Darker low in the crown, where the masses above shade it.
const crownShade = (y) => 0.82 + 0.18 * clamp((y - 16) / 36, 0, 1);

// Alpha cards over the foliage masses: each centred a little in or out of its mass's surface, facing out of it,
// tipped and turned at random. `density` scales the count and `size` the cards (the far set is a few big ones).
function canopyGeometry(clumps, rng, { density = CARD_DENSITY, size = 1, min = 6 } = {}) {
  const counts = clumps.map((c) => Math.max(min, Math.round(density * c.r * c.r)));
  const total = counts.reduce((s, n) => s + n, 0);
  const pos = new Float32Array(total * 12), nor = new Float32Array(total * 12), col = new Float32Array(total * 12);
  const uv = new Float32Array(total * 8), idx = new Uint32Array(total * 6);
  const o = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3(), a = new THREE.Vector3();
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const UV = [0, 1, 1, 1, 0, 0, 1, 0], SX = [-1, 1, -1, 1], SY = [1, 1, -1, -1];
  let vi = 0, ii = 0;
  clumps.forEach((c, ci) => {
    const blue = rng.float(-1, 1) * 0.05;
    const s = size * clamp(c.r / 2.6, 0.85, 1.15);
    for (let i = 0; i < counts[ci]; i++) {
      do o.set(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)); while (o.lengthSq() > 1 || o.lengthSq() < 0.01);
      o.normalize();
      const ry = o.y < 0 ? DOWN : UP, f = rng.float(0.8, 1.06);
      p.set(o.x * f * c.r, o.y * f * c.r * ry, o.z * f * c.r).add(c.pos);
      n.set(o.x + rng.float(-0.45, 0.45), o.y / ry + rng.float(-0.45, 0.45), o.z + rng.float(-0.45, 0.45)).normalize();
      q.setFromUnitVectors(Z, n).multiply(q2.setFromAxisAngle(Z, rng.float(0, TAU)));
      const w = rng.float(0.6, 0.9) * s;
      ax.set(w, 0, 0).applyQuaternion(q);
      ay.set(0, w, 0).applyQuaternion(q);
      const shade = (0.7 + 0.3 * ((f - 0.8) / 0.26)) * (o.y < 0 ? 0.82 + 0.18 * (1 + o.y) : 1) * crownShade(p.y);
      // Sun-bleached tips on the tops.
      const warm = o.y > 0.35 ? rng.float(0, 0.08) : 0;
      const tr = shade * (1 - blue + warm), tg = shade * (1 + warm * 0.6), tb = shade * (1 + blue);
      for (let k = 0; k < 4; k++) {
        v.copy(p).addScaledVector(ax, SX[k]).addScaledVector(ay, SY[k]);
        massNormal(v, c, a);
        const j = (vi + k) * 3;
        pos[j] = v.x; pos[j + 1] = v.y; pos[j + 2] = v.z;
        nor[j] = a.x; nor[j + 1] = a.y; nor[j + 2] = a.z;
        col[j] = tr; col[j + 1] = tg; col[j + 2] = tb;
        uv[(vi + k) * 2] = UV[k * 2]; uv[(vi + k) * 2 + 1] = UV[k * 2 + 1];
      }
      idx.set([vi, vi + 2, vi + 1, vi + 2, vi + 3, vi + 1], ii);
      vi += 4; ii += 6;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// The solid core of each foliage mass: a lumpy, flat-bottomed ellipsoid a little inside its cards, so a mass is
// dense from every side (cards alone read as a see-through lattice from below). Darker than the cards, as the
// inside of a mass is; normals as the cards'. The texture is mapped in world space (massMaterial), so no uv.
function massGeometry(clumps, rng) {
  // Small lobes get a coarser sphere.
  const sphere = (detail) => {
    const ico = new THREE.IcosahedronGeometry(1, detail);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const m = mergeVertices(ico);
    return { p: m.attributes.position, idx: m.index.array };
  };
  const fine = sphere(2), coarse = sphere(1);
  const bases = clumps.map((c) => (c.r > 2.4 ? fine : coarse));
  const nv = bases.reduce((s, b) => s + b.p.count, 0), ni = bases.reduce((s, b) => s + b.idx.length, 0);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const v = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  let vo = 0, io = 0;
  clumps.forEach((c, ci) => {
    const { p: bp, idx: bi } = bases[ci];
    const ph = [rng.float(0, TAU), rng.float(0, TAU), rng.float(0, TAU), rng.float(0, TAU)];
    const blue = rng.float(-1, 1) * 0.05;
    for (let i = 0; i < bp.count; i++) {
      v.fromBufferAttribute(bp, i);
      const k = c.r * (1 + 0.2 * Math.sin(2.7 * v.x + ph[0]) * Math.sin(2.9 * v.y + ph[1]) * Math.sin(2.5 * v.z + ph[2])
        + 0.06 * Math.sin(5.1 * v.x - 4.3 * v.z + ph[3]));
      p.set(v.x * 0.84 * k, v.y * (v.y < 0 ? DOWN : UP) * 0.84 * k, v.z * 0.84 * k).add(c.pos);
      massNormal(p, c, n);
      const shade = 0.66 * (v.y < 0 ? 0.72 + 0.28 * (1 + v.y) : 1) * crownShade(p.y);
      const j = (vo + i) * 3;
      pos[j] = p.x; pos[j + 1] = p.y; pos[j + 2] = p.z;
      nor[j] = n.x; nor[j + 1] = n.y; nor[j + 2] = n.z;
      col[j] = shade * (1 - blue); col[j + 1] = shade; col[j + 2] = shade * (1 + blue);
    }
    for (let t = 0; t < bi.length; t++) idx[io + t] = bi[t] + vo;
    vo += bp.count; io += bi.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
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

// Scale-leaved needle sprays, strokes bucketed by colour and drawn back to front: shaded cords, scales, bleached
// tips. `branch` grows one spray from (x, y) at angle a; `inside(x, y)` bounds it.
function sprays(r, buckets, inside) {
  const branch = (x, y, a, len, depth) => {
    const step = 2.5;
    for (let d = 0; d < len; d += step) {
      const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
      if (!inside(nx, ny)) return;
      buckets[0].segs.push(x, y, nx, ny);
      const t = d / len;
      for (let k = 0; k < 4; k++) {
        const sa = a + r.sign() * r.float(0.3, 0.9), sl = r.float(5, 11) * (1 - t * 0.35);
        const bk = t > 0.75 && r.next() < 0.5 ? 4 : r.int(1, 3);
        buckets[bk].segs.push(x, y, x + Math.cos(sa) * sl, y + Math.sin(sa) * sl);
      }
      if (depth < 2 && r.next() < 0.1) branch(x, y, a + r.sign() * r.float(0.5, 0.9), len * r.float(0.35, 0.55) * (1 - t), depth + 1);
      a += r.float(-0.1, 0.1);
      x = nx; y = ny;
    }
  };
  return branch;
}

function strokeBuckets(g, buckets, offsets = [[0, 0]]) {
  g.lineCap = 'round';
  for (const bk of buckets) {
    g.strokeStyle = bk.style;
    g.lineWidth = bk.width;
    g.beginPath();
    for (const [ox, oy] of offsets) {
      for (let i = 0; i < bk.segs.length; i += 4) { g.moveTo(bk.segs[i] + ox, bk.segs[i + 1] + oy); g.lineTo(bk.segs[i + 2] + ox, bk.segs[i + 3] + oy); }
    }
    g.stroke();
  }
}

// One card: a rosette of sprays radiating from its centre, blue-green with sun-bleached tips, dense in the middle
// and ragged at the edge (the cards face out of their foliage mass, turned at random).
const sprayTexture = () => once('sequoiaSpray', () => {
  const S = 256, C = S / 2, EDGE = C - 14;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = new Rng(71);
  const buckets = [
    { style: 'rgb(34,60,52)', width: 7, segs: [] },
    { style: 'rgb(54,90,78)', width: 2.6, segs: [] },
    { style: 'rgb(70,108,92)', width: 2.2, segs: [] },
    { style: 'rgb(88,126,106)', width: 2, segs: [] },
    { style: 'rgb(134,148,104)', width: 1.8, segs: [] },
  ];
  const branch = sprays(r, buckets, (x, y) => Math.hypot(x - C, y - C) < EDGE);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + r.float(-0.2, 0.2), s = r.float(2, 12);
    branch(C + Math.cos(a) * s, C + Math.sin(a) * s, a + r.float(-0.25, 0.25), r.float(95, 120), 0);
  }
  strokeBuckets(g, buckets);
  return tex(c, { repeat: false });
});

// The foliage masses' cores: a dense, tileable tangle of the same sprays over a dark ground, like looking into
// the inside of a mass.
const massTexture = () => once('sequoiaMass', () => {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = new Rng(73);
  g.fillStyle = 'rgb(26,48,41)';
  g.fillRect(0, 0, S, S);
  const buckets = [
    { style: 'rgb(15,29,26)', width: 5, segs: [] },
    { style: 'rgb(34,62,54)', width: 2.4, segs: [] },
    { style: 'rgb(46,80,68)', width: 2.2, segs: [] },
    { style: 'rgb(60,96,80)', width: 2, segs: [] },
    { style: 'rgb(96,114,82)', width: 1.8, segs: [] },
  ];
  const branch = sprays(r, buckets, () => true);
  for (let i = 0; i < 70; i++) branch(r.float(0, S), r.float(0, S), r.float(0, TAU), r.float(20, 50), 1);
  // Drawn at every offset of the tile, so strokes over an edge come back round the other side.
  const offs = [];
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) offs.push([ox, oy]);
  strokeBuckets(g, buckets, offs);
  return tex(c);
});

let massMat = null;
// The texture is mapped in world space along the three axes (no seams or pinched poles on the lumpy masses).
// Opaque, so the Rocks props' far stand-in takes the masses in too. No wind, like the limbs.
function massMaterial() {
  if (massMat) return massMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: massTexture(), roughness: 0.9, envMapIntensity: 0.5, color: 0xe4ece6, name: 'sequoia-mass' });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
      { vec3 tw = abs( ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).xyz );
        tw *= tw; tw *= tw; tw /= tw.x + tw.y + tw.z;
        vec3 tp = vFogWorld * ${(1 / MASS_TILE).toFixed(4)};
        diffuseColor *= texture2D( map, tp.zy ) * tw.x + texture2D( map, tp.xz ) * tw.y + texture2D( map, tp.xy ) * tw.z; }
      #endif`);
  };
  patchMaterial(m);
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => key() + '|tri';
  return (massMat = m);
}

let barkMat = null;
// No wind: M.bark bends by world height², which would swing a 50 m trunk by metres.
function barkMaterial() {
  if (barkMat) return barkMat;
  const t = barkTextures();
  barkMat = patchMaterial(new THREE.MeshStandardMaterial({
    vertexColors: true, map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.93, envMapIntensity: 0.6,
    // Cast from the sunny side. three.js casts from the back faces by default: the trunk's shaded wall, which meets
    // the ground, so the ground within the sun's depth bias (about 16 cm) of it counted as lit: a bright rim round
    // the base in the trunk's own shadow. The same bias keeps the sunny side itself free of acne.
    shadowSide: THREE.FrontSide,
  }));
  return barkMat;
}

// (x, y, z): trunk base centre on the ground; doorDir: unit horizontal direction the elevator door faces.
// Adds trunk, limbs, doorway and the foliage masses' cores to `batcher` (world space) and the trunk walls to
// `collider`; the foliage cards go to ctx.surface. Returns where the elevator plate goes and the tree's extent.
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
  // The masses' cores go with the stack's props, so into its far stand-in too. Their material is made before the
  // cards' and so has the lower id: three.js draws them first, and the cards behind them fail the depth test.
  batcher.add(massGeometry(limbs.clumps, rng), massMaterial(), toWorld);

  const map = sprayTexture();
  // Bend is local y² * sway: about 0.15 m at the crown top in a strong gust (the cores and limbs hold still).
  const fm = foliageMaterial(map, 0.00005, 0.0008, 0xe4ece6);
  fm.vertexColors = true;
  fm.alphaToCoverage = true;
  // Both faces keep the card's rounded normal: flipped, a card seen from behind would light like the far side of
  // its mass (the undersides of the crown turned sunlit from below).
  const prev = fm.onBeforeCompile, key = fm.customProgramCacheKey;
  fm.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;');
  };
  fm.customProgramCacheKey = () => key() + '|keepN';
  const cards = (geo, name) => {
    geo.applyMatrix4(new THREE.Matrix4().makeRotationY(rot));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, fm);
    m.name = name;
    m.position.set(x, y, z);
    ctx.surface.add(m);
    return m;
  };
  const canopy = cards(canopyGeometry(limbs.clumps, rng), 'sequoia-canopy');
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  canopy.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  // Across FAR_BAND (where the cores and limbs cross to the props' far stand-in) the cards cross to a fifth as
  // many, 1.8x the size, which keep the crown's ragged edge.
  const far = cards(canopyGeometry(limbs.clumps, new Rng(3141), { density: CARD_DENSITY * FAR_CARDS, size: FAR_SIZE, min: 3 }), 'sequoia-canopy:far');
  ctx.lod.add(canopy, { out: FAR_BAND, name: 'sequoia-canopy' });
  ctx.lod.add(far, { in: FAR_BAND, name: 'sequoia-canopy:far' });

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
    height: canopy.geometry.boundingBox.max.y,
    footprintR,
    canopy: [canopy, far],
  };
}
