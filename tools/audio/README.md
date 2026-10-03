# Sound tools

Every sound in the game is synthesised in `src/audio/engine.js`: there are no audio files. These tools render those
sounds outside the browser, so a change to one can be looked at, measured and checked before anyone listens to it.
`/sound <what to change>` (`.claude/commands/sound.md`) is the routine that uses them.

| File | What it is |
|---|---|
| `render.mjs` | The command line. Runs the real engine on an offline Web Audio and writes 16-bit 48 kHz stereo WAVs with a table of levels. |
| `jobs.mjs` | Named renders (`door_open`, `thunder_near`, `birds`, ...): every sound reworked so far, and the neighbours a new sound's level is set against, in groups (`GROUPS`). Also the option sets `check.mjs` tries. |
| `spec.py` | A WAV as a picture: its level over time and its spectrogram. Python with numpy and Pillow only. |
| `check.mjs` | The engine's rules, tested on a mock AudioContext for every sound it has. Exits 1 on a failure. |
| `wal.mjs` | "Web Audio Lite": the offline renderer behind `render.mjs`, the part of the Web Audio API the engine uses. |
| `out/` | Everything they write. Ignored by git and kept for nothing: a file in it may be from another session, or from before a name changed, so go by what your own commands print, and delete the folder whenever it is in the way. |

Nothing here is used by the game or the build. They need `npm install` (three) and, for `spec.py`, `python` with numpy
and Pillow. The commands below are run from the repo root; the tools print a path from where they were run, or in full
when it is somewhere else.

## Rendering

```sh
node tools/audio/render.mjs --list                          # the named jobs, the sound each plays, the groups
node tools/audio/render.mjs --list doorClose                # the jobs for one sound, and the groups they are in
node tools/audio/render.mjs door_open click elevatorRide    # a sound and two neighbours, for level
node tools/audio/render.mjs --group doors                   # everything heard in the same place
node tools/audio/render.mjs "thunder_*" --spec              # several, and draw their spectrograms

# any sound, by its play() name and options (JSON, or k=v,k=v where quoting JSON is a nuisance)
node tools/audio/render.mjs --play thunder --opts '{"distance":150,"pan":-0.5}' --seconds 8
node tools/audio/render.mjs --play doorClose --opts dur=1.7,car=true --pos 0.2,-0.3,0.9
# a handle (the alarm, the loops): call it as it plays
node tools/audio/render.mjs --play buzzAlarm --at "2 setWet 0 0.4" --at "2 setDry 1 0.3" --at "5 stop" --seconds 7
node tools/audio/render.mjs --loop scrape --pos 0,0,-3 --seconds 5

# the beds: update() runs every block with this environment
node tools/audio/render.mjs --ambience --alt 30 --storm 0 --seconds 40       # a calm day: wind, birds, insects
node tools/audio/render.mjs --ambience --alt -40 --storm 1 --mute cricketBus # a storm at night
node tools/audio/render.mjs --emitter fire@0.5,-0.8,-2.4 --indoor --mute windGain,birdBus,dayBugs --name hearth
# a one-shot over the beds: the same flags on a job, and a name of its own so the job's file is not written over
node tools/audio/render.mjs thunder_300 --storm 1 --alt -40 --mute cricketBus --name thunder_300_storm
```

`--help` lists every option. The listener stands at the origin looking down -Z (x: right, y: up), so `--pos 0,0,-3` is
3 m straight ahead. A sound played with no position goes straight into its bus at full level, which is right for the
ones the game plays that way (thunder, rumble, the alarm) and too loud for the rest: give those the distance they are
heard from, as the jobs do.

**Jobs and sounds.** A job's name is not always the name the game plays: `door_close` plays `doorClose`, `hinge` plays
`hingeClose`, `bell` plays `alarm` (the old one) and the `alarm_*` jobs play `buzzAlarm`. `--list` has a column for
it, `--list <word>` keeps the jobs whose name, sound or description has the word, and asking for a job that does not
exist names the ones that play that sound.

**Groups.** `--list` ends with the groups in `jobs.mjs`: the jobs heard in the same place or the same scene (`hand`,
`doors`, `car`, `storm`, `gatehouse`, `ending`, `beds`, `loud`). They are the neighbours a sound's level is set
against, and `--group <name>` renders one whole.

**What the files are called.** `out/<name>[.<tag>][.<take>].wav`, and the PNG beside it.

- `<name>`: the job's. For `--play` and `--loop` it is `<sound>.play` and `<sound>.loop`, so that `--play click` (your
  options) never writes over the job `click` (the game's). For `--ambience` alone it is `ambience`. `--name` gives
  another, when one thing is rendered: use it when world flags change a job, as in the last example above.
- `<tag>`: `--tag before`, `--tag after`; with `--ref`, the commit's short sha. `--tag` tags everything on the command
  line, so render the neighbours with a command of their own.
- `<take>`: with `--n`, takes 2 and up (`click.before.2.wav`); take 1 has none.

What it prints, one row per WAV, in dBFS at the game's output (after the master gain and compressor):

```
                               peak    rms  max50 |  A rms  A m50 |   length | into the compressor | file
door_open                      -9.9  -28.9  -20.0 |  -34.5  -27.0 |   3.77 s | peak -10.3, squeezed 0.0 dB | tools/audio/out/door_open.wav  (seed 1, 1.5 s to render)
```

- `peak`: the largest sample. Over 0 the browser clips; the row says so and the file is scaled down to fit. One take's
  peak says little about a sound made of noise: it moves with the seed alone (the click's by 2.3 dB over five seeds,
  while its `max50` moves 0.2).
- `rms`: over the part that sounds (first to last sample within 60 dB of the peak). `length` is that part, so it
  takes in the reverb's tail: a 30 ms click reads 1.59 s. How long the sound itself lasts is read off the picture.
- `max50`: the loudest 50 ms. For a one-shot this, not `rms`, is how loud it hits.
- `A rms`, `A m50`: the same two, A-weighted, which is nearer to how loud it is heard: a low rumble counts for little,
  anything round 2-4 kHz for a lot. Set a sound against its neighbours, and an after against its before, on these.
- `into the compressor`: the peak the master compressor was given, and the most it turned the sound down. More than
  about 1 dB of squeeze means the sound is leaning on the compressor, and will duck whatever plays with it.
- `tap` rows (a job's `taps`, or `--tap node`): one of the engine's own nodes measured alone, before the master, for
  one layer of a mix (the birds without the wind). `--taps` writes those as WAVs too.

A one-shot's WAV is cut 0.3 s after that last sample within 60 dB of its peak (so the file is a little longer than
`length`, and never under half a second); a row flagged `cut short` needs a longer `--seconds`. A job with ambience,
or one that plays a handle (the alarm, a loop), is written at its full length.

A sound that is heard over a bed is rendered twice: alone, for its shape and its own level, and over the bed (the
world flags on the job, or a job that has both: `storm_mix`, `alarm_ending_storm`) for what reaches the output and
what the compressor does to the two together. On 3 October 2026 thunder at 300 m peaked at -4.3 alone and at -1.6 over
the full storm.

Randomness: the engine draws on `Math.random` for its noise, its timing and its choices, and `render.mjs` seeds it
(`--seed`, 1 unless told; every row says its seed, and `--seed random` picks one and says which), so a render is the
same every time. No two plays in the game are alike, so judge a sound on several: `--n 5` renders five takes (seeds 1
to 5) and ends with how far they differ:

```
    click, 5 takes (seeds 1 to 5): peak -13.5 to -11.2, max50 -33.4 to -33.2, A m50 -35.0 to -34.5 dB; length 1.48 to 1.59 s
```

For scale, the levels on 3 October 2026 (seed 1; render them again rather than trust this):

| One-shots | peak | max50 | A m50 |
|---|---|---|---|
| `click`, under the hand | -13.5 | -33.4 | -35.0 |
| `drawer`, 2 m | -10.0 | -20.2 | -30.6 |
| `door_open` / `door_close`, 3 m | -9.9 / -6.8 | -20.0 / -17.0 | -27.0 / -26.9 |
| `elevatorRide`, 3 m | -1.5 | -11.2 | -28.4 |
| `explosion`, 41 m | -2.8 | -10.4 | -28.4 |
| `alarm_dry` | -4.4 | -15.3 | -17.3 |
| `thunder_near` (150 m) / `thunder_far` (6 km) | -3.7 / -7.1 | -9.3 / -16.1 | -11.1 / -32.7 |

| Beds | peak | rms | A rms |
|---|---|---|---|
| `rain` (a full storm's, alone) | -9.6 | -22.5 | -22.1 |
| `wind` on a calm night | -17.8 | -33.4 | -41.9 |
| `day`: the birds alone (tap `birdBus`) | -30.9 | -51.8 | -53.7 |

## Before and after

The agent making a change cannot hear it, so every change ends as a pair of WAVs for the user to listen to.

- Before editing: `node tools/audio/render.mjs door_open --tag before --n 5 --spec` writes `out/door_open.before.wav`
  and takes 2 to 5 beside it, with their pictures. After: the same command with `--tag after`. Same job, same seeds:
  take 1 of each is the pair, the five of each show whether a difference is the change or only the seed.
- Or against a commit: `node tools/audio/render.mjs door_open --ref HEAD` renders the job twice, from that commit's
  engine (`out/door_open.<sha>.wav`) and from the working tree (`out/door_open.wav`), and prints the change in every
  level. It gets the old engine with `git show <rev>:src/audio/engine.js`, written with whatever it imports by a
  relative path (`../core/rng.js`) under `out/.ref/<sha>/src/...`, at their own paths: the relative imports then resolve
  among themselves and `three` resolves to the repo's `node_modules` above. Nothing is checked out and the index is not
  touched. `--ref` only reaches what is committed: if the engine has uncommitted work in it
  (`git status --short src/audio/engine.js`), render the "before" with `--tag before` instead.
- `python tools/audio/spec.py out/door_open.before.wav out/door_open.after.wav --stack door_open.pair.png` puts the two
  pictures one above the other on the same scales and the same time axis: the longer file's, with the shorter one
  padded with silence and a dotted line where its file ends. So a thud that lands later is drawn further right.

A pair shares its seed, but two versions of the engine do not draw the same random numbers in the same order, so
anything left to chance (which birds sing, how the wind gusts, which takes of a crack) differs between them for that
reason alone. Compare a bed through its tap, or with the others muted (`--mute windGain`).

## Looking

```sh
python tools/audio/spec.py                                  # every WAV in out/ with no up-to-date PNG
python tools/audio/spec.py out/thunder_near.wav --t0 0 --t1 1.2 --nfft 1024   # the attack, sharp in time
python tools/audio/spec.py out/alarm_dry.wav --lin 3000     # harmonics on a linear axis
python tools/audio/spec.py out/a.wav out/b.wav out/c.wav --stack abc.png      # several on one time axis
python tools/audio/spec.py out/rain.wav --numbers           # octave bands, crest factor, how steady it is
```

A path is taken as given, or relative to `tools/audio` or its `out/` (`door_open.wav` finds `out/door_open.wav`). A
picture lands beside its WAV; a zoomed one has the stretch in its name (`thunder_near_0-1.2.png`). `--t1` past the end
of a file draws silence there, so one `--t0 --t1` gives files of different lengths the same axis without `--stack`.

The picture: level over time on top (blue: peak, yellow: RMS), the spectrogram under it (25 Hz to 16 kHz on a log
scale, 80 dB of range). The heading gives the stretch drawn and its `peak` and `rms`, measured as `render.mjs`'s
table measures them: `rms` over the part that sounds, not over the silence round it. (They agree to a few tenths of a
dB: a 16-bit file rounds the quiet end of a tail.) A click is a thin vertical line; a tone a horizontal one, with its
harmonics above it; noise a cloud whose height is its band; a thump a blob at the bottom. What to look for:

- **Layers.** A rich sound shows several things at once, at different heights and times. One blob or one line is a
  thin sound.
- **Repetition.** The same shape at even intervals is heard as a machine or a beep. Natural sounds are uneven.
- **Edges.** A sound that starts or stops as a hard vertical edge across all frequencies clicks. A tail that stops
  dead was cut.
- **Where the energy is.** Below 100 Hz is felt more than heard and eats headroom; 2-5 kHz is where harshness and
  presence live; nothing above 8 kHz is dull.
- **Steadiness** (`--numbers`). Dense, even noise (the rain) keeps its 2-8 kHz level within about half a dB from one
  20 ms frame to the next; separate hits and ticks show as several dB of spread, and are heard as hits.

What `--numbers` prints, all of it over the part that sounds:

- `rms`, `peak`: as in the table. `crest`: peak over rms. About 10-13 dB for steady noise, 3 for a sine, 20 and more
  for a lone hit.
- `excess kurtosis`: how spiky the samples are. 0 for steady noise, -1.5 for a sine, tens or hundreds for a few clicks
  in silence.
- `L/R correlation`: 1 is the same in both ears (mono), 0 unrelated (wide), under 0 out of phase.
- `octave bands`: the level in each octave, in dBFS; together they make up the rms.
- `2-8 kHz level`: that band cut into frames of 5, 20 and 100 ms. `spread` is how much the frames' levels differ (their
  standard deviation, in dB over the mean frame); `loudest` and `quietest` are the extreme frames, in dB against the
  mean frame.

## The engine's rules

`node tools/audio/check.mjs` plays every `sfx_*` and `loop_*` the engine has, six times each, with no options, with a
position, and with every option set in `jobs.mjs`; runs `update()` through a day, a dawn, a night, a storm, underground
and with each emitter alone; and fails on any of these. `-v` gives every option set its own row.

| Rule | Why |
|---|---|
| **mock**: only Gain, BiquadFilter, Convolver, BufferSource, Oscillator, ConstantSource, Panner, StereoPanner, DynamicsCompressor and PeriodicWave. A wave shaper only through `this.shaper(curve)`. | The headless tests (this check, and the scratch tests in `tools/regress/out/`) run the engine on a mock AudioContext that has just these. Anything else throws there. `shaper()` degrades to a plain gain when the context has no WaveShaper. |
| **route**: every source reaches the output through the `world` bus; an outdoor bed (wind, crickets, birds, rain, thunder) through `outdoor` first. One-shots go out by `this.out(pos, ref)`, or `this.route` when not positional. | `setEnclosed()` fades `world` out when an elevator's doors shut on the player, and `setFeed()` puts it through the camera's microphone: a sound that goes round it is heard through closed doors. `outdoor` is what walls and the bunker muffle. `this.route` is how `{ car: true }` moves a sound to the `near` bus. Meant exceptions are listed in `check.mjs` (`BYPASS`): footsteps (`near`), the intro's ringing and the fall's wind (the player's own head: straight to the master), a sound made for the camera feed (`feedOut`). |
| **exp0**: no exponential ramp to 0, from 0 or across it. | To 0 the browser throws. From 0 the value holds and then jumps at the end: a click. Start at 0.0001 (`this.env()` does), or fall to 0 with a linear ramp or `setTargetAtTime`. |
| **past**: nothing scheduled before the context's current time. | It happens at once instead: attacks are lost, envelopes click. A one-shot schedules from the `t` that `play()` hands it (10 ms ahead), `update()` from `this.now()`, a handle from `Math.max(this.now(), t)`. |
| **unstopped**: every source a sound starts is stopped. | An oscillator or a looping buffer left running costs CPU for the rest of the session, and they add up. A one-shot stops its sources as it schedules them (`osc.stop(t + dur + 0.05)`); a loop or a handle in its `stop()`. Only the beds built in `start()` run for good. |
| **perframe**: `update()` makes no nodes frame after frame. | It runs sixty times a second: per-frame nodes are garbage and hitches. It steers what `start()` built with `setTargetAtTime`; new nodes only at an event (a bird's phrase, a drip, a crackle). |
| **other**: values and times finite; nothing started twice, stopped before it starts, or connected and never started; nothing throws. | The browser throws on most of these, in the middle of the game. |

And the ways of the house that a test cannot see:

- **Level.** A sound sits with its neighbours at the distance it is heard from: render them together. Levels live
  in the tables at the top of the engine (`LEVEL`, `RAIN`, `DOOR_LEVEL`, `BIRD_LEVEL`), not scattered through a sound.
- **Never the same twice.** Pitch, timing, count and level are drawn afresh on every play. Texture and movement come
  from noise (`this.fireMod`, smoothed random), not from an LFO: anything periodic is heard as a machine.
- **Bake early.** Sample data that takes time to make (a long noise bed, an impulse response, a grain bank) is made in
  `prepare()`, during the preload, and only wired up in `start()`. A buffer needs no AudioContext.
- **Before `start()`** `play()` returns null and `loop()` a handle that does nothing; callers use `?.` on what they get.
- **Callers.** A sound timed to something on screen takes its duration as an option from the caller (`dur`,
  `duration`, `swing`), whose constant is the one truth: `DOOR_TIME` in `props/elevator.js`, the timings in the
  sequences. To find a sound's callers, search `src/` for its quoted name (`'doorClose'`), not for `play('doorClose'`:
  they also write `play?.('thunder'`, go through a wrapper (`sound(name, key, opt)` in `props/elevator.js`, which adds
  `pos` and `car`; `play(name, opt)` in the sequences) or pick the name from a list (`props/cabin.js`).

## The scratch tests

`tools/regress/out/` is ignored by git, so these two may not be there. When they are, they run the engine on mocks of
their own, and an engine change can break them:

| Test | Takes | What of it is about sound |
|---|---|---|
| `node tools/regress/out/dome_wind_test.mjs` | about 7 s | All of it: the wind's muffling under the dome, and what that must leave alone. |
| `node tools/regress/out/elevator_test.mjs` | about 3 minutes: run it in the background, or with a timeout well over the usual two minutes | Its last three checks, the ones named `audio ...`: outside sounds only through `world`, in-car sounds and footsteps through `near`, and `setEnclosed()`'s fades. The rest is the elevator's geometry and rides. |

Neither is kept passing by anyone, so run them before an engine edit as well as after, keep both outputs, and compare
their `PASS` / `FAIL` lines: only a line that turned from `PASS` to `FAIL` is the edit's. On 3 October 2026
`elevator_test.mjs` exited 1 at 17 of 29 with the engine untouched: its count of ends is out of date and eleven
"closed car: no ray escapes" checks fail. Its three `audio` lines passed, and `dome_wind_test.mjs` passed 15 of 15.

## What a render is not

It is the engine's own code driving a model of the browser's audio, close enough to set levels by and to see what a
sound is made of: automation, filters, oscillators, panning, the convolver's normalisation and Chrome's compressor
follow the spec and Chromium. It leaves out the wave shaper's oversampling (a driven sound aliases a little more here),
HRTF panning, and whatever the speakers and the room do. It says nothing about whether a sound is good. Spectrograms
and numbers catch a sound that is thin, harsh, repetitive, clipped, too loud or too quiet; only ears can pass one.
