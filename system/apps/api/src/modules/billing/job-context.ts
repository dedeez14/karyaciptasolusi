import { randomUUID } from 'node:crypto';
import { BadRequestException, Logger } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser, RequestCtx } from '../../common/context/request-context';

/**
 * Helpers shared by the finance modules (billing, assets, budget):
 * - running scheduled jobs outside an HTTP request with an explicit, audited "system" actor
 * - date-only arithmetic (DATE columns are stored as UTC midnight)
 * - tenant-safe reference checks
 */

/** Actor recorded in audit / createdById for work done by the scheduler (never a real login). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

function systemUser(companyId: string): AuthUser {
  return {
    id: SYSTEM_ACTOR_ID,
    username: 'system',
    fullName: 'System scheduler',
    isSuperAdmin: true,
    companyId,
    branchId: null,
    branchIds: null,
    dataScope: 'ALL',
    permissions: new Set(),
  };
}

/** Runs fn as the system actor of one company (audit trail shows username "system"). */
export function runAsSystem<T>(companyId: string, job: string, fn: () => Promise<T>): Promise<T> {
  return RequestCtx.run(
    {
      requestId: `job:${job}:${randomUUID().slice(0, 8)}`,
      user: systemUser(companyId),
    },
    fn,
  );
}

const running = new Set<string>();

/**
 * Executes a scheduled job for every active company. Errors are logged per company and never
 * escape (a failing tenant must not stop the others or crash the process). Overlapping runs of
 * the same job are skipped.
 */
export async function forEachCompany(prisma: PrismaService, logger: Logger, job: string, fn: (companyId: string) => Promise<unknown>) {
  if (running.has(job)) {
    logger.warn(`${job}: previous run still in progress, skipped`);
    return;
  }
  running.add(job);
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, code: true },
    });
    for (const c of companies) {
      try {
        const r = await runAsSystem(c.id, job, () => fn(c.id) as Promise<unknown>);
        if (r !== undefined && r !== null) logger.log(`${job} [${c.code}]: ${typeof r === 'string' ? r : JSON.stringify(r)}`);
      } catch (e) {
        logger.error(`${job} [${c.code}] failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    logger.error(`${job} failed: ${(e as Error).message}`);
  } finally {
    running.delete(job);
  }
}

// ------------------------------------------------------------------ dates

/** Today's calendar date on this server as YYYY-MM-DD */
export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
/** YYYY-MM-DD -> Date at UTC midnight (how DATE columns are read back) */
export const dateOnly = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Adds months keeping the anchor day where possible (31 Jan + 1 month = 28/29 Feb, then back to 31 Mar). */
export function addMonths(d: Date, months: number, anchorDay = d.getUTCDate()): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  return new Date(Date.UTC(y, m, Math.min(anchorDay, daysInMonth(y, m))));
}

export const periodOf = (d: Date) => d.toISOString().slice(0, 7);
export const periodIndex = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
export const periodFromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const periodEnd = (p: string) => {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5, 7)) - 1;
  return new Date(Date.UTC(y, m, daysInMonth(y, m)));
};
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ------------------------------------------------------------------ references

type Owned = 'customer' | 'supplier' | 'project' | 'paymentTerm' | 'product' | 'uom' | 'tax' | 'account' | 'costCenter' | 'bankAccount' | 'employee' | 'branch' | 'currency';

/** Throws a field validation error unless the row exists in the active company. */
export async function assertOwned(prisma: PrismaService, model: Owned, id: string | null | undefined, field: string, label = 'Selected value') {
  if (!id) return null;
  const where: Record<string, unknown> = model === 'currency' ? { code: id } : { id, companyId: RequestCtx.companyId(), deletedAt: null };
  const row = await (prisma as any)[model].findFirst({ where });
  if (!row)
    throw new BadRequestException({
      message: 'Validation failed',
      errors: { [field]: `${label} not found` },
    });
  return row;
}

/** Ledger account must exist in the company and be a posting (non header) account. */
export async function assertPostingAccount(prisma: PrismaService, id: string | null | undefined, field: string) {
  const a = await assertOwned(prisma, 'account', id, field, 'Account');
  if (a?.isGroup)
    throw new BadRequestException({
      message: 'Validation failed',
      errors: { [field]: 'Choose a detail account, not a header' },
    });
  return a;
}

/** Code must be an active value of a Master Data lookup list (global or company specific). */
export async function assertLookup(prisma: PrismaService, category: string, code: string | null | undefined, field: string) {
  if (!code) return;
  const v = await prisma.lookupValue.findFirst({
    where: {
      category,
      code,
      isActive: true,
      deletedAt: null,
      OR: [{ companyId: null }, { companyId: RequestCtx.companyId() }],
    },
  });
  if (!v)
    throw new BadRequestException({
      message: 'Validation failed',
      errors: { [field]: 'Not a valid option' },
    });
}

export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
