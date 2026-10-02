import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FAR_BAND, farMaterial, bakeFar } from '../render/lod.js';
import { materials, patchMaterial } from '../render/materials.js';
import { atmo, atmoState } from '../render/atmosphere.js';
import { Textures } from '../render/textures.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL, SCENE_FOG_GLSL } from '../render/glsl.js';
import { Rng, clamp, smoothstep } from '../core/rng.js';

// The Rocks tor blown apart by rocks.exe (the bunker terminal; the cutscene is sequences/rocksExe.js). Creates
// ctx.torBlast = {
//   exploded()      the tor is down (ctx.state.tor.exploded)
//   detonate(opt)   the blast, now: five fireballs at the charges (staggered over 0.15 s, far over the bloom), a flash
//                   through a light-pool site, the intact tor swapped for its stump and the upper tiers flung off as
//                   debris (tor_blast.glb's clip), sparks and gravel, a dust and smoke column that billows up and drifts
//                   off on the wind over a minute, a low dust surge round the tor's foot, the tor's waterfall
//                   draining off its face and stopping (and its sound), the explosion's sound (opt.sound: false to
//                   leave it to the caller) and state.tor.exploded. Returns false if it already went.
//   applyExploded() the settled end at once (a restored game): stump, debris at rest, no smoke, the water off.
//   update(dt)      (in ctx.updaters)
//   landDust(i, pos, r)  a puff of dust where boulder i hits the ground (world/rockThrow.js)
//   center, charges, launch   world points: the blast's heart, the five charges, where each boulder leaves the tor
//   debrisRest      [{ x, z, r }]: where each piece of debris comes to rest (world; the landing picker keeps off them)
//   timeline        seconds after detonate(): { charges, flash, fireball, debris, settled, drained, fxGone, smokeGone }
// }
// Everything is built here, hidden, so the preloader compiles and uploads it all before the player wakes: nothing is
// made at run time. Without tor_blast.glb (or with the procedural tor) the tor itself stays whole; the rest still runs.

const G = 9.8;
// When each charge goes (s after detonate()), and the flash's light.
const CHARGE_T = [0, 0.035, 0.07, 0.11, 0.15];
const FLASH_I = 1100;          // candela at the peak (x exposure compensation): lights the island for a few frames
const SMOKE_END = 80;          // everything is gone by then

// ---------------------------------------------------------------------------------------------------------------
// Particle shaders (drawn after the sky's cloud layer, renderOrder 5). Every effect is one instanced quad draw whose motion is closed-form in the vertex shader from uT
// (seconds since the blast), so the CPU only sets uniforms. Output is premultiplied over, like the waterfalls': hot
// things add light with no alpha, smoke and dust cover.
const VCOMMON = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform vec3 uSunLight;
uniform vec3 uAmbient;
uniform float uPxH;
uniform float uT;
uniform float uK;          // exposure compensation for self-lit things
uniform float uFire;       // the fireballs' glow on the smoke (0..1)
uniform vec3 uCenter;
uniform vec2 uDrift;       // wind drift since the blast (m)
${NOISE_GLSL}
${SKY_FUNC_GLSL}
${SCENE_FOG_GLSL}
vec3 camRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 camUp() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
vec3 camFwd() { return -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }
float pxPerM(vec3 P) {
  float z = max(dot(P - cameraPosition, camFwd()), 0.05);
  return 0.5 * max(uPxH, 1.0) * projectionMatrix[1][1] / z;
}
vec4 cull() { return vec4(0.0, 0.0, 2.0, 1.0); }
// A camera-facing quad of radius R at P, turned by rot.
vec4 billboard(vec3 P, float R, float rot, out vec3 W) {
  float cr = cos(rot), sr = sin(rot);
  vec2 q = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * 2.0 * R;
  W = P + camRight() * q.x + camUp() * q.y;
  return projectionMatrix * viewMatrix * vec4(W, 1.0);
}
`;

// Fireballs (kind 0) at the charges, and the flash's core (kind 1) at the heart.
//   aA: charge, delay, size (m), life (s)   aB: direction, speed   aC: seed, kind, turn, how long it burns (s)
const FIRE_VERT = /* glsl */ `
${VCOMMON}
uniform vec4 uCharges[5];   // world xyz, when (s)
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying float vKind;
varying vec3 vSmoke;
varying float vTrans;
void main() {
  vec4 ch = uCharges[int(aA.x + 0.5)];
  float age = uT - ch.w - aA.y, life = aA.w;
  if (uT < 0.0 || age <= 0.0 || age >= life) { gl_Position = cull(); return; }
  vec3 out0 = normalize(ch.xyz - uCenter + vec3(0.0, 0.6, 0.0));
  vec3 P;
  float R, heat, a;
  if (aC.y < 0.5) {
    // Blown out of the charge's hole, slowing in the air, then rolling upward as it burns out and turns to soot.
    float k = 4.5;
    P = ch.xyz + out0 * 0.7 + aB.xyz * aB.w * (1.0 - exp(-k * age)) / k + vec3(0.0, 1.0, 0.0) * (2.6 * age * age / (1.0 + 0.6 * age));
    P.xz += uDrift * 0.4 * smoothstep(0.5, 4.0, age);
    R = aA.z * (0.3 + 0.7 * (1.0 - exp(-age * 10.0))) * (1.0 + 0.4 * age);
    heat = exp(-age / aC.w);
    a = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.55 * life, life, age));
  } else {
    P = uCenter + out0 * 1.5;
    R = aA.z * (0.4 + 0.6 * (1.0 - exp(-age * 60.0)));
    heat = 1.0;
    a = exp(-age / 0.045) * smoothstep(0.0, 0.01, age);
  }
  vec3 W;
  gl_Position = billboard(P, R, aC.z + (aC.x - 0.5) * 1.6 * age, W);
  vUv = uv;
  vHeat = heat;
  vAlpha = a;
  vSeed = aC.x;
  vAge = age;
  vKind = aC.y;
  // The soot it turns into, in the sky's and the sun's light, and the fire's own early on.
  vec3 V = normalize(W - cameraPosition);
  float sunV = 0.6 + 0.4 * clamp(uSunDir.y * 3.0, 0.0, 1.0);
  vec3 light = uAmbient * 2.0 + uSunLight * 0.45 * sunV + horizonColor(V) * 0.1 + vec3(1.0, 0.38, 0.08) * uFire * uK * 2.5;
  float deck;
  vec3 f0 = sceneFog(vec3(0.0), W, deck);
  vTrans = sceneFog(vec3(1.0), W, deck).g - f0.g;
  vSmoke = vec3(0.06, 0.055, 0.05) * light * vTrans + f0;
  vAlpha *= 1.0 - deck;
}
`;
const FIRE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uK;
uniform float uGain;
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying float vKind;
varying vec3 vSmoke;
varying float vTrans;
${NOISE_GLSL}
// Blackbody-ish: dull red through orange and yellow to a white core.
vec3 ramp(float h) {
  vec3 c = mix(vec3(0.25, 0.03, 0.006), vec3(0.95, 0.22, 0.03), smoothstep(0.05, 0.3, h));
  c = mix(c, vec3(1.0, 0.52, 0.12), smoothstep(0.3, 0.6, h));
  return mix(c, vec3(1.0, 0.88, 0.62), smoothstep(0.6, 1.0, h));
}
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d = length(c);
  if (vKind > 0.5) {
    float g = exp(-d * d * 5.0) * 0.6 + exp(-d * d * 30.0);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * g * vAlpha * vTrans * uK * uGain * 3.0, 0.0);
    return;
  }
  // Turbulent billows: warped noise rolling outward, a crisp edge.
  float base = texture2D(uMap, vUv).a;
  vec2 w = c * 1.5 + vSeed * 17.0;
  float n1 = fbm(w + vec2(0.0, -vAge * 1.1));
  float n2 = fbm(w * 2.1 + vec2(n1 * 1.7, -n1 * 1.3) - vec2(vAge * 0.6, 0.0));
  float dens = base * (0.35 + 1.25 * n2);
  float shape = smoothstep(0.2, 0.52, dens);
  if (shape < 0.003) discard;
  // Hottest deep inside, licking out through the denser noise; burning out from the edges in.
  float h = clamp(vHeat * 1.5 * smoothstep(0.3, 0.95, dens) * (1.1 - 0.45 * d), 0.0, 1.2);
  float soot = 1.0 - smoothstep(0.02, 0.35, vHeat * (0.6 + 0.8 * n1));
  float a = shape * vAlpha;
  float cover = a * mix(0.45, 0.96, soot);
  vec3 emis = ramp(h) * (0.25 + 7.0 * h * h) * smoothstep(0.0, 0.08, h) * uK * uGain * vTrans;
  vec3 smoke = vSmoke * (0.6 + 0.8 * n1);
  gl_FragColor = vec4(emis * a + smoke * cover, cover);
}
`;

// Sparks (kind 0: hot, additive streaks) and gravel (kind 1: little dark stones), ballistic with drag, drawn as
// streaks between where they are and where they were a moment ago. They stop where they come down (worked out on the
// CPU when built).
//   aP: start, delay   aV: velocity, kind   aL: where it comes down, when   aS: size (m), life, seed, drag
const STREAK_VERT = /* glsl */ `
${VCOMMON}
attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aL;
attribute vec4 aS;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vKind;
vec3 at(float t) {
  float k = aS.w;
  vec3 vInf = vec3(0.0, -${G.toFixed(2)} / k, 0.0);
  if (t >= aL.w) return aL.xyz;
  return aP.xyz + vInf * t + (aV.xyz - vInf) * (1.0 - exp(-k * t)) / k;
}
void main() {
  float age = uT - aP.w, life = aS.y;
  float kind = aV.w;
  if (uT < 0.0 || age <= 0.0 || age >= life || (kind < 0.5 && age > aL.w + 0.04)) { gl_Position = cull(); return; }
  vec3 P = at(age), Q = at(max(age - (kind < 0.5 ? 0.07 : 0.03), 0.0));
  vec4 h = projectionMatrix * viewMatrix * vec4(P, 1.0), t = projectionMatrix * viewMatrix * vec4(Q, 1.0);
  if (h.w < 0.1 || t.w < 0.1) { gl_Position = cull(); return; }
  vec2 res = vec2(max(uPxH, 1.0) * projectionMatrix[1][1] / projectionMatrix[0][0], max(uPxH, 1.0));
  vec2 hs = h.xy / h.w, ts = t.xy / t.w;
  vec2 dpx = (hs - ts) * 0.5 * res;
  float len = length(dpx);
  vec2 dir = len > 1e-3 ? dpx / len : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  float wpx = aS.x * pxPerM(P);
  float thin = clamp(wpx / 1.5, 0.0, 1.0);
  wpx = max(wpx, 1.5);
  vec4 base = mix(t, h, position.y + 0.5);
  vec2 off = nrm * position.x * wpx + dir * position.y * wpx;
  base.xy += off / (0.5 * res) * base.w;
  gl_Position = base;
  vUv = uv;
  vKind = kind;
  float u = age / life;
  if (kind < 0.5) {
    float temp = exp(-age / (0.3 * life));
    vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.7, 0.3), smoothstep(0.2, 0.6, temp));
    c = mix(c, vec3(1.0, 0.95, 0.85), smoothstep(0.6, 1.0, temp));
    vCol = c * (1.5 + 10.0 * temp) * uK;
    vAlpha = thin * (1.0 - smoothstep(0.6, 1.0, u));
  } else {
    vec3 V = normalize(P - cameraPosition);
    vec3 light = uAmbient * 2.0 + uSunLight * 0.3 + vec3(1.0, 0.4, 0.1) * uFire * uK * 2.0;
    float deck;
    vCol = sceneFog(vec3(0.12, 0.11, 0.1) * (0.7 + 0.6 * aS.z) * light, P, deck);
    // Stones that have come down sink into the grass.
    vAlpha = thin * (1.0 - deck) * (1.0 - smoothstep(aL.w + 2.0, aL.w + 5.0, age));
  }
}
`;
const STREAK_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float a = (1.0 - smoothstep(0.35, 1.0, abs(c.x))) * (1.0 - smoothstep(0.6, 1.0, abs(c.y))) * vAlpha;
  if (a < 0.004) discard;
  if (vKind < 0.5) gl_FragColor = vec4(vCol * a, 0.0);
  else gl_FragColor = vec4(vCol * a, a);
}
`;

// Dust and smoke: the column (kind 0) and the smoke still curling off the stump after it (kind 4), the surge rolling out
// over the ground (1), the puffs where the boulders land (2: at uLand[site]) and where the debris comes down (3).
//   aA: start, delay   aB: velocity, kind   aC: size, growth, life, seed   aD: rise, rise time, site, drag
const DUST_VERT = /* glsl */ `
${VCOMMON}
uniform vec4 uLand[5];     // world xyz, when (uT); w < 0: not yet
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aD;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vSun;
varying vec3 vGlow;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying vec3 vGlowDir;
varying vec3 vFogMul;
varying vec3 vFogAdd;
varying float vSoft;
void main() {
  float kind = aB.w;
  vec3 p0 = aA.xyz;
  float t0 = aA.w;
  if (kind > 1.5 && kind < 2.5) {
    vec4 L = uLand[int(aD.z + 0.5)];
    if (L.w < 0.0) { gl_Position = cull(); return; }
    p0 += L.xyz;
    t0 += L.w;
  }
  float age = uT - t0, life = aC.z;
  if (uT < 0.0 || age <= 0.0 || age >= life) { gl_Position = cull(); return; }
  float k = aD.w;
  vec3 P = p0 + aB.xyz * (1.0 - exp(-k * age)) / k + vec3(0.0, aD.x * (1.0 - exp(-age / aD.y)), 0.0);
  // Drifting off on the wind, the higher the more; a slow churn.
  float hgt = max(P.y - uCenter.y + 9.0, 0.0);
  P.xz += uDrift * clamp(hgt / 28.0, 0.12, 1.0) * (kind > 1.5 && kind < 3.5 ? 0.0 : 1.0);
  float R = aC.x + aC.y * (1.0 - exp(-age / 4.0)) + 0.04 * age;
  P += vec3(sin(age * 0.37 + aC.w * 21.0), 0.0, cos(age * 0.31 + aC.w * 13.0)) * R * 0.18 * min(age / 5.0, 1.0);
  // Fade in fast, out slowly; a little thinner as it spreads.
  float fin = kind > 1.5 && kind < 3.5 ? 0.06 : (kind > 3.5 ? 1.5 : 0.25);
  float a = smoothstep(0.0, fin, age) * (1.0 - smoothstep(0.35 * life, life, age)) * (kind < 0.5 ? exp(-age / 30.0) : 1.0);
  a *= kind < 0.5 ? 0.8 : kind < 1.5 ? 0.45 : kind < 2.5 ? 1.0 : kind < 3.5 ? 0.38 : 0.35;
  // Thinner as it spreads, and higher up.
  a /= 1.0 + 0.05 * R + 0.012 * hgt;
  // Screen-filling puffs fade (fill rate, and they show their planes).
  float ppm = pxPerM(P);
  a *= 1.0 - smoothstep(0.55, 1.2, R * ppm / max(uPxH, 1.0));
  vec3 W;
  gl_Position = billboard(P, R, aC.w * 6.28 + age * (aC.w - 0.5) * 0.12, W);
  // Soot from the fire early in the column, granite dust everywhere else.
  float sooty = kind < 0.5 ? (1.0 - smoothstep(2.0, 14.0, age)) * smoothstep(0.3, 0.8, aC.w) : (kind > 3.5 ? 0.7 : 0.0);
  vec3 alb = mix(vec3(0.3, 0.27, 0.235), vec3(0.075, 0.07, 0.065), sooty);
  if (kind > 0.5 && kind < 1.5) alb = vec3(0.25, 0.22, 0.185);
  if (kind > 1.5 && kind < 3.5) alb = kind < 2.5 ? vec3(0.26, 0.23, 0.19) : vec3(0.2, 0.17, 0.135);
  vec3 V = normalize(W - cameraPosition);
  float deck;
  vec3 sky = mix(horizonColor(V), uZenith, 0.4) * 0.18 + uAmbient * 1.25;
  vFogAdd = sceneFog(vec3(0.0), W, deck);
  vFogMul = sceneFog(vec3(1.0), W, deck) - vFogAdd;
  vCol = alb * (sky + vec3(0.32, 0.4, 0.62) * uNight * clamp(uMoonDir.y * 3.0, 0.0, 1.0) * 0.22);
  vSun = alb * uSunLight * 0.7;
  // The fire's light on the underside of the cloud, early on.
  vec3 toC = uCenter - P;
  float dc = length(toC);
  vGlow = alb * vec3(1.0, 0.42, 0.12) * uFire * uK * 9.0 / (1.0 + dc * dc / 40.0);
  vGlowDir = toC / max(dc, 1e-3);
  vAlpha = a * (1.0 - deck);
  // (Landing puffs a crisp edge, so they read as a burst on the feed; the debris's softer.)
  vSoft = kind > 1.5 && kind < 2.5 ? 0.3 : kind > 2.5 && kind < 3.5 ? 1.0 : 0.0;
  vUv = uv;
  vSeed = aC.w;
  vAge = age;
}
`;
const DUST_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vSun;
varying vec3 vGlow;
varying float vAlpha;
varying float vSeed;
varying float vAge;
varying vec3 vGlowDir;
varying vec3 vFogMul;
varying vec3 vFogAdd;
varying float vSoft;
${NOISE_GLSL}
vec3 camRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 camUp() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
vec3 camBack() { return vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float base = texture2D(uMap, vUv).a;
  vec2 w = c * 1.6 + vSeed * 23.0 + vec2(vAge * 0.04, -vAge * 0.07);
  float n0 = fbm3o(w);
  float n = fbm3o(w * 2.2 + vec2(n0 * 1.4, -n0));
  // Cauliflower billows: lumpy noise eaten into the edge.
  float a = smoothstep(mix(0.16, 0.04, vSoft), mix(0.6, 0.85, vSoft), base * (0.35 + 1.2 * n)) * vAlpha;
  if (a < 0.004) discard;
  // A billow: the sprite as the near half of a ball (bumped by the noise), lit by the sun (wrapped), darker underneath.
  vec3 N = normalize(camRight() * (c.x + (n - 0.5) * 0.8) + camUp() * (c.y + (n0 - 0.5) * 0.8) + camBack() * sqrt(max(1.0 - d2, 0.0)) * 0.7);
  float sun = clamp(dot(N, uSunDir) * 0.65 + 0.35, 0.0, 1.0) * (0.7 + 0.6 * n);
  float under = 0.6 + 0.4 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  float glow = clamp(dot(N, vGlowDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = (vCol * under * (0.8 + 0.4 * n) + vSun * sun + vGlow * glow) * vFogMul + vFogAdd;
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------------------------------------------------------
// tor: buildTor's result. batch: the Batcher the tor was drawn into (its own). blast: tor_blast.glb's parts
// (world/rockpiles.js torSculpt), or null. water: { group, spring, cascade, fx: [], emitter } (the tor's own fall, all
// in group; the spring's disc in its own group in it). parent: where the tor's meshes go (the stack's group).
export function createTorBlast(ctx, stack, { tor, batch, blast, water, parent }) {
  const M = materials();
  const fx = tor.frame.x, fz = tor.frame.z;
  const at0 = (v) => new THREE.Vector3(v[0] + fx, v[1], v[2] + fz);
  const state = (ctx.state.tor ||= { exploded: false });

  // ---- The tor: intact, and the stump with its debris. Near meshes cross to vertex-coloured far stand-ins across
  // FAR_BAND (the stack's props are no longer one batch with it, so it has its own).
  const root = new THREE.Group();
  root.name = 'tor';
  parent.add(root);
  const intact = new THREE.Group(), broken = new THREE.Group();
  intact.name = 'tor:intact'; broken.name = 'tor:stump';
  broken.visible = false;
  root.add(intact, broken);
  const near = batch.build(intact, { name: 'tor' });
  const farOf = (geo, group, name) => {
    const src = new THREE.Mesh(geo, M.cliff);
    const g = bakeFar([src], group);
    const m = new THREE.Mesh(g, farMaterial());
    m.name = name;
    m.matrixAutoUpdate = false;
    m.receiveShadow = true;
    group.add(m);
    ctx.lod.add(m, { in: FAR_BAND, name });
    return m;
  };
  for (const m of near) ctx.lod.add(m, { out: FAR_BAND, name: 'tor' });
  const moved = (g) => g.clone().translate(fx, 0, fz);
  if (blast?.far) farOf(moved(blast.far), intact, 'tor:far');
  else farOf(mergeGeometries(near.map((m) => m.geometry), false), intact, 'tor:far');

  const chunkMat = patchMaterial(Object.assign(M.cliff.clone(), { shadowSide: THREE.FrontSide, name: 'tor-debris' }));
  // (Their own shadow-depth material, as the boulders': props/movableRocks.js.)
  const chunkDepth = new THREE.MeshDepthMaterial();
  let stumpTop = tor.frame.yRim, stumpGrid = null, debris = null, flying = null, mixer = null, action = null;
  const proxies = [];
  const chunks = blast?.chunks ?? [];
  // Where the debris comes to rest (world x, z and each chunk's radius, the lost ones left out): the boulders' landing
  // picker keeps clear of it (world/rockThrow.js).
  const debrisRest = [];
  if (blast) {
    const sg = moved(blast.stump);
    const stump = new THREE.Mesh(sg, M.cliff);
    stump.name = 'tor:stump';
    stump.castShadow = stump.receiveShadow = true;
    stump.matrixAutoUpdate = false;
    broken.add(stump);
    ctx.lod.add(stump, { out: FAR_BAND, name: 'tor:stump' });
    if (blast.stumpFar) farOf(moved(blast.stumpFar), broken, 'tor:stump:far');
    sg.computeBoundingBox();
    stumpTop = sg.boundingBox.max.y;
    stumpGrid = heightGrid(sg, 0.75);

    // The debris in flight: one batched draw, each chunk's matrix from the clip (an AnimationMixer on stand-in
    // nodes named as in the GLB). Lost ones (over the west rim) are hidden once they drop below the cap.
    const nv = chunks.reduce((s, c) => s + c.geo.attributes.position.count, 0), ni = chunks.reduce((s, c) => s + c.geo.index.count, 0);
    flying = new THREE.BatchedMesh(chunks.length, nv, ni, chunkMat);
    flying.name = 'tor:chunks';
    flying.castShadow = flying.receiveShadow = true;
    flying.customDepthMaterial = chunkDepth;
    flying.position.set(fx, 0, fz);
    flying.visible = false;
    flying.frustumCulled = false;   // (its bounds are the rest pose's; each chunk is still culled on its own)
    const proxyRoot = new THREE.Group();
    const m4 = new THREE.Matrix4();
    for (const c of chunks) {
      const id = flying.addInstance(flying.addGeometry(c.geo));
      const o = new THREE.Object3D();
      o.name = c.name;
      o.position.copy(c.pos);
      o.updateMatrix();
      flying.setMatrixAt(id, o.matrix);
      proxyRoot.add(o);
      proxies.push(o);
    }
    root.add(flying);
    mixer = new THREE.AnimationMixer(proxyRoot);
    action = mixer.clipAction(blast.clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;

    // The debris at rest (every chunk's last key, the lost ones left out): one static mesh, swapped in as the clip ends.
    const end = chunkEnds(blast.clip, chunks);
    const geos = [];
    chunks.forEach((c, i) => {
      if (c.lost) return;
      debrisRest.push({ x: end[i].pos.x + fx, z: end[i].pos.z + fz, r: c.r });
      m4.compose(end[i].pos, end[i].quat, new THREE.Vector3(1, 1, 1)).premultiply(new THREE.Matrix4().makeTranslation(fx, 0, fz));
      geos.push(c.geo.clone().applyMatrix4(m4));
    });
    debris = new THREE.Mesh(mergeGeometries(geos, false), chunkMat);
    debris.name = 'tor:debris';
    debris.castShadow = debris.receiveShadow = true;
    debris.customDepthMaterial = chunkDepth;
    debris.matrixAutoUpdate = false;
    debris.visible = false;
    broken.add(debris);
    ctx.lod.add(debris, { out: [130, 170], name: 'tor:debris' });
  }

  // ---- World points.
  const info = blast?.info;
  const center = info ? at0(info.center) : tor.top.clone().setY(tor.top.y - 2.5);
  const charges = info ? info.charges.map(at0) : [0, 1, 2, 3, 4].map((k) => center.clone().add(new THREE.Vector3(Math.cos(k * 1.26) * 2.5, (k - 2) * 1.2, Math.sin(k * 1.26) * 2.5)));
  // (Without the blast model the tor stays whole: they leave from its top.)
  const launch = info ? info.launch.map(at0) : [0, 1, 2, 3, 4].map((k) => new THREE.Vector3(fx + Math.cos(k * 1.26 + 0.6) * 3.5, tor.frame.yRim + 1.2, fz + Math.sin(k * 1.26 + 0.6) * 3.5));
  // Ground (or stump) height under a point, for where the gravel and the debris come down.
  const floorAt = (x, z) => {
    const g = stack.heightAt(x, z);
    const s = stumpGrid ? stumpGrid(x, z) : null;
    return g === null ? null : Math.max(g, s ?? -Infinity);
  };

  // ---- The effects, in one group shown only while they run.
  const fxGroup = new THREE.Group();
  fxGroup.name = 'tor:blast';
  fxGroup.visible = false;
  ctx.surface.add(fxGroup);
  const U = {
    uT: { value: -1 }, uK: { value: 1 }, uFire: { value: 0 }, uCenter: { value: center.clone() }, uDrift: { value: new THREE.Vector2() },
    uGain: { value: 1 },   // the fire's brightness (a knob for tuning)
  };
  const rng = new Rng(7177);
  let fire = null, streaks = null, dust = null;
  const sphere = new THREE.Sphere(center.clone(), 140);
  const quads = (name, attrs, n, vert, frag, uniforms, renderOrder) => {
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.deleteAttribute('normal');
    geo.instanceCount = n;
    for (const [k, v] of Object.entries(attrs)) geo.setAttribute(k, new THREE.InstancedBufferAttribute(v, 4));
    geo.boundingSphere = sphere;
    geo.boundingBox = new THREE.Box3().setFromCenterAndSize(sphere.center, new THREE.Vector3().setScalar(sphere.radius * 2));
    const mat = new THREE.ShaderMaterial({
      name, uniforms: { ...atmo, ...U, ...uniforms }, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, forceSinglePass: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.renderOrder = renderOrder;
    m.frustumCulled = false;
    m.castShadow = m.receiveShadow = false;
    fxGroup.add(m);
    return m;
  };

  // Fireballs: 26 puffs a charge, and three flash cores.
  {
    const per = 26, n = per * 5 + 3;
    const A = new Float32Array(n * 4), Bv = new Float32Array(n * 4), C = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const flash = i >= per * 5;
      const k = flash ? 0 : Math.floor(i / per);
      const d = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 1), rng.float(-1, 1)).normalize();
      const out = charges[k].clone().sub(center).setY(0.6).normalize();
      d.lerp(out, 0.35).normalize();
      A.set(flash ? [0, rng.float(0, 0.01), rng.float(7, 11), 0.25] : [k, rng.float(0, 0.07), rng.float(1.1, 2.5), rng.float(2.2, 4.5)], i * 4);
      Bv.set([d.x, d.y, d.z, rng.float(4, 14)], i * 4);
      C.set([rng.next(), flash ? 1 : 0, rng.float(0, 6.28), rng.float(0.12, 0.4)], i * 4);
    }
    fire = quads('tor:fire', { aA: A, aB: Bv, aC: C }, n, FIRE_VERT, FIRE_FRAG, {
      uMap: { value: Textures.puff() }, uCharges: { value: charges.map((c, k) => new THREE.Vector4(c.x, c.y, c.z, CHARGE_T[k])) },
    }, 7.5);
  }

  // Sparks and gravel.
  {
    const nS = 420, nG = 900, n = nS + nG;
    const P = new Float32Array(n * 4), V = new Float32Array(n * 4), L = new Float32Array(n * 4), S = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const spark = i < nS, k = rng.int(0, 4), c = charges[k];
      const out = c.clone().sub(center).setY(0).normalize();
      const d = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.1, 1.2), rng.float(-1, 1)).normalize().lerp(out, 0.3).normalize();
      const sp = spark ? rng.float(9, 34) : rng.float(4, 22) * (0.6 + 0.4 * rng.next());
      const kd = spark ? rng.float(0.5, 1.1) : rng.float(0.08, 0.25);
      const v = d.multiplyScalar(sp);
      const p0 = c.clone().addScaledVector(out, 0.6).add(new THREE.Vector3(rng.float(-0.6, 0.6), rng.float(-0.4, 0.6), rng.float(-0.6, 0.6)));
      const t0 = CHARGE_T[k] + rng.float(0, 0.04);
      // Where it comes down: stepped along its path.
      let tl = 99, lp = p0.clone();
      const vInf = new THREE.Vector3(0, -G / kd, 0);
      for (let t = 0.05; t < 9; t += 0.03) {
        p.copy(p0).addScaledVector(vInf, t).addScaledVector(v.clone().sub(vInf), (1 - Math.exp(-kd * t)) / kd);
        const f = floorAt(p.x, p.z);
        if (f === null) { if (p.y < stack.top - 60) break; continue; }
        if (p.y <= f + 0.02) { tl = t; lp.set(p.x, f + 0.03, p.z); break; }
      }
      P.set([p0.x, p0.y, p0.z, t0], i * 4);
      V.set([v.x, v.y, v.z, spark ? 0 : 1], i * 4);
      L.set([lp.x, lp.y, lp.z, tl], i * 4);
      S.set([spark ? rng.float(0.03, 0.07) : rng.float(0.035, 0.13), spark ? rng.float(0.8, 2.6) : Math.min(tl + 5.5, 12), rng.next(), kd], i * 4);
    }
    streaks = quads('tor:sparks', { aP: P, aV: V, aL: L, aS: S }, n, STREAK_VERT, STREAK_FRAG, {}, 8);
  }

  // Dust and smoke.
  const landU = [0, 1, 2, 3, 4].map(() => new THREE.Vector4(0, 0, 0, -1));
  {
    const list = [];
    const add = (p0, t0, v, kind, size, growth, life, rise, riseT, site, drag) => list.push([p0.x, p0.y, p0.z, t0, v.x, v.y, v.z, kind, size, growth, life, rng.next(), rise, riseT, site, drag]);
    const g0 = tor.frame.g0;
    // The column: out of the blast in all directions at first, then rising and spreading; the biggest highest.
    for (let i = 0; i < 140; i++) {
      const d = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 1), rng.float(-1, 1)).normalize();
      const big = rng.next();
      const p0 = center.clone().add(new THREE.Vector3(rng.float(-3, 3), rng.float(-3.5, 1.5), rng.float(-3, 3)));
      add(p0, rng.float(0.02, 1.4) * rng.next(), d.multiplyScalar(rng.float(3, 10)), 0, rng.float(1.6, 2.8), 2.5 + big * 5,
        rng.float(25, 60), 10 + big * 42 + rng.float(0, 8), rng.float(5, 12), 0, rng.float(1.0, 1.5));
    }
    // Smoke still curling off the broken top for a while.
    for (let i = 0; i < 28; i++) {
      const p0 = center.clone().add(new THREE.Vector3(rng.float(-4, 4), -2.5 - rng.float(0, 2), rng.float(-4, 4)));
      add(p0, 4 + rng.float(0, 26), new THREE.Vector3(rng.float(-0.5, 0.5), 1, rng.float(-0.5, 0.5)), 4, rng.float(0.8, 1.6), rng.float(2, 4),
        rng.float(14, 24), rng.float(10, 22), rng.float(6, 12), 0, 0.6);
    }
    // The surge: a low skirt of dust thrown off the tor's foot as the top comes down on it. It stays close in (a few
    // metres past the foot) and settles in a few seconds, so the boulders landing out on the island read through it
    // on the hidden camera.
    for (let i = 0; i < 84; i++) {
      const a = rng.float(0, Math.PI * 2), r0 = rng.float(4.5, 8);
      const x = tor.frame.x + Math.cos(a) * r0, z = tor.frame.z + Math.sin(a) * r0;
      const gy = stack.heightAt(x, z) ?? g0;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      add(new THREE.Vector3(x, gy + rng.float(0.3, 1.0), z), rng.float(0.2, 0.7), dir.multiplyScalar(rng.float(3, 8)).setY(rng.float(0, 0.6)), 1,
        rng.float(1.3, 2.2), rng.float(1.4, 2.8), rng.float(4, 8), rng.float(0.5, 2.5), rng.float(2, 5), 0, rng.float(1.0, 1.4));
    }
    // The boulders' landings (placed by uLand when they come down): a tight, crisp burst that's gone in a few seconds.
    for (let s = 0; s < 5; s++) {
      for (let i = 0; i < 22; i++) {
        const a = rng.float(0, Math.PI * 2), low = i < 14;
        const v = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(low ? rng.float(2, 5) : rng.float(0.6, 2)).setY(low ? rng.float(0, 0.4) : rng.float(1, 2.6));
        add(new THREE.Vector3(Math.cos(a) * 0.6, rng.float(0.1, 0.35), Math.sin(a) * 0.6), rng.float(0, 0.08), v, 2,
          rng.float(0.5, 0.9), rng.float(0.9, 1.8), rng.float(2, 3.8), rng.float(0.1, 0.8), rng.float(1.5, 3), s, rng.float(2.5, 3.5));
      }
    }
    // Where the debris comes down.
    if (blast) {
      const hits = chunkHits(blast.clip, chunks, fx, fz);
      for (const h of hits) {
        for (let i = 0; i < 3; i++) {
          const a = rng.float(0, Math.PI * 2);
          add(h.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), h.t + rng.float(0, 0.06), new THREE.Vector3(Math.cos(a), rng.float(0.1, 0.7), Math.sin(a)).multiplyScalar(rng.float(1, 2.5)), 3,
            rng.float(0.4, 0.7), rng.float(0.7, 1.5), rng.float(2, 4), rng.float(0.2, 0.8), rng.float(2, 4), 0, 2.5);
        }
      }
    }
    const n = list.length;
    const A = new Float32Array(n * 4), Bv = new Float32Array(n * 4), C = new Float32Array(n * 4), D = new Float32Array(n * 4);
    list.forEach((r, i) => { A.set(r.slice(0, 4), i * 4); Bv.set(r.slice(4, 8), i * 4); C.set(r.slice(8, 12), i * 4); D.set(r.slice(12, 16), i * 4); });
    dust = quads('tor:dust', { aA: A, aB: Bv, aC: C, aD: D }, n, DUST_VERT, DUST_FRAG, { uMap: { value: Textures.puff() }, uLand: { value: landU } }, 7);
  }

  // ---- The flash: a light-pool site at the heart, parked far away (never the nearest) except while it burns.
  let flash = 0;
  const away = new THREE.Vector3(center.x, -1e6, center.z);
  const site = ctx.lightPool?.add({
    center: away.clone(), radius: 60,
    lights: [
      { pos: center.clone().add(new THREE.Vector3(0, 1.5, 0)), color: new THREE.Color(1, 0.72, 0.42), distance: 110, intensity: () => flash * 1.0 },
      { pos: center.clone().add(new THREE.Vector3(0, 7, 0)), color: new THREE.Color(1, 0.55, 0.25), distance: 90, intensity: () => flash * 0.55 },
    ],
  });

  // ---- Water: the tor's spring and fall (rocks.js), stopped from the top.
  const emitter = water?.emitter && typeof water.emitter === 'object' ? water.emitter : null;
  const cascadeU = water?.cascade?.material?.uniforms;
  // The water above the broken top goes with the rock at once; the rest runs off down the face (tau: seconds of fall).
  const tauTotal = water?.cascade?.userData?.tau ?? 1.7;
  const tauCut = blast && water?.cascade ? tauAtHeight(water.cascade.geometry, stumpTop + 0.4) : 0;
  // (Run off a little slower than it would fall, so the eye can follow the last of it down: about 1.3 s.)
  const drainRate = Math.min(1, (tauTotal - tauCut) / 1.3);
  const drainT = (tauTotal - tauCut) / drainRate;
  const waterOff = () => {
    if (water?.group) water.group.visible = false;
    if (cascadeU) cascadeU.uDry.value = 1e4;
    if (emitter) { emitter.off = true; emitter.mul = 0; }
  };

  // ---- Running it.
  // fired: detonate() or applyExploded() has run (the cutscene writes state.tor.exploded before the blast, so a save
  // made during it restores the end; that flag alone doesn't mean it went).
  let t = -1, running = false, base = 0, clock = 0, liveUntil = -1, settled = false, fired = false, lit = false;
  const drift = new THREE.Vector2();
  // (Without the blast model there is no stump to show: the tor stays whole, its walls with it.)
  const swap = () => { if (!blast) return; intact.visible = false; broken.visible = true; };
  const k = () => (1 + atmo.uNight.value * 0.3) / Math.max(0.5, atmoState.exposure);

  const detonate = ({ sound = true } = {}) => {
    if (fired) return false;
    fired = true;
    state.exploded = true;
    running = true; settled = false;
    base = clock; t = 0;
    liveUntil = clock + SMOKE_END;
    drift.set(0, 0);
    fxGroup.visible = true;
    if (blast) {
      swap();
      flying.visible = true;
      debris.visible = false;
      action.reset().play();
      mixer.setTime(0);
      for (let i = 0; i < proxies.length; i++) flying.setVisibleAt(i, true);
    }
    if (site) { site.center.copy(center); lit = true; }
    if (water?.spring) water.spring.visible = false;
    if (sound) ctx.audio?.play?.('explosion', { pos: center.clone() });
    return true;
  };

  const applyExploded = () => {
    fired = true;
    state.exploded = true;
    running = false; settled = true;
    t = -1;
    swap();
    if (blast) { flying.visible = false; debris.visible = true; mixer.stopAllAction(); }
    fxGroup.visible = false;
    U.uT.value = -1;
    for (const l of landU) l.w = -1;
    flash = 0;
    if (site) site.center.copy(away);
    lit = false;
    if (water?.spring) water.spring.visible = false;
    waterOff();
  };

  // (Dev, for tuning from the console: back to the intact tor with its water running, the boulders dormant.)
  const rewind = () => {
    fired = false; running = false; settled = false; t = -1; flash = 0;
    state.exploded = false;
    intact.visible = true; broken.visible = false;
    if (blast) { flying.visible = false; debris.visible = false; mixer.stopAllAction(); }
    fxGroup.visible = false;
    U.uT.value = -1;
    for (const l of landU) l.w = -1;
    if (site) site.center.copy(away);
    lit = false;
    if (water?.group) water.group.visible = true;
    if (water?.spring) water.spring.visible = true;
    if (cascadeU) cascadeU.uDry.value = -1;
    for (const m of water?.fx ?? []) if (m.material?.uniforms?.uOpacity) m.material.uniforms.uOpacity.value = 1;
    if (emitter) { emitter.off = false; emitter.mul = 1; }
    const B = ctx.boulders;
    if (B) { B.rocks.forEach((r, i) => B.sleep(i)); B.group.visible = false; ctx.state.rocks.released = false; }
  };

  const landDust = (i, pos) => {
    if (!running) { base = clock; t = 0; running = true; liveUntil = clock; drift.set(0, 0); U.uT.value = 0; }
    liveUntil = Math.max(liveUntil, clock + 12);
    fxGroup.visible = true;
    landU[i]?.set(pos.x, pos.y, pos.z, clock - base);
  };

  const m4 = new THREE.Matrix4();
  const update = (dt) => {
    clock += dt;
    if (!running) return;
    t = clock - base;
    const K = k();
    U.uT.value = t;
    U.uK.value = K;
    drift.x += atmo.uWind.value.x * dt * 1.1;
    drift.y += atmo.uWind.value.y * dt * 1.1;
    U.uDrift.value.copy(drift);
    // The flash: each charge's crack, then the fireballs' glow dying away, flickering.
    if (fired && t < 4) {
      let f = 0;
      for (const c of CHARGE_T) if (t >= c) f += Math.exp(-(t - c) / 0.06);
      const glow = Math.exp(-t / 0.45) * (0.8 + 0.2 * Math.sin(t * 37) * Math.sin(t * 23 + 1));
      flash = (f * 0.6 + glow * 0.25) * FLASH_I * K;
      U.uFire.value = clamp(f * 0.25 + glow * 0.8, 0, 1.2);
    } else {
      flash = 0;
      U.uFire.value = 0;
      if (lit) { site.center.copy(away); lit = false; }
    }
    // The debris.
    if (blast && !settled && fired) {
      if (t < blast.clip.duration) {
        mixer.update(dt);
        for (let i = 0; i < proxies.length; i++) {
          const o = proxies[i];
          if (chunks[i].lost && o.position.y < 0) { flying.setVisibleAt(i, false); continue; }
          o.updateMatrix();
          flying.setMatrixAt(i, m4.copy(o.matrix));
        }
      } else {
        settled = true;
        flying.visible = false;
        debris.visible = true;
      }
    }
    // The water: the last of it runs off the face, then the splash, spray and mist settle.
    if (fired && water) {
      if (cascadeU) cascadeU.uDry.value = tauCut * smoothstep(0.02, 0.1, t) + t * drainRate;
      const fade = 1 - smoothstep(drainT * 0.7, drainT + 1.6, t);
      for (const m of water.fx ?? []) if (m.material?.uniforms?.uOpacity) m.material.uniforms.uOpacity.value = fade;
      if (emitter) emitter.mul = 1 - smoothstep(0.2, drainT + 1.2, t);
      if (t > drainT + 1.8) waterOff();
    }
    if (clock > liveUntil) {
      running = false;
      fxGroup.visible = false;
      U.uT.value = -1;
      flash = 0;
      if (lit) { site.center.copy(away); lit = false; }
    }
  };
  ctx.updaters.push(update);

  return (ctx.torBlast = {
    exploded: () => !!state.exploded,
    detonate, applyExploded, update, landDust, rewind,
    center, charges, launch,
    stumpTop, stumpFootprint: tor.footprint, debrisRest,
    timeline: {
      charges: CHARGE_T.slice(), flash: [0, 0.4], fireball: [0.05, 1.2], debris: [0, blast?.clip.duration ?? 0],
      settled: blast?.clip.duration ?? 0, drained: drainT, fxGone: drainT + 1.8, smokeGone: SMOKE_END,
    },
    // For the console and the test.
    parts: { intact, broken, flying, debris, fxGroup, fire, streaks, dust, site },
  });
}

// Each chunk's last key (where it comes to rest), relative to the tor's frame.
function chunkEnds(clip, chunks) {
  const tr = Object.fromEntries(clip.tracks.map((t) => [t.name, t]));
  return chunks.map((c) => {
    const p = tr[c.name + '.position'], q = tr[c.name + '.quaternion'];
    const pv = p.values, qv = q.values, np = pv.length - 3, nq = qv.length - 4;
    return { pos: new THREE.Vector3(pv[np], pv[np + 1], pv[np + 2]), quat: new THREE.Quaternion(qv[nq], qv[nq + 1], qv[nq + 2], qv[nq + 3]) };
  });
}

// Where and when each chunk (the lost ones aside) first comes down hard: the key where its fall is suddenly checked.
function chunkHits(clip, chunks, fx, fz) {
  const tr = Object.fromEntries(clip.tracks.map((t) => [t.name, t]));
  const out = [];
  chunks.forEach((c) => {
    if (c.lost) return;
    const p = tr[c.name + '.position'];
    const T = p.times, v = p.values;
    let hits = 0;
    for (let i = 2; i < T.length && hits < 2; i++) {
      const vy0 = (v[(i - 1) * 3 + 1] - v[(i - 2) * 3 + 1]) / (T[i - 1] - T[i - 2]);
      const vy1 = (v[i * 3 + 1] - v[(i - 1) * 3 + 1]) / (T[i] - T[i - 1]);
      if (vy0 < -3 && vy1 > vy0 + 3) {
        out.push({ t: T[i - 1], pos: new THREE.Vector3(v[(i - 1) * 3] + fx, v[(i - 1) * 3 + 1], v[(i - 1) * 3 + 2] + fz) });
        hits++;
        i += 6;
      }
    }
  });
  return out;
}

// Seconds of fall (the cascade's aFall.y) where its sheet first comes down to world height y.
function tauAtHeight(geo, y) {
  const P = geo.attributes.position, F = geo.attributes.aFall;
  let best = 0;
  for (let i = 0; i < P.count; i++) if (P.getY(i) >= y) best = Math.max(best, F.getY(i));
  return best;
}

// The highest point of a mesh over each cell of a grid (world x, z): what falling things land on.
function heightGrid(geo, cell) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, x0 = bb.min.x, z0 = bb.min.z;
  const nx = Math.ceil((bb.max.x - x0) / cell) + 1, nz = Math.ceil((bb.max.z - z0) / cell) + 1;
  const h = new Float32Array(nx * nz).fill(-Infinity);
  const P = geo.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) {
    const ix = Math.floor((P[i] - x0) / cell), iz = Math.floor((P[i + 2] - z0) / cell), k = iz * nx + ix;
    if (P[i + 1] > h[k]) h[k] = P[i + 1];
  }
  return (x, z) => {
    const ix = Math.floor((x - x0) / cell), iz = Math.floor((z - z0) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return null;
    const v = h[iz * nx + ix];
    return v === -Infinity ? null : v;
  };
}
