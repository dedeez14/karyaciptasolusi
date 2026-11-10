import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RequestCtx } from '../context/request-context';

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
    const data = {
      companyId: ctx?.user?.companyId ?? null,
      userId: ctx?.user?.id ?? null,
      username: ctx?.user?.username ?? null,
      entity,
      entityId: entityId ?? null,
      action,
      before: (b ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (a ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent?.slice(0, 255),
      requestId: ctx?.requestId,
    };
    try {
      await (tx ?? this.prisma).auditLog.create({ data });
    } catch (e) {
      if (tx) throw e; // inside a business transaction auditing is mandatory
      this.logger.error(`Audit write failed: ${(e as Error).message}`);
    }
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
