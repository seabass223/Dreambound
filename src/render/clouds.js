import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { NOISE_GLSL, SKY_UNIFORMS_GLSL, SKY_FUNC_GLSL } from './glsl.js';
import { Textures } from './textures.js';
import { CLOUD_DECK_Y, STACKS } from '../config.js';
import { Rng } from '../core/rng.js';

// ---------- Cloud sea far below ----------
// A static, densely tessellated disc around the stacks whose vertices billow upward. Clouds pile up
// around each stack so the cliffs sink into soft, moving domes instead of a flat plane.
const SEA_FUNCS = /* glsl */ `
uniform vec4 uStacks[5];
float seaHeight(vec2 xz, float t) {
  vec2 drift = uWind * t * 0.011;
  vec2 q = xz * 0.0042 + drift;
  float b = fbm(q);
  float big = pow(smoothstep(0.28, 0.85, b), 0.75) * 70.0;
  float mid = fbm3o(xz * 0.013 + drift * 2.3 + 17.0) * 22.0;
  float h = big + mid;
  // Pile up against the stacks, churning slowly.
  for (int i = 0; i < 5; i++) {
    float d = max(length(xz - uStacks[i].xy) - uStacks[i].z, 0.0);
    float churn = 0.65 + 0.35 * vnoise(xz * 0.02 + vec2(t * 0.05, float(i) * 7.0 - t * 0.03));
    h += 125.0 * exp(-d / 90.0) * churn;
  }
  // Flatten toward the horizon where the grid is coarse.
  float r = length(xz);
  return h * (1.0 - smoothstep(2200.0, 4500.0, r));
}
`;

const seaVert = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vHeight;
${NOISE_GLSL}
${SEA_FUNCS}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float e = 6.0;
  float h = seaHeight(w.xz, uTime);
  float hx = seaHeight(w.xz + vec2(e, 0.0), uTime);
  float hz = seaHeight(w.xz + vec2(0.0, e), uTime);
  vNormal2 = normalize(vec3(h - hx, e, h - hz));
  vHeight = h;
  w.y += h;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const seaFrag = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform vec3 uSunLight;
uniform vec3 uAmbient;
uniform vec2 uWind;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vHeight;
${NOISE_GLSL}
${SKY_FUNC_GLSL}

void main() {
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  vec3 dir = V / dist;
  float t = uTime;
  // Fine billow detail on top of the geometric domes.
  vec2 p = vWorld.xz * 0.03 + uWind * t * 0.02;
  float d1 = fbm3o(p);
  float dx = fbm3o(p + vec2(0.15, 0.0)) - d1;
  float dz = fbm3o(p + vec2(0.0, 0.15)) - d1;
  float detail = 1.0 - smoothstep(250.0, 1400.0, dist);
  vec3 n = normalize(vNormal2 + vec3(-dx, 0.0, -dz) * 3.0 * detail);

  bool sunUp = uSunDir.y > -0.05;
  vec3 L = sunUp ? uSunDir : uMoonDir;
  float lightAmt = sunUp ? 1.0 : 0.06 * uNight;
  vec3 lightCol = sunUp ? uSunLight : vec3(0.32, 0.4, 0.62);
  float wrap = clamp(dot(n, normalize(L + vec3(0.0, 0.2, 0.0))) * 0.55 + 0.45, 0.0, 1.0);
  // Valleys between domes sit in their own shade; crowns catch the light.
  float crown = smoothstep(10.0, 150.0, vHeight);
  float ao = mix(0.55, 1.0, crown) * (0.85 + d1 * 0.3);
  vec3 amb = mix(uZenith, horizonColor(dir), 0.5) * 0.85 + uAmbient * 0.55;
  vec3 col = amb * ao + lightCol * lightAmt * wrap * 0.17 * ao;
  // Silver lining and soft forward scattering toward the sun.
  float fwd = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  float rim = pow(1.0 - max(dot(n, -dir), 0.0), 3.0);
  col += uSunGlow * fwd * (0.15 + rim * 0.5);

  vec3 hor = skyGradient(normalize(vec3(dir.x, min(dir.y, -0.001), dir.z)));
  float fog = 1.0 - exp(-pow(dist * 0.00028, 1.4));
  col = mix(col, hor, clamp(fog, 0.0, 1.0));
  if (uUnderground > 0.5) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Polar grid: ~10 m spacing around the stacks, coarse rings out to the horizon.
function seaGeometry() {
  const ring = [];
  const N = 150;
  for (let i = 0; i <= N; i++) ring.push(1600 * Math.pow(i / N, 1.6));
  for (let r = 1900; r <= 14000; r *= 1.35) ring.push(r);
  const segs = 288;
  const pos = [0, 0, 0], idx = [];
  for (let i = 1; i < ring.length; i++) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * ring[i], 0, Math.sin(a) * ring[i]);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < ring.length - 1; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// ---------- Billboard sky clouds ----------
const puffVert = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform vec4 uStacks[5];
attribute vec4 aCloud; // size, seed, speed, kind (0 high, 1 low drifting, 2 collar around a stack base)
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying vec3 vDir;
varying float vSeed;
void main() {
  vec3 c = instanceMatrix[3].xyz;
  float span = 9000.0;
  bool collar = aCloud.w > 1.5;
  if (collar) {
    // Collars churn in place around their stack instead of drifting away.
    float ph = aCloud.y * 40.0;
    c.xz += vec2(sin(uTime * 0.021 * aCloud.z + ph), cos(uTime * 0.017 * aCloud.z + ph * 1.3)) * 28.0;
    c.y += sin(uTime * 0.05 + ph) * 7.0;
  } else {
    c.xz += uWind * uTime * aCloud.z;
    c.xz = mod(c.xz - cameraPosition.xz + span * 0.5, span) + cameraPosition.xz - span * 0.5;
  }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = aCloud.x;
  vec3 wp = c + right * position.x * size + up * position.y * size * 0.55;
  vUv = uv;
  vSeed = aCloud.y;
  float a = 1.0;
  // Never slice through a stack.
  if (!collar) {
    for (int i = 0; i < 5; i++) {
      float d = length(c.xz - uStacks[i].xy) - uStacks[i].z;
      a *= smoothstep(size * 0.15, size * 0.75, d);
    }
  }
  float cd = length(c - cameraPosition);
  a *= smoothstep(size * 0.4, size * 1.4, cd);
  a *= 1.0 - smoothstep(span * 0.33, span * 0.5, length(c.xz - cameraPosition.xz));
  vAlpha = a;
  vShade = position.y * 0.5 + 0.5;
  vDir = normalize(wp - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const puffFrag = /* glsl */ `
${SKY_UNIFORMS_GLSL}
uniform sampler2D uMap;
uniform vec3 uSunLight;
uniform vec3 uAmbient;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
varying vec3 vDir;
varying float vSeed;
${NOISE_GLSL}
${SKY_FUNC_GLSL}
void main() {
  vec2 uv = vUv;
  float tex = texture2D(uMap, uv).a;
  float n = fbm3o(uv * 3.0 + vSeed * 17.0);
  float a = smoothstep(0.05, 0.9, tex * (0.55 + n * 0.9)) * vAlpha * 0.8;
  if (a < 0.01) discard;
  float twilight = smoothstep(0.25, -0.02, uSunDir.y) * smoothstep(-0.22, -0.04, uSunDir.y);
  vec3 light = uSunLight * 0.1 + uHorizonSun * (0.12 + twilight * 0.7) + uSunGlow * 0.06;
  vec3 amb = mix(horizonColor(vDir), uZenith, 0.45) * 0.85 + uAmbient * 0.4;
  float shade = mix(0.45, 1.0, vShade) * (0.8 + n * 0.4);
  vec3 col = amb * (0.65 + 0.35 * shade) + light * shade * 0.8;
  float fwd = pow(max(dot(vDir, uSunDir), 0.0), 6.0);
  col += uSunGlow * fwd * (1.0 - tex) * 0.5;
  col = mix(col, horizonColor(vDir), 0.25);
  // Night: dim, moonlit silhouettes.
  col = mix(col, amb * 0.3 + vec3(0.004, 0.005, 0.009), uNight * 0.92);
  gl_FragColor = vec4(col * a, a);
}
`;

export function createClouds() {
  const group = new THREE.Group();
  group.name = 'clouds';

  const stackU = Object.values(STACKS).map((st) => new THREE.Vector4(st.x, st.z, st.r * 1.15, 0));
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { ...atmo, uSunLight: atmo.uSunLight, uAmbient: atmo.uAmbient, uStacks: { value: stackU } },
    vertexShader: seaVert,
    fragmentShader: seaFrag,
    depthWrite: true,
  });
  const sea = new THREE.Mesh(seaGeometry(), seaMat);
  sea.position.y = CLOUD_DECK_Y;
  sea.frustumCulled = false;
  sea.renderOrder = -5;
  group.add(sea);

  // Sprites
  const r = new Rng(1234);
  const sprites = [];
  const addCloud = (cx, cy, cz, scale, speed, low) => {
    const n = r.int(9, 16);
    const stretch = r.float(1.2, 2.2);
    for (let i = 0; i < n; i++) {
      const u = r.float(-1, 1), v = r.float(-1, 1);
      const core = 1 - Math.min(1, Math.hypot(u * 0.8, v));
      sprites.push({
        x: cx + u * scale * stretch, y: cy + (core * 0.35 + r.float(-0.08, 0.12)) * scale, z: cz + v * scale * 0.8,
        size: scale * r.float(0.35, 0.75) * (0.7 + core * 0.6), seed: r.next(), speed, low,
      });
    }
  };
  for (let i = 0; i < 55; i++) addCloud(r.float(-4500, 4500), r.float(380, 1100), r.float(-4500, 4500), r.float(160, 380), r.float(1.6, 2.4), 0);
  for (let i = 0; i < 40; i++) addCloud(r.float(-2000, 2000), r.float(-230, -70), r.float(-2000, 2000), r.float(50, 110), r.float(0.8, 1.3), 1);
  // Collars of billowing cloud around each stack where it sinks into the sea.
  for (const st of Object.values(STACKS)) {
    const baseR = st.r + 26;
    const n = Math.round(12 + st.r / 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.float(-0.2, 0.2);
      const d = baseR + r.float(0, 30);
      addCloud(st.x + Math.cos(a) * d, CLOUD_DECK_Y + r.float(110, 210), st.z + Math.sin(a) * d, r.float(70, 130), r.float(0.6, 1.4), 2);
    }
  }

  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry().copy(quad);
  const aCloud = new Float32Array(sprites.length * 4);
  const mesh = new THREE.InstancedMesh(geo, null, sprites.length);
  const m = new THREE.Matrix4();
  sprites.forEach((s, i) => {
    m.makeTranslation(s.x, s.y, s.z);
    mesh.setMatrixAt(i, m);
    aCloud.set([s.size, s.seed, s.speed, s.low], i * 4);
  });
  geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(aCloud, 4));
  mesh.material = new THREE.ShaderMaterial({
    uniforms: { ...atmo, uMap: { value: Textures.puff() }, uSunLight: atmo.uSunLight, uAmbient: atmo.uAmbient, uStacks: { value: stackU } },
    vertexShader: puffVert,
    fragmentShader: puffFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  group.add(mesh);

  return {
    group,
    update() {},
  };
}
