import * as THREE from 'three';
import { atmo, atmoState } from '../render/atmosphere.js';
import { createShell, COLS, ROWS, EXTRA_GLYPHS, NORM } from './terminalShell.js';

// The bunker's computer (placed by props/bunkerRoom.js): a working shell (props/terminalShell.js) on a blue phosphor
// CRT, and the chair in front of it.
//
// The text is drawn by the screen's shader from two textures: a glyph atlas built once at boot (every character the
// shell can print, regular and bold, each with a pre-blurred copy for the phosphor's glow) and a COLS x ROWS grid of
// character + attribute bytes (6 KB), re-uploaded only when what's on screen changes. Everything else (the blinking
// block cursor, scanlines, the tube's curve and vignette, flicker, the glitch the rocks.exe cutscene drives) is
// uniforms. Like the observatory's screens it is self-lit, so it's scaled by the exposure factor k (bright by day,
// not glaring at night).
//
// Pressing the screen (or the keyboard) sits you in the chair: Player.sit eases the eye to the seat while the view
// narrows to seat.fov, and ui/terminalKeys.js hands every key to the shell until you leave (Esc, a click, or `exit`).

const GLYPHS = (() => { let s = ''; for (let c = 32; c < 127; c++) s += String.fromCharCode(c); return s + EXTRA_GLYPHS; })();
const INDEX = new Map([...GLYPHS].map((ch, i) => [ch, i]));
const UNKNOWN = INDEX.get('?'), FULL = INDEX.get('█');
// Atlas slots: CW x CH glyph cells with PAD px of room round each for the glow, SLOTS_X across.
const CW = 24, CH = 48, PAD = 8, SLOTS_X = 16;
const GLOW_R = 4;   // px: box-blur radius (three passes) for the glow copy
const FONT = '"Consolas", "Menlo", "DejaVu Sans Mono", "Lucida Console", "Courier New", monospace';
const BLINK = 1.06;  // s: the cursor's blink period (it holds steady while typing)
const smooth = (t) => t * t * (3 - 2 * t);

// Block shades, box drawing and a few shapes are drawn rather than taken from the font, so they fill their cells and
// join up whatever font the machine has.
function drawSpecial(g, ch, x, y, bold) {
  const w = CW, h = CH, t = bold ? 5 : 3;   // line weight
  const cx = x + w / 2, cy = y + h / 2;
  if (ch === '█') { g.fillRect(x, y, w, h); return true; }
  if (ch === '░' || ch === '▒' || ch === '▓') {
    const s = 4, d = ch === '░' ? 1 : ch === '▒' ? 2 : 3;
    for (let j = 0; j < h / s; j++) for (let i = 0; i < w / s; i++) {
      const on = d === 2 ? (i + j) % 2 === 0 : d === 1 ? i % 2 === 0 && j % 2 === 0 : !(i % 2 === 1 && j % 2 === 1);
      if (on) g.fillRect(x + i * s, y + j * s, s - 1, s - 1);
    }
    return true;
  }
  if (ch === '●') { g.beginPath(); g.arc(cx, cy + 2, w * 0.36, 0, Math.PI * 2); g.fill(); return true; }
  if (ch === '▶') { g.beginPath(); g.moveTo(x + 4, cy - w * 0.42); g.lineTo(x + w - 3, cy); g.lineTo(x + 4, cy + w * 0.42); g.fill(); return true; }
  const box = { '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ru', '┘': 'lu', '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'lrud' }[ch];
  if (!box) return false;
  const hx = Math.round(cx - t / 2), hy = Math.round(cy - t / 2);
  if (box.includes('l')) g.fillRect(x, hy, hx - x + t, t);
  if (box.includes('r')) g.fillRect(hx, hy, x + w - hx, t);
  if (box.includes('u')) g.fillRect(hx, y, t, hy - y + t);
  if (box.includes('d')) g.fillRect(hx, hy, t, y + h - hy);
  return true;
}

// Three box-blur passes along one axis of a W x H float image (in place, via tmp).
function blurAxis(src, tmp, W, H, r, horiz) {
  const n = horiz ? W : H, lines = horiz ? H : W, inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let l = 0; l < lines; l++) {
      const at = (i) => (horiz ? l * W + i : i * W + l);
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += i >= 0 && i < n ? src[at(i)] : 0;
      for (let i = 0; i < n; i++) {
        tmp[at(i)] = acc * inv;
        const a = i + r + 1, b = i - r;
        if (a < n) acc += src[at(a)];
        if (b >= 0) acc -= src[at(b)];
      }
    }
    src.set(tmp);
  }
}

// The glyph atlas: R the glyph, G its glow. Built once (in the browser; a 1 x 1 stand-in headless).
let atlasCache = null;
function glyphAtlas() {
  if (atlasCache) return atlasCache;
  const n = GLYPHS.length, SW = CW + 2 * PAD, SH = CH + 2 * PAD;
  const slotsY = Math.ceil((n * 2) / SLOTS_X);
  const W = SLOTS_X * SW, H = slotsY * SH;
  const info = { slotsX: SLOTS_X, slotsY, padX: PAD / SW, padY: PAD / SH, glyphs: n };
  if (typeof document === 'undefined' || !document.body) {
    const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    tex.needsUpdate = true;
    return (atlasCache = { tex, ...info });
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  // Size the font so one advance fills the cell's width; centre its line box in the cell's height.
  g.font = `100px ${FONT}`;
  const adv100 = g.measureText('M').width;
  const size = Math.floor((CW * 0.98 * 100) / adv100);
  for (let i = 0; i < n * 2; i++) {
    const ch = GLYPHS[i % n], bold = i >= n;
    const x = (i % SLOTS_X) * SW + PAD, y = Math.floor(i / SLOTS_X) * SH + PAD;
    if (drawSpecial(g, ch, x, y, bold)) continue;
    g.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    const m = g.measureText('Mg');
    const asc = m.fontBoundingBoxAscent ?? size * 0.8, desc = m.fontBoundingBoxDescent ?? size * 0.22;
    const base = y + (CH - (asc + desc)) / 2 + asc;
    const wch = g.measureText(ch).width, gx = x + (CW - wch) / 2;
    // Struck twice a pixel and a half apart: the beam spreads sideways, and the strokes hold up small on screen.
    g.fillText(ch, gx - 0.75, base);
    g.fillText(ch, gx + 0.75, base);
  }
  const img = g.getImageData(0, 0, W, H).data;
  const sharp = new Float32Array(W * H), tmp = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) sharp[i] = img[i * 4] / 255;
  const glow = sharp.slice();
  blurAxis(glow, tmp, W, H, GLOW_R, true);
  blurAxis(glow, tmp, W, H, GLOW_R, false);
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = img[i * 4];
    px[i * 4 + 1] = Math.min(255, Math.round(Math.sqrt(glow[i]) * 255));   // sqrt: a wider, softer halo
    px[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(px, W, H);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return (atlasCache = { tex, ...info });
}

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uChars;
uniform sampler2D uAtlas;
uniform vec2 uGrid;        // cols, rows
uniform vec4 uSlot;        // atlas slots across, down; the padding as a fraction of a slot (x, y)
uniform float uGlyphs;     // glyphs per weight (the bold set follows)
uniform float uFull;       // the full block's glyph (the cursor)
uniform float uTime;
uniform float uK;          // exposure compensation
uniform float uGlitch;
uniform vec4 uCursor;      // col, row, lit
uniform vec4 uLevels;      // brightness of the four attribute levels: dim, normal, bright, hot
uniform vec3 uTint;        // the phosphor
uniform vec3 uHot;         // what the brightest strokes go toward
uniform vec3 uHalo;        // the glow round them
uniform vec3 uBack;        // the unlit tube
uniform vec4 uLook;        // curvature, glow, scanline depth, gain
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;

float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec4 cellAt(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x >= uGrid.x || c.y >= uGrid.y) return vec4(0.0);
  return floor(texelFetch(uChars, ivec2(c), 0) * 255.0 + 0.5);
}
float levelOf(float a) {
  float l = mod(a, 4.0);
  return l < 0.5 ? uLevels.x : l < 1.5 ? uLevels.y : l < 2.5 ? uLevels.z : uLevels.w;
}
// A glyph's coverage (x) and glow (y) at f (0..1 across its cell; a little beyond for the glow).
vec2 glyph(float gi, float bold, vec2 f, vec2 gx, vec2 gy) {
  float slot = gi + bold * uGlyphs;
  vec2 s = vec2(mod(slot, uSlot.x), floor(slot / uSlot.x));
  vec2 sc = (1.0 - 2.0 * uSlot.zw) / uSlot.xy;
  vec2 uv = (s + uSlot.zw) / uSlot.xy + f * sc;
  return textureGrad(uAtlas, uv, gx * sc, gy * sc).rg;
}
// The text at g (in cells): x the strokes of this cell, y the glow from it and its eight neighbours.
vec2 textAt(vec2 g, vec2 gx, vec2 gy, bool withGlow) {
  vec2 cell = floor(g), f = g - cell;
  vec2 padIn = uSlot.zw / (1.0 - 2.0 * uSlot.zw);
  vec2 r = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 d = vec2(float(i), float(j));
      bool centre = i == 0 && j == 0;
      if (!centre && !withGlow) continue;
      vec2 ff = f - d;
      if (ff.x < -padIn.x || ff.y < -padIn.y || ff.x > 1.0 + padIn.x || ff.y > 1.0 + padIn.y) continue;
      vec2 cc = cell + d;
      vec4 c = cellAt(cc);
      float gi = c.r, a = c.g;
      if (uGlitch > 0.0) {
        float tq = floor(uTime * 14.0);
        if (h21(cc * vec2(1.7, 3.1) + tq * vec2(3.1, 7.7)) < uGlitch * 0.2 && all(greaterThanEqual(cc, vec2(0.0))) && all(lessThan(cc, uGrid))) {
          gi = 1.0 + floor(h21(cc + tq * 1.3) * (uGlyphs - 1.0));
          a = 2.0;
        }
      }
      bool cur = uCursor.z > 0.5 && cc.x == uCursor.x && cc.y == uCursor.y;
      if (gi < 0.5 && !cur) continue;
      float bold = step(4.0, mod(a, 8.0));
      vec2 s = glyph(gi, bold, ff, gx, gy);
      float lv = levelOf(a);
      if (cur) {
        // The block cursor: the cell lit, its character dark in it.
        vec2 b = glyph(uFull, 0.0, ff, gx, gy);
        s = vec2(b.x * (1.0 - s.x), b.y);
        lv = max(lv, uLevels.y);
      }
      if (centre) r.x = s.x * lv;
      r.y += s.y * lv;
    }
  }
  return r;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);          // up the glass
  vec2 c = p - 0.5;
  c *= 1.0 + uLook.x * dot(c, c);              // the tube's bulge
  vec2 sp = c + 0.5;
  vec2 rq = abs(c) - (0.5 - 0.055);
  float inside = 1.0 - smoothstep(-0.003, 0.003, length(max(rq, 0.0)) - 0.055);
  const vec2 M = vec2(0.042, 0.05);            // overscan: the text's margin on the tube
  vec2 g0 = vec2((sp.x - M.x) / (1.0 - 2.0 * M.x) * uGrid.x, (1.0 - (sp.y - M.y) / (1.0 - 2.0 * M.y)) * uGrid.y);
  vec2 gx = dFdx(g0), gy = dFdy(g0);
  vec2 g = g0;
  float gl = uGlitch;
  float bandOn = 0.0;
  if (gl > 0.0) {
    // Tearing: random bands of rows slide sideways; at high values the picture rolls.
    float band = floor(sp.y * 26.0 + floor(uTime * 13.0) * 5.0);
    bandOn = step(1.0 - gl * 0.75, h21(vec2(band, floor(uTime * 21.0))));
    g.x += (h21(vec2(band, 7.0 + floor(uTime * 29.0))) - 0.5) * 18.0 * gl * bandOn;
    g.y = mod(g.y + floor(uTime * 9.0) * 0.37 * uGrid.y * max(0.0, gl - 0.7), uGrid.y + 2.0);
  }
  vec2 t = textAt(g, gx, gy, true);
  vec3 split = vec3(t.x);
  if (gl > 0.02) {
    float sh = 0.45 * gl + 0.25 * bandOn;
    split.r = textAt(g + vec2(sh, 0.0), gx, gy, false).x;
    split.b = textAt(g - vec2(sh, 0.0), gx, gy, false).x;
  }
  float core = t.x;
  vec3 col = uHalo * t.y * uLook.y;                                         // the halo
  col += mix(uTint, uHot, smoothstep(0.45, 1.35, core)) * split;            // the strokes, whiter where brightest
  // Scanlines (eight to a text row), faded where they'd be finer than a couple of pixels.
  float sl = g0.y * 8.0;
  float fw = fwidth(sl);
  float beam = 0.5 + 0.5 * cos(fract(sl) * 6.2831853);
  float scan = 1.0 - uLook.z * (1.0 - smoothstep(0.25, 0.6, fw)) * beam;
  float roll = exp(-pow((fract(sp.y * 0.8 - uTime * 0.11) - 0.5) * 6.0, 2.0));
  float flick = 1.0 + 0.012 * sin(uTime * 377.0) + 0.01 * sin(uTime * 23.0 + 1.3) * sin(uTime * 3.1);
  float vig = clamp(1.0 - 0.55 * pow(length(c * vec2(1.0, 1.2)) * 1.35, 3.0), 0.0, 1.0);
  vec3 back = uBack * (0.75 + 0.25 * scan) * (1.0 + 0.6 * roll);
  vec3 e = (col * scan * (1.0 + 0.05 * roll) + back) * flick * vig;
  e += uTint * (h21(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5) * (0.012 + 0.5 * gl);
  e += uTint * gl * 0.4 * bandOn * h21(vec2(floor(g.y * 3.0), floor(uTime * 40.0)));
  e = max(e, 0.0) * uK * uLook.w;
  // The glass: dark where the picture isn't, a faint warm reflection of the room, stronger at grazing angles.
  vec3 n = normalize(vN), v = normalize(vV);
  float fr = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
  float sheen = smoothstep(0.5, 0.0, length((p - vec2(0.24, 0.8)) * vec2(1.0, 1.7)));
  vec3 glass = vec3(1.0, 0.8, 0.62) * (0.0025 + 0.05 * fr + 0.006 * sheen) * uK;
  vec3 outc = mix(vec3(0.0015, 0.002, 0.003) * uK, e, inside) + glass;
  gl_FragColor = vec4(outc, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// createTerminal(ctx, { screen, seat, keyboard, cols, rows }) -> term (call it at build time: it makes its material and
// textures at once).
//   screen: the glass mesh, a 4:3 face with UVs 0..1 over it as glTF exports them (u right, v down the glass); it gets
//     this module's material. Don't LOD-fade it (a ShaderMaterial has no dithered twin): hide it, or fade: false.
//   seat: { eye, stand (Vector3, world), yaw, pitch, fov } (+ optional yawRange, pitchMin, pitchMax, dip, onSit,
//     onStand, which it chains); the missing ones are filled in.
//   keyboard: an optional dedicated (invisible) pick mesh over the keyboard, pressed like the screen.
// term: { state, shell, exec(line), key(e), active(), enter(), leave(), glitch, onRun, returnFromFeed(), update(dt),
//   material, seat, item }. onRun(term) is called once, when rocks.exe has printed its four dots; the shell then waits
//   (no prompt) for returnFromFeed() (or comes back by itself after 30 s, or 1 s when onRun is unset or returns false).
//   Never call returnFromFeed() from inside onRun.
export function createTerminal(ctx, { screen, seat, keyboard = null, cols = COLS, rows = ROWS }) {
  ctx.state ??= {};
  const getState = () => (ctx.state.terminal ||= { ran: false, cwd: '/home/operator' });
  getState();
  const shell = createShell({ state: getState, cols, rows });

  // ---- the screen ----
  const atlas = glyphAtlas();
  const cells = new Uint8Array(cols * rows * 4);
  const charTex = new THREE.DataTexture(cells, cols, rows);
  charTex.magFilter = charTex.minFilter = THREE.NearestFilter;
  charTex.generateMipmaps = false;
  const U = {
    uChars: { value: charTex }, uAtlas: { value: atlas.tex },
    uGrid: { value: new THREE.Vector2(cols, rows) },
    uSlot: { value: new THREE.Vector4(atlas.slotsX, atlas.slotsY, atlas.padX, atlas.padY) },
    uGlyphs: { value: atlas.glyphs }, uFull: { value: FULL },
    uTime: { value: 0 }, uK: { value: 1 }, uGlitch: { value: 0 },
    uCursor: { value: new THREE.Vector4(0, 0, 1, 0) },
    uLevels: { value: new THREE.Vector4(0.42, 0.8, 1.12, 1.45) },
    uTint: { value: new THREE.Color(0.12, 0.32, 1.0) },
    uHot: { value: new THREE.Color(0.62, 0.8, 1.0) },
    uHalo: { value: new THREE.Color(0.05, 0.2, 1.0) },
    uBack: { value: new THREE.Color(0.004, 0.009, 0.022) },
    uLook: { value: new THREE.Vector4(0.085, 0.75, 0.38, 1.0) },
  };
  const material = new THREE.ShaderMaterial({ name: 'terminal', uniforms: U, vertexShader: VERT, fragmentShader: FRAG });
  if (screen) {
    if (!screen.geometry.attributes.normal) screen.geometry.computeVertexNormals();
    screen.material = material;
    screen.castShadow = false;
    screen.receiveShadow = false;
  }

  let drawn = -1;
  const cursor = { col: 0, row: 0, show: true };
  function draw() {
    const sc = shell.screen();
    for (let r = 0; r < rows; r++) {
      const row = sc.rows[r];
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4, ch = row.t[c];
        cells[i] = ch === undefined ? 0 : INDEX.get(ch) ?? UNKNOWN;
        cells[i + 1] = ch === undefined ? NORM : row.a[c] ?? NORM;
      }
    }
    Object.assign(cursor, sc.cursor);
    charTex.needsUpdate = true;
    drawn = shell.version;
  }
  draw();

  // ---- the seat ----
  seat.name ??= 'bunker:terminal';
  seat.yawRange ??= THREE.MathUtils.degToRad(7);
  seat.pitchMin ??= (seat.pitch ?? 0) - 0.22;
  seat.pitchMax ??= (seat.pitch ?? 0) + 0.16;
  seat.dip ??= 0.025;
  seat.fov ??= 38;
  const onSit = seat.onSit, onStand = seat.onStand;
  let owning = false, baseFov = 68, baseEdge = 0.1;
  const cam = () => ctx.player?.camera ?? ctx.camera;
  seat.onSit = () => {
    ctx.input?.keys?.clear?.();
    if (!owning) { owning = true; baseFov = cam()?.fov ?? 68; baseEdge = ctx.fx?.edgeBlur ?? 0.1; }
    ctx.audio?.play('step', { surface: 'rock', pos: seat.stand });   // settling into the chair
    onSit?.();
  };
  seat.onStand = () => { ctx.input?.keys?.clear?.(); onStand?.(); };

  const seated = () => { const p = ctx.player; return !!p && p.mode === 'sit' && p.seat === seat; };
  const active = () => seated() && ctx.player.sitDir !== -1;
  let time = 0, lastKey = -10, pulse = 0;
  let soundPos = null, lastCwd = getState().cwd;

  const term = {
    shell, glitch: 0, onRun: null, material, seat, item: null,
    get state() { return getState(); },
    active,
    enter() { return active() ? false : !!ctx.player?.sit(seat); },
    // (Not while rocks.exe runs: from its first dot to the cut back the player stays in the chair.)
    leave() { return active() && !shell.busy ? ctx.player.standUp() : false; },
    exec(line) { const o = shell.exec(line); if (shell.version !== drawn) draw(); return o; },
    key(e) {
      const snd = shell.key(e);
      if (snd) {
        // (A held key repeats its edit silently: a real one clicks once, going down.)
        if (!e.repeat) {
          soundPos ||= (keyboard ?? screen)?.getWorldPosition?.(new THREE.Vector3()) ?? null;
          const space = e.key === ' ' || e.code === 'Space';
          ctx.audio?.play(snd, { ...(soundPos ? { pos: soundPos } : {}), ...(space ? { space } : {}) });
        }
        lastKey = time;
      }
      if (shell.version !== drawn) draw();
      return snd;
    },
    returnFromFeed() { shell.returnFromFeed(); pulse = 1; if (shell.version !== drawn) draw(); },
    update(dt) {
      time += dt;
      // (The prompt shows the cwd: a save's restore changes it under the shell.)
      if (getState().cwd !== lastCwd) { lastCwd = getState().cwd; shell.version++; }
      const ran = shell.busy;
      shell.update(dt);
      if (ran && !shell.busy) pulse = Math.max(pulse, 0.6);   // came back on its own
      if (shell.version !== drawn) draw();
      pulse = Math.max(0, pulse - dt * 1.4);
      U.uTime.value = time;
      U.uK.value = (1 + atmo.uNight.value * 0.3) / Math.max(0.5, atmoState.exposure);
      U.uGlitch.value = Math.min(1, Math.max(term.glitch, pulse * pulse * 0.8));
      const blinkOn = time - lastKey < 0.5 || (time % BLINK) < BLINK * 0.55;
      U.uCursor.value.set(cursor.col, cursor.row, cursor.show && blinkOn ? 1 : 0, 0);
      // The view: narrowed onto the screen as the eye settles (in step with Player.sit's ease), and back.
      const p = ctx.player, c = cam();
      if (seated()) {
        if (!owning) { owning = true; baseFov = c?.fov ?? 68; baseEdge = ctx.fx?.edgeBlur ?? 0.1; }
        if (p.cameraControlled && c) {
          const e = smooth(p.sitT ?? 1);
          c.fov = THREE.MathUtils.lerp(baseFov, seat.fov, e);
          c.updateProjectionMatrix();
          if (ctx.fx && 'edgeBlur' in ctx.fx) ctx.fx.edgeBlur = THREE.MathUtils.lerp(baseEdge, 0, e);
        }
      } else if (owning && p?.cameraControlled !== false) {   // (a cutscene has the camera: given back after it)
        owning = false;
        if (c) { c.fov = baseFov; c.updateProjectionMatrix(); }
        if (ctx.fx && 'edgeBlur' in ctx.fx) ctx.fx.edgeBlur = baseEdge;
      }
    },
  };
  // (term.onRun returns false when the cutscene couldn't start: the shell then comes back by itself, soon.)
  shell.onRun = () => {
    pulse = Math.max(pulse, 0.35);
    if (!term.onRun) return false;
    return term.onRun(term) !== false;
  };
  shell.onExit = () => term.leave();

  if (screen) {
    term.item = ctx.interact?.add?.({
      name: 'bunker:terminal', meshes: [screen, keyboard].filter(Boolean), range: 2.4, exact: true, zone: 'surface',
      onPress: () => term.enter(),
    }) ?? null;
  }
  ctx.updaters?.push((dt) => term.update(dt));
  ctx.exitTerminal = () => term.leave();
  return term;
}
