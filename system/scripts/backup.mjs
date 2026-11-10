// Encrypted database + file-storage backup.
//   node scripts/backup.mjs            -> backups/kcs-<timestamp>.dump.enc  (+ storage archive copy)
// The dump is encrypted with AES-256-GCM using a key derived (HKDF) from ENCRYPTION_KEY.
// Keep apps/api/.env safe: without ENCRYPTION_KEY neither the backups nor encrypted fields can be read.
import { spawnSync } from 'node:child_process';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, 'apps', 'api', '.env');
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const url = new URL(env.MIGRATION_DATABASE_URL);
const outDir = join(root, 'backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const pgDump = process.env.PG_DUMP ?? 'pg_dump';

const res = spawnSync(pgDump, ['-h', url.hostname, '-p', url.port || '5432', '-U', url.username, '-d', url.pathname.slice(1), '-Fc', '--no-owner'], {
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  maxBuffer: 1024 * 1024 * 1024,
});
if (res.status !== 0) {
  console.error('pg_dump failed:', res.stderr?.toString() || res.error?.message);
  process.exit(1);
}
const key = Buffer.from(hkdfSync('sha256', Buffer.from(env.ENCRYPTION_KEY, 'base64'), Buffer.alloc(0), 'kcs-backup-v1', 32));
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(res.stdout), cipher.final()]);
const file = join(outDir, `kcs-${stamp}.dump.enc`);
writeFileSync(file, Buffer.concat([Buffer.from('KCSB1'), iv, cipher.getAuthTag(), enc]), { mode: 0o600 });

// stored files are already encrypted at rest - copy them as-is
const storage = resolve(join(root, 'apps', 'api'), env.STORAGE_DIR ?? './storage');
if (existsSync(storage)) cpSync(storage, join(outDir, `storage-${stamp}`), { recursive: true });

// retention
const keep = Number(process.env.BACKUP_KEEP ?? 14);
const dumps = readdirSync(outDir).filter((f) => f.endsWith('.dump.enc')).sort().reverse();
for (const old of dumps.slice(keep)) {
  rmSync(join(outDir, old));
  const s = join(outDir, old.replace('kcs-', 'storage-').replace('.dump.enc', ''));
  if (existsSync(s)) rmSync(s, { recursive: true });
}
console.log(`Backup written: ${file} (${(statSync(file).size / 1024).toFixed(0)} KB)`);
