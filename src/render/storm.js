import * as THREE from 'three';
import { atmo, atmoState, updateCloudColor } from './atmosphere.js';
import { NOISE_GLSL } from './glsl.js';
import { INTERIOR_GLSL } from './materials.js';
import { Rng, clamp, smoothstep } from '../core/rng.js';

// The endgame's storm (sequences/descent.js sets it going as the player starts down the stairs): a heavy overcast
// with no stars or moon, rain, lightning and thunder, and the wind up. One level 0..1, eased (set), from which it
// builds: the overcast first, then the rain, then the lightning.
//
// Everything is made here, hidden, before the preloader runs, and costs nothing at level 0. The rain is one instanced
// draw of streaks whose motion is closed-form in the vertex shader (world-fixed drops wrapped into a box round the
// camera, so they never slide with it); the CPU only integrates the fall and the wind drift into two uniforms. The
// bolts are one small strip mesh whose jagged path the vertex shader builds from a seed. The sky, the cloud sea and the
// clouds (sky.js, clouds.js) read atmo.uStorm and atmo.uFlash: overcast and lightning are uniforms there.
//
// main.js calls, each frame: afterAtmosphere() right after updateAtmosphere (the sky colours, exposure and cloud colour
// under the overcast, and the lightning's flash, which it also times: it reads atmo.uTime), afterSky() after
// sky.update (stars, moon, constellation), afterLighting() after lighting.update (the light under the overcast and the
// flash), and update(dt, { under, elapsed }) once the camera has moved for the frame (the level, the rain, scheduling
// the strikes and their thunder, the wind). fogMul scales the surface fog's density.

// The rain: streaks in a box round the camera (half width, height, its centre below the eye: more of it shows looking
// down off the stairs than looking up).
const RAIN_N = 16000;
const RAIN_R = 20;
const RAIN_H = 24;
const RAIN_DROP = 3;
const FALL = 9.5;            // m/s, heavy rain's terminal speed
// Lightning: the light it puts in the sky colours (the fog, the clouds and the hemisphere fill follow them), on the
// ground as a directional light, and its colour.
const FLASH_SKY = new THREE.Color(0.03, 0.034, 0.046);
const FLASH_AMB = new THREE.Color(0.045, 0.05, 0.064);
const FLASH_SUN = 1.2;
const FLASH_COL = new THREE.Color(0.78, 0.84, 1.0);
// The overcast's grey (unit luminance) and how far it darkens each sky colour at full cover.
const GREY = new THREE.Color(0.9, 0.99, 1.24);
GREY.multiplyScalar(1 / (0.2126 * GREY.r + 0.7152 * GREY.g + 0.0722 * GREY.b));
const OVERHEAD = new THREE.Vector3(0.12, 1, 0.08).normalize();
const SOUND = 343;           // m/s: thunder comes this much later than its flash
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

const rainVert = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizonAway;
uniform vec3 uAmbient;
uniform vec4 uFlash;
uniform float uNight;
uniform float uUnderground;
uniform float uPxH;
uniform vec4 uRainA;    // the box's half width and height, the fall so far (m, wrapped), the fall speed (m/s)
uniform vec4 uRainB;    // the wind's drift so far (xz, m, wrapped), and its velocity now (xz, m/s)
uniform float uRain;    // how much rain: the streaks' opacity
uniform vec4 uShelterA; // a roofed place it keeps out of besides the interiors: its centre, its half height (0: none)
uniform vec4 uShelterB; // its horizontal axis (xz), its half lengths along that and across
attribute vec4 aDrop;   // where in the box (x, z, y: 0..1), and its speed class k (0.8 .. 1.2 in tenths)
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
${INTERIOR_GLSL}
void main() {
  vUv = uv;
  vA = 0.0;
  vCol = vec3(0.0);
  float R = uRainA.x, H = uRainA.y;
  // Big drops fall faster and drift less. The CPU wraps the fall at 10 H and the drift at 20 R, and k is m / 10 for a
  // whole m, so there every drop's offset jumps by whole boxes: none of them visibly moves.
  float k = aDrop.w, kw = 2.0 - k;
  vec3 c = cameraPosition;
  vec3 p = vec3(aDrop.x * 2.0 * R + uRainB.x * kw, aDrop.z * H - uRainA.z * k, aDrop.y * 2.0 * R + uRainB.y * kw);
  // Wrapped into the box round the camera: fixed in the world, so they don't slide as the camera moves.
  p.xz = mod(p.xz - c.xz + R, 2.0 * R) + c.xz - R;
  float cy = c.y - ${RAIN_DROP.toFixed(1)};
  p.y = mod(p.y - cy + 0.5 * H, H) + cy - 0.5 * H;
  vec3 toCam = c - p;
  float d = length(toCam);
  // Faded near the eye, toward the box's walls (no pop as a drop wraps) and inside the interiors.
  float a = uRain * smoothstep(0.3, 1.4, d)
    * (1.0 - smoothstep(0.62, 0.97, length(p.xz - c.xz) / R))
    * (1.0 - smoothstep(0.72, 0.98, abs(p.y - cy) / (0.5 * H)));
  a *= 1.0 - interiorMask(p);
  if (uShelterA.w > 0.0) {
    vec3 q = p - uShelterA.xyz;
    float along = q.x * uShelterB.x + q.z * uShelterB.y, across = q.z * uShelterB.x - q.x * uShelterB.y;
    a *= 1.0 - step(abs(along), uShelterB.z) * step(abs(across), uShelterB.w) * step(abs(q.y), uShelterA.w);
  }
  if (a < 0.002 || uUnderground > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }   // clipped, all four corners
  vec3 vel = vec3(uRainB.z * kw, -uRainA.w * k, uRainB.w * kw);
  float sp = length(vel);
  vec3 ax = vel / max(sp, 1e-3);
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float z = max(dot(-toCam, fwd), 0.05);
  float pxM = 0.5 * uPxH * projectionMatrix[1][1] / z;   // drawing-buffer pixels per metre there
  // About 1 cm across, but never under 1.4 px (thinner shimmers): widened streaks are fainter.
  float w = max(0.01, 1.4 / pxM);
  a *= mix(0.01 / w, 1.0, 0.4);
  // The streak the eye sees: about 1/20 s of its fall.
  float len = sp * 0.05 * (0.75 + 0.5 * fract(aDrop.x * 97.31 + aDrop.y * 13.7));
  vec3 side = normalize(cross(ax, toCam) + vec3(1e-6, 0.0, 0.0));
  vec3 wp = p + ax * (position.y * len) + side * (position.x * w);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  // Lit by the sky (a little brighter than it: they catch the light from all round) and by the lightning, which makes
  // them stand out, most toward the flash. At night they stand out more (the eye's adapted to the dark).
  vec3 V = -toCam / d;
  vCol = (uAmbient * 1.8 + uZenith * 0.9 + uHorizonAway * 0.6) * mix(0.55, 1.6, uNight)
    + vec3(0.6, 0.67, 0.9) * uFlash.w * (0.12 + 0.3 * pow(max(dot(V, uFlash.xyz), 0.0), 2.0));
  vA = a;
}
`;

const rainFrag = /* glsl */ `
varying vec2 vUv;
varying float vA;
varying vec3 vCol;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  // Round across, its tail fading in and its head a little sharper.
  float a = vA * (1.0 - x * x) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * 0.5;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, a);
}
`;

// A bolt: strip 0 the channel from the cloud base (uBoltA) down into the cloud sea (uBoltB), strips 1.. branches off
// it. position = (s along the strip 0..1, side -1 / 1, strip). Its path is straight runs and sharp kinks: piecewise-
// linear noise in three octaves across the line, pinned where it leaves the cloud (and where a branch leaves it).
const BRANCHES = 4;
const MAIN_SEG = 56, BRANCH_SEG = 28;
const boltVert = /* glsl */ `
uniform vec3 uBoltA;
uniform vec3 uBoltB;
uniform float uBoltSeed;
uniform float uBoltI;     // brightness now
uniform float uBoltLen;   // how far down it has come (the leader), 0..1
uniform float uBranch;    // the branches' brightness (the first stroke's: later strokes follow the main channel)
uniform float uPxH;
varying float vSide;
varying float vI;
${NOISE_GLSL}
vec2 kinks(float x, float seed) {
  float i = floor(x), t = x - i;
  vec2 a = vec2(hash12(vec2(i, seed)), hash12(vec2(i, seed + 7.31))) - 0.5;
  vec2 b = vec2(hash12(vec2(i + 1.0, seed)), hash12(vec2(i + 1.0, seed + 7.31))) - 0.5;
  return mix(a, b, t);
}
vec2 jag(float s, float seed) {
  return kinks(s * 6.0, seed) + kinks(s * 17.0, seed + 19.7) * 0.4 + kinks(s * 47.0, seed + 41.3) * 0.14;
}
vec3 pathAt(float s, vec3 A, vec3 B, float amp, float seed) {
  vec3 D = normalize(B - A);
  vec3 X = normalize(cross(D, vec3(0.0, 0.0, 1.0)));
  vec3 Z = cross(X, D);
  vec2 o = jag(s, seed) * amp * smoothstep(0.0, 0.1, s);
  return mix(A, B, s) + X * o.x + Z * o.y;
}
float hb(float j, float k) { return hash12(vec2(j * 13.7 + k, uBoltSeed * 1.37 + 3.1)); }
void main() {
  float s = position.x, sideSign = position.y, j = position.z;
  float L = length(uBoltB - uBoltA);
  float ampMain = L * 0.13;
  vec3 A = uBoltA, B = uBoltB;
  float amp = ampMain, seed = uBoltSeed, sg = s, I = 1.0, n = ${MAIN_SEG.toFixed(1)}, halfPx = 4.0;
  if (j > 0.5) {
    // A branch: from a point on the channel, splaying off downward, fading toward its tip.
    float s0 = 0.1 + 0.55 * hb(j, 1.0), lenF = 0.16 + 0.22 * hb(j, 2.0), ang = 6.2832 * hb(j, 3.0);
    A = pathAt(s0, uBoltA, uBoltB, ampMain, uBoltSeed);
    vec3 D = normalize(uBoltB - uBoltA);
    vec3 X = normalize(cross(D, vec3(0.0, 0.0, 1.0)));
    vec3 Z = cross(X, D);
    vec3 Db = normalize(D + (X * cos(ang) + Z * sin(ang)) * (0.6 + 0.6 * hb(j, 4.0)));
    B = A + Db * L * lenF;
    amp = L * lenF * 0.22;
    seed = uBoltSeed + j * 31.0;
    sg = s0 + s * lenF;
    I = uBranch * 0.55 * pow(1.0 - s, 1.3);
    n = ${BRANCH_SEG.toFixed(1)};
    halfPx = 2.6;
  }
  vec3 P = pathAt(s, A, B, amp, seed);
  vec3 T = normalize(pathAt(min(s + 1.0 / n, 1.0), A, B, amp, seed) - pathAt(max(s - 1.0 / n, 0.0), A, B, amp, seed));
  vec3 toCam = cameraPosition - P;
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float z = max(dot(-toCam, fwd), 1.0);
  float pxM = 0.5 * uPxH * projectionMatrix[1][1] / z;
  // A ribbon a few pixels wide facing the camera, whatever the distance.
  vec3 W = P + normalize(cross(T, toCam) + vec3(1e-6, 0.0, 0.0)) * sideSign * halfPx / pxM;
  gl_Position = projectionMatrix * viewMatrix * vec4(W, 1.0);
  // Drawn down to the leader's tip, out of the cloud base, dimmer through the rain the farther it is.
  float lit = 1.0 - smoothstep(uBoltLen - 0.03, uBoltLen, sg);
  vI = uBoltI * I * lit * smoothstep(0.0, 0.06, sg) * mix(1.0, 0.55, smoothstep(1500.0, 4000.0, length(toCam)));
  vSide = sideSign;
}
`;

const boltFrag = /* glsl */ `
varying float vSide;
varying float vI;
void main() {
  float x = vSide * vSide;
  // A hot core about a pixel and a half wide in a soft glow (bloom adds the rest).
  float v = vI * (exp(-x * 22.0) * 14.0 + exp(-x * 3.5) * 0.36);
  if (v < 0.002) discard;
  gl_FragColor = vec4(vec3(0.78, 0.84, 1.0) * v, 1.0);
}
`;

function rainMesh(rng) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.deleteAttribute('normal');
  const drops = new Float32Array(RAIN_N * 4);
  for (let i = 0; i < RAIN_N; i++) drops.set([rng.next(), rng.next(), rng.next(), rng.int(8, 12) / 10], i * 4);
  geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
  geo.instanceCount = RAIN_N;
  const mat = new THREE.ShaderMaterial({
    name: 'storm:rain',
    uniforms: {
      ...atmo,
      uRainA: { value: new THREE.Vector4(RAIN_R, RAIN_H, 0, FALL) },
      uRainB: { value: new THREE.Vector4() },
      uRain: { value: 0 },
      uShelterA: { value: new THREE.Vector4() },
      uShelterB: { value: new THREE.Vector4(1, 0, 0, 0) },
    },
    vertexShader: rainVert,
    fragmentShader: rainFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'storm:rain';
  mesh.frustumCulled = false;   // placed by the shader round the camera
  mesh.raycast = () => {};      // (its geometry is one unit quad at the origin: nothing for a ray to find)
  mesh.renderOrder = 8;
  mesh.visible = false;
  return mesh;
}

function boltMesh() {
  const pos = [], idx = [];
  for (let j = 0; j <= BRANCHES; j++) {
    const n = j === 0 ? MAIN_SEG : BRANCH_SEG;
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) pos.push(i / n, -1, j, i / n, 1, j);
    for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    name: 'storm:bolt',
    uniforms: {
      uPxH: atmo.uPxH,
      uBoltA: { value: new THREE.Vector3() },
      uBoltB: { value: new THREE.Vector3() },
      uBoltSeed: { value: 0 },
      uBoltI: { value: 0 },
      uBoltLen: { value: 0 },
      uBranch: { value: 0 },
    },
    vertexShader: boltVert,
    fragmentShader: boltFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'storm:bolt';
  mesh.frustumCulled = false;   // built by the shader, kilometres out
  mesh.raycast = () => {};
  mesh.renderOrder = 7;
  mesh.visible = false;
  return mesh;
}

// A strike's light over time t (s from its start): the stepped leader's faint glow coming down, then 2..4 return
// strokes (each a near-instant rise and a fast decay, the later ones weaker), one with a longer, softer glow after it
// (a continuing current). Returns the flash, and fills `out` with the bolt's own brightness, its leader's progress
// and its branches'.
const RISE = 0.008;
const strokeAt = (k, t) => { const x = t - k.t; return x < 0 ? 0 : k.a * (x < RISE ? x / RISE : Math.exp(-(x - RISE) / k.tau)); };
function strikeLight(s, t, out) {
  let f = 0;
  for (const k of s.strokes) f += strokeAt(k, t);
  const lead = clamp(t / s.leader, 0, 1);
  out.bolt = f;
  out.len = t < s.leader ? lead : 1;
  out.branch = t < s.leader ? 0.6 : strokeAt(s.strokes[0], t) / Math.max(s.strokes[0].a, 1e-3);
  if (t >= 0 && t < s.leader) { f += 0.05 * lead * s.peak; out.bolt = 0.22 * s.peak; }
  return f;
}

// clouds: render/clouds.js, which reads atmo.uStorm and atmo.uFlash itself (taken for the contract; nothing to drive).
export function createStorm({ ctx, scene, camera, sky, clouds = null, lighting, fx = null, audio = null }) {
  const rng = new Rng(4711);
  const rain = rainMesh(new Rng(31));
  const bolt = boltMesh();
  ctx.surface.add(rain, bolt);   // hidden underground with the surface; the preloader compiles and draws them
  const RU = rain.material.uniforms, BU = bolt.material.uniforms;

  // The level and its ramp.
  let from = 0, to = 0, rampT = 0, rampDur = 0;
  // What it is made of now: the overcast, the rain, the lightning's rate.
  let cover = 0, wet = 0, sparks = 0;
  let under = false, lastAudio = -1;
  // Lightning: the strike under way, when the next one comes, and the thunder on its way.
  let strike = null, nextStrike = 2;
  let flash = 0;
  let previewing = null;
  const thunders = [];
  const light = { bolt: 0, len: 0, branch: 0 };
  // The rain's motion, integrated (and wrapped) here: the shader only places the drops.
  let fall = 0, gustT = rng.float(0, 100);
  const drift = new THREE.Vector2(), wind = new THREE.Vector2();
  const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _fd = new THREE.Vector3(), _col = new THREE.Color(), _c = new THREE.Color();
  let skyLum = 1;
  let conBase = 0, conOut = -1;   // the constellation's visibility: as its update wrote it, and as afterSky left it

  const derive = () => {
    cover = smoothstep(0, 0.55, storm.level);
    wet = smoothstep(0.12, 0.85, storm.level);
    sparks = smoothstep(0.5, 0.95, storm.level);
    storm.fogMul = 1 + 1.6 * wet;
  };
  // Greyed toward the overcast's colour and darkened.
  const overcast = (c, dark) => c.lerp(_c.copy(GREY).multiplyScalar(lum(c)), cover * 0.85).multiplyScalar(1 - dark * cover);

  // A strike: a sheet of light somewhere in the overcast, or (now and then) a bolt far out over the cloud sea, mostly
  // somewhere ahead of the view so it's seen. Its thunder follows by the distance.
  function makeStrike(elapsed, { bolt: isBolt = rng.next() < 0.42, near = null } = {}) {
    const fwd = camera.getWorldDirection(_v);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const ahead = rng.next() < (isBolt ? 0.75 : 0.4);
    const az = ahead ? yaw + rng.float(-1.1, 1.1) : rng.float(0, Math.PI * 2);
    let dist = isBolt ? rng.float(1500, 3800) : rng.float(700, 4500);
    if (near !== null) dist = 700 + (1 - near) * 3800;
    const nearness = clamp(1 - (dist - 700) / 3800, 0, 1);
    const cx = camera.position.x + Math.sin(az) * dist, cz = camera.position.z + Math.cos(az) * dist;
    const pos = new THREE.Vector3(cx, rng.float(650, 900), cz);
    const peak = (0.32 + 0.93 * Math.pow(nearness, 1.2)) * rng.float(0.85, 1.15);
    const n = rng.next() < 0.3 ? 4 : rng.next() < 0.6 ? 3 : 2;
    const leader = rng.float(0.045, 0.09);
    const strokes = [];
    let t = leader, a = peak;
    for (let i = 0; i < n; i++) {
      strokes.push({ t, a, tau: rng.float(0.035, 0.07) });
      t += rng.float(0.05, 0.17);
      a *= rng.float(0.5, 0.9);
    }
    const cc = strokes[rng.int(0, n - 1)];
    strokes.push({ t: cc.t + 0.012, a: cc.a * 0.28, tau: rng.float(0.15, 0.3) });
    const s = { start: elapsed, strokes, leader, peak, pos, dist, near: nearness, bolt: isBolt, end: t + 1.4 };
    if (isBolt) {
      // From the cloud base down into the sea, leaning a little.
      BU.uBoltA.value.copy(pos);
      BU.uBoltB.value.set(cx + rng.float(-250, 250), -300, cz + rng.float(-250, 250));
      BU.uBoltSeed.value = rng.float(0, 97);
    }
    thunders.push({ at: elapsed + dist / SOUND, near: nearness, pos });
    return s;
  }

  // This frame's lightning, at time `now` (atmo.uTime: main.js's elapsed), into atmo.uFlash and the bolt.
  function lightning(now) {
    flash = 0;
    let boltOn = false;
    if (strike && !under) {
      const t = previewing ? strike.strokes[0].t + 0.004 : now - strike.start;
      const f = strikeLight(strike, t, light);
      // A ragged flicker on top of the strokes.
      flash = f > 0.001 ? f * (previewing ? 1 : rng.float(0.86, 1.14)) : 0;
      if (strike.bolt && (light.bolt > 0.002 || t < strike.leader)) {
        boltOn = t >= 0;
        BU.uBoltI.value = light.bolt;
        BU.uBoltLen.value = light.len;
        BU.uBranch.value = light.branch;
      }
      _v.copy(strike.pos).sub(camera.position).normalize();
      atmo.uFlash.value.set(_v.x, _v.y, _v.z, flash);
    } else {
      atmo.uFlash.value.w = 0;
    }
    bolt.visible = boltOn;
  }

  const storm = {
    level: 0,
    fogMul: 1,
    rain,
    bolt,
    get flash() { return flash; },

    // Ramp to `level` over `seconds` (eased); 0 s: at once.
    set(level, seconds = 0) {
      from = storm.level;
      to = clamp(level, 0, 1);
      rampT = 0;
      rampDur = Math.max(0, seconds || 0);
      if (rampDur === 0) storm.level = to;
      derive();
    },

    // A roofed place the rain keeps out of, besides the interiors materials.js knows (the gatehouse's corridor):
    // { center (world), out (its horizontal axis), half: Vector3 (along out, up, across) }; null: none.
    setShelter(sh) {
      if (!sh) { RU.uShelterA.value.set(0, 0, 0, 0); return; }
      const l = Math.hypot(sh.out.x, sh.out.z) || 1;
      RU.uShelterA.value.set(sh.center.x, sh.center.y, sh.center.z, sh.half.y);
      RU.uShelterB.value.set(sh.out.x / l, sh.out.z / l, sh.half.x, sh.half.z);
    },

    // A strike now (dev, and the preload): { bolt, near 0..1 }.
    strike(opts = {}) {
      strike = makeStrike(atmo.uTime.value, opts);
      return strike;
    },

    afterAtmosphere() {
      lightning(atmo.uTime.value);
      atmo.uStorm.value = cover;
      // The environment map is rendered from these colours: not while a flash is in them.
      if (lighting) lighting.envHold = flash > 0.002;
      if (cover <= 0 && flash <= 0) return;
      if (cover > 0) {
        overcast(atmo.uZenith.value, 0.45);
        overcast(atmo.uHorizonAway.value, 0.3);
        atmo.uHorizonSun.value.lerp(atmo.uHorizonAway.value, cover);   // no sunset glow through it
        atmo.uSunGlow.value.multiplyScalar(1 - cover);
        atmo.uSunLight.value.multiplyScalar(1 - 0.85 * cover);
        overcast(atmo.uAmbient.value, 0.2);
        atmoState.exposure *= 1 - 0.06 * cover;
      }
      if (flash > 0) {
        skyLum = lum(atmo.uZenith.value);   // (before the flash: the environment map's sky, near enough)
        _c.copy(FLASH_SKY).multiplyScalar(flash);
        atmo.uZenith.value.add(_c);
        atmo.uHorizonAway.value.add(_c);
        atmo.uHorizonSun.value.add(_c);
        atmo.uAmbient.value.add(_c.copy(FLASH_AMB).multiplyScalar(flash));
      }
      updateCloudColor();
    },

    afterSky() {
      sky.stars.value = 1 - cover;
      if (cover <= 0) return;
      sky.moonExt.value.multiplyScalar(1 - cover);
      const con = ctx.constellation;
      if (con) {
        // Scaled from what its own update last wrote: that runs with the updaters, not while the menu is open, and
        // scaling our own result again every frame would fade it out.
        const u = con.points.material.uniforms.uVis;
        if (u.value !== conOut) conBase = u.value;
        u.value = conOut = conBase * (1 - cover);
        con.points.visible = u.value > 0.001;
      }
    },

    afterLighting() {
      if (under || (cover <= 0 && flash <= 0)) return;
      const sun = lighting.sun;
      // Under the overcast what's left of the sun's or the moon's light comes from the whole sky: weaker, from
      // overhead, and more of it as fill.
      _dir.subVectors(sun.position, sun.target.position).normalize().lerp(OVERHEAD, cover * 0.75).normalize();
      _col.copy(sun.color).multiplyScalar(sun.intensity * (1 - 0.6 * cover));
      lighting.hemi.intensity *= 1 + 0.8 * cover;
      if (flash > 0) {
        // Lightning: a cold white light from the flash (never from below the horizon's lip), outweighing the rest.
        _fd.copy(atmo.uFlash.value);
        _fd.y = Math.max(_fd.y, 0.35);
        _fd.normalize();
        const w = FLASH_SUN * flash;
        _dir.multiplyScalar(Math.max(_col.r, _col.g, _col.b)).addScaledVector(_fd, w).normalize();
        _col.add(_c.copy(FLASH_COL).multiplyScalar(w));
        // The environment map keeps the sky from before the flash (it isn't re-rendered through one): its
        // reflections brighten by as much as the sky has.
        scene.environmentIntensity *= Math.min(25, 1 + (flash * lum(FLASH_SKY)) / Math.max(skyLum, 1e-3));
      }
      const inten = Math.max(_col.r, _col.g, _col.b);
      sun.color.copy(_col).multiplyScalar(inten > 0 ? 1 / inten : 0);
      sun.intensity = inten;
      sun.position.copy(sun.target.position).addScaledVector(_dir, 200);
      sun.shadow.autoUpdate = inten > 0.01;
    },

    // elapsed: main.js's clock (the one updateAtmosphere puts in atmo.uTime, which afterAtmosphere times the flashes by).
    update(dt, { under: u = false, elapsed = atmo.uTime.value } = {}) {
      under = u;
      if (previewing) return;
      if (rampT < rampDur) {
        rampT = Math.min(rampDur, rampT + dt);
        const k = rampT / rampDur;
        storm.level = from + (to - from) * k * k * (3 - 2 * k);
      } else {
        storm.level = to;
      }
      derive();

      // The wind: gusting harder (the foliage's sway, materials.js; the rain's slant; the sound).
      gustT += dt;
      const gust = clamp(0.5 + 0.5 * (Math.sin(gustT * 0.29) * 0.6 + Math.sin(gustT * 0.71 + 1.3) * 0.3 + Math.sin(gustT * 1.37 + 0.4) * 0.1), 0, 1);
      atmo.uWindAmp.value = 1 + storm.level * (1.25 + 0.75 * gust);
      if (storm.level !== lastAudio) { lastAudio = storm.level; audio?.setStorm?.(storm.level); }

      // Lightning: strikes while it's stormy enough, one at a time; the first soon after it starts.
      if (strike && elapsed - strike.start > strike.end) strike = null;
      if (sparks <= 0) nextStrike = rng.float(1.5, 3.5);
      else if (!strike && !under) {
        nextStrike -= dt;
        if (nextStrike <= 0) {
          strike = makeStrike(elapsed);
          nextStrike = rng.float(4.5, 12) / (0.4 + 0.6 * sparks);
        }
      }
      // Its thunder, from where it struck (panned as the camera faces now).
      for (let i = thunders.length - 1; i >= 0; i--) {
        const th = thunders[i];
        if (elapsed < th.at) continue;
        thunders.splice(i, 1);
        const e = camera.matrixWorld.elements;
        const dx = th.pos.x - camera.position.x, dz = th.pos.z - camera.position.z;
        const rl = Math.hypot(e[0], e[2]) || 1, dl = Math.hypot(dx, dz) || 1;
        audio?.play?.('thunder', { near: th.near, pan: clamp((dx * e[0] + dz * e[2]) / (dl * rl), -1, 1) });
      }

      // The rain: falling, and drifting with the wind along the world's wind direction.
      const show = wet > 0.001 && !under && !(fx && fx.scope > 0.5);
      rain.visible = show;
      if (show) {
        const w = atmo.uWind.value, wl = w.length() || 1;
        const speed = storm.level * (1.5 + 4 * gust);
        wind.set((w.x / wl) * speed, (w.y / wl) * speed);
        fall = (fall + FALL * dt) % (RAIN_H * 10);
        drift.x = (drift.x + wind.x * dt) % (RAIN_R * 20);
        drift.y = (drift.y + wind.y * dt) % (RAIN_R * 20);
        RU.uRainA.value.z = fall;
        RU.uRainB.value.set(drift.x, drift.y, wind.x, wind.y);
        RU.uRain.value = Math.min(1, wet * 1.2);
        rain.geometry.instanceCount = Math.max(1, Math.round(RAIN_N * Math.sqrt(wet)));
      }
    },

    // For a preload state: on, the full storm at once with a bolt mid-stroke (the next afterAtmosphere / afterSky /
    // afterLighting apply it), rain and bolt drawn; off, back exactly as it was.
    preview(on) {
      if (on && !previewing) {
        previewing = { level: storm.level, from, to, rampT, rampDur, strike, opacity: RU.uRain.value, count: rain.geometry.instanceCount };
        storm.level = to = 1; rampDur = 0;
        derive();
        strike = makeStrike(atmo.uTime.value, { bolt: true, near: 0.6 });
        thunders.pop();
        rain.visible = true;
        RU.uRain.value = 1;
        rain.geometry.instanceCount = RAIN_N;
      } else if (!on && previewing) {
        const p = previewing;
        previewing = null;
        storm.level = p.level;
        ({ from, to, rampT, rampDur, strike } = p);
        derive();
        RU.uRain.value = p.opacity;
        rain.geometry.instanceCount = p.count;
        rain.visible = false;
        bolt.visible = false;
        flash = 0;
        atmo.uFlash.value.w = 0;
        atmo.uStorm.value = cover;
        if (lighting) lighting.envHold = false;
      }
    },
  };
  derive();
  return storm;
}
