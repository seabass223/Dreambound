import * as THREE from 'three';
import { FAR_BAND, farMaterial, mergeable } from '../../render/lod.js';
import { STACKS } from '../../config.js';
import { Rng, smoothstep, fbm2 } from '../../core/rng.js';
import { materials } from '../../render/materials.js';
import { Stack } from '../terrain.js';
import { Batcher, ColliderBuilder, mat4, mergeParts } from '../builders.js';
import { scatter } from '../features.js';
import { createAperture } from '../../props/aperture.js';

const HOLE = 1.75;

export function buildEnd(ctx) {
  const cfg = STACKS.end;
  const cx = cfg.x, cz = cfg.z;
  // The wall relief (WALLS.geo) cuts nothing in under the bridge landing (it may still stand out there).
  const thLanding = Math.atan2(-cfg.bridgeDir.z, -cfg.bridgeDir.x);
  const protect = [{ from: thLanding - 0.25, to: thLanding + 0.25, depth: 12, feather: 6, inward: true }];
  const stack = new Stack(cfg, { innerHole: HOLE, rings: 22, segs: 72, edgeAmp: 0.05, protect });
  stack.shapeFns.push((x, z, h) => {
    const d = Math.hypot(x - cx, z - cz);
    return THREE.MathUtils.lerp(h, cfg.top, 1 - smoothstep(3.4, 7, d));
  });
  // Balding grass: patchy, mostly dirt.
  const dirt = new THREE.Color(0.19, 0.15, 0.1);
  stack.colorFns.push((x, z, h, col) => {
    const n = fbm2(x * 0.18, z * 0.18, 3, 71) * 0.5 + 0.5;
    col.lerp(dirt, smoothstep(0.42, 0.62, n) * 0.85);
    const d = Math.hypot(x - cx, z - cz);
    if (d < 3.4) col.lerp(new THREE.Color(0.15, 0.12, 0.09), 0.8);
  });
  const collider = new ColliderBuilder('end');
  const batcher = new Batcher();
  stack.build(collider);
  const M = materials();

  // Paver bricks ringing the door.
  const brick = new THREE.BoxGeometry(0.42, 0.1, 0.2);
  const rng = new Rng(cfg.seed);
  const parts = [];
  for (let r0 = HOLE + 0.2; r0 < HOLE + 1.5; r0 += 0.22) {
    const n = Math.round((Math.PI * 2 * r0) / 0.44);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r0 * 3.1;
      const x = cx + Math.cos(a) * r0, z = cz + Math.sin(a) * r0;
      if (rng.next() < 0.06 && r0 > HOLE + 1) continue; // a few missing
      parts.push({ geo: brick, matrix: mat4(x, cfg.top - 0.03 + rng.float(-0.015, 0.015), z, -a + Math.PI / 2, 1, 1, 1, rng.float(-0.03, 0.03), rng.float(-0.03, 0.03)), color: new THREE.Color().setScalar(rng.float(0.8, 1.05)) });
    }
  }
  batcher.add(mergeParts(parts), M.pavers);

  const center = new THREE.Vector3(cx, cfg.top, cz);
  const aperture = createAperture(ctx, { center, radius: HOLE, parent: ctx.surface, batcher, collider });
  ctx.aperture = aperture;

  // Grass only in patches.
  for (const p of scatter(stack, 700, rng, (x, z) => fbm2(x * 0.18, z * 0.18, 3, 71) * 0.5 + 0.5 < 0.45 && Math.hypot(x - cx, z - cz) > 3.6, { margin: 1, tries: 6 })) {
    ctx.meadow.add(p.x, p.y, p.z, rng.float(0.6, 1.0));
  }
  ctx.pebbles.scatter(stack, 25, rng, (x, z) => Math.hypot(x - cx, z - cz) > 3.8);

  // Bridge landing, facing back to Rocks.
  const bdir = new THREE.Vector3(cfg.bridgeDir.x, 0, cfg.bridgeDir.z);
  const th = Math.atan2(-bdir.z, -bdir.x);
  const r = stack.edgeR(th) - 1.3;
  const bx = cx + Math.cos(th) * r, bz = cz + Math.sin(th) * r;
  const bridgeB = new THREE.Vector3(bx, (stack.heightAt(bx, bz) ?? stack.heightAtAnalytic(bx, bz)) + 0.05, bz);
  ctx.buildBridgeLater(bridgeB);

  const props = batcher.build(stack.group, { name: 'end-props' });
  // From other stacks the props are one merged stand-in (see render/lod.js).
  ctx.lod.addFarProxy(props.filter(mergeable), { parent: stack.group, band: FAR_BAND, material: farMaterial(), name: 'end-props' });
  ctx.surface.add(stack.group);
  ctx.physics.addCollider(collider.build(), 'surface');
  ctx.stacks.end = stack;
  return stack;
}
