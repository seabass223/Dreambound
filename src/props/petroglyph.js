import * as THREE from 'three';
import { Rng, noise2, fbm2, clamp, smoothstep } from '../core/rng.js';
import { materials, patchMaterial } from '../render/materials.js';
import { once } from '../render/textures.js';

// A crude petroglyph pecked into a boulder on the Rocks stack, and a clue: the Tower stack (its column standing in
// the cloud sea, the lattice pylon on top and its three lamps as cup marks) with the elevator's shaft running down out
// of it, through the clouds, to two chambers one under the other: the cave hub's station and, a short drop further,
// the hidden lounge (the smaller one, with a dot in it). Nothing points at it.
//
// It is a decal made of the rock's own triangles inside a box on the face, clipped to the box as three's
// DecalGeometry does, but keeping the rock's uv and baked vertex colour. So the carving is drawn with the rock's own
// texture and tint, and only the grooves differ: a lighter tint (pecked through the weathered skin), their own normal
// map (so they catch grazing light), and alpha over the rock round them. A few lichen crusts grow over it. One draw
// call; the two textures are made once, at build, and the preloader uploads them like every other.

const PX = 0.0011;                 // metres per texel
const TW = 512, TH = 800;          // texels across and up the face
const W = TW * PX, H = TH * PX;    // the box on the face: 0.56 m across, 0.88 m up
const DEPTH = 0.3;                 // it reaches this far in front of and behind the face's centre

// The design, in metres on the face (x across to the right, y up; the box is centred on 0, 0). r: the groove's
// half-width, d: its depth. Lines are wobbled and their width and depth wander as they're drawn.
function design() {
  const wave = (x0, x1, y, amp, wl, ph = 0) => {
    const p = [];
    for (let x = x0; x <= x1 + 1e-9; x += 0.01) p.push([x, y + amp * Math.sin(((x - x0) / wl) * Math.PI * 2 + ph)]);
    return p;
  };
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0 + 0.003], [x1 - 0.002, y1], [x0 + 0.003, y1 - 0.002], [x0, y0]];
  const lines = [
    // The pylon (finer grooves): a tapering body on two legs with a small peak, the cross-arm as a shallow truss
    // (straight top chord, its lower chords running back into the body), and a cross and a rung in the body.
    { p: [[-0.064, 0.097], [-0.044, 0.2], [-0.025, 0.3]], r: 0.0095, d: 0.0042 },
    { p: [[0.062, 0.098], [0.042, 0.2], [0.024, 0.3]], r: 0.0095, d: 0.0042 },
    { p: [[-0.025, 0.3], [0.0, 0.338], [0.024, 0.3]], r: 0.0085, d: 0.0038 },
    { p: [[-0.14, 0.266], [-0.06, 0.271], [0.0, 0.27], [0.066, 0.269], [0.142, 0.262]], r: 0.0095, d: 0.0042 },
    { p: [[-0.134, 0.259], [-0.037, 0.236]], r: 0.0075, d: 0.0034 },
    { p: [[0.136, 0.255], [0.036, 0.234]], r: 0.0075, d: 0.0034 },
    { p: [[-0.058, 0.113], [0.043, 0.168]], r: 0.0068, d: 0.003 },
    { p: [[0.056, 0.114], [-0.045, 0.167]], r: 0.0068, d: 0.003 },
    { p: [[-0.047, 0.178], [0.046, 0.18]], r: 0.0068, d: 0.003 },
    // The stack: its cap, and its sides widening a little down to the cloud sea.
    { p: [[-0.138, 0.088], [-0.07, 0.097], [0.0, 0.1], [0.07, 0.098], [0.14, 0.09]], r: 0.0135, d: 0.0055 },
    { p: [[-0.138, 0.088], [-0.13, 0.04], [-0.148, -0.02], [-0.152, -0.08], [-0.166, -0.13]], r: 0.0135, d: 0.0055 },
    { p: [[0.14, 0.09], [0.147, 0.03], [0.142, -0.03], [0.159, -0.085], [0.167, -0.128]], r: 0.0135, d: 0.0055 },
    // The cloud sea: two wavy lines across its foot.
    { p: wave(-0.228, 0.228, -0.136, 0.012, 0.078), r: 0.0115, d: 0.0048 },
    { p: wave(-0.205, 0.214, -0.18, 0.01, 0.072, 1.3), r: 0.0105, d: 0.0044 },
    // The shaft: from the cap, down through the stack and the clouds, to the first stop.
    { p: [[0.048, 0.098], [0.045, -0.05], [0.049, -0.214]], r: 0.012, d: 0.0052 },
    // The first stop (the cave hub's station) ...
    { p: rect(-0.04, -0.284, 0.136, -0.214), r: 0.012, d: 0.0052 },
    // ... and a short drop to the second (the lounge): smaller, with a dot in it.
    { p: [[0.048, -0.284], [0.047, -0.318]], r: 0.012, d: 0.0052 },
    { p: rect(-0.012, -0.402, 0.108, -0.318), r: 0.0115, d: 0.005 },
  ];
  const dots = [
    { x: -0.141, y: 0.306, r: 0.019, d: 0.007 },   // the lamps: the arm ends and the peak
    { x: 0.001, y: 0.386, r: 0.019, d: 0.007 },
    { x: 0.144, y: 0.302, r: 0.019, d: 0.007 },
    { x: 0.048, y: -0.36, r: 0.0125, d: 0.006 },   // in the lounge
  ];
  return { lines, dots };
}

// Weathering: how much of the pecking survives (depth and freshness), in patches a few centimetres across.
const wear = (x, y) => clamp(0.84 + 0.42 * fbm2(x * 4.5 + 1.7, y * 4.5 - 2.1, 3, 91), 0.42, 1);

// ------------------------------------------------------------------------------------------------ textures
// carve: rgb = the tint on the rock's colour / 2, a = coverage (grooves and lichen); normal: tangent space, +v up the
// face. DataTextures (not canvases): a canvas stores premultiplied alpha, which would zero the tint round the grooves
// and darken their edges once filtered.
export function petroglyphTextures() {
  return once('petroglyph', () => {
    const N = TW * TH, rng = new Rng(4099);
    const G = new Float32Array(N);                  // groove depth (m)
    const toI = (x) => (x + W / 2) / PX - 0.5, toJ = (y) => (y + H / 2) / PX - 0.5;
    const X = (i) => (i + 0.5) * PX - W / 2, Y = (j) => (j + 0.5) * PX - H / 2;

    // A groove along one short segment, per-end half-width and depth; the deepest wins.
    const segment = (a, b) => {
      const R = Math.max(a.r, b.r);
      const i0 = Math.max(0, Math.floor(toI(Math.min(a.x, b.x) - R))), i1 = Math.min(TW - 1, Math.ceil(toI(Math.max(a.x, b.x) + R)));
      const j0 = Math.max(0, Math.floor(toJ(Math.min(a.y, b.y) - R))), j1 = Math.min(TH - 1, Math.ceil(toJ(Math.max(a.y, b.y) + R)));
      const ex = b.x - a.x, ey = b.y - a.y, el2 = ex * ex + ey * ey || 1e-12;
      for (let j = j0; j <= j1; j++) {
        const y = Y(j);
        for (let i = i0; i <= i1; i++) {
          const x = X(i);
          const t = clamp(((x - a.x) * ex + (y - a.y) * ey) / el2, 0, 1);
          const dx = x - a.x - ex * t, dy = y - a.y - ey * t, r = a.r + (b.r - a.r) * t;
          const q = (dx * dx + dy * dy) / (r * r);
          if (q >= 1) continue;
          const h = (a.d + (b.d - a.d) * t) * (1 - q * q);   // a flat pecked floor, steep sides
          const k = j * TW + i;
          if (h > G[k]) G[k] = h;
        }
      }
    };
    // One peck: a small pit added on top (so the groove floor is rough and its edge ragged).
    const pit = (x, y, rp, dp) => {
      const i0 = Math.max(0, Math.floor(toI(x - rp))), i1 = Math.min(TW - 1, Math.ceil(toI(x + rp)));
      const j0 = Math.max(0, Math.floor(toJ(y - rp))), j1 = Math.min(TH - 1, Math.ceil(toJ(y + rp)));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = X(i) - x, dy = Y(j) - y, q = (dx * dx + dy * dy) / (rp * rp);
        if (q < 1) G[j * TW + i] += dp * (1 - q);
      }
    };
    const pecks = (x, y, spread, n, w) => {
      for (let k = 0; k < n; k++) {
        const a = rng.float(0, Math.PI * 2), o = spread * Math.sqrt(rng.next()) * 1.22;
        pit(x + Math.cos(a) * o, y + Math.sin(a) * o, rng.float(0.001, 0.0027), rng.float(0.0003, 0.0011) * w);
      }
    };

    const { lines, dots } = design();
    let seed = 0;
    for (const L of lines) {
      seed += 7;
      // Resample every 3 mm, wobbling across the line and letting its width and depth wander.
      const pts = [];
      let s = 0;
      for (let k = 0; k < L.p.length - 1; k++) {
        const [x0, y0] = L.p[k], [x1, y1] = L.p[k + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / 0.003));
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        for (let m = k ? 1 : 0; m <= n; m++) {
          const f = m / n, ss = s + len * f;
          const off = 0.0034 * noise2(ss * 14, seed, 3) + 0.0011 * noise2(ss * 60, seed, 5);
          const x = x0 + (x1 - x0) * f + nx * off, y = y0 + (y1 - y0) * f + ny * off, w = wear(x, y);
          pts.push({ x, y, r: L.r * (0.8 + 0.4 * (0.5 + 0.5 * noise2(ss * 22, seed, 11))), d: L.d * (0.8 + 0.35 * (0.5 + 0.5 * noise2(ss * 15, seed, 13))) * w, w });
        }
        s += len;
      }
      for (let k = 0; k < pts.length - 1; k++) segment(pts[k], pts[k + 1]);
      // About one peck per 6 mm² of groove.
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1], f = rng.next();
        pecks(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.r, Math.round((0.003 * 2 * a.r) / 6e-6), a.w);
      }
    }
    for (const D of dots) {
      const w = wear(D.x, D.y);
      // A cup mark: a bowl with a slightly irregular rim.
      const i0 = Math.max(0, Math.floor(toI(D.x - D.r * 1.2))), i1 = Math.min(TW - 1, Math.ceil(toI(D.x + D.r * 1.2)));
      const j0 = Math.max(0, Math.floor(toJ(D.y - D.r * 1.2))), j1 = Math.min(TH - 1, Math.ceil(toJ(D.y + D.r * 1.2)));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = X(i) - D.x, dy = Y(j) - D.y, a = Math.atan2(dy, dx);
        const r = D.r * (1 + 0.1 * Math.sin(3 * a + D.x * 40) + 0.06 * noise2(a * 2.5, D.y * 30, 17));
        const q = (dx * dx + dy * dy) / (r * r);
        if (q < 1) { const k = j * TW + i; G[k] = Math.max(G[k], D.d * w * Math.pow(1 - q, 0.8)); }
      }
      pecks(D.x, D.y, D.r * 0.95, Math.round((Math.PI * D.r * D.r) / 6e-6), w);
    }

    // Lichen crusts: pale grey-green rosettes, a yellow-green map lichen with a black rim, and specks.
    const LA = new Float32Array(N), LT = new Float32Array(N * 3);
    const PALE = [1.62, 1.68, 1.5], OLD = [1.32, 1.34, 1.26], MAP = [1.5, 1.56, 0.78], RIM = [0.5, 0.5, 0.48];
    const patch = (cx, cy, r, map, ph) => {
      const i0 = Math.max(0, Math.floor(toI(cx - r * 1.4))), i1 = Math.min(TW - 1, Math.ceil(toI(cx + r * 1.4)));
      const j0 = Math.max(0, Math.floor(toJ(cy - r * 1.4))), j1 = Math.min(TH - 1, Math.ceil(toJ(cy + r * 1.4)));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = X(i) - cx, dy = Y(j) - cy, a = Math.atan2(dy, dx);
        const e = Math.sqrt(dx * dx + dy * dy) / (r * (1 + 0.06 * Math.sin(3 * a + ph) + 0.28 * fbm2(dx / r * 1.6 + ph * 3, dy / r * 1.6, 3, 23)));
        const c = 1 - smoothstep(0.86, 1, e);
        const k = j * TW + i;
        if (c <= LA[k]) continue;
        // Areoles: a crust broken into little plates.
        const grain = 0.86 + 0.14 * noise2(X(i) * 420, Y(j) * 420, 29);
        let t;
        if (map) t = e > 0.8 ? RIM : MAP;
        else t = e < 0.45 ? OLD.map((v, q) => v + (PALE[q] - v) * smoothstep(0.2, 0.45, e)) : PALE;
        LA[k] = c * (map ? 0.95 : 0.88);
        LT[k * 3] = t[0] * grain; LT[k * 3 + 1] = t[1] * grain; LT[k * 3 + 2] = t[2] * grain;
      }
    };
    patch(-0.172, -0.02, 0.042, false, 1.1);    // over the stack's left side
    patch(-0.205, -0.262, 0.05, false, 2.3);
    patch(0.188, 0.165, 0.024, false, 0.4);
    patch(-0.085, 0.335, 0.017, false, 3.7);
    patch(0.176, -0.29, 0.03, true, 5.2);       // against the first stop's corner
    // Specks, kept off the drawing (on it they'd read as marks).
    const bare = (x, y, r) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].every(([u, v]) => {
      const i = Math.round(toI(x + u * r)), j = Math.round(toJ(y + v * r));
      return i < 0 || j < 0 || i >= TW || j >= TH || G[j * TW + i] === 0;
    });
    for (let k = 0; k < 16; k++) {
      const x = rng.float(-0.24, 0.24), y = rng.float(-0.38, 0.38), r = rng.float(0.003, 0.009), map = rng.next() < 0.15, ph = rng.float(0, 6);
      if (bare(x, y, r + 0.012)) patch(x, y, r, map, ph);
    }

    // Pixels: the groove's cover and tint (pecked stone is lighter, a little warm, and a touch darker deep down), then
    // lichen over it; the height for the normals (lichen half fills the grooves and stands a little proud).
    const carve = new Uint8Array(N * 4), normal = new Uint8Array(N * 4), h = new Float32Array(N);
    for (let j = 0; j < TH; j++) {
      const y = Y(j);
      for (let i = 0; i < TW; i++) {
        const k = j * TW + i, o = k * 4, g = G[k], la = LA[k];
        // Bare rock: no cover, a tint of 1 (so filtering at the edges blends toward the rock's own colour), flat.
        if (g === 0 && la === 0) { carve[o] = carve[o + 1] = carve[o + 2] = 128; continue; }
        const x = X(i);
        const cover = smoothstep(0.00015, 0.0009, g);
        const fresh = g > 0 ? wear(x, y) * (0.55 + 0.15 * noise2(x * 60, y * 60, 7)) * (0.6 + 0.4 * smoothstep(0.0004, 0.003, g)) : 0;
        const deep = 1 - 0.1 * smoothstep(0.001, 0.005, g);
        let r = (1 + fresh * 1.06) * deep, gg = (1 + fresh) * deep, b = (1 + fresh * 0.86) * deep;
        r += (LT[k * 3] - r) * la; gg += (LT[k * 3 + 1] - gg) * la; b += (LT[k * 3 + 2] - b) * la;
        const edge = smoothstep(0, 0.02, Math.min(W / 2 - Math.abs(x), H / 2 - Math.abs(y)));
        carve[o] = clamp((r / 2) * 255 + 0.5, 0, 255);
        carve[o + 1] = clamp((gg / 2) * 255 + 0.5, 0, 255);
        carve[o + 2] = clamp((b / 2) * 255 + 0.5, 0, 255);
        carve[o + 3] = clamp(Math.max(cover, la) * edge * 255 + 0.5, 0, 255);
        h[k] = -g * (1 - 0.55 * la) + (la > 0 ? la * 0.0005 * (0.6 + 0.4 * noise2(x * 300, y * 300, 31)) : 0);
      }
    }
    const S = 1 / (2 * PX);   // slope (m per m) from central differences
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = j * TW + i;
      const nx = -(h[j * TW + Math.min(TW - 1, i + 1)] - h[j * TW + Math.max(0, i - 1)]) * S;
      const ny = -(h[Math.min(TH - 1, j + 1) * TW + i] - h[Math.max(0, j - 1) * TW + i]) * S;
      const l = Math.sqrt(nx * nx + ny * ny + 1), o = k * 4;
      normal[o] = (nx / l * 0.5 + 0.5) * 255 + 0.5; normal[o + 1] = (ny / l * 0.5 + 0.5) * 255 + 0.5; normal[o + 2] = (1 / l * 0.5 + 0.5) * 255 + 0.5; normal[o + 3] = 255;
    }
    const tex = (data) => {
      const t = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    };
    return { carve: tex(carve), normal: tex(normal) };
  });
}

// ------------------------------------------------------------------------------------------------ geometry
const _t = new THREE.Triangle(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function triangles(geo, fn) {
  const P = geo.attributes.position, I = geo.index ? geo.index.array : null, n = I ? I.length : P.count;
  for (let t = 0; t < n; t += 3) {
    const i0 = I ? I[t] : t, i1 = I ? I[t + 1] : t + 1, i2 = I ? I[t + 2] : t + 2;
    _a.fromBufferAttribute(P, i0); _b.fromBufferAttribute(P, i1); _c.fromBufferAttribute(P, i2);
    fn(i0, i1, i2);
  }
}

// First hit of a ray on one geometry (front faces), or null.
function cast(geo, o, d) {
  const ray = new THREE.Ray(o, d), hit = new THREE.Vector3();
  let best = null;
  triangles(geo, () => {
    if (ray.intersectTriangle(_a, _b, _c, true, hit)) { const t = hit.distanceTo(o); if (!best || t < best.t) best = { t, p: hit.clone() }; }
  });
  return best;
}

// Sutherland-Hodgman against one side of the box; vertices are [x, y, z, attributes...] and interpolate linearly.
function clip(poly, axis, s, lim) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], da = a[axis] * s - lim, db = b[axis] * s - lim;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push(a.map((v, q) => v + (b[q] - v) * t)); }
  }
  return out;
}

// The rock's triangles facing the box's normal, clipped to the box (frame c; R across, U up, N out of the face).
function decal(geo, c, R, U, N) {
  const P = geo.attributes.position.array, NN = geo.attributes.normal.array, T = geo.attributes.uv.array, C = geo.attributes.color.array;
  const pos = [], nor = [], uv = [], uv1 = [], col = [];
  const v = (i) => {
    const dx = P[i * 3] - c.x, dy = P[i * 3 + 1] - c.y, dz = P[i * 3 + 2] - c.z;
    return [dx * R.x + dy * R.y + dz * R.z, dx * U.x + dy * U.y + dz * U.z, dx * N.x + dy * N.y + dz * N.z,
      NN[i * 3], NN[i * 3 + 1], NN[i * 3 + 2], T[i * 2], T[i * 2 + 1], C[i * 3], C[i * 3 + 1], C[i * 3 + 2]];
  };
  const lim = [W / 2, H / 2, DEPTH];
  triangles(geo, (i0, i1, i2) => {
    let poly = [v(i0), v(i1), v(i2)];
    for (let ax = 0; ax < 3; ax++) {
      if (poly.every((p) => p[ax] > lim[ax]) || poly.every((p) => p[ax] < -lim[ax])) return;
    }
    // Facing the projector (the local face normal's z); side and back faces would smear.
    const [a, b, cc] = poly;
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = cc[0] - a[0], e2y = cc[1] - a[1], e2z = cc[2] - a[2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    if (fz < 0.3 * Math.hypot(fx, fy, fz)) return;
    for (let ax = 0; ax < 3 && poly.length >= 3; ax++) { poly = clip(poly, ax, 1, lim[ax]); if (poly.length >= 3) poly = clip(poly, ax, -1, lim[ax]); }
    if (poly.length < 3) return;
    const put = (p) => {
      pos.push(R.x * p[0] + U.x * p[1] + N.x * p[2], R.y * p[0] + U.y * p[1] + N.y * p[2], R.z * p[0] + U.z * p[1] + N.z * p[2]);
      const l = Math.hypot(p[3], p[4], p[5]) || 1;
      nor.push(p[3] / l, p[4] / l, p[5] / l);
      uv.push(p[6], p[7]);
      uv1.push(p[0] / W + 0.5, p[1] / H + 0.5);
      col.push(p[8], p[9], p[10]);
    };
    for (let k = 1; k < poly.length - 1; k++) { put(poly[0]); put(poly[k]); put(poly[k + 1]); }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// The box's frame on a face: N out of it, U = world up projected onto it, R across (right as you face it).
function frame(n) {
  const N = n.clone().normalize();
  const U = new THREE.Vector3(0, 1, 0).addScaledVector(N, -N.y).normalize();
  return { N, U, R: new THREE.Vector3().crossVectors(U, N) };
}

let glyphMat = null;
function petroglyphMaterial() {
  if (glyphMat) return glyphMat;
  const cliff = materials().cliff, { carve, normal } = petroglyphTextures();
  normal.channel = 1;   // on the decal's own uv (uv1); the rock's texture stays on the rock's uv
  const m = patchMaterial(new THREE.MeshStandardMaterial({
    name: 'petroglyph', vertexColors: true, map: cliff.map, normalMap: normal, roughness: cliff.roughness, envMapIntensity: cliff.envMapIntensity,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  }));
  const uCarve = { value: carve }, patch = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    patch(sh, r);
    sh.uniforms.uCarve = uCarve;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCarve;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec4 pg = texture2D( uCarve, vNormalMapUv );
          diffuseColor.rgb *= pg.rgb * 2.0;
          diffuseColor.a *= pg.a; }`);
  };
  m.customProgramCacheKey = () => key() + '|glyph';
  m.userData.carve = carve;
  return (glyphMat = m);
}

// Carves the petroglyph into whichever of `geos` (world-space rock geometry with normal, uv and colour, as batched for
// the Rocks piles) is nearest `at`, facing roughly `normal`, centred `lift` metres up the face from there. Returns the
// mesh (in ctx.surface, faded out at 28-38 m), or null if the face isn't there.
export function carvePetroglyph(ctx, { geos, at, normal, lift = 0, name = 'petroglyph' }) {
  // The stone: the nearest to `at`.
  let stone = null, best = Infinity;
  for (const g of geos) triangles(g, () => {
    _t.set(_a, _b, _c).closestPointToPoint(at, _p);
    const d = _p.distanceToSquared(at);
    if (d < best) { best = d; stone = g; }
  });
  if (!stone) return null;
  // The centre: on the face, `lift` up it. Then the box's normal: the mean (by area) of the faces under the box, so
  // the curved face stretches the drawing as little as it can.
  let f = frame(normal);
  const onFace = (p) => cast(stone, p.clone().addScaledVector(f.N, DEPTH), f.N.clone().negate())?.p ?? null;
  const c = onFace(at.clone().addScaledVector(f.U, lift));
  if (!c) return null;
  for (let it = 0; it < 2; it++) {
    const sum = new THREE.Vector3(), fn = new THREE.Vector3(), m = new THREE.Vector3();
    triangles(stone, () => {
      m.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3).sub(c);
      if (Math.abs(m.dot(f.R)) > W / 2 || Math.abs(m.dot(f.U)) > H / 2 || Math.abs(m.dot(f.N)) > DEPTH) return;
      _t.set(_a, _b, _c).getNormal(fn);
      if (fn.dot(f.N) > 0.3) sum.addScaledVector(fn, _t.getArea());
    });
    if (sum.lengthSq() > 0) f = frame(sum);
  }
  const geo = decal(stone, c, f.R, f.U, f.N);
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, petroglyphMaterial());
  mesh.name = name;
  mesh.position.copy(c);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.userData.frame = { center: c.clone(), right: f.R.clone(), up: f.U.clone(), normal: f.N.clone(), width: W, height: H };
  ctx.surface.add(mesh);
  ctx.lod?.add(mesh, { out: [28, 38], name });
  return mesh;
}
