// A small vanilla UI kit on shadcn/ui conventions (styles: kit.css, tokens: theme.css, from tweakcn). Every factory
// builds plain DOM. Controls return { el, get(), set(v) } (and optionally `output`, a value readout, and `panel`, an
// element that opens below the row); field() lays one out as a labelled row.
import './theme.css';
import './kit.css';
import { h, nextId, button } from './dom.js';
import { icon } from './nav.js';

export { h, nextId, button };

document.documentElement.classList.add('dark');

// ---- card: header (title, description), content, footer
export function card({ title, description, content = [], footer = [], ...rest }) {
  const body = h('div', { class: 'ui-card-content' }, content);
  const foot = footer.length ? h('div', { class: 'ui-card-footer' }, footer) : null;
  const el = h('div', { class: 'ui-card ui-surface', ...rest },
    title || description ? h('div', { class: 'ui-card-header' },
      title && h('h2', { class: 'ui-card-title' }, title),
      description && h('p', { class: 'ui-card-description' }, description)) : null,
    body, foot);
  return { el, body, footer: foot };
}

// ---- section: a titled group of rows inside a card
export const section = (title, ...children) => h('section', { class: 'ui-section' }, h('h3', { class: 'ui-section-title' }, title), ...children);
export const hint = (text) => h('p', { class: 'ui-hint' }, text);
export const spacer = () => h('div', { class: 'ui-spacer' });

// ---- field: label | control | value readout (inline: label | control, for switches); a control's panel opens below.
export function field({ label, control, inline = false }) {
  const id = control.id ?? nextId('f');
  if (control.focusEl) control.focusEl.id ||= id;
  const lab = h('label', { class: 'ui-label', for: control.focusEl?.id ?? id }, label);
  const row = h('div', { class: 'ui-field' + (inline ? ' ui-inline' : '') }, lab, control.el, !inline ? (control.output ?? h('span')) : null);
  if (control.panel) row.append(h('div', { class: 'ui-field-panel' }, control.panel));
  return row;
}

// ---- slider: a range input with a formatted readout.
export function slider({ min = 0, max = 1, step = 0.01, value = min, format = (v) => String(v), onInput }) {
  const input = h('input', { type: 'range', class: 'ui-slider', min, max, step });
  const output = h('output', { class: 'ui-value' });
  const paint = () => {
    const v = parseFloat(input.value);
    input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
    output.textContent = format(v);
  };
  input.addEventListener('input', () => { paint(); onInput?.(parseFloat(input.value)); });
  const api = {
    el: input, output, focusEl: input,
    get: () => parseFloat(input.value),
    set(v) { input.value = v; paint(); },
    get active() { return document.activeElement === input; },
  };
  api.set(value);
  return api;
}

// ---- switch: an on/off toggle (role=switch).
export function toggle({ checked = false, onChange }) {
  const el = h('button', { type: 'button', role: 'switch', class: 'ui-switch' });
  let on = checked;
  const paint = () => el.setAttribute('aria-checked', String(on));
  el.addEventListener('click', () => { on = !on; paint(); onChange?.(on); });
  paint();
  return { el, focusEl: el, get: () => on, set(v) { on = !!v; paint(); } };
}

// ---- select: options [{ value, label }]
export function select({ options, value, onChange }) {
  const el = h('select', { class: 'ui-select' }, options.map((o) => h('option', { value: o.value }, o.label ?? o.value)));
  if (value != null) el.value = value;
  el.addEventListener('change', () => onChange?.(el.value));
  return { el, focusEl: el, get: () => el.value, set(v) { el.value = v; } };
}

// ---- input: a text field (shadcn's Input). secret: masked, with a show / hide button. Returns { el, get(), set(v) }.
export function input({ value = '', placeholder = '', onInput, maxLength, secret = false, spellcheck = false, label }) {
  const el = h('input', { type: secret ? 'password' : 'text', class: 'ui-input ui-input-text', placeholder, maxLength, spellcheck, autocomplete: 'off', 'aria-label': label });
  el.value = value;
  el.addEventListener('input', () => onInput?.(el.value));
  let wrap = el;
  if (secret) {
    const eye = h('button', { type: 'button', class: 'ui-input-eye', 'aria-label': 'Show', title: 'Show' }, icon('eye', 16));
    eye.addEventListener('click', () => {
      const show = el.type === 'password';
      el.type = show ? 'text' : 'password';
      eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 16));
      eye.setAttribute('aria-label', show ? 'Hide' : 'Show');
      eye.title = show ? 'Hide' : 'Show';
    });
    wrap = h('div', { class: 'ui-input-wrap' }, el, eye);
  }
  return { el: wrap, focusEl: el, get: () => el.value, set(v) { if (document.activeElement !== el) el.value = v ?? ''; } };
}

// ---- textarea (shadcn's Textarea).
export function textarea({ value = '', placeholder = '', rows = 4, maxLength, onInput, label }) {
  const el = h('textarea', { class: 'ui-input ui-textarea', placeholder, rows, maxLength, 'aria-label': label });
  el.value = value;
  el.addEventListener('input', () => onInput?.(el.value));
  return { el, focusEl: el, get: () => el.value, set(v) { el.value = v ?? ''; } };
}

export { colorPicker, closeColorPickers, parseHex } from './colorPicker.js';
export { modal, openDialog, confirmDialog, isDialogOpen } from './dialog.js';
export { icon, item, itemGroup, toggleGroup, buttonGroup, navStack } from './nav.js';
