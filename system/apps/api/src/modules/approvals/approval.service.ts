import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalRequest, ApprovalRule, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser, RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { paged } from '../../common/utils/query';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());

export const ruleSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(150),
    docType: z.string().trim().min(1, 'Document type is required').max(20),
    minAmount: z.coerce.number().min(0).max(1e14).default(0),
    level: z.coerce.number().int().min(1).max(10).default(1),
    approverRoleId: optUuid,
    approverUserId: optUuid,
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (!v.approverRoleId && !v.approverUserId) ctx.addIssue({ code: 'custom', path: ['approverRoleId'], message: 'Choose an approver role or a user' });
    if (v.approverRoleId && v.approverUserId) ctx.addIssue({ code: 'custom', path: ['approverUserId'], message: 'Choose either a role or a user, not both' });
  });

export const decideSchema = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(1000).nullable().optional()) })
  .superRefine((v, ctx) => {
    if (v.decision === 'REJECTED' && !v.comment) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Please give a reason for the rejection' });
  });

/** What a module tells the workflow about its document */
export interface ApprovalSubject {
  docType: string;
  documentId: string;
  documentNumber: string;
  amount: Prisma.Decimal.Value;
  /** human label for messages, e.g. "Purchase Order PO/2026/11/0001" */
  label?: string;
}

export type ApprovalStatus = 'NOT_REQUIRED' | 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/** Called inside the decision transaction when the last level approves or any level rejects */
export type FinalHandler = (tx: Tx, req: ApprovalRequest, outcome: 'APPROVED' | 'REJECTED', comment: string | null) => Promise<void>;

/**
 * Multi-level approval workflow.
 * Rules (per company) say: documents of <docType> with amount >= <minAmount> need approval at <level> by a role or a user.
 * For one amount the most specific rule of every level applies; levels are approved in order (level N+1 is requested
 * when level N approves). Editing a document resets its approvals; approvals are tied to the approved amount.
 */
@Injectable()
export class ApprovalService {
  private readonly handlers = new Map<string, FinalHandler>();

  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  /** Modules that need to react to the final outcome register here (e.g. expense claims) */
  onFinal(docType: string, handler: FinalHandler) {
    this.handlers.set(docType, handler);
  }

  enabled(companyId: string) {
    return this.settings.bool('approvals.enabled', companyId, true);
  }

  /** Applicable rules for an amount, one per level (highest matching threshold wins), ordered by level */
  async requiredFor(companyId: string, docType: string, amount: Prisma.Decimal.Value, db: Tx | PrismaService = this.prisma): Promise<ApprovalRule[]> {
    if (!(await this.enabled(companyId))) return [];
    const rules = await db.approvalRule.findMany({
      where: { companyId, docType, isActive: true, deletedAt: null, minAmount: { lte: D(amount) } },
      orderBy: [{ level: 'asc' }, { minAmount: 'desc' }, { createdAt: 'asc' }],
    });
    const byLevel = new Map<number, ApprovalRule>();
    for (const r of rules) if (!byLevel.has(r.level)) byLevel.set(r.level, r);
    return [...byLevel.values()];
  }

  private async approvedLevels(db: Tx | PrismaService, docType: string, documentId: string, amount: Prisma.Decimal.Value) {
    const approved = await db.approvalRequest.findMany({ where: { docType, documentId, statusCode: 'APPROVED' }, select: { level: true, amount: true } });
    return new Set(approved.filter((a) => D(a.amount).equals(D(amount))).map((a) => a.level));
  }

  async isApproved(companyId: string, docType: string, documentId: string, amount: Prisma.Decimal.Value, db: Tx | PrismaService = this.prisma) {
    const rules = await this.requiredFor(companyId, docType, amount, db);
    if (!rules.length) return true;
    const done = await this.approvedLevels(db, docType, documentId, amount);
    return rules.every((r) => done.has(r.level));
  }

  /** Throws a clear 409 when the document still needs approval */
  async assertApproved(companyId: string, s: ApprovalSubject, db: Tx | PrismaService = this.prisma) {
    if (await this.isApproved(companyId, s.docType, s.documentId, s.amount, db)) return;
    const pending = await db.approvalRequest.findFirst({ where: { docType: s.docType, documentId: s.documentId, statusCode: 'PENDING' } });
    const what = s.label ?? s.documentNumber;
    throw new ConflictException(
      pending ? `${what} is waiting for approval (level ${pending.level}). It can be confirmed once it is approved.` : `${what} requires approval before it can be confirmed. Use "Request approval" first.`,
    );
  }

  /** Approvals of a document are void after it changes (edit, cancel, delete) */
  async reset(db: Tx | PrismaService, docType: string, documentId: string) {
    await db.approvalRequest.updateMany({ where: { docType, documentId, statusCode: { in: ['PENDING', 'APPROVED'] } }, data: { statusCode: 'CANCELLED' } });
  }

  private async roleIdsOf(userId: string, companyId: string) {
    const rows = await this.prisma.userAssignment.findMany({ where: { userId, companyId, role: { isActive: true, deletedAt: null } }, select: { roleId: true } });
    return [...new Set(rows.map((r) => r.roleId))];
  }

  /** Where-clause of the pending requests a user may decide */
  async waitingWhere(u: Pick<AuthUser, 'id' | 'companyId'> & { isSuperAdmin?: boolean }): Promise<Prisma.ApprovalRequestWhereInput> {
    const roleIds = await this.roleIdsOf(u.id, u.companyId);
    return {
      companyId: u.companyId,
      statusCode: 'PENDING',
      AND: [
        { OR: [{ approverUserId: u.id }, ...(roleIds.length ? [{ approverRoleId: { in: roleIds } }] : [])] },
        // nobody approves their own request - except a super administrator (same rule as canDecide), so the inbox
        // lists exactly what the document page lets them approve
        ...(u.isSuperAdmin ? [] : [{ OR: [{ requestedById: null }, { requestedById: { not: u.id } }] }]),
      ],
    };
  }

  private async canDecide(u: AuthUser, req: ApprovalRequest) {
    if (req.statusCode !== 'PENDING') return false;
    if (u.isSuperAdmin) return true;
    if (!RequestCtx.can('approval.request.decide')) return false;
    if (req.requestedById === u.id) return false;
    if (req.approverUserId) return req.approverUserId === u.id;
    if (req.approverRoleId) return (await this.roleIdsOf(u.id, u.companyId)).includes(req.approverRoleId);
    return false;
  }

  // ------------------------------------------------------------------ submit / decide
  /** Starts (or continues) the approval chain of a document. Returns the created request or null when no approval is needed. */
  async submit(s: ApprovalSubject, tx?: Tx): Promise<ApprovalRequest | null> {
    const u = RequestCtx.user();
    const run = async (db: Tx) => {
      const rules = await this.requiredFor(u.companyId, s.docType, s.amount, db);
      if (!rules.length) return null;
      const pending = await db.approvalRequest.findFirst({ where: { docType: s.docType, documentId: s.documentId, statusCode: 'PENDING' } });
      if (pending) throw new ConflictException(`${s.label ?? s.documentNumber} is already waiting for approval`);
      // approvals given for another amount are no longer valid
      await db.approvalRequest.updateMany({ where: { docType: s.docType, documentId: s.documentId, statusCode: 'APPROVED', amount: { not: D(s.amount) } }, data: { statusCode: 'CANCELLED' } });
      const done = await this.approvedLevels(db, s.docType, s.documentId, s.amount);
      const next = rules.find((r) => !done.has(r.level));
      if (!next) throw new ConflictException(`${s.label ?? s.documentNumber} is already approved`);
      const req = await this.createRequest(db, s, next, u.id);
      await this.audit.record('Approval', s.documentId, 'APPROVAL_REQUEST', undefined, { level: next.level, rule: next.name, amount: s.amount }, db);
      return req;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private createRequest(db: Tx, s: ApprovalSubject, rule: ApprovalRule, requestedById: string | null) {
    return db.approvalRequest.create({
      data: {
        companyId: rule.companyId,
        ruleId: rule.id,
        docType: s.docType,
        documentId: s.documentId,
        documentNumber: s.documentNumber,
        amount: D(s.amount),
        level: rule.level,
        approverRoleId: rule.approverRoleId,
        approverUserId: rule.approverUserId,
        requestedById,
      },
    });
  }

  async decide(id: string, body: unknown) {
    RequestCtx.assert('approval.request.decide');
    const input = decideSchema.parse(body);
    const u = RequestCtx.user();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Approval request not found');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
        const req = await tx.approvalRequest.findFirst({ where: { id, companyId: u.companyId } });
        if (!req) throw new NotFoundException('Approval request not found');
        if (req.statusCode !== 'PENDING') throw new ConflictException('This request has already been decided');
        if (!(await this.canDecide(u, req))) throw new ForbiddenException(req.requestedById === u.id ? 'You cannot approve your own request' : 'You are not an approver of this request');
        const updated = await tx.approvalRequest.update({ where: { id }, data: { statusCode: input.decision, decidedById: u.id, decidedAt: new Date(), comment: input.comment ?? null } });
        await this.audit.record('Approval', req.documentId, input.decision === 'APPROVED' ? 'APPROVE' : 'REJECT', { level: req.level }, { level: req.level, comment: input.comment ?? null }, tx);

        let final: 'APPROVED' | 'REJECTED' | null = input.decision === 'REJECTED' ? 'REJECTED' : null;
        let nextRequest: ApprovalRequest | null = null;
        if (input.decision === 'APPROVED') {
          const rules = await this.requiredFor(u.companyId, req.docType, req.amount, tx);
          const done = await this.approvedLevels(tx, req.docType, req.documentId, req.amount);
          const next = rules.find((r) => !done.has(r.level) && r.level > req.level) ?? rules.find((r) => !done.has(r.level));
          if (next) nextRequest = await this.createRequest(tx, { docType: req.docType, documentId: req.documentId, documentNumber: req.documentNumber, amount: req.amount }, next, req.requestedById);
          else final = 'APPROVED';
        }
        if (final) await this.handlers.get(req.docType)?.(tx, updated, final, input.comment ?? null);
        return { ...updated, final, nextLevel: nextRequest?.level ?? null };
      },
      { timeout: 30_000 },
    );
  }

  /** The requester withdraws a pending request */
  async withdraw(id: string) {
    const u = RequestCtx.user();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Approval request not found');
    const req = await this.prisma.approvalRequest.findFirst({ where: { id, companyId: u.companyId } });
    if (!req) throw new NotFoundException('Approval request not found');
    if (req.statusCode !== 'PENDING') throw new ConflictException('Only pending requests can be withdrawn');
    if (req.requestedById !== u.id && !u.isSuperAdmin) throw new ForbiddenException('Only the requester can withdraw this request');
    const r = await this.prisma.approvalRequest.update({ where: { id }, data: { statusCode: 'CANCELLED', decidedById: u.id, decidedAt: new Date(), comment: 'Withdrawn by requester' } });
    await this.audit.record('Approval', req.documentId, 'APPROVAL_WITHDRAW', undefined, { level: req.level });
    return r;
  }

  /**
   * Approval status of many documents of one type at once (list pages): two queries for the whole page.
   * Documents that need no approval are left out of the map.
   */
  async statusMap(companyId: string, docType: string, docs: { id: string; amount: Prisma.Decimal.Value }[]): Promise<Map<string, { status: Exclude<ApprovalStatus, 'NOT_REQUIRED'>; level: number | null }>> {
    const out = new Map<string, { status: Exclude<ApprovalStatus, 'NOT_REQUIRED'>; level: number | null }>();
    if (!docs.length || !(await this.enabled(companyId))) return out;
    const rules = await this.prisma.approvalRule.findMany({ where: { companyId, docType, isActive: true, deletedAt: null }, orderBy: [{ level: 'asc' }, { minAmount: 'desc' }, { createdAt: 'asc' }] });
    if (!rules.length) return out;
    const requests = await this.prisma.approvalRequest.findMany({
      where: { companyId, docType, documentId: { in: docs.map((d) => d.id) } },
      select: { documentId: true, level: true, statusCode: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const d of docs) {
      const amount = D(d.amount);
      // same selection as requiredFor(): per level the highest threshold that the amount reaches
      const levels = new Map<number, ApprovalRule>();
      for (const r of rules) if (D(r.minAmount).lte(amount) && !levels.has(r.level)) levels.set(r.level, r);
      if (!levels.size) continue;
      const mine = requests.filter((r) => r.documentId === d.id);
      const approved = new Set(mine.filter((r) => r.statusCode === 'APPROVED' && D(r.amount).equals(amount)).map((r) => r.level));
      const pending = mine.find((r) => r.statusCode === 'PENDING');
      if ([...levels.keys()].every((l) => approved.has(l))) out.set(d.id, { status: 'APPROVED', level: null });
      else if (pending) out.set(d.id, { status: 'PENDING', level: pending.level });
      else if (mine[0]?.statusCode === 'REJECTED') out.set(d.id, { status: 'REJECTED', level: mine[0].level });
      else out.set(d.id, { status: 'NOT_REQUESTED', level: null });
    }
    return out;
  }

  // ------------------------------------------------------------------ read models
  private async names(rows: { approverRoleId: string | null; approverUserId: string | null; requestedById?: string | null; decidedById?: string | null }[]) {
    const roleIds = [...new Set(rows.map((r) => r.approverRoleId).filter(Boolean) as string[])];
    const userIds = [...new Set(rows.flatMap((r) => [r.approverUserId, r.requestedById, r.decidedById]).filter(Boolean) as string[])];
    const [roles, users] = await Promise.all([
      roleIds.length ? this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const rn = new Map(roles.map((r) => [r.id, r.name]));
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    return {
      approver: (r: { approverRoleId: string | null; approverUserId: string | null }) => (r.approverUserId ? un.get(r.approverUserId) ?? 'Unknown user' : r.approverRoleId ? `${rn.get(r.approverRoleId) ?? 'Unknown role'} (role)` : '—'),
      user: (id: string | null | undefined) => (id ? un.get(id) ?? 'Unknown' : null),
    };
  }

  /** Approval panel of a document: required levels, status, history and what the current user may do */
  async info(companyId: string, s: ApprovalSubject) {
    const u = RequestCtx.user();
    const [enabled, rules, requests] = await Promise.all([
      this.enabled(companyId),
      this.requiredFor(companyId, s.docType, s.amount),
      this.prisma.approvalRequest.findMany({ where: { companyId, docType: s.docType, documentId: s.documentId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const n = await this.names([...rules, ...requests]);
    const done = await this.approvedLevels(this.prisma, s.docType, s.documentId, s.amount);
    const pending = requests.find((r) => r.statusCode === 'PENDING') ?? null;
    let status: ApprovalStatus = 'NOT_REQUIRED';
    if (rules.length) {
      if (rules.every((r) => done.has(r.level))) status = 'APPROVED';
      else if (pending) status = 'PENDING';
      else if (requests[0]?.statusCode === 'REJECTED') status = 'REJECTED';
      else status = 'NOT_REQUESTED';
    }
    return {
      enabled,
      status,
      required: rules.map((r) => ({ level: r.level, name: r.name, approver: n.approver(r), approved: done.has(r.level) })),
      pending: pending ? { id: pending.id, level: pending.level, approver: n.approver(pending), canDecide: await this.canDecide(u, pending), canWithdraw: pending.requestedById === u.id || u.isSuperAdmin } : null,
      history: requests.map((r) => ({
        id: r.id,
        level: r.level,
        status: r.statusCode,
        amount: r.amount,
        approver: n.approver(r),
        requestedBy: n.user(r.requestedById),
        decidedBy: n.user(r.decidedById),
        decidedAt: r.decidedAt,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
    };
  }

  async list(q: { page: number; pageSize: number; tab: 'waiting' | 'mine' | 'all'; status?: string; docType?: string; search?: string }) {
    RequestCtx.assert('approval.request.read');
    const u = RequestCtx.user();
    let where: Prisma.ApprovalRequestWhereInput;
    if (q.tab === 'waiting') where = await this.waitingWhere(u);
    else if (q.tab === 'mine') where = { companyId: u.companyId, requestedById: u.id };
    else {
      if (!u.isSuperAdmin && u.dataScope !== 'ALL' && u.dataScope !== 'COMPANY') throw new ForbiddenException('You can only see requests assigned to or created by you');
      where = { companyId: u.companyId };
    }
    const and: Prisma.ApprovalRequestWhereInput[] = [where];
    if (q.status && q.tab !== 'waiting') and.push({ statusCode: q.status });
    if (q.docType) and.push({ docType: q.docType });
    if (q.search) and.push({ documentNumber: { contains: q.search, mode: 'insensitive' } });
    const w: Prisma.ApprovalRequestWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({ where: w, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.approvalRequest.count({ where: w }),
    ]);
    const n = await this.names(rows);
    const decidable = new Set<string>();
    for (const r of rows) if (await this.canDecide(u, r)) decidable.add(r.id);
    return paged(
      rows.map((r) => ({ ...r, approverName: n.approver(r), requestedByName: n.user(r.requestedById), decidedByName: n.user(r.decidedById), canDecide: decidable.has(r.id), canWithdraw: r.statusCode === 'PENDING' && (r.requestedById === u.id || u.isSuperAdmin) })),
      total,
      q,
    );
  }

  async counts() {
    RequestCtx.assert('approval.request.read');
    const u = RequestCtx.user();
    const [waiting, minePending] = await Promise.all([this.prisma.approvalRequest.count({ where: await this.waitingWhere(u) }), this.prisma.approvalRequest.count({ where: { companyId: u.companyId, requestedById: u.id, statusCode: 'PENDING' } })]);
    return { waiting, minePending, canSeeAll: u.isSuperAdmin || u.dataScope === 'ALL' || u.dataScope === 'COMPANY' };
  }

  // ------------------------------------------------------------------ rules
  async rules() {
    RequestCtx.assert('system.approval-rule.read');
    const rows = await this.prisma.approvalRule.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null }, orderBy: [{ docType: 'asc' }, { level: 'asc' }, { minAmount: 'asc' }] });
    const n = await this.names(rows);
    return rows.map((r) => ({ ...r, approverName: n.approver(r) }));
  }

  private async validateRule(input: z.infer<typeof ruleSchema>) {
    const companyId = RequestCtx.companyId();
    if (!(await this.prisma.lookupValue.findFirst({ where: { category: 'APPROVAL_DOC_TYPE', code: input.docType, deletedAt: null } }))) {
      throw new BadRequestException({ message: 'Validation failed', errors: { docType: 'Invalid document type' } });
    }
    if (input.approverRoleId && !(await this.prisma.role.findFirst({ where: { id: input.approverRoleId, deletedAt: null, OR: [{ companyId: null }, { companyId }] } }))) {
      throw new BadRequestException({ message: 'Validation failed', errors: { approverRoleId: 'Role not found' } });
    }
    if (input.approverUserId && !(await this.prisma.user.findFirst({ where: { id: input.approverUserId, deletedAt: null, isActive: true, OR: [{ isSuperAdmin: true }, { assignments: { some: { companyId } } }] } }))) {
      throw new BadRequestException({ message: 'Validation failed', errors: { approverUserId: 'User has no access to this company' } });
    }
  }

  async createRule(body: unknown) {
    RequestCtx.assert('system.approval-rule.create');
    const input = ruleSchema.parse(body);
    await this.validateRule(input);
    const u = RequestCtx.user();
    const r = await this.prisma.approvalRule.create({ data: { ...input, approverRoleId: input.approverRoleId ?? null, approverUserId: input.approverUserId ?? null, minAmount: D(input.minAmount), companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Approval Rule', r.id, 'CREATE', undefined, r);
    return r;
  }

  private async ownRule(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Rule not found');
    const r = await this.prisma.approvalRule.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!r) throw new NotFoundException('Rule not found');
    return r;
  }

  async updateRule(id: string, body: unknown) {
    RequestCtx.assert('system.approval-rule.update');
    const before = await this.ownRule(id);
    const input = ruleSchema.parse(body);
    await this.validateRule(input);
    const r = await this.prisma.approvalRule.update({ where: { id }, data: { ...input, approverRoleId: input.approverRoleId ?? null, approverUserId: input.approverUserId ?? null, minAmount: D(input.minAmount), updatedById: RequestCtx.user().id } });
    // open requests keep the approver they were created with; new requests use the new rule
    await this.audit.record('Approval Rule', id, 'UPDATE', before, r);
    return r;
  }

  async removeRule(id: string) {
    RequestCtx.assert('system.approval-rule.delete');
    const before = await this.ownRule(id);
    await this.prisma.approvalRule.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedById: RequestCtx.user().id } });
    await this.audit.record('Approval Rule', id, 'DELETE', before);
    return { success: true };
  }

  /** Roles that can be chosen as approver (global templates + company roles) */
  async roleOptions() {
    RequestCtx.assert('system.approval-rule.read');
    const rows = await this.prisma.role.findMany({ where: { deletedAt: null, isActive: true, OR: [{ companyId: null }, { companyId: RequestCtx.companyId() }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ value: r.id, label: r.name }));
  }
}
