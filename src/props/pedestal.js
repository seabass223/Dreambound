import * as THREE from 'three';
import { GLTFLoader } from '../render/gltf.js';
import { patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { addKeepOut } from '../render/lod.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SCENE_FOG_GLSL } from '../render/glsl.js';

// The End stack's last props (tools/blender/endprops_design.py: public/models/endprops.glb).
//
// The pedestal: between the landing and the aperture, a column standing out of a small square hole in the cap, in a
// steel bezel set level at the ground, over a dark shaft. On its cap, sloped toward the player coming from the landing,
// one red domed button in a chrome collar, glowing in a slow faint pulse. Pressing it (the interact item
// 'end:pedestal') asks ctx.onPedestal() to start the ending; the ending sinks the column into the shaft (setSink),
// where it goes black (its materials darken below the bezel), and the hole stays (a box keeps you out of it).
//
// The light shafts: long tapered cones rising and splaying out of the aperture's pit, drawn additively with soft
// edges by view angle, a slow noise drifting up them, fading at the base, with height and into the fog. Hidden until
// set(v) > 0; set(v) also grows them up out of the pit (0.75 reaches the tops).
//
// Both are built with the world (the preloader compiles them hidden). Their updates run in ctx.updaters.

const PULSE_HZ = 0.3;                                   // the button's breathing
// The button's light (linear) and its glow at the pulse's middle: a deep red through the tone mapping at the night's
// exposure (much more and it turns orange), a dim one by day.
const BUTTON_RED = new THREE.Color(1.0, 0.03, 0.012);
const GLOW = 0.3;
const LOD_OUT = [120, 150];

export async function loadEndProps() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const [gltf, ao, steel, steelN] = await Promise.all([
    new GLTFLoader().loadAsync(base + 'endprops.glb'),
    ...['endprops_ao.png', 'endprops_steel.png', 'endprops_steel_normal.png'].map((f) => tl.loadAsync(base + f)),
  ]);
  ao.flipY = false; ao.channel = 1; ao.colorSpace = THREE.NoColorSpace;
  ao.generateMipmaps = false; ao.minFilter = THREE.LinearFilter;   // an atlas of small charts (see cabin.js)
  for (const t of [steel, steelN]) { t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  steel.colorSpace = THREE.SRGBColorSpace;
  steelN.colorSpace = THREE.NoColorSpace;
  return { gltf, ao, steel, steelN };
}

// The model, read once per asset: static geometry by material (in the model's frame: the shaft), the parts (BEZEL,
// COLUMN, BUTTON inside it, SHAFTS) with their geometry relative to their pivots, and the named empties.
const parsed = new WeakMap();
function parse(asset) {
  if (parsed.has(asset)) return parsed.get(asset);
  const scene = asset.gltf.scene;
  scene.updateMatrixWorld(true);
  const key = (o) => (o.material?.name || '').replace(/^endp_/, '');
  const statics = {}, parts = {}, nodes = {};
  scene.traverse((o) => {
    if (o === scene) return;
    if (!o.isMesh) { nodes[o.name] = o; return; }
    if (o.name === 'COLLIDER' || key(o) === 'collider') return;
    if (o.parent === scene) statics[key(o)] = o.geometry.clone().applyMatrix4(o.matrixWorld);
  });
  for (const name of ['BEZEL', 'COLUMN', 'BUTTON', 'SHAFTS']) {
    const n = nodes[name];
    if (!n) continue;
    const geos = {};
    for (const c of n.children) if (c.isMesh) geos[key(c)] = c.geometry.clone().applyMatrix4(c.matrix);
    parts[name] = { pos: n.position.clone(), data: n.userData, geos };
  }
  const at = (name) => nodes[name]?.getWorldPosition(new THREE.Vector3()) ?? null;
  const P = { statics, parts, meta: nodes.META?.userData ?? {}, top: at('TOP'), crown: at('BUTTON_TOP'), hit: at('HIT'), hitSize: nodes.HIT?.userData ?? {} };
  parsed.set(asset, P);
  return P;
}

// The rectangle to cut out of the cap (Stack opts.capHoles) for a pedestal standing at (x, z) facing `toward`: push
// it before the stack is built. Hidden under the bezel's flange.
export function pedestalHole(asset, { x, z, toward }) {
  const h = parse(asset).meta.hole_half ?? 0.31;
  return { x, z, ry: Math.atan2(toward.x, toward.z), x0: -h, x1: h, z0: -h, z1: h };
}

// The column's materials go black below the bezel's top (uHoleY, world): down the shaft no light reaches.
function sinkable(mat, holeY) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHoleY = holeY;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHoleY;')
      .replace('#include <opaque_fragment>', `outgoingLight *= 1.0 - smoothstep(uHoleY + 0.02, uHoleY - 0.5, vFogWorld.y);
        #include <opaque_fragment>`);
  };
  patchMaterial(mat);   // (after: it runs the hook above first, then adds the fog, which declares vFogWorld)
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => key() + '|sink';
  return mat;
}

// Places the pedestal with its axis at `center` (x, z; y is the ground there) and its button panel facing `toward`
// (horizontal). ground(x, z) (optional): the ground's height. The bezel then lies flush on it: tilted to the plane that
// fits the ground under it best and lifted just clear of it everywhere (the End's cap slopes a few degrees there; a
// level frame stood 7 cm proud on the low side); the column stays upright, its axis through the plane at the centre.
// Sets ctx.pedestal. Returns
//   { root, buttonPos, top, item, press(), setSink(v), setPulse(on), update(dt), pressed, sunk }
// buttonPos: the button's crown (world, at rest); top: the middle of the column's cap (world, at rest).
// press(): the button goes in and out with a click ('pedestalButton') and a flash of its light; once only.
// setSink(v): 0 standing .. 1 gone down the shaft (eased here; hidden at 1). Pressing is off from the first move.
// setPulse(on): the button's slow glow, or (off) its light fading out.
export function placePedestal(ctx, asset, { center, toward, ground = null }) {
  const P = parse(asset);
  const meta = P.meta;
  const flange = meta.skirt_half ?? 0.4, sinkBy = meta.sink ?? 1.72;
  const ry = Math.atan2(toward.x, toward.z);
  const c = Math.cos(ry), s = Math.sin(ry);
  let y = center.y;
  const tilt = new THREE.Quaternion();
  if (ground) {
    // The plane y = a + b lx + c lz (pedestal-local x, z) fitting the ground under the skirt's square (least squares),
    // then up by the most the ground stands above it, plus a centimetre.
    const S = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const lx = (i / 4) * flange, lz = (j / 4) * flange;
      const h = ground(center.x + lx * c + lz * s, center.z - lx * s + lz * c);
      if (Number.isFinite(h)) S.push([lx, lz, h]);
    }
    if (S.length >= 3) {
      const m0 = S.reduce((t, [, , h]) => t + h, 0) / S.length;
      // (The samples are symmetric about the axis, so the slopes separate: b = sum(lx h) / sum(lx^2), likewise c.)
      const sxx = S.reduce((t, [lx]) => t + lx * lx, 0), szz = S.reduce((t, [, lz]) => t + lz * lz, 0);
      const b = S.reduce((t, [lx, , h]) => t + lx * (h - m0), 0) / sxx, cz = S.reduce((t, [, lz, h]) => t + lz * (h - m0), 0) / szz;
      const lift = Math.max(...S.map(([lx, lz, h]) => h - (m0 + b * lx + cz * lz)));
      y = m0 + lift + 0.01;
      tilt.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-b, 1, -cz).normalize());
    }
  }
  const root = new THREE.Group();
  root.name = 'pedestal';
  root.position.set(center.x, y, center.z);
  root.rotation.y = ry;
  ctx.surface.add(root);
  root.updateMatrixWorld(true);

  // Materials.
  const holeY = { value: y };
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, envMapIntensity: 0.8, ...o });
  const shaft = patchMaterial(std({ name: 'pedestal-shaft', aoMap: asset.ao, color: 0x1e1e1f, roughness: 0.95, envMapIntensity: 0.3 }));
  const M = {
    steel: patchMaterial(std({ name: 'pedestal-steel', map: asset.steel, normalMap: asset.steelN, normalScale: new THREE.Vector2(0.7, -0.7), aoMap: asset.ao, color: 0xd2d0cc, metalness: 0.8, roughness: 0.52 })),
    shaft,
    collar: shaft,   // (the bezel's collar and the bolts' sockets)
    paint: sinkable(std({ name: 'pedestal-paint', aoMap: asset.ao, color: 0x3c434d, metalness: 0.5, roughness: 0.42 }), holeY),
    panel: sinkable(std({ name: 'pedestal-panel', aoMap: asset.ao, color: 0x0a0b0d, metalness: 0.3, roughness: 0.12, envMapIntensity: 1.2 }), holeY),
    chrome: sinkable(std({ name: 'pedestal-chrome', color: 0xdfe3e8, metalness: 1, roughness: 0.12, envMapIntensity: 1.4 }), holeY),
    button: sinkable(std({ name: 'pedestal-button', color: 0x5a0805, roughness: 0.2, metalness: 0, emissive: BUTTON_RED, emissiveIntensity: GLOW, envMapIntensity: 1.1 }), holeY),
  };
  const mesh = (geo, k, parent) => {
    const mat = M[k];
    if (!mat || !geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'pedestal:' + k;
    m.castShadow = k !== 'shaft' && k !== 'button';
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  for (const [k, geo] of Object.entries(P.statics)) mesh(geo, k, root);
  const bez = P.parts.BEZEL;
  const bezel = new THREE.Group();
  bezel.name = 'pedestal:bezel';
  bezel.position.copy(bez?.pos ?? new THREE.Vector3());
  bezel.quaternion.copy(tilt);
  root.add(bezel);
  for (const [k, geo] of Object.entries(bez?.geos ?? {})) mesh(geo, k, bezel);

  // The column (a part: it sinks whole) and the button in it.
  const col = P.parts.COLUMN;
  const column = new THREE.Group();
  column.name = 'pedestal:column';
  column.position.copy(col?.pos ?? new THREE.Vector3());
  root.add(column);
  const colY = column.position.y;
  for (const [k, geo] of Object.entries(col?.geos ?? {})) mesh(geo, k, column);
  const btn = P.parts.BUTTON;
  const button = new THREE.Group();
  button.name = 'pedestal:button';
  button.position.copy(btn?.pos ?? new THREE.Vector3());
  column.add(button);
  for (const [k, geo] of Object.entries(btn?.geos ?? {})) mesh(geo, k, button);
  const rest = button.position.clone();
  const axis = new THREE.Vector3(...(btn?.data.axis ?? [0, -1, 0]));
  const travel = btn?.data.travel ?? 0.009;

  // What you press: a box round the column's top (it sinks with it).
  const hs = P.hitSize;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(hs.hit_w ?? 0.44, hs.hit_h ?? 0.44, hs.hit_d ?? 0.44), new THREE.MeshBasicMaterial({ visible: false }));
  hit.name = 'pedestal:hit';
  hit.position.copy(P.hit ?? new THREE.Vector3(0, 0.98, 0));
  column.add(hit);
  root.updateMatrixWorld(true);

  // The hole: a box over it keeps you out, standing or sunk (a stack collider can't take the column's moves).
  const half = (meta.open_half ?? 0.21) - 0.01;
  const collider = ctx.physics.addOBB({ x: center.x, z: center.z, hx: half, hz: half, ry, y0: y - 0.5, y1: y + 1.3, zone: 'surface' });
  // No grass tufts or pebbles on the bezel or round its edge (dropped after the scatter's draws: nothing else moves).
  addKeepOut(root.matrixWorld, new THREE.Box3(new THREE.Vector3(-flange - 0.4, -1.5, -flange - 0.4), new THREE.Vector3(flange + 0.4, 2, flange + 0.4)));
  ctx.lod.add(root, { out: LOD_OUT, dynamic: true, name: 'pedestal' });

  const toWorld = (v) => (v ? root.localToWorld(v.clone()) : root.localToWorld(new THREE.Vector3(0, 1.05, 0)));
  let pressed = false, pressT = -1, sink = 0, pulse = true, glow = 1, flash = 0, t = 0;
  const api = {
    root,
    buttonPos: toWorld(P.crown),
    top: toWorld(P.top),
    item: null,
    collider,
    get pressed() { return pressed; },
    get sunk() { return sink; },
    press() {
      if (pressed) return;
      pressed = true;
      pressT = 0;
      flash = 1;
      if (api.item) api.item.enabled = false;
      ctx.audio?.play?.('pedestalButton', { pos: api.buttonPos });
    },
    setSink(v) {
      sink = Math.min(1, Math.max(0, v));
      const e = sink * sink * (3 - 2 * sink);
      column.position.y = colY - e * sinkBy;
      column.visible = sink < 1;
      if (sink > 0 && api.item) api.item.enabled = false;
    },
    setPulse(on) { pulse = !!on; },
    update(dt) {
      t += dt;
      glow += ((pulse ? 1 : 0) - glow) * (1 - Math.exp(-dt * 2.2));
      flash = Math.max(0, flash - dt * 2.5);
      M.button.emissiveIntensity = GLOW * glow * (1 + 0.1 * Math.sin(t * Math.PI * 2 * PULSE_HZ)) + flash * 0.9;
      if (pressT >= 0) {
        pressT += dt;
        const d = pressT < 0.07 ? pressT / 0.07 : pressT < 0.2 ? 1 : Math.max(0, 1 - (pressT - 0.2) / 0.25);
        button.position.copy(rest).addScaledVector(axis, d * travel);
        if (pressT > 0.45) pressT = -1;
      }
    },
  };
  // Pressing asks the game to start the ending (it may refuse by returning false); the click is the pedestal's own.
  api.item = ctx.interact.add({
    name: 'end:pedestal', meshes: [hit], range: 2.6, zone: 'surface',
    onPress: () => {
      if (pressed || sink > 0 || !ctx.onPedestal) return;
      if (ctx.onPedestal() !== false) api.press();
    },
  });
  ctx.updaters.push((dt) => api.update(dt));
  api.update(0);
  ctx.pedestal = api;
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// The light shafts.
const SHAFT_VERT = /* glsl */ `
attribute vec2 aBeam;     // the beam's weight and phase
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec2 vBeam;
void main() {
  vUv = uv;
  vBeam = aBeam;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SHAFT_FRAG = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${NOISE_GLSL}
${SCENE_FOG_GLSL}
uniform float uLevel;     // brightness (0..1 and beyond)
uniform float uReach;     // how far up the beams have risen (0 .. 1.15, of their length)
uniform float uBeamTime;
uniform vec3 uColor;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec2 vBeam;
// Value noise repeating every P in x: round a beam, so its seam (where u jumps back) doesn't show.
float wrapNoise(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P), x1 = mod(i.x + 1.0, P);
  return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), u.x), mix(hash12(vec2(x0, i.y + 1.0)), hash12(vec2(x1, i.y + 1.0)), u.x), u.y);
}
void main() {
  float v = vUv.y;
  // (The design keeps u in 0.02 .. 0.98 round each beam, so floor() always finds its index.)
  float id = floor(vUv.x), around = (fract(vUv.x) - 0.02) / 0.96;
  // Soft edges: a cone's sides are bright where they face you and thin to nothing at its silhouette.
  float facing = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
  float soft = facing * facing * facing;
  // A slow noise drifting up each beam: streaks round it, swells along it.
  float y = v * 7.0 - uBeamTime * (0.22 + 0.1 * vBeam.y) + vBeam.y * 9.0 + id * 17.13;
  float n = 0.5 * wrapNoise(vec2(around * 6.0, y), 6.0) + 0.25 * wrapNoise(vec2(around * 12.0, y * 2.03 + 11.7), 12.0)
    + 0.125 * wrapNoise(vec2(around * 24.0, y * 4.1 - 5.3), 24.0);
  float streak = 0.12 + 1.7 * n * n;                               // mostly dark between brighter streaks
  float base = smoothstep(0.015, 0.08, v);                       // born down in the pit
  float tip = 1.0 - smoothstep(0.3, 1.0, v);
  float rise = 1.0 - smoothstep(uReach - 0.14, uReach, v);       // the front of the rise
  float near = smoothstep(0.8, 4.0, distance(vW, cameraPosition));   // no wall of light across the lens
  float deck;
  float T = sceneFog(vec3(1.0), vW, deck).g - sceneFog(vec3(0.0), vW, deck).g;
  float k = soft * streak * base * tip * tip * rise * near * vBeam.x * uLevel * clamp(T, 0.0, 1.0);
  // (Additive, under the night's eye-adapted exposure (~3x the day's): kept low, so the beams overlapping at the pit
  // stay separate shafts with the storm between them rather than one wall of light.)
  gl_FragColor = vec4(uColor * k * 0.05, 1.0);
}
`;

// The light shafts out of the aperture at `center` (its middle, on the cap). Sets ctx.lightShafts. Returns
// { group, material, level, set(v), update(dt) }: set(v) 0 hidden .. 1 risen and full (more is brighter).
export function createLightShafts(ctx, asset, { center }) {
  const src = parse(asset).parts.SHAFTS?.geos.beam;
  const group = new THREE.Group();
  group.name = 'light-shafts';
  group.position.copy(center);
  group.visible = false;
  ctx.surface.add(group);
  const U = {
    uTime: atmo.uTime, uSunDir: atmo.uSunDir, uMoonDir: atmo.uMoonDir, uZenith: atmo.uZenith, uHorizonAway: atmo.uHorizonAway,
    uHorizonSun: atmo.uHorizonSun, uSunGlow: atmo.uSunGlow, uNight: atmo.uNight, uUnderground: atmo.uUnderground,
    uFogDensity: atmo.uFogDensity, uFogLow: atmo.uFogLow, uFogTint: atmo.uFogTint, uCloudColor: atmo.uCloudColor,
    uLevel: { value: 0 }, uReach: { value: 0 }, uBeamTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.84, 0.6) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'light-shafts', uniforms: U, vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  if (src) {
    // The vertex colour's red and green are each beam's weight and phase (see the design).
    // (glTF counts v from the top of the texture: turned back, so v runs 0 at a beam's base to 1 at its top.)
    const geo = src.clone();
    const col = geo.attributes.color, uv = geo.attributes.uv, n = geo.attributes.position.count;
    const beam = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      beam[i * 2] = col ? col.getX(i) : 1; beam[i * 2 + 1] = col ? col.getY(i) : 0;
      uv.setY(i, 1 - uv.getY(i));
    }
    geo.setAttribute('aBeam', new THREE.BufferAttribute(beam, 2));
    geo.deleteAttribute('color');
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'light-shafts';
    mesh.renderOrder = 5;
    group.add(mesh);
  }
  let level = 0;
  const api = {
    group,
    material,
    get level() { return level; },
    set(v) {
      level = Math.max(0, v);
      group.visible = level > 0.001;
      U.uLevel.value = Math.min(level, 2);
      const r = Math.min(1, level / 0.75);
      U.uReach.value = 1.15 * r * r * (3 - 2 * r);
    },
    update(dt) {
      if (group.visible) U.uBeamTime.value += dt;
    },
  };
  ctx.updaters.push((dt) => api.update(dt));
  ctx.lightShafts = api;
  return api;
}
