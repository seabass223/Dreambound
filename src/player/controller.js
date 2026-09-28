import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { clamp } from '../core/rng.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _prev = new THREE.Vector3();

export class Player {
  constructor(camera, input, physics) {
    this.camera = camera;
    this.input = input;
    this.physics = physics;
    this.feet = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.onGround = false;
    this.zone = 'surface';
    this.mode = 'walk';          // walk | ladder | locked
    this.canMove = false;
    this.lookHandler = null;     // when set, mouse drives this instead of the view
    this.ladder = null;
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
    this.feet.set(x, y, z);
    this.vel.set(0, 0, 0);
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
    else if (this.canMove || this.mode === 'fallLook') {
      this.yaw -= m.x * this.sensitivity;
      this.pitch = clamp(this.pitch - m.y * this.sensitivity, -1.45, 1.45);
    }

    if (this.mode === 'ladder') this.updateLadder(dt);
    else if (this.mode === 'walk') this.updateWalk(dt);

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
    for (let i = 0; i < steps; i++) {
      if (this.onGround) this.vel.y = PLAYER.gravity * sdt;
      else this.vel.y = Math.max(PLAYER.terminal, this.vel.y + PLAYER.gravity * sdt);
      _prev.copy(this.feet);
      this.feet.y += this.vel.y * sdt;
      this.feet.addScaledVector(_move, speed * sdt);
      this.contacts.length = 0;
      this.physics.resolveCapsule(this.feet, PLAYER.radius, PLAYER.height, this.zone, this.contacts);
      const dy = this.feet.y - (_prev.y + this.vel.y * sdt);
      this.onGround = dy > Math.abs(this.vel.y * sdt * 0.25) || (this.onGround && dy > 1e-4);
      if (this.onGround) this.vel.y = 0;
    }
    // Snap down gentle descents so walking downhill doesn't hop.
    if (wasGround && !this.onGround && this.vel.y <= 0) {
      const hit = this.physics.raycastDown(this.feet, 0.45, this.zone);
      if (hit) { this.feet.y = hit.point.y; this.onGround = true; this.vel.y = 0; }
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
  // at or null (instead of the straight tests), path(h, feet, tangent) (a curved ladder: where the feet are h metres up
  // it, and its upward direction), onTop / onBottom(player) (at that end: move the player on and return true, or return
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
    if (L.path) { L.path(this.ladderH, this.feet); return; }
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
    c.position.set(this.feet.x + Math.cos(this.yaw) * bobX, this.feet.y + eye + bobY, this.feet.z - Math.sin(this.yaw) * bobX);
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
