import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum, ZERO } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService } from '../accounting/journal.service';

export const paymentSchema = z.object({
  date: z.coerce.date(),
  partnerId: z.uuid(),
  bankAccountId: z.uuid(),
  paymentMethodId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  amount: z.coerce.number().positive().max(1e14),
  reference: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable().optional()),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(2000).nullable().optional()),
  allocations: z.array(z.object({ documentId: z.uuid(), amount: z.coerce.number().positive() })).max(200).default([]),
});

const DIR = {
  IN: { perm: 'sales.payment', seq: 'PAY_IN', partner: 'customerId', doc: 'SI', label: 'Customer Receipt' },
  OUT: { perm: 'purchase.payment', seq: 'PAY_OUT', partner: 'supplierId', doc: 'PI', label: 'Supplier Payment' },
} as const;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly journal: JournalService,
  ) {}

  dir(direction: string) {
    const d = DIR[direction.toUpperCase() as 'IN' | 'OUT'];
    if (!d) throw new NotFoundException('Unknown payment direction');
    return { ...d, direction: direction.toUpperCase() as 'IN' | 'OUT' };
  }

  async list(direction: string, q: { page: number; pageSize: number; search?: string; partnerId?: string; from?: string; to?: string }) {
    const d = this.dir(direction);
    RequestCtx.assert(`${d.perm}.read`);
    const where: Prisma.PaymentWhereInput = { ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), direction: d.direction, deletedAt: null };
    if (q.search) where.OR = [{ number: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }];
    if (q.partnerId) (where as any)[d.partner] = q.partnerId;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.payment.count({ where }),
    ]);
    const ids = rows.map((r) => (r as any)[d.partner]).filter(Boolean);
    const banks = await this.prisma.bankAccount.findMany({ where: { id: { in: rows.map((r) => r.bankAccountId) } }, select: { id: true, name: true } });
    const partners = d.direction === 'IN' ? await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : await this.prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const pn = new Map(partners.map((p) => [p.id, p.name]));
    const bn = new Map(banks.map((b) => [b.id, b.name]));
    return paged(rows.map((r) => ({ ...r, partnerName: pn.get((r as any)[d.partner]) ?? null, bankAccountName: bn.get(r.bankAccountId) ?? null })), total, q);
  }

  async get(direction: string, id: string) {
    const d = this.dir(direction);
    RequestCtx.assert(`${d.perm}.read`);
    const p = await this.prisma.payment.findFirst({
      where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), id, direction: d.direction, deletedAt: null },
      include: { allocations: { include: { document: { select: { id: true, number: true, date: true, grandTotal: true, paidAmount: true, docType: true } } } } },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const partnerId = (p as any)[d.partner] as string;
    const partner = d.direction === 'IN' ? await this.prisma.customer.findUnique({ where: { id: partnerId } }) : await this.prisma.supplier.findUnique({ where: { id: partnerId } });
    const bank = await this.prisma.bankAccount.findUnique({ where: { id: p.bankAccountId }, select: { name: true } });
    return { ...p, partnerName: partner?.name, bankAccountName: bank?.name };
  }

  /** Open invoices of a partner (for allocation UI) */
  async openInvoices(direction: string, partnerId: string) {
    const d = this.dir(direction);
    RequestCtx.assert(`${d.perm}.create`);
    const rows = await this.prisma.tradeDocument.findMany({
      where: { companyId: RequestCtx.companyId(), docType: d.doc, [d.partner]: partnerId, status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null },
      orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
      select: { id: true, number: true, date: true, dueDate: true, grandTotal: true, paidAmount: true, currencyCode: true },
    });
    return rows.map((r) => ({ ...r, balance: D(r.grandTotal).minus(D(r.paidAmount)) }));
  }

  private async recalcInvoice(tx: Tx, documentId: string) {
    const agg = await tx.paymentAllocation.aggregate({ where: { documentId, payment: { status: { not: 'CANCELLED' }, deletedAt: null } }, _sum: { amount: true } });
    const doc = await tx.tradeDocument.findUniqueOrThrow({ where: { id: documentId } });
    const paid = D(agg._sum.amount);
    const status = paid.gte(D(doc.grandTotal)) ? 'COMPLETED' : paid.gt(0) ? 'PARTIAL' : 'CONFIRMED';
    await tx.tradeDocument.update({ where: { id: documentId }, data: { paidAmount: paid, status } });
  }

  async create(direction: string, body: unknown) {
    const d = this.dir(direction);
    RequestCtx.assert(`${d.perm}.create`);
    const input = paymentSchema.parse(body);
    const u = RequestCtx.user();
    const partner =
      d.direction === 'IN'
        ? await this.prisma.customer.findFirst({ where: { id: input.partnerId, companyId: u.companyId, deletedAt: null } })
        : await this.prisma.supplier.findFirst({ where: { id: input.partnerId, companyId: u.companyId, deletedAt: null } });
    if (!partner) throw new BadRequestException('Partner not found');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId, deletedAt: null } });
    if (!bank?.accountId) throw new BadRequestException('Cash/bank account not found or has no ledger account');
    if (input.paymentMethodId && !(await this.prisma.paymentMethod.findFirst({ where: { id: input.paymentMethodId, companyId: u.companyId } }))) throw new BadRequestException('Payment method not found');
    const allocTotal = round(sum(input.allocations.map((a) => D(a.amount))));
    if (allocTotal.gt(D(input.amount))) throw new BadRequestException('Allocated amount exceeds the payment amount');

    return this.prisma.$transaction(
      async (tx) => {
        for (const a of input.allocations) {
          await tx.$queryRaw`SELECT id FROM trade_documents WHERE id = ${a.documentId}::uuid FOR UPDATE`;
          const inv = await tx.tradeDocument.findFirst({ where: { id: a.documentId, companyId: u.companyId, docType: d.doc, [d.partner]: input.partnerId, status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null } });
          if (!inv) throw new BadRequestException('Invoice is not open or belongs to another partner');
          const bal = D(inv.grandTotal).minus(D(inv.paidAmount));
          if (D(a.amount).gt(bal)) throw new BadRequestException(`Allocation for ${inv.number} exceeds its balance ${bal}`);
        }
        const number = await this.sequence.next(d.seq, u.companyId, input.date, tx);
        const p = await tx.payment.create({
          data: {
            companyId: u.companyId,
            branchId: u.branchId,
            number,
            date: input.date,
            direction: d.direction,
            [d.partner]: input.partnerId,
            bankAccountId: bank.id,
            paymentMethodId: input.paymentMethodId ?? null,
            amount: D(input.amount),
            reference: input.reference ?? null,
            notes: input.notes ?? null,
            status: 'CONFIRMED',
            createdById: u.id,
            allocations: { create: input.allocations.map((a) => ({ documentId: a.documentId, amount: D(a.amount) })) },
          } as any,
        });
        for (const a of input.allocations) await this.recalcInvoice(tx, a.documentId);
        const party = d.direction === 'IN' ? { customerId: input.partnerId } : { supplierId: input.partnerId };
        const amount = D(input.amount);
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: u.branchId,
          date: input.date,
          description: `${d.label} ${number} - ${partner.name}`,
          reference: input.reference ?? undefined,
          sourceType: `PAY_${d.direction}`,
          sourceId: p.id,
          lines:
            d.direction === 'IN'
              ? [
                  { accountId: bank.accountId, debit: amount },
                  { key: 'AR', credit: amount, ...party },
                ]
              : [
                  { key: 'AP', debit: amount, ...party },
                  { accountId: bank.accountId, credit: amount },
                ],
        });
        await this.audit.record(d.label, p.id, 'CREATE', undefined, p, tx);
        return p;
      },
      { timeout: 30_000 },
    );
  }

  async cancel(direction: string, id: string) {
    const d = this.dir(direction);
    RequestCtx.assert(`${d.perm}.cancel`);
    const p = await this.get(direction, id);
    if (p.status === 'CANCELLED') throw new ConflictException('Payment is already cancelled');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.payment.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
      for (const a of p.allocations) await this.recalcInvoice(tx, a.documentId);
      await this.journal.voidBySource(tx, `PAY_${d.direction}`, id);
      await this.audit.record(d.label, id, 'CANCEL', p, r, tx);
      return r;
    });
  }

  unallocated(p: { amount: Prisma.Decimal; allocations: { amount: Prisma.Decimal }[] }) {
    return D(p.amount).minus(sum(p.allocations.map((a) => D(a.amount))) ?? ZERO);
  }
}
