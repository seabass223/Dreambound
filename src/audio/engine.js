import * as THREE from 'three';
import { clamp } from '../core/rng.js';

// Under the geodesic dome (the house and its garden, env.underDome) the glass cuts outside wind hard and dulls
// what gets through, like hearing it through a window: roughly -16 dB and a low-pass down to 750 Hz.
const DOME_WIND_GAIN = 0.158; // 10^(-16/20)
const DOME_WIND_LP = 750;     // Hz

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
      fireMod: this.fireModBuffer(),
      fireGrains: this.fireGrainBank(rate),
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
    this.world.connect(this.master);
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

    this.buildWind();
    this.buildInsects();
    this.buildCave();
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
    const bp = (x, f, Q) => {                       // in-place constant-peak band-pass
      const w = 2 * Math.PI * f / rate, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
      const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
      }
      return x;
    };
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
    const whistle = this.gain(0.08);
    this.windPan = ac.createStereoPanner();
    a.connect(this.windLP).connect(this.windPan).connect(this.windGain);
    b.connect(this.windBP).connect(whistle).connect(this.windPan);
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

  // ---------- emitters ----------
  // extra carries per-emitter data the synthesis needs (e.g. the frogs' bank spots).
  registerEmitter(name, pos, zone, extra = {}) {
    const e = { name, pos: pos.clone(), zone, node: null, ...extra };
    this.emitters.push(e);
    if (this.ctx) this.startEmitter(e); else this.pending.push(e);
  }

  startEmitter(e) {
    const ac = this.ctx;
    const g = this.gain(0);
    const indoorSource = e.name === 'fire' || e.name === 'generator' || e.name === 'electronics' || e.name === 'roomtone';
    // Frogs pan every call from its own bank spot, so their g is only the zone/range gate into the bus.
    if (e.name === 'frogs') g.connect(this.outdoor);
    else {
      const ref = e.name === 'waterfall' ? 14 : e.name === 'cascade' ? 8 : e.name === 'generator' ? 5 : e.name === 'roomtone' ? 6 : 4;
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

    const under = env.zone === 'tunnel';
    // Indoors: outdoor ambience drops and loses its highs, as if through walls and glass.
    const indoor = !!env.indoor;
    this.outdoor.gain.setTargetAtTime(indoor ? 0.32 : 1, now, 0.35);
    this.outdoorLP.frequency.setTargetAtTime(indoor ? 900 : 20000, now, 0.35);
    const muted = env.muted ?? 0;
    this.altDeg = env.altDeg ?? 0;
    const surf = under ? 0 : 1 - muted;
    // Wind gusts: a slow random walk.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) { this.gustTimer = 2 + Math.random() * 6; this.gustTarget = 0.15 + Math.random() * Math.random() * 0.85; }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.35);
    const windAmt = (0.05 + this.gust * 0.2) * surf * (env.inCar ? 0.25 : 1);
    this.windGain.gain.setTargetAtTime(windAmt, now, 0.3);
    this.windLP.frequency.setTargetAtTime(280 + this.gust * 900, now, 0.4);
    this.windBP.frequency.setTargetAtTime(1300 + this.gust * 1600, now, 0.6);
    this.windPan.pan.setTargetAtTime(Math.sin(now * 0.07) * 0.5, now, 1);
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
    this.reverbSend.gain.setTargetAtTime(room ? 0.14 : under ? 0.75 : env.inCar ? 0.2 : indoor ? 0.16 : 0.1, now, 0.5);
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
      const on = e.zone === env.zone && d < (e.range ?? 140);
      e.node.gain.setTargetAtTime(on ? e.level * (1 - muted) : 0, now, 0.4);
      if (on && e.tick) e.tick(dt);
    }
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
