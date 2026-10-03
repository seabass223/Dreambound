# tools/regress: stack walls safety net

Dev-only Node harness for the stack walls/edges rework (flags `WALLS` in `src/config.js`). It builds the real
world headlessly, records every value the rework must keep ("anchors"), walks a capsule over the risky routes
with the real physics, and compares all of it against a baseline under a per-stage tolerance table.
No browser, no server, no GPU. Plain Node ESM, Node 22.15+ (uses `module.registerHooks`).

Run everything from the repo root.

```sh
node tools/regress/run.mjs                           # determinism check, then ?walls=0 vs the baseline (if recorded)
node tools/regress/run.mjs --compare --variant 0,+bake  # one variant against the baseline (anchors and routes)
node tools/regress/run.mjs --stages                  # ?walls=0, every flag alone and cumulative, each vs the baseline
node tools/regress/run.mjs --variant 1 --out f.json  # just record anchors for a variant (add --routes for routes)
node tools/regress/run.mjs --update-baseline         # write baseline.json + baseline_routes.json from ?walls=0
node tools/regress/compare.mjs a.json b.json         # diff two recordings (anchors or routes)
```

A variant is the `?walls=` string: `0` (all off), `1` (all on but shoulder), `+bake,-shader`, or a sequence such
as `0,+uv,+shader`. `default` means the flags as committed in `config.js`. `--base <anchors.json>` and
`--routes-base <routes.json>` compare against another recording instead of the baseline. Scratch output goes to
`tools/regress/out/`.

Timings on the dev machine (2026-10-02, with the endgame's models): world build 7-10 s, anchors 8-10 s per variant,
routes about 30 s alone (2385 cases) and 50 s with four processes at once, the default check (determinism, two
anchors and two routes processes in parallel, then `?walls=0` vs the baseline) about 81 s, `--compare` about 31 s,
`--update-baseline` about 49 s, `--stages` (14 variants, 8 at a time) about 129 s.

## How it works

- **world.mjs** calls the real `buildWorld` (`src/world/index.js`), so all five stacks are built by their real
  `stacks/*.js` functions in game order with the game's Rng streams. The GLB scenes are parsed from
  `public/models` (they carry no images); textures are blank and a canvas stub stands in for the DOM. The optional
  models load as they do in the game, when present: the Rocks tor's resculpt with its blast (`tor.glb`,
  `tor_blast.glb`), the Tower bunker's room (`bunker.glb`), the gatehouse on the Rocks rim and its stairs to End
  (`gatehouse.glb`), the End pedestal and light shafts (`endprops.glb`) and the pill clock (`alarmclock.glb`: the
  ending builds the clock, not the world, so it is only handed its model), so the
  headless world has the tor's own meshes, the boulders' meshes, the room, its terminal and its furniture boxes, the
  gatehouse with its doors and its 14 stair sections (their colliders built but off, as in a new game), and the
  pedestal standing in its square hole in the End cap. `buildHeadless({ torSculpt: false })` builds the procedural tor
  instead (`tools/blender/export_tor.mjs` uses it).
- **Flags** are read by `config.js` at module evaluation, so each variant runs in a fresh process with
  `globalThis.__WALLS` set before the first import (`run.mjs` spawns them; one world per process).
- **Taps**: build-function locals (ledge samples, the creek bed, the fall path, tor and pile shells, the
  sequoia plate, ...) are recorded by a module hook that redirects each import of a tapped module to a
  generated wrapper. The wrapper re-exports the real module and passes the listed functions through a
  recorder, so the real code runs unchanged and in the same order. The list is `TAPS` in `world.mjs`; forest,
  meadow, pebble and flower placements are recorded by wrapping those instances on `ctx`. If a tapped function
  is renamed, its anchors come out `null` and the coverage check below fails.
- **anchors.mjs** writes one JSON file: numbers exactly (JSON round-trips doubles), big arrays as SHA-256
  prefixes, nothing run-dependent (timings go to stderr), so two runs of one tree are byte-identical.
- **couplings.mjs** lists every coupling of the plan's four maps (77) with the anchor keys that record it.
  The run fails if a coupling has no recorded value. Couplings whose real effect is visual or a frame cost are
  marked `partial`: the harness records a stand-in and the frames/bench cover the rest.
- **compare.mjs** + **tolerances.mjs**: anything not relaxed by an active flag must be EXACT. A flag is active
  when it is on in the candidate and off in the baseline; relaxations of active flags are OR-ed, their gates
  all apply, and the invariants (mesh contract, wall material rules, coverage) apply to every run. Every rule
  in the table must match something in the baseline (a dead pattern fails the run). Gates marked `orBase`
  accept a value that misses the plan's limit only where the baseline already missed it and it got no worse;
  those are listed as pre-existing, so End's and Mountain's top-12 m ny cannot hide a new Dome shelf.
- **routes.mjs** runs the real `Player` controller against the real `Physics`, and after the controller's
  fall trigger the real `createFall` sequence. Route files are compared case by case: a case that passed in the
  baseline must pass, and with no geometry flag on (`geo`, `calmSmooth`, `relief`, `shoulder`) every walk must
  be identical (trace hash). With one on, the walk may differ, but a case that already failed must not fail
  differently or earlier: a walk-off's outcome (R6, and R7's out of the gatehouse doorway) may not get worse (fell,
  designed catch or held by the shut doors < eye breach < landing, stall or no fall), a landing may not move to
  another catcher or more than 0.5 m deeper, the first eye breach
  may not start more than max(1 m, 5 %) shallower, and the eye may not get more than 0.1 m closer in any depth
  band (0-30, 30-80, 80+ m, while the screen is visible) or over the whole fall where it is within 0.4 m. The
  ledge walks may not take over 10 % longer or leave the ledge line by 0.25 m more, and no creek point may lose
  a side that got out.

## What is recorded

Per stack: cap and cliff SHA of position/index/color/uv/normal, counts, `rows*(segs+1)`, rows monotonic and the
smallest row gap, row 0 equal to the cap's edge ring, the duplicated θ=0 column, per row the normal angle between
column 0 and column segs, radius spread and flare beyond the rim, column-step statistics (median, max, the θ=0 seam,
the ~35 m window after it, the rest), the steepest upward wall triangle in the top 12 m, collider pieces (cap,
cliff rows <= 45 m: triangles, AABB, row count), cap height statistics (sd, p5/p95, share below top - 2.5, and the
2 m grid itself for Dome and Rocks), the steepest cap slope in the outer 4 m, material parameters, cache key and
the patched shader source hash (and whether it has `discard` or `gl_FragDepth`), every other mesh in the stack
group, edgeR and cliffPoint hashes. The same material record for the shared `cap`, `cliff` and `stone`
materials (`sharedMaterials`, never relaxed: the tor, piles, hoods and props use them and `Textures.rock`).

Dome: cabin origin, wake spot, pad flatness (d < 14.9), 15-22 m ring slope, ladder wallR/lipY/height and the mesh
wall along it, the 23 ledge samples with their inner radius and the built wall behind each, cave mouth/plate,
elevator top, heightAt at SPAWN, highest cap in the 150°±15° and -74°±15° sightline wedges, the closest tree base
to the wall, bench points. Tower: the same ladder/ledge (25 samples)/cave set, pylon base, apron flatness, trees.
Rocks: the creek water line (bed + 0.34 at every stream sample), stream path, waterY, lip, the fall path and
widths, tor top/splash/walls/ground range, each pile's ground range and walls, the buried tor/pile shell vertices'
margin inside the built wall, sequoia treeY/plate and the ground under the whole elevator car, bridgeA (the old rope
bridge's anchor: the gatehouse stands on its heading, and the scatter and the boulders' landings keep off it), movable
rocks (the spots they are built at, dormant until rocks.exe: spot, y, edge distance; where rocks.exe throws them is
random per game and isn't recorded), frog spots, stepping stones, bench points. End: the landing (`ctx.bridgeB`, where
the stairs come down), aperture, flatness, the pedestal (its root, the middle of its cap, the button's crown and the box
over its hole), the Rocks-End wall gap (above the cloud deck and overall). The gatehouse (`gatehouse`,
`props/gatehouse.js`): its frame (sill, out, side, top, landing, n), the stairs' length and every section's end, how far
the sill stands past the Rocks rim, the corridor's open back and the step up from the cap onto its floor there, the
stairs' walking surface over End's lip (its least height above End's ground, where the last flight meets it), the
stairs' foot inside End's built wall (as the bridge posts were), and its colliders as built (the housing's triangles,
the doors' collider on, none of the stairs'). Mountain: meadow count, trail, the spur off it (its centreline, where its
edging, its tread and its last patch stop, and the patches), observatory, shed. Every scatter call (count, margin, x/z hash and
y hash separately), every forest/meadow/pebble/stone/flower placement per stack, trails, audio emitters, physics
colliders/circles/ladders, LOD registrations (the wall must never be LOD-faded). rocks.exe's pieces come in through
these general records: the tor's own meshes (intact, far, stump, stump far, debris, the flying chunks) in the Rocks
group, the bunker room's meshes in the Tower group, its 13 furniture OBBs in `physics.dynamic`, the `terminal` and
`hvac` emitters, and the LOD entries `tor`, `tor:far`, `tor:stump`, `tor:stump:far`, `tor:debris`, `bunker-room` and
`cam07`. So do the endgame's: the colliders `gatehouse`, `gatehouse:doors` and `stair:0`-`stair:13` in
`physics.colliders`, the pedestal's hole box in `physics.dynamic`, the End cap's square hole for it (`stacks.end.cap`
and its collider piece), and the LOD entries `gatehouse` (8), `gatehouse:far`, `gatehouse:lights` (2),
`gatehouse:doors`, `gatehouse:stair` (14) and `pedestal`. The light shafts are built (hidden) with no collider,
emitter or LOD entry, and the gatehouse's and the pedestal's keep-outs (no grass or pebbles under them) only skip
instances when the instanced sets are gathered, after the scatter's draws, so no placement moves. The Mountain spur
(no grass through its pebbles) hides its own once the sets are built, by a test of its tread's shape instead of a box
(`hideInstancesWhere`, as the Rocks targets' bare earth does; `world/index.js` calls the stack's `finish`).

## Routes

- **R1** Dome ladder: grab from above (on the cap, facing out, looking down) and climb down to the ledge; grab
  from below and climb out onto the cap; walk the whole ledge from the ladder foot into the cave to the plate.
- **R2** the same on the Tower.
- **R4** creek escape: every 3 m along the Rocks creek, walk out sideways both ways; at least one side must get
  3.5 m from the centreline (out of the carved bed) within 4 s.
- **R6** walk-offs at 0.5 / 1.5 / 3.4 / 6.2 m/s: every rim at 72 headings (starting 1.5 m inside the edge) and
  every 5th Dome and Tower ledge sample. Falls along the wall at 1.2 m/s, so the fall passes wall columns
  (`oblique`, `strafe`): every rim at 42 headings (every 10° from 2.5°, and every 2.5° over 340-357.5°, before the
  θ=0 seam), walking off 55° either side of straight out, or straight out and then strafing either way from 1 m past
  the rim. After leaving the edge the player must fall (no ground contact except a ledge or the gatehouse's let-down
  stairs), and the eye must stay >= 0.4 m outside the built cliff mesh through the controller's fall and 4.5 s of
  `createFall`. Each case also records the closest the eye gets while the fade to black is still under half
  (`eyeMinVisible`, and per depth band `eyeBands`), what caught a landing (`landedBy`: a ledge or the stairs, both
  designed, or a cave hood or the gatehouse) and where the first breach started. The gatehouse stands on the Rocks
  rim at 110°: a start in its corridor (`R6:rocks:rim:110deg:*`) starts on the corridor floor (the cap under it is up
  to 1.25 m lower toward the rim) and must be held by the shut doors (getting out past them fails); a start inside its
  walls has no rim to walk off and is left out (`R6:rocks:oblique|strafe:112.5deg:*`, 4 cases).
- **R7** the gatehouse and its stairs (`props/gatehouse.js`), set to each state the game puts them in with
  `setState` and put back as built afterwards (it runs last). Shut, as built (`sealed`) and after the descent with
  every section fallen (`shut-fallen`): from the cap 1.5 m behind the corridor's open back, a walk and a run through
  the corridor reach the doors and are held on its floor against them. The doors open with nothing beyond, the stairs
  not out (`gap-retracted`, at the four R6 speeds) or fallen (`gap-fallen`, walk and run): straight out of the
  doorway is an R6 walk-off into the gap (it must leave past the sill and fall clean). Let down (`descent`): from 2 m
  inside the corridor a walk and a run down the middle of every section reach End 1.5 m past the stairs' foot and
  stand on it, never off the stairs' surface on the way and without a fall (`seconds` and `dy`, the feet against the
  straight line from the sill to the landing, are compared like the ledge walks'). Let down, walking sideways off
  them either way at 1.5 and 6.2 m/s (`side:<section>`) on the first section's landing and partway down the flights
  of sections 5, 9 and 13: the side walls hold (the capsule stops 0.56 m off the centreline).

## Scratch tests

`tools/regress/out/` (git-ignored) also holds standalone headless tests that build the same world (`buildHeadless`)
and drive the real controller, physics and props, printing a PASS or FAIL line per check; `run.mjs` doesn't run
them. For rocks.exe and the Rocks boulders (from the repo root, e.g. `node tools/regress/out/rocks_exe_test.mjs`):

- **rocks_exe_test.mjs**: rocks.exe end to end with the shipped flags, the real `Player`, the terminal, the cutscene,
  the blast and the throw. First the power gate: with the Home (dome) or the Mountain line on the terminal is dark and
  silent, its power LED out, and a press only clicks (`noPower`) and flashes the reticle's low battery (the item stays
  pickable); with both off it warms up in about 0.9 s and seats you. The files lead to `/opt/survey/bin`; without the
  observatory's coordinates `./rocks.exe` (and its dry run) refuses with two lines and doesn't spend the run; with
  them, typed key by key, it says so, marks itself run at once, prints a dot every 0.35 s and starts the cutscene once,
  about 1.75 s after Enter, while the chair holds the player and a save made during the dots doesn't count it as run.
  The cutscene cuts to CAM 07 at 0.25 s with the end state written there, blows the tor at 2.2 s, zooms and shakes
  with the landings, cuts back at 8.3 s and is done by 8.9 s, leaving the player seated at the screen with the field
  of view, `viewFocus`, the feed and the glitch put back, `[cam07] link lost` on the screen, the chair held until
  rocks.exe's two closing lines (about 9.4 and 10.1 s), and all five boulders landed and live with nothing solved.
  Running it again does nothing; a save holds it all and restores it, and an old save without it restores none of it.
  Then 20 seeds
  are released at once and every landing is checked against every rule (independently of the picker), the
  cutscene's own landings too, and for 3 seeds every boulder is pushed onto a target with the real controller:
  `solved` fires once, only at the last. At the 2.5 m tolerance, 2.3 m off counts and 2.7 m doesn't.
- **rock_puzzle_test.mjs**: the boulders start dormant (hidden, colliders off); every target is clear of the rim,
  the blockers (by the push rules' own `clearOf`: circles, and the hulls of the tor, the piles and the gatehouse),
  trees, shrubs, the creek and the other targets; released where they are built (`releaseInstant`), each is pushed by
  walking into it onto a target of `ROCK_TARGETS`, the solved hook fires exactly once, no push runs a boulder through a
  tree, and the push rules refuse the rim, another boulder and the tor.
- **rock_feel_test.mjs**: released the same way, a boulder walked straight into (no steering) at offsets from its
  centre and at angles moves along the walk, not off to the side.

## Gate per stage

Record the baseline once the tree is ready (`--update-baseline`, which refuses a nondeterministic run and a tree
edited during the run, and stamps the tree hash into both files; compare prints it). The current baseline is from
tree `f982b7414753808c` (2026-10-03, flags off, 2385 route cases, 62 of them failing, all pre-existing), recorded
for the Mountain's spur: a branch of the switchback path (`world/mountainPath.js`, placed by `stacks/mountain.js`)
that leaves it at the shed door, rounds the shed and follows the foot of the mountain toward the mine for some 30 m,
then peters out. It is laid on the cap as built (no bed cut in it, no collider of its own), its verges are placed
after everything else on the last stack built, from their own streams, and the grass on its pebbles is hidden once
the instanced sets are built, so nothing is scattered again. (It was first recorded from tree `e33bd5bcd61ddf60`; the
review then moved one edging board that lay back over its neighbour's end inside the U-turn and let the tread's edge
down where one side's edging stops, which changed only the three `position` hashes below.) Every diff against the one
before (tree `90df2826e89f1dd1`) is accounted for:

- Anchors, the worn earth under it: `stacks.mountain.cap.sha.color` (144 of the cap's 23326 vertices, all within
  1.7 m of its centreline). The cap's position, index, uv and normal hashes, its collider piece, the relief grid and
  the rim slope are unchanged.
- Anchors, its meshes in the `mountain-props` batch (`stacks.mountain.group.0|1|5.verts|position`): the pebbles
  5115 → 5590 verts (the trail's tread is the first 5115, bit for bit; the spur's tread and its five patches are the
  475 after it); the timber 11016 → 12072 (of the trail's 459 ties and boards 456 are as they were and in order;
  where the spur's tread crosses the trail's edging on the doorstep two boards are left out and a third is cut back
  from 0.70 to 0.38 m, after their random draws; the spur's 46 follow); and the far stand-in that merges them
  87617 → 89148 (+475 +1056).
- Anchors, its verges: `mountain.meadow` and `placements.adds.mountain.meadow.*` 6139 → 6474 (335 tufts along it),
  `placements.adds.mountain.flower.*` 221 → 283 (62 clumps), `lod.instanced` 19 → 23 (its flowers' four sets). The
  24216 placements recorded before are the first 24216 now, each unchanged (x, y, z, scale, kind); every scatter
  call's output is identical; and every instanced set's matrices and colours are bit for bit what they were (the
  first 21977 of the grass, the others whole), rotations and tints included. No tree, shrub, pebble or stone was
  added, moved or removed.
- Not an anchor: 20 grass tufts of the Mountain's own scatter stood on its pebbles and are no longer drawn (hidden,
  above); they stay in the recorded placements, as under the gatehouse. Nothing else stood on it (the nearest
  trunk is 6.8 m from its centreline, the nearest shrub 1.8 m; the scatter's trees are also held to `crownClear` of
  the spur after their draws, which drops none today). Four of its own tufts fall in the shed's keep-out by the rain
  barrel.
- Anchors, new: `mountain.spur` (`n`, `total`, `sha`, `ends.boards|narrow|tread|earth`, `patches.n|sha`).
- Routes: identical, every trace. `physics.colliders` is the same 34, each with the same vertices and indices (the
  spur has none: you walk on the cap under it), so no walk and no fall moved.
- `--stages` against it: what failed against the one before (below) fails the same way, and nothing of the spur's.

The one before, tree `90df2826e89f1dd1` (2026-10-02), was recorded for the endgame: the rope bridge Rocks → End
replaced by the gatehouse on the Rocks rim and its stairs, the End pedestal, the storm. Its diffs against the one
before it (tree `ace5a6c40216d199`):

- Anchors, the storm (`materials.js`): the vertex- and fragment-shader hashes of every patched material
  (`stacks.*.materials.cap|cliff.vs|fs`, `sharedMaterials.cap|cliff|stone.vs|fs`). The vertex shader now declares
  `uWindAmp` (the storm's harder sway in WIND_VERT; declared for every patched material, swaying or not) and the
  fragment shader has two more blank lines where the interior masks moved out into `INTERIOR_GLSL` (shared with the
  storm's rain). Nothing else in either source changed: the previous `materials.js` and `atmosphere.js` give the old
  hashes exactly.
- Anchors, the bridge gone (`world/bridge.js` deleted): `stacks.rocks.group` loses the `bridge` wood (4216 verts)
  and rope (3960) meshes, and the `rocks-props` far stand-in, which merged them, 8176 verts (103866 → 95690); the
  `rocks` collider 36448 → 36208 triangles and its box's max z 282.1 → 234.5 (the deck reached over to End); the
  bridge's two `rocks-props` LOD entries; `end.deck` (its lips and posts) is gone and `end.landing` now reads
  `ctx.bridgeB`, the same point as the deck's end.
- Anchors, the pedestal (`endprops.glb`): `stacks.end.cap` 1656 → 1704 verts and 9504 → 9570 indices with all its
  hashes (the square `capHoles` cut it stands in), its collider piece 3168 → 3190 triangles and the `end` collider
  4776 → 4798; the box over its hole in `physics.dynamic` (inserted at 87: the rest shift by one); the `pedestal` LOD
  entry; the new `end.pedestal`.
- Anchors, the gatehouse (`gatehouse.glb`): 16 colliders after `rocks` (`gatehouse` 144 triangles, `gatehouse:doors`
  a box, `stair:0`-`stair:13` 12 triangles each: the later colliders shift by 16); 26 LOD entries (`gatehouse` 8,
  `gatehouse:far`, `gatehouse:lights` 2, `gatehouse:doors`, `gatehouse:stair` 14), so `lod.entries` 148 → 173 (-2 +1
  +26), and `lod.names` is the old list with exactly those changes; the new `gatehouse` record. No placement, scatter,
  emitter, ladder or other stack's mesh moved (the keep-outs act on the instanced sets, after the draws), and the
  boulders' new blocker round the gatehouse isn't an anchor.
- Routes: the 16 `R6:bridge:*` cases are gone, the 4 `R6:rocks:oblique|strafe:112.5deg:*` are left out (they start
  inside the gatehouse's walls) and the 28 R7 cases are new: 2377 → 2385. `R6:rocks:rim:110deg:*` were caught by the
  bridge deck and are now held by the shut doors; `R6:end:rim:290deg:*`, `R6:end:oblique:292.5deg:-55` and
  `R6:end:strafe:292.5deg:*` were caught by the bridge deck and now fall clean. Traces changed in 339 cases, all on
  the two stacks whose colliders changed (Rocks rim 117, oblique 40, strafe 30, and `R4:t9`; End rim 86, oblique 33,
  strafe 32): Dome, Tower, Mountain, R1 and R2 are identical. Of those, six are triangle-order flips (see below):
  `R6:rocks:rim:310deg:0.5` now lands 2.2 m under the rim (where the pre-existing
  `R6:rocks:oblique:312.5deg:-55` lands) and `R6:end:strafe:322.5deg:left|right` 1.3 m under it, while
  `R6:end:rim:315deg:6.2` and `R6:end:oblique:92.5deg:55|292.5deg:55` now pass. The rest keep their outcomes (the
  pre-existing slow-walk breaches start up to 0.6 m higher or lower, two of End's shelf landings 0.1 m higher).
- `--stages` against it: R7 and every gatehouse and pedestal value pass in all 14 variants. What fails is the stages'
  own: the `shader` variants give the cliff caves' mouths the wall's material (`stacks.dome|tower.group.0.material`
  `cliff` → `wall:*`), the `calmSmooth` variants miss their positive spread and seam gates, under `geo` six walk-offs
  that pass in this baseline and the one before land on the wall (`R6:end:rim:100deg|105deg:0.5`,
  `R6:tower:rim:265deg:0.5`, `R6:mountain:oblique:22.5deg:55`, `R6:mountain:strafe:262.5deg:*`) as does
  `R6:end:rim:315deg:6.2` (one of the flips above), and under `relief` `R6:dome:rim:15deg:0.5` (the flip described
  below).

The one before that, tree `ace5a6c40216d199` (2026-10-02, the mine and the Rocks carvings; recorded without a note here)
changed `stacks.mountain.group` (the `mountain-props` stone, cap, cliff and far meshes), the `mountain` collider
(+12 triangles) and the `mine` collider (4200 → 4248 triangles, its box), and `lod.entries` 146 → 148 (the two arrow
carvings, `petroglyph:arrow:1|2`); in the routes, 97 Mountain traces, `R6:mountain:rim:65deg:0.5` now breaching and
`R6:mountain:strafe:262.5deg:*` and `R6:mountain:oblique:347.5deg:-55` now falling clean (64 → 62 failing). The one
before it, tree `6cf3cc29401f24c2` (2026-10-01, rocks.exe), changed the anchors only: the fragment-shader hashes of
every patched material (`bunkerDeep` in `materials.js`); `stacks.tower.group` (the bunker room's meshes; `tower-props`
without the room's bare shell, and the lower stair's colours); `stacks.rocks.group` (the tor's own meshes, intact,
far, stump, stump far, debris and the flying chunks, out of `rocks-props` and its far stand-in); the `bunker-car`
collider's AABB (the wider, deeper room puts the plate 0.55 m further back) and the study elevator's top door in
`physics.dynamic`; the room's 13 furniture OBBs; the `terminal` and `hvac` emitters; and `lod.entries` 139 → 146.

A flag whose stage has not landed yet fails its
own positive gates (seam normals, `db:n|wall`, added spread, added relief) while every value stays exact, so
`--stages` passes only once every stage is in; judge a stage by its own variants. Then every stage must pass
`node tools/regress/run.mjs` (flags off: byte-identical to the baseline) and `--compare --variant 0,+<its flags>`,
and `--stages` before it ships. The lead's frames and bench cover the look.

| stage | flag | may change (else exact) | harness gates |
|---|---|---|---|
| S0 | none | nothing | two runs identical; `?walls=0` identical to the baseline |
| S1a | `uv` | cliff uv | |
| S1 | `bake` | cap/cliff colours and normals | θ=0 column normals < 1° apart on every stack |
| S2 | `shader` | the wall material and its shader (not the shared materials) | `uv` on (config.js turns it on); wall key `db:n\|wall`, not the `cliff` material; wall not transparent, no alphaTest, no discard, no gl_FragDepth, not LOD-faded |
| S3 | `geo`, `calmSmooth` | cliff positions/normals below the rim, wall statistics, collider AABB (±3 m), wall margins | top-12 m wall ny <= 0.55 (orBase), row gap >= 0.3 m, flare <= baseline + 3 m, θ=0 seam window max step <= 1.25 × the rest of the row from 1.4 m down (orBase), radius spread at 4.6 m >= baseline - 0.02, added at 10 m >= 0.15 m and at 19 m >= 0.5 m on every stack, Rocks-End gap above the deck >= baseline - 1 m, buried tor/pile shells, trees and the stairs' foot on End >= 0.3 m inside/outside the wall; R1, R2, R6, R7 |
| S4 | `relief` | Dome/Rocks cap heights, y of their placements, trail drape, bench heights; y ±0.02 of bridgeA, the gatehouse's sill and top, the stairs' section ends and the step onto its floor, the stairs over End's lip ±0.05 | pad flatness <= baseline + 0.5 mm, 15-22 m ring slope <= 0.35, sightline wedges <= top + 1.5, car floor clears the ground by 0.02 m, added relief RMS >= 0.4 m on both caps; R1, R4, R7 |
| S5 | `shoulder` | rim and wall near it | rim slope <= 37°, top-12 m ny <= 0.55 (orBase), row gap >= 0.3 m; R6, R7 |

Ledges, ladders, caves, row 0, the fall path, scatter x/z, the gatehouse's frame in plan (x/z) and the End landing
stay exact in every stage. Tighten the table (`tolerances.mjs`) as each stage lands; never loosen a rule just to make a run pass.

## Pre-existing failures (tree of 2026-09-26, before any stage)

These fail today with every flag off. They are reported, not hidden: the stage gates that restate them will fail
until a stage fixes them or the lead rules on them. With the current baseline 62 of the 2385 route cases fail, all of
the kinds below: the eye within 0.4 m of the wall during the controller's own slide (rim: Dome 7, Rocks 7, Mountain 6,
End 2, Tower 1; oblique: Dome 3, Rocks 6) and walk-offs landing on the wall under the rim (rim: End 15, Mountain 2,
Rocks 1; oblique: End 5, Tower 2, Rocks 1; strafe: End 4). No R7 case fails.

- θ=0 seam: column 0 and column segs normals are 72-96° apart on every stack (the S1 gate wants < 1°).
- Top-12 m wall: End 0.70 and Mountain 0.59 exceed the S3 gate of 0.55 (Dome 0.53, Rocks 0.53, Tower 0.50). On
  End the wall has walkable shelves: R6 walk-offs at 305-325° land and stand on the wall itself, 0.4 m outside
  the rim and 1.2-1.3 m under it (Mountain at 25° and 90°, 0.5 m/s, 1.9 and 1.6 m under it; Rocks at 310°,
  0.5 m/s, 2.2 m under it, a triangle-order flip: see below).
- R6: in 23 of the 360 rim walk-offs at 0.5 m/s (Dome 7, Rocks 7, Mountain 6, End 2, Tower 1) and 9 oblique ones
  (Dome 3, Rocks 6) the eye comes within 0.4 m of the wall before the fall sequence starts: the capsule slides down the
  wall under the controller's own collision, and its radius (0.32 m) is less than the 0.4 m margin (worst 0.355
  m; it never goes inside). Once `createFall` runs, its drift keeps the capsule about a metre off the built wall
  (`Stack.wallRadius`, sampled where the walk carries the capsule and a capsule's width to either side), so no
  R6 case breaches during the fall. The first baseline had the eye inside the flaring wall in 702 more
  walk-offs (mostly 0.5-1.5 m/s, down to 18 m inside, beside the bridge too). The second (tree
  `dc27e270d6ccd2a8`) still let a fall along the wall into the θ=0 seam, which steps 12-17 m out in one column
  70-200 m down on End and Mountain (eye up to 2 m inside, screen visible; the along-wall cases catch it). Each
  `--update-baseline` after a drift fix changed only fall traces and outcomes.
- R6: no walk-off lands on a cave hood any more (walking off the Dome rim at 215° and the Tower rim at 100-105°
  once did, with 2 oblique and 4 strafe cases there); 12 oblique and strafe walk-offs land on the wall 1.2-2.2 m
  under the rim (End 9, Tower 2, Rocks 1), like the radial ones above.
- R6 triangle-order flips: a slow walk-off that grazes the top of the wall can pass or land by the order the
  collider BVH visits its triangles (the capsule is pushed out one triangle at a time), so a geometry flag that
  moves vertices anywhere in a stack's collider can flip it with the walk's own ground and wall unchanged.
  `R6:dome:rim:15deg:0.5` is one: with `relief` it lands 2.0 m under the rim, where the relief is exactly 0 and the
  wall is today's. Rebuilding the Dome collider's BVH from 5 shuffled triangle orders, it lands at the same 2.0 m
  with every flag off in 1 of them, and passes with `relief` in all 5 (it lands only in the as-built order); order
  alone moves the Dome's R6 failures between 19 and 21. The endgame's rebuilt Rocks and End colliders flipped six
  (see the current baseline above): rebuilt from 5 shuffled triangle orders each, `R6:rocks:rim:310deg:0.5` lands in
  2 of them, `R6:end:strafe:322.5deg:left|right` in 4, `R6:end:rim:315deg:6.2` in 2, `R6:end:oblique:92.5deg:55` in
  3 and `R6:end:oblique:292.5deg:55` in 2, with the walls and caps there unchanged.
- Not covered by R6 (known gaps): the controller's 9 m fall trigger used to fire while the player was still over a
  steep Mountain cap face (feet 0.1-0.9 m above the ground), and `createFall` leaves out the stack it starts over,
  so such a fall dropped through the cap. The Mountain's slope limit (README "Walking and slopes") closed it for
  faces up to 50°: a slide down them counts as on the ground. Steeper cap faces used to be cliffs that still fell: a
  run from the observatory off one arm of the switchbacks onto the next (an 8 m bank of 44-72° faces at the hairpin
  21-23 m from the summit, 40° right of the door), or off the plateau at Walk speed above 1x, reached the 9 m and
  sank through the hill (71 of 11,872 swept runs at 1x, 8,141 at 2x). Closed 3 October: the trigger re-measures its
  drop wherever a slope-limited collider lies under the feet (`Physics.hillsideBelow`), and a fast fall takes more
  substeps (`STEP_REACH` in the controller), so a 30 m/s landing can't carry the capsule's axis through a face. The
  routes are identical at the harness's 1/60 (all 2,385 traces); nothing was re-baselined. The eye is measured against the cliff meshes only: falls off the Dome rim
  over its cave hood pass through the `dome-props` mesh early in the fall, with or without the drift (measured at
  85-125° when the hood was on the north side; since the ledge was shortened it is at about 215°).
- Dome pad flatness is 0.011 m on the built mesh (triangles straddle d = 15 m), just over the plan's 0.01.
- (The rope bridge's deck passed 0.41 m under the Rocks cap at its lip; it is gone. The stairs' walking surface
  stands 0.025 m over End's ground at its lowest, just past their foot: `gatehouse.endLip`.)
- The Rocks and End walls meet (gap 0.05 m) at about y -467, under the cloud deck; above the deck the gap is 19 m.
