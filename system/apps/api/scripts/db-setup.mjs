// One-shot database bootstrap: roles, database, migrations, DB security, seed.
// Usage: npm run db:setup   (safe to re-run)
import 'dotenv/config';
import pg from 'pg';
import { execSync } from 'node:child_process';

const must = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
const appUrl = new URL(must('DATABASE_URL'));
const ownerUrl = new URL(must('MIGRATION_DATABASE_URL'));
const superUrl = must('PG_SUPERUSER_URL');
const dbName = ownerUrl.pathname.slice(1);
const ident = (s) => '"' + s.replace(/"/g, '""') + '"';
const lit = (s) => "'" + s.replace(/'/g, "''") + "'";

const su = new pg.Client({ connectionString: superUrl });
await su.connect();
async function ensureRole(name, password, extra) {
  const { rowCount } = await su.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name]);
  const verb = rowCount ? 'ALTER' : 'CREATE';
  await su.query(`${verb} ROLE ${ident(name)} WITH LOGIN ${extra} PASSWORD ${lit(password)}`);
  console.log(`role ${name}: ${rowCount ? 'updated' : 'created'}`);
}
await ensureRole(ownerUrl.username, decodeURIComponent(ownerUrl.password), 'NOSUPERUSER CREATEDB NOCREATEROLE');
await ensureRole(appUrl.username, decodeURIComponent(appUrl.password), 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 50');
const { rowCount: dbExists } = await su.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
if (!dbExists) {
  await su.query(`CREATE DATABASE ${ident(dbName)} OWNER ${ident(ownerUrl.username)} ENCODING 'UTF8'`);
  console.log(`database ${dbName}: created`);
}
await su.query(`REVOKE ALL ON DATABASE ${ident(dbName)} FROM PUBLIC`);
await su.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(dbName)} TO ${ident(appUrl.username)}`);
await su.query(`ALTER ROLE ${ident(appUrl.username)} SET statement_timeout = '30s'`);
await su.query(`ALTER ROLE ${ident(appUrl.username)} SET idle_in_transaction_session_timeout = '60s'`);
await su.end();

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
run('npx prisma migrate deploy', { DATABASE_URL: ownerUrl.toString() });
run('node scripts/db-security.mjs');
run('npx tsx prisma/seed.ts');
console.log('\nDatabase ready.');
