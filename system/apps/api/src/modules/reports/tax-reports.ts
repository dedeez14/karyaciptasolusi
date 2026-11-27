import type { ReportCtx, ReportResult } from './report.registry';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Income tax withheld on payments (PPh 23 / 4(2) / final): the basis for the SPT Masa PPh Unifikasi and the bukti potong */
export async function withholdingRegister(ctx: ReportCtx): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const direction = p.direction === 'IN' ? 'IN' : 'OUT';
  const pays = await prisma.payment.findMany({
    where: {
      companyId,
      direction,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      whtAmount: { gt: 0 },
      date: { gte: new Date(p.from ?? '1970-01-01'), lte: new Date(p.to ?? '2999-12-31') },
      ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}),
    },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
  });
  const taxes = new Map((await prisma.tax.findMany({ where: { id: { in: pays.map((x) => x.whtTaxId!).filter(Boolean) } } })).map((t) => [t.id, t]));
  const ids = pays.map((x) => (direction === 'IN' ? x.customerId : x.supplierId)).filter(Boolean) as string[];
  const partners = direction === 'IN' ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, taxId: true } }) : await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, taxId: true } });
  const pm = new Map(partners.map((x) => [x.id, x]));
  const mayRead = ctx.can?.(direction === 'IN' ? 'sales.customer.read' : 'purchase.supplier.read') ?? false;
  const rows = pays.map((x) => {
    const partner = pm.get((direction === 'IN' ? x.customerId : x.supplierId) ?? '');
    const npwp = partner?.taxId ? (mayRead && ctx.decrypt ? ctx.decrypt(partner.taxId) : '••••••') : '';
    const t = x.whtTaxId ? taxes.get(x.whtTaxId) : undefined;
    return {
      date: x.date,
      number: x.number,
      partner: partner?.name ?? '',
      npwp: npwp || (direction === 'OUT' ? 'No NPWP - rate doubled' : ''),
      tax: t?.name ?? '',
      objectCode: t?.objectCode ?? '',
      base: n(x.whtBase),
      rate: n(x.whtRate),
      amount: n(x.whtAmount),
      slip: x.whtSlipNo ?? (direction === 'IN' ? 'Ask the customer for the slip' : 'Not issued yet'),
      slipDate: x.whtSlipDate,
    };
  });
  return {
    subtitle: `${direction === 'OUT' ? 'Withheld by us - pay by the 15th, file by the 20th of the next month' : 'Withheld by customers - credit against the annual income tax with the slips'} · ${p.from ?? '...'} to ${p.to ?? '...'}`,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'number', label: 'Payment' },
      { key: 'partner', label: direction === 'IN' ? 'Customer' : 'Supplier' },
      { key: 'npwp', label: 'NPWP / NIK' },
      { key: 'tax', label: 'Tax' },
      { key: 'objectCode', label: 'Object code' },
      { key: 'base', label: 'Base', type: 'money' },
      { key: 'rate', label: 'Rate %', type: 'percent' },
      { key: 'amount', label: 'Withheld', type: 'money' },
      { key: 'slip', label: 'Slip no.' },
      { key: 'slipDate', label: 'Slip date', type: 'date' },
    ],
    rows,
    totals: { base: rows.reduce((a, x) => a + x.base, 0), amount: rows.reduce((a, x) => a + x.amount, 0) },
  };
}

/** useful life in years per fiscal group (UU PPh Pasal 11, PMK 72/2023) */
const GROUP_YEARS: Record<string, number> = { K1: 4, K2: 8, K3: 16, K4: 20, BP: 20, BNP: 10 };
const BUILDING = new Set(['BP', 'BNP']);

/** fiscal depreciation of one asset for each year up to `year` (straight line, or declining balance for non-buildings) */
function fiscalSchedule(cost: number, acquired: Date, group: string, declining: boolean, year: number, disposed: Date | null) {
  const life = GROUP_YEARS[group];
  const slRate = 1 / life;
  const dbRate = 2 / life;
  const useDb = declining && !BUILDING.has(group);
  let book = cost;
  let thisYear = 0;
  const startYear = acquired.getUTCFullYear();
  const endYear = startYear + life; // a part year at the start pushes the last bit into year start + life
  for (let y = startYear; y <= Math.min(year, endYear); y++) {
    if (disposed && y > disposed.getUTCFullYear()) break;
    // depreciation starts in the month the cost was incurred (Pasal 11 ayat 10)
    const firstMonth = y === startYear ? acquired.getUTCMonth() : 0;
    const lastMonth = disposed && y === disposed.getUTCFullYear() ? disposed.getUTCMonth() : 11;
    const months = Math.max(0, lastMonth - firstMonth + 1);
    let dep = useDb ? (book * dbRate * months) / 12 : (cost * slRate * months) / 12;
    // last year of the useful life: what is left is depreciated in full
    if (y === endYear || dep > book) dep = book;
    dep = r2(dep);
    book = r2(book - dep);
    if (y === year) thisYear = dep;
  }
  return { dep: thisYear, bookEnd: book };
}

export async function fiscalDepreciation(ctx: ReportCtx): Promise<ReportResult> {
  const { prisma, companyId, p } = ctx;
  const year = Number(p.year) || new Date().getFullYear();
  const assets = await prisma.fixedAsset.findMany({ where: { companyId, deletedAt: null, acquisitionDate: { lte: new Date(Date.UTC(year, 11, 31)) } }, orderBy: { code: 'asc' } });
  const book = await prisma.assetDepreciation.groupBy({ by: ['assetId'], where: { assetId: { in: assets.map((a) => a.id) }, period: { startsWith: `${year}-` } }, _sum: { amount: true } });
  const bm = new Map(book.map((b) => [b.assetId, n(b._sum.amount)]));
  const rows = assets.map((a) => {
    const group = a.taxGroupCode ?? '';
    const bookDep = bm.get(a.id) ?? 0;
    if (!GROUP_YEARS[group]) {
      return { code: a.code, name: a.name, group: group === 'NONE' ? 'Not depreciable' : 'Set the tax group', acquired: a.acquisitionDate, cost: n(a.cost), rate: null, book: bookDep, fiscal: 0, fiscalBook: group === 'NONE' ? n(a.cost) : null, correction: group === 'NONE' ? bookDep : null };
    }
    const declining = a.methodCode === 'DECLINING_BALANCE';
    const s = fiscalSchedule(n(a.cost), a.acquisitionDate, group, declining, year, a.disposalDate);
    const rate = (declining && !BUILDING.has(group) ? 200 : 100) / GROUP_YEARS[group];
    return { code: a.code, name: a.name, group, acquired: a.acquisitionDate, cost: n(a.cost), rate, book: bookDep, fiscal: s.dep, fiscalBook: s.bookEnd, correction: r2(bookDep - s.dep) };
  });
  return {
    subtitle: `Year ${year} · correction = book depreciation - fiscal depreciation (positive: add back to the commercial profit in the SPT Tahunan)`,
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Asset' },
      { key: 'group', label: 'Tax group' },
      { key: 'acquired', label: 'Acquired', type: 'date' },
      { key: 'cost', label: 'Cost', type: 'money' },
      { key: 'rate', label: 'Fiscal rate %', type: 'percent' },
      { key: 'book', label: 'Book depreciation', type: 'money' },
      { key: 'fiscal', label: 'Fiscal depreciation', type: 'money' },
      { key: 'fiscalBook', label: 'Fiscal book value', type: 'money' },
      { key: 'correction', label: 'Fiscal correction', type: 'money' },
    ],
    rows,
    totals: { cost: rows.reduce((a, r) => a + r.cost, 0), book: rows.reduce((a, r) => a + r.book, 0), fiscal: rows.reduce((a, r) => a + r.fiscal, 0), correction: rows.reduce((a, r) => a + (r.correction ?? 0), 0) },
  };
}
