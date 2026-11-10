import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { DocumentService } from '../documents/document.service';
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
  ) {}

  private async project(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Project not found');
    const p = await this.prisma.project.findFirst({ where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.ProjectWhereInput), id, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** what stops invoicing (empty = ready) */
  private async readiness(p: { customerId: string | null; hourlyRate: Prisma.Decimal; billingProductId: string | null; companyId: string }) {
    const issues: string[] = [];
    const [customer, product] = await Promise.all([
      p.customerId ? this.prisma.customer.findFirst({ where: { id: p.customerId, companyId: p.companyId, deletedAt: null }, select: { id: true, code: true, name: true, isActive: true } }) : null,
      p.billingProductId ? this.prisma.product.findFirst({ where: { id: p.billingProductId, companyId: p.companyId, deletedAt: null }, select: { id: true, code: true, name: true, type: true, isActive: true } }) : null,
    ]);
    if (!customer) issues.push('Set the customer of the project');
    else if (!customer.isActive) issues.push(`Customer ${customer.name} is inactive`);
    if (!(Number(p.hourlyRate) > 0)) issues.push('Set an hourly rate on the project');
    if (!product) issues.push('Choose the billing product (a service) on the project');
    else if (!product.isActive) issues.push(`Billing product ${product.name} is inactive`);
    else if (product.type === 'STOCK') issues.push(`Billing product ${product.name} is a stock item - choose a service product`);
    return { issues, customer, product };
  }

  private async unbilled(projectId: string, rate: number) {
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
        ({ key, taskId: l.taskId, taskCode: l.task.code, taskTitle: l.task.title, userId: l.userId, userName: users.get(l.userId) ?? 'Unknown user', hours: 0, amount: 0, from: iso(l.date), to: iso(l.date), entries: 0, logIds: [] } as BillingGroup);
      g.hours = r2(g.hours + Number(l.hours));
      g.entries++;
      g.logIds.push(l.id);
      if (iso(l.date) < g.from) g.from = iso(l.date);
      if (iso(l.date) > g.to) g.to = iso(l.date);
      groups.set(key, g);
    }
    const list = [...groups.values()].map((g) => ({ ...g, amount: r2(g.hours * rate) })).sort((a, b) => a.taskCode.localeCompare(b.taskCode) || a.userName.localeCompare(b.userName));
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
    return {
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
        unitPrice: rate,
      })),
    });
    const logIds = chosen.flatMap((g) => g.logIds);
    await this.prisma.taskTimeLog.updateMany({ where: { id: { in: logIds } }, data: { invoiceId: doc.id } });
    const hours = r2(chosen.reduce((a, g) => a + g.hours, 0));
    const amount = r2(chosen.reduce((a, g) => a + g.amount, 0));
    await this.audit.record('Project', p.id, 'BILL_TIME', undefined, { invoice: doc.number, invoiceId: doc.id, hours, amount, entries: logIds.length });
    return { invoiceId: doc.id, number: doc.number, hours, amount, entries: logIds.length };
  }
}
