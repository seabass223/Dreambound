import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Stamped into debug reports (src/ui/debugReport.js).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The build number, yyyy-mm-dd.x: the (local) date and which build of that day this is, counted in a git-ignored
// file here, so it only means anything for builds made on this machine. Shown in the menu (src/ui/settings.js).
const BUILD_COUNTER = new URL('./.build-number.local', import.meta.url);
function nextBuildNumber() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  let last = {};
  try { last = JSON.parse(readFileSync(BUILD_COUNTER, 'utf8')); } catch { /* the first build here */ }
  const n = last.date === date && Number.isInteger(last.n) ? last.n + 1 : 1;
  writeFileSync(BUILD_COUNTER, JSON.stringify({ date, n }) + '\n');
  return `${date}.${n}`;
}

export default defineConfig(({ command }) => ({
  server: { port: 5173 },
  define: {
    __DREAMBOUND_VERSION__: JSON.stringify(pkg.version),
    __DREAMBOUND_BUILD__: JSON.stringify(new Date().toISOString()),
    // Blank in a dev run: only a build takes a number.
    __DREAMBOUND_BUILD_NUMBER__: JSON.stringify(command === 'build' ? nextBuildNumber() : ''),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
}));
