import * as THREE from 'three';
import { smoothstep, clamp } from '../core/rng.js';
import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';

// rocks.exe (the bunker terminal, props/terminal.js): the screen tears, the view cuts to CAM 07, the hidden camera
// strapped to the Rocks sequoia, and through it the tor goes up (world/torBlast.js), its waterfall dies and the five
// boulders are thrown across the island (world/rockThrow.js); then the signal breaks up and the picture glitches back
// to the shell. A main.js sequence ({ done, update(dt) }, started by term.onRun), timed by its own t:
//   0.00  the screen tears (fx.glitch, feedCut), the view pushing into the glass
//   0.25  the cut: the camera at stack.hiddenCam, the CCTV look (fx.feed, IR by night), the OSD, the world heard down
//         the camera's line (audio.setFeed); where the boulders will land is decided now and the end state written at
//         once (state.rocks, state.tor), so a save made during the cutscene restores the end
//   0.25  a calm shot: the tor and its falls, the camera creeping onto its preset
//   2.20  the blast (the explosion as the camera's mic hears it), the flash, the boulders thrown
//   2.4+  the camera, a motorised pan-tilt-zoom head that tracks movement, follows the boulders (it can't see through
//         the trunk behind it: it locks onto the group nearest where it looks), tilts down as they land (each landing
//         shakes it), then swings back to its preset on the smoking stump
//   7.50  the signal degrades (fx.glitch to 1, the OSD's bars go, the recorder's VIDEO LOSS)
//   8.30  the cut back: the player is still seated at the terminal, so the view lands on its screen, which prints its
//         garbled lines and "[cam07] link lost"; the glitch dies away by 8.9.
// Nothing here is made on the GPU: the cut, the feed and the blast are uniforms and objects built (hidden) with the
// world, so the preloader has seen them all. The OSD is a DOM overlay (none headless).

const T = { cut: 0.25, boom: 2.2, home: 1.1, degrade: 7.5, back: 8.3, end: 8.9 };   // home: s after the last lands
const D = THREE.MathUtils.DEG2RAD;
// The head: pan within PAN of the bark's normal (beyond it the trunk fills the view), tilt within TILT; speeds and
// accelerations of its motors (rad/s, rad/s^2), the tracker's lag (s) and the zoom motor (deg of fov per s).
const PAN = 86 * D, TILT = [-50 * D, 62 * D];
const VMAX = [80 * D, 55 * D], AMAX = [240 * D, 180 * D], LAG = 0.14, ZOOM_RATE = 12;
const SEEN = [104 * D, 122 * D];   // bearings off the normal past which the trunk starts to hide, then hides, a boulder
const PRESET = { tilt: 8 * D, fov: 76 };   // the calm shot (off the lens's aim at the tor) and its zoom
const FOV = [58, 86];                      // the zoom's travel (its widest is 1.0x)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Made up front (main.js, beside prepareEnding): the OSD's DOM and style, and one run of the landing picker so its
// code is warm; done in the cutscene's first frame, they cost it ~40 ms on the terminal's screen.
export function prepareRocksExe(ctx, { clock = null } = {}) {
  createOsd(clock);
  ctx.boulders?.pickLandings?.(1);
}

export function createRocksExe(ctx, { term, clock = null } = {}) {
  const { player, fx, audio, camera } = ctx;
  const cam = ctx.stacks.rocks.hiddenCam;
  const B = ctx.boulders, tb = ctx.torBlast;
  let t = 0;
  const fired = {};
  const once = (k, at, f) => { if (!fired[k] && t >= at) { fired[k] = true; f(); } };

  // ---- the head
  const dirOf = (yaw, pitch, out) => out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const anglesOf = (v) => [Math.atan2(v.x, v.z), Math.atan2(v.y, Math.hypot(v.x, v.z))];
  const n = cam.mount.normal;
  const yawN = Math.atan2(n.x, n.z);                      // straight out from the bark
  // Its preset: the whole tor, from its foot to its capstone, a little wider than the lens's own aim.
  const [yaw0, pitchLook] = anglesOf(cam.look.clone().sub(cam.pos));
  const pitch0 = pitchLook + PRESET.tilt;
  const head = { yaw: yaw0 + 2.5 * D, pitch: pitch0 - 5 * D, vy: 0, vp: 0, tyaw: yaw0, tpitch: pitch0, fov: PRESET.fov + 3, roll: -0.7 * D };
  const slew = (cur, vel, target, dt, kp, vmax, amax) => {
    const want = clamp(wrap(target - cur) * kp, -vmax, vmax);
    vel += clamp(want - vel, -amax * dt, amax * dt);
    return [cur + vel * dt, vel];
  };
  const limit = (yaw, pitch) => [yawN + clamp(wrap(yaw - yawN), -PAN, PAN), clamp(pitch, TILT[0], TILT[1])];

  // ---- what it looks at
  const dir = new THREE.Vector3(), aim = new THREE.Vector3(), sum = new THREE.Vector3(), v = new THREE.Vector3();
  const torAt = (tb?.center ?? cam.look).clone();
  const stack = ctx.stacks.rocks;
  // The focus for shadows, the light pool and the creek (main.js, world/index.js): the ground some way out along the
  // camera's view, so the sun's shadow box covers what it sees (the flash's pool site reaches 60 m round the tor).
  const focus = torAt.clone();
  const setFocus = () => {
    dirOf(head.yaw, 0, v);
    const x = cam.pos.x + v.x * 22, z = cam.pos.z + v.z * 22;
    focus.set(x, stack.heightAt(x, z) ?? stack.top, z);
  };

  const stumpTop = tb?.stumpTop ?? torAt.y - 4;
  // Which boulder the tracker follows: one coming down where it can see it (well clear of the trunk's edge), out past
  // the dust rolling off the tor's foot, and not so near it would fill the frame; else the least hidden.
  let lock = -1;
  const pickLock = () => {
    let best = 0, bs = -Infinity;
    for (const f of flights ?? []) {
      v.set(f.rest.x - cam.pos.x, 0, f.rest.z - cam.pos.z);
      const off = Math.abs(wrap(Math.atan2(v.x, v.z) - yawN)) / D, d = v.length();
      const fromTor = Math.hypot(f.rest.x - torAt.x, f.rest.z - torAt.z);
      const sc = -Math.max(0, off - 70) * 2 - off * 0.15 + Math.min(fromTor, 32) * 0.8 - Math.max(0, 14 - d) * 2;
      if (sc > bs) { bs = sc; best = f.i; }
    }
    return best;
  };

  // ---- the shake: the tree takes the blast and each landing (the head rocks; the picture shakes on the line too)
  let quake = 0;
  const kick = (rad, line) => { quake = Math.min(0.03, quake + rad); fx.shake = Math.min(2.2, (fx.shake ?? 0) + line); };

  // ---- the blast and the throw
  let seed = 1, landings = null, flights = null;
  const prevOnLand = B?.onLand ?? null;
  const onLand = (i, pos, r) => {
    const d = pos.distanceTo(cam.pos);
    const k = clamp(14 / Math.max(d, 4), 0.25, 1.6) * (r ?? 1);
    kick(0.0035 * k, 0.55 * k);
    glitchBlips.push([t, 0.07, 0.1 + 0.06 * k]);
    osd?.motion(t);
  };

  // ---- the glitch: the cut's tear, a few blips on a long line, the blast's flicker, the signal going, the way back
  const glitchBlips = [[1.15, 0.06, 0.12], [1.62, 0.04, 0.08]];
  const glitchAt = () => {
    let g = 0;
    if (t < T.cut) g = 0.95 * smoothstep(0, T.cut, t);
    else if (t < T.cut + 0.32) g = 0.9 * (1 - smoothstep(T.cut, T.cut + 0.32, t));
    if (t >= T.boom && t < T.boom + 0.16) g = Math.max(g, 0.35 + 0.15 * Math.sin(t * 90));
    for (const [at, len, amt] of glitchBlips) if (t >= at && t < at + len) g = Math.max(g, amt);
    if (t >= T.degrade && t < T.back) {
      const k = smoothstep(T.degrade, T.back, t);
      // It stutters as it goes: drops in and out on the way down.
      g = Math.max(g, Math.min(1, Math.pow(k, 1.4) * (0.85 + 0.25 * Math.sin(t * 37) * Math.sin(t * 11.3)) + 0.06));
    }
    if (t >= T.back) g = 1 - smoothstep(T.back, T.end, t);
    return g < 0.02 ? 0 : g;
  };

  // ---- the OSD (CCTV: the camera's own lines, and the recorder's VIDEO LOSS when the signal goes)
  const osd = createOsd(clock);

  // ---- before: where the view starts (the seat, on the screen) and what's handed back
  let cam0 = null, keep = null;
  // (The housing's own meshes: its group is the LOD's, which would show it again the moment the camera got there.)
  const housing = ctx.bunker?.room?.cctv?.group?.children ?? [];
  const tmp = new THREE.Vector3();
  let blastAt = Infinity, restAt = Infinity, homeAt = Infinity;

  const seq = {
    done: false,
    // (For the console and tests: the head, and the boulder it follows.)
    get ptz() { return { ...head, lock }; },
    update(dt) {
      t += dt;
      once('start', 0, () => {
        // The terminal holds the player in the chair while the dots run, but should they be out of it anyway (getting
        // up, or got up) and still in the bunker, they're sat back down; by the cut back the ease has long finished.
        if (term && !term.active() && ctx.bunker?.inside?.(player.feet)) {
          if (player.mode === 'sit' && player.seat === term.seat && player.sitDir < 0) {
            player.zone = 'surface'; player.sitDir = 1; player.sitArmed = false;
          } else if (player.mode === 'walk') { player.zone = 'surface'; term.enter(); }
        }
        keep = { canMove: player.canMove, lookHandler: player.lookHandler };
        player.canMove = false;
        player.lookHandler = () => {};   // the mouse does nothing (seated, it would turn the head)
        player.cameraControlled = false;
        cam0 = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
        // Where they'll land (a new seed each game; ~15 ms, here rather than in the cut's frame, which has the jump's
        // regathering of the far scatter to do).
        seed = ((Math.random() * 0x7ffffffe) >>> 0) + 1;
        landings = B?.pickLandings?.(seed) ?? null;
        audio?.play?.('feedCut');
      });
      once('cut', T.cut, () => {
        // The end written at once (rockThrow's launch writes it again, the same).
        const S = ctx.state;
        if (S.rocks && landings) Object.assign(S.rocks, { positions: landings.map((p) => ({ x: p.x, z: p.z })), pushes: [], solved: false, released: true, seed });
        (S.tor ||= { exploded: false }).exploded = true;
        ctx.viewFocus = focus;
        fx.feed = 1;
        audio?.setFeed?.(1);
        for (const m of housing) { m.userData.rocksExeVisible = m.visible; m.visible = false; }   // the lens is in it
        if (B) B.onLand = onLand;
        osd?.show();
      });
      once('boom', T.boom, () => {
        blastAt = t;
        tb?.detonate({ sound: false });
        audio?.play?.('explosion', { feed: true });
        flights = B?.launch?.({ landings, seed }) ?? null;
        restAt = flights?.length ? T.boom + Math.max(...flights.map((f) => f.tRest)) : T.boom + 4.4;
        homeAt = flights?.length ? T.boom + Math.max(...flights.map((f) => f.tLand)) + T.home : restAt;
        fx.white = 0.42;   // the picture blows out for a frame or two (the camera's iris catching up)
        kick(0.02, 1.6);
        osd?.motion(t);
      });
      once('degrade', T.degrade, () => audio?.play?.('glitch', { dur: T.back - T.degrade + 0.1, amt: 0.8 }));
      once('back', T.back, () => {
        player.cameraControlled = true;   // seated: the view is back on the screen the moment the player draws it
        player.canMove = keep?.canMove ?? true;
        player.lookHandler = keep?.lookHandler ?? null;
        ctx.viewFocus = null;
        // Not in the chair after all: the view they had (Player puts the camera back, but not its zoom).
        if (!term?.active() && cam0) { camera.fov = cam0.fov; camera.updateProjectionMatrix(); }
        fx.feed = 0; fx.feedNight = 0; fx.white = 0; fx.shake = 0;
        audio?.setFeed?.(0, 0.004);   // at once, so the relay's clack is heard dry, as at the cut
        audio?.play?.('feedCut');
        for (const m of housing) m.visible = m.userData.rocksExeVisible ?? true;
        if (B && B.onLand === onLand) B.onLand = prevOnLand;
        osd?.hide();
        term?.returnFromFeed?.();
      });

      // The glitch, on the picture and (around the cuts) on the terminal's own screen.
      fx.glitch = glitchAt();
      if (term) term.glitch = t < T.cut ? fx.glitch : t >= T.back ? fx.glitch * 0.8 : 0;
      fx.white = Math.max(0, (fx.white ?? 0) - dt * 5);
      fx.shake = Math.max(0, (fx.shake ?? 0) - dt * 3.5 * Math.max(1, fx.shake ?? 0));
      quake *= Math.exp(-dt * 3.2);

      if (t < T.cut) {
        // Pushing into the glass as the picture tears.
        const e = smoothstep(0, T.cut, t) ** 2;
        camera.quaternion.copy(cam0.quat);
        camera.position.copy(cam0.pos).add(tmp.set(0, 0, -0.16 * e).applyQuaternion(cam0.quat));
        camera.fov = cam0.fov * (1 - 0.22 * e);
        camera.updateProjectionMatrix();
      } else if (t < T.back) {
        this.head(dt);
        if (clock) fx.feedNight = clamp((4 - clock.altDeg) / 8, 0, 1);
        osd?.update(t - T.cut, fx.glitch, head, t >= T.boom);
      } else if (t >= T.end) {
        fx.glitch = 0;
        if (term) term.glitch = 0;
        fx.shake = 0;
        this.done = true;
      }
    },

    // The pan-tilt head: where the tracker wants it, its motors' lag and limits, the zoom, the shake.
    head(dt) {
      const tb2 = t - blastAt;
      let want = null, kp = 3.2, fovWant = PRESET.fov;
      if (t < T.boom) {
        kp = 1.1;   // creeping onto its preset
        want = [yaw0, pitch0];
      } else if (tb2 < 0.2) {
        want = [head.tyaw, head.tpitch];   // the tracker hasn't found anything yet: the fireball
        fovWant = PRESET.fov + 4;
      } else if (t < homeAt) {
        // The tracker locks onto one boulder (the one whose landing it can see best: the trunk hides those behind it)
        // and follows it; the others still flying pull it a little, so it keeps as many in shot as it can.
        if (lock < 0) lock = pickLock();
        dirOf(head.yaw, head.pitch, aim);
        sum.set(0, 0, 0);
        let spread = 0, w0 = 0, dLock = 20;
        const ps = B?.positions?.() ?? [];
        ps.forEach((p, i) => {
          v.copy(p).sub(cam.pos);
          const d = v.length();
          if (d < 0.5) return;
          v.divideScalar(d);
          const seen = 1 - smoothstep(SEEN[0], SEEN[1], Math.abs(wrap(Math.atan2(v.x, v.z) - yawN)));
          const f = flights?.find((q) => q.i === i);
          const flying = !f || tb2 < f.tLand;
          const ang = Math.acos(clamp(v.dot(aim), -1, 1));
          const w = i === lock ? 1 : flying ? 0.22 * seen * Math.exp(-((ang / (50 * D)) ** 2)) : 0;
          // (Once down, it frames the boulder low, with the dust it threw up above it.)
          if (i === lock && f && tb2 > f.tLand) v.y += Math.min(0.06, (tb2 - f.tLand) * 0.05);
          if (i === lock) dLock = d;
          sum.addScaledVector(v, w);
          if (w > 0.05) spread = Math.max(spread, ang);
          w0 += w;
        });
        if (w0 > 0.01) want = anglesOf(sum);
        // The zoom: out to keep them in shot while they fly, in on the one it follows once it's down.
        const f = flights?.find((q) => q.i === lock);
        const down = f && tb2 > f.tLand + 0.15;
        fovWant = down ? clamp((2 * Math.atan(9 / dLock)) / D, FOV[0], 70) : clamp((2 * spread) / D + 34, PRESET.fov, FOV[1]);
      } else {
        // Back to its preset: the stump, its smoke.
        kp = 2.4;
        want = anglesOf(v.copy(torAt).setY(stumpTop + 1.5).sub(cam.pos));
        fovWant = PRESET.fov - 4;
      }
      if (want) {
        const [wy, wp] = limit(want[0], want[1]);
        const a = 1 - Math.exp(-dt / LAG);
        head.tyaw += wrap(wy - head.tyaw) * a;
        head.tpitch += (wp - head.tpitch) * a;
      }
      [head.yaw, head.vy] = slew(head.yaw, head.vy, head.tyaw, dt, kp, VMAX[0], AMAX[0]);
      [head.pitch, head.vp] = slew(head.pitch, head.vp, head.tpitch, dt, kp, VMAX[1], AMAX[1]);
      [head.yaw, head.pitch] = limit(head.yaw, head.pitch);
      head.fov += clamp(fovWant - head.fov, -ZOOM_RATE * dt, ZOOM_RATE * dt);
      setFocus();

      // The view: the head's angles, the tree's sway, the shake.
      const s = t * 1.0;
      const sway = 0.0012 + quake * 0.15;
      const jy = (Math.sin(s * 0.71) * 0.6 + Math.sin(s * 1.37)) * sway * 0.5 + (Math.sin(t * 37.1) + Math.sin(t * 53.9)) * quake * 0.5;
      const jp = (Math.sin(s * 0.53 + 1) * 0.6 + Math.sin(s * 1.11)) * sway * 0.4 + (Math.sin(t * 41.3 + 2) + Math.sin(t * 61.7)) * quake * 0.5;
      dirOf(head.yaw + jy, head.pitch + jp, dir);
      camera.position.copy(cam.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(tmp.copy(cam.pos).add(dir));
      camera.rotateZ(head.roll + (Math.sin(t * 29.3) * quake * 0.6));
      camera.fov = head.fov;
      camera.updateProjectionMatrix();
    },
  };
  return seq;
}

// ---------------------------------------------------------------------------------------------------------------
// The OSD: the camera's own lines (CAM 07 · SEQUOIA, a blinking REC, the date and a running time, the head's pan /
// tilt / zoom, the link's bars) in the blocky white of a 1970s character generator, inside the feed's vignette; it
// jitters with the line's glitch, and when the signal goes the recorder's VIDEO LOSS takes over.
const OSD_CSS = `
.cctv-osd { position: fixed; inset: 0; z-index: 4; pointer-events: none; display: none; color: #ecefe9;
  font: bold clamp(11px, 2.35vh, 26px)/1.25 Consolas, 'Lucida Console', 'Courier New', monospace; letter-spacing: 0.09em;
  text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 1px 1px 1px rgba(0,0,0,0.6); filter: blur(0.35px); }
.cctv-osd.on { display: block; }
.cctv-osd .box { position: absolute; left: 11%; right: 11%; top: 10%; bottom: 10%; }
.cctv-osd .tl, .cctv-osd .tr, .cctv-osd .bl, .cctv-osd .br { position: absolute; white-space: pre; }
.cctv-osd .tl { left: 0; top: 0; } .cctv-osd .tr { right: 0; top: 0; text-align: right; }
.cctv-osd .bl { left: 0; bottom: 0; } .cctv-osd .br { right: 0; bottom: 0; text-align: right; }
.cctv-osd .rec i { display: inline-block; width: 0.62em; height: 0.62em; margin-right: 0.35em; border-radius: 50%;
  background: #e23a2a; box-shadow: 0 0 0 1px #000; vertical-align: 0.02em; }
.cctv-osd .rec.off i { visibility: hidden; }
.cctv-osd .md { opacity: 0; } .cctv-osd .md.on { opacity: 1; }
.cctv-osd .bars { display: inline-flex; align-items: flex-end; gap: 0.12em; height: 0.8em; margin-left: 0.5em; vertical-align: -0.04em; }
.cctv-osd .bars b { width: 0.22em; background: #ecefe9; box-shadow: 0 0 0 1px #000; }
.cctv-osd .bars b.off { background: transparent; box-shadow: 0 0 0 1px rgba(236,239,233,0.45); }
.cctv-osd .loss { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 0.35em 0.9em; display: none;
  background: #0b1f8f; color: #f4f4f4; border: 2px solid #f4f4f4; box-shadow: 0 0 0 1px #000; letter-spacing: 0.16em; }
.cctv-osd .loss.on { display: block; }
`;

let osdMade = null;
function createOsd(clock) {
  if (typeof document === 'undefined' || !document.body || !document.createElement) return null;
  if (osdMade) { osdMade.clock = clock ?? osdMade.clock; return osdMade.api; }
  let el = document.querySelector('.cctv-osd');
  if (!el) {
    const style = document.createElement('style');
    style.textContent = OSD_CSS;
    document.head.appendChild(style);
    el = document.createElement('div');
    el.className = 'cctv-osd';
    el.innerHTML = `<div class="box">
      <div class="tl">CAM 07 · SEQUOIA\n<span class="ptz"></span></div>
      <div class="tr"><span class="rec"><i></i>REC</span>\n<span class="md">MOTION</span></div>
      <div class="bl"><span class="date"></span>\n<span class="time"></span></div>
      <div class="br">LINK<span class="bars"><b style="height:30%"></b><b style="height:55%"></b><b style="height:78%"></b><b style="height:100%"></b></span>\nCH07  1/4</div>
    </div><div class="loss">CH07  VIDEO LOSS</div>`;
    document.body.appendChild(el);
  }
  const $ = (s) => el.querySelector(s);
  const box = $('.box'), rec = $('.rec'), md = $('.md'), date = $('.date'), time = $('.time'), ptz = $('.ptz'), loss = $('.loss');
  const bars = [...el.querySelectorAll('.bars b')];
  const set = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const two = (x) => String(Math.floor(x)).padStart(2, '0');
  let secs0 = 0, motionAt = -10;
  // The game's time of day at the cut (as Menu > Game shows it), then running at one second a second like a real one.
  const made = { clock, api: null };
  const dayHours = () => {
    const clock = made.clock;
    if (!clock) return 14.5;
    const p = clock.phase, F = DAY_SECONDS / (DAY_SECONDS + NIGHT_SECONDS);
    return p < F ? 6 + (p / F) * 12 : 18 + ((p - F) / (1 - F)) * 12;
  };
  made.api = {
    show() { secs0 = dayHours() * 3600; el.classList.add('on'); },
    hide() { el.classList.remove('on'); box.style.transform = ''; box.style.visibility = ''; loss.classList.remove('on'); },
    motion(t) { motionAt = t; },
    update(s, glitch, head, armed) {
      const now = secs0 + s;
      set(date, '1979-09-13  THU');
      set(time, `${two((now / 3600) % 24)}:${two((now / 60) % 60)}:${two(now % 60)}  ${String(Math.floor(s * 25) % 25).padStart(2, '0')}`);
      rec.classList.toggle('off', s % 1 > 0.6);
      md.classList.toggle('on', armed && s - (motionAt - 0.25) < 1.6 && s % 0.5 < 0.32);
      const pan = ((head.yaw * 180) / Math.PI + 360) % 360, tilt = (head.pitch * 180) / Math.PI;
      const zoom = Math.tan((FOV[1] / 2) * THREE.MathUtils.DEG2RAD) / Math.tan((head.fov * THREE.MathUtils.DEG2RAD) / 2);
      set(ptz, `P${pan.toFixed(1).padStart(5, '0')} T${tilt < 0 ? '-' : '+'}${Math.abs(tilt).toFixed(1).padStart(4, '0')} Z${zoom.toFixed(1)}x`);
      // The link: four bars, fewer as the signal goes; then the camera's lines are gone and the recorder says so.
      const lvl = glitch > 0.8 ? 0 : glitch > 0.55 ? 1 : glitch > 0.3 ? 2 : glitch > 0.12 ? 3 : 4;
      bars.forEach((b, i) => b.classList.toggle('off', i >= lvl));
      const lost = glitch > 0.86;
      box.style.visibility = lost ? 'hidden' : '';
      loss.classList.toggle('on', lost && s % 0.4 < 0.28);
      // The character generator rides the same line: it tears sideways with the picture.
      const j = glitch > 0.08 ? (Math.random() - 0.5) * glitch * 34 : 0;
      box.style.transform = j ? `translate(${j.toFixed(1)}px, ${((Math.random() - 0.5) * glitch * 6).toFixed(1)}px)` : '';
    },
  };
  osdMade = made;
  return made.api;
}
