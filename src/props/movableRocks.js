import * as THREE from 'three';
import { materials } from '../render/materials.js';
import { makeRockGeometry } from '../world/features.js';
import { rocksOnTargets } from '../world/rockPuzzle.js';

// Five large boulders the player can shove by walking into them. Their positions and push order are
// recorded in ctx.state.rocks. targets (world x, z; world/rockPuzzle.js): once every one has its own boulder,
// state.solved is set and ctx.onRocksSolved() fires, once.
export function createMovableRocks(ctx, stack, spots, { blockers = [], targets = [] } = {}) {
  const M = materials();
  const rocks = [];
  const state = ctx.state.rocks = { positions: [], pushes: [], solved: false };
  spots.forEach((s, i) => {
    const geo = makeRockGeometry(900 + i, 3);
    const mesh = new THREE.Mesh(geo, M.stone);
    const r = s.r;
    mesh.scale.set(r, r * 0.85, r);
    mesh.castShadow = true; mesh.receiveShadow = true;
    ctx.surface.add(mesh);
    ctx.lod?.add(mesh, { out: [110, 140], dynamic: true, name: 'boulder' });
    const y = stack.heightAt(s.x, s.z);
    mesh.position.set(s.x, y + r * 0.35, s.z);
    mesh.rotation.y = i * 1.3;
    const col = ctx.physics.addCircle({ x: s.x, z: s.z, r: r * 0.92, y0: y - 1, y1: y + r * 1.6, zone: 'surface', rock: i });
    rocks.push({ mesh, col, r, pushT: 0, moving: 0 });
    state.positions.push({ x: s.x, z: s.z });
  });

  // The push rules: a boulder stays 2 m + its radius inside the rim and never overlaps another boulder or a blocker
  // (the sequoia, the tor, the piles, the splash pool).
  const canMoveTo = (rk, nx, nz) => {
    if (stack.edgeDist(nx, nz) < rk.r + 2) return false;
    for (const o of rocks) if (o !== rk && Math.hypot(o.col.x - nx, o.col.z - nz) < o.r + rk.r) return false;
    for (const b of blockers) if (Math.hypot(b.x - nx, b.z - nz) < b.r + rk.r) return false;
    return true;
  };
  const checkSolved = () => {
    if (state.solved || !targets.length || !rocksOnTargets(state.positions, targets)) return;
    state.solved = true;
    ctx.onRocksSolved?.();
  };

  let scrape = null;
  const push = new THREE.Vector2();
  ctx.updaters.push((dt) => {
    const p = ctx.player;
    let anyMoving = false;
    for (const c of p.contacts) {
      const rk = rocks.find((r) => r.col === c.collider);
      if (!rk) continue;
      const a = p.input.axis();
      if (!p.canMove || a.y <= 0) continue;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const dot = fx * c.nx + fz * c.nz;
      if (dot < 0.5) continue;
      rk.pushT += dt;
      if (rk.pushT < 0.35) continue; // needs a deliberate lean
      push.set(c.nx, c.nz).normalize().multiplyScalar(0.75 * dt);
      const nx = rk.col.x + push.x, nz = rk.col.z + push.y;
      if (!canMoveTo(rk, nx, nz)) continue;
      rk.col.x = nx; rk.col.z = nz;
      const y = stack.heightAt(nx, nz) ?? rk.mesh.position.y;
      rk.mesh.position.set(nx, y + rk.r * 0.35, nz);
      // Roll a little in the push direction.
      rk.mesh.rotateOnWorldAxis(new THREE.Vector3(push.y, 0, -push.x).normalize(), (push.length() / rk.r) * 0.35);
      rk.col.y0 = y - 1; rk.col.y1 = y + rk.r * 1.6;
      anyMoving = true;
      rk.moving = 0.2;
      state.positions[rocks.indexOf(rk)] = { x: nx, z: nz };
      const idx = rocks.indexOf(rk);
      if (state.pushes[state.pushes.length - 1] !== idx) state.pushes.push(idx);
    }
    if (anyMoving) checkSolved();
    for (const r of rocks) {
      r.moving = Math.max(0, r.moving - dt);
      if (!p.contacts.some((c) => c.collider === r.col)) r.pushT = 0;
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
  // For tests and the console: the boulders, the rules and the targets.
  ctx.boulders = { rocks, blockers, targets, canMoveTo, checkSolved, place };
  return rocks;
}
