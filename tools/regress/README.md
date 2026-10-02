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

Timings on the dev machine: world build 3 s, anchors 3.5-4 s per variant, routes 21-32 s (2377 cases), the default
check (determinism, two anchors and two routes processes in parallel, then `?walls=0` vs the baseline) about 56 s,
`--compare` about 25 s, `--update-baseline` about 32 s, `--stages` (14 variants, 8 at a time) about 95 s.

## How it works

- **world.mjs** calls the real `buildWorld` (`src/world/index.js`), so all five stacks are built by their real
  `stacks/*.js` functions in game order with the game's Rng streams. The GLB scenes are parsed from
  `public/models` (they carry no images); textures are blank and a canvas stub stands in for the DOM. The optional
  models load as they do in the game, when present: the Rocks tor's resculpt with its blast (`tor.glb`,
  `tor_blast.glb`) and the Tower bunker's room (`bunker.glb`), so the headless world has the tor's own meshes, the
  boulders' meshes, the room, its terminal and its furniture boxes. `buildHeadless({ torSculpt: false })` builds the
  procedural tor instead (`tools/blender/export_tor.mjs` uses it).
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
  differently or earlier: an R6 outcome may not get worse (fell or designed catch < eye breach < landing,
  stall or no fall), a landing may not move to another catcher or more than 0.5 m deeper, the first eye breach
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
margin inside the built wall, sequoia treeY/plate and the ground under the whole elevator car, bridgeA, movable
rocks (the spots they are built at, dormant until rocks.exe: spot, y, edge distance; where rocks.exe throws them is
random per game and isn't recorded), frog spots, stepping stones, bench points. End: landing, aperture, flatness,
the deck underside over both lips, the bridge posts' margin to the wall, the Rocks-End wall gap (above the cloud
deck and overall). Mountain: meadow count, trail, observatory, shed. Every scatter call (count, margin, x/z hash and
y hash separately), every forest/meadow/pebble/stone/flower placement per stack, trails, audio emitters, physics
colliders/circles/ladders, LOD registrations (the wall must never be LOD-faded). rocks.exe's pieces come in through
these general records: the tor's own meshes (intact, far, stump, stump far, debris, the flying chunks) in the Rocks
group, the bunker room's meshes in the Tower group, its 13 furniture OBBs in `physics.dynamic`, the `terminal` and
`hvac` emitters, and the LOD entries `tor`, `tor:far`, `tor:stump`, `tor:stump:far`, `tor:debris`, `bunker-room` and
`cam07`.

## Routes

- **R1** Dome ladder: grab from above (on the cap, facing out, looking down) and climb down to the ledge; grab
  from below and climb out onto the cap; walk the whole ledge from the ladder foot into the cave to the plate.
- **R2** the same on the Tower.
- **R4** creek escape: every 3 m along the Rocks creek, walk out sideways both ways; at least one side must get
  3.5 m from the centreline (out of the carved bed) within 4 s.
- **R6** walk-offs at 0.5 / 1.5 / 3.4 / 6.2 m/s: every rim at 72 headings (starting 1.5 m inside the edge), every
  5th Dome and Tower ledge sample, and beside both ends of the bridge deck. Falls along the wall at 1.2 m/s, so
  the fall passes wall columns (`oblique`, `strafe`): every rim at 42 headings (every 10° from 2.5°, and every
  2.5° over 340-357.5°, before the θ=0 seam), walking off 55° either side of straight out, or straight out and
  then strafing either way from 1 m past the rim. After leaving the edge the player must
  fall (no ground contact except a ledge or the bridge deck), and the eye must stay >= 0.4 m outside the built
  cliff mesh through the controller's fall and 4.5 s of `createFall`. Each case also records the closest the eye
  gets while the fade to black is still under half (`eyeMinVisible`, and per depth band `eyeBands`), what caught
  a landing (`landedBy`) and where the first breach started.

## Scratch tests

`tools/regress/out/` (git-ignored) also holds standalone headless tests that build the same world (`buildHeadless`)
and drive the real controller, physics and props, printing a PASS or FAIL line per check; `run.mjs` doesn't run
them. For rocks.exe and the Rocks boulders (from the repo root, e.g. `node tools/regress/out/rocks_exe_test.mjs`):

- **rocks_exe_test.mjs**: rocks.exe end to end with the shipped flags, the real `Player`, the terminal, the cutscene,
  the blast and the throw. The files lead to `/opt/survey/bin`; typed key by key, `./rocks.exe` marks itself run at
  once, prints a dot every 0.35 s and starts the cutscene once, about 1.75 s after Enter, while the chair holds the
  player and a save made during the dots doesn't count it as run. The cutscene cuts to CAM 07 at 0.25 s with the end
  state written there, blows the tor at 2.2 s, zooms and shakes with the landings, cuts back at 8.3 s and is done by
  8.9 s, leaving the player seated at the screen with the field of view, `viewFocus`, the feed and the glitch put
  back, `[cam07] link lost` on the screen, and all five boulders landed and live with nothing solved. Running it again
  does nothing; a save holds it all and restores it, and an old save without it restores none of it. Then 20 seeds
  are released at once and every landing is checked against every rule (independently of the picker), the
  cutscene's own landings too, and for 3 seeds every boulder is pushed onto a target with the real controller:
  `solved` fires once, only at the last. At the 2.5 m tolerance, 2.3 m off counts and 2.7 m doesn't.
- **rock_puzzle_test.mjs**: the boulders start dormant (hidden, colliders off); released where they are built
  (`releaseInstant`), each is pushed by walking into it onto a target of `ROCK_TARGETS`, the solved hook fires exactly
  once, no push runs a boulder through a tree, and the push rules refuse the rim, another boulder and the tor.
- **rock_feel_test.mjs**: released the same way, a boulder walked straight into (no steering) at offsets from its
  centre and at angles moves along the walk, not off to the side.

## Gate per stage

Record the baseline once the tree is ready (`--update-baseline`, which refuses a nondeterministic run and a tree
edited during the run, and stamps the tree hash into both files; compare prints it). The current baseline is from
tree `6cf3cc29401f24c2` (2026-10-01, flags off, 2377 route cases, 64 of them failing, all pre-existing), recorded
for rocks.exe. It changed the anchors only, every diff accounted for: the fragment-shader hashes of every patched
material (`bunkerDeep` in `materials.js`: `stacks.*.materials.*.fs` and `sharedMaterials.cap|cliff|stone.fs`);
`stacks.tower.group` (the bunker room's meshes; `tower-props` without the room's bare shell, and the lower stair's
colours); `stacks.rocks.group` (the tor's own meshes, intact, far, stump, stump far, debris and the flying chunks,
out of `rocks-props` and its far stand-in); `physics.colliders.10` (the `bunker-car` collider's AABB: the wider,
deeper room puts the plate 0.55 m further back) and `physics.dynamic.89` (the study elevator's top door); the
room's 13 furniture OBBs, appended from `physics.dynamic.113` on; the `terminal` and `hvac` emitters; and
`lod.entries` 139 → 146 with `lod.names`. The routes are identical. A flag whose stage has not landed yet fails its
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
| S3 | `geo`, `calmSmooth` | cliff positions/normals below the rim, wall statistics, collider AABB (±3 m), wall margins | top-12 m wall ny <= 0.55 (orBase), row gap >= 0.3 m, flare <= baseline + 3 m, θ=0 seam window max step <= 1.25 × the rest of the row from 1.4 m down (orBase), radius spread at 4.6 m >= baseline - 0.02, added at 10 m >= 0.15 m and at 19 m >= 0.5 m on every stack, Rocks-End gap above the deck >= baseline - 1 m, buried tor/pile shells, trees and bridge posts >= 0.3 m inside/outside the wall; R1, R2, R6 |
| S4 | `relief` | Dome/Rocks cap heights, y of their placements, trail drape, bench heights; bridgeA y ±0.02 | pad flatness <= baseline + 0.5 mm, 15-22 m ring slope <= 0.35, sightline wedges <= top + 1.5, car floor clears the ground by 0.02 m, added relief RMS >= 0.4 m on both caps; R1, R4 |
| S5 | `shoulder` | rim and wall near it | rim slope <= 37°, top-12 m ny <= 0.55 (orBase), row gap >= 0.3 m; R6 |

Ledges, ladders, caves, row 0, the fall path, scatter x/z, the bridge and the End landing stay exact in every
stage. Tighten the table (`tolerances.mjs`) as each stage lands; never loosen a rule just to make a run pass.

## Pre-existing failures (tree of 2026-09-26, before any stage)

These fail today with every flag off. They are reported, not hidden: the stage gates that restate them will fail
until a stage fixes them or the lead rules on them.

- θ=0 seam: column 0 and column segs normals are 72-96° apart on every stack (the S1 gate wants < 1°).
- Top-12 m wall: End 0.70 and Mountain 0.59 exceed the S3 gate of 0.55 (Dome 0.53, Rocks 0.53, Tower 0.50). On
  End the wall has walkable shelves: R6 walk-offs at 305-325° land and stand on the wall itself, 0.4 m outside
  the rim and 1.3 m under it (Mountain once, at 25° and 0.5 m/s, 1.9 m under it).
- R6: in 21 of the 360 rim walk-offs at 0.5 m/s (Dome 7, Rocks 7, Mountain 5, End 2) and 9 oblique ones (Dome
  3, Rocks 6) the eye comes within 0.4 m of the wall before the fall sequence starts: the capsule slides down the
  wall under the controller's own collision, and its radius (0.32 m) is less than the 0.4 m margin (worst 0.355
  m; it never goes inside). Once `createFall` runs, its drift keeps the capsule about a metre off the built wall
  (`Stack.wallRadius`, sampled where the walk carries the capsule and a capsule's width to either side), so no
  R6 case breaches during the fall. The first baseline had the eye inside the flaring wall in 702 more
  walk-offs (mostly 0.5-1.5 m/s, down to 18 m inside, beside the bridge too). The second (tree
  `dc27e270d6ccd2a8`) still let a fall along the wall into the θ=0 seam, which steps 12-17 m out in one column
  70-200 m down on End and Mountain (eye up to 2 m inside, screen visible; the along-wall cases catch it). Each
  `--update-baseline` after a drift fix changed only fall traces and outcomes.
- R6: walking off the Dome rim at 215° and the Tower rim at 100-105° lands on the cave hoods (also 2
  oblique and 4 strafe cases there); 13 oblique and strafe walk-offs land on the wall 1.2-2.2 m under the rim
  (End 9, Tower 2, Rocks 1, Mountain 1), like the radial ones above.
- R6 triangle-order flips: a slow walk-off that grazes the top of the wall can pass or land by the order the
  collider BVH visits its triangles (the capsule is pushed out one triangle at a time), so a geometry flag that
  moves vertices anywhere in a stack's collider can flip it with the walk's own ground and wall unchanged.
  `R6:dome:rim:15deg:0.5` is one: with `relief` it lands 2.0 m under the rim, where the relief is exactly 0 and the
  wall is today's. Rebuilding the Dome collider's BVH from 5 shuffled triangle orders, it lands at the same 2.0 m
  with every flag off in 1 of them, and passes with `relief` in all 5 (it lands only in the as-built order); order
  alone moves the Dome's R6 failures between 19 and 21.
- Not covered by R6 (known gaps): the controller's 9 m fall trigger used to fire while the player was still over a
  steep Mountain cap face (feet 0.1-0.9 m above the ground), and `createFall` leaves out the stack it starts over,
  so such a fall dropped through the cap. The Mountain's slope limit (README "Walking and slopes") closed it for
  faces up to 50°: a slide down them counts as on the ground. Steeper cap faces are cliffs and still fall. The eye is measured against the cliff meshes only: falls off the Dome rim
  over its cave hood pass through the `dome-props` mesh early in the fall, with or without the drift (measured at
  85-125° when the hood was on the north side; since the ledge was shortened it is at about 215°).
- Dome pad flatness is 0.011 m on the built mesh (triangles straddle d = 15 m), just over the plan's 0.01.
- The bridge deck passes 0.41 m under the Rocks cap where it crosses the lip (planks in the ground); over the End
  lip it clears by 0.17 m (deck underside; the deck line clears by about 0.3 m).
- The Rocks and End walls meet (gap 0.05 m) at about y -467, under the cloud deck; above the deck the gap is 19 m.
