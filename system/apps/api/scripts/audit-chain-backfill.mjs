// One-off: links audit entries written before the hash chain existed into the chain.
// Runs as the schema owner because the audit table is append-only for the application.
//   node scripts/audit-chain-backfill.mjs            (link legacy entries)
//   node scripts/audit-chain-backfill.mjs --rebuild  (recompute the whole chain - only after a key change)
import 'dotenv/config';
import pg from 'pg';
import { createHmac, hkdfSync } from 'node:crypto';

// timestamps are stored as UTC without time zone (Prisma convention) - read them as UTC
pg.types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z'));
const REBUILD = process.argv.includes('--rebuild');

const key = Buffer.from(hkdfSync('sha256', Buffer.from(process.env.HMAC_KEY, 'base64'), Buffer.alloc(0), 'kcs-audit-chain-v1', 32));
const canonical = (v) => {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
};
const hash = (prev, r) =>
  createHmac('sha256', key)
    .update(
      (prev ?? 'GENESIS') +
        '|' +
        canonical({ companyId: r.companyId ?? null, userId: r.userId ?? null, username: r.username ?? null, entity: r.entity, entityId: r.entityId ?? null, action: r.action, before: r.before ?? null, after: r.after ?? null, ip: r.ip ?? null, requestId: r.requestId ?? null, createdAt: r.createdAt.toISOString() }),
    )
    .digest('hex');

const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await c.connect();
await c.query('BEGIN');
await c.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable');
const { rows: companies } = await c.query('SELECT DISTINCT "companyId" FROM audit_logs');
let total = 0;
for (const { companyId } of companies) {
  const { rows } = await c.query('SELECT id, "companyId", "userId", username, entity, "entityId", action, before, after, ip, "requestId", "createdAt", hash FROM audit_logs WHERE "companyId" IS NOT DISTINCT FROM $1 ORDER BY id', [companyId]);
  if (!REBUILD && rows.some((r) => r.hash)) continue; // chain already started for this company
  let prev = null;
  for (const r of rows) {
    const h = hash(prev, r);
    await c.query('UPDATE audit_logs SET "prevHash" = $1, hash = $2 WHERE id = $3', [prev, h, r.id]);
    prev = h;
    total++;
  }
}
await c.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable');
await c.query('COMMIT');
await c.end();
console.log(`Linked ${total} existing audit entries into the hash chain.`);
