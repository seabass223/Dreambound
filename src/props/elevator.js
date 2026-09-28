import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { addKeepOut } from '../render/lod.js';

const RIDE = 8;
const LOUNGE_RIDE = 6;   // the short drop from the Tower's cave station to its hidden lounge
const DOOR_TIME = 1.7;
// The car's inside, and the doorway (tools/blender/elevator_design.py keeps every end's placement to these).
const CAR = { hw: 1.05, h: 2.6, z0: -0.16, z1: -2.35 };
const HOLE = { hw: 0.68, h: 2.3 };
const TRAVEL = HOLE.hw + 0.02;
// Below this much door opening the car counts as shut for sound: the outside fades out over the last ~0.3 s of the close.
const SHUT = 0.2;
const CALL_POS = [1.12, 1.15, 0.09];   // the call button's centre on the faceplate (the lounge moves it onto its panelling)

// The model: the car's inside, the landing (faceplate, stainless casings, diamond-plate sill) and two sliding leaves,
// modeled and baked in Blender. The outside is lit PBR (albedo, normal, AO/roughness/metalness); the inside is unlit,
// its ceiling lamp baked into a lightmap, so it reads the same at every end.
const FILES = {
  extAlbedo: 'elevator_ext_albedo.png', extNormal: 'elevator_ext_normal.png', extOrm: 'elevator_ext_orm.png',
  intAlbedo: 'elevator_int_albedo.png', intLm: 'elevator_int_lm.png',
};

export async function loadElevator() {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const keys = Object.keys(FILES);
  const [gltf, ...tex] = await Promise.all([loader.loadAsync(base + 'elevator.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
  const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
  for (const [k, t] of Object.entries(T)) {
    t.flipY = false;                                  // glTF UVs
    t.colorSpace = k.endsWith('Albedo') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    if (k === 'intLm') {
      // Small charts on a shared atlas: mipmaps would bleed their neighbours in.
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
    }
  }
  return { gltf, ...T };
}

// ---------------------------------------------------------------- materials
// Underground nothing lights the car's outside but the door lamps, and bare stainless without a sky to reflect goes
// black: a faint, cave-coloured ambient (irradiance and a matching reflection) keeps it readable there.
const FILL = new THREE.Color(0.030, 0.026, 0.021);

// Brushed stainless is anisotropic: its highlights smear across the grain. Every brushed island in the atlas has its grain
// along v, so the anisotropy runs along u; it applies to the metal only (metalness), not the paint, rubber or scale.
function outsideMaterial(T, U) {
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'elevator_outside', map: T.extAlbedo, normalMap: T.extNormal, normalScale: new THREE.Vector2(1, -1),   // green flipped for glTF UVs
    roughnessMap: T.extOrm, metalnessMap: T.extOrm, aoMap: T.extOrm, roughness: 1, metalness: 1, anisotropy: 0.45,
    // The leaves' track is flush with each landing's floor (rock, boards, the lounge's planks): win those depth ties.
    polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -24,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uElevFill = U.uElevFill;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uElevFill;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_ANISOTROPY
          material.anisotropy *= metalnessFactor;
          material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
        #endif`)
      .replace('#include <lights_fragment_end>', 'irradiance += uElevFill * PI; radiance += uElevFill;\n#include <lights_fragment_end>');
  };
  patchMaterial(mat);
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + '|elevator';
  return mat;
}

// The inside: albedo x baked lamp light (stored cube-root), plus a small highlight of the lamp on the stainless (the
// albedo's alpha). material.color dims it all when the power is off.
function insideMaterial(T, U) {
  // Pulled a hair toward the camera: where a placement's floor is flush with the car's (the Mountain shed's is), the car wins.
  const mat = new THREE.MeshBasicMaterial({ name: 'elevator_inside', map: T.intAlbedo, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -24 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLampL;\nvarying vec3 vEV;\nvarying vec3 vEN;\nvarying vec3 vEL;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vEV = mvPosition.xyz; vEN = normalize(normalMatrix * normal); vEL = (modelViewMatrix * vec4(uLampL, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uLm;
        uniform float uLmScale, uGain, uSpec;
        varying vec3 vEV;
        varying vec3 vEN;
        varying vec3 vEL;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float shine = diffuseColor.a; diffuseColor.a = opacity;
          vec3 s = texture2D(uLm, vMapUv).rgb;
          vec3 lt = s * s * s * uLmScale * uGain;
          vec3 N = normalize(vEN), V = normalize(-vEV), L = normalize(vEL - vEV);
          float reach = clamp(dot(lt, vec3(0.3, 0.59, 0.11)) * 1.2, 0.0, 1.0);
          float hl = pow(max(dot(N, normalize(L + V)), 0.0), 60.0) * max(dot(N, L), 0.0);
          diffuseColor.rgb = diffuseColor.rgb * lt + shine * hl * reach * uSpec * diffuse * vec3(1.0, 0.86, 0.66); }`);
  };
  patchMaterial(mat);
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + '|elevator_inside';
  return mat;
}

// ---------------------------------------------------------------- the model, shared by every end
let shared = null;
function sharedAssets(asset) {
  if (shared) return shared;
  const scene = asset.gltf.scene;
  scene.updateMatrixWorld(true);
  const nodes = {};
  scene.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const kindOf = (m) => {
    const n = m.material?.name || '';
    return n.startsWith('elev_x_') ? 'ext' : n.startsWith('elev_i_') ? 'int' : n === 'elev_glow' ? 'glow' : null;
  };
  const partOf = (o) => { for (let p = o; p; p = p.parent) if (/^(LEAF_|BTN_call_)/.test(p.name)) return p; return null; };
  const m4 = new THREE.Matrix4();
  // Every mesh under `root` (or, with no root, every static one), per material group, in root's space.
  const collect = (root) => {
    const out = { ext: [], int: [], glow: [] };
    const inv = root ? root.matrixWorld.clone().invert() : new THREE.Matrix4();
    (root || scene).traverse((o) => {
      if (!o.isMesh || (!root && partOf(o))) return;
      const k = kindOf(o);
      if (!k) return;
      const g = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'uv']) if (o.geometry.attributes[a]) g.setAttribute(a, o.geometry.attributes[a].clone());
      g.setIndex(o.geometry.index.clone());
      out[k].push(g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)));
    });
    return out;
  };
  const merge = (list) => {
    if (!list.length) return null;
    const g = mergeGeometries(list, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };
  const stat = collect(null);
  const leaf = (n) => { const c = collect(nodes[n]); return { ext: merge(c.ext), int: merge(c.int), pos: nodes[n].position.clone() }; };
  const meta = nodes.META?.userData ?? {};
  const intU = {
    uLm: { value: asset.intLm }, uLmScale: { value: meta.lm_scale ?? 1 }, uGain: { value: 0.8 }, uSpec: { value: 0.3 },
    uLampL: { value: nodes.LAMP ? nodes.LAMP.position.clone() : new THREE.Vector3(0, 2.55, (CAR.z0 + CAR.z1) / 2) },
  };
  const extU = { uElevFill: { value: new THREE.Color(0, 0, 0) } };
  const btn = (n, x, y) => (nodes[n] ? nodes[n].position.clone() : new THREE.Vector3(x, y, CAR.z0 - 0.02));
  shared = {
    ext: merge(stat.ext), int: merge(stat.int), glow: merge(stat.glow),
    leaves: [leaf('LEAF_L'), leaf('LEAF_R')],
    callUp: merge(collect(nodes.BTN_call_up).ext), callDown: merge(collect(nodes.BTN_call_down).ext),
    up: btn('BTN_up', -0.78, 1.34), down: btn('BTN_down', -0.78, 1.16),
    tex: asset, intU, extU,
    extMat: outsideMaterial(asset, extU),
    hitGeo: new THREE.BoxGeometry(1, 1, 1),
    hitMat: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return shared;
}

// A two-ended elevator. Each end is a static car behind sliding doors; riding teleports the player
// between identical cars after an 8 second descent/ascent. The Tower's has a secret third stop: `ends.lounge`, below
// its cave station, reached by pressing Down again there (see props/lounge.js).
export function createElevator(ctx, { id, ends }) {
  const S = sharedAssets(ctx.elevatorAsset);
  const el = { id, at: 'top', busy: false, ends: {}, enclosed: false };
  // Each elevator runs off its power line from the generator in the hub; without power the car is dark and
  // its buttons click uselessly.
  const live = () => !ctx.power || ctx.power[id] !== false;
  const lampMat = new THREE.MeshBasicMaterial({ name: 'elevator_lamp', color: new THREE.Color(2.4, 2.0, 1.4) });
  const insideMat = insideMaterial(S.tex, S.intU);
  let lit = -1;
  // Stops from the top down; Up and Down move one stop along them.
  const stops = ['top', 'bottom', 'lounge'].filter((k) => ends[k]?.pos);

  for (const key of stops) {
    const def = ends[key];
    const root = new THREE.Group();
    root.name = 'elevator:' + id + ':' + key;
    root.position.copy(def.pos);
    root.rotation.y = def.rotY;
    root.updateMatrixWorld();
    const parent = def.parent;
    parent.add(root);
    const fixed = (m) => { m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); return m; };

    const outside = fixed(new THREE.Mesh(S.ext, S.extMat));
    outside.castShadow = true; outside.receiveShadow = true;
    fixed(new THREE.Mesh(S.int, insideMat));
    fixed(new THREE.Mesh(S.glow, lampMat));

    // The leaves: each an outer (lit) and an inner (car-lit) mesh, slid along x by update().
    const leaves = S.leaves.map((L) => {
      const g = new THREE.Group();
      g.position.copy(L.pos);
      const o = new THREE.Mesh(L.ext, S.extMat);
      o.castShadow = true; o.receiveShadow = true;
      g.add(o, new THREE.Mesh(L.int, insideMat));
      root.add(g);
      return g;
    });

    // Small, inconspicuous call button outside.
    // (The lounge's sits on its panelling, in front of the pocket the doors slide into.)
    const cp = def.callPos ?? CALL_POS;
    const call = new THREE.Mesh(key === 'top' ? S.callDown : S.callUp, S.extMat);
    call.position.set(cp[0], cp[1], cp[2]);
    call.castShadow = true; call.receiveShadow = true;
    root.add(call);

    // Static car walls for collision.
    const col = def.collider;
    const wm = root.matrixWorld;
    const wall = (x, z, w, d, h = CAR.h) => col.addGeometry(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z), wm);
    wall(0, CAR.z1 - 0.1, CAR.hw * 2 + 0.4, 0.2);
    wall(-CAR.hw - 0.1, (CAR.z0 + CAR.z1) / 2, 0.2, CAR.z0 - CAR.z1 + 0.2);
    wall(CAR.hw + 0.1, (CAR.z0 + CAR.z1) / 2, 0.2, CAR.z0 - CAR.z1 + 0.2);
    wall(-(HOLE.hw + 0.6), -0.06, 1.2, 0.14);
    wall(HOLE.hw + 0.6, -0.06, 1.2, 0.14);
    col.addGeometry(new THREE.BoxGeometry(CAR.hw * 2 + 0.4, 0.3, CAR.z0 - CAR.z1 + 0.6).translate(0, -0.15, (CAR.z0 + CAR.z1) / 2 + 0.2), wm);

    const worldPos = new THREE.Vector3(0, 0, 0.03).applyMatrix4(wm);
    const door = ctx.physics.addOBB({ x: worldPos.x, z: worldPos.z, hx: HOLE.hw + 0.1, hz: 0.08, ry: def.rotY, y0: def.pos.y - 0.5, y1: def.pos.y + 3, zone: def.zone });

    const end = {
      key, root, leaves, door, open: 0, target: 0, def, inv: wm.clone().invert(),
      soundPos: new THREE.Vector3(0, 1.3, -1).applyMatrix4(wm),
    };
    el.ends[key] = end;

    // With the centre reticle you aim at a button itself: hit areas are only the button (bezel 52 mm across).
    const hit = (w, h, x, y, z) => { const m = new THREE.Mesh(S.hitGeo, S.hitMat); m.scale.set(w, h, 0.03); m.position.set(x, y, z); root.add(m); return m; };
    const upHit = hit(0.056, 0.056, S.up.x, S.up.y, CAR.z0 - 0.02);
    const downHit = hit(0.056, 0.056, S.down.x, S.down.y, CAR.z0 - 0.02);
    ctx.interact.add({ name: `elevator:${id}:${key}:call`, meshes: [call], range: 2.8, exact: true, onPress: () => el.call(key) });
    ctx.interact.add({ name: `elevator:${id}:${key}:up`, meshes: [upHit], range: 2.4, exact: true, onPress: () => el.press(key, 'top') });
    ctx.interact.add({ name: `elevator:${id}:${key}:down`, meshes: [downHit], range: 2.4, exact: true, onPress: () => el.press(key, 'bottom') });
    // No grass or pebbles in the car (or leaning in through its walls).
    addKeepOut(wm, new THREE.Box3(new THREE.Vector3(-CAR.hw - 0.5, -1, CAR.z1 - 0.5), new THREE.Vector3(CAR.hw + 0.5, CAR.h + 0.3, 0.05)));
    // Each end is a small thing in a cliff, shed or tunnel: gone beyond ~90 m (see render/lod.js).
    ctx.lod?.add(root, { out: [70, 95], name: 'elevator:' + id + ':' + key });
  }

  const q = new THREE.Vector3();
  const playerInCar = (key) => {
    if (!ctx.player) return false;
    const p = q.copy(ctx.player.feet).applyMatrix4(el.ends[key].inv);
    return Math.abs(p.x) < CAR.hw + 0.1 && p.z < CAR.z0 + 0.25 && p.z > CAR.z1 - 0.1 && p.y > -0.5 && p.y < 2;
  };

  // Sounds made in the car the player is standing in play on the audio engine's in-car bus: they carry on while the
  // shut doors silence everything outside (see update() and AudioEngine.setEnclosed).
  const sound = (name, key, opt = {}) => ctx.audio?.play(name, { pos: el.ends[key].soundPos, car: playerInCar(key), ...opt });

  const setDoors = (key, open) => {
    const e = el.ends[key];
    if (e.target === (open ? 1 : 0)) return;
    e.target = open ? 1 : 0;
    sound(open ? 'doorOpen' : 'doorClose', key);
  };

  // Seconds between two stops: the long shaft between top and bottom, plus the lounge's short drop.
  const legTime = (a, b) => (a === 'top' || b === 'top' ? RIDE : 0) + (a === 'lounge' || b === 'lounge' ? LOUNGE_RIDE : 0);

  el.call = (key) => {
    sound('click', key);
    if (el.busy || !live()) return;
    if (el.at === key) { setDoors(key, true); return; }
    // Car is at another stop: bring it here.
    el.busy = true;
    const ride = legTime(el.at, key);
    setDoors(el.at, false);
    ctx.later(DOOR_TIME, () => {
      ctx.audio?.play('elevatorDistant', { pos: el.ends[key].soundPos, duration: ride });
      ctx.later(ride, () => { el.at = key; el.busy = false; setDoors(key, true); });
    });
  };

  // dest 'top' is the Up button, 'bottom' Down: one stop along the shaft. "Up" at the top, and "Down" at the last
  // stop, do nothing.
  el.press = (key, dest) => {
    sound('click', key);
    const other = stops[stops.indexOf(key) + (dest === 'top' ? -1 : 1)];
    if (el.busy || !live() || el.at !== key || !other) return;
    el.busy = true;
    setDoors(key, false);
    const ride = legTime(key, other);
    ctx.later(DOOR_TIME + 0.2, () => {
      const riding = playerInCar(key);
      if (riding) ctx.onRide?.(true);
      ctx.audio?.play('elevatorRide', { duration: ride, attached: riding, car: riding, pos: el.ends[key].soundPos });
      ctx.later(ride, () => {
        el.at = other;
        if (riding) {
          // Carry the player's pose from this car to the identical car at the other end.
          const from = el.ends[key].root, to = el.ends[other].root;
          const local = ctx.player.feet.clone().applyMatrix4(el.ends[key].inv);
          local.applyMatrix4(to.matrixWorld);
          ctx.player.zone = el.ends[other].def.zone;
          ctx.player.place(local.x, local.y + 0.02, local.z, ctx.player.yaw + (to.rotation.y - from.rotation.y));
          ctx.onRide?.(false);
        }
        ctx.later(0.6, () => { el.busy = false; setDoors(other, true); });
      });
    });
  };

  el.update = (dt) => {
    const k = live() ? 1 : 0;
    if (k !== lit) {
      lit = k;
      lampMat.color.setRGB(2.4, 2.0, 1.4).multiplyScalar(k ? 1 : 0.02);
      insideMat.color.setScalar(k ? 1 : 0.07);
    }
    S.extU.uElevFill.value.copy(FILL).multiplyScalar(atmo.uUnderground.value);
    let shut = false;
    for (const e of Object.values(el.ends)) {
      const prev = e.open;
      const speed = dt / DOOR_TIME;
      e.open = e.target > e.open ? Math.min(e.target, e.open + speed) : Math.max(e.target, e.open - speed);
      if (prev !== e.open) {
        const s = e.open * e.open * (3 - 2 * e.open);
        e.leaves[0].position.x = -HOLE.hw * 0.5 - s * TRAVEL;
        e.leaves[1].position.x = HOLE.hw * 0.5 + s * TRAVEL;
        e.door.enabled = e.open < 0.8;
      }
      // Shut in: closing and nearly closed, or closed and not yet opening, with the player inside.
      if ((e.target === 0 ? e.open < SHUT : e.open === 0) && playerInCar(e.key)) shut = true;
    }
    if (shut !== el.enclosed) {
      el.enclosed = shut;
      ctx.audio?.setEnclosed?.('elevator:' + id, shut);
    }
  };

  ctx.updaters.push(el.update);
  (ctx.elevators ||= []).push(el);
  return el;
}

export const ELEVATOR_DIMS = { CAR, HOLE };
