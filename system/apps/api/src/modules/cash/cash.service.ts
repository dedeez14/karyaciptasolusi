import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService } from '../accounting/journal.service';
import { ApprovalService } from '../approvals/approval.service';
import { Tx } from '../../common/prisma/prisma.service';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());

export const cashSchema = z
  .object({
    type: z.enum(['RECEIPT', 'PAYMENT', 'TRANSFER']),
    date: z.coerce.date(),
    bankAccountId: z.uuid(),
    toBankAccountId: optUuid,
    accountId: optUuid,
    amount: z.coerce.number().positive().max(1e14),
    partyName: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(150).nullable().optional()),
    costCenterId: optUuid,
    projectId: optUuid,
    reference: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable().optional()),
    description: z.string().trim().min(1, 'Description is required').max(1000),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'TRANSFER' && !v.toBankAccountId) ctx.addIssue({ code: 'custom', path: ['toBankAccountId'], message: 'Destination account is required' });
    if (v.type === 'TRANSFER' && v.toBankAccountId === v.bankAccountId) ctx.addIssue({ code: 'custom', path: ['toBankAccountId'], message: 'Choose a different account' });
    if (v.type !== 'TRANSFER' && !v.accountId) ctx.addIssue({ code: 'custom', path: ['accountId'], message: v.type === 'PAYMENT' ? 'Expense account is required' : 'Income account is required' });
  });

const SEQ = { RECEIPT: 'CASH_IN', PAYMENT: 'CASH_OUT', TRANSFER: 'BANK_TRANSFER' } as const;

/** Money in / money out / transfers that are not linked to an invoice (rent, utilities, other income, ...). */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly journal: JournalService,
    private readonly approvals: ApprovalService,
  ) {}

  private scope() {
    return this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.CashTransactionWhereInput;
  }

  private async names(rows: { bankAccountId: string; toBankAccountId: string | null; accountId: string | null }[]) {
    const bankIds = [...new Set(rows.flatMap((r) => [r.bankAccountId, r.toBankAccountId]).filter(Boolean) as string[])];
    const accIds = [...new Set(rows.map((r) => r.accountId).filter(Boolean) as string[])];
    const [banks, accs] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { id: { in: bankIds } }, select: { id: true, name: true } }),
      this.prisma.account.findMany({ where: { id: { in: accIds } }, select: { id: true, code: true, name: true } }),
    ]);
    return { bank: new Map(banks.map((b) => [b.id, b.name])), acc: new Map(accs.map((a) => [a.id, `${a.code} - ${a.name}`])) };
  }

  async list(q: { page: number; pageSize: number; search?: string; type?: string; bankAccountId?: string; from?: string; to?: string }) {
    RequestCtx.assert('accounting.cash.read');
    const where: Prisma.CashTransactionWhereInput = { ...this.scope(), deletedAt: null };
    if (q.type) where.type = q.type;
    if (q.bankAccountId) where.OR = [{ bankAccountId: q.bankAccountId }, { toBankAccountId: q.bankAccountId }];
    if (q.search) where.AND = [{ OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { partyName: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }] }];
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    const [rows, total, sums] = await Promise.all([
      this.prisma.cashTransaction.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.cashTransaction.count({ where }),
      this.prisma.cashTransaction.groupBy({ by: ['type'], where: { ...where, status: { notIn: ['CANCELLED', 'DRAFT'] } }, _sum: { amount: true } }),
    ]);
    const n = await this.names(rows);
    return {
      ...paged(rows.map((r) => ({ ...r, bankAccountName: n.bank.get(r.bankAccountId), toBankAccountName: r.toBankAccountId ? n.bank.get(r.toBankAccountId) : null, accountName: r.accountId ? n.acc.get(r.accountId) : null })), total, q),
      totals: Object.fromEntries(sums.map((s) => [s.type, Number(s._sum.amount ?? 0)])),
    };
  }

  async get(id: string) {
    RequestCtx.assert('accounting.cash.read');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Transaction not found');
    const r = await this.prisma.cashTransaction.findFirst({ where: { ...this.scope(), id, deletedAt: null } });
    if (!r) throw new NotFoundException('Transaction not found');
    const n = await this.names([r]);
    const journal = await this.prisma.journalEntry.findFirst({ where: { sourceType: `CASH_${r.type}`, sourceId: r.id }, select: { id: true, number: true, status: true } });
    return { ...r, bankAccountName: n.bank.get(r.bankAccountId), toBankAccountName: r.toBankAccountId ? n.bank.get(r.toBankAccountId) : null, accountName: r.accountId ? n.acc.get(r.accountId) : null, journal };
  }

  async create(body: unknown) {
    RequestCtx.assert('accounting.cash.create');
    const input = cashSchema.parse(body);
    const u = RequestCtx.user();
    const own = async (model: 'bankAccount' | 'account' | 'costCenter' | 'project', id: string | null | undefined, field: string) => {
      if (!id) return null;
      const row = await (this.prisma as any)[model].findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
      if (!row) throw new BadRequestException({ message: 'Validation failed', errors: { [field]: 'Not found' } });
      return row;
    };
    const bank = await own('bankAccount', input.bankAccountId, 'bankAccountId');
    const toBank = await own('bankAccount', input.toBankAccountId, 'toBankAccountId');
    const counter = await own('account', input.accountId, 'accountId');
    await own('costCenter', input.costCenterId, 'costCenterId');
    await own('project', input.projectId, 'projectId');
    if (!bank.accountId || (toBank && !toBank.accountId)) throw new BadRequestException('The cash/bank account has no ledger account');
    if (counter?.isGroup) throw new BadRequestException({ message: 'Validation failed', errors: { accountId: 'Choose a detail account, not a header' } });
    const amount = D(input.amount);
    // money out above an approval threshold is saved as a draft and goes through the approval workflow first
    const needsApproval = input.type === 'PAYMENT' && (await this.approvals.requiredFor(u.companyId, 'CASH', amount)).length > 0;

    return this.prisma.$transaction(async (tx) => {
      const number = await this.sequence.next(SEQ[input.type], u.companyId, input.date, tx);
      const row = await tx.cashTransaction.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId,
          number,
          date: input.date,
          type: input.type,
          status: needsApproval ? 'DRAFT' : 'CONFIRMED',
          bankAccountId: bank.id,
          toBankAccountId: toBank?.id ?? null,
          accountId: counter?.id ?? null,
          amount,
          partyName: input.partyName ?? null,
          costCenterId: input.costCenterId ?? null,
          projectId: input.projectId ?? null,
          reference: input.reference ?? null,
          description: input.description,
          createdById: u.id,
        },
      });
      if (needsApproval) await this.approvals.submit(this.approvalSubject(row), tx);
      else await this.postJournal(tx, row);
      await this.audit.record('Cash Transaction', row.id, 'CREATE', undefined, row, tx);
      return { ...row, approvalRequested: needsApproval };
    });
  }

  private approvalSubject(row: { id: string; number: string; amount: Prisma.Decimal; type: string }) {
    return { docType: 'CASH', documentId: row.id, documentNumber: row.number, amount: row.amount, label: `Cash payment ${row.number}` };
  }

  /** Balanced journal of a cash transaction */
  private async postJournal(tx: Tx, row: { id: string; companyId: string; branchId: string | null; number: string; date: Date; type: string; bankAccountId: string; toBankAccountId: string | null; accountId: string | null; amount: Prisma.Decimal; costCenterId: string | null; projectId: string | null; reference: string | null; description: string }) {
    const [bank, toBank] = await Promise.all([
      tx.bankAccount.findUnique({ where: { id: row.bankAccountId } }),
      row.toBankAccountId ? tx.bankAccount.findUnique({ where: { id: row.toBankAccountId } }) : null,
    ]);
    if (!bank?.accountId || (row.toBankAccountId && !toBank?.accountId)) throw new BadRequestException('The cash/bank account has no ledger account');
    const amount = D(row.amount);
    const dims = { costCenterId: row.costCenterId, projectId: row.projectId };
    const d = row.description;
    const lines =
      row.type === 'RECEIPT'
        ? [
            { accountId: bank.accountId, debit: amount, description: d },
            { accountId: row.accountId!, credit: amount, description: d, ...dims },
          ]
        : row.type === 'PAYMENT'
          ? [
              { accountId: row.accountId!, debit: amount, description: d, ...dims },
              { accountId: bank.accountId, credit: amount, description: d },
            ]
          : [
              { accountId: toBank!.accountId, debit: amount, description: d },
              { accountId: bank.accountId, credit: amount, description: d },
            ];
    await this.journal.post(tx, { companyId: row.companyId, branchId: row.branchId, date: row.date, description: `${row.number} - ${d}`, reference: row.reference ?? undefined, sourceType: `CASH_${row.type}`, sourceId: row.id, lines });
  }

  /** Posts an approved draft payment */
  async post(id: string) {
    RequestCtx.assert('accounting.cash.create');
    await this.get(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cash_transactions WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.cashTransaction.findUniqueOrThrow({ where: { id } });
      if (row.status !== 'DRAFT') throw new ConflictException('Transaction is already posted or cancelled');
      await this.approvals.assertApproved(row.companyId, this.approvalSubject(row), tx);
      await this.postJournal(tx, row);
      const r = await tx.cashTransaction.update({ where: { id }, data: { status: 'CONFIRMED', updatedById: RequestCtx.user().id } });
      await this.audit.record('Cash Transaction', id, 'CONFIRM', row, r, tx);
      return r;
    });
  }

  async approval(id: string) {
    const t = await this.get(id);
    const info = await this.approvals.info(t.companyId, this.approvalSubject(t));
    return { ...info, canRequest: t.status === 'DRAFT' && RequestCtx.can('accounting.cash.create') && ['NOT_REQUESTED', 'REJECTED'].includes(info.status) };
  }

  async requestApproval(id: string) {
    RequestCtx.assert('accounting.cash.create');
    const t = await this.get(id);
    if (t.status !== 'DRAFT') throw new ConflictException('Only draft transactions can be sent for approval');
    const req = await this.approvals.submit(this.approvalSubject(t));
    if (!req) throw new ConflictException(`${t.number} does not need approval. You can post it directly.`);
    return req;
  }

  async cancel(id: string) {
    RequestCtx.assert('accounting.cash.cancel');
    const before = await this.get(id);
    if (before.status === 'CANCELLED') throw new ConflictException('Transaction is already cancelled');
    return this.prisma.$transaction(async (tx) => {
      if (before.status !== 'DRAFT') await this.journal.voidBySource(tx, `CASH_${before.type}`, id);
      await this.approvals.reset(tx, 'CASH', id);
      const r = await tx.cashTransaction.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
      await this.audit.record('Cash Transaction', id, 'CANCEL', before, r, tx);
      return r;
    });
  }
}
