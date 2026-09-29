import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, patchMaterial } from '../render/materials.js';
import { atmo } from '../render/atmosphere.js';
import { Textures } from '../render/textures.js';
import { addKeepOut } from '../render/lod.js';
import { noise2 } from '../core/rng.js';

// The Tower stack's bunker: a board-formed concrete hood rising out of the ground in the east stand's trees, just big
// enough for a steel door, and under it a stair down to a bare concrete room with an elevator in its far wall, the top of
// the lounge's secret elevator (props/loungeSecret.js). No lights. The door has no handle outside: it opens only from
// in there (press it from outside and it rattles in its frame, locked).
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
const ROOM = { hw: 1.5, d: 3.05, h: 2.7 };
const PLATE_BACK = 0.3;            // the elevator's plate stands this far behind the room's back wall (as the lounge's)
const PLATE = { hw: 1.85, h: 3.3, car: 2.45 };   // the elevator's landing plate and car behind it (elevator.js)

// The plan, given the ground's height (relative to the threshold) at a point of the frame: enough steps that the room,
// the plate and the car behind it all stay 0.35 m under the ground everywhere over them.
function plan(groundAt) {
  for (let n = 20; n <= 40; n++) {
    const floor = LANDING.y - n * RISE, zRoom = LANDING.z1 + n * RUN, zBack = zRoom + ROOM.d;
    const top = floor + PLATE.h + 0.35;
    let ok = true;
    for (let z = zRoom - 0.5; z <= zBack + PLATE_BACK + PLATE.car + 0.3 && ok; z += 0.5) {
      for (const x of [-PLATE.hw - 0.2, 0, PLATE.hw + 0.2]) if (groundAt(x, z) < top) { ok = false; break; }
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

// Builds it. batcher, collider: the stack's. Returns { station (the elevator's top end), inside(p), door, frame }.
export function buildBunker(ctx, stack, { batcher, collider, frame }) {
  const M = materials();
  const F = frame, P = F.plan;
  if (!P) { console.warn('bunker: no depth keeps the room under the ground'); return null; }
  const { n, floor, zRoom, zBack } = P;
  const geos = [];
  // Inside it's dark: no lamp, only what comes down the stair; darker the deeper.
  const dim = (p) => (p.z < 0.05 ? 0.62 : 0.3 * (0.35 + 0.65 * THREE.MathUtils.smoothstep(p.y, floor - 0.5, 1.5)));
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

  // ---- the room ----
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
  batcher.add(geo, M.concrete, F.m);

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
  const apply = () => {
    const s = open * open * (3 - 2 * open);
    leaf.rotation.y = SWING * s + Math.sin(jiggle * 60) * 0.012 * jiggle;
    leaf.updateMatrixWorld(true);
    shutBox.enabled = open < 0.2; openBox.enabled = open > 0.8;
  };
  apply();
  const inv = F.m.clone().invert(), _l = new THREE.Vector3();
  const local = (p) => _l.copy(p).applyMatrix4(inv);
  const inside = (p) => { const l = local(p); return l.z > 0.08 && l.z < zp && Math.abs(l.x) < ROOM.hw + 0.1 && l.y < H; };   // (not the car)
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

  // Its insides for the materials: sky light cut (it's dark in there) and no tree's leaves (materials.js bunkerMask).
  atmo.uBunA.value.set(Math.cos(F.ry), Math.sin(F.ry), F.x, F.z);
  atmo.uBunB.value.set(F.y, LANDING.y + HEAD, LANDING.z1, RISE / RUN);
  atmo.uBunC.value.set(HW, zRoom, ROOM.hw, floor + ROOM.h);
  atmo.uBunD.value.set(zp + 0.1, 1, 0, 0);

  // The elevator's top end: its plate in the room's back wall, facing back toward the stair.
  const station = {
    pos: V(0, floor, zp).applyMatrix4(F.m), rotY: F.ry + Math.PI, zone: 'surface', parent: ctx.surface,
    collider: ctx.lateCollider('bunker-car'),
  };
  return {
    station, inside, frame: F, root,
    door: { isOpen: () => target === 1, set(o) { target = open = o ? 1 : 0; state.open = !!o; apply(); } },
  };
}
