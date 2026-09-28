import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { patchMaterial } from '../render/materials.js';
import { tnoise, once } from '../render/textures.js';
import { InstancedLod } from '../render/lod.js';

// Wildflower clumps in drifts: four kinds, each one instanced geometry of crossed stem cards plus tilted blossom
// cards, all sharing one procedural atlas and one wind-swayed cut-out material.

export const FLOWER_KINDS = 4;
const NAMES = ['daisy', 'buttercup', 'poppy', 'lupine'];
const OUT = [26, 40];
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- atlas layout
// 512² with v up: four tall stem cells across the top, four square blossom/leaf cells along the bottom. Every
// cell keeps PAD transparent pixels around its drawable area so mip levels don't bleed between cells.
const S = 512, PAD = 8, CW = 128, SH = 384, ANISO = 8;
const IW = CW - PAD * 2, IH = SH - PAD * 2;     // stem drawable area, 112 × 368 px
const HR = (CW - PAD * 2) / 2, R = HR - 2;      // blossom cell half-size and blossom radius, px
const stemRect = (k) => [(k * CW + PAD) / S, (CW + PAD) / S, (k * CW + CW - PAD) / S, (S - PAD) / S];
const headRect = (k) => [(k * CW + PAD) / S, PAD / S, (k * CW + CW - PAD) / S, (CW - PAD) / S];

// Stalks are drawn in stem-cell pixels (x across 0..IW, y up 0..IH); geometry puts a blossom card on each stalk
// with `head`, so the two always line up. h: card height (m), head: blossom diameter (m), tilt: blossom tilt
// from facing straight up (radians).
const KINDS = [
  {
    h: 0.42, head: 0.066, tilt: [0.55, 1.15],
    stalks: [
      { x0: 54, x1: 44, top: 356, bow: -5, w0: 1.7, w1: 1.1, head: true },
      { x0: 58, x1: 82, top: 284, bow: 6, w0: 1.6, w1: 1.1, head: true },
      { x0: 56, x1: 30, top: 212, bow: -4, w0: 1.4, w1: 1.0 },
    ],
  },
  {
    h: 0.36, head: 0.044, tilt: [0.45, 1.05],
    stalks: [
      { x0: 54, x1: 40, top: 358, bow: -8, w0: 1.6, w1: 1.0, head: true },
      { x0: 57, x1: 88, top: 316, bow: 8, w0: 1.5, w1: 1.0, head: true },
      { x0: 56, x1: 68, top: 248, bow: 3, w0: 1.3, w1: 0.9 },
    ],
  },
  {
    h: 0.46, head: 0.08, tilt: [0.4, 1.0],
    stalks: [
      { x0: 55, x1: 44, top: 358, bow: -6, w0: 2.0, w1: 1.4, head: true },
      { x0: 57, x1: 84, top: 298, bow: 7, w0: 1.9, w1: 1.3, head: true },
      { x0: 56, x1: 34, top: 246, bow: -4, w0: 1.7, w1: 1.2 },
    ],
  },
  {
    h: 0.48,
    stalks: [{ x0: 56, x1: 58, top: 362, bow: 3, w0: 2.6, w1: 1.2 }],
  },
];

// ---------------------------------------------------------------- painting
// Colours are sRGB 0..1. Each shape reports a signed distance in pixels (< 0 inside) and its colour there; the
// painter composites them with a one-pixel soft edge and remembers the nearest shape's colour, which becomes the
// RGB of transparent texels so filtering never pulls dark fringes into the cut-out edges. Shapes skip texels more
// than NEAR px outside themselves, which then take the cell's fill colour.
const NEAR = 3;
const col = [0, 0, 0];
const P = {
  r: 0, g: 0, b: 0, a: 0, nd: 0, nr: 0, ng: 0, nb: 0,
  begin(fb) { this.r = this.g = this.b = this.a = 0; this.nd = 1e9; this.nr = fb[0]; this.ng = fb[1]; this.nb = fb[2]; },
  paint(d) {
    if (d < this.nd) { this.nd = d; this.nr = col[0]; this.ng = col[1]; this.nb = col[2]; }
    const c = d >= 0.5 ? 0 : d <= -0.5 ? 1 : 0.5 - d;
    if (c <= 0) return;
    const k = 1 - c;
    this.r = col[0] * c + this.r * k; this.g = col[1] * c + this.g * k; this.b = col[2] * c + this.b * k;
    this.a = c + this.a * k;
  },
  write(data, i, visible) {
    const a = visible ? this.a : 0;
    const w = this.a > 0 ? 1 / this.a : 0;
    const r = this.a > 0 ? this.r * w : this.nr, g = this.a > 0 ? this.g * w : this.ng, b = this.a > 0 ? this.b * w : this.nb;
    data[i] = to8(r); data[i + 1] = to8(g); data[i + 2] = to8(b); data[i + 3] = to8(a);
  },
};
const to8 = (v) => (Math.min(Math.max(v, 0), 1) * 255 + 0.5) | 0;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 17.3) * 43758.5453; return s - Math.floor(s); };
function shade(c, s) { col[0] = Math.min(1, c[0] * s); col[1] = Math.min(1, c[1] * s); col[2] = Math.min(1, c[2] * s); }
function shadeMix(c1, c2, t, s) {
  for (let i = 0; i < 3; i++) col[i] = Math.min(1, (c1[i] + (c2[i] - c1[i]) * t) * s);
}

const STEM = [0.3, 0.42, 0.15], LEAF = [0.25, 0.38, 0.12], POPPY_LEAF = [0.33, 0.41, 0.23];
const DAISY = [0.93, 0.92, 0.87], DISC = [0.96, 0.74, 0.13], DISC_RIM = [0.74, 0.46, 0.05];
const GOLD = [1.0, 0.82, 0.1], GOLD_BASE = [0.84, 0.6, 0.05], GLOSS = [1.0, 0.97, 0.72];
const SCARLET = [0.88, 0.13, 0.08], BLOTCH = [0.09, 0.05, 0.07], CAPSULE = [0.5, 0.55, 0.36];
const LUPINE = [0.42, 0.37, 0.86], LUPINE_DEEP = [0.27, 0.21, 0.62], BANNER = [0.87, 0.85, 0.96], LUPINE_BUD = [0.44, 0.52, 0.34];

const along = (s, t) => [s.x0 + (s.x1 - s.x0) * t + s.bow * Math.sin(Math.PI * t), s.top * t];

// A round stem, lit a little from one side and darker toward the ground.
function stalk(s) {
  const { x0, x1, top, bow, w0, w1 } = s;
  const m = Math.abs(bow) + w0 + 3;
  return {
    box: [Math.min(x0, x1) - m, -PAD, Math.max(x0, x1) + m, top + w1 + 3],
    draw(X, Y) {
      const t = clamp01(Y / top);
      const xc = x0 + (x1 - x0) * t + bow * Math.sin(Math.PI * t), hw = w0 + (w1 - w0) * t, dx = X - xc;
      const d = Y > top ? Math.hypot(dx, Y - top) - hw : Math.abs(dx) - hw;
      if (d > NEAR) return;
      const q = Math.max(-1, Math.min(1, dx / hw));
      shade(STEM, (0.7 + 0.32 * Math.sqrt(1 - q * q) - 0.06 * q) * (0.78 + 0.22 * t));
      P.paint(d);
    },
  };
}

// A lance-shaped leaf from (x, y) at angle `ang` from vertical, arching down by `droop` px at the tip, with
// optional saw teeth (count) of relative depth `cut`.
function leaf({ x, y, ang, len, wid, droop = 0, teeth = 0, cut = 0.3, c = LEAF }) {
  const ux = Math.sin(ang), uy = Math.cos(ang), tx = x + ux * len, ty = y + uy * len - droop, m = wid + 3;
  return {
    box: [Math.min(x, tx) - m, Math.min(y, ty) - m, Math.max(x, tx) + m, Math.max(y, ty) + m],
    draw(X, Y) {
      const px = X - x;
      let py = Y - y;
      const s0 = clamp01((px * ux + py * uy) / len);
      py += droop * s0 * s0;
      const a = px * ux + py * uy, b = px * uy - py * ux, s = clamp01(a / len);
      if (Math.abs(b) > wid + NEAR) return;
      let hw = wid * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8);
      if (teeth) hw *= 1 - cut * ((s * teeth) % 1);
      const d = Math.max(Math.abs(b) - hw, -a, a - len);
      if (d > NEAR) return;
      const q = hw > 0 ? Math.max(-1, Math.min(1, b / hw)) : 0;
      // Folded along the midrib: one half catches more light; the rib itself is paler.
      shade(c, (0.8 + 0.14 * q) * (0.82 + 0.26 * s) * (Math.abs(b) < 0.8 ? 1.18 : 1));
      P.paint(d);
    },
  };
}

// An oval bud; above `tipFrom` (in local -1..1 along its axis) it shows the petal colour.
function bud({ x, y, rx, ry, ang = 0, c, tip, tipFrom = 0.3 }) {
  const cs = Math.cos(ang), sn = Math.sin(ang), r = Math.max(rx, ry) + 3;
  return {
    box: [x - r, y - r, x + r, y + r],
    draw(X, Y) {
      const dx = X - x, dy = Y - y;
      const lx = (dx * cs + dy * sn) / rx, ly = (-dx * sn + dy * cs) / ry;
      const k = Math.hypot(lx, ly), d = (k - 1) * Math.min(rx, ry);
      if (d > NEAR) return;
      shadeMix(c, tip || c, smooth(tipFrom - 0.1, tipFrom + 0.1, ly), 1.05 - 0.35 * k * k);
      P.paint(d);
    },
  };
}

// Lupine raceme: whorls of pea florets around a tapering spike, painted back to front, buds toward the tip.
function raceme(s, y0, y1) {
  const sp = 7, width = (t) => 2.5 + 15 * (1 - Math.pow(t, 1.3));
  const rows = [], hits = [];
  for (let j = 0; y0 + j * sp <= y1; j++) {
    const yj = y0 + j * sp, t = (yj - y0) / (y1 - y0), W = width(t), xc = along(s, yj / s.top)[0], row = [];
    for (let f = 0; f < 5; f++) {
      const phi = f * TAU / 5 + j * 0.9, z = Math.cos(phi), h = hash(j * 5 + f);
      if (z < -0.4) continue;
      // Open florets are violet with a paler banner (some nearly white); the youngest near the tip are buds.
      const bud = t > 0.78;
      row.push({
        z, x: xc + Math.sin(phi) * W * 0.8, y: yj + z * 1.5, rx: W * 0.42 * (0.7 + 0.3 * z) + 1.3, ry: sp * (0.66 + 0.12 * z),
        base: bud ? LUPINE_BUD : h < 0.35 ? LUPINE_DEEP : LUPINE, top: bud ? LUPINE : BANNER,
        banner: bud ? 0.35 * h : h < 0.25 ? 0.75 : 0.25, bud, light: 0.62 + 0.38 * Math.max(z, 0),
      });
    }
    rows.push(row);
  }
  const ax = [y0, y1].map((y) => along(s, y / s.top)[0]), reach = width(0) * 1.3 + 3 + Math.abs(s.bow);
  return {
    box: [Math.min(...ax) - reach, y0 - 12, Math.max(...ax) + reach, y1 + 10],
    draw(X, Y) {
      // The spike's core shows dark between the florets.
      const core = width(clamp01((Y - y0) / (y1 - y0))) * 0.5;
      const t = Y / s.top, xc = s.x0 + (s.x1 - s.x0) * t + s.bow * Math.sin(Math.PI * t);
      const d = Math.max(Math.abs(X - xc) - core, y0 - 6 - Y, Y - y1 - 2);
      if (d < NEAR) { shade(LUPINE_DEEP, 0.45); P.paint(d); }
      hits.length = 0;
      const j0 = Math.floor((Y - y0) / sp);
      for (let j = Math.max(0, j0 - 2); j <= Math.min(rows.length - 1, j0 + 2); j++) {
        for (const f of rows[j]) if (Math.abs(X - f.x) < f.rx + 1 && Math.abs(Y - f.y) < f.ry + 1) hits.push(f);
      }
      if (hits.length > 1) hits.sort((a, b) => a.z - b.z);
      for (const f of hits) {
        const lx = (X - f.x) / f.rx, ly = (Y - f.y) / f.ry, k = Math.hypot(lx, ly);
        const light = f.light * (1.02 - 0.22 * k * k) * (1 - 0.3 * smooth(0.7, 1, k));
        shadeMix(f.base, f.top, f.bud ? f.banner : f.banner * smooth(0, 0.45, ly), light);
        P.paint((k - 1) * Math.min(f.rx, f.ry));
      }
    },
  };
}

// Side view of a lupine leaf: a petiole ending in a fan of drooping leaflets.
function fan(x, y, ang, len) {
  const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
  const out = [leaf({ x, y, ang, len, wid: 1.2, c: STEM })];
  for (let i = 0; i < 6; i++) out.push(leaf({ x: ex, y: ey, ang: ang + (i - 2.5) * 0.42, len: 24, wid: 3.2, droop: 9, c: LEAF }));
  return out;
}

function stemShapes(kind) {
  const st = KINDS[kind].stalks;
  const at = (i, t) => { const [x, y] = along(st[i], t); return { x, y }; };
  const stalks = st.map(stalk);
  if (kind === 0) {
    return [
      leaf({ x: 56, y: 1, ang: -1.0, len: 70, wid: 8, droop: 18, teeth: 7 }),
      leaf({ x: 56, y: 1, ang: 0.9, len: 62, wid: 7, droop: 14, teeth: 6 }),
      leaf({ x: 56, y: 1, ang: -0.25, len: 48, wid: 6, droop: 6, teeth: 5 }),
      ...stalks,
      leaf({ ...at(0, 0.3), ang: -0.6, len: 30, wid: 3.8, droop: 4, teeth: 5 }),
      leaf({ ...at(1, 0.45), ang: 0.7, len: 26, wid: 3.4, droop: 4, teeth: 4 }),
      bud({ ...at(2, 1), rx: 6, ry: 5, c: LEAF, tip: DAISY, tipFrom: 0.2 }),
    ];
  }
  if (kind === 1) {
    const b0 = at(0, 0.45), b1 = at(1, 0.5);
    return [
      ...[-1.1, -0.2, 0.9].map((a, i) => leaf({ x: 56, y: 1, ang: a, len: 44 - i * 4, wid: 11, droop: 10, teeth: 3, cut: 0.45 })),
      ...stalks,
      ...[-0.9, -0.5, -0.1].map((a) => leaf({ ...b0, ang: a, len: 22, wid: 2.4, droop: 3 })),
      ...[0.3, 0.7, 1.1].map((a) => leaf({ ...b1, ang: a, len: 20, wid: 2.2, droop: 3 })),
      bud({ ...at(2, 1), rx: 5, ry: 5, c: LEAF, tip: GOLD, tipFrom: 0.35 }),
    ];
  }
  if (kind === 2) {
    const t = at(2, 1);
    return [
      leaf({ x: 56, y: 1, ang: -0.9, len: 80, wid: 12, droop: 20, teeth: 6, cut: 0.5, c: POPPY_LEAF }),
      leaf({ x: 56, y: 1, ang: 0.8, len: 72, wid: 11, droop: 16, teeth: 5, cut: 0.5, c: POPPY_LEAF }),
      leaf({ x: 56, y: 1, ang: 0.1, len: 55, wid: 9, droop: 6, teeth: 4, cut: 0.45, c: POPPY_LEAF }),
      ...stalks,
      leaf({ ...at(0, 0.3), ang: -0.8, len: 34, wid: 6, droop: 5, teeth: 4, cut: 0.45, c: POPPY_LEAF }),
      // The bud nods from a hooked stalk.
      bud({ x: t.x - 4, y: t.y - 10, rx: 6.5, ry: 10, ang: Math.PI - 0.45, c: POPPY_LEAF, tip: [0.55, 0.12, 0.08], tipFrom: 0.72 }),
    ];
  }
  const p0 = at(0, 70 / st[0].top), p1 = at(0, 108 / st[0].top);
  return [...fan(p0.x, p0.y, 1.0, 30), ...fan(p1.x, p1.y, -1.1, 26), ...stalks, raceme(st[0], 150, 356)];
}

// Neighbouring rays first, then the nearest one on top.
const NEIGHBOURS = [-1, 1, 0];

function daisy(x, y) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x);
  const N = 21, pitch = TAU / N, k0 = Math.round(th / pitch);
  for (const o of NEIGHBOURS) {
    const k = k0 + o, kk = ((k % N) + N) % N, dl = th - k * pitch;
    const a = r * Math.cos(dl), b = r * Math.sin(dl);
    const L = R * (0.84 + 0.16 * hash(kk)), pw = R * (0.095 + 0.03 * hash(kk + 31));
    if (Math.abs(b) > pw + NEAR) continue;
    const hw = pw * Math.sqrt(clamp01((L - a) / (pw * 1.3))) * (0.55 + 0.45 * smooth(R * 0.12, R * 0.45, a));
    const d = Math.max(Math.abs(b) - hw, R * 0.15 - a, a - L);
    if (d > NEAR) continue;
    const q = hw > 0 ? Math.min(1, Math.abs(b) / hw) : 1;
    // Greyer toward the disc, faint lengthwise grooves, darker rims so overlapping rays stay apart.
    shade(DAISY, (0.7 + 0.3 * smooth(R * 0.2, R * 0.62, a)) * (0.95 + 0.05 * Math.cos(q * 5)) * (0.92 + 0.08 * hash(kk + 7)) * (1 - 0.14 * q * q));
    P.paint(d);
  }
  const rd = R * 0.25;
  if (r > rd + 3) return;
  shadeMix(DISC_RIM, DISC, 1 - smooth(0.3, 1, r / rd), 0.8 + 0.32 * tnoise(x / (2 * HR) + 0.5, y / (2 * HR) + 0.5, 30, 3));
  P.paint(r - rd);
}

function buttercup(x, y) {
  const r = Math.hypot(x, y);
  for (let k = 0; k < 5; k++) {
    const pa = k * TAU / 5 + 0.3 * (hash(k + 90) - 0.5), ux = Math.cos(pa), uy = Math.sin(pa);
    const a = x * ux + y * uy, b = -x * uy + y * ux;
    const pr = R * 0.45, ea = a - R * 0.54, dist = Math.hypot(ea, b * 1.06);
    const d = Math.max(dist - pr, Math.abs(b) - a * 0.75 - R * 0.06);
    if (d > NEAR) continue;
    // Cupped, waxy petals narrowing to the base: deeper gold inside, a soft gloss streak, a thin darker rim.
    const gl = Math.exp(-((ea + pr * 0.1) ** 2 + (b * 2.2) ** 2) / (pr * 0.45) ** 2);
    shadeMix(GOLD_BASE, GOLD, smooth(R * 0.05, R * 0.6, a), 1 - 0.2 * smooth(pr - 3, pr, dist));
    for (let i = 0; i < 3; i++) col[i] += (GLOSS[i] - col[i]) * gl * 0.45;
    P.paint(d);
  }
  if (r > R * 0.3) return;
  const th = Math.atan2(y, x), k0 = Math.round(th / (TAU / 18)), sa = k0 * TAU / 18, sr = R * (0.2 + 0.03 * hash(((k0 % 18) + 18) % 18 + 40));
  shade(GOLD, 0.92);
  P.paint(Math.hypot(x - Math.cos(sa) * sr, y - Math.sin(sa) * sr) - R * 0.05);
  shade([0.55, 0.62, 0.12], (1.05 - 0.4 * (r / (R * 0.14)) ** 2) * (0.85 + 0.3 * tnoise(x / (2 * HR) + 0.5, y / (2 * HR) + 0.5, 40, 9)));
  P.paint(r - R * 0.14);
}

// Periodic noise around a circle, tabulated because the blossoms sample it for every pixel.
function ringNoise(p, seed, n = 256) {
  const t = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) t[i] = tnoise(i / n, 0.5, p, seed);
  return (u) => { const f = (u - Math.floor(u)) * n, i = f | 0; return t[i] + (t[i + 1] - t[i]) * (f - i); };
}
// Blotch outline, vein wobble, then one crumpled outline per petal.
const POPPY_NOISE = [ringNoise(9, 21), ringNoise(7, 13), ...[0, 1, 2, 3].map((i) => ringNoise(11, 5 + i))];

// Two broad outer petals underneath, two inner ones over them.
const POPPY_PETALS = [[0.2, 0.42, 0.58, 1], [0.2 + Math.PI, 0.42, 0.58, 1], [0.2 + Math.PI / 2, 0.36, 0.52, 0.86], [0.2 + Math.PI * 1.5, 0.36, 0.52, 0.86]];
function poppy(x, y) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x), tu = th / TAU;
  const blotch = R * 0.26 * (1 + 0.35 * (POPPY_NOISE[0](tu) - 0.5));
  // Silky crumpled petals: radial striations, lighter toward the thin rim, a black blotch at the base.
  const vein = 0.92 + 0.08 * Math.sin(th * 46 + 9 * POPPY_NOISE[1](tu));
  for (let i = 0; i < 4; i++) {
    const [pa, pc, pr, dark] = POPPY_PETALS[i], ux = Math.cos(pa), uy = Math.sin(pa);
    const ea = x * ux + y * uy - pc * R, b = -x * uy + y * ux;
    const dist = Math.hypot(ea, b);
    if (dist > R * pr * 1.08 + NEAR) continue;
    const edge = R * pr * (1 + 0.16 * (POPPY_NOISE[2 + i](Math.atan2(b, ea) / TAU) - 0.5));
    if (dist - edge > NEAR) continue;
    shadeMix(SCARLET, BLOTCH, smooth(blotch + 2.5, blotch - 2.5, r), dark * vein * (0.82 + 0.2 * smooth(0, edge, dist)) * (1 - 0.18 * smooth(edge - 3, edge, dist)));
    P.paint(dist - edge);
  }
  if (r > R * 0.25) return;
  shade(BLOTCH, 1.2);
  P.paint(Math.abs(r - R * 0.15) - R * 0.045);
  const k0 = Math.round(th / (TAU / 30)), sa = k0 * TAU / 30, sr = R * (0.16 + 0.03 * hash(((k0 % 30) + 30) % 30 + 3));
  shade([0.14, 0.1, 0.14], 1);
  P.paint(Math.hypot(x - Math.cos(sa) * sr, y - Math.sin(sa) * sr) - R * 0.035);
  const ray = Math.pow(Math.abs(Math.cos(4 * th)), 12) * smooth(R * 0.02, R * 0.08, r);
  shadeMix(CAPSULE, [0.28, 0.2, 0.3], ray, 1.08 - 0.35 * (r / (R * 0.11)) ** 2);
  P.paint(r - R * 0.11);
}

// Palmate lupine leaf seen from above: nine lance leaflets around the petiole, edged silver by fine hairs.
function lupineLeaf(x, y) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x);
  const N = 9, pitch = TAU / N, k0 = Math.round(th / pitch);
  for (const o of NEIGHBOURS) {
    const k = k0 + o, kk = ((k % N) + N) % N, dl = th - k * pitch;
    const a = r * Math.cos(dl), b = r * Math.sin(dl), L = R * (0.84 + 0.16 * hash(kk + 60));
    if (Math.abs(b) > R * 0.12 + NEAR) continue;
    const s = clamp01(a / L), hw = R * 0.12 * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.7)), 0.8);
    const d = Math.max(Math.abs(b) - hw, 2 - a, a - L);
    if (d > NEAR) continue;
    const q = hw > 0 ? Math.min(1, Math.abs(b) / hw) : 1;
    shadeMix(LEAF, [0.5, 0.58, 0.44], 0.35 * smooth(0.6, 1, q), (0.72 + 0.3 * smooth(0, 0.5, s)) * (Math.abs(b) < 0.8 ? 1.15 : 1) * (0.92 + 0.1 * hash(kk)));
    P.paint(d);
  }
  shade(STEM, 0.8);
  P.paint(r - 2.5);
}
const HEADS = [daisy, buttercup, poppy, lupineLeaf];
const HEAD_FILL = [DAISY, GOLD, SCARLET, LEAF];

function paintCell(data, x0, y0, w, h, shapes, fill) {
  const row = [], f8 = fill.map(to8);
  for (let py = 0; py < h; py++) {
    const Y = py - PAD + 0.5;
    row.length = 0;
    for (const s of shapes) if (Y >= s.box[1] && Y <= s.box[3]) row.push(s);
    for (let px = 0; px < w; px++) {
      const X = px - PAD + 0.5, o = ((y0 + py) * S + x0 + px) * 4;
      let hit = false;
      for (let i = 0; i < row.length; i++) {
        if (X < row[i].box[0] || X > row[i].box[2]) continue;
        if (!hit) { P.begin(fill); hit = true; }
        row[i].draw(X, Y);
      }
      // Texels no shape reaches stay transparent (the buffer starts zeroed) in the fill colour.
      if (hit) P.write(data, o, X > 0 && X < w - PAD * 2 && Y > 0 && Y < h - PAD * 2);
      else { data[o] = f8[0]; data[o + 1] = f8[1]; data[o + 2] = f8[2]; }
    }
  }
}

// Raw RGBA rather than a canvas: a 2D canvas stores premultiplied alpha and would zero the colour under every
// transparent texel, which mipmapping then smears into dark rims around the white daisy rays.
function atlasData() {
  const data = new Uint8Array(S * S * 4);
  for (let k = 0; k < FLOWER_KINDS; k++) {
    paintCell(data, k * CW, CW, CW, SH, stemShapes(k), STEM);
    const f = HEADS[k];
    const draw = (X, Y) => { const x = X - HR, y = Y - HR; if (x * x + y * y < (R + 4) ** 2) f(x, y); };
    paintCell(data, k * CW, 0, CW, CW, [{ box: [-PAD, -PAD, CW, CW], draw }], HEAD_FILL[k]);
  }
  return data;
}

function atlas() {
  return once('flowerAtlas', () => {
    const t = new THREE.DataTexture(atlasData(), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = ANISO;
    t.needsUpdate = true;
    return t;
  });
}

// ---------------------------------------------------------------- geometry
const Z = new THREE.Vector3(0, 0, 1);

function geometry(kind) {
  const K = KINDS[kind], rng = new Rng(31 + kind * 17);
  const pos = [], uv = [], idx = [];
  const quad = (a, b, c, d, [u0, v0, u1, v1]) => {
    const i = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p.x, p.y, p.z);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  // A vertical stem card; returns the mapping from stem-cell pixels to local position.
  const card = (yaw, h, mirror, ox = 0, oz = 0) => {
    const w = h * IW / IH, ex = Math.cos(yaw), ez = -Math.sin(yaw);
    const at = (X, Y) => {
      const s = (mirror ? 0.5 - X / IW : X / IW - 0.5) * w;
      return new THREE.Vector3(ox + ex * s, (Y / IH) * h, oz + ez * s);
    };
    quad(at(0, 0), at(IW, 0), at(IW, IH), at(0, IH), stemRect(kind));
    return at;
  };
  // A blossom (or leaf) card centred on c, facing up tilted by `tilt` toward `dir`, spun about its own axis.
  const head = (rect, c, size, tilt, dir, spin) => {
    const n = new THREE.Vector3(Math.sin(tilt) * Math.cos(dir), Math.cos(tilt), Math.sin(tilt) * Math.sin(dir));
    const q = new THREE.Quaternion().setFromUnitVectors(Z, n).multiply(new THREE.Quaternion().setFromAxisAngle(Z, spin));
    const p = (x, y) => new THREE.Vector3(x * size / 2, y * size / 2, 0).applyQuaternion(q).add(c).addScaledVector(n, 0.004);
    quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), rect);
  };

  if (kind < 3) {
    // Two crossed stem cards (the second shorter and mirrored); a blossom tops every flowering stalk on each.
    for (const [yaw, hk, mirror] of [[rng.float(0, 0.3), 1, false], [rng.float(1.3, 1.8), 0.8, true]]) {
      const at = card(yaw, K.h * hk, mirror);
      for (const s of K.stalks) {
        if (!s.head) continue;
        const top = at(s.x1, s.top);
        const out = Math.atan2(top.z, top.x) + rng.float(-0.35, 0.35);
        head(headRect(kind), top, K.head * (mirror ? 0.9 : 1), rng.float(K.tilt[0], K.tilt[1]), out, rng.float(0, TAU));
      }
    }
  } else {
    // A full spike from three cards, a younger one beside it from two, and two palmate leaves low down.
    for (let i = 0; i < 3; i++) card(0.2 + i * Math.PI / 3, K.h, i === 1);
    const oa = rng.float(0, TAU), ox = Math.cos(oa) * 0.08, oz = Math.sin(oa) * 0.08;
    for (let i = 0; i < 2; i++) card(0.9 + i * Math.PI / 2, K.h * 0.7, i === 0, ox, oz);
    const la = oa + Math.PI * 0.8;
    head(headRect(3), new THREE.Vector3(Math.cos(la) * 0.05, 0.1, Math.sin(la) * 0.05), 0.15, 0.25, la, rng.float(0, TAU));
    head(headRect(3), new THREE.Vector3(Math.cos(la + 2.2) * 0.05, 0.06, Math.sin(la + 2.2) * 0.05), 0.12, 0.3, la + 2.2, rng.float(0, TAU));
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Up-facing normals, like the grass, so thin cards shade like the meadow around them.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

let shared = null;
function assets() {
  if (shared) return shared;
  const material = new THREE.MeshStandardMaterial({ map: atlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.5, name: 'flowers' });
  material.alphaToCoverage = true;
  // Keep the up normal on back faces too: mirrored instances and nodding heads show their backs, and a flipped
  // normal would shade them like the underside of the ground.
  // Without MSAA the coverage test is a hard 0.5 cut, and box-filtered mips thin the 2-4 texel stalks below it from
  // ~5 m out, leaving blossoms afloat. So stem cells (above v = CW / S) gain alpha with the mip level the sampler
  // picks (the minor axis, up to ANISO:1), which keeps each stalk about a pixel wide out to the fade band.
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 mx = dFdx( vMapUv ) * ${S.toFixed(1)}, my = dFdy( vMapUv ) * ${S.toFixed(1)};
          float px = dot( mx, mx ), py = dot( my, my );
          float mip = max( 0.0, 0.5 * log2( max( max( min( px, py ), max( px, py ) / ${(ANISO * ANISO).toFixed(1)} ), 1e-8 ) ) );
          diffuseColor.a *= 1.0 + 0.75 * mip * step( ${(CW / S).toFixed(2)}, vMapUv.y ); }`)
      .replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;');
  };
  patchMaterial(material, { wind: { sway: 0.4, flutter: 0.012 } });
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = () => key() + '|flower';
  shared = { material, geometries: KINDS.map((_, k) => geometry(k)) };
  return shared;
}

// ---------------------------------------------------------------- placement
export class Flowers {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.items = KINDS.map(() => []);
  }

  add(x, y, z, kind, scale = 1) { this.items[kind].push(x, y, z, scale); }

  // A drift of about `count` clumps: a ragged, stretched blob thickest in the middle plus a few tight sub-clumps,
  // with the kinds sorted along a random axis so each keeps mostly to its own side.
  patch(stack, cx, cz, radius, count, kinds, accept, rng) {
    const axis = rng.float(0, TAU), ax = Math.cos(axis), az = Math.sin(axis), squash = 1 / rng.float(1, 1.7);
    const l1 = rng.float(0, TAU), l2 = rng.float(0, TAU);
    const clumps = [];
    for (let i = rng.int(2, 4); i > 0; i--) {
      const a = rng.float(0, TAU), d = rng.float(0.2, 0.55);
      clumps.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    const sort = rng.float(0, TAU), sx = Math.cos(sort), sz = Math.sin(sort);
    const placed = [];
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 3; tries++) {
        let u, v;   // in units of radius, before stretching
        if (rng.next() < 0.4) {
          const c = rng.pick(clumps), a = rng.float(0, TAU), d = Math.sqrt(rng.next()) * 0.28;
          u = c[0] + Math.cos(a) * d; v = c[1] + Math.sin(a) * d;
        } else {
          // Truncated Gaussian falloff (30% of the peak density at the rim) inside a lobed outline.
          const a = rng.float(0, TAU), rim = 1 + 0.22 * Math.sin(2 * a + l1) + 0.12 * Math.sin(3 * a + l2);
          const d = rim * Math.sqrt(-Math.log(1 - rng.next() * 0.7) / Math.log(1 / 0.3));
          u = Math.cos(a) * d; v = Math.sin(a) * d;
        }
        v *= squash;
        if (u * u + v * v > 1) continue;
        const dx = (u * ax - v * az) * radius, dz = (u * az + v * ax) * radius;
        const x = cx + dx, z = cz + dz;
        let near = false;
        for (let j = 0; j < placed.length && !near; j += 2) near = (placed[j] - x) ** 2 + (placed[j + 1] - z) ** 2 < 0.04;
        if (near || !accept(x, z)) continue;
        const y = stack.heightAt(x, z);
        if (y == null) continue;
        const side = (dx * sx + dz * sz) / radius + rng.float(-0.5, 0.5);
        const kind = kinds[Math.min(kinds.length - 1, Math.max(0, Math.floor((side * 0.5 + 0.5) * kinds.length)))];
        const r = Math.hypot(dx, dz) / radius;
        this.add(x, y, z, kind, rng.float(0.88, 1.1) * (1.05 - 0.15 * r));
        placed.push(x, z);
        break;
      }
    }
  }

  // One InstancedLod per kind (a single draw call each near the camera), dithered out across OUT.
  build(parent, lod) {
    const r = this.rng, d = new THREE.Object3D(), out = [];
    this.items.forEach((list, kind) => {
      const n = list.length / 4;
      if (!n) return;
      const { material, geometries } = assets();
      const matrices = new Float32Array(n * 16), colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const s = list[i * 4 + 3];
        d.position.set(list[i * 4], list[i * 4 + 1] - 0.03, list[i * 4 + 2]);
        d.rotation.set(r.float(-0.07, 0.07), r.float(0, TAU), r.float(-0.07, 0.07));
        // A random mirror doubles the apparent variety of the one clump shape.
        d.scale.set(s * r.float(0.9, 1.1) * r.sign(), s * r.float(0.9, 1.1), s * r.float(0.9, 1.1));
        d.updateMatrix();
        d.matrix.toArray(matrices, i * 16);
        // Near-white tints keep the atlas hues; lupines drift between blue and violet.
        const k = r.float(0.84, 1);
        colors[i * 3] = k * r.float(kind === 3 ? 0.78 : 0.94, 1);
        colors[i * 3 + 1] = k * r.float(0.92, 1);
        colors[i * 3 + 2] = k * r.float(0.9, 1);
      }
      out.push(lod.addInstanced(new InstancedLod(parent, {
        name: 'flowers:' + NAMES[kind], matrices, colors, step: 4, cell: 16,
        levels: [{ parts: [{ geometry: geometries[kind], material, colored: true }], out: OUT, castShadow: false }],
      })));
    });
    return out;
  }
}
