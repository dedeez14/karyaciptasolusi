import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { LotService } from '../documents/lot.service';
import { QualityService } from '../quality/quality.service';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());

export const bomSchema = z
  .object({
    code: z.string().trim().min(1).max(30).optional(),
    name: z.string().trim().min(1).max(200),
    productId: z.uuid(),
    kind: z.enum(['STANDARD', 'FORMULA']).default('STANDARD'),
    outputQty: z.coerce.number().positive().max(1e9),
    normalScrapPct: z.coerce.number().min(0).max(100).default(0),
    labourCost: z.coerce.number().min(0).max(1e14).default(0),
    overheadCost: z.coerce.number().min(0).max(1e14).default(0),
    isDefault: z.boolean().default(true),
    isActive: z.boolean().default(true),
    notes: optText(2000),
    lines: z
      .array(
        z.object({
          productId: z.uuid(),
          qty: z.coerce.number().min(0).max(1e9).default(0),
          pct: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
          scrapPct: z.coerce.number().min(0).max(100).default(0),
          phantom: z.boolean().default(false),
          operationSeq: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(1).max(999).nullable().optional()),
          notes: optText(300),
        }),
      )
      .min(1, 'Add at least one component')
      .max(200),
    operations: z
      .array(z.object({ seq: z.coerce.number().int().min(1).max(999), name: z.string().trim().min(1).max(120), workCenterId: z.uuid(), setupMinutes: z.coerce.number().min(0).max(1e6).default(0), runMinutes: z.coerce.number().min(0).max(1e6).default(0), instructions: optText(1000) }))
      .max(100)
      .default([]),
    outputs: z
      .array(z.object({ productId: z.uuid(), kind: z.enum(['CO', 'BY']), qty: z.coerce.number().positive().max(1e9), costSharePct: z.coerce.number().min(0).max(100).default(0), nrvPerUnit: z.coerce.number().min(0).max(1e12).default(0) }))
      .max(20)
      .default([]),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'FORMULA') {
      const total = b.lines.reduce((a, l) => a + (l.pct ?? 0), 0);
      if (Math.abs(total - 100) > 0.01) ctx.addIssue({ code: 'custom', path: ['lines'], message: `A formula must add up to 100% (now ${Math.round(total * 100) / 100}%)` });
    } else b.lines.forEach((l, i) => !(l.qty > 0) && ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty'], message: 'Enter the quantity per batch' }));
    const share = b.outputs.filter((o) => o.kind === 'CO').reduce((a, o) => a + o.costSharePct, 0);
    if (share >= 100) ctx.addIssue({ code: 'custom', path: ['outputs'], message: 'Co-product shares must leave a share for the main product' });
    const seqs = b.operations.map((o) => o.seq);
    if (new Set(seqs).size !== seqs.length) ctx.addIssue({ code: 'custom', path: ['operations'], message: 'Each step needs its own number' });
    b.lines.forEach((l, i) => l.operationSeq && !seqs.includes(l.operationSeq) && ctx.addIssue({ code: 'custom', path: ['lines', i, 'operationSeq'], message: 'No such step in the routing' }));
  });

export const workOrderSchema = z.object({
  bomId: z.uuid(),
  qty: z.coerce.number().positive().max(1e9),
  warehouseId: z.uuid(),
  outputWarehouseId: optUuid,
  plannedDate: z.coerce.date(),
  lotNo: optText(60),
  expiryDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  notes: optText(2000),
  parentId: optUuid,
});

export const issueSchema = z.object({ date: z.coerce.date(), lines: z.array(z.object({ lineId: z.uuid(), qty: z.coerce.number().positive().max(1e9) })).max(200).default([]) });
export const finishOpSchema = z.object({ goodQty: z.coerce.number().min(0).max(1e9), scrapQty: z.coerce.number().min(0).max(1e9).default(0), minutes: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).max(1e6).optional()), notes: optText(500) });

export const completeSchema = z.object({
  date: z.coerce.date(),
  producedQty: z.coerce.number().positive().max(1e9),
  /** finished units lost in production */
  scrapQty: z.coerce.number().min(0).max(1e9).default(0),
  /** actual quantities used, per work order line (default: issued, or planned when nothing was issued) */
  consumed: z.array(z.object({ lineId: z.uuid(), qty: z.coerce.number().min(0).max(1e9) })).max(200).default([]),
  /** co- and by-products received (default: planned) */
  outputs: z.array(z.object({ outputId: z.uuid(), qty: z.coerce.number().min(0).max(1e9) })).max(20).default([]),
  lotNo: optText(60),
  expiryDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
});

type Rates = { labourRate: Prisma.Decimal; machineRate: Prisma.Decimal; overheadRate: Prisma.Decimal };
const perMinute = (r: Rates) => r.labourRate.plus(r.machineRate).plus(r.overheadRate).div(60);

/**
 * Manufacturing for any factory: multi-level and formula bills of materials, routings over work centres, work orders
 * costed through work in process (job costing, SAK EP Ch. 13 / PSAK 202):
 * - materials issued: Dr Work in process / Cr Inventory (moving average, lots FEFO)
 * - each routing step reported: Dr Work in process / Cr Direct labour applied, Cr Production overhead applied
 *   (actual minutes x the rates of the work centre; overhead rates are set on normal capacity, so hours not used leave
 *   the overhead as an expense of the period)
 * - completion: by-products at net realisable value, scrap above the normal rate as an abnormal loss (expensed, not in
 *   inventory), co-products by their cost share, the rest to the main product.
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
    private readonly quality: QualityService,
  ) {}

  // ------------------------------------------------------------------ bills of materials
  async listBoms() {
    RequestCtx.assert('manufacturing.bom.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.bom.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' }, include: { _count: { select: { lines: true, operations: true, outputs: true } } } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const costs = await Promise.all(rows.map((r) => this.estimate(r.id)));
    return rows.map((r, i) => ({ ...r, product: products.get(r.productId) ?? null, lineCount: r._count.lines, operationCount: r._count.operations, outputCount: r._count.outputs, estimate: costs[i] }));
  }

  async getBom(id: string) {
    RequestCtx.assert('manufacturing.bom.read');
    const b = await this.ownBom(id);
    const [lines, operations, outputs] = await Promise.all([
      this.prisma.bomLine.findMany({ where: { bomId: id }, orderBy: { lineNo: 'asc' } }),
      this.prisma.bomOperation.findMany({ where: { bomId: id }, orderBy: { seq: 'asc' } }),
      this.prisma.bomOutput.findMany({ where: { bomId: id } }),
    ]);
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [b.productId, ...lines.map((l) => l.productId), ...outputs.map((o) => o.productId)] } }, select: { id: true, code: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    const centres = new Map((await this.prisma.workCenter.findMany({ where: { id: { in: operations.map((o) => o.workCenterId) } }, select: { id: true, code: true, name: true } })).map((c) => [c.id, c]));
    const subBoms = new Set((await this.prisma.bom.findMany({ where: { companyId: b.companyId, productId: { in: lines.map((l) => l.productId) }, isActive: true, deletedAt: null }, select: { productId: true } })).map((x) => x.productId));
    return {
      ...b,
      product: products.get(b.productId) ?? null,
      lines: lines.map((l) => ({ ...l, product: products.get(l.productId) ?? null, hasBom: subBoms.has(l.productId) })),
      operations: operations.map((o) => ({ ...o, workCenter: centres.get(o.workCenterId) ?? null })),
      outputs: outputs.map((o) => ({ ...o, product: products.get(o.productId) ?? null })),
      estimate: await this.estimate(id),
    };
  }

  /** company-wide weighted average cost per product (falls back to the purchase price) */
  private async avgCosts(companyId: string, productIds: string[]) {
    const rows = await this.prisma.$queryRaw<{ id: string; cost: Prisma.Decimal | null; price: Prisma.Decimal }[]>`
      SELECT p.id, CASE WHEN SUM(b.qty) > 0 THEN SUM(b.qty * b."avgCost") / SUM(b.qty) END AS cost, p."purchasePrice" AS price
      FROM products p LEFT JOIN stock_balances b ON b."productId" = p.id AND b.qty > 0
      WHERE p."companyId" = ${companyId}::uuid AND p.id IN (${Prisma.join(productIds.length ? productIds.map((i) => Prisma.sql`${i}::uuid`) : [Prisma.sql`NULL::uuid`])})
      GROUP BY p.id`;
    return new Map(rows.map((r) => [r.id, { cost: r.cost !== null ? n(r.cost) : null, price: n(r.price) }]));
  }

  /**
   * Standard cost of one batch, rolled up through sub-assemblies: material (stock cost, else the rolled-up cost of the
   * component's own BOM, else its purchase price) + routing conversion + flat labour / overhead - by-products at NRV.
   */
  private async estimate(bomId: string, depth = 0): Promise<{ material: number; conversion: number; labour: number; overhead: number; byProducts: number; batch: number; perUnit: number } | null> {
    const b = await this.prisma.bom.findUnique({ where: { id: bomId }, include: { lines: true, operations: true, outputs: true } });
    if (!b || depth > 8) return null;
    const avg = await this.avgCosts(b.companyId, b.lines.map((l) => l.productId));
    let material = 0;
    for (const l of b.lines) {
      const a = avg.get(l.productId);
      let unit = a?.cost ?? null;
      if (unit === null || l.phantom) {
        const sub = await this.prisma.bom.findFirst({ where: { companyId: b.companyId, productId: l.productId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], select: { id: true } });
        const e = sub ? await this.estimate(sub.id, depth + 1) : null;
        unit = e ? e.perUnit : a?.price ?? 0;
      }
      material += n(l.qty) * (1 + n(l.scrapPct) / 100) * unit;
    }
    const centres = new Map((await this.prisma.workCenter.findMany({ where: { id: { in: b.operations.map((o) => o.workCenterId) } } })).map((c) => [c.id, c]));
    const conversion = b.operations.reduce((a, o) => {
      const c = centres.get(o.workCenterId);
      if (!c) return a;
      return a + ((n(o.setupMinutes) + n(o.runMinutes) * n(b.outputQty)) / 60) * (n(c.labourRate) + n(c.machineRate) + n(c.overheadRate));
    }, 0);
    const byProducts = b.outputs.filter((o) => o.kind === 'BY').reduce((a, o) => a + n(o.qty) * n(o.nrvPerUnit), 0);
    const joint = material + conversion + n(b.labourCost) + n(b.overheadCost) - byProducts;
    const coShare = b.outputs.filter((o) => o.kind === 'CO').reduce((a, o) => a + n(o.costSharePct), 0);
    const main = (joint * (100 - coShare)) / 100;
    const good = n(b.outputQty) * (1 - n(b.normalScrapPct) / 100) || 1;
    return { material: Math.round(material), conversion: Math.round(conversion), labour: n(b.labourCost), overhead: n(b.overheadCost), byProducts: Math.round(byProducts), batch: Math.round(joint), perUnit: Math.round((main / good) * 100) / 100 };
  }

  private async ownBom(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Bill of materials not found');
    const b = await this.prisma.bom.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!b) throw new NotFoundException('Bill of materials not found');
    return b;
  }

  /** a component may not (through its own bills) contain the product being made */
  private async assertNoCycle(companyId: string, productId: string, componentIds: string[]) {
    const seen = new Set<string>();
    let frontier = [...componentIds];
    for (let depth = 0; frontier.length && depth < 10; depth++) {
      if (frontier.includes(productId)) throw new BadRequestException({ message: 'Validation failed', errors: { lines: 'A component contains this product through its own bill of materials (a loop)' } });
      frontier.forEach((x) => seen.add(x));
      const subs = await this.prisma.bom.findMany({ where: { companyId, productId: { in: frontier }, isActive: true, deletedAt: null }, select: { lines: { select: { productId: true } } } });
      frontier = [...new Set(subs.flatMap((s) => s.lines.map((l) => l.productId)))].filter((x) => !seen.has(x) || x === productId);
    }
  }

  async saveBom(id: string | null, input: z.infer<typeof bomSchema>) {
    RequestCtx.assert(id ? 'manufacturing.bom.update' : 'manufacturing.bom.create');
    const u = RequestCtx.user();
    const ids = [input.productId, ...input.lines.map((l) => l.productId), ...input.outputs.map((o) => o.productId)];
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, companyId: u.companyId, deletedAt: null }, select: { id: true, type: true, name: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const err = (path: string, msg: string) => new BadRequestException({ message: 'Validation failed', errors: { [path]: msg } });
    if (!pm.get(input.productId)) throw err('productId', 'Choose the product this bill makes');
    if (pm.get(input.productId)!.type !== 'STOCK' && !input.lines.length) throw err('productId', 'The finished product must be a stock product');
    input.lines.forEach((l, i) => {
      const p = pm.get(l.productId);
      if (!p) throw err(`lines.${i}.productId`, 'Unknown product');
      if (l.productId === input.productId) throw err(`lines.${i}.productId`, 'A product cannot be a component of itself');
      if (p.type !== 'STOCK' && !l.phantom) throw err(`lines.${i}.productId`, `${p.name} is not a stock product`);
    });
    input.outputs.forEach((o, i) => {
      const p = pm.get(o.productId);
      if (!p || p.type !== 'STOCK') throw err(`outputs.${i}.productId`, 'Co- / by-products must be stock products');
      if (o.productId === input.productId) throw err(`outputs.${i}.productId`, 'That is the main product');
    });
    const centres = await this.prisma.workCenter.count({ where: { id: { in: input.operations.map((o) => o.workCenterId) }, companyId: u.companyId, deletedAt: null } });
    if (centres !== new Set(input.operations.map((o) => o.workCenterId)).size) throw err('operations', 'A work centre was not found');
    await this.assertNoCycle(u.companyId, input.productId, input.lines.map((l) => l.productId));
    // formula: percentages of the batch become quantities
    const lines = input.lines.map((l) => (input.kind === 'FORMULA' ? { ...l, qty: ((l.pct ?? 0) / 100) * input.outputQty } : { ...l, pct: null }));
    return this.prisma.$transaction(async (tx) => {
      const data = {
        name: input.name,
        productId: input.productId,
        kind: input.kind,
        outputQty: D(input.outputQty),
        normalScrapPct: D(input.normalScrapPct),
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
        await tx.bomOperation.deleteMany({ where: { bomId: id } });
        await tx.bomOutput.deleteMany({ where: { bomId: id } });
        await this.audit.record('Bill of Materials', id, 'UPDATE', before, bom, tx);
      } else {
        const code = input.code?.trim() || (await this.sequence.next('BOM', u.companyId, new Date(), tx));
        if (await tx.bom.findFirst({ where: { companyId: u.companyId, code } })) throw new ConflictException({ message: 'Validation failed', errors: { code: 'This code is already used' } });
        bom = await tx.bom.create({ data: { ...data, companyId: u.companyId, code, createdById: u.id } });
        await this.audit.record('Bill of Materials', bom.id, 'CREATE', undefined, bom, tx);
      }
      if (input.isDefault) await tx.bom.updateMany({ where: { companyId: u.companyId, productId: input.productId, id: { not: bom.id } }, data: { isDefault: false } });
      await tx.bomLine.createMany({ data: lines.map((l, i) => ({ bomId: bom.id, lineNo: i + 1, productId: l.productId, qty: D(l.qty).toDecimalPlaces(4), pct: l.pct === null || l.pct === undefined ? null : D(l.pct), scrapPct: D(l.scrapPct), phantom: l.phantom, operationSeq: l.operationSeq ?? null, notes: l.notes ?? null })) });
      if (input.operations.length) await tx.bomOperation.createMany({ data: input.operations.map((o) => ({ bomId: bom.id, seq: o.seq, name: o.name, workCenterId: o.workCenterId, setupMinutes: D(o.setupMinutes), runMinutes: D(o.runMinutes), instructions: o.instructions ?? null })) });
      if (input.outputs.length) await tx.bomOutput.createMany({ data: input.outputs.map((o) => ({ bomId: bom.id, productId: o.productId, kind: o.kind, qty: D(o.qty), costSharePct: D(o.kind === 'CO' ? o.costSharePct : 0), nrvPerUnit: D(o.kind === 'BY' ? o.nrvPerUnit : 0) })) });
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
  private async ownOrder(id: string, db: PrismaService | Tx = this.prisma) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Work order not found');
    const w = await db.workOrder.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } }, operations: { orderBy: { seq: 'asc' } }, outputs: true } });
    if (!w) throw new NotFoundException('Work order not found');
    return w;
  }

  async listOrders(status?: string) {
    RequestCtx.assert('manufacturing.order.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, ...(status ? { status } : {}) }, orderBy: [{ plannedDate: 'desc' }, { number: 'desc' }], take: 300, include: { operations: { select: { status: true } } } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    return rows.map(({ operations, ...r }) => ({ ...r, product: products.get(r.productId) ?? null, steps: operations.length, stepsDone: operations.filter((o) => o.status === 'DONE').length }));
  }

  /** work order with material needs, routing progress, cost so far and the comparison with the standard */
  async getOrder(id: string) {
    RequestCtx.assert('manufacturing.order.read');
    const w = await this.ownOrder(id);
    const ids = [w.productId, ...w.lines.map((l) => l.productId), ...w.outputs.map((o) => o.productId)];
    const [products, balances, whs, bom, centres, children, parent] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, trackLots: true, uom: { select: { code: true } } } }),
      this.prisma.stockBalance.findMany({ where: { warehouseId: w.warehouseId, productId: { in: w.lines.map((l) => l.productId) } } }),
      this.prisma.warehouse.findMany({ where: { id: { in: [w.warehouseId, w.outputWarehouseId] } }, select: { id: true, name: true } }),
      this.prisma.bom.findUnique({ where: { id: w.bomId }, select: { code: true, name: true, outputQty: true, normalScrapPct: true, kind: true } }),
      this.prisma.workCenter.findMany({ where: { id: { in: w.operations.map((o) => o.workCenterId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.workOrder.findMany({ where: { parentId: w.id, deletedAt: null }, select: { id: true, number: true, status: true, qty: true, productId: true } }),
      w.parentId ? this.prisma.workOrder.findUnique({ where: { id: w.parentId }, select: { id: true, number: true } }) : null,
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const bm = new Map(balances.map((b) => [b.productId, b]));
    const wm = new Map(whs.map((x) => [x.id, x.name]));
    const cm = new Map(centres.map((c) => [c.id, c]));
    const subBoms = new Set((await this.prisma.bom.findMany({ where: { companyId: w.companyId, productId: { in: w.lines.map((l) => l.productId) }, isActive: true, deletedAt: null }, select: { productId: true } })).map((x) => x.productId));
    const lots = w.status === 'DONE' ? await this.lots.ofDocument(this.prisma as never, w.id) : {};
    // standard: planned materials at average cost + planned minutes at the rates
    const stdMaterial = w.lines.reduce((a, l) => a + n(l.plannedQty) * n(bm.get(l.productId)?.avgCost), 0);
    const stdConversion = w.operations.reduce((a, o) => a + n(o.plannedMinutes) * n(perMinute(o)), 0) + n(w.labourCost) + n(w.overheadCost);
    return {
      ...w,
      product: pm.get(w.productId) ?? null,
      bom,
      parent,
      children: children.map((c) => ({ ...c, product: pm.get(c.productId) ?? null })),
      warehouseName: wm.get(w.warehouseId) ?? '-',
      outputWarehouseName: wm.get(w.outputWarehouseId) ?? '-',
      lots,
      lines: w.lines.map((l) => {
        const available = n(bm.get(l.productId)?.qty);
        const avg = n(bm.get(l.productId)?.avgCost);
        return { ...l, product: pm.get(l.productId) ?? null, available, shortage: Math.max(0, n(l.plannedQty) - n(l.issuedQty) - available), estCost: Math.round(n(l.plannedQty) * avg), hasBom: subBoms.has(l.productId) };
      }),
      operations: w.operations.map((o) => ({ ...o, workCenter: cm.get(o.workCenterId) ?? null })),
      outputs: w.outputs.map((o) => ({ ...o, product: pm.get(o.productId) ?? null })),
      costs: {
        standardMaterial: Math.round(stdMaterial),
        standardConversion: Math.round(stdConversion),
        actualMaterial: n(w.wipMaterial) || n(w.materialCost),
        actualConversion: n(w.wipConversion),
      },
    };
  }

  /** components of a BOM for a quantity, phantom sub-assemblies exploded into their own components */
  private async explode(tx: Tx | PrismaService, companyId: string, bomId: string, factor: Prisma.Decimal, opSeq: number | null, depth = 0): Promise<{ productId: string; qty: Prisma.Decimal; operationSeq: number | null }[]> {
    if (depth > 8) throw new BadRequestException('Bills of materials nested too deep (or in a loop)');
    const lines = await tx.bomLine.findMany({ where: { bomId }, orderBy: { lineNo: 'asc' } });
    const out: { productId: string; qty: Prisma.Decimal; operationSeq: number | null }[] = [];
    for (const l of lines) {
      const q = D(l.qty).times(factor).times(D(1).plus(D(l.scrapPct).div(100)));
      const seq = depth === 0 ? l.operationSeq : opSeq;
      if (l.phantom) {
        const sub = await tx.bom.findFirst({ where: { companyId, productId: l.productId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
        if (!sub) throw new BadRequestException('A phantom component has no bill of materials');
        out.push(...(await this.explode(tx, companyId, sub.id, q.div(sub.outputQty), seq, depth + 1)));
      } else out.push({ productId: l.productId, qty: q, operationSeq: seq });
    }
    // the same component twice (e.g. from two phantoms) becomes one line per step
    const merged = new Map<string, { productId: string; qty: Prisma.Decimal; operationSeq: number | null }>();
    for (const x of out) {
      const k = `${x.productId}|${x.operationSeq ?? ''}`;
      const m = merged.get(k);
      merged.set(k, m ? { ...m, qty: m.qty.plus(x.qty) } : x);
    }
    return [...merged.values()];
  }

  async createOrder(input: z.infer<typeof workOrderSchema>) {
    RequestCtx.assert('manufacturing.order.create');
    const u = RequestCtx.user();
    const bom = await this.ownBom(input.bomId);
    const whs = await this.prisma.warehouse.findMany({ where: { id: { in: [input.warehouseId, input.outputWarehouseId ?? input.warehouseId] }, companyId: u.companyId, deletedAt: null } });
    if (!whs.some((x) => x.id === input.warehouseId)) throw new BadRequestException({ message: 'Validation failed', errors: { warehouseId: 'Choose a warehouse' } });
    if (input.parentId && !(await this.prisma.workOrder.count({ where: { id: input.parentId, companyId: u.companyId } }))) throw new BadRequestException('Parent work order not found');
    const factor = D(input.qty).div(D(bom.outputQty));
    const [ops, outputs] = await Promise.all([this.prisma.bomOperation.findMany({ where: { bomId: bom.id }, orderBy: { seq: 'asc' } }), this.prisma.bomOutput.findMany({ where: { bomId: bom.id } })]);
    const centres = new Map((await this.prisma.workCenter.findMany({ where: { id: { in: ops.map((o) => o.workCenterId) } } })).map((c) => [c.id, c]));
    return this.prisma.$transaction(async (tx) => {
      const parts = await this.explode(tx, u.companyId, bom.id, factor, null);
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
          // flat conversion cost of the BOM (when no routing) scales with the number of batches
          labourCost: round(D(bom.labourCost).times(factor)),
          overheadCost: round(D(bom.overheadCost).times(factor)),
          lotNo: input.lotNo ?? null,
          expiryDate: input.expiryDate ?? null,
          notes: input.notes ?? null,
          parentId: input.parentId ?? null,
          createdById: u.id,
          lines: { create: parts.map((p, i) => ({ lineNo: i + 1, productId: p.productId, plannedQty: p.qty.toDecimalPlaces(4), consumedQty: ZERO, operationSeq: p.operationSeq })) },
          operations: {
            create: ops.map((o) => {
              const c = centres.get(o.workCenterId)!;
              return { seq: o.seq, name: o.name, workCenterId: o.workCenterId, plannedMinutes: D(o.setupMinutes).plus(D(o.runMinutes).times(input.qty)).toDecimalPlaces(2), labourRate: c.labourRate, machineRate: c.machineRate, overheadRate: c.overheadRate };
            }),
          },
          outputs: { create: outputs.map((o) => ({ productId: o.productId, kind: o.kind, plannedQty: D(o.qty).times(factor).toDecimalPlaces(4), costSharePct: o.costSharePct, nrvPerUnit: o.nrvPerUnit })) },
        },
      });
      await this.audit.record('Work Order', w.id, 'CREATE', undefined, { number: w.number, bom: bom.code, qty: input.qty, parentId: input.parentId ?? null }, tx);
      return w;
    });
  }

  /** work orders for sub-assemblies that are short (components that have their own bill of materials) */
  async createSubOrders(id: string) {
    RequestCtx.assert('manufacturing.order.create');
    const w = await this.getOrder(id);
    if (!['DRAFT', 'RELEASED'].includes(w.status)) throw new ConflictException('The work order is closed');
    const open = await this.prisma.workOrder.findMany({ where: { parentId: w.id, status: { in: ['DRAFT', 'RELEASED'] }, deletedAt: null } });
    const created: string[] = [];
    for (const l of w.lines.filter((x) => x.hasBom)) {
      const coming = open.filter((o) => o.productId === l.productId).reduce((a, o) => a + n(o.qty), 0);
      const need = Math.round((l.shortage - coming) * 10000) / 10000;
      if (need <= 0) continue;
      const bom = await this.prisma.bom.findFirst({ where: { companyId: w.companyId, productId: l.productId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
      if (!bom) continue;
      const sub = await this.createOrder({ bomId: bom.id, qty: need, warehouseId: w.warehouseId, outputWarehouseId: w.warehouseId, plannedDate: w.plannedDate, parentId: w.id });
      created.push(sub.number);
    }
    return { created };
  }

  async release(id: string) {
    RequestCtx.assert('manufacturing.order.create');
    const w = await this.ownOrder(id);
    if (w.status !== 'DRAFT') throw new ConflictException('Only a draft work order can be released');
    await this.prisma.workOrder.update({ where: { id }, data: { status: 'RELEASED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Work Order', id, 'RELEASE', { status: 'DRAFT' }, { status: 'RELEASED' });
    return { ok: true };
  }

  private async allowNegative(companyId: string) {
    return this.settings.bool('inventory.allowNegativeStock', companyId, false);
  }

  /** moves material between stock and work in process (qty > 0 issues, < 0 returns) and posts it */
  private async moveMaterial(tx: Tx, w: { id: string; companyId: string; branchId: string | null; number: string; warehouseId: string }, line: { id: string; productId: string; lotId: string | null; issuedQty: Prisma.Decimal; unitCost: Prisma.Decimal }, qty: Prisma.Decimal, date: Date, allowNegative: boolean) {
    const p = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
    const base = { companyId: w.companyId, branchId: w.branchId, date, docType: 'WO', documentId: w.id, documentNumber: w.number, allowNegative, productId: p.id, productName: p.name, warehouseId: w.warehouseId };
    let value: Prisma.Decimal;
    if (qty.gt(0)) {
      if (p.trackLots) {
        await this.lots.ensureOpening(tx, w.companyId, p.id, w.warehouseId);
        await this.lots.issue(tx, { companyId: w.companyId, documentId: w.id, lineId: line.id, productId: p.id, warehouseId: w.warehouseId, qty, preferredLotId: line.lotId });
      }
      const r = await this.inventory.move(tx, { ...base, qty: qty.neg() });
      value = round(r.totalCost.abs());
    } else {
      // unused material back to stock at the cost it was issued
      value = round(D(line.unitCost).times(qty.abs()));
      await this.inventory.move(tx, { ...base, qty: qty.abs(), unitCost: D(line.unitCost) });
    }
    const issued = D(line.issuedQty).plus(qty);
    const prevValue = D(line.unitCost).times(line.issuedQty);
    const newValue = qty.gt(0) ? prevValue.plus(value) : prevValue.minus(value);
    await tx.workOrderLine.update({ where: { id: line.id }, data: { issuedQty: issued, consumedQty: issued, unitCost: issued.gt(0) ? newValue.div(issued).toDecimalPlaces(4) : D(line.unitCost) } });
    if (value.gt(0))
      await this.journal.post(tx, {
        companyId: w.companyId,
        branchId: w.branchId,
        date,
        description: `${w.number}: ${qty.gt(0) ? 'materials issued' : 'materials returned'} - ${p.name}`,
        reference: w.number,
        sourceType: 'WO',
        sourceId: w.id,
        lines: qty.gt(0) ? [{ key: 'WIP', debit: value }, { key: 'INVENTORY', credit: value }] : [{ key: 'INVENTORY', debit: value }, { key: 'WIP', credit: value }],
      });
    await tx.workOrder.update({ where: { id: w.id }, data: { wipMaterial: { [qty.gt(0) ? 'increment' : 'decrement']: value } } });
    return value;
  }

  /** issues materials to production: the given quantities, or everything still to issue */
  async issue(id: string, input: z.infer<typeof issueSchema>) {
    RequestCtx.assert('manufacturing.order.confirm');
    const allowNegative = await this.allowNegative(RequestCtx.companyId());
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
        const w = await this.ownOrder(id, tx);
        if (w.status !== 'RELEASED') throw new ConflictException('Release the work order first');
        const want = new Map(input.lines.map((l) => [l.lineId, D(l.qty)]));
        let total = ZERO;
        for (const l of w.lines) {
          const qty = input.lines.length ? want.get(l.id) : D(l.plannedQty).minus(l.issuedQty);
          if (!qty || qty.lte(0)) continue;
          total = total.plus(await this.moveMaterial(tx, w, l, qty, input.date, allowNegative));
        }
        if (!w.startedAt) await tx.workOrder.update({ where: { id }, data: { startedAt: new Date() } });
        await this.audit.record('Work Order', id, 'ISSUE', undefined, { value: total.toString() }, tx);
        return { issued: total.toNumber() };
      },
      { timeout: 60_000 },
    );
  }

  // ------------------------------------------------------------------ shop floor
  private async ownOperation(opId: string, tx: Tx) {
    if (!UUID.test(opId ?? '')) throw new NotFoundException('Step not found');
    const op = await tx.workOrderOperation.findFirst({ where: { id: opId, workOrder: { companyId: RequestCtx.companyId(), deletedAt: null } }, include: { workOrder: true } });
    if (!op) throw new NotFoundException('Step not found');
    if (op.workOrder.status !== 'RELEASED') throw new ConflictException(op.workOrder.status === 'DRAFT' ? 'The work order is not released yet' : 'The work order is closed');
    return op;
  }

  /** starts (or resumes) a step; its materials are issued when the step first starts */
  async startOperation(opId: string) {
    RequestCtx.assert('manufacturing.order.report');
    const u = RequestCtx.user();
    const allowNegative = await this.allowNegative(u.companyId);
    return this.prisma.$transaction(
      async (tx) => {
        const op = await this.ownOperation(opId, tx);
        if (op.status === 'RUNNING') return op;
        if (op.status === 'DONE') throw new ConflictException('This step is finished');
        const now = new Date();
        if (!op.startedAt) {
          const w = await this.ownOrder(op.workOrderId, tx);
          for (const l of w.lines.filter((x) => x.operationSeq === op.seq || (x.operationSeq === null && op.seq === Math.min(...w.operations.map((o) => o.seq))))) {
            const rest = D(l.plannedQty).minus(l.issuedQty);
            if (rest.gt(0)) await this.moveMaterial(tx, w, l, rest, now, allowNegative);
          }
          if (!w.startedAt) await tx.workOrder.update({ where: { id: w.id }, data: { startedAt: now } });
        }
        const r = await tx.workOrderOperation.update({ where: { id: opId }, data: { status: 'RUNNING', runningSince: now, startedAt: op.startedAt ?? now, operatorId: u.id } });
        await this.audit.record('Work Order', op.workOrderId, 'STEP_START', undefined, { step: op.seq, name: op.name }, tx);
        return r;
      },
      { timeout: 60_000 },
    );
  }

  async pauseOperation(opId: string) {
    RequestCtx.assert('manufacturing.order.report');
    return this.prisma.$transaction(async (tx) => {
      const op = await this.ownOperation(opId, tx);
      if (op.status !== 'RUNNING' || !op.runningSince) throw new ConflictException('This step is not running');
      const minutes = (Date.now() - op.runningSince.getTime()) / 60000;
      return tx.workOrderOperation.update({ where: { id: opId }, data: { status: 'PAUSED', runningSince: null, actualMinutes: D(op.actualMinutes).plus(minutes).toDecimalPlaces(2) } });
    });
  }

  /** applies the conversion cost of the minutes worked: Dr WIP / Cr labour applied, Cr overhead applied */
  private async applyConversion(tx: Tx, op: { id: string; seq: number; name: string; appliedCost: Prisma.Decimal; labourRate: Prisma.Decimal; machineRate: Prisma.Decimal; overheadRate: Prisma.Decimal }, minutes: Prisma.Decimal, w: { id: string; companyId: string; branchId: string | null; number: string }, date: Date) {
    const labour = round(minutes.times(op.labourRate).div(60));
    const overhead = round(minutes.times(D(op.machineRate).plus(op.overheadRate)).div(60));
    const total = labour.plus(overhead);
    const delta = total.minus(op.appliedCost);
    if (!delta.isZero()) {
      const prevLabour = D(op.appliedCost).isZero() ? ZERO : round(D(op.appliedCost).times(labour).div(total.isZero() ? 1 : total));
      const dl = labour.minus(prevLabour);
      const doh = delta.minus(dl);
      const j: PostingLine[] = delta.gt(0)
        ? [{ key: 'WIP', debit: delta, description: `Step ${op.seq} ${op.name}` }, ...(dl.gt(0) ? [{ key: 'LABOUR_APPLIED', credit: dl }] : []), ...(doh.gt(0) ? [{ key: 'OVERHEAD_APPLIED', credit: doh }] : [])]
        : [...(dl.lt(0) ? [{ key: 'LABOUR_APPLIED', debit: dl.abs() }] : []), ...(doh.lt(0) ? [{ key: 'OVERHEAD_APPLIED', debit: doh.abs() }] : []), { key: 'WIP', credit: delta.abs(), description: `Step ${op.seq} ${op.name} corrected` }];
      if (j.length > 1) await this.journal.post(tx, { companyId: w.companyId, branchId: w.branchId, date, description: `${w.number}: step ${op.seq} ${op.name}`, reference: w.number, sourceType: 'WO', sourceId: w.id, lines: j });
      await tx.workOrder.update({ where: { id: w.id }, data: { wipConversion: { increment: delta } } });
    }
    await tx.workOrderOperation.update({ where: { id: op.id }, data: { appliedCost: total, actualMinutes: minutes.toDecimalPlaces(2) } });
  }

  async finishOperation(opId: string, input: z.infer<typeof finishOpSchema>) {
    RequestCtx.assert('manufacturing.order.report');
    const u = RequestCtx.user();
    return this.prisma.$transaction(async (tx) => {
      const op = await this.ownOperation(opId, tx);
      if (op.status === 'DONE') throw new ConflictException('This step is already finished');
      const running = op.status === 'RUNNING' && op.runningSince ? (Date.now() - op.runningSince.getTime()) / 60000 : 0;
      const minutes = input.minutes !== undefined ? D(input.minutes) : D(op.actualMinutes).plus(running);
      await this.applyConversion(tx, op, minutes, op.workOrder, new Date());
      const r = await tx.workOrderOperation.update({ where: { id: opId }, data: { status: 'DONE', runningSince: null, finishedAt: new Date(), startedAt: op.startedAt ?? new Date(), goodQty: D(input.goodQty), scrapQty: D(input.scrapQty), operatorId: op.operatorId ?? u.id, notes: input.notes ?? op.notes } });
      await this.audit.record('Work Order', op.workOrderId, 'STEP_DONE', undefined, { step: op.seq, minutes: minutes.toFixed(1), good: input.goodQty, scrap: input.scrapQty }, tx);
      return r;
    });
  }

  /** open steps for the shop floor (released orders), optionally of one work centre */
  async shopFloor(workCenterId?: string) {
    RequestCtx.assert('manufacturing.order.report');
    const companyId = RequestCtx.companyId();
    const ops = await this.prisma.workOrderOperation.findMany({
      where: { status: { not: 'DONE' }, ...(workCenterId && UUID.test(workCenterId) ? { workCenterId } : {}), workOrder: { companyId, status: 'RELEASED', deletedAt: null } },
      include: { workOrder: { select: { id: true, number: true, productId: true, qty: true, plannedDate: true, operations: { select: { seq: true, status: true } } } } },
      orderBy: [{ workOrder: { plannedDate: 'asc' } }, { seq: 'asc' }],
      take: 300,
    });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: ops.map((o) => o.workOrder.productId) } }, select: { id: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    const centres = new Map((await this.prisma.workCenter.findMany({ where: { companyId, deletedAt: null } })).map((c) => [c.id, c]));
    return ops.map((o) => {
      const before = o.workOrder.operations.filter((x) => x.seq < o.seq);
      return {
        id: o.id,
        seq: o.seq,
        name: o.name,
        status: o.status,
        plannedMinutes: n(o.plannedMinutes),
        actualMinutes: n(o.actualMinutes),
        runningSince: o.runningSince,
        workCenter: centres.get(o.workCenterId)?.name ?? '-',
        workCenterId: o.workCenterId,
        order: { id: o.workOrder.id, number: o.workOrder.number, qty: n(o.workOrder.qty), plannedDate: o.workOrder.plannedDate },
        product: products.get(o.workOrder.productId)?.name ?? '',
        uom: products.get(o.workOrder.productId)?.uom?.code ?? '',
        /** previous steps finished: ready to work on */
        ready: before.every((x) => x.status === 'DONE'),
      };
    });
  }

  // ------------------------------------------------------------------ completion
  /**
   * Finishes production: tops up / returns materials to the actual use, applies the remaining routing steps at their
   * planned time, then empties work in process:
   * by-products (NRV) -> abnormal loss (scrap above the normal rate) -> co-products (cost share) -> main product.
   */
  async complete(id: string, input: z.infer<typeof completeSchema>) {
    RequestCtx.assert('manufacturing.order.confirm');
    const u = RequestCtx.user();
    const allowNegative = await this.allowNegative(u.companyId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${id}::uuid FOR UPDATE`;
        let w = await this.ownOrder(id, tx);
        if (!['DRAFT', 'RELEASED'].includes(w.status)) throw new ConflictException('This work order is already finished or cancelled');
        const bom = await tx.bom.findUniqueOrThrow({ where: { id: w.bomId } });
        // 1. materials: issue what is still missing / return what was not used
        const used = new Map(input.consumed.map((c) => [c.lineId, D(c.qty)]));
        for (const l of w.lines) {
          const target = used.get(l.id) ?? (D(l.issuedQty).gt(0) ? D(l.issuedQty) : D(l.plannedQty));
          const diff = target.minus(l.issuedQty);
          if (!diff.isZero()) await this.moveMaterial(tx, w, l, diff, input.date, allowNegative);
        }
        // 2. steps not reported: applied at their planned time
        for (const op of w.operations.filter((o) => o.status !== 'DONE')) {
          const running = op.status === 'RUNNING' && op.runningSince ? (Date.now() - op.runningSince.getTime()) / 60000 : 0;
          const minutes = D(op.actualMinutes).plus(running).gt(0) ? D(op.actualMinutes).plus(running) : D(op.plannedMinutes);
          await this.applyConversion(tx, op, minutes, w, input.date);
          await tx.workOrderOperation.update({ where: { id: op.id }, data: { status: 'DONE', runningSince: null, finishedAt: new Date(), startedAt: op.startedAt ?? new Date(), goodQty: D(input.producedQty) } });
        }
        // 3. flat conversion cost of a BOM without routing
        const flat = D(w.labourCost).plus(w.overheadCost);
        if (flat.gt(0)) {
          await this.journal.post(tx, {
            companyId: w.companyId,
            branchId: w.branchId,
            date: input.date,
            description: `${w.number}: labour and overhead applied`,
            reference: w.number,
            sourceType: 'WO',
            sourceId: w.id,
            lines: [{ key: 'WIP', debit: flat }, ...(D(w.labourCost).gt(0) ? [{ key: 'LABOUR_APPLIED', credit: D(w.labourCost) }] : []), ...(D(w.overheadCost).gt(0) ? [{ key: 'OVERHEAD_APPLIED', credit: D(w.overheadCost) }] : [])],
          });
          await tx.workOrder.update({ where: { id }, data: { wipConversion: { increment: flat } } });
        }
        w = await this.ownOrder(id, tx);
        const wip = round(D(w.wipMaterial).plus(w.wipConversion));
        const products = new Map((await tx.product.findMany({ where: { id: { in: [w.productId, ...w.outputs.map((o) => o.productId)] } } })).map((p) => [p.id, p]));
        const base = { companyId: w.companyId, branchId: w.branchId, date: input.date, docType: 'WO', documentId: w.id, documentNumber: w.number, allowNegative };
        const outQty = new Map(input.outputs.map((o) => [o.outputId, D(o.qty)]));
        const j: PostingLine[] = [];
        let left = wip;
        // 4. by-products at net realisable value
        let byValue = ZERO;
        for (const o of w.outputs.filter((x) => x.kind === 'BY')) {
          const qty = outQty.get(o.id) ?? D(o.plannedQty);
          if (qty.lte(0)) continue;
          const value = Prisma.Decimal.min(round(qty.times(o.nrvPerUnit)), left);
          const p = products.get(o.productId)!;
          await this.inventory.move(tx, { ...base, productId: p.id, productName: p.name, warehouseId: w.outputWarehouseId, qty, unitCost: value.div(qty) });
          await tx.workOrderOutput.update({ where: { id: o.id }, data: { producedQty: qty, unitCost: value.div(qty).toDecimalPlaces(4) } });
          if (value.gt(0)) j.push({ key: 'INVENTORY', debit: value, description: `By-product ${p.name} (net realisable value)` });
          byValue = byValue.plus(value);
          left = left.minus(value);
        }
        // 5. abnormal loss: finished units lost above the normal rate, valued like good units
        const produced = D(input.producedQty);
        const scrap = D(input.scrapQty);
        const normal = produced.plus(scrap).times(bom.normalScrapPct).div(100);
        const abnormalUnits = Prisma.Decimal.max(ZERO, scrap.minus(normal));
        const abnormal = abnormalUnits.gt(0) ? round(left.times(abnormalUnits).div(produced.plus(abnormalUnits))) : ZERO;
        if (abnormal.gt(0)) j.push({ key: 'ABNORMAL_LOSS', debit: abnormal, description: `${abnormalUnits.toFixed(2)} units lost above the normal ${n(bom.normalScrapPct)}%` });
        left = left.minus(abnormal);
        // 6. co-products by their share of the joint cost, the rest to the main product
        const joint = left;
        for (const o of w.outputs.filter((x) => x.kind === 'CO')) {
          const qty = outQty.get(o.id) ?? D(o.plannedQty);
          if (qty.lte(0)) continue;
          const value = round(joint.times(o.costSharePct).div(100));
          const p = products.get(o.productId)!;
          await this.inventory.move(tx, { ...base, productId: p.id, productName: p.name, warehouseId: w.outputWarehouseId, qty, unitCost: value.div(qty) });
          await tx.workOrderOutput.update({ where: { id: o.id }, data: { producedQty: qty, unitCost: value.div(qty).toDecimalPlaces(4) } });
          if (value.gt(0)) j.push({ key: 'INVENTORY', debit: value, description: `Co-product ${p.name}` });
          left = left.minus(value);
        }
        const fg = products.get(w.productId)!;
        const unitCost = left.div(produced);
        if (fg.trackLots) {
          await this.lots.ensureOpening(tx, w.companyId, fg.id, w.outputWarehouseId);
          await this.lots.receive(tx, { companyId: w.companyId, documentId: w.id, lineId: w.id, productId: fg.id, warehouseId: w.outputWarehouseId, qty: produced, lotNo: input.lotNo ?? w.lotNo ?? w.number, expiryDate: input.expiryDate ?? w.expiryDate, docNumber: w.number, docDate: input.date, shelfLifeDays: fg.shelfLifeDays });
        }
        const r = await this.inventory.move(tx, { ...base, productId: fg.id, productName: fg.name, warehouseId: w.outputWarehouseId, qty: produced, unitCost });
        j.push({ key: 'INVENTORY', debit: r.totalCost, description: `Produced ${fg.name}` });
        // empty work in process (rounding of the receipt value goes to cost of sales)
        const debits = sum(j.map((x) => D(x.debit ?? 0)));
        if (wip.gt(0)) j.push({ key: 'WIP', credit: wip, description: 'Work in process closed' });
        const diff = debits.minus(wip);
        if (!diff.isZero()) j.push(diff.gt(0) ? { key: 'COGS', credit: diff, description: 'Rounding' } : { key: 'COGS', debit: diff.abs(), description: 'Rounding' });
        if (wip.gt(0)) await this.journal.post(tx, { companyId: w.companyId, branchId: w.branchId, date: input.date, description: `Work order ${w.number} - ${fg.name}`, reference: w.number, sourceType: 'WO', sourceId: w.id, lines: j });
        const est = await this.estimate(w.bomId);
        const done = await tx.workOrder.update({
          where: { id },
          data: {
            status: 'DONE',
            producedQty: produced,
            scrapQty: scrap,
            completedDate: input.date,
            materialCost: D(w.wipMaterial),
            totalCost: wip,
            unitCost: unitCost.toDecimalPlaces(4),
            abnormalLoss: abnormal,
            byProductValue: byValue,
            standardCost: est ? round(D(est.perUnit).times(produced)) : ZERO,
            wipMaterial: ZERO,
            wipConversion: ZERO,
            lotNo: input.lotNo ?? w.lotNo,
            expiryDate: input.expiryDate ?? w.expiryDate,
            updatedById: u.id,
          },
        });
        // final inspection of the produced lot (held until released when the plan says so)
        await this.quality.onProduction(tx, w, produced);
        await this.audit.record('Work Order', id, 'COMPLETE', { status: w.status }, { status: 'DONE', produced: produced.toString(), scrap: scrap.toString(), cost: wip.toString(), abnormalLoss: abnormal.toString() }, tx);
        return done;
      },
      { timeout: 120_000 },
    );
  }

  /** cancels a work order: stock movements (materials, products), lots and every journal of it are reversed */
  async cancel(id: string) {
    RequestCtx.assert('manufacturing.order.cancel');
    const allowNegative = await this.allowNegative(RequestCtx.companyId());
    return this.prisma.$transaction(async (tx) => {
      const w = await this.ownOrder(id, tx);
      if (w.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      await this.inventory.reverse(tx, id, allowNegative);
      await this.lots.reverse(tx, id);
      await this.journal.voidBySource(tx, 'WO', id);
      await this.quality.onCancel(tx, id);
      await tx.workOrder.update({ where: { id }, data: { status: 'CANCELLED', wipMaterial: ZERO, wipConversion: ZERO, updatedById: RequestCtx.user().id } });
      await tx.workOrderLine.updateMany({ where: { workOrderId: id }, data: { issuedQty: ZERO } });
      await this.audit.record('Work Order', id, 'CANCEL', { status: w.status }, { status: 'CANCELLED' }, tx);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ capacity
  /**
   * Capacity and overhead absorption of a month per work centre: hours worked vs normal capacity, load of open steps.
   * Overhead rates are set on normal capacity (SAK EP / PSAK 202): when fewer hours are worked, the overhead not absorbed
   * stays an expense of the month (it is not pushed into the stock value).
   */
  async capacity(month: string) {
    RequestCtx.assert('manufacturing.order.read');
    const companyId = RequestCtx.companyId();
    const [y, m] = /^\d{4}-\d{2}$/.test(month) ? month.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const centres = await this.prisma.workCenter.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' } });
    const [done, open] = await Promise.all([
      this.prisma.workOrderOperation.groupBy({ by: ['workCenterId'], where: { status: 'DONE', finishedAt: { gte: from, lt: to }, workOrder: { companyId, status: { not: 'CANCELLED' } } }, _sum: { actualMinutes: true, appliedCost: true } }),
      this.prisma.workOrderOperation.groupBy({ by: ['workCenterId'], where: { status: { not: 'DONE' }, workOrder: { companyId, status: { in: ['DRAFT', 'RELEASED'] }, deletedAt: null } }, _sum: { plannedMinutes: true, actualMinutes: true } }),
    ]);
    const dm = new Map(done.map((d) => [d.workCenterId, d]));
    const om = new Map(open.map((d) => [d.workCenterId, d]));
    return {
      month: `${y}-${String(m).padStart(2, '0')}`,
      centres: centres.map((c) => {
        const hours = n(dm.get(c.id)?._sum.actualMinutes) / 60;
        const capacity = n(c.capacityHours) * c.stations;
        const ohRate = n(c.machineRate) + n(c.overheadRate);
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          capacityHours: capacity,
          workedHours: Math.round(hours * 100) / 100,
          utilisationPct: capacity ? Math.round((hours / capacity) * 1000) / 10 : null,
          loadHours: Math.round(((n(om.get(c.id)?._sum.plannedMinutes) - n(om.get(c.id)?._sum.actualMinutes)) / 60) * 100) / 100,
          appliedCost: n(dm.get(c.id)?._sum.appliedCost),
          overheadApplied: Math.round(hours * ohRate),
          overheadAtCapacity: Math.round(capacity * ohRate),
          unabsorbedOverhead: Math.round(Math.max(0, capacity - hours) * ohRate),
        };
      }),
    };
  }

  // ------------------------------------------------------------------ SIINas
  /** quarterly production summary (quantities and value produced, materials used) for the SIINas report (Permenperin 13/2025) */
  async productionSummary(year: number, quarter: number) {
    RequestCtx.assert('manufacturing.order.read');
    const companyId = RequestCtx.companyId();
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3, 0));
    const orders = await this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, status: 'DONE', completedDate: { gte: from, lte: to } }, include: { lines: true, outputs: true } });
    const ids = [...new Set([...orders.map((o) => o.productId), ...orders.flatMap((o) => [...o.lines.map((l) => l.productId), ...o.outputs.map((x) => x.productId)])])];
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]));
    const out = new Map<string, { qty: number; value: number; orders: number }>();
    const mat = new Map<string, { qty: number; value: number }>();
    for (const o of orders) {
      const x = out.get(o.productId) ?? { qty: 0, value: 0, orders: 0 };
      x.qty += n(o.producedQty);
      x.value += n(o.producedQty) * n(o.unitCost);
      x.orders += 1;
      out.set(o.productId, x);
      for (const y of o.outputs.filter((v) => n(v.producedQty) > 0)) {
        const z = out.get(y.productId) ?? { qty: 0, value: 0, orders: 0 };
        z.qty += n(y.producedQty);
        z.value += n(y.producedQty) * n(y.unitCost);
        z.orders += 1;
        out.set(y.productId, z);
      }
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
