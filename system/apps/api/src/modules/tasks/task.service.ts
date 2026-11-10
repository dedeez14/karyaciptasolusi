import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { paged } from '../../common/utils/query';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(250),
  description: optText(20000),
  projectId: optUuid,
  customerId: optUuid,
  stageId: optUuid,
  priorityCode: optText(50),
  assigneeId: optUuid,
  startDate: optDate,
  dueDate: optDate,
  estimateHours: z.coerce.number().min(0).max(10000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export interface TaskQuery {
  page: number;
  pageSize: number;
  search?: string;
  projectId?: string;
  assigneeId?: string;
  stageId?: string;
  priorityCode?: string;
  tag?: string;
  due?: 'overdue' | 'today' | 'week' | 'none';
  mine?: string;
  status?: 'open' | 'done';
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * Task management: board / list / my tasks, checklist, comments, time tracking.
 * Visibility: task.task.manage or COMPANY/ALL data scope -> every task of the company;
 * otherwise only tasks the user is assigned to, reports or created.
 */
@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService, private readonly sequence: SequenceService, private readonly audit: AuditService) {}

  private visibility(): Prisma.TaskWhereInput {
    const u = RequestCtx.user();
    const where: Prisma.TaskWhereInput = { companyId: u.companyId, deletedAt: null };
    const seeAll = u.isSuperAdmin || RequestCtx.can('task.task.manage') || u.dataScope === 'ALL' || u.dataScope === 'COMPANY';
    if (!seeAll) {
      const mine: Prisma.TaskWhereInput[] = [{ assigneeId: u.id }, { reporterId: u.id }, { createdById: u.id }];
      if (u.dataScope === 'BRANCH' && u.branchIds) mine.push({ branchId: { in: u.branchIds } });
      where.OR = mine;
    }
    return where;
  }

  private canEdit(t: { assigneeId: string | null; reporterId: string | null; createdById: string | null }) {
    const u = RequestCtx.user();
    return u.isSuperAdmin || RequestCtx.can('task.task.manage') || [t.assigneeId, t.reporterId, t.createdById].includes(u.id);
  }

  async stages() {
    RequestCtx.assert('task.task.read');
    return this.prisma.taskStage.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  private async decorate<T extends { assigneeId: string | null; reporterId: string | null; projectId: string | null; customerId: string | null; createdById: string | null; id: string }>(rows: T[]) {
    const userIds = [...new Set(rows.flatMap((r) => [r.assigneeId, r.reporterId, r.createdById]).filter(Boolean) as string[])];
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean) as string[])];
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
    const [users, projects, customers, checklist, comments, files] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
      this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } }),
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }),
      this.prisma.taskChecklistItem.groupBy({ by: ['taskId', 'isDone'], where: { taskId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
      this.prisma.taskComment.groupBy({ by: ['taskId'], where: { taskId: { in: rows.map((r) => r.id) }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.storedFile.groupBy({ by: ['entityId'], where: { entityType: 'TASK', entityId: { in: rows.map((r) => r.id) }, deletedAt: null }, _count: { _all: true } }),
    ]);
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    const pn = new Map(projects.map((x) => [x.id, `${x.code} - ${x.name}`]));
    const cn = new Map(customers.map((x) => [x.id, x.name]));
    return rows.map((r) => {
      const done = checklist.find((c) => c.taskId === r.id && c.isDone)?._count._all ?? 0;
      const open = checklist.find((c) => c.taskId === r.id && !c.isDone)?._count._all ?? 0;
      return {
        ...r,
        assigneeName: r.assigneeId ? un.get(r.assigneeId) ?? null : null,
        reporterName: r.reporterId ? un.get(r.reporterId) ?? null : null,
        projectName: r.projectId ? pn.get(r.projectId) ?? null : null,
        customerName: r.customerId ? cn.get(r.customerId) ?? null : null,
        checklistDone: done,
        checklistTotal: done + open,
        commentCount: comments.find((c) => c.taskId === r.id)?._count._all ?? 0,
        fileCount: files.find((f) => f.entityId === r.id)?._count._all ?? 0,
      };
    });
  }

  async list(q: TaskQuery) {
    RequestCtx.assert('task.task.read');
    const u = RequestCtx.user();
    const where: Prisma.TaskWhereInput = this.visibility();
    const and: Prisma.TaskWhereInput[] = [];
    if (q.search) and.push({ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] });
    if (q.mine === '1') and.push({ assigneeId: u.id });
    if (q.projectId) where.projectId = q.projectId;
    if (q.assigneeId) where.assigneeId = q.assigneeId === 'none' ? null : q.assigneeId;
    if (q.stageId) where.stageId = q.stageId;
    if (q.priorityCode) where.priorityCode = q.priorityCode;
    if (q.tag) where.tags = { has: q.tag };
    if (q.status === 'open') where.completedAt = null;
    if (q.status === 'done') where.completedAt = { not: null };
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (q.due === 'overdue') and.push({ dueDate: { lt: today }, completedAt: null });
    if (q.due === 'today') and.push({ dueDate: today });
    if (q.due === 'week') and.push({ dueDate: { gte: today, lte: new Date(today.getTime() + 7 * 86_400_000) } });
    if (q.due === 'none') and.push({ dueDate: null });
    if (and.length) where.AND = and;
    const sortField = ['dueDate', 'createdAt', 'title', 'code', 'position', 'updatedAt'].includes(q.sort ?? '') ? q.sort! : 'position';
    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({ where, orderBy: [{ [sortField]: q.order ?? 'asc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.task.count({ where }),
    ]);
    return paged(await this.decorate(rows), total, q);
  }

  async summary() {
    RequestCtx.assert('task.task.read');
    const u = RequestCtx.user();
    const today = new Date(new Date().toISOString().slice(0, 10));
    const mine: Prisma.TaskWhereInput = { companyId: u.companyId, deletedAt: null, assigneeId: u.id };
    const [open, overdue, dueToday, doneWeek] = await Promise.all([
      this.prisma.task.count({ where: { ...mine, completedAt: null } }),
      this.prisma.task.count({ where: { ...mine, completedAt: null, dueDate: { lt: today } } }),
      this.prisma.task.count({ where: { ...mine, completedAt: null, dueDate: today } }),
      this.prisma.task.count({ where: { ...mine, completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]);
    return { open, overdue, dueToday, doneWeek };
  }

  private async own(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Task not found');
    const t = await this.prisma.task.findFirst({ where: { ...this.visibility(), id } });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  async get(id: string) {
    RequestCtx.assert('task.task.read');
    const t = await this.own(id);
    const [decorated] = await this.decorate([t]);
    const [checklist, comments, timeLogs, files] = await Promise.all([
      this.prisma.taskChecklistItem.findMany({ where: { taskId: id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.taskComment.findMany({ where: { taskId: id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.taskTimeLog.findMany({ where: { taskId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.storedFile.findMany({ where: { entityType: 'TASK', entityId: id, deletedAt: null, companyId: t.companyId }, select: { id: true, name: true, size: true, mimeType: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set([...comments.map((c) => c.userId), ...timeLogs.map((l) => l.userId)])] } }, select: { id: true, fullName: true } });
    const un = new Map(users.map((x) => [x.id, x.fullName]));
    const me = RequestCtx.user().id;
    return {
      ...decorated,
      canEdit: this.canEdit(t),
      checklist,
      comments: comments.map((c) => ({ ...c, userName: un.get(c.userId) ?? 'Unknown', mine: c.userId === me })),
      timeLogs: timeLogs.map((l) => ({ ...l, userName: un.get(l.userId) ?? 'Unknown', mine: l.userId === me })),
      files,
    };
  }

  private async refs(data: Partial<z.infer<typeof taskSchema>>) {
    const companyId = RequestCtx.companyId();
    const check = async (model: 'project' | 'customer' | 'taskStage', id: string | null | undefined, field: string) => {
      if (!id) return null;
      const row = await (this.prisma as any)[model].findFirst({ where: { id, companyId, deletedAt: null } });
      if (!row) throw new BadRequestException({ message: 'Validation failed', errors: { [field]: 'Not found' } });
      return row;
    };
    await check('project', data.projectId, 'projectId');
    await check('customer', data.customerId, 'customerId');
    const stage = await check('taskStage', data.stageId, 'stageId');
    if (data.assigneeId) {
      const ok = await this.prisma.user.findFirst({ where: { id: data.assigneeId, deletedAt: null, isActive: true, OR: [{ isSuperAdmin: true }, { assignments: { some: { companyId } } }] } });
      if (!ok) throw new BadRequestException({ message: 'Validation failed', errors: { assigneeId: 'User has no access to this company' } });
    }
    if (data.priorityCode && !(await this.prisma.lookupValue.findFirst({ where: { category: 'TASK_PRIORITY', code: data.priorityCode, deletedAt: null } }))) {
      throw new BadRequestException({ message: 'Validation failed', errors: { priorityCode: 'Invalid priority' } });
    }
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) throw new BadRequestException({ message: 'Validation failed', errors: { dueDate: 'Due date is before the start date' } });
    return { stage };
  }

  async create(body: unknown) {
    RequestCtx.assert('task.task.create');
    const input = taskSchema.parse(body);
    const u = RequestCtx.user();
    let { stage } = await this.refs(input);
    if (!stage) stage = await this.prisma.taskStage.findFirst({ where: { companyId: u.companyId, deletedAt: null, isActive: true }, orderBy: { sortOrder: 'asc' } });
    if (!stage) throw new BadRequestException('No task stages configured. Add them in Task Management > Task Stages.');
    const last = await this.prisma.task.aggregate({ where: { companyId: u.companyId, stageId: stage.id }, _max: { position: true } });
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId,
          code: await this.sequence.next('TASK', u.companyId, new Date(), tx),
          title: input.title,
          description: input.description ?? null,
          projectId: input.projectId ?? null,
          customerId: input.customerId ?? null,
          stageId: stage!.id,
          priorityCode: input.priorityCode ?? null,
          assigneeId: input.assigneeId ?? null,
          reporterId: u.id,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimateHours: D(input.estimateHours ?? 0),
          tags: [...new Set(input.tags ?? [])],
          position: (last._max.position ?? 0) + 1024,
          completedAt: stage!.isDone ? new Date() : null,
          createdById: u.id,
        },
      });
      await this.audit.record('Task', t.id, 'CREATE', undefined, t, tx);
      return t;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('task.task.update');
    const before = await this.own(id);
    if (!this.canEdit(before)) throw new ForbiddenException('You can only edit tasks assigned to or created by you');
    const input = taskSchema.partial().parse(body);
    const { stage } = await this.refs({ ...input, startDate: input.startDate ?? before.startDate, dueDate: input.dueDate ?? before.dueDate });
    const data: Prisma.TaskUncheckedUpdateInput = { ...input, updatedById: RequestCtx.user().id } as any;
    if (input.estimateHours !== undefined) data.estimateHours = D(input.estimateHours);
    if (input.tags) data.tags = [...new Set(input.tags)];
    if (stage) data.completedAt = stage.isDone ? before.completedAt ?? new Date() : null;
    const t = await this.prisma.task.update({ where: { id }, data });
    await this.audit.record('Task', id, 'UPDATE', before, t);
    return t;
  }

  /** Drag & drop on the board: change column and/or position */
  async move(id: string, stageId: string, position: number) {
    RequestCtx.assert('task.task.update');
    const before = await this.own(id);
    if (!this.canEdit(before)) throw new ForbiddenException('You can only move tasks assigned to or created by you');
    const stage = await this.prisma.taskStage.findFirst({ where: { id: stageId, companyId: before.companyId, deletedAt: null } });
    if (!stage) throw new BadRequestException('Stage not found');
    const t = await this.prisma.task.update({
      where: { id },
      data: { stageId, position, completedAt: stage.isDone ? before.completedAt ?? new Date() : null, updatedById: RequestCtx.user().id },
    });
    if (before.stageId !== stageId) await this.audit.record('Task', id, 'MOVE', { stageId: before.stageId }, { stageId });
    return t;
  }

  async remove(id: string) {
    RequestCtx.assert('task.task.delete');
    const before = await this.own(id);
    if (!this.canEdit(before)) throw new ForbiddenException('You can only delete tasks you created or manage');
    await this.prisma.task.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('Task', id, 'DELETE', before);
    return { success: true };
  }

  // ---------------------------------------------------------------- checklist
  async addChecklist(id: string, title: string) {
    RequestCtx.assert('task.task.update');
    const t = await this.own(id);
    if (!this.canEdit(t)) throw new ForbiddenException();
    const max = await this.prisma.taskChecklistItem.aggregate({ where: { taskId: id }, _max: { position: true } });
    return this.prisma.taskChecklistItem.create({ data: { taskId: id, title, position: (max._max.position ?? 0) + 1 } });
  }

  async updateChecklist(id: string, itemId: string, data: { title?: string; isDone?: boolean }) {
    RequestCtx.assert('task.task.update');
    const t = await this.own(id);
    if (!this.canEdit(t)) throw new ForbiddenException();
    const item = await this.prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId: id } });
    if (!item) throw new NotFoundException('Checklist item not found');
    return this.prisma.taskChecklistItem.update({ where: { id: itemId }, data });
  }

  async removeChecklist(id: string, itemId: string) {
    RequestCtx.assert('task.task.update');
    const t = await this.own(id);
    if (!this.canEdit(t)) throw new ForbiddenException();
    await this.prisma.taskChecklistItem.deleteMany({ where: { id: itemId, taskId: id } });
    return { success: true };
  }

  // ---------------------------------------------------------------- comments
  async addComment(id: string, body: string) {
    RequestCtx.assert('task.task.read');
    await this.own(id);
    const c = await this.prisma.taskComment.create({ data: { taskId: id, userId: RequestCtx.user().id, body } });
    await this.prisma.task.update({ where: { id }, data: { updatedAt: new Date() } });
    return c;
  }

  async removeComment(id: string, commentId: string) {
    await this.own(id);
    const c = await this.prisma.taskComment.findFirst({ where: { id: commentId, taskId: id, deletedAt: null } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.userId !== RequestCtx.user().id && !RequestCtx.can('task.task.manage')) throw new ForbiddenException('You can only delete your own comments');
    await this.prisma.taskComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  // ---------------------------------------------------------------- time tracking
  private async recalcSpent(id: string) {
    const agg = await this.prisma.taskTimeLog.aggregate({ where: { taskId: id }, _sum: { hours: true } });
    await this.prisma.task.update({ where: { id }, data: { spentHours: agg._sum.hours ?? 0 } });
  }

  async logTime(id: string, data: { date: Date; hours: number; note?: string | null }) {
    RequestCtx.assert('task.task.update');
    await this.own(id);
    const log = await this.prisma.taskTimeLog.create({ data: { taskId: id, userId: RequestCtx.user().id, date: data.date, hours: D(data.hours), note: data.note ?? null } });
    await this.recalcSpent(id);
    return log;
  }

  async removeTime(id: string, logId: string) {
    await this.own(id);
    const log = await this.prisma.taskTimeLog.findFirst({ where: { id: logId, taskId: id } });
    if (!log) throw new NotFoundException('Time entry not found');
    if (log.userId !== RequestCtx.user().id && !RequestCtx.can('task.task.manage')) throw new ForbiddenException('You can only delete your own time entries');
    await this.prisma.taskTimeLog.delete({ where: { id: logId } });
    await this.recalcSpent(id);
    return { success: true };
  }
}
