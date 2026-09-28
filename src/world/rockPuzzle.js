// The Rocks boulder puzzle: where the five movable boulders (props/movableRocks.js) must be pushed. The Mountain
// observatory's telescope shows it in the sky at dusk and at night (render/constellation.js): the island's outline and
// the creek drawn in dim stars, and a bright star on each target.
//
// Offsets from the Rocks stack's centre, like the boulder spots in world/stacks/rocks.js: a ring of five, a regular
// pentagon 27 m round the island's centre (a stone circle, which the creek runs through), turned so every stone
// stands clear of the trees, the creek, the tor, the piles and the rim. Order doesn't matter: any boulder may fill any
// target. Each boulder has a clear straight push of 6-13 m onto one of them (proved with the real controller, physics
// and push rules by tools/regress/out/rock_puzzle_test.mjs; the scattered trees stay out of every path).
export const RING = { x: 0, z: 0, r: 27, phase: 49.5 };   // phase: degrees from +Z (north) towards +X
export const ROCK_TARGETS = [0, 1, 2, 3, 4].map((k) => {
  const a = ((RING.phase + k * 72) * Math.PI) / 180;
  return { x: RING.x + Math.sin(a) * RING.r, z: RING.z + Math.cos(a) * RING.r };
});

// A boulder counts as in place within this distance (m) of a target's centre.
export const TARGET_TOL = 1.2;

// Whether every target has its own boulder within tol (positions and targets in the same frame). Five of each: try
// every assignment (120), cheap enough to run on each push.
export function rocksOnTargets(positions, targets, tol = TARGET_TOL) {
  const n = targets.length;
  if (positions.length < n) return false;
  const near = targets.map((t) => positions.map((p) => Math.hypot(p.x - t.x, p.z - t.z) <= tol));
  const used = new Array(positions.length).fill(false);
  const fill = (i) => {
    if (i === n) return true;
    for (let j = 0; j < positions.length; j++) {
      if (used[j] || !near[i][j]) continue;
      used[j] = true;
      if (fill(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return fill(0);
}
