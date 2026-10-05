// The descent: the player's first step out of the gatehouse onto the stairs (props/gatehouse.js calls its onFirstStep,
// main.js wires it here), and from then on there's no going back. Whatever the hour, the sky turns to midnight and
// stays there (the clock eases forward to it, or back the short way if midnight has only just gone); a storm rolls in
// (rain, lightning and thunder, the wind up: render/storm.js); the time of day and Travel are locked in the menu
// (ui/settings.js), and so is the pace: Walk speed is held at 1x whatever the setting, and Shift doesn't run; and the
// staircase is armed, so each section falls away once it's behind the player.
//
// Also called by a restored save that was made after it (core/save.js), instant: midnight, the storm and the locks at
// once. ctx.state.endgame.descent is the flag the save keeps.

export const MIDNIGHT = 10 / 13;   // the clock's phase at midnight (0 is sunrise; the night runs 7/13 .. 1)

// The clock's ease to midnight: ~6 s, plus up to 10 s more the further the sky has to turn (as a fraction of a whole
// day), at most 16 s; the way it goes is the clock's own (holdAt: forward, unless that's most of a day round).
export function descentSeconds(phase) {
  const fwd = (((MIDNIGHT - phase) % 1) + 1) % 1;
  const d = fwd > 0.85 ? 1 - fwd : fwd;
  return Math.min(16, 6 + 10 * d);
}

export function startDescent(ctx, { clock = ctx.clock, storm = ctx.storm, settings = ctx.settings, instant = false } = {}) {
  const eg = (ctx.state.endgame ||= { open: false, descent: false });
  // Once a session: the gatehouse's first step after a restore (which already started it) changes nothing.
  if (ctx.descending) return false;
  ctx.descending = true;
  eg.open = true;
  eg.descent = true;
  if (clock?.holdAt) clock.holdAt(MIDNIGHT, instant ? 0 : descentSeconds(clock.phase));
  storm?.set?.(1, instant ? 0 : 18);
  settings?.lockTime?.(true);
  settings?.lockTravel?.(true);
  settings?.lockWalk?.(true);
  if (ctx.gatehouse) ctx.gatehouse.armed = true;
  return true;
}
