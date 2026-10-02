import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials } from '../render/materials.js';
import { noise2, Rng } from '../core/rng.js';
import { PATH_TILE } from '../world/cliffPath.js';
import { endWallGeometry } from '../world/features.js';

// The lounge's secret (tools/blender/lounge_design.py secret_door; placed by props/lounge.js). The bookcase's two east
// bays are a door: clicking the island on the globe (the one on the deck's postcard) turns you to face them as they
// unlatch with a clunk and swing back on a pivot at their west back corner, rumbling, shedding dust from their seams,
// into a short rock passage behind the wall. An old caged bulb flickers on in it, and at its end is another elevator
// ('study'), up to a bunker hidden in the trees on the Tower stack (world/bunker.js).
//
// Everything here is in the lounge root's frame (x east, z south into the bookcase, y up from the floor). The door's
// geometry (layer 'secret') comes in modelled shut; it is moved to the pivot's frame and turned about y. Its lightmap
// turns with it. The passage is built here (rock rings, as the cliff caves' tunnels, and a flagstone floor): its
// first ring is the doorway exactly, its last a squared reveal round the elevator's plate.

const SWING = Math.PI / 2;                 // how far the door turns
const T_LOOK = 1.3;                        // s to turn the view to the bookcase
const T_DOOR = 1.4;                        // s into the sequence the latch lets go
const T_POP = 0.35, POP = THREE.MathUtils.degToRad(2.5);   // the unlatch: a small jolt, then a pause
const T_SWING = 4.4;                       // s from the latch to fully open
const T_END = T_DOOR + T_SWING + 0.8;      // s until you're free again
const PASSAGE = {
  z0: 3.0,                                 // its first ring: the doorway, flush with the room's floor edge
  plateZ: 7.6, plateX: 2.51,               // the elevator plate's front centre (it faces back up the passage, -z)
  xL: 1.4, xR: 3.62, top: 2.8, spring: 1.95, // the passage: its walls, its crown, where its arch springs
  reveal: { hw: 1.82, h: 3.27, ahead: 0.02 },   // the squared reveal round the plate (as cliffCave's)
  flare: 1.7,                              // m before the plate over which it widens to the reveal
};
const BULB = { z: 5.9, y: 2.52 };          // the passage's caged bulb (x on the passage's centre line)
const NF = 12, NS = 6, NA = 26;            // ring outline points: floor, each side, the arch

// A ring outline, counter-clockwise in (x, y) looking along +z, from the floor's west end: the floor, up the east side,
// over the crown, down the west side. rect: a rectangle's top in place of the arch (b = 0), or the arch (b = 1).
function outline({ xL, xR, top, spring, b }) {
  const a = (xR - xL) / 2, c = (xL + xR) / 2, hs = Math.min(spring, top - 0.01), pts = [];
  for (let i = 0; i < NF; i++) pts.push({ x: xL + (2 * a * i) / NF, y: 0, floor: true });
  for (let i = 0; i < NS; i++) pts.push({ x: xR, y: (hs * i) / NS });
  const L = 2 * (top - hs) + 2 * a;
  for (let j = 0; j < NA; j++) {
    const t = (Math.PI * j) / NA;
    const arch = { x: c + a * Math.cos(t), y: hs + (top - hs) * Math.sin(t) };
    let d = (j / NA) * L, rect;
    if (d < top - hs) rect = { x: xR, y: hs + d };
    else if ((d -= top - hs) < 2 * a) rect = { x: xR - d, y: top };
    else rect = { x: xL, y: top - (d - 2 * a) };
    pts.push({ x: rect.x + (arch.x - rect.x) * b, y: rect.y + (arch.y - rect.y) * b });
  }
  for (let i = 0; i < NS; i++) pts.push({ x: xL, y: hs - (hs * i) / NS });
  return pts;
}

// The passage's rock (walls, crown and the wall round the plate) and its floor, in the root's frame.
function passageGeometry(open) {
  const P = PASSAGE, R = P.reveal;
  const zT = P.plateZ - 0.07 - R.ahead;                 // the last ring, just in front of the plate
  const door = { xL: open.x0, xR: open.x1, top: open.top, spring: open.top - 0.01, b: 0 };
  const main = { xL: P.xL, xR: P.xR, top: P.top, spring: P.spring, b: 1 };
  const plate = { xL: P.plateX - R.hw, xR: P.plateX + R.hw, top: R.h, spring: R.h - 0.01, b: 0 };
  const zs = [P.z0, P.z0 + 0.12];
  for (let z = P.z0 + 0.4; z < zT - 0.05; z += 0.3) zs.push(z);
  zs.push(zT);
  const mix = (A, B, f) => Object.fromEntries(['xL', 'xR', 'top', 'spring', 'b'].map((k) => [k, A[k] + (B[k] - A[k]) * f]));
  const pos = [], col = [], uv = [], idx = [], fpos = [], fuv = [], fidx = [];
  const rings = [], centres = [];
  const O0 = outline(door), N = O0.length;
  zs.forEach((z, k) => {
    // Each ring's outline and how rough it is: the doorway exact, rock from just behind it, easing into the reveal.
    let prof, w;
    if (k === 0) { prof = door; w = 0; }
    else {
      const f = THREE.MathUtils.smoothstep(z, zT - P.flare, zT - 0.15);
      prof = mix(main, plate, f);
      w = Math.min(1, (z - P.z0) / 0.5) * (1 - f);
    }
    const O = outline(prof), cx = (prof.xL + prof.xR) / 2, cy = 1.3;
    centres.push(new THREE.Vector3(cx, cy, z));
    // Arc length round the outline, for the texture.
    let arc = 0;
    rings.push(O.map((o, i) => {
      if (i > 0) arc += Math.hypot(o.x - O[i - 1].x, o.y - O[i - 1].y);
      // Broken rock, pushed only outward (the door lies against the west wall; nothing may come in past it), less
      // near the floor so the floor's edge stays clean.
      let x = o.x, y = o.y;
      if (!o.floor) {
        const n = w * Math.max(0, 0.1 + 0.09 * noise2(z * 0.9 + i * 0.13, i * 0.07, 71) + 0.05 * noise2(z * 2.3 + i * 0.41, 3.3, 72) + 0.02 * noise2(z * 6.1 + i * 1.1, 5.2, 73))
          * Math.min(1, y / 0.35);
        const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
        x += (dx / L) * n; y += (dy / L) * n;
      }
      pos.push(x, y, z);
      const low = 0.72 + 0.28 * Math.min(1, y / 0.8);   // darker down in the corners
      const k2 = (0.5 + 0.08 * noise2(z * 1.7, i * 0.3, 74)) * low;
      col.push(k2, k2 * 0.96, k2 * 0.92);
      uv.push(z / 2, arc / 2);
      return { x, y, z, floor: !!o.floor, i: pos.length / 3 - 1 };
    }));
  });
  // Faces toward the passage's centre line.
  const V = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const isFloor = (i) => O0[i].floor && (O0[(i + 1) % N].floor || (i + 1) % N === NF);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < N; i++) {
      const q0 = rings[k][i], q1 = rings[k][(i + 1) % N], q2 = rings[k + 1][i], q3 = rings[k + 1][(i + 1) % N];
      if (isFloor(i)) {
        for (const q of [q0, q1, q3, q0, q3, q2]) { fidx.push(fpos.length / 3); fpos.push(q.x, q.y, q.z); fuv.push(q.x / PATH_TILE, q.z / PATH_TILE); }
        continue;
      }
      for (const [a, b, c] of [[q0.i, q1.i, q3.i], [q0.i, q3.i, q2.i]]) {
        const A = V(a), n = new THREE.Vector3().crossVectors(V(b).sub(A), V(c).sub(A));
        const toC = centres[k].clone().sub(A);
        if (n.dot(toC) < 0) idx.push(a, c, b); else idx.push(a, b, c);
      }
    }
  }
  const rock = new THREE.BufferGeometry();
  rock.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rock.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  rock.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rock.setIndex(idx);
  rock.computeVertexNormals();
  // The rock round the plate's edges (as every elevator end in a rock face has), coloured to match.
  const wall = endWallGeometry(new THREE.Vector3(P.plateX, 0, P.plateZ), Math.PI);
  wall.setAttribute('color', new THREE.Float32BufferAttribute(new Array(wall.attributes.position.count * 3).fill(0.38), 3));
  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  floor.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  // Each floor triangle facing up.
  for (let t = 0; t < fidx.length; t += 3) {
    const A = V2(fpos, t), B = V2(fpos, t + 1), C = V2(fpos, t + 2);
    if (new THREE.Vector3().crossVectors(B.sub(A), C.sub(A)).y < 0) { const s = fidx[t + 1]; fidx[t + 1] = fidx[t + 2]; fidx[t + 2] = s; }
  }
  floor.setIndex(fidx);
  floor.computeVertexNormals();
  return { rock: mergeGeometries([rock.toNonIndexed(), wall.index ? wall.toNonIndexed() : wall], false), floor, zT };
}
const V2 = (a, i) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

// Dust shaken out of the door's seams as it goes: fine motes (lit by the room, drifting and settling) and a few soft
// puffs. Animated entirely on the GPU from uTime (seconds since the latch let go), so nothing is uploaded as it plays.
const DUST_VS = /* glsl */ `
uniform float uTime, uPx;
attribute vec3 aV;
attribute vec4 aT;   // birth (s), life (s), size (m), opacity
varying float vA;
void main() {
  float t = uTime - aT.x;
  vA = 0.0;
  if (uTime < 0.0 || t < 0.0 || t > aT.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float k = 1.3;
  float ph = aT.x * 17.0 + position.x * 5.0;
  vec3 p = position + aV * (1.0 - exp(-k * t)) / k;
  p += 0.035 * vec3(sin(1.3 * t + ph), 0.5 * sin(0.9 * t + 2.0 * ph), cos(1.1 * t + ph)) * min(1.0, t);
  p.y = max(0.01, p.y - 0.03 * t * t);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aT.z * uPx / max(0.05, -mv.z);
  vA = aT.w * smoothstep(0.0, 0.3, t) * (1.0 - smoothstep(aT.y * 0.5, aT.y, t));
}`;
const DUST_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = vA * smoothstep(0.5, 0.1, r);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

function makeDust(open) {
  const rng = new Rng(4077);
  const P = [], Vv = [], T = [];
  const add = (p, v, birth, life, size, alpha) => { P.push(...p); Vv.push(...v); T.push(birth, life, size, alpha); };
  const r = (a, b) => rng.float(a, b);
  const { x0, x1, top, z0 } = open;
  for (let i = 0; i < 760; i++) {
    const w = rng.next();
    if (w < 0.34) {        // the free end's seam, as it opens
      add([x1 - 0.01 + r(0, 0.03), r(0.05, top), z0 + r(0.02, 0.12)], [r(-0.1, 0.12), r(-0.02, 0.05), -r(0.12, 0.45)], 0.35 + Math.pow(rng.next(), 2) * 3.6, r(2.5, 5.5), r(0.01, 0.026), r(0.18, 0.42));
    } else if (w < 0.68) { // off the top, shaken loose by the jolt
      add([r(x0, x1), top + r(-0.02, 0.12), z0 + r(0.05, 0.12)], [r(-0.08, 0.08), -r(0, 0.12), -r(0.08, 0.3)], 0.03 + Math.pow(rng.next(), 2) * 2.6, r(2.5, 5.5), r(0.01, 0.026), r(0.18, 0.42));
    } else if (w < 0.9) {  // along the floor as the plinth scrapes round
      add([r(x0, x1), r(0.02, 0.12), z0 + r(-0.02, 0.08)], [r(-0.3, 0.3), r(0.04, 0.22), -r(0.2, 0.6)], 0.5 + rng.next() * 3.4, r(2, 4.5), r(0.01, 0.03), r(0.16, 0.38));
    } else {               // the hinge side
      add([x0 + r(0, 0.03), r(0.05, top), z0 + r(0.02, 0.1)], [r(-0.06, 0.03), 0, -r(0.05, 0.2)], 0.4 + rng.next() * 3, r(2.5, 5), r(0.01, 0.022), r(0.16, 0.36));
    }
  }
  for (let i = 0; i < 46; i++) {   // soft puffs
    const low = rng.next() < 0.55;
    add([low ? r(x0, x1) : x1 + r(-0.1, 0.05), low ? r(0.1, 0.5) : r(0.3, top), z0 + r(-0.05, 0.1)], [r(-0.15, 0.15), r(0.02, 0.1), -r(0.08, 0.3)], 0.3 + rng.next() * 2.8, r(4, 7), r(0.3, 0.75), r(0.08, 0.16));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(Vv, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 4));
  const mat = new THREE.ShaderMaterial({
    name: 'lounge_dust', vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: -1 }, uPx: { value: 800 }, uColor: { value: new THREE.Color(0.11, 0.092, 0.07) } },
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'lounge-dust';
  pts.frustumCulled = false;
  pts.visible = false;
  return pts;
}

// root: the lounge's root. group: its parent (the tunnels'). node: the SECRET empty. parts: the door's geometry by
// material (model space). M: the lounge's materials. collider: the lounge's collider builder.
// Returns { open(instant), isOpen(), trigger(), lights (for the lounge's light-pool site), door, elevator }.
export function placeSecret(ctx, { root, group, node, parts, M, collider }) {
  const u = node.userData;
  const pivot = node.position.clone().setY(0);
  const open = { x0: u.x0 ?? 1.522, x1: (u.x1 ?? 3.43) - 0.002, top: u.top ?? 2.62, z0: u.z0 ?? 2.52 };
  const state = (ctx.state.lounge ||= { secretOpen: false });
  const S = materials();

  // ---- the door: its parts, moved into the pivot's frame ----
  const door = new THREE.Group();
  door.name = 'lounge-secret-door';
  door.position.copy(pivot);
  root.add(door);
  for (const [key, geos] of Object.entries(parts)) {
    const mat = M[key];
    if (!mat) { console.warn('lounge secret: no material for', key); continue; }
    const geo = mergeGeometries(geos, false);
    geo.translate(-pivot.x, 0, -pivot.z);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lounge_secret_' + key;
    door.add(mesh);
  }
  let angle = 0;
  const setAngle = (a) => { angle = a; door.rotation.y = -a; };   // the free (east) end swings back, +x toward +z

  // ---- the passage ----
  const pg = passageGeometry(open);
  const rock = new THREE.Mesh(pg.rock, S.stone);
  rock.name = 'lounge-passage-rock';
  const floor = new THREE.Mesh(pg.floor, S.path);
  floor.name = 'lounge-passage-floor';
  for (const m of [rock, floor]) { m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); }
  const wm = root.matrixWorld;
  collider.addGeometry(pg.rock, wm);
  collider.addGeometry(pg.floor, wm);

  // ---- the bulb, and its light (the lounge's light-pool site takes it) ----
  const bx = PASSAGE.plateX, bulbL = new THREE.Vector3(bx, BULB.y, BULB.z);
  const bulbMat = new THREE.MeshBasicMaterial({ name: 'lounge_secret_bulb', color: new THREE.Color(0, 0, 0) });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), bulbMat);
  bulb.position.copy(bulbL);
  root.add(bulb);
  const cage = mergeGeometries([
    new THREE.TorusGeometry(0.1, 0.008, 4, 12), new THREE.TorusGeometry(0.1, 0.008, 4, 12).rotateY(Math.PI / 2),
    new THREE.CylinderGeometry(0.006, 0.006, PASSAGE.top - BULB.y, 5).translate(0, (PASSAGE.top - BULB.y) / 2 + 0.08, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8).translate(0, 0.1, 0),
  ].map((g) => g.toNonIndexed()));
  cage.setAttribute('color', new THREE.Float32BufferAttribute(new Array(cage.attributes.position.count * 3).fill(0.6), 3));
  const cageMesh = new THREE.Mesh(cage, S.darkMetal);
  cageMesh.position.copy(bulbL);
  root.add(cageMesh);
  let bulbK = 0;
  const lights = [{ pos: root.localToWorld(bulbL.clone().setY(BULB.y - 0.15)), color: new THREE.Color(1, 0.78, 0.52), distance: 7, intensity: () => 3.4 * bulbK }];
  const setBulb = (k) => { bulbK = k; bulbMat.color.setRGB(3.2 * k, 2.3 * k, 1.3 * k); };

  // ---- the elevator at its end: its bottom stop (the Tower stack builds it, with its top in the bunker there:
  // world/bunker.js) ----
  const plateW = root.localToWorld(new THREE.Vector3(PASSAGE.plateX, 0, PASSAGE.plateZ));
  const station = { pos: plateW, rotY: root.rotation.y + Math.PI, zone: 'tunnel', parent: group, collider };

  // ---- collision: the door shut across the doorway, or open against the passage's west wall ----
  const floorY = root.position.y;
  const obb = (x0, x1, z0, z1) => {
    const c = root.localToWorld(new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2));
    return ctx.physics.addOBB({ x: c.x, z: c.z, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, ry: root.rotation.y, y0: floorY, y1: floorY + 3.2, zone: 'tunnel' });
  };
  const depth = pivot.z - open.z0, width = open.x1 - pivot.x;
  const shutBox = obb(open.x0, open.x1 + 0.002, open.z0, pivot.z);
  const openBox = obb(pivot.x, pivot.x + depth, pivot.z, pivot.z + width);
  const setColliders = (isOpen) => { shutBox.enabled = !isOpen; openBox.enabled = isOpen; };
  setColliders(false);

  // ---- dust ----
  const dust = makeDust(open);
  root.add(dust);
  const _size = new THREE.Vector2();

  // ---- the sequence: turned to the bookcase, it unlatches and swings ----
  let seq = null;
  const _c = new THREE.Vector3(), target = root.localToWorld(new THREE.Vector3((open.x0 + open.x1) / 2, 1.3, open.z0));
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const doorAngle = (s) => {
    if (s <= 0) return 0;
    if (s < T_POP + 0.35) return POP * THREE.MathUtils.smoothstep(s, 0, 0.12);
    const f = Math.min(1, (s - T_POP - 0.35) / (T_SWING - T_POP - 0.35));
    return POP + (SWING - POP) * f * f * f * (f * (f * 6 - 15) + 10);   // smootherstep: heavy to start, soft to stop
  };
  const finishOpen = () => {
    setAngle(SWING); setColliders(true); setBulb(1);
    state.secretOpen = true;
  };
  const api = {
    lights, door, station, elevator: null,
    isOpen: () => !!state.secretOpen,
    running: () => !!seq,
    // Straight to open (a restored save).
    open(instant = true) {
      if (instant) { seq = null; finishOpen(); dust.visible = false; return; }
      api.trigger();
    },
    // The globe's island: start the sequence (false if it's already open or opening).
    trigger() {
      if (state.secretOpen || seq) return false;
      const p = ctx.player;
      ctx.camera.getWorldPosition(_c);
      const dx = target.x - _c.x, dy = target.y - _c.y, dz = target.z - _c.z;
      seq = { t: 0, yaw0: p.yaw, pitch0: p.pitch, dyaw: wrap(Math.atan2(-dx, -dz) - p.yaw), pitch1: Math.atan2(dy, Math.hypot(dx, dz)), sound: false };
      p.canMove = false;
      p.lookHandler = () => {};
      ctx.interact.enabled = false;
      return true;
    },
  };
  const noLook = () => {};
  ctx.updaters.push((dt) => {
    if (!seq) return;
    const p = ctx.player;
    seq.t += dt;
    const t = seq.t, s = t - T_DOOR;
    // Held facing the bookcase.
    const k = THREE.MathUtils.smootherstep(t, 0, T_LOOK);
    p.yaw = seq.yaw0 + seq.dyaw * k;
    p.pitch = seq.pitch0 + (seq.pitch1 - seq.pitch0) * k;
    p.canMove = false;
    p.lookHandler = noLook;
    if (s >= 0 && !seq.sound) {
      seq.sound = true;
      ctx.audio?.play('bookcase', { pos: target, swing: T_SWING });
    }
    setAngle(doorAngle(s));
    // The floor shakes: a jolt as it unlatches, a tremor as it swings.
    if (ctx.fx) ctx.fx.shake = s < 0 ? 0 : s < 0.3 ? 0.9 * (1 - s / 0.3) : s < T_SWING ? 0.22 * (1 - THREE.MathUtils.smoothstep(s, T_SWING - 1, T_SWING)) : 0;
    // Dust from the latch on.
    dust.visible = s >= 0;
    dust.material.uniforms.uTime.value = s;
    ctx.renderer?.getDrawingBufferSize(_size);
    if (_size.y) dust.material.uniforms.uPx.value = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
    // The bulb in the passage stutters on as the door comes round.
    const b = s - T_SWING * 0.55;
    setBulb(b < 0 ? 0 : b > 0.7 ? 1 : (Math.sin(b * 53) > 0.2 ? 0.9 : 0.1) * Math.min(1, b * 2));
    if (t >= T_END) {
      seq = null;
      finishOpen();
      if (ctx.fx) ctx.fx.shake = 0;
      p.canMove = true;
      p.lookHandler = null;
      ctx.interact.enabled = true;
    }
  });
  // The dust settles on after you're free (it has its own lifetime), then it's put away.
  ctx.updaters.push((dt) => {
    if (seq || !dust.visible) return;
    const U = dust.material.uniforms.uTime;
    U.value += dt;
    if (U.value > T_SWING + 8) { dust.visible = false; U.value = -1; }
  });

  setBulb(0);
  if (state.secretOpen) finishOpen();
  return api;
}
