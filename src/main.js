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
import { createStorm } from './render/storm.js';
import { Physics } from './player/collision.js';
import { Player } from './player/controller.js';
import { buildWorld } from './world/index.js';
import { AudioEngine } from './audio/engine.js';
import { createIntro } from './sequences/intro.js';
import { createFall } from './sequences/fall.js';
import { createEnding, prepareEnding } from './sequences/ending.js';
import { onRocksSolved, prepareStairsReveal, revealShots } from './sequences/stairsReveal.js';
import { startDescent, MIDNIGHT } from './sequences/descent.js';
import { createResume } from './sequences/resume.js';
import { createRocksExe, prepareRocksExe } from './sequences/rocksExe.js';
import { installTerminalKeys } from './ui/terminalKeys.js';
import { createSettings, phaseToClock } from './ui/settings.js';
import { createProfiler } from './ui/profiler.js';
import { isDialogOpen } from './ui/kit/index.js';
import { createSaveSystem, readSnapshot, clearSaves, SAVE_KEY } from './core/save.js';
import { createReticle } from './ui/reticle.js';
import { createDebugReport } from './ui/debugReport.js';
import { createScreenshot } from './ui/screenshot.js';
import { loadCabin, PROBE_LAYER } from './props/cabin.js';
import { loadObservatory } from './props/observatory.js';
import { loadCave } from './props/cave.js';
import { loadLounge } from './props/lounge.js';
import { loadElevator } from './props/elevator.js';
import { loadTowerKit } from './props/powertower.js';
import { loadDeck } from './props/deck.js';
import { loadShed } from './props/shed.js';
import { loadWalkstones } from './world/walkway.js';
import { loadTorSculpt } from './world/rockpiles.js';
import { loadMine } from './props/mine.js';
import { loadBunker } from './props/bunkerRoom.js';
import { loadIris } from './props/aperture.js';
import { loadGatehouse } from './props/gatehouse.js';
import { loadEndProps } from './props/pedestal.js';
import { loadAlarmClock } from './props/clock.js';
import { preload } from './render/preload.js';
import { TRAIL } from './world/mountainPath.js';
import { createLoadingVeil } from './ui/loadingVeil.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
// Saved games (core/save.js). ?nosave (and ?spawn, which picks its own start) neither loads nor writes them.
let savesOn = !params.has('nosave') && !params.has('spawn') && !params.has('at');

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

// ---------- Saved game ----------
// The game to wake into: the save, if there is one.
const resumeSnap = savesOn ? readSnapshot(SAVE_KEY) : null;
let restored = false;

// ---------- Timers ----------
const timers = [];
const later = (delay, fn) => timers.push({ at: elapsed + delay, fn });
let elapsed = 0;

// ---------- Loading veil ----------
// The black screen's progress (ui/loadingVeil.js): a track that fills at an even pace to its end, the stage and a
// countdown, then the breathing light and "click to begin". Real progress: the models' download to 10 %, building
// the world to 55 %, the preload (render/preload.js) the rest; the veil maps it onto time from the last load.
const veil = document.getElementById('veil');
const bootT = performance.now();
const loader = createLoadingVeil(veil, bootT);
const setProgress = (f) => loader.progress(f);

// ---------- World ----------
let loaded = 0;
const counted = (p) => p.then((a) => { setProgress((++loaded / 16) * 0.1); return a; });
// (The iris and the ending's pill clock keep their models module-side: their slots are left blank.)
const [cabinAsset, observatoryAsset, caveAsset, loungeAsset, elevatorAsset, towerKitAsset, deckAsset, shedAsset, , walkstoneAsset, torSculpt, mineAsset, bunkerAsset, gatehouseAsset, endPropsAsset] = await Promise.all([loadCabin(), loadObservatory(), loadCave(), loadLounge(), loadElevator(), loadTowerKit(), loadDeck(), loadShed(), loadIris(), loadWalkstones(), loadTorSculpt(), loadMine(), loadBunker(), loadGatehouse(), loadEndProps(), loadAlarmClock()].map(counted));
const loadedT = performance.now();
loader.glide(0.55);                             // the build blocks the page: the fill glides on meanwhile
await new Promise((r) => setTimeout(r, 20));   // let the line show it before the (synchronous) build
const ctx = buildWorld({ renderer, scene, camera, physics, interact, audio, input, fx, later, updaters: [], cabinAsset, observatoryAsset, caveAsset, loungeAsset, elevatorAsset, towerKitAsset, deckAsset, shedAsset, walkstoneAsset, torSculpt, mineAsset, bunkerAsset, gatehouseAsset, endPropsAsset });
ctx.clock = clock;
prepareEnding(ctx);   // the ending's pill clock, steam and credits, hidden until then, so the preload warms them too
prepareRocksExe(ctx, { clock });   // rocks.exe's CCTV overlay (hidden) and its landing picker, warm
prepareStairsReveal(ctx);          // the stairs reveal's flight obstacles (the Rocks' tree crowns, the sequoia's)
// The descent's thunderstorm (render/storm.js): rain, lightning and thunder, built hidden so the preload warms it.
const storm = createStorm({ ctx, scene, camera, sky, clouds, lighting, fx, audio });
ctx.storm = storm;
{
  // No rain in the gatehouse's roofed corridor (its roof runs 6.5 m in from the sill, 1.3 m either side, 3.1 m clear).
  const gf = ctx.gatehouse?.frame;
  if (gf) storm.setShelter({ center: gf.sill.clone().addScaledVector(gf.out, -3.225).setY(gf.sill.y + 1.5), out: gf.out, half: new THREE.Vector3(3.25, 1.6, 1.35) });
  if (DEV && params.has('storm')) storm.set(parseFloat(params.get('storm')) || 1, 0);
}
setProgress(0.55);
const player = new Player(camera, input, physics);
ctx.player = player;
// The cabin's reflection probe sees the sky and every light (see PROBE_LAYER).
sky.mesh.layers.enable(PROBE_LAYER);
scene.traverse((o) => { if (o.isLight) o.layers.enable(PROBE_LAYER); });
const saves = createSaveSystem({
  ctx, player, clock,
  enabled: () => savesOn && !ended,
  // Where the player may be saved: standing free on the ground (not in a sequence or a fall, on a ladder, riding an
  // elevator, at the eyepiece or holding a handwheel). Otherwise a save keeps the last such pose. Seated in a deck
  // chair counts: the feet already stand beside it (Player.sit), so a restore stands the player up there.
  isSafe: () => started && !ended && !(sequence && !sequence.done) && (player.mode === 'walk' || player.mode === 'sit') && player.onGround && player.canMove
    && !ctx.riding && player.cameraControlled && !player.lookHandler && !ctx.gatehouse?.onStairs(player.feet),
});
// How long ago a save was made, for the Escape panel's status line.
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 60 * 24 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
// Start over: no save, and no "Leave site?" on the way out.
function restart() {
  savesOn = false;
  clearSaves();
  removeEventListener('beforeunload', onBeforeUnload);
  location.reload();
}
// Travel (Menu > Game > Travel): straight to a place, standing, facing somewhere worth facing.
// (End only in ?dev sessions: the way there is the gatehouse's stairs, and once down them there is no travelling back.)
const PLACES = [['home', 'Home'], ['generator', 'Generator'], ['rocks', 'Rocks'], ['tower', 'Tower'], ['observatory', 'Observatory'], ...(DEV ? [['end', 'End']] : [])];
function travel(key) {
  if (!started || ended || (sequence && !sequence.done)) return;
  if (settings.travelLocked || ctx.state.endgame?.descent) return;   // the descent: no turning back
  if (ctx.bunker?.terminal?.shell.busy) return;   // rocks.exe running: the player stays at the terminal for it
  if (fx.scope > 0.5) ctx.exitScope?.();
  ctx.exitTerminal?.();
  if (player.mode === 'sit') player.standUp();
  player.zone = 'surface';
  const face = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  if (key === 'home') {
    const w = ctx.house.wake;
    player.place(w.stand.x, w.stand.y, w.stand.z, w.standYaw);
  } else if (key === 'generator' && ctx.tunnels?.cave) {
    // Down in the cave hub, 1.7 m in front of the generator's row of switches, facing them.
    const sw = ctx.interact.items.filter((it) => /^generator-switch:/.test(it.name)).map((it) => it.meshes[0].getWorldPosition(new THREE.Vector3()));
    if (!sw.length) return;
    const mid = sw.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(sw.length);
    const c = ctx.tunnels.cave.center;
    const at = mid.clone().addScaledVector(new THREE.Vector3(c.x - mid.x, 0, c.z - mid.z).normalize(), 1.7);
    player.zone = 'tunnel';
    player.place(at.x, mid.y - 0.95, at.z, face(at, mid));   // (the floor is about 1 m under the switches)
  } else if (key === 'observatory' && ctx.observatory) {
    // Outside its door, facing it.
    const R = ctx.observatory.root, p = R.localToWorld(new THREE.Vector3(0, 0, -9)), door = R.localToWorld(new THREE.Vector3(0, 0, -5));
    const at = freeSpot(ctx.stacks.mountain, p.x, p.z);
    player.place(at.x, at.y, at.z, face(at, door));
  } else if (ctx.stacks[key]) {
    const st = ctx.stacks[key];
    const at = freeSpot(st, st.cx + 6, st.cz + 6);
    player.place(at.x, at.y, at.z, face(at, { x: st.cx, z: st.cz }));
  }
  player.pitch = 0;
}
// Standing on top of the Rocks stack, on your own feet (not below its rim, in its elevator, nor in the gatehouse: the
// stairs reveal's shot climbs out of the island from your eyes): where the Travel page's endgame shortcut works.
function onRocksTop() {
  const st = ctx.stacks.rocks, f = player.feet;
  if (!st || player.zone !== 'surface' || player.mode !== 'walk' || ctx.riding || ctx.gatehouse?.inside(f)) return false;
  const h = st.heightAt(f.x, f.z);
  return h !== null && f.y > h - 1.2 && f.y < h + 3;
}
// The nearest spot to (x, z) on a stack's open ground where you can stand: nothing over it (a ray down from 6 m up
// meets the ground itself first, not a rock, a tree, a roof or the pylon), nothing pushing a player-sized capsule
// aside there, and well in from the edge. Rings of candidates 1.2 m apart, out to 30 m.
const _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0), _probe = new THREE.Vector3();
function freeSpot(st, x0, z0) {
  const surface = physics.colliders.filter((c) => c.enabled && c.zone === 'surface');
  const ok = (x, z) => {
    const h = st.heightAt(x, z);
    if (h === null || st.edgeDist(x, z) < 4) return null;
    _ray.set(_probe.set(x, h + 6, z), _down); _ray.far = 7;
    let first = Infinity;
    for (const c of surface) { const hit = c.bvh.raycastFirst(_ray.ray, THREE.DoubleSide); if (hit) first = Math.min(first, hit.distance); }
    if (Math.abs(first - 6) > 0.15) return null;                              // something over the ground here
    const feet = _probe.set(x, h + 0.02, z);
    physics.resolveCapsule(feet, PLAYER.radius + 0.1, PLAYER.height, 'surface');
    if (Math.hypot(feet.x - x, feet.z - z) > 0.01 || feet.y > h + 0.3) return null;   // pushed aside, or lifted onto something
    return { x, y: h + 0.05, z };
  };
  for (let r = 0; r <= 30; r += 1.2) {
    const n = r === 0 ? 1 : Math.ceil((Math.PI * 2 * r) / 1.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, spot = ok(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r);
      if (spot) return spot;
    }
  }
  return { x: x0, y: (st.heightAt(x0, z0) ?? st.top) + 0.1, z: z0 };
}
// The profiler overlay (Menu > Debug > Profiler): the stack you're on (or nearest), for its position readout.
const nearestStack = (p) => {
  let best = null, bestD = Infinity;
  for (const [name, st] of Object.entries(ctx.stacks)) {
    const d = Math.hypot(p.x - st.cx, p.z - st.cz) - st.r;
    if (d < bestD) { bestD = d; best = { name, x: st.cx, z: st.cz }; }
  }
  return best;
};
const profiler = createProfiler({ renderer, fx, player, clock, stackOf: (p) => (player.zone === 'surface' ? nearestStack(p) : null), timeText: () => phaseToClock(clock.phase) });
// Inside, for the color grade's Neutral indoors: the cabin, the caves and tunnels (and the lounge), the bunker, the mine
// and the observatory's drum.
function indoors() {
  const f = player.feet;
  if (player.zone === 'tunnel') return true;
  if (ctx.house?.inside(f) || ctx.bunker?.inside?.(f) || ctx.mine?.inside?.(f)) return true;
  const a = atmo.uObsA.value, b = atmo.uObsB.value;
  return b.w > 0.5 && Math.hypot(f.x - a.x, f.z - a.y) < a.z && f.y > a.w - 0.5 && f.y < b.y + b.z;
}
const settings = createSettings({
  player, clock, fx, input, canvas: renderer.domElement, baseSpeed: clock.speed, profiler, lighting, indoors,
  game: {
    save: () => saves.save(),
    // Back to the last save: the page loads again and wakes into it (no "Leave site?": the menu already asked).
    load: () => { removeEventListener('beforeunload', onBeforeUnload); location.reload(); },
    hasSave: () => savesOn && saves.hasSave,
    restart,
    travel,
    places: PLACES,
    // Menu > Game > Travel's shortcut into the endgame: the stairs reveal, as if the five boulders had just been set
    // (until the stairs are open), from the top of the Rocks stack.
    endSequence: {
      label: 'Open the way to End',
      state: () => {
        if (!ctx.gatehouse || ctx.state.endgame?.open || ended) return { show: false };
        const ok = started && !(sequence && !sequence.done) && onRocksTop();
        return {
          show: true, ok,
          why: ok ? 'Opens the gatehouse at the Rocks rim and runs its stairs out to End, as setting the five boulders does.'
            : 'Stand on top of the Rocks stack (outside the gatehouse) to open the way to End from there.',
        };
      },
      run: () => onRocksSolved(ctx),
    },
    status: () => {
      if (!savesOn) return { canSave: false, text: ended ? '' : 'Saving is off for this session' };
      const text = saves.savedAt ? `Saved ${ago(saves.savedAt)}${saves.dirty() ? ' · unsaved progress' : ''}` : 'Not saved yet';
      return { canSave: started && !ended, text };
    },
  },
});
ctx.settings = settings;
ctx.onRide = (riding) => { ctx.riding = riding; };
// Cutscenes a prop starts (the bunker terminal's rocks.exe): one at a time, never over the ending. A sequence holds
// presses and travel, isn't a safe pose to save, hides the dot and pauses with the menu.
ctx.startSequence = (s) => { if ((sequence && !sequence.done) || ended || !s) return false; sequence = s; return true; };
ctx.inSequence = () => !!(sequence && !sequence.done);
// The endgame: the Rocks solved opens the gatehouse's stairs (a cutscene, or at once while a save is restored), the
// first step down them starts the descent (midnight, the storm, no way back), and the End pedestal's button the
// ending (the pedestal clicks unless this refuses).
ctx.onRocksSolved = () => onRocksSolved(ctx);
if (ctx.gatehouse) ctx.gatehouse.onFirstStep = () => startDescent(ctx, { clock });
ctx.onPedestal = () => {
  if (!started || ended || (sequence && !sequence.done)) return false;
  ended = true;
  interact.enabled = false;
  sequence = createEnding(ctx);
  return true;
};
ctx.uiOpen = () => settings.open || isDialogOpen();
// What the view is on, when it isn't where the player stands (a cutscene's camera far away): the sun's shadows, the
// light pool (world/index.js) and the sound's ground follow it. null: the player's feet.
ctx.viewFocus = null;
// The bunker's terminal (props/terminal.js): every key to its shell while seated (ui/terminalKeys.js), and rocks.exe
// cutting to the hidden camera on the Rocks (sequences/rocksExe.js).
installTerminalKeys({ ctx, uiOpen: ctx.uiOpen });
if (ctx.bunker?.terminal) {
  // (If it can't start, nothing was fired: rocks.exe may be run again, and the shell comes back by itself.)
  ctx.bunker.terminal.onRun = (term) => {
    if (ctx.startSequence(createRocksExe(ctx, { term, clock }))) return true;
    term.state.ran = false;
    return false;
  };
}
const reticle = createReticle();
ctx.reticle = reticle;   // props/terminal.js flashes the low-battery glyph on a refused press
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
  const dev = params.get('spawn')?.toLowerCase();
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
  if (dev === 'bunker' && ctx.bunker) {
    // In the Tower's bunker, beside the terminal's chair, facing it.
    const s = ctx.bunker.spawn;
    const c = ctx.bunker.room?.center;
    player.zone = 'surface';
    if (s) player.place(s.pos.x, s.pos.y + 0.02, s.pos.z, s.yaw);
    else if (c) player.place(c.x, c.y - 1.5 + 0.02, c.z, 0);
  }
  // ?at=x,y,z[,yawDeg[,pitchDeg]]: exactly where a debug report's player.feet (and yawDeg / pitchDeg) say.
  const at = params.get('at')?.split(',').map(Number);
  if (at && at.length >= 3 && at.slice(0, 3).every(Number.isFinite)) {
    player.zone = at[1] < UNDERGROUND_Y ? 'tunnel' : 'surface';
    player.place(at[0], at[1] + 0.02, at[2], THREE.MathUtils.degToRad(at[3] || 0));
    if (Number.isFinite(at[4])) player.pitch = THREE.MathUtils.degToRad(at[4]);
  }
}

// Footstep surfaces
const q = {};
function surfaceAt(feet) {
  if (player.zone === 'tunnel') return ctx.riding ? 'metal' : ctx.tunnels.lounge?.inside(feet) ? 'wood' : 'cave';
  if (ctx.house.inside(feet)) return 'wood';
  if (ctx.bunker?.inside(feet)) return 'rock';   // its concrete
  if (ctx.mine?.inside(feet)) return 'gravel';   // the adit's rubble floor
  if (ctx.deck?.on(feet)) return 'wood';
  if (ctx.walkway?.on(feet.x, feet.z)) return 'rock';   // the Home stack's limestone walkway
  if (ctx.shed?.on(feet)) return 'rock';   // the Mountain shed's flagstones
  const tr = ctx.mountainTrail;              // the Mountain's switchbacks: pebbles, and timber on the steps' ties
  if (tr && tr.near(feet.x, feet.z, q).d < TRAIL.width / 2 + 0.12 && Math.abs(feet.y - q.y) < 0.8) return tr.tieAt(q.s) ? 'wood' : 'gravel';
  if (ctx.gatehouse?.onStairs(feet)) return 'metal';   // the staircase's grating
  if (ctx.gatehouse?.inside(feet)) return 'rock';      // the gatehouse corridor's concrete
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
  else sequence = restored ? createResume(ctx) : createIntro(ctx);
  last = performance.now();
}
// What a press right now would do something to (the reticle's highlight uses the same test as the press).
// (Seated in a deck chair a press only stands you up, so nothing lights the dot.)
const pressableAhead = () => interact.enabled && player.mode !== 'sit' && (!!interact.held || !!interact.pick());

input.on('press', () => {
  if (!started || ended || settings.open || isDialogOpen()) return;
  if (sequence && !sequence.done) return;
  if (player.mode === 'sit') {   // seated in a deck chair (props/deck.js), or at the bunker's terminal (it may hold you)
    const term = ctx.bunker?.terminal;
    if (term && player.seat === term.seat) term.leave(); else player.standUp();
    return;
  }
  if (fx.scope > 0.5 && ctx.exitScope) { ctx.exitScope(); return; }   // at the telescope: any click leaves (ui/scopeExit.js)
  interact.press();
});
input.on('release', () => interact.release());

// The OS cursor is hidden (index.html) while the game has the mouse; show it whenever it doesn't.
const freeCursor = () => document.body.classList.toggle('free', started && !document.pointerLockElement);
document.addEventListener('pointerlockchange', freeCursor);
document.addEventListener('pointerlockerror', freeCursor);   // embeds that refuse the lock keep a visible cursor

// F7: a screenshot of the view (ui/screenshot.js), once the game has begun.
const screenshot = createScreenshot({ canvas: renderer.domElement, enabled: () => started });
const debugReport = createDebugReport({
  ctx, player, camera, clock, renderer, scene, physics, interact, settings, fx, pressableAhead,
  skip: [sky.mesh, clouds.group],   // the sky dome and cloud sea would swallow every ray
  game: () => ({ started, ended, sequence: sequence ? { done: !!sequence.done } : null, elapsed, dpr, underground: !!wasUnder, storm: { level: storm.level, flash: storm.flash } }),
});

// ---------- Leaving ----------
// Browsers allow no custom UI on unload, only their own "Leave site?" prompt: it is asked for while there is progress
// the save doesn't have. Leave anyway and that progress is gone: the next load resumes from the save.
function onBeforeUnload(e) {
  if (!saves.dirty()) return;
  e.preventDefault();
  e.returnValue = '';
}
// (Not in ?dev sessions: the dev server's reloads would ask every time.)
let unloadGuard = false;
setInterval(() => {
  const want = started && !DEV && saves.dirty();
  if (want === unloadGuard) return;
  unloadGuard = want;
  if (want) addEventListener('beforeunload', onBeforeUnload); else removeEventListener('beforeunload', onBeforeUnload);
}, 1000);

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
  atmo.uFogDensity.value = under ? 0.02 : 0.00085 * fogSet.fogDensity * (ctx.scopeFogMul ?? 1) * storm.fogMul;
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
  const cpu0 = performance.now();
  if (hitch) { if (!hitch.armed) hitch.arm(); hitch.frameStart(); }
  elapsed += dt;
  // Count the whole frame (every post pass), not just the last render call: the dev log and debug reports read it.
  renderer.info.autoReset = false;
  renderer.info.reset();

  for (let i = timers.length - 1; i >= 0; i--) if (elapsed >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); }

  clock.update(dt);
  updateAtmosphere(clock, elapsed);
  storm.afterAtmosphere();   // the overcast and the lightning, over the sky's colours and the exposure
  renderer.toneMappingExposure = atmoState.exposure * fx.brightness;
  settings.tick();
  settings.update(dt);   // the color grade by time of day, faded out indoors

  // The world holds still while the menu or a dialog (a bug report) is open (the sky keeps turning unless paused).
  if (!settings.open && !isDialogOpen()) {
    if (sequence) { sequence.update(dt); if (sequence.done && !ended) sequence = null; }
    player.update(dt);
    for (const u of ctx.updaters) u(dt);
    saves.tick(dt);
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
  storm.afterSky();
  clouds.update(camera);
  lighting.update(dt, clock, ctx.viewFocus ?? player.feet, under);
  storm.afterLighting();
  ground.copy(ctx.viewFocus ?? player.feet);
  // Under the Dome stack's geodesic glass (house + garden, anywhere inside its footprint): a little hysteresis on
  // the radius keeps the wind's muffling from flickering right at the boundary or the dome door.
  {
    const domeStack = ctx.stacks.dome;
    const R = ctx.house.domeR, margin = 1.5;
    const d = Math.hypot(player.feet.x - domeStack.cx, player.feet.z - domeStack.cz);
    const inside = player.zone === 'surface' && (domeIn == null ? d < R : domeIn ? d < R + margin : d < R - margin);
    domeIn = inside;
  }
  audio.update(dt, camera, { zone: player.zone, altDeg: clock.altDeg, ground, inCar: !!ctx.riding, indoor: ctx.house.inside(player.feet), room: !!ctx.tunnels.lounge?.inside(player.feet), muted: 0, underDome: domeIn,
    sealed: ctx.viewFocus ? 0 : (ctx.bunker?.sealed?.(player.feet) ?? 0) });   // deep in the bunker the outside barely gets in
  // Wind direction breathes slowly.
  atmo.uWind.value.set(Math.cos(elapsed * 0.013) * 1.0, Math.sin(elapsed * 0.017) * 0.5 + 0.3);
  storm.update(dt, { under, elapsed });

  ctx.lod.update();   // distance culling + LOD, after everything that moves the camera
  atmo.uPxH.value = renderer.getDrawingBufferSize(pxSize).y;
  fx.render(elapsed);
  debugReport.afterRender();   // a bug report's screenshot, while this frame is still in the drawing buffer
  screenshot.afterRender();    // F7's, likewise
  if (!manual) adapt(dt);
  debugReport.tick(dt);
  profiler.tick(dt, performance.now() - cpu0, fx.scope > 0.5);
  if (hitch) hitch.frameEnd(shownAt);

  // The centre dot: only while you're free to look and press (not in the intro fade, a cutscene, the eyepiece,
  // which has its own reticle, the bunker's terminal, whose screen has its cursor, or the menu).
  const showDot = settings.values.pointer && !ended && !settings.open && !isDialogOpen() && !(sequence && !sequence.done) && fx.fade < 0.3 && fx.scope < 0.01 && player.cameraControlled
    && !ctx.bunker?.terminal?.active();
  reticle.set(showDot, showDot && pressableAhead());
  if (settings.open || isDialogOpen() || ended) reticle.hideFlash();

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
  // One real frame (every pass, to the screen, still black under fx.fade) from `from` towards `to`. fov: the camera's
  // (else the player's); feed: through the CCTV look (rocks.exe's hidden camera).
  const view = (from, to, { phase = saved.phase, under = false, scope = false, aa = null, fov = null, feed = false, stormy = false } = {}) => () => {
    const aa0 = fx.aa;
    if (aa) fx.setAA(aa);
    if (stormy) storm.preview(true);   // (before applyAir: it sets the fog's multiplier)
    clock.phase = phase; clock.update(0);
    updateAtmosphere(clock, 0);
    storm.afterAtmosphere();
    renderer.toneMappingExposure = atmoState.exposure * fx.brightness;
    setZone(under);
    fx.scope = scope ? 1 : 0;
    ctx.scopeFogMul = scope ? 0.3 : 1;
    applyAir(under);
    camera.fov = scope ? 3.2 : fov ?? saved.fov;
    camera.updateProjectionMatrix();
    camera.position.copy(from);
    camera.lookAt(to);
    camera.updateMatrixWorld();
    sky.update(camera); storm.afterSky();
    clouds.update(camera);
    lighting.update(0, clock, from, under); storm.afterLighting();
    ctx.lod.update();
    atmo.uPxH.value = renderer.getDrawingBufferSize(pxSize).y;
    fx.feed = feed ? 1 : 0;
    fx.render(0);
    fx.feed = 0;
    if (stormy) storm.preview(false);
    if (aa) fx.setAA(aa0);
  };
  const S = ctx.stacks, w = ctx.house.wake, hub = ctx.tunnels.center, lounge = ctx.tunnels.stations.lounge;
  const rim = (a, b) => { const th = Math.atan2(b.cz - a.cz, b.cx - a.cx); return V(a.cx + Math.cos(th) * (a.r - 5), a.top + PLAYER.eye, a.cz + Math.sin(th) * (a.r - 5)); };
  const obs = ctx.observatory?.root.position;
  const cam07 = S.rocks.hiddenCam;
  // The bunker room's own points (room-local metres, props/bunkerRoom.js) in the world; its glass, from the seat's angles.
  const room = ctx.bunker?.room?.group;
  room?.updateWorldMatrix(true, false);
  const bunkerAt = (x, y, z) => (room ? room.localToWorld(V(x, y, z)) : null);
  const bunkerView = (from, to) => from && to && view(from, to);
  const bunkerGlass = () => { const s = ctx.bunker.seat; return s.eye.clone().add(V(-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch))); };
  // The endgame's views: the gatehouse open (by day, and at midnight from the reveal's hold), and the End at the clock.
  const gh = ctx.gatehouse, shots = gh && revealShots(gh.frame);
  const opened = (f) => () => { gh.setState({ doors: 1, extended: true }); gh.setBeacon(true); gh.setLamps(1); f(); gh.setState({ doors: 0, extended: false }); gh.setBeacon(false); gh.setLamps(0); };
  const ped = ctx.pedestal, ap = ctx.aperture, ep = ctx.endingProps;
  const endEye = ped && ap ? ped.root.position.clone().addScaledVector(V(ped.root.position.x - ap.center.x, 0, ped.root.position.z - ap.center.z).normalize(), 1.1).setY(ped.root.position.y + PLAYER.eye) : null;
  const ending = (f) => () => { const c = ep.clock; c.visible = true; c.position.copy(endEye).addScaledVector(V(ap.center.x - endEye.x, 0, ap.center.z - endEye.z).normalize(), 2.2); c.lookAt(endEye); ctx.lightShafts?.set(1); f(); c.visible = false; ctx.lightShafts?.set(0); };
  const skyDir = V(Math.cos(SKY_TARGET.yaw) * Math.cos(SKY_TARGET.pitch - VIEW_DROP), Math.sin(SKY_TARGET.pitch - VIEW_DROP), Math.sin(SKY_TARGET.yaw) * Math.cos(SKY_TARGET.pitch - VIEW_DROP));
  const states = [
    view(eye(w.stand), w.bed),                                                           // the cabin, where you wake
    view(rim(S.dome, S.rocks), V(S.rocks.cx, S.rocks.top, S.rocks.cz), { phase: 0.3 }),  // surface, day
    view(rim(S.rocks, S.tower), V(S.tower.cx, S.tower.top, S.tower.cz), { phase: 0.8 }), // surface, night (stars, moon)
    view(eye(hub.clone().setY(hub.y - 3)), ctx.tunnels.cave.center, { under: true }),    // the cave hub
    lounge && view(eye(lounge.pos), eye(lounge.pos).add(V(Math.sin(lounge.rotY), 0, Math.cos(lounge.rotY))), { under: true }),
    obs && S.rocks.torTop && view(obs.clone().setY(obs.y + 3), S.rocks.torTop, { phase: 0.3, scope: true }),   // the eyepiece, day
    obs && view(obs.clone().setY(obs.y + 3), obs.clone().setY(obs.y + 3).add(skyDir), { phase: 0.8, scope: true }),  // and night
    // The Tower's bunker: from the lift's doorway toward the stair, and seated at the terminal (props/bunkerRoom.js).
    bunkerView(bunkerAt(0, 1.66, 3.3), bunkerAt(0, 1.2, 0)),
    ctx.bunker?.seat && view(ctx.bunker.seat.eye, bunkerGlass(), { fov: ctx.bunker.seat.fov }),
    // rocks.exe's hidden camera (sequences/rocksExe.js): CAM 07 on the tor, through the CCTV look, by day and night.
    cam07 && view(cam07.pos, cam07.look, { phase: 0.3, fov: cam07.fov, feed: true }),
    cam07 && view(cam07.pos, cam07.look, { phase: 0.8, fov: cam07.fov, feed: true }),
    // The endgame: the gatehouse open by day and from the reveal's hold at midnight, the storm from End, the clock.
    shots && opened(view(shots.doors.from, shots.doors.to, { phase: 0.3 })),
    shots && opened(view(shots.hold.from, shots.hold.to, { phase: MIDNIGHT })),
    view(rim(S.end, S.rocks), V(S.rocks.cx, S.rocks.top, S.rocks.cz), { phase: MIDNIGHT, stormy: true }),
    endEye && ep && ending(view(endEye, ap.center.clone().setY(ap.center.y + 1.6), { phase: MIDNIGHT, fov: 57, stormy: true })),
    view(eye(w.stand), w.bed, { aa: 'fxaa' }),                                           // the FXAA pass's program
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
  // The saved game to wake into: put it back, and draw one real frame of where it stands.
  const snap = resumeSnap;
  if (snap) {
    saves.restore(snap, { keepClock: params.has('t') });
    saves.setBaseline(snap, snap.time);
    restored = true;
    saved.phase = clock.phase;
    const at = eye(player.feet);
    view(at, at.clone().add(player.forward()), { under: player.feet.y < UNDERGROUND_Y })();
  } else {
    saves.setBaseline(saves.snapshot());
  }
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
  loader.ready();
  ready = true;
  if (queued) begin();
}

if (DEV) Object.assign(window, { THREE, ctx, player, clock, renderer, fx, scene, camera, sky, lighting, audio, saves, storm });
if (DEV) {
  // Deterministic recording: stop the real-time loop, render at a fixed size, and advance the game by hand
  // (optionally with the audio engine running in an OfflineAudioContext for frame-exact sound).
  window.capture = {
    // width: 0 keeps the window's size (no render-target reallocation, for the hitch tour).
    begin({ width = 1280, height = 720, audioContext = null } = {}) {
      manual = true;
      savesOn = false;   // a scripted tour is not progress
      started = true;
      if (width) { captureSize = [width, height]; resize(); }
      veil.style.opacity = '0';
      fx.fade = 0;
      player.canMove = true;
      if (audioContext) audio.start(audioContext);
    },
    step: (dt) => step(dt),
    ending: () => { if (ctx.pedestal?.item) ctx.pedestal.item.onPress(); else { ended = true; interact.enabled = false; sequence = createEnding(ctx); } },
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
  window.endgame = { reveal: () => onRocksSolved(ctx), descend: () => startDescent(ctx, { clock }) };
  window.pressAt = () => { const p = interact.focus ? { item: interact.focus, hit: null } : interact.pick(); return p ? (p.item.onPress?.(p.hit), 'pressed') : 'none'; };
  // Performance sweep over every area: `await bench()` (see dev/bench.js).
  import('./dev/bench.js').then((m) => m.installBench({ THREE, ctx, player, camera, renderer, clock, capture: window.capture, hitch }));
  window.hitchReport = () => {
    const r = hitch.report();
    console.log(`[hitch] after wake-up: ${r.programs} programs, ${r.textures} textures, ${r.buffers} buffers, ${r.renderbuffers} renderbuffers, ${r.reuploads} re-uploads, ${r.slowFrames} frames > 20 ms (of ${r.frames})`);
    console.table(r.byArea);
    return r;
  };
}
