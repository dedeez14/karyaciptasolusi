import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { DocumentService } from '../documents/document.service';
import { JournalService } from '../accounting/journal.service';
import { billedLogIds } from './timesheet.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export interface BillingGroup {
  key: string;
  taskId: string;
  taskCode: string;
  taskTitle: string;
  userId: string;
  userName: string;
  hours: number;
  amount: number;
  rate: number;
  from: string;
  to: string;
  entries: number;
  logIds: string[];
}

/** Invoicing the billable hours logged on a project's tasks */
@Injectable()
export class TimeBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly docs: DocumentService,
    private readonly journal: JournalService,
  ) {}

  private async project(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Project not found');
    const p = await this.prisma.project.findFirst({ where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.ProjectWhereInput), id, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** what stops invoicing (empty = ready) */
  private async readiness(p: { id: string; customerId: string | null; hourlyRate: Prisma.Decimal; billingProductId: string | null; companyId: string }) {
    const issues: string[] = [];
    const [customer, product] = await Promise.all([
      p.customerId ? this.prisma.customer.findFirst({ where: { id: p.customerId, companyId: p.companyId, deletedAt: null }, select: { id: true, code: true, name: true, isActive: true } }) : null,
      p.billingProductId ? this.prisma.product.findFirst({ where: { id: p.billingProductId, companyId: p.companyId, deletedAt: null }, select: { id: true, code: true, name: true, type: true, isActive: true } }) : null,
    ]);
    if (!customer) issues.push('Set the customer of the project');
    else if (!customer.isActive) issues.push(`Customer ${customer.name} is inactive`);
    if (!(Number(p.hourlyRate) > 0) && !(await this.prisma.projectRate.count({ where: { projectId: p.id } }))) issues.push('Set an hourly rate on the project, or rates per person');
    if (!product) issues.push('Choose the billing product (a service) on the project');
    else if (!product.isActive) issues.push(`Billing product ${product.name} is inactive`);
    else if (product.type === 'STOCK') issues.push(`Billing product ${product.name} is a stock item - choose a service product`);
    return { issues, customer, product };
  }

  /** billing rate of each person on the project (rate card), else the project's hourly rate */
  private async rates(projectId: string, fallback: number) {
    const rows = await this.prisma.projectRate.findMany({ where: { projectId } });
    const m = new Map(rows.map((r) => [r.userId, Number(r.hourlyRate)]));
    return (userId: string) => m.get(userId) ?? fallback;
  }

  private async unbilled(projectId: string, rate: number) {
    const rateOf = await this.rates(projectId, rate);
    const companyId = RequestCtx.companyId();
    const logs = await this.prisma.taskTimeLog.findMany({
      where: { billable: true, task: { companyId, projectId, deletedAt: null } },
      orderBy: { date: 'asc' },
      include: { task: { select: { id: true, code: true, title: true } } },
    });
    const billed = await billedLogIds(this.prisma, logs);
    const open = logs.filter((l) => !billed.has(l.id));
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(open.map((l) => l.userId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const groups = new Map<string, BillingGroup>();
    for (const l of open) {
      const key = `${l.taskId}|${l.userId}`;
      const g =
        groups.get(key) ??
        ({ key, taskId: l.taskId, taskCode: l.task.code, taskTitle: l.task.title, userId: l.userId, userName: users.get(l.userId) ?? 'Unknown user', hours: 0, amount: 0, rate: rateOf(l.userId), from: iso(l.date), to: iso(l.date), entries: 0, logIds: [] } as BillingGroup);
      g.hours = r2(g.hours + Number(l.hours));
      g.entries++;
      g.logIds.push(l.id);
      if (iso(l.date) < g.from) g.from = iso(l.date);
      if (iso(l.date) > g.to) g.to = iso(l.date);
      groups.set(key, g);
    }
    const list = [...groups.values()].map((g) => ({ ...g, amount: r2(g.hours * g.rate) })).sort((a, b) => a.taskCode.localeCompare(b.taskCode) || a.userName.localeCompare(b.userName));
    return { list, billedLogs: logs.filter((l) => billed.has(l.id)) };
  }

  async summary(id: string) {
    RequestCtx.assert('master.project.read');
    const p = await this.project(id);
    const rate = Number(p.hourlyRate);
    const { issues, customer, product } = await this.readiness(p);
    const { list, billedLogs } = await this.unbilled(p.id, rate);
    // invoices that carry billed hours of this project
    const invIds = [...new Set(billedLogs.map((l) => l.invoiceId).filter((x): x is string => !!x))];
    const invoices = invIds.length
      ? await this.prisma.tradeDocument.findMany({ where: { id: { in: invIds } }, orderBy: { date: 'desc' }, select: { id: true, number: true, date: true, status: true, grandTotal: true } })
      : [];
    const hoursPerInvoice = new Map<string, number>();
    for (const l of billedLogs) hoursPerInvoice.set(l.invoiceId!, r2((hoursPerInvoice.get(l.invoiceId!) ?? 0) + Number(l.hours)));
    const rateRows = await this.prisma.projectRate.findMany({ where: { projectId: p.id } });
    const rateUsers = new Map((await this.prisma.user.findMany({ where: { id: { in: rateRows.map((r) => r.userId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      rates: rateRows.map((r) => ({ userId: r.userId, userName: rateUsers.get(r.userId) ?? 'Unknown user', hourlyRate: Number(r.hourlyRate) })),
      project: { id: p.id, code: p.code, name: p.name, hourlyRate: rate, customer, product },
      issues,
      canBill: RequestCtx.can('task.billing.create') && RequestCtx.can('sales.invoice.create'),
      unbilled: list,
      totalHours: r2(list.reduce((a, g) => a + g.hours, 0)),
      totalAmount: r2(list.reduce((a, g) => a + g.amount, 0)),
      invoices: invoices.map((d) => ({ ...d, grandTotal: Number(d.grandTotal), hours: hoursPerInvoice.get(d.id) ?? 0 })),
    };
  }

  /** Creates a DRAFT sales invoice from the unbilled hours (all, or the chosen groups) and marks the logs */
  async invoice(id: string, input: { date?: string | null; keys?: string[] | null }) {
    RequestCtx.assert('task.billing.create');
    RequestCtx.assert('sales.invoice.create');
    const p = await this.project(id);
    const { issues, product } = await this.readiness(p);
    if (issues.length) throw new ConflictException(`Cannot invoice the hours yet: ${issues.join('; ')}`);
    const rate = Number(p.hourlyRate);
    const { list } = await this.unbilled(p.id, rate);
    const chosen = input.keys?.length ? list.filter((g) => input.keys!.includes(g.key)) : list;
    if (!chosen.length) throw new ConflictException('There are no unbilled billable hours on this project');
    const noRate = chosen.filter((g) => !(g.rate > 0));
    if (noRate.length) throw new ConflictException(`No billing rate for ${[...new Set(noRate.map((g) => g.userName))].join(', ')}: set the project rate or their rate`);
    const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
    const from = chosen.reduce((a, g) => (g.from < a ? g.from : a), chosen[0].from);
    const to = chosen.reduce((a, g) => (g.to > a ? g.to : a), chosen[0].to);
    const range = (a: string, b: string) => (a === b ? fmt(new Date(a)) : `${fmt(new Date(a))} - ${fmt(new Date(b))}`);

    const doc = await this.docs.create('SI', {
      date,
      customerId: p.customerId,
      projectId: p.id,
      reference: p.code,
      notes: `Time billing ${p.code} - ${p.name}, ${range(from, to)}`,
      lines: chosen.map((g) => ({
        productId: product!.id,
        description: `${g.taskTitle} – ${g.userName} – ${g.hours} h (${range(g.from, g.to)})`.slice(0, 1000),
        qty: g.hours,
        unitPrice: g.rate,
      })),
    });
    const logIds = chosen.flatMap((g) => g.logIds);
    await this.prisma.taskTimeLog.updateMany({ where: { id: { in: logIds } }, data: { invoiceId: doc.id } });
    const hours = r2(chosen.reduce((a, g) => a + g.hours, 0));
    const amount = r2(chosen.reduce((a, g) => a + g.amount, 0));
    await this.audit.record('Project', p.id, 'BILL_TIME', undefined, { invoice: doc.number, invoiceId: doc.id, hours, amount, entries: logIds.length });
    return { invoiceId: doc.id, number: doc.number, hours, amount, entries: logIds.length };
  }

  /** replace the project's rate card (people billed at their own rate) */
  async setRates(id: string, rows: { userId: string; hourlyRate: number }[]) {
    RequestCtx.assert('master.project.update');
    const p = await this.project(id);
    const ids = [...new Set(rows.map((r) => r.userId))];
    if (ids.length !== rows.length) throw new ConflictException('One rate per person');
    if (ids.length && (await this.prisma.user.count({ where: { id: { in: ids } } })) !== ids.length) throw new NotFoundException('Unknown user');
    const before = await this.prisma.projectRate.findMany({ where: { projectId: p.id } });
    await this.prisma.$transaction([this.prisma.projectRate.deleteMany({ where: { projectId: p.id } }), this.prisma.projectRate.createMany({ data: rows.map((r) => ({ projectId: p.id, userId: r.userId, hourlyRate: new Prisma.Decimal(r.hourlyRate) })) })]);
    await this.audit.record('Project', p.id, 'RATES', before.map((r) => ({ userId: r.userId, rate: Number(r.hourlyRate) })), rows);
    return this.summary(id);
  }

  /**
   * Work in progress across projects: billable hours not invoiced, valued at the billing rate, by age of the hours on
   * the date (0-30, 31-60, 61-90, over 90 days).
   */
  async wip(asOf: string) {
    RequestCtx.assert('task.timesheet.read');
    const companyId = RequestCtx.companyId();
    const until = new Date(asOf);
    const logs = await this.prisma.taskTimeLog.findMany({ where: { billable: true, date: { lte: until }, task: { companyId, deletedAt: null, projectId: { not: null } } }, include: { task: { select: { projectId: true } } } });
    const billed = await billedLogIds(this.prisma, logs);
    const open = logs.filter((l) => !billed.has(l.id));
    const projects = await this.prisma.project.findMany({ where: { id: { in: [...new Set(open.map((l) => l.task.projectId!))] }, deletedAt: null }, select: { id: true, code: true, name: true, hourlyRate: true, customerId: true } });
    const rateRows = await this.prisma.projectRate.findMany({ where: { projectId: { in: projects.map((x) => x.id) } } });
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: projects.map((x) => x.customerId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const rows = new Map<string, { projectId: string; code: string; name: string; customer: string | null; hours: number; amount: number; noRateHours: number; buckets: number[]; oldest: string }>();
    for (const l of open) {
      const pr = projects.find((x) => x.id === l.task.projectId);
      if (!pr) continue;
      const rate = Number(rateRows.find((r) => r.projectId === pr.id && r.userId === l.userId)?.hourlyRate ?? pr.hourlyRate);
      const row = rows.get(pr.id) ?? { projectId: pr.id, code: pr.code, name: pr.name, customer: pr.customerId ? (customers.get(pr.customerId) ?? null) : null, hours: 0, amount: 0, noRateHours: 0, buckets: [0, 0, 0, 0], oldest: iso(l.date) };
      const h = Number(l.hours);
      const v = h * rate;
      const age = Math.floor((until.getTime() - l.date.getTime()) / 86_400_000);
      row.hours += h;
      row.amount += v;
      if (!(rate > 0)) row.noRateHours += h;
      row.buckets[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += v;
      if (iso(l.date) < row.oldest) row.oldest = iso(l.date);
      rows.set(pr.id, row);
    }
    const list = [...rows.values()].map((r) => ({ ...r, hours: r2(r.hours), amount: r2(r.amount), noRateHours: r2(r.noRateHours), buckets: r.buckets.map(r2) })).sort((a, b) => b.amount - a.amount);
    const accruals = await this.prisma.wipAccrual.findMany({ where: { companyId }, orderBy: { asOf: 'desc' }, take: 24 });
    return {
      asOf,
      rows: list,
      total: { hours: r2(list.reduce((a, r) => a + r.hours, 0)), amount: r2(list.reduce((a, r) => a + r.amount, 0)), buckets: [0, 1, 2, 3].map((i) => r2(list.reduce((a, r) => a + r.buckets[i], 0))) },
      accruals: accruals.map((x) => ({ id: x.id, asOf: iso(x.asOf), amount: Number(x.amount), hours: Number(x.hours), status: x.status })),
    };
  }

  /**
   * Month-end accrual of the unbilled hours (services revenue by stage of completion, SAK EP Bab 23): Dr Accrued Revenue / Cr Service
   * Revenue on the date, reversed the next day so the invoice books the revenue again in full.
   */
  async accrue(asOf: string) {
    RequestCtx.assert('accounting.journal.post');
    const u = RequestCtx.user();
    const day = new Date(asOf);
    const next = new Date(day.getTime() + 86_400_000);
    if (next.getUTCDate() !== 1) throw new ConflictException('Accrue on the last day of a month');
    if (await this.prisma.wipAccrual.findFirst({ where: { companyId: u.companyId, asOf: day, status: 'POSTED' } })) throw new ConflictException('This month is already accrued: void it first');
    const w = await this.wip(asOf);
    const lines = w.rows.filter((r) => r.amount > 0).map((r) => ({ projectId: r.projectId, code: r.code, hours: r.hours, amount: r.amount }));
    const amount = r2(lines.reduce((a, r) => a + r.amount, 0));
    if (!(amount > 0)) throw new ConflictException('No unbilled hours with a rate to accrue');
    const a = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.wipAccrual.create({ data: { companyId: u.companyId, asOf: day, amount: new Prisma.Decimal(amount), hours: new Prisma.Decimal(w.total.hours), lines: lines as Prisma.InputJsonValue, createdById: u.id } });
      const amt = new Prisma.Decimal(amount);
      await this.journal.post(tx, { companyId: u.companyId, date: day, description: `Unbilled hours at ${asOf} (${lines.length} projects)`, reference: `WIP ${asOf}`, sourceType: 'WIPACC', sourceId: rec.id, lines: [{ key: 'UNBILLED_REVENUE', debit: amt, description: 'Services performed, not yet invoiced' }, { key: 'SERVICE_REVENUE', credit: amt, description: `Accrued time ${asOf}` }] });
      await this.journal.post(tx, { companyId: u.companyId, date: next, description: `Reversal of the unbilled hours at ${asOf}`, reference: `WIP ${asOf}`, sourceType: 'WIPACC', sourceId: rec.id, lines: [{ key: 'SERVICE_REVENUE', debit: amt, description: `Reversal of accrued time ${asOf}` }, { key: 'UNBILLED_REVENUE', credit: amt, description: 'Reversal' }] });
      return rec;
    });
    await this.audit.record('WIP Accrual', a.id, 'POST', null, { asOf, amount });
    return this.wip(asOf);
  }

  async voidAccrual(id: string) {
    RequestCtx.assert('accounting.journal.post');
    const a = await this.prisma.wipAccrual.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!a) throw new NotFoundException('Accrual not found');
    if (a.status !== 'POSTED') throw new ConflictException('Already void');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'WIPACC', a.id);
      await tx.wipAccrual.update({ where: { id }, data: { status: 'VOID' } });
    });
    await this.audit.record('WIP Accrual', id, 'VOID');
    return { ok: true };
  }
}
