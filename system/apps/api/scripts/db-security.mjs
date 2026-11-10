// Applies database-layer security (grants, append-only audit, integrity triggers).
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRole = new URL(process.env.DATABASE_URL).username;
const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'sql', 'security.sql'), 'utf8')
  .replaceAll(':app_role', '"' + appRole.replace(/"/g, '""') + '"');
const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await c.connect();
await c.query(sql);
await c.end();
console.log('Database security policies applied.');
