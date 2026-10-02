import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { atmo } from '../render/atmosphere.js';
import { h, button, card, section, hint, spacer, field, slider, toggle, toggleGroup, buttonGroup, navStack, input as textInput, colorPicker, closeColorPickers, confirmDialog, isDialogOpen } from './kit/index.js';
import { checkSas } from '../net/azure.js';

const KEY = 'dreambound.settings.v1';
const DEFAULTS = {
  walk: 1,
  gamma: 1,
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
  pointer: true,       // the centre dot (ui/reticle.js)
  debugReports: false, // F8 / middle click copies a bug report (ui/debugReport.js)
  profiler: false,     // the stats overlay, top right (ui/profiler.js)
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

// Phase 0 is sunrise (06:00), DAY_FRAC is sunset (18:00).
export function phaseToClock(p) {
  const hours = p < DAY_FRAC ? 6 + (p / DAY_FRAC) * 12 : 18 + ((p - DAY_FRAC) / (1 - DAY_FRAC)) * 12;
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
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
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
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
`;

const x2 = (v) => v.toFixed(2);
const times = (v) => v.toFixed(2) + '×';
// The menu, as data: groups at the top level, each opening a page of sections of rows, every row built by the UI kit
// from its entry. key: a settings value (saved); live: a value that isn't a setting (the clock). The 'game', 'travel'
// and 'looks' rows are built by hand below.
const GROUPS = [
  { id: 'game', title: 'Game', description: 'Save, restart, travel', iconName: 'flag', sections: [
    ['Progress', [{ type: 'game' }]],
    ['Travel', [{ type: 'travel' }]],
  ] },
  { id: 'graphics', title: 'Graphics', description: 'Anti-aliasing, brightness, fog', iconName: 'monitor', sections: [
    ['Anti-aliasing', [
      { key: 'aa', label: 'Mode', type: 'choice', options: [{ value: 'off', label: 'Off' }, { value: 'fxaa', label: 'FXAA' }, { value: 'msaa', label: 'MSAA 4×' }] },
      { type: 'hint', text: 'FXAA smooths every edge cheaply but a little softly. MSAA 4× gives cleaner geometry edges and costs more GPU time.' },
    ]],
    ['Image', [
      { key: 'gamma', label: 'Gamma', type: 'slider', min: 0.6, max: 1.8, step: 0.02, format: x2 },
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 0.4, max: 2.2, step: 0.02, format: x2 },
    ]],
    ['Fog', [
      { key: 'fogDensity', label: 'Density', type: 'slider', min: 0, max: 4, step: 0.05, format: times },
      { key: 'fogLow', label: 'Low haze', type: 'slider', min: 0, max: 4, step: 0.05, format: times },
      { key: 'fogTint', label: 'Tint', type: 'color' },
      { type: 'hint', text: 'Low haze thickens the air toward the cloud sea. Grey tint is neutral.' },
    ]],
  ] },
  { id: 'grade', title: 'Color grading', description: 'Looks, tones, blend', iconName: 'palette', sections: [
    ['Looks', [
      { type: 'looks' },
      { type: 'hint', text: 'A look sets every tone below; adjust from there. Clear resets only the color grading.' },
    ]],
    ['Tones', [
      { key: 'shadows', label: 'Shadows', type: 'color' },
      { key: 'mids', label: 'Midtones', type: 'color' },
      { key: 'highs', label: 'Highlights', type: 'color' },
      { type: 'hint', text: 'Grey is neutral. Push a color to tint that range.' },
      { key: 'blend', label: 'Blend', type: 'slider', min: 0, max: 1, step: 0.01, format: (v) => Math.round(v * 100) + '%' },
      { key: 'balance', label: 'Balance', type: 'slider', min: -1, max: 1, step: 0.01, format: (v) => (v > 0 ? '+' : '') + v.toFixed(2) },
    ]],
  ] },
  { id: 'gameplay', title: 'Gameplay', description: 'Walk speed, time of day', iconName: 'footprints', sections: [
    ['Movement', [
      { key: 'walk', label: 'Walk speed', type: 'slider', min: 0.5, max: 2, step: 0.05, format: times },
    ]],
    ['Time', [
      { key: 'time', label: 'Time of day', type: 'slider', min: 0, max: 0.9999, step: 0.0005, format: phaseToClock, live: true },
      { key: 'pauseCycle', label: 'Pause the day/night cycle', type: 'switch' },
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

// M opens and closes the menu. Escape only frees the mouse (click the view to take it back); inside the menu it steps
// back a page, then closes it. Values apply live and persist in localStorage.
// game: { save() -> bool, restart(), status() -> { text, canSave }, travel(place), places: [[key, label]] }
// (main.js, core/save.js). profiler: ui/profiler.js.
export function createSettings({ player, clock, fx, input, canvas, baseSpeed = 1, game = null, profiler = null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const s = load();
  const dbg = loadDebug();
  const api = { open: false, values: s, debug: dbg, onChange: null };

  // Color grading looks: a button each (pressed while the grade is exactly that look), and Clear.
  const same = (a, b) => GRADE_KEYS.every((k) => (typeof b[k] === 'string' ? String(a[k]).toLowerCase() === b[k].toLowerCase() : Math.abs(a[k] - b[k]) < 1e-6));
  const setGrade = (g) => { for (const k of GRADE_KEYS) s[k] = g[k]; apply(); sync(); };
  const lookBtns = LOOKS.map((l) => button({ label: l.label, variant: 'outline', size: 'sm', 'aria-pressed': 'false', onClick: () => setGrade(l) }));
  const clearBtn = button({ label: 'Clear', variant: 'ghost', size: 'sm', onClick: () => setGrade(NEUTRAL_GRADE) });
  function markLook() {
    LOOKS.forEach((l, i) => lookBtns[i].setAttribute('aria-pressed', String(same(s, l))));
    clearBtn.disabled = same(s, NEUTRAL_GRADE);
  }

  function apply() {
    player.speedMul = s.walk;
    fx.gamma = s.gamma;
    fx.brightness = s.brightness;
    if (fx.aa !== s.aa) fx.setAA(s.aa);
    // Raw display-space values (no color management): #808080 must be exactly 0.5.
    const raw = (c, hex) => { const n = parseInt(hex.slice(1), 16); c.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
    raw(fx.grade.shadows, s.shadows);
    raw(fx.grade.mids, s.mids);
    raw(fx.grade.highs, s.highs);
    raw(atmo.uFogTint.value, s.fogTint);
    atmo.uFogTint.value.multiplyScalar(2);
    fx.grade.blend = s.blend;
    fx.grade.balance = s.balance;
    clock.speed = s.pauseCycle ? 0 : baseSpeed;
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
      set: (v) => { clock.phase = v; clock.update(0); },
    },
  };
  const read = (f) => (f.live ? live[f.key].get() : f.store === 'debug' ? dbg[f.key] : s[f.key]);
  const write = (f, v) => {
    if (f.live) live[f.key].set(v);
    else if (f.store === 'debug') { dbg[f.key] = v.trim(); saveDebug(dbg); }
    else { s[f.key] = v; apply(); }
  };

  // The game: save and restart, and travel.
  const status = h('span', { class: 'ui-muted' });
  const saveBtn = button({
    label: 'Save', variant: 'secondary', size: 'sm',
    onClick: () => { const ok = game?.save(); refreshGame(ok === false ? 'Could not save (storage unavailable)' : null); },
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
  }

  // Build every row through the kit.
  const controls = {};
  const shown = [];   // rows shown only while a setting is on: [element, key]
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
    if (f.type === 'game') return h('div', { class: 'game-row' }, saveBtn, restartBtn, spacer(), status);
    if (f.type === 'travel') return h('div', { class: 'game-row' }, ...game.places.map(([key, label]) =>
      button({ label, variant: 'secondary', size: 'sm', onClick: () => { game.travel(key); close(true); } })));
    if (f.type === 'looks') return h('div', { class: 'game-row' }, buttonGroup(...lookBtns), spacer(), clearBtn);
    const onInput = (v) => write(f, v);
    const c = f.type === 'slider' ? slider({ min: f.min, max: f.max, step: f.step, value: read(f), format: f.format, onInput })
      : f.type === 'switch' ? toggle({ checked: read(f), onChange: onInput })
      : f.type === 'color' ? colorPicker({ value: read(f), neutral: DEFAULTS[f.key], onInput })
      : f.type === 'choice' ? toggleGroup({ options: f.options, value: read(f), onChange: onInput, label: f.label })
      : null;
    controls[f.key] = c;
    return field({ label: f.label, control: c, inline: f.type === 'switch' || f.type === 'choice' });
  };
  const usable = (f) => !((f.type === 'game' && !game) || (f.type === 'travel' && !game?.places?.length));
  const groups = GROUPS
    .map((g) => ({ ...g, sections: g.sections.filter(([, fields]) => fields.every(usable)) }))
    .filter((g) => g.sections.length);
  const pages = groups.map((g) => ({ ...g, content: () => g.sections.map(([title, fields]) => section(title, ...fields.map(make))) }));
  const nav = navStack({ root: { title: 'Menu' }, pages });
  // Build every page up front: sync() needs their controls, and nothing gets built mid-game.
  for (const p of pages) nav.open(p.id);
  nav.reset();

  const resetBtn = button({ label: 'Reset settings', variant: 'ghost', onClick: () => { Object.assign(s, DEFAULTS); apply(); sync(); } });
  const resumeBtn = button({ label: 'Resume', onClick: () => close(true) });
  const keys = h('span', { class: 'keys' }, h('kbd', {}, 'M'), ' menu · ', h('kbd', {}, 'Esc'), ' back');
  const panel = card({ role: 'dialog', 'aria-label': 'Menu', content: [nav.el], footer: [resetBtn, keys, resumeBtn] });
  const root = h('div', { id: 'settings' }, panel.el);
  document.body.appendChild(root);

  function sync() {
    for (const g of groups) for (const [, fields] of g.sections) for (const f of fields) if (controls[f.key]) controls[f.key].set(read(f));
    markLook();
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

  // While the panel is open, keep the time readout following the running clock.
  api.tick = () => {
    if (!api.open) return;
    const t = controls.time;
    if (t && !t.active) t.set(clock.phase);
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
