import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { Textures } from '../render/textures.js';
import { addKeepOut } from '../render/lod.js';
import { noise2 } from '../core/rng.js';
import { placeBunkerRoom } from '../props/bunkerRoom.js';

// The Tower stack's bunker: a board-formed concrete hood rising out of the ground in the east stand's trees, just big
// enough for a steel door, and under it a stair down to a room with an elevator in its far wall, the top of the lounge's
// secret elevator (props/loungeSecret.js). The room is the survey relay's (props/bunkerRoom.js: a model from Blender, lit
// by its pendants, with the terminal that runs rocks.exe); without that model it's this file's bare concrete box, dark.
// Over the door, a lamp that comes on when the door opens. The door has no handle outside: it opens only from in there
// (press it from outside and it rattles in its frame, locked).
//
// Its frame: origin at the door's threshold on the ground (y = the ground there), +z into the bunker (down the
// stair), +x across. Where it stands (stack-local, and the way its door faces) was picked clear of every trunk, deep
// in the stand, with the door toward the rim and everything underground running back toward the middle of the stack.
export const BUNKER = { lx: 33.55, lz: -0.15, face: THREE.MathUtils.degToRad(20) };   // door faces (cos, sin) of `face`

const WALL = 0.3;                  // concrete thickness
const HW = 0.7;                    // half the stairwell's width (inside)
const DOOR = { hw: 0.5, y0: 0.15, y1: 2.25 };   // the doorway: half width, sill and head (above the threshold)
const LANDING = { z0: WALL, z1: 1.3, y: 0.15 };  // inside the door
const RISE = 0.19, RUN = 0.26;
const HEAD = 2.35;                 // stairwell headroom (tread line to ceiling)
const ROOF = 0.45;                 // the hood's roof slab (vertically)
const ROOM = { hw: 2.4, d: 3.6, h: 3.0 };   // the room's inner faces (props/bunkerRoom.js's model is built to them)
const PLATE_BACK = 0.3;            // the elevator's plate stands this far behind the room's back wall (as the lounge's)
const PLATE = { hw: 1.85, h: 3.3, car: 2.45 };   // the elevator's landing plate and car behind it (elevator.js)

// The plan, given the ground's height (relative to the threshold) at a point of the frame: enough steps that the room,
// the plate and the car behind it all stay 0.35 m under the ground everywhere over them.
function plan(groundAt) {
  const X = Math.max(ROOM.hw, PLATE.hw) + 0.2;
  for (let n = 20; n <= 40; n++) {
    const floor = LANDING.y - n * RISE, zRoom = LANDING.z1 + n * RUN, zBack = zRoom + ROOM.d;
    const top = floor + Math.max(ROOM.h, PLATE.h) + 0.35;
    let ok = true;
    for (let z = zRoom - 0.5; z <= zBack + PLATE_BACK + PLATE.car + 0.3 && ok; z += 0.5) {
      for (const x of [-X, 0, X]) if (groundAt(x, z) < top) { ok = false; break; }
    }
    if (ok) return { n, floor, zRoom, zBack };
  }
  return null;
}

// The world frame from the stack.
export function bunkerFrame(stack) {
  const f = new THREE.Vector3(Math.cos(BUNKER.face), 0, Math.sin(BUNKER.face));   // the way the door faces
  const ry = Math.atan2(-f.x, -f.z);                                              // local +z = -f (into the hood)
  const x = stack.cx + BUNKER.lx, z = stack.cz + BUNKER.lz;
  const y = stack.heightAtAnalytic(x, z);
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const ground = (lx, lz) => { const p = new THREE.Vector3(lx, 0, lz).applyMatrix4(m); return stack.heightAtAnalytic(p.x, p.z) - y; };
  const P = plan(ground);
  // (23 steps since it was built: a change moves the room, the elevator's top and everything placed by them)
  if (P && P.n !== 23) console.warn('bunker: the stair now takes', P.n, 'steps (was 23): the room has moved');
  // Where the stairwell's ceiling goes under the ground (with a little to spare): the cap's hole ends there, inside
  // the roof slab (the slab's top still stands above the ground).
  const ceil = (z) => LANDING.y + HEAD - Math.max(0, z - LANDING.z1) * (RISE / RUN);
  let zHole = LANDING.z1;
  for (let z = LANDING.z1; z < LANDING.z1 + 12; z += 0.02) {
    if ([-HW - 0.15, 0, HW + 0.15].every((lx) => ceil(z) < ground(lx, z) - 0.12)) { zHole = z; break; }
  }
  return { x, y, z, ry, m, plan: P, ground, ceil, hole: { x, z, ry, x0: -HW - 0.15, x1: HW + 0.15, z0: WALL * 0.5, z1: zHole } };
}

// A flat polygon (3 or 4 points, in order round it), turned to face `facing`, with UVs in metres / 2 along `u` and `v`
// (the concrete's board rows run along u) and a colour per vertex.
function quadGeo(pts, u, v, col, facing) {
  const n = new THREE.Vector3().crossVectors(pts[1].clone().sub(pts[0]), pts[2].clone().sub(pts[0]));
  if (n.dot(facing) < 0) pts = [...pts].reverse();
  const pos = [], uv = [], cl = [];
  for (const p of pts) { pos.push(p.x, p.y, p.z); uv.push(p.dot(u) / 2, p.dot(v) / 2); const k = typeof col === 'function' ? col(p) : col; cl.push(k, k * 0.985, k * 0.955); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setIndex(pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]);
  g.computeVertexNormals();
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UX = V(1, 0, 0), UY = V(0, 1, 0), UZ = V(0, 0, 1);

// Builds it. batcher, collider: the stack's; asset: the room's model (props/bunkerRoom.js loadBunker()) or null.
// Returns { station (the elevator's top end), inside(p), inCar(p), sealed(p), door, frame, root, room, terminal, seat, spawn }.
export function buildBunker(ctx, stack, { batcher, collider, frame, asset = null }) {
  const M = materials();
  const F = frame, P = F.plan;
  if (!P) { console.warn('bunker: no depth keeps the room under the ground'); return null; }
  const { n, floor, zRoom, zBack } = P;
  const geos = [];
  // Inside it's dark, only what comes down the stair, darker the deeper; but the foot of the stair takes the room's light
  // (its pendants, through the light pool), so there the concrete is its own grey. (The bare room, without its model,
  // has no lamps: dark.)
  const dim = (p) => {
    if (p.z < 0.05) return 0.62;
    const d = 0.3 * (0.35 + 0.65 * THREE.MathUtils.smoothstep(p.y, floor - 0.5, 1.5));
    if (!asset || p.z > zRoom + 0.01) return d;
    return d + (0.6 - d) * THREE.MathUtils.smoothstep(p.z, zRoom - 4.5, zRoom - 0.3);
  };
  // Outside: weathered, darker toward the ground and in the damp.
  const out = (p) => 0.72 * (0.72 + 0.28 * Math.min(1, Math.max(0, p.y) / 1.4)) * (0.9 + 0.1 * noise2(p.x * 1.3, p.z * 1.3 + p.y, 41));
  const q = (pts, u, v, col, facing) => geos.push(quadGeo(pts, u, v, col, facing));
  const PX = V(1, 0, 0), NX = V(-1, 0, 0), PY = V(0, 1, 0), NY = V(0, -1, 0), PZ = V(0, 0, 1), NZ = V(0, 0, -1);

  // ---- the hood (outside) ----
  const H = LANDING.y + HEAD + ROOF;          // its height over the landing
  const ox = HW + WALL;                        // outer half width
  const roofZ = (y) => LANDING.z1 + (H - y) / (RISE / RUN);   // where the sloped roof is at height y
  const yb = -1.2;                             // (walls run down past the ground's dips)
  const zEnd = roofZ(yb);
  // Front face, round the doorway.
  q([V(-ox, yb, 0), V(-DOOR.hw, yb, 0), V(-DOOR.hw, H, 0), V(-ox, H, 0)], UX, UY, out, NZ);
  q([V(DOOR.hw, yb, 0), V(ox, yb, 0), V(ox, H, 0), V(DOOR.hw, H, 0)], UX, UY, out, NZ);
  q([V(-DOOR.hw, DOOR.y1, 0), V(DOOR.hw, DOOR.y1, 0), V(DOOR.hw, H, 0), V(-DOOR.hw, H, 0)], UX, UY, out, NZ);
  q([V(-DOOR.hw, yb, 0), V(DOOR.hw, yb, 0), V(DOOR.hw, DOOR.y0, 0), V(-DOOR.hw, DOOR.y0, 0)], UX, UY, out, NZ);
  // Sides: square over the landing, then the roof's slope down into the ground.
  for (const s of [-1, 1]) q([V(s * ox, yb, 0), V(s * ox, yb, zEnd), V(s * ox, H, LANDING.z1), V(s * ox, H, 0)], UZ, UY, out, s > 0 ? PX : NX);
  // Roof: flat over the landing, then sloping into the ground.
  q([V(-ox, H, 0), V(ox, H, 0), V(ox, H, LANDING.z1), V(-ox, H, LANDING.z1)], UX, UZ, out, PY);
  q([V(-ox, H, LANDING.z1), V(ox, H, LANDING.z1), V(ox, yb, zEnd), V(-ox, yb, zEnd)], UX, UZ, out, PY);
  // An apron in front of the door.
  q([V(-ox, 0.1, -0.7), V(ox, 0.1, -0.7), V(ox, 0.1, 0), V(-ox, 0.1, 0)], UX, UZ, out, PY);
  q([V(-ox, -0.5, -0.7), V(ox, -0.5, -0.7), V(ox, 0.1, -0.7), V(-ox, 0.1, -0.7)], UX, UY, out, NZ);
  for (const s of [-1, 1]) q([V(s * ox, -0.5, -0.7), V(s * ox, -0.5, 0), V(s * ox, 0.1, 0), V(s * ox, 0.1, -0.7)], UZ, UY, out, s > 0 ? PX : NX);

  // ---- the doorway's reveal ----
  q([V(-DOOR.hw, DOOR.y0, 0), V(-DOOR.hw, DOOR.y0, WALL), V(-DOOR.hw, DOOR.y1, WALL), V(-DOOR.hw, DOOR.y1, 0)], UZ, UY, dim, PX);
  q([V(DOOR.hw, DOOR.y0, 0), V(DOOR.hw, DOOR.y0, WALL), V(DOOR.hw, DOOR.y1, WALL), V(DOOR.hw, DOOR.y1, 0)], UZ, UY, dim, NX);
  q([V(-DOOR.hw, DOOR.y1, 0), V(-DOOR.hw, DOOR.y1, WALL), V(DOOR.hw, DOOR.y1, WALL), V(DOOR.hw, DOOR.y1, 0)], UX, UZ, dim, NY);
  q([V(-DOOR.hw, DOOR.y0, 0), V(DOOR.hw, DOOR.y0, 0), V(DOOR.hw, DOOR.y0, WALL), V(-DOOR.hw, DOOR.y0, WALL)], UX, UZ, 0.5, PY);

  // ---- inside: the landing, the stair, its walls and ceiling ----
  const cz = F.ceil;
  const zS = LANDING.z1, zE = LANDING.z1 + n * RUN;
  const yc = LANDING.y + HEAD;
  // Front wall's inside face, round the doorway.
  q([V(-HW, -0.3, WALL), V(-DOOR.hw, -0.3, WALL), V(-DOOR.hw, yc, WALL), V(-HW, yc, WALL)], UX, UY, dim, PZ);
  q([V(DOOR.hw, -0.3, WALL), V(HW, -0.3, WALL), V(HW, yc, WALL), V(DOOR.hw, yc, WALL)], UX, UY, dim, PZ);
  q([V(-DOOR.hw, DOOR.y1, WALL), V(DOOR.hw, DOOR.y1, WALL), V(DOOR.hw, yc, WALL), V(-DOOR.hw, yc, WALL)], UX, UY, dim, PZ);
  // Landing floor and ceiling, and the sloped ceiling down to the room.
  q([V(-HW, LANDING.y, WALL), V(HW, LANDING.y, WALL), V(HW, LANDING.y, zS), V(-HW, LANDING.y, zS)], UX, UZ, dim, PY);
  q([V(-HW, yc, WALL), V(HW, yc, WALL), V(HW, yc, zS), V(-HW, yc, zS)], UX, UZ, dim, NY);
  q([V(-HW, cz(zS), zS), V(HW, cz(zS), zS), V(HW, cz(zE), zE), V(-HW, cz(zE), zE)], UX, UZ, dim, NY);
  // Side walls, from under the treads to the ceiling.
  for (const s of [-1, 1]) {
    const x = s * HW, f = s > 0 ? NX : PX;
    q([V(x, -0.3, WALL), V(x, -0.3, zS), V(x, yc, zS), V(x, yc, WALL)], UZ, UY, dim, f);
    q([V(x, -0.3, zS), V(x, floor - 0.3, zE), V(x, cz(zE), zE), V(x, cz(zS), zS)], UZ, UY, dim, f);
  }
  // Treads and risers.
  for (let k = 0; k < n; k++) {
    const y = LANDING.y - (k + 1) * RISE, z0 = zS + k * RUN, z1 = z0 + RUN;
    q([V(-HW, y, z0), V(HW, y, z0), V(HW, y, z1), V(-HW, y, z1)], UX, UZ, dim, PY);
    q([V(-HW, y, z0), V(HW, y, z0), V(HW, y + RISE, z0), V(-HW, y + RISE, z0)], UX, UY, dim, PZ);   // (seen climbing up)
  }

  // ---- the room: its shell (collision always; drawn only when there's no model of it) ----
  const nShell = geos.length;
  const rc = floor + ROOM.h;
  q([V(-ROOM.hw, floor, zRoom), V(ROOM.hw, floor, zRoom), V(ROOM.hw, floor, zBack), V(-ROOM.hw, floor, zBack)], UX, UZ, dim, PY);
  q([V(-ROOM.hw, rc, zRoom), V(ROOM.hw, rc, zRoom), V(ROOM.hw, rc, zBack), V(-ROOM.hw, rc, zBack)], UX, UZ, dim, NY);
  for (const s of [-1, 1]) q([V(s * ROOM.hw, floor, zRoom), V(s * ROOM.hw, floor, zBack), V(s * ROOM.hw, rc, zBack), V(s * ROOM.hw, rc, zRoom)], UZ, UY, dim, s > 0 ? NX : PX);
  // Its front wall, round the stair's mouth.
  const sc = cz(zE);
  q([V(-ROOM.hw, floor, zRoom), V(-HW, floor, zRoom), V(-HW, rc, zRoom), V(-ROOM.hw, rc, zRoom)], UX, UY, dim, PZ);
  q([V(HW, floor, zRoom), V(ROOM.hw, floor, zRoom), V(ROOM.hw, rc, zRoom), V(HW, rc, zRoom)], UX, UY, dim, PZ);
  q([V(-HW, sc, zRoom), V(HW, sc, zRoom), V(HW, rc, zRoom), V(-HW, rc, zRoom)], UX, UY, dim, PZ);
  // Its back wall, round the elevator's doorway (0.68 either side, 2.3 high), and the doorway's reveal to the plate.
  const eh = 0.68, eH = floor + 2.3, zp = zBack + PLATE_BACK;
  q([V(-ROOM.hw, floor, zBack), V(-eh, floor, zBack), V(-eh, rc, zBack), V(-ROOM.hw, rc, zBack)], UX, UY, dim, NZ);
  q([V(eh, floor, zBack), V(ROOM.hw, floor, zBack), V(ROOM.hw, rc, zBack), V(eh, rc, zBack)], UX, UY, dim, NZ);
  q([V(-eh, eH, zBack), V(eh, eH, zBack), V(eh, rc, zBack), V(-eh, rc, zBack)], UX, UY, dim, NZ);
  q([V(-eh, floor, zBack), V(-eh, floor, zp), V(-eh, eH, zp), V(-eh, eH, zBack)], UZ, UY, dim, PX);
  q([V(eh, floor, zBack), V(eh, floor, zp), V(eh, eH, zp), V(eh, eH, zBack)], UZ, UY, dim, NX);
  q([V(-eh, eH, zBack), V(eh, eH, zBack), V(eh, eH, zp), V(-eh, eH, zp)], UX, UZ, dim, NY);
  q([V(-eh, floor, zBack), V(eh, floor, zBack), V(eh, floor, zp), V(-eh, floor, zp)], UX, UZ, dim, PY);

  const geo = mergeGeometries(geos.map((g) => g.toNonIndexed()), false);
  batcher.add(asset ? mergeGeometries(geos.slice(0, nShell).map((g) => g.toNonIndexed()), false) : geo, M.concrete, F.m);

  // ---- collision: its own surfaces, as the caves' (the roof too: the ground under the hood is cut away) ----
  collider.addGeometry(geo, F.m);

  // No grass, shrubs or pebbles on it or growing up through it.
  addKeepOut(F.m, new THREE.Box3(V(-ox - 0.3, -1.5, -1.1), V(ox + 0.3, 4, zEnd + 0.4)));

  // ---- the door: a plain steel leaf, hinged on its east side, opening outward; no handle outside ----
  const hinge = V(DOOR.hw, 0, 0.02);
  const leaf = new THREE.Group();
  leaf.name = 'bunker-door';
  leaf.position.copy(hinge);
  const leafW = DOOR.hw * 2 - 0.02, leafH = DOOR.y1 - DOOR.y0 - 0.02;
  const slab = new THREE.BoxGeometry(leafW, leafH, 0.06).translate(-leafW / 2 - 0.01, DOOR.y0 + 0.01 + leafH / 2, 0.05);
  const parts = [slab];
  // Inside: a heavy lever and two bolts; outside, only two strap hinges and rivets.
  parts.push(new THREE.BoxGeometry(0.035, 0.26, 0.035).translate(-leafW + 0.1, 1.05, 0.11));
  parts.push(new THREE.BoxGeometry(0.16, 0.035, 0.035).translate(-leafW + 0.15, 1.18, 0.11));
  for (const y of [0.45, 1.85]) parts.push(new THREE.BoxGeometry(0.22, 0.05, 0.03).translate(-leafW + 0.13, y, 0.1));
  for (const y of [0.35, 1.95]) parts.push(new THREE.BoxGeometry(0.34, 0.06, 0.012).translate(-0.18, y, 0.014));
  const leafGeo = mergeGeometries(parts.map((g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.9), 3)); return g.toNonIndexed(); }), false);
  // Painted steel, the paint gone chalky: an olive grey (bare metal goes black out here in the trees' shade).
  const paint = patchMaterial(new THREE.MeshStandardMaterial({
    name: 'bunker_door', vertexColors: true, map: Textures.metal().map, color: new THREE.Color(0x7d8474), roughness: 0.75, metalness: 0.25, envMapIntensity: 0.5,
  }));
  const leafMesh = new THREE.Mesh(leafGeo, paint);
  leafMesh.castShadow = true; leafMesh.receiveShadow = true;
  leaf.add(leafMesh);
  const root = new THREE.Group();
  root.name = 'bunker';
  root.matrixAutoUpdate = false;
  root.matrix.copy(F.m);
  root.matrixWorldNeedsUpdate = true;
  stack.group.add(root);
  root.add(leaf);
  root.updateMatrixWorld(true);

  const state = (ctx.state.bunker ||= { open: false });
  const obb = (x0, x1, z0, z1) => {
    const c = V((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(F.m);
    return ctx.physics.addOBB({ x: c.x, z: c.z, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, ry: F.ry, y0: F.y - 0.5, y1: F.y + DOOR.y1 + 0.3, zone: 'surface' });
  };
  const shutBox = obb(-DOOR.hw, DOOR.hw, 0, 0.12);
  const openBox = obb(DOOR.hw - 0.08, DOOR.hw + 0.04, -leafW - 0.02, 0);
  const SWING = -THREE.MathUtils.degToRad(100);
  let open = state.open ? 1 : 0, target = open, jiggle = 0;
  // The sky's light inside (materials.js bunkerDeep): a little round the shut door (enough to find it by), the daylight
  // down the top of the stair while it's open, but no further (below, the room's pendants light what's there, the same
  // by day and by night).
  const skyIn = (s) => atmo.uBunD.value.set(zp + 0.1, 1, THREE.MathUtils.lerp(1.0, LANDING.z1 + 1.2, s), THREE.MathUtils.lerp(4.0, zRoom - 1.5, s));
  const apply = () => {
    const s = open * open * (3 - 2 * open);
    leaf.rotation.y = SWING * s + Math.sin(jiggle * 60) * 0.012 * jiggle;
    leaf.updateMatrixWorld(true);
    shutBox.enabled = open < 0.2; openBox.enabled = open > 0.8;
    skyIn(s);
  };
  apply();
  const inv = F.m.clone().invert(), _l = new THREE.Vector3();
  const local = (p) => _l.copy(p).applyMatrix4(inv);
  // In the bunker (not the car): behind the door, in the stairwell (its width, under its ceiling) or the room.
  const inside = (p) => {
    const l = local(p);
    if (l.z <= 0.08 || l.z >= zp || l.y < floor - 0.5) return false;
    return l.z < zRoom ? Math.abs(l.x) < HW + 0.1 && l.y < F.ceil(l.z) + 0.1 : Math.abs(l.x) < ROOM.hw + 0.1 && l.y < rc + 0.1;
  };
  // In the elevator's car while it stands at this end, behind the plate (on its way, below, it isn't).
  const inCar = (p) => {
    const l = local(p);
    return l.z >= zp && l.z <= zp + PLATE.car + 0.3 && Math.abs(l.x) < ROOM.hw + 0.5 && l.y > floor - 0.5 && l.y < floor + PLATE.h;
  };
  // How shut off from the outside it is here (0..1, for the sound): not at all on the landing with the door open, more
  // the further down the stair, wholly in the room and the car; and everywhere in there once the door is shut.
  const sealed = (p) => {
    if (inCar(p)) return 1;
    if (!inside(p)) return 0;
    const s = open * open * (3 - 2 * open);
    return Math.max(THREE.MathUtils.smoothstep(local(p).z, LANDING.z1, zRoom), 1 - s);
  };
  // Where the room may be seen from: anywhere in the bunker or the elevator's car behind its plate (from outside, only
  // through the open door).
  const near = (p) => {
    const l = local(p);
    if (l.z <= -0.3 || l.z >= zp + PLATE.car + 0.3 || Math.abs(l.x) > ROOM.hw + 0.5 || l.y < floor - 0.5) return false;
    return l.y < (l.z < zRoom ? F.ceil(Math.max(l.z, 0)) + 0.4 : rc + 0.4);
  };
  const doorPos = V(0, 1.2, 0).applyMatrix4(F.m);
  ctx.interact.add({
    name: 'bunker:door', meshes: [leafMesh], range: 2.4, zone: 'surface',
    onPress: () => {
      if (target === 0) {
        if (!inside(ctx.player.feet)) {
          // Locked: it rattles in its frame.
          jiggle = 1;
          ctx.audio?.play('click', { pos: doorPos });
          ctx.audio?.play('switch', { pos: doorPos, rate: 0.45 });
          return;
        }
        target = 1;
        ctx.audio?.play('switch', { pos: doorPos, rate: 0.6 });   // the lever
        ctx.audio?.play('hingeOpen', { pos: doorPos });
      } else {
        target = 0;
        ctx.audio?.play('hingeClose', { pos: doorPos });
      }
      state.open = target === 1;
    },
  });
  ctx.updaters.push((dt) => {
    if (open === target && jiggle <= 0) return;
    open = target > open ? Math.min(1, open + dt / 1.4) : Math.max(target, open - dt / 1.4);
    jiggle = Math.max(0, jiggle - dt * 2.5);
    apply();
  });

  // ---- the door lamp: a bulkhead on a bracket over the door head, a flat steel cap over a glass dome that shines
  // down on the apron. It's on the door's circuit: dark while the door is shut, it comes on (with a stutter) as the
  // door opens, and goes out when it's shut again. It lights the ground in front through the shared point-light pool.
  const LAMP = V(0, DOOR.y1 + 0.42, -0.24);          // the dome's centre, out from the front face
  const cap = mergeGeometries([
    new THREE.BoxGeometry(0.06, 0.05, 0.26).translate(0, LAMP.y + 0.07, -0.12),         // bracket arm from the wall
    new THREE.BoxGeometry(0.16, 0.12, 0.02).translate(0, LAMP.y + 0.06, -0.01),          // its wall plate
    new THREE.CylinderGeometry(0.15, 0.16, 0.045, 20).translate(LAMP.x, LAMP.y + 0.03, LAMP.z),   // the cap
    new THREE.CylinderGeometry(0.125, 0.125, 0.02, 20).translate(LAMP.x, LAMP.y, LAMP.z),         // the ring the glass sits in
  ].map((g) => { g = g.toNonIndexed(); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.8), 3)); return g; }), false);
  const capMesh = new THREE.Mesh(cap, M.darkMetal);   // (its vertex colours: darkMetal multiplies them in)
  capMesh.castShadow = true;
  const glassOff = new THREE.Color(0.05, 0.05, 0.045), glassOn = new THREE.Color(1.25, 1.08, 0.82);   // (just over the bloom threshold: a soft glow, no halo)
  const glassMat = patchMaterial(new THREE.MeshStandardMaterial({ name: 'bunker_lamp_glass', color: 0x9a9a92, roughness: 0.25, metalness: 0, emissive: glassOff.clone() }));
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(LAMP.x, LAMP.y - 0.01, LAMP.z), glassMat);
  root.add(capMesh, glass);
  root.updateMatrixWorld(true);
  const lampWorld = V(LAMP.x, LAMP.y - 0.12, LAMP.z).applyMatrix4(F.m);
  let lamp = target === 1 ? 1 : 0, lampT = 1;           // brightness 0..1; seconds since it was switched on
  const STUTTER = [0.06, 0.1, 0.19, 0.24, 0.32];         // on, off, on, off, on: a cold tube catching
  ctx.updaters.push((dt) => {
    const want = target === 1;
    if (want && lamp === 0 && lampT >= 1) lampT = 0;
    lampT = Math.min(1, lampT + dt);
    const k = !want ? 0 : lampT >= STUTTER[STUTTER.length - 1] ? 1 : STUTTER.filter((t) => lampT >= t).length % 2 ? 1 : 0.15;
    if (k === lamp) return;
    lamp = k;
    glassMat.emissive.copy(glassOff).lerp(glassOn, lamp);
  });
  glassMat.emissive.copy(glassOff).lerp(glassOn, lamp);
  const lampLight = { pos: lampWorld, color: new THREE.Color(1, 0.9, 0.74), distance: 6, intensity: () => 3 * lamp };
  ctx.lightPool?.add({ center: V(0, 1.2, -1.2).applyMatrix4(F.m), radius: 5, lights: [lampLight] });

  // Its insides for the materials: sky light cut (it's dark in there) and no tree's leaves (materials.js bunkerMask).
  atmo.uBunA.value.set(Math.cos(F.ry), Math.sin(F.ry), F.x, F.z);
  atmo.uBunB.value.set(F.y, LANDING.y + HEAD, LANDING.z1, RISE / RUN);
  atmo.uBunC.value.set(HW, zRoom, ROOM.hw, floor + ROOM.h);
  skyIn(open * open * (3 - 2 * open));

  // ---- the room's model (props/bunkerRoom.js) ----
  const room = asset ? placeBunkerRoom(ctx, asset, { F, P, parent: root, near, inside, inCar, isOpen: () => open > 0.02, lamp: lampLight }) : null;

  // The elevator's top end: its plate behind the room's back wall, facing back toward the stair; its call button on the
  // wall's face beside the doorway (plate-local; the plate faces the room, so its +x is the room's -x).
  const carCollider = ctx.lateCollider('bunker-car');
  const station = {
    pos: V(0, floor, zp).applyMatrix4(F.m), rotY: F.ry + Math.PI, zone: 'surface', parent: ctx.surface,
    collider: carCollider, callPos: room?.callPos ?? [1.12, 1.15, PLATE_BACK + 0.02],
  };
  // The room's furniture collision and its sounds go in once the world is built (as the lounge's, world/index.js: so
  // nothing registered before them moves): with the car's walls, the first of the bunker's late colliders built.
  if (room) {
    const build = carCollider.build;
    carCollider.build = function (...a) { room.finish(); this.build = build; return build.apply(this, a); };
  }
  return {
    station, inside, inCar, sealed, frame: F, root,
    door: { isOpen: () => target === 1, set(o) { target = open = o ? 1 : 0; state.open = !!o; apply(); } },
    room, terminal: room?.terminal ?? null, seat: room?.seat ?? null, spawn: room?.spawn ?? null,
  };
}
