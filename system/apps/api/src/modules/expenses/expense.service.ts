import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseClaim, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService } from '../accounting/journal.service';
import { ApprovalService } from '../approvals/approval.service';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const expenseLineSchema = z.object({
  date: z.coerce.date(),
  categoryCode: optText(50),
  accountId: optUuid,
  description: z.string().trim().min(1, 'Description is required').max(500),
  amount: z.coerce.number().positive('Amount must be greater than zero').max(1e13),
  projectId: optUuid,
  costCenterId: optUuid,
});

export const expenseSchema = z.object({
  employeeId: optUuid,
  date: z.coerce.date(),
  title: z.string().trim().min(1, 'Title is required').max(200),
  notes: optText(4000),
  lines: z.array(expenseLineSchema).min(1, 'Add at least one expense').max(200),
});

export const paySchema = z.object({ bankAccountId: z.uuid(), date: z.coerce.date(), reference: optText(100) });

const SOURCE_CLAIM = 'EXPENSE_CLAIM';
const SOURCE_PAY = 'EXPENSE_PAYMENT';

export interface ExpenseQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  employeeId?: string;
  mine?: string;
  from?: string;
  to?: string;
}

/**
 * Expense claims (reimbursements): DRAFT -> SUBMITTED -> APPROVED / REJECTED -> PAID.
 * Approval posts Dr expense accounts / Cr EXPENSE_PAYABLE; payment posts Dr EXPENSE_PAYABLE / Cr cash or bank.
 * When an approval rule exists for EXPENSE the claim is approved through the approval workflow.
 */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly journal: JournalService,
    private readonly approvals: ApprovalService,
  ) {
    this.approvals.onFinal('EXPENSE', async (tx, req, outcome, comment) => {
      const claim = await tx.expenseClaim.findFirst({ where: { id: req.documentId, deletedAt: null } });
      if (!claim || claim.statusCode !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') await this.doApprove(tx, claim, req.decidedById);
      else await this.doReject(tx, claim, comment ?? 'Rejected in the approval workflow');
    });
  }

  private async myEmployeeId() {
    const u = RequestCtx.user();
    return (await this.prisma.employee.findFirst({ where: { userId: u.id, companyId: u.companyId, deletedAt: null }, select: { id: true } }))?.id ?? null;
  }

  private seesAll() {
    const u = RequestCtx.user();
    return u.isSuperAdmin || RequestCtx.can('hris.expense.manage') || u.dataScope === 'ALL' || u.dataScope === 'COMPANY';
  }

  private async visibility(): Promise<Prisma.ExpenseClaimWhereInput> {
    const u = RequestCtx.user();
    const where: Prisma.ExpenseClaimWhereInput = { companyId: u.companyId, deletedAt: null };
    if (this.seesAll()) return where;
    const emp = await this.myEmployeeId();
    const or: Prisma.ExpenseClaimWhereInput[] = [{ createdById: u.id }];
    if (emp) or.push({ employeeId: emp });
    // approvers and cashiers with branch scope see the claims of their branches
    if ((RequestCtx.can('hris.expense.approve') || RequestCtx.can('hris.expense.pay')) && u.dataScope === 'BRANCH' && u.branchIds) or.push({ branchId: { in: u.branchIds } });
    where.OR = or;
    return where;
  }

  /** Visible claim, or a claim the user has to decide in the approval workflow (read only) */
  private async own(id: string, forWrite = false) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Expense claim not found');
    let c = await this.prisma.expenseClaim.findFirst({ where: { ...(await this.visibility()), id } });
    if (!c && !forWrite) {
      const waiting = await this.prisma.approvalRequest.findFirst({ where: { ...(await this.approvals.waitingWhere(RequestCtx.user())), docType: 'EXPENSE', documentId: id } });
      if (waiting) c = await this.prisma.expenseClaim.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    }
    if (!c) throw new NotFoundException('Expense claim not found');
    return c;
  }

  private async isOwner(c: { employeeId: string; createdById: string | null }) {
    const u = RequestCtx.user();
    return c.createdById === u.id || (await this.myEmployeeId()) === c.employeeId;
  }

  private async canEdit(c: ExpenseClaim) {
    if (!['DRAFT', 'REJECTED'].includes(c.statusCode)) return false;
    if (!RequestCtx.can('hris.expense.update')) return false;
    return RequestCtx.user().isSuperAdmin || RequestCtx.can('hris.expense.manage') || (await this.isOwner(c));
  }

  private subject(c: { id: string; number: string; totalAmount: Prisma.Decimal }) {
    return { docType: 'EXPENSE', documentId: c.id, documentNumber: c.number, amount: c.totalAmount, label: `Expense claim ${c.number}` };
  }

  // ------------------------------------------------------------------ queries
  async list(q: ExpenseQuery) {
    RequestCtx.assert('hris.expense.read');
    const where = await this.visibility();
    const and: Prisma.ExpenseClaimWhereInput[] = [];
    if (q.search) and.push({ OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }] });
    if (q.status) where.statusCode = { in: q.status.split(',') };
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.mine === '1') {
      const emp = await this.myEmployeeId();
      and.push({ OR: [{ createdById: RequestCtx.user().id }, ...(emp ? [{ employeeId: emp }] : [])] });
    }
    if (q.from || q.to) where.date = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
    if (and.length) where.AND = and;
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.expenseClaim.findMany({ where, orderBy: [{ date: 'desc' }, { number: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.expenseClaim.count({ where }),
      this.prisma.expenseClaim.groupBy({ by: ['statusCode'], where: { ...where, statusCode: undefined }, _sum: { totalAmount: true }, _count: { _all: true } }),
    ]);
    const emps = await this.prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, code: true, fullName: true } });
    const en = new Map(emps.map((e) => [e.id, e.fullName]));
    return {
      ...paged(rows.map((r) => ({ ...r, employeeName: en.get(r.employeeId) ?? null })), total, q),
      summary: Object.fromEntries(byStatus.map((s) => [s.statusCode, { count: s._count._all, amount: Number(s._sum.totalAmount ?? 0) }])),
    };
  }

  async get(id: string) {
    RequestCtx.assert('hris.expense.read');
    const c = await this.own(id);
    const lines = await this.prisma.expenseClaimLine.findMany({ where: { claimId: id }, orderBy: { lineNo: 'asc' } });
    const ids = (k: 'accountId' | 'projectId' | 'costCenterId') => [...new Set(lines.map((l) => l[k]).filter(Boolean) as string[])];
    const [emp, accounts, projects, centers, files, bank, users, journals] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: c.employeeId }, select: { id: true, code: true, fullName: true, userId: true } }),
      this.prisma.account.findMany({ where: { id: { in: ids('accountId') } }, select: { id: true, code: true, name: true } }),
      this.prisma.project.findMany({ where: { id: { in: ids('projectId') } }, select: { id: true, code: true, name: true } }),
      this.prisma.costCenter.findMany({ where: { id: { in: ids('costCenterId') } }, select: { id: true, code: true, name: true } }),
      this.prisma.storedFile.findMany({ where: { entityType: 'EXPENSE', entityId: id, deletedAt: null, companyId: c.companyId }, select: { id: true, name: true, size: true, mimeType: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      c.paidBankAccountId ? this.prisma.bankAccount.findUnique({ where: { id: c.paidBankAccountId }, select: { id: true, name: true } }) : null,
      this.prisma.user.findMany({ where: { id: { in: [c.approvedById, c.createdById].filter(Boolean) as string[] } }, select: { id: true, fullName: true } }),
      this.prisma.journalEntry.findMany({ where: { sourceId: id, sourceType: { in: [SOURCE_CLAIM, SOURCE_PAY] } }, select: { id: true, number: true, status: true, sourceType: true, date: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const an = new Map(accounts.map((a) => [a.id, `${a.code} - ${a.name}`]));
    const pn = new Map(projects.map((p) => [p.id, `${p.code} - ${p.name}`]));
    const cn = new Map(centers.map((x) => [x.id, `${x.code} - ${x.name}`]));
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    const approval = await this.approvals.info(c.companyId, this.subject(c));
    const u = RequestCtx.user();
    const owner = await this.isOwner(c);
    const selfApproval = !u.isSuperAdmin && (owner || emp?.userId === u.id);
    const edit = await this.canEdit(c);
    return {
      ...c,
      employeeName: emp?.fullName ?? null,
      employeeCode: emp?.code ?? null,
      paidBankAccountName: bank?.name ?? null,
      approvedByName: c.approvedById ? un.get(c.approvedById) ?? null : null,
      createdByName: c.createdById ? un.get(c.createdById) ?? null : null,
      lines: lines.map((l) => ({ ...l, accountName: l.accountId ? an.get(l.accountId) ?? null : null, projectName: l.projectId ? pn.get(l.projectId) ?? null : null, costCenterName: l.costCenterId ? cn.get(l.costCenterId) ?? null : null })),
      files,
      journals,
      approval,
      can: {
        edit,
        delete: c.statusCode === 'DRAFT' && RequestCtx.can('hris.expense.delete') && (owner || RequestCtx.can('hris.expense.manage') || u.isSuperAdmin),
        submit: edit && lines.length > 0,
        withdraw: c.statusCode === 'SUBMITTED' && owner && approval.history.every((h) => h.status !== 'APPROVED'),
        // without approval rules the claim is approved directly by users holding hris.expense.approve
        approve: c.statusCode === 'SUBMITTED' && RequestCtx.can('hris.expense.approve') && !selfApproval && approval.status === 'NOT_REQUIRED',
        reject: c.statusCode === 'SUBMITTED' && RequestCtx.can('hris.expense.approve') && !selfApproval,
        pay: c.statusCode === 'APPROVED' && RequestCtx.can('hris.expense.pay'),
        cancel: ['SUBMITTED', 'APPROVED'].includes(c.statusCode) && RequestCtx.can('hris.expense.approve'),
        upload: RequestCtx.can('files.file.upload') && (edit || c.statusCode === 'SUBMITTED') && (owner || RequestCtx.can('hris.expense.manage') || u.isSuperAdmin),
      },
    };
  }

  // ------------------------------------------------------------------ write
  private async build(input: z.infer<typeof expenseSchema>) {
    const companyId = RequestCtx.companyId();
    const check = async (model: 'account' | 'project' | 'costCenter', id: string | null | undefined, field: string) => {
      if (!id) return null;
      const row = await (this.prisma as any)[model].findFirst({ where: { id, companyId, deletedAt: null } });
      if (!row) throw new BadRequestException({ message: 'Validation failed', errors: { [field]: 'Not found' } });
      return row;
    };
    const categories = new Set((await this.prisma.lookupValue.findMany({ where: { category: 'EXPENSE_CATEGORY', deletedAt: null }, select: { code: true } })).map((c) => c.code));
    const lines: Prisma.ExpenseClaimLineCreateWithoutClaimInput[] = [];
    for (const [i, l] of input.lines.entries()) {
      const acc = await check('account', l.accountId, `lines.${i}.accountId`);
      if (acc?.isGroup) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.accountId`]: 'Choose a detail account, not a header' } });
      await check('project', l.projectId, `lines.${i}.projectId`);
      await check('costCenter', l.costCenterId, `lines.${i}.costCenterId`);
      if (l.categoryCode && !categories.has(l.categoryCode)) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.categoryCode`]: 'Invalid category' } });
      lines.push({ lineNo: i + 1, date: l.date, categoryCode: l.categoryCode ?? null, accountId: l.accountId ?? null, description: l.description, amount: round(D(l.amount)), projectId: l.projectId ?? null, costCenterId: l.costCenterId ?? null });
    }
    return { lines, total: sum(lines.map((l) => D(l.amount as Prisma.Decimal))) };
  }

  private async resolveEmployee(requested: string | null | undefined) {
    const companyId = RequestCtx.companyId();
    const mine = await this.myEmployeeId();
    const manage = RequestCtx.user().isSuperAdmin || RequestCtx.can('hris.expense.manage');
    const id = requested && manage ? requested : mine ?? (manage ? requested : null);
    if (!id) throw new BadRequestException({ message: 'Validation failed', errors: { employeeId: manage ? 'Employee is required' : 'Your user is not linked to an employee record. Ask HR to link it.' } });
    const e = await this.prisma.employee.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!e) throw new BadRequestException({ message: 'Validation failed', errors: { employeeId: 'Employee not found' } });
    return e;
  }

  async create(body: unknown) {
    RequestCtx.assert('hris.expense.create');
    const input = expenseSchema.parse(body);
    const emp = await this.resolveEmployee(input.employeeId);
    const { lines, total } = await this.build(input);
    const u = RequestCtx.user();
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.expenseClaim.create({
        data: {
          companyId: u.companyId,
          branchId: emp.branchId ?? u.branchId,
          number: await this.sequence.next('EXPENSE', u.companyId, input.date, tx),
          employeeId: emp.id,
          date: input.date,
          title: input.title,
          notes: input.notes ?? null,
          totalAmount: total,
          createdById: u.id,
          lines: { create: lines },
        },
      });
      await this.audit.record('Expense Claim', c.id, 'CREATE', undefined, c, tx);
      return c;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('hris.expense.update');
    const before = await this.own(id, true);
    if (!(await this.canEdit(before))) throw new ConflictException('Only your draft or rejected claims can be edited');
    const input = expenseSchema.parse(body);
    const emp = await this.resolveEmployee(input.employeeId ?? before.employeeId);
    const { lines, total } = await this.build(input);
    return this.prisma.$transaction(async (tx) => {
      await tx.expenseClaimLine.deleteMany({ where: { claimId: id } });
      const c = await tx.expenseClaim.update({
        where: { id },
        data: { employeeId: emp.id, date: input.date, title: input.title, notes: input.notes ?? null, totalAmount: total, statusCode: 'DRAFT', rejectReason: null, updatedById: RequestCtx.user().id, lines: { create: lines } },
      });
      await this.approvals.reset(tx, 'EXPENSE', id);
      await this.audit.record('Expense Claim', id, 'UPDATE', before, c, tx);
      return c;
    });
  }

  async remove(id: string) {
    RequestCtx.assert('hris.expense.delete');
    const before = await this.own(id, true);
    if (before.statusCode !== 'DRAFT') throw new ConflictException('Only draft claims can be deleted');
    if (!(await this.isOwner(before)) && !RequestCtx.can('hris.expense.manage')) throw new ForbiddenException('You can only delete your own claims');
    await this.prisma.$transaction(async (tx) => {
      await tx.expenseClaim.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
      await this.approvals.reset(tx, 'EXPENSE', id);
      await this.audit.record('Expense Claim', id, 'DELETE', before, undefined, tx);
    });
    return { success: true };
  }

  // ------------------------------------------------------------------ workflow
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.expenseClaim.findUniqueOrThrow({ where: { id } });
  }

  async submit(id: string) {
    RequestCtx.assert('hris.expense.update');
    const before = await this.own(id, true);
    if (!(await this.canEdit(before))) throw new ConflictException('Only your draft or rejected claims can be submitted');
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (!['DRAFT', 'REJECTED'].includes(c.statusCode)) throw new ConflictException('Claim is already submitted');
      if (D(c.totalAmount).lte(0)) throw new BadRequestException('The claim has no amount');
      const r = await tx.expenseClaim.update({ where: { id }, data: { statusCode: 'SUBMITTED', submittedAt: new Date(), rejectReason: null, updatedById: RequestCtx.user().id } });
      await this.approvals.reset(tx, 'EXPENSE', id);
      const req = await this.approvals.submit(this.subject(r), tx);
      await this.audit.record('Expense Claim', id, 'SUBMIT', c, r, tx);
      return { ...r, approvalRequested: !!req };
    });
  }

  /** The employee takes a submitted claim back to draft (before anyone approved it) */
  async withdraw(id: string) {
    RequestCtx.assert('hris.expense.update');
    const before = await this.own(id, true);
    if (!(await this.isOwner(before))) throw new ForbiddenException('Only the claimant can withdraw a claim');
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.statusCode !== 'SUBMITTED') throw new ConflictException('Only submitted claims can be withdrawn');
      if (await tx.approvalRequest.count({ where: { docType: 'EXPENSE', documentId: id, statusCode: 'APPROVED' } })) throw new ConflictException('The claim was already partly approved and can no longer be withdrawn');
      const r = await tx.expenseClaim.update({ where: { id }, data: { statusCode: 'DRAFT', submittedAt: null, updatedById: RequestCtx.user().id } });
      await this.approvals.reset(tx, 'EXPENSE', id);
      await this.audit.record('Expense Claim', id, 'WITHDRAW', c, r, tx);
      return r;
    });
  }

  private async assertNotSelf(c: ExpenseClaim) {
    const u = RequestCtx.user();
    if (u.isSuperAdmin) return;
    const emp = await this.prisma.employee.findUnique({ where: { id: c.employeeId }, select: { userId: true } });
    if (emp?.userId === u.id || c.createdById === u.id) throw new ForbiddenException('You cannot approve or reject your own claim');
  }

  async approve(id: string) {
    RequestCtx.assert('hris.expense.approve');
    await this.own(id);
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.statusCode !== 'SUBMITTED') throw new ConflictException('Only submitted claims can be approved');
      await this.assertNotSelf(c);
      if ((await this.approvals.requiredFor(c.companyId, 'EXPENSE', c.totalAmount, tx)).length && !(await this.approvals.isApproved(c.companyId, 'EXPENSE', id, c.totalAmount, tx))) {
        throw new ConflictException('This claim follows the approval workflow. Approve it from the Approvals inbox.');
      }
      return this.doApprove(tx, c, RequestCtx.user().id);
    });
  }

  /** Recognises the expense: Dr expense accounts (per line) / Cr EXPENSE_PAYABLE */
  private async doApprove(tx: Tx, c: ExpenseClaim, approverId: string | null) {
    const lines = await tx.expenseClaimLine.findMany({ where: { claimId: c.id }, orderBy: { lineNo: 'asc' } });
    const fallback = lines.some((l) => !l.accountId) ? await this.journal.mapping(tx, c.companyId, 'PURCHASE_EXPENSE') : null;
    const emp = await tx.employee.findUnique({ where: { id: c.employeeId }, select: { fullName: true } });
    await this.journal.post(tx, {
      companyId: c.companyId,
      branchId: c.branchId,
      date: c.date,
      description: `${c.number} - ${c.title} (${emp?.fullName ?? 'employee'})`,
      sourceType: SOURCE_CLAIM,
      sourceId: c.id,
      lines: [
        ...lines.map((l) => ({ accountId: l.accountId ?? fallback, debit: D(l.amount), description: l.description, projectId: l.projectId, costCenterId: l.costCenterId })),
        { key: 'EXPENSE_PAYABLE', credit: D(c.totalAmount), description: `Reimbursement payable - ${emp?.fullName ?? ''}`.trim() },
      ],
    });
    const r = await tx.expenseClaim.update({ where: { id: c.id }, data: { statusCode: 'APPROVED', approvedById: approverId, approvedAt: new Date(), rejectReason: null } });
    await this.audit.record('Expense Claim', c.id, 'APPROVE', c, r, tx);
    return r;
  }

  private async doReject(tx: Tx, c: ExpenseClaim, reason: string) {
    const r = await tx.expenseClaim.update({ where: { id: c.id }, data: { statusCode: 'REJECTED', rejectReason: reason.slice(0, 1000) } });
    await this.approvals.reset(tx, 'EXPENSE', c.id);
    await this.audit.record('Expense Claim', c.id, 'REJECT', c, r, tx);
    return r;
  }

  async reject(id: string, reason: string) {
    RequestCtx.assert('hris.expense.approve');
    await this.own(id);
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.statusCode !== 'SUBMITTED') throw new ConflictException('Only submitted claims can be rejected');
      await this.assertNotSelf(c);
      return this.doReject(tx, c, reason);
    });
  }

  /** Reimburses the employee: Dr EXPENSE_PAYABLE / Cr cash or bank */
  async pay(id: string, body: unknown) {
    RequestCtx.assert('hris.expense.pay');
    const input = paySchema.parse(body);
    await this.own(id);
    const u = RequestCtx.user();
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId, deletedAt: null } });
    if (!bank) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'Not found' } });
    if (!bank.accountId) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'This cash/bank account has no ledger account' } });
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.statusCode !== 'APPROVED') throw new ConflictException('Only approved claims can be paid');
      const emp = await tx.employee.findUnique({ where: { id: c.employeeId }, select: { fullName: true } });
      await this.journal.post(tx, {
        companyId: c.companyId,
        branchId: c.branchId,
        date: input.date,
        description: `${c.number} - reimbursement to ${emp?.fullName ?? 'employee'}`,
        reference: input.reference ?? undefined,
        sourceType: SOURCE_PAY,
        sourceId: c.id,
        lines: [
          { key: 'EXPENSE_PAYABLE', debit: D(c.totalAmount), description: c.title },
          { accountId: bank.accountId, credit: D(c.totalAmount), description: c.title },
        ],
      });
      const r = await tx.expenseClaim.update({ where: { id }, data: { statusCode: 'PAID', paidAt: input.date, paidBankAccountId: bank.id, updatedById: u.id } });
      await this.audit.record('Expense Claim', id, 'PAY', c, r, tx);
      return r;
    });
  }

  /** Cancels a submitted or approved (unpaid) claim; the approval journal is voided */
  async cancel(id: string) {
    RequestCtx.assert('hris.expense.approve');
    await this.own(id);
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (!['SUBMITTED', 'APPROVED'].includes(c.statusCode)) throw new ConflictException(c.statusCode === 'PAID' ? 'Paid claims cannot be cancelled' : 'Only submitted or approved claims can be cancelled');
      if (c.statusCode === 'APPROVED') await this.journal.voidBySource(tx, SOURCE_CLAIM, id);
      const r = await tx.expenseClaim.update({ where: { id }, data: { statusCode: 'CANCELLED', updatedById: RequestCtx.user().id } });
      await this.approvals.reset(tx, 'EXPENSE', id);
      await this.audit.record('Expense Claim', id, 'CANCEL', c, r, tx);
      return r;
    });
  }
}
