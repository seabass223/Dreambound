// The way out of the telescope view: a small "✕ Back" button in the top right corner while you're at the eyepiece.
// The game keeps the mouse (pointer lock) at the eyepiece, so any click, Space or E leaves (main.js's press handler);
// the button says so, and is also clickable itself whenever the cursor is free.

const CSS = `
.scope-exit { position: fixed; top: 22px; right: 22px; z-index: 20; display: flex; align-items: center; gap: 10px;
  padding: 8px 14px 8px 10px; border-radius: 999px; border: 1px solid rgba(216, 203, 176, 0.35);
  background: rgba(12, 10, 8, 0.55); color: #d8cbb0; font: 12px/1 Georgia, 'Times New Roman', serif; letter-spacing: 0.12em;
  text-transform: uppercase; cursor: pointer; opacity: 0; transform: translateY(-6px); pointer-events: none;
  transition: opacity 0.35s ease, transform 0.35s ease; backdrop-filter: blur(3px); }
.scope-exit.on { opacity: 1; transform: none; pointer-events: auto; }
.scope-exit:hover { border-color: rgba(216, 203, 176, 0.7); }
.scope-exit b { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid rgba(216, 203, 176, 0.5); font-weight: normal; font-size: 13px; letter-spacing: 0; }
.scope-exit small { font-size: 10px; opacity: 0.6; letter-spacing: 0.08em; text-transform: none; }
`;

export function createScopeExit(onExit) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('button');
  el.className = 'scope-exit';
  el.type = 'button';
  el.innerHTML = '<b>✕</b><span>Back</span><small>click · Esc</small>';
  el.addEventListener('click', (e) => { e.stopPropagation(); onExit(); });
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(el);
  return { show: (on) => el.classList.toggle('on', on) };
}
