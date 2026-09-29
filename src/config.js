// World constants. Units are meters; +Y is up. The sun sets toward -X.

export const DAY_SECONDS = 7 * 60;
export const NIGHT_SECONDS = 6 * 60;

export const CLOUD_DECK_Y = -320;
export const STACK_BOTTOM_Y = -900;
export const TUNNEL_ORIGIN = { x: 0, y: -2400, z: 0 }; // enclosed network, rendered only underground
export const UNDERGROUND_Y = -1500;

export const PLAYER = {
  radius: 0.32,
  height: 1.78,
  eye: 1.66,
  walk: 3.4,
  run: 6.2,
  gravity: -22,
  terminal: -58,
  // The steepest ground you can walk up, in degrees, on the colliders that have a walkable slope (the Mountain's:
  // its hillsides are steeper, so the switchbacks are the way up). See Physics.resolveCapsule.
  maxSlope: 35,
};

export const STACKS = {
  dome: { name: 'dome', x: 0, z: 0, top: 0, r: 58, seed: 11 },
  rocks: { name: 'rocks', x: -300, z: 175, top: 6, r: 50, seed: 23 },
  mountain: { name: 'mountain', x: 285, z: 245, top: 2, r: 72, seed: 37 },
  tower: { name: 'tower', x: 95, z: -335, top: 8, r: 48, seed: 51 },
  end: { name: 'end', x: 0, z: 0, top: -10, r: 18, seed: 67 }, // placed relative to rocks below
};

// End sits beyond Rocks along a fixed heading, joined by a descending bridge.
{
  const dir = { x: -0.34, z: 0.94 };
  const len = Math.hypot(dir.x, dir.z);
  dir.x /= len; dir.z /= len;
  const gap = 58;
  const d = STACKS.rocks.r + gap + STACKS.end.r;
  STACKS.end.x = STACKS.rocks.x + dir.x * d;
  STACKS.end.z = STACKS.rocks.z + dir.z * d;
  STACKS.end.top = STACKS.rocks.top - 16;
  STACKS.end.bridgeDir = dir;
}

export const SPAWN = { x: 21, z: 7, yaw: Math.PI / 2 + 0.25 }; // on Dome, looking west past the dome toward sunset

// Stack walls/edges rework: one flag per stage, each shipped once its gate passed (see tools/regress/README.md);
// shoulder (S5) is not built yet. Override with ?walls=0 (all off, the pre-rework world), ?walls=1 (all on but
// shoulder) or ?walls=+bake,-shader; Node sets globalThis.__WALLS to the same string before the first import.
export const WALLS = { uv: true, bake: true, shader: true, geo: true, calmSmooth: true, relief: true, shoulder: false };
{
  const spec = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('walls') : null) ?? globalThis.__WALLS;
  for (const tok of spec == null ? [] : String(spec).split(',')) {
    const t = tok.trim();
    if (t === '0' || t === '1') { for (const k in WALLS) WALLS[k] = t === '1' && k !== 'shoulder'; continue; }
    const on = t[0] !== '-', k = t.replace(/^[+-]/, '');
    if (k in WALLS) WALLS[k] = on;
    else if (k) console.warn('walls: unknown flag', k);
  }
  // The wall shader tiles by the integer uv period, so it never runs on the legacy uvs.
  if (WALLS.shader && !WALLS.uv) { console.warn('walls: shader requires uv; turning uv on'); WALLS.uv = true; }
}
