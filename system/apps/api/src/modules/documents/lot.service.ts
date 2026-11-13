import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../../common/prisma/prisma.service';
import { D } from '../../common/utils/money';

interface LineRef {
  companyId: string;
  documentId: string;
  lineId: string;
  productId: string;
  warehouseId: string;
}

/**
 * Batch / lot quantities of lot-tracked products, kept next to the product stock balance.
 * Receipts create or top up a lot (number + expiry); issues take from the lot expiring first (FEFO, as CDOB
 * requires for medicines) unless a lot was chosen; every movement is recorded per document line for
 * reversal and for tracing a lot to the customers who received it (recalls).
 */
@Injectable()
export class LotService {
  /** stock that existed before tracking was switched on goes into an "OPENING" lot, so lots always add up */
  async ensureOpening(tx: Tx, companyId: string, productId: string, warehouseId: string) {
    const stock = D((await tx.stockBalance.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } }))?.qty ?? 0);
    const lots = D((await tx.lotBalance.aggregate({ where: { warehouseId, lot: { productId, companyId } }, _sum: { qty: true } }))._sum.qty);
    const gap = stock.minus(lots);
    if (gap.lte(0)) return;
    const lot = await tx.stockLot.upsert({ where: { companyId_productId_lotNo: { companyId, productId, lotNo: 'OPENING' } }, create: { companyId, productId, lotNo: 'OPENING', notes: 'Stock on hand when lot tracking started' }, update: {} });
    await this.addBalance(tx, lot.id, warehouseId, gap);
  }

  private async addBalance(tx: Tx, lotId: string, warehouseId: string, qty: Prisma.Decimal) {
    await tx.lotBalance.upsert({ where: { lotId_warehouseId: { lotId, warehouseId } }, create: { lotId, warehouseId, qty }, update: { qty: { increment: qty } } });
  }

  /** goods in: the lot given on the line (created when new), or one named after the document */
  async receive(tx: Tx, r: LineRef & { qty: Prisma.Decimal; lotNo?: string | null; lotId?: string | null; expiryDate?: Date | null; docNumber: string; docDate: Date; shelfLifeDays: number }) {
    let lotId = r.lotId ?? null;
    if (lotId && !(await tx.stockLot.findFirst({ where: { id: lotId, companyId: r.companyId, productId: r.productId } }))) lotId = null;
    if (!lotId) {
      const lotNo = (r.lotNo?.trim() || r.docNumber).slice(0, 60);
      const expiry = r.expiryDate ?? (r.shelfLifeDays > 0 ? new Date(r.docDate.getTime() + r.shelfLifeDays * 86_400_000) : null);
      const lot = await tx.stockLot.upsert({
        where: { companyId_productId_lotNo: { companyId: r.companyId, productId: r.productId, lotNo } },
        create: { companyId: r.companyId, productId: r.productId, lotNo, expiryDate: expiry },
        // a later receipt of the same lot may bring the expiry date that was missing
        update: expiry ? { expiryDate: expiry } : {},
      });
      lotId = lot.id;
    }
    await this.addBalance(tx, lotId, r.warehouseId, r.qty);
    await tx.lineLot.create({ data: { companyId: r.companyId, documentId: r.documentId, lineId: r.lineId, lotId, warehouseId: r.warehouseId, qty: r.qty } });
    return [{ lotId, qty: r.qty }];
  }

  /** goods out: the chosen lot first, then the lots expiring first (lots without expiry last) */
  async issue(tx: Tx, r: LineRef & { qty: Prisma.Decimal; preferredLotId?: string | null }) {
    const lots = await tx.lotBalance.findMany({
      where: { warehouseId: r.warehouseId, qty: { gt: 0 }, lot: { productId: r.productId, companyId: r.companyId } },
      include: { lot: { select: { id: true, lotNo: true, expiryDate: true, createdAt: true, qcStatus: true } } },
    });
    // lots on quality hold or rejected are not usable; refuse instead of taking them
    const blocked = lots.filter((b) => b.lot.qcStatus !== 'RELEASED');
    const usable = lots.filter((b) => b.lot.qcStatus === 'RELEASED');
    const usableQty = usable.reduce((a, b) => a.plus(D(b.qty)), D(0));
    if (blocked.length && usableQty.lt(r.qty)) {
      const names = blocked.map((b) => `${b.lot.lotNo} (${b.lot.qcStatus === 'HOLD' ? 'on QC hold' : 'rejected'})`).join(', ');
      throw new ConflictException(`Only ${usableQty.toString()} released by quality control; lot ${names} cannot be used yet`);
    }
    lots.length = 0;
    lots.push(...usable);
    lots.sort((a, b) => {
      if (r.preferredLotId) {
        if (a.lotId === r.preferredLotId) return -1;
        if (b.lotId === r.preferredLotId) return 1;
      }
      const ea = a.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const eb = b.lot.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ea - eb || a.lot.createdAt.getTime() - b.lot.createdAt.getTime();
    });
    let left = r.qty;
    const taken: { lotId: string; qty: Prisma.Decimal }[] = [];
    for (const b of lots) {
      if (left.lte(0)) break;
      const take = D(b.qty).lt(left) ? D(b.qty) : left;
      await tx.lotBalance.update({ where: { id: b.id }, data: { qty: { decrement: take } } });
      await tx.lineLot.create({ data: { companyId: r.companyId, documentId: r.documentId, lineId: r.lineId, lotId: b.lotId, warehouseId: r.warehouseId, qty: take.neg() } });
      taken.push({ lotId: b.lotId, qty: take });
      left = left.minus(take);
    }
    return taken;
  }

  /** puts back what a document moved (cancellation) */
  async reverse(tx: Tx, documentId: string) {
    const rows = await tx.lineLot.findMany({ where: { documentId } });
    for (const x of rows) await this.addBalance(tx, x.lotId, x.warehouseId, D(x.qty).neg());
    if (rows.length) await tx.lineLot.deleteMany({ where: { documentId } });
  }

  /** lots a document moved, per line (for the document page and the print) */
  async ofDocument(tx: Tx, documentId: string) {
    const rows = await tx.lineLot.findMany({ where: { documentId }, orderBy: { createdAt: 'asc' } });
    const lots = new Map((await tx.stockLot.findMany({ where: { id: { in: rows.map((r) => r.lotId) } }, select: { id: true, lotNo: true, expiryDate: true } })).map((l) => [l.id, l]));
    const out: Record<string, { lotId: string; lotNo: string; expiryDate: Date | null; qty: Prisma.Decimal }[]> = {};
    for (const r of rows) (out[r.lineId] ??= []).push({ lotId: r.lotId, lotNo: lots.get(r.lotId)?.lotNo ?? '-', expiryDate: lots.get(r.lotId)?.expiryDate ?? null, qty: D(r.qty).abs() });
    return out;
  }
}

