import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { DocumentService } from '../documents/document.service';
import { PaymentService } from '../payments/payment.service';
import { JournalService } from '../accounting/journal.service';
import { MarketplaceService, todayWib } from './marketplace.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const settleSchema = z.object({
  /** orders up to and including this day (Jakarta time); also the posting date */
  to: day,
  /** company currency per unit of the store currency; empty = the exchange rate of the day */
  rate: z.coerce.number().positive().max(1e9).nullable().optional(),
});

const payoutSchema = z.object({
  date: day,
  amount: z.coerce.number().positive().max(1e12),
  amountBase: z.coerce.number().positive().max(1e14),
  fee: z.coerce.number().min(0).max(1e12).default(0),
  bankAccountId: z.uuid(),
  reference: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable().optional()),
});

interface ProductLine {
  productId: string;
  title: string;
  qty: number;
  amount: number;
  /** price before VAT, in the company currency */
  net: number;
}
interface Plan {
  store: Prisma.MarketplaceStoreGetPayload<object>;
  to: string;
  rate: number;
  orders: { id: string; externalId: string; gross: number; fee: number; refund: number; feeRefund: number }[];
  refunds: { id: string; externalId: string; refund: number; feeRefund: number }[];
  lines: ProductLine[];
  gross: number;
  sales: number;
  fees: number;
  refunds_: number;
  tax: { id: string; code: string; factor: number; accountId: string | null } | null;
  wht: { id: string; code: string; rate: number } | null;
  withheld: number;
  issues: string[];
}

/**
 * Booking of marketplace money.
 *
 * A settlement books the orders of a store up to a day:
 *  - one sales invoice to the customer standing for the marketplace, a line per product (prices taken as VAT-inclusive
 *    when the store has a VAT), confirmed: Dr Receivable / Cr Sales (+ VAT Out);
 *  - one customer receipt into the marketplace balance account settling it, with the PPh 22 the marketplace collects
 *    (PMK 37/2025) as tax withheld: Dr Marketplace Balance + Prepaid PPh 22 / Cr Receivable;
 *  - one journal for the fees and the refunds: Dr Marketplace Fees, Dr Sales Returns (+ VAT Out) / Cr Marketplace Balance.
 * A payout moves the balance to the bank: Dr Bank + Marketplace Fees (transfer / conversion) / Cr Marketplace Balance.
 */
@Injectable()
export class MarketplacePostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly docs: DocumentService,
    private readonly payments: PaymentService,
    private readonly journal: JournalService,
    private readonly stores: MarketplaceService,
  ) {}

  private async rateOf(companyId: string, ccy: string, to: string) {
    if (ccy === 'IDR') return 1;
    const r = await this.prisma.exchangeRate.findFirst({ where: { companyId, currencyCode: ccy, deletedAt: null, date: { lte: new Date(to) } }, orderBy: { date: 'desc' } });
    return r ? n(r.rate) : null;
  }

  private async plan(storeId: string, input: z.infer<typeof settleSchema>): Promise<Plan> {
    const store = await this.stores.store(storeId);
    if (store.kind !== 'STORE') throw new ConflictException('An audience-only channel has no orders to book');
    const issues: string[] = [];
    if (input.to > todayWib()) issues.push('The day cannot be in the future');
    const rate = input.rate ?? (await this.rateOf(store.companyId, store.currencyCode, input.to));
    if (!rate) issues.push(`No exchange rate for ${store.currencyCode} on or before ${input.to}: enter the rate, or add it in Master Data > Exchange Rates`);
    if (!store.customerId) issues.push('Choose the customer standing for the marketplace on the store (or use "Set up accounts")');
    if (!store.balanceBankAccountId) issues.push('Choose the marketplace balance account on the store (or use "Set up accounts")');

    const cutoff = new Date(`${input.to}T23:59:59.999+07:00`);
    const fresh = await this.prisma.marketplaceOrder.findMany({ where: { storeId, settlementId: null, orderDate: { lte: cutoff } }, include: { lines: { include: { listing: { select: { productId: true } } } } }, orderBy: { orderDate: 'asc' } });
    const late = await this.prisma.marketplaceOrder.findMany({
      where: { storeId, settlementId: { not: null }, OR: [{ refunded: { gt: this.prisma.marketplaceOrder.fields.refundBooked } }, { feeRefunded: { gt: this.prisma.marketplaceOrder.fields.feeRefundBooked } }] },
    });

    let tax: Plan['tax'] = null;
    if (store.taxId) {
      const t = await this.prisma.tax.findFirst({ where: { id: store.taxId, companyId: store.companyId, deletedAt: null } });
      if (t) tax = { id: t.id, code: t.code, factor: (n(t.rate) / 100) * (t.baseNumerator / t.baseDenominator), accountId: t.salesAccountId };
    }
    let wht: Plan['wht'] = null;
    if (store.whtTaxId) {
      const t = await this.prisma.tax.findFirst({ where: { id: store.whtTaxId, companyId: store.companyId, deletedAt: null } });
      if (t) wht = { id: t.id, code: t.code, rate: n(t.rate) };
    }
    const R = rate ?? 0;
    const products = new Map<string, ProductLine>();
    const unmapped = new Set<string>();
    const orders: Plan['orders'] = [];
    for (const o of fresh) {
      // a refund before the sale is booked is taken off the sale
      const kept = n(o.gross) - n(o.refunded);
      orders.push({ id: o.id, externalId: o.externalId, gross: n(o.gross), fee: n(o.fee), refund: n(o.refunded), feeRefund: n(o.feeRefunded) });
      if (kept <= 0) continue;
      const share = kept / n(o.gross);
      for (const l of o.lines) {
        const productId = l.listing?.productId ?? store.defaultProductId;
        if (!productId) {
          unmapped.add(l.title);
          continue;
        }
        const p = products.get(productId) ?? { productId, title: l.title, qty: 0, amount: 0, net: 0 };
        // a part-refunded order counts its amount but not its quantity
        if (share >= 1) p.qty += n(l.qty);
        p.amount += n(l.amount) * share;
        products.set(productId, p);
      }
    }
    if (unmapped.size) issues.push(`Map these listings to a product, or set a default product: ${[...unmapped].slice(0, 5).join('; ')}${unmapped.size > 5 ? '…' : ''}`);
    // part-refunded lines keep a quantity of 1 so the invoice line is never empty
    const lines = [...products.values()].map((p) => {
      const base = r2(p.amount * R);
      return { ...p, qty: p.qty > 0 ? p.qty : 1, amount: base, net: tax ? r2(base / (1 + tax.factor)) : base };
    });
    const names = new Map((await this.prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, code: true, name: true, type: true } })).map((p) => [p.id, p]));
    for (const l of lines) {
      const p = names.get(l.productId);
      if (p) l.title = `${p.code} ${p.name}`;
      if (p?.type === 'STOCK') issues.push(`${p.code} ${p.name} is a stock item: marketplace sales are booked as services or digital products. Choose a service product.`);
    }
    const refunds = late.map((o) => ({ id: o.id, externalId: o.externalId, refund: r2(n(o.refunded) - n(o.refundBooked)), feeRefund: r2(n(o.feeRefunded) - n(o.feeRefundBooked)) }));
    const gross = r2(lines.reduce((a, l) => a + l.amount, 0));
    const sales = r2(lines.reduce((a, l) => a + l.net, 0));
    const fees = r2(orders.reduce((a, o) => a + (o.fee - o.feeRefund), 0) * R);
    const refunds_ = r2(refunds.reduce((a, o) => a + o.refund, 0) * R);
    const withheld = wht ? r2((sales * wht.rate) / 100) : 0;
    if (!orders.length && !refunds.length) issues.push(`No orders or refunds to book up to ${input.to}`);
    return { store, to: input.to, rate: R, orders, refunds, lines, gross, sales, fees, refunds_, tax, wht, withheld, issues };
  }

  private summary(p: Plan) {
    return {
      store: { id: p.store.id, code: p.store.code, name: p.store.name, currencyCode: p.store.currencyCode },
      to: p.to,
      rate: p.rate,
      orders: p.orders.length,
      refundsLater: p.refunds.length,
      lines: p.lines.map((l) => ({ productId: l.productId, title: l.title, qty: l.qty, amount: l.amount, net: l.net })),
      gross: p.gross,
      sales: p.sales,
      vat: r2(p.gross - p.sales),
      tax: p.tax ? p.tax.code : null,
      withheld: p.withheld,
      wht: p.wht ? p.wht.code : null,
      fees: p.fees,
      refunds: p.refunds_,
      /** what the marketplace balance grows by */
      net: r2(p.gross - p.withheld - p.fees - p.refunds_),
      issues: p.issues,
      canPost: !p.issues.length && RequestCtx.can('marketplace.post'),
    };
  }

  async preview(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.read');
    return this.summary(await this.plan(storeId, settleSchema.parse(body)));
  }

  async settle(storeId: string, body: unknown) {
    RequestCtx.assert('marketplace.post');
    const input = settleSchema.parse(body);
    const p = await this.plan(storeId, input);
    if (p.issues.length) throw new ConflictException(`Cannot book the settlement yet: ${p.issues.join('; ')}`);
    if (p.lines.length) {
      RequestCtx.assert('sales.invoice.create');
      RequestCtx.assert('sales.payment.create');
    }
    const s = p.store;
    const u = RequestCtx.user();
    const date = new Date(p.to);
    const number = await this.sequence.next('MP_SETTLEMENT', s.companyId, date);
    const balance = await this.prisma.bankAccount.findFirst({ where: { id: s.balanceBankAccountId!, companyId: s.companyId, deletedAt: null } });
    if (!balance?.accountId) throw new BadRequestException('The marketplace balance account has no ledger account');
    const note = `${s.name} marketplace orders up to ${p.to} (${number})`;

    // 1. invoice and receipt (their own transactions, undone if a later step fails)
    let invoiceId: string | null = null;
    let receiptId: string | null = null;
    try {
      if (p.lines.length) {
        const inv = await this.docs.create(
          'SI',
          {
            date: p.to,
            dueDate: p.to,
            customerId: s.customerId,
            reference: number,
            notes: `${note}. ${p.orders.length} order(s)${p.store.currencyCode !== 'IDR' ? `, ${s.currencyCode} at ${p.rate}` : ''}. Paid through the marketplace.`,
            lines: p.lines.map((l) => {
              // a price that does not divide to the cent is invoiced as one line of the whole amount
              const unit = r2(l.net / l.qty);
              const exact = r2(unit * l.qty) === l.net;
              return {
                productId: l.productId,
                description: `${exact ? '' : `${l.qty} x `}${l.title} - ${s.name}`.slice(0, 1000),
                qty: exact ? l.qty : 1,
                unitPrice: exact ? unit : l.net,
                taxId: p.tax?.id ?? null,
              };
            }),
          },
          undefined,
          { skipPermission: true },
        );
        invoiceId = inv.id;
        await this.docs.confirm('SI', inv.id, { skipPermission: true });
        const fresh = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: inv.id }, select: { grandTotal: true, subtotal: true, discountTotal: true } });
        const total = n(fresh.grandTotal);
        // tax base of the PPh 22: the turnover before VAT
        const base = r2(n(fresh.subtotal) - n(fresh.discountTotal)) || p.sales;
        const withheld = p.wht ? r2((base * p.wht.rate) / 100) : 0;
        const rec = await this.payments.create('IN', {
          date: p.to,
          partnerId: s.customerId,
          bankAccountId: s.balanceBankAccountId,
          amount: r2(total - withheld),
          reference: number,
          notes: `Collected by ${s.name}`,
          allocations: [{ documentId: inv.id, amount: total }],
          ...(p.wht && withheld > 0 ? { whtTaxId: p.wht.id, whtBase: base, whtAmount: withheld, whtSlipNo: number } : {}),
        });
        receiptId = rec.id;
        p.withheld = withheld;
        p.gross = total;
      }

      // 2. settlement, fees and refunds journal, orders marked: one transaction
      return await this.prisma.$transaction(
        async (tx) => {
          const st = await tx.marketplaceSettlement.create({
            data: {
              companyId: s.companyId,
              storeId: s.id,
              number,
              date,
              rate: p.rate,
              orders: p.orders.length,
              gross: p.gross,
              fees: p.fees,
              withheld: p.withheld,
              refunds: p.refunds_,
              invoiceId,
              receiptId,
              status: 'POSTED',
              detail: { lines: p.lines, orders: p.orders, refunds: p.refunds, tax: p.tax?.code ?? null, wht: p.wht?.code ?? null } as unknown as Prisma.InputJsonValue,
              createdById: u.id,
            },
          });
          const lines: Parameters<JournalService['post']>[1]['lines'] = [];
          if (p.fees) lines.push({ key: 'MARKETPLACE_FEES', debit: D(p.fees), description: `${s.name} fees and commissions` }, { accountId: balance.accountId, credit: D(p.fees) });
          if (p.refunds_) {
            const vat = p.tax?.accountId ? r2(p.refunds_ - p.refunds_ / (1 + p.tax.factor)) : 0;
            lines.push({ key: 'SALES_RETURN', debit: D(r2(p.refunds_ - vat)), description: `${s.name} refunds of orders booked before` });
            if (vat) lines.push({ accountId: p.tax!.accountId, debit: D(vat), description: `VAT on refunds (${p.tax!.code})` });
            lines.push({ accountId: balance.accountId, credit: D(p.refunds_) });
          }
          if (lines.length) await this.journal.post(tx, { companyId: s.companyId, branchId: u.branchId, date, description: `Marketplace settlement ${number} - ${s.name}: fees and refunds`, reference: number, sourceType: 'MP_SETTLEMENT', sourceId: st.id, lines });
          for (const o of p.orders) await tx.marketplaceOrder.update({ where: { id: o.id }, data: { settlementId: st.id, refundBooked: o.refund, feeRefundBooked: o.feeRefund } });
          for (const o of p.refunds) await tx.marketplaceOrder.update({ where: { id: o.id }, data: { refundBooked: { increment: o.refund }, feeRefundBooked: { increment: o.feeRefund } } });
          await this.audit.record('Marketplace Settlement', st.id, 'POST', undefined, { number, store: s.code, orders: p.orders.length, gross: p.gross, fees: p.fees, refunds: p.refunds_, withheld: p.withheld, invoiceId, receiptId }, tx);
          return { id: st.id, number, invoiceId, receiptId, gross: p.gross, fees: p.fees, refunds: p.refunds_, withheld: p.withheld, orders: p.orders.length };
        },
        { timeout: 60_000 },
      );
    } catch (e) {
      // undo the documents made so far
      if (receiptId) await this.payments.cancel('IN', receiptId, { fromModule: true }).catch(() => undefined);
      if (invoiceId) {
        const d = await this.prisma.tradeDocument.findUnique({ where: { id: invoiceId }, select: { status: true } });
        if (d?.status === 'DRAFT') await this.prisma.tradeDocument.update({ where: { id: invoiceId }, data: { deletedAt: new Date() } }).catch(() => undefined);
        else if (d && d.status !== 'CANCELLED') await this.docs.cancel('SI', invoiceId, { skipPermission: true }).catch(() => undefined);
      }
      throw e;
    }
  }

  /** Undo the latest settlement of a store: receipt and invoice cancelled, journal voided, orders free again */
  async undo(id: string) {
    RequestCtx.assert('marketplace.post');
    if (!UUID.test(id)) throw new NotFoundException('Settlement not found');
    const st = await this.prisma.marketplaceSettlement.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!st) throw new NotFoundException('Settlement not found');
    if (st.status !== 'POSTED') throw new ConflictException('The settlement is already cancelled');
    const later = await this.prisma.marketplaceSettlement.findFirst({ where: { storeId: st.storeId, status: 'POSTED', createdAt: { gt: st.createdAt } }, select: { number: true } });
    if (later) throw new ConflictException(`Undo the later settlement ${later.number} first`);
    if (st.invoiceId) {
      const inv = await this.prisma.tradeDocument.findUnique({ where: { id: st.invoiceId }, select: { status: true, number: true } });
      const others = await this.prisma.paymentAllocation.count({ where: { documentId: st.invoiceId, payment: { status: { not: 'CANCELLED' }, id: st.receiptId ? { not: st.receiptId } : undefined } } });
      if (others) throw new ConflictException(`Invoice ${inv?.number} has other payments: cancel them first`);
      if (st.receiptId) RequestCtx.assert('sales.payment.cancel');
      RequestCtx.assert('sales.invoice.cancel');
    }
    if (st.receiptId) {
      const r = await this.prisma.payment.findUnique({ where: { id: st.receiptId }, select: { status: true } });
      if (r && r.status !== 'CANCELLED') await this.payments.cancel('IN', st.receiptId, { fromModule: true });
    }
    if (st.invoiceId) {
      const d = await this.prisma.tradeDocument.findUnique({ where: { id: st.invoiceId }, select: { status: true } });
      if (d && d.status !== 'CANCELLED') await this.docs.cancel('SI', st.invoiceId, { skipPermission: true });
    }
    const detail = st.detail as unknown as Plan;
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'MP_SETTLEMENT', st.id);
      await tx.marketplaceOrder.updateMany({ where: { settlementId: st.id }, data: { settlementId: null, refundBooked: 0, feeRefundBooked: 0 } });
      for (const o of detail.refunds ?? []) await tx.marketplaceOrder.update({ where: { id: o.id }, data: { refundBooked: { decrement: o.refund }, feeRefundBooked: { decrement: o.feeRefund } } }).catch(() => undefined);
      await tx.marketplaceSettlement.update({ where: { id: st.id }, data: { status: 'CANCELLED' } });
      await this.audit.record('Marketplace Settlement', st.id, 'UNDO', { number: st.number }, undefined, tx);
    });
    return { ok: true };
  }

  async settlements(storeId?: string) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.marketplaceSettlement.findMany({ where: { companyId, ...(storeId && UUID.test(storeId) ? { storeId } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200, include: { store: { select: { code: true, name: true, currencyCode: true } } } });
    const docs = new Map(
      (await this.prisma.tradeDocument.findMany({ where: { id: { in: rows.map((r) => r.invoiceId!).filter(Boolean) } }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]),
    );
    const pays = new Map((await this.prisma.payment.findMany({ where: { id: { in: rows.map((r) => r.receiptId!).filter(Boolean) } }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: iso(r.date),
      store: r.store,
      storeId: r.storeId,
      rate: n(r.rate),
      orders: r.orders,
      gross: n(r.gross),
      fees: n(r.fees),
      withheld: n(r.withheld),
      refunds: n(r.refunds),
      net: r2(n(r.gross) - n(r.withheld) - n(r.fees) - n(r.refunds)),
      status: r.status,
      invoice: r.invoiceId ? (docs.get(r.invoiceId) ?? null) : null,
      receipt: r.receiptId ? (pays.get(r.receiptId) ?? null) : null,
      detail: r.detail,
    }));
  }

  // ================================================================ payouts

  async payouts(storeId?: string) {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.marketplacePayout.findMany({ where: { companyId, ...(storeId && UUID.test(storeId) ? { storeId } : {}) }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200, include: { store: { select: { code: true, name: true, currencyCode: true } } } });
    const banks = new Map((await this.prisma.bankAccount.findMany({ where: { id: { in: rows.map((r) => r.bankAccountId!).filter(Boolean) } }, select: { id: true, code: true, name: true } })).map((b) => [b.id, b]));
    return rows.map((r) => ({ ...r, date: iso(r.date), amount: n(r.amount), amountBase: n(r.amountBase), fee: n(r.fee), bank: r.bankAccountId ? (banks.get(r.bankAccountId) ?? null) : null }));
  }

  /**
   * Money balance per store: what settlements put in the marketplace balance minus the payouts booked,
   * in the company currency.
   */
  async balances() {
    RequestCtx.assert('marketplace.read');
    const companyId = RequestCtx.companyId();
    const [st, po, stores] = await Promise.all([
      this.prisma.marketplaceSettlement.groupBy({ by: ['storeId'], where: { companyId, status: 'POSTED' }, _sum: { gross: true, withheld: true, fees: true, refunds: true } }),
      this.prisma.marketplacePayout.groupBy({ by: ['storeId'], where: { companyId, status: 'POSTED' }, _sum: { amountBase: true, fee: true } }),
      this.prisma.marketplaceStore.findMany({ where: { companyId, kind: 'STORE' }, select: { id: true, code: true, name: true, currencyCode: true } }),
    ]);
    return stores.map((s) => {
      const a = st.find((x) => x.storeId === s.id)?._sum;
      const b = po.find((x) => x.storeId === s.id)?._sum;
      const credited = r2(n(a?.gross) - n(a?.withheld) - n(a?.fees) - n(a?.refunds));
      const paidOut = r2(n(b?.amountBase) + n(b?.fee));
      return { ...s, credited, paidOut, balance: r2(credited - paidOut) };
    });
  }

  /** Books a payout (a new one, or one read from the marketplace and waiting) */
  async postPayout(storeId: string, body: unknown, payoutId?: string) {
    RequestCtx.assert('marketplace.post');
    const s = await this.stores.store(storeId);
    if (s.kind !== 'STORE') throw new ConflictException('An audience-only channel has no payouts');
    const i = payoutSchema.parse(body);
    if (i.date > todayWib()) throw new BadRequestException({ message: 'Validation failed', errors: { date: 'Cannot be in the future' } });
    if (!s.balanceBankAccountId) throw new ConflictException('Choose the marketplace balance account on the store first');
    if (i.bankAccountId === s.balanceBankAccountId) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'Choose the bank the money arrived in' } });
    const [bank, balance] = await Promise.all([
      this.prisma.bankAccount.findFirst({ where: { id: i.bankAccountId, companyId: s.companyId, deletedAt: null } }),
      this.prisma.bankAccount.findFirst({ where: { id: s.balanceBankAccountId, companyId: s.companyId, deletedAt: null } }),
    ]);
    if (!bank?.accountId) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'Bank account not found or without a ledger account' } });
    if (!balance?.accountId) throw new BadRequestException('The marketplace balance account has no ledger account');
    if (s.currencyCode === 'IDR' && r2(i.amountBase + i.fee) !== r2(i.amount)) throw new BadRequestException({ message: 'Validation failed', errors: { amountBase: 'Received + fee must equal the payout amount' } });
    const u = RequestCtx.user();
    const date = new Date(i.date);
    return this.prisma.$transaction(async (tx) => {
      let row;
      if (payoutId) {
        if (!UUID.test(payoutId)) throw new NotFoundException('Payout not found');
        const old = await tx.marketplacePayout.findFirst({ where: { id: payoutId, storeId } });
        if (!old) throw new NotFoundException('Payout not found');
        if (old.status !== 'PENDING') throw new ConflictException('The payout is already booked or cancelled');
        row = await tx.marketplacePayout.update({ where: { id: payoutId }, data: { date, amount: i.amount, amountBase: i.amountBase, fee: i.fee, bankAccountId: bank.id, reference: i.reference ?? old.reference, status: 'POSTED' } });
      } else {
        row = await tx.marketplacePayout.create({ data: { companyId: s.companyId, storeId, date, amount: i.amount, amountBase: i.amountBase, fee: i.fee, bankAccountId: bank.id, reference: i.reference ?? null, status: 'POSTED', source: 'MANUAL', createdById: u.id } });
      }
      await this.journal.post(tx, {
        companyId: s.companyId,
        branchId: u.branchId,
        date,
        description: `Payout from ${s.name}: ${s.currencyCode} ${i.amount}`,
        reference: i.reference ?? undefined,
        sourceType: 'MP_PAYOUT',
        sourceId: row.id,
        lines: [
          { accountId: bank.accountId, debit: round(D(i.amountBase)) },
          ...(i.fee ? [{ key: 'MARKETPLACE_FEES', debit: round(D(i.fee)), description: 'Payout transfer / conversion fee' }] : []),
          { accountId: balance.accountId, credit: round(D(i.amountBase + i.fee)) },
        ],
      });
      await this.audit.record('Marketplace Payout', row.id, 'POST', undefined, row, tx);
      return { ...row, amount: n(row.amount), amountBase: n(row.amountBase), fee: n(row.fee) };
    });
  }

  async cancelPayout(id: string) {
    RequestCtx.assert('marketplace.post');
    if (!UUID.test(id)) throw new NotFoundException('Payout not found');
    const p = await this.prisma.marketplacePayout.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!p) throw new NotFoundException('Payout not found');
    if (p.status === 'CANCELLED') throw new ConflictException('The payout is already cancelled');
    return this.prisma.$transaction(async (tx) => {
      if (p.status === 'POSTED') await this.journal.voidBySource(tx, 'MP_PAYOUT', id);
      // a payout read from the marketplace goes back to waiting; a typed one is cancelled
      const r = await tx.marketplacePayout.update({ where: { id }, data: { status: p.source === 'API' && p.status === 'POSTED' ? 'PENDING' : 'CANCELLED' } });
      await this.audit.record('Marketplace Payout', id, 'CANCEL', p, r, tx);
      return { ok: true, status: r.status };
    });
  }
}
