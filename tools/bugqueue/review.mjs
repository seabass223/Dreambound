// The bug report review page: http://127.0.0.1:5197 (.claude/launch.json "bug-review"). Lists the reports in bugs/
// (lib.mjs) with their screenshots, descriptions and debug snapshots; pending ones get Approve / Reject and a comment
// for Claude, which goes into review.json and task.md. It also pulls the queue every minute (and on "Pull now").
// Local only: it listens on 127.0.0.1, answers only to that host, and a review must come from its own page (a custom
// header no other site can send without a CORS preflight, which it never grants).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, pull, review, listReports, BUGS, ROOT, STATES, FOLDER_RE } from './lib.mjs';

const PORT = +(process.env.BUG_REVIEW_PORT || 5197);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const env = loadEnv();
const KIT = path.join(ROOT, 'src/ui/kit');

let lastPull = { at: null, result: null };
let pulling = null;
async function doPull() {
  if (!env.queueSas) { lastPull = { at: new Date().toISOString(), result: { errors: ['BUG_QUEUE_SAS is not set in tools/bugqueue/.env'] } }; return lastPull; }
  pulling ??= pull(env, { log: (l) => console.log(l) })
    .then((result) => { lastPull = { at: new Date().toISOString(), result }; })
    .catch((e) => { lastPull = { at: new Date().toISOString(), result: { errors: [e.message] } }; })
    .finally(() => { pulling = null; });
  await pulling;
  return lastPull;
}
doPull();
setInterval(doPull, 60000);

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readJson = (req) => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 20000) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
});

http.createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host)) return send(res, 421, { error: 'wrong host' });
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && u.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (req.method === 'GET' && (u.pathname === '/kit/theme.css' || u.pathname === '/kit/kit.css')) return send(res, 200, fs.readFileSync(path.join(KIT, path.basename(u.pathname))), 'text/css');
    if (req.method === 'GET' && u.pathname === '/api/reports') return send(res, 200, { reports: listReports(), lastPull, autoApprove: !!env.autoApproveId, configured: !!env.queueSas });
    const shot = /^\/shot\/(\w+)\/([\w-]+)\.jpg$/.exec(u.pathname);
    if (req.method === 'GET' && shot && STATES.includes(shot[1]) && FOLDER_RE.test(shot[2])) {
      const f = path.join(BUGS, shot[1], shot[2], 'screenshot.jpg');
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'image/jpeg') : send(res, 404, { error: 'no screenshot' });
    }
    if (req.method === 'POST') {
      if (req.headers['x-bug-review'] !== '1' || (req.headers.origin && !HOSTS.has(req.headers.origin.replace(/^https?:\/\//, '')))) return send(res, 403, { error: 'forbidden' });
      if (u.pathname === '/api/pull') return send(res, 200, await doPull());
      const m = /^\/api\/review\/([\w-]+)$/.exec(u.pathname);
      if (m) {
        const body = await readJson(req);
        return send(res, 200, review(m[1], body.decision, body.comment, 'you'));
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`bug review on http://127.0.0.1:${PORT}`));

const PAGE = `<!doctype html>
<html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bug reports</title>
<link rel="stylesheet" href="/kit/theme.css"><link rel="stylesheet" href="/kit/kit.css">
<style>
  body { margin: 0; min-height: 100vh; background: var(--background); color: var(--foreground); }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 60px; }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
  header h1 { margin: 0; font-weight: normal; font-size: 22px; letter-spacing: 0.06em; }
  .pull { font-size: 12.5px; color: var(--muted-foreground); }
  .pull.bad { color: oklch(0.7 0.18 30); }
  .list { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
  .rep { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; padding: 14px; }
  .rep > * { min-width: 0; }
  .rep img { width: 100%; border-radius: var(--radius); border: 1px solid var(--border); background: #000; cursor: zoom-in; display: block; }
  .noshot { display: grid; place-items: center; height: 170px; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--muted-foreground); font-size: 13px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; font-size: 13px; color: var(--muted-foreground); }
  .who { color: var(--foreground); font-size: 15px; }
  .badge { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border); }
  .badge.auto { color: oklch(0.78 0.12 140); border-color: color-mix(in oklch, oklch(0.78 0.12 140) 40%, var(--border)); }
  .desc { margin: 8px 0 10px; white-space: pre-wrap; font-size: 14.5px; line-height: 1.5; }
  .desc.empty { color: var(--muted-foreground); font-style: italic; }
  .note { margin: 8px 0 0; padding: 8px 10px; border-left: 2px solid var(--primary); background: color-mix(in oklch, var(--muted) 50%, transparent); font-size: 13px; white-space: pre-wrap; }
  .note b { font-weight: normal; color: var(--muted-foreground); }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
  .actions .ui-spacer { flex: 1; }
  .empty-list { padding: 40px; text-align: center; color: var(--muted-foreground); }
  @media (max-width: 720px) { .rep { grid-template-columns: minmax(0, 1fr); } }
</style></head>
<body class="ui-surface"><div class="wrap">
  <header>
    <h1>Bug reports</h1>
    <div class="ui-toggle-group" role="radiogroup" id="tabs"></div>
    <span class="ui-spacer"></span>
    <span class="pull" id="pull"></span>
    <button class="ui-btn ui-btn-secondary ui-btn-sm" id="pullBtn" type="button">Pull now</button>
  </header>
  <div class="list" id="list"></div>
</div>
<script>
const TABS = [['pending', 'Pending'], ['approved', 'Approved'], ['done', 'Done'], ['rejected', 'Rejected']];
let tab = 'pending', data = { reports: [] };
const drafts = {};   // comment drafts by folder, kept across refreshes
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c); return e; };
const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleString(); };
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bug-Review': '1' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function renderTabs() {
  const n = (s) => data.reports.filter((r) => r.state === s).length;
  $('#tabs').replaceChildren(...TABS.map(([id, label]) => el('button', { type: 'button', class: 'ui-toggle', role: 'radio', 'data-state': tab === id ? 'on' : 'off', 'aria-checked': String(tab === id), onclick: () => { tab = id; render(); } }, label + ' (' + n(id) + ')')));
}
function card(r) {
  const shot = r.hasShot ? el('img', { src: '/shot/' + r.state + '/' + r.folder + '.jpg', alt: 'Screenshot', loading: 'lazy', onclick: (e) => window.open(e.target.src, '_blank') }) : el('div', { class: 'noshot' }, 'No screenshot');
  const auto = r.review?.by?.startsWith('verifier');
  const right = el('div', {},
    el('div', { class: 'meta' }, el('span', { class: 'who' }, r.reporter || 'anonymous'), auto ? el('span', { class: 'badge auto' }, 'verifier · auto-approved') : null,
      el('span', {}, ago(r.sentAt)), el('span', {}, r.summary), el('span', {}, '#' + r.id.slice(0, 8))),
    el('p', { class: 'desc' + (r.description ? '' : ' empty') }, r.description || 'No description'),
    r.review?.comment ? el('p', { class: 'note' }, el('b', {}, (r.review.decision === 'reject' ? 'Rejected' : 'Approved') + ' · your comment: '), r.review.comment) : null,
    r.resolution ? el('p', { class: 'note' }, el('b', {}, 'Resolution: '), r.resolution) : null,
    el('details', { class: 'ui-collapsible', style: 'margin-top:10px' }, el('summary', {}, 'Debug info'), el('pre', {}, JSON.stringify(r.report, null, 2))));
  if (r.state === 'pending') {
    const ta = el('textarea', { class: 'ui-input ui-textarea', rows: 2, placeholder: 'Comment for Claude (optional): what to look at, what you expect…', 'aria-label': 'Comment' });
    ta.value = drafts[r.folder] ?? '';
    ta.addEventListener('input', () => { drafts[r.folder] = ta.value; });
    const status = el('span', { class: 'pull' });
    const decide = async (decision, btns) => {
      btns.forEach((b) => (b.disabled = true));
      try { await post('/api/review/' + r.folder, { decision, comment: ta.value }); delete drafts[r.folder]; await refresh(); }
      catch (e) { status.textContent = 'Failed: ' + e.message; status.className = 'pull bad'; btns.forEach((b) => (b.disabled = false)); }
    };
    const rej = el('button', { type: 'button', class: 'ui-btn ui-btn-outline ui-btn-sm' }, 'Reject');
    const ok = el('button', { type: 'button', class: 'ui-btn ui-btn-default ui-btn-sm' }, 'Approve');
    rej.onclick = () => decide('reject', [rej, ok]);
    ok.onclick = () => decide('approve', [rej, ok]);
    right.append(el('div', { style: 'margin-top:10px' }, ta), el('div', { class: 'actions' }, status, el('span', { class: 'ui-spacer' }), rej, ok));
  }
  return el('div', { class: 'rep ui-card' }, shot, right);
}
function render() {
  renderTabs();
  const rows = data.reports.filter((r) => r.state === tab);
  const typing = document.activeElement?.tagName === 'TEXTAREA';
  if (typing) return;   // don't pull the rug out from under a comment being written (drafts survive anyway)
  $('#list').replaceChildren(...(rows.length ? rows.map(card) : [el('div', { class: 'empty-list ui-card' }, tab === 'pending' ? 'Nothing waiting for review.' : 'Nothing here yet.')]));
  const lp = data.lastPull;
  const errs = lp?.result?.errors ?? [];
  $('#pull').textContent = !data.configured ? 'Queue not configured (tools/bugqueue/.env)' : lp?.at ? 'Pulled ' + ago(lp.at) + (errs.length ? ' · ' + errs[0] : '') : 'Not pulled yet';
  $('#pull').className = 'pull' + (errs.length || !data.configured ? ' bad' : '');
}
async function refresh() { data = await (await fetch('/api/reports')).json(); render(); }
$('#pullBtn').onclick = async () => { $('#pullBtn').disabled = true; try { await post('/api/pull'); } catch {} $('#pullBtn').disabled = false; refresh(); };
refresh();
setInterval(refresh, 10000);
</script></body></html>`;
