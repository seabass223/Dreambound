import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS, PLAYER } from '../../config.js';
import { Rng, smoothstep, clamp, fbm2 } from '../../core/rng.js';
import { Stack } from '../terrain.js';
import { Batcher, ColliderBuilder, mat4 } from '../builders.js';
import { scatter } from '../features.js';
import { layoutTrail, buildMountainTrail, dressTrail, crownClear } from '../mountainPath.js';
import { placeObservatory } from '../../props/observatory.js';
import { createElevator } from '../../props/elevator.js';
import { placeShed } from '../../props/shed.js';
import { mineFrame, buildMine } from '../../props/mine.js';

const PEAK = 38, R_PLATEAU = 9.5, R_BASE = 52;

export function buildMountain(ctx) {
  const cfg = STACKS.mountain;
  const cx = cfg.x, cz = cfg.z;
  const sx = cx + 3, sz = cz + 2; // summit
  const stack = new Stack(cfg, { rings: 92, segs: 250 });
  const cone = (d) => PEAK * Math.pow(1 - clamp((d - R_PLATEAU) / (R_BASE - R_PLATEAU), 0, 1), 1.25);

  // Shed at the foot, on the side facing the Dome.
  const thS = Math.atan2(0 - sz, 0 - sx);
  const shedR = 58;
  const shed = { x: sx + Math.cos(thS) * shedR, z: sz + Math.sin(thS) * shedR };
  const tang = new THREE.Vector3(-Math.sin(thS), 0, Math.cos(thS)); // shed front faces along the slope
  const shedRot = Math.atan2(tang.x, tang.z);

  // Switchback path (world/mountainPath.js): polar legs round the summit ([theta, r, turn radius?]) from the shed door
  // to the observatory's, a U-turn at each of the five reversals. The hillsides are steeper than PLAYER.maxSlope, so
  // this is the way up; its own grades stay gentle, with timber steps where it climbs harder (the turns).
  const legs = [
    [thS + 0.09, 55.5], [thS + 0.16, 50], [thS + 1.0, 42], [thS - 0.55, 31], [thS + 0.6, 22.5], [thS - 0.65, 16.5],
    [thS + 0.6, 12.2, 1.8], [thS - 0.05, R_PLATEAU + 0.3], [thS - 0.05, 6.7],
  ];
  const door = [shed.x + tang.x * 2.9, shed.z + tang.z * 2.9];
  let trail = null;   // laid out on the bare hillside (below), then it cuts its bed into it

  // The spur: the same path the other way, toward the mine (props/mine.js, a hundred metres round the foot), for a
  // little way. It forks from the trail on the doorstep, makes a U-turn (as wide as the trail's) round the shed's outer
  // front corner, runs back past the rain barrel and the shed's side, and follows the foot of the mountain, drifting in
  // toward the hill, until it peters out some 30 m past the shed: it says which way to go, and no more. In the shed's
  // frame (x out toward the rim, z out of the door):
  const SPUR = { turn: 1.95, z: 3.5 };   // the U-turn's radius, and how far out of the door its centre is
  const inShed = (lx, lz) => [shed.x + Math.cos(thS) * lx + tang.x * lz, shed.z + Math.sin(thS) * lx + tang.z * lz];
  const spurHead = [door, inShed(0, 3.2)];
  for (let k = 0; k <= 12; k++) { const a = k * Math.PI / 12; spurHead.push(inShed(SPUR.turn * (1 - Math.cos(a)), SPUR.z + SPUR.turn * Math.sin(a))); }
  for (let lz = SPUR.z - 0.7; lz > -2.3; lz -= 0.7) spurHead.push(inShed(SPUR.turn * 2, lz));
  // ...and round the foot, the way the trail's legs go round the summit: [theta, r] from the shed's back corner on.
  const DEG = Math.PI / 180, back = inShed(SPUR.turn * 2, -2.8);
  const spurLegs = [
    [Math.atan2(back[1] - sz, back[0] - sx), Math.hypot(back[0] - sx, back[1] - sz)],
    [thS - 12 * DEG, 61.4], [thS - 20 * DEG, 59.6], [thS - 27 * DEG, 57.6], [thS - 33.5 * DEG, 56.2],
  ];
  let spur = null;    // laid on the ground as the trail and the shed leave it

  const q = {};
  stack.shapeFns.push((x, z, h) => {
    const d = Math.hypot(x - sx, z - sz);
    const rough = fbm2(x * 0.06, z * 0.06, 3, 91) * 2.2 * smoothstep(R_PLATEAU, R_PLATEAU + 8, d) * (1 - smoothstep(R_BASE - 8, R_BASE, d));
    h += cone(d) + rough;
    if (d < R_PLATEAU + 1) h = THREE.MathUtils.lerp(h, cfg.top + PEAK, 1 - smoothstep(R_PLATEAU - 1, R_PLATEAU + 1, d));
    if (trail) h = trail.carve(x, z, h);
    const ds = Math.hypot(x - shed.x, z - shed.z);
    if (ds < 7) h = THREE.MathUtils.lerp(cfg.top + cone(shedR) + 0.1, h, smoothstep(3.6, 7, ds));
    return h;
  });
  trail = layoutTrail({ sx, sz, head: [door, [door[0] + tang.x * 2.5, door[1] + tang.z * 2.5]], legs, ground: (x, z) => stack.heightAtAnalytic(x, z) });
  spur = layoutTrail({
    sx, sz, head: spurHead, legs: spurLegs, ground: (x, z) => stack.heightAtAnalytic(x, z), smooth: 1.5,
    fade: { boards: 16.5, narrow: 16, tread: 11, earth: 4.5, seed: 3 },
  });
  // Nothing instanced (grass, flowers, pebbles) grows through its pebbles: hidden once the scatter is built
  // (world/index.js), so none of it is drawn again and everything else stays where it was (see tools/regress).
  stack.finish = () => ctx.lod.hideInstancesWhere((x, y, z) => spur.on(x, z, q) && Math.abs(y - q.y) < 2);
  // The mine adit (props/mine.js) in the south hillside: its cut and the hole behind its portal are the cap's, so they
  // go in before it is built.
  const mineF = mineFrame(stack, { sx, sz });
  const verge = new THREE.Color(0.2, 0.16, 0.11);
  stack.colorFns.push((x, z, h, col) => {
    trail.near(x, z, q);
    let w = q.d < 1.7 ? (1 - smoothstep(0.8, 1.7, q.d)) * 0.6 : 0;
    // (the spur's the same, fading out with it and a few metres beyond its last pebbles; where both are, the darker)
    spur.near(x, z, q);
    if (q.d < 1.7) w = Math.max(w, (1 - smoothstep(0.8, 1.7, q.d)) * 0.6 * spur.wear(q.s));
    if (w > 0) col.lerp(verge, w);
  });

  const collider = new ColliderBuilder('mountain');
  const batcher = new Batcher();
  stack.build(collider);
  // The path's walking surface is a collider of its own (its own BVH; all of it walkable, see mountainPath.js).
  buildMountainTrail(trail, batcher, ctx.lateCollider('mountain-trail'), { open: [spur] });
  // The spur: no collider (you walk on the cap under it); one tread with the trail's where they part.
  buildMountainTrail(spur, batcher, null, { seed: 9, ground: (x, z) => stack.heightAt(x, z), over: trail });
  ctx.mountainTrail = trail;   // (main.js: footsteps on its pebbles and ties)
  ctx.mountainSpur = spur;

  // ---- Shed ---- (props/shed.js, tools/blender/shed_design.py): a timber hoist house on a stone plinth round the
  // elevator's upper stop; its own collider ('shed'), and into the props' far stand-in below.
  const shedY = stack.heightAt(shed.x, shed.z);
  const sm = mat4(shed.x, shedY, shed.z, shedRot);
  const shedProp = ctx.shedAsset ? placeShed(ctx, ctx.shedAsset, { pos: new THREE.Vector3(shed.x, shedY, shed.z), rotY: shedRot, parent: ctx.surface }) : null;
  ctx.shed = shedProp;
  // The elevator's plate, built into the shed as its partition; the car behind it.
  const platePos = new THREE.Vector3(0, 0.12, -0.05).applyMatrix4(sm);

  // ---- Mine ---- (the rock into this batch; the timber and the rest: tools/blender/mine_design.py)
  ctx.mine = buildMine(ctx, stack, ctx.mineAsset ?? null, mineF, { batcher });

  // ---- Observatory ----
  const oy = stack.heightAt(sx, sz);
  const lastLeg = legs[legs.length - 2];
  ctx.observatory = placeObservatory(ctx, ctx.observatoryAsset, { center: new THREE.Vector3(sx, oy, sz), doorAngle: lastLeg[0], collider });

  // ---- Vegetation ----
  const rng = new Rng(cfg.seed * 3);
  const clear = (x, z) => {
    if (trail.near(x, z, q).d < 2.8) return false;
    if (Math.hypot(x - shed.x, z - shed.z) < 7) return false;
    return Math.hypot(x - sx, z - sz) > 14;
  };
  const trees = [];
  for (const p of scatter(stack, 55, rng, (x, z) => clear(x, z) && Math.hypot(x - sx, z - sz) > 24, { margin: 4 })) {
    const sp = rng.next() < 0.75 ? 'pine' : 'broadleaf';
    const s = rng.float(0.7, 1.15);
    if (mineF.near(p.x, p.z, 1)) continue;   // (after its draws) not in the mine's cut or over its drive
    if (![trail, spur].every((t) => crownClear(ctx.forest, t, sp, p.x, p.y, p.z, s))) continue;   // (after its draws) no bough low over the path or its spur
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
    trees.push({ x: p.x, z: p.z, r: 0 });
  }
  for (const p of scatter(stack, 45, rng, clear, { margin: 2 })) {
    const s = rng.float(0.6, 1.1);
    if (!mineF.near(p.x, p.z)) ctx.forest.add('shrub', p.x, p.y, p.z, s);
  }
  for (const p of scatter(stack, 5200, rng, (x, z) => trail.near(x, z, q).d > 1.2 && Math.hypot(x - sx, z - sz) > 6.7, { margin: 1.2, tries: 3 })) {
    const n = stack.normalAt(p.x, p.z);
    if (n.y > 0.7) { const s = rng.float(0.7, 1.2); if (!mineF.near(p.x, p.z)) ctx.meadow.add(p.x, p.y, p.z, s); }
  }
  ctx.pebbles.scatter(stack, 90, rng, clear);
  // Along the path: grass and wildflowers on its verges, trees beside it, stones round the hairpins.
  dressTrail(ctx, stack, trail, collider, {
    ok: (x, z) => Math.hypot(x - shed.x, z - shed.z) > 5.5 && Math.hypot(x - sx, z - sz) > 7.4,
    treeOk: (x, z) => Math.hypot(x - shed.x, z - shed.z) > 7 && Math.hypot(x - sx, z - sz) > 13,
    avoid: trees,
  });
  // ...and along the spur (after everything else's, so nothing else's draws move): grass and flowers. No trees: each
  // would be a trunk in the stack's own collider.
  dressTrail(ctx, stack, spur, null, { seed: 171, trees: false, beside: [trail], ok: (x, z) => !shedProp?.inside(x, z, 0.2) });

  const props = batcher.build(stack.group, { name: 'mountain-props' });
  for (const m of props) if (m.material.name === 'trail-pebbles') m.castShadow = false;   // (flat on the ground)
  // From other stacks the props are one merged stand-in (see render/lod.js).
  ctx.lod.addFarProxy([...props.filter(mergeable), ...(shedProp?.meshes ?? [])], {
    parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'mountain-props', aoTexture: shedProp?.atlas ?? null,
  });
  ctx.surface.add(stack.group);
  // The hillsides are steeper than PLAYER.maxSlope: you can't walk up them, only the switchbacks. (The cap only, a
  // metre in from the rim: walking off the edge and down the cliff is as it was.)
  ctx.physics.addCollider(collider.build(), 'surface', { maxSlope: PLAYER.maxSlope, where: (x, z) => stack.edgeDist(x, z) > 1 });

  createElevator(ctx, {
    id: 'mountain',
    start: 'bottom',   // waiting on the cave floor (only the Home stack's waits up top, by the cabin)
    ends: {
      top: { pos: platePos, rotY: shedRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('mountain-car') },
      bottom: ctx.tunnelStation('mountain'),
    },
  });
  stack.trail = trail.path;   // the switchback path from the shed to the observatory (a Path, with heights)
  stack.trailInfo = trail;    // its layout: near(x, z), yAt(s), turns, steps (world/mountainPath.js)
  stack.spur = spur.path;     // the spur from the door round the shed and along the foot, toward the mine
  stack.spurInfo = spur;      // its layout too: ends (where its edging, tread and patches stop), span(s), patches
  stack.shed = { x: shed.x, z: shed.z, rot: shedRot, door: door, platePos };
  ctx.stacks.mountain = stack;
  return stack;
}
