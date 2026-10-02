import { h, nextId, button } from './dom.js';

// Modal dialogs: an overlay over everything (the game, the menu), keyboard-trapped. While one is open no key reaches
// the game or the menu (typing in its fields still works): Escape dismisses it (when it may be dismissed), Tab cycles
// through its controls.
const stack = [];
export const isDialogOpen = () => stack.length > 0;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// modal: any content and footer. Returns { dialog, close(), set dismissible }. onDismiss runs for Escape or a click
// outside (only while dismissible); close() closes it without.
export function modal({ title, description = '', content = [], footer = [], dismissible = true, onDismiss, initialFocus = null, wide = false, role = 'dialog' }) {
  // A dialog needs the mouse: let go of it (the game re-takes it on the next click on the canvas).
  if (document.pointerLockElement) document.exitPointerLock();
  const prevFocus = document.activeElement;
  const titleId = nextId('dlg-title'), descId = nextId('dlg-desc');
  const entry = {};
  const dialog = h('div', { class: 'ui-dialog' + (wide ? ' ui-dialog-wide' : ''), role, 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': description ? descId : null },
    h('h2', { class: 'ui-dialog-title', id: titleId }, title),
    description ? h('p', { class: 'ui-dialog-description', id: descId }, description) : null,
    ...content,
    footer.length ? h('div', { class: 'ui-dialog-footer' }, footer) : null);
  const overlay = h('div', { class: 'ui-overlay dark' }, dialog);
  const api = { dialog, dismissible, close };
  const dismiss = () => { if (api.dismissible) { close(); onDismiss?.(); } };
  // Clicks stay in the dialog (nothing under it, the canvas included, sees them).
  overlay.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (e.target === overlay) dismiss();
  });
  const onKey = (e) => {
    if (stack[stack.length - 1] !== entry) return;
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    if (e.code === 'Escape') { e.preventDefault(); dismiss(); return; }
    if (e.code === 'Tab') {
      const els = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const i = els.indexOf(document.activeElement);
      const n = i < 0 ? 0 : (i + (e.shiftKey ? els.length - 1 : 1)) % els.length;
      e.preventDefault();
      els[n].focus();
    }
  };
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    removeEventListener('keydown', onKey, true);
    removeEventListener('keyup', onKey, true);
    stack.splice(stack.indexOf(entry), 1);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.({ preventScroll: true });
  }
  stack.push(entry);
  document.body.append(overlay);
  (initialFocus ?? dialog.querySelector(FOCUSABLE))?.focus({ preventScroll: true });
  return api;
}

// actions: [{ label, value, variant = 'secondary', autofocus }]. Resolves with the chosen action's value, or
// dismissValue for Escape / a click outside (only when dismissible).
export function openDialog({ title, description = '', actions, dismissible = true, dismissValue = null }) {
  return new Promise((resolve) => {
    const btns = actions.map((a) => button({ label: a.label, variant: a.variant ?? 'secondary', onClick: () => { m.close(); resolve(a.value); } }));
    const first = actions.findIndex((a) => a.autofocus);
    const m = modal({
      title, description, footer: btns, dismissible, role: 'alertdialog',
      onDismiss: () => resolve(dismissValue),
      initialFocus: btns[first >= 0 ? first : btns.length - 1],
    });
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
