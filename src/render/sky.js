import * as THREE from 'three';
import { atmo, STORM_GLSL } from './atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL } from './glsl.js';
import { CENTER_DIR } from './constellation.js';
import { MOON_GLSL, moonMap, moonMapFlat, moonExtinction } from './moon.js';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // pin to the far plane
}
`;

const frag = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform float uStars;
uniform vec3 uConstDir;
varying vec3 vDir;
${NOISE_GLSL}
${SKY_FUNC_GLSL}
${MOON_GLSL}
${STORM_GLSL}

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }

float starLayer(vec3 d, float scale, float density, float size, float seed) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  float h = hash13(cell + seed);
  if (h > density) return 0.0;
  vec3 off = vec3(hash13(cell + 1.7 + seed), hash13(cell + 3.1 + seed), hash13(cell + 5.3 + seed)) * 0.6 + 0.2;
  vec3 sp = normalize(cell + off) * scale;
  float dist = length(p - sp);
  float b = smoothstep(size, 0.0, dist);
  float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 40.0) + h * 91.0);
  return b * tw * (0.3 + 0.7 * fract(h * 57.3));
}

void main() {
  vec3 dir = normalize(vDir);
  if (uUnderground > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 col = skyGradient(dir);
  col += sunAndGlow(dir);

  // The moon (render/moon.js): where this pixel falls on its disc (derivatives, so out here in uniform control flow).
  Moon moon = moonAt(dir);
  float moonCov = moon.cov * smoothstep(-0.02, 0.02, dir.y);

  float starVis = uStars * uNight * smoothstep(-0.02, 0.18, dir.y) * (1.0 - moonCov);   // the disc hides them
  // A dark patch round the Rocks constellation (render/constellation.js), so the turning field never crowds it:
  // no stars within 1.5 deg of its centre, all back by 3 deg.
  float starMask = smoothstep(0.99863, 0.99966, dot(dir, uConstDir));
  if (starVis > 0.001) {
    vec3 sd = rotX(rotY(dir, uTime * 0.0035), 0.45);
    float s = starLayer(sd, 150.0, 0.18, 0.09, 0.0) * 0.5;
    s += starLayer(sd, 60.0, 0.06, 0.07, 13.0) * 1.8;
    s += starLayer(sd, 300.0, 0.25, 0.1, 29.0) * 0.18;
    // Milky Way: a faint dusty band along a tilted great circle.
    float band = exp(-pow(sd.y * 3.2 + 0.15 * sin(sd.x * 4.0), 2.0));
    float dust = fbm(sd.xz * 6.0 + sd.y * 3.0);
    vec3 milky = vec3(0.022, 0.024, 0.034) * band * smoothstep(0.35, 0.8, dust);
    milky *= 1.0 - 0.7 * smoothstep(0.55, 0.75, fbm(sd.xz * 14.0));
    float sparkle = starLayer(sd, 520.0, 0.5 * band, 0.12, 51.0) * 0.25;
    vec3 starCol = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.86, 0.7), fract(s * 13.0));
    col += (starCol * (s + sparkle) * 0.9 * (1.0 - starMask) + milky) * starVis;
  }

  // Its light, dimmed and reddened by the air low down. By day the sky's own light lies over it (added, so its dark
  // side is sky and its lit side pale and low in contrast, with no aureole); at night it is brighter on screen (the
  // exposure opens) with a soft aureole and earthshine.
  col += moonGlow(moon) * uMoonExt * uNight * smoothstep(-0.05, 0.05, dir.y);
  if (moonCov > 0.0) col += moonSurface(moon) * uMoonExt * mix(0.5, 0.2, uNight) * moonCov;

  // The storm (render/storm.js): a heavy overcast over the whole sky, its colours the sky's own (storm.js has already
  // greyed and darkened them), lumpy underneath and drifting slowly; the horizon stays a band of haze. Lightning lights
  // it from inside, most round the stroke and through its thicker parts.
  // (uFlash.w is 0 in the environment map's copy.)
  if (uStorm > 0.001) {
    vec2 cp = dir.xz / (max(dir.y, 0.0) + 0.09);   // onto a flat ceiling: its lumps shrink toward the horizon
    vec2 drift = vec2(uTime * 0.012, uTime * 0.005);
    float n = fbm(cp * 0.8 + drift);
    float m = fbm(cp * 2.3 - drift * 1.6 + 5.3);
    // The lumps fade into an even haze toward the horizon (below it the projection would only smear them into
    // streaks), where the far cloud sea meets it in the same colour and the same lightning (clouds.js).
    float lumps = smoothstep(0.0, 0.18, dir.y);
    float d0 = smoothstep(0.3, 0.8, n * 0.75 + m * 0.4);
    float dens = mix(0.5, d0, lumps);
    vec3 deck = mix(uHorizonAway, uZenith, smoothstep(-0.05, 0.6, dir.y)) * mix(1.0, mix(0.62, 1.08, d0), lumps);
    col = mix(col, deck, uStorm * smoothstep(-0.12, 0.05, dir.y));
    col += skyFlash(dir, dens);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky() {
  const moonExt = { value: new THREE.Color(1, 1, 1) };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmo, uStars: { value: 1 }, uConstDir: { value: CENTER_DIR.clone() }, uMoonMap: { value: moonMap() }, uMoonExt: moonExt },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';

  // A low-cost copy (no stars, a plain moon: moonMapFlat) used to render the environment map for image-based lighting.
  // The storm's overcast reaches it, its lightning doesn't (the map is kept for seconds; render/storm.js holds its
  // refresh while a flash lights the shared sky colours).
  const envMat = mat.clone();
  envMat.uniforms = { ...atmo, uStars: { value: 0 }, uConstDir: { value: CENTER_DIR.clone() }, uMoonMap: { value: moonMapFlat() }, uMoonExt: moonExt,
    uFlash: { value: new THREE.Vector4(0, 1, 0, 0) } };
  const envScene = new THREE.Scene();
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat);
  envScene.add(envMesh);

  return {
    mesh,
    envScene,
    // For the storm (render/storm.js): the stars' brightness (1; the environment map's copy has none) and the moon's
    // extinction, rewritten by update() every frame (scale it after).
    stars: mat.uniforms.uStars,
    moonExt,
    update(camera) {
      mesh.position.copy(camera.position);
      moonExtinction(atmo.uMoonDir.value, moonExt.value);
    },
  };
}
