// Seeded randomness and smooth noise used for procedural generation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
}

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hash3(ix, iy, iz, seed) {
  return hash2(ix + iz * 1619, iy - iz * 31337, seed);
}

const fade = (t) => t * t * (3 - 2 * t);

// Value noise in [-1, 1].
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return ((a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy) * 2 - 1;
}

export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (dz) => {
    const a = hash3(ix, iy, iz + dz, seed), b = hash3(ix + 1, iy, iz + dz, seed);
    const c = hash3(ix, iy + 1, iz + dz, seed), d = hash3(ix + 1, iy + 1, iz + dz, seed);
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fy;
  };
  const v0 = l(0), v1 = l(1);
  return (v0 + (v1 - v0) * fz) * 2 - 1;
}

export function fbm2(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export function fbm3(x, y, z, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// Periodic (angular) noise built from a random Fourier series; smooth and seamless around 2π.
export function makeAngularNoise(seed, terms = 10, minK = 2, falloff = 1.1) {
  const r = new Rng(seed);
  const coeffs = [];
  for (let k = minK; k < minK + terms; k++) coeffs.push({ k, a: r.float(0.4, 1) / Math.pow(k, falloff), p: r.float(0, Math.PI * 2) });
  const norm = coeffs.reduce((s, c) => s + c.a, 0);
  return (theta, shift = 0) => {
    let s = 0;
    for (const c of coeffs) s += c.a * Math.sin(c.k * theta + c.p + shift * c.k * 0.37);
    return s / norm;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
