// The credits, after the ending (sequences/ending.js): on black, a slow upward scroll at a fixed speed, then "Thanks
// for playing" fades in and stays (until the page is reloaded).
//
// CREDITS is the whole roll, top to bottom; edit it freely. Each entry is one of:
//   'text'              a line (the first entry is set large, as the title)
//   ['Role', 'Name']    a role and a name under it
//   ''                  a gap
export const CREDITS = [
  'Dreambound',
  '',
  'A game by Kyle Sebestyen',
  '',
  'Built with three.js and Blender',
];

const SPEED = 0.07;    // of the screen's height per second
const LEAD = 0.6;      // s of black before the first line rises into view

const CSS = `
.credits { position: fixed; inset: 0; z-index: 8; pointer-events: none; background: #000; overflow: hidden;
  opacity: 0; visibility: hidden; transition: opacity 0.8s ease, visibility 0s linear 0.8s; }
.credits.on { opacity: 1; visibility: visible; transition: opacity 0.8s ease; }
.credits .roll { position: absolute; left: 0; right: 0; top: 100%; display: grid; justify-items: center; gap: 0.4em;
  padding: 0 24px; text-align: center; will-change: transform;
  font: 400 clamp(15px, 2.4vh, 26px)/1.5 Georgia, 'Times New Roman', serif; letter-spacing: 0.06em; color: #d8cbb0; }
.credits .roll .title { font-size: 2.3em; line-height: 1.1; letter-spacing: 0.08em; color: #e6dcc6; margin-bottom: 0.2em; }
.credits .roll .role { font-size: 0.72em; letter-spacing: 0.3em; text-transform: uppercase; color: rgba(216, 203, 176, 0.62); }
.credits .roll .gap { height: 1.6em; }
.credits .thanks { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); white-space: nowrap;
  font: italic 400 clamp(18px, 3.2vh, 34px)/1.2 Georgia, 'Times New Roman', serif; letter-spacing: 0.08em; color: #e6dcc6;
  opacity: 0; transition: opacity 3s ease; }
.credits .thanks.on { opacity: 1; }
`;

// Built up front, hidden (main.js, with the ending's other props): the style, the overlay and the roll. Headless (the
// regression harness), a stub whose roll() calls back at once.
let made = null;
export function createCredits(lines = CREDITS) {
  if (made) return made;
  if (typeof document === 'undefined' || !document.body || !document.head || !document.createElement) {
    return (made = { roll(onDone) { onDone?.(); }, hold() {}, rolling: false, el: null });
  }
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'credits';
  el.setAttribute('aria-hidden', 'true');
  const roll = document.createElement('div');
  roll.className = 'roll';
  lines.forEach((ln, i) => {
    if (Array.isArray(ln)) {
      const role = document.createElement('div'); role.className = 'role'; role.textContent = ln[0];
      const name = document.createElement('div'); name.textContent = ln[1] ?? '';
      roll.append(role, name);
    } else if (!ln) {
      const gap = document.createElement('div'); gap.className = 'gap'; roll.append(gap);
    } else {
      const line = document.createElement('div');
      if (i === 0) line.className = 'title';
      line.textContent = ln;
      roll.append(line);
    }
  });
  const thanks = document.createElement('div');
  thanks.className = 'thanks';
  el.append(roll, thanks);
  document.body.appendChild(el);

  let timer = 0;
  made = {
    el,
    rolling: false,
    // The roll, once: from just below the screen until its last line has gone off the top, then onDone. (Its own
    // clock, the compositor's: it runs on whatever the game is doing, and keeps going under the menu.)
    roll(onDone) {
      if (this.rolling) return;
      this.rolling = true;
      el.setAttribute('aria-hidden', 'false');
      el.classList.add('on');
      const h = Math.max(1, innerHeight);   // (a window with no height yet still rolls, and calls back)
      const travel = h + roll.offsetHeight;
      const secs = travel / (h * SPEED);
      roll.style.transition = 'none';
      roll.style.transform = 'translateY(0)';
      void roll.offsetHeight;   // (the start position applied before the transition)
      roll.style.transition = `transform ${secs.toFixed(2)}s linear ${LEAD}s`;
      roll.style.transform = `translateY(${-travel}px)`;
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); onDone?.(); };
      roll.addEventListener('transitionend', finish, { once: true });
      timer = setTimeout(finish, (secs + LEAD + 0.5) * 1000);   // (should the event not come)
    },
    // The closing line, fading in on black and staying.
    hold(text = 'Thanks for playing') {
      el.classList.add('on');
      thanks.textContent = text;
      void thanks.offsetHeight;
      thanks.classList.add('on');
      // The cursor back, for whatever comes next (a reload, closing the tab).
      if (document.pointerLockElement) document.exitPointerLock?.();
    },
  };
  return made;
}
