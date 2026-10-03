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
import { createElevator } from '../../props/elevator.js';
import { createMovableRocks } from '../../props/movableRocks.js';
import { buildSequoia } from '../../props/sequoia.js';
import { carvePetroglyph } from '../../props/petroglyph.js';
import { buildWalkway } from '../walkway.js';
import { ROCK_TARGETS } from '../rockPuzzle.js';
import { createTorBlast } from '../torBlast.js';
import { createRockThrow } from '../rockThrow.js';
import { createTargetMarks } from '../rockTargets.js';
import { placeGatehouse } from '../../props/gatehouse.js';

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
// The carvings (props/petroglyph.js), a trail across the stack like a maze of sign posts, each pecked into a pile's
// stone and glowing a little: an arrow on the 205° pile (where the stepping stones lead; a pile drawn past its head) points across the stack to the
// 45° pile; an arrow there points on, across again, to the 305° pile; and there is the clue itself, the Tower and its
// elevator down to the lounge, with the Down button held for three counts. at: a point on the face (x, z from the
// stack's centre, y absolute); normal: roughly out of it; to: the carving its arrow points at.
const GLYPHS = [
  { name: 'petroglyph:arrow:1', kind: 'arrowPile', pile: 1, at: [-41.409, 5.974, -16.657], normal: [-0.831, 0.01, 0.556], lift: 0.04, to: 1 },
  { name: 'petroglyph:arrow:2', kind: 'arrow', pile: 0, at: [31.124, 6.94, 28.68], normal: [0.931, 0.104, -0.349], lift: 0, to: 2 },
  { name: 'petroglyph', kind: 'tower', pile: 3, at: [26.052, 5.946, -38.004], normal: [0.472, 0.195, -0.86], lift: 0.05 },
];
// The way to it: limestone stepping stones (world/walkway.js, as round the Home stack's dome) from the creek's bank, where
// it runs closest (about 3.5 m off its line), across the meadow and round the north side of that pile to the ground in
// front of the carving, with a faint trodden line under them. (Seven pebbles 3 m apart, starting 14 m from the creek,
// were too easy to miss: bug report 4d5c26b2.) Offsets from the stack's centre.
const CLUE_PATH = [[-20.4, 1.6], [-23.6, -2.7], [-27.5, -6.8], [-30.2, -8.1], [-33.1, -9.7], [-35.8, -11.1], [-38.2, -12.5], [-40.3, -13.6], [-42.6, -15.3]];

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
  const cluePath = Path.smooth(CLUE_PATH.map(([lx, lz]) => [cx + lx, cz + lz]), 0.5, 1.0);
  const qc = {};
  stack.colorFns.push((x, z, h, col) => {
    // The trodden line along the stepping stones to the carving.
    cluePath.closest(x, z, qc);
    if (qc.d < 1.2) col.lerp(new THREE.Color(0.2, 0.16, 0.11), (1 - smoothstep(0.3, 1.2, qc.d)) * 0.38);
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
  // Climbing faces is stopped by vertical walls round each mound, not by the rock mesh. The tor is drawn on its own (not
  // in the stack's props batch), as rocks.exe blows it apart (world/torBlast.js).
  const torBatch = new Batcher();
  const tor = buildTor(stack, { x: torC.x, z: torC.z, radius: TOR.radius, height: TOR.height, seed: cfg.seed * 3, spillAngle: TOR.spill, batcher: torBatch, sculpt: ctx.torSculpt });
  const piles = PILES.map((p) => {
    const th = THREE.MathUtils.degToRad(p.deg);
    const rr = stack.edgeR(th) - p.radius - 2.5;
    return buildRockPile(stack, { x: cx + Math.cos(th) * rr, z: cz + Math.sin(th) * rr, radius: p.radius, height: p.height, seed: p.seed, batcher });
  });
  const rockWalls = [tor, ...piles].flatMap((m) => m.walls);
  for (const w of rockWalls) ctx.physics.addCircle({ ...w, zone: 'surface' });
  const onRock = (x, z) => tor.footprint(x, z) || piles.some((p) => p.footprint(x, z));
  // The carvings, pecked into piles' stones (fixed ones: the boulders are kept off the piles); each arrow aims at the
  // next one's place.
  const glyphAt = (g) => new THREE.Vector3(cx + g.at[0], g.at[1], cz + g.at[2]);
  ctx.glyphs = GLYPHS.map((g) => carvePetroglyph(ctx, {
    geos: piles[g.pile].geos, at: glyphAt(g), normal: new THREE.Vector3(...g.normal), lift: g.lift,
    name: g.name, kind: g.kind, toward: g.to != null ? glyphAt(GLYPHS[g.to]) : null,
  }));

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
    // (Measured from what is being looked at: the player, or the hidden camera's subject during a cutscene.)
    ctx.updaters.push(() => {
      const f = ctx.viewFocus ?? ctx.player?.feet;
      const d = f ? f.distanceTo(c) - r : 0;
      water.material = d < 90 ? near : glossy;
    });
  }
  // The tor's own water (the spring, its fall and the fall's splash, spray and mist) in groups the blast can switch off
  // (world/torBlast.js: the LOD sets each mesh's own visibility).
  const torWater = new THREE.Group(), spring = new THREE.Group();
  torWater.name = 'tor-water'; spring.name = 'tor-spring';
  torWater.add(spring);
  ctx.surface.add(torWater);
  // The spring on top of the tor: only the telescope ever sees it, so the cheap surface will do.
  {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(tor.poolRadius, 24).rotateX(-Math.PI / 2), glossy);
    disc.position.copy(tor.top);
    disc.renderOrder = 3;
    spring.add(disc);
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
  torWater.add(cascade);
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
  for (const m of fx) { torWater.add(m); ctx.lod.add(m, { out: [110, 150], fade: false, name: 'cascade fx' }); }
  // Spray and mist all the way down the edge fall (a landmark from the other stacks, so never culled by distance).
  ctx.surface.add(fallSprayFX({ path: fall.userData.path, widths: fall.userData.widths, count: 400, normal: new THREE.Vector3(Math.cos(fallTheta), 0, Math.sin(fallTheta)) }));

  const cascadeSound = ctx.audio?.registerEmitter?.('cascade', splashAt.clone().setY(waterY + 1.5), 'surface');
  // The blast: the tor's own meshes (intact; the stump and its debris), the explosion and the water stopping.
  const blast = tor.sculpted ? ctx.torSculpt?.blast ?? null : null;
  const torBlast = createTorBlast(ctx, stack, {
    tor, batch: torBatch, blast, parent: stack.group,
    water: { group: torWater, spring, cascade, fx, emitter: cascadeSound },
  });
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

  // The stepping stones to the carving (CLUE_PATH), their own random stream (so nothing else moves); none on the rock or
  // in the creek.
  const clueWalk = buildWalkway(stack, cluePath, batcher, ctx.walkstoneAsset, {
    seed: 23, fade: 2.5,
    skip: (x, z) => { stream.closest(x, z, qc); return qc.d < 2.6 || onRock(x, z); },
  });

  // ---- The sequoia the elevator comes out of ----
  const doorDir = new THREE.Vector3(tree.x - cx, 0, tree.z - cz).normalize();
  const seq = buildSequoia(ctx, { x: tree.x, y: treeY, z: tree.z, doorDir, batcher, collider });
  tree.r = seq.footprintR + 0.5;
  const nearTree = (x, z, pad) => Math.hypot(x - tree.x, z - tree.z) < seq.footprintR + pad;

  // ---- Where the bridge to End used to start: the gatehouse's anchor (props/gatehouse.js), and a point other code
  // keeps things off (the boulders' landings, the scatter below) ----
  const e = STACKS.end;
  const bdir = new THREE.Vector3(e.bridgeDir.x, 0, e.bridgeDir.z);
  const thB = Math.atan2(bdir.z, bdir.x);
  const aR = stack.edgeR(thB) - 1.6;
  const ax = cx + bdir.x * aR, az = cz + bdir.z * aR;
  const bridgeA = new THREE.Vector3(ax, (stack.heightAt(ax, az) ?? stack.heightAtAnalytic(ax, az)) + 0.05, az);
  ctx.bridgeA = bridgeA;

  // ---- Movable rocks ----
  // Where the boulders first stood (the scatter below still keeps its trees, shrubs and flowers off these, so nothing
  // else moved when one was moved).
  const spots0 = [
    { ...xz(L(-2, -14)), r: 1.15 }, { ...xz(L(14, 12)), r: 1.0 }, { ...xz(L(-22, -6)), r: 1.25 },
    { ...xz(L(-4, 24)), r: 0.95 }, { ...xz(L(24, -22)), r: 1.1 },
  ];
  // (The boulders now start dormant and are only ever seen where rocks.exe throws them; these spots, the old doorstop in
  // the sequoia's doorway among them, are kept so the colliders and the world's random streams stay as they were.)
  const doorOut = new THREE.Vector3(Math.sin(seq.plateRot), 0, Math.cos(seq.plateRot));
  const DOORSTOP = 3, DOORSTOP_GAP = 0.3;
  const spots = spots0.map((s, i) => (i === DOORSTOP
    ? { x: seq.platePos.x + doorOut.x * (DOORSTOP_GAP + s.r), z: seq.platePos.z + doorOut.z * (DOORSTOP_GAP + s.r), r: s.r }
    : s));
  // (They stay here, dormant, until rocks.exe throws them out of the tor: props/movableRocks.js, world/rockThrow.js.)
  createMovableRocks(ctx, stack, spots, {
    blockers: [tree, tor.blocker, ...piles.map((p) => p.blocker), { x: pool.x, z: pool.z, r: POOL_R }],
    targets: ROCK_TARGETS.map((t) => xz(L(t.x, t.z))),
    geos: blast?.boulders.length === spots.length ? blast.boulders : null,
  });

  // ---- Vegetation, flowers & stones ----
  const clear = (x, z) => {
    stream.closest(x, z, q);
    if (q.d < 3.2 || Math.hypot(x - pool.x, z - pool.z) < POOL_R + 1.5) return false;
    if (nearTree(x, z, 2) || onRock(x, z)) return false;
    for (const s of spots0) if (Math.hypot(x - s.x, z - s.z) < s.r + 2) return false;
    const bx = x - bridgeA.x, bz = z - bridgeA.z;
    if (Math.hypot(bx, bz) < 12) return false;
    return true;
  };
  // Trees keep their crowns (3-4 m out) off the tor and the piles too, not just their trunks.
  const treeOk = (x, z) => clear(x, z) && !rockWalls.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 4);
  const flora = { trees: [], shrubs: [] };   // (where the thrown boulders may land: world/rockThrow.js)
  for (const p of scatter(stack, 24, rng, treeOk, { margin: 4 })) {
    const sp = rng.next() < 0.7 ? 'broadleaf' : 'pine';
    const s = rng.float(0.8, 1.25);
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
    flora.trees.push({ x: p.x, y: p.y, z: p.z, s });
  }
  for (const p of scatter(stack, 30, rng, clear, { margin: 2 })) {
    const s = rng.float(0.6, 1.2);
    ctx.forest.add('shrub', p.x, p.y, p.z, s);
    flora.shrubs.push({ x: p.x, y: p.y, z: p.z, s });
  }
  const grassOk = (x, z) => {
    stream.closest(x, z, q);
    return q.d > 2.5 && Math.hypot(x - pool.x, z - pool.z) > POOL_R + 0.8 && !nearTree(x, z, 0.3) && !onRock(x, z);
  };
  // (Off the stepping stones after the draws, so nothing else moves: a tuft on a stone is added at scale 0, which keeps
  // the meadow's per-tuft random draws in step on every stack.)
  for (const p of scatter(stack, 3200, rng, grassOk, { margin: 1.2, tries: 3 })) {
    const s = rng.float(0.7, 1.2);
    ctx.meadow.add(p.x, p.y, p.z, clueWalk.on(p.x, p.z, -0.06) ? 0 : s);
  }
  ctx.pebbles.scatter(stack, 170, rng, (x, z) => { stream.closest(x, z, q); return q.d > 2.4 && !nearTree(x, z, 0.3) && !onRock(x, z); }, (x, z) => !clueWalk.on(x, z, 0.15));
  // Wildflowers in drifts: a few kinds per patch, thinning out from the middle.
  const flowers = new Flowers(cfg.seed * 7);
  const flowerOk = (x, z) => clear(x, z) && stack.edgeDist(x, z) > 2.5;
  const frng = new Rng(cfg.seed * 29);
  for (let i = 0; i < 34; i++) {
    const a = frng.float(0, Math.PI * 2), d = Math.sqrt(frng.next()) * (cfg.r - 6);
    flowers.patch(stack, cx + Math.cos(a) * d, cz + Math.sin(a) * d, frng.float(2.5, 6), frng.int(10, 34), [frng.int(0, 3), frng.int(0, 3)], flowerOk, frng);
  }
  // (None on the stepping stones: dropped to scale 0 after the draws, as the grass.)
  for (const list of flowers.items) for (let i = 0; i < list.length; i += 4) if (clueWalk.on(list[i], list[i + 2], 0.05)) list[i + 3] = 0;
  flowers.build(ctx.surface, ctx.lod);

  // Finished once End knows its landing (end.js): this stack's collider, its props and their far stand-in, and the
  // gatehouse at the rim on the heading to that landing, with the staircase it lets down to it (there is no bridge: the
  // gap is uncrossable until the Rocks puzzle opens it; sequences/stairsReveal.js). The gatehouse is its own prop with
  // its own colliders, so this stack's collider is as it was without the bridge.
  ctx.buildBridgeLater = (bridgeB) => {
    ctx.bridgeB = bridgeB;
    ctx.physics.addCollider(collider.build(), 'surface');
    const props = batcher.build(stack.group, { name: 'rocks-props' });
    // From other stacks the props are one merged stand-in (see render/lod.js).
    ctx.lod.addFarProxy(props.filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'rocks-props' });
    ctx.surface.add(stack.group);
    if (ctx.gatehouseAsset) placeGatehouse(ctx, ctx.gatehouseAsset, { a: bridgeA, b: bridgeB, stack });
  };

  createElevator(ctx, {
    id: 'rocks',
    start: 'bottom',   // waiting on the cave floor (only the Home stack's waits up top, by the cabin)
    ends: {
      top: { pos: seq.platePos, rotY: seq.plateRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('rocks-car') },
      bottom: ctx.tunnelStation('rocks'),
    },
  });

  // Where the thrown boulders land, and their flights (props/movableRocks.js has the push).
  createRockThrow(ctx, stack, {
    flora, stream, bridgeA, platePos: seq.platePos, stones: clueWalk.stones, tree: { x: tree.x, y: treeY, z: tree.z }, torC,
    stump: { footprint: tor.footprint, top: torBlast.stumpTop }, launch: torBlast.launch,
    piles: piles.map((p) => ({ blocker: p.blocker, top: Math.max(...p.walls.map((w) => w.y1)) - 1 })),
  });
  // Bare earth on each target once the blast has thrown the boulders out (world/rockTargets.js): fading in as the dust
  // settles after a throw, there at once when a saved game puts them out.
  const marks = createTargetMarks(ctx, stack, ctx.boulders.targets);
  const { launch: throwRocks, releaseInstant } = ctx.boulders;
  ctx.boulders.launch = (o = {}) => { const f = throwRocks(o); marks.reveal({ delay: (o.t0 ?? 0) + 1.2 }); return f; };
  ctx.boulders.releaseInstant = (...a) => { const r = releaseInstant(...a); marks.reveal({ instant: true }); return r; };
  ctx.boulders.marks = marks;
  // The hidden camera ("CAM 07", sequences/rocksExe.js) strapped to the sequoia's bark facing the tor, a little above
  // its door. pos: the lens; look: where it points; mount: its bracket on the bark (the housing's own frame, the
  // bunker kit's cctv layer, puts the bracket 0.476 m behind the lens and 0.05 m below it).
  stack.hiddenCam = hiddenCam(seq, tree, treeY, torC.clone().setY(tor.frame.g0 + 6.1));

  stack.torTop = tor.top.clone();   // the spring on the tor (the observatory's rear hatch is keyed to it)
  ctx.stacks.rocks = stack;
  ctx.streamPath = stream;
  return stack;
}

const xz = ([x, z]) => ({ x, z });

// The lens `up` m up the trunk on the side facing `look`, and the bracket on the bark behind it.
function hiddenCam(seq, tree, treeY, look, { up = 12, fov = 72 } = {}) {
  const MOUNT = new THREE.Vector3(0, -0.05, -0.476);   // bracket, in the lens's frame (+z out of the lens)
  const d = new THREE.Vector3(look.x - tree.x, 0, look.z - tree.z).normalize();
  let b = seq.barkAt(d.x, d.z, treeY + up);
  const pos = b.pos.clone().addScaledVector(b.normal, 0.48).setY(treeY + up);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), w = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    // Turn a +z-forward housing to look at `look`, then move the lens so its bracket sits on the bark.
    m.lookAt(look, pos, new THREE.Vector3(0, 1, 0));
    q.setFromRotationMatrix(m);
    w.copy(MOUNT).applyQuaternion(q).add(pos);
    b = seq.barkAt(w.x - tree.x, w.z - tree.z, w.y);
    pos.add(b.pos.clone().addScaledVector(b.normal, 0.01).sub(w));
  }
  return { pos, look: look.clone(), fov, mount: { pos: b.pos.clone(), normal: b.normal.clone() } };
}
