// Creates apps/api/.env from .env.example with strong random secrets (idempotent).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  console.log('.env already exists - leaving it untouched');
  process.exit(0);
}
const rnd = (n = 32) => randomBytes(n).toString('base64');
const pw = () => randomBytes(18).toString('base64url');
const ownerPw = pw();
const appPw = pw();
const adminPw = `Kcs!${randomBytes(9).toString('base64url')}`;
let env = readFileSync(join(root, '.env.example'), 'utf8')
  .replace('NODE_ENV=development', 'NODE_ENV=production')
  .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${rnd(48)}`)
  .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${rnd()}`)
  .replace(/^HMAC_KEY=.*$/m, `HMAC_KEY=${rnd()}`)
  .replace(/kcs_app:CHANGE_ME/, `kcs_app:${appPw}`)
  .replace(/kcs_owner:CHANGE_ME/, `kcs_owner:${ownerPw}`)
  .replace(/^SEED_ADMIN_PASSWORD=.*$/m, `SEED_ADMIN_PASSWORD=${adminPw}`);
writeFileSync(envPath, env, { mode: 0o600 });
console.log('Created apps/api/.env with generated secrets.');
console.log('Initial admin password is stored in SEED_ADMIN_PASSWORD inside apps/api/.env (change it after first login).');
