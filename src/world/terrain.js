import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { STACK_BOTTOM_Y, WALLS } from '../config.js';
import { fbm2, fbm3, noise2, noise3, makeAngularNoise, smoothstep, clamp } from '../core/rng.js';
import { materials } from '../render/materials.js';
import { stackWallMaterial } from '../render/wallMaterial.js';

const DEPTHS = [0, 0.5, 1.4, 2.8, 4.6, 7, 10, 14, 19, 25, 32, 41, 53, 68, 88, 115, 150, 195, 250, 320, 410, 520, 650, 800, 1000];

const GRASS = new THREE.Color(0.075, 0.1, 0.035);
const GRASS2 = new THREE.Color(0.11, 0.12, 0.045);
const DIRT = new THREE.Color(0.2, 0.15, 0.095);
const ROCKC = new THREE.Color(0.24, 0.22, 0.2);
const RIMC = new THREE.Color(0.13, 0.12, 0.105);    // weathered cap rim (WALLS.bake)
const SOIL = new THREE.Color(0.1, 0.078, 0.055);    // the soil lip at the brink
const RIMW = [0.6, 0.57, 0.52];                     // wall tone the top rows weather toward

// Seed offsets of the baked colour noise (WALLS.bake). fbm2 seeds octave i with seed + 17i, so each is kept off
// the residues mod 17 of the offsets already in use (0, 3, 4, 5, 7, 8, 17, 91) and of each other: a shared
// lattice would make the new term an echo of an old one.
const BAKE_SEED = { streak: 10, rimWidth: 29, ao: 13, outcrop: 14, turf: 15, warm: 16 };
// Seed offsets of the wall relief (WALLS.geo): residues 11 and 9 mod 17, which nothing above uses (fbm3/noise3 also
// hash differently from the 2D terms). Picked among the free residues by measurement: this pair gives every stack
// its added spread at 10 and 19 m and keeps the θ=0 seam window no steeper than the rest of the wall.
const GEO_SEED = { buttress: 28, gully: 60 };
// Seed offsets of the cap relief (WALLS.relief): residue 1 mod 17 (1 and 2 are the only residues left free above;
// one relief term per stack, so both may share one). Picked by measurement among 18 offsets: hills and hollows both
// (not a one-way tilt or a lowered ring), added RMS >= 0.4 m on the cap, |r| < 0.2 against today's cap heights (Rocks
// -0.16, -0.23 once its creek floor holds the hollows by the water).
export const RELIEF_SEED = { dome: 69, rocks: 18 };

const TAU = Math.PI * 2;
// Wall relief (WALLS.geo), chosen by measurement: about 1.2-1.8 m RMS of added radius at full strength outside the
// protected arcs, outward peaks <= 2.2 m and inward <= 2.8 m (flare, collider box and Rocks-End gap stay within
// their gates). out/in/gully: m (or gain) per unit of noise; cap: the deepest cut; top: the set-back reached by
// 2.8 m (<= 0.8 m above 4 m), top2: what it adds by 4.6 m. Wavelengths are the larger of metres and column spacings
// (2.41 m Dome/Tower, 1.43-1.81 m the others), so the narrowest gully is still 4 columns wide.
const GEO = { out: 2.2, in: 4, gully: 2.5, cap: 2.8, top: 0.8, top2: 0.5, lobe: [30, 14], groove: [14, 7] };
// Depth (m) down to which the wall must not lean in: a slow walk-off slides down the face under the controller
// until 9 m below the rim, and a face that recedes below a bulge brings the eye against the rock (one that juts out
// makes a shelf). Above it the relief is a set-back complete by 4.6 m; buttresses and deeper cuts start here.
const SLIDE = 10;
// Arc (m) of the θ=0 seam cross-fade (WALLS.geo) and of the outward ramp round each calm zone (WALLS.calmSmooth).
const SEAM_ARC = 35;
const CALM_RAMP = 16;

// Outward-only smoothing of a stepped cliffCalm (WALLS.calmSmooth). Inside a calm zone it is today's factor exactly;
// outside, the factor climbs from the zone's value at its edge back to the free value over CALM_RAMP m of arc, so
// the zone's edge no longer steps the wall from one column to the next (Dome 1.2/2.1 m, Tower 2.4 m). The edge is
// found by a scan and a bisection, so any stepped calm function works.
function smoothCalm(calm, r) {
  const W = CALM_RAMP / r, N = 16;
  return (th, depth) => {
    const c0 = calm(th, depth);
    let best = c0;
    for (const sg of [-1, 1]) {
      for (let k = 1; k <= N; k++) {
        const c = calm(th + sg * k * W / N, depth);
        if (!(c < c0)) continue;
        let lo = (k - 1) * W / N, hi = k * W / N;   // the zone's edge lies in (lo, hi]
        for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (calm(th + sg * m, depth) < c0) hi = m; else lo = m; }
        best = Math.min(best, c + (c0 - c) * smoothstep(0, W, hi));
        break;
      }
    }
    return best;
  };
}

// Rolling ground on a cap (WALLS.relief), pushed as the stack's first shapeFn: 3 octaves of fbm2 at `freq` per metre
// times `amp`, rises scaled by `rise` (softer hills than hollows), faded in by smoothstep(6, 14, inside) and by the
// stack's `mask(x, z)`, hollows held above an optional `floor(x, z)` -> { y, w }. Where the fade or the mask is 0 it
// returns h untouched, so the rim ring, the lip and everything a stack keeps exact see today's ground to the bit.
// The fn (with its `weight` and `value`, before the floor) is kept as stack.reliefFn for tools.
export function capRelief(stack, { freq, amp, rise = 1, seed, mask, floor }) {
  const weight = (x, z, inside) => { const m = smoothstep(6, 14, inside); return m > 0 ? m * mask(x, z) : 0; };
  const value = (x, z) => { const n = fbm2(x * freq, z * freq, 3, stack.seed + seed) * amp; return n > 0 ? n * rise : n; };
  const fn = (x, z, h, c) => {
    const k = weight(x, z, c.inside);
    if (!(k > 0)) return h;
    let a = value(x, z) * k;
    // A hollow saturates smoothly above the floor's height y (never below it, never raising h), blended back to the
    // free hollow as the floor's weight w falls to 0.
    if (a < 0 && floor) {
      const f = floor(x, z);
      if (f.w > 0) {
        const room = h - f.y, held = room > 0 ? -room * (1 - Math.exp(a / room)) : 0;
        a += (held - a) * f.w;
      }
    }
    return h + a;
  };
  fn.weight = weight; fn.value = value;
  stack.reliefFn = fn;
  return fn;
}

// Weight of one protected arc at (theta, depth): 1 over [from, to] (any wrap) down to `depth`, 0 once `feather` m
// of arc beside it or of depth below it.
function arcWeight(z, r, theta, depth) {
  const span = ((z.to - z.from) % TAU + TAU) % TAU, u = ((theta - z.from) % TAU + TAU) % TAU;
  const f = z.feather ?? 10;
  const off = u <= span ? 0 : Math.min(u - span, TAU - u) * r;
  const a = off > 0 ? 1 - smoothstep(0, f, off) : 1;
  const d = depth <= (z.depth ?? Infinity) ? 1 : 1 - smoothstep(z.depth, z.depth + f, depth);
  return a * d;
}

// Distance along the level ray from the axis (dx, dz) at height y to where it crosses triangle v0 v1 v2 of the
// axis-relative positions P, or -1: the plane cuts the triangle in a segment, then a 2D ray/segment test.
function rayCut(P, v0, v1, v2, y, dx, dz) {
  let k = 0, qx = 0, qz = 0, ex = 0, ez = 0;
  for (let e = 0; e < 3; e++) {
    const s = e === 0 ? v0 : e === 1 ? v1 : v2, t = e === 0 ? v1 : e === 1 ? v2 : v0;
    const ys = P[s * 3 + 1], yt = P[t * 3 + 1];
    if ((ys > y) === (yt > y)) continue;
    const f = (y - ys) / (yt - ys);
    const x = P[s * 3] + (P[t * 3] - P[s * 3]) * f, z = P[s * 3 + 2] + (P[t * 3 + 2] - P[s * 3 + 2]) * f;
    if (k++ === 0) { qx = x; qz = z; } else { ex = x - qx; ez = z - qz; }
  }
  const den = dx * ez - dz * ex;
  if (k < 2 || den === 0) return -1;
  const t = (qx * dz - qz * dx) / den, s = (qx * ez - qz * ex) / den;
  return t >= -1e-3 && t <= 1 + 1e-3 && s > 0 ? s : -1;   // a hair of slack: float32 vertices sit off the column angle
}

// Cap rim band (WALLS.bake): a darker, browner edge of noisy width, heavier on outcrops, with the turf reaching
// the brink in patches. Replaces the even 3.5 m grey ring that outlined every cap.
function rimBand(c, x, z, inside, width, seed) {
  const outcrop = fbm2(x * 0.08, z * 0.08, 3, seed + BAKE_SEED.outcrop) * 0.5 + 0.5;
  const turf = smoothstep(0.56, 0.68, fbm2(x * 0.05, z * 0.05, 2, seed + BAKE_SEED.turf) * 0.5 + 0.5);
  c.lerp(RIMC, (1 - smoothstep(0, width, inside)) * (0.35 + 0.5 * smoothstep(0.35, 0.65, outcrop)) * (1 - turf));
}

// Wall vertex colours (WALLS.bake): world-space AO, mesh cavity, a weathered top that meets the cap rim, a shadow
// band under the lip and dark streaks below the rim's low points, rescaled to today's mean over the visible wall
// (brightening is the wall shader's job). Everything comes from world position or per-column data, so column segs
// matches column 0. Rows below 14 m are 5-35 m apart, so the AO and cavity are low-passed across rows there: no
// vertex-colour feature is smaller than two rows (finer detail belongs in the shader).
function bakeCliffColors(st, P, legacy, rows, edgeRow) {
  const segs = st.segs, W = segs + 1, n = rows.length, seed = st.seed;
  const rr = (i) => Math.hypot(P[i * 3] - st.cx, P[i * 3 + 2] - st.cz);
  // Streaks: rain runs over the rim where it dips below its surroundings (±12 m of arc) and stains the wall.
  const arcStep = (Math.PI * 2 * st.r) / segs;
  const win = Math.max(2, Math.round(12 / arcStep));
  const ey = edgeRow.map((e) => e[1]);
  const low = ey.map((y, j) => {
    let s = 0;
    for (let k = -win; k <= win; k++) s += ey[(j + k + segs) % segs];
    return s / (2 * win + 1) - y;
  });
  const q = [...low].sort((a, b) => a - b);
  // hi > lo keeps smoothstep off 0/0 (NaN) if a flattened rim makes the percentiles tie.
  const lo = q[Math.floor(segs * 0.65)], hi = Math.max(q[Math.floor(segs * 0.92)], lo + 0.01);
  const sig = Math.max(1, 2.5 / arcStep), reach = Math.ceil(sig * 2);   // >= 3 columns wide
  const streak = low.map((_, j) => {
    let s = 0, w = 0;
    for (let k = -reach; k <= reach; k++) {
      const wk = Math.exp(-(k * k) / (2 * sig * sig));
      s += wk * smoothstep(lo, hi, low[(j + k + segs) % segs]); w += wk;
    }
    return s / w;
  });
  const len = edgeRow.map(([x, , z]) => 30 + 90 * (noise2(x * 0.05, z * 0.05, seed + BAKE_SEED.streak) * 0.5 + 0.5));
  const outcrop = edgeRow.map(([x, , z]) => fbm2(x * 0.08, z * 0.08, 3, seed + BAKE_SEED.outcrop) * 0.5 + 0.5);

  const det = new Float64Array(n * W);
  for (let ri = 0; ri < n; ri++) for (let j = 0; j <= segs; j++) {
    const i = ri * W + j, jj = j % segs, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const ao = 0.78 + fbm2(x * 0.05 + y * 0.013, z * 0.05 - y * 0.011, 3, seed + BAKE_SEED.ao) * 0.3;
    const nb = (k) => rr(ri * W + (jj + k + segs) % segs);
    const cav = rr(i) - (nb(-2) + nb(-1) + nb(1) + nb(2)) / 4;   // bays darker, ribs lighter
    det[i] = ao * clamp(1 + 0.10 * cav, 0.72, 1.10);
  }
  const sm = Float64Array.from(det);
  for (let ri = 1; ri < n - 1; ri++) if (rows[ri + 1] - rows[ri - 1] > 10) {
    for (let j = 0; j <= segs; j++) { const i = ri * W + j; sm[i] = (det[i - W] + 2 * det[i] + det[i + W]) / 4; }
  }

  const out = new Array(n * W * 3);
  let sumNew = 0, sumOld = 0;
  const lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
  for (let ri = 0; ri < n; ri++) for (let j = 0; j <= segs; j++) {
    const i = ri * W + j, jj = j % segs, d = rows[ri], x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const deep = 1 - smoothstep(0, 400, d) * 0.55;
    const warm = 0.9 + noise2(x * 0.045 + y * 0.01, z * 0.045 - y * 0.012, seed + BAKE_SEED.warm) * 0.12;
    const k = sm[i] * deep * 0.52;
    let r = k * warm, g = k * 0.97, b = k * (1.0 - (warm - 0.9));
    // Weathered top: row 0 takes the rim tone (lighter on outcrops), gone by 4.6 m.
    const t = (1 - smoothstep(0, 4.6, d)) * 0.8, tone = 0.88 + 0.24 * outcrop[jj];
    r += (RIMW[0] * tone - r) * t; g += (RIMW[1] * tone - g) * t; b += (RIMW[2] * tone - b) * t;
    const lip = 1 - 0.25 * smoothstep(1.4, 2.8, d) * (1 - smoothstep(4.6, 10, d));
    const stain = 1 - 0.25 * streak[jj] * smoothstep(1.4, 4.6, d) * (1 - smoothstep(len[jj] * 0.35, len[jj], d));
    out[i * 3] = r * lip * stain; out[i * 3 + 1] = g * lip * stain; out[i * 3 + 2] = b * lip * stain;
    if (d <= 150) { sumNew += lum(out, i * 3); sumOld += lum(legacy, i * 3); }
  }
  const gain = sumOld / sumNew;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

// Rim crease normals (WALLS.bake). The duplicated θ=0 column is separate vertices, so computeVertexNormals leaves
// its two copies 44-96° apart: weld them in every row. Then round the cap/cliff join, today a 90° lighting crease:
// the cap edge and cliff row 0 (both θ=0 copies) share the half-way normal, the next ring and row lean toward it.
function creaseNormals(st, capN, cliffN, nRows) {
  const segs = st.segs, W = segs + 1, a = new THREE.Vector3(), b = new THREE.Vector3(), h = new THREE.Vector3();
  for (let ri = 0; ri < nRows; ri++) {
    a.fromArray(cliffN, ri * W * 3).add(b.fromArray(cliffN, (ri * W + segs) * 3)).normalize();
    a.toArray(cliffN, ri * W * 3); a.toArray(cliffN, (ri * W + segs) * 3);
  }
  const edge = st.rings * segs, inner = (st.rings - 1) * segs;
  for (let j = 0; j < segs; j++) {
    h.fromArray(capN, (edge + j) * 3).add(a.fromArray(cliffN, j * 3)).normalize();
    h.toArray(capN, (edge + j) * 3); h.toArray(cliffN, j * 3);
    a.fromArray(capN, (inner + j) * 3).lerp(h, 0.3).normalize().toArray(capN, (inner + j) * 3);
    a.fromArray(cliffN, (W + j) * 3).lerp(h, 0.35).normalize().toArray(cliffN, (W + j) * 3);
  }
  for (const ri of [0, 1]) for (let k = 0; k < 3; k++) cliffN[(ri * W + segs) * 3 + k] = cliffN[ri * W * 3 + k];
}

// One sea stack: a noisy cap heightfield joined to a tall cliff skirt that sinks below the clouds.
export class Stack {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.cx = cfg.x; this.cz = cfg.z; this.top = cfg.top; this.r = cfg.r;
    this.seed = cfg.seed;
    this.edgeNoise = makeAngularNoise(cfg.seed, 12, 2, 1.0);
    this.edgeAmp = opts.edgeAmp ?? 0.07;
    this.innerHole = opts.innerHole || 0;
    this.rings = opts.rings || Math.round(cfg.r / 1.15);
    this.segs = opts.segs || Math.round(cfg.r * 2.6);
    this.shapeFns = [];   // (x, z, h, ctx) => h
    this.colorFns = [];   // (x, z, h, color, ctx) => void
    this.cliffCalm = opts.cliffCalm ? (WALLS.calmSmooth ? smoothCalm(opts.cliffCalm, cfg.r) : opts.cliffCalm) : (() => 1);
    // Arcs the wall relief (WALLS.geo) keeps off: [{ from, to, depth, feather, inward }] (see protectAt).
    this.protect = opts.protect || [];
    this.group = new THREE.Group();
    this.group.name = 'stack:' + cfg.name;
  }

  edgeR(theta) { return this.r * (1 + this.edgeAmp * this.edgeNoise(theta)); }

  // Distance from the edge (positive inside).
  edgeDist(x, z) {
    const lx = x - this.cx, lz = z - this.cz;
    return this.edgeR(Math.atan2(lz, lx)) - Math.hypot(lx, lz);
  }

  heightAtAnalytic(x, z) {
    const lx = x - this.cx, lz = z - this.cz;
    const d = Math.hypot(lx, lz);
    const th = Math.atan2(lz, lx);
    const er = this.edgeR(th);
    const inside = er - d;
    let h = this.top + fbm2(x * 0.02, z * 0.02, 4, this.seed) * 1.6 + noise2(x * 0.15, z * 0.15, this.seed + 3) * 0.12;
    h -= (1 - smoothstep(0, 7, inside)) * 1.1; // rounded lip
    const ctx = { d, th, er, inside, lx, lz };
    for (const f of this.shapeFns) h = f(x, z, h, ctx);
    return h;
  }

  cliffRadius(theta, depth, er) {
    const arc = theta * this.r;
    const amp = (0.35 + clamp(depth / 35, 0, 1) * 2.6) * this.cliffCalm(theta, depth);
    let n = fbm2(arc * 0.06, depth * 0.05, 4, this.seed + 91) * amp * 1.6;
    // Broad buttresses and bays that grow with depth, so the column doesn't read as an extrusion.
    n += fbm2(arc * 0.011, depth * 0.006, 3, this.seed + 17) * clamp(depth / 80, 0, 1) * 16 * this.cliffCalm(theta, depth);
    // Horizontal strata ledges.
    const band = depth / 6.5 + noise2(arc * 0.02, depth * 0.01, this.seed) * 1.5;
    n -= (band - Math.floor(band)) * 0.7 * clamp(depth / 12, 0, 1) * this.cliffCalm(theta, depth);
    const widen = depth * 0.045 + Math.pow(depth / 1000, 2) * 60;
    const lip = depth < 0.6 ? 0 : -0.25;
    return er + n + widen + lip;
  }

  // Relief masks (WALLS.geo) from the stack's protected arcs: `all` scales every relief term, `inward` the ones that
  // cut into the wall (an `inward` arc masks only those); `seam` asks for the θ=0 seam fade's masks, which skip arcs
  // marked seam: false. Both are exactly 0 inside a protected arc, so the wall
  // there is today's to the bit.
  protectAt(theta, depth, seam = false) {
    let all = 1, inward = 1;
    for (const z of this.protect) {
      if (seam && z.seam === false) continue;   // an arc the θ=0 seam fade may still pass through
      const m = 1 - arcWeight(z, this.r, theta, depth);
      inward *= m;
      if (!z.inward) all *= m;
    }
    return { all, inward };
  }

  // Added wall radius (WALLS.geo), 0 down to 1.4 m and inside protected arcs, faded out by 200 m where the old
  // buttresses take over. Noise runs on the stack's circle, so it has no θ=0 seam of its own, and holds its 12 m
  // shape above that depth. Bays (negative lobes) and gullies set the wall back by up to `top` by 2.8 m (the eye of a
  // walk-off is still above the rim there) and `top2` more by 4.6 m, constant down to SLIDE, then cut on to `cap`
  // by 20 m; buttresses (positive lobes) stand out from SLIDE, fully by 22 m. An `inward` arc masks only the cuts.
  wallRelief(theta, depth) {
    if (depth <= 1.4 || depth >= 200) return 0;
    const pm = this.protectAt(theta, depth);
    if (!(pm.all > 0)) return 0;
    const col = (TAU * this.r) / this.segs, dz = Math.max(depth, 12) * 0.012;
    const L = Math.max(GEO.lobe[0], GEO.lobe[1] * col), G = Math.max(GEO.groove[0], GEO.groove[1] * col);
    const x = Math.cos(theta) * this.r, y = Math.sin(theta) * this.r;
    const fade = 1 - smoothstep(80, 200, depth);
    const b = Math.tanh(3 * fbm3(x / L, y / L, dz, 2, this.seed + GEO_SEED.buttress));   // plateaus with 4+ column flanks
    let r = depth > SLIDE ? Math.max(b, 0) * GEO.out * smoothstep(SLIDE, 22, depth) * pm.all : 0;
    if (pm.inward > 0) {
      const g = smoothstep(0.1, 0.5, noise3(x / G, y / G, dz, this.seed + GEO_SEED.gully));
      const cut = Math.tanh((Math.max(-b, 0) * GEO.in + g * GEO.gully) / GEO.cap);   // 0..1
      r -= cut * (GEO.top * smoothstep(1.4, 2.8, depth) + GEO.top2 * smoothstep(4, 4.6, depth) + (GEO.cap - GEO.top - GEO.top2) * smoothstep(SLIDE, 20, depth)) * pm.inward;
    }
    return r * fade;
  }

  // Radius of the built wall mesh with WALLS.geo: cliffRadius plus wallRelief, with the old terms' θ=0 seam (their
  // noise runs on arc length and meets itself there) cross-faded over SEAM_ARC after θ=0: column 0 and its duplicate
  // column segs meet at f(2π), and f(θ) is back by the window's end. Where no protected arc is near the window before
  // 2π (all but Rocks' fall and End's landing) the seam is split evenly over both windows, so no column moves by more
  // than half the old step (the collider box stays within 3 m). The fade keeps the relief's rules: where it pulls
  // the wall in it starts at 2.8 m, where it pushes out only from SLIDE (by 22 m), it stays off protected arcs, and
  // with the relief it sets the wall back at most 0.8 m above 4 m. Outside the windows and where the relief is 0 this
  // is cliffRadius to the bit. cliffRadius stays the analytic wall the features are placed on (all in protected arcs,
  // where the two agree); wallRadius() reads the built mesh.
  sculptRadius(theta, depth, er) {
    const base = this.cliffRadius(theta, depth, er), rel = this.wallRelief(theta, depth);
    const w = SEAM_ARC / this.r, a = this.seamBefore();
    let s = 0, t = 0;   // weight of the other end of the seam, and theta there
    if (theta < w) { s = (1 - smoothstep(0, w, theta)) * (1 - a); t = theta + TAU; }
    else if (theta > TAU - w && a > 0) { s = smoothstep(TAU - w, TAU, theta) * a; t = theta - TAU; }
    if (!(s > 0 && depth > 1.4)) return base + rel;
    const pm = this.protectAt(theta, depth, true);
    const d = (this.cliffRadius(t, depth, er) - base) * s;
    let add = rel + (d < 0 ? d * smoothstep(1.4, 2.8, depth) * pm.inward : d * smoothstep(SLIDE, 22, depth) * pm.all);
    if (depth < 4) add = Math.max(add, -GEO.top);   // no deeper set-back than the relief's own above 4 m
    return base + add;
  }

  // Share of the θ=0 seam taken up before 2π: half, unless a protected arc (with its feather) reaches that window.
  seamBefore() {
    if (this._seamBefore === undefined) {
      const w = SEAM_ARC / this.r;
      let clear = true;
      for (let i = 0; i <= 64 && clear; i++) {
        const th = TAU - w * 1.25 * i / 64;   // the window and a quarter of it beyond
        for (const z of this.protect) if (arcWeight(z, this.r, th, 0) > 0) clear = false;
      }
      this._seamBefore = clear ? 0.5 : 0;
    }
    return this._seamBefore;
  }

  build(collider) {
    const M = materials();
    const segs = this.segs, rings = this.rings;
    // ---- Cap (polar grid) ----
    const capPos = [], capCol = [], capUv = [], capIdx = [];
    const edgeRow = [];
    const c = new THREE.Color();
    const rimWidth = WALLS.bake ? makeAngularNoise(this.seed + BAKE_SEED.rimWidth, Math.max(8, Math.round(this.r / 4)), 3, 0.8) : null;
    for (let i = 0; i <= rings; i++) {
      const f = i / rings;
      for (let j = 0; j < segs; j++) {
        const th = (j / segs) * Math.PI * 2;
        const er = this.edgeR(th);
        const rad = this.innerHole + (er - this.innerHole) * Math.pow(f, 0.92);
        const x = this.cx + Math.cos(th) * rad, z = this.cz + Math.sin(th) * rad;
        const h = this.heightAtAnalytic(x, z);
        capPos.push(x, h, z);
        capUv.push(x * 0.22, z * 0.22);
        // Base color: patchy grass, rockier toward the lip.
        const patch = fbm2(x * 0.05, z * 0.05, 3, this.seed + 5) * 0.5 + 0.5;
        c.copy(GRASS).lerp(GRASS2, patch);
        const inside = er - rad;
        if (WALLS.bake) rimBand(c, x, z, inside, 1.2 + 2.8 * smoothstep(-0.45, 0.45, rimWidth(th)), this.seed);
        else c.lerp(ROCKC, (1 - smoothstep(0, 3.5, inside)) * 0.85);
        const bare = smoothstep(0.62, 0.8, fbm2(x * 0.09, z * 0.09, 3, this.seed + 8) * 0.5 + 0.5);
        c.lerp(DIRT, bare * 0.5);
        if (WALLS.bake) c.lerp(SOIL, (1 - smoothstep(0, 0.9, inside)) * 0.7);
        const ctx = { inside, rad, th };
        for (const fn of this.colorFns) fn(x, z, h, c, ctx);
        capCol.push(c.r, c.g, c.b);
        if (i === rings) edgeRow.push([x, h, z, th, er]);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), cc = (i + 1) * segs + j, d = (i + 1) * segs + ((j + 1) % segs);
      capIdx.push(a, b, cc, b, d, cc);
    }
    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
    capGeo.setAttribute('color', new THREE.Float32BufferAttribute(capCol, 3));
    capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(capUv, 2));
    capGeo.setIndex(capIdx);
    capGeo.computeVertexNormals();
    // Slope-driven rock color on steep cap faces (mountain flanks).
    const nrm = capGeo.attributes.normal, col = capGeo.attributes.color;
    for (let i = 0; i < nrm.count; i++) {
      const steep = 1 - smoothstep(0.62, 0.85, nrm.getY(i));
      if (steep > 0) {
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(ROCKC, steep * 0.9);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    this.capGeo = capGeo;
    this.capBVH = new MeshBVH(capGeo.clone());
    const cap = new THREE.Mesh(capGeo, M.cap);
    cap.receiveShadow = true;
    cap.castShadow = true;
    cap.name = 'cap';
    this.group.add(cap);
    this.capMesh = cap;

    // ---- Cliff skirt ----
    const cliffPos = [], cliffCol = [], cliffUv = [], cliffIdx = [];
    const rows = DEPTHS.filter((d) => this.top - d > STACK_BOTTOM_Y - 1);
    const avgR = this.r;
    for (let ri = 0; ri < rows.length; ri++) {
      const depth = rows[ri];
      for (let j = 0; j <= segs; j++) {
        const jj = j % segs;
        const [ex, ey, ez, th, er] = edgeRow[jj];
        let x, y, z;
        if (ri === 0) { x = ex; y = ey; z = ez; }
        else {
          const rad = WALLS.geo ? this.sculptRadius(th, depth, er) : this.cliffRadius(th, depth, er);
          y = Math.min(ey, this.top) - depth + noise2(th * 8, depth * 0.1, this.seed) * Math.min(depth * 0.1, 2);
          x = this.cx + Math.cos(th) * rad; z = this.cz + Math.sin(th) * rad;
        }
        cliffPos.push(x, y, z);
        // An integer tile count around the stack, so the texture meets itself at θ = 0.
        const u = WALLS.uv ? (j / segs) * Math.round(Math.PI * 2 * avgR / 4) : (j / segs) * Math.PI * 2 * avgR / 4;
        cliffUv.push(u, y / 4);
        const ao = 0.75 + fbm2(th * 12, depth * 0.08, 3, this.seed + 4) * 0.35;
        const deep = 1 - smoothstep(0, 400, depth) * 0.55;
        const warm = 0.9 + noise2(th * 3, depth * 0.02, this.seed + 7) * 0.12;
        const k = ao * deep * 0.52;
        cliffCol.push(k * warm, k * 0.97, k * (1.0 - (warm - 0.9)));
      }
    }
    const W = segs + 1;
    for (let ri = 0; ri < rows.length - 1; ri++) for (let j = 0; j < segs; j++) {
      const a = ri * W + j, b = ri * W + j + 1, cc = (ri + 1) * W + j, d = (ri + 1) * W + j + 1;
      cliffIdx.push(a, b, cc, b, d, cc);
    }
    const cliffGeo = new THREE.BufferGeometry();
    cliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(cliffPos, 3));
    cliffGeo.setAttribute('color', new THREE.Float32BufferAttribute(WALLS.bake ? bakeCliffColors(this, cliffPos, cliffCol, rows, edgeRow) : cliffCol, 3));
    cliffGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cliffUv, 2));
    cliffGeo.setIndex(cliffIdx);
    cliffGeo.computeVertexNormals();
    // Render normals only: capBVH was cloned before this, and the collider and wallP read positions.
    if (WALLS.bake) creaseNormals(this, capGeo.attributes.normal.array, cliffGeo.attributes.normal.array, rows.length);
    // The built wall vertices relative to the axis, read back from the mesh once for wallRadius().
    const P = cliffGeo.attributes.position.array;
    this.wallRows = rows.length;
    this.wallP = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      this.wallP[i] = P[i] - this.cx; this.wallP[i + 1] = P[i + 1]; this.wallP[i + 2] = P[i + 2] - this.cz;
    }
    const cliff = new THREE.Mesh(cliffGeo, WALLS.shader ? stackWallMaterial(this) : M.cliff);
    cliff.receiveShadow = true;
    cliff.castShadow = false;
    cliff.name = 'cliff';
    this.group.add(cliff);

    if (collider) {
      collider.addGeometry(capGeo);
      // Only the upper part of the cliff can ever be touched.
      const nCollRows = rows.filter((d) => d <= 45).length;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cliffPos.slice(0, nCollRows * W * 3), 3));
      g.setIndex(cliffIdx.slice(0, (nCollRows - 1) * segs * 6));
      collider.addGeometry(g);
    }
    return this.group;
  }

  // Exact ground height from the built cap mesh.
  heightAt(x, z) {
    const ray = new THREE.Ray(new THREE.Vector3(x, this.top + 200, z), new THREE.Vector3(0, -1, 0));
    const hit = this.capBVH.raycastFirst(ray, THREE.DoubleSide);
    return hit ? hit.point.y : null;
  }

  normalAt(x, z) {
    const ray = new THREE.Ray(new THREE.Vector3(x, this.top + 200, z), new THREE.Vector3(0, -1, 0));
    const hit = this.capBVH.raycastFirst(ray, THREE.DoubleSide);
    return hit ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  }

  // Radius of the built wall at angle theta and height y: the outermost face the level ray from the axis crosses,
  // exact on the mesh triangles (so it follows the wall as built), or null above the rim.
  wallRadius(theta, y) {
    const P = this.wallP, W = this.segs + 1;
    const j = Math.min(this.segs - 1, Math.floor((((theta / (Math.PI * 2)) % 1 + 1) % 1) * this.segs));
    const dx = Math.cos(theta), dz = Math.sin(theta);
    let best = -1;
    for (let i = 0; i < this.wallRows - 1; i++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      if (y > Math.max(P[a * 3 + 1], P[b * 3 + 1]) || y < Math.min(P[c * 3 + 1], P[d * 3 + 1])) continue;
      best = Math.max(best, rayCut(P, a, b, c, y, dx, dz), rayCut(P, b, d, c, y, dx, dz));
    }
    return best < 0 ? null : best;
  }

  // The farthest the built wall reaches from the axis: no wallRadius() is larger.
  wallReach() {
    const P = this.wallP;
    let m = 0;
    for (let i = 0; i < P.length; i += 3) m = Math.max(m, Math.hypot(P[i], P[i + 2]));
    return m;
  }

  // World position on the cliff face at angle theta and depth below top.
  cliffPoint(theta, depth, out = new THREE.Vector3()) {
    const er = this.edgeR(theta);
    const rad = this.cliffRadius(theta, depth, er);
    return out.set(this.cx + Math.cos(theta) * rad, this.top - depth, this.cz + Math.sin(theta) * rad);
  }
}
