import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { Rng } from '../core/rng.js';
import { SKY_TARGET, VIEW_DROP } from '../world/skyTarget.js';
import { ROCK_TARGETS } from '../world/rockPuzzle.js';

// The Rocks constellation: a star map of the Rocks stack, fixed in the sky where the Mountain observatory's eyepiece
// looks with the telescope on SKY_TARGET (the roof station's pointers). Dim stars trace the island's rim and the creek
// from the tor's pool to the waterfall lip; five bright ones stand on ROCK_TARGETS, where the boulders must go.
//
// Plan view, as seen from above with north (+Z) up, like the station's compass ring from its deck: on the eyepiece,
// map +Z is up (toward the zenith) and map -X (heading 90) is to the right. The island's centre is on the crosshair;
// SCALE deg per metre makes the rim (48-52 m out) about 1.1 deg off it, 2.3 deg across, inside the eyepiece's
// 2.5 deg of sky. Fixed to the world (not the turning star field), so it never drifts. Visible from sunset (fading in
// as the sun drops through 8 deg, before the ordinary stars) through the night; gone by day. One draw call.

export const SCALE = 0.022;   // deg of sky per metre of island
const D2R = Math.PI / 180;

// The eyepiece's line of sight for a telescope yaw / pitch (props/observatory.js scopeView), and its screen axes.
export function scopeAxes(yaw = SKY_TARGET.yaw, pitch = SKY_TARGET.pitch) {
  const vp = pitch - VIEW_DROP;
  const view = new THREE.Vector3(Math.cos(yaw) * Math.cos(vp), Math.sin(vp), Math.sin(yaw) * Math.cos(vp));
  const right = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, view);
  return { view, right, up };
}
const AXES = scopeAxes();
export const CENTER_DIR = AXES.view.clone();

// Sky direction of a point on the map (Rocks-local x, z, metres from the stack's centre): gnomonic, as the eyepiece
// projects, so the figure is undistorted there.
export function starDirection(x, z, out = new THREE.Vector3()) {
  const k = Math.tan(SCALE * D2R);
  return out.copy(AXES.view).addScaledVector(AXES.right, -x * k).addScaledVector(AXES.up, z * k).normalize();
}

// The stars, in map coordinates: { x, z, mag (brightness), kind: 'rim' | 'creek' | 'target' }. stack: the Rocks Stack
// (edgeR); stream: its creek Path (ctx.streamPath), in world coordinates.
export function constellationStars(stack, stream) {
  const rng = new Rng(4242);
  const cx = stack.cfg.x, cz = stack.cfg.z;
  const stars = [];
  // The rim: every 5 deg, a little ragged so it reads as stars rather than a dotted line.
  for (let k = 0; k < 72; k++) {
    const th = (k * 5 + rng.float(-1.4, 1.4)) * D2R;
    const r = stack.edgeR(th) - 0.8 + rng.float(-0.6, 0.6);
    stars.push({ x: Math.cos(th) * r, z: Math.sin(th) * r, mag: rng.float(0.45, 0.8), kind: 'rim' });
  }
  // The creek, from the pool (3 m along the path) to the lip (the path runs on 2.1 m past it).
  const t0 = 3, t1 = stream.total - 2.1, n = Math.round((t1 - t0) / 3.9);
  for (let i = 0; i <= n; i++) {
    const t = THREE.MathUtils.clamp(t0 + ((t1 - t0) * i) / n + (i > 0 && i < n ? rng.float(-0.4, 0.4) : 0), t0, t1);
    const p = stream.pointAt(t), len = Math.hypot(p.dx, p.dz) || 1, o = rng.float(-0.35, 0.35);
    stars.push({ x: p.x - cx - (p.dz / len) * o, z: p.z - cz + (p.dx / len) * o, mag: rng.float(0.6, 0.85), kind: 'creek' });
  }
  for (const t of ROCK_TARGETS) stars.push({ x: t.x, z: t.z, mag: 1, kind: 'target' });
  return stars;
}

const vert = /* glsl */ `
attribute vec3 aStar;          // brightness, 0 dim / 1 bright, twinkle phase
uniform float uPxH, uTime, uNight;
varying float vB, vBig, vSigma, vSize;
varying vec3 vCol;
void main() {
  // At infinity (only the view's rotation, so it never parallaxes), pinned to the far plane like the sky.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
  // Through the telescope (projectionMatrix[1][1] = 1 / tan(fov / 2): 1.5 by eye, 36 at the eyepiece) the stars are
  // sharp points; by eye there is nothing to see (not even the bright ones as a faint knot: it gave the place away).
  float zoom = smoothstep(4.0, 20.0, projectionMatrix[1][1]);
  float px = uPxH / 1080.0;
  vBig = aStar.y * zoom;
  vSigma = max(0.6, px * mix(0.75, 1.25, vBig));
  vSize = ceil(vSigma * mix(6.0, 18.0, vBig)) + 1.0;
  gl_PointSize = vSize;
  float tw = 0.88 + 0.12 * sin(uTime * (1.3 + aStar.z * 0.9) + aStar.z * 17.0);
  // In the dusk sky the eyepiece darkens the sky, not the stars (they are points): lift them against it.
  float dusk = mix(mix(4.0, 2.2, aStar.y), 1.0, uNight);
  vB = aStar.x * tw * dusk * zoom;
  vCol = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.93, 0.8), aStar.y);
}
`;

const frag = /* glsl */ `
uniform float uVis;
varying float vB, vBig, vSigma, vSize;
varying vec3 vCol;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(c, c);
  float s2 = vSigma * vSigma;
  float core = exp(-r2 / (2.0 * s2));
  float halo = exp(-r2 / (18.0 * s2)) * 0.12 * vBig;   // a soft glow round the bright ones only
  float v = (core + halo) * vB * uVis;
  if (v < 0.002) discard;
  gl_FragColor = vec4(vCol * v, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Adds the constellation to the surface (hidden underground with it). Needs the Rocks stack and ctx.streamPath.
export function createConstellation(ctx) {
  const stack = ctx.stacks.rocks, stream = ctx.streamPath;
  if (!stack || !stream) return null;
  const stars = constellationStars(stack, stream);
  const rng = new Rng(77);
  const pos = new Float32Array(stars.length * 3), attr = new Float32Array(stars.length * 3);
  const d = new THREE.Vector3();
  stars.forEach((s, i) => {
    starDirection(s.x, s.z, d).toArray(pos, i * 3);
    const big = s.kind === 'target';
    attr.set([big ? 2.6 : s.mag * 0.55, big ? 1 : 0, rng.float(0, 6.28)], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aStar', new THREE.BufferAttribute(attr, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPxH: atmo.uPxH, uTime: atmo.uTime, uNight: atmo.uNight, uVis: { value: 0 } },
    vertexShader: vert, fragmentShader: frag,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'constellation';
  points.frustumCulled = false;
  points.renderOrder = -9;   // right after the sky; the land drawn later covers it
  ctx.surface.add(points);
  // Fades in as the sun sets through 8 deg (the eyepiece shows it in the dusk sky), out again at dawn.
  const update = () => {
    const y = atmo.uSunDir.value.y;
    const v = 1 - THREE.MathUtils.smoothstep(y, -0.02, 0.14);
    mat.uniforms.uVis.value = v;
    points.visible = v > 0.001;
  };
  update();
  ctx.updaters.push(update);
  return { points, stars, update };
}
