import * as THREE from 'three';

const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triP = new THREE.Vector3();
const _capP = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ray = new THREE.Ray();

// Walkable slopes (colliders added with { maxSlope }, see resolveCapsule). A face whose normal (turned toward the
// capsule) has a y between WALL_NY and the collider's walkNY is a slope too steep to walk: the capsule may not gain
// height on it. Up to SLIDE_NY (50 degrees) it is ground you slide down (the controller caps the speed); steeper, it
// is a cliff you drop past. Faces steeper than WALL_NY (about 84 degrees: risers, walls, tree trunks) are no slope:
// they push out along the contact, so a step's edge is still climbed by rolling the capsule's foot over it.
const WALL_NY = 0.1;
export const SLIDE_NY = Math.cos(50 * Math.PI / 180);

// Static BVH colliders (activated by proximity/zone) plus a handful of dynamic primitives.
export class Physics {
  constructor() {
    this.colliders = [];  // { name, bvh, box, enabled, walkNY? }
    this.dynamic = [];    // circles and oriented boxes
    this.ladders = [];
  }

  // maxSlope (degrees): the steepest face the player can walk up on this collider (see resolveCapsule), where
  // where(x, z) (optional) is true. Elsewhere, and on a collider without one, the old rule holds: anything under about
  // 53 degrees is ground, and steeper faces push the capsule out along their normal.
  addCollider(c, zone = 'surface', { maxSlope, where } = {}) {
    if (!c) return;
    c.zone = zone;
    c.enabled = true;
    if (maxSlope !== undefined) { c.walkNY = Math.cos(THREE.MathUtils.degToRad(maxSlope)); c.slopeWhere = where ?? null; }
    this.colliders.push(c);
    return c;
  }

  // The walkable limit (a normal's y) of collider c at (x, z), or undefined where the old rule holds.
  limitAt(c, x, z) {
    return c.walkNY !== undefined && (!c.slopeWhere || c.slopeWhere(x, z)) ? c.walkNY : undefined;
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
  //
  // Each triangle within the radius pushes the capsule out. Ground (a contact whose direction is within the
  // collider's walkable slope, or within 53 degrees on a collider without one) pushes straight up, so standing on a
  // slope doesn't creep down it. On a collider with a walkable slope (walkNY), a face steeper than that (see
  // WALL_NY) pushes out level only: walking into it gains no height, and gravity (the controller) slides the capsule
  // down it. That holds for the face's edges too, so a steep hillside can't be climbed through its creases; a ridge or
  // a lip holds you up only where the contact itself points up within the limit (an edge that steep is itself no
  // steeper than the limit). Everything else pushes out along the contact: an edge below the capsule's middle (a
  // step's nosing) rolls it up and over the step.
  // info (optional, out): slide (touching a slope too steep to walk but not a cliff: SLIDE_NY), slideH (the largest
  // horizontal part of such a slope's normal, i.e. the sine of its angle).
  resolveCapsule(feet, radius, height, zone, contacts, info = null) {
    _seg.start.set(feet.x, feet.y + radius, feet.z);
    _seg.end.set(feet.x, feet.y + height - radius, feet.z);
    if (info) { info.slide = false; info.slideH = 0; }
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
              const lim = c.walkNY === undefined ? undefined : this.limitAt(c, _triP.x, _triP.z);
              _dir.subVectors(_capP, _triP);
              if (_dir.lengthSq() < 1e-10) tri.getNormal(_dir); else _dir.normalize();
              if (lim !== undefined && _dir.y >= 0 && _dir.y <= lim && tooSteep(tri, lim)) {
                // Too steep to walk: out along the level part of the contact only (|_dir.xz| >= sin(limit)).
                const h = Math.hypot(_dir.x, _dir.z), push = Math.min(depth / h, radius) / h;
                _seg.start.x += _dir.x * push; _seg.start.z += _dir.z * push;
                _seg.end.x += _dir.x * push; _seg.end.z += _dir.z * push;
                if (info && _n.y >= SLIDE_NY) { info.slide = true; info.slideH = Math.max(info.slideH, Math.sqrt(1 - _n.y * _n.y)); }
              } else if (_dir.y > (lim ?? 0.6)) {
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
          if (contacts) contacts.push({ collider: d, nx: -wx, nz: -wz });
        }
      }
    }
  }

  // The first ground below pos (from 0.5 m above it, down to maxDist below). The hit carries walkable: false when its
  // face is too steep to stand on (a collider with a walkable slope), and limited: true when it is on such a collider
  // where the slope rule applies (a hillside, not a cliff).
  raycastDown(pos, maxDist, zone) {
    _ray.origin.set(pos.x, pos.y + 0.5, pos.z);
    _ray.direction.set(0, -1, 0);
    let best = null;
    for (const c of this.active(pos, zone)) {
      const hit = c.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist + 0.5);
      if (hit && (!best || hit.distance < best.distance)) {
        best = hit;
        const lim = c.walkNY === undefined ? undefined : this.limitAt(c, hit.point.x, hit.point.z);
        best.walkable = lim === undefined || Math.abs(hit.face.normal.y) > lim;
        best.limited = lim !== undefined;
      }
    }
    return best;
  }

  // Whether a hillside lies under pos, however far down and whatever is nearer (a path's own collider laid over it):
  // anything of a collider with a walkable slope, where its slope rule applies (the Mountain's cap inside its rim).
  hillsideBelow(pos, zone) {
    _ray.origin.set(pos.x, pos.y + 0.5, pos.z);
    _ray.direction.set(0, -1, 0);
    for (const c of this.active(pos, zone)) {
      if (this.limitAt(c, pos.x, pos.z) !== undefined && c.bvh.raycastFirst(_ray, THREE.DoubleSide)) return true;
    }
    return false;
  }
}

// Whether a triangle is a slope too steep to walk on a collider whose walkable limit is lim (its normal turned
// toward the capsule, in _n, whose y the caller reads).
function tooSteep(tri, lim) {
  tri.getNormal(_n);
  if (_n.dot(_dir) < 0) _n.negate();
  return _n.y > WALL_NY && _n.y <= lim;
}
