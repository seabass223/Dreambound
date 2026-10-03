import * as THREE from 'three';
import { smoothstep, clamp } from '../core/rng.js';
import { PLAYER } from '../config.js';

// The coordinates readout (props/observatory.js): once the Rocks constellation has been held in the eyepiece, leaving
// it hands the view to this. A main.js sequence ({ done, update(dt) }, started with ctx.startSequence), timed by its
// own t:
//   0.0   the camera leaves the player's eye: up, round the pier and the telescope (clear of the console, under the
//         fork and the tube however they stand), down over the chair onto the desk terminal's screen, square-on at
//         ~0.6 m, the view easing round to the screen and narrowing so its text is easily read
//   ~3.3  the screen clears; it types "Coordinates Detected." (a double beep), "Processing..." (its dots running, a
//         soft chirp each) and "Coordinates Validated!" (a rising three-note confirmation), then waits at its prompt
//   ~8.7  a short fade through black, and the player's own view, at the eyepiece, comes back with control (~9.7).
// The screen is the observatory's own CRT shader showing a message drawn once at boot (render/crt.js
// createCrtMessage): the sequence only sets how much of each row shows and where the cursor is (desk.text). Nothing
// is made here: the camera path is a curve through the desk's waypoints (props/observatory.js, its desk).

// The readout, a row each (the prompt is typed with them); the last three characters of row 1 are its running dots.
export const COORDS_LINES = ['> Coordinates Detected.', '> Processing...', '> Coordinates Validated!', '> '];
const TYPE = 36;        // characters per second as the terminal prints
const DOT = 0.28;       // s per step of the dots
const DOTS = [1, 2, 3, 1, 2, 3];
const BLINK = 1.06;     // s: the cursor's blink period (steady while printing)
const FLY = 3.6;        // s from the player's eye to the screen (~7.5 m: ~3 m/s at the most)
const PUSH = 0.03;      // m the camera creeps in toward the screen while it reads

// The readout as it stays once the coordinates are in (the observatory shows it every frame after the cinematic, and
// straight away from a restored save): every row, the cursor blinking at the prompt. One object, rewritten each call
// (it is read every frame for the rest of the game).
const FINAL = { rows: COORDS_LINES.map((l) => l.length), cursor: [COORDS_LINES[3].length, 3], lit: 1 };
export function coordsFinal(time) {
  FINAL.lit = (time / BLINK) % 1 < 0.5 ? 1 : 0;
  return FINAL;
}

// desk (props/observatory.js, ctx.observatory.desk): screen (centre of the face, world), normal (out of the face), end
// (the camera's last place, on the normal), via (world waypoints from above the eyepiece round to above the chair), fov
// (the screen's framing), text(rows, cursor, lit) / text(null) (the message on the screen, or its stock text).
export function createCoordsPan(ctx, { desk }) {
  const { player, camera, fx, audio } = ctx;
  let t = 0, keep = null, fov0 = camera.fov, path = null, yaw0 = 0, pitch0 = 0;
  const pos = new THREE.Vector3(), v = new THREE.Vector3(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  // A view direction as the player's yaw and pitch (Player.forward), so the look turns without ever rolling.
  const yawOf = (d) => Math.atan2(-d.x, -d.z), pitchOf = (d) => Math.asin(clamp(d.y / d.length(), -1, 1));
  const fired = {};
  const once = (k, at, f) => { if (!fired[k] && t >= at) { fired[k] = true; f(); } };
  const dotKeys = DOTS.map((_, i) => 'dot' + i);
  const beep = (kind) => audio?.play?.('coordsBeep', { pos: desk.screen, kind });

  // The timeline after arrival (a): when each row starts printing, the dots run, and the fade back.
  const len = COORDS_LINES.map((l) => l.length);
  const a = FLY;
  const T = { clear: a - 0.35, detect: a + 0.15 };
  T.process = T.detect + len[0] / TYPE + 0.36;
  T.dots = T.process + (len[1] - 3) / TYPE + 0.04;
  T.valid = T.dots + DOTS.length * DOT + 0.15;
  T.prompt = T.valid + len[2] / TYPE + 0.08;
  T.fade = T.prompt + 1.0;
  T.back = T.fade + 0.45;
  T.end = T.back + 0.55;

  // What the screen shows at t: characters per row and the cursor (after the last printed character; it blinks only
  // while the terminal waits). Rewritten in place each frame (desk.text copies them into its uniforms).
  const typed = (row, from) => clamp(Math.floor((t - from) * TYPE), 0, len[row]);
  const rows = [0, 0, 0, 0], cur = [0, 0], shown = { rows, cur, lit: 0 };
  const screen = () => {
    if (t < T.clear) return null;
    rows.fill(0);
    cur[0] = 0; cur[1] = 0;
    let busy = false;
    if (t >= T.detect) { rows[0] = typed(0, T.detect); cur[0] = rows[0]; busy = rows[0] < len[0]; }
    if (t >= T.process) {
      rows[1] = Math.min(typed(1, T.process), len[1] - 3);
      if (t >= T.dots) rows[1] = len[1] - 3 + (t < T.valid - 0.15 ? DOTS[Math.min(DOTS.length - 1, Math.floor((t - T.dots) / DOT))] : 3);
      cur[0] = rows[1]; cur[1] = 1; busy = t < T.valid;
    }
    if (t >= T.valid) { rows[2] = typed(2, T.valid); cur[0] = rows[2]; cur[1] = 2; busy = rows[2] < len[2]; }
    if (t >= T.prompt) { rows[3] = len[3]; cur[0] = len[3]; cur[1] = 3; busy = false; }
    shown.lit = busy || ((t - T.clear) / BLINK) % 1 < 0.5 ? 1 : 0;
    return shown;
  };

  // The camera's place and look at t: along the path (eased by arc length), the look turning from the player's view
  // onto the screen's centre over the first half (then held on it: square-on at the end), the view narrowing.
  const shot = () => {
    const k = clamp(t / FLY, 0, 1);
    const s = smoothstep(0, 1, k);
    path.getPointAt(s, pos);
    // While it reads, a slow creep in along the normal.
    if (k >= 1) pos.addScaledVector(desk.normal, -PUSH * smoothstep(FLY, T.fade, t));
    v.subVectors(desk.screen, pos);
    const w = smoothstep(0, 0.5, k), dy = yawOf(v) - yaw0;
    camera.position.copy(pos);
    camera.quaternion.setFromEuler(euler.set(pitch0 + (pitchOf(v) - pitch0) * w, yaw0 + Math.atan2(Math.sin(dy), Math.cos(dy)) * w, 0));
    camera.fov = fov0 + (desk.fov - fov0) * smoothstep(0.35, 1, s);
    camera.updateProjectionMatrix();
  };

  return {
    done: false,
    get t() { return t; },
    timeline: T,
    update(dt) {
      t += dt;
      once('start', 0, () => {
        keep = { canMove: player.canMove, lookHandler: player.lookHandler };
        player.canMove = false;
        player.lookHandler = () => {};   // the mouse does nothing
        player.cameraControlled = false;
        // From where the view is now: the player's eye (the eyepiece put the camera back there on leaving). Should it
        // still be elsewhere, from the eye itself.
        const eye = player.feet.clone().setY(player.feet.y + PLAYER.eye);
        const near = camera.position.distanceTo(eye) < 0.5;
        const from = near ? camera.position.clone() : eye;
        const fwd = near ? new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion) : player.forward();
        yaw0 = yawOf(fwd); pitch0 = pitchOf(fwd);
        fov0 = camera.fov;
        // Up off the eyepiece first (a little back from it), then the desk's waypoints.
        const back = new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0));
        const rise = from.clone().add(new THREE.Vector3(0, 0.36, 0)).addScaledVector(back, 0.1);
        path = new THREE.CatmullRomCurve3([from, rise, ...desk.via, desk.end], false, 'centripetal');
        path.arcLengthDivisions = 400;
        path.updateArcLengths();
      });
      once('detect', T.detect, () => beep('detect'));
      for (let i = 0; i < DOTS.length; i++) once(dotKeys[i], T.dots + i * DOT, () => beep('tick'));
      once('valid', T.valid, () => beep('valid'));

      if (t < T.back) shot();
      const s = screen();
      if (s) desk.text(s.rows, s.cur, s.lit); else desk.text(null);

      if (t >= T.fade && t < T.back) fx.fade = smoothstep(T.fade, T.back, t);
      once('back', T.back, () => {
        // In the black: the player's own view, and control, back.
        fx.fade = 1;
        camera.fov = fov0; camera.updateProjectionMatrix();
        player.cameraControlled = true;
        player.canMove = keep?.canMove ?? true;
        player.lookHandler = keep?.lookHandler ?? null;
      });
      if (t >= T.back) fx.fade = 1 - smoothstep(T.back + 0.05, T.end, t);
      if (t >= T.end) { fx.fade = 0; this.done = true; }
    },
  };
}
