import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { PLAYER } from '../config.js';

const ease = (a, b, t) => smoothstep(a, b, t);

// Waking up in bed: blurry, over-bright, a short high ringing, looking up at the timber beams.
// Then sitting up, swinging round, and standing beside the bed.
export function createIntro(ctx) {
  let t = 0;
  const { player, fx, audio } = ctx;
  const wake = ctx.house?.wake;
  player.canMove = false;
  player.mode = 'intro';
  if (wake) { player.feet.copy(wake.bed); player.yaw = wake.bedYaw; }
  player.override = { eye: 0.22, pitch: 1.05, roll: 0.3, weight: 1 };
  fx.fade = 1; fx.blur = 1.2; fx.vignette = 1.3; fx.bloomStrength = 1.3;
  let rang = false;
  const yawDelta = wake ? Math.atan2(Math.sin(wake.standYaw - wake.bedYaw), Math.cos(wake.standYaw - wake.bedYaw)) : 0;
  const from = new THREE.Vector3();
  return {
    done: false,
    update(dt) {
      t += dt;
      if (!rang && t > 0.4) { rang = true; audio.play('ringing'); }
      // Eyes open, one slow blink.
      let fade = 1 - ease(0.3, 3.2, t);
      fade = Math.max(fade, ease(3.6, 3.85, t) * (1 - ease(3.95, 4.5, t)) * 0.9);
      fx.fade = fade;
      fx.blur = 1.2 * (1 - ease(1, 11, t));
      fx.vignette = 1.3 - ease(2, 11, t) * 0.95;
      fx.bloomStrength = 1.3 - ease(1, 10, t) * 0.95;
      // Sit up, turn to the side of the bed, then stand.
      const sit = ease(4.8, 8.2, t), turn = ease(7.2, 9.4, t), stand = ease(8.6, 11.0, t);
      const o = player.override;
      o.eye = 0.22 + sit * 0.62 + stand * (PLAYER.eye - 0.84);
      o.pitch = 1.05 * (1 - sit) - 0.12 * sit * (1 - stand);
      o.roll = 0.3 * (1 - ease(4.5, 7.5, t)) + Math.sin(t * 0.6) * 0.02 * (1 - stand);
      o.weight = 1 - ease(11.0, 12.0, t);
      if (wake) {
        player.yaw = wake.bedYaw + yawDelta * turn;
        from.copy(wake.bed);
        player.feet.lerpVectors(from, wake.stand, ease(8.4, 11.0, t));
      }
      if (t > 12) {
        player.override = null;
        player.mode = 'walk';
        if (wake) player.place(wake.stand.x, wake.stand.y, wake.stand.z, player.yaw);
        player.canMove = true;
        fx.fade = 0; fx.blur = 0;
        this.done = true;
      }
    },
  };
}
