// Headless world: builds the real world (src/world/index.js buildWorld, all five stacks in game order with the
// game's Rng streams) under Node with a stubbed canvas, the real GLB scenes and the real Physics.
//
// Values the anchors need that live in build-function locals are recorded by "taps": a module hook
// redirects every import of a tapped module to a generated wrapper that re-exports the real module and
// wraps the listed functions with a pass-through recorder. The real code runs unchanged, in the same order.
//
// Flags are read by src/config.js at module evaluation, so buildHeadless() must be the first thing that
// imports anything under src/ in this process (run.mjs gives every variant its own process).
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = pathToFileURL(path.join(ROOT, 'src')).href + '/';

// module (relative to src/) -> exported functions to record
const TAPS = {
  'world/stacks/dome.js': ['buildDome'],
  'world/stacks/rocks.js': ['buildRocks'],
  'world/stacks/end.js': ['buildEnd'],
  'world/stacks/tower.js': ['buildTower'],
  'world/stacks/mountain.js': ['buildMountain'],
  'world/features.js': ['buildLedge', 'buildLadder', 'buildCave', 'buildTrail', 'scatter'],
  'world/water.js': ['edgeWaterfall', 'streamGeometry'],
  'world/waterfx.js': ['splashFX'],
  'world/rockpiles.js': ['buildTor', 'buildRockPile'],
  'world/bridge.js': ['buildBridge'],
  'props/cabin.js': ['placeCabin'],
  'props/observatory.js': ['placeObservatory'],
  'props/powertower.js': ['buildPowerTower'],
  'props/aperture.js': ['createAperture'],
  'props/sequoia.js': ['buildSequoia'],
  'props/movableRocks.js': ['createMovableRocks'],
  'props/elevator.js': ['createElevator'],
};
const TAP_URLS = new Map(Object.entries(TAPS).map(([k, v]) => [SRC + k, { mod: k, names: v }]));

function installHooks() {
  registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      return TAP_URLS.has(r.url) ? { ...r, url: r.url + '?tap' } : r;
    },
    load(url, context, next) {
      if (!url.endsWith('?tap')) return next(url, context);
      const real = url.slice(0, -4);
      const { mod, names } = TAP_URLS.get(real);
      const src = [`import * as R from ${JSON.stringify(real + '?real')};`, `export * from ${JSON.stringify(real + '?real')};`];
      // Function declarations (hoisted), so a cyclic import never meets an uninitialised binding.
      for (const n of names) src.push(`export function ${n}(...a) { return globalThis.__REGRESS_TAP(${JSON.stringify(mod)}, ${JSON.stringify(n)}, R.${n}, this, a); }`);
      return { format: 'module', source: src.join('\n'), shortCircuit: true };
    },
  });
}

// Minimal DOM so Textures/materials can draw their canvases (the pixels are never read back).
function installDom() {
  const ctx2d = () => new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createImageData' || k === 'getImageData') {
        return (a, b, w, h) => {
          const W = typeof a === 'object' ? a.width : w ?? a, H = typeof a === 'object' ? a.height : h ?? b;
          return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
        };
      }
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const el = () => ({ width: 1, height: 1, style: {}, getContext: ctx2d, toDataURL: () => '', addEventListener() {} });
  globalThis.document ??= { createElement: el, createElementNS: el };
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;
}

const v3 = (v) => (v ? [v.x, v.y, v.z] : null);

// Records what the taps and instance wrappers see. `stack` is the stack being built when a call happened.
class Recorder {
  constructor() {
    this.stack = null;
    this.calls = [];          // every tapped call: { mod, name, stack, info }
    this.adds = [];           // forest / meadow / pebble / flower placements: { kind, stack, x, y, z, s, sp }
    this.emitters = [];
    this.installed = false;
  }

  // ctx arrives with the first stack build: wrap the shared instances before anything is scattered.
  wrapCtx(ctx) {
    if (this.installed) return;
    this.installed = true;
    const rec = this;
    const wrap = (obj, key, fn) => { const orig = obj[key]; obj[key] = function (...a) { fn(a); return orig.apply(this, a); }; };
    wrap(ctx.forest, 'add', ([sp, x, y, z, s]) => rec.adds.push({ kind: sp === 'shrub' ? 'shrub' : 'tree', sp, stack: rec.stack, x, y, z, s }));
    wrap(ctx.meadow, 'add', ([x, y, z, s]) => rec.adds.push({ kind: 'meadow', stack: rec.stack, x, y, z, s }));
    let inScatter = 0;
    const ps = ctx.pebbles.scatter;
    ctx.pebbles.scatter = function (...a) { inScatter++; try { return ps.apply(this, a); } finally { inScatter--; } };
    wrap(ctx.pebbles, 'addAt', ([x, y, z, s]) => rec.adds.push({ kind: inScatter ? 'pebble' : 'stone', stack: rec.stack, x, y, z, s }));
  }

  // Captures geometry a builder hands its batcher (tor and pile shells).
  spyBatcher(opts, sink) {
    if (!opts?.batcher) return;
    const b = opts.batcher, add = b.add;
    opts.batcher = Object.create(b);
    opts.batcher.add = (...a) => { const g = add.apply(b, a); sink.push({ geo: g, material: a[1] }); return g; };
  }

  tap(mod, name, fn, self, a) {
    const info = {};
    const call = { mod, name, stack: this.stack, info };
    this.calls.push(call);
    const stackName = mod.startsWith('world/stacks/') ? path.basename(mod, '.js') : null;
    if (stackName) { this.wrapCtx(a[0]); this.stack = stackName; }
    if (name === 'buildTor' || name === 'buildRockPile') { info.geos = []; a[1] = { ...a[1] }; this.spyBatcher(a[1], info.geos); }
    let ret;
    try { ret = fn.apply(self, a); } finally { if (stackName) this.stack = null; }
    this.describe(call, a, ret);
    return ret;
  }

  describe(call, a, ret) {
    const { name, info } = call;
    const o = a[1] || {};
    switch (name) {
      case 'buildLedge':
        info.stack = a[0].cfg.name;
        info.samples = a[1].map((s) => ({ theta: s.theta, depth: s.depth, width: s.width }));
        info.geometry = ret;
        break;
      case 'buildLadder': info.base = v3(o.base); info.n = v3(o.n); info.height = o.height; break;
      case 'buildCave':
        info.mouth = v3(o.mouth); info.dir = v3(o.dir); info.length = o.length;
        info.platePos = v3(ret?.platePos); info.plateRot = ret?.plateRot;
        break;
      case 'buildTrail': info.stack = a[0].cfg.name; info.geometry = ret; break;
      case 'scatter':
        info.stack = a[0].cfg.name; info.count = a[1]; info.opts = a[4] ?? null;
        info.out = ret.map((p) => [p.x, p.y, p.z]);
        break;
      case 'edgeWaterfall':
        info.theta = o.theta; info.lip = v3(o.lip); info.width = o.width; info.drop = o.drop;
        info.path = ret?.userData?.path?.map(v3) ?? null; info.widths = ret?.userData?.widths ?? null; info.fallDrop = ret?.userData?.drop ?? null;
        break;
      case 'streamGeometry': info.points = a[0].map(v3); info.widths = [...a[1]]; break;
      case 'splashFX': info.pos = v3(a[0]?.pos); break;
      case 'buildTor':
        Object.assign(info, { x: o.x, z: o.z, radius: o.radius, height: o.height });
        info.top = v3(ret.top); info.splash = v3(ret.splash); info.poolRadius = ret.poolRadius;
        info.walls = ret.walls; info.cascade = ret.cascade?.map(v3) ?? null; info.blocker = ret.blocker;
        break;
      case 'buildRockPile':
        Object.assign(info, { x: o.x, z: o.z, radius: o.radius, height: o.height });
        info.walls = ret.walls; info.blocker = ret.blocker;
        break;
      case 'buildBridge': info.a = v3(o.a); info.b = v3(o.b); info.sag = o.sag ?? 2.2; info.width = o.width ?? 1.3; info.deckAt = ret?.deckAt; break;
      case 'placeCabin': info.origin = v3(a[2]?.origin); break;
      case 'placeObservatory': info.center = v3(a[2]?.center); info.doorAngle = a[2]?.doorAngle; break;
      case 'buildPowerTower': info.base = v3(o.base); info.rotY = o.rotY; break;
      case 'createAperture': info.center = v3(o.center); info.radius = o.radius; break;
      case 'buildSequoia':
        info.x = o.x; info.y = o.y; info.z = o.z;
        info.platePos = v3(ret?.platePos); info.plateRot = ret?.plateRot; info.footprintR = ret?.footprintR; info.height = ret?.height;
        break;
      case 'createMovableRocks': info.spots = a[2].map((s) => ({ x: s.x, z: s.z, r: s.r })); break;
      case 'createElevator': info.id = o.id; info.top = v3(o.ends?.top?.pos); info.topRot = o.ends?.top?.rotY; break;
      default: break;
    }
  }
}

const parseGlb = (GLTFLoader, file) => new Promise((res, rej) => {
  const b = fs.readFileSync(path.join(ROOT, 'public/models', file));
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});

// Builds the world once. walls: the ?walls= string (undefined = config defaults).
export async function buildHeadless({ walls } = {}) {
  if (globalThis.__REGRESS_TAP) throw new Error('buildHeadless: one world per process (flags are read at module evaluation)');
  if (walls !== undefined) globalThis.__WALLS = walls;
  installDom();
  installHooks();
  const THREE = await import('three');
  const rec = new Recorder();
  globalThis.__REGRESS_TAP = (mod, name, fn, self, a) => rec.tap(mod, name, fn, self, a);

  const imp = (p) => import(SRC + p);
  const config = await imp('config.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const [cabin, observatory, cave, lounge, elevator, towerKit, deck] = await Promise.all(['cabin.glb', 'observatory.glb', 'cave.glb', 'lounge.glb', 'elevator.glb', 'tower_kit.glb', 'deck.glb'].map((f) => parseGlb(GLTFLoader, f)));
  const { Physics } = await imp('player/collision.js');
  const { Stack } = await imp('world/terrain.js');
  const { Flowers } = await imp('world/flowers.js');
  const { materials } = await imp('render/materials.js');
  const { buildWorld } = await imp('world/index.js');

  // Per-stack collider pieces added by Stack.build (cap, then the cliff's top rows).
  const stackColliders = {};
  const build = Stack.prototype.build;
  Stack.prototype.build = function (collider) {
    const n0 = collider ? collider.geos.length : 0;
    const r = build.call(this, collider);
    stackColliders[this.cfg.name] = collider ? collider.geos.slice(n0) : [];
    return r;
  };
  const fadd = Flowers.prototype.add;
  Flowers.prototype.add = function (x, y, z, kind, s) { rec.adds.push({ kind: 'flower', stack: rec.stack, x, y, z, s, sp: kind }); return fadd.apply(this, arguments); };

  const tex = () => new THREE.Texture();
  const physics = new Physics();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.12, 14000);
  const t0 = performance.now();
  const audio = {
    registerEmitter: (name, pos, zone, extra) => rec.emitters.push({ name, pos: v3(pos), zone, spots: extra?.spots?.map(v3) ?? null }),
    play() {}, loop: () => null,
  };
  const ctx = buildWorld({
    renderer: {}, scene, camera, physics, interact: { add: (o) => o }, audio, input: {}, fx: {}, later() {}, updaters: [],
    cabinAsset: { gltf: cabin, ao: tex() }, observatoryAsset: { gltf: observatory, ao: tex() },
    caveAsset: { gltf: cave, lm0: tex(), lm1: tex(), rock: tex(), paint: tex(), grime: tex() },
    loungeAsset: { gltf: lounge, lm: tex(), wood: tex(), leather: tex(), map: tex(), card: tex(), dots: tex(), rug: tex(), prints: tex(), floor: tex() },
    elevatorAsset: { gltf: elevator, extAlbedo: tex(), extNormal: tex(), extOrm: tex(), intAlbedo: tex(), intLm: tex() },
    towerKitAsset: { gltf: towerKit, albedo: tex(), normal: tex(), orm: tex() },
    deckAsset: { gltf: deck, ao: tex(), wood: tex(), normal: tex() },
  });
  const buildMs = performance.now() - t0;
  Stack.prototype.build = build;
  Flowers.prototype.add = fadd;
  return { THREE, ctx, physics, rec, config, stackColliders, materials: materials(), imp, buildMs };
}
