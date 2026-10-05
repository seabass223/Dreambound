import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { addKeepOut, FAR_BAND, farMaterial, mergeable } from '../render/lod.js';
import { ColliderBuilder } from '../world/builders.js';
import { CLOUD_DECK_Y } from '../config.js';
import { clamp, smoothstep } from '../core/rng.js';

// The gatehouse at the Rocks rim where the rope bridge used to start, and the staircase it lets down to the End stack
// (tools/blender/gatehouse_design.py: public/models/gatehouse.glb).
//
// A reinforced-concrete housing cast on the cliff edge on the old bridge's heading, its front a little proud of the cliff
// face: split blast doors in a heavy chamfered frame, a header with two flood lamps under it and an amber beacon over it,
// the bay number, vents, conduit, a railing on the roof, buttresses and an apron down the rock. Behind it a short
// corridor open toward the island, so the sealed doors can be walked up to all game. When the Rocks puzzle is solved
// (sequences/stairsReveal.js) the doors slide into their pockets and the staircase runs out of the slot under the sill,
// one identical steel section at a time (a landing, then a flight of eight), down to the End landing. On the way down
// each section the player has passed shears off and falls into the clouds behind them (armed), and once they reach End
// the rest follow; the doors close up there.
//
// The model's frame: origin at the doorway's centre on the housing's outer face, at the corridor floor's level; +z out
// along the stairs, x across. The game sets the floor a few cm over the highest ground under the corridor and the outer
// face META.front proud of the rim, and fits the sections (nominally META.ls x META.hs) to the measured sill -> End
// landing by a fraction of a percent, so the last one's foot stands exactly on it.
//
// api (ctx.gatehouse) = {
//   root, frame: { sill, out, side, top, landing, n },  sectionEnd(i), setDoors(v), setExtended(i, v), setBeacon(on),
//   setLamps(v), drop(i), fallen(i), setState({ doors, extended, fallen }), onStairs(p), along(p), inside(p), shelter,
//   armed, onFirstStep, onAllFallen, respawnSpot(), update(dt) }

const PARTS = ['DOOR_L', 'DOOR_R', 'BEACON', 'STAIR'];
const STAIR_HW = 0.88;         // the stairs' collider walls (the capsule's surface stays inside the handrails)
const WALL_H = 1.1;
const PASSED = 0.6;            // a section drops once the player is this far past its far end
const STAGGER = 0.35;          // reaching End: the rest drop one after another, this far apart (s)
const TILT_T = 0.6;            // a falling section first hinges down on its far end for this long (s)
const TILT = 0.36;             // ...through this angle (rad)
const GRAVITY = 16, TERMINAL = 52;
const AHEAD = [0, 0.4, 0.8, 1.3, 2.0];   // s of fall a falling section's drift looks ahead (see sequences/fall.js)
const GAP_MARGIN = 1.2;        // a falling section keeps this far off both cliff faces (beyond its own extent)
const RAIL_TOP = 1.1;          // a section's handrails, over its deck
const DOOR_CLOSE = { delay: 1.4, secs: 5.5 };
const LIGHT = { lamp: 11, throw: 5, beacon: 4 };   // the light pool's intensities: each flood lamp, their throw down the stairs, the beacon
const LAMP_ON = new THREE.Color(2.6, 2.2, 1.6), LAMP_OFF = new THREE.Color(0.05, 0.048, 0.045);
const AMBER = new THREE.Color(3.4, 1.35, 0.18), AMBER_OFF = new THREE.Color(0.09, 0.04, 0.01);
const BEAM_LAMP = new THREE.Color(1.0, 0.86, 0.66), BEAM_AMBER = new THREE.Color(1.0, 0.5, 0.08);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const FILES = {
  ao: 'gatehouse_ao.png', concrete: 'gatehouse_concrete.png', concreteN: 'gatehouse_concrete_normal.png',
  steel: 'gatehouse_steel.png', steelN: 'gatehouse_steel_normal.png', paint: 'gatehouse_paint.png',
  paintN: 'gatehouse_paint_normal.png', floor: 'gatehouse_floor.png', grating: 'gatehouse_grating.png',
  gratingMask: 'gatehouse_grating_mask.png',
};

export async function loadGatehouse() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const keys = Object.keys(FILES);
  const [gltf, ...tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'gatehouse.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
  const a = { gltf };
  keys.forEach((k, i) => { a[k] = tex[i]; });
  a.ao.flipY = false; a.ao.channel = 1; a.ao.colorSpace = THREE.NoColorSpace;
  a.ao.generateMipmaps = false; a.ao.minFilter = THREE.LinearFilter;   // an atlas of small charts (see cabin.js)
  for (const k of keys) {
    if (k === 'ao') continue;
    const t = a[k];
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;   // seamless tiles (UVs in metres of each tile)
    t.anisotropy = 8;
    t.colorSpace = ['concrete', 'steel', 'paint', 'floor', 'grating'].includes(k) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  }
  return a;
}

// A soft round falloff for the lamps' and the beacon's glow (a DataTexture, so the headless harness can build it too).
function glowTexture() {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.max(0, 1 - r) ** 2.5 * (0.3 + 0.7 * Math.exp(-6 * r)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// The light cones (flood lamps, the beacon's fans): additive, brightest at the lens and fading out along v, soft at the
// silhouette (seen side-on a cone is a thin sheet), a slow drift of motes through it.
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    name: 'gatehouse-beam',
    uniforms: { uColor: { value: color.clone() }, uK: { value: 0 }, uTime: atmo.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uK; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        if (uK <= 0.0) discard;
        // (glTF flips v: the design's 0 at the lens arrives as 1. Clamped: with MSAA a pixel on the cone's edge is
        // shaded at its centre, off the triangle, where the varying runs past its ends; pow of a negative is NaN, and
        // one NaN pixel in an additive mesh goes through the bloom's blurs over the whole frame: the screen went black
        // the moment the lamps came on, bug report 1e2b1c67.)
        float v = clamp(1.0 - vUv.y, 0.0, 1.0);
        float along = pow(1.0 - v, 1.6) * smoothstep(0.0, 0.06, v);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float motes = 0.85 + 0.15 * sin(vW.x * 1.7 + vW.y * 2.3 + uTime * 0.7) * sin(vW.z * 1.3 - uTime * 0.5);
        // (unfogged: let them go with distance, as the fog takes the gatehouse)
        float a = uK * along * edge * motes * 0.12 * (1.0 - smoothstep(140.0, 280.0, distance(vW, cameraPosition)));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Discards what lies behind `clip` (a world plane: xyz normal, w offset; (0, 0, 0, 1) keeps everything), so a section
// sliding out of the one before it (or out of the bay under the sill) shows only the part that has come out.
function clipped(mat, clip, extra = '') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uStairClip = clip;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uStairClip;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if ( dot( vec4( vFogWorld, 1.0 ), uStairClip ) < 0.0 ) discard;`);
    if (extra) sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', extra);
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key.call(mat) + '|gclip' + (extra ? 'g' : '');
  return mat;
}

// The grating's holes: from the mask, but where the bars get finer than a pixel the panel reads as solid dark mesh
// (an alpha-tested mipmapped mask would thin out and vanish with distance).
const GRATING_ALPHA = /* glsl */ `
  #ifdef USE_ALPHAMAP
    { float gm = texture2D( alphaMap, vAlphaMapUv ).g;
      vec2 fw = fwidth( vAlphaMapUv );
      float far = smoothstep( 0.012, 0.03, max( fw.x, fw.y ) );
      diffuseColor.a *= mix( gm, 1.0, far ); }
  #endif`;

function makeMaterials(asset) {
  const v2 = (s) => new THREE.Vector2(s, -s);
  const std = (o) => patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.6, ...o }));
  const kinds = {
    concrete: () => std({ name: 'gatehouse-concrete', color: 0x8f8c87, map: asset.concrete, normalMap: asset.concreteN, normalScale: v2(0.9), roughness: 0.93, aoMap: asset.ao }),
    floor: () => std({ name: 'gatehouse-floor', map: asset.floor, roughness: 0.82, aoMap: asset.ao }),
    steel: () => std({ name: 'gatehouse-steel', map: asset.steel, normalMap: asset.steelN, normalScale: v2(0.7), roughness: 0.55, metalness: 0.5, aoMap: asset.ao }),
    paint: () => std({ name: 'gatehouse-paint', map: asset.paint, normalMap: asset.paintN, normalScale: v2(0.8), roughness: 0.58, metalness: 0.12, aoMap: asset.ao }),
    stencil: () => std({ name: 'gatehouse-stencil', map: asset.paint, normalMap: asset.paintN, normalScale: v2(0.8), roughness: 0.6, metalness: 0.1 }),
    grating: () => std({ name: 'gatehouse-grating', map: asset.grating, alphaMap: asset.gratingMask, alphaTest: 0.5, roughness: 0.6, metalness: 0.45 }),
    glass: () => std({ name: 'gatehouse-glass', color: 0x0b0e11, roughness: 0.07, metalness: 0.6, envMapIntensity: 1.3 }),
  };
  const M = {};
  for (const [k, f] of Object.entries(kinds)) M[k] = f();
  // The painted shapes on the housing and the doors ('@decal' meshes) stand 2-4 mm off their faces: pulled forward in
  // depth so they don't fight them from ~60 m out (a GL state, so the same programs). The letters are all such.
  const offset = (m) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  M.decal = { paint: offset(kinds.paint()), steel: offset(kinds.steel()) };
  offset(M.stencil);
  M.lamp = new THREE.MeshBasicMaterial({ name: 'gatehouse-lamp', color: LAMP_OFF.clone() });
  M.beacon = new THREE.MeshBasicMaterial({ name: 'gatehouse-beacon', color: AMBER_OFF.clone(), vertexColors: true });
  M.indicator = new THREE.MeshBasicMaterial({ name: 'gatehouse-indicator', color: new THREE.Color(0.5, 0.04, 0.02) });
  M.beam = beamMaterial(BEAM_LAMP);
  M.beaconBeam = beamMaterial(BEAM_AMBER);
  // A section's own copies of the three it is drawn with (its clip plane differs; the program is the same).
  M.section = (clip) => ({
    steel: clipped(kinds.steel(), clip),
    paint: clipped(kinds.paint(), clip),
    grating: clipped(kinds.grating(), clip, GRATING_ALPHA),
  });
  // (the grating's shadow: solid, from a plain depth material, not the holes' alpha)
  M.gratingDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  return M;
}

// Places the gatehouse on the Rocks rim on the heading a -> b (the old bridge's anchors: a on the Rocks cap, b the End
// landing) and the staircase from its sill to b. Returns the api (also ctx.gatehouse).
export function placeGatehouse(ctx, asset, { a, b, stack }) {
  const T = THREE;
  // ---- the model
  const nodes = {}, partMeshes = Object.fromEntries(PARTS.map((p) => [p, []]));
  const statics = [];
  let colliderGeo = null;
  asset.gltf.scene.updateMatrixWorld(true);
  asset.gltf.scene.traverse((o) => {
    if (o.isMesh) {
      if (o.name === 'COLLIDER') { colliderGeo = o.geometry.clone().applyMatrix4(o.matrixWorld); return; }
      const part = PARTS.includes(o.parent?.name) ? o.parent.name : null;
      if (part) partMeshes[part].push(o); else statics.push(o);
    } else if (o !== asset.gltf.scene) nodes[o.name] = o;
  });
  const meta = nodes.META?.userData ?? {};
  const N = meta.n ?? 14, LS0 = meta.ls ?? 4.1743, HS0 = meta.hs ?? 1.2423;
  const RISE = meta.rise ?? HS0 / 8, RUN = meta.run ?? 0.37, XL = meta.xl ?? LS0 - 7 * RUN;
  const OPEN_HW = meta.open_hw ?? 1.3, OPEN_H = meta.open_h ?? 3.1, DOOR_Z = meta.door_z ?? -0.45, DOOR_T = meta.door_t ?? 0.22;
  const SLIDE = meta.slide ?? 1.4, TOP = meta.top ?? 5.0, HW = meta.hw ?? 3.3, BACK_Z = meta.back_z ?? -6.5;
  const ROOF_Y = meta.roof_y ?? OPEN_H + 0.45;
  const keyOf = (o) => (o.material?.name || '').replace(/^gatehouse_/, '');
  const isDecal = (o) => o.userData?.layer === 'decal';

  // ---- the frame: on the heading through a, the outer face META.front proud of the rim; the floor a few cm over the
  // highest ground under the corridor
  const out = new T.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const th = Math.atan2(out.z, out.x);
  const cx = stack.cx ?? stack.cfg.x, cz = stack.cz ?? stack.cfg.z;
  const rS = stack.edgeR(th) + (meta.front ?? 0.23);
  const ra = (a.x - cx) * out.x + (a.z - cz) * out.z;
  const sill = new T.Vector3(a.x + out.x * (rS - ra), 0, a.z + out.z * (rS - ra));
  const ry = Math.atan2(out.x, out.z);
  const lx = new T.Vector3(Math.cos(ry), 0, -Math.sin(ry));   // the model's +x (left, looking out)
  const side = lx.clone().negate();                          // right, looking out
  const toWorldXZ = (x, z) => [sill.x + lx.x * x + out.x * z, sill.z + lx.z * x + out.z * z];
  let floorY = -Infinity;
  for (let z = BACK_Z + 0.05; z <= -0.3; z += 0.1) {
    for (let x = -OPEN_HW - 0.05; x <= OPEN_HW + 0.05; x += 0.1) {
      const [wx, wz] = toWorldXZ(x, z);
      const h = stack.heightAt(wx, wz);
      if (h !== null && h > floorY) floorY = h;
    }
  }
  if (!Number.isFinite(floorY)) floorY = a.y;
  floorY += 0.03;
  sill.y = floorY;

  const root = new T.Group();
  root.name = 'gatehouse';
  root.position.copy(sill);
  root.rotation.y = ry;
  ctx.surface.add(root);
  root.updateMatrixWorld(true);
  const M = makeMaterials(asset);
  const lp = (x, y, z) => root.localToWorld(new T.Vector3(x, y, z));

  // ---- the static gatehouse: one mesh per material, its own collider, a far stand-in
  const staticMeshes = [], lampBeams = [];
  for (const o of statics) {
    const key = keyOf(o), decal = isDecal(o);
    const mat = key === 'beam' ? M.beam : (decal && M.decal[key]) || M[key];
    if (!mat || typeof mat === 'function') continue;
    const mesh = new T.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), mat);
    mesh.name = 'gatehouse:' + key + (decal ? '@decal' : '');
    const solid = !decal && !['lamp', 'beam', 'indicator', 'glass', 'beacon'].includes(key);
    mesh.castShadow = solid;
    mesh.receiveShadow = key !== 'beam';
    mesh.matrixAutoUpdate = false;
    if (key === 'beam') mesh.renderOrder = 4;
    root.add(mesh);
    staticMeshes.push(mesh);
    if (key === 'beam') lampBeams.push(mesh);
  }
  root.updateMatrixWorld(true);
  const far = staticMeshes.filter(mergeable);
  if (far.length) ctx.lod.addFarProxy(far, { parent: root, band: FAR_BAND, material: farMaterial(), name: 'gatehouse', aoTexture: asset.ao });
  for (const m of staticMeshes) if (!far.includes(m) && m.material !== M.beam) ctx.lod.add(m, { out: FAR_BAND, name: 'gatehouse:lights' });
  let collider = null;
  if (colliderGeo) {
    const cb = new ColliderBuilder('gatehouse');
    cb.addGeometry(colliderGeo, root.matrixWorld);
    collider = ctx.physics.addCollider(cb.build(), 'surface');
  }
  // Nothing instanced (grass, pebbles) through the floor or the walls, nor under the stairs where they meet End.
  addKeepOut(root.matrixWorld, new T.Box3(new T.Vector3(-HW - 1.1, -7, BACK_Z - 1.4), new T.Vector3(HW + 1.1, 7, 0.9)));
  // The boulders may not be pushed into it (props/movableRocks.js: a hull in plan).
  if (ctx.boulders?.blockers) {
    const hull = [];
    for (const [x, z] of [[-HW - 0.9, 0.4], [HW + 0.9, 0.4], [HW + 0.9, BACK_Z - 1.2], [-HW - 0.9, BACK_Z - 1.2]]) hull.push(...toWorldXZ(x, z));
    ctx.boulders.blockers.push({ hull, gatehouse: true });
  }

  // ---- parts: a group at each pivot holding its meshes (their geometry is relative to it)
  const partGroup = (name, mats) => {
    const node = nodes[name];
    const g = new T.Group();
    g.name = 'gatehouse:' + name.toLowerCase();
    if (node) g.position.copy(node.position);
    for (const o of partMeshes[name]) {
      const key = keyOf(o), decal = isDecal(o);
      const mat = mats[key] ?? (key === 'beam' ? M.beaconBeam : (decal && M.decal[key]) || M[key]);
      if (!mat || typeof mat === 'function') continue;
      const geo = o.geometry.clone();
      o.updateMatrix();
      geo.applyMatrix4(o.matrix);
      const mesh = new T.Mesh(geo, mat);
      mesh.name = g.name + ':' + key + (decal ? '@decal' : '');
      mesh.castShadow = !decal && !['beacon', 'beam', 'glass'].includes(key);
      mesh.receiveShadow = key !== 'beam';
      if (key === 'beam') mesh.renderOrder = 4;
      g.add(mesh);
    }
    return g;
  };

  // The doors: two leaves sliding apart along x into their pockets; a collider in the doorway while they are shut.
  const doors = new T.Group();
  doors.name = 'gatehouse:doors';
  root.add(doors);
  const leaves = ['DOOR_L', 'DOOR_R'].map((name) => {
    const g = partGroup(name, {});
    doors.add(g);
    const axis = nodes[name]?.userData?.axis ?? [name === 'DOOR_L' ? 1 : -1, 0, 0];
    return { g, x0: g.position.x, dir: Math.sign(axis[0]) || 1, travel: nodes[name]?.userData?.travel ?? SLIDE };
  });
  ctx.lod.add(doors, { out: [420, 480], dynamic: true, name: 'gatehouse:doors' });
  let doorsCol = null;
  {
    const cb = new ColliderBuilder('gatehouse:doors');
    const c = lp(0, OPEN_H / 2, DOOR_Z);
    cb.addBox(c.x, c.y, c.z, 2 * OPEN_HW + 0.1, OPEN_H, DOOR_T + 0.1, ry);
    doorsCol = ctx.physics.addCollider(cb.build(), 'surface');
  }
  const doorPos = lp(0, 1.6, DOOR_Z);

  // The beacon: spun about +y; its dome's brightness is in its vertex colours (two lobes), two amber fans turn with it.
  const beacon = partGroup('BEACON', {});
  root.add(beacon);
  const beaconBeams = beacon.children.filter((m) => m.material === M.beaconBeam);
  const glowTex = glowTexture();
  const beaconGlowMat = new T.SpriteMaterial({ map: glowTex, color: new T.Color(1.0, 0.55, 0.12), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
  const beaconGlow = new T.Sprite(beaconGlowMat);
  beaconGlow.name = 'gatehouse:beacon-glow';
  beaconGlow.position.copy(nodes.BEACON_GLOW?.position ?? new T.Vector3(0, TOP + 0.4, 0.3));
  beaconGlow.scale.setScalar(0.9);
  root.add(beaconGlow);
  // The flood lamps' glows (the lenses and the cones are in the static meshes).
  const lampGlowMat = new T.SpriteMaterial({ map: glowTex, color: new T.Color(1.0, 0.85, 0.62), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
  const lampGlows = [];
  for (let i = 0; nodes['LAMP_' + i]; i++) {
    const s = new T.Sprite(lampGlowMat);
    s.name = 'gatehouse:lamp-glow';
    s.position.copy(nodes['LAMP_' + i].position);
    s.scale.setScalar(0.85);
    root.add(s);
    lampGlows.push(s);
  }

  // Real light on the facade and the first flights while the lamps burn, and the beacon's amber sweeping the face,
  // through the shared light pool (render/lightpool.js): a site parked far away (never the nearest) unless one of them
  // is on, as world/torBlast.js's flash.
  let beaconFlash = 0;
  const away = new T.Vector3(sill.x, -1e6, sill.z), siteAt = lp(0, -2, 8);
  const warmL = new T.Color(1, 0.86, 0.66), amberL = new T.Color(1, 0.55, 0.12);
  const poolLights = [];
  for (let k = 0; nodes['LAMP_' + k]; k++) {
    const n = nodes['LAMP_' + k], aim = new T.Vector3(...(n.userData.aim ?? [0, -0.48, 0.88]));
    poolLights.push({ pos: root.localToWorld(n.position.clone().addScaledVector(aim, 2.5)), color: warmL, distance: 20, intensity: () => lampsV * LIGHT.lamp });
  }
  poolLights.push({ pos: lp(0, -1.0, 9.5), color: warmL, distance: 18, intensity: () => lampsV * LIGHT.throw });
  poolLights.push({ pos: lp(0, TOP + 0.7, 1.0), color: amberL, distance: 11, intensity: () => (beaconOn ? beaconFlash * LIGHT.beacon : 0) });
  const site = ctx.lightPool?.add({ center: away.clone(), radius: 30, lights: poolLights });

  // ---- the stairs
  const plan = (b.x - sill.x) * out.x + (b.z - sill.z) * out.z;
  const dropH = sill.y - b.y;
  const LS = plan / N, HS = dropH / N;
  const sz = LS / LS0, sy = HS / HS0;
  if (Math.abs(sz - 1) > 0.03 || Math.abs(sy - 1) > 0.03) console.warn(`gatehouse: stairs stretched ${sz.toFixed(3)} x ${sy.toFixed(3)} to reach the End landing`);
  const total = plan;
  const stairs = new T.Group();
  stairs.name = 'gatehouse:stairs';
  root.add(stairs);
  // The collider's walking surface in a section (section-local, nominal): level over the landing to half a run before
  // the first nosing, then a ramp through the middle of the treads to half a run past the foot (onto the next landing).
  const rampY = (z) => (z <= XL - RUN / 2 ? 0 : Math.max(-HS0, -(z - XL) * (RISE / RUN) - RISE / 2));
  const sectionCollider = (i) => {
    const zs = [-0.15, XL - RUN / 2, LS0 + RUN / 2];
    const pos = [], idx = [];
    zs.forEach((z, k) => {
      const y = rampY(z);
      for (const [x, dy] of [[-STAIR_HW, WALL_H], [-STAIR_HW, 0], [STAIR_HW, 0], [STAIR_HW, WALL_H]]) {
        const p = lp(x, -i * HS + (y + dy) * sy, i * LS + z * sz);
        pos.push(p.x, p.y, p.z);
      }
      if (k) {
        const A = (k - 1) * 4, B = k * 4;
        for (let s = 0; s < 3; s++) idx.push(A + s, B + s, A + s + 1, A + s + 1, B + s, B + s + 1);
      }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const cb = new ColliderBuilder('stair:' + i);
    cb.addGeometry(g);
    const c = ctx.physics.addCollider(cb.build(), 'surface');
    if (c) c.enabled = false;
    return c;
  };
  const sections = [];
  const localGeo = new Map();   // each section's geometry (relative to its start), shared by all of them
  for (const o of partMeshes.STAIR) { o.updateMatrix(); localGeo.set(o, o.geometry.clone().applyMatrix4(o.matrix)); }
  for (let i = 0; i < N; i++) {
    const clip = { value: new T.Vector4(0, 0, 0, 1) };
    const mats = M.section(clip);
    const outer = new T.Group();
    outer.name = 'gatehouse:stair:' + i;
    outer.scale.set(1, sy, sz);
    const inner = new T.Group();
    inner.visible = false;
    outer.add(inner);
    const meshes = [];
    for (const o of partMeshes.STAIR) {
      const key = keyOf(o);
      const mat = mats[key];
      if (!mat) continue;
      const mesh = new T.Mesh(localGeo.get(o), mat);
      mesh.name = 'gatehouse:stair:' + key;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (key === 'grating') mesh.customDepthMaterial = M.gratingDepth;
      inner.add(mesh);
      meshes.push(mesh);
    }
    stairs.add(outer);
    const rest = new T.Vector3(0, -i * HS, i * LS);
    outer.position.copy(rest);
    // where it slides out from: the previous section's foot, or the face of the bay under the sill
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(out, lp(0, 0, i * LS - (i === 0 ? 0.02 : 0)));
    sections.push({ i, outer, inner, meshes, clip, plane, rest, v: 0, fallen: false, col: sectionCollider(i), fall: null });
    ctx.lod.add(outer, { out: [460, 540], dynamic: true, name: 'gatehouse:stair' });
  }
  // Under the stairs where they stand on End (and under the sill on the Rocks side): no grass through the treads.
  addKeepOut(root.matrixWorld, new T.Box3(new T.Vector3(-1.3, -dropH - 3, -0.2), new T.Vector3(1.3, 2, total + 0.8)));

  const sectionEnd = (i) => lp(0, -(i + 1) * HS, (i + 1) * LS);
  const tmp = new T.Vector3();
  const along = (p) => (p.x - sill.x) * out.x + (p.z - sill.z) * out.z;
  const across = (p) => (p.x - sill.x) * lx.x + (p.z - sill.z) * lx.z;
  const standing = (s) => s.v >= 1 && !s.fallen;
  // The walking surface's height (world) at `al` metres along, on section i.
  const surfaceY = (i, al) => sill.y - i * HS + rampY((al - i * LS) / sz) * sy;
  const onSection = (p, i, slack = 0) => {
    const al = along(p), z = al - i * LS;
    if (z < -0.2 - slack || z > LS + RUN / 2 * sz + slack) return false;
    if (Math.abs(across(p)) > STAIR_HW + 0.2 + slack) return false;
    const y = surfaceY(i, al);
    return p.y > y - 0.4 - slack && p.y < y + 0.9 + slack;
  };
  const onStairs = (p) => {   // (every frame from the footsteps and the save's isSafe: a plain loop)
    for (const s of sections) if (standing(s) && onSection(p, s.i)) return true;
    return false;
  };
  const inside = (p) => {
    tmp.copy(p);
    root.worldToLocal(tmp);
    return Math.abs(tmp.x) < OPEN_HW + 0.05 && tmp.z < 0.05 && tmp.z > BACK_Z - 0.05 && tmp.y > -0.4 && tmp.y < 1.2;
  };

  // ---- state
  let doorsV = 0, doorAnim = null;
  let beaconOn = false, lampsV = 0;
  let firstStep = false, allFallen = false;
  let queue = null;          // reaching End: { t, list } the rest dropping one by one
  let closeAt = null;        // the doors closing behind: { t } until they start

  const setDoors = (v) => {
    doorsV = clamp(v, 0, 1);
    const e = easeInOut(doorsV);
    for (const L of leaves) L.g.position.x = L.x0 + L.dir * L.travel * e;
    if (doorsCol) doorsCol.enabled = doorsV < 0.95;
  };

  const placeSection = (s) => {
    const e = 1 - (1 - s.v) ** 3;
    // the last few cm it settles onto its latch
    const settle = -0.015 * Math.sin(Math.PI * smoothstep(0.86, 1, s.v));
    s.outer.position.set(0, s.rest.y + (1 - e) * HS + settle, s.rest.z - (1 - e) * LS);
    s.outer.quaternion.identity();
    const moving = s.v > 0 && s.v < 1;
    if (moving) s.clip.value.set(s.plane.normal.x, s.plane.normal.y, s.plane.normal.z, s.plane.constant);
    else s.clip.value.set(0, 0, 0, 1);
    s.inner.visible = s.v > 0;
    for (const m of s.meshes) m.castShadow = !moving;
  };
  const setExtended = (i, v) => {
    const s = sections[i];
    if (!s || s.fallen) return;
    s.v = clamp(v, 0, 1);
    placeSection(s);
    if (s.col) s.col.enabled = s.v >= 1;
  };

  // The player's recent standing spots over a section that has gone are no place to wake up after a fall.
  const forgetHistory = () => {
    const h = ctx.player?.history;
    if (!h) return;
    const keep = h.filter((q) => !sections.some((s) => s.fallen && onSection(q, s.i, 0.3)));
    h.length = 0;
    h.push(...keep);
  };

  const rocks = stack;
  const thE = Math.atan2(-out.z, -out.x);
  const endCentreAlong = () => { const e = ctx.stacks?.end; return e ? (e.cx - sill.x) * out.x + (e.cz - sill.z) * out.z : total + 18; };
  const endRimAlong = () => { const e = ctx.stacks?.end; return e ? endCentreAlong() - e.edgeR(thE) : total - 1.3; };
  // A section's box (section-local, nominal), for its extent along the line as it tumbles.
  const BOX = [-1.05, 1.05].flatMap((x) => [-HS0 - 0.45, RAIL_TOP].flatMap((y) => [-0.12, LS0].map((z) => new T.Vector3(x, y, z))));

  const drop = (i) => {
    const s = sections[i];
    if (!s || s.fallen) return;
    s.fallen = true;
    if (s.col) s.col.enabled = false;
    forgetHistory();
    if (s.v <= 0) { s.inner.visible = false; return; }
    s.v = 1;
    placeSection(s);
    s.clip.value.set(0, 0, 0, 1);
    for (const m of s.meshes) m.castShadow = true;
    // hinge: the far end's foot, under the next landing's start, the rear dropping (or on End's cap: then it first slides
    // back off the lip). The first section instead sags off its hinge in the bay under the sill, its far end dropping:
    // hinged at its foot, its rear's rails would swing back into the gatehouse's face.
    const atSill = i === 0;
    const pivotLocal = atSill ? new T.Vector3(0, -0.28, 0) : new T.Vector3(0, -HS0 - 0.14, LS0);
    const comLocal = new T.Vector3(0, -HS0 * 0.5 - 0.3, LS0 * 0.5);
    const S = new T.Vector3(1, sy, sz);
    const pivot = pivotLocal.clone().multiply(S).add(s.outer.position);
    const back = (i + 1) * LS > endRimAlong() - 0.4 ? (i + 1) * LS - endRimAlong() + 0.8 : 0;
    // a little sway either way and a tumble of its own, the same for each section every time
    const r = (k) => Math.sin((i + 1) * 12.9898 + k * 78.233) * 0.5 + 0.5;
    s.fall = { t: 0, phase: 'tilt', sign: atSill ? 1 : -1, back, pivot, pivotLocal, comLocal, S, q: new T.Quaternion(), c: new T.Vector3(), v: new T.Vector3(),
      w: new T.Vector3(), spin: new T.Vector3((r(1) - 0.5) * 0.5, (r(2) - 0.5) * 0.7, (r(3) - 0.5) * 1.1) };
    ctx.audio?.play?.('stairFall', { pos: lp(0, -(i + 0.5) * HS, (i + 0.5) * LS) });
    if (i === 0 && doorsV > 0) closeAt = { t: DOOR_CLOSE.delay };
  };

  const _q = new T.Quaternion(), _v = new T.Vector3(), _ax = new T.Vector3(1, 0, 0), _p = new T.Vector3();
  // Hinged at its far end, the rear drops through TILT (the first section: hinged at the sill, its far end drops; one
  // resting on End slides back off the lip as it tilts), then it lets go: gravity, its tumble, and a drift that keeps
  // all of it clear of both cliff faces as they flare out below.
  const fallStep = (s, dt) => {
    const f = s.fall;
    f.t += dt;
    if (f.phase === 'tilt') {
      const T_ = f.back ? TILT_T * 1.2 : TILT_T, A = f.back ? TILT * 0.6 : TILT;
      const k = Math.min(1, f.t / T_);
      const ang = A * k * k + 0.012 * Math.sin(f.t * 55) * (1 - k);
      f.q.setFromAxisAngle(_ax, f.sign * ang);
      _p.copy(f.pivot);
      _p.z -= f.back * k * k;
      // position = pivot - R (S pivotLocal)
      _v.copy(f.pivotLocal).multiply(f.S).applyQuaternion(f.q);
      s.outer.position.copy(_p).sub(_v);
      s.outer.quaternion.copy(f.q);
      if (k >= 1) {
        // let go: the swing's speed at its centre (and the slide's), and its own tumble
        const wx = f.sign * 2 * A / T_;
        f.w.set(wx, 0, 0).add(f.spin);
        _v.copy(f.comLocal).multiply(f.S).applyQuaternion(f.q);
        f.c.copy(s.outer.position).add(_v);
        f.v.set(wx, 0, 0).cross(_v.copy(f.c).sub(_p));
        f.v.z -= 2 * f.back / T_;
        f.phase = 'free';
      }
      return;
    }
    if (f.phase !== 'free') return;
    f.v.y = Math.max(-TERMINAL, f.v.y - GRAVITY * dt);
    // how far it reaches along the line (and down) from its centre as it lies now
    let half = 0, low = 0;
    for (const b0 of BOX) {
      _v.copy(b0).sub(f.comLocal).multiply(f.S).applyQuaternion(f.q);
      half = Math.max(half, Math.abs(_v.z));
      low = Math.min(low, _v.y);
    }
    // Keep all of it inside the gap: the faces flare out below, so look at where it will be over the next moments
    // (its centre's height and its lowest point's) and ease toward a line clear of the widest of them, getting there
    // in time.
    const yW = sill.y + f.c.y;
    const e = ctx.stacks?.end;
    const m = half + GAP_MARGIN;
    let lo = -Infinity, hi = Infinity;
    const want0 = f.c.z;
    let want = 0, wantSet = false;
    for (const ahead of AHEAD) {
      const vy = Math.max(-TERMINAL, f.v.y - GRAVITY * ahead);
      const y = yW + (f.v.y + vy) * 0.5 * ahead;
      let rr = null, er = null;
      for (let k = 0; k < 2; k++) {   // (its centre's height and its lowest point's; no array a frame)
        const yy = k ? y + low : y;
        const a1 = rocks.wallRadius?.(th, yy), b1 = e?.wallRadius?.(thE, yy);
        if (a1 != null) rr = Math.max(rr ?? a1, a1);
        if (b1 != null) er = Math.max(er ?? b1, b1);
      }
      const l = rr != null ? rr - rS + m : -Infinity, h = er != null ? endCentreAlong() - er - m : Infinity;
      lo = Math.max(lo, l); hi = Math.min(hi, h);
      // the speed along the line that reaches the clear band by then
      const tgt = l > h ? (l + h) / 2 : clamp(want0, l, h);
      const need = (tgt - want0) / Math.max(ahead, 0.35);
      if (!wantSet || Math.abs(need) > Math.abs(want)) { want = need; wantSet = true; }
    }
    want = clamp(want, -12, 12);
    f.v.z += (want - f.v.z) * Math.min(1, dt * 5);
    f.v.x *= Math.exp(-dt * 0.5);
    f.c.addScaledVector(f.v, dt);
    // tumble: world-frame angular velocity, easing toward a lazy spin
    const w = f.w.length();
    if (w > 1e-6) { _q.setFromAxisAngle(_v.copy(f.w).divideScalar(w), w * dt); f.q.premultiply(_q); }
    f.w.lerp(f.spin, Math.min(1, dt * 0.4));
    _v.copy(f.comLocal).multiply(f.S).applyQuaternion(f.q);
    s.outer.position.copy(f.c).sub(_v);
    s.outer.quaternion.copy(f.q);
    if (yW < CLOUD_DECK_Y - 10) { f.phase = 'gone'; s.inner.visible = false; }
  };

  const respawnSpot = () => {
    const p = ctx.player?.feet;
    if (!p) return null;
    const al = along(p);
    // not off the stairs (on the island, or off its rim beside the gatehouse): the usual place will do
    if (al < -0.5 || (al < 1 && Math.abs(across(p)) > OPEN_HW + 0.5)) return null;
    const yaw = Math.atan2(-out.x, -out.z);
    // (once the player is on End the rest are on their way down: none of them is a place to wake)
    if (al <= total + 0.5 && !queue) {
      const s = sections.find((q) => standing(q) && (q.i + 1) * LS > al - 0.3);
      if (s) {
        const w = lp(0, -s.i * HS, s.i * LS + Math.min(0.9, XL * sz * 0.6));
        return { x: w.x, y: w.y + 0.05, z: w.z, yaw, zone: 'surface' };
      }
    }
    // none left standing (or already over End): the End landing, a little way in from the stairs' foot
    const x = b.x + out.x * 1.2, z = b.z + out.z * 1.2;
    const y = (ctx.stacks?.end?.heightAt?.(x, z) ?? b.y - 0.05) + 0.05;
    return { x, y, z, yaw, zone: 'surface' };
  };

  const setState = ({ doors: d = 0, extended = false, fallen = false } = {}) => {
    doorAnim = null; closeAt = null; queue = null;
    setDoors(d ? 1 : 0);
    for (const s of sections) {
      s.fall = null;
      s.fallen = false;
      s.v = extended ? 1 : 0;
      placeSection(s);
      if (fallen) { s.fallen = true; s.inner.visible = false; }
      if (s.col) s.col.enabled = standing(s);
    }
    // (a restored descent that is already armed doesn't start again on the first step: see update)
    firstStep = !!fallen;
    allFallen = !!fallen;
    if (fallen) forgetHistory();
  };

  const setBeacon = (on) => {
    beaconOn = !!on;
    M.beacon.color.copy(beaconOn ? AMBER : AMBER_OFF);
    for (const m of [...beaconBeams, beaconGlow]) m.visible = beaconOn;   // (an empty cone still costs its fill)
    if (!beaconOn) { beaconGlowMat.opacity = 0; M.beaconBeam.uniforms.uK.value = 0; }
  };
  const setLamps = (v) => {
    lampsV = clamp(v, 0, 1);
    M.lamp.color.copy(LAMP_OFF).lerp(LAMP_ON, lampsV);
    lampGlowMat.opacity = 0.55 * lampsV;
    for (const m of [...lampBeams, ...lampGlows]) m.visible = lampsV > 0;
  };

  let t = 0;
  const api = {
    root,
    frame: { sill: sill.clone(), out: out.clone(), side: side.clone(), top: lp(0, TOP + 0.16, 0), landing: b.clone(), n: N },
    // The roofed corridor, for the rain to keep out of (render/storm.js setShelter): half is along out, up, across.
    shelter: { center: lp(0, ROOF_Y / 2, BACK_Z / 2), out: out.clone(), half: new T.Vector3(-BACK_Z / 2, ROOF_Y / 2, OPEN_HW) },
    collider, sections: N, length: total,
    sectionEnd,
    setDoors, setExtended, setBeacon, setLamps, drop, setState,
    fallen: (i) => !!sections[i]?.fallen,
    extended: (i) => sections[i]?.v ?? 0,
    doors: () => doorsV,
    onStairs, along, inside,
    armed: false,
    onFirstStep: null,
    onAllFallen: null,
    respawnSpot,
    update(dt) {
      t += dt;
      // the beacon turns and flashes; the lamps' cones a little stronger in the dark
      if (beaconOn) {
        beacon.rotation.y = (beacon.rotation.y + dt * Math.PI * 2 * 0.8) % (Math.PI * 2);
        const facing = Math.abs(Math.cos(beacon.rotation.y));
        beaconFlash = 0.25 + 0.75 * facing ** 6;
        beaconGlowMat.opacity = 0.35 + 0.45 * facing ** 6;
        M.beaconBeam.uniforms.uK.value = 0.5 + 0.9 * atmo.uNight.value;
      }
      M.beam.uniforms.uK.value = lampsV * (0.35 + 0.95 * atmo.uNight.value);
      site?.center.copy(lampsV > 0 || beaconOn ? siteAt : away);
      // the dead panel's one lamp: a dim, slow pulse
      M.indicator.color.setRGB(0.3 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3)), 0.025, 0.012);
      // doors closing behind the player
      if (closeAt) {
        closeAt.t -= dt;
        if (closeAt.t <= 0) {
          closeAt = null;
          doorAnim = { from: doorsV, to: 0, t: 0, secs: DOOR_CLOSE.secs };
          ctx.audio?.play?.('hatchSlide', { pos: doorPos, duration: DOOR_CLOSE.secs, open: false });
        }
      }
      if (doorAnim) {
        doorAnim.t += dt;
        const k = Math.min(1, doorAnim.t / doorAnim.secs);
        setDoors(doorAnim.from + (doorAnim.to - doorAnim.from) * k);
        if (k >= 1) doorAnim = null;
      }
      // the descent: drop what the player has passed, and everything once they're on End
      const p = ctx.player;
      if (p && p.mode === 'walk') {
        const al = along(p.feet);
        if (!firstStep && standing(sections[0]) && al > 0.35 && onSection(p.feet, 0)) {
          firstStep = true;
          if (!api.armed) api.onFirstStep?.();
        }
        if (api.armed) {
          const onEnd = al > total + 0.3 && !onStairs(p.feet);
          if (onEnd && !queue && !allFallen && sections.some((s) => !s.fallen)) queue ={ t: 0.6, list: sections.filter((s) => !s.fallen).map((s) => s.i) };
          if (!onEnd) {
            for (const s of sections) {
              if (s.fallen || s.i === N - 1) continue;
              if (al > (s.i + 1) * LS + PASSED && !onSection(p.feet, s.i)) drop(s.i);
            }
          }
        }
      }
      if (queue) {
        queue.t -= dt;
        while (queue && queue.t <= 0) {
          // (stepped back onto the next one to go: it waits until they are off it again, never dropped underfoot)
          if (p && p.mode === 'walk' && onSection(p.feet, queue.list[0])) { queue.t = 0.25; break; }
          const i = queue.list.shift();
          if (i !== undefined) drop(i);
          if (!queue.list.length) queue = null; else queue.t += STAGGER;
        }
      }
      for (const s of sections) if (s.fall && s.fall.phase !== 'gone') fallStep(s, dt);
      if (!allFallen && sections[N - 1].fallen && sections.every((s) => s.fallen)) {
        allFallen = true;
        api.onAllFallen?.();
      }
    },
  };
  setDoors(0);
  setLamps(0);
  setBeacon(false);
  ctx.updaters.push((dt) => api.update(dt));
  ctx.gatehouse = api;
  return api;
}
