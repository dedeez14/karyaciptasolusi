import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';
import { exportCharges, position, qualityClaim, type ClaimRules, type Spec } from './commodity-calc';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const pct = (max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const contractSchema = z.object({
  buyerRef: optText(60),
  date: z.coerce.date(),
  customerId: z.uuid(),
  productId: z.uuid(),
  market: z.enum(['DOMESTIC', 'EXPORT']),
  channel: z.enum(['DIRECT', 'TENDER']).default('DIRECT'),
  incoterm: z.enum(['FRANCO', 'LOCO', 'FOB', 'CFR', 'CIF']),
  deliveryPoint: optText(150),
  qtyKg: z.coerce.number().positive().max(1e10),
  tolerancePct: z.coerce.number().min(0).max(20).default(0),
  currencyCode: z.string().trim().length(3).default('IDR'),
  price: z.coerce.number().positive().max(1e9),
  priceUnit: z.enum(['KG', 'MT']).default('KG'),
  taxId: optUuid,
  deliveryFrom: optDate,
  deliveryTo: optDate,
  spec: z.object({ ffaMax: pct(100), miMax: pct(100), dobiMin: pct(10) }).partial().default({}),
  claims: z.object({ ffaRatePct: pct(100), miDeductWeight: z.boolean().nullable().optional(), dobiRatePct: pct(100) }).partial().default({}),
  paymentTerms: optText(150),
  notes: optText(2000),
});
export const deliverySchema = z.object({
  date: z.coerce.date(),
  warehouseId: z.uuid(),
  vehicle: optText(60),
  sealNo: optText(60),
  qtyKg: z.coerce.number().positive().max(1e9),
  ffa: pct(100),
  mi: pct(100),
  dobi: pct(10),
  shipmentId: optUuid,
  notes: optText(500),
});
export const invoiceSchema = z.object({ deliveryIds: z.array(z.uuid()).min(1).max(500), date: z.coerce.date().optional(), exchangeRate: optNum });
export const referenceSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  productId: z.uuid(),
  refPriceUsd: z.coerce.number().positive().max(1e6),
  dutyUsdPerMt: z.coerce.number().min(0).max(1e6).default(0),
  levyPct: pct(100),
  levyUsdPerMt: optNum,
  reference: optText(200),
});
export const shipmentSchema = z.object({
  contractId: z.uuid(),
  vessel: optText(100),
  blNo: optText(60),
  blDate: optDate,
  portOfLoading: optText(100),
  portOfDischarge: optText(100),
  destinationCountry: optText(3),
  hsCode: optText(12),
  surveyorReport: optText(60),
  originCertificate: optText(60),
  sustainabilityRef: optText(100),
  eudrRef: optText(100),
  notes: optText(2000),
});
export const shipSchema = z.object({ pebNo: z.string().trim().min(1).max(40), pebDate: z.coerce.date(), npeNo: optText(40), npeDate: optDate, rate: optNum, fobUsd: optNum, dutyBilling: optText(60), levyBilling: optText(60) });
export const dheSchema = z.object({ dheReceivedDate: optDate, dheReceivedUsd: optNum, dheBank: optText(100), dheRetainedUsd: optNum, dheRetainUntil: optDate });

type Contract = Prisma.CommodityContractGetPayload<object>;

/**
 * Bulk commodity sales (CPO, palm kernel...):
 * - contracts: domestic (direct or KPBN tender, Franco / Loco, PPN) or export (FOB / CFR / CIF, foreign currency);
 * - deliveries from the tanks: a confirmed delivery order takes the stock out at cost; quality above the contract limits
 *   gives the claim (price cut for FFA / DOBI, weight cut for moisture & impurities); invoiced in batches;
 * - export shipments: PEB, vessel, B/L, surveyor report, certificates; export duty and levy from the reference price of
 *   the month booked as costs payable; export proceeds (DHE) received and retained.
 */
@Injectable()
export class CommodityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly documents: DocumentService,
  ) {}

  private async contractOwn(id: string): Promise<Contract> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Contract not found');
    const c = await this.prisma.commodityContract.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  private async liveDocs(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, { id: string; number: string; status: string }>();
    return new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: list }, deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]));
  }

  /** rate of a currency on a date from Accounting > Exchange rates (latest on or before the date) */
  private async rateOn(currency: string, date: Date) {
    if (currency === 'IDR') return 1;
    const r = await this.prisma.exchangeRate.findFirst({ where: { companyId: RequestCtx.companyId(), currencyCode: currency, date: { lte: date }, deletedAt: null }, orderBy: { date: 'desc' } });
    return r ? n(r.rate) : null;
  }

  // ================================================================ contracts
  async contracts(q: { status?: string; market?: string }) {
    RequestCtx.assert('commodity.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.commodityContract.findMany({ where: { companyId, ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }), ...(q.market ? { market: q.market } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 500 });
    const delivered = await this.prisma.commodityDelivery.groupBy({ by: ['contractId'], where: { companyId, status: 'POSTED', contractId: { in: rows.map((r) => r.id) } }, _sum: { qtyKg: true, amount: true } });
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const prod = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((c) => {
      const d = delivered.find((x) => x.contractId === c.id);
      const kg = n(d?._sum.qtyKg);
      return { ...this.out(c), customer: cust.get(c.customerId) ?? '', product: prod.get(c.productId) ?? '', deliveredKg: kg, deliveredAmount: n(d?._sum.amount), ...position(n(c.qtyKg), n(c.tolerancePct), kg) };
    });
  }

  private out(c: Contract) {
    return { ...c, qtyKg: n(c.qtyKg), tolerancePct: n(c.tolerancePct), price: n(c.price), spec: (c.spec ?? {}) as Spec, claims: (c.claims ?? {}) as ClaimRules };
  }

  async contract(id: string) {
    RequestCtx.assert('commodity.read');
    const c = await this.contractOwn(id);
    const [deliveries, shipments, customer, product, tax] = await Promise.all([
      this.prisma.commodityDelivery.findMany({ where: { contractId: c.id }, orderBy: [{ date: 'desc' }, { number: 'desc' }] }),
      this.prisma.exportShipment.findMany({ where: { contractId: c.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, code: true, name: true } }),
      this.prisma.product.findUnique({ where: { id: c.productId }, select: { id: true, code: true, name: true, hsCode: true } }),
      c.taxId ? this.prisma.tax.findUnique({ where: { id: c.taxId }, select: { id: true, code: true, name: true } }) : null,
    ]);
    const docs = await this.liveDocs([...deliveries.map((d) => d.invoiceDocId), ...deliveries.map((d) => d.deliveryDocId)]);
    const warehouses = new Map((await this.prisma.warehouse.findMany({ where: { id: { in: deliveries.map((d) => d.warehouseId) } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
    const posted = deliveries.filter((d) => d.status === 'POSTED');
    const kg = posted.reduce((a, d) => a + n(d.qtyKg), 0);
    return {
      ...this.out(c),
      customer,
      product,
      tax,
      ...position(n(c.qtyKg), n(c.tolerancePct), kg),
      deliveredKg: kg,
      invoicedKg: posted.filter((d) => d.invoiceDocId && docs.has(d.invoiceDocId)).reduce((a, d) => a + n(d.invoiceKg), 0),
      claimKg: posted.reduce((a, d) => a + n(d.claimKg), 0),
      amount: posted.reduce((a, d) => a + n(d.amount), 0),
      deliveries: deliveries.map((d) => ({
        ...d,
        qtyKg: n(d.qtyKg),
        ffa: d.ffa === null ? null : n(d.ffa),
        mi: d.mi === null ? null : n(d.mi),
        dobi: d.dobi === null ? null : n(d.dobi),
        claimPct: n(d.claimPct),
        claimKg: n(d.claimKg),
        invoiceKg: n(d.invoiceKg),
        unitPrice: n(d.unitPrice),
        amount: n(d.amount),
        warehouse: warehouses.get(d.warehouseId) ?? '',
        delivery: d.deliveryDocId ? docs.get(d.deliveryDocId) ?? null : null,
        invoice: d.invoiceDocId ? docs.get(d.invoiceDocId) ?? null : null,
      })),
      shipments: shipments.map((s) => this.shipmentOut(s)),
    };
  }

  async saveContract(id: string | null, input: z.infer<typeof contractSchema>) {
    RequestCtx.assert('commodity.contract.manage');
    const u = RequestCtx.user();
    const [cust, prod] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }),
    ]);
    if (!cust) throw invalid({ customerId: 'Customer not found' });
    if (!prod || prod.type !== 'STOCK') throw invalid({ productId: 'Choose a stock product (CPO, kernel...)' });
    if (input.market === 'EXPORT' && !['FOB', 'CFR', 'CIF'].includes(input.incoterm)) throw invalid({ incoterm: 'Export terms are FOB, CFR or CIF' });
    if (input.market === 'DOMESTIC' && !['FRANCO', 'LOCO'].includes(input.incoterm)) throw invalid({ incoterm: 'Domestic deliveries are Franco (delivered) or Loco (collected)' });
    if (input.market === 'EXPORT' && input.taxId) throw invalid({ taxId: 'Exports carry no PPN (0%): the PEB is the tax document' });
    if (input.taxId && !(await this.prisma.tax.findFirst({ where: { id: input.taxId, companyId: u.companyId, kind: 'VAT', deletedAt: null } }))) throw invalid({ taxId: 'Choose a PPN code' });
    if (input.currencyCode !== 'IDR' && !(await this.prisma.currency.findUnique({ where: { code: input.currencyCode } }))) throw invalid({ currencyCode: 'Unknown currency' });
    if (input.deliveryFrom && input.deliveryTo && input.deliveryTo < input.deliveryFrom) throw invalid({ deliveryTo: 'Before the start' });
    const data = {
      buyerRef: input.buyerRef ?? null,
      date: input.date,
      customerId: cust.id,
      productId: prod.id,
      market: input.market,
      channel: input.channel,
      incoterm: input.incoterm,
      deliveryPoint: input.deliveryPoint ?? null,
      qtyKg: D(input.qtyKg),
      tolerancePct: D(input.tolerancePct),
      currencyCode: input.currencyCode,
      price: D(input.price),
      priceUnit: input.priceUnit,
      taxId: input.taxId ?? null,
      deliveryFrom: input.deliveryFrom ?? null,
      deliveryTo: input.deliveryTo ?? null,
      spec: input.spec as Prisma.InputJsonValue,
      claims: input.claims as Prisma.InputJsonValue,
      paymentTerms: input.paymentTerms ?? null,
      notes: input.notes ?? null,
      updatedById: u.id,
    };
    let row: Contract;
    if (id) {
      const before = await this.contractOwn(id);
      if (before.status !== 'OPEN') throw new ConflictException('The contract is closed');
      const used = await this.prisma.commodityDelivery.count({ where: { contractId: id, status: 'POSTED' } });
      if (used && (before.customerId !== data.customerId || before.productId !== data.productId || before.currencyCode !== data.currencyCode || before.priceUnit !== data.priceUnit || before.market !== data.market))
        throw new ConflictException('Goods were delivered: the buyer, product, market, currency and price unit cannot change');
      row = await this.prisma.commodityContract.update({ where: { id }, data });
    } else {
      row = await this.prisma.$transaction(async (tx) => tx.commodityContract.create({ data: { ...data, companyId: u.companyId, branchId: u.branchId ?? null, number: await this.sequence.next('COMMODITY_CONTRACT', u.companyId, input.date, tx), createdById: u.id } }));
    }
    await this.audit.record('Commodity Contract', row.id, id ? 'UPDATE' : 'CREATE', undefined, { number: row.number, qtyKg: input.qtyKg, price: input.price });
    return this.contract(row.id);
  }

  async setStatus(id: string, status: 'OPEN' | 'COMPLETED' | 'CANCELLED') {
    RequestCtx.assert('commodity.contract.manage');
    const c = await this.contractOwn(id);
    if (status === 'CANCELLED' && (await this.prisma.commodityDelivery.count({ where: { contractId: id, status: 'POSTED' } }))) throw new ConflictException('Goods were delivered on this contract: complete it instead');
    if (c.status === 'CANCELLED') throw new ConflictException('The contract is cancelled');
    await this.prisma.commodityContract.update({ where: { id }, data: { status, updatedById: RequestCtx.user().id } });
    await this.audit.record('Commodity Contract', id, status);
    return this.contract(id);
  }

  // ================================================================ deliveries
  /** quality claim preview for the delivery form */
  async previewDelivery(contractId: string, q: { qtyKg: number; ffa?: number | null; mi?: number | null; dobi?: number | null }) {
    RequestCtx.assert('commodity.read');
    const c = await this.contractOwn(contractId);
    const r = qualityClaim(q.qtyKg, n(c.price), q, (c.spec ?? {}) as Spec, (c.claims ?? {}) as ClaimRules);
    return { ...r, amount: this.amount(c, r.invoiceKg, r.unitPrice) };
  }

  private amount(c: Contract, kg: number, unitPrice: number) {
    return Math.round((c.priceUnit === 'MT' ? kg / 1000 : kg) * unitPrice * 100) / 100;
  }

  /**
   * Goods loaded for the contract: the delivery order is confirmed at once (stock out of the tank at cost, Dr COGS / Cr
   * Inventory) and the quality claim fixes the invoiced weight and price.
   */
  async createDelivery(contractId: string, input: z.infer<typeof deliverySchema>) {
    RequestCtx.assert('commodity.deliver');
    const u = RequestCtx.user();
    const c = await this.contractOwn(contractId);
    if (c.status !== 'OPEN') throw new ConflictException('The contract is not open');
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    if (input.date < c.date) throw invalid({ date: 'Before the contract date' });
    if (!(await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ warehouseId: 'Warehouse not found' });
    if (c.market === 'EXPORT') {
      if (!input.shipmentId) throw invalid({ shipmentId: 'Choose the export shipment (vessel) it is loaded on' });
      const s = await this.prisma.exportShipment.findFirst({ where: { id: input.shipmentId, contractId: c.id } });
      if (!s) throw invalid({ shipmentId: 'Shipment not found on this contract' });
      if (s.status !== 'DRAFT') throw invalid({ shipmentId: 'The shipment has sailed (PEB recorded)' });
    } else if (input.shipmentId) throw invalid({ shipmentId: 'Only for export contracts' });
    const done = await this.prisma.commodityDelivery.aggregate({ where: { contractId: c.id, status: 'POSTED' }, _sum: { qtyKg: true } });
    const pos = position(n(c.qtyKg), n(c.tolerancePct), n(done._sum.qtyKg));
    if (input.qtyKg > pos.canDeliverKg + 0.001) throw invalid({ qtyKg: `Only ${pos.canDeliverKg.toLocaleString('en-US')} kg left on the contract (with its tolerance)` });
    const r = qualityClaim(input.qtyKg, n(c.price), input, (c.spec ?? {}) as Spec, (c.claims ?? {}) as ClaimRules);
    const amount = this.amount(c, r.invoiceKg, r.unitPrice);
    const number = await this.prisma.$transaction((tx) => this.sequence.next('COMMODITY_DELIVERY', u.companyId, input.date, tx));
    const doc = (await this.documents.create(
      'DO',
      {
        date: input.date,
        customerId: c.customerId,
        warehouseId: input.warehouseId,
        reference: c.buyerRef ?? c.number,
        notes: `${number} on contract ${c.number}${c.buyerRef ? ` (${c.buyerRef})` : ''}${input.vehicle ? `, ${input.vehicle}` : ''}${input.sealNo ? `, seal ${input.sealNo}` : ''}. Quality: FFA ${input.ffa ?? '-'}%, M&I ${input.mi ?? '-'}%, DOBI ${input.dobi ?? '-'}.`,
        lines: [{ productId: c.productId, qty: input.qtyKg }],
      },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    try {
      await this.documents.confirm('DO', doc.id, { skipPermission: true });
    } catch (e) {
      await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      throw e;
    }
    const row = await this.prisma.commodityDelivery.create({
      data: {
        companyId: u.companyId,
        contractId: c.id,
        number,
        date: input.date,
        warehouseId: input.warehouseId,
        vehicle: input.vehicle ?? null,
        sealNo: input.sealNo ?? null,
        qtyKg: D(input.qtyKg),
        ffa: input.ffa ?? null,
        mi: input.mi ?? null,
        dobi: input.dobi ?? null,
        claimPct: D(r.claimPct),
        claimKg: D(r.claimKg),
        invoiceKg: D(r.invoiceKg),
        unitPrice: D(r.unitPrice),
        amount: D(amount),
        shipmentId: input.shipmentId ?? null,
        deliveryDocId: doc.id,
        notes: input.notes ?? null,
        createdById: u.id,
      },
    });
    if (input.shipmentId) await this.syncShipmentQty(input.shipmentId);
    await this.audit.record('Commodity Delivery', row.id, 'CREATE', undefined, { number, qtyKg: input.qtyKg, claimPct: r.claimPct, claimKg: r.claimKg });
    return { ...row, qtyKg: input.qtyKg, invoiceKg: r.invoiceKg, unitPrice: r.unitPrice, amount, claim: r, delivery: doc };
  }

  private async syncShipmentQty(shipmentId: string) {
    const s = await this.prisma.commodityDelivery.aggregate({ where: { shipmentId, status: 'POSTED' }, _sum: { qtyKg: true, amount: true } });
    await this.prisma.exportShipment.update({ where: { id: shipmentId }, data: { qtyKg: D(n(s._sum.qtyKg)) } });
  }

  async cancelDelivery(id: string) {
    RequestCtx.assert('commodity.deliver');
    const d = await this.prisma.commodityDelivery.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    if (d.invoiceDocId && (await this.liveDocs([d.invoiceDocId])).size) throw new ConflictException('The delivery is on an invoice: cancel or delete it first');
    if (d.shipmentId) {
      const s = await this.prisma.exportShipment.findUnique({ where: { id: d.shipmentId } });
      if (s?.status === 'SHIPPED') throw new ConflictException('The shipment has sailed: undo the PEB first');
    }
    if (d.deliveryDocId) {
      const doc = await this.prisma.tradeDocument.findUnique({ where: { id: d.deliveryDocId } });
      if (doc && !doc.deletedAt && doc.status !== 'CANCELLED') await this.documents.cancel('DO', doc.id, { skipPermission: true });
    }
    await this.prisma.commodityDelivery.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    if (d.shipmentId) await this.syncShipmentQty(d.shipmentId);
    await this.audit.record('Commodity Delivery', id, 'CANCEL');
    return { ok: true };
  }

  /** one draft sales invoice for deliveries of a contract: domestic with its PPN, export in the contract currency without PPN */
  async invoice(contractId: string, input: z.infer<typeof invoiceSchema>) {
    RequestCtx.assert('commodity.invoice');
    const c = await this.contractOwn(contractId);
    const rows = await this.prisma.commodityDelivery.findMany({ where: { id: { in: input.deliveryIds }, contractId: c.id, status: 'POSTED' }, orderBy: [{ date: 'asc' }, { number: 'asc' }] });
    if (rows.length !== input.deliveryIds.length) throw invalid({ deliveryIds: 'Delivery not found on this contract' });
    const live = await this.liveDocs(rows.map((r) => r.invoiceDocId));
    if (rows.some((r) => r.invoiceDocId && live.has(r.invoiceDocId))) throw new ConflictException('A delivery is already on an invoice');
    if (c.market === 'EXPORT') {
      const ships = await this.prisma.exportShipment.findMany({ where: { id: { in: rows.map((r) => r.shipmentId).filter((x): x is string => !!x) } } });
      if (ships.some((s) => s.status !== 'SHIPPED')) throw new ConflictException('Record the PEB of the shipment before invoicing the export');
    }
    const date = input.date ?? todayDate();
    const rate = c.currencyCode === 'IDR' ? 1 : input.exchangeRate ?? (await this.rateOn(c.currencyCode, date));
    if (!rate) throw invalid({ exchangeRate: `No ${c.currencyCode} rate on this date: enter it (Accounting > Exchange Rates)` });
    const vatPayer = await this.settings.bool('sales.vatPayer', c.companyId, true);
    const doc = (await this.documents.create(
      'SI',
      {
        date,
        customerId: c.customerId,
        currencyCode: c.currencyCode,
        exchangeRate: rate,
        reference: c.buyerRef ?? c.number,
        notes: [
          `Contract ${c.number}${c.buyerRef ? ` (${c.buyerRef})` : ''}, ${c.incoterm}${c.deliveryPoint ? ` ${c.deliveryPoint}` : ''}: ${rows.length} deliveries.`,
          rows.some((r) => n(r.claimPct) > 0 || n(r.claimKg) > 0) ? 'Quality claims applied as per contract (price cut for FFA / DOBI, weight cut for moisture & impurities).' : '',
          c.market === 'EXPORT' ? 'Export: PPN 0%, the PEB is the tax document.' : '',
        ]
          .filter(Boolean)
          .join(' '),
        lines: rows.map((r) => ({
          productId: c.productId,
          description: `${r.number} ${iso(r.date)}: ${n(r.qtyKg).toLocaleString('en-US')} kg${n(r.claimKg) ? `, less ${n(r.claimKg)} kg M&I` : ''}${r.ffa !== null ? `, FFA ${n(r.ffa)}%` : ''}${n(r.claimPct) ? `, claim ${n(r.claimPct)}%` : ''}`,
          qty: c.priceUnit === 'MT' ? Math.round(n(r.invoiceKg)) / 1000 : n(r.invoiceKg),
          unitPrice: n(r.unitPrice),
          taxId: c.market === 'DOMESTIC' && vatPayer ? c.taxId ?? undefined : undefined,
        })),
      },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    await this.prisma.commodityDelivery.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { invoiceDocId: doc.id } });
    await this.audit.record('Commodity Contract', c.id, 'INVOICE', undefined, { invoice: doc.number, deliveries: rows.length });
    return { id: doc.id, number: doc.number, rate };
  }

  // ================================================================ export references
  async references(productId?: string) {
    RequestCtx.assert('commodity.read');
    const rows = await this.prisma.exportReference.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null, ...(productId ? { productId } : {}) }, orderBy: [{ month: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const prod = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, refPriceUsd: n(r.refPriceUsd), dutyUsdPerMt: n(r.dutyUsdPerMt), levyPct: r.levyPct === null ? null : n(r.levyPct), levyUsdPerMt: r.levyUsdPerMt === null ? null : n(r.levyUsdPerMt), product: prod.get(r.productId) ?? '' }));
  }

  async saveReference(input: z.infer<typeof referenceSchema>) {
    RequestCtx.assert('commodity.export');
    const u = RequestCtx.user();
    if (!(await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ productId: 'Product not found' });
    if (!input.levyPct && !input.levyUsdPerMt) throw invalid({ levyPct: 'Enter the levy as a % of the reference price or per ton' });
    await this.prisma.exportReference.updateMany({ where: { companyId: u.companyId, productId: input.productId, month: input.month, deletedAt: null }, data: { deletedAt: new Date() } });
    const r = await this.prisma.exportReference.create({ data: { companyId: u.companyId, month: input.month, productId: input.productId, refPriceUsd: D(input.refPriceUsd), dutyUsdPerMt: D(input.dutyUsdPerMt), levyPct: input.levyPct ?? null, levyUsdPerMt: input.levyUsdPerMt ?? null, reference: input.reference ?? null, createdById: u.id } });
    await this.audit.record('Export Reference', r.id, 'CREATE', undefined, { month: input.month, ref: input.refPriceUsd, duty: input.dutyUsdPerMt });
    return { id: r.id };
  }

  async deleteReference(id: string) {
    RequestCtx.assert('commodity.export');
    const r = await this.prisma.exportReference.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!r) throw new NotFoundException('Reference not found');
    if (await this.prisma.exportShipment.count({ where: { referenceId: id, status: 'SHIPPED' } })) throw new ConflictException('Shipments were charged with it');
    await this.prisma.exportReference.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  // ================================================================ export shipments
  private shipmentOut(s: Prisma.ExportShipmentGetPayload<object>) {
    return {
      ...s,
      qtyKg: n(s.qtyKg),
      fobUsd: n(s.fobUsd),
      refPriceUsd: n(s.refPriceUsd),
      dutyUsdPerMt: n(s.dutyUsdPerMt),
      levyUsdPerMt: n(s.levyUsdPerMt),
      rate: n(s.rate),
      dutyIdr: n(s.dutyIdr),
      levyIdr: n(s.levyIdr),
      dheReceivedUsd: s.dheReceivedUsd === null ? null : n(s.dheReceivedUsd),
      dheRetainedUsd: s.dheRetainedUsd === null ? null : n(s.dheRetainedUsd),
    };
  }

  async shipments(q: { from?: string; to?: string; status?: string }) {
    RequestCtx.assert('commodity.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.exportShipment.findMany({
      where: { companyId, ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }), ...(q.from || q.to ? { OR: [{ pebDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }, { pebDate: null }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const contracts = new Map((await this.prisma.commodityContract.findMany({ where: { id: { in: rows.map((r) => r.contractId) } } })).map((c) => [c.id, c]));
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...contracts.values()].map((c) => c.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((s) => ({ ...this.shipmentOut(s), contract: contracts.get(s.contractId) ? { id: s.contractId, number: contracts.get(s.contractId)!.number, buyer: cust.get(contracts.get(s.contractId)!.customerId) ?? '', currencyCode: contracts.get(s.contractId)!.currencyCode } : null }));
  }

  async shipment(id: string) {
    RequestCtx.assert('commodity.read');
    if (!UUID.test(id ?? '')) throw new NotFoundException('Shipment not found');
    const s = await this.prisma.exportShipment.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shipment not found');
    const c = await this.contractOwn(s.contractId);
    const deliveries = await this.prisma.commodityDelivery.findMany({ where: { shipmentId: s.id }, orderBy: { date: 'asc' } });
    const customer = await this.prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true } });
    const product = await this.prisma.product.findUnique({ where: { id: c.productId }, select: { id: true, name: true, hsCode: true } });
    const ref = await this.referenceFor(c.productId, s.pebDate ?? todayDate());
    const threshold = await this.settings.num('commodity.dheThresholdUsd', c.companyId, 250_000);
    return {
      ...this.shipmentOut(s),
      contract: { ...this.out(c), customer: customer?.name ?? '' },
      product,
      deliveries: deliveries.map((d) => ({ id: d.id, number: d.number, date: d.date, status: d.status, qtyKg: n(d.qtyKg), invoiceKg: n(d.invoiceKg), amount: n(d.amount), vehicle: d.vehicle })),
      reference: ref ? { id: ref.id, month: ref.month, refPriceUsd: n(ref.refPriceUsd), dutyUsdPerMt: n(ref.dutyUsdPerMt), levyPct: ref.levyPct === null ? null : n(ref.levyPct), levyUsdPerMt: ref.levyUsdPerMt === null ? null : n(ref.levyUsdPerMt) } : null,
      dheRequired: n(s.fobUsd) >= threshold,
      dheThresholdUsd: threshold,
    };
  }

  private async referenceFor(productId: string, date: Date) {
    return this.prisma.exportReference.findFirst({ where: { companyId: RequestCtx.companyId(), productId, deletedAt: null, month: iso(date).slice(0, 7) }, orderBy: { createdAt: 'desc' } });
  }

  async saveShipment(id: string | null, input: z.infer<typeof shipmentSchema>) {
    RequestCtx.assert('commodity.export');
    const u = RequestCtx.user();
    const c = await this.contractOwn(input.contractId);
    if (c.market !== 'EXPORT') throw invalid({ contractId: 'Not an export contract' });
    const prod = await this.prisma.product.findUnique({ where: { id: c.productId }, select: { hsCode: true } });
    const data = {
      contractId: c.id,
      vessel: input.vessel ?? null,
      blNo: input.blNo ?? null,
      blDate: input.blDate ?? null,
      portOfLoading: input.portOfLoading ?? null,
      portOfDischarge: input.portOfDischarge ?? null,
      destinationCountry: input.destinationCountry?.toUpperCase() ?? null,
      hsCode: input.hsCode ?? prod?.hsCode ?? null,
      surveyorReport: input.surveyorReport ?? null,
      originCertificate: input.originCertificate ?? null,
      sustainabilityRef: input.sustainabilityRef ?? null,
      eudrRef: input.eudrRef ?? null,
      notes: input.notes ?? null,
      updatedById: u.id,
    };
    let row;
    if (id) {
      const before = await this.prisma.exportShipment.findFirst({ where: { id, companyId: u.companyId } });
      if (!before) throw new NotFoundException('Shipment not found');
      if (before.status === 'CANCELLED') throw new ConflictException('The shipment is cancelled');
      if (before.contractId !== c.id) throw invalid({ contractId: 'The contract of a shipment cannot change' });
      row = await this.prisma.exportShipment.update({ where: { id }, data });
    } else {
      if (c.status !== 'OPEN') throw new ConflictException('The contract is not open');
      row = await this.prisma.$transaction(async (tx) => tx.exportShipment.create({ data: { ...data, companyId: u.companyId, branchId: u.branchId ?? null, number: await this.sequence.next('EXPORT_SHIPMENT', u.companyId, todayDate(), tx), createdById: u.id } }));
    }
    await this.audit.record('Export Shipment', row.id, id ? 'UPDATE' : 'CREATE', undefined, { number: row.number, vessel: row.vessel });
    return this.shipment(row.id);
  }

  /**
   * Records the PEB: export duty and levy from the reference price of the month of the PEB (tonnes loaded x duty / levy
   * per ton, at the rate of the day), booked as costs payable (paid by billing before loading); FOB value for the DHE.
   */
  async ship(id: string, input: z.infer<typeof shipSchema>) {
    RequestCtx.assert('commodity.export');
    const u = RequestCtx.user();
    const s = await this.prisma.exportShipment.findFirst({ where: { id, companyId: u.companyId } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (s.status !== 'DRAFT') throw new ConflictException('The PEB is already recorded');
    if (input.pebDate > todayDate()) throw invalid({ pebDate: 'Cannot be in the future' });
    const c = await this.contractOwn(s.contractId);
    const deliveries = await this.prisma.commodityDelivery.findMany({ where: { shipmentId: s.id, status: 'POSTED' } });
    if (!deliveries.length) throw new ConflictException('Load the goods on the shipment first (deliveries of the contract)');
    const qtyKg = deliveries.reduce((a, d) => a + n(d.qtyKg), 0);
    const ref = await this.referenceFor(c.productId, input.pebDate);
    if (!ref) throw invalid({ pebDate: `No reference price / duty for ${iso(input.pebDate).slice(0, 7)}: enter the month's figures first` });
    const rate = input.rate ?? (await this.rateOn('USD', input.pebDate));
    if (!rate) throw invalid({ rate: 'No USD rate on this date: enter the rate used for the duty' });
    const ch = exportCharges({ qtyKg, refPriceUsd: n(ref.refPriceUsd), dutyUsdPerMt: n(ref.dutyUsdPerMt), levyPct: ref.levyPct === null ? null : n(ref.levyPct), levyUsdPerMt: ref.levyUsdPerMt === null ? null : n(ref.levyUsdPerMt), rate });
    const usdRate = c.currencyCode === 'USD' ? 1 : null;
    const fob = input.fobUsd ?? (usdRate ? deliveries.reduce((a, d) => a + n(d.amount), 0) : 0);
    await this.prisma.$transaction(async (tx) => {
      const lines = [];
      if (ch.dutyIdr > 0) lines.push({ key: 'EXPORT_DUTY', debit: D(ch.dutyIdr), description: `Export duty ${ch.mt} MT x USD ${n(ref.dutyUsdPerMt)}` });
      if (ch.levyIdr > 0) lines.push({ key: 'EXPORT_LEVY', debit: D(ch.levyIdr), description: `Export levy ${ch.mt} MT x USD ${ch.levyPerMt}` });
      if (lines.length) {
        lines.push({ key: 'EXPORT_CHARGES_PAYABLE', credit: D(ch.dutyIdr + ch.levyIdr), description: `PEB ${input.pebNo}` });
        await this.journal.post(tx, { companyId: u.companyId, branchId: s.branchId, date: input.pebDate, description: `Export ${s.number} PEB ${input.pebNo}: duty and levy`, reference: input.pebNo, sourceType: 'EXPORT', sourceId: s.id, lines });
      }
      await tx.exportShipment.update({
        where: { id: s.id },
        data: { status: 'SHIPPED', pebNo: input.pebNo, pebDate: input.pebDate, npeNo: input.npeNo ?? null, npeDate: input.npeDate ?? null, qtyKg: D(qtyKg), fobUsd: D(fob), referenceId: ref.id, refPriceUsd: ref.refPriceUsd, dutyUsdPerMt: ref.dutyUsdPerMt, levyUsdPerMt: D(ch.levyPerMt), rate: D(rate), dutyIdr: D(ch.dutyIdr), levyIdr: D(ch.levyIdr), dutyBilling: input.dutyBilling ?? null, levyBilling: input.levyBilling ?? null, updatedById: u.id },
      });
    });
    await this.audit.record('Export Shipment', id, 'SHIP', undefined, { peb: input.pebNo, mt: ch.mt, duty: ch.dutyIdr, levy: ch.levyIdr });
    return this.shipment(id);
  }

  /** undoes the PEB (wrong figures) while the export is not invoiced */
  async unship(id: string) {
    RequestCtx.assert('commodity.export');
    const s = await this.prisma.exportShipment.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (s.status !== 'SHIPPED') throw new ConflictException('No PEB recorded');
    const invoiced = await this.prisma.commodityDelivery.findMany({ where: { shipmentId: s.id, status: 'POSTED', invoiceDocId: { not: null } }, select: { invoiceDocId: true } });
    if ((await this.liveDocs(invoiced.map((d) => d.invoiceDocId))).size) throw new ConflictException('The export is invoiced: cancel or delete the invoice first');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'EXPORT', s.id);
      await tx.exportShipment.update({ where: { id }, data: { status: 'DRAFT', dutyIdr: D(0), levyIdr: D(0), updatedById: RequestCtx.user().id } });
    });
    await this.audit.record('Export Shipment', id, 'UNSHIP');
    return this.shipment(id);
  }

  async cancelShipment(id: string) {
    RequestCtx.assert('commodity.export');
    const s = await this.prisma.exportShipment.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (s.status !== 'DRAFT') throw new ConflictException(s.status === 'SHIPPED' ? 'Undo the PEB first' : 'Already cancelled');
    if (await this.prisma.commodityDelivery.count({ where: { shipmentId: id, status: 'POSTED' } })) throw new ConflictException('Goods are loaded on it: cancel those deliveries first');
    await this.prisma.exportShipment.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Export Shipment', id, 'CANCEL');
    return { ok: true };
  }

  /** export proceeds received into an Indonesian bank and the part retained (DHE SDA) */
  async recordDhe(id: string, input: z.infer<typeof dheSchema>) {
    RequestCtx.assert('commodity.export');
    const s = await this.prisma.exportShipment.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (s.status !== 'SHIPPED') throw new ConflictException('Record the PEB first');
    if (input.dheReceivedDate && s.pebDate && input.dheReceivedDate < s.pebDate) throw invalid({ dheReceivedDate: 'Before the PEB' });
    if (input.dheRetainedUsd && input.dheReceivedUsd && input.dheRetainedUsd > input.dheReceivedUsd) throw invalid({ dheRetainedUsd: 'More than received' });
    const months = await this.settings.num('commodity.dheRetentionMonths', s.companyId, 12);
    const until = input.dheRetainUntil ?? (input.dheReceivedDate && input.dheRetainedUsd ? new Date(Date.UTC(input.dheReceivedDate.getUTCFullYear(), input.dheReceivedDate.getUTCMonth() + months, input.dheReceivedDate.getUTCDate())) : null);
    await this.prisma.exportShipment.update({ where: { id }, data: { dheReceivedDate: input.dheReceivedDate ?? null, dheReceivedUsd: input.dheReceivedUsd ?? null, dheBank: input.dheBank ?? null, dheRetainedUsd: input.dheRetainedUsd ?? null, dheRetainUntil: until, updatedById: RequestCtx.user().id } });
    await this.audit.record('Export Shipment', id, 'DHE', undefined, input);
    return this.shipment(id);
  }

  /** export register of a period: PEB, tonnes, FOB, duty, levy and the export proceeds */
  async register(q: { from: string; to: string }) {
    RequestCtx.assert('commodity.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.exportShipment.findMany({ where: { companyId, status: 'SHIPPED', pebDate: { gte: new Date(q.from), lte: new Date(q.to) } }, orderBy: { pebDate: 'asc' } });
    const contracts = new Map((await this.prisma.commodityContract.findMany({ where: { id: { in: rows.map((r) => r.contractId) } } })).map((c) => [c.id, c]));
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...contracts.values()].map((c) => c.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const threshold = await this.settings.num('commodity.dheThresholdUsd', companyId, 250_000);
    const deadlineMonths = await this.settings.num('commodity.dheDeadlineMonths', companyId, 3);
    const today = todayDate();
    return rows.map((s) => {
      const c = contracts.get(s.contractId)!;
      const due = s.pebDate ? new Date(Date.UTC(s.pebDate.getUTCFullYear(), s.pebDate.getUTCMonth() + deadlineMonths + 1, 0)) : null;
      return {
        ...this.shipmentOut(s),
        contract: c.number,
        buyer: cust.get(c.customerId) ?? '',
        dheRequired: n(s.fobUsd) >= threshold,
        dheDue: due,
        dheLate: n(s.fobUsd) >= threshold && !s.dheReceivedDate && !!due && due < today,
      };
    });
  }
}
