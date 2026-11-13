import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, ZERO } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { isUuid } from '../billing/job-context';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const year = z.coerce.number().int().min(2000, 'Year is not valid').max(2100, 'Year is not valid');

const rowSchema = z.object({
  accountId: z.uuid('Account is required'),
  costCenterId: optUuid,
  projectId: optUuid,
  amounts: z.array(z.coerce.number().min(-1e14).max(1e14)).length(12),
});

export const budgetSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  year,
  notes: optText(4000),
  rows: z.array(rowSchema).max(2000).default([]),
});

export const createSchema = budgetSchema.extend({
  /** start from another budget (copy) or from last year's actual figures */
  copyFromBudgetId: optUuid,
  fromActualYear: z.preprocess((v) => (v === '' || v === null ? undefined : v), year.optional()),
  upliftPct: z.coerce.number().min(-100).max(1000).default(0),
});

export type BudgetRow = z.infer<typeof rowSchema>;
type Budget = Prisma.BudgetGetPayload<{ include: { lines: true } }>;

/** Sign convention: income / liability / equity accounts are measured on the credit side. */
export const creditNatured = (type: string) => type === 'INCOME' || type === 'LIABILITY' || type === 'EQUITY';

/** Annual budgets per account (optionally per cost center / project) with a Budget vs Actual comparison. */
@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private async findOwned(id: string): Promise<Budget> {
    if (!isUuid(id)) throw new NotFoundException('Budget not found');
    const b = await this.prisma.budget.findFirst({
      where: { id, companyId: RequestCtx.companyId(), deletedAt: null },
      include: { lines: true },
    });
    if (!b) throw new NotFoundException('Budget not found');
    return b;
  }

  private key = (r: { accountId: string; costCenterId?: string | null; projectId?: string | null }) => `${r.accountId}|${r.costCenterId ?? ''}|${r.projectId ?? ''}`;

  /** budget_lines (one per month) -> grid rows (12 amounts) */
  private toRows(lines: Budget['lines']): BudgetRow[] {
    const map = new Map<string, BudgetRow>();
    for (const l of lines) {
      const k = this.key(l);
      const r = map.get(k) ?? {
        accountId: l.accountId,
        costCenterId: l.costCenterId,
        projectId: l.projectId,
        amounts: Array(12).fill(0),
      };
      r.amounts[l.month - 1] += Number(l.amount);
      map.set(k, r);
    }
    return [...map.values()];
  }

  private toLines(rows: BudgetRow[], factor = 1) {
    return rows.flatMap((r) =>
      r.amounts
        .map((a, i) => ({
          accountId: r.accountId,
          costCenterId: r.costCenterId ?? null,
          projectId: r.projectId ?? null,
          month: i + 1,
          amount: round(D(a).times(factor)),
        }))
        .filter((l) => !l.amount.isZero()),
    );
  }

  private async validateRows(rows: BudgetRow[]) {
    const companyId = RequestCtx.companyId();
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const k = this.key(r);
      if (seen.has(k))
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            [`rows.${i}.accountId`]: 'This account / cost center / project combination is already in the budget',
          },
        });
      seen.add(k);
    });
    const ids = (k: 'accountId' | 'costCenterId' | 'projectId') => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
    const [accounts, ccs, projects] = await Promise.all([
      this.prisma.account.findMany({
        where: {
          id: { in: ids('accountId') },
          companyId,
          deletedAt: null,
          isGroup: false,
        },
        select: { id: true },
      }),
      this.prisma.costCenter.count({
        where: { id: { in: ids('costCenterId') }, companyId, deletedAt: null },
      }),
      this.prisma.project.count({
        where: { id: { in: ids('projectId') }, companyId, deletedAt: null },
      }),
    ]);
    const ok = new Set(accounts.map((a) => a.id));
    rows.forEach((r, i) => {
      if (!ok.has(r.accountId))
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            [`rows.${i}.accountId`]: 'Choose a detail account of this company',
          },
        });
    });
    if (ccs !== ids('costCenterId').length) throw new BadRequestException('Invalid cost center');
    if (projects !== ids('projectId').length) throw new BadRequestException('Invalid project');
  }

  private async names(
    rows: {
      accountId: string;
      costCenterId?: string | null;
      projectId?: string | null;
    }[],
  ) {
    const ids = (k: 'accountId' | 'costCenterId' | 'projectId') => [...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])];
    const [accounts, ccs, projects] = await Promise.all([
      this.prisma.account.findMany({
        where: { id: { in: ids('accountId') } },
        select: { id: true, code: true, name: true, type: true },
      }),
      this.prisma.costCenter.findMany({
        where: { id: { in: ids('costCenterId') } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.project.findMany({
        where: { id: { in: ids('projectId') } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      acc: new Map(accounts.map((a) => [a.id, a])),
      cc: new Map(ccs.map((c) => [c.id, c.name])),
      prj: new Map(projects.map((p) => [p.id, p.name])),
    };
  }

  // ------------------------------------------------------------------ queries
  async list(q: { page: number; pageSize: number; search?: string; year?: number; status?: string }) {
    RequestCtx.assert('accounting.budget.read');
    const where: Prisma.BudgetWhereInput = {
      companyId: RequestCtx.companyId(),
      deletedAt: null,
    };
    if (q.year) where.year = q.year;
    if (q.status) where.statusCode = q.status;
    if (q.search) where.OR = [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.budget.findMany({
        where,
        orderBy: [{ year: 'desc' }, { code: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.budget.count({ where }),
    ]);
    const sums = await this.prisma.budgetLine.groupBy({
      by: ['budgetId'],
      where: { budgetId: { in: rows.map((r) => r.id) } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const sm = new Map(sums.map((s) => [s.budgetId, s]));
    // totals split by nature so income and expense are not added together
    const typed = rows.length
      ? await this.prisma.$queryRaw<{ budgetId: string; type: string; total: Prisma.Decimal }[]>`
          SELECT l."budgetId", a.type::text AS type, SUM(l.amount) AS total
          FROM budget_lines l JOIN accounts a ON a.id = l."accountId"
          WHERE l."budgetId" IN (${Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`))})
          GROUP BY l."budgetId", a.type`
      : [];
    const t = (id: string, type: string) => typed.filter((x) => x.budgetId === id && x.type === type).reduce((a, x) => a.plus(D(x.total)), ZERO);
    return paged(
      rows.map((r) => ({
        ...r,
        lineCount: sm.get(r.id)?._count._all ?? 0,
        income: t(r.id, 'INCOME'),
        expense: t(r.id, 'EXPENSE'),
        other: D(sm.get(r.id)?._sum.amount).minus(t(r.id, 'INCOME')).minus(t(r.id, 'EXPENSE')),
      })),
      total,
      q,
    );
  }

  async get(id: string) {
    RequestCtx.assert('accounting.budget.read');
    const b = await this.findOwned(id);
    const rows = this.toRows(b.lines);
    const n = await this.names(rows);
    const approver = b.approvedById
      ? await this.prisma.user.findUnique({
          where: { id: b.approvedById },
          select: { fullName: true },
        })
      : null;
    const { lines: _lines, ...head } = b;
    return {
      ...head,
      approvedByName: approver?.fullName ?? null,
      rows: rows
        .map((r) => {
          const a = n.acc.get(r.accountId);
          return {
            ...r,
            accountCode: a?.code ?? '',
            accountName: a?.name ?? '',
            accountType: a?.type ?? null,
            costCenterName: r.costCenterId ? (n.cc.get(r.costCenterId) ?? null) : null,
            projectName: r.projectId ? (n.prj.get(r.projectId) ?? null) : null,
            total: r.amounts.reduce((x, y) => x + y, 0),
          };
        })
        .sort((x, y) => x.accountCode.localeCompare(y.accountCode) || (x.costCenterName ?? '').localeCompare(y.costCenterName ?? '')),
    };
  }

  // ------------------------------------------------------------------ write
  /** Rows from last year's posted figures of income and expense accounts. */
  private async actualRows(y: number): Promise<BudgetRow[]> {
    const data = await this.actuals(y);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(data.map((d) => d.accountId))] } },
      select: { id: true, type: true },
    });
    const tm = new Map(accounts.map((a) => [a.id, a.type as string]));
    const map = new Map<string, BudgetRow>();
    for (const d of data) {
      const type = tm.get(d.accountId);
      if (type !== 'INCOME' && type !== 'EXPENSE') continue;
      const r = map.get(d.accountId) ?? {
        accountId: d.accountId,
        costCenterId: null,
        projectId: null,
        amounts: Array(12).fill(0),
      };
      const v = Number(d.debit) - Number(d.credit);
      r.amounts[d.month - 1] += creditNatured(type) ? -v : v;
      map.set(d.accountId, r);
    }
    return [...map.values()].map((r) => ({
      ...r,
      amounts: r.amounts.map((x) => Math.round(x * 100) / 100),
    }));
  }

  async create(body: unknown) {
    RequestCtx.assert('accounting.budget.create');
    const input = createSchema.parse(body);
    let rows = input.rows;
    let factor = 1;
    if (input.copyFromBudgetId) {
      rows = this.toRows((await this.findOwned(input.copyFromBudgetId)).lines);
      factor = 1 + input.upliftPct / 100;
    } else if (input.fromActualYear) {
      rows = await this.actualRows(input.fromActualYear);
      factor = 1 + input.upliftPct / 100;
    }
    await this.validateRows(rows);
    const u = RequestCtx.user();
    return this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('BUDGET', u.companyId, new Date(Date.UTC(input.year, 0, 1)), tx);
      const b = await tx.budget.create({
        data: {
          companyId: u.companyId,
          code,
          name: input.name,
          year: input.year,
          notes: input.notes ?? null,
          statusCode: 'DRAFT',
          createdById: u.id,
          lines: { create: this.toLines(rows, factor) },
        },
      });
      await this.audit.record('Budget', b.id, 'CREATE', undefined, { ...b, rows: rows.length }, tx);
      return b;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('accounting.budget.update');
    const before = await this.findOwned(id);
    if (before.statusCode !== 'DRAFT') throw new ConflictException('Only draft budgets can be edited. Re-open it first.');
    const input = budgetSchema.parse(body);
    await this.validateRows(input.rows);
    return this.prisma.$transaction(async (tx) => {
      await tx.budgetLine.deleteMany({ where: { budgetId: id } });
      const b = await tx.budget.update({
        where: { id },
        data: {
          name: input.name,
          year: input.year,
          notes: input.notes ?? null,
          updatedById: RequestCtx.user().id,
          lines: { create: this.toLines(input.rows) },
        },
      });
      const total = (rows: BudgetRow[]) => rows.reduce((t, r) => t + r.amounts.reduce((a, x) => a + x, 0), 0);
      await this.audit.record(
        'Budget',
        id,
        'UPDATE',
        {
          name: before.name,
          year: before.year,
          notes: before.notes,
          rows: this.toRows(before.lines).length,
          total: total(this.toRows(before.lines)),
        },
        {
          name: b.name,
          year: b.year,
          notes: b.notes,
          rows: input.rows.length,
          total: total(input.rows),
        },
        tx,
      );
      return b;
    });
  }

  async remove(id: string) {
    RequestCtx.assert('accounting.budget.delete');
    const before = await this.findOwned(id);
    if (before.statusCode !== 'DRAFT') throw new ConflictException('Only draft budgets can be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.budget.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: RequestCtx.user().id },
      });
      await this.audit.record('Budget', id, 'DELETE', { code: before.code, name: before.name, year: before.year }, undefined, tx);
    });
    return { success: true };
  }

  private async transition(id: string, from: string[], to: string, action: string) {
    RequestCtx.assert('accounting.budget.approve');
    const before = await this.findOwned(id);
    if (!from.includes(before.statusCode)) throw new ConflictException(`Budget is ${before.statusCode.toLowerCase()}`);
    if (to === 'APPROVED' && !before.lines.length) throw new BadRequestException('Add at least one budget line before approving');
    const u = RequestCtx.user();
    const b = await this.prisma.budget.update({
      where: { id },
      data: {
        statusCode: to,
        updatedById: u.id,
        ...(to === 'APPROVED' ? { approvedById: u.id, approvedAt: new Date() } : to === 'DRAFT' ? { approvedById: null, approvedAt: null } : {}),
      },
    });
    await this.audit.record('Budget', id, action, { statusCode: before.statusCode }, { statusCode: b.statusCode });
    return b;
  }

  approve = (id: string) => this.transition(id, ['DRAFT'], 'APPROVED', 'APPROVE');
  reopen = (id: string) => this.transition(id, ['APPROVED', 'CLOSED'], 'DRAFT', 'REOPEN');
  close = (id: string) => this.transition(id, ['APPROVED'], 'CLOSED', 'CLOSE');

  async copy(id: string, body: unknown) {
    const src = await this.findOwned(id);
    const input = z
      .object({
        year,
        name: optText(200),
        upliftPct: z.coerce.number().min(-100).max(1000).default(0),
      })
      .parse(body);
    return this.create({
      name: input.name || `${src.name.replace(/\b(19|20)\d{2}\b/, String(input.year))}${/\b(19|20)\d{2}\b/.test(src.name) ? '' : ` ${input.year}`}`,
      year: input.year,
      notes: src.notes,
      copyFromBudgetId: id,
      upliftPct: input.upliftPct,
    });
  }

  // ------------------------------------------------------------------ budget vs actual
  /** posted journal movements of a year per account / cost center / project / month */
  private actuals(y: number) {
    return this.prisma.$queryRaw<
      {
        accountId: string;
        costCenterId: string | null;
        projectId: string | null;
        month: number;
        debit: Prisma.Decimal;
        credit: Prisma.Decimal;
      }[]
    >`
      SELECT l."accountId", l."costCenterId", l."projectId", EXTRACT(MONTH FROM e.date)::int AS month, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
      WHERE e."companyId" = ${RequestCtx.companyId()}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL
        AND e.date >= ${new Date(Date.UTC(y, 0, 1))} AND e.date <= ${new Date(Date.UTC(y, 11, 31))}
      GROUP BY l."accountId", l."costCenterId", l."projectId", month`;
  }

  /**
   * Budget vs Actual per budget row and month. A row with a cost center / project only counts
   * postings tagged with it; a row without one counts the account's remaining postings.
   */
  async vsActual(id: string, throughMonth?: number) {
    RequestCtx.assert('accounting.budget.read');
    const b = await this.get(id);
    const through = Math.min(12, Math.max(1, throughMonth ?? 12));
    const data = await this.actuals(b.year);
    // every posting counts for exactly one row: the most specific matching row of its account
    // (cost center + project > cost center > project > account only), so a general row and a
    // cost-center row of the same account never count the same spending twice
    const owner = new Map<(typeof data)[number], number>();
    for (const d of data) {
      let best = -1;
      let bestScore = -1;
      b.rows.forEach((r, i) => {
        if (r.accountId !== d.accountId) return;
        if (r.costCenterId && r.costCenterId !== d.costCenterId) return;
        if (r.projectId && r.projectId !== d.projectId) return;
        const score = (r.costCenterId ? 2 : 0) + (r.projectId ? 1 : 0);
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      });
      if (best >= 0) owner.set(d, best);
    }
    const rows = b.rows.map((r, ri) => {
      const credit = creditNatured(r.accountType ?? '');
      const actual = Array(12).fill(0) as number[];
      for (const d of data) {
        if (owner.get(d) !== ri) continue;
        const v = Number(d.debit) - Number(d.credit);
        actual[d.month - 1] += credit ? -v : v;
      }
      const budget = r.amounts.slice(0, through).reduce((a, x) => a + x, 0);
      const act = Math.round(actual.slice(0, through).reduce((a, x) => a + x, 0) * 100) / 100;
      const variance = Math.round((budget - act) * 100) / 100;
      // spending below budget / income above budget is favourable
      const favourable = r.accountType === 'INCOME' ? act >= budget : act <= budget;
      return {
        ...r,
        actual: actual.map((x) => Math.round(x * 100) / 100),
        budgetToDate: budget,
        actualToDate: act,
        variance,
        usedPct: budget ? Math.round((act / budget) * 1000) / 10 : null,
        favourable,
      };
    });
    const sumBy = (type: string, k: 'budgetToDate' | 'actualToDate') => rows.filter((r) => r.accountType === type).reduce((a, r) => a + r[k], 0);
    const income = {
      budget: sumBy('INCOME', 'budgetToDate'),
      actual: sumBy('INCOME', 'actualToDate'),
    };
    const expense = {
      budget: sumBy('EXPENSE', 'budgetToDate'),
      actual: sumBy('EXPENSE', 'actualToDate'),
    };
    return {
      budget: {
        id: b.id,
        code: b.code,
        name: b.name,
        year: b.year,
        statusCode: b.statusCode,
      },
      through,
      rows,
      summary: {
        income,
        expense,
        profit: {
          budget: income.budget - expense.budget,
          actual: income.actual - expense.actual,
        },
      },
      monthly: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        incomeBudget: rows.filter((r) => r.accountType === 'INCOME').reduce((a, r) => a + r.amounts[i], 0),
        incomeActual: rows.filter((r) => r.accountType === 'INCOME').reduce((a, r) => a + r.actual[i], 0),
        expenseBudget: rows.filter((r) => r.accountType === 'EXPENSE').reduce((a, r) => a + r.amounts[i], 0),
        expenseActual: rows.filter((r) => r.accountType === 'EXPENSE').reduce((a, r) => a + r.actual[i], 0),
      })),
    };
  }
}
