import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { atmo } from '../render/atmosphere.js';
import { h, button, card, section, hint, spacer, field, slider, toggle, toggleGroup, buttonGroup, navStack, input as textInput, colorPicker, closeColorPickers, confirmDialog, isDialogOpen } from './kit/index.js';
import { checkSas } from '../net/azure.js';
import { gradeTimeline, CSS as TIMELINE_CSS } from './gradeTimeline.js';

const KEY = 'dreambound.settings.v1';
const DEFAULTS = {
  walk: 1,
  headBob: 1,          // how much the view bobs and sways as you walk (player/controller.js bobScale): 1 all, 0 none
  gamma: 1,
  darkLift: false,     // lift the gamma a little at dusk, night and dawn (by the sun's altitude)
  brightness: 1,
  pauseCycle: false,
  shadows: '#808080',
  mids: '#808080',
  highs: '#808080',
  blend: 1,
  balance: 0,
  fogDensity: 1,
  fogLow: 1,
  fogTint: '#808080',
  aa: 'off',           // anti-aliasing: 'off' | 'fxaa' | 'msaa' (render/postfx.js)
  shadowQuality: 'medium', // the sun's shadow map: 'low' | 'medium' | 'high' (render/lighting.js)
  pointer: true,       // the centre dot (ui/reticle.js)
  debugReports: false, // F8 / middle click copies a bug report (ui/debugReport.js)
  profiler: false,     // the stats overlay, top right (ui/profiler.js)
  gradeByTime: false,  // the grade from keys set through the day (gradeKeys), not the one set of tones
  gradeKeys: null,     // [{ t (phase), shadows, mids, highs, blend, balance }]: filled below (warm at noon, cool at midnight)
  gradeIndoors: false, // fade the grade out to neutral indoors
};

// Color grading looks (Menu > Color grading): each sets the whole grade; Clear puts only the grade back to neutral.
// The tones are added to their range at half strength (grade() in render/postfx.js), then mixed in by Blend.
const NEUTRAL_GRADE = { shadows: '#808080', mids: '#808080', highs: '#808080', blend: 1, balance: 0 };
const LOOKS = [
  { id: 'warm', label: 'Warm', shadows: '#8a7a6a', mids: '#a08a6c', highs: '#b89a6c', blend: 0.6, balance: 0 },
  { id: 'cool', label: 'Cool', shadows: '#5c6e9a', mids: '#7084a6', highs: '#889cba', blend: 0.7, balance: 0 },
  { id: 'dusk', label: 'Dusk', shadows: '#4a7290', mids: '#8c7a7c', highs: '#cc9058', blend: 0.7, balance: -0.2 },
];
const GRADE_KEYS = Object.keys(NEUTRAL_GRADE);

const DAY_FRAC = DAY_SECONDS / (DAY_SECONDS + NIGHT_SECONDS);

// Lift the dark hours: how much the gamma rises (x(1 + this)) at full night, and the sun's altitudes (degrees)
// between which it fades in: none while the sun is DARK_FROM above the horizon, all of it by DARK_TO below.
const DARK_LIFT = 0.34;
const DARK_FROM = 10, DARK_TO = -5;
const darkness = (altDeg) => {
  const x = Math.min(1, Math.max(0, (DARK_FROM - altDeg) / (DARK_FROM - DARK_TO)));
  return x * x * (3 - 2 * x);
};

// Phase <-> clock hours (0..24): phase 0 is sunrise (06:00), DAY_FRAC sunset (18:00); day and night run at their own pace.
export const phaseToHours = (p) => (p < DAY_FRAC ? 6 + (p / DAY_FRAC) * 12 : 18 + ((p - DAY_FRAC) / (1 - DAY_FRAC)) * 12) % 24;
export const hoursToPhase = (hr) => {
  const x = (((hr - 6) % 24) + 24) % 24;   // hours since sunrise
  return x < 12 ? (x / 12) * DAY_FRAC : DAY_FRAC + ((x - 12) / 12) * (1 - DAY_FRAC);
};
const lookGrade = (id) => { const { label, id: _id, ...g } = LOOKS.find((l) => l.id === id); return g; };
DEFAULTS.gradeKeys = [{ t: hoursToPhase(12), ...lookGrade('warm') }, { t: hoursToPhase(0), ...lookGrade('cool') }];
const clone = (o) => JSON.parse(JSON.stringify(o));

// The grade at phase p from keys (in any order): between the keys either side of it round the clock, eased.
const hexRGB = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const rgbHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function gradeAt(keys, p) {
  if (!keys?.length) return { ...NEUTRAL_GRADE };
  if (keys.length === 1) return { ...keys[0] };
  const ks = [...keys].sort((a, b) => a.t - b.t);
  let i = ks.findIndex((k) => k.t > p);
  if (i < 0) i = 0;
  const b = ks[i], a = ks[(i - 1 + ks.length) % ks.length];
  const span = (((b.t - a.t) % 1) + 1) % 1 || 1, f = ((((p - a.t) % 1) + 1) % 1) / span;
  const e = f * f * (3 - 2 * f);
  const mix = (x, y) => x + (y - x) * e;
  const out = { blend: mix(a.blend, b.blend), balance: mix(a.balance, b.balance) };
  for (const k of ['shadows', 'mids', 'highs']) { const ca = hexRGB(a[k]), cb = hexRGB(b[k]); out[k] = rgbHex(ca.map((v, j) => mix(v, cb[j]))); }
  return out;
}

// Phase 0 is sunrise (06:00), DAY_FRAC is sunset (18:00).
export function phaseToClock(p) {
  const hours = p < DAY_FRAC ? 6 + (p / DAY_FRAC) * 12 : 18 + ((p - DAY_FRAC) / (1 - DAY_FRAC)) * 12;
  const mins = Math.floor(hours * 60 + 1e-6) % 1440;   // (the epsilon: midnight, 10/13, reads 00:00, not 23:59)
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Bug report sending (Menu > Debug, shown with Debug reports on): kept apart from the settings, under their own key,
// so Reset settings leaves them and a report's settings snapshot never holds the SAS URLs. localStorage is private to
// this origin (scheme, host and port), but any script running on it can read it: use SAS URLs that can only add
// (see net/azure.js).
const DEBUG_KEY = 'dreambound.debug.v1';
const DEBUG_DEFAULTS = { reporter: '', blobSas: '', queueSas: '' };
function loadDebug() {
  try { return { ...DEBUG_DEFAULTS, ...JSON.parse(localStorage.getItem(DEBUG_KEY) || '{}') }; } catch { return { ...DEBUG_DEFAULTS }; }
}
function saveDebug(d) {
  try { localStorage.setItem(DEBUG_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

function load() {
  let v;
  try { v = { ...clone(DEFAULTS), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { v = clone(DEFAULTS); }
  if (!Array.isArray(v.gradeKeys) || !v.gradeKeys.length) v.gradeKeys = clone(DEFAULTS.gradeKeys);
  return v;
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const CSS = `
#settings { position: fixed; inset: 0; display: none; place-items: center; z-index: 10; background: oklch(0.1 0.01 65 / 0.4);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); cursor: default; }
#settings.open { display: grid; }
#settings > .ui-card { width: min(460px, calc(100vw - 32px)); height: min(620px, calc(100vh - 32px)); display: flex; flex-direction: column; }
#settings .ui-card-content { flex: 1; min-height: 0; padding: 0; }
#settings .game-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 4px 0 6px; }
#settings .keys { margin-right: auto; font-size: 12px; color: var(--muted-foreground); white-space: nowrap; }
#settings kbd { font: 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--muted); }
#settings [hidden] { display: none !important; }
#settings .ui-field-panel > .ui-field-note { margin: -1px 0 6px 122px; }
#settings .locked-note { color: oklch(0.8 0.1 75); }
` + TIMELINE_CSS;

const x2 = (v) => v.toFixed(2);
const times = (v) => v.toFixed(2) + '×';
// The menu, as data: groups at the top level, each opening a page of sections of rows, every row built by the UI kit
// from its entry. key: a settings value (saved); live: a value that isn't a setting (the clock). The 'game', 'travel'
// and 'looks' rows are built by hand below.
const GROUPS = [
  { id: 'game', title: 'Game', description: 'Save, load, restart, travel', iconName: 'flag', sections: [
    ['Progress', [{ type: 'game' }]],
    ['Travel', [{ type: 'travel' }, { type: 'endgame' }, { type: 'locked', lock: 'travel' }]],
  ] },
  { id: 'graphics', title: 'Graphics', description: 'Anti-aliasing, shadows, brightness, fog', iconName: 'monitor', sections: [
    ['Anti-aliasing', [
      { key: 'aa', label: 'Mode', type: 'choice', options: [{ value: 'off', label: 'Off' }, { value: 'fxaa', label: 'FXAA' }, { value: 'msaa', label: 'MSAA 4×' }] },
      { type: 'hint', text: 'FXAA smooths every edge cheaply but a little softly. MSAA 4× gives cleaner geometry edges and costs more GPU time.' },
    ]],
    ['Shadows', [
      { key: 'shadowQuality', label: 'Quality', type: 'choice', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { type: 'hint', text: 'The sharpness of the sun and moon\'s shadows round you. High is crisp and costs more GPU memory and time; Low is soft and cheap.' },
    ]],
    ['Image', [
      { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.6, max: 1.8, step: 0.02, format: x2 },
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 0.4, max: 2.2, step: 0.02, format: x2 },
      { key: 'darkLift', label: 'Lift the dark hours', type: 'switch' },
      { type: 'hint', text: 'Raises the gamma a little as the sun goes down and through the night, and lets it fall back at dawn, so the shadows stay readable. It works on top of the Gamma above.' },
    ]],
    ['Fog', [
      { key: 'fogDensity', label: 'Density', type: 'slider', min: 0, max: 4, step: 0.05, format: times },
      { key: 'fogLow', label: 'Low haze', type: 'slider', min: 0, max: 4, step: 0.05, format: times },
      { key: 'fogTint', label: 'Tint', type: 'color' },
      { type: 'hint', text: 'Low haze thickens the air toward the cloud sea. Grey tint is neutral.' },
    ]],
  ] },
  { id: 'grade', title: 'Color grading', description: 'Looks, tones, time of day', iconName: 'palette', sections: [
    ['Looks', [
      { type: 'looks' },
      { type: 'hint', text: 'A look sets every tone below; adjust from there. Clear resets only the color grading. With Time of day on, they edit the selected key.' },
    ]],
    ['Time of day', [
      { key: 'gradeByTime', label: 'Grade by time of day', type: 'switch' },
      { type: 'timeline', showIf: 'gradeByTime' },
      { type: 'hint', text: 'Set a grade at times of day and it blends from one to the next as the day goes round: a warm look at noon and a cool one at midnight, say. Click the strip to add a key, drag a key to move it, and pick one to edit with the looks and tones.' },
    ]],
    ['Tones', [
      { key: 'shadows', label: 'Shadows', type: 'color' },
      { key: 'mids', label: 'Midtones', type: 'color' },
      { key: 'highs', label: 'Highlights', type: 'color' },
      { type: 'hint', text: 'Grey is neutral. Push a color to tint that range.' },
      { key: 'blend', label: 'Blend', type: 'slider', min: 0, max: 1, step: 0.01, format: (v) => Math.round(v * 100) + '%' },
      { key: 'balance', label: 'Balance', type: 'slider', min: -1, max: 1, step: 0.01, format: (v) => (v > 0 ? '+' : '') + v.toFixed(2) },
    ]],
    ['Indoors', [
      { key: 'gradeIndoors', label: 'Neutral indoors', type: 'switch' },
      { type: 'hint', text: 'Fades the grade out inside (the cabin, the observatory, the caves and tunnels, the lounge, the bunker, the mine) and back in when you step outside.' },
    ]],
  ] },
  { id: 'gameplay', title: 'Gameplay', description: 'Walk speed, time of day', iconName: 'footprints', sections: [
    ['Movement', [
      { key: 'walk', label: 'Walk speed', type: 'slider', min: 0.5, max: 2, step: 0.05, format: times },
      { key: 'headBob', label: 'Head bob', type: 'slider', min: 0, max: 1, step: 0.05, format: (v) => (v < 0.025 ? 'Off' : Math.round(v * 100) + '%') },
      { type: 'hint', text: 'How much the view bobs and sways as you walk and run. Lower it for a steadier view; Off holds it level.' },
    ]],
    ['Time', [
      { key: 'time', label: 'Time of day', type: 'slider', min: 0, max: 0.9999, step: 0.0005, format: phaseToClock, live: true },
      { key: 'pauseCycle', label: 'Pause the day/night cycle', type: 'switch' },
      { type: 'locked', lock: 'time' },
    ]],
  ] },
  { id: 'interface', title: 'Interface', description: 'Pointer', iconName: 'pointer', sections: [
    ['Screen', [
      { key: 'pointer', label: 'Pointer', type: 'switch' },
      { type: 'hint', text: 'The dot at the centre of the view. It brightens over anything you can press.' },
    ]],
  ] },
  { id: 'debug', title: 'Debug', description: 'Profiler, debug reports', iconName: 'bug', sections: [
    ['Profiler', [
      { key: 'profiler', label: 'Show profiler', type: 'switch' },
      { type: 'hint', text: 'A panel in the top right corner, always on top: frame rate and frame time with a graph, CPU time, draw calls, triangles, geometries, textures, shader programs, memory, resolution and where you are.' },
    ]],
    ['Reports', [
      { key: 'debugReports', label: 'Debug reports', type: 'switch' },
      { type: 'hint', text: 'With debug reports on, F8 or a middle click takes a screenshot and a snapshot of what you are looking at, where you stand and the game state, and opens a bug report to describe and send.' },
      { key: 'reporter', store: 'debug', label: 'Reporter ID', type: 'text', placeholder: 'Your name or handle', maxLength: 64, showIf: 'debugReports' },
      { key: 'blobSas', store: 'debug', label: 'Blob SAS URL', type: 'secret', sas: 'blob', placeholder: 'https://<account>.blob.core.windows.net/<container>?sv=…', showIf: 'debugReports' },
      { key: 'queueSas', store: 'debug', label: 'Queue SAS URL', type: 'secret', sas: 'queue', placeholder: 'https://<account>.queue.core.windows.net/<queue>?sv=…', showIf: 'debugReports' },
    ]],
  ] },
];

// What a locked control says, under it (shown only while it's locked: lockTime, lockTravel).
const LOCKED = {
  time: 'Midnight holds now: the time of day can\'t be changed.',
  travel: 'There is no way back from here: travel is closed.',
};

// M opens and closes the menu. Escape only frees the mouse (click the view to take it back); inside the menu it steps
// back a page, then closes it. Values apply live and persist in localStorage.
// game: { save() -> bool, load(), hasSave() -> bool, restart(), status() -> { text, canSave }, travel(place),
// places: [[key, label]], endSequence: { label, state() -> { show, ok, why }, run() } } (main.js, core/save.js).
// endSequence is the Travel page's shortcut into the endgame (the stairs reveal), read each time the menu opens. profiler: ui/profiler.js. lighting: render/lighting.js (shadow
// quality). indoors() -> bool: whether the player is inside (the grade's Neutral indoors). Call update(dt) every frame:
// the grade follows the clock and the indoors. lockTime(on) / lockTravel(on): the endgame's locks (the Time slider and
// Pause switch, the Travel buttons), shown disabled with a line saying why.
export function createSettings({ player, clock, fx, input, canvas, baseSpeed = 1, game = null, profiler = null, lighting = null, indoors = () => false }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const s = load();
  const dbg = loadDebug();
  const api = { open: false, values: s, debug: dbg, onChange: null };
  // The endgame's locks (sequences/descent.js): the clock is held at midnight, and there's no travelling back.
  const locked = { time: false, travel: false };

  // Color grading looks: a button each (pressed while the grade is exactly that look), and Clear.
  const same = (a, b) => GRADE_KEYS.every((k) => (typeof b[k] === 'string' ? String(a[k]).toLowerCase() === b[k].toLowerCase() : Math.abs(a[k] - b[k]) < 1e-6));
  // What the looks and tones edit: the one grade, or (by time of day) the selected key.
  let sel = 0;
  const target = () => (s.gradeByTime ? s.gradeKeys[Math.min(sel, s.gradeKeys.length - 1)] : s);
  const setGrade = (g) => { const t = target(); for (const k of GRADE_KEYS) t[k] = g[k]; apply(); sync(); };
  const lookBtns = LOOKS.map((l) => button({ label: l.label, variant: 'outline', size: 'sm', 'aria-pressed': 'false', onClick: () => setGrade(l) }));
  const clearBtn = button({ label: 'Clear', variant: 'ghost', size: 'sm', onClick: () => setGrade(NEUTRAL_GRADE) });
  function markLook() {
    const t = target();
    LOOKS.forEach((l, i) => lookBtns[i].setAttribute('aria-pressed', String(same(t, l))));
    clearBtn.disabled = same(t, NEUTRAL_GRADE);
  }

  // The grade on screen: the tones, or the keys at the time of day; faded to neutral indoors if asked.
  const raw = (c, hex) => { const n = parseInt(hex.slice(1), 16); c.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  let inside = 0;
  // the dark hours' gamma lift, eased so turning it on or off doesn't jump
  let lift = 0;
  function updateLift(dt = 0) {
    const want = s.darkLift ? DARK_LIFT * darkness(clock.altDeg) : 0;
    lift += (want - lift) * (dt > 0 ? 1 - Math.exp(-dt / 0.8) : 1);
    fx.gamma = s.gamma * (1 + lift);
  }
  function updateGrade(dt = 0) {
    const want = s.gradeIndoors && indoors() ? 1 : 0;
    inside += (want - inside) * (dt > 0 ? 1 - Math.exp(-dt / 0.6) : 1);
    let g = s.gradeByTime ? gradeAt(s.gradeKeys, clock.phase) : s;
    if (inside > 0.001) {
      const n = NEUTRAL_GRADE, m = (a, b) => a + (b - a) * inside;
      g = { blend: m(g.blend, n.blend), balance: m(g.balance, n.balance),
        ...Object.fromEntries(['shadows', 'mids', 'highs'].map((k) => [k, rgbHex(hexRGB(g[k]).map((v, j) => m(v, hexRGB(n[k])[j])))])) };
    }
    // Raw display-space values (no color management): #808080 must be exactly 0.5.
    raw(fx.grade.shadows, g.shadows);
    raw(fx.grade.mids, g.mids);
    raw(fx.grade.highs, g.highs);
    fx.grade.blend = g.blend;
    fx.grade.balance = g.balance;
  }

  // The timeline (Time of day): keys through the day, one selected for the looks and tones to edit.
  const timeline = gradeTimeline({
    keys: () => s.gradeKeys,
    selected: () => Math.min(sel, s.gradeKeys.length - 1),
    select: (i) => { sel = i; sync(); },
    add: (t) => { s.gradeKeys.push({ t, ...gradeAt(s.gradeKeys, t) }); sel = s.gradeKeys.length - 1; apply(); sync(); },
    move: (i, t) => { s.gradeKeys[i].t = t; apply(); timeline.refresh(); },
    remove: (i) => { if (s.gradeKeys.length <= 1) return; s.gradeKeys.splice(i, 1); sel = Math.max(0, Math.min(sel, s.gradeKeys.length - 1)); apply(); sync(); },
    phaseToHours, hoursToPhase, clockText: phaseToClock, now: () => clock.phase, dayFrac: DAY_FRAC,
  });

  function apply() {
    player.speedMul = s.walk;
    player.bobScale = s.headBob;
    fx.gamma = s.gamma * (1 + lift);   // the lift itself eases in update()
    fx.brightness = s.brightness;
    if (fx.aa !== s.aa) fx.setAA(s.aa);
    lighting?.setShadowQuality?.(s.shadowQuality);
    updateGrade();
    raw(atmo.uFogTint.value, s.fogTint);
    atmo.uFogTint.value.multiplyScalar(2);
    if (!locked.time) clock.speed = s.pauseCycle ? 0 : baseSpeed;   // (held, the clock ignores its speed anyway)
    profiler?.set(s.profiler);
    save(s);
    markLook();
    for (const [el, key] of shown) el.hidden = !s[key];
    api.onChange?.(s);
  }

  // Live values that aren't settings.
  const live = {
    time: {
      get: () => clock.phase,
      set: (v) => { if (locked.time) return; clock.phase = v; clock.update(0); },
    },
  };
  const tone = (f) => GRADE_KEYS.includes(f.key);
  const read = (f) => (f.live ? live[f.key].get() : f.store === 'debug' ? dbg[f.key] : tone(f) ? target()[f.key] : s[f.key]);
  const write = (f, v) => {
    if (locked.time && (f.key === 'time' || f.key === 'pauseCycle')) { controls[f.key]?.set(read(f)); return; }
    if (f.live) live[f.key].set(v);
    else if (f.store === 'debug') { dbg[f.key] = v.trim(); saveDebug(dbg); }
    else if (tone(f)) { target()[f.key] = v; apply(); timeline.refresh(); }
    else { s[f.key] = v; apply(); if (f.key === 'gradeByTime') sync(); }
  };

  // The game: save and restart, and travel.
  const status = h('span', { class: 'ui-muted' });
  const saveBtn = button({
    label: 'Save', variant: 'secondary', size: 'sm',
    onClick: () => { const ok = game?.save(); refreshGame(ok === false ? 'Could not save (storage unavailable)' : null); },
  });
  const loadBtn = button({
    label: 'Load last save', variant: 'outline', size: 'sm',
    onClick: async () => {
      const yes = await confirmDialog({
        title: 'Load your last save?',
        description: 'You go back to where you last saved. Anything since then is lost.',
        confirmLabel: 'Load save',
      });
      if (yes) game?.load();
    },
  });
  const restartBtn = button({
    label: 'Restart', variant: 'outline', size: 'sm',
    onClick: async () => {
      const yes = await confirmDialog({
        title: 'Start over?',
        description: 'This clears your saved game and wakes you in the cabin again. Settings are kept.',
        confirmLabel: 'Restart', destructive: true,
      });
      if (yes) game?.restart();
    },
  });
  function refreshGame(msg = null) {
    const st = game?.status() ?? { text: '', canSave: false };
    status.textContent = msg ?? st.text;
    saveBtn.disabled = !st.canSave;
    loadBtn.hidden = !game?.hasSave?.();
    if (endRow) {
      const e = game.endSequence?.state() ?? { show: false };
      endRow.el.hidden = !e.show;
      endRow.btn.disabled = !e.ok;
      endRow.note.textContent = e.why ?? '';
    }
  }

  // Build every row through the kit.
  const controls = {};
  const shown = [];   // rows shown only while a setting is on: [element, key]
  const travelBtns = [];
  let endRow = null;   // the endgame shortcut under the Travel buttons (refreshGame shows it, or not)
  const lockNotes = {};   // the line under a locked control, by lock
  const make = (f) => {
    const el = makeRow(f);
    if (f.showIf) shown.push([el, f.showIf]);
    return el;
  };
  // A SAS URL's check, under its field.
  const sasNote = (f, note) => {
    const c = checkSas(read(f), f.sas);
    note.textContent = c.text;
    note.className = 'ui-field-note ' + (c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad');
  };
  const makeRow = (f) => {
    if (f.type === 'hint') return hint(f.text);
    if (f.type === 'text' || f.type === 'secret') {
      const note = f.sas ? h('p', { class: 'ui-field-note' }) : null;
      const c = textInput({
        value: read(f), placeholder: f.placeholder, maxLength: f.maxLength, secret: f.type === 'secret', label: f.label,
        onInput: (v) => { write(f, v); if (note) sasNote(f, note); },
      });
      if (note) { c.panel = note; sasNote(f, note); }
      controls[f.key] = c;
      return field({ label: f.label, control: c });
    }
    if (f.type === 'game') return h('div', { class: 'game-row' }, saveBtn, loadBtn, restartBtn, spacer(), status);
    if (f.type === 'timeline') return timeline.el;
    if (f.type === 'travel') return h('div', { class: 'game-row' }, ...game.places.map(([key, label]) => {
      const b = button({ label, variant: 'secondary', size: 'sm', onClick: () => { if (locked.travel) return; game.travel(key); close(true); } });
      travelBtns.push(b);
      return b;
    }));
    if (f.type === 'endgame') {
      const btn = button({
        label: game.endSequence?.label ?? 'Open the way to End', variant: 'secondary', size: 'sm',
        onClick: () => { if (!game.endSequence?.state().ok) return; game.endSequence.run(); close(true); },
      });
      const note = hint('');
      endRow = { btn, note, el: h('div', {}, h('div', { class: 'game-row' }, btn), note) };
      endRow.el.hidden = true;
      return endRow.el;
    }
    if (f.type === 'locked') {
      const el = hint(LOCKED[f.lock]);
      el.classList.add('locked-note');
      el.hidden = !locked[f.lock];
      lockNotes[f.lock] = el;
      return el;
    }
    if (f.type === 'looks') return h('div', { class: 'game-row' }, buttonGroup(...lookBtns), spacer(), clearBtn);
    const onInput = (v) => write(f, v);
    // Locked, the Time readout is the held clock's own: the slider rounds it to its step, and midnight read 23:59.
    const format = f.key === 'time' ? (v) => f.format(locked.time ? clock.phase : v) : f.format;
    const c = f.type === 'slider' ? slider({ min: f.min, max: f.max, step: f.step, value: read(f), format, onInput })
      : f.type === 'switch' ? toggle({ checked: read(f), onChange: onInput })
      : f.type === 'color' ? colorPicker({ value: read(f), neutral: DEFAULTS[f.key], onInput })
      : f.type === 'choice' ? toggleGroup({ options: f.options, value: read(f), onChange: onInput, label: f.label })
      : null;
    controls[f.key] = c;
    return field({ label: f.label, control: c, inline: f.type === 'switch' || f.type === 'choice' });
  };
  const usable = (f) => !(((f.type === 'game' || f.type === 'endgame') && !game) || (f.type === 'travel' && !game?.places?.length));
  const groups = GROUPS
    .map((g) => ({ ...g, sections: g.sections.filter(([, fields]) => fields.every(usable)) }))
    .filter((g) => g.sections.length);
  const pages = groups.map((g) => ({ ...g, content: () => g.sections.map(([title, fields]) => section(title, ...fields.map(make))) }));
  const nav = navStack({ root: { title: 'Menu' }, pages });
  // Build every page up front: sync() needs their controls, and nothing gets built mid-game.
  for (const p of pages) nav.open(p.id);
  nav.reset();

  const resetBtn = button({ label: 'Reset settings', variant: 'ghost', onClick: () => { Object.assign(s, clone(DEFAULTS)); sel = 0; apply(); sync(); } });
  const resumeBtn = button({ label: 'Resume', onClick: () => close(true) });
  const keys = h('span', { class: 'keys' }, h('kbd', {}, 'M'), ' menu · ', h('kbd', {}, 'Esc'), ' back');
  const panel = card({ role: 'dialog', 'aria-label': 'Menu', content: [nav.el], footer: [resetBtn, keys, resumeBtn] });
  const root = h('div', { id: 'settings' }, panel.el);
  document.body.appendChild(root);

  function sync() {
    for (const g of groups) for (const [, fields] of g.sections) for (const f of fields) if (controls[f.key]) controls[f.key].set(read(f));
    markLook();
    timeline.refresh();
    for (const [el, key] of shown) el.hidden = !s[key];
  }

  // Keep the game from seeing clicks meant for the panel; a click on the backdrop, outside the card, resumes.
  root.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.target === root) close(true); });

  function open() {
    if (api.open) return;
    api.open = true;
    nav.reset();
    sync();
    refreshGame();
    root.classList.add('open');
    input.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    root.querySelector('.ui-item')?.focus({ preventScroll: true });
  }
  function close(relock = false) {
    if (!api.open) return;
    api.open = false;
    closeColorPickers();
    root.classList.remove('open');
    if (relock) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ignore */ } }
  }
  api.toggle = () => (api.open ? close(true) : open());
  // Open the menu on one group's page (the bug report dialog's "Open Debug settings").
  api.openPage = (id) => { open(); nav.open(id); };
  api.openPanel = open;
  api.close = close;

  // The endgame's locks. Time: the Time of day slider and the Pause switch are disabled, their writes ignored, and the
  // clock's speed is left alone (a held clock, core/time.js holdAt, ignores it too); unlocked, the speed is the
  // settings' again. Travel: the Travel buttons are disabled.
  const setLock = (which, on) => {
    on = !!on;
    if (locked[which] === on) return;
    locked[which] = on;
    if (lockNotes[which]) lockNotes[which].hidden = !on;
    if (which === 'time') {
      for (const k of ['time', 'pauseCycle']) if (controls[k]) controls[k].el.disabled = on;
      controls.time?.set(clock.phase);   // (its readout: see format above)
      if (!on) clock.speed = s.pauseCycle ? 0 : baseSpeed;
    } else {
      for (const b of travelBtns) b.disabled = on;
    }
  };
  api.lockTime = (on) => setLock('time', on);
  api.lockTravel = (on) => setLock('travel', on);
  Object.defineProperty(api, 'timeLocked', { get: () => locked.time });
  Object.defineProperty(api, 'travelLocked', { get: () => locked.travel });

  // While the panel is open, keep the time readout and the timeline's needle following the running clock.
  api.tick = () => {
    if (!api.open) return;
    const t = controls.time;
    if (t && !t.active) t.set(clock.phase);
    if (s.gradeByTime) timeline.refresh();
  };
  // Every frame: the grade by time of day, and its fade indoors.
  api.update = (dt) => {
    if (s.gradeByTime || s.gradeIndoors || inside > 0.001) updateGrade(dt);
    if (s.darkLift || lift > 0.0001) updateLift(dt);
  };

  const typing = (el) => !!el && ((el.tagName === 'INPUT' && el.type !== 'range') || el.tagName === 'TEXTAREA' || el.isContentEditable);
  addEventListener('keydown', (e) => {
    if (!input.started || isDialogOpen() || e.repeat) return;
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(document.activeElement)) {
      e.preventDefault();
      api.toggle();
    } else if (e.code === 'Escape' && api.open) {
      e.preventDefault();
      if (nav.depth > 0) nav.back(); else close();
    }
  });

  apply();
  return api;
}
