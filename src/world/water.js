import * as THREE from 'three';
import { atmo } from '../render/atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL, SCENE_FOG_GLSL } from '../render/glsl.js';
import { patchMaterial } from '../render/materials.js';
import { smoothstep, lerp } from '../core/rng.js';

// Scrolling noise can't run on uTime forever (hash inputs must stay small), so it runs on two clocks that wrap
// every P seconds half a period apart, crossfaded so each has zero weight as it wraps. flowClock returns both
// phases and the weight of the second. xfade blends the two samples of a noise with mean m and range [0, hi],
// keeping the contrast of one (the samples are independent, so a plain mix goes flat mid-fade).
const XFADE_GLSL = /* glsl */ `
vec3 flowClock(float P) {
  return vec3(mod(uTime, P), mod(uTime + P * 0.5, P), abs(2.0 * fract(uTime / P) - 1.0));
}
float xfade(float a, float b, float w, float m, float hi) {
  return clamp(m + (mix(a, b, w) - m) * inversesqrt(w * w + (1.0 - w) * (1.0 - w)), 0.0, hi);
}
`;

// fbm3o (NOISE_GLSL, which must come first) with each octave fading to its mean once it gets down to a few
// pixels (fw = noise units per pixel): there is no anti-aliasing, so anything finer shimmers.
export const AFBM_GLSL = /* glsl */ `
float afbm(vec2 p, float fw) {
  float s = 0.0, a = 0.5, f = 1.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    s += a * mix(vnoise(p), 0.5, smoothstep(0.15, 0.35, fw * f));
    p = r * p * 2.03 + 11.7;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
`;

// ---------------------------------------------------------------------------------------------
// Free-falling water: the creek leaving an island over its lip, and the cascade down a rock face.
// Sheets are row-by-column grids with aFall = (metres below the start, seconds of travel, across -1..1,
// width). Streaks scroll with (travel time - uTime), i.e. at the true local speed, so they stretch as the
// water accelerates; with depth the sheet widens, tears into strands and turns to mist.
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const G = 9.8;
const VT = 22;       // terminal speed of falling water in air, m/s
const KX = 0.35;     // horizontal drag, 1/s
const DRIFT = 1.4;   // wind drift at the foot of the column, metres per unit of atmo.uWind (capped at 1.15 in fallVert)
const LEAN = 0.3;    // how steeply the sheet may lean out ahead of a buttress, m per m of drop
// Mist veils over the fall's centreline: width factor and outward push, near the top -> lower down.
const VEILS = [{ wide: [1.3, 1.9], push: [0.8, 1.7] }, { wide: [1.7, 2.6], push: [1.5, 3.0] }];

// Seconds to fall s metres against quadratic drag.
const fallTime = (s) => (VT / G) * Math.acosh(Math.exp(Math.min(s, 500) * G / (VT * VT)));
// Most the vertex shader moves a column sideways (wind, sway, edge wobble), kept clear of the rock too.
const swayAt = (s, w) => (DRIFT * 1.15 + 0.35) * smoothstep(15, 120, s) + 0.06 * w;

const fallVert = /* glsl */ `
attribute vec4 aFall;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uOut;
uniform vec4 uShape;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vFall;
varying float vEff;
#ifdef VEIL
attribute float aPhase;
varying float vPhase;
#endif
void main() {
  float s = aFall.x;
  vec3 side = vec3(-uOut.z, 0.0, uOut.x);
  // The lower column drifts with the wind and sways; the solid water near the lip stays put.
  float low = smoothstep(15.0, 120.0, s);
  float gust = 0.85 + 0.15 * sin(uTime * 0.31 + s * 0.013);
  // |uWind| capped at the 1.15 that swayAt budgets for (main.js's wind reaches ~1.28).
  vec2 wind = uWind * min(1.0, 1.15 / max(length(uWind), 1e-4));
  vec3 d = vec3(wind.x, 0.0, wind.y) * (uShape.w * low * gust);
  d += uOut * ((0.25 + 0.25 * sin(uTime * 1.3 - s * 0.08)) * low);
  d += side * (0.35 * low * sin(uTime * 0.45 - s * 0.021 + 1.7));
  // Edges breathe a little.
  d += side * (aFall.z * aFall.w * 0.06 * sin(uTime * 2.1 - aFall.y * 2.7 + aFall.z * 1.3));
  // Never toward the rock.
  d -= uOut * min(dot(d, uOut), 0.0);
  vec4 w = modelMatrix * vec4(position + d, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(modelMatrix) * normal;
  vFall = aFall;
  // Zoom-aware distance (equal to the real one at the default 68 deg FOV), so the telescope keeps detail.
  vEff = length(w.xyz - cameraPosition) / (projectionMatrix[1][1] * 0.6745);
#ifdef VEIL
  vPhase = aPhase;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Shared by the sheet and veil fragment shaders; needs SKY_UNIFORMS_GLSL and NOISE_GLSL before it.
const FALL_GLSL = /* glsl */ `
${XFADE_GLSL}
uniform vec3 uSunLight;
uniform vec3 uAmbient;
uniform vec3 uOut;
uniform vec4 uWall;    // rock column behind the water: centre xz, radius, top y
uniform vec4 uFade;    // world y fully visible, world y gone; drop (m) fully visible, drop gone
uniform vec4 uShape;   // glassy tongue length (m), break-up start and end (m of drop), wind drift
uniform vec2 uFreq;    // streaks per metre across, per second of travel along
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vFall;
varying float vEff;
${AFBM_GLSL}
// Direct sun reaching P past the rock column (no shadow map reaches this far): the sun ray must clear the
// column's top where it enters it, or pass beside it.
float wallSun(vec3 P) {
  vec2 L = uSunDir.xz;
  float l2 = dot(L, L);
  vec2 d = P.xz - uWall.xy;
  float b = dot(d, L);
  if (l2 < 1e-6 || b >= 0.0) return 1.0;
  float c = dot(d, d) - uWall.z * uWall.z;
  float disc = b * b - l2 * c;
  if (disc <= 0.0) return 1.0;
  float miss = smoothstep(uWall.z - 4.0, uWall.z + 1.0, sqrt(max(dot(d, d) - b * b / l2, 0.0)));
  float lam = max((-b - sqrt(disc)) / l2, 0.0);
  return max(smoothstep(-3.0, 3.0, P.y + uSunDir.y * lam - uWall.w), miss);
}

// Sky light is partly blocked right against the rock.
float rockOcc() {
  return mix(0.72, 1.0, smoothstep(0.0, 14.0, length(vWorld.xz - uWall.xy) - uWall.z));
}
`;

const sheetFrag = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${NOISE_GLSL}
${SKY_FUNC_GLSL}
${SCENE_FOG_GLSL}
${FALL_GLSL}
// The noise riding down with the water at one clock phase: streaks, finer streaks, slower churn, edge wobble.
vec4 flowNoise(float flow, float xm, float s, float ac, float fx, float ft, float fw) {
  return vec4(
    afbm(vec2(xm * uFreq.x, flow * uFreq.y), fw),
    vnoise(vec2(xm * uFreq.x * 3.3 + 17.0, flow * uFreq.y * 2.9)),
    afbm(vec2(xm * uFreq.x * 0.55 - 4.0, flow * uFreq.y * 2.4 + 4.0), max(fx * 0.55, ft * 2.4)),
    vnoise(vec2(step(0.0, ac) * 7.3 + s * 0.02, flow * 0.7)));
}
void main() {
  float s = vFall.x, tau = vFall.y, ac = vFall.z;
  float xm = ac * vFall.w * 0.5;
  float fx = fwidth(xm) * uFreq.x, ft = fwidth(tau) * uFreq.y;
  float fw = max(fx, ft);
  float detail = 1.0 - smoothstep(120.0, 320.0, vEff);
  // Period in noise units rather than seconds, so the hash inputs stay as small for the fast cascade.
  vec3 ck = flowClock(1080.0 / max(uFreq.y, 0.1));
  vec4 na = flowNoise(tau - ck.x, xm, s, ac, fx, ft, fw);
  vec4 nb = flowNoise(tau - ck.y, xm, s, ac, fx, ft, fw);
  float streak = xfade(na.x, nb.x, ck.z, 0.4375, 0.875);
  float fineK = detail * (1.0 - smoothstep(0.15, 0.35, max(fx * 3.3, ft * 2.9)));
  float fine = mix(0.5, xfade(na.y, nb.y, ck.z, 0.5, 1.0), fineK);
  float churn = xfade(na.z, nb.z, ck.z, 0.4375, 0.875);
  float jit = streak - 0.44;

  // Glassy tongue over the lip, a developed sheet, then strands with gaps that turn to mist.
  float glass = 1.0 - smoothstep(uShape.x * 0.35, uShape.x, s + jit * uShape.x * 0.6);
  float brk = smoothstep(uShape.y, uShape.z, s + jit * 12.0);
  float n = streak * 0.8 + fine * 0.3;
  float thr = mix(0.12, 0.6, brk);
  // A softer threshold once the noise has lost its detail, so distant strands average out instead of vanishing.
  float lost = max(1.0 - detail, smoothstep(0.15, 0.35, fw * 2.03));
  float soft = mix(0.3, 0.2, brk) + fwidth(n) * 1.5 + lost * 0.5;
  float cov = smoothstep(thr - soft * 0.5, thr + soft * 0.5, n) * (0.75 + 0.25 * smoothstep(0.2, 0.6, churn));
  float mist = brk * 0.22 * smoothstep(0.2, 0.7, streak);
  // Even the unbroken sheet is thinner in its dark lanes, so it never reads as a solid band.
  float lace = smoothstep(0.28, 0.72, n);
  float body = mix(max(cov * mix(mix(0.62, 0.97, lace), 0.55, brk), mist), 0.82, glass);
  float wob = xfade(na.w, nb.w, ck.z, 0.5, 1.0);
  float e = abs(ac) + (wob - 0.5) * mix(0.3, 0.06, glass) + (fine - 0.5) * 0.15 * (1.0 - glass);
  float edge = 1.0 - smoothstep(mix(mix(0.72, 0.3, brk), 0.82, glass) - fwidth(ac), 1.0, e);
  float fade = smoothstep(uFade.y, uFade.x, vWorld.y + jit * 20.0);
  fade *= 1.0 - smoothstep(uFade.z, uFade.w, s + jit * 2.0);
  fade *= mix(0.3, 1.0, smoothstep(0.0, 0.3, tau));
  float a = body * edge * fade;

  vec3 V = vWorld - cameraPosition;
  V /= max(length(V), 1e-4);
  float nl = length(vNormal);
  vec3 N = nl > 1e-4 ? vNormal / nl : uOut;
  float sunVis = wallSun(vWorld);
  // White water: sky ambient, a little direct sun (more on the sunward face), horizon bounce, and light
  // forward-scattered through the thinner parts when looking toward the sun.
  float mu = max(dot(V, uSunDir), 0.0);
  float fwd = pow(mu, 6.0) * 0.6 + pow(mu, 24.0) * 0.4;
  float moon = uNight * clamp(uMoonDir.y * 3.0, 0.0, 1.0);
  vec3 col = uAmbient * 2.1 * rockOcc() + horizonColor(V) * 0.28
    + uSunLight * sunVis * (0.1 + 0.14 * max(dot(uOut, uSunDir), 0.0))
    + (uSunGlow * 0.55 + uSunLight * 0.05) * fwd * sunVis * (1.5 - cov)
    + vec3(0.32, 0.4, 0.62) * moon * 0.1;
  col *= mix(0.72, 1.08, lace) * (0.92 + churn * 0.16);
  // Spray further down is greyer and softer.
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), brk * 0.45) * mix(1.0, 0.88, brk);
  // The tongue: dark green-glass water mirroring the sky before it aerates.
  float fres = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 5.0);
  vec3 deep = vec3(0.16, 0.34, 0.3) * (uAmbient * 1.6 + uSunLight * sunVis * 0.12);
  vec3 tongue = mix(deep, skyGradient(reflect(V, N)) * 0.9, fres) + col * 0.12;
  col = mix(col, tongue, glass);

  float deck;
  col = sceneFog(col, vWorld, deck);
  a = clamp(a * (1.0 - deck), 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

const veilFrag = /* glsl */ `
${SKY_UNIFORMS_GLSL}
${NOISE_GLSL}
${SKY_FUNC_GLSL}
${SCENE_FOG_GLSL}
${FALL_GLSL}
varying float vPhase;
void main() {
  float ac = vFall.z;
  float xm = ac * vFall.w * 0.5;
  // Broad billows sliding down at about a third of the water's speed.
  vec3 ck = flowClock(1200.0);
  vec2 pa = vec2(xm * 0.35 + vPhase * 13.1, (vFall.y - 0.35 * ck.x) * 0.45 + vPhase * 5.3);
  vec2 pb = vec2(pa.x, (vFall.y - 0.35 * ck.y) * 0.45 + vPhase * 5.3);
  float fwv = max(fwidth(pa.x), fwidth(pa.y));
  float v = xfade(afbm(pa, fwv), afbm(pb, fwv), ck.z, 0.4375, 0.875);
  float jit = v - 0.44;
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(ac) + jit * 0.5);
  float fade = smoothstep(4.0, 45.0, vFall.x) * smoothstep(uFade.y, uFade.x, vWorld.y + jit * 20.0);
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  V /= max(dist, 1e-4);
  fade *= smoothstep(2.0, 10.0, dist);
  float a = mix(0.3, 0.18, vPhase) * smoothstep(0.22, 0.7, v) * edge * fade;

  float sunVis = wallSun(vWorld);
  float mu = max(dot(V, uSunDir), 0.0);
  float fwd = pow(mu, 6.0) * 0.6 + pow(mu, 32.0) * 1.2;
  float moon = uNight * clamp(uMoonDir.y * 3.0, 0.0, 1.0);
  vec3 col = (mix(horizonColor(V), uZenith, 0.45) * 0.85 + uAmbient * 1.2) * mix(0.8, 1.0, rockOcc())
    + uSunLight * sunVis * 0.07
    + (uSunGlow * 0.9 + uSunLight * 0.06) * fwd * sunVis * 0.5
    + vec3(0.32, 0.4, 0.62) * moon * 0.12;

  float deck;
  col = sceneFog(col, vWorld, deck);
  a = clamp(a * (1.0 - deck), 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

function fallMaterial(name, { out, wall, fade, shape, freq = new THREE.Vector2(1.6, 0.9), veil = false }) {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { ...atmo, uOut: { value: out }, uWall: { value: wall }, uFade: { value: fade }, uShape: { value: shape }, uFreq: { value: freq } },
    defines: veil ? { VEIL: '' } : {},
    vertexShader: fallVert,
    fragmentShader: veil ? veilFrag : sheetFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    // Premultiplied over: the shaders write (col * a, a).
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// Strips of rows ({ p, w, s, tau }) laid across `side`, `cols` vertices per row, in one geometry. Strips with a
// `phase` get an aPhase attribute (the veils). `pad` grows the bounds by the shader's displacement.
function sheetGeometry(strips, side, cols, pad) {
  const pos = [], fall = [], phase = [], idx = [];
  for (const strip of strips) {
    const base = pos.length / 3;
    strip.rows.forEach(({ p, w, s, tau }, i) => {
      for (let j = 0; j < cols; j++) {
        const a = (j / (cols - 1)) * 2 - 1;
        pos.push(p.x + side.x * a * w / 2, p.y, p.z + side.z * a * w / 2);
        fall.push(s, tau, a, w);
        phase.push(strip.phase);
      }
      if (i) {
        const r0 = base + (i - 1) * cols, r1 = base + i * cols;
        for (let j = 0; j < cols - 1; j++) idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 4));
  if (strips[0].phase !== undefined) g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.boundingSphere.radius += pad;
  return g;
}

// Outermost radius (from the stack axis) of rock at height y around angle a: the horizontal cut through the
// built cliff mesh (coarse, y-jittered rows that can stand proud of cliffRadius between them; the cap rim
// above its top row) together with cliffRadius itself, over a mesh segment either side.
function rockProbe(stack) {
  const P = stack.group.getObjectByName('cliff')?.geometry.attributes.position.array;
  const segs = stack.segs, W = segs + 1, rows = P ? P.length / 3 / W : 0, dA = TAU / segs;
  const rad = (x, z) => Math.hypot(x - stack.cx, z - stack.cz);
  // Radius where the edge between vertices i and k crosses y (0 if it doesn't).
  const cut = (i, k, y) => {
    const y0 = P[i * 3 + 1], y1 = P[k * 3 + 1];
    if ((y - y0) * (y - y1) > 0 || y0 === y1) return 0;
    const t = (y - y0) / (y1 - y0);
    return rad(P[i * 3] + (P[k * 3] - P[i * 3]) * t, P[i * 3 + 2] + (P[k * 3 + 2] - P[i * 3 + 2]) * t);
  };
  return (a, y) => {
    a = ((a % TAU) + TAU) % TAU;   // the cliff mesh samples cliffRadius at 0..2pi
    const depth = stack.top - y;
    let r = 0;
    for (let k = -1; k <= 1; k++) {
      const an = (a + k * dA + TAU) % TAU, er = stack.edgeR(an);
      r = Math.max(r, depth > 0 ? stack.cliffRadius(an, depth, er) : er);
    }
    if (!P) return r;
    const jc = Math.floor(a / dA);
    for (let j = jc - 1; j <= jc + 2; j++) {
      const c0 = ((j % segs) + segs) % segs, c1 = c0 + 1;
      if (y >= P[c0 * 3 + 1]) r = Math.max(r, rad(P[c0 * 3], P[c0 * 3 + 2]));
      for (let ri = 0; ri < rows - 1; ri++) {
        const a0 = ri * W + c0, b0 = a0 + W;
        if (P[a0 * 3 + 1] < y - 4) break;
        if (P[b0 * 3 + 1] > y + 4) continue;
        r = Math.max(r, cut(a0, b0, y), cut(ri * W + c1, b0, y));
      }
    }
    return r;
  };
}

const interp = (xs, ys, x) => {
  let i = 1;
  while (i < xs.length - 1 && xs[i] < x) i++;
  const f = Math.min(Math.max((x - xs[i - 1]) / Math.max(xs[i] - xs[i - 1], 1e-6), 0), 1);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * f;
};

// The creek leaving the island over its lip at stack angle `theta` (outward = (cos, 0, sin)); `lip` is the
// water surface there. It runs on to the rim, curls over and falls `drop` metres along a drag-limited
// trajectory, kept clear of the cliff, fading into the cloud sea between world y fadeY[0] and fadeY[1] (+/-8.8 m
// of noise). Lowering fadeY makes the sea cut it harder: that sea piles up against the stack to about y -148
// half the time and -100 at its highest 1% under the Rocks fall. Call after stack.build() so the clearance
// sees the real cliff mesh. userData: { path (centreline, top first; path[0] is the lip), widths, drop }.
export function edgeWaterfall(stack, { theta, lip, width = 3.2, speed = 2.2, drop = 175, fadeY = [-95, -150] }) {
  const out = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const probe = rockProbe(stack);
  const widthAt = (s) => width * (1 + 1.5 * smoothstep(0, 120, s));
  const veilAt = (v, s) => {
    const k = smoothstep(5, 90, s);
    return { w: widthAt(s) * lerp(v.wide[0], v.wide[1], k), push: lerp(v.push[0], v.push[1], k) };
  };
  const lx = lip.x - stack.cx, lz = lip.z - stack.cz;
  const B = lx * out.x + lz * out.z;
  // Smallest offset along `out` from the lip, starting from x, that keeps the point `lat` metres to the side
  // and `push` further out at least `margin` clear of the rock at height y.
  const clearX = (x, lat, push, y, margin) => {
    const qx = lx + side.x * lat, qz = lz + side.z * lat, Q = qx * qx + qz * qz;
    for (let k = 0; k < 4; k++) {
      const u = x + push;
      const R = probe(Math.atan2(qz + out.z * u, qx + out.x * u), y) + margin;
      const need = Math.sqrt(Math.max(B * B - Q + R * R, 0)) - B - push;
      if (need <= x + 1e-3) break;
      x = need;
    }
    return x;
  };
  // The same for every column of the sheet and both veils at drop s, spread by the shader's sway.
  const needX = (x, s, y, margin) => {
    let req = x;
    const strips = [{ w: widthAt(s), push: 0 }, ...(s >= 2 ? VEILS.map((v) => veilAt(v, s)) : [])];
    for (const { w, push } of strips) {
      const half = w / 2 + swayAt(s, w), n = Math.max(7, Math.ceil(half / 0.6) + 1);
      for (let j = 0; j < n; j++) req = Math.max(req, clearX(x, (j / (n - 1) * 2 - 1) * half, push, y, margin));
    }
    return req;
  };

  // The creek runs on over its bed to the rim, dipping slightly, then launches.
  const w0 = widthAt(0);
  let xL = 0.3;
  for (let j = 0; j < 7; j++) xL = clearX(xL, (j / 3 - 1) * w0 / 2, 0, lip.y, 0.05);
  const rows = [];
  const nA = Math.max(2, Math.ceil(xL / 0.25));
  for (let i = 0; i <= nA; i++) {
    const f = i / nA, x = xL * f;
    let y = lip.y - 0.12 * f * f;
    // Stay on top of the bed.
    for (let j = -1; j <= 1 && stack.capBVH; j++) {
      const px = lip.x + out.x * x + side.x * j * w0 / 4, pz = lip.z + out.z * x + side.z * j * w0 / 4;
      const g = stack.heightAt(px, pz);
      if (g !== null) y = Math.max(y, g + 0.04);
    }
    rows.push({ x, y, tau: x / speed });
  }

  // Free fall: a fine envelope of the drag-limited trajectory pushed clear of the rock, leaning out gently
  // ahead of buttresses and never swinging back in.
  const { y: yL, tau: tauL } = rows[nA];
  const sL = lip.y - yL, fallS = Math.max(drop - sL, 1);
  const fs = [], fx = [];
  for (let s1 = 0; ; s1 = Math.min(s1 + Math.min(0.2 + s1 * 0.03, 1.5), fallS)) {
    const s = sL + s1;
    const x = xL + (speed / KX) * (1 - Math.exp(-KX * fallTime(s1)));
    fs.push(s1);
    fx.push(s1 ? needX(x, s, yL - s1, 0.25 + 0.95 * smoothstep(0, 4, s)) : xL);
    if (s1 >= fallS) break;
  }
  for (let k = fx.length - 2; k > 0; k--) fx[k] = Math.max(fx[k], fx[k + 1] - LEAN * (fs[k + 1] - fs[k]));
  for (let k = 1; k < fx.length; k++) fx[k] = Math.max(fx[k], fx[k - 1]);
  // Rows 0.25 m apart at the lip, growing to 6 m; straight between rows, so wherever the envelope pokes
  // through a row segment lift its ends (only the far end of the first one: the launch point stays put).
  const rs = [0];
  for (let ds = 0.25; rs[rs.length - 1] < fallS; ds = Math.min(ds * 1.12, 6)) rs.push(Math.min(rs[rs.length - 1] + ds, fallS));
  const rx = rs.map((s1) => interp(fs, fx, s1));
  for (let i = 0, k = 1; i < rs.length - 1; i++) {
    for (; k < fs.length && fs[k] <= rs[i + 1]; k++) {
      const f = (fs[k] - rs[i]) / (rs[i + 1] - rs[i]);
      const lack = fx[k] - (rx[i] + (rx[i + 1] - rx[i]) * f);
      if (lack <= 0) continue;
      if (i) { rx[i] += lack; rx[i + 1] += lack; } else rx[1] += lack / f;
    }
  }
  for (let i = 1; i < rs.length; i++) {
    rx[i] = Math.max(rx[i], rx[i - 1]);
    rows.push({ x: rx[i], y: yL - rs[i], tau: tauL + fallTime(rs[i]) });
  }

  const sheetRows = rows.map(({ x, y, tau }) => {
    const s = Math.max(lip.y - y, 0);
    return { p: new THREE.Vector3(lip.x + out.x * x, y, lip.z + out.z * x), w: widthAt(s), s, tau };
  });
  const veils = VEILS.map((v, phase) => ({
    phase,
    rows: sheetRows.filter((r) => r.s >= 2).map((r) => {
      const { w, push } = veilAt(v, r.s);
      return { ...r, p: r.p.clone().addScaledVector(out, push), w };
    }),
  }));
  const pad = swayAt(drop, widthAt(drop) * VEILS[1].wide[1]) + 0.5;
  const uni = {
    out,
    wall: new THREE.Vector4(stack.cx, stack.cz, stack.edgeR(theta), stack.top + 1),
    fade: new THREE.Vector4(fadeY[0], fadeY[1], 1e4, 2e4),
    shape: new THREE.Vector4(2.2, 18, 120, DRIFT),
  };
  const sheet = new THREE.Mesh(sheetGeometry([{ rows: sheetRows }], side, 7, pad), fallMaterial('edge-fall', uni));
  sheet.renderOrder = 4;
  const veil = new THREE.Mesh(sheetGeometry(veils, side, 5, pad), fallMaterial('edge-fall-veil', { ...uni, veil: true }));
  veil.renderOrder = 4.1;
  const group = new THREE.Group();
  group.name = 'edge-fall';
  group.add(sheet, veil);
  group.userData = { path: sheetRows.map((r) => r.p.clone()), widths: sheetRows.map((r) => r.w), drop: sheetRows[sheetRows.length - 1].s };
  return group;
}

// A short white-water cascade down a rock face into a pool. points run top to bottom; the ribbon spans the
// horizontal perpendicular of `outward` (the unit direction away from the rock; by default the way the
// cascade runs, top to bottom).
export function cascadeMesh(points, widths, { outward = null } = {}) {
  const top = points[0];
  const dir = outward ?? points[points.length - 1].clone().sub(top);
  const out = new THREE.Vector3(dir.x, 0, dir.z);
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
  out.normalize();
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const v0 = 1.2;
  const rows = [];
  let tau = 0, v = v0;
  points.forEach((p, i) => {
    const s = Math.max(top.y - p.y, 0);
    const v1 = Math.sqrt(v0 * v0 + 2 * G * s);
    if (i) tau += p.distanceTo(points[i - 1]) / ((v + v1) / 2);
    v = v1;
    rows.push({ p, w: widths[i], s, tau });
  });
  const total = rows[rows.length - 1].s;
  const mat = fallMaterial('cascade', {
    out,
    // The rock face as a wide column just behind the water, topped a little above the spill.
    wall: new THREE.Vector4(top.x - out.x * 60.5, top.z - out.z * 60.5, 60, top.y + 0.5),
    fade: new THREE.Vector4(-9000, -10000, total - 0.8, total + 0.3),
    // Breaks into strands down the face, so the rock shows through near the foot.
    shape: new THREE.Vector4(0.6, 2, 18, 0),
    freq: new THREE.Vector2(2.6, 2.4),
  });
  const m = new THREE.Mesh(sheetGeometry([{ rows }], side, 5, 0.5), mat);
  m.name = 'cascade';
  m.renderOrder = 4;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Stream: a physically based, refractive water surface.
//  - transmission refracts the creek bed through animated ripple normals
//  - per-vertex true depth drives absorption tint, edge fade, and foam
//  - three flow-aligned normal layers scroll at different rates and scales
//  - caustics dance on the refracted bed; foam streaks gather at banks and rapids
//  - uv.x runs with the water's travel time, not distance: ripples and foam scroll along it at one uniform
//    rate, so they move faster where aSpeed is higher (stretching there) and never shear apart over time
// ---------------------------------------------------------------------------------------------
const FLOW_K = 2.3;   // the water runs (1 + FLOW_K * aSpeed) times as fast as in still stretches

export function streamGeometry(points, widths, depthAt, { across = 9, speedAt = () => 0 } = {}) {
  const pos = [], uv = [], dep = [], acr = [], spd = [], idx = [];
  // Travel time in still-water metres: equal to the distance where aSpeed is 0.
  let flow = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const s = speedAt(i / (points.length - 1));
    if (i) flow += p.distanceTo(points[i - 1]) / (1 + FLOW_K * (s + spd[spd.length - 1]) / 2);
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const tng = b.clone().sub(a).setY(0).normalize();
    const side = new THREE.Vector3(-tng.z, 0, tng.x);
    const w = widths[i];
    for (let j = 0; j < across; j++) {
      const f = j / (across - 1);
      const o = (f - 0.5) * w;
      const x = p.x + side.x * o, z = p.z + side.z * o;
      pos.push(x, p.y, z);
      uv.push(flow / 2.2, (o + w / 2) / 2.2);
      dep.push(Math.max(0, depthAt(x, z, p.y)));
      acr.push(f);
      spd.push(s);
    }
    if (i) {
      const r0 = (i - 1) * across, r1 = i * across;
      for (let j = 0; j < across - 1; j++) idx.push(r0 + j, r0 + j + 1, r1 + j, r0 + j + 1, r1 + j + 1, r1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(acr, 1));
  g.setAttribute('aSpeed', new THREE.Float32BufferAttribute(spd, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

// A three.js chunk inlined with one line swapped: onBeforeCompile only sees the #include, not the chunk's text.
function chunkWith(name, from, to) {
  const src = THREE.ShaderChunk[name];
  if (!src.includes(from)) console.warn(`water: three.js chunk '${name}' has changed; patch not applied`);
  return src.replace(from, to);
}

export function createStreamMaterial(normalMap) {
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.035,
    metalness: 0,
    transmission: 1,
    ior: 1.333,
    thickness: 1,
    attenuationColor: new THREE.Color(0.28, 0.56, 0.48),
    attenuationDistance: 0.7,
    specularIntensity: 1,
    envMapIntensity: 1.1,
    normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    transparent: true,
    depthWrite: false,
  });
  patchMaterial(m);
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    shader.uniforms.uSunLight = atmo.uSunLight;
    shader.uniforms.uAmbient = atmo.uAmbient;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDepth; attribute float aAcross; attribute float aSpeed;
        varying float vWDepth; varying float vAcross; varying float vSpeed; varying vec2 vFlowUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWDepth = aDepth; vAcross = aAcross; vSpeed = aSpeed; vFlowUv = uv;
        // Gentle surface undulation (uv.x already runs faster in fast water).
        transformed.y += sin(uv.x * 5.0 - mod(uTime * 3.0, 6.2831853) + uv.y * 3.0) * 0.008 * smoothstep(0.02, 0.15, aDepth);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunLight; uniform vec3 uAmbient;
        varying float vWDepth; varying float vAcross; varying float vSpeed; varying vec2 vFlowUv;
        float foamAmt = 0.0;`)
      // After FOG_PARS_FRAG (patchMaterial), which declares uTime.
      .replace('void main() {', `${XFADE_GLSL}
void main() {`)
      // Three ripple layers scrolling down the creek. The scroll is the same everywhere, so it can wrap by whole
      // texture tiles.
      .replace('#include <normal_fragment_maps>', chunkWith('normal_fragment_maps', 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec3 n1 = texture2D(normalMap, vNormalMapUv * vec2(1.0, 1.0) + vec2(-fract(uTime * 0.27), 0.0)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, vNormalMapUv * vec2(2.1, 1.7) + vec2(-fract(uTime * 0.48), fract(uTime * 0.04))).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(normalMap, vNormalMapUv * vec2(0.42, 0.55) + vec2(-fract(uTime * 0.132), 0.31)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3(n1.xy * 0.8 + n2.xy * 0.55 + n3.xy * 0.9, 1.0));
        // Calm at the very edges.
        mapN.xy *= smoothstep(0.0, 0.08, vWDepth) * (0.6 + vSpeed * 0.8);`))
      .replace('#include <transmission_fragment>', `#include <transmission_fragment>
        {
          // Caustics dancing on the bed seen through the water.
          // Iterated-interference caustics: soft bright filaments that swim and merge.
          vec2 cp = vFogWorld.xz * 1.9 + mapN.xy * 0.2;
          vec2 ci = cp;
          float cc = 1.0;
          for (int k = 0; k < 4; k++) {
            float ct = uTime * 0.55 * (1.0 - 3.5 / float(k + 1));
            ci = cp + vec2(cos(ct - ci.x) + sin(ct + ci.y), sin(ct - ci.y) + cos(ct + ci.x));
            cc += 1.0 / length(vec2(cp.x / (sin(ci.x + ct) / 0.006), cp.y / (cos(ci.y + ct) / 0.006)));
          }
          cc /= 4.0;
          cc = 1.17 - pow(cc, 1.4);
          float caustic = clamp(pow(abs(cc), 7.0), 0.0, 1.0);
          float shallow = smoothstep(0.03, 0.12, vWDepth) * (1.0 - smoothstep(0.4, 0.9, vWDepth));
          totalDiffuse += caustic * shallow * (uSunLight * 0.06 + uAmbient * 0.08);
          // Foam: streaks carried by the current, gathering at banks and rapids.
          // Long and thin along the current (~2.7 m by 0.3 m in still water, longer where it runs fast), so fast
          // water reads as streaks, not blotches. It scrolls on the wrapped clocks, and each octave fades to its
          // mean once it gets down to a few pixels (the creek is mostly seen edge-on).
          vec2 fu = vec2(vFlowUv.x * 0.8, vAcross * 15.0);
          vec2 fwu = fwidth(fu);
          float k1 = 1.0 - smoothstep(0.15, 0.35, max(fwu.x, fwu.y));
          float k2 = 1.0 - smoothstep(0.15, 0.35, max(fwu.x * 2.7, fwu.y * 2.1));
          vec3 ck = flowClock(8.0);
          vec2 fa = fu - vec2(ck.x * 0.26, 0.0), fb = fu - vec2(ck.y * 0.26, 0.0) + vec2(5.3, 7.1);
          float sa = mix(0.5, dbNoise(fa), k1) * 0.6 + mix(0.5, dbNoise(fa * vec2(2.7, 2.1) + 11.0), k2) * 0.4;
          float sb = mix(0.5, dbNoise(fb), k1) * 0.6 + mix(0.5, dbNoise(fb * vec2(2.7, 2.1) + 11.0), k2) * 0.4;
          float streak = xfade(sa, sb, ck.z, 0.5, 1.0);
          float fs = fwidth(streak);
          float bank = 1.0 - smoothstep(0.03, 0.14, vWDepth);
          foamAmt = clamp(smoothstep(0.5 - fs, 0.75 + fs, streak) * (bank * 0.9 + vSpeed * 0.7 + 0.08) + vSpeed * smoothstep(0.45 - fs, 0.78 + fs, streak) * 0.55, 0.0, 1.0);
          vec3 foamCol = uAmbient * 2.4 + uSunLight * 0.35;
          totalDiffuse = mix(totalDiffuse, foamCol, foamAmt * 0.85);
          // Light scattering back through the body of the water.
          vec3 Vw = normalize(vFogWorld - cameraPosition);
          float scatter = pow(max(dot(Vw, uSunDir), 0.0), 4.0) * smoothstep(0.05, 0.4, vWDepth);
          totalDiffuse += vec3(0.1, 0.22, 0.16) * uSunLight * scatter * 0.25;
        }`)
      .replace('#include <opaque_fragment>', `
        diffuseColor.a *= smoothstep(0.0, 0.035, vWDepth);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'db:stream';
  return m;
}
