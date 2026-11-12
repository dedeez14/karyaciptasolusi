import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { DocumentService } from '../documents/document.service';
import { PdfService, PrintableDocument } from '../print/pdf.service';
import { code128, code128Encodable } from './code128';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Inventory tools: barcode lookup and labels, reorder planning (draft purchase orders) and stock counts (stock opname).
 * Stock is valued with the moving weighted average (allowed by UU PPh Pasal 10 ayat 6 and SAK EP Bab 13; LIFO is not).
 * A posted stock count creates a confirmed stock adjustment; its report (berita acara) is kept with the books (10 years).
 */
@Injectable()
export class InventoryToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly documents: DocumentService,
    private readonly pdf: PdfService,
  ) {}

  // ------------------------------------------------------------------ barcode lookup
  /** product by barcode or code (scanner / camera), with stock per warehouse */
  async lookup(code: string) {
    RequestCtx.assert('master.product.read');
    const companyId = RequestCtx.companyId();
    const c = code.trim();
    if (!c) throw new BadRequestException('Scan or type a barcode');
    const p = await this.prisma.product.findFirst({
      where: { companyId, deletedAt: null, OR: [{ barcode: c }, { code: { equals: c, mode: 'insensitive' } }, ...(UUID.test(c) ? [{ id: c }] : [])] },
      include: { uom: { select: { code: true } } },
    });
    if (!p) throw new NotFoundException(`No product with barcode or code "${c}"`);
    const balances = await this.prisma.stockBalance.findMany({ where: { companyId, productId: p.id }, select: { warehouseId: true, qty: true } });
    const whs = new Map((await this.prisma.warehouse.findMany({ where: { id: { in: balances.map((b) => b.warehouseId) } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      barcode: p.barcode,
      type: p.type,
      uom: p.uom?.code ?? null,
      salePrice: n(p.salePrice),
      minStock: n(p.minStock),
      stock: balances.map((b) => ({ warehouseId: b.warehouseId, warehouse: whs.get(b.warehouseId) ?? '-', qty: n(b.qty) })),
      onHand: balances.reduce((a, b) => a + n(b.qty), 0),
    };
  }

  // ------------------------------------------------------------------ labels
  /** A4 sheet of barcode labels (3 x 8), Code 128 of the barcode or, when there is none, the product code */
  async labels(ids: string[], copies: number, showPrice: boolean) {
    RequestCtx.assert('master.product.read');
    const companyId = RequestCtx.companyId();
    const valid = ids.filter((i) => UUID.test(i)).slice(0, 200);
    if (!valid.length) throw new BadRequestException('Choose at least one product');
    const products = await this.prisma.product.findMany({ where: { companyId, id: { in: valid }, deletedAt: null } });
    const order = new Map(valid.map((id, i) => [id, i]));
    products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const locale = await this.settings.str('general.locale', companyId, 'id-ID');
    const items = products.flatMap((p) => Array.from({ length: Math.min(100, Math.max(1, copies)) }, () => p));

    const doc = new PDFDocument({ size: 'A4', margins: { top: 0, left: 0, right: 0, bottom: 0 }, info: { Title: 'Barcode labels' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));
    // 3 x 8 labels of 70 x 37 mm (common A4 label sheets)
    const mm = 72 / 25.4;
    const cols = 3;
    const rows = 8;
    const w = 70 * mm;
    const h = 37 * mm;
    const top = (297 * mm - rows * h) / 2;
    items.forEach((p, i) => {
      const slot = i % (cols * rows);
      if (i > 0 && slot === 0) doc.addPage();
      const x = (slot % cols) * w;
      const y = top + Math.floor(slot / cols) * h;
      const pad = 4 * mm;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text(p.name, x + pad, y + pad, { width: w - 2 * pad, height: 20, ellipsis: true, lineGap: 0.5 });
      const text = p.barcode && code128Encodable(p.barcode) ? p.barcode : p.code;
      const bars = code128(text);
      const modules = bars.reduce((a, b) => a + b, 0);
      const maxW = w - 2 * pad;
      const unit = Math.min(maxW / modules, 1.2);
      let bx = x + (w - modules * unit) / 2;
      const by = y + pad + 22;
      const bh = 13 * mm;
      doc.fillColor('#000000');
      bars.forEach((m, k) => {
        if (k % 2 === 0) doc.rect(bx, by, m * unit, bh).fill();
        bx += m * unit;
      });
      doc.font('Helvetica').fontSize(7.5).fillColor('#0f172a').text(text, x + pad, by + bh + 3.5, { width: w - 2 * pad, align: 'center', characterSpacing: 0.4 });
      const bottom = y + h - pad - 9;
      doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(p.code, x + pad, bottom, { width: (w - 2 * pad) / 2, lineBreak: false });
      if (showPrice) doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`Rp ${n(p.salePrice).toLocaleString(locale)}`, x + w / 2, bottom - 1, { width: w / 2 - pad, align: 'right', lineBreak: false });
    });
    doc.end();
    return done;
  }

  // ------------------------------------------------------------------ reorder planning
  /**
   * Products at or below their reorder point (minimum stock), counting what is already ordered from suppliers
   * and what is promised to customers: available = on hand + on order - reserved.
   */
  async reorder(warehouseId?: string) {
    RequestCtx.assert('inventory.stock.read');
    const companyId = RequestCtx.companyId();
    const wh = warehouseId && UUID.test(warehouseId) ? warehouseId : null;
    const whSql = (col: string) => (wh ? Prisma.sql`AND ${Prisma.raw(col)} = ${wh}::uuid` : Prisma.empty);
    const rows = await this.prisma.$queryRaw<
      { id: string; code: string; name: string; uom: string | null; minStock: Prisma.Decimal; maxStock: Prisma.Decimal; reorderQty: Prisma.Decimal; leadTimeDays: number; purchasePrice: Prisma.Decimal; preferredSupplierId: string | null; onhand: Prisma.Decimal; onorder: Prisma.Decimal; reserved: Prisma.Decimal; lastsupplier: string | null }[]
    >`
      SELECT p.id, p.code, p.name, u.code AS uom, p."minStock", p."maxStock", p."reorderQty", p."leadTimeDays", p."purchasePrice", p."preferredSupplierId",
        COALESCE((SELECT SUM(b.qty) FROM stock_balances b WHERE b."productId" = p.id ${whSql('b."warehouseId"')}), 0) AS onhand,
        COALESCE((SELECT SUM(l.qty - l."processedQty") FROM trade_document_lines l JOIN trade_documents d ON d.id = l."documentId"
                  WHERE l."productId" = p.id AND d."companyId" = ${companyId}::uuid AND d."docType" = 'PO' AND d.status IN ('CONFIRMED','PARTIAL') AND d."deletedAt" IS NULL
                  ${wh ? Prisma.sql`AND (d."warehouseId" IS NULL OR d."warehouseId" = ${wh}::uuid)` : Prisma.empty}), 0) AS onorder,
        COALESCE((SELECT SUM(l.qty - l."processedQty") FROM trade_document_lines l JOIN trade_documents d ON d.id = l."documentId"
                  WHERE l."productId" = p.id AND d."companyId" = ${companyId}::uuid AND d."docType" = 'SO' AND d.status IN ('CONFIRMED','PARTIAL') AND d."deletedAt" IS NULL
                  ${wh ? Prisma.sql`AND (d."warehouseId" IS NULL OR d."warehouseId" = ${wh}::uuid)` : Prisma.empty}), 0) AS reserved,
        (SELECT d."supplierId"::text FROM trade_document_lines l JOIN trade_documents d ON d.id = l."documentId"
          WHERE l."productId" = p.id AND d."companyId" = ${companyId}::uuid AND d."docType" IN ('PO','PI') AND d.status <> 'CANCELLED' AND d."deletedAt" IS NULL AND d."supplierId" IS NOT NULL
          ORDER BY d.date DESC LIMIT 1) AS lastsupplier
      FROM products p LEFT JOIN uoms u ON u.id = p."uomId"
      WHERE p."companyId" = ${companyId}::uuid AND p.type = 'STOCK' AND p."isActive" AND p."isPurchasable" AND p."deletedAt" IS NULL
        AND (p."minStock" > 0 OR p."maxStock" > 0)
      ORDER BY p.name`;
    const out = rows
      .map((r) => {
        const available = n(r.onhand) + n(r.onorder) - n(r.reserved);
        const min = n(r.minStock);
        const max = n(r.maxStock);
        const rq = n(r.reorderQty);
        if (available > min) return null;
        const target = max > 0 ? max : min + rq;
        const suggested = Math.ceil(Math.max(target - available, rq, 0));
        return {
          productId: r.id,
          code: r.code,
          name: r.name,
          uom: r.uom,
          onHand: n(r.onhand),
          onOrder: n(r.onorder),
          reserved: n(r.reserved),
          available,
          minStock: min,
          maxStock: max,
          reorderQty: rq,
          leadTimeDays: r.leadTimeDays,
          suggested,
          unitPrice: n(r.purchasePrice),
          supplierId: r.preferredSupplierId ?? r.lastsupplier ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.suggested > 0);
    const supplierIds = [...new Set(out.map((x) => x.supplierId).filter(Boolean) as string[])];
    const suppliers = new Map((await this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return out.map((x) => ({ ...x, supplierName: x.supplierId ? suppliers.get(x.supplierId) ?? null : null }));
  }

  /** draft purchase orders, one per supplier, from the chosen suggestions */
  async createPurchaseOrders(input: { warehouseId?: string | null; lines: { productId: string; supplierId: string; qty: number }[] }) {
    RequestCtx.assert('purchase.order.create');
    const companyId = RequestCtx.companyId();
    const lines = input.lines.filter((l) => UUID.test(l.productId) && UUID.test(l.supplierId) && l.qty > 0);
    if (!lines.length) throw new BadRequestException('Choose at least one product with a supplier and a quantity');
    const products = new Map((await this.prisma.product.findMany({ where: { companyId, id: { in: lines.map((l) => l.productId) } }, select: { id: true, purchasePrice: true, leadTimeDays: true } })).map((p) => [p.id, p]));
    const bySupplier = new Map<string, typeof lines>();
    for (const l of lines) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), l]);
    const created: { id: string; number: string; supplierId: string }[] = [];
    for (const [supplierId, ls] of bySupplier) {
      const lead = Math.max(0, ...ls.map((l) => products.get(l.productId)?.leadTimeDays ?? 0));
      const doc = await this.documents.create('PO', {
        date: new Date().toISOString().slice(0, 10),
        dueDate: lead ? new Date(Date.now() + lead * 86_400_000).toISOString().slice(0, 10) : undefined,
        supplierId,
        warehouseId: input.warehouseId || undefined,
        notes: 'Created by the Reorder Planner',
        lines: ls.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: n(products.get(l.productId)?.purchasePrice) })),
      });
      created.push({ id: (doc as { id: string }).id, number: (doc as { number: string }).number, supplierId });
    }
    return { created };
  }

  // ------------------------------------------------------------------ stock count (stock opname)
  private async ownCount(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Stock count not found');
    const c = await this.prisma.stockCount.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!c) throw new NotFoundException('Stock count not found');
    return c;
  }

  async listCounts() {
    RequestCtx.assert('inventory.adjustment.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.stockCount.findMany({ where: { companyId, deletedAt: null }, orderBy: { countDate: 'desc' }, take: 200, include: { _count: { select: { lines: true } } } });
    const whs = new Map((await this.prisma.warehouse.findMany({ where: { id: { in: rows.map((r) => r.warehouseId) } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
    const counted = await this.prisma.stockCountLine.groupBy({ by: ['countId'], where: { countId: { in: rows.map((r) => r.id) }, countedQty: { not: null } }, _count: { _all: true } });
    const cm = new Map(counted.map((c) => [c.countId, c._count._all]));
    return rows.map((r) => ({ ...r, warehouseName: whs.get(r.warehouseId) ?? '-', lineCount: r._count.lines, countedCount: cm.get(r.id) ?? 0 }));
  }

  /** starts a count: every active stock product (optionally one category) with its book quantity in the warehouse */
  async startCount(input: { warehouseId: string; countDate: Date; categoryId?: string | null; countedBy?: string | null; witnessedBy?: string | null; notes?: string | null }) {
    RequestCtx.assert('inventory.adjustment.create');
    const u = RequestCtx.user();
    const wh = await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } });
    if (!wh) throw new BadRequestException({ message: 'Validation failed', errors: { warehouseId: 'Choose a warehouse' } });
    const open = await this.prisma.stockCount.findFirst({ where: { companyId: u.companyId, warehouseId: wh.id, status: 'COUNTING', deletedAt: null } });
    if (open) throw new ConflictException(`Count ${open.number} of this warehouse is still open. Post or cancel it first.`);
    const products = await this.prisma.product.findMany({ where: { companyId: u.companyId, type: 'STOCK', isActive: true, deletedAt: null, ...(input.categoryId ? { categoryId: input.categoryId } : {}) }, select: { id: true } });
    const balances = new Map((await this.prisma.stockBalance.findMany({ where: { warehouseId: wh.id, productId: { in: products.map((p) => p.id) } } })).map((b) => [b.productId, b]));
    const count = await this.prisma.$transaction(async (tx) => {
      const c = await tx.stockCount.create({
        data: {
          companyId: u.companyId,
          branchId: wh.branchId,
          number: await this.sequence.next('STOCK_COUNT', u.companyId, input.countDate, tx),
          warehouseId: wh.id,
          countDate: input.countDate,
          countedBy: input.countedBy ?? null,
          witnessedBy: input.witnessedBy ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
          lines: { create: products.map((p) => ({ productId: p.id, systemQty: balances.get(p.id)?.qty ?? 0, unitCost: balances.get(p.id)?.avgCost ?? 0 })) },
        },
      });
      await this.audit.record('Stock Count', c.id, 'CREATE', undefined, { number: c.number, warehouse: wh.name, products: products.length }, tx);
      return c;
    });
    return count;
  }

  async getCount(id: string) {
    RequestCtx.assert('inventory.adjustment.read');
    const c = await this.ownCount(id);
    const lines = await this.prisma.stockCountLine.findMany({ where: { countId: id } });
    const [products, balances, wh] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, code: true, name: true, barcode: true, uom: { select: { code: true } } } }),
      c.status === 'COUNTING' ? this.prisma.stockBalance.findMany({ where: { warehouseId: c.warehouseId, productId: { in: lines.map((l) => l.productId) } } }) : Promise.resolve([]),
      this.prisma.warehouse.findUnique({ where: { id: c.warehouseId }, select: { name: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const bm = new Map(balances.map((b) => [b.productId, b]));
    const adjustment = c.adjustmentId ? await this.prisma.tradeDocument.findUnique({ where: { id: c.adjustmentId }, select: { id: true, number: true } }) : null;
    return {
      ...c,
      warehouseName: wh?.name ?? '-',
      adjustment,
      lines: lines
        .map((l) => {
          const p = pm.get(l.productId);
          // while counting, compare with the current book quantity (goods may still move); after posting, with the posted one
          const book = c.status === 'COUNTING' ? n(bm.get(l.productId)?.qty ?? l.systemQty) : n(l.systemQty);
          const cost = c.status === 'COUNTING' ? n(bm.get(l.productId)?.avgCost ?? l.unitCost) : n(l.unitCost);
          const counted = l.countedQty === null ? null : n(l.countedQty);
          return { id: l.id, productId: l.productId, code: p?.code ?? '', name: p?.name ?? '', barcode: p?.barcode ?? null, uom: p?.uom?.code ?? null, systemQty: book, countedQty: counted, difference: counted === null ? null : counted - book, unitCost: cost, value: counted === null ? null : (counted - book) * cost, note: l.note, countedAt: l.countedAt };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async updateCount(id: string, input: { countedBy?: string | null; witnessedBy?: string | null; notes?: string | null }) {
    RequestCtx.assert('inventory.adjustment.create');
    const c = await this.ownCount(id);
    if (c.status !== 'COUNTING') throw new ConflictException('This count is closed');
    return this.prisma.stockCount.update({ where: { id }, data: { countedBy: input.countedBy ?? c.countedBy, witnessedBy: input.witnessedBy ?? c.witnessedBy, notes: input.notes ?? c.notes, updatedById: RequestCtx.user().id } });
  }

  /** records the quantity found for a product (adds products found that were not on the list) */
  async setCounted(id: string, input: { productId: string; countedQty: number | null; note?: string | null; add?: boolean }) {
    RequestCtx.assert('inventory.adjustment.create');
    const c = await this.ownCount(id);
    if (c.status !== 'COUNTING') throw new ConflictException('This count is closed');
    if (input.countedQty !== null && (input.countedQty < 0 || !Number.isFinite(input.countedQty))) throw new BadRequestException('Counted quantity cannot be negative');
    const p = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: c.companyId, deletedAt: null, type: 'STOCK' } });
    if (!p) throw new BadRequestException('Only stock products can be counted');
    const existing = await this.prisma.stockCountLine.findUnique({ where: { countId_productId: { countId: id, productId: p.id } } });
    const prev = existing?.countedQty === null || existing?.countedQty === undefined ? 0 : n(existing.countedQty);
    // "add" sums repeated scans of the same product; otherwise the quantity replaces what was entered
    const qty = input.countedQty === null ? null : input.add ? prev + input.countedQty : input.countedQty;
    if (existing) {
      return this.prisma.stockCountLine.update({ where: { id: existing.id }, data: { countedQty: qty, note: input.note ?? existing.note, countedAt: qty === null ? null : new Date() } });
    }
    const bal = await this.prisma.stockBalance.findUnique({ where: { productId_warehouseId: { productId: p.id, warehouseId: c.warehouseId } } });
    return this.prisma.stockCountLine.create({ data: { countId: id, productId: p.id, systemQty: bal?.qty ?? 0, unitCost: bal?.avgCost ?? 0, countedQty: qty, note: input.note ?? null, countedAt: qty === null ? null : new Date() } });
  }

  /** posts the differences as a confirmed stock adjustment (gain / loss at average cost) and closes the count */
  async postCount(id: string, opts: { uncountedAsZero?: boolean }) {
    RequestCtx.assert('inventory.adjustment.confirm');
    const c = await this.ownCount(id);
    if (c.status !== 'COUNTING') throw new ConflictException('This count is already closed');
    const lines = await this.prisma.stockCountLine.findMany({ where: { countId: id } });
    const uncounted = lines.filter((l) => l.countedQty === null);
    if (uncounted.length && !opts.uncountedAsZero) throw new BadRequestException(`${uncounted.length} product(s) have not been counted. Count them, or post with "not counted = not found (0)".`);
    const balances = new Map((await this.prisma.stockBalance.findMany({ where: { warehouseId: c.warehouseId, productId: { in: lines.map((l) => l.productId) } } })).map((b) => [b.productId, b]));
    // the book quantity at posting time (movements during the count are respected)
    const final = lines.map((l) => {
      const book = n(balances.get(l.productId)?.qty ?? 0);
      const counted = l.countedQty === null ? 0 : n(l.countedQty);
      return { id: l.id, productId: l.productId, book, counted, diff: Math.round((counted - book) * 10_000) / 10_000, cost: n(balances.get(l.productId)?.avgCost ?? l.unitCost) };
    });
    const diffs = final.filter((f) => f.diff !== 0);
    let adjustmentId: string | null = null;
    if (diffs.length) {
      const adj = (await this.documents.create('ADJ', {
        date: c.countDate.toISOString().slice(0, 10),
        warehouseId: c.warehouseId,
        reference: c.number,
        notes: `Stock count ${c.number}`,
        lines: diffs.map((f) => ({ productId: f.productId, qty: f.diff, description: `Count ${f.counted} vs book ${f.book}` })),
      })) as { id: string };
      await this.documents.confirm('ADJ', adj.id);
      adjustmentId = adj.id;
    }
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      for (const f of final) await tx.stockCountLine.update({ where: { id: f.id }, data: { systemQty: D(f.book), countedQty: D(f.counted), unitCost: D(f.cost) } });
      await tx.stockCount.update({ where: { id }, data: { status: 'POSTED', adjustmentId, postedAt: new Date(), postedById: u.id, updatedById: u.id } });
      await this.audit.record('Stock Count', id, 'POST', { status: 'COUNTING' }, { status: 'POSTED', differences: diffs.length, adjustmentId }, tx);
    });
    return { ok: true, adjustmentId, differences: diffs.length };
  }

  async cancelCount(id: string) {
    RequestCtx.assert('inventory.adjustment.create');
    const c = await this.ownCount(id);
    if (c.status !== 'COUNTING') throw new ConflictException('Only an open count can be cancelled');
    await this.prisma.stockCount.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Stock Count', id, 'CANCEL', { status: 'COUNTING' }, { status: 'CANCELLED' });
    return { ok: true };
  }

  /** Berita Acara Stock Opname: the signed record of the count (supporting document for the books, kept 10 years) */
  async countReport(id: string): Promise<{ doc: PrintableDocument; name: string }> {
    const c = await this.getCount(id);
    const locale = await this.settings.str('general.locale', RequestCtx.companyId(), 'id-ID');
    const q = (v: number | null) => (v === null ? '-' : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(v));
    const m = (v: number | null) => (v === null ? '-' : this.pdf.money(v, locale));
    const shown = c.lines.filter((l) => l.countedQty !== null || l.systemQty !== 0);
    const plus = shown.reduce((a, l) => a + Math.max(0, l.value ?? 0), 0);
    const minus = shown.reduce((a, l) => a + Math.min(0, l.value ?? 0), 0);
    const date = new Date(c.countDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
      name: `Berita_Acara_Stock_Opname_${c.number}.pdf`,
      doc: {
        title: 'Berita Acara Stock Opname',
        number: c.number,
        status: c.status === 'COUNTING' ? 'Draft' : c.status === 'CANCELLED' ? 'Cancelled' : undefined,
        meta: [
          { label: 'Tanggal', value: date },
          { label: 'Gudang', value: c.warehouseName },
          { label: 'Penyesuaian', value: c.adjustment?.number ?? (c.status === 'POSTED' ? 'Tidak ada selisih' : '-') },
          { label: 'Dihitung oleh', value: c.countedBy ?? '' },
          { label: 'Saksi', value: c.witnessedBy ?? '' },
        ],
        columns: [
          { key: 'code', label: 'Kode', width: 1.2 },
          { key: 'name', label: 'Barang', width: 3.2 },
          { key: 'uom', label: 'Satuan', width: 0.8 },
          { key: 'book', label: 'Buku', width: 1, align: 'right' },
          { key: 'counted', label: 'Fisik', width: 1, align: 'right' },
          { key: 'diff', label: 'Selisih', width: 1, align: 'right' },
          { key: 'value', label: 'Nilai selisih', width: 1.6, align: 'right' },
        ],
        rows: shown.map((l) => ({ code: l.code, name: l.note ? `${l.name}
${l.note}` : l.name, uom: l.uom ?? '', book: q(l.systemQty), counted: q(l.countedQty), diff: q(l.difference), value: m(l.value) })),
        totals: [
          { label: 'Selisih lebih', value: m(plus) },
          { label: 'Selisih kurang', value: m(minus) },
          { label: 'Selisih bersih', value: m(plus + minus), bold: true },
        ],
        notes: [
          `Pada hari ${date} telah dilakukan perhitungan fisik persediaan (stock opname) di gudang ${c.warehouseName} dengan hasil sebagaimana tercantum di atas. Selisih dinilai dengan biaya rata-rata tertimbang dan dicatat sebagai penyesuaian persediaan.`,
          c.notes ?? '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        signatures: ['Dihitung oleh', 'Saksi', 'Mengetahui'],
      },
    };
  }
}
