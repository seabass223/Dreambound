import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { Textures } from '../render/textures.js';
import { atmo, atmoState } from '../render/atmosphere.js';
import { clamp } from '../core/rng.js';
import { rigged, UV_VERT, createRig, collectParts, partIndex } from '../render/rig.js';
import { FAR_BAND, mergeable } from '../render/lod.js';
import { createScopeExit } from '../ui/scopeExit.js';
import { createStation } from './observatoryStation.js';
import { VIEW_DROP } from '../world/skyTarget.js';

// The Mountain observatory, modeled in Blender (tools/blender/observatory_design.py): a stucco drum and a
// riveted rotating dome, a refractor on a fork mount, geared handwheels, a periscope eyepiece and a room
// of 70s electronics.
//
// Every moving part (dome, telescope, gears, dial needles, anemometer) is skinned on the GPU: the whole
// building is merged into one mesh per material, each vertex tagged with its part, and the vertex shader
// turns it about the part's pivot and then its parent's. The observatory draws in ~15 calls.

export async function loadObservatory() {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const [gltf, ao] = await Promise.all([
    loader.loadAsync(base + 'observatory.glb'),
    new THREE.TextureLoader().loadAsync(base + 'observatory_ao.png'),
  ]);
  ao.flipY = false;
  ao.channel = 1;
  ao.colorSpace = THREE.NoColorSpace;
  // An atlas of many small charts: mipmapping would bleed neighbouring charts together at a distance.
  ao.generateMipmaps = false;
  ao.minFilter = THREE.LinearFilter;
  return { gltf, ao };
}

// Blender materials merged into one game material: [game material, value packed into vertex alpha
// (metalness for 'metal', roughness for 'plain'), color multiplied into the vertex colors].
const MERGE = {
  brass: ['metal', 1.0, 0xe2b467], steel: ['metal', 0.6], metal_black: ['metal', 0.35],
  painted: ['plain', 0.55], leather: ['plain', 0.4], rubber: ['plain', 0.9], ceramic: ['plain', 0.18],
};
const NO_SHADOW = new Set(['glass', 'emissive', 'lamps', 'screen', 'reels', 'poster', 'plate', 'wood_floor']);
// Layers from the Blender build: everything inside the drum fades out as you leave the summit, the weather
// mast and shelter further out. The drum and dome are always drawn.
const LAYER_OUT = { in: [45, 65], near: [110, 140] };
// Rear hatch: how far off the tor top may sit in each axis of the eyepiece for the panel to open (the reticle's
// centring circle has a radius of 0.18 deg, its dashed ring 0.64 deg; one mouse count on a handwheel turns the
// dome 0.09 deg and the tube 0.07 deg), and how long the panel takes to swing.
const HATCH_TOL = THREE.MathUtils.degToRad(0.35);
const HATCH_TIME = 1.5;

// CRT content by mode: 0 terminal text, 1 oscilloscope, 2 radar sweep, 3 bar graph, 4 guider star field.
const SCREEN_FRAG = /* glsl */ `
vec3 crt(vec2 u, vec3 tint) {
  float mode = floor(u.x), id = floor(u.y);
  vec2 p = fract(u);
  float t = uObsTime + id * 7.13;
  float v = 0.0;
  if (mode < 0.5) {
    vec2 cell = vec2(40.0, 18.0);
    vec2 g = p * cell;
    float row = floor(g.y), col = floor(g.x);
    float scroll = floor(t * 0.9);
    float line = row - scroll;
    float len = oh(vec2(line, id)) * 34.0 + 4.0;
    vec2 sub = floor(fract(g) * vec2(4.0, 6.0));
    float glyph = step(0.42, oh(vec2(col * 3.1 + line * 17.0, sub.x + sub.y * 4.0))) * step(0.5, sub.y) * step(sub.x, 2.5);
    v = glyph * step(col, len) * step(1.0, col) * step(0.3, oh(vec2(col, line + 91.0)));
    float cursor = step(abs(row - 1.0), 0.1) * step(abs(col - floor(len * 0.4) - 1.0), 0.1) * step(0.5, fract(t * 1.6));
    v = max(v, cursor * step(sub.y, 5.5));
  } else if (mode < 1.5) {
    vec2 grid = abs(fract(p * vec2(10.0, 8.0) + 0.5) - 0.5);
    v = 0.12 * (1.0 - smoothstep(0.0, 0.04, min(grid.x, grid.y)));
    float y = 0.5 + 0.3 * sin(p.x * 13.0 + t * 5.0) * (0.6 + 0.4 * sin(t * 0.7)) + 0.05 * sin(p.x * 61.0 - t * 17.0);
    v += exp(-pow((p.y - y) * 60.0, 2.0)) * 1.2;
  } else if (mode < 2.5) {
    vec2 q = (p - 0.5) * vec2(1.25, 1.0);
    float r = length(q), a = atan(q.y, q.x + 1e-6);
    float sweep = mod(t * 1.3, 6.2831853);
    float lag = mod(sweep - a, 6.2831853);
    v = exp(-lag * 2.5) * 0.9 * step(r, 0.48);
    v += 0.15 * (1.0 - smoothstep(0.0, 0.006, abs(fract(r * 8.0 + 0.5) - 0.5) / 8.0)) * step(r, 0.48);
    for (int k = 0; k < 5; k++) {
      vec2 b = vec2(oh1(float(k) + id * 3.0), oh1(float(k) + 17.0 + id)) * 0.7 - 0.35;
      float ba = atan(b.y, b.x);
      float fresh = exp(-mod(sweep - ba, 6.2831853) * 0.9);
      v += fresh * (1.0 - smoothstep(0.008, 0.02, length(q - b))) * 1.5;
    }
  } else if (mode < 3.5) {
    float bars = 14.0;
    float bi = floor(p.x * bars);
    float h = 0.15 + 0.7 * (0.5 + 0.5 * sin(t * (1.0 + oh1(bi) * 2.0) + bi * 1.7)) * (0.6 + 0.4 * oh(vec2(bi, floor(t * 4.0))));
    float inBar = step(0.15, fract(p.x * bars)) * step(fract(p.x * bars), 0.85);
    v = inBar * step(p.y, h) * (0.7 + 0.3 * step(0.5, fract(p.y * 30.0)));
    v += 0.1 * step(abs(p.y - 0.05), 0.004);
  } else {
    vec2 q = p + vec2(t * 0.004, t * 0.0015);
    vec2 cell = floor(q * 24.0);
    vec2 f = fract(q * 24.0) - 0.5;
    float s = oh(cell);
    vec2 off = vec2(oh(cell + 3.1), oh(cell + 7.7)) - 0.5;
    float big = 0.3 + max(s - 0.82, 0.0) * 5.0;   // star size (guarded: no division by <= 0)
    v = step(0.82, s) * exp(-dot(f - off * 0.6, f - off * 0.6) * 90.0 / big) * 1.4;
    vec2 box = abs(p - vec2(0.5 + 0.02 * sin(t * 0.4), 0.5 + 0.02 * cos(t * 0.3)));
    v += 0.5 * step(max(box.x, box.y), 0.07) * step(0.062, max(box.x, box.y));
    v += 0.25 * step(abs(p.x - 0.5), 0.002) + 0.25 * step(abs(p.y - 0.5), 0.002);
  }
  float scan = 0.82 + 0.18 * sin(p.y * 420.0);
  float corner = smoothstep(0.75, 0.35, length((p - 0.5) * vec2(1.1, 1.2)));
  float flicker = 0.96 + 0.04 * sin(uObsTime * 57.0 + id);
  return tint * (0.05 + v) * scan * corner * flicker;
}
`;

// Indicator lamps: id and behaviour (0 random, 1 steady, 2 slow beacon, 3 fast chatter) packed in the UVs.
const LAMP_FRAG = /* glsl */ `
float lampOn(vec2 u) {
  float id = floor(u.x), kind = floor(u.y);
  float t = uObsTime;
  if (kind < 0.5) { float period = 0.4 + oh1(id) * 2.6; return step(0.45, oh(vec2(id, floor(t / period + oh1(id + 5.0))))); }
  if (kind < 1.5) return 0.92 + 0.08 * sin(t * 3.0 + id);
  if (kind < 2.5) return pow(0.5 + 0.5 * sin(t * 2.2), 6.0);
  return step(0.5, oh(vec2(id, floor(t * 11.0 + oh1(id) * 3.0))));
}
`;

// Tape reels: an aluminium flange with three windows, spun in the shader; speed wanders and reverses.
const REEL_FRAG = /* glsl */ `
float reelAlpha(vec2 u, out float shade) {
  float id = floor(u.x), right = floor(u.y);
  vec2 q = fract(u) - 0.5;
  float drive = floor(id / 2.0);
  float t = uObsTime;
  float ang = 3.2 * sin(t * 0.21 + drive * 1.9) * 6.0 + 2.4 * sin(t * 0.47 + drive) * 4.0 + t * (1.2 + drive * 0.3) * (right > 0.5 ? 1.1 : 1.0);
  float c = cos(ang), s = sin(ang);
  q = mat2(c, -s, s, c) * q;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x + 1e-6);
  float sector = fract(a / 2.0943951);
  float window = step(0.3, r) * step(r, 0.84) * step(0.12, sector) * step(sector, 0.6);
  float hubHole = step(r, 0.06);
  shade = 0.85 + 0.15 * sin(r * 60.0) - 0.25 * step(r, 0.16) + 0.1 * step(0.9, r);
  return (1.0 - window) * (1.0 - hubHole) * step(r, 1.0);
}
`;

export function placeObservatory(ctx, asset, { center, doorAngle, collider }) {
  const { gltf, ao } = asset;
  const src = gltf.scene;
  src.updateMatrixWorld(true);

  // ---- placement: model -Z (the door) faces the path's arrival angle ----
  const root = new THREE.Group();
  root.position.copy(center);
  root.rotation.y = Math.atan2(-Math.cos(doorAngle), -Math.sin(doorAngle));
  ctx.surface.add(root);
  root.updateMatrixWorld(true);

  // ---- parts ----
  const rig = createRig();
  const { parts, partOf, nodes } = collectParts(src, rig, 'observatory');

  // ---- geometry: bake node transforms, tag parts, merge by game material ----
  const groups = {};
  const colliderM = new THREE.Matrix4();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material?.name || '').replace(/^obs_/, '');
    if (o.name === 'COLLIDER' || name === 'collider') {
      collider.addGeometry(o.geometry, colliderM.multiplyMatrices(root.matrixWorld, o.matrixWorld));
      return;
    }
    const part = partIndex(o, partOf);
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    const [key, packed, tint] = MERGE[name] || [name, null];
    if (packed !== null) {
      const col = g.attributes.color;
      const c = new THREE.Color(tint ?? 0xffffff);   // linear
      for (let i = 0; i < n; i++) col.setXYZW(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b, packed);
    }
    const layer = o.userData.layer || 'shell';
    (groups[key + '@' + layer] ||= []).push(g);
  });

  // ---- materials ----
  const oak = Textures.oakPlanks(), grain = Textures.woodGrain(), lime = Textures.limewash();
  const ledge = Textures.ledgestone(), panels = Textures.domePanels(), tread = Textures.treadPlate();
  const brushed = Textures.brushed();
  for (const t of [ledge.map, ledge.normal]) t.repeat.set(0.5, 0.5);
  const v2 = (s) => new THREE.Vector2(s, s);
  const timeU = { value: 0 }, kU = { value: 1 };
  const std = (o, extra) => rigged(patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8, ...o })), rig, extra);
  const withObsUniforms = (fn) => (sh) => { sh.uniforms.uObsTime = timeU; sh.uniforms.uObsK = kU; fn(sh); };
  const M = {
    metal: std({ map: brushed.map, roughness: 1, metalness: 1, name: 'metal' }, (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vColor.a;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.55, 0.3, vColor.a);');
    }),
    plain: std({ map: lime.map, roughness: 1, metalness: 0, name: 'plain' }, (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vColor.a;');
    }),
    dome: std({ map: panels.map, normalMap: panels.normal, normalScale: v2(0.9), roughness: 0.5, metalness: 0.2 }),
    tube: std({ map: panels.map, normalMap: panels.normal, normalScale: v2(0.6), roughness: 0.32, metalness: 0.3, envMapIntensity: 1.1 }),
    steel: null,
    plate: std({ map: tread.map, normalMap: tread.normal, normalScale: v2(1.0), roughness: 0.42, metalness: 0.75 }),
    stone: std({ map: ledge.map, normalMap: ledge.normal, normalScale: v2(1.1), roughness: 0.9 }),
    plaster: std({ map: lime.map, normalMap: lime.normal, normalScale: v2(0.6), roughness: 0.93 }),
    wood_floor: std({ map: oak.map, normalMap: oak.normal, normalScale: v2(0.55), roughness: 0.6 }),
    wood: std({ map: grain.map, normalMap: grain.normal, normalScale: v2(0.4), roughness: 0.6 }),
    poster: std({ map: Textures.obsAtlas(), roughness: 0.85, vertexColors: false }),
    glass: rigged(patchMaterial(new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.4,
      side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true,
    })), rig),
    emissive: rigged(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.3) }), rig),
    screen: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'screen' }), rig, withObsUniforms((sh) => {
      UV_VERT(sh, SCREEN_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = crt(vObsUv, vColor.rgb) * uObsK;');
    })),
    lamps: rigged(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'lamps' }), rig, withObsUniforms((sh) => {
      UV_VERT(sh, LAMP_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vColor.rgb * mix(0.05, 2.4, lampOn(vObsUv)) * uObsK;');
    })),
    reels: std({ roughness: 0.35, metalness: 0.8, name: 'reels', side: THREE.DoubleSide }, withObsUniforms((sh) => {
      UV_VERT(sh, REEL_FRAG);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n{ float sh_; if (reelAlpha(vObsUv, sh_) < 0.5) discard; diffuseColor.rgb *= sh_; }');
    })),
  };
  const depth = rigged(new THREE.MeshDepthMaterial(), rig);
  const shell = [];

  for (const [group, geos] of Object.entries(groups)) {
    const [key, layer] = group.split('@');
    const mat = M[key];
    if (!mat) { console.warn('observatory: no material for', key); continue; }
    const geo = mergeGeometries(geos, false);
    if (!geo) { console.warn('observatory: could not merge', key); continue; }
    // One sphere around the whole building: the tube and dome move far from their rest pose.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.5, 0), 9.5);
    if (geo.attributes.uv1 && mat.isMeshStandardMaterial) { mat.aoMap = ao; mat.aoMapIntensity = 1; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !NO_SHADOW.has(key);
    mesh.receiveShadow = key !== 'emissive' && key !== 'lamps' && key !== 'screen';
    mesh.customDepthMaterial = depth;
    if (key === 'glass') mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    // Its world matrix now (a static mesh never flags itself for update): the LOD bounds below read it, and
    // without this they sat at the model origin, so the interior and the 'near' details were always culled.
    mesh.updateMatrixWorld(true);
    if (LAYER_OUT[layer]) ctx.lod.add(mesh, { out: LAYER_OUT[layer], name: 'observatory@' + layer });
    else if (mergeable(mesh)) shell.push(mesh);
  }
  // From other stacks: the drum and dome as one merged, AO-shaded stand-in (rigged, so the dome still turns).
  const far = rigged(patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.7, name: 'obs_far' })), rig);
  const farMesh = ctx.lod.addFarProxy(shell, { parent: root, band: FAR_BAND, material: far, name: 'observatory', keep: ['aPart'], aoTexture: ao });
  farMesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.5, 0), 9.5);

  // ---- interior lighting (shared light pool) and the interior mask ----
  const meta = nodes.META?.userData || {};
  const wp = (name) => nodes[name] ? root.localToWorld(nodes[name].getWorldPosition(new THREE.Vector3())) : null;
  atmo.uObsA.value.set(center.x, center.z, meta.rIn ?? 5.15, center.y + (meta.floorY ?? 0.28));
  atmo.uObsB.value.set(center.y + (meta.wallTop ?? 3.75), center.y + (meta.domeC ?? 3.9), meta.domeR ?? 5.8, 1);
  let k = 1;
  const lights = [];
  for (const [name, node] of Object.entries(nodes)) {
    if (!name.startsWith('LIGHT_')) continue;
    const ud = node.userData, power = ud.power || 4;
    const flick = name === 'LIGHT_racks';
    lights.push({
      pos: wp(name), color: new THREE.Color(...(ud.color || [1, 0.8, 0.55])), distance: ud.distance || 6,
      intensity: () => power * 1.15 * k * (flick ? 0.95 + 0.05 * Math.sin(timeU.value * 31) : 1),
    });
  }
  ctx.lightPool.add({ center: center.clone().setY(center.y + 2), radius: 12, lights });
  for (const n of ['SOUND_electronics', 'SOUND_desk']) if (nodes[n]) ctx.audio?.registerEmitter?.('electronics', wp(n), 'surface');

  // ---- state, drivers, controls ----
  const st = ctx.state.observatory = { yaw: doorAngle + Math.PI * 0.2, pitch: 0.22, hatch: 0 };
  const pivotY = meta.pivotY ?? 4.3, tubeFront = meta.tubeFront ?? 4.4;
  // Dome angle (about local +Y) that points the slit (local -Z) at world angle yaw; tracked continuously.
  const slitAngle = (yaw) => Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) - root.rotation.y;
  const yaw0 = st.yaw, psi0 = slitAngle(st.yaw);
  const domeAngle = (yaw) => psi0 - (yaw - yaw0);
  let wind = 0, shut = 1, doorS = 0;   // doorS: the front door, 0 shut (as built) .. 1 swung open against the wall   // shut: the rear hatch's panel (built open in Blender, so 1 swings it shut)
  const apply = () => {
    const val = { yaw: domeAngle(st.yaw), pitch: st.pitch, wind, hatch: shut, door: doorS };
    for (let i = 1; i < parts.length; i++) rig.uRigP.value[i].w = (val[parts[i].driver] ?? 0) * parts[i].ratio;
  };
  apply();

  let yawVel = 0, pitchVel = 0, tick = 0, rumble = null;
  const pier = root.localToWorld(new THREE.Vector3(0, 2.5, 0));
  const turn = (dy, dp) => {
    st.yaw += dy;
    const before = st.pitch;
    st.pitch = clamp(st.pitch + dp, 0.04, 1.15);
    dp = st.pitch - before;
    yawVel = Math.abs(dy); pitchVel = Math.abs(dp);
    tick += Math.abs(dy) * 6 + Math.abs(dp) * 16;
    if (tick > 0.35) { tick = 0; ctx.audio?.play('gearTick', { pos: consoleSound }); }
    apply();
  };

  // Invisible pick proxies: the merged meshes can't tell a handwheel from a wall.
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = (geo, pos, axis) => {
    const m = new THREE.Mesh(geo, proxyMat);
    m.position.copy(pos);
    if (axis) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    root.add(m);
    m.updateMatrixWorld(true);
    return m;
  };
  const wheelProxy = (name) => {
    const p = parts.find((q) => q && q.name === name);
    return proxy(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 16), p.pivot.clone().addScaledVector(p.axis, 0.34).add(new THREE.Vector3(0, 0.12, 0)), p.axis);
  };
  const azProxy = wheelProxy('AzWheel'), altProxy = wheelProxy('AltWheel');
  const consoleSound = root.localToWorld(parts.find((q) => q && q.name === 'AzWheel').pivot.clone().lerp(parts.find((q) => q && q.name === 'AltWheel').pivot, 0.5));
  const viewerProxy = proxy(new THREE.BoxGeometry(0.42, 0.42, 0.5), nodes.Viewer.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.6, 0)));
  const player = () => ctx.player;
  const controls = {};
  controls.az = ctx.interact.add({
    name: 'observatory:az-wheel', meshes: [azProxy], range: 2.4,
    onPress: () => { player().lookHandler = (mx) => turn(-mx * 0.0016, 0); },
    onRelease: () => { player().lookHandler = null; },
  });
  controls.alt = ctx.interact.add({
    name: 'observatory:alt-wheel', meshes: [altProxy], range: 2.4,
    onPress: () => { player().lookHandler = (mx, my) => turn(0, -my * 0.0012); },
    onRelease: () => { player().lookHandler = null; },
  });

  // ---- looking through the telescope: the view follows the tube; the tube only moves by the gears ----
  let viewing = false;
  const cam = ctx.camera;
  const baseFov = cam.fov;
  const pivotW = root.localToWorld(new THREE.Vector3(0, pivotY, 0));
  const scopeView = () => {
    const dir = new THREE.Vector3(Math.cos(st.yaw) * Math.cos(st.pitch), Math.sin(st.pitch), Math.sin(st.yaw) * Math.cos(st.pitch));
    cam.position.copy(pivotW).addScaledVector(dir, tubeFront + 0.3);
    // The optics look a little below the tube axis so the cliffs of distant stacks can be reached.
    const vp = st.pitch - VIEW_DROP;
    const view = new THREE.Vector3(Math.cos(st.yaw) * Math.cos(vp), Math.sin(vp), Math.sin(st.yaw) * Math.cos(vp));
    cam.up.set(0, 1, 0);
    cam.lookAt(cam.position.clone().add(view));
    ctx.fx.scopeAz = st.yaw;
    ctx.fx.scopeAlt = st.pitch;
  };
  const exitButton = typeof document !== 'undefined' && document.head && document.body ? createScopeExit(() => exitView()) : null;
  const exitView = () => {
    if (!viewing) return;
    viewing = false;
    exitButton?.show(false);
    ctx.fx.scope = 0;
    ctx.scopeFogMul = 1;
    cam.fov = baseFov; cam.updateProjectionMatrix();
    player().cameraControlled = true;
    player().lookHandler = null;
    player().canMove = true;
    ctx.audio?.play('click', {});
  };
  controls.viewer = ctx.interact.add({
    name: 'observatory:eyepiece', meshes: [viewerProxy], range: 2.3,
    onPress: () => {
      if (viewing) return exitView();
      viewing = true;
      exitButton?.show(true);
      ctx.fx.scope = 1;
      ctx.scopeFogMul = 0.3;   // good optics cut through the haze
      cam.fov = 3.2; cam.updateProjectionMatrix();
      player().cameraControlled = false;
      player().canMove = false;
      player().lookHandler = () => {};   // the mouse does nothing at the eyepiece
      ctx.audio?.play('click', {});
    },
  });
  ctx.exitScope = exitView;

  // ---- the rear hatch (a puzzle): a riveted square cut low in the back of the drum. When the dome and the
  // telescope both point at the top of the Rocks tor, the curved panel behind it swings aside and shows a yellow
  // plate with three screws; aim elsewhere and it swings back. ----
  const hatchPart = parts.find((q) => q && q.driver === 'hatch');
  const hatchPos = hatchPart ? root.localToWorld(hatchPart.pivot.clone()) : pier;
  let aim = null, goal = 0, scrape = null;
  // Yaw and pitch that put the tor top on the eyepiece's crosshair. The eyepiece rides 4.7 m out along the tube,
  // so solve by fixed-point iteration (it settles in a few steps at 600 m).
  const target = () => {
    const top = ctx.stacks.rocks?.torTop;
    if (aim || !top) return aim;
    const eye = new THREE.Vector3(), d = new THREE.Vector3();
    let yaw = 0, pitch = 0;
    for (let i = 0; i < 8; i++) {
      eye.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(tubeFront + 0.3).add(pivotW);
      d.subVectors(top, eye);
      yaw = Math.atan2(d.z, d.x);
      pitch = Math.asin(d.y / d.length()) + VIEW_DROP;
    }
    return (aim = { yaw, pitch });
  };
  const updateHatch = (dt) => {
    if (!hatchPart || !target()) return;
    // How far (rad) the tor top sits off the crosshair, across (yaw wraps; narrower when looking up or down) and up.
    const across = Math.abs(Math.atan2(Math.sin(st.yaw - aim.yaw), Math.cos(st.yaw - aim.yaw))) * Math.cos(aim.pitch - VIEW_DROP);
    const up = Math.abs(st.pitch - aim.pitch);
    const tol = HATCH_TOL * (goal ? 1.2 : 1);   // a little hysteresis, so it can't chatter on the edge
    goal = across < tol && up < tol ? 1 : 0;
    if (st.hatch === goal) return;
    scrape ||= ctx.audio?.loop('scrape', { pos: hatchPos }) ?? null;
    st.hatch = goal ? Math.min(1, st.hatch + dt / HATCH_TIME) : Math.max(0, st.hatch - dt / HATCH_TIME);
    shut = 1 - st.hatch * st.hatch * (3 - 2 * st.hatch);
    if (st.hatch === goal) {
      scrape?.stop(); scrape = null;
      ctx.audio?.play('switch', { pos: hatchPos, rate: 0.5 });   // the panel clunks home
    }
  };
  // Console helper (screenshots): aim the dome and the telescope at the tor top; the panel follows in 1.5 s.
  const hatch = {
    target, tolerance: HATCH_TOL,
    align: () => {
      if (!target()) return null;
      st.yaw += Math.atan2(Math.sin(aim.yaw - st.yaw), Math.cos(aim.yaw - st.yaw));   // the short way round
      st.pitch = aim.pitch;
      return aim;
    },
    // Put the panel at `v` (0 shut .. 1 open) at once (restoring a saved game, core/save.js).
    set: (v) => {
      st.hatch = clamp(v, 0, 1);
      shut = 1 - st.hatch * st.hatch * (3 - 2 * st.hatch);
      apply();
    },
  };

  // ---- the front door: shut until you open it. A click (on the leaf, wherever it stands) swings it out against the
  // wall, or back shut; while it is mostly shut it blocks the doorway. ----
  const doorPart = parts.find((q) => q && q.driver === 'door');
  let doorOpen = 0, doorGoal = 0, updateDoor = () => {};
  if (doorPart) {
    const hinge = doorPart.pivot, fl = meta.floorY ?? 0.28;
    // A click target that turns with the leaf: the rig's rotation about +Y at the hinge, from the leaf built shut
    // along -X (see the design's DOOR_OPEN).
    const swing = new THREE.Group();
    swing.position.copy(hinge);
    root.add(swing);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.14), new THREE.MeshBasicMaterial({ visible: false }));
    leaf.position.set(-0.7, fl + 1.13, 0);
    swing.add(leaf);
    const wc = root.localToWorld(new THREE.Vector3(hinge.x - 0.7, 0, hinge.z));
    const blocker = ctx.physics.addOBB({ x: wc.x, z: wc.z, hx: 0.75, hz: 0.1, ry: root.rotation.y, y0: center.y - 0.5, y1: center.y + 3, zone: 'surface' });
    const soundPos = root.localToWorld(new THREE.Vector3(hinge.x - 0.7, fl + 1.2, hinge.z));
    ctx.interact.add({
      name: 'observatory:door', meshes: [leaf], range: 2.7,
      onPress: () => { doorGoal = doorGoal ? 0 : 1; ctx.audio?.play(doorGoal ? 'hingeOpen' : 'hingeClose', { pos: soundPos }); },
    });
    updateDoor = (dt) => {
      if (doorOpen === doorGoal) return;
      doorOpen = doorGoal > doorOpen ? Math.min(1, doorOpen + dt / 1.4) : Math.max(0, doorOpen - dt / 1.4);
      doorS = doorOpen * doorOpen * (3 - 2 * doorOpen);
      swing.rotation.y = doorS * doorPart.ratio;
      swing.updateMatrixWorld(true);
      blocker.enabled = doorOpen < 0.3;
    };
  }

  // ---- service ladders up the back and the roof station (props/observatoryStation.js): they meet, and the station
  // can be stood on, only while the telescope points at the Dome stack. ----
  const station = createStation(ctx, { root, nodes, st, doorAngle, domeAngle, center });

  ctx.updaters.push((dt) => {
    timeU.value = atmo.uTime.value;
    k = (1 + atmo.uNight.value * 0.3) / Math.max(0.5, atmoState.exposure);
    kU.value = 1.25 * k;
    M.emissive.color.setRGB(3.2 * k, 2.3 * k, 1.3 * k);
    wind += dt * (2.5 + 1.5 * Math.sin(timeU.value * 0.07) + Math.sin(timeU.value * 0.31));
    updateHatch(dt);
    updateDoor(dt);
    apply();
    station?.update(dt);
    if (viewing) {
      scopeView();
      const a = ctx.input.axis();
      if (a.x || a.y || ctx.input.keys.has('Escape')) exitView();
    }
    const moving = yawVel + pitchVel > 1e-5;
    if (moving && !rumble) rumble = ctx.audio?.loop('domeRumble', { pos: pier });
    if (!moving && rumble) { rumble.stop(); rumble = null; }
    yawVel = 0; pitchVel = 0;
  });

  return { root, st, parts, controls, viewing: () => viewing, hatch, ladder: station?.ladder, station: station?.station, finish: () => station?.finish() };
}
