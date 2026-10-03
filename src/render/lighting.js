import * as THREE from 'three';
import { atmo, atmoState } from './atmosphere.js';
import { clamp } from '../core/rng.js';

// Sun/moon directional light with a player-following shadow frustum, hemisphere fill, and a
// sky-rendered environment map refreshed every few seconds for image-based lighting.
export function createLighting(renderer, scene, sky) {
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 55;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x8899bb, 0x2a2418, 0.4);
  scene.add(hemi);

  // The sky is rendered into a cube and filtered into the same PMREM target every time: PMREMGenerator.fromScene
  // allocates a new target on every call, a GPU allocation (and a free) mid-game every few seconds.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cube = new THREE.CubeCamera(0.1, 100, new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false }));
  let envRT = null;
  let envTimer = 0;
  const refreshEnv = () => {
    cube.update(renderer, sky.envScene);
    envRT = pmrem.fromCubemap(cube.renderTarget.texture, envRT);
    scene.environment = envRT.texture;
    return envRT;
  };
  refreshEnv();

  const tmp = new THREE.Vector3();
  const lightCol = new THREE.Color();
  let snap = (S * 2) / sun.shadow.mapSize.x;
  // Shadow quality (Menu > Graphics > Shadows): the map's size, the same frustum. Only the map is reallocated (on its
  // next update): no shader changes, so nothing recompiles.
  const SHADOW_SIZE = { low: 1024, medium: 2048, high: 4096 };
  const setShadowQuality = (q) => {
    const n = Math.min(SHADOW_SIZE[q] ?? 2048, renderer.capabilities.maxTextureSize);
    if (sun.shadow.mapSize.x === n) return;
    sun.shadow.mapSize.set(n, n);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.needsUpdate = true;
    snap = (S * 2) / n;
  };

  const api = {
    sun, hemi, refreshEnv, setShadowQuality,
    // While true the environment map isn't re-rendered (it waits, and refreshes as soon as it is false): the storm
    // (render/storm.js) holds it through a lightning flash, which lights the sky colours it is rendered from for a
    // few frames only, and would otherwise stay in the map for seconds.
    envHold: false,
    update(dt, clock, focus, underground) {
      const sunUp = clock.sunDir.y > -0.03;
      const dir = sunUp ? clock.sunDir : clock.moonDir;
      // Snap the shadow center to texel increments to avoid shimmering.
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(fx, focus.y, fz);
      tmp.copy(dir).multiplyScalar(200);
      sun.position.set(fx + tmp.x, focus.y + tmp.y, fz + tmp.z);

      if (sunUp) {
        lightCol.copy(atmo.uSunLight.value);
        // Horizon fade for the sun itself.
        lightCol.multiplyScalar(clamp((clock.sunDir.y + 0.03) / 0.06, 0, 1));
      } else {
        lightCol.copy(atmoState.moonLight).multiplyScalar(clock.night * clamp(clock.moonDir.y * 3, 0, 1));
      }
      const inten = Math.max(lightCol.r, lightCol.g, lightCol.b);
      sun.color.copy(lightCol).multiplyScalar(inten > 0 ? 1 / inten : 0);
      sun.intensity = underground ? 0 : inten;
      sun.shadow.autoUpdate = !underground && inten > 0.01; // toggling castShadow would recompile shaders
      // The shadow map is only allocated on its first update; without one, every shadow-receiving material fails
      // to draw (starting underground, or at night).
      if (!sun.shadow.map) sun.shadow.needsUpdate = true;

      const amb = atmo.uAmbient.value;
      hemi.color.copy(amb).multiplyScalar(2.2);
      hemi.groundColor.setRGB(amb.r * 0.5, amb.g * 0.42, amb.b * 0.3);
      // Deeper contrast near dawn/dusk: less fill while the sun is low.
      const low = 1 - clamp(Math.abs(clock.altDeg - 1) / 12, 0, 1);
      hemi.intensity = underground ? 0 : 0.6 - low * 0.25;
      scene.environmentIntensity = underground ? 0 : 0.55 - low * 0.2;

      envTimer -= dt;
      if (envTimer <= 0 && !underground && !api.envHold) { envTimer = 2.5; refreshEnv(); }
    },
  };
  return api;
}
