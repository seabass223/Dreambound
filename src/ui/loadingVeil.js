// The loading screen: a full-length track whose fill runs at an even pace to its end, the current stage, and a
// countdown, then "click to begin".
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
  [0.55, 'Building the island'],
  [0.55 + 0.45 * 0.4, 'Compiling shaders'],
  [0.55 + 0.45 * 0.5, 'Uploading textures'],
  [0.55 + 0.45 * 0.85, 'Preparing every view'],
  [0.55 + 0.45 * 0.9, 'Warming up'],
  [1.01, 'Drawing the first frames'],
];

const CSS = `
#veil .load { display: grid; justify-items: center; gap: 14px; width: min(340px, 70vw); transition: opacity 0.9s ease; }
#veil .track { position: relative; width: 100%; height: 2px; border-radius: 1px; background: rgba(216, 203, 176, 0.16); overflow: hidden; }
#veil .fill { position: absolute; inset: 0; background: #d8cbb0; transform-origin: 0 50%; transform: scaleX(0); box-shadow: 0 0 8px rgba(216, 203, 176, 0.5); }
#veil .fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 60%, rgba(255, 248, 230, 0.9)); animation: loadGlow 2.2s ease-in-out infinite; }
@keyframes loadGlow { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
#veil .row { display: flex; justify-content: space-between; width: 100%; font: 12px/1.2 Georgia, 'Times New Roman', serif; letter-spacing: 0.08em; color: rgba(216, 203, 176, 0.72); font-variant-numeric: tabular-nums; }
#veil .row .eta { color: rgba(216, 203, 176, 0.5); }
#veil .begin { font: 12px/1 Georgia, 'Times New Roman', serif; letter-spacing: 0.3em; text-transform: uppercase; color: #d8cbb0; opacity: 0; transform: translateY(26px); visibility: hidden; }
#veil.ready .load { opacity: 0; }
#veil.ready .begin { visibility: visible; animation: beginIn 1.2s ease 0.4s forwards; }
@keyframes beginIn { to { opacity: 0.6; } }
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
  veil.append(wrap, begin);
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
