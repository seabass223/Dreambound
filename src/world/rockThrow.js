import * as THREE from 'three';
import { Rng, clamp, smoothstep } from '../core/rng.js';

// The five boulders thrown out of the tor by rocks.exe (world/torBlast.js), onto random but always fair spots on the
// island, and the puzzle's boulders from then on (props/movableRocks.js). Adds to ctx.boulders:
//   released()                 they are out (state.rocks.released)
//   pickLandings(seed)         -> [{ x, z }] x 5 (world, by boulder): where each comes to rest. Seeded and deterministic.
//   launch({ landings, from, t0, seed })  throw them: scripted arcs from the tor's launch points (from: [Vector3] x 5,
//                              default the blast's own), tumbling, landing with a thud and a puff of dust, a hop and a
//                              short slide onto the landing spot, where the collider comes on. Returns the flights:
//                              [{ i, t0, tLand, tRest, from, impact, rest }] (seconds after the call). Writes
//                              state.rocks (released, positions, seed) at once, so a save made mid-flight restores the
//                              end. t0: seconds before the first leaves (default 0).
//   releaseInstant(positions, seed)  out at once where a saved game had them (no throw); positions: [{ x, z }] x 5
//                              (missing: seed's landings); seed (default state.rocks.seed) turns them as they landed
//   inFlight()                 any still in the air or sliding
//   positions()                [Vector3] x 5: where each boulder is now (in flight too)
//   flights                    the last launch's flights
//   onLand                     null; a hook (i, pos, r) called as each boulder hits the ground (camera shake)
//
// Where they land (per boulder, a target of its own, the targets shuffled): 6-14 m from that target, and
//   - at least r + 6 inside the rim, r + 1 clear of every blocker (sequoia, splash pool, piles, the tor's hull), r + 0.3 s
//     + 1 from each tree's trunk and r + 0.6 from each shrub, r + 3 from the creek's centreline, r + 4 from EVERY target
//     (nothing starts in place: the catch is 2.5 m), 12 m from the bridge's anchor, 7 m from the sequoia's elevator
//     plate, r + 1 off the stepping stones, r + 0.2 off each piece of the tor's settled debris, on ground no steeper
//     than a normal's y of 0.95, and r1 + r2 + 2.5 from each other boulder;
//   - with a straight push onto its target that passes the push rules every 0.25 m, keeps r + 0.3 off the trunks and
//     the other boulders' spots and lines, and leaves the player room to stand behind it all the way;
//   - and an arc there that never leaves the island, keeps 4.5 m + r / 2 off the sequoia's trunk axis below its crown
//     top, clears the tor's stump, the piles and the trees' trunks, never dips into the ground, and slides to rest
//     clear of the debris.
// A seed that finds no such set within a few tries falls back to FALLBACK (checked by tools/regress/out/rocks_exe_test.mjs).

const G = 9.8;
const TAU = Math.PI * 2;
const RULES = { rim: 6, blocker: 1, tree: 1, shrub: 0.6, creek: 3, target: 4, bridge: 12, plate: 7, stone: 1, debris: 0.2, normalY: 0.95, pair: 2.5, near: 6, far: 14 };
// Seconds after the call each boulder leaves the tor (by launch point: they go with the charges).
const DELAY = [0.03, 0.06, 0.1, 0.13, 0.16];
const SLIDE_T = 0.8;   // seconds from impact to rest
// Stack-local rest spots (one per boulder): the fallback (seed 1's pick with the shipped flags, kept and checked by the
// test against every rule, throw included).
const FALLBACK = [[-2.74, 27.44], [-24.8, -15.38], [18.69, -24.26], [13.71, 19.28], [5.2, -18.63]];

export function createRockThrow(ctx, stack, { flora, stream, bridgeA, platePos, stones, tree, torC, stump, piles, launch: launch0 }) {
  const B = ctx.boulders, state = ctx.state.rocks, rocks = B.rocks;
  const targets = B.targets;
  const cx = stack.cx ?? stack.cfg.x, cz = stack.cz ?? stack.cfg.z;
  const q = {};
  const ground = (x, z) => stack.heightAt(x, z);
  const trees = flora.trees, shrubs = flora.shrubs;
  // The tor's debris at rest (world/torBlast.js, made first): no boulder lands in a heap of it.
  const debris = ctx.torBlast?.debrisRest ?? [];
  const offDebris = (r, x, z) => debris.every((d) => Math.hypot(d.x - x, d.z - z) >= r + d.r + RULES.debris);

  // ---- The rules for a resting spot (radius r; others: [{ x, z, r }] already placed).
  const spotOk = (r, x, z, others = []) => {
    if (stack.edgeDist(x, z) < r + RULES.rim) return false;
    if (ground(x, z) === null) return false;
    for (const b of B.blockers) if (B.clearOf(b, x, z) < r + RULES.blocker) return false;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < r + 0.3 * t.s + RULES.tree) return false;
    for (const s of shrubs) if (Math.hypot(s.x - x, s.z - z) < r + RULES.shrub) return false;
    stream.closest(x, z, q);
    if (q.d < r + RULES.creek) return false;
    for (const t of targets) if (Math.hypot(t.x - x, t.z - z) < r + RULES.target) return false;
    if (Math.hypot(bridgeA.x - x, bridgeA.z - z) < RULES.bridge) return false;
    if (Math.hypot(platePos.x - x, platePos.z - z) < RULES.plate) return false;
    for (const s of stones) if (Math.hypot(s.x - x, s.z - z) - s.r < r + RULES.stone) return false;
    if (!offDebris(r, x, z)) return false;
    // Level enough under all of it, not just its centre.
    for (const [ox, oz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
      if (Math.abs(stack.normalAt(x + ox * r, z + oz * r).y) < RULES.normalY) return false;
    }
    for (const o of others) if (Math.hypot(o.x - x, o.z - z) < o.r + r + RULES.pair) return false;
    return true;
  };

  // ---- The push onto its target: the boulder's line, and the player's behind it.
  const segDist = (px, pz, ax, az, bx, bz) => {
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = clamp(((px - ax) * ex + (pz - az) * ez) / l2, 0, 1);
    return Math.hypot(px - ax - ex * t, pz - az - ez * t);
  };
  const pushOk = (r, x, z, t, others = []) => {
    const D = Math.hypot(t.x - x, t.z - z), ux = (t.x - x) / D, uz = (t.z - z) / D;
    const back = r * 0.88 + 0.32 + 0.3;
    let px = x, pz = z;
    for (let s = 0; s <= D + 1e-6; s += 0.25) {
      const nx = x + ux * Math.min(s, D), nz = z + uz * Math.min(s, D);
      if (s > 0 && !B.allowed(r, px, pz, nx, nz)) return false;
      for (const tr of trees) if (Math.hypot(tr.x - nx, tr.z - nz) < r + 0.3 * tr.s + 0.3) return false;
      // The player, leaning on it from behind: clear of trunks (their colliders), the blockers and the rim.
      const hx = nx - ux * back, hz = nz - uz * back;
      if (stack.edgeDist(hx, hz) < 1.2) return false;
      for (const b of B.blockers) if (B.clearOf(b, hx, hz) < 0.45) return false;
      for (const tr of trees) if (Math.hypot(tr.x - hx, tr.z - hz) < 0.3 * tr.s + 0.08 + 0.32 + 0.15) return false;
      px = nx; pz = nz;
    }
    // Clear of the other boulders: their spots off this line, this spot off their lines.
    for (const o of others) {
      if (segDist(o.x, o.z, x, z, t.x, t.z) < o.r + r + 0.3) return false;
      if (segDist(x, z, o.x, o.z, o.t.x, o.t.z) < o.r + r + 0.3) return false;
    }
    // Room to walk round behind it to start.
    const sx = x - ux * (r + 0.8), sz = z - uz * (r + 0.8);
    if (stack.edgeDist(sx, sz) < 1.5) return false;
    for (const b of B.blockers) if (B.clearOf(b, sx, sz) < 0.5) return false;
    for (const tr of trees) if (Math.hypot(tr.x - sx, tr.z - sz) < 0.3 * tr.s + 0.6) return false;
    return true;
  };

  // ---- The flight from a launch point to its rest spot: the arc to the impact, then a hop and slide along the way it
  // was going. Deterministic from (from, rest, r).
  const flightOf = (from, rest, r) => {
    const dx = rest.x - from.x, dz = rest.z - from.z, D = Math.hypot(dx, dz) || 1;
    const ux = dx / D, uz = dz / D;
    const T = 2.2 + 1.2 * smoothstep(12, 50, D);
    const L = clamp(0.3 + (D / T) * 0.06, 0.5, 1.3);
    const ix = rest.x - ux * L, iz = rest.z - uz * L;
    const gy = ground(ix, iz) ?? stack.top;
    const iy = gy + r * 0.35;
    return {
      from: from.clone(), T, L, ux, uz, impact: new THREE.Vector3(ix, iy, iz), rest: { x: rest.x, z: rest.z },
      vx: (ix - from.x) / T, vz: (iz - from.z) / T, vy: (iy - from.y + 0.5 * G * T * T) / T,
    };
  };
  const arcAt = (f, t, out) => out.set(f.from.x + f.vx * t, f.from.y + f.vy * t - 0.5 * G * t * t, f.from.z + f.vz * t);
  const seqTop = tree.y + 40;
  const _a = new THREE.Vector3();
  const arcOk = (f, r) => {
    for (let t = 0; t <= f.T; t += 0.04) {
      const p = arcAt(f, t, _a), low = p.y - r * 0.9;
      if (stack.edgeDist(p.x, p.z) < r + 1) return false;                               // never off the island
      if (p.y < seqTop && Math.hypot(p.x - tree.x, p.z - tree.z) < 4.5 + r * 0.5) return false;   // the sequoia's trunk
      if (stump.footprint(p.x, p.z) && low < stump.top + 0.3 && t > 0.15) return false;  // over the stump
      for (const pl of piles) if (B.clearOf(pl.blocker, p.x, p.z) < r && low < pl.top + 0.3) return false;
      const gy = ground(p.x, p.z);
      if (t < f.T - 0.12 && gy !== null && low < gy - 0.05) return false;              // through a hill
      for (const tr of trees) if (Math.hypot(tr.x - p.x, tr.z - p.z) < 0.3 * tr.s + r + 0.4 && low < tr.y + 4) return false;
    }
    // The slide: the push rules every 0.25 m, clear of trunks and the debris.
    const r0 = f.impact;
    if (!offDebris(r, r0.x, r0.z)) return false;
    for (let s = 0.25; s <= f.L + 1e-6; s += 0.25) {
      const nx = r0.x + f.ux * s, nz = r0.z + f.uz * s;
      if (!B.allowed(r, nx - f.ux * 0.25, nz - f.uz * 0.25, nx, nz)) return false;
      for (const tr of trees) if (Math.hypot(tr.x - nx, tr.z - nz) < r + 0.3 * tr.s + 0.3) return false;
      if (!offDebris(r, nx, nz)) return false;
    }
    return true;
  };

  // Launch points (world), and which goes with which boulder: the one leaving the tor on the side it is going (least
  // turning), among those whose every arc is good.
  const torAz = (p) => Math.atan2(p.z - torC.z, p.x - torC.x);
  const angd = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const PERMS = [];
  {
    const perm = (a, n = a.length) => { if (n === 1) { PERMS.push(a.slice()); return; } for (let i = 0; i < n; i++) { perm(a, n - 1); const j = n % 2 ? 0 : i; [a[j], a[n - 1]] = [a[n - 1], a[j]]; } };
    perm([0, 1, 2, 3, 4]);
  }
  const assign = (rests, from, strict = true) => {
    const ok = rests.map((p, i) => from.map((f) => !strict || arcOk(flightOf(f, p, rocks[i].r), rocks[i].r)));
    let best = null, bc = Infinity;
    for (const pm of PERMS) {
      let c = 0;
      for (let i = 0; i < 5 && c < bc; i++) c += ok[i][pm[i]] ? angd(torAz(from[pm[i]]), torAz(rests[i])) : Infinity;
      if (c < bc) { bc = c; best = pm; }
    }
    return best;
  };

  const tryPick = (rng) => {
    const order = [0, 1, 2, 3, 4];
    for (let i = 4; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    // The biggest first (the hardest to fit).
    const byR = [0, 1, 2, 3, 4].sort((a, b) => rocks[b].r - rocks[a].r || a - b);
    const placed = [];
    const rest = new Array(5);
    for (const i of byR) {
      const t = targets[order[i]], r = rocks[i].r;
      let got = null;
      for (let k = 0; k < 80 && !got; k++) {
        const a = rng.float(0, TAU), d = rng.float(RULES.near, RULES.far);
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (!spotOk(r, x, z, placed) || !pushOk(r, x, z, t, placed)) continue;
        if (!launch0.some((f) => arcOk(flightOf(f, { x, z }, r), r))) continue;
        got = { x, z, r, t, i };
      }
      if (!got) return null;
      placed.push(got);
      rest[i] = { x: got.x, z: got.z };
    }
    return remember(rest, assign(rest, launch0));
  };

  // The last pick's boulder-to-launch-point match (its arcs checked), which launch() takes rather than check all 25
  // arcs again in the blast's own frame.
  let picked = null;
  const keyOf = (ps) => ps.map((p) => `${p.x},${p.z}`).join(' ');
  const remember = (rest, pm) => { if (!pm) return null; picked = { key: keyOf(rest), pm }; return rest; };
  const pickLandings = (seed = 1) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const got = tryPick(new Rng((Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) + attempt * 7919) >>> 0));
      if (got) return got;
    }
    const fb = fallback();
    return remember(fb, assign(fb, launch0) ?? assign(fb, launch0, false));
  };
  const fallback = () => FALLBACK.map(([x, z]) => ({ x: cx + x, z: cz + z }));

  // ---- Flights.
  // Each boulder's turn at rest (on its bed), the same for a throw and a restore.
  const ryOf = (seed, i) => new Rng(((seed >>> 0) * 31 + i * 977 + 11) >>> 0).float(0, TAU);
  let flights = [], clock = 0;
  const yaw = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const valid = (ps) => Array.isArray(ps) && ps.length === rocks.length && ps.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));

  const launch = ({ landings = null, from = null, t0 = 0, seed = null } = {}) => {
    const rests = valid(landings) ? landings.map((p) => ({ x: p.x, z: p.z })) : pickLandings(seed ?? state.seed ?? 1);
    const pts = (from ?? launch0).map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z)));
    const pm = !from && picked?.key === keyOf(rests) ? picked.pm : assign(rests, pts) ?? assign(rests, pts, false);
    const rng = new Rng(4507 + (seed ?? 0));
    const sd = seed ?? state.seed ?? 0;
    clock = 0;
    flights = rests.map((rest, i) => {
      const f = flightOf(pts[pm[i]], rest, rocks[i].r);
      const delay = t0 + DELAY[pm[i]];
      B.sleep(i);
      return {
        ...f, i, r: rocks[i].r, t0: delay, tLand: delay + f.T, tRest: delay + f.T + SLIDE_T, landed: false, done: false,
        ry: ryOf(sd, i),
        spin: new THREE.Vector3(rng.float(-1, 1), rng.float(-0.4, 0.4), rng.float(-1, 1)).normalize(), w: rng.float(2.2, 4.4),
        roll: new THREE.Vector3(f.uz, 0, -f.ux), hop: 0.22 + 0.12 * rocks[i].r,
      };
    });
    B.group.visible = true;
    state.released = true;
    state.positions = rests.map((p) => ({ x: p.x, z: p.z }));
    state.pushes = [];
    state.solved = false;
    if (seed !== null) state.seed = seed;
    for (const f of flights) pose(f, 0);
    return flights.map((f) => ({ i: f.i, t0: f.t0, tLand: f.tLand, tRest: f.tRest, from: f.from.clone(), impact: f.impact.clone(), rest: { ...f.rest } }));
  };

  // The boulder's turn: it comes to rest upright on its bed (turned ry), rolled back along its slide and tumbled
  // about `spin` before that; so the tumble unwinds into the roll, and the roll into the rest.
  const turn = (f, rollBack, tumble, out) => {
    yaw.setFromAxisAngle(up, f.ry);
    qa.setFromAxisAngle(f.roll, -rollBack);
    qb.setFromAxisAngle(f.spin, tumble);
    return out.copy(qa).multiply(qb).multiply(yaw);
  };
  const pose = (f, t) => {
    const m = rocks[f.i].mesh;
    const rollK = 0.6 / f.r;
    if (t < f.tLand) {
      const tt = Math.max(0, t - f.t0);
      arcAt(f, tt, m.position);
      turn(f, f.L * rollK, f.w * (tt - f.T), m.quaternion);
      return;
    }
    const u = Math.min(1, (t - f.tLand) / SLIDE_T), s = f.L * (1 - (1 - u) * (1 - u));
    const x = f.impact.x + f.ux * s, z = f.impact.z + f.uz * s;
    const hopU = Math.min(1, u / 0.5);
    const y = (ground(x, z) ?? f.impact.y - f.r * 0.35) + f.r * 0.35 + f.hop * Math.sin(Math.PI * hopU) * (1 - u * 0.5);
    m.position.set(x, y, z);
    turn(f, (f.L - s) * rollK, 0, m.quaternion);
  };
  const _p = new THREE.Vector3();
  ctx.updaters.push((dt) => {
    if (!flights.length) return;
    clock += dt;
    let busy = false;
    for (const f of flights) {
      if (f.done) continue;
      busy = true;
      pose(f, clock);
      if (!f.landed && clock >= f.tLand) {
        f.landed = true;
        _p.copy(f.impact).setY(f.impact.y - f.r * 0.35);
        ctx.audio?.play?.('rockLand', { pos: _p.clone(), size: f.r });
        ctx.torBlast?.landDust?.(f.i, _p, f.r);
        B.onLand?.(f.i, _p.clone(), f.r);
      }
      if (clock >= f.tRest) {
        f.done = true;
        B.wake(f.i, f.rest.x, f.rest.z);
        turn(f, 0, 0, rocks[f.i].mesh.quaternion);
      }
    }
    if (!busy) flights = [];
  });

  const releaseInstant = (positions, seed = state.seed) => {
    const ps = valid(positions) ? positions : pickLandings(seed ?? 1);
    flights = [];
    ps.forEach((p, i) => {
      B.wake(i, p.x, p.z);
      rocks[i].mesh.quaternion.setFromAxisAngle(up, ryOf(seed ?? 0, i));
    });
    state.released = true;
    if (seed !== null && seed !== undefined) state.seed = seed;
  };

  const api = {
    released: () => !!state.released,
    pickLandings,
    launch,
    releaseInstant,
    inFlight: () => flights.some((f) => !f.done),
    positions: () => rocks.map((r) => r.mesh.position.clone()),
    get flights() { return flights; },
    onLand: null,
    // For the test: the rules as the picker applies them.
    rules: { RULES, spotOk, pushOk, flightOf, arcOk, arcAt, assign, launchFrom: launch0, fallback, stones, trees, shrubs, tree, stump },
  };
  Object.defineProperties(B, Object.getOwnPropertyDescriptors(api));
  return B;
}
