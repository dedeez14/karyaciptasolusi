import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Monday (UTC date) of the week that contains `date` (YYYY-MM-DD) */
export function weekStart(date?: string): Date {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

/**
 * Ids of the time logs that are billed on an invoice that still counts (not deleted, not cancelled).
 * A log whose invoice was cancelled or deleted is billable again.
 */
export async function billedLogIds(prisma: PrismaService | Prisma.TransactionClient, logs: { id: string; invoiceId: string | null }[]): Promise<Set<string>> {
  const invIds = [...new Set(logs.map((l) => l.invoiceId).filter((x): x is string => !!x))];
  if (!invIds.length) return new Set();
  const active = new Set(
    (await prisma.tradeDocument.findMany({ where: { id: { in: invIds }, deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true } })).map((d) => d.id),
  );
  return new Set(logs.filter((l) => l.invoiceId && active.has(l.invoiceId)).map((l) => l.id));
}

/**
 * Weekly timesheets on top of task time logs. Users see and edit their own week;
 * task.timesheet.manage sees and edits everyone's. Hours already invoiced are locked.
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canManage() {
    const u = RequestCtx.user();
    return u.isSuperAdmin || RequestCtx.can('task.timesheet.manage');
  }

  /** whose timesheet: own by default, another user only with task.timesheet.manage */
  private async target(userId?: string | null) {
    const u = RequestCtx.user();
    if (!userId || userId === u.id) return { id: u.id, fullName: u.fullName };
    if (!UUID.test(userId)) throw new BadRequestException('Invalid user');
    if (!this.canManage()) throw new ForbiddenException("You can only see your own timesheet (task.timesheet.manage is needed for other people's)");
    const other = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, OR: [{ isSuperAdmin: true }, { assignments: { some: { companyId: u.companyId } } }] }, select: { id: true, fullName: true } });
    if (!other) throw new NotFoundException('User not found');
    return other;
  }

  /** task the target user may book time on */
  private async task(taskId: string, forOther: boolean) {
    const u = RequestCtx.user();
    if (!UUID.test(taskId)) throw new NotFoundException('Task not found');
    const where: Prisma.TaskWhereInput = { id: taskId, companyId: u.companyId, deletedAt: null };
    const seeAll = forOther || u.isSuperAdmin || RequestCtx.can('task.task.manage') || u.dataScope === 'ALL' || u.dataScope === 'COMPANY';
    if (!seeAll) {
      const mine: Prisma.TaskWhereInput[] = [{ assigneeId: u.id }, { reporterId: u.id }, { createdById: u.id }];
      if (u.dataScope === 'BRANCH' && u.branchIds) mine.push({ branchId: { in: u.branchIds } });
      where.OR = mine;
    }
    const t = await this.prisma.task.findFirst({ where, select: { id: true, code: true, title: true, projectId: true } });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }

  async users() {
    RequestCtx.assert('task.timesheet.read');
    if (!this.canManage()) return [];
    const companyId = RequestCtx.companyId();
    return this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, OR: [{ assignments: { some: { companyId } } }, { isSuperAdmin: true }] },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, username: true },
      take: 500,
    });
  }

  async week(q: { start?: string; userId?: string }) {
    RequestCtx.assert('task.timesheet.read');
    const companyId = RequestCtx.companyId();
    const user = await this.target(q.userId);
    const start = weekStart(q.start);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const days = Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * 86_400_000)));
    const logs = await this.prisma.taskTimeLog.findMany({
      where: { userId: user.id, date: { gte: start, lte: end }, task: { companyId, deletedAt: null } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { task: { select: { id: true, code: true, title: true, projectId: true } } },
    });
    const billed = await billedLogIds(this.prisma, logs);
    const projIds = [...new Set(logs.map((l) => l.task.projectId).filter((x): x is string => !!x))];
    const projects = new Map((await this.prisma.project.findMany({ where: { id: { in: projIds } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));

    const rows = new Map<string, { taskId: string; code: string; title: string; projectId: string | null; projectName: string | null; cells: Record<string, { hours: number; billedHours: number; billable: boolean; note: string | null; entries: { id: string; hours: number; billable: boolean; note: string | null; billed: boolean }[] }>; total: number }>();
    for (const l of logs) {
      const p = l.task.projectId ? projects.get(l.task.projectId) : null;
      let r = rows.get(l.taskId);
      if (!r) {
        r = { taskId: l.taskId, code: l.task.code, title: l.task.title, projectId: l.task.projectId, projectName: p ? `${p.code} - ${p.name}` : null, cells: {}, total: 0 };
        rows.set(l.taskId, r);
      }
      const k = iso(l.date);
      const c = (r.cells[k] ??= { hours: 0, billedHours: 0, billable: true, note: null, entries: [] });
      const h = Number(l.hours);
      const isBilled = billed.has(l.id);
      c.entries.push({ id: l.id, hours: h, billable: l.billable, note: l.note, billed: isBilled });
      c.hours = Math.round((c.hours + h) * 100) / 100;
      if (isBilled) c.billedHours = Math.round((c.billedHours + h) * 100) / 100;
      r.total = Math.round((r.total + h) * 100) / 100;
    }
    for (const r of rows.values())
      for (const c of Object.values(r.cells)) {
        const open = c.entries.filter((e) => !e.billed);
        const ref = open[0] ?? c.entries[0];
        c.billable = ref ? ref.billable : true;
        c.note = open.map((e) => e.note).filter(Boolean).join(' / ') || null;
      }
    const list = [...rows.values()].sort((a, b) => (a.projectName ?? '~').localeCompare(b.projectName ?? '~') || a.code.localeCompare(b.code));
    const dayTotals = Object.fromEntries(days.map((d) => [d, Math.round(list.reduce((a, r) => a + (r.cells[d]?.hours ?? 0), 0) * 100) / 100]));
    const byProject = new Map<string, { projectId: string | null; name: string; hours: number; billable: number }>();
    for (const l of logs) {
      const key = l.task.projectId ?? 'none';
      const p = l.task.projectId ? projects.get(l.task.projectId) : null;
      const e = byProject.get(key) ?? { projectId: l.task.projectId, name: p ? `${p.code} - ${p.name}` : 'No project', hours: 0, billable: 0 };
      e.hours = Math.round((e.hours + Number(l.hours)) * 100) / 100;
      if (l.billable) e.billable = Math.round((e.billable + Number(l.hours)) * 100) / 100;
      byProject.set(key, e);
    }
    return {
      start: days[0],
      end: days[6],
      days,
      user,
      canManage: this.canManage(),
      rows: list,
      dayTotals,
      projectTotals: [...byProject.values()].sort((a, b) => b.hours - a.hours),
      total: Math.round(list.reduce((a, r) => a + r.total, 0) * 100) / 100,
    };
  }

  private async recalcSpent(taskId: string, tx: Prisma.TransactionClient) {
    const agg = await tx.taskTimeLog.aggregate({ where: { taskId }, _sum: { hours: true } });
    await tx.task.update({ where: { id: taskId }, data: { spentHours: agg._sum.hours ?? 0 } });
  }

  /**
   * Sets the hours of one task on one day for a user. Invoiced hours stay untouched (they are locked);
   * the editable part is kept in a single entry.
   */
  async setCell(input: { taskId: string; date: string; hours: number; userId?: string | null; billable?: boolean; note?: string | null }) {
    RequestCtx.assert('task.timesheet.read');
    const me = RequestCtx.user();
    const user = await this.target(input.userId);
    const forOther = user.id !== me.id;
    if (!forOther) RequestCtx.assert('task.task.update');
    const task = await this.task(input.taskId, forOther);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new BadRequestException('Invalid date');
    const date = new Date(`${input.date}T00:00:00Z`);
    const hours = Math.round(Number(input.hours) * 100) / 100;
    if (!(hours >= 0 && hours <= 24)) throw new BadRequestException({ message: 'Validation failed', errors: { hours: 'Hours must be between 0 and 24' } });

    return this.prisma.$transaction(async (tx) => {
      const entries = await tx.taskTimeLog.findMany({ where: { taskId: task.id, userId: user.id, date }, orderBy: { createdAt: 'asc' } });
      const billed = await billedLogIds(tx, entries);
      const billedHours = entries.filter((e) => billed.has(e.id)).reduce((a, e) => a + Number(e.hours), 0);
      const open = entries.filter((e) => !billed.has(e.id));
      if (hours + 1e-9 < billedHours) throw new ConflictException(`${billedHours} h of this day are already invoiced and cannot be reduced`);
      // the whole day must stay within 24 hours across tasks
      const others = await tx.taskTimeLog.aggregate({ where: { userId: user.id, date, taskId: { not: task.id }, task: { companyId: me.companyId, deletedAt: null } }, _sum: { hours: true } });
      if (Number(others._sum.hours ?? 0) + hours > 24) throw new BadRequestException({ message: 'Validation failed', errors: { hours: 'More than 24 hours on one day' } });
      const target = Math.round((hours - billedHours) * 100) / 100;
      const before = open.map((e) => ({ id: e.id, hours: Number(e.hours), billable: e.billable, note: e.note }));
      let entry: { id: string } | null = null;
      if (target <= 0) {
        if (open.length) await tx.taskTimeLog.deleteMany({ where: { id: { in: open.map((e) => e.id) } } });
      } else if (open.length) {
        const [first, ...rest] = open;
        entry = await tx.taskTimeLog.update({
          where: { id: first.id },
          data: { hours: D(target), ...(input.billable !== undefined ? { billable: input.billable } : {}), ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}), invoiceId: null },
        });
        if (rest.length) await tx.taskTimeLog.deleteMany({ where: { id: { in: rest.map((e) => e.id) } } });
      } else {
        entry = await tx.taskTimeLog.create({ data: { taskId: task.id, userId: user.id, date, hours: D(target), billable: input.billable ?? true, note: input.note?.trim() || null } });
      }
      await this.recalcSpent(task.id, tx);
      await this.audit.record('Time Entry', entry?.id ?? task.id, 'TIMESHEET', before, { task: task.code, user: user.fullName, date: input.date, hours, billable: input.billable, note: input.note }, tx);
      return { taskId: task.id, date: input.date, hours, billedHours, entryId: entry?.id ?? null };
    });
  }

  /** billable flag / note of one entry (not for invoiced hours) */
  async updateEntry(id: string, data: { billable?: boolean; note?: string | null }) {
    RequestCtx.assert('task.timesheet.read');
    const me = RequestCtx.user();
    if (!UUID.test(id)) throw new NotFoundException('Time entry not found');
    const e = await this.prisma.taskTimeLog.findFirst({ where: { id, task: { companyId: me.companyId, deletedAt: null } } });
    if (!e) throw new NotFoundException('Time entry not found');
    if (e.userId !== me.id && !this.canManage()) throw new ForbiddenException('You can only change your own time entries');
    if (e.userId === me.id) RequestCtx.assert('task.task.update');
    if ((await billedLogIds(this.prisma, [e])).size) throw new ConflictException('These hours are already invoiced');
    const after = await this.prisma.taskTimeLog.update({ where: { id }, data: { ...(data.billable !== undefined ? { billable: data.billable } : {}), ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}) } });
    await this.audit.record('Time Entry', id, 'UPDATE', e, after);
    return after;
  }
}
