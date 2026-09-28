import * as THREE from 'three';

// Center-of-screen interaction: Space / E / left click on whatever small thing you're looking at.
export class Interactions {
  constructor(camera) {
    this.camera = camera;
    this.items = [];
    this.ray = new THREE.Raycaster();
    this.held = null;
    this.center = new THREE.Vector2(0, 0);
    this.enabled = true;
  }

  add(item) {
    const it = { range: 2.6, enabled: true, zone: null, ...item };
    for (const m of it.meshes) m.userData.interact = it;
    this.items.push(it);
    return it;
  }

  pick() {
    const meshes = [];
    for (const it of this.items) if (it.enabled) for (const m of it.meshes) if (m.visible !== false) meshes.push(m);
    this.ray.setFromCamera(this.center, this.camera);
    this.ray.far = 4;
    const hits = this.ray.intersectObjects(meshes, false);
    for (const h of hits) {
      const it = h.object.userData.interact;
      if (h.distance <= it.range) return { item: it, hit: h };
    }
    return this.pickNear(meshes);
  }

  // Fallback when the ray misses: the closest item within a narrow cone of the view direction.
  pickNear(meshes) {
    const origin = this.ray.ray.origin, dir = this.ray.ray.direction;
    const c = new THREE.Vector3(), box = new THREE.Box3();
    let best = null, bestAngle = 0.13; // ~7.5 degrees
    for (const m of meshes) {
      // `exact` items (e.g. small buttons you aim at with the reticle) only respond to a direct hit.
      if (m.userData.interact.exact) continue;
      box.setFromObject(m);
      box.getCenter(c);
      const it = m.userData.interact;
      c.sub(origin);
      const d = c.length();
      if (d > it.range || d < 1e-3) continue;
      const ang = Math.acos(Math.min(1, c.dot(dir) / d));
      if (ang < bestAngle) { bestAngle = ang; best = { item: it, hit: { object: m, distance: d, point: origin.clone().add(c) } }; }
    }
    return best;
  }

  press() {
    if (!this.enabled) return false;
    const p = this.pick();
    if (!p) return false;
    this.held = p.item;
    p.item.onPress?.(p.hit);
    return true;
  }

  release() {
    const h = this.held;
    this.held = null;
    h?.onRelease?.();
  }
}
