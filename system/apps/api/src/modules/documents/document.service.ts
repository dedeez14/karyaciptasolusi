import { QualityService } from '../quality/quality.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DocStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { ppnbmTerms } from './ppnbm';
import { InventoryService } from './inventory.service';
import { LotService } from './lot.service';
import { DOC_MAP, DocTypeDef } from './document.registry';
import { recalcSettlement } from './settlement';
import { ApprovalService } from '../approvals/approval.service';

/** document types that go through the approval workflow (APPROVAL_DOC_TYPE) */
export const APPROVAL_DOC_TYPES = new Set(['SQ', 'SO', 'PR', 'PO', 'PI']);

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const lineSchema = z.object({
  productId: optUuid,
  description: optText(1000),
  qty: z.coerce.number().refine((v) => v !== 0, 'Quantity cannot be zero'),
  uomId: optUuid,
  unitPrice: z.coerce.number().min(0).optional(),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxId: optUuid,
  sourceLineId: optUuid,
  /** lot-tracked products: lot number and expiry received, or the lot to issue from (empty = FEFO) */
  lotNo: optText(60),
  expiryDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  lotId: optUuid,
});

export const docSchema = z.object({
  date: z.coerce.date(),
  dueDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()),
  customerId: optUuid,
  supplierId: optUuid,
  warehouseId: optUuid,
  toWarehouseId: optUuid,
  paymentTermId: optUuid,
  projectId: optUuid,
  opportunityId: optUuid,
  ownerId: optUuid,
  branchId: optUuid,
  currencyCode: z.string().trim().length(3).optional(),
  exchangeRate: z.coerce.number().positive().max(1e9).optional(),
  reference: optText(100),
  notes: optText(4000),
  terms: optText(4000),
  /** Indonesian tax invoice number (Nomor Faktur Pajak) - sales and purchase invoices only */
  taxInvoiceNumber: optText(40),
  lines: z.array(lineSchema).min(1, 'Add at least one line').max(500),
});
export type DocInput = z.infer<typeof docSchema>;

type FullDoc = Prisma.TradeDocumentGetPayload<{ include: { lines: true } }>;

/** Options used by the go-live (opening balances) module: permissions are checked by that module instead */
export interface OpeningOpts {
  /** opening balance document: posts against Opening Balance Equity (no revenue, tax or COGS) */
  opening?: boolean;
  skipPermission?: boolean;
}

/** SI / PI: Nomor Faktur Pajak; SR / PRT: number of the nota retur made in Coretax (PMK 81/2024) */
const TAX_INVOICE_TYPES = new Set(['SI', 'PI', 'SR', 'PRT']);

/** what is left of a sales order to deliver / invoice: each line's total in proportion to its quantity not yet processed */
export function openOrderValue(lines: { qty: Prisma.Decimal; processedQty: Prisma.Decimal; lineTotal: Prisma.Decimal }[]) {
  return lines.reduce((a, l) => {
    const q = D(l.qty);
    if (q.lte(0)) return a;
    const open = q.minus(D(l.processedQty));
    return open.gt(0) ? a.plus(D(l.lineTotal).times(open).div(q)) : a;
  }, D(0));
}

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly approvals: ApprovalService,
    private readonly lots: LotService,
    private readonly quality: QualityService,
  ) {}

  def(type: string): DocTypeDef {
    const d = DOC_MAP.get(type.toUpperCase());
    if (!d) throw new NotFoundException(`Unknown document type ${type}`);
    return d;
  }

  types() {
    return [...DOC_MAP.values()]
      .filter((d) => RequestCtx.can(`${d.permission}.read`))
      .map((d) => ({
        ...d,
        can: Object.fromEntries(['create', 'update', 'delete', 'confirm', 'cancel', 'print'].map((a) => [a, RequestCtx.can(`${d.permission}.${a}`)])),
      }));
  }

  private scope() {
    return this.access.scopeWhere({ branchField: 'branchId', ownerField: 'createdById' }) as Prisma.TradeDocumentWhereInput;
  }

  // ------------------------------------------------------------------ queries
  async list(type: string, q: { page: number; pageSize: number; search?: string; status?: string; partnerId?: string; from?: string; to?: string; unpaid?: string; sort?: string; order?: 'asc' | 'desc' }) {
    const def = this.def(type);
    RequestCtx.assert(`${def.permission}.read`);
    const where: Prisma.TradeDocumentWhereInput = { ...this.scope(), docType: def.code, deletedAt: null };
    if (q.search) where.OR = [{ number: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { notes: { contains: q.search, mode: 'insensitive' } }];
    if (q.status) where.status = { in: q.status.split(',') as DocStatus[] };
    if (q.partnerId) where[def.partner === 'supplier' ? 'supplierId' : 'customerId'] = q.partnerId;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (q.unpaid === '1') where.status = { in: ['CONFIRMED', 'PARTIAL'] };
    const sort = ['date', 'number', 'grandTotal', 'dueDate', 'createdAt'].includes(q.sort ?? '') ? q.sort! : 'date';
    const [rows, total] = await Promise.all([
      this.prisma.tradeDocument.findMany({ where, orderBy: [{ [sort]: q.order ?? 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.tradeDocument.count({ where }),
    ]);
    const names = await this.partyNames(rows);
    // approval badge: drafts show where they are in the workflow, posted documents only that they were approved
    const approvals = APPROVAL_DOC_TYPES.has(def.code)
      ? await this.approvals.statusMap(RequestCtx.companyId(), def.code, rows.map((r) => ({ id: r.id, amount: this.approvalSubject(def, r).amount })))
      : new Map<string, { status: string; level: number | null }>();
    const approvalOf = (r: { id: string; status: string }) => {
      const a = approvals.get(r.id);
      if (!a) return null;
      return r.status === 'DRAFT' || a.status === 'APPROVED' ? a : null;
    };
    return paged(rows.map((r) => ({ ...r, partnerName: names.get(r.customerId ?? r.supplierId ?? '') ?? null, balance: D(r.grandTotal).minus(D(r.paidAmount)), approval: approvalOf(r) })), total, q);
  }

  private async partyNames(rows: { customerId: string | null; supplierId: string | null }[]) {
    const cIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
    const sIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean) as string[])];
    const [c, s] = await Promise.all([
      cIds.length ? this.prisma.customer.findMany({ where: { id: { in: cIds } }, select: { id: true, name: true } }) : [],
      sIds.length ? this.prisma.supplier.findMany({ where: { id: { in: sIds } }, select: { id: true, name: true } }) : [],
    ]);
    return new Map([...c, ...s].map((x) => [x.id, x.name]));
  }

  async findOwned(def: DocTypeDef, id: string, tx?: Tx): Promise<FullDoc> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException(`${def.label} not found`);
    const doc = await (tx ?? this.prisma).tradeDocument.findFirst({ where: { ...this.scope(), id, docType: def.code, deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!doc) throw new NotFoundException(`${def.label} not found`);
    return doc;
  }

  async get(type: string, id: string) {
    const def = this.def(type);
    RequestCtx.assert(`${def.permission}.read`);
    const doc = await this.findOwned(def, id);
    const [products, uoms, taxes, names, warehouses, source, derived, payments] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: doc.lines.map((l) => l.productId).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true, type: true, trackLots: true } }),
      this.prisma.uom.findMany({ where: { id: { in: doc.lines.map((l) => l.uomId).filter(Boolean) as string[] } }, select: { id: true, code: true } }),
      this.prisma.tax.findMany({ where: { id: { in: doc.lines.map((l) => l.taxId).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true } }),
      this.partyNames([doc]),
      this.prisma.warehouse.findMany({ where: { id: { in: [doc.warehouseId, doc.toWarehouseId].filter(Boolean) as string[] } }, select: { id: true, name: true } }),
      doc.sourceId ? this.prisma.tradeDocument.findUnique({ where: { id: doc.sourceId }, select: { id: true, docType: true, number: true, status: true } }) : null,
      this.prisma.tradeDocument.findMany({ where: { sourceId: doc.id, deletedAt: null }, select: { id: true, docType: true, number: true, status: true, date: true, grandTotal: true }, orderBy: { createdAt: 'asc' } }),
      def.payable
        ? this.prisma.paymentAllocation.findMany({ where: { documentId: doc.id, payment: { status: { not: 'CANCELLED' }, deletedAt: null } }, include: { payment: { select: { id: true, number: true, date: true } } } })
        : [],
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const um = new Map(uoms.map((u) => [u.id, u.code]));
    const tm = new Map(taxes.map((t) => [t.id, t.name]));
    const wm = new Map(warehouses.map((w) => [w.id, w.name]));
    return {
      ...doc,
      partnerName: names.get(doc.customerId ?? doc.supplierId ?? '') ?? null,
      // pre-fills the "Send by e-mail" dialog
      partnerEmail: doc.customerId
        ? ((await this.prisma.customer.findUnique({ where: { id: doc.customerId }, select: { email: true } }))?.email ?? null)
        : doc.supplierId
          ? ((await this.prisma.supplier.findUnique({ where: { id: doc.supplierId }, select: { email: true } }))?.email ?? null)
          : null,
      warehouseName: doc.warehouseId ? wm.get(doc.warehouseId) : null,
      toWarehouseName: doc.toWarehouseId ? wm.get(doc.toWarehouseId) : null,
      lots: await this.lots.ofDocument(this.prisma as unknown as Tx, doc.id),
      balance: D(doc.grandTotal).minus(D(doc.paidAmount)),
      lines: doc.lines.map((l) => ({ ...l, product: l.productId ? pm.get(l.productId) : null, uomCode: l.uomId ? um.get(l.uomId) : null, taxName: l.taxId ? tm.get(l.taxId) : null })),
      source,
      derived,
      payments: payments.map((p) => ({ id: p.payment.id, number: p.payment.number, date: p.payment.date, amount: p.amount })),
    };
  }

  // ------------------------------------------------------------------ write helpers
  private async assertRef(model: 'customer' | 'supplier' | 'warehouse' | 'paymentTerm' | 'project' | 'opportunity' | 'branch', id: string | null | undefined, label: string) {
    if (!id) return null;
    const row = await (this.prisma as any)[model].findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!row) throw new BadRequestException({ message: 'Validation failed', errors: { [label]: `${label} not found` } });
    return row;
  }

  /** Validates references & computes every amount server side (client totals are never trusted) */
  private async build(def: DocTypeDef, input: DocInput) {
    const companyId = RequestCtx.companyId();
    const partner =
      def.partner === 'customer' ? await this.assertRef('customer', input.customerId, 'customerId') : def.partner === 'supplier' ? await this.assertRef('supplier', input.supplierId, 'supplierId') : null;
    // no payment term chosen on the document -> the customer's / supplier's own term (drives the due date)
    if (!input.paymentTermId && partner?.paymentTermId) input.paymentTermId = partner.paymentTermId;
    const term = await this.assertRef('paymentTerm', input.paymentTermId, 'paymentTermId');
    // stock documents without a warehouse: use the branch's warehouse, or the only one there is (never guess between several)
    if ((def.warehouse === 'required' || def.warehouse === 'transfer' || def.returnOf) && !input.warehouseId) {
      const whs = await this.prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, branchId: true } });
      const branchId = input.branchId ?? RequestCtx.user().branchId;
      const inBranch = whs.filter((w) => branchId && w.branchId === branchId);
      const pick = inBranch.length === 1 ? inBranch[0] : whs.length === 1 ? whs[0] : null;
      if (pick) input.warehouseId = pick.id;
    }
    await this.assertRef('warehouse', input.warehouseId, 'warehouseId');
    await this.assertRef('warehouse', input.toWarehouseId, 'toWarehouseId');
    await this.assertRef('project', input.projectId, 'projectId');
    await this.assertRef('opportunity', input.opportunityId, 'opportunityId');
    await this.assertRef('branch', input.branchId, 'branchId');
    if (def.warehouse === 'transfer' && input.warehouseId && input.warehouseId === input.toWarehouseId) throw new BadRequestException('Source and destination warehouse must differ');

    const productIds = [...new Set(input.lines.map((l) => l.productId).filter(Boolean) as string[])];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds }, companyId, deletedAt: null } });
    if (products.length !== productIds.length) throw new BadRequestException('One or more products are invalid');
    const pm = new Map(products.map((p) => [p.id, p]));
    const taxIds = new Set<string>();
    // output VAT only for a PKP (VAT registered) company; purchase documents always keep the supplier's VAT
    const salesVat = def.taxField === 'saleTaxId' ? await this.settings.bool('sales.vatPayer', companyId, true) : true;
    if (!salesVat && input.lines.some((l) => l.taxId)) throw new BadRequestException('Your company is not registered as a VAT payer (PKP), so sales documents cannot charge PPN. Remove the tax, or turn on \"Company is a VAT payer (PKP)\" in System > Settings > Sales once the company is PKP.');
    for (const l of input.lines) {
      const p = l.productId ? pm.get(l.productId) : undefined;
      if (l.taxId === undefined && p && def.taxField) l.taxId = salesVat ? p[def.taxField] : null;
      if (l.taxId) taxIds.add(l.taxId);
    }
    // only VAT belongs on document lines; income tax withheld (PPh 23 / 4(2)) is entered on the payment
    const taxes = await this.prisma.tax.findMany({ where: { id: { in: [...taxIds] }, companyId, deletedAt: null, kind: 'VAT' } });
    if (taxes.length !== taxIds.size) throw new BadRequestException('One or more taxes are invalid. Lines take VAT (PPN) only; withholding tax (PPh 23 / 4(2)) is recorded on the payment.');
    const txm = new Map(taxes.map((t) => [t.id, t]));
    // PPnBM (PP 73/2019 jo 74/2021): charged once, by the manufacturer / importer, on sales documents of a PKP
    const ppnbmOn = def.taxField === 'saleTaxId' && salesVat && products.some((p) => p.luxuryGroup) && (await this.settings.bool('sales.ppnbmCollector', companyId, false));
    const ppnbmStage2 = ppnbmOn ? await this.settings.bool('automotive.ppnbmStage2', companyId, false) : false;
    const uomIds = [...new Set(input.lines.map((l) => l.uomId).filter(Boolean) as string[])];
    if (uomIds.length && (await this.prisma.uom.count({ where: { id: { in: uomIds }, companyId } })) !== uomIds.length) throw new BadRequestException('Invalid unit of measure');

    // distribution: the customer's price list gives the default price of sales documents
    const custPrices = new Map<string, Prisma.Decimal>();
    if (def.partner === 'customer' && def.priced && input.customerId && productIds.length) {
      const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId }, select: { priceListId: true } });
      if (c?.priceListId) for (const it of await this.prisma.priceListItem.findMany({ where: { priceListId: c.priceListId, productId: { in: productIds }, priceList: { isActive: true, deletedAt: null } } })) custPrices.set(it.productId, it.price);
    }
    const lines = input.lines.map((l, i) => {
      const p = l.productId ? pm.get(l.productId) : undefined;
      if (!p && !l.description) throw new BadRequestException(`Line ${i + 1}: choose a product or enter a description`);
      if (def.stockItemsOnly && p?.type !== 'STOCK') throw new BadRequestException(`Line ${i + 1}: only stock products are allowed in a ${def.label}`);
      if (def.stock !== 'adjust' && l.qty < 0) throw new BadRequestException(`Line ${i + 1}: quantity must be positive`);
      const qty = D(l.qty);
      const price = def.priced ? D(l.unitPrice ?? (p ? (custPrices.get(p.id) ?? (def.priceField ? p[def.priceField] : 0)) : 0)) : D(l.unitPrice ?? 0);
      const subtotal = round(qty.times(price));
      const discount = round(subtotal.times(D(l.discountPct)).div(100));
      const tx = def.taxField && l.taxId ? txm.get(l.taxId)! : null;
      const rate = tx ? D(tx.rate) : ZERO;
      // PMK 131/2024: PPN 12% is charged on "DPP nilai lain" = 11/12 of the price (except luxury goods)
      const base = tx ? subtotal.minus(discount).times(tx.baseNumerator).div(tx.baseDenominator) : ZERO;
      const tax = round(base.times(rate).div(100));
      const lux = ppnbmOn ? ppnbmTerms(p?.luxuryGroup, ppnbmStage2) : null;
      if (lux && (!tx || tx.baseNumerator !== tx.baseDenominator)) throw new BadRequestException(`Line ${i + 1}: goods subject to PPnBM carry PPN 12% on the full price (PMK 131/2024): choose the full-price PPN`);
      const luxTax = lux ? round(subtotal.minus(discount).times(lux.basePct).div(100).times(lux.rate).div(100)) : ZERO;
      return {
        lineNo: i + 1,
        productId: p?.id ?? null,
        description: l.description ?? p?.name ?? null,
        qty,
        uomId: l.uomId ?? p?.uomId ?? null,
        unitPrice: price,
        discountPct: D(l.discountPct),
        taxId: l.taxId ?? null,
        taxRate: rate,
        lineSubtotal: subtotal,
        lineDiscount: discount,
        lineTax: tax,
        luxuryRate: D(lux?.rate ?? 0),
        luxuryBasePct: D(lux?.basePct ?? 0),
        lineLuxuryTax: luxTax,
        lineTotal: subtotal.minus(discount).plus(tax).plus(luxTax),
        sourceLineId: l.sourceLineId ?? null,
        lotNo: p?.trackLots ? l.lotNo ?? null : null,
        expiryDate: p?.trackLots ? l.expiryDate ?? null : null,
        lotId: p?.trackLots ? l.lotId ?? null : null,
      };
    });
    const subtotal = sum(lines.map((l) => l.lineSubtotal));
    const discountTotal = sum(lines.map((l) => l.lineDiscount));
    const taxTotal = sum(lines.map((l) => l.lineTax));
    const luxuryTaxTotal = sum(lines.map((l) => l.lineLuxuryTax));
    let dueDate = input.dueDate ?? null;
    if (!dueDate && def.dueDate) dueDate = new Date(input.date.getTime() + (term?.days ?? 0) * 86_400_000);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { currencyCode: true } });
    const header = {
      date: input.date,
      dueDate,
      customerId: def.partner === 'customer' ? input.customerId ?? null : null,
      supplierId: def.partner === 'supplier' ? input.supplierId ?? null : null,
      warehouseId: def.warehouse === 'none' ? null : input.warehouseId ?? null,
      toWarehouseId: def.warehouse === 'transfer' ? input.toWarehouseId ?? null : null,
      paymentTermId: input.paymentTermId ?? null,
      projectId: input.projectId ?? null,
      opportunityId: input.opportunityId ?? null,
      ownerId: input.ownerId ?? null,
      currencyCode: input.currencyCode ?? company.currencyCode,
      exchangeRate: D(input.exchangeRate ?? 1),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      taxInvoiceNumber: TAX_INVOICE_TYPES.has(def.code) ? (input.taxInvoiceNumber ?? null) : null,
      subtotal,
      discountTotal,
      taxTotal,
      luxuryTaxTotal,
      grandTotal: subtotal.minus(discountTotal).plus(taxTotal).plus(luxuryTaxTotal),
    };
    return { header, lines };
  }

  async create(type: string, body: unknown, sourceId?: string, opts: OpeningOpts = {}) {
    const def = this.def(type);
    if (!opts.skipPermission) RequestCtx.assert(`${def.permission}.create`);
    const input = docSchema.parse(body);
    if (!input.terms && def.code === 'SQ') input.terms = (await this.settings.str('sales.quotationTerms', RequestCtx.companyId(), '')) || null;
    if (!input.terms && def.code === 'SI') input.terms = (await this.settings.str('sales.invoiceTerms', RequestCtx.companyId(), '')) || null;
    const { header, lines } = await this.build(def, input);
    const u = RequestCtx.user();
    const branchId = input.branchId ?? u.branchId;
    const doc = await this.prisma.$transaction(async (tx) => {
      // opening documents get their own numbering (OB-SI/2026/00001) so they never consume real invoice numbers
      const number = await this.sequence.next(opts.opening ? `OB-${def.code}` : def.code, u.companyId, header.date, tx);
      const d = await tx.tradeDocument.create({
        data: { ...header, isOpening: !!opts.opening, companyId: u.companyId, branchId, docType: def.code, number, status: 'DRAFT', sourceId: sourceId ?? null, createdById: u.id, lines: { create: lines } },
        include: { lines: true },
      });
      await this.audit.record(def.label, d.id, 'CREATE', undefined, d, tx);
      return d;
    });
    return doc;
  }

  async update(type: string, id: string, body: unknown) {
    const def = this.def(type);
    RequestCtx.assert(`${def.permission}.update`);
    const before = await this.findOwned(def, id);
    if (before.status !== 'DRAFT') throw new ConflictException('Only draft documents can be edited');
    const input = docSchema.parse(body);
    const { header, lines } = await this.build(def, input);
    return this.prisma.$transaction(async (tx) => {
      await tx.tradeDocumentLine.deleteMany({ where: { documentId: id } });
      const d = await tx.tradeDocument.update({ where: { id }, data: { ...header, updatedById: RequestCtx.user().id, lines: { create: lines } }, include: { lines: true } });
      if (APPROVAL_DOC_TYPES.has(def.code)) await this.approvals.reset(tx, def.code, id);
      await this.audit.record(def.label, id, 'UPDATE', before, d, tx);
      return d;
    });
  }

  async remove(type: string, id: string) {
    const def = this.def(type);
    RequestCtx.assert(`${def.permission}.delete`);
    const before = await this.findOwned(def, id);
    if (before.status !== 'DRAFT') throw new ConflictException('Only draft documents can be deleted. Cancel it instead.');
    await this.prisma.$transaction(async (tx) => {
      await tx.tradeDocument.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
      await this.approvals.reset(tx, def.code, id);
      await this.audit.record(def.label, id, 'DELETE', before, undefined, tx);
    });
    return { success: true };
  }

  // ------------------------------------------------------------------ workflow
  private assertId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException('Document not found');
  }

  /**
   * Credit control (distribution): a customer on credit hold, with invoices overdue beyond the allowed days, or whose
   * open receivables + open sales orders + this document go over the credit limit cannot get a sales order, invoice or
   * delivery confirmed. A user with sales.credit.override confirms anyway (recorded in the audit trail).
   */
  private async assertCredit(tx: Tx, def: DocTypeDef, doc: { id: string; companyId: string; customerId: string | null; sourceId: string | null; grandTotal: Prisma.Decimal; exchangeRate: Prisma.Decimal; number: string }) {
    if (!(await this.settings.bool('sales.creditControl', doc.companyId, true))) return;
    const c = await tx.customer.findUnique({ where: { id: doc.customerId! }, select: { name: true, creditLimit: true, creditHold: true } });
    if (!c) return;
    const problems: string[] = [];
    if (c.creditHold) problems.push(`${c.name} is on credit hold`);
    const overdueDays = await this.settings.num('sales.creditOverdueDays', doc.companyId, 0);
    if (overdueDays > 0) {
      const before = new Date(Date.now() - overdueDays * 86_400_000);
      const late = await tx.tradeDocument.findMany({ where: { companyId: doc.companyId, customerId: doc.customerId, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null, dueDate: { lt: before } }, select: { number: true, grandTotal: true, paidAmount: true } });
      const open = late.filter((x) => D(x.grandTotal).gt(D(x.paidAmount)));
      if (open.length) problems.push(`${open.length} invoice(s) more than ${overdueDays} days overdue (${open.slice(0, 3).map((x) => x.number).join(', ')})`);
    }
    const limit = D(c.creditLimit);
    if (limit.gt(0) && def.code !== 'DO') {
      const inv = await tx.tradeDocument.findMany({ where: { companyId: doc.companyId, customerId: doc.customerId, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null }, select: { grandTotal: true, paidAmount: true, exchangeRate: true } });
      const ar = inv.reduce((a, x) => a.plus(D(x.grandTotal).minus(D(x.paidAmount)).times(D(x.exchangeRate))), D(0));
      // open sales orders count until invoiced (not the order this document comes from)
      const sos = await tx.tradeDocument.findMany({ where: { companyId: doc.companyId, customerId: doc.customerId, docType: 'SO', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null, id: { notIn: [doc.id, doc.sourceId ?? doc.id] } }, select: { exchangeRate: true, lines: { select: { qty: true, processedQty: true, lineTotal: true } } } });
      const so = sos.reduce((a, x) => a.plus(openOrderValue(x.lines).times(D(x.exchangeRate))), D(0));
      const exposure = ar.plus(so).plus(D(doc.grandTotal).times(D(doc.exchangeRate)));
      if (exposure.gt(limit)) problems.push(`credit limit ${limit.toFixed(0)} exceeded: open invoices ${ar.toFixed(0)} + open orders ${so.toFixed(0)} + this ${D(doc.grandTotal).times(D(doc.exchangeRate)).toFixed(0)}`);
    }
    if (!problems.length) return;
    if (RequestCtx.can('sales.credit.override')) {
      await this.audit.record(def.label, doc.id, 'CREDIT_OVERRIDE', null, { number: doc.number, problems }, tx);
      return;
    }
    throw new ConflictException(`Credit check: ${problems.join('; ')}. Collect the payment first, or ask someone allowed to override the credit check.`);
  }

  async confirm(type: string, id: string, opts: OpeningOpts = {}) {
    this.assertId(id);
    const def = this.def(type);
    if (!opts.skipPermission) RequestCtx.assert(`${def.permission}.confirm`);
    const u = RequestCtx.user();
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', u.companyId, false);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM trade_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const doc = await this.findOwned(def, id, tx);
        if (doc.status !== 'DRAFT') throw new ConflictException('Document is already confirmed or cancelled');
        if (def.partner === 'customer' && !doc.customerId) throw new BadRequestException('Customer is required');
        if (def.partner === 'supplier' && !doc.supplierId) throw new BadRequestException('Supplier is required');
        if (def.warehouse !== 'none' && def.warehouse !== 'optional' && !doc.warehouseId) throw new BadRequestException('Warehouse is required');
        if (def.warehouse === 'transfer' && !doc.toWarehouseId) throw new BadRequestException('Destination warehouse is required');
        if (def.returnOf && !doc.warehouseId) {
          const stockLines = await tx.product.count({ where: { id: { in: doc.lines.map((l) => l.productId).filter(Boolean) as string[] }, type: 'STOCK' } });
          if (stockLines) throw new BadRequestException(def.returnOf === 'SI' ? 'Choose the warehouse the returned goods go back to' : 'Choose the warehouse the goods are returned from');
        }
        await this.checkSourceQuantities(tx, def, doc);
        // UU PPN Pasal 14: a company that is not a PKP may not charge PPN (checked again here: the setting may have changed after the draft was saved)
        if (def.taxField === 'saleTaxId' && D(doc.taxTotal).gt(0) && !(await this.settings.bool('sales.vatPayer', u.companyId, true))) {
          throw new BadRequestException('Your company is not a VAT payer (PKP), so this document may not charge PPN (UU PPN Pasal 14). Edit it and remove the tax, or turn on "Company is a VAT payer (PKP)" in Settings > Sales once the company is PKP.');
        }
        if (APPROVAL_DOC_TYPES.has(def.code) && !doc.isOpening) await this.approvals.assertApproved(u.companyId, this.approvalSubject(def, doc), tx);
        if (['SO', 'SI', 'DO'].includes(def.code) && doc.customerId && !doc.isOpening) await this.assertCredit(tx, def, doc);

        await this.post(tx, def, doc, allowNegative);

        let updated = await tx.tradeDocument.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: u.id } });
        if (doc.sourceId) await this.refreshSourceStatus(tx, doc.sourceId);
        // incoming quality control: inspections (and lot holds) for the received goods that have a plan
        if (def.code === 'GR') await this.quality.onReceipt(tx, doc);
        // a credit / debit note first settles the open balance of the invoice it was made from
        if (def.returnOf && doc.sourceId) {
          const inv = await tx.tradeDocument.findUnique({ where: { id: doc.sourceId } });
          const open = inv && ['CONFIRMED', 'PARTIAL'].includes(inv.status) ? D(inv.grandTotal).minus(D(inv.paidAmount)) : ZERO;
          const amount = D(doc.grandTotal).lt(open) ? D(doc.grandTotal) : open;
          if (amount.gt(0)) {
            await tx.creditApplication.create({ data: { companyId: doc.companyId, creditNoteId: id, invoiceId: doc.sourceId, amount, date: doc.date, createdById: u.id } });
            await recalcSettlement(tx, doc.sourceId);
          }
          await recalcSettlement(tx, id);
          updated = await tx.tradeDocument.findUniqueOrThrow({ where: { id } });
        }
        await this.audit.record(def.label, id, 'CONFIRM', doc, updated, tx);
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Opening balance documents (go-live): the balance comes from the previous system, so it is booked against
   * Opening Balance Equity - no revenue, tax, COGS or GRNI. SI: Dr AR / Cr equity, PI: Dr equity / Cr AP,
   * ADJ: stock in at the given cost, Dr Inventory / Cr equity.
   */
  private async postOpening(tx: Tx, def: DocTypeDef, doc: FullDoc) {
    const rate = D(doc.exchangeRate);
    const party = { customerId: doc.customerId, supplierId: doc.supplierId, projectId: doc.projectId };
    const j: PostingLine[] = [];
    if (def.code === 'SI') {
      const amount = D(doc.grandTotal).times(rate);
      j.push({ key: 'AR', debit: amount, ...party, description: doc.reference ?? doc.number }, { key: 'OPENING_EQUITY', credit: amount, description: `Opening receivable ${doc.reference ?? doc.number}` });
    } else if (def.code === 'PI') {
      const amount = D(doc.grandTotal).times(rate);
      j.push({ key: 'OPENING_EQUITY', debit: amount, description: `Opening payable ${doc.reference ?? doc.number}` }, { key: 'AP', credit: amount, ...party, description: doc.reference ?? doc.number });
    } else if (def.code === 'ADJ') {
      const products = await tx.product.findMany({ where: { id: { in: doc.lines.map((l) => l.productId).filter(Boolean) as string[] } } });
      const pm = new Map(products.map((p) => [p.id, p]));
      for (const l of doc.lines) {
        const p = l.productId ? pm.get(l.productId) : undefined;
        if (!p || p.type !== 'STOCK') throw new BadRequestException(`Line ${l.lineNo}: only stock products can have an opening quantity`);
        if (!D(l.qty).gt(0)) throw new BadRequestException(`Line ${l.lineNo}: opening quantity must be positive`);
        if (D(l.unitPrice).lt(0)) throw new BadRequestException(`Line ${l.lineNo}: unit cost cannot be negative`);
        const r = await this.inventory.move(tx, {
          companyId: doc.companyId,
          branchId: doc.branchId,
          date: doc.date,
          docType: def.code,
          documentId: doc.id,
          documentNumber: doc.number,
          allowNegative: false,
          productId: p.id,
          productName: p.name,
          warehouseId: doc.warehouseId!,
          qty: D(l.qty),
          unitCost: D(l.unitPrice),
        });
        await tx.tradeDocumentLine.update({ where: { id: l.id }, data: { unitCost: D(l.unitPrice) } });
        if (p.trackLots) await this.lots.receive(tx, { companyId: doc.companyId, documentId: doc.id, lineId: l.id, productId: p.id, warehouseId: doc.warehouseId!, qty: D(l.qty), lotNo: l.lotNo, lotId: l.lotId, expiryDate: l.expiryDate, docNumber: doc.number, docDate: doc.date, shelfLifeDays: p.shelfLifeDays });
        j.push({ key: 'INVENTORY', debit: r.totalCost, description: p.name }, { key: 'OPENING_EQUITY', credit: r.totalCost, description: `Opening stock ${p.name}` });
      }
    } else throw new BadRequestException(`${def.label} cannot be an opening balance document`);
    if (j.length) await this.journal.post(tx, { companyId: doc.companyId, branchId: doc.branchId, date: doc.date, description: `Opening balance ${def.label} ${doc.number}`, reference: doc.reference ?? undefined, sourceType: def.code, sourceId: doc.id, lines: j });
  }

  /** Stock movements + automatic journal for a document */
  private async post(tx: Tx, def: DocTypeDef, doc: FullDoc, allowNegative: boolean) {
    if (doc.isOpening) return this.postOpening(tx, def, doc);
    const rate = D(doc.exchangeRate);
    const products = await tx.product.findMany({ where: { id: { in: doc.lines.map((l) => l.productId).filter(Boolean) as string[] } } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const taxes = await tx.tax.findMany({ where: { id: { in: doc.lines.map((l) => l.taxId).filter(Boolean) as string[] } } });
    const tm = new Map(taxes.map((t) => [t.id, t]));
    const base = { companyId: doc.companyId, branchId: doc.branchId, date: doc.date, docType: def.code, documentId: doc.id, documentNumber: doc.number, allowNegative };
    const j: PostingLine[] = [];
    const party = { customerId: doc.customerId, supplierId: doc.supplierId, projectId: doc.projectId };

    for (const l of doc.lines) {
      const p = l.productId ? pm.get(l.productId) : undefined;
      const isStock = p?.type === 'STOCK';
      const net = D(l.lineSubtotal).minus(D(l.lineDiscount)).times(rate);
      if (def.returnOf) {
        if (p?.trackLots && p.type === 'STOCK' && doc.warehouseId) await this.moveLots(tx, def, doc, l, p);
        await this.postReturnLine(tx, def, doc, l, p, net, rate, tm, base, party, j);
        continue;
      }
      if (def.stock && isStock && p) {
        if (p.trackLots) await this.moveLots(tx, def, doc, l, p);
        const mv = { ...base, productId: p.id, productName: p.name };
        if (def.stock === 'in') {
          const unitCost = D(l.qty).isZero() ? ZERO : net.div(D(l.qty));
          const r = await this.inventory.move(tx, { ...mv, warehouseId: doc.warehouseId!, qty: D(l.qty), unitCost });
          j.push({ key: 'INVENTORY', debit: r.totalCost, description: p.name }, { key: 'GRNI', credit: r.totalCost, ...party });
        } else if (def.stock === 'out') {
          const r = await this.inventory.move(tx, { ...mv, warehouseId: doc.warehouseId!, qty: D(l.qty).neg() });
          j.push({ key: 'COGS', debit: r.totalCost.abs(), description: p.name, ...party }, { key: 'INVENTORY', credit: r.totalCost.abs() });
        } else if (def.stock === 'adjust') {
          const r = await this.inventory.move(tx, { ...mv, warehouseId: doc.warehouseId!, qty: D(l.qty), unitCost: D(l.unitPrice).gt(0) ? D(l.unitPrice) : undefined });
          if (D(l.qty).gt(0)) j.push({ key: 'INVENTORY', debit: r.totalCost }, { key: 'STOCK_GAIN', credit: r.totalCost, description: p.name });
          else j.push({ key: 'STOCK_LOSS', debit: r.totalCost.abs(), description: p.name }, { key: 'INVENTORY', credit: r.totalCost.abs() });
        } else if (def.stock === 'transfer') {
          const out = await this.inventory.move(tx, { ...mv, warehouseId: doc.warehouseId!, qty: D(l.qty).neg() });
          await this.inventory.move(tx, { ...mv, warehouseId: doc.toWarehouseId!, qty: D(l.qty), unitCost: out.unitCost });
        }
        await tx.tradeDocumentLine.update({ where: { id: l.id }, data: { unitCost: (await tx.stockMovement.findFirst({ where: { documentId: doc.id, productId: p.id }, orderBy: { createdAt: 'desc' } }))?.unitCost ?? 0 } });
      }

      if (def.code === 'SI') {
        const acc = p?.incomeAccountId ?? null;
        j.push({ accountId: acc, key: acc ? undefined : p?.type === 'STOCK' ? 'SALES' : 'SERVICE_REVENUE', credit: net, description: l.description ?? undefined, ...party });
        if (D(l.lineTax).gt(0)) {
          const t = l.taxId ? tm.get(l.taxId) : undefined;
          j.push({ accountId: t?.salesAccountId, key: t?.salesAccountId ? undefined : 'TAX_OUT', credit: D(l.lineTax).times(rate), description: t?.name });
        }
        if (D(l.lineLuxuryTax).gt(0)) j.push({ key: 'PPNBM_OUT', credit: D(l.lineLuxuryTax).times(rate), description: `PPnBM ${Number(l.luxuryRate)}% x DPP ${Number(l.luxuryBasePct)}%` });
      }
      if (def.code === 'PI') {
        const acc = isStock ? null : p?.expenseAccountId ?? null;
        j.push({ accountId: acc, key: acc ? undefined : isStock ? 'GRNI' : 'PURCHASE_EXPENSE', debit: net, description: l.description ?? undefined, ...party });
        if (D(l.lineTax).gt(0)) {
          const t = l.taxId ? tm.get(l.taxId) : undefined;
          j.push({ accountId: t?.purchaseAccountId, key: t?.purchaseAccountId ? undefined : 'TAX_IN', debit: D(l.lineTax).times(rate), description: t?.name });
        }
      }
    }
    if (def.code === 'SI') j.push({ key: 'AR', debit: sum(j.map((x) => D(x.credit))), ...party, description: doc.number });
    // credit note: the customer owes less; debit note: we owe the supplier less
    if (def.code === 'SR') j.push({ key: 'AR', credit: D(doc.grandTotal).times(rate), ...party, description: `Credit note ${doc.number}` });
    if (def.code === 'PRT') j.push({ key: 'AP', debit: D(doc.grandTotal).times(rate), ...party, description: `Debit note ${doc.number}` });
    if (def.code === 'PI') j.push({ key: 'AP', credit: sum(j.map((x) => D(x.debit))), ...party, description: doc.number });

    if (j.length) {
      await this.journal.post(tx, { companyId: doc.companyId, branchId: doc.branchId, date: doc.date, description: `${def.label} ${doc.number}`, reference: doc.reference ?? undefined, sourceType: def.code, sourceId: doc.id, lines: j });
    }
  }

  /**
   * One line of a return.
   * Sales return (credit note): goods back into stock at the cost they left with (Dr Inventory / Cr COGS),
   * Dr Sales Returns (net) and Dr VAT Out (PPN reduced in the month of the return); Cr AR is added for the document.
   * Purchase return (debit note): goods out of stock at average cost (Cr Inventory), any difference with the
   * returned price goes to COGS; service lines reduce the expense; Cr VAT In; Dr AP is added for the document.
   */
  private async postReturnLine(
    tx: Tx,
    def: DocTypeDef,
    doc: FullDoc,
    l: FullDoc['lines'][number],
    p: { id: string; name: string; type: string; incomeAccountId: string | null; expenseAccountId: string | null } | undefined,
    net: Prisma.Decimal,
    rate: Prisma.Decimal,
    tm: Map<string, { name: string; salesAccountId: string | null; purchaseAccountId: string | null }>,
    base: Omit<Parameters<InventoryService['move']>[1], 'productId' | 'productName' | 'warehouseId' | 'qty'>,
    party: { customerId: string | null; supplierId: string | null; projectId: string | null },
    j: PostingLine[],
  ) {
    const isStock = p?.type === 'STOCK';
    const t = l.taxId ? tm.get(l.taxId) : undefined;
    const tax = D(l.lineTax).times(rate);
    if (def.returnOf === 'SI') {
      if (isStock && p) {
        // cost of the goods when they were sold: the delivery line behind the invoice line, else the current average
        const invLine = l.sourceLineId ? await tx.tradeDocumentLine.findUnique({ where: { id: l.sourceLineId } }) : null;
        const outLine = invLine?.sourceLineId ? await tx.tradeDocumentLine.findUnique({ where: { id: invLine.sourceLineId } }) : null;
        const known = [invLine?.unitCost, outLine?.unitCost].map((v) => D(v ?? 0)).find((v) => v.gt(0));
        const r = await this.inventory.move(tx, { ...base, productId: p.id, productName: p.name, warehouseId: doc.warehouseId!, qty: D(l.qty), unitCost: known });
        await tx.tradeDocumentLine.update({ where: { id: l.id }, data: { unitCost: r.unitCost } });
        j.push({ key: 'INVENTORY', debit: r.totalCost, description: p.name }, { key: 'COGS', credit: r.totalCost, description: `Returned: ${p.name}`, ...party });
      }
      j.push({ key: 'SALES_RETURN', debit: net, description: l.description ?? p?.name ?? undefined, ...party });
      if (tax.gt(0)) j.push({ accountId: t?.salesAccountId, key: t?.salesAccountId ? undefined : 'TAX_OUT', debit: tax, description: `${t?.name ?? 'PPN'} - nota retur` });
      if (D(l.lineLuxuryTax).gt(0)) j.push({ key: 'PPNBM_OUT', debit: D(l.lineLuxuryTax).times(rate), description: 'PPnBM - nota retur' });
      return;
    }
    if (isStock && p) {
      const r = await this.inventory.move(tx, { ...base, productId: p.id, productName: p.name, warehouseId: doc.warehouseId!, qty: D(l.qty).neg() });
      const cost = r.totalCost.abs();
      await tx.tradeDocumentLine.update({ where: { id: l.id }, data: { unitCost: r.unitCost } });
      j.push({ key: 'INVENTORY', credit: cost, description: p.name });
      const diff = net.minus(cost);
      if (diff.gt(0)) j.push({ key: 'COGS', credit: diff, description: `Return price above cost: ${p.name}` });
      if (diff.lt(0)) j.push({ key: 'COGS', debit: diff.abs(), description: `Return price below cost: ${p.name}` });
    } else {
      const acc = p?.expenseAccountId ?? null;
      j.push({ accountId: acc, key: acc ? undefined : 'PURCHASE_EXPENSE', credit: net, description: l.description ?? undefined, ...party });
    }
    if (tax.gt(0)) j.push({ accountId: t?.purchaseAccountId, key: t?.purchaseAccountId ? undefined : 'TAX_IN', credit: tax, description: `${t?.name ?? 'PPN'} - nota retur` });
  }

  /** lot quantities of one document line of a lot-tracked product (in: receive, out: FEFO / chosen lot) */
  private async moveLots(tx: Tx, def: DocTypeDef, doc: FullDoc, l: FullDoc['lines'][number], p: { id: string; shelfLifeDays: number }) {
    const ref = { companyId: doc.companyId, documentId: doc.id, lineId: l.id, productId: p.id };
    const qty = D(l.qty);
    const inbound = def.stock === 'in' || (def.stock === 'adjust' && qty.gt(0));
    const recv = (warehouseId: string, q: typeof qty, lotId?: string | null) =>
      this.lots.receive(tx, { ...ref, warehouseId, qty: q, lotNo: l.lotNo, lotId: lotId ?? l.lotId, expiryDate: l.expiryDate, docNumber: doc.number, docDate: doc.date, shelfLifeDays: p.shelfLifeDays });
    if (def.stock === 'transfer') {
      await this.lots.ensureOpening(tx, doc.companyId, p.id, doc.warehouseId!);
      const taken = await this.lots.issue(tx, { ...ref, warehouseId: doc.warehouseId!, qty, preferredLotId: l.lotId });
      for (const t of taken) await this.lots.receive(tx, { ...ref, warehouseId: doc.toWarehouseId!, qty: t.qty, lotId: t.lotId, docNumber: doc.number, docDate: doc.date, shelfLifeDays: 0 });
      return;
    }
    await this.lots.ensureOpening(tx, doc.companyId, p.id, doc.warehouseId!);
    if (inbound) await recv(doc.warehouseId!, qty.abs());
    else await this.lots.issue(tx, { ...ref, warehouseId: doc.warehouseId!, qty: qty.abs(), preferredLotId: l.lotId });
  }

  /** Uses the remaining credit of a credit / debit note to settle another open invoice of the same partner */
  async applyCredit(type: string, id: string, input: { invoiceId: string; amount: number }) {
    this.assertId(id);
    this.assertId(input.invoiceId);
    const def = this.def(type);
    if (!def.returnOf) throw new BadRequestException(`${def.label} is not a credit or debit note`);
    RequestCtx.assert(`${def.permission}.confirm`);
    const u = RequestCtx.user();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM trade_documents WHERE id IN (${id}::uuid, ${input.invoiceId}::uuid) FOR UPDATE`;
      const note = await this.findOwned(def, id, tx);
      if (!['CONFIRMED', 'PARTIAL'].includes(note.status)) throw new ConflictException('Only a confirmed note with remaining credit can be applied');
      const inv = await tx.tradeDocument.findFirst({ where: { id: input.invoiceId, companyId: u.companyId, docType: def.returnOf, deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL'] }, customerId: note.customerId, supplierId: note.supplierId } });
      if (!inv) throw new BadRequestException('Choose an open invoice of the same partner');
      const amount = round(D(input.amount));
      const left = D(note.grandTotal).minus(D(note.paidAmount));
      const due = D(inv.grandTotal).minus(D(inv.paidAmount));
      if (amount.lte(0) || amount.gt(left)) throw new BadRequestException(`Amount must be between 0 and the remaining credit ${left}`);
      if (amount.gt(due)) throw new BadRequestException(`Amount exceeds the balance of ${inv.number} (${due})`);
      await tx.creditApplication.create({ data: { companyId: u.companyId, creditNoteId: id, invoiceId: inv.id, amount, date: new Date(new Date().toISOString().slice(0, 10)), createdById: u.id } });
      await recalcSettlement(tx, inv.id);
      await recalcSettlement(tx, id);
      await this.audit.record(def.label, id, 'APPLY_CREDIT', undefined, { invoice: inv.number, amount: amount.toString() }, tx);
      return { ok: true };
    });
  }

  /** where a credit note was applied, or which notes settled an invoice */
  async credits(type: string, id: string) {
    this.assertId(id);
    const def = this.def(type);
    RequestCtx.assert(`${def.permission}.read`);
    await this.findOwned(def, id);
    const apps = await this.prisma.creditApplication.findMany({ where: def.returnOf ? { creditNoteId: id } : { invoiceId: id }, orderBy: { createdAt: 'asc' } });
    const docs = new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: apps.map((a) => (def.returnOf ? a.invoiceId : a.creditNoteId)) } }, select: { id: true, number: true, docType: true, date: true } })).map((d) => [d.id, d]));
    const open = def.returnOf
      ? await this.prisma.tradeDocument.findMany({
          where: { companyId: RequestCtx.companyId(), docType: def.returnOf, deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL'] }, customerId: (await this.findOwned(def, id)).customerId, supplierId: (await this.findOwned(def, id)).supplierId },
          select: { id: true, number: true, date: true, grandTotal: true, paidAmount: true },
          orderBy: { date: 'asc' },
        })
      : [];
    return {
      applications: apps.map((a) => ({ id: a.id, amount: a.amount, date: a.date, document: docs.get(def.returnOf ? a.invoiceId : a.creditNoteId) ?? null })),
      openInvoices: open.map((o) => ({ ...o, balance: D(o.grandTotal).minus(D(o.paidAmount)) })),
    };
  }

  /** Remaining (not yet converted) quantity of every source line for a target type */
  private async consumed(tx: Tx | PrismaService, sourceId: string, targetType?: string, excludeDocId?: string) {
    const rows = await tx.tradeDocumentLine.findMany({
      where: { sourceLineId: { not: null }, document: { sourceId, deletedAt: null, status: { not: 'CANCELLED' }, ...(targetType ? { docType: targetType } : {}), ...(excludeDocId ? { id: { not: excludeDocId } } : {}) } },
      select: { sourceLineId: true, qty: true, document: { select: { docType: true } } },
    });
    const map = new Map<string, Prisma.Decimal>();
    for (const r of rows) {
      const k = targetType ? r.sourceLineId! : `${r.document.docType}:${r.sourceLineId}`;
      map.set(k, (map.get(k) ?? ZERO).plus(D(r.qty)));
    }
    return map;
  }

  private async checkSourceQuantities(tx: Tx, def: DocTypeDef, doc: FullDoc) {
    if (!doc.sourceId) return;
    const src = await tx.tradeDocument.findUnique({ where: { id: doc.sourceId }, include: { lines: true } });
    if (!src || src.status === 'CANCELLED' || src.status === 'DRAFT') throw new ConflictException('Source document is not confirmed');
    const used = await this.consumed(tx, src.id, def.code, doc.id);
    for (const l of doc.lines) {
      if (!l.sourceLineId) continue;
      const sl = src.lines.find((x) => x.id === l.sourceLineId);
      if (!sl) throw new BadRequestException(`Line ${l.lineNo} does not belong to the source document`);
      const remaining = D(sl.qty).minus(used.get(sl.id) ?? ZERO);
      if (D(l.qty).gt(remaining)) throw new BadRequestException(`Line ${l.lineNo}: quantity exceeds remaining ${remaining} from ${src.number}`);
    }
  }

  private async refreshSourceStatus(tx: Tx, sourceId: string) {
    const src = await tx.tradeDocument.findUnique({ where: { id: sourceId }, include: { lines: true } });
    if (!src || src.status === 'CANCELLED' || src.status === 'DRAFT') return;
    const srcDef = DOC_MAP.get(src.docType)!;
    if (srcDef.payable) return; // invoices are driven by payments
    const used = await this.consumed(tx, sourceId);
    let any = false;
    let all = true;
    for (const l of src.lines) {
      const best = srcDef.convertTo.reduce((m, t) => {
        const v = used.get(`${t}:${l.id}`) ?? ZERO;
        return v.gt(m) ? v : m;
      }, ZERO);
      await tx.tradeDocumentLine.update({ where: { id: l.id }, data: { processedQty: best } });
      if (best.gt(0)) any = true;
      if (best.lt(D(l.qty))) all = false;
    }
    await tx.tradeDocument.update({ where: { id: sourceId }, data: { status: all ? 'COMPLETED' : any ? 'PARTIAL' : 'CONFIRMED' } });
  }

  async cancel(type: string, id: string, opts: OpeningOpts = {}) {
    this.assertId(id);
    const def = this.def(type);
    if (!opts.skipPermission) RequestCtx.assert(`${def.permission}.cancel`);
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', RequestCtx.companyId(), false);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM trade_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const doc = await this.findOwned(def, id, tx);
        if (doc.status === 'CANCELLED') throw new ConflictException('Document is already cancelled');
        const derived = await tx.tradeDocument.count({ where: { sourceId: id, deletedAt: null, status: { not: 'CANCELLED' } } });
        if (derived) throw new ConflictException('Cancel the documents created from this one first');
        let released: string[] = [];
        if (def.returnOf) {
          const apps = await tx.creditApplication.findMany({ where: { creditNoteId: id } });
          released = apps.map((a) => a.invoiceId);
          await tx.creditApplication.deleteMany({ where: { creditNoteId: id } });
        } else if (D(doc.paidAmount).gt(0)) throw new ConflictException(D(doc.creditedAmount).gt(0) ? 'Document is settled by payments or credit notes. Cancel those first.' : 'Document has payments. Cancel the payments first.');
        if (def.code === 'GR' || def.code === 'PI') {
          const lc = await tx.landedCost.findFirst({ where: { status: { not: 'CANCELLED' }, ...(def.code === 'GR' ? { lines: { some: { receiptId: id } } } : { chargeLines: { some: { sourceDocId: id } } }) }, select: { number: true } });
          if (lc) throw new ConflictException(`Landed cost ${lc.number} uses this document: cancel it first`);
        }
        if (doc.status !== 'DRAFT') {
          if (def.stock) {
            await this.inventory.reverse(tx, id, allowNegative);
            await this.lots.reverse(tx, id);
          }
          if (def.code === 'GR') await this.quality.onCancel(tx, id);
          await this.journal.voidBySource(tx, def.code, id);
        }
        const updated = await tx.tradeDocument.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), paidAmount: 0, creditedAmount: 0, updatedById: RequestCtx.user().id } });
        for (const invoiceId of new Set(released)) await recalcSettlement(tx, invoiceId);
        if (APPROVAL_DOC_TYPES.has(def.code)) await this.approvals.reset(tx, def.code, id);
        if (doc.sourceId) await this.refreshSourceStatus(tx, doc.sourceId);
        await this.audit.record(def.label, id, 'CANCEL', doc, updated, tx);
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  /** Tax invoice number (Nomor Faktur Pajak) is often issued after the invoice: editable until the invoice is cancelled */
  async setTaxInvoiceNumber(type: string, id: string, value: string | null) {
    this.assertId(id);
    const def = this.def(type);
    if (!TAX_INVOICE_TYPES.has(def.code)) throw new BadRequestException(`${def.label} has no tax invoice number`);
    RequestCtx.assert(`${def.permission}.update`);
    const v = value?.trim() ? value.trim().slice(0, 40) : null;
    const before = await this.findOwned(def, id);
    if (before.status === 'CANCELLED') throw new ConflictException('The document is cancelled');
    const after = await this.prisma.tradeDocument.update({ where: { id }, data: { taxInvoiceNumber: v, updatedById: RequestCtx.user().id } });
    await this.audit.record(def.label, id, 'UPDATE', { taxInvoiceNumber: before.taxInvoiceNumber }, { taxInvoiceNumber: after.taxInvoiceNumber });
    return after;
  }

  // ------------------------------------------------------------------ approval workflow
  /** Amount in base currency is what approval thresholds are compared with */
  private approvalSubject(def: DocTypeDef, doc: { id: string; number: string; grandTotal: Prisma.Decimal; exchangeRate: Prisma.Decimal }) {
    return { docType: def.code, documentId: doc.id, documentNumber: doc.number, amount: round(D(doc.grandTotal).times(D(doc.exchangeRate))), label: `${def.label} ${doc.number}` };
  }

  private approvalDef(type: string) {
    const def = this.def(type);
    if (!APPROVAL_DOC_TYPES.has(def.code)) throw new NotFoundException(`${def.label} does not use the approval workflow`);
    return def;
  }

  async approval(type: string, id: string) {
    const def = this.approvalDef(type);
    RequestCtx.assert(`${def.permission}.read`);
    this.assertId(id);
    const doc = await this.findOwned(def, id);
    const info = await this.approvals.info(doc.companyId, this.approvalSubject(def, doc));
    const canRequest = doc.status === 'DRAFT' && (RequestCtx.can(`${def.permission}.confirm`) || RequestCtx.can(`${def.permission}.update`)) && ['NOT_REQUESTED', 'REJECTED'].includes(info.status);
    return { ...info, canRequest };
  }

  async requestApproval(type: string, id: string) {
    const def = this.approvalDef(type);
    if (!RequestCtx.can(`${def.permission}.confirm`)) RequestCtx.assert(`${def.permission}.update`);
    this.assertId(id);
    const doc = await this.findOwned(def, id);
    if (doc.status !== 'DRAFT') throw new ConflictException('Only draft documents can be sent for approval');
    const req = await this.approvals.submit(this.approvalSubject(def, doc));
    if (!req) throw new ConflictException(`${def.label} ${doc.number} does not need approval. You can confirm it directly.`);
    return req;
  }

  /** Creates a draft target document prefilled with the remaining quantities */
  async convert(type: string, id: string, targetType: string) {
    const def = this.def(type);
    const target = this.def(targetType);
    if (!def.convertTo.includes(target.code)) throw new BadRequestException(`${def.label} cannot be converted to ${target.label}`);
    RequestCtx.assert(`${def.permission}.read`);
    const src = await this.findOwned(def, id);
    if (!['CONFIRMED', 'PARTIAL', 'COMPLETED'].includes(src.status)) throw new ConflictException('Only confirmed documents can be converted');
    const used = await this.consumed(this.prisma, id, target.code);
    const products = await this.prisma.product.findMany({ where: { id: { in: src.lines.map((l) => l.productId).filter(Boolean) as string[] } }, select: { id: true, type: true } });
    const ptype = new Map(products.map((p) => [p.id, p.type]));
    // documents made before the company stopped charging VAT: the new sales document carries no PPN
    const keepTax = target.taxField !== 'saleTaxId' || (await this.settings.bool('sales.vatPayer', src.companyId, true));
    const lines = src.lines
      .map((l) => ({ l, remaining: D(l.qty).minus(used.get(l.id) ?? ZERO) }))
      .filter(({ l, remaining }) => remaining.gt(0) && (!target.stockItemsOnly || (l.productId && ptype.get(l.productId) === 'STOCK')))
      .map(({ l, remaining }) => ({
        productId: l.productId,
        description: l.description,
        qty: remaining.toNumber(),
        uomId: l.uomId,
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
        taxId: keepTax ? l.taxId : null,
        sourceLineId: l.id,
      }));
    if (!lines.length) throw new ConflictException(`Nothing left to convert into a ${target.label}`);
    return this.create(
      target.code,
      {
        date: new Date().toISOString().slice(0, 10),
        customerId: src.customerId,
        supplierId: src.supplierId,
        warehouseId: src.warehouseId,
        paymentTermId: src.paymentTermId,
        projectId: src.projectId,
        opportunityId: src.opportunityId,
        ownerId: src.ownerId,
        branchId: src.branchId,
        currencyCode: src.currencyCode,
        exchangeRate: Number(src.exchangeRate),
        reference: src.number,
        notes: src.notes,
        terms: target.code === 'SI' ? undefined : src.terms,
        lines,
      },
      src.id,
    );
  }
}
