import { h, nextId, button } from './dom.js';

// Modal dialogs: an overlay over everything (the game, the Escape panel), keyboard-trapped. While one is open no key
// reaches the game or the Escape panel: Escape dismisses the dialog (when it may be dismissed), Tab cycles its buttons.
const stack = [];
export const isDialogOpen = () => stack.length > 0;

// actions: [{ label, value, variant = 'secondary', autofocus }]. Resolves with the chosen action's value, or
// dismissValue for Escape / a click outside (only when dismissible).
export function openDialog({ title, description = '', actions, dismissible = true, dismissValue = null }) {
  // A dialog needs the mouse: let go of it (the game re-takes it on the next click on the canvas).
  if (document.pointerLockElement) document.exitPointerLock();
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const titleId = nextId('dlg-title'), descId = nextId('dlg-desc');
    const entry = {};
    const btns = actions.map((a) => button({ label: a.label, variant: a.variant ?? 'secondary', onClick: () => done(a.value) }));
    const dialog = h('div', { class: 'ui-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': description ? descId : null },
      h('h2', { class: 'ui-dialog-title', id: titleId }, title),
      description ? h('p', { class: 'ui-dialog-description', id: descId }, description) : null,
      h('div', { class: 'ui-dialog-footer' }, btns));
    const overlay = h('div', { class: 'ui-overlay dark' }, dialog);
    // Clicks stay in the dialog (nothing under it, the canvas included, sees them).
    overlay.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.target === overlay && dismissible) done(dismissValue);
    });
    const onKey = (e) => {
      if (stack[stack.length - 1] !== entry) return;
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      if (e.code === 'Escape') { e.preventDefault(); if (dismissible) done(dismissValue); return; }
      if (e.code === 'Tab') {
        const i = btns.indexOf(document.activeElement);
        const n = (i < 0 ? 0 : i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length;
        e.preventDefault();
        btns[n].focus();
      }
    };
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onKey, true);
    function done(value) {
      removeEventListener('keydown', onKey, true);
      removeEventListener('keyup', onKey, true);
      stack.splice(stack.indexOf(entry), 1);
      overlay.remove();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
      resolve(value);
    }
    stack.push(entry);
    document.body.append(overlay);
    const first = actions.findIndex((a) => a.autofocus);
    btns[first >= 0 ? first : btns.length - 1]?.focus({ preventScroll: true });
  });
}

// Yes / no. A destructive confirm is red and starts with the focus on Cancel.
export function confirmDialog({ title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false }) {
  return openDialog({
    title, description, dismissValue: false,
    actions: [
      { label: cancelLabel, variant: 'outline', value: false, autofocus: destructive },
      { label: confirmLabel, variant: destructive ? 'destructive' : 'default', value: true, autofocus: !destructive },
    ],
  });
}
