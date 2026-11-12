import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { budgetVsActual } from './budget-report';
import { vatRegister, vatSummary } from './vat-report';
import { cashFlowStatement, comparisonRange, equityStatement } from './financial-statements';
import { withholdingRegister, fiscalDepreciation } from './tax-reports';

export interface ReportParam {
  name: string;
  label: string;
  type: 'date' | 'select' | 'relation';
  required?: boolean;
  /** monthStart | today | yearStart */
  default?: string;
  options?: { value: string; label: string }[];
  relation?: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'money' | 'qty' | 'number' | 'percent';
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  subtitle?: string;
  /** optional chart hint for the UI */
  chart?: { type: 'bar' | 'pie' | 'line'; label: string; value: string };
}

export interface ReportCtx {
  prisma: PrismaService;
  companyId: string;
  p: Record<string, string | undefined>;
  /** decrypts a field encrypted at rest (NPWP, ...) */
  decrypt?: (value: string | null | undefined) => string | null;
  /** permission check of the current user */
  can?: (code: string) => boolean;
  /** branches the user is limited to (null = all); only used by branch aware reports */
  branchIds?: string[] | null;
}

/** sales / purchase documents and payments of the branches the user may see (documents without a branch stay visible) */
const branchOf = (ctx: ReportCtx) => (ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {});
/** stock: warehouses of the user's branches (warehouses without a branch stay visible) */
const warehouseSql = (ctx: ReportCtx, column: string) =>
  ctx.branchIds ? Prisma.sql`AND ${Prisma.raw(column)} IN (SELECT id FROM warehouses WHERE "branchId" IS NULL OR "branchId" IN (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}))` : Prisma.empty;
const branchSql = (ctx: ReportCtx, alias: string) =>
  ctx.branchIds ? Prisma.sql`AND (${Prisma.raw(`${alias}."branchId"`)} IS NULL OR ${Prisma.raw(`${alias}."branchId"`)} IN (${Prisma.join(ctx.branchIds.map((b) => Prisma.sql`${b}::uuid`))}))` : Prisma.empty;

export interface ReportDef {
  key: string;
  label: string;
  module: 'sales' | 'purchase' | 'inventory' | 'accounting' | 'crm' | 'hris';
  description: string;
  params: ReportParam[];
  /** filters to the user's branches; other reports cover the whole company and need company-wide data access */
  branchAware?: boolean;
  run: (ctx: ReportCtx) => Promise<ReportResult>;
}

const n = (v: unknown) => Number(v ?? 0);
const from = (p: ReportCtx['p']) => new Date(p.from ?? '1970-01-01');
const to = (p: ReportCtx['p']) => new Date(p.to ?? '2999-12-31');
const asOf = (p: ReportCtx['p']) => new Date(p.asOf ?? new Date().toISOString().slice(0, 10));
const period = (p: ReportCtx['p']) => `${p.from ?? '...'} to ${p.to ?? '...'}`;
const range: ReportParam[] = [
  { name: 'from', label: 'From', type: 'date', required: true, default: 'monthStart' },
  { name: 'to', label: 'To', type: 'date', required: true, default: 'today' },
];
const asOfParam: ReportParam[] = [{ name: 'asOf', label: 'As of', type: 'date', required: true, default: 'today' }];
const compareParam: ReportParam = {
  name: 'compare',
  label: 'Compare with',
  type: 'select',
  default: 'none',
  options: [
    { value: 'none', label: 'No comparison' },
    { value: 'previous', label: 'Previous period' },
    { value: 'year', label: 'Same period last year' },
  ],
};
const totalsOf = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + n(r[k]), 0)]));

async function register(ctx: ReportCtx, docType: 'SI' | 'PI'): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const docs = await prisma.tradeDocument.findMany({
    where: { ...branchOf(ctx), companyId, docType, deletedAt: null, status: { not: 'CANCELLED' }, date: { gte: from(p), lte: to(p) }, ...(p.status ? { status: p.status as any } : {}) },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
  });
  const ids = docs.map((d) => (docType === 'SI' ? d.customerId : d.supplierId)).filter(Boolean) as string[];
  const partners = docType === 'SI' ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const pn = new Map(partners.map((x) => [x.id, x.name]));
  const rows = docs.map((d) => ({
    number: d.number,
    date: d.date,
    dueDate: d.dueDate,
    partner: pn.get((docType === 'SI' ? d.customerId : d.supplierId) ?? '') ?? '',
    status: d.status,
    subtotal: n(d.subtotal) - n(d.discountTotal),
    tax: n(d.taxTotal),
    total: n(d.grandTotal),
    paid: n(d.paidAmount),
    balance: n(d.grandTotal) - n(d.paidAmount),
  }));
  return {
    subtitle: period(p),
    columns: [
      { key: 'number', label: 'Number' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'partner', label: docType === 'SI' ? 'Customer' : 'Supplier' },
      { key: 'status', label: 'Status' },
      { key: 'subtotal', label: 'Net', type: 'money' },
      { key: 'tax', label: 'Tax', type: 'money' },
      { key: 'total', label: 'Total', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ],
    rows,
    totals: totalsOf(rows, ['subtotal', 'tax', 'total', 'paid', 'balance']),
  };
}

async function byPartner(ctx: ReportCtx, docType: 'SI' | 'PI'): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const field = docType === 'SI' ? 'customerId' : 'supplierId';
  const g = await prisma.tradeDocument.groupBy({
    by: [field],
    where: { ...branchOf(ctx), companyId, docType, deletedAt: null, status: { not: 'CANCELLED' }, date: { gte: from(p), lte: to(p) } },
    _sum: { grandTotal: true, paidAmount: true, taxTotal: true },
    _count: { _all: true },
  });
  const ids = g.map((x: any) => x[field]).filter(Boolean);
  const partners = docType === 'SI' ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }) : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  const pm = new Map(partners.map((x) => [x.id, x]));
  const rows = g
    .map((x: any) => ({ code: pm.get(x[field])?.code ?? '', name: pm.get(x[field])?.name ?? '-', count: x._count._all, total: n(x._sum.grandTotal), tax: n(x._sum.taxTotal), paid: n(x._sum.paidAmount), balance: n(x._sum.grandTotal) - n(x._sum.paidAmount) }))
    .sort((a, b) => b.total - a.total);
  return {
    subtitle: period(p),
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: docType === 'SI' ? 'Customer' : 'Supplier' },
      { key: 'count', label: 'Invoices', type: 'number' },
      { key: 'tax', label: 'Tax', type: 'money' },
      { key: 'total', label: 'Total', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'money' },
      { key: 'balance', label: 'Outstanding', type: 'money' },
    ],
    rows,
    totals: totalsOf(rows, ['count', 'tax', 'total', 'paid', 'balance']),
    chart: { type: 'bar', label: 'name', value: 'total' },
  };
}

async function byProduct(ctx: ReportCtx, docType: 'SI' | 'PI'): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const rows = await prisma.$queryRaw<{ code: string | null; name: string | null; qty: Prisma.Decimal; amount: Prisma.Decimal; docs: bigint }[]>`
    SELECT pr.code, COALESCE(pr.name, l.description) AS name, SUM(l.qty) AS qty,
           SUM(l."lineSubtotal" - l."lineDiscount") AS amount, COUNT(DISTINCT d.id) AS docs
    FROM trade_document_lines l
    JOIN trade_documents d ON d.id = l."documentId"
    LEFT JOIN products pr ON pr.id = l."productId"
    WHERE d."companyId" = ${companyId}::uuid AND d."docType" = ${docType} AND d."deletedAt" IS NULL
      AND d.status <> 'CANCELLED' AND d.date BETWEEN ${from(p)} AND ${to(p)} ${branchSql(ctx, 'd')}
    GROUP BY 1, 2 ORDER BY amount DESC`;
  const out = rows.map((r) => ({ code: r.code ?? '', name: r.name ?? '', qty: n(r.qty), docs: Number(r.docs), amount: n(r.amount) }));
  return {
    subtitle: period(p),
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Product / Service' },
      { key: 'docs', label: 'Invoices', type: 'number' },
      { key: 'qty', label: 'Quantity', type: 'qty' },
      { key: 'amount', label: 'Net Amount', type: 'money' },
    ],
    rows: out,
    totals: totalsOf(out, ['qty', 'amount']),
    chart: { type: 'bar', label: 'name', value: 'amount' },
  };
}

async function aging(ctx: ReportCtx, docType: 'SI' | 'PI'): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const date = asOf(p);
  // open invoices, and credit / debit notes not yet applied (they lower what the partner owes, shown as not due)
  const docs = await prisma.tradeDocument.findMany({ where: { ...branchOf(ctx), companyId, docType: { in: [docType, docType === 'SI' ? 'SR' : 'PRT'] }, deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL'] }, date: { lte: date } } });
  const field = docType === 'SI' ? 'customerId' : 'supplierId';
  const ids = docs.map((d) => d[field]).filter(Boolean) as string[];
  const partners = docType === 'SI' ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const pn = new Map(partners.map((x) => [x.id, x.name]));
  const agg = new Map<string, Record<string, number | string>>();
  for (const d of docs) {
    const credit = d.docType === 'SR' || d.docType === 'PRT';
    const bal = (credit ? -1 : 1) * (n(d.grandTotal) - n(d.paidAmount));
    if (bal === 0 || (!credit && bal < 0)) continue;
    const days = credit ? 0 : Math.floor((date.getTime() - (d.dueDate ?? d.date).getTime()) / 86_400_000);
    const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p';
    const k = d[field] ?? 'none';
    const row = agg.get(k) ?? { partner: pn.get(k) ?? '-', current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 };
    row[bucket] = n(row[bucket]) + bal;
    row.total = n(row.total) + bal;
    agg.set(k, row);
  }
  const rows = [...agg.values()].sort((a, b) => n(b.total) - n(a.total));
  return {
    subtitle: `As of ${p.asOf}`,
    columns: [
      { key: 'partner', label: docType === 'SI' ? 'Customer' : 'Supplier' },
      { key: 'current', label: 'Not Due', type: 'money' },
      { key: 'd30', label: '1-30 days', type: 'money' },
      { key: 'd60', label: '31-60 days', type: 'money' },
      { key: 'd90', label: '61-90 days', type: 'money' },
      { key: 'd90p', label: '> 90 days', type: 'money' },
      { key: 'total', label: 'Total', type: 'money' },
    ],
    rows,
    totals: totalsOf(rows, ['current', 'd30', 'd60', 'd90', 'd90p', 'total']),
  };
}

type Bal = { id: string; code: string; name: string; type: string; opening: Prisma.Decimal; debit: Prisma.Decimal; credit: Prisma.Decimal };
async function balances(ctx: ReportCtx, start: Date, end: Date, opts: { excludeClosing?: boolean } = {}) {
  return ctx.prisma.$queryRaw<Bal[]>`
    SELECT a.id, a.code, a.name, a.type::text AS type,
      COALESCE(SUM(CASE WHEN e.date < ${start} THEN l.debit - l.credit ELSE 0 END), 0) AS opening,
      COALESCE(SUM(CASE WHEN e.date >= ${start} THEN l.debit ELSE 0 END), 0) AS debit,
      COALESCE(SUM(CASE WHEN e.date >= ${start} THEN l.credit ELSE 0 END), 0) AS credit
    FROM accounts a
    JOIN journal_lines l ON l."accountId" = a.id
    JOIN journal_entries e ON e.id = l."entryId" AND e.status = 'POSTED' AND e.date <= ${end} AND e."deletedAt" IS NULL
      ${opts.excludeClosing ? Prisma.sql`AND COALESCE(e."sourceType", '') <> 'CLOSING'` : Prisma.empty}
    WHERE a."companyId" = ${ctx.companyId}::uuid
    GROUP BY a.id ORDER BY a.code`;
}

async function statement(ctx: ReportCtx, kind: 'customer' | 'supplier'): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const partnerId = kind === 'customer' ? p.customerId : p.supplierId;
  if (!partnerId) return { columns: [], rows: [] };
  const docType = kind === 'customer' ? 'SI' : 'PI';
  const dir = kind === 'customer' ? 'IN' : 'OUT';
  const field = kind === 'customer' ? 'customerId' : 'supplierId';
  const docWhere = { ...branchOf(ctx), companyId, docType, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] as any }, [field]: partnerId };
  const noteWhere = { ...docWhere, docType: kind === 'customer' ? 'SR' : 'PRT' };
  const payWhere = { ...branchOf(ctx), companyId, direction: dir as any, deletedAt: null, status: { not: 'CANCELLED' as any }, [field]: partnerId };
  const [notesBefore, notes] = await Promise.all([
    prisma.tradeDocument.aggregate({ where: { ...noteWhere, date: { lt: from(p) } }, _sum: { grandTotal: true } }),
    prisma.tradeDocument.findMany({ where: { ...noteWhere, date: { gte: from(p), lte: to(p) } }, select: { date: true, number: true, reference: true, grandTotal: true } }),
  ]);
  const [docsBefore, paysBefore, docs, pays] = await Promise.all([
    prisma.tradeDocument.aggregate({ where: { ...docWhere, date: { lt: from(p) } }, _sum: { grandTotal: true } }),
    prisma.payment.aggregate({ where: { ...payWhere, date: { lt: from(p) } }, _sum: { amount: true, whtAmount: true } }),
    prisma.tradeDocument.findMany({ where: { ...docWhere, date: { gte: from(p), lte: to(p) } }, select: { date: true, number: true, dueDate: true, grandTotal: true } }),
    prisma.payment.findMany({ where: { ...payWhere, date: { gte: from(p), lte: to(p) } }, select: { date: true, number: true, reference: true, amount: true, whtAmount: true } }),
  ]);
  let bal = n(docsBefore._sum.grandTotal) - n(notesBefore._sum.grandTotal) - n(paysBefore._sum.amount) - n(paysBefore._sum.whtAmount);
  const entries = [
    ...docs.map((d) => ({ date: d.date, doc: d.number, desc: `Invoice${d.dueDate ? ` (due ${d.dueDate.toISOString().slice(0, 10)})` : ''}`, charge: n(d.grandTotal), payment: 0 })),
    ...notes.map((x) => ({ date: x.date, doc: x.number, desc: `${kind === 'customer' ? 'Credit note' : 'Debit note'} (return)${x.reference ? ` - ${x.reference}` : ''}`, charge: 0, payment: n(x.grandTotal) })),
    ...pays.map((x) => ({ date: x.date, doc: x.number, desc: `Payment${x.reference ? ` - ${x.reference}` : ''}${n(x.whtAmount) ? ` (incl. ${n(x.whtAmount).toLocaleString('id-ID')} tax withheld)` : ''}`, charge: 0, payment: n(x.amount) + n(x.whtAmount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.doc.localeCompare(b.doc));
  const rows: Record<string, unknown>[] = [{ date: p.from, doc: '', desc: 'Opening balance', charge: 0, payment: 0, balance: bal }];
  for (const e of entries) {
    bal += e.charge - e.payment;
    rows.push({ ...e, balance: bal });
  }
  return {
    subtitle: period(p),
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'doc', label: 'Document' },
      { key: 'desc', label: 'Description' },
      { key: 'charge', label: kind === 'customer' ? 'Invoiced' : 'Billed', type: 'money' },
      { key: 'payment', label: kind === 'customer' ? 'Received' : 'Paid', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ],
    rows,
    totals: totalsOf(rows.slice(1), ['charge', 'payment']),
  };
}

export const REPORTS: ReportDef[] = [
  // ------------------------------------------------------------- Sales
  { key: 'sales-register', branchAware: true, label: 'Sales Invoice Register', module: 'sales', description: 'All sales invoices with payment status', params: range, run: (c) => register(c, 'SI') },
  { key: 'sales-by-customer', branchAware: true, label: 'Sales by Customer', module: 'sales', description: 'Invoiced revenue grouped per customer', params: range, run: (c) => byPartner(c, 'SI') },
  { key: 'sales-by-product', branchAware: true, label: 'Sales by Product', module: 'sales', description: 'Quantity and revenue per product / service', params: range, run: (c) => byProduct(c, 'SI') },
  {
    key: 'customer-statement',
    branchAware: true,
    label: 'Customer Statement',
    module: 'sales',
    description: 'Invoices, payments and running balance of one customer',
    params: [{ name: 'customerId', label: 'Customer', type: 'relation', relation: 'customers', required: true }, { name: 'from', label: 'From', type: 'date', required: true, default: 'yearStart' }, { name: 'to', label: 'To', type: 'date', required: true, default: 'today' }],
    run: (c) => statement(c, 'customer'),
  },
  { key: 'ar-aging', branchAware: true, label: 'Receivables Aging', module: 'sales', description: 'Outstanding customer invoices by age', params: asOfParam, run: (c) => aging(c, 'SI') },
  {
    key: 'quotation-pipeline',
    label: 'Quotation Status',
    module: 'sales',
    description: 'Quotations issued and their conversion status',
    params: range,
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId, p } = ctx;
      const g = await prisma.tradeDocument.groupBy({ by: ['status'], where: { ...branchOf(ctx), companyId, docType: 'SQ', deletedAt: null, date: { gte: from(p), lte: to(p) } }, _count: { _all: true }, _sum: { grandTotal: true } });
      const rows = g.map((x) => ({ status: x.status, count: x._count._all, total: n(x._sum.grandTotal) }));
      return { subtitle: period(p), columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Quotations', type: 'number' }, { key: 'total', label: 'Value', type: 'money' }], rows, totals: totalsOf(rows, ['count', 'total']), chart: { type: 'pie', label: 'status', value: 'total' } };
    },
  },
  // ------------------------------------------------------------- Purchase
  { key: 'purchase-register', branchAware: true, label: 'Purchase Invoice Register', module: 'purchase', description: 'All supplier invoices with payment status', params: range, run: (c) => register(c, 'PI') },
  { key: 'purchase-by-supplier', branchAware: true, label: 'Purchases by Supplier', module: 'purchase', description: 'Purchases grouped per supplier', params: range, run: (c) => byPartner(c, 'PI') },
  { key: 'purchase-by-product', branchAware: true, label: 'Purchases by Product', module: 'purchase', description: 'Quantity and cost per purchased item', params: range, run: (c) => byProduct(c, 'PI') },
  {
    key: 'supplier-statement',
    branchAware: true,
    label: 'Supplier Statement',
    module: 'purchase',
    description: 'Bills, payments and running balance of one supplier',
    params: [{ name: 'supplierId', label: 'Supplier', type: 'relation', relation: 'suppliers', required: true }, { name: 'from', label: 'From', type: 'date', required: true, default: 'yearStart' }, { name: 'to', label: 'To', type: 'date', required: true, default: 'today' }],
    run: (c) => statement(c, 'supplier'),
  },
  { key: 'ap-aging', branchAware: true, label: 'Payables Aging', module: 'purchase', description: 'Outstanding supplier invoices by age', params: asOfParam, run: (c) => aging(c, 'PI') },
  // ------------------------------------------------------------- Inventory
  {
    key: 'stock-balance',
    label: 'Stock Balance & Valuation',
    module: 'inventory',
    description: 'Quantity on hand and value per product and warehouse',
    params: [{ name: 'warehouseId', label: 'Warehouse', type: 'relation', relation: 'warehouses' }],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId, p } = ctx;
      const rows = await prisma.$queryRaw<any[]>`
        SELECT pr.code, pr.name, w.name AS warehouse, b.qty, b."avgCost" AS cost, (b.qty * b."avgCost") AS value, pr."minStock"
        FROM stock_balances b JOIN products pr ON pr.id = b."productId" JOIN warehouses w ON w.id = b."warehouseId"
        WHERE b."companyId" = ${companyId}::uuid ${p.warehouseId ? Prisma.sql`AND b."warehouseId" = ${p.warehouseId}::uuid` : Prisma.empty} ${warehouseSql(ctx, 'b."warehouseId"')}
        ORDER BY pr.name, w.name`;
      const out = rows.map((r) => ({ code: r.code, name: r.name, warehouse: r.warehouse, qty: n(r.qty), cost: n(r.cost), value: n(r.value), status: n(r.qty) <= n(r.minStock) ? 'LOW' : 'OK' }));
      return {
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Product' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'qty', label: 'On Hand', type: 'qty' },
          { key: 'cost', label: 'Avg Cost', type: 'money' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'status', label: 'Status' },
        ],
        rows: out,
        totals: totalsOf(out, ['qty', 'value']),
      };
    },
  },
  {
    key: 'stock-card',
    label: 'Stock Card',
    module: 'inventory',
    description: 'Movement history of a product',
    params: [{ name: 'productId', label: 'Product', type: 'relation', relation: 'products', required: true }, { name: 'warehouseId', label: 'Warehouse', type: 'relation', relation: 'warehouses' }, ...range],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId, p } = ctx;
      if (!p.productId) return { columns: [], rows: [] };
      // warehouses of the user's branches only
      const allowed = ctx.branchIds ? (await prisma.warehouse.findMany({ where: { companyId, OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] }, select: { id: true } })).map((w) => w.id) : null;
      const warehouseFilter = allowed ? { warehouseId: { in: p.warehouseId ? allowed.filter((w) => w === p.warehouseId) : allowed } } : p.warehouseId ? { warehouseId: p.warehouseId } : {};
      const where = { companyId, productId: p.productId, ...warehouseFilter };
      const [opening, moves, whs] = await Promise.all([
        prisma.stockMovement.aggregate({ where: { ...where, date: { lt: from(p) } }, _sum: { qty: true } }),
        prisma.stockMovement.findMany({ where: { ...where, date: { gte: from(p), lte: to(p) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
        prisma.warehouse.findMany({ where: { companyId, ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}) }, select: { id: true, name: true } }),
      ]);
      const wn = new Map(whs.map((w) => [w.id, w.name]));
      let bal = n(opening._sum.qty);
      const rows: Record<string, unknown>[] = [{ date: p.from, doc: 'Opening balance', warehouse: '', in: 0, out: 0, balance: bal, cost: 0 }];
      for (const m of moves) {
        bal += n(m.qty);
        rows.push({ date: m.date, doc: `${m.docType} ${m.documentNumber ?? ''}`, warehouse: wn.get(m.warehouseId), in: n(m.qty) > 0 ? n(m.qty) : 0, out: n(m.qty) < 0 ? -n(m.qty) : 0, balance: bal, cost: n(m.unitCost) });
      }
      return {
        subtitle: period(p),
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'doc', label: 'Document' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'in', label: 'In', type: 'qty' },
          { key: 'out', label: 'Out', type: 'qty' },
          { key: 'balance', label: 'Balance', type: 'qty' },
          { key: 'cost', label: 'Unit Cost', type: 'money' },
        ],
        rows,
      };
    },
  },
  {
    key: 'low-stock',
    label: 'Low Stock Alert',
    module: 'inventory',
    description: 'Stock products at or below their minimum level',
    params: [],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId } = ctx;
      const rows = await prisma.$queryRaw<any[]>`
        SELECT pr.code, pr.name, pr."minStock", COALESCE(SUM(b.qty), 0) AS qty
        FROM products pr LEFT JOIN stock_balances b ON b."productId" = pr.id ${warehouseSql(ctx, 'b."warehouseId"')}
        WHERE pr."companyId" = ${companyId}::uuid AND pr.type = 'STOCK' AND pr."isActive" AND pr."deletedAt" IS NULL
        GROUP BY pr.id HAVING COALESCE(SUM(b.qty), 0) <= pr."minStock" ORDER BY pr.name`;
      return {
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Product' },
          { key: 'qty', label: 'On Hand', type: 'qty' },
          { key: 'minStock', label: 'Minimum', type: 'qty' },
          { key: 'shortage', label: 'Shortage', type: 'qty' },
        ],
        rows: rows.map((r) => ({ code: r.code, name: r.name, qty: n(r.qty), minStock: n(r.minStock), shortage: n(r.minStock) - n(r.qty) })),
      };
    },
  },
  // ------------------------------------------------------------- Accounting
  {
    key: 'trial-balance',
    label: 'Trial Balance',
    module: 'accounting',
    description: 'Opening, movement and closing balance per account',
    params: range,
    run: async (c) => {
      const rows = (await balances(c, from(c.p), to(c.p))).map((r) => {
        const closing = n(r.opening) + n(r.debit) - n(r.credit);
        return { code: r.code, name: r.name, type: r.type, opening: n(r.opening), debit: n(r.debit), credit: n(r.credit), closingDebit: closing > 0 ? closing : 0, closingCredit: closing < 0 ? -closing : 0 };
      });
      return {
        subtitle: period(c.p),
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Account' },
          { key: 'type', label: 'Type' },
          { key: 'opening', label: 'Opening', type: 'money' },
          { key: 'debit', label: 'Debit', type: 'money' },
          { key: 'credit', label: 'Credit', type: 'money' },
          { key: 'closingDebit', label: 'Closing Dr', type: 'money' },
          { key: 'closingCredit', label: 'Closing Cr', type: 'money' },
        ],
        rows,
        totals: totalsOf(rows, ['debit', 'credit', 'closingDebit', 'closingCredit']),
      };
    },
  },
  {
    key: 'general-ledger',
    label: 'General Ledger',
    module: 'accounting',
    description: 'Detailed postings per account with running balance',
    params: [{ name: 'accountId', label: 'Account', type: 'relation', relation: 'accounts', required: true }, ...range],
    run: async ({ prisma, companyId, p }) => {
      if (!p.accountId) return { columns: [], rows: [] };
      const [opening, lines] = await Promise.all([
        prisma.journalLine.aggregate({ where: { accountId: p.accountId, entry: { companyId, status: 'POSTED', date: { lt: from(p) } } }, _sum: { debit: true, credit: true } }),
        prisma.journalLine.findMany({ where: { accountId: p.accountId, entry: { companyId, status: 'POSTED', date: { gte: from(p), lte: to(p) } } }, include: { entry: { select: { date: true, number: true, description: true } } }, orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }] }),
      ]);
      let bal = n(opening._sum.debit) - n(opening._sum.credit);
      const rows: Record<string, unknown>[] = [{ date: p.from, number: '', description: 'Opening balance', debit: 0, credit: 0, balance: bal }];
      for (const l of lines) {
        bal += n(l.debit) - n(l.credit);
        rows.push({ date: l.entry.date, number: l.entry.number, description: l.description ?? l.entry.description, debit: n(l.debit), credit: n(l.credit), balance: bal });
      }
      return {
        subtitle: period(p),
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'number', label: 'Journal' },
          { key: 'description', label: 'Description' },
          { key: 'debit', label: 'Debit', type: 'money' },
          { key: 'credit', label: 'Credit', type: 'money' },
          { key: 'balance', label: 'Balance', type: 'money' },
        ],
        rows,
        totals: totalsOf(rows, ['debit', 'credit']),
      };
    },
  },
  {
    key: 'profit-loss',
    label: 'Profit & Loss',
    module: 'accounting',
    description: 'Laporan Laba Rugi: income and expenses for the period, optionally next to a comparison period (SAK EP)',
    params: [...range, compareParam],
    run: async (c) => {
      const cur = (await balances(c, from(c.p), to(c.p), { excludeClosing: true })).filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE');
      const cmp = comparisonRange(c.p);
      const prev = cmp ? (await balances(c, cmp.from, cmp.to, { excludeClosing: true })).filter((r) => r.type === 'INCOME' || r.type === 'EXPENSE') : [];
      const val = (r: Bal) => (r.type === 'INCOME' ? n(r.credit) - n(r.debit) : n(r.debit) - n(r.credit));
      const pm = new Map(prev.map((r) => [r.code, val(r)]));
      const rows: Record<string, unknown>[] = [];
      const tot = { income: [0, 0], expense: [0, 0] };
      for (const [type, title, key] of [
        ['INCOME', 'INCOME', 'income'],
        ['EXPENSE', 'EXPENSES', 'expense'],
      ] as const) {
        rows.push({ section: title, code: '', name: '', amount: null, previous: null });
        const accounts = new Map<string, { name: string; a: number; b: number }>();
        for (const r of cur.filter((x) => x.type === type)) accounts.set(r.code, { name: r.name, a: val(r), b: pm.get(r.code) ?? 0 });
        for (const r of prev.filter((x) => x.type === type && !accounts.has(x.code))) accounts.set(r.code, { name: r.name, a: 0, b: val(r) });
        for (const [code, v] of [...accounts.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
          if (!v.a && !v.b) continue;
          tot[key][0] += v.a;
          tot[key][1] += v.b;
          rows.push({ section: '', code, name: v.name, amount: v.a, previous: cmp ? v.b : null });
        }
        rows.push({ section: `Total ${title.charAt(0) + title.slice(1).toLowerCase()}`, code: '', name: '', amount: tot[key][0], previous: cmp ? tot[key][1] : null });
      }
      rows.push({ section: 'NET PROFIT / (LOSS)', code: '', name: '', amount: tot.income[0] - tot.expense[0], previous: cmp ? tot.income[1] - tot.expense[1] : null });
      return {
        subtitle: `${period(c.p)}${cmp ? ` · compared with ${cmp.label}` : ''}`,
        columns: [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: 'This period', type: 'money' }, ...(cmp ? [{ key: 'previous', label: 'Comparison', type: 'money' as const }] : [])],
        rows,
      };
    },
  },
  {
    key: 'cash-flow',
    label: 'Statement of Cash Flows',
    module: 'accounting',
    description: 'Laporan Arus Kas (indirect method): operating, investing and financing cash flows for the period (SAK EP)',
    params: range,
    run: (c) => cashFlowStatement(c),
  },
  {
    key: 'equity-changes',
    label: 'Statement of Changes in Equity',
    module: 'accounting',
    description: 'Laporan Perubahan Ekuitas: capital, retained earnings and profit from the start to the end of the period (SAK EP)',
    params: [
      { name: 'from', label: 'From', type: 'date', required: true, default: 'yearStart' },
      { name: 'to', label: 'To', type: 'date', required: true, default: 'today' },
    ],
    run: (c) => equityStatement(c),
  },
  {
    key: 'withholding-tax',
    label: 'Withholding Tax Register (PPh 23 / 4(2))',
    module: 'accounting',
    description: 'Income tax withheld on payments: by customers (prepaid tax) and from suppliers (to pay by the 15th and file in the SPT Masa PPh Unifikasi)',
    params: [...range, { name: 'direction', label: 'Withheld', type: 'select', default: 'OUT', options: [{ value: 'OUT', label: 'By us (from suppliers)' }, { value: 'IN', label: 'By customers (from us)' }] }],
    run: (c) => withholdingRegister(c),
  },
  {
    key: 'fiscal-depreciation',
    label: 'Fiscal Depreciation (Tax)',
    module: 'accounting',
    description: 'Depreciation for tax by group (PMK 72/2023) next to the book depreciation, and the fiscal correction for the SPT Tahunan',
    params: [{ name: 'year', label: 'Year', type: 'select', default: String(new Date().getFullYear()), options: Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => ({ value: y, label: y })) }],
    run: (c) => fiscalDepreciation(c),
  },
  {
    key: 'budget-vs-actual',
    label: 'Budget vs Actual',
    module: 'accounting',
    description: 'Approved budget compared with posted figures per account',
    params: [...range, { name: 'costCenterId', label: 'Cost center', type: 'relation', relation: 'cost-centers' }, { name: 'projectId', label: 'Project', type: 'relation', relation: 'projects' }],
    run: (c) => budgetVsActual(c),
  },
  {
    key: 'vat-output',
    label: 'VAT Output (PPN Keluaran)',
    module: 'accounting',
    description: 'Sales invoices with tax invoice number, customer NPWP, tax base (DPP) and PPN',
    params: range,
    run: (c) => vatRegister(c, 'SI'),
  },
  {
    key: 'vat-input',
    label: 'VAT Input (PPN Masukan)',
    module: 'accounting',
    description: 'Purchase invoices with tax invoice number, supplier NPWP, tax base (DPP) and PPN',
    params: range,
    run: (c) => vatRegister(c, 'PI'),
  },
  {
    key: 'vat-summary',
    label: 'VAT Summary',
    module: 'accounting',
    description: 'Output and input VAT per month and the net amount to pay',
    params: [
      { name: 'from', label: 'From', type: 'date', required: true, default: 'yearStart' },
      { name: 'to', label: 'To', type: 'date', required: true, default: 'today' },
    ],
    run: (c) => vatSummary(c),
  },
  {
    key: 'balance-sheet',
    label: 'Balance Sheet',
    module: 'accounting',
    description: 'Laporan Posisi Keuangan: assets, liabilities and equity as of a date, optionally next to the end of the previous year (SAK EP)',
    params: [
      ...asOfParam,
      {
        name: 'compare',
        label: 'Compare with',
        type: 'select',
        default: 'none',
        options: [
          { value: 'none', label: 'No comparison' },
          { value: 'yearEnd', label: 'End of the previous year' },
          { value: 'year', label: 'Same date last year' },
        ],
      },
    ],
    run: async (c) => {
      const at = asOf(c.p);
      const cmpAt = c.p.compare === 'yearEnd' ? new Date(Date.UTC(at.getUTCFullYear() - 1, 11, 31)) : c.p.compare === 'year' ? new Date(Date.UTC(at.getUTCFullYear() - 1, at.getUTCMonth(), at.getUTCDate())) : null;
      const pos = async (d: Date) => {
        const b = await balances(c, new Date('1970-01-01'), d);
        const v = new Map<string, { name: string; type: string; v: number }>();
        for (const r of b) {
          const sign = r.type === 'ASSET' ? 1 : -1;
          v.set(r.code, { name: r.name, type: r.type, v: sign * (n(r.debit) - n(r.credit) + n(r.opening)) });
        }
        const pl = b.filter((x) => x.type === 'INCOME' || x.type === 'EXPENSE').reduce((a, r) => a + (n(r.credit) - n(r.debit) - n(r.opening)), 0);
        return { v, pl };
      };
      const cur = await pos(at);
      const prev = cmpAt ? await pos(cmpAt) : null;
      const rows: Record<string, unknown>[] = [];
      const block = (type: string, title: string) => {
        rows.push({ section: title, code: '', name: '', amount: null, previous: null });
        let t = 0;
        let tp = 0;
        const codes = new Set([...cur.v.keys(), ...(prev ? [...prev.v.keys()] : [])]);
        for (const code of [...codes].sort()) {
          const a = cur.v.get(code);
          const b = prev?.v.get(code);
          if ((a ?? b)!.type !== type) continue;
          const va = a?.v ?? 0;
          const vb = b?.v ?? 0;
          if (!va && !vb) continue;
          t += va;
          tp += vb;
          rows.push({ section: '', code, name: (a ?? b)!.name, amount: va, previous: prev ? vb : null });
        }
        return [t, tp];
      };
      const [assets, assetsP] = block('ASSET', 'ASSETS');
      rows.push({ section: 'Total Assets', code: '', name: '', amount: assets, previous: prev ? assetsP : null });
      const [liab, liabP] = block('LIABILITY', 'LIABILITIES');
      rows.push({ section: 'Total Liabilities', code: '', name: '', amount: liab, previous: prev ? liabP : null });
      const [eq, eqP] = block('EQUITY', 'EQUITY');
      rows.push({ section: '', code: '', name: 'Profit / (loss) not yet closed', amount: cur.pl, previous: prev ? prev.pl : null });
      rows.push({ section: 'Total Equity', code: '', name: '', amount: eq + cur.pl, previous: prev ? eqP + prev.pl : null });
      rows.push({ section: 'TOTAL LIABILITIES & EQUITY', code: '', name: '', amount: liab + eq + cur.pl, previous: prev ? liabP + eqP + prev.pl : null });
      return {
        subtitle: `As of ${c.p.asOf}${cmpAt ? ` · compared with ${cmpAt.toISOString().slice(0, 10)}` : ''}`,
        columns: [{ key: 'section', label: 'Section' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'amount', label: c.p.asOf ?? 'Amount', type: 'money' }, ...(cmpAt ? [{ key: 'previous', label: cmpAt.toISOString().slice(0, 10), type: 'money' as const }] : [])],
        rows,
      };
    },
  },
  // ------------------------------------------------------------- CRM
  {
    key: 'lead-analysis',
    label: 'Lead Analysis',
    module: 'crm',
    description: 'Leads by source and status',
    params: [...range, { name: 'groupBy', label: 'Group by', type: 'select', default: 'sourceCode', options: [{ value: 'sourceCode', label: 'Source' }, { value: 'statusCode', label: 'Status' }, { value: 'industryCode', label: 'Industry' }] }],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId, p } = ctx;
      const by = (['sourceCode', 'statusCode', 'industryCode'].includes(p.groupBy ?? '') ? p.groupBy : 'sourceCode') as 'sourceCode';
      const g = await prisma.lead.groupBy({ by: [by], where: { ...branchOf(ctx), companyId, deletedAt: null, createdAt: { gte: from(p), lte: new Date(to(p).getTime() + 86_399_999) } }, _count: { _all: true }, _sum: { estimatedValue: true } });
      const converted = await prisma.lead.groupBy({ by: [by], where: { ...branchOf(ctx), companyId, deletedAt: null, customerId: { not: null }, createdAt: { gte: from(p), lte: new Date(to(p).getTime() + 86_399_999) } }, _count: { _all: true } });
      const cm = new Map(converted.map((x: any) => [x[by], x._count._all]));
      const labels = new Map((await prisma.lookupValue.findMany({ where: { category: { in: ['LEAD_SOURCE', 'LEAD_STATUS', 'INDUSTRY'] } } })).map((l) => [l.code, l.name]));
      const rows = g.map((x: any) => ({ group: labels.get(x[by]) ?? x[by] ?? '(none)', leads: x._count._all, converted: cm.get(x[by]) ?? 0, rate: x._count._all ? Math.round(((cm.get(x[by]) ?? 0) / x._count._all) * 1000) / 10 : 0, value: n(x._sum.estimatedValue) }));
      return {
        subtitle: period(p),
        columns: [{ key: 'group', label: 'Group' }, { key: 'leads', label: 'Leads', type: 'number' }, { key: 'converted', label: 'Converted', type: 'number' }, { key: 'rate', label: 'Conversion %', type: 'percent' }, { key: 'value', label: 'Est. Value', type: 'money' }],
        rows,
        totals: totalsOf(rows, ['leads', 'converted', 'value']),
        chart: { type: 'pie', label: 'group', value: 'leads' },
      };
    },
  },
  {
    key: 'sales-pipeline',
    label: 'Sales Pipeline',
    module: 'crm',
    description: 'Open opportunities and weighted value by stage',
    params: [],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId } = ctx;
      const stages = await prisma.pipelineStage.findMany({ where: { companyId, deletedAt: null }, orderBy: { sortOrder: 'asc' } });
      const g = await prisma.opportunity.groupBy({ by: ['stageId'], where: { ...branchOf(ctx), companyId, deletedAt: null }, _count: { _all: true }, _sum: { amount: true } });
      const gm = new Map(g.map((x) => [x.stageId, x]));
      const rows = stages.map((s) => {
        const x = gm.get(s.id);
        const amount = n(x?._sum.amount);
        return { stage: s.name, count: x?._count._all ?? 0, amount, probability: s.probability, weighted: (amount * s.probability) / 100 };
      });
      return {
        columns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Opportunities', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'probability', label: 'Probability', type: 'percent' }, { key: 'weighted', label: 'Weighted', type: 'money' }],
        rows,
        totals: totalsOf(rows, ['count', 'amount', 'weighted']),
        chart: { type: 'bar', label: 'stage', value: 'amount' },
      };
    },
  },
  {
    key: 'campaign-performance',
    label: 'Campaign Performance',
    module: 'crm',
    description: 'Leads, conversion and cost per campaign',
    params: [],
    branchAware: true,
    run: async (ctx) => {
      const { prisma, companyId } = ctx;
      const camps = await prisma.campaign.findMany({ where: { companyId, deletedAt: null }, orderBy: { startDate: 'desc' } });
      const leads = await prisma.lead.groupBy({ by: ['campaignId'], where: { ...branchOf(ctx), companyId, deletedAt: null, campaignId: { not: null } }, _count: { _all: true } });
      const conv = await prisma.lead.groupBy({ by: ['campaignId'], where: { ...branchOf(ctx), companyId, deletedAt: null, campaignId: { not: null }, customerId: { not: null } }, _count: { _all: true } });
      const lm = new Map(leads.map((x) => [x.campaignId, x._count._all]));
      const cm = new Map(conv.map((x) => [x.campaignId, x._count._all]));
      const rows = camps.map((c) => {
        const l = lm.get(c.id) ?? 0;
        return { code: c.code, name: c.name, budget: n(c.budget), cost: n(c.actualCost), target: c.targetLeads, leads: l, converted: cm.get(c.id) ?? 0, cpl: l ? n(c.actualCost) / l : 0 };
      });
      return {
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Campaign' },
          { key: 'budget', label: 'Budget', type: 'money' },
          { key: 'cost', label: 'Actual Cost', type: 'money' },
          { key: 'target', label: 'Target Leads', type: 'number' },
          { key: 'leads', label: 'Leads', type: 'number' },
          { key: 'converted', label: 'Converted', type: 'number' },
          { key: 'cpl', label: 'Cost / Lead', type: 'money' },
        ],
        rows,
        totals: totalsOf(rows, ['budget', 'cost', 'leads', 'converted']),
      };
    },
  },
  // ------------------------------------------------------------- HRIS
  {
    key: 'employee-directory',
    label: 'Employee Directory',
    module: 'hris',
    description: 'Active employees with department and position',
    params: [{ name: 'departmentId', label: 'Department', type: 'relation', relation: 'departments' }],
    run: async ({ prisma, companyId, p }) => {
      const emps = await prisma.employee.findMany({ where: { companyId, deletedAt: null, isActive: true, ...(p.departmentId ? { departmentId: p.departmentId } : {}) }, orderBy: { fullName: 'asc' } });
      const [d, ps, b] = await Promise.all([prisma.department.findMany({ where: { companyId } }), prisma.position.findMany({ where: { companyId } }), prisma.branch.findMany({ where: { companyId } })]);
      const dn = new Map(d.map((x) => [x.id, x.name]));
      const pn = new Map(ps.map((x) => [x.id, x.name]));
      const bn = new Map(b.map((x) => [x.id, x.name]));
      return {
        columns: [{ key: 'code', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'position', label: 'Position' }, { key: 'branch', label: 'Branch' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'joinDate', label: 'Joined', type: 'date' }],
        rows: emps.map((e) => ({ code: e.code, name: e.fullName, department: dn.get(e.departmentId ?? ''), position: pn.get(e.positionId ?? ''), branch: bn.get(e.branchId ?? ''), email: e.email, phone: e.phone, joinDate: e.joinDate })),
      };
    },
  },
  {
    key: 'attendance-summary',
    label: 'Attendance Summary',
    module: 'hris',
    description: 'Attendance count per status per employee',
    params: range,
    run: async ({ prisma, companyId, p }) => {
      const g = await prisma.attendance.groupBy({ by: ['employeeId', 'statusCode'], where: { companyId, deletedAt: null, date: { gte: from(p), lte: to(p) } }, _count: { _all: true } });
      const statuses = await prisma.lookupValue.findMany({ where: { category: 'ATTENDANCE_STATUS', isActive: true }, orderBy: { sortOrder: 'asc' } });
      const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(g.map((x) => x.employeeId))] } }, select: { id: true, code: true, fullName: true } });
      const rows = emps.map((e) => {
        const r: Record<string, unknown> = { code: e.code, name: e.fullName, total: 0 };
        for (const s of statuses) {
          const c = g.find((x) => x.employeeId === e.id && x.statusCode === s.code)?._count._all ?? 0;
          r[s.code] = c;
          r.total = n(r.total) + c;
        }
        return r;
      });
      return {
        subtitle: period(p),
        columns: [{ key: 'code', label: 'ID' }, { key: 'name', label: 'Employee' }, ...statuses.map((s) => ({ key: s.code, label: s.name, type: 'number' as const })), { key: 'total', label: 'Total', type: 'number' }],
        rows,
      };
    },
  },
  {
    key: 'leave-report',
    label: 'Leave Report',
    module: 'hris',
    description: 'Leave requests in a period',
    params: range,
    run: async ({ prisma, companyId, p }) => {
      const rows = await prisma.leaveRequest.findMany({ where: { companyId, deletedAt: null, startDate: { lte: to(p) }, endDate: { gte: from(p) } }, orderBy: { startDate: 'asc' } });
      const [emps, types] = await Promise.all([prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, fullName: true } }), prisma.leaveType.findMany({ where: { companyId } })]);
      const en = new Map(emps.map((e) => [e.id, e.fullName]));
      const tn = new Map(types.map((t) => [t.id, t.name]));
      const out = rows.map((r) => ({ employee: en.get(r.employeeId), type: tn.get(r.leaveTypeId), start: r.startDate, end: r.endDate, days: n(r.days), status: r.status }));
      return {
        subtitle: period(p),
        columns: [{ key: 'employee', label: 'Employee' }, { key: 'type', label: 'Leave Type' }, { key: 'start', label: 'Start', type: 'date' }, { key: 'end', label: 'End', type: 'date' }, { key: 'days', label: 'Days', type: 'number' }, { key: 'status', label: 'Status' }],
        rows: out,
        totals: totalsOf(out, ['days']),
      };
    },
  },
  {
    key: 'payroll-summary',
    label: 'Payroll Summary',
    module: 'hris',
    description: 'Payroll totals per run',
    params: range,
    run: async ({ prisma, companyId, p }) => {
      const runs = await prisma.payrollRun.findMany({ where: { companyId, deletedAt: null, status: { not: 'CANCELLED' }, periodStart: { gte: from(p), lte: to(p) } }, include: { _count: { select: { payslips: true } } }, orderBy: { periodStart: 'asc' } });
      const rows = runs.map((r) => ({ number: r.number, period: `${r.periodStart.toISOString().slice(0, 10)} - ${r.periodEnd.toISOString().slice(0, 10)}`, employees: r._count.payslips, gross: n(r.totalGross), deduction: n(r.totalDeduction), net: n(r.totalNet), status: r.status }));
      return {
        subtitle: period(p),
        columns: [{ key: 'number', label: 'Run' }, { key: 'period', label: 'Period' }, { key: 'employees', label: 'Employees', type: 'number' }, { key: 'gross', label: 'Gross', type: 'money' }, { key: 'deduction', label: 'Deductions', type: 'money' }, { key: 'net', label: 'Net Pay', type: 'money' }, { key: 'status', label: 'Status' }],
        rows,
        totals: totalsOf(rows, ['gross', 'deduction', 'net']),
      };
    },
  },
];

export const REPORT_MAP = new Map(REPORTS.map((r) => [r.key, r]));
