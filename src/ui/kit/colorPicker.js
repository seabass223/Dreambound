import { h, button } from './dom.js';

// An in-page color picker (not the OS one <input type=color> opens): a swatch trigger that opens a panel under its
// row with a saturation/value square, a hue bar, a hex field and a preview, plus a reset to `neutral`. Drag with the
// mouse, pen or touch (pointer capture), or use the arrow keys (Shift for bigger steps). onInput(hex) fires live.
// Only one picker is open at a time.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(s) {
  const m = HEX.exec(String(s).trim());
  if (!m) return null;
  const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return '#' + x.toLowerCase();
}
function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
function hsvToRgb(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)];
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (hh * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

let openPicker = null;

export function colorPicker({ value = '#808080', neutral = '#808080', onInput }) {
  let hex = parseHex(value) ?? neutral;
  let hsv = rgbToHsv(...hexToRgb(hex));

  const swatch = h('span', { class: 'ui-swatch' });
  const text = h('span');
  const trigger = h('button', { type: 'button', class: 'ui-color-trigger', 'aria-expanded': 'false', 'aria-haspopup': 'true' }, swatch, text);
  const svThumb = h('div', { class: 'ui-thumb' });
  const sv = h('div', { class: 'ui-sv', tabindex: '0', role: 'slider', 'aria-label': 'Saturation and brightness' }, svThumb);
  const hueThumb = h('div', { class: 'ui-thumb' });
  const hue = h('div', { class: 'ui-hue', tabindex: '0', role: 'slider', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360' }, hueThumb);
  const preview = h('span', { class: 'ui-swatch' });
  const hexIn = h('input', { class: 'ui-input', type: 'text', maxlength: '7', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Hex color' });
  const reset = button({ label: 'Neutral', variant: 'ghost', size: 'sm', title: `Back to ${neutral}`, onClick: () => { setHex(neutral); emit(); } });
  const panel = h('div', { class: 'ui-color-panel', hidden: true }, sv, hue, h('div', { class: 'ui-color-row' }, preview, hexIn, h('div', { class: 'ui-spacer' }), reset));

  const paint = () => {
    sv.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    svThumb.style.background = hex;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${hsv.h}, 100%, 50%)`;
    hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    sv.setAttribute('aria-valuetext', `saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
    swatch.style.background = preview.style.background = hex;
    text.textContent = hex;
    if (document.activeElement !== hexIn) { hexIn.value = hex; hexIn.removeAttribute('aria-invalid'); }
  };
  const fromHsv = () => { hex = rgbToHex(...hsvToRgb(hsv.h, hsv.s, hsv.v)); paint(); };
  const emit = () => onInput?.(hex);
  // A new hex from outside keeps the hue it had when it is a grey (a grey has none).
  function setHex(v) {
    const x = parseHex(v);
    if (!x || x === hex) return paint();
    hex = x;
    const n = rgbToHsv(...hexToRgb(x));
    hsv = { h: n.s ? n.h : hsv.h, s: n.s, v: n.v };
    paint();
  }

  // Pointer drags on the square and the bar.
  const drag = (el, apply) => {
    const at = (e) => { const r = el.getBoundingClientRect(); apply(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)); fromHsv(); emit(); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      at(e);
    });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) at(e); });
  };
  drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
  drag(hue, (x) => { hsv.h = Math.min(359.999, x * 360); });

  const keys = (el, apply) => el.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    apply(d[0] * (e.shiftKey ? 10 : 1), d[1] * (e.shiftKey ? 10 : 1));
    fromHsv(); emit();
  });
  keys(sv, (dx, dy) => { hsv.s = clamp01(hsv.s + dx / 100); hsv.v = clamp01(hsv.v + dy / 100); });
  keys(hue, (dx, dy) => { hsv.h = (hsv.h + dx + dy + 360) % 360; });

  // Live while typing once there are six digits; a three-digit short form counts when the field is left.
  const typed = (short) => {
    const raw = hexIn.value.trim().replace(/^#/, '');
    const x = raw.length === 6 || short ? parseHex(raw) : null;
    hexIn.toggleAttribute('aria-invalid', !x && (short || raw.length >= 6));
    if (x && x !== hex) { setHex(x); emit(); }
  };
  hexIn.addEventListener('input', () => typed(false));
  hexIn.addEventListener('change', () => typed(true));
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); });
  hexIn.addEventListener('blur', paint);

  const api = {
    el: trigger, panel, focusEl: trigger,
    get: () => hex,
    set: (v) => setHex(v),
    open() {
      if (openPicker && openPicker !== api) openPicker.close();
      openPicker = api;
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      paint();
      panel.scrollIntoView?.({ block: 'nearest' });
    },
    close() {
      if (openPicker === api) openPicker = null;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    },
    get isOpen() { return !panel.hidden; },
  };
  trigger.addEventListener('click', () => (api.isOpen ? api.close() : api.open()));
  paint();
  return api;
}

export const closeColorPickers = () => openPicker?.close();
