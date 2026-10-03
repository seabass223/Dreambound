---
description: Improve one of the game's procedural sounds, judged by offline render, spectrogram and measurement
argument-hint: <what to change, in your own words>
---

Change a sound in Dreambound's audio engine as asked: **$ARGUMENTS**

Every sound is synthesised in `src/audio/engine.js`, and you cannot hear any of them: the work is done by rendering
offline, looking and measuring. `tools/audio/README.md` explains the tools; read it first. Run the commands from the
repo root; everything they write goes to `tools/audio/out/`, and each prints the paths it wrote.

If the request is only to look at a sound or to measure it, change nothing: do steps 1 and 2 without `--tag` and
without the scratch tests, run `node tools/audio/check.mjs`, and hand over as in step 9 (the WAVs, their PNGs, the
level table, what you saw).

1. **Find it.** The sound in `src/audio/engine.js` (`sfx_<name>`, `loop_<name>`, a bed in `build*()` / `update()`, an
   emitter in `startEmitter()`) and everyone who plays it: grep `src/` for the quoted name, `'<name>'`, not for
   `play('<name>'`, which misses most of them. Callers write `play?.('thunder'`, go through a wrapper
   (`sound('doorClose', key, opt)` in `props/elevator.js`, which adds `pos` and `car`; `play(name, opt)` in the
   sequences) or pick the name from a list (`props/cabin.js`). For a bed or an emitter, grep `registerEmitter(` and
   read what `update()` is given. Note the options they pass, the durations they expect, where it is heard from.
2. **Before.** Render it as it is now, the way the game plays it.
   - Its job: `node tools/audio/render.mjs --list <name>` shows the jobs that play that sound (a job's name is not the
     sound's: `door_close` plays `doorClose`, `bell` plays `alarm`) and the groups they are heard in. Then
     `node tools/audio/render.mjs <job> --tag before --n 5 --spec`: five takes (`out/<job>.before.wav`, then
     `<job>.before.2.wav` to `.5.wav`), their pictures, and a line on how far the five differ.
   - No job for it: `--play <name> --opts ... --pos ... --name <n>` with a caller's options (a loop: `--loop`; a bed:
     `--ambience ...`) in place of `<job>`, and give it a job in step 8.
   - Heard over a bed (thunder over the storm, the alarm): render it alone for its shape, and over the bed for its
     level and what the compressor does, under a name of its own:
     `node tools/audio/render.mjs thunder_300 --storm 1 --alt -40 --mute cricketBus --name thunder_300_storm --tag before`
     (or a job that has both: `storm_mix`, `alarm_ending_storm`).
   - Its neighbours, in a command of their own (`--tag` tags everything on the line):
     `node tools/audio/render.mjs --group <group> --spec`, the group `--list` showed it in (`hand`, `doors`, `car`,
     `storm`, `gatehouse`, `ending`, `beds`, `loud`), or two or three jobs by name.
   - The scratch tests, if `tools/regress/out/dome_wind_test.mjs` and `tools/regress/out/elevator_test.mjs` exist: run
     them now, before you edit, and keep what they print
     (`node tools/regress/out/dome_wind_test.mjs > tools/audio/out/dome_wind_test.before.log 2>&1`, about 7 s;
     `elevator_test.mjs` likewise, about 3 minutes: start it in the background and carry on). Nobody keeps them
     passing, and `elevator_test.mjs` has exited 1 on checks that are nothing to do with sound, so without this
     "before" you cannot tell your failures from theirs.

   Read the PNGs (they are images: look at them) and the level table.
3. **Design** the change to the user's words, taken at face value. The house style: rich, layered, natural, different
   on every play; never beepy or toy-like; level with its neighbours. What has been said so far: rain that sounded like
   "tin buckets getting hit" became one steady dense wash. Thunder is shaped continuously by distance: near, a sharp
   crack, then a huge low boom, more cracks and a short chaotic rumble; far, no crack, a slow low swell and a long
   rolling rumble. An alarm that was "too nice" became a low, harsh buzzer. The elevator's doors got separate opening
   and closing sounds timed to the leaves' travel. Birds became distinct species singing bouts from their perches. If
   the words could mean two different sounds, render both and ask.
4. **Rules.** Keep to the engine's (README, "The engine's rules"): only the node types the test mocks have (wave
   shapers through `this.shaper()`), out through `world` (outdoor beds through `outdoor`; one-shots by `this.out()` /
   `this.route`), no exponential ramp to or from 0, nothing scheduled in the past, every source stopped, no nodes made
   per frame in `update()`, levels in the tables at the top of the file, slow-to-make buffers baked in `prepare()`.
5. **Edit** `src/audio/engine.js`, the smallest change that does it, with comments in the file's own manner (what it
   is the sound of, not how the code works).
6. **After.** The same commands as the before with `--tag after`, the over-the-bed one too:
   `node tools/audio/render.mjs <job> --tag after --n 5 --spec`. Take 1 of each is the pair:
   `python tools/audio/spec.py out/<job>.before.wav out/<job>.after.wav --stack <job>.pair.png` draws them one above
   the other on one time axis; zoom both with `--t0 --t1` (add `--nfft 1024` for an attack). Compare levels on `max50`
   and `A m50`, and on the span of the five takes rather than on one: a noise-made sound's `peak` moves a couple of dB
   with the seed alone. Go round again until the pictures show what the words asked for: its layers, its timing, where
   its energy sits, and A-weighted levels in line with the neighbours'.
7. **Check.** `node tools/audio/check.mjs` and `node --check src/audio/engine.js` must pass. Run the scratch tests
   again as in step 2 (`...after.log`) and compare their `PASS` / `FAIL` lines with the before's: only a line that
   turned from `PASS` to `FAIL` is yours, and an exit code of 1 is not by itself. Of `elevator_test.mjs` only the three
   checks named `audio ...`, at its end, are about sound; all of `dome_wind_test.mjs` is.
8. **Callers and README.** Option names, defaults and durations still match every caller. If the sentence in
   `README.md` that describes the sound is now wrong, correct it. A sound that is new, or newly worth comparing, gets
   a job in `tools/audio/jobs.mjs`, and a place in its `GROUPS`.
9. **Hand over.** Send (SendUserFile) the pair, `tools/audio/out/<job>.before.wav` and `<job>.after.wav`, and the
   picture of the two, `<job>.pair.png`, with a few lines on what changed and the levels before and after. Say plainly
   that you judged it by render, spectrogram and measurement, and that the user's ears are the final check. Don't
   commit unless asked.
