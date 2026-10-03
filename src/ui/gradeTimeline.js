import { h, button } from './kit/index.js';

// The color grading timeline (Menu > Color grading > Time of day): a strip across the day, midnight to midnight, the
// night shaded, a needle at the time it is now, and a dot for each key (a grade set at a time of day; filled with its
// highlights tone). Click the strip to add a key there (it starts as the grade showing at that time); drag a key to
// move it; the selected key's tones are the ones the page's Tones and Looks edit. The grade between keys eases from one
// to the next round the clock (settings.js, gradeAt).
//
// opts: keys() -> [{ t, highs, ... }] (t: phase, 0..1 from sunrise), selected() -> index, select(i), add(t), move(i, t),
// remove(i), phaseToHours(t), hoursToPhase(h), clockText(t), now() -> phase, dayFrac (sunset's phase).
// Returns { el, refresh() }: refresh redraws the keys and the needle (call after any change, and while open).

export const CSS = `
.cg-timeline { display: grid; gap: 8px; margin: 2px 0 10px; }
.cg-strip { position: relative; height: 34px; border-radius: var(--radius); border: 1px solid var(--border); cursor: copy;
  background: var(--muted); overflow: hidden; touch-action: none; }
.cg-strip .night { position: absolute; top: 0; bottom: 0; background: oklch(0.12 0.02 260 / 0.55); pointer-events: none; }
.cg-strip .needle { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--primary); opacity: 0.8; pointer-events: none; }
.cg-strip .needle::after { content: ''; position: absolute; top: -1px; left: -3px; border: 4px solid transparent; border-top-color: var(--primary); }
.cg-key { position: absolute; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; padding: 0;
  border: 2px solid var(--background); box-shadow: 0 0 0 1px var(--border); cursor: grab; }
.cg-key[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--ring); }
.cg-key:active { cursor: grabbing; }
.cg-ticks { position: relative; height: 12px; font: 10px var(--font-mono); color: var(--muted-foreground); }
.cg-ticks span { position: absolute; transform: translateX(-50%); }
.cg-ticks span:first-child { transform: none; } .cg-ticks span:last-child { transform: translateX(-100%); }
.cg-sel { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted-foreground); }
.cg-sel b { color: var(--foreground); font-weight: 600; font-variant-numeric: tabular-nums; }
.cg-sel .grow { margin-right: auto; }
`;

export function gradeTimeline(o) {
  const strip = h('div', { class: 'cg-strip', role: 'group', 'aria-label': 'Color grading keys through the day' });
  const pct = (t) => (o.phaseToHours(t) / 24) * 100 + '%';
  // a key's dot, kept a radius in from the ends so midnight's isn't cut in half
  const keyLeft = (t) => `calc(7px + (100% - 14px) * ${o.phaseToHours(t) / 24})`;
  // the night: sunset to midnight, and midnight to sunrise
  const n1 = h('div', { class: 'night' }), n2 = h('div', { class: 'night' });
  const needle = h('div', { class: 'needle' });
  strip.append(n1, n2, needle);
  const ticks = h('div', { class: 'cg-ticks' }, ...['00', '06', '12', '18', '24'].map((s, i) => h('span', { style: `left:${i * 25}%` }, s)));
  const selText = h('b', {});
  const prevBtn = button({ label: '‹', variant: 'ghost', size: 'sm', 'aria-label': 'Previous key', onClick: () => step(-1) });
  const nextBtn = button({ label: '›', variant: 'ghost', size: 'sm', 'aria-label': 'Next key', onClick: () => step(1) });
  const removeBtn = button({ label: 'Remove key', variant: 'outline', size: 'sm', onClick: () => o.remove(o.selected()) });
  const sel = h('div', { class: 'cg-sel' }, h('span', { class: 'grow' }, 'Editing the key at ', selText), prevBtn, nextBtn, removeBtn);
  const el = h('div', { class: 'cg-timeline' }, strip, ticks, sel);

  const step = (d) => {
    const ks = o.keys();
    if (!ks.length) return;
    const order = ks.map((k, i) => i).sort((a, b) => ks[a].t - ks[b].t);
    const at = order.indexOf(o.selected());
    o.select(order[(at + d + order.length) % order.length]);
  };
  // the strip's x (px from its left) as a phase
  const phaseAt = (clientX) => {
    const r = strip.getBoundingClientRect();
    const hours = Math.min(23.99, Math.max(0, ((clientX - r.left) / r.width) * 24));
    return o.hoursToPhase(hours);
  };
  let dots = [];
  let drag = null;
  strip.addEventListener('pointerdown', (e) => {
    const i = dots.indexOf(e.target);
    if (i >= 0) {
      o.select(i);
      drag = { i, id: e.pointerId, moved: false };
      strip.setPointerCapture(e.pointerId);
    } else if (e.target === strip) {
      o.add(phaseAt(e.clientX));
    }
    e.preventDefault();
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.moved = true;
    o.move(drag.i, phaseAt(e.clientX));
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; strip.releasePointerCapture?.(e.pointerId); } };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);

  function refresh() {
    const ks = o.keys();
    // a dot per key (rebuilt when the count changes, else moved and recoloured)
    if (dots.length !== ks.length) {
      for (const d of dots) d.remove();
      dots = ks.map(() => { const d = h('button', { class: 'cg-key', type: 'button' }); strip.appendChild(d); return d; });
    }
    ks.forEach((k, i) => {
      const d = dots[i];
      d.style.left = keyLeft(k.t);
      d.style.background = `linear-gradient(135deg, ${k.highs} 0 50%, ${k.shadows} 50% 100%)`;
      d.setAttribute('aria-pressed', String(i === o.selected()));
      d.setAttribute('aria-label', `Key at ${o.clockText(k.t)}`);
      d.title = o.clockText(k.t);
    });
    const sunset = (o.phaseToHours(o.dayFrac) / 24) * 100, sunrise = (o.phaseToHours(0) / 24) * 100;
    n1.style.left = sunset + '%'; n1.style.right = '0';
    n2.style.left = '0'; n2.style.width = sunrise + '%';
    needle.style.left = pct(o.now());
    const k = ks[o.selected()];
    selText.textContent = k ? o.clockText(k.t) : '-';
    removeBtn.disabled = ks.length <= 1;
    prevBtn.disabled = nextBtn.disabled = ks.length <= 1;
  }
  return { el, refresh };
}
