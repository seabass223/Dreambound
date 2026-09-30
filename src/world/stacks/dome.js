import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS, WALLS } from '../../config.js';
import { Rng, smoothstep, noise2 } from '../../core/rng.js';
import { materials } from '../../render/materials.js';
import { Stack, capRelief, RELIEF_SEED } from '../terrain.js';
import { Batcher, ColliderBuilder, mat4 } from '../builders.js';
import { Path } from '../paths.js';
import { buildLadder, buildTrail, scatter } from '../features.js';
import { buildWalkway } from '../walkway.js';
import { buildCliffPath } from '../cliffPath.js';
import { buildCliffCave, caveWindow } from '../cliffCave.js';
import { createElevator } from '../../props/elevator.js';
import { placeCabin, PROBE_LAYER } from '../../props/cabin.js';
import { placeDeck } from '../../props/deck.js';

const DOME_R = 14; // must match R_DOME in tools/blender/cabin_design.py
const TAU = Math.PI * 2;
const LADDER_THETA = -Math.PI / 2;     // south
// The ledge runs west from the ladder foot to the cave: about 55 m of walking (it once went half way round, ~180 m).
const LEDGE_ARC = 0.9;
const CAVE_THETA = LADDER_THETA - LEDGE_ARC;   // the cave's mouth, in the cliff at the path's end (world/cliffCave.js)
const LEDGE_START_DEPTH = 6.1;         // 20 ft below the lip
const LEDGE_END_DEPTH = 10.5;          // a 4.4 m drop keeps the short ledge's ramp gentle (8 degrees at most)
// The wall relief (WALLS.geo) keeps off the ladder, the ledge, the cave hood and the elevator (south round to
// west-southwest): exactly 0 over this arc down to 22 m, back to full over 12 m of arc and depth.
const WALL_PROTECT = [{ from: CAVE_THETA + TAU - 0.35, to: Math.PI * 1.5 + 0.3, depth: 22, feather: 12 }];
// The view deck (props/deck.js, tools/blender/deck_design.py): on the west-northwest rim, 6.5 m in from the edge, facing
// out over the cloud sea toward the Rocks (heading 156 deg from here, with the End beyond at 143) and the sunset
// (about 180 deg): `heading` is the view's direction in the xz plane (atan2(z, x), degrees). The ground under it is
// levelled to `ground` (it slopes about 0.35 m across the footprint), fading back into the terrain over 2.2 m.
const DECK = { x: -16.46, z: 48.99, ground: -0.8, heading: 152, w: 3.0, d: 2.4, step: 0.34 };
DECK.rotY = Math.atan2(Math.cos(DECK.heading * Math.PI / 180), Math.sin(DECK.heading * Math.PI / 180));
// Deck-local (x across, z toward the view) of a world point, and how far outside the footprint (with its step) it is.
const deckLocal = (x, z) => {
  const dx = x - DECK.x, dz = z - DECK.z, c = Math.cos(DECK.rotY), s = Math.sin(DECK.rotY);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};
const deckOutside = (x, z) => {
  const l = deckLocal(x, z);
  const ox = Math.max(0, Math.abs(l.x) - DECK.w / 2), oz = Math.max(0, -DECK.d / 2 - DECK.step - l.z, l.z - DECK.d / 2);
  return Math.hypot(ox, oz);
};
// No trees or shrubs on or round the deck (2.5 m) or in the view from it: a wedge out to the rim, 22 degrees to the
// left of straight out and 42 to the right, where the sun goes down (local +x is to the left as you face the view).
const deckKeepsTrees = (x, z) => {
  if (deckOutside(x, z) < 2.5) return true;
  const l = deckLocal(x, z);
  return l.z > 0 && l.x < DECK.w / 2 + 0.5 + l.z * Math.tan(22 * Math.PI / 180) && l.x > -DECK.w / 2 - 0.5 - l.z * Math.tan(42 * Math.PI / 180);
};

export function buildDome(ctx) {
  const cfg = STACKS.dome;
  const stack = new Stack(cfg, {
    // Calm legacy wall over the west half (-78° round to +78°), to 28 m down: under the ladder, the ledge and the
    // cave (-85° to -152°). Kept on the north-west, where the long ledge ran: uncalmed there, the wall grows strata
    // shelves under the rim that slow walk-offs land on (tools/regress R6).
    cliffCalm: (th, depth) => (Math.cos(th) < 0.2 && depth < 28 ? 0.25 : 1),
    protect: WALL_PROTECT,
    // The cave's mouth: a window cut out of the cliff, filled by buildCliffCave below.
    openings: [caveWindow(Math.round(cfg.r * 2.6), CAVE_THETA)],
  });
  const cx = cfg.x, cz = cfg.z;

  // Trail from the dome door to the ladder at the south lip.
  const ladderEdge = stack.edgeR(LADDER_THETA);
  const trail = Path.smooth([
    [cx, cz - DOME_R - 1.0], [cx + 1.4, cz - 19.5], [cx - 2.8, cz - 28], [cx + 1.8, cz - 39], [cx + 0.4, cz - ladderEdge + 1.2],
  ], 1.5, 1.4);
  // A faint worn track, no strip, only the ground's colour and thinner grass, from the dirt round the dome's foot (on
  // the side facing the view deck) out to the deck, winding between the trees that were already there (so the forest
  // and every other placement stay put).
  const deckTrack = Path.smooth([
    [cx - 4.13, cz + 14.63], [cx - 5.4, cz + 18.5], [cx - 7.7, cz + 23.2], [cx - 9.2, cz + 30.8], [cx - 10.1, cz + 36.0],
    [cx - 10.3, cz + 40.6], [cx - 12.0, cz + 45.5], [cx - 14.04, cz + 49.79],
  ], 1.5, 1.4);
  // Limestone stepping stones out front (world/walkway.js): off the trail just outside the dome door, left (west) round
  // the dome in the clear ring the trees leave it, running out into the start of the deck track. About 16 m out, and
  // drawn in toward the dome (to about 15.3) past the three pines whose low boughs reach over the ring on the west side
  // (at -130, -168 and 169 degrees), so the way goes round under the glass instead of through their branches.
  const walk = Path.smooth([
    [cx - 0.8, cz - 15.6],
    ...[[-100, 16.35], [-118, 15.75], [-138, 15.35], [-158, 15.3], [-178, 15.25], [162, 15.3], [143, 15.7], [125, 16.4], [111, 16.0]].map(([deg, r]) => {
      const a = (deg * Math.PI) / 180;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    }),
    [cx - 4.75, cz + 16.53],
  ], 0.5, 1.1);
  const qt = {}, qw = {};
  // How worn the ground is at (x, z): 0 off the track, up to 1 on its centre line, easing in over its first and last
  // metres (it begins in the dirt ring and ends at the deck's back step).
  const worn = (x, z) => {
    deckTrack.closest(x, z, qt);
    if (!(qt.d < 1.8)) return 0;
    return (1 - smoothstep(0.3, 1.8, qt.d)) * smoothstep(0, 2.5, qt.t) * smoothstep(0, 1.5, deckTrack.total - qt.t);
  };
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
  // Level ground under the view deck (0.3 m round it), easing back into the slope over 2.2 m.
  stack.shapeFns.push((x, z, h) => {
    const d = deckOutside(x - cx, z - cz);
    return d > 2.5 ? h : THREE.MathUtils.lerp(h, cfg.top + DECK.ground, 1 - smoothstep(0.3, 2.5, d));
  });
  stack.colorFns.push((x, z, h, col) => {
    trail.closest(x, z, q);
    if (q.d < 2.2) col.lerp(new THREE.Color(0.17, 0.13, 0.09), (1 - smoothstep(0.6, 2.2, q.d)) * 0.8);
    const d = Math.hypot(x - cx, z - cz);
    if (Math.abs(d - DOME_R) < 1.3) col.lerp(new THREE.Color(0.14, 0.12, 0.09), 0.5);
    const w = worn(x, z);
    if (w > 0) col.lerp(new THREE.Color(0.23, 0.18, 0.12), w * 0.55);
    // A faint trodden line along the stepping stones, as along the deck track it joins.
    walk.closest(x, z, qw);
    if (qw.d < 1.3) col.lerp(new THREE.Color(0.23, 0.18, 0.12), (1 - smoothstep(0.3, 1.3, qw.d)) * 0.28);
  });

  const collider = new ColliderBuilder('dome');
  const batcher = new Batcher();
  stack.build(collider);

  buildTrail(stack, trail, batcher, { width: 1.25 });
  const walkway = buildWalkway(stack, walk, batcher, ctx.walkstoneAsset, { seed: 17, keepOff: { x: cx, z: cz, r: 15.0 } });   // (clear of the dome's curb)
  ctx.walkway = walkway;

  // ---- Geodesic glass dome with the cabin inside (modeled in Blender: tools/blender/build_cabin.py) ----
  ctx.house = placeCabin(ctx, ctx.cabinAsset, { origin: new THREE.Vector3(cx, cfg.top + 0.15, cz), collider });
  // Garden keep-outs, in dome-local coordinates: the cabin + porch, the flagstone path, planters, fire pit, curb.
  const inHouse = (x, z) => {
    const lx = x - cx, lz = z - cz;
    if (lx > -6.1 && lx < 8.4 && lz > -8.2 && lz < 5.6) return true;   // (the house sits 1.2 m along +x: HX in cabin_design.py)
    if (Math.abs(lx) > 1.5 && Math.abs(lx) < 3.95 && lz > -10.15 && lz < -8.45) return true; // lavender planters
    if (Math.hypot(lx, lz - 9.3) < 2.9) return true; // fire pit + chairs
    if (Math.hypot(Math.abs(lx) - 3.8, lz - 12.3) < 0.5) return true; // festoon posts
    return false;
  };
  const onGardenPath = (x, z) => Math.abs(x - cx) < 1.4 && z - cz < -7.5;

  // ---- Ladder + ledge path running west to the cave ----
  const ledgeY = cfg.top - LEDGE_START_DEPTH;
  const samples = [];
  // The path runs on 3 m past the cave's mouth (it turns in off the path) and is level for the last 4 m before it.
  const Rm = stack.edgeR(CAVE_THETA);
  const toMouth = LADDER_THETA + 0.09 - CAVE_THETA;
  const th0 = LADDER_THETA + 0.09, th1 = CAVE_THETA - 3.1 / Rm, span = th0 - th1;
  // Shaped in radians from the start (u): a landing at the ladder, samples ~2.6 m apart with a width wobble, and a
  // little more room where the path turns into the cave.
  const N = Math.round(span / 0.046);
  for (let i = 0; i <= N; i++) {
    const u = span * i / N;
    const depth = LEDGE_START_DEPTH + (LEDGE_END_DEPTH - LEDGE_START_DEPTH) * smoothstep(0.2, toMouth - 4 / Rm, u);
    const width = 3.1 + (1 - smoothstep(0, 0.226, u)) * 1.3 + smoothstep(toMouth - 0.2, toMouth - 0.04, u) * 0.7 + noise2(u * 2.785, 0, 4) * 0.25;
    samples.push({ theta: th0 - u, depth, width });
  }
  buildCliffPath(stack, samples, batcher, collider, { seed: 7 });

  const wallR = stack.cliffRadius(LADDER_THETA, 3, stack.edgeR(LADDER_THETA));
  const n = new THREE.Vector3(Math.cos(LADDER_THETA), 0, Math.sin(LADDER_THETA));
  const lipY = stack.heightAt(cx + n.x * (ladderEdge - 0.8), cz + n.z * (ladderEdge - 0.8));
  const base = new THREE.Vector3(cx + n.x * (wallR + 0.05), ledgeY, cz + n.z * (wallR + 0.05));
  buildLadder(ctx, { base, n, height: lipY - ledgeY, batcher });

  // ---- The cave: a mouth in the cliff at the path's end, the tunnel bending in from the path to the elevator ----
  // (Its floor 2 cm under the path's paving, which runs a little way into the mouth.)
  const cave = buildCliffCave(ctx, stack, {
    theta: CAVE_THETA, floorY: cfg.top - LEDGE_END_DEPTH - 0.02, window: stack.openings[0], travel: -1, batcher, collider, seed: 12,
  });
  // A small caged bulb above the elevator.
  addCaveBulb(ctx, cave.platePos, cave.plateRot, batcher);

  // ---- The view deck, its two chairs and lantern ----
  if (ctx.deckAsset) {
    ctx.deck = placeDeck(ctx, ctx.deckAsset, { pos: new THREE.Vector3(cx + DECK.x, cfg.top + DECK.ground, cz + DECK.z), rotY: DECK.rotY, parent: ctx.surface });
  }

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
  // No crown may touch the dome's glass: a sphere of DOME_R about a centre 2.4 m over the pad (tools/blender
  // cabin_design.py build_dome: curb 0.3 m + 0.15 R). Tested band by band against the crown's real reach, from the
  // side nearest the glass (outside) or furthest from it (inside), with 0.5 m to spare.
  const glassY = cfg.top + 0.15 + 0.3 + 0.15 * DOME_R;
  const clearOfGlass = (sp, x, y, z, s, inside) => {
    const d = Math.hypot(x - cx, z - cz);
    for (const b of ctx.forest.footprint(sp)) {
      const r = b.r * s;
      for (const h of [y - 0.1 + b.y0 * s, y - 0.1 + b.y1 * s]) {
        const dy = h - glassY;
        if (inside ? Math.hypot(d + r, Math.max(0, dy)) > DOME_R - 0.5 : Math.hypot(Math.max(0, d - r), dy) < DOME_R + 0.5) return false;
      }
    }
    return true;
  };
  // (The deck's keep-outs skip a placement only after its random draws, the forest's rotation included, so every
  // other one, on every stack, stays exactly where it was.)
  for (const p of scatter(stack, 120, rng, (x, z) => clear(x, z) && spawnClear(x, z), { margin: 3.5 })) {
    const sp = rng.next() < 0.62 ? 'pine' : 'broadleaf';
    let s = rng.float(0.75, 1.3);
    if (deckKeepsTrees(p.x - cx, p.z - cz)) { ctx.forest.rng.float(0, Math.PI * 2); continue; }   // (its rotation's draw)
    // Near the dome, a smaller tree where a big one's lower boughs would reach the glass, or none.
    while (s > 0.6 && !clearOfGlass(sp, p.x, p.y, p.z, s, false)) s *= 0.9;
    if (!clearOfGlass(sp, p.x, p.y, p.z, s, false)) continue;
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 70, rng, clear, { margin: 2 })) {
    const s = rng.float(0.7, 1.4);
    if (!deckKeepsTrees(p.x - cx, p.z - cz)) ctx.forest.add('shrub', p.x, p.y, p.z, s);
    else ctx.forest.rng.float(0, Math.PI * 2);
  }
  for (const p of scatter(stack, 5600, rng, (x, z) => {
    trail.closest(x, z, q);
    const d = Math.hypot(x - cx, z - cz);
    const inGarden = d < DOME_R - 0.75 && !inHouse(x, z) && !onGardenPath(x, z);
    return q.d > 1.1 && (d > DOME_R + 0.6 || inGarden);
  }, { margin: 1.2, tries: 3 })) {
    const s = rng.float(0.7, 1.25);
    // (Thinned along the deck track after the draws, so no other tuft moves: none on its centre, fewer beside it.)
    const tw = worn(p.x, p.z), keep = tw < 0.25 || (tw < 0.7 && ((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5) % 1 + 1) % 1 > tw);
    // (and off the stepping stones, likewise after the draws: only tufts rooted well inside a stone, so the grass grows
    // right up to their edges)
    if (deckOutside(p.x - cx, p.z - cz) > 0.2 && keep && !walkway.on(p.x, p.z, -0.06)) ctx.meadow.add(p.x, p.y, p.z, s);
  }
  // A lush lawn, two small trees and a few shrubs in the dome garden.
  const garden = (x, z) => Math.hypot(x - cx, z - cz) < DOME_R - 0.75 && !inHouse(x, z) && !onGardenPath(x, z);
  for (let i = 0, n = 0; i < 6000 && n < 1400; i++) {
    const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (DOME_R - 0.75);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (!garden(x, z)) continue;
    ctx.meadow.add(x, stack.heightAt(x, z), z, rng.float(0.8, 1.3));
    n++;
  }
  for (const [lx, lz, s0] of [[-9.0, -3.2, 0.72], [8.2, 5.6, 0.8]]) {
    const x = cx + lx, z = cz + lz, y = stack.heightAt(x, z);
    let s = s0;
    while (s > 0.3 && !clearOfGlass('broadleaf', x, y, z, s, true)) s *= 0.95;
    ctx.forest.add('broadleaf', x, y, z, s);
    collider.addCylinder(x, y - 0.5, z, ctx.forest.radiusOf('broadleaf') * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 22, rng, (x, z) => { const d = Math.hypot(x - cx, z - cz); return d < DOME_R - 1.6 && !inHouse(x, z) && !onGardenPath(x, z); }, { margin: 2, tries: 60 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.8, 1.3));

  // Scattered stones
  ctx.pebbles.scatter(stack, 60, rng, clear, (x, z) => deckOutside(x - cx, z - cz) > 1 && !walkway.on(x, z, 0.15));

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
