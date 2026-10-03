import * as THREE from 'three';
import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { clamp } from './rng.js';

const CYCLE = DAY_SECONDS + NIGHT_SECONDS;
const DAY_FRAC = DAY_SECONDS / CYCLE;
const MAX_ALT = THREE.MathUtils.degToRad(58);
const NIGHT_DEPTH = THREE.MathUtils.degToRad(42);

const wrap = (p) => (p >= 0 && p < 1 ? p : ((p % 1) + 1) % 1);   // (in range: exactly as given)

// Day/night clock. `phase` is 0..1 over one full cycle; 0 = sunrise.
export class DayClock {
  constructor() {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    // Start in the golden hour, ~50 s before sunset, unless overridden with ?t=0..1.
    this.phase = params.has('t') ? parseFloat(params.get('t')) : DAY_FRAC * 0.885;
    this.speed = params.has('speed') ? parseFloat(params.get('speed')) : 1;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.altitude = 0; // radians, negative at night
    // A story hold (holdAt): { from, delta, target, t, dur }, or null while the clock runs.
    this.hold = null;
    this.update(0);
  }

  // Ease to `phase` over `seconds` and stay there, whatever `speed` says (the settings' Pause switch and Reset write
  // it), until release(). The way round is forward, as time goes, unless that is nearly a whole turn (> 0.85): then
  // back the short way. 0 s: there at once.
  holdAt(phase, seconds = 0) {
    const target = wrap(phase);
    let delta = wrap(target - this.phase);
    if (delta > 0.85) delta -= 1;
    const dur = Math.max(0, seconds || 0);
    this.hold = { from: this.phase, delta, target, t: 0, dur };
    this.update(0);
  }
  get held() { return !!this.hold; }
  release() { this.hold = null; }

  update(dt) {
    const h = this.hold;
    if (h) {
      h.t = Math.min(h.dur, h.t + Math.max(0, dt));
      const k = h.dur > 0 ? h.t / h.dur : 1;
      this.phase = k >= 1 ? h.target : wrap(h.from + h.delta * k * k * (3 - 2 * k));
    } else {
      this.phase = (this.phase + (dt * this.speed) / CYCLE) % 1;
    }
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
