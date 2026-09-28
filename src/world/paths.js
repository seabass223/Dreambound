import * as THREE from 'three';

// A polyline path in world XZ with optional per-point heights; used to carve terrain and drape trails.
export class Path {
  constructor(points, width = 1.6) {
    this.pts = points.map((p) => ({ x: p[0], z: p[1], y: p[2] ?? null }));
    this.width = width;
    this.len = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.len.push(this.len[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.total = this.len[this.len.length - 1];
    this.box = new THREE.Box2();
    for (const p of this.pts) this.box.expandByPoint(new THREE.Vector2(p.x, p.z));
  }

  // Returns { d, t, y } — distance to the path, arc length at the closest point, interpolated height.
  closest(x, z, out = {}) {
    let best = Infinity, bt = 0, by = null;
    if (x < this.box.min.x - 12 || x > this.box.max.x + 12 || z < this.box.min.y - 12 || z > this.box.max.y + 12) {
      out.d = Infinity; out.t = 0; out.y = null; return out;
    }
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1e-6;
      let u = ((x - a.x) * dx + (z - a.z) * dz) / l2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = a.x + dx * u, pz = a.z + dz * u;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        bt = this.len[i - 1] + (this.len[i] - this.len[i - 1]) * u;
        by = a.y !== null && b.y !== null ? a.y + (b.y - a.y) * u : null;
      }
    }
    out.d = best; out.t = bt; out.y = by;
    return out;
  }

  pointAt(t) {
    t = Math.max(0, Math.min(this.total, t));
    let i = 1;
    while (i < this.len.length - 1 && this.len[i] < t) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const u = (t - this.len[i - 1]) / ((this.len[i] - this.len[i - 1]) || 1);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, y: a.y !== null ? a.y + (b.y - a.y) * u : null, dx: b.x - a.x, dz: b.z - a.z };
  }

  // Resample a smooth version (Catmull-Rom through the points) at a given spacing.
  static smooth(points, spacing = 2, width = 1.6) {
    const v = points.map((p) => new THREE.Vector3(p[0], p[2] ?? 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal');
    const n = Math.max(2, Math.ceil(curve.getLength() / spacing));
    const hasY = points.every((p) => p[2] !== undefined);
    return new Path(curve.getSpacedPoints(n).map((p) => (hasY ? [p.x, p.z, p.y] : [p.x, p.z])), width);
  }
}
