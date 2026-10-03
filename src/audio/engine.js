import * as THREE from 'three';
import { clamp } from '../core/rng.js';

// Under the geodesic dome (the house and its garden, env.underDome) the glass cuts outside wind hard and dulls
// what gets through, like hearing it through a window: roughly -16 dB and a low-pass down to 750 Hz.
const DOME_WIND_GAIN = 0.158; // 10^(-16/20)
const DOME_WIND_LP = 750;     // Hz

// A full storm (setStorm(1)): the wind's level times (1 + STORM_WIND), and the levels of the rain bed's layers.
const STORM_WIND = 0.8;
const RAIN = { hiss: 0.22, body: 0.4, drum: 0.16, patter: 0.5, metal: 0.35, howl: 2.2 };
// The endgame one-shots' output levels, matched to the existing sounds (explosion, grind, alarm, rockLand, keyEnter)
// at the distances they are heard from. buzzWet: the alarm's dream reverb at full wet.
const LEVEL = {
  noPower: 1, coordsBeep: 1.5, hatch: 0.7, stairExtend: 1.2, stairFall: 0.8, pedestalButton: 1, pedestalSink: 0.6,
  thunder: 0.6, shaftSwell: 0.38, buzz: 0.3, buzzWet: 0.35,
};

// In-place constant-peak band-pass (RBJ biquad) over a Float32Array at `rate`: the filter of the sounds baked into
// buffers (the fire's grains, the rain's drops).
function bandpass(x, f, Q, rate) {
  const w = 2 * Math.PI * f / rate, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

// Fully procedural Web Audio: ambience beds, positional emitters and one-shot effects.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.emitters = [];
    this.pending = [];
    this.gust = 0.4; this.gustTarget = 0.4; this.gustTimer = 0;
    this.birdTimer = 2; this.dripTimer = 2;
    this.altDeg = 0;       // sun altitude, stored by update() for emitter ticks (frogs)
    this.zone = 'surface';
    this.listenerPos = new THREE.Vector3();
    this.timeOffset = 0;   // the dev capture schedules a batch of frames ahead of the offline render position
    this.stormTarget = 0;  // setStorm()'s level (kept from before start()), and the eased one update() runs on
    this.stormLevel = 0;
  }

  // Current audio time for scheduling (plus the capture's per-frame offset).
  now() { return this.ctx.currentTime + this.timeOffset; }

  // The sample data of the noise beds and the reverb, made while the game preloads (an AudioBuffer needs no
  // AudioContext, so no user gesture): start() then only wires the graph. The rate is a guess at the device's; the
  // noise plays at any rate, the reverb is remade if the context runs at another.
  prepare(rate = 48000) {
    if (this.prepared || typeof AudioBuffer === 'undefined') return;
    const make = (n) => new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate });
    this.prepared = {
      rate,
      white: this.noiseBuffer('white', 4, rate, make),
      pink: this.noiseBuffer('pink', 4, rate, make),
      brown: this.noiseBuffer('brown', 4, rate, make),
      impulse: this.impulse(3.2, 2.6, rate, make),
      dream: this.darkImpulse(6, rate, make),
      fireMod: this.fireModBuffer(),
      fireGrains: this.fireGrainBank(rate),
      buzzGate: this.buzzGateBuffer(),
      rain: this.rainBuffers(),
    };
  }

  // Creates the AudioContext inside the click's user gesture (some browsers only let a context start there), for a
  // start() that comes later, once preloading is done.
  unlock() {
    if (this.ctx || this.unlocked) return;
    this.unlocked = new (window.AudioContext || window.webkitAudioContext)();
  }

  start(context = null) {
    if (this.ctx) return;
    // A caller may supply the context (the dev capture renders sound in an OfflineAudioContext).
    const ac = this.ctx = context || this.unlocked || new (window.AudioContext || window.webkitAudioContext)();
    if (!context && ac.state === 'suspended') ac.resume().catch(() => {});
    const P = this.prepared;
    this.master = ac.createGain();
    this.master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ac.destination);
    // Two buses feed the master. `world` carries everything heard from outside: ambience, emitters, sound effects and
    // the reverb. `near` carries the player's own footsteps and, while an elevator's doors are shut round them, the
    // car's own sounds (play(name, { car: true })). setEnclosed() fades `world` out, so a closed car hears only itself.
    this.world = this.gain(1);
    this.worldDry = this.gain(1);   // setFeed() crossfades this with the camera-mic chain (buildFeed)
    this.world.connect(this.worldDry).connect(this.master);
    this.enclosers = new Set();
    this.reverb = ac.createConvolver();
    this.reverb.buffer = P && P.rate === ac.sampleRate ? P.impulse : this.impulse(3.2, 2.6);   // a convolver needs the context's rate
    this.reverbSend = ac.createGain();
    this.reverbSend.gain.value = 0.12;
    this.reverbSend.connect(this.reverb).connect(this.world);
    this.fxBus = ac.createGain();
    this.fxBus.connect(this.world);
    this.fxBus.connect(this.reverbSend);
    this.near = ac.createGain();
    this.near.connect(this.master);
    this.near.connect(this.reverbSend);
    this.route = this.fxBus;   // where out() sends a one-shot (play() switches it for in-car sounds)

    // Everything that lives outdoors runs through this bus, so it can be muffled indoors.
    this.outdoorLP = this.filter('lowpass', 20000, 0.5);
    this.outdoor = this.gain(1);
    this.outdoor.connect(this.outdoorLP).connect(this.world);

    this.white = P?.white ?? this.noiseBuffer('white');
    this.pink = P?.pink ?? this.noiseBuffer('pink');
    this.brown = P?.brown ?? this.noiseBuffer('brown');
    this.fireMod = P?.fireMod ?? this.fireModBuffer();
    this.fireGrains = P?.fireGrains ?? this.fireGrainBank(ac.sampleRate);
    this.buzzGate = P?.buzzGate ?? this.buzzGateBuffer();
    this.rain = P?.rain ?? this.rainBuffers();

    this.buildWind();
    this.buildInsects();
    this.buildCave();
    this.buildFeed();
    this.buildStorm();
    this.buildDream(P && P.rate === ac.sampleRate ? P.dream : this.darkImpulse(6));
    for (const e of this.pending) this.startEmitter(e);
    this.pending.length = 0;
  }

  // ---------- helpers ----------
  noiseBuffer(kind, seconds = 4, rate = this.ctx.sampleRate, make = null) {
    const n = rate * seconds;
    const buf = make ? make(n) : this.ctx.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    return buf;
  }

  impulse(seconds, decay, rate = this.ctx.sampleRate, make = null) {
    const n = Math.floor(rate * seconds);
    const buf = make ? make(n) : this.ctx.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  // An AudioBuffer made with or without a context (prepare() runs before there is one).
  newBuffer(channels, length, rate) {
    return this.ctx ? this.ctx.createBuffer(channels, length, rate)
      : new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate });
  }

  // Fire modulation: 60 s of smoothly wandering random values in about -1..1 (white noise through three one-pole
  // low-passes at ~1.2 Hz, so it has no knots, steps or cycles). Looped at different playback rates and offsets it
  // gives every fire layer its own slow breathing or fast flicker without a single LFO, which is what made the old
  // fire chug like a train.
  fireModBuffer(seconds = 60, rate = 8000) {
    const n = seconds * rate, buf = this.newBuffer(1, n, rate), d = buf.getChannelData(0);
    const a = 1 - Math.exp(-2 * Math.PI * 1.2 / rate);
    let y1 = 0, y2 = 0, y3 = 0, sum = 0, sq = 0;
    for (let i = -rate * 4; i < n; i++) {           // 4 s of warm-up so the start is not a fade-in from 0
      y1 += a * (Math.random() * 2 - 1 - y1); y2 += a * (y1 - y2); y3 += a * (y2 - y3);
      if (i >= 0) { d[i] = y3; sum += y3; sq += y3 * y3; }
    }
    const mean = sum / n, sd = Math.sqrt(sq / n - mean * mean) || 1;
    for (let i = 0; i < n; i++) d[i] = Math.tanh((d[i] - mean) / (sd * 2.2));
    // Blend the loop's last half second into its start so the wrap has no step.
    const x = rate >> 1;
    for (let i = 0; i < x; i++) { const k = i / x; d[n - x + i] = d[n - x + i] * (1 - k) + d[i] * k; }
    return buf;
  }

  // Fire crackle grains, rendered once into one mono buffer: tiny ember ticks, crackles (a few micro-impulses a few
  // ms apart, like a knot of sap bursting), low wooden pops that ring briefly, and rare bright snaps (a split with a
  // second crack after it). Each grain is a noise burst with a fast random decay through its own random band-pass
  // (RBJ biquad), and is baked at a random level. The emitter plays slices of it with pitch and timing drawn afresh.
  fireGrainBank(rate) {
    const bp = (x, f, Q) => bandpass(x, f, Q, rate);
    const R = (a, b) => a + Math.random() * (b - a);
    const burst = (x, at, tau, amp) => {            // decaying noise impulse into x from sample `at`
      const n = Math.min(x.length - at, Math.ceil(tau * rate * 7));
      for (let i = 0; i < n; i++) x[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (tau * rate));
    };
    const make = (type) => {
      let dur, x;
      if (type === 'tick') {
        dur = R(0.006, 0.014); x = new Float32Array(Math.ceil(dur * rate));
        burst(x, 0, R(0.0003, 0.0012), 1);
        bp(x, R(2400, 6500), R(0.7, 1.8));
      } else if (type === 'crackle') {
        dur = R(0.025, 0.045); x = new Float32Array(Math.ceil(dur * rate));
        const k = 2 + Math.floor(Math.random() * 5);
        for (let j = 0; j < k; j++) burst(x, Math.floor(Math.pow(Math.random(), 1.6) * 0.016 * rate), R(0.0002, 0.0012), R(0.3, 1));
        bp(x, R(1300, 4800), R(0.8, 2.5));
      } else if (type === 'pop') {
        dur = R(0.07, 0.13); x = new Float32Array(Math.ceil(dur * rate));
        const body = new Float32Array(x.length), click = new Float32Array(x.length);
        burst(body, 0, R(0.0015, 0.004), 1); burst(click, 0, R(0.0003, 0.0008), 1);
        bp(body, R(260, 850), R(3, 7)); bp(click, R(1800, 3800), 1.2);
        const pk = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9), pb = pk(body), pc = pk(click);
        for (let i = 0; i < x.length; i++) x[i] = body[i] / pb + 0.6 * click[i] / pc;
      } else {                                      // snap
        dur = R(0.1, 0.16); x = new Float32Array(Math.ceil(dur * rate));
        burst(x, 0, R(0.001, 0.0025), 1);
        burst(x, Math.floor(R(0.006, 0.03) * rate), R(0.0005, 0.0015), R(0.3, 0.7));
        const ring = bp(Float32Array.from(x), R(900, 2200), R(5, 9));
        bp(x, R(2000, 5000), 0.7);
        for (let i = 0; i < x.length; i++) x[i] += ring[i] * 2.5;
      }
      let peak = 1e-9;
      for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
      const level = { tick: R(0.2, 0.5), crackle: R(0.35, 0.8), pop: R(0.5, 0.85), snap: R(0.8, 1) }[type];
      const fade = Math.floor(0.002 * rate);
      for (let i = 0; i < x.length; i++) x[i] *= level / peak * Math.min(1, (x.length - i) / fade);
      return x;
    };
    const counts = { tick: 28, crackle: 24, pop: 10, snap: 6 };
    const parts = [], grains = {};
    let len = 0;
    for (const type in counts) {
      grains[type] = [];
      for (let i = 0; i < counts[type]; i++) {
        const x = make(type);
        grains[type].push([len / rate, x.length / rate]);
        parts.push([len, x]);
        len += x.length + Math.floor(0.005 * rate);  // a little silence between slices
      }
    }
    const buf = this.newBuffer(1, len, rate), d = buf.getChannelData(0);
    for (const [at, x] of parts) d.set(x, at);
    return { buf, grains };
  }

  // The dream's reverb (sfx_buzzAlarm): `seconds` of dark stereo noise, a bloom that dies in under a second (so the
  // alarm's rhythm still comes through it) over a long slow tail, through a low-pass pair whose cut-off falls from
  // ~4.5 kHz to ~600 Hz along it, so it darkens as it dies (a huge soft space, not a hall). The convolver normalises
  // its level.
  darkImpulse(seconds, rate = this.ctx.sampleRate, make = null) {
    const n = Math.floor(rate * seconds), pre = Math.floor(rate * 0.03), end = Math.floor(rate * 0.25);
    const buf = make ? make(n) : this.ctx.createBuffer(2, n, rate);
    // (The envelopes run as per-sample decay factors, the cut-off is updated every 64 samples: this is made during
    // the preload, so it is kept cheap.)
    const kOn = Math.exp(-1 / (0.02 * rate)), kA = Math.exp(-6.9 / (0.9 * rate)), kB = Math.exp(-6.9 / (4.4 * rate));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y1 = 0, y2 = 0, on = 1, eA = 0.7, eB = 0.3, a = 0;
      for (let i = pre; i < n; i++) {
        if (((i - pre) & 63) === 0) a = 1 - Math.exp(-2 * Math.PI * 4500 * Math.pow(600 / 4500, (i - pre) / (n - pre)) / rate);
        y1 += a * (Math.random() * 2 - 1 - y1); y2 += a * (y1 - y2);
        d[i] = y2 * (1 - on) * (eA + eB) * Math.min(1, (n - i) / end);
        on *= kOn; eA *= kA; eB *= kB;
      }
    }
    return buf;
  }

  // The alarm clock's buzzer pattern (sfx_buzzAlarm): one cycle of BZZT-BZZT-BZZT, rest, as a 0..1 level at 8 kHz
  // for a looped source to drive a gate with. Each buzz has 4 ms raised-cosine edges (no clicks) and sags a little.
  buzzGateBuffer(rate = 8000) {
    const cycle = 0.9, step = 0.17, on = 0.105, edge = 0.004 * rate;
    const n = Math.round(cycle * rate), buf = this.newBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let k = 0; k < 3; k++) {
      const a = Math.round(k * step * rate), b = a + Math.round(on * rate);
      for (let i = a; i < b; i++) {
        const u = Math.max(0, Math.min(1, (i - a) / edge, (b - i) / edge));
        d[i] = (0.5 - 0.5 * Math.cos(Math.PI * u)) * (1 - 0.12 * (i - a) / (b - a));
      }
    }
    return buf;
  }

  // Rain, baked once (no context needed): `patter`, a dense stereo bed of single close drops (crisp ticks on stone and
  // leaves, the odd fat splat, now and then a plink into standing water), and `metal`, a sparser one of drops on steel
  // (bright tinks, hollow tonks). Every drop lands at a random time, level and stereo place, wrapping round the end so
  // the loop has no seam; buildStorm() loops them at unrelated rates under the hiss, so nothing is heard repeating.
  rainBuffers(rate = 32000) {
    const R = (a, b) => a + Math.random() * (b - a);
    const noise = (n, tau) => {
      const x = new Float32Array(n), k = Math.exp(-1 / (tau * rate));
      for (let i = 0, e = 1; i < n; i++, e *= k) x[i] = (Math.random() * 2 - 1) * e;
      return x;
    };
    const norm = (x) => {
      let p = 1e-9;
      for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
      for (let i = 0; i < x.length; i++) x[i] /= p;
      return x;
    };
    const struck = (dur, f0, parts) => {          // a little impact click and decaying partials [ratio, level, tau]
      const n = Math.ceil(dur * rate), x = norm(bandpass(noise(n, 0.0004), f0 * 1.3, 0.8, rate));
      for (let i = 0; i < n; i++) x[i] *= 0.35;
      for (const [r, a, tau] of parts) {             // a decaying phasor, rotated a step per sample
        const w = 2 * Math.PI * f0 * r * R(0.98, 1.02) / rate, k = Math.exp(-1 / (tau * rate)), cw = Math.cos(w) * k, sw = Math.sin(w) * k;
        for (let i = 0, c = a, s = 0; i < n; i++) { x[i] += s; const c2 = c * cw - s * sw; s = c * sw + s * cw; c = c2; }
      }
      return x;
    };
    const drops = {
      tick: () => { const tau = R(0.0003, 0.0014); return bandpass(noise(Math.ceil(tau * rate * 7), tau), R(1800, 7500), R(0.8, 2), rate); },
      splat: () => {
        const tau = R(0.002, 0.005), n = Math.ceil(tau * rate * 7);
        const body = norm(bandpass(noise(n, tau), R(450, 1300), R(1.5, 3), rate)), click = norm(bandpass(noise(n, tau * 0.25), R(2500, 5000), 1, rate));
        for (let i = 0; i < n; i++) body[i] += 0.5 * click[i];
        return body;
      },
      plink: () => {                              // the bubble's ring, rising as it shrinks
        const n = Math.ceil(0.04 * rate), x = new Float32Array(n), f0 = R(1100, 2600), k = R(8, 18), tau = R(0.006, 0.011);
        let ph = 0;
        for (let i = 0; i < n; i++) { const s = i / rate; ph += 2 * Math.PI * f0 * (1 + k * s) / rate; x[i] = Math.sin(ph) * Math.exp(-s / tau); }
        return x;
      },
      tink: () => struck(0.12, R(2600, 6200), [[1, 1, R(0.01, 0.035)], [1.47, 0.5, R(0.008, 0.02)], [2.09, 0.3, 0.008]]),
      tonk: () => struck(0.25, R(650, 1300), [[1, 1, R(0.03, 0.07)], [2.4, 0.45, R(0.02, 0.04)], [3.9, 0.25, 0.015]]),
    };
    const bake = (seconds, perSec, pick) => {
      const n = Math.floor(seconds * rate), buf = this.newBuffer(2, n, rate), L = buf.getChannelData(0), Rt = buf.getChannelData(1);
      for (let c = Math.floor(seconds * perSec); c > 0; c--) {
        const x = norm(drops[pick(Math.random())]()), lvl = 0.1 + 0.9 * Math.pow(Math.random(), 2), at = Math.floor(Math.random() * n);
        const q = Math.random() * Math.PI / 2, gl = lvl * Math.cos(q), gr = lvl * Math.sin(q);
        for (let i = 0; i < x.length; i++) { const k = (at + i) % n; L[k] += x[i] * gl; Rt[k] += x[i] * gr; }
      }
      let sq = 0;
      for (let i = 0; i < n; i++) sq += L[i] * L[i] + Rt[i] * Rt[i];
      // Every bed at an RMS of 0.1, its loudest drops rounded off (a tanh-like soft clip at 0.45) so none stands out.
      const s = 0.1 / (Math.sqrt(sq / (2 * n)) || 1) / 0.45;
      const soft = (v) => { v = Math.max(-3, Math.min(3, v * s)); return 0.45 * v * (27 + v * v) / (27 + 9 * v * v); };
      for (let i = 0; i < n; i++) { L[i] = soft(L[i]); Rt[i] = soft(Rt[i]); }
      return buf;
    };
    return {
      patter: bake(7.3, 220, (r) => (r < 0.78 ? 'tick' : r < 0.95 ? 'splat' : 'plink')),
      metal: bake(5.1, 30, (r) => (r < 0.7 ? 'tink' : 'tonk')),
    };
  }

  src(buffer, loop = true, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = loop; s.playbackRate.value = rate;
    s.loopStart = Math.random() * 2; // decorrelate reused buffers
    return s;
  }

  filter(type, freq, Q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }

  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  panner(pos, ref = 4, rolloff = 1.2, max = 200) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = max;
    if (pos) this.setPos(p, pos);
    return p;
  }

  setPos(p, v) {
    if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    else p.setPosition(v.x, v.y, v.z);
  }

  // Output node for a sound: positional (panner) or straight into the current bus (fx, or the in-car one).
  out(pos, ref = 4, rolloff = 1.2) {
    if (!pos) return this.route;
    const p = this.panner(pos, ref, rolloff);
    p.connect(this.route);
    return p;
  }

  env(g, t, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }

  pulseWave(duty) {
    const N = 16, real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) real[n] = (2 * Math.sin(n * Math.PI * duty)) / (n * Math.PI);
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  // A filtered noise burst into o: buffer -> filter -> envelope, from a random point in the buffer (a source started at
  // 0 every time would replay the same few samples, and every burst would sound alike).
  burst(o, t, { buf = this.white, type = 'bandpass', f = 1000, q = 1, peak = 0.3, a = 0.002, d = 0.05, rate = 1 } = {}) {
    const s = this.src(buf, false, rate); const fl = this.filter(type, f, q); const g = this.gain(0);
    s.connect(fl).connect(g).connect(o); this.env(g, t, a, peak, d);
    s.start(t, Math.random() * Math.max(0, buf.duration - a - d - 0.1)); s.stop(t + a + d + 0.03);
    return g;
  }

  // An enveloped oscillator into o, gliding f0 -> f1 over its length.
  tone(o, t, f0, f1, peak, a, d, type = 'sine') {
    const osc = this.ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, a, peak, d);
    osc.start(t); osc.stop(t + a + d + 0.03);
    return g;
  }

  // One slice of the fire's grain bank (fireGrainBank) as a hard little impact: gravel, a static tick, a pebble.
  grain(o, t, type, rate = 1, level = 1) {
    const { buf, grains } = this.fireGrains, list = grains[type], [off, dur] = list[Math.floor(Math.random() * list.length)];
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.gain(level); s.connect(g).connect(o); s.start(t, off, dur);
  }

  // A struck steel body into o: sine partials [ratio, level, decay (s)] over f0, each a hair off its ratio so no two
  // strikes ring quite alike.
  ring(o, t, f0, partials, peak) {
    for (const [r, a, d] of partials) {
      const osc = this.ctx.createOscillator(); osc.frequency.value = f0 * r * (0.985 + Math.random() * 0.03);
      const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.0015, peak * a, d);
      osc.start(t); osc.stop(t + d + 0.05);
    }
  }

  // An electronic beep into o: level flat with a few ms of ramp at each end (no clicks), gliding f0 -> f1; or, with
  // tail (s), dying away exponentially after its `dur` instead of stopping.
  beep(o, t, f0, f1, dur, peak, type = 'square', tail = 0) {
    const osc = this.ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.gain(0), r = Math.min(0.005, dur * 0.2);
    osc.connect(g).connect(o);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + r);
    if (tail > 0) { g.gain.setValueAtTime(peak, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + tail); }
    else { g.gain.setValueAtTime(peak, t + dur - r * 2); g.gain.linearRampToValueAtTime(0, t + dur); }
    osc.start(t); osc.stop(t + dur + tail + 0.02);
  }

  // The alarm clock's buzzer tone: a narrow pulse (30 %), nasal and full of harmonics. Made once per context.
  buzzWave() {
    if (!this._buzzWave) {
      const N = 40, real = new Float32Array(N), imag = new Float32Array(N);
      for (let n = 1; n < N; n++) real[n] = (2 * Math.sin(n * Math.PI * 0.3)) / (n * Math.PI);
      this._buzzWave = this.ctx.createPeriodicWave(real, imag);
    }
    return this._buzzWave;
  }

  // Waveshaper curves, made once: a soft-knee overdrive (tanh, clipping hard past full scale), and an 8-level
  // quantiser (the glitch's bit-crush).
  driveCurve() {
    if (!this._drive) {
      const n = 2048, c = new Float32Array(n), k = 2.4;
      for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / Math.tanh(k);
      this._drive = c;
    }
    return this._drive;
  }
  // A WaveShaper on a curve (or a plain gain where the context has none: the headless tests' mock contexts).
  shaper(curve) {
    if (!this.ctx.createWaveShaper) return this.gain(1);
    const sh = this.ctx.createWaveShaper();
    sh.curve = curve; sh.oversample = '2x';
    return sh;
  }
  crushCurve() {
    if (!this._crush) {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.round((i / (n - 1) * 2 - 1) * 4) / 4;
      this._crush = c;
    }
    return this._crush;
  }

  // ---------- ambience beds ----------
  buildWind() {
    const ac = this.ctx;
    this.windGain = this.gain(0);
    // Dedicated gain + filter for the dome's glass, so nothing else on the outdoor bus (birds, crickets, emitters,
    // the cabin's own indoor treatment) is touched by it.
    this.windDomeGain = this.gain(1);
    this.windDomeLP = this.filter('lowpass', 20000, 0.6);
    this.windGain.connect(this.windDomeGain).connect(this.windDomeLP).connect(this.outdoor);
    const a = this.src(this.pink), b = this.src(this.pink, true, 0.77);
    this.windLP = this.filter('lowpass', 500, 0.5);
    this.windBP = this.filter('bandpass', 1800, 2.5);
    this.whistle = this.gain(0.08);   // (a storm raises it)
    this.windPan = ac.createStereoPanner();
    a.connect(this.windLP).connect(this.windPan).connect(this.windGain);
    b.connect(this.windBP).connect(this.whistle).connect(this.windPan);
    a.start(); b.start();
  }

  buildInsects() {
    const ac = this.ctx;
    this.cricketBus = this.gain(0);
    this.cricketBus.connect(this.outdoor);
    this.crickets = [];
    for (let i = 0; i < 6; i++) {
      const osc = ac.createOscillator();
      osc.frequency.value = 4300 + Math.random() * 900;
      const am = this.gain(0), gate = this.gain(0);
      const lfo = ac.createOscillator(); lfo.frequency.value = 26 + Math.random() * 12;
      const lfoAmt = this.gain(0.5); const off = ac.createConstantSource(); off.offset.value = 0.5;
      lfo.connect(lfoAmt).connect(am.gain); off.connect(am.gain);
      const slow = ac.createOscillator(); slow.setPeriodicWave(this.pulseWave(0.16 + Math.random() * 0.1));
      slow.frequency.value = 1.6 + Math.random() * 1.6;
      const off2 = ac.createConstantSource(); off2.offset.value = 0.2;
      slow.connect(gate.gain); off2.connect(gate.gain);
      const pan = this.panner(null, 3, 1);
      const vol = this.gain(0.035 + Math.random() * 0.03);
      osc.connect(am).connect(gate).connect(vol).connect(pan).connect(this.cricketBus);
      [osc, lfo, off, slow, off2].forEach((n) => n.start());
      this.crickets.push({ pan, offset: new THREE.Vector3((Math.random() - 0.5) * 30, -1, (Math.random() - 0.5) * 30), timer: Math.random() * 20 });
    }
    // Daytime cicada-ish shimmer, very faint.
    this.dayBugs = this.gain(0);
    const n = this.src(this.white);
    const bp = this.filter('bandpass', 6200, 4);
    const am = this.gain(0.5);
    const lfo = ac.createOscillator(); lfo.frequency.value = 48;
    const amt = this.gain(0.4); lfo.connect(amt).connect(am.gain);
    n.connect(bp).connect(am).connect(this.dayBugs).connect(this.outdoor);
    n.start(); lfo.start();
  }

  buildCave() {
    this.caveGain = this.gain(0);
    this.caveGain.connect(this.world);
    const s = this.src(this.brown);
    const lp = this.filter('lowpass', 140, 0.5);
    s.connect(lp).connect(this.caveGain);
    s.start();
  }

  // The storm's own sounds (setStorm), built here but left unplugged from the outdoor bus, their sources not started,
  // until the first storm (stormBed). The rain: a broad hiss of rain on everything far and near, its body, a low
  // drumming, two layers of close patter (one further off, duller) and drops on steel (rainBuffers). The wind's howl:
  // two narrow bands of noise moaning with the gusts (the wind itself is buildWind's, pushed harder in update()).
  buildStorm() {
    const ac = this.ctx;
    this.stormBus = this.gain(1);
    this.stormLive = false; this.stormStarted = false; this.stormIdleAt = 0;
    const layer = (src, ...chain) => {
      const g = this.gain(0);
      let n = src;
      for (const f of chain) n = n.connect(f);
      n.connect(g).connect(this.stormBus);
      return g;
    };
    const loop = (buf, rate) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; return s; };
    const hiss = this.src(this.white), body = this.src(this.pink, true, 0.93), drum = this.src(this.brown);
    const patA = loop(this.rain.patter, 1), patB = loop(this.rain.patter, 0.83), metal = loop(this.rain.metal, 1);
    this.rainHissLP = this.filter('lowpass', 8000, 0);
    this.rainHiss = layer(hiss, this.filter('highpass', 900, 0), this.rainHissLP);
    this.rainBody = layer(body, this.filter('bandpass', 1100, 0.6));
    this.rainDrum = layer(drum, this.filter('lowpass', 240, 0));
    this.rainPat = this.gain(0);
    this.rainPat.connect(this.stormBus);
    patA.connect(this.rainPat);
    patB.connect(this.filter('lowpass', 4200, 0)).connect(this.gain(0.7)).connect(this.rainPat);
    this.rainMetal = layer(metal, this.filter('highpass', 500, 0));
    const howl = this.src(this.pink, true, 0.9), howl2 = this.src(this.pink, true, 1.1);
    this.howlBP = this.filter('bandpass', 650, 8); this.howlBP2 = this.filter('bandpass', 1060, 11);
    this.howl = this.gain(0);
    this.howlPan = ac.createStereoPanner();
    howl.connect(this.howlBP).connect(this.howl);
    howl2.connect(this.howlBP2).connect(this.gain(0.6)).connect(this.howl);
    this.howl.connect(this.howlPan).connect(this.stormBus);
    this.stormSrcs = [hiss, body, drum, patA, patB, metal, howl, howl2];
    // Thunder's way out (sfx_thunder): always plugged in (it carries nothing between strikes), held at the same share
    // of the outdoors as the rain (stormBed), so a strike still in flight isn't heard full on underground.
    this.thunderBus = this.gain(1);
    this.thunderBus.connect(this.outdoor);
    this.stormK = 1;
  }

  // The dream's reverb, the ending alarm's (sfx_buzzAlarm): a long dark convolver of its own, made here so its 6 s
  // impulse is prepared now, not in the middle of the ending. Silent (so the browser skips it) until the alarm feeds
  // it; dreamOut is the alarm's wet level.
  buildDream(impulse) {
    this.dreamIn = this.gain(1);
    this.dreamVerb = this.ctx.createConvolver();
    this.dreamVerb.buffer = impulse;
    this.dreamOut = this.gain(0);
    this.dreamIn.connect(this.dreamVerb).connect(this.dreamOut).connect(this.world);
  }

  // The hidden camera's microphone (setFeed): everything on the world bus heard down a long line through a cheap mic,
  // band-limited and a little overdriven, with the line's hiss and a ground-loop hum. Built here once but left unplugged
  // from the world bus (so none of it runs) until setFeed() turns it up, and unplugged again once it's back at 0
  // (feedIdle). feedOut is where a sound already made for the feed (explosion { feed }) goes.
  buildFeed() {
    const ac = this.ctx;
    this.feedWet = this.gain(0);
    const drive = this.gain(2.2), sh = this.shaper(this.driveCurve());
    this.feedIn = this.filter('highpass', 320, 0.8);
    this.feedIn.connect(this.filter('highpass', 280, 0.6)).connect(drive).connect(sh)
      .connect(this.filter('lowpass', 3600, 0.9)).connect(this.filter('lowpass', 4200, 0.6)).connect(this.feedWet).connect(this.master);
    // (The hiss and hum go in at the world bus like every other bed, so they reach the chain and shut off with it. Their
    // sources start the first time the feed comes up.)
    this.feedHiss = this.gain(0);
    this.feedHissSrc = this.src(this.white);
    this.feedHissSrc.connect(this.filter('bandpass', 3800, 0.5)).connect(this.feedHiss);
    this.feedHum = ac.createOscillator(); this.feedHum.type = 'sawtooth'; this.feedHum.frequency.value = 60;
    this.feedHum.connect(this.filter('lowpass', 420, 1.2)).connect(this.gain(0.35)).connect(this.feedHiss);
    this.feedK = 0; this.feedLive = false; this.feedStarted = false; this.feedIdleAt = 0;
    this.feedOut = this.gain(1);
    this.feedOut.connect(this.master);
  }

  // k (0..1): how much of the world is heard through the camera's mic instead of the listener's own ears; tau: the
  // crossfade's time constant (s).
  setFeed(k, tau = 0.03) {
    if (!this.ctx) return;
    const t = this.now();
    k = clamp(+k || 0, 0, 1);
    tau = Math.max(1e-4, +tau || 0.03);
    this.feedK = k;
    if (k > 0 && !this.feedLive) {
      if (!this.feedStarted) { this.feedHissSrc.start(); this.feedHum.start(); this.feedStarted = true; }
      this.world.connect(this.feedIn);
      this.feedHiss.connect(this.world);
      this.feedLive = true;
    }
    this.feedIdleAt = t + tau * 12 + 0.05;   // (back at 0: unplugged once the fade has run out)
    this.worldDry.gain.setTargetAtTime(1 - k, t, tau);
    this.feedWet.gain.setTargetAtTime(k * 0.35, t, tau);
    this.feedHiss.gain.setTargetAtTime(k * 0.009, t, tau);
  }

  // Unplugs the feed's chain once it has faded out to nothing (every frame, from update()).
  feedIdle() {
    if (!this.feedLive || this.feedK > 0 || this.now() < this.feedIdleAt) return;
    this.world.disconnect(this.feedIn);
    this.feedHiss.disconnect(this.world);
    this.feedLive = false;
  }

  // ---------- emitters ----------
  // extra carries per-emitter data the synthesis needs (e.g. the frogs' bank spots). Returns the emitter: set e.off =
  // true at any time (before the sound starts too) to fade it out (~0.4 s), false to fade it back; e.mul (0..1, default
  // 1) scales its level, for slower fades of your own.
  registerEmitter(name, pos, zone, extra = {}) {
    const e = { name, pos: pos.clone(), zone, node: null, off: false, mul: 1, ...extra };
    this.emitters.push(e);
    if (this.ctx) this.startEmitter(e); else this.pending.push(e);
    return e;
  }

  startEmitter(e) {
    const ac = this.ctx;
    const g = this.gain(0);
    const indoorSource = e.name === 'fire' || e.name === 'generator' || e.name === 'electronics' || e.name === 'roomtone'
      || e.name === 'terminal' || e.name === 'hvac';
    // Frogs pan every call from its own bank spot, so their g is only the zone/range gate into the bus.
    if (e.name === 'frogs') g.connect(this.outdoor);
    else {
      const ref = e.name === 'waterfall' ? 14 : e.name === 'cascade' ? 8 : e.name === 'generator' ? 5 : e.name === 'roomtone' ? 6
        : e.name === 'terminal' ? 2 : 4;
      const p = this.panner(e.pos, ref, 1.1);
      g.connect(p).connect(indoorSource ? this.world : this.outdoor);
      if (indoorSource) p.connect(this.reverbSend);
    }
    if (e.name === 'stream') {
      const s = this.src(this.white);
      const bp = this.filter('bandpass', 1400, 0.6);
      const bp2 = this.filter('bandpass', 3200, 3);
      const wob = ac.createOscillator(); wob.frequency.value = 0.7 + Math.random();
      const wamt = this.gain(700); wob.connect(wamt).connect(bp2.frequency);
      s.connect(bp).connect(g); s.connect(bp2).connect(this.gain(0.5)).connect(g);
      s.start(); wob.start();
      e.level = 0.22;
    } else if (e.name === 'waterfall') {
      const s = this.src(this.pink);
      const lp = this.filter('lowpass', 1100, 0.4);
      const s2 = this.src(this.white);
      const hp = this.filter('bandpass', 2500, 0.5);
      s.connect(lp).connect(g); s2.connect(hp).connect(this.gain(0.25)).connect(g);
      s.start(); s2.start();
      e.level = 0.55;
    } else if (e.name === 'cascade') {
      // The tor's spring cascade splashing into its pool: a softer, brighter, more local roar than the edge fall,
      // surging slowly as the flow pulses. Random start offsets keep it uncorrelated with the waterfall's noise.
      const s = this.src(this.pink), s2 = this.src(this.white);
      const surge = this.gain(1);
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.23 + Math.random() * 0.12;
      const lfo2 = ac.createOscillator(); lfo2.frequency.value = 0.089 + Math.random() * 0.04;
      lfo.connect(this.gain(0.08)).connect(surge.gain); lfo2.connect(this.gain(0.06)).connect(surge.gain);
      s.connect(this.filter('lowpass', 1600, 0.5)).connect(surge);
      s2.connect(this.filter('bandpass', 3000, 0.7)).connect(this.gain(0.35)).connect(surge);
      surge.connect(g);
      s.start(0, Math.random() * 3); s2.start(0, Math.random() * 3); lfo.start(); lfo2.start();
      e.level = 0.35;
      e.range = 90;
    } else if (e.name === 'fire' || e.name === 'firepit') {
      // A wood fire, after Farnell's "Designing Sound" fire model, with nothing periodic in it:
      //  - roar: brown noise low-passed, breathing slowly (the fire's draught);
      //  - lapping: band-passed pink noise whose level and centre wander a few times a second (flames licking);
      //  - hiss: high-passed white noise with a fast irregular flicker (gas and steam escaping);
      //  - crackles: grains from fireGrainBank() at Poisson (exponentially spaced) times, rate following a slowly
      //    wandering "heat", with random pitch and level, sometimes in quick sap-fizz clusters, and now and then a
      //    log settling (a low knock, a swell of roar and a flurry of crackles).
      // All modulation comes from the fireMod buffer (smoothed noise) at unrelated rates and offsets, never an LFO.
      // The hearth (indoors, on the world bus with the room's reverb) is closer and softer; the garden pit, on the
      // outdoor bus, is a little brighter and airier.
      const pit = e.name === 'firepit';
      const mod = (rate, depth, param) => {            // smoothed random added to an AudioParam
        const m = ac.createBufferSource();
        m.buffer = this.fireMod; m.loop = true; m.playbackRate.value = rate * (0.9 + Math.random() * 0.2);
        m.connect(this.gain(depth)).connect(param);
        m.start(0, Math.random() * 60);
      };
      const roar = this.src(this.brown), roarG = this.gain(pit ? 0.42 : 0.5);
      // (High-passed too: brown noise's sub-bass flutter below ~60 Hz reads as an engine's putter, not a fire.)
      roar.connect(this.filter('highpass', 65, 0.6)).connect(this.filter('lowpass', pit ? 420 : 320, 0.5)).connect(roarG).connect(g);
      mod(0.35, pit ? 0.16 : 0.14, roarG.gain);
      const swell = this.gain(1);                        // log-settle surges ride on this
      const lap = this.src(this.pink), lapBP = this.filter('bandpass', pit ? 650 : 480, 0.9), lapG = this.gain(pit ? 0.2 : 0.15);
      lap.connect(lapBP).connect(lapG).connect(swell);
      mod(2.3, pit ? 220 : 150, lapBP.frequency);
      mod(3.1, pit ? 0.17 : 0.13, lapG.gain);
      const hiss = this.src(this.white), hissG = this.gain(pit ? 0.03 : 0.018);
      hiss.connect(this.filter('highpass', pit ? 2400 : 3200, 0.6)).connect(this.filter('lowpass', pit ? 9000 : 7000, 0.5)).connect(hissG).connect(swell);
      mod(11, pit ? 0.026 : 0.016, hissG.gain);
      swell.connect(g);
      [roar, lap, hiss].forEach((n) => n.start(0, Math.random() * 3));
      // Crackle voices, shared by every grain: bright (on top), soft (behind the logs) and deep (buried embers).
      const cg = this.gain(pit ? 0.55 : 0.45);
      cg.connect(g);
      const bright = this.gain(1), soft = this.gain(0.45), deep = this.gain(0.28);
      bright.connect(cg);
      soft.connect(this.filter('lowpass', pit ? 3800 : 3000, 0.6)).connect(cg);
      deep.connect(this.filter('lowpass', 1300, 0.6)).connect(cg);
      const { buf, grains } = this.fireGrains;
      const grain = (type, t, voice, pitch = 0.8 + Math.random() * 0.45) => {
        const list = grains[type], [off, dur] = list[Math.floor(Math.random() * list.length)];
        const s = ac.createBufferSource();
        s.buffer = buf; s.playbackRate.value = pitch;
        s.connect(voice); s.start(t, off, dur);
      };
      const expo = (mean) => -Math.log(1 - Math.random()) * mean;
      const pickVoice = (pB, pS) => { const r = Math.random(); return r < pB ? bright : r < pB + pS ? soft : deep; };
      let heat = 1, heatTarget = 1, heatTimer = 0, settle = 8 + expo(30), next = -1;
      const event = (t) => {
        const r = Math.random();
        if (r < 0.5) grain('tick', t, pickVoice(0.25, 0.4));
        else if (r < 0.86) grain('crackle', t, pickVoice(0.35, 0.4));
        else if (r < 0.975) grain('pop', t, pickVoice(0.3, 0.45), 0.75 + Math.random() * 0.5);
        else grain('snap', t, bright, 0.85 + Math.random() * 0.3);
        if (Math.random() < 0.12) {                      // a sap fizz: a quick run of ticks
          let tk = t;
          for (let k = 3 + Math.floor(Math.random() * 8); k > 0; k--) {
            tk += 0.004 + expo(0.018);
            grain(Math.random() < 0.8 ? 'tick' : 'crackle', tk, pickVoice(0.15, 0.45));
          }
        }
      };
      const logSettle = (t) => {                          // a log shifts: knock, surge, flurry
        grain('pop', t, deep, 0.55 + Math.random() * 0.2);
        grain('pop', t + 0.01 + Math.random() * 0.03, soft, 0.7 + Math.random() * 0.3);
        swell.gain.setTargetAtTime(1.6 + Math.random() * 0.6, t + 0.05, 0.25);
        swell.gain.setTargetAtTime(1, t + 0.8 + Math.random() * 0.6, 1.4);
        let tk = t + 0.08;
        for (let k = 6 + Math.floor(Math.random() * 12); k > 0; k--) {
          tk += expo(0.09);
          grain(Math.random() < 0.6 ? 'crackle' : 'tick', tk, pickVoice(0.35, 0.4));
        }
        heat = Math.min(1.8, heat + 0.5);
      };
      e.tick = (dt) => {
        // Heat wanders between long random holds; it sets the crackle rate (about 3-11 a second).
        heatTimer -= dt;
        if (heatTimer <= 0) { heatTimer = 2 + expo(5); heatTarget = 0.55 + Math.random() * Math.random() * 1.1; }
        heat += (heatTarget - heat) * Math.min(1, dt * 0.4);
        const now = this.now(), rate = (pit ? 6.5 : 5.5) * heat;
        if (next < now) next = now + 0.03 + expo(1 / rate);   // (re)starting after a gap: no burst of catch-up
        while (next < now + 0.2) { event(next); next += expo(1 / rate); }
        settle -= dt;
        if (settle <= 0) { settle = 12 + expo(35); logSettle(now + 0.05); }
      };
      e.level = pit ? 0.24 : 0.28;
      e.range = pit ? 18 : 14;
    } else if (e.name === 'electronics') {
      // An old computer room: mains buzz, fan whirr, a faint high whine, plus random relay clicks,
      // chirps, tape servo bursts and teleprinter chatter scheduled from tick().
      const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
      const humLp = this.filter('lowpass', 420, 2);
      hum.connect(humLp).connect(this.gain(0.1)).connect(g);
      const h2 = ac.createOscillator(); h2.frequency.value = 120;
      h2.connect(this.gain(0.06)).connect(g);
      const fan = this.src(this.pink);
      const fanBp = this.filter('bandpass', 700, 0.9);
      const fanG = this.gain(0.55);
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.13;
      lfo.connect(this.gain(0.12)).connect(fanG.gain);
      fan.connect(fanBp).connect(fanG).connect(g);
      const blade = ac.createOscillator(); blade.type = 'triangle'; blade.frequency.value = 187;
      blade.connect(this.filter('bandpass', 190, 8)).connect(this.gain(0.035)).connect(g);
      const whine = ac.createOscillator(); whine.frequency.value = 7400;
      const vib = ac.createOscillator(); vib.frequency.value = 0.4;
      vib.connect(this.gain(30)).connect(whine.frequency);
      whine.connect(this.gain(0.004)).connect(g);
      [hum, h2, fan, lfo, blade, whine, vib].forEach((n) => n.start());
      e.level = 0.3;
      e.range = 13;
      let next = 0.5;
      e.tick = (dt) => {
        next -= dt;
        if (next > 0) return;
        next = 0.12 + Math.random() * 1.4;
        const t = this.now() + 0.02;
        const r = Math.random();
        if (r < 0.4) {                     // relay click
          const n = this.src(this.white, false); const bp = this.filter('bandpass', 2400 + Math.random() * 2000, 2); const eg = this.gain(0);
          n.connect(bp).connect(eg).connect(g); this.env(eg, t, 0.001, 0.5, 0.012); n.start(t); n.stop(t + 0.05);
        } else if (r < 0.62) {             // computer chirps
          const beeps = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < beeps; k++) {
            const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = [880, 1320, 1760, 2093][Math.floor(Math.random() * 4)];
            const eg = this.gain(0); o.connect(this.filter('lowpass', 3000)).connect(eg).connect(g);
            const tk = t + k * 0.09; this.env(eg, tk, 0.002, 0.05, 0.05); o.start(tk); o.stop(tk + 0.1);
          }
        } else if (r < 0.84) {             // tape drive servo: a pitched whirr that spins up and stops
          const o = ac.createOscillator(); o.type = 'sawtooth';
          const dur = 0.25 + Math.random() * 0.8;
          o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(260 + Math.random() * 120, t + dur * 0.4);
          o.frequency.linearRampToValueAtTime(70, t + dur);
          const eg = this.gain(0); o.connect(this.filter('bandpass', 400, 1.5)).connect(eg).connect(g);
          this.env(eg, t, 0.05, 0.18, dur * 0.5); o.start(t); o.stop(t + dur + 0.1);
        } else {                           // teleprinter chatter
          const n = 6 + Math.floor(Math.random() * 14);
          for (let k = 0; k < n; k++) {
            const tk = t + k * (0.055 + Math.random() * 0.03);
            const ns = this.src(this.white, false); const bp = this.filter('bandpass', 1800 + Math.random() * 900, 3); const eg = this.gain(0);
            ns.connect(bp).connect(eg).connect(g); this.env(eg, tk, 0.001, 0.22, 0.018); ns.start(tk); ns.stop(tk + 0.04);
          }
          next += 0.8;
        }
      };
    } else if (e.name === 'generator') {
      // A 1970s generator set: a lumpy engine throb, the alternator's mains hum and whine, cooling-fan rush and
      // a loose-panel rattle. It labours (slower, heavier) as more lines draw on it (this.genLoad, 0..1).
      const fire = ac.createOscillator(); fire.type = 'sawtooth'; fire.frequency.value = 22;
      const body = this.src(this.brown);
      const throb = this.gain(0.32);
      fire.connect(this.gain(0.26)).connect(throb.gain);
      body.connect(this.filter('lowpass', 170, 0.9)).connect(throb).connect(g);
      const thump = ac.createOscillator(); thump.type = 'triangle'; thump.frequency.value = 44;
      const thumpG = this.gain(0.16);
      thump.connect(this.filter('lowpass', 110)).connect(thumpG).connect(g);
      const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
      hum.connect(this.filter('lowpass', 520, 1.4)).connect(this.gain(0.06)).connect(g);
      const whine = ac.createOscillator(); whine.frequency.value = 1450;
      whine.connect(this.gain(0.005)).connect(g);
      const fan = this.src(this.pink);
      fan.connect(this.filter('bandpass', 850, 0.7)).connect(this.gain(0.22)).connect(g);
      const rat = this.src(this.white);
      const ratG = this.gain(0);
      const ratLfo = ac.createOscillator(); ratLfo.type = 'square'; ratLfo.frequency.value = 11;
      ratLfo.connect(this.gain(0.02)).connect(ratG.gain);
      rat.connect(this.filter('bandpass', 2600, 2.5)).connect(ratG).connect(g);
      [fire, body, thump, hum, whine, fan, rat, ratLfo].forEach((n) => n.start());
      e.level = 0.3;
      e.range = 95;
      e.tick = () => {
        const L = this.genLoad ?? 0, t = this.now();
        fire.frequency.setTargetAtTime(22 - L * 2.5, t, 0.8);
        ratLfo.frequency.setTargetAtTime(11 - L * 1.2, t, 0.8);
        thump.frequency.setTargetAtTime(44 - L * 5, t, 0.8);
        thumpG.gain.setTargetAtTime(0.16 + L * 0.12, t, 0.8);
        hum.frequency.setTargetAtTime(60 - L * 1.5, t, 0.8);
        whine.frequency.setTargetAtTime(1450 - L * 140, t, 0.8);
      };
    } else if (e.name === 'frogs') {
      // Frogs along the creek: sparse bouts of tree-frog "rib-bits", the odd green-frog "gunk" and now and then a deep
      // bullfrog. Each frog owns a bank spot (e.spots) and a voice, and each call gets its own panner there. Busier
      // from dusk through the night, rarer and softer by day; a frog within a few metres of the listener keeps quiet.
      const spots = e.spots?.length ? e.spots : [e.pos];
      const voices = spots.map(() => ({ rate: 80 + Math.random() * 40, form: 1500 + Math.random() * 900, k: 0.9 + Math.random() * 0.2 }));
      const pick = (not = -1) => {
        for (let n = 0; n < 6; n++) {
          const i = Math.floor(Math.random() * spots.length);
          if (i !== not && spots[i].distanceTo(this.listenerPos) > 4.5) return i;
        }
        return -1;
      };
      const voice = (i, ref, rolloff) => { const o = this.panner(spots[i], ref, rolloff); o.connect(g); return o; };
      // One pulsed note: a sawtooth at the pulse rate is the buzz, two band-passes the throat and vocal sac.
      // The filtered buzz is only ~0.1 of full scale, hence envelope peaks above 1.
      const note = (o, t, r0, r1, dur, peak, form, glide = 1, q = 4) => {
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(r0, t); osc.frequency.exponentialRampToValueAtTime(r1, t + dur);
        const bp = this.filter('bandpass', form, q);
        bp.frequency.setValueAtTime(form, t); bp.frequency.linearRampToValueAtTime(form * glide, t + dur);
        const eg = this.gain(0);
        osc.connect(bp).connect(eg);
        osc.connect(this.filter('bandpass', form * 2.3, q + 2)).connect(this.gain(0.35)).connect(eg);
        eg.connect(o);
        eg.gain.setValueAtTime(0.0001, t);
        eg.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.25));
        eg.gain.exponentialRampToValueAtTime(peak * 0.7, t + dur * 0.6);
        eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.start(t); osc.stop(t + dur + 0.05);
      };
      // Each call returns roughly how long its bout lasts (s).
      const ribbits = (i, t, vol) => {              // tree frog "rib-bit", 1-4 in a bout
        const v = voices[i], o = voice(i, 3, 1.3);
        const n = 1 + Math.floor(Math.random() * Math.random() * 4);
        for (let k = 0; k < n; k++) {
          const tk = t + k * (0.42 + Math.random() * 0.25), pk = vol * (1 - k * 0.08);
          note(o, tk, v.rate, v.rate * 1.05, 0.07 + Math.random() * 0.03, 1.6 * pk, v.form, 0.95);
          note(o, tk + 0.12, v.rate * 1.1, v.rate * 1.22, 0.11 + Math.random() * 0.05, 1.9 * pk, v.form * 1.05, 1.2);
        }
        return n * 0.6;
      };
      const gunk = (i, t, vol) => {                 // green frog: one loose-banjo "gunk"
        const k = voices[i].k;
        note(voice(i, 3, 1.3), t, 170 * k, 135 * k, 0.13, 1.1 * vol, 600 * k, 0.8, 5);
        return 0.3;
      };
      const bullfrog = (i, t, vol) => {             // deep "rrr-umm", 1-3 in a bout; carries further
        const o = voice(i, 6, 1.1);
        const n = 1 + Math.floor(Math.random() * 3), f = 96 * voices[i].k;
        for (let b = 0; b < n; b++) {
          const tk = t + b * (1.0 + Math.random() * 0.4), dur = 0.5 + Math.random() * 0.35;
          const osc = ac.createOscillator(); osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f * 1.06, tk); osc.frequency.linearRampToValueAtTime(f * 0.9, tk + dur);
          const trem = this.gain(0.7);
          const lfo = ac.createOscillator(); lfo.frequency.value = 7 + Math.random() * 3;
          lfo.connect(this.gain(0.3)).connect(trem.gain);
          const nasal = this.filter('bandpass', 1150, 6);
          nasal.frequency.setValueAtTime(1150, tk); nasal.frequency.linearRampToValueAtTime(880, tk + dur);
          osc.connect(this.filter('bandpass', 230, 2.5)).connect(trem);
          osc.connect(nasal).connect(this.gain(0.9)).connect(trem);
          const eg = this.gain(0);
          trem.connect(eg).connect(o);
          eg.gain.setValueAtTime(0.0001, tk);
          eg.gain.exponentialRampToValueAtTime(0.45 * vol, tk + 0.07);
          eg.gain.exponentialRampToValueAtTime(0.38 * vol, tk + dur * 0.7);
          eg.gain.exponentialRampToValueAtTime(0.0001, tk + dur);
          osc.start(tk); lfo.start(tk); osc.stop(tk + dur + 0.05); lfo.stop(tk + dur + 0.05);
        }
        return n * 1.2;
      };
      e.level = 0.28;   // a single rib-bit sits ~3 dB under one creek emitter at the same distance
      e.range = 55;
      let next = 2 + Math.random() * 4;
      e.tick = (dt) => {
        next -= dt;
        if (next > 0) return;
        const act = clamp((10 - this.altDeg) / 14, 0, 1);   // 0 in full day .. 1 from ~4 deg below the horizon
        next = (2 + Math.random() * 7) / (0.12 + 0.88 * act);  // ~2-9 s apart at night, ~17-75 s by day
        const i = pick();
        if (i < 0) return;
        const t = this.now() + 0.03, vol = 0.55 + 0.45 * act;
        const r = Math.random();
        let busy = r < 0.06 + 0.16 * act ? bullfrog(i, t, vol) : r < 0.26 + 0.12 * act ? gunk(i, t, vol) : ribbits(i, t, vol);
        if (Math.random() < 0.1 + 0.35 * act) {       // a neighbour answers
          const j = pick(i);
          if (j >= 0) busy += 0.5 + ribbits(j, t + busy + 0.2 + Math.random() * 0.6, vol * 0.8);
        }
          next += busy;
      };
    } else if (e.name === 'roomtone') {
      // The lounge under the Tower: a still room's low air, and the faint filament buzz of the desk lamp.
      const air = this.src(this.brown);
      air.connect(this.filter('lowpass', 240, 0.5)).connect(g);
      const buzz = ac.createOscillator(); buzz.frequency.value = 120;
      buzz.connect(this.filter('bandpass', 120, 6)).connect(this.gain(0.012)).connect(g);
      air.start(); buzz.start();
      e.level = 0.05;
      e.range = 12;
    } else if (e.name === 'terminal') {
      // The bunker's CRT terminal: the flyback's 15.7 kHz whine (very faint: young ears only), the mains hum and its
      // second harmonic, and a small cooling fan with a soft blade tone.
      const whine = ac.createOscillator(); whine.frequency.value = 15734;
      const vib = ac.createOscillator(); vib.frequency.value = 0.31;
      vib.connect(this.gain(5)).connect(whine.frequency);
      whine.connect(this.gain(0.012)).connect(g);
      const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
      hum.connect(this.filter('lowpass', 360, 1.5)).connect(this.gain(0.16)).connect(g);
      const h2 = ac.createOscillator(); h2.frequency.value = 120;
      h2.connect(this.gain(0.06)).connect(g);
      const fan = this.src(this.pink), fanG = this.gain(0.7);
      const wob = ac.createOscillator(); wob.frequency.value = 0.17 + Math.random() * 0.06;
      wob.connect(this.gain(0.08)).connect(fanG.gain);
      fan.connect(this.filter('bandpass', 950, 0.8)).connect(fanG).connect(g);
      const blade = ac.createOscillator(); blade.type = 'triangle'; blade.frequency.value = 143;
      blade.connect(this.filter('bandpass', 143, 7)).connect(this.gain(0.05)).connect(g);
      fan.start(0, Math.random() * 3);
      [whine, vib, hum, h2, wob, blade].forEach((n) => n.start());
      e.level = 0.14;
      e.range = 9;
    } else if (e.name === 'hvac') {
      // Air in the room's big round duct: a low rumble and the rush of air through it, surging slowly and never in a
      // cycle (the fire's smoothed-noise modulation), a faint blower tone far up the line, and now and then the
      // sheet metal ticking as it warms or cools.
      const mod = (rate, depth, param) => {
        const m = ac.createBufferSource();
        m.buffer = this.fireMod; m.loop = true; m.playbackRate.value = rate * (0.9 + Math.random() * 0.2);
        m.connect(this.gain(depth)).connect(param);
        m.start(0, Math.random() * 60);
      };
      const rum = this.src(this.brown), rumG = this.gain(0.8);
      rum.connect(this.filter('highpass', 28, 0.7)).connect(this.filter('lowpass', 170, 0.6)).connect(rumG).connect(g);
      mod(0.2, 0.12, rumG.gain);
      const rush = this.src(this.pink), rushBP = this.filter('bandpass', 520, 0.6), rushG = this.gain(0.3);
      rush.connect(rushBP).connect(rushG).connect(g);
      mod(0.35, 0.07, rushG.gain);
      mod(0.27, 60, rushBP.frequency);
      const blower = ac.createOscillator(); blower.type = 'triangle'; blower.frequency.value = 97;
      blower.connect(this.filter('bandpass', 97, 6)).connect(this.gain(0.06)).connect(g);
      [rum, rush].forEach((n) => n.start(0, Math.random() * 3));
      blower.start();
      e.level = 0.12;
      e.range = 14;
      let next = 3 + Math.random() * 8;
      e.tick = (dt) => {
        next -= dt;
        if (next > 0) return;
        next = 4 + Math.random() * 14;
        const t = this.now() + 0.02;
        for (let k = 1 + Math.floor(Math.random() * 3); k > 0; k--) {
          const tk = t + k * (0.08 + Math.random() * 0.3);
          this.tone(g, tk, 1900 + Math.random() * 1400, 1700, 0.035, 0.001, 0.05);
          this.burst(g, tk, { type: 'bandpass', f: 3200, q: 2, peak: 0.05, a: 0.0005, d: 0.01 });
        }
      };
    }
    e.node = g;
  }

  // ---------- one-shots ----------
  // opt.car: the sound is made in the elevator car the player stands in, so it goes to the `near` bus and is still
  // heard with the doors shut.
  play(name, opt = {}) {
    if (!this.ctx) return null;
    const f = this['sfx_' + name];
    if (!f) return null;
    this.route = opt.car ? this.near : this.fxBus;
    try {
      return f.call(this, opt, this.now() + 0.01);
    } finally {
      this.route = this.fxBus;
    }
  }

  // Shut in (an elevator's doors closing round the player): fade everything outside to silence in 0.4 s, and back in
  // over 0.5 s as the doors open. key: who asks (one elevator); the world stays silent while anyone does.
  setEnclosed(key, on) {
    if (!this.ctx) return;
    const was = this.enclosers.size > 0;
    if (on) this.enclosers.add(key); else this.enclosers.delete(key);
    const now = this.enclosers.size > 0;
    if (now === was) return;
    const g = this.world.gain, t = this.now();
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(now ? 0 : 1, t + (now ? 0.4 : 0.5));
  }

  // The storm (render/storm.js), 0..1: callable any time, before start() too. update() eases toward it: the rain
  // comes in and the wind gets louder, gustier and starts to howl.
  setStorm(level) { this.stormTarget = clamp(+level || 0, 0, 1); }

  loop(name, opt = {}) {
    if (!this.ctx) return { stop() {}, set() {}, setPos() {}, setVolume() {} };
    return this['loop_' + name].call(this, opt);
  }

  sfx_click({ pos }, t) {
    const o = this.out(pos, 2);
    const s = this.src(this.white, false); const hp = this.filter('highpass', 2500); const g = this.gain(0);
    s.connect(hp).connect(g).connect(o); this.env(g, t, 0.002, 0.35, 0.03); s.start(t); s.stop(t + 0.1);
    const osc = this.ctx.createOscillator(); osc.frequency.value = 1900; const g2 = this.gain(0);
    osc.connect(g2).connect(o); this.env(g2, t, 0.002, 0.08, 0.02); osc.start(t); osc.stop(t + 0.05);
  }

  sfx_switch({ pos, rate = 1 }, t) {
    const o = this.out(pos, 2);
    const s = this.src(this.white, false); const bp = this.filter('bandpass', 1300 * rate, 1.5); const g = this.gain(0);
    s.connect(bp).connect(g).connect(o); this.env(g, t, 0.002, 0.6, 0.05); s.start(t); s.stop(t + 0.12);
    const osc = this.ctx.createOscillator(); osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const g2 = this.gain(0); osc.connect(g2).connect(o); this.env(g2, t, 0.002, 0.5, 0.08); osc.start(t); osc.stop(t + 0.15);
  }

  // A heavy panel toggle; switching a line on also clacks its contactor and the lamps buzz as they catch.
  sfx_breaker({ pos, on = true }, t) {
    const o = this.out(pos, 2.5);
    const s = this.src(this.white, false); const bp = this.filter('bandpass', 900, 1.2); const g = this.gain(0);
    s.connect(bp).connect(g).connect(o); this.env(g, t, 0.002, 0.8, 0.06); s.start(t); s.stop(t + 0.15);
    const th = this.ctx.createOscillator(); th.frequency.setValueAtTime(120, t); th.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g2 = this.gain(0); th.connect(g2).connect(o); this.env(g2, t, 0.002, 0.7, 0.1); th.start(t); th.stop(t + 0.2);
    if (!on) return;
    const t2 = t + 0.07;
    const c = this.src(this.white, false); const cb = this.filter('bandpass', 1900, 2); const g3 = this.gain(0);
    c.connect(cb).connect(g3).connect(o); this.env(g3, t2, 0.001, 0.5, 0.03); c.start(t2); c.stop(t2 + 0.08);
    const bz = this.ctx.createOscillator(); bz.type = 'sawtooth'; bz.frequency.value = 120;
    const g4 = this.gain(0); bz.connect(this.filter('lowpass', 900)).connect(g4).connect(o);
    this.env(g4, t2, 0.02, 0.12, 0.35); bz.start(t2); bz.stop(t2 + 0.5);
  }

  // A steel filing drawer on its runners: a rolling rumble with the ball bearings' rattle in it, rising a little as it
  // comes out (falling going in), and a metal knock at the stop (heavier shutting). dur: the slide's length (s).
  sfx_drawer({ pos, open = true, dur = 0.55 }, t) {
    const o = this.out(pos, 2);
    const s = this.src(this.white, false, 0.9 + Math.random() * 0.2);
    const bp = this.filter('bandpass', open ? 700 : 900, 1.1);
    bp.frequency.setValueAtTime(open ? 650 : 950, t); bp.frequency.linearRampToValueAtTime(open ? 1000 : 620, t + dur);
    const g = this.gain(0);
    // The rattle: the rumble's level shaken at about 40 Hz.
    const rat = this.ctx.createOscillator(); rat.type = 'square'; rat.frequency.value = 34 + Math.random() * 12;
    const ra = this.gain(0.35); const trem = this.gain(0.65);
    rat.connect(ra).connect(trem.gain);
    s.connect(bp).connect(trem).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.06);
    g.gain.setValueAtTime(0.2, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    s.start(t); s.stop(t + dur + 0.1); rat.start(t); rat.stop(t + dur + 0.1);
    // The stop: a short steel knock (a ringing ping over a dull thump).
    const te = t + dur;
    for (const [f, a] of [[1450, 0.07], [2320, 0.04], [3710, 0.02]]) {
      const osc = this.ctx.createOscillator(); osc.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g2 = this.gain(0); osc.connect(g2).connect(o); this.env(g2, te, 0.001, a * (open ? 0.8 : 1.3), 0.12); osc.start(te); osc.stop(te + 0.2);
    }
    this.thud(o, te, open ? 110 : 80, open ? 0.25 : 0.45);
  }

  // A sheet of paper picked up or laid down: a few quick crisp rustles.
  sfx_page({ pos }, t) {
    const o = this.out(pos, 1.5);
    for (let k = 0; k < 3; k++) {
      const tk = t + k * (0.05 + Math.random() * 0.05);
      const s = this.src(this.white, false, 0.8 + Math.random() * 0.4); const hp = this.filter('bandpass', 3500 + Math.random() * 2500, 0.8); const g = this.gain(0);
      s.connect(hp).connect(g).connect(o); this.env(g, tk, 0.004, 0.09 - k * 0.02, 0.07 + Math.random() * 0.05); s.start(tk); s.stop(tk + 0.2);
    }
  }

  sfx_gearTick({ pos }, t) {
    const o = this.out(pos, 2);
    const osc = this.ctx.createOscillator(); osc.frequency.value = 2800 + Math.random() * 400;
    const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.001, 0.12, 0.025); osc.start(t); osc.stop(t + 0.05);
  }

  creak(o, t, dur, base, amt) {
    const ac = this.ctx;
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = base;
    const jit = ac.createOscillator(); jit.frequency.value = 9 + Math.random() * 6; jit.type = 'square';
    const ja = this.gain(base * 0.25); jit.connect(ja).connect(osc.frequency);
    const drift = ac.createOscillator(); drift.frequency.value = 0.8; const da = this.gain(base * 0.35); drift.connect(da).connect(osc.frequency);
    const bp = this.filter('bandpass', base * 8, 4);
    const g = this.gain(0);
    osc.connect(bp).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amt, t + 0.15);
    g.gain.setValueAtTime(amt * 0.7, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [osc, jit, drift].forEach((n) => { n.start(t); n.stop(t + dur + 0.1); });
  }

  thud(o, t, f = 70, amt = 0.6) {
    const osc = this.ctx.createOscillator(); osc.frequency.setValueAtTime(f * 1.6, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.003, amt, 0.25); osc.start(t); osc.stop(t + 0.4);
    const s = this.src(this.brown, false); const g2 = this.gain(0); const lp = this.filter('lowpass', 500);
    s.connect(lp).connect(g2).connect(o); this.env(g2, t, 0.003, amt * 0.8, 0.2); s.start(t); s.stop(t + 0.35);
  }

  // The lounge's secret bookcase (props/loungeSecret.js): a latch let go (a clunk), then a heavy, slow swing on an old
  // pivot, a low grinding rumble under long wooden creaks with the books and ornaments rattling on their shelves, and a
  // soft thud as it comes to rest. `swing`: seconds from the clunk to the thud.
  sfx_bookcase({ pos, swing = 4.4 }, t) {
    const o = this.out(pos, 5);
    this.thud(o, t, 55, 0.75);
    this.thud(o, t + 0.06, 120, 0.25);
    const s0 = t + 0.6, d = swing - 0.6;
    const r = this.src(this.brown, false); const lp = this.filter('lowpass', 110); const g = this.gain(0);
    r.connect(lp).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, s0); g.gain.exponentialRampToValueAtTime(0.6, s0 + 0.9);
    g.gain.setValueAtTime(0.55, s0 + d - 0.7); g.gain.exponentialRampToValueAtTime(0.0001, s0 + d + 0.2);
    r.start(s0); r.stop(s0 + d + 0.3);
    this.creak(o, s0, d * 0.75, 58, 0.2);
    this.creak(o, s0 + d * 0.3, d * 0.6, 92, 0.12);
    for (let k = 0.15; k < d - 0.2; k += 0.08 + Math.random() * 0.22) {
      const n = this.src(this.white, false); const bp = this.filter('bandpass', 1400 + Math.random() * 2600, 3); const gg = this.gain(0);
      n.connect(bp).connect(gg).connect(o); this.env(gg, s0 + k, 0.002, 0.025 + Math.random() * 0.04, 0.05);
      n.start(s0 + k); n.stop(s0 + k + 0.12);
    }
    this.thud(o, s0 + d, 46, 0.55);
  }

  sfx_doorOpen({ pos }, t) {
    const o = this.out(pos, 3);
    this.creak(o, t, 1.6, 85, 0.22);
    this.creak(o, t + 0.1, 1.2, 190, 0.08);
    const s = this.src(this.brown, false); const lp = this.filter('lowpass', 380); const g = this.gain(0);
    s.connect(lp).connect(g).connect(o); this.env(g, t, 0.2, 0.35, 1.4); s.start(t); s.stop(t + 1.8);
    this.thud(o, t + 1.62, 90, 0.4);
  }

  sfx_doorClose(opt, t) { this.sfx_doorOpen(opt, t); }

  sfx_hingeOpen({ pos }, t) {
    const o = this.out(pos, 2.5);
    const osc = this.ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t); osc.frequency.linearRampToValueAtTime(760, t + 0.45); osc.frequency.linearRampToValueAtTime(610, t + 0.9);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 23; const va = this.gain(35); vib.connect(va).connect(osc.frequency);
    const bp = this.filter('bandpass', 1500, 2); const g = this.gain(0);
    osc.connect(bp).connect(g).connect(o); this.env(g, t, 0.1, 0.12, 0.8);
    osc.start(t); vib.start(t); osc.stop(t + 1); vib.stop(t + 1);
    this.sfx_click({ pos }, t);
  }

  sfx_hingeClose(opt, t) { this.sfx_hingeOpen(opt, t); this.thud(this.out(opt.pos, 2.5), t + 1.2, 140, 0.25); }

  sfx_elevatorRide({ pos, attached, duration = 8 }, t) {
    const o = attached ? this.route : this.out(pos, 4);
    const ac = this.ctx;
    this.thud(o, t, 55, 0.7);
    const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 46;
    const lp = this.filter('lowpass', 170, 1); const g = this.gain(0);
    osc.connect(lp).connect(g).connect(o);
    const s = this.src(this.pink); const lp2 = this.filter('lowpass', 420); const g2 = this.gain(0);
    s.connect(lp2).connect(g2).connect(o);
    for (const gg of [g, g2]) {
      gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(0.35, t + 1.2);
      gg.gain.setValueAtTime(0.35, t + duration - 1.2); gg.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    }
    osc.start(t); s.start(t); osc.stop(t + duration + 0.1); s.stop(t + duration + 0.1);
    for (let k = 1.5; k < duration - 1; k += 0.6 + Math.random() * 1.4) this.sfx_click({ pos: attached ? null : pos }, t + k);
    this.creak(o, t + duration * 0.45, 1.1, 120, 0.05);
    this.thud(o, t + duration - 0.05, 60, 0.8);
  }

  sfx_elevatorDistant({ pos, duration = 8 }, t) {
    const o = this.out(pos, 2, 1.5);
    const s = this.src(this.brown); const lp = this.filter('lowpass', 160); const g = this.gain(0);
    s.connect(lp).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + duration * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    s.start(t); s.stop(t + duration + 0.1);
    this.thud(o, t + duration - 0.05, 60, 0.5);
  }

  sfx_step({ pos, surface = 'grass', run = false }, t) {
    const o = this.near;   // your own feet: never faded
    const v = run ? 1.25 : 1;
    const noise = (freq, q, peak, dur, buf = this.white, at = t) => {
      const s = this.src(buf, false, 0.8 + Math.random() * 0.4); const bp = this.filter('bandpass', freq * (0.85 + Math.random() * 0.3), q); const g = this.gain(0);
      s.connect(bp).connect(g).connect(o); this.env(g, at, 0.006, peak * v, dur); s.start(at); s.stop(at + dur + 0.1);
    };
    if (surface === 'grass') { noise(3200, 0.6, 0.05, 0.12); noise(900, 1, 0.03, 0.08); }
    else if (surface === 'dirt') { noise(1200, 0.8, 0.07, 0.1); noise(2800, 1.2, 0.04, 0.06); }
    else if (surface === 'gravel') {
      // Loose pebbles: a soft crunch under a quick scatter of sharp little grains as the stones shift.
      noise(1000, 0.9, 0.05, 0.09);
      for (let k = 0; k < 5; k++) noise(2600 + Math.random() * 2800, 2.5, 0.03, 0.025, this.white, t + 0.006 + k * 0.014 + Math.random() * 0.01);
    }
    else if (surface === 'rock') { noise(2200, 1.5, 0.08, 0.05); noise(600, 1, 0.05, 0.07, this.brown); }
    else if (surface === 'wood' || surface === 'ladder') {
      const osc = this.ctx.createOscillator(); osc.frequency.setValueAtTime(surface === 'ladder' ? 240 : 170, t); osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
      const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.003, 0.12 * v, 0.1); osc.start(t); osc.stop(t + 0.2);
      noise(700, 1.2, 0.05, 0.07);
      if (Math.random() < 0.25) this.creak(o, t + 0.02, 0.35, 140 + Math.random() * 60, 0.03);
    } else if (surface === 'metal') {
      for (const f of [480, 1270, 2210]) {
        const osc = this.ctx.createOscillator(); osc.frequency.value = f * (0.97 + Math.random() * 0.06);
        const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.002, 0.03 * v, 0.18); osc.start(t); osc.stop(t + 0.3);
      }
      noise(3000, 1, 0.04, 0.04);
    } else if (surface === 'cave') { noise(1800, 1.2, 0.07, 0.07); }
  }

  sfx_ringing(opt, t) {
    const o = this.master;
    for (const [f, a] of [[6400, 0.05], [7150, 0.03], [3950, 0.02]]) {
      const osc = this.ctx.createOscillator(); osc.frequency.value = f;
      const g = this.gain(0); osc.connect(g).connect(o);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      osc.start(t); osc.stop(t + 2.5);
    }
  }

  sfx_drip({ pos }, t) {
    const o = this.out(pos, 2);
    const osc = this.ctx.createOscillator(); const f = 1300 + Math.random() * 1400;
    osc.frequency.setValueAtTime(f, t); osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.05);
    const g = this.gain(0); osc.connect(g).connect(o); this.env(g, t, 0.002, 0.12, 0.09); osc.start(t); osc.stop(t + 0.15);
  }

  sfx_rumble({ duration = 4, peak = 0.6 }, t) {
    const s = this.src(this.brown); const lp = this.filter('lowpass', 90); const g = this.gain(0);
    s.connect(lp).connect(g).connect(this.fxBus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + duration * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    s.start(t); s.stop(t + duration + 0.1);
  }

  sfx_grind({ duration = 2.6 }, t) {
    const o = this.fxBus;
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(38, t); osc.frequency.linearRampToValueAtTime(52, t + duration);
    const lp = this.filter('lowpass', 300); const g = this.gain(0);
    osc.connect(lp).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.3); g.gain.setValueAtTime(0.3, t + duration - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t); osc.stop(t + duration + 0.1);
    this.creak(o, t, duration, 70, 0.18);
    for (let k = 0; k < duration; k += 0.13) this.sfx_switch({ rate: 0.6 }, t + k);
  }

  sfx_steam({ duration = 6 }, t) {
    const o = this.fxBus;
    this.thud(o, t, 45, 1.0);
    const s = this.src(this.white); const hp = this.filter('highpass', 1200); const g = this.gain(0);
    s.connect(hp).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const s2 = this.src(this.pink); const lp = this.filter('lowpass', 600); const g2 = this.gain(0);
    s2.connect(lp).connect(g2).connect(o);
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.8);
    s.start(t); s2.start(t); s.stop(t + duration + 0.1); s2.stop(t + duration + 0.1);
  }

  // Twin-bell alarm: inharmonic partials gated by a fast hammer envelope.
  sfx_alarm({ duration = 7 }, t) {
    const ac = this.ctx;
    const out = this.gain(0);
    out.connect(this.fxBus);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.5, t + duration * 0.7); out.gain.setValueAtTime(0.5, t + duration - 0.05); out.gain.linearRampToValueAtTime(0, t + duration);
    const bells = [2350, 2610];
    bells.forEach((f0, bi) => {
      const env = this.gain(0);
      const saw = ac.createOscillator(); saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(11, t); saw.frequency.linearRampToValueAtTime(19, t + duration);
      const inv = this.gain(-0.5); const off = ac.createConstantSource(); off.offset.value = 0.5;
      saw.connect(inv).connect(env.gain); off.connect(env.gain);
      for (const [r, a] of [[1, 0.5], [2.32, 0.25], [4.25, 0.12], [6.63, 0.06]]) {
        const o = ac.createOscillator(); o.frequency.value = f0 * r; const g = this.gain(a);
        o.connect(g).connect(env); o.start(t + bi * 0.03); o.stop(t + duration + 0.1);
      }
      env.connect(out);
      saw.start(t + bi * 0.03); off.start(t); saw.stop(t + duration + 0.1); off.stop(t + duration + 0.1);
    });
  }

  // ---------- the bunker's terminal and the rocks.exe cutscene ----------
  // A key on an old terminal keyboard, never twice the same: the switch's bright click, then a few ms later the cap
  // bottoming out (a hollow thock and the plate's tick), and the key coming back up. space: the bar's deeper thock and
  // its stabiliser wire's rattle. vel: how hard (0.5..1.3).
  sfx_key({ pos, space = false, vel = 1 }, t) {
    const o = this.gain(2.2);
    o.connect(this.out(pos, 1.5));
    const R = (a, b) => a + Math.random() * (b - a);
    const v = Math.max(1e-3, +vel || 0) * R(0.7, 1.1), deep = space ? 0.68 : R(0.9, 1.12);   // (exponential ramps never reach 0)
    t += Math.random() * 0.004;
    this.burst(o, t, { f: R(2800, 5200), q: R(1.2, 2.6), peak: 0.16 * v, a: 0.0006, d: R(0.006, 0.013) });
    const tb = t + R(0.005, 0.016);
    this.burst(o, tb, { f: R(420, 640) * deep, q: R(3, 6), peak: 0.75 * v, a: 0.0008, d: R(0.028, 0.045) * (space ? 1.6 : 1) });
    this.tone(o, tb, R(900, 1300) * deep, R(700, 900) * deep, 0.04 * v, 0.0008, R(0.012, 0.022));
    this.burst(o, tb, { type: 'highpass', f: R(1800, 2800), q: 0.7, peak: 0.08 * v, a: 0.0004, d: 0.007 });
    const tr = tb + R(0.06, 0.14);
    this.burst(o, tr, { f: R(1500, 2800), q: 2, peak: 0.06 * v, a: 0.0008, d: 0.01 });
    this.burst(o, tr + 0.002, { f: R(520, 820) * deep, q: 4, peak: 0.22 * v, a: 0.0008, d: 0.02 });
    if (space) for (let k = 0; k < 3; k++) this.burst(o, tb + 0.004 + k * R(0.006, 0.011), { f: R(2200, 3400), q: 5, peak: 0.12 * v * (1 - k * 0.25), a: 0.0004, d: 0.008 });
  }

  // The Enter key: the big key's heavier thock, its stabiliser rattling, and a firmer return.
  sfx_keyEnter({ pos, vel = 1 }, t) {
    const o = this.gain(1.3);
    o.connect(this.out(pos, 1.5));
    const R = (a, b) => a + Math.random() * (b - a);
    const v = Math.max(1e-3, +vel || 0) * R(0.9, 1.1);
    this.burst(o, t, { f: R(2600, 3800), q: 1.6, peak: 0.2 * v, a: 0.0006, d: 0.012 });
    const tb = t + R(0.008, 0.014);
    this.burst(o, tb, { f: R(330, 420), q: 4, peak: 1.0 * v, a: 0.0008, d: 0.06 });
    this.tone(o, tb, R(160, 190), 120, 0.12 * v, 0.001, 0.05);
    this.burst(o, tb, { type: 'highpass', f: 2000, q: 0.7, peak: 0.1 * v, a: 0.0004, d: 0.01 });
    for (let k = 0; k < 3; k++) this.burst(o, tb + 0.005 + k * R(0.007, 0.012), { f: R(2400, 3600), q: 5, peak: 0.14 * v * (1 - k * 0.25), a: 0.0004, d: 0.009 });
    const tr = tb + R(0.1, 0.16);
    this.burst(o, tr, { f: R(1800, 2600), q: 2, peak: 0.08 * v, a: 0.0008, d: 0.012 });
    this.burst(o, tr + 0.003, { f: R(380, 520), q: 4, peak: 0.35 * v, a: 0.0008, d: 0.03 });
  }

  // A digital burst of a signal breaking up (~dur s): crushed noise through a band that jumps about, a warbling
  // data tone, a mains buzz, all chopped by a gate that stutters on and off. amt: 0..1 level.
  sfx_glitch({ pos, dur = 0.3, amt = 1 }, t) {
    const ac = this.ctx;
    amt = Math.max(1e-3, +amt || 0);   // (exponential ramps never reach 0)
    dur = Math.max(0.06, +dur || 0.3);
    const o = this.out(pos, 2);
    const R = (a, b) => a + Math.random() * (b - a);
    const out = this.gain(0);
    out.connect(o);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.24 * amt, t + 0.006);
    out.gain.setValueAtTime(0.22 * amt, t + dur - 0.04); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const gate = this.gain(1);
    gate.connect(out);
    const n = this.src(this.white), crush = this.shaper(this.crushCurve());
    const bp = this.filter('bandpass', 2000, 1.4), ng = this.gain(1.4);
    n.connect(this.gain(1.6)).connect(crush).connect(bp).connect(ng).connect(gate);
    const sq = ac.createOscillator(); sq.type = 'square';
    const sqg = this.gain(0.07);
    sq.connect(this.filter('lowpass', 4000, 0.7)).connect(sqg).connect(gate);
    const buzz = ac.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 60 * (1 + Math.floor(Math.random() * 3));
    buzz.connect(this.filter('lowpass', 1200, 0.8)).connect(this.gain(0.1)).connect(gate);
    for (let tk = t; tk < t + dur; tk += R(0.012, 0.035)) {
      bp.frequency.setValueAtTime(R(700, 6000), tk);
      sq.frequency.setValueAtTime([220, 330, 440, 880, 1320, 1760, 2640][Math.floor(Math.random() * 7)] * R(0.98, 1.02), tk);
      gate.gain.setTargetAtTime(Math.random() < 0.72 ? 1 : 0.06, tk, 0.002);
      sqg.gain.setTargetAtTime(Math.random() < 0.5 ? 0.07 : 0, tk, 0.002);
    }
    n.start(t, Math.random() * 3); n.stop(t + dur + 0.05);
    sq.start(t); sq.stop(t + dur + 0.05); buzz.start(t); buzz.stop(t + dur + 0.05);
    for (let k = 0; k < 4; k++) this.grain(out, t + Math.random() * dur, 'tick', R(0.8, 1.4), 0.5);
  }

  // A CRT switched on: the power switch, the degauss coil's loud 60 Hz thunk and buzz dying away over a second with
  // the shadow mask rattling, the high voltage coming up as a crackle of static, and the flyback's whine settling in.
  sfx_crtOn({ pos }, t) {
    const ac = this.ctx;
    const o = this.gain(0.8);
    o.connect(this.out(pos, 2));
    this.burst(o, t, { f: 1600, q: 1.5, peak: 0.35, a: 0.0008, d: 0.03 });
    this.tone(o, t, 140, 60, 0.25, 0.002, 0.07);
    const t1 = t + 0.06;
    const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
    const hg = this.gain(0);
    hum.connect(this.filter('lowpass', 700, 1)).connect(hg).connect(o);
    this.env(hg, t1, 0.008, 0.32, 1.1);
    const h2 = ac.createOscillator(); h2.frequency.value = 120;
    const h2g = this.gain(0); h2.connect(h2g).connect(o); this.env(h2g, t1, 0.008, 0.16, 0.9);
    const rat = this.src(this.white), ratG = this.gain(0), ratAm = this.gain(0.5);
    const am = ac.createOscillator(); am.type = 'square'; am.frequency.value = 120;
    am.connect(this.gain(0.5)).connect(ratAm.gain);
    rat.connect(this.filter('bandpass', 2300, 3)).connect(ratAm).connect(ratG).connect(o);
    this.env(ratG, t1, 0.01, 0.12, 0.75);
    [hum, h2, am].forEach((n) => { n.start(t1); n.stop(t1 + 1.3); });
    rat.start(t1, Math.random() * 3); rat.stop(t1 + 1.0);
    this.thud(o, t1, 55, 0.45);
    for (let k = 0; k < 12; k++) this.grain(o, t1 + 0.1 + Math.pow(Math.random(), 1.4) * 0.9, Math.random() < 0.7 ? 'tick' : 'crackle', 0.8 + Math.random() * 0.6, 0.35);
    this.burst(o, t1 + 0.1, { type: 'highpass', f: 5000, q: 0.5, peak: 0.03, a: 0.15, d: 0.8 });
    const wh = ac.createOscillator(); wh.frequency.value = 15734;
    const wg = this.gain(0); wh.connect(wg).connect(o);
    wg.gain.setValueAtTime(0.0001, t1 + 0.1); wg.gain.exponentialRampToValueAtTime(0.012, t1 + 0.5);
    wg.gain.exponentialRampToValueAtTime(0.0001, t1 + 2.4);
    wh.start(t1 + 0.1); wh.stop(t1 + 2.5);
  }

  // The switch to the camera's picture: a relay clacks over and the line comes up as a burst of static.
  sfx_feedCut({ pos }, t) {
    const o = this.gain(1.4);
    o.connect(this.out(pos, 2));
    const R = (a, b) => a + Math.random() * (b - a);
    this.burst(o, t, { f: 3400, q: 2, peak: 0.3, a: 0.0005, d: 0.006 });
    this.burst(o, t + 0.003, { f: 1500, q: 2.5, peak: 0.25, a: 0.0005, d: 0.012 });
    this.tone(o, t + 0.003, 900, 380, 0.08, 0.001, 0.02);
    const ts = t + 0.012, dur = 0.24;
    const n = this.src(this.white), g = this.gain(0), chop = this.gain(1);
    n.connect(this.filter('bandpass', 2600, 0.5)).connect(chop).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, ts); g.gain.exponentialRampToValueAtTime(0.22, ts + 0.004);
    g.gain.exponentialRampToValueAtTime(0.06, ts + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, ts + dur);
    for (let tk = ts; tk < ts + dur; tk += R(0.01, 0.03)) chop.gain.setTargetAtTime(Math.random() < 0.75 ? 1 : 0.15, tk, 0.002);
    n.start(ts, Math.random() * 3); n.stop(ts + dur + 0.03);
    this.tone(o, ts, 80, 40, 0.12, 0.004, 0.12);
    for (let k = 0; k < 5; k++) this.grain(o, ts + Math.random() * dur * 0.8, 'tick', R(0.8, 1.3), 0.4);
  }

  // The Tor blown apart. A supersonic crack, a huge low boom, then a long rolling roar (~4 s) that lumbers about
  // and echoes off the island, and stones and gravel coming down all through it.
  //  - opt.pos: in the world, with a long reach; it arrives at the speed of sound and the air dulls it far away.
  //  - opt.feed: heard through the hidden camera's microphone instead (not positional): band-limited, overdriven,
  //    crackling, its auto-gain ducking after the blast and creeping back. It goes straight out (feedOut), so it is
  //    not processed twice when setFeed() is on.
  sfx_explosion({ pos, feed = false }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    let o;
    if (feed) {
      o = this.gain(1);
      const drive = this.gain(2.6), sh = this.shaper(this.driveCurve());
      const agc = this.gain(0.5);
      o.connect(this.filter('highpass', 260, 0.8)).connect(this.filter('highpass', 220, 0.6)).connect(drive).connect(sh)
        .connect(this.filter('lowpass', 3400, 0.9)).connect(this.filter('lowpass', 4000, 0.6)).connect(agc).connect(this.feedOut);
      agc.gain.setValueAtTime(0.5, t + 0.05);
      agc.gain.linearRampToValueAtTime(0.3, t + 0.35);
      agc.gain.linearRampToValueAtTime(0.5, t + 3.5);
      // The mic and the line overloading: crackles and pops, thickest just after the blast.
      for (let k = 0; k < 34; k++) {
        const tk = t + Math.pow(Math.random(), 2.2) * 3;
        this.grain(agc, tk, Math.random() < 0.6 ? 'crackle' : 'tick', R(0.6, 1.2), R(0.25, 0.7));
      }
    } else if (pos) {
      const d = pos.distanceTo(this.listenerPos);
      t += d / 343;
      const p = this.panner(pos, 30, 0.7, 3000);
      const air = this.filter('lowpass', Math.max(700, 20000 / (1 + d / 60)), 0.5);
      air.connect(this.gain(0.6)).connect(p).connect(this.route);
      o = air;
    } else { o = this.gain(0.6); o.connect(this.route); }
    // The crack: a sharp N-wave, its tail end a little later.
    this.burst(o, t, { type: 'highpass', f: 1200, q: 0.7, peak: 0.9, a: 0.0004, d: 0.035 });
    this.burst(o, t + 0.011, { type: 'highpass', f: 900, q: 0.7, peak: 0.5, a: 0.0004, d: 0.05 });
    this.burst(o, t, { f: 2400, q: 0.6, peak: 0.6, a: 0.0006, d: 0.12 });
    // The boom.
    const tb = t + 0.008;
    this.tone(o, tb, 96, 26, 0.9, 0.006, 1.7);
    this.tone(o, tb, 52, 21, 0.55, 0.01, 2.2, 'triangle');
    this.burst(o, tb, { buf: this.brown, type: 'lowpass', f: 180, q: 0.6, peak: 1.0, a: 0.01, d: 2.6 });
    this.burst(o, tb, { buf: this.pink, type: 'lowpass', f: 1400, q: 0.5, peak: 0.7, a: 0.006, d: 0.5 });
    // The roar: noise darkening over 4 s, lumbering with the fire's smoothed-noise modulation; a low tail under it.
    const dur = 4.4;
    const roar = this.src(this.pink), lp = this.filter('lowpass', 2600, 0.6), rg = this.gain(0), lum = this.gain(1);
    roar.connect(lp).connect(lum).connect(rg).connect(o);
    lp.frequency.setValueAtTime(2600, tb); lp.frequency.exponentialRampToValueAtTime(240, tb + dur);
    rg.gain.setValueAtTime(0.0001, tb); rg.gain.exponentialRampToValueAtTime(0.6, tb + 0.12);
    rg.gain.exponentialRampToValueAtTime(0.25, tb + 1.4); rg.gain.exponentialRampToValueAtTime(0.0001, tb + dur);
    const m = ac.createBufferSource(); m.buffer = this.fireMod; m.loop = true; m.playbackRate.value = 1.6;
    m.connect(this.gain(0.45)).connect(lum.gain);
    const tail = this.src(this.brown), tg = this.gain(0);
    tail.connect(this.filter('lowpass', 110, 0.6)).connect(tg).connect(o);
    tg.gain.setValueAtTime(0.0001, tb); tg.gain.exponentialRampToValueAtTime(0.7, tb + 0.4);
    tg.gain.exponentialRampToValueAtTime(0.0001, tb + dur + 0.8);
    roar.start(tb, Math.random() * 3); roar.stop(tb + dur + 0.1);
    m.start(tb, Math.random() * 60); m.stop(tb + dur + 0.1);
    tail.start(tb, Math.random() * 3); tail.stop(tb + dur + 0.9);
    // Echoes off the island's cliffs and the sea of cloud.
    for (const [dt, a, f] of [[0.38, 0.4, 48], [0.86, 0.3, 42], [1.5, 0.22, 38], [2.3, 0.14, 34]]) {
      this.thud(o, tb + dt * R(0.9, 1.1), f, a);
      this.burst(o, tb + dt, { buf: this.pink, type: 'lowpass', f: 600, q: 0.5, peak: a * 0.5, a: 0.03, d: 0.6 });
    }
    // Stones landing all round: heavy thuds, and gravel raining down after them.
    for (let k = 0; k < 14; k++) {
      const tk = tb + R(0.9, 4.2);
      this.thud(o, tk, R(55, 150), R(0.08, 0.3));
      this.burst(o, tk, { f: R(700, 1600), q: 1, peak: R(0.05, 0.14), a: 0.001, d: 0.06 });
    }
    this.sfx_debris({ out: o, dur: 3.2, amt: 0.9 }, tb + 1.1);
  }

  // A big stone landing (size: its radius in metres, ~1): a deep thump through the ground, the crunch of the impact,
  // and a scatter of pebbles kicked out.
  sfx_rockLand({ pos, size = 1 }, t) {
    const o = this.gain(0.8);
    o.connect(this.out(pos, 6, 1));
    const R = (a, b) => a + Math.random() * (b - a);
    const s = clamp(size, 0.4, 2), k = Math.sqrt(s);
    this.tone(o, t, 78 / k, 36 / k, 0.75 * k, 0.004, 0.45);
    this.burst(o, t, { buf: this.brown, type: 'lowpass', f: 300, q: 0.6, peak: 0.85 * k, a: 0.003, d: 0.35 });
    this.burst(o, t, { buf: this.brown, type: 'lowpass', f: 90, q: 0.6, peak: 0.5 * k, a: 0.01, d: 0.8 });
    this.burst(o, t, { f: R(800, 1100) / k, q: 0.9, peak: 0.35, a: 0.001, d: 0.09 });
    this.burst(o, t + 0.004, { type: 'highpass', f: 2400, q: 0.7, peak: 0.1, a: 0.0006, d: 0.04 });
    for (let n = 3 + Math.floor(Math.random() * 6); n > 0; n--) {
      this.grain(o, t + 0.04 + Math.pow(Math.random(), 1.5) * 0.6, Math.random() < 0.5 ? 'crackle' : 'tick', R(0.5, 1), R(0.2, 0.5));
    }
  }

  // Gravel pattering down for ~dur s: a shower of little stone ticks thinning out, the odd pebble's clack, and a hiss
  // of sand settling. opt.out: a node to play into instead of pos/the bus (the explosion's own chain).
  sfx_debris({ pos, out = null, dur = 2, amt = 1 }, t) {
    const o = out ?? this.out(pos, 5);
    const R = (a, b) => a + Math.random() * (b - a);
    const v = this.gain(0.6 * amt);
    v.connect(this.filter('highpass', 300, 0.6)).connect(o);
    let tk = t;
    while (tk < t + dur) {
      const u = (tk - t) / dur;
      tk += -Math.log(1 - Math.random()) / (45 * Math.exp(-u * 2.6) + 3);
      const r = Math.random();
      if (r < 0.62) this.grain(v, tk, 'tick', R(0.5, 1.2), R(0.3, 0.8) * (1 - u * 0.6));
      else if (r < 0.92) this.grain(v, tk, 'crackle', R(0.45, 0.9), R(0.3, 0.7) * (1 - u * 0.6));
      else this.tone(v, tk, R(1500, 3200), R(1200, 2600), 0.08 * (1 - u * 0.5), 0.0008, R(0.015, 0.03));
    }
    const sand = this.src(this.white), sg = this.gain(0);
    sand.connect(this.filter('bandpass', 3800, 0.6)).connect(sg).connect(v);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.12, t + 0.15);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sand.start(t, Math.random() * 3); sand.stop(t + dur + 0.05);
  }

  // ---------- the endgame ----------
  // The bunker's terminal tried with no power behind it (props/terminal.js): the switch's dull, dead click (nothing
  // catches), then the little speaker's low-battery blip, two notes falling, the second sagging away as the last of
  // the charge goes, with the supply's buzz dying under it.
  sfx_noPower({ pos }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.noPower);
    o.connect(this.out(pos, 1.5));
    this.burst(o, t, { f: R(800, 1100), q: 1.4, peak: 0.45, a: 0.0006, d: 0.02 });
    this.burst(o, t + 0.002, { buf: this.brown, type: 'lowpass', f: 420, q: 0.7, peak: 0.7, a: 0.001, d: 0.05 });
    this.tone(o, t, R(160, 190), 90, 0.14, 0.001, 0.05);
    this.burst(o, t + R(0.08, 0.12), { f: R(1200, 1600), q: 1.6, peak: 0.12, a: 0.0006, d: 0.012 });
    // The speaker: no bass, a tinny peak, a dull top.
    const spk = this.filter('highpass', 380, 0.7), pk = this.filter('peaking', 1500, 1.4);
    pk.gain.value = 6;
    spk.connect(pk).connect(this.filter('lowpass', 3600, 0.7)).connect(o);
    const tb = t + R(0.13, 0.16), t2 = tb + 0.115, d2 = R(0.3, 0.36);
    this.beep(spk, tb, 660, 640, 0.075, 0.09);
    const osc = ac.createOscillator(); osc.type = 'square';
    osc.frequency.setValueAtTime(440, t2); osc.frequency.exponentialRampToValueAtTime(R(200, 230), t2 + d2);
    const g = this.gain(0); osc.connect(g).connect(spk);
    g.gain.setValueAtTime(0.0001, t2); g.gain.exponentialRampToValueAtTime(0.09, t2 + 0.005);
    g.gain.linearRampToValueAtTime(0.08, t2 + d2 * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t2 + d2);
    osc.start(t2); osc.stop(t2 + d2 + 0.03);
    const bz = ac.createOscillator(); bz.type = 'sawtooth';
    bz.frequency.setValueAtTime(110, t2); bz.frequency.exponentialRampToValueAtTime(55, t2 + d2);
    const bg = this.gain(0); bz.connect(this.filter('lowpass', 650, 0.7)).connect(bg).connect(o);
    this.env(bg, t2, 0.01, 0.05, d2);
    bz.start(t2); bz.stop(t2 + d2 + 0.05);
    this.grain(o, t2 + R(0, 0.03), 'tick', R(0.8, 1.2), 0.25);
  }

  // The observatory desk computer reporting on the coordinates (sequences/coordsPan.js), from its little speaker.
  // kind: 'detect', two short beeps; 'tick', a soft processing chirp (never twice the same); 'valid', a bright rising
  // three-note confirmation (E G# B, a little chorused, the last note ringing on).
  sfx_coordsBeep({ pos, kind = 'detect' }, t) {
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.coordsBeep);
    o.connect(this.out(pos, 2));
    const spk = this.filter('highpass', 320, 0.7);
    spk.connect(this.filter('lowpass', 5200, 0.7)).connect(o);
    if (kind === 'tick') {
      const f = R(2100, 2900);
      this.tone(spk, t, f, f * R(1.15, 1.3), 0.05, 0.002, 0.03, 'triangle');
      if (Math.random() < 0.45) { const f2 = R(2400, 3300); this.tone(spk, t + R(0.045, 0.07), f2, f2 * 1.2, 0.03, 0.002, 0.022, 'triangle'); }
    } else if (kind === 'valid') {
      [1318.5, 1661.2, 1975.5].forEach((f, i) => {
        const tk = t + i * 0.105, last = i === 2, dur = last ? 0.12 : 0.085, tail = last ? 0.45 : 0;
        this.beep(spk, tk, f, f, dur, 0.07, 'square', tail);
        this.beep(spk, tk, f * 1.004, f * 1.004, dur, 0.035, 'square', tail);
        this.beep(spk, tk, f * 2, f * 2, dur, 0.025, 'sine', tail);
      });
    } else {
      for (const k of [0, 1]) {
        const tk = t + k * 0.13;
        this.beep(spk, tk, 1760, 1760, 0.07, 0.07);
        this.beep(spk, tk, 880, 880, 0.07, 0.03, 'sine');
      }
    }
  }

  // The gatehouse's blast doors unlocking (props/gatehouse.js): a hydraulic pump spinning up, three or four huge bolts
  // drawn one after another (a grating slide, then a deep clunk with the steel ringing, and its slap back off the
  // cliff), then the pressure let go in a long hiss and the doors settling in their frame.
  sfx_hatchUnlock({ pos }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.hatch);
    o.connect(this.out(pos, 12, 0.9));
    const echo = this.gain(0.22);
    echo.connect(this.filter('lowpass', 900, 0)).connect(o);
    const n = Math.random() < 0.6 ? 4 : 3, bolts = [];
    for (let k = 0, tk = t + 0.45; k < n; k++, tk += R(0.3, 0.48)) bolts.push(tk);
    const tEnd = bolts[n - 1];
    // The pump: a motor's growl spinning up (and down after the last bolt), its whine, and the oil rushing.
    const mot = ac.createOscillator(); mot.type = 'sawtooth';
    mot.frequency.setValueAtTime(24, t); mot.frequency.exponentialRampToValueAtTime(58, t + 0.5);
    mot.frequency.setValueAtTime(58, tEnd); mot.frequency.exponentialRampToValueAtTime(30, tEnd + 0.9);
    const mg = this.gain(0);
    mot.connect(this.filter('lowpass', 170, 0)).connect(mg).connect(o);
    const wh = ac.createOscillator();
    wh.frequency.setValueAtTime(380, t); wh.frequency.exponentialRampToValueAtTime(820, t + 0.55);
    wh.frequency.setValueAtTime(820, tEnd); wh.frequency.exponentialRampToValueAtTime(300, tEnd + 0.9);
    const wg = this.gain(0); wh.connect(wg).connect(o);
    const oil = this.src(this.pink), og = this.gain(0);
    oil.connect(this.filter('bandpass', 320, 1.1)).connect(og).connect(o);
    for (const [g, v] of [[mg, 0.09], [wg, 0.01], [og, 0.25]]) {
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.45);
      g.gain.setValueAtTime(v, tEnd); g.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.9);
    }
    [mot, wh].forEach((x) => { x.start(t); x.stop(tEnd + 1); });
    oil.start(t, Math.random() * 3); oil.stop(tEnd + 1);
    const clunk = (dst, tt, k, v) => {
      this.thud(dst, tt, 52 * k, 0.9 * v);
      this.burst(dst, tt, { buf: this.brown, type: 'lowpass', f: 200, q: 0.6, peak: 0.8 * v, a: 0.002, d: 0.3 });
      this.burst(dst, tt, { f: R(700, 1000), q: 1, peak: 0.35 * v, a: 0.0008, d: 0.05 });
      this.ring(dst, tt, 128 * k, [[1, 0.5, 0.7], [2.31, 0.3, 0.45], [3.93, 0.18, 0.3], [5.72, 0.1, 0.18]], 0.35 * v);
    };
    bolts.forEach((tt, i) => {
      const k = R(0.88, 1.1);
      // the bolt drawn back through its keeper: a short rising grate
      const s = this.src(this.white, false), bp = this.filter('bandpass', 500, 2.2), g = this.gain(0);
      bp.frequency.setValueAtTime(R(420, 520), tt - 0.14); bp.frequency.exponentialRampToValueAtTime(R(800, 1000), tt);
      s.connect(bp).connect(g).connect(o);
      g.gain.setValueAtTime(0.0001, tt - 0.14); g.gain.exponentialRampToValueAtTime(0.18, tt - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.01);
      s.start(tt - 0.14, Math.random() * 3); s.stop(tt + 0.03);
      clunk(o, tt, k, i === n - 1 ? 1.15 : 1);
      clunk(echo, tt + R(0.19, 0.24), k, 1);
    });
    // The pressure let go, and the doors settling.
    const th = tEnd + R(0.15, 0.25), hd = R(1.3, 1.7);
    const hs = this.src(this.white), hbp = this.filter('bandpass', 5000, 0.8), hg = this.gain(0);
    hbp.frequency.setValueAtTime(6500, th); hbp.frequency.exponentialRampToValueAtTime(2400, th + hd);
    hs.connect(this.filter('highpass', 1500, 0)).connect(hbp).connect(hg).connect(o);
    hg.gain.setValueAtTime(0.0001, th); hg.gain.exponentialRampToValueAtTime(0.5, th + 0.03);
    hg.gain.exponentialRampToValueAtTime(0.18, th + hd * 0.5); hg.gain.exponentialRampToValueAtTime(0.0001, th + hd);
    hs.start(th, Math.random() * 3); hs.stop(th + hd + 0.05);
    this.burst(o, th, { buf: this.pink, type: 'lowpass', f: 600, q: 0.6, peak: 0.45, a: 0.01, d: 0.4 });
    this.thud(o, th + hd * 0.6, 40, 0.18);
  }

  // The blast doors' two leaves rolling apart (or together) on their rails: a jolt as the drive takes up, a heavy
  // rumble lumbering on the rollers, a low grinding note and the rollers' rattle quickening and slowing with the
  // speed, the odd shriek of steel and some grit, then the stop: a deep thud with the leaves ringing (opening), or a
  // final boom echoing back off the cliffs (closing). duration (s): from the jolt to the stop.
  sfx_hatchSlide({ pos, duration = 2.4, open = true }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const D = Math.max(0.6, +duration || 2.4), te = t + D;
    const o = this.gain(LEVEL.hatch);
    o.connect(this.out(pos, 12, 0.9));
    this.thud(o, t, 58, 0.55);
    this.ring(o, t, R(150, 175), [[1, 0.5, 0.35], [2.6, 0.3, 0.2]], 0.15);
    // The run, all following the leaves' speed (quick to get going, slowing in): the rumble, lumbering; the rollers'
    // rattle; steel grinding on the rails (a rough band of noise with a low note under it).
    const rum = this.src(this.brown), lum = this.gain(1), rg = this.gain(0);
    rum.connect(this.filter('lowpass', 150, 0)).connect(lum).connect(rg).connect(o);
    const m = ac.createBufferSource(); m.buffer = this.fireMod; m.loop = true; m.playbackRate.value = R(1.1, 1.5);
    m.connect(this.gain(0.35)).connect(lum.gain);
    const rat = this.src(this.pink), rbp = this.filter('bandpass', 620, 1.3), ram = this.gain(0.55), rgn = this.gain(0);
    const chop = ac.createOscillator(); chop.type = 'square';
    chop.connect(this.gain(0.45)).connect(ram.gain);
    rat.connect(rbp).connect(ram).connect(rgn).connect(o);
    const fr = this.src(this.pink), fbp = this.filter('bandpass', 240, 0.9), fam = this.gain(1), fg = this.gain(0);
    const fm = ac.createBufferSource(); fm.buffer = this.fireMod; fm.loop = true; fm.playbackRate.value = R(7, 10);
    fm.connect(this.gain(0.5)).connect(fam.gain);
    fr.connect(fbp).connect(fam).connect(fg).connect(o);
    const grind = ac.createOscillator(); grind.type = 'sawtooth';
    const gg = this.gain(0);
    grind.connect(this.filter('lowpass', 300, 0)).connect(gg).connect(o);
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, tt = t + u * D, v = Math.pow(Math.sin(Math.PI * u), 0.6), at = i ? 'linearRampToValueAtTime' : 'setValueAtTime';
      grind.frequency[at](30 + 18 * v, tt);
      chop.frequency[at](9 + 17 * v, tt);
      rbp.frequency[at](420 + 380 * v, tt);
      fbp.frequency[at](190 + 140 * v, tt);
      rg.gain[at](i === 12 ? 0 : 1.4 * (0.2 + 0.8 * v), tt);
      rgn.gain[at](1.25 * v, tt);
      fg.gain[at](0.9 * v, tt);
      gg.gain[at](0.12 * v, tt);
    }
    [grind, chop].forEach((x) => { x.start(t); x.stop(te + 0.05); });
    [rum, rat, fr].forEach((x) => { x.start(t, Math.random() * 3); x.stop(te + 0.05); });
    fm.start(t, Math.random() * 60); fm.stop(te + 0.05);
    m.start(t, Math.random() * 60); m.stop(te + 0.05);
    if (Math.random() < 0.7) this.creak(o, t + R(0.2, 0.45) * D, D * R(0.25, 0.4), R(150, 210), 0.08);
    if (Math.random() < 0.4) this.creak(o, t + R(0.4, 0.6) * D, D * 0.2, R(260, 330), 0.04);
    const grit = this.gain(0.6);
    grit.connect(this.filter('lowpass', 2600, 0)).connect(o);
    for (let k = Math.round(D * 6); k > 0; k--) this.grain(grit, t + R(0.1, 0.95) * D, Math.random() < 0.6 ? 'crackle' : 'tick', R(0.5, 0.8), R(0.3, 0.8));
    if (open) {
      this.thud(o, te, 42, 1.0);
      this.burst(o, te, { buf: this.brown, type: 'lowpass', f: 160, q: 0.6, peak: 0.9, a: 0.003, d: 0.9 });
      this.burst(o, te, { f: R(500, 700), q: 0.9, peak: 0.3, a: 0.001, d: 0.08 });
      this.ring(o, te, R(68, 78), [[1, 0.5, 1.4], [2.21, 0.35, 1.0], [3.73, 0.22, 0.7], [5.3, 0.12, 0.45], [7.9, 0.06, 0.3]], 0.45);
      const ec = this.gain(0.25);
      ec.connect(this.filter('lowpass', 700, 0)).connect(o);
      this.thud(ec, te + R(0.24, 0.3), 42, 0.9);
    } else {
      this.thud(o, te, 34, 0.9);
      this.thud(o, te + 0.012, 58, 0.6);
      this.burst(o, te, { buf: this.brown, type: 'lowpass', f: 120, q: 0.6, peak: 0.7, a: 0.004, d: 2.2 });
      this.burst(o, te, { buf: this.pink, type: 'lowpass', f: 900, q: 0.5, peak: 0.5, a: 0.002, d: 0.35 });
      this.burst(o, te, { f: R(380, 520), q: 1, peak: 0.4, a: 0.001, d: 0.1 });
      this.ring(o, te, R(52, 60), [[1, 0.5, 2.2], [2.21, 0.35, 1.6], [3.73, 0.22, 1.1], [5.3, 0.12, 0.7], [7.9, 0.07, 0.45]], 0.5);
      for (const [dt, a, f] of [[0.33, 0.35, 600], [0.78, 0.2, 420], [1.4, 0.11, 300]]) {
        const ec = this.gain(a);
        ec.connect(this.filter('lowpass', f, 0)).connect(o);
        this.thud(ec, te + dt * R(0.92, 1.08), 34, 1.1);
        this.burst(ec, te + dt, { buf: this.brown, type: 'lowpass', f: 160, q: 0.6, peak: 0.6, a: 0.01, d: 0.8 });
      }
    }
  }

  // One section of the gatehouse stairs running out (sequences/stairsReveal.js plays one per section): a short rolling
  // scrape of steel along its channel, sometimes a little squeal, then the latch: a clank with the grating ringing,
  // the pawl dropping in a beat later, and the slap of it back off the cliff.
  sfx_stairExtend({ pos }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.stairExtend);
    o.connect(this.out(pos, 8, 1));
    const d = R(0.2, 0.3), tl = t + d;
    const s = this.src(this.white), bp = this.filter('bandpass', 1300, 2.2), am = this.gain(0.6), g = this.gain(0);
    bp.frequency.setValueAtTime(R(1100, 1400), t); bp.frequency.exponentialRampToValueAtTime(R(1800, 2400), tl);
    const rat = ac.createOscillator(); rat.type = 'square';
    rat.frequency.setValueAtTime(R(30, 40), t); rat.frequency.linearRampToValueAtTime(R(50, 64), tl);
    rat.connect(this.gain(0.4)).connect(am.gain);
    s.connect(bp).connect(am).connect(g).connect(o);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.04);
    g.gain.setValueAtTime(0.22, tl - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, tl + 0.02);
    s.start(t, Math.random() * 3); s.stop(tl + 0.05); rat.start(t); rat.stop(tl + 0.05);
    this.burst(o, t, { buf: this.brown, type: 'lowpass', f: 260, q: 0.6, peak: 0.35, a: 0.03, d });
    if (Math.random() < 0.5) this.tone(o, t + d * 0.3, R(2600, 3400), R(2900, 3800), 0.012, d * 0.3, d * 0.4);
    const k = R(0.9, 1.1);
    const clank = (dst, tt) => {
      this.thud(dst, tt, 92 * k, 0.5);
      this.burst(dst, tt, { f: R(2200, 2800), q: 1, peak: 0.4, a: 0.0005, d: 0.015 });
      this.ring(dst, tt, 300 * k, [[1, 0.5, 0.35], [2.74, 0.3, 0.22], [5.12, 0.16, 0.14], [8.4, 0.08, 0.09]], 0.3);
    };
    clank(o, tl);
    const tp = tl + R(0.035, 0.06);
    this.burst(o, tp, { f: R(3000, 3600), q: 3, peak: 0.22, a: 0.0005, d: 0.01 });
    this.ring(o, tp, R(1900, 2300), [[1, 0.5, 0.08], [1.5, 0.3, 0.05]], 0.06);
    const ec = this.gain(0.18);
    ec.connect(this.filter('lowpass', 1200, 0)).connect(o);
    clank(ec, tl + R(0.18, 0.26));
  }

  // A section of the stairs giving way behind the player (props/gatehouse.js): the steel straining as it tears, a
  // shriek, two bolts snapping, a clatter as it tips, then the whoosh of it falling away end over end and out of
  // hearing below (no landing: it drops through the cloud).
  sfx_stairFall({ pos }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.stairFall);
    o.connect(this.out(pos, 5, 1));
    const ts = t + R(0.22, 0.38);
    // Straining: two stick-slipping voices through narrow bands, rising.
    for (let k = 0; k < 2; k++) {
      const f0 = R(130, 210) * (k ? 1.7 : 1);
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f0 * R(1.4, 2), ts);
      const jit = ac.createOscillator(); jit.type = 'square'; jit.frequency.value = R(24, 46);
      jit.connect(this.gain(f0 * 0.15)).connect(osc.frequency);
      const g = this.gain(0), pk = k ? 0.12 : 0.2;
      osc.connect(this.filter('bandpass', f0 * R(5, 7), 6)).connect(g).connect(o);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk * 0.3, t + 0.06);
      g.gain.linearRampToValueAtTime(pk, ts - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.04);
      [osc, jit].forEach((x) => { x.start(t); x.stop(ts + 0.06); });
    }
    // The shriek of it tearing, two strands of it.
    for (let k = 0; k < 2; k++) {
      const fs = R(1500, 2600), t0 = Math.max(t, ts - R(0.2, 0.26));
      const sh = ac.createOscillator(); sh.type = 'sawtooth';
      sh.frequency.setValueAtTime(fs, t0); sh.frequency.exponentialRampToValueAtTime(fs * R(1.15, 1.4), ts);
      const sj = ac.createOscillator(); sj.frequency.value = R(45, 85);
      sj.connect(this.gain(fs * 0.035)).connect(sh.frequency);
      const sg = this.gain(0), pk = k ? 0.12 : 0.2;
      sh.connect(this.filter('bandpass', fs * 1.1, 2.5)).connect(sg).connect(o);
      sg.gain.setValueAtTime(0.0001, t0); sg.gain.exponentialRampToValueAtTime(pk * 0.4, t0 + 0.05);
      sg.gain.linearRampToValueAtTime(pk, ts - 0.01); sg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.06);
      [sh, sj].forEach((x) => { x.start(t0); x.stop(ts + 0.08); });
    }
    // The bolts snap.
    this.burst(o, ts, { type: 'highpass', f: 1500, q: 0.7, peak: 0.9, a: 0.0004, d: 0.03 });
    this.burst(o, ts, { f: R(2400, 3200), q: 1.2, peak: 0.5, a: 0.0005, d: 0.06 });
    this.ring(o, ts, R(1900, 2600), [[1, 0.5, 0.25], [1.52, 0.3, 0.18], [2.37, 0.2, 0.12]], 0.12);
    this.thud(o, ts, R(75, 95), 0.5);
    const ts2 = ts + R(0.02, 0.06);
    this.burst(o, ts2, { type: 'highpass', f: 1800, q: 0.7, peak: 0.55, a: 0.0004, d: 0.025 });
    this.grain(o, ts2, 'snap', R(0.8, 1.1), 0.6);
    // Tipping over: its loose end clattering.
    for (let k = 2 + Math.floor(Math.random() * 3); k > 0; k--) {
      const tk = ts + R(0.08, 0.45);
      this.ring(o, tk, R(260, 420), [[1, 0.5, 0.25], [2.7, 0.3, 0.15], [5.1, 0.15, 0.09]], R(0.06, 0.14));
      this.thud(o, tk, R(90, 130), R(0.15, 0.3));
    }
    // The fall: a whoosh pulsing as it tumbles, sinking in pitch and dulling as it drops away.
    const tf = ts + 0.15, fd = R(2.6, 3.2);
    const fall = this.gain(1), away = this.filter('lowpass', 6000, 0);
    away.frequency.setValueAtTime(6000, tf); away.frequency.exponentialRampToValueAtTime(350, tf + fd);
    fall.connect(away).connect(o);
    const w = this.src(this.pink), wbp = this.filter('bandpass', 1000, 0.8), tumble = this.gain(0.6), wg = this.gain(0);
    wbp.frequency.setValueAtTime(R(900, 1300), tf); wbp.frequency.exponentialRampToValueAtTime(R(200, 260), tf + fd);
    const tb = ac.createOscillator();
    tb.frequency.setValueAtTime(R(2.6, 3.6), tf); tb.frequency.linearRampToValueAtTime(R(1.6, 2.2), tf + fd);
    tb.connect(this.gain(0.4)).connect(tumble.gain);
    w.connect(wbp).connect(tumble).connect(wg).connect(fall);
    wg.gain.setValueAtTime(0.0001, tf); wg.gain.exponentialRampToValueAtTime(0.5, tf + 0.35); wg.gain.exponentialRampToValueAtTime(0.0001, tf + fd);
    w.start(tf, Math.random() * 3); w.stop(tf + fd + 0.05); tb.start(tf); tb.stop(tf + fd + 0.05);
    const lo = this.src(this.brown), lg = this.gain(0);
    lo.connect(this.filter('lowpass', 180, 0)).connect(lg).connect(fall);
    lg.gain.setValueAtTime(0.0001, tf); lg.gain.exponentialRampToValueAtTime(0.4, tf + 0.25); lg.gain.exponentialRampToValueAtTime(0.0001, tf + fd * 0.8);
    lo.start(tf, Math.random() * 3); lo.stop(tf + fd);
    for (let k = 0; k < 4; k++) {
      const tk = tf + R(0.1, fd * 0.6);
      this.ring(fall, tk, R(700, 1500), [[1, 0.5, 0.1], [2.3, 0.3, 0.06]], R(0.02, 0.05) * (1 - (tk - tf) / fd));
    }
  }

  // The End pedestal's big red button (props/pedestal.js): the cap's travel and the switch's snap, a hollow bottoming
  // thock, a relay chunking over a beat later with a thrum of power, and the cap springing back.
  sfx_pedestalButton({ pos }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const o = this.gain(LEVEL.pedestalButton);
    o.connect(this.out(pos, 2));
    this.burst(o, t, { f: R(2400, 3200), q: 1.4, peak: 0.25, a: 0.0006, d: 0.012 });
    const tb = t + R(0.012, 0.02);
    this.burst(o, tb, { f: R(380, 460), q: 4, peak: 1.0, a: 0.0008, d: 0.07 });
    this.tone(o, tb, R(150, 170), 85, 0.22, 0.001, 0.08);
    this.burst(o, tb, { f: R(4000, 4800), q: 2, peak: 0.12, a: 0.0004, d: 0.008 });
    const tr = tb + R(0.06, 0.09);
    this.burst(o, tr, { f: R(1000, 1250), q: 2, peak: 0.35, a: 0.0006, d: 0.025 });
    this.thud(o, tr, 95, 0.3);
    this.ring(o, tr, R(1700, 2000), [[1, 0.5, 0.12], [2.4, 0.25, 0.07]], 0.05);
    const hum = ac.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55;
    const hg = this.gain(0); hum.connect(this.filter('lowpass', 320, 0)).connect(hg).connect(o);
    this.env(hg, tr + 0.01, 0.06, 0.12, 0.6);
    hum.start(tr); hum.stop(tr + 0.75);
    const tu = tb + R(0.24, 0.32);
    this.burst(o, tu, { f: R(1600, 2200), q: 2, peak: 0.12, a: 0.0006, d: 0.012 });
    this.burst(o, tu + 0.003, { f: R(480, 600), q: 4, peak: 0.35, a: 0.0008, d: 0.035 });
  }

  // The pedestal swallowed into its hole (props/pedestal.js): a latch let go, then a hydraulic ram lowering it (the
  // motor's growl and whine, oil gurgling through the valve, a bleed of air), stone grinding and grit trickling in
  // after it, all sinking out of earshot down the shaft, and a deep muffled thump as it bottoms out. duration (s):
  // from the latch to the thump.
  sfx_pedestalSink({ pos, duration = 2.6 }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const D = Math.max(1, +duration || 2.6), te = t + D, t1 = t + 0.05;
    const o = this.gain(LEVEL.pedestalSink);
    o.connect(this.out(pos, 4, 1));
    this.thud(o, t, 58, 0.55);
    this.ring(o, t, R(105, 125), [[1, 0.5, 0.45], [2.4, 0.3, 0.28], [4.1, 0.15, 0.15]], 0.2);
    const sink = this.gain(1), lp = this.filter('lowpass', 2600, 0);
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(420, te);
    sink.connect(lp).connect(o);
    const mot = ac.createOscillator(); mot.type = 'sawtooth';
    mot.frequency.setValueAtTime(48, t1); mot.frequency.linearRampToValueAtTime(40, te);
    const mg = this.gain(0);
    mot.connect(this.filter('lowpass', 150, 0)).connect(mg).connect(sink);
    const hum = ac.createOscillator();
    hum.frequency.setValueAtTime(100, t1); hum.frequency.linearRampToValueAtTime(90, te);
    const hmg = this.gain(0); hum.connect(hmg).connect(sink);
    const wh = ac.createOscillator();
    wh.frequency.setValueAtTime(320, t1); wh.frequency.linearRampToValueAtTime(250, te);
    const whg = this.gain(0); wh.connect(whg).connect(sink);
    const oil = this.src(this.pink), obp = this.filter('bandpass', 380, 1.2), og = this.gain(0);
    const m = ac.createBufferSource(); m.buffer = this.fireMod; m.loop = true; m.playbackRate.value = R(4, 6);
    m.connect(this.gain(120)).connect(obp.frequency);
    oil.connect(obp).connect(og).connect(sink);
    // the column grinding down past the stone: a rough low band of noise, scraping unevenly
    const gr = this.src(this.brown), gam = this.gain(1), grg = this.gain(0);
    const gm = ac.createBufferSource(); gm.buffer = this.fireMod; gm.loop = true; gm.playbackRate.value = R(8, 12);
    gm.connect(this.gain(0.6)).connect(gam.gain);
    gr.connect(this.filter('bandpass', 260, 0.8)).connect(gam).connect(grg).connect(sink);
    const hiss = this.src(this.white), hg = this.gain(0);
    hiss.connect(this.filter('highpass', 3200, 0)).connect(hg).connect(sink);
    for (const [g, v, a] of [[mg, 0.11, 0.35], [hmg, 0.08, 0.35], [whg, 0.02, 0.4], [og, 0.65, 0.3], [grg, 0.8, 0.45], [hg, 0.05, 0.3]]) {
      g.gain.setValueAtTime(0.0001, t1); g.gain.exponentialRampToValueAtTime(v, t + a);
      g.gain.setValueAtTime(v, te - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, te + 0.25);
    }
    [mot, hum, wh].forEach((x) => { x.start(t1); x.stop(te + 0.3); });
    [oil, hiss, gr].forEach((x) => { x.start(t1, Math.random() * 3); x.stop(te + 0.3); });
    [m, gm].forEach((x) => { x.start(t1, Math.random() * 60); x.stop(te + 0.3); });
    this.creak(sink, t + 0.2, D * 0.8, R(60, 72), 0.2);
    for (let k = 8 + Math.floor(Math.random() * 8); k > 0; k--) this.grain(sink, t + R(0.2, D), Math.random() < 0.7 ? 'tick' : 'crackle', R(0.5, 0.9), R(0.25, 0.6));
    // Bottoming out down the shaft: a deep muffled thump, the shaft booming with it, a dull clank.
    const bot = this.gain(1);
    bot.connect(this.filter('lowpass', 700, 0)).connect(o);
    this.thud(bot, te, 44, 0.9);
    this.burst(bot, te, { buf: this.brown, type: 'lowpass', f: 160, q: 0.6, peak: 0.7, a: 0.004, d: 0.6 });
    this.burst(bot, te, { buf: this.pink, type: 'bandpass', f: R(120, 150), q: 5, peak: 0.6, a: 0.004, d: 0.8 });
    this.ring(bot, te, R(95, 115), [[1, 0.5, 0.6], [2.3, 0.3, 0.35]], 0.18);
  }

  // Thunder (render/storm.js, which delays it for the distance). near (0..1): 1 is a strike close by, a ripping crack,
  // a huge boom and a long roll; 0 a far-off one, only a long low rumble swelling up, its highs lost in the air. pan
  // (-1..1): where it is, left to right; the roll comes from all along the bolt, so it spreads toward the middle.
  // Outdoors (muffled indoors like the rest, and gone underground: thunderBus), with its own echoes off the cloud: no
  // reverb.
  sfx_thunder({ near = 0.5, pan = 0 }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const n = clamp(+near || 0, 0, 1), p = clamp(+pan || 0, -1, 1), lvl = LEVEL.thunder * (0.8 + 0.2 * n);
    const o = this.gain(lvl), sp = ac.createStereoPanner();
    sp.pan.value = p;
    o.connect(this.filter('lowpass', 500 + 11000 * n * n, 0)).connect(sp).connect(this.thunderBus);
    const ro = this.gain(lvl), sp2 = ac.createStereoPanner();
    sp2.pan.setValueAtTime(p * 0.7, t); sp2.pan.linearRampToValueAtTime(p * 0.25, t + 6);
    ro.connect(this.filter('lowpass', 300 + 3000 * n, 0)).connect(sp2).connect(this.thunderBus);
    const dur = 6 + (1 - n) * 3 + R(-0.5, 1.5);
    // The crack: the channel tearing open, a fast crackle of rips, then the main stroke.
    const kc = clamp((n - 0.3) / 0.7, 0, 1);
    let tb = t + R(0, 0.3);
    if (kc > 0) {
      const rip = R(0.12, 0.35), m = 8 + Math.floor(Math.random() * 10);
      let tk = t;
      for (let i = 0; i < m; i++) {
        tk += R(0.004, rip / m * 2);
        const a = kc * R(0.15, 0.5) * (1 - i / m * 0.5);
        this.burst(o, tk, { type: 'highpass', f: R(900, 2600), q: 0.7, peak: a, a: 0.0004, d: R(0.008, 0.04) });
        if (Math.random() < 0.5) this.grain(o, tk, Math.random() < 0.5 ? 'snap' : 'crackle', R(0.5, 1), a * 1.5);
      }
      const ts = t + rip;
      this.burst(o, ts, { type: 'highpass', f: 700, q: 0.7, peak: 0.95 * kc, a: 0.0005, d: 0.09 });
      this.burst(o, ts, { f: 2200, q: 0.5, peak: 0.6 * kc, a: 0.0008, d: 0.35 });
      this.burst(o, ts + 0.012, { type: 'highpass', f: 1100, q: 0.7, peak: 0.5 * kc, a: 0.0005, d: 0.05 });
      tb = ts + 0.01;
    }
    // The boom (slow to swell when far).
    const atk = 0.06 + (1 - n) * 0.9;
    if (n > 0.2) this.tone(o, tb, 80, 30, 0.7 * n, 0.01, 1.6);
    this.burst(o, tb, { buf: this.brown, type: 'lowpass', f: 160, q: 0.6, peak: 0.9, a: 0.01 + (1 - n) * 0.5, d: 2.2 });
    this.burst(o, tb, { buf: this.pink, type: 'lowpass', f: 500 + 1200 * n, q: 0.5, peak: 0.1 + 0.6 * n, a: 0.008 + (1 - n) * 0.4, d: 0.9 });
    // The roll: noise lumbering about and darkening as it goes, a sub-bass weight under it, and later swells.
    const roll = this.src(this.pink), lp = this.filter('lowpass', 1200, 0.6), lum = this.gain(1), rg = this.gain(0);
    roll.connect(lp).connect(lum).connect(rg).connect(ro);
    lp.frequency.setValueAtTime(450 + 1350 * n, tb); lp.frequency.exponentialRampToValueAtTime(120 + 110 * n, tb + dur);
    rg.gain.setValueAtTime(0.0001, tb); rg.gain.exponentialRampToValueAtTime(0.55, tb + atk);
    rg.gain.exponentialRampToValueAtTime(0.3, tb + atk + dur * 0.3); rg.gain.exponentialRampToValueAtTime(0.06, tb + dur * 0.8);
    rg.gain.exponentialRampToValueAtTime(0.0001, tb + dur);
    const mod = ac.createBufferSource(); mod.buffer = this.fireMod; mod.loop = true; mod.playbackRate.value = R(1.8, 3);
    mod.connect(this.gain(0.6)).connect(lum.gain);
    const sub = this.src(this.brown), sg = this.gain(0);
    sub.connect(this.filter('lowpass', 90, 0.6)).connect(sg).connect(ro);
    sg.gain.setValueAtTime(0.0001, tb); sg.gain.exponentialRampToValueAtTime(0.8, tb + atk + 0.2); sg.gain.exponentialRampToValueAtTime(0.0001, tb + dur + 1);
    roll.start(tb, Math.random() * 3); roll.stop(tb + dur + 0.1);
    mod.start(tb, Math.random() * 60); mod.stop(tb + dur + 0.1);
    sub.start(tb, Math.random() * 3); sub.stop(tb + dur + 1.1);
    for (let k = 3 + Math.floor(Math.random() * 3); k > 0; k--) {
      const tk = tb + R(0.4, dur * 0.7), a = R(0.3, 0.7) * (1 - (tk - tb) / dur);
      this.burst(ro, tk, { buf: this.brown, type: 'lowpass', f: R(140, 260 + 500 * n), q: 0.6, peak: a, a: R(0.06, 0.35), d: R(0.6, 1.6) });
      this.burst(ro, tk, { buf: this.pink, type: 'lowpass', f: R(300, 500 + 900 * n), q: 0.5, peak: a * 0.5, a: R(0.05, 0.3), d: R(0.4, 1.1) });
    }
  }

  // The light shafts rising out of the aperture (sequences/ending.js): a deep chord swelling up (E with its fifth,
  // octaves and a major third on top), every voice a pair of oscillators a hair apart beating slowly, all gliding up
  // into tune as it rises while its tone opens out; a shimmer of high partials trembling in over the top; and a soft
  // rush of air rising with it. It peaks at `duration` s and dies away over a few seconds after.
  sfx_shaftSwell({ duration = 6 }, t) {
    const ac = this.ctx;
    const R = (a, b) => a + Math.random() * (b - a);
    const D = Math.max(1, +duration || 6), te = t + D, tail = 3.5, end = te + tail + 0.1;
    const out = this.gain(0);
    out.connect(this.route);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(LEVEL.shaftSwell * 0.3, t + D * 0.3);
    out.gain.linearRampToValueAtTime(LEVEL.shaftSwell, t + D * 0.85);
    out.gain.setValueAtTime(LEVEL.shaftSwell, te); out.gain.exponentialRampToValueAtTime(0.0001, te + tail);
    const lp = this.filter('lowpass', 160, 1);
    lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(4800, t + D * 0.9);
    lp.frequency.exponentialRampToValueAtTime(900, te + tail);
    lp.connect(out);
    for (const [f, a, type] of [[41.2, 0.35, 'sine'], [82.41, 0.5, 'triangle'], [123.47, 0.3, 'triangle'], [164.81, 0.26, 'triangle'],
      [246.94, 0.16, 'sine'], [329.63, 0.12, 'sine'], [415.3, 0.07, 'sine']]) {
      for (const side of [-1, 1]) {
        const osc = ac.createOscillator(); osc.type = type;
        const ff = f * (1 + side * R(0.0012, 0.0035));
        osc.frequency.setValueAtTime(ff * 0.982, t); osc.frequency.exponentialRampToValueAtTime(ff, t + D * 0.7);
        osc.connect(this.gain(a * 0.5)).connect(lp);
        osc.start(t); osc.stop(end);
      }
    }
    const sh = this.gain(0);
    sh.connect(out);
    sh.gain.setValueAtTime(0.0001, t + D * 0.2); sh.gain.exponentialRampToValueAtTime(1, t + D * 0.9);
    for (const f of [659.26, 987.77, 1318.5, 1661.2, 1975.5, 2637]) {
      const osc = ac.createOscillator(); osc.frequency.value = f * R(0.997, 1.003);
      const trem = this.gain(0.65), lfo = ac.createOscillator();
      lfo.frequency.value = R(3, 7);
      lfo.connect(this.gain(0.35)).connect(trem.gain);
      osc.connect(trem).connect(this.gain(0.08 * R(0.6, 1) * Math.sqrt(659 / f))).connect(sh);
      [osc, lfo].forEach((x) => { x.start(t); x.stop(end); });
    }
    const air = this.src(this.pink), abp = this.filter('bandpass', 260, 1.2), ag = this.gain(0);
    abp.frequency.setValueAtTime(260, t); abp.frequency.exponentialRampToValueAtTime(3200, te);
    air.connect(abp).connect(ag).connect(out);
    ag.gain.setValueAtTime(0.0001, t); ag.gain.exponentialRampToValueAtTime(0.35, t + D * 0.8); ag.gain.exponentialRampToValueAtTime(0.0001, te + tail * 0.8);
    air.start(t, Math.random() * 3); air.stop(end);
  }

  // The ending's alarm clock (sequences/ending.js): a cheap digital buzzer, a nasal pulse with a rough edge to it,
  // through a small speaker, going BZZT-BZZT-BZZT, rest (buzzGateBuffer), heard down the dream's long dark reverb
  // (buildDream). It starts faint, muffled and drowned in the reverb; the handle brings it up dry and present:
  //   setWet(v, tau = 0.3): the reverb's level, 0..1 (starts at 1)
  //   setDry(v, tau = 0.3): the direct sound, 0..1 (starts at 0.3), its tone opening out from muffled to bright with it
  //   stop(fade = 0.05): everything, the reverb's tail too, to silence over `fade` s
  // level: the buzzer's loudness (0.5 sits with the other sounds). One alarm at a time: the reverb is shared.
  sfx_buzzAlarm({ level = 0.5 }, t) {
    const ac = this.ctx;
    const f0 = 496;
    const tone = ac.createOscillator(); tone.setPeriodicWave(this.buzzWave()); tone.frequency.value = f0;
    const saw = ac.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f0 * 2.004;
    const rough = this.gain(0.72), am = ac.createOscillator();
    am.type = 'square'; am.frequency.value = 62;
    am.connect(this.gain(0.28)).connect(rough.gain);
    tone.connect(rough); saw.connect(this.gain(0.16)).connect(rough);
    const gate = this.gain(0), gs = ac.createBufferSource();
    gs.buffer = this.buzzGate; gs.loop = true;
    gs.connect(gate.gain);
    const pk1 = this.filter('peaking', 1250, 1.2), pk2 = this.filter('peaking', 2700, 1.6);
    pk1.gain.value = 5; pk2.gain.value = 7;
    const voice = this.gain(Math.max(0, +level || 0) * LEVEL.buzz);
    rough.connect(gate).connect(this.gain(1.5)).connect(this.shaper(this.driveCurve()))
      .connect(this.filter('highpass', 450, 0)).connect(pk1).connect(pk2).connect(this.filter('lowpass', 6200, 0)).connect(voice);
    const top = (v) => 700 * Math.pow(18, v);   // the direct sound's tone: muffled when faint, bright at 1
    const dryLP = this.filter('lowpass', top(0.3), 0), dry = this.gain(0.3), out = this.gain(1);
    voice.connect(dryLP).connect(dry).connect(out).connect(this.route);
    voice.connect(this.dreamIn);
    const wet = this.dreamOut.gain;
    wet.cancelScheduledValues(t); wet.setValueAtTime(LEVEL.buzzWet, t);
    for (const x of [tone, saw, am, gs]) x.start(t);
    let stopped = false;
    const at = () => Math.max(this.now(), t);
    const tau = (x) => Math.max(0.005, +x || 0);
    return {
      setWet: (v, k = 0.3) => { if (!stopped) wet.setTargetAtTime(clamp(+v || 0, 0, 1) * LEVEL.buzzWet, at(), tau(k)); },
      setDry: (v, k = 0.3) => {
        if (stopped) return;
        const x = clamp(+v || 0, 0, 1), tt = at();
        dry.gain.setTargetAtTime(x, tt, tau(k));
        dryLP.frequency.setTargetAtTime(top(x), tt, tau(k));
      },
      stop: (fade = 0.05) => {
        if (stopped) return;
        stopped = true;
        const tt = at(), f = tau(fade);
        out.gain.setTargetAtTime(0, tt, f / 5);
        wet.setTargetAtTime(0, tt, f / 5);
        for (const x of [tone, saw, am, gs]) x.stop(tt + f * 1.6 + 0.02);
      },
    };
  }

  loop_scrape({ pos }) {
    const o = this.out(pos, 3);
    const s = this.src(this.pink); const bp = this.filter('bandpass', 320, 1.8); const g = this.gain(0);
    const jit = this.ctx.createOscillator(); jit.frequency.value = 13; const ja = this.gain(0.08); jit.connect(ja).connect(g.gain);
    s.connect(bp).connect(g).connect(o);
    g.gain.setTargetAtTime(0.35, this.now(), 0.05);
    s.start(); jit.start();
    return {
      setPos: (p) => o.positionX && this.setPos(o, p),
      stop: () => { g.gain.setTargetAtTime(0, this.now(), 0.08); s.stop(this.now() + 0.5); jit.stop(this.now() + 0.5); },
    };
  }

  loop_domeRumble({ pos }) {
    const o = this.out(pos, 5);
    const s = this.src(this.brown); const lp = this.filter('lowpass', 130); const g = this.gain(0);
    const whine = this.ctx.createOscillator(); whine.frequency.value = 210; const wg = this.gain(0.03);
    s.connect(lp).connect(g).connect(o); whine.connect(wg).connect(g);
    g.gain.setTargetAtTime(0.5, this.now(), 0.1);
    s.start(); whine.start();
    return { stop: () => { g.gain.setTargetAtTime(0, this.now(), 0.15); s.stop(this.now() + 0.8); whine.stop(this.now() + 0.8); } };
  }

  loop_fallWind() {
    const s = this.src(this.pink); const bp = this.filter('bandpass', 400, 0.6); const g = this.gain(0);
    const s2 = this.src(this.white); const hp = this.filter('highpass', 2500); const g2 = this.gain(0);
    s.connect(bp).connect(g).connect(this.master); s2.connect(hp).connect(g2).connect(this.master);
    s.start(); s2.start();
    return {
      set: (k) => {
        const now = this.now();
        g.gain.setTargetAtTime(k * 0.9, now, 0.1); g2.gain.setTargetAtTime(k * 0.25, now, 0.1);
        bp.frequency.setTargetAtTime(300 + k * 1500, now, 0.1);
      },
      stop: () => { const now = this.now(); g.gain.setTargetAtTime(0, now, 0.3); g2.gain.setTargetAtTime(0, now, 0.3); s.stop(now + 2); s2.stop(now + 2); },
    };
  }

  // ---------- per-frame ----------
  update(dt, camera, env) {
    if (!this.ctx) return;
    const ac = this.ctx, now = this.now();
    const L = ac.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, now); L.positionY.setValueAtTime(p.y, now); L.positionZ.setValueAtTime(p.z, now);
      L.forwardX.setValueAtTime(f.x, now); L.forwardY.setValueAtTime(f.y, now); L.forwardZ.setValueAtTime(f.z, now);
      L.upX.setValueAtTime(u.x, now); L.upY.setValueAtTime(u.y, now); L.upZ.setValueAtTime(u.z, now);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    this.feedIdle();

    const under = env.zone === 'tunnel';
    // Indoors: outdoor ambience drops and loses its highs, as if through walls and glass.
    const indoor = !!env.indoor;
    // Sealed (env.sealed, 0..1 (or a flag): how far into a room deep under the ground, the Tower's bunker): the outside
    // barely gets in at all. Graded, so going down from its open door the outside closes in step by step (evenly in
    // loudness and in the cut-off's pitch).
    const sealed = clamp(+env.sealed || 0, 0, 1);
    const og = indoor ? 0.32 : 1, olp = indoor ? 900 : 20000;
    this.outdoor.gain.setTargetAtTime(og * Math.pow(0.05 / og, sealed), now, 0.35);
    this.outdoorLP.frequency.setTargetAtTime(olp * Math.pow(320 / olp, sealed), now, 0.35);
    const muted = env.muted ?? 0;
    this.altDeg = env.altDeg ?? 0;
    const surf = under ? 0 : 1 - muted;
    // The storm (setStorm), eased. At 0 everything below is the plain wind.
    this.stormLevel += (this.stormTarget - this.stormLevel) * Math.min(1, dt * 0.6);
    if (Math.abs(this.stormTarget - this.stormLevel) < 1e-4) this.stormLevel = this.stormTarget;
    const storm = this.stormLevel;
    // Wind gusts: a slow random walk (in a storm quicker, stronger, and never dropping to a calm).
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = (2 + Math.random() * 6) * (1 - storm * 0.6);
      this.gustTarget = 0.15 + storm * 0.3 + Math.random() * Math.random() * (0.85 + storm * 0.2);
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * (0.35 + storm * 0.65));
    const windAmt = (0.05 + this.gust * 0.2) * (1 + storm * STORM_WIND) * surf * (env.inCar ? 0.25 : 1);
    this.windGain.gain.setTargetAtTime(windAmt, now, 0.3);
    this.windLP.frequency.setTargetAtTime(280 + this.gust * 900 + storm * 500, now, 0.4);
    this.windBP.frequency.setTargetAtTime(1300 + this.gust * 1600 + storm * 400, now, 0.6);
    this.whistle.gain.setTargetAtTime(0.08 + storm * 0.14, now, 0.5);
    this.windPan.pan.setTargetAtTime(Math.sin(now * 0.07) * 0.5, now, 1);
    this.stormBed(now, storm, surf * (env.inCar ? 0.25 : 1));
    // Under the dome's glass (house + garden): a hard cut plus a low-pass, ramped over ~0.6 s as the player
    // crosses the boundary so it never clicks or jumps. Applies only to wind; the cabin's indoor treatment
    // (outdoor bus gain/LP above) still applies on top of this when env.indoor is also set, so the house stays
    // at least as quiet as the dome garden.
    const dome = !!env.underDome;
    this.windDomeGain.gain.setTargetAtTime(dome ? DOME_WIND_GAIN : 1, now, 0.2);
    this.windDomeLP.frequency.setTargetAtTime(dome ? DOME_WIND_LP : 20000, now, 0.2);

    // Crickets from dusk to dawn, following the listener at a distance.
    const cr = clamp((6 - env.altDeg) / 10, 0, 1) * surf * (env.inCar ? 0.3 : 1);
    this.cricketBus.gain.setTargetAtTime(cr * 0.9, now, 1);
    for (const c of this.crickets) {
      c.timer -= dt;
      if (c.timer <= 0) { c.timer = 15 + Math.random() * 25; c.offset.set((Math.random() - 0.5) * 36, -1.5, (Math.random() - 0.5) * 36); }
      this.setPos(c.pan, new THREE.Vector3(env.ground.x + c.offset.x, env.ground.y + c.offset.y, env.ground.z + c.offset.z));
    }
    const day = clamp((env.altDeg - 2) / 15, 0, 1);
    this.dayBugs.gain.setTargetAtTime(0.012 * day * surf, now, 1);

    // Birds: busiest in daylight, thinning out through dusk.
    const birdiness = clamp((env.altDeg + 3) / 10, 0, 1) * surf;
    this.birdTimer -= dt * (0.3 + birdiness);
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.2 + Math.random() * 5;
      if (birdiness > 0.05 && Math.random() < birdiness + 0.1) this.bird(env.ground, birdiness);
    }

    // Cave bed + drips + reverb amount. The lounge under the Tower (env.room) is a dry, quiet room: no drips.
    const room = under && !!env.room;
    this.caveGain.gain.setTargetAtTime(under ? (room ? 0.04 : 0.22) : 0, now, 0.5);
    this.reverbSend.gain.setTargetAtTime(room ? 0.14 : under ? 0.75 : env.inCar ? 0.2 : (indoor ? 0.16 : 0.1) * (1 - sealed) + 0.2 * sealed, now, 0.5);
    if (under && !room) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.7 + Math.random() * 3.5;
        this.play('drip', { pos: new THREE.Vector3(p.x + (Math.random() - 0.5) * 16, p.y + 2, p.z + (Math.random() - 0.5) * 16) });
      }
    }

    // Emitters: gate by zone and distance.
    for (const e of this.emitters) {
      if (!e.node) continue;
      const d = e.pos.distanceTo(p);
      const on = !e.off && e.zone === env.zone && d < (e.range ?? 140);
      e.node.gain.setTargetAtTime(on ? e.level * (e.mul ?? 1) * (1 - muted) : 0, now, e.off ? 0.12 : 0.4);
      if (on && e.tick) e.tick(dt);
    }
  }

  // The storm's bed (buildStorm), each frame from update(): plugged in and started with the first storm, unplugged
  // again a few seconds after it has gone. s: the storm (eased); k: how much of the outdoors reaches the listener (0
  // underground, low in an elevator car; thunder is held to it too). The rain swells and brightens a little with the
  // gusts; the howl follows them.
  stormBed(now, s, k) {
    if (k !== this.stormK) { this.stormK = k; this.thunderBus.gain.setTargetAtTime(k, now, 0.3); }
    if (s > 0.001) {
      if (!this.stormStarted) { for (const n of this.stormSrcs) n.start(0, Math.random() * 3); this.stormStarted = true; }
      if (!this.stormLive) { this.stormBus.connect(this.outdoor); this.stormLive = true; }
      this.stormIdleAt = now + 3;
    } else if (this.stormLive && now > this.stormIdleAt) {
      this.stormBus.disconnect(this.outdoor);
      this.stormLive = false;
    }
    if (!this.stormLive) return;
    const r = s * k, g = Math.min(1.4, this.gust), breath = 0.85 + 0.2 * g;
    this.rainHiss.gain.setTargetAtTime(RAIN.hiss * r * breath, now, 0.4);
    this.rainHissLP.frequency.setTargetAtTime(6500 + 2500 * g, now, 0.6);
    this.rainBody.gain.setTargetAtTime(RAIN.body * r * breath, now, 0.4);
    this.rainDrum.gain.setTargetAtTime(RAIN.drum * r, now, 0.6);
    this.rainPat.gain.setTargetAtTime(RAIN.patter * Math.pow(r, 1.3), now, 0.4);
    this.rainMetal.gain.setTargetAtTime(RAIN.metal * Math.pow(r, 1.5), now, 0.4);
    this.howl.gain.setTargetAtTime(RAIN.howl * r * Math.max(0, g - 0.25), now, 0.5);
    const hf = 440 + g * 380;
    this.howlBP.frequency.setTargetAtTime(hf, now, 0.9);
    this.howlBP2.frequency.setTargetAtTime(hf * 1.63, now, 1.1);
    this.howlPan.pan.setTargetAtTime(Math.sin(now * 0.11 + 1) * 0.6, now, 1);
  }

  bird(center, amt) {
    const ac = this.ctx, t = this.now() + 0.05;
    const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 30;
    const pos = new THREE.Vector3(center.x + Math.cos(a) * d, center.y + 4 + Math.random() * 8, center.z + Math.sin(a) * d);
    const o = this.panner(pos, 6, 1);
    o.connect(this.outdoor);
    const vol = 0.07 * (0.5 + amt * 0.5);
    const kind = Math.floor(Math.random() * 4);
    const note = (start, f0, f1, dur, level = 1, fm = 0) => {
      const osc = ac.createOscillator();
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
      if (fm) {
        const m = ac.createOscillator(); m.frequency.value = fm; const mg = this.gain(f0 * 0.08);
        m.connect(mg).connect(osc.frequency); m.start(start); m.stop(start + dur + 0.02);
      }
      const g = this.gain(0);
      osc.connect(g).connect(o);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol * level, start + Math.min(0.02, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.start(start); osc.stop(start + dur + 0.02);
    };
    if (kind === 0) { // whistled glides
      const n = 2 + Math.floor(Math.random() * 3), f = 2600 + Math.random() * 1200;
      for (let i = 0; i < n; i++) note(t + i * 0.32, f * (1 + i * 0.05), f * 0.8, 0.24);
    } else if (kind === 1) { // trill
      const n = 6 + Math.floor(Math.random() * 10), f = 3800 + Math.random() * 1600;
      for (let i = 0; i < n; i++) note(t + i * 0.055, f, f * 0.85, 0.04, 0.7, 90);
    } else if (kind === 2) { // two-note call
      const f = 3500 + Math.random() * 800;
      note(t, f, f * 1.02, 0.18); note(t + 0.25, f * 0.8, f * 0.78, 0.26);
    } else { // chips
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) note(t + i * (0.12 + Math.random() * 0.2), 5200 + Math.random() * 1500, 4200, 0.05, 0.8);
    }
  }
}
