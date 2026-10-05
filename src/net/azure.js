// Azure Storage from the browser with SAS URLs only (no SDK, no account keys): a block blob upload and a queue message.
// Used by the bug report dialog (ui/reportDialog.js). The storage account needs CORS rules for the game's origin on
// both the Blob and the Queue service (see Agent-README.md, Debug reports).
//
// SAS URLs are bearer credentials: whoever holds one can do what it allows. The reports only need
//   blob:  a container SAS with Create + Write (sp=cw): it can add new blobs, not read, list, overwrite or delete;
//   queue: a queue SAS with Add (sp=a): it can add messages, not read or delete them.

const TIMEOUT_MS = 20000;
// A queue message holds at most 64 KiB of text (the base64 of the JSON, inside its XML envelope).
export const QUEUE_MAX_CHARS = 64 * 1024 - 128;

// Azurite (the local emulator) and similar dev endpoints: plain http on this machine, with the account in the path.
const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host);

// Check a SAS URL for a service ('blob' container or 'queue'). Returns { ok, level: 'ok' | 'warn' | 'bad', text,
// url, expires }: text is a line for the settings page.
export function checkSas(raw, kind) {
  const v = (raw ?? '').trim();
  if (!v) return { ok: false, level: 'bad', text: 'Not set' };
  let url;
  try { url = new URL(v); } catch { return { ok: false, level: 'bad', text: 'Not a URL' }; }
  const local = isLocal(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { ok: false, level: 'bad', text: 'Must be https' };
  const host = `.${kind}.core.windows.net`;
  if (!local && !url.hostname.endsWith(host)) return { ok: false, level: 'bad', text: `Host should end in ${host}` };
  const segs = url.pathname.split('/').filter(Boolean);
  const need = local ? 2 : 1;   // Azurite: /<account>/<container or queue>
  if (segs.length !== need) return { ok: false, level: 'bad', text: `Should name one ${kind === 'blob' ? 'container' : 'queue'} (…/${kind === 'blob' ? 'container' : 'queue'}?sv=…)` };
  const q = url.searchParams;
  if (!q.get('sig')) return { ok: false, level: 'bad', text: 'No signature (sig=) in the URL' };
  const se = q.get('se');
  const expires = se ? new Date(se) : null;
  if (expires && !Number.isNaN(+expires) && expires < new Date()) return { ok: false, level: 'bad', text: `Expired ${expires.toLocaleString()}`, url, expires };
  const sp = (q.get('sp') ?? '').toLowerCase();
  const needs = kind === 'blob' ? ['c', 'w'] : ['a'];
  // A SAS made from a stored access policy (si=) may carry no sp at all: its permissions (and often its expiry) live in
  // the policy on the storage account, which a browser can't see. Let it through; a send will say if it can't write.
  const si = q.get('si');
  if (!sp && si) return { ok: true, level: 'ok', text: '', url, expires };
  if (!needs.some((p) => sp.includes(p))) {
    const has = sp ? `This one has sp=${sp} (${[...sp].map((p) => PERM[p] ?? ALL_PERM[p] ?? p).join(', ')})` : 'This one has no sp=';
    return { ok: false, level: 'bad', text: `${has}; the game needs sp=${needs.join('')} to ${kind === 'blob' ? 'upload screenshots' : 'add reports'}`, url, expires };
  }
  const extra = [...sp].filter((p) => 'rldxp'.includes(p));
  const until = expires && !Number.isNaN(+expires) ? `expires ${relTime(expires)}` : 'no expiry found';
  if (extra.length) return { ok: true, level: 'warn', text: `Works, but also allows ${extra.map((p) => PERM[p]).join(', ')}: use sp=${needs.join('')} · ${until}`, url, expires };
  return { ok: true, level: 'ok', text: `Looks right · ${kind === 'blob' ? 'create + write' : 'add'} only · ${until}`, url, expires };
}
const PERM = { r: 'read', l: 'list', d: 'delete', x: 'delete versions', p: 'process' };
const ALL_PERM = { a: 'add', c: 'create', w: 'write', u: 'update', t: 'tags', f: 'filter', i: 'set immutability', m: 'move', e: 'execute', y: 'permanent delete' };
function relTime(d) {
  const days = (d - Date.now()) / 86400000;
  return days > 2 ? `in ${Math.round(days)} days` : days > 2 / 24 ? `in ${Math.round(days * 24)} hours` : `in ${Math.max(1, Math.round(days * 1440))} minutes`;
}

// The URL of an item inside the container / queue a SAS names (the SAS query kept), and the same without the SAS.
function itemUrl(sasUrl, name) {
  const u = new URL(sasUrl.trim());
  u.pathname = u.pathname.replace(/\/$/, '') + '/' + name.split('/').map(encodeURIComponent).join('/');
  const plain = new URL(u);
  plain.search = '';
  return { signed: u.toString(), plain: plain.toString() };
}

// Why a request failed, in words (Azure errors come back as XML with a <Code>).
async function failure(res, what) {
  let code = '';
  try { code = /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1] ?? ''; } catch { /* no body */ }
  const hint = res.status === 403 ? (code === 'AuthorizationPermissionMismatch' ? 'the SAS lacks the permission' : 'the SAS is expired, revoked or wrong')
    : res.status === 404 ? `the ${what} doesn't exist`
    : res.status === 409 ? 'it already exists'
    : res.status === 413 ? 'too large'
    : `HTTP ${res.status}`;
  const err = new Error(`${what}: ${hint}${code ? ` (${code})` : ''}`);
  err.status = res.status;
  err.code = code;
  return err;
}

async function send(url, init, what) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw await failure(res, what);
    return res;
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(e.name === 'AbortError' ? `${what}: timed out` : `${what}: the request was blocked or the network failed (check CORS on the storage account)`);
    err.network = true;
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// Upload a block blob into the SAS's container. metadata: { key: value } (sent as x-ms-meta-*, URI-encoded so any
// text is safe in a header). Returns { url } without the SAS.
export async function uploadBlob(containerSas, name, body, { contentType = 'application/octet-stream', metadata = {} } = {}) {
  const { signed, plain } = itemUrl(containerSas, name);
  const headers = { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType };
  for (const [k, v] of Object.entries(metadata)) headers[`x-ms-meta-${k}`] = encodeURIComponent(String(v));
  await send(signed, { method: 'PUT', headers, body }, 'Screenshot upload');
  return { url: plain };
}

// Base64 of a string's UTF-8 bytes (btoa alone only takes Latin-1).
export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Add a message to the SAS's queue: text sent base64-encoded (what Azure Functions queue triggers expect).
export async function enqueue(queueSas, text) {
  const b64 = base64Utf8(text);
  if (b64.length > QUEUE_MAX_CHARS) throw new Error(`Queue message: too large (${b64.length} characters)`);
  const { signed } = itemUrl(queueSas, 'messages');
  const body = `<QueueMessage><MessageText>${b64}</MessageText></QueueMessage>`;
  await send(signed, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body }, 'Queue message');
}
