import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { day, num, round2, today, uuid, uuids } from './insights.util';
import { ClosingService } from '../closing/closing.service';

const DEBIT_NATURE = new Set(['ASSET', 'EXPENSE']);

/** Accounting / treasury / inventory figures behind the purpose-built master data views */
@Injectable()
export class FinanceInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly closing: ClosingService,
  ) {}

  private canSeeBalances() {
    return RequestCtx.can('accounting.journal.read') || RequestCtx.can('report.trial-balance.view') || RequestCtx.can('report.balance-sheet.view');
  }

  /** Chart of accounts with posted balances (as of a date). Group totals are summed by the client. */
  async accountTree(asOf?: string) {
    const companyId = RequestCtx.companyId();
    const until = day(asOf, true);
    const accounts = await this.prisma.account.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true, type: true, parentId: true, isGroup: true, isActive: true },
      orderBy: { code: 'asc' },
    });
    const showBalances = this.canSeeBalances();
    const sums = showBalances
      ? await this.prisma.journalLine.groupBy({
          by: ['accountId'],
          where: { entry: { companyId, status: 'POSTED', deletedAt: null, ...(until ? { date: { lte: until } } : {}) } },
          _sum: { debit: true, credit: true },
        })
      : [];
    const m = new Map(sums.map((s) => [s.accountId, s._sum]));
    return {
      asOf: asOf ?? null,
      balances: showBalances,
      accounts: accounts.map((a) => {
        const s = m.get(a.id);
        const debit = num(s?.debit);
        const credit = num(s?.credit);
        return { ...a, debit: round2(debit), credit: round2(credit), balance: round2(DEBIT_NATURE.has(a.type) ? debit - credit : credit - debit) };
      }),
    };
  }

  /** Balance, 30 day flow and latest postings of every cash / bank account */
  async bankAccounts(ids?: string) {
    const companyId = RequestCtx.companyId();
    const list = uuids(ids);
    const banks = await this.prisma.bankAccount.findMany({
      where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.BankAccountWhereInput), deletedAt: null, ...(list.length ? { id: { in: list } } : {}) },
      select: { id: true, accountId: true },
    });
    if (!this.canSeeBalances() && !RequestCtx.can('accounting.cash.read')) return { balances: false, items: {} };
    const accountIds = banks.map((b) => b.accountId).filter((x): x is string => !!x);
    const since = new Date(today().getTime() - 30 * 86400_000);
    const posted = { companyId, status: 'POSTED' as const, deletedAt: null };
    const [total, recentFlow, last] = await Promise.all([
      this.prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, entry: posted }, _sum: { debit: true, credit: true } }),
      this.prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, entry: { ...posted, date: { gte: since } } }, _sum: { debit: true, credit: true } }),
      accountIds.length
        ? this.prisma.$queryRaw<{ accountId: string; date: Date; number: string; description: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
            SELECT * FROM (
              SELECT l."accountId", e.date, e.number, COALESCE(l.description, e.description) AS description, l.debit, l.credit,
                     ROW_NUMBER() OVER (PARTITION BY l."accountId" ORDER BY e.date DESC, e."createdAt" DESC) AS rn
              FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
              WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL AND l."accountId" IN (${Prisma.join(accountIds.map((a) => Prisma.sql`${a}::uuid`))})
            ) x WHERE rn <= 5`
        : Promise.resolve([]),
    ]);
    const t = new Map(total.map((x) => [x.accountId, x._sum]));
    const f = new Map(recentFlow.map((x) => [x.accountId, x._sum]));
    const items: Record<string, unknown> = {};
    for (const b of banks) {
      if (!b.accountId) continue;
      items[b.id] = {
        balance: round2(num(t.get(b.accountId)?.debit) - num(t.get(b.accountId)?.credit)),
        inflow30: round2(num(f.get(b.accountId)?.debit)),
        outflow30: round2(num(f.get(b.accountId)?.credit)),
        recent: last.filter((l) => l.accountId === b.accountId).map((l) => ({ date: l.date, number: l.number, description: l.description, amount: round2(num(l.debit) - num(l.credit)) })),
      };
    }
    return { balances: true, items };
  }

  /** Item count, quantity, value and low-stock count per warehouse */
  async warehouses() {
    const companyId = RequestCtx.companyId();
    if (!RequestCtx.can('inventory.stock.read')) return { stock: false, items: {} };
    const rows = await this.prisma.$queryRaw<{ warehouseId: string; items: bigint; qty: Prisma.Decimal; value: Prisma.Decimal; low: bigint }[]>`
      SELECT b."warehouseId",
             COUNT(*) FILTER (WHERE b.qty > 0) AS items,
             COALESCE(SUM(b.qty), 0) AS qty,
             COALESCE(SUM(b.qty * b."avgCost"), 0) AS value,
             COUNT(*) FILTER (WHERE p."minStock" > 0 AND b.qty <= p."minStock") AS low
      FROM stock_balances b JOIN products p ON p.id = b."productId"
      WHERE b."companyId" = ${companyId}::uuid AND p."deletedAt" IS NULL
      GROUP BY b."warehouseId"`;
    return {
      stock: true,
      items: Object.fromEntries(rows.map((r) => [r.warehouseId, { items: Number(r.items), qty: num(r.qty), value: round2(num(r.value)), low: Number(r.low) }])),
    };
  }

  /** Close or reopen a fiscal period (closing blocks postings dated inside it) */
  /**
   * Close / reopen from the fiscal-year view uses the same year-end closing flow as Accounting > Year-end Closing
   * (closing journal into retained earnings + lock), so there is only one way to close a period.
   */
  async setPeriodClosed(id: string, closed: boolean) {
    const p = await this.prisma.fiscalPeriod.findFirst({ where: { id: uuid(id), companyId: RequestCtx.companyId(), deletedAt: null }, select: { id: true } });
    if (!p) throw new NotFoundException('Fiscal period not found');
    return closed ? this.closing.close(p.id) : this.closing.reopen(p.id);
  }

}
