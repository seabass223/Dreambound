// Shared measuring helpers for anchors.mjs and routes.mjs.
import { createHash } from 'node:crypto';

export const TAU = Math.PI * 2;

// SHA-256 (hex, first 16 bytes) of a typed array's bytes, a string, or a list of numbers (as float64).
export function sha(v) {
  if (v == null) return null;
  const h = createHash('sha256');
  if (typeof v === 'string') h.update(v);
  else if (ArrayBuffer.isView(v)) h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  else h.update(Buffer.from(Float64Array.from(v.flat(Infinity)).buffer));
  return h.digest('hex').slice(0, 32);
}

export function stats(values) {
  const a = Float64Array.from(values).sort();
  const n = a.length;
  if (!n) return { n: 0 };
  let s = 0, s2 = 0;
  for (const v of a) { s += v; s2 += v * v; }
  const mean = s / n;
  const q = (p) => a[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return { n, mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), min: a[0], p5: q(0.05), p50: q(0.5), p95: q(0.95), max: a[n - 1] };
}

export const wrap = (a) => ((a % TAU) + TAU) % TAU;

// Reads a stack's built 'cliff' mesh as a polar surface: radius from the stack axis at (theta, y), by ray-casting
// the real triangles from the axis outward, plus the rim ring (row 0).
export class CliffSampler {
  constructor(THREE, MeshBVH, stack) {
    this.THREE = THREE;
    this.stack = stack;
    const mesh = stack.group.getObjectByName('cliff');
    this.geometry = mesh.geometry;
    this.bvh = new MeshBVH(mesh.geometry.clone());
    this.P = mesh.geometry.attributes.position.array;
    this.segs = stack.segs;
    this.W = stack.segs + 1;
    this.rows = this.P.length / 3 / this.W;
    this.ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
  }

  // Radius of the wall at angle theta and height y, or null where the ray passes above the rim.
  radiusAt(theta, y) {
    const s = this.stack, r = this.ray;
    r.origin.set(s.cx, y, s.cz);
    r.direction.set(Math.cos(theta), 0, Math.sin(theta));
    const hit = this.bvh.raycastFirst(r, this.THREE.DoubleSide);
    return hit ? hit.distance : null;
  }

  // Row-0 (rim) radius and height at angle theta, linear between columns.
  rim(theta) {
    const u = (wrap(theta) / TAU) * this.segs, j = Math.min(this.segs - 1, Math.floor(u)), f = u - j;
    const P = this.P, s = this.stack;
    const at = (c) => [Math.hypot(P[c * 3] - s.cx, P[c * 3 + 2] - s.cz), P[c * 3 + 1]];
    const [r0, y0] = at(j), [r1, y1] = at(j + 1);
    return { r: r0 + (r1 - r0) * f, y: y0 + (y1 - y0) * f };
  }

  // Wall radius at (theta, y); above the rim the rim radius stands in (anything outside it is in the open air).
  wallAt(theta, y) {
    return this.radiusAt(theta, y) ?? this.rim(theta).r;
  }
}
