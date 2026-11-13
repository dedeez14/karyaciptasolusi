import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { LotService } from '../documents/lot.service';
import { localClock, priceOrder, PriceLine, PriceResult, Promo, promoActive } from './pos-pricing';
import { PosBus } from './pos-bus';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());

const lineInput = z.object({
  productId: z.uuid(),
  qty: z.coerce.number().positive().max(1e6),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  modifiers: z.array(z.object({ optionId: z.uuid() })).max(30).default([]),
  note: opt(z.string().trim().max(200)),
  course: z.coerce.number().int().min(1).max(9).default(1),
});
const paymentInput = z.object({ method: z.enum(['CASH', 'QRIS', 'CARD', 'TRANSFER', 'POINTS']), amount: z.coerce.number().positive().max(1e12), reference: z.string().trim().max(60).optional() });
const orderType = z.enum(['RETAIL', 'DINE_IN', 'TAKEAWAY', 'DELIVERY']);

export const openSchema = z.object({ outletId: z.uuid(), cashAccountId: z.uuid(), openingCash: z.coerce.number().min(0).max(1e12).default(0) });
export const closeSchema = z.object({ countedCash: z.coerce.number().min(0).max(1e12), notes: opt(z.string().trim().max(1000)) });
export const quoteSchema = z.object({ outletId: z.uuid(), customerId: opt(z.uuid()), voucherCode: opt(z.string().trim().max(40)), lines: z.array(lineInput).max(300) });
export const orderSchema = z.object({
  outletId: z.uuid(),
  orderType: orderType.default('DINE_IN'),
  tableId: opt(z.uuid()),
  covers: z.coerce.number().int().min(0).max(500).default(0),
  label: opt(z.string().trim().max(60)),
  customerId: opt(z.uuid()),
  voucherCode: opt(z.string().trim().max(40)),
  lines: z.array(lineInput).max(300).default([]),
  send: z.boolean().default(false),
});
export const updateOrderSchema = z.object({ orderType: orderType.optional(), tableId: opt(z.uuid()), covers: z.coerce.number().int().min(0).max(500).optional(), label: opt(z.string().trim().max(60)), customerId: opt(z.uuid()), voucherCode: opt(z.string().trim().max(40)) });
export const addLinesSchema = z.object({ lines: z.array(lineInput).min(1).max(300), send: z.boolean().default(false) });
export const paySchema = z.object({ sessionId: z.uuid(), customerId: opt(z.uuid()), voucherCode: opt(z.string().trim().max(40)), payments: z.array(paymentInput).min(1).max(6) });
export const saleSchema = z.object({
  sessionId: z.uuid(),
  orderType: orderType.optional(),
  customerId: opt(z.uuid()),
  voucherCode: opt(z.string().trim().max(40)),
  label: opt(z.string().trim().max(60)),
  lines: z.array(lineInput).min(1).max(300),
  payments: z.array(paymentInput).min(1).max(6),
});
export const splitSchema = z.object({ lines: z.array(z.object({ lineId: z.uuid(), qty: z.coerce.number().positive().max(1e6) })).min(1).max(300) });
export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) });

type LineIn = z.infer<typeof lineInput>;
type Outlet = Prisma.PosOutletGetPayload<object>;
type SaleWithLines = Prisma.PosSaleGetPayload<{ include: { lines: true } }>;
interface ModifierPick {
  groupId: string;
  optionId: string;
  name: string;
  price: number;
  productId: string | null;
  qty: number;
}

/**
 * Point of sale for every kind of outlet: shops (scan & pay), counters (pay first, queue number, kitchen display),
 * restaurants (tables, open bills, courses, split / merge), with promotions, vouchers, members and points.
 *
 * Posting when a bill is paid: Dr cash / bank / loyalty liability per payment method, Cr revenue (net of discounts),
 * Cr VAT Out (RETAIL outlets of a PKP; the receipt is the faktur pajak digunggung, PER-11/PJ/2025 Art. 51-54),
 * Cr service charge (staff pool liability per Permenaker 7/2016, or income), Cr PBJT payable (FNB outlets, UU 1/2022),
 * Dr COGS / Cr inventory for the goods or the recipe ingredients (backflush). Points earned are deferred revenue.
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
    private readonly bus: PosBus,
  ) {}

  // ------------------------------------------------------------------ helpers
  private async tz(companyId: string) {
    return (await this.settings.str('general.timezone', companyId, 'Asia/Jakarta')) || 'Asia/Jakarta';
  }

  private async todayDate(companyId: string) {
    return new Date(localClock(new Date(), await this.tz(companyId)).date);
  }

  async outlet(id: string, db: PrismaService | Tx = this.prisma): Promise<Outlet> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Outlet not found');
    const o = await db.posOutlet.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!o) throw new NotFoundException('Outlet not found');
    return o;
  }

  private async ownSession(id: string) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Shift not found');
    const s = await this.prisma.posSession.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shift not found');
    return s;
  }

  /** the caller's open shift (paying needs one) */
  private async payingSession(id: string) {
    const s = await this.ownSession(id);
    if (s.status !== 'OPEN') throw new ConflictException('The shift is closed. Open a new shift.');
    if (s.openedById !== RequestCtx.user().id) RequestCtx.assert('pos.session.manage');
    return s;
  }

  private async order(id: string, db: PrismaService | Tx = this.prisma): Promise<SaleWithLines> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Order not found');
    const s = await db.posSale.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!s) throw new NotFoundException('Order not found');
    return s;
  }

  private openOnly(s: { status: string }) {
    if (s.status !== 'OPEN') throw new ConflictException(s.status === 'PAID' ? 'This bill is already paid' : 'This bill is closed');
  }

  /** price of a product at an outlet: its price list, else the product sale price */
  private async prices(outlet: Outlet, productIds: string[]) {
    const items = outlet.priceListId ? await this.prisma.priceListItem.findMany({ where: { priceListId: outlet.priceListId, productId: { in: productIds } } }) : [];
    return new Map(items.map((i) => [i.productId, D(i.price)]));
  }

  private async vatRates(companyId: string, taxIds: string[]) {
    const taxes = await this.prisma.tax.findMany({ where: { companyId, kind: 'VAT', id: { in: taxIds } } });
    return new Map(taxes.map((t) => [t.id, { t, eff: D(t.rate).times(t.baseNumerator).div(t.baseDenominator) }]));
  }

  /** validates the lines (products, modifiers) and works out the shelf price incl. modifiers */
  private async resolveLines(outlet: Outlet, input: LineIn[]) {
    const companyId = outlet.companyId;
    const products = await this.prisma.product.findMany({ where: { companyId, id: { in: input.map((l) => l.productId) }, deletedAt: null } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const priceMap = await this.prices(outlet, products.map((p) => p.id));
    const optionIds = input.flatMap((l) => l.modifiers.map((m) => m.optionId));
    const options = optionIds.length ? await this.prisma.posModifierOption.findMany({ where: { id: { in: optionIds }, isActive: true, group: { companyId } }, include: { group: true } }) : [];
    const om = new Map(options.map((o) => [o.id, o]));
    const links = await this.prisma.posProductModifier.findMany({ where: { productId: { in: products.map((p) => p.id) } }, include: { group: true } });
    return input.map((l, i) => {
      const p = pm.get(l.productId);
      if (!p || !p.isActive || !p.isSellable) throw new BadRequestException(`Line ${i + 1}: product not found or not for sale`);
      const allowed = links.filter((x) => x.productId === p.id && x.group.isActive);
      const picks: ModifierPick[] = l.modifiers.map((m) => {
        const o = om.get(m.optionId);
        if (!o || !allowed.some((a) => a.groupId === o.groupId)) throw new BadRequestException(`Line ${i + 1}: option not available for ${p.name}`);
        return { groupId: o.groupId, optionId: o.id, name: o.name, price: n(o.price), productId: o.productId, qty: n(o.qty) };
      });
      for (const a of allowed) {
        const c = picks.filter((x) => x.groupId === a.groupId).length;
        if (c < a.group.minSelect) throw new BadRequestException(`${p.name}: choose ${a.group.minSelect === 1 ? 'a' : `at least ${a.group.minSelect}`} ${a.group.name}`);
        if (a.group.maxSelect > 0 && c > a.group.maxSelect) throw new BadRequestException(`${p.name}: at most ${a.group.maxSelect} ${a.group.name}`);
      }
      const unitPrice = (priceMap.get(p.id) ?? D(p.salePrice)).plus(sum(picks.map((x) => D(x.price))));
      return { p, unitPrice, picks, input: l };
    });
  }

  /** promotions valid now for the outlet / customer / voucher */
  private async promotions(companyId: string, outletId: string, isMember: boolean, voucherCode: string | null | undefined, at: Date): Promise<Promo[]> {
    const rows = await this.prisma.posPromotion.findMany({ where: { companyId, isActive: true, deletedAt: null } });
    const clock = localClock(at, await this.tz(companyId));
    const active = rows.filter((p) => promoActive(p, { clock, outletId, isMember, voucherCode: voucherCode ?? null }));
    if (voucherCode && !active.some((p) => p.voucherCode)) throw new BadRequestException(`Voucher ${voucherCode} is not valid here / now${rows.some((p) => p.voucherCode?.toUpperCase() === voucherCode.toUpperCase() && p.membersOnly) ? ' (members only)' : ''}`);
    return active
      .map((p) => ({ id: p.id, code: p.code, name: p.name, type: p.type, value: D(p.value), buyQty: p.buyQty, getQty: p.getQty, minSpend: D(p.minSpend), maxDiscount: D(p.maxDiscount), productIds: p.productIds, categoryIds: p.categoryIds }));
  }

  /** refuses a voucher code that gives nothing here / now (before it is stored on a bill) */
  private async checkVoucher(outlet: Outlet, code: string | null | undefined, customerId: string | null | undefined, at: Date) {
    if (!code) return;
    const cust = await this.member(outlet.companyId, customerId);
    await this.promotions(outlet.companyId, outlet.id, !!cust?.memberNo, code, at);
  }

  private async member(companyId: string, customerId: string | null | undefined) {
    if (!customerId) return null;
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId, deletedAt: null } });
    if (!c) throw new BadRequestException('Customer not found');
    return c;
  }

  private async taxFlags(outlet: Outlet) {
    return { mode: outlet.mode, pricesIncludeTax: outlet.pricesIncludeTax, pbjtRate: D(outlet.pbjtRate), serviceChargePct: D(outlet.serviceChargePct), vatPayer: await this.settings.bool('sales.vatPayer', outlet.companyId, true) };
  }

  /** prices a list of lines (product, unit price, qty, discount) at an outlet */
  private async price(outlet: Outlet, lines: { key: string; productId: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal; discountPct: Prisma.Decimal; taxId?: string | null }[], customerId: string | null | undefined, voucherCode: string | null | undefined, at: Date) {
    const companyId = outlet.companyId;
    const products = await this.prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, categoryId: true, saleTaxId: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const rates = await this.vatRates(companyId, products.map((p) => p.saleTaxId!).filter(Boolean));
    const cust = await this.member(companyId, customerId);
    const promos = await this.promotions(companyId, outlet.id, !!cust?.memberNo, voucherCode, at);
    const flags = await this.taxFlags(outlet);
    const input: PriceLine[] = lines.map((l) => {
      const p = pm.get(l.productId);
      const taxId = l.taxId !== undefined ? l.taxId : p?.saleTaxId ?? null;
      return { key: l.key, productId: l.productId, categoryId: p?.categoryId ?? null, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, vatRate: taxId ? rates.get(taxId)?.eff ?? ZERO : ZERO };
    });
    const result = priceOrder(input, promos, flags);
    return { result, rates, customer: cust, flags };
  }

  // ------------------------------------------------------------------ config, products
  /** what the cashier screen needs: outlets, the caller's open shift, the outlet's tax / service settings */
  async config(outletId?: string) {
    RequestCtx.assert('pos.sale.create');
    const companyId = RequestCtx.companyId();
    const outlets = await this.prisma.posOutlet.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: { code: 'asc' } });
    const session = await this.prisma.posSession.findFirst({ where: { companyId, status: 'OPEN', openedById: RequestCtx.user().id }, orderBy: { openedAt: 'desc' } });
    const current = outlets.find((o) => o.id === (session?.outletId ?? outletId)) ?? null;
    return {
      outlets: outlets.map((o) => ({ id: o.id, code: o.code, name: o.name, mode: o.mode, serviceStyle: o.serviceStyle })),
      outlet: current,
      vatPayer: await this.settings.bool('sales.vatPayer', companyId, true),
      loyalty: { amountPerPoint: await this.settings.num('pos.loyaltyAmountPerPoint', companyId, 0), pointValue: await this.settings.num('pos.loyaltyPointValue', companyId, 0) },
      session,
      tables: current?.serviceStyle === 'TABLE' ? await this.prisma.posTable.findMany({ where: { companyId, outletId: current.id, isActive: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }) : [],
    };
  }

  /** menu / product grid of an outlet: outlet price, modifiers, station, stock in the outlet warehouse */
  async products(outletId: string, search?: string) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.outlet(outletId);
    const companyId = outlet.companyId;
    const s = (search ?? '').trim();
    const menu = outlet.menuFromPriceList && outlet.priceListId ? (await this.prisma.priceListItem.findMany({ where: { priceListId: outlet.priceListId }, select: { productId: true } })).map((i) => i.productId) : null;
    const rows = await this.prisma.product.findMany({
      where: { companyId, deletedAt: null, isActive: true, isSellable: true, ...(menu ? { id: { in: menu } } : {}), ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { code: { contains: s, mode: 'insensitive' } }, { barcode: s }] } : {}) },
      select: { id: true, code: true, name: true, barcode: true, salePrice: true, type: true, saleTaxId: true, categoryId: true, posStation: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const ids = rows.map((r) => r.id);
    const [bal, priceMap, links, recipes] = await Promise.all([
      this.prisma.stockBalance.findMany({ where: { warehouseId: outlet.warehouseId, productId: { in: ids } } }),
      this.prices(outlet, ids),
      this.prisma.posProductModifier.findMany({ where: { productId: { in: ids }, group: { isActive: true } }, include: { group: { include: { options: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } } } }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.bom.findMany({ where: { companyId, productId: { in: ids }, isActive: true, backflushOnSale: true, deletedAt: null }, select: { productId: true } }),
    ]);
    const bm = new Map(bal.map((b) => [b.productId, n(b.qty)]));
    const recipe = new Set(recipes.map((r) => r.productId));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      barcode: r.barcode,
      price: n(priceMap.get(r.id) ?? r.salePrice),
      type: r.type,
      taxId: r.saleTaxId,
      category: r.category?.name ?? null,
      categoryId: r.categoryId,
      station: r.posStation,
      recipe: recipe.has(r.id),
      stock: r.type === 'STOCK' && !recipe.has(r.id) ? bm.get(r.id) ?? 0 : null,
      modifiers: links
        .filter((l) => l.productId === r.id)
        .map((l) => ({ id: l.group.id, name: l.group.name, min: l.group.minSelect, max: l.group.maxSelect, options: l.group.options.map((o) => ({ id: o.id, name: o.name, price: n(o.price) })) })),
    }));
  }

  /** live totals for the cart / customer display, with promotions and vouchers */
  async quote(input: z.infer<typeof quoteSchema>) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.outlet(input.outletId);
    if (!input.lines.length) return { lines: [], subtotal: 0, discount: 0, serviceCharge: 0, taxTotal: 0, localTax: 0, total: 0, promotions: [] };
    const lines = await this.resolveLines(outlet, input.lines);
    const { result } = await this.price(
      outlet,
      lines.map((l, i) => ({ key: String(i), productId: l.p.id, qty: D(l.input.qty), unitPrice: l.unitPrice, discountPct: D(l.input.discountPct) })),
      input.customerId,
      input.voucherCode,
      new Date(),
    );
    return this.view(result, lines.map((l) => n(l.unitPrice)));
  }

  private view(r: PriceResult, unitPrices?: number[]) {
    return {
      lines: r.lines.map((l, i) => ({ key: l.key, unitPrice: unitPrices?.[i], gross: n(l.gross), promoDiscount: n(l.promoDiscount), net: n(l.net), tax: n(l.tax), total: n(l.total) })),
      gross: n(r.gross),
      discount: n(r.discount),
      subtotal: n(r.subtotal),
      serviceCharge: n(r.serviceCharge),
      taxTotal: n(r.taxTotal),
      localTax: n(r.localTax),
      total: n(r.total),
      promotions: r.promotions,
    };
  }

  // ------------------------------------------------------------------ shifts
  async open(input: z.infer<typeof openSchema>) {
    RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const outlet = await this.outlet(input.outletId);
    const existing = await this.prisma.posSession.findFirst({ where: { companyId: u.companyId, status: 'OPEN', openedById: u.id } });
    if (existing) {
      if (existing.outletId === outlet.id) return existing;
      const other = existing.outletId ? await this.prisma.posOutlet.findUnique({ where: { id: existing.outletId }, select: { name: true } }) : null;
      throw new ConflictException(`You still have shift ${existing.number} open${other ? ` at ${other.name}` : ''}: close it first`);
    }
    if (!outlet.isActive) throw new BadRequestException({ message: 'Validation failed', errors: { outletId: 'This outlet is not active' } });
    const cash = await this.prisma.bankAccount.findFirst({ where: { id: input.cashAccountId, companyId: u.companyId, deletedAt: null, isActive: true } });
    if (!cash?.accountId) throw new BadRequestException({ message: 'Validation failed', errors: { cashAccountId: 'Choose the cash drawer (a cash account with a ledger account)' } });
    const s = await this.prisma.posSession.create({
      data: { companyId: u.companyId, branchId: outlet.branchId ?? u.branchId, number: await this.sequence.next('POS_SESSION', u.companyId), outletId: outlet.id, warehouseId: outlet.warehouseId, cashAccountId: cash.id, openingCash: D(input.openingCash), openedById: u.id },
    });
    await this.audit.record('POS Shift', s.id, 'OPEN', undefined, { number: s.number, outlet: outlet.code, openingCash: input.openingCash });
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
    const sales = await this.prisma.posSale.findMany({ where: { sessionId: id, status: { in: ['PAID', 'VOID'] } }, orderBy: { soldAt: 'desc' }, select: { id: true, number: true, soldAt: true, total: true, status: true, payments: true, change: true, serviceCharge: true } });
    const paid = sales.filter((y) => y.status === 'PAID');
    const byMethod: Record<string, number> = {};
    for (const x of paid) for (const p of x.payments as { method: string; amount: number }[]) byMethod[p.method] = (byMethod[p.method] ?? 0) + n(p.amount);
    if (byMethod.CASH !== undefined) byMethod.CASH -= paid.reduce((a, y) => a + n(y.change), 0);
    const openBills = s.outletId ? await this.prisma.posSale.count({ where: { outletId: s.outletId, status: 'OPEN' } }) : 0;
    return {
      ...s,
      expectedCash: s.status === 'OPEN' ? await this.expectedCash(id, s.openingCash) : s.expectedCash,
      totals: { count: paid.length, voided: sales.length - paid.length, sales: paid.reduce((a, y) => a + n(y.total), 0), serviceCharge: paid.reduce((a, y) => a + n(y.serviceCharge), 0), byMethod },
      openBills,
      sales,
    };
  }

  async listSessions() {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSession.findMany({ where: { companyId }, orderBy: { openedAt: 'desc' }, take: 100 });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.openedById!).filter(Boolean) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const outlets = new Map((await this.prisma.posOutlet.findMany({ where: { companyId }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    const totals = await this.prisma.posSale.groupBy({ by: ['sessionId'], where: { sessionId: { in: rows.map((r) => r.id) }, status: 'PAID' }, _sum: { total: true }, _count: { _all: true } });
    const tm = new Map(totals.map((t) => [t.sessionId, t]));
    return rows.map((r) => ({ ...r, outlet: outlets.get(r.outletId ?? '') ?? '-', cashier: users.get(r.openedById ?? '') ?? '-', sales: n(tm.get(r.id)?._sum.total), count: tm.get(r.id)?._count._all ?? 0 }));
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
    const date = await this.todayDate(s.companyId);
    const r = await this.prisma.$transaction(async (tx) => {
      // open bills started in this shift move to another open shift of the outlet (or stay, to be paid later)
      if (!diff.isZero()) {
        const cash = await tx.bankAccount.findUniqueOrThrow({ where: { id: s.cashAccountId } });
        await this.journal.post(tx, {
          companyId: s.companyId,
          branchId: s.branchId,
          date,
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
      const x = await tx.posSession.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedById: u.id, expectedCash: expected, countedCash: counted, notes: input.notes ?? null } });
      await this.audit.record('POS Shift', id, 'CLOSE', { status: 'OPEN' }, { expected: expected.toString(), counted: counted.toString(), difference: diff.toString() }, tx);
      return x;
    });
    return r;
  }

  // ------------------------------------------------------------------ orders (open bills)
  /** open bills of an outlet (tables view) */
  async openOrders(outletId: string) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.outlet(outletId);
    const rows = await this.prisma.posSale.findMany({
      where: { outletId: outlet.id, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderType: true, tableId: true, covers: true, label: true, queueNo: true, total: true, kitchenStatus: true, billPrintedAt: true, createdAt: true, customerId: true, lines: { where: { status: 'ACTIVE' }, select: { source: true, sentAt: true } } },
    });
    return rows.map(({ lines, ...r }) => ({ ...r, total: n(r.total), items: lines.length, qrPending: lines.filter((l) => l.source === 'QR' && !l.sentAt).length }));
  }

  /** tables whose guests called a waiter or asked for the bill from the QR page */
  async calls(outletId: string) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.outlet(outletId);
    return this.prisma.posTable.findMany({ where: { outletId: outlet.id, callType: { not: null }, deletedAt: null }, select: { id: true, name: true, callType: true, calledAt: true }, orderBy: { calledAt: 'asc' } });
  }

  async clearCall(tableId: string) {
    RequestCtx.assert('pos.sale.create');
    const t = await this.prisma.posTable.findFirst({ where: { id: tableId, companyId: RequestCtx.companyId() } });
    if (!t) throw new NotFoundException('Table not found');
    await this.prisma.posTable.update({ where: { id: t.id }, data: { callType: null, calledAt: null } });
    this.bus.changed(t.companyId, t.outletId, ['orders']);
    return { ok: true };
  }

  async getOrder(id: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.prisma.posSale.findFirst({
      where: { id, companyId: RequestCtx.companyId() },
      include: { lines: { orderBy: { lineNo: 'asc' } }, tickets: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw new NotFoundException('Order not found');
    const customer = s.customerId ? await this.prisma.customer.findUnique({ where: { id: s.customerId }, select: { id: true, name: true, memberNo: true, points: true } }) : null;
    const table = s.tableId ? await this.prisma.posTable.findUnique({ where: { id: s.tableId }, select: { id: true, code: true, name: true } }) : null;
    return { ...s, customer, table };
  }

  /** an open shift of the outlet to attach a new bill to (the caller's own, else the latest one) */
  private async outletSession(outlet: Outlet) {
    const u = RequestCtx.user();
    const own = await this.prisma.posSession.findFirst({ where: { companyId: u.companyId, outletId: outlet.id, status: 'OPEN', openedById: u.id } });
    const any = own ?? (await this.prisma.posSession.findFirst({ where: { companyId: u.companyId, outletId: outlet.id, status: 'OPEN' }, orderBy: { openedAt: 'desc' } }));
    if (!any) throw new ConflictException('No cashier shift is open at this outlet');
    return any;
  }

  private async checkTable(outlet: Outlet, tableId: string | null | undefined) {
    if (!tableId) return null;
    const t = await this.prisma.posTable.findFirst({ where: { id: tableId, outletId: outlet.id, deletedAt: null, isActive: true } });
    if (!t) throw new BadRequestException('Table not found at this outlet');
    return t;
  }

  async createOrder(input: z.infer<typeof orderSchema>, opts: { source?: 'POS' | 'QR' } = {}) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.outlet(input.outletId);
    const session = await this.outletSession(outlet);
    const table = await this.checkTable(outlet, input.tableId);
    await this.member(outlet.companyId, input.customerId);
    await this.checkVoucher(outlet, input.voucherCode, input.customerId, new Date());
    const lines = await this.resolveLines(outlet, input.lines);
    const u = RequestCtx.user();
    const date = await this.todayDate(outlet.companyId);
    const id = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.posSale.create({
        data: {
          companyId: outlet.companyId,
          branchId: outlet.branchId ?? session.branchId,
          outletId: outlet.id,
          sessionId: session.id,
          date,
          status: 'OPEN',
          orderType: input.orderType,
          tableId: table?.id ?? null,
          covers: input.covers,
          label: input.label ?? null,
          customerId: input.customerId ?? null,
          voucherCode: input.voucherCode ?? null,
          createdById: u.id,
          lines: { create: lines.map((l, i) => this.lineData(l, i + 1, opts.source)) },
        },
      });
      await this.reprice(tx, sale.id, outlet);
      if (input.send) await this.sendToKitchen(tx, sale.id, outlet, outlet.serviceStyle === 'COUNTER' || !table);
      return sale.id;
    });
    await this.audit.record('POS Order', id, 'CREATE', undefined, { outlet: outlet.code, table: table?.code ?? null, lines: lines.length });
    this.bus.changed(outlet.companyId, outlet.id);
    return this.getOrder(id);
  }

  private lineData(l: Awaited<ReturnType<PosService['resolveLines']>>[number], lineNo: number, source: 'POS' | 'QR' = 'POS') {
    return {
      lineNo,
      source,
      productId: l.p.id,
      name: l.p.name,
      qty: D(l.input.qty),
      unitPrice: l.unitPrice,
      discountPct: D(l.input.discountPct),
      modifiers: l.picks as unknown as Prisma.InputJsonValue,
      note: l.input.note ?? null,
      course: l.input.course,
      station: l.p.posStation,
      taxId: l.p.saleTaxId,
    };
  }

  async addLines(id: string, input: z.infer<typeof addLinesSchema>, opts: { source?: 'POS' | 'QR' } = {}) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const outlet = await this.outlet(s.outletId!);
    const lines = await this.resolveLines(outlet, input.lines);
    const last = s.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
    await this.prisma.$transaction(async (tx) => {
      await tx.posSaleLine.createMany({ data: lines.map((l, i) => ({ saleId: s.id, ...this.lineData(l, last + i + 1, opts.source) })) });
      await this.reprice(tx, s.id, outlet);
      if (input.send) await this.sendToKitchen(tx, s.id, outlet, outlet.serviceStyle === 'COUNTER' || !s.tableId);
    });
    this.bus.changed(s.companyId, s.outletId);
    return this.getOrder(id);
  }

  /** changes a line that has not been sent to the kitchen yet (qty / discount / note / course) */
  async updateLine(id: string, lineId: string, input: { qty?: number; discountPct?: number; note?: string | null; course?: number }) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const line = s.lines.find((l) => l.id === lineId && l.status === 'ACTIVE');
    if (!line) throw new NotFoundException('Line not found');
    if (line.sentAt && input.qty !== undefined && D(input.qty).lt(line.qty)) throw new ConflictException('This item is already in the kitchen: void it instead of lowering the quantity');
    const outlet = await this.outlet(s.outletId!);
    await this.prisma.$transaction(async (tx) => {
      await tx.posSaleLine.update({
        where: { id: lineId },
        data: {
          ...(input.qty !== undefined ? { qty: D(input.qty) } : {}),
          ...(input.discountPct !== undefined ? { discountPct: D(input.discountPct) } : {}),
          ...(input.note !== undefined && !line.sentAt ? { note: input.note } : {}),
          ...(input.course !== undefined && !line.sentAt ? { course: input.course } : {}),
        },
      });
      await this.reprice(tx, s.id, outlet);
    });
    this.bus.changed(s.companyId, s.outletId, ['orders']);
    return this.getOrder(id);
  }

  /** removes a line: unsent lines are deleted, lines already in the kitchen are voided with a reason (manager right) */
  async voidLine(id: string, lineId: string, reason: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const line = s.lines.find((l) => l.id === lineId && l.status === 'ACTIVE');
    if (!line) throw new NotFoundException('Line not found');
    if (line.sentAt) RequestCtx.assert('pos.sale.void');
    const outlet = await this.outlet(s.outletId!);
    await this.prisma.$transaction(async (tx) => {
      if (!line.sentAt) await tx.posSaleLine.delete({ where: { id: lineId } });
      else {
        await tx.posSaleLine.update({ where: { id: lineId }, data: { status: 'VOID', voidReason: reason.slice(0, 200) } });
        if (line.ticketId) {
          const left = await tx.posSaleLine.count({ where: { ticketId: line.ticketId, status: 'ACTIVE' } });
          if (!left) await tx.posKitchenTicket.update({ where: { id: line.ticketId }, data: { status: 'VOID' } });
        }
        await this.audit.record('POS Order', s.id, 'VOID_ITEM', { item: line.name, qty: line.qty.toString() }, { reason }, tx);
      }
      await this.reprice(tx, s.id, outlet);
      await this.refreshKitchenStatus(tx, s.id);
    });
    this.bus.changed(s.companyId, s.outletId);
    return this.getOrder(id);
  }

  async updateOrder(id: string, input: z.infer<typeof updateOrderSchema>) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const outlet = await this.outlet(s.outletId!);
    const table = input.tableId !== undefined ? await this.checkTable(outlet, input.tableId) : undefined;
    if (input.customerId !== undefined) await this.member(s.companyId, input.customerId);
    await this.checkVoucher(outlet, input.voucherCode, input.customerId !== undefined ? input.customerId : s.customerId, s.createdAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.posSale.update({
        where: { id },
        data: {
          ...(input.orderType ? { orderType: input.orderType } : {}),
          ...(table !== undefined ? { tableId: table?.id ?? null } : {}),
          ...(input.covers !== undefined ? { covers: input.covers } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
          ...(input.voucherCode !== undefined ? { voucherCode: input.voucherCode } : {}),
        },
      });
      if (table) await tx.posKitchenTicket.updateMany({ where: { saleId: id, status: { in: ['HELD', 'NEW', 'PREPARING', 'READY'] } }, data: { label: table.name } });
      await this.reprice(tx, id, outlet);
    });
    if (table !== undefined) await this.audit.record('POS Order', id, 'MOVE_TABLE', { tableId: s.tableId }, { tableId: table?.id ?? null });
    this.bus.changed(s.companyId, s.outletId);
    return this.getOrder(id);
  }

  /** moves whole lines or part of their quantity to a new bill (split bill) */
  async split(id: string, input: z.infer<typeof splitSchema>) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const outlet = await this.outlet(s.outletId!);
    const newId = await this.prisma.$transaction(async (tx) => {
      const target = await tx.posSale.create({
        data: { companyId: s.companyId, branchId: s.branchId, outletId: s.outletId, sessionId: s.sessionId, date: s.date, status: 'OPEN', orderType: s.orderType, tableId: s.tableId, label: s.label ? `${s.label} (split)`.slice(0, 60) : 'Split bill', kitchenStatus: s.kitchenStatus, createdById: RequestCtx.user().id },
      });
      let no = 1;
      for (const x of input.lines) {
        const line = s.lines.find((l) => l.id === x.lineId && l.status === 'ACTIVE');
        if (!line) throw new BadRequestException('A line to split was not found on this bill');
        const qty = D(x.qty);
        if (qty.gt(line.qty)) throw new BadRequestException(`${line.name}: only ${line.qty} on the bill`);
        if (qty.eq(line.qty)) await tx.posSaleLine.update({ where: { id: line.id }, data: { saleId: target.id, lineNo: no++ } });
        else {
          await tx.posSaleLine.update({ where: { id: line.id }, data: { qty: line.qty.minus(qty) } });
          const { id: _id, saleId: _s, lineNo: _n, modifiers, ...rest } = line;
          await tx.posSaleLine.create({ data: { ...rest, modifiers: modifiers as Prisma.InputJsonValue, saleId: target.id, lineNo: no++, qty } });
        }
      }
      if (!(await tx.posSaleLine.count({ where: { saleId: s.id, status: 'ACTIVE' } }))) throw new BadRequestException('Leave at least one item on the original bill');
      await this.reprice(tx, s.id, outlet);
      await this.reprice(tx, target.id, outlet);
      return target.id;
    });
    await this.audit.record('POS Order', id, 'SPLIT', undefined, { newBill: newId, lines: input.lines.length });
    this.bus.changed(s.companyId, s.outletId, ['orders']);
    return this.getOrder(newId);
  }

  /** moves every line of another open bill onto this one */
  async merge(id: string, fromId: string) {
    RequestCtx.assert('pos.sale.create');
    if (id === fromId) throw new BadRequestException('Choose another bill');
    const [a, b] = [await this.order(id), await this.order(fromId)];
    this.openOnly(a);
    this.openOnly(b);
    if (a.outletId !== b.outletId) throw new BadRequestException('Bills of different outlets cannot be merged');
    const outlet = await this.outlet(a.outletId!);
    const last = a.lines.reduce((m, l) => Math.max(m, l.lineNo), 0);
    await this.prisma.$transaction(async (tx) => {
      let no = last + 1;
      for (const l of b.lines) await tx.posSaleLine.update({ where: { id: l.id }, data: { saleId: a.id, lineNo: no++ } });
      await tx.posKitchenTicket.updateMany({ where: { saleId: b.id }, data: { saleId: a.id } });
      await tx.posSale.update({ where: { id: b.id }, data: { status: 'CANCELLED', voidReason: `Merged into another bill` } });
      await this.reprice(tx, a.id, outlet);
      await this.refreshKitchenStatus(tx, a.id);
    });
    await this.audit.record('POS Order', id, 'MERGE', undefined, { merged: fromId });
    this.bus.changed(a.companyId, a.outletId);
    return this.getOrder(id);
  }

  /** cancels an open bill; items already in the kitchen need the void right */
  async cancelOrder(id: string, reason: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    if (s.lines.some((l) => l.sentAt && l.status === 'ACTIVE')) RequestCtx.assert('pos.sale.void');
    await this.prisma.$transaction(async (tx) => {
      await tx.posSale.update({ where: { id }, data: { status: 'CANCELLED', voidReason: reason.slice(0, 200), kitchenStatus: 'NONE' } });
      await tx.posKitchenTicket.updateMany({ where: { saleId: id }, data: { status: 'VOID' } });
      await this.audit.record('POS Order', id, 'CANCEL', { status: 'OPEN' }, { reason }, tx);
    });
    this.bus.changed(s.companyId, s.outletId);
    return { ok: true };
  }

  /** prints the bill (pre-receipt) for the table */
  async printBill(id: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    await this.prisma.posSale.update({ where: { id }, data: { billPrintedAt: new Date() } });
    this.bus.changed(s.companyId, s.outletId, ['orders']);
    return this.receipt(id);
  }

  /** recomputes the bill: promotions as at the time the bill was opened (happy hours), vouchers, service charge, taxes */
  private async reprice(tx: Tx, saleId: string, outlet: Outlet) {
    const s = await tx.posSale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: { where: { status: 'ACTIVE' }, orderBy: { lineNo: 'asc' } } } });
    if (!s.lines.length) {
      await tx.posSale.update({ where: { id: saleId }, data: { subtotal: ZERO, discount: ZERO, serviceCharge: ZERO, taxTotal: ZERO, localTax: ZERO, total: ZERO, promotions: [] } });
      return null;
    }
    let priced;
    try {
      priced = await this.price(outlet, s.lines.map((l) => ({ key: l.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId })), s.customerId, s.voucherCode, s.createdAt);
    } catch (e) {
      // an invalid voucher must not lock the bill: drop it and price again
      if (!s.voucherCode) throw e;
      await tx.posSale.update({ where: { id: saleId }, data: { voucherCode: null } });
      priced = await this.price(outlet, s.lines.map((l) => ({ key: l.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxId: l.taxId })), s.customerId, null, s.createdAt);
    }
    const r = priced.result;
    for (const l of r.lines) await tx.posSaleLine.update({ where: { id: l.key }, data: { promoDiscount: l.promoDiscount, lineNet: l.net, lineTax: l.tax, lineTotal: l.total } });
    await tx.posSale.update({
      where: { id: saleId },
      data: { subtotal: r.subtotal, discount: r.discount, serviceCharge: r.serviceCharge, taxTotal: r.taxTotal, localTax: r.localTax, total: r.total, promotions: r.promotions as unknown as Prisma.InputJsonValue },
    });
    return r;
  }

  // ------------------------------------------------------------------ kitchen
  /** daily queue number of the outlet (row lock: no duplicates between tills) */
  private async nextQueueNo(tx: Tx, outletId: string, companyId: string) {
    const [o] = await tx.$queryRaw<{ queueDate: Date | null; queueNext: number; queuePrefix: string }[]>`SELECT "queueDate", "queueNext", "queuePrefix" FROM pos_outlets WHERE id = ${outletId}::uuid FOR UPDATE`;
    const today = localClock(new Date(), await this.tz(companyId)).date;
    const nr = o.queueDate && o.queueDate.toISOString().slice(0, 10) === today ? o.queueNext : 1;
    await tx.posOutlet.update({ where: { id: outletId }, data: { queueDate: new Date(today), queueNext: nr + 1 } });
    return `${o.queuePrefix}${String(nr).padStart(3, '0')}`;
  }

  /**
   * Sends the unsent items to their stations: one ticket per station and course. With table service only the
   * first course is cooked at once; later courses wait (HELD) until the waiter fires them.
   */
  private async sendToKitchen(tx: Tx, saleId: string, outlet: Outlet, fireAll: boolean) {
    const s = await tx.posSale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: { where: { status: 'ACTIVE', sentAt: null } } } });
    if (!s.lines.length) return;
    const now = new Date();
    let queueNo = s.queueNo;
    if (!s.tableId && !queueNo) {
      queueNo = await this.nextQueueNo(tx, outlet.id, outlet.companyId);
      await tx.posSale.update({ where: { id: saleId }, data: { queueNo } });
    }
    const table = s.tableId ? await tx.posTable.findUnique({ where: { id: s.tableId }, select: { name: true } }) : null;
    const label = (table?.name ?? queueNo ?? s.label ?? 'Order').slice(0, 60);
    const round_ = ((await tx.posKitchenTicket.aggregate({ where: { saleId }, _max: { round: true } }))._max.round ?? 0) + 1;
    const firedCourse = fireAll ? 99 : Math.max(1, ...(await tx.posKitchenTicket.findMany({ where: { saleId, status: { not: 'HELD' } }, select: { course: true } })).map((t) => t.course));
    const groups = new Map<string, typeof s.lines>();
    for (const l of s.lines.filter((x) => x.station)) {
      const k = `${l.station}|${l.course}`;
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const [k, lines] of groups) {
      const [station, course] = [k.split('|')[0], Number(k.split('|')[1])];
      const held = course > firedCourse;
      const t = await tx.posKitchenTicket.create({ data: { companyId: outlet.companyId, outletId: outlet.id, saleId, round: round_, station, course, label, status: held ? 'HELD' : 'NEW', firedAt: held ? null : now } });
      await tx.posSaleLine.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { ticketId: t.id } });
    }
    await tx.posSaleLine.updateMany({ where: { id: { in: s.lines.map((l) => l.id) } }, data: { sentAt: now } });
    await this.refreshKitchenStatus(tx, saleId);
  }

  async send(id: string) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    this.openOnly(s);
    const outlet = await this.outlet(s.outletId!);
    await this.prisma.$transaction((tx) => this.sendToKitchen(tx, id, outlet, outlet.serviceStyle === 'COUNTER' || !s.tableId));
    this.bus.changed(s.companyId, s.outletId);
    return this.getOrder(id);
  }

  /** fires the held tickets up to this course (e.g. main course after the starters) */
  async fire(id: string, course: number) {
    RequestCtx.assert('pos.sale.create');
    const s = await this.order(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.posKitchenTicket.updateMany({ where: { saleId: id, status: 'HELD', course: { lte: course } }, data: { status: 'NEW', firedAt: new Date() } });
      await this.refreshKitchenStatus(tx, id);
    });
    this.bus.changed(s.companyId, s.outletId);
    return this.getOrder(id);
  }

  /** order-level kitchen state for the queue board */
  async refreshKitchenStatus(tx: Tx, saleId: string) {
    const s = await tx.posSale.findUniqueOrThrow({ where: { id: saleId }, select: { kitchenStatus: true, tickets: { where: { status: { not: 'VOID' } }, select: { status: true } } } });
    if (s.kitchenStatus === 'COLLECTED') return;
    const t = s.tickets;
    const next = !t.length ? 'NONE' : t.every((x) => x.status === 'READY' || x.status === 'SERVED') ? 'READY' : 'PREPARING';
    if (next !== s.kitchenStatus) await tx.posSale.update({ where: { id: saleId }, data: { kitchenStatus: next, readyAt: next === 'READY' ? new Date() : null } });
  }

  // ------------------------------------------------------------------ payment
  /** counter sale in one step: order + payment (retail scan & pay, quick service) */
  async sell(input: z.infer<typeof saleSchema>) {
    RequestCtx.assert('pos.sale.create');
    const session = await this.payingSession(input.sessionId);
    if (!session.outletId) throw new ConflictException('This shift has no outlet: close it and open a new one');
    const outlet = await this.outlet(session.outletId);
    const order = await this.createOrder({ outletId: outlet.id, orderType: input.orderType ?? (outlet.mode === 'FNB' ? 'TAKEAWAY' : 'RETAIL'), covers: 0, label: input.label, customerId: input.customerId, voucherCode: input.voucherCode, lines: input.lines, send: false });
    try {
      return await this.pay(order.id, { sessionId: session.id, customerId: input.customerId, voucherCode: input.voucherCode, payments: input.payments });
    } catch (e) {
      // the order was only a vehicle for this payment: do not leave it open
      await this.prisma.posSale.update({ where: { id: order.id }, data: { status: 'CANCELLED', voidReason: 'Payment failed' } });
      this.bus.changed(outlet.companyId, outlet.id, ['orders']);
      throw e;
    }
  }

  async pay(id: string, input: z.infer<typeof paySchema>) {
    RequestCtx.assert('pos.sale.create');
    const u = RequestCtx.user();
    const session = await this.payingSession(input.sessionId);
    const s0 = await this.order(id);
    this.openOnly(s0);
    if (s0.outletId !== session.outletId) throw new BadRequestException('This bill belongs to another outlet');
    const outlet = await this.outlet(s0.outletId!);
    const companyId = outlet.companyId;
    if (input.customerId !== undefined || input.voucherCode !== undefined) {
      await this.member(companyId, input.customerId);
      await this.checkVoucher(outlet, input.voucherCode, input.customerId !== undefined ? input.customerId : s0.customerId, s0.createdAt);
      await this.prisma.posSale.update({ where: { id }, data: { ...(input.customerId !== undefined ? { customerId: input.customerId } : {}), ...(input.voucherCode !== undefined ? { voucherCode: input.voucherCode } : {}) } });
    }
    const loyalty = { perPoint: D(await this.settings.num('pos.loyaltyAmountPerPoint', companyId, 0)), value: D(await this.settings.num('pos.loyaltyPointValue', companyId, 0)) };
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', companyId, false);
    const date = await this.todayDate(companyId);

    // ledger account of each payment method
    const accountOf = async (method: string) => {
      if (method === 'POINTS') return null;
      const bankId = method === 'CASH' ? session.cashAccountId : (method === 'QRIS' ? outlet.qrisAccountId : method === 'CARD' ? outlet.cardAccountId : outlet.transferAccountId) || session.cashAccountId;
      const b = await this.prisma.bankAccount.findFirst({ where: { id: bankId, companyId } });
      if (!b?.accountId) throw new BadRequestException(`No ledger account for ${method} payments: set it on the outlet`);
      return b.accountId;
    };
    const payAccounts = new Map<string, string | null>();
    for (const p of input.payments) if (!payAccounts.has(p.method)) payAccounts.set(p.method, await accountOf(p.method));

    const result = await this.prisma.$transaction(
      async (tx) => {
        const r = await this.reprice(tx, id, outlet);
        const sale = await tx.posSale.findUniqueOrThrow({ where: { id }, include: { lines: { where: { status: 'ACTIVE' }, orderBy: { lineNo: 'asc' } } } });
        if (!r || !sale.lines.length) throw new BadRequestException('The bill has no items');
        const total = sale.total;
        const paid = round(sum(input.payments.map((p) => D(p.amount))));
        if (paid.lt(total)) throw new BadRequestException(`Amount paid (${paid.toFixed(2)}) is less than the total (${total.toFixed(2)})`);
        const nonCash = sum(input.payments.filter((p) => p.method !== 'CASH').map((p) => D(p.amount)));
        if (nonCash.gt(total)) throw new BadRequestException('Card / QRIS / transfer / points cannot be more than the total; give change only from cash');
        const change = paid.minus(total);

        // points
        const customer = sale.customerId ? await tx.customer.findUnique({ where: { id: sale.customerId } }) : null;
        const pointsAmount = sum(input.payments.filter((p) => p.method === 'POINTS').map((p) => D(p.amount)));
        let pointsRedeemed = 0;
        if (pointsAmount.gt(0)) {
          if (!customer?.memberNo) throw new BadRequestException('Points can only be used by a member');
          if (loyalty.value.lte(0)) throw new BadRequestException('Points have no value: set it in Settings > Point of Sale');
          pointsRedeemed = Math.ceil(pointsAmount.div(loyalty.value).toNumber() - 1e-9);
          if (pointsRedeemed > customer.points) throw new BadRequestException(`Not enough points: the member has ${customer.points}`);
        }
        const pointsEarned = customer?.memberNo && loyalty.perPoint.gt(0) ? Math.floor(total.minus(pointsAmount).div(loyalty.perPoint).toNumber()) : 0;

        const number = await this.sequence.next('POS', companyId, date, tx);
        await tx.posSale.update({
          where: { id },
          data: { number, status: 'PAID', sessionId: session.id, date, soldAt: new Date(), paid, change, payments: input.payments as unknown as Prisma.InputJsonValue, pointsEarned, pointsRedeemed, createdById: sale.createdById ?? u.id },
        });

        // stock + ledger
        const j: PostingLine[] = [];
        const byMethod = new Map<string, Prisma.Decimal>();
        for (const p of input.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? ZERO).plus(D(p.amount)));
        if (change.gt(0)) byMethod.set('CASH', (byMethod.get('CASH') ?? ZERO).minus(change));
        for (const [m, amt] of byMethod) if (amt.gt(0)) j.push(m === 'POINTS' ? { key: 'LOYALTY_DEFERRED', debit: amt, description: `Points redeemed ${number}`, customerId: sale.customerId } : { accountId: payAccounts.get(m)!, debit: amt, description: `${m} ${number}` });
        const products = new Map((await tx.product.findMany({ where: { id: { in: sale.lines.map((l) => l.productId) } } })).map((p) => [p.id, p]));
        const taxes = await tx.tax.findMany({ where: { id: { in: sale.lines.map((l) => l.taxId!).filter(Boolean) } } });
        const taxAcc = new Map(taxes.map((t) => [t.id, t.salesAccountId]));
        let biggest: { accountId?: string | null; key?: string; amount: Prisma.Decimal } = { key: 'SALES', amount: ZERO };
        for (const l of sale.lines) {
          const p = products.get(l.productId)!;
          const rev = { accountId: p.incomeAccountId, key: p.incomeAccountId ? undefined : p.type === 'STOCK' ? 'SALES' : 'SERVICE_REVENUE' };
          j.push({ ...rev, credit: l.lineNet, description: l.name, customerId: sale.customerId });
          if (l.lineNet.gt(biggest.amount)) biggest = { ...rev, amount: l.lineNet };
          if (l.lineTax.gt(0)) j.push({ accountId: taxAcc.get(l.taxId!) ?? null, key: taxAcc.get(l.taxId!) ? undefined : 'TAX_OUT', credit: l.lineTax, description: 'PPN (faktur pajak digunggung)' });
          const cost = await this.issueStock(tx, { companyId, branchId: sale.branchId, date, saleId: sale.id, number, warehouseId: outlet.warehouseId, allowNegative }, l, p);
          if (cost.gt(0)) j.push({ key: 'COGS', debit: cost, description: l.name }, { key: 'INVENTORY', credit: cost });
          await tx.posSaleLine.update({ where: { id: l.id }, data: { unitCost: l.qty.gt(0) ? cost.div(l.qty) : ZERO } });
        }
        const serviceTax = sale.taxTotal.minus(sum(sale.lines.map((l) => l.lineTax)));
        if (sale.serviceCharge.gt(0)) j.push({ key: outlet.serviceChargeToStaff ? 'SERVICE_CHARGE_PAYABLE' : 'SERVICE_CHARGE_INCOME', credit: sale.serviceCharge, description: 'Service charge' });
        if (serviceTax.gt(0)) j.push({ key: 'TAX_OUT', credit: serviceTax, description: 'PPN on service charge' });
        if (sale.localTax.gt(0)) j.push({ key: 'PBJT_PAYABLE', credit: sale.localTax, description: 'PBJT (pajak barang dan jasa tertentu)' });
        // points earned: part of the price is deferred until the points are used
        const deferred = loyalty.value.gt(0) ? round(loyalty.value.times(pointsEarned)) : ZERO;
        if (deferred.gt(0)) j.push({ accountId: biggest.accountId, key: biggest.accountId ? undefined : biggest.key, debit: deferred, description: `${pointsEarned} points earned` }, { key: 'LOYALTY_DEFERRED', credit: deferred, description: `${pointsEarned} points earned`, customerId: sale.customerId });
        await this.journal.post(tx, { companyId, branchId: sale.branchId, date, description: `POS ${number}`, reference: number, sourceType: 'POS', sourceId: sale.id, lines: j });

        if (customer && (pointsEarned || pointsRedeemed)) {
          await tx.customer.update({ where: { id: customer.id }, data: { points: { increment: pointsEarned - pointsRedeemed } } });
          if (pointsRedeemed) await tx.posPointEntry.create({ data: { companyId, customerId: customer.id, saleId: sale.id, points: -pointsRedeemed, reason: `Redeemed on ${number}`, createdById: u.id } });
          if (pointsEarned) await tx.posPointEntry.create({ data: { companyId, customerId: customer.id, saleId: sale.id, points: pointsEarned, reason: `Earned on ${number}`, createdById: u.id } });
        }
        for (const p of r.promotions) await tx.posPromotion.update({ where: { id: p.promotionId }, data: { usedCount: { increment: 1 } } });
        // counter service: paid orders go to the kitchen now, with a queue number
        await this.sendToKitchen(tx, id, outlet, true);
        await this.audit.record('POS Sale', id, 'PAY', { status: 'OPEN' }, { number, total: total.toString(), payments: input.payments.map((p) => p.method) }, tx);
        return { id, number };
      },
      { timeout: 60_000 },
    );
    this.bus.changed(companyId, outlet.id);
    return { ...(await this.getOrder(result.id)), id: result.id, number: result.number };
  }

  /** stock out of the sold item: a recipe / kit issues its components, goods issue themselves; modifiers issue their ingredient */
  private async issueStock(
    tx: Tx,
    c: { companyId: string; branchId: string | null; date: Date; saleId: string; number: string; warehouseId: string; allowNegative: boolean },
    l: { id: string; qty: Prisma.Decimal; name: string; modifiers: Prisma.JsonValue },
    p: { id: string; name: string; type: string; trackLots: boolean },
  ) {
    const items: { productId: string; qty: Prisma.Decimal }[] = [];
    const bom = await tx.bom.findFirst({ where: { companyId: c.companyId, productId: p.id, isActive: true, backflushOnSale: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], include: { lines: true } });
    if (bom) for (const bl of bom.lines) items.push({ productId: bl.productId, qty: l.qty.times(bl.qty).div(bom.outputQty).times(D(100).plus(bl.scrapPct)).div(100) });
    else if (p.type === 'STOCK') items.push({ productId: p.id, qty: l.qty });
    for (const m of (l.modifiers as unknown as ModifierPick[]) ?? []) if (m.productId) items.push({ productId: m.productId, qty: l.qty.times(D(m.qty || 1)) });
    if (!items.length) return ZERO;
    const prods = new Map((await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } })).map((x) => [x.id, x]));
    let cost = ZERO;
    for (const it of items) {
      const x = prods.get(it.productId);
      if (!x || x.type !== 'STOCK' || it.qty.lte(0)) continue;
      const qty = it.qty.toDecimalPlaces(4);
      if (x.trackLots) {
        await this.lots.ensureOpening(tx, c.companyId, x.id, c.warehouseId);
        await this.lots.issue(tx, { companyId: c.companyId, documentId: c.saleId, lineId: l.id, productId: x.id, warehouseId: c.warehouseId, qty });
      }
      const r = await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, date: c.date, docType: 'POS', documentId: c.saleId, documentNumber: c.number, allowNegative: c.allowNegative, productId: x.id, productName: x.name, warehouseId: c.warehouseId, qty: qty.neg() });
      cost = cost.plus(r.totalCost.abs());
    }
    return round(cost);
  }

  // ------------------------------------------------------------------ receipts, void
  /** a receipt (or the bill of an open table) with everything the struk prints */
  async receipt(id: string) {
    RequestCtx.assert('pos.sale.create');
    if (!UUID.test(id)) throw new NotFoundException('Receipt not found');
    const companyId = RequestCtx.companyId();
    const sale = await this.prisma.posSale.findFirst({ where: { id, companyId }, include: { lines: { where: { status: 'ACTIVE' }, orderBy: { lineNo: 'asc' } } } });
    if (!sale) throw new NotFoundException('Receipt not found');
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, legalName: true, address: true, city: true, phone: true, taxId: true } });
    const cashier = sale.createdById ? await this.prisma.user.findUnique({ where: { id: sale.createdById }, select: { fullName: true } }) : null;
    const outlet = sale.outletId ? await this.prisma.posOutlet.findUnique({ where: { id: sale.outletId } }) : null;
    const table = sale.tableId ? await this.prisma.posTable.findUnique({ where: { id: sale.tableId }, select: { name: true } }) : null;
    const customer = sale.customerId ? await this.prisma.customer.findUnique({ where: { id: sale.customerId }, select: { name: true, memberNo: true, points: true } }) : null;
    return {
      ...sale,
      cashier: cashier?.fullName ?? '',
      outlet: outlet ? { name: outlet.name, mode: outlet.mode, pbjtRate: n(outlet.pbjtRate), serviceChargePct: n(outlet.serviceChargePct) } : null,
      table: table?.name ?? null,
      customer,
      seller: { name: c.legalName ?? c.name, address: [c.address, c.city].filter(Boolean).join(', '), phone: c.phone, npwp: this.crypto.decrypt(c.taxId), vatPayer: await this.settings.bool('sales.vatPayer', companyId, true) },
      footer: outlet?.receiptFooter || 'Terima kasih atas kunjungan Anda',
      pbjtRate: n(outlet?.pbjtRate),
    };
  }

  /** voids a paid receipt of an open shift: stock, lots, ledger, points and promotion uses are reversed */
  async void(id: string, reason: string) {
    RequestCtx.assert('pos.sale.void');
    const u = RequestCtx.user();
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', u.companyId, false);
    const r = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.posSale.findFirst({ where: { id, companyId: u.companyId }, include: { session: true } });
      if (!sale) throw new NotFoundException('Receipt not found');
      if (sale.status === 'VOID') throw new ConflictException('Already voided');
      if (sale.status !== 'PAID') throw new ConflictException('Only a paid receipt can be voided; cancel an open bill instead');
      if (sale.session.status !== 'OPEN') throw new ConflictException('The shift of this receipt is closed: make a sales return instead');
      await this.inventory.reverse(tx, sale.id, allowNegative);
      await this.lots.reverse(tx, sale.id);
      await this.journal.voidBySource(tx, 'POS', sale.id);
      if (sale.customerId && (sale.pointsEarned || sale.pointsRedeemed)) {
        await tx.customer.update({ where: { id: sale.customerId }, data: { points: { increment: sale.pointsRedeemed - sale.pointsEarned } } });
        await tx.posPointEntry.create({ data: { companyId: u.companyId, customerId: sale.customerId, saleId: sale.id, points: sale.pointsRedeemed - sale.pointsEarned, reason: `Receipt ${sale.number} voided`, createdById: u.id } });
      }
      for (const p of (sale.promotions as { promotionId: string }[]) ?? []) await tx.posPromotion.updateMany({ where: { id: p.promotionId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
      await tx.posKitchenTicket.updateMany({ where: { saleId: id, status: { in: ['HELD', 'NEW', 'PREPARING'] } }, data: { status: 'VOID' } });
      const x = await tx.posSale.update({ where: { id }, data: { status: 'VOID', voidReason: reason.slice(0, 200), kitchenStatus: 'NONE' } });
      await this.audit.record('POS Sale', id, 'VOID', { status: 'PAID' }, { status: 'VOID', reason }, tx);
      return x;
    });
    this.bus.changed(r.companyId, r.outletId);
    return r;
  }

  // ------------------------------------------------------------------ reports
  /** daily recap: the faktur pajak digunggung lines of the SPT Masa PPN, PBJT for the regional return */
  async dailyRecap(from: Date, to: Date, outletId?: string) {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSale.groupBy({
      by: ['date'],
      where: { companyId, status: 'PAID', date: { gte: from, lte: to }, ...(outletId && UUID.test(outletId) ? { outletId } : {}) },
      _sum: { subtotal: true, discount: true, serviceCharge: true, taxTotal: true, localTax: true, total: true },
      _count: { _all: true },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({ date: r.date, receipts: r._count._all, discount: n(r._sum.discount), serviceCharge: n(r._sum.serviceCharge), dpp: n(r._sum.subtotal), ppn: n(r._sum.taxTotal), pbjt: n(r._sum.localTax), total: n(r._sum.total) }));
  }

  /** service charge per outlet; staff pools split 95% workers / 3% loss & damage / 2% staff development (Permenaker 7/2016 Art. 9) */
  async serviceChargePool(from: Date, to: Date) {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSale.groupBy({ by: ['outletId'], where: { companyId, status: 'PAID', date: { gte: from, lte: to }, serviceCharge: { gt: 0 } }, _sum: { serviceCharge: true }, _count: { _all: true } });
    const outlets = new Map((await this.prisma.posOutlet.findMany({ where: { companyId } })).map((o) => [o.id, o]));
    return rows.map((r) => {
      const o = outlets.get(r.outletId ?? '');
      const total = n(r._sum.serviceCharge);
      return { outletId: r.outletId, outlet: o?.name ?? '-', toStaff: !!o?.serviceChargeToStaff, receipts: r._count._all, total, workers: o?.serviceChargeToStaff ? Math.round(total * 95) / 100 : 0, lossAndDamage: o?.serviceChargeToStaff ? Math.round(total * 3) / 100 : 0, staffDevelopment: o?.serviceChargeToStaff ? Math.round(total * 2) / 100 : 0 };
    });
  }

  /** per-receipt listing for the regional revenue office (PBJT reporting / tapping), and for audits */
  async exportReceipts(from: Date, to: Date, outletId?: string) {
    RequestCtx.assert('pos.session.manage');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.posSale.findMany({
      where: { companyId, status: { in: ['PAID', 'VOID'] }, date: { gte: from, lte: to }, ...(outletId && UUID.test(outletId) ? { outletId } : {}) },
      orderBy: { soldAt: 'asc' },
      take: 50_000,
      select: { number: true, soldAt: true, date: true, outletId: true, orderType: true, status: true, subtotal: true, discount: true, serviceCharge: true, taxTotal: true, localTax: true, total: true, payments: true },
    });
    const outlets = new Map((await this.prisma.posOutlet.findMany({ where: { companyId }, select: { id: true, code: true } })).map((o) => [o.id, o.code]));
    return rows.map((r) => ({
      number: r.number,
      soldAt: r.soldAt,
      outlet: outlets.get(r.outletId ?? '') ?? '',
      orderType: r.orderType,
      status: r.status,
      discount: n(r.discount),
      serviceCharge: n(r.serviceCharge),
      dpp: n(r.subtotal),
      ppn: n(r.taxTotal),
      pbjt: n(r.localTax),
      total: n(r.total),
      payment: (r.payments as { method: string }[]).map((p) => p.method).join('+'),
    }));
  }

  /** guard for the realtime stream */
  async assertOutletAccess(outletId: string) {
    if (!RequestCtx.can('pos.sale.create') && !RequestCtx.can('pos.kitchen.view')) throw new ForbiddenException();
    return this.outlet(outletId);
  }
}
