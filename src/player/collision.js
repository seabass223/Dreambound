import * as THREE from 'three';

const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triP = new THREE.Vector3();
const _capP = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();

// Static BVH colliders (activated by proximity/zone) plus a handful of dynamic primitives.
export class Physics {
  constructor() {
    this.colliders = [];  // { name, bvh, box, enabled }
    this.dynamic = [];    // circles and oriented boxes
    this.ladders = [];
  }

  addCollider(c, zone = 'surface') {
    if (!c) return;
    c.zone = zone;
    c.enabled = true;
    this.colliders.push(c);
    return c;
  }

  addCircle(o) { const c = { type: 'circle', enabled: true, ...o }; this.dynamic.push(c); return c; }
  addOBB(o) { const c = { type: 'obb', enabled: true, ry: 0, ...o }; this.dynamic.push(c); return c; }

  active(pos, zone) {
    const out = [];
    for (const c of this.colliders) {
      if (!c.enabled || c.zone !== zone) continue;
      if (c.box.containsPoint(pos)) out.push(c);
    }
    return out;
  }

  // Resolve a capsule (feet position, radius, height) against the world. Returns contacts for dynamic pushes.
  resolveCapsule(feet, radius, height, zone, contacts) {
    _seg.start.set(feet.x, feet.y + radius, feet.z);
    _seg.end.set(feet.x, feet.y + height - radius, feet.z);
    const act = this.active(feet, zone);
    for (let pass = 0; pass < 2; pass++) {
      for (const c of act) {
        _box.makeEmpty();
        _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
        _box.min.addScalar(-radius); _box.max.addScalar(radius);
        c.bvh.shapecast({
          intersectsBounds: (b) => b.intersectsBox(_box),
          intersectsTriangle: (tri) => {
            const dist = tri.closestPointToSegment(_seg, _triP, _capP);
            if (dist < radius) {
              const depth = radius - dist;
              _dir.subVectors(_capP, _triP);
              if (_dir.lengthSq() < 1e-10) tri.getNormal(_dir); else _dir.normalize();
              if (_dir.y > 0.6) {
                // Walkable: push straight up so we don't creep down slopes.
                const up = Math.min(depth / _dir.y, radius);
                _seg.start.y += up; _seg.end.y += up;
              } else {
                _seg.start.addScaledVector(_dir, depth);
                _seg.end.addScaledVector(_dir, depth);
              }
            }
            return false;
          },
        });
      }
    }
    feet.set(_seg.start.x, _seg.start.y - radius, _seg.start.z);

    for (const d of this.dynamic) {
      if (!d.enabled || (d.zone && d.zone !== zone)) continue;
      if (feet.y + height < d.y0 || feet.y > d.y1) continue;
      if (d.type === 'circle') {
        const dx = feet.x - d.x, dz = feet.z - d.z;
        const dist = Math.hypot(dx, dz), min = d.r + radius;
        if (dist < min && dist > 1e-5) {
          const k = (min - dist) / dist;
          feet.x += dx * k; feet.z += dz * k;
          if (contacts) contacts.push({ collider: d, nx: -dx / dist, nz: -dz / dist });
        }
      } else {
        const c = Math.cos(d.ry), s = Math.sin(d.ry);
        const rx = feet.x - d.x, rz = feet.z - d.z;
        const lx = c * rx - s * rz, lz = s * rx + c * rz;
        const px = Math.max(-d.hx, Math.min(d.hx, lx)), pz = Math.max(-d.hz, Math.min(d.hz, lz));
        let ox = lx - px, oz = lz - pz;
        let dist = Math.hypot(ox, oz);
        if (dist < radius) {
          if (dist < 1e-5) {
            // Center inside the box: push out along the shallowest axis.
            const ex = d.hx - Math.abs(lx), ez = d.hz - Math.abs(lz);
            if (ex < ez) { ox = Math.sign(lx) || 1; oz = 0; dist = -ex; } else { ox = 0; oz = Math.sign(lz) || 1; dist = -ez; }
          } else { ox /= dist; oz /= dist; }
          const push = radius - dist;
          const wx = c * ox + s * oz, wz = -s * ox + c * oz;
          feet.x += wx * push; feet.z += wz * push;
        }
      }
    }
  }

  raycastDown(pos, maxDist, zone) {
    _ray.origin.set(pos.x, pos.y + 0.5, pos.z);
    _ray.direction.set(0, -1, 0);
    let best = null;
    for (const c of this.active(pos, zone)) {
      const hit = c.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist + 0.5);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
}
