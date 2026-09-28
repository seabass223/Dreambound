// Shared GLSL snippets.
import { CLOUD_DECK_Y } from '../config.js';

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float fbm3o(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

// Sky radiance for a world-space direction. Needs the atmo uniforms declared.
export const SKY_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizonAway;
uniform vec3 uHorizonSun;
uniform vec3 uSunGlow;
uniform float uNight;
uniform float uTime;
uniform float uUnderground;
`;

export const SKY_FUNC_GLSL = /* glsl */ `
vec3 horizonColor(vec3 dir) {
  vec2 d2 = normalize(dir.xz + 1e-5);
  vec2 s2 = normalize(uSunDir.xz + 1e-5);
  float toward = dot(d2, s2) * 0.5 + 0.5;
  float w = pow(toward, 3.0);
  return mix(uHorizonAway, uHorizonSun, w);
}

vec3 skyGradient(vec3 dir) {
  float h = dir.y;
  vec3 hor = horizonColor(dir);
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(hor, uZenith, smoothstep(0.0, 1.0, t));
  // Belt of Venus: a pink band above the anti-solar horizon during twilight.
  float twilight = smoothstep(-0.2, -0.02, uSunDir.y) * smoothstep(0.22, 0.02, uSunDir.y);
  vec2 d2 = normalize(dir.xz + 1e-5);
  vec2 s2 = normalize(uSunDir.xz + 1e-5);
  float anti = clamp(-dot(d2, s2), 0.0, 1.0);
  float band = exp(-pow((h - 0.09) / 0.07, 2.0)) * anti * twilight;
  col += vec3(0.32, 0.14, 0.2) * band * (0.35 + 0.65 * (1.0 - uNight));
  // Earth's shadow below the band.
  col *= 1.0 - 0.3 * anti * twilight * smoothstep(0.08, 0.0, h);
  // Below the horizon: fade toward a cloud-deck haze.
  if (h < 0.0) {
    vec3 below = hor * 0.55 + uZenith * 0.12;
    col = mix(hor, below, smoothstep(0.0, -0.25, h));
  }
  return col;
}

vec3 sunAndGlow(vec3 dir) {
  float sd = max(dot(dir, uSunDir), 0.0);
  vec3 col = uSunGlow * (pow(sd, 6.0) * 0.12 + pow(sd, 48.0) * 0.5 + pow(sd, 600.0) * 3.0);
  float disk = smoothstep(0.99955, 0.99975, sd);
  float horizonFade = smoothstep(-0.03, 0.02, dir.y);
  col += uHorizonSun * disk * 40.0 * horizonFade;
  return col;
}
`;

// The scene's aerial fog for custom ShaderMaterials (waterfalls, particles), matching patchMaterial's FOG_FRAG.
// Needs NOISE_GLSL, SKY_UNIFORMS_GLSL and these uniforms (all in atmo): uFogDensity, uFogLow, uFogTint,
// uCloudColor. sceneFog returns the fogged colour; `deck` (0..1) is how far into the cloud sea the point is, so
// callers can also fade alpha (transparent things should vanish into the deck, not turn cloud-coloured).
export const SCENE_FOG_GLSL = /* glsl */ `
uniform float uFogDensity;
uniform float uFogLow;
uniform vec3 uFogTint;
uniform vec3 uCloudColor;
vec3 sceneFog(vec3 col, vec3 wp, out float deck) {
  vec3 fv = wp - cameraPosition;
  float fd = length(fv);
  vec3 fdir = fv / max(fd, 1e-4);
  float low = smoothstep(-30.0, -300.0, wp.y);
  float dens = uFogDensity * (1.0 + uFogLow * low);
  float ff = 1.0 - exp(-pow(max(dens * fd, 0.0), 1.35));
  vec3 fcol = vec3(0.0);
  if (uUnderground < 0.5) {
    vec2 d2 = normalize(fdir.xz + 1e-5);
    vec2 s2 = normalize(uSunDir.xz + 1e-5);
    float toward = pow(dot(d2, s2) * 0.5 + 0.5, 3.0);
    fcol = mix(uHorizonAway, uHorizonSun, toward) * 0.8 + uZenith * 0.12;
    fcol += uSunGlow * pow(max(dot(fdir, uSunDir), 0.0), 10.0) * 0.18;
    fcol *= uFogTint;
  }
  col = mix(col, fcol, clamp(ff, 0.0, 1.0));
  deck = 0.0;
  if (uUnderground < 0.5 && wp.y < ${(CLOUD_DECK_Y + 300).toFixed(1)}) {
    vec2 q = vec2(wp.x + wp.z * 0.6, wp.y * 1.4 + wp.z * 0.3) * 0.018 + vec2(uTime * 0.03, -uTime * 0.012);
    float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 7.1) * 0.3 + vnoise(q * 5.1 - 3.0) * 0.1;
    float y = wp.y + (n - 0.5) * 140.0;
    deck = smoothstep(${(CLOUD_DECK_Y + 250).toFixed(1)}, ${(CLOUD_DECK_Y + 90).toFixed(1)}, y);
    col = mix(col, uCloudColor, deck);
  }
  return col;
}
`;
