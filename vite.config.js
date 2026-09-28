import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Stamped into debug reports (src/ui/debugReport.js).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  server: { port: 5173 },
  define: {
    __DREAMBOUND_VERSION__: JSON.stringify(pkg.version),
    __DREAMBOUND_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
