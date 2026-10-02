import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { Textures } from './textures.js';
import { CLOUD_DECK_Y } from '../config.js';

// Aerial-perspective fog: color follows the sky gradient by view azimuth and thickens toward the cloud deck.
const FOG_PARS_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizonAway;
uniform vec3 uHorizonSun;
uniform vec3 uSunGlow;
uniform float uUnderground;
uniform float uFogDensity;
uniform vec3 uCloudColor;
uniform float uTime;
uniform float uFogLow;
uniform vec3 uFogTint;
uniform vec4 uIntA;
uniform vec4 uIntB;
uniform vec4 uObsA;
uniform vec4 uObsB;
uniform vec4 uBunA, uBunB, uBunC, uBunD;
uniform vec4 uMineA, uMineB;
// 1 inside the Tower bunker's hood, stairwell and room (world/bunker.js), 0 outside: its frame at (uBunA.z, uBunB.x,
// uBunA.w) turned so local +x is (cos, -sin) of uBunA.xy; uBunB = (y, landing ceiling, slope start z, slope);
// uBunC = (stairwell half width, room start z, room half width, room ceiling); uBunD = (far end z, on).
float bunkerMask(vec3 p) {
  if (uBunD.y < 0.5) return 0.0;
  vec2 d = p.xz - uBunA.zw;
  float lx = d.x * uBunA.x - d.y * uBunA.y, lz = d.x * uBunA.y + d.y * uBunA.x, ly = p.y - uBunB.x;
  float room = step(uBunC.y, lz);
  float hw = mix(uBunC.x, uBunC.z, room) + 0.06;
  float ceil = mix(uBunB.y - max(0.0, lz - uBunB.z) * uBunB.w, uBunC.w, room) + 0.05;
  return step(abs(lx), hw) * step(0.12, lz) * step(lz, uBunD.x) * step(ly, ceil);
}
// How deep down the bunker p is: 0 by its door, rising to 1 between frame z = uBunD.z and uBunD.w (down the stair), where
// no daylight reaches even through the open door (0 everywhere while uBunD.w <= uBunD.z).
float bunkerDeep(vec3 p) {
  if (uBunD.w <= uBunD.z) return 0.0;
  vec2 d = p.xz - uBunA.zw;
  return bunkerMask(p) * smoothstep(uBunD.z, uBunD.w, d.x * uBunA.y + d.y * uBunA.x);
}
// The mine adit's drive: uMineA = (cos, sin of its yaw, portal x, z), local +z out of the portal; uMineB = (floor y,
// crown above it, depth, on). Fades in over the first metres behind the portal, where the daylight still reaches.
float mineMask(vec3 p) {
  if (uMineB.w < 0.5) return 0.0;
  vec2 d = p.xz - uMineA.zw;
  float lx = d.x * uMineA.x - d.y * uMineA.y, lz = d.x * uMineA.y + d.y * uMineA.x, ly = p.y - uMineB.x;
  return step(abs(lx), 1.75) * smoothstep(0.3, -1.6, lz) * step(-uMineB.z, lz) * step(-0.4, ly) * step(ly, uMineB.y);
}
// 1 inside an interior (under the cabin's roof, inside the observatory's drum and dome, in the bunker, down the mine
// adit), 0 outside.
float interiorMask(vec3 p) {
  float m = 0.0;
  if (uIntA.z > uIntA.x) {
    float hd = (uIntA.w - uIntA.y) * 0.5;
    float roofY = mix(uIntB.z, uIntB.y, clamp(abs(p.z - uIntB.w) / hd, 0.0, 1.0)) + 0.03;
    m = smoothstep(uIntA.x, uIntA.x + 0.12, p.x) * smoothstep(uIntA.z, uIntA.z - 0.12, p.x)
      * smoothstep(uIntA.y, uIntA.y + 0.12, p.z) * smoothstep(uIntA.w, uIntA.w - 0.12, p.z)
      * step(uIntB.x - 0.3, p.y) * smoothstep(roofY, roofY - 0.04, p.y);
  }
  // Observatory: uObsA = (centre x, centre z, drum inner radius, floor y), uObsB = (wall top, dome centre y, dome radius, on).
  if (uObsB.w > 0.5) {
    float r = length(p.xz - uObsA.xy);
    float drum = smoothstep(uObsA.z + 0.12, uObsA.z + 0.05, r) * step(uObsA.w - 0.3, p.y) * step(p.y, uObsB.x + 0.1);
    float dome = smoothstep(uObsB.z - 0.035, uObsB.z - 0.045, distance(p, vec3(uObsA.x, uObsB.y, uObsA.y))) * step(uObsB.x - 0.2, p.y);
    m = max(m, max(drum, dome));
  }
  return max(max(m, bunkerMask(p)), mineMask(p));
}
varying vec3 vFogWorld;
float dbHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dbHash(i), dbHash(i + vec2(1, 0)), u.x), mix(dbHash(i + vec2(0, 1)), dbHash(i + vec2(1, 1)), u.x), u.y);
}
`;

const FOG_FRAG = /* glsl */ `
{
  vec3 fv = vFogWorld - cameraPosition;
  float fd = length(fv);
  vec3 fdir = fv / max(fd, 1e-4);
  float low = smoothstep(-30.0, -300.0, vFogWorld.y);
  float dens = uFogDensity * (1.0 + uFogLow * low);
  float ff = 1.0 - exp(-pow(dens * fd, 1.35));
  vec3 fcol;
  if (uUnderground > 0.5) {
    fcol = vec3(0.0);
  } else {
    vec2 d2 = normalize(fdir.xz + 1e-5);
    vec2 s2 = normalize(uSunDir.xz + 1e-5);
    float toward = pow(dot(d2, s2) * 0.5 + 0.5, 3.0);
    fcol = mix(uHorizonAway, uHorizonSun, toward) * 0.8 + uZenith * 0.12;
    fcol += uSunGlow * pow(max(dot(fdir, uSunDir), 0.0), 10.0) * 0.18;
    fcol *= uFogTint;
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, clamp(ff, 0.0, 1.0));
  // Cliffs dissolve into the cloud sea as they descend toward it.
  if (uUnderground < 0.5 && vFogWorld.y < ${(CLOUD_DECK_Y + 300).toFixed(1)}) {
    // Billowy, drifting boundary rather than a flat gradient.
    vec2 q = vec2(vFogWorld.x + vFogWorld.z * 0.6, vFogWorld.y * 1.4 + vFogWorld.z * 0.3) * 0.018 + vec2(uTime * 0.03, -uTime * 0.012);
    float n = dbNoise(q) * 0.6 + dbNoise(q * 2.3 + 7.1) * 0.3 + dbNoise(q * 5.1 - 3.0) * 0.1;
    float y = vFogWorld.y + (n - 0.5) * 140.0;
    float deck = smoothstep(${(CLOUD_DECK_Y + 250).toFixed(1)}, ${(CLOUD_DECK_Y + 90).toFixed(1)}, y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uCloudColor, deck);
  }
}
`;

const FOG_VERT = /* glsl */ `
{
  vec4 fogWP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorld = (modelMatrix * fogWP).xyz;
}
`;

const WIND_VERT = /* glsl */ `
{
  vec3 iPos = vec3(0.0);
  mat3 iRot = mat3(1.0);
  #ifdef USE_INSTANCING
  iPos = instanceMatrix[3].xyz;
  iRot = mat3(instanceMatrix);
  #endif
  vec3 wb = (modelMatrix * vec4(iPos, 1.0)).xyz;
  float t = uTime;
  float ph = fract(sin(dot(wb.xz, vec2(12.9898, 78.233))) * 43758.5453);
  // Layered, non-harmonic gusts traveling across the world: mostly calm with irregular pushes.
  float g = sin(t * 0.31 + wb.x * 0.011 + wb.z * 0.007) * 0.5
          + sin(t * 0.53 - wb.z * 0.015 + 1.7) * 0.3
          + sin(t * 0.97 + wb.x * 0.021 + ph * 6.28) * 0.2;
  g = g * 0.5 + 0.5;
  g = g * g * g;
  vec2 w = uWind * (0.15 + g * 0.85);
  vec2 jitter = vec2(sin(t * (1.1 + ph * 0.6) + ph * 20.0), cos(t * (0.9 + ph * 0.5) + ph * 13.0)) * (0.18 + g * 0.35);
  vec2 push = w + jitter * 0.35;
  float hgt = max(position.y, 0.0);
  float bend = hgt * hgt * uSwayAmount;
  vec3 worldPush = vec3(push.x, 0.0, push.y) * bend;
  float s2 = max(dot(iRot[0], iRot[0]), 1e-4);
  vec3 localPush = (transpose(iRot) * worldPush) / s2;
  transformed += localPush;
  transformed.y -= dot(push, push) * bend * 0.08;
  #ifdef FLUTTER
  float fl = sin(t * (5.0 + ph * 3.0) + dot(position, vec3(3.1, 2.3, 4.7))) * (0.3 + g);
  transformed += normal * fl * uFlutter * hgt;
  #endif
}
`;

// indoorEnv: the material reflects the cabin's interior probe, so its reflections are not cut indoors.
export function patchMaterial(mat, { wind = null, fadeDist = 0, indoorEnv = false } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, {
      uSunDir: atmo.uSunDir, uZenith: atmo.uZenith, uHorizonAway: atmo.uHorizonAway,
      uHorizonSun: atmo.uHorizonSun, uSunGlow: atmo.uSunGlow, uUnderground: atmo.uUnderground,
      uFogDensity: atmo.uFogDensity, uTime: atmo.uTime, uWind: atmo.uWind, uCloudColor: atmo.uCloudColor,
      uFogLow: atmo.uFogLow, uFogTint: atmo.uFogTint, uIntA: atmo.uIntA, uIntB: atmo.uIntB, uObsA: atmo.uObsA, uObsB: atmo.uObsB,
      uBunA: atmo.uBunA, uBunB: atmo.uBunB, uBunC: atmo.uBunC, uBunD: atmo.uBunD, uMineA: atmo.uMineA, uMineB: atmo.uMineB,
    });
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uSwayAmount;\nuniform float uFlutter;');
    // (uTime is also declared for the fragment shader in FOG_PARS_FRAG.)
    if (wind) {
      shader.uniforms.uSwayAmount = { value: wind.sway };
      shader.uniforms.uFlutter = { value: wind.flutter || 0 };
      if (wind.flutter) vs = '#define FLUTTER\n' + vs;
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERT);
    }
    vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n' + FOG_VERT);
    shader.vertexShader = vs;
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FOG_PARS_FRAG)
      .replace('#include <fog_fragment>', FOG_FRAG)
      // Indoors, the open sky only reaches in through the windows: cut ambient/IBL light.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float im = interiorMask(vFogWorld), bd = 1.0 - 0.94 * bunkerDeep(vFogWorld);
          reflectedLight.indirectDiffuse *= mix(1.0, 0.22, im) * bd;
          reflectedLight.indirectSpecular *= mix(1.0, ${indoorEnv ? '1.0' : '0.3'}, im) * bd; }`);
    if (fadeDist) {
      fs = fs.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        { float gd = distance(vFogWorld, cameraPosition);
          float gn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (gd > ${fadeDist.toFixed(1)} - gn * 14.0) discard; }`);
    }
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'db:' + (wind ? `w${wind.flutter ? 'f' : ''}` : 'n') + (fadeDist ? 'g' + fadeDist : '') + (indoorEnv ? 'i' : '');
  return mat;
}

const std = (o, patch) => patchMaterial(new THREE.MeshStandardMaterial(o), patch);

let M = null;
export function materials() {
  if (M) return M;
  const rock = Textures.rock(), ground = Textures.ground(), bark = Textures.bark(), wood = Textures.wood();
  const metal = Textures.metal(), pavers = Textures.pavers();
  M = {
    cap: std({ vertexColors: true, map: ground.map, normalMap: ground.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.96, envMapIntensity: 0.6 }),
    // The tor, the rock piles and the cave hoods (each stack's walls have their own material, render/wallMaterial.js).
    // Shadows from both sides: three.js casts from the back faces by default, so a rock's shaded side, which meets
    // the ground, set the shadow's depth, and the ground within the sun's depth bias (about 16 cm) of it counted as
    // lit, a bright rim round every rock's foot. Both sides keep the nearest (the sunny side) for the solid rocks, and
    // the hoods, open shells, still cast from whichever side faces the sun.
    cliff: std({ vertexColors: true, map: rock.map, normalMap: rock.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, envMapIntensity: 0.6, shadowSide: THREE.DoubleSide }),
    stone: std({ vertexColors: true, map: rock.map, normalMap: rock.normal, roughness: 0.9, color: 0xd8d2c8 }),
    // The Dome's ledge path (world/cliffPath.js): laid flagstones, with a sheen at grazing light.
    path: (() => {
      const f = Textures.flagstone();
      return std({ map: f.map, normalMap: f.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: f.rough, roughness: 1, metalness: 0, envMapIntensity: 0.55, name: 'path' });
    })(),
    bark: std({ vertexColors: true, map: bark.map, normalMap: bark.normal, roughness: 0.95 }, { wind: { sway: 0.0009 } }),
    wood: std({ vertexColors: true, map: wood.map, normalMap: wood.normal, roughness: 0.85, color: 0xcfc0a8 }),
    metal: std({ vertexColors: true, map: metal.map, roughnessMap: metal.rough, roughness: 1.0, metalness: 0.75, color: 0xb8b8b8 }),
    darkMetal: std({ vertexColors: true, map: metal.map, roughness: 0.6, metalness: 0.8, color: 0x5a5a5e }),
    brass: std({ vertexColors: true, roughness: 0.35, metalness: 1.0, color: 0xc9a060 }),
    pavers: std({ vertexColors: true, map: pavers.map, normalMap: pavers.normal, roughness: 0.9 }),
    glass: patchMaterial(new THREE.MeshPhysicalMaterial({ color: 0xcfe6f0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false, specularIntensity: 1 })),
    plaster: std({ vertexColors: true, roughness: 0.9, color: 0xd9d2c4 }),
    rope: std({ vertexColors: true, roughness: 1.0, color: 0x9a8565 }),
    // Board-formed concrete (the Tower's bunker): UVs in metres / 2, the boards' rows along u.
    concrete: (() => {
      const c = Textures.concrete();
      return std({ vertexColors: true, map: c.map, normalMap: c.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.93, envMapIntensity: 0.45 });
    })(),
  };
  return M;
}

export function foliageMaterial(map, sway, flutter, tint = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: tint, envMapIntensity: 0.5 });
  patchMaterial(m, { wind: { sway, flutter } });
  return m;
}
