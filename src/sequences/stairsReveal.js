import * as THREE from 'three';
import { smoothstep, clamp } from '../core/rng.js';

// The stairs reveal: the five boulders sit on their marks (props/movableRocks.js fires ctx.onRocksSolved) and the way
// on to the End stack opens. The gatehouse at the Rocks rim, where the rope bridge used to be (props/gatehouse.js),
// unbolts its blast doors and a steel staircase runs out from its sill, one section at a time, down across the gap to
// the End landing. A main.js sequence ({ done, update(dt) }), timed by its own t (a staircase of n sections; the
// travel's length depends on how far the player stands from the gatehouse, everything after it moves with it; ~21-26 s
// in all):
//   0       the camera is taken from the player's eye as it was; a distant mechanical rumble, the view trembles (and
//           the flight is planned, a few ms a frame)
//   1.1     the camera rises out of the player's eye and flies over the island (out from under a tree first if it
//           stands under one, up over the crowns, round the sequoia's) to above and behind the gatehouse (G1), turning
//           to look out over the gap at the End island; 3.3-10 s, depending on the way (planFlight)
//   G1      it glides on out over the facade, and as it clears it swings round (the shorter way) to look back at the
//           cliff (F1, 3 s), then backs away out over the void still looking at it, to 22 m out, 10 m to the right of
//           the stairs' line and 3 m under the sill (G2, 3 s); as the facade swings into view the beacon is turning
//           and the flood lamps flicker on
//   G2-0.9  the bolts draw back (hatchUnlock); the leaves slide apart (hatchSlide, 2.4 s) as the camera leans in
//   +1.9    the sections run out one by one (STEP s each, stairExtend each) while the camera pulls back and tracks
//           down the line toward End, turning from the doors to the whole staircase (G4)
//   +0.4    the hold: the finished staircase, gatehouse to End landing, from three quarters on, drifting (1.6 s)
//   then    a fade through black, and the player's own view (and control) comes back
// Every move is a cubic curve, eased (planFlight's path walked at a camera's pace, then keyTrack's keyframes), in
// position and in yaw / pitch / roll / fov, so nothing snaps and the camera's up stays vertical. The state is written
// as the reveal starts (ctx.state.endgame.open), so a save made during it restores the open staircase.

const UP = new THREE.Vector3(0, 1, 0);
const STEP = 0.36;          // s per section running out
const BEAT = 1.1;           // s of rumble before the camera moves
const DOOR_TIME = 2.4;      // the leaves' slide (audio hatchSlide's default duration)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smoother = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * s * (s * (s * 6 - 15) + 10); };

// ---------------------------------------------------------------------------------------------------------------
// A keyframed curve through time. keys: [{ t, v: number[], d?: number[] }] in time order; d is the rate of change at
// that key (per second), or, left out, the Catmull-Rom slope between its neighbours, limited per channel so the curve
// never overshoots a key (0 where the channel turns round, at most 3x either neighbouring segment's slope: the
// Fritsch-Carlson box) and 0 at the first and last keys. Cubic Hermite between keys: C1 (no jumps in position or in
// speed), and before the first or after the last key it holds still.
export function keyTrack(keys) {
  const n = keys.length, dim = keys[0].v.length;
  const T = keys.map((k) => k.t), V = keys.map((k) => k.v);
  const M = keys.map((k, i) => {
    if (k.d) return k.d;
    const m = new Array(dim).fill(0);
    if (i === 0 || i === n - 1) return m;
    for (let c = 0; c < dim; c++) {
      const d0 = (V[i][c] - V[i - 1][c]) / (T[i] - T[i - 1]), d1 = (V[i + 1][c] - V[i][c]) / (T[i + 1] - T[i]);
      if (d0 * d1 <= 0) continue;
      const s = (V[i + 1][c] - V[i - 1][c]) / (T[i + 1] - T[i - 1]), lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
      m[c] = Math.abs(s) > lim ? Math.sign(s) * lim : s;
    }
    return m;
  });
  let seg = 0;
  return (t, out = new Array(dim)) => {
    if (t <= T[0]) { for (let c = 0; c < dim; c++) out[c] = V[0][c]; return out; }
    if (t >= T[n - 1]) { for (let c = 0; c < dim; c++) out[c] = V[n - 1][c]; return out; }
    if (t < T[seg] || t >= T[seg + 1]) { seg = 0; while (t >= T[seg + 1]) seg++; }
    const h = T[seg + 1] - T[seg], s = (t - T[seg]) / h, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const a = V[seg], b = V[seg + 1], ma = M[seg], mb = M[seg + 1];
    for (let c = 0; c < dim; c++) out[c] = h00 * a[c] + h10 * h * ma[c] + h01 * b[c] + h11 * h * mb[c];
    return out;
  };
}

// The view's yaw and pitch toward a point (the player's convention: yaw 0 looks down -Z).
export function lookAngles(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

// ---------------------------------------------------------------------------------------------------------------
// What the flight over the island keeps clear of besides the colliders (planFlight checks those): the trees' crowns
// and the sequoia's, which have no collision, as upright profiles { x, z, y (base), step, s (scale), r: [radius per
// step of height], top }. Made once (they never move); prepareStairsReveal() makes it with the world.
function crowns(ctx) {
  if (ctx.revealCrowns) return ctx.revealCrowns;
  const out = [];
  const st = ctx.stacks?.rocks;
  const forest = ctx.forest;
  if (st && forest?.items && forest.footprint) {
    for (const sp of ['pine', 'broadleaf']) {
      const list = forest.items[sp];
      if (!list?.length) continue;
      const near = list.filter((t) => Math.hypot(t.x - st.cx, t.z - st.cz) < st.r + 10);
      if (!near.length) continue;
      // The footprint's 0.5 m bands, with the trunk (and a margin) under the crown.
      const bands = forest.footprint(sp), prof = [];
      for (const b of bands) prof[Math.round(b.y0 / 0.5)] = b.r;
      for (let k = 0; k < prof.length; k++) prof[k] = Math.max(prof[k] ?? 0, 0.45) + 0.5;
      for (const t of near) out.push({ x: t.x, z: t.z, y: t.y - 0.3, step: 0.5 * t.scale, s: t.scale, r: prof, top: t.y + prof.length * 0.5 * t.scale + 0.6 });
    }
  }
  // The sequoia: its trunk (with the elevator's door and CAM 07 on it), then the crown's cards' extent.
  const canopy = ctx.surface?.getObjectByName?.('sequoia-canopy');
  if (canopy?.geometry) {
    if (!canopy.geometry.boundingBox) canopy.geometry.computeBoundingBox();
    const bb = canopy.geometry.boundingBox, p = canopy.position;
    const rc = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) + 1.5;
    const k0 = Math.max(1, Math.floor(bb.min.y / 2));
    const prof = [];
    for (let k = 0; k * 2 < bb.max.y + 2; k++) prof.push(k < k0 ? 7 : rc);
    out.push({ x: p.x, z: p.z, y: p.y - 1, step: 2, s: 1, r: prof, top: p.y + bb.max.y + 2 });
  }
  return (ctx.revealCrowns = out);
}
// How far point (x, y, z) is inside any crown (0: clear).
function inCrowns(list, x, y, z) {
  let worst = 0;
  for (const o of list) {
    if (y < o.y || y > o.top) continue;
    const d = Math.hypot(x - o.x, z - o.z);
    const r = (o.r[Math.min(o.r.length - 1, Math.floor((y - o.y) / o.step))] ?? 0) * o.s;
    if (d < r) worst = Math.max(worst, r - d + 0.5);
  }
  return worst;
}

// Made with the world (main.js, beside prepareEnding): the obstacles above, so the reveal's first frame doesn't build
// the trees' footprints.
export function prepareStairsReveal(ctx) { crowns(ctx); }

// A smooth path through points (a cubic Hermite spline on chord-length knots: the given unit directions at either end
// and wherever dirs has one, Catmull-Rom tangents elsewhere), walked by arc length: { len, at(s, out) }, s in metres.
function hermitePath(pts, d0, d1, dirs = [], steps = 480) {
  // (Points within 0.75 m of the one before are dropped, but never the last: it replaces the one before it.)
  const P = [pts[0]], D = [d0], last = pts.length - 1;
  pts.forEach((p, i) => {
    if (!i) return;
    if (p.distanceTo(P[P.length - 1]) > 0.75) { P.push(p); D.push(dirs[i] ?? null); } else if (i === last && P.length > 1) P[P.length - 1] = p;
  });
  if (P.length < 2) { P.push(pts[last].clone().addScaledVector(d1, 0.01)); D.push(null); }
  D[D.length - 1] = d1;
  const m = P.length - 1, u = [0];
  for (let i = 1; i <= m; i++) u.push(u[i - 1] + P[i].distanceTo(P[i - 1]));
  const M = P.map((p, i) => (D[i] ? D[i].clone() : P[i + 1].clone().sub(P[i - 1]).divideScalar(u[i + 1] - u[i - 1])));
  const raw = (x, out) => {
    let j = 0;
    while (j < m - 1 && x > u[j + 1]) j++;
    const h = u[j + 1] - u[j], s = clamp((x - u[j]) / h, 0, 1), s2 = s * s, s3 = s2 * s;
    return out.copy(P[j]).multiplyScalar(2 * s3 - 3 * s2 + 1).addScaledVector(M[j], h * (s3 - 2 * s2 + s))
      .addScaledVector(P[j + 1], -2 * s3 + 3 * s2).addScaledVector(M[j + 1], h * (s3 - s2));
  };
  // Arc length against the knot parameter, finely enough that walking it is even.
  const N = steps * m, U = new Float64Array(N + 1), Sx = new Float64Array(N + 1);
  const a = raw(0, new THREE.Vector3()), b = new THREE.Vector3();
  for (let k = 1; k <= N; k++) {
    U[k] = (u[m] * k) / N;
    raw(U[k], b);
    Sx[k] = Sx[k - 1] + b.distanceTo(a);
    a.copy(b);
  }
  const len = Sx[N];
  let k0 = 0;
  return {
    len,
    at(s, out = new THREE.Vector3()) {
      s = clamp(s, 0, len);
      if (s < Sx[k0]) k0 = 0;
      while (k0 < N - 1 && s > Sx[k0 + 1]) k0++;
      const f = (s - Sx[k0]) / Math.max(1e-9, Sx[k0 + 1] - Sx[k0]);
      return raw(U[k0] + (U[k0 + 1] - U[k0]) * f, out);
    },
  };
}

// How a camera flies along a path: from rest to vEnd, at most vMax, never more than aT of speed gained or lost per
// second, nor more than aLat of sideways pull in a bend (so tight bends are taken slowly), the speed smoothed along the
// way. -> { T (s), at(t) -> s (metres along) }, constant acceleration inside each 0.25 m step, so the speed is
// continuous.
function flightTiming(curve, { vEnd = 3, vMax = 24, aT = 7.5, aLat = 11 } = {}) {
  const ds = 0.25, N = Math.max(2, Math.ceil(curve.len / ds)), h = curve.len / N;
  const P = [];
  for (let i = 0; i <= N; i++) P.push(curve.at(i * h));
  const kappa = new Float64Array(N + 1), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 1; i < N; i++) {
    a.subVectors(P[i], P[i - 1]).normalize(); b.subVectors(P[i + 1], P[i]).normalize();
    kappa[i] = Math.acos(clamp(a.dot(b), -1, 1)) / h;
  }
  // The bend ahead and behind (2 m either way) sets the limit, so the camera slows before it, not in it.
  const W2 = Math.ceil(2 / h), v = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    let k = 0;
    for (let j = Math.max(0, i - W2); j <= Math.min(N, i + W2); j++) k = Math.max(k, kappa[j]);
    v[i] = Math.min(vMax, Math.sqrt(aLat / Math.max(k, 1e-6)));
  }
  v[0] = 0; v[N] = Math.min(v[N], vEnd);
  for (let i = 1; i <= N; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * aT * h));
  for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * aT * h));
  // Rounded off (a moving average, the ends held), so the pull eases in and out rather than switching.
  const R = Math.ceil(1.5 / h);
  for (let pass = 0; pass < 3; pass++) {
    const c = Float64Array.from(v);
    for (let i = 1; i < N; i++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - R); j <= Math.min(N, i + R); j++) { s += c[j]; n++; }
      v[i] = Math.min(c[i], s / n);
    }
  }
  if (v[N] < 0.2) v[N] = 0.2;
  const t = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) t[i] = t[i - 1] + (2 * h) / Math.max(1e-3, v[i - 1] + v[i]);
  let i0 = 0;
  return {
    T: t[N],
    vEnd: v[N],
    at(tt) {
      if (tt <= 0) return 0;
      if (tt >= t[N]) return curve.len;
      if (tt < t[i0]) i0 = 0;
      while (tt > t[i0 + 1]) i0++;
      const tau = tt - t[i0], dt = t[i0 + 1] - t[i0], acc = (v[i0 + 1] - v[i0]) / dt;
      return i0 * h + v[i0] * tau + 0.5 * acc * tau * tau;
    },
  };
}

// The flight from the player's eye P0 to G1 (arriving level, heading along O, over the gatehouse). Out from under a
// crown first if the eye is under one (level, at eye height, to the nearest spot with open sky above it), then up
// through one waypoint W (how far along, how far to the side, how high) to G1; of all the candidates the one that
// keeps best clear of the crowns, the boulders and the like, the ground and the gatehouse (with a small preference for
// the plainest), then checked in that order against every collider: it mustn't cross one nor pass within 0.4 m of one.
// A generator: it yields between candidates, so the reveal can spread the work over the frames of its opening beat
// (all of it at once is ~20-60 ms). -> { curve, timing, cost, verified, escape, f, b, up }
function* planFlight(ctx, P0, G1, O, { S, R, hTop }) {
  const stack = ctx.stacks?.rocks ?? null;
  const obstacles = crowns(ctx);
  const far = Math.hypot(G1.x - P0.x, G1.z - P0.z) + 40;
  const dyn = (ctx.physics?.dynamic ?? []).filter((d) => d.enabled && (!d.zone || d.zone === 'surface') && Math.hypot(d.x - P0.x, d.z - P0.z) < far)
    .map((d) => ({ x: d.x, z: d.z, r: (d.type === 'circle' ? d.r : Math.hypot(d.hx, d.hz)) + 0.6, y0: d.y0 - 0.5, y1: d.y1 + 0.6 }));
  // The gatehouse's block (generously: its buttresses, lamps, roof railing and beacon, the apron down the cliff), in
  // (out, side, up) from the sill.
  const box = { o: [-8.2, 1.4], r: [-4.7, 4.7], u: [-7, hTop + 1.8] };
  const inGatehouse = (p) => {
    const dx = p.x - S.x, dz = p.z - S.z, o = dx * O.x + dz * O.z, r = dx * R.x + dz * R.z, u = p.y - S.y;
    const e = Math.min(o - box.o[0], box.o[1] - o, r - box.r[0], box.r[1] - r, u - box.u[0], box.u[1] - u);
    return e > 0 ? e + 0.5 : 0;
  };
  const inDyn = (p) => {
    let b = 0;
    for (const o of dyn) if (p.y > o.y0 && p.y < o.y1) { const d = Math.hypot(p.x - o.x, p.z - o.z); if (d < o.r) b += o.r - d; }
    return b;
  };
  // How badly a point breaks clearance (0: fine). near: by the eye, where the ground may be closer.
  const badness = (p, near) => {
    let b = inCrowns(obstacles, p.x, p.y, p.z) * 4 + inGatehouse(p) * 6 + inDyn(p) * 4;
    const h = stack?.heightAt(p.x, p.z), clear = near ? 1.0 : 2.0;
    if (h != null && p.y - h < clear) b += (clear - (p.y - h)) * 6;
    return b;
  };

  // The colliders.
  const surf = (ctx.physics?.colliders ?? []).filter((c) => c.enabled && c.zone === 'surface' && c.bvh);
  const ray = new THREE.Ray();
  const hits = (p, d, dist) => {
    ray.set(p, d);
    for (const c of surf) {
      if (c.box && !ray.intersectsBox(c.box)) continue;
      if (c.bvh.raycastFirst(ray, THREE.DoubleSide, 0, dist)) return true;
    }
    return false;
  };

  // Out from under the trees: the nearest spot (over the cap, a clear level move away) with open sky above it.
  const columnBad = (x, z) => { let b = 0; for (let y = P0.y + 0.3; y < P0.y + 20; y += 1) b += inCrowns(obstacles, x, y, z); return b; };
  const toG1 = new THREE.Vector3(G1.x - P0.x, 0, G1.z - P0.z).normalize();
  let escape = null;
  if (columnBad(P0.x, P0.z) > 0) {
    const dir = new THREE.Vector3(), p = new THREE.Vector3();
    for (const rho of [2, 3.5, 5, 7, 9, 12, 15]) {
      let bs = Infinity;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        dir.set(Math.cos(a), 0, Math.sin(a));
        p.copy(P0).addScaledVector(dir, rho).setY(P0.y + 0.3);
        const h = stack?.heightAt(p.x, p.z);
        if (h == null || stack.edgeDist(p.x, p.z) < 3 || columnBad(p.x, p.z) > 0 || hits(P0, dir, rho + 0.6)) continue;
        let g = h;
        for (let s = 0.2; s < 1; s += 0.2) g = Math.max(g, stack.heightAt(P0.x + (p.x - P0.x) * s, P0.z + (p.z - P0.z) * s) ?? g);
        p.y = Math.max(P0.y + 0.9, g + 2.3);
        let along = 0;
        for (let s = 0.25; s <= 1; s += 0.25) along += badness(p.clone().lerp(P0, 1 - s), true);
        const score = along + (1 - dir.dot(toG1)) * 3;
        if (score < bs) { bs = score; escape = p.clone(); }
      }
      if (escape) break;
      yield;
    }
  }

  // The candidates.
  const from = escape ?? P0;
  const d2 = new THREE.Vector3(G1.x - from.x, 0, G1.z - from.z);
  const dl = d2.length();
  const perp = dl > 2 ? new THREE.Vector3(-d2.z / dl, 0, d2.x / dl) : R.clone();
  const base = Math.max(G1.y, P0.y);
  const A = G1.clone().addScaledVector(O, -9);
  const approach = (from.x - G1.x) * O.x + (from.z - G1.z) * O.z < -24;
  const p = new THREE.Vector3();
  const cands = [];
  for (const f of [0.45, 0.6]) for (const b of [0, -8, 8, -16, 16, -24, 24]) for (const up of [0, 4, 8, 13, 19]) {
    const W = from.clone().addScaledVector(d2, f).addScaledVector(perp, b).setY(base + up);
    // Out from under the tree almost level, then climbing away from the escape point (so turning back toward the
    // gatehouse is a wide climbing curve, never a reversal); else straight up out of the eye, leaning toward W. From
    // far off, it lines up with the gatehouse through A, 9 m short of G1, so the last turn isn't a tight one.
    const esc = escape && escape.clone().sub(P0).setY(0).normalize();
    const d0 = escape ? esc.clone().addScaledVector(UP, 0.25).normalize()
      : new THREE.Vector3(W.x - P0.x, 0, W.z - P0.z).normalize().multiplyScalar(0.5).add(UP).normalize();
    const climb = escape && W.clone().sub(escape).setY(0).normalize().multiplyScalar(0.3).add(esc).addScaledVector(UP, 0.8).normalize();
    const pts = escape ? [P0, escape, W] : [P0, W], dirs = escape ? [null, climb, null] : [null, null];
    if (approach) { pts.push(A); dirs.push(O); }
    pts.push(G1);
    const curve = hermitePath(pts, d0, O, dirs, 40);   // (coarse while choosing; the pick is made again finely)
    // (and a preference for the plainest, quickest flight: the travel's time is how long it takes at a camera's pace)
    const timing = flightTiming(curve, { vEnd: Math.min(5, Math.sqrt(curve.len * 3)) });
    let cost = Math.abs(b) * 0.01 + up * 0.01 + timing.T * 0.06 + Math.abs(f - 0.5) * 0.05;
    for (let s = 0; s <= curve.len; s += 0.5) cost += (badness(curve.at(s, p), s < 2.5) * 0.5) / 10;
    cands.push({ curve, timing, cost, f, b, up, escape: !!escape, make: () => hermitePath(pts, d0, O, dirs) });
    yield;
  }
  cands.sort((x, y) => x.cost - y.cost);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
  const a = new THREE.Vector3(), dir = new THREE.Vector3();
  function* clear({ curve }) {
    curve.at(0, a);
    for (let s = 0.25, k = 0; s <= curve.len + 0.2; s += 0.25, k++) {
      if (k % 24 === 23) yield;
      curve.at(s, p);
      dir.subVectors(p, a);
      const l = dir.length();
      if (l > 1e-4 && hits(a, dir.divideScalar(l), l)) return false;
      if (s > 1.5) for (const d of DIRS) if (hits(p, d, 0.4)) return false;
      a.copy(p);
    }
    return true;
  }
  let pick = null;
  for (const cd of cands.slice(0, 16)) { yield; if (yield* clear(cd)) { pick = cd; break; } }
  const best = pick ?? cands[0];
  best.verified = !!pick;
  // Walked evenly, it needs the fine arc-length table (the coarse one's speed ripples a little).
  yield;
  best.curve = best.make();
  best.timing = flightTiming(best.curve, { vEnd: Math.min(5, Math.sqrt(best.curve.len * 3)) });
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// The shot's fixed places, from the gatehouse's frame (in its terms: o out along the stairs, r to the right looking
// out, u up, from the sill).
function shots(frame) {
  const S = frame.sill.clone(), O = frame.out.clone().setY(0).normalize(), R = frame.side.clone().setY(0).normalize();
  const B = frame.landing.clone();
  const hTop = Math.max(3.5, frame.top.y - S.y);
  const at = (o, r, u) => S.clone().addScaledVector(O, o).addScaledVector(R, r).addScaledVector(UP, u);
  const Lh = Math.max(20, Math.hypot(B.x - S.x, B.z - S.z)), drop = S.y - B.y;
  const door = at(0, 0, 1.55);                            // the leaves' middle
  const L1 = S.clone().lerp(B, 0.62).addScaledVector(UP, -2);   // out over the gap, toward the End island
  const G1 = at(-7.5, 0, hTop + 4.5);                     // above and behind the gatehouse
  const F1 = at(11, 3, hTop + 1.6);                       // out past the facade, clear of its railing and beacon
  const G2 = at(22, 10, -3);                              // out over the gap, to the right, under the sill
  const G2b = G2.clone().addScaledVector(door.clone().sub(G2).normalize(), 1.1);   // leaning in as the doors part
  const G4 = at(0.78 * Lh, 0.75 * Lh, -0.12 * drop);      // the hold: three quarters on, from the End side
  const toS = S.clone().addScaledVector(UP, 1.5).sub(G4).normalize(), toB = B.clone().sub(G4).normalize();
  const mid = G4.clone().addScaledVector(toS.add(toB).normalize(), 40);   // halfway (in angle) from doors to landing
  return { S, O, R, B, hTop, Lh, door, L1, G1, F1, G2, G2b, G4, mid };
}

// The reveal's two set pieces as camera views { from, to } (main.js's preload can draw them, at night, to warm the
// gatehouse, the open staircase and the far End island): the doors from out over the gap, and the hold.
export function revealShots(frame) {
  const k = shots(frame);
  return { doors: { from: k.G2, to: k.door }, hold: { from: k.G4, to: k.mid } };
}

// The whole camera move, from the start view `from` ({ pos, yaw, pitch, roll, fov }) and the gatehouse's frame
// ({ sill, out, side, top, landing, n }). Returns { T (the beats' times), n, pose(t) -> { pos, yaw, pitch, roll, fov },
// extend(i) -> [t0, t1], focus(t, out), travel (the chosen flight and its cost) }. Pure: no scene changes (the Node
// tests sample it). planStairsReveal does it all at once; planStairsRevealSteps is the generator (see planFlight).
export function planStairsReveal(ctx, from, frame) {
  const g = planStairsRevealSteps(ctx, from, frame);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
export function* planStairsRevealSteps(ctx, from, frame) {
  const { S, O, R, B, hTop, door, L1, G1, F1, G2, G2b, G4, mid } = shots(frame);
  const n = Math.max(1, frame.n | 0);
  const drift = O.clone().multiplyScalar(0.32).addScaledVector(UP, 0.06);

  // The flight over the island, from the player's eye to G1 (planFlight below), then its timing: the travel takes
  // longer the longer the flight, easing out of the eye and gliding on out over the gatehouse at v1.
  const P0 = from.pos.clone();
  const travel = yield* planFlight(ctx, P0, G1, O, { S, O, R, hTop });
  const len = travel.curve.len;
  const timing = travel.timing;
  // (Long enough, too, for the view to come round from wherever the player was looking at a calm 60 deg/s at most.)
  const [yawG1, pitchG1] = lookAngles(G1, L1);
  const turn = Math.hypot(wrap(yawG1 - from.yaw), pitchG1 - from.pitch);
  const tb = BEAT, tG1 = tb + Math.max(3.2, timing.T, (1.5 * turn) / (60 * Math.PI / 180));
  const slow = timing.T / (tG1 - tb);              // (a short flight is drawn out to the shortest travel)
  const vArr = timing.vEnd * slow;                 // its speed over the gatehouse
  const tF1 = tG1 + 3.0, tG2 = tF1 + 3.0;
  const T = { beat: tb, g1: tG1, f1: tF1, g2: tG2 };
  T.unlock = tG2 - 0.9;
  T.doors = T.unlock + 0.8;
  T.ext0 = T.doors + 1.9;   // (the leaves wide enough apart for the stairs)
  T.ext1 = T.ext0 + n * STEP;
  T.g4 = T.ext1 + 0.4;
  T.fade = T.g4 + 1.6;
  T.back = T.fade + 0.7;
  T.end = T.back + 1.2;

  // From G1 on: keyed, the same for every start. (Leaving G1 level along O at vArr, as the flight arrives.)
  const tEnd = T.end + 1, dk = (tEnd - T.g4) * 0.8;
  const tailXZ = keyTrack([
    { t: tG1, v: [G1.x, G1.z], d: [O.x * vArr, O.z * vArr] },
    { t: tF1, v: [F1.x, F1.z] },
    { t: tG2, v: [G2.x, G2.z], d: [(G2b.x - G2.x) * 0.3, (G2b.z - G2.z) * 0.3] },
    { t: T.ext0, v: [G2b.x, G2b.z], d: [0, 0] },
    { t: T.g4, v: [G4.x, G4.z], d: [drift.x, drift.z] },
    { t: tEnd, v: [G4.x + drift.x * dk, G4.z + drift.z * dk] },
  ]);
  const tailY = keyTrack([
    { t: tG1, v: [G1.y], d: [0] }, { t: tF1, v: [F1.y] }, { t: tG2, v: [G2.y] }, { t: T.ext0, v: [G2b.y], d: [0] },
    { t: T.g4, v: [G4.y], d: [drift.y] }, { t: tEnd, v: [G4.y + drift.y * dk] },
  ]);

  // Where the view looks: keyed angles (yaw unwrapped key to key, so every turn goes the shorter way round).
  const q = [], w = [];
  const posAt = (s, out = new THREE.Vector3()) => {
    if (s <= tG1) return travel.curve.at(timing.at(Math.max(0, s - tb) * slow), out);
    tailXZ(s, q); tailY(s, w);
    return out.set(q[0], w[0], q[1]);
  };
  const fov0 = from.fov;
  const aKeys = [];
  const key = (s, target, fov, roll = 0, d = null) => {
    const [yaw, pitch] = lookAngles(posAt(s), target);
    aKeys.push({ t: s, v: [yaw, pitch, roll, fov], d });
  };
  aKeys.push({ t: tb, v: [from.yaw, from.pitch, from.roll ?? 0, fov0] });
  // On a long flight the view comes round to where it's going (out over the gap) by halfway, or as soon after as a
  // calm turn allows, rather than spending the whole flight turning.
  const tm = tb + Math.max(0.5 * (tG1 - tb), (1.5 * turn) / (60 * Math.PI / 180));
  if (tm < tG1 - 1.5) key(tm, L1, fov0);
  key(tG1, L1, fov0);
  // Over the facade's edge the view swings round to the cliff, then the camera backs out over the gap looking at it
  // (not out at the End island from above, then a whip round).
  key(tG1 + 0.7, L1, fov0);
  key(tF1 + 0.9, door, fov0 - 4);
  key(tG2, door, fov0 - 6);
  key(T.ext0, door, fov0 - 7);
  // Tracking down the line as it runs out: from the doors to the whole staircase (keys every 0.6 s of a smooth
  // target, so the curve follows it without overshooting).
  const lookAt = (s) => door.clone().lerp(mid, smoother(T.ext0 - 0.3, T.g4, s));
  const fovAt = (s) => fov0 - 7 + 7 * smoother(T.ext0, T.g4, s);
  for (let s = T.ext0 + 0.6; s < T.g4 - 0.3; s += 0.6) key(s, lookAt(s), fovAt(s));
  key(T.g4, mid, fov0);
  key(T.end + 1, mid, fov0);
  for (let i = 1; i < aKeys.length; i++) aKeys[i].v[0] = aKeys[i - 1].v[0] + wrap(aKeys[i].v[0] - aKeys[i - 1].v[0]);
  const ang = keyTrack(aKeys);

  // The lamps catch as the facade swings into view (its doors within 38 deg of the view's middle), the beacon a moment
  // before, so it's already turning when it's seen; both before the bolts go.
  {
    const c = new THREE.Vector3(), fwd = new THREE.Vector3(), to = new THREE.Vector3(), av = [];
    let seen = tG2;
    for (let s = tF1; s < tG2; s += 0.05) {
      posAt(s, c); ang(s, av);
      fwd.set(-Math.sin(av[0]) * Math.cos(av[1]), Math.sin(av[1]), -Math.cos(av[0]) * Math.cos(av[1]));
      if (fwd.dot(to.subVectors(door, c).normalize()) > Math.cos((38 * Math.PI) / 180)) { seen = s; break; }
    }
    T.lamps = Math.min(seen + 0.3, T.unlock - 0.3);
    T.beacon = T.lamps - 0.6;
  }

  const pose = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, fov: fov0 };
  const av = [];
  return {
    T, n, travel, frame: { S, O, R, B, hTop, G1, F1, G2, G4, door, mid },
    pose(s) {
      posAt(s, pose.pos);
      ang(s, av);
      pose.yaw = av[0]; pose.pitch = av[1]; pose.roll = av[2]; pose.fov = av[3];
      return pose;
    },
    // Section i's run out: [start, end] s.
    extend: (i) => [T.ext0 + i * STEP, T.ext0 + (i + 1) * STEP],
    // What the shot is of (for shadows, the light pool and the sound's ground): from the player's feet to the
    // gatehouse over the travel, then down the line to its middle.
    focus(s, feet, out) {
      if (s < tG1) return out.copy(feet).lerp(S, smoothstep(tb, tG1, s));
      return out.copy(S).lerp(B, 0.5 * smoother(tF1, T.g4, s));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The staircase open at once (a save being restored, or no cinematic to be had): the doors open, every section out,
// none fallen, the beacon turning and the lamps on.
export function openStairs(ctx) {
  const eg = (ctx.state.endgame ||= { open: false, descent: false });
  eg.open = true;
  const gh = ctx.gatehouse;
  if (!gh) return;
  gh.setState({ doors: 1, extended: true, fallen: false });
  gh.setBeacon?.(true);
  gh.setLamps?.(1);
}

// ctx.onRocksSolved (main.js assigns it): the reveal, or, while a save is being restored, the open staircase at once.
// A reveal that can't start yet (another sequence is running: the dream-fall) starts the first frame it can.
export function onRocksSolved(ctx) {
  const eg = (ctx.state.endgame ||= { open: false, descent: false });
  if (ctx.restoring || !ctx.gatehouse || !ctx.startSequence) { openStairs(ctx); return; }
  const replay = eg.open;   // (a dev rerun of the solve: the reveal starts from shut doors again)
  eg.open = true;           // written now: a save made during the reveal restores the staircase open
  let pending = createStairsReveal(ctx, { replay });
  if (ctx.startSequence(pending)) return;
  ctx.updaters.push(() => { if (pending && ctx.startSequence(pending)) pending = null; });
}

export function createStairsReveal(ctx, { replay = false } = {}) {
  const { player, fx, audio, camera } = ctx;
  const gh = ctx.gatehouse;
  let t = 0, plan = null, planning = null, shift = 0, keep = null, cam0 = null, back = false;
  const fired = {};
  const once = (k, at, f) => { if (!fired[k] && t >= at) { fired[k] = true; f(); } };
  const focus = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ'), tq = new THREE.Quaternion();
  const doorPos = new THREE.Vector3(), lampPos = new THREE.Vector3();
  const play = (name, opt) => audio?.play?.(name, opt);
  const lastOut = [];   // each section's last value handed to setExtended (only changes are passed on)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const start = () => {
    keep = { canMove: player.canMove, lookHandler: player.lookHandler };
    player.canMove = false;
    player.lookHandler = () => {};   // the mouse does nothing while the camera is away
    player.cameraControlled = false;
    cam0 = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    euler.setFromQuaternion(cam0.quat, 'YXZ');
    planning = planStairsRevealSteps(ctx, { pos: cam0.pos, yaw: euler.y, pitch: euler.x, roll: euler.z, fov: cam0.fov }, gh.frame);
    if (replay) { gh.setState({ doors: 0, extended: false, fallen: false }); gh.setBeacon?.(false); gh.setLamps?.(0); }
  };
  // The plan is worked out a few milliseconds a frame through the opening beat (the camera holds meanwhile); should it
  // run past the beat, everything after waits for it.
  const think = () => {
    const t0 = now();
    let r;
    do r = planning.next(); while (!r.done && now() - t0 < 3);
    if (!r.done) return;
    plan = r.value;
    planning = null;
    shift = Math.max(0, t - (BEAT - 0.25));
    const { S, hTop } = plan.frame;
    doorPos.copy(S).addScaledVector(UP, 1.6);
    lampPos.copy(S).addScaledVector(UP, hTop - 0.4);
  };
  // The view held where the player left it, trembling with the rumble.
  const tremble = (end) => (1 - smoothstep(0.2, end, t)) * smoothstep(0, 0.5, t) * 0.0016;
  const hold = () => {
    const tr = tremble(BEAT + 0.6);
    camera.position.copy(cam0.pos);
    camera.up.copy(UP);
    camera.quaternion.copy(cam0.quat).multiply(tq.setFromEuler(euler.set(tr * Math.sin(t * 31.7), tr * Math.sin(t * 23.3 + 1), 0, 'YXZ')));
  };

  return {
    done: false,
    get plan() { return plan; },   // (for the console and tests)
    update(dt) {
      if (!cam0) start();
      t += dt;
      once('rumble', 0, () => play('rumble', { duration: 3.6, peak: 0.32 }));
      if (!plan) { think(); if (!plan) { hold(); return; } }
      const T = plan.T, tp = t - shift;   // (plan time)
      const at = (k, when, f) => once(k, when + shift, f);
      at('beacon', T.beacon, () => gh.setBeacon?.(true));
      at('lamps', T.lamps, () => play('breaker', { pos: lampPos, on: true }));
      at('unlock', T.unlock, () => play('hatchUnlock', { pos: doorPos }));
      at('slide', T.doors, () => play('hatchSlide', { pos: doorPos, duration: DOOR_TIME, open: true }));

      // The lamps catch with a flicker; the doors slide and the sections run out in turn (linear here: the gatehouse
      // eases the leaves, and runs each section out fast, settling it onto its latch).
      if (tp >= T.lamps && tp < T.lamps + 0.6) gh.setLamps?.(flicker(tp - T.lamps));
      if (tp >= T.doors && tp < T.doors + DOOR_TIME + 0.1) gh.setDoors(clamp((tp - T.doors) / DOOR_TIME, 0, 1));
      for (let i = 0; i < plan.n; i++) {
        const a = T.ext0 + i * STEP;   // (plan.extend(i), without its array every frame)
        if (tp < a) break;
        if (lastOut[i] === undefined) play('stairExtend', { pos: gh.sectionEnd(i) });
        const v = clamp((tp - a) / STEP, 0, 1);
        if (lastOut[i] !== v) { lastOut[i] = v; gh.setExtended(i, v); }
      }

      if (!back) {
        const p = plan.pose(tp);
        camera.position.copy(p.pos);
        // The rumble's tremble through the beat, gone as the camera lifts away.
        const tr = tremble(T.beat + 0.6 + shift);
        camera.up.copy(UP);
        camera.quaternion.setFromEuler(euler.set(p.pitch + tr * Math.sin(t * 31.7), p.yaw + tr * Math.sin(t * 23.3 + 1), p.roll, 'YXZ'));
        if (camera.fov !== p.fov) { camera.fov = p.fov; camera.updateProjectionMatrix(); }
        ctx.viewFocus = plan.focus(tp, player.feet, focus);
      }
      fx.fade = tp < T.fade ? 0 : tp < T.back ? smoothstep(T.fade, T.back, tp) : 1 - smoothstep(T.back + 0.15, T.end, tp);
      at('back', T.back, () => {
        // In the black: everything finished as it should be, and the player's own view (and the zoom it had).
        back = true;
        gh.setDoors(1);
        for (let i = 0; i < plan.n; i++) if (lastOut[i] !== 1) { lastOut[i] = 1; gh.setExtended(i, 1); }
        gh.setLamps?.(1);
        player.cameraControlled = true;
        player.lookHandler = keep.lookHandler;
        ctx.viewFocus = null;
        camera.fov = cam0.fov;
        camera.updateProjectionMatrix();
      });
      at('control', T.back + 0.5, () => { player.canMove = keep.canMove; });
      if (tp >= T.end) { fx.fade = 0; this.done = true; }
    },
  };
}

// The flood lamps catching: a couple of stutters, then on.
const FLICK = [[0, 0], [0.05, 0.75], [0.1, 0.12], [0.2, 0.9], [0.27, 0.3], [0.4, 1]];
function flicker(s) {
  if (s >= FLICK[FLICK.length - 1][0]) return 1;
  let i = 0;
  while (s > FLICK[i + 1][0]) i++;
  const [a, va] = FLICK[i], [b, vb] = FLICK[i + 1];
  return va + (vb - va) * ((s - a) / (b - a));
}
