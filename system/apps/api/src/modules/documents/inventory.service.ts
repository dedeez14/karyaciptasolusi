import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../common/prisma/prisma.service';
import { D, round, ZERO } from '../../common/utils/money';
import { RequestCtx } from '../../common/context/request-context';

export interface MoveRequest {
  companyId: string;
  branchId?: string | null;
  productId: string;
  productName: string;
  warehouseId: string;
  date: Date;
  qty: Prisma.Decimal; // signed
  unitCost?: Prisma.Decimal; // required for inbound
  docType: string;
  documentId: string;
  documentNumber: string;
  allowNegative: boolean;
}

/** Perpetual inventory with moving-average costing per product & warehouse. */
@Injectable()
export class InventoryService {
  async move(tx: Tx, m: MoveRequest): Promise<{ unitCost: Prisma.Decimal; totalCost: Prisma.Decimal }> {
    await tx.stockBalance.upsert({
      where: { productId_warehouseId: { productId: m.productId, warehouseId: m.warehouseId } },
      create: { companyId: m.companyId, productId: m.productId, warehouseId: m.warehouseId },
      update: {},
    });
    const [bal] = await tx.$queryRaw<{ id: string; qty: Prisma.Decimal; avgCost: Prisma.Decimal }[]>`
      SELECT id, qty, "avgCost" FROM stock_balances WHERE "productId" = ${m.productId}::uuid AND "warehouseId" = ${m.warehouseId}::uuid FOR UPDATE`;
    const qty = D(bal.qty);
    const avg = D(bal.avgCost);
    let unitCost: Prisma.Decimal;
    let newQty = qty.plus(m.qty);
    let newAvg = avg;

    if (m.qty.gt(0)) {
      unitCost = m.unitCost && m.unitCost.gt(0) ? m.unitCost : avg;
      const value = qty.gt(0) ? qty.times(avg) : ZERO;
      newAvg = newQty.gt(0) ? value.plus(m.qty.times(unitCost)).div(newQty) : unitCost;
    } else {
      unitCost = m.unitCost ?? avg;
      if (newQty.lt(0) && !m.allowNegative) {
        throw new BadRequestException(`Insufficient stock for ${m.productName}: available ${qty.toString()}, required ${m.qty.abs().toString()}`);
      }
      if (m.unitCost && newQty.gt(0)) {
        // reversal of an inbound movement: remove its value at its original cost
        newAvg = qty.times(avg).plus(m.qty.times(m.unitCost)).div(newQty);
        if (newAvg.lt(0)) newAvg = avg;
      }
    }
    newQty = newQty.toDecimalPlaces(4);
    await tx.stockBalance.update({ where: { id: bal.id }, data: { qty: newQty, avgCost: newAvg.toDecimalPlaces(4) } });
    const totalCost = round(m.qty.times(unitCost));
    await tx.stockMovement.create({
      data: {
        companyId: m.companyId,
        branchId: m.branchId ?? null,
        productId: m.productId,
        warehouseId: m.warehouseId,
        date: m.date,
        qty: m.qty,
        unitCost: unitCost.toDecimalPlaces(4),
        totalCost,
        balanceQty: newQty,
        docType: m.docType,
        documentId: m.documentId,
        documentNumber: m.documentNumber,
        createdById: RequestCtx.get()?.user?.id,
      },
    });
    return { unitCost, totalCost };
  }

  /** Locks the balance of a product in a warehouse and returns it (zero when there is none). */
  async balanceForUpdate(tx: Tx, productId: string, warehouseId: string): Promise<{ qty: Prisma.Decimal; avgCost: Prisma.Decimal }> {
    const [bal] = await tx.$queryRaw<{ qty: Prisma.Decimal; avgCost: Prisma.Decimal }[]>`
      SELECT qty, "avgCost" FROM stock_balances WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid FOR UPDATE`;
    return bal ? { qty: D(bal.qty), avgCost: D(bal.avgCost) } : { qty: ZERO, avgCost: ZERO };
  }

  /**
   * Adds value to (or takes it from) the stock on hand without moving any quantity: landed costs. The average cost of the
   * balance changes; a movement of quantity 0 keeps the value history. Value taken out never goes below zero; returns the
   * amount applied.
   */
  async revalue(tx: Tx, r: { companyId: string; branchId?: string | null; productId: string; warehouseId: string; date: Date; amount: Prisma.Decimal; docType: string; documentId: string; documentNumber: string }): Promise<Prisma.Decimal> {
    const bal = await this.balanceForUpdate(tx, r.productId, r.warehouseId);
    if (bal.qty.lte(0) || r.amount.isZero()) return ZERO;
    const value = bal.qty.times(bal.avgCost);
    const applied = round(r.amount.lt(0) && r.amount.abs().gt(value) ? value.neg() : r.amount);
    const newAvg = value.plus(applied).div(bal.qty);
    await tx.stockBalance.update({ where: { productId_warehouseId: { productId: r.productId, warehouseId: r.warehouseId } }, data: { avgCost: (newAvg.lt(0) ? ZERO : newAvg).toDecimalPlaces(4) } });
    await tx.stockMovement.create({
      data: {
        companyId: r.companyId,
        branchId: r.branchId ?? null,
        productId: r.productId,
        warehouseId: r.warehouseId,
        date: r.date,
        qty: ZERO,
        unitCost: ZERO,
        totalCost: applied,
        balanceQty: bal.qty,
        docType: r.docType,
        documentId: r.documentId,
        documentNumber: r.documentNumber,
        createdById: RequestCtx.get()?.user?.id,
      },
    });
    return applied;
  }

  /** Reverses all movements of a document (used on cancellation). */
  async reverse(tx: Tx, documentId: string, allowNegative: boolean) {
    const moves = await tx.stockMovement.findMany({ where: { documentId }, orderBy: { createdAt: 'desc' } });
    const products = await tx.product.findMany({ where: { id: { in: moves.map((m) => m.productId) } }, select: { id: true, name: true } });
    const names = new Map(products.map((p) => [p.id, p.name]));
    for (const mv of moves) {
      if (mv.docType.endsWith('-REV')) continue;
      await this.move(tx, {
        companyId: mv.companyId,
        branchId: mv.branchId,
        productId: mv.productId,
        productName: names.get(mv.productId) ?? 'product',
        warehouseId: mv.warehouseId,
        date: new Date(),
        qty: D(mv.qty).neg(),
        unitCost: D(mv.unitCost),
        docType: `${mv.docType}-REV`,
        documentId,
        documentNumber: mv.documentNumber ?? '',
        allowNegative,
      });
    }
  }
}
