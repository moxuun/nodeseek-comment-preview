// Compatibility entry for existing test/release commands; bundling belongs to Vite.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
});
await build({ root, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) });
await import('./sync-description.mjs');
await import('./check-build.mjs');
