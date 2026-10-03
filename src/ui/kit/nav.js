// Navigation pieces for the UI kit, on shadcn/ui conventions: item (a row that opens something, like shadcn's Item with
// a trailing chevron), toggleGroup (single-choice, like shadcn's ToggleGroup), buttonGroup (shadcn's ButtonGroup) and
// navStack (a drill-down: a root page of items, each sliding in a page of its own from the right, with a back button).
import { h, button } from './dom.js';

// Icons: 24-unit line drawings in the lucide style (stroke = currentColor), by name.
const ICONS = {
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
  footprints: '<path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z"/><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z"/>',
  pointer: '<path d="M4 4l7 16 2.5-6.5L20 11z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  bug: '<rect x="7" y="7" width="10" height="14" rx="5"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/><path d="M12 12v9"/><path d="M3 13h4"/><path d="M17 13h4"/><path d="M4 7l3 2"/><path d="M20 7l-3 2"/><path d="M4 20l3-2"/><path d="M20 20l-3-2"/>',
  // A battery all but flat: the outline, its terminal, and one sliver of charge (filled; class "charge" to colour it).
  batteryLow: '<rect x="2" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><rect class="charge" x="4.5" y="9.5" width="2.6" height="5" rx="0.7" fill="currentColor" stroke="none"/>',
};
export function icon(name, size = 18) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.6');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('ui-icon');
  el.innerHTML = ICONS[name] ?? '';
  return el;
}

// ---- item: a full-width row button: [icon] title / description [chevron]
export function item({ title, description, iconName, onClick }) {
  return h('button', { type: 'button', class: 'ui-item', onclick: onClick },
    iconName ? h('span', { class: 'ui-item-media' }, icon(iconName)) : null,
    h('span', { class: 'ui-item-content' },
      h('span', { class: 'ui-item-title' }, title),
      description ? h('span', { class: 'ui-item-description' }, description) : null),
    icon('chevronRight', 16));
}
export const itemGroup = (...items) => h('div', { class: 'ui-item-group', role: 'list' }, ...items);

// ---- toggleGroup: single choice among options [{ value, label }]; returns { el, get(), set(v) }.
export function toggleGroup({ options, value, onChange, label }) {
  let cur = value;
  const btns = options.map((o) => h('button', {
    type: 'button', class: 'ui-toggle', role: 'radio', 'data-value': o.value,
    onclick: () => { if (cur === o.value) return; cur = o.value; paint(); onChange?.(cur); },
  }, o.label ?? o.value));
  const el = h('div', { class: 'ui-toggle-group', role: 'radiogroup', 'aria-label': label }, ...btns);
  const paint = () => btns.forEach((b) => {
    const on = b.dataset.value === cur;
    b.setAttribute('aria-checked', String(on));
    b.dataset.state = on ? 'on' : 'off';
    b.tabIndex = on ? 0 : -1;
  });
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (options.findIndex((o) => o.value === cur) + d + options.length) % options.length;
    btns[i].click();
    btns[i].focus();
  });
  paint();
  return { el, focusEl: btns[0], get: () => cur, set(v) { cur = v; paint(); } };
}

// ---- buttonGroup: buttons joined into one bar.
export const buttonGroup = (...buttons) => h('div', { class: 'ui-btn-group', role: 'group' }, ...buttons);

// ---- navStack: a root page and one level of pages below it. The root lists its pages as items; opening one slides
// it in from the right (the root slides out left), with its title and a back button above its content.
// root: { title, content: [...] } — pages: [{ id, title, description, iconName, content: () => [...] }]
// Returns { el, open(id), back(), reset(), depth }.
export function navStack({ root, pages }) {
  const rootPage = h('div', { class: 'ui-nav-page' },
    h('div', { class: 'ui-nav-header' }, h('h2', { class: 'ui-card-title' }, root.title)),
    ...(root.content ?? []),
    itemGroup(...pages.map((p) => item({ title: p.title, description: p.description, iconName: p.iconName, onClick: () => api.open(p.id) }))));
  const sub = h('div', { class: 'ui-nav-page' });
  const track = h('div', { class: 'ui-nav-track' }, rootPage, sub);
  const el = h('div', { class: 'ui-nav', 'data-depth': '0' }, track);
  // Focus moving inside a page must never scroll the viewport sideways (the slide is the track's transform).
  el.addEventListener('scroll', () => { if (el.scrollLeft) el.scrollLeft = 0; });
  const built = {};
  let current = null;
  const backBtn = button({ label: icon('chevronLeft', 18), variant: 'ghost', size: 'icon', 'aria-label': 'Back', onClick: () => api.back() });
  const subTitle = h('h2', { class: 'ui-card-title' });
  const subHeader = h('div', { class: 'ui-nav-header' }, backBtn, subTitle);
  const setDepth = (d) => {
    el.dataset.depth = String(d);
    rootPage.inert = d !== 0;
    sub.inert = d !== 1;
  };
  const api = {
    el,
    get depth() { return current ? 1 : 0; },
    get page() { return current; },
    open(id) {
      const p = pages.find((q) => q.id === id);
      if (!p) return;
      current = p;
      built[id] ||= h('div', { class: 'ui-nav-body' }, ...p.content());
      subTitle.textContent = p.title;
      sub.replaceChildren(subHeader, built[id]);
      sub.scrollTop = 0;
      setDepth(1);
      backBtn.focus({ preventScroll: true });
    },
    back() {
      if (!current) return;
      const was = current;
      current = null;
      setDepth(0);
      rootPage.querySelectorAll('.ui-item')[pages.indexOf(was)]?.focus({ preventScroll: true });
    },
    // Straight back to the root, without the slide (the menu reopening).
    reset() {
      el.classList.add('ui-nav-instant');
      current = null;
      setDepth(0);
      rootPage.scrollTop = 0;
      void el.offsetWidth;
      el.classList.remove('ui-nav-instant');
    },
  };
  setDepth(0);
  return api;
}
