import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS, WALLS } from '../../config.js';
import { Rng, smoothstep } from '../../core/rng.js';
import { patchMaterial } from '../../render/materials.js';
import { Textures } from '../../render/textures.js';
import { Stack, capRelief, RELIEF_SEED } from '../terrain.js';
import { Batcher, ColliderBuilder } from '../builders.js';
import { Path } from '../paths.js';
import { scatter } from '../features.js';
import { streamGeometry, createStreamMaterial, edgeWaterfall, cascadeMesh } from '../water.js';
import { splashFX, mistFX, hazeFX, poolFoamFX, fallSprayFX } from '../waterfx.js';
import { buildTor, buildRockPile } from '../rockpiles.js';
import { Flowers } from '../flowers.js';
import { buildBridge } from '../bridge.js';
import { createElevator } from '../../props/elevator.js';
import { createMovableRocks } from '../../props/movableRocks.js';
import { buildSequoia } from '../../props/sequoia.js';
import { carvePetroglyph } from '../../props/petroglyph.js';
import { ROCK_TARGETS } from '../rockPuzzle.js';

// Layout (offsets from the stack centre). The tor stands west of the sequoia, in view of its door; its spring
// spills down the south-east face into a pool, and the creek runs past the tree and east over the lip.
const TREE = { x: -13, z: 11 };
const TOR = { x: -29.6, z: 16.7, radius: 8.5, height: 12.5, spill: THREE.MathUtils.degToRad(-50) };
const PILES = [
  { deg: 45, radius: 5.0, height: 5.5, seed: 11 }, { deg: 205, radius: 4.2, height: 4.2, seed: 12 },
  { deg: 255, radius: 4.6, height: 5.0, seed: 13 }, { deg: 305, radius: 3.8, height: 3.6, seed: 14 },
];
const POOL_R = 3.4;
const SEQ_SINK_R = 4.3;   // ground sunk under the sequoia out to here: its car and sill reach 3.5 m, plus a cap triangle
// The petroglyph (a clue, props/petroglyph.js): on the big stone of the 205° pile, on the face looking out to the rim,
// about 0.8 m up. at: a point on that face (x, z from the stack's centre, y absolute); normal: roughly out of it.
const GLYPH = { pile: 1, at: [-41.409, 5.974, -16.657], normal: [-0.831, 0.01, 0.556], lift: 0.04 };
// A sparse line of flat stones across the meadow, round the north side of that pile to the ground in front of the
// carving (the last one about 2.2 m from it): there to be noticed, not a path. Offsets from the stack's centre.
const CLUE_STONES = [[-27.5, -6.8], [-30.2, -8.1], [-33.1, -9.7], [-35.8, -11.1], [-38.2, -12.5], [-40.3, -13.6], [-42.0, -14.5]];

export function buildRocks(ctx) {
  const cfg = STACKS.rocks;
  const cx = cfg.x, cz = cfg.z;
  const stack = new Stack(cfg, { rings: 70, segs: 220 });
  const L = (x, z) => [cx + x, cz + z];

  // ---- Stream: tor pool -> past the sequoia -> meander -> over the east lip (facing the Dome) ----
  const torC = new THREE.Vector3(cx + TOR.x, 0, cz + TOR.z);
  const spill = new THREE.Vector3(Math.cos(TOR.spill), 0, Math.sin(TOR.spill));
  const pool = torC.clone().addScaledVector(spill, TOR.radius + 2.2);          // splash pool at the tor's foot
  const fallTheta = -0.3;
  const fallR = stack.edgeR(fallTheta);
  // The wall relief (WALLS.geo) keeps off the fall (every depth it drops past), cuts nothing in under the bridge
  // anchor, and keeps off the buried skirts of the piles and the tor (the plan's 6 m, held to 10 m so it doesn't
  // switch on with depth where a slow walk-off still slides down the face).
  {
    const thB = Math.atan2(STACKS.end.bridgeDir.z, STACKS.end.bridgeDir.x);
    const round = (th, d, rad) => ({ from: th - Math.asin(Math.min(1, rad / d)), to: th + Math.asin(Math.min(1, rad / d)), depth: 10, feather: 3 });
    stack.protect = [
      // The θ=0 seam fade may pass through its feather (the fall stays exact; the seam closes).
      { from: fallTheta - 0.2, to: fallTheta + 0.2, depth: 200, feather: 8, seam: false },
      { from: thB - 0.2, to: thB + 0.2, depth: 12, feather: 8, inward: true },
      ...PILES.map((p) => { const th = THREE.MathUtils.degToRad(p.deg); return round(th, stack.edgeR(th) - p.radius - 2.5, p.radius + 3); }),
      round(Math.atan2(TOR.z, TOR.x), Math.hypot(TOR.x, TOR.z), TOR.radius + 3),
    ];
  }
  // The creek starts under the tor's face so its surface covers the whole pool.
  const stream = Path.smooth([
    [pool.x - spill.x * 3, pool.z - spill.z * 3], [pool.x, pool.z], [pool.x + spill.x * 3, pool.z + spill.z * 3],
    L(-13, 0.5), L(-6, -1.5), L(0, -3), L(4, -3), L(11, 1), L(18, -5), L(26, -2), L(33, -9), L(40, -10),
    [cx + Math.cos(fallTheta) * (fallR - 1.5), cz + Math.sin(fallTheta) * (fallR - 1.5)],
    [cx + Math.cos(fallTheta) * (fallR + 0.6), cz + Math.sin(fallTheta) * (fallR + 0.6)],
  ], 0.8, 1.2);
  const POOL_T = 3 + POOL_R;                    // path length to the pool's downstream rim
  // Rolling ground (WALLS.relief), pushed first: before the sequoia's flatten and the bed[] block. It is 0 within 3 m
  // of the creek (bed[] reads the centreline and 2.4 m either side near the lip), round the pool, within 8 m of the
  // tree (its flatten target is unchanged) and within R + 6 of the tor and radius + 3 of each pile (measured: their
  // ground, walls, shells and meshes stay exact), so the creek, the fall, the tor and the piles are today's. Movable
  // rocks re-read the ground, and the bridge anchor is inside the rim fade; each gets only a light feather. 0.025/m:
  // at the plan's 0.0095 the cap spans about one noise cell, so every seed tilts it one way.
  let waterAt = null;   // the creek's water line by path length, once bed[] exists (for the relief's floor)
  if (WALLS.relief) {
    // Own scratch (the carve and colour fns reuse q).
    const qr = {}, ql = {}, fl = { y: 0, w: 0 }, fl0 = { y: 0, w: 0 };
    const FLOOR_M = 0.3;
    const tx = cx + TREE.x, tz = cz + TREE.z;
    const piles = PILES.map((p) => {
      const th = THREE.MathUtils.degToRad(p.deg), rr = stack.edgeR(th) - p.radius - 2.5;
      return { x: cx + Math.cos(th) * rr, z: cz + Math.sin(th) * rr, r0: p.radius + 3 };
    });
    const torR0 = TOR.radius + 6;
    const thB = Math.atan2(STACKS.end.bridgeDir.z, STACKS.end.bridgeDir.x), aR = stack.edgeR(thB) - 1.6;
    const bx = cx + Math.cos(thB) * aR, bz = cz + Math.sin(thB) * aR;
    stack.shapeFns.push(capRelief(stack, {
      freq: 0.025, amp: 2.4, seed: RELIEF_SEED.rocks,
      mask: (x, z) => {
        let m = smoothstep(8, 13, Math.hypot(x - tx, z - tz)) * smoothstep(POOL_R + 2, POOL_R + 8, Math.hypot(x - pool.x, z - pool.z))
          * smoothstep(torR0, torR0 + 5, Math.hypot(x - torC.x, z - torC.z)) * smoothstep(6, 12, Math.hypot(x - bx, z - bz));
        for (const p of piles) m *= smoothstep(p.r0, p.r0 + 5, Math.hypot(x - p.x, z - p.z));
        if (!(m > 0)) return 0;
        stream.closest(x, z, qr);
        return m * smoothstep(3, 8, qr.d);
      },
      // Hollows near the creek stay above its local water line (+ FLOOR_M), so it never runs on a raised bank over a dip
      // below its surface; the hold lets go gently from 13 to 24 m out. waterAt is set once bed[] exists (the relief
      // is 0 wherever bed[] samples, so it is never needed earlier).
      floor: (x, z) => {
        if (!waterAt) return fl0;
        stream.closest(x, z, ql);
        fl.w = 1 - smoothstep(13, 24, ql.d);
        fl.y = fl.w > 0 ? waterAt(ql.t) + FLOOR_M : 0;
        return fl;
      },
    }));
  }
  // The sequoia stands on level ground at its analytic height (any cap relief is pushed before this): flat out to
  // 5 m, natural again by 7.5 m, and sunk 6 cm under the trunk and the elevator car, so the car floor (2 cm below
  // the tree's base) clears it by 4 cm. The creek's centreline is 8.7 m off (outside the 7.5 m blend), so bed[]
  // doesn't change.
  const tree = { x: cx + TREE.x, z: cz + TREE.z, r: 6 };
  const treeY = stack.heightAtAnalytic(tree.x, tree.z);
  stack.shapeFns.push((x, z, h) => {
    const d = Math.hypot(x - tree.x, z - tree.z);
    if (d >= 7.5) return h;
    const flat = treeY - 0.06 * (1 - smoothstep(SEQ_SINK_R, SEQ_SINK_R + 0.5, d));
    return THREE.MathUtils.lerp(flat, h, smoothstep(5, 7.5, d));
  });
  // Monotonic bed profile from the uncarved terrain, level across the pool. Near the rim the rounded lip drops the
  // ground beside the creek below its centreline; there the bed follows the lower bank, so the banks hold the water.
  let carve = false;
  const q = {};
  const bed = [];
  {
    let minH = Infinity;
    for (let t = 0; t <= stream.total; t += 0.8) {
      const p = stream.pointAt(t), len = Math.hypot(p.dx, p.dz) || 1;
      let h = stack.heightAtAnalytic(p.x, p.z);
      for (const o of [-2.4, 2.4]) {
        const x = p.x - (p.dz / len) * o, z = p.z + (p.dx / len) * o;
        if (stack.edgeDist(x, z) < 7) h = Math.min(h, stack.heightAtAnalytic(x, z));
      }
      h -= 0.55;
      minH = Math.min(minH, h - 0.02);
      bed.push(minH);
    }
    const n = Math.ceil(POOL_T / 0.8);
    for (let i = 0; i < n; i++) bed[i] = bed[n];
  }
  const bedAt = (t) => bed[Math.min(bed.length - 1, Math.round(t / 0.8))];
  const waterY = bed[0] + 0.34;
  if (WALLS.relief) waterAt = (t) => bedAt(t) + 0.34;
  stack.shapeFns.push((x, z, h) => {
    if (!carve) return h;
    stream.closest(x, z, q);
    if (q.d < 3.2) {
      const target = bedAt(q.t);
      const w = smoothstep(0.8, 3.3, q.d);
      h = Math.min(h, THREE.MathUtils.lerp(target, h, w));
    }
    // The splash pool: a round basin a little deeper than the creek.
    const dp = Math.hypot(x - pool.x, z - pool.z);
    if (dp < POOL_R + 1.4) h = Math.min(h, THREE.MathUtils.lerp(bed[0] - 0.25, h, smoothstep(POOL_R - 1.2, POOL_R + 1.4, dp)));
    return h;
  });
  carve = true;
  const gravel = new THREE.Color(0.1, 0.085, 0.065);
  const duff = new THREE.Color(0.12, 0.08, 0.05);
  stack.colorFns.push((x, z, h, col) => {
    stream.closest(x, z, q);
    const dp = Math.hypot(x - pool.x, z - pool.z);
    const wet = Math.max(q.d < 3.0 ? 1 - smoothstep(1.2, 3.0, q.d) : 0, 1 - smoothstep(POOL_R - 0.5, POOL_R + 1.6, dp));
    if (wet > 0) col.lerp(gravel, wet);
    // Needle litter round the sequoia (its roots reach ~5.5 m).
    const dt = Math.hypot(x - tree.x, z - tree.z);
    if (dt < 9) col.lerp(duff, (1 - smoothstep(5, 9, dt)) * 0.75);
  });

  const collider = new ColliderBuilder('rocks');
  const batcher = new Batcher();
  stack.build(collider);

  // ---- The tor (the creek's source) and the rock piles along the edge ----
  // Climbing faces is stopped by vertical walls round each mound, not by the rock mesh.
  const tor = buildTor(stack, { x: torC.x, z: torC.z, radius: TOR.radius, height: TOR.height, seed: cfg.seed * 3, spillAngle: TOR.spill, batcher });
  const piles = PILES.map((p) => {
    const th = THREE.MathUtils.degToRad(p.deg);
    const rr = stack.edgeR(th) - p.radius - 2.5;
    return buildRockPile(stack, { x: cx + Math.cos(th) * rr, z: cz + Math.sin(th) * rr, radius: p.radius, height: p.height, seed: p.seed, batcher });
  });
  const rockWalls = [tor, ...piles].flatMap((m) => m.walls);
  for (const w of rockWalls) ctx.physics.addCircle({ ...w, zone: 'surface' });
  const onRock = (x, z) => tor.footprint(x, z) || piles.some((p) => p.footprint(x, z));
  // The Tower stack and its elevator's two stops below, pecked into a pile's stone (a fixed one: the boulders are
  // kept off the piles).
  carvePetroglyph(ctx, {
    geos: piles[GLYPH.pile].geos, at: new THREE.Vector3(cx + GLYPH.at[0], GLYPH.at[1], cz + GLYPH.at[2]),
    normal: new THREE.Vector3(...GLYPH.normal), lift: GLYPH.lift,
  });

  // ---- Water ----
  // Creek surface just above the bed; wide across the pool.
  const pts = [], widths = [];
  // Farthest the ground stays under water (by 2 cm) either side of p, stepping out from the centreline.
  const wetReach = (p, wy) => {
    const len = Math.hypot(p.dx, p.dz) || 1;
    let wet = 0;
    for (const sgn of [-1, 1]) {
      for (let o = 0.1; o < 5; o += 0.1) {
        const g = stack.heightAt(p.x - (p.dz / len) * o * sgn, p.z + (p.dx / len) * o * sgn);
        if (g === null || g >= wy - 0.02) break;
        wet = Math.max(wet, o);
      }
    }
    return wet;
  };
  for (let t = 0; t <= stream.total - 1.5; t += 0.6) {
    const p = stream.pointAt(t);
    const wy = bedAt(t) + 0.34;
    pts.push(new THREE.Vector3(p.x, wy, p.z));
    let w = 4.2 + Math.sin(t * 0.7) * 0.4 + (1 - smoothstep(3, POOL_T + 0.5, t)) * 3.6;
    // Round the pool's drain the carved basin is wider than that: reach the wet ground on both sides.
    if (t < POOL_T + 4) w = Math.max(w, 2 * (wetReach(p, wy) + 0.25));
    widths.push(w);
  }
  // Over the lip: the fall carries on from the creek's last point.
  const lip = pts[pts.length - 1];
  const fall = edgeWaterfall(stack, { theta: fallTheta, lip, width: 3.4, speed: 2.8, drop: 175 });
  ctx.surface.add(fall);
  const depthAt = (x, z, wy) => wy - (stack.heightAt(x, z) ?? wy);
  // Faster water in the last stretch before the fall, and where the cascade churns the pool.
  const speedAt = (u) => smoothstep(0.72, 1, u) * 0.9 + (1 - smoothstep(0, 0.06, u)) * 0.5 + Math.max(0, Math.sin(u * 23)) * 0.15;
  const water = new THREE.Mesh(streamGeometry(pts, widths, depthAt, { speedAt }), createStreamMaterial(Textures.water()));
  water.renderOrder = 3;
  ctx.surface.add(water);
  // Refracting water makes three.js render the whole scene a second time whenever it is in view, even from
  // another stack. Beyond ~110 m a plain glossy surface looks the same, so swap it in there.
  const glossy = patchMaterial(new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.16, 0.3, 0.28), roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2,
    transparent: true, opacity: 0.88, depthWrite: false,
  }));
  {
    const near = water.material;
    water.geometry.computeBoundingSphere();
    const c = water.geometry.boundingSphere.center.clone();
    const r = water.geometry.boundingSphere.radius;
    ctx.updaters.push(() => {
      const d = ctx.player ? ctx.player.feet.distanceTo(c) - r : 0;
      water.material = d < 90 ? near : glossy;
    });
  }
  // The spring on top of the tor: only the telescope ever sees it, so the cheap surface will do.
  {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(tor.poolRadius, 24).rotateX(-Math.PI / 2), glossy);
    disc.position.copy(tor.top);
    disc.renderOrder = 3;
    ctx.surface.add(disc);
    ctx.lod.add(disc, { out: [140, 180], fade: false, name: 'spring' });
  }
  // The cascade down the tor's face, and its splash, foam, spray and mist. The ribbon stops just under the pool's
  // surface: the water doesn't hide what is below it.
  const casc = tor.cascade.slice(), cascW = tor.cascadeWidths.slice(0, casc.length);
  {
    const cut = waterY - 0.08, k = casc.findIndex((p) => p.y < cut);
    if (k > 0) {
      const f = (casc[k - 1].y - cut) / (casc[k - 1].y - casc[k].y);
      casc.splice(k, Infinity, casc[k - 1].clone().lerp(casc[k], f));
      cascW.splice(k, Infinity, THREE.MathUtils.lerp(cascW[k - 1], cascW[k], f));
    }
  }
  const cascade = cascadeMesh(casc, cascW, { outward: spill });
  ctx.surface.add(cascade);
  ctx.lod.add(cascade, { out: [220, 280], fade: false, name: 'cascade' });
  const splashAt = tor.splash.clone().setY(waterY);
  // The chute face stands about 0.5 m behind the impact point (the tor's foot is at radius + 0.2).
  const face = { wallNormal: spill, wallDist: 0.5, wallTop: tor.top.y + 1 - waterY };
  const fx = [
    splashFX({ pos: splashAt, radius: 1.6, strength: 1, ...face }),
    mistFX({ pos: splashAt, radius: 3, height: 7, count: 80, drift: spill.clone().multiplyScalar(0.25), chute: tor.cascade, ...face }),
    // Kept over the basin and in front of the rock, which sits ~1.8 m behind the pool's centre.
    hazeFX({ pos: pool.clone().setY(waterY + 0.5), radius: POOL_R + 1.4, height: 2.2, count: 18, wallNormal: spill, wallDist: 1.8, wallTop: tor.top.y + 0.5 - waterY }),
    poolFoamFX({ pos: pool.clone().setY(waterY), radius: POOL_R - 0.2, impact: splashAt, ...face }),
  ];
  for (const m of fx) { ctx.surface.add(m); ctx.lod.add(m, { out: [110, 150], fade: false, name: 'cascade fx' }); }
  // Spray and mist all the way down the edge fall (a landmark from the other stacks, so never culled by distance).
  ctx.surface.add(fallSprayFX({ path: fall.userData.path, widths: fall.userData.widths, count: 400, normal: new THREE.Vector3(Math.cos(fallTheta), 0, Math.sin(fallTheta)) }));

  ctx.audio?.registerEmitter?.('cascade', splashAt.clone().setY(waterY + 1.5), 'surface');
  ctx.audio?.registerEmitter?.('stream', pts[Math.floor(pts.length * 0.3)].clone(), 'surface');
  ctx.audio?.registerEmitter?.('stream', pts[Math.floor(pts.length * 0.75)].clone(), 'surface');
  ctx.audio?.registerEmitter?.('waterfall', fall.userData.path[Math.min(8, fall.userData.path.length - 1)].clone(), 'surface');
  // Frogs on the banks at the water line, clear of the splash pool and the fast water before the lip; each
  // call comes from one of these spots (see the 'frogs' emitter in audio/engine.js).
  {
    const fr = new Rng(cfg.seed * 17);
    const spots = [];
    for (let t = POOL_T + 2; t < stream.total * 0.72; t += fr.float(4, 7)) {
      const p = stream.pointAt(t), len = Math.hypot(p.dx, p.dz) || 1;
      const o = (fr.next() < 0.5 ? -1 : 1) * fr.float(2.0, 2.8);
      const x = p.x - (p.dz / len) * o, z = p.z + (p.dx / len) * o;
      const wy = bedAt(t) + 0.34;
      spots.push(new THREE.Vector3(x, Math.max(stack.heightAt(x, z) ?? wy, wy) + 0.05, z));
    }
    if (spots.length) {
      const c = spots.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / spots.length);
      ctx.audio?.registerEmitter?.('frogs', c, 'surface', { spots });
    }
  }

  // Stepping stones in the stream, and gravel on the bed to see through the water.
  const rng = new Rng(cfg.seed * 5);
  for (let t = 0.5; t < stream.total - 2; t += 0.35) {
    const p = stream.pointAt(t);
    const len = Math.hypot(p.dx, p.dz) || 1;
    const o = rng.float(-1.1, 1.1);
    const x = p.x - (p.dz / len) * o, z = p.z + (p.dx / len) * o;
    const y = stack.heightAt(x, z);
    if (y !== null && !onRock(x, z)) ctx.pebbles.addAt(x, y + 0.02, z, rng.float(0.05, 0.16), ctx.pebbles.geometries[rng.int(0, 2)]);
  }
  for (let t = POOL_T; t < stream.total - 6; t += rng.float(3, 7)) {
    const p = stream.pointAt(t);
    const g = ctx.pebbles.geometries[rng.int(0, ctx.pebbles.geometries.length - 1)];
    const s = rng.float(0.25, 0.45);
    // Off to one side or the other, 45-95 % of the way to where that bank leaves the water, sitting on the bed there:
    // a line of them down the middle read as a trail to follow. (The same draws as before: side and spread from one,
    // a little drift along the stream from the other, so nothing after them moves.)
    const u = rng.float(-0.4, 0.4), drift = rng.float(-0.4, 0.4);
    const len = Math.hypot(p.dx, p.dz) || 1, nx = -p.dz / len, nz = p.dx / len;
    const sgn = u < 0 ? -1 : 1, wy = bedAt(t) + 0.34;
    let reach = 0.3;
    for (let o = 0.1; o < 4; o += 0.1) {
      const gy = stack.heightAt(p.x + nx * o * sgn, p.z + nz * o * sgn);
      if (gy === null || gy >= wy - 0.06) break;
      reach = o;
    }
    const off = sgn * reach * (0.45 + 0.5 * Math.abs(u) / 0.4);
    const x = p.x + nx * off + (p.dx / len) * drift, z = p.z + nz * off + (p.dz / len) * drift;
    if (!onRock(x, z)) ctx.pebbles.addAt(x, (stack.heightAt(x, z) ?? bedAt(t)) + 0.18, z, s, g);
  }

  // The stones leading to the carving (CLUE_STONES), from their own stream, so nothing else moves.
  {
    const r2 = new Rng(cfg.seed * 31);
    for (const [lx, lz] of CLUE_STONES) {
      const x = cx + lx + r2.float(-0.3, 0.3), z = cz + lz + r2.float(-0.3, 0.3);
      const s = r2.float(0.28, 0.4), geo = ctx.pebbles.geometries[r2.int(0, 1)], ry = r2.float(0, 6.28);
      const y = stack.heightAt(x, z);
      if (y !== null && !onRock(x, z)) ctx.pebbles.addAt(x, y + 0.05, z, s, geo, ry);
    }
  }

  // ---- The sequoia the elevator comes out of ----
  const doorDir = new THREE.Vector3(tree.x - cx, 0, tree.z - cz).normalize();
  const seq = buildSequoia(ctx, { x: tree.x, y: treeY, z: tree.z, doorDir, batcher, collider });
  tree.r = seq.footprintR + 0.5;
  const nearTree = (x, z, pad) => Math.hypot(x - tree.x, z - tree.z) < seq.footprintR + pad;

  // ---- Bridge to End ----
  const e = STACKS.end;
  const bdir = new THREE.Vector3(e.bridgeDir.x, 0, e.bridgeDir.z);
  const thB = Math.atan2(bdir.z, bdir.x);
  const aR = stack.edgeR(thB) - 1.6;
  const ax = cx + bdir.x * aR, az = cz + bdir.z * aR;
  const bridgeA = new THREE.Vector3(ax, (stack.heightAt(ax, az) ?? stack.heightAtAnalytic(ax, az)) + 0.05, az);
  ctx.bridgeA = bridgeA;

  // ---- Movable rocks ----
  const spots = [
    { ...xz(L(-2, -14)), r: 1.15 }, { ...xz(L(14, 12)), r: 1.0 }, { ...xz(L(-22, -6)), r: 1.25 },
    { ...xz(L(-4, 24)), r: 0.95 }, { ...xz(L(24, -22)), r: 1.1 },
  ];
  createMovableRocks(ctx, stack, spots, {
    blockers: [tree, tor.blocker, ...piles.map((p) => p.blocker), { x: pool.x, z: pool.z, r: POOL_R }],
    targets: ROCK_TARGETS.map((t) => xz(L(t.x, t.z))),
  });

  // ---- Vegetation, flowers & stones ----
  const clear = (x, z) => {
    stream.closest(x, z, q);
    if (q.d < 3.2 || Math.hypot(x - pool.x, z - pool.z) < POOL_R + 1.5) return false;
    if (nearTree(x, z, 2) || onRock(x, z)) return false;
    for (const s of spots) if (Math.hypot(x - s.x, z - s.z) < s.r + 2) return false;
    const bx = x - bridgeA.x, bz = z - bridgeA.z;
    if (Math.hypot(bx, bz) < 12) return false;
    return true;
  };
  // Trees keep their crowns (3-4 m out) off the tor and the piles too, not just their trunks.
  const treeOk = (x, z) => clear(x, z) && !rockWalls.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 4);
  for (const p of scatter(stack, 24, rng, treeOk, { margin: 4 })) {
    const sp = rng.next() < 0.7 ? 'broadleaf' : 'pine';
    const s = rng.float(0.8, 1.25);
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 30, rng, clear, { margin: 2 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.6, 1.2));
  const grassOk = (x, z) => {
    stream.closest(x, z, q);
    return q.d > 2.5 && Math.hypot(x - pool.x, z - pool.z) > POOL_R + 0.8 && !nearTree(x, z, 0.3) && !onRock(x, z);
  };
  for (const p of scatter(stack, 3200, rng, grassOk, { margin: 1.2, tries: 3 })) ctx.meadow.add(p.x, p.y, p.z, rng.float(0.7, 1.2));
  ctx.pebbles.scatter(stack, 170, rng, (x, z) => { stream.closest(x, z, q); return q.d > 2.4 && !nearTree(x, z, 0.3) && !onRock(x, z); });
  // Wildflowers in drifts: a few kinds per patch, thinning out from the middle.
  const flowers = new Flowers(cfg.seed * 7);
  const flowerOk = (x, z) => clear(x, z) && stack.edgeDist(x, z) > 2.5;
  const frng = new Rng(cfg.seed * 29);
  for (let i = 0; i < 34; i++) {
    const a = frng.float(0, Math.PI * 2), d = Math.sqrt(frng.next()) * (cfg.r - 6);
    flowers.patch(stack, cx + Math.cos(a) * d, cz + Math.sin(a) * d, frng.float(2.5, 6), frng.int(10, 34), [frng.int(0, 3), frng.int(0, 3)], flowerOk, frng);
  }
  flowers.build(ctx.surface, ctx.lod);

  // Bridge (collision lives with this stack so it's active from both ends).
  ctx.buildBridgeLater = (bridgeB) => {
    const bb = new Batcher();
    buildBridge(ctx, { a: bridgeA, b: bridgeB, batcher: bb, collider });
    const bridge = bb.build(stack.group, { name: 'bridge' });
    ctx.physics.addCollider(collider.build(), 'surface');
    const props = batcher.build(stack.group, { name: 'rocks-props' });
    // From other stacks the props and the bridge are one merged stand-in (see render/lod.js).
    ctx.lod.addFarProxy([...props, ...bridge].filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'rocks-props' });
    ctx.surface.add(stack.group);
  };

  createElevator(ctx, {
    id: 'rocks',
    ends: {
      top: { pos: seq.platePos, rotY: seq.plateRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('rocks-car') },
      bottom: ctx.tunnelStation('rocks'),
    },
  });

  stack.torTop = tor.top.clone();   // the spring on the tor (the observatory's rear hatch is keyed to it)
  ctx.stacks.rocks = stack;
  ctx.streamPath = stream;
  return stack;
}

const xz = ([x, z]) => ({ x, z });
