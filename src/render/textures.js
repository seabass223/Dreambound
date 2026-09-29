import * as THREE from 'three';
import { Rng } from '../core/rng.js';

// Procedural canvas textures. Everything is generated at boot; no image files.

function periodicHash(ix, iy, p, seed) {
  ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p;
  let h = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Tileable value noise over [0,1)^2 with integer period `p`.
function tnoise(u, v, p, seed) {
  const x = u * p, y = v * p;
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = periodicHash(ix, iy, p, seed), b = periodicHash(ix + 1, iy, p, seed);
  const c = periodicHash(ix, iy + 1, p, seed), d = periodicHash(ix + 1, iy + 1, p, seed);
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
}

function tfbm(u, v, base, oct, seed) {
  let s = 0, a = 0.5, n = 0, p = base;
  for (let i = 0; i < oct; i++) { s += a * tnoise(u, v, p, seed + i * 7); n += a; a *= 0.5; p *= 2; }
  return s / n;
}

// Tileable value noise with separate integer periods along u and v (for grain, fibres, strata).
function tnoiseA(u, v, pu, pv, seed) {
  const x = u * pu, y = v * pv;
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const hsh = (a, b) => periodicHash(((a % pu) + pu) % pu, ((b % pv) + pv) % pv, 1 << 20, seed);
  const a = hsh(ix, iy), b = hsh(ix + 1, iy), c = hsh(ix, iy + 1), d = hsh(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy;
}

function tfbmA(u, v, pu, pv, oct, seed) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * tnoiseA(u, v, pu << i, pv << i, seed + i * 7); n += a; a *= 0.5; }
  return s / n;
}

function heightField(size, fn) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x / size, y / size);
  return h;
}

// size x size texels, or size wide by `height` tall.
function toCanvas(size, pixel, height = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const [r, g, b, a = 255] = pixel(x, y);
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function normalFromHeight(size, h, strength, height = size) {
  return toCanvas(size, (x, y) => {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const d = h[((y - 1 + height) % height) * size + x], u = h[((y + 1) % height) * size + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255];
  }, height);
}

function tex(canvas, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

// Building blocks for procedural textures defined in other modules (tileable noise, canvas + normal-map helpers).
export { periodicHash, tnoise, tfbm, tnoiseA, tfbmA, heightField, toCanvas, normalFromHeight, tex, once };

// Tileable Voronoi over [0,1)^2 with `n` x `n` jittered cells: the nearest and second-nearest distances and the
// nearest cell's id (for per-stone colour), for flagstones and cobbles.
function voronoi(u, v, n, seed) {
  const x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = ix + ox, cy = iy + oy;
    const px = cx + 0.02 + 0.96 * periodicHash(cx, cy, n, seed), py = cy + 0.02 + 0.96 * periodicHash(cx, cy, n, seed + 17);
    const d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = periodicHash(cx, cy, n, seed + 29); } else if (d < d2) d2 = d;
  }
  return { d1, d2, edge: d2 - d1, id };
}

export const Textures = {
  // Laid path stones (the Dome's ledge path): irregular flagstones with dark joints, each its own shade and a worn,
  // bevelled edge; the roughness map leaves their tops fairly smooth (and some patches polished by feet and wet), so a
  // low sun glances off them, while the joints stay matt.
  flagstone: () => once('flagstone', () => {
    const S = 512, N = 5;   // (one tile is laid over about 2.4 m of path)
    const h = new Float32Array(S * S), shade = new Float32Array(S * S), joint = new Float32Array(S * S), polish = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      // Warped cells, so the stones' sides wander instead of running straight.
      const wu = u + (tfbm(u, v, 5, 3, 71) - 0.5) * 0.09, wv = v + (tfbm(u, v, 5, 3, 73) - 0.5) * 0.09;
      const c = voronoi(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1, N, 77);
      const e = c.edge * N;                                  // 0 at a joint
      const jw = 0.1 + 0.07 * tnoise(u, v, 12, 75);          // joints of varying width, packed with grit
      const j = 1 - Math.min(1, e / jw);
      const bevel = Math.min(1, e / 0.5);                    // worn, softly rounded edges
      const grain = tfbm(u, v, 24, 4, 79), fine = tnoise(u, v, 256, 81);
      const tilt = (c.id - 0.5) * 0.15;
      const i = y * S + x;
      h[i] = bevel * 0.55 + grain * 0.22 + fine * 0.06 + tilt * (u + v) * 0.3 - j * 0.2;
      shade[i] = c.id; joint[i] = j;
      polish[i] = Math.max(0, tfbm(u, v, 6, 3, 83) - 0.52) * 2.5 * bevel;
    }
    const col = toCanvas(S, (x, y) => {
      const i = y * S + x, id = shade[i];
      const u = x / S, v = y / S;
      // Each stone its own weathered shade (grey-brown, some warmer), mottled, a little lighter where it's worn.
      const mott = tfbm(u, v, 16, 4, 85);
      const base = 0.5 + id * 0.3 + (mott - 0.5) * 0.35 + (h[i] - 0.4) * 0.15;
      const warm = 1.0 + (periodicHash(Math.floor(id * 97), 3, 997, 5) - 0.4) * 0.22;
      let r = 112 * base * warm, g = 101 * base, b = 88 * base / warm;
      const dirt = joint[i];
      r = r * (1 - dirt * 0.8) + 30 * dirt; g = g * (1 - dirt * 0.8) + 26 * dirt; b = b * (1 - dirt * 0.8) + 21 * dirt;
      return [r, g, b];
    });
    const rough = toCanvas(S, (x, y) => {
      const i = y * S + x;
      const k = 0.6 - polish[i] * 0.28 + joint[i] * 0.35 + (1 - Math.min(1, h[i] * 1.4)) * 0.06;
      const r = Math.max(0.12, Math.min(1, k)) * 255;
      return [r, r, r];
    });
    return {
      map: tex(col),
      normal: tex(normalFromHeight(S, h, 5), { srgb: false }),
      rough: tex(rough, { srgb: false }),
    };
  }),

  rock: () => once('rock', () => {
    const S = 512;
    const h = heightField(S, (u, v) => {
      const warp = tfbm(u, v, 3, 3, 5) * 0.5;
      const strata = Math.sin((v * 6 + warp) * Math.PI * 2) * 0.5 + 0.5;
      const base = tfbm(u, v, 4, 6, 1);
      const fine = tnoise(u, v, 96, 4) * 0.5 + tnoise(u, v, 192, 8) * 0.5;
      const c = Math.abs(tfbm(u + warp * 0.1, v, 6, 4, 9) - 0.5);
      const cracks = 1 - Math.min(1, c / 0.035);
      return base * 0.7 + strata * 0.1 + fine * 0.12 - cracks * 0.16;
    });
    const col = toCanvas(S, (x, y) => {
      const v = h[y * S + x];
      const tint = tfbm(x / S, y / S, 3, 4, 21);
      const moss = Math.max(0, tfbm(x / S, y / S, 6, 4, 33) - 0.55) * 1.6;
      const k = 0.42 + v * 0.7;
      let r = 128 * k * (0.92 + tint * 0.18), g = 121 * k * (0.96 + tint * 0.06), b = 112 * k * (1.02 - tint * 0.1);
      r = r * (1 - moss * 0.3); g = g * (1 - moss * 0.1); b = b * (1 - moss * 0.4);
      return [r, g, b];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 3.5), { srgb: false }) };
  }),

  ground: () => once('ground', () => {
    const S = 512;
    const h = heightField(S, (u, v) => tfbm(u, v, 16, 4, 31) * 0.7 + tnoise(u, v, 128, 7) * 0.3);
    const col = toCanvas(S, (x, y) => {
      const v = h[y * S + x];
      const speck = periodicHash(x, y, S, 3) > 0.93 ? 0.8 : 1;
      const k = (0.72 + v * 0.45) * speck;
      return [230 * k, 232 * k, 222 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 3.5), { srgb: false }) };
  }),

  bark: () => once('bark', () => {
    const S = 256;
    const h = heightField(S, (u, v) => {
      const ridges = Math.pow(Math.abs(Math.sin((u * 10 + tfbm(u, v, 4, 3, 2) * 1.6) * Math.PI)), 0.6);
      return ridges * 0.6 + tfbm(u, v, 8, 4, 12) * 0.4;
    });
    const col = toCanvas(S, (x, y) => {
      const k = 0.35 + h[y * S + x] * 0.75;
      return [120 * k, 100 * k, 82 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 5), { srgb: false }) };
  }),

  wood: () => once('wood', () => {
    const S = 256;
    const h = heightField(S, (u, v) => {
      const plank = Math.floor(v * 4);
      const grain = Math.sin((u * 3 + tfbm(u, v, 2, 3, plank + 3) * 3 + v * 40) * Math.PI * 4) * 0.5 + 0.5;
      const seam = Math.min(1, Math.abs(((v * 4) % 1) - 0.5) * 30);
      return (0.6 + grain * 0.25 + tnoise(u, v, 64, plank) * 0.15) * (0.35 + seam * 0.65);
    });
    const col = toCanvas(S, (x, y) => {
      const k = h[y * S + x];
      return [150 * k, 112 * k, 78 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 3), { srgb: false }) };
  }),

  metal: () => once('metal', () => {
    const S = 256;
    const rust = heightField(S, (u, v) => tfbm(u, v, 4, 5, 77));
    const col = toCanvas(S, (x, y) => {
      const r = rust[y * S + x];
      const streak = tfbm(x / S * 0.2, y / S, 32, 2, 5) * 0.2;
      const t = Math.min(1, Math.max(0, (r - 0.45) * 3 + streak));
      return [96 + t * 70, 98 + t * 18, 102 - t * 50];
    });
    const rough = toCanvas(S, (x, y) => { const r = rust[y * S + x]; const v = 140 + r * 110; return [v, v, v]; });
    return { map: tex(col), rough: tex(rough, { srgb: false }) };
  }),

  pavers: () => once('pavers', () => {
    const S = 256;
    const h = heightField(S, (u, v) => {
      const row = Math.floor(v * 8);
      const uu = u * 4 + (row % 2) * 0.5;
      const bx = Math.abs((uu % 1) - 0.5), by = Math.abs(((v * 8) % 1) - 0.5);
      const edge = Math.min(1, (0.5 - bx) * 14) * Math.min(1, (0.5 - by) * 8);
      return edge * (0.75 + tnoise(u, v, 32, row) * 0.25);
    });
    const col = toCanvas(S, (x, y) => {
      const k = h[y * S + x];
      const moss = tfbm(x / S, y / S, 4, 3, 44) > 0.62 ? 1 : 0;
      return moss ? [70 * k + 20, 90 * k + 20, 50 * k + 10] : [150 * k + 20, 110 * k + 18, 90 * k + 16];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 4), { srgb: false }) };
  }),

  // Board-formed concrete (the Tower's bunker, world/bunker.js), a 2 m tile: the formwork's boards in rows 25 cm high
  // with their grain pressed in and a lip at each joint, pinholes, and a mottle of damp and lime stains.
  concrete: () => once('concrete', () => {
    const S = 512, ROWS = 8;
    const h = heightField(S, (u, v) => {
      const row = Math.floor(v * ROWS), f = (v * ROWS) % 1;
      const joint = Math.max(0, 1 - Math.min(f, 1 - f) / 0.018);
      const grain = tnoiseA(u, v, 6, 192, 7 + row) * 0.5 + tnoiseA(u, v, 14, 384, 11 + row) * 0.25;   // streaks along the boards
      const pits = Math.max(0, tnoise(u, v, 128, 3) - 0.8) * 3;
      return 0.55 + grain * 0.12 + tfbm(u, v, 4, 4, 5) * 0.2 - joint * 0.25 - pits * 0.35;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S, k = h[y * S + x];
      const damp = Math.max(0, tfbm(u, v, 3, 4, 61) - 0.45) * 1.4;   // patches
      const lime = Math.max(0, tnoiseA(u, v, 24, 3, 71) - 0.62) * 1.2;   // run-down streaks
      const board = 0.94 + 0.06 * Math.sin(Math.floor(v * ROWS) * 12.9898);
      const g = (118 + k * 70) * board;
      return [g * (1 - damp * 0.28) + lime * 18, g * (0.99 - damp * 0.24) + lime * 18, g * (0.95 - damp * 0.22) + lime * 16];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.2), { srgb: false }) };
  }),

  // Limestone (the Home stack's walkway, world/walkway.js), a 1 m tile: pale buff, a soft mottle and faint bedding,
  // fine dark speckle, pits and the odd fossil shell, and a little grey lichen.
  limestone: () => once('limestone', () => {
    const S = 512;
    const rng = new Rng(3131);
    const shells = Array.from({ length: 7 }, () => ({ u: rng.next(), v: rng.next(), r: rng.float(0.012, 0.028), a: rng.float(0, Math.PI * 2) }));
    const shellAt = (u, v) => {
      let k = 0;
      for (const s of shells) {
        let du = u - s.u, dv = v - s.v;
        du -= Math.round(du); dv -= Math.round(dv);
        const d = Math.hypot(du, dv), ang = Math.atan2(dv, du) - s.a;
        if (d < s.r * 1.1 && Math.cos(ang) > -0.3) k = Math.max(k, Math.max(0, 1 - Math.abs(Math.sin(d / s.r * Math.PI * 3)) * 3));   // ribbed arcs
      }
      return k;
    };
    const h = heightField(S, (u, v) => {
      const pits = Math.max(0, tnoise(u, v, 96, 5) - 0.78) * 4 + Math.max(0, tnoise(u, v, 192, 6) - 0.82) * 3;
      return 0.6 + tfbm(u, v, 3, 5, 7) * 0.25 + tnoiseA(u, v, 2, 24, 9) * 0.04 - pits * 0.3 + shellAt(u, v) * 0.1;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S, k = h[y * S + x];
      const mottle = tfbm(u, v, 4, 4, 13);
      const speck = tnoise(u, v, 256, 17) > 0.86 ? 0.82 : 1;
      const lichen = Math.max(0, tfbm(u, v, 6, 3, 23) - 0.63) * 2.2;
      const b = (0.8 + k * 0.3) * (0.92 + mottle * 0.14) * speck;
      const r = 214 * b, g = 204 * b, bl = 180 * b;
      return [r * (1 - lichen * 0.3) + lichen * 30, g * (1 - lichen * 0.22) + lichen * 34, bl * (1 - lichen * 0.18) + lichen * 30];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.6), { srgb: false }) };
  }),

  panel: () => once('panel', () => {
    const S = 256;
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const seam = (Math.abs((u * 2) % 1 - 0.5) > 0.485 || Math.abs((v * 3) % 1 - 0.5) > 0.49) ? 0.5 : 1;
      const rivet = ((Math.abs((u * 2) % 1 - 0.5) > 0.44 && Math.abs(((v * 12) % 1) - 0.5) < 0.12) ? 1.25 : 1);
      const n = 0.8 + tfbm(u, v, 8, 3, 3) * 0.3;
      const k = n * seam * rivet;
      return [118 * k, 116 * k, 108 * k];
    });
    return { map: tex(col) };
  }),

  leaves: () => once('leaves', () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const r = new Rng(5);
    for (let i = 0; i < 90; i++) {
      const x = r.float(20, S - 20), y = r.float(20, S - 20);
      const d = Math.hypot(x - S / 2, y - S / 2);
      if (d > S * 0.46) continue;
      const g = r.float(0.55, 1);
      ctx.fillStyle = `rgb(${(70 * g) | 0},${(105 * g) | 0},${(40 * g) | 0})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r.float(0, Math.PI * 2));
      ctx.beginPath();
      ctx.ellipse(0, 0, r.float(7, 12), r.float(3.5, 6), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return tex(c, { repeat: false });
  }),

  needles: () => once('needles', () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const r = new Rng(9);
    ctx.lineCap = 'round';
    // A drooping bough: a few twigs off a central branch, each densely needled.
    const twigs = [];
    for (let s = 0; s < 7; s++) {
      const t0 = 0.08 + s * 0.12;
      const side = s % 2 ? 1 : -1;
      twigs.push({ x0: S / 2, y0: t0 * S, x1: S / 2 + side * r.float(55, 95) * (1 - t0 * 0.4), y1: t0 * S + r.float(40, 80) });
    }
    twigs.push({ x0: S / 2, y0: 6, x1: S / 2 + r.float(-10, 10), y1: S - 10 });
    for (const tw of twigs) {
      ctx.strokeStyle = 'rgb(58,44,30)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(tw.x0, tw.y0); ctx.lineTo(tw.x1, tw.y1); ctx.stroke();
      const len = Math.hypot(tw.x1 - tw.x0, tw.y1 - tw.y0);
      const n = Math.floor(len * 1.4);
      const ux = (tw.x1 - tw.x0) / len, uy = (tw.y1 - tw.y0) / len;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const px = tw.x0 + (tw.x1 - tw.x0) * t, py = tw.y0 + (tw.y1 - tw.y0) * t;
        const side = i % 2 ? 1 : -1;
        const nl = r.float(12, 24) * (1 - t * 0.45);
        // needles angle forward along the twig
        const ax = -uy * side * 0.85 + ux * 0.5, ay = ux * side * 0.85 + uy * 0.5;
        const g = r.float(0.55, 1.05);
        ctx.strokeStyle = `rgb(${(34 * g) | 0},${(64 * g) | 0},${(38 * g) | 0})`;
        ctx.lineWidth = r.float(1.6, 2.6);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ax * nl, py + ay * nl + r.float(0, 4)); ctx.stroke();
      }
    }
    return tex(c, { repeat: false });
  }),

  grass: () => once('grass', () => {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const r = new Rng(3);
    for (let i = 0; i < 26; i++) {
      const x = r.float(10, S - 10), h = r.float(S * 0.45, S * 0.98), lean = r.float(-22, 22);
      const g = r.float(0.6, 1.1);
      ctx.fillStyle = `rgb(${(92 * g) | 0},${(118 * g) | 0},${(52 * g) | 0})`;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, S);
      ctx.quadraticCurveTo(x + lean * 0.3, S - h * 0.6, x + lean, S - h);
      ctx.quadraticCurveTo(x + lean * 0.3 + 1, S - h * 0.6, x + 2.5, S);
      ctx.fill();
    }
    const t = tex(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }),

  // Tall seeding grass (a square card, as wide as tall): thin blades going from dark green at the foot to straw at
  // the tip, some carrying a timothy spike or a loose, nodding oat panicle.
  tallGrass: () => once('tallGrass', () => {
    const W = 256, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const r = new Rng(17);
    ctx.lineCap = 'round';
    const mix = (k, a, b) => a.map((v, i) => v + (b[i] - v) * k);
    const css = (a) => `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`;
    const foot = [38, 50, 28], green = [80, 96, 54], straw = [172, 152, 106];
    for (let i = 0; i < 56; i++) {
      const x = r.float(16, W - 16), h = r.float(H * 0.5, H * 0.97), lean = r.float(-28, 28);
      const ripe = r.float(0.2, 1), g = r.float(0.8, 1.1);
      const grad = ctx.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, css(foot));
      grad.addColorStop(0.45, css(green.map((v) => v * g)));
      grad.addColorStop(1, css(mix(ripe, green, straw).map((v) => v * g)));
      const tx = x + lean, ty = H - h;
      if (r.next() < 0.35) {
        // A bare stem ending in a head.
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, H); ctx.quadraticCurveTo(x + lean * 0.2, H - h * 0.55, tx, ty); ctx.stroke();
        const head = css(mix(ripe, [132, 134, 80], [206, 184, 122]).map((v) => v * g));
        ctx.fillStyle = ctx.strokeStyle = head;
        if (r.next() < 0.5) {
          // Timothy: a slim spike along the stem's last stretch.
          const len = r.float(18, 30), ang = Math.atan2(lean * 0.8, h * 0.45);
          ctx.save(); ctx.translate(tx, ty + len * 0.45); ctx.rotate(ang);
          ctx.beginPath(); ctx.ellipse(0, 0, 2.2, len / 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else {
          // Oat: a few spikelets nodding off hair-thin branches below the tip, irregularly spaced.
          ctx.lineWidth = 0.8;
          for (let k = 0, y = 0; k < 6; k++, y += r.float(3, 7)) {
            const side = r.sign(), reach = r.float(4, 11), drop = r.float(6, 12);
            const px = tx - lean * 0.004 * y, py = ty + y;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + side * reach, py, px + side * reach, py + drop * 0.6); ctx.stroke();
            ctx.beginPath(); ctx.ellipse(px + side * reach, py + drop * 0.6 + 3, 1.6, 3.6, side * r.float(0, 0.4), 0, Math.PI * 2); ctx.fill();
          }
        }
      } else {
        // A leaf blade: wide at the foot, curving to a point.
        const w = r.float(1.8, 2.8);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - w, H);
        ctx.quadraticCurveTo(x + lean * 0.25, H - h * 0.6, tx, ty);
        ctx.quadraticCurveTo(x + lean * 0.25 + w * 0.6, H - h * 0.6, x + w, H);
        ctx.fill();
      }
    }
    const t = tex(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }),

  // Tileable ripple height -> normal map for flowing water.
  water: () => once('water', () => {
    const S = 256;
    const h = heightField(S, (u, v) => {
      // Smooth, slightly stretched swells rather than sharp ridges.
      return tfbm(u, v, 6, 4, 61) * 0.7 + tnoise(u, v, 24, 71) * 0.2 + tnoise(u, v, 48, 73) * 0.1;
    });
    return tex(normalFromHeight(S, h, 1.4), { srgb: false });
  }),

  puff: () => once('puff', () => {
    const S = 128;
    const c = toCanvas(S, (x, y) => {
      const u = x / S - 0.5, v = y / S - 0.5;
      const d = Math.hypot(u, v) * 2;
      const n = tfbm(x / S, y / S, 4, 4, 13);
      const a = Math.max(0, 1 - d * (1.1 - n * 0.5));
      return [255, 255, 255, Math.pow(a, 1.6) * 255];
    });
    const t = tex(c, { repeat: false });
    return t;
  }),

  soft: () => once('soft', () => {
    const S = 64;
    const c = toCanvas(S, (x, y) => {
      const d = Math.hypot(x / S - 0.5, y / S - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      return [255, 255, 255, a * a * 255];
    });
    return tex(c, { repeat: false });
  }),

  // ---------- Cabin ----------
  // Southwestern wool rug: bands of stepped diamonds in rust, cream, charcoal and a little turquoise.
  rug: () => once('rug', () => {
    const W = 512, H = 768;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const cream = '#e8dcc4', rust = '#a4492a', char = '#2d2926', sand = '#c9a878', teal = '#3f7f7a';
    g.fillStyle = cream; g.fillRect(0, 0, W, H);
    const band = (y, h, col) => { g.fillStyle = col; g.fillRect(0, y, W, h); };
    band(0, 34, char); band(H - 34, 34, char);
    band(46, 10, rust); band(H - 56, 10, rust);
    band(66, 6, teal); band(H - 72, 6, teal);
    // Central stepped diamonds
    const diamond = (cx, cy, r, col, step = 12) => {
      g.fillStyle = col;
      for (let k = 0; k < r; k += step) {
        const w = (r - k) * 2;
        g.fillRect(cx - w / 2, cy - k - step, w, step);
        g.fillRect(cx - w / 2, cy + k, w, step);
      }
    };
    for (const cy of [H * 0.3, H * 0.5, H * 0.7]) {
      diamond(W / 2, cy, 130, rust);
      diamond(W / 2, cy, 92, cream);
      diamond(W / 2, cy, 60, char);
      diamond(W / 2, cy, 26, sand, 8);
    }
    // Side arrows
    g.fillStyle = char;
    for (let y = 110; y < H - 110; y += 44) {
      for (const x of [40, W - 40]) {
        g.beginPath(); g.moveTo(x - 18, y); g.lineTo(x, y - 16); g.lineTo(x + 18, y); g.lineTo(x, y + 16); g.closePath(); g.fill();
      }
    }
    band(98, 4, sand); band(H - 102, 4, sand);
    // Woven texture
    const img = g.getImageData(0, 0, W, H);
    const r = new Rng(12);
    for (let i = 0; i < img.data.length; i += 4) {
      const px = (i / 4) % W, py = Math.floor(i / 4 / W);
      const k = 0.86 + ((px + py) % 4 < 2 ? 0.08 : 0) + r.next() * 0.1;
      img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    return tex(c, { repeat: false });
  }),

  // Stacked ledgestone: long, thin courses of warm grey and tan stone with deep joints. Tileable; one tile
  // is meant to cover about 2.4 m (the cabin sets repeat 0.5 on UVs authored at ~1.2 m).
  ledgestone: () => once('ledgestone', () => {
    const S = 1024;
    const r = new Rng(77);
    const heights = [];
    let tot = 0;
    while (tot < S - 60) { const hh = r.float(34, 92); heights.push(hh); tot += hh; }
    const rows = [];
    let y0 = 0;
    for (const hh of heights) {
      const y1 = y0 + hh * S / tot;
      const ws = [];
      let t = 0;
      while (t < S - 80) { const w = r.float(90, 400); ws.push(w); t += w; }
      let x = r.float(0, S);
      const list = ws.map((w) => { const st = { x0: x, x1: x + w * S / t, id: r.int(0, 1 << 20), tone: r.int(0, 5), k: r.float(0.86, 1.1) }; x = st.x1; return st; });
      rows.push({ y0, y1, list });
      y0 = y1;
    }
    const rowOf = new Int16Array(S);
    for (let ri = 0, y = 0; y < S; y++) { while (y >= rows[ri].y1 && ri < rows.length - 1) ri++; rowOf[y] = ri; }
    // One pass: distance to the stone's edge (px, with a ragged outline) and which stone.
    const dist = new Float32Array(S * S), sid = new Int32Array(S * S), row = new Int16Array(S * S);
    for (let y = 0; y < S; y++) {
      const R = rows[rowOf[y]];
      const dy = Math.min(y + 0.5 - R.y0, R.y1 - y - 0.5);
      for (let x = 0; x < S; x++) {
        let dx = 0, si = 0;
        for (let k = 0; k < R.list.length; k++) {
          const st = R.list[k];
          let xx = x + 0.5;
          while (xx < st.x0) xx += S;
          while (xx >= st.x0 + S) xx -= S;
          if (xx < st.x1) { dx = Math.min(xx - st.x0, st.x1 - xx); si = k; break; }
        }
        const u = x / S, v = y / S;
        const rag = (tnoise(u, v, 48, 3) - 0.5) * 7 + (tnoise(u, v, 160, 5) - 0.5) * 3;
        const i = y * S + x;
        dist[i] = Math.min(dx, dy * 1.15) - 4.5 + rag;
        sid[i] = si; row[i] = rowOf[y];
      }
    }
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, d = dist[i], u = x / S, v = y / S;
      if (d < 0) { h[i] = 0.06 + tnoise(u, v, 128, 9) * 0.05; continue; }
      const st = rows[row[i]].list[sid[i]];
      const pillow = Math.min(1, d / 11);
      const split = Math.sin((v * 150 + tfbm(u, v, 8, 3, st.id & 255) * 3) * Math.PI) * 0.035; // cleft layering
      h[i] = 0.42 + pillow * (2 - pillow) * 0.26 + tfbm(u, v, 16, 4, 31) * 0.2 + split;
    }
    const tones = [[166, 157, 143], [148, 139, 126], [184, 170, 148], [134, 127, 119], [174, 150, 122], [118, 112, 104]];
    const col = toCanvas(S, (x, y) => {
      const i = y * S + x, d = dist[i], u = x / S, v = y / S;
      if (d < 0) { const k = 0.8 + tnoise(u, v, 64, 4) * 0.3; return [62 * k, 56 * k, 50 * k]; }
      const st = rows[row[i]].list[sid[i]];
      const t = tones[st.tone];
      const mott = 0.9 + (tfbm(u, v, 12, 4, 51) - 0.5) * 0.3 + (tnoise(u, v, 256, 7) - 0.5) * 0.08;
      const edge = 0.72 + 0.28 * Math.min(1, d / 9);
      const k = st.k * mott * edge;
      return [t[0] * k, t[1] * k, t[2] * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 3.2), { srgb: false }) };
  }),

  // ---------- Cabin (Blender model) materials. Mostly neutral: the model's vertex colors carry the hue. ----------
  // Wide oak planks: 6 rows per tile (tile = 2.4 m x 1.2 m in the model), staggered end joints, per-plank tone.
  oakPlanks: () => once('oakPlanks', () => {
    const S = 512, rows = 6;
    const r = new Rng(31);
    const joints = [];
    for (let i = 0; i < rows; i++) {
      const a = r.next();
      joints.push([a, (a + 0.3 + r.next() * 0.35) % 1].sort((p, q) => p - q));
    }
    const plank = (u, v) => {
      const row = Math.min(rows - 1, Math.floor(v * rows));
      const [j0, j1] = joints[row];
      const seg = u < j0 ? 0 : u < j1 ? 1 : 0; // wraps: the last and first pieces are one plank
      return { row, id: row * 7 + seg, fv: v * rows - row, du: Math.min(Math.abs(u - j0), Math.abs(u - j1), Math.abs(u - j0 - 1), Math.abs(u - j1 + 1)) };
    };
    const h = heightField(S, (u, v) => {
      const p = plank(u, v);
      const seamV = Math.min(p.fv, 1 - p.fv) * rows * S / rows;   // pixels to the long seam
      const seamU = p.du * S;
      const seam = Math.max(1 - seamV / 1.6, 1 - seamU / 1.4, 0);
      const grain = Math.sin((p.fv * 9 + tfbm(u, v, 4, 3, p.id + 3) * 2.4 + p.id * 1.7) * Math.PI * 2);
      return 0.7 + grain * 0.04 + tfbm(u, v, 32, 2, p.id) * 0.06 - seam * 0.5;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const p = plank(u, v);
      const tone = 0.86 + periodicHash(p.id, 3, 997, 5) * 0.16;
      const g = tfbm(u * 0.5, v, 16, 4, p.id + 11);
      const lines = Math.pow(Math.abs(Math.sin((p.fv * 7 + g * 3.5 + p.id) * Math.PI * 2)), 6);
      const knot = Math.max(0, 1 - Math.hypot((u * 7 + p.id * 0.37) % 1 - 0.5, (p.fv - 0.5) * 2.5) * 5) * (periodicHash(p.id, 9, 997, 2) > 0.7 ? 1 : 0);
      const hv = h[y * S + x];
      let k = tone * (0.93 + g * 0.08 - lines * 0.08 - knot * 0.25) * (hv < 0.45 ? 0.55 : 1);
      k = Math.min(1.05, k);
      return [248 * k, 240 * k, 230 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.2), { srgb: false }) };
  }),

  // Neutral wood grain for beams, furniture, cedar and black-painted boards. The model's UVs run u along
  // each board, so the grain lines run along u: fine latewood lines that drift gently, plus long fibres.
  woodGrain: () => once('woodGrain', () => {
    const S = 512;
    const ring = new Float32Array(S * S), fib = new Float32Array(S * S), low = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      // The drift varies across the lines as well as along them, so neighbouring lines converge and part
      // like real flat-sawn grain instead of waving in unison.
      const drift = (tfbmA(u, v, 2, 12, 3, 7) - 0.5) * 1.7 + (tnoiseA(u, v, 4, 24, 17) - 0.5) * 0.35;
      ring[i] = Math.pow(Math.abs(Math.sin((v * 28 + drift) * Math.PI)), 6);
      fib[i] = tnoiseA(u, v, 4, 192, 13) * 0.6 + tnoiseA(u, v, 8, 384, 19) * 0.4;
      low[i] = tfbmA(u, v, 2, 2, 2, 21);
    }
    const h = heightField(S, (u, v) => { const i = Math.floor(v * S) * S + Math.floor(u * S); return 0.62 - ring[i] * 0.22 + fib[i] * 0.2; });
    const col = toCanvas(S, (x, y) => {
      const i = y * S + x;
      const k = 0.94 - ring[i] * 0.12 + (fib[i] - 0.5) * 0.12 + (low[i] - 0.5) * 0.12;
      return [246 * k, 238 * k, 228 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 1.1), { srgb: false }) };
  }),

  limewash: () => once('limewash', () => {
    const S = 512;
    const h = heightField(S, (u, v) => tfbm(u, v, 6, 5, 41) * 0.8 + tnoise(u, v, 128, 3) * 0.2);
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const cloud = tfbm(u, v, 3, 5, 44);
      const k = 0.94 + (cloud - 0.5) * 0.1 + (tnoise(u, v, 256, 5) - 0.5) * 0.03;
      return [252 * k, 248 * k, 242 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 1.2), { srgb: false }) };
  }),

  // Plain weave (linen) — albedo stays close to white; the normal map carries the threads.
  weave: () => once('weave', () => {
    const S = 256, n = 48;
    const h = heightField(S, (u, v) => {
      const a = Math.sin(u * n * Math.PI * 2), b = Math.sin(v * n * Math.PI * 2);
      const over = ((Math.floor(u * n) + Math.floor(v * n)) & 1) ? a : b;
      return 0.5 + 0.35 * Math.abs(over) + tnoise(u, v, 64, 3) * 0.15;
    });
    const col = toCanvas(S, (x, y) => {
      const k = 0.88 + h[y * S + x] * 0.14 + (tnoise(x / S, y / S, 16, 8) - 0.5) * 0.06;
      return [250 * k, 248 * k, 244 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.4), { srgb: false }) };
  }),

  // Handmade glazed square tiles with pooled, uneven surfaces.
  zellige: () => once('zellige', () => {
    const S = 512, n = 6;
    const h = heightField(S, (u, v) => {
      const fu = (u * n) % 1, fv = (v * n) % 1;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv) * S / n;
      const id = Math.floor(u * n) + Math.floor(v * n) * n;
      if (edge < 1.8) return 0.2;
      const bevel = Math.min(1, edge / 7);
      return 0.55 + bevel * 0.3 + tfbm(u, v, 12, 3, id + 5) * 0.2;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const fu = (u * n) % 1, fv = (v * n) % 1;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv) * S / n;
      if (edge < 1.8) return [214, 208, 198];
      const id = Math.floor(u * n) + Math.floor(v * n) * n;
      const t = periodicHash(id, 7, 997, 1);
      const k = 0.9 + t * 0.1 + (tfbm(u, v, 16, 2, id) - 0.5) * 0.08;
      return [250 * k, (246 - t * 6) * k, (238 - t * 10) * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 3.5), { srgb: false }) };
  }),

  // Terracotta hexagon floor tiles: a tileable offset-row lattice (7 x 8 is within 1% of true hex proportions).
  hexTile: () => once('hexTile', () => {
    const S = 512, cols = 7, rows = 8;
    const hexAt = (u, v) => {
      const x = u * cols, y = v * rows;
      let best = 1e9, second = 1e9, bid = 0;
      const r0 = Math.floor(y);
      for (let rr = r0 - 1; rr <= r0 + 1; rr++) {
        const wr = ((rr % rows) + rows) % rows;
        const off = wr % 2 ? 0.5 : 0;
        const c0 = Math.floor(x - off);
        for (let cc = c0 - 1; cc <= c0 + 1; cc++) {
          const dx = (x - (cc + 0.5 + off)) / cols, dy = (y - (rr + 0.5)) / rows;
          const d = Math.hypot(dx, dy);
          if (d < best) { second = best; best = d; bid = (((cc % cols) + cols) % cols) * 31 + wr; }
          else if (d < second) second = d;
        }
      }
      return { id: bid, edge: (second - best) * cols };
    };
    const h = heightField(S, (u, v) => { const c = hexAt(u, v); return c.edge < 0.05 ? 0.2 : 0.6 + Math.min(1, c.edge * 4) * 0.2 + tnoise(u, v, 32, c.id) * 0.15; });
    const col = toCanvas(S, (x, y) => {
      const c = hexAt(x / S, y / S);
      if (c.edge < 0.05) return [208, 198, 186];
      const t = periodicHash(c.id, 1, 9973, 3);
      const k = 0.82 + t * 0.24 + (tnoise(x / S, y / S, 24, c.id) - 0.5) * 0.1;
      return [192 * k, 118 * k * (0.94 + t * 0.1), 88 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.5), { srgb: false }) };
  }),

  marble: () => once('marble', () => {
    const S = 512;
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const w = tfbm(u, v, 3, 5, 61);
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 2 + v + w * 2.6) * Math.PI)), 26);
      const fine = Math.pow(1 - Math.abs(Math.sin((u * 3 - v * 2 + tfbm(u, v, 5, 4, 63) * 3) * Math.PI)), 60);
      const k = 0.96 - vein * 0.32 - fine * 0.16 + (tfbm(u, v, 8, 3, 65) - 0.5) * 0.04;
      return [246 * k, 245 * k, 243 * k];
    });
    return { map: tex(col) };
  }),

  jute: () => once('jute', () => {
    const S = 256;
    const h = heightField(S, (u, v) => {
      const braid = Math.abs(Math.sin((u * 16 + Math.sin(v * 64 * Math.PI) * 0.12) * Math.PI));
      const cross = Math.abs(Math.sin(v * 64 * Math.PI));
      return braid * 0.6 + cross * 0.25 + tnoise(u, v, 64, 9) * 0.15;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const k = 0.72 + h[y * S + x] * 0.35 + (tfbm(u, v, 8, 3, 71) - 0.5) * 0.12;
      return [212 * k, 184 * k, 138 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.8), { srgb: false }) };
  }),

  // ---------- Observatory (Blender model) ----------
  // One painted steel dome panel per tile (a 15-degree gore by 1.15 m): lapped seams on all four edges,
  // rows of rivet heads along them, slight oil-canning and faint rain streaks. Neutral white.
  domePanels: () => once('domePanels', () => {
    const S = 512;
    const rivetsU = 16, rivetsV = 12;
    const rivet = (u, v) => {
      let best = 1;
      // Rows just inside each seam, left/right (along v) and top/bottom (along u).
      for (const ru of [0.035, 0.965]) {
        const rv = (Math.round(v * rivetsV - 0.5) + 0.5) / rivetsV;
        best = Math.min(best, Math.hypot((u - ru) * 1.3, v - rv) * S / 5.5);
      }
      for (const rv of [0.03, 0.97]) {
        const ru = (Math.round(u * rivetsU - 0.5) + 0.5) / rivetsU;
        best = Math.min(best, Math.hypot((u - ru) * 1.3, v - rv) * S / 5.5);
      }
      return best;
    };
    const h = heightField(S, (u, v) => {
      const seam = Math.min(u, 1 - u, v, 1 - v) * S;
      const lap = seam < 2.5 ? 0.25 : seam < 5 ? 0.62 : 0.56;       // groove, then the lapped edge
      const r = rivet(u, v);
      const head = r < 1 ? Math.sqrt(1 - r * r) * 0.35 : 0;
      const oil = tfbm(u, v, 2, 3, 12) * 0.12;
      return lap + head + oil;
    });
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const seam = Math.min(u, 1 - u, v, 1 - v) * S;
      const streak = Math.pow(tnoise(u, v * 0.25, 48, 7), 3) * 0.12 * (0.5 + v * 0.5);
      const grime = seam < 3 ? 0.78 : 1;
      const k = (0.95 + (tfbm(u, v, 4, 4, 21) - 0.5) * 0.08 - streak) * grime * (rivet(u, v) < 1 ? 0.93 : 1);
      return [250 * k, 249 * k, 244 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 2.6), { srgb: false }) };
  }),

  // Diamond tread plate (checker plate), raised lozenges alternating direction. Tile ~0.6 m.
  treadPlate: () => once('treadPlate', () => {
    const S = 256, n = 8;
    const h = heightField(S, (u, v) => {
      const cu = u * n, cv = v * n;
      const iu = Math.floor(cu), iv = Math.floor(cv);
      const fu = cu - iu - 0.5, fv = cv - iv - 0.5;
      const flip = (iu + iv) & 1;
      const a = flip ? (fu + fv) : (fu - fv), b = flip ? (fu - fv) : (fu + fv);
      const d = Math.abs(a) / 0.42 + Math.abs(b) / 0.09;
      return (d < 1 ? 0.8 - d * 0.2 : 0.3) + tnoise(u, v, 64, 5) * 0.05;
    });
    const col = toCanvas(S, (x, y) => {
      const k = 0.78 + h[y * S + x] * 0.22 + (tfbm(x / S, y / S, 6, 3, 17) - 0.5) * 0.12;
      return [236 * k, 238 * k, 240 * k];
    });
    return { map: tex(col), normal: tex(normalFromHeight(S, h, 4), { srgb: false }) };
  }),

  // Fine brushed/cast metal: neutral, so vertex colors decide brass vs steel vs black paint.
  brushed: () => once('brushed', () => {
    const S = 256;
    const col = toCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const k = 0.9 + (tnoiseA(u, v, 4, 128, 3) - 0.5) * 0.1 + (tfbm(u, v, 4, 3, 9) - 0.5) * 0.12;
      return [250 * k, 250 * k, 250 * k];
    });
    return { map: tex(col) };
  }),

  // Atlas for the observatory's printed things (Blender UV space: v up; flipY = false). No text anywhere:
  //   star chart  u 0..0.62,   v 0..1     dial face  u 0.64..1, v 0.64..1
  //   meter face  u 0.64..1,   v 0.42..0.62   greenbar paper  u 0.64..1, v 0..0.4
  obsAtlas: () => once('obsAtlas', () => {
    const S = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const R = (u0, v0, u1, v1) => ({ x: u0 * S, y: (1 - v1) * S, w: (u1 - u0) * S, h: (v1 - v0) * S });
    const r = new Rng(424);
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, S, S);

    // Star chart: cream border, deep blue field, polar grid, Milky Way haze, stars, constellation lines.
    {
      const b = R(0, 0, 0.62, 1);
      g.fillStyle = '#e6dcc2'; g.fillRect(b.x, b.y, b.w, b.h);
      const m = 22, fx = b.x + m, fy = b.y + m, fw = b.w - 2 * m, fh = b.h - 2 * m;
      g.fillStyle = '#12213d'; g.fillRect(fx, fy, fw, fh);
      g.save();
      g.beginPath(); g.rect(fx, fy, fw, fh); g.clip();
      const cx = fx + fw / 2, cy = fy + fh * 0.42, rad = fw * 0.47;
      for (let i = 0; i < 2600; i++) {   // Milky Way: a soft diagonal band of faint dots
        const t = r.next(), off = (r.next() + r.next() + r.next() - 1.5) * 0.18;
        const px = fx + t * fw, py = fy + fh * (0.95 - t * 0.9) + off * fh;
        g.fillStyle = `rgba(200,210,255,${0.05 + r.next() * 0.08})`;
        g.fillRect(px, py, 2, 2);
      }
      g.strokeStyle = 'rgba(140,170,220,0.35)'; g.lineWidth = 1;
      for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, rad * k / 4, 0, Math.PI * 2); g.stroke(); }
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); g.stroke();
      }
      g.strokeStyle = 'rgba(230,160,80,0.55)'; g.setLineDash([6, 5]); g.beginPath();
      for (let k = 0; k <= 60; k++) { const a = k / 60 * Math.PI * 2; const rr = rad * (0.62 + 0.12 * Math.sin(a)); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.9 + rad * 0.12; k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke(); g.setLineDash([]);
      const stars = [];
      for (let i = 0; i < 520; i++) {
        const s = Math.pow(r.next(), 6);
        const px = fx + r.next() * fw, py = fy + r.next() * fh;
        stars.push([px, py, s]);
        g.fillStyle = `rgba(255,${240 - s * 40},${220 + s * 35},${0.5 + s * 0.5})`;
        g.beginPath(); g.arc(px, py, 0.8 + s * 3.2, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(250,245,225,0.6)'; g.lineWidth = 1.4;
      for (let k = 0; k < 9; k++) {   // constellations: chains of the brighter nearby stars
        let cur = stars[r.int(0, stars.length - 1)];
        g.beginPath(); g.moveTo(cur[0], cur[1]);
        for (let j = 0; j < 4 + r.int(0, 3); j++) {
          let best = null, bd = 1e9;
          for (const st of stars) {
            const d = Math.hypot(st[0] - cur[0], st[1] - cur[1]);
            if (d > 18 && d < 85 && st[2] > 0.05 && d < bd && r.next() > 0.3) { bd = d; best = st; }
          }
          if (!best) break;
          g.lineTo(best[0], best[1]);
          cur = best;
        }
        g.stroke();
      }
      g.restore();
      g.strokeStyle = '#3a3226'; g.lineWidth = 2; g.strokeRect(fx - 4, fy - 4, fw + 8, fh + 8);
      g.fillStyle = '#3a3226';
      for (let k = 0; k <= 36; k++) {   // graduated border
        const t = k / 36;
        const L = k % 6 ? 5 : 10;
        g.fillRect(fx + t * fw - 1, fy - 4 - L, 2, L);
        g.fillRect(fx + t * fw - 1, fy + fh + 4, 2, L);
      }
    }

    // Gauge dial: cream face, black ring, ticks every 5 degrees (long every 30), a red arc.
    {
      const b = R(0.64, 0.64, 1, 1);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = b.w / 2;
      g.fillStyle = '#151515'; g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = '#efe7d2'; g.beginPath(); g.arc(cx, cy, rad * 0.98, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#1b1b1b';
      for (let k = 0; k < 72; k++) {
        const a = k / 72 * Math.PI * 2, L = k % 6 ? 0.08 : 0.16;
        g.lineWidth = k % 6 ? 2 : 4;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * rad * 0.9, cy + Math.sin(a) * rad * 0.9);
        g.lineTo(cx + Math.cos(a) * rad * (0.9 - L), cy + Math.sin(a) * rad * (0.9 - L)); g.stroke();
      }
      g.strokeStyle = '#b3322a'; g.lineWidth = 10;
      g.beginPath(); g.arc(cx, cy, rad * 0.62, -Math.PI * 0.62, -Math.PI * 0.38); g.stroke();
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, rad * 0.9, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(cx, cy, rad * 0.06, 0, Math.PI * 2); g.fill();
    }

    // Panel meter: cream face, arc scale with ticks, red zone at the top end.
    {
      const b = R(0.64, 0.42, 1, 0.62);
      g.fillStyle = '#ece3cb'; g.fillRect(b.x, b.y, b.w, b.h);
      const cx = b.x + b.w / 2, cy = b.y + b.h * 0.92, rad = b.h * 0.72;
      g.strokeStyle = '#222'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, rad, -Math.PI * 0.8, -Math.PI * 0.2); g.stroke();
      for (let k = 0; k <= 20; k++) {
        const a = -Math.PI * 0.8 + k / 20 * Math.PI * 0.6, L = k % 5 ? 0.08 : 0.16;
        g.lineWidth = k % 5 ? 1.5 : 3;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        g.lineTo(cx + Math.cos(a) * rad * (1 + L), cy + Math.sin(a) * rad * (1 + L)); g.stroke();
      }
      g.strokeStyle = '#b3322a'; g.lineWidth = 7;
      g.beginPath(); g.arc(cx, cy, rad * 1.06, -Math.PI * 0.3, -Math.PI * 0.2); g.stroke();
      g.strokeStyle = '#555'; g.lineWidth = 3; g.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    }

    // Greenbar tractor-feed paper: pale green bands, sprocket holes, faint scribbled figures.
    {
      const b = R(0.64, 0, 1, 0.4);
      g.fillStyle = '#f4f3ea'; g.fillRect(b.x, b.y, b.w, b.h);
      const band = b.h / 12;
      g.fillStyle = '#d7ead2';
      for (let k = 0; k < 12; k += 2) g.fillRect(b.x + 26, b.y + k * band, b.w - 52, band);
      g.fillStyle = '#c9c7bd';
      for (let k = 0; k < 20; k++) {
        g.beginPath(); g.arc(b.x + 12, b.y + (k + 0.5) * b.h / 20, 4, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(b.x + b.w - 12, b.y + (k + 0.5) * b.h / 20, 4, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(40,40,60,0.55)';
      for (let row = 0; row < 34; row++) {   // columns of little dashes: printout, but unreadable
        let x = b.x + 34 + r.int(0, 3) * 8;
        const y = b.y + 8 + row * (b.h - 16) / 34;
        while (x < b.x + b.w - 40) {
          const w = 4 + r.int(0, 5) * 5;
          if (r.next() > 0.2) g.fillRect(x, y, w, 3);
          x += w + 5 + (r.next() > 0.85 ? 18 : 0);
        }
      }
      g.strokeStyle = 'rgba(30,50,140,0.7)'; g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k < 40; k++) { const x = b.x + 60 + k * 6, y = b.y + b.h * 0.72 + Math.sin(k * 0.5) * 14 + r.next() * 5; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      g.beginPath(); g.arc(b.x + b.w * 0.72, b.y + b.h * 0.3, 26, 0, Math.PI * 2); g.stroke();
    }
    const t = tex(c, { repeat: false });
    t.flipY = false;
    return t;
  }),

  clockFace: () => once('clockFace', () => {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#efe6cf';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = '#2a2420';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      ctx.save(); ctx.rotate(a);
      ctx.fillRect(-(big ? 3 : 1), -S * 0.46, big ? 6 : 2, big ? 18 : 8);
      ctx.restore();
    }
    // Hands at 7:00 — minute hand straight up, hour hand at seven.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1512';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(0, 0);
    const ha = (7 / 12) * Math.PI * 2;
    ctx.lineTo(Math.sin(ha) * S * 0.24, -Math.cos(ha) * S * 0.24); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -S * 0.38); ctx.stroke();
    ctx.fillStyle = '#b3261e';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    const t = tex(c, { repeat: false });
    return t;
  }),
};
