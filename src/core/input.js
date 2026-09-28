// Keyboard + pointer-lock mouse input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.listeners = { press: [], release: [], firstClick: [] };
    this.started = false;
    this.interactHeld = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); this._press(); }
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' || e.code === 'KeyE') this._release();
    });
    addEventListener('blur', () => { this.keys.clear(); this._release(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not available in some embeds */ }
        if (!this.started) { this.started = true; this.listeners.firstClick.forEach((f) => f()); }
        return;
      }
      if (e.button === 0) this._press();
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this._release(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
  }

  _press() { if (this.interactHeld) return; this.interactHeld = true; this.listeners.press.forEach((f) => f()); }
  _release() { if (!this.interactHeld) return; this.interactHeld = false; this.listeners.release.forEach((f) => f()); }
  on(ev, f) { this.listeners[ev].push(f); }

  axis() {
    const k = this.keys;
    return {
      x: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      y: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
  }

  consumeMouse() { const d = { x: this.dx, y: this.dy }; this.dx = 0; this.dy = 0; return d; }
}
