import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';
import { ManufacturingService } from './manufacturing.service';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const day = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const plannedWoSchema = z.object({ warehouseId: z.uuid(), lines: z.array(z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e9), date: z.coerce.date() })).min(1).max(200) });

interface Need {
  qty: number;
  date: Date;
  source: string;
}

/**
 * Material requirements planning (MRP), net requirements by BOM level:
 * demand = open sales orders (not yet delivered) + components of open work orders not yet issued + safety stock
 * (the product's minimum stock); supply = stock released by quality control + open purchase orders + work orders
 * in progress. Shortages of a product with a bill of materials become planned work orders (whose components add
 * demand one level down), the others planned purchases from the usual supplier, started lead time before the need.
 */
@Injectable()
export class MrpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfg: ManufacturingService,
  ) {}

  async run(warehouseId?: string) {
    RequestCtx.assert('manufacturing.mrp.run');
    const companyId = RequestCtx.companyId();
    const wh = warehouseId && UUID.test(warehouseId) ? warehouseId : null;
    const today = new Date(isoDay(new Date()));
    const products = await this.prisma.product.findMany({
      where: { companyId, type: 'STOCK', isActive: true, deletedAt: null },
      select: { id: true, code: true, name: true, minStock: true, reorderQty: true, leadTimeDays: true, preferredSupplierId: true, isPurchasable: true, purchasePrice: true, uom: { select: { code: true } } },
    });
    const pm = new Map(products.map((p) => [p.id, p]));
    const boms = await this.prisma.bom.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }], include: { lines: true } });
    const bomOf = new Map<string, (typeof boms)[number]>();
    for (const b of boms) if (!bomOf.has(b.productId)) bomOf.set(b.productId, b);

    // ---- supply on hand (lots on quality hold / rejected are not available)
    const whSql = wh ? Prisma.sql`AND b."warehouseId" = ${wh}::uuid` : Prisma.empty;
    const onHandRows = await this.prisma.$queryRaw<{ productId: string; qty: Prisma.Decimal }[]>`
      SELECT b."productId", SUM(b.qty) AS qty FROM stock_balances b JOIN products p ON p.id = b."productId" AND p."companyId" = ${companyId}::uuid WHERE 1 = 1 ${whSql} GROUP BY b."productId"`;
    const heldRows = await this.prisma.$queryRaw<{ productId: string; qty: Prisma.Decimal }[]>`
      SELECT l."productId", SUM(b.qty) AS qty FROM lot_balances b JOIN stock_lots l ON l.id = b."lotId"
      WHERE l."companyId" = ${companyId}::uuid AND l."qcStatus" <> 'RELEASED' AND b.qty > 0 ${whSql} GROUP BY l."productId"`;
    const onHand = new Map(onHandRows.map((r) => [r.productId, n(r.qty)]));
    for (const h of heldRows) onHand.set(h.productId, (onHand.get(h.productId) ?? 0) - n(h.qty));
    const held = new Map(heldRows.map((r) => [r.productId, n(r.qty)]));

    // ---- open purchase / sales order lines (not yet received / delivered)
    const docWh = wh ? Prisma.sql`AND (d."warehouseId" IS NULL OR d."warehouseId" = ${wh}::uuid)` : Prisma.empty;
    const docLines = await this.prisma.$queryRaw<{ docType: string; number: string; productId: string; qty: Prisma.Decimal; date: Date }[]>`
      SELECT d."docType", d.number, l."productId", (l.qty - l."processedQty") AS qty, COALESCE(d."dueDate", d.date) AS date
      FROM trade_document_lines l JOIN trade_documents d ON d.id = l."documentId"
      WHERE d."companyId" = ${companyId}::uuid AND d."docType" IN ('PO', 'SO') AND d.status IN ('CONFIRMED', 'PARTIAL') AND d."deletedAt" IS NULL
        AND l."productId" IS NOT NULL AND l.qty > l."processedQty" ${docWh}`;
    const onOrder = new Map<string, number>();
    const needs = new Map<string, Need[]>();
    const addNeed = (pid: string, x: Need) => needs.set(pid, [...(needs.get(pid) ?? []), x]);
    for (const l of docLines) {
      if (!pm.has(l.productId)) continue;
      if (l.docType === 'PO') onOrder.set(l.productId, (onOrder.get(l.productId) ?? 0) + n(l.qty));
      else addNeed(l.productId, { qty: n(l.qty), date: l.date < today ? today : l.date, source: `Sales order ${l.number}` });
    }
    // ---- work orders in progress: output to come, components still to issue
    const wos = await this.prisma.workOrder.findMany({ where: { companyId, status: { in: ['DRAFT', 'RELEASED'] }, deletedAt: null, ...(wh ? { warehouseId: wh } : {}) }, include: { lines: true } });
    const inProduction = new Map<string, number>();
    for (const w of wos) {
      inProduction.set(w.productId, (inProduction.get(w.productId) ?? 0) + Math.max(0, n(w.qty) - n(w.producedQty)));
      for (const l of w.lines) {
        const rest = n(l.plannedQty) - n(l.issuedQty);
        if (rest > 0 && pm.has(l.productId)) addNeed(l.productId, { qty: rest, date: w.plannedDate < today ? today : w.plannedDate, source: `Work order ${w.number}` });
      }
    }

    // ---- low-level codes (a component is planned after every product that uses it)
    const llc = new Map<string, number>();
    const visit = (pid: string, level: number, depth: number) => {
      if (depth > 10) return;
      if ((llc.get(pid) ?? -1) >= level) return;
      llc.set(pid, level);
      const b = bomOf.get(pid);
      if (b) for (const l of b.lines) visit(l.productId, l.phantom ? level : level + 1, depth + 1);
    };
    for (const p of products) if (!llc.has(p.id)) visit(p.id, 0, 0);
    for (const b of boms) for (const l of b.lines) visit(l.productId, (llc.get(b.productId) ?? 0) + 1, 0);

    // components needed for a quantity of a product (phantoms exploded)
    const explode = (pid: string, qty: number, depth = 0): { productId: string; qty: number }[] => {
      const b = bomOf.get(pid);
      if (!b || depth > 8) return [];
      const factor = qty / (n(b.outputQty) || 1);
      return b.lines.flatMap((l) => {
        const q = n(l.qty) * factor * (1 + n(l.scrapPct) / 100);
        return l.phantom ? explode(l.productId, q, depth + 1) : [{ productId: l.productId, qty: q }];
      });
    };

    const suggestions: {
      productId: string;
      code: string;
      name: string;
      uom: string;
      action: 'MAKE' | 'BUY';
      qty: number;
      needBy: string;
      startBy: string;
      late: boolean;
      demand: number;
      safety: number;
      onHand: number;
      held: number;
      onOrder: number;
      supplierId: string | null;
      bomId: string | null;
      unitPrice: number;
      sources: string[];
    }[] = [];
    const levels = [...new Set([...llc.values()])].sort((a, b) => a - b);
    for (const level of levels) {
      for (const p of products.filter((x) => (llc.get(x.id) ?? 0) === level)) {
        const list = (needs.get(p.id) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
        const demand = list.reduce((a, x) => a + x.qty, 0);
        const safety = n(p.minStock);
        if (!demand && !safety) continue;
        const have = Math.max(0, onHand.get(p.id) ?? 0);
        const coming = (onOrder.get(p.id) ?? 0) + (inProduction.get(p.id) ?? 0);
        const net = demand + safety - have - coming;
        if (net <= 1e-6) continue;
        // the first need that the stock and the orders on the way do not cover
        let cum = 0;
        let needBy = today;
        for (const x of list) {
          cum += x.qty;
          if (cum > have + coming + 1e-6) {
            needBy = x.date;
            break;
          }
        }
        const bom = bomOf.get(p.id) ?? null;
        const qty = Math.ceil(Math.max(net, n(p.reorderQty)) * 10000) / 10000;
        const start = new Date(needBy.getTime() - n(p.leadTimeDays) * day);
        suggestions.push({
          productId: p.id,
          code: p.code,
          name: p.name,
          uom: p.uom?.code ?? '',
          action: bom ? 'MAKE' : 'BUY',
          qty,
          needBy: isoDay(needBy),
          startBy: isoDay(start < today ? today : start),
          late: start < today,
          demand: Math.round(demand * 10000) / 10000,
          safety,
          onHand: Math.round(have * 10000) / 10000,
          held: held.get(p.id) ?? 0,
          onOrder: Math.round(coming * 10000) / 10000,
          supplierId: bom ? null : p.preferredSupplierId,
          bomId: bom?.id ?? null,
          unitPrice: n(p.purchasePrice),
          sources: [...list.map((x) => x.source), ...(safety ? ['Safety stock'] : [])].slice(0, 6),
        });
        // a planned work order needs its components (dependent demand, one level down)
        if (bom) for (const c of explode(p.id, qty)) if (pm.has(c.productId)) addNeed(c.productId, { qty: c.qty, date: start < today ? today : start, source: `Planned production of ${p.name}` });
      }
    }
    const suppliers = new Map((await this.prisma.supplier.findMany({ where: { id: { in: suggestions.map((s) => s.supplierId!).filter(Boolean) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return {
      generatedAt: new Date(),
      warehouseId: wh,
      suggestions: suggestions.map((s) => ({ ...s, supplierName: s.supplierId ? suppliers.get(s.supplierId) ?? null : null })).sort((a, b) => a.startBy.localeCompare(b.startBy) || a.code.localeCompare(b.code)),
    };
  }

  /** creates the planned work orders (default BOM of each product) */
  async createWorkOrders(input: z.infer<typeof plannedWoSchema>) {
    RequestCtx.assert('manufacturing.mrp.run');
    RequestCtx.assert('manufacturing.order.create');
    const companyId = RequestCtx.companyId();
    const created: string[] = [];
    for (const l of input.lines) {
      const bom = await this.prisma.bom.findFirst({ where: { companyId, productId: l.productId, isActive: true, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
      if (!bom) throw new BadRequestException('A product to make has no bill of materials');
      const w = await this.mfg.createOrder({ bomId: bom.id, qty: l.qty, warehouseId: input.warehouseId, plannedDate: l.date, notes: 'Planned by MRP' });
      created.push(w.number);
    }
    return { created };
  }
}
