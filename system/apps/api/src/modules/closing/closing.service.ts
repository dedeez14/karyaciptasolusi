import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';

const CLOSING = 'CLOSING';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { id: string; code: string; name: string; type: string; debit: Prisma.Decimal; credit: Prisma.Decimal };

/**
 * Year-end closing: the income and expense movements of a financial year are moved into Retained Earnings by one
 * journal (source CLOSING) dated on the last day of the year, and the year is locked. Reopening voids that journal.
 * The Profit & Loss report ignores CLOSING journals, so a closed year still shows its real result.
 */
@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly journal: JournalService,
  ) {}

  private async period(id: string, tx?: Tx) {
    if (!UUID.test(id)) throw new NotFoundException('Fiscal period not found');
    const p = await (tx ?? this.prisma).fiscalPeriod.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!p) throw new NotFoundException('Fiscal period not found');
    return p;
  }

  /** income / expense movement of a period, closing journals excluded */
  private movements(db: Tx | PrismaService, companyId: string, start: Date, end: Date) {
    return db.$queryRaw<Row[]>`
      SELECT a.id, a.code, a.name, a.type::text AS type, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l."entryId"
      JOIN accounts a ON a.id = l."accountId"
      WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL
        AND e.date >= ${start} AND e.date <= ${end} AND COALESCE(e."sourceType", '') <> 'CLOSING'
        AND a.type IN ('INCOME', 'EXPENSE')
      GROUP BY a.id ORDER BY a.code`;
  }

  async list() {
    RequestCtx.assert('accounting.closing.read');
    const companyId = RequestCtx.companyId();
    const periods = await this.prisma.fiscalPeriod.findMany({ where: { companyId, deletedAt: null }, orderBy: { startDate: 'desc' } });
    const journals = await this.prisma.journalEntry.findMany({ where: { id: { in: periods.map((p) => p.closingJournalId).filter(Boolean) as string[] } }, select: { id: true, number: true } });
    const jm = new Map(journals.map((j) => [j.id, j.number]));
    const users = await this.prisma.user.findMany({ where: { id: { in: periods.map((p) => p.closedById).filter(Boolean) as string[] } }, select: { id: true, fullName: true } });
    const um = new Map(users.map((u) => [u.id, u.fullName]));
    const out = [];
    for (const p of periods) {
      const rows = await this.movements(this.prisma, companyId, p.startDate, p.endDate);
      const income = sum(rows.filter((r) => r.type === 'INCOME').map((r) => D(r.credit).minus(D(r.debit))));
      const expense = sum(rows.filter((r) => r.type === 'EXPENSE').map((r) => D(r.debit).minus(D(r.credit))));
      out.push({
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        isClosed: p.isClosed,
        closedAt: p.closedAt,
        closedBy: p.closedById ? um.get(p.closedById) ?? null : null,
        closingJournal: p.closingJournalId ? { id: p.closingJournalId, number: jm.get(p.closingJournalId) ?? null } : null,
        income,
        expense,
        result: income.minus(expense),
      });
    }
    return out;
  }

  async preview(id: string) {
    RequestCtx.assert('accounting.closing.read');
    const companyId = RequestCtx.companyId();
    const p = await this.period(id);
    const [rows, drafts, re, later, earlierOpen] = await Promise.all([
      this.movements(this.prisma, companyId, p.startDate, p.endDate),
      this.prisma.journalEntry.count({ where: { companyId, status: 'DRAFT', deletedAt: null, date: { gte: p.startDate, lte: p.endDate } } }),
      this.prisma.accountMapping.findUnique({ where: { companyId_key: { companyId, key: 'RETAINED_EARNINGS' } } }),
      this.prisma.fiscalPeriod.count({ where: { companyId, deletedAt: null, isClosed: true, startDate: { gt: p.endDate } } }),
      this.prisma.fiscalPeriod.count({ where: { companyId, deletedAt: null, isClosed: false, endDate: { lt: p.startDate } } }),
    ]);
    const reAccount = re?.accountId ? await this.prisma.account.findUnique({ where: { id: re.accountId }, select: { code: true, name: true } }) : null;
    const accounts = rows
      .map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, amount: r.type === 'INCOME' ? D(r.credit).minus(D(r.debit)) : D(r.debit).minus(D(r.credit)) }))
      .filter((r) => !r.amount.isZero());
    const income = sum(accounts.filter((a) => a.type === 'INCOME').map((a) => a.amount));
    const expense = sum(accounts.filter((a) => a.type === 'EXPENSE').map((a) => a.amount));
    const result = income.minus(expense);
    const warnings: string[] = [];
    if (drafts) warnings.push(`${drafts} draft journal${drafts === 1 ? '' : 's'} dated in this period must be posted or deleted first.`);
    if (!re?.accountId) warnings.push('Posting account "RETAINED_EARNINGS" is not configured (Accounting > Posting Accounts).');
    if (earlierOpen) warnings.push(`${earlierOpen} earlier period${earlierOpen === 1 ? ' is' : 's are'} still open. Close the years in order.`);
    if (later && p.isClosed) warnings.push('A later period is closed: reopen it first before reopening this one.');
    return {
      period: { id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, isClosed: p.isClosed, closedAt: p.closedAt, closingJournalId: p.closingJournalId },
      accounts,
      income,
      expense,
      result,
      retainedEarnings: reAccount,
      draftJournals: drafts,
      warnings,
      canClose: !p.isClosed && !drafts && !!re?.accountId && RequestCtx.can('accounting.closing.close'),
      canReopen: p.isClosed && !later && RequestCtx.can('accounting.closing.reopen'),
    };
  }

  async close(id: string) {
    RequestCtx.assert('accounting.closing.close');
    const u = RequestCtx.user();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM fiscal_periods WHERE id = ${id}::uuid FOR UPDATE`;
        const p = await this.period(id, tx);
        if (p.isClosed) throw new ConflictException(`${p.name} is already closed`);
        const drafts = await tx.journalEntry.count({ where: { companyId: u.companyId, status: 'DRAFT', deletedAt: null, date: { gte: p.startDate, lte: p.endDate } } });
        if (drafts) throw new ConflictException(`Post or delete the ${drafts} draft journal${drafts === 1 ? '' : 's'} dated in ${p.name} first`);
        const re = await tx.accountMapping.findUnique({ where: { companyId_key: { companyId: u.companyId, key: 'RETAINED_EARNINGS' } } });
        if (!re?.accountId) throw new BadRequestException('Posting account "RETAINED_EARNINGS" is not configured. Set it in Accounting > Posting Accounts.');

        const rows = await this.movements(tx, u.companyId, p.startDate, p.endDate);
        const lines: PostingLine[] = [];
        for (const r of rows) {
          const net = round(D(r.debit).minus(D(r.credit))); // debit balance > 0
          if (net.isZero()) continue;
          lines.push(net.gt(0) ? { accountId: r.id, credit: net, description: `Close ${r.code}` } : { accountId: r.id, debit: net.abs(), description: `Close ${r.code}` });
        }
        // what is left after zeroing income & expense is the year's result: profit -> credit retained earnings
        const balance = sum(lines.map((l) => D(l.debit ?? ZERO).minus(D(l.credit ?? ZERO))));
        if (!balance.isZero()) lines.push(balance.gt(0) ? { accountId: re.accountId, credit: balance, description: `Result ${p.name}` } : { accountId: re.accountId, debit: balance.abs(), description: `Result ${p.name}` });

        const entry = lines.length
          ? await this.journal.post(tx, { companyId: u.companyId, branchId: u.branchId, date: p.endDate, description: `Year-end closing ${p.name}`, reference: p.name, sourceType: CLOSING, sourceId: p.id, lines })
          : null;
        const after = await tx.fiscalPeriod.update({ where: { id: p.id }, data: { isClosed: true, closedAt: new Date(), closedById: u.id, closingJournalId: entry?.id ?? null, updatedById: u.id } });
        await this.audit.record('FiscalPeriod', p.id, 'CLOSE', { isClosed: false }, { isClosed: true, closingJournal: entry?.number ?? null, result: balance.neg().toString() }, tx);
        return { ...after, closingJournal: entry ? { id: entry.id, number: entry.number } : null };
      },
      { timeout: 60_000 },
    );
  }

  async reopen(id: string) {
    RequestCtx.assert('accounting.closing.reopen');
    const u = RequestCtx.user();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM fiscal_periods WHERE id = ${id}::uuid FOR UPDATE`;
      const p = await this.period(id, tx);
      if (!p.isClosed) throw new ConflictException(`${p.name} is not closed`);
      const later = await tx.fiscalPeriod.findFirst({ where: { companyId: u.companyId, deletedAt: null, isClosed: true, startDate: { gt: p.endDate } }, select: { name: true } });
      if (later) throw new ConflictException(`Reopen ${later.name} first`);
      // unlock first: voiding the closing journal needs an open period
      const after = await tx.fiscalPeriod.update({ where: { id: p.id }, data: { isClosed: false, closedAt: null, closedById: null, closingJournalId: null, updatedById: u.id } });
      await this.journal.voidBySource(tx, CLOSING, p.id);
      await this.audit.record('FiscalPeriod', p.id, 'REOPEN', { isClosed: true, closingJournalId: p.closingJournalId }, { isClosed: false }, tx);
      return after;
    });
  }
}
