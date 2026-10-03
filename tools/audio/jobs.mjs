// Named renders for render.mjs (`node tools/audio/render.mjs door_open thunder_*`), and the option sets check.mjs
// tries on top of every sound's defaults. Add one when a sound is reworked, so the next rework has its "before", and
// put it in the GROUPS (below the jobs) it is heard with.
//
// A job's name is not always the name the game plays (`door_close` plays doorClose, `bell` plays alarm, `alarm_*`
// play buzzAlarm): `render.mjs --list` shows what each plays, and `--list doorClose` finds the jobs for a sound.
//
// The listener stands at the origin looking down -Z (x: to the right, y: up); positions are [x, y, z] in metres.
// A job:
//   about     what it is, in a line (--list prints it)
//   seconds   how long to render: a one-shot's WAV is then trimmed to the sound, so leave its reverb room (3 s)
//   skip      seconds rendered first and thrown away while the beds ease in; the job's times count from after it
//   env       given: the engine's update() runs every block with this environment (on top of render.mjs's ENV: the
//             surface, the sun at 30 degrees), so the wind, birds, crickets and emitters sound; without it only
//             what the job plays is heard
//   storm     setStorm(level), already raging when the render starts
//   rise      the sun's climb in degrees a second (the dawn chorus wants it rising)
//   emitters  [[name, [x, y, z]], ...]: registerEmitter(name, pos, the env's zone) before start()
//   mute      the engine's buses to silence, by property name (['cricketBus', 'windGain'])
//   taps      the engine's nodes to measure on their own, by property name (--taps writes their WAVs too)
//   shots     [[t, name, opts], ...]: play(name, opts) at t seconds; a handle it returns is kept for `calls`
//   loops     [[t, name, opts], ...]: loop(name, opts), likewise
//   calls     [[t, method, ...args], ...]: called on the last handle returned (setDry, set, stop ...)
//   enclose   [[t, on], ...]: setEnclosed(), an elevator's doors shutting round the listener
//   run(A, c) anything else, at 0: c.at(t, fn) to do something later, c.every(fn(t)) each block, c.V(x, y, z) a
//             vector, c.env the live environment, c.tap(name, node) one more tap, c.note(text or () => text) a line
//             printed under the job's levels
// Times and durations are the callers' (props/elevator.js DOOR_TIME 1.7, RIDE 8; sequences/ending.js; props/gatehouse.js
// DOOR_CLOSE 5.5; sequences/stairsReveal.js DOOR_TIME 2.4): keep them true if those change.
const NIGHT = { altDeg: -40 };
const AHEAD = [0, 0, -3];             // 3 m in front: where a door is heard from (the elevator doors' reference distance)
const HAND = [0, -0.2, -0.6];         // a button or a key under the hand
const CAR = [0.2, -0.3, 0.9];         // an elevator car's sound position from where its rider stands
const HATCH = [-6, -3, -22];          // the gatehouse's hatch from the rim

const thunder = (distance, pan, seconds) => ({ about: `thunder ${distance} m off`, seconds, shots: [[0.1, 'thunder', { distance, pan }]] });
// Says which birds sang: when each began (s), its kind, and how far off its perch is.
const watchBirds = (A, c) => {
  const seen = new Set(), log = [];
  c.every((t) => { for (const s of A.singers || []) if (!seen.has(s)) { seen.add(s); log.push(`${Math.max(0, t).toFixed(0)}s ${s.kind.name} ${Math.round(s.pos.length())}m`); } });
  c.note(() => log.length && 'singers: ' + log.join(', '));
};
const birds = (about, env, extra = {}) => ({ about, seconds: 40, skip: 5, env, taps: ['birdBus', 'windGain'], run: watchBirds, ...extra });
// sequences/ending.js: the alarm starts at 10.4 s; +5.5 setDry(0.5, 1.5); +8 setWet(0, 0.4), setDry(1, 0.3); +9 stop.
const ENDING_ALARM = { shots: [[0, 'buzzAlarm', { level: 0.5 }]], calls: [[5.5, 'setDry', 0.5, 1.5], [8, 'setWet', 0, 0.4], [8, 'setDry', 1, 0.3], [9, 'stop', 0.05]] };

export const JOBS = {
  // ---- the storm: rain, thunder by distance
  rain: { about: 'heavy rain alone (no wind, no howl)', seconds: 12, skip: 6, env: NIGHT, storm: 1, mute: ['cricketBus', 'windGain', 'howl'], taps: ['rainOut'] },
  storm: { about: 'the whole storm bed: rain, wind and its howl', seconds: 12, skip: 6, env: NIGHT, storm: 1, mute: ['cricketBus'], taps: ['windGain', 'rainOut', 'howl'] },
  thunder_near: thunder(150, -0.5, 12),
  thunder_300: thunder(300, 0.4, 12),
  thunder_mid: thunder(1500, 0.5, 18),
  thunder_far: thunder(6000, -0.3, 26),
  thunder_12km: thunder(12000, 0.2, 32),
  storm_mix: { about: 'the storm with five strikes from 180 m to 9 km', seconds: 35, skip: 6, env: NIGHT, storm: 1, mute: ['cricketBus'], taps: ['stormBus', 'thunderBus'],
    shots: [[1.5, 'thunder', { distance: 4000, pan: 0.5 }], [8, 'thunder', { distance: 180, pan: -0.5 }], [15, 'thunder', { distance: 9000, pan: -0.2 }],
      [21, 'thunder', { distance: 1200, pan: 0.6 }], [28.5, 'thunder', { distance: 350, pan: 0.2 }]] },

  // ---- the ending's alarm clock (a handle: setWet, setDry, stop)
  alarm_wet: { about: 'the buzzer as it starts: faint, drowned in the dream reverb', seconds: 6, shots: [[0, 'buzzAlarm', { level: 0.5 }]] },
  alarm_dry: { about: 'the buzzer brought up dry and present', seconds: 6, shots: [[0, 'buzzAlarm', { level: 0.5 }]], calls: [[0, 'setWet', 0, 0.01], [0, 'setDry', 1, 0.01]] },
  alarm_ending: { about: 'the buzzer as the ending plays it, from dream to awake to cut', seconds: 10.5, ...ENDING_ALARM },
  alarm_ending_storm: { about: 'the same over the full storm', seconds: 10.5, skip: 6, env: NIGHT, storm: 1, mute: ['cricketBus'], ...ENDING_ALARM },

  // ---- the elevator's doors
  door_open: { about: 'elevator doors opening, 3 m ahead', seconds: 4.5, shots: [[0.3, 'doorOpen', { pos: AHEAD, dur: 1.7 }]] },
  door_close: { about: 'elevator doors closing, 3 m ahead', seconds: 4.5, shots: [[0.3, 'doorClose', { pos: AHEAD, dur: 1.7 }]] },
  door_open_car: { about: 'doors opening, heard from inside the car', seconds: 4.5, shots: [[0.3, 'doorOpen', { pos: CAR, car: true, dur: 1.7 }]] },
  door_close_car: { about: 'doors closing, heard from inside the car', seconds: 4.5, shots: [[0.3, 'doorClose', { pos: CAR, car: true, dur: 1.7 }]] },
  door_close_ride: { about: 'a rider: doors close, the world fades, the ride starts', seconds: 11.5,
    shots: [[0.3, 'doorClose', { pos: CAR, car: true, dur: 1.7 }], [2.2, 'elevatorRide', { pos: CAR, duration: 8, attached: true, car: true }]], enclose: [[1.66, true]] },

  // ---- birdsong (ambience: needs update())
  birds: birds('daytime birdsong over the wind (sun at 30 deg)', { altDeg: 30 }),
  birds_dawn: birds('the dawn chorus (sun at 4 deg, climbing)', { altDeg: 4 }, { rise: 0.004 }),
  birds_dusk: birds('dusk (sun at 1 deg)', { altDeg: 1 }),
  birds_species: { about: 'each kind of bird in turn, two phrases from one perch 13-25 m off, no wind', seconds: 56, env: { altDeg: 30 }, mute: ['windGain', 'dayBugs'], taps: ['birdBus'],
    run: (A, c) => {
      if (!A.singers || !A.birdPhrase) return;       // (an engine from before the species: nothing to pick from)
      A.birdTimer = 1e9;
      const kinds = [];
      for (let k = 0; k < 400 && kinds.length < 12; k++) {
        A.bird(c.env.ground, 1);
        for (const s of A.singers) { if (!kinds.includes(s.kind.name)) kinds.push(s.kind.name); s.out.disconnect(); }
        A.singers.length = 0;
      }
      kinds.sort().forEach((name, i) => c.at(0.3 + i * 8, () => {
        let s;
        for (let k = 0; k < 4000; k++) {
          for (const x of A.singers) x.out.disconnect();
          A.singers.length = 0;
          A.bird(c.env.ground, 1);
          s = A.singers[0];
          if (s.kind.name === name && s.far > 0.1 && s.far < 0.35 && A.singers.length === 1) break;
        }
        s.left = 1e6; s.next = Infinity;             // (its first phrase is on its way; the second by hand)
        c.at(0.3 + i * 8 + 4, () => { A.birdPhrase(s, A.now()); s.next = Infinity; });
        A.birdTimer = 1e9;
      }));
    } },

  // ---- the endgame's one-shots
  noPower: { about: 'the dead terminal: click and low-battery blip', seconds: 3, shots: [[0.1, 'noPower', { pos: HAND }]] },
  coords: { about: 'the coordinates desk: detect, nine ticks, valid', seconds: 8.5,
    shots: [[0.1, 'coordsBeep', { pos: HAND, kind: 'detect' }], ...Array.from({ length: 9 }, (_, k) => [1.3 + k * 0.38, 'coordsBeep', { pos: HAND, kind: 'tick' }]), [5.1, 'coordsBeep', { pos: HAND, kind: 'valid' }]] },
  hatchUnlock: { about: 'the gatehouse hatch unlocking, 23 m off', seconds: 6.5, shots: [[0.1, 'hatchUnlock', { pos: HATCH }]] },
  hatchSlide: { about: 'the hatch sliding open (2.4 s)', seconds: 6, shots: [[0.1, 'hatchSlide', { pos: HATCH, duration: 2.4, open: true }]] },
  hatchClose: { about: 'the gatehouse door closing behind the player (5.5 s)', seconds: 10, shots: [[0.1, 'hatchSlide', { pos: [0, 1, 6], duration: 5.5, open: false }]] },
  stairExtend: { about: 'the stairs running out, 14 sections', seconds: 9, shots: Array.from({ length: 14 }, (_, k) => [0.1 + k * 0.4, 'stairExtend', { pos: [-4 + k * 0.8, -3 - k * 1.2, -20 + k * 0.5] }]) },
  stairFall: { about: 'a stair section breaking away', seconds: 7, shots: [[0.1, 'stairFall', { pos: [1, 0.5, 4] }]] },
  pedestalButton: { about: 'the pedestal button', seconds: 3, shots: [[0.1, 'pedestalButton', { pos: [0, -0.2, -0.7] }]] },
  pedestalSink: { about: 'the pedestal sinking (2.6 s)', seconds: 6.5, shots: [[0.1, 'pedestalSink', { pos: [0, -0.5, -1.2], duration: 2.6 }]] },
  shaftSwell: { about: 'the light shafts rising (6 s swell)', seconds: 12, shots: [[0.1, 'shaftSwell', { duration: 6 }]] },

  // ---- references: the neighbours a new sound's level is set against
  click: { about: 'a button click under the hand', seconds: 2, shots: [[0.1, 'click', { pos: HAND }]] },
  switch: { about: 'a switch', seconds: 2, shots: [[0.1, 'switch', { pos: HAND }]] },
  keyEnter: { about: 'the terminal Enter key', seconds: 2, shots: [[0.1, 'keyEnter', { pos: [0, -0.3, -0.6] }]] },
  drawer: { about: 'a filing drawer, 2 m off', seconds: 3, shots: [[0.1, 'drawer', { pos: [0, 0, -2], open: true, dur: 0.55 }]] },
  hinge: { about: 'a hinged door closing, 3 m ahead', seconds: 4, shots: [[0.1, 'hingeClose', { pos: AHEAD }]] },
  bookcase: { about: 'the secret bookcase swinging (4.4 s)', seconds: 8, shots: [[0.1, 'bookcase', { pos: [2, 0, -3], swing: 4.4 }]] },
  crtOn: { about: 'the CRT switching on', seconds: 5, shots: [[0.1, 'crtOn', { pos: [0, 0, -0.7] }]] },
  rockLand: { about: 'a boulder landing 8.5 m off', seconds: 4, shots: [[0.1, 'rockLand', { pos: [3, 0, -8], size: 1 }]] },
  explosion: { about: 'the Tor blast from 41 m', seconds: 9, shots: [[0.1, 'explosion', { pos: [10, 0, -40] }]] },
  explosion_feed: { about: 'the blast through the camera feed', seconds: 8, shots: [[0.1, 'explosion', { feed: true }]] },
  elevatorRide: { about: 'the elevator ride, heard from the landing', seconds: 11, shots: [[0.3, 'elevatorRide', { pos: AHEAD, duration: 8 }]] },
  elevatorRide_car: { about: 'the ride, from inside the car', seconds: 11, shots: [[0.3, 'elevatorRide', { pos: CAR, duration: 8, attached: true, car: true }]] },
  rumble: { about: 'the ground rumble (4 s)', seconds: 6.5, shots: [[0.1, 'rumble', { duration: 4, peak: 0.6 }]] },
  grind: { about: 'the iris grinding (2.6 s)', seconds: 5.5, shots: [[0.1, 'grind', { duration: 2.6 }]] },
  steam: { about: 'the steam burst (6 s)', seconds: 9, shots: [[0.1, 'steam', { duration: 6 }]] },
  bell: { about: 'the old twin-bell alarm (7 s)', seconds: 9.5, shots: [[0.1, 'alarm', { duration: 7 }]] },
  scrape: { about: 'a rock dragged, 3 m ahead (a loop: stopped at 3 s)', seconds: 5.5, loops: [[0.1, 'scrape', { pos: AHEAD }]], calls: [[3, 'stop']] },
  wind: { about: 'the wind alone, a calm night', seconds: 12, skip: 3, env: NIGHT, mute: ['cricketBus'], taps: ['windGain'] },
  night: { about: 'night ambience: wind and crickets', seconds: 20, skip: 5, env: NIGHT, taps: ['windGain', 'cricketBus'] },
  day: { about: 'daytime ambience: wind, birds, insects', seconds: 20, skip: 5, env: { altDeg: 30 }, taps: ['windGain', 'birdBus', 'dayBugs'], run: watchBirds },
  fire: { about: 'the hearth fire from 2.5 m, indoors', seconds: 15, skip: 3, env: { altDeg: 30, indoor: true }, emitters: [['fire', [0.5, -0.8, -2.4]]], mute: ['windGain', 'dayBugs', 'birdBus'] },
};

// Jobs heard in the same place or the same scene: a sound's level is set against the others in its group.
// `render.mjs --list` prints them and `--group hand` renders one. A job may be in several, or in none.
export const GROUPS = {
  hand: { about: "at arm's length: buttons, keys, the terminal", jobs: ['click', 'switch', 'keyEnter', 'noPower', 'coords', 'crtOn', 'pedestalButton'] },
  doors: { about: 'a few metres off: the elevator from its landing, doors, furniture', jobs: ['door_open', 'door_close', 'elevatorRide', 'hinge', 'drawer', 'bookcase'] },
  car: { about: 'inside the elevator car', jobs: ['door_open_car', 'door_close_car', 'elevatorRide_car', 'door_close_ride'] },
  storm: { about: 'the storm: its bed, and thunder by distance', jobs: ['rain', 'storm', 'thunder_near', 'thunder_300', 'thunder_mid', 'thunder_far', 'thunder_12km', 'storm_mix'] },
  gatehouse: { about: 'the stairs reveal and the gatehouse', jobs: ['rumble', 'hatchUnlock', 'hatchSlide', 'hatchClose', 'stairExtend', 'stairFall'] },
  ending: { about: 'the ending, in its order', jobs: ['pedestalButton', 'pedestalSink', 'rumble', 'grind', 'shaftSwell', 'alarm_ending', 'alarm_ending_storm'] },
  beds: { about: 'what is always there: wind, insects, birds, a fire', jobs: ['wind', 'night', 'day', 'birds', 'birds_dawn', 'birds_dusk', 'fire'] },
  loud: { about: 'the loudest things in the game: a ceiling for anything new', jobs: ['thunder_near', 'explosion', 'elevatorRide', 'rockLand'] },
};

// More option sets for check.mjs to try (not rendered): the branches a job above doesn't reach.
export const OPTIONS = {
  step: ['grass', 'dirt', 'gravel', 'rock', 'wood', 'ladder', 'metal', 'cave'].map((surface) => ({ surface, run: surface === 'gravel' })),
  thunder: [{ distance: 60 }, { distance: 100, pan: -1 }, { distance: 600 }, { distance: 3000 }, { distance: 20000, pan: 1 }, { near: 1 }, { near: 0 }, { distance: NaN }],
  breaker: [{ pos: HAND, on: false }, { pos: HAND, on: true }],
  drawer: [{ pos: AHEAD, open: false, dur: 0.2 }],
  hatchSlide: [{ pos: HATCH, duration: 0.2 }],
  pedestalSink: [{ pos: AHEAD, duration: 0.2 }],
  coordsBeep: [{ pos: HAND }, { pos: HAND, kind: 'nonsense' }],
  key: [{ pos: HAND }, { pos: HAND, space: true, vel: 1.3 }, { pos: HAND, vel: 0 }],
  glitch: [{ pos: HAND, dur: 0.3, amt: 1 }, { dur: 2.5, amt: 0 }],
  doorOpen: [{ pos: AHEAD, dur: 2.5 }],
  doorClose: [{ pos: AHEAD, dur: 2.5 }],
  elevatorRide: [{ pos: AHEAD, duration: 6 }],
  elevatorDistant: [{ pos: AHEAD, duration: 8 }],
  buzzAlarm: [{ level: 0 }],
};
