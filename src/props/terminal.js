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
//
// It runs off the hub generator (props/cave.js), which can't carry it with the Home (dome) and Mountain lines on
// as well: until both are switched off the tube is dark and silent. It still answers the reticle (it's plainly a thing
// to use); pressing it gets a dead click and the low-battery glyph (ui/reticle.js flash) instead of the chair.
//
// REMOTE_TRANSFORM (the word on the note in the lounge desk's drawer) puts a picture on the tube: public/models/
// bunker_mars.jpg, loaded with the room (bunkerRoom.js) and drawn by the same shader, in its own colours, under the
// tube's curve, scanlines, vignette and glass. The text goes out and the tube is black for a beat; the picture then
// arrives as a slow-scan frame does, drawn down the tube a line at a time behind the beam's bright line, its newest
// lines noisy and not yet locked; then it is steady, its blacks black (the unlit tube's blue gives way under it).
// Meanwhile the shell is locked and nothing stands you up: a click, Escape or any key (everything that goes through
// term.leave(), and term.key()) puts the picture away instead (it collapses to a line and is gone) and you are back at
// a fresh prompt, still seated. It goes dark with the tube if the power dies, and isn't saved.

// Whether the bunker has power: Home and Mountain both shed (no cave built, as in some tests: always).
export const bunkerPowered = (ctx) => !ctx.power || (ctx.power.dome === false && ctx.power.mountain === false);
const WARM = 0.9, COOL = 0.25;   // s: the tube coming up to brightness, and collapsing
// The picture's beats (s). dark: from Enter to its first line (the text out in the first `fade` of it); scan: its top
// line to its bottom one; settle: the last noise dying after that; out: from the click to the prompt (the collapse
// takes `collapse` of it, the rest is black). guard: from that click, how long leave() goes on doing nothing (a double
// click, or a browser's Escape and its letting the mouse go arriving apart, mustn't stand you up as well). past: how far
// below the picture the beam's line runs (off the glass). gain: its brightness against the text's (scanlines take a
// fifth back).
export const PICTURE = { dark: 0.5, fade: 0.08, scan: 2.0, settle: 0.7, out: 0.2, collapse: 0.12, guard: 0.5, past: 1.04, gain: 1.0 };

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
uniform sampler2D uPic;    // REMOTE_TRANSFORM's picture (sRGB, its top row first; one black texel when there is none)
uniform vec4 uPicA;        // the text put out 0..1; the picture drawn this far down (0: none, to a little past 1);
                           // its height (1; to 0 as it collapses); how unsettled its newest lines are 0..1
uniform float uPicGain;
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
  float txt = 1.0 - uPicA.x;                   // (the text gives the tube up to the picture)
  vec2 t = vec2(0.0);
  if (txt > 0.0) t = textAt(g, gx, gy, true) * txt;
  vec3 split = vec3(t.x);
  if (gl > 0.02 && txt > 0.0) {
    float sh = 0.45 * gl + 0.25 * bandOn;
    split.r = textAt(g + vec2(sh, 0.0), gx, gy, false).x * txt;
    split.b = textAt(g - vec2(sh, 0.0), gx, gy, false).x * txt;
  }
  float core = t.x;
  vec3 col = uHalo * t.y * uLook.y;                                         // the halo
  col += mix(uTint, uHot, smoothstep(0.45, 1.35, core)) * split;            // the strokes, whiter where brightest
  // The picture, in its own colours, filling the tube (its raster the bulged 0..1, so its edges bow a little inside
  // the glass's). It arrives as a slow-scan frame: drawn down the glass a line at a time behind the beam's bright line,
  // the newest lines noisy, a few dropped, and not yet locked sideways; then steady, with a little grain. Put away, it
  // collapses onto the tube's middle line, brightening as it goes.
  vec2 spx = dFdx(sp), spy = dFdy(sp);
  float grain = h21(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5;
  float lit = 0.0;                                                          // 1 where the picture is drawn
  if (uPicA.y > 0.0) {
    float hgt = max(uPicA.z, 0.001);
    vec2 q = vec2(sp.x, 0.5 + (0.5 - sp.y) / hgt);                          // across and down the picture
    float under = q.y - uPicA.y;                                            // > 0: not drawn yet
    float fresh = exp(min(under, 0.0) * 14.0) * uPicA.w;                    // 1 on the newest line, dying up the tube
    float lr = h21(vec2(floor(q.y * 240.0), floor(uTime * 24.0)));          // (per line, 24 times a second)
    q.x += (lr - 0.5) * 0.02 * fresh * fresh;
    vec3 s = textureGrad(uPic, q, vec2(spx.x, -spx.y / hgt), vec2(spy.x, -spy.y / hgt)).rgb * uPicGain;
    s *= 1.0 - 0.6 * fresh * step(0.86, lr);
    s = s * (1.0 + grain * (0.06 + 0.9 * fresh)) + vec3(0.1 * fresh * (0.5 + grain));
    float inPic = step(0.0, q.y) * step(q.y, 1.0) * step(0.0, q.x) * step(q.x, 1.0);
    float ue = under / 0.0035;
    lit = inPic * step(under, 0.0);
    col += s * (lit * mix(3.0, 1.0, min(hgt, 1.0)));
    col += uHot * (1.6 * inPic * exp(-ue * ue));                            // the beam's line
  }
  // Scanlines (eight to a text row), faded where they'd be finer than a couple of pixels.
  float sl = g0.y * 8.0;
  float fw = fwidth(sl);
  float beam = 0.5 + 0.5 * cos(fract(sl) * 6.2831853);
  float scan = 1.0 - uLook.z * (1.0 - smoothstep(0.25, 0.6, fw)) * beam;
  float roll = exp(-pow((fract(sp.y * 0.8 - uTime * 0.11) - 0.5) * 6.0, 2.0));
  float flick = 1.0 + 0.012 * sin(uTime * 377.0) + 0.01 * sin(uTime * 23.0 + 1.3) * sin(uTime * 3.1);
  float vig = clamp(1.0 - 0.55 * pow(length(c * vec2(1.0, 1.2)) * 1.35, 3.0), 0.0, 1.0);
  // (The unlit tube's blue gives way under the picture: its blacks, the redaction box, are black.)
  vec3 back = uBack * (0.75 + 0.25 * scan) * (1.0 + 0.6 * roll) * (1.0 - lit);
  vec3 e = (col * scan * (1.0 + 0.05 * roll) + back) * flick * vig;
  e += uTint * grain * (0.012 + 0.5 * gl);
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

// createTerminal(ctx, { screen, seat, keyboard, picture, cols, rows }) -> term (call it at build time: it makes its
// material and textures at once).
//   screen: the glass mesh, a 4:3 face with UVs 0..1 over it as glTF exports them (u right, v down the glass); it gets
//     this module's material. Don't LOD-fade it (a ShaderMaterial has no dithered twin): hide it, or fade: false.
//   seat: { eye, stand (Vector3, world), yaw, pitch, fov } (+ optional yawRange, pitchMin, pitchMax, dip, onSit,
//     onStand, which it chains); the missing ones are filled in.
//   keyboard: an optional dedicated (invisible) pick mesh over the keyboard, pressed like the screen.
//   picture: the 4:3 picture REMOTE_TRANSFORM shows (a Texture: sRGB, flipY false, as the room's others), or nothing
//     (a missing file, or a headless stub with no image): the command then only says it has no carrier. Either way the
//     material is the same program: the sampler (material.uniforms.uPic) holds a black texel when there's no picture,
//     and whatever it holds decides (a test gives it one there).
// term: { state, shell, exec(line), key(e), active(), enter(), leave(), glitch, onRun, returnFromFeed(), update(dt),
//   material, seat, item, powered(), level, picture }. onRun(term) is called once, when rocks.exe has printed its four
//   dots; the shell then waits (no prompt) for returnFromFeed() (or comes back by itself after 30 s, or 1 s when onRun
//   is unset or returns false), and after a real run holds the chair ~2 s more while rocks.exe prints its verdict. Never
//   call returnFromFeed() from inside onRun. enter() refuses (false) while unpowered; level is the tube's brightness,
//   0..1, following powered() (bunkerRoom.js dims the screen's glint by it). picture: what the picture is doing ('dark',
//   'scan', 'hold', or 'out' as it is put away), null when the tube shows the shell; while it isn't null, leave() puts
//   the picture away and returns false (nobody stands up), and key() does the same with any key; leave() goes on
//   returning false until PICTURE.guard after that.
export function createTerminal(ctx, { screen, seat, keyboard = null, picture = null, cols = COLS, rows = ROWS }) {
  ctx.state ??= {};
  const getState = () => (ctx.state.terminal ||= { ran: false, cwd: '/home/operator' });
  getState();
  // (rocks.exe asks the observatory's flag each time: a save's restore sets it under the shell)
  const shell = createShell({ state: getState, cols, rows, coords: () => !!ctx.state.observatory?.coords });

  // ---- the screen ----
  const atlas = glyphAtlas();
  const cells = new Uint8Array(cols * rows * 4);
  const charTex = new THREE.DataTexture(cells, cols, rows);
  charTex.magFilter = charTex.minFilter = THREE.NearestFilter;
  charTex.generateMipmaps = false;
  // (the picture's stand-in, so the sampler is bound and the program the same without it)
  const noPic = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  noPic.needsUpdate = true;
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
    uPic: { value: picture?.isTexture && picture.image ? picture : noPic },
    uPicA: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPicGain: { value: PICTURE.gain },
  };
  const GAIN = U.uLook.value.w;   // (uLook.w carries the power: 0 is a dead tube, glass and all, the same program)
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
  const powered = () => bunkerPowered(ctx);
  let time = 0, lastKey = -10, pulse = 0;
  let soundPos = null, lastCwd = getState().cwd;
  let level = powered() ? 1 : 0;
  const where = () => (soundPos ||= (keyboard ?? screen)?.getWorldPosition?.(new THREE.Vector3()) ?? null);
  const play = (name, opt = {}) => { const pos = where(); ctx.audio?.play(name, { ...(pos ? { pos } : {}), ...opt }); };

  // ---- the picture (REMOTE_TRANSFORM) ----
  // { phase, t }: 'dark' (the text out, a held black), 'scan' (drawn down the tube), 'hold' (steady), 'out' (put away:
  // the collapse, a blink of black, then the shell), 'dead' (the power went: frozen as it was while the tube dies).
  let pic = null;
  let held = null;   // the key that put it away, while it may still be down (its repeats aren't typed)
  let guard = -1;    // (on `time`) until then leave() stands nobody up: what put the picture away may come twice
  const A = U.uPicA.value;
  const showing = () => !!pic && pic.phase !== 'dead';
  const clearPicture = () => { pic = null; A.set(0, 0, 1, 0); };
  // Back to the shell: the text as it was, a fresh prompt under the command, a little tear as it comes.
  function endPicture() {
    clearPicture();
    shell.release();
    pulse = Math.max(pulse, 0.35);
    if (shell.version !== drawn) draw();
  }
  // Put away (a click, Escape, any key): once.
  function dismiss() {
    if (!showing() || pic.phase === 'out') return;
    pic.phase = 'out'; pic.t = 0;
    A.x = 1;
    guard = time + PICTURE.guard;
    play('glitch', { dur: PICTURE.out, amt: 0.5 });
  }
  // The shell asks for it: only with a picture to show, on a live tube.
  shell.onPicture = () => {
    if (U.uPic.value === noPic || !powered()) return false;
    pic = { phase: 'dark', t: 0 };
    A.set(0, 0, 1, 1);
    pulse = Math.max(pulse, 0.5);   // the text tears as it goes
    play('feedCut');
    return true;
  };
  function updatePicture(dt, on) {
    // The power gone: it dies with the tube (and the shell is the shell again under it).
    if (pic.phase === 'dead') { if (on || level <= 0) clearPicture(); return; }
    if (!on) { pic.phase = 'dead'; shell.release(); return; }
    // Out of the chair some other way (Travel's standUp, a restored save): gone at once.
    if (!active()) { endPicture(); return; }
    pic.t += dt;
    if (pic.phase === 'dark' && pic.t >= PICTURE.dark) { pic.phase = 'scan'; pic.t -= PICTURE.dark; }
    if (pic.phase === 'scan' && pic.t >= PICTURE.scan) { pic.phase = 'hold'; pic.t -= PICTURE.scan; }
    if (pic.phase === 'dark') A.x = Math.min(1, pic.t / PICTURE.fade);
    else if (pic.phase === 'scan') A.set(1, Math.max(1e-4, (pic.t / PICTURE.scan) * PICTURE.past), 1, 1);
    else if (pic.phase === 'hold') A.set(1, PICTURE.past, 1, Math.max(0, 1 - pic.t / PICTURE.settle));
    else if (pic.t >= PICTURE.out) endPicture();
    else {
      const u = Math.min(1, pic.t / PICTURE.collapse);
      A.z = (1 - u) * (1 - u);
      if (u >= 1) A.y = 0;
    }
  }

  const term = {
    shell, glitch: 0, onRun: null, material, seat, item: null,
    get state() { return getState(); },
    get level() { return level; },
    get picture() { return showing() ? pic.phase : null; },
    active, powered,
    enter() { return active() || !powered() ? false : !!ctx.player?.sit(seat); },
    // The picture up: this puts it away instead, and nobody stands (the next one does, once PICTURE.guard has passed
    // since: a double click is one click).
    // (Not while rocks.exe runs: from its first dot until it has had its say the player stays in the chair.)
    leave() {
      if (showing()) { dismiss(); return false; }
      if (time < guard) return false;
      return active() && !shell.busy ? ctx.player.standUp() : false;
    },
    exec(line) { const o = shell.exec(line); if (shell.version !== drawn) draw(); return o; },
    key(e) {
      // (The key that put the picture away types nothing afterwards either, however long it's held.)
      const id = e.code || e.key;
      if (e.repeat && held !== null && id === held) return null;
      if (!e.repeat) held = null;
      const up = showing();   // (before the shell has the key: the Enter that asks for the picture doesn't put it away)
      const snd = shell.key(e);
      if (snd) {
        // (A held key repeats its edit silently: a real one clicks once, going down.)
        if (!e.repeat) {
          const pos = where();
          const space = e.key === ' ' || e.code === 'Space';
          ctx.audio?.play(snd, { ...(pos ? { pos } : {}), ...(space ? { space } : {}) });
        }
        lastKey = time;
      }
      // Any key puts the picture away (the shell, locked, typed nothing): not a modifier alone, nor a held key's repeats.
      if (up && snd && !e.repeat) { dismiss(); held = id; }
      if (shell.version !== drawn) draw();
      return snd;
    },
    returnFromFeed() { shell.returnFromFeed(); pulse = 1; if (shell.version !== drawn) draw(); },
    update(dt) {
      time += dt;
      // (The prompt shows the cwd: a save's restore changes it under the shell.)
      if (getState().cwd !== lastCwd) { lastCwd = getState().cwd; shell.version++; }
      const waiting = shell.phase === 'feed';
      shell.update(dt);
      if (waiting && shell.phase !== 'feed') pulse = Math.max(pulse, 0.6);   // came back on its own
      if (shell.version !== drawn) draw();
      pulse = Math.max(0, pulse - dt * 1.4);
      // The power: the tube warms up, or collapses. Should it die under someone sitting at it (only a dev's switch
      // could: the switches are a cave away), they get up, unless rocks.exe is holding them.
      const on = powered();
      level = on ? Math.min(1, level + dt / WARM) : Math.max(0, level - dt / COOL);
      if (pic) updatePicture(dt, on);
      if (!on && active() && !shell.busy) term.leave();
      U.uLook.value.w = GAIN * (on ? smooth(level) : level * level);
      U.uTime.value = time;
      U.uK.value = (1 + atmo.uNight.value * 0.3) / Math.max(0.5, atmoState.exposure);
      U.uGlitch.value = Math.min(1, Math.max(term.glitch, pulse * pulse * 0.8));
      const blinkOn = time - lastKey < 0.5 || (time % BLINK) < BLINK * 0.55;
      U.uCursor.value.set(cursor.col, cursor.row, cursor.show && blinkOn && level > 0 ? 1 : 0, 0);
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

  // Pressed without power: the item stays enabled (the reticle still lights on it), but all you get is a dead click and
  // the low-battery glyph where the dot is.
  const refuse = () => {
    const pos = where();
    ctx.audio?.play('noPower', pos ? { pos } : {});
    ctx.reticle?.flash?.('batteryLow');
  };
  if (screen) {
    term.item = ctx.interact?.add?.({
      name: 'bunker:terminal', meshes: [screen, keyboard].filter(Boolean), range: 2.4, exact: true, zone: 'surface',
      onPress: () => { if (powered()) term.enter(); else refuse(); },
      blocked: () => (powered() ? null : 'batteryLow'),   // why a press does nothing (for the debug report)
    }) ?? null;
  }
  ctx.updaters?.push((dt) => term.update(dt));
  ctx.exitTerminal = () => term.leave();
  return term;
}
