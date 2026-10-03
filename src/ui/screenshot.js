// F7 takes a screenshot: the next frame, as drawn (the game's view, without the menu or the centre dot, which are
// page elements over it), saved as a PNG named for the moment (dreambound-2026-10-02_14-03-22.png). A short note says so.
// Call afterRender() right after each frame is drawn: the canvas is only readable until the next one starts.

const CSS = `
.shot-toast { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 8px); padding: 7px 12px; z-index: 30;
  font: 12px var(--font-sans, system-ui); color: var(--foreground, #eee); background: var(--card, #1b1916);
  border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); box-shadow: var(--shadow-lg, none);
  opacity: 0; pointer-events: none; transition: opacity 0.25s ease, transform 0.25s ease; }
.shot-toast.show { opacity: 1; transform: translate(-50%, 0); }
`;

export function createScreenshot({ canvas, enabled = () => true }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const toast = document.createElement('div');
  toast.className = 'shot-toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  let hideT = 0;
  const say = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(hideT);
    hideT = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  let pending = false;
  addEventListener('keydown', (e) => {
    if (e.code !== 'F7') return;
    e.preventDefault();   // (F7 is the browser's caret browsing)
    if (!e.repeat && enabled()) pending = true;
  });

  const stamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  };
  return {
    afterRender() {
      if (!pending) return;
      pending = false;
      try {
        canvas.toBlob((blob) => {
          if (!blob) { say('Screenshot failed'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `dreambound-${stamp()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          say('Screenshot saved');
        }, 'image/png');
      } catch (err) {
        console.error('[screenshot]', err);
        say('Screenshot failed');
      }
    },
  };
}
