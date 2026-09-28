# Dreambound

An ambient first-person dream set on five sea stacks above the clouds. No HUD, no text.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. A faint line fills the black screen while the world loads and warms up; when it gives way to the breathing light, click to begin (a click made earlier is kept, and the game starts as soon as it is ready). `npm run build` produces a static bundle in `dist/`.

## Controls

- **Mouse**: look around. A faint dot marks the centre of your view; it grows and brightens over anything you can press (the same test Space / E / click use). It hides during the wake-up fade, cutscenes, the telescope eyepiece (which has its own reticle) and the settings panel. The OS cursor shows whenever the game doesn't hold the mouse (settings open, or after closing them with Escape until you click back in).
- **W A S D**: walk (hold **Shift** to walk faster)
- **Space / E / left click**: use whatever is in the center of your view
- **Ladders**: walk into one and press **W**. To climb down from the top, look down over the edge and press **W**.
- **Observatory**: hold Space (or the mouse button) on a handwheel and move the mouse to turn it. The left wheel turns the dome, and the right wheel raises the telescope. Press the periscope eyepiece to look through the telescope. While you look, the mouse does nothing; only the handwheels aim it. Move or press again to step away.
- **Escape**: opens settings (walk speed, gamma, brightness, fog density / low haze / tint, time of day, pause the day/night cycle, shadow/midtone/highlight color grading with blend and balance, and under Interface: **Pointer** (the centre dot, on by default) and **Debug reports** (off by default, see below)). Press Escape again to close it, then click to recapture the mouse, or press Resume. Settings are saved in the browser.
- **F8 / middle click**: with **Debug reports** on, copies a debug report to the clipboard (see Debug reports).

## Dev URL parameters

| Param | Effect |
| --- | --- |
| `?dev` | Logs draw calls, triangles, and frame time every 2 s, and exposes `ctx`, `player`, `clock`, `lookAtPt()`, `pressAt()`, `bench()`, the hitch monitor's `hitchReport()` and `hitchTour()`, and `preloadStats` on `window` (see Performance notes) |
| `?skip` | Skips the wake-up intro (you start standing beside the bed) |
| `?t=0.3` | Starting time of day (0–1 across the 13-minute cycle; 0 = sunrise, about 0.54 = sunset) |
| `?speed=10` | Speeds up the day/night clock |
| `?spawn=rocks` | Starts on a named stack: `dome`, `rocks`, `mountain`, `tower`, `end`, `hub` (the cave hub, facing the generator) or `lounge` (the lounge under the Tower, facing the desk) |
| `?walls=0` | Turns off the stack wall/edge rework (weathered colours, wall material, wall relief, rolling tops) to compare with the original terrain. `?walls=-shader,+bake` toggles single stages (`uv`, `bake`, `shader`, `geo`, `calmSmooth`, `relief`); see `src/config.js` `WALLS` |

## Debug reports

For reporting a bug or a change: turn on **Debug reports** in the Escape panel (it is saved, and works in normal builds, not just `?dev`). Then, while playing, aim the centre dot at the thing in question and press **F8** or **middle-click** (middle click only while the game holds the mouse; an unlocked click just recaptures it). A pretty-printed JSON report goes to the clipboard and a brief "Copied report · <what was hit> @ <distance>" note shows at the bottom of the screen. Paste it into the chat. If the clipboard is refused, the report is logged to the console instead ("Report logged to console"). The last report is always on `window.__lastReport`. Nothing else changes: the toggle only enables the key and the button, which nothing else uses.

The report (`src/ui/debugReport.js`) holds:

- `time`, `url`, `query`, `build` (package version, build/dev-server start time, Vite mode, three.js revision), `userAgent`.
- `clock`: `phase`, `altDeg`, `night`, `speed`. `game`: started/ended, whether a sequence is running, `elapsed`, `dpr`, `underground`.
- `player`: `feet` and `eye` positions, `yaw` / `pitch` in radians and degrees, `zone`, `mode`, `onGround`, `canMove`, riding / indoor, and where: on the surface the nearest `stack` (name, stack-local `x, y, z` from its centre and top height, `edgeDist` to the rim, positive inside, and the ground height), underground the `tunnel`-local position (from `TUNNEL_ORIGIN`) and whether you're in the lounge.
- `camera`: position, view direction, `fov`, near/far, aspect.
- `hit`: the first visible mesh along the centre ray (CPU geometry: GPU-displaced parts such as the observatory's moving pieces are hit at their rest pose; the sky and the cloud sea are skipped), with point, distance, world normal, object name, ancestor `path`, `owner` (the prop or stack group), material, LOD `layer`, instance id and the same stack/tunnel location as the player. `null` if nothing. `collisionHit`: the first collider along the same ray (the player's zone only; doors, boulders and other dynamic shapes are not in it).
- `interactable`: whether a press would do something now, the item under the dot (its `name`, e.g. `elevator:rocks:top:call`, `cabin:FrontDoor`, `generator-switch:2`, `tower-switches:1`, `observatory:eyepiece`), and anything held.
- `state` (all of `ctx.state`: switches, observatory yaw/pitch/hatch/stationOpen, rocks positions/pushes/solved, towerSwitches, ...), `power`, `elevators` (`id`, `at`, `busy`), `observatory.ladderAligned`, `walls` (the `WALLS` flags), `settings`, `fx` (fade, scope, gamma, brightness).
- `renderer`: fps and frame time (smoothed), draw calls and triangles for the whole last frame, geometries, textures, pixel ratio, drawing-buffer and window sizes, and how long the report's raycast took.

Numbers are rounded to 3 decimals and long arrays are cut to their last 64 entries.

## Layout

```
src/
  main.js            renderer, loop, zones, sequences glue
  config.js          stack positions/heights, cycle lengths, player tuning
  core/              input, day clock, interaction ray, seeded noise
  ui/                Escape settings panel, centre dot (reticle), debug reports
  render/            sky, clouds, atmosphere palette, lighting, post FX, materials, procedural textures, LOD, the preloader, fire
  world/             terrain generator, stacks/*, tunnels, trees/grass, flowers, rock piles, water + spray FX, bridge, builders (batching + colliders)
  props/             cabin, observatory, cave, lounge and elevator loaders, sequoia, power tower (and its catwalk kit), aperture door, alarm clock, movable rocks
  player/            capsule controller + BVH collision
  sequences/         intro (waking), fall (dream respawn), ending
  audio/engine.js    all sound, synthesized with Web Audio
  dev/               ?dev tools: bench() and hitchTour() (bench.js), the hitch monitor (hitch.js)
public/models/       cabin, observatory, cave, lounge, elevator and tower-kit GLBs + baked atlases/textures, built by tools/blender
tools/blender/       dbkit.py (toolkit), build_*.py (runners), *_design.py (the models)
tools/regress/       headless regression harness: `node tools/regress/run.mjs` rebuilds the world in Node and checks every feature anchor and walk route against the baseline (see its README)
```

Everything is procedural: geometry, textures (drawn to canvas), and audio. The exceptions are the cabin with its geodesic dome, the Mountain observatory, the underground cave with its generator, the lounge under the Tower, the elevator (car, landing doors and frame, shared by every elevator end), and the power tower's catwalk kit (switch boxes, capacitors and solar panels). They are modeled by script in Blender and loaded as GLBs.

## Blender models

`tools/blender/dbkit.py` is the shared toolkit. Each asset has two files:

- A design file: `cabin_design.py`, `observatory_design.py`, `cave_design.py`, `lounge_design.py`, `elevator_design.py` or `tower_kit_design.py`, written in game coordinates (+Y up).
- A runner: `build_cabin.py`, `build_observatory.py`, `build_cave.py`, `build_lounge.py`, `build_elevator.py` or `build_tower_kit.py`.

A build does three things:

1. It builds the model as one mesh per material, with colors in vertex attributes. Movable parts (doors, the dome, the telescope, gears) become empties at their pivots. Geometry emitted inside `with layer('in'):` (interiors) or `with layer('near'):` (small exterior details) becomes separate meshes tagged with a `layer` extra, so the game can cull them by distance (see Performance).
2. It bakes a shared ambient-occlusion atlas (Cycles, second UV set). The cave, the lounge and the elevator instead bake their own textures and lightmaps (see below).
3. It exports `public/models/<asset>.glb` and `<asset>_ao.png`, and saves `tools/blender/<asset>.blend`.

Rebuild after editing a design (Blender 5.2, about 20 s for the cabin, 60 s for the observatory, 90 s for the lounge, 3 min for the cave, 3.5 min for the tower kit and 4 min for the elevator):

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_cabin.py
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_observatory.py
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_cave.py
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_lounge.py
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_elevator.py
```

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_tower_kit.py
```

To see a design in a running Blender (through the MCP bridge), run `STAGE = 'build'` and then exec the runner.

### The cabin

Named empties in the GLB carry gameplay data, and `src/props/cabin.js` reads them:

- `FrontDoor` and `DomeDoor`: door hinges.
- `LIGHT_*`: interior lamps (steady; the firelight is the fires' own).
- `WAKE_bed` and `WAKE_stand`: where the intro starts and ends.
- `FIRE_hearth` and `FIRE_pit`: where the fires burn (see Fire, below) and their crackle plays.
- `META`: interior bounds for sky-light occlusion and indoor audio.

The invisible `COLLIDER` mesh becomes collision. Surface textures (oak planks, walnut grain, ledgestone, zellige, hex tile, marble, linen, jute) are still procedural canvas textures. A small cube-map probe in the great room refreshes one face per frame while you are near the cabin, so mirrors, tile, and the floor reflect the room.

Two oil paintings in mitred walnut frames with a pale slip hang in the great room (`PAINTINGS` and `hangPaintings` in `src/props/cabin.js`). Both are drawn procedurally in `src/render/painting.js` by one shared brush (`brush`, `sign`, `finish`): loaded strokes with wavering sides, bristle streaks and dry tails, paint height for the normal map, canvas weave where the paint is thin, a warm varnish and darkened edges, and the same scrawled signature, so they read as one painter's work. The brush unit is 0.8 m on both canvases, so a stroke of a given size is the same brush.

- **The abstract** (0.8 × 0.8 m, 1024² texture) is on the partition wall, between the bedroom door and the pantry: brushy greens with a horizon band and a couple of decoy shapes, and three painted discs at middle-left, middle-bottom and top-right, the same positions as the dots on the card in the lounge.
- **The landscape** (1.28 × 0.8 m canvas in a 1.37 × 0.89 m frame, 1536 × 960 texture, `paintLandscape`) hangs over the hearth, centred on the chimney breast and the mantel, clear of the mantel and the truss tie beam above. Three mountain ridges recede into haze (each paler and bluer than the one in front, misty at its foot, lit on its left-facing slopes), with valley mist, a band of dark blue-green spruce, an earthy meadow and a soft warm sky. It is muted to suit the room, with no bright greens and nothing hidden in it.

Each painting is two draw calls (canvas and frame; the frames share a material), casts no shadow and fades out with the rooms. The textures are generated once, when the cabin is placed.

#### Fire

The great room's fireplace and the garden's fire pit burn with real-time volumetric fire (`src/render/fire.js`, placed by `FIRES` in `src/props/cabin.js`). It is Alfred Fuller's procedural fire, as ported to three.js by mattatz (THREE.Fire) and yomotsu (VolumetricFire), pushed towards the look of Three.js Fire Pro where the budget allows:

- **Flame.** A box around the fire is raymarched in its fragment shader: 20 samples along the ray's chord through the box. Each sample becomes flame coordinates (distance from the axis in the box's plan, height), and its height is pushed up or down by Fuller's turbulence (|value noise| over four octaves, lacunarity 2, gain 0.5, scrolling upward), centred on its mean so the flame fills the box on average and licks past it. A slow swirl bends the flame sideways towards the tips, a 2D noise gives the plan separate tongues of different heights, and the turbulence's creases open as dark gaps between filaments. The colour is a function of temperature (hot low on the axis, cooling to the edges and tips): white-yellow core, orange, deep red tips. The foot of the flame is thinner and cooler up to the logs' height, so the logs read through it, and a thin ember layer breathes on the fire's floor. Gas pushed past the tips turns into a faint brown smoke that dims what is behind it (premultiplied blending: the flame adds light, the smoke takes a little away). Samples outside the flame's widest possible cone skip the noise.
- **Sparks.** 14 (hearth) and 28 (pit) GPU points, animated in closed form from `atmo.uTime`: each is born over the embers, rises and slows, flutters, cools from yellow to red and re-randomises every cycle; a share are skipped each cycle so they come and go. A 1.5 cm glow, never less than 1.5 px (dimmed instead).
- **Light.** One warm `PointLight` per fire (no shadows): the hearth's 0.45 m in front of the opening (so the back of the chimney never sees it), the pit's 0.65 m above the logs. Both exist from the start, at the scene root, so every lit shader is compiled with them; they flicker by intensity only (a few incommensurate sines), are divided by the night exposure like the lamps, and go to 0 once their fire is distance-culled or underground. The ember meshes glow with the hearth's flicker.
- **Look.** Bounded HDR (clamped at 6) so the bloom (threshold 1.35) picks up the core without blowing out, and no NaN or Inf reaches the bloom or the room probe; the flame (not the sparks) is on the probe layer, so mirrors and tile reflect it. Fog comes from the scene's fog function (its transmittance at the fire), and each fire fades out before the LOD hides it.
- **Cost.** Two draw calls per fire (flame and sparks), both shader materials with no light dependence, compiled by the preloader. The hearth is drawn with the rooms (55–75 m), the pit out to 60–80 m. At 1920×1080 on the reference machine: about +0.3 ms per frame averaged over every heading in the great room and the garden (mostly the two lights, which every lit pixel pays), +0.5 ms looking at the pit from a chair, +1.4 ms with it filling the screen from 1.3 m.
- **Sound.** The `fire` (hearth, on the indoor bus with the room's reverb send) and `firepit` (outdoor bus, muffled from inside the house) emitters at `FIRE_hearth` and `FIRE_pit`.

What Fire Pro does that this doesn't: a real fluid simulation (flames that flow around obstacles, respond to forces and interaction), fire emitted from arbitrary meshes, self-shadowing and scattering in thick smoke, and depth integration. Those need a simulated 3D grid and a depth pre-pass, several milliseconds on their own, so the fire here is procedural noise instead.

### The observatory

The building is a stucco drum under a riveted steel dome. The slit's upper shutter is rolled back, and the dome turns on bogies against an internal ring gear.

- **Telescope:** a brass-banded refractor on a fork mount. An altitude sector gear drives it, and a pinion on the pier's azimuth ring turns it.
- **Controls:** two handwheels on a cast-iron console, each driving a two-stage brass gear train and a dial. A periscope eyepiece stands beside the console.
- **The eyepiece** (`src/render/postfx.js`): a field stop and an etched reticle, and outside it two amber-lit scales in the roof station's units. The azimuth ring reads the dome's compass heading at the index notch on top (`AZ_SCALE`: ticks every 5°, numbered every 30°, growing clockwise like the station's ring, so it slides left as the dome turns right). The altitude scale on the right reads the tube's elevation at its index arrow (`ALT_SCALE`: ticks every 2°, numbered every 10°, 0–70°). A brass pointer on each marks `SKY_TARGET`, as on the station: when the ring's pointer stands tip to tip under the notch and the scale's pointer sits beside the arrow, the telescope points at the Rocks constellation. The digits are seven-segment distance fields, crisp at any angle; it all stays in the one full-screen pass.
- **Rear hatch:** a riveted square cut low in the back wall, opposite the door. A curved panel behind it hangs from a pin. When the dome and the telescope both point at the top of the Rocks tor (within 0.35° in each axis), the panel swings aside in 1.5 s and shows a yellow plate with three screws. Aim elsewhere and it swings back. `ctx.observatory.hatch.align()` aims both at the tor.
- **Service ladders and the roof station** (`build_ladders`, `build_station` in the design; `src/props/observatoryStation.js`): a straight steel ladder stands off the back of the drum at 245° (out of sight from the door and clear of the hatch) from the ground to 4.7 m. A curved one on the dome runs from 4.7 m up over the dome on brackets to a small railed deck near the crown, 9.58 m up, beside the slit. The two meet only when the telescope points at the Dome stack (yaw −2.4327 rad, within 2°): then the fixed ladder's top leads on up the curved one, over the top onto the deck, and back down again. Anywhere else the fixed ladder's top leads nowhere. The deck's collision (a slab in a closed ring of rail walls, like the power tower's catwalk) exists only while the ladders meet; to climb down, face the yellow bars over the ladder's opening, look down and press **W**. `ctx.observatory.ladder.align()` turns the dome (and telescope) there. The curved climb is a controller feature: a ladder with a `path` (feet position by height along it) and `onTop`/`onBottom` hooks that hand the climber on (`src/player/controller.js`).
- **The station's iris:** a small copy of the End's aperture (0.5 m of blades) is set in the deck's floor, shut, with three push buttons on a plate in front of it: green, yellow, red, left to right as you face it. Pressing them in order (`STATION_ORDER` in `observatoryStation.js`, for now green, yellow, red) flies the blades open in 0.7 s with a quick scrape and a clunk; a wrong button gives a dull click and starts the order over. Once open it stays open. In its well lie the telescope's two scales: a compass ring for the heading (0–360°, ticks every 5°, numbered every 30°, its 0 truly north when the ladders meet) and a straight elevation scale for the tube (0–70°, numbered every 10°). A brass pointer on each marks `SKY_TARGET` (`src/world/skyTarget.js`, see Hooks); the eyepiece's scales carry matching pointers. The blades, the button caps and the scales are one draw call each, drawn only within 55 m (the scales only once open).
- **Electronics:** a bank of 70s racks with tape drives, lamp panels, a radar CRT and a patch bay, plus a desk of terminals, an oscilloscope and a star-field guider. There's also a workbench, a star chart and filing cabinets, all humming, whirring and chirping (the `electronics` sound emitter).

Named empties: `LADDER` (the ladders' angles, the fixed one's rung line and top, the curved one's rung line in its meridian plane as `path`) and `STATION` (the deck's frame and size, the iris, the button plate, the well). The ladders' and the station's small parts read their AO from the wall, the dome or the deck (`borrow_ladder_ao`), as the hatch's do.

Every moving part carries a `driver` (`yaw`, `pitch`, `wind` or `hatch`), a `ratio` and an `axis` in its GLB extras. Meshing gears are phased so their teeth interleave, and their ratios follow the tooth counts.

`src/props/observatory.js` merges the whole building into one mesh per material, about 15 draw calls. Each vertex is tagged with its part, and the vertex shader (and the shadow depth material) rotates it about its part's pivot and then its parent's. CRT content, blinking lamps and spinning tape reels are shader-driven from ids packed into the UVs.

### The cave

The hub cavern and its four tunnels run from one generator: a rusty olive 1970s set built into a concrete-framed recess in the hub wall. It has a riveted drum, a control cabinet with an oscilloscope, four meters, a lamp strip and warning signs, and four big unmarked toggle switches with a small bulb above each. Conduits leave its junction box, run along the hub wall and across the tunnel portals, and follow each tunnel to a junction box beside its elevator. Caged lamps hang every ~9.5 m.

- **Power lines:** one switch per tunnel (left to right: Tower, Mountain, Rocks, Dome). Any combination can be on. A line powers its tunnel lamps and its elevator; an unpowered elevator is dark and its buttons do nothing. Only the Dome line is on when you first come down.
- **Generator:** the scope's sine wave loses amplitude with each line switched on, the load meters follow, and the engine labours audibly (the `generator` sound emitter).
- **Lighting:** `cave_design.py` bakes the lamps with Cycles into two lightmaps: `cave_lm0.png` holds Tower, Mountain and Rocks; `cave_lm1.png` holds Dome, the always-on generator lamps and AO. The rock's and pipes' UVs are unwrapped as straight strips (tunnel segments, wall sectors) and packed with the rest at about 5 cm per texel. `src/props/cave.js` draws everything unlit, weighting the channels by the line states, so a switch changes the light instantly with no dynamic lights. The rock, paint and grime textures (`cave_rock.png`, `cave_paint.png`, `cave_grime.png`) are seamless tiles baked from Blender procedural shaders and applied triplanar.
- **Draw calls:** the whole cave is 7 (rock, paint, plain, metal, meter faces, lamps, scope). The levers and meter needles use the same GPU rig as the observatory (`src/render/rig.js`).

Named empties: `STATION_<line>` (elevator plates), `DOORLAMP_<line>`, `SWITCH_0..3`, `GEN_sound`, `GEN_center`, and `META` (the lightmap scales).

### The lounge

The Tower elevator has a secret third stop. At its cave station, press **Down** again and the car drops another 150 m to a cartographer's lounge; in the lounge, **Up** returns to the cave station. It needs the Tower power line like the rest of that elevator, and its call button works from the lounge too. Every other elevator still has just its two stops (`src/props/elevator.js`: `ends.lounge` is optional, and Up/Down step one stop along `top`, `bottom`, `lounge`).

- **The room** (`lounge_design.py`, 7 x 6 m, coffered ceiling at 3 m): dark walnut panelling, a plank floor and a red wool rug, floor-to-ceiling bookcases along the south wall (about 900 books, sets and singles, rolled charts, a clock, a telescope), two leather club chairs and a side table under one sconce, a globe on a walnut stand under the other between two framed charts (a star planisphere and a profile of the five stacks), a plan chest in the corner, and the elevator doorway with fluted pilasters and a brass floor dial. The palette is walnut, brass, leather and reds; there is no green.
- **The desk:** a partner's writing table on turned legs, with panelled drawers and brass bail pulls on both sides and a tooled leather inlay. On it: the map of the five stacks (true positions and sizes from `src/config.js`, cloud sea, compass rose, an empty cartouche), weighted at three corners with the fourth curling up; the red card with its three black dots beside it; and the lathe-turned brass lamp whose parchment shade pools the light on the map.
- **Lighting:** static. The desk lamp and the two sconces are baked with Cycles (full GI, the shades translucent) into one RGB lightmap on the second UV set, `lounge_lm.png` (2048, stored cube-root; `META.lm_scale` decodes it). The desk and its things get twice the texel density, the ceiling and small hardware half. `src/props/lounge.js` draws everything unlit in five calls (wood, leather, brass, the printed things, the glowing shades), with a faint lamp highlight on varnish and brass. `uGain`, `uAmb` and the glow colour there set the brightness.
- **Textures:** walnut and leather tiles and the plank floor (`lounge_wood.png`, `lounge_leather.png`, `lounge_floor.png`), the rug and the prints (`lounge_rug.png`, `lounge_prints.png`: planisphere, globe, stacks profile). The map, the card and its dots are separate files, `lounge_map.png`, `lounge_card.png` and `lounge_card_dots.png` (RGBA, drawn over the card). Repaint them freely: a rebuild only paints them when they're missing, unless `LOUNGE_REPAINT=1` is set. `LOUNGE_QUICK=1` bakes a small, noisy lightmap for layout work.
- **Collision:** the floor and ceiling are mesh; walls and furniture are the game's oriented boxes (`physics.addOBB`), which only push sideways, so sliding along the desk never lifts the player.
- **Visibility:** the lounge is in the `tunnel` zone, drawn only within 55 m of it (never from the cave or the surface), and the cave isn't drawn while the lounge is. It plays a quiet room tone (the `roomtone` emitter) instead of the cave's drips.

Named empties: `STATION` (the elevator's plate, with the call button's position), `LAMP` (the lamp highlight), `SOUND`, `OBB_*` (collision boxes) and `META` (room bounds, lightmap scale).

### The elevator

Every elevator end (the Dome and Tower cave hoods, the Mountain shed, the Rocks sequoia, the four cave stations and the lounge) is one instance of `public/models/elevator.glb` (`tools/blender/elevator_design.py`), loaded once by `loadElevator()` in `src/props/elevator.js`. Its footprint is the one every placement was built around, in the elevator root's space (+Z is the landing, the car runs back into -Z): the car's inside is |x| < 1.05, 0 < y < 2.6, -2.35 < z < -0.16, the doorway |x| < 0.68 and 2.3 m high, the plate |x| < 1.85 and 3.3 m high with its back at z = -0.12, and the leaves close with their centres at x = -+0.34 and slide 0.70 m apart.

- **The landing:** a dark slate painted-steel faceplate (front at z = 0.07) with rust-bloomed hex bolts round its edge, brushed stainless jamb and head casings (front at z = 0.10) with a drip cap over the head, and a diamond-plate sill standing 2 cm proud of the landing out to z = 0.165 (just under the lounge's brass threshold). The leaves run in a 56 mm pocket between the plate and the faceplate, so everything fits behind the lounge's wall (its back is at z = 0.17) and between the cave stations' portal posts.
- **The leaves:** 44 mm brushed stainless, meeting on a recessed black rubber astragal. Condensation runs down them from the head, limescale gathers as a chalky film along their feet and up the meeting edge, and wet grime sits in the seams and round the sill.
- **The car:** the old character, modelled: warm-grey enamelled steel panels with rivet rows, stainless kick plates and doorway liner, a handrail round three sides, a galvanised chequer-plate floor, an enamelled ceiling with a vent and a guarded opal lamp, and the button plate (Up above Down) to the right of the door facing out.
- **Sealed when shut:** the leaves' astragals overlap past the centre line, rubber jamb and head seals reach 6 mm into the leaves' back faces, a rubber sweep under each leaf reaches into the sill, and every leaf part is a closed solid, so from anywhere inside a closed car no line of sight gets out. `tools/regress/out/elevator_test.mjs` casts about 700,000 rays per car (from a grid through the whole car, in every direction and aimed at every seam, culling back faces as the renderer does): none escapes, and nothing of the world reaches into any car. Instanced scatter is never drawn inside a car (`addKeepOut` in `src/render/lod.js`: grass sown over the Mountain shed's floor used to grow up through its car), and the car's inside and outside are pulled a hair toward the camera (a constant polygon offset) where a landing's floor is flush with them (the Mountain shed's, the caves' rock).
- **Materials, 8 draw calls per end:** the outside (faceplate, casings, sill, bolts, the leaves' outer faces, the call button) is one lit `MeshPhysicalMaterial` through `patchMaterial` (fog, sky and sun on the surface, the door lamps underground, where a faint cave-coloured ambient keeps bare stainless from going black); its brushed metal is anisotropic. It uses `elevator_ext_albedo.png` (2048) and `elevator_ext_normal.png` and `elevator_ext_orm.png` (1024: baked AO, roughness, metalness). The inside, including the leaves' inner faces, is unlit: `elevator_int_albedo.png` (2048; its alpha marks the metal that catches a faint lamp highlight) times `elevator_int_lm.png` (1024), the ceiling lamp baked with Cycles (full GI, doors shut) and stored cube-root (`META.lm_scale`). Unpowered, the inside and the lamp dim to near black. About 2,600 triangles per end; the five textures come to about 60 MB of GPU memory with mipmaps, shared by all nine ends.
- **Textures** are painted in numpy from a baked G-buffer of each atlas (world position, face normal, surface kind, texel density and a few Blender noises), so the wear follows the real geometry. `ELEV_PAINT=1` repaints them from the last build's cached G-buffers in about 15 s (no rebuild or export); `ELEV_QUICK=1` makes small, noisy bakes for layout work.

Named empties: `LEAF_L` and `LEAF_R` (the leaves at their closed positions; `side`, `travel`), `BTN_call_up` and `BTN_call_down` (the two call-button variants, centred on the button), `BTN_up`, `BTN_down`, `CALL`, `LAMP` and `META` (the dimensions above, `lm_scale`).

**Sound while shut in** (`src/audio/engine.js`): everything heard from outside (wind, insects, birds, the cave bed and drips, every emitter, the reverb and all one-shots) runs through a `world` bus, and the player's own footsteps through a `near` bus. As a car's doors finish closing round the player (the last fifth of their travel), `setEnclosed()` fades `world` to silence in 0.4 s; it fades back in over 0.5 s as the doors start to open at the other end. Sounds the car makes while the player stands in it (its doors, the button clicks, the ride hum and knocks) are played with `{ car: true }` and go to `near`, so they carry on. It is keyed per elevator, so two elevators never fight over it.

### The power tower's kit

`public/models/tower_kit.glb` (`tools/blender/tower_kit_design.py`) is the kit that goes under each of the power tower's three LEDs. Each piece is modelled once in its own frame; `loadTowerKit()` in `src/props/powertower.js` loads it, and `buildPowerTower` places every piece three times and merges the copies, so they share one atlas.

- **The switch box** (`BOX`): a weatherproof steel box with a sloped rain hood, a door on two barrel hinges with a quarter-turn latch, and a black switch plate with three slots, each in a raised steel lip with white notches at top, centre and bottom. It hangs by bolted ears on two galvanised flat bars, strapped round the top rail and fillet-welded to the knee rail, sits on a welded shelf with braces, and runs a conduit from its cable gland down to the deck. Its frame is the game's (origin at the centre of its back face, +z out of the door); the switch plate's numbers are `SWB` in `powertower.js`.
- **The tags** (`TAG_0` to `TAG_2`): the riveted enamel tag on each door, in its LED's colour.
- **The slider** (`SLIDER`): one grip, drawn nine times by an instanced mesh and slid along its slot by the game: orange enamel worn to steel on its ribs, with a white index pointer toward the notches.
- **The capacitor** (`CAP`): a screw-terminal electrolytic can 0.8 m across and 1.5 m tall. It has a navy sleeve with a pale polarity stripe of dashes, sun-faded, streaked and lifting at its foot; a spun aluminium base and rim; and a phenolic terminal disc with + and − moulded in, two brass screw terminals with ring lugs, and a red vent plug. Two galvanised clamp bands hold it on welded standoffs off a painted steel channel, which spans two of the lattice's members (the arm's chords, or the body's rings at 31 and 33).
- **The solar panel** (`PANEL`): 36 by 28 cm, twelve polycrystalline cells behind glass in an aluminium frame with a junction box on its back. It sits on a tilt bracket and a post U-bolted round a rail, tilted 30 degrees toward the deck. Dust gathers along its low edge.

The struts that fix each capacitor's channel to the lattice, its two leads up into its LED's base ring, and the thin lead from each panel along the toe board are built by `powertower.js` into the tower's batch.

- **Material, one draw call per kit:** one lit `MeshStandardMaterial` with `tower_kit_albedo.png` (2048) and `tower_kit_normal.png` and `tower_kit_orm.png` (1024: baked AO, roughness, metalness). The box, tags and slider get about 1,080 texels per metre, the panel 810 and the capacitor 320. Each LED's box, tag and panel are one mesh (about 4,400 triangles), the three capacitors one mesh (about 12,000), and the sliders one instanced mesh (284 each).
- **Textures** are painted in numpy from a baked G-buffer of the atlas (position, face normal, surface kind, part and texel density, bevel-edge masks, two AO distances and a few Blender noises), like the elevator's. The box's grey-green enamel is chalky on top. It is chipped and rust-edged along its edges, worst at the corners (the edge distance is exact for its enamelled pieces). Rain streaks it, and rust drips off the hood's lip and runs from every bolt, screw and hinge. Grime fills the creases and the door's foot, and the switch plate is rubbed bright round the slots. The galvanised steel has white rust in its hollows and heat tint round the welds. Every pass is baked without a margin and the painted maps are dilated into the gutters afterwards: a bake margin from one object overwrites other objects' islands in the shared image. `KIT_PAINT=1` repaints from the cached G-buffer in about 30 s (no rebuild or export); `KIT_QUICK=1` makes small, noisy bakes.

Named empties: `BOX`, `TAG_0` to `TAG_2`, `SLIDER`, `CAP` and `PANEL` (each part's frame), and `META` (`swb`, `cap`, `termP` and `termN` where the capacitor's leads leave its terminals, and `jbox` the panel's gland).

## The Rocks stack

`src/world/stacks/rocks.js` lays it out; the pieces live in their own modules.

- **The tor** (`src/world/rockpiles.js`): a granite tor of stacked, jointed blocks about 12.5 m tall, west of the sequoia. It is tall enough that its top can't be seen from the ground. A spring fills a basin hidden on its top, spills through a notch and runs down a sheer chute face into a splash pool. The creek starts there. Four smaller boulder piles stand near the island's edge. The tor and piles are merged into one extra draw call, the cliff-material part of the stack's `rocks-props` batch, which also goes into the far stand-in. You can't climb it: rings of vertical collision circles surround each mound (`walls`), and the rock mesh is not in the collider.
- **Water** (`src/world/water.js`):
  - `cascadeMesh` draws the white water down the tor's chute.
  - `edgeWaterfall` draws the creek going over the east lip. It follows a drag-limited fall curve, kept clear of the cliff, and is two draw calls: a sheet plus mist veils. It starts as a glassy tongue at the lip, becomes a streaked sheet, breaks into strands and mist, and fades out by about y −150, some 150 m below the lip, before it reaches the cloud sea.
- **Spray and mist** (`src/world/waterfx.js`): GPU particles animated in the vertex shader from `atmo.uTime`, plus a foam decal; one draw call each.
  - At the pool: splash droplets with sun glints, spray and mist up the chute, low haze, and a foam decal.
  - Mist that thickens down the long fall.
- **The sequoia** (`src/props/sequoia.js`): about 50 m tall, with a buttressed, fluted base, furrowed cinnamon bark (its own procedural texture) and an old-growth blue-green crown, widest in its middle with a broad, rounded top. The ground under it is levelled, and sunk a little under the elevator car so the car's floor always shows. The elevator opens from a recess in its trunk, and `buildSequoia` returns where the elevator plate goes.
- **Wildflowers** (`src/world/flowers.js`): several hundred ox-eye daisies, buttercups, poppies and lupines in drifts. They are instanced, one draw call per kind, and fade out at 26–40 m.
- **The boulder puzzle** (`src/props/movableRocks.js`, `src/world/rockPuzzle.js`): five boulders you push by walking into them (0.75 m/s after a short lean). A boulder stays 2 m plus its radius inside the rim and won't overlap another boulder, the sequoia, the tor, a pile or the splash pool; the creek doesn't stop it. `ROCK_TARGETS` are where they belong: a regular pentagon, a stone circle 27 m round the island's centre (the creek runs through it), turned so every stone stands clear of the trees, the creek, the tor, the piles and the rim. Any boulder may fill any target, and each has a clear straight push of 6–13 m onto one (`tools/regress/out/rock_puzzle_test.mjs` proves it with the real controller, physics and push rules). When every target has its own boulder within 1.2 m (`TARGET_TOL`), `ctx.state.rocks.solved` is set and `ctx.onRocksSolved()` fires, once; nothing visible happens yet.
- **The Rocks constellation** (`src/render/constellation.js`): the puzzle's answer, in the sky where the observatory's eyepiece looks with the telescope on `SKY_TARGET` (heading 30°, about 39° up). It is a star map of the island, seen from above with north (+Z) up and heading 90 (−X) to the right, like the station's ring: 72 dim stars along the rim (`edgeR` all round), 22 slightly brighter ones along the creek from the tor's pool to the waterfall lip, and five bright ones on `ROCK_TARGETS`. The island's centre is on the crosshair; at 0.022° per metre the rim is about 1.1° out, 2.3° across, inside the eyepiece's 2.5° of sky. It is fixed to the world, not to the turning star field, and the sky leaves its ordinary stars out within 1.5–3° of it so they never crowd the figure. It fades in as the sun sets through 8° (the eyepiece shows it in the dusk sky, lifted against the glow) and stays all night; by day it isn't drawn. Through the eyepiece the stars are sharp Gaussian points (the bright ones larger, with a soft glow and a slight twinkle); by eye only the bright five show, as a faint knot. One draw call (a `THREE.Points`), none by day.
- **Sound** (`src/audio/engine.js`):
  - The `cascade` emitter plays at the splash pool.
  - The `frogs` emitter picks calls from spots along the creek banks: tree-frog rib-bits, the odd green frog and now and then a bullfrog. Calls are sparse by day and busier from dusk through night, and a frog right next to you stays quiet.

## The Tower stack

- **The power tower** (`src/props/powertower.js`): a lattice pylon about 53 m tall with a 27.6 m cross-arm and three giant LEDs, green and red on the arm ends and yellow on the peak. A steel ladder climbs the inside of the body to a grated catwalk laid in the cross-arm, 37.4 m up, which runs under all three LEDs. The catwalk's collision is one deck slab inside a closed ring of rail walls, so you can't fall off it. To climb back down, face the yellow bars across the ladder opening, look down and press **W**. Under each LED is its kit (see The power tower's kit):
  - **A weathered switch box** hangs on the inside of the rail opposite the ladder, at chest height, with three sliders (top, centre, bottom). Aim above a slider's grip and press to move it up a notch, below to move it down; at either end it goes back to the centre.
  - **A big capacitor** is strapped to the outside of the lattice below the LED, on the side toward the path up and the Dome. Two leads run from its terminals up into the LED's base ring; the peak LED's run 15 m up the body's face.
  - **A small solar panel** is clamped to a rail: on the end rails for the arm LEDs, beside the ladder's arrival for the peak's. It is wired along the toe board to the capacitor.

  The boxes and panels are drawn only within about 36 m: from the catwalk, not from the ground. The capacitors are drawn at any distance.

  **The LEDs breathe:** only the red one at first; the green and yellow stay dark until a puzzle lights them. A lit LED swells from dark to a soft glow and back every 3 seconds, all in step. The level is `0.5 − 0.5 cos` squared, over a faint floor. Each lens's emissive is a saturated colour kept low enough that the tone mapping doesn't bleach it: anything bright enough to pass the bloom's threshold comes out nearly white. So the glow is a soft additive halo round each lens, which breathes with it. The halo shows only against a darkening sky, and fades out as you come within 40 m of it (gone by 8 m), where the lens fills the view.

  Everything except the LEDs, their halos, the kits and the sliders is merged into the stack's `tower-props` batch and its far stand-in, including the capacitors' struts and all the leads. The nine sliders are one instanced mesh.
- **Groves and tall grass** (`src/world/stacks/tower.js`): 22 trees (15 pines, 7 broadleaves) stand in five windswept groves of three to five, biggest in the middle and stunted towards the edges (one of them broadleaf-led), plus three pines standing alone. Every trunk stays at least 3.4 m from the trail's centre, 14 m from the pylon's centre (its footings reach 10.3 m), 8 m from the cliff ladder's top, 10 m from the cave mouth (its hood rises past the cap) and 5.5 m inside the rim. The trunks' collision cylinders are a collider of their own (`tower-trees`), not part of the stack's: adding triangles to the stack's collider reshuffles its BVH, and the order it visits the wall's triangles decides some slow rim walk-offs (see tools/regress, triangle-order flips). Between them 12,000 clumps of tall seeding grass (`TallGrass` in `src/world/trees.js`, 0.45-1.1 m, green at the foot and straw to golden at the tip, some with timothy spikes or nodding oat heads) cover most of the cap over the short tufts: bare on the trail and short along its edges (full height from about 3.8 m off its centre), thinning out onto the pylon's dirt apron (none within 10.5 m, full by 14 m), round the ladder top, round each trunk and over the last 4.5 m to the rim, in drifts of greener and riper stands. They bend about 2.4 times as far as the tufts in the wind and have no collision. Placement is seeded (its own stream, `cfg.seed * 13`).

## Hooks for later puzzles

- `ctx.state.switches`: the four generator switches (Tower, Mountain, Rocks, Dome). `ctx.power[line]` mirrors them by name, and `ctx.onSwitches(state)` fires on every toggle.
- `ctx.state.rocks`: current positions and push order of the five movable boulders on Rocks, and `solved` (every `ROCK_TARGETS` spot has its own boulder within 1.2 m; it stays set). `ctx.onRocksSolved()` fires once, when it is first set. `ctx.boulders`: the boulders, their `blockers`, the world-space `targets`, `canMoveTo(rock, x, z)` (the push rules) and `checkSolved()`.
- `src/world/rockPuzzle.js`: `ROCK_TARGETS` (Rocks-local x, z from the stack's centre, like the boulder spots in `stacks/rocks.js`), `RING` (the pentagon they're built from), `TARGET_TOL` and `rocksOnTargets(positions, targets)`. `ctx.constellation`: the star map's `points`, its `stars` (map x, z, brightness, kind) and `update()`; `render/constellation.js` also exports `starDirection(x, z)`, `CENTER_DIR` and `SCALE`.
- `ctx.state.observatory`: dome yaw, telescope pitch, `hatch` (how far the rear hatch's panel has swung open, 0 to 1), and `stationOpen` (the roof station's iris has been opened; it stays open).
- `ctx.observatory.ladder`: `target` (the yaw where the service ladders meet), `tolerance`, `aligned()`, `align()`. `ctx.observatory.station`: `press(i)` (0 green, 1 yellow, 2 red, as the button), `open()`, and `button(i)`, `iris()`, `deck(x, z)` (world positions, for cameras and tests).
- `src/world/skyTarget.js`: `SKY_TARGET` (`{ yaw, pitch }`, telescope values as in `ctx.state.observatory`) is where the roof station's pointers point. `AZ_SCALE` / `yawToAz` (heading in degrees, 0 at +Z, clockwise from above) and `ALT_SCALE` / `pitchToAlt` (the tube's elevation in degrees) are the scales' mappings, shared by the eyepiece. `VIEW_DROP` is how far the eyepiece looks below the tube axis.
- `ctx.towerLEDs[i]` (0 green, 1 yellow, 2 red): `level` (0 to 1; red starts at 1, green and yellow at 0) scales that LED's breathing and halo, so a puzzle lights one by raising it or dims or silences it; `peak` is its full emissive. The breathing sets `mat.emissiveIntensity` and the halo's opacity every frame.
- `ctx.state.towerSwitches`: the catwalk switch boxes, `[box][switch]`, each `'top'`, `'center'` or `'bottom'` (all `'center'` at start). Box `i` sits under `ctx.towerLEDs[i]` (0 green, 1 yellow, 2 red); switches are numbered left to right as you face the box. `ctx.onTowerSwitches(state)` fires on every press, and `ctx.towerSwitches.set(box, switch, value)` moves a slider without the click or the hook.

## Performance notes

Budget: no area may exceed **10 ms per frame** at 1920×1080 on the reference machine (RTX 3060), including its worst single frame; the typical frame should stay near half that. Check with `await bench()` in a `?dev` session. It stands in every area (cabin, garden, each stack, bridge, observatory inside and out, the telescope, the cave), turns through 8 headings, and prints the average and worst frame, draw calls and triangles per area.

### Culling and level of detail (`src/render/lod.js`)

Three.js frustum-culls every object against the camera's field of view. `ctx.lod` adds distance, the way Unity's LOD groups with cross-fade do:

- **Distance bands.** Each registered object fades out across its `out` band (or in across `in`), then is hidden and costs no draw calls. While fading, its meshes use a dithered twin of their material that discards a growing share of pixels by distance. There is no transparency sorting, and a detailed version and its stand-in cross-fade seamlessly because their dither patterns are exact complements.
- **Zoom-aware.** Distances are scaled by the camera's zoom, so the telescope sees the full-detail version of things hundreds of metres away, as screen size would.
- **Bands in use:**
  - Cabin rooms: 55–75 m. They're gone once you leave the Dome stack. The hearth fire goes with them.
  - The garden fire pit's flame and sparks: 60–80 m (their shaders fade them across it; the pit's light goes out with them).
  - Observatory interior: 45–65 m.
  - Garden, porch and weather mast: 110–140 m.
  - Elevator ends (8 draw calls each) and cave bulbs: 70–95 m.
  - The lounge under the Tower: hidden beyond 40–55 m (no fade; it is only ever seen from inside).
  - The power tower's kits: each LED's switch box and panel 30–36 m (one draw call each, never drawn from the ground); the nine sliders 22–26 m (their bounds span the whole catwalk); the three capacitors (one draw call) are never distance-culled.
  - Boulders: 110–140 m.
  - The Rocks constellation is never distance-culled (it is in the sky); it just isn't drawn by day or underground.
  - Pebbles: 45–60 m; big stones 110–140 m.
  - Shrubs: 45–65 m.
  - Trees swap to low-card stand-ins across 100–130 m.
  - Grass: only tufts within 50 m are drawn; the material fades them out by 48 m.
  - Tall grass (the Tower): only clumps within 57 m are drawn (one draw call, no shadows); the material dithers them out across 41-55 m.
  - Wildflowers: 26–40 m.
  - Rocks pool splash, mist, haze and foam: 110–150 m (their shaders fade them across it). Tor spring: 140–180 m. Tor cascade: 220–280 m.
  - The Rocks edge waterfall and its spray are never distance-culled: they're a landmark from the other stacks.
- **Far stand-ins.** Across 150–190 m, each building's shell and each stack's props cross-fade to one merged mesh (`addFarProxy`). Its vertex colours bake in the material colour, average texture colour and AO, so the cabin, for example, costs 5 draw calls from another stack instead of 29. Glass, glowing and shader-animated meshes stay as they are.
- **Instanced sets** (`InstancedLod`): trees, grass (tufts and tall grass), pebbles and wildflowers keep only the instances inside each level's range, re-gathered from a grid as the camera moves. Only near trees cast shadows.
- **No hitching:** see the preloader below.

### The preloader (`src/render/preload.js`)

Three.js compiles a shader the first time a material is drawn in a new state, and uploads geometry and textures on first draw; Windows drivers (ANGLE) finish a shader only on its first real draw. Left alone, every new view would stall. So everything the GPU will ever need is made behind the black screen, before the player can wake, while a hairline on the veil fills (`index.html`; the models' download, the world build, then the preload). Clicking early is kept: the game starts the moment it is ready.

`main.js` builds the world, makes the ending's clock and steam up front (hidden; `prepareEnding`), then runs `preload()`, sliced into short tasks so the page stays responsive:

1. **Compile.** Every material in the scene, then every LOD fade twin, with `renderer.compileAsync` (the driver compiles in parallel, off the main thread) for the render target the scene really renders into (the composer's linear target: compiled for the screen, they would be compiled again), with the scene's lights, fog and environment. r186 compiles hidden objects too, so the tunnels, the lounge, the cars and the interiors are included.
2. **Textures.** Every texture any material, shader uniform or `onBeforeCompile` uniform holds is uploaded (`initTexture`).
3. **Draw.** Everything is made visible (both zones, every LOD level and fade twin, far stand-ins, instanced levels with at least one instance, interiors, the scope's station dial, the constellation, water and spray, sky, clouds, stars, the ending's props), frustum culling off, and drawn a slice of the scene at a time into a small target of the same format, with the sun's shadow map rendering: vertex and instance buffers upload, the shadow depth programs compile, and the driver does its draw-time work.
4. **Hooks.** Things that allocate on first use: the cabin's reflection probe captures all six faces (its cube target and PMREM), the environment map is refreshed, and the sound's noise and reverb buffers are made (`AudioEngine.prepare`: an `AudioBuffer` needs no `AudioContext`, so no click). The click only creates the context and wires the graph.
5. **States.** One real frame, every pass, of each representative state: the cabin, the surface by day and by night, the cave hub, the lounge, the eyepiece (fov 3.2, scope overlay) by day and on the constellation at night, and the cabin again.

Then every object's visibility, culling, instance count and material, the clock, the camera, the eyepiece and the zones are put back exactly as built, and the LOD re-applies itself on the first frame. On the reference machine the preload takes about 1.6 s (compile 0.4 s, textures 0.7 s, draw 0.3 s, the rest 0.2 s), after about 4.5 s of world building. It is browser-only: the headless regression harness builds the world without it.

Two sources of mid-game allocation were removed for it: the sky's environment map is re-filtered into the same PMREM target every 2.5 s (`PMREMGenerator.fromScene` allocated a new one each time), and the ending no longer builds its clock and steam when it starts.

**Hitch monitor** (`src/dev/hitch.js`, `?dev`). From the first frame after the click it counts every shader program linked, every texture, render buffer and vertex buffer allocated, every large texture re-upload, and every frame over 20 ms, and logs each with what was being drawn (object and material) or the game code that asked for it, and where (the stack, the lounge, the eyepiece...). `hitchReport()` prints the totals and a table by area; `renderer.info.programs` is cross-checked each frame. `await hitchTour({ ending: true })` drives the game by hand through every area: bench()'s areas by day and night, rim views of every stack from every other, the eyepiece by day and night all round and on the constellation, the roof station with the iris open, the tower catwalk, every elevator ride (the lounge stop included), a fall and, optionally, the ending. The target is zero compiles and zero allocations after wake-up; resizing the window (or the adaptive pixel ratio stepping) necessarily reallocates the post-processing targets.

### Other

- Static geometry is merged per material on each stack. Trees, grass (tufts and tall grass), pebbles, wildflowers, and clouds are instanced. The tall grass is three crossed cards per clump (12 triangles), shaded Lambert rather than standard: its cost is fill, and that halves it (about 1 ms at 1080p standing in it). The cave's stalactites are part of the baked cave model.
- Collision is a capsule against per-zone BVHs (three-mesh-bvh). Only colliders whose bounds contain the player are tested. Doors, boulders, and the aperture use small dynamic primitives.
- The tunnel network is a separate enclosed space far below the clouds. Only one of surface or tunnels is rendered at a time. Underground it is 7 draw calls of lightmapped, unlit geometry plus the elevators.
- Pixel ratio adapts downward if frames stay slow, and lighting and fog colors come from one shared set of uniforms.
- Interiors share four point lights (`src/render/lightpool.js`). The cabin and the observatory each claim them when you're nearest, so the light count, and every shader, never changes. The two fires have a point light each, made with the world for the same reason (see Fire).
- The Rocks river uses a refracting (transmission) material, which makes three.js render the scene a second time. Beyond ~110 m it swaps to a plain glossy material, because the river was costing a full extra pass even when seen from other stacks. The distance culling above also shrinks that second pass.
