// Pull bug reports off the Azure queue into bugs/ (see lib.mjs).
//   node tools/bugqueue/pull.mjs            drain the queue once
//   node tools/bugqueue/pull.mjs --watch    keep pulling every 60 s
// Prints one JSON summary per pull: { pulled: [{ folder, state }], skipped, poisoned, errors, pending, approved }.
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, pull, BUGS } from './lib.mjs';

const env = loadEnv();
const count = (s) => { try { return fs.readdirSync(path.join(BUGS, s)).filter((f) => !f.startsWith('.')).length; } catch { return 0; } };
async function once() {
  let r;
  try { r = await pull(env, { log: (l) => console.error(l) }); } catch (e) { r = { pulled: [], skipped: 0, poisoned: 0, errors: [e.message] }; }
  console.log(JSON.stringify({ ...r, pending: count('pending'), approved: count('approved') }));
  return r;
}
if (process.argv.includes('--watch')) {
  for (;;) { await once(); await new Promise((res) => setTimeout(res, 60000)); }
} else {
  const r = await once();
  process.exitCode = r.errors.length && !r.pulled.length ? 1 : 0;   // (not process.exit(): on Windows it can trip over fetch's closing sockets)
}
