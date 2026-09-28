import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Rng, fbm3, noise2, noise3, clamp, lerp, smoothstep } from '../core/rng.js';
import { materials } from '../render/materials.js';

// Granite tors and boulder piles made of rounded blocks: a superellipse plan swept over a rounded-box
// profile, cut by joint planes, with world-scaled uvs and baked vertex colours for materials().cliff.
// None of it goes into the BVH collider (the capsule climbs any face that is not vertical); the returned
// vertical circle walls are the collision.

const TILE = 4;              // metres per rock-texture tile, as on the stack cliffs
const TAU = Math.PI * 2;
const BAND = [-0.3, 3];      // heights above the ground whose silhouette the walls and footprint cover
const CLEAR = 0.26;          // cascade centreline distance off the rock
const LICHEN = [0.7, 0.7, 0.62], LICHEN_Y = [0.64, 0.6, 0.4], MOSS = [0.2, 0.24, 0.1], ALGAE = [0.12, 0.13, 0.08];

// ---------------------------------------------------------------------------------------------------------
// The tor: 4 tiers of jointed blocks shrinking upward, flush on the spill side where a leaning chute face
// carries the spring's overflow from a notch in the top basin down to the ground.
export function buildTor(stack, { x, z, radius = 8.5, height = 12.5, seed = 1, spillAngle, batcher }) {
  const rng = new Rng(seed);
  const R = radius;
  const spill = spillAngle ?? rng.float(0, TAU);
  const sx = Math.cos(spill), sz = Math.sin(spill), tx = -sz, tz = sx;   // s: out through the notch, t: across
  const at = (u, w) => [x + sx * u + tx * w, z + sz * u + tz * w];
  const ground = groundGrid(stack, x, z, R + 8, 1.5);   // reaches the outermost fallen boulders
  const { lo: gMin, hi: gMax, mean: g0 } = groundRange(ground, x, z, R + 1.5);

  const yRim = gMax + height + 0.1;
  const yW = yRim - 0.92, lipY = yW + 0.1;
  const S = yRim - g0;
  const lean = 0.2, uFoot = R + 0.2;
  const faceU = (y) => uFoot - (y - g0) * lean;
  const spillCut = { nx: sx, nz: sz, ox: x, oz: z, d0: uFoot, y0: g0, lean };
  const yBase = gMin - 1;
  const ov = 0.35;   // each block sinks this far into the one below
  const y1 = g0 + S * rng.float(0.31, 0.36), y2 = g0 + S * rng.float(0.57, 0.62), y3 = g0 + S * rng.float(0.79, 0.82);

  const body = [];
  const add = (spec) => { const b = block({ seed: seed * 31 + body.length, tone: rng.float(-0.035, 0.035), ...spec }); body.push(b); return b; };
  const span = (p, q) => (p < q ? [p, q] : [q, p]);
  // A block over a (u, w) rectangle; open ones are bottomless bases reaching below the ground. Rounding,
  // joint faces and sheet joints (a horizontal groove part-way up) vary per block.
  const slab = (u0, u1, w0, w1, yb, yt, o = {}) => {
    const [cx, cz] = at((u0 + u1) / 2, (w0 + w1) / 2);
    const a = (u1 - u0) / 2, b = (w1 - w0) / 2, h = yt - yb, cy = o.open ? yb : (yb + yt) / 2;
    const yaw = spill + (o.yaw ?? rng.float(-0.07, 0.07)), pn = rng.float(2.5, 3.5);
    const cuts = [spillCut];
    if (o.fracture !== false) for (let i = 0; i < 2; i++) if (rng.next() < 0.55) cuts.push(fracture(rng, cx, cy, cz, a, b, pn, yaw, spill));
    const ct = o.ct ?? rng.float(0.7, 1.5), ctv = o.ctv ?? rng.float(0.45, 0.9);
    const vis0 = o.open ? g0 - yb : -h / 2, visH = o.open ? yt - g0 : h;
    const sheets = o.sheets ?? (visH > 2.4 && rng.next() < 0.6
      ? [{ y: vis0 + visH * rng.float(0.4, 0.7), depth: rng.float(0.12, 0.24), k: rng.int(1, 2), ph: rng.float(0, TAU) }] : []);
    return add({
      cx, cz, cy, a, b, yaw, pn, cuts, sheets, nLon: o.nLon, nLat: o.nLat, wobble: o.wobble,
      tiltX: o.tilt ?? rng.float(-0.07, 0.07), tiltZ: o.tilt ?? rng.float(-0.07, 0.07),
      prof: o.open
        ? { h0: 0, h1: h, open: true, ct, ctv, dome: 0.2, topW: 0.6 }
        : { h0: h / 2, h1: h / 2, ct, ctv, cb: rng.float(0.3, 0.6), cbv: rng.float(0.25, 0.5), dome: o.dome ?? 0.15, topW: o.topW ?? 0.6 },
      topCalm: o.topCalm, carve: o.carve,
    });
  };

  // Tier 0: two base blocks split by a vertical joint well clear of the chute, and two lower outriggers.
  {
    const u1 = faceU(g0) + 0.45, m = rng.sign(), js = 0.3 * R * m;
    const wa = span(-0.66 * R * m, js + 0.03 * R * m), wb = span(js - 0.03 * R * m, 0.66 * R * m);
    slab(u1 - 1.46 * R, u1, wa[0], wa[1], yBase, y1, { open: true, nLon: 56, nLat: 16, fracture: false });
    slab(u1 - 1.2 * R, u1, wb[0], wb[1], yBase, y1 + rng.float(-0.6, 0.3), { open: true, nLon: 44, nLat: 15 });
    for (const sgn of [-1, 1]) {
      const ang = spill + Math.PI + sgn * rng.float(0.5, 0.75);
      const a = R * rng.float(0.36, 0.42), b = R * rng.float(0.32, 0.4), d = R - a * 0.98;
      const cx = x + Math.cos(ang) * d, cz = z + Math.sin(ang) * d, yaw = ang + rng.float(-0.15, 0.15), pn = rng.float(2.4, 3.4);
      add({
        cx, cz, cy: yBase, a, b, yaw, pn, nLon: 40, nLat: 13, tiltX: rng.float(-0.05, 0.05), tiltZ: rng.float(-0.05, 0.05),
        cuts: rng.next() < 0.7 ? [fracture(rng, cx, y1, cz, a, b, pn, yaw, spill)] : [],
        prof: { h0: 0, h1: y1 - rng.float(0.5, 1.8) - yBase, open: true, ct: rng.float(0.9, 1.6), ctv: rng.float(0.7, 1.3), dome: 0.2, topW: 0.7 },
      });
    }
  }
  // Tier 1: two blocks, their joint on the other side of the chute from the one below.
  {
    const yb = y1 - ov, u1 = faceU(yb) + 0.4, m = rng.sign(), js = 0.28 * R * m;
    const wa = span(-0.6 * R * m, js + 0.03 * R * m), wb = span(js - 0.03 * R * m, 0.56 * R * m);
    slab(u1 - 1.16 * R, u1, wa[0], wa[1], yb, y2 + rng.float(-0.2, 0.2), { nLon: 56, nLat: 18 });
    slab(u1 - 0.85 * R, u1, wb[0], wb[1], yb, y2 - rng.float(0.1, 0.5), { nLon: 44, nLat: 15 });
  }
  // Tier 2: a main block and a lower one stepping down behind it.
  {
    const yb = y2 - ov, u1 = faceU(yb) + 0.4, u0 = u1 - 1.04 * R, wo = rng.float(-0.05, 0.05) * R, m = rng.sign();
    slab(u0, u1, wo - 0.5 * R, wo + 0.5 * R, yb, y3, { nLon: 52, nLat: 18 });
    const wb = span(-0.34 * R * m + wo, 0.22 * R * m + wo);
    slab(u0 - 0.22 * R, u0 + 0.4 * R, wb[0], wb[1], yb, y3 - rng.float(0.5, 1.2), { nLon: 36, nLat: 14 });
  }
  // Tier 3: the capstone holding the spring. Its top is left almost undisplaced so the rim stays level,
  // then the basin and the notch are carved into it.
  const aT = 0.48 * R, uPool = faceU(y3 - ov) + 0.3 - aT;
  const [pcx, pcz] = at(uPool, 0);
  const rp = clamp(0.19 * R, 1.3, 2.0), rw = rp - 0.15;
  const carve = (v) => {
    const dx = v.x - pcx, dz = v.z - pcz;
    const rho = Math.hypot(dx, dz);
    let y = rho < rw ? yW - 0.55 * (1 - (rho / rw) ** 2) : yW + (rho - rw) * 1.8;
    y += 0.03 * noise2(v.x * 2.1, v.z * 2.1, seed);
    if (dx * sx + dz * sz > 0) y = Math.min(y, lipY + smoothstep(0.6, 1.05, Math.abs(dx * tx + dz * tz)) * 2);
    if (y < v.y) v.y = y;
  };
  slab(uPool - aT, uPool + aT, -0.45 * R, 0.45 * R, y3 - ov, yRim, {
    yaw: 0, tilt: 0, nLon: 72, nLat: 30, ct: 1.0, ctv: 0.8, dome: 0, topW: 1.3, topCalm: 0.2, carve, fracture: false, sheets: [], wobble: 0.4,
  });
  // A rounded logan stone perched on the rim, away from the spill.
  {
    const ang = spill + Math.PI + rng.float(-0.6, 0.6);
    const rl = 0.17 * R, hl = 0.16 * R, d = rw + 0.7 + rl * 0.9;
    add({
      cx: pcx + Math.cos(ang) * d, cy: yRim - 0.1 + hl * 0.45, cz: pcz + Math.sin(ang) * d, a: rl * 1.1, b: rl * 0.85,
      yaw: rng.float(0, TAU), pn: 2.3, tiltX: rng.float(-0.08, 0.08), tiltZ: rng.float(-0.08, 0.08), nLon: 36, nLat: 14, rough: 1.3,
      prof: { h0: hl * 0.45, h1: hl * 0.55, ct: rl * 0.8, ctv: hl * 0.4, cb: rl * 0.6, cbv: hl * 0.3, pc: 2.1, dome: 0.1 },
    });
  }

  // ---- The cascade: over the notch floor to the lip, then down the face (hugging it, or falling free
  // where it overhangs), then out to the landing point. Traced against the rock in a band round the chute
  // and in front of the pool centre only (the stream is at most 1.2 m wide either side of its centreline).
  const bvh = bvhOf(body, (px, pz) => { const dx = px - x, dz = pz - z; return dx * sx + dz * sz > uPool - rw && Math.abs(dx * tx + dz * tz) < 2; });
  const ray = new THREE.Ray();
  const cast = (ox, oy, oz, dx, dy, dz) => {
    ray.origin.set(ox, oy, oz); ray.direction.set(dx, dy, dz);
    return bvh.raycastFirst(ray, THREE.DoubleSide);
  };
  const downY = (u, w) => { const [px, pz] = at(u, w); const h = cast(px, yRim + 20, pz, 0, -1, 0); return h ? h.point.y : -Infinity; };
  const OUT = uFoot + 10;
  const faceAt = (w, y) => { const [px, pz] = at(OUT, w); const h = cast(px, y, pz, -sx, 0, -sz); return h ? OUT - h.distance : -Infinity; };
  const widthAt = (y) => 1.2 + 1.2 * Math.pow(clamp((lipY - y) / Math.max(lipY - g0, 1), 0, 1), 0.85);

  // Dense centreline as (u, y): in the pool, over the notch floor to the lip, down the face, then out over
  // the ground to the landing point. Resampled evenly, then pushed clear of the rock.
  const path = [];
  const floorAt = (u) => Math.max(downY(u, -0.3), downY(u, 0), downY(u, 0.3)) + 0.18;
  let uLip = uPool + rw;
  for (let u = uPool + rw; u < uFoot; u += 0.05) { if (downY(u, 0) < lipY - 0.25) break; uLip = u; }
  path.push([uPool + rw - 0.3, yW + 0.03]);
  for (let u = uPool + rw + 0.1; u < uLip; u += 0.25) path.push([u, floorAt(u)]);
  path.push([uLip, floorAt(uLip)]);
  {
    const DY = 0.1;
    let u = uLip + 0.05, y = path[path.length - 1][1], vu = 0.5, vy = 0.6;
    for (let i = 0; i < 600 && y > ground(...at(u, 0)) + 0.12; i++) {
      const yn = y - DY, dt = DY / vy, hw = 0.42 * widthAt(yn);
      const f = Math.max(faceAt(0, yn), faceAt(-hw, yn), faceAt(hw, yn)) + CLEAR;
      let un = u + vu * dt;
      if (un <= f) {
        // On the rock: pushed out by the face and slowed by it; a thin sheet leaves it only gently.
        vu = clamp((f - u) / dt, 0, 0.6);
        un = f;
        vy = Math.min(Math.sqrt(vy * vy + 2 * 9.81 * DY * 0.55), 4.5);
      } else {
        vy = Math.min(Math.sqrt(vy * vy + 2 * 9.81 * DY), 9);
      }
      u = un; y = yn;
      path.push([u, y]);
    }
    for (let uu = u + 0.3; uu < R + 0.6; uu += 0.3) path.push([uu, ground(...at(uu, 0)) + 0.1]);
  }
  const [lx, lz] = at(R + 0.8, 0);
  const splash = new THREE.Vector3(lx, stack.heightAt(lx, lz) ?? ground(lx, lz), lz);
  path.push([R + 0.8, splash.y]);
  const cascade = resample(path, 0.5).map(([u, y]) => { const [px, pz] = at(u, 0); return new THREE.Vector3(px, y, pz); });
  const cascadeWidths = cascade.map((p) => widthAt(p.y));
  cascadeWidths[cascadeWidths.length - 1] = 2.4;
  // Grooves and bulges above or beside a point can come closer than the horizontal clearance.
  {
    const near = {}, away = new THREE.Vector3();
    for (let i = 1; i < cascade.length - 1; i++) {
      const p = cascade[i];
      for (let it = 0; it < 3 && bvh.closestPointToPoint(p, near) && near.distance < 0.2; it++) {
        p.addScaledVector(away.subVectors(p, near.point).normalize(), 0.23 - near.distance);
      }
    }
  }

  // ---- Boulders fallen from the tor, half-buried round the base, clear of the spill side and its pool.
  const rOut = outline(x, z, body, ground, 96);
  const boulders = [];
  {
    const nb = rng.int(4, 6), arc0 = spill + 1.15, arcLen = TAU - 2.3;
    for (let i = 0; i < nb; i++) {
      const ang = arc0 + (arcLen * (i + 0.5)) / nb + rng.float(-0.18, 0.18);
      const rb = R * rng.float(0.1, 0.22);
      const dist = rAt(rOut, ang) + (rng.next() < 0.7 ? rb * rng.float(0.15, 0.55) : rb + rng.float(1.2, 2.6));
      boulders.push(boulder(rng, ground, x + Math.cos(ang) * dist, z + Math.sin(ang) * dist, rb, rb * rng.float(0.7, 1.0), seed * 53 + i, { spill, angular: rng.next() < 0.5 }));
    }
  }

  // ---- Colours, uvs, batching.
  const wetHalf = (y) => 0.5 * widthAt(y) + 0.25;
  const env = {
    seed, ground, ox: x, oz: z,
    // The chute face and the notch floor stay wet, with moss along the edges of the wet strip.
    wet: (p) => {
      const dx = p.x - x, dz = p.z - z, u = dx * sx + dz * sz, w = Math.abs(dx * tx + dz * tz);
      if (p.y > lipY + 0.3 || w > 2 || u < Math.min(faceU(p.y) - 1.4, uPool)) return 0;
      const on = Math.max(smoothstep(faceU(p.y) - 1.4, faceU(p.y) - 0.3, u), u > uPool + rw - 0.2 && p.y > yW - 0.3 ? 1 : 0);
      return on * (1 - smoothstep(wetHalf(p.y) * 0.75, wetHalf(p.y) + 0.35, w)) * (0.8 + 0.2 * noise2(w * 3, p.y * 0.4, seed + 7));
    },
    moss: (p) => {
      const dx = p.x - x, dz = p.z - z, u = dx * sx + dz * sz, w = Math.abs(dx * tx + dz * tz);
      if (p.y > lipY || w > 3 || u < faceU(p.y) - 1.2) return 0;
      const hw = wetHalf(p.y), edge = smoothstep(hw * 0.8, hw + 0.2, w) * (1 - smoothstep(hw + 0.5, hw + 1.3, w));
      return edge > 0 ? smoothstep(faceU(p.y) - 1.2, faceU(p.y) - 0.3, u) * edge * smoothstep(-0.2, 0.3, noise3(p.x * 1.2, p.y * 1.2, p.z * 1.2, seed + 8)) : 0;
    },
    // Algae under the spring, a dark tide line just above it.
    basin: (p) => {
      if (Math.hypot(p.x - pcx, p.z - pcz) > rp + 0.6) return 0;
      return p.y < yW ? 1 : p.y < yW + 0.25 ? 0.5 : 0;
    },
  };
  const M = materials();
  for (const b of body) batcher.add(finish(b, env), M.cliff);
  for (const b of boulders) batcher.add(finish(b, env), M.cliff);

  // ---- Collision, footprint and blocker.
  let yTop = -Infinity;
  for (const b of body) for (let i = 1; i < b.pos.length; i += 3) yTop = Math.max(yTop, b.pos[i]);
  const walls = fitWalls(x, z, rOut, gMin - 1, yTop + 1);
  const shapes = [{ cx: x, cz: z, r: rOut }];
  for (const b of boulders) {
    const ro = outline(b.cx, b.cz, [b], ground, 32);
    walls.push(...fitWalls(b.cx, b.cz, ro, b.gMin - 1, b.yTop + 1));
    shapes.push({ cx: b.cx, cz: b.cz, r: ro });
  }
  const { footprint, blocker } = footprintOf(shapes, x, z);

  return { top: new THREE.Vector3(pcx, yW, pcz), poolRadius: rp, cascade, cascadeWidths, splash, footprint, blocker, walls };
}

// ---------------------------------------------------------------------------------------------------------
// A pile of 5-8 rounded boulders: a dominant one with smaller ones leaning on it, and one or two more
// stacked on top so the pile reaches `height` above the ground.
export function buildRockPile(stack, { x, z, radius, height, seed = 1, batcher }) {
  const rng = new Rng(seed * 7919 + 13);
  const ground = groundGrid(stack, x, z, radius + 3);
  const g = ground(x, z);
  const three = height / radius > 1.25;
  const stones = [];

  const ang0 = rng.float(0, TAU);
  const rd = radius * rng.float(0.5, 0.58);
  const dx = x - Math.cos(ang0) * radius * 0.12, dz = z - Math.sin(ang0) * radius * 0.12;
  stones.push(boulder(rng, ground, dx, dz, rd, height * (three ? 0.38 : 0.45) + g - ground(dx, dz), seed * 11, { res: { nLon: 44, nLat: 16 }, tilt: 0.07 }));
  const nG = rng.int(3, 5);
  for (let i = 0; i < nG; i++) {
    const ang = ang0 + ((i + 0.5) / nG) * TAU * 0.9 + rng.float(-0.25, 0.25);
    const rs = radius * rng.float(0.24, 0.4);
    const d = Math.min(rd * 0.8 + rs * 0.5, radius - rs);
    const hs = Math.min(rs * rng.float(0.8, 1.3), height * 0.55);
    stones.push(boulder(rng, ground, x + Math.cos(ang) * d, z + Math.sin(ang) * d, rs, hs, seed * 11 + i + 1));
  }
  // Stacked stones rest on whatever is below them (ray-cast), sunk slightly into it. Their size follows the
  // height left to fill, so they stay rounded and the pile (tilt included) tops out near `height`.
  const stack1 = (under, cx, cz, rMax, top, sd, res) => {
    const bvh = bvhOf(under);
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let sup = -Infinity;
    for (let k = 0; k < 5; k++) {
      const a = (k / 4) * TAU, r = k ? rMax * 0.4 : 0;
      ray.origin.set(cx + Math.cos(a) * r, g + height * 3, cz + Math.sin(a) * r);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h) sup = Math.max(sup, h.point.y);
    }
    if (sup === -Infinity) sup = under[0].yTop;
    const tiltX = rng.float(-0.12, 0.12), tiltZ = rng.float(-0.12, 0.12);
    const yb = sup - 0.2, rs = clamp((top - yb) * 0.62, 0.4, rMax);
    const lift = rs * 0.5 * (Math.abs(Math.sin(tiltX)) + Math.abs(Math.sin(tiltZ)));
    const yt = Math.max(top - lift, yb + rs * 0.8), h = yt - yb;
    const b = block({
      cx, cz, cy: yb + h / 2, a: rs * rng.float(1, 1.15), b: rs * rng.float(0.8, 0.95), yaw: rng.float(0, TAU), pn: rng.float(2.0, 2.5),
      tiltX, tiltZ, seed: sd, tone: rng.float(-0.035, 0.035), rough: 1.2,
      prof: { h0: h / 2, h1: h / 2, ct: rs * 0.8, ctv: h * 0.42, cb: rs * 0.65, cbv: h * 0.38, pc: 2.0, dome: 0.1 * rs },
      ...res,
    });
    b.yTop = yt;
    return b;
  };
  // One on the dominant's shoulder above a leaning stone, and for tall piles a last one across the two.
  const a1 = ang0 + (0.5 / nG) * TAU * 0.9;
  const s1 = stack1(stones, dx + Math.cos(a1) * rd * 0.45, dz + Math.sin(a1) * rd * 0.45, rd * 0.85, g + height * (three ? 0.75 : 1), seed * 11 + 8, { nLon: 32, nLat: 13 });
  stones.push(s1);
  if (three) {
    const r1 = (s1.a + s1.b) / 2;
    stones.push(stack1([stones[0], s1], lerp(s1.cx, dx, 0.45), lerp(s1.cz, dz, 0.45), r1 * 0.75, g + height, seed * 11 + 9, { nLon: 24, nLat: 10 }));
  }

  const env = { seed, ground, ox: x, oz: z };
  const M = materials();
  for (const b of stones) batcher.add(finish(b, env), M.cliff);

  const rOut = outline(x, z, stones, ground, 64);
  let yTop = -Infinity, gMin = Infinity;
  for (const b of stones) { yTop = Math.max(yTop, b.yTop); if (b.gMin !== undefined) gMin = Math.min(gMin, b.gMin); }
  const walls = fitWalls(x, z, rOut, gMin - 1, yTop + 1);
  const { footprint, blocker } = footprintOf([{ cx: x, cz: z, r: rOut }], x, z);
  return { footprint, blocker, walls };
}

// ---------------------------------------------------------------------------------------------------------
// A boulder emerging from the ground, rounded or (angular) a squarer fallen block tipped further over. The
// vertical part of its side starts at least 0.6 m below the lowest ground under it (more when tilted), so
// it never shows an undercut on the uneven cap.
function boulder(rng, ground, cx, cz, rb, hVis, seed, { spill = null, res = { nLon: 28, nLat: 12 }, tilt = 0.2, angular = false } = {}) {
  const gb = ground(cx, cz), { lo } = groundRange(ground, cx, cz, rb * 1.15);
  const tl = angular ? tilt * 2 : tilt, tiltX = rng.float(-tl, tl), tiltZ = rng.float(-tl, tl);
  const a = rb * rng.float(1, 1.2), b = rb * rng.float(0.75, 0.95), yaw = rng.float(0, TAU);
  const pn = angular ? rng.float(2.8, 3.4) : rng.float(2.0, 2.6);
  const sideLo = lo - 0.6 - a * (Math.abs(Math.sin(tiltX)) + Math.abs(Math.sin(tiltZ)));
  const yb = sideLo - 0.5, yt = gb + hVis, h = yt - yb;
  const cuts = rng.next() < (angular ? 0.8 : 0.4) ? [fracture(rng, cx, yt, cz, a, b, pn, yaw, spill)] : [];
  const blk = block({
    cx, cz, cy: yb + h / 2, a, b, yaw, pn, tiltX, tiltZ, seed, cuts, tone: rng.float(-0.035, 0.035), rough: angular ? 1.1 : 1.4, ...res,
    prof: {
      h0: h / 2, h1: h / 2, ct: angular ? rb * 0.35 : Math.min(rb * 0.85, hVis), ctv: Math.min(hVis * (angular ? 0.35 : 0.8), h * 0.45),
      cb: 0.5, cbv: 0.5, pc: angular ? 2.5 : 2.1, dome: 0.1 * rb,
    },
  });
  blk.gMin = lo; blk.yTop = yt;
  return blk;
}

// A flat joint face on one side of a block, away from the spill face (null spill: any side).
function fracture(rng, cx, cy, cz, a, b, pn, yaw, spill) {
  const ang = spill === null ? rng.float(0, TAU) : spill + Math.PI + rng.float(-1.9, 1.9);
  const ext = superR(a, b, pn, ang - yaw);
  return { nx: Math.cos(ang), nz: Math.sin(ang), ox: cx, oz: cz, d0: ext * rng.float(0.8, 0.9), y0: cy, lean: rng.float(0, 0.12) };
}

// ---------------------------------------------------------------------------------------------------------
// Geometry

function superR(a, b, pn, th) {
  const c = Math.abs(Math.cos(th)) / a, s = Math.abs(Math.sin(th)) / b;
  return 1 / Math.pow(Math.pow(c, pn) + Math.pow(s, pn), 1 / pn);
}

// Half cross-section of a rounded block, bottom to top, resampled to rows + 1 points by weighted arc length
// so hidden faces (undersides, ledges under the next tier) get fewer rows. r is a fraction of the plan
// radius; (nr, ny) is the outward normal; crease marks the underside and its corner (joint shadow).
function profile(p, rows) {
  const { h0, h1, rm, open = false, dome = 0, pc = 2.3, topW = 1, botW = 0.35 } = p;
  const ct = Math.min(p.ct, rm * 0.8), ctv = Math.min(p.ctv, (h0 + h1) * 0.45);
  const cb = Math.min(p.cb ?? ct, rm * 0.8), cbv = open ? 0 : Math.min(p.cbv ?? ctv, (h0 + h1) * 0.45);
  const e = 2 / pc, cN = ct / rm, bN = cb / rm;
  const d = [];
  const add = (r, y, w, top) => d.push({ r, y, w, top });
  if (!open) {
    for (let i = 0; i <= 6; i++) add(((1 - bN) * i) / 6, -h0, botW, false);
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      add(1 - bN + bN * Math.pow(Math.sin(a), e), -h0 + cbv - cbv * Math.pow(Math.cos(a), e), 1, false);
    }
  }
  const ys = -h0 + cbv, ye = h1 - ctv;
  for (let i = open ? 0 : 1; i <= 10; i++) add(1, ys + ((ye - ys) * i) / 10, 1, false);
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    add(1 - cN + cN * Math.pow(Math.cos(a), e), ye + ctv * Math.pow(Math.sin(a), e), 1, a > 1.05);
  }
  // the dome spans the flat top only, so a small top doesn't come to a point
  for (let i = 1; i <= 8; i++) { const f = 1 - i / 8; add((1 - cN) * f, h1 + dome * (1 - cN) * (1 - f * f), topW, true); }

  const L = [0];
  for (let i = 1; i < d.length; i++) {
    const a = d[i - 1], b = d[i];
    L.push(L[i - 1] + Math.hypot((b.r - a.r) * rm, b.y - a.y) * (a.w + b.w) * 0.5);
  }
  const out = [];
  for (let i = 0, k = 1; i <= rows; i++) {
    const s = (L[L.length - 1] * i) / rows;
    while (k < L.length - 1 && L[k] < s) k++;
    const a = d[k - 1], b = d[k], t = clamp((s - L[k - 1]) / Math.max(L[k] - L[k - 1], 1e-9), 0, 1);
    out.push({ r: lerp(a.r, b.r, t), y: lerp(a.y, b.y, t), top: t < 0.5 ? a.top : b.top });
  }
  out[rows].r = 0;
  if (!open) out[0].r = 0;
  for (let i = 0; i <= rows; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(rows, i + 1)];
    const nr = b.y - a.y, ny = -(b.r - a.r) * rm, l = Math.hypot(nr, ny) || 1;
    out[i].nr = nr / l; out[i].ny = ny / l;
    out[i].crease = open ? 0 : 1 - smoothstep(-h0 + cbv * 0.5, -h0 + cbv * 1.6, out[i].y);
  }
  return out;
}

// One rounded block in world space: rows of the profile swept round a superellipse plan, displaced by
// noise, tilted, yawed, then pushed back behind its joint planes (flat, freshly fractured faces).
function block(o) {
  const { cx, cy, cz, a, b, yaw = 0, tiltX = 0, tiltZ = 0, pn = 3, nLon, nLat, rough = 1, seed, cuts = [], carve = null, topCalm = 1, sheets = [], wobble = 1 } = o;
  const rm = (a + b) / 2;
  const rows = profile({ ...o.prof, rm }, nLat);
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cX = Math.cos(tiltX), sX = Math.sin(tiltX), cZ = Math.cos(tiltZ), sZ = Math.sin(tiltZ);
  const size = rough * clamp(Math.min(rm, (o.prof.h0 + o.prof.h1) * 0.8) / 4, 0.35, 1.3);
  // A few low harmonics keep the plan from reading as a clean rounded rectangle.
  const hr = new Rng(seed * 13 + 7);
  const hk = [2, 3, 5].map((k, i) => ({ k, amp: wobble * hr.float(0, [0.1, 0.07, 0.04][i]), ph: hr.float(0, TAU) }));
  const plan = new Float32Array(nLon), cos = new Float32Array(nLon), sin = new Float32Array(nLon);
  for (let j = 0; j < nLon; j++) {
    const th = (j / nLon) * TAU;
    let w = 1;
    for (const h of hk) w += h.amp * Math.sin(h.k * th + h.ph);
    cos[j] = Math.cos(th); sin[j] = Math.sin(th); plan[j] = superR(a, b, pn, th) * w;
  }
  const start = [];
  let nv = 0;
  for (const r of rows) { start.push(nv); nv += r.r === 0 ? 1 : nLon; }
  const pos = new Float32Array(nv * 3), meta = new Float32Array(nv * 3);   // meta: crease, cut, top
  const v = new THREE.Vector3();
  let k = 0;
  for (const r of rows) {
    const pole = r.r === 0, n = pole ? 1 : nLon;
    for (let j = 0; j < n; j++, k++) {
      let lx = pole ? 0 : r.r * plan[j] * cos[j], ly = r.y, lz = pole ? 0 : r.r * plan[j] * sin[j];
      let d = size * (r.top ? topCalm : 1) * (0.5 * fbm3(lx * 0.24, ly * 0.24, lz * 0.24, 3, seed) + 0.13 * fbm3(lx * 0.9, ly * 0.9, lz * 0.9, 2, seed + 5));
      // sheet joints open and close round the block rather than circling it like a tyre
      for (const s of sheets) {
        d -= s.depth * Math.max(r.nr, 0) * (1 - smoothstep(0, 0.22, Math.abs(ly - s.y))) * smoothstep(-0.3, 0.5, Math.sin(s.k * (j / nLon) * TAU + s.ph));
      }
      if (pole) ly += Math.sign(r.y || 1) * d;
      else { lx += r.nr * cos[j] * d; ly += r.ny * d; lz += r.nr * sin[j] * d; }
      // tilt about local x, then z; then yaw and place
      const y1 = ly * cX - lz * sX, z1 = ly * sX + lz * cX;
      const x2 = lx * cZ - y1 * sZ, y2 = lx * sZ + y1 * cZ;
      let wx = cx + x2 * ca - z1 * sa, wy = cy + y2, wz = cz + x2 * sa + z1 * ca;
      let cut = 0;
      for (const c of cuts) {
        const s = (wx - c.ox) * c.nx + (wz - c.oz) * c.nz - (c.d0 - (wy - c.y0) * c.lean);
        if (s <= -0.35) continue;
        const w = smoothstep(-0.35, 0, s);
        // Noise sampled on the plane, and rock from further out kept a little further out: the cut then
        // never folds the surface, so the top edge of a face stays in order (the notch carve flattens it).
        const qx = wx - c.nx * s, qz = wz - c.nz * s;
        const push = Math.max(s, 0) - (s > 0 ? (0.04 * s) / (s + 0.25) : 0) + w * (0.09 + 0.05 * noise3(qx * 1.1, wy * 1.1, qz * 1.1, seed + 3));
        wx -= c.nx * push; wz -= c.nz * push;
        cut = Math.max(cut, w);
      }
      if (carve) { v.set(wx, wy, wz); carve(v); wy = v.y; }
      pos[k * 3] = wx; pos[k * 3 + 1] = wy; pos[k * 3 + 2] = wz;
      meta[k * 3] = r.crease; meta[k * 3 + 1] = cut; meta[k * 3 + 2] = r.top && cut < 0.5 ? 1 : 0;
    }
  }
  // Outward winding: +θ runs toward +z locally, so (A_j, B_j, A_j+1) faces out.
  let nt = 0;
  for (let i = 0; i < rows.length - 1; i++) nt += rows[i].r === 0 || rows[i + 1].r === 0 ? nLon : 2 * nLon;
  const idx = new Uint32Array(nt * 3);
  let q = 0;
  const tri = (p0, p1, p2) => { idx[q++] = p0; idx[q++] = p1; idx[q++] = p2; };
  for (let i = 0; i < rows.length - 1; i++) {
    const A = start[i], B = start[i + 1], aPole = rows[i].r === 0, bPole = rows[i + 1].r === 0;
    for (let j = 0; j < nLon; j++) {
      const j1 = (j + 1) % nLon;
      if (aPole) tri(A, B + j, B + j1);
      else if (bPole) tri(A + j, B, A + j1);
      else { tri(A + j, B + j, A + j1); tri(A + j1, B + j, B + j1); }
    }
  }
  // warm/cool tint varies over tens of metres, so one value per block will do
  return { pos, meta, idx, cx, cz, a, b, rm, tone: o.tone ?? 0, warm: noise3(cx * 0.06, cy * 0.05, cz * 0.06, 17), yTop: cy + o.prof.h1 };
}

// Final batched geometry: flat triangles with normals leaning toward the smooth ones where those agree with
// the face (reads as worn stone, not low-poly), a planar uv on flat tops and a cylindrical one round the
// block elsewhere (strata stay horizontal; a whole number of tiles round so the wrap is seamless), and baked
// colours.
function finish(blk, env) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(blk.pos, 3));
  g.setIndex(new THREE.BufferAttribute(blk.idx, 1));
  g.computeVertexNormals();
  const sn = g.attributes.normal.array, P = blk.pos, idx = blk.idx;
  const nv = P.length / 3;
  const col = new Float32Array(nv * 3), th = new Float32Array(nv);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    p.fromArray(P, i * 3); n.fromArray(sn, i * 3);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    rockColor(p, n, blk, i, env, c);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    th[i] = Math.atan2(P[i * 3 + 2] - blk.cz, P[i * 3] - blk.cx);
  }
  const T = idx.length / 3, tiles = Math.max(1, Math.round((TAU * blk.rm) / TILE));
  const pos = new Float32Array(T * 9), nor = new Float32Array(T * 9), uv = new Float32Array(T * 6), cl = new Float32Array(T * 9);
  const meta = blk.meta;
  for (let t = 0; t < T; t++) {
    const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
    const ax = P[i1] - P[i0], ay = P[i1 + 1] - P[i0 + 1], az = P[i1 + 2] - P[i0 + 2];
    const bx = P[i2] - P[i0], by = P[i2 + 1] - P[i0 + 1], bz = P[i2 + 2] - P[i0 + 2];
    let fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (fl > 1e-9) { fx /= fl; fy /= fl; fz /= fl; } else { fx = sn[i0]; fy = sn[i0 + 1]; fz = sn[i0 + 2]; }
    const up = Math.abs(fy);
    const planar = up > 0.85 || (up >= 0.35 && meta[i0 + 2] + meta[i1 + 2] + meta[i2 + 2] >= 2);
    const t0 = th[i0 / 3], t1 = th[i1 / 3], t2 = th[i2 / 3];
    const wrap = Math.max(t0, t1, t2) - Math.min(t0, t1, t2) > Math.PI;
    for (let m = 0; m < 3; m++) {
      const i = idx[t * 3 + m] * 3, o = t * 9 + m * 3, u = t * 6 + m * 2;
      pos[o] = P[i]; pos[o + 1] = P[i + 1]; pos[o + 2] = P[i + 2];
      // Cuts can turn the smooth normal against the face; blended in regardless, it would light the face
      // from inside the rock, so it only counts where it agrees with the face.
      const ws = 0.62 * smoothstep(0, 0.3, sn[i] * fx + sn[i + 1] * fy + sn[i + 2] * fz);
      let nx = sn[i] * ws + fx * (1 - ws), ny = sn[i + 1] * ws + fy * (1 - ws), nz = sn[i + 2] * ws + fz * (1 - ws);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 1e-6) { nx /= nl; ny /= nl; nz /= nl; } else { nx = fx; ny = fy; nz = fz; }
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      cl[o] = col[i]; cl[o + 1] = col[i + 1]; cl[o + 2] = col[i + 2];
      if (planar) { uv[u] = (P[i] - env.ox) / TILE; uv[u + 1] = (P[i + 2] - env.oz) / TILE; }
      else { const tc = th[i / 3]; uv[u] = ((wrap && tc < 0 ? tc + TAU : tc) / TAU) * tiles; uv[u + 1] = P[i + 1] / TILE; }
    }
  }
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  return out;
}

// Linear vertex colour (it multiplies the rock texture): warm/cool grey granite, pale lichen on tops,
// darker undersides, joints and rain streaks, fresher fracture faces, moss at the foot, wet chute, basin.
function rockColor(p, n, blk, i, env, out) {
  const s = env.seed, crease = blk.meta[i * 3], cut = blk.meta[i * 3 + 1];
  const l = 0.5 + blk.tone + 0.05 * noise3(p.x * 0.11, p.y * 0.11, p.z * 0.11, s) + 0.03 * noise3(p.x * 1.9, p.y * 1.9, p.z * 1.9, s + 1);
  const warm = blk.warm;
  let r = l * (1 + 0.06 * warm + 0.05 * cut), g = l * (1 + 0.01 * warm + 0.025 * cut), b = l * (1 - 0.06 * warm);
  const up = smoothstep(0.3, 0.85, n.y) * (1 - cut);
  if (up > 0) {
    const lich = up * smoothstep(0.05, 0.3, fbm3(p.x * 0.55, p.y * 0.55, p.z * 0.55, 2, s + 3)) * 0.75;
    r = lerp(r, LICHEN[0], lich); g = lerp(g, LICHEN[1], lich); b = lerp(b, LICHEN[2], lich);
    const ly = up * smoothstep(0.45, 0.7, noise3(p.x * 1.3, p.y * 1.3, p.z * 1.3, s + 4)) * 0.5;
    r = lerp(r, LICHEN_Y[0], ly); g = lerp(g, LICHEN_Y[1], ly); b = lerp(b, LICHEN_Y[2], ly);
  }
  const arc = Math.atan2(p.z - blk.cz, p.x - blk.cx) * blk.rm;
  const streak = smoothstep(0.15, 0.55, noise2(arc * 1.4, p.y * 0.08, s + 5)) * (1 - Math.abs(n.y)) * 0.2;
  const wet = env.wet ? env.wet(p) : 0;
  const k = (1 - 0.42 * smoothstep(-0.05, -0.6, n.y) - 0.28 * crease) * (1 - streak) * (1 - 0.5 * wet);
  r *= k * (1 - 0.08 * wet); g *= k; b *= k * (1 + 0.06 * wet);
  const hg = p.y - env.ground(p.x, p.z);
  const foot = hg < 1.8 ? (1 - smoothstep(0.05, 1.8, hg)) * smoothstep(-0.3, 0.3, noise3(p.x * 0.7, p.y * 0.7, p.z * 0.7, s + 6) + 0.1) : 0;
  const moss = Math.min(0.85, Math.max(foot, env.moss ? env.moss(p) : 0) * (0.55 + 0.45 * Math.max(n.y, 0.2)));
  r = lerp(r, MOSS[0], moss); g = lerp(g, MOSS[1], moss); b = lerp(b, MOSS[2], moss);
  const basin = env.basin ? env.basin(p) : 0;
  if (basin === 1) { r = lerp(r, ALGAE[0], 0.85); g = lerp(g, ALGAE[1], 0.85); b = lerp(b, ALGAE[2], 0.85); }
  else if (basin > 0) { r *= 0.6; g *= 0.6; b *= 0.6; }
  out[0] = clamp(r, 0.02, 1); out[1] = clamp(g, 0.02, 1); out[2] = clamp(b, 0.02, 1);
}

function bvhOf(blocks, keep = null) {
  let nv = 0, ni = 0;
  for (const b of blocks) { nv += b.pos.length; ni += b.idx.length; }
  const pos = new Float32Array(nv), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const b of blocks) {
    const P = b.pos, I = b.idx, base = ov / 3;
    pos.set(P, ov);
    let ok = null;
    if (keep) { ok = new Uint8Array(P.length / 3); for (let v = 0; v < ok.length; v++) ok[v] = keep(P[v * 3], P[v * 3 + 2]) ? 1 : 0; }
    for (let i = 0; i < I.length; i += 3) {
      if (ok && !(ok[I[i]] | ok[I[i + 1]] | ok[I[i + 2]])) continue;
      idx[oi++] = I[i] + base; idx[oi++] = I[i + 1] + base; idx[oi++] = I[i + 2] + base;
    }
    ov += P.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, oi), 1));
  return new MeshBVH(g);
}

// Even re-spacing of a polyline of [u, y] pairs, keeping both ends.
function resample(path, step) {
  const L = [0];
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = L[L.length - 1], n = Math.max(1, Math.round(total / step)), out = [];
  for (let k = 0, i = 1; k <= n; k++) {
    const s = (total * k) / n;
    while (i < L.length - 1 && L[i] < s) i++;
    const t = clamp((s - L[i - 1]) / Math.max(L[i] - L[i - 1], 1e-9), 0, 1);
    out.push([lerp(path[i - 1][0], path[i][0], t), lerp(path[i - 1][1], path[i][1], t)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Ground, outline, walls

// Bilinear lookup of the built cap over a square round (x, z): one ray per grid point instead of per vertex.
function groundGrid(stack, x, z, half, step = 1.25) {
  const n = Math.ceil((half * 2) / step) + 1, x0 = x - half, z0 = z - half;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const px = x0 + i * step, pz = z0 + j * step;
    h[j * n + i] = stack.heightAt(px, pz) ?? stack.heightAtAnalytic?.(px, pz) ?? stack.top;
  }
  return (px, pz) => {
    const fx = clamp((px - x0) / step, 0, n - 1.001), fz = clamp((pz - z0) / step, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
    return lerp(lerp(h[j * n + i], h[j * n + i + 1], u), lerp(h[(j + 1) * n + i], h[(j + 1) * n + i + 1], u), w);
  };
}

function groundRange(ground, x, z, r) {
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let k = 0; k <= 4; k++) {
    const rr = (r * k) / 4, m = k ? 8 * k : 1;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU, h = ground(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
    }
  }
  return { lo, hi, mean: sum / n };
}

// Furthest reach of the rock round (cx, cz) at K angles, over vertices in the BAND above the local ground.
// Spread one bin each way (mesh edges reach between vertices) and bridge empty bins, giving a star-shaped
// superset of the silhouette.
function outline(cx, cz, blocks, ground, K) {
  const r = new Float32Array(K);
  for (const b of blocks) for (let i = 0; i < b.pos.length; i += 3) {
    const x = b.pos[i], y = b.pos[i + 1], z = b.pos[i + 2], h = y - ground(x, z);
    if (h < BAND[0] || h > BAND[1]) continue;
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    const k = Math.round((Math.atan2(dz, dx) / TAU + 1) * K) % K;
    if (d > r[k]) r[k] = d;
  }
  const full = r.map((v, k) => Math.max(r[(k + K - 1) % K], v, r[(k + 1) % K]));
  const out = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    if (full[k] > 0) { out[k] = full[k] + 0.03; continue; }
    let a = 1, b = 1;
    while (a < K && full[(k - a + K) % K] === 0) a++;
    while (b < K && full[(k + b) % K] === 0) b++;
    out[k] = Math.max(full[(k - a + K) % K], full[(k + b) % K]) + 0.03;
  }
  return out;
}

function rAt(rOut, ang) {
  const K = rOut.length, f = ((((ang / TAU) % 1) + 1) % 1) * K, i = Math.floor(f) % K;
  return lerp(rOut[i], rOut[(i + 1) % K], f - Math.floor(f));
}

// Vertical circles whose union holds the star-shaped outline round (cx, cz). Candidates are centred inside
// it and reach `tau` past the nearest outline edge, so no wall stands further than that off the rock; a
// greedy set cover keeps the fewest that contain every outline sample. The camera stays 0.32 m outside a
// wall, so it never clips into the rock.
function fitWalls(cx, cz, rOut, y0, y1, tau = 0.25) {
  const K = rOut.length, S = 2, N = K * S, rMax = Math.max(...rOut), step = clamp(rMax / 10, 0.15, 0.6);
  const px = new Float32Array(N), pz = new Float32Array(N), d2 = new Float32Array(N);
  for (let k = 0; k < K; k++) for (let s = 0; s < S; s++) {
    const k1 = (k + 1) % K, a0 = (k / K) * TAU, a1 = (k1 / K) * TAU, t = s / S;
    px[k * S + s] = lerp(rOut[k] * Math.cos(a0), rOut[k1] * Math.cos(a1), t);
    pz[k * S + s] = lerp(rOut[k] * Math.sin(a0), rOut[k1] * Math.sin(a1), t);
  }
  // cand: candidate circles; left: how many uncovered samples each still reaches; by: candidates per sample
  const cand = [], left = [], by = Array.from({ length: N }, () => []);
  for (let gx = -rMax; gx <= rMax; gx += step) for (let gz = -rMax; gz <= rMax; gz += step) {
    if (Math.hypot(gx, gz) >= rAt(rOut, Math.atan2(gz, gx)) - 0.05) continue;
    // distance to the densely sampled outline stands in for the distance to its edges
    let m = Infinity;
    for (let i = 0; i < N; i++) { const dx = px[i] - gx, dz = pz[i] - gz; d2[i] = dx * dx + dz * dz; if (d2[i] < m) m = d2[i]; }
    const d = Math.sqrt(m);
    if (d < 0.2) continue;
    const r = d + tau, cov = [], c = cand.length;
    for (let i = 0; i < N; i++) if (d2[i] <= r * r) { cov.push(i); by[i].push(c); }
    cand.push({ x: gx, z: gz, r, cov });
    left.push(cov.length);
  }
  const done = new Uint8Array(N), walls = [];
  const take = (x, z, r) => walls.push({ x: cx + x, z: cz + z, r, y0, y1 });
  for (;;) {
    let best = -1;
    for (let c = 0; c < cand.length; c++) {
      if (left[c] > (best < 0 ? 0 : left[best]) || (best >= 0 && left[c] === left[best] && cand[c].r > cand[best].r)) best = c;
    }
    if (best < 0) break;
    for (const i of cand[best].cov) if (!done[i]) { done[i] = 1; for (const c of by[i]) left[c]--; }
    take(cand[best].x, cand[best].z, cand[best].r);
  }
  // Sharp tips no candidate reaches get a small circle of their own.
  for (let i = 0; i < N; i++) {
    if (done[i]) continue;
    const l = Math.hypot(px[i], pz[i]) || 1, x = px[i] - (px[i] / l) * 0.3, z = pz[i] - (pz[i] / l) * 0.3;
    take(x, z, 0.3 + tau);
    for (let j = i; j < N; j++) if ((px[j] - x) ** 2 + (pz[j] - z) ** 2 <= (0.3 + tau) ** 2) done[j] = 1;
  }
  return walls;
}

// footprint: inside any outline + 0.6 m (keeps grass, flowers and pebbles off the rock); blocker: a
// bounding circle for the pushable boulders.
function footprintOf(shapes, x, z) {
  let r = 0;
  const bound = shapes.map((s) => {
    const m = Math.max(...s.r) + 0.6;
    r = Math.max(r, Math.hypot(s.cx - x, s.cz - z) + m - 0.6);
    return m;
  });
  const footprint = (px, pz) => {
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i], dx = px - s.cx, dz = pz - s.cz, d = Math.hypot(dx, dz);
      if (d < bound[i] && d < rAt(s.r, Math.atan2(dz, dx)) + 0.6) return true;
    }
    return false;
  };
  return { footprint, blocker: { x, z, r: r + 0.1 } };
}
