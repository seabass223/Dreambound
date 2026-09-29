import * as THREE from 'three';
import { Rng, smoothstep, clamp, noise2 } from '../core/rng.js';
import { patchMaterial } from '../render/materials.js';
import { periodicHash, tnoise, tfbm, toCanvas, normalFromHeight, tex, once } from '../render/textures.js';
import { Path } from './paths.js';
import { mat4, mergeParts } from './builders.js';
import { Forest } from './trees.js';
import { Flowers } from './flowers.js';

// The Mountain's switchback path (placed by world/stacks/mountain.js): a pebble tread between timber edging boards,
// cut into the hillside as a bench, climbing in old railroad-tie steps wherever it gets steep, with grass,
// wildflowers and trees along its verges and a few big stones round the outside of each hairpin.
//
// Its collision is one smooth ribbon at the walking height (the steps' treads sit around it, half a riser up or
// down), so the steps climb without a bump and nothing snags on a tie; along the path it climbs at 28 degrees at
// the steepest. The hillsides round it are steeper than the Mountain's walkable slope (PLAYER.maxSlope), so the path
// is the way up.

export const TRAIL = {
  width: 1.4,             // the pebble tread, edge to edge
  board: 0.08,            // the edging timbers' thickness (set along both sides of the tread)
  flat: 1.3,              // the ground is cut level (just under the tread) to this far from the centreline
  blend: 3.8,             // and eases back into the hillside by here, or halfway to the next arm, if that is nearer
  arm: 8,                 // metres along the path that make another part of it "another arm" (see near)
  stepDeg: 11,            // steeper than this (degrees), the path climbs in timber steps
  rise: 0.18,             // their rise, at most (each flight divides its climb evenly)
  tieW: 0.2, tieH: 0.34,  // a tie's width along the path, and its depth (most of it in the ground)
  tile: 1.1,              // metres per pebble texture tile (mapped in world x/z, so it has no seams)
};

// ---------------------------------------------------------------- layout
// legs: [[theta, r, turn?], ...] round the summit (sx, sz), from the foot up; theta is absolute (atan2(z, x)).
// Where the direction round the summit reverses, the path makes a U-turn of radius `turn` about that vertex: it
// arrives `turn` further out and leaves `turn` further in, round the far side. head: world [x, z] points before the
// legs (the shed door). ground(x, z): the natural ground height (the hillside without the path).
// Heights follow the natural ground along the centreline, smoothed over about +-smooth m of path (so a U-turn's climb
// spreads onto its arms), and the path's ends keep the ground's height there (the shed's floor, the summit plateau).
export function layoutTrail({ sx, sz, head, legs, ground, turn = 2.0, smooth = 5 }) {
  const polar = (t, r) => [sx + Math.cos(t) * r, sz + Math.sin(t) * r];
  const raw = head.map((p) => [p[0], p[1]]);
  const seg = (a, b) => {
    const [t0, r0] = a, [t1, r1] = b;
    const L = Math.hypot((t1 - t0) * (r0 + r1) / 2, r1 - r0);
    const n = Math.max(1, Math.ceil(L / 0.8));
    for (let k = 0; k < n; k++) { const u = k / n; raw.push(polar(t0 + (t1 - t0) * u, r0 + (r1 - r0) * u)); }
  };
  const turns = [], corners = [raw.length - 1];   // (the head's last point turns onto the first leg)
  let cur = legs[0];
  for (let i = 1; i < legs.length; i++) {
    const v = legs[i], nx = legs[i + 1], w = v[2] ?? turn;
    const hairpin = nx && Math.abs(v[0] - cur[0]) > 0.05 && Math.abs(nx[0] - v[0]) > 0.05 && Math.sign(v[0] - cur[0]) !== Math.sign(nx[0] - v[0]);
    if (!hairpin) { seg(cur, v); cur = v; if (nx) corners.push(raw.length); continue; }
    seg(cur, [v[0], v[1] + w]);
    // Round the far side: a semicircle in the ground's plane about the vertex, bulging the way the path was going.
    const sg = Math.sign(v[0] - cur[0]), n = Math.ceil(Math.PI * w / 0.6);
    for (let k = 0; k < n; k++) {
      const ph = Math.PI * k / n;
      raw.push(polar(v[0] + sg * w * Math.sin(ph) / v[1], v[1] + w * Math.cos(ph)));
    }
    const [cx, cz] = polar(v[0], v[1]);
    turns.push({ x: cx, z: cz, w, theta: v[0], r: v[1], sg });   // centre, radius, and the way round
    cur = [v[0], v[1] - w];
  }
  raw.push(polar(cur[0], cur[1]));
  // Round the corners where one leg turns onto the next (not the U-turns, which are round already): replace 2 m
  // either side of the vertex with a quadratic curve, so the tread never folds over itself on the inside.
  for (const c of corners.reverse()) {
    if (c <= 0 || c >= raw.length - 1) continue;
    const V = raw[c], arc = [];
    let iA = c, iB = c, dA = 0, dB = 0;
    while (iA > 0 && dA < 2) { dA += Math.hypot(raw[iA][0] - raw[iA - 1][0], raw[iA][1] - raw[iA - 1][1]); iA--; }
    while (iB < raw.length - 1 && dB < 2) { dB += Math.hypot(raw[iB + 1][0] - raw[iB][0], raw[iB + 1][1] - raw[iB][1]); iB++; }
    const A = raw[iA], B = raw[iB], n = Math.max(3, Math.ceil((dA + dB) / 0.4));
    for (let k = 1; k < n; k++) {
      const u = k / n, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), cc = u * u;
      arc.push([A[0] * a + V[0] * b + B[0] * cc, A[1] * a + V[1] * b + B[1] * cc]);
    }
    raw.splice(iA + 1, iB - iA - 1, ...arc);
  }
  const base = Path.smooth(raw, 0.5, TRAIL.width);

  // Heights: the natural ground under the centreline, smoothed along the path; past either end the ground is taken
  // to carry on level at the end's own height.
  const P = base.pts.map((p) => ({ x: p.x, z: p.z }));
  let s = 0;
  P.forEach((p, i) => { if (i) s += Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z); p.s = s; p.g = ground(p.x, p.z); });
  const total = s, H2 = smooth * smooth, reach = smooth * 2.2;
  const y0 = P[0].g, y1 = P[P.length - 1].g;
  for (const p of P) {
    let sw = 0, sy = 0;
    for (const q of P) { const d = q.s - p.s; if (d > -reach && d < reach) { const k = Math.exp(-d * d / H2); sw += k; sy += k * q.g; } }
    for (let e = 0.25; e < reach; e += 0.5) {
      const k = Math.exp(-(e * e) / H2);
      if (p.s - e < 0) { sw += k; sy += k * y0; }
      if (p.s + e > total) { sw += k; sy += k * y1; }
    }
    p.y = sy / sw;
  }
  // The smoothing lets the ends sag toward the slope: hold them to their ground (the shed floor, the plateau, where
  // the observatory's threshold must stay one step up), easing in over the last few metres.
  const ease = Math.tan(7 * Math.PI / 180);
  for (const p of P) {
    if (p.s < 4) p.y = Math.min(p.y, y0 + p.s * ease);
    if (total - p.s < 4) p.y = Math.max(p.y, y1 - (total - p.s) * ease);
  }
  // Grades (central differences) and the stepped flights: every run steeper than stepDeg (gaps under a metre
  // closed), each divided into risers of at most `rise`.
  const tan = Math.tan(TRAIL.stepDeg * Math.PI / 180);
  P.forEach((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    p.grade = (b.y - a.y) / Math.max(1e-6, b.s - a.s);
  });
  const flights = [];
  for (let i = 0; i < P.length;) {
    if (P[i].grade <= tan) { i++; continue; }
    let j = i;
    while (j + 1 < P.length && (P[j + 1].grade > tan || P.slice(j + 1, j + 3).some((q) => q.grade > tan))) j++;
    flights.push({ i0: i, i1: j });
    i = j + 1;
  }
  const yAt = (sv) => {
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= sv) lo = m; else hi = m; }
    const a = P[lo], b = P[hi], u = clamp((sv - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
    return a.y + (b.y - a.y) * u;
  };
  const sAtY = (y, from, to) => {   // the first s in [from, to] where the (rising) profile reaches y
    const i0 = P.findIndex((p) => p.s >= from);
    for (let i = Math.max(1, i0); i < P.length && P[i - 1].s <= to; i++) {
      if (P[i].y >= y) { const a = P[i - 1], b = P[i]; return a.s + (b.s - a.s) * clamp((y - a.y) / Math.max(1e-6, b.y - a.y), 0, 1); }
    }
    return to;
  };
  const steps = [];
  for (const f of flights) {
    const sa = P[f.i0].s, sb = P[f.i1].s, ya = P[f.i0].y, yb = P[f.i1].y;
    const n = Math.ceil((yb - ya) / TRAIL.rise);
    if (n < 2 || sb - sa < 1.2) continue;
    const r = (yb - ya) / n;
    const ties = [];
    let last = sa;
    // Tie k (1..n) stands where the profile is half a riser under its top, so the ribbon runs through the middle of
    // every riser and every tread.
    for (let k = 1; k <= n; k++) { last = Math.max(last + TRAIL.tieW + 0.06, sAtY(ya + (k - 0.5) * r, last, sb)); ties.push({ s: Math.min(last, sb - 0.05), top: ya + k * r }); }
    steps.push({ sa, sb, ya, yb, r, ties });
    for (let i = f.i0; i <= f.i1; i++) P[i].stepped = true;
  }
  const path = new Path(P.map((p) => [p.x, p.z, p.y]), TRAIL.width);

  // ---- nearest-point queries (a grid of the centreline's segments) ----
  const CELL = 2;
  const box = path.box;
  const gx0 = box.min.x - 8, gz0 = box.min.y - 8, NX = Math.ceil((box.max.x - box.min.x + 16) / CELL), NZ = Math.ceil((box.max.y - box.min.y + 16) / CELL);
  const grid = (pad) => {
    const cells = Array.from({ length: NX * NZ }, () => []);
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - pad - gx0) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + pad - gx0) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - pad - gz0) / CELL), z1 = Math.floor((Math.max(a.z, b.z) + pad - gz0) / CELL);
      for (let cz = Math.max(0, z0); cz <= Math.min(NZ - 1, z1); cz++) for (let cx = Math.max(0, x0); cx <= Math.min(NX - 1, x1); cx++) cells[cz * NX + cx].push(i);
    }
    return cells;
  };
  const nearGrid = grid(TRAIL.blend + 0.5), farGrid = grid(TRAIL.blend * 2 + 0.5);
  const segAt = (i, x, z, o) => {
    const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
    const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
    if (d < o.d) { o.d = d; o.i = i; o.u = u; }
  };
  // Distance to the centreline (d, Infinity past `blend`), the point there (s, y, stepped), and d2: the distance to
  // the nearest part of the path more than TRAIL.arm metres along it from that point (another arm of a hairpin).
  const near = (x, z, out = {}) => {
    out.d = Infinity; out.d2 = Infinity; out.i = -1;
    const cx = Math.floor((x - gx0) / CELL), cz = Math.floor((z - gz0) / CELL);
    if (cx < 0 || cz < 0 || cx >= NX || cz >= NZ) return out;
    for (const i of nearGrid[cz * NX + cx]) segAt(i, x, z, out);
    if (out.i < 0) return out;
    const a = P[out.i], b = P[out.i + 1];
    out.s = a.s + (b.s - a.s) * out.u; out.y = a.y + (b.y - a.y) * out.u; out.stepped = !!(a.stepped || b.stepped);
    const o2 = { d: Infinity };
    for (const i of farGrid[cz * NX + cx]) if (Math.abs(P[i].s - out.s) > TRAIL.arm) segAt(i, x, z, o2);
    out.d2 = o2.d;
    return out;
  };
  // The same, out to about 8 m (for keeping tree crowns off the tread): { d, y }.
  const nearFar = (x, z, out = {}) => {
    out.d = Infinity; out.i = -1;
    const cx = Math.floor((x - gx0) / CELL), cz = Math.floor((z - gz0) / CELL);
    if (cx < 0 || cz < 0 || cx >= NX || cz >= NZ) return out;
    for (const i of farGrid[cz * NX + cx]) segAt(i, x, z, out);
    if (out.i >= 0) { const a = P[out.i], b = P[out.i + 1]; out.y = a.y + (b.y - a.y) * out.u; }
    return out;
  };
  const q = {};
  // The path's bed cut into the ground (a Stack shape function's last word on h): level just under the tread (deeper
  // under the steps, whose treads sit up to half a riser under the walking line), easing back into the hillside.
  const carve = (x, z, h) => {
    near(x, z, q);
    if (!(q.d < TRAIL.blend)) return h;
    const B = clamp((q.d + q.d2) / 2, TRAIL.flat + 0.45, TRAIL.blend);
    const bed = q.y - (q.stepped ? 0.14 : 0.04);
    return THREE.MathUtils.lerp(bed, h, smoothstep(TRAIL.flat, B, q.d));
  };
  // Whether the point s along the path is on one of the steps' ties (footsteps: timber there, pebbles between).
  const tieAt = (s) => steps.some((f) => s > f.sa - 0.1 && s < f.sb + 0.1 && f.ties.some((t) => s > t.s - 0.04 && s < t.s + TRAIL.tieW + 0.04));
  return { path, pts: P, total, turns, steps, near, nearFar, carve, yAt, tieAt };
}

// Whether a tree (species sp, scale s, standing at x, y, z) keeps its crown off the path: no part of it lower than
// TREE_HEAD over the tread may reach over the tread, or within 25 cm of its edge.
export const TREE_HEAD = 3.4;
export function crownClear(forest, trail, sp, x, y, z, s) {
  const q = trail.nearFar(x, z);
  if (!(q.d < 9)) return true;
  const room = q.d - TRAIL.width / 2 - 0.25;
  return forest.footprint(sp).every((b) => y - 0.1 + b.y0 * s >= q.y + TREE_HEAD || b.r * s < room);
}

// ---------------------------------------------------------------- textures and materials
// Pebbles (a 512 tile laid over TRAIL.tile metres): rounded, slightly elongated stones of mixed rock (grey granite,
// tan sandstone, rusty ironstone, dark basalt, white quartz) packed two sizes deep in dark grit. The roughness map
// leaves the stones' crowns fairly smooth, so a low sun glances off them, and the grit matt.
function pebbleTextures() {
  return once('trailPebbles', () => {
    const S = 512;
    const h = new Float32Array(S * S), id = new Float32Array(S * S), pal = new Uint8Array(S * S);
    const layers = [{ n: 22, rad: [0.3, 0.46], lift: 1, seed: 11 }, { n: 44, rad: [0.26, 0.42], lift: 0.62, seed: 29 }];
    const PAL = [[150, 146, 138], [176, 170, 158], [168, 144, 110], [128, 98, 72], [150, 100, 72], [84, 82, 80], [204, 198, 186], [112, 118, 124]];
    const W = [0.2, 0.14, 0.18, 0.1, 0.07, 0.12, 0.07, 0.12];
    const pick = (r) => { let a = 0; for (let k = 0; k < W.length; k++) { a += W[k]; if (r < a) return k; } return 0; };
    // Each cell's stone, drawn once: centre in the cell, 1 / radius, turn (cos, sin), elongation, height, shade, rock.
    const cells = layers.map((L) => {
      const n = L.n, t = new Float32Array(n * n * 9);
      for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
        const hr = (k) => periodicHash(cx, cy, n, L.seed + k), o = (cy * n + cx) * 9, ang = hr(3) * Math.PI;
        t.set([0.15 + 0.7 * hr(0), 0.15 + 0.7 * hr(1), 1 / (L.rad[0] + (L.rad[1] - L.rad[0]) * hr(2)), Math.cos(ang), Math.sin(ang),
          1 + hr(4) * 0.6, L.lift * (0.75 + 0.35 * hr(5)), hr(6), pick(hr(7))], o);
      }
      return t;
    });
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let best = 0, bid = 0, bp = 0;
      for (let li = 0; li < layers.length; li++) {
        const n = layers[li].n, t = cells[li];
        const u = (x / S) * n, v = (y / S) * n, iu = Math.floor(u), iv = Math.floor(v);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = iu + ox, cy = iv + oy, o = ((((cy % n) + n) % n) * n + (((cx % n) + n) % n)) * 9;
          const dx = u - cx - t[o], dy = v - cy - t[o + 1];
          const a = (dx * t[o + 3] + dy * t[o + 4]) * t[o + 2], b = (dy * t[o + 3] - dx * t[o + 4]) * t[o + 5] * t[o + 2];
          const r2 = a * a + b * b;
          if (r2 >= 1) continue;
          const hh = Math.sqrt(1 - r2) * t[o + 6];
          if (hh > best) { best = hh; bid = t[o + 7]; bp = t[o + 8]; }
        }
      }
      const grit = tnoise(x / S, y / S, 64, 41) * 0.1 + periodicHash(x, y, S, 43) * 0.05;
      h[i] = Math.max(best, grit);
      id[i] = best > grit ? bid : -1;
      pal[i] = bp;
    }
    const col = toCanvas(S, (x, y) => {
      const i = y * S + x, u = x / S, v = y / S;
      if (id[i] < 0) {   // grit: dark earth with lighter sand grains
        const g = 0.8 + periodicHash(x, y, S, 47) * 0.3 + (periodicHash(x, y, S, 5) > 0.9 ? 0.35 : 0);
        return [66 * g, 56 * g, 46 * g];
      }
      const c = PAL[pal[i]], k = (0.82 + id[i] * 0.3) * (0.9 + tnoise(u, v, 40, 49) * 0.2) * (0.78 + Math.min(1, h[i]) * 0.3);
      return [c[0] * k, c[1] * k, c[2] * k];
    });
    const rough = toCanvas(S, (x, y) => {
      const i = y * S + x;
      const k = id[i] < 0 ? 0.96 : 0.72 - Math.min(1, h[i]) * 0.22 - (id[i] > 0.8 ? 0.12 : 0);
      const r = clamp(k, 0.3, 1) * 255;
      return [r, r, r];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 6), { srgb: false }), rough: tex(rough, { srgb: false }) };
  });
}

// Old railroad-tie / barn timber (512 along the grain by 256): weathered to silver-grey in patches over creosote
// brown, open checks (cracks) along the grain, a few knots.
function timberTextures() {
  return once('trailTimber', () => {
    const W = 512, Hh = 256;
    const h = new Float32Array(W * Hh), wet = new Float32Array(W * Hh);
    const knots = [0, 1, 2].map((k) => [periodicHash(k, 1, 97, 7), periodicHash(k, 2, 97, 7)]);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / Hh, i = y * W + x;
      const warp = tfbm(u, v, 3, 2, 61) * 0.35;
      const grain = Math.sin((v * 22 + warp * 6 + tnoise(u, v, 6, 63) * 0.8) * Math.PI * 2) * 0.5 + 0.5;
      // Checks: thin dark grooves along the grain that open and close along it.
      const cv = (v * 5 + warp * 1.4) % 1, open = Math.max(0, tfbm(u, v, 4, 2, 65) - 0.48) * 4;
      const check = Math.max(0, 1 - Math.abs(cv - 0.5) / (0.015 + 0.02 * open)) * Math.min(1, open);
      let knot = 0;
      for (const [kx, ky] of knots) {
        const dx = Math.min(Math.abs(u - kx), 1 - Math.abs(u - kx)) * 2, dy = Math.min(Math.abs(v - ky), 1 - Math.abs(v - ky));
        knot = Math.max(knot, Math.max(0, 1 - Math.hypot(dx, dy) / 0.05));
      }
      h[i] = 0.55 + grain * 0.22 + periodicHash(x >> 1, y, W, 67) * 0.06 - check * 0.5 - knot * 0.15;
      wet[i] = clamp(tfbm(u, v, 3, 2, 69) * 1.6 - 0.45, 0, 1);   // creosote still showing
    }
    const col = toCanvas(W, (x, y) => {
      const i = y * W + x, k = h[i];
      const grey = [128, 121, 110], dark = [70, 55, 42], w = wet[i];
      const r = grey[0] + (dark[0] - grey[0]) * w, g = grey[1] + (dark[1] - grey[1]) * w, b = grey[2] + (dark[2] - grey[2]) * w;
      return [r * (0.55 + k * 0.7), g * (0.55 + k * 0.7), b * (0.55 + k * 0.7)];
    }, Hh);
    return { map: tex(col), normal: tex(normalFromHeight(W, h, 4, Hh), { srgb: false }) };
  });
}

let mats = null;
export function trailMaterials() {
  if (mats) return mats;
  const p = pebbleTextures(), t = timberTextures();
  mats = {
    pebbles: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: p.map, normalMap: p.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: p.rough, roughness: 1, metalness: 0, envMapIntensity: 0.55, name: 'trail-pebbles' })),
    timber: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(1, 1), roughness: 0.92, envMapIntensity: 0.45, name: 'trail-timber' })),
  };
  return mats;
}

// ---------------------------------------------------------------- meshes and collision
// Adds the tread (pebbles), the ties and the edging (timber) to the stack's batcher (two draw calls with the rest of
// its props), and the walking ribbon to `collider`: a collider of its own, without the hillside's walkable slope,
// because round the inside of a hairpin the ribbon twists (its inner edge climbs the turn in 60 % of the distance)
// and is steeper there than the path's line.
export function buildMountainTrail(trail, batcher, collider, { seed = 5 } = {}) {
  const M = trailMaterials();
  const rng = new Rng(seed);
  const { pts: P, steps } = trail;
  const W = TRAIL.width, hw = W / 2;
  // Frame at arc length s: position, tangent, left normal.
  const frame = (sv) => {
    const p = trail.path.pointAt(sv), len = Math.hypot(p.dx, p.dz) || 1;
    return { x: p.x, z: p.z, tx: p.dx / len, tz: p.dz / len, nx: -p.dz / len, nz: p.dx / len };
  };
  const inFlight = (sv) => steps.find((f) => sv > f.sa - 1e-6 && sv < f.sb + 1e-6);

  // ---- the walking ribbon (collision): the tread and a board's width either side, at the walking height ----
  {
    const pos = [], idx = [], off = [-hw - 0.12, 0, hw + 0.12];
    P.forEach((p, i) => {
      const f = frame(p.s);
      for (const o of off) pos.push(p.x + f.nx * o, p.y, p.z + f.nz * o);
      if (i) { const a = (i - 1) * 3, b = i * 3; for (let k = 0; k < 2; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    collider.addGeometry(g);
  }

  // ---- the pebble tread: a crowned ribbon on the ramps, level treads (and their risers) in the flights ----
  const pos = [], col = [], uv = [], idx = [];
  const LAT = [-1, -0.55, 0, 0.55, 1];
  const shade = (x, z, o) => {
    // Darker and damper at the edges, lighter where feet wear the middle, in patches.
    const k = 0.84 + 0.12 * (1 - Math.abs(o)) + noise2(x * 0.7, z * 0.7, seed + 3) * 0.06;
    return [k, k * 0.99, k * 0.97];
  };
  // uv: world x/z on the treads; on a riser's vertical face (u, v given), across it and up it.
  const vert = (x, y, z, o, u = x, v = z) => { pos.push(x, y, z); col.push(...shade(x, z, o)); uv.push(u / TRAIL.tile, v / TRAIL.tile); return pos.length / 3 - 1; };
  const strip = (rows) => {   // rows: [[v0..v4], ...] vertex indices across, in order along the path
    for (let r = 1; r < rows.length; r++) for (let k = 0; k < LAT.length - 1; k++) {
      const a = rows[r - 1][k], b = rows[r][k], c = rows[r - 1][k + 1], d = rows[r][k + 1];
      idx.push(a, b, c, c, b, d);
    }
  };
  const row = (sv, y, crown = true) => {
    const f = frame(sv);
    return LAT.map((l) => vert(f.x + f.nx * l * hw, y + (crown ? 0.012 * (1 - l * l) : 0), f.z + f.nz * l * hw, l));
  };
  // Ramps: from each flight's top to the next one's foot, through every centreline point between.
  const cuts = [0, ...steps.flatMap((f) => [f.sa, f.sb]), trail.total];
  for (let k = 0; k < cuts.length; k += 2) {
    const s0 = cuts[k], s1 = cuts[k + 1];
    if (s1 - s0 < 0.05) continue;
    const rows = [row(s0, trail.yAt(s0) + 0.012)];
    for (const p of P) if (p.s > s0 + 0.05 && p.s < s1 - 0.05) rows.push(row(p.s, p.y + 0.012));
    rows.push(row(s1, trail.yAt(s1) + 0.012));
    strip(rows);
  }
  for (const f of steps) {
    // The ramp's ends meet the flight's first and last treads.
    const bounds = [f.sa, ...f.ties.map((t) => t.s + 0.012), f.sb];
    for (let k = 0; k < bounds.length - 1; k++) {
      const y = f.ya + k * f.r - 0.012, s0 = bounds[k], s1 = bounds[k + 1];
      const n = Math.max(1, Math.ceil((s1 - s0) / 0.3));
      const rs = [];
      for (let j = 0; j <= n; j++) rs.push(row(s0 + (s1 - s0) * j / n, y, false));
      strip(rs);
      if (k > 0) {   // the riser behind this tie's face (seen only where a tie is short, round the tight turns)
        const fr = frame(s0), yl = y - f.r;
        const lo = LAT.map((l) => vert(fr.x + fr.nx * l * hw, yl, fr.z + fr.nz * l * hw, l, l * hw + s0, yl));
        const hi = LAT.map((l) => vert(fr.x + fr.nx * l * hw, y, fr.z + fr.nz * l * hw, l, l * hw + s0, y));
        strip([lo, hi]);
      }
    }
  }
  const tread = new THREE.BufferGeometry();
  tread.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tread.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tread.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tread.setIndex(idx);
  tread.computeVertexNormals();
  // Wind every face up.
  if (tread.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    tread.setIndex(idx); tread.computeVertexNormals();
  }
  batcher.add(tread, M.pebbles);

  // ---- timber: ties across the flights, edging boards along both sides ----
  const parts = [];
  const timber = (len, h, d, matrix, tint, uLen) => {
    const g = new THREE.BoxGeometry(len, h, d);
    const u = g.attributes.uv, du = rng.float(0, 1), dv = rng.float(0, 1);
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * uLen / 1.3 + du, u.getY(i) * 0.5 + dv);
    parts.push({ geo: g, matrix, color: tint });
  };
  const tint = () => {
    const c = new THREE.Color().setRGB(1, 0.97, 0.93).lerp(new THREE.Color(0.62, 0.52, 0.44), rng.next() * 0.7);
    return c.multiplyScalar(rng.float(0.82, 1.08));
  };
  // Ties: square across the path at their s (fanned round the turns), each as long as the tread; where the fan
  // brings neighbours' ends together round a tight turn, the end is cut back so they never overlap.
  const L2 = hw + 0.02;
  for (const f of steps) {
    let prev = null;
    for (const t of f.ties) {
      const fr = frame(t.s + TRAIL.tieW / 2);
      const ext = [L2, L2];   // [-n side, +n side]
      if (prev) {
        for (let side = 0; side < 2; side++) {
          const sgn = side ? 1 : -1;
          for (let k = 0; k < 20; k++) {
            const ex = fr.x + fr.nx * sgn * ext[side], ez = fr.z + fr.nz * sgn * ext[side];
            const px = prev.fr.x + prev.fr.nx * sgn * Math.min(ext[side], prev.ext[side]), pz = prev.fr.z + prev.fr.nz * sgn * Math.min(ext[side], prev.ext[side]);
            if (Math.hypot(ex - px, ez - pz) > TRAIL.tieW + 0.03 || ext[side] < 0.3) break;
            ext[side] -= 0.06;
          }
        }
      }
      const len = ext[0] + ext[1], mid = (ext[1] - ext[0]) / 2;
      const cx = fr.x + fr.nx * mid, cz = fr.z + fr.nz * mid;
      const ry = Math.atan2(-fr.nz, fr.nx) + rng.float(-0.03, 0.03);
      const top = t.top + 0.012 + rng.float(-0.008, 0.006);
      timber(len, TRAIL.tieH, TRAIL.tieW, mat4(cx, top - TRAIL.tieH / 2, cz, ry, 1, 1, 1, rng.float(-0.012, 0.012), rng.float(-0.012, 0.012)), tint(), len);
      prev = { fr, ext };
    }
  }
  // Edging: timbers laid end to end along both sides, short round the turns, their tops a little over the tread
  // (over the walking line in the flights, where they run up beside the steps like stringers).
  const topAt = (sv) => trail.yAt(sv) + (inFlight(sv) ? 0.1 : 0.07);
  for (const side of [-1, 1]) {
    const o = side * (hw + TRAIL.board / 2);
    for (let s0 = 0.6; s0 < trail.total - 0.4;) {
      let s1 = s0 + rng.float(1.4, 2.2);
      // Shorter where the path bends: no board may stray over 3 cm from its curve.
      const a = frame(s0);
      while (s1 - s0 > 0.45) {
        const b = frame(s1), m = frame((s0 + s1) / 2);
        const ax = a.x + a.nx * o, az = a.z + a.nz * o, bx = b.x + b.nx * o, bz = b.z + b.nz * o, mx = m.x + m.nx * o, mz = m.z + m.nz * o;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
        if (Math.abs(((mx - ax) * dz - (mz - az) * dx) / L) < 0.03) break;
        s1 = s0 + (s1 - s0) * 0.7;
      }
      s1 = Math.min(s1, trail.total - 0.3);
      const b = frame(s1);
      const ax = a.x + a.nx * o, az = a.z + a.nz * o, bx = b.x + b.nx * o, bz = b.z + b.nz * o;
      const ya = topAt(s0), yb = topAt(s1), dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L > 0.2) {
        const h = 0.24, len = Math.hypot(L, yb - ya) + 0.02;
        timber(len, h, TRAIL.board, mat4((ax + bx) / 2, (ya + yb) / 2 - h / 2, (az + bz) / 2, Math.atan2(-dz, dx), 1, 1, 1, rng.float(-0.02, 0.02), Math.atan2(yb - ya, L)), tint(), len);
      }
      s0 = s1 + rng.float(0.01, 0.04);
    }
  }
  batcher.add(mergeParts(parts), M.timber);
}

// ---------------------------------------------------------------- the verges
// Grass along both sides, drifts of wildflowers, trees a few metres off the tread (never over it at head height) and
// big stones round the outside of each hairpin, all from its own random stream. ok(x, z): false where nothing may grow
// (by the shed, round the observatory); treeOk the same for trees; avoid: trees already there ({ x, z }), kept 3.2 m
// from. The trees bring their own rotation and tint, so they draw nothing from the forest's stream. Returns them.
export function dressTrail(ctx, stack, trail, collider, { seed = 71, ok = () => true, treeOk = ok, avoid = [] } = {}) {
  const rng = new Rng(seed);
  const q = {};
  const hw = TRAIL.width / 2;
  const slopeOk = (x, z, ny) => stack.normalAt(x, z).y > ny;
  // Grass tufts: two or three either side every half metre, thickest just outside the boards.
  for (let s = 0.8; s < trail.total; s += 0.5) {
    const f = trail.path.pointAt(s), len = Math.hypot(f.dx, f.dz) || 1, nx = -f.dz / len, nz = f.dx / len;
    for (const side of [-1, 1]) {
      for (let k = rng.int(1, 3); k > 0; k--) {
        const o = side * (hw + 0.14 + Math.pow(rng.next(), 1.6) * 1.3), a = rng.float(-0.25, 0.25);
        const x = f.x + nx * o + f.dx / len * a, z = f.z + nz * o + f.dz / len * a;
        const sz = rng.float(0.65, 1.15);
        if (!ok(x, z) || trail.near(x, z, q).d < hw + 0.12 || !slopeOk(x, z, 0.5)) continue;
        const y = stack.heightAt(x, z);
        if (y !== null) ctx.meadow.add(x, y, z, sz);
      }
    }
  }
  // Wildflowers: a drift every 7-13 m, alternating sides, just off the tread.
  const flowers = new Flowers(seed + 1);
  let side = rng.sign();
  for (let s = 4; s < trail.total - 3; s += rng.float(7, 13)) {
    const f = trail.path.pointAt(s), len = Math.hypot(f.dx, f.dz) || 1;
    side = -side;
    const o = side * (hw + rng.float(0.9, 1.6));
    const cx = f.x - f.dz / len * o, cz = f.z + f.dx / len * o;
    if (!ok(cx, cz)) continue;
    const kinds = [rng.int(0, 3), rng.int(0, 3)];
    flowers.patch(stack, cx, cz, rng.float(1.1, 2.0), rng.int(9, 20), kinds, (x, z) => ok(x, z) && trail.near(x, z, q).d > hw + 0.2 && slopeOk(x, z, 0.55), rng);
  }
  flowers.build(ctx.surface, ctx.lod);
  // Trees: now and then beside the path, 3-6 m off it, never within reach of another arm, and with no bough over the
  // tread lower than TREE_HEAD over it (crownClear).
  const trees = [];
  const clearOf = (x, z, r) => trees.concat(avoid).every((t) => Math.hypot(t.x - x, t.z - z) > r + (t.r ?? 0));
  for (let s = 5; s < trail.total - 6; s += rng.float(5, 9)) {
    const f = trail.path.pointAt(s), len = Math.hypot(f.dx, f.dz) || 1;
    const sp = rng.next() < 0.78 ? 'pine' : 'broadleaf', sc = rng.float(0.6, 1.0), o = rng.sign() * rng.float(3.0, 6.0);
    const rotY = rng.float(0, Math.PI * 2), tint = Forest.tint(rng);
    const x = f.x - f.dz / len * o, z = f.z + f.dx / len * o;
    if (!treeOk(x, z) || !clearOf(x, z, 3.2) || !slopeOk(x, z, 0.62)) continue;
    trail.near(x, z, q);
    if (q.d < 2.9 || q.d2 < 3.2) continue;
    const y = stack.heightAt(x, z);
    if (y === null || !crownClear(ctx.forest, trail, sp, x, y, z, sc)) continue;
    ctx.forest.add(sp, x, y, z, sc, rotY, tint);
    collider.addCylinder(x, y - 0.5, z, ctx.forest.radiusOf(sp) * sc + 0.08, 4, 6);
    trees.push({ x, z, r: 0 });
  }
  // Big stones round the outside of each hairpin, a low dry-stone kerb.
  const stoneGeo = ctx.pebbles.geometries[0];
  for (const t of trail.turns) {
    const R = t.w + hw + 0.5;
    for (let ph = 0.1; ph < Math.PI - 0.05; ph += 0.55 / R) {
      // Round the far side of the turn: about its centre, from the arm it arrives on to the one it leaves by.
      const rx = Math.cos(t.theta), rz = Math.sin(t.theta), tx = -rz * t.sg, tz = rx * t.sg;
      const x = t.x + (rx * Math.cos(ph) + tx * Math.sin(ph)) * R, z = t.z + (rz * Math.cos(ph) + tz * Math.sin(ph)) * R;
      if (trail.near(x, z, q).d < hw + 0.35) continue;
      const y = stack.heightAt(x, z);
      if (y !== null) ctx.pebbles.addAt(x, y + 0.08, z, rng.float(0.3, 0.42), stoneGeo);
    }
  }
  // Stones fallen to the foot of the cut bank, along the uphill side, so the bank doesn't meet the edging bare.
  for (let s = 1; s < trail.total - 1; s += rng.float(0.9, 2.4)) {
    const f = trail.path.pointAt(s), len = Math.hypot(f.dx, f.dz) || 1, nx = -f.dz / len, nz = f.dx / len;
    const hl = stack.heightAt(f.x + nx * 2.2, f.z + nz * 2.2), hr = stack.heightAt(f.x - nx * 2.2, f.z - nz * 2.2);
    if (hl === null || hr === null || Math.abs(hl - hr) < 0.6) continue;
    const side = hl > hr ? 1 : -1, o = side * (hw + rng.float(0.3, 0.75)), a = rng.float(-0.3, 0.3);
    const x = f.x + nx * o + f.dx / len * a, z = f.z + nz * o + f.dz / len * a;
    const sc = 0.08 + Math.pow(rng.next(), 2.2) * 0.3, geo = ctx.pebbles.geometries[rng.int(0, 2)];
    if (!ok(x, z) || trail.near(x, z, q).d < hw + 0.2) continue;
    const y = stack.heightAt(x, z);
    if (y !== null) ctx.pebbles.addAt(x, y + sc * 0.2, z, sc, geo);
  }
  return trees;
}
