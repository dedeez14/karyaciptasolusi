import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, sum } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { PrintableDocument, PdfService } from '../print/pdf.service';
import { SettingsService } from '../../common/settings/settings.service';

interface SlipLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
  accountId: string | null;
}

@Injectable()
export class HrisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly journal: JournalService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ leave workflow
  async decideLeave(id: string, decision: 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    RequestCtx.assert(decision === 'CANCELLED' ? 'hris.leave.update' : 'hris.leave.approve');
    const u = RequestCtx.user();
    const before = await this.prisma.leaveRequest.findFirst({ where: { id, ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), deletedAt: null } });
    if (!before) throw new NotFoundException('Leave request not found');
    if (before.status !== 'PENDING' && !(decision === 'CANCELLED' && before.status === 'APPROVED')) throw new ConflictException(`Leave request is already ${before.status.toLowerCase()}`);
    const emp = await this.prisma.employee.findUnique({ where: { id: before.employeeId }, select: { userId: true } });
    if (decision === 'APPROVED' && emp?.userId === u.id && !u.isSuperAdmin) throw new ConflictException('You cannot approve your own leave request');
    const after = await this.prisma.leaveRequest.update({ where: { id }, data: { status: decision, approvedById: u.id, approvedAt: new Date(), updatedById: u.id } });
    await this.audit.record('Leave Request', id, decision, before, after);
    return after;
  }

  /** Remaining leave per type for an employee in a year */
  async leaveBalance(employeeId: string, year: number) {
    RequestCtx.assert('hris.leave.read');
    const companyId = RequestCtx.companyId();
    const [types, used] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.leaveRequest.groupBy({
        by: ['leaveTypeId'],
        where: { companyId, employeeId, status: 'APPROVED', deletedAt: null, startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
        _sum: { days: true },
      }),
    ]);
    const u = new Map(used.map((x) => [x.leaveTypeId, Number(x._sum.days ?? 0)]));
    return types.map((t) => ({ leaveTypeId: t.id, name: t.name, entitlement: t.daysPerYear, used: u.get(t.id) ?? 0, remaining: t.daysPerYear ? t.daysPerYear - (u.get(t.id) ?? 0) : null }));
  }

  // ------------------------------------------------------------------ payroll
  async listRuns(q: { page: number; pageSize: number }) {
    RequestCtx.assert('hris.payroll.read');
    const where = { ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.payrollRun.findMany({ where, orderBy: { periodStart: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { payslips: true } } } }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  async getRun(id: string) {
    RequestCtx.assert('hris.payroll.read');
    const run = await this.prisma.payrollRun.findFirst({ where: { id, ...(this.access.scopeWhere({ branchField: 'branchId' }) as any), deletedAt: null }, include: { payslips: true } });
    if (!run) throw new NotFoundException('Payroll run not found');
    const emps = await this.prisma.employee.findMany({ where: { id: { in: run.payslips.map((p) => p.employeeId) } }, select: { id: true, code: true, fullName: true, departmentId: true, positionId: true } });
    const em = new Map(emps.map((e) => [e.id, e]));
    return { ...run, payslips: run.payslips.map((p) => ({ ...p, employee: em.get(p.employeeId) })).sort((a, b) => (a.employee?.fullName ?? '').localeCompare(b.employee?.fullName ?? '')) };
  }

  /** Generates a draft payroll: base salary + company/employee components; unpaid leave deducted pro-rata */
  async generate(input: { periodStart: Date; periodEnd: Date; payDate: Date; branchId?: string | null; notes?: string | null }) {
    RequestCtx.assert('hris.payroll.create');
    const u = RequestCtx.user();
    if (input.periodEnd < input.periodStart) throw new BadRequestException('Period end must be after period start');
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: u.companyId,
        deletedAt: null,
        isActive: true,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        OR: [{ joinDate: null }, { joinDate: { lte: input.periodEnd } }],
      },
    });
    if (!employees.length) throw new BadRequestException('No active employees found for this period');
    const [components, overrides, unpaid] = await Promise.all([
      this.prisma.salaryComponent.findMany({ where: { companyId: u.companyId, isActive: true, deletedAt: null } }),
      this.prisma.employeeSalaryComponent.findMany({ where: { companyId: u.companyId, deletedAt: null, employeeId: { in: employees.map((e) => e.id) } } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: u.companyId, status: 'APPROVED', deletedAt: null, startDate: { lte: input.periodEnd }, endDate: { gte: input.periodStart }, employeeId: { in: employees.map((e) => e.id) } },
      }),
    ]);
    const unpaidTypes = new Set((await this.prisma.leaveType.findMany({ where: { companyId: u.companyId, isPaid: false } })).map((t) => t.id));
    const workDays = await this.settings.num('hris.workingDaysPerMonth', u.companyId, 22);
    const assignedOnly = await this.settings.bool('hris.assignedComponentsOnly', u.companyId, false);

    const slips = employees.map((e) => {
      const base = D(e.baseSalary);
      const lines: SlipLine[] = [];
      for (const c of components) {
        const ov = overrides.find((o) => o.employeeId === e.id && o.componentId === c.id);
        if (assignedOnly && !ov) continue;
        const value = ov ? D(ov.amount) : D(c.amount);
        const amount = round(c.calcType === 'PERCENT_BASE' ? base.times(value).div(100) : value);
        if (amount.isZero()) continue;
        lines.push({ code: c.code, name: c.name, kind: c.kind as SlipLine['kind'], amount: amount.toString(), accountId: c.accountId });
      }
      const unpaidDays = unpaid.filter((l) => l.employeeId === e.id && unpaidTypes.has(l.leaveTypeId)).reduce((a, l) => a + Number(l.days), 0);
      if (unpaidDays > 0) lines.push({ code: 'UNPAID_LEAVE', name: `Unpaid leave (${unpaidDays} days)`, kind: 'DEDUCTION', amount: round(base.div(workDays).times(unpaidDays)).toString(), accountId: null });
      const earn = sum(lines.filter((l) => l.kind === 'EARNING').map((l) => D(l.amount)));
      const ded = sum(lines.filter((l) => l.kind === 'DEDUCTION').map((l) => D(l.amount)));
      return { employeeId: e.id, baseSalary: base, totalEarning: base.plus(earn), totalDeduction: ded, netPay: base.plus(earn).minus(ded), lines: lines as unknown as Prisma.InputJsonValue };
    });
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          companyId: u.companyId,
          branchId: input.branchId ?? null,
          number: await this.sequence.next('PAYROLL', u.companyId, input.periodStart, tx),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payDate: input.payDate,
          notes: input.notes,
          totalGross: sum(slips.map((s) => s.totalEarning)),
          totalDeduction: sum(slips.map((s) => s.totalDeduction)),
          totalNet: sum(slips.map((s) => s.netPay)),
          createdById: u.id,
          payslips: { create: slips },
        },
      });
      await this.audit.record('Payroll Run', run.id, 'CREATE', undefined, run, tx);
      return run;
    });
  }

  /** Confirms payroll and posts: Dr salary expense / Cr salaries payable & deductions payable */
  async confirmRun(id: string) {
    RequestCtx.assert('hris.payroll.confirm');
    const run = await this.getRun(id);
    if (run.status !== 'DRAFT') throw new ConflictException('Payroll is already confirmed');
    return this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [];
      for (const s of run.payslips) {
        j.push({ key: 'SALARY_EXPENSE', debit: D(s.baseSalary), description: 'Base salary' });
        for (const l of s.lines as unknown as SlipLine[]) {
          if (l.kind === 'EARNING') j.push({ accountId: l.accountId, key: l.accountId ? undefined : 'SALARY_EXPENSE', debit: D(l.amount), description: l.name });
          else if (l.code === 'UNPAID_LEAVE') j.push({ key: 'SALARY_EXPENSE', credit: D(l.amount), description: l.name });
          else j.push({ accountId: l.accountId, key: l.accountId ? undefined : 'PAYROLL_DEDUCTION', credit: D(l.amount), description: l.name });
        }
      }
      j.push({ key: 'SALARY_PAYABLE', credit: D(run.totalNet), description: `Net salaries ${run.number}` });
      const entry = await this.journal.post(tx, { companyId: run.companyId, branchId: run.branchId, date: run.payDate, description: `Payroll ${run.number}`, sourceType: 'PAYROLL', sourceId: run.id, lines: j });
      const r = await tx.payrollRun.update({ where: { id }, data: { status: 'CONFIRMED', journalEntryId: entry?.id, updatedById: RequestCtx.user().id } });
      await this.audit.record('Payroll Run', id, 'CONFIRM', run, r, tx);
      return r;
    });
  }

  async cancelRun(id: string) {
    RequestCtx.assert('hris.payroll.confirm');
    const run = await this.getRun(id);
    if (run.status === 'CANCELLED') throw new ConflictException('Payroll is already cancelled');
    return this.prisma.$transaction(async (tx) => {
      if (run.status !== 'DRAFT') await this.journal.voidBySource(tx, 'PAYROLL', id);
      const r = await tx.payrollRun.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
      await this.audit.record('Payroll Run', id, 'CANCEL', run, r, tx);
      return r;
    });
  }

  async payslipDoc(runId: string, payslipId: string): Promise<{ doc: PrintableDocument; name: string }> {
    RequestCtx.assert('hris.payroll.read');
    const run = await this.getRun(runId);
    const slip = run.payslips.find((p) => p.id === payslipId);
    if (!slip) throw new NotFoundException('Payslip not found');
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: slip.employeeId } });
    const [dept, pos] = await Promise.all([
      emp.departmentId ? this.prisma.department.findUnique({ where: { id: emp.departmentId } }) : null,
      emp.positionId ? this.prisma.position.findUnique({ where: { id: emp.positionId } }) : null,
    ]);
    const m = (v: unknown) => this.pdf.money(v);
    const lines = slip.lines as unknown as SlipLine[];
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return {
      name: `Payslip_${emp.code}_${run.number}.pdf`,
      doc: {
        title: 'Payslip',
        number: run.number,
        parties: [{ label: 'Employee', name: emp.fullName, lines: [`ID: ${emp.code}`, dept ? `Department: ${dept.name}` : '', pos ? `Position: ${pos.name}` : ''].filter(Boolean) }],
        meta: [
          { label: 'Period', value: `${fmt(run.periodStart)} - ${fmt(run.periodEnd)}` },
          { label: 'Pay Date', value: fmt(run.payDate) },
        ],
        columns: [
          { key: 'name', label: 'Component', width: 4 },
          { key: 'earning', label: 'Earning', width: 1.5, align: 'right' },
          { key: 'deduction', label: 'Deduction', width: 1.5, align: 'right' },
        ],
        rows: [
          { name: 'Base Salary', earning: m(slip.baseSalary), deduction: '' },
          ...lines.map((l) => ({ name: l.name, earning: l.kind === 'EARNING' ? m(l.amount) : '', deduction: l.kind === 'DEDUCTION' ? m(l.amount) : '' })),
        ],
        totals: [
          { label: 'Total Earnings', value: m(slip.totalEarning) },
          { label: 'Total Deductions', value: m(slip.totalDeduction) },
          { label: 'Net Pay', value: m(slip.netPay), bold: true },
        ],
        amount: { value: Number(slip.netPay), currency: 'IDR' },
        notes: 'This payslip is confidential.',
        signatures: ['HR Department', 'Employee'],
        // salary is never put into the (readable) signed payload
        verify: { k: 'PAYSLIP', id: slip.id, n: `${run.number}/${emp.code}`, d: run.payDate.toISOString().slice(0, 10), a: null, cur: null },
      },
    };
  }

  // ------------------------------------------------------------------ self service attendance
  private async myEmployee() {
    const u = RequestCtx.user();
    const emp = await this.prisma.employee.findFirst({ where: { userId: u.id, companyId: u.companyId, deletedAt: null, isActive: true } });
    if (!emp) throw new BadRequestException('Your user account is not linked to an employee. Ask HR to set "User Account" on your employee record.');
    return emp;
  }

  private async localNow(companyId: string) {
    const tz = await this.settings.str('general.timezone', companyId, 'Asia/Jakarta');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  }

  async myAttendance() {
    const u = RequestCtx.user();
    const emp = await this.prisma.employee.findFirst({ where: { userId: u.id, companyId: u.companyId, deletedAt: null }, select: { id: true, code: true, fullName: true } });
    if (!emp) return { employee: null, today: null, recent: [] };
    const now = await this.localNow(u.companyId);
    const [today, recent] = await Promise.all([
      this.prisma.attendance.findFirst({ where: { employeeId: emp.id, date: new Date(now.date), deletedAt: null } }),
      this.prisma.attendance.findMany({ where: { employeeId: emp.id, deletedAt: null }, orderBy: { date: 'desc' }, take: 7 }),
    ]);
    return { employee: emp, today, recent, workStartTime: await this.settings.str('hris.workStartTime', u.companyId, '09:00') };
  }

  async checkIn() {
    const u = RequestCtx.user();
    const emp = await this.myEmployee();
    const now = await this.localNow(u.companyId);
    const existing = await this.prisma.attendance.findFirst({ where: { employeeId: emp.id, date: new Date(now.date) } });
    if (existing?.checkIn) throw new ConflictException('You have already checked in today');
    const [h, m] = (await this.settings.str('hris.workStartTime', u.companyId, '09:00')).split(':').map(Number);
    const grace = await this.settings.num('hris.lateGraceMinutes', u.companyId, 15);
    const late = now.minutes > (h || 9) * 60 + (m || 0) + grace;
    const status = (await this.prisma.lookupValue.findFirst({ where: { category: 'ATTENDANCE_STATUS', code: late ? 'LATE' : 'PRESENT' } }))?.code ?? null;
    const data = { checkIn: new Date(), statusCode: status, updatedById: u.id };
    const row = existing
      ? await this.prisma.attendance.update({ where: { id: existing.id }, data })
      : await this.prisma.attendance.create({ data: { ...data, companyId: u.companyId, branchId: emp.branchId ?? u.branchId, employeeId: emp.id, date: new Date(now.date), createdById: u.id } });
    await this.audit.record('Attendance', row.id, 'CHECK_IN', undefined, row);
    return row;
  }

  async checkOut() {
    const u = RequestCtx.user();
    const emp = await this.myEmployee();
    const now = await this.localNow(u.companyId);
    const existing = await this.prisma.attendance.findFirst({ where: { employeeId: emp.id, date: new Date(now.date), deletedAt: null } });
    if (!existing?.checkIn) throw new ConflictException('Check in first');
    if (existing.checkOut) throw new ConflictException('You have already checked out today');
    const row = await this.prisma.attendance.update({ where: { id: existing.id }, data: { checkOut: new Date(), updatedById: u.id } });
    await this.audit.record('Attendance', row.id, 'CHECK_OUT', existing, row);
    return row;
  }
}
