import type { ReportCtx, ReportResult } from './report.registry';

const n = (v: unknown) => Number(v ?? 0);
const from = (p: ReportCtx['p']) => new Date(p.from ?? '1970-01-01');
const to = (p: ReportCtx['p']) => new Date(p.to ?? '2999-12-31');
const r2 = (v: number) => Math.round(v * 100) / 100;

/** documents counted for VAT: issued (not draft / cancelled), not go-live opening balances */
const vatWhere = (ctx: ReportCtx, docType: 'SI' | 'PI') => ({
  companyId: ctx.companyId,
  docType,
  deletedAt: null,
  isOpening: false,
  status: { notIn: ['DRAFT', 'CANCELLED'] as ('DRAFT' | 'CANCELLED')[] },
  date: { gte: from(ctx.p), lte: to(ctx.p) },
});

/**
 * PPN Keluaran (output, sales invoices) / PPN Masukan (input, purchase invoices).
 * DPP = net amount after discount, PPN = tax, both in the company currency (exchange rate applied).
 * NPWP is stored encrypted and is only shown to users allowed to read the customer / supplier.
 */
export async function vatRegister(ctx: ReportCtx, docType: 'SI' | 'PI'): Promise<ReportResult> {
  const { prisma } = ctx;
  const docs = await prisma.tradeDocument.findMany({ where: vatWhere(ctx, docType), orderBy: [{ date: 'asc' }, { number: 'asc' }] });
  const ids = [...new Set(docs.map((d) => (docType === 'SI' ? d.customerId : d.supplierId)).filter(Boolean) as string[])];
  const partners =
    docType === 'SI'
      ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, taxId: true } })
      : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, taxId: true } });
  const canSeeNpwp = ctx.can?.(docType === 'SI' ? 'master.customer.read' : 'master.supplier.read') ?? false;
  const pm = new Map(partners.map((x) => [x.id, { name: x.name, npwp: canSeeNpwp ? (ctx.decrypt?.(x.taxId) ?? '') : x.taxId ? '••••••' : '' }]));
  const rows = docs.map((d) => {
    const rate = n(d.exchangeRate) || 1;
    const p = pm.get((docType === 'SI' ? d.customerId : d.supplierId) ?? '');
    return {
      date: d.date,
      number: d.number,
      taxInvoiceNumber: d.taxInvoiceNumber ?? '',
      partner: p?.name ?? '',
      npwp: p?.npwp ?? '',
      dpp: r2((n(d.subtotal) - n(d.discountTotal)) * rate),
      ppn: r2(n(d.taxTotal) * rate),
      missing: d.taxTotal && n(d.taxTotal) > 0 && !d.taxInvoiceNumber ? 'No tax invoice no.' : '',
    };
  });
  const withTax = rows.filter((r) => r.ppn !== 0 || ctx.p.all === 'yes');
  return {
    subtitle: `${ctx.p.from ?? '...'} to ${ctx.p.to ?? '...'}`,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'number', label: docType === 'SI' ? 'Invoice' : 'Bill' },
      { key: 'taxInvoiceNumber', label: 'Tax invoice no.' },
      { key: 'partner', label: docType === 'SI' ? 'Customer' : 'Supplier' },
      { key: 'npwp', label: 'NPWP' },
      { key: 'dpp', label: 'DPP (tax base)', type: 'money' },
      { key: 'ppn', label: 'PPN', type: 'money' },
      { key: 'missing', label: 'Check' },
    ],
    rows: withTax,
    totals: { dpp: r2(withTax.reduce((a, r) => a + r.dpp, 0)), ppn: r2(withTax.reduce((a, r) => a + r.ppn, 0)) },
  };
}

/** Per month: output VAT, input VAT and the net amount to pay (positive) or carried forward (negative) */
export async function vatSummary(ctx: ReportCtx): Promise<ReportResult> {
  const { prisma } = ctx;
  const [sales, purchases] = await Promise.all([prisma.tradeDocument.findMany({ where: vatWhere(ctx, 'SI'), select: { date: true, taxTotal: true, exchangeRate: true } }), prisma.tradeDocument.findMany({ where: vatWhere(ctx, 'PI'), select: { date: true, taxTotal: true, exchangeRate: true } })]);
  const months = new Map<string, { output: number; input: number }>();
  const add = (date: Date, key: 'output' | 'input', v: number) => {
    const m = date.toISOString().slice(0, 7);
    const row = months.get(m) ?? { output: 0, input: 0 };
    row[key] += v;
    months.set(m, row);
  };
  for (const d of sales) add(d.date, 'output', n(d.taxTotal) * (n(d.exchangeRate) || 1));
  for (const d of purchases) add(d.date, 'input', n(d.taxTotal) * (n(d.exchangeRate) || 1));
  const rows = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => {
      const net = r2(v.output - v.input);
      return { month, output: r2(v.output), input: r2(v.input), net, position: net > 0 ? 'To pay' : net < 0 ? 'Overpaid (carry forward)' : 'Nil' };
    });
  const totalNet = r2(rows.reduce((a, r) => a + r.net, 0));
  return {
    subtitle: `${ctx.p.from ?? '...'} to ${ctx.p.to ?? '...'}`,
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'output', label: 'PPN Keluaran (output)', type: 'money' },
      { key: 'input', label: 'PPN Masukan (input)', type: 'money' },
      { key: 'net', label: 'Net', type: 'money' },
      { key: 'position', label: 'Position' },
    ],
    rows,
    totals: { output: r2(rows.reduce((a, r) => a + r.output, 0)), input: r2(rows.reduce((a, r) => a + r.input, 0)), net: totalNet },
    chart: { type: 'bar', label: 'month', value: 'net' },
  };
}
