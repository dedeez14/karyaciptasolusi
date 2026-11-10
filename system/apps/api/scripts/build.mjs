// Production build of the API: a clean dist/ compiled by the TypeScript compiler (what `nest build` did).
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(resolve(apiDir, 'dist'), { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--incremental', 'false'], { cwd: apiDir, stdio: 'inherit' });
process.exit(r.status ?? 1);
