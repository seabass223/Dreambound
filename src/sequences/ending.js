import * as THREE from 'three';
import { smoothstep, clamp, Rng } from '../core/rng.js';
import { Textures } from '../render/textures.js';
import { atmo } from '../render/atmosphere.js';
import { createClock } from '../props/clock.js';
import { createCredits } from '../ui/credits.js';

// The ending: the red button on the End stack's pedestal (props/pedestal.js; main.js's ctx.onPedestal starts this,
// and the pedestal clicks its own button). A main.js sequence ({ done, update(dt) }) timed from the press, t:
//   0      the button's glow goes out
//   0.45   the pedestal sinks into its hole (pedestalSink, 2.6 s)
//   2.4    a deep rumble under the island
//   3.3    the iris opens (grind)
//   4.4    light shafts rise out of the pit (shaftSwell), a slow glowing steam drifting up them
//   6.6    the alarm clock rises out of the pit showing 12:00 AM, its colon blinking; it turns to face the player and
//          drifts in to 2.2 m before the eyes, at eye height; the view eases onto it and narrows a little
//   10.4   the buzzer starts, faint and far away down a long dark reverb (buzzAlarm)
//   13.4   the count: 12:00 to 6:00 AM in 5 s, faster and faster; the shake and the bloom build
//   18.4   6:00. The reverb drains away, the buzzer dry and present: you're waking up
//   19.4   everything dark and silent at once
//   22.4   the credits roll (ui/credits.js); then "Thanks for playing" holds, until the page is reloaded
// The storm (render/storm.js) rages on until the dark. The camera is the sequence's from the press: the player's eye,
// held, the view drawn by a critically damped follow (no snaps) onto what matters. main.js sets `ended` as it starts
// this, and never nulls it: update() runs every frame for good, holding the black.

const T = {
  sink: 0.45, sinkDur: 2.6,
  rumble: 2.4,
  iris: [3.3, 6.1],
  shafts: [4.4, 9.8],
  steam: 4.9,
  rise: [6.6, 9.6],
  turn: [7.4, 10.2],
  drift: [9.8, 13.2],
  alarm: 10.4,
  count: [13.4, 18.4],
  dark: 19.4,
  credits: 22.4,
};
const NEAR = 2.2;          // m from the eyes the clock settles at
const COUNT_K = 5.6;       // the count's acceleration (exponential: ~1.5 min/s at first, ~400 at the end)

const steamVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlpha = aAlpha * smoothstep(1.2, 4.5, -mv.z);   // a wisp drifting past the lens thins out, not a fog over the view
  gl_PointSize = aSize * (900.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const steamFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uAmbient;
uniform vec3 uSunLight;
uniform vec3 uGlow;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.003) discard;
  vec3 col = uAmbient * 2.0 + uSunLight * 0.12 + 0.03 + uGlow;
  gl_FragColor = vec4(col, a);
}
`;

// Steam drifting up out of the pit inside the light shafts: wisps rising, spreading and swelling as they go, born
// again at the bottom when they fade (each on its own cycle), lit by the shafts (uGlow). Positions are worked out
// from each wisp's age (no integration), so it runs the same at any frame rate.
function createSteam(center) {
  const N = 360;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N);
  const P = [];
  const r = new Rng(77);
  for (let i = 0; i < N; i++) {
    P.push({
      a: r.float(0, Math.PI * 2), r0: Math.sqrt(r.next()) * 1.3, out: r.float(0.15, 0.7), up: r.float(0.9, 2.6),
      life: r.float(5, 9), delay: r.float(0, 3.5), size: r.float(0.7, 1.5), swirl: r.float(-0.25, 0.25),
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const glow = new THREE.Color();
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: Textures.puff() }, uAmbient: atmo.uAmbient, uSunLight: atmo.uSunLight, uGlow: { value: glow } },
    vertexShader: steamVert, fragmentShader: steamFrag, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 6;
  const wind = new THREE.Vector2();
  return {
    points,
    glow,
    // t: s since the steam began; level: how much of it (0..1).
    update(t, level) {
      wind.lerp(atmo.uWind.value, 0.02);
      for (let i = 0; i < N; i++) {
        const p = P[i], k0 = t - p.delay;
        if (k0 < 0 || level <= 0) { alpha[i] = 0; continue; }
        const age = k0 % p.life, k = age / p.life;
        const spread = p.r0 + p.out * (1 - Math.exp(-age * 0.6)) * 2.2;
        const a = p.a + p.swirl * age;
        const y = center.y - 0.6 + p.up * age + 0.12 * age * age;
        pos[i * 3] = center.x + Math.cos(a) * spread + wind.x * age * 0.35;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = center.z + Math.sin(a) * spread + wind.y * age * 0.35;
        size[i] = p.size * (0.8 + age * 0.55);
        alpha[i] = Math.min(1, age / 0.8) * (1 - k) * (1 - k) * 0.15 * level;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    },
  };
}

// The clock, the steam and the credits, made up front and hidden (the preloader compiles and uploads them with
// everything else; built as the ending starts, their shaders and buffers would stall its first frames).
export function prepareEnding(ctx) {
  if (ctx.endingProps || !ctx.aperture) return ctx.endingProps;
  const center = ctx.aperture.center;
  const clock = createClock();
  clock.position.set(center.x, center.y - 2.5, center.z);
  clock.visible = false;
  const steam = createSteam(center);
  steam.points.visible = false;
  ctx.surface.add(clock, steam.points);
  const credits = createCredits();
  return (ctx.endingProps = { clock, steam, credits });
}

// opts.credits: the overlay to roll (else the one prepareEnding made).
export function createEnding(ctx, opts = {}) {
  const { player, fx, audio, camera } = ctx;
  const ap = ctx.aperture, ped = ctx.pedestal ?? null, shafts = ctx.lightShafts ?? null;
  const center = ap.center.clone();
  const props = prepareEnding(ctx);
  const { clock, steam } = props;
  const credits = opts.credits ?? props.credits;
  let t = 0, eye = null, fov0 = 68, alarm = null;
  const fired = {};
  const once = (k, at, f) => { if (!fired[k] && t >= at) { fired[k] = true; f(); } };
  const play = (name, opt) => audio?.play?.(name, opt) ?? null;

  // The view: yaw / pitch following a gaze point with a critically damped spring (its speed never jumps).
  const view = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const gaze = new THREE.Vector3(), g0 = new THREE.Vector3(), g1 = new THREE.Vector3(), g2 = new THREE.Vector3(), tmp = new THREE.Vector3();
  // The clock's path: up out of the pit (H, a little above eye height), then in to D, NEAR m before the eyes.
  const H = new THREE.Vector3(), D = new THREE.Vector3(), cpos = new THREE.Vector3();
  const qSpin = new THREE.Quaternion(), qFace = new THREE.Quaternion(), m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

  const start = () => {
    player.canMove = false;
    player.lookHandler = () => {};
    player.cameraControlled = false;
    eye = camera.position.clone();
    fov0 = camera.fov;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    view.yaw = euler.y; view.pitch = euler.x;
    // What the player was looking at, 10 m off: where the gaze starts.
    g0.set(-Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), -Math.cos(view.yaw) * Math.cos(view.pitch)).multiplyScalar(10).add(eye);
    // Toward the aperture, level (or the way the player faces, standing right over it).
    const dir = tmp.set(center.x - eye.x, 0, center.z - eye.z);
    if (dir.length() < 1.2) dir.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    dir.normalize();
    D.copy(eye).addScaledVector(dir, NEAR);
    H.set(center.x, eye.y + 0.35, center.z);
    // (Never further than the aperture: from close in, the clock rises and settles where it is.)
    if (eye.distanceTo(H) < NEAR + 0.3) D.copy(H);
    ped?.setPulse?.(false);
    clock.visible = true;
    clock.setMinutes?.(0);
    clock.setColon?.(true);
    clock.setGlow?.(1);
    clock.position.set(center.x, center.y - 2.5, center.z);
  };

  // The clock's place and turn at time t.
  const placeClock = () => {
    const rise = smoother(T.rise[0], T.rise[1], t), drift = smoother(T.drift[0], T.drift[1], t);
    cpos.set(center.x, center.y - 2.5, center.z).lerp(H, rise).lerp(D, drift);
    const settle = smoothstep(T.rise[1] - 0.6, T.rise[1] + 1.2, t);
    cpos.y += Math.sin((t - T.rise[0]) * 1.3) * 0.045 * settle;   // a slow float once up
    // Turning as it rises (a slow spin out of the pit, slowing), round to face the eyes, and staying so.
    const faceYaw = Math.atan2(eye.x - cpos.x, eye.z - cpos.z);
    qSpin.setFromAxisAngle(UP, faceYaw + 1.15 * Math.PI * (1 - smoother(T.rise[0], T.turn[1], t)));
    m4.lookAt(eye, cpos, UP);   // (+z of the clock toward the eyes)
    qFace.setFromRotationMatrix(m4);
    clock.quaternion.slerpQuaternions(qSpin, qFace, smoother(T.turn[0], T.turn[1], t));
    // The waking: it shakes as the count runs.
    const sh = shakeAt(t) * 0.012;
    clock.position.set(cpos.x + Math.sin(t * 43.1) * sh, cpos.y + Math.sin(t * 51.7 + 1) * sh, cpos.z + Math.sin(t * 38.3 + 2) * sh);
  };
  // (Building with the count, and a jolt more as it reaches 6:00.)
  const shakeAt = (s) => { const k = smoothstep(T.count[0] + 0.5, T.count[1], s); return k * k + 0.35 * smoothstep(T.count[1] - 0.1, T.count[1] + 0.25, s); };

  // The minutes shown: 12:00 for a while, then 12:00 -> 6:00 AM, faster and faster.
  const minutesAt = (s) => {
    if (s <= T.count[0]) return 0;
    const u = Math.min(1, (s - T.count[0]) / (T.count[1] - T.count[0]));
    return (360 * (Math.exp(COUNT_K * u) - 1)) / (Math.exp(COUNT_K) - 1);
  };

  return {
    done: false,
    get t() { return t; },   // (for the console and tests)
    update(dt) {
      if (!eye) start();
      t += dt;

      // ---- the black, and after it
      if (t >= T.dark) {
        once('dark', T.dark, () => {
          // Dark and silent, at once: the picture to black (white stays 0: it would show through), every sound off.
          alarm?.stop?.(0.05);
          if (audio?.master && audio.ctx) {
            audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
            audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
          }
          steam.points.visible = false;
          fx.shake = 0;
        });
        fx.fade = Math.max(fx.fade, smoothstep(T.dark, T.dark + 0.12, t));
        fx.white = 0;
        once('credits', T.credits, () => credits?.roll?.(() => { credits.hold?.('Thanks for playing'); this.done = true; }));
        return;
      }

      // ---- the pedestal, the island, the iris, the shafts and the steam
      once('sink', T.sink, () => play('pedestalSink', { pos: ped?.root?.position ?? center, duration: T.sinkDur }));
      if (ped && t >= T.sink) ped.setSink(clamp((t - T.sink) / T.sinkDur, 0, 1));
      once('rumble', T.rumble, () => play('rumble', { duration: 5, peak: 0.6 }));
      once('grind', T.iris[0], () => play('grind', { duration: T.iris[1] - T.iris[0] }));
      ap.set(smoothstep(T.iris[0], T.iris[1], t));
      once('swell', T.shafts[0], () => play('shaftSwell', { duration: 6 }));
      const shaft = smoothstep(T.shafts[0], T.shafts[1], t) * (1 + 0.25 * smoothstep(T.count[0], T.count[1], t));
      shafts?.set(shaft);
      if (t >= T.steam) {
        steam.points.visible = true;
        steam.glow.setRGB(1.0, 0.84, 0.6).multiplyScalar(0.08 * Math.min(1, shaft));   // (the night's exposure is ~3x)
        steam.update(t - T.steam, smoothstep(T.steam, T.steam + 2.5, t));
      }

      // ---- the clock: up, round, in; 12:00 blinking, then the count
      placeClock();
      const m = minutesAt(t);
      clock.setMinutes?.(m);
      clock.setColon?.(t >= T.count[0] || (t % 1) < 0.5);
      clock.setGlow?.(smoothstep(T.rise[0], T.rise[0] + 1.2, t) * (1 + 0.6 * smoothstep(T.count[0], T.count[1], t)));
      once('alarm', T.alarm, () => { ctx.storm?.holdNear?.(true); alarm = play('buzzAlarm', { level: 0.5 }); });   // (the storm keeps its distance while it rings)
      once('nearer', T.count[0] + 2.5, () => alarm?.setDry?.(0.5, 1.5));   // (the dream thinning)
      once('awake', T.count[1], () => { alarm?.setWet?.(0, 0.4); alarm?.setDry?.(1, 0.3); });

      // ---- the view: the eyes held where they were, the gaze drawn from where the player looked, to the pedestal
      // going down, up the shafts, and onto the clock (and kept on it).
      const sink = ped ? smoothstep(T.sink, T.sink + T.sinkDur, t) : 1;
      if (ped) g1.copy(ped.top ?? ped.buttonPos).lerp(ped.root.position, sink);
      else g1.copy(center);
      g2.copy(center).setY(center.y + 0.8 + 2.6 * smoothstep(T.shafts[0], T.rise[0] + 1, t)).lerp(cpos, smoothstep(T.rise[0], T.rise[0] + 2, t));
      gaze.copy(g0).lerp(g1, smoothstep(0.15, 1.4, t)).lerp(g2, smoothstep(2.6, 4.8, t));
      const dx = gaze.x - eye.x, dy = gaze.y - eye.y, dz = gaze.z - eye.z;
      const wantYaw = view.yaw + wrap(Math.atan2(-dx, -dz) - view.yaw), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Gentle at first, then firmly onto the clock as it comes in (so it ends square on it).
      const w = 1.6 + 2.6 * smoothstep(T.drift[0], T.drift[1], t);
      spring(view, 'yaw', 'vy', wantYaw, w, dt);
      spring(view, 'pitch', 'vp', wantPitch, w, dt);
      const s = shakeAt(t) * 0.0045 + smoothstep(T.rumble, T.rumble + 1.5, t) * (1 - smoothstep(T.rumble + 3, T.rumble + 5, t)) * 0.0012;
      camera.position.copy(eye);
      camera.up.copy(UP);
      camera.quaternion.setFromEuler(euler.set(
        view.pitch + s * (Math.sin(t * 37.3) + Math.sin(t * 59.1)),
        view.yaw + s * (Math.sin(t * 41.9) + Math.sin(t * 67.3)),
        s * 0.6 * Math.sin(t * 29.7), 'YXZ'));
      const fov = fov0 * (1 - 0.16 * smoother(T.drift[0], T.drift[1] + 1, t));
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      // ---- the picture: the bloom and the shake build with the count; the edges close in a little
      const k = smoothstep(T.count[0], T.count[1], t);
      fx.bloomStrength = 0.35 + 1.25 * k * k + 0.4 * smoothstep(T.count[1] - 0.1, T.count[1] + 0.3, t);
      fx.vignette = 0.35 + 0.35 * k;
      fx.shake = shakeAt(t) * 0.7;
      fx.white = 0;
    },
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smoother = (a, b, x) => { const s = clamp((x - a) / (b - a), 0, 1); return s * s * s * (s * (s * 6 - 15) + 10); };
// A critically damped spring on o[key] (its speed in o[vel]) toward target, natural frequency w (rad/s).
function spring(o, key, vel, target, w, dt) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = w * w * (target - o[key]) - 2 * w * o[vel];
    o[vel] += a * h;
    o[key] += o[vel] * h;
  }
}
