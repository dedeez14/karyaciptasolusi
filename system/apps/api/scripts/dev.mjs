// Development: compile on change (tsc --watch) and restart the API when the output changes (node --watch).
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const main = resolve(apiDir, 'dist', 'main.js');

if (!existsSync(main)) {
  const first = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: apiDir, stdio: 'inherit' });
  if (first.status !== 0) process.exit(first.status ?? 1);
}
const children = [
  spawn(process.execPath, [tsc, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { cwd: apiDir, stdio: 'inherit' }),
  spawn(process.execPath, ['--watch-path=dist', '--watch-preserve-output', 'dist/main.js'], { cwd: apiDir, stdio: 'inherit' }),
];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && stop());
