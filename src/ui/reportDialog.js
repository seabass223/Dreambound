// The bug report dialog (Menu > Debug > Debug reports, then F8 or a middle click): the screenshot of the frame you
// reported from, a description to write, the debug snapshot attached (collapsed), and Send report, which
//   1. uploads the screenshot to the Blob SAS's container as reports/YYYY/MM/DD/<id>.jpg (metadata: reporter),
//   2. serializes { kind, v, id, reporter, sentAt, description, screenshot: { url, ... }, report } to JSON, and
//   3. adds it to the Queue SAS's queue (base64). A report too big for one message (64 KiB) goes up as
//      reports/.../<id>.json next to the screenshot, and the message carries `report: { overflow: { url, bytes } }`.
// A failed step can be retried; a screenshot already uploaded isn't sent again. Copy JSON copies the same message
// (without the screenshot's URL until it's uploaded). The SAS URLs are never put in the message.
import { h, button, modal, textarea, spacer, icon } from './kit/index.js';
import { checkSas, uploadBlob, enqueue, base64Utf8, QUEUE_MAX_CHARS } from '../net/azure.js';

const CSS = `
.report-shot-box { position: relative; margin: 14px 0 12px; }
.report-shot { display: block; width: 100%; max-height: 240px; object-fit: contain; border-radius: var(--radius);
  border: 1px solid var(--border); background: #000; }
.report-shot-box .ui-btn { position: absolute; top: 8px; right: 8px; background: color-mix(in oklch, var(--card) 85%, transparent);
  border-color: var(--border); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.report-shot-off { display: flex; align-items: center; gap: 10px; padding: 12px 14px; font-size: 13px; color: var(--muted-foreground);
  border: 1px dashed var(--border); border-radius: var(--radius); }
.report-who { margin: 6px 0 0; font-size: 13px; color: var(--muted-foreground); }
.report-who b { font-weight: normal; color: var(--foreground); }
.report-label { display: block; margin: 0 0 6px; font-size: 13px; color: var(--foreground); }
.report-status { min-height: 18px; margin: 10px 0 0; font-size: 13px; color: var(--muted-foreground); }
.report-status.bad { color: oklch(0.7 0.18 30); }
.report-status.ok { color: oklch(0.78 0.12 140); }
.report-dialog .ui-collapsible { margin-top: 12px; }
.report-dialog .ui-dialog-footer { align-items: center; }
`;
let styled = false;

const pad = (n) => String(n).padStart(2, '0');

// shot: { blob, width, height }; report: the debug snapshot (ui/debugReport.js); summary: one line about it;
// config: { reporter, blobSas, queueSas }; copy(text) -> bool; toast(text); openSettings() (Menu > Debug).
export function openReportDialog({ shot, report, summary, config, copy, toast, openSettings }) {
  if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
  const id = crypto.randomUUID();
  const reporter = (config.reporter ?? '').trim().slice(0, 64);
  const d = new Date();
  const base = `reports/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${id}`;
  const shotUrl = shot?.blob ? URL.createObjectURL(shot.blob) : null;
  let uploaded = null;        // { url } once the screenshot is up
  let withShot = !!shot?.blob;   // the screenshot goes with the report (Remove / Add back)
  let overflowUrl = null;     // the report's own blob, when it's too big for the queue
  let busy = false;

  const desc = textarea({ placeholder: 'What happened? What did you expect instead?', rows: 4, maxLength: 4000, label: 'Description' });
  const status = h('p', { class: 'report-status', role: 'status', 'aria-live': 'polite' });
  const setStatus = (text, cls = '') => { status.textContent = text; status.className = 'report-status' + (cls ? ' ' + cls : ''); };

  const message = () => ({
    kind: 'dreambound-bug-report',
    v: 1,
    id,
    reporter,
    sentAt: new Date().toISOString(),
    description: desc.get().trim(),
    screenshot: withShot ? {
      url: uploaded?.url ?? null,
      name: `${base}.jpg`,
      contentType: shot.blob.type || 'image/jpeg',
      bytes: shot.blob.size,
      width: shot.width,
      height: shot.height,
    } : null,
    report: overflowUrl ? { overflow: { url: overflowUrl, bytes: new Blob([JSON.stringify(report)]).size } } : report,
  });

  const blobCheck = checkSas(config.blobSas, 'blob'), queueCheck = checkSas(config.queueSas, 'queue');
  const configured = blobCheck.ok && queueCheck.ok;

  const copyBtn = button({ label: 'Copy JSON', variant: 'ghost', size: 'sm', onClick: async () => { setStatus(await copy(JSON.stringify(message(), null, 2)) ? 'Copied to the clipboard.' : 'Could not copy (logged to the console).'); } });
  const cancelBtn = button({ label: 'Cancel', variant: 'outline', onClick: () => close() });
  const sendBtn = button({ label: [icon('send', 15), 'Send report'], onClick: () => send() });
  sendBtn.disabled = !configured;

  // The screenshot, with Remove; removed, a line with Add back. (Once it's uploaded it stays: a retry resends only the
  // report.)
  const shotBox = h('div', { class: 'report-shot-box' });
  const paintShot = () => {
    if (!shotUrl) { shotBox.replaceChildren(h('p', { class: 'report-shot-off' }, 'No screenshot could be taken.')); return; }
    if (withShot) {
      const rm = button({ label: [icon('x', 14), 'Remove'], variant: 'outline', size: 'sm', onClick: () => { withShot = false; paintShot(); } });
      rm.hidden = !!uploaded;
      shotBox.replaceChildren(h('img', { class: 'report-shot', src: shotUrl, alt: 'Screenshot of the view when the report was made' }), rm);
    } else {
      shotBox.replaceChildren(h('div', { class: 'report-shot-off' }, 'The screenshot won’t be sent.', spacer(),
        button({ label: 'Add it back', variant: 'secondary', size: 'sm', onClick: () => { withShot = true; paintShot(); } })));
    }
  };
  paintShot();
  const who = h('p', { class: 'report-who' }, 'Reporting as ', h('b', {}, reporter || 'anonymous'),
    reporter ? null : ' · set a Reporter ID in Menu > Debug');
  const details = h('details', { class: 'ui-collapsible' },
    h('summary', {}, icon('chevronRight', 14), `Debug info (always attached) · ${summary}`),
    h('pre', {}, JSON.stringify(report, null, 2)));
  const content = [
    who,
    shotBox,
    h('label', { class: 'report-label', for: desc.el.id || (desc.el.id = `report-desc-${id.slice(0, 8)}`) }, 'Description'),
    desc.el,
    details,
    status,
  ];
  const m = modal({
    title: 'Send a bug report', wide: true, content, initialFocus: desc.el,
    footer: [copyBtn, spacer(), cancelBtn, sendBtn],
    onDismiss: () => cleanup(),
  });
  m.dialog.classList.add('report-dialog');
  if (!configured) {
    const fix = button({ label: 'Open Debug settings', variant: 'secondary', size: 'sm', onClick: () => { close(); openSettings?.(); } });
    const what = [!blobCheck.ok && `Blob SAS URL: ${blobCheck.text.toLowerCase()}`, !queueCheck.ok && `Queue SAS URL: ${queueCheck.text.toLowerCase()}`].filter(Boolean).join(' · ');
    status.replaceChildren(`To send, add the SAS URLs in Menu > Debug (${what}). `, fix);
  }
  // Ctrl / Cmd + Enter sends.
  desc.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !sendBtn.disabled) { e.preventDefault(); send(); } });

  function cleanup() { if (shotUrl) URL.revokeObjectURL(shotUrl); }
  function close() { m.close(); cleanup(); }
  const lock = (on) => {
    busy = on;
    m.dismissible = !on;
    for (const b of [copyBtn, cancelBtn, sendBtn, ...shotBox.querySelectorAll('button')]) b.disabled = on;
    desc.el.disabled = on;
  };

  async function send() {
    if (busy || !configured) return;
    lock(true);
    try {
      if (withShot && !uploaded) {
        setStatus('Uploading the screenshot…');
        uploaded = await uploadBlob(config.blobSas, `${base}.jpg`, shot.blob, { contentType: shot.blob.type || 'image/jpeg', metadata: { reporter: reporter || 'anonymous', report: id } });
        paintShot();   // uploaded: no more Remove
      }
      let text = JSON.stringify(message());
      if (!overflowUrl && base64Utf8(text).length > QUEUE_MAX_CHARS) {
        setStatus('The report is large: uploading it next to the screenshot…');
        overflowUrl = (await uploadBlob(config.blobSas, `${base}.json`, JSON.stringify(report), { contentType: 'application/json', metadata: { reporter: reporter || 'anonymous', report: id } })).url;
        text = JSON.stringify(message());
      }
      setStatus('Queuing the report…');
      await enqueue(config.queueSas, text);
      close();
      toast?.(`Report sent · ${id.slice(0, 8)}`);
    } catch (e) {
      console.error('[bug report]', e);
      lock(false);
      sendBtn.replaceChildren(icon('send', 15), 'Retry');
      setStatus(e.message + (uploaded ? ' · the screenshot is uploaded; Retry only sends the report.' : ''), 'bad');
    }
  }
  return { close };
}
