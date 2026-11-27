import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { DOC_TYPES } from '../documents/document.registry';
import { num, round2, seesCompany, today, uuid, uuids, yearStart } from './insights.util';

type Kind = 'customer' | 'supplier';
const OPEN = ['CONFIRMED', 'PARTIAL'] as const;
const LIVE = { notIn: ['DRAFT', 'CANCELLED'] as ('DRAFT' | 'CANCELLED')[] };

/** CRM, sales, purchasing, inventory and project figures behind the purpose-built views */
@Injectable()
export class CommercialInsightsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  private docScope(): Prisma.TradeDocumentWhereInput {
    return this.access.scopeWhere({ branchField: 'branchId', ownerField: 'createdById' }) as Prisma.TradeDocumentWhereInput;
  }
  /** document types the user may read (optionally of one partner kind) */
  private readableTypes(kind?: Kind) {
    return DOC_TYPES.filter((d) => (!kind || d.partner === kind) && RequestCtx.can(`${d.permission}.read`)).map((d) => d.code);
  }
  private ticketWhere(): Prisma.TicketWhereInput {
    const u = RequestCtx.user();
    const w: Prisma.TicketWhereInput = { companyId: u.companyId, deletedAt: null };
    if (!seesCompany('support.ticket.manage')) {
      const or: Prisma.TicketWhereInput[] = [{ createdById: u.id }, { assigneeId: u.id }];
      if (u.dataScope === 'BRANCH' && u.branchIds) or.push({ branchId: { in: u.branchIds } });
      w.OR = or;
    }
    return w;
  }
  private taskWhere(): Prisma.TaskWhereInput {
    const u = RequestCtx.user();
    const w: Prisma.TaskWhereInput = { companyId: u.companyId, deletedAt: null };
    if (!seesCompany('task.task.manage')) {
      const or: Prisma.TaskWhereInput[] = [{ assigneeId: u.id }, { reporterId: u.id }, { createdById: u.id }];
      if (u.dataScope === 'BRANCH' && u.branchIds) or.push({ branchId: { in: u.branchIds } });
      w.OR = or;
    }
    return w;
  }

  // ------------------------------------------------------------------ customers & suppliers
  async partner(kind: Kind, id: string) {
    const companyId = RequestCtx.companyId();
    RequestCtx.assert(kind === 'customer' ? 'master.customer.read' : 'master.supplier.read');
    const partner =
      kind === 'customer'
        ? await this.prisma.customer.findFirst({ where: { id: uuid(id), companyId, deletedAt: null }, select: { id: true, creditLimit: true } })
        : await this.prisma.supplier.findFirst({ where: { id: uuid(id), companyId, deletedAt: null }, select: { id: true } });
    if (!partner) throw new NotFoundException(`${kind === 'customer' ? 'Customer' : 'Supplier'} not found`);
    const field = kind === 'customer' ? 'customerId' : 'supplierId';
    const inv = kind === 'customer' ? 'SI' : 'PI';
    const types = this.readableTypes(kind);
    const base: Prisma.TradeDocumentWhereInput = { ...this.docScope(), deletedAt: null, [field]: id };
    const canInv = types.includes(inv);
    const now = today();
    const since12 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

    const [open, ytd, trend, counts, last] = await Promise.all([
      canInv ? this.prisma.tradeDocument.findMany({ where: { ...base, docType: inv, status: { in: [...OPEN] } }, select: { grandTotal: true, paidAmount: true, exchangeRate: true, dueDate: true } }) : [],
      canInv ? this.prisma.tradeDocument.findMany({ where: { ...base, docType: inv, status: LIVE, date: { gte: yearStart() } }, select: { grandTotal: true, exchangeRate: true } }) : [],
      canInv ? this.prisma.tradeDocument.findMany({ where: { ...base, docType: inv, status: LIVE, date: { gte: since12 } }, select: { date: true, grandTotal: true, exchangeRate: true } }) : [],
      types.length ? this.prisma.tradeDocument.groupBy({ by: ['docType'], where: { ...base, docType: { in: types } }, _count: { _all: true } }) : [],
      types.length ? this.prisma.tradeDocument.findFirst({ where: { ...base, docType: { in: types }, status: { not: 'CANCELLED' } }, orderBy: { date: 'desc' }, select: { date: true, number: true, docType: true, id: true } }) : null,
    ]);
    const due = (d: { grandTotal: Prisma.Decimal; paidAmount: Prisma.Decimal; exchangeRate: Prisma.Decimal }) => (num(d.grandTotal) - num(d.paidAmount)) * (num(d.exchangeRate) || 1);
    const months: { month: string; amount: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(since12.getUTCFullYear(), since12.getUTCMonth() + i, 1));
      months.push({ month: d.toISOString().slice(0, 7), amount: 0 });
    }
    for (const t of trend) {
      const k = t.date.toISOString().slice(0, 7);
      const m = months.find((x) => x.month === k);
      if (m) m.amount = round2(m.amount + num(t.grandTotal) * (num(t.exchangeRate) || 1));
    }

    const payPerm = kind === 'customer' ? 'sales.payment.read' : 'purchase.payment.read';
    const extra = await Promise.all([
      RequestCtx.can(payPerm)
        ? this.prisma.payment.findMany({
            where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.PaymentWhereInput), deletedAt: null, [field]: id, direction: kind === 'customer' ? 'IN' : 'OUT' },
            orderBy: { date: 'desc' },
            take: 50,
            select: { id: true, number: true, date: true, amount: true, status: true, reference: true },
          })
        : null,
      kind === 'customer' && RequestCtx.can('crm.activity.read')
        ? this.prisma.crmActivity.findMany({
            where: { ...(this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' }) as Prisma.CrmActivityWhereInput), deletedAt: null, customerId: id },
            orderBy: [{ isDone: 'asc' }, { dueDate: 'desc' }],
            take: 20,
            select: { id: true, subject: true, typeCode: true, dueDate: true, isDone: true },
          })
        : null,
      kind === 'customer' && RequestCtx.can('crm.opportunity.read')
        ? this.prisma.opportunity.findMany({
            where: { ...(this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' }) as Prisma.OpportunityWhereInput), deletedAt: null, customerId: id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, code: true, name: true, amount: true, probability: true, stageId: true, expectedCloseDate: true },
          })
        : null,
      kind === 'customer' && RequestCtx.can('support.ticket.read')
        ? this.prisma.ticket.findMany({ where: { ...this.ticketWhere(), customerId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, code: true, subject: true, statusCode: true, priorityCode: true, createdAt: true, dueAt: true } })
        : null,
    ]);
    const [payments, activities, opportunities, tickets] = extra;
    const stageNames = opportunities?.length
      ? new Map((await this.prisma.pipelineStage.findMany({ where: { companyId, id: { in: opportunities.map((o) => o.stageId).filter((s): s is string => !!s) } }, select: { id: true, name: true, isWon: true, isLost: true } })).map((s) => [s.id, s]))
      : new Map();

    return {
      kpi: canInv
        ? {
            outstanding: round2(open.reduce((a, d) => a + due(d), 0)),
            overdue: round2(open.filter((d) => d.dueDate && d.dueDate < now).reduce((a, d) => a + due(d), 0)),
            openInvoices: open.length,
            ytd: round2(ytd.reduce((a, d) => a + num(d.grandTotal) * (num(d.exchangeRate) || 1), 0)),
            creditLimit: 'creditLimit' in partner ? num(partner.creditLimit) : null,
          }
        : null,
      trend: canInv ? months : null,
      counts: Object.fromEntries(counts.map((c) => [c.docType, c._count._all])),
      last,
      types,
      payments: payments?.map((p) => ({ ...p, amount: num(p.amount) })) ?? null,
      activities,
      opportunities: opportunities?.map((o) => ({ ...o, amount: num(o.amount), stage: stageNames.get(o.stageId ?? '') ?? null })) ?? null,
      tickets,
    };
  }

  /** trade documents of one partner, newest first */
  async partnerDocuments(kind: Kind, id: string, q: { docType?: string; page: number; pageSize: number }) {
    RequestCtx.assert(kind === 'customer' ? 'master.customer.read' : 'master.supplier.read');
    const types = this.readableTypes(kind).filter((t) => !q.docType || t === q.docType);
    if (!types.length) return { data: [], meta: { page: 1, pageSize: q.pageSize, total: 0, totalPages: 1 } };
    const where: Prisma.TradeDocumentWhereInput = { ...this.docScope(), deletedAt: null, [kind === 'customer' ? 'customerId' : 'supplierId']: uuid(id), docType: { in: types } };
    const [rows, total] = await Promise.all([
      this.prisma.tradeDocument.findMany({
        where,
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, docType: true, number: true, date: true, dueDate: true, status: true, currencyCode: true, grandTotal: true, paidAmount: true },
      }),
      this.prisma.tradeDocument.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...r, grandTotal: num(r.grandTotal), paidAmount: num(r.paidAmount) })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
    };
  }

  // ------------------------------------------------------------------ products
  /** on-hand quantity / value per product (catalog cards) */
  async productStock(ids?: string) {
    if (!RequestCtx.can('inventory.stock.read')) return { stock: false, items: {} };
    const list = uuids(ids);
    if (!list.length) return { stock: true, items: {} };
    const g = await this.prisma.stockBalance.groupBy({ by: ['productId'], where: { companyId: RequestCtx.companyId(), productId: { in: list } }, _sum: { qty: true } });
    return { stock: true, items: Object.fromEntries(g.map((x) => [x.productId, num(x._sum.qty)])) };
  }

  async product(id: string) {
    const companyId = RequestCtx.companyId();
    const p = await this.prisma.product.findFirst({ where: { id: uuid(id), companyId, deletedAt: null }, select: { id: true, minStock: true, type: true } });
    if (!p) throw new NotFoundException('Product not found');
    const canStock = RequestCtx.can('inventory.stock.read');
    const lineHistory = async (docType: 'SI' | 'PI') => {
      const def = DOC_TYPES.find((d) => d.code === docType)!;
      if (!RequestCtx.can(`${def.permission}.read`)) return null;
      const lines = await this.prisma.tradeDocumentLine.findMany({
        where: { productId: id, document: { ...this.docScope(), docType, deletedAt: null, status: LIVE } },
        orderBy: { document: { date: 'desc' } },
        take: 15,
        select: { qty: true, unitPrice: true, lineTotal: true, document: { select: { id: true, number: true, date: true, customerId: true, supplierId: true, currencyCode: true } } },
      });
      const partnerIds = [...new Set(lines.map((l) => (docType === 'SI' ? l.document.customerId : l.document.supplierId)).filter((x): x is string => !!x))];
      const names =
        docType === 'SI'
          ? await this.prisma.customer.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
          : await this.prisma.supplier.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } });
      const nm = new Map(names.map((x) => [x.id, x.name]));
      const ytd = await this.prisma.tradeDocumentLine.aggregate({
        where: { productId: id, document: { ...this.docScope(), docType, deletedAt: null, status: LIVE, date: { gte: yearStart() } } },
        _sum: { qty: true, lineTotal: true },
      });
      return {
        ytdQty: num(ytd._sum.qty),
        ytdAmount: round2(num(ytd._sum.lineTotal)),
        lines: lines.map((l) => ({
          documentId: l.document.id,
          number: l.document.number,
          date: l.document.date,
          partner: nm.get((docType === 'SI' ? l.document.customerId : l.document.supplierId) ?? '') ?? null,
          qty: num(l.qty),
          unitPrice: num(l.unitPrice),
          total: num(l.lineTotal),
          currency: l.document.currencyCode,
        })),
      };
    };
    const [balances, movements, sales, purchases] = await Promise.all([
      canStock ? this.prisma.stockBalance.findMany({ where: { companyId, productId: id }, select: { warehouseId: true, qty: true, avgCost: true } }) : null,
      canStock
        ? this.prisma.stockMovement.findMany({
            where: { companyId, productId: id },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
            take: 20,
            select: { id: true, date: true, warehouseId: true, qty: true, unitCost: true, balanceQty: true, docType: true, documentId: true, documentNumber: true },
          })
        : null,
      lineHistory('SI'),
      lineHistory('PI'),
    ]);
    const whIds = [...new Set([...(balances ?? []).map((b) => b.warehouseId), ...(movements ?? []).map((m) => m.warehouseId)])];
    const wh = new Map((await this.prisma.warehouse.findMany({ where: { companyId, id: { in: whIds } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
    return {
      stock: balances
        ? {
            onHand: balances.reduce((a, b) => a + num(b.qty), 0),
            value: round2(balances.reduce((a, b) => a + num(b.qty) * num(b.avgCost), 0)),
            minStock: num(p.minStock),
            warehouses: balances.map((b) => ({ warehouseId: b.warehouseId, warehouse: wh.get(b.warehouseId) ?? '-', qty: num(b.qty), avgCost: num(b.avgCost), value: round2(num(b.qty) * num(b.avgCost)) })),
          }
        : null,
      movements: movements?.map((m) => ({ ...m, warehouse: wh.get(m.warehouseId) ?? '-', qty: num(m.qty), unitCost: num(m.unitCost), balanceQty: num(m.balanceQty) })) ?? null,
      sales,
      purchases,
    };
  }

  // ------------------------------------------------------------------ CRM
  async campaigns() {
    const companyId = RequestCtx.companyId();
    const leadScope = this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' }) as Prisma.LeadWhereInput;
    const canLeads = RequestCtx.can('crm.lead.read');
    const [leads, converted, opps] = await Promise.all([
      canLeads ? this.prisma.lead.groupBy({ by: ['campaignId'], where: { ...leadScope, deletedAt: null, campaignId: { not: null } }, _count: { _all: true }, _sum: { estimatedValue: true } }) : [],
      canLeads ? this.prisma.lead.groupBy({ by: ['campaignId'], where: { ...leadScope, deletedAt: null, campaignId: { not: null }, OR: [{ customerId: { not: null } }, { statusCode: 'CONVERTED' }] }, _count: { _all: true } }) : [],
      canLeads && RequestCtx.can('crm.opportunity.read')
        ? this.prisma.$queryRaw<{ campaignId: string; count: bigint; amount: Prisma.Decimal; won: Prisma.Decimal }[]>`
            SELECT l."campaignId", COUNT(o.id) AS count, COALESCE(SUM(o.amount), 0) AS amount, COALESCE(SUM(o.amount) FILTER (WHERE s."isWon"), 0) AS won
            FROM opportunities o JOIN leads l ON l.id = o."leadId" LEFT JOIN pipeline_stages s ON s.id = o."stageId"
            WHERE o."companyId" = ${companyId}::uuid AND o."deletedAt" IS NULL AND l."deletedAt" IS NULL AND l."campaignId" IS NOT NULL
            GROUP BY l."campaignId"`
        : [],
    ]);
    const out: Record<string, { leads: number; pipeline: number; converted: number; opportunities: number; oppAmount: number; won: number }> = {};
    const get = (k: string) => (out[k] ??= { leads: 0, pipeline: 0, converted: 0, opportunities: 0, oppAmount: 0, won: 0 });
    for (const l of leads) Object.assign(get(l.campaignId!), { leads: l._count._all, pipeline: num(l._sum.estimatedValue) });
    for (const c of converted) get(c.campaignId!).converted = c._count._all;
    for (const o of opps) Object.assign(get(o.campaignId), { opportunities: Number(o.count), oppAmount: num(o.amount), won: num(o.won) });
    return { leads: canLeads, items: out };
  }

  // ------------------------------------------------------------------ projects
  async projectStats(ids?: string) {
    const companyId = RequestCtx.companyId();
    const list = uuids(ids);
    if (!list.length) return { items: {} };
    const canTasks = RequestCtx.can('task.task.read');
    const canSales = RequestCtx.can('sales.invoice.read');
    const canBuy = RequestCtx.can('purchase.invoice.read');
    const tw = this.taskWhere();
    const [tasks, done, hours, sales, buys] = await Promise.all([
      canTasks ? this.prisma.task.groupBy({ by: ['projectId'], where: { ...tw, projectId: { in: list } }, _count: { _all: true } }) : [],
      canTasks ? this.prisma.task.groupBy({ by: ['projectId'], where: { ...tw, projectId: { in: list }, completedAt: { not: null } }, _count: { _all: true } }) : [],
      canTasks
        ? this.prisma.$queryRaw<{ projectId: string; hours: Prisma.Decimal }[]>`
            SELECT t."projectId", COALESCE(SUM(l.hours), 0) AS hours FROM task_time_logs l JOIN tasks t ON t.id = l."taskId"
            WHERE t."companyId" = ${companyId}::uuid AND t."deletedAt" IS NULL AND t."projectId" IN (${Prisma.join(list.map((x) => Prisma.sql`${x}::uuid`))})
            GROUP BY t."projectId"`
        : [],
      canSales ? this.prisma.tradeDocument.findMany({ where: { ...this.docScope(), deletedAt: null, docType: 'SI', status: LIVE, projectId: { in: list } }, select: { projectId: true, grandTotal: true, exchangeRate: true } }) : [],
      canBuy ? this.prisma.tradeDocument.findMany({ where: { ...this.docScope(), deletedAt: null, docType: 'PI', status: LIVE, projectId: { in: list } }, select: { projectId: true, grandTotal: true, exchangeRate: true } }) : [],
    ]);
    const items: Record<string, { tasks: number | null; done: number | null; hours: number | null; invoiced: number | null; costs: number | null }> = {};
    for (const id of list) items[id] = { tasks: canTasks ? 0 : null, done: canTasks ? 0 : null, hours: canTasks ? 0 : null, invoiced: canSales ? 0 : null, costs: canBuy ? 0 : null };
    for (const t of tasks) if (t.projectId && items[t.projectId]) items[t.projectId].tasks = t._count._all;
    for (const t of done) if (t.projectId && items[t.projectId]) items[t.projectId].done = t._count._all;
    for (const h of hours) if (items[h.projectId]) items[h.projectId].hours = num(h.hours);
    for (const s of sales) if (s.projectId && items[s.projectId]) items[s.projectId].invoiced = round2(items[s.projectId].invoiced! + num(s.grandTotal) * (num(s.exchangeRate) || 1));
    for (const b of buys) if (b.projectId && items[b.projectId]) items[b.projectId].costs = round2(items[b.projectId].costs! + num(b.grandTotal) * (num(b.exchangeRate) || 1));
    return { items };
  }

  async project(id: string) {
    const companyId = RequestCtx.companyId();
    const p = await this.prisma.project.findFirst({ where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.ProjectWhereInput), id: uuid(id), deletedAt: null }, select: { id: true, hourlyRate: true } });
    if (!p) throw new NotFoundException('Project not found');
    const stats = (await this.projectStats(id)).items[id];
    // billable hours not yet on a (non cancelled) invoice
    const billing = RequestCtx.can('task.task.read')
      ? (
          await this.prisma.$queryRaw<{ hours: Prisma.Decimal | null }[]>`
            SELECT COALESCE(SUM(l.hours), 0) AS hours FROM task_time_logs l JOIN tasks t ON t.id = l."taskId"
            LEFT JOIN trade_documents d ON d.id = l."invoiceId" AND d."deletedAt" IS NULL AND d.status <> 'CANCELLED'
            WHERE t."companyId" = ${companyId}::uuid AND t."deletedAt" IS NULL AND t."projectId" = ${id}::uuid AND l.billable = true AND d.id IS NULL`
        )[0]
      : null;
    const unbilledHours = billing ? num(billing.hours) : null;
    const types = this.readableTypes();
    const [tasks, stages, documents, tickets, timeByUser] = await Promise.all([
      RequestCtx.can('task.task.read')
        ? this.prisma.task.findMany({
            where: { ...this.taskWhere(), projectId: id },
            orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { dueDate: { sort: 'asc', nulls: 'last' } }],
            take: 100,
            select: { id: true, code: true, title: true, stageId: true, priorityCode: true, assigneeId: true, dueDate: true, completedAt: true, spentHours: true },
          })
        : null,
      this.prisma.taskStage.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true, color: true, isDone: true } }),
      types.length
        ? this.prisma.tradeDocument.findMany({
            where: { ...this.docScope(), deletedAt: null, projectId: id, docType: { in: types } },
            orderBy: { date: 'desc' },
            take: 50,
            select: { id: true, docType: true, number: true, date: true, status: true, grandTotal: true, currencyCode: true },
          })
        : null,
      RequestCtx.can('support.ticket.read') ? this.prisma.ticket.findMany({ where: { ...this.ticketWhere(), projectId: id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, code: true, subject: true, statusCode: true, priorityCode: true, createdAt: true } }) : null,
      RequestCtx.can('task.task.read')
        ? this.prisma.$queryRaw<{ userId: string; hours: Prisma.Decimal }[]>`
            SELECT l."userId", COALESCE(SUM(l.hours), 0) AS hours FROM task_time_logs l JOIN tasks t ON t.id = l."taskId"
            WHERE t."companyId" = ${companyId}::uuid AND t."deletedAt" IS NULL AND t."projectId" = ${id}::uuid GROUP BY l."userId" ORDER BY 2 DESC`
        : null,
    ]);
    const userIds = [...new Set([...(tasks ?? []).map((t) => t.assigneeId), ...(timeByUser ?? []).map((t) => t.userId)].filter((x): x is string => !!x))];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const st = new Map(stages.map((s) => [s.id, s]));
    return {
      stats,
      tasks: tasks?.map((t) => ({ ...t, spentHours: num(t.spentHours), stage: st.get(t.stageId) ?? null, assignee: t.assigneeId ? users.get(t.assigneeId) ?? null : null })) ?? null,
      documents: documents?.map((d) => ({ ...d, grandTotal: num(d.grandTotal) })) ?? null,
      tickets,
      time: timeByUser?.map((t) => ({ user: users.get(t.userId) ?? '-', hours: num(t.hours) })) ?? null,
      billing: unbilledHours === null ? null : { hourlyRate: num(p.hourlyRate), unbilledHours, unbilledAmount: round2(unbilledHours * num(p.hourlyRate)) },
    };
  }
}
