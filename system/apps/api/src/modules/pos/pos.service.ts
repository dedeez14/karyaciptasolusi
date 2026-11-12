import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { LotService } from '../documents/lot.service';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const today = () => new Date(new Date().toISOString().slice(0, 10));

export const openSchema = z.object({ warehouseId: z.uuid(), cashAccountId: z.uuid(), openingCash: z.coerce.number().min(0).max(1e12).default(0) });
export const closeSchema = z.object({ countedCash: z.coerce.number().min(0).max(1e12), notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(1000).nullable().optional()) });
export const saleSchema = z.object({
  sessionId: z.uuid(),
  customerId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  lines: z.array(z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e6), discountPct: z.coerce.number().min(0).max(100).default(0) })).min(1).max(300),
  payments: z.array(z.object({ method: z.enum(['CASH', 'QRIS', 'CARD', 'TRANSFER']), amount: z.coerce.number().positive().max(1e12), reference: z.string().trim().max(60).optional() })).min(1).max(6),
});

/**
 * Point of sale. Each receipt is posted when it is paid: stock out (lots FEFO), Dr cash / bank per payment method,
 * Cr sales, Cr VAT Out (PPN; for a PKP retailer the receipt is the faktur pajak digunggung, PER-11/PJ/2025),
 * Cr PBJT payable (food & beverage regional tax, UU HKPD), Dr COGS / Cr inventory.
 * Shifts track the cash drawer; the counted difference at closing is posted as cash over / short.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly lots: LotService,
  ) {}

  /** settings the cashier screen needs */
  async config() {
    RequestCtx.assert('pos.sale.create');
    const companyId = RequestCtx.companyId();
    const s = (k: string, d: string) => this.settings.str(k, companyId, d);
    const methods: Record<string, string | null> = {};
    for (const m of ['QRIS', 'CARD', 'TRANSFER']) methods[m] = (await s(`pos.${m.toLowerCase()}AccountId`, '')) || null;
    return {
      mode: await s('pos.mode', 'RETAIL'),
      pricesIncludeTax: await this.settings.bool('pos.pricesIncludeTax', companyId, true),
      vatPayer: await this.settings.bool('sales.vatPayer', companyId, true),
      pbjtRate: await this.settings.num('pos.pbjtRate', companyId, 0),
      receiptFooter: await s('pos.receiptFooter', 'Terima kasih atas kunjungan Anda'),
      paymentAccounts: methods,
      session: await this.prisma.posSession.findFirst({ where: { companyId, status: 'OPEN', openedById: RequestCtx.user().id }, orderBy: { openedAt: 'desc' } }),
    };
  }

  /** products for the grid (sellable, active) with price and stock in the warehouse */
  async products(warehouseId: string, search?: string) {
    RequestCtx.assert('pos.sale.create');
    const companyId = RequestCtx.companyId();
    const s = (search ?? '').trim();
    const rows = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null, isActive: true, isSellable: true, ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { code: { contains: s, mode: 'insensitive' } }, { barcode: s }] } : {}) },
      select: { id: true, code: true, name: true, barcode: true, salePrice: true, type: true, saleTaxId: true, categoryId: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 300,
    });
    const bal = UUID.test(warehouseId) ? new Map((await this.prisma.stockBalance.findMany({ where: { warehouseId, productId: { in: rows.map((r) => r.id) } } })).map((b) => [b.productId, n(b.qty)])) : new Map<string, number>();
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, barcode: r.barcode, price: n(r.salePrice), type: r.type, taxId: r.saleTaxId, category: r.category?.name ?? null, stock: r.type === 'STOCK' ? bal.get(r.id) ?? 0 : null }));
  }

  // ------------------------------------------------------------------ shifts
  async open(input: z.infer<typeof openSchema>) {
    RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const existing = await this.prisma.posSession.findFirst({ where: { companyId: u.companyId, status: 'OPEN', openedById: u.id } });
    if (existing) return existing;
    const [wh, cash] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.bankAccount.findFirst({ where: { id: input.cashAccountId, companyId: u.companyId, deletedAt: null, isActive: true } }),
    ]);
    if (!wh) throw new BadRequestException({ message: 'Validation failed', errors: { warehouseId: 'Choose the warehouse the goods are sold from' } });
    if (!cash?.accountId) throw new BadRequestException({ message: 'Validation failed', errors: { cashAccountId: 'Choose the cash drawer (a cash account with a ledger account)' } });
    const s = await this.prisma.posSession.create({
      data: { companyId: u.companyId, branchId: wh.branchId ?? u.branchId, number: await this.sequence.next('POS_SESSION', u.companyId), warehouseId: wh.id, cashAccountId: cash.id, openingCash: D(input.openingCash), openedById: u.id },
    });
    await this.audit.record('POS Shift', s.id, 'OPEN', undefined, { number: s.number, openingCash: input.openingCash });
    return s;
  }

  private async ownSession(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Shift not found');
    const s = await this.prisma.posSession.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shift not found');
    return s;
  }

  /** expected cash = opening float + cash received - change given (paid sales only) */
  private async expectedCash(sessionId: string, opening: Prisma.Decimal) {
    const sales = await this.prisma.posSale.findMany({ where: { sessionId, status: 'PAID' }, select: { payments: true, change: true } });
    const cash = sales.reduce((a, s) => a + (s.payments as { method: string; amount: number }[]).filter((p) => p.method === 'CASH').reduce((x, p) => x + n(p.amount), 0) - n(s.change), 0);
    return round(D(opening).plus(cash));
  }

  async sessionSummary(id: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.ownSession(id);
    if (s.openedById !== RequestCtx.user().id) RequestCtx.assert('pos.session.manage');
    const sales = await this.prisma.posSale.findMany({ where: { sessionId: id }, orderBy: { soldAt: 'desc' }, select: { id: true, number: true, soldAt: true, total: true, status: true, payments: true, change: true } });
    const byMethod: Record<string, number> = {};
    for (const x of sales.filter((y) => y.status === 'PAID')) for (const p of x.payments as { method: string; amount: number }[]) byMethod[p.method] = (byMethod[p.method] ?? 0) + n(p.amount) - (p.method === 'CASH' ? 0 : 0);
    const change = sales.filter((y) => y.status === 'PAID').reduce((a, y) => a + n(y.change), 0);
    if (byMethod.CASH !== undefined) byMethod.CASH -= change;
    return {
      ...s,
      expectedCash: s.status === 'OPEN' ? await this.expectedCash(id, s.openingCash) : s.expectedCash,
      totals: { count: sales.filter((y) => y.status === 'PAID').length, voided: sales.filter((y) => y.status === 'VOID').length, sales: sales.filter((y) => y.status === 'PAID').reduce((a, y) => a + n(y.total), 0), byMethod },
      sales,
    };
  }

  async listSessions() {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSession.findMany({ where: { companyId }, orderBy: { openedAt: 'desc' }, take: 100 });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.openedById!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const totals = await this.prisma.posSale.groupBy({ by: ['sessionId'], where: { sessionId: { in: rows.map((r) => r.id) }, status: 'PAID' }, _sum: { total: true }, _count: { _all: true } });
    const tm = new Map(totals.map((t) => [t.sessionId, t]));
    return rows.map((r) => ({ ...r, cashier: users.get(r.openedById ?? '') ?? '-', sales: n(tm.get(r.id)?._sum.total), count: tm.get(r.id)?._count._all ?? 0 }));
  }

  /** closes the shift; counted vs expected cash difference: Dr / Cr cash, Cr / Dr Cash Over / Short */
  async close(id: string, input: z.infer<typeof closeSchema>) {
    RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const s = await this.ownSession(id);
    if (s.status !== 'OPEN') throw new ConflictException('This shift is already closed');
    if (s.openedById !== u.id) RequestCtx.assert('pos.session.manage');
    const expected = await this.expectedCash(id, s.openingCash);
    const counted = round(D(input.countedCash));
    const diff = counted.minus(expected);
    return this.prisma.$transaction(async (tx) => {
      if (!diff.isZero()) {
        const cash = await tx.bankAccount.findUniqueOrThrow({ where: { id: s.cashAccountId } });
        await this.journal.post(tx, {
          companyId: s.companyId,
          branchId: s.branchId,
          date: today(),
          description: `POS shift ${s.number}: cash ${diff.gt(0) ? 'over' : 'short'}`,
          reference: s.number,
          sourceType: 'POS_SHIFT',
          sourceId: s.id,
          lines: diff.gt(0)
            ? [
                { accountId: cash.accountId, debit: diff },
                { key: 'CASH_OVER_SHORT', credit: diff, description: 'Cash over' },
              ]
            : [
                { key: 'CASH_OVER_SHORT', debit: diff.abs(), description: 'Cash short' },
                { accountId: cash.accountId, credit: diff.abs() },
              ],
        });
      }
      const r = await tx.posSession.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: u.id, expectedCash: expected, countedCash: counted, notes: input.notes ?? null } });
      await this.audit.record('POS Shift', id, 'CLOSE', { status: 'OPEN' }, { expected: expected.toString(), counted: counted.toString(), difference: diff.toString() }, tx);
      return r;
    });
  }

  // ------------------------------------------------------------------ sales
  async sell(input: z.infer<typeof saleSchema>) {
    RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const s = await this.ownSession(input.sessionId);
    if (s.status !== 'OPEN') throw new ConflictException('The shift is closed. Open a new shift.');
    const companyId = u.companyId;
    const cfg = {
      mode: await this.settings.str('pos.mode', companyId, 'RETAIL'),
      inclusive: await this.settings.bool('pos.pricesIncludeTax', companyId, true),
      vatPayer: await this.settings.bool('sales.vatPayer', companyId, true),
      pbjtRate: await this.settings.num('pos.pbjtRate', companyId, 0),
    };
    const products = await this.prisma.product.findMany({ where: { companyId, id: { in: input.lines.map((l) => l.productId) }, deletedAt: null } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const taxes = new Map((await this.prisma.tax.findMany({ where: { companyId, kind: 'VAT', id: { in: products.map((p) => p.saleTaxId!).filter(Boolean) } } })).map((t) => [t.id, t]));
    // food & beverage sold in a restaurant is not subject to PPN but to PBJT (UU HKPD): no VAT in that mode
    const vatOn = cfg.vatPayer && cfg.mode !== 'FNB';
    const lines = input.lines.map((l, i) => {
      const p = pm.get(l.productId);
      if (!p) throw new BadRequestException(`Line ${i + 1}: product not found`);
      const price = D(p.salePrice);
      const gross = round(price.times(l.qty).times(D(100).minus(l.discountPct)).div(100));
      const t = vatOn && p.saleTaxId ? taxes.get(p.saleTaxId) : undefined;
      // effective VAT rate, e.g. PPN 12% x 11/12 = 11%
      const eff = t ? D(t.rate).times(t.baseNumerator).div(t.baseDenominator) : ZERO;
      const net = eff.gt(0) && cfg.inclusive ? round(gross.times(100).div(D(100).plus(eff))) : gross;
      const tax = eff.gt(0) ? (cfg.inclusive ? gross.minus(net) : round(net.times(eff).div(100))) : ZERO;
      return { lineNo: i + 1, p, qty: D(l.qty), unitPrice: price, discountPct: D(l.discountPct), taxId: t?.id ?? null, salesAccountId: t?.salesAccountId ?? null, net, tax, total: net.plus(tax) };
    });
    const subtotal = sum(lines.map((l) => l.net));
    const taxTotal = sum(lines.map((l) => l.tax));
    const localTax = cfg.mode === 'FNB' && cfg.pbjtRate > 0 ? round(subtotal.times(cfg.pbjtRate).div(100)) : ZERO;
    const total = subtotal.plus(taxTotal).plus(localTax);
    const paid = round(sum(input.payments.map((p) => D(p.amount))));
    if (paid.lt(total)) throw new BadRequestException(`Amount paid (${paid.toFixed(2)}) is less than the total (${total.toFixed(2)})`);
    const nonCash = sum(input.payments.filter((p) => p.method !== 'CASH').map((p) => D(p.amount)));
    if (nonCash.gt(total)) throw new BadRequestException('Card / QRIS / transfer cannot be more than the total; give change only from cash');
    const change = paid.minus(total);
    // ledger account of each payment method
    const accountOf = async (method: string) => {
      const id = method === 'CASH' ? s.cashAccountId : (await this.settings.str(`pos.${method.toLowerCase()}AccountId`, companyId, '')) || s.cashAccountId;
      const b = await this.prisma.bankAccount.findFirst({ where: { id, companyId } });
      if (!b?.accountId) throw new BadRequestException(`No ledger account for ${method} payments: set it in Settings > Point of Sale`);
      return b.accountId;
    };
    const payAccounts = new Map<string, string>();
    for (const p of input.payments) if (!payAccounts.has(p.method)) payAccounts.set(p.method, await accountOf(p.method));

    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', companyId, false);
    return this.prisma.$transaction(
      async (tx) => {
        const number = await this.sequence.next('POS', companyId, new Date(), tx);
        const sale = await tx.posSale.create({
          data: {
            companyId,
            branchId: s.branchId,
            sessionId: s.id,
            number,
            date: today(),
            customerId: input.customerId ?? null,
            subtotal,
            discount: ZERO,
            taxTotal,
            localTax,
            total,
            paid,
            change,
            payments: input.payments as unknown as Prisma.InputJsonValue,
            createdById: u.id,
            lines: { create: lines.map((l) => ({ lineNo: l.lineNo, productId: l.p.id, name: l.p.name, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId, lineNet: l.net, lineTax: l.tax, lineTotal: l.total })) },
          },
          include: { lines: true },
        });
        const j: PostingLine[] = [];
        // money in, per method; change is paid out of the cash drawer
        const byMethod = new Map<string, Prisma.Decimal>();
        for (const p of input.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).plus(D(p.amount)));
        if (change.gt(0)) byMethod.set('CASH', (byMethod.get('CASH') ?? ZERO).minus(change));
        for (const [m, amt] of byMethod) if (amt.gt(0)) j.push({ accountId: payAccounts.get(m)!, debit: amt, description: `${m} ${number}` });
        for (const l of lines) {
          j.push({ accountId: l.p.incomeAccountId, key: l.p.incomeAccountId ? undefined : l.p.type === 'STOCK' ? 'SALES' : 'SERVICE_REVENUE', credit: l.net, description: l.p.name });
          if (l.tax.gt(0)) j.push({ accountId: l.salesAccountId, key: l.salesAccountId ? undefined : 'TAX_OUT', credit: l.tax, description: 'PPN (faktur pajak digunggung)' });
          if (l.p.type === 'STOCK') {
            const line = sale.lines.find((x) => x.lineNo === l.lineNo)!;
            if (l.p.trackLots) {
              await this.lots.ensureOpening(tx, companyId, l.p.id, s.warehouseId);
              await this.lots.issue(tx, { companyId, documentId: sale.id, lineId: line.id, productId: l.p.id, warehouseId: s.warehouseId, qty: l.qty });
            }
            const r = await this.inventory.move(tx, { companyId, branchId: s.branchId, date: sale.date, docType: 'POS', documentId: sale.id, documentNumber: number, allowNegative, productId: l.p.id, productName: l.p.name, warehouseId: s.warehouseId, qty: l.qty.neg() });
            await tx.posSaleLine.update({ where: { id: line.id }, data: { unitCost: r.unitCost } });
            j.push({ key: 'COGS', debit: r.totalCost.abs(), description: l.p.name }, { key: 'INVENTORY', credit: r.totalCost.abs() });
          }
        }
        if (localTax.gt(0)) j.push({ key: 'PBJT_PAYABLE', credit: localTax, description: 'PBJT makanan & minuman' });
        await this.journal.post(tx, { companyId, branchId: s.branchId, date: sale.date, description: `POS ${number}`, reference: number, sourceType: 'POS', sourceId: sale.id, lines: j });
        return sale;
      },
      { timeout: 30_000 },
    );
  }

  /** a receipt with everything the struk prints (seller identity for the faktur pajak digunggung) */
  async receipt(id: string) {
    RequestCtx.assert('pos.sale.create');
    if (!UUID.test(id)) throw new NotFoundException('Receipt not found');
    const companyId = RequestCtx.companyId();
    const sale = await this.prisma.posSale.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!sale) throw new NotFoundException('Receipt not found');
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, legalName: true, address: true, city: true, phone: true, taxId: true } });
    const cashier = sale.createdById ? await this.prisma.user.findUnique({ where: { id: sale.createdById }, select: { fullName: true } }) : null;
    const vatPayer = await this.settings.bool('sales.vatPayer', companyId, true);
    return {
      ...sale,
      cashier: cashier?.fullName ?? '',
      seller: { name: c.legalName ?? c.name, address: [c.address, c.city].filter(Boolean).join(', '), phone: c.phone, npwp: this.crypto.decrypt(c.taxId), vatPayer },
      footer: await this.settings.str('pos.receiptFooter', companyId, 'Terima kasih atas kunjungan Anda'),
      pbjtRate: await this.settings.num('pos.pbjtRate', companyId, 0),
    };
  }

  /** voids a receipt of an open shift: stock back, journal voided */
  async void(id: string, reason: string) {
    RequestCtx.assert('pos.sale.void');
    const u = RequestCtx.user();
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', u.companyId, false);
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.posSale.findFirst({ where: { id, companyId: u.companyId }, include: { session: true } });
      if (!sale) throw new NotFoundException('Receipt not found');
      if (sale.status === 'VOID') throw new ConflictException('Already voided');
      if (sale.session.status !== 'OPEN') throw new ConflictException('The shift of this receipt is closed: make a sales return instead');
      await this.inventory.reverse(tx, sale.id, allowNegative);
      await this.lots.reverse(tx, sale.id);
      await this.journal.voidBySource(tx, 'POS', sale.id);
      const r = await tx.posSale.update({ where: { id }, data: { status: 'VOID', voidReason: reason.slice(0, 200) } });
      await this.audit.record('POS Sale', id, 'VOID', { status: 'PAID' }, { status: 'VOID', reason }, tx);
      return r;
    });
  }

  /** daily recap of retail sales: the basis for the faktur pajak digunggung lines of the SPT Masa PPN */
  async dailyRecap(from: Date, to: Date) {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSale.groupBy({ by: ['date'], where: { companyId, status: 'PAID', date: { gte: from, lte: to } }, _sum: { subtotal: true, taxTotal: true, localTax: true, total: true }, _count: { _all: true }, orderBy: { date: 'asc' } });
    return rows.map((r) => ({ date: r.date, receipts: r._count._all, dpp: n(r._sum.subtotal), ppn: n(r._sum.taxTotal), pbjt: n(r._sum.localTax), total: n(r._sum.total) }));
  }
}
