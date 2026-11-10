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
import { InventoryService } from './inventory.service';
import { DOC_MAP, DocTypeDef } from './document.registry';
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

const TAX_INVOICE_TYPES = new Set(['SI', 'PI']);

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
      this.prisma.product.findMany({ where: { id: { in: doc.lines.map((l) => l.productId).filter(Boolean) as string[] } }, select: { id: true, code: true, name: true, type: true } }),
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
    if (def.warehouse !== 'none' && def.warehouse !== 'optional' && !input.warehouseId) {
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
    for (const l of input.lines) {
      const p = l.productId ? pm.get(l.productId) : undefined;
      if (l.taxId === undefined && p && def.taxField) l.taxId = p[def.taxField];
      if (l.taxId) taxIds.add(l.taxId);
    }
    const taxes = await this.prisma.tax.findMany({ where: { id: { in: [...taxIds] }, companyId, deletedAt: null } });
    if (taxes.length !== taxIds.size) throw new BadRequestException('One or more taxes are invalid');
    const txm = new Map(taxes.map((t) => [t.id, t]));
    const uomIds = [...new Set(input.lines.map((l) => l.uomId).filter(Boolean) as string[])];
    if (uomIds.length && (await this.prisma.uom.count({ where: { id: { in: uomIds }, companyId } })) !== uomIds.length) throw new BadRequestException('Invalid unit of measure');

    const lines = input.lines.map((l, i) => {
      const p = l.productId ? pm.get(l.productId) : undefined;
      if (!p && !l.description) throw new BadRequestException(`Line ${i + 1}: choose a product or enter a description`);
      if (def.stockItemsOnly && p?.type !== 'STOCK') throw new BadRequestException(`Line ${i + 1}: only stock products are allowed in a ${def.label}`);
      if (def.stock !== 'adjust' && l.qty < 0) throw new BadRequestException(`Line ${i + 1}: quantity must be positive`);
      const qty = D(l.qty);
      const price = def.priced ? D(l.unitPrice ?? (p && def.priceField ? p[def.priceField] : 0)) : D(l.unitPrice ?? 0);
      const subtotal = round(qty.times(price));
      const discount = round(subtotal.times(D(l.discountPct)).div(100));
      const rate = def.taxField && l.taxId ? D(txm.get(l.taxId)!.rate) : ZERO;
      const tax = round(subtotal.minus(discount).times(rate).div(100));
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
        lineTotal: subtotal.minus(discount).plus(tax),
        sourceLineId: l.sourceLineId ?? null,
      };
    });
    const subtotal = sum(lines.map((l) => l.lineSubtotal));
    const discountTotal = sum(lines.map((l) => l.lineDiscount));
    const taxTotal = sum(lines.map((l) => l.lineTax));
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
      grandTotal: subtotal.minus(discountTotal).plus(taxTotal),
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
        await this.checkSourceQuantities(tx, def, doc);
        if (APPROVAL_DOC_TYPES.has(def.code) && !doc.isOpening) await this.approvals.assertApproved(u.companyId, this.approvalSubject(def, doc), tx);

        await this.post(tx, def, doc, allowNegative);

        const updated = await tx.tradeDocument.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: u.id } });
        if (doc.sourceId) await this.refreshSourceStatus(tx, doc.sourceId);
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
      if (def.stock && isStock && p) {
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
    if (def.code === 'PI') j.push({ key: 'AP', credit: sum(j.map((x) => D(x.debit))), ...party, description: doc.number });

    if (j.length) {
      await this.journal.post(tx, { companyId: doc.companyId, branchId: doc.branchId, date: doc.date, description: `${def.label} ${doc.number}`, reference: doc.reference ?? undefined, sourceType: def.code, sourceId: doc.id, lines: j });
    }
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
        if (D(doc.paidAmount).gt(0)) throw new ConflictException('Document has payments. Cancel the payments first.');
        if (doc.status !== 'DRAFT') {
          if (def.stock) await this.inventory.reverse(tx, id, allowNegative);
          await this.journal.voidBySource(tx, def.code, id);
        }
        const updated = await tx.tradeDocument.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), updatedById: RequestCtx.user().id } });
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
        taxId: l.taxId,
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
