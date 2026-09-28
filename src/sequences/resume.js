import { smoothstep } from '../core/rng.js';

// Waking into a saved game (core/save.js): no bed, no ringing; the black lifts where you left off.
export function createResume(ctx) {
  const { player, fx } = ctx;
  let t = 0;
  player.canMove = false;
  fx.fade = 1; fx.blur = 0.6;
  return {
    done: false,
    update(dt) {
      t += dt;
      fx.fade = 1 - smoothstep(0.15, 1.8, t);
      fx.blur = 0.6 * (1 - smoothstep(0.3, 2.2, t));
      if (t > 0.6) player.canMove = true;
      if (t > 2.2) { fx.fade = 0; fx.blur = 0; this.done = true; }
    },
  };
}
