import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MemoryCache } from '../../common/cache/memory-cache';
import { RequestCtx } from '../../common/context/request-context';
import { AccessService } from '../../common/access/access.service';
import { ApprovalService } from '../approvals/approval.service';
import { TicketService } from '../helpdesk/ticket.service';

const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Kpi = { key: string; label: string; value: number; type: 'money' | 'number'; hint?: string; prev?: number; spark?: number[]; link?: string; goodWhenUp?: boolean };
type Attention = { key: string; label: string; count: number; amount?: number; link: string; icon: string; tone: 'red' | 'amber' | 'blue' | 'violet' | 'gray' };
type Aging = { current: number; d30: number; d60: number; d90: number; over90: number; total: number; count: number };

/** audit entries that are not business activity (configuration, security, background jobs) */
const QUIET_ENTITIES = ['Setting', 'Company', 'User', 'Role', 'Menu', 'Session', 'Auth', 'Security', 'Integration', 'NumberSequence', 'FileFolder', 'File', 'Attendance', 'Announcement', 'WebContent'];

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
    private readonly access: AccessService,
    private readonly approvals: ApprovalService,
    private readonly tickets: TicketService,
  ) {}

  /**
   * Company overview. Each block is only included when the user may see that module; users limited to their
   * branch / own records see the same rows as in the lists. Shared figures are cached 30s; the personal
   * "needs attention" items (approvals waiting for you, your tickets) are computed per request.
   */
  @Get()
  async overview() {
    const u = RequestCtx.user();
    const can = (p: string) => RequestCtx.can(p);
    const shared = await this.shared();
    const attention: Attention[] = [];

    if (can('approval.request.read')) {
      const c = await this.approvals.counts();
      if (c.waiting) attention.push({ key: 'approvals', label: 'Approvals waiting for you', count: c.waiting, link: '/approvals', icon: 'stamp', tone: 'violet' });
    }
    if (can('support.ticket.read')) {
      const t = await this.tickets.summary();
      if (t.breached) attention.push({ key: 'ticketsLate', label: 'Tickets past their SLA', count: t.breached, link: '/helpdesk/tickets', icon: 'life-buoy', tone: 'red' });
      if (t.unassigned) attention.push({ key: 'ticketsNew', label: 'Tickets without an owner', count: t.unassigned, link: '/helpdesk/tickets', icon: 'inbox', tone: 'amber' });
    }
    attention.push(...shared.attention);
    const order = { red: 0, amber: 1, violet: 2, blue: 3, gray: 4 };
    attention.sort((a, b) => order[a.tone] - order[b.tone]);
    return { ...shared, attention };
  }

  private shared() {
    const u = RequestCtx.user();
    const companyId = u.companyId;
    const can = (p: string) => RequestCtx.can(p);
    const companyWide = u.isSuperAdmin || u.dataScope === 'ALL' || u.dataScope === 'COMPANY';
    const docScope = this.access.scopeWhere({ branchField: 'branchId', ownerField: 'createdById' }) as Prisma.TradeDocumentWhereInput;
    const leadScope = this.access.scopeWhere({ branchField: 'branchId', ownerField: 'ownerId' });
    const scopeKey = companyWide ? 'all' : `${u.dataScope}:${(u.branchIds ?? []).join(',')}:${u.dataScope === 'OWN' ? u.id : ''}`;
    const docSql = (alias = '') => {
      const c = (col: string) => Prisma.raw(alias ? `${alias}."${col}"` : `"${col}"`);
      return companyWide
        ? Prisma.empty
        : u.dataScope === 'OWN'
          ? Prisma.sql`AND ${c('createdById')} = ${u.id}::uuid`
          : u.branchIds
            ? Prisma.sql`AND (${c('branchId')} IS NULL OR ${c('branchId')} IN (${Prisma.join(u.branchIds.map((b) => Prisma.sql`${b}::uuid`))}))`
            : Prisma.empty;
    };
    const perms = ['sales.invoice.read', 'purchase.invoice.read', 'crm.lead.read', 'hris.employee.read', 'accounting.journal.read', 'inventory.stock.read', 'system.audit.read'];
    const key = `dash2:${companyId}:${scopeKey}:${perms.map((p) => (can(p) ? 1 : 0)).join('')}`;

    return this.cache.wrap(key, 30, async () => {
      const now = new Date();
      const today = iso(now);
      const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const prevStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
      // same number of days last month, so a half-finished month is compared fairly
      const prevSameDay = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0)).getUTCDate()) + 1));
      const yearAgo = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11, 1));
      const in7 = new Date(now.getTime() + 7 * 86_400_000);
      const out: Record<string, unknown> = { generatedAt: now };
      const kpi: Kpi[] = [];
      const attention: Attention[] = [];

      const sumDocs = (docType: string, where: Prisma.TradeDocumentWhereInput = {}) =>
        this.prisma.tradeDocument.aggregate({ where: { ...docScope, companyId, docType, deletedAt: null, status: { notIn: ['CANCELLED', 'DRAFT'] }, ...where }, _sum: { grandTotal: true, paidAmount: true }, _count: { _all: true } });
      const open: Prisma.TradeDocumentWhereInput = { status: { in: ['CONFIRMED', 'PARTIAL'] } };

      // ---- monthly sales / purchases (chart + sparklines)
      let monthly: { month: string; sales: number; purchases: number }[] | undefined;
      if (can('sales.invoice.read') || can('purchase.invoice.read')) {
        const rows = await this.prisma.$queryRaw<{ m: string; sales: Prisma.Decimal; purchases: Prisma.Decimal }[]>`
          SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS m,
            SUM(CASE WHEN "docType" = 'SI' THEN "grandTotal" ELSE 0 END) AS sales,
            SUM(CASE WHEN "docType" = 'PI' THEN "grandTotal" ELSE 0 END) AS purchases
          FROM trade_documents
          WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL AND status NOT IN ('DRAFT','CANCELLED')
            AND "docType" IN ('SI','PI') AND date >= ${yearAgo} ${docSql()}
          GROUP BY 1 ORDER BY 1`;
        const map = new Map(rows.map((r) => [r.m, r]));
        monthly = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(Date.UTC(yearAgo.getUTCFullYear(), yearAgo.getUTCMonth() + i, 1));
          const k = d.toISOString().slice(0, 7);
          return { month: k, sales: can('sales.invoice.read') ? n(map.get(k)?.sales) : 0, purchases: can('purchase.invoice.read') ? n(map.get(k)?.purchases) : 0 };
        });
        out.monthly = monthly;
      }
      const spark = (k: 'sales' | 'purchases') => monthly?.slice(-6).map((m) => m[k]);

      // ---- aging of what is still open (by due date, or document date when there is none)
      const aging = async (docType: 'SI' | 'PI'): Promise<Aging> => {
        const [r] = await this.prisma.$queryRaw<Record<string, Prisma.Decimal | bigint>[]>`
          SELECT
            COALESCE(SUM(CASE WHEN age <= 0 THEN bal END), 0) AS current,
            COALESCE(SUM(CASE WHEN age BETWEEN 1 AND 30 THEN bal END), 0) AS d30,
            COALESCE(SUM(CASE WHEN age BETWEEN 31 AND 60 THEN bal END), 0) AS d60,
            COALESCE(SUM(CASE WHEN age BETWEEN 61 AND 90 THEN bal END), 0) AS d90,
            COALESCE(SUM(CASE WHEN age > 90 THEN bal END), 0) AS over90,
            COALESCE(SUM(bal), 0) AS total, COUNT(*) AS count
          FROM (SELECT ("grandTotal" - "paidAmount") AS bal, (${today}::date - COALESCE("dueDate", date)::date) AS age
                FROM trade_documents
                WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL AND "docType" = ${docType}
                  AND status IN ('CONFIRMED','PARTIAL') AND "grandTotal" > "paidAmount" ${docSql()}) x`;
        return { current: n(r.current), d30: n(r.d30), d60: n(r.d60), d90: n(r.d90), over90: n(r.over90), total: n(r.total), count: n(r.count) };
      };

      if (can('sales.invoice.read')) {
        const [month, prev, openSi, overdue, drafts, ar] = await Promise.all([
          sumDocs('SI', { date: { gte: monthStart } }),
          sumDocs('SI', { date: { gte: prevStart, lt: prevSameDay } }),
          sumDocs('SI', open),
          sumDocs('SI', { ...open, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }),
          this.prisma.tradeDocument.count({ where: { ...docScope, companyId, docType: 'SI', deletedAt: null, status: 'DRAFT' } }),
          aging('SI'),
        ]);
        const overdueAmt = n(overdue._sum.grandTotal) - n(overdue._sum.paidAmount);
        kpi.push({ key: 'salesMonth', label: 'Sales this month', value: n(month._sum.grandTotal), prev: n(prev._sum.grandTotal), spark: spark('sales'), type: 'money', hint: `${month._count._all} ${month._count._all === 1 ? 'invoice' : 'invoices'}`, link: '/documents/SI', goodWhenUp: true });
        kpi.push({ key: 'receivable', label: 'Receivables', value: n(openSi._sum.grandTotal) - n(openSi._sum.paidAmount), type: 'money', hint: overdue._count._all ? `${overdue._count._all} overdue` : 'Nothing overdue', link: '/reports/ar-aging' });
        if (overdue._count._all) attention.push({ key: 'overdueAr', label: 'Customer invoices overdue', count: overdue._count._all, amount: overdueAmt, link: '/reports/ar-aging', icon: 'alarm-clock', tone: 'red' });
        if (drafts) attention.push({ key: 'draftSi', label: 'Draft invoices not yet confirmed', count: drafts, link: '/documents/SI?f.status=DRAFT', icon: 'file-pen', tone: 'blue' });
        out.arAging = ar;

        const topCustomers = await this.prisma.tradeDocument.groupBy({ by: ['customerId'], where: { ...docScope, companyId, docType: 'SI', deletedAt: null, status: { notIn: ['CANCELLED', 'DRAFT'] }, date: { gte: yearAgo } }, _sum: { grandTotal: true }, _count: { _all: true }, orderBy: { _sum: { grandTotal: 'desc' } }, take: 5 });
        const names = new Map((await this.prisma.customer.findMany({ where: { id: { in: topCustomers.map((t) => t.customerId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
        out.topCustomers = topCustomers.map((t) => ({ id: t.customerId, name: names.get(t.customerId ?? '') ?? '-', value: n(t._sum.grandTotal), count: t._count._all }));

        const products = await this.prisma.$queryRaw<{ id: string; code: string; name: string; qty: Prisma.Decimal; value: Prisma.Decimal }[]>`
          SELECT p.id, p.code, p.name, SUM(l.qty) AS qty, SUM(l."lineTotal" - l."lineTax") AS value
          FROM trade_document_lines l
          JOIN trade_documents d ON d.id = l."documentId"
          JOIN products p ON p.id = l."productId"
          WHERE d."companyId" = ${companyId}::uuid AND d."deletedAt" IS NULL AND d."docType" = 'SI'
            AND d.status NOT IN ('DRAFT','CANCELLED') AND d.date >= ${yearAgo} ${docSql('d')}
          GROUP BY p.id, p.code, p.name ORDER BY value DESC LIMIT 5`;
        out.topProducts = products.map((p) => ({ id: p.id, code: p.code, name: p.name, qty: n(p.qty), value: n(p.value) }));

        out.recentInvoices = (
          await this.prisma.tradeDocument.findMany({ where: { ...docScope, companyId, docType: 'SI', deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, number: true, date: true, dueDate: true, grandTotal: true, paidAmount: true, status: true, customerId: true } })
        ).map((d) => ({ ...d, customerName: null as string | null }));
        const invCustomers = new Map((await this.prisma.customer.findMany({ where: { id: { in: (out.recentInvoices as { customerId: string | null }[]).map((d) => d.customerId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
        for (const d of out.recentInvoices as { customerId: string | null; customerName: string | null }[]) d.customerName = invCustomers.get(d.customerId ?? '') ?? null;
      }

      if (can('purchase.invoice.read')) {
        const [month, prev, openPi, dueSoon, ap] = await Promise.all([
          sumDocs('PI', { date: { gte: monthStart } }),
          sumDocs('PI', { date: { gte: prevStart, lt: prevSameDay } }),
          sumDocs('PI', open),
          sumDocs('PI', { ...open, dueDate: { lte: in7 } }),
          aging('PI'),
        ]);
        kpi.push({ key: 'purchaseMonth', label: 'Purchases this month', value: n(month._sum.grandTotal), prev: n(prev._sum.grandTotal), spark: spark('purchases'), type: 'money', hint: `${month._count._all} ${month._count._all === 1 ? 'bill' : 'bills'}`, link: '/documents/PI', goodWhenUp: false });
        kpi.push({ key: 'payable', label: 'Payables', value: n(openPi._sum.grandTotal) - n(openPi._sum.paidAmount), type: 'money', hint: dueSoon._count._all ? `${dueSoon._count._all} due within 7 days` : 'Nothing due this week', link: '/reports/ap-aging' });
        if (dueSoon._count._all) attention.push({ key: 'billsDue', label: 'Supplier bills due within 7 days', count: dueSoon._count._all, amount: n(dueSoon._sum.grandTotal) - n(dueSoon._sum.paidAmount), link: '/reports/ap-aging', icon: 'file-minus', tone: 'amber' });
        out.apAging = ap;
      }

      if (can('accounting.journal.read') && companyWide) {
        const [cashRows, pl] = await Promise.all([
          this.prisma.$queryRaw<{ id: string; name: string; isCash: boolean; balance: Prisma.Decimal }[]>`
            SELECT b.id, b.name, b."isCash", COALESCE(SUM(l.debit - l.credit), 0) AS balance
            FROM bank_accounts b
            LEFT JOIN journal_lines l ON l."accountId" = b."accountId"
              AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id = l."entryId" AND e.status = 'POSTED')
            WHERE b."companyId" = ${companyId}::uuid AND b."deletedAt" IS NULL AND b."isActive" AND b."accountId" IS NOT NULL
            GROUP BY b.id, b.name, b."isCash" ORDER BY balance DESC`,
          this.prisma.$queryRaw<{ cur_in: Prisma.Decimal; cur_ex: Prisma.Decimal; prev_in: Prisma.Decimal; prev_ex: Prisma.Decimal }[]>`
            SELECT
              COALESCE(SUM(CASE WHEN a.type = 'INCOME' AND e.date >= ${monthStart} THEN l.credit - l.debit END), 0) AS cur_in,
              COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND e.date >= ${monthStart} THEN l.debit - l.credit END), 0) AS cur_ex,
              COALESCE(SUM(CASE WHEN a.type = 'INCOME' AND e.date >= ${prevStart} AND e.date < ${prevSameDay} THEN l.credit - l.debit END), 0) AS prev_in,
              COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' AND e.date >= ${prevStart} AND e.date < ${prevSameDay} THEN l.debit - l.credit END), 0) AS prev_ex
            FROM journal_lines l
            JOIN journal_entries e ON e.id = l."entryId" AND e.status = 'POSTED'
            JOIN accounts a ON a.id = l."accountId"
            WHERE e."companyId" = ${companyId}::uuid AND e.date >= ${prevStart} AND a.type IN ('INCOME','EXPENSE')`,
        ]);
        const cash = cashRows.reduce((a, r) => a + n(r.balance), 0);
        kpi.push({ key: 'cash', label: 'Cash & Bank', value: cash, type: 'money', hint: `${cashRows.length} ${cashRows.length === 1 ? 'account' : 'accounts'}`, link: '/accounting/cash' });
        const p = pl[0];
        const profit = n(p?.cur_in) - n(p?.cur_ex);
        kpi.push({ key: 'profit', label: 'Net profit this month', value: profit, prev: n(p?.prev_in) - n(p?.prev_ex), type: 'money', hint: `Income ${Math.round(n(p?.cur_in)).toLocaleString('id-ID')} · Expenses ${Math.round(n(p?.cur_ex)).toLocaleString('id-ID')}`, link: '/reports/profit-loss', goodWhenUp: true });
        out.cashAccounts = cashRows.map((r) => ({ id: r.id, name: r.name, isCash: r.isCash, balance: n(r.balance) }));
      }

      if (can('crm.lead.read')) {
        const stages = await this.prisma.pipelineStage.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, isWon: true, isLost: true, probability: true } });
        const openStageIds = stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id);
        const [leads, newLeads, byStage] = await Promise.all([
          this.prisma.lead.count({ where: { ...leadScope, companyId, deletedAt: null, customerId: null } }),
          this.prisma.lead.count({ where: { ...leadScope, companyId, deletedAt: null, createdAt: { gte: monthStart } } }),
          this.prisma.opportunity.groupBy({ by: ['stageId'], where: { ...leadScope, companyId, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
        ]);
        const sm = new Map(byStage.map((s) => [s.stageId, s]));
        const openOpp = byStage.filter((s) => s.stageId && openStageIds.includes(s.stageId));
        const pipeValue = openOpp.reduce((a, s) => a + n(s._sum.amount), 0);
        const pipeCount = openOpp.reduce((a, s) => a + s._count._all, 0);
        const weighted = openOpp.reduce((a, s) => a + n(s._sum.amount) * ((stages.find((x) => x.id === s.stageId)?.probability ?? 0) / 100), 0);
        kpi.push({ key: 'openLeads', label: 'Open leads', value: leads, type: 'number', hint: `${newLeads} new this month`, link: '/r/leads' });
        kpi.push({ key: 'pipeline', label: 'Open pipeline', value: pipeValue, type: 'money', hint: `${pipeCount} ${pipeCount === 1 ? 'deal' : 'deals'} · weighted ${Math.round(weighted).toLocaleString('id-ID')}`, link: '/crm/pipeline' });
        out.pipeline = stages.map((s) => ({ id: s.id, name: s.name, isWon: s.isWon, isLost: s.isLost, count: sm.get(s.id)?._count._all ?? 0, amount: n(sm.get(s.id)?._sum.amount) }));
      }

      if (can('hris.employee.read') && companyWide) {
        const todayD = new Date(`${today}T00:00:00Z`);
        const [emps, pending, att, onLeave] = await Promise.all([
          this.prisma.employee.count({ where: { companyId, deletedAt: null, isActive: true } }),
          this.prisma.leaveRequest.count({ where: { companyId, deletedAt: null, status: 'PENDING' } }),
          this.prisma.attendance.groupBy({ by: ['statusCode'], where: { companyId, deletedAt: null, date: todayD }, _count: { _all: true } }),
          this.prisma.leaveRequest.count({ where: { companyId, deletedAt: null, status: 'APPROVED', startDate: { lte: todayD }, endDate: { gte: todayD } } }),
        ]);
        kpi.push({ key: 'employees', label: 'Employees', value: emps, type: 'number', hint: pending ? `${pending} leave ${pending === 1 ? 'request' : 'requests'} pending` : 'No leave requests pending', link: '/r/employees' });
        if (pending) attention.push({ key: 'leave', label: 'Leave requests to review', count: pending, link: '/r/leave-requests?f.status=PENDING', icon: 'calendar-days', tone: 'violet' });
        const by = Object.fromEntries(att.map((a) => [a.statusCode ?? 'PRESENT', a._count._all]));
        const recorded = att.reduce((a, x) => a + x._count._all, 0);
        out.team = { total: emps, present: (by.PRESENT ?? 0) + (by.WFH ?? 0) + (by.LATE ?? 0), late: by.LATE ?? 0, wfh: by.WFH ?? 0, sick: by.SICK ?? 0, onLeave: Math.max(onLeave, by.LEAVE ?? 0), absent: by.ABSENT ?? 0, notIn: Math.max(0, emps - recorded - onLeave) };
      }

      if (can('inventory.stock.read') && companyWide) {
        const low = await this.prisma.$queryRaw<{ id: string; code: string; name: string; onhand: Prisma.Decimal; min: Prisma.Decimal }[]>`
          SELECT pr.id, pr.code, pr.name, COALESCE(SUM(b.qty), 0) AS onhand, pr."minStock" AS min
          FROM products pr LEFT JOIN stock_balances b ON b."productId" = pr.id
          WHERE pr."companyId" = ${companyId}::uuid AND pr.type = 'STOCK' AND pr."isActive" AND pr."deletedAt" IS NULL AND pr."minStock" > 0
          GROUP BY pr.id HAVING COALESCE(SUM(b.qty), 0) <= pr."minStock"
          ORDER BY COALESCE(SUM(b.qty), 0) / NULLIF(pr."minStock", 0) ASC, pr.name`;
        kpi.push({ key: 'lowStock', label: 'Low stock items', value: low.length, type: 'number', hint: low.length ? 'At or below minimum' : 'All above minimum', link: '/reports/low-stock' });
        if (low.length) attention.push({ key: 'lowStock', label: 'Products at or below minimum stock', count: low.length, link: '/reports/low-stock', icon: 'package-x', tone: 'amber' });
        out.lowStock = low.slice(0, 6).map((r) => ({ id: r.id, code: r.code, name: r.name, onHand: n(r.onhand), min: n(r.min) }));
      }

      if (can('system.audit.read')) {
        const rows = await this.prisma.auditLog.findMany({
          where: { companyId, entity: { notIn: QUIET_ENTITIES }, action: { notIn: ['LOGIN', 'LOGOUT', 'PRINT', 'VIEW', 'EXPORT'] } },
          orderBy: { id: 'desc' },
          take: 8,
          select: { id: true, username: true, entity: true, entityId: true, action: true, after: true, before: true, createdAt: true },
        });
        const pick = (j: unknown) => {
          const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
          const v = o.number ?? o.code ?? o.name ?? o.title ?? o.fullName ?? o.subject;
          return typeof v === 'string' ? v.slice(0, 80) : null;
        };
        out.activity = rows.map((r) => ({ id: String(r.id), user: r.username, entity: r.entity, action: r.action, label: pick(r.after) ?? pick(r.before), at: r.createdAt }));
      }

      out.kpi = kpi;
      out.attention = attention;
      return out as Record<string, unknown> & { attention: Attention[] };
    });
  }
}
