// The title screen, up while the game loads: the title and a line under it, the controls in a quiet card to read
// meanwhile, and beneath them a full-length track whose fill runs at an even pace to its end, the current stage and a
// countdown; when it's ready the track gives way to "Click to begin" (the title and controls stay).
//
// The load's real progress (0..1, reported by main.js and render/preload.js) is far from even in time: the world
// build is one long synchronous block and the shader compiles dominate the preload. So each load records when it
// reached each fraction of progress, and the next load maps progress onto *time* through that curve: the fill then
// moves at a steady rate, and the countdown is the last load's remaining time, scaled by how fast this one is going.
// Through blocking stretches (the build) the fill glides on a CSS transition, which the compositor keeps running
// while the main thread is busy.

const KEY = 'dreambound.loadProfile.v1';
const N = 40;   // the stored curve: time fraction at progress 0, 1/N, ..., 1

// Stages by progress (main.js: models to 0.1, the build to 0.55, then render/preload.js's phases in its shares).
const STAGES = [
  [0.1, 'Loading models'],
  [0.55, 'Building the sea stacks'],
  [0.55 + 0.45 * 0.4, 'Compiling shaders'],
  [0.55 + 0.45 * 0.5, 'Uploading textures'],
  [0.55 + 0.45 * 0.85, 'Preparing every view'],
  [0.55 + 0.45 * 0.9, 'Warming up'],
  [1.01, 'Drawing the first frames'],
];

// The controls, as [what, keys...] (a key "Click" or "Mouse" is a word, not a key cap).
const CONTROLS = [
  ['Move', 'W', 'A', 'S', 'D'],
  ['Look', 'Mouse'],
  ['Run', 'Shift'],
  ['Interact', 'Click', 'E', 'Space'],
  ['Menu', 'M'],
  ['Free the mouse', 'Esc'],
  ['Screenshot', 'F7'],
];

const CSS = `
#veil { pointer-events: none; }
#veil i { display: none; }
#veil .title-screen { display: grid; justify-items: center; gap: 28px; width: min(420px, calc(100vw - 32px));
  font-family: var(--font-sans, system-ui); color: var(--foreground, #e9e2d3); animation: titleIn 1.2s ease both; }
@keyframes titleIn { from { opacity: 0; transform: translateY(6px); } }
#veil .title-screen header { display: grid; justify-items: center; gap: 10px; text-align: center; }
#veil .title-screen h1 { margin: 0; font: 400 46px/1 var(--font-serif, Georgia, serif); letter-spacing: 0.04em; color: #e6dcc6; }
#veil .title-screen header p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--muted-foreground, #a39a8a); }
#veil .title-screen header .hint { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
#veil .controls { width: 100%; box-sizing: border-box; padding: 6px 16px; border: 1px solid var(--border, #3a352d);
  border-radius: calc(var(--radius, 8px) + 2px); background: oklch(0.18 0.01 70 / 0.6); }
#veil .controls div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; font-size: 13px; }
#veil .controls div + div { border-top: 1px solid oklch(1 0 0 / 0.06); }
#veil .controls span { color: var(--muted-foreground, #a39a8a); }
#veil .controls .keys { display: flex; align-items: center; gap: 4px; color: var(--foreground, #e9e2d3); }
#veil .controls kbd { min-width: 22px; padding: 2px 6px; box-sizing: border-box; text-align: center; font: 11px/16px var(--font-mono, monospace);
  color: var(--foreground, #e9e2d3); background: var(--muted, #26231e); border: 1px solid var(--border, #3a352d); border-bottom-width: 2px; border-radius: 5px; }
#veil .controls .word { font-size: 12px; color: var(--foreground, #e9e2d3); }
#veil .controls .keys .sep { color: var(--muted-foreground, #a39a8a); font-size: 11px; padding: 0 1px; }
#veil .status { display: grid; width: 100%; justify-items: center; }
#veil .status > * { grid-area: 1 / 1; }
#veil .load { display: grid; justify-items: center; gap: 14px; width: min(340px, 70vw); transition: opacity 0.9s ease; }
#veil .track { position: relative; width: 100%; height: 2px; border-radius: 1px; background: rgba(216, 203, 176, 0.16); overflow: hidden; }
#veil .fill { position: absolute; inset: 0; background: #d8cbb0; transform-origin: 0 50%; transform: scaleX(0); box-shadow: 0 0 8px rgba(216, 203, 176, 0.5); }
#veil .fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 60%, rgba(255, 248, 230, 0.9)); animation: loadGlow 2.2s ease-in-out infinite; }
@keyframes loadGlow { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
#veil .row { display: flex; justify-content: space-between; width: 100%; font: 12px/1.2 Georgia, 'Times New Roman', serif; letter-spacing: 0.08em; color: rgba(216, 203, 176, 0.72); font-variant-numeric: tabular-nums; }
#veil .row .eta { color: rgba(216, 203, 176, 0.5); }
#veil .begin { font: 12px/1 Georgia, 'Times New Roman', serif; letter-spacing: 0.3em; text-transform: uppercase; color: #d8cbb0; opacity: 0; transform: translateY(26px); visibility: hidden; }
#veil.ready .load { opacity: 0; }
#veil.ready .begin { visibility: visible; animation: beginIn 1.2s ease 0.4s forwards, beginBreathe 4.5s ease-in-out 1.6s infinite; }
@keyframes beginIn { to { opacity: 0.75; transform: translateY(6px); } }
@keyframes beginBreathe { 0%, 100% { opacity: 0.75; } 50% { opacity: 0.4; } }
`;

const load = () => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && Array.isArray(p.curve) && p.curve.length === N + 1 && p.total > 0) return p;
  } catch { /* none, or storage blocked */ }
  return null;
};

export function createLoadingVeil(veil, t0 = performance.now()) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  veil.querySelector('b')?.remove();   // the old hairline
  const wrap = document.createElement('div');
  wrap.className = 'load';
  wrap.innerHTML = '<div class="track"><div class="fill"></div></div><div class="row"><span class="stage"></span><span class="eta"></span></div>';
  const begin = document.createElement('div');
  begin.className = 'begin';
  begin.textContent = 'Click to begin';
  // the title, the line under it, the controls, and the status (the track, then "Click to begin") under them
  const screen = document.createElement('div');
  screen.className = 'title-screen';
  const header = document.createElement('header');
  header.innerHTML = '<h1>Dreambound</h1><p>A quiet world of seas stack islands above the clouds. Wander, look closely, take it in. Exploring is encouraged, as is note-taking. Grab your favorite drink and see if you can awaken from the dream.</p><p class="hint">Headphones recommended</p>';
  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.setAttribute('aria-label', 'Controls');
  for (const [what, ...keys] of CONTROLS) {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = what;
    const ks = document.createElement('p');
    ks.className = 'keys';
    ks.style.margin = '0';
    keys.forEach((k, i) => {
      if (i && what === 'Interact') { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; ks.appendChild(sep); }
      const el = document.createElement(k === 'Mouse' || k === 'Click' ? 'b' : 'kbd');
      if (el.tagName === 'B') { el.className = 'word'; el.style.fontWeight = '500'; }
      el.textContent = k;
      ks.appendChild(el);
    });
    row.append(label, ks);
    controls.appendChild(row);
  }
  const status = document.createElement('div');
  status.className = 'status';
  status.append(wrap, begin);
  screen.append(header, controls, status);
  veil.append(screen);
  const fill = wrap.querySelector('.fill'), stageEl = wrap.querySelector('.stage'), etaEl = wrap.querySelector('.eta');

  const prof = load();
  // Time fraction at progress p: the last load's curve, or (the first time) a guess from typical shares.
  const timeAt = (p) => {
    p = Math.min(1, Math.max(0, p));
    if (!prof) return p < 0.1 ? p * 1.2 : p < 0.55 ? 0.12 + (p - 0.1) / 0.45 * 0.18 : 0.3 + (p - 0.55) / 0.45 * 0.7;
    const x = p * N, i = Math.min(N - 1, Math.floor(x));
    return prof.curve[i] + (prof.curve[i + 1] - prof.curve[i]) * (x - i);
  };
  const marks = [[0, 0]];
  // The whole load's expected length: the last load's, leaning more on this one's own pace the further it gets. The
  // first time (no history) there is no honest estimate until the preload is under way.
  const expectTotal = (now, tf) => {
    if (prof) return tf > 0.02 ? prof.total * (1 - tf) + (now / tf) * tf : prof.total;
    return p >= 0.6 && tf > 0 ? now / tf : null;
  };
  let p = 0, eta = null, etaAt = 0, shown = 0;

  const stage = (q) => STAGES.find(([end]) => q < end)[1];
  const setFill = (f, secs = 0.35) => {
    shown = Math.max(shown, f);
    fill.style.transition = `transform ${secs.toFixed(2)}s linear`;
    fill.style.transform = `scaleX(${shown.toFixed(4)})`;
  };
  const writeEta = () => {
    if (eta == null) { etaEl.textContent = 'estimating…'; return; }
    const left = Math.max(0, eta - (performance.now() - etaAt) / 1000);
    etaEl.textContent = left < 1.5 ? 'almost ready' : `about ${Math.round(left)} s left`;
  };
  const timer = setInterval(writeEta, 250);

  const api = {
    // Real progress reached.
    progress(q) {
      if (q < p) return;
      p = q;
      const now = performance.now() - t0;
      marks.push([p, now]);
      const tf = timeAt(p);
      setFill(tf);
      stageEl.textContent = stage(p);
      const total = expectTotal(now, tf);
      if (total) { eta = Math.max(0, (total - now) / 1000); etaAt = performance.now(); }
      writeEta();
    },
    // About to block the main thread until progress q: let the fill glide there over the expected time.
    glide(q) {
      const now = performance.now() - t0, tf = timeAt(p);
      const total = expectTotal(now, tf) ?? 12000;
      setFill(timeAt(q), Math.max(0.2, (timeAt(q) - tf) * total / 1000));
      stageEl.textContent = stage(q - 1e-6);
    },
    ready() {
      clearInterval(timer);
      api.progress(1);
      etaEl.textContent = '';
      veil.classList.add('ready');
      // Keep this load's curve for the next one.
      const total = performance.now() - t0;
      const curve = [];
      for (let k = 0; k <= N; k++) {
        const q = k / N;
        let j = 1;
        while (j < marks.length - 1 && marks[j][0] < q) j++;
        const [p0, a] = marks[j - 1], [p1, b] = marks[j];
        curve.push(Math.min(1, (p1 > p0 ? a + (b - a) * (q - p0) / (p1 - p0) : b) / total));
      }
      for (let k = 1; k <= N; k++) curve[k] = Math.max(curve[k], curve[k - 1]);
      curve[N] = 1;
      try { localStorage.setItem(KEY, JSON.stringify({ total, curve })); } catch { /* storage blocked */ }
    },
  };
  stageEl.textContent = STAGES[0][1];
  if (prof) { eta = prof.total / 1000; etaAt = performance.now(); }
  writeEta();
  return api;
}
