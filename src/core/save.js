// Saved games (localStorage). One save (SAVE_KEY), written when the player asks (Escape panel > Save). Closing the
// page with progress the save doesn't have brings up the browser's own "Leave site?" prompt (main.js); leave anyway
// and that progress is gone.
//
// A snapshot holds where the player stands (the last safe pose: never mid-ride, mid-fall, on a ladder or in a
// cutscene), the time of day and every piece of puzzle state, and restore() puts it all back through the props' own
// APIs so the world looks the way it was left.

export const SAVE_KEY = 'dreambound.save.v1';
const OLD_PENDING_KEY = 'dreambound.save.pending.v1';   // where earlier builds kept unsaved progress at unload
const VERSION = 1;

const R = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export function readSnapshot(key) {
  try {
    const s = JSON.parse(localStorage.getItem(key) || 'null');
    return s && s.v === VERSION && s.player ? s : null;
  } catch { return null; }
}
function write(key, snap) {
  try { localStorage.setItem(key, JSON.stringify(snap)); return true; } catch { return false; }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
export function clearSaves() { remove(SAVE_KEY); }

// isSafe(): the player may be saved where they stand right now (main.js: walking on the ground, free to move, no
// sequence, not riding). enabled(): saving is on at all (off for ?nosave / ?spawn, dev capture, and after the ending).
export function createSaveSystem({ ctx, player, clock, isSafe, enabled }) {
  remove(OLD_PENDING_KEY);   // (a leftover would otherwise sit in storage for good)
  let lastSafe = null;     // the newest pose isSafe() allowed, with the elevators as they were then
  let baseline = null;     // the snapshot the current game started from (the save, or the fresh start)
  let savedAt = 0;         // ms timestamp of the save this game matches (0: never saved)
  let t = 0;

  const elevators = () => Object.fromEntries((ctx.elevators ?? []).map((e) => [e.id, e.at]));
  const pose = () => ({
    x: R(player.feet.x), y: R(player.feet.y), z: R(player.feet.z),
    yaw: R(player.yaw), pitch: R(player.pitch), zone: player.zone,
    elevators: elevators(),
  });

  // The whole game as JSON-safe data.
  const snapshot = () => {
    const p = isSafe() ? pose() : lastSafe ?? (baseline ? { ...baseline.player, elevators: baseline.elevators ?? elevators() } : pose());
    const s = ctx.state ?? {};
    const obs = s.observatory;
    const { elevators: lifts, ...where } = p;
    return {
      v: VERSION,
      time: Date.now(),
      player: where,
      clock: { phase: R(clock.phase, 5) },
      switches: s.switches ? [...s.switches] : null,
      power: ctx.power ? { ...ctx.power } : null,
      rocks: s.rocks ? {
        positions: s.rocks.positions.map((q) => ({ x: R(q.x), z: R(q.z) })),
        pushes: [...s.rocks.pushes],
        solved: !!s.rocks.solved,
      } : null,
      towerSwitches: s.towerSwitches ? s.towerSwitches.map((b) => [...b]) : null,
      towerLEDs: ctx.towerLEDs ? ctx.towerLEDs.map((l) => R(l.level)) : null,
      observatory: obs ? { yaw: R(obs.yaw, 5), pitch: R(obs.pitch, 5), hatch: R(obs.hatch), stationOpen: !!obs.stationOpen } : null,
      lounge: s.lounge ? { secretOpen: !!s.lounge.secretOpen } : null,
      bunker: s.bunker ? { open: !!s.bunker.open } : null,
      elevators: lifts,
    };
  };

  // What counts as progress: everything but the clock and small shuffles of the pose (under 1.5 m, or turning).
  const progressKey = (snap) => JSON.stringify({
    switches: snap.switches, power: snap.power, towerSwitches: snap.towerSwitches, towerLEDs: snap.towerLEDs,
    rocks: snap.rocks && { positions: snap.rocks.positions.map((q) => [Math.round(q.x * 5), Math.round(q.z * 5)]), solved: snap.rocks.solved },
    observatory: snap.observatory && { yaw: Math.round(snap.observatory.yaw * 50), pitch: Math.round(snap.observatory.pitch * 50), open: snap.observatory.stationOpen },
    lounge: snap.lounge,
    bunker: snap.bunker,
    elevators: snap.elevators,
  });
  const dirty = () => {
    if (!enabled() || !baseline) return false;
    const now = snapshot();
    const a = now.player, b = baseline.player;
    if (a.zone !== b.zone || Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1.5) return true;
    return progressKey(now) !== progressKey(baseline);
  };

  const api = {
    snapshot,
    dirty,
    get savedAt() { return savedAt; },
    get hasSave() { return !!readSnapshot(SAVE_KEY); },

    // Every frame: remember the newest safe pose (a few times a second).
    tick(dt) {
      t -= dt;
      if (t > 0) return;
      t = 0.25;
      if (isSafe()) lastSafe = pose();
    },

    // The game this session is measured against for "unsaved progress".
    setBaseline(snap, time = 0) { baseline = snap; savedAt = time; },

    save() {
      if (!enabled()) return false;
      const snap = snapshot();
      if (!write(SAVE_KEY, snap)) return false;
      baseline = snap;
      savedAt = snap.time;
      return true;
    },

    // Put a snapshot back into the world. keepClock: leave the time of day alone (?t= given).
    restore(snap, { keepClock = false } = {}) {
      const s = ctx.state ?? {};
      ctx.restoring = true;
      try {
        if (!keepClock && Number.isFinite(snap.clock?.phase)) { clock.phase = ((snap.clock.phase % 1) + 1) % 1; clock.update(0); }

        // The generator's four switches and the lines they feed (props/cave.js). Its levers and lamps follow on
        // their own the next time the hub is drawn.
        if (Array.isArray(snap.switches) && s.switches) snap.switches.forEach((on, i) => { if (i < s.switches.length) s.switches[i] = !!on; });
        if (snap.power && ctx.power) for (const k of Object.keys(ctx.power)) if (k in snap.power) ctx.power[k] = !!snap.power[k];

        // The Rocks boulders (props/movableRocks.js).
        if (snap.rocks && s.rocks && ctx.boulders?.place) {
          snap.rocks.positions.forEach((q, i) => ctx.boulders.place(i, q.x, q.z));
          s.rocks.pushes = Array.isArray(snap.rocks.pushes) ? [...snap.rocks.pushes] : [];
          if (snap.rocks.solved && !s.rocks.solved) { s.rocks.solved = true; ctx.onRocksSolved?.(); }
        }

        // The Tower's catwalk switch boxes and LEDs (props/powertower.js).
        if (Array.isArray(snap.towerSwitches) && ctx.towerSwitches?.set) {
          snap.towerSwitches.forEach((box, b) => box.forEach((v, j) => ctx.towerSwitches.set(b, j, v)));
        }
        if (Array.isArray(snap.towerLEDs) && ctx.towerLEDs) snap.towerLEDs.forEach((v, i) => { if (ctx.towerLEDs[i]) ctx.towerLEDs[i].level = num(v, ctx.towerLEDs[i].level); });

        // The observatory: dome and telescope, the rear hatch, the roof station's iris (props/observatory*.js).
        const o = snap.observatory, st = s.observatory;
        if (o && st) {
          st.yaw = num(o.yaw, st.yaw);
          st.pitch = num(o.pitch, st.pitch);
          if (ctx.observatory?.hatch?.set) ctx.observatory.hatch.set(num(o.hatch, 0));
          if (o.stationOpen && ctx.observatory?.station?.open) ctx.observatory.station.open(true);
        }

        // The lounge's secret bookcase (props/loungeSecret.js): once open, it stays open.
        if (snap.lounge?.secretOpen) ctx.tunnels?.lounge?.secret?.open(true);
        // The Tower bunker's door (world/bunker.js), open or shut as it was left.
        if (snap.bunker && ctx.bunker) ctx.bunker.door.set(!!snap.bunker.open);

        // Elevators: which stop each car waits at (doors shut, as built).
        const lifts = snap.elevators ?? {};
        for (const el of ctx.elevators ?? []) if (lifts[el.id] && el.ends[lifts[el.id]]) { el.at = lifts[el.id]; el.busy = false; }

        // The player, and if they stand in a car, its doors open.
        const p = snap.player;
        player.zone = p.zone === 'tunnel' ? 'tunnel' : 'surface';
        player.place(p.x, p.y + 0.05, p.z, num(p.yaw, 0));
        player.pitch = num(p.pitch, 0);
        for (const el of ctx.elevators ?? []) {
          const end = el.ends[el.at];
          if (end && end.root.getWorldPosition(end.soundPos.clone()).distanceTo(player.feet) < 2.6) end.target = 1;
        }

        ctx.onSwitches?.(s.switches);
        ctx.onTowerSwitches?.(s.towerSwitches);
      } finally {
        ctx.restoring = false;
      }
      lastSafe = null;
      baseline = snap;
    },
  };
  return api;
}
