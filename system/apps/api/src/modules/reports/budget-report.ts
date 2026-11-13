import { Prisma } from '@prisma/client';
import type { ReportCtx, ReportResult } from './report.registry';

const creditNatured = (type: string) => type === 'INCOME' || type === 'LIABILITY' || type === 'EQUITY';

/**
 * Budget vs Actual for a date range, per account.
 * Budget = approved / closed budgets of the years in range, months inside the range.
 * Actual = posted journals inside the range. Optional cost center / project filter.
 */
export async function budgetVsActual({ prisma, companyId, p }: ReportCtx): Promise<ReportResult> {
  const from = new Date(p.from ?? `${new Date().getUTCFullYear()}-01-01`);
  const to = new Date(p.to ?? new Date().toISOString().slice(0, 10));
  const startIdx = from.getUTCFullYear() * 12 + from.getUTCMonth();
  const endIdx = to.getUTCFullYear() * 12 + to.getUTCMonth();
  const years = Array.from({ length: to.getUTCFullYear() - from.getUTCFullYear() + 1 }, (_, i) => from.getUTCFullYear() + i).slice(0, 20);

  const lines = await prisma.budgetLine.findMany({
    where: {
      budget: {
        companyId,
        deletedAt: null,
        statusCode: { in: ['APPROVED', 'CLOSED'] },
        year: { in: years },
      },
      ...(p.costCenterId ? { costCenterId: p.costCenterId } : {}),
      ...(p.projectId ? { projectId: p.projectId } : {}),
    },
    select: {
      accountId: true,
      month: true,
      amount: true,
      budget: { select: { year: true } },
    },
  });
  const budget = new Map<string, number>();
  for (const l of lines) {
    const idx = l.budget.year * 12 + l.month - 1;
    if (idx < startIdx || idx > endIdx) continue;
    budget.set(l.accountId, (budget.get(l.accountId) ?? 0) + Number(l.amount));
  }

  const actualRows = await prisma.$queryRaw<{ accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT l."accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l."entryId"
    WHERE e."companyId" = ${companyId}::uuid AND e.status = 'POSTED' AND e."deletedAt" IS NULL AND e.date >= ${from} AND e.date <= ${to}
      ${p.costCenterId ? Prisma.sql`AND l."costCenterId" = ${p.costCenterId}::uuid` : Prisma.empty}
      ${p.projectId ? Prisma.sql`AND l."projectId" = ${p.projectId}::uuid` : Prisma.empty}
    GROUP BY l."accountId"`;
  const accountIds = [...new Set([...budget.keys(), ...actualRows.map((r) => r.accountId)])];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, code: true, name: true, type: true },
  });
  const am = new Map(accounts.map((a) => [a.id, a]));
  const actual = new Map<string, number>();
  for (const r of actualRows) {
    const a = am.get(r.accountId);
    if (!a) continue;
    const v = Number(r.debit) - Number(r.credit);
    actual.set(r.accountId, creditNatured(a.type) ? -v : v);
  }

  // budgeted accounts plus income / expense accounts with activity (unbudgeted spending must be visible)
  const rows = accountIds
    .map((id) => am.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a && (budget.has(a.id) || a.type === 'INCOME' || a.type === 'EXPENSE'))
    .map((a) => {
      const b = Math.round((budget.get(a.id) ?? 0) * 100) / 100;
      const act = Math.round((actual.get(a.id) ?? 0) * 100) / 100;
      const variance = Math.round((a.type === 'INCOME' ? act - b : b - act) * 100) / 100;
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        budget: b,
        actual: act,
        variance,
        used: b ? Math.round((act / b) * 1000) / 10 : null,
        status: !b ? 'Not budgeted' : variance >= 0 ? 'On track' : a.type === 'INCOME' ? 'Below target' : 'Over budget',
      };
    })
    .filter((r) => r.budget || r.actual)
    .sort((x, y) => (x.type === y.type ? x.code.localeCompare(y.code) : x.type === 'INCOME' ? -1 : y.type === 'INCOME' ? 1 : x.type.localeCompare(y.type)));

  const sum = (type: string, k: 'budget' | 'actual') => Math.round(rows.filter((r) => r.type === type).reduce((t, r) => t + r[k], 0) * 100) / 100;
  const total = (name: string, b: number, act: number, incomeLike: boolean) => ({
    code: '',
    name,
    type: '',
    budget: b,
    actual: act,
    variance: Math.round((incomeLike ? act - b : b - act) * 100) / 100,
    used: b ? Math.round((act / b) * 1000) / 10 : null,
    status: '',
  });
  const inc = { b: sum('INCOME', 'budget'), a: sum('INCOME', 'actual') };
  const exp = { b: sum('EXPENSE', 'budget'), a: sum('EXPENSE', 'actual') };
  const summary = [total('TOTAL INCOME', inc.b, inc.a, true), total('TOTAL EXPENSES', exp.b, exp.a, false), total('NET PROFIT / (LOSS)', inc.b - exp.b, inc.a - exp.a, true)];
  return {
    subtitle: `${p.from ?? ''} to ${p.to ?? ''} · variance: positive = favourable`,
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Account' },
      { key: 'type', label: 'Type' },
      { key: 'budget', label: 'Budget', type: 'money' },
      { key: 'actual', label: 'Actual', type: 'money' },
      { key: 'variance', label: 'Variance', type: 'money' },
      { key: 'used', label: 'Used %', type: 'percent' },
      { key: 'status', label: 'Status' },
    ],
    rows: [...rows, ...summary],
  };
}
