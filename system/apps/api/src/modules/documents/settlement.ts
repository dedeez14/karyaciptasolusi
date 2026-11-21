import type { Tx } from '../../common/prisma/prisma.service';
import { D } from '../../common/utils/money';
import { DOC_MAP } from './document.registry';

/**
 * Recomputes how much of an invoice is settled (payments + credit / debit notes applied to it), or how much of a
 * credit / debit note has been used, and sets the status. The single place that writes paidAmount.
 */
export async function recalcSettlement(tx: Tx, documentId: string) {
  const doc = await tx.tradeDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.status === 'DRAFT' || doc.status === 'CANCELLED') return;
  const def = DOC_MAP.get(doc.docType);
  const total = D(doc.grandTotal);
  if (def?.returnOf) {
    const applied = D((await tx.creditApplication.aggregate({ where: { creditNoteId: documentId }, _sum: { amount: true } }))._sum.amount);
    const status = applied.gte(total) ? 'COMPLETED' : applied.gt(0) ? 'PARTIAL' : 'CONFIRMED';
    await tx.tradeDocument.update({ where: { id: documentId }, data: { paidAmount: applied, creditedAmount: applied, status } });
    return;
  }
  const [pay, cred] = await Promise.all([
    tx.paymentAllocation.aggregate({ where: { documentId, payment: { status: { not: 'CANCELLED' }, deletedAt: null } }, _sum: { amount: true } }),
    tx.creditApplication.aggregate({ where: { invoiceId: documentId }, _sum: { amount: true } }),
  ]);
  const credits = D(cred._sum.amount);
  const paid = D(pay._sum.amount).plus(credits);
  const status = paid.gte(total) ? 'COMPLETED' : paid.gt(0) ? 'PARTIAL' : 'CONFIRMED';
  await tx.tradeDocument.update({ where: { id: documentId }, data: { paidAmount: paid, creditedAmount: credits, status } });
}
