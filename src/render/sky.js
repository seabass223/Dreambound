import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL } from './glsl.js';
import { CENTER_DIR } from './constellation.js';

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

  float starVis = uStars * uNight * smoothstep(-0.02, 0.18, dir.y);
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

  // Moon
  float md = dot(dir, uMoonDir);
  float moonR = 0.99990;
  float disk = smoothstep(moonR - 0.00002, moonR + 0.00001, md);
  if (disk > 0.0) {
    vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, uMoonDir);
    vec2 uv = vec2(dot(dir, t1), dot(dir, t2)) * 70.0;
    float maria = smoothstep(0.45, 0.75, fbm(uv * 1.3 + 3.0));
    vec3 moonCol = vec3(1.0, 0.97, 0.9) * (1.0 - maria * 0.35);
    float vis = mix(0.12, 1.0, uNight);
    col = mix(col, moonCol * 2.2 * vis, disk * smoothstep(-0.02, 0.02, dir.y));
  }
  float halo = pow(max(md, 0.0), 900.0) * 0.12 + pow(max(md, 0.0), 60.0) * 0.012;
  col += vec3(0.55, 0.62, 0.8) * halo * uNight;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmo, uStars: { value: 1 }, uConstDir: { value: CENTER_DIR.clone() } },
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

  // A low-cost copy (no stars) used to render the environment map for image-based lighting.
  const envMat = mat.clone();
  envMat.uniforms = { ...atmo, uStars: { value: 0 }, uConstDir: { value: CENTER_DIR.clone() } };
  const envScene = new THREE.Scene();
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat);
  envScene.add(envMesh);

  return {
    mesh,
    envScene,
    update(camera) { mesh.position.copy(camera.position); },
  };
}
