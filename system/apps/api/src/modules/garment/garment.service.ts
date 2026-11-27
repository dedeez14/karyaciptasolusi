import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { DocumentService } from '../documents/document.service';
import { LotService } from '../documents/lot.service';
import { cutQuantities, fabricVariance, lineEfficiency, makeBundles, skuCode } from './garment-calc';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const key = (colour: string, size: string) => `${colour}|${size}`;

export const styleSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  customerId: optUuid,
  season: optText(40),
  category: optText(60),
  sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(20),
  colours: z.array(z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(60) })).min(1).max(40),
  composition: optText(150),
  care: optText(200),
  salePrice: z.coerce.number().min(0).max(1e10).default(0),
  notes: optText(2000),
  isActive: z.boolean().default(true),
  operations: z.array(z.object({ name: z.string().trim().min(1).max(120), machine: optText(20), sam: z.coerce.number().min(0).max(1000), pieceRate: z.coerce.number().min(0).max(1e7).default(0) })).max(200).default([]),
  materials: z.array(z.object({ kind: z.enum(['FABRIC', 'TRIM']), productId: z.uuid(), qtyPerPiece: z.coerce.number().positive().max(1e6), colour: optText(30) })).max(100).default([]),
});
export const orderSchema = z.object({
  styleId: z.uuid(),
  customerId: optUuid,
  buyerRef: optText(60),
  orderDate: z.coerce.date(),
  shipDate: optDate,
  warehouseId: z.uuid(),
  fgWarehouseId: z.uuid(),
  cutAllowancePct: z.coerce.number().min(0).max(30).default(0),
  matrix: z.array(z.object({ colour: z.string().min(1).max(30), size: z.string().min(1).max(20), qty: z.coerce.number().int().min(0).max(10_000_000) })).min(1).max(1000),
  notes: optText(2000),
});
export const laySchema = z.object({
  date: z.coerce.date(),
  colour: z.string().min(1).max(30),
  ratio: z.record(z.string().max(20), z.coerce.number().int().min(0).max(50)),
  plies: z.coerce.number().int().positive().max(1000),
  markerLengthM: optNum,
  markerEfficiency: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  fabricProductId: optUuid,
  fabricQty: z.coerce.number().min(0).max(1e8).default(0),
  shade: optText(20),
  bundleSize: z.coerce.number().int().min(1).max(200).default(20),
});
export const outputSchema = z.object({
  date: z.coerce.date(),
  lineId: z.uuid(),
  operators: z.coerce.number().int().positive().max(1000),
  helpers: z.coerce.number().int().min(0).max(1000).default(0),
  minutes: z.coerce.number().positive().max(1440),
  pieces: z.record(z.string().max(60), z.coerce.number().int().min(0).max(1_000_000)),
  rejects: z.coerce.number().int().min(0).max(1_000_000).default(0),
  notes: optText(300),
});
export const receiveSchema = z.object({ date: z.coerce.date(), rows: z.array(z.object({ colour: z.string().min(1).max(30), size: z.string().min(1).max(20), qty: z.coerce.number().int().min(0).max(1_000_000) })).min(1).max(1000) });

type Style = Prisma.GarmentStyleGetPayload<{ include: { variants: true; operations: true; materials: true } }>;
type Order = Prisma.GarmentOrderGetPayload<{ include: { lines: true } }>;

/**
 * Garment add-on: a style has its size run and colours (one stock product per SKU), its operation bulletin with SAM and
 * its materials per piece. Production orders are entered as a colour x size matrix; cutting lays issue the fabric
 * (Dr WIP / Cr Inventory) and make the bundle tickets; sewing lines report output and efficiency; packed pieces enter
 * finished goods at fabric share + trims + conversion (SAM x cost per minute, credited to labour applied).
 */
@Injectable()
export class GarmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly documents: DocumentService,
    private readonly lots: LotService,
  ) {}

  private allowNegative(companyId: string) {
    return this.settings.bool('inventory.allowNegativeStock', companyId, false);
  }

  private async styleOwn(id: string): Promise<Style> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Style not found');
    const s = await this.prisma.garmentStyle.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { variants: true, operations: { orderBy: { seq: 'asc' } }, materials: true } });
    if (!s) throw new NotFoundException('Style not found');
    return s;
  }

  private async orderOwn(id: string): Promise<Order> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Order not found');
    const o = await this.prisma.garmentOrder.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: true } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  private styleOut(s: Style) {
    return {
      ...s,
      sam: n(s.sam),
      salePrice: n(s.salePrice),
      sizes: s.sizes as string[],
      colours: s.colours as { code: string; name: string }[],
      operations: s.operations.map((o) => ({ ...o, sam: n(o.sam), pieceRate: n(o.pieceRate) })),
      materials: s.materials.map((m) => ({ ...m, qtyPerPiece: n(m.qtyPerPiece) })),
    };
  }

  // ================================================================ styles
  async lists() {
    RequestCtx.assert('garment.read');
    const companyId = RequestCtx.companyId();
    const lines = await this.prisma.workCenter.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    return { lines, costPerMinute: await this.settings.num('garment.costPerMinute', companyId, 0) };
  }

  async styles() {
    RequestCtx.assert('garment.read');
    const rows = await this.prisma.garmentStyle.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null }, orderBy: { code: 'asc' }, include: { variants: true, operations: { orderBy: { seq: 'asc' } }, materials: true } });
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((s) => ({ ...this.styleOut(s), customer: s.customerId ? cust.get(s.customerId) ?? null : null }));
  }

  async style(id: string) {
    RequestCtx.assert('garment.read');
    const s = await this.styleOwn(id);
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...s.variants.map((v) => v.productId), ...s.materials.map((m) => m.productId)] } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const customer = s.customerId ? await this.prisma.customer.findUnique({ where: { id: s.customerId }, select: { id: true, name: true } }) : null;
    return { ...this.styleOut(s), customer, variants: s.variants.map((v) => ({ ...v, product: products.get(v.productId) ?? null })), materials: this.styleOut(s).materials.map((m) => ({ ...m, product: products.get(m.productId) ?? null })) };
  }

  /** saves a style and makes the missing SKU products (one stock product per colour x size) */
  async saveStyle(id: string | null, input: z.infer<typeof styleSchema>) {
    RequestCtx.assert('garment.style.manage');
    const u = RequestCtx.user();
    const sizes = input.sizes.map((x) => x.toUpperCase());
    const colours = input.colours.map((c) => ({ code: c.code.toUpperCase(), name: c.name }));
    if (new Set(sizes).size !== sizes.length) throw invalid({ sizes: 'A size appears twice' });
    if (new Set(colours.map((c) => c.code)).size !== colours.length) throw invalid({ colours: 'A colour appears twice' });
    if (await this.prisma.garmentStyle.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } })) throw invalid({ code: 'Code is already used' });
    if (input.customerId && !(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Customer not found' });
    const mats = await this.prisma.product.findMany({ where: { companyId: u.companyId, deletedAt: null, id: { in: input.materials.map((m) => m.productId) } } });
    input.materials.forEach((m, i) => {
      const p = mats.find((x) => x.id === m.productId);
      if (!p || p.type !== 'STOCK') throw invalid({ [`materials.${i}.productId`]: 'Choose a stock product' });
      if (m.colour && !colours.some((c) => c.code === m.colour!.toUpperCase())) throw invalid({ [`materials.${i}.colour`]: 'Not a colour of the style' });
    });
    if (id) {
      const before = await this.styleOwn(id);
      const used = await this.prisma.garmentOrderLine.findMany({ where: { order: { styleId: id, status: { not: 'CANCELLED' } }, qty: { gt: 0 } }, select: { colour: true, size: true } });
      const gone = used.filter((l) => !sizes.includes(l.size) || !colours.some((c) => c.code === l.colour));
      if (gone.length) throw invalid({ sizes: `Ordered SKUs cannot be removed: ${[...new Set(gone.map((g) => key(g.colour, g.size)))].join(', ')}` });
      void before;
    }
    const sam = input.operations.reduce((a, o) => a + o.sam, 0);
    const uom = await this.prisma.uom.findFirst({ where: { companyId: u.companyId, code: 'PCS' } });
    const row = await this.prisma.$transaction(async (tx) => {
      const data = { code: input.code, name: input.name, customerId: input.customerId ?? null, season: input.season ?? null, category: input.category ?? null, sizes: sizes as Prisma.InputJsonValue, colours: colours as Prisma.InputJsonValue, composition: input.composition ?? null, care: input.care ?? null, sam: D(Math.round(sam * 1000) / 1000), salePrice: D(input.salePrice), notes: input.notes ?? null, isActive: input.isActive, updatedById: u.id };
      const s = id ? await tx.garmentStyle.update({ where: { id }, data }) : await tx.garmentStyle.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
      await tx.garmentOperation.deleteMany({ where: { styleId: s.id } });
      if (input.operations.length) await tx.garmentOperation.createMany({ data: input.operations.map((o, i) => ({ styleId: s.id, seq: i + 1, name: o.name, machine: o.machine ?? null, sam: D(o.sam), pieceRate: D(o.pieceRate) })) });
      await tx.garmentMaterial.deleteMany({ where: { styleId: s.id } });
      if (input.materials.length) await tx.garmentMaterial.createMany({ data: input.materials.map((m) => ({ styleId: s.id, kind: m.kind, productId: m.productId, qtyPerPiece: D(m.qtyPerPiece), colour: m.colour ? m.colour.toUpperCase() : null })) });
      // SKU products for every colour x size not there yet
      const have = await tx.garmentVariant.findMany({ where: { styleId: s.id } });
      for (const c of colours) {
        for (const size of sizes) {
          if (have.some((v) => v.colour === c.code && v.size === size)) continue;
          const code = skuCode(input.code, c.code, size);
          let p = await tx.product.findFirst({ where: { companyId: u.companyId, code } });
          if (!p)
            p = await tx.product.create({
              data: { companyId: u.companyId, code, name: `${input.name} ${c.name} ${size}`.slice(0, 200), type: 'STOCK', uomId: uom?.id ?? null, salePrice: D(input.salePrice), description: [input.composition, input.care].filter(Boolean).join(' · ') || null, isSellable: true, isPurchasable: false, createdById: u.id },
            });
          await tx.garmentVariant.create({ data: { styleId: s.id, colour: c.code, size, productId: p.id } });
        }
      }
      return s;
    });
    await this.audit.record('Garment Style', row.id, id ? 'UPDATE' : 'CREATE', undefined, { code: row.code, skus: sizes.length * colours.length, sam });
    return this.style(row.id);
  }

  // ================================================================ orders
  async orders(q: { status?: string; styleId?: string }) {
    RequestCtx.assert('garment.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.garmentOrder.findMany({ where: { companyId, ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }), ...(q.styleId ? { styleId: q.styleId } : {}) }, orderBy: [{ orderDate: 'desc' }, { number: 'desc' }], take: 500, include: { lines: true } });
    const styles = new Map((await this.prisma.garmentStyle.findMany({ where: { id: { in: rows.map((r) => r.styleId) } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((o) => ({ ...this.orderSummary(o), style: styles.get(o.styleId) ?? null, customer: o.customerId ? cust.get(o.customerId) ?? null : null }));
  }

  private orderSummary(o: Order) {
    const sum = (k: 'qty' | 'cutQty' | 'sewnQty' | 'receivedQty' | 'rejectQty') => o.lines.reduce((a, l) => a + l[k], 0);
    return {
      id: o.id,
      number: o.number,
      styleId: o.styleId,
      buyerRef: o.buyerRef,
      orderDate: o.orderDate,
      shipDate: o.shipDate,
      status: o.status,
      qty: sum('qty'),
      cut: sum('cutQty'),
      sewn: sum('sewnQty'),
      received: sum('receivedQty'),
      rejects: sum('rejectQty'),
      cutAllowancePct: n(o.cutAllowancePct),
    };
  }

  async order(id: string) {
    RequestCtx.assert('garment.read');
    const o = await this.orderOwn(id);
    const s = await this.styleOwn(o.styleId);
    const [lays, outputs, receipts, customer, wh, fg] = await Promise.all([
      this.prisma.garmentLay.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' }, include: { bundles: { orderBy: { bundleNo: 'asc' } } } }),
      this.prisma.garmentLineOutput.findMany({ where: { orderId: o.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.garmentReceipt.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'desc' } }),
      o.customerId ? this.prisma.customer.findUnique({ where: { id: o.customerId }, select: { id: true, name: true } }) : null,
      this.prisma.warehouse.findUnique({ where: { id: o.warehouseId }, select: { id: true, name: true } }),
      this.prisma.warehouse.findUnique({ where: { id: o.fgWarehouseId }, select: { id: true, name: true } }),
    ]);
    const lines = new Map((await this.prisma.workCenter.findMany({ where: { id: { in: outputs.map((x) => x.lineId) } }, select: { id: true, code: true, name: true } })).map((l) => [l.id, l]));
    const so = o.salesOrderId ? await this.prisma.tradeDocument.findFirst({ where: { id: o.salesOrderId, deletedAt: null }, select: { id: true, number: true, status: true } }) : null;
    const fabricStd = s.materials.filter((m) => m.kind === 'FABRIC');
    const posted = lays.filter((l) => l.status === 'POSTED');
    return {
      ...this.orderSummary(o),
      warehouseId: o.warehouseId,
      fgWarehouseId: o.fgWarehouseId,
      customerId: o.customerId,
      notes: o.notes,
      costs: { fabric: n(o.fabricCost), fabricRelieved: n(o.fabricRelieved), trims: n(o.trimCost), conversion: n(o.conversionCost), closedLoss: n(o.closedLoss), wip: n(o.fabricCost) - n(o.fabricRelieved) - n(o.closedLoss) },
      style: this.styleOut(s),
      customer,
      warehouse: wh,
      fgWarehouse: fg,
      salesOrder: so,
      lines: o.lines.map((l) => ({ ...l, toCut: Math.max(0, Math.ceil(l.qty * (1 + n(o.cutAllowancePct) / 100)) - l.cutQty) })),
      lays: lays.map((l) => {
        const pieces = l.bundles.reduce((a, b) => a + b.qty, 0);
        const std = fabricStd.find((m) => !m.colour || m.colour === l.colour);
        return { ...l, markerLengthM: l.markerLengthM === null ? null : n(l.markerLengthM), markerEfficiency: l.markerEfficiency === null ? null : n(l.markerEfficiency), fabricQty: n(l.fabricQty), fabricCost: n(l.fabricCost), pieces, fabric: std && l.fabricProductId === std.productId ? fabricVariance(n(l.fabricQty), pieces, n(std.qtyPerPiece)) : null };
      }),
      fabricUsed: posted.reduce((a, l) => a + n(l.fabricQty), 0),
      outputs: outputs.map((x) => ({ ...x, minutes: n(x.minutes), sam: n(x.sam), efficiency: n(x.efficiency), line: lines.get(x.lineId) ?? null })),
      receipts: receipts.map((r) => ({ ...r, fabricCost: n(r.fabricCost), trimCost: n(r.trimCost), conversionCost: n(r.conversionCost) })),
    };
  }

  private async checkMatrix(s: Style, matrix: { colour: string; size: string; qty: number }[]) {
    const sizes = s.sizes as string[];
    const colours = (s.colours as { code: string }[]).map((c) => c.code);
    for (const m of matrix) if (!sizes.includes(m.size) || !colours.includes(m.colour)) throw invalid({ matrix: `${m.colour} / ${m.size} is not a SKU of the style` });
    if (!matrix.some((m) => m.qty > 0)) throw invalid({ matrix: 'Enter the quantities' });
  }

  async createOrder(input: z.infer<typeof orderSchema>) {
    RequestCtx.assert('garment.order.manage');
    const u = RequestCtx.user();
    const s = await this.styleOwn(input.styleId);
    await this.checkMatrix(s, input.matrix);
    for (const [k, v] of [['warehouseId', input.warehouseId], ['fgWarehouseId', input.fgWarehouseId]] as const) if (!(await this.prisma.warehouse.findFirst({ where: { id: v, companyId: u.companyId, deletedAt: null } }))) throw invalid({ [k]: 'Warehouse not found' });
    if (input.customerId && !(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Customer not found' });
    const row = await this.prisma.$transaction(async (tx) =>
      tx.garmentOrder.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          number: await this.sequence.next('GARMENT_ORDER', u.companyId, input.orderDate, tx),
          styleId: s.id,
          customerId: input.customerId ?? s.customerId ?? null,
          buyerRef: input.buyerRef ?? null,
          orderDate: input.orderDate,
          shipDate: input.shipDate ?? null,
          warehouseId: input.warehouseId,
          fgWarehouseId: input.fgWarehouseId,
          cutAllowancePct: D(input.cutAllowancePct),
          notes: input.notes ?? null,
          createdById: u.id,
          lines: { create: input.matrix.filter((m) => m.qty > 0).map((m) => ({ colour: m.colour, size: m.size, qty: m.qty, productId: s.variants.find((v) => v.colour === m.colour && v.size === m.size)!.productId })) },
        },
      }),
    );
    await this.audit.record('Garment Order', row.id, 'CREATE', undefined, { number: row.number, pieces: input.matrix.reduce((a, m) => a + m.qty, 0) });
    return this.order(row.id);
  }

  /** changes the matrix: quantities can go up freely, down to what was already cut */
  async updateMatrix(id: string, matrix: z.infer<typeof orderSchema>['matrix']) {
    RequestCtx.assert('garment.order.manage');
    const o = await this.orderOwn(id);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    const s = await this.styleOwn(o.styleId);
    await this.checkMatrix(s, matrix);
    await this.prisma.$transaction(async (tx) => {
      for (const m of matrix) {
        const l = o.lines.find((x) => x.colour === m.colour && x.size === m.size);
        if (l) {
          if (m.qty < l.receivedQty) throw invalid({ matrix: `${m.colour} / ${m.size}: ${l.receivedQty} already received` });
          await tx.garmentOrderLine.update({ where: { id: l.id }, data: { qty: m.qty } });
        } else if (m.qty > 0) await tx.garmentOrderLine.create({ data: { orderId: o.id, colour: m.colour, size: m.size, qty: m.qty, productId: s.variants.find((v) => v.colour === m.colour && v.size === m.size)!.productId } });
      }
    });
    await this.audit.record('Garment Order', id, 'MATRIX');
    return this.order(id);
  }

  async cancelOrder(id: string) {
    RequestCtx.assert('garment.order.manage');
    const o = await this.orderOwn(id);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    if (await this.prisma.garmentLay.count({ where: { orderId: id, status: 'POSTED' } })) throw new ConflictException('Fabric was cut for this order: close it instead');
    await this.prisma.garmentOrder.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Garment Order', id, 'CANCEL');
    return { ok: true };
  }

  /** closes the order: fabric cost still in work in process (cut pieces never finished) is written off */
  async closeOrder(id: string) {
    RequestCtx.assert('garment.order.manage');
    const u = RequestCtx.user();
    const o = await this.orderOwn(id);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    const left = D(o.fabricCost).minus(o.fabricRelieved);
    await this.prisma.$transaction(async (tx) => {
      if (left.gt(0)) await this.journal.post(tx, { companyId: u.companyId, branchId: o.branchId, date: todayDate(), description: `Garment order ${o.number} closed: cut pieces not finished`, reference: o.number, sourceType: 'GCLOSE', sourceId: o.id, lines: [{ key: 'ABNORMAL_LOSS', debit: left }, { key: 'WIP', credit: left }] });
      for (const l of o.lines) await tx.garmentOrderLine.update({ where: { id: l.id }, data: { rejectQty: Math.max(0, l.cutQty - l.receivedQty) } });
      await tx.garmentOrder.update({ where: { id }, data: { status: 'CLOSED', closedLoss: left.gt(0) ? left : D(0), updatedById: u.id } });
    });
    await this.audit.record('Garment Order', id, 'CLOSE', undefined, { loss: n(left) });
    return this.order(id);
  }

  async reopenOrder(id: string) {
    RequestCtx.assert('garment.order.manage');
    const o = await this.orderOwn(id);
    if (o.status !== 'CLOSED') throw new ConflictException('The order is not closed');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'GCLOSE', o.id);
      for (const l of o.lines) await tx.garmentOrderLine.update({ where: { id: l.id }, data: { rejectQty: 0 } });
      await tx.garmentOrder.update({ where: { id }, data: { status: 'OPEN', closedLoss: D(0), updatedById: RequestCtx.user().id } });
    });
    await this.audit.record('Garment Order', id, 'REOPEN');
    return this.order(id);
  }

  /** draft sales order for the buyer from the matrix (one line per SKU at the style price) */
  async salesOrder(id: string) {
    RequestCtx.assert('garment.order.manage');
    const o = await this.orderOwn(id);
    if (!o.customerId) throw new BadRequestException('Set the buyer of the order first');
    if (o.salesOrderId && (await this.prisma.tradeDocument.findFirst({ where: { id: o.salesOrderId, deletedAt: null, status: { not: 'CANCELLED' } } }))) throw new ConflictException('A sales order already exists');
    const s = await this.styleOwn(o.styleId);
    const doc = (await this.documents.create(
      'SO',
      {
        date: o.orderDate,
        dueDate: o.shipDate ?? undefined,
        customerId: o.customerId,
        warehouseId: o.fgWarehouseId,
        reference: o.buyerRef ?? o.number,
        notes: `Style ${s.code} ${s.name}, production order ${o.number}.${s.composition ? ` ${s.composition}.` : ''}`,
        lines: o.lines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: n(s.salePrice) })),
      },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    await this.prisma.garmentOrder.update({ where: { id }, data: { salesOrderId: doc.id } });
    return { id: doc.id, number: doc.number };
  }

  // ================================================================ cutting
  /** a cutting lay: fabric issued from the store into work in process, cut quantities and bundle tickets */
  async addLay(orderId: string, input: z.infer<typeof laySchema>) {
    RequestCtx.assert('garment.cut');
    const u = RequestCtx.user();
    const o = await this.orderOwn(orderId);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const s = await this.styleOwn(o.styleId);
    const colour = input.colour.toUpperCase();
    if (!(s.colours as { code: string }[]).some((c) => c.code === colour)) throw invalid({ colour: 'Not a colour of the style' });
    const sizes = s.sizes as string[];
    const ratio = Object.fromEntries(Object.entries(input.ratio).map(([k, v]) => [k.toUpperCase(), v]).filter(([, v]) => (v as number) > 0)) as Record<string, number>;
    if (!Object.keys(ratio).length) throw invalid({ ratio: 'Enter the marker ratio' });
    for (const size of Object.keys(ratio)) if (!sizes.includes(size)) throw invalid({ ratio: `${size} is not a size of the style` });
    if (input.fabricQty > 0 && !input.fabricProductId) throw invalid({ fabricProductId: 'Which fabric' });
    const cut = cutQuantities(ratio, input.plies);
    const id = randomUUID();
    const lay = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM garment_orders WHERE id = ${o.id}::uuid FOR UPDATE`;
      let cost = D(0);
      if (input.fabricQty > 0) {
        const p = await tx.product.findFirst({ where: { id: input.fabricProductId!, companyId: u.companyId, deletedAt: null } });
        if (!p || p.type !== 'STOCK') throw invalid({ fabricProductId: 'Choose a stock product' });
        if (p.trackLots) {
          await this.lots.ensureOpening(tx, u.companyId, p.id, o.warehouseId);
          await this.lots.issue(tx, { companyId: u.companyId, documentId: id, lineId: id, productId: p.id, warehouseId: o.warehouseId, qty: D(input.fabricQty) });
        }
        const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: o.branchId, productId: p.id, productName: p.name, warehouseId: o.warehouseId, date: input.date, qty: D(input.fabricQty).neg(), docType: 'GLAY', documentId: id, documentNumber: o.number, allowNegative: await this.allowNegative(u.companyId) });
        cost = round(mv.totalCost.abs());
        if (cost.gt(0)) await this.journal.post(tx, { companyId: u.companyId, branchId: o.branchId, date: input.date, description: `Fabric cut for ${o.number}: ${p.name}`, reference: o.number, sourceType: 'GLAY', sourceId: id, lines: [{ key: 'WIP', debit: cost }, { key: 'INVENTORY', credit: cost }] });
      }
      const last = await tx.garmentBundle.findFirst({ where: { orderId: o.id }, orderBy: { bundleNo: 'desc' } });
      const bundles = makeBundles(ratio, input.plies, input.bundleSize, (last?.bundleNo ?? 0) + 1, sizes);
      const row = await tx.garmentLay.create({
        data: {
          id,
          companyId: u.companyId,
          orderId: o.id,
          number: await this.sequence.next('GARMENT_LAY', u.companyId, input.date, tx),
          date: input.date,
          colour,
          ratio: ratio as Prisma.InputJsonValue,
          plies: input.plies,
          markerLengthM: input.markerLengthM ?? null,
          markerEfficiency: input.markerEfficiency ?? null,
          fabricProductId: input.fabricProductId ?? null,
          fabricQty: D(input.fabricQty),
          fabricCost: cost,
          shade: input.shade ?? null,
          bundleSize: input.bundleSize,
          createdById: u.id,
          bundles: { create: bundles.map((b) => ({ ...b, orderId: o.id, colour })) },
        },
      });
      for (const [size, qty] of Object.entries(cut)) {
        const line = o.lines.find((l) => l.colour === colour && l.size === size);
        if (line) await tx.garmentOrderLine.update({ where: { id: line.id }, data: { cutQty: { increment: qty } } });
        else await tx.garmentOrderLine.create({ data: { orderId: o.id, colour, size, qty: 0, cutQty: qty, productId: s.variants.find((v) => v.colour === colour && v.size === size)!.productId } });
      }
      await tx.garmentOrder.update({ where: { id: o.id }, data: { fabricCost: { increment: cost } } });
      return row;
    });
    await this.audit.record('Garment Lay', lay.id, 'CREATE', undefined, { number: lay.number, plies: input.plies, cut });
    return { ...(await this.order(o.id)), lay: { id: lay.id, number: lay.number } };
  }

  /** cancels a lay while its pieces are not sewn yet */
  async cancelLay(layId: string) {
    RequestCtx.assert('garment.cut');
    const u = RequestCtx.user();
    const lay = await this.prisma.garmentLay.findFirst({ where: { id: layId, companyId: u.companyId }, include: { bundles: true } });
    if (!lay) throw new NotFoundException('Lay not found');
    if (lay.status !== 'POSTED') throw new ConflictException('Already cancelled');
    const o = await this.orderOwn(lay.orderId);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    const cut = cutQuantities(lay.ratio as Record<string, number>, lay.plies);
    for (const [size, qty] of Object.entries(cut)) {
      const l = o.lines.find((x) => x.colour === lay.colour && x.size === size)!;
      if (l.cutQty - qty < l.sewnQty) throw new ConflictException(`${lay.colour} / ${size}: pieces of this lay are already sewn`);
    }
    if (D(o.fabricCost).minus(lay.fabricCost).lt(o.fabricRelieved)) throw new ConflictException('Finished goods already took this fabric cost: cancel their receipts first');
    await this.prisma.$transaction(async (tx) => {
      if (n(lay.fabricQty) > 0) {
        await this.inventory.reverse(tx, lay.id, true);
        await this.lots.reverse(tx, lay.id);
      }
      await this.journal.voidBySource(tx, 'GLAY', lay.id);
      for (const [size, qty] of Object.entries(cut)) {
        const l = o.lines.find((x) => x.colour === lay.colour && x.size === size)!;
        await tx.garmentOrderLine.update({ where: { id: l.id }, data: { cutQty: { decrement: qty } } });
      }
      await tx.garmentBundle.deleteMany({ where: { layId: lay.id } });
      await tx.garmentLay.update({ where: { id: lay.id }, data: { status: 'CANCELLED' } });
      await tx.garmentOrder.update({ where: { id: o.id }, data: { fabricCost: { decrement: lay.fabricCost } } });
    });
    await this.audit.record('Garment Lay', layId, 'CANCEL');
    return this.order(o.id);
  }

  // ================================================================ sewing output
  async addOutput(orderId: string, input: z.infer<typeof outputSchema>) {
    RequestCtx.assert('garment.output');
    const u = RequestCtx.user();
    const o = await this.orderOwn(orderId);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    if (!(await this.prisma.workCenter.findFirst({ where: { id: input.lineId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ lineId: 'Sewing line not found' });
    const s = await this.styleOwn(o.styleId);
    const pieces = Object.entries(input.pieces).filter(([, q]) => q > 0);
    if (!pieces.length) throw invalid({ pieces: 'Enter the pieces sewn' });
    for (const [k, q] of pieces) {
      const [colour, size] = k.split('|');
      const l = o.lines.find((x) => x.colour === colour && x.size === size);
      if (!l) throw invalid({ pieces: `${k} is not on the order` });
      if (l.sewnQty + q > l.cutQty) throw invalid({ pieces: `${colour} / ${size}: only ${l.cutQty - l.sewnQty} cut pieces left to sew` });
    }
    const total = pieces.reduce((a, [, q]) => a + q, 0);
    const eff = lineEfficiency(total, n(s.sam), input.operators, input.minutes);
    const row = await this.prisma.$transaction(async (tx) => {
      for (const [k, q] of pieces) {
        const [colour, size] = k.split('|');
        const l = o.lines.find((x) => x.colour === colour && x.size === size)!;
        await tx.garmentOrderLine.update({ where: { id: l.id }, data: { sewnQty: { increment: q } } });
      }
      return tx.garmentLineOutput.create({ data: { companyId: u.companyId, date: input.date, lineId: input.lineId, orderId: o.id, operators: input.operators, helpers: input.helpers, minutes: D(input.minutes), pieces: Object.fromEntries(pieces) as Prisma.InputJsonValue, totalPieces: total, rejects: input.rejects, sam: s.sam, efficiency: D(eff), notes: input.notes ?? null, createdById: u.id } });
    });
    await this.audit.record('Garment Output', row.id, 'CREATE', undefined, { pieces: total, efficiency: eff });
    return { ...(await this.order(o.id)), output: { id: row.id, efficiency: eff } };
  }

  async deleteOutput(outputId: string) {
    RequestCtx.assert('garment.output');
    const x = await this.prisma.garmentLineOutput.findFirst({ where: { id: outputId, companyId: RequestCtx.companyId() } });
    if (!x) throw new NotFoundException('Output not found');
    const o = await this.orderOwn(x.orderId);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    const pieces = x.pieces as Record<string, number>;
    for (const [k, q] of Object.entries(pieces)) {
      const [colour, size] = k.split('|');
      const l = o.lines.find((y) => y.colour === colour && y.size === size)!;
      if (l.sewnQty - q < l.receivedQty) throw new ConflictException(`${colour} / ${size}: those pieces are already received as finished goods`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [k, q] of Object.entries(pieces)) {
        const [colour, size] = k.split('|');
        const l = o.lines.find((y) => y.colour === colour && y.size === size)!;
        await tx.garmentOrderLine.update({ where: { id: l.id }, data: { sewnQty: { decrement: q } } });
      }
      await tx.garmentLineOutput.delete({ where: { id: x.id } });
    });
    return this.order(o.id);
  }

  // ================================================================ finished goods
  /**
   * Packed pieces into finished goods: each piece takes its share of the fabric in work in process, its trims (issued
   * now, by colour) and the conversion (SAM x cost per minute, credited to labour applied).
   */
  async receive(orderId: string, input: z.infer<typeof receiveSchema>) {
    RequestCtx.assert('garment.receive');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const rows = input.rows.filter((r) => r.qty > 0);
    if (!rows.length) throw invalid({ rows: 'Enter the pieces packed' });
    const costPerMinute = await this.settings.num('garment.costPerMinute', u.companyId, 0);
    const id = randomUUID();
    const rec = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM garment_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const o = await this.orderOwn(orderId);
      if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
      const s = await this.styleOwn(o.styleId);
      for (const r of rows) {
        const l = o.lines.find((x) => x.colour === r.colour && x.size === r.size);
        if (!l) throw invalid({ rows: `${r.colour} / ${r.size} is not on the order` });
        if (l.receivedQty + r.qty > l.sewnQty) throw invalid({ rows: `${r.colour} / ${r.size}: only ${l.sewnQty - l.receivedQty} sewn pieces not packed yet` });
      }
      const pieces = rows.reduce((a, r) => a + r.qty, 0);
      // fabric: the cost left in WIP shared by the cut pieces not received yet
      const openPieces = o.lines.reduce((a, l) => a + Math.max(0, l.cutQty - l.receivedQty), 0);
      const fabricLeft = D(o.fabricCost).minus(o.fabricRelieved);
      const fabricShare = openPieces > 0 ? round(fabricLeft.times(pieces).div(openPieces)) : D(0);
      const allowNegative = await this.allowNegative(u.companyId);
      let trims = D(0);
      const trimByColour = new Map<string, Prisma.Decimal>();
      for (const r of rows) {
        for (const m of s.materials.filter((x) => x.kind === 'TRIM' && (!x.colour || x.colour === r.colour))) {
          const p = await tx.product.findFirstOrThrow({ where: { id: m.productId } });
          const q = D(m.qtyPerPiece).times(r.qty);
          if (p.trackLots) {
            await this.lots.ensureOpening(tx, u.companyId, p.id, o.warehouseId);
            await this.lots.issue(tx, { companyId: u.companyId, documentId: id, lineId: `${id}`, productId: p.id, warehouseId: o.warehouseId, qty: q });
          }
          const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: o.branchId, productId: p.id, productName: p.name, warehouseId: o.warehouseId, date: input.date, qty: q.neg(), docType: 'GREC', documentId: id, documentNumber: o.number, allowNegative });
          const c = round(mv.totalCost.abs());
          trims = trims.plus(c);
          trimByColour.set(key(r.colour, r.size), (trimByColour.get(key(r.colour, r.size)) ?? D(0)).plus(c));
        }
      }
      const conversion = round(D(pieces).times(n(s.sam)).times(costPerMinute));
      const lines: { colour: string; size: string; productId: string; qty: number; unitCost: number }[] = [];
      let fgValue = D(0);
      for (const [i, r] of rows.entries()) {
        const l = o.lines.find((x) => x.colour === r.colour && x.size === r.size)!;
        const fab = i === rows.length - 1 ? fabricShare.minus(lines.reduce((a, x, j) => a.plus(round(fabricShare.times(rows[j].qty).div(pieces))), D(0))) : round(fabricShare.times(r.qty).div(pieces));
        const conv = round(conversion.times(r.qty).div(pieces));
        const value = fab.plus(conv).plus(trimByColour.get(key(r.colour, r.size)) ?? D(0));
        const unitCost = value.div(r.qty);
        const p = await tx.product.findFirstOrThrow({ where: { id: l.productId } });
        const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: o.branchId, productId: p.id, productName: p.name, warehouseId: o.fgWarehouseId, date: input.date, qty: D(r.qty), unitCost: unitCost.gt(0) ? unitCost : D(0.0001), docType: 'GREC', documentId: id, documentNumber: o.number, allowNegative: true });
        fgValue = fgValue.plus(round(mv.totalCost));
        await tx.garmentOrderLine.update({ where: { id: l.id }, data: { receivedQty: { increment: r.qty } } });
        lines.push({ colour: r.colour, size: r.size, productId: l.productId, qty: r.qty, unitCost: Math.round(n(unitCost) * 100) / 100 });
      }
      // ledger: finished goods in; WIP (fabric) and trims out; conversion applied (rounding of the stock values to conversion)
      const j: PostingLine[] = [{ key: 'INVENTORY', debit: fgValue, description: `Finished goods ${o.number}` }];
      if (fabricShare.gt(0)) j.push({ key: 'WIP', credit: fabricShare, description: 'Fabric of the pieces' });
      if (trims.gt(0)) j.push({ key: 'INVENTORY', credit: trims, description: 'Trims' });
      const applied = fgValue.minus(fabricShare).minus(trims);
      if (applied.gt(0)) j.push({ key: 'LABOUR_APPLIED', credit: applied, description: `Sewing ${pieces} pcs x ${n(s.sam)} min` });
      else if (applied.lt(0)) j.push({ key: 'LABOUR_APPLIED', debit: applied.abs(), description: 'Rounding' });
      if (fgValue.gt(0)) await this.journal.post(tx, { companyId: u.companyId, branchId: o.branchId, date: input.date, description: `Garment ${o.number}: ${pieces} pcs to finished goods`, reference: o.number, sourceType: 'GREC', sourceId: id, lines: j });
      await tx.garmentOrder.update({ where: { id: o.id }, data: { fabricRelieved: { increment: fabricShare }, trimCost: { increment: trims }, conversionCost: { increment: conversion } } });
      return tx.garmentReceipt.create({ data: { id, companyId: u.companyId, orderId: o.id, number: await this.sequence.next('GARMENT_RECEIPT', u.companyId, input.date, tx), date: input.date, lines: lines as Prisma.InputJsonValue, totalPieces: pieces, fabricCost: fabricShare, trimCost: trims, conversionCost: conversion, createdById: u.id } });
    });
    await this.audit.record('Garment Receipt', rec.id, 'CREATE', undefined, { number: rec.number, pieces: rec.totalPieces });
    return { ...(await this.order(orderId)), receipt: { id: rec.id, number: rec.number } };
  }

  /** cancels the last receipt of an open order (finished goods back out, costs back into the order) */
  async cancelReceipt(receiptId: string) {
    RequestCtx.assert('garment.receive');
    const u = RequestCtx.user();
    const r = await this.prisma.garmentReceipt.findFirst({ where: { id: receiptId, companyId: u.companyId } });
    if (!r) throw new NotFoundException('Receipt not found');
    if (r.status !== 'POSTED') throw new ConflictException('Already cancelled');
    const last = await this.prisma.garmentReceipt.findFirst({ where: { orderId: r.orderId, status: 'POSTED' }, orderBy: { createdAt: 'desc' } });
    if (last?.id !== r.id) throw new ConflictException('Only the last receipt can be cancelled');
    const o = await this.orderOwn(r.orderId);
    if (o.status !== 'OPEN') throw new ConflictException('The order is not open');
    await this.prisma.$transaction(async (tx) => {
      await this.inventory.reverse(tx, r.id, await this.allowNegative(u.companyId));
      await this.lots.reverse(tx, r.id);
      await this.journal.voidBySource(tx, 'GREC', r.id);
      for (const x of r.lines as { colour: string; size: string; qty: number }[]) {
        const l = o.lines.find((y) => y.colour === x.colour && y.size === x.size)!;
        await tx.garmentOrderLine.update({ where: { id: l.id }, data: { receivedQty: { decrement: x.qty } } });
      }
      await tx.garmentOrder.update({ where: { id: o.id }, data: { fabricRelieved: { decrement: r.fabricCost }, trimCost: { decrement: r.trimCost }, conversionCost: { decrement: r.conversionCost } } });
      await tx.garmentReceipt.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Garment Receipt', receiptId, 'CANCEL');
    return this.order(o.id);
  }

  // ================================================================ reports
  /** sewing line efficiency by line and day in a period */
  async efficiency(q: { from: string; to: string; lineId?: string }) {
    RequestCtx.assert('garment.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.garmentLineOutput.findMany({ where: { companyId, date: { gte: new Date(q.from), lte: new Date(q.to) }, ...(q.lineId ? { lineId: q.lineId } : {}) }, orderBy: [{ date: 'desc' }] });
    const lines = new Map((await this.prisma.workCenter.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.lineId))] } }, select: { id: true, code: true, name: true } })).map((l) => [l.id, l]));
    const orders = new Map((await this.prisma.garmentOrder.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } }, select: { id: true, number: true, styleId: true } })).map((o) => [o.id, o]));
    const styles = new Map((await this.prisma.garmentStyle.findMany({ where: { id: { in: [...orders.values()].map((o) => o.styleId) } }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    const byLine = new Map<string, { produced: number; available: number; pieces: number; rejects: number; days: Set<string> }>();
    for (const r of rows) {
      const b = byLine.get(r.lineId) ?? { produced: 0, available: 0, pieces: 0, rejects: 0, days: new Set<string>() };
      b.produced += r.totalPieces * n(r.sam);
      b.available += r.operators * n(r.minutes);
      b.pieces += r.totalPieces;
      b.rejects += r.rejects;
      b.days.add(localIso(r.date));
      byLine.set(r.lineId, b);
    }
    return {
      rows: rows.map((r) => ({ id: r.id, date: r.date, line: lines.get(r.lineId) ?? null, order: orders.get(r.orderId)?.number ?? '', style: styles.get(orders.get(r.orderId)?.styleId ?? '') ?? '', operators: r.operators, helpers: r.helpers, minutes: n(r.minutes), pieces: r.totalPieces, rejects: r.rejects, sam: n(r.sam), efficiency: n(r.efficiency) })),
      lines: [...byLine.entries()].map(([id, b]) => ({ line: lines.get(id) ?? null, days: b.days.size, pieces: b.pieces, rejects: b.rejects, efficiency: b.available ? Math.round((b.produced / b.available) * 10_000) / 100 : 0, rejectPct: b.pieces + b.rejects ? Math.round((b.rejects / (b.pieces + b.rejects)) * 10_000) / 100 : 0 })),
    };
  }
}
