import * as THREE from 'three';
import { once } from './textures.js';
import { MOON_MAP_SIZE, MOON_EXT, MOON_SLOPE, MOON_HMAX, buildMoonData } from './moonMapGen.js';

// The moon: a lit sphere drawn in the sky shader (render/sky.js, MOON_GLSL below), with a procedural near-side map
// (render/moonMapGen.js: albedo, crater slopes and heights).
//
// The map is made by a worker (moonMap.worker.js) from the moment the sky is made (main.js makes the sky before the
// models' download and the world build, which keep the main thread busy for seconds meanwhile), so it costs the page
// nothing. If its pixels aren't back when the texture is first uploaded (the preloader's textures phase,
// render/preload.js), or there is no worker, they are made right then on the main thread. Either way it is on the GPU,
// mipmapped, before wake-up and never costs a frame in play.

export const MOON_RADIUS_DEG = 1.1;   // apparent radius: 2.2 deg across (the real moon is 0.52); 0.88 of the eyepiece
export { MOON_MAP_SIZE, MOON_EXT, MOON_SLOPE, MOON_HMAX };

// The map as a texture (made once). userData.made says when its pixels were ready (ms after navigation) and how:
// 'worker', or 'upload' (made on the main thread when the first upload asked for them, taking `ms`).
export const moonMap = () => once('moonMap', () => {
  const N = MOON_MAP_SIZE;
  const t = new THREE.DataTexture(null, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  let data = null, worker = null;
  const done = (d, by, ms = 0) => {
    data = d;
    t.userData.made = { at: Math.round(performance.now()), by, ms };
    worker?.terminate();
    worker = null;
  };
  try {
    worker = new Worker(new URL('./moonMap.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { if (!data) done(new Uint8Array(e.data), 'worker'); };
    worker.onerror = () => { worker?.terminate(); worker = null; };
    worker.postMessage(0);
  } catch { worker = null; }
  // three.js reads image.data when it uploads the texture: if the worker isn't done, the pixels are made then.
  t.image = {
    width: N, height: N,
    get data() { if (!data) { const t0 = performance.now(); done(buildMoonData(), 'upload', Math.round(performance.now() - t0)); } return data; },
  };
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  t.name = 'moonMap';
  return t;
});

// A 1 x 1 stand-in (mean albedo, level) for the sky's environment-map copy: its 64 px cube faces can't show the map,
// and the lighting renders that copy as soon as it is made, which would force the map to be finished at boot.
export const moonMapFlat = () => once('moonMapFlat', () => {
  const t = new THREE.DataTexture(new Uint8Array([140, 128, 128, 128]), 1, 1);
  t.needsUpdate = true;
  t.name = 'moonMapFlat';
  return t;
});

// The air's dimming and reddening of the moon's light at its altitude, relative to the zenith: Kasten-Young air mass
// and a little more extinction for blue than red (the rising moon is dimmer and warmer). moonDir: unit vector.
export function moonExtinction(moonDir, out) {
  const h = Math.max(moonDir.y, 0);
  const am = 1 / (h + 0.15 * Math.pow(Math.asin(h) * 180 / Math.PI + 3.885, -1.253));
  return out.setRGB(Math.exp(-0.12 * (am - 1)), Math.exp(-0.24 * (am - 1)), Math.exp(-0.48 * (am - 1)));
}

const f = (v) => v.toFixed(7);   // a JS number as a GLSL float

// The moon in the sky shader. Needs SKY_UNIFORMS_GLSL (uSunDir, uMoonDir, uNight) declared first.
//   moonAt(dir)       where dir falls on (or near) the disc: the moon's frame, disc coordinates, map uv and its
//                     derivatives, and the anti-aliased coverage. Call it in uniform control flow (it takes
//                     derivatives); the shading below samples with them, so it can sit in a branch.
//   moonSurface(m)    the lit surface's radiance (before extinction and the day / night scale)
//   moonGlow(m)       the aureole round it (for the night)
//   uMoonExt          the air's reddening and dimming of its light at its altitude (moonExtinction, set per frame)
// Lighting: the sun lights the sphere from uSunDir, so the phase is whatever the sun and the moon's places make it
// (clock.moonDir rides roughly opposite the sun: nearly full at night, a crescent near the noon sun). Reflectance is
// lunar-Lambert (Lommel-Seeliger, which makes the real full moon look flat, mixed with Lambert for a gentle darkening
// to the limb); the map's slopes tilt the normal, and along the terminator, when the moon is big on screen (the
// eyepiece), a short march over the height field casts the crater shadows. After dark, earthshine lights the night
// side faintly, the more the fuller the Earth is as the moon sees it.
export const MOON_GLSL = /* glsl */ `
uniform sampler2D uMoonMap;
uniform vec3 uMoonExt;
const float MOON_TAN = ${f(Math.tan(MOON_RADIUS_DEG * Math.PI / 180))};
const float MOON_SIN = ${f(Math.sin(MOON_RADIUS_DEG * Math.PI / 180))};
const float MOON_EXT = ${f(MOON_EXT)};
const float MOON_SLOPE = ${f(MOON_SLOPE)};
const float MOON_HMAX = ${f(MOON_HMAX)};
const float MOON_TEXEL = ${f(2 * MOON_EXT / MOON_MAP_SIZE)};   // one map texel, moon radii

struct Moon { vec3 r; vec3 u; vec2 q; float rad; float z; float s; vec2 uv; vec2 dx; vec2 dy; float cov; };

Moon moonAt(vec3 dir) {
  Moon m;
  m.r = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0, 1e-6));   // right, on the sky
  m.u = cross(m.r, uMoonDir);                               // up, toward the zenith (the map's north)
  m.z = dot(dir, uMoonDir);
  // Disc coordinates in moon radii (gnomonic, from small dot products: exact to a fraction of a pixel in the eyepiece).
  vec2 o = vec2(dot(dir, m.r), dot(dir, m.u));
  m.s = length(o);   // sine of the angle from its centre (in front of us)
  m.q = o / (MOON_TAN * max(m.z, 1e-3));
  m.rad = length(m.q);
  float w = fwidth(m.rad);
  m.uv = m.q * (0.5 / MOON_EXT) + 0.5;
  m.dx = dFdx(m.uv);
  m.dy = dFdy(m.uv);
  m.cov = m.z > 0.0 ? clamp((1.0 - m.rad) / max(w, 1e-6) + 0.5, 0.0, 1.0) : 0.0;   // analytic edge, ~1 px wide
  return m;
}

float moonHeight(vec2 uv) { return (textureLod(uMoonMap, uv, 0.0).a * 2.0 - 1.0) * MOON_HMAX; }

vec3 moonSurface(Moon m) {
  vec2 p = m.q / max(m.rad, 1.0);   // the rim's partly covered pixels shade the limb
  float pz = sqrt(max(1.0 - dot(p, p), 0.0));
  vec4 t = textureGrad(uMoonMap, m.uv, m.dx, m.dy);
  float alb = t.r * 1.3;
  // Relief: the map's slopes (image x, y) as a tilt of the sphere's normal (the surface gradient G is tangent to
  // the sphere: G = (g - p (p.g), -z (p.g))), in the moon's frame (x right, y up, z toward us).
  vec2 g = (t.gb * 2.0 - 1.0) * MOON_SLOPE;
  float pg = dot(p, g);
  vec3 n = normalize(vec3(p - (g - p * pg), pz * (1.0 + pg)));
  vec3 sl = vec3(dot(uSunDir, m.r), dot(uSunDir, m.u), -dot(uSunDir, uMoonDir));
  float inc = dot(vec3(p, pz), sl);   // the smooth sphere's incidence: the terminator
  float i0 = max(dot(n, sl), 0.0);
  float mu = max(pz, 0.04);
  float sun = mix(i0, 2.0 * i0 / (i0 + mu), 0.55);
  // Beyond the terminator only the peaks catch the light.
  sun *= smoothstep(-0.05, 0.08, inc);
  // Crater shadows along the terminator, where the map is magnified enough to see them.
  float texPx = max(length(m.dx), length(m.dy)) * ${f(MOON_MAP_SIZE)};   // map texels per pixel
  if (inc > -0.05 && inc < 0.4 && texPx < 3.0 && sun > 0.0) {
    vec2 sd = normalize(sl.xy + 1e-6);
    float tanEl = max(inc, 0.01) / sqrt(max(1.0 - inc * inc, 1e-4));
    float h0 = (t.a * 2.0 - 1.0) * MOON_HMAX;
    float occ = 0.0;
    for (int k = 1; k <= 12; k++) {
      float d = MOON_TEXEL * 0.7 * float(k * k);
      float hk = moonHeight(m.uv + sd * d * (0.5 / MOON_EXT));
      // Above the ray to the sun (the sphere falls away by d^2/2), with a penumbra as wide as the sun.
      occ = max(occ, clamp((hk - 0.5 * d * d - h0 - d * tanEl) / (d * 0.009 + 1e-5) + 0.5, 0.0, 1.0));
    }
    sun *= 1.0 - occ * (1.0 - smoothstep(1.5, 3.0, texPx)) * smoothstep(0.1, 0.3, pz);   // not where the limb foreshortens
  }
  // Earthshine: lit from where we stand, so shaded like a full moon; stronger the fuller the Earth is, seen from there.
  float earth = 0.5 + 0.5 * dot(uSunDir, uMoonDir);
  float es = uNight * (0.2 + 0.8 * earth) * 0.035 * (0.45 * pz + 0.55);
  vec3 tint = mix(vec3(0.9, 0.93, 1.0), vec3(1.0, 0.96, 0.9), smoothstep(0.45, 0.85, alb));
  return alb * tint * (sun + es);
}

// The aureole: moonlight scattered a little way round the disc (the air, the eye), over the stars and the disc alike.
vec3 moonGlow(Moon m) {
  float rho = (m.z > 0.0 ? m.s : 2.0 - m.s) / MOON_SIN;   // angle from the moon's centre, in moon radii
  float lit = 0.5 - 0.5 * dot(uSunDir, uMoonDir);          // the lit fraction of the disc
  float x = max(rho - 1.0, 0.0);
  return vec3(0.72, 0.8, 1.0) * lit * (0.022 * exp(-x * 1.3) + 0.006 * exp(-rho * 0.14));
}
`;
