// Capsule routes with the real Physics, the real player controller and the real fall sequence:
//   R1  Dome ladder grab from above and from below, and the whole ledge walk to the cave plate
//   R2  the same on the Tower
//   R4  creek escape every 3 m along the Rocks creek (walk out of the water sideways)
//   R6  walk-offs: every stack rim at 72 headings, the Dome and Tower ledges, and beside both bridge ends, at
//       0.5 / 1.5 / 3.4 / 6.2 m/s; and along the wall: every rim at 42 headings (dense before the θ=0 seam),
//       walking off 55° either side of the outward normal or straight out then strafing either way, at 1.2 m/s.
//       After the controller's fall trigger (9 m of drop) createFall's kinematics run for 4.5 s. Must fall, must not land anywhere after leaving the edge (a designed ledge or the bridge
//       deck excepted), and the eye must stay >= 0.4 m outside the built cliff mesh throughout.
//   node tools/regress/routes.mjs [--walls <spec>] [--out <file>] [--only R1,R2,R4,R6] [--stacks dome,rocks] [--quiet]
// Each case records pass/fail, the reason and a trace hash (positions every 6th frame) so an unchanged
// geometry must reproduce the walk exactly.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHeadless } from './world.mjs';
import { sha, CliffSampler, TAU } from './geom.mjs';

const DT = 1 / 60;
const SPEEDS = [0.5, 1.5, 3.4, 6.2];
const ALONG_SPEED = 1.2;
export const EYE_MARGIN = 0.4;
export const EYE_BANDS = [0, 30, 80];   // eye depth bands (m below the top) for eyeBands: 0-30, 30-80, 80+
const r3 = (v) => Math.round(v * 1000) / 1000;

export async function runRoutes(W, { only = ['R1', 'R2', 'R4', 'R6'], stacks = null } = {}) {
  const { THREE, ctx, physics, rec, config } = W;
  const { MeshBVH } = await import('three-mesh-bvh');
  const { Player } = await W.imp('player/controller.js');
  const { createFall } = await W.imp('sequences/fall.js');
  const { PLAYER } = config;
  const S = ctx.stacks;
  const names = Object.keys(S);
  const samplers = Object.fromEntries(names.map((n) => [n, new CliffSampler(THREE, MeshBVH, S[n])]));
  const ledges = Object.fromEntries(rec.calls.filter((c) => c.name === 'buildLedge').map((c) => [c.stack, c.info.samples]));
  const caves = Object.fromEntries(rec.calls.filter((c) => c.name === 'buildCave').map((c) => [c.stack, c.info]));
  const nearest = (x, z) => names.reduce((b, m) => (Math.hypot(x - S[m].cx, z - S[m].cz) < Math.hypot(x - S[b].cx, z - S[b].cz) ? m : b));
  const ladderOf = (n) => physics.ladders.find((L) => nearest(L.base.x, L.base.z) === n);
  const cases = [];
  const timing = {};

  // ---- player harness
  const input = { axisV: { x: 0, y: 0, run: false }, consumeMouse: () => ({ x: 0, y: 0 }), axis() { return this.axisV; } };
  const cam = new THREE.PerspectiveCamera();
  const newPlayer = (x, y, z, yaw, pitch = 0, speed = PLAYER.walk) => {
    const p = new Player(cam, input, physics);
    p.canMove = true;
    p.speedMul = speed / PLAYER.walk;
    p.place(x, y, z, yaw);
    p.pitch = pitch;
    p.falls = 0;
    p.onFall = () => { p.falls++; };
    input.axisV = { x: 0, y: 0, run: false };
    return p;
  };
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);   // yaw whose forward is (dx, dz)
  const groundY = (st, x, z) => st.heightAt(x, z);
  const trace = () => { const t = []; return { t, add: (p, i) => { if (i % 6 === 0) t.push(r3(p.feet.x), r3(p.feet.y), r3(p.feet.z)); } }; };
  const add = (c) => cases.push(c);

  // The eye's clearance from every wall it is beside (null when above all rims).
  const eyeMargin = (x, y, z) => {
    let m = null;
    for (const n of names) {
      const st = S[n], d = Math.hypot(x - st.cx, z - st.cz);
      if (d > st.r * 2.2) continue;
      const th = Math.atan2(z - st.cz, x - st.cx);
      const R = samplers[n].radiusAt(th, y);
      if (R !== null && (m === null || d - R < m)) m = d - R;
    }
    return m;
  };
  // What caught a player who left the edge: a ledge band, the bridge deck (both designed), or a cave hood.
  const caughtBy = (n, x, y, z) => {
    const b = ctx.bridgeSpan;
    if (b) {
      const rx = x - b.a.x, rz = z - b.a.z, along = rx * b.flat.x + rz * b.flat.z, side = rx * b.side.x + rz * b.side.z;
      if (along > -0.5 && along < b.L + 0.5 && Math.abs(side) < b.width) return 'bridge deck';
    }
    const st = S[n], th = Math.atan2(z - st.cz, x - st.cx), d = Math.hypot(x - st.cx, z - st.cz);
    for (const s of ledges[n] ?? []) {
      const dth = Math.abs(Math.atan2(Math.sin(th - s.theta), Math.cos(th - s.theta)));
      const R = st.cliffRadius(s.theta, s.depth, st.edgeR(s.theta)) - 0.1;
      if (dth < 0.05 && d > R - 0.5 && d < R + s.width + 0.5 && Math.abs(y - (st.top - s.depth)) < 1.5) return 'ledge';
    }
    const c = caves[n];
    if (c && Math.hypot(x - c.mouth[0], z - c.mouth[2]) < 8 && y > c.mouth[1] - 1) return 'cave hood';
    return null;
  };

  // Walks `p` under `steer` (return false to stop) for up to `secs`, or until the fall triggers; returns the time.
  const walk = (p, secs, steer, tr) => {
    let i = 0;
    for (; i < secs / DT; i++) {
      if (steer(p, i) === false) break;
      p.update(DT);
      tr?.add(p, i);
      if (p.falls) break;
    }
    return i * DT;
  };

  // ---------------------------------------------------------------- R1 / R2: ladders and ledge walks
  const ladderCases = (n, id) => {
    const L = ladderOf(n), st = S[n];
    if (!L) { add({ id: `${id}:ladder`, group: id, pass: false, reason: 'no ladder recorded' }); return; }
    const out = L.n, lipY = L.base.y + L.height;
    // From above: stand on the cap behind the lip, face out, look down, press forward.
    {
      const tr = trace();
      const x = L.base.x - out.x * 1.6, z = L.base.z - out.z * 1.6;
      const p = newPlayer(x, groundY(st, x, z) + 0.05, z, yawTo(out.x, out.z), -0.5);
      let attached = false, bottom = false;
      walk(p, 12, (pp) => {
        input.axisV = { x: 0, y: 1, run: false };
        if (pp.mode === 'ladder') attached = true;
        if (attached && pp.mode === 'walk') { bottom = true; return false; }
      }, tr);
      input.axisV = { x: 0, y: 0, run: false };
      walk(p, 1.5, () => true, tr);
      const onLedge = Math.abs(p.feet.y - L.base.y) < 0.4 && p.onGround && !p.falls;
      add({ id: `${id}:ladder-from-above`, group: id, pass: attached && bottom && onLedge, reason: !attached ? 'never attached from above' : !bottom ? 'did not reach the bottom' : !onLedge ? `not standing on the ledge (feet y ${p.feet.y.toFixed(2)}, ledge ${L.base.y.toFixed(2)})` : 'ok', end: [r3(p.feet.x), r3(p.feet.y), r3(p.feet.z)], trace: sha(tr.t) });
    }
    // From below: stand on the ledge facing the wall, press forward, climb out at the top.
    {
      const tr = trace();
      const p = newPlayer(L.base.x + out.x * 0.9, L.base.y + 0.05, L.base.z + out.z * 0.9, yawTo(-out.x, -out.z), 0);
      input.axisV = { x: 0, y: 0, run: false };
      walk(p, 0.5, () => true, tr);
      let attached = false, top = false;
      walk(p, 12, (pp) => {
        input.axisV = { x: 0, y: 1, run: false };
        if (pp.mode === 'ladder') attached = true;
        if (attached && pp.mode === 'walk') { top = true; return false; }
      }, tr);
      input.axisV = { x: 0, y: 0, run: false };
      walk(p, 1.5, () => true, tr);
      const h = groundY(st, p.feet.x, p.feet.z);
      const onCap = h !== null && Math.abs(p.feet.y - h) < 0.3 && p.onGround && !p.falls;
      add({ id: `${id}:ladder-from-below`, group: id, pass: attached && top && onCap, reason: !attached ? 'never attached from below' : !top ? 'did not reach the top' : !onCap ? `not standing on the cap (feet y ${p.feet.y.toFixed(2)}, ground ${h?.toFixed(2)}, lip ${lipY.toFixed(2)})` : 'ok', end: [r3(p.feet.x), r3(p.feet.y), r3(p.feet.z)], trace: sha(tr.t) });
    }
    // Ledge walk: from the ladder foot along the ledge's middle to the cave's elevator plate.
    {
      const samples = ledges[n], cave = caves[n];
      if (!samples || !cave) { add({ id: `${id}:ledge-walk`, group: id, pass: false, reason: 'no ledge or cave recorded' }); return; }
      const th0 = Math.atan2(out.z, out.x);
      const wrapD = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      // Samples ordered from the ladder toward the cave.
      let path2 = samples.slice();
      if (Math.abs(wrapD(path2[0].theta - th0)) > Math.abs(wrapD(path2[path2.length - 1].theta - th0))) path2.reverse();
      const dir = Math.sign(wrapD(path2[1].theta - path2[0].theta));
      path2 = path2.slice(path2.findIndex((s) => wrapD(s.theta - th0) * dir > 0));
      const pts = path2.map((s) => {
        const R = st.cliffRadius(s.theta, s.depth, st.edgeR(s.theta)) - 0.1 + Math.min(s.width * 0.5, 1.6);
        return { x: st.cx + Math.cos(s.theta) * R, z: st.cz + Math.sin(s.theta) * R, y: st.top - s.depth };
      });
      const m = cave.mouth, d = cave.dir, pl = cave.platePos;
      pts.push({ x: m[0], z: m[2], y: m[1] }, { x: m[0] + d[0] * cave.length * 0.5, z: m[2] + d[2] * cave.length * 0.5, y: m[1] });
      const plate = { x: pl[0] - d[0] * 0.9, z: pl[2] - d[2] * 0.9, y: pl[1] };
      pts.push(plate);
      const tr = trace();
      const p = newPlayer(L.base.x + out.x * 0.9, L.base.y + 0.05, L.base.z + out.z * 0.9, 0, 0);
      let k = 0, minDy = Infinity, maxDy = -Infinity, reached = false;
      const t = walk(p, 90, (pp) => {
        while (k < pts.length - 1 && Math.hypot(pts[k].x - pp.feet.x, pts[k].z - pp.feet.z) < 1.0) k++;
        const q = pts[k];
        const dy = pp.feet.y - q.y;
        minDy = Math.min(minDy, dy); maxDy = Math.max(maxDy, dy);
        if (k === pts.length - 1 && Math.hypot(q.x - pp.feet.x, q.z - pp.feet.z) < 0.6) { reached = true; return false; }
        pp.yaw = yawTo(q.x - pp.feet.x, q.z - pp.feet.z);
        input.axisV = { x: 0, y: 1, run: false };
      }, tr);
      const ok = reached && !p.falls && minDy > -1.5;
      add({ id: `${id}:ledge-walk`, group: id, pass: ok, reason: ok ? 'ok' : p.falls ? `fell off at waypoint ${k}/${pts.length}` : !reached ? `stuck before waypoint ${k}/${pts.length} at ${[p.feet.x, p.feet.y, p.feet.z].map((v) => v.toFixed(1))}` : `dropped ${minDy.toFixed(2)} m below the ledge`, seconds: r3(t), dy: [r3(minDy), r3(maxDy)], trace: sha(tr.t) });
    }
  };

  // ---------------------------------------------------------------- R4: creek escape
  const creek = () => {
    const st = S.rocks, stream = ctx.streamPath, q = {};
    for (let t = 3; t < stream.total - 3; t += 3) {
      const c = stream.pointAt(t), len = Math.hypot(c.dx, c.dz) || 1;
      const sides = [];
      const tr = trace();
      for (const s of [-1, 1]) {
        const nx = -c.dz / len * s, nz = c.dx / len * s;
        const p = newPlayer(c.x, (groundY(st, c.x, c.z) ?? st.top) + 0.05, c.z, yawTo(nx, nz), 0);
        walk(p, 0.3, () => true);
        // Out of the carved bed (it reaches 3.3 m from the centreline) within 4 s.
        walk(p, 4, (pp) => { input.axisV = { x: 0, y: 1, run: false }; return stream.closest(pp.feet.x, pp.feet.z, q).d < 4; }, tr);
        input.axisV = { x: 0, y: 0, run: false };
        stream.closest(p.feet.x, p.feet.z, q);
        sides.push({ side: s, out: q.d >= 3.5 && !p.falls, d: r3(q.d), fell: p.falls > 0 });
      }
      const ok = sides.some((x) => x.out);
      add({ id: `R4:t${t}`, group: 'R4', pass: ok, reason: ok ? (sides.every((x) => x.out) ? 'ok' : `one side only (${sides.filter((x) => !x.out).map((x) => `side ${x.side} reached ${x.d} m${x.fell ? ', fell' : ''}`).join('; ')})`) : `trapped: ${sides.map((x) => `side ${x.side} ${x.d} m${x.fell ? ' fell' : ''}`).join(', ')}`, sides, trace: sha(tr.t) });
    }
  };

  // ---------------------------------------------------------------- R6: walk-offs
  const fx = {}, audio = { loop: () => null };
  // `strafe` (-1 left, 1 right): strafe instead of walking on once a metre past the rim, so the fall runs along the
  // wall without the capsule sliding down its face first (that slide is the controller's, and R6 has it already).
  const walkOff = (id, n, start, dir, speed, strafe = 0) => {
    const st = S[n];
    const tr = trace();
    Object.assign(fx, { fade: 0, blur: 0, vignette: 0 });
    const y0 = groundY(st, start.x, start.z) ?? start.y;
    const p = newPlayer(start.x, (start.y ?? y0) + 0.05, start.z, yawTo(dir.x, dir.z), 0, speed);
    walk(p, 0.25, () => true);    // settle
    let left = false, clear = false, landed = null, worst = Infinity, worstAt = null, visible = Infinity, breach = null;
    // `visible`: the closest the eye gets while the fall's fade to black is still under half; `bands` is the same
    // per eye depth band, so a new near-rim bulge shows even when a deep flare sets the overall minimum.
    const bands = EYE_BANDS.map(() => Infinity);
    const eye = (pp, phase, t) => {
      const m = eyeMargin(pp.feet.x, pp.feet.y + PLAYER.eye, pp.feet.z);
      if (m === null) return;
      const depth = st.top - pp.feet.y - PLAYER.eye;
      const at = () => ({ phase, t: r3(t), fade: r3(fx.fade ?? 0), depth: r3(depth) });
      if (phase === 'walk' || fx.fade < 0.5) {
        visible = Math.min(visible, m);
        const k = EYE_BANDS.findLastIndex((d) => depth >= d);
        bands[Math.max(0, k)] = Math.min(bands[Math.max(0, k)], m);
      }
      if (m < EYE_MARGIN && !breach) breach = at();
      if (m < worst) { worst = m; worstAt = at(); }
    };
    const timeout = 1.5 / speed + 8;
    let t = 0;
    for (let i = 0; i < timeout / DT && !p.falls; i++, t += DT) {
      input.axisV = clear ? { x: strafe, y: 0, run: false } : { x: 0, y: 1, run: false };
      p.update(DT);
      tr.add(p, i);
      const th = Math.atan2(p.feet.z - st.cz, p.feet.x - st.cx);
      if (!left && Math.hypot(p.feet.x - st.cx, p.feet.z - st.cz) > samplers[n].rim(th).r + PLAYER.radius + 0.05) left = true;
      if (strafe && Math.hypot(p.feet.x - st.cx, p.feet.z - st.cz) > samplers[n].rim(th).r + PLAYER.radius + 1) clear = true;
      if (left && p.onGround && !landed) landed = { at: [p.feet.x, p.feet.y, p.feet.z], by: caughtBy(n, p.feet.x, p.feet.y, p.feet.z) };
      if (landed) break;
      eye(p, 'walk', t);
    }
    input.axisV = { x: 0, y: 0, run: false };
    let fellFor = 0;
    if (p.falls && !landed) {
      const seq = createFall({ player: p, fx, audio, stacks: S });
      for (let i = 0; p.mode === 'falling'; i++) {
        eye(p, 'fall', fellFor);
        seq.update(DT);
        fellFor += DT;
        if (p.mode === 'falling') tr.add(p, i);
      }
    }
    let outcome, pass;
    if (landed) { outcome = landed.by ? `caught by ${landed.by}` : `landed after leaving the edge at depth ${(st.top - landed.at[1]).toFixed(1)} m`; pass = landed.by === 'ledge' || landed.by === 'bridge deck'; }
    else if (!left) { outcome = `never left the edge (stopped at ${[p.feet.x, p.feet.y, p.feet.z].map((v) => v.toFixed(1))})`; pass = false; }
    else if (!p.falls) { outcome = 'left the edge but the fall never triggered'; pass = false; }
    else if (breach) { outcome = `eye within ${EYE_MARGIN} m of the wall from ${breach.depth} m down (${breach.phase} t=${breach.t}s, fade ${breach.fade}); worst ${worst.toFixed(2)} m at ${worstAt.depth} m down`; pass = false; }
    else { outcome = 'fell'; pass = true; }
    const fin = (v) => (v === Infinity ? null : r3(v));
    add({ id, group: 'R6', stack: n, speed, pass, reason: outcome, landedAt: landed?.at.map(r3) ?? null, landedBy: landed?.by ?? null, eyeMin: fin(worst), eyeMinVisible: fin(visible), eyeBands: bands.map(fin), breach, worstAt, trace: sha(tr.t) });
  };

  const rims = () => {
    for (const n of names) {
      if (stacks && !stacks.includes(n)) continue;
      const st = S[n];
      for (let k = 0; k < 72; k++) {
        const th = (k / 72) * TAU, c = Math.cos(th), s = Math.sin(th), r = st.edgeR(th) - 1.5;
        for (const v of SPEEDS) walkOff(`R6:${n}:rim:${k * 5}deg:${v}`, n, { x: st.cx + c * r, z: st.cz + s * r }, { x: c, z: s }, v);
      }
    }
  };
  // Falls that run along the wall and pass its columns: the drift must see a column that steps out ahead or
  // beside the path (with flags off the θ=0 seam steps 12-17 m out in one column on End and Mountain).
  const alongOffs = () => {
    const degs = [...Array(36).keys()].map((k) => k * 10 + 2.5).concat([340, 345, 347.5, 350, 355, 357.5]);
    for (const n of names) {
      if (stacks && !stacks.includes(n)) continue;
      const st = S[n];
      for (const deg of degs) {
        const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), r = st.edgeR(th) - 1.5;
        const start = { x: st.cx + c * r, z: st.cz + s * r };
        for (const off of [-55, 55]) {
          const h = th + off * Math.PI / 180;
          walkOff(`R6:${n}:oblique:${deg}deg:${off}`, n, start, { x: Math.cos(h), z: Math.sin(h) }, ALONG_SPEED);
        }
        for (const sd of [-1, 1]) walkOff(`R6:${n}:strafe:${deg}deg:${sd > 0 ? 'right' : 'left'}`, n, start, { x: c, z: s }, ALONG_SPEED, sd);
      }
    }
  };
  const ledgeOffs = () => {
    for (const n of ['dome', 'tower']) {
      if (stacks && !stacks.includes(n)) continue;
      const st = S[n], L = ledges[n];
      L.forEach((s, i) => {
        if (i % 5 !== 0 && i !== L.length - 1) return;
        const R = st.cliffRadius(s.theta, s.depth, st.edgeR(s.theta)) - 0.1 + s.width * 0.5, c = Math.cos(s.theta), sn = Math.sin(s.theta);
        for (const v of SPEEDS) walkOff(`R6:${n}:ledge:${i}:${v}`, n, { x: st.cx + c * R, y: st.top - s.depth, z: st.cz + sn * R }, { x: c, z: sn }, v);
      });
    }
  };
  const bridgeOffs = () => {
    if (stacks && !stacks.includes('rocks') && !stacks.includes('end')) return;
    const b = rec.calls.find((c) => c.name === 'buildBridge')?.info;
    if (!b) { add({ id: 'R6:bridge', group: 'R6', pass: false, reason: 'no bridge recorded' }); return; }
    const A = new THREE.Vector3(...b.a), B = new THREE.Vector3(...b.b);
    const flat = B.clone().sub(A).setY(0).normalize(), side = new THREE.Vector3(-flat.z, 0, flat.x);
    // Beside each end of the deck, past the posts, heading into the gap along the bridge.
    for (const [n, end, sgn] of [['rocks', A, 1], ['end', B, -1]]) {
      for (const sd of [-1, 1]) {
        const p = end.clone().addScaledVector(side, sd * (b.width / 2 + 0.7)).addScaledVector(flat, -sgn * 1.0);
        for (const v of SPEEDS) walkOff(`R6:bridge:${n}:${sd > 0 ? 'left' : 'right'}:${v}`, n, { x: p.x, z: p.z }, { x: flat.x * sgn, z: flat.z * sgn }, v);
      }
    }
  };

  const time = (k, fn) => { const t0 = performance.now(); fn(); timing[k] = (timing[k] || 0) + (performance.now() - t0) / 1000; };
  if (only.includes('R1')) time('R1', () => ladderCases('dome', 'R1'));
  if (only.includes('R2')) time('R2', () => ladderCases('tower', 'R2'));
  if (only.includes('R4')) time('R4', creek);
  if (only.includes('R6')) { time('R6 rims', rims); time('R6 along', alongOffs); time('R6 ledges', ledgeOffs); time('R6 bridge', bridgeOffs); }
  return { kind: 'routes', version: 2, walls: { ...config.WALLS }, cases, timing };
}

// Failing cases grouped by stack/kind and outcome (numbers blanked), for the console.
export function summarize(data) {
  const groups = new Map();
  let pass = 0;
  for (const c of data.cases) {
    if (c.pass) { pass++; continue; }
    const where = c.id.split(':').slice(0, 3).join(':').replace(/:\d+deg$/, ':rim');
    const k = `${where} | ${c.reason.replace(/\(.*\)/, '').replace(/-?\d+(\.\d+)?/g, '#').trim()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = [`${data.cases.length} cases, ${pass} pass, ${data.cases.length - pass} fail`];
  for (const [k, L] of groups) {
    const eyes = L.map((c) => c.eyeMinVisible).filter((v) => v !== null && v !== undefined);
    const vis = eyes.filter((v) => v < EYE_MARGIN).length;
    out.push(`  ${String(L.length).padStart(4)} x ${k}${eyes.length ? ` (${vis} of them while the screen is still visible)` : ''}; e.g. ${L[0].id}: ${L[0].reason}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const t0 = performance.now();
  const W = await buildHeadless({ walls: arg('--walls') });
  const R = await runRoutes(W, { only: arg('--only')?.split(',') ?? undefined, stacks: arg('--stacks')?.split(',') ?? null });
  const { timing, ...data } = R;
  const file = arg('--out');
  if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n'); }
  else process.stdout.write(JSON.stringify(data, null, 1) + '\n');
  if (!process.argv.includes('--quiet')) console.error(summarize(data));
  console.error(`routes: walls=${JSON.stringify(arg('--walls') ?? null)} build ${(W.buildMs / 1000).toFixed(1)} s, ${Object.entries(timing).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(', ')}, total ${((performance.now() - t0) / 1000).toFixed(1)} s${file ? ' -> ' + file : ''}`);
}
