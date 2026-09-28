import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS, WALLS } from '../../config.js';
import { Rng, smoothstep, noise2 } from '../../core/rng.js';
import { materials } from '../../render/materials.js';
import { Stack, capRelief, RELIEF_SEED } from '../terrain.js';
import { Batcher, ColliderBuilder, mat4 } from '../builders.js';
import { Path } from '../paths.js';
import { buildLedge, buildLadder, buildTrail, scatter, buildCave } from '../features.js';
import { createElevator } from '../../props/elevator.js';
import { placeCabin, PROBE_LAYER } from '../../props/cabin.js';

const DOME_R = 14; // must match R_DOME in tools/blender/cabin_design.py
const TAU = Math.PI * 2;
const LADDER_THETA = -Math.PI / 2;     // south
// The ledge runs west from the ladder foot to the cave: about 55 m of walking (it once went half way round, ~180 m).
const LEDGE_ARC = 0.9;
const CAVE_THETA = LADDER_THETA - LEDGE_ARC;
const LEDGE_START_DEPTH = 6.1;         // 20 ft below the lip
const LEDGE_END_DEPTH = 10.5;          // a 4.4 m drop keeps the short ledge's ramp gentle (8 degrees at most)
// The wall relief (WALLS.geo) keeps off the ladder, the ledge, the cave hood and the elevator (south round to
// west-southwest): exactly 0 over this arc down to 22 m, back to full over 12 m of arc and depth.
const WALL_PROTECT = [{ from: CAVE_THETA + TAU - 0.35, to: Math.PI * 1.5 + 0.3, depth: 22, feather: 12 }];

export function buildDome(ctx) {
  const cfg = STACKS.dome;
  const stack = new Stack(cfg, {
    // Calm legacy wall over the west half (-78° round to +78°), to 28 m down: under the ladder, the ledge and the
    // cave (-85° to -152°). Kept on the north-west, where the long ledge ran: uncalmed there, the wall grows strata
    // shelves under the rim that slow walk-offs land on (tools/regress R6).
    cliffCalm: (th, depth) => (Math.cos(th) < 0.2 && depth < 28 ? 0.25 : 1),
    protect: WALL_PROTECT,
  });
  const cx = cfg.x, cz = cfg.z;

  // Trail from the dome door to the ladder at the south lip.
  const ladderEdge = stack.edgeR(LADDER_THETA);
  const trail = Path.smooth([
    [cx, cz - DOME_R - 1.0], [cx + 1.4, cz - 19.5], [cx - 2.8, cz - 28], [cx + 1.8, cz - 39], [cx + 0.4, cz - ladderEdge + 1.2],
  ], 1.5, 1.4);
  const q = {};
  // Rolling ground (WALLS.relief), pushed first so the pad, trail and ladder-lip fns below still have the last word.
  // 0 over the pad, its blend ring and the garden (to DOME_R + 8), within 8 m of the ladder lip; the trail keeps 30 %.
  // 0.025/m: at the plan's 0.011 the cap spans about one noise cell, so every seed tilts it one way.
  if (WALLS.relief) {
    const lx = cx + Math.cos(LADDER_THETA) * ladderEdge, lz = cz + Math.sin(LADDER_THETA) * ladderEdge;
    const qr = {};   // own scratch: the fns below reuse q
    stack.shapeFns.push(capRelief(stack, {
      freq: 0.025, amp: 2.3, rise: 0.75, seed: RELIEF_SEED.dome,
      mask: (x, z) => {
        const m = smoothstep(DOME_R + 8, DOME_R + 18, Math.hypot(x - cx, z - cz)) * smoothstep(8, 16, Math.hypot(x - lx, z - lz));
        if (!(m > 0)) return 0;
        trail.closest(x, z, qr);
        return m * (0.3 + 0.7 * smoothstep(1.5, 5, qr.d));
      },
    }));
  }
  stack.shapeFns.push((x, z, h, c) => {
    // Level pad under the dome.
    const d = Math.hypot(x - cx, z - cz);
    h = THREE.MathUtils.lerp(h, cfg.top + 0.15, 1 - smoothstep(DOME_R + 1, DOME_R + 6, d));
    trail.closest(x, z, q);
    if (q.d < 3) h -= (1 - smoothstep(0.4, 2.4, q.d)) * 0.12 * smoothstep(DOME_R + 0.5, DOME_R + 2.5, d); // no dip inside the dome
    // Keep the lip at the ladder crisp and walkable.
    if (Math.abs(x - cx) < 3 && z < cz - ladderEdge + 5) h = Math.max(h, cfg.top - 0.9 - (1 - smoothstep(0, 4, c.inside)) * 0.3);
    return h;
  });
  stack.colorFns.push((x, z, h, col) => {
    trail.closest(x, z, q);
    if (q.d < 2.2) col.lerp(new THREE.Color(0.17, 0.13, 0.09), (1 - smoothstep(0.6, 2.2, q.d)) * 0.8);
    const d = Math.hypot(x - cx, z - cz);
    if (Math.abs(d - DOME_R) < 1.3) col.lerp(new THREE.Color(0.14, 0.12, 0.09), 0.5);
  });

  const collider = new ColliderBuilder('dome');
  const batcher = new Batcher();
  stack.build(collider);

  buildTrail(stack, trail, batcher, { width: 1.25 });

  // ---- Geodesic glass dome with the cabin inside (modeled in Blender: tools/blender/build_cabin.py) ----
  ctx.house = placeCabin(ctx, ctx.cabinAsset, { origin: new THREE.Vector3(cx, cfg.top + 0.15, cz), collider });
  // Garden keep-outs, in dome-local coordinates: the cabin + porch, the flagstone path, planters, fire pit, curb.
  const inHouse = (x, z) => {
    const lx = x - cx, lz = z - cz;
    if (lx > -7.3 && lx < 7.2 && lz > -8.2 && lz < 5.6) return true;
    if (Math.abs(lx) > 1.5 && Math.abs(lx) < 3.95 && lz > -10.15 && lz < -8.45) return true; // lavender planters
    if (Math.hypot(lx, lz - 9.3) < 2.9) return true; // fire pit + chairs
    if (Math.hypot(Math.abs(lx) - 3.8, lz - 12.3) < 0.5) return true; // festoon posts
    return false;
  };
  const onGardenPath = (x, z) => Math.abs(x - cx) < 1.4 && z - cz < -7.5;

  // ---- Ladder + ledge path running west to the cave ----
  const ledgeY = cfg.top - LEDGE_START_DEPTH;
  const samples = [];
  const th0 = LADDER_THETA + 0.09, th1 = CAVE_THETA, span = th0 - th1;
  // Shaped in radians from the start (u), not in fractions of the ledge, so the landing at the ladder, the sample
  // spacing (~2.6 m) and the width wobble look as they did on the long ledge; the apron widens over the last 16 m.
  const N = Math.round(span / 0.046);
  for (let i = 0; i <= N; i++) {
    const u = span * i / N;
    const depth = LEDGE_START_DEPTH + (LEDGE_END_DEPTH - LEDGE_START_DEPTH) * smoothstep(0.2, span, u);
    const width = 2.4 + (1 - smoothstep(0, 0.226, u)) * 1.6 + smoothstep(span - 0.28, span, u) * 1.8 + noise2(u * 2.785, 0, 4) * 0.35;
    samples.push({ theta: th0 - u, depth, width });
  }
  buildLedge(stack, samples, batcher, collider, 7);

  const wallR = stack.cliffRadius(LADDER_THETA, 3, stack.edgeR(LADDER_THETA));
  const n = new THREE.Vector3(Math.cos(LADDER_THETA), 0, Math.sin(LADDER_THETA));
  const lipY = stack.heightAt(cx + n.x * (ladderEdge - 0.8), cz + n.z * (ladderEdge - 0.8));
  const base = new THREE.Vector3(cx + n.x * (wallR + 0.05), ledgeY, cz + n.z * (wallR + 0.05));
  buildLadder(ctx, { base, n, height: lipY - ledgeY, batcher });

  // ---- Cave at the end of the ledge, heading on around the stack (west-southwest) ----
  const endTh = th1;
  const endR = stack.cliffRadius(endTh, LEDGE_END_DEPTH, stack.edgeR(endTh)) + 2.1;
  const mouth = new THREE.Vector3(cx + Math.cos(endTh) * endR, cfg.top - LEDGE_END_DEPTH, cz + Math.sin(endTh) * endR);
  const tangent = new THREE.Vector3(Math.sin(endTh), 0, -Math.cos(endTh)); // direction of decreasing theta
  const cave = buildCave(ctx, { mouth, dir: tangent, length: 4.8, batcher, collider, seed: 12 });
  // A small caged bulb above the elevator.
  addCaveBulb(ctx, cave.platePos, cave.plateRot, batcher);

  // ---- Forest ----
  const rng = new Rng(cfg.seed * 7);
  const clear = (x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    if (d < DOME_R + 3.5) return false;
    trail.closest(x, z, q);
    if (q.d < 2.6) return false;
    if (Math.hypot(x - (cx + n.x * ladderEdge), z - (cz + n.z * ladderEdge)) < 7) return false;
    return true;
  };
  // Keep a view corridor from the spawn point toward the sunset.
  const spawnClear = (x, z) => !(x > 8 && x < 26 && Math.abs(z - 7) < 5);
  for (const p of scatter(stack, 120, rng, (x, z) => clear(x, z) && spawnClear(x, z), { margin: 3.5 })) {
    const sp = rng.next() < 0.62 ? 'pine' : 'broadleaf';
    const s = rng.float(0.75, 1.3);
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 70, rng, clear, { margin: 2 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.7, 1.4));
  for (const p of scatter(stack, 5600, rng, (x, z) => {
    trail.closest(x, z, q);
    const d = Math.hypot(x - cx, z - cz);
    const inGarden = d < DOME_R - 0.75 && !inHouse(x, z) && !onGardenPath(x, z);
    return q.d > 1.1 && (d > DOME_R + 0.6 || inGarden);
  }, { margin: 1.2, tries: 3 })) ctx.meadow.add(p.x, p.y, p.z, rng.float(0.7, 1.25));
  // A lush lawn, two small trees and a few shrubs in the dome garden.
  const garden = (x, z) => Math.hypot(x - cx, z - cz) < DOME_R - 0.75 && !inHouse(x, z) && !onGardenPath(x, z);
  for (let i = 0, n = 0; i < 6000 && n < 1400; i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (DOME_R - 0.75);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!garden(x, z)) continue;
    ctx.meadow.add(x, stack.heightAt(x, z), z, rng.float(0.8, 1.3));
    n++;
  }
  for (const [lx, lz, s] of [[-10.2, -3.6, 0.72], [9.3, 6.4, 0.8]]) {
    const x = cx + lx, z = cz + lz, y = stack.heightAt(x, z);
    ctx.forest.add('broadleaf', x, y, z, s);
    collider.addCylinder(x, y - 0.5, z, ctx.forest.radiusOf('broadleaf') * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 22, rng, (x, z) => { const d = Math.hypot(x - cx, z - cz); return d < DOME_R - 1.6 && !inHouse(x, z) && !onGardenPath(x, z); }, { margin: 2, tries: 60 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.8, 1.3));

  // Scattered stones
  ctx.pebbles.scatter(stack, 60, rng, clear);

  const props = batcher.build(stack.group, { name: 'dome-props' });
  // From other stacks the props are one merged stand-in (see render/lod.js).
  ctx.lod.addFarProxy(props.filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'dome-props' });
  stack.group.traverse((o) => o.layers.enable(PROBE_LAYER)); // the garden ground shows in the cabin's reflections
  ctx.surface.add(stack.group);
  const col = ctx.physics.addCollider(collider.build(), 'surface');

  createElevator(ctx, {
    id: 'dome',
    ends: {
      top: { pos: cave.platePos, rotY: cave.plateRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('dome-car') },
      bottom: ctx.tunnelStation('dome'),
    },
  });

  ctx.stacks.dome = stack;
  return stack;
}

export function addCaveBulb(ctx, platePos, plateRot, batcher) {
  const p = new THREE.Vector3(0, 2.75, 0.35).applyMatrix4(mat4(platePos.x, platePos.y, platePos.z, plateRot));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.1) }));
  bulb.position.copy(p);
  ctx.surface.add(bulb);
  ctx.lod?.add(bulb, { out: [70, 95], name: 'cave bulb' });
  const cage = new THREE.TorusGeometry(0.12, 0.01, 4, 10);
  batcher.add(cage, materials().darkMetal, mat4(p.x, p.y, p.z, plateRot));
  batcher.add(cage, materials().darkMetal, mat4(p.x, p.y, p.z, plateRot + Math.PI / 2));
  batcher.add(new THREE.BoxGeometry(0.04, 0.3, 0.04), materials().darkMetal, mat4(p.x, p.y + 0.15, p.z));
}
