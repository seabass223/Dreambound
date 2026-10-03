import * as THREE from 'three';
import { atmo, atmoState, updateCloudColor } from './atmosphere.js';
import { INTERIOR_GLSL } from './materials.js';
import { Rng, clamp, smoothstep } from '../core/rng.js';
import { CLOUD_DECK_Y } from '../config.js';

// The endgame's storm (sequences/descent.js sets it going as the player starts down the stairs): a heavy overcast
// with no stars or moon, rain, lightning and thunder, and the wind up. One level 0..1, eased (set), from which it
// builds: the overcast first, then the rain, then the lightning.
//
// Everything is made here, hidden, before the preloader runs, and costs nothing at level 0. The rain is one instanced
// draw of streaks whose motion is closed-form in the vertex shader (world-fixed drops wrapped into a box round the
// camera, so they never slide with it); the CPU only integrates the fall and the wind drift into two uniforms. The
// bolts are one small strip mesh whose jagged path is worked out here for each strike (so that where it runs is
// known) and written into its vertices. The sky, the cloud sea and the clouds (sky.js, clouds.js) read atmo.uStorm and
// atmo.uFlash: overcast and lightning are uniforms there.
//
// A strike is anywhere from 150 m to 12 km off, and everything about it follows from that distance: a near one is a
// bolt, thick and branching, down into the cloud sea between the stacks, its flash flooding the scene white for a
// few frames and its thunder a crack a moment later; a far one a soft glow somewhere in the overcast, its thunder a
// long roll half a minute behind. The thunder is the sound's (audio.play('thunder', { distance, pan })): played here
// when it arrives, the distance in metres to the nearest point of the strike.
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
// How far off the strikes are (m, to the nearest point of them): near ones, always bolts; the middle distance, bolts
// and sheets; far ones, nearly all sheet lightning in the overcast. P_NEAR and P_MID: how the strikes divide (with a
// near one whenever NEAR_EVERY have gone by without: about 29 % near, 38 % middle, 33 % far). Within each they are
// spread by ratio, so half the near ones are within 300 m: the ones whose thunder is a crack.
const NEAR_MIN = 150, NEAR_MAX = 600, MID_MIN = 1000, MID_MAX = 3000, FAR_MIN = 4000, FAR_MAX = 12000;
const P_NEAR = 0.19, P_MID = 0.535, NEAR_EVERY = 4;
const CLOSE = 800, DISTANT = 3500;   // (which of the three a distance given from outside counts as)
// A bolt: from the cloud base (BOLT_TOP, m) down into the cloud sea, all of it at least CLEAR outside every stack: its
// rim, and below that its wall, which leans out as it goes down (terrain.js cliffRadius: the buttresses, and the whole
// column widening; flare: how far outside the rim it stands `depth` m below the top, at most).
const BOLT_TOP = [650, 900], BOLT_FOOT = CLOUD_DECK_Y - 60;
const CLEAR = 60 + 0.1;   // (a hair over: the mesh's vertices are single floats)
const flare = (depth) => (depth > 0 ? Math.min(36, 6 + 0.09 * depth) : 0);
const TRIES = 24, AHEAD_TRIES = 10, ROUND_TRIES = 17;   // places tried for one: ahead, then anywhere round, then further out
// A strike's light at its first stroke, by its distance d (m): 1 is the cold white of a strike a kilometre off (on the
// ground about the noon sun's, at the night's exposure).
const brightness = (d) => 1.3 * Math.sqrt(1000 / d) * Math.exp(-Math.pow(d / 11000, 1.5));
// Thunder: about how long one lasts by its distance (a near one is over in seconds, a far one rolls on), and how many
// may sound at once: past that the farthest are dropped (never one nearer than THUNDER_KEEP).
const thunderSeconds = (d) => 5 + 14 * (1 - Math.exp(-d / 4000));
const THUNDERS = 3, THUNDER_KEEP = 2500, THUNDER_POOL = 8;
const TAU = Math.PI * 2;
const AUTO = {}, PREVIEW = { bolt: true, distance: 500 };   // makeStrike's options: as the storm draws them; the preload's

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

// A bolt: strip 0 the channel from the cloud base down into the cloud sea, strips 1.. branches: the first few off
// the channel, the rest off those (a near bolt has them all, a far one a few). Its path is straight runs and sharp
// kinks: piecewise-linear noise in three octaves across the line, pinned where it leaves the cloud (and where a branch
// leaves its parent). It is worked out here, per strike, into `pts`, and written into the mesh's vertices (boltMesh):
// position = (s along the strip 0..1, side -1 / 1, strip), aPath the point of the path and how far down the leader's
// way it is, aTan the path's direction there and the strip's brightness (0: not part of this bolt).
const BRANCHES = 10, PRIMARY = 6;
const STRIPS = BRANCHES + 1;
const JAG_F = [6, 17, 47], JAG_W = [1, 0.4, 0.14];
// Where along a strip its points are: at every kink of the three octaves and nowhere else, so the strip is exactly the
// kinked line, its runs straight and its corners sharp however close it is seen from.
const KNOTS = (() => {
  const at = new Set();
  for (const f of JAG_F) for (let i = 0; i <= f; i++) at.add(i / f);
  return Float64Array.from([...at].sort((a, b) => a - b));
})();
const KN = KNOTS.length;        // points to a strip
const POINTS = STRIPS * KN;
const knotAt = (s) => { let b = 0; for (let i = 1; i < KN; i++) if (Math.abs(KNOTS[i] - s) < Math.abs(KNOTS[b] - s)) b = i; return b; };

// 0..1 from three integers.
function h01(i, k, seed) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b) ^ Math.imul(seed + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
// The kinks across a strip at s (into _jx, _jy): k picks the strip's own.
let _jx = 0, _jy = 0;
function jag(s, k, seed) {
  _jx = 0; _jy = 0;
  for (let o = 0; o < 3; o++) {
    const x = s * JAG_F[o], i = Math.floor(x), t = x - i, kk = k + o * 2, w = JAG_W[o];
    const a = h01(i, kk, seed) - 0.5, b = h01(i + 1, kk, seed) - 0.5;
    const c = h01(i, kk + 1, seed) - 0.5, d = h01(i + 1, kk + 1, seed) - 0.5;
    _jx += (a + (b - a) * t) * w;
    _jy += (c + (d - c) * t) * w;
  }
}
// Strip j: from (ax, ay, az) along the unit (dx, dy, dz) for len, kinked by up to amp across it; g0 and g1: how far
// down the leader's way it starts, and how much of the way it spans.
function stripPath(pts, sg, j, ax, ay, az, dx, dy, dz, len, amp, seed, g0, g1) {
  // Across it: X = D x (0, 0, 1), Z = X x D.
  let xx = dy, xy = -dx;
  const xl = Math.hypot(xx, xy) || 1;
  xx /= xl; xy /= xl;
  const zx = xy * dz, zy = -xx * dz, zz = xx * dy - xy * dx;
  const o = j * KN;
  for (let i = 0; i < KN; i++) {
    const s = KNOTS[i];
    jag(s, j * 8, seed);
    const w = amp * smoothstep(0, 0.1, s), p = (o + i) * 3;
    pts[p] = ax + dx * len * s + (xx * _jx + zx * _jy) * w;
    pts[p + 1] = ay + dy * len * s + (xy * _jx + zy * _jy) * w;
    pts[p + 2] = az + dz * len * s + zz * _jy * w;
    sg[o + i] = g0 + g1 * s;
  }
}
// The channel of strike s (its ends s.a and s.b, its seed), and its branch j (after the channel and the branches
// before it; returns the strip it leaves): a primary one from somewhere down the channel, splaying off downward, a
// later one from a primary the same way. fr: each strip's direction and length. The same strike gives the same bolt.
function channelPath(s, pts, sg, fr) {
  let dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z;
  const L = Math.hypot(dx, dy, dz) || 1;
  dx /= L; dy /= L; dz /= L;
  fr[0] = dx; fr[1] = dy; fr[2] = dz; fr[3] = L;
  stripPath(pts, sg, 0, s.a.x, s.a.y, s.a.z, dx, dy, dz, L, L * 0.13, s.seed, 0, 1);
}
function branchPath(s, j, pts, sg, fr) {
  const seed = s.seed, sub = j > s.prim;
  const pj = sub ? 1 + Math.min(s.prim - 1, Math.floor(h01(j, 105, seed) * s.prim)) : 0;
  const q = pj * 4;
  const i0 = knotAt(sub ? 0.2 + 0.5 * h01(j, 101, seed) : 0.1 + s.reach * h01(j, 101, seed));
  const o = (pj * KN + i0) * 3;
  const px = fr[q], py = fr[q + 1], pz = fr[q + 2];
  let xx = py, xy = -px;
  const xl = Math.hypot(xx, xy) || 1;
  xx /= xl; xy /= xl;
  const zx = xy * pz, zy = -xx * pz, zz = xx * py - xy * px;
  const ang = 6.2832 * h01(j, 103, seed), spread = 0.6 + 0.6 * h01(j, 104, seed);
  const c = Math.cos(ang) * spread, sn = Math.sin(ang) * spread;
  let dx = px + xx * c + zx * sn, dy = py + xy * c + zy * sn, dz = pz + zz * sn;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const len = fr[q + 3] * (sub ? 0.3 + 0.3 * h01(j, 102, seed) : 0.16 + 0.22 * h01(j, 102, seed));
  fr[j * 4] = dx; fr[j * 4 + 1] = dy; fr[j * 4 + 2] = dz; fr[j * 4 + 3] = len;
  stripPath(pts, sg, j, pts[o], pts[o + 1], pts[o + 2], dx, dy, dz, len, len * 0.22, seed, sg[pj * KN + i0], len / fr[3]);
  return pj;
}
// The nearest point of strip j to (cx, cy, cz): its distance, the point into _qx, _qy, _qz.
let _qx = 0, _qy = 0, _qz = 0;
function nearestOn(pts, j, cx, cy, cz) {
  const o = j * KN;
  let best = Infinity;
  for (let i = 0; i < KN - 1; i++) {
    const p = (o + i) * 3;
    const ex = pts[p + 3] - pts[p], ey = pts[p + 4] - pts[p + 1], ez = pts[p + 5] - pts[p + 2];
    const t = clamp(((cx - pts[p]) * ex + (cy - pts[p + 1]) * ey + (cz - pts[p + 2]) * ez) / Math.max(ex * ex + ey * ey + ez * ez, 1e-9), 0, 1);
    const x = pts[p] + ex * t, y = pts[p + 1] + ey * t, z = pts[p + 2] + ez * t;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
    if (d < best) { best = d; _qx = x; _qy = y; _qz = z; }
  }
  return Math.sqrt(best);
}
// How far outside the stacks strip j keeps, at the nearest: every run of it, against each stack's rim (rims: x, z,
// radius and top for each of n) and, below the top, its wall there (at the run's lower end: the wider).
function clearOf(pts, j, rims, n) {
  const o = j * KN;
  let best = Infinity;
  for (let i = 0; i < KN - 1; i++) {
    const p = (o + i) * 3;
    const ex = pts[p + 3] - pts[p], ez = pts[p + 5] - pts[p + 2], el = Math.max(ex * ex + ez * ez, 1e-9);
    const low = Math.min(pts[p + 1], pts[p + 4]);
    for (let k = 0; k < n; k++) {
      const q = k * 4, ax = pts[p] - rims[q], az = pts[p + 2] - rims[q + 1];
      const t = clamp(-(ax * ex + az * ez) / el, 0, 1);
      best = Math.min(best, Math.hypot(ax + ex * t, az + ez * t) - rims[q + 2] - flare(rims[q + 3] - low));
    }
  }
  return best;
}

const boltVert = /* glsl */ `
uniform float uBoltI;     // brightness now
uniform float uBoltLen;   // how far down it has come (the leader), 0..1
uniform float uBranch;    // the branches' brightness (the first stroke's: later strokes follow the main channel)
uniform float uBoltW;     // how thick it is drawn: 1 far off, more close by (while it is bright)
uniform float uPxH;
attribute vec4 aPath;
attribute vec4 aTan;
varying float vSide;
varying float vI;
void main() {
  float s = position.x, sideSign = position.y, j = position.z;
  vSide = sideSign;
  vI = 0.0;
  if (aTan.w <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }   // not in this bolt: clipped, the whole strip
  float I = 1.0, halfPx = 4.0;
  if (j > 0.5) {
    // A branch: fading toward its tip.
    I = uBranch * 0.55 * pow(1.0 - s, 1.3);
    halfPx = 2.6;
  }
  vec3 P = aPath.xyz;
  float sg = aPath.w;
  vec3 toCam = cameraPosition - P;
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float z = max(dot(-toCam, fwd), 1.0);
  float pxM = 0.5 * uPxH * projectionMatrix[1][1] / z;
  // A ribbon a few pixels wide facing the camera, whatever the distance (wider for one close by).
  vec3 W = P + normalize(cross(aTan.xyz, toCam) + vec3(1e-6, 0.0, 0.0)) * sideSign * halfPx * uBoltW / pxM;
  gl_Position = projectionMatrix * viewMatrix * vec4(W, 1.0);
  // Drawn down to the leader's tip, out of the cloud base, dimmer through the rain the farther it is.
  float lit = 1.0 - smoothstep(uBoltLen - 0.03, uBoltLen, sg);
  float range = length(toCam);
  vI = uBoltI * I * aTan.w * lit * smoothstep(0.0, 0.06, sg)
    * mix(1.0, 0.55, smoothstep(1500.0, 4000.0, range)) * mix(1.0, 0.4, smoothstep(4000.0, 9000.0, range));
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
  for (let j = 0; j < STRIPS; j++) {
    const base = pos.length / 3;
    for (let i = 0; i < KN; i++) pos.push(KNOTS[i], -1, j, KNOTS[i], 1, j);
    for (let i = 0; i < KN - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // The path, rewritten at each strike (two vertices to a point of it).
  for (const name of ['aPath', 'aTan']) {
    const attr = new THREE.BufferAttribute(new Float32Array(POINTS * 2 * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
  }
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    name: 'storm:bolt',
    uniforms: {
      uPxH: atmo.uPxH,
      uBoltI: { value: 0 },
      uBoltLen: { value: 0 },
      uBranch: { value: 0 },
      uBoltW: { value: 1 },
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
  mesh.frustumCulled = false;   // its vertices are wherever the strike is, hundreds of metres to kilometres out
  mesh.raycast = () => {};
  mesh.renderOrder = 7;
  mesh.visible = false;
  return mesh;
}

// A strike's light over time t (s from its start), relative to its first stroke's: the stepped leader's faint glow
// coming down, then its return strokes (each a rise and a decay, near-instant and fast for a strike close by, softer
// for a far one's glow in the cloud; the later ones weaker), one with a longer, softer glow after it (a continuing
// current). Returns the flash, and fills `out` with the bolt's own brightness, its leader's progress and its branches'.
const RISE = 0.008;
const MAX_STROKES = 6;
const strokeAt = (k, t) => { const x = t - k.t; return x < 0 ? 0 : k.a * (x < k.rise ? x / k.rise : Math.exp(-(x - k.rise) / k.tau)); };
function strikeLight(s, t, out) {
  let f = 0;
  for (let i = 0; i < s.n; i++) f += strokeAt(s.strokes[i], t);
  const lead = clamp(t / s.leader, 0, 1);
  out.bolt = f;
  out.len = t < s.leader ? lead : 1;
  out.branch = t < s.leader ? 0.6 : strokeAt(s.strokes[0], t) / Math.max(s.strokes[0].a, 1e-3);
  if (t >= 0 && t < s.leader) { f += 0.05 * lead; out.bolt = 0.22; }
  return f;
}
// A strike, filled in by makeStrike (two are kept: the one under way, and the preload's).
const newStrike = () => ({
  start: 0, end: 0, leader: 0.06,
  n: 0, strokes: Array.from({ length: MAX_STROKES }, () => ({ t: 0, a: 0, tau: 0.05, rise: RISE })),
  bolt: false,
  dist: 0,                     // m, from the camera to the nearest point of it as it struck
  delay: 0,                    // s from its start to its thunder
  glow: 0, flood: 0, wash: 0,  // its light at the first stroke: in the cloud round it, on the scene, over the whole sky
  boltI: 0, width: 1,          // the bolt's own brightness and thickness
  pos: new THREE.Vector3(),    // where its light is: the flash is toward it
  from: new THREE.Vector3(),   // the nearest point of it: where its thunder comes from
  // A bolt's path: the channel's ends, its seed, how many branches leave the channel, how many strips there are
  // besides it, how far down it they leave, and the ones left out (a bit each).
  a: new THREE.Vector3(), b: new THREE.Vector3(), seed: 0, prim: 0, branches: 0, reach: 0.55, pruned: 0,
  tries: 0,                    // how many places were tried for it
});

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
  // Lightning: the strike under way, when the next one comes, whether that is the storm's first, and how many have
  // gone by since a near one.
  let strike = null, nextStrike = 2, opening = true, sinceNear = 0;
  // Its light this frame: in the cloud round it (atmo.uFlash.w), on the scene, and over the whole sky.
  let flash = 0, flood = 0, wash = 0, envCap = 25;
  let previewing = null;
  const live = newStrike(), spare = newStrike();
  const light = { bolt: 0, len: 0, branch: 0 };
  // A bolt's path as worked out (its points, how far down the leader's way each is, each strip's direction and length),
  // the mesh's copy of it, and the stacks' rims it keeps clear of.
  const pts = new Float64Array(POINTS * 3), sg = new Float64Array(POINTS), fr = new Float64Array(STRIPS * 4);
  const aPath = bolt.geometry.attributes.aPath, aTan = bolt.geometry.attributes.aTan;
  const rims = new Float64Array(4 * 16);
  let nRims = 0;
  // The thunder on its way and sounding: when it arrives and about when it ends, how far off its strike was, and
  // where (x, z).
  const thState = new Uint8Array(THUNDER_POOL);   // 0: free, 1: on its way, 2: sounding
  const thAt = new Float64Array(THUNDER_POOL), thEnd = new Float64Array(THUNDER_POOL), thDist = new Float64Array(THUNDER_POOL);
  const thX = new Float64Array(THUNDER_POOL), thZ = new Float64Array(THUNDER_POOL);
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

  // How far off the next strike is: near, the middle distance or far (by ratio within each). The storm's first is near
  // or not far past it, and then the next is near: the crack is met early, within its first two strikes.
  let nearHeld = false;
  function pickDistance(first) {
    const u = rng.next(), v = rng.next(), w = rng.next();
    let band = first ? (u < 0.6 ? 0 : 1) : sinceNear >= NEAR_EVERY || u < P_NEAR ? 0 : w < P_MID ? 1 : 2;
    if (nearHeld && band === 0) band = 1;   // (holdNear: the near ones wait)
    sinceNear = band === 0 ? 0 : first ? NEAR_EVERY : sinceNear + 1;
    if (band === 0) return (NEAR_MIN + 5) * Math.pow(NEAR_MAX / (NEAR_MIN + 5), v);
    if (band === 1) return MID_MIN * Math.pow(first ? 2 : MID_MAX / MID_MIN, v);
    return FAR_MIN * Math.pow(FAR_MAX / FAR_MIN, v);
  }

  function readRims() {
    nRims = 0;
    const S = ctx.stacks;
    if (!S) return;
    for (const k in S) {
      const st = S[k];
      if (!st || !(st.r > 0) || nRims >= 16) continue;
      rims[nRims * 4] = st.cx;
      rims[nRims * 4 + 1] = st.cz;
      rims[nRims * 4 + 2] = st.r * (1 + (st.edgeAmp ?? 0.07));
      rims[nRims * 4 + 3] = st.top ?? 0;
      nRims++;
    }
  }

  // The channel (as worked out) and strike s's ends moved by (ox, oz).
  function shift(s, ox, oz) {
    s.a.x += ox; s.a.z += oz;
    s.b.x += ox; s.b.z += oz;
    for (let i = 0; i < KN; i++) { pts[i * 3] += ox; pts[i * 3 + 2] += oz; }
  }

  // A bolt for strike s, from the cloud base down into the sea, leaning a little, coming down past the eye's height
  // toward az with the nearest point of it d away. False if there's no room for it there: all of it keeps CLEAR of
  // every stack (it may come down between two).
  function placeBolt(s, az, d) {
    const cam = camera.position;
    const top = rng.float(BOLT_TOP[0], BOLT_TOP[1]), lean = Math.min(250, 60 + 0.25 * d);
    const lx = rng.float(-lean, lean), lz = rng.float(-lean, lean);
    const sc = clamp((top - cam.y) / (top - BOLT_FOOT), 0, 1);   // how far down it the eye's height is
    const cx = cam.x + Math.sin(az) * d, cz = cam.z + Math.cos(az) * d;
    s.a.set(cx - lx * sc, top, cz - lz * sc);
    s.b.set(cx + lx * (1 - sc), BOLT_FOOT, cz + lz * (1 - sc));
    s.seed = (rng.next() * 0x7fffffff) | 0;
    channelPath(s, pts, sg, fr);
    const ic = knotAt(sc) * 3;
    shift(s, cx - pts[ic], cz - pts[ic + 2]);
    // In or out, until its nearest point is d away.
    for (let i = 0; i < 4; i++) {
      const dn = nearestOn(pts, 0, cam.x, cam.y, cam.z);
      if (Math.abs(dn - d) < 0.005 * d) break;
      const hx = _qx - cam.x, hz = _qz - cam.z, hl = Math.hypot(hx, hz);
      if (hl < 1e-3) return false;
      const m = clamp(((d - dn) * dn) / Math.max(hl, 0.25 * dn), -d, d);
      shift(s, (hx / hl) * m, (hz / hl) * m);
    }
    const dn = nearestOn(pts, 0, cam.x, cam.y, cam.z);
    if (Math.abs(dn - d) > 0.03 * d || clearOf(pts, 0, rims, nRims) < CLEAR) return false;
    s.dist = dn;
    s.from.set(_qx, _qy, _qz);
    // Its branches: not one that would come near a stack, or much nearer the eye than the channel does (or one off
    // such a one).
    s.pruned = 0;
    for (let j = 1; j <= s.branches; j++) {
      const pj = branchPath(s, j, pts, sg, fr);
      if ((s.pruned >> pj) & 1) { s.pruned |= 1 << j; continue; }
      const bd = nearestOn(pts, j, cam.x, cam.y, cam.z);
      if (bd < 0.8 * dn || bd < NEAR_MIN || clearOf(pts, j, rims, nRims) < CLEAR) { s.pruned |= 1 << j; continue; }
      if (bd < s.dist) { s.dist = bd; s.from.set(_qx, _qy, _qz); }
    }
    return true;
  }

  // Strike s's bolt into the mesh (again: worked out again first, from the strike: it is the same one).
  function boltInto(s, again) {
    if (again) {
      channelPath(s, pts, sg, fr);
      for (let j = 1; j <= s.branches; j++) branchPath(s, j, pts, sg, fr);
    }
    const P = aPath.array, T = aTan.array;
    for (let j = 0; j < STRIPS; j++) {
      const o = j * KN;
      if (j > s.branches) {
        // Not in this bolt: all of it at the channel's top, not drawn.
        for (let q = o * 8; q < (o + KN) * 8; q += 4) {
          P[q] = s.a.x; P[q + 1] = s.a.y; P[q + 2] = s.a.z; P[q + 3] = 0;
          T[q] = 0; T[q + 1] = -1; T[q + 2] = 0; T[q + 3] = 0;
        }
        continue;
      }
      const w = (s.pruned >> j) & 1 ? 0 : j > s.prim ? 0.7 : 1;
      for (let i = 0; i < KN; i++) {
        // Its direction at a corner: between the run that arrives and the one that leaves.
        const p = (o + i) * 3, p0 = (o + Math.max(i - 1, 0)) * 3, p1 = (o + Math.min(i + 1, KN - 1)) * 3;
        let ax = pts[p] - pts[p0], ay = pts[p + 1] - pts[p0 + 1], az = pts[p + 2] - pts[p0 + 2];
        const bx = pts[p1] - pts[p], by = pts[p1 + 1] - pts[p + 1], bz = pts[p1 + 2] - pts[p + 2];
        const al = Math.hypot(ax, ay, az) || 1, bl = Math.hypot(bx, by, bz) || 1;
        ax = ax / al + bx / bl; ay = ay / al + by / bl; az = az / al + bz / bl;
        const tl = Math.hypot(ax, ay, az) || 1;
        for (let v = 0; v < 2; v++) {
          const q = ((o + i) * 2 + v) * 4;
          P[q] = pts[p]; P[q + 1] = pts[p + 1]; P[q + 2] = pts[p + 2]; P[q + 3] = sg[o + i];
          T[q] = ax / tl; T[q + 1] = ay / tl; T[q + 2] = az / tl; T[q + 3] = w;
        }
      }
    }
    aPath.needsUpdate = true;
    aTan.needsUpdate = true;
  }

  // A strike's thunder, on its way: to arrive at `at`, from a strike `dist` off at (x, z). No more than THUNDERS sound
  // at once: if this one would make it more, the farthest of this and those still on their way is dropped instead
  // (never one nearer than THUNDER_KEEP: a near strike's crack always comes).
  function queueThunder(at, dist, x, z) {
    const end = at + thunderSeconds(dist);
    let most = 0, far = -1, free = -1;
    for (let i = 0; i < THUNDER_POOL; i++) {
      if (thState[i] === 0) { if (free < 0) free = i; continue; }
      if (thAt[i] >= end || thEnd[i] <= at) continue;
      if (thState[i] === 1 && thDist[i] >= THUNDER_KEEP && (far < 0 || thDist[i] > thDist[far])) far = i;
      // How many are sounding as this one starts (or as the new one does, if that's later).
      const t0 = Math.max(at, thAt[i]);
      let c = 0;
      for (let k = 0; k < THUNDER_POOL; k++) if (thState[k] !== 0 && thAt[k] <= t0 && thEnd[k] > t0) c++;
      most = Math.max(most, c);
    }
    if (most >= THUNDERS || free < 0) {
      if (far >= 0 && thDist[far] > dist) free = far;
      else if (dist >= THUNDER_KEEP || free < 0) return;
    }
    thState[free] = 1;
    thAt[free] = at; thEnd[free] = end; thDist[free] = dist;
    thX[free] = x; thZ[free] = z;
  }

  // A strike at `elapsed`, into s. How far off: opts.distance (m), or the old opts.near (0..1: 1 close by), or as the
  // storm draws them (pickDistance). A bolt or a sheet of light in the overcast: opts.bolt, or by the distance (a near
  // one is always a bolt, a far one nearly always a sheet). Its light and its strokes follow from the distance, and
  // its thunder comes that much later (not if quiet).
  function makeStrike(elapsed, opts = AUTO, s = live, quiet = false, first = false) {
    const cam = camera.position;
    let d = opts.distance != null ? +opts.distance
      : opts.near != null ? NEAR_MIN * Math.pow(FAR_MAX / NEAR_MIN, 1 - clamp(+opts.near || 0, 0, 1))
        : pickDistance(first);
    d = clamp(d || MID_MIN, 100, 15000);
    const near = d < CLOSE;
    const isBolt = opts.bolt != null ? !!opts.bolt : near || (d < DISTANT ? first || rng.next() < 0.6 : d < 7000 && rng.next() < 0.15);
    // Where: mostly somewhere ahead so it's seen (a near bolt within the view itself; the storm's first always),
    // otherwise anywhere round.
    const fwd = camera.getWorldDirection(_v);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const spread = isBolt && (near || first) ? 0.8 * clamp(Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), 0.45, 1.1) : 1.1;
    const ahead = Math.hypot(fwd.x, fwd.z) > 0.2 && (rng.next() < (isBolt ? (near ? 0.8 : 0.75) : 0.4) || first);
    const az = ahead ? yaw + rng.float(-spread, spread) : rng.float(0, TAU);
    s.start = elapsed;
    s.bolt = false;
    s.tries = 0;
    if (isBolt) {
      // More of it the nearer it is: branches off the channel, and off those.
      s.prim = near ? PRIMARY : d < DISTANT ? 4 : 3;
      s.branches = near ? BRANCHES : s.prim;
      s.reach = near ? 0.7 : 0.55;
      readRims();
      for (let k = 0; k < TRIES && !s.bolt; k++) {
        // No room for it there: somewhere else ahead, then anywhere round, then a little further out each time.
        const toward = k === 0 ? az : ahead && k < AHEAD_TRIES ? yaw + rng.float(-spread, spread) : rng.float(0, TAU);
        s.bolt = placeBolt(s, toward, k < ROUND_TRIES ? d : d * (1 + 0.15 * (k - ROUND_TRIES + 1)));
        s.tries++;
      }
      if (s.bolt) {
        boltInto(s, false);
        // Its light: from where it is some 40 degrees up the sky, toward the cloud it came out of (its top, for all
        // but a near one).
        const want = cam.y + 0.9 * s.dist;
        let bi = 3;
        for (let i = 4; i < KN; i++) if (Math.abs(pts[i * 3 + 1] - want) < Math.abs(pts[bi * 3 + 1] - want)) bi = i;
        s.pos.set(pts[bi * 3], pts[bi * 3 + 1], pts[bi * 3 + 2]);
      } else d = Math.max(d, MID_MIN);   // (nowhere: a sheet, further off)
    }
    if (!s.bolt) {
      // A sheet: a point in the overcast d away, higher in it the farther off (so it shows above the horizon's haze).
      const up = d > DISTANT ? rng.float(1200, 3000) : rng.float(650, 1100);
      const h = Math.sqrt(Math.max(d * d - up * up, 0.09 * d * d));
      s.pos.set(cam.x + Math.sin(az) * h, cam.y + Math.sqrt(d * d - h * h), cam.z + Math.cos(az) * h);
      s.from.copy(s.pos);
      s.dist = d;
    }
    // Its light. Close by it is blinding: the ground lit harder than at noon and the whole sky washed pale, for the
    // frame or two of each stroke; the glow in the cloud round it and the bolt's own brightness stop short of that, so
    // the bolt still shows against the sky. Far off the wash and the light on the ground fall away, and what's left is
    // a glow in the cloud where it struck.
    const g = brightness(s.dist);
    s.glow = Math.min(g, 1.15);
    s.flood = Math.min(g, 2.4) * (1 - 0.8 * smoothstep(2500, 7000, s.dist));
    s.wash = s.flood * (1 + 1.5 * (1 - smoothstep(250, 1200, s.dist)));
    s.boltI = Math.min(g, 1.5);
    s.width = 1 + 1.6 * (1 - smoothstep(200, 1500, s.dist));
    // Its strokes: 3..5 close by, 2..4 otherwise, each weaker than the last; sharp, or for a far one soft and slow.
    const soft = smoothstep(3000, 8000, s.dist), sharp = 1 - 0.3 * (1 - smoothstep(300, 1200, s.dist));
    const n = s.dist < CLOSE ? rng.int(3, 5) : rng.next() < 0.3 ? 4 : rng.next() < 0.6 ? 3 : 2;
    s.leader = rng.float(0.045, 0.09);
    let t = s.leader, a = rng.float(0.85, 1.15);
    for (let i = 0; i < n; i++) {
      const k = s.strokes[i];
      k.t = t; k.a = a;
      k.tau = rng.float(0.035, 0.07) * (1 + 1.6 * soft) * sharp;
      k.rise = RISE + 0.035 * soft;
      t += rng.float(0.05, 0.17) * (1 + 0.6 * soft);
      a *= rng.float(0.5, 0.9);
    }
    const cc = s.strokes[rng.int(0, n - 1)], after = s.strokes[n];
    after.t = cc.t + 0.012; after.a = cc.a * 0.28; after.tau = rng.float(0.15, 0.3); after.rise = cc.rise;
    s.n = n + 1;
    s.end = t + 1.4;
    // Its thunder: from the first return stroke, at the speed of sound.
    s.delay = s.leader + s.dist / SOUND;
    if (!quiet) queueThunder(elapsed + s.delay, s.dist, s.from.x, s.from.z);
    return s;
  }

  // This frame's lightning, at time `now` (atmo.uTime: main.js's elapsed), into atmo.uFlash and the bolt.
  function lightning(now) {
    flash = flood = wash = 0;
    let boltOn = false;
    if (strike && !under) {
      const t = previewing ? strike.strokes[0].t + strike.strokes[0].rise * 0.5 : now - strike.start;
      const f = strikeLight(strike, t, light);
      // A ragged flicker on top of the strokes.
      const lit = f > 0.001 ? f * (previewing ? 1 : rng.float(0.86, 1.14)) : 0;
      flash = lit * strike.glow;
      flood = lit * strike.flood;
      wash = lit * strike.wash;
      envCap = 25 * Math.max(1, strike.flood);
      if (strike.bolt && (light.bolt > 0.002 || t < strike.leader)) {
        boltOn = t >= 0;
        BU.uBoltI.value = light.bolt * strike.boltI;
        BU.uBoltLen.value = light.len;
        BU.uBranch.value = light.branch;
        // A near one's thickness is its glare: the leader's and the strokes', not the faint channel between them.
        BU.uBoltW.value = 1 + (strike.width - 1) * smoothstep(0, 0.15, light.bolt);
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
    get lightning() { return strike; },   // the strike under way (null between them): as strike() returns it
    // No near strikes while on (the ending's alarm: a crack right overhead would drown it, and overdrive the output
    // on top of it); those already struck still thunder.
    holdNear(on) { nearHeld = !!on; },

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

    // A strike now (dev): { distance (m, 100..15000), bolt } or the old { near 0..1 }; without, as the storm draws
    // them. Returns it: dist (m, to the nearest point of it), delay (s, to its thunder), bolt, pos, from.
    strike(opts) {
      strike = makeStrike(atmo.uTime.value, opts || AUTO);
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
        _c.copy(FLASH_SKY).multiplyScalar(wash);
        atmo.uZenith.value.add(_c);
        atmo.uHorizonAway.value.add(_c);
        atmo.uHorizonSun.value.add(_c);
        atmo.uAmbient.value.add(_c.copy(FLASH_AMB).multiplyScalar(flood));
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
        const w = FLASH_SUN * flood;
        _dir.multiplyScalar(Math.max(_col.r, _col.g, _col.b)).addScaledVector(_fd, w).normalize();
        _col.add(_c.copy(FLASH_COL).multiplyScalar(w));
        // The environment map keeps the sky from before the flash (it isn't re-rendered through one): its
        // reflections brighten by as much as the sky has (within reason: more for a strike close by).
        scene.environmentIntensity *= Math.min(envCap, 1 + (wash * lum(FLASH_SKY)) / Math.max(skyLum, 1e-3));
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
      if (sparks <= 0) { nextStrike = rng.float(1.5, 3.5); opening = true; }
      else if (!strike && !under) {
        nextStrike -= dt;
        if (nextStrike <= 0) {
          strike = makeStrike(elapsed, AUTO, live, false, opening);
          opening = false;
          nextStrike = rng.float(4.5, 12) / (0.4 + 0.6 * sparks);
        }
      }
      // The thunder, each as it arrives: how far off its strike was, and where that is now, left to right (panned as
      // the camera faces now). None underground (and none that a stalled clock has made late).
      for (let i = 0; i < THUNDER_POOL; i++) {
        if (thState[i] === 2) { if (elapsed >= thEnd[i]) thState[i] = 0; continue; }
        if (thState[i] !== 1 || elapsed < thAt[i]) continue;
        if (under || elapsed - thAt[i] > 2) { thState[i] = 0; continue; }
        thState[i] = 2;
        const e = camera.matrixWorld.elements;
        const dx = thX[i] - camera.position.x, dz = thZ[i] - camera.position.z;
        const rl = Math.hypot(e[0], e[2]) || 1, dl = Math.hypot(dx, dz) || 1;
        audio?.play?.('thunder', { distance: thDist[i], pan: clamp((dx * e[0] + dz * e[2]) / (dl * rl), -1, 1) });
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

    // For a preload state: on, the full storm at once with a near bolt mid-stroke (the next afterAtmosphere /
    // afterSky / afterLighting apply it), rain and bolt drawn; off, back exactly as it was (a strike under way and
    // its bolt too; the preview's has no thunder).
    preview(on) {
      if (on && !previewing) {
        previewing = { level: storm.level, from, to, rampT, rampDur, strike, opacity: RU.uRain.value, count: rain.geometry.instanceCount };
        storm.level = to = 1; rampDur = 0;
        derive();
        strike = makeStrike(atmo.uTime.value, PREVIEW, spare, true);
        rain.visible = true;
        RU.uRain.value = 1;
        rain.geometry.instanceCount = RAIN_N;
      } else if (!on && previewing) {
        const p = previewing;
        previewing = null;
        storm.level = p.level;
        ({ from, to, rampT, rampDur, strike } = p);
        if (strike && strike.bolt) boltInto(strike, true);   // (the mesh held the preview's)
        derive();
        RU.uRain.value = p.opacity;
        rain.geometry.instanceCount = p.count;
        rain.visible = false;
        bolt.visible = false;
        flash = flood = wash = 0;
        atmo.uFlash.value.w = 0;
        atmo.uStorm.value = cover;
        if (lighting) lighting.envHold = false;
      }
    },
  };
  derive();
  return storm;
}
