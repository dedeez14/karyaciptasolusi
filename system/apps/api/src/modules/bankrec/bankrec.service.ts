import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum } from '../../common/utils/money';
import { CashService } from '../cash/cash.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().min(-1e14).max(1e14);
/** days a bank date may differ from the book date for an automatic match */
const AUTO_MATCH_DAYS = 3;
/** ledger lines this many days after the statement end are still offered (items that reached the books late) */
const LOOKAHEAD_DAYS = 31;

export const lineInput = z.object({
  date: isoDate,
  description: z.string().trim().min(1, 'Description is required').max(500),
  reference: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable().optional()),
  amount: money.refine((v) => v !== 0, 'Amount cannot be zero'),
});

export const statementSchema = z
  .object({
    bankAccountId: z.uuid(),
    periodStart: isoDate,
    periodEnd: isoDate,
    openingBalance: money,
    closingBalance: money,
    notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(2000).nullable().optional()),
    lines: z.array(lineInput).max(5000).optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'End date must be on or after the start date' });

export const headerSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate, openingBalance: money, closingBalance: money, notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(2000).nullable().optional()) })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'End date must be on or after the start date' });

export const createTxSchema = z.object({
  accountId: z.uuid(),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(1000).nullable().optional()),
  partyName: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(150).nullable().optional()),
});

type LedgerRow = { id: string; date: Date; number: string; description: string | null; reference: string | null; sourceType: string | null; amount: Prisma.Decimal; lineDescription: string | null };

const dayMs = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * dayMs);

/**
 * Bank reconciliation: a bank statement (period, opening & closing balance, lines) is matched against the ledger
 * lines of the bank account. Reconciled when every statement line is matched and
 *   statement closing = book balance - book items not yet on the bank + bank items booked after the period.
 */
@Injectable()
export class BankRecService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  private async bank(id: string) {
    const b = await this.prisma.bankAccount.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!b) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'Cash / bank account not found' } });
    if (!b.accountId) throw new BadRequestException('This cash / bank account has no ledger account');
    return b;
  }

  private async statement(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Bank statement not found');
    const s = await this.prisma.bankStatement.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!s) throw new NotFoundException('Bank statement not found');
    return s;
  }

  private assertOpen(s: { statusCode: string; number: string }) {
    if (s.statusCode === 'RECONCILED') throw new ConflictException(`${s.number} is reconciled. Reopen it to make changes.`);
  }

  // ------------------------------------------------------------------ queries
  async list(q: { bankAccountId?: string; status?: string }) {
    RequestCtx.assert('accounting.bankrec.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.bankStatement.findMany({
      where: { companyId, deletedAt: null, ...(q.bankAccountId ? { bankAccountId: q.bankAccountId } : {}), ...(q.status ? { statusCode: q.status } : {}) },
      orderBy: [{ periodEnd: 'desc' }, { number: 'desc' }],
      include: { lines: { select: { id: true, amount: true, matches: { select: { id: true } } } } },
      take: 500,
    });
    const banks = await this.prisma.bankAccount.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.bankAccountId))] } }, select: { id: true, name: true } });
    const bm = new Map(banks.map((b) => [b.id, b.name]));
    return rows.map(({ lines, ...r }) => ({ ...r, bankAccountName: bm.get(r.bankAccountId) ?? null, lineCount: lines.length, matchedCount: lines.filter((l) => l.matches.length).length }));
  }

  /** Suggested start of the next statement: the day after the last one, with its closing balance */
  async suggest(bankAccountId: string) {
    RequestCtx.assert('accounting.bankrec.read');
    if (!UUID.test(bankAccountId)) return { periodStart: null, openingBalance: 0 };
    const last = await this.prisma.bankStatement.findFirst({ where: { companyId: RequestCtx.companyId(), bankAccountId, deletedAt: null }, orderBy: { periodEnd: 'desc' } });
    return last ? { periodStart: addDays(last.periodEnd, 1).toISOString().slice(0, 10), openingBalance: last.closingBalance, previous: last.number } : { periodStart: null, openingBalance: 0, previous: null };
  }

  private async ledgerLines(accountId: string, until: Date, onlyUnmatched: boolean, ids?: string[]) {
    return this.prisma.$queryRaw<LedgerRow[]>`
      SELECT l.id, e.date, e.number, e.description, e.reference, e."sourceType", (l.debit - l.credit) AS amount, l.description AS "lineDescription"
      FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
      WHERE l."accountId" = ${accountId}::uuid AND e."companyId" = ${RequestCtx.companyId()}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL
        AND e.date <= ${until}
        ${onlyUnmatched ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM bank_recon_matches m WHERE m."journalLineId" = l.id)` : Prisma.empty}
        ${ids ? Prisma.sql`AND l.id = ANY(${ids}::uuid[])` : Prisma.empty}
      ORDER BY e.date, e.number
      LIMIT 2000`;
  }

  /** Balances behind the reconciliation, all as of the statement end */
  private async summary(s: { id: string; bankAccountId: string; periodEnd: Date; openingBalance: Prisma.Decimal; closingBalance: Prisma.Decimal }, accountId: string, lines: { amount: Prisma.Decimal; matched: boolean }[]) {
    const end = s.periodEnd;
    const companyId = RequestCtx.companyId();
    // book items dated before the account's first statement are part of that statement's opening balance
    const first = await this.prisma.bankStatement.aggregate({ where: { companyId, bankAccountId: s.bankAccountId, deletedAt: null }, _min: { periodStart: true } });
    const since = first._min.periodStart ?? new Date('1970-01-01');
    const [[book], [outstanding], [transit]] = await Promise.all([
      this.prisma.$queryRaw<{ v: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
        WHERE l."accountId" = ${accountId}::uuid AND e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL AND e.date <= ${end}`,
      this.prisma.$queryRaw<{ v: Prisma.Decimal; c: bigint }[]>`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v, COUNT(*)::bigint AS c FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
        WHERE l."accountId" = ${accountId}::uuid AND e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL AND e.date <= ${end} AND e.date >= ${since}
          AND NOT EXISTS (
            SELECT 1 FROM bank_recon_matches m JOIN bank_statement_lines sl ON sl.id = m."lineId" JOIN bank_statements st ON st.id = sl."statementId"
            WHERE m."journalLineId" = l.id AND st."deletedAt" IS NULL AND sl.date <= ${end})`,
      this.prisma.$queryRaw<{ v: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v
        FROM bank_recon_matches m JOIN bank_statement_lines sl ON sl.id = m."lineId" JOIN bank_statements st ON st.id = sl."statementId"
        JOIN journal_lines l ON l.id = m."journalLineId" JOIN journal_entries e ON e.id = l."entryId"
        WHERE st."bankAccountId" = ${s.bankAccountId}::uuid AND st."deletedAt" IS NULL AND sl.date <= ${end} AND e.status = 'POSTED' AND e.date > ${end}`,
    ]);
    const linesTotal = round(sum(lines.map((l) => D(l.amount))));
    const unmatched = lines.filter((l) => !l.matched);
    const adjustedBook = round(D(book.v).minus(D(outstanding.v)).plus(D(transit.v)));
    return {
      linesTotal,
      /** opening + lines - closing: must be zero, otherwise lines are missing from the statement */
      statementCheck: round(D(s.openingBalance).plus(linesTotal).minus(D(s.closingBalance))),
      bookBalance: round(D(book.v)),
      outstanding: round(D(outstanding.v)),
      outstandingCount: Number(outstanding.c),
      inTransit: round(D(transit.v)),
      adjustedBook,
      difference: round(D(s.closingBalance).minus(adjustedBook)),
      unmatchedCount: unmatched.length,
      unmatchedTotal: round(sum(unmatched.map((l) => D(l.amount)))),
    };
  }

  async get(id: string) {
    RequestCtx.assert('accounting.bankrec.read');
    const s = await this.statement(id);
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: s.bankAccountId } });
    if (!bank?.accountId) throw new BadRequestException('This cash / bank account has no ledger account');
    const account = await this.prisma.account.findUnique({ where: { id: bank.accountId }, select: { code: true, name: true } });
    const lines = await this.prisma.bankStatementLine.findMany({ where: { statementId: s.id }, orderBy: [{ date: 'asc' }, { lineNo: 'asc' }], include: { matches: true } });
    const matchedIds = lines.flatMap((l) => l.matches.map((m) => m.journalLineId));
    const matchedLedger = matchedIds.length
      ? await this.prisma.$queryRaw<(LedgerRow & { status: string })[]>`
          SELECT l.id, e.date, e.number, e.description, e.reference, e."sourceType", (l.debit - l.credit) AS amount, l.description AS "lineDescription", e.status::text AS status
          FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId" WHERE l.id = ANY(${matchedIds}::uuid[])`
      : [];
    const lm = new Map(matchedLedger.map((r) => [r.id, r]));
    const shaped = lines.map((l) => {
      const ms = l.matches.map((m) => ({ matchId: m.id, ...(lm.get(m.journalLineId) ?? { id: m.journalLineId, status: 'MISSING' }) }));
      const live = ms.filter((m) => (m as { status?: string }).status === 'POSTED');
      const matched = live.length > 0 && live.length === ms.length && round(sum(live.map((m) => D((m as LedgerRow).amount)))).equals(round(D(l.amount)));
      return { id: l.id, lineNo: l.lineNo, date: l.date, description: l.description, reference: l.reference, amount: l.amount, cashTransactionId: l.cashTransactionId, matched, matches: ms, voidedMatch: ms.length > live.length };
    });
    const candidates = await this.ledgerLines(bank.accountId, addDays(s.periodEnd, LOOKAHEAD_DAYS), true);
    const summary = await this.summary(s, bank.accountId, shaped);
    const users = s.reconciledById ? await this.prisma.user.findUnique({ where: { id: s.reconciledById }, select: { fullName: true } }) : null;
    return {
      ...s,
      bankAccountName: bank.name,
      ledgerAccount: account ? `${account.code} - ${account.name}` : null,
      reconciledBy: users?.fullName ?? null,
      lines: shaped,
      candidates,
      summary,
      canReconcile: s.statusCode === 'OPEN' && summary.unmatchedCount === 0 && summary.statementCheck.isZero() && summary.difference.isZero(),
    };
  }

  // ------------------------------------------------------------------ statements
  private async assertNoOverlap(companyId: string, bankAccountId: string, start: string, end: string, exceptId?: string) {
    const clash = await this.prisma.bankStatement.findFirst({
      where: { companyId, bankAccountId, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}), periodStart: { lte: new Date(end) }, periodEnd: { gte: new Date(start) } },
      select: { number: true },
    });
    if (clash) throw new ConflictException(`The period overlaps statement ${clash.number} of the same account`);
  }

  private assertLinesInPeriod(lines: { date: string }[], start: string, end: string) {
    const bad = lines.findIndex((l) => l.date < start || l.date > end);
    if (bad >= 0) throw new BadRequestException(`Line ${bad + 1}: date ${lines[bad].date} is outside the statement period`);
  }

  async create(body: unknown) {
    RequestCtx.assert('accounting.bankrec.create');
    const input = statementSchema.parse(body);
    const u = RequestCtx.user();
    await this.bank(input.bankAccountId);
    await this.assertNoOverlap(u.companyId, input.bankAccountId, input.periodStart, input.periodEnd);
    const lines = input.lines ?? [];
    this.assertLinesInPeriod(lines, input.periodStart, input.periodEnd);
    const s = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequence.next('BANK_STATEMENT', u.companyId, new Date(input.periodEnd), tx);
      const row = await tx.bankStatement.create({
        data: {
          companyId: u.companyId,
          bankAccountId: input.bankAccountId,
          number,
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          openingBalance: D(input.openingBalance),
          closingBalance: D(input.closingBalance),
          notes: input.notes ?? null,
          createdById: u.id,
          lines: { create: lines.map((l, i) => ({ lineNo: i + 1, date: new Date(l.date), description: l.description, reference: l.reference ?? null, amount: D(l.amount) })) },
        },
      });
      await this.audit.record('Bank Statement', row.id, 'CREATE', undefined, { ...row, lines: lines.length }, tx);
      return row;
    });
    return s;
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('accounting.bankrec.create');
    const s = await this.statement(id);
    this.assertOpen(s);
    const input = headerSchema.parse(body);
    await this.assertNoOverlap(s.companyId, s.bankAccountId, input.periodStart, input.periodEnd, s.id);
    const outside = await this.prisma.bankStatementLine.count({ where: { statementId: s.id, OR: [{ date: { lt: new Date(input.periodStart) } }, { date: { gt: new Date(input.periodEnd) } }] } });
    if (outside) throw new BadRequestException(`${outside} line${outside === 1 ? ' is' : 's are'} dated outside the new period`);
    const after = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: { periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), openingBalance: D(input.openingBalance), closingBalance: D(input.closingBalance), notes: input.notes ?? null, updatedById: RequestCtx.user().id },
    });
    await this.audit.record('Bank Statement', s.id, 'UPDATE', s, after);
    return after;
  }

  async remove(id: string) {
    RequestCtx.assert('accounting.bankrec.delete');
    const s = await this.statement(id);
    this.assertOpen(s);
    await this.prisma.$transaction(async (tx) => {
      // free the ledger lines so they can be matched on another statement
      await tx.bankReconMatch.deleteMany({ where: { line: { statementId: s.id } } });
      await tx.bankStatement.update({ where: { id: s.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
      await this.audit.record('Bank Statement', s.id, 'DELETE', s, undefined, tx);
    });
    return { success: true };
  }

  async addLines(id: string, body: unknown) {
    RequestCtx.assert('accounting.bankrec.create');
    const s = await this.statement(id);
    this.assertOpen(s);
    const lines = z.object({ lines: z.array(lineInput).min(1).max(5000) }).parse(body).lines;
    this.assertLinesInPeriod(lines, s.periodStart.toISOString().slice(0, 10), s.periodEnd.toISOString().slice(0, 10));
    const last = await this.prisma.bankStatementLine.aggregate({ where: { statementId: s.id }, _max: { lineNo: true } });
    const start = (last._max.lineNo ?? 0) + 1;
    await this.prisma.bankStatementLine.createMany({ data: lines.map((l, i) => ({ statementId: s.id, lineNo: start + i, date: new Date(l.date), description: l.description, reference: l.reference ?? null, amount: D(l.amount) })) });
    await this.audit.record('Bank Statement', s.id, 'ADD_LINES', undefined, { lines: lines.length });
    return { added: lines.length };
  }

  private async line(statementId: string, lineId: string) {
    if (!UUID.test(lineId)) throw new NotFoundException('Statement line not found');
    const l = await this.prisma.bankStatementLine.findFirst({ where: { id: lineId, statementId }, include: { matches: true } });
    if (!l) throw new NotFoundException('Statement line not found');
    return l;
  }

  async removeLine(id: string, lineId: string) {
    RequestCtx.assert('accounting.bankrec.create');
    const s = await this.statement(id);
    this.assertOpen(s);
    const l = await this.line(s.id, lineId);
    if (l.matches.length) throw new ConflictException('Unmatch the line before deleting it');
    await this.prisma.bankStatementLine.delete({ where: { id: l.id } });
    await this.audit.record('Bank Statement', s.id, 'DELETE_LINE', l, undefined);
    return { success: true };
  }

  // ------------------------------------------------------------------ matching
  async match(id: string, lineId: string, body: unknown) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const s = await this.statement(id);
    this.assertOpen(s);
    const { journalLineIds } = z.object({ journalLineIds: z.array(z.uuid()).min(1).max(100) }).parse(body);
    const bank = await this.bank(s.bankAccountId);
    const l = await this.line(s.id, lineId);
    const ids = [...new Set(journalLineIds)];
    const rows = await this.ledgerLines(bank.accountId!, addDays(s.periodEnd, 3660), false, ids);
    if (rows.length !== ids.length) throw new BadRequestException('Some ledger lines are not posted lines of this bank account');
    const taken = await this.prisma.bankReconMatch.findMany({ where: { journalLineId: { in: ids }, NOT: { lineId: l.id } }, select: { journalLineId: true } });
    if (taken.length) throw new ConflictException('Some ledger lines are already matched to another statement line');
    const total = round(sum(rows.map((r) => D(r.amount))));
    if (!total.equals(round(D(l.amount)))) throw new BadRequestException(`The selected ledger lines add up to ${total.toFixed(2)}, the statement line is ${D(l.amount).toFixed(2)}`);
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      await tx.bankReconMatch.deleteMany({ where: { lineId: l.id } });
      await tx.bankReconMatch.createMany({ data: ids.map((jid) => ({ companyId: u.companyId, lineId: l.id, journalLineId: jid, matchedById: u.id })) });
      await this.audit.record('Bank Statement', s.id, 'MATCH', undefined, { line: l.lineNo, ledgerLines: rows.map((r) => r.number) }, tx);
    });
    return { matched: ids.length };
  }

  async unmatch(id: string, lineId: string) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const s = await this.statement(id);
    this.assertOpen(s);
    const l = await this.line(s.id, lineId);
    if (!l.matches.length) throw new ConflictException('The line is not matched');
    await this.prisma.bankReconMatch.deleteMany({ where: { lineId: l.id } });
    await this.audit.record('Bank Statement', s.id, 'UNMATCH', { line: l.lineNo, matches: l.matches.length }, undefined);
    return { success: true };
  }

  /** Same amount, bank date within a few days of the book date; a reference found in the journal wins ties */
  async autoMatch(id: string) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const s = await this.statement(id);
    this.assertOpen(s);
    const bank = await this.bank(s.bankAccountId);
    const lines = await this.prisma.bankStatementLine.findMany({ where: { statementId: s.id, matches: { none: {} } }, orderBy: [{ date: 'asc' }, { lineNo: 'asc' }] });
    const pool = await this.ledgerLines(bank.accountId!, addDays(s.periodEnd, LOOKAHEAD_DAYS), true);
    const used = new Set<string>();
    const pairs: { lineId: string; journalLineId: string }[] = [];
    const norm = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const l of lines) {
      const amt = round(D(l.amount));
      const tokens = [l.reference, ...l.description.split(/\s+/)].map(norm).filter((t) => t.length >= 5);
      let best: { row: LedgerRow; score: number } | null = null;
      for (const r of pool) {
        if (used.has(r.id) || !round(D(r.amount)).equals(amt)) continue;
        const gap = Math.abs(r.date.getTime() - l.date.getTime()) / dayMs;
        if (gap > AUTO_MATCH_DAYS) continue;
        const hay = norm(`${r.number} ${r.reference ?? ''} ${r.description ?? ''} ${r.lineDescription ?? ''}`);
        const hit = tokens.some((t) => hay.includes(t));
        const score = (hit ? 100 : 0) - gap;
        if (!best || score > best.score) best = { row: r, score };
      }
      if (best) {
        used.add(best.row.id);
        pairs.push({ lineId: l.id, journalLineId: best.row.id });
      }
    }
    if (pairs.length) {
      const u = RequestCtx.user();
      await this.prisma.bankReconMatch.createMany({ data: pairs.map((p) => ({ companyId: u.companyId, ...p, matchedById: u.id })) });
      await this.audit.record('Bank Statement', s.id, 'AUTO_MATCH', undefined, { matched: pairs.length });
    }
    return { matched: pairs.length, remaining: lines.length - pairs.length };
  }

  /** Bank charges, interest or a transfer that is not in the books yet: records it as money in / out and matches it */
  async createTransaction(id: string, lineId: string, body: unknown) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const s = await this.statement(id);
    this.assertOpen(s);
    const input = createTxSchema.parse(body);
    const bank = await this.bank(s.bankAccountId);
    const l = await this.line(s.id, lineId);
    if (l.matches.length) throw new ConflictException('The line is already matched');
    if (l.cashTransactionId) {
      const t = await this.prisma.cashTransaction.findUnique({ where: { id: l.cashTransactionId }, select: { status: true, number: true } });
      if (t && t.status !== 'CANCELLED') throw new ConflictException(`Transaction ${t.number} was already created for this line`);
    }
    const amount = D(l.amount);
    const type = amount.gt(0) ? 'RECEIPT' : 'PAYMENT';
    const row = await this.cash.create({
      type,
      date: l.date.toISOString().slice(0, 10),
      bankAccountId: bank.id,
      accountId: input.accountId,
      amount: amount.abs().toNumber(),
      partyName: input.partyName ?? null,
      reference: l.reference ?? `${s.number} #${l.lineNo}`,
      description: input.description ?? l.description,
    });
    await this.prisma.bankStatementLine.update({ where: { id: l.id }, data: { cashTransactionId: row.id } });
    if (row.status !== 'CONFIRMED') return { transaction: { id: row.id, number: row.number, status: row.status }, matched: false, message: `${row.number} needs approval before it is posted. Match the line after it is posted.` };
    const entry = await this.prisma.journalEntry.findFirst({ where: { sourceType: `CASH_${type}`, sourceId: row.id, status: 'POSTED' }, include: { lines: true } });
    const jl = entry?.lines.find((x) => x.accountId === bank.accountId);
    if (!jl) return { transaction: { id: row.id, number: row.number, status: row.status }, matched: false, message: 'Transaction recorded; match it manually.' };
    const u = RequestCtx.user();
    await this.prisma.bankReconMatch.create({ data: { companyId: u.companyId, lineId: l.id, journalLineId: jl.id, matchedById: u.id } });
    await this.audit.record('Bank Statement', s.id, 'MATCH', undefined, { line: l.lineNo, created: row.number });
    return { transaction: { id: row.id, number: row.number, status: row.status }, matched: true };
  }

  // ------------------------------------------------------------------ reconcile
  async reconcile(id: string) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const d = await this.get(id);
    if (d.statusCode !== 'OPEN') throw new ConflictException(`${d.number} is already reconciled`);
    if (d.summary.unmatchedCount) throw new ConflictException(`${d.summary.unmatchedCount} statement line${d.summary.unmatchedCount === 1 ? ' is' : 's are'} not matched yet`);
    if (!d.summary.statementCheck.isZero()) throw new ConflictException(`Opening balance + lines differs from the closing balance by ${d.summary.statementCheck.toFixed(2)}: a statement line is missing or wrong`);
    if (!d.summary.difference.isZero()) throw new ConflictException(`The books differ from the bank by ${d.summary.difference.toFixed(2)}`);
    const u = RequestCtx.user();
    const after = await this.prisma.bankStatement.update({ where: { id: d.id }, data: { statusCode: 'RECONCILED', reconciledAt: new Date(), reconciledById: u.id, updatedById: u.id } });
    await this.audit.record('Bank Statement', d.id, 'RECONCILE', { statusCode: 'OPEN' }, { statusCode: 'RECONCILED', bookBalance: d.summary.bookBalance.toString(), closingBalance: d.closingBalance.toString() });
    return after;
  }

  async reopen(id: string) {
    RequestCtx.assert('accounting.bankrec.reconcile');
    const s = await this.statement(id);
    if (s.statusCode !== 'RECONCILED') throw new ConflictException(`${s.number} is not reconciled`);
    const later = await this.prisma.bankStatement.findFirst({ where: { companyId: s.companyId, bankAccountId: s.bankAccountId, deletedAt: null, statusCode: 'RECONCILED', periodStart: { gt: s.periodEnd } }, select: { number: true } });
    if (later) throw new ConflictException(`Reopen ${later.number} first`);
    const after = await this.prisma.bankStatement.update({ where: { id: s.id }, data: { statusCode: 'OPEN', reconciledAt: null, reconciledById: null, updatedById: RequestCtx.user().id } });
    await this.audit.record('Bank Statement', s.id, 'REOPEN', { statusCode: 'RECONCILED' }, { statusCode: 'OPEN' });
    return after;
  }
}
