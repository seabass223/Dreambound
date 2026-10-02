import * as THREE from 'three';

// A fixed set of point lights shared by every interior (the cabin, the observatory). Only the interior
// nearest the player is lit, so the number of lights, and with it every compiled shader, never changes.
export class LightPool {
  constructor(scene, count = 4) {
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 1.8);
      scene.add(l);
      this.lights.push(l);
    }
    this.sites = [];
    this.active = null;
  }

  // site: { center: Vector3, radius, lights: [{ pos: Vector3, color: Color, distance, intensity: () => number }], claim? }
  // Sites are picked by distance from their edge. A site with claim(focus) is never picked that way: it takes the pool
  // outright while claim says so (a room that must be lit exactly while you're in it, however near another site is).
  add(site) {
    this.sites.push(site);
    return site;
  }

  update(focus) {
    let best = null, bd = Infinity;
    for (const s of this.sites) {
      if (s.claim) { if (s.claim(focus)) { best = s; break; } continue; }
      const d = s.center.distanceTo(focus) - s.radius;
      if (d < bd) { bd = d; best = s; }
    }
    if (best !== this.active) {
      this.active = best;
      this.lights.forEach((l, i) => {
        const src = best?.lights[i];
        if (!src) return;
        l.position.copy(src.pos);
        l.color.copy(src.color);
        l.distance = src.distance;
      });
    }
    this.lights.forEach((l, i) => {
      const src = best?.lights[i];
      l.intensity = src ? src.intensity() : 0;
    });
  }
}
