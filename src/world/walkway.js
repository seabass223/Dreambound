import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials } from '../render/materials.js';
import { Rng } from '../core/rng.js';

// A walkway of cut limestone slabs laid along a path over a stack's cap (the Home stack's, from the trail at the dome
// door round the dome to the deck track: world/stacks/dome.js). Rows square across the path, 42-70 cm long with
// 5-8 cm soil joints between; a row is one slab across, or two split somewhere near the middle. Each slab sits on the
// ground (its top 2.5 cm proud), tilted with it and a hair off square, its texture and tint its own. Over the last
// `fade` metres the rows turn into stepping stones, narrower and further apart, running out into the ground.
//
// Returns { on(x, z): whether (x, z) is on a slab's row (for footsteps and to keep grass and stones off it) }.
export function buildWalkway(stack, path, batcher, { width = 1.1, fade = 4, seed = 1 } = {}) {
  const M = materials();
  const rng = new Rng(seed);
  const THICK = 0.07, PROUD = 0.025;
  const up = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), e = new THREE.Euler();
  const n = new THREE.Vector3(), tx = new THREE.Vector3(), tz = new THREE.Vector3(), b = new THREE.Matrix4();
  const ground = (x, z) => stack.heightAt(x, z) ?? stack.heightAtAnalytic(x, z);
  const rows = [];   // [t0, t1, half width] of each row, for on()

  const slab = (x, z, along, across, yaw) => {
    // The ground's slope under it: its normal from four samples.
    const s = 0.3, ca = Math.cos(yaw), sa = Math.sin(yaw);
    const hx = ground(x + ca * s, z - sa * s) - ground(x - ca * s, z + sa * s);
    const hz = ground(x + sa * s, z + ca * s) - ground(x - sa * s, z - ca * s);
    tx.set(ca * 2 * s, hx, -sa * 2 * s).normalize();
    tz.set(sa * 2 * s, hz, ca * 2 * s).normalize();
    n.crossVectors(tz, tx).normalize();
    tz.crossVectors(tx, n).normalize();   // (square again: a proper rotation)
    b.makeBasis(tx, n, tz);
    q.setFromRotationMatrix(b).multiply(new THREE.Quaternion().setFromEuler(e.set(rng.float(-0.01, 0.01), 0, rng.float(-0.01, 0.01))));
    const y = ground(x, z) + PROUD - THICK / 2;
    m.compose(new THREE.Vector3(x, y, z), q, up.set(1, 1, 1));
    const g = new RoundedBoxGeometry(across, THICK, along, 1, 0.012);
    // Texture in metres (the top), each slab from its own part of the tile; a tint of its own.
    const P = g.attributes.position, uv = g.attributes.uv, ou = rng.next(), ov = rng.next(), rot = rng.next() < 0.5;
    for (let i = 0; i < P.count; i++) {
      const a = P.getX(i), c = P.getZ(i);
      uv.setXY(i, ou + (rot ? c : a), ov + (rot ? a : c));
    }
    const k = rng.float(0.6, 0.8), warm = rng.float(0.96, 1.05);   // (weathered buff and grey, not new-cut white)
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) col.set([k * warm, k, k * (2 - warm) * 0.98], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    batcher.add(g, M.limestone, m);
  };

  const fadeFrom = path.total - fade;
  let t = 0.1;
  while (t < path.total - 0.3) {
    const stepping = t > fadeFrom;
    const f = stepping ? (t - fadeFrom) / fade : 0;
    const along = stepping ? rng.float(0.42, 0.55) : rng.float(0.42, 0.7);
    const tc = t + along / 2;
    const p = path.pointAt(tc), len = Math.hypot(p.dx, p.dz) || 1;
    const dx = p.dx / len, dz = p.dz / len;
    const yaw = Math.atan2(dx, dz) + rng.float(-0.03, 0.03);
    const sx = dz, sz = -dx;   // across (to the path's right)
    if (stepping) {
      // One stone, narrower as it goes, a little off the centre line.
      const w = width * (0.62 - 0.2 * f), off = rng.float(-0.12, 0.12);
      slab(p.x + sx * off, p.z + sz * off, along, w, yaw);
      rows.push([t, t + along, w / 2 + Math.abs(off)]);
      t += along + 0.25 + f * 0.35 + rng.float(0, 0.1);
      continue;
    }
    if (rng.next() < 0.6) slab(p.x, p.z, along, width, yaw);
    else {
      // Two across, split somewhere near the middle.
      const joint = 0.04, a = width * rng.float(0.35, 0.65) - joint / 2, c = width - a - joint;
      const oa = -width / 2 + a / 2, oc = width / 2 - c / 2;
      slab(p.x + sx * oa, p.z + sz * oa, along, a, yaw);
      slab(p.x + sx * oc, p.z + sz * oc, along, c, yaw);
    }
    rows.push([t, t + along, width / 2]);
    t += along + rng.float(0.05, 0.08);
  }

  const qp = {};
  return {
    on(x, z, margin = 0.06) {
      path.closest(x, z, qp);
      if (!(qp.d < width / 2 + margin + 0.2)) return false;
      for (const [t0, t1, hw] of rows) if (qp.t >= t0 - margin && qp.t <= t1 + margin) return qp.d < hw + margin;
      return false;
    },
  };
}
