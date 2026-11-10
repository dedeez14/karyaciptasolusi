// Restores an encrypted backup produced by scripts/backup.mjs
//   node scripts/restore.mjs backups/kcs-<timestamp>.dump.enc
// WARNING: replaces the current database content. Stop the application first.
import { spawnSync } from 'node:child_process';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/restore.mjs <backup-file>');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(readFileSync(join(root, 'apps', 'api', '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const raw = readFileSync(file);
if (raw.subarray(0, 5).toString() !== 'KCSB1') throw new Error('Not a KCS backup file');
const key = Buffer.from(hkdfSync('sha256', Buffer.from(env.ENCRYPTION_KEY, 'base64'), Buffer.alloc(0), 'kcs-backup-v1', 32));
const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(5, 17));
decipher.setAuthTag(raw.subarray(17, 33));
const dump = Buffer.concat([decipher.update(raw.subarray(33)), decipher.final()]);
const url = new URL(env.MIGRATION_DATABASE_URL);
const res = spawnSync(process.env.PG_RESTORE ?? 'pg_restore', ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', url.pathname.slice(1), '--clean', '--if-exists', '--no-owner'], {
  input: dump,
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  maxBuffer: 1024 * 1024 * 1024,
});
process.stdout.write(res.stdout?.toString() ?? '');
process.stderr.write(res.stderr?.toString() ?? '');
console.log(res.status === 0 ? 'Restore completed. Run `npm run db:security` to re-apply grants.' : `pg_restore exited with ${res.status}`);
