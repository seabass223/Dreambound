import { PLAYER } from '../config.js';
import { smoothstep, clamp } from '../core/rng.js';

// The walls flare outward with depth faster than a slow walk-off drifts away from them, so the fall drifts
// clear on its own: the capsule's surface keeps about a metre off the built wall mesh.
const CLEAR = PLAYER.radius + 1.0;
const AHEAD = [0, 0.15, 0.3, 0.45, 0.6, 0.8];   // s of fall the drift looks ahead

// Walking off a stack: accelerate toward the clouds, drift the view up to the sky, shake,
// blur and fade to black, then wake back on the ledge. You can't die in a dream.
export function createFall(ctx) {
  const { player, fx, audio } = ctx;
  // The walls the fall starts outside of. One it starts inside (a shaft, the End door) is left alone, and so is
  // the stack under it (the trigger can fire on a steep cap face): drifting out would fling it across the cap.
  const stacks = Object.values(ctx.stacks).filter((st) => {
    const f = player.feet, th = Math.atan2(f.z - st.cz, f.x - st.cx), d = Math.hypot(f.x - st.cx, f.z - st.cz);
    const R = st.wallRadius(th, f.y);
    return R === null ? d > st.edgeR(th) : d >= R;
  }).map((st) => ({ st, reach: st.wallReach() + CLEAR }));
  let t = 0;
  let wind = audio.loop('fallWind');
  // Off the gatehouse's stairs during the descent the spot a moment back may be a section that has since fallen away:
  // wake on the first one still standing ahead instead, or on End (props/gatehouse.js; it drops those spots from the
  // history as each section goes).
  const spot = (ctx.gatehouse?.armed && ctx.gatehouse.respawnSpot()) || player.safeSpot();
  const startPitch = player.pitch;
  player.mode = 'falling';
  player.canMove = false;
  const vx = player.vel.x, vz = player.vel.z;
  let vy = Math.min(player.vel.y, -4);
  let dx = 0, dz = 0;   // outward drift, eased so it never snaps
  let placed = false;

  // Eases the drift toward the outward speed that keeps the capsule CLEAR of every wall it is about to pass.
  const drift = (dt) => {
    const f = player.feet;
    let wx = 0, wz = 0;
    for (const { st, reach } of stacks) {
      const lx = f.x - st.cx, lz = f.z - st.cz, d = Math.hypot(lx, lz);
      // Outward speed that clears the wall at each point ahead in time, where the walk's own speed carries the
      // capsule (a fall along the wall passes columns); what is already close gets 0.25 s.
      let need = 0;
      for (const ahead of AHEAD) {
        const T = Math.max(ahead, 0.25), pd = Math.hypot(lx + vx * T, lz + vz * T);
        if (pd >= reach) continue;   // clear of every part of this wall
        const y = f.y + vy * ahead, th = Math.atan2(lz + vz * ahead, lx + vx * ahead);
        // A capsule's width to either side too, so a fin beside the path (the theta=0 seam) is seen coming.
        let R = -Infinity;
        for (const a of [th - CLEAR / pd, th, th + CLEAR / pd]) {
          R = Math.max(R, st.wallRadius(a, y) ?? -Infinity, st.wallRadius(a, y + PLAYER.height) ?? -Infinity);
        }
        need = Math.max(need, (R + CLEAR - pd) / T);
      }
      if (need <= 0) continue;
      wx += lx / d * need; wz += lz / d * need;
    }
    // Picks up quickly (a 50 ms ease, no snap) and lets go slowly, so it reads as drifting away from the cliff.
    const k = 1 - Math.exp(-dt * (wx * wx + wz * wz > dx * dx + dz * dz ? 20 : 1.5));
    dx += (wx - dx) * k; dz += (wz - dz) * k;
  };

  return {
    done: false,
    update(dt) {
      t += dt;
      if (!placed) {
        vy = Math.max(PLAYER.terminal, vy + PLAYER.gravity * dt);
        drift(dt);
        player.feet.x += (vx + dx) * dt; player.feet.z += (vz + dz) * dt;
        player.feet.y += vy * dt;
        const k = clamp(-vy / -PLAYER.terminal, 0, 1);
        player.pitch = startPitch + (1.3 - startPitch) * smoothstep(0, 3.5, t);
        player.shake = k * 1.4;
        fx.blur = smoothstep(0.6, 3.6, t) * 1.3;
        fx.vignette = 0.35 + smoothstep(0.3, 3.2, t) * 1.4;
        fx.fade = smoothstep(2.6, 4.3, t);
        wind?.set(k);
        if (t > 4.5) {
          placed = true;
          t = 0;
          wind?.stop(); wind = null;
          player.shake = 0;
          player.mode = 'walk';
          if (spot) {
            player.zone = spot.zone;
            player.place(spot.x, spot.y + 0.05, spot.z, spot.yaw);
          }
          player.pitch = 0;
          player.override = { eye: 1.5, pitch: -0.15, roll: 0.03, weight: 1 };
        }
      } else {
        // Hold in black, then come back softly.
        fx.fade = 1 - smoothstep(0.6, 2.4, t);
        fx.blur = 1.0 * (1 - smoothstep(0.8, 3.2, t));
        fx.vignette = 1.75 - smoothstep(0.8, 3.5, t) * 1.4;
        const o = player.override;
        o.weight = 1 - smoothstep(1.2, 3.0, t);
        if (t > 2.2) player.canMove = true;
        if (t > 3.5) { player.override = null; fx.blur = 0; fx.vignette = 0.35; this.done = true; }
      }
    },
  };
}
