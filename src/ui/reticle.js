// A soft centre dot, the only stand-in for the hidden (pointer-locked) OS cursor. It grows a little over
// anything the Space / E / click interaction would press.
const CSS = `
#reticle { position: fixed; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: #f1ead9; box-shadow: 0 0 3px rgba(0, 0, 0, 0.35); pointer-events: none; z-index: 5; opacity: 0;
  transition: opacity 0.35s ease, transform 0.18s ease; }
#reticle.on { opacity: 0.42; }
#reticle.on.hot { opacity: 0.85; transform: scale(1.7); }
`;

export function createReticle() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'reticle';
  document.body.appendChild(el);
  let shown = null, hot = null;
  return {
    // Only touches the DOM on change: this runs every frame.
    set(visible, pressable) {
      const h = visible && pressable;
      if (visible !== shown) { shown = visible; el.classList.toggle('on', visible); }
      if (h !== hot) { hot = h; el.classList.toggle('hot', h); }
    },
  };
}
