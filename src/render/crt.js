import * as THREE from 'three';
import { UV_VERT } from './rig.js';

// The 70s CRT screens' content, drawn in the fragment shader (the observatory's consoles, props/observatory.js, and the
// bunker's scope and radar, props/bunkerRoom.js). The screen meshes' UVs pack a mode and an id in their integer parts
// (mode + u, id + v; tools/blender/observatory_design.py screen()), un-flipped from glTF by UV_VERT (render/rig.js),
// which also declares what crt() needs: vObsUv, uObsTime, uObsK and the hashes oh() and oh1(). Use it as
//   UV_VERT(shader, SCREEN_FRAG);  ...  diffuseColor.rgb = crt(vObsUv, tint) * uObsK;
// A material may bend the oscilloscope's trace by defining CRT_SCOPE_Y(p, t, y) (a function of the screen point, the
// time and the stock trace's height, returning the height to draw) ahead of SCREEN_FRAG, and replace a terminal
// screen's scrolling text by defining CRT_TEXT(p, id, v) (the face point, the screen's id and the stock text's level,
// returning the level to draw): see createCrtMessage.
export { UV_VERT };

// CRT content by mode: 0 terminal text, 1 oscilloscope, 2 radar sweep, 3 bar graph, 4 guider star field.
export const SCREEN_FRAG = /* glsl */ `
vec3 crt(vec2 u, vec3 tint) {
  float mode = floor(u.x), id = floor(u.y);
  vec2 p = fract(u);
  float t = uObsTime + id * 7.13;
  float v = 0.0;
  if (mode < 0.5) {
    vec2 cell = vec2(40.0, 18.0);
    vec2 g = p * cell;
    float row = floor(g.y), col = floor(g.x);
    float scroll = floor(t * 0.9);
    float line = row - scroll;
    float len = oh(vec2(line, id)) * 34.0 + 4.0;
    vec2 sub = floor(fract(g) * vec2(4.0, 6.0));
    float glyph = step(0.42, oh(vec2(col * 3.1 + line * 17.0, sub.x + sub.y * 4.0))) * step(0.5, sub.y) * step(sub.x, 2.5);
    v = glyph * step(col, len) * step(1.0, col) * step(0.3, oh(vec2(col, line + 91.0)));
    float cursor = step(abs(row - 1.0), 0.1) * step(abs(col - floor(len * 0.4) - 1.0), 0.1) * step(0.5, fract(t * 1.6));
    v = max(v, cursor * step(sub.y, 5.5));
#ifdef CRT_TEXT
    v = CRT_TEXT(p, id, v);
#endif
  } else if (mode < 1.5) {
    vec2 grid = abs(fract(p * vec2(10.0, 8.0) + 0.5) - 0.5);
    v = 0.12 * (1.0 - smoothstep(0.0, 0.04, min(grid.x, grid.y)));
    float y = 0.5 + 0.3 * sin(p.x * 13.0 + t * 5.0) * (0.6 + 0.4 * sin(t * 0.7)) + 0.05 * sin(p.x * 61.0 - t * 17.0);
#ifdef CRT_SCOPE_Y
    y = CRT_SCOPE_Y(p, t, y);
#endif
    v += exp(-pow((p.y - y) * 60.0, 2.0)) * 1.2;
  } else if (mode < 2.5) {
    vec2 q = (p - 0.5) * vec2(1.25, 1.0);
    float r = length(q), a = atan(q.y, q.x + 1e-6);
    float sweep = mod(t * 1.3, 6.2831853);
    float lag = mod(sweep - a, 6.2831853);
    v = exp(-lag * 2.5) * 0.9 * step(r, 0.48);
    v += 0.15 * (1.0 - smoothstep(0.0, 0.006, abs(fract(r * 8.0 + 0.5) - 0.5) / 8.0)) * step(r, 0.48);
    for (int k = 0; k < 5; k++) {
      vec2 b = vec2(oh1(float(k) + id * 3.0), oh1(float(k) + 17.0 + id)) * 0.7 - 0.35;
      float ba = atan(b.y, b.x);
      float fresh = exp(-mod(sweep - ba, 6.2831853) * 0.9);
      v += fresh * (1.0 - smoothstep(0.008, 0.02, length(q - b))) * 1.5;
    }
  } else if (mode < 3.5) {
    float bars = 14.0;
    float bi = floor(p.x * bars);
    float h = 0.15 + 0.7 * (0.5 + 0.5 * sin(t * (1.0 + oh1(bi) * 2.0) + bi * 1.7)) * (0.6 + 0.4 * oh(vec2(bi, floor(t * 4.0))));
    float inBar = step(0.15, fract(p.x * bars)) * step(fract(p.x * bars), 0.85);
    v = inBar * step(p.y, h) * (0.7 + 0.3 * step(0.5, fract(p.y * 30.0)));
    v += 0.1 * step(abs(p.y - 0.05), 0.004);
  } else {
    vec2 q = p + vec2(t * 0.004, t * 0.0015);
    vec2 cell = floor(q * 24.0);
    vec2 f = fract(q * 24.0) - 0.5;
    float s = oh(cell);
    vec2 off = vec2(oh(cell + 3.1), oh(cell + 7.7)) - 0.5;
    float big = 0.3 + max(s - 0.82, 0.0) * 5.0;   // star size (guarded: no division by <= 0)
    v = step(0.82, s) * exp(-dot(f - off * 0.6, f - off * 0.6) * 90.0 / big) * 1.4;
    vec2 box = abs(p - vec2(0.5 + 0.02 * sin(t * 0.4), 0.5 + 0.02 * cos(t * 0.3)));
    v += 0.5 * step(max(box.x, box.y), 0.07) * step(0.062, max(box.x, box.y));
    v += 0.25 * step(abs(p.x - 0.5), 0.002) + 0.25 * step(abs(p.y - 0.5), 0.002);
  }
  float scan = 0.82 + 0.18 * sin(p.y * 420.0);
  float corner = smoothstep(0.75, 0.35, length((p - 0.5) * vec2(1.1, 1.2)));
  float flicker = 0.96 + 0.04 * sin(uObsTime * 57.0 + id);
  return tint * (0.05 + v) * scan * corner * flicker;
}
`;

// A fixed message on one terminal screen (the observatory desk's coordinates readout, sequences/coordsPan.js): its lines
// drawn once at boot into a canvas, one character centred in each cell of a grid on the face (R the strokes, struck
// twice a pixel apart as the beam spreads; G the phosphor's glow round them), and shown by CRT_TEXT on the screen whose
// id is uMsgId, instead of its scrolling text. How much of each row shows and where the block cursor sits are uniforms,
// so typing it out never touches the texture, and the screen's program is the same whatever it shows. Use it as
//   UV_VERT(sh, msg.frag + SCREEN_FRAG); Object.assign(sh.uniforms, msg.uniforms);
// lines: up to four rows of text. The grid (face units, 0..1 across and up the face as the UVs run): its left edge, the
// top of its first row, its width and the height of a row; cols: cells across (the longest line and one for the cursor
// after it). px: the canvas's width (its height follows the face's aspect, w / h), so a glyph keeps ~40 px across.
const MSG_FONT = '"Consolas", "Menlo", "DejaVu Sans Mono", "Lucida Console", "Courier New", monospace';

export const CRT_MESSAGE_FRAG = /* glsl */ `
uniform sampler2D uMsg;
uniform float uMsgId;      // the screen showing the message (-1: none)
uniform vec4 uMsgBox;      // the grid: left, top (face units, y up), cell width, row height
uniform vec4 uMsgRows;     // characters showing on rows 0..3
uniform vec4 uMsgCursor;   // the block cursor: col, row, lit (0..1)
uniform vec2 uMsgCurY;     // its top and bottom, down its cell (0..1): a capital's height, standing on the baseline
float crtMessage(vec2 p, float id, float v) {
  if (abs(id - uMsgId) > 0.5) return v;
  vec2 g = vec2(p.x - uMsgBox.x, uMsgBox.y - p.y) / uMsgBox.zw;   // in cells: across, and down from the top row
  vec2 cell = floor(g), f = g - cell;
  float shown = cell.y < 0.5 ? uMsgRows.x : cell.y < 1.5 ? uMsgRows.y : cell.y < 2.5 ? uMsgRows.z : uMsgRows.w;
  shown *= step(0.0, cell.y) * step(cell.y, 3.0);
  vec2 m = texture2D(uMsg, p).rg;
  float text = step(0.5, shown) * step(cell.x + 0.5, shown) * (m.r * 0.95 + m.g * 0.4);
  float cur = uMsgCursor.z * step(abs(cell.x - uMsgCursor.x), 0.1) * step(abs(cell.y - uMsgCursor.y), 0.1)
    * step(0.1, f.x) * step(f.x, 0.9) * step(uMsgCurY.x, f.y) * step(f.y, uMsgCurY.y);
  return max(text, cur * 1.2);
}
#define CRT_TEXT crtMessage
`;

export function createCrtMessage(lines, { cols = Math.max(...lines.map((l) => l.length)) + 1, left = 0.075, top = 0.7, width = 0.85, rowH = 0.1, px = 1280, aspect = 0.35 / 0.256 } = {}) {
  const cellW = width / cols;
  const uniforms = {
    uMsg: { value: null },
    uMsgId: { value: -1 },
    uMsgBox: { value: new THREE.Vector4(left, top, cellW, rowH) },
    uMsgRows: { value: new THREE.Vector4() },
    uMsgCursor: { value: new THREE.Vector4() },
    uMsgCurY: { value: new THREE.Vector2(0.24, 0.72) },
  };
  if (typeof document === 'undefined' || !document.body) {
    // Headless (the regression harness): a black stand-in.
    const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    tex.needsUpdate = true;
    uniforms.uMsg.value = tex;
  } else {
    const W = px, H = Math.round(px / aspect);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    // One advance a little narrower than a cell; no taller than ~70 % of a row.
    const cw = cellW * W, ch = rowH * H;
    g.font = `100px ${MSG_FONT}`;
    const size = Math.floor(Math.min((cw * 0.86 * 100) / g.measureText('M').width, ch * 0.7));
    g.font = `${size}px ${MSG_FONT}`;
    g.textBaseline = 'alphabetic';
    const m = g.measureText('M');
    const asc = m.actualBoundingBoxAscent ?? size * 0.66;
    const lineAsc = m.fontBoundingBoxAscent ?? size * 0.8, lineDesc = m.fontBoundingBoxDescent ?? size * 0.22;
    const baseIn = (ch - (lineAsc + lineDesc)) / 2 + lineAsc;   // the baseline, down from a row's top (px)
    uniforms.uMsgCurY.value.set((baseIn - asc) / ch, baseIn / ch);
    const each = (fn) => lines.forEach((line, r) => [...line].forEach((c, k) => {
      if (c === ' ') return;
      fn(c, (left + (k + 0.5) * cellW) * W - g.measureText(c).width / 2, (1 - top) * H + r * ch + baseIn);
    }));
    // The glow: green, blurred about a third of a cell; then the strokes added in red over it.
    g.fillStyle = '#0f0'; g.shadowColor = '#0f0'; g.shadowBlur = Math.round(cw * 0.36);
    each((c, x, y) => g.fillText(c, x, y));
    g.shadowBlur = 0; g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#f00';
    each((c, x, y) => { g.fillText(c, x - 0.6, y); g.fillText(c, x + 0.6, y); });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    uniforms.uMsg.value = tex;
  }
  // rows: [n0, n1, n2, n3] characters showing; cursor: [col, row] or null, lit: 0..1.
  const set = (rows, cursor = null, lit = 1) => {
    uniforms.uMsgRows.value.set(rows[0] ?? 0, rows[1] ?? 0, rows[2] ?? 0, rows[3] ?? 0);
    if (cursor) uniforms.uMsgCursor.value.set(cursor[0], cursor[1], lit, 0);
    else uniforms.uMsgCursor.value.z = 0;
  };
  return {
    frag: CRT_MESSAGE_FRAG, uniforms, lines, cols, set,
    show: (id) => { uniforms.uMsgId.value = id; },
    hide: () => { uniforms.uMsgId.value = -1; },
    get shown() { return uniforms.uMsgId.value >= 0; },
  };
}
