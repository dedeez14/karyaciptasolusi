import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Permission } from '../../common/decorators';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0) || 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (d = new Date()) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
};
const MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 };

export interface CashItem {
  date: string;
  kind: 'RECEIVABLE' | 'MILESTONE' | 'SUBSCRIPTION' | 'PAYABLE' | 'PAYROLL';
  label: string;
  amount: number;
  /** money already late: expected now, but uncertain */
  overdue?: boolean;
  link?: string;
}

/**
 * Cash flow forecast for the next 13 weeks: today's cash and bank balance, plus what customers should pay
 * (open invoices, milestones still to invoice, recurring billing) minus what the company has to pay (open bills,
 * the monthly payroll). Overdue amounts are expected in the first week and flagged.
 */
@Controller('director/cashflow')
export class CashflowController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @Permission('accounting.cash.read')
  async forecast(@Query('weeks') weeksRaw?: string) {
    const companyId = RequestCtx.companyId();
    const weeks = Math.min(26, Math.max(4, Number(weeksRaw) || 13));
    const today = utcDay();
    const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
    const end = addDays(monday, weeks * 7);
    const scope = this.access.scopeWhere({ branchField: 'branchId' });

    // ---- opening: posted balance of every cash / bank account
    const banks = await this.prisma.bankAccount.findMany({ where: { ...(scope as Prisma.BankAccountWhereInput), deletedAt: null, isActive: true }, select: { id: true, name: true, accountId: true } });
    const accountIds = banks.map((b) => b.accountId).filter((x): x is string => !!x);
    const sums = accountIds.length
      ? await this.prisma.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, entry: { companyId, status: 'POSTED', deletedAt: null } }, _sum: { debit: true, credit: true } })
      : [];
    const bal = new Map(sums.map((s) => [s.accountId, num(s._sum.debit) - num(s._sum.credit)]));
    const accounts = banks.map((b) => ({ name: b.name, balance: r2(b.accountId ? bal.get(b.accountId) ?? 0 : 0) }));
    const opening = r2(accounts.reduce((a, b) => a + b.balance, 0));

    const items: CashItem[] = [];
    const due = (d: Date | null, fallback: Date) => (d ?? fallback);

    // ---- receivables and payables still open
    const docs = await this.prisma.tradeDocument.findMany({
      where: { ...(scope as Prisma.TradeDocumentWhereInput), companyId, deletedAt: null, docType: { in: ['SI', 'PI'] }, status: { in: ['CONFIRMED', 'PARTIAL'] } },
      select: { id: true, docType: true, number: true, date: true, dueDate: true, grandTotal: true, paidAmount: true, customerId: true, supplierId: true },
    });
    const [custs, sups] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: docs.map((d) => d.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: docs.map((d) => d.supplierId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const partner = new Map([...custs, ...sups].map((x) => [x.id, x.name]));
    for (const d of docs) {
      const open = r2(num(d.grandTotal) - num(d.paidAmount));
      if (open <= 0.005) continue;
      const when = due(d.dueDate, d.date);
      if (when >= end) continue;
      const overdue = when < today;
      items.push({
        date: iso(overdue ? today : when),
        kind: d.docType === 'SI' ? 'RECEIVABLE' : 'PAYABLE',
        label: `${d.number}${partner.get(d.customerId ?? d.supplierId ?? '') ? ` - ${partner.get(d.customerId ?? d.supplierId ?? '')}` : ''}${overdue ? ` (late since ${iso(when)})` : ''}`,
        amount: d.docType === 'SI' ? open : -open,
        overdue,
        link: `/documents/${d.docType}/${d.id}`,
      });
    }

    // ---- project milestones not invoiced yet, with a due date
    const ms = await this.prisma.projectMilestone.findMany({ where: { companyId, deletedAt: null, invoiceId: null, dueDate: { not: null, lt: end } } });
    const projects = ms.length ? await this.prisma.project.findMany({ where: { id: { in: [...new Set(ms.map((m) => m.projectId))] }, deletedAt: null }, select: { id: true, code: true, name: true } }) : [];
    const pmap = new Map(projects.map((p) => [p.id, p]));
    for (const m of ms) {
      const p = pmap.get(m.projectId);
      if (!p) continue;
      const overdue = m.dueDate! < today;
      items.push({ date: iso(overdue ? today : m.dueDate!), kind: 'MILESTONE', label: `${p.code} ${m.name} (not invoiced yet)`, amount: r2(num(m.amount)), overdue, link: `/projects/${p.id}#milestones` });
    }

    // ---- recurring billing: every run inside the horizon
    const subs = await this.prisma.subscription.findMany({ where: { companyId, isActive: true, deletedAt: null, nextRunDate: { lt: end } }, include: { lines: true } });
    for (const s of subs) {
      const amount = r2(s.lines.reduce((a, l) => a + num(l.qty) * num(l.unitPrice) * (1 - num(l.discountPct) / 100), 0));
      if (!(amount > 0)) continue;
      const step = (MONTHS[s.intervalCode] ?? 1) * Math.max(1, s.intervalCount);
      for (let d = new Date(s.nextRunDate), i = 0; d < end && i < 60; d = addMonths(d, step), i++) {
        if (s.endDate && d > s.endDate) break;
        if (d < today) continue;
        items.push({ date: iso(d), kind: 'SUBSCRIPTION', label: `Recurring billing ${s.name ?? ''}`.trim(), amount, link: `/billing/subscriptions/${s.id}` });
      }
    }

    // ---- payroll: the last confirmed run repeats every month on the same pay day
    const last = await this.prisma.payrollRun.findFirst({ where: { companyId, deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: { payDate: 'desc' }, select: { payDate: true, totalNet: true, paidAt: true } });
    if (last && num(last.totalNet) > 0) {
      let d = last.paidAt ? addMonths(last.payDate, 1) : last.payDate;
      for (let i = 0; d < end && i < 12; d = addMonths(d, 1), i++) {
        if (d < today && i > 0) continue;
        items.push({ date: iso(d < today ? today : d), kind: 'PAYROLL', label: 'Salaries (estimated from the last payroll)', amount: -r2(num(last.totalNet)), overdue: d < today });
      }
    }

    // ---- weekly buckets with the running balance
    items.sort((a, b) => a.date.localeCompare(b.date));
    let balance = opening;
    const buckets = Array.from({ length: weeks }, (_, i) => {
      const start = addDays(monday, i * 7);
      const stop = addDays(start, 7);
      const inWeek = items.filter((x) => x.date >= iso(start) && x.date < iso(stop));
      const inflow = r2(inWeek.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0));
      const outflow = r2(-inWeek.filter((x) => x.amount < 0).reduce((a, x) => a + x.amount, 0));
      balance = r2(balance + inflow - outflow);
      return { start: iso(start), end: iso(addDays(stop, -1)), inflow, outflow, net: r2(inflow - outflow), balance, items: inWeek.length };
    });
    const lowest = buckets.reduce((m, b) => (b.balance < m.balance ? b : m), buckets[0]);
    const firstNegative = buckets.find((b) => b.balance < 0) ?? null;
    return {
      asOf: iso(today),
      opening,
      accounts,
      weeks: buckets,
      lowest: lowest ? { week: lowest.start, balance: lowest.balance } : null,
      firstNegative: firstNegative ? { week: firstNegative.start, balance: firstNegative.balance } : null,
      totals: {
        inflow: r2(buckets.reduce((a, b) => a + b.inflow, 0)),
        outflow: r2(buckets.reduce((a, b) => a + b.outflow, 0)),
        overdueIn: r2(items.filter((x) => x.overdue && x.amount > 0).reduce((a, x) => a + x.amount, 0)),
        overdueOut: r2(-items.filter((x) => x.overdue && x.amount < 0).reduce((a, x) => a + x.amount, 0)),
      },
      items,
    };
  }
}
