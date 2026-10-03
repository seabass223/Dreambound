import { ctrlLetter } from '../props/terminalShell.js';

// The keyboard while seated at the bunker's terminal (props/terminal.js): every key goes to the shell instead of the
// game. A capture-phase keydown listener on window runs before the game's own (core/input.js, the menu's M), and
// stops them seeing the key: otherwise Space / E would press (standing you up), WASD would walk you off the chair and
// M would open the menu mid-word. It steps aside while the menu or a dialog is open (they take their keys), passes the
// F-keys (F5, F8's debug report, F12) and the browser's Ctrl / Cmd shortcuts except Ctrl+C, L, U, A and E (the
// shell's), though the game itself never hears those either (Ctrl+A would walk you out of the chair), and never traps
// keyup (Input's press guard needs Space / E let go). A key already held when you sat (the E that sat you) doesn't type
// as it auto-repeats. Escape leaves; so does losing the mouse (some browsers spend Escape on that and never send it),
// unless a dialog took it (F8's report); not while rocks.exe runs, nor during its cutscene.
// While seated, a small pill in the top right corner says how to get up (styled like ui/scopeExit.js).
// While the tube shows its picture (REMOTE_TRANSFORM, term.picture), none of those stands you up: term.leave() puts the
// picture away instead, as does any key (term.key), and the pill says so ("Back": Esc, a click or any key). Escape lets
// the mouse go as it does so, and you are still seated: a click that only takes the mouse back (core/input.js: no
// press) puts a picture away all the same.

const CSS = `
.term-exit { position: fixed; top: 22px; right: 22px; z-index: 20; display: flex; align-items: center; gap: 10px;
  padding: 8px 14px 8px 10px; border-radius: 999px; border: 1px solid rgba(216, 203, 176, 0.3);
  background: rgba(12, 10, 8, 0.5); color: #d8cbb0; font: 12px/1 Georgia, 'Times New Roman', serif; letter-spacing: 0.12em;
  text-transform: uppercase; cursor: pointer; opacity: 0; transform: translateY(-6px); pointer-events: none;
  transition: opacity 0.35s ease, transform 0.35s ease; backdrop-filter: blur(3px); }
.term-exit.on { opacity: 0.85; transform: none; pointer-events: auto; }
.term-exit:hover { opacity: 1; border-color: rgba(216, 203, 176, 0.7); }
.term-exit b { display: grid; place-items: center; min-width: 30px; height: 20px; padding: 0 6px; box-sizing: border-box;
  border-radius: 5px; border: 1px solid rgba(216, 203, 176, 0.5); font: 10px/1 Georgia, 'Times New Roman', serif;
  font-weight: normal; letter-spacing: 0.06em; text-transform: none; }
.term-exit small { font-size: 10px; opacity: 0.6; letter-spacing: 0.08em; text-transform: none; }
`;

const SHELL_CTRL = /^[cluae]$/;   // the shell's own Ctrl keys (by ctrlLetter); every other Ctrl / Cmd chord is the browser's

export function installTerminalKeys({ ctx, uiOpen = () => false }) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return () => {};
  const term = () => ctx.bunker?.terminal ?? null;
  const live = () => { const t = term(); return t && t.active() && !uiOpen() ? t : null; };

  // Keys pressed down since sitting (a repeat of any other is a key held from before).
  const down = new Set();
  const onKey = (e) => {
    const t = live();
    if (!t) { down.delete(e.code); return; }
    if (/^F\d+$/.test(e.key) || /^F\d+$/.test(e.code)) return;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey;
    // The browser's chords: its own default goes ahead, but the game's listeners never see them.
    if (ctrl && !SHELL_CTRL.test(ctrlLetter(e))) { e.stopImmediatePropagation(); return; }
    e.preventDefault();             // also: Tab's focus move, Space's scroll, Firefox's / and ' quick-find
    e.stopImmediatePropagation();
    if (!e.repeat) down.add(e.code);
    else if (!down.has(e.code)) return;
    if (e.key === 'Escape') { if (!ctx.inSequence?.()) t.leave(); return; }
    t.key(e);
  };
  const onUp = (e) => { down.delete(e.code); };
  const onLock = () => {
    if (document.pointerLockElement) return;
    const t = term();
    if (t?.active() && !ctx.inSequence?.() && !uiOpen()) t.leave();
  };
  // The picture up and the mouse free (an earlier Escape let it go): this click only locks it again, so Input presses
  // nothing; it puts the picture away here. (Not the pill's: that has its own click.)
  const onDown = (e) => {
    if (e.button !== 0 || document.pointerLockElement || el.contains(e.target)) return;
    const t = live();
    if (t?.picture) t.leave();
  };
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onUp, true);   // (only watched: Input still gets it)
  addEventListener('mousedown', onDown, true);
  document.addEventListener('pointerlockchange', onLock);

  // The hint.
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('button');
  el.className = 'term-exit';
  el.type = 'button';
  el.innerHTML = '<b>Esc</b><span>Leave</span><small>or click</small>';
  const what = el.querySelector('span'), how = el.querySelector('small');
  el.addEventListener('click', (e) => { e.stopPropagation(); term()?.leave(); });
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(el);
  let shown = false, back = false, raf = 0;
  const tick = () => {
    const t = term();
    const on = !!(t?.active() && !uiOpen() && !ctx.inSequence?.() && !t.shell.busy);
    if (on !== shown) { shown = on; el.classList.toggle('on', on); }
    // The picture up: Esc and a click put it away (so does any key) and you stay in the chair.
    const pic = !!t?.picture;
    if (pic !== back) { back = pic; what.textContent = pic ? 'Back' : 'Leave'; how.textContent = pic ? 'click or any key' : 'or click'; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    removeEventListener('keydown', onKey, true);
    removeEventListener('keyup', onUp, true);
    removeEventListener('mousedown', onDown, true);
    document.removeEventListener('pointerlockchange', onLock);
    cancelAnimationFrame(raf);
    el.remove();
    style.remove();
  };
}
