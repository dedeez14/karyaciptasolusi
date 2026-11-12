import type { ReportCtx, ReportResult } from './report.registry';

const n = (v: unknown) => Number(v ?? 0);
const from = (p: ReportCtx['p']) => new Date(p.from ?? '1970-01-01');
const to = (p: ReportCtx['p']) => new Date(p.to ?? '2999-12-31');
const r2 = (v: number) => Math.round(v * 100) / 100;

/** documents counted for VAT: issued (not draft / cancelled), not go-live opening balances */
const vatWhere = (ctx: ReportCtx, docType: 'SI' | 'PI') => ({
  companyId: ctx.companyId,
  // returns (nota retur) reduce the VAT of the month in which the goods came back (PMK 81/2024)
  docType: { in: docType === 'SI' ? ['SI', 'SR'] : ['PI', 'PRT'] },
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
    const ret = d.docType === 'SR' || d.docType === 'PRT';
    const sign = ret ? -1 : 1;
    return {
      date: d.date,
      number: ret ? `${d.number} (return)` : d.number,
      taxInvoiceNumber: d.taxInvoiceNumber ?? '',
      partner: p?.name ?? '',
      npwp: p?.npwp ?? '',
      dpp: r2(sign * (n(d.subtotal) - n(d.discountTotal)) * rate),
      ppn: r2(sign * n(d.taxTotal) * rate),
      missing: d.taxTotal && n(d.taxTotal) > 0 && !d.taxInvoiceNumber ? (ret ? 'No nota retur no.' : 'No tax invoice no.') : '',
    };
  });
  const withTax = rows.filter((r) => r.ppn !== 0 || ctx.p.all === 'yes');
  return {
    subtitle: `${ctx.p.from ?? '...'} to ${ctx.p.to ?? '...'}`,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'number', label: docType === 'SI' ? 'Invoice' : 'Bill' },
      { key: 'taxInvoiceNumber', label: 'Tax invoice / nota retur no.' },
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
  const [sales, purchases] = await Promise.all([prisma.tradeDocument.findMany({ where: vatWhere(ctx, 'SI'), select: { date: true, taxTotal: true, exchangeRate: true, docType: true } }), prisma.tradeDocument.findMany({ where: vatWhere(ctx, 'PI'), select: { date: true, taxTotal: true, exchangeRate: true, docType: true } })]);
  const months = new Map<string, { output: number; input: number }>();
  const add = (date: Date, key: 'output' | 'input', v: number) => {
    const m = date.toISOString().slice(0, 7);
    const row = months.get(m) ?? { output: 0, input: 0 };
    row[key] += v;
    months.set(m, row);
  };
  const signed = (d: { docType: string; taxTotal: unknown; exchangeRate: unknown }) => (d.docType === 'SR' || d.docType === 'PRT' ? -1 : 1) * n(d.taxTotal) * (n(d.exchangeRate) || 1);
  for (const d of sales) add(d.date, 'output', signed(d));
  // retail receipts (faktur pajak digunggung) count in the output VAT of their month
  const pos = await prisma.posSale.findMany({ where: { companyId: ctx.companyId, status: 'PAID', date: { gte: from(ctx.p), lte: to(ctx.p) }, taxTotal: { gt: 0 } }, select: { date: true, taxTotal: true } });
  for (const d of pos) add(d.date, 'output', n(d.taxTotal));
  for (const d of purchases) add(d.date, 'input', signed(d));
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
