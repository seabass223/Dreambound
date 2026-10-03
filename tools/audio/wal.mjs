// Web Audio Lite: an offline renderer of the part of the Web Audio API that src/audio/engine.js uses, so the game's
// sounds can be rendered to WAV files in Node (which has no OfflineAudioContext) and looked at and measured: see
// render.mjs. It follows the spec where that matters for level and timbre:
//  - AudioParam automation (setValueAtTime, linear and exponential ramps, setTargetAtTime, cancelScheduledValues) and
//    audio-rate inputs to a param (LFOs, vibrato, a gate pattern);
//  - BiquadFilter: the RBJ filters with Web Audio's Q conventions (dB for low- and high-pass);
//  - Oscillator: band-limited saw and square (polyBLEP), periodic waves by table, detune;
//  - BufferSource: loop points, offset and duration, playbackRate (linear interpolation);
//  - Panner (equal power, inverse distance, with Chrome's azimuth clamp) and StereoPanner (mono and stereo laws);
//  - Convolver, with the spec's normalisation (partitioned FFT convolution);
//  - WaveShaper (no oversampling), ConstantSource, Gain;
//  - DynamicsCompressor: Chrome's kernel (the exponential knee, adaptive release, 6 ms look-ahead, makeup gain), so
//    what comes out of the context is what the game's master chain puts out.
// Not modelled: HRTF panning, cone angles, WaveShaper oversampling, onended. Scheduled times are kept to the sample;
// the clock (currentTime) and the caller's tick move on a block at a time: 512 frames, 10.7 ms at 48 kHz.
export const BLOCK = 512;

// A seedable Math.random (the engine's randomness is all Math.random): the same as src/core/rng.js.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Param {
  constructor(ctx, v, lo = -Infinity, hi = Infinity) {
    this.ctx = ctx; this._v = v; this.ev = []; this.inputs = []; this.lo = lo; this.hi = hi;
    this.cur = -1; this.dirty = true; this.last = v; this.buf = new Float32Array(BLOCK);
  }
  get value() { return this.ev.length ? this.last : this._v; }
  set value(v) { if (this.ev.length) this.setValueAtTime(v, this.ctx.currentTime); else { this._v = v; this.last = v; } }
  ins(e) {
    e.at = this.ctx.currentTime;
    let i = this.ev.length;
    while (i > 0 && this.ev[i - 1].t > e.t) i--;
    this.ev.splice(i, 0, e); this.dirty = true; return this;
  }
  setValueAtTime(v, t) { return this.ins({ k: 'set', v, t }); }
  linearRampToValueAtTime(v, t) { return this.ins({ k: 'lin', v, t }); }
  exponentialRampToValueAtTime(v, t) { return this.ins({ k: 'exp', v, t }); }
  setTargetAtTime(v, t, c) { return this.ins({ k: 'tgt', v, t, c }); }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); this.dirty = true; return this; }
  // The value of the automation at time t, given the state after event i (i = -1: none yet).
  seg(i, t) {
    const ev = this.ev, nx = ev[i + 1];
    let t0, v0;
    if (i < 0) { t0 = nx ? Math.min(nx.at, nx.t) : 0; v0 = this._v; }
    else { const e = ev[i]; t0 = e.t; v0 = e.k === 'tgt' ? e.v0 : e.v; }
    if (nx && t < nx.t && (nx.k === 'lin' || nx.k === 'exp')) {
      const u = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-9, nx.t - t0)));
      if (nx.k === 'lin') return v0 + (nx.v - v0) * u;
      if (v0 === 0 || v0 * nx.v <= 0) return v0;      // (the spec: an exponential ramp from or through 0 holds, then jumps)
      return v0 * Math.pow(nx.v / v0, u);
    }
    if (i < 0) return this._v;
    const e = ev[i];
    if (e.k === 'tgt') return e.v + (e.v0 - e.v) * Math.exp(-(t - e.t) / e.c);
    return e.v;
  }
  // Fills this.buf for the block starting at frame f0; returns true if constant over the block.
  compute(f0) {
    const sr = this.ctx.sampleRate, buf = this.buf, ev = this.ev;
    let constant = true;
    if (!ev.length) { buf.fill(this._v); this.last = this._v; }
    else {
      if (this.dirty) {
        // Re-walk: each event's start value from the segment before it.
        for (let i = 0; i < ev.length; i++) ev[i].v0 = this.seg(i - 1, ev[i].t);
        this.cur = -1; this.dirty = false;
      }
      for (let n = 0; n < BLOCK; n++) {
        const t = (f0 + n) / sr;
        while (this.cur + 1 < ev.length && ev[this.cur + 1].t <= t) this.cur++;
        buf[n] = this.seg(this.cur, t);
      }
      this.last = buf[BLOCK - 1];
      const b0 = buf[0];
      for (let n = 1; n < BLOCK && constant; n++) if (buf[n] !== b0) constant = false;
    }
    for (const src of this.inputs) {
      const o = src.pull(f0);
      if (o.silent) continue;
      constant = false;
      if (o.mono) for (let n = 0; n < BLOCK; n++) buf[n] += o.L[n];
      else for (let n = 0; n < BLOCK; n++) buf[n] += 0.5 * (o.L[n] + o.R[n]);
    }
    if (this.lo > -Infinity || this.hi < Infinity) for (let n = 0; n < BLOCK; n++) buf[n] = Math.min(this.hi, Math.max(this.lo, buf[n]));
    return constant;
  }
}

const SILENT = { L: new Float32Array(BLOCK), R: new Float32Array(BLOCK), silent: true, mono: true };

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.inputs = []; this.outs = []; this.f = -1; this.o = null; ctx.nodes.push(this); }
  connect(d) { d.inputs.push(this); this.outs.push(d); return d; }
  disconnect(d) {
    const list = d ? [d] : this.outs.slice();
    for (const x of list) { const a = x.inputs; const i = a.indexOf(this); if (i >= 0) a.splice(i, 1); const j = this.outs.indexOf(x); if (j >= 0) this.outs.splice(j, 1); }
  }
  pull(f0) {
    if (this.f === f0) return this.o;
    this.f = f0;
    this.o = this.muted ? SILENT : this.process(f0);   // (node.muted = true: silenced however it is re-plugged)
    return this.o;
  }
  mix(f0) {
    let L = null, R = null, mono = true, silent = true;
    for (const s of this.inputs) {
      const o = s.pull(f0);
      if (o.silent) continue;
      if (!L) { L = new Float32Array(BLOCK); R = new Float32Array(BLOCK); }
      silent = false; if (!o.mono) mono = false;
      for (let n = 0; n < BLOCK; n++) { L[n] += o.L[n]; R[n] += o.R[n]; }
    }
    return silent ? SILENT : { L, R, mono, silent };
  }
}

class Gain extends Node {
  constructor(ctx) { super(ctx, 'Gain'); this.gain = new Param(ctx, 1); }
  process(f0) {
    const k = this.gain.compute(f0);
    const i = this.mix(f0);
    if (i.silent) return SILENT;
    const g = this.gain.buf;
    if (k) { const v = g[0]; if (v === 0) return SILENT; for (let n = 0; n < BLOCK; n++) { i.L[n] *= v; i.R[n] *= v; } }
    else for (let n = 0; n < BLOCK; n++) { i.L[n] *= g[n]; i.R[n] *= g[n]; }
    return i;
  }
}

class Biquad extends Node {
  constructor(ctx) {
    super(ctx, 'BiquadFilter'); this.type = 'lowpass';
    this.frequency = new Param(ctx, 350, 0, ctx.sampleRate / 2); this.Q = new Param(ctx, 1); this.gain = new Param(ctx, 0); this.detune = new Param(ctx, 0);
    this.s = [0, 0, 0, 0, 0, 0, 0, 0];   // x1 x2 y1 y2 per channel
  }
  coef(f, Q, G) {
    const sr = this.ctx.sampleRate, w = 2 * Math.PI * Math.max(1e-3, Math.min(f, sr / 2 - 1)) / sr, c = Math.cos(w), sn = Math.sin(w);
    const A = Math.pow(10, G / 40), aQ = sn / (2 * Math.max(1e-4, Q)), aQdB = sn / (2 * Math.pow(10, Q / 20));
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'lowpass': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + aQdB; a1 = -2 * c; a2 = 1 - aQdB; break;
      case 'highpass': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + aQdB; a1 = -2 * c; a2 = 1 - aQdB; break;
      case 'bandpass': b0 = aQ; b1 = 0; b2 = -aQ; a0 = 1 + aQ; a1 = -2 * c; a2 = 1 - aQ; break;
      case 'notch': b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + aQ; a1 = -2 * c; a2 = 1 - aQ; break;
      case 'allpass': b0 = 1 - aQ; b1 = -2 * c; b2 = 1 + aQ; a0 = 1 + aQ; a1 = -2 * c; a2 = 1 - aQ; break;
      case 'peaking': b0 = 1 + aQ * A; b1 = -2 * c; b2 = 1 - aQ * A; a0 = 1 + aQ / A; a1 = -2 * c; a2 = 1 - aQ / A; break;
      case 'lowshelf': case 'highshelf': {
        const aS = sn / 2 * Math.sqrt(2), sA = 2 * Math.sqrt(A) * aS, lo = this.type === 'lowshelf';
        if (lo) { b0 = A * ((A + 1) - (A - 1) * c + sA); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sA); a0 = (A + 1) + (A - 1) * c + sA; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sA; }
        else { b0 = A * ((A + 1) + (A - 1) * c + sA); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sA); a0 = (A + 1) - (A - 1) * c + sA; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sA; }
        break;
      }
      default: throw new Error('biquad type ' + this.type);
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }
  process(f0) {
    const kf = this.frequency.compute(f0), kq = this.Q.compute(f0), kg = this.gain.compute(f0);
    const i = this.mix(f0), s = this.s;
    if (i.silent && Math.abs(s[2]) + Math.abs(s[3]) + Math.abs(s[6]) + Math.abs(s[7]) < 1e-9) { s.fill(0); return SILENT; }
    const L = i.silent ? new Float32Array(BLOCK) : i.L, R = i.silent ? new Float32Array(BLOCK) : i.R;
    const mono = i.silent ? true : i.mono;
    const F = this.frequency.buf, Qb = this.Q.buf, Gb = this.gain.buf;
    let c = this.coef(F[0], Qb[0], Gb[0]);
    const chans = mono ? [[L, 0]] : [[L, 0], [R, 4]];
    if (mono) { s[4] = s[0]; s[5] = s[1]; s[6] = s[2]; s[7] = s[3]; }
    const varying = !(kf && kq && kg);
    for (let n = 0; n < BLOCK; n++) {
      if (varying && (n & 15) === 0) c = this.coef(F[n], Qb[n], Gb[n]);
      for (const [x, o] of chans) {
        const xi = x[n], y = c[0] * xi + c[1] * s[o] + c[2] * s[o + 1] - c[3] * s[o + 2] - c[4] * s[o + 3];
        s[o + 1] = s[o]; s[o] = xi; s[o + 3] = s[o + 2]; s[o + 2] = y; x[n] = y;
      }
    }
    if (mono) { R.set(L); s[4] = s[0]; s[5] = s[1]; s[6] = s[2]; s[7] = s[3]; }
    return { L, R, mono, silent: false };
  }
}

class Shaper extends Node {
  constructor(ctx) { super(ctx, 'WaveShaper'); this.curve = null; this.oversample = 'none'; }
  process(f0) {
    const i = this.mix(f0);
    if (i.silent || !this.curve) return i;
    const c = this.curve, m = c.length - 1;
    for (const x of [i.L, i.R]) for (let n = 0; n < BLOCK; n++) {
      const v = (Math.min(1, Math.max(-1, x[n])) + 1) / 2 * m, k = Math.min(m - 1, Math.floor(v)), u = v - k;
      x[n] = c[k] * (1 - u) + c[k + 1] * u;
    }
    return i;
  }
}

class Scheduled extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.t0 = Infinity; this.t1 = Infinity; this.onended = null; }
  start(t = 0, offset = 0, dur) { this.t0 = Math.max(t, this.ctx.currentTime); this.startOffset = offset || 0; this.dur = dur; }
  stop(t = 0) { this.t1 = Math.max(t, this.ctx.currentTime); }
  active(f0) { const sr = this.ctx.sampleRate; return this.t0 * sr < f0 + BLOCK && this.t1 * sr > f0 && !this.ended; }
}

class Osc extends Scheduled {
  constructor(ctx) { super(ctx, 'Oscillator'); this.type = 'sine'; this.frequency = new Param(ctx, 440, -ctx.sampleRate / 2, ctx.sampleRate / 2); this.detune = new Param(ctx, 0); this.ph = 0; this.wave = null; }
  setPeriodicWave(w) { this.wave = w; this.type = 'custom'; }
  process(f0) {
    if (!this.active(f0)) return SILENT;
    this.frequency.compute(f0); this.detune.compute(f0);
    const sr = this.ctx.sampleRate, F = this.frequency.buf, D = this.detune.buf, L = new Float32Array(BLOCK);
    const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
    for (let n = 0; n < BLOCK; n++) {
      const tt = (f0 + n) / sr;
      if (tt < this.t0 || tt >= this.t1) continue;
      const f = F[n] * Math.pow(2, D[n] / 1200), dt = Math.abs(f) / sr, p = this.ph;
      let v;
      switch (this.type) {
        case 'sine': v = Math.sin(2 * Math.PI * p); break;
        case 'square': v = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt); break;
        case 'sawtooth': v = 2 * p - 1 - blep(p, dt); break;
        case 'triangle': v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
        default: { const T = this.wave.table, N = T.length, x = p * N, k = Math.floor(x), u = x - k; v = T[k % N] * (1 - u) + T[(k + 1) % N] * u; }
      }
      L[n] = v;
      this.ph = (p + f / sr) % 1; if (this.ph < 0) this.ph += 1;
    }
    return { L, R: L, mono: true, silent: false };
  }
}

class Const extends Scheduled {
  constructor(ctx) { super(ctx, 'ConstantSource'); this.offset = new Param(ctx, 1); }
  process(f0) {
    if (!this.active(f0)) return SILENT;
    this.offset.compute(f0);
    const sr = this.ctx.sampleRate, L = new Float32Array(BLOCK);
    for (let n = 0; n < BLOCK; n++) { const t = (f0 + n) / sr; if (t >= this.t0 && t < this.t1) L[n] = this.offset.buf[n]; }
    return { L, R: L, mono: true, silent: false };
  }
}

class BufSrc extends Scheduled {
  constructor(ctx) { super(ctx, 'BufferSource'); this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; this.playbackRate = new Param(ctx, 1); this.detune = new Param(ctx, 0); this.pos = null; }
  process(f0) {
    if (!this.buffer || !this.active(f0)) return SILENT;
    this.playbackRate.compute(f0);
    const sr = this.ctx.sampleRate, b = this.buffer, len = b.length, k = b.sampleRate / sr;
    const ch = b.numberOfChannels, d0 = b.getChannelData(0), d1 = ch > 1 ? b.getChannelData(1) : d0;
    const L = new Float32Array(BLOCK), R = ch > 1 ? new Float32Array(BLOCK) : L;
    let ls = this.loopStart * b.sampleRate, le = this.loopEnd > 0 ? this.loopEnd * b.sampleRate : len;
    if (!(ls >= 0 && ls < le && le <= len)) { ls = 0; le = len; }
    for (let n = 0; n < BLOCK; n++) {
      const t = (f0 + n) / sr;
      if (t < this.t0 || t >= this.t1) continue;
      if (this.pos === null) { this.pos = (Number.isFinite(this.startOffset) ? this.startOffset : 0) * b.sampleRate; this.played = 0; }
      if (this.dur !== undefined && this.played >= this.dur * b.sampleRate) { this.ended = true; break; }
      let p = this.pos;
      if (this.loop) { while (p >= le) p -= le - ls; }
      else if (p >= len - 1) { this.ended = true; break; }
      const i0 = Math.floor(p), u = p - i0, i1 = this.loop && i0 + 1 >= le ? Math.min(len - 1, Math.ceil(ls)) : Math.min(len - 1, i0 + 1);
      L[n] = d0[i0] * (1 - u) + d0[i1] * u;
      if (ch > 1) R[n] = d1[i0] * (1 - u) + d1[i1] * u;
      const step = this.playbackRate.buf[n] * k;
      this.pos = p + step; this.played += Math.abs(step);
    }
    return { L, R, mono: ch === 1, silent: false };
  }
}

const v3 = (x, y, z) => ({ x, y, z });
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z), dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return l > 0 ? v3(a.x / l, a.y / l, a.z / l) : v3(0, 0, 0); };

class Listener extends Node {
  constructor(ctx) {
    super(ctx, 'listener');
    for (const [k, v] of [['positionX', 0], ['positionY', 0], ['positionZ', 0], ['forwardX', 0], ['forwardY', 0], ['forwardZ', -1], ['upX', 0], ['upY', 1], ['upZ', 0]]) this[k] = new Param(ctx, v);
  }
  setPosition(x, y, z) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
  setOrientation(a, b, c, d, e, f) { this.forwardX.value = a; this.forwardY.value = b; this.forwardZ.value = c; this.upX.value = d; this.upY.value = e; this.upZ.value = f; }
  state(f0) {
    const g = (p) => { p.compute(f0); return p.buf[0]; };
    return { pos: v3(g(this.positionX), g(this.positionY), g(this.positionZ)), fwd: v3(g(this.forwardX), g(this.forwardY), g(this.forwardZ)), up: v3(g(this.upX), g(this.upY), g(this.upZ)) };
  }
  process() { return SILENT; }
}

const panLaw = (i, az) => {   // equal-power, azimuth in -90..90 (or pan*90)
  const L = i.L, R = i.R;
  if (i.mono) {
    const x = (az + 90) / 180, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
    const oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK);
    for (let n = 0; n < BLOCK; n++) { oL[n] = L[n] * gl; oR[n] = L[n] * gr; }
    return { L: oL, R: oR, mono: false, silent: false };
  }
  if (az <= 0) { const x = (az + 90) / 90, c = Math.cos(x * Math.PI / 2), s = Math.sin(x * Math.PI / 2); for (let n = 0; n < BLOCK; n++) { const l = L[n], r = R[n]; L[n] = l + r * c; R[n] = r * s; } }
  else { const x = az / 90, c = Math.cos(x * Math.PI / 2), s = Math.sin(x * Math.PI / 2); for (let n = 0; n < BLOCK; n++) { const l = L[n], r = R[n]; L[n] = l * c; R[n] = r + l * s; } }
  return { L, R, mono: false, silent: false };
};

class Panner extends Node {
  constructor(ctx) {
    super(ctx, 'Panner'); this.panningModel = 'equalpower'; this.distanceModel = 'inverse'; this.refDistance = 1; this.rolloffFactor = 1; this.maxDistance = 10000;
    for (const k of ['positionX', 'positionY', 'positionZ', 'orientationX', 'orientationY', 'orientationZ']) this[k] = new Param(ctx, k === 'orientationX' ? 1 : 0);
  }
  setPosition(x, y, z) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
  process(f0) {
    const i = this.mix(f0);
    if (i.silent) return SILENT;
    const g = (p) => { p.compute(f0); return p.buf[0]; };
    const src = v3(g(this.positionX), g(this.positionY), g(this.positionZ)), Ls = this.ctx.listener.state(f0);
    const rel = sub(src, Ls.pos), d = Math.hypot(rel.x, rel.y, rel.z);
    let az = 0;
    if (d > 1e-6) {
      const sl = norm(rel), right = norm(cross(Ls.fwd, Ls.up)), up = cross(right, Ls.fwd);
      const upP = dot(sl, up), proj = norm(sub(sl, v3(up.x * upP, up.y * upP, up.z * upP)));
      az = 180 / Math.PI * Math.acos(Math.max(-1, Math.min(1, dot(proj, right))));
      if (dot(proj, Ls.fwd) < 0) az = 360 - az;
      az = az >= 0 && az <= 270 ? 90 - az : 450 - az;
      if (az < -90) az = -180 - az; else if (az > 90) az = 180 - az;
    }
    const dc = Math.min(Math.max(d, this.refDistance), this.maxDistance);
    const dg = this.refDistance / (this.refDistance + this.rolloffFactor * (dc - this.refDistance));
    const o = panLaw(i, az);
    for (let n = 0; n < BLOCK; n++) { o.L[n] *= dg; o.R[n] *= dg; }
    return o;
  }
}

class StereoPan extends Node {
  constructor(ctx) { super(ctx, 'StereoPanner'); this.pan = new Param(ctx, 0, -1, 1); }
  process(f0) {
    this.pan.compute(f0);
    const i = this.mix(f0);
    if (i.silent) return SILENT;
    return panLaw(i, this.pan.buf[BLOCK >> 1] * 90);
  }
}

// Chrome's DynamicsCompressorKernel: the static curve (linear below the threshold, an exponential knee, then the
// ratio's slope), the detector's adaptive release, the 6 ms look-ahead, and the makeup gain (1 / curve(1)) ^ 0.6.
// Its settings are read when the first block is rendered. inPeak / minShape: the loudest sample that went in and the
// deepest gain reduction (as a gain, before the makeup), since reset().
class Comp extends Node {
  constructor(ctx) {
    super(ctx, 'DynamicsCompressor');
    for (const [k, v] of [['threshold', -24], ['knee', 30], ['ratio', 12], ['attack', 0.003], ['release', 0.25]]) this[k] = new Param(ctx, v);
    this.reduction = 0; this.det = 1; this.g = 1; this.maxAtk = -1; this.c = null;
    const pre = Math.round(0.006 * ctx.sampleRate);
    this.ring = [new Float32Array(pre), new Float32Array(pre)]; this.rp = 0;
    this.reset();
  }
  reset() { this.inPeak = 0; this.minShape = 1; }
  setup() {
    const sr = this.ctx.sampleRate, lin = (d) => Math.pow(10, d / 20), dB = (x) => 20 * Math.log10(x);
    const threshold = this.threshold.value, knee = this.knee.value, ratio = this.ratio.value, attack = this.attack.value, release = this.release.value;
    const linT = lin(threshold), slope = 1 / ratio;
    const kneeCurve = (x, k) => (x < linT ? x : linT + (1 - Math.exp(-k * (x - linT))) / k);
    const slopeAt = (x, k) => { if (x < linT) return 1; const x2 = x * 1.001; return (dB(kneeCurve(x2, k)) - dB(kneeCurve(x, k))) / (dB(x2) - dB(x)); };
    let minK = 0.1, maxK = 10000, k = 5;
    for (let i = 0; i < 15; i++) { if (slopeAt(lin(threshold + knee), k) < slope) maxK = k; else minK = k; k = Math.sqrt(minK * maxK); }
    const kneeTdB = threshold + knee, kneeT = lin(kneeTdB), yKneeTdB = dB(kneeCurve(kneeT, k));
    const saturate = (x) => (x < kneeT ? kneeCurve(x, k) : lin(yKneeTdB + slope * (dB(x) - kneeTdB)));
    const rf = sr * release, y1 = rf * 0.09, y2 = rf * 0.16, y3 = rf * 0.42, y4 = rf * 0.98;
    this.c = {
      saturate, makeup: Math.pow(1 / saturate(1), 0.6), attackFrames: Math.max(0.001, attack) * sr, satReleaseFrames: 0.0025 * sr,
      kA: 0.9999999999999998 * y1 + 1.8432219684323923e-16 * y2 - 1.9373394351676423e-16 * y3 + 8.824516011816245e-18 * y4,
      kB: -1.5788320352845888 * y1 + 2.3305837032074286 * y2 - 0.9141194204840429 * y3 + 0.1623677525612032 * y4,
      kC: 0.5334142869106424 * y1 - 1.272736789213631 * y2 + 0.9258856042207512 * y3 - 0.18656310191776226 * y4,
      kD: 0.08783463138207234 * y1 - 0.1694162967925622 * y2 + 0.08588057951595272 * y3 - 0.00429891410546283 * y4,
      kE: -0.042416883008123074 * y1 + 0.1115693827987602 * y2 - 0.09764676325265872 * y3 + 0.028494263462021576 * y4,
    };
  }
  get makeupDb() { if (!this.c) this.setup(); return 20 * Math.log10(this.c.makeup); }
  process(f0) {
    if (!this.c) this.setup();
    const i = this.mix(f0), c = this.c, lin = (d) => Math.pow(10, d / 20), dB = (x) => 20 * Math.log10(x);
    const L = i.silent ? SILENT.L : i.L, R = i.silent ? SILENT.R : i.R;
    const oL = new Float32Array(BLOCK), oR = new Float32Array(BLOCK), ring = this.ring, pre = ring[0].length;
    for (let f = 0; f < BLOCK; f += 32) {
      const scaled = Math.asin(Math.min(1, this.det)) / (0.5 * Math.PI), releasing = scaled > this.g;
      let diff = dB(this.g / scaled), rate;
      if (releasing) {
        this.maxAtk = -1;
        if (!Number.isFinite(diff)) diff = -1;
        const x = 0.25 * (Math.min(0, Math.max(-12, diff)) + 12), x2 = x * x;
        rate = lin(5 / (c.kA + c.kB * x + c.kC * x2 + c.kD * x2 * x + c.kE * x2 * x2));
      } else {
        if (!Number.isFinite(diff)) diff = 1;
        if (this.maxAtk === -1 || this.maxAtk < diff) this.maxAtk = diff;
        rate = 1 - Math.pow(0.25 / Math.max(0.5, this.maxAtk), 1 / c.attackFrames);
      }
      for (let n = f; n < f + 32; n++) {
        const a = Math.max(Math.abs(L[n]), Math.abs(R[n]));
        if (a > this.inPeak) this.inPeak = a;
        const att = a <= 0.0001 ? 1 : c.saturate(a) / a;
        const satRate = lin(Math.max(2, -dB(att)) / c.satReleaseFrames) - 1;
        this.det = Math.min(1, this.det + (att - this.det) * (att > this.det ? satRate : 1));
        if (rate < 1) this.g += (scaled - this.g) * rate; else this.g = Math.min(1, this.g * rate);
        const shape = Math.sin(0.5 * Math.PI * this.g), g = c.makeup * shape, p = this.rp;
        if (shape < this.minShape) this.minShape = shape;
        oL[n] = ring[0][p] * g; oR[n] = ring[1][p] * g;
        ring[0][p] = L[n]; ring[1][p] = R[n];
        this.rp = (p + 1) % pre;
      }
    }
    this.reduction = 20 * Math.log10(Math.sin(0.5 * Math.PI * this.g));
    return { L: oL, R: oR, mono: false, silent: false };
  }
}

// Radix-2 FFT, in place (the convolver's, and the A-weighting's below).
export function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], k = i + j + len / 2, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[k] = ur - vr; im[k] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

class Convolver extends Node {
  constructor(ctx) { super(ctx, 'Convolver'); this.normalize = true; this._buf = null; }
  set buffer(b) {
    this._buf = b;
    if (!b) return;
    const N = 2 * BLOCK, ch = b.numberOfChannels, len = b.length;
    let scale = 1;
    if (this.normalize) {
      let p = 0;
      for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) p += d[i] * d[i]; }
      p = Math.max(Math.sqrt(p / (ch * len)), 0.000125);
      scale = 1 / p * 0.00125 * (44100 / b.sampleRate);
      if (ch === 4) scale *= 0.5;
    }
    this.P = Math.ceil(len / BLOCK);
    this.H = [];
    for (let c = 0; c < Math.min(2, ch); c++) {
      const d = b.getChannelData(c), parts = [];
      for (let p = 0; p < this.P; p++) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < BLOCK && p * BLOCK + i < len; i++) re[i] = d[p * BLOCK + i] * scale;
        fft(re, im, false); parts.push([re, im]);
      }
      this.H.push(parts);
    }
    if (this.H.length === 1) this.H.push(this.H[0]);
    this.X = [[], []]; this.prev = [new Float64Array(BLOCK), new Float64Array(BLOCK)]; this.quiet = 0;
  }
  get buffer() { return this._buf; }
  process(f0) {
    const i = this.mix(f0);
    if (!this._buf) return SILENT;
    if (i.silent) { this.quiet++; if (this.quiet > this.P + 2) return SILENT; } else this.quiet = 0;
    const N = 2 * BLOCK, out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    const ins = [i.silent ? new Float32Array(BLOCK) : i.L, i.silent ? new Float32Array(BLOCK) : (i.mono ? i.L : i.R)];
    for (let c = 0; c < 2; c++) {
      const re = new Float64Array(N), im = new Float64Array(N);
      re.set(this.prev[c], 0); for (let n = 0; n < BLOCK; n++) re[BLOCK + n] = ins[c][n];
      this.prev[c] = Float64Array.from(ins[c]);
      fft(re, im, false);
      const X = this.X[c]; X.unshift([re, im]); if (X.length > this.P) X.pop();
      const ar = new Float64Array(N), ai = new Float64Array(N), H = this.H[c];
      for (let p = 0; p < X.length; p++) {
        const [xr, xi] = X[p], [hr, hi] = H[p];
        for (let k = 0; k < N; k++) { ar[k] += xr[k] * hr[k] - xi[k] * hi[k]; ai[k] += xr[k] * hi[k] + xi[k] * hr[k]; }
      }
      fft(ar, ai, true);
      for (let n = 0; n < BLOCK; n++) out[c][n] = ar[BLOCK + n];
    }
    return { L: out[0], R: out[1], mono: false, silent: false };
  }
}

class Dest extends Node { constructor(ctx) { super(ctx, 'destination'); } process(f0) { return this.mix(f0); } }

// Stands in for the browser's AudioBuffer (set globalThis.AudioBuffer to it, so the engine's prepare() runs).
export class AudioBufferLite {
  constructor({ numberOfChannels = 1, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(c) { return this.data[c]; }
}

export class OfflineCtx {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'running'; this.nodes = [];
    this.destination = new Dest(this); this.listener = new Listener(this);
  }
  resume() { return Promise.resolve(); }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createWaveShaper() { return new Shaper(this); }
  createOscillator() { return new Osc(this); }
  createConstantSource() { return new Const(this); }
  createBufferSource() { return new BufSrc(this); }
  createPanner() { return new Panner(this); }
  createStereoPanner() { return new StereoPan(this); }
  createDynamicsCompressor() { return new Comp(this); }
  createConvolver() { return new Convolver(this); }
  createBuffer(ch, len, rate) { return new AudioBufferLite({ numberOfChannels: ch, length: len, sampleRate: rate }); }
  createPeriodicWave(real, imag, opt = {}) {
    const N = 4096, T = new Float32Array(N);
    for (let i = 0; i < N; i++) { let v = 0; for (let k = 1; k < real.length; k++) v += real[k] * Math.cos(2 * Math.PI * k * i / N) + imag[k] * Math.sin(2 * Math.PI * k * i / N); T[i] = v; }
    if (!opt.disableNormalization) { let m = 0; for (const v of T) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < N; i++) T[i] /= m; }
    return { table: T };
  }
  // Renders `seconds` and returns { out: [L, R], <tap>: [L, R], ... }. tick(t, dt) is called before each block (the
  // game's frame: fire timers, call the engine's update()); taps: { name: node } recorded alongside the output.
  render(seconds, { tick = null, taps = {} } = {}) {
    const total = Math.ceil(seconds * this.sampleRate / BLOCK) * BLOCK;
    const rec = {};
    for (const k of ['out', ...Object.keys(taps)]) rec[k] = [new Float32Array(total), new Float32Array(total)];
    for (let f0 = 0; f0 < total; f0 += BLOCK) {
      this.currentTime = f0 / this.sampleRate;
      if (tick) tick(this.currentTime, BLOCK / this.sampleRate);
      const o = this.destination.pull(f0);
      const put = (r, x) => { if (!x.silent) { r[0].set(x.L, f0); r[1].set(x.R, f0); } };
      put(rec.out, o);
      for (const [k, n] of Object.entries(taps)) put(rec[k], n.pull(f0));
    }
    this.currentTime = total / this.sampleRate;
    return rec;
  }
}

// ---------- output: WAV files and levels ----------

// 16-bit PCM stereo. A render that goes over full scale (the browser would clip it) is scaled down to fit; returns
// the scale used (1: untouched).
export function writeWav16(fs, file, [L, R], rate) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0.999 ? 0.999 / peak : 1;
  const n = L.length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * k * 32767))), i * 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * k * 32767))), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return k;
}

// The A-weighting curve (IEC 61672) as a gain at f Hz: 1 at 1 kHz, about -19 dB at 100 Hz, -30 dB at 50 Hz.
const aGain = (f) => {
  const f2 = f * f;
  return 1.2589 * (148693636 * f2 * f2) / ((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636));
};

// x, A-weighted: 50 %-overlapped Hann frames, each weighted in the frequency domain and added back together.
export function aWeight(x, rate) {
  const N = 16384, H = N / 2, out = new Float32Array(x.length), win = new Float64Array(N), w = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  for (let k = 0; k <= H; k++) { w[k] = aGain(k * rate / N); if (k && k < H) w[N - k] = w[k]; }
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = -H; s < x.length; s += H) {
    let any = false;
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; im[i] = 0; if (re[i] !== 0) any = true; }
    if (!any) continue;
    fft(re, im, false);
    for (let k = 0; k < N; k++) { re[k] *= w[k]; im[k] *= w[k]; }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const j = s + i; if (j >= 0 && j < x.length) out[j] += re[i]; }
  }
  return out;
}

// Levels of a stereo signal, in dBFS (-Infinity for silence):
//   peak    the largest sample
//   rms     over the part that sounds (from the first to the last sample within 60 dB of the peak)
//   max50   the loudest 50 ms (RMS)
//   aRms, aMax50   the same two, A-weighted: nearer to how loud it is heard (a low rumble counts for little)
//   start, len     where the part that sounds begins, and how long it is (s)
export function levels([L, R], rate) {
  const n = L.length, dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  let peak = 0, first = -1, last = -1;
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
  const thr = peak * 0.001;
  for (let i = 0; i < n; i++) if (Math.max(Math.abs(L[i]), Math.abs(R[i])) > thr) { if (first < 0) first = i; last = i; }
  const w = Math.floor(rate * 0.05);
  const measure = (a, b) => {
    let sq = 0, best = 0;
    for (let i = Math.max(0, first); i <= last; i++) sq += (a[i] * a[i] + b[i] * b[i]) / 2;
    for (let s = 0; s + w <= n; s += w >> 1) { let q = 0; for (let i = s; i < s + w; i++) q += (a[i] * a[i] + b[i] * b[i]) / 2; if (q > best) best = q; }
    return [dB(Math.sqrt(sq / Math.max(1, last - first + 1))), dB(Math.sqrt(best / w))];
  };
  const [rms, max50] = measure(L, R);
  const aL = peak > 0 ? aWeight(L, rate) : L, aR = peak > 0 && L !== R ? aWeight(R, rate) : aL;
  const [aRms, aMax50] = measure(aL, aR);
  return { peak: dB(peak), rms, max50, aRms, aMax50, start: Math.max(0, first) / rate, len: first < 0 ? 0 : (last - first + 1) / rate };
}
