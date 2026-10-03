import { icon } from './kit/nav.js';

// A soft centre dot, the only stand-in for the hidden (pointer-locked) OS cursor. It grows a little over
// anything the Space / E / click interaction would press.
//
// flash(name) puts a small line glyph where the dot is instead (the kit's icon of that name), for a press that did
// nothing: the bunker terminal without power shows a flat battery. It blinks twice, holds, and fades; it shows even
// with the Pointer setting off (it answers a press, it isn't a pointer), and hideFlash() takes it away at once (main.js,
// when the menu or a dialog opens).
const CSS = `
#reticle { position: fixed; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: #f1ead9; box-shadow: 0 0 3px rgba(0, 0, 0, 0.35); pointer-events: none; z-index: 5; opacity: 0;
  transition: opacity 0.35s ease, transform 0.18s ease; }
#reticle.on { opacity: 0.42; }
#reticle.on.hot { opacity: 0.85; transform: scale(1.7); }
#reticle.under { opacity: 0 !important; transition: opacity 0.08s ease; }
#reticle-flash { position: fixed; left: 50%; top: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; pointer-events: none;
  z-index: 5; opacity: 0; color: #f1ead9; filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55)); }
#reticle-flash svg { display: block; width: 100%; height: 100%; stroke-width: 1.25; }
#reticle-flash .charge { fill: #ec4f3a; }
`;

const SIZE = 28;   // px (the dot's 5, the menu's icons 18): 1.25 of the 24 units is a ~1.5 px line
const FADE = 0.6;  // s: the last of a flash

export function createReticle() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'reticle';
  document.body.appendChild(el);
  const fl = document.createElement('div');
  fl.id = 'reticle-flash';
  fl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fl);
  // The glyphs, made once each (the battery up front).
  const glyphs = {};
  const glyph = (name) => (glyphs[name] ||= icon(name, SIZE));
  glyph('batteryLow');
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = null, hot = null, anim = null, shownName = null;

  const end = () => { anim = null; el.classList.remove('under'); };
  return {
    // Only touches the DOM on change: this runs every frame.
    set(visible, pressable) {
      if (anim && anim.playState === 'finished') end();   // (as well as onfinish: events wait on a rendered frame)
      const h = visible && pressable;
      if (visible !== shown) { shown = visible; el.classList.toggle('on', visible); }
      if (h !== hot) { hot = h; el.classList.toggle('hot', h); }
    },
    // The glyph `name` over the dot for secs: in, two blinks, a hold, out. Again while it shows: starts over.
    flash(name, secs = 1.6) {
      if (typeof fl.animate !== 'function') return;
      if (shownName !== name) { shownName = name; fl.replaceChildren(glyph(name)); }
      anim?.cancel();
      el.classList.add('under');   // (the dot would sit in the middle of it)
      const T = Math.max(0.8, secs);
      const o = (t) => Math.min(1, Math.max(0, t / T));
      const on = 0.95, off = 0.1, s0 = 'scale(0.86)', s1 = 'scale(1)';
      const k = (t, opacity, transform = s1) => ({ offset: o(t), opacity, transform });
      const fadeAt = Math.max(0.6, T - FADE);
      const frames = still
        ? [k(0, 0, s1), k(0.12, on), k(fadeAt, on), k(T, 0)]
        : [k(0, 0, s0), k(0.07, on), k(0.3, on), k(0.36, off), k(0.47, off), k(0.53, on), k(fadeAt, on), k(T, 0)];
      anim = fl.animate(frames, { duration: T * 1000, easing: 'linear', fill: 'none' });
      const mine = anim;
      anim.onfinish = () => { if (anim === mine) end(); };
    },
    hideFlash() {
      if (!anim) return;
      anim.cancel();
      end();
    },
  };
}
