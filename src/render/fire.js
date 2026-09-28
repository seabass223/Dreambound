import * as THREE from 'three';
import { atmo, atmoState } from './atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SCENE_FOG_GLSL } from './glsl.js';
import { Rng } from '../core/rng.js';

// Real-time procedural volumetric fire, after Alfred Fuller's technique as ported to three.js by mattatz (THREE.Fire)
// and yomotsu (VolumetricFire): a box is raymarched in its fragment shader, each sample turned into cylindrical
// flame coordinates (distance from the axis, height) whose height is pushed up by scrolling 3D turbulence, then looked
// up in a flame-shaped colour gradient and summed. Here the gradient is a function (no texture), the march covers
// exactly the ray's chord through the box (so the step count is the sample count), samples outside the flame's cone
// skip the noise, and a thin ember layer glows at the bottom. Towards the look of Three.js Fire Pro (a fluid sim,
// far over budget): four octaves for fine filaments, a slow swirl, separate tongues, the turbulence's creases as dark
// gaps, and a faint smoke above the tips that dims what is behind it.
//
// Per fire: two draw calls (the flame box and a handful of GPU sparks with closed-form motion, no CPU work per frame
// beyond a few uniforms) and one PointLight, flickering by intensity only. The light is created with the world so every
// lit program is compiled with it by the preloader (render/preload.js); it is never removed or hidden, only dimmed to 0.

const STEPS = 20;   // raymarch samples per pixel

const FLAME_VERT = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${NOISE_GLSL}
${SCENE_FOG_GLSL}
uniform vec2 uFar;
varying vec3 vOrigin;
varying vec3 vDir;
varying float vFade;
void main() {
  // The ray in the box's own space (a unit cube centred on the origin).
  vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  vDir = position - vOrigin;
  // Fog transmittance at the fire (sceneFog is linear in the colour: f(1) - f(0) is how much of it survives), and the
  // fade before the LOD hides it (zoom-aware, as LodSystem measures).
  vec3 C = modelMatrix[3].xyz;
  float deck;
  float T = sceneFog(vec3(1.0), C, deck).g - sceneFog(vec3(0.0), C, deck).g;
  float eff = length(C - cameraPosition) / max(projectionMatrix[1][1] * 0.6745, 1e-3);
  vFade = clamp(T, 0.0, 1.0) * (1.0 - smoothstep(uFar.x, uFar.y, eff));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
${NOISE_GLSL}
uniform vec3 uScale;      // the box's size in metres
uniform vec3 uNoise;      // turbulence frequency across, up and deep (per unit of the flame's coordinates)
uniform float uSpeed;     // how fast the turbulence rises (noise units a second)
uniform float uMag;       // how far the turbulence pushes the flame up (Fuller's "magnitude")
uniform float uTongue;    // how much the flame's height varies across its width
uniform float uSeed;
uniform float uDensity;   // emission per metre
uniform float uIntensity; // flicker and exposure, from the CPU
uniform float uEmber;     // thickness of the ember layer (fraction of the height)
uniform float uHeat;      // temperature scale: higher is yellower
uniform float uLift;      // height of the fuel (fraction): the flame is thin below it
uniform float uWarp;      // how far a slow noise sways the flame sideways (more towards the tips)
uniform float uSmoke;     // density of the smoke above the tips (absorbs; 0 for none)
varying vec3 vOrigin;
varying vec3 vDir;
varying float vFade;

float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
// Fuller's turbulence: |noise| summed over octaves (lacunarity 2, gain 0.5), billowy, with sharp creases where
// the noise crosses zero. Four octaves: the fine filaments are what reads as flame rather than glow.
float turbulence(vec3 p) {
  float s = 0.0, a = 1.0;
  for (int i = 0; i < 4; i++) { s += abs(vnoise3(p) * 2.0 - 1.0) * a; p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// The flame gradient by temperature: deep red, orange, yellow, a white-yellow core.
vec3 ramp(float T) {
  vec3 c = mix(vec3(0.45, 0.03, 0.0), vec3(1.0, 0.24, 0.02), smoothstep(0.0, 0.3, T));
  c = mix(c, vec3(1.0, 0.55, 0.1), smoothstep(0.25, 0.6, T));
  return mix(c, vec3(1.0, 0.88, 0.55), smoothstep(0.6, 1.0, T));
}
// Half-width of the flame (in the box's normalised radius) at displaced height h: a teardrop narrowing to the tip.
float flameWidth(float h) { return 0.95 * pow(max(1.0 - h, 0.0), 0.65); }

// Emission (rgb) and smoke extinction (a) at p (box space, -0.5..0.5).
vec4 sampleFire(vec3 p, float tongue) {
  vec2 pr = p.xz * 2.0;
  float y = p.y + 0.5;
  vec4 res = vec4(0.0);
  // The ember bed: a thin, slowly breathing glow over the floor of the fire.
  if (y < uEmber) {
    float n = vnoise(pr * 3.3 + vec2(uSeed, uTime * 0.21)) * 0.65 + vnoise(pr * 7.1 - uTime * 0.13) * 0.35;
    res.rgb += vec3(1.0, 0.22, 0.03) * (1.0 - smoothstep(0.5, 0.95, length(pr))) * (1.0 - y / uEmber) * (0.25 + 1.4 * n * n);
  }
  // Fuller's displacement, centred on the turbulence's mean (0.5) so the flame fills the box on average and licks
  // above it and below it; it moves a point at most sqrt(y) * uMag / 2 down, and the sway at most uWarp / 2 aside,
  // so beyond that cone there is nothing to find.
  float sy = sqrt(y);
  if (length(pr) >= flameWidth(y - sy * uMag * 0.5) + uWarp * 0.5 * y) return res;
  vec3 q = vec3(pr.x, y, pr.y) * uNoise + vec3(uSeed, -uTime * uSpeed, uSeed * 1.7);
  // A slow, large swirl rising with the flame bends it sideways, more towards the tips.
  float sw = vnoise3(q * vec3(0.3, 0.35, 0.3) + 5.3) - 0.5;
  pr += vec2(sw, sw * -0.7) * uWarp * y;
  float r = length(pr);
  float tb = turbulence(q + vec3(sw * 2.0, 0.0, sw * -1.4));
  float h = (y + sy * uMag * (tb - 0.5)) / tongue;
  if (h >= 1.0) {
    // Gas lifted past the tips has cooled: a thin brown smoke that dims what is behind it.
    res.a = uSmoke * smoothstep(1.0, 1.12, h) * (1.0 - smoothstep(1.15, 1.6, h)) * (1.0 - smoothstep(0.25, 0.8, r))
      * smoothstep(0.35, 0.75, y) * smoothstep(0.35, 0.8, tb);
    res.rgb += vec3(0.16, 0.06, 0.02) * res.a;   // lit a little from below
    return res;
  }
  float e = r / flameWidth(max(h, 0.0));
  if (e >= 1.0) return res;
  // Hottest low on the axis; the edges and the tips cool to red. Thin and cooler over the fuel (up to uLift), so
  // the logs read through the flame's foot.
  float foot = smoothstep(0.0, uLift, y);
  float T = clamp(pow(1.0 - e, 0.7) * smoothstep(1.0, 0.25, h) * uHeat * mix(0.55, 1.0, foot), 0.0, 1.0);
  // The turbulence's creases (where the noise crosses zero) open as dark gaps between filaments.
  float gaps = mix(0.1, 1.0, smoothstep(0.15, 0.45, tb));
  float soft = (1.0 - smoothstep(0.8, 1.0, e)) * mix(0.1, 1.0, foot) * smoothstep(1.0, 0.85, h) * gaps;
  res.rgb += ramp(T) * (0.3 + 1.0 * T) * soft;
  return res;
}

void main() {
  vec3 rd = normalize(vDir);
  rd = sign(rd) * max(abs(rd), vec3(1e-5));
  // The chord through the box (slab test), from the eye if it is inside.
  vec3 ta = (-0.5 - vOrigin) / rd, tb = (0.5 - vOrigin) / rd;
  vec3 tn = min(ta, tb), tf = max(ta, tb);
  float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0)), t1 = min(min(tf.x, tf.y), tf.z);
  if (t1 <= t0 || vFade <= 0.0) discard;
  float dt = (t1 - t0) / float(${STEPS});
  // A per-pixel offset along the ray trades the steps' banding for fine grain (interleaved gradient noise: evener
  // than white noise, so the grain is finer).
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = vOrigin + rd * (t0 + (float(i) + j) * dt);
    // The flame's height varies across its plan (separate tongues), slowly.
    float tongue = 1.0 - uTongue * vnoise(p.xz * 3.4 + vec2(uSeed * 3.1, uTime * 0.55));
    acc += sampleFire(p, tongue);
  }
  // Object units to metres along this ray, so the brightness does not depend on the box's proportions.
  float len = dt * length(uScale * rd);
  vec3 col = acc.rgb * len * uDensity * uIntensity * vFade;
  col = clamp(col, 0.0, 6.0);   // bounded HDR for the bloom and the room probe (no Inf or NaN reaches either)
  // Premultiplied: a little coverage from the flame itself (it reads against daylight), plus the smoke's.
  float a = clamp(dot(col, vec3(0.3, 0.5, 0.2)) * 0.2, 0.0, 0.4) + (1.0 - exp(-acc.a * len * 6.0)) * 0.6 * vFade;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.8));
}
`;

const SPARK_VERT = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${NOISE_GLSL}
${SCENE_FOG_GLSL}
uniform float uPxH;
uniform vec2 uFar;
uniform vec3 uBase;       // centre of the fire's floor (world)
uniform vec3 uSpan;       // half-width, rise, half-depth (m)
uniform float uRate;      // share of sparks alive at once
uniform float uIntensity;
varying vec3 vCol;
void main() {
  // position holds three uniform randoms per spark: its lifetime, its phase and its id.
  vec3 s = position;
  float life = mix(1.1, 2.4, s.x);
  float ph = uTime / life + s.y * 7.0;
  float cyc = mod(floor(ph), 4096.0);
  float t = fract(ph);
  float id = floor(s.z * 4096.0);
  float r1 = hash13(vec3(id, cyc, 1.0)), r2 = hash13(vec3(id, cyc, 2.0)), r3 = hash13(vec3(id, cyc, 3.0));
  if (hash13(vec3(id, cyc, 4.0)) > uRate) { vCol = vec3(0.0); gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Born over the embers, rising and slowing, fluttering sideways more as they climb.
  float a = r1 * 6.2831853, rr = sqrt(r2) * 0.6;
  vec3 P = uBase + vec3(cos(a) * rr * uSpan.x, 0.05 * uSpan.y, sin(a) * rr * uSpan.z);
  P.y += uSpan.y * (0.4 + 0.6 * r3) * (1.35 * t - 0.35 * t * t);
  P.x += sin(t * (5.0 + r1 * 5.0) + r2 * 6.28) * 0.06 * t;
  P.z += cos(t * (4.0 + r3 * 6.0) + r1 * 6.28) * 0.06 * t;
  vec4 mv = viewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  // A 1.5 cm glow; far away it keeps 1.5 px and dims instead (same energy), so the sparks never shimmer or vanish.
  float size = 0.015 * 0.5 * max(uPxH, 1.0) * projectionMatrix[1][1] / max(-mv.z, 0.05);
  float px = max(size, 1.5);
  gl_PointSize = px;
  float heat = 1.0 - t;
  float tw = 0.65 + 0.35 * sin(uTime * (19.0 + r2 * 17.0) + r3 * 6.28);
  vec3 col = mix(vec3(1.0, 0.16, 0.02), vec3(1.0, 0.72, 0.3), heat * heat) * heat * sqrt(heat) * tw * 3.0;
  float deck;
  float T = sceneFog(vec3(1.0), P, deck).g - sceneFog(vec3(0.0), P, deck).g;
  float eff = length(P - cameraPosition) / max(projectionMatrix[1][1] * 0.6745, 1e-3);
  vCol = col * uIntensity * clamp(T, 0.0, 1.0) * (1.0 - smoothstep(uFar.x, uFar.y, eff)) * min(1.0, (size * size) / (px * px));
}
`;

const SPARK_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  // Additive (alpha 0 under premultiplied-over blending).
  gl_FragColor = vec4(min(vCol * exp(-d2 * 3.5), vec3(6.0)), 0.0);
}
`;

const blend = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,   // premultiplied over
};

// A fire whose flame box stands on `base` (the centre of its floor, world space) with `size` (width, height, depth in
// metres; the flame is an ellipse in plan, so a wide hearth gets a wide flame). Added to `parent` (world-aligned,
// identity transform) and registered with the LOD to hide past `out`. Options tune the flame (`noise`, `speed`, `mag`,
// `tongue`, `density`, `ember`, `heat`, `lift`, `warp`, `smoke`), the sparks (`sparks`, `rise`, `rate`) and the light (`light`: { offset, color,
// distance, power }). `probe`: the cabin's reflection-probe layer, so the glossy room reflects the flame.
export function createFire(ctx, {
  name = 'fire', base, size, parent, out = [60, 80], seed = 1, noise = [1.6, 2.6, 1.6], speed = 2.2, mag = 0.9,
  tongue = 0.3, density = 3.2, ember = 0.08, heat = 1.1, lift = 0.15, warp = 0.35, smoke = 0, sparks = 24, rise = 1.4, rate = 0.6, light = null, probe = null,
}) {
  const rng = new Rng(seed * 7919 + 13);
  const group = new THREE.Group();
  group.name = name;

  const flameU = {
    uTime: atmo.uTime,
    uSunDir: atmo.uSunDir, uMoonDir: atmo.uMoonDir, uZenith: atmo.uZenith, uHorizonAway: atmo.uHorizonAway,
    uHorizonSun: atmo.uHorizonSun, uSunGlow: atmo.uSunGlow, uNight: atmo.uNight, uUnderground: atmo.uUnderground,
    uFogDensity: atmo.uFogDensity, uFogLow: atmo.uFogLow, uFogTint: atmo.uFogTint, uCloudColor: atmo.uCloudColor,
    uFar: { value: new THREE.Vector2(out[0], out[1]) },
    uIntensity: { value: 1 },
  };
  const flame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
    name: name + ':flame',
    uniforms: {
      ...flameU,
      uScale: { value: size.clone() },
      uNoise: { value: new THREE.Vector3(...noise) },
      uSpeed: { value: speed }, uMag: { value: mag }, uTongue: { value: tongue },
      uSeed: { value: rng.float(0, 50) }, uDensity: { value: density }, uEmber: { value: ember }, uHeat: { value: heat }, uLift: { value: lift },
      uWarp: { value: warp }, uSmoke: { value: smoke },
    },
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, ...blend,
  }));
  flame.position.set(base.x, base.y + size.y / 2, base.z);
  flame.scale.copy(size);
  flame.renderOrder = 3;   // after the glass (2): seen through a window, the flame is not overwritten by it

  // Sparks: three randoms each in `position` (the shader places them); the bounds are set by hand.
  const seeds = new Float32Array(sparks * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng.next();
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const lo = new THREE.Vector3(base.x - size.x, base.y, base.z - size.z), hi = new THREE.Vector3(base.x + size.x, base.y + rise * 1.1, base.z + size.z);
  sg.boundingBox = new THREE.Box3(lo, hi);
  sg.boundingSphere = sg.boundingBox.getBoundingSphere(new THREE.Sphere());
  const spark = new THREE.Points(sg, new THREE.ShaderMaterial({
    name: name + ':sparks',
    uniforms: {
      ...flameU, uPxH: atmo.uPxH,
      uBase: { value: base.clone() },
      uSpan: { value: new THREE.Vector3(size.x / 2, rise, size.z / 2) },
      uRate: { value: rate },
    },
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, ...blend,
  }));
  spark.renderOrder = 3;

  for (const o of [flame, spark]) {
    o.castShadow = o.receiveShadow = false;
    o.raycast = () => {};   // never in the way of a press or the debug report's rays
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    group.add(o);
  }
  // The flame (not the sparks, sized for the screen) is seen by the room probe.
  if (probe != null) flame.layers.enable(probe);
  parent.add(group);
  group.updateMatrixWorld(true);
  const lodEntry = ctx.lod.add(group, { out, fade: false, name });

  // The firelight: a warm point light, no shadows, at the scene root so it exists (and is compiled for) everywhere.
  let lamp = null;
  if (light) {
    lamp = new THREE.PointLight(new THREE.Color(...(light.color || [1, 0.55, 0.22])), 0, light.distance || 8, 2);
    lamp.name = name + ':light';
    lamp.castShadow = false;
    lamp.position.copy(base).add(light.offset || new THREE.Vector3(0, size.y * 0.35, 0));
    ctx.scene.add(lamp);
  }

  // Flicker: a few incommensurate sines, a slow breath and a quicker gutter; the flame shows half of it, the light all.
  const ph = rng.float(0, 100);
  const fire = {
    group, flame, spark, light: lamp, lodEntry, flicker: 1,
    update() {
      const t = atmo.uTime.value + ph;
      const f = 1 + Math.sin(t * 7.3) * 0.05 + Math.sin(t * 13.1 + 1.7) * 0.04 + Math.sin(t * 23.7 + 0.4) * 0.025
        + Math.sin(t * 0.61) * 0.06 + Math.sin(t * 2.3 + 2.1) * 0.04;
      fire.flicker = f;
      // Exposure opens ~3x at night: divide it back out (a little brighter after dark), as the cabin's lamps do.
      const k = (1 + atmo.uNight.value * 0.5) / Math.max(0.5, atmoState.exposure);
      flameU.uIntensity.value = (1 + (f - 1) * 0.5) * k;
      if (lamp) lamp.intensity = lodEntry.state === 0 || atmo.uUnderground.value > 0.5 ? 0 : (light.power || 6) * f * k;
    },
  };
  ctx.updaters.push(fire.update);
  return fire;
}
