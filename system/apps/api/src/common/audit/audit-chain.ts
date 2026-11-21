import { createHmac, hkdfSync } from 'node:crypto';

/** Deterministic JSON (sorted keys at every level) so the hash does not depend on storage key order (jsonb). */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export interface ChainEntry {
  companyId: string | null;
  userId: string | null;
  username: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** Key derived from HMAC_KEY: without it nobody (not even a DBA) can forge a consistent chain. */
export function chainKey(hmacKeyB64: string) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(hmacKeyB64, 'base64'), Buffer.alloc(0), 'kcs-audit-chain-v1', 32));
}

export function entryHash(key: Buffer, prevHash: string | null, e: ChainEntry): string {
  const payload = canonical({
    companyId: e.companyId ?? null,
    userId: e.userId ?? null,
    username: e.username ?? null,
    entity: e.entity,
    entityId: e.entityId ?? null,
    action: e.action,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: e.ip ?? null,
    requestId: e.requestId ?? null,
    createdAt: e.createdAt.toISOString(),
  });
  return createHmac('sha256', key).update((prevHash ?? 'GENESIS') + '|' + payload).digest('hex');
}
