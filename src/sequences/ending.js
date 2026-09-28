import * as THREE from 'three';
import { smoothstep, Rng } from '../core/rng.js';
import { Textures } from '../render/textures.js';
import { atmo } from '../render/atmosphere.js';
import { createClock } from '../props/clock.js';

const steamVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (900.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const steamFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uAmbient;
uniform vec3 uSunLight;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.003) discard;
  vec3 col = uAmbient * 2.6 + uSunLight * 0.18 + 0.05;
  gl_FragColor = vec4(col, a);
}
`;

function createSteam(center) {
  const N = 520;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const vel = new Float32Array(N * 3), life = new Float32Array(N), delay = new Float32Array(N);
  const r = new Rng(77);
  for (let i = 0; i < N; i++) {
    const a = r.float(0, Math.PI * 2);
    const up = r.float(0.4, 1);
    const sp = r.float(2, 11);
    vel[i * 3] = Math.cos(a) * sp * (1.1 - up * 0.6);
    vel[i * 3 + 1] = sp * up * 1.3;
    vel[i * 3 + 2] = Math.sin(a) * sp * (1.1 - up * 0.6);
    pos.set([center.x + Math.cos(a) * r.float(0, 1.2), center.y - 0.3, center.z + Math.sin(a) * r.float(0, 1.2)], i * 3);
    life[i] = r.float(4, 9);
    delay[i] = Math.pow(r.next(), 2) * 1.8;
    size[i] = r.float(0.6, 1.4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: Textures.puff() }, uAmbient: atmo.uAmbient, uSunLight: atmo.uSunLight },
    vertexShader: steamVert, fragmentShader: steamFrag, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 6;
  const base = size.slice();
  let t = 0;
  return {
    points,
    update(dt) {
      t += dt;
      for (let i = 0; i < N; i++) {
        const age = t - delay[i];
        if (age < 0) { alpha[i] = 0; continue; }
        const k = age / life[i];
        const drag = Math.exp(-dt * 1.4);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        vel[i * 3 + 1] = vel[i * 3 + 1] * drag + dt * 0.8; // buoyant
        pos[i * 3] += (vel[i * 3] + atmo.uWind.value.x * 0.6) * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += (vel[i * 3 + 2] + atmo.uWind.value.y * 0.6) * dt;
        size[i] = base[i] * (1 + age * 1.6);
        alpha[i] = Math.max(0, Math.min(1, age * 4) * (1 - k)) * 0.55;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    },
  };
}

// The clock and the steam, made up front and hidden (the preloader compiles and uploads them with everything else):
// built as the ending starts, their shaders and buffers would stall its first frames.
export function prepareEnding(ctx) {
  if (ctx.endingProps || !ctx.aperture) return ctx.endingProps;
  const center = ctx.aperture.center;
  const clock = createClock();
  clock.position.set(center.x, center.y - 2.5, center.z);
  clock.visible = false;
  const steam = createSteam(center);
  steam.points.visible = false;
  ctx.surface.add(clock, steam.points);
  return (ctx.endingProps = { clock, steam });
}

// The aperture opens, steam blasts out, and a 70s alarm clock rises, rings, and wakes you.
export function createEnding(ctx) {
  const { player, fx, audio, aperture } = ctx;
  const center = aperture.center.clone();
  let t = 0;
  player.canMove = false;
  const props = prepareEnding(ctx);
  const clock = props.clock;
  clock.visible = true;
  let steam = null;
  const fired = {};
  const once = (k, at, f) => { if (!fired[k] && t >= at) { fired[k] = true; f(); } };
  const look = new THREE.Vector3();
  return {
    done: false,
    update(dt) {
      t += dt;
      once('rumble', 0, () => audio.play('rumble', { duration: 4.5, peak: 0.7 }));
      once('grind', 1.2, () => audio.play('grind', { duration: 2.8 }));
      once('steam', 2.7, () => {
        audio.play('steam', { duration: 7 });
        steam = props.steam;
        steam.points.visible = true;
      });
      once('alarm', 11, () => audio.play('alarm', { duration: 7 }));

      aperture.set(smoothstep(1.2, 4.0, t));
      steam?.update(dt);

      // Clock rises out of the pit and hovers.
      const rise = smoothstep(3.6, 8.5, t);
      const hover = Math.sin(t * 1.3) * 0.06 * rise;
      const shakeK = smoothstep(11, 17.5, t);
      const jitter = shakeK * shakeK * 0.09;
      clock.position.set(
        center.x + (Math.random() - 0.5) * jitter,
        center.y - 2.5 + rise * 4.1 + hover + (Math.random() - 0.5) * jitter,
        center.z + (Math.random() - 0.5) * jitter,
      );
      // Face the player.
      const toP = Math.atan2(player.feet.x - center.x, player.feet.z - center.z);
      clock.rotation.set((Math.random() - 0.5) * jitter * 2, toP + Math.sin(t * 0.4) * 0.15 * (1 - shakeK), (Math.random() - 0.5) * jitter * 3);

      // Camera: rumble, blast, then escalating shake.
      player.shake = smoothstep(0, 2.5, t) * 0.35 * (1 - smoothstep(4, 7, t)) + smoothstep(2.6, 2.8, t) * (1 - smoothstep(2.8, 5, t)) * 0.9 + shakeK * shakeK * 2.2;
      // Gently draw the gaze to the clock.
      look.copy(clock.position).sub(player.camera.position);
      const wantYaw = Math.atan2(-look.x, -look.z);
      const wantPitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
      const pull = smoothstep(3.5, 9, t) * dt * 1.2;
      let dy = wantYaw - player.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      player.yaw += dy * pull;
      player.pitch += (wantPitch - player.pitch) * pull;

      // Bloom to white.
      fx.bloomStrength = 0.35 + smoothstep(12, 17.5, t) * 2.5;
      fx.white = smoothstep(14.8, 18, t);
      fx.blur = smoothstep(15, 18, t) * 0.8;
      if (t > 18) {
        audio.master?.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.8);
        player.shake = 0;
      }
      if (t > 21) this.done = true;
    },
  };
}
