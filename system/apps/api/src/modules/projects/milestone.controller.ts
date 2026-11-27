import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Activity, Permission } from '../../common/decorators';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { DocumentService } from '../documents/document.service';

const r2 = (n: number) => Math.round(n * 100) / 100;
const milestoneInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Every milestone needs a name').max(150),
  percent: z.coerce.number().min(0).max(100).nullish(),
  amount: z.coerce.number().min(0, 'Amounts cannot be negative').max(9_999_999_999_999),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')),
  trigger: z.string().trim().max(200).nullish(),
});
const planInput = z.object({
  contractValue: z.coerce.number().min(0).max(9_999_999_999_999),
  milestones: z.array(milestoneInput).max(24, 'At most 24 milestones'),
});
const invoiceInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });

const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Invalid data');
  return r.data;
};

/**
 * Billing milestones (termin) of client projects: the contract value split into parts that are invoiced one by one
 * (e.g. 30% down payment, 40% after the demo, 30% after handover), with the state of each invoice.
 */
@Controller('projects/:id/milestones')
export class MilestoneController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly docs: DocumentService,
  ) {}

  private async project(id: string) {
    const p = await this.prisma.project.findFirst({ where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.ProjectWhereInput), id, deletedAt: null } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  @Get()
  @Permission('master.project.read')
  async list(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.project(id);
    const companyId = RequestCtx.companyId();
    const [rows, customer, product] = await Promise.all([
      this.prisma.projectMilestone.findMany({ where: { companyId, projectId: p.id, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      p.customerId ? this.prisma.customer.findFirst({ where: { id: p.customerId, companyId, deletedAt: null }, select: { id: true, name: true, isActive: true } }) : null,
      p.billingProductId ? this.prisma.product.findFirst({ where: { id: p.billingProductId, companyId, deletedAt: null }, select: { id: true, name: true, type: true, isActive: true } }) : null,
    ]);
    const invIds = rows.map((m) => m.invoiceId).filter((x): x is string => !!x);
    const invoices = invIds.length
      ? await this.prisma.tradeDocument.findMany({ where: { id: { in: invIds }, companyId }, select: { id: true, number: true, status: true, date: true, dueDate: true, grandTotal: true, paidAmount: true } })
      : [];
    const inv = new Map(invoices.map((d) => [d.id, d]));
    const today = new Date().toISOString().slice(0, 10);
    const milestones = rows.map((m) => {
      const d = m.invoiceId ? inv.get(m.invoiceId) : undefined;
      const cancelled = d?.status === 'CANCELLED';
      const total = d ? Number(d.grandTotal) : 0;
      const paid = d && !cancelled ? Number(d.paidAmount) : 0;
      const state = !d || cancelled ? (m.dueDate && m.dueDate.toISOString().slice(0, 10) < today ? 'DUE' : 'PLANNED') : d.status === 'DRAFT' ? 'DRAFT' : paid >= total - 0.005 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'INVOICED';
      return {
        id: m.id,
        name: m.name,
        percent: m.percent === null ? null : Number(m.percent),
        amount: Number(m.amount),
        dueDate: m.dueDate?.toISOString().slice(0, 10) ?? null,
        trigger: m.trigger,
        state,
        invoice: d && !cancelled ? { id: d.id, number: d.number, status: d.status, total, paid, dueDate: d.dueDate?.toISOString().slice(0, 10) ?? null } : null,
        locked: !!d && !cancelled,
      };
    });
    const contractValue = Number(p.contractValue);
    const planned = r2(milestones.reduce((a, m) => a + m.amount, 0));
    const invoiced = r2(milestones.reduce((a, m) => a + (m.invoice ? m.amount : 0), 0));
    const paid = r2(milestones.reduce((a, m) => a + (m.invoice?.paid ?? 0), 0));
    const issues: string[] = [];
    if (!customer) issues.push('Set the customer of the project');
    else if (!customer.isActive) issues.push(`Customer ${customer.name} is inactive`);
    if (!product) issues.push('Choose the billing product (a service) on the project');
    else if (product.type === 'STOCK') issues.push(`Billing product ${product.name} is a stock item - choose a service product`);
    return {
      contractValue,
      customer,
      product,
      issues,
      canEdit: RequestCtx.can('master.project.update'),
      canInvoice: RequestCtx.can('sales.invoice.create') && !issues.length,
      totals: { planned, invoiced, paid, outstanding: r2(invoiced - paid), notInvoiced: r2(contractValue - invoiced), unplanned: r2(contractValue - planned) },
      milestones,
    };
  }

  /** Saves the contract value and the plan; milestones that already have an invoice cannot be changed or removed */
  @Put()
  @Permission('master.project.update')
  @Activity('project.milestones')
  async save(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    const p = await this.project(id);
    const b = parse(planInput, raw);
    const companyId = RequestCtx.companyId();
    const uid = RequestCtx.user().id;
    const current = await this.prisma.projectMilestone.findMany({ where: { companyId, projectId: p.id, deletedAt: null } });
    const invIds = current.map((m) => m.invoiceId).filter((x): x is string => !!x);
    const liveInv = new Set(
      (await this.prisma.tradeDocument.findMany({ where: { id: { in: invIds }, status: { not: 'CANCELLED' } }, select: { id: true } })).map((d) => d.id),
    );
    const locked = new Map(current.filter((m) => m.invoiceId && liveInv.has(m.invoiceId)).map((m) => [m.id, m]));
    const total = r2(b.milestones.reduce((a, m) => a + m.amount, 0));
    if (b.contractValue > 0 && total > b.contractValue + 0.005) throw new BadRequestException(`The milestones add up to ${total.toLocaleString('id-ID')}, more than the contract value`);
    for (const m of locked.values()) {
      const sent = b.milestones.find((x) => x.id === m.id);
      if (!sent) throw new ConflictException(`"${m.name}" already has an invoice and cannot be removed`);
      if (Math.abs(sent.amount - Number(m.amount)) > 0.005) throw new ConflictException(`"${m.name}" already has an invoice: its amount cannot change`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: p.id }, data: { contractValue: b.contractValue, updatedById: uid } });
      const keep = new Set(b.milestones.map((m) => m.id).filter(Boolean));
      await tx.projectMilestone.updateMany({ where: { companyId, projectId: p.id, deletedAt: null, id: { notIn: [...keep] as string[] }, NOT: { id: { in: [...locked.keys()] } } }, data: { deletedAt: new Date(), updatedById: uid } });
      for (const [i, m] of b.milestones.entries()) {
        const data = { sortOrder: i, name: m.name, percent: m.percent ?? null, amount: m.amount, dueDate: m.dueDate ? new Date(`${m.dueDate}T00:00:00Z`) : null, trigger: m.trigger || null, updatedById: uid };
        if (m.id && current.some((c) => c.id === m.id)) await tx.projectMilestone.update({ where: { id: m.id }, data });
        else await tx.projectMilestone.create({ data: { ...data, companyId, projectId: p.id, createdById: uid } });
      }
    });
    await this.audit.record('Project', p.id, 'MILESTONES', { contractValue: Number(p.contractValue), count: current.length }, { contractValue: b.contractValue, count: b.milestones.length, total });
    return this.list(id);
  }

  /** A DRAFT sales invoice for one milestone (one line: the billing product, the milestone amount) */
  @Post(':mid/invoice')
  @Permission('sales.invoice.create')
  @Activity('project.milestone.invoice')
  async invoice(@Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() raw: unknown) {
    const p = await this.project(id);
    const { date } = parse(invoiceInput, raw ?? {});
    const overview = await this.list(id);
    if (overview.issues.length) throw new ConflictException(`Cannot invoice yet: ${overview.issues.join('; ')}`);
    const m = await this.prisma.projectMilestone.findFirst({ where: { id: mid, projectId: p.id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!m) throw new NotFoundException('Milestone not found');
    const state = overview.milestones.find((x) => x.id === m.id);
    if (state?.invoice) throw new ConflictException(`"${m.name}" already has invoice ${state.invoice.number}`);
    if (!(Number(m.amount) > 0)) throw new ConflictException('The milestone has no amount');
    const pct = m.percent !== null ? ` (${Number(m.percent).toLocaleString('id-ID')}%)` : '';
    const doc = await this.docs.create('SI', {
      date: date || new Date().toISOString().slice(0, 10),
      customerId: p.customerId,
      projectId: p.id,
      reference: p.code,
      notes: `${p.name} - ${m.name}${pct}${m.trigger ? `. ${m.trigger}` : ''}`.slice(0, 1000),
      lines: [{ productId: overview.product!.id, description: `${p.name} - ${m.name}${pct}`.slice(0, 1000), qty: 1, unitPrice: Number(m.amount) }],
    });
    await this.prisma.projectMilestone.update({ where: { id: m.id }, data: { invoiceId: doc.id, updatedById: RequestCtx.user().id } });
    await this.audit.record('Project', p.id, 'BILL_MILESTONE', undefined, { milestone: m.name, invoice: doc.number, invoiceId: doc.id, amount: Number(m.amount) });
    return { invoiceId: doc.id, number: doc.number };
  }
}
