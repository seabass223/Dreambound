import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/materials.js';
import { atmo, atmoState } from '../render/atmosphere.js';
import { SCREEN_FRAG, UV_VERT } from '../render/crt.js';
import { createTerminal } from './terminal.js';

// The survey relay room at the bottom of the Tower's bunker stair (world/bunker.js), modeled, textured and lit in
// Blender (tools/blender/bunker_design.py): block walls, a polished concrete floor, orange cabinets, a workbench with the
// terminal you can sit at (props/terminal.js), an oscilloscope and a radar, three enamel pendants under steel beams and a
// big round duct. Lit like the lounge: every surface drawn unlit from one baked Cycles lightmap (stored cube-root), times
// the surface zone's exposure factor k, so it reads the same at noon and at midnight. On top of that, drawn here:
//   - highlights of the room's lamps (the light empties) on the glossy things: enamel, steel, the duct's aluminium;
//   - the normal maps (block joints, enamel chips) as relief under those lamps;
//   - the floor: polished concrete, its gloss mapped (pitted where the polish has gone), reflecting a Blender panorama of
//     the lit room parallax-corrected against the room's box, blurred by its roughness, plus the lamps' own glints;
//   - the scope and radar CRTs (render/crt.js) in blue phosphor; the scope reads the tor spring's flow meter, so once the
//     tor is blown (world/torBlast.js) its trace dies down to a flat, noisy line.
// The pendants also light the lit (standard-material) things near them through the shared light pool: the elevator's
// plate and doors, and the bottom of the stair. Furniture collides as oriented boxes (the OBB_n empties); walls, floor and
// ceiling are world/bunker.js's own shell.
//
// The model also holds CAM 07, the camera rocks.exe watches the tor through (sequences/rocksExe.js): its housing is
// strapped to the Rocks sequoia here, at stack.hiddenCam (world/stacks/rocks.js).

const FILES = {
  lm: 'bunker_lm.png', env: 'bunker_env.png', wall: 'bunker_wall.png', wallN: 'bunker_wall_normal.png',
  floor: 'bunker_floor.png', floorR: 'bunker_floor_rough.png', floorN: 'bunker_floor_normal.png',
  concrete: 'bunker_concrete.png', orange: 'bunker_orange.png', orangeN: 'bunker_orange_normal.png',
  green: 'bunker_green.png', greenN: 'bunker_green_normal.png', steel: 'bunker_steel.png', alu: 'bunker_alu.png',
  decal: 'bunker_decal.png',
};
const DATA = new Set(['lm', 'env', 'wallN', 'floorR', 'floorN', 'orangeN', 'greenN']);   // not colour: no sRGB decode
const TILED = new Set(['wall', 'wallN', 'concrete', 'orange', 'orangeN', 'green', 'greenN', 'steel', 'alu']);

// Missing files leave the room procedural (world/bunker.js draws its bare shell instead).
export async function loadBunker() {
  const base = import.meta.env.BASE_URL + 'models/';
  const tl = new THREE.TextureLoader();
  const keys = Object.keys(FILES);
  try {
    const [gltf, ...tex] = await Promise.all([new GLTFLoader().loadAsync(base + 'bunker.glb'), ...keys.map((k) => tl.loadAsync(base + FILES[k]))]);
    const T = Object.fromEntries(keys.map((k, i) => [k, tex[i]]));
    for (const [k, t] of Object.entries(T)) {
      t.flipY = false;                     // glTF UVs
      t.colorSpace = DATA.has(k) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (TILED.has(k)) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = k.startsWith('floor') ? 16 : 8;   // (the floor is seen at grazing angles)
    }
    // The lightmap: an atlas of many small charts (mipmaps would bleed them together).
    T.lm.generateMipmaps = false;
    T.lm.minFilter = THREE.LinearFilter;
    T.lm.anisotropy = 1;
    // The panorama: its mips are the blurred reflections of the rougher floor (always sampled at an explicit level, so the
    // wrap seam behind -x has no derivative spike); it wraps round in u.
    T.env.wrapS = THREE.RepeatWrapping;
    T.env.anisotropy = 1;
    return { gltf, ...T };
  } catch (e) {
    console.warn('bunker: no room model, the bare shell stays', e);
    return null;
  }
}

// ---------------------------------------------------------------- shaders
// Every mesh is in the room's frame (the model's), so the shading is done there: vRP / vRN the room-space position and
// normal, uCamR the camera in the room's frame.
const NL = 9;   // lights: 3 pendants, 2 bar lights, the desk lamp (warm, the first WARM), then the 3 screens (blue)
const WARM = 6;
const VERT = /* glsl */ `
attribute vec2 aLmUv;
varying vec2 vLmUv;
varying vec2 vUv0;
varying vec3 vRP;
varying vec3 vRN;
`;
const FRAG = /* glsl */ `
#define NL ${NL}
uniform sampler2D uLm, uEnv;
uniform float uLmScale, uEnvScale, uGain, uK;
uniform vec3 uAmb, uCamR, uEnvPos, uBoxMin, uBoxMax;
uniform vec3 uLP[NL];
uniform vec3 uLC[NL];
uniform vec4 uLD[NL];
uniform float uLR[NL];
varying vec2 vLmUv;
varying vec2 vUv0;
varying vec3 vRP;
varying vec3 vRN;
// Baked light (Cycles diffuse, direct + bounce), stored as (L / scale)^(1/3); uGain carries the exposure factor.
vec3 bkLightRaw() { vec3 s = texture2D(uLm, vLmUv).rgb; return s * s * s * uLmScale; }
// The bake's hot spots (inside the shades, a hand's breadth from a 60 W bulb) rolled off, so they glow without
// flooding the room with bloom; everything the lamps light at a distance is untouched (the knee is above it).
vec3 bkKnee(vec3 v) {
  float m = max(v.r, max(v.g, v.b)) / uK;
  return m > 0.8 ? v * (0.8 + log(1.0 + (m - 0.8) * 1.5) / 1.5) / m : v;
}
vec3 bkLight() { return bkKnee(bkLightRaw() * uGain) + uAmb * uK; }
// How much of the room's light reaches here (0 in the dark under the desk, 1 out in the open): keeps the lamps' glints
// and the panorama's reflection out of places the lamps can't see.
float bkOpen(vec3 raw) { return smoothstep(0.004, 0.06, dot(raw, vec3(0.3, 0.59, 0.11))); }
// Each lamp's light leaves it only one way: under its dome (0), off the face of a panel (1: bar lights, screens), in the
// desk lamp's cone (2). L: from the surface to the lamp.
float bkEmit(int i, vec3 L) {
  vec4 d = uLD[i];
  float c = dot(-L, d.xyz);
  if (d.w < 0.5) return smoothstep(0.12, 0.5, c);
  if (d.w < 1.5) return max(c, 0.0);
  return smoothstep(0.45, 0.8, c);
}
// Highlights of the lamps (GGX, Smith, Schlick). a2 = alpha^2 (alpha = roughness^2). A lamp's size widens its highlight
// (renormalised, as for a sphere light) so the small bright bulbs don't sparkle off single pixels.
vec3 bkSpec(vec3 N, vec3 V, float a2, vec3 F0, int n) {
  vec3 acc = vec3(0.0);
  float NoV = max(dot(N, V), 1e-3);
  for (int i = 0; i < NL; i++) {
    if (i >= n) break;
    vec3 L = uLP[i] - vRP;
    float d2 = dot(L, L);
    L *= inversesqrt(d2);
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;
    float e = bkEmit(i, L);
    if (e <= 0.0) continue;
    vec3 H = normalize(L + V);
    float NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
    float al = clamp(sqrt(a2) + uLR[i] * inversesqrt(d2) * 0.5, 0.0, 1.0);
    float a2l = al * al;
    float dd = NoH * NoH * (a2l - 1.0) + 1.0;
    float D = a2 / (3.14159265 * dd * dd);
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2l) + a2l), gl = NoV * sqrt(NoL * NoL * (1.0 - a2l) + a2l);
    float Vis = 0.5 / max(gv + gl, 1e-5);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
    acc += uLC[i] * (e * NoL / d2 * D * Vis) * F;
  }
  return acc;
}
// Relief from a normal map under the warm lamps: how much more (or less) of their light the bumped normal catches than the
// flat one (with a share of soft light that doesn't care), to multiply the baked light by.
float bkRelief(vec3 Ng, vec3 Nm) {
  float a = 0.0, b = 0.0, w0 = 0.0;
  for (int i = 0; i < ${WARM}; i++) {
    vec3 L = uLP[i] - vRP;
    float d2 = dot(L, L);
    L *= inversesqrt(d2);
    float w = dot(uLC[i], vec3(0.3, 0.59, 0.11)) * bkEmit(i, L) / d2;
    a += w * max(dot(Nm, L), 0.0);
    b += w * max(dot(Ng, L), 0.0);
    w0 += w;
  }
  return (a + 0.35 * w0) / max(b + 0.35 * w0, 1e-6);
}
// The room as Blender rendered it from uEnvPos (equirect, top row straight up, stored like the lightmap), looked up along
// R from p as if painted on the room's box (a parallax-corrected reflection), at mip level lod.
vec2 bkEnvUv(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) * 0.31830989); }
vec3 bkEnv(vec3 p, vec3 R, float lod) {
  p = clamp(p, uBoxMin + 0.002, uBoxMax - 0.002);
  vec3 Rs = R + vec3(1.3e-5, 1.7e-5, 1.1e-5);
  vec3 tf = max((uBoxMax - p) / Rs, (uBoxMin - p) / Rs);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 d = normalize(p + R * t - uEnvPos);
  vec3 s = textureLod(uEnv, bkEnvUv(d), lod).rgb;
  return s * s * s * uEnvScale * uGain;
}
// A tangent-space normal map's normal, from the screen-space derivatives of the position and UVs (no tangents in the
// model). The maps are +v up in Blender, which glTF flips: hence the -y.
vec3 bkBump(vec3 N, vec3 nt, float s) {
  vec3 dp1 = dFdx(vRP), dp2 = dFdy(vRP);
  vec2 du1 = dFdx(vUv0), du2 = dFdy(vUv0);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  return normalize(T * im * nt.x * s - B * im * nt.y * s + N * nt.z);
}
// Roughness widened by how much the normal turns under the pixel (specular anti-aliasing: no sparkle on bumps far away).
float bkAA(vec3 N, float a2) {
  vec3 dx = dFdx(N), dy = dFdy(N);
  return clamp(a2 + min(0.5 * (dot(dx, dx) + dot(dy, dy)), 0.2), 1e-4, 1.0);
}
`;

// patchMaterial (fog, the sky-light cut) plus the room's shading; `body` rewrites diffuseColor after the vertex colour
// (MeshBasicMaterial: what diffuseColor ends up as is what's drawn).
function roomMaterial(name, U, body, { extra = '', opts = {}, defines = {} } = {}) {
  const mat = patchMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, name: 'bunker_' + name, ...opts }));
  mat.defines = { ...(mat.defines || {}), ...defines };
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLmUv = aLmUv;
        vUv0 = uv;
        vRP = transformed;
        vRN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG + extra)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '|bunker_' + name;
  return mat;
}

// The common start of a lit surface's body: view vector, the light here, how open it is.
const LIT = /* glsl */ `
  vec3 V = normalize(uCamR - vRP);
  vec3 Ng = normalize(vRN) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 raw = bkLightRaw();
  vec3 lt = bkKnee(raw * uGain) + uAmb * uK;
  float open = bkOpen(raw);
`;

// The scope's trace: probe B on the tor spring's flow meter. Always a little noisy; once the spring is dry (uScope -> 0)
// the wave dies away and only the noise is left, on a flat line.
const SCOPE_Y = /* glsl */ `
uniform float uScope;
float bkScopeNoise(float x, float t) {
  float u = x * 140.0 + floor(t * 24.0) * 17.0, i = floor(u), f = fract(u);
  return mix(oh1(i), oh1(i + 1.0), f * f * (3.0 - 2.0 * f)) - 0.5;
}
float bkScopeY(vec2 p, float t, float y) {
  return 0.5 + (y - 0.5) * uScope + bkScopeNoise(p.x, t) * (0.035 + 0.02 * (1.0 - uScope));
}
#define CRT_SCOPE_Y(p, t, y) bkScopeY(p, t, y)
`;

// ---------------------------------------------------------------- placement
// parent: the bunker's root (its matrix is the frame F.m); the room goes in at (0, P.floor, P.zRoom) of the frame.
// near(p): whether the room might be in view from p (world); inside(p): whether p is in the bunker (behind its door);
// inCar(p): whether p is in the elevator's car standing behind the room; lamp: the door lamp's pool light (shared, so
// the outside stays lit as the pool switches to the room's lights).
// Returns { group, terminal, seat, spawn, center, callPos, finish() } or null.
export function placeBunkerRoom(ctx, asset, { F, P, parent, near, inside, inCar = () => false, isOpen, lamp }) {
  const src = asset.gltf.scene;
  src.updateMatrixWorld(true);
  const room = new THREE.Group();
  room.name = 'bunker-room';
  room.position.set(0, P.floor, P.zRoom);
  parent.add(room);
  room.updateMatrixWorld(true);
  room.matrixAutoUpdate = false;
  const view = new THREE.Group();   // shown only while the room can be in view (the LOD system owns `room`'s visibility)
  view.name = 'bunker-room-view';
  room.add(view);
  view.updateMatrixWorld(true);
  const toWorld = (v) => room.localToWorld(new THREE.Vector3().copy(v));
  const roomInv = room.matrixWorld.clone().invert();

  // ---- the model, merged per material (and layer) ----
  const nodes = {}, groups = {};
  src.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (!o.isMesh) return;
    const mat = (o.material?.name || '').replace(/^bunker_/, '');
    const lay = o.userData?.layer ?? o.name.split('@')[1]?.replace(/[._]\d+$/, '') ?? '';
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.attributes.uv1) { g.setAttribute('aLmUv', g.attributes.uv1); g.deleteAttribute('uv1'); }
    for (const k of Object.keys(g.attributes)) if (k.startsWith('uv') && k !== 'uv') g.deleteAttribute(k);
    (groups[lay ? mat + '@' + lay : mat] ||= []).push(g);
  });
  const meta = nodes.META?.userData ?? {};
  if (meta.hw != null && (Math.abs(meta.hw - 2.4) > 1e-3 || Math.abs(meta.d - 3.6) > 1e-3 || Math.abs(meta.h - 3) > 1e-3)) {
    console.warn('bunker: the room model is', meta.hw, meta.d, meta.h, 'but world/bunker.js builds 2.4 x 3.6 x 3.0');
  }
  const E = (name) => nodes[name]?.position.clone() ?? null;
  const ex = (name) => nodes[name]?.userData ?? {};

  // ---- lights: the room's lamps, for highlights (room frame) ----
  const lamps = Object.keys(nodes).filter((n) => /^LIGHT_\d+$/.test(n)).map((n) => ({ pos: E(n), ...ex(n) }));
  const order = { pendant: 0, bar: 1, lamp: 2, screen: 3 };
  lamps.sort((a, b) => (order[a.kind] ?? 4) - (order[b.kind] ?? 4));
  // (a touch over the bake's suggested gain: the reference's room is a warm, lit one)
  const gain = (meta.gain ?? 1.13) * 1.15;
  const lightU = {
    uLP: { value: [] }, uLC: { value: [] }, uLD: { value: [] }, uLR: { value: [] },
  };
  const lightBase = [];
  for (let i = 0; i < NL; i++) {
    const l = lamps[i];
    const pos = l?.pos ?? new THREE.Vector3(0, -50, 0);
    const col = new THREE.Color(...(l?.color ?? [0, 0, 0]));
    // A point light of P watts in Cycles, as the lightmap counts it: radiance off a surface = BRDF * P / (4 pi d^2) * cos.
    lightBase.push(col.multiplyScalar((l?.power ?? 0) / (4 * Math.PI)));
    lightU.uLP.value.push(pos);
    lightU.uLC.value.push(new THREE.Color());
    const dir = l?.kind === 'pendant' ? [0, -1, 0] : l?.kind === 'lamp' ? l.dir : l?.normal;
    const shape = l?.kind === 'pendant' ? 0 : l?.kind === 'lamp' ? 2 : 1;
    lightU.uLD.value.push(new THREE.Vector4(...(dir ?? [0, -1, 0]).map((c) => (Math.abs(c) < 1e-6 ? 0 : c)), shape));
    // (bar lights and screens: about a third of their face's size; bulbs a little bigger than the filament's glass)
    lightU.uLR.value.push(l?.kind === 'pendant' ? 0.06 : l?.kind === 'lamp' ? 0.03 : l?.size ? Math.min(...l.size) * 0.5 + 0.05 : 0.08);
  }

  const box = meta.env_box ?? [-2.4, 0, 0, 2.4, 3, 3.6];
  const U = {
    uLm: { value: asset.lm }, uLmScale: { value: meta.lm_scale ?? 1 }, uGain: { value: gain },
    uEnv: { value: asset.env }, uEnvScale: { value: meta.env_scale ?? 1 },
    uEnvPos: { value: new THREE.Vector3(...(meta.env_pos ?? [0, 1.1, 1.8])) },
    uBoxMin: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uBoxMax: { value: new THREE.Vector3(box[3], box[4], box[5]) },
    uAmb: { value: new THREE.Color(0.003, 0.0025, 0.002) }, uK: { value: 1 },
    uCamR: { value: new THREE.Vector3() },
    ...lightU,
  };
  const fm = meta.floor_map ?? { x0: -2.4, z0: 0, w: 4.8, d: 3.6 };
  // (the bulbs a little under the bake's own glow gain: they bloom, without fogging the room)
  const glow = { value: (meta.glow_gain ?? 3) * 0.75 };

  // ---- materials ----
  const M = {};
  // Cinderblock: the tile and its damp and soot (vertex colour) under the baked light, its joints and pores in relief.
  M.wall = roomMaterial('wall', { ...U, uT: { value: asset.wall }, uN: { value: asset.wallN } }, `${LIT}
    vec3 alb = texture2D(uT, vUv0).rgb;
    vec3 Nm = bkBump(Ng, texture2D(uN, vUv0).rgb * 2.0 - 1.0, 1.0);
    diffuseColor.rgb *= alb * lt * mix(1.0, bkRelief(Ng, Nm), 0.85);`, { extra: 'uniform sampler2D uT, uN;' });
  // The ceiling slab and the doorway's reveal: board-formed concrete.
  M.concrete = roomMaterial('concrete', { ...U, uT: { value: asset.concrete } }, `${LIT}
    diffuseColor.rgb *= texture2D(uT, vUv0).rgb * lt;`, { extra: 'uniform sampler2D uT;' });
  // Steel (beams, portal, frames, grates, shelving): mill scale and rust; painted where the vertex colour is dark, bare
  // and bright on the worn edges (where it shines).
  M.steel = roomMaterial('steel', { ...U, uT: { value: asset.steel } }, `${LIT}
    vec3 alb = texture2D(uT, vUv0).rgb;
    float bare = smoothstep(0.55, 0.95, vColor.g);
    // (the inset plate and the drains' frames, worn smooth underfoot: as glossy as the polished floor round them,
    // the scale and rust in the texture dulling it)
    float deck = step(0.9, Ng.y) * (1.0 - smoothstep(0.0, 0.04, vRP.y));
    float clean = smoothstep(0.08, 0.2, dot(alb, vec3(0.3, 0.59, 0.11)));
    float a = mix(mix(0.42, 0.24, bare), mix(0.36, 0.2, clean), deck), a2 = bkAA(Ng, a * a * a * a);
    vec3 F0 = mix(vec3(0.04), alb * 1.4, max(bare, deck * 0.5));
    vec3 R = reflect(-V, Ng);
    vec3 spec = bkSpec(Ng, V, a2, F0, ${NL}) * (1.0 + deck) + bkEnv(vRP, R, 2.0 + 4.0 * a) * (F0 + (1.0 - F0) * pow(1.0 - max(dot(Ng, V), 0.0), 5.0)) * (0.6 + 1.6 * deck);
    diffuseColor.rgb *= alb * lt * (1.0 - 0.5 * bare);
    diffuseColor.rgb += spec * open;`, { extra: 'uniform sampler2D uT;' });
  // Enamel (orange cabinets, pedestals, the CRT's housing, the chair; the grey-green locker and rack): glossy where the
  // paint is whole, dull where it's chipped to primer and rust; the chips in relief.
  const enamel = (name, tex, nrm, glossy) => roomMaterial(name, { ...U, uT: { value: tex }, uN: { value: nrm } }, `${LIT}
    vec3 alb = texture2D(uT, vUv0).rgb;
    vec3 Nm = bkBump(Ng, texture2D(uN, vUv0).rgb * 2.0 - 1.0, 1.0);
    // whole paint: saturated (orange) or ${glossy ? 'saturated' : 'light'} (green); chips: rust, primer, steel
    float sat = (max(alb.r, max(alb.g, alb.b)) - min(alb.r, min(alb.g, alb.b))) / max(max(alb.r, max(alb.g, alb.b)), 1e-3);
    float paint = ${glossy ? 'smoothstep(0.55, 0.8, sat)' : 'smoothstep(0.12, 0.3, sat) * smoothstep(0.02, 0.06, alb.g)'};
    float a = mix(0.62, ${glossy ? '0.3' : '0.42'}, paint), a2 = bkAA(Nm, a * a * a * a);
    vec3 R = reflect(-V, Nm);
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(Nm, V), 0.0), 5.0);
    vec3 spec = bkSpec(Nm, V, a2, vec3(0.04), ${NL}) * (0.4 + 0.6 * paint) + bkEnv(vRP, R, 2.5 + 4.0 * a) * fr * paint * ${glossy ? '0.8' : '0.45'};
    diffuseColor.rgb *= alb * lt * mix(1.0, bkRelief(Ng, Nm), 0.8);
    diffuseColor.rgb += spec * open;`, { extra: 'uniform sampler2D uT, uN;' });
  M.orange = enamel('orange', asset.orange, asset.orangeN, true);
  M.green = enamel('green', asset.green, asset.greenN, false);
  // The duct and its straps: spiral-seam aluminium, a soft metal sheen that brightens toward its edges.
  M.alu = roomMaterial('alu', { ...U, uT: { value: asset.alu } }, `${LIT}
    vec3 alb = texture2D(uT, vUv0).rgb;
    float a2 = bkAA(Ng, 0.33 * 0.33 * 0.33 * 0.33);
    vec3 F0 = alb * 0.95;
    vec3 R = reflect(-V, Ng);
    vec3 fr = F0 + (1.0 - F0) * pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
    // (the room it reflects, greyed a little: dull metal doesn't give back the cabinets' orange and the screens' blue)
    vec3 env = bkEnv(vRP, R, 3.0);
    env = mix(env, vec3(dot(env, vec3(0.3, 0.59, 0.11))), 0.45);
    vec3 spec = bkSpec(Ng, V, a2, F0, ${NL}) + env * fr * 0.75;
    diffuseColor.rgb *= alb * lt * 0.55;
    diffuseColor.rgb += spec * mix(0.35, 1.0, open);`, { extra: 'uniform sampler2D uT;' });
  // Everything vertex-coloured (keyboard, mug, papers, boxes, cables, cushions): a faint sheen.
  M.misc = roomMaterial('misc', U, `${LIT}
    diffuseColor.rgb *= lt;
    diffuseColor.rgb += bkSpec(Ng, V, bkAA(Ng, 0.16 * 0.16), vec3(0.03), ${WARM}) * 0.5 * open;`);
  // The printed things (desk top, corkboard and its sheets, labels, the clock's face, stickers). The radar's printed
  // bearing scale is a square sheet laid over its bezel, just proud of the glass: its middle, over the glass, is cut away.
  const rc = E('SCREEN_RADAR'), rn = ex('SCREEN_RADAR');
  const hole = rc ? new THREE.Vector4(rc.x, rc.y, rc.z, (rn.r ?? 0.165) + 0.002) : new THREE.Vector4(0, -50, 0, 0);
  const holeN = new THREE.Vector3(...(rn.normal ?? [1, 0, 0]).map((c) => (Math.abs(c) < 1e-6 ? 0 : c)));
  M.decal = roomMaterial('decal', { ...U, uT: { value: asset.decal }, uHole: { value: hole }, uHoleN: { value: holeN } }, `
    { vec3 hd = vRP - uHole.xyz; float hn = dot(hd, uHoleN);
      if (abs(hn) < 0.03 && length(hd - uHoleN * hn) < uHole.w) discard; }
    ${LIT}
    diffuseColor.rgb *= texture2D(uT, vUv0).rgb * lt;
    diffuseColor.rgb += bkSpec(Ng, V, bkAA(Ng, 0.3 * 0.3 * 0.3 * 0.3), vec3(0.03), ${WARM}) * 0.35 * open;`, { extra: 'uniform sampler2D uT;\nuniform vec4 uHole;\nuniform vec3 uHoleN;' });
  // The floor: polished concrete (the paint and stains in its texture), its roughness mapped: glossy where the polish
  // holds, dull in the pits, joints and dust, the paint and the worn paths in between. Reflects the room (the panorama,
  // blurred by roughness) and the lamps, more toward grazing angles (Fresnel), less where little light gets.
  const floorK = { value: new THREE.Vector4(0.11, 4.0, 1.0, 2.3) }, floorK2 = { value: new THREE.Vector4(1.7, 0.2, 0.8, 7.0) };
  M.floor = roomMaterial('floor', {
    ...U, uT: { value: asset.floor }, uR: { value: asset.floorR }, uN: { value: asset.floorN },
    uFM: { value: new THREE.Vector4(fm.x0, fm.z0, fm.w, fm.d) }, uFloorK: floorK, uFloorK2: floorK2,
  }, `${LIT}
    vec2 st = vec2((vUv0.x - uFM.x) / uFM.z, (vUv0.y - uFM.y) / uFM.w);
    vec3 alb = texture2D(uT, st).rgb;
    // (the polish, a little keener than the map: the worn paths stay matt, the pits rough)
    float rough = pow(texture2D(uR, st).r, uFloorK2.x);
    vec3 nt = texture2D(uN, st).rgb * 2.0 - 1.0;
    float nl = length(nt);
    vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(nt.x, nt.z, nt.y) / max(nl, 1e-3), uFloorK.z));   // (room space: r x, g z, b up)
    // Roughness: the map's, widened where its normals were averaged away in the mips (Toksvig) and where they turn
    // under the pixel, so the polish never sparkles.
    float a = rough * rough;
    float a2 = bkAA(N, a * a + (1.0 - min(nl, 1.0)) * 0.35);
    float rEff = sqrt(sqrt(a2));
    float gloss = 1.0 - smoothstep(uFloorK2.y, uFloorK2.z, rEff);
    float NoV = max(dot(N, V), 1e-3);
    // The wax's reflection (a little stronger than bare concrete's 4%), more toward grazing angles.
    float fres = uFloorK.x + (1.0 - uFloorK.x) * pow(1.0 - NoV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = bkEnv(vRP, R, rEff * uFloorK2.w) * fres * gloss * gloss * uFloorK.y;
    vec3 spec = bkSpec(N, V, a2, vec3(0.04), ${NL}) * uFloorK.w;
    diffuseColor.rgb *= alb * lt * (1.0 - min(fres * gloss * uFloorK.y, 0.6));
    diffuseColor.rgb += (refl + spec) * open;`, { extra: 'uniform sampler2D uT, uR, uN;\nuniform vec4 uFM, uFloorK, uFloorK2;' });
  // Bulbs and the bar lights' diffusers: bright enough to bloom.
  const glowU = { uGlow: { value: glow.value } };
  M.glow = roomMaterial('glow', { ...U, ...glowU }, 'diffuseColor.rgb = vColor.rgb * uGlow;', { extra: 'uniform float uGlow;' });
  // The indicator lamps: each its own (an id per lamp, below): most steady, some blinking slowly, a few chattering.
  M['glow@led'] = roomMaterial('led', { ...U, ...glowU, uTime: atmo.uTime }, `
    float h = fract(sin(aLedV * 12.9898) * 43758.5453), on = 1.0;
    if (h > 0.72) on = step(0.5, fract(uTime * (0.35 + h * 0.4) + h * 7.0));
    if (h > 0.9) on = step(0.45, fract(sin(floor(uTime * (7.0 + h * 9.0)) * 78.233 + h * 31.0) * 43758.5453));
    diffuseColor.rgb = vColor.rgb * uGlow * mix(0.08, 0.85, on);`, { extra: 'uniform float uGlow;\nvarying float aLedV;' });
  {
    // (the per-lamp id rides on its own attribute through a varying)
    const m = M['glow@led'], prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLed;\nvarying float aLedV;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\naLedV = aLed;');
    };
  }
  // The scope and radar glass: render/crt.js in blue phosphor, and a faint reflection of the room on the glass.
  const crtU = { uObsTime: { value: 0 }, uObsK: { value: 1 }, uScope: { value: 1 }, uTint: { value: new THREE.Color(0.16, 0.4, 1.0).multiplyScalar(1.7) } };
  M.screen = roomMaterial('screen', { ...U, ...crtU }, `
    vec3 V = normalize(uCamR - vRP);
    vec3 Ng = normalize(vRN);
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
    diffuseColor.rgb = crt(vObsUv, uTint) * uObsK + bkEnv(vRP, reflect(-V, Ng), 1.5) * fr * 0.35;`, { extra: 'uniform vec3 uTint;', opts: { vertexColors: false } });
  {
    const m = M.screen, prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev(sh, r); UV_VERT(sh, SCOPE_Y + SCREEN_FRAG); };
  }

  // ---- meshes ----
  const SHADOW = new Set(['wall', 'concrete']);   // the shell: keeps the sun off the plate and doors (the cap casts none)
  const meshes = {};
  for (const [key, geos] of Object.entries(groups)) {
    if (key.endsWith('@cctv') || key === 'screen@term') continue;
    const mat = M[key];
    if (!mat) { console.warn('bunker: no material for', key); continue; }
    const geo = mergeGeometries(geos, false);
    if (!geo) { console.warn('bunker: could not merge', key); continue; }
    if (key === 'glow@led') ledIds(geo);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'bunker_' + key;
    mesh.castShadow = SHADOW.has(key);
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    view.add(mesh);
    meshes[key] = mesh;
  }
  view.updateMatrixWorld(true);

  // ---- the terminal: its glass (props/terminal.js draws it), a pick box over the keyboard, the seat ----
  let terminal = null, seat = null;
  const termGeo = groups['screen@term'] ? mergeGeometries(groups['screen@term'], false) : null;
  const eyeN = nodes.SEAT_EYE, standN = nodes.SEAT_STAND;
  if (termGeo && eyeN && standN) {
    const screen = new THREE.Mesh(termGeo, M.glow);   // (createTerminal gives it its own material)
    screen.name = 'bunker_terminal';
    screen.matrixAutoUpdate = false;
    view.add(screen);
    // The keyboard (bunker_design.py keyboard(): 0.47 x 0.19 m on the desk top, 0.62 m out from the wall at z 2.1).
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    kb.name = 'bunker:keyboard';
    kb.position.set((meta.hw ?? 2.4) - 0.62, 0.8, 2.1);
    view.add(kb);
    kb.updateMatrixWorld(true);
    screen.updateMatrixWorld(true);
    const se = eyeN.userData;
    seat = {
      name: 'bunker:terminal',
      eye: toWorld(eyeN.position), stand: toWorld(standN.position).setY(room.matrixWorld.elements[13]),
      yaw: F.ry + (se.yaw ?? -Math.PI / 2), pitch: se.pitch ?? -0.135, fov: se.fov ?? 40,
    };
    terminal = createTerminal(ctx, { screen, seat, keyboard: kb });
  }

  // ---- the pendants in the shared light pool (lighting the plate, the doors and the stair), only while you're in the
  // bunker or the car at its end: nothing of theirs shines up through the ground onto the grass. The site claims the
  // pool exactly then, from the door's threshold down (so they light your way down from the landing), and nowhere
  // outside (the Tower's other sites are untouched); they fade in as you cross it, and out (the site held just outside
  // the door until they're dark). The door lamp is its fourth light, so the apron stays lit across the switch. ----
  let k = 1, here = 0;
  const down = (p) => inside(p) || inCar(p);
  const pend = lamps.filter((l) => l.kind === 'pendant').slice(0, 3);
  const warm = new THREE.Color(1, 0.66, 0.38);
  const PEND_I = 2.3;
  const center = toWorld(new THREE.Vector3(0, 1.5, 1.8));
  ctx.lightPool?.add({
    center, radius: 12, claim: (f) => down(f) || (here > 0 && near(f)),
    lights: [
      ...pend.map((l) => ({ pos: toWorld(l.pos.clone().add(new THREE.Vector3(0, -0.12, 0))), color: warm, distance: 7, intensity: () => PEND_I * k * here })),
      ...(lamp ? [lamp] : []),
    ],
  });

  // ---- CAM 07 on the sequoia ----
  const cam = placeCctv(ctx, asset, groups);

  // ---- per frame ----
  const _c = new THREE.Vector3();
  let scope = 1, first = true;
  ctx.updaters.push((dt) => {
    const camera = ctx.camera;
    const seen = !!camera && (near(camera.position) || isOpen());
    view.visible = seen;
    const night = atmo.uNight.value;
    k = (1 + night * 0.3) / Math.max(0.5, atmoState.exposure);
    const p = ctx.player;
    const there = !!p && down(p.feet);
    here = THREE.MathUtils.damp(here, there ? 1 : 0, 10, dt);
    if (here < 1e-3 && !there) here = 0;
    // The scope: once the tor is down its flow meter reads nothing. (It dies away while it can be watched: during the
    // feed and at the terminal; a restored game shows it flat at once.)
    const dry = !!(ctx.torBlast?.exploded?.() ?? ctx.state.tor?.exploded);
    const watching = !!p && (!p.cameraControlled || terminal?.active());
    scope = first || !watching ? (dry ? 0 : 1) : THREE.MathUtils.damp(scope, dry ? 0 : 1, 0.45, dt);
    first = false;
    cam?.update(dt, k);
    if (!seen) return;
    U.uGain.value = gain * k;
    U.uK.value = k;
    for (let i = 0; i < NL; i++) U.uLC.value[i].copy(lightBase[i]).multiplyScalar(gain * k);
    glowU.uGlow.value = glow.value * k;
    crtU.uObsTime.value = atmo.uTime.value;
    crtU.uObsK.value = k;
    crtU.uScope.value = scope;
    U.uCamR.value.copy(_c.copy(camera.position)).applyMatrix4(roomInv);
  });

  // Only drawn near it (and only while it can be seen, above).
  ctx.lod?.add(room, { out: [30, 45], fade: false, name: 'bunker-room' });

  // Collision, and the room's hum, once the world is built (as the lounge's: they go last, so nothing registered before
  // them moves).
  const finish = () => {
    const y = room.matrixWorld.elements[13];
    for (const [name, n] of Object.entries(nodes)) {
      if (!/^OBB_\d+$/.test(name)) continue;
      const u = n.userData, c = toWorld(n.position);
      ctx.physics.addOBB({ x: c.x, z: c.z, hx: u.hx, hz: u.hz, ry: F.ry + (u.ry ?? 0), y0: y + u.y0, y1: y + u.y1, zone: 'surface' });
    }
    // The CRT's whine, hum and fan at the terminal; the air in the duct over the room. Heard only from down here.
    const emitters = [];
    const tp = E('TERMINAL'), sp = E('SOUND');
    if (tp || sp) emitters.push(ctx.audio?.registerEmitter?.('terminal', toWorld((tp ?? sp).clone().add(new THREE.Vector3(0.15, -0.05, 0))), 'surface'));
    emitters.push(ctx.audio?.registerEmitter?.('hvac', toWorld(new THREE.Vector3(0, 2.55, 1.9)), 'surface'));
    const live = emitters.filter((e) => e && typeof e === 'object');
    if (live.length) {
      ctx.updaters.push(() => {
        const off = !ctx.camera || !near(ctx.camera.position);
        for (const e of live) e.off = off;
      });
    }
  };

  const spawnN = standN ?? eyeN;
  return {
    group: room, view, meshes, materials: M, uniforms: U, terminal, seat, center, cctv: cam,
    callPos: ex('CALL').callPos ?? null,
    // Where ?spawn=bunker stands you: beside the chair, facing the terminal.
    spawn: spawnN ? { pos: toWorld(spawnN.position).setY(room.matrixWorld.elements[13]), yaw: F.ry + (ex('SEAT_STAND').yaw ?? -Math.PI / 2) } : null,
    scope: () => scope,
    tune: { floorK, floorK2, crt: crtU, glow },
    finish,
  };
}

// Gives each indicator lamp (a connected piece of the led mesh) its own id, so it blinks as one.
function ledIds(geo) {
  const n = geo.attributes.position.count, parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const idx = geo.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { join(idx.getX(i), idx.getX(i + 1)); join(idx.getX(i), idx.getX(i + 2)); }
  else for (let i = 0; i < n; i += 3) { join(i, i + 1); join(i, i + 2); }
  // (pieces whose vertices aren't shared but sit on top of each other: joined by position too)
  const P = geo.attributes.position, seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(P.getX(i) * 400)},${Math.round(P.getY(i) * 400)},${Math.round(P.getZ(i) * 400)}`;
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i); else join(i, j);
  }
  const id = new Float32Array(n), ids = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size + 1); id[i] = ids.get(r); }
  geo.setAttribute('aLed', new THREE.BufferAttribute(id, 1));
}

// CAM 07: the cctv layer's housing (lens at its origin looking +z, its bracket behind) at stack.hiddenCam, lit by the
// day like anything outdoors, its little red LED blinking. Returns { group, update(dt, k) } or null.
function placeCctv(ctx, asset, groups) {
  const hc = ctx.stacks?.rocks?.hiddenCam;
  const body = groups['cctv@cctv'], led = groups['glow@cctv'];
  if (!hc || !body) return null;
  const group = new THREE.Group();
  group.name = 'cam07';
  const m = new THREE.Matrix4().lookAt(hc.look, hc.pos, new THREE.Vector3(0, 1, 0));
  group.quaternion.setFromRotationMatrix(m);
  group.position.copy(hc.pos);
  // (the model's vertex colours are its paint, weathered grey, the lens black)
  const metal = patchMaterial(new THREE.MeshStandardMaterial({ name: 'cam07', vertexColors: true, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.8 }));
  const housing = new THREE.Mesh(mergeGeometries(body, false), metal);
  housing.name = 'cam07';
  housing.castShadow = true;
  housing.receiveShadow = true;
  group.add(housing);
  let ledMat = null;
  if (led) {
    ledMat = new THREE.MeshBasicMaterial({ name: 'cam07_led', color: new THREE.Color(0, 0, 0) });
    const l = new THREE.Mesh(mergeGeometries(led, false), ledMat);
    l.name = 'cam07_led';
    group.add(l);
  }
  ctx.surface.add(group);
  group.updateMatrixWorld(true);
  ctx.lod?.add(group, { out: [70, 90], fade: false, name: 'cam07' });
  let t = 0;
  return {
    group,
    update(dt, k) {
      t += dt;
      if (!ledMat || !group.visible) return;
      const on = t % 1.6 < 0.12;   // a short wink every 1.6 s: recording
      ledMat.color.setRGB(on ? 3.2 * k : 0.05 * k, on ? 0.12 * k : 0.004 * k, on ? 0.08 * k : 0.003 * k);
    },
  };
}
