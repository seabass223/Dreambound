import { Rng, noise2 } from '../core/rng.js';
import { tnoise, tfbm, tnoiseA, toCanvas, normalFromHeight, tex, once } from './textures.js';

// The cabin's two paintings, by one hand (brush, sign and finish below). The landscape over the hearth is at the
// end of the file. The kitchen's: a square mid-century abstract, brushy greens with a soft horizon, a dark wedge and a
// slim dark stroke as decoys, and three warm painted discs. The discs (middle-left, bottom-middle, top-right) are the
// green switch box's clue (world/towerPuzzle.js); everything else is there to make it pass as art.
// Canvas space: u to the right, v down, both 0..1. Colours are sRGB 0..1.
export const PAINTING_DISCS = [
  { u: 0.2, v: 0.5, r: 0.085, col: [0.8, 0.57, 0.2], ring: [0.62, 0.4, 0.13], ringAt: 0.62, halo: -0.18, ang: 0.35 },   // ochre
  { u: 0.5, v: 0.8, r: 0.074, col: [0.69, 0.3, 0.16], ring: [0.8, 0.44, 0.25], ringAt: 0.45, halo: -0.16, ang: -0.5 },   // rust
  { u: 0.8, v: 0.2, r: 0.098, col: [0.93, 0.87, 0.72], ring: [0.86, 0.74, 0.5], ringAt: 0.7, halo: 0.3, ang: 1.2 },      // cream
];

const SKY = [0.37, 0.53, 0.42], MID = [0.25, 0.42, 0.31], LOW = [0.15, 0.29, 0.21], BAND = [0.46, 0.53, 0.3];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// The low-frequency ground before any strokes, as 7 terms: colour without the band (3), band cover, tone,
// hue shift, paint height. Kept separate so it can be sampled on a coarse grid (it is smooth) and composed per texel.
function groundTerms(u, v, o) {
  const vw = v + (tfbm(u, v, 3, 3, 11) - 0.5) * 0.07;
  const t = smooth(0.08, 0.62, vw), lo = smooth(0.66, 0.76, vw);
  for (let k = 0; k < 3; k++) { const c = SKY[k] + (MID[k] - SKY[k]) * t; o[k] = c + (LOW[k] - c) * lo; }
  const vb = v + (tnoise(u, v, 5, 13) - 0.5) * 0.025;
  o[3] = smooth(0.615, 0.635, vb) * (1 - smooth(0.675, 0.695, vb));
  o[4] = 0.9 + tfbm(u, v, 4, 4, 21) * 0.2;
  o[5] = tfbm(u, v, 2, 3, 29) - 0.5;
  o[6] = 0.25 + tfbm(u, v, 8, 3, 33) * 0.15;
  return o;
}

// Horizon band, dry-brushed: fine horizontal streaks break it up (full resolution).
function compose(o, u, v, out) {
  const a = o[3] * (0.45 + 0.4 * tnoiseA(u, v, 3, 90, 17));
  for (let k = 0; k < 3; k++) out[k] = o[k] + (BAND[k] - o[k]) * a;
  out[0] = out[0] * o[4] + o[5] * 0.05; out[1] *= o[4]; out[2] = out[2] * o[4] - o[5] * 0.04;
  return out;
}

const baseColor = (u, v, out) => compose(groundTerms(u, v, new Array(7)), u, v, out);

// The artist's hand, shared by every painting in the cabin so they read as one painter's: a brush over a W x H
// texel canvas (colour and paint height) whose unit length is S texels. The unit is the same 0.8 m in both
// paintings, so strokes of the same size are the same brush. put() blends a colour into one texel; stroke() lays
// one loaded stroke; mask(x, y), if given, scales its cover per texel (cutting in against an edge).
function brush(col, h, W, H, S) {
  const put = (i, r, g, b, a) => {
    const j = i * 3;
    col[j] += (r - col[j]) * a; col[j + 1] += (g - col[j + 1]) * a; col[j + 2] += (b - col[j + 2]) * a;
  };
  // One loaded brush stroke: soft, wavering sides, bristle streaks along its length, paint running dry toward its tail.
  const stroke = (cx, cy, ang, len, wid, cc, op, seed, lift = 0.3, mask) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), hl = len / 2, hw = wid / 2;
    const ey = Math.abs(sa) * hl + Math.abs(ca) * hw;
    const y0 = Math.max(0, Math.floor((cy - ey) * S)), y1 = Math.min(H - 1, Math.ceil((cy + ey) * S));
    const streaks = 5 + wid * 130, ph = seed * 1.618;
    for (let y = y0; y <= y1; y++) {
      // Only the span of this row inside the stroke's rectangle (|s|, |t| <= 1.1): each bound is linear in dx.
      const dy = (y + 0.5) / S - cy;
      let lo = -Infinity, hi = Infinity;
      for (const [k, m, e] of [[ca, dy * sa, 1.1 * hl], [-sa, dy * ca, 1.1 * hw]]) {
        if (Math.abs(k) < 1e-6) { if (Math.abs(m) > e) { lo = 1; hi = 0; } continue; }
        const a = (-e - m) / k, b = (e - m) / k;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
      if (hi < lo) continue;
      const xa = Math.max(0, Math.floor((cx + lo) * S)), xb = Math.min(W - 1, Math.ceil((cx + hi) * S));
      for (let x = xa; x <= xb; x++) {
        const dx = (x + 0.5) / S - cx;
        const s = (dx * ca + dy * sa) / hl, t = (dy * ca - dx * sa) / hw;
        if (s < -1.1 || s > 1.1 || t < -1.1 || t > 1.1) continue;
        const at = Math.abs(t + Math.sin(s * 4.3 + ph) * 0.09);
        if (at >= 1) continue;
        const as = Math.abs(s), side = at < 0.78 ? 1 : smooth(1, 0.78, at);
        const ends = as < 0.73 ? 1 : smooth(1.05, 0.8, as + Math.sin(t * 5 + ph) * 0.07);
        if (ends <= 0) continue;
        const br = 0.5 + 0.5 * noise2(s * 2.2 + ph, t * streaks);
        const load = 1 - 0.65 * smooth(-0.3, 1, s);
        const a = op * side * ends * clamp01((load - (1 - br) * 0.75) * 3.5) * (mask ? mask(x, y) : 1);
        if (a <= 0.002) continue;
        const i = y * W + x, k = 0.93 + br * 0.14;
        put(i, cc[0] * k, cc[1] * k, cc[2] * k, a);
        h[i] += (0.3 + lift * br * load - h[i]) * a;
      }
    }
  };
  return { put, stroke };
}

// A small scrawled signature starting at (x0, y0) in brush units, S texels each.
function sign(put, W, S, x0, y0) {
  for (let n = 0; n < 60; n++) {
    const t = n / 59, sx = x0 + t * 0.075, sy = y0 + Math.sin(t * 19) * 0.006 * (1 - t * 0.5) - t * 0.006;
    const cx = Math.floor(sx * S), cy = Math.floor(sy * S);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) put(y * W + x, 0.1, 0.14, 0.11, x === cx && y === cy ? 0.85 : 0.35);
  }
}

// Canvas weave shows through where the paint is thin (a thread every 3.2 texels, the same cloth at the same
// texel density); an old varnish warms it; the edges darken a touch.
function finish(col, h, W, H) {
  const nU = Math.round(W / 3.2), nV = Math.round(H / 3.2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, u = (x + 0.5) / W, v = (y + 0.5) / H;
    const a = Math.sin(u * nU * Math.PI * 2), b = Math.sin(v * nV * Math.PI * 2);
    const w = 0.5 + 0.5 * Math.abs(((Math.floor(u * nU) + Math.floor(v * nV)) & 1) ? a : b);
    const thin = clamp01(1 - (h[i] - 0.25) * 2.2);
    h[i] += w * 0.12 * thin;
    const vig = 1 - 0.07 * (smooth(0.3, 0.52, Math.abs(u - 0.5)) + smooth(0.3, 0.52, Math.abs(v - 0.5)));
    const k = (0.975 + w * 0.05 * thin) * vig;
    col[i * 3] = col[i * 3] * k + 0.015; col[i * 3 + 1] = col[i * 3 + 1] * k * 0.99 + 0.01; col[i * 3 + 2] *= k * 0.93;
  }
}

// Pure pixel generator (no DOM): returns sRGB colour (0..1, 3 per texel) and a paint height field.
export function paintPainting(S = 1024) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S);
  const c = [0, 0, 0], o = new Array(7);

  // Ground on a coarse grid, bilinearly upsampled.
  const G = 128, gs = new Float32Array((G + 1) * (G + 1) * 7);
  for (let gy = 0; gy <= G; gy++) for (let gx = 0; gx <= G; gx++) {
    groundTerms(gx / G, gy / G, o);
    for (let k = 0; k < 7; k++) gs[(gy * (G + 1) + gx) * 7 + k] = o[k];
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const fx = u * G, fy = v * G, ix = Math.min(G - 1, fx | 0), iy = Math.min(G - 1, fy | 0), tx = fx - ix, ty = fy - iy;
    const a = (iy * (G + 1) + ix) * 7, b = a + 7, cc = a + (G + 1) * 7, d = cc + 7;
    for (let k = 0; k < 7; k++) {
      const top = gs[a + k] + (gs[b + k] - gs[a + k]) * tx, bot = gs[cc + k] + (gs[d + k] - gs[cc + k]) * tx;
      o[k] = top + (bot - top) * ty;
    }
    compose(o, u, v, c);
    const i = y * S + x;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    h[i] = o[6];
  }

  const { put, stroke } = brush(col, h, S, S, S);

  const rng = new Rng(0x9a17);
  // Ground strokes follow the local colour: sweeping diagonals in the sky, flat toward the band and the field.
  for (let n = 0; n < 420; n++) {
    const cx = rng.float(-0.05, 1.05), cy = rng.float(-0.05, 1.05);
    baseColor(clamp01(cx), clamp01(cy), c);
    const j = rng.float(0.86, 1.14), g = rng.float(-0.025, 0.025);
    const flat = smooth(0.35, 0.62, cy);
    const up = flat < 0.2 && rng.next() < 0.12 ? Math.PI / 2 : 0;
    const ang = (1 - flat) * rng.float(-0.9, 0.5) + flat * rng.float(-0.15, 0.15) + up;
    stroke(cx, cy, ang, rng.float(0.07, 0.24), rng.float(0.022, 0.06), [c[0] * j - g * 0.5, c[1] * j + g, c[2] * j - g], rng.float(0.35, 0.75), n);
  }
  // A few livelier accents: yellow-green and teal, thin and quick.
  for (let n = 0; n < 26; n++) {
    const warm = rng.next() < 0.5, cy = rng.float(0.02, 0.58);
    stroke(rng.float(0, 1), cy, rng.float(-0.7, 0.3), rng.float(0.05, 0.14), rng.float(0.012, 0.025),
      warm ? [0.5, 0.6, 0.36] : [0.3, 0.5, 0.46], rng.float(0.2, 0.4), 600 + n);
  }

  // Decoys. A soft lighter block in the upper left (a colour-field glaze).
  for (let n = 0; n < 16; n++) {
    stroke(rng.float(0.09, 0.38), 0.12 + n * 0.012 + rng.float(-0.01, 0.01), rng.float(-0.06, 0.06), rng.float(0.2, 0.32), 0.05,
      [0.47, 0.6, 0.5], rng.float(0.18, 0.3), 900 + n);
  }
  // A dark angular wedge rising on the lower right, under a wavering diagonal edge.
  {
    const x0 = Math.floor(0.56 * S), y0 = Math.floor(0.68 * S);
    for (let y = y0; y < S; y++) for (let x = x0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      // Edge from (0.62, 1.0) up to (1.0, 0.72); e > 0 below it.
      const e = (v - (1.0 - (u - 0.62) * (0.28 / 0.38))) + noise2(u * 14, 7) * 0.012 + noise2(u * 60, v * 3 + 9) * 0.004;
      const a = smooth(0, 0.014, e + (noise2(u * 6, v * 120) - 0.4) * 0.012) * 0.82;
      if (a <= 0) continue;
      const br = 0.5 + 0.5 * noise2(u * 9, v * 170);
      const k = 0.9 + br * 0.2 + (v - 0.85) * 0.2;
      const i = y * S + x;
      put(i, 0.11 * k, 0.23 * k, 0.17 * k, a * (0.8 + br * 0.2));
      h[i] += (0.3 + br * 0.15 - h[i]) * a;
    }
  }
  // A slim dark upright, like a mast or a tree, between the field and the sky.
  for (let n = 0; n < 3; n++) stroke(0.636 + n * 0.004, 0.52, Math.PI / 2 + 0.035, 0.38 - n * 0.05, 0.012, [0.12, 0.2, 0.15], 0.7, 1100 + n, 0.4);
  // A pale scumbled line along the band.
  for (let n = 0; n < 4; n++) stroke(0.28 + n * 0.035, 0.652 + n * 0.002, rng.float(-0.03, 0.03), 0.34, 0.01, [0.66, 0.68, 0.5], 0.4, 1200 + n);

  // The discs: soft, slightly wobbly edges, filled with straight strokes that turn to follow the rim, a soft
  // ring and a halo (a pale glow or a faint shadow) each.
  for (let di = 0; di < PAINTING_DISCS.length; di++) {
    const D = PAINTING_DISCS[di], sd = 50 + di * 13, ca = Math.cos(D.ang), sa = Math.sin(D.ang);
    const R = D.r * 1.6;
    const x0 = Math.max(0, Math.floor((D.u - R) * S)), x1 = Math.min(S - 1, Math.ceil((D.u + R) * S));
    const y0 = Math.max(0, Math.floor((D.v - R) * S)), y1 = Math.min(S - 1, Math.ceil((D.v + R) * S));
    const halo = D.halo > 0 ? [0.62, 0.67, 0.5] : [0.1, 0.2, 0.15];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = ((x + 0.5) / S - D.u) / D.r, dy = ((y + 0.5) / S - D.v) / D.r;
      const d = Math.hypot(dx, dy), cs = dx / (d + 1e-9), sn = dy / (d + 1e-9);
      const rr = 1 + noise2(cs * 1.6 + sd, sn * 1.6) * 0.035 + noise2(cs * 5 + sd, sn * 5 - sd) * 0.012;
      const inside = smooth(rr + 0.025, rr - 0.03, d);
      const i = y * S + x;
      const hk = smooth(1.6, 1.0, d) * (1 - inside) * Math.abs(D.halo);
      if (hk > 0) put(i, halo[0], halo[1], halo[2], hk);
      if (inside <= 0) continue;
      const along = dx * ca + dy * sa, across = dy * ca - dx * sa;
      const fill = noise2(along * 2.5 + sd, across * 20) * 0.8;
      const rim = noise2(d * 14 + sd, (cs * 0.8 + sn * 0.5) * 3);
      const br = 0.5 + 0.5 * (fill + (rim - fill) * smooth(0.72, 0.92, d));
      const ring = Math.exp(-(((d - D.ringAt) / 0.11) ** 2)) * 0.3;
      const k = (0.93 + br * 0.12) * (1 - 0.05 * (dx + dy));
      put(i, (D.col[0] + (D.ring[0] - D.col[0]) * ring) * k, (D.col[1] + (D.ring[1] - D.col[1]) * ring) * k,
        (D.col[2] + (D.ring[2] - D.col[2]) * ring) * k, inside * 0.97);
      const lip = Math.exp(-(((d - rr + 0.06) / 0.05) ** 2)) * 0.2;
      h[i] += (0.55 + br * 0.2 + lip - h[i]) * inside;
    }
  }

  // A small scrawled signature, lower right.
  sign(put, S, S, 0.855, 0.94);
  finish(col, h, S, S);
  return { col, h, size: S };
}

// ---------------------------------------------------------------- the landscape over the hearth
// Mountains and spruce by the same hand: three ridges receding into haze (each paler and bluer than the one in
// front, misty at its foot, lit on its left-facing slopes), a band of dark blue-green conifers with mist over
// its far edge, an earthy meadow and a soft warm sky. Muted to sit with the room's walnut, leather and linen: the
// greens stay deep and blue. Nothing is hidden in it. Brush units: 1 = the canvas height (0.8 m, the kitchen
// canvas's side), so u runs 0..W/H and v 0..1 (down).
const L_SKY_TOP = [0.54, 0.59, 0.66], L_SKY_LOW = [0.84, 0.79, 0.68], L_GLOW = [0.9, 0.77, 0.61];
const RIDGES = [
  // colour at the crest, the haze it fades into toward its foot (over `fade`), the light on its sunlit slopes
  { top: [0.58, 0.61, 0.67], haze: [0.72, 0.73, 0.74], fade: 0.16, lit: [0.88, 0.85, 0.79], litK: 0.55 },
  { top: [0.45, 0.5, 0.55], haze: [0.69, 0.69, 0.67], fade: 0.1, lit: [0.66, 0.64, 0.58], litK: 0.4 },
  { top: [0.31, 0.37, 0.4], haze: [0.58, 0.6, 0.59], fade: 0.08, lit: [0.5, 0.49, 0.43], litK: 0.3 },
];
const L_FAR_FOREST = [0.24, 0.31, 0.31], L_FOREST = [0.11, 0.18, 0.17], L_MIST = [0.8, 0.79, 0.75];
const L_MEADOW = [0.43, 0.38, 0.27], L_RUST = [0.5, 0.34, 0.22], L_OLIVE = [0.37, 0.37, 0.26];
// A soft-shouldered peak (0 away from it, 1 on top) and ridged noise (sharp crests, rounded hollows).
const peak = (u, c, w) => { const t = 1 - Math.abs(u - c) / w; return t > 0 ? t * 0.6 + t * t * (3 - 2 * t) * 0.4 : 0; };
const crest = (u, f, seed) => 1 - Math.abs(noise2(u * f, 0.37, seed));
// Skylines (v of the ridge at u), far to near; then the far edge of the forest and the top of the meadow.
const SKYLINES = [
  (u) => 0.53 - 0.28 * peak(u, 0.64, 0.5) - 0.14 * peak(u, 1.3, 0.34) - 0.07 * peak(u, 0.06, 0.3) - 0.05 * crest(u, 5, 11) - 0.014 * crest(u, 17, 12),
  (u) => 0.6 - 0.12 * peak(u, 0.24, 0.42) - 0.09 * peak(u, 1.06, 0.45) - 0.035 * crest(u, 6, 21) - 0.01 * crest(u, 19, 22),
  (u) => 0.665 - 0.06 * peak(u, 0.82, 0.5) - 0.06 * peak(u, 1.52, 0.3) - 0.025 * crest(u, 8, 31) - 0.008 * crest(u, 23, 32),
  (u) => 0.715 - 0.014 * crest(u, 14, 41),
  (u) => 0.86 + 0.015 * noise2(u * 3, 1.3, 43),
];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mix = (a, b, t, out = [0, 0, 0]) => { for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * t; return out; };

export function paintLandscape(W = 1536, H = 960) {
  const S = H, U = W / H;
  const col = new Float32Array(W * H * 3), h = new Float32Array(W * H);
  // Each skyline per texel column, and the slope of a blurred copy (which way the big faces turn).
  const lines = SKYLINES.map((f) => { const a = new Float32Array(W); for (let x = 0; x < W; x++) a[x] = f((x + 0.5) / S); return a; });
  const slopes = lines.slice(0, 3).map((a) => {
    const r = Math.round(0.035 * S), sm = new Float32Array(W), sl = new Float32Array(W);
    for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let j = x - r; j <= x + r; j++) if (j >= 0 && j < W) { s += a[j]; n++; } sm[x] = s / n; }
    for (let x = 0; x < W; x++) sl[x] = (sm[Math.min(W - 1, x + 1)] - sm[Math.max(0, x - 1)]) * S / 2;
    return sl;
  });
  const [R0, R2, TL, MT] = [lines[0], lines[2], lines[3], lines[4]];
  const colX = (u) => Math.max(0, Math.min(W - 1, Math.floor(u * S)));

  // Smooth low-frequency terms on a coarse grid (sky wobble, tone, hue, paint height), sampled bilinearly.
  const GW = 160, GH = 100, NT = 4, gs = new Float32Array((GW + 1) * (GH + 1) * NT);
  for (let gy = 0; gy <= GH; gy++) for (let gx = 0; gx <= GW; gx++) {
    const un = gx / GW, vn = gy / GH, j = (gy * (GW + 1) + gx) * NT;
    gs[j] = (tfbm(un, vn, 3, 3, 51) - 0.5) * 0.08;
    gs[j + 1] = 0.9 + tfbm(un, vn, 4, 4, 21) * 0.2;
    gs[j + 2] = tfbm(un, vn, 2, 3, 29) - 0.5;
    gs[j + 3] = 0.25 + tfbm(un, vn, 8, 3, 33) * 0.15;
  }
  const T = new Float32Array(NT);
  const terms = (u, v) => {
    const fx = Math.max(0, Math.min(GW - 1e-6, u / U * GW)), fy = Math.max(0, Math.min(GH - 1e-6, v * GH));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const a = (iy * (GW + 1) + ix) * NT, b = a + NT, c = a + (GW + 1) * NT, d = c + NT;
    for (let k = 0; k < NT; k++) {
      const top = gs[a + k] + (gs[b + k] - gs[a + k]) * tx, bot = gs[c + k] + (gs[d + k] - gs[c + k]) * tx;
      T[k] = top + (bot - top) * ty;
    }
    return T;
  };

  // Colours of each plane at (u, v), whatever stands in front of it.
  const sky = (u, v, out) => {
    mix(L_SKY_TOP, L_SKY_LOW, smooth(0.02, 0.62, v + terms(u, v)[0]), out);
    return mix(out, L_GLOW, 0.5 * Math.exp(-((u - 0.45) ** 2) / 0.18 - ((v - 0.52) ** 2) / 0.02), out);
  };
  const ridge = (k, x, v, out) => {
    const R = RIDGES[k], d = v - lines[k][x];
    mix(R.top, R.haze, smooth(0.005, R.fade, d), out);
    // Light from the upper left: slopes rising to the right face it, strongest near the crest, broken by gullies.
    const u = (x + 0.5) / S, sl = slopes[k][x];
    const gully = 0.55 + 0.45 * noise2(u * 26 + d * 30 * Math.sign(sl || 1), d * 9, 61 + k);
    const reach = 0.12 - 0.03 * k;
    const lit = smooth(0.05, 0.9, -sl) * Math.exp(-d / reach) * gully * R.litK;
    mix(out, R.lit, lit, out);
    // The far side in cool shadow: darker and bluer.
    const shade = smooth(0.05, 0.9, sl) * Math.exp(-d / reach) * (0.6 + 0.4 * gully) * 0.3;
    out[0] *= 1 - shade * 1.15; out[1] *= 1 - shade; out[2] *= 1 - shade * 0.6;
    return out;
  };
  const forest = (x, v, out) => mix(L_FAR_FOREST, L_FOREST, smooth(TL[x], MT[x] + 0.02, v), out);
  const meadow = (u, v, out) => {
    mix(L_MEADOW, L_OLIVE, 0.5 + 0.5 * noise2(u * 5, v * 9, 71), out);
    const k = 1 - 0.25 * smooth(0.86, 1.0, v);
    out[0] *= k; out[1] *= k; out[2] *= k;
    return out;
  };
  const ground = (u, v, x, out) => {
    if (v >= MT[x]) return meadow(u, v, out);
    if (v >= TL[x]) return forest(x, v, out);
    for (let k = 2; k >= 0; k--) if (v >= lines[k][x]) return ridge(k, x, v, out);
    return sky(u, v, out);
  };

  const c = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    ground(u, v, x, c);
    const t = terms(u, v), i = y * W + x;
    col[i * 3] = c[0] * t[1] + t[2] * 0.04; col[i * 3 + 1] = c[1] * t[1]; col[i * 3 + 2] = c[2] * t[1] - t[2] * 0.03;
    h[i] = t[3];
  }

  const { put, stroke } = brush(col, h, W, H, S);
  const rng = new Rng(0x1a4d);
  const vAt = (y) => (y + 0.5) / S;
  // Cut-in masks: paint that stays below a skyline (a hair of overlap), or above one (with `over` of spill).
  const below = (line, soft = 0.003) => (x, y) => smooth(line[x] - soft, line[x] + soft * 0.5, vAt(y));
  const above = (line, over) => (x, y) => smooth(line[x] + over, line[x], vAt(y));
  const tint = (cc, j, g) => [cc[0] * j - g * 0.5, cc[1] * j + g, cc[2] * j - g];

  // Sky: sweeping, mostly level strokes, as in the kitchen's sky; a few warm and grey-violet cloud touches.
  for (let n = 0; n < 300; n++) {
    const cx = rng.float(-0.05, U + 0.05), x = colX(cx), cy = rng.float(-0.05, R0[x] + 0.02);
    sky(cx, cy, c);
    stroke(cx, cy, rng.float(-0.4, 0.22), rng.float(0.07, 0.24), rng.float(0.022, 0.06), tint(c, rng.float(0.92, 1.08), rng.float(-0.008, 0.008)),
      rng.float(0.35, 0.75), n, 0.3, above(R0, 0.012));
  }
  for (let n = 0; n < 16; n++) {
    const warm = rng.next() < 0.6, cx = rng.float(0, U), cy = rng.float(0.05, 0.4);
    stroke(cx, cy, rng.float(-0.2, 0.1), rng.float(0.1, 0.22), rng.float(0.018, 0.035),
      warm ? [0.9, 0.85, 0.76] : [0.62, 0.62, 0.68], rng.float(0.15, 0.28), 300 + n, 0.3, above(R0, 0.008));
  }

  // The ridges, far to near: strokes along the slopes, cut in against each skyline, then a veil of haze at the foot.
  const RN = [300, 230, 190];
  for (let k = 0; k < 3; k++) {
    const line = lines[k], next = lines[k + 1];
    for (let n = 0; n < RN[k]; n++) {
      const cx = rng.float(-0.04, U + 0.04), x = colX(cx);
      const cy = line[x] + rng.float(-0.004, Math.max(0.02, next[x] - line[x] + 0.03));
      ridge(k, x, Math.max(cy, line[x]), c);
      const sl = slopes[k][x], fall = rng.next() < 0.3;
      // Along the ridge near its crest; down the fall line (steep, leaning with the slope) for some.
      const ang = fall ? Math.PI / 2 - Math.sign(sl || 1) * rng.float(0.35, 0.8) : Math.atan(sl) + rng.float(-0.25, 0.25);
      stroke(cx, cy, ang, rng.float(0.05, 0.16), rng.float(0.014, 0.04), tint(c, rng.float(0.92, 1.08), rng.float(-0.015, 0.015)),
        rng.float(0.35, 0.75), 1000 * (k + 1) + n, 0.3, below(line));
    }
    // Haze pooled in the valley in front of it.
    const haze = RIDGES[k].haze;
    for (let n = 0; n < 40; n++) {
      const cx = rng.float(-0.05, U + 0.05), x = colX(cx);
      stroke(cx, next[x] + rng.float(-0.035, 0.008), rng.float(-0.05, 0.05), rng.float(0.15, 0.35), rng.float(0.02, 0.04),
        tint(haze, rng.float(0.97, 1.03), 0), rng.float(0.15, 0.35), 1800 + k * 50 + n, 0.15, below(line, 0.01));
    }
  }

  // A spruce: a thin trunk, then tiers of branches brushed out from it (loaded at the trunk, dry at the tips),
  // drooping, wider toward the foot; the side toward the light lighter and warmer.
  const spruce = (tx, vb, ht, base, op, sd) => {
    const wd = ht * rng.float(0.26, 0.34), step = Math.max(0.0045, wd * 0.1), tiers = Math.max(4, Math.round(ht * 0.92 / step));
    const thick = Math.max(0.005, Math.min(0.03, step * 1.9));
    stroke(tx, vb - ht * 0.45, -Math.PI / 2, ht * 0.9, Math.max(0.004, wd * 0.1), mul(base, 0.8), op, sd, 0.35);
    for (let t = 0; t < tiers; t++) {
      const f = (t + 0.5) / tiers, y = vb - ht * (0.96 - 0.9 * f);
      const w = wd * (0.1 + 0.9 * Math.pow(f, 0.9)) * rng.float(0.75, 1.15);
      for (const s of [-1, 1]) {
        const droop = rng.float(0.25, 0.65), L = w * rng.float(0.95, 1.25);
        const ang = s > 0 ? droop : Math.PI - droop;
        const k = (s < 0 ? 1.22 : 0.88) * rng.float(0.9, 1.1);
        // Started a little across the trunk, so the two sides close over it.
        stroke(tx + Math.cos(ang) * L * 0.38, y + Math.sin(ang) * L * 0.38, ang, L, thick * rng.float(0.8, 1.2),
          [base[0] * k + (s < 0 ? 0.015 : 0), base[1] * k, base[2] * k], op, sd + t * 2 + (s > 0), 0.45);
      }
    }
    stroke(tx, vb - ht * 0.96, -Math.PI / 2, ht * 0.1, thick * 0.7, base, op, sd + 999, 0.45);
  };

  // Mist along the valley floor, before the far trees.
  for (let n = 0; n < 50; n++) {
    const cx = rng.float(-0.05, U + 0.05), x = colX(cx);
    stroke(cx, TL[x] + rng.float(-0.04, 0.015), rng.float(-0.04, 0.04), rng.float(0.15, 0.4), rng.float(0.02, 0.045),
      tint(L_MIST, rng.float(0.96, 1.03), 0), rng.float(0.2, 0.42), 2000 + n, 0.12, below(R2, 0.01));
  }
  // The forest band: level dabs over its mass, then far trees, back to front, hazier the further they stand.
  for (let n = 0; n < 150; n++) {
    const cx = rng.float(-0.04, U + 0.04), x = colX(cx), cy = rng.float(TL[x], MT[x] + 0.02);
    forest(x, cy, c);
    stroke(cx, cy, rng.float(-0.2, 0.2), rng.float(0.04, 0.1), rng.float(0.015, 0.03), tint(c, rng.float(0.88, 1.12), rng.float(-0.01, 0.01)),
      rng.float(0.4, 0.75), 2100 + n, 0.35, below(TL, 0.002));
  }
  const far = [];
  for (let n = 0; n < 190; n++) {
    const u = rng.float(-0.02, U + 0.02), x = colX(u);
    far.push([u, rng.float(TL[x] + 0.004, MT[x] + 0.005)]);
  }
  far.sort((a, b) => a[1] - b[1]);
  far.forEach(([u, vb], n) => {
    const x = colX(u), d = smooth(TL[x], MT[x], vb);
    const base = mul(mix(mix(L_FAR_FOREST, L_MIST, 0.18 * (1 - d)), L_FOREST, d * 0.8), rng.float(0.9, 1.1));
    spruce(u, vb, rng.float(0.035, 0.07) * (1 + d * 0.8), base, 0.85, 3000 + n * 40);
  });
  // A little mist drifting through the far trees.
  for (let n = 0; n < 28; n++) {
    const cx = rng.float(0, U), x = colX(cx);
    stroke(cx, TL[x] + rng.float(0.0, 0.05), rng.float(-0.05, 0.05), rng.float(0.12, 0.3), rng.float(0.015, 0.035),
      tint(L_MIST, rng.float(0.97, 1.02), 0), rng.float(0.12, 0.28), 11000 + n, 0.1);
  }

  // The meadow: level strokes of earth and dry grass, a few rust touches, upward flicks along its top.
  for (let n = 0; n < 200; n++) {
    const cx = rng.float(-0.04, U + 0.04), x = colX(cx), cy = rng.float(MT[x] - 0.005, 1.04);
    meadow(cx, cy, c);
    const cc = rng.next() < 0.14 ? L_RUST : c;
    stroke(cx, cy, rng.float(-0.15, 0.15), rng.float(0.06, 0.18), rng.float(0.018, 0.045), tint(cc, rng.float(0.88, 1.12), rng.float(-0.015, 0.015)),
      rng.float(0.35, 0.75), 12000 + n, 0.3, below(MT, 0.004));
  }
  for (let n = 0; n < 45; n++) {
    const cx = rng.float(0, U), x = colX(cx);
    stroke(cx, MT[x] + rng.float(0.0, 0.03), -Math.PI / 2 + rng.float(-0.35, 0.35), rng.float(0.02, 0.05), rng.float(0.004, 0.008),
      rng.next() < 0.5 ? [0.53, 0.46, 0.32] : [0.32, 0.31, 0.23], rng.float(0.25, 0.5), 12500 + n, 0.4);
  }

  // Middle-ground spruce in two stands, leaving the view to the peaks open between them.
  const mid = [];
  for (let n = 0; n < 30; n++) {
    const left = n % 2 === 0, u = left ? rng.float(0.26, 0.6) : rng.float(1.02, 1.42);
    mid.push([u, rng.float(0.855, 0.93)]);
  }
  mid.sort((a, b) => a[1] - b[1]);
  mid.forEach(([u, vb], n) => spruce(u, vb, rng.float(0.1, 0.24) * (0.8 + (vb - 0.85) * 4), mul(L_FOREST, rng.float(0.95, 1.2)), 0.9, 13000 + n * 80));
  // Foreground spruce framing the picture at both edges, tallest at the far left.
  const FG = [[-0.03, 1.0, 0.64], [0.1, 1.03, 0.86], [0.23, 1.02, 0.66], [0.36, 1.0, 0.46], [1.34, 0.99, 0.44], [1.47, 1.03, 0.76], [1.59, 1.01, 0.6]];
  FG.forEach(([u, vb, ht], n) => spruce(u, vb, ht, mul(L_FOREST, rng.float(0.78, 0.9)), 0.95, 16000 + n * 120));
  // Grass over the trees' feet.
  for (let n = 0; n < 60; n++) {
    const cx = rng.float(-0.04, U + 0.04), cy = rng.float(0.95, 1.03);
    meadow(cx, cy, c);
    stroke(cx, cy, rng.float(-0.12, 0.12), rng.float(0.06, 0.16), rng.float(0.015, 0.035), tint(c, rng.float(0.8, 1.0), 0), rng.float(0.3, 0.6), 19000 + n);
  }

  sign(put, W, S, 1.12, 0.955);
  finish(col, h, W, H);
  return { col, h, width: W, height: H };
}

// sRGB albedo + normal map (clamped, mipmapped). Built once, the first time the cabin is placed.
export function paintingTextures() {
  return once('painting', () => {
    const { col, h, size: S } = paintPainting(1024);
    const q = (x) => Math.round(clamp01(x) * 255);
    const map = tex(toCanvas(S, (x, y) => { const i = (y * S + x) * 3; return [q(col[i]), q(col[i + 1]), q(col[i + 2])]; }), { repeat: false });
    const normal = tex(normalFromHeight(S, h, 2.2), { srgb: false, repeat: false });
    return { map, normal };
  });
}

// The landscape's albedo + normal map (1536 x 960: about the kitchen canvas's texel density on 1.28 x 0.8 m).
export function landscapeTextures() {
  return once('landscape', () => {
    const { col, h, width: W, height: H } = paintLandscape(1536, 960);
    const q = (x) => Math.round(clamp01(x) * 255);
    const map = tex(toCanvas(W, (x, y) => { const i = (y * W + x) * 3; return [q(col[i]), q(col[i + 1]), q(col[i + 2])]; }, H), { repeat: false });
    const normal = tex(normalFromHeight(W, h, 2.2, H), { srgb: false, repeat: false });
    return { map, normal };
  });
}
