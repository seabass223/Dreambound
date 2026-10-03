// What each walls flag may change in the anchors (compare.mjs). Anything no rule of an active flag matches must be
// EXACT. A flag is active when it is on in the candidate and off in the baseline, so a cumulative run gets the
// union of its flags' relaxations, while every gate of every active flag still applies.
//
// Paths are dotted anchor keys; '*' matches one whole segment, '**' any number (including none). Arrays are
// flattened too, so an AABB corner is `...max.0`-`...max.2` and its pattern ends in `.max.*`. Every rule must
// match something in the baseline (compare.mjs fails on a dead one).
// relax: [path, rule]  rule = 'any' | { abs } (|cand - base| <= abs) | { plus } (cand <= base + plus) | { minus } (cand >= base - minus)
// gates: [path, rule]  checked on the candidate whether or not the value changed:
//        { max } | { min } (orBase: or no worse than the baseline, where it already misses the limit; reported
//        as pre-existing) | { plus } | { minus } | { equals } | { notEquals } | { addedRms } (RMS of cand - base
//        over an array) | { addedSd } (sqrt(cand^2 - base^2): spread added to the baseline's)
//        | { ratio: [num, den, limit], minDepth, orBase } (two leaves of one rowStats row)
//        | { atDepth, key, ...rule } (the rowStats row nearest a depth; the rule applies to row[key])
// Rules follow the stage gates of the walls plan (see README.md); tighten them as each stage lands, and never
// loosen one just to make a run pass.

// Always checked, every variant (the mesh contract and the wall material rules).
export const INVARIANTS = [
  ['stacks.*.cliff.rowsInt', { equals: true }],
  ['stacks.*.cliff.monotonic', { equals: true }],
  ['stacks.*.cliff.row0IsCapRing', { equals: true }],
  ['stacks.*.cliff.seamColumnDuplicated', { equals: true }],
  ['stacks.*.materials.cliff.transparent', { equals: false }],
  ['stacks.*.materials.cliff.alphaTest', { equals: 0 }],
  ['stacks.*.materials.cliff.discard', { equals: false }],
  ['stacks.*.materials.cliff.fragDepth', { equals: false }],
  ['lod.cliffRegistered', { equals: false }],
  ['coverage.missing', { equals: [] }],
];

const HEIGHT_ONLY = (s) => [
  [`placements.scatter.${s}.*.y`, 'any'],
  [`placements.adds.${s}.*.y`, 'any'],
  [`stacks.${s}.cap.sha.position`, 'any'],
  [`stacks.${s}.cap.sha.normal`, 'any'],
  [`stacks.${s}.cap.sha.color`, 'any'],
  [`stacks.${s}.relief.**`, 'any'],
  [`stacks.${s}.rimSlopeMaxDeg`, 'any'],
  [`stacks.${s}.group.*.position`, 'any'],   // names and materials of the other meshes stay exact
  [`stacks.${s}.colliders.pieces.*.min.*`, { abs: 2 }],
  [`stacks.${s}.colliders.pieces.*.max.*`, { abs: 2 }],
  [`${s}.bench.*`, 'any'],
];

export const FLAGS = {
  // S1a: integer uv period on the wall.
  uv: {
    relax: [['stacks.*.cliff.sha.uv', 'any']],
    gates: [],
  },
  // S1: CPU bake, colour/normal arrays only.
  bake: {
    relax: [
      ['stacks.*.cliff.sha.color', 'any'], ['stacks.*.cliff.sha.normal', 'any'],
      ['stacks.*.cap.sha.color', 'any'], ['stacks.*.cap.sha.normal', 'any'],
      ['stacks.*.cliff.rowStats.*.seamNormalDeg', 'any'], ['stacks.*.cliff.seamNormalMaxDeg', 'any'],
    ],
    gates: [['stacks.*.cliff.seamNormalMaxDeg', { max: 1 }]],
  },
  // S2: wall material (requires uv). Only the wall's own material may change: M.cliff, M.cap, M.stone and the
  // rock textures are shared with the tor, piles and hoods (sharedMaterials stays exact), and the wall needs its
  // own program key, or three.js reuses the 'db:n' program for it.
  shader: {
    relax: [['stacks.*.materials.cliff.**', 'any']],
    gates: [
      ['walls.uv', { equals: true }],
      ['stacks.*.materials.cliff.key', { equals: 'db:n|wall' }],
      ['stacks.*.materials.cliff.name', { notEquals: 'cliff' }],
    ],
  },
  // S3: masked sub-rim geometry.
  geo: {
    relax: [
      ['stacks.*.cliff.sha.position', 'any'], ['stacks.*.cliff.sha.normal', 'any'],
      ['stacks.*.cliff.rowStats.**', 'any'], ['stacks.*.cliff.top12MaxNy', 'any'], ['stacks.*.cliff.minRowGap', 'any'],
      ['stacks.*.cliff.seamNormalMaxDeg', 'any'],
      ['stacks.*.colliders.pieces.*.min.*', { abs: 3 }], ['stacks.*.colliders.pieces.*.max.*', { abs: 3 }],
      ['physics.colliders.*.min.*', { abs: 3 }], ['physics.colliders.*.max.*', { abs: 3 }],
      ['end.rocksEndGap.**', 'any'],
      ['rocks.tor.buried.**', 'any'], ['rocks.piles.*.buried.**', 'any'],
      ['dome.trees.**', 'any'], ['tower.trees.**', 'any'], ['gatehouse.footMargin', 'any'],
    ],
    gates: [
      ['stacks.*.cliff.top12MaxNy', { max: 0.55, orBase: true }],   // End 0.70 and Mountain 0.59 already miss it
      ['stacks.*.cliff.minRowGap', { min: 0.3 }],
      ['end.rocksEndGap.aboveDeck.min', { minus: 1 }],
      ['stacks.*.cliff.rowStats.*.devMax', { plus: 3 }],     // flare; the plan's band is 100-230 m, applied to every row
      // The θ=0 seam cross-fade must not make the seam window steeper than the rest of the row (from 1.4 m down;
      // rows whose legacy seam already misses 1.25 must not get worse).
      ['stacks.*.cliff.rowStats.*', { ratio: ['step.window', 'step.rest', 1.25], minDepth: 1.4, orBase: true }],
      // Positive: the relief must be there. The plan's target is 1.2-1.8 m RMS outside the protected arcs (up to
      // ~60 % of the Dome ring above 22 m) under the smoothstep(3, 28) depth ramp, so the whole-ring spread it adds
      // is at least ~0.15 m at 10 m and ~0.5 m at 19 m; at 4.6 m the ramp adds ~1 %, so no loss is all we ask.
      ['stacks.*.cliff.rowStats', { atDepth: 4.6, key: 'devSd', minus: 0.02 }],
      ['stacks.*.cliff.rowStats', { atDepth: 10, key: 'devSd', addedSd: 0.15 }],
      ['stacks.*.cliff.rowStats', { atDepth: 19, key: 'devSd', addedSd: 0.5 }],
      ['rocks.tor.buried.minMargin', { min: 0.3 }], ['rocks.piles.*.buried.minMargin', { min: 0.3 }],
      ['dome.trees.margin', { min: 0.3 }], ['tower.trees.margin', { min: 0.3 }], ['gatehouse.footMargin', { min: 0.3 }],
    ],
  },
  // S3: outward-only calm smoothing (same surface as geo).
  calmSmooth: null,
  // S4: cap relief on Dome and Rocks (Tower, Mountain, End byte-identical; rims and features masked).
  relief: {
    relax: [
      ...HEIGHT_ONLY('dome'), ...HEIGHT_ONLY('rocks'), ['placements.trails.dome.position', 'any'],   // Rocks has no trail
      ['dome.padFlatness', 'any'], ['dome.ringSlope15to22', 'any'], ['dome.sightline.**', 'any'], ['dome.spawnHeight', 'any'],
      ['rocks.movable.*.y', 'any'], ['rocks.frogs.*.1', 'any'], ['emitters.*.pos.1', 'any'], ['emitters.*.spots', 'any'],
      ['rocks.sequoia.carRect.**', 'any'],
      // The gatehouse's floor stands on the highest Rocks ground under its corridor, and its stairs share the drop from
      // there to the End landing (End itself has no relief).
      ['rocks.bridgeA.1', { abs: 0.02 }], ['gatehouse.sill.1', { abs: 0.02 }], ['gatehouse.top.1', { abs: 0.02 }],
      ['gatehouse.sectionEnds.*.1', { abs: 0.02 }], ['gatehouse.step.*', { abs: 0.02 }], ['gatehouse.endLip.*', { abs: 0.05 }],
      ['physics.dynamic.*.y0', 'any'], ['physics.dynamic.*.y1', 'any'],
      ['physics.colliders.*.min.*', { abs: 2 }], ['physics.colliders.*.max.*', { abs: 2 }],
    ],
    gates: [
      ['dome.padFlatness', { plus: 0.0005 }],
      ['dome.ringSlope15to22', { max: 0.35 }],
      ['dome.sightline.*.h', { max: 1.5 }],
      ['rocks.sequoia.carRect.clearance', { min: 0.02 }],
      ['stacks.dome.relief.values', { addedRms: 0.4 }], ['stacks.rocks.relief.values', { addedRms: 0.4 }],
    ],
  },
  // S5 (optional): rounded shoulder, lowers the rim only.
  shoulder: {
    relax: [
      ['stacks.*.cap.sha.**', 'any'], ['stacks.*.cliff.sha.**', 'any'], ['stacks.*.cliff.rowStats.**', 'any'],
      ['stacks.*.cliff.top12MaxNy', 'any'], ['stacks.*.cliff.minRowGap', 'any'], ['stacks.*.cliff.seamNormalMaxDeg', 'any'],
      ['stacks.*.relief.**', 'any'], ['stacks.*.rimSlopeMaxDeg', 'any'],
      ['stacks.*.colliders.pieces.*.min.*', { abs: 2 }], ['stacks.*.colliders.pieces.*.max.*', { abs: 2 }],
      ['physics.colliders.*.min.*', { abs: 2 }], ['physics.colliders.*.max.*', { abs: 2 }],
      ['placements.scatter.*.*.y', 'any'], ['placements.adds.*.*.y', 'any'], ['stacks.*.group.*.position', 'any'],
    ],
    gates: [
      ['stacks.*.rimSlopeMaxDeg', { max: 37 }],
      ['stacks.*.cliff.top12MaxNy', { max: 0.55, orBase: true }],
      ['stacks.*.cliff.minRowGap', { min: 0.3 }],
    ],
  },
};
FLAGS.calmSmooth = FLAGS.geo;
