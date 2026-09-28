import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { atmo } from '../render/atmosphere.js';
import { h, button, card, section, hint, spacer, field, slider, toggle, colorPicker, closeColorPickers, confirmDialog, isDialogOpen } from './kit/index.js';

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
  pointer: true,       // the centre dot (ui/reticle.js)
  debugReports: false, // F8 / middle click copies a bug report (ui/debugReport.js)
};

const DAY_FRAC = DAY_SECONDS / (DAY_SECONDS + NIGHT_SECONDS);

// Phase 0 is sunrise (06:00), DAY_FRAC is sunset (18:00).
function phaseToClock(p) {
  const hours = p < DAY_FRAC ? 6 + (p / DAY_FRAC) * 12 : 18 + ((p - DAY_FRAC) / (1 - DAY_FRAC)) * 12;
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
#settings > .ui-card { width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column; }
#settings .ui-card-content { overflow: auto; flex: 1; min-height: 0; }
#settings .game-row { display: flex; align-items: center; gap: 8px; margin: 4px 0 6px; }
`;

const x2 = (v) => v.toFixed(2);
const times = (v) => v.toFixed(2) + '×';
// The panel, as data: every row is built by the UI kit from its entry. key: a settings value (saved); get/set: a
// live value that isn't a setting (the clock).
const FORM = [
  ['Movement', [
    { key: 'walk', label: 'Walk speed', type: 'slider', min: 0.5, max: 2, step: 0.05, format: times },
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
  ['Time', [
    { key: 'time', label: 'Time of day', type: 'slider', min: 0, max: 0.9999, step: 0.0005, format: phaseToClock, live: true },
    { key: 'pauseCycle', label: 'Pause the day/night cycle', type: 'switch' },
  ]],
  ['Color grading', [
    { key: 'shadows', label: 'Shadows', type: 'color' },
    { key: 'mids', label: 'Midtones', type: 'color' },
    { key: 'highs', label: 'Highlights', type: 'color' },
    { type: 'hint', text: 'Grey is neutral. Push a color to tint that range.' },
    { key: 'blend', label: 'Blend', type: 'slider', min: 0, max: 1, step: 0.01, format: (v) => Math.round(v * 100) + '%' },
    { key: 'balance', label: 'Balance', type: 'slider', min: -1, max: 1, step: 0.01, format: (v) => (v > 0 ? '+' : '') + v.toFixed(2) },
  ]],
  ['Interface', [
    { key: 'pointer', label: 'Pointer', type: 'switch' },
    { key: 'debugReports', label: 'Debug reports', type: 'switch' },
    { type: 'hint', text: 'With debug reports on, F8 or a middle click copies what you are looking at, where you stand and the game state to the clipboard.' },
  ]],
];

// Escape opens and closes the panel. Values apply live and persist in localStorage.
// game: { save() -> bool, restart(), status() -> { text, canSave }, travel(place), places: [[key, label]] }
// (main.js, core/save.js).
export function createSettings({ player, clock, fx, input, canvas, baseSpeed = 1, game = null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const s = load();
  const api = { open: false, values: s, onChange: null };

  const apply = () => {
    player.speedMul = s.walk;
    fx.gamma = s.gamma;
    fx.brightness = s.brightness;
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
    save(s);
    api.onChange?.(s);
  };

  // Live values that aren't settings.
  const live = {
    time: {
      get: () => clock.phase,
      set: (v) => { clock.phase = v; clock.update(0); },
    },
  };
  const read = (f) => (f.live ? live[f.key].get() : s[f.key]);
  const write = (f, v) => { if (f.live) live[f.key].set(v); else { s[f.key] = v; apply(); } };

  // Build every row through the kit.
  const controls = {};
  const make = (f) => {
    if (f.type === 'hint') return hint(f.text);
    const onInput = (v) => write(f, v);
    const c = f.type === 'slider' ? slider({ min: f.min, max: f.max, step: f.step, value: read(f), format: f.format, onInput })
      : f.type === 'switch' ? toggle({ checked: read(f), onChange: onInput })
      : f.type === 'color' ? colorPicker({ value: read(f), neutral: DEFAULTS[f.key], onInput })
      : null;
    controls[f.key] = c;
    return field({ label: f.label, control: c, inline: f.type === 'switch' });
  };

  // The game: save and restart.
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
  // Travel: straight to a place (and back into the game).
  const travelRow = game?.places?.length ? h('div', { class: 'game-row' }, ...game.places.map(([key, label]) =>
    button({ label, variant: 'secondary', size: 'sm', onClick: () => { game.travel(key); close(true); } }))) : null;
  function refreshGame(msg = null) {
    const st = game?.status() ?? { text: '', canSave: false };
    status.textContent = msg ?? st.text;
    saveBtn.disabled = !st.canSave;
  }

  const resetBtn = button({ label: 'Reset settings', variant: 'ghost', onClick: () => { Object.assign(s, DEFAULTS); apply(); sync(); } });
  const resumeBtn = button({ label: 'Resume', onClick: () => close(true) });
  const panel = card({
    title: 'Settings', role: 'dialog', 'aria-label': 'Settings',
    content: [
      game ? section('Game', h('div', { class: 'game-row' }, saveBtn, restartBtn, spacer(), status)) : null,
      travelRow ? section('Travel', travelRow) : null,
      ...FORM.map(([title, fields]) => section(title, ...fields.map(make))),
    ].filter(Boolean),
    footer: [resetBtn, spacer(), resumeBtn],
  });
  const root = h('div', { id: 'settings' }, panel.el);
  document.body.appendChild(root);

  const sync = () => {
    for (const [, fields] of FORM) for (const f of fields) if (controls[f.key]) controls[f.key].set(read(f));
  };

  // Keep the game from seeing clicks meant for the panel.
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  let lastClose = 0;
  function open() {
    if (api.open) return;
    api.open = true;
    sync();
    refreshGame();
    root.classList.add('open');
    input.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function close(relock = false) {
    if (!api.open) return;
    api.open = false;
    lastClose = performance.now();
    closeColorPickers();
    root.classList.remove('open');
    if (relock) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ignore */ } }
  }
  api.toggle = () => (api.open ? close() : open());
  api.openPanel = open;
  api.close = close;

  // While the panel is open, keep the time readout following the running clock.
  api.tick = () => {
    if (!api.open) return;
    const t = controls.time;
    if (!t.active) t.set(clock.phase);
  };

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !input.started || isDialogOpen()) return;
    e.preventDefault();
    api.toggle();
  });
  // Browsers swallow the Escape that releases pointer lock, so treat losing the lock as "open".
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && input.started && !api.open && performance.now() - lastClose > 300 && !api.suppress && !isDialogOpen()) open();
  });

  apply();
  return api;
}
