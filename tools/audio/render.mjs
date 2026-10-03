// Renders the game's sounds offline to WAV files and prints their levels: src/audio/engine.js running on wal.mjs's
// stand-in for the Web Audio API, so a sound can be looked at (spec.py) and measured without a browser.
// Run it with --help for the usage; README.md has the rest.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { OfflineCtx, AudioBufferLite, mulberry32, writeWav16, levels } from './wal.mjs';
import { JOBS, GROUPS } from './jobs.mjs';

const HELP = `Renders sounds from src/audio/engine.js to 16-bit 48 kHz stereo WAVs in tools/audio/out/ and prints their levels.

  node tools/audio/render.mjs <job> [<job> ...]         named jobs from jobs.mjs ('thunder_*' matches several)
  node tools/audio/render.mjs --group <group>           the jobs heard together (hand, doors, storm ...; repeatable)
  node tools/audio/render.mjs --play <name> [--opts ..] one sound: play(name, opts)
  node tools/audio/render.mjs --loop <name> [--opts ..] a looping sound: loop(name, opts), stopped 1.5 s before the end
  node tools/audio/render.mjs --ambience [--alt 30 ..]  the beds alone: wind, birds, crickets, rain
  node tools/audio/render.mjs --list [word ...]         the jobs, the sound each plays, and the groups; with words,
                                                        only the jobs that match one (--list doorClose, --list thunder)

What is played (with --play / --loop):
  --opts <json | k=v,k=v>   its options: '{"distance":150,"pan":-0.5}' or distance=150,pan=-0.5 (pos=[0,0,-3], car=true)
  --pos x,y,z               where it is, in metres from the listener (x: right, y: up, -z: ahead); none: straight to the bus
  --at "<s> <method> [args]"  call the handle it returned at s seconds: --at "2 setDry 1 0.3" --at "5 stop" (repeatable)

The output is <name>[.<tag>][.<take>].wav, where <name> is the job's; <sound>.play or <sound>.loop for --play / --loop
(so it never lands on the job of the same name); ambience for --ambience alone.
  --name <name>             another name for it, when one thing is rendered (a job changed by the flags below, say)

The world round it (these apply to named jobs too; any of them turns the ambience on):
  --ambience                run the engine's update() every block, so the beds sound
  --alt <deg>               the sun's altitude (30: day, 4 with --rise 0.004: the dawn chorus, -40: night)
  --rise <deg/s>            the sun climbing
  --storm <0..1>            setStorm(level), already raging
  --zone surface|tunnel     --indoor  --incar  --dome  --room  --sealed <0..1>  --muted <0..1>   the rest of update()'s env
  --emitter name@x,y,z      a positional emitter (fire, firepit, stream, waterfall, cascade, frogs, generator ...; repeatable)
  --mute a,b                engine buses to silence, by property name: windGain,cricketBus,dayBugs,birdBus,stormBus,howl

The render:
  --seconds <s>             length (default: the job's; 12 for --play, trimmed to the sound; 20 for --ambience)
  --skip <s>                rendered first and thrown away (default 5 with ambience: the beds ease in)
  --seed <n | random>       Math.random's seed (default 1: the same render every time; random picks one and prints it)
  --n <k>                   k takes, seeds n, n+1, ...: how much one play differs from the next (take 2 is <name>.2.wav)
  --ref <git rev>           also render it from that commit's engine, as <name>.<sha>.wav, and print the difference
  --tag <t>                 name the output <name>.<t>.wav (before / after); it tags everything on the command line
  --tap a,b                 engine nodes to measure on their own, by property name (a job has its own: rainOut, birdBus ...)
  --taps                    also write each tap's own WAV: <name>.tap-<node>.wav
  --out <dir>               (default tools/audio/out)
  --spec                    then draw each WAV's spectrogram (python tools/audio/spec.py)

Levels are dBFS at the game's output (after the master gain and compressor): peak, RMS of the part that sounds, the
loudest 50 ms, the last two A-weighted (how loud it is heard), and what went into the compressor. length is that
part: to the last sample within 60 dB of the peak, reverb tail included.`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const RATE = 48000;
// The environment update() is given, unless a job or a flag says otherwise; the ground is 1.6 m under the listener.
const ENV = { zone: 'surface', altDeg: 30, inCar: false, indoor: false, room: false, muted: 0, underDome: false, sealed: 0 };
const GROUND = [0, -1.6, 0];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const realRandom = Math.random;
globalThis.AudioBuffer = AudioBufferLite;      // (so the engine's prepare() bakes its buffers as it does in the game)

// ---------- arguments ----------
const fail = (msg) => { console.error(msg); process.exit(1); };
const num = (s, what) => { const v = Number(s); if (!Number.isFinite(v)) fail(`${what}: not a number: ${s}`); return v; };
const vec = (s, what) => { const a = String(s).replace(/[[\]]/g, '').split(/[,/]/).map((x) => num(x, what)); if (a.length !== 3) fail(`${what}: wants x,y,z`); return a; };
const scalar = (s) => (s === 'true' ? true : s === 'false' ? false : s === 'null' ? null : s !== '' && Number.isFinite(Number(s)) ? Number(s) : s);

// Options as JSON, as JSON a shell has eaten the quotes of ({distance:150,kind:tick}), or as k=v,k=v.
function parseOpts(s) {
  s = (s || '').trim();
  if (!s) return {};
  if (s.startsWith('{')) {
    try { return JSON.parse(s); } catch { /* quotes lost */ }
    const fixed = s.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/:\s*([A-Za-z_][\w-]*)\s*(?=[,}])/g, (m, v) => (['true', 'false', 'null'].includes(v) ? m : `:"${v}"`));
    try { return JSON.parse(fixed); } catch { fail('--opts: cannot read ' + s); }
  }
  const o = {};
  for (const part of s.split(/,(?![^[]*\])/)) {
    const i = part.indexOf('=');
    if (i < 0) fail(`--opts: wants k=v, got ${part}`);
    const v = part.slice(i + 1).trim();
    o[part.slice(0, i).trim()] = v.startsWith('[') ? vec(v, '--opts') : scalar(v);
  }
  return o;
}

const argv = process.argv.slice(2);
const a = { jobs: [], groups: [], at: [], emitters: [], env: {}, seed: 1, n: 1, out: path.join(HERE, 'out') };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i], next = () => { if (i + 1 >= argv.length) fail(`${k}: wants a value`); return argv[++i]; };
  if (k === '--help' || k === '-h') { console.log(HELP); process.exit(0); }
  else if (k === '--list') a.list = true;
  else if (k === '--group') a.groups.push(next());
  else if (k === '--play') a.play = next();
  else if (k === '--loop') a.loop = next();
  else if (k === '--opts') a.opts = parseOpts(next());
  else if (k === '--pos') a.pos = vec(next(), '--pos');
  else if (k === '--at') { const [t, m, ...rest] = next().trim().split(/[\s,()]+/).filter(Boolean); a.at.push([num(t, '--at'), m, ...rest.map(scalar)]); }
  else if (k === '--name') a.name = next();
  else if (k === '--ambience') a.ambience = true;
  else if (k === '--alt') a.env.altDeg = num(next(), k);
  else if (k === '--rise') a.rise = num(next(), k);
  else if (k === '--storm') a.storm = num(next(), k);
  else if (k === '--zone') a.env.zone = next();
  else if (k === '--indoor') a.env.indoor = true;
  else if (k === '--incar') a.env.inCar = true;
  else if (k === '--dome') a.env.underDome = true;
  else if (k === '--room') a.env.room = true;
  else if (k === '--sealed') a.env.sealed = num(next(), k);
  else if (k === '--muted') a.env.muted = num(next(), k);
  else if (k === '--emitter') { const [name, at] = next().split('@'); a.emitters.push([name, vec(at ?? '0,0,-3', k)]); }
  else if (k === '--mute') a.mute = next().split(',').filter(Boolean);
  else if (k === '--seconds') a.seconds = num(next(), k);
  else if (k === '--skip') a.skip = num(next(), k);
  else if (k === '--seed') { const s = next(); a.seed = s === 'random' ? 2 + Math.floor(Math.random() * 999998) : Math.round(num(s, k)); }
  else if (k === '--n') a.n = Math.max(1, Math.round(num(next(), k)));
  else if (k === '--ref') a.ref = next();
  else if (k === '--tag') a.tag = next();
  else if (k === '--tap') a.tap = next().split(',').filter(Boolean);
  else if (k === '--taps') a.taps = true;
  else if (k === '--out') a.out = path.resolve(next());
  else if (k === '--spec') a.spec = true;
  else if (k.startsWith('--')) fail(`unknown option ${k} (--help)`);
  else a.jobs.push(k);
}

// What a job plays, by the engine's own names (a job's name is not always its sound's: `bell` plays alarm).
const sounds = (j) => [...new Set([...(j.shots || []), ...(j.loops || [])].map((s) => s[1]).concat((j.emitters || []).map((e) => e[0])))];
const plays = (j) => [...new Set([...(j.shots || []).map((s) => s[1]), ...(j.loops || []).map((s) => 'loop ' + s[1]), ...(j.emitters || []).map((e) => 'emitter ' + e[0]), ...(j.env ? ['the beds'] : [])])].join(', ');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const groupsOf = (names) => Object.entries(GROUPS).filter(([, g]) => g.jobs.some((n) => names.includes(n)));
const groupLine = ([name, g]) => `  ${name.padEnd(10)} ${g.jobs.map((n) => (JOBS[n] ? n : `${n} (no such job)`)).join(' ')}   (${g.about})`;

if (a.list) {
  // (with words: the jobs whose name, sound or description has one of them, so `--list doorClose` finds door_close)
  const words = a.jobs.map(norm).filter(Boolean);
  const shown = Object.entries(JOBS).filter(([name, j]) => !words.length || words.some((w) => [name, j.about, ...sounds(j)].some((s) => norm(s).includes(w))));
  if (!shown.length) fail(`no job matches ${a.jobs.join(' ')} (--list alone shows them all; --play <name> plays any sfx_<name>)`);
  console.log(`${'job'.padEnd(20)} ${'seconds'.padStart(7)}  ${'plays'.padEnd(24)}  what it is`);
  for (const [name, j] of shown) console.log(`${name.padEnd(20)} ${String(j.seconds).padStart(5)} s  ${plays(j).padEnd(24)}  ${j.about}`);
  const groups = words.length ? groupsOf(shown.map(([n]) => n)) : Object.entries(GROUPS);
  if (groups.length) console.log(`\nHeard together (set a sound's level against the others in its group; --group <name> renders one):\n${groups.map(groupLine).join('\n')}`);
  process.exit(0);
}

// The jobs asked for: named ones (with * as a wildcard), whole groups, and the one --play / --loop / --ambience describe.
const todo = [];
for (const pat of a.jobs) {
  const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const hits = Object.keys(JOBS).filter((n) => re.test(n));
  if (!hits.length) {
    // (a play() name, or a job's name spelt another way: say which jobs that is)
    const w = norm(pat), near = Object.entries(JOBS).filter(([n, j]) => w && (norm(n).includes(w) || sounds(j).some((s) => norm(s) === w))).map(([n]) => n);
    const sfx = '--play <sound> renders any sfx_<sound> with your own --opts and --pos';
    fail(near.length ? `no job "${pat}". Jobs for it: ${near.join(', ')}  (--list ${pat} describes them; ${sfx})` : `no job "${pat}" (--list shows them; ${sfx})`);
  }
  for (const n of hits) todo.push([n, JOBS[n]]);
}
for (const name of a.groups) {
  const g = GROUPS[name];
  if (!g) fail(`no group "${name}". There are: ${Object.keys(GROUPS).join(', ')}  (--list shows what is in each)`);
  for (const n of g.jobs) { if (!JOBS[n]) fail(`group ${name} names a job that is not in jobs.mjs: ${n}`); if (!todo.some(([m]) => m === n)) todo.push([n, JOBS[n]]); }
}
if (a.play && a.loop) fail('--play or --loop: one at a time');
if (a.play || a.loop) {
  const opts = { ...(a.opts || {}), ...(a.pos ? { pos: a.pos } : {}) };
  const seconds = a.seconds ?? 12;
  const calls = a.at.length ? a.at : a.loop ? [[Math.max(0.5, seconds - 1.5), 'stop']] : [];
  // (named <sound>.play / <sound>.loop: a job of the same name, with its own options, keeps its own file)
  todo.push([a.play ? `${a.play}.play` : `${a.loop}.loop`, { seconds, calls, [a.play ? 'shots' : 'loops']: [[0.1, a.play ?? a.loop, opts]] }]);
} else if (!todo.length && (a.ambience || Object.keys(a.env).length || a.storm != null || a.emitters.length)) {
  todo.push(['ambience', { seconds: a.seconds ?? 20, skip: 5, env: {} }]);
}
if (!todo.length) { console.log(HELP); process.exit(0); }
if (a.name != null) {
  if (todo.length !== 1) fail(`--name names one render, and there are ${todo.length} here: ${todo.map(([n]) => n).join(', ')}`);
  todo[0] = [a.name, todo[0][1]];
}

// The flags about the world, laid over a job.
function withFlags(job) {
  const j = { ...job };
  if (a.ambience || Object.keys(a.env).length || a.rise != null || a.emitters.length || (a.storm != null && !j.env)) {
    if (!j.env && j.skip == null) j.skip = 5;
    j.env = { ...(j.env || {}), ...a.env };
  }
  if (a.storm != null) j.storm = a.storm;
  if (a.rise != null) j.rise = a.rise;
  if (a.emitters.length) j.emitters = [...(j.emitters || []), ...a.emitters];
  if (a.mute) j.mute = [...(j.mute || []), ...a.mute];
  if (a.tap) j.taps = [...(j.taps || []), ...a.tap];
  if (a.seconds != null) j.seconds = a.seconds;
  if (a.skip != null) j.skip = a.skip;
  return j;
}

// ---------- the engine: the working tree's, or a commit's ----------
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// A commit's engine: its src/audio/engine.js and whatever that imports by a relative path, written under
// tools/audio/out/.ref/<sha>/ at their own paths, so the relative imports resolve among themselves and 'three'
// resolves to the repo's node_modules above it. (Always under tools/audio/out, whatever --out says, for that.)
function refEngine(rev) {
  let sha;
  try { sha = git('rev-parse', '--short', `${rev}^{commit}`).trim(); } catch { fail(`--ref: git knows no commit "${rev}"`); }
  const root = path.join(HERE, 'out', '.ref', sha), seen = new Set();
  const pull = (rel, need) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    let text;
    try { text = git('show', `${sha}:${rel}`); } catch { if (need) fail(`--ref: ${rel} is not in ${sha}`); return; }
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    for (const m of text.matchAll(/\b(?:import|export)\b[^'";]*?['"](\.{1,2}\/[^'"]+)['"]/g)) pull(path.posix.join(path.posix.dirname(rel), m[1]), false);
  };
  pull('src/audio/engine.js', true);
  return { sha, file: path.join(root, 'src/audio/engine.js') };
}

const engines = [];
if (a.ref) { const r = refEngine(a.ref); engines.push({ label: r.sha, tag: r.sha, file: r.file }); }
engines.push({ label: '', tag: a.tag, file: path.join(REPO, 'src/audio/engine.js') });
for (const e of engines) e.Engine = (await import(pathToFileURL(e.file).href)).AudioEngine;
if (a.play || a.loop) {
  const prefix = a.play ? 'sfx_' : 'loop_', want = a.play ?? a.loop, proto = engines.at(-1).Engine.prototype;
  if (typeof proto[prefix + want] !== 'function') fail(`the engine has no ${prefix}${want}. It has: ${Object.getOwnPropertyNames(proto).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).join(', ')}`);
}

// ---------- one render ----------
function render(job, Engine, seed) {
  Math.random = seed == null ? realRandom : mulberry32(seed);
  const ac = new OfflineCtx(RATE), A = new Engine();
  const notes = [], missing = new Set(), taps = {};
  const env = job.env ? { ...ENV, ...job.env, ground: V(...GROUND) } : null;
  A.prepare?.(RATE);
  if (job.storm != null) A.setStorm?.(job.storm);
  for (const [name, at] of job.emitters || []) A.registerEmitter(name, V(...at), env?.zone ?? 'surface', name === 'frogs' ? { spots: [V(...at), V(at[0] + 6, at[1], at[2] - 4), V(at[0] - 5, at[1], at[2] - 7)] } : {});
  A.start(ac);
  if (job.storm != null && A.stormTarget != null) A.stormLevel = A.stormTarget;      // (no fade-in)
  for (const m of job.mute || []) { if (A[m]) A[m].muted = true; else notes.push(`no ${m} in this engine to mute`); }
  for (const t of job.taps || []) { if (A[t]) taps[t] = A[t]; else notes.push(`no ${t} in this engine to tap`); }
  const comp = ac.nodes.find((n) => n.kind === 'DynamicsCompressor' && n.outs.includes(ac.destination));
  const cam = new THREE.PerspectiveCamera();
  const skip = job.skip || 0, every = [];
  const timers = [{ t: skip, f: () => comp?.reset() }];
  const c = {
    THREE, V, env: env ?? { ...ENV, ground: V(...GROUND) }, handle: null,
    at: (t, f) => timers.push({ t: t + skip, f }), every: (f) => every.push(f), note: (s) => notes.push(s), tap: (name, node) => { taps[name] = node; },
  };
  const opts = (o) => (o && Array.isArray(o.pos) ? { ...o, pos: V(...o.pos) } : { ...(o || {}) });
  for (const [t, name, o] of job.shots || []) c.at(t, () => { if (!A['sfx_' + name]) { missing.add(name); return; } const h = A.play(name, opts(o)); if (h && typeof h === 'object') c.handle = h; });
  for (const [t, name, o] of job.loops || []) c.at(t, () => { if (!A['loop_' + name]) { missing.add(name); return; } c.handle = A.loop(name, opts(o)); });
  for (const [t, m, ...args] of job.calls || []) c.at(t, () => { if (typeof c.handle?.[m] === 'function') c.handle[m](...args); else notes.push(`no ${m}() on the handle at ${t} s`); });
  for (const [t, on] of job.enclose || []) c.at(t, () => A.setEnclosed('render', on));
  job.run?.(A, c);
  const alt0 = env?.altDeg, t0 = performance.now();
  const rec = ac.render(job.seconds + skip, {
    taps,
    tick: (t, dt) => {
      for (const x of timers.filter((x) => !x.done && x.t <= t + 1e-9).sort((p, q) => p.t - q.t)) { x.done = true; x.f(); }
      if (env) {
        if (job.rise) env.altDeg = alt0 + job.rise * (t - skip);
        A.update(dt, cam, env);
      }
      for (const f of every) f(t - skip);
    },
  });
  Math.random = realRandom;
  for (const name of missing) notes.push(`this engine has no ${name}`);
  const said = notes.map((s) => (typeof s === 'function' ? s() : s)).filter(Boolean);
  // Cut the pre-roll. A one-shot (no ambience, no handle to keep it going) is trimmed to 0.3 s after its last sample
  // within 60 dB of its peak (the reverb's tail runs on for seconds under that), and flagged if it was cut short: its
  // last 50 ms within 26 dB of its loudest (the reverb sits some 30 dB under a sound).
  let from = Math.round(skip * RATE), to = rec.out[0].length;
  if (!env && !c.handle) {
    const [L, R] = rec.out, w = Math.round(RATE * 0.05), power = (s) => { let q = 0; for (let i = s; i < s + w; i++) q += L[i] * L[i] + R[i] * R[i]; return q; };
    let peak = 0, last = from, loud = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const thr = Math.max(2.5e-4, peak * 0.001);
    for (let i = to - 1; i > from; i--) if (Math.abs(L[i]) > thr || Math.abs(R[i]) > thr) { last = i; break; }
    for (let s = from; s + w <= to; s += w) loud = Math.max(loud, power(s));
    if (loud > 0 && power(to - w) > loud * 0.0025) said.push('cut short: still sounding at the end (render more with --seconds)');
    to = Math.min(to, Math.max(from + RATE * 0.5, last + RATE * 0.3));
  }
  const cut = (ch) => ch.map((x) => x.subarray(from, to));
  return {
    out: cut(rec.out), taps: Object.fromEntries(Object.keys(taps).map((k) => [k, cut(rec[k])])), notes: said,
    comp: comp && { inPeak: comp.inPeak, squeeze: -20 * Math.log10(comp.minShape), makeup: comp.makeupDb, threshold: comp.threshold.value, knee: comp.knee.value, ratio: comp.ratio.value },
    master: A.master?.gain?.value, ms: Math.round(performance.now() - t0),
  };
}

// ---------- run them, print the table ----------
const d1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-inf');
const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
// (a path as it is printed: from where this was run when it is under there, in full when it is not)
const rel = (f) => { const r = path.relative(process.cwd(), f); return (!r || r.startsWith('..') || path.isAbsolute(r) ? f : r).replace(/\\/g, '/'); };
const row = (label, L) => `${label.padEnd(28)} ${d1(L.peak).padStart(6)} ${d1(L.rms).padStart(6)} ${d1(L.max50).padStart(6)} | ${d1(L.aRms).padStart(6)} ${d1(L.aMax50).padStart(6)} | ${L.len.toFixed(2).padStart(6)} s`;
fs.mkdirSync(a.out, { recursive: true });
const written = [];
let headed = false;
for (const [name, job0] of todo) {
  const job = withFlags(job0);
  const pair = [];
  for (const eng of engines) {
    const takes = [];
    for (let take = 0; take < a.n; take++) {
      const seed = a.seed + take;
      const r = render(job, eng.Engine, seed);
      if (!headed) {
        headed = true;
        if (r.comp) console.log(`master: gain ${r.master}, compressor threshold ${r.comp.threshold} dB, knee ${r.comp.knee}, ratio ${r.comp.ratio} (makeup +${r.comp.makeup.toFixed(1)} dB)`);
        console.log(`${''.padEnd(28)} ${'peak'.padStart(6)} ${'rms'.padStart(6)} ${'max50'.padStart(6)} | ${'A rms'.padStart(6)} ${'A m50'.padStart(6)} | ${'length'.padStart(8)} | into the compressor | file`);
      }
      const L = levels(r.out, RATE);
      const base = [name, eng.tag, take ? String(take + 1) : ''].filter(Boolean).join('.');
      const file = path.join(a.out, base + '.wav');
      const k = writeWav16(fs, file, r.out, RATE);
      written.push(file);
      const into = r.comp ? `peak ${d1(dB(r.comp.inPeak))}, squeezed ${r.comp.squeeze.toFixed(1)} dB` : 'no compressor';
      const label = [eng.label ? `${name} @${eng.label}` : [name, eng.tag].filter(Boolean).join('.'), take ? '#' + (take + 1) : ''].filter(Boolean).join(' ');
      console.log(`${row(label, L)} | ${into} | ${rel(file)}  (seed ${seed}, ${(r.ms / 1000).toFixed(1)} s to render)`);
      if (k < 1) console.log(`    ! over full scale by ${d1(L.peak)} dB: the browser would clip it (the file is scaled down by ${d1(-dB(k))} dB to fit)`);
      for (const s of r.notes) console.log(`    ! ${s}`);
      for (const [tap, x] of Object.entries(r.taps)) {
        let line = `${row('    tap ' + tap, levels(x, RATE))} | before the master`;
        if (a.taps) { const tf = path.join(a.out, `${base}.tap-${tap}.wav`); writeWav16(fs, tf, x, RATE); line += ` | ${rel(tf)}`; }
        console.log(line);
      }
      takes.push(L);
      if (take === 0) pair.push(L);
    }
    if (a.n > 1) {      // how far the takes differ: a noise-made sound's peak moves a few dB with the seed, its max50 hardly
      const span = (k, f = d1) => { const v = takes.map((L) => L[k]), lo = Math.min(...v), hi = Math.max(...v); return f(lo) === f(hi) ? f(lo) : `${f(lo)} to ${f(hi)}`; };
      console.log(`    ${[name, eng.tag].filter(Boolean).join('.')}, ${a.n} takes (seeds ${a.seed} to ${a.seed + a.n - 1}): peak ${span('peak')}, max50 ${span('max50')}, A m50 ${span('aMax50')} dB; length ${span('len', (x) => x.toFixed(2))} s`);
    }
  }
  if (pair.length === 2) {
    const [b, n] = pair, df = (k) => { const v = n[k] - b[k]; return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) : 'n/a'; };
    console.log(`    change from ${engines[0].label}: peak ${df('peak')}, rms ${df('rms')}, max50 ${df('max50')}, A rms ${df('aRms')}, A m50 ${df('aMax50')} dB; length ${df('len')} s`);
  }
}

if (a.spec) {
  const r = spawnSync('python', [path.join(HERE, 'spec.py'), ...written], { stdio: 'inherit' });
  if (r.error || r.status) console.error('spec.py did not run (python with numpy and Pillow is needed): ' + (r.error?.message ?? 'exit ' + r.status));
}
