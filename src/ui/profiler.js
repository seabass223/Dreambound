// The profiler overlay (Menu > Debug > Profiler): a small panel pinned top right while it's on, over the game and the
// menu alike. Every frame it records the frame time and the step's CPU time into ring buffers (no allocation); four
// times a second it redraws: frame rate, frame time (average and worst over the last half second, with a graph of the
// last 120 frames against the 60 fps and 100 fps lines), CPU time, the frame number, draw calls, triangles,
// geometries, textures and shader programs (renderer.info, summed over every pass), the JS heap where the browser
// reports it (Chromium's performance.memory), the drawing buffer's size and pixel ratio, anti-aliasing, and where you
// are: zone, stack-relative position and time of day.
import './kit/theme.css';

const CSS = `
#profiler { position: fixed; top: 12px; right: 12px; z-index: 20; width: 236px; padding: 10px 12px 9px; display: none;
  font: 11.5px/1.5 var(--font-mono, ui-monospace, monospace); color: var(--foreground); pointer-events: none;
  background: color-mix(in oklch, var(--card) 82%, transparent); border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 2px); box-shadow: var(--shadow-lg); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  transition: top 0.2s; font-variant-numeric: tabular-nums; }
#profiler.on { display: block; }
#profiler.low { top: 64px; }
#profiler .p-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
#profiler .p-fps { font-size: 20px; letter-spacing: 0.02em; }
#profiler .p-fps small { font-size: 11px; color: var(--muted-foreground); margin-left: 3px; }
#profiler .p-ms { color: var(--muted-foreground); text-align: right; }
#profiler canvas { display: block; width: 100%; height: 38px; margin: 2px 0 6px; border-radius: 4px; background: oklch(0 0 0 / 0.25); }
#profiler dl { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; margin: 0; }
#profiler dt { color: var(--muted-foreground); }
#profiler dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#profiler .p-sep { grid-column: 1 / -1; height: 1px; margin: 4px 0; background: var(--border); }
#profiler .warn { color: oklch(0.8 0.15 70); }
#profiler .bad { color: oklch(0.7 0.18 30); }
`;

const N = 120;   // frames in the graph

export function createProfiler({ renderer, fx, player, clock, stackOf = null, timeText = null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'profiler';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="p-head"><span class="p-fps"><b data-k="fps">–</b><small>fps</small></span><span class="p-ms" data-k="ms"></span></div>
    <canvas width="424" height="76"></canvas>
    <dl>
      <dt>CPU</dt><dd data-k="cpu"></dd>
      <dt>Frame</dt><dd data-k="frame"></dd>
      <dt>Draw calls</dt><dd data-k="calls"></dd>
      <dt>Triangles</dt><dd data-k="tris"></dd>
      <dt>Geometries</dt><dd data-k="geos"></dd>
      <dt>Textures</dt><dd data-k="tex"></dd>
      <dt>Programs</dt><dd data-k="progs"></dd>
      <dt>JS heap</dt><dd data-k="heap"></dd>
      <div class="p-sep"></div>
      <dt>Resolution</dt><dd data-k="res"></dd>
      <dt>Anti-alias</dt><dd data-k="aa"></dd>
      <dt>Zone</dt><dd data-k="zone"></dd>
      <dt>Position</dt><dd data-k="pos"></dd>
      <dt>Time</dt><dd data-k="time"></dd>
    </dl>`;
  document.body.appendChild(root);
  const out = {};
  for (const el of root.querySelectorAll('[data-k]')) out[el.dataset.k] = el;
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');

  const frameMs = new Float32Array(N), cpuMs = new Float32Array(N);
  let head = 0, count = 0, frames = 0, since = 0, on = false;
  const buf = { x: 0, y: 0 };
  const set = (k, text, cls = '') => {
    const el = out[k];
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
  };
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e4 ? (n / 1e3).toFixed(1) + ' k' : String(n));
  const mb = (b) => (b / 1048576).toFixed(0) + ' MB';

  function draw() {
    const W = canvas.width, H = canvas.height, top = 40;   // the graph's scale: 0 .. 40 ms
    g.clearRect(0, 0, W, H);
    const y = (ms) => H - Math.min(ms, top) / top * H;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (const ms of [10, 16.67, 33.3]) { g.beginPath(); g.moveTo(0, y(ms) + 0.5); g.lineTo(W, y(ms) + 0.5); g.stroke(); }
    const bw = W / N;
    for (let i = 0; i < count; i++) {
      const k = (head - count + i + N) % N, ms = frameMs[k];
      g.fillStyle = ms > 33.3 ? '#e0664a' : ms > 16.9 ? '#e0b04a' : '#8fb86a';
      g.fillRect(i * bw, y(ms), Math.max(1, bw - 1), H - y(ms));
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(i * bw, y(cpuMs[k]) - 1, Math.max(1, bw - 1), 2);
    }
  }

  function update() {
    const n = Math.min(count, 30);
    let sum = 0, worst = 0, cpu = 0;
    for (let i = 0; i < n; i++) {
      const k = (head - 1 - i + N) % N;
      sum += frameMs[k]; worst = Math.max(worst, frameMs[k]); cpu += cpuMs[k];
    }
    const avg = n ? sum / n : 0;
    set('fps', avg ? (1000 / avg).toFixed(0) : '–', avg > 33.3 ? 'bad' : avg > 16.9 ? 'warn' : '');
    set('ms', `${avg.toFixed(1)} ms · max ${worst.toFixed(1)}`);
    set('cpu', `${(n ? cpu / n : 0).toFixed(2)} ms`);
    const info = renderer.info;
    set('frame', String(frames));
    set('calls', String(info.render.calls), info.render.calls > 200 ? 'warn' : '');
    set('tris', fmt(info.render.triangles));
    set('geos', String(info.memory.geometries));
    set('tex', String(info.memory.textures));
    set('progs', String(info.programs?.length ?? 0));
    const mem = performance.memory;
    set('heap', mem ? `${mb(mem.usedJSHeapSize)} / ${mb(mem.jsHeapSizeLimit)}` : 'n/a in this browser');
    const gl = renderer.getContext();
    set('res', `${gl.drawingBufferWidth}×${gl.drawingBufferHeight} @${renderer.getPixelRatio().toFixed(2)}`);
    set('aa', fx.aa === 'msaa' ? 'MSAA 4×' : fx.aa === 'fxaa' ? 'FXAA' : 'off');
    const s = stackOf?.(player.feet);
    set('zone', s ? `${player.zone} · ${s.name}` : player.zone);
    if (s) { buf.x = player.feet.x - s.x; buf.y = player.feet.z - s.z; } else { buf.x = player.feet.x; buf.y = player.feet.z; }
    set('pos', `${buf.x.toFixed(1)}, ${player.feet.y.toFixed(1)}, ${buf.y.toFixed(1)}`);
    set('time', `${timeText ? timeText() + ' · ' : ''}sun ${clock.altDeg.toFixed(0)}°`);
    draw();
  }

  return {
    get on() { return on; },
    set(v) {
      on = !!v;
      root.classList.toggle('on', on);
      if (on) { count = 0; since = 1; }
    },
    // After the frame is drawn: dt (s) since the last one, cpu (ms) spent stepping it; low: shift down (the eyepiece's
    // Back button holds the corner).
    tick(dt, cpu, low = false) {
      frames++;
      if (!on) return;
      frameMs[head] = dt * 1000;
      cpuMs[head] = cpu;
      head = (head + 1) % N;
      count = Math.min(N, count + 1);
      root.classList.toggle('low', low);
      if ((since += dt) >= 0.25) { since = 0; update(); }
    },
  };
}
