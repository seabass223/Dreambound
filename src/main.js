import * as THREE from 'three';
import { UNDERGROUND_Y, WALLS, PLAYER } from './config.js';
import { Input } from './core/input.js';
import { DayClock } from './core/time.js';
import { Interactions } from './core/interact.js';
import { atmo, atmoState, updateAtmosphere } from './render/atmosphere.js';
import { SKY_TARGET, VIEW_DROP } from './world/skyTarget.js';
import { createSky } from './render/sky.js';
import { createClouds } from './render/clouds.js';
import { createLighting } from './render/lighting.js';
import { createPostFX } from './render/postfx.js';
import { Physics } from './player/collision.js';
import { Player } from './player/controller.js';
import { buildWorld } from './world/index.js';
import { AudioEngine } from './audio/engine.js';
import { createIntro } from './sequences/intro.js';
import { createFall } from './sequences/fall.js';
import { createEnding, prepareEnding } from './sequences/ending.js';
import { createSettings } from './ui/settings.js';
import { createReticle } from './ui/reticle.js';
import { createDebugReport } from './ui/debugReport.js';
import { loadCabin, PROBE_LAYER } from './props/cabin.js';
import { loadObservatory } from './props/observatory.js';
import { loadCave } from './props/cave.js';
import { loadLounge } from './props/lounge.js';
import { loadElevator } from './props/elevator.js';
import { loadTowerKit } from './props/powertower.js';
import { preload } from './render/preload.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
const maxDpr = Math.min(window.devicePixelRatio, 1.5);
let dpr = maxDpr;
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.transmissionResolutionScale = 0.5; // the stream's refraction pass
document.body.appendChild(renderer.domElement);
// Dev: count shader compiles, GPU allocations and slow frames after wake-up (window.hitchReport(), see dev/hitch.js).
const hitch = DEV ? (await import('./dev/hitch.js')).installHitchMonitor({ renderer, area: () => hitchArea() }) : null;
let hitchArea = () => '';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.12, 14000);
scene.add(camera);

const clock = new DayClock();
const sky = createSky();
scene.add(sky.mesh);
const clouds = createClouds();
scene.add(clouds.group);
const lighting = createLighting(renderer, scene, sky);
const fx = createPostFX(renderer, scene, camera);

const input = new Input(renderer.domElement);
const physics = new Physics();
const interact = new Interactions(camera);
const audio = new AudioEngine();

// ---------- Start ----------
// A click while the world is still loading or preloading is kept, and the game starts the moment it is ready
// (begin(), under Sequences). Registered first thing: the canvas takes clicks from the start.
let sequence = null;
let started = false;
let ended = false;
let ready = false, queued = false;
input.on('firstClick', () => {
  if (started) return;
  if (ready) return begin();
  queued = true;
  audio.unlock();   // the AudioContext must be made inside the click; the sound graph waits for begin()
});

// ---------- Timers ----------
const timers = [];
const later = (delay, fn) => timers.push({ at: elapsed + delay, fn });
let elapsed = 0;

// ---------- Loading veil ----------
// The black screen's progress: a hairline that fills from the middle (index.html), then the breathing light that
// means "click to begin". Roughly by time: the models' download to 10 %, building the world to 55 %, the preload
// (render/preload.js) the rest.
const veil = document.getElementById('veil');
const setProgress = (f) => veil.style.setProperty('--p', f.toFixed(3));
const bootT = performance.now();

// ---------- World ----------
let loaded = 0;
const counted = (p) => p.then((a) => { setProgress((++loaded / 6) * 0.1); return a; });
const [cabinAsset, observatoryAsset, caveAsset, loungeAsset, elevatorAsset, towerKitAsset] = await Promise.all([loadCabin(), loadObservatory(), loadCave(), loadLounge(), loadElevator(), loadTowerKit()].map(counted));
const loadedT = performance.now();
await new Promise((r) => setTimeout(r, 20));   // let the line show it before the (synchronous) build
const ctx = buildWorld({ renderer, scene, camera, physics, interact, audio, input, fx, later, updaters: [], cabinAsset, observatoryAsset, caveAsset, loungeAsset, elevatorAsset, towerKitAsset });
prepareEnding(ctx);   // the ending's clock and steam, hidden until then, so the preload warms them too
setProgress(0.55);
const player = new Player(camera, input, physics);
ctx.player = player;
// The cabin's reflection probe sees the sky and every light (see PROBE_LAYER).
sky.mesh.layers.enable(PROBE_LAYER);
scene.traverse((o) => { if (o.isLight) o.layers.enable(PROBE_LAYER); });
const settings = createSettings({ player, clock, fx, input, canvas: renderer.domElement, baseSpeed: clock.speed });
ctx.onRide = (riding) => { ctx.riding = riding; };
const reticle = createReticle();
// Where the hitch monitor says a hitch happened: a label the dev tour sets, or zone + nearest stack.
if (hitch) {
  hitchArea = () => {
    if (window.hitchLabel) return window.hitchLabel;
    if (player.zone === 'tunnel') return ctx.tunnels.lounge?.inside(player.feet) ? 'lounge' : 'tunnel';
    let best = '', bd = Infinity;
    for (const [name, st] of Object.entries(ctx.stacks)) { const d = Math.hypot(player.feet.x - st.cx, player.feet.z - st.cz); if (d < bd) { bd = d; best = name; } }
    return best + (fx.scope > 0.5 ? ' (eyepiece)' : '') + (ctx.riding ? ' (riding)' : '');
  };
}

// Spawn
{
  // Wake in the cabin: the intro starts in bed; ?skip starts standing beside it.
  const w = ctx.house.wake;
  player.place(w.stand.x, w.stand.y, w.stand.z, w.standYaw);
  const dev = params.get('spawn');
  if (dev && ctx.stacks[dev]) {
    const st = ctx.stacks[dev];
    const x = st.cx + 6, z = st.cz + 6;
    player.place(x, (st.heightAt(x, z) ?? st.top) + 0.1, z, 0);
  }
  if (dev === 'hub') {
    // In the cave hub, facing the generator.
    const o = ctx.tunnels.center, g = ctx.tunnels.cave.center;
    const d = new THREE.Vector3(g.x - o.x, 0, g.z - o.z).normalize();
    player.zone = 'tunnel';
    player.place(o.x + d.x * 5, o.y - 3 + 0.1, o.z + d.z * 5, Math.atan2(-d.x, -d.z));
  }
  if (dev === 'lounge' && ctx.tunnels.lounge) {
    // In the lounge under the Tower, just out of the elevator, facing the desk.
    const s = ctx.tunnels.stations.lounge;
    const f = new THREE.Vector3(Math.sin(s.rotY), 0, Math.cos(s.rotY));
    player.zone = 'tunnel';
    player.place(s.pos.x + f.x * 1.2, s.pos.y + 0.1, s.pos.z + f.z * 1.2, s.rotY + Math.PI);
  }
}

// Footstep surfaces
const q = {};
function surfaceAt(feet) {
  if (player.zone === 'tunnel') return ctx.riding ? 'metal' : ctx.tunnels.lounge?.inside(feet) ? 'wood' : 'cave';
  if (ctx.house.inside(feet)) return 'wood';
  const b = ctx.bridgeSpan;
  if (b) {
    const rx = feet.x - b.a.x, rz = feet.z - b.a.z;
    const along = rx * b.flat.x + rz * b.flat.z, side = rx * b.side.x + rz * b.side.z;
    if (along > -0.5 && along < b.L + 0.5 && Math.abs(side) < b.width) return 'wood';
  }
  for (const [name, st] of Object.entries(ctx.stacks)) {
    const d = Math.hypot(feet.x - st.cx, feet.z - st.cz);
    if (d > st.r * 1.3) continue;
    const h = st.heightAt(feet.x, feet.z);
    // Below the cap (ledges, ladders, caves). The cap relief (WALLS.relief) can dip a meadow under top - 2.5, so over
    // the cap it is measured from the ground there.
    const below = WALLS.relief && h !== null ? feet.y < h - 1.2 : feet.y < st.top - 2.5;
    if (below && name !== 'mountain') return 'rock';
    if (name === 'dome' && Math.abs(feet.x - st.cx) < 1.4 && feet.z - st.cz < -7.5 && feet.z - st.cz > -15) return 'rock'; // flagstones
    if (name === 'end' && d < 3.2) return 'rock';
    if (h !== null && feet.y - h > 0.25) return 'wood';
    return name === 'end' ? 'dirt' : 'grass';
  }
  return 'rock';
}
player.onStep = (feet, run, kind) => audio.play('step', { surface: kind || surfaceAt(feet), run });

// ---------- Sequences ----------
player.onFall = () => { if (!sequence && !ended) sequence = createFall(ctx); };

// The click that starts the game (see input's firstClick, above).
function begin() {
  if (started) return;
  started = true;
  veil.style.opacity = '0';
  audio.start();
  if (params.has('skip')) { fx.fade = 0; player.canMove = true; }
  else sequence = createIntro(ctx);
  last = performance.now();
}
// The recessed door on the End stack has no visible control; standing over it and pressing is enough.
function apertureAhead() {
  const ap = ctx.aperture;
  if (!ap || player.zone !== 'surface') return false;
  const dx = ap.center.x - player.feet.x, dz = ap.center.z - player.feet.z;
  const d = Math.hypot(dx, dz);
  const fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw);
  const facing = d < 0.8 || (dx * fwdX + dz * fwdZ) / d > 0.35;
  return d < 3.4 && facing && Math.abs(player.feet.y - ap.center.y) < 1.2;
}
// What a press right now would do something to (the reticle's highlight uses the same test as the press).
const pressableAhead = () => interact.enabled && (!!interact.held || apertureAhead() || !!interact.pick());

input.on('press', () => {
  if (!started || ended || settings.open) return;
  if (sequence && !sequence.done) return;
  if (apertureAhead()) {
    ended = true;
    interact.enabled = false;
    sequence = createEnding(ctx);
    return;
  }
  interact.press();
});
input.on('release', () => interact.release());

// The OS cursor is hidden (index.html) while the game has the mouse; show it whenever it doesn't.
const freeCursor = () => document.body.classList.toggle('free', started && !document.pointerLockElement);
document.addEventListener('pointerlockchange', freeCursor);
document.addEventListener('pointerlockerror', freeCursor);   // embeds that refuse the lock keep a visible cursor

const debugReport = createDebugReport({
  ctx, player, camera, clock, renderer, scene, physics, interact, settings, fx, pressableAhead,
  skip: [sky.mesh, clouds.group],   // the sky dome and cloud sea would swallow every ray
  game: () => ({ started, ended, sequence: sequence ? { done: !!sequence.done } : null, elapsed, dpr, underground: !!wasUnder }),
});

// ---------- Resize & adaptive resolution ----------
let captureSize = null;   // fixed output size while recording (dev capture)
function resize() {
  const w = captureSize ? captureSize[0] : innerWidth, h = captureSize ? captureSize[1] : innerHeight;
  const r = captureSize ? 1 : dpr;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(r);
  renderer.setSize(w, h, !captureSize);
  fx.setSize(w * r, h * r);
}
addEventListener('resize', resize);
resize();
let slowFrames = 0, fastFrames = 0;
function adapt(dt) {
  if (elapsed < 6) return; // ignore the first seconds (the GPU and driver spinning up)
  if (dt > 1 / 50) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
  if (dt < 1 / 70) fastFrames++; else fastFrames = 0;
  if (slowFrames > 90 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.125); slowFrames = 0; resize(); }
  if (fastFrames > 600 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr + 0.125); fastFrames = 0; resize(); }
}

// ---------- Zones ----------
// Above ground or below: which world is drawn, and the light and air there.
function setZone(under) {
  ctx.surface.visible = !under;
  clouds.group.visible = !under;
  ctx.tunnels.group.visible = under;
  atmo.uUnderground.value = under ? 1 : 0;
  ctx.hubLight.intensity = under ? 26 : 0;
}
function applyAir(under) {
  if (under) renderer.toneMappingExposure = 1.35 * fx.brightness;
  // Fog: user settings, plus clearer air through the telescope.
  const fogSet = settings.values;
  atmo.uFogDensity.value = under ? 0.02 : 0.00085 * fogSet.fogDensity * (ctx.scopeFogMul ?? 1);
  atmo.uFogLow.value = under ? 0 : 1.6 * fogSet.fogLow;   // the low-altitude haze is for the cloud sea, not the caves
}

// ---------- Loop ----------
let last = performance.now();
let wasUnder = null;
let domeIn = null; // hysteresis for env.underDome, so wind muffling doesn't flicker right at the glass/door
let statsT = 0;
const ground = new THREE.Vector3();
const pxSize = new THREE.Vector2();
fx.fade = 1;

let manual = false;   // dev capture drives step() by hand at a fixed rate
let shownAt = 0;      // ms since the previous frame was shown, for the hitch monitor (0: a step driven by hand)
function frame(now) {
  requestAnimationFrame(frame);
  const interval = now - last;
  const dt = Math.min(0.05, interval / 1000);
  last = now;
  if (!started || manual) return;
  shownAt = interval;
  step(dt);
  shownAt = 0;
}

function step(dt) {
  if (hitch) { if (!hitch.armed) hitch.arm(); hitch.frameStart(); }
  elapsed += dt;
  // Count the whole frame (every post pass), not just the last render call: the dev log and debug reports read it.
  renderer.info.autoReset = false;
  renderer.info.reset();

  for (let i = timers.length - 1; i >= 0; i--) if (elapsed >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); }

  clock.update(dt);
  updateAtmosphere(clock, elapsed);
  renderer.toneMappingExposure = atmoState.exposure * fx.brightness;
  settings.tick();

  // The world holds still while the settings panel is open (the sky keeps turning unless paused).
  if (!settings.open) {
    if (sequence) { sequence.update(dt); if (sequence.done && !ended) sequence = null; }
    player.update(dt);
    for (const u of ctx.updaters) u(dt);
  } else {
    input.consumeMouse();
  }

  // Ride shake inside elevators.
  player.extraCam = ctx.riding ? new THREE.Vector3(0, Math.sin(elapsed * 31) * 0.004 + Math.sin(elapsed * 7.3) * 0.006, 0) : null;

  // Zones
  const under = player.feet.y < UNDERGROUND_Y;
  if (under !== wasUnder) { wasUnder = under; setZone(under); }
  applyAir(under);

  sky.update(camera);
  clouds.update(camera);
  lighting.update(dt, clock, player.feet, under);
  ground.copy(player.feet);
  // Under the Dome stack's geodesic glass (house + garden, anywhere inside its footprint): a little hysteresis on
  // the radius keeps the wind's muffling from flickering right at the boundary or the dome door.
  {
    const domeStack = ctx.stacks.dome;
    const R = ctx.house.domeR, margin = 1.5;
    const d = Math.hypot(player.feet.x - domeStack.cx, player.feet.z - domeStack.cz);
    const inside = player.zone === 'surface' && (domeIn == null ? d < R : domeIn ? d < R + margin : d < R - margin);
    domeIn = inside;
  }
  audio.update(dt, camera, { zone: player.zone, altDeg: clock.altDeg, ground, inCar: !!ctx.riding, indoor: ctx.house.inside(player.feet), room: !!ctx.tunnels.lounge?.inside(player.feet), muted: 0, underDome: domeIn });
  // Wind direction breathes slowly.
  atmo.uWind.value.set(Math.cos(elapsed * 0.013) * 1.0, Math.sin(elapsed * 0.017) * 0.5 + 0.3);

  ctx.lod.update();   // distance culling + LOD, after everything that moves the camera
  atmo.uPxH.value = renderer.getDrawingBufferSize(pxSize).y;
  fx.render(elapsed);
  if (!manual) adapt(dt);
  debugReport.tick(dt);
  if (hitch) hitch.frameEnd(shownAt);

  // The centre dot: only while you're free to look and press (not in the intro fade, a cutscene, the eyepiece,
  // which has its own reticle, or the Escape panel).
  const showDot = settings.values.pointer && !ended && !settings.open && !(sequence && !sequence.done) && fx.fade < 0.3 && fx.scope < 0.01 && player.cameraControlled;
  reticle.set(showDot, showDot && pressableAhead());

  if (DEV) {
    statsT += dt;
    if (statsT > 2) {
      statsT = 0;
      const i = renderer.info.render;
      console.log(`[dev] calls=${i.calls} tris=${(i.triangles / 1000).toFixed(0)}k dt=${(dt * 1000).toFixed(1)}ms dpr=${dpr} alt=${clock.altDeg.toFixed(1)} pos=${player.feet.x.toFixed(1)},${player.feet.y.toFixed(1)},${player.feet.z.toFixed(1)} zone=${player.zone}`);
    }
  }
}
requestAnimationFrame(frame);

// ---------- Preload ----------
// Everything compiled, uploaded and drawn once behind the black veil before the player can wake (render/preload.js),
// finishing with a real frame of each representative state. The veil's line fills meanwhile.
{
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const eye = (p) => p.clone().setY(p.y + PLAYER.eye);
  const saved = { phase: clock.phase, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov, scope: fx.scope, fogMul: ctx.scopeFogMul };
  // One real frame (every pass, to the screen, still black under fx.fade) from `from` towards `to`.
  const view = (from, to, { phase = saved.phase, under = false, scope = false } = {}) => () => {
    clock.phase = phase; clock.update(0);
    updateAtmosphere(clock, 0);
    renderer.toneMappingExposure = atmoState.exposure * fx.brightness;
    setZone(under);
    fx.scope = scope ? 1 : 0;
    ctx.scopeFogMul = scope ? 0.3 : 1;
    applyAir(under);
    camera.fov = scope ? 3.2 : saved.fov;
    camera.updateProjectionMatrix();
    camera.position.copy(from);
    camera.lookAt(to);
    camera.updateMatrixWorld();
    sky.update(camera);
    clouds.update(camera);
    lighting.update(0, clock, from, under);
    ctx.lod.update();
    atmo.uPxH.value = renderer.getDrawingBufferSize(pxSize).y;
    fx.render(0);
  };
  const S = ctx.stacks, w = ctx.house.wake, hub = ctx.tunnels.center, lounge = ctx.tunnels.stations.lounge;
  const rim = (a, b) => { const th = Math.atan2(b.cz - a.cz, b.cx - a.cx); return V(a.cx + Math.cos(th) * (a.r - 5), a.top + PLAYER.eye, a.cz + Math.sin(th) * (a.r - 5)); };
  const obs = ctx.observatory?.root.position;
  const skyDir = V(Math.cos(SKY_TARGET.yaw) * Math.cos(SKY_TARGET.pitch - VIEW_DROP), Math.sin(SKY_TARGET.pitch - VIEW_DROP), Math.sin(SKY_TARGET.yaw) * Math.cos(SKY_TARGET.pitch - VIEW_DROP));
  const states = [
    view(eye(w.stand), w.bed),                                                           // the cabin, where you wake
    view(rim(S.dome, S.rocks), V(S.rocks.cx, S.rocks.top, S.rocks.cz), { phase: 0.3 }),  // surface, day
    view(rim(S.rocks, S.tower), V(S.tower.cx, S.tower.top, S.tower.cz), { phase: 0.8 }), // surface, night (stars, moon)
    view(eye(hub.clone().setY(hub.y - 3)), ctx.tunnels.cave.center, { under: true }),    // the cave hub
    lounge && view(eye(lounge.pos), eye(lounge.pos).add(V(Math.sin(lounge.rotY), 0, Math.cos(lounge.rotY))), { under: true }),
    obs && S.rocks.torTop && view(obs.clone().setY(obs.y + 3), S.rocks.torTop, { phase: 0.3, scope: true }),   // the eyepiece, day
    obs && view(obs.clone().setY(obs.y + 3), obs.clone().setY(obs.y + 3).add(skyDir), { phase: 0.8, scope: true }),  // and night
    view(eye(w.stand), w.bed),                                                           // and the first view again
  ].filter(Boolean);
  const hooks = [
    ...(ctx.prewarm || []),                    // the cabin's reflection probe
    () => lighting.refreshEnv(),               // the environment map's targets
    () => audio.prepare(),                     // the sound's noise and reverb buffers (no AudioContext needed)
  ];
  const preloadT = performance.now();
  const stats = await preload({
    renderer, scene, camera, target: fx.composer.readBuffer, lod: ctx.lod, hooks, states,
    onProgress: (f) => setProgress(0.55 + f * 0.45),
  });
  // Back exactly as built: the clock, the camera, the eyepiece and the zones (re-applied on the first frame).
  clock.phase = saved.phase; clock.update(0);
  updateAtmosphere(clock, 0);
  camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.fov = saved.fov; camera.updateProjectionMatrix();
  fx.scope = saved.scope; ctx.scopeFogMul = saved.fogMul;
  wasUnder = null;
  fx.fade = 1;
  if (DEV) {
    const t = Math.round(performance.now());
    window.preloadStats = { readyAt: t, models: Math.round(loadedT - bootT), world: Math.round(preloadT - loadedT), ...stats };
    console.log(`[preload] ready ${t} ms after navigation: models ${window.preloadStats.models} ms, world ${window.preloadStats.world} ms, preload ${stats.times.total} ms`, stats);
  }
  setProgress(1);
  veil.classList.add('ready');
  ready = true;
  if (queued) begin();
}

if (DEV) Object.assign(window, { THREE, ctx, player, clock, renderer, fx, scene, camera, sky, lighting, audio });
if (DEV) {
  // Deterministic recording: stop the real-time loop, render at a fixed size, and advance the game by hand
  // (optionally with the audio engine running in an OfflineAudioContext for frame-exact sound).
  window.capture = {
    // width: 0 keeps the window's size (no render-target reallocation, for the hitch tour).
    begin({ width = 1280, height = 720, audioContext = null } = {}) {
      manual = true;
      started = true;
      if (width) { captureSize = [width, height]; resize(); }
      veil.style.opacity = '0';
      fx.fade = 0;
      player.canMove = true;
      if (audioContext) audio.start(audioContext);
    },
    step: (dt) => step(dt),
    ending: () => { ended = true; interact.enabled = false; sequence = createEnding(ctx); },
    input,
    audio,
    end() { manual = false; captureSize = null; resize(); last = performance.now(); },
  };
}
if (DEV) {
  window.lookAtPt = (x, y, z) => {
    const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  window.pressAt = () => { const p = interact.pick(); return p ? (p.item.onPress?.(p.hit), 'pressed') : 'none'; };
  // Performance sweep over every area: `await bench()` (see dev/bench.js).
  import('./dev/bench.js').then((m) => m.installBench({ THREE, ctx, player, camera, renderer, clock, capture: window.capture, hitch }));
  window.hitchReport = () => {
    const r = hitch.report();
    console.log(`[hitch] after wake-up: ${r.programs} programs, ${r.textures} textures, ${r.buffers} buffers, ${r.renderbuffers} renderbuffers, ${r.reuploads} re-uploads, ${r.slowFrames} frames > 20 ms (of ${r.frames})`);
    console.table(r.byArea);
    return r;
  };
}
