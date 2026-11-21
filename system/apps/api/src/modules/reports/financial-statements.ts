import { Prisma } from '@prisma/client';
import type { ReportCtx, ReportResult } from './report.registry';

/**
 * Financial statements required by SAK EP (Standar Akuntansi Keuangan Entitas Privat, effective 1 Jan 2025):
 * statement of cash flows (indirect method) and statement of changes in equity, plus comparative figures.
 * Year-end closing journals are left out everywhere: they only move profit into retained earnings.
 */

const n = (v: unknown) => Number(v ?? 0);
const day = (s: string | undefined, fallback: string) => new Date(s ?? fallback);

interface Row {
  id: string;
  code: string;
  name: string;
  type: string;
  cashFlowCode: string | null;
  isCash: boolean;
  isAccum: boolean;
  isOpening: boolean;
  opening: Prisma.Decimal;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

async function movements(ctx: ReportCtx, start: Date, end: Date) {
  return ctx.prisma.$queryRaw<Row[]>`
    SELECT a.id, a.code, a.name, a.type::text AS type, a."cashFlowCode",
      EXISTS (SELECT 1 FROM bank_accounts b WHERE b."accountId" = a.id AND b."deletedAt" IS NULL) AS "isCash",
      EXISTS (SELECT 1 FROM account_mappings m WHERE m."accountId" = a.id AND m.key = 'ACCUM_DEPRECIATION') OR EXISTS (SELECT 1 FROM fixed_assets f WHERE f."accumDepAccountId" = a.id) AS "isAccum",
      EXISTS (SELECT 1 FROM account_mappings m WHERE m."accountId" = a.id AND m.key = 'OPENING_EQUITY') AS "isOpening",
      COALESCE(SUM(CASE WHEN e.date < ${start} THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
      COALESCE(SUM(CASE WHEN e.date >= ${start} THEN l.debit ELSE 0 END), 0) AS debit,
      COALESCE(SUM(CASE WHEN e.date >= ${start} THEN l.credit ELSE 0 END), 0) AS credit
    FROM accounts a
    JOIN journal_lines l ON l."accountId" = a.id
    JOIN journal_entries e ON e.id = l."entryId" AND e.status = 'POSTED' AND e.date <= ${end} AND e."deletedAt" IS NULL
      AND COALESCE(e."sourceType", '') <> 'CLOSING'
    WHERE a."companyId" = ${ctx.companyId}::uuid
    GROUP BY a.id ORDER BY a.code`;
}

/** cash flow section of a balance sheet account: explicit setting first, else from the account */
function section(r: Row): 'CASH' | 'OPERATING' | 'INVESTING' | 'FINANCING' | 'PL' {
  if (r.type === 'INCOME' || r.type === 'EXPENSE') return 'PL';
  if (r.cashFlowCode) return r.cashFlowCode as 'CASH';
  if (r.isCash) return 'CASH';
  if (r.isAccum) return 'OPERATING'; // depreciation: non-cash, added back
  if (r.type === 'ASSET') return /^1-2/.test(r.code) ? 'INVESTING' : 'OPERATING';
  if (r.type === 'LIABILITY') return /^2-2/.test(r.code) ? 'FINANCING' : 'OPERATING';
  return 'FINANCING'; // equity
}

export async function cashFlowStatement(ctx: ReportCtx): Promise<ReportResult> {
  const from = day(ctx.p.from, '1970-01-01');
  const to = day(ctx.p.to, '2999-12-31');
  const rows = await movements(ctx, from, to);
  const out: Record<string, unknown>[] = [];
  const line = (label: string, amount: number | null, kind: 'head' | 'item' | 'total' = 'item') => out.push({ section: kind === 'head' ? label : kind === 'total' ? label : '', item: kind === 'item' ? label : '', amount });

  const profit = rows.filter((r) => section(r) === 'PL').reduce((a, r) => a + n(r.credit) - n(r.debit), 0);
  const effect = (r: Row) => n(r.credit) - n(r.debit); // asset up = cash out, liability / equity up = cash in
  const totals: Record<string, number> = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };

  line('CASH FLOWS FROM OPERATING ACTIVITIES', null, 'head');
  line('Profit / (loss) for the period', profit);
  totals.OPERATING += profit;
  for (const r of rows.filter((x) => section(x) === 'OPERATING')) {
    const v = effect(r);
    if (Math.abs(v) < 0.005) continue;
    const label = r.isAccum ? `Depreciation (${r.name})` : r.type === 'ASSET' ? `${v > 0 ? 'Decrease' : 'Increase'} in ${r.name}` : `${v > 0 ? 'Increase' : 'Decrease'} in ${r.name}`;
    line(label, v);
    totals.OPERATING += v;
  }
  line('Net cash from operating activities', totals.OPERATING, 'total');

  for (const [key, title, total] of [
    ['INVESTING', 'CASH FLOWS FROM INVESTING ACTIVITIES', 'Net cash from investing activities'],
    ['FINANCING', 'CASH FLOWS FROM FINANCING ACTIVITIES', 'Net cash from financing activities'],
  ] as const) {
    line(title, null, 'head');
    for (const r of rows.filter((x) => section(x) === key)) {
      const v = effect(r);
      if (Math.abs(v) < 0.005) continue;
      const label = r.isOpening ? 'Opening balances entered at go-live' : r.type === 'ASSET' ? `${v < 0 ? 'Purchase of' : 'Proceeds from'} ${r.name}` : `${r.name}${v < 0 ? ' (paid / repaid)' : ' (received)'}`;
      line(label, v);
      totals[key] += v;
    }
    line(total, totals[key], 'total');
  }

  const cash = rows.filter((r) => section(r) === 'CASH');
  const begin = cash.reduce((a, r) => a + n(r.opening), 0);
  const change = cash.reduce((a, r) => a + n(r.debit) - n(r.credit), 0);
  const net = totals.OPERATING + totals.INVESTING + totals.FINANCING;
  line('NET INCREASE / (DECREASE) IN CASH', net, 'total');
  line('Cash and cash equivalents at the beginning of the period', begin, 'total');
  line('CASH AND CASH EQUIVALENTS AT THE END OF THE PERIOD', begin + change, 'total');
  if (Math.abs(net - change) > 1) line(`Unreconciled difference ${Math.round(net - change).toLocaleString('id-ID')}: check the cash flow section of your accounts`, net - change, 'total');

  return {
    subtitle: `Laporan Arus Kas (metode tidak langsung) · ${ctx.p.from ?? '...'} to ${ctx.p.to ?? '...'}`,
    columns: [
      { key: 'section', label: 'Section' },
      { key: 'item', label: 'Item' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows: out,
  };
}

export async function equityStatement(ctx: ReportCtx): Promise<ReportResult> {
  const from = day(ctx.p.from, '1970-01-01');
  const to = day(ctx.p.to, '2999-12-31');
  const rows = await movements(ctx, from, to);
  const mapping = await ctx.prisma.accountMapping.findMany({ where: { companyId: ctx.companyId, key: { in: ['RETAINED_EARNINGS', 'CURRENT_EARNINGS'] } }, select: { accountId: true } });
  const earningsIds = new Set(mapping.map((m) => m.accountId));
  const pl = rows.filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE');
  // profit not yet closed before the period belongs to retained earnings at the start
  const plBefore = pl.reduce((a, r) => a - n(r.opening), 0);
  const profit = pl.reduce((a, r) => a + n(r.credit) - n(r.debit), 0);

  const out: Record<string, unknown>[] = [];
  let tOpen = 0;
  let tMove = 0;
  for (const r of rows.filter((x) => x.type === 'EQUITY' && !earningsIds.has(x.id))) {
    const open = -n(r.opening);
    const move = n(r.credit) - n(r.debit);
    if (!open && !move) continue;
    out.push({ component: `${r.code} ${r.name}`, opening: open, profit: 0, other: move, closing: open + move });
    tOpen += open;
    tMove += move;
  }
  const re = rows.filter((x) => x.type === 'EQUITY' && earningsIds.has(x.id));
  const reOpen = re.reduce((a, r) => a - n(r.opening), 0) + plBefore;
  const reMove = re.reduce((a, r) => a + n(r.credit) - n(r.debit), 0);
  out.push({ component: 'Retained earnings (incl. profit not yet closed)', opening: reOpen, profit, other: reMove, closing: reOpen + profit + reMove });
  out.push({ component: 'TOTAL EQUITY', opening: tOpen + reOpen, profit, other: tMove + reMove, closing: tOpen + reOpen + profit + tMove + reMove });
  return {
    subtitle: `Laporan Perubahan Ekuitas · ${ctx.p.from ?? '...'} to ${ctx.p.to ?? '...'}`,
    columns: [
      { key: 'component', label: 'Component' },
      { key: 'opening', label: 'At the start', type: 'money' },
      { key: 'profit', label: 'Profit for the period', type: 'money' },
      { key: 'other', label: 'Capital / dividends / other', type: 'money' },
      { key: 'closing', label: 'At the end', type: 'money' },
    ],
    rows: out,
  };
}

/** the comparison range for comparative columns: previous period of the same length, or the same dates a year earlier */
export function comparisonRange(p: ReportCtx['p']): { from: Date; to: Date; label: string } | null {
  if (!p.compare || p.compare === 'none' || !p.from || !p.to) return null;
  const from = new Date(p.from);
  const to = new Date(p.to);
  if (p.compare === 'year') {
    const f = new Date(from);
    const t = new Date(to);
    f.setUTCFullYear(f.getUTCFullYear() - 1);
    t.setUTCFullYear(t.getUTCFullYear() - 1);
    return { from: f, to: t, label: `${f.toISOString().slice(0, 10)} to ${t.toISOString().slice(0, 10)}` };
  }
  // whole calendar months (e.g. 1-30 Nov): compare with the same number of whole months before
  const monthEnd = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
  if (from.getUTCDate() === 1 && to.getTime() === monthEnd.getTime()) {
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1;
    const f = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
    const t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0));
    return { from: f, to: t, label: `${f.toISOString().slice(0, 10)} to ${t.toISOString().slice(0, 10)}` };
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const t = new Date(from.getTime() - 86_400_000);
  const f = new Date(t.getTime() - (days - 1) * 86_400_000);
  return { from: f, to: t, label: `${f.toISOString().slice(0, 10)} to ${t.toISOString().slice(0, 10)}` };
}
