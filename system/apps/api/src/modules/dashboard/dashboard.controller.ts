import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemoryCache } from '../../common/cache/memory-cache';
import { RequestCtx } from '../../common/context/request-context';

const n = (v: unknown) => Number(v ?? 0);

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly cache: MemoryCache) {}

  /** KPI overview. Each block is only included when the user may see that module. Cached 30s. */
  @Get()
  async overview() {
    const u = RequestCtx.user();
    const companyId = u.companyId;
    const can = (p: string) => RequestCtx.can(p);
    const key = `dash:${companyId}:${[can('sales.invoice.read'), can('purchase.invoice.read'), can('crm.lead.read'), can('hris.employee.read'), can('accounting.journal.read'), can('inventory.stock.read')].join('')}`;
    return this.cache.wrap(key, 30, async () => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const yearAgo = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11, 1));
      const out: Record<string, unknown> = { generatedAt: now };
      const kpi: { key: string; label: string; value: number; type: 'money' | 'number'; hint?: string }[] = [];

      const sumDocs = (docType: string, where: Prisma.TradeDocumentWhereInput = {}) =>
        this.prisma.tradeDocument.aggregate({ where: { companyId, docType, deletedAt: null, status: { not: 'CANCELLED' }, NOT: { status: 'DRAFT' }, ...where }, _sum: { grandTotal: true, paidAmount: true }, _count: { _all: true } });

      if (can('sales.invoice.read')) {
        const [month, open, overdue] = await Promise.all([
          sumDocs('SI', { date: { gte: monthStart } }),
          sumDocs('SI', { status: { in: ['CONFIRMED', 'PARTIAL'] } }),
          sumDocs('SI', { status: { in: ['CONFIRMED', 'PARTIAL'] }, dueDate: { lt: now } }),
        ]);
        kpi.push({ key: 'salesMonth', label: 'Sales this month', value: n(month._sum.grandTotal), type: 'money', hint: `${month._count._all} ${month._count._all === 1 ? 'invoice' : 'invoices'}` });
        kpi.push({ key: 'receivable', label: 'Receivables', value: n(open._sum.grandTotal) - n(open._sum.paidAmount), type: 'money', hint: `${overdue._count._all} overdue` });
        const topCustomers = await this.prisma.tradeDocument.groupBy({ by: ['customerId'], where: { companyId, docType: 'SI', deletedAt: null, status: { notIn: ['CANCELLED', 'DRAFT'] }, date: { gte: yearAgo } }, _sum: { grandTotal: true }, orderBy: { _sum: { grandTotal: 'desc' } }, take: 5 });
        const names = new Map((await this.prisma.customer.findMany({ where: { id: { in: topCustomers.map((t) => t.customerId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
        out.topCustomers = topCustomers.map((t) => ({ name: names.get(t.customerId ?? '') ?? '-', value: n(t._sum.grandTotal) }));
        out.recentInvoices = await this.prisma.tradeDocument.findMany({ where: { companyId, docType: 'SI', deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, number: true, date: true, grandTotal: true, paidAmount: true, status: true } });
      }
      if (can('purchase.invoice.read')) {
        const [month, open] = await Promise.all([sumDocs('PI', { date: { gte: monthStart } }), sumDocs('PI', { status: { in: ['CONFIRMED', 'PARTIAL'] } })]);
        kpi.push({ key: 'purchaseMonth', label: 'Purchases this month', value: n(month._sum.grandTotal), type: 'money', hint: `${month._count._all} ${month._count._all === 1 ? 'bill' : 'bills'}` });
        kpi.push({ key: 'payable', label: 'Payables', value: n(open._sum.grandTotal) - n(open._sum.paidAmount), type: 'money' });
      }
      if (can('sales.invoice.read') || can('purchase.invoice.read')) {
        const rows = await this.prisma.$queryRaw<{ m: string; sales: Prisma.Decimal; purchases: Prisma.Decimal }[]>`
          SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS m,
            SUM(CASE WHEN "docType" = 'SI' THEN "grandTotal" ELSE 0 END) AS sales,
            SUM(CASE WHEN "docType" = 'PI' THEN "grandTotal" ELSE 0 END) AS purchases
          FROM trade_documents
          WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL AND status NOT IN ('DRAFT','CANCELLED')
            AND "docType" IN ('SI','PI') AND date >= ${yearAgo}
          GROUP BY 1 ORDER BY 1`;
        const map = new Map(rows.map((r) => [r.m, r]));
        out.monthly = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(Date.UTC(yearAgo.getUTCFullYear(), yearAgo.getUTCMonth() + i, 1));
          const k = d.toISOString().slice(0, 7);
          return { month: k, sales: can('sales.invoice.read') ? n(map.get(k)?.sales) : 0, purchases: can('purchase.invoice.read') ? n(map.get(k)?.purchases) : 0 };
        });
      }
      if (can('accounting.journal.read')) {
        const [cash] = await this.prisma.$queryRaw<{ v: Prisma.Decimal }[]>`
          SELECT COALESCE(SUM(l.debit - l.credit), 0) AS v FROM journal_lines l
          JOIN journal_entries e ON e.id = l."entryId" AND e.status = 'POSTED'
          WHERE e."companyId" = ${companyId}::uuid AND l."accountId" IN (SELECT "accountId" FROM bank_accounts WHERE "companyId" = ${companyId}::uuid AND "accountId" IS NOT NULL)`;
        kpi.push({ key: 'cash', label: 'Cash & Bank', value: n(cash?.v), type: 'money' });
      }
      if (can('crm.lead.read')) {
        const [leads, opp] = await Promise.all([
          this.prisma.lead.count({ where: { companyId, deletedAt: null, customerId: null } }),
          this.prisma.opportunity.aggregate({ where: { companyId, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
        ]);
        kpi.push({ key: 'openLeads', label: 'Open leads', value: leads, type: 'number' });
        kpi.push({ key: 'pipeline', label: 'Pipeline value', value: n(opp._sum.amount), type: 'money', hint: `${opp._count._all} opportunities` });
      }
      if (can('hris.employee.read')) {
        const [emps, pending] = await Promise.all([
          this.prisma.employee.count({ where: { companyId, deletedAt: null, isActive: true } }),
          this.prisma.leaveRequest.count({ where: { companyId, deletedAt: null, status: 'PENDING' } }),
        ]);
        kpi.push({ key: 'employees', label: 'Employees', value: emps, type: 'number', hint: `${pending} leave requests pending` });
      }
      if (can('inventory.stock.read')) {
        const [low] = await this.prisma.$queryRaw<{ c: bigint }[]>`
          SELECT COUNT(*) AS c FROM (SELECT pr.id FROM products pr LEFT JOIN stock_balances b ON b."productId" = pr.id
          WHERE pr."companyId" = ${companyId}::uuid AND pr.type = 'STOCK' AND pr."isActive" AND pr."deletedAt" IS NULL
          GROUP BY pr.id HAVING COALESCE(SUM(b.qty),0) <= pr."minStock" AND pr."minStock" > 0) x`;
        kpi.push({ key: 'lowStock', label: 'Low stock items', value: Number(low?.c ?? 0), type: 'number' });
      }
      out.kpi = kpi;
      return out;
    });
  }
}
