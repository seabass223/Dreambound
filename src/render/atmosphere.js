import * as THREE from 'three';
import { clamp } from '../core/rng.js';

// Palette keyframes by sun altitude (degrees). Linear-light radiance values.
const KEYS = [
  { alt: -90, zen: [0.0015, 0.0025, 0.007], away: [0.003, 0.004, 0.009], sun: [0.004, 0.005, 0.011], glow: [0, 0, 0], light: [0.0, 0.0, 0.0], amb: [0.006, 0.008, 0.016] },
  { alt: -16, zen: [0.0022, 0.0035, 0.0095], away: [0.0045, 0.006, 0.013], sun: [0.006, 0.007, 0.015], glow: [0, 0, 0], light: [0.0, 0.0, 0.0], amb: [0.008, 0.011, 0.022] },
  { alt: -10, zen: [0.006, 0.011, 0.034], away: [0.012, 0.018, 0.045], sun: [0.03, 0.028, 0.05], glow: [0.01, 0.006, 0.01], light: [0, 0, 0], amb: [0.014, 0.02, 0.045] },
  { alt: -6, zen: [0.016, 0.03, 0.09], away: [0.03, 0.045, 0.11], sun: [0.16, 0.08, 0.1], glow: [0.06, 0.025, 0.03], light: [0, 0, 0], amb: [0.03, 0.04, 0.085] },
  { alt: -2.5, zen: [0.035, 0.06, 0.17], away: [0.11, 0.09, 0.19], sun: [0.55, 0.2, 0.12], glow: [0.35, 0.12, 0.05], light: [0.25, 0.08, 0.03], amb: [0.07, 0.07, 0.13] },
  { alt: 0.5, zen: [0.07, 0.11, 0.29], away: [0.3, 0.22, 0.36], sun: [1.2, 0.48, 0.16], glow: [1.1, 0.42, 0.12], light: [1.2, 0.45, 0.16], amb: [0.13, 0.12, 0.2] },
  { alt: 4, zen: [0.075, 0.13, 0.38], away: [0.36, 0.28, 0.48], sun: [1.45, 0.6, 0.22], glow: [1.25, 0.5, 0.17], light: [2.2, 1.1, 0.45], amb: [0.18, 0.17, 0.26] },
  { alt: 10, zen: [0.1, 0.2, 0.52], away: [0.46, 0.48, 0.66], sun: [1.2, 0.78, 0.46], glow: [0.95, 0.56, 0.3], light: [3.0, 2.05, 1.25], amb: [0.24, 0.27, 0.38] },
  { alt: 25, zen: [0.1, 0.26, 0.68], away: [0.5, 0.64, 0.86], sun: [0.8, 0.82, 0.86], glow: [0.5, 0.45, 0.35], light: [3.6, 3.2, 2.7], amb: [0.3, 0.38, 0.52] },
  { alt: 90, zen: [0.07, 0.22, 0.66], away: [0.45, 0.6, 0.85], sun: [0.62, 0.74, 0.9], glow: [0.4, 0.38, 0.32], light: [3.8, 3.6, 3.3], amb: [0.32, 0.4, 0.55] },
];

function sample(alt, key, out) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].alt < alt) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((alt - a.alt) / (b.alt - a.alt), 0, 1);
  const s = t * t * (3 - 2 * t);
  out.setRGB(a[key][0] + (b[key][0] - a[key][0]) * s, a[key][1] + (b[key][1] - a[key][1]) * s, a[key][2] + (b[key][2] - a[key][2]) * s);
  return out;
}

// Shared uniform objects; every shader that needs sky/fog state references these directly.
export const atmo = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uZenith: { value: new THREE.Color() },
  uHorizonAway: { value: new THREE.Color() },
  uHorizonSun: { value: new THREE.Color() },
  uSunGlow: { value: new THREE.Color() },
  uSunLight: { value: new THREE.Color() },
  uAmbient: { value: new THREE.Color() },
  uNight: { value: 0 },
  uTime: { value: 0 },
  uUnderground: { value: 0 },
  uFogDensity: { value: 0.00085 },
  uWind: { value: new THREE.Vector2(1, 0.3) },
  // Drawing-buffer height in pixels (particles keep a minimum on-screen size with it). Set by main.js each frame.
  uPxH: { value: 1080 },
  uCloudColor: { value: new THREE.Color() },
  // User fog controls.
  uFogLow: { value: 1.6 },
  uFogTint: { value: new THREE.Color(1, 1, 1) },
  // House interior volume: (x0, z0, x1, z1) and (floorY, eaveY, ridgeY, centerZ). Sky light is dimmed inside.
  uIntA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uIntB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uObsA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uObsB: { value: new THREE.Vector4(0, 0, 0, 0) },
  // The Tower bunker (world/bunker.js): its frame and its insides, for materials.js bunkerMask().
  uBunA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uBunB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uBunC: { value: new THREE.Vector4(0, 0, 0, 0) },
  uBunD: { value: new THREE.Vector4(0, 0, 0, 0) },
  // The Mountain's mine adit (props/mine.js): its frame and its drive, for materials.js mineMask().
  uMineA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uMineB: { value: new THREE.Vector4(0, 0, 0, 0) },
};

export const atmoState = {
  moonLight: new THREE.Color(0.32, 0.4, 0.62),
  exposure: 1,
};

const _c = new THREE.Color();

export function updateAtmosphere(clock, elapsed) {
  const alt = clock.altDeg;
  atmo.uSunDir.value.copy(clock.sunDir);
  atmo.uMoonDir.value.copy(clock.moonDir);
  sample(alt, 'zen', atmo.uZenith.value);
  sample(alt, 'away', atmo.uHorizonAway.value);
  sample(alt, 'sun', atmo.uHorizonSun.value);
  sample(alt, 'glow', atmo.uSunGlow.value);
  sample(alt, 'light', atmo.uSunLight.value);
  sample(alt, 'amb', atmo.uAmbient.value);
  // Average lit color of the cloud sea, used to dissolve cliff bases into it.
  const cc = atmo.uCloudColor.value;
  cc.copy(atmo.uZenith.value).lerp(atmo.uHorizonAway.value, 0.5).multiplyScalar(0.85)
    .add(_c.copy(atmo.uAmbient.value).multiplyScalar(0.55))
    .add(_c.copy(atmo.uSunLight.value).multiplyScalar(0.12));
  atmo.uNight.value = clock.night;
  atmo.uTime.value = elapsed;
  // Eye adaptation: open up at night, but keep it a deep blue night rather than a grey day.
  atmoState.exposure = 0.95 + clock.night * 1.9 + clamp((6 - alt) / 10, 0, 1) * 0.25;
}
