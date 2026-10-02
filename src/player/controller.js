import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { clamp } from '../core/rng.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3();
const LADDER_EYE_OUT = 0.2;   // m: on a curved ladder, the eyes are this much further off it than the feet
const SIT_TIME = 0.9;   // seconds to sit down or stand up
// Down a slope too steep to walk (a collider with a walkable slope, see Physics.resolveCapsule), the most you slide at,
// along the slope. The fall's vertical speed is capped at this times the slope's sine, and the level push-out turns it
// into sliding down the face.
const SLIDE_SPEED = 2.8;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(camera, input, physics) {
    this.camera = camera;
    this.input = input;
    this.physics = physics;
    this.feet = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.onGround = false;
    this.sliding = false;        // on a slope too steep to walk (and not standing on walkable ground)
    this.col = { slide: false, slideH: 0 };   // Physics.resolveCapsule's info
    this.zone = 'surface';
    this.mode = 'walk';          // walk | ladder | sit | locked
    this.seat = null;            // the chair sat in (mode 'sit', see sit())
    this.canMove = false;
    this.lookHandler = null;     // when set, mouse drives this instead of the view
    this.ladder = null;
    // The body's axis, feet to eyes: straight up, except on a curved ladder, where the climber lies along it (see
    // updateCamera). ladderAxis is that ladder's upward direction where the feet are.
    this.bodyUp = new THREE.Vector3(0, 1, 0);
    this.ladderAxis = new THREE.Vector3(0, 1, 0);
    this.ladderOut = new THREE.Vector3();   // and its outward normal (away from what it's fixed to)
    this.eyeOut = new THREE.Vector3();      // the eyes' offset off the ladder, eased like bodyUp
    this.bob = 0;
    this.stepDist = 0;
    this.lastGroundY = 0;
    this.history = [];           // recent safe positions for dream-respawn
    this.histTimer = 0;
    this.contacts = [];
    this.override = null;        // { eye, pitch, roll, weight } for scripted camera moves
    this.shake = 0;
    this.extraCam = null;        // optional camera offset (elevator rumble)
    this.onStep = null;
    this.onFall = null;
    this.sensitivity = 0.0021;
    this.cameraControlled = true; // false when another system owns the camera (telescope)
  }

  place(x, y, z, yaw = this.yaw) {
    if (this.mode === 'sit') { this.mode = 'walk'; this.seat = null; }
    this.feet.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.sliding = false;
    this.bodyUp.copy(_UP);
    this.eyeOut.set(0, 0, 0);
    this.yaw = yaw;
    this.lastGroundY = y;
    this.history.length = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  update(dt) {
    const m = this.input.consumeMouse();
    if (this.lookHandler) this.lookHandler(m.x, m.y);
    else if (this.mode === 'sit') this.lookSeated(m);
    else if (this.canMove || this.mode === 'fallLook') {
      this.yaw -= m.x * this.sensitivity;
      this.pitch = clamp(this.pitch - m.y * this.sensitivity, -1.45, 1.45);
    }

    if (this.mode === 'ladder') this.updateLadder(dt);
    else if (this.mode === 'walk') this.updateWalk(dt);
    else if (this.mode === 'sit') this.updateSit(dt);

    this.updateCamera(dt);
  }

  updateWalk(dt) {
    const a = this.canMove && !this.lookHandler ? this.input.axis() : { x: 0, y: 0, run: false };
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _move.set(0, 0, 0).addScaledVector(_fwd, a.y).addScaledVector(_right, a.x);
    if (_move.lengthSq() > 1) _move.normalize();
    const speed = (a.run ? PLAYER.run : PLAYER.walk) * (this.speedMul ?? 1);

    // Check ladder attachment before moving.
    if (this.tryAttachLadder(a)) return;

    const steps = 4;
    const sdt = dt / steps;
    const wasGround = this.onGround;
    const col = this.col;
    for (let i = 0; i < steps; i++) {
      if (this.onGround) this.vel.y = PLAYER.gravity * sdt;
      else this.vel.y = Math.max(PLAYER.terminal, this.vel.y + PLAYER.gravity * sdt);
      _prev.copy(this.feet);
      this.feet.y += this.vel.y * sdt;
      this.feet.addScaledVector(_move, speed * sdt);
      this.contacts.length = 0;
      this.physics.resolveCapsule(this.feet, PLAYER.radius, PLAYER.height, this.zone, this.contacts, col);
      const dy = this.feet.y - (_prev.y + this.vel.y * sdt);
      this.onGround = dy > Math.abs(this.vel.y * sdt * 0.25) || (this.onGround && dy > 1e-4);
      // On a slope too steep to walk the push-out is level, so the capsule drops down the face as it falls: cap that
      // fall so it slides down at SLIDE_SPEED instead of plunging.
      this.sliding = col.slide && !this.onGround;
      if (this.onGround) this.vel.y = 0;
      else if (this.sliding) this.vel.y = Math.max(this.vel.y, -SLIDE_SPEED * col.slideH);
    }
    // Snap down gentle descents so walking downhill doesn't hop (onto ground you can stand on: off a steep face you
    // slide instead).
    if (wasGround && !this.onGround && this.vel.y <= 0) {
      const hit = this.physics.raycastDown(this.feet, 0.45, this.zone);
      if (hit?.walkable) { this.feet.y = hit.point.y; this.onGround = true; this.sliding = false; this.vel.y = 0; }
    }
    // Sliding is on the ground as far as the dream-fall is concerned: a long slide down a hillside isn't a fall. Nor is
    // bounding down one: running down a face too steep to walk, the capsule is mostly in the air, just clear of it, and
    // the drop would add up to the 9 m trigger (whose fall ignores the ground: you sank through the hillside). While
    // such a hillside is close below, the drop is measured from here. Real falls (off a rim, whose cliff is outside
    // the slope rule) are untouched.
    if (this.sliding) this.lastGroundY = this.feet.y;
    else if (!this.onGround && this.feet.y < this.lastGroundY - 2) {
      if (this.physics.raycastDown(this.feet, 1.5, this.zone)?.limited) this.lastGroundY = this.feet.y;
    }

    const moving = _move.lengthSq() > 0.01;
    this.vel.x = _move.x * speed; this.vel.z = _move.z * speed; // kept for momentum when falling
    if (this.onGround) {
      this.lastGroundY = this.feet.y;
      if (moving) {
        const d = speed * dt;
        this.bob += d * 2.1;
        this.stepDist += d;
        const stride = a.run ? 1.35 : 0.95;
        if (this.stepDist > stride) { this.stepDist = 0; this.onStep?.(this.feet, a.run); }
      }
      this.histTimer -= dt;
      if (this.histTimer <= 0) {
        this.histTimer = 0.2;
        this.history.push({ x: this.feet.x, y: this.feet.y, z: this.feet.z, yaw: this.yaw, zone: this.zone });
        if (this.history.length > 20) this.history.shift();
      }
    }
    if (!this.onGround && this.feet.y < this.lastGroundY - 9) this.onFall?.();
  }

  safeSpot() {
    const h = this.history;
    if (!h.length) return null;
    return h[Math.max(0, h.length - 8)];
  }

  // ---- Ladders ----
  ladderLocal(L) {
    const rx = this.feet.x - L.base.x, rz = this.feet.z - L.base.z;
    return { d: rx * L.n.x + rz * L.n.z, s: rx * -L.n.z + rz * L.n.x, h: this.feet.y - L.base.y };
  }

  // A ladder is { base, n, height, width, zone } (straight, against a wall) plus optional hooks: enabled (false: can't be
  // taken hold of), fromAbove (false: its top has no lip to get on from), grab(player, axis) -> the height to take hold
  // at or null (instead of the straight tests), path(h, feet, tangent, normal) (a curved ladder: where the feet are h
  // metres up it, its upward direction and its outward normal), onTop / onBottom(player) (at that end: move the player on and return true, or return
  // false to hold them there).
  tryAttachLadder(a) {
    if (a.y === 0) return false;
    for (const L of this.physics.ladders) {
      if (L.zone !== this.zone || L.enabled === false) continue;
      if (L.grab) {
        const h = L.grab(this, a);
        if (h != null) { this.attach(L, h); return true; }
        continue;
      }
      const p = this.ladderLocal(L);
      if (Math.abs(p.s) > L.width * 0.5 + 0.3) continue;
      const lookX = -Math.sin(this.yaw), lookZ = -Math.cos(this.yaw);
      const facing = -(lookX * L.n.x + lookZ * L.n.z); // >0 when facing the wall
      // From below: facing the ladder, pressing forward.
      if (p.h < 0.6 && p.h > -0.5 && p.d > 0 && p.d < 1.3 && facing > 0.35 && a.y > 0) { this.attach(L, 0.05); return true; }
      // From above: standing at the lip, looking down/out, pressing forward.
      if (L.fromAbove !== false && Math.abs(p.h - L.height) < 0.8 && p.d > -1.4 && p.d < 0.6 && this.pitch < -0.3 && a.y > 0 && facing < (L.topFacing ?? 0.2)) { this.attach(L, L.height - 0.3); return true; }
    }
    return false;
  }

  attach(L, h) {
    this.mode = 'ladder';
    this.ladder = L;
    this.ladderH = h;
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.ladderStep = 0;
  }

  updateLadder(dt) {
    const L = this.ladder;
    const a = this.canMove ? this.input.axis() : { y: 0 };
    // Looking down while pressing forward climbs down; otherwise W is up and S is down. On a curved ladder "down" is
    // looking back down along it.
    let dir = a.y;
    if (L.path) {
      L.path(this.ladderH, _prev, _move);
      if (a.y > 0 && this.forward(_fwd).dot(_move) < -0.35) dir = -1;
    } else {
      const facing = -((-Math.sin(this.yaw)) * L.n.x + (-Math.cos(this.yaw)) * L.n.z);
      if (a.y > 0 && (this.pitch < -0.35 || facing < -0.2)) dir = -1;
    }
    const climb = 1.7;
    this.ladderH += dir * climb * dt;
    if (dir !== 0) {
      this.ladderStep += Math.abs(dir) * climb * dt;
      if (this.ladderStep > 0.42) { this.ladderStep = 0; this.onStep?.(this.feet, false, 'ladder'); }
    }
    const end = this.ladderH >= L.height ? L.onTop : this.ladderH <= 0 ? L.onBottom : null;
    if (end && end(this)) return;
    if (end || L.path) this.ladderH = clamp(this.ladderH, 0, L.height);   // held at this end
    if (L.path) { this.ladderOut.set(0, 0, 0); L.path(this.ladderH, this.feet, this.ladderAxis, this.ladderOut); this.ladderAxis.normalize(); return; }
    const p = this.ladderLocal(L);
    const s = clamp(p.s, -L.width * 0.25, L.width * 0.25);
    const d = 0.5;
    this.feet.set(L.base.x + L.n.x * d - L.n.z * s, L.base.y + this.ladderH, L.base.z + L.n.z * d + L.n.x * s);
    if (end) return;
    if (this.ladderH >= L.height) {
      // Step off onto the top.
      this.feet.set(L.base.x - L.n.x * 0.7, L.base.y + L.height + 0.15, L.base.z - L.n.z * 0.7);
      this.mode = 'walk'; this.ladder = null; this.lastGroundY = this.feet.y;
    } else if (this.ladderH <= 0) {
      this.feet.set(L.base.x + L.n.x * 0.85, L.base.y + 0.05, L.base.z + L.n.z * 0.85);
      this.mode = 'walk'; this.ladder = null; this.lastGroundY = this.feet.y;
    }
  }

  // ---- Sitting ----
  // A seat is { eye (the seated eye, world), stand (the feet when standing up, world), yaw (looking straight out),
  // yawRange, pitchMin, pitchMax (the look limits around it), onSit, onStand }, and optionally pitch (what the view
  // settles to, default -0.06) and dip (how far the eye sinks on the way, default 0.06 m). While seated the feet already
  // stand at `stand` (so a save made now stands the player up there: main.js counts 'sit' as a safe pose), the camera eases
  // between the eye it had and the seat's over SIT_TIME, and the mouse looks round within the limits. Pressing again or
  // walking (once the keys have been let go after sitting down) stands up.
  sit(seat) {
    if (this.mode !== 'walk' || !this.canMove || this.lookHandler) return false;
    this.mode = 'sit';
    this.seat = seat;
    this.sitFrom = this.camera.position.clone();
    this.sitYaw0 = wrapAngle(this.yaw - seat.yaw);
    this.sitPitch0 = this.pitch;
    this.sitT = 0;
    this.sitDir = 1;
    this.sitArmed = false;
    this.feet.copy(seat.stand);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.lastGroundY = this.feet.y;
    this.history.length = 0;
    seat.onSit?.();
    return true;
  }

  standUp() {
    if (this.mode !== 'sit' || this.sitDir < 0) return false;
    this.sitDir = -1;
    this.sitFrom = this.feet.clone().setY(this.feet.y + PLAYER.eye);
    this.seat.onStand?.();
    return true;
  }

  lookSeated(m) {
    const s = this.seat;
    if (this.sitDir > 0 && this.sitT < 1) {
      // Settling in: turn to face out, whatever way the chair was approached from.
      const e = smooth(this.sitT);
      this.yaw = s.yaw + this.sitYaw0 * (1 - e);
      this.pitch = THREE.MathUtils.lerp(this.sitPitch0, s.pitch ?? -0.06, e);
      return;
    }
    this.yaw -= m.x * this.sensitivity;
    this.pitch -= m.y * this.sensitivity;
    const d = clamp(wrapAngle(this.yaw - s.yaw), -s.yawRange, s.yawRange);
    this.yaw = s.yaw + d;
    this.pitch = clamp(this.pitch, s.pitchMin, s.pitchMax);
  }

  updateSit(dt) {
    this.sitT = clamp(this.sitT + this.sitDir * dt / SIT_TIME, 0, 1);
    if (this.sitDir < 0) {
      if (this.sitT <= 0) { this.mode = 'walk'; this.seat = null; this.lastGroundY = this.feet.y; }
      return;
    }
    if (this.sitT < 1) return;
    const a = this.canMove ? this.input.axis() : { x: 0, y: 0 };
    const moving = a.x !== 0 || a.y !== 0;
    if (!moving) this.sitArmed = true;
    else if (this.sitArmed) this.standUp();
  }

  // Where the seated camera is: between the eye it came from (sitting down) or goes to (standing up) and the seat's.
  seatedEye(out) {
    const e = smooth(this.sitT);
    out.copy(this.sitFrom).lerp(this.seat.eye, e);
    // A little dip on the way, as the body folds into the chair.
    out.y -= Math.sin(Math.PI * e) * (this.seat.dip ?? 0.06);
    return out;
  }

  // ---- Camera ----
  updateCamera(dt) {
    if (!this.cameraControlled) return;
    const moving = this.mode === 'walk' && this.onGround && this.canMove && (this.input.axis().x || this.input.axis().y);
    this.bobAmt = THREE.MathUtils.damp(this.bobAmt || 0, moving ? 1 : 0, 6, dt);
    const bobY = Math.sin(this.bob * Math.PI) * 0.035 * this.bobAmt;
    const bobX = Math.cos(this.bob * Math.PI * 0.5) * 0.02 * this.bobAmt;
    let eye = PLAYER.eye, pitch = this.pitch, roll = 0;
    if (this.override) {
      const o = this.override, w = o.weight ?? 1;
      eye = THREE.MathUtils.lerp(eye, o.eye ?? eye, w);
      pitch = THREE.MathUtils.lerp(pitch, o.pitch ?? pitch, w);
      roll = THREE.MathUtils.lerp(0, o.roll ?? 0, w);
    }
    const c = this.camera;
    // On a curved ladder (the observatory dome's) the eyes are along the ladder from the feet, not straight above them,
    // and a little further off it than the feet (a climber's head is held back from the rungs): otherwise, where it
    // leans in over the dome, the view floats out into the air. Eased, so taking hold and stepping off don't jump.
    const onCurve = this.mode === 'ladder' && this.ladder?.path;
    const k = 1 - Math.exp(-dt * 8);
    this.bodyUp.lerp(onCurve ? this.ladderAxis : _UP, k).normalize();
    if (this.bodyUp.y > 0.99999) this.bodyUp.copy(_UP);
    this.eyeOut.lerp(onCurve ? _o.copy(this.ladderOut).multiplyScalar(LADDER_EYE_OUT) : _o.set(0, 0, 0), k);
    if (!onCurve && this.eyeOut.lengthSq() < 1e-8) this.eyeOut.set(0, 0, 0);
    const u = this.bodyUp, o = this.eyeOut;
    if (this.mode === 'sit') this.seatedEye(c.position);
    else c.position.set(this.feet.x + u.x * eye + o.x + Math.cos(this.yaw) * bobX, this.feet.y + u.y * eye + o.y + bobY, this.feet.z + u.z * eye + o.z - Math.sin(this.yaw) * bobX);
    if (this.extraCam) c.position.add(this.extraCam);
    const t = performance.now() / 1000;
    const sh = this.shake;
    c.rotation.set(
      pitch + sh * 0.012 * (Math.sin(t * 37) + Math.sin(t * 59.3)),
      this.yaw + sh * 0.012 * (Math.sin(t * 41.7) + Math.sin(t * 67.1)),
      roll + sh * 0.008 * Math.sin(t * 29.3),
      'YXZ',
    );
  }
}
