// The audio engine's rules, checked on a mock AudioContext: `node tools/audio/check.mjs` plays every sfx_* and loop_*
// that src/audio/engine.js has (with no options, with a position, and with every option set in jobs.mjs), runs
// update() through a day, a night, a storm, underground and each emitter, and fails on:
//   mock      a node type the game's headless test mocks don't have. They have Gain, BiquadFilter, Convolver,
//             BufferSource, Oscillator, ConstantSource, Panner, StereoPanner, DynamicsCompressor and PeriodicWave;
//             there is no WaveShaper (the engine's shaper() falls back to a plain gain), no Delay, no Analyser.
//   route     a source that reaches the output past the `world` bus (so an elevator's shut doors, or the camera feed,
//             would not touch it), or an outdoor bed (wind, crickets, birds, rain, thunder) that misses the `outdoor`
//             bus (so walls and the bunker would not muffle it). BYPASS below lists the few meant to.
//   exp0      an exponential ramp to 0 (the browser throws), or from 0 or across it (it holds, then jumps: a click)
//   past      an event, a start or a stop scheduled before the context's current time
//   unstopped a source started and never stopped (an oscillator or a looping buffer left running for good)
//   perframe  update() making nodes frame after frame (garbage and CPU for as long as the game runs)
//   other     anything else the browser would throw on or that is plainly a slip: a value or time that isn't finite,
//             a source started twice or stopped before it starts, connected but never started, a thrown error
// It exits 1 if anything fails.   Options: [name ...] only these sounds; -v every option set on its own row;
// --seed n (default 1); --plays k (default 6: how many times each option set is played, as plays differ);
// --engine <file> another copy of the engine (a commit's, as render.mjs --ref leaves it under out/.ref/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { AudioBufferLite, mulberry32 } from './wal.mjs';
import { JOBS, OPTIONS } from './jobs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let ENGINE = path.resolve(HERE, '../../src/audio/engine.js');
const MOCKED = ['Gain', 'BiquadFilter', 'Convolver', 'BufferSource', 'Oscillator', 'ConstantSource', 'Panner', 'StereoPanner', 'DynamicsCompressor'];
const SOURCES = new Set(['BufferSource', 'Oscillator', 'ConstantSource']);
// Each node's AudioParams and their defaults (a ramp's start value matters to the exp0 rule).
const PARAMS = {
  Gain: { gain: 1 }, BiquadFilter: { frequency: 350, detune: 0, Q: 1, gain: 0 }, BufferSource: { playbackRate: 1, detune: 0 },
  Oscillator: { frequency: 440, detune: 0 }, ConstantSource: { offset: 1 }, StereoPanner: { pan: 0 },
  Panner: { positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0 },
  DynamicsCompressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 },
  listener: { positionX: 0, positionY: 0, positionZ: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 },
};
// The sounds meant to reach the output without passing the world bus, and where they go instead.
const BYPASS = {
  step: 'near',        // the player's own feet: an elevator's doors never fade them
  ringing: 'master',   // in the player's head (the intro)
  fallWind: 'master',  // the rush of the fall: the same
};                     // and: opt.car (in the car with the player) -> near; opt.feed (made for the camera feed) -> feedOut
const OUTDOOR_BEDS = ['windGain', 'cricketBus', 'dayBugs', 'birdBus', 'stormBus', 'thunderBus'];
const PAST = { near: 'through the near bus', feed: 'through the feed output', master: 'straight into the master' };

const argv = process.argv.slice(2);
let SEED = 1, PLAYS = 6, VERBOSE = false;
const only = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-v' || argv[i] === '--verbose') VERBOSE = true;
  else if (argv[i] === '--seed') SEED = +argv[++i];
  else if (argv[i] === '--plays') PLAYS = Math.max(1, +argv[++i] || 1);
  else if (argv[i] === '--engine') ENGINE = path.resolve(argv[++i]);
  else if (argv[i] === '--help' || argv[i] === '-h') { console.log('node tools/audio/check.mjs [name ...] [-v] [--seed n] [--plays k] [--engine file]   (the rules are at the top of the file and in README.md)'); process.exit(0); }
  else only.push(argv[i]);
}
Math.random = mulberry32(SEED);

// ---------- the mock ----------
let now = 0, seq = 0;
let scope = null;                    // what is being recorded: { bad: [{ rule, text }], nodes: [], params: Set }
const nodes = [];
const flag = (rule, text) => { scope?.bad.push({ rule, text }); };
const secs = (t) => `${t - now >= 0 ? '+' : ''}${(t - now).toFixed(3)} s`;

class MParam {
  constructor(owner, name, v) { this.owner = owner; this.name = name; this.v0 = v; this._v = v; this.ev = []; }
  get id() { return `${this.owner.kind}.${this.name}`; }
  get value() { return this._v; }
  set value(v) {
    if (!Number.isFinite(v)) flag('other', `${this.id}.value = ${v}`);
    this._v = v;
    if (this.ev.length) this.add('set', v, now); else this.v0 = v;
  }
  add(k, v, t, c) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) flag('other', `${this.id} ${k}(${v}, ${t}): not finite`);
    else if (t < now - 1e-9) flag('past', `${this.id} ${k} at ${secs(t)}`);
    if (k === 'exp' && v === 0) flag('exp0', `${this.id} exponential ramp to 0`);
    if (k === 'tgt' && !(c >= 0)) flag('other', `${this.id} setTargetAtTime with a time constant of ${c}`);
    if (this.ev.length > 600) this.ev.splice(0, 300);
    this.ev.push({ k, v, t, seq: seq++ });
    if (k === 'set' || k === 'lin' || k === 'exp' || k === 'tgt') this._v = v;
    scope?.params.add(this);
    return this;
  }
  setValueAtTime(v, t) { return this.add('set', v, t); }
  linearRampToValueAtTime(v, t) { return this.add('lin', v, t); }
  exponentialRampToValueAtTime(v, t) { return this.add('exp', v, t); }
  setTargetAtTime(v, t, c) { return this.add('tgt', v, t, c); }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); this.ev.push({ k: 'cancel', v: NaN, t, seq: seq++, seen: true }); return this; }
  // Exponential ramps not yet looked at: each one's start is the event before it in time (or the param's own value).
  ramps() {
    const ev = this.ev.slice().sort((p, q) => p.t - q.t || p.seq - q.seq);
    ev.forEach((e, i) => {
      if (e.k !== 'exp' || e.seen) return;
      e.seen = true;
      const p = ev[i - 1], from = !p ? this.v0 : p.k === 'tgt' || p.k === 'cancel' ? NaN : p.v;   // (after a target: somewhere on its way)
      if (from === 0) flag('exp0', `${this.id} exponential ramp from 0 (to ${+e.v.toPrecision(3)}): it holds at 0, then jumps`);
      else if (from * e.v < 0) flag('exp0', `${this.id} exponential ramp across 0 (${+from.toPrecision(3)} to ${+e.v.toPrecision(3)})`);
    });
  }
}

class MNode {
  constructor(kind) {
    this.kind = kind; this.outs = []; this.mods = []; this.n = nodes.length;
    for (const [k, v] of Object.entries(PARAMS[kind] || {})) this[k] = new MParam(this, k, v);
    nodes.push(this); scope?.nodes.push(this);
  }
  connect(to) {
    if (to instanceof MParam) this.mods.push(to); else if (to instanceof MNode) this.outs.push(to); else flag('other', `${this.kind}.connect(${to})`);
    return to;
  }
  disconnect(to) {
    if (to === undefined) { this.outs.length = 0; this.mods.length = 0; return; }
    for (const list of [this.outs, this.mods]) { const i = list.indexOf(to); if (i >= 0) list.splice(i, 1); }
  }
  setPosition() {} setOrientation() {}
}
class MSource extends MNode {
  constructor(kind) { super(kind); this.started = 0; this.stopped = 0; this.loop = false; }
  setPeriodicWave(w) { this.wave = w; }
  start(when = 0, offset, dur) {
    if (++this.started > 1) flag('other', `${this.kind} started twice`);
    if ([when, offset, dur].some((x) => x !== undefined && !(Number.isFinite(x) && x >= 0))) flag('other', `${this.kind}.start(${when}, ${offset}, ${dur})`);
    else if (when > 0 && when < now - 1e-9) flag('past', `${this.kind} started at ${secs(when)}`);
    this.startAt = Math.max(+when || 0, now);
    if (dur !== undefined) this.endAt = this.startAt + dur;
  }
  stop(when = 0) {
    if (!this.started) flag('other', `${this.kind} stopped before it was started`);
    if (!(Number.isFinite(when) && when >= 0)) flag('other', `${this.kind}.stop(${when})`);
    else if (when > 0 && when < now - 1e-9) flag('past', `${this.kind} stopped at ${secs(when)}`);
    const t = Math.max(+when || 0, now);
    if (this.startAt !== undefined && t <= this.startAt) flag('other', `${this.kind} stopped at or before its start`);
    this.stopped++;
    this.endAt = Math.min(this.endAt ?? Infinity, t);
  }
  get ends() { return this.endAt !== undefined || (this.kind === 'BufferSource' && !this.loop); }
}

const ac = {
  sampleRate: 48000, state: 'running', get currentTime() { return now; }, resume: () => Promise.resolve(),
  createBuffer: (ch, len, rate) => new AudioBufferLite({ numberOfChannels: ch, length: Math.floor(len), sampleRate: rate }),
  createPeriodicWave: () => ({}),
};
for (const k of MOCKED) ac['create' + k] = () => (SOURCES.has(k) ? new MSource(k) : new MNode(k));
ac.destination = new MNode('destination');
ac.listener = new MNode('listener');

// ---------- the engine ----------
const { AudioEngine } = await import(pathToFileURL(ENGINE).href);
const source = fs.readFileSync(ENGINE, 'utf8');
const names = (prefix) => Object.getOwnPropertyNames(AudioEngine.prototype).filter((k) => k.startsWith(prefix) && typeof AudioEngine.prototype[k] === 'function').map((k) => k.slice(prefix.length));
const SFX = names('sfx_'), LOOPS = names('loop_');
const EMITTERS = [...new Set([...source.matchAll(/e\.name === '(\w+)'/g)].map((m) => m[1]))];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = [3, 0, -4];
const real = (o) => (Array.isArray(o?.pos) ? { ...o, pos: V(...o.pos) } : { ...o });
const show = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)).replace(/"/g, '');
const ENV = { zone: 'surface', altDeg: 30, ground: V(0, -1.6, 0), inCar: false, indoor: false, room: false, muted: 0, underDome: false, sealed: 0 };
const cam = new THREE.PerspectiveCamera();
const A = new AudioEngine();

// Where a node's signal reaches the output: 'world', or past it by 'near', 'feed' or 'master'. outdoor: whether every
// way through the world bus also passes the outdoor bus.
function routes(start) {
  const out = { ways: new Set(), outdoor: true }, seen = new Set();
  const walk = (n, f) => {
    if (n === A.world) f |= 1; else if (n === A.near) f |= 2; else if (n === A.feedOut) f |= 4; else if (n === A.outdoor) f |= 8;
    const key = n.n * 16 + f;
    if (seen.has(key)) return;
    seen.add(key);
    if (n === ac.destination) { out.ways.add(f & 1 ? 'world' : f & 2 ? 'near' : f & 4 ? 'feed' : 'master'); if (!(f & 8)) out.outdoor = false; return; }
    for (const t of n.outs) walk(t, f);
  };
  walk(start, 0);
  return out;
}

// Runs fn with everything it makes and schedules recorded, then looks the recording over. allowed: the ways out its
// sources may take; lasting: its sources are meant to run for good (the beds).
function record(fn, { allowed = ['world'], lasting = false } = {}) {
  const s = scope = { bad: [], nodes: [], params: new Set() }, t0 = now;
  let result;
  try { result = fn(); } catch (e) {
    const m = /create(\w+) is not a function/.exec(e.message);
    if (m) flag('mock', `create${m[1]}(): the test mocks have no ${m[1]} node`);
    else flag('other', `threw ${e.constructor.name}: ${e.message}`);
  }
  for (const p of s.params) p.ramps();
  const srcs = s.nodes.filter((n) => n instanceof MSource), ways = new Set();
  let over = 0;
  for (const n of srcs) {
    const r = routes(n), wired = r.ways.size > 0 || n.mods.length > 0;
    for (const w of r.ways) { ways.add(w); if (!allowed.includes(w)) flag('route', `${n.kind} reaches the output ${PAST[w]}, past the world bus`); }
    if (!n.started) { if (wired && !lasting) flag('other', `${n.kind} connected but never started`); continue; }
    if (lasting) continue;
    if (!n.ends) flag('unstopped', `${n.kind}${n.loop ? ' (looping)' : ''} started and never stopped`);
    else if (Number.isFinite(n.endAt)) over = Math.max(over, n.endAt - t0);
  }
  scope = null;
  return { result, bad: s.bad, nodes: s.nodes.length, sources: srcs.length, ways, over };
}

// ---------- the table ----------
const rows = [];
const tally = (bad) => { const m = new Map(); for (const b of bad) { const k = `${b.rule}: ${b.text}`; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, n]) => (n > 1 ? `${k}  (x${n})` : k)); };
const add = (name, what, bad) => { rows.push({ name, what, bad: tally(bad) }); };

// Before start(): nothing may throw, play() gives null, loop() a handle that does nothing.
{
  const r = record(() => {
    const p = SFX.map((n) => A.play(n, {})), l = LOOPS.map((n) => A.loop(n, {}));
    A.setStorm?.(0.5); A.setFeed?.(1); A.setEnclosed?.('x', true); A.update(0.016, cam, ENV); A.setStorm?.(0);
    if (!p.every((x) => x === null)) flag('other', 'play() before start() returned something');
    for (const h of l) { if (typeof h?.stop !== 'function') flag('other', 'loop() before start() gave no handle'); else h.stop(); }
  });
  add('before start()', 'play, loop, update, setStorm, setFeed, setEnclosed: safe, and make nothing', r.nodes ? [...r.bad, { rule: 'other', text: `${r.nodes} nodes made with no context` }] : r.bad);
}

// start(): the beds, with every emitter the engine knows registered (all off until their own turn below).
for (const name of EMITTERS) A.registerEmitter(name, V(...P), 'surface', name === 'frogs' ? { spots: [V(6, -1, -9), V(-7, -1, -11), V(2, -1, -14)] } : {});
for (const e of A.emitters) e.off = true;
const beds = () => {
  const bad = [];
  for (const name of OUTDOOR_BEDS) {
    if (!A[name]) continue;
    const r = routes(A[name]);
    for (const w of r.ways) if (w !== 'world') bad.push({ rule: 'route', text: `${name} reaches the output ${PAST[w]}, past the world bus` });
    if (r.ways.size && !r.outdoor) bad.push({ rule: 'route', text: `${name} reaches the world bus without passing the outdoor bus` });
  }
  return bad;
};
{
  const r = record(() => A.start(ac), { lasting: true });
  add('start()', `${r.nodes} nodes, ${r.sources} sources; the beds through ${[...r.ways].join(', ') || 'nothing'}; ${EMITTERS.length} emitters`, [...r.bad, ...beds()]);
}
A.update(0.1, cam, ENV);

// Every sound: each option set played PLAYS times, a minute apart.
function sound(kind, name, sets) {
  const per = [];
  for (const opt of sets) {
    const allowed = ['world', ...(BYPASS[name] ? [BYPASS[name]] : []), ...(opt.car ? ['near'] : []), ...(opt.feed ? ['feed'] : [])];
    const agg = { opt, bad: [], lo: Infinity, hi: 0, over: 0, ways: new Set() };
    for (let k = 0; k < PLAYS; k++) {
      now += 60;
      const r = record(() => {
        const h = kind === 'sfx' ? A.play(name, real(opt)) : A.loop(name, real(opt));
        if (A.route !== A.fxBus) flag('route', 'the engine\'s route was left switched after play()');
        if (h && typeof h === 'object') {          // a handle: use it, then stop it (twice: the second must be harmless)
          now += 1.5;
          for (const [m, f] of Object.entries(h)) if (typeof f === 'function' && m !== 'stop') f(...(m === 'setPos' ? [V(1, 0, -2)] : [0.5, 0.2]));
          now += 0.5;
          if (typeof h.stop !== 'function') flag('unstopped', 'its handle has no stop()');
          else { h.stop(); now += 0.01; h.stop(); for (const [m, f] of Object.entries(h)) if (typeof f === 'function' && m !== 'stop' && m !== 'setPos') f(1, 0.1); }
        } else if (kind === 'loop') flag('other', 'loop() returned no handle');
      }, { allowed });
      agg.bad.push(...r.bad); agg.lo = Math.min(agg.lo, r.sources); agg.hi = Math.max(agg.hi, r.sources); agg.over = Math.max(agg.over, r.over);
      for (const w of r.ways) agg.ways.add(w);
    }
    per.push(agg);
  }
  const span = (a) => (a.lo === a.hi ? `${a.lo}` : `${a.lo}-${a.hi}`), line = (a) => `${span(a).padStart(6)} sources, over by ${a.over.toFixed(2).padStart(6)} s, through ${[...a.ways].join(' + ') || 'nothing (silent)'}`;
  const label = (kind === 'loop' ? 'loop ' : '') + name;
  if (VERBOSE) for (const a of per) add(label, `${line(a)}  ${show(a.opt)}`, a.bad);
  else {
    const all = { lo: Math.min(...per.map((a) => a.lo)), hi: Math.max(...per.map((a) => a.hi)), over: Math.max(...per.map((a) => a.over)), ways: new Set(per.flatMap((a) => [...a.ways])) };
    // (each failure once, with the option sets it came up in, unless that is all of them)
    const hit = new Map();
    for (const a of per) for (const b of a.bad) {
      const k = `${b.rule}: ${b.text}`;
      if (!hit.has(k)) hit.set(k, { rule: b.rule, text: b.text, at: new Set() });
      hit.get(k).at.add(a);
    }
    const bad = [...hit.values()].map(({ rule, text, at }) => {
      const some = [...at].slice(0, 2).map((x) => show(x.opt)).join(', ');
      return { rule, text: at.size === per.length ? text : `${text}  [with ${some}${at.size > 2 ? `, and ${at.size - 2} more` : ''}]` };
    });
    add(label, `${String(per.length).padStart(2)} option sets x ${PLAYS}: ${line(all)}`, bad);
  }
}
const fromJobs = (key, name) => Object.values(JOBS).flatMap((j) => (j[key] || []).filter((s) => s[1] === name).map((s) => s[2] || {}));
const sets = (key, name) => { const seen = new Set(); return [{}, { pos: P }, ...fromJobs(key, name), ...(OPTIONS[name] || [])].filter((o) => { const k = show(o); return !seen.has(k) && seen.add(k); }); };
for (const name of SFX) if (!only.length || only.includes(name)) sound('sfx', name, sets('shots', name));
for (const name of LOOPS) if (!only.length || only.includes(name)) sound('loop', name, sets('loops', name));
for (const name of only) if (!SFX.includes(name) && !LOOPS.includes(name)) add(name, 'no such sound', [{ rule: 'other', text: `the engine has no sfx_${name} or loop_${name}` }]);

// update(): a minute or two of frames in each state of the world. The beds alone may make nodes on few frames (a bird's
// phrase, a drip); an emitter's own ticks (the fire's crackles, the frogs) on more, but never frame after frame.
function frames(label, seconds, env, { limit = 0.1, before = null, rise = 0 } = {}) {
  const DT = 1 / 60, e = { ...ENV, ...env };
  let busy = 0, n = 0;
  const r = record(() => {
    before?.();
    for (let t = 0; t < seconds; t += DT) {
      now += DT; e.altDeg += rise * DT;
      const k = nodes.length;
      A.update(DT, cam, e);
      n++; if (nodes.length > k) busy++;
    }
  });
  if (busy > n * limit) r.bad.push({ rule: 'perframe', text: `nodes made on ${(100 * busy / n).toFixed(0)} % of frames (over ${limit * 100} %): update() is building as it goes` });
  add(label, `${n} frames, nodes made on ${(100 * busy / Math.max(1, n)).toFixed(1).padStart(5)} % of them (${r.nodes} nodes, ${r.sources} sources)`, [...r.bad, ...beds()]);
}
if (!only.length) {
  frames('update: day', 120, { altDeg: 30 });
  frames('update: dawn', 120, { altDeg: 3 }, { rise: 0.01 });
  frames('update: night', 60, { altDeg: -40 });
  frames('update: storm', 60, { altDeg: -40 }, { before: () => A.setStorm(1) });
  frames('update: storm, in a car', 30, { altDeg: -40, inCar: true });
  frames('update: storm gone', 30, { altDeg: 30 }, { before: () => A.setStorm(0) });
  frames('update: underground', 60, { zone: 'tunnel' });
  frames('update: lounge', 30, { zone: 'tunnel', room: true });
  frames('update: indoors, sealed', 30, { indoor: true, sealed: 0.6, underDome: true });
  frames('update: camera feed', 30, { altDeg: 30 }, { before: () => A.setFeed?.(1) });
  A.setFeed?.(0);
  for (const e of A.emitters) {
    e.off = false;
    frames(`update: emitter ${e.name}`, 60, { altDeg: -5 }, { limit: 0.35 });
    e.off = true;
  }
}

const failed = rows.filter((r) => r.bad.length);
const wide = Math.max(...rows.map((r) => r.name.length));
console.log(`${path.relative(process.cwd(), ENGINE).split(path.sep).join('/')} on a mock AudioContext: ${SFX.length} sounds, ${LOOPS.length} loops, ${EMITTERS.length} emitters; seed ${SEED}\n`);
for (const r of rows) {
  console.log(`${r.bad.length ? 'FAIL' : 'PASS'}  ${r.name.padEnd(wide)}  ${r.what}`);
  for (const b of VERBOSE ? r.bad : r.bad.slice(0, 6)) console.log(`        ${b}`);
  if (!VERBOSE && r.bad.length > 6) console.log(`        ... and ${r.bad.length - 6} more (-v shows all)`);
}
console.log(`\n${rows.length - failed.length} of ${rows.length} passed${failed.length ? `; FAILED: ${failed.map((r) => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
