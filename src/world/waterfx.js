import * as THREE from 'three';
import { atmo } from '../render/atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL, SCENE_FOG_GLSL } from '../render/glsl.js';
import { Textures } from '../render/textures.js';
import { Rng } from '../core/rng.js';
import { AFBM_GLSL } from './water.js';

// GPU water particles (splash droplets, spray mist, pool haze, the spray down the edge fall) plus a pool foam
// decal. Each particle effect is one instanced quad draw. Motion is closed-form in the vertex shader from uTime:
// every particle loops over its lifetime and re-randomises per cycle from hash(id, cycle), so the CPU never
// touches them. Lighting and fog are per particle (vertex), fragments only shape the sprite. The foam is one flat
// decal animated in its fragment shader. Output is premultiplied over.

const PATH_N = 48;

const VERT_COMMON = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform vec3 uSunLight;
uniform vec3 uAmbient;
uniform vec2 uWind;
uniform float uPxH;
uniform float uOpacity;
uniform vec2 uFar;       // zoom-aware distance band (m) over which the effect fades out; matches its LOD band
${NOISE_GLSL}
${SKY_FUNC_GLSL}
${SCENE_FOG_GLSL}
vec3 camRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
vec3 camUp() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
vec3 camFwd() { return -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); }
// Distance scaled by the telescope's zoom, as LodSystem measures it (1 / tan(34 deg) = 0.6745 at the normal FOV).
float effDist(vec3 P) { return length(P - cameraPosition) / max(projectionMatrix[1][1] * 0.6745, 1e-3); }
// Fades out before LodSystem hides the mesh (registered with fade: false), so there is no pop.
float farFade(vec3 P) { return 1.0 - smoothstep(uFar.x, uFar.y, effDist(P)); }
// Drawing-buffer pixels per metre at P (follows dpr and the telescope's FOV).
float pxPerM(vec3 P) {
  float z = max(dot(P - cameraPosition, camFwd()), 0.05);
  return 0.5 * max(uPxH, 1.0) * projectionMatrix[1][1] / z;
}
// Uniform hash per particle id, loop cycle (kept < 4096) and salt.
float rnd(float id, float k, float salt) { return hash13(vec3(id, k, salt)); }
// Exact linear-drag motion relaxing from v0 toward the terminal velocity vInf.
vec3 dragPos(vec3 p0, vec3 v0, vec3 vInf, float kd, float t) {
  return p0 + vInf * t + (v0 - vInf) * (1.0 - exp(-kd * t)) / kd;
}
vec3 dragVel(vec3 v0, vec3 vInf, float kd, float t) { return vInf + (v0 - vInf) * exp(-kd * t); }
// Sun visibility past a vertical rock face through W (horizontal outward normal N, top at topY); there is no
// shadow map for shader materials.
float wallSun(vec3 P, vec3 W, vec3 N, float topY) {
  float tw = dot(N.xz, uSunDir.xz);
  if (tw >= 0.0) return 1.0;
  float w = max(dot(P.xz - W.xz, N.xz), 0.05);
  float rise = uSunDir.y * w / max(-tw, 1e-3);
  return smoothstep(-2.0, 2.0, P.y + rise - topY);
}
// Light scattered toward the eye by spray: cool sky in shade, sun, a warm forward lobe toward the sun, moon.
vec3 mistLight(vec3 V, float sunVis, float dens) {
  float mu = max(dot(V, uSunDir), 0.0);
  float fwd = pow(mu, 6.0) * 0.5 + pow(mu, 32.0);
  vec3 sky = mix(horizonColor(V), uZenith, 0.35) * 0.55 + uAmbient * 1.3;
  vec3 sun = uSunLight * sunVis * (0.1 + 0.05 * (1.0 - dens));
  vec3 glow = (uSunGlow * 0.9 + uSunLight * 0.05) * fwd * sunVis * (1.0 - 0.6 * dens);
  float mv = uNight * clamp(uMoonDir.y * 3.0, 0.0, 1.0);
  vec3 moon = vec3(0.32, 0.4, 0.62) * mv * (0.12 + 0.5 * pow(max(dot(V, uMoonDir), 0.0), 8.0));
  return sky + sun + glow + moon;
}
// White water, kept just under the bloom threshold at noon.
vec3 foamLight(vec3 V, float sunVis) {
  float mv = uNight * clamp(uMoonDir.y * 3.0, 0.0, 1.0);
  return uAmbient * 1.8 + uSunLight * sunVis * 0.16 + horizonColor(V) * 0.1 + vec3(0.32, 0.4, 0.62) * mv * 0.15;
}
`;

// Shared camera-facing puff for mist, haze and fall spray (with PUFF_FRAG).
const PUFF_VERT = /* glsl */ `
${VERT_COMMON}
uniform vec2 uNear;      // screen-height fraction over which a puff fades out as it grows to fill the view
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vCol;
varying float vAlpha;
varying vec3 vSoft;      // water/ground-plane softness (m), wall softness (m), wall plane offset along vWallN
varying vec3 vWallN;     // soft-fade plane normal: the rock face, tilted to follow its lean
varying vec3 vBow;
// A puff of radius R at P; squash < 1 flattens it in world y (a pancake seen from above is still round).
void emitPuff(vec3 P, float R, float squash, float rot, float a, float sunVis, float dens, float bow) {
  vec3 toP = P - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / max(dist, 1e-4);
  float ppm = pxPerM(P);
  // At least ~1.5 px across, with alpha scaled so the covered energy stays the same.
  float Rs = max(R, 0.75 / ppm);
  a *= (R / Rs) * (R / Rs);
  // Screen-filling and camera-enclosing puffs fade and collapse: they cost fill and show sprite planes.
  a *= 1.0 - smoothstep(uNear.x, uNear.y, Rs * ppm / max(uPxH, 1.0));
  vec3 de = toP;
  de.y /= squash;
  a *= smoothstep(Rs * 0.35, Rs * 1.1, length(de));
  float deck;
  vec3 col = sceneFog(mistLight(V, sunVis, dens), P, deck);
  a = clamp(a * (1.0 - deck) * farFade(P) * uOpacity, 0.0, 1.0);
  if (a < 0.004) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float cr = cos(rot), sr = sin(rot);
  vec2 q = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * 2.0 * Rs;
  vec3 off = camRight() * q.x + camUp() * q.y;
  off.y *= squash;
  vWorld = P + off;
  vUv = uv;
  vCol = col;
  vAlpha = a;
  vBow = uSunLight * sunVis * bow * (1.0 - deck);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform vec4 uWallN;
uniform vec4 uPlanes;    // water/ground y, near-camera fade start and end (m), basin radius round uPos (0: none)
uniform vec3 uPos;       // unset for the fall spray (three skips uniforms a material lacks; w is 0 there)
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vCol;
varying float vAlpha;
varying vec3 vSoft;
varying vec3 vWallN;
varying vec3 vBow;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  // The analytic window guarantees no sprite edge whatever the texture does near its border.
  float a = texture2D(uMap, vUv).a * (1.0 - smoothstep(0.55, 1.0, length(q))) * vAlpha;
  a *= smoothstep(0.0, vSoft.x, vWorld.y - uPlanes.x);
  if (uWallN.w > 0.5) a *= smoothstep(0.0, vSoft.y, dot(vWorld, vWallN) - vSoft.z);
  // Kept over the basin: past it the banks rise above the water plane and would cut the quads.
  if (uPlanes.w > 0.0) a *= 1.0 - smoothstep(0.6, 1.0, length(vWorld.xz - uPos.xz) / uPlanes.w);
  vec3 dv = vWorld - cameraPosition;
  float fd = length(dv);
  a *= smoothstep(uPlanes.y, uPlanes.z, fd);
  a = clamp(a, 0.0, 1.0);
  if (a < 0.003) discard;
  // Faint primary rainbow 40.7-42.4 deg from the anti-solar point, red outside.
  float c = dot(dv, -uSunDir) / max(fd, 1e-4);
  vec3 bow = max(vec3(0.0), 1.0 - abs((c - 0.738) / 0.022 - vec3(0.15, 0.5, 0.85)) * 3.5);
  gl_FragColor = vec4((vCol + bow * vBow) * a, a);
}
`;

const SPLASH_VERT = /* glsl */ `
${VERT_COMMON}
uniform vec3 uPos;
uniform vec4 uSplash;    // radius, sqrt(strength), shutter (s), unused
uniform vec4 uWallN;     // outward normal of the rock behind the splash, 1 if there is one
uniform vec4 uWallP;     // point on the rock face, top of the face (y)
attribute vec4 aP;       // id, life (s), phase, kind (0 droplet, 1 foam fleck)
attribute vec4 aS;       // size (m), alpha, unused, unused
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vGlint;
varying float vAlpha;
varying float vKind;
void main() {
  float cyc = uTime / aP.y + aP.z;
  float k = mod(floor(cyc), 4096.0);
  float t01 = fract(cyc);
  float age = t01 * aP.y;
  float id = aP.x;
  float h1 = rnd(id, k, 1.0), h2 = rnd(id, k, 2.0), h3 = rnd(id, k, 3.0), h4 = rnd(id, k, 4.0), h5 = rnd(id, k, 5.0);
  vec3 N = uWallN.xyz * uWallN.w;
  float ang = h1 * 6.2832;
  vec3 dir = vec3(cos(ang), 0.0, sin(ang));
  // Spray thrown at the rock bounces back out.
  dir -= N * min(dot(dir, N), 0.0) * 1.6;
  vec3 wind = vec3(uWind.x, 0.0, uWind.y);
  float R = uSplash.x, st = uSplash.y;
  float droplet = step(aP.w, 0.5);
  vec3 P, wp;
  float a = aS.y, e, g = 0.0;
  if (droplet > 0.5) {
    float rr = sqrt(h2) * R * 0.5;
    vec3 p0 = uPos + dir * rr + vec3(0.0, 0.03, 0.0);
    vec3 v0 = dir * mix(0.5, 3.0, h3) * st + N + vec3(0.0, mix(2.0, 6.0, h4) * st * (1.0 - 0.4 * rr / R), 0.0);
    vec3 vInf = wind * 0.5 + vec3(0.0, -9.8 / 0.6, 0.0);
    P = dragPos(p0, v0, vInf, 0.6, age);
    vec3 vel = dragVel(v0, vInf, 0.6, age);
    g = smoothstep(0.0, 0.04, t01) * (1.0 - smoothstep(0.8, 1.0, t01)) * step(uPos.y, P.y);
    if (uWallN.w > 0.5) g *= smoothstep(0.0, 0.3, dot(P - uWallP.xyz, N));
    a *= g;
    // Streak along the screen-projected velocity, as long as the shutter smears it.
    vec3 F = camFwd();
    vec3 vp = vel - dot(vel, F) * F;
    float sp = length(vp);
    vec3 ax = sp > 1e-4 ? vp / sp : camUp();
    vec3 sd = cross(ax, F);
    float ppm = pxPerM(P);
    float w0 = aS.x;
    float len0 = w0 + sp * uSplash.z;
    float w = max(w0, 1.5 / ppm);
    float len = max(len0, w);
    e = clamp(w0 / len0, 0.15, 1.0) * (w0 * len0) / (w * len);
    wp = P + sd * position.x * w + ax * position.y * len;
  } else {
    // Foam flecks skate out over the surface, slowing and curling a little.
    float r = sqrt(h2) * R * 0.6 + mix(0.6, 2.2, h3) * st * (1.0 - exp(-0.9 * age)) / 0.9;
    float sw = (h4 - 0.5) * 0.5 * age;
    vec2 d2 = normalize(dir.xz);
    d2 = vec2(d2.x * cos(sw) - d2.y * sin(sw), d2.x * sin(sw) + d2.y * cos(sw));
    P = vec3(uPos.x + d2.x * r, uPos.y + 0.015, uPos.z + d2.y * r) + wind * age * 0.15;
    a *= smoothstep(0.0, 0.1, t01) * (1.0 - smoothstep(0.55, 1.0, t01)) * (1.0 - smoothstep(R * 1.3, R * 2.0, r));
    // Flat on the water, facing the camera's heading; widened when seen edge-on so it never goes sub-pixel.
    vec3 tc = P - cameraPosition;
    float el = max(abs(tc.y) / max(length(tc), 1e-4), 0.15);
    vec2 fh = camFwd().xz;
    float fl = length(fh);
    fh = fl > 1e-4 ? fh / fl : vec2(0.0, 1.0);
    float ppm = pxPerM(P);
    float s0 = aS.x;
    float sx = max(s0, 1.5 / ppm), sy = max(s0, 1.5 / (ppm * el));
    e = s0 * s0 / (sx * sy);
    wp = P + vec3(-fh.y, 0.0, fh.x) * position.x * sx + vec3(fh.x, 0.0, fh.y) * position.y * sy;
  }
  vec3 toP = P - cameraPosition;
  float dist = length(toP);
  vec3 V = toP / max(dist, 1e-4);
  float near = smoothstep(0.15, 0.6, dist);
  float sunVis = uWallN.w > 0.5 ? wallSun(P, uWallP.xyz, N, uWallP.w) : 1.0;
  float deck;
  vec3 col = sceneFog(droplet > 0.5 ? mistLight(V, sunVis, 1.0) : foamLight(V, sunVis), P, deck);
  float env = near * (1.0 - deck) * farFade(P) * uOpacity;
  a = clamp(a * env * e, 0.0, 1.0);
  if (a < 1e-3) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // Droplets twinkle toward the sun (refraction) and faintly from every side; added as light, not coverage.
  float mu = max(dot(V, uSunDir), 0.0);
  float tw = step(0.55, rnd(id, k, floor(age * 24.0) + 9.0));
  vGlint = uSunLight * sunVis * (pow(mu, 20.0) * 0.3 + 0.03) * tw * g * e * env;
  vUv = uv;
  vCol = col;
  vAlpha = a;
  vKind = aP.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vGlint;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float shape = vKind < 0.5 ? (1.0 - q.x * q.x) * (1.0 - smoothstep(0.4, 1.0, abs(q.y))) : 1.0 - smoothstep(0.3, 1.0, length(q));
  float a = clamp(vAlpha * shape, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a + vGlint * shape, a);
}
`;

const MIST_VERT = /* glsl */ `
${PUFF_VERT}
uniform vec3 uPos;
uniform vec4 uMist;      // final radius, unused x3
uniform vec3 uDrift;
uniform vec3 uChute[8];  // emitters up the cascade, bottom first
uniform vec4 uWallN;
uniform vec4 uWallP;
attribute vec4 aP;       // id, life (s), phase, size scale
attribute vec4 aS;       // alpha, rotation, spin, unused
void main() {
  float cyc = uTime / aP.y + aP.z;
  float k = mod(floor(cyc), 4096.0);
  float t01 = fract(cyc);
  float age = t01 * aP.y;
  float id = aP.x;
  float h1 = rnd(id, k, 1.0), h2 = rnd(id, k, 2.0), h3 = rnd(id, k, 3.0), h4 = rnd(id, k, 4.0), h5 = rnd(id, k, 5.0);
  vec3 N = uWallN.xyz * uWallN.w;
  float ang = h2 * 6.2832;
  vec3 dir = vec3(cos(ang), 0.0, sin(ang));
  dir -= N * min(dot(dir, N), 0.0) * 1.6;
  vec3 e0, v0, W, Nw = N;
  if (h1 < 0.5) {
    // Blasted out of the plunge point.
    e0 = uPos + dir * h3 * uMist.x * 0.3 + vec3(0.0, 0.25, 0.0);
    v0 = dir * mix(1.0, 3.5, h4) + vec3(0.0, mix(0.4, 2.0, h5), 0.0);
    W = uWallP.xyz;
  } else {
    // Peeled off the falling water up the chute: dragged down, then lifted by buoyancy.
    float f = h3 * 6.999;
    int i = int(f);
    vec3 c = mix(uChute[i], uChute[i + 1], f - float(i));
    e0 = c + N * mix(0.2, 0.9, h4) + (dir - N * dot(dir, N)) * 0.5;
    v0 = N * mix(0.4, 1.5, h5) - vec3(0.0, mix(0.3, 1.5, h4), 0.0);
    // The cascade runs ~0.26 m off a face that leans back going up: the fade plane sits just in front of the
    // rock and tilts with the local chute segment, so quads reach zero before they cut into it.
    vec3 T = uChute[i + 1] - uChute[i];
    float lean = clamp(-dot(T, N) / max(abs(T.y), 1e-3), -1.0, 1.0);
    Nw = N + vec3(0.0, lean, 0.0);
    Nw /= max(length(Nw), 1e-4);
    W = c - N * 0.15;
  }
  vec3 vInf = vec3(uWind.x, 0.0, uWind.y) * 0.6 + uDrift + vec3(0.0, 0.5 / 2.5, 0.0);
  vec3 P = dragPos(e0, v0, vInf, 2.5, age);
  float R = mix(0.4, uMist.x, pow(t01, 0.8)) * aP.w;
  // Thinned out before it is fully grown: the widest, faintest stage is where the fill cost is.
  float a = aS.x * smoothstep(0.0, 0.12, t01) * (1.0 - smoothstep(0.4, 0.9, t01));
  float sunVis = uWallN.w > 0.5 ? wallSun(P, W, N, uWallP.w) : 1.0;
  vSoft = vec3(0.35 * R, 0.5 * R, dot(W, Nw));
  vWallN = Nw;
  emitPuff(P, R, 1.0, aS.y + aS.z * age, a, sunVis, 0.3, 0.05);
}
`;

const HAZE_VERT = /* glsl */ `
${PUFF_VERT}
uniform vec3 uPos;
uniform vec4 uWallN;     // outward normal of the rock beside the pool, 1 if there is one
uniform vec4 uWallP;     // point on the rock face, top of the face (y)
attribute vec4 aP;       // id, size (m, full width), phase, alpha
attribute vec4 aS;       // offset from uPos (xyz), wander speed
void main() {
  float ph = aP.z * 6.2832;
  float sp = aS.w;
  // Slow closed loops; bounded, so it is safe to feed uTime straight in.
  vec3 c = uPos + aS.xyz + vec3(sin(uTime * 0.05 * sp + ph) * 2.0, 0.2 * sin(uTime * 0.11 * sp + ph * 1.7), cos(uTime * 0.04 * sp + ph * 1.3) * 2.0);
  c += vec3(uWind.x, 0.0, uWind.y) * 0.8;
  float R = aP.y * 0.5 * (0.9 + 0.1 * sin(uTime * 0.07 + ph));
  float a = aP.w * (0.65 + 0.35 * sin(uTime * 0.06 * sp + ph * 2.3));
  // Low sun rakes through it and shows more of it.
  a *= 1.0 + 0.6 * (1.0 - smoothstep(0.08, 0.35, uSunDir.y));
  vSoft = vec3(R * 0.3, R * 0.5, dot(uWallP.xyz, uWallN.xyz));
  vWallN = uWallN.xyz;
  float sunVis = uWallN.w > 0.5 ? wallSun(c, uWallP.xyz, uWallN.xyz, uWallP.w) : 1.0;
  emitPuff(c, R, 0.38, ph + uTime * 0.01 * (sp - 1.0), a, sunVis, 0.5, 0.0);
}
`;

const FALL_VERT = /* glsl */ `
${PUFF_VERT}
uniform vec4 uPath[${PATH_N}];  // centreline (xyz) and sheet width, evenly spaced by arc length from the lip
uniform vec4 uFall;      // sample spacing (m), path length (m), lip top y, unused
uniform vec4 uWallN;     // outward cliff normal, 1
uniform vec3 uSide;
attribute vec4 aP;       // id, life (s), phase, kind (0 fall mist, 1 lip spray)
attribute vec4 aS;       // size scale, alpha, rotation, spin (rad/s)
vec4 pathAt(float s) {
  float f = clamp(s / uFall.x, 0.0, ${(PATH_N - 1.001).toFixed(3)});
  int i = int(f);
  return mix(uPath[i], uPath[i + 1], f - float(i));
}
void main() {
  float cyc = uTime / aP.y + aP.z;
  float k = mod(floor(cyc), 4096.0);
  float t01 = fract(cyc);
  float age = t01 * aP.y;
  float id = aP.x;
  float h1 = rnd(id, k, 1.0), h2 = rnd(id, k, 2.0), h3 = rnd(id, k, 3.0), h4 = rnd(id, k, 4.0), h5 = rnd(id, k, 5.0);
  vec3 N = uWallN.xyz;
  vec3 wind = vec3(uWind.x, 0.0, uWind.y);
  float L = uFall.y;
  vec3 P, W;
  float R, a, dens;
  if (aP.w < 0.5) {
    // Born more often the further down the water has broken up, then carried down and billowing out.
    float s = mix(10.0, L * 0.8, sqrt(h1)) + mix(4.0, 10.0, h2) * age;
    vec4 c = pathAt(s);
    float lat = (h5 - 0.5) * (c.w * 1.2 + age * 0.8);
    P = c.xyz + N * (mix(0.3, 2.0, h3) + mix(0.5, 1.5, h4) * age) + uSide * lat + wind * age * 0.5;
    R = mix(2.0, 10.0, pow(t01, 0.7)) * aS.x;
    a = aS.y * smoothstep(10.0, 60.0, s) * smoothstep(0.0, 0.15, t01) * (1.0 - smoothstep(0.55, 1.0, t01));
    a *= 1.0 - smoothstep(L - 35.0, L, s);
    W = c.xyz - N;
    dens = 0.3;
  } else {
    // Spray flung off the lip.
    vec4 c = pathAt(h1 * 3.0);
    vec3 e0 = c.xyz + uSide * (h2 - 0.5) * c.w + N * 0.3;
    vec3 v0 = N * mix(1.0, 3.5, h3) + uSide * (h4 - 0.5) * 2.0 + vec3(0.0, mix(-0.5, 1.5, h5), 0.0);
    vec3 vInf = wind * 0.6 + vec3(0.0, -9.8 / 0.9, 0.0);
    P = dragPos(e0, v0, vInf, 0.9, age);
    R = mix(0.1, 0.6, t01) * aS.x;
    a = aS.y * smoothstep(0.0, 0.08, t01) * (1.0 - smoothstep(0.5, 1.0, t01));
    W = c.xyz - N;
    dens = 0.6;
  }
  // Zoom-aware distance: from the other stacks keep puffs smaller and thinner so the column keeps its shape.
  float far = smoothstep(150.0, 500.0, effDist(P));
  R *= mix(1.0, 0.75, far);
  a *= mix(1.0, 0.7, far);
  vSoft = vec3(1.0, 0.5 * R, dot(W, N));
  vWallN = N;
  emitPuff(P, R, 1.0, aS.z + aS.w * age, a, wallSun(P, W, N, uFall.z), dens, 0.05);
}
`;

const FOAM_VERT = /* glsl */ `
${VERT_COMMON}
uniform vec4 uWallN;
uniform vec4 uWallP;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vDetail;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  vec3 toP = w.xyz - cameraPosition;
  float dist = length(toP);
  float sunVis = uWallN.w > 0.5 ? wallSun(w.xyz, uWallP.xyz, uWallN.xyz, uWallP.w) : 1.0;
  float deck;
  vCol = sceneFog(foamLight(toP / max(dist, 1e-4), sunVis), w.xyz, deck);
  vAlpha = (1.0 - deck) * farFade(w.xyz) * uOpacity;
  // Fine noise would shimmer from afar (no AA): fade it to its mean.
  vDetail = 1.0 - smoothstep(40.0, 120.0, effDist(w.xyz));
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FOAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uImpact;
uniform float uFoamR;
varying vec3 vWorld;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vDetail;
${NOISE_GLSL}
${AFBM_GLSL}
void main() {
  vec2 p = vWorld.xz - uImpact.xz;
  float r = length(p);
  vec2 dir = p / max(r, 1e-3);
  // Two noise layers advected radially outward, cross-faded so neither ever visibly resets.
  float ph = uTime * 0.5;
  float t1 = fract(ph), t2 = fract(ph + 0.5);
  float w1 = 1.0 - abs(2.0 * t1 - 1.0);
  vec2 q = p * 1.7;
  // Noise units per pixel: seen edge-on, the decal's octaves get down to a pixel well inside vDetail's range.
  float fw = max(length(dFdx(q)), length(dFdy(q)));
  float n = mix(afbm(q - dir * t2 * 1.6 + 17.3, fw), afbm(q - dir * t1 * 1.6 + 3.1, fw), w1);
  n = 0.44 + (n - 0.44) / sqrt(w1 * w1 + (1.0 - w1) * (1.0 - w1));
  n = mix(0.44, n, vDetail);
  float rn = r / uFoamR;
  float churn = 1.0 - smoothstep(0.05, 0.4, rn);
  float thr = mix(0.32, 0.6, smoothstep(0.1, 1.0, rn));
  float fn = fwidth(n);
  float cov = max(churn, smoothstep(thr - fn, thr + 0.16 + fn, n));
  float rim = (1.0 - smoothstep(0.5, 1.0, rn + (n - 0.44) * 0.6)) * (1.0 - smoothstep(0.8, 1.0, length(vUv * 2.0 - 1.0)));
  float a = clamp(cov * rim * mix(0.55, 0.9, churn) * vAlpha, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * mix(0.85, 1.05, churn) * a, a);
}
`;

function fxMaterial(name, vertexShader, fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    name,
    // The shared atmo objects by reference (time, sun, fog), plus this effect's own. uFar defaults to the LOD
    // band rocks.js registers the pool effects with.
    uniforms: { ...atmo, uOpacity: { value: 1 }, uFar: { value: new THREE.Vector2(110, 150) }, ...uniforms },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// One quad per particle. The geometry's own bounds would be the unit quad at the origin, so culling, sorting
// and the LOD system get the real extent instead.
function particleMesh(name, aP, aS, material, sphere, renderOrder) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.deleteAttribute('normal');
  geo.instanceCount = aP.length / 4;
  geo.setAttribute('aP', new THREE.InstancedBufferAttribute(aP, 4));
  geo.setAttribute('aS', new THREE.InstancedBufferAttribute(aS, 4));
  geo.boundingSphere = sphere;
  geo.boundingBox = new THREE.Box3().setFromCenterAndSize(sphere.center, new THREE.Vector3().setScalar(sphere.radius * 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

// Horizontal unit normal (or null) and the wall uniforms for a rock face `dist` behind `pos`, `top` above it.
function wallUniforms(pos, normal, dist, top) {
  const n = normal ? new THREE.Vector3(normal.x, 0, normal.z) : new THREE.Vector3();
  const has = n.lengthSq() > 1e-8;
  if (has) n.normalize();
  const p = pos.clone().addScaledVector(n, -dist);
  return {
    n: has ? n : null,
    uniforms: {
      uWallN: { value: new THREE.Vector4(n.x, 0, n.z, has ? 1 : 0) },
      uWallP: { value: new THREE.Vector4(p.x, p.y, p.z, pos.y + top) },
    },
  };
}

// Droplets thrown up and out where the cascade hits the pool (pos: impact point on the water surface, which is
// also the kill plane), plus ~20% foam flecks skating outward on the surface.
export function splashFX({ pos, radius = 1.6, strength = 1, count = 900, wallNormal = null, wallDist = 1, wallTop = 11 }) {
  const rng = new Rng(4101);
  const aP = new Float32Array(count * 4), aS = new Float32Array(count * 4);
  const flecks = Math.round(count * 0.2);
  for (let i = 0; i < count; i++) {
    const fleck = i < flecks;
    aP.set([i, fleck ? rng.float(2.5, 5) : rng.float(0.6, 1.6), rng.next(), fleck ? 1 : 0], i * 4);
    aS.set([fleck ? rng.float(0.04, 0.12) : rng.float(0.015, 0.04), fleck ? rng.float(0.35, 0.6) : rng.float(0.5, 0.7), 0, 0], i * 4);
  }
  const R = Math.max(radius, 0.1);
  const wall = wallUniforms(pos, wallNormal, wallDist, wallTop);
  const mat = fxMaterial('waterfx:splash', SPLASH_VERT, SPLASH_FRAG, {
    uPos: { value: pos.clone() },
    uSplash: { value: new THREE.Vector4(R, Math.sqrt(Math.max(strength, 0)), 1 / 40, 0) },
    ...wall.uniforms,
  });
  const sphere = new THREE.Sphere(pos.clone().setY(pos.y + 1), R * 2.2 + 4);
  return particleMesh('splash', aP, aS, mat, sphere, 4.4);
}

// Point on a polyline at height y (by its vertical extent), or the nearer end if y is outside it.
function atHeight(line, y, out) {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (Math.abs(b.y - a.y) > 1e-6 && (y - a.y) * (y - b.y) <= 0) return out.lerpVectors(a, b, (y - a.y) / (b.y - a.y));
  }
  const lo = line.reduce((m, p) => (p.y < m.y ? p : m)), hi = line.reduce((m, p) => (p.y > m.y ? p : m));
  return out.copy(Math.abs(y - lo.y) < Math.abs(y - hi.y) ? lo : hi);
}

// Spray and mist puffs at the plunge point and up the chute. pos: impact point on the water (the water plane).
// chute: optional cascade centreline; without it the chute leans back into the rock above pos.
export function mistFX({ pos, radius = 3, height = 7, count = 120, drift = new THREE.Vector3(0.25, 0, 0), wallNormal = null, chute = null, wallDist = 1, wallTop = 11 }) {
  const rng = new Rng(4202);
  const aP = new Float32Array(count * 4), aS = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    aP.set([i, rng.float(3, 7), rng.next(), rng.float(0.6, 1.1)], i * 4);
    aS.set([rng.float(0.08, 0.18), rng.float(0, Math.PI * 2), rng.float(-0.25, 0.25), 0], i * 4);
  }
  const wall = wallUniforms(pos, wallNormal, wallDist, wallTop);
  const emit = [];
  for (let j = 0; j < 8; j++) {
    const h = (height * j) / 7;
    if (chute && chute.length > 1) emit.push(atHeight(chute, pos.y + h, new THREE.Vector3()));
    else {
      const p = pos.clone().setY(pos.y + h);
      if (wall.n) p.addScaledVector(wall.n, -h * 0.25);
      emit.push(p);
    }
  }
  const mat = fxMaterial('waterfx:mist', MIST_VERT, PUFF_FRAG, {
    uMap: { value: Textures.puff() },
    uNear: { value: new THREE.Vector2(0.18, 0.4) },
    uPlanes: { value: new THREE.Vector4(pos.y, 0.4, 2.5, 0) },
    uPos: { value: pos.clone() },
    uMist: { value: new THREE.Vector4(radius, 0, 0, 0) },
    uDrift: { value: new THREE.Vector3(drift.x, drift.y, drift.z) },
    uChute: { value: emit },
    ...wall.uniforms,
  });
  const sphere = new THREE.Sphere(pos.clone().setY(pos.y + height * 0.5), height * 0.5 + radius * 2 + 6);
  return particleMesh('mist', aP, aS, mat, sphere, 4.2);
}

// Very large, faint, flattened puffs wandering over the pool; soft against the water plane at pos.y - 0.5 and
// the rock face (wallNormal, `wallDist` behind pos, `wallTop` above it), and faded out towards `radius`.
export function hazeFX({ pos, radius = 8, height = 2.2, count = 18, wallNormal = null, wallDist = 1, wallTop = 11 }) {
  const rng = new Rng(4303);
  const aP = new Float32Array(count * 4), aS = new Float32Array(count * 4);
  const R = Math.max(radius, 0.1);
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * R * 0.85, size = rng.float(4, 12);
    // Big puffs sit nearer the centre so they stay inside the radial fade.
    const r = Math.min(d, Math.max(R - size / 2, 0));
    aP.set([i, size, rng.next(), rng.float(0.03, 0.07)], i * 4);
    aS.set([Math.cos(a) * r, rng.float(0.2, 0.6) * height, Math.sin(a) * r, rng.float(0.6, 1.4)], i * 4);
  }
  const wall = wallUniforms(pos, wallNormal, wallDist, wallTop);
  const mat = fxMaterial('waterfx:haze', HAZE_VERT, PUFF_FRAG, {
    uMap: { value: Textures.puff() },
    uNear: { value: new THREE.Vector2(0.35, 0.7) },
    uPlanes: { value: new THREE.Vector4(pos.y - 0.5, 0.5, 6, R) },
    uPos: { value: pos.clone() },
    ...wall.uniforms,
  });
  const sphere = new THREE.Sphere(pos.clone().setY(pos.y + height * 0.5), radius + 10);
  return particleMesh('haze', aP, aS, mat, sphere, 4.3);
}

// Flat foam decal on the pool, brightest where the cascade lands (impact, default the centre) and scrolling
// outward to a ragged rim. pos: pool centre at the water surface.
export function poolFoamFX({ pos, radius = 3.2, impact = pos, wallNormal = null, wallDist = 1, wallTop = 11 }) {
  const reach = radius + Math.hypot(impact.x - pos.x, impact.z - pos.z);
  const geo = new THREE.CircleGeometry(reach, 40).rotateX(-Math.PI / 2).translate(pos.x, pos.y + 0.02, pos.z);
  geo.deleteAttribute('normal');
  const wall = wallUniforms(impact, wallNormal, wallDist, wallTop);
  const mat = fxMaterial('waterfx:poolFoam', FOAM_VERT, FOAM_FRAG, {
    uImpact: { value: impact.clone() },
    uFoamR: { value: radius },
    ...wall.uniforms,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pool foam';
  mesh.renderOrder = 3.5;
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

// The path resampled to PATH_N points evenly spaced by arc length: Vector4(x, y, z, width).
function resamplePath(path, widths, n) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < path.length - 2 && cum[j + 1] < s) j++;
    const f = Math.min(1, Math.max(0, (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-6)));
    const a = path[j], b = path[j + 1];
    const wa = widths?.[j] ?? 3, wb = widths?.[j + 1] ?? wa;
    out.push(new THREE.Vector4(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f, wa + (wb - wa) * f));
  }
  return { points: out, total };
}

// Mist and lip spray down the long free fall off the stack edge. path: centreline top-first (edgeWaterfall's
// userData.path), widths per point. normal: horizontal outward direction of the fall; derived from the path's
// drift away from the cliff when omitted.
export function fallSprayFX({ path, widths, count = 260, normal = null }) {
  const { points, total } = resamplePath(path, widths, PATH_N);
  const top = path[0], end = path[path.length - 1];
  const n = normal ? new THREE.Vector3(normal.x, 0, normal.z) : new THREE.Vector3(end.x - top.x, 0, end.z - top.z);
  if (n.lengthSq() < 1e-6) n.set(path[1].x - top.x, 0, path[1].z - top.z);
  if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
  n.normalize();
  const side = new THREE.Vector3(-n.z, 0, n.x);

  const rng = new Rng(4505);
  const aP = new Float32Array(count * 4), aS = new Float32Array(count * 4);
  const lip = Math.min(count, Math.max(60, Math.min(120, Math.round(count * 0.3))));
  for (let i = 0; i < count; i++) {
    const spray = i < lip;
    aP.set([i, spray ? rng.float(1, 2.5) : rng.float(6, 12), rng.next(), spray ? 1 : 0], i * 4);
    aS.set([rng.float(0.8, 1.2), spray ? rng.float(0.18, 0.35) : rng.float(0.06, 0.14), rng.float(0, Math.PI * 2), rng.float(-0.15, 0.15)], i * 4);
  }
  const mat = fxMaterial('waterfx:fallSpray', FALL_VERT, PUFF_FRAG, {
    uMap: { value: Textures.puff() },
    uNear: { value: new THREE.Vector2(0.3, 0.6) },
    uPlanes: { value: new THREE.Vector4(-1e5, 0.5, 4, 0) },
    // A landmark seen from the other stacks and never LOD'd: no far fade.
    uFar: { value: new THREE.Vector2(1e5, 2e5) },
    uPath: { value: points },
    uFall: { value: new THREE.Vector4(Math.max(total, 1) / (PATH_N - 1), total, top.y + 1.5, 0) },
    uWallN: { value: new THREE.Vector4(n.x, 0, n.z, 1) },
    uSide: { value: side },
  });
  const box = new THREE.Box3().setFromPoints(path).expandByScalar(30);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return particleMesh('fall spray', aP, aS, mat, sphere, 4.15);
}
