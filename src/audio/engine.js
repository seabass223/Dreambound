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
      // Crackling fire: a soft roar plus random pops. The garden fire pit sits on the outdoor bus.
      const s = this.src(this.brown);
      const lp = this.filter('lowpass', e.name === 'fire' ? 380 : 520, 0.6);
      s.connect(lp).connect(this.gain(0.6)).connect(g);
      const c = this.src(this.white);
      const bp = this.filter('bandpass', 2600, 1.2);
      const cg = this.gain(0);
      const pop = ac.createOscillator(); pop.type = 'square'; pop.frequency.value = 11.3;
      const pop2 = ac.createOscillator(); pop2.type = 'square'; pop2.frequency.value = 3.7;
      const pa = this.gain(0.12), pb = this.gain(0.1);
      pop.connect(pa).connect(cg.gain); pop2.connect(pb).connect(cg.gain);
      c.connect(bp).connect(cg).connect(g);
      [s, c, pop, pop2].forEach((n) => n.start());
      e.level = e.name === 'fire' ? 0.3 : 0.24;
      e.range = e.name === 'fire' ? 14 : 18;
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
    const noise = (freq, q, peak, dur, buf = this.white) => {
      const s = this.src(buf, false, 0.8 + Math.random() * 0.4); const bp = this.filter('bandpass', freq * (0.85 + Math.random() * 0.3), q); const g = this.gain(0);
      s.connect(bp).connect(g).connect(o); this.env(g, t, 0.006, peak * v, dur); s.start(t); s.stop(t + dur + 0.1);
    };
    if (surface === 'grass') { noise(3200, 0.6, 0.05, 0.12); noise(900, 1, 0.03, 0.08); }
    else if (surface === 'dirt') { noise(1200, 0.8, 0.07, 0.1); noise(2800, 1.2, 0.04, 0.06); }
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
