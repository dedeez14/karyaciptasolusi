import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { LotService } from '../documents/lot.service';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const bomSchema = z.object({
  code: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1).max(200),
  productId: z.uuid(),
  outputQty: z.coerce.number().positive().max(1e9),
  labourCost: z.coerce.number().min(0).max(1e14).default(0),
  overheadCost: z.coerce.number().min(0).max(1e14).default(0),
  isDefault: z.boolean().default(true),
  isActive: z.boolean().default(true),
  notes: optText(2000),
  lines: z
    .array(z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e9), scrapPct: z.coerce.number().min(0).max(100).default(0), notes: optText(300) }))
    .min(1, 'Add at least one component')
    .max(200),
});

export const workOrderSchema = z.object({
  bomId: z.uuid(),
  qty: z.coerce.number().positive().max(1e9),
  warehouseId: z.uuid(),
  outputWarehouseId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  plannedDate: z.coerce.date(),
  lotNo: optText(60),
  expiryDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  notes: optText(2000),
});

export const completeSchema = z.object({
  date: z.coerce.date(),
  producedQty: z.coerce.number().positive().max(1e9),
  /** actual quantities used, per work order line (default: planned) */
  consumed: z.array(z.object({ lineId: z.uuid(), qty: z.coerce.number().min(0).max(1e9) })).max(200).default([]),
  lotNo: optText(60),
  expiryDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
});

/**
 * Manufacturing: bills of materials and work orders.
 * Cost of a finished product (SAK EP Bab 13, cost of conversion): materials actually issued at moving average cost
 * + standard direct labour + production overhead allocated per batch (set at normal capacity). The labour and overhead
 * applied are credited to "applied" accounts, so whatever was spent but not absorbed stays an expense of the period.
 */
@Injectable()
export class ManufacturingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly lots: LotService,
  ) {}

  // ------------------------------------------------------------------ bills of materials
  async listBoms() {
    RequestCtx.assert('manufacturing.bom.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.bom.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' }, include: { _count: { select: { lines: true } } } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const costs = await Promise.all(rows.map((r) => this.estimate(r.id)));
    return rows.map((r, i) => ({ ...r, product: products.get(r.productId) ?? null, lineCount: r._count.lines, estimate: costs[i] }));
  }

  async getBom(id: string) {
    RequestCtx.assert('manufacturing.bom.read');
    const b = await this.ownBom(id);
    const lines = await this.prisma.bomLine.findMany({ where: { bomId: id }, orderBy: { lineNo: 'asc' } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [b.productId, ...lines.map((l) => l.productId)] } }, select: { id: true, code: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    return { ...b, product: products.get(b.productId) ?? null, lines: lines.map((l) => ({ ...l, product: products.get(l.productId) ?? null })), estimate: await this.estimate(id) };
  }

  /** estimated cost of one batch and per unit from current average costs */
  private async estimate(bomId: string) {
    const b = await this.prisma.bom.findUnique({ where: { id: bomId }, include: { lines: true } });
    if (!b) return null;
    const avg = await this.avgCosts(b.companyId, b.lines.map((l) => l.productId));
    const material = b.lines.reduce((a, l) => a + n(l.qty) * (1 + n(l.scrapPct) / 100) * (avg.get(l.productId) ?? 0), 0);
    const batch = material + n(b.labourCost) + n(b.overheadCost);
    return { material: Math.round(material), labour: n(b.labourCost), overhead: n(b.overheadCost), batch: Math.round(batch), perUnit: Math.round((batch / (n(b.outputQty) || 1)) * 100) / 100 };
  }

  /** company-wide weighted average cost per product (falls back to the purchase price) */
  private async avgCosts(companyId: string, productIds: string[]) {
    const rows = await this.prisma.$queryRaw<{ id: string; cost: Prisma.Decimal | null; price: Prisma.Decimal }[]>`
      SELECT p.id, CASE WHEN SUM(b.qty) > 0 THEN SUM(b.qty * b."avgCost") / SUM(b.qty) END AS cost, p."purchasePrice" AS price
      FROM products p LEFT JOIN stock_balances b ON b."productId" = p.id AND b.qty > 0
      WHERE p."companyId" = ${companyId}::uuid AND p.id IN (${Prisma.join(productIds.length ? productIds.map((i) => Prisma.sql`${i}::uuid`) : [Prisma.sql`NULL::uuid`])})
      GROUP BY p.id`;
    return new Map(rows.map((r) => [r.id, r.cost !== null ? n(r.cost) : n(r.price)]));
  }

  private async ownBom(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Bill of materials not found');
    const b = await this.prisma.bom.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!b) throw new NotFoundException('Bill of materials not found');
    return b;
  }

  async saveBom(id: string | null, input: z.infer<typeof bomSchema>) {
    RequestCtx.assert(id ? 'manufacturing.bom.update' : 'manufacturing.bom.create');
    const u = RequestCtx.user();
    const ids = [input.productId, ...input.lines.map((l) => l.productId)];
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, companyId: u.companyId, deletedAt: null }, select: { id: true, type: true, name: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    if (!pm.get(input.productId)) throw new BadRequestException({ message: 'Validation failed', errors: { productId: 'Choose the product this bill makes' } });
    if (pm.get(input.productId)!.type !== 'STOCK') throw new BadRequestException({ message: 'Validation failed', errors: { productId: 'The finished product must be a stock product' } });
    input.lines.forEach((l, i) => {
      const p = pm.get(l.productId);
      if (!p) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.productId`]: 'Unknown product' } });
      if (l.productId === input.productId) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.productId`]: 'A product cannot be a component of itself' } });
      if (p.type !== 'STOCK') throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.productId`]: `${p.name} is not a stock product` } });
    });
    return this.prisma.$transaction(async (tx) => {
      const data = {
        name: input.name,
        productId: input.productId,
        outputQty: D(input.outputQty),
        labourCost: D(input.labourCost),
        overheadCost: D(input.overheadCost),
        isDefault: input.isDefault,
        isActive: input.isActive,
        notes: input.notes ?? null,
        updatedById: u.id,
      };
      let bom;
      if (id) {
        const before = await this.ownBom(id);
        bom = await tx.bom.update({ where: { id }, data });
        await tx.bomLine.deleteMany({ where: { bomId: id } });
        await this.audit.record('Bill of Materials', id, 'UPDATE', before, bom, tx);
      } else {
        const code = input.code?.trim() || (await this.sequence.next('BOM', u.companyId, new Date(), tx));
        if (await tx.bom.findFirst({ where: { companyId: u.companyId, code } })) throw new ConflictException({ message: 'Validation failed', errors: { code: 'This code is already used' } });
        bom = await tx.bom.create({ data: { ...data, companyId: u.companyId, code, createdById: u.id } });
        await this.audit.record('Bill of Materials', bom.id, 'CREATE', undefined, bom, tx);
      }
      if (input.isDefault) await tx.bom.updateMany({ where: { companyId: u.companyId, productId: input.productId, id: { not: bom.id } }, data: { isDefault: false } });
      await tx.bomLine.createMany({ data: input.lines.map((l, i) => ({ bomId: bom.id, lineNo: i + 1, productId: l.productId, qty: D(l.qty), scrapPct: D(l.scrapPct), notes: l.notes ?? null })) });
      return bom;
    });
  }

  async deleteBom(id: string) {
    RequestCtx.assert('manufacturing.bom.delete');
    const b = await this.ownBom(id);
    if (await this.prisma.workOrder.count({ where: { bomId: id, status: { in: ['DRAFT', 'RELEASED'] }, deletedAt: null } })) throw new ConflictException('Open work orders use this bill of materials');
    await this.prisma.bom.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('Bill of Materials', id, 'DELETE', b, undefined);
    return { ok: true };
  }

  // ------------------------------------------------------------------ work orders
  private async ownOrder(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Work order not found');
    const w = await this.prisma.workOrder.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!w) throw new NotFoundException('Work order not found');
    return w;
  }

  async listOrders(status?: string) {
    RequestCtx.assert('manufacturing.order.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, ...(status ? { status } : {}) }, orderBy: [{ plannedDate: 'desc' }, { number: 'desc' }], take: 300 });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, product: products.get(r.productId) ?? null }));
  }

  /** work order with material needs: required, available in the warehouse, short */
  async getOrder(id: string) {
    RequestCtx.assert('manufacturing.order.read');
    const w = await this.ownOrder(id);
    const ids = [w.productId, ...w.lines.map((l) => l.productId)];
    const [products, balances, whs, bom] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, trackLots: true, uom: { select: { code: true } } } }),
      this.prisma.stockBalance.findMany({ where: { warehouseId: w.warehouseId, productId: { in: w.lines.map((l) => l.productId) } } }),
      this.prisma.warehouse.findMany({ where: { id: { in: [w.warehouseId, w.outputWarehouseId] } }, select: { id: true, name: true } }),
      this.prisma.bom.findUnique({ where: { id: w.bomId }, select: { code: true, name: true, outputQty: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const bm = new Map(balances.map((b) => [b.productId, b]));
    const wm = new Map(whs.map((x) => [x.id, x.name]));
    const lots = w.status === 'DONE' ? await this.lots.ofDocument(this.prisma as never, w.id) : {};
    return {
      ...w,
      product: pm.get(w.productId) ?? null,
      bom,
      warehouseName: wm.get(w.warehouseId) ?? '-',
      outputWarehouseName: wm.get(w.outputWarehouseId) ?? '-',
      lots,
      lines: w.lines.map((l) => {
        const available = n(bm.get(l.productId)?.qty);
        const avg = n(bm.get(l.productId)?.avgCost);
        return { ...l, product: pm.get(l.productId) ?? null, available, shortage: Math.max(0, n(l.plannedQty) - available), estCost: Math.round(n(l.plannedQty) * avg) };
      }),
    };
  }

  async createOrder(input: z.infer<typeof workOrderSchema>) {
    RequestCtx.assert('manufacturing.order.create');
    const u = RequestCtx.user();
    const bom = await this.ownBom(input.bomId);
    const lines = await this.prisma.bomLine.findMany({ where: { bomId: bom.id }, orderBy: { lineNo: 'asc' } });
    const whs = await this.prisma.warehouse.findMany({ where: { id: { in: [input.warehouseId, input.outputWarehouseId ?? input.warehouseId] }, companyId: u.companyId, deletedAt: null } });
    if (!whs.some((x) => x.id === input.warehouseId)) throw new BadRequestException({ message: 'Validation failed', errors: { warehouseId: 'Choose a warehouse' } });
    const factor = D(input.qty).div(D(bom.outputQty));
    return this.prisma.$transaction(async (tx) => {
      const w = await tx.workOrder.create({
        data: {
          companyId: u.companyId,
          branchId: whs[0]?.branchId ?? u.branchId,
          number: await this.sequence.next('WORK_ORDER', u.companyId, input.plannedDate, tx),
          bomId: bom.id,
          productId: bom.productId,
          qty: D(input.qty),
          warehouseId: input.warehouseId,
          outputWarehouseId: input.outputWarehouseId ?? input.warehouseId,
          plannedDate: input.plannedDate,
          // conversion cost scales with the number of batches
          labourCost: round(D(bom.labourCost).times(factor)),
          overheadCost: round(D(bom.overheadCost).times(factor)),
          lotNo: input.lotNo ?? null,
          expiryDate: input.expiryDate ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
          lines: {
            create: lines.map((l) => {
              const q = D(l.qty).times(factor).times(D(1).plus(D(l.scrapPct).div(100))).toDecimalPlaces(4);
              return { lineNo: l.lineNo, productId: l.productId, plannedQty: q, consumedQty: q };
            }),
          },
        },
      });
      await this.audit.record('Work Order', w.id, 'CREATE', undefined, { number: w.number, bom: bom.code, qty: input.qty }, tx);
      return w;
    });
  }

  async release(id: string) {
    RequestCtx.assert('manufacturing.order.create');
    const w = await this.ownOrder(id);
    if (w.status !== 'DRAFT') throw new ConflictException('Only a draft work order can be released');
    await this.prisma.workOrder.update({ where: { id }, data: { status: 'RELEASED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Work Order', id, 'RELEASE', { status: 'DRAFT' }, { status: 'RELEASED' });
    return { ok: true };
  }

  /**
   * Finishes production: issues the components (lots FEFO), receives the finished goods at
   * (materials + labour + overhead) / quantity produced and posts
   * Dr Inventory (finished goods) / Cr Inventory (materials), Cr Labour applied, Cr Overhead applied.
   */
  async complete(id: string, input: z.infer<typeof completeSchema>) {
    RequestCtx.assert('manufacturing.order.confirm');
    const u = RequestCtx.user();
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', u.companyId, false);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
        const w = await this.ownOrder(id);
        if (!['DRAFT', 'RELEASED'].includes(w.status)) throw new ConflictException('This work order is already finished or cancelled');
        const products = new Map((await tx.product.findMany({ where: { id: { in: [w.productId, ...w.lines.map((l) => l.productId)] } } })).map((p) => [p.id, p]));
        const used = new Map(input.consumed.map((c) => [c.lineId, D(c.qty)]));
        const base = { companyId: w.companyId, branchId: w.branchId, date: input.date, docType: 'WO', documentId: w.id, documentNumber: w.number, allowNegative };
        let material = ZERO;
        for (const l of w.lines) {
          const p = products.get(l.productId)!;
          const qty = used.get(l.id) ?? D(l.consumedQty);
          if (qty.lte(0)) continue;
          if (p.trackLots) {
            await this.lots.ensureOpening(tx, w.companyId, p.id, w.warehouseId);
            await this.lots.issue(tx, { companyId: w.companyId, documentId: w.id, lineId: l.id, productId: p.id, warehouseId: w.warehouseId, qty, preferredLotId: l.lotId });
          }
          const r = await this.inventory.move(tx, { ...base, productId: p.id, productName: p.name, warehouseId: w.warehouseId, qty: qty.neg() });
          material = material.plus(r.totalCost.abs());
          await tx.workOrderLine.update({ where: { id: l.id }, data: { consumedQty: qty, unitCost: r.unitCost } });
        }
        material = round(material);
        const total = material.plus(D(w.labourCost)).plus(D(w.overheadCost));
        const produced = D(input.producedQty);
        const unitCost = total.div(produced);
        const fg = products.get(w.productId)!;
        if (fg.trackLots) {
          await this.lots.ensureOpening(tx, w.companyId, fg.id, w.outputWarehouseId);
          await this.lots.receive(tx, { companyId: w.companyId, documentId: w.id, lineId: w.id, productId: fg.id, warehouseId: w.outputWarehouseId, qty: produced, lotNo: input.lotNo ?? w.lotNo ?? w.number, expiryDate: input.expiryDate ?? w.expiryDate, docNumber: w.number, docDate: input.date, shelfLifeDays: fg.shelfLifeDays });
        }
        const r = await this.inventory.move(tx, { ...base, productId: fg.id, productName: fg.name, warehouseId: w.outputWarehouseId, qty: produced, unitCost });
        const j: PostingLine[] = [
          { key: 'INVENTORY', debit: r.totalCost, description: `Produced ${fg.name}` },
          ...(material.gt(0) ? [{ key: 'INVENTORY', credit: material, description: 'Materials used' }] : []),
          ...(D(w.labourCost).gt(0) ? [{ key: 'LABOUR_APPLIED', credit: D(w.labourCost), description: 'Direct labour applied' }] : []),
          ...(D(w.overheadCost).gt(0) ? [{ key: 'OVERHEAD_APPLIED', credit: D(w.overheadCost), description: 'Production overhead applied' }] : []),
        ];
        // rounding of the received value against the parts
        const diff = r.totalCost.minus(sum(j.filter((x) => x.credit).map((x) => D(x.credit))));
        if (!diff.isZero()) j.push(diff.gt(0) ? { key: 'COGS', credit: diff, description: 'Rounding' } : { key: 'COGS', debit: diff.abs(), description: 'Rounding' });
        await this.journal.post(tx, { companyId: w.companyId, branchId: w.branchId, date: input.date, description: `Work order ${w.number} - ${fg.name}`, reference: w.number, sourceType: 'WO', sourceId: w.id, lines: j });
        const done = await tx.workOrder.update({
          where: { id },
          data: { status: 'DONE', producedQty: produced, completedDate: input.date, materialCost: material, totalCost: round(total), unitCost: unitCost.toDecimalPlaces(4), lotNo: input.lotNo ?? w.lotNo, expiryDate: input.expiryDate ?? w.expiryDate, updatedById: u.id },
        });
        await this.audit.record('Work Order', id, 'COMPLETE', { status: w.status }, { status: 'DONE', produced: produced.toString(), materialCost: material.toString(), totalCost: round(total).toString() }, tx);
        return done;
      },
      { timeout: 60_000 },
    );
  }

  /** cancels a work order; a finished one gets its stock movements and journal reversed */
  async cancel(id: string) {
    RequestCtx.assert('manufacturing.order.cancel');
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', RequestCtx.companyId(), false);
    return this.prisma.$transaction(async (tx) => {
      const w = await this.ownOrder(id);
      if (w.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      if (w.status === 'DONE') {
        await this.inventory.reverse(tx, id, allowNegative);
        await this.lots.reverse(tx, id);
        await this.journal.voidBySource(tx, 'WO', id);
      }
      await tx.workOrder.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
      await this.audit.record('Work Order', id, 'CANCEL', { status: w.status }, { status: 'CANCELLED' }, tx);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ SIINas
  /** quarterly production summary (quantities and value produced, materials used) for the SIINas report (Permenperin 13/2025) */
  async productionSummary(year: number, quarter: number) {
    RequestCtx.assert('manufacturing.order.read');
    const companyId = RequestCtx.companyId();
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3, 0));
    const orders = await this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, status: 'DONE', completedDate: { gte: from, lte: to } }, include: { lines: true } });
    const ids = [...new Set([...orders.map((o) => o.productId), ...orders.flatMap((o) => o.lines.map((l) => l.productId))])];
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    const out = new Map<string, { qty: number; value: number; orders: number }>();
    const mat = new Map<string, { qty: number; value: number }>();
    for (const o of orders) {
      const x = out.get(o.productId) ?? { qty: 0, value: 0, orders: 0 };
      x.qty += n(o.producedQty);
      x.value += n(o.totalCost);
      x.orders += 1;
      out.set(o.productId, x);
      for (const l of o.lines) {
        const m = mat.get(l.productId) ?? { qty: 0, value: 0 };
        m.qty += n(l.consumedQty);
        m.value += n(l.consumedQty) * n(l.unitCost);
        mat.set(l.productId, m);
      }
    }
    const p = (id: string) => products.get(id);
    return {
      period: { year, quarter, from, to, due: new Date(Date.UTC(quarter === 4 ? year + 1 : year, quarter === 4 ? 0 : quarter * 3, 10)) },
      production: [...out.entries()].map(([id, v]) => ({ code: p(id)?.code ?? '', name: p(id)?.name ?? '', uom: p(id)?.uom?.code ?? '', ...v, value: Math.round(v.value) })),
      materials: [...mat.entries()].map(([id, v]) => ({ code: p(id)?.code ?? '', name: p(id)?.name ?? '', uom: p(id)?.uom?.code ?? '', qty: v.qty, value: Math.round(v.value) })),
    };
  }
}
