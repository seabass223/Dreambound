// DOM helpers for the UI kit, and its button (used by the other components).
let uid = 0;
export const nextId = (p = 'ui') => `${p}-${++uid}`;

// h('div', { class: 'x', onclick: fn, style: {...}, dataset: {...} }, ...children)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.el ?? c);
  return el;
}

// ---- button: variant default | secondary | outline | destructive | ghost; size default | sm | icon
export function button({ label, variant = 'default', size = 'default', onClick, title, disabled = false, ...rest }) {
  const el = h('button', { type: 'button', class: `ui-btn ui-btn-${variant}${size === 'sm' ? ' ui-btn-sm' : size === 'icon' ? ' ui-btn-icon' : ''}`, title, disabled, ...rest }, label);
  if (onClick) el.addEventListener('click', onClick);
  return el;
}
