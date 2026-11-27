import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { monthRange, num, seesCompany, uuid } from './insights.util';

/** HR figures behind the employee profile, org chart and leave calendar */
@Injectable()
export class HrInsightsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  private empScope(): Prisma.EmployeeWhereInput {
    return this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.EmployeeWhereInput;
  }

  async employee(id: string, month?: string) {
    const companyId = RequestCtx.companyId();
    const me = RequestCtx.user();
    const emp = await this.prisma.employee.findFirst({ where: { ...this.empScope(), id: uuid(id), deletedAt: null }, select: { id: true, userId: true, managerId: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    const self = !!emp.userId && emp.userId === me.id;
    const { start, end, key } = monthRange(month);
    const year = start.getUTCFullYear();

    const [attendance, leaveTypes, leaveUsed, leaves, payslips, tasks, assets, expenses, team, manager] = await Promise.all([
      RequestCtx.can('hris.attendance.read')
        ? this.prisma.attendance.findMany({ where: { companyId, employeeId: id, deletedAt: null, date: { gte: start, lte: end } }, orderBy: { date: 'asc' }, select: { date: true, statusCode: true, checkIn: true, checkOut: true } })
        : null,
      RequestCtx.can('hris.leave.read') ? this.prisma.leaveType.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, daysPerYear: true } }) : null,
      RequestCtx.can('hris.leave.read')
        ? this.prisma.leaveRequest.groupBy({
            by: ['leaveTypeId'],
            where: { companyId, employeeId: id, status: 'APPROVED', deletedAt: null, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
            _sum: { days: true },
          })
        : null,
      RequestCtx.can('hris.leave.read')
        ? this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: id, deletedAt: null }, orderBy: { startDate: 'desc' }, take: 15, select: { id: true, leaveTypeId: true, startDate: true, endDate: true, days: true, status: true, reason: true } })
        : null,
      RequestCtx.can('hris.payroll.read')
        ? this.prisma.payslip.findMany({
            where: { employeeId: id, payrollRun: { companyId, deletedAt: null, status: { not: 'CANCELLED' } } },
            orderBy: { payrollRun: { periodStart: 'desc' } },
            take: 12,
            select: { id: true, netPay: true, totalEarning: true, totalDeduction: true, payrollRun: { select: { id: true, number: true, periodStart: true, periodEnd: true, payDate: true, status: true } } },
          })
        : null,
      emp.userId && RequestCtx.can('task.task.read') && (self || seesCompany('task.task.manage'))
        ? this.prisma.task.findMany({
            where: { companyId, deletedAt: null, assigneeId: emp.userId, completedAt: null },
            orderBy: { dueDate: { sort: 'asc', nulls: 'last' } },
            take: 20,
            select: { id: true, code: true, title: true, dueDate: true, priorityCode: true, stageId: true },
          })
        : null,
      RequestCtx.can('accounting.asset.read')
        ? this.prisma.fixedAsset.findMany({ where: { companyId, deletedAt: null, custodianEmployeeId: id }, orderBy: { acquisitionDate: 'desc' }, select: { id: true, code: true, name: true, categoryCode: true, statusCode: true, acquisitionDate: true, cost: true } })
        : null,
      RequestCtx.can('hris.expense.read') && (self || seesCompany('hris.expense.manage'))
        ? this.prisma.expenseClaim.findMany({ where: { companyId, deletedAt: null, employeeId: id }, orderBy: { date: 'desc' }, take: 10, select: { id: true, number: true, date: true, title: true, statusCode: true, totalAmount: true } })
        : null,
      this.prisma.employee.findMany({ where: { ...this.empScope(), deletedAt: null, isActive: true, managerId: id }, orderBy: { fullName: 'asc' }, take: 50, select: { id: true, code: true, fullName: true, positionId: true } }),
      emp.managerId ? this.prisma.employee.findFirst({ where: { ...this.empScope(), id: emp.managerId, deletedAt: null }, select: { id: true, fullName: true } }) : null,
    ]);

    const summary: Record<string, number> = {};
    for (const a of attendance ?? []) if (a.statusCode) summary[a.statusCode] = (summary[a.statusCode] ?? 0) + 1;
    const used = new Map((leaveUsed ?? []).map((x) => [x.leaveTypeId, num(x._sum.days)]));
    const typeName = new Map((leaveTypes ?? []).map((t) => [t.id, t.name]));
    const stageIds = [...new Set((tasks ?? []).map((t) => t.stageId))];
    const stages = new Map((await this.prisma.taskStage.findMany({ where: { companyId, id: { in: stageIds } }, select: { id: true, name: true, color: true } })).map((s) => [s.id, s]));
    const positions = new Map((await this.prisma.position.findMany({ where: { companyId, id: { in: team.map((t) => t.positionId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));

    return {
      month: key,
      attendance: attendance ? { summary, days: attendance } : null,
      leave: leaveTypes
        ? {
            year,
            balance: leaveTypes.map((t) => ({ leaveTypeId: t.id, name: t.name, entitlement: t.daysPerYear, used: used.get(t.id) ?? 0, remaining: t.daysPerYear ? t.daysPerYear - (used.get(t.id) ?? 0) : null })),
            requests: (leaves ?? []).map((l) => ({ ...l, days: num(l.days), leaveType: typeName.get(l.leaveTypeId) ?? '-' })),
          }
        : null,
      payslips: payslips?.map((p) => ({ id: p.id, runId: p.payrollRun.id, number: p.payrollRun.number, periodStart: p.payrollRun.periodStart, periodEnd: p.payrollRun.periodEnd, payDate: p.payrollRun.payDate, status: p.payrollRun.status, netPay: num(p.netPay), earnings: num(p.totalEarning), deductions: num(p.totalDeduction) })) ?? null,
      tasks: tasks?.map((t) => ({ ...t, stage: stages.get(t.stageId) ?? null })) ?? null,
      assets: assets?.map((a) => ({ ...a, cost: num(a.cost) })) ?? null,
      expenses: expenses?.map((e) => ({ ...e, totalAmount: num(e.totalAmount) })) ?? null,
      team: team.map((t) => ({ id: t.id, code: t.code, fullName: t.fullName, position: t.positionId ? positions.get(t.positionId) ?? null : null })),
      manager,
    };
  }

  /** Departments with head count (org chart) */
  async departments() {
    const companyId = RequestCtx.companyId();
    const [deps, counts, members] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, parentId: true, managerId: true, isActive: true } }),
      RequestCtx.can('hris.employee.read') ? this.prisma.employee.groupBy({ by: ['departmentId'], where: { ...this.empScope(), deletedAt: null, isActive: true }, _count: { _all: true } }) : null,
      RequestCtx.can('hris.employee.read')
        ? this.prisma.employee.findMany({ where: { ...this.empScope(), deletedAt: null, isActive: true, departmentId: { not: null } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, departmentId: true, positionId: true } })
        : null,
    ]);
    const c = new Map((counts ?? []).map((x) => [x.departmentId, x._count._all]));
    const posIds = [...new Set((members ?? []).map((m) => m.positionId).filter((x): x is string => !!x))];
    const managerIds = [...new Set(deps.map((d) => d.managerId).filter((x): x is string => !!x))];
    const [positions, managers] = await Promise.all([
      this.prisma.position.findMany({ where: { companyId, id: { in: posIds } }, select: { id: true, name: true } }),
      RequestCtx.can('hris.employee.read') && managerIds.length ? this.prisma.employee.findMany({ where: { companyId, id: { in: managerIds }, deletedAt: null }, select: { id: true, fullName: true } }) : [],
    ]);
    const pos = new Map(positions.map((p) => [p.id, p.name]));
    const head = new Map(managers.map((m) => [m.id, m]));
    return {
      headcount: counts !== null,
      unassigned: c.get(null) ?? 0,
      departments: deps.map((d) => ({
        ...d,
        headcount: counts ? c.get(d.id) ?? 0 : null,
        manager: d.managerId ? (head.get(d.managerId) ?? null) : null,
        members: (members ?? []).filter((m) => m.departmentId === d.id).slice(0, 8).map((m) => ({ id: m.id, fullName: m.fullName, position: m.positionId ? pos.get(m.positionId) ?? null : null })),
      })),
    };
  }

  /** Leave requests overlapping a month (calendar) */
  async leaveCalendar(month?: string, status?: string) {
    const companyId = RequestCtx.companyId();
    const { start, end, key } = monthRange(month);
    const statuses = status === 'APPROVED' ? ['APPROVED'] : status === 'PENDING' ? ['PENDING'] : ['PENDING', 'APPROVED'];
    const rows = await this.prisma.leaveRequest.findMany({
      where: { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.LeaveRequestWhereInput), deletedAt: null, status: { in: statuses as any }, startDate: { lte: end }, endDate: { gte: start } },
      orderBy: { startDate: 'asc' },
      take: 500,
      select: { id: true, employeeId: true, leaveTypeId: true, startDate: true, endDate: true, days: true, status: true, reason: true },
    });
    const [emps, types] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, fullName: true, code: true, departmentId: true } }),
      this.prisma.leaveType.findMany({ where: { companyId, id: { in: [...new Set(rows.map((r) => r.leaveTypeId))] } }, select: { id: true, name: true, isPaid: true } }),
    ]);
    const e = new Map(emps.map((x) => [x.id, x]));
    const t = new Map(types.map((x) => [x.id, x]));
    return {
      month: key,
      items: rows.map((r) => ({ ...r, days: num(r.days), employee: e.get(r.employeeId)?.fullName ?? '-', employeeCode: e.get(r.employeeId)?.code ?? '', leaveType: t.get(r.leaveTypeId)?.name ?? '-' })),
    };
  }
}
