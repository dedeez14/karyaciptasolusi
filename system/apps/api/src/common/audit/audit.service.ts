import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RequestCtx } from '../context/request-context';
import { env } from '../../config/env';
import { chainKey, ChainEntry, entryHash } from './audit-chain';

const REDACT = new Set(['passwordHash', 'tokenHash', 'password']);
const META = new Set(['updatedAt', 'createdAt', 'updatedById', 'createdById']);

function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Prisma.Decimal) return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (REDACT.has(k)) out[k] = '[redacted]';
      else if (typeof v === 'string' && /^v1:[^:]+:[^:]+:[^:]+$/.test(v)) out[k] = '[encrypted]';
      else out[k] = sanitize(v);
    }
    return out;
  }
  return obj;
}

/** Records immutable data-change history (who changed what, before/after). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  private readonly key = chainKey(env.HMAC_KEY);
  constructor(private readonly prisma: PrismaService) {}

  async record(entity: string, entityId: string | null | undefined, action: string, before?: unknown, after?: unknown, tx?: Tx) {
    const ctx = RequestCtx.get();
    let b = sanitize(before) as Record<string, unknown> | undefined;
    let a = sanitize(after) as Record<string, unknown> | undefined;
    if (b && a && typeof b === 'object' && typeof a === 'object' && action === 'UPDATE') {
      // store only the changed fields to keep the trail compact & readable
      const changedB: Record<string, unknown> = {};
      const changedA: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (META.has(k)) continue;
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k in a) {
          changedB[k] = b[k];
          changedA[k] = a[k];
        }
      }
      b = changedB;
      a = changedA;
      if (Object.keys(a).length === 0) return;
    }
    const entry: ChainEntry = {
      companyId: ctx?.user?.companyId ?? null,
      userId: ctx?.user?.id ?? null,
      username: ctx?.user?.username ?? null,
      entity,
      entityId: entityId ?? null,
      action,
      before: b ?? null,
      after: a ?? null,
      ip: ctx?.ip ?? null,
      requestId: ctx?.requestId ?? null,
      createdAt: new Date(),
    };
    const write = async (db: Tx) => {
      // serialise writers of one chain (per company) until commit, then link to the previous entry
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + (entry.companyId ?? 'global')}))`;
      const prev = await db.auditLog.findFirst({ where: { companyId: entry.companyId, hash: { not: null } }, orderBy: { id: 'desc' }, select: { hash: true } });
      const prevHash = prev?.hash ?? null;
      await db.auditLog.create({
        data: {
          ...entry,
          before: (b ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (a ?? undefined) as Prisma.InputJsonValue | undefined,
          userAgent: ctx?.userAgent?.slice(0, 255),
          prevHash,
          hash: entryHash(this.key, prevHash, entry),
        },
      });
    };
    try {
      if (tx) await write(tx);
      else await this.prisma.$transaction((t) => write(t));
    } catch (e) {
      if (tx) throw e; // inside a business transaction auditing is mandatory
      this.logger.error(`Audit write failed: ${(e as Error).message}`);
    }
  }

  /**
   * Re-computes the HMAC chain of a company. Any edited, deleted or inserted row breaks the chain
   * from that point on, even if it was done directly in the database.
   */
  async verifyChain(companyId: string | null) {
    let prevHash: string | null = null;
    let lastId = BigInt(0);
    let checked = 0;
    let legacy = 0;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({ where: { companyId, id: { gt: lastId } }, orderBy: { id: 'asc' }, take: 1000 });
      if (!rows.length) break;
      for (const r of rows) {
        lastId = r.id;
        if (!r.hash) {
          legacy++;
          continue;
        }
        checked++;
        if (r.prevHash !== prevHash) return { valid: false, checked, legacy, brokenAt: r.id.toString(), reason: 'Entry is not linked to the previous entry (a record was deleted or inserted)' };
        const expected = entryHash(this.key, prevHash, {
          companyId: r.companyId,
          userId: r.userId,
          username: r.username,
          entity: r.entity,
          entityId: r.entityId,
          action: r.action,
          before: r.before,
          after: r.after,
          ip: r.ip,
          requestId: r.requestId,
          createdAt: r.createdAt,
        });
        if (expected !== r.hash) return { valid: false, checked, legacy, brokenAt: r.id.toString(), reason: 'Entry content was modified after it was written' };
        prevHash = r.hash;
      }
    }
    return { valid: true, checked, legacy, brokenAt: null, reason: null, lastHash: prevHash };
  }

  /** Activity trail entry (login, export, download, ...). Fire-and-forget. */
  activity(action: string, detail?: Record<string, unknown>, extra: { userId?: string; username?: string; companyId?: string; statusCode?: number } = {}) {
    const ctx = RequestCtx.get();
    this.prisma.activityLog
      .create({
        data: {
          action,
          userId: extra.userId ?? ctx?.user?.id,
          username: extra.username ?? ctx?.user?.username,
          companyId: extra.companyId ?? ctx?.user?.companyId,
          statusCode: extra.statusCode,
          ip: ctx?.ip,
          userAgent: ctx?.userAgent?.slice(0, 255),
          requestId: ctx?.requestId,
          detail: detail ? (sanitize(detail) as Prisma.InputJsonValue) : undefined,
        },
      })
      .catch((e) => this.logger.error(`Activity write failed: ${e.message}`));
  }
}
