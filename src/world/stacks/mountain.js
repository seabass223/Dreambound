import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS } from '../../config.js';
import { Rng, smoothstep, clamp, fbm2 } from '../../core/rng.js';
import { materials } from '../../render/materials.js';
import { Stack } from '../terrain.js';
import { Batcher, ColliderBuilder, mat4, mergeParts } from '../builders.js';
import { Path } from '../paths.js';
import { buildTrail, scatter } from '../features.js';
import { placeObservatory } from '../../props/observatory.js';
import { createElevator } from '../../props/elevator.js';

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

  // Switchback path: polar legs around the summit, three hairpin turns.
  const polar = (th, r) => [sx + Math.cos(th) * r, sz + Math.sin(th) * r];
  const legs = [
    [thS + 0.09, 55.5], [thS + 0.16, 50], [thS + 1.0, 42], [thS - 0.55, 31], [thS + 0.55, 20.5], [thS - 0.05, R_PLATEAU + 1.5], [thS - 0.05, 6.7],
  ];
  const raw = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const [t0, r0] = legs[i], [t1, r1] = legs[i + 1];
    const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * (r0 + r1) / 2 / 1.2 + Math.abs(r1 - r0) / 1.2));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      raw.push(polar(t0 + (t1 - t0) * u, r0 + (r1 - r0) * u));
    }
  }
  raw.push(polar(legs[legs.length - 1][0], legs[legs.length - 1][1]));
  // Start at the shed door.
  const door = [shed.x + tang.x * 2.9, shed.z + tang.z * 2.9];
  raw.unshift(door, [door[0] + tang.x * 2.5, door[1] + tang.z * 2.5]);
  // Path heights follow the cone at each point, smoothed so it never kinks.
  const withY = raw.map(([x, z]) => [x, z, cfg.top + cone(Math.hypot(x - sx, z - sz))]);
  for (let pass = 0; pass < 4; pass++) for (let i = 1; i < withY.length - 1; i++) withY[i][2] = (withY[i - 1][2] + withY[i][2] * 2 + withY[i + 1][2]) / 4;
  // Stay level across the summit plateau so the observatory's step is never taller than a stride.
  for (const p of withY) if (Math.hypot(p[0] - sx, p[1] - sz) < R_PLATEAU) p[2] = Math.max(p[2], cfg.top + PEAK);
  const path = new Path(withY, 1.5);

  const q = {};
  stack.shapeFns.push((x, z, h) => {
    const d = Math.hypot(x - sx, z - sz);
    const rough = fbm2(x * 0.06, z * 0.06, 3, 91) * 2.2 * smoothstep(R_PLATEAU, R_PLATEAU + 8, d) * (1 - smoothstep(R_BASE - 8, R_BASE, d));
    h += cone(d) + rough;
    if (d < R_PLATEAU + 1) h = THREE.MathUtils.lerp(h, cfg.top + PEAK, 1 - smoothstep(R_PLATEAU - 1, R_PLATEAU + 1, d));
    path.closest(x, z, q);
    if (q.d < 4.2) h = THREE.MathUtils.lerp(q.y, h, smoothstep(1.3, 4.2, q.d));
    const ds = Math.hypot(x - shed.x, z - shed.z);
    if (ds < 7) h = THREE.MathUtils.lerp(cfg.top + cone(shedR) + 0.1, h, smoothstep(3.6, 7, ds));
    return h;
  });
  stack.colorFns.push((x, z, h, col) => {
    path.closest(x, z, q);
    if (q.d < 2.2) col.lerp(new THREE.Color(0.18, 0.14, 0.1), (1 - smoothstep(0.7, 2.2, q.d)) * 0.8);
  });

  const collider = new ColliderBuilder('mountain');
  const batcher = new Batcher();
  stack.build(collider);
  const M = materials();
  buildTrail(stack, path, batcher, { width: 1.35, spacing: 0.6 });

  // Low dry-stone walls on the outside of each hairpin.
  const wallStone = ctx.pebbles.geometries[0];
  for (let i = 3; i < legs.length - 2; i++) {
    const [th, r] = legs[i];
    for (let k = -3; k <= 3; k++) {
      const a = th + k * 0.03 + (i % 2 ? 0.05 : -0.05);
      const [x, z] = polar(a, r - 2.3);
      const y = stack.heightAt(x, z);
      if (y !== null) ctx.pebbles.addAt(x, y + 0.1, z, 0.35 + (k % 2) * 0.08, wallStone);
    }
  }

  // ---- Shed ----
  const shedY = stack.heightAt(shed.x, shed.z);
  const sm = mat4(shed.x, shedY, shed.z, shedRot);
  const W = 3.8, D = 5.2, H = 3.1;
  const wallParts = [
    { geo: new THREE.BoxGeometry(0.15, H, D), matrix: mat4(-W / 2, H / 2, 0) },
    { geo: new THREE.BoxGeometry(0.15, H, D), matrix: mat4(W / 2, H / 2, 0) },
    { geo: new THREE.BoxGeometry(W, H, 0.15), matrix: mat4(0, H / 2, -D / 2) },
    { geo: new THREE.BoxGeometry((W - 1.5) / 2, H, 0.15), matrix: mat4(-(W / 2 - (W - 1.5) / 4), H / 2, D / 2) },
    { geo: new THREE.BoxGeometry((W - 1.5) / 2, H, 0.15), matrix: mat4(W / 2 - (W - 1.5) / 4, H / 2, D / 2) },
    { geo: new THREE.BoxGeometry(1.5, H - 2.35, 0.15), matrix: mat4(0, 2.35 + (H - 2.35) / 2, D / 2) },
    // Gables
    { geo: gable(W, 1.2), matrix: mat4(0, H, D / 2) },
    { geo: gable(W, 1.2), matrix: mat4(0, H, -D / 2) },
    { geo: new THREE.BoxGeometry(W + 0.3, 0.2, D + 0.2), matrix: mat4(0, 0.02, 0) },
  ];
  const walls = mergeParts(wallParts);
  walls.applyMatrix4(sm);
  batcher.add(walls, M.wood);
  collider.addGeometry(walls);
  const roofParts = [-1, 1].map((s) => ({ geo: new THREE.BoxGeometry(W / 2 / Math.cos(0.56) + 0.4, 0.08, D + 0.6), matrix: mat4(s * W / 4, H + 0.6, 0, 0, 1, 1, 1, 0, -s * 0.56) }));
  const roof = mergeParts(roofParts);
  roof.applyMatrix4(sm);
  batcher.add(roof, M.darkMetal, null, 0x7a5a48);
  // Plate against the back half, car behind it inside the shed.
  const platePos = new THREE.Vector3(0, 0.12, -0.05).applyMatrix4(sm);
  // Dim bulb inside the shed.
  const bulbPos = new THREE.Vector3(0, H - 0.3, 1.3).applyMatrix4(sm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.1, 1.1) }));
  bulb.position.copy(bulbPos);
  ctx.surface.add(bulb);

  // ---- Observatory ----
  const oy = stack.heightAt(sx, sz);
  const lastLeg = legs[legs.length - 2];
  ctx.observatory = placeObservatory(ctx, ctx.observatoryAsset, { center: new THREE.Vector3(sx, oy, sz), doorAngle: lastLeg[0], collider });

  // ---- Vegetation ----
  const rng = new Rng(cfg.seed * 3);
  const clear = (x, z) => {
    path.closest(x, z, q);
    if (q.d < 2.8) return false;
    if (Math.hypot(x - shed.x, z - shed.z) < 7) return false;
    return Math.hypot(x - sx, z - sz) > 14;
  };
  for (const p of scatter(stack, 55, rng, (x, z) => clear(x, z) && Math.hypot(x - sx, z - sz) > 24, { margin: 4 })) {
    const sp = rng.next() < 0.75 ? 'pine' : 'broadleaf';
    const s = rng.float(0.7, 1.15);
    ctx.forest.add(sp, p.x, p.y, p.z, s);
    collider.addCylinder(p.x, p.y - 0.5, p.z, ctx.forest.radiusOf(sp) * s + 0.08, 4, 6);
  }
  for (const p of scatter(stack, 45, rng, clear, { margin: 2 })) ctx.forest.add('shrub', p.x, p.y, p.z, rng.float(0.6, 1.1));
  for (const p of scatter(stack, 5200, rng, (x, z) => { path.closest(x, z, q); return q.d > 1.2 && Math.hypot(x - sx, z - sz) > 6.7; }, { margin: 1.2, tries: 3 })) {
    const n = stack.normalAt(p.x, p.z);
    if (n.y > 0.7) ctx.meadow.add(p.x, p.y, p.z, rng.float(0.7, 1.2));
  }
  ctx.pebbles.scatter(stack, 90, rng, clear);

  const props = batcher.build(stack.group, { name: 'mountain-props' });
  // From other stacks the props are one merged stand-in (see render/lod.js).
  ctx.lod.addFarProxy(props.filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'mountain-props' });
  ctx.surface.add(stack.group);
  ctx.physics.addCollider(collider.build(), 'surface');

  createElevator(ctx, {
    id: 'mountain',
    ends: {
      top: { pos: platePos, rotY: shedRot, zone: 'surface', parent: ctx.surface, collider: ctx.lateCollider('mountain-car') },
      bottom: ctx.tunnelStation('mountain'),
    },
  });
  stack.trail = path;   // the switchback path from the shed to the observatory
  stack.shed = { x: shed.x, z: shed.z, rot: shedRot, door: door, platePos };
  ctx.stacks.mountain = stack;
  return stack;
}

function gable(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.15, bevelEnabled: false });
  g.translate(0, 0, -0.075);
  return g;
}
