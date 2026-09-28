// Dev-only hitch monitor (?dev). Once armed (at wake-up), it counts everything that stalls a frame and should have
// happened behind the black screen instead: shader programs linked, textures / render buffers allocated, vertex
// buffers created, and frames slower than SLOW_MS. Each is logged with what caused it (the object and material being
// drawn, or the first game-code frame on the stack). `window.hitchReport()` prints and returns the tally.
//
// It wraps the WebGL context's allocating calls and renderer.renderBufferDirect (to know what is being drawn), so it
// sees exactly what three.js does, whatever the reason; renderer.info is cross-checked each frame.
const SLOW_MS = 20;
const BIG_UPDATE = 512 * 1024;   // a texSubImage2D / bufferSubData this large is a re-upload, not an update

export function installHitchMonitor({ renderer, area = () => '' }) {
  const gl = renderer.getContext();
  const info = renderer.info;
  let armed = false, frame = 0, drawing = null, pass = '';
  const events = [], slow = [];
  const counts = { programs: 0, textures: 0, buffers: 0, renderbuffers: 0, reuploads: 0 };
  const pre = { programs: 0, textures: 0, buffers: 0, renderbuffers: 0, reuploads: 0 };   // during preload, for scale
  let frameEvents = 0;

  const label = (o) => (o ? `${o.type}${o.name ? ' "' + o.name + '"' : ''}` : '');
  // The first stack frame in game code (not three.js, not this file): where the allocation came from.
  const caller = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 80;   // three.js's own frames alone go deeper than the default 10
    const lines = (new Error().stack || '').split('\n');
    Error.stackTraceLimit = limit;
    for (const l of lines) {
      if (!l.includes('/src/') || l.includes('/dev/hitch.js')) continue;
      const m = l.match(/\/src\/([^?:)]+)(?:\?[^:]*)?:(\d+)/);
      if (m) return `${m[1]}:${m[2]}`;
    }
    return '?';
  };
  const what = () => (drawing ? `${label(drawing.object)} / ${label(drawing.material)}` : pass || 'outside a draw');

  function note(kind, detail = '') {
    if (!armed) { pre[kind]++; return; }
    counts[kind]++;
    frameEvents++;
    const e = { frame, kind, what: what(), detail, where: caller(), area: area() };
    events.push(e);
    console.warn(`[hitch] ${kind}: ${e.what}${detail ? ' ' + detail : ''} (${e.where}) @ ${e.area}`);
  }

  const wrap = (name, fn) => {
    const orig = gl[name];
    if (!orig) return;
    gl[name] = function (...a) { fn(a); return orig.apply(gl, a); };
  };
  wrap('linkProgram', () => note('programs'));
  for (const n of ['texImage2D', 'texImage3D', 'compressedTexImage2D', 'compressedTexImage3D']) {
    // A texImage2D with a null source only sizes a render target; with data it is an upload. Both allocate.
    wrap(n, (a) => note('textures', `${n} ${a.find((x) => x && typeof x === 'object' && 'width' in x)?.width ?? a[3] ?? ''}`));
  }
  wrap('texStorage2D', (a) => note('textures', `texStorage2D ${a[3]}x${a[4]}`));
  wrap('texStorage3D', (a) => note('textures', `texStorage3D ${a[3]}x${a[4]}x${a[5]}`));
  wrap('bufferData', (a) => note('buffers', `${typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? '?'} bytes`));
  wrap('renderbufferStorage', (a) => note('renderbuffers', `${a[2]}x${a[3]}`));
  wrap('renderbufferStorageMultisample', (a) => note('renderbuffers', `${a[3]}x${a[4]}`));
  wrap('texSubImage2D', (a) => {
    const src = a.find((x) => x && typeof x === 'object');
    const bytes = src?.byteLength ?? (src?.width ?? 0) * (src?.height ?? 0) * 4;
    if (bytes >= BIG_UPDATE) note('reuploads', `texSubImage2D ${bytes} bytes`);
  });

  // What is being drawn when something compiles or uploads.
  const rbd = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    drawing = { object, material };
    try { return rbd.call(this, camera, scene, geometry, material, object, group); } finally { drawing = null; }
  };

  let lastPrograms = 0;
  let t0 = 0;
  return {
    counts, pre, events, slow,
    get armed() { return armed; },
    // Everything after this is a hitch: call when the player wakes.
    arm() { armed = true; lastPrograms = info.programs?.length ?? 0; },
    // Labels allocations made outside any draw (render targets, PMREM, ...).
    pass(name) { pass = name; },
    frameStart() { frame++; frameEvents = 0; t0 = performance.now(); },
    // interval: ms since the previous frame was shown (what the player feels); the frame's own CPU time is added.
    frameEnd(interval) {
      if (!armed) return;
      const cpu = performance.now() - t0;
      const n = info.programs?.length ?? 0;
      if (n > lastPrograms) {
        // Cross-check: renderer.info.programs grew (names of the new ones).
        const names = info.programs.slice(lastPrograms).map((p) => p.name).join(', ');
        console.warn(`[hitch] renderer.info.programs ${lastPrograms} -> ${n}: ${names} @ ${area()}`);
      }
      lastPrograms = n;
      if (interval > SLOW_MS || cpu > SLOW_MS) {
        const s = { frame, interval: +interval.toFixed(1), cpu: +cpu.toFixed(1), events: frameEvents, area: area() };
        slow.push(s);
        if (frameEvents || cpu > SLOW_MS) console.warn(`[hitch] slow frame ${s.interval} ms (cpu ${s.cpu} ms, ${frameEvents} allocations) @ ${s.area}`);
      }
    },
    report() {
      const byArea = {};
      for (const e of events) {
        const a = (byArea[e.area] ||= { programs: 0, textures: 0, buffers: 0, renderbuffers: 0, reuploads: 0, slowFrames: 0 });
        a[e.kind]++;
      }
      for (const s of slow) (byArea[s.area] ||= { programs: 0, textures: 0, buffers: 0, renderbuffers: 0, reuploads: 0, slowFrames: 0 }).slowFrames++;
      return { frames: frame, ...counts, slowFrames: slow.length, byArea, events, slow, preload: { ...pre }, memory: { ...info.memory }, programsTotal: info.programs?.length ?? 0 };
    },
  };
}
