import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { paged } from '../../common/utils/query';
import { CHANNELS, Channel, gumroadListing, gumroadOrder, gumroadPayout, ListingRow, OrderRow, ordersFromCsv, PayoutRow, SOCIAL_CHANNELS, statsFromFile, StatRow } from './marketplace-parse';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** today in Jakarta time */
export const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const storeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only')
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  channel: z.enum(CHANNELS),
  kind: z.enum(['STORE', 'SOCIAL']).optional(),
  url: z.preprocess((v) => (v === '' ? null : v), z.url({ protocol: /^https?$/ }).max(300).nullable().optional()),
  currencyCode: z
    .string()
    .trim()
    .length(3)
    .transform((s) => s.toUpperCase())
    .default('IDR'),
  customerId: optUuid,
  balanceBankAccountId: optUuid,
  payoutBankAccountId: optUuid,
  taxId: optUuid,
  whtTaxId: optUuid,
  defaultProductId: optUuid,
  /** undefined = keep, '' or null = remove */
  apiToken: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(500).nullable().optional()),
  syncFrom: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()),
  isActive: z.boolean().default(true),
  notes: optText(2000),
});
export type StoreInput = z.infer<typeof storeSchema>;

export const statSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rangeLabel: optText(100),
  visits: z.coerce.number().int().min(0).nullable().optional(),
  views: z.coerce.number().int().min(0).nullable().optional(),
  orders: z.coerce.number().int().min(0).nullable().optional(),
  revenue: z.coerce.number().min(0).nullable().optional(),
  followers: z.coerce.number().int().min(0).nullable().optional(),
  favorites: z.coerce.number().int().min(0).nullable().optional(),
  impressions: z.coerce.number().int().min(0).nullable().optional(),
  clicks: z.coerce.number().int().min(0).nullable().optional(),
  saves: z.coerce.number().int().min(0).nullable().optional(),
  listings: z.coerce.number().int().min(0).nullable().optional(),
});

export const importSchema = z.object({
  kind: z.enum(['ORDERS', 'STATS']),
  fileName: optText(200),
  /** file text read by the browser */
  content: z.string().min(1).max(1_900_000, "The file is too large (max about 1.9 MB): export a shorter period"),
});

export const orderSchema = z.object({
  externalId: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gross: z.coerce.number().positive().max(1e12),
  fee: z.coerce.number().min(0).max(1e12).default(0),
  country: z.preprocess((v) => (v === '' ? null : v), z.string().trim().length(2).nullable().optional()),
  listingId: optUuid,
  title: optText(300),
  qty: z.coerce.number().positive().max(1e6).default(1),
});

export const refundSchema = z.object({
  refunded: z.coerce.number().min(0).max(1e12),
  feeRefunded: z.coerce.number().min(0).max(1e12).default(0),
});

const GUMROAD_HOST = 'api.gumroad.com';

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // ================================================================ stores

  async store(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Store not found');
    const s = await this.prisma.marketplaceStore.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Store not found');
    return s;
  }

  /** what stops a store from booking its orders (empty = ready) */
  private async readiness(s: { kind: string; customerId: string | null; balanceBankAccountId: string | null; defaultProductId: string | null; id: string }) {
    if (s.kind !== 'STORE') return [];
    const issues: string[] = [];
    if (!s.customerId) issues.push('Choose the customer standing for the marketplace');
    if (!s.balanceBankAccountId) issues.push('Choose the marketplace balance account');
    const unmapped = await this.prisma.marketplaceListing.count({ where: { storeId: s.id, productId: null } });
    if (unmapped && !s.defaultProductId) issues.push(`${unmapped} listing(s) not mapped to a product and no default product`);
    return issues;
  }

  private view(s: Prisma.MarketplaceStoreGetPayload<object>) {
    const { apiToken, ...rest } = s;
    return { ...rest, hasToken: !!apiToken };
  }

  async stores() {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const list = await this.prisma.marketplaceStore.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
    const ids = list.map((s) => s.id);
    const [listings, unmapped, unposted] = await Promise.all([
      this.prisma.marketplaceListing.groupBy({ by: ['storeId'], where: { storeId: { in: ids } }, _count: true }),
      this.prisma.marketplaceListing.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, productId: null }, _count: true }),
      this.prisma.marketplaceOrder.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, settlementId: null }, _count: true }),
    ]);
    const cnt = (rows: { storeId: string; _count: number }[], id: string) => rows.find((r) => r.storeId === id)?._count ?? 0;
    return Promise.all(
      list.map(async (s) => ({ ...this.view(s), listings: cnt(listings, s.id), unmapped: cnt(unmapped, s.id), unposted: cnt(unposted, s.id), issues: await this.readiness(s) })),
    );
  }

  /** picklists for the store form: cash / bank accounts and taxes */
  async options() {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const [banks, taxes] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, currencyCode: true, isCash: true } }),
      this.prisma.tax.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, kind: true, rate: true } }),
    ]);
    return { banks, taxes: taxes.map((t) => ({ ...t, rate: n(t.rate) })), channels: CHANNELS };
  }

  private async checkRefs(companyId: string, i: StoreInput) {
    const errors: Record<string, string> = {};
    const one = async (key: keyof StoreInput, ok: Promise<unknown>) => {
      if (!(await ok)) errors[key] = 'Not found';
    };
    const checks: Promise<void>[] = [];
    if (i.customerId) checks.push(one('customerId', this.prisma.customer.findFirst({ where: { id: i.customerId, companyId, deletedAt: null } })));
    for (const k of ['balanceBankAccountId', 'payoutBankAccountId'] as const) if (i[k]) checks.push(one(k, this.prisma.bankAccount.findFirst({ where: { id: i[k]!, companyId, deletedAt: null } })));
    if (i.taxId) checks.push(one('taxId', this.prisma.tax.findFirst({ where: { id: i.taxId, companyId, kind: 'VAT', deletedAt: null } })));
    if (i.whtTaxId) checks.push(one('whtTaxId', this.prisma.tax.findFirst({ where: { id: i.whtTaxId, companyId, kind: 'WHT', deletedAt: null } })));
    if (i.defaultProductId) checks.push(one('defaultProductId', this.prisma.product.findFirst({ where: { id: i.defaultProductId, companyId, deletedAt: null } })));
    await Promise.all(checks);
    if (i.balanceBankAccountId && i.balanceBankAccountId === i.payoutBankAccountId) errors.payoutBankAccountId = 'Payouts go to a real bank account, not to the marketplace balance';
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Validation failed', errors });
  }

  private data(i: StoreInput) {
    const kind = i.kind ?? (SOCIAL_CHANNELS.has(i.channel as Channel) ? 'SOCIAL' : 'STORE');
    return {
      code: i.code,
      name: i.name,
      channel: i.channel,
      kind,
      url: i.url ?? null,
      currencyCode: i.currencyCode,
      customerId: i.customerId ?? null,
      balanceBankAccountId: i.balanceBankAccountId ?? null,
      payoutBankAccountId: i.payoutBankAccountId ?? null,
      taxId: i.taxId ?? null,
      whtTaxId: i.whtTaxId ?? null,
      defaultProductId: i.defaultProductId ?? null,
      syncFrom: i.syncFrom ? new Date(i.syncFrom) : null,
      isActive: i.isActive,
      notes: i.notes ?? null,
      ...(i.apiToken === undefined ? {} : { apiToken: i.apiToken ? this.crypto.encrypt(i.apiToken) : null }),
    };
  }

  async createStore(body: unknown) {
    RequestCtx.assert('marketplace.manage');
    const i = storeSchema.parse(body);
    const u = RequestCtx.user();
    await this.checkRefs(u.companyId, i);
    if (await this.prisma.marketplaceStore.findFirst({ where: { companyId: u.companyId, code: i.code } })) throw new BadRequestException({ message: 'Validation failed', errors: { code: 'Code already used' } });
    const s = await this.prisma.marketplaceStore.create({ data: { ...this.data(i), companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Marketplace Store', s.id, 'CREATE', undefined, this.view(s));
    return this.view(s);
  }

  async updateStore(id: string, body: unknown) {
    RequestCtx.assert('marketplace.manage');
    const before = await this.store(id);
    const i = storeSchema.parse(body);
    await this.checkRefs(before.companyId, i);
    if (i.code !== before.code && (await this.prisma.marketplaceStore.findFirst({ where: { companyId: before.companyId, code: i.code } })))
      throw new BadRequestException({ message: 'Validation failed', errors: { code: 'Code already used' } });
    if (i.currencyCode !== before.currencyCode && (await this.prisma.marketplaceOrder.count({ where: { storeId: id } }))) throw new ConflictException('The store has orders: its currency cannot change');
    if (i.kind && i.kind !== before.kind && i.kind === 'SOCIAL' && (await this.prisma.marketplaceOrder.count({ where: { storeId: id } }))) throw new ConflictException('The store has orders: it cannot become an audience-only channel');
    const s = await this.prisma.marketplaceStore.update({ where: { id }, data: this.data(i) });
    await this.audit.record('Marketplace Store', id, 'UPDATE', this.view(before), this.view(s));
    return this.view(s);
  }

  async deleteStore(id: string) {
    RequestCtx.assert('marketplace.manage');
    const s = await this.store(id);
    const [orders, settlements, payouts] = await Promise.all([
      this.prisma.marketplaceOrder.count({ where: { storeId: id } }),
      this.prisma.marketplaceSettlement.count({ where: { storeId: id } }),
      this.prisma.marketplacePayout.count({ where: { storeId: id } }),
    ]);
    if (orders || settlements || payouts) throw new ConflictException('The store has orders, settlements or payouts: make it inactive instead');
    await this.prisma.marketplaceStore.delete({ where: { id } });
    await this.audit.record('Marketplace Store', id, 'DELETE', this.view(s));
    return { ok: true };
  }

  /**
   * Creates what a selling store needs to book its orders, when missing: a customer standing for the marketplace
   * (MP-<code>) and a cash / bank account for the money it holds for us, on Marketplace Balances (1-1210).
   */
  async setupAccounts(id: string) {
    RequestCtx.assert('marketplace.manage');
    const s = await this.store(id);
    if (s.kind !== 'STORE') throw new ConflictException('An audience-only channel has no orders to book');
    const u = RequestCtx.user();
    const code = `MP-${s.code}`.slice(0, 20);
    const made: string[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      let customerId = s.customerId;
      if (!customerId) {
        const c = (await tx.customer.findFirst({ where: { companyId: u.companyId, code, deletedAt: null } })) ?? (await tx.customer.create({ data: { companyId: u.companyId, code, name: `${s.name} (marketplace)`.slice(0, 200), createdById: u.id } as any }));
        customerId = c.id;
        made.push(`customer ${code}`);
      }
      let balanceBankAccountId = s.balanceBankAccountId;
      if (!balanceBankAccountId) {
        const m = await tx.accountMapping.findUnique({ where: { companyId_key: { companyId: u.companyId, key: 'MARKETPLACE_BALANCE' } } });
        if (!m?.accountId) throw new BadRequestException('Posting account "MARKETPLACE_BALANCE" is not configured. Run the seed or set it in Accounting > Posting Accounts.');
        const b =
          (await tx.bankAccount.findFirst({ where: { companyId: u.companyId, code, deletedAt: null } })) ??
          (await tx.bankAccount.create({ data: { companyId: u.companyId, code, name: `${s.name} balance`.slice(0, 100), accountId: m.accountId, currencyCode: 'IDR', createdById: u.id } }));
        balanceBankAccountId = b.id;
        made.push(`balance account ${code}`);
      }
      return tx.marketplaceStore.update({ where: { id }, data: { customerId, balanceBankAccountId } });
    });
    await this.audit.record('Marketplace Store', id, 'SETUP_ACCOUNTS', undefined, { made });
    return { store: this.view(result), made };
  }

  // ================================================================ listings

  async listings(storeId: string) {
    RequestCtx.assert('marketplace.read');
    await this.store(storeId);
    const rows = await this.prisma.marketplaceListing.findMany({ where: { storeId }, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
    const products = new Map(
      (await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId!).filter(Boolean) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]),
    );
    const since = new Date(Date.now() - 30 * 86_400_000);
    const sold = await this.prisma.marketplaceOrderLine.groupBy({ by: ['listingId'], where: { listingId: { in: rows.map((r) => r.id) }, order: { orderDate: { gte: since } } }, _sum: { amount: true, qty: true } });
    return rows.map((r) => {
      const s = sold.find((x) => x.listingId === r.id);
      return { ...r, price: n(r.price), product: r.productId ? (products.get(r.productId) ?? null) : null, sold30: n(s?._sum.qty), revenue30: n(s?._sum.amount) };
    });
  }

  async createListing(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.manage');
    const s = await this.store(storeId);
    const i = z
      .object({ externalId: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(300), url: optText(500), price: z.coerce.number().min(0).default(0), productId: optUuid })
      .parse(body);
    if (i.productId && !(await this.prisma.product.findFirst({ where: { id: i.productId, companyId: s.companyId, deletedAt: null } }))) throw new BadRequestException({ message: 'Validation failed', errors: { productId: 'Not found' } });
    if (await this.prisma.marketplaceListing.findUnique({ where: { storeId_externalId: { storeId, externalId: i.externalId } } })) throw new BadRequestException({ message: 'Validation failed', errors: { externalId: 'Already listed' } });
    return this.prisma.marketplaceListing.create({ data: { companyId: s.companyId, storeId, externalId: i.externalId, title: i.title, url: i.url ?? null, price: i.price, currencyCode: s.currencyCode, productId: i.productId ?? null } });
  }

  /** map listings to products (several at once) */
  async mapListings(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.manage');
    const s = await this.store(storeId);
    const { rows } = z.object({ rows: z.array(z.object({ id: z.uuid(), productId: optUuid, status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).optional() })).min(1).max(500) }).parse(body);
    const pids = [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))];
    if (pids.length && (await this.prisma.product.count({ where: { id: { in: pids }, companyId: s.companyId, deletedAt: null } })) !== pids.length) throw new BadRequestException('Unknown product');
    if ((await this.prisma.marketplaceListing.count({ where: { id: { in: rows.map((r) => r.id) }, storeId } })) !== rows.length) throw new BadRequestException('Unknown listing');
    await this.prisma.$transaction(rows.map((r) => this.prisma.marketplaceListing.update({ where: { id: r.id }, data: { productId: r.productId ?? null, ...(r.status ? { status: r.status } : {}) } })));
    await this.audit.record('Marketplace Store', storeId, 'MAP_LISTINGS', undefined, rows);
    return this.listings(storeId);
  }

  // ================================================================ orders

  async orders(q: { storeId?: string; status?: string; posted?: string; from?: string; to?: string; search?: string; page?: number; pageSize?: number }) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
    const where: Prisma.MarketplaceOrderWhereInput = {
      companyId,
      ...(q.storeId && UUID.test(q.storeId) ? { storeId: q.storeId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.posted === 'no' ? { settlementId: null } : q.posted === 'yes' ? { settlementId: { not: null } } : {}),
      ...(q.from || q.to ? { orderDate: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+07:00`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+07:00`) } : {}) } } : {}),
      ...(q.search ? { OR: [{ externalId: { contains: q.search, mode: 'insensitive' } }, { lines: { some: { title: { contains: q.search, mode: 'insensitive' } } } }] } : {}),
    };
    const [total, rows, sums] = await Promise.all([
      this.prisma.marketplaceOrder.count({ where }),
      this.prisma.marketplaceOrder.findMany({ where, orderBy: { orderDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { lines: { select: { title: true, qty: true, amount: true, listingId: true } }, store: { select: { code: true, name: true, channel: true } } } }),
      this.prisma.marketplaceOrder.groupBy({ by: ['currencyCode'], where, _sum: { gross: true, fee: true, refunded: true }, _count: true }),
    ]);
    const numbers = new Map(
      (await this.prisma.marketplaceSettlement.findMany({ where: { id: { in: rows.map((r) => r.settlementId!).filter(Boolean) } }, select: { id: true, number: true } })).map((x) => [x.id, x.number]),
    );
    return {
      ...paged(
        rows.map((o) => ({
          ...o,
          gross: n(o.gross),
          fee: n(o.fee),
          taxCollected: n(o.taxCollected),
          refunded: n(o.refunded),
          feeRefunded: n(o.feeRefunded),
          refundBooked: n(o.refundBooked),
          net: r2(n(o.gross) - n(o.fee) - n(o.refunded) + n(o.feeRefunded)),
          settlement: o.settlementId ? (numbers.get(o.settlementId) ?? null) : null,
          lines: o.lines.map((l) => ({ ...l, qty: n(l.qty), amount: n(l.amount) })),
        })),
        total,
        { page, pageSize },
      ),
      totals: sums.map((s) => ({ currencyCode: s.currencyCode, orders: s._count, gross: n(s._sum.gross), fee: n(s._sum.fee), refunded: n(s._sum.refunded) })),
    };
  }

  /** order typed by hand (a sale outside any export) */
  async addOrder(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.import');
    const s = await this.store(storeId);
    if (s.kind !== 'STORE') throw new ConflictException('An audience-only channel has no orders');
    const i = orderSchema.parse(body);
    let title = i.title ?? null;
    let listingExternal: string | null = null;
    if (i.listingId) {
      const l = await this.prisma.marketplaceListing.findFirst({ where: { id: i.listingId, storeId } });
      if (!l) throw new BadRequestException({ message: 'Validation failed', errors: { listingId: 'Not found' } });
      title = title ?? l.title;
      listingExternal = l.externalId;
    }
    const row: OrderRow = {
      externalId: i.externalId,
      orderDate: new Date(`${i.date}T12:00:00+07:00`),
      currencyCode: s.currencyCode,
      gross: i.gross,
      fee: i.fee,
      taxCollected: 0,
      refunded: 0,
      feeRefunded: 0,
      country: i.country?.toUpperCase() ?? null,
      lines: [{ externalId: listingExternal, title: title ?? 'Order item', qty: i.qty, amount: i.gross }],
    };
    if (await this.prisma.marketplaceOrder.findUnique({ where: { storeId_externalId: { storeId, externalId: i.externalId } } })) throw new BadRequestException({ message: 'Validation failed', errors: { externalId: 'This order is already recorded' } });
    const res = await this.saveOrders(s, [row], 'MANUAL', null);
    return res;
  }

  /** a refund seen on the marketplace (booked by the next settlement) */
  async setRefund(id: string, body: unknown) {
    RequestCtx.assert('marketplace.import');
    if (!UUID.test(id)) throw new NotFoundException('Order not found');
    const o = await this.prisma.marketplaceOrder.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!o) throw new NotFoundException('Order not found');
    const i = refundSchema.parse(body);
    if (i.refunded > n(o.gross)) throw new BadRequestException({ message: 'Validation failed', errors: { refunded: 'Cannot exceed what the buyer paid' } });
    if (i.feeRefunded > n(o.fee)) throw new BadRequestException({ message: 'Validation failed', errors: { feeRefunded: 'Cannot exceed the fee' } });
    if (i.refunded < n(o.refundBooked) || i.feeRefunded < n(o.feeRefundBooked)) throw new ConflictException('A larger refund is already booked: undo that settlement first');
    const status = i.refunded <= 0 ? 'PAID' : i.refunded >= n(o.gross) ? 'REFUNDED' : 'PARTIAL';
    const r = await this.prisma.marketplaceOrder.update({ where: { id }, data: { refunded: i.refunded, feeRefunded: i.feeRefunded, status } });
    await this.audit.record('Marketplace Order', id, 'REFUND', { refunded: n(o.refunded), feeRefunded: n(o.feeRefunded) }, i);
    return { id: r.id, status };
  }

  async deleteOrder(id: string) {
    RequestCtx.assert('marketplace.import');
    if (!UUID.test(id)) throw new NotFoundException('Order not found');
    const o = await this.prisma.marketplaceOrder.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!o) throw new NotFoundException('Order not found');
    if (o.settlementId) throw new ConflictException('The order is booked in a settlement: undo the settlement first');
    await this.prisma.marketplaceOrder.delete({ where: { id } });
    await this.audit.record('Marketplace Order', id, 'DELETE', { externalId: o.externalId, gross: n(o.gross) });
    return { ok: true };
  }

  /**
   * Inserts new orders and updates the refunds of known ones. The amounts of a booked order never change here;
   * a refund seen later is booked by the next settlement.
   */
  private async saveOrders(s: { id: string; companyId: string; currencyCode: string }, rows: OrderRow[], source: 'API' | 'FILE' | 'MANUAL', importId: string | null) {
    const out = { created: 0, updated: 0, skipped: 0, messages: [] as string[] };
    const listings = await this.prisma.marketplaceListing.findMany({ where: { storeId: s.id }, select: { id: true, externalId: true, title: true } });
    const byExt = new Map(listings.map((l) => [l.externalId, l.id]));
    const byTitle = new Map(listings.map((l) => [l.title.toLowerCase(), l.id]));
    const existing = new Map(
      (await this.prisma.marketplaceOrder.findMany({ where: { storeId: s.id, externalId: { in: rows.map((r) => r.externalId) } }, select: { id: true, externalId: true, gross: true, refunded: true, feeRefunded: true, refundBooked: true, feeRefundBooked: true } })).map((o) => [o.externalId, o]),
    );
    for (const r of rows) {
      if (r.currencyCode && r.currencyCode !== s.currencyCode) {
        out.skipped++;
        out.messages.push(`Order ${r.externalId}: currency ${r.currencyCode}, the store is in ${s.currencyCode}`);
        continue;
      }
      if (!(r.gross > 0)) {
        out.skipped++;
        out.messages.push(`Order ${r.externalId}: no amount (free product?), skipped`);
        continue;
      }
      const refunded = Math.min(r2(r.refunded), r2(r.gross));
      const status = refunded <= 0 ? 'PAID' : refunded >= r.gross ? 'REFUNDED' : 'PARTIAL';
      const old = existing.get(r.externalId);
      if (old) {
        // refunds only move forward
        const nextRefund = Math.max(refunded, n(old.refunded));
        const nextFeeRefund = Math.max(r2(r.feeRefunded), n(old.feeRefunded));
        if (nextRefund !== n(old.refunded) || nextFeeRefund !== n(old.feeRefunded)) {
          await this.prisma.marketplaceOrder.update({ where: { id: old.id }, data: { refunded: nextRefund, feeRefunded: nextFeeRefund, status: nextRefund <= 0 ? 'PAID' : nextRefund >= n(old.gross) ? 'REFUNDED' : 'PARTIAL' } });
          out.updated++;
        } else out.skipped++;
        continue;
      }
      // split the gross over the lines when the file gives only an order total
      const lineSum = r.lines.reduce((a, l) => a + l.amount, 0);
      const lines = r.lines.map((l) => ({
        title: l.title,
        externalId: l.externalId,
        qty: l.qty,
        amount: lineSum > 0 ? r2((l.amount / lineSum) * r.gross) : r2(r.gross / r.lines.length),
        listingId: (l.externalId && byExt.get(l.externalId)) || byTitle.get(l.title.toLowerCase()) || null,
      }));
      const diff = r2(r.gross - lines.reduce((a, l) => a + l.amount, 0));
      if (diff && lines.length) lines[0].amount = r2(lines[0].amount + diff);
      await this.prisma.marketplaceOrder.create({
        data: {
          companyId: s.companyId,
          storeId: s.id,
          externalId: r.externalId,
          orderDate: r.orderDate,
          currencyCode: s.currencyCode,
          gross: r2(r.gross),
          fee: r2(r.fee),
          taxCollected: r2(r.taxCollected),
          refunded,
          feeRefunded: Math.min(r2(r.feeRefunded), r2(r.fee)),
          status,
          country: r.country,
          source,
          importId,
          lines: { create: lines },
        },
      });
      out.created++;
    }
    return out;
  }

  private async upsertListings(s: { id: string; companyId: string }, rows: ListingRow[]) {
    let created = 0;
    let updated = 0;
    for (const l of rows) {
      const old = await this.prisma.marketplaceListing.findUnique({ where: { storeId_externalId: { storeId: s.id, externalId: l.externalId } } });
      if (old) {
        if (old.title !== l.title || n(old.price) !== l.price || old.status !== l.status || old.url !== l.url) {
          await this.prisma.marketplaceListing.update({ where: { id: old.id }, data: { title: l.title, price: l.price, status: l.status, url: l.url, currencyCode: l.currencyCode } });
          updated++;
        }
      } else {
        await this.prisma.marketplaceListing.create({ data: { companyId: s.companyId, storeId: s.id, ...l } });
        created++;
      }
    }
    // order lines that arrived before their listing
    await this.prisma.$executeRaw`UPDATE marketplace_order_lines ol SET "listingId" = l.id FROM marketplace_listings l, marketplace_orders o
      WHERE ol."orderId" = o.id AND o."storeId" = ${s.id}::uuid AND l."storeId" = o."storeId" AND ol."listingId" IS NULL AND ol."externalId" = l."externalId"`;
    return { created, updated };
  }

  private async savePayouts(s: { id: string; companyId: string; currencyCode: string; payoutBankAccountId: string | null }, rows: PayoutRow[]) {
    let created = 0;
    for (const p of rows) {
      if (!(p.amount > 0) || /fail|cancel|return/.test(p.status)) continue;
      if (await this.prisma.marketplacePayout.findUnique({ where: { storeId_externalId: { storeId: s.id, externalId: p.externalId } } })) continue;
      await this.prisma.marketplacePayout.create({
        data: { companyId: s.companyId, storeId: s.id, externalId: p.externalId, date: new Date(p.date), amount: p.amount, bankAccountId: s.payoutBankAccountId, status: 'PENDING', source: 'API', reference: `Gumroad payout ${p.status}`.slice(0, 100) },
      });
      created++;
    }
    return created;
  }

  // ================================================================ file import

  async importFile(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.import');
    const s = await this.store(storeId);
    const i = importSchema.parse(body);
    const u = RequestCtx.user();
    if (i.kind === 'ORDERS') {
      if (s.kind !== 'STORE') throw new ConflictException('An audience-only channel has no orders: import statistics instead');
      const parsed = ordersFromCsv(i.content, s.channel as Channel);
      if (!parsed.rows.length) throw new BadRequestException(parsed.messages.slice(0, 5).join('; ') || 'No orders found in the file');
      const log = await this.prisma.marketplaceImport.create({ data: { companyId: s.companyId, storeId, kind: 'ORDERS', source: 'FILE', fileName: i.fileName ?? null, messages: [], createdById: u.id } });
      const res = await this.saveOrders(s, parsed.rows, 'FILE', log.id);
      const messages = [...parsed.messages, ...res.messages].slice(0, 200);
      await this.prisma.marketplaceImport.update({ where: { id: log.id }, data: { created: res.created, updated: res.updated, skipped: res.skipped, messages } });
      await this.audit.record('Marketplace Store', storeId, 'IMPORT_ORDERS', undefined, { file: i.fileName, created: res.created, updated: res.updated, skipped: res.skipped });
      return { ...res, messages };
    }
    const parsed = statsFromFile(i.content, todayWib());
    if (!parsed.rows.length) throw new BadRequestException(parsed.messages.slice(0, 5).join('; ') || 'No statistics found in the file');
    let created = 0;
    let updated = 0;
    for (const r of parsed.rows) (await this.upsertStat(s, r, 'FILE')) ? created++ : updated++;
    await this.prisma.marketplaceImport.create({ data: { companyId: s.companyId, storeId, kind: 'STATS', source: 'FILE', fileName: i.fileName ?? null, created, updated, messages: parsed.messages.slice(0, 200), createdById: u.id } });
    await this.audit.record('Marketplace Store', storeId, 'IMPORT_STATS', undefined, { file: i.fileName, created, updated });
    return { created, updated, skipped: 0, messages: parsed.messages };
  }

  // ================================================================ Gumroad API sync

  private async gumroad<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://${GUMROAD_HOST}/v2/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (url.hostname !== GUMROAD_HOST) throw new BadRequestException('Host not allowed');
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'kcs-erp' }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new BadGatewayException(`Gumroad is unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) throw new BadRequestException('Gumroad refused the API token: create a new access token in Gumroad (Settings > Advanced > Applications) and save it on the store');
    if (!res.ok || body?.success === false) throw new BadGatewayException(`Gumroad answered ${res.status}: ${String(body?.message ?? text).slice(0, 200)}`);
    return body as T;
  }

  /** Reads products, sales (from the last sync, or the store's first day) and payouts from Gumroad */
  async sync(storeId: string) {
    RequestCtx.assert('marketplace.import');
    const s = await this.store(storeId);
    if (s.channel !== 'GUMROAD') throw new ConflictException('API sync is available for Gumroad stores. Import a file for the other marketplaces.');
    const token = this.crypto.decrypt(s.apiToken);
    if (!token) throw new BadRequestException('Save the Gumroad API token on the store first');
    const u = RequestCtx.user();
    const messages: string[] = [];

    const products = await this.gumroad<{ products?: Record<string, any>[] }>(token, 'products');
    const lres = await this.upsertListings(s, (products.products ?? []).map(gumroadListing));

    // a 3-day overlap catches refunds made just after the last sync
    const after = s.lastSyncAt ? iso(new Date(s.lastSyncAt.getTime() - 3 * 86_400_000)) : s.syncFrom ? iso(s.syncFrom) : '2010-01-01';
    const rows: OrderRow[] = [];
    let pageKey: string | undefined;
    for (let pageNo = 0; pageNo < 200; pageNo++) {
      const page = await this.gumroad<{ sales?: Record<string, any>[]; next_page_key?: string }>(token, 'sales', { after, ...(pageKey ? { page_key: pageKey } : {}) });
      for (const raw of page.sales ?? []) {
        const o = gumroadOrder(raw);
        if (o) rows.push({ ...o, currencyCode: o.currencyCode ?? s.currencyCode });
      }
      pageKey = page.next_page_key;
      if (!pageKey) break;
    }
    const log = await this.prisma.marketplaceImport.create({ data: { companyId: s.companyId, storeId, kind: 'SYNC', source: 'API', messages: [], createdById: u.id } });
    const ores = await this.saveOrders(s, rows, 'API', log.id);
    messages.push(...ores.messages);

    let payouts = 0;
    try {
      const p = await this.gumroad<{ payouts?: Record<string, any>[] }>(token, 'payouts');
      payouts = await this.savePayouts(s, (p.payouts ?? []).map(gumroadPayout).filter((x): x is PayoutRow => !!x));
    } catch (e) {
      messages.push(`Payouts not read: ${(e as Error).message}`);
    }
    await this.prisma.marketplaceStore.update({ where: { id: storeId }, data: { lastSyncAt: new Date() } });
    const summary = { listings: lres, orders: { created: ores.created, updated: ores.updated, skipped: ores.skipped }, payouts, messages: messages.slice(0, 200) };
    await this.prisma.marketplaceImport.update({ where: { id: log.id }, data: { created: ores.created + lres.created + payouts, updated: ores.updated + lres.updated, skipped: ores.skipped, messages: summary.messages } });
    await this.audit.record('Marketplace Store', storeId, 'SYNC', undefined, { listings: lres, orders: summary.orders, payouts });
    return summary;
  }

  async imports(storeId?: string) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.marketplaceImport.findMany({ where: { companyId, ...(storeId && UUID.test(storeId) ? { storeId } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 });
    const stores = new Map((await this.prisma.marketplaceStore.findMany({ where: { companyId }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    return rows.map((r) => ({ ...r, store: stores.get(r.storeId) ?? null }));
  }

  // ================================================================ statistics

  /** @returns true when a new day was added */
  private async upsertStat(s: { id: string; companyId: string }, r: StatRow, source: 'FILE' | 'MANUAL') {
    const date = new Date(r.date);
    const { date: _d, ...values } = r;
    const old = await this.prisma.marketplaceStat.findUnique({ where: { storeId_date: { storeId: s.id, date } } });
    if (old) {
      // a file never blanks a figure typed or imported before
      const data = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
      await this.prisma.marketplaceStat.update({ where: { id: old.id }, data: { ...data, source } });
      return false;
    }
    await this.prisma.marketplaceStat.create({ data: { companyId: s.companyId, storeId: s.id, date, ...values, source } });
    return true;
  }

  async saveStat(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.import');
    const s = await this.store(storeId);
    const i = statSchema.parse(body);
    if (i.date > todayWib()) throw new BadRequestException({ message: 'Validation failed', errors: { date: 'Cannot be in the future' } });
    const row: StatRow = {
      date: i.date,
      rangeLabel: i.rangeLabel ?? null,
      visits: i.visits ?? null,
      views: i.views ?? null,
      orders: i.orders ?? null,
      revenue: i.revenue ?? null,
      followers: i.followers ?? null,
      favorites: i.favorites ?? null,
      impressions: i.impressions ?? null,
      clicks: i.clicks ?? null,
      saves: i.saves ?? null,
      listings: i.listings ?? null,
    };
    const date = new Date(i.date);
    const old = await this.prisma.marketplaceStat.findUnique({ where: { storeId_date: { storeId, date } } });
    const { date: _d, ...values } = row;
    const r = old ? await this.prisma.marketplaceStat.update({ where: { id: old.id }, data: { ...values, source: 'MANUAL' } }) : await this.prisma.marketplaceStat.create({ data: { companyId: s.companyId, storeId, date, ...values, source: 'MANUAL' } });
    await this.audit.record('Marketplace Stat', r.id, old ? 'UPDATE' : 'CREATE', old ?? undefined, r);
    return { ...r, revenue: r.revenue === null ? null : n(r.revenue) };
  }

  async deleteStat(id: string) {
    RequestCtx.assert('marketplace.import');
    if (!UUID.test(id)) throw new NotFoundException('Not found');
    const r = await this.prisma.marketplaceStat.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!r) throw new NotFoundException('Not found');
    await this.prisma.marketplaceStat.delete({ where: { id } });
    await this.audit.record('Marketplace Stat', id, 'DELETE', r);
    return { ok: true };
  }

  async stats(q: { storeId?: string; from?: string; to?: string }) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : todayWib();
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : iso(new Date(new Date(to).getTime() - 89 * 86_400_000));
    const rows = await this.prisma.marketplaceStat.findMany({
      where: { companyId, ...(q.storeId && UUID.test(q.storeId) ? { storeId: q.storeId } : {}), date: { gte: new Date(from), lte: new Date(to) } },
      orderBy: [{ date: 'desc' }],
      include: { store: { select: { code: true, name: true, channel: true } } },
    });
    return { from, to, rows: rows.map((r) => ({ ...r, revenue: r.revenue === null ? null : n(r.revenue) })) };
  }

  // ================================================================ overview

  /**
   * One view of every channel: sales of the last N days per store (from the orders), the latest statistics with the
   * change since the snapshot before, what waits to be booked, and the setup issues.
   */
  async overview(days = 30) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    days = Math.min(365, Math.max(7, Math.round(days) || 30));
    const today = todayWib();
    const since = new Date(`${iso(new Date(new Date(today).getTime() - (days - 1) * 86_400_000))}T00:00:00+07:00`);
    const prevSince = new Date(since.getTime() - days * 86_400_000);
    const stores = await this.prisma.marketplaceStore.findMany({ where: { companyId, isActive: true }, orderBy: { code: 'asc' } });
    const ids = stores.map((s) => s.id);

    const currencies = [...new Set(stores.map((s) => s.currencyCode).filter((c) => c !== 'IDR'))];
    const rates = new Map<string, number>([['IDR', 1]]);
    for (const c of currencies) {
      const r = await this.prisma.exchangeRate.findFirst({ where: { companyId, currencyCode: c, deletedAt: null, date: { lte: new Date(today) } }, orderBy: { date: 'desc' } });
      if (r) rates.set(c, n(r.rate));
    }

    const [cur, prev, pending, payouts, lastStats, daily, top] = await Promise.all([
      this.prisma.marketplaceOrder.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, orderDate: { gte: since } }, _sum: { gross: true, fee: true, refunded: true, feeRefunded: true }, _count: true }),
      this.prisma.marketplaceOrder.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, orderDate: { gte: prevSince, lt: since } }, _sum: { gross: true, refunded: true }, _count: true }),
      this.prisma.marketplaceOrder.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, settlementId: null }, _sum: { gross: true }, _count: true }),
      this.prisma.marketplacePayout.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, status: 'PENDING' }, _sum: { amount: true }, _count: true }),
      this.prisma.$queryRaw<{ storeId: string; date: Date; rn: bigint; visits: number | null; views: number | null; followers: number | null; favorites: number | null; impressions: number | null; clicks: number | null; saves: number | null; orders: number | null; revenue: Prisma.Decimal | null; rangeLabel: string | null }[]>`
        SELECT * FROM (SELECT "storeId", date, visits, views, followers, favorites, impressions, clicks, saves, orders, revenue, "rangeLabel",
          ROW_NUMBER() OVER (PARTITION BY "storeId" ORDER BY date DESC) rn FROM marketplace_stats WHERE "companyId" = ${companyId}::uuid) x WHERE rn <= 2`,
      this.prisma.$queryRaw<{ day: string; storeId: string; gross: Prisma.Decimal; orders: bigint }[]>`
        SELECT to_char(("orderDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day, "storeId", SUM(gross - refunded) AS gross, COUNT(*) AS orders
        FROM marketplace_orders WHERE "companyId" = ${companyId}::uuid AND "orderDate" >= ${since} GROUP BY 1, 2 ORDER BY 1`,
      this.prisma.$queryRaw<{ listingId: string | null; title: string; storeId: string; qty: Prisma.Decimal; amount: Prisma.Decimal }[]>`
        SELECT ol."listingId", MIN(ol.title) AS title, o."storeId", SUM(ol.qty) AS qty, SUM(ol.amount) AS amount
        FROM marketplace_order_lines ol JOIN marketplace_orders o ON o.id = ol."orderId"
        WHERE o."companyId" = ${companyId}::uuid AND o."orderDate" >= ${since}
        GROUP BY ol."listingId", CASE WHEN ol."listingId" IS NULL THEN ol.title END, o."storeId" ORDER BY SUM(ol.amount) DESC LIMIT 10`,
    ]);

    const g = <T extends { storeId: string }>(rows: T[], id: string) => rows.find((r) => r.storeId === id);
    const toBase = (amount: number, ccy: string) => (rates.has(ccy) ? r2(amount * rates.get(ccy)!) : null);
    const channels = await Promise.all(
      stores.map(async (s) => {
        const c = g(cur, s.id);
        const p = g(prev, s.id);
        const st = lastStats.filter((x) => x.storeId === s.id).sort((a, b) => Number(a.rn) - Number(b.rn));
        const latest = st[0];
        const before = st[1];
        const metric = (k: 'visits' | 'views' | 'followers' | 'favorites' | 'impressions' | 'clicks' | 'saves' | 'orders') => (latest ? { value: latest[k], change: before && latest[k] !== null && before[k] !== null ? latest[k]! - before[k]! : null } : null);
        const revenue = r2(n(c?._sum.gross) - n(c?._sum.refunded));
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          channel: s.channel,
          kind: s.kind,
          url: s.url,
          currencyCode: s.currencyCode,
          lastSyncAt: s.lastSyncAt,
          sales:
            s.kind === 'STORE'
              ? {
                  orders: c?._count ?? 0,
                  revenue,
                  revenueBase: toBase(revenue, s.currencyCode),
                  fees: r2(n(c?._sum.fee) - n(c?._sum.feeRefunded)),
                  refunds: n(c?._sum.refunded),
                  prevOrders: p?._count ?? 0,
                  prevRevenue: r2(n(p?._sum.gross) - n(p?._sum.refunded)),
                  unposted: g(pending, s.id)?._count ?? 0,
                  unpostedGross: n(g(pending, s.id)?._sum.gross),
                  pendingPayouts: g(payouts, s.id)?._count ?? 0,
                  pendingPayoutAmount: n(g(payouts, s.id)?._sum.amount),
                }
              : null,
          stats: latest
            ? {
                date: iso(latest.date),
                previousDate: before ? iso(before.date) : null,
                rangeLabel: latest.rangeLabel,
                visits: metric('visits'),
                views: metric('views'),
                followers: metric('followers'),
                favorites: metric('favorites'),
                impressions: metric('impressions'),
                clicks: metric('clicks'),
                saves: metric('saves'),
                orders: metric('orders'),
                revenue: latest.revenue === null ? null : n(latest.revenue),
              }
            : null,
          issues: await this.readiness(s),
        };
      }),
    );

    // daily revenue in the company currency (stores without a rate are left out of the chart)
    const byDay = new Map<string, { day: string; revenue: number; orders: number }>();
    for (let t = since.getTime(); t <= new Date(`${today}T12:00:00+07:00`).getTime(); t += 86_400_000) {
      const day = iso(new Date(t + 7 * 3_600_000));
      byDay.set(day, { day, revenue: 0, orders: 0 });
    }
    const storeCcy = new Map(stores.map((s) => [s.id, s.currencyCode]));
    for (const d of daily) {
      const row = byDay.get(d.day);
      if (!row) continue;
      const base = toBase(n(d.gross), storeCcy.get(d.storeId) ?? 'IDR');
      row.revenue = r2(row.revenue + (base ?? 0));
      row.orders += Number(d.orders);
    }
    const storeCode = new Map(stores.map((s) => [s.id, s.code]));
    const totalBase = channels.reduce((a, c) => a + (c.sales?.revenueBase ?? 0), 0);
    return {
      days,
      from: iso(new Date(since.getTime() + 7 * 3_600_000)),
      to: today,
      rates: Object.fromEntries(rates),
      missingRates: currencies.filter((c) => !rates.has(c)),
      totals: {
        revenueBase: r2(totalBase),
        orders: channels.reduce((a, c) => a + (c.sales?.orders ?? 0), 0),
        prevOrders: channels.reduce((a, c) => a + (c.sales?.prevOrders ?? 0), 0),
        unposted: channels.reduce((a, c) => a + (c.sales?.unposted ?? 0), 0),
        pendingPayouts: channels.reduce((a, c) => a + (c.sales?.pendingPayouts ?? 0), 0),
        followers: channels.reduce((a, c) => a + (c.stats?.followers?.value ?? 0), 0),
      },
      channels,
      daily: [...byDay.values()],
      top: top.map((t) => ({ listingId: t.listingId, title: t.title, store: storeCode.get(t.storeId) ?? '', currencyCode: storeCcy.get(t.storeId) ?? 'IDR', qty: n(t.qty), amount: n(t.amount) })),
    };
  }
}
