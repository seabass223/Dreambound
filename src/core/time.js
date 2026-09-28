import * as THREE from 'three';
import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { clamp } from './rng.js';

const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
const DAY_FRAC = DAY_SECONDS / CYCLE;
const MAX_ALT = THREE.MathUtils.degToRad(58);
const NIGHT_DEPTH = THREE.MathUtils.degToRad(42);

// Day/night clock. `phase` is 0..1 over one full cycle; 0 = sunrise.
export class DayClock {
  constructor() {
    const params = new URLSearchParams(location.search);
    // Start in the golden hour, ~50 s before sunset, unless overridden with ?t=0..1.
    this.phase = params.has('t') ? parseFloat(params.get('t')) : DAY_FRAC * 0.885;
    this.speed = params.has('speed') ? parseFloat(params.get('speed')) : 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.altitude = 0; // radians, negative at night
    this.update(0);
  }

  update(dt) {
    this.phase = (this.phase + (dt * this.speed) / CYCLE) % 1;
    const p = this.phase;
    let alt, az;
    if (p < DAY_FRAC) {
      const q = p / DAY_FRAC;
      alt = MAX_ALT * Math.pow(Math.sin(Math.PI * q), 1.5);
      az = Math.PI * q; // east -> west across the south
    } else {
      const q = (p - DAY_FRAC) / (1 - DAY_FRAC);
      alt = -NIGHT_DEPTH * Math.pow(Math.sin(Math.PI * q), 1.5);
      az = Math.PI + Math.PI * q;
    }
    this.altitude = alt;
    // az = 0 rises in +X (east), az = π sets in -X (west), passing through -Z (south-ish, tilted).
    const ca = Math.cos(alt);
    this.sunDir.set(Math.cos(az) * ca, Math.sin(alt), -Math.sin(az) * ca * 0.55 + 0.18).normalize();
    // Moon rides roughly opposite the sun, lifted so it's up for most of the night.
    this.moonDir.set(-this.sunDir.x, Math.abs(this.sunDir.y) * 0.9 + 0.22, -this.sunDir.z + 0.35).normalize();
  }

  get altDeg() { return THREE.MathUtils.radToDeg(this.altitude); }
  // 0 at full day, 1 at deep night.
  get night() { return clamp((-this.altDeg - 2) / 12, 0, 1); }
  get dayness() { return clamp((this.altDeg + 4) / 14, 0, 1); }
}
