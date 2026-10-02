import * as THREE from 'three';
import { materials, patchMaterial } from '../render/materials.js';
import { PLAYER } from '../config.js';
import { makeRockGeometry } from '../world/features.js';
import { rocksOnTargets } from '../world/rockPuzzle.js';

// Five large boulders the player can shove by walking into them. Their positions and push order are
// recorded in ctx.state.rocks. targets (world x, z; world/rockPuzzle.js): once every one has its own boulder,
// state.solved is set and ctx.onRocksSolved() fires, once.
//
// At the start of the game there are none: the five are blown off the tor by rocks.exe (world/torBlast.js) and thrown
// across the island (world/rockThrow.js). Until then they are DORMANT: built here at their old spots (so the world's
// random streams and collider list stay as they were) but hidden under this feature's own group, their colliders off,
// out of the push rules and the push updater. wake() brings one to life where it lands (or where a saved game left it);
// state.released says they are out.
//
// geos (optional): the boulders' own meshes (tor_blast.glb's tor_boulder_<i>: { geo, r }, in metres, centred), drawn
// with the tor's material; else a noise rock each, scaled to (r, 0.85 r, r).
export function createMovableRocks(ctx, stack, spots, { blockers = [], targets = [], geos = null } = {}) {
  const M = materials();
  // Cast from the sunny side, not three.js's default back faces, or the ground just round each boulder's foot shows a
  // lit rim in its shadow (see materials().cliff). A copy: the stone's other uses include open shells (the cliff
  // path's underside) that must keep casting from their back faces.
  const stone = patchMaterial(Object.assign((geos ? M.cliff : M.stone).clone(), { shadowSide: THREE.FrontSide, name: 'boulder' }));
  // Their own shadow-depth material: the renderer's shared one switches its shader only when an instanced or batched
  // caster comes along, so a front-sided caster drawn after one can need a variant nothing compiled before the
  // preload (a hitch the first time the boulders show). This one is compiled when the preloader draws them.
  const depth = new THREE.MeshDepthMaterial();
  const group = new THREE.Group();
  group.name = 'boulders';
  group.visible = false;   // dormant (the LOD may toggle each mesh's own visibility; this group is the feature's)
  ctx.surface.add(group);
  const rocks = [];
  const state = ctx.state.rocks = { positions: [], pushes: [], solved: false, released: false, seed: null };
  spots.forEach((s, i) => {
    const own = geos?.[i];
    const mesh = new THREE.Mesh(own ? own.geo : makeRockGeometry(900 + i, 3), stone);
    const r = s.r;
    if (!own) mesh.scale.set(r, r * 0.85, r);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = depth;
    mesh.name = 'boulder';
    group.add(mesh);
    ctx.lod?.add(mesh, { out: [110, 140], dynamic: true, name: 'boulder' });
    const y = stack.heightAt(s.x, s.z);
    mesh.position.set(s.x, y + r * 0.35, s.z);
    mesh.rotation.y = i * 1.3;
    // A box, not a circle: it turns to face the way you're looking (below), so whatever part of it you walk into is a
    // flat face square to your path and you push straight on, instead of sliding off round a curve (hz: the face's
    // distance from the centre, where you stand to push; hx: its half width).
    const col = ctx.physics.addOBB({ x: s.x, z: s.z, hx: r * 0.8, hz: r * 0.88, ry: 0, y0: y - 1, y1: y + r * 1.6, zone: 'surface', rock: i });
    col.enabled = false;
    rocks.push({ mesh, col, r, pushT: 0, moving: 0, live: false });
    state.positions.push({ x: s.x, z: s.z });
  });

  // The push rules: a boulder stays 2 m + its radius inside the rim and never overlaps another boulder or a blocker
  // (the sequoia and the splash pool as circles, the tor and the piles as their convex hulls). One that starts inside a
  // blocker's reach may only move out of it, never deeper in. allowed(): the rules for a boulder of radius r moving from
  // (x0, z0) to (nx, nz), the other boulders aside (the landing picker, world/rockThrow.js, walks its push lines with it).
  const clearOf = (b, x, z) => (b.hull ? hullDist(b.hull, x, z) : Math.hypot(b.x - x, b.z - z) - b.r);
  const allowed = (r, x0, z0, nx, nz) => {
    if (stack.edgeDist(nx, nz) < r + 2) return false;
    for (const b of blockers) {
      const d = clearOf(b, nx, nz);
      if (d < r && d < clearOf(b, x0, z0)) return false;
    }
    return true;
  };
  // (Only boulders that are out count: dormant ones aren't there, flying ones are still in the air.)
  const canMoveTo = (rk, nx, nz) => {
    for (const o of rocks) if (o !== rk && o.live && Math.hypot(o.col.x - nx, o.col.z - nz) < o.r + rk.r) return false;
    return allowed(rk.r, rk.col.x, rk.col.z, nx, nz);
  };
  const checkSolved = () => {
    if (state.solved || !targets.length || !rocksOnTargets(state.positions, targets)) return;
    state.solved = true;
    ctx.onRocksSolved?.();
  };

  let scrape = null, anyLive = false;
  const push = new THREE.Vector2(), axis = new THREE.Vector3();
  // Pushing holds you to the boulder. Once a push has started (you walked into its face, square to where you're
  // looking, and leaned on it for a moment), its line is fixed and you are kept right behind the boulder on it, looking
  // where you like; letting go of W, or pressing A, D or S, lets go of it.
  let lock = null;   // { rk, dx, dz }
  const shove = (rk, dx, dz, dt) => {
    push.set(dx, dz).multiplyScalar(0.75 * dt);
    const nx = rk.col.x + push.x, nz = rk.col.z + push.y;
    if (!canMoveTo(rk, nx, nz)) return false;
    rk.col.x = nx; rk.col.z = nz;
    const y = stack.heightAt(nx, nz) ?? rk.mesh.position.y;
    rk.mesh.position.set(nx, y + rk.r * 0.35, nz);
    // Roll a little in the push direction.
    rk.mesh.rotateOnWorldAxis(axis.set(push.y, 0, -push.x).normalize(), (push.length() / rk.r) * 0.35);
    rk.col.y0 = y - 1; rk.col.y1 = y + rk.r * 1.6;
    rk.moving = 0.2;
    state.positions[rocks.indexOf(rk)] = { x: nx, z: nz };
    const idx = rocks.indexOf(rk);
    if (state.pushes[state.pushes.length - 1] !== idx) state.pushes.push(idx);
    return true;
  };
  ctx.updaters.push((dt) => {
    if (!anyLive) return;   // dormant: nothing to push yet
    const p = ctx.player;
    let anyMoving = false;
    const a = p.input.axis();
    if (lock && (!p.canMove || p.mode !== 'walk' || a.y <= 0 || a.x !== 0 || !lock.rk.live)) lock = null;
    // Each box's face turns toward you: square to the way you're looking; while a push is held, square to its line.
    for (const r of rocks) if (r.live) r.col.ry = lock?.rk === r ? Math.atan2(-lock.dx, -lock.dz) : p.yaw;
    if (lock) {
      const rk = lock.rk;
      if (shove(rk, lock.dx, lock.dz, dt)) anyMoving = true;
      // Stay behind it on the line (where the capsule meets its circle), whatever the collision did this frame.
      const d = rk.col.hz + PLAYER.radius + 0.005;
      p.feet.x = rk.col.x - lock.dx * d; p.feet.z = rk.col.z - lock.dz * d;
    } else {
      for (const c of p.contacts) {
        const rk = rocks.find((r) => r.col === c.collider);
        if (!rk || !rk.live) continue;
        if (!p.canMove || a.y <= 0) continue;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const dot = fx * c.nx + fz * c.nz;
        if (dot < 0.5) continue;
        rk.pushT += dt;
        if (rk.pushT < 0.35) continue; // needs a deliberate lean
        const l = Math.hypot(c.nx, c.nz) || 1;
        if (shove(rk, c.nx / l, c.nz / l, dt)) anyMoving = true;
        if (a.x === 0) lock = { rk, dx: c.nx / l, dz: c.nz / l };
        break;
      }
    }
    if (anyMoving) checkSolved();
    for (const r of rocks) {
      r.moving = Math.max(0, r.moving - dt);
      if (lock?.rk !== r && !p.contacts.some((c) => c.collider === r.col)) r.pushT = 0;
    }
    const moving = rocks.find((r) => r.moving > 0);
    if (moving && !scrape) scrape = ctx.audio?.loop('scrape', { pos: moving.mesh.position });
    if (moving && scrape) scrape.setPos?.(moving.mesh.position);
    if (!moving && scrape) { scrape.stop(); scrape = null; }
  });
  // Put boulder i at world x, z at once (restoring a saved game, core/save.js); no push rules, no hook.
  const place = (i, x, z) => {
    const rk = rocks[i];
    if (!rk || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const y = stack.heightAt(x, z) ?? rk.mesh.position.y - rk.r * 0.35;
    rk.col.x = x; rk.col.z = z;
    rk.col.y0 = y - 1; rk.col.y1 = y + rk.r * 1.6;
    rk.mesh.position.set(x, y + rk.r * 0.35, z);
    state.positions[i] = { x, z };
  };
  // Boulder i comes to life at world x, z (landed, or restored): shown, its collider on, in the push rules. Its mesh's
  // turn is the caller's (the throw leaves it as it came to rest).
  const wake = (i, x, z) => {
    const rk = rocks[i];
    if (!rk) return;
    place(i, x, z);
    rk.live = true;
    rk.col.enabled = true;
    rk.pushT = 0; rk.moving = 0;
    group.visible = true;
    state.released = true;
    anyLive = true;
  };
  // Boulder i out of play again (it is being thrown: in the air it has no collider and blocks nothing).
  const sleep = (i) => {
    const rk = rocks[i];
    if (!rk) return;
    rk.live = false;
    rk.col.enabled = false;
    if (lock?.rk === rk) lock = null;
    anyLive = rocks.some((r) => r.live);
  };
  // For tests and the console: the boulders, the rules and the targets. (world/rockThrow.js adds the throw: released,
  // pickLandings, launch, releaseInstant, inFlight, positions.)
  ctx.boulders = { rocks, blockers, targets, canMoveTo, allowed, clearOf, checkSolved, place, wake, sleep, group };
  return rocks;
}

// How far (x, z) is outside a convex polygon [x0, z0, x1, z1, ...] (negative inside: minus the distance to its edge).
function hullDist(h, x, z) {
  const n = h.length / 2;
  let d2 = Infinity, sgn = 0, inside = true;
  for (let i = 0; i < n; i++) {
    const ax = h[i * 2], az = h[i * 2 + 1], bx = h[((i + 1) % n) * 2], bz = h[((i + 1) % n) * 2 + 1];
    const ex = bx - ax, ez = bz - az, px = x - ax, pz = z - az;
    const t = Math.max(0, Math.min(1, (px * ex + pz * ez) / (ex * ex + ez * ez)));
    d2 = Math.min(d2, (px - ex * t) ** 2 + (pz - ez * t) ** 2);
    const c = Math.sign(ex * pz - ez * px);
    if (c !== 0) { if (sgn === 0) sgn = c; else if (c !== sgn) inside = false; }
  }
  return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
}
