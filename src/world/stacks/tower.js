import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS } from '../../config.js';
import { Rng, smoothstep, noise2 } from '../../core/rng.js';
import { Stack } from '../terrain.js';
import { Batcher, ColliderBuilder } from '../builders.js';
import { Path } from '../paths.js';
import { buildLadder, buildTrail, scatter } from '../features.js';
import { buildCliffPath } from '../cliffPath.js';
import { buildCliffCave, caveWindow } from '../cliffCave.js';
import { Forest } from '../trees.js';
import { buildPowerTower } from '../../props/powertower.js';
import { createElevator } from '../../props/elevator.js';
import { addCaveBulb } from './dome.js';
import { buildBunker, bunkerFrame } from '../bunker.js';

// Tall-grass clumps sown over the cap (see tall() below for where they thin out).
const TALL_GRASS = 12000;

export function buildTower(ctx) {
  const cfg = STACKS.tower;
  const cx = cfg.x, cz = cfg.z;
  // Cave faces the Dome. As on the Dome (stacks/dome.js): a ladder down from the lip to a ledge path in the cliff, which
  // turns into an arched mouth cut into the stack (world/cliffCave.js), the tunnel bending in to the elevator. Here it's
  // short: a landing at the ladder's foot, one flight of rough stone steps down, and a level stretch to the mouth.
  const thC = Math.atan2(0 - cz, 0 - cx);
  const thL = thC + 0.22;
  const LEDGE_START = 6.1;      // the ladder's foot, 20 ft below the lip (as the Dome's)
  const LEDGE_END = 9.3;        // the cave's floor (its 3.35 m arch needs the window's rows opened from row 3, below)
  const stack = new Stack(cfg, {
    cliffCalm: (th, depth) => {
      const d = Math.abs(Math.atan2(Math.sin(th - thC - 0.1), Math.cos(th - thC - 0.1)));
      return d < 0.45 && depth < 22 ? 0.2 : 1;
    },
    // The wall relief (WALLS.geo) keeps off the cave, the ledge and the ladder: exactly 0 down to 22 m.
    protect: [{ from: thC - 0.35, to: thL + 0.4, depth: 22, feather: 12 }],
    // The cave's mouth: a window cut out of the cliff, filled by buildCliffCave below. The rim here is low (about 6.3 m
    // under the cap's top), which takes the wall's rows down with it: row 4 is 6.3 m below the top, under the arch's top,
    // so the window opens from row 3 (4.4 m below the top, 1.3 m above the arch).
    openings: [caveWindow(Math.round(cfg.r * 2.6), thC, 3, [3, 8])],
  });
  // The bunker in the east stand (world/bunker.js): its stairwell's hole in the ground, cut as the cap is built.
  const bunkerF = bunkerFrame(stack);
  stack.capHoles.push(bunkerF.hole);
  const nL = new THREE.Vector3(Math.cos(thL), 0, Math.sin(thL));
  const ladderEdge = stack.edgeR(thL);
  const towerBase = new THREE.Vector3(cx - 2, 0, cz + 1);
  const path = Path.smooth([
    [cx + nL.x * (ladderEdge - 1.3), cz + nL.z * (ladderEdge - 1.3)],
    [cx + nL.x * 30 + 4, cz + nL.z * 30 - 3],
    [cx + nL.x * 16 - 3, cz + nL.z * 16 + 2],
    [towerBase.x + nL.x * 7, towerBase.z + nL.z * 7],
  ], 1.2, 1.3);
  const q = {};
  stack.shapeFns.push((x, z, h, c) => {
    // Flat apron under the tower.
    const d = Math.hypot(x - towerBase.x, z - towerBase.z);
    h = THREE.MathUtils.lerp(h, cfg.top + 0.3, 1 - smoothstep(8, 14, d));
    if (Math.hypot(x - (cx + nL.x * ladderEdge), z - (cz + nL.z * ladderEdge)) < 4) h = Math.max(h, cfg.top - 0.9 - (1 - smoothstep(0, 4, c.inside)) * 0.3);
    return h;
  });
  stack.colorFns.push((x, z, h, col) => {
    path.closest(x, z, q);
    if (q.d < 2.2) col.lerp(new THREE.Color(0.17, 0.13, 0.09), (1 - smoothstep(0.6, 2.2, q.d)) * 0.8);
    const d = Math.hypot(x - towerBase.x, z - towerBase.z);
    if (d < 9) col.lerp(new THREE.Color(0.14, 0.12, 0.09), (1 - smoothstep(5, 9, d)) * 0.6);
  });

  const collider = new ColliderBuilder('tower');
  const batcher = new Batcher();
  stack.build(collider);
  buildTrail(stack, path, batcher, { width: 1.2 });

  // (Where the old cave's hood stood, out on the ledge: the trees still keep 10 m off it, so none of them move.)
  const hoodR = stack.cliffRadius(thC, 3.3, stack.edgeR(thC)) + 2.1;
  const mouth = new THREE.Vector3(cx + Math.cos(thC) * hoodR, cfg.top - 3.3, cz + Math.sin(thC) * hoodR);

  // ---- Ladder + ledge path to the cave: from the ladder (thL) back toward thC, running 3 m past the mouth ----
  const Rm = stack.edgeR(thC);
  const th0 = thL + 0.04, th1 = thC - 3.1 / Rm;
  const LANDING = 1.8, STEPS = 18, RUN = 0.3;               // m of landing past the ladder; the flight: treads, going
  const sLand = (th0 - thL) * Rm + LANDING, sStairs = sLand + STEPS * RUN;   // arc length (m) where the flight starts, ends
  const span = th0 - th1, total = span * Rm, toMouth = (th0 - thC) * Rm;
  const depthAt = (sm) => LEDGE_START + (LEDGE_END - LEDGE_START) * THREE.MathUtils.clamp((sm - sLand) / (sStairs - sLand), 0, 1);
  const samples = [];
  const cuts = [0, sLand, sStairs, total];                   // the depth's corners must be samples
  for (let sm = 0; sm < total; sm += 0.8) cuts.push(sm);
  for (const sm of [...new Set(cuts.map((v) => +v.toFixed(3)))].sort((a, b) => a - b)) {
    const width = 2.6 + (1 - smoothstep(0, sLand + 0.6, sm)) * 1.1 + smoothstep(toMouth - 4, toMouth - 1, sm) * 0.8 + noise2(sm * 0.3, 0, 9) * 0.2;
    samples.push({ theta: th0 - sm / Rm, depth: depthAt(sm), width });
  }
  buildCliffPath(stack, samples, batcher, collider, { seed: 13, stairs: { from: th0 - sLand / Rm, to: th0 - sStairs / Rm, n: STEPS } });
  const wallR = stack.cliffRadius(thL, 3, stack.edgeR(thL));
  const lipY = stack.heightAt(cx + nL.x * (ladderEdge - 0.8), cz + nL.z * (ladderEdge - 0.8));
  const base = new THREE.Vector3(cx + nL.x * (wallR + 0.05), cfg.top - LEDGE_START, cz + nL.z * (wallR + 0.05));
  buildLadder(ctx, { base, n: nL, height: lipY - base.y, batcher });

  // ---- The cave: a mouth in the cliff at the path's end, the tunnel bending in from the path to the elevator ----
  const cave = buildCliffCave(ctx, stack, {
    theta: thC, floorY: cfg.top - LEDGE_END - 0.02, window: stack.openings[0], travel: -1, batcher, collider, seed: 31,
  });
  addCaveBulb(ctx, cave.platePos, cave.plateRot, batcher);
  // After the cliff ladder, so that one stays the Tower's first entry in physics.ladders (tools/regress looks it up that way).
  towerBase.y = stack.heightAt(towerBase.x, towerBase.z);
  buildPowerTower(ctx, { base: towerBase, rotY: thC + Math.PI / 2, batcher, collider });

  // ---- Vegetation ----
  const rng = new Rng(cfg.seed);
  const ladderTop = { x: cx + nL.x * ladderEdge, z: cz + nL.z * ladderEdge };
  const trees = [];
  const nearTree = (x, z, r) => trees.some((t) => Math.hypot(x - t.x, z - t.z) < r);
  const clear = (x, z) => {
    path.closest(x, z, q);
    return q.d > 2.4 && Math.hypot(x - towerBase.x, z - towerBase.z) > 11 && !nearTree(x, z, 1.4);
  };
  // Trunks stay a comfortable walk off the trail, crowns off the pylon's legs, the rim, the ladder top and the cave
  // hood under the rim (whose top reaches up past the cap).
  const treeOk = (x, z, s) => {
    path.closest(x, z, q);
    if (q.d < 3.4 || stack.edgeDist(x, z) < 5.5) return false;
    if (Math.hypot(x - towerBase.x, z - towerBase.z) < 14) return false;
    if (Math.hypot(x - ladderTop.x, z - ladderTop.z) < 8 || Math.hypot(x - mouth.x, z - mouth.z) < 10) return false;
    return trees.every((t) => Math.hypot(x - t.x, z - t.z) > 1.5 * (s + t.s));
  };
  // Trunks get a collider of their own: added to the stack's they would reshuffle its BVH, and the order it visits
  // the wall's triangles decides some slow rim walk-offs (tools/regress R6).
  const trunks = new ColliderBuilder('tower-trees');
  ctx.deferCollider(trunks, 'surface');
  const plant = (sp, x, z, s) => {
    const y = stack.heightAt(x, z);
    if (y === null) return;
    trees.push({ x, z, s });
    ctx.forest.add(sp, x, y, z, s);
    trunks.addCylinder(x, y - 0.5, z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
  };
  // Windswept groves: mostly pine (the odd one broadleaf-led), biggest in the middle and stunted towards the edges.
  const groves = [];
  scatter(stack, 5, rng, (x, z) => {
    if (!treeOk(x, z, 1) || groves.some((g) => Math.hypot(x - g.x, z - g.z) < 17)) return false;
    groves.push({ x, z });
    return true;
  }, { margin: 9, tries: 80 });
  for (const g of groves) {
    const n = rng.int(3, 5), broad = rng.next() < 0.35 ? 0.6 : 0.15;
    for (let i = 0, k = 0; i < n * 12 && k < n; i++) {
      const a = rng.float(0, Math.PI * 2), d = k ? rng.float(2.2, 6.5) : rng.float(0, 1.5);
      const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
      const s = rng.float(0.8, 1.2) * (1 - (d / 6.5) * 0.25);
      if (!treeOk(x, z, s)) continue;
      plant(rng.next() < broad ? 'broadleaf' : 'pine', x, z, s);
      k++;
    }
  }
  // A few loners out in the open.
  for (const p of scatter(stack, 3, rng, (x, z) => treeOk(x, z, 1) && !nearTree(x, z, 12), { margin: 5.5 })) plant('pine', p.x, p.z, rng.float(0.7, 1.05));
  const shrubs = scatter(stack, 12, rng, clear, { margin: 2 });
  for (const p of shrubs) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.6, 1.1));
  for (const p of scatter(stack, 5000, rng, (x, z) => { path.closest(x, z, q); return q.d > 1.0; }, { margin: 1.2, tries: 3 })) ctx.meadow.add(p.x, p.y, p.z, rng.float(0.8, 1.35));
  const stones0 = ctx.pebbles.items.map((l) => l.length);
  ctx.pebbles.scatter(stack, 40, rng, clear);
  const stand = eastStand(ctx, stack, { path, towerBase, ladderTop, mouth, trees, trunks, blockers: [...shrubs, ...ctx.pebbles.items.flatMap((l, g) => l.slice(stones0[g]))] });
  const nearStand = (x, z, r) => stand.some((t) => Math.hypot(x - t.x, z - t.z) < r);
  // Tall grass over most of the cap: bare on the trail and short along its edges, thinning onto the pylon's apron,
  // the ladder top and the windy rim, in drifts of greener and riper stands. Its own stream, so it can be retuned alone.
  const grng = new Rng(cfg.seed * 13);
  const tall = (x, z) => {
    path.closest(x, z, q);
    let f = smoothstep(1.2, 3.8, q.d);
    f *= smoothstep(10.5, 14, Math.hypot(x - towerBase.x, z - towerBase.z));   // footings reach out 10.3 m
    f *= smoothstep(1.0, 4.5, stack.edgeDist(x, z));
    f *= smoothstep(2.5, 5.5, Math.hypot(x - ladderTop.x, z - ladderTop.z));
    if (nearTree(x, z, 0.7)) return 0;
    return f * (0.6 + 0.4 * smoothstep(-0.4, 0.4, noise2(x * 0.07, z * 0.07, 7)));
  };
  for (const p of scatter(stack, TALL_GRASS, grng, (x, z) => grng.next() < tall(x, z), { margin: 0.8, tries: 4 })) {
    const f = tall(p.x, p.z);
    const gold = Math.min(1, Math.max(0, 0.5 + noise2(p.x * 0.05, p.z * 0.05, 19) * 0.7 + grng.float(-0.2, 0.2)));
    // Off the east stand's trunks as off the groves' (dropped after the draws, so no other clump moves).
    ctx.tallGrass.add(p.x, p.y, p.z, grng.float(0.6, 1.1) * (0.7 + 0.3 * f), gold, !nearStand(p.x, p.z, 0.7));
  }

  // The bunker, after everything placed on the cap has drawn from its streams (it takes nothing from them), and the
  // lounge's secret elevator up into it.
  const bunker = buildBunker(ctx, stack, { batcher, collider, frame: bunkerF });
  if (bunker) {
    ctx.bunker = bunker;
    const secret = ctx.tunnels?.lounge?.secret;
    if (secret?.station) {
      const el = createElevator(ctx, { id: 'study', ends: { top: bunker.station, bottom: secret.station } });
      el.at = 'bottom';   // it waits at the lounge's passage
      secret.elevator = el;
    }
  }

  const props = batcher.build(stack.group, { name: 'tower-props' });
  // From other stacks the props are one merged stand-in (see render/lod.js).
  ctx.lod.addFarProxy(props.filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'tower-props' });
  ctx.surface.add(stack.group);
  ctx.physics.addCollider(collider.build(), 'surface');

  createElevator(ctx, {
    id: 'tower',
    ends: {
      top: { pos: cave.platePos, rotY: cave.plateRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('tower-car') },
      bottom: ctx.tunnelStation('tower'),
      // Press Down again at the cave station: the lounge below it.
      ...(ctx.tunnels.stations.lounge ? { lounge: ctx.tunnelStation('lounge') } : {}),
    },
  });
  ctx.stacks.tower = stack;
  return stack;
}

// ---- The east stand ----
// The groves leave the east side of the cap open, between the pylon's apron and the rim. A stand fills it: knots of
// pines (broadleaf-led in patches) that run into one another, tallest in its heart and smaller towards its edges and
// the windy rim, with glades between them, saplings in the gaps and shrubs along its fringe.
const STAND_CLUMPS = 13, STAND_SAPLINGS = 8, STAND_SHRUBS = 14;
// Where it grows, by heading from the stack's centre (radians, 0 = +x): full within STAND_FULL of STAND_AT, none past STAND_EDGE.
const STAND_AT = 0.12, STAND_FULL = 0.66, STAND_EDGE = 1.1;
// An opening at its edge on the rim, east of the pylon, to look into it from (stack-local; crowns keep out of it too).
const LOOKOUT = { x: 41.6, z: 10.4, r: 3.5 };

// Placed after everything else on the stack has drawn from its stream, on a stream of its own and with its own
// rotations and tints (Forest.add), so no other tree, shrub, tuft or stone on any stack moves. Trunks keep the
// groves' rules (trail, ladder top, cave mouth, 1.5 (s + s') apart) and stay 1.4 m off the shrubs and stones already
// down; crowns keep 1.5 m inside the rim and 0.5 m off the pylon's footings. Returns the trunks ({ x, z, s }).
function eastStand(ctx, stack, { path, towerBase, ladderTop, mouth, trees, trunks, blockers }) {
  const cx = stack.cx, cz = stack.cz;
  const rng = new Rng(stack.cfg.seed * 29);
  const reach = {};   // the crown's widest reach at scale 1
  for (const sp of ['pine', 'broadleaf']) reach[sp] = Math.max(...ctx.forest.footprint(sp).map((b) => b.r));
  const q = {}, stand = [];
  const lookout = (x, z) => Math.hypot(x - cx - LOOKOUT.x, z - cz - LOOKOUT.z);
  const off = (x, z) => Math.abs(Math.atan2(z - cz, x - cx) - STAND_AT);
  // Where it grows, broken by glades and thinning out towards the rim.
  const weight = (x, z) => (1 - smoothstep(STAND_FULL, STAND_EDGE, off(x, z))) * smoothstep(-0.3, 0.15, noise2(x * 0.085, z * 0.085, 41))
    * (0.3 + 0.7 * smoothstep(5.5, 11, stack.edgeDist(x, z)));
  // Its heart: midway between the apron and the rim, in the middle of the sector.
  const heart = (x, z) => (1 - smoothstep(0.2, STAND_EDGE, off(x, z))) * (1 - smoothstep(4, 16, Math.abs(Math.hypot(x - cx, z - cz) - 29)));
  // Stunted by the wind near the rim.
  const wind = (x, z) => 0.75 + 0.25 * smoothstep(5.5, 13, stack.edgeDist(x, z));
  const spaced = (x, z, s) => trees.every((t) => Math.hypot(x - t.x, z - t.z) > 1.5 * (s + t.s)) && stand.every((t) => Math.hypot(x - t.x, z - t.z) > 1.5 * (s + t.s));
  const ok = (sp, x, z, s) => {
    const R = reach[sp] * s;
    path.closest(x, z, q);
    if (q.d < 3.4 || stack.edgeDist(x, z) < Math.max(5.5, R + 1.5)) return false;
    if (Math.hypot(x - towerBase.x, z - towerBase.z) < Math.max(14, 10.8 + R)) return false;   // footings reach 10.3 m
    if (Math.hypot(x - ladderTop.x, z - ladderTop.z) < 8 || Math.hypot(x - mouth.x, z - mouth.z) < 10) return false;
    if (lookout(x, z) < LOOKOUT.r + R * 0.8 || blockers.some((b) => Math.hypot(x - b.x, z - b.z) < 1.4)) return false;
    return spaced(x, z, s);
  };
  const plant = (sp, x, z, s) => {
    if (!ok(sp, x, z, s)) return false;
    const y = stack.heightAt(x, z);
    if (y === null) return false;
    stand.push({ x, z, s });
    ctx.forest.add(sp, x, y, z, s, rng.float(0, Math.PI * 2), Forest.tint(rng));
    trunks.addCylinder(x, y - 0.5, z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
    return true;
  };
  const sample = () => {
    const a = STAND_AT + rng.float(-STAND_EDGE, STAND_EDGE), d = Math.sqrt(rng.float(0.08, 1)) * stack.r * 1.05;
    return [cx + Math.cos(a) * d, cz + Math.sin(a) * d];
  };
  // Knots of trees, biggest in the middle: more of them, and bigger, in the heart.
  const clumps = [];
  for (let i = 0; i < 4000 && clumps.length < STAND_CLUMPS; i++) {
    const [x, z] = sample();
    if (rng.next() > weight(x, z) || clumps.some((c) => Math.hypot(x - c.x, z - c.z) < 8.5) || !ok('pine', x, z, 0.6)) continue;
    clumps.push({ x, z, h: heart(x, z) });
  }
  for (const c of clumps) {
    const n = 2 + Math.round(c.h * 4) + rng.int(0, 2);
    const broad = noise2(c.x * 0.06, c.z * 0.06, 53) > 0.15 ? 0.6 : 0.12;
    const big = rng.float(0.85, 1.1) * (0.6 + 0.55 * c.h);
    for (let i = 0, k = 0; i < n * 14 && k < n; i++) {
      const a = rng.float(0, Math.PI * 2), d = k ? rng.float(2.2, 7) : rng.float(0, 1.2);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const s = big * rng.float(0.8, 1.1) * (1 - (d / 7) * 0.35) * wind(x, z);
      if (plant(rng.next() < broad ? 'broadleaf' : 'pine', x, z, s)) k++;
    }
  }
  // Saplings in the gaps.
  for (let i = 0, n = 0; i < 2000 && n < STAND_SAPLINGS; i++) {
    const [x, z] = sample();
    if (rng.next() > weight(x, z) * 0.8) continue;
    if (plant(rng.next() < 0.3 ? 'broadleaf' : 'pine', x, z, rng.float(0.38, 0.55) * wind(x, z))) n++;
  }
  // Shrubs along its fringe and in its glades: near a trunk (as the groves' shrubs, never within 1.4 m of one), fewer
  // under the thick of it.
  for (let i = 0, n = 0; i < 4000 && n < STAND_SHRUBS; i++) {
    const [x, z] = sample();
    if (rng.next() < weight(x, z) * 0.7) continue;
    const d = Math.min(...stand.map((t) => Math.hypot(x - t.x, z - t.z)));
    if (d < 1.4 || d > 5.5 || trees.some((t) => Math.hypot(x - t.x, z - t.z) < 1.4) || blockers.some((b) => Math.hypot(x - b.x, z - b.z) < 1.2)) continue;
    path.closest(x, z, q);
    if (q.d < 2.4 || Math.hypot(x - towerBase.x, z - towerBase.z) < 11 || stack.edgeDist(x, z) < 3 || lookout(x, z) < LOOKOUT.r) continue;
    const y = stack.heightAt(x, z);
    if (y === null) continue;
    ctx.forest.add('shrub', x, y, z, rng.float(0.6, 1.1), rng.float(0, Math.PI * 2), Forest.tint(rng));
    blockers.push({ x, z });
    n++;
  }
  return stand;
}
