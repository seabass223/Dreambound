import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS } from '../../config.js';
import { Rng, smoothstep, noise2 } from '../../core/rng.js';
import { Stack } from '../terrain.js';
import { Batcher, ColliderBuilder } from '../builders.js';
import { Path } from '../paths.js';
import { buildLedge, buildLadder, buildTrail, buildCave, scatter } from '../features.js';
import { buildPowerTower } from '../../props/powertower.js';
import { createElevator } from '../../props/elevator.js';
import { addCaveBulb } from './dome.js';

// Tall-grass clumps sown over the cap (see tall() below for where they thin out).
const TALL_GRASS = 12000;

export function buildTower(ctx) {
  const cfg = STACKS.tower;
  const cx = cfg.x, cz = cfg.z;
  // Cave faces the Dome.
  const thC = Math.atan2(0 - cz, 0 - cx);
  const thL = thC + 0.22;
  const DEPTH = 3.3;
  const stack = new Stack(cfg, {
    cliffCalm: (th, depth) => {
      const d = Math.abs(Math.atan2(Math.sin(th - thC - 0.1), Math.cos(th - thC - 0.1)));
      return d < 0.45 && depth < 16 ? 0.2 : 1;
    },
    // The wall relief (WALLS.geo) keeps off the cave, the ledge and the ladder: exactly 0 down to 12 m.
    protect: [{ from: thC - 0.35, to: thL + 0.4, depth: 12, feather: 10 }],
  });
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

  // Cave + ledge path + short ladder.
  const endR = stack.cliffRadius(thC, DEPTH, stack.edgeR(thC)) + 2.1;
  const mouth = new THREE.Vector3(cx + Math.cos(thC) * endR, cfg.top - DEPTH, cz + Math.sin(thC) * endR);
  const into = new THREE.Vector3(Math.sin(thC), 0, -Math.cos(thC));
  const cave = buildCave(ctx, { mouth, dir: into, length: 4.6, batcher, collider, seed: 31 });
  addCaveBulb(ctx, cave.platePos, cave.plateRot, batcher);
  const samples = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const th = thC + 0.02 + (thL + 0.06 - thC - 0.02) * t;
    samples.push({ theta: th, depth: DEPTH, width: 2.3 + (1 - smoothstep(0, 0.25, t)) * 1.8 + smoothstep(0.75, 0.9, t) * 1.0 });
  }
  buildLedge(stack, samples, batcher, collider, 13);
  const wallR = stack.cliffRadius(thL, 1.5, stack.edgeR(thL));
  const lipY = stack.heightAt(cx + nL.x * (ladderEdge - 0.8), cz + nL.z * (ladderEdge - 0.8));
  const base = new THREE.Vector3(cx + nL.x * (wallR + 0.05), cfg.top - DEPTH, cz + nL.z * (wallR + 0.05));
  buildLadder(ctx, { base, n: nL, height: lipY - base.y, batcher });
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
  for (const p of scatter(stack, 12, rng, clear, { margin: 2 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.6, 1.1));
  for (const p of scatter(stack, 5000, rng, (x, z) => { path.closest(x, z, q); return q.d > 1.0; }, { margin: 1.2, tries: 3 })) ctx.meadow.add(p.x, p.y, p.z, rng.float(0.8, 1.35));
  ctx.pebbles.scatter(stack, 40, rng, clear);
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
    ctx.tallGrass.add(p.x, p.y, p.z, grng.float(0.6, 1.1) * (0.7 + 0.3 * f), gold);
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
