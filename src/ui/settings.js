import { DAY_SECONDS, NIGHT_SECONDS } from '../config.js';
import { atmo } from '../render/atmosphere.js';

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
#settings { position: fixed; inset: 0; display: none; place-items: center; background: rgba(4, 6, 10, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); cursor: default; z-index: 10;
  font: 14px/1.4 Georgia, 'Times New Roman', serif; color: #e9e2d2; }
#settings.open { display: grid; }
#settings .card { width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 22px 26px 18px;
  background: rgba(18, 20, 26, 0.82); border: 1px solid rgba(233, 226, 210, 0.16); border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
#settings h2 { margin: 0 0 14px; font-weight: normal; font-size: 20px; letter-spacing: 0.08em; }
#settings h3 { margin: 16px 0 6px; font-weight: normal; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #b9ad94; }
#settings .row { display: grid; grid-template-columns: 110px 1fr 48px; align-items: center; gap: 10px; margin: 7px 0; }
#settings .row output { text-align: right; font-variant-numeric: tabular-nums; color: #cfc6b3; font-size: 13px; }
#settings input[type=range] { width: 100%; accent-color: #d9b779; }
#settings input[type=color] { width: 100%; height: 26px; border: 1px solid rgba(233, 226, 210, 0.2); border-radius: 4px; background: none; padding: 0; }
#settings .check { display: flex; align-items: center; gap: 8px; margin: 8px 0 0 0; }
#settings .check input { accent-color: #d9b779; }
#settings .hint { font-size: 12px; color: #9a927f; margin: 2px 0 0; }
#settings .buttons { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
#settings button { font: inherit; color: #e9e2d2; background: rgba(233, 226, 210, 0.08); border: 1px solid rgba(233, 226, 210, 0.2);
  border-radius: 6px; padding: 6px 14px; cursor: pointer; }
#settings button:hover { background: rgba(233, 226, 210, 0.16); }
#settings button.primary { background: rgba(217, 183, 121, 0.22); border-color: rgba(217, 183, 121, 0.5); }
`;

const HTML = `
<div class="card" role="dialog" aria-label="Settings">
  <h2>Settings</h2>
  <h3>Movement</h3>
  <div class="row"><label for="s-walk">Walk speed</label><input id="s-walk" type="range" min="0.5" max="2" step="0.05"><output id="o-walk"></output></div>
  <h3>Image</h3>
  <div class="row"><label for="s-gamma">Gamma</label><input id="s-gamma" type="range" min="0.6" max="1.8" step="0.02"><output id="o-gamma"></output></div>
  <div class="row"><label for="s-brightness">Brightness</label><input id="s-brightness" type="range" min="0.4" max="2.2" step="0.02"><output id="o-brightness"></output></div>
  <h3>Fog</h3>
  <div class="row"><label for="s-fogDensity">Density</label><input id="s-fogDensity" type="range" min="0" max="4" step="0.05"><output id="o-fogDensity"></output></div>
  <div class="row"><label for="s-fogLow">Low haze</label><input id="s-fogLow" type="range" min="0" max="4" step="0.05"><output id="o-fogLow"></output></div>
  <div class="row"><label for="s-fogTint">Tint</label><input id="s-fogTint" type="color"><output></output></div>
  <p class="hint">Low haze thickens the air toward the cloud sea. Grey tint is neutral.</p>
  <h3>Time</h3>
  <div class="row"><label for="s-time">Time of day</label><input id="s-time" type="range" min="0" max="0.9999" step="0.0005"><output id="o-time"></output></div>
  <label class="check"><input id="s-pause" type="checkbox"> Pause the day/night cycle</label>
  <h3>Color grading</h3>
  <div class="row"><label for="s-shadows">Shadows</label><input id="s-shadows" type="color"><output></output></div>
  <div class="row"><label for="s-mids">Midtones</label><input id="s-mids" type="color"><output></output></div>
  <div class="row"><label for="s-highs">Highlights</label><input id="s-highs" type="color"><output></output></div>
  <p class="hint">Grey is neutral. Push a color to tint that range.</p>
  <div class="row"><label for="s-blend">Blend</label><input id="s-blend" type="range" min="0" max="1" step="0.01"><output id="o-blend"></output></div>
  <div class="row"><label for="s-balance">Balance</label><input id="s-balance" type="range" min="-1" max="1" step="0.01"><output id="o-balance"></output></div>
  <h3>Interface</h3>
  <label class="check"><input id="s-pointer" type="checkbox"> Pointer</label>
  <label class="check"><input id="s-debugReports" type="checkbox"> Debug reports</label>
  <p class="hint">With debug reports on, F8 or a middle click copies what you are looking at, where you stand and the game state to the clipboard.</p>
  <div class="buttons"><button id="s-reset" type="button">Reset</button><button id="s-resume" class="primary" type="button">Resume</button></div>
</div>`;

// Escape opens and closes the panel. Values apply live and persist in localStorage.
export function createSettings({ player, clock, fx, input, canvas, baseSpeed = 1 }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'settings';
  root.innerHTML = HTML;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);

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
    $('o-walk').textContent = s.walk.toFixed(2) + '×';
    $('o-gamma').textContent = s.gamma.toFixed(2);
    $('o-brightness').textContent = s.brightness.toFixed(2);
    $('o-fogDensity').textContent = s.fogDensity.toFixed(2) + '×';
    $('o-fogLow').textContent = s.fogLow.toFixed(2) + '×';
    $('o-blend').textContent = Math.round(s.blend * 100) + '%';
    $('o-balance').textContent = (s.balance > 0 ? '+' : '') + s.balance.toFixed(2);
    save(s);
  };

  const sync = () => {
    $('s-walk').value = s.walk;
    $('s-gamma').value = s.gamma;
    $('s-brightness').value = s.brightness;
    $('s-pause').checked = s.pauseCycle;
    $('s-pointer').checked = s.pointer;
    $('s-debugReports').checked = s.debugReports;
    $('s-shadows').value = s.shadows;
    $('s-mids').value = s.mids;
    $('s-highs').value = s.highs;
    $('s-blend').value = s.blend;
    $('s-balance').value = s.balance;
    $('s-fogDensity').value = s.fogDensity;
    $('s-fogLow').value = s.fogLow;
    $('s-fogTint').value = s.fogTint;
    $('s-time').value = clock.phase;
    $('o-time').textContent = phaseToClock(clock.phase);
  };

  for (const k of ['walk', 'gamma', 'brightness', 'blend', 'balance', 'fogDensity', 'fogLow']) $('s-' + k).addEventListener('input', (e) => { s[k] = parseFloat(e.target.value); apply(); });
  for (const k of ['shadows', 'mids', 'highs', 'fogTint']) $('s-' + k).addEventListener('input', (e) => { s[k] = e.target.value; apply(); });
  $('s-pause').addEventListener('change', (e) => { s.pauseCycle = e.target.checked; apply(); });
  for (const k of ['pointer', 'debugReports']) $('s-' + k).addEventListener('change', (e) => { s[k] = e.target.checked; apply(); });
  $('s-time').addEventListener('input', (e) => {
    clock.phase = parseFloat(e.target.value);
    clock.update(0);
    $('o-time').textContent = phaseToClock(clock.phase);
  });
  $('s-reset').addEventListener('click', () => { Object.assign(s, DEFAULTS); apply(); sync(); });
  $('s-resume').addEventListener('click', () => close(true));
  // Keep the game from seeing clicks and keys meant for the panel.
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  let lastClose = 0;
  function open() {
    if (api.open) return;
    api.open = true;
    sync();
    root.classList.add('open');
    input.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function close(relock = false) {
    if (!api.open) return;
    api.open = false;
    lastClose = performance.now();
    root.classList.remove('open');
    if (relock) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* ignore */ } }
  }
  api.toggle = () => (api.open ? close() : open());
  api.openPanel = open;
  api.close = close;

  // While the panel is open, keep the time readout following the running clock.
  api.tick = () => {
    if (!api.open) return;
    if (document.activeElement !== $('s-time')) $('s-time').value = clock.phase;
    $('o-time').textContent = phaseToClock(clock.phase);
  };

  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !input.started) return;
    e.preventDefault();
    api.toggle();
  });
  // Browsers swallow the Escape that releases pointer lock, so treat losing the lock as "open".
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && input.started && !api.open && performance.now() - lastClose > 300 && !api.suppress) open();
  });

  apply();
  return api;
}
