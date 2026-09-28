import { Rng } from '../core/rng.js';

// The moon's near-side map, made procedurally (render/moon.js turns it into a texture and draws the moon with it).
// No three.js here, so the worker that makes it (moonMap.worker.js) stays small.
//
// The map is the face the moon always turns to us, seen straight on: orthographic, north up, the disc filling
// [-1, 1] moon radii in both axes and a thin margin round it so the limb filters cleanly. 1024 x 1024 RGBA8:
//   R  albedo / 1.3: the familiar maria (Imbrium, Serenitatis, Tranquillitatis, Crisium, Procellarum, Nubium...) laid
//      out roughly where they are on the real moon, bright ray craters (a Tycho, a Copernicus, a Kepler, an Aristarchus)
//      and ~7000 smaller craters, crowded in the highlands and sparse on the maria
//   GB the height field's slope along the image's x and y (+-MOON_SLOPE), for per-pixel crater relief
//   A  the height (+-MOON_HMAX moon radii), for the crater shadows along the terminator in the eyepiece
// Heights are made on the sphere, so craters near the limb are foreshortened as they should be. About 0.3 s of script.

export const MOON_MAP_SIZE = 1024;
export const MOON_EXT = 1.03;          // the map spans [-EXT, EXT] moon radii
export const MOON_SLOPE = 1.2;         // the GB channels' range
export const MOON_HMAX = 0.012;        // the A channel's range (moon radii)

const N = MOON_MAP_SIZE;

// ---- fast hash value noise (0..1) ----
function h3(x, y, z, s) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x7feb352d) ^ Math.imul(s, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vn3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h3(ix, iy, iz, s), b = h3(ix + 1, iy, iz, s), c = h3(ix, iy + 1, iz, s), d = h3(ix + 1, iy + 1, iz, s);
  const e = h3(ix, iy, iz + 1, s), f = h3(ix + 1, iy, iz + 1, s), g = h3(ix, iy + 1, iz + 1, s), k = h3(ix + 1, iy + 1, iz + 1, s);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (k - g) * fx;
  const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}
function h2(x, y, s) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vn2(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx;
  return x0 + (x1 - x0) * fy;
}
// fbm, roughly -1..1 (value noise has little variance, so it is stretched).
function fbm(x, y, z, oct, s) {
  let sum = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * vn3(x, y, z, s + i); n += a; a *= 0.5;
    const t = x; x = x * 1.62 + y * 1.18 + 5.3; y = y * 1.62 - t * 1.18 + 1.7; z = z * 2.01 + 3.1;
  }
  return (sum / n - 0.5) * 3.2;
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Maria, in the map's coordinates (x right, y up, moon radii): centre, radii, rotation (deg), darkness.
const MARIA = [
  // Oceanus Procellarum, in pieces, and Insularum / Cognitum between it and Nubium.
  [-0.64, 0.28, 0.20, 0.30, 8, 0.85], [-0.68, -0.04, 0.18, 0.22, 0, 0.8], [-0.50, 0.52, 0.17, 0.12, -20, 0.85],
  [-0.50, -0.20, 0.13, 0.12, 0, 0.75], [-0.80, 0.50, 0.10, 0.14, 0, 0.75], [-0.25, 0.11, 0.12, 0.08, 10, 0.7],
  [-0.34, -0.14, 0.11, 0.09, 0, 0.7], [-0.40, 0.30, 0.14, 0.1, 0, 0.8],
  [-0.29, 0.47, 0.25, 0.19, -12, 1.0],     // Imbrium
  [-0.12, 0.80, 0.40, 0.05, 4, 0.8],       // Frigoris
  [0.26, 0.77, 0.24, 0.045, -10, 0.7],
  [0.17, 0.43, 0.15, 0.14, 0, 0.95],       // Serenitatis
  [0.37, 0.14, 0.19, 0.15, 18, 0.95],      // Tranquillitatis
  [0.26, 0.04, 0.11, 0.09, 0, 0.85],
  [0.73, 0.30, 0.085, 0.10, 0, 1.0],       // Crisium
  [0.60, -0.12, 0.10, 0.17, 12, 0.85],     // Fecunditatis
  [0.40, -0.27, 0.08, 0.08, 0, 0.85],      // Nectaris
  [0.05, 0.25, 0.075, 0.05, 0, 0.75],      // Vaporum
  [0.01, 0.03, 0.05, 0.04, 0, 0.5],        // Sinus Medii
  [-0.20, -0.37, 0.15, 0.11, 0, 0.8],      // Nubium
  [-0.56, -0.41, 0.08, 0.08, 0, 0.9],      // Humorum
  [0.93, 0.24, 0.05, 0.10, 0, 0.7],        // Marginis / Smythii, on the limb
  [0.95, -0.03, 0.035, 0.09, 0, 0.6],
  [0.70, -0.66, 0.08, 0.05, 30, 0.5],      // Australe, patchy
].map(([x, y, rx, ry, rot, k]) => ({ x, y, rx, ry, r: Math.min(rx, ry), c: Math.cos(rot * Math.PI / 180), s: Math.sin(rot * Math.PI / 180), k }));

// Named craters: map x, y, radius (moon radii), fresh (bright floor and halo), rays (strength), ray length (radii),
// dark floor (lava-flooded, Plato / Grimaldi style).
const NAMED = [
  [-0.13, -0.70, 0.026, 1.0, 1.0, 24, 0],   // Tycho
  [-0.33, 0.17, 0.030, 0.9, 0.8, 15, 0],    // Copernicus
  [-0.62, 0.14, 0.017, 1.0, 0.6, 12, 0],    // Kepler
  [-0.71, 0.40, 0.012, 1.8, 0.45, 9, 0],    // Aristarchus, the brightest spot
  [0.66, 0.28, 0.010, 1.0, 0.5, 14, 0],     // Proclus
  [0.84, -0.16, 0.034, 0.5, 0.25, 6, 0],    // Langrenus
  [0.34, -0.46, 0.028, 0.4, 0.15, 5, 0],    // Theophilus
  [-0.17, -0.88, 0.064, 0, 0, 0, 0],        // Clavius
  [-0.05, -0.15, 0.042, 0, 0, 0, 0.35],     // Ptolemaeus
  [-0.02, -0.28, 0.034, 0, 0, 0, 0],        // Alphonsus
  [-0.09, 0.80, 0.028, 0, 0, 0, 1],         // Plato
  [-0.93, -0.10, 0.046, 0, 0, 0, 1],        // Grimaldi
  [0.06, -0.42, 0.030, 0.1, 0, 0, 0],       // Albategnius
  [-0.43, -0.62, 0.036, 0, 0, 0, 0.3],
  [0.18, -0.62, 0.032, 0, 0, 0, 0],
  [0.47, 0.60, 0.024, 0.2, 0, 0, 0],
];

// The map, made in steps: a generator that yields (a phase name) every few milliseconds; returns the RGBA bytes.
export function* moonMapSteps() {
  const T = 2 * MOON_EXT / N;   // texel size, moon radii
  const XS = new Float32Array(N);
  for (let i = 0; i < N; i++) XS[i] = ((i + 0.5) / N * 2 - 1) * MOON_EXT;
  const toI = (x) => (x / MOON_EXT + 1) / 2 * N - 0.5;
  const BUDGET = 150000;   // texel visits between pauses
  let work = 0;

  // ---- coarse fields (L x L, bilinearly upsampled): a first maria mask (for the craters), the albedos, the warp ----
  const L = 160;
  const maria = new Float32Array(L * L), high = new Float32Array(L * L), mare = new Float32Array(L * L);
  const warpX = new Float32Array(L * L), warpY = new Float32Array(L * L), edgeC = new Float32Array(L * L);
  const coarseRow = (j) => {
    for (let i = 0; i < L; i++) {
      let x = ((i + 0.5) / L * 2 - 1) * MOON_EXT, y = ((j + 0.5) / L * 2 - 1) * MOON_EXT;
      const r = Math.hypot(x, y);
      if (r > 0.998) { x *= 0.998 / r; y *= 0.998 / r; }
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      // Domain warp for the large shapes, and a ragged edge.
      const wx = x + fbm(x * 1.9, y * 1.9, z * 1.9, 3, 3) * 0.05, wy = y + fbm(x * 1.9 + 7, y * 1.9, z * 1.9, 3, 5) * 0.05;
      const edge = fbm(x * 4.5, y * 4.5, z * 4.5, 3, 11) * 0.035 + fbm(x * 13, y * 13, z * 13, 2, 17) * 0.016;
      let keep = 1;
      for (const b of MARIA) {
        const dx = wx - b.x, dy = wy - b.y;
        const u = (dx * b.c + dy * b.s) / b.rx, v = (-dx * b.s + dy * b.c) / b.ry;
        const e = (Math.sqrt(u * u + v * v) - 1) * b.r + edge;   // ~distance past the edge, moon radii
        if (e < 0.02) keep *= 1 - smooth(0.014, -0.014, e) * b.k;
      }
      const m = Math.min(1, 1 - keep);
      // Highlands: bright, mottled. Maria: lava flows of different ages, lighter and darker patches.
      const hl = 0.8 + fbm(x * 4, y * 4, z * 4, 4, 23) * 0.09 + fbm(x * 11, y * 11, z * 11, 2, 29) * 0.04;
      const mr = 0.46 + fbm(x * 3.5 + 9, y * 3.5, z * 3.5, 3, 37) * 0.09 + fbm(x * 9, y * 9 + 4, z * 9, 2, 41) * 0.045;
      const k = j * L + i;
      maria[k] = m;
      high[k] = hl;
      mare[k] = mr;
      warpX[k] = wx - x; warpY[k] = wy - y; edgeC[k] = edge;
    }
  };
  for (let j = 0; j < L; j++) { coarseRow(j); if ((j & 7) === 7) yield 'coarse'; }
  // Bilinear upsampling, by table.
  const bi = new Int32Array(N), bf = new Float32Array(N);
  for (let i = 0; i < N; i++) { const u = Math.min(L - 1.001, Math.max(0, (i + 0.5) / N * L - 0.5)); bi[i] = u | 0; bf[i] = u - bi[i]; }
  const sample = (f, i, j) => {
    const k = bi[j] * L + bi[i], fu = bf[i];
    const a = f[k] + (f[k + 1] - f[k]) * fu, b = f[k + L] + (f[k + L + 1] - f[k + L]) * fu;
    return a + (b - a) * bf[j];
  };
  const clampI = (v) => Math.max(0, Math.min(N - 1, Math.round(v)));
  const mariaAt = (x, y) => sample(maria, clampI(toI(x)), clampI(toI(y)));

  // ---- the maria at full resolution: each stamped over its box on the warped coordinates, with crisp, ragged edges ----
  const WX = new Float32Array(N * N), WY = new Float32Array(N * N), EG = new Float32Array(N * N);
  const up = (f, row, kr, fv) => { for (let u = 0; u < L; u++) row[u] = f[kr + u] + (f[kr + L + u] - f[kr + u]) * fv; };
  const rX = new Float32Array(L), rY = new Float32Array(L), rE = new Float32Array(L);
  const upRows = (ja, jb) => {
    for (let j = ja; j < jb; j++) {
      const kr = bi[j] * L, fv = bf[j];
      up(warpX, rX, kr, fv); up(warpY, rY, kr, fv); up(edgeC, rE, kr, fv);
      for (let i = 0; i < N; i++) {
        const u = bi[i], fu = bf[i], k = j * N + i;
        WX[k] = XS[i] + rX[u] + (rX[u + 1] - rX[u]) * fu;
        WY[k] = XS[j] + rY[u] + (rY[u + 1] - rY[u]) * fu;
        EG[k] = rE[u] + (rE[u + 1] - rE[u]) * fu + (vn2(i * 0.09, j * 0.09, 3) - 0.5) * 0.008 + (vn2(i * 0.3, j * 0.3, 4) - 0.5) * 0.002;
      }
    }
  };
  for (let j = 0; j < N; j += 128) { upRows(j, j + 128); yield 'maria'; }
  const MM = new Float32Array(N * N);   // the maria's darkness, 0..1 (the darkest where they overlap)
  const stampMare = (b) => {
    const ext = Math.max(b.rx, b.ry) + 0.15;   // the warp and the ragged edge reach beyond the ellipse
    const i0 = Math.max(0, Math.floor(toI(b.x - ext))), i1 = Math.min(N - 1, Math.ceil(toI(b.x + ext)));
    const j0 = Math.max(0, Math.floor(toI(b.y - ext))), j1 = Math.min(N - 1, Math.ceil(toI(b.y + ext)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i, dx = WX[k] - b.x, dy = WY[k] - b.y;
      const u = (dx * b.c + dy * b.s) / b.rx, v = (-dx * b.s + dy * b.c) / b.ry;
      const e = (Math.sqrt(u * u + v * v) - 1) * b.r + EG[k];
      if (e < 0.016) { const m = smooth(0.016, -0.016, e) * b.k; if (m > MM[k]) MM[k] = m; }
    }
  };
  for (const b of MARIA) { stampMare(b); yield 'maria'; }

  // ---- craters ----
  const Z = new Float32Array(N * N);   // the sphere's z per texel, -1 outside the disc
  const zRows = (ja, jb) => {
    for (let j = ja; j < jb; j++) for (let i = 0; i < N; i++) { const r2 = XS[i] * XS[i] + XS[j] * XS[j]; Z[j * N + i] = r2 < 1 ? Math.sqrt(1 - r2) : -1; }
  };
  for (let j = 0; j < N; j += 256) { zRows(j, j + 256); yield 'craters'; }
  const H = new Float32Array(N * N);          // height, moon radii
  const AM = new Float32Array(N * N).fill(1); // albedo multiplier (crater floors, dark floors)
  const AB = new Float32Array(N * N);         // albedo added (fresh craters, rays)
  const rng = new Rng(20260927);

  // One crater at map (cx, cy), radius R (moon radii along the surface). age: 0 fresh .. 1 worn down; tone: albedo
  // change of its floor and walls; dark: a lava-flooded floor. Returns its rows' span and a function that stamps rows
  // [ja, jb) and returns the texels visited (plain functions: V8 optimises hot loops in generators poorly).
  function crater({ cx, cy, R, fresh = 0, rays = 0, rayLen = 0, dark = 0, age = 0, tone = 0, seed = 0 }) {
    const cz = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
    const big = R > 0.022;
    const D = R * (big ? 0.13 : R > 0.01 ? 0.2 : 0.25) * (1 - 0.7 * age);   // depth
    const Hr = D * (0.32 - 0.15 * age);                                     // rim height
    const DH = D + Hr, peak = big ? D * 0.5 : 0, wIn = 0.92 - 0.3 * age;
    const reachS = Math.max(rays > 0 ? rayLen : 0, fresh > 0 ? 3.2 : 1.9);
    const haloK = rays > 0 ? 0.9 : 1.5;
    // Out of round: a little lopsided and elliptical.
    const a1 = rng.float(-0.07, 0.07), b1 = rng.float(-0.07, 0.07), a2 = rng.float(-0.06, 0.06), b2 = rng.float(-0.06, 0.06);
    // Rays: broad streaks of brightness round the crater, each with its own direction, width, length and patchiness,
    // starting beyond a continuous bright blanket.
    const A = 1024;
    let rayB = null, rayL = null, rayP = null, e1x = 0, e1z = 0, e2x = 0, e2y = 0, e2z = 0;
    if (rays > 0) {
      const rr = new Rng(seed * 7919 + 13);
      rayB = new Float32Array(A); rayL = new Float32Array(A); rayP = new Float32Array(A);
      const n = 14 + rr.int(0, 10);
      for (let q = 0; q < n; q++) {
        const th = rr.float(0, Math.PI * 2), w = rr.float(0.03, 0.13), len = rayLen * rr.float(0.3, 1), b = rr.float(0.35, 1), ph = rr.float(0, 6.28);
        for (let a = 0; a < A; a++) {
          let d = (a / A) * Math.PI * 2 - th;
          d = Math.atan2(Math.sin(d), Math.cos(d)) / w;
          if (d * d > 9) continue;
          const v = b * Math.exp(-d * d);
          if (v > rayB[a]) { rayB[a] = v; rayL[a] = len; rayP[a] = ph; }
        }
      }
      // A tangent frame at the crater, for the angle round it.
      const l1 = Math.hypot(cz, cx) || 1;
      e1x = cz / l1; e1z = -cx / l1;
      e2x = cy * e1z; e2y = cz * e1x - cx * e1z; e2z = -cy * e1x;
    }
    const reach = R * reachS * 1.02, reach2 = reach * reach, invR = 1 / R;
    const j0 = Math.max(1, Math.floor(toI(cy - reach))), j1 = Math.min(N - 2, Math.ceil(toI(cy + reach)));
    const rows = (ja, jb) => {
    let visited = 0;
    for (let j = ja; j < jb; j++) {
      const dy = XS[j] - cy, rem = reach2 - dy * dy;
      if (rem <= 0) continue;
      const wx = Math.sqrt(rem), row = j * N, dy2 = dy * dy;
      const i0 = Math.max(1, Math.floor(toI(cx - wx))), i1 = Math.min(N - 2, Math.ceil(toI(cx + wx)));
      for (let i = i0; i <= i1; i++) {
        const k = row + i, z = Z[k];
        if (z < 0) continue;
        const dx = XS[i] - cx, dz = z - cz;
        const d2 = dx * dx + dy2 + dz * dz;
        if (d2 > reach2) continue;
        const d = Math.sqrt(d2) + 1e-9, ux = dx / d, uy = dy / d;
        const s = d * invR * (1 + a1 * ux + b1 * uy + a2 * (ux * ux - uy * uy) + b2 * 2 * ux * uy);
        if (s < 1.9) {
          let hc, w;
          if (s < 1) {
            let b = s;
            if (big) { b = (s - 0.25) / 0.75; b = b < 0 ? 0 : b * b * (3 - 2 * b); }
            hc = -D + DH * b * b;
            if (s < 0.35 && big) { const q = s * 8.3; hc += peak * Math.exp(-q * q); }   // central peak
            w = wIn;
            AM[k] *= 1 + tone;
            if (dark > 0 && s < 0.95) AM[k] *= 1 - dark * 0.45 * smooth(0.95, 0.7, s);
          } else {
            const t = 1 - (s - 1) / 0.9;
            hc = Hr * t * t;
            w = s < 1.25 ? wIn * (1 - (s - 1) * 4) : 0;
            if (s < 1.3) AM[k] *= 1 + tone * (1.3 - s) * 3.33;
          }
          H[k] = H[k] * (1 - w) + hc;
        }
        if (fresh > 0) AB[k] += fresh * 0.2 * (s < 0.8 ? 1 : Math.exp(-(s - 0.8) * haloK));
        if (rayB !== null && s > 1.2) {
          const ang = Math.atan2(dx * e2x + dy * e2y + dz * e2z, dx * e1x + dz * e1z);
          const ai = ((ang / (Math.PI * 2) + 1) * A | 0) % A;
          const len = rayL[ai];
          if (len > 0 && s < len) {
            const ph = rayP[ai];
            const patch = 0.55 + 0.25 * Math.sin(s * 0.7 + ph) + 0.2 * Math.sin(s * 1.9 + ph * 2.3);
            AB[k] += rays * 0.45 * rayB[ai] * Math.exp(-(s - 1) / (len * 0.4)) * smooth(len, len * 0.5, s) * patch * smooth(1.2, 3, s);
          }
        }
      }
      visited += i1 - i0 + 1;
    }
    return visited;
    };
    return { j0, j1, chunk: Math.max(1, Math.floor(BUDGET / (reach / T * 2 + 1))), rows };
  }
  function* stamp(c) {
    const { j0, j1, chunk, rows } = crater(c);
    for (let j = j0; j <= j1; j += chunk) {
      work += rows(j, Math.min(j1 + 1, j + chunk)) + 40;
      if (work > BUDGET) { work = 0; yield 'craters'; }
    }
  }

  // Random craters, biggest (and oldest) first so the young ones sit on top. Area-uniform on the visible hemisphere,
  // radii from a power law; few on the maria, which are younger.
  const list = [];
  const onDisc = () => { const zc = rng.next(), ph = rng.float(0, Math.PI * 2), rc = Math.sqrt(1 - zc * zc); return [rc * Math.cos(ph), rc * Math.sin(ph)]; };
  for (let n = 0; n < 8000; n++) {
    const R = Math.min(0.07, 0.0032 * Math.pow(1 - rng.next(), -1 / 1.75));
    const [cx, cy] = onDisc();
    const m = mariaAt(cx, cy);
    if (m > 0.3 && rng.next() > (R < 0.008 ? 0.45 : R < 0.02 ? 0.15 : 0.04) + (1 - m) * 0.5) continue;
    const fresh = rng.next() < (R < 0.01 ? 0.08 : 0.03) ? rng.float(0.4, 1) : 0;
    list.push({ cx, cy, R, fresh, age: fresh ? 0 : rng.next() * rng.next() * (R > 0.02 ? 1 : 0.8), tone: rng.float(-0.07, 0.05) * (1 - 0.5 * m), dark: m > 0.3 && rng.next() < 0.4 ? m * 0.5 : 0 });
  }
  // The old, worn highland craters that crowd each other there.
  for (let n = 0; n < 260; n++) {
    const R = Math.exp(rng.float(Math.log(0.016), Math.log(0.055)));
    const [cx, cy] = onDisc();
    if (mariaAt(cx, cy) > 0.25) continue;
    list.push({ cx, cy, R, age: rng.float(0.45, 1), tone: rng.float(-0.05, 0.03) });
  }
  const named = NAMED.map(([cx, cy, R, fresh, rays, rayLen, dark], k) => ({ cx, cy, R, fresh, rays, rayLen, dark, seed: k + 1, age: fresh ? 0 : 0.25, tone: fresh ? 0.04 : -0.03 }));
  // The old named craters (Clavius, Ptolemaeus...) go in with the random ones by size; the young ray craters last.
  const all = list.concat(named.filter((c) => !c.rays)).sort((a, b) => b.R - a.R);
  for (const c of all) yield* stamp(c);
  for (const c of named) if (c.rays) yield* stamp(c);

  // ---- assemble: albedo, slopes, height ----
  const out = new Uint8Array(N * N * 4);
  const rowH = new Float32Array(L), rowR = new Float32Array(L);
  const rows = (ja, jb) => {
    const inv2T = 1 / (2 * T), gs = 127.5 / MOON_SLOPE, hs = 127.5 / MOON_HMAX, as = 255 / 1.3;
    for (let j = ja; j < jb; j++) {
      // The coarse fields interpolated to this row, then along it.
      const kr = bi[j] * L, fv = bf[j];
      for (let u = 0; u < L; u++) {
        rowH[u] = high[kr + u] + (high[kr + L + u] - high[kr + u]) * fv;
        rowR[u] = mare[kr + u] + (mare[kr + L + u] - mare[kr + u]) * fv;
      }
      for (let i = 0; i < N; i++) {
        const k = j * N + i, o = k * 4, u = bi[i], fu = bf[i];
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const grain = 0.97 + 0.06 * ((seed >>> 8) / 16777216);   // regolith speckle
        const m = MM[k];
        const hl = rowH[u] + (rowH[u + 1] - rowH[u]) * fu, mr = rowR[u] + (rowR[u + 1] - rowR[u]) * fu;
        const b = (hl + (mr - hl) * m) * (1 + (vn2(i * 0.11, j * 0.11, 8) - 0.5) * 0.07 + (vn2(i * 0.35, j * 0.35, 9) - 0.5) * 0.05);
        let v = (b * AM[k] + AB[k] * (1 - 0.25 * m)) * grain * as;
        out[o] = v <= 0 ? 0 : v >= 255 ? 255 : v + 0.5;
        let gx = 0, gy = 0;
        if (Z[k] >= 0 && i > 0 && j > 0 && i < N - 1 && j < N - 1) {
          gx = (H[k + 1] - H[k - 1]) * inv2T;
          gy = (H[k + N] - H[k - N]) * inv2T;
        }
        v = gx * gs + 128; out[o + 1] = v <= 0 ? 0 : v >= 255 ? 255 : v;
        v = gy * gs + 128; out[o + 2] = v <= 0 ? 0 : v >= 255 ? 255 : v;
        v = H[k] * hs + 128; out[o + 3] = v <= 0 ? 0 : v >= 255 ? 255 : v;
      }
    }
  };
  let seed = 0x9e3779b9;
  for (let j = 0; j < N; j += 64) { rows(j, j + 64); yield 'assemble'; }
  return out;
}

// All at once (tools, tests).
export function buildMoonData() {
  const g = moonMapSteps();
  let r;
  while (!(r = g.next()).done);
  return r.value;
}
