import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';

export interface MonthQuery {
  month: string;
  departmentId?: string;
  branchId?: string;
  search?: string;
}

export interface CellInput {
  employeeId: string;
  date: string;
  statusCode?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  notes?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Monthly attendance sheet: one row per employee, one column per day, with holidays, weekends,
 * approved leave and per-status totals. Times are shown and entered in the company timezone.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
  ) {}

  private parseMonth(month: string) {
    const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
    if (!m) throw new BadRequestException('Month must be YYYY-MM');
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || y < 2000 || y > 2100) throw new BadRequestException('Invalid month');
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const end = new Date(Date.UTC(y, mo, 0));
    return { y, mo, start, end, days: end.getUTCDate() };
  }

  private async tz(companyId: string) {
    return this.settings.str('general.timezone', companyId, 'Asia/Jakarta');
  }

  /** 'HH:mm' of an instant in the company timezone */
  private hhmm(d: Date | null, tz: string) {
    if (!d) return null;
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }

  /** local date + 'HH:mm' in the company timezone -> UTC instant */
  private toInstant(date: string, time: string, tz: string): Date {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, p.value]),
    );
    const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    return new Date(guess - (asLocal - guess));
  }

  private async today(companyId: string) {
    const tz = await this.tz(companyId);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  private async workDays(companyId: string): Promise<Set<number>> {
    const raw = await this.settings.str('hris.workDays', companyId, '1,2,3,4,5');
    const days = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 7);
    return new Set(days.length ? days : [1, 2, 3, 4, 5]);
  }

  private employeeWhere(q: Partial<MonthQuery>) {
    const where: Record<string, unknown> = { ...this.access.scopeWhere({ branchField: 'branchId' }), deletedAt: null };
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.branchId) where.branchId = q.branchId;
    if (q.search?.trim()) {
      const s = q.search.trim().slice(0, 100);
      where.OR = [{ fullName: { contains: s, mode: 'insensitive' } }, { code: { contains: s, mode: 'insensitive' } }];
    }
    return where;
  }

  async month(q: MonthQuery) {
    RequestCtx.assert('hris.attendance.read');
    const companyId = RequestCtx.companyId();
    const { start, end, days: count } = this.parseMonth(q.month);
    const tz = await this.tz(companyId);
    const today = await this.today(companyId);
    const workDays = await this.workDays(companyId);

    const where = this.employeeWhere(q);
    // employed during the month (inactive employees are kept for months they worked)
    where.AND = [{ OR: [{ joinDate: null }, { joinDate: { lte: end } }] }, { OR: [{ endDate: null }, { endDate: { gte: start } }] }, { OR: [{ isActive: true }, { endDate: { gte: start } }] }];
    const employees = await this.prisma.employee.findMany({
      where,
      select: { id: true, code: true, fullName: true, departmentId: true, positionId: true, joinDate: true, endDate: true },
      orderBy: [{ fullName: 'asc' }],
      take: 1000,
    });
    const ids = employees.map((e) => e.id);
    const [records, leaves, holidays, departments, positions, statuses] = await Promise.all([
      this.prisma.attendance.findMany({ where: { companyId, employeeId: { in: ids }, date: { gte: start, lte: end }, deletedAt: null } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId, employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start }, deletedAt: null },
        select: { employeeId: true, startDate: true, endDate: true, leaveTypeId: true },
      }),
      this.prisma.holiday.findMany({ where: { companyId, date: { gte: start, lte: end }, isActive: true, deletedAt: null }, select: { date: true, name: true, isCollectiveLeave: true } }),
      this.prisma.department.findMany({ where: { id: { in: employees.map((e) => e.departmentId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.position.findMany({ where: { id: { in: employees.map((e) => e.positionId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      this.prisma.lookupValue.findMany({ where: { category: 'ATTENDANCE_STATUS', isActive: true, deletedAt: null, OR: [{ companyId }, { companyId: null }] }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { code: true, name: true, color: true } }),
    ]);
    const leaveTypes = await this.prisma.leaveType.findMany({ where: { id: { in: [...new Set(leaves.map((l) => l.leaveTypeId))] } }, select: { id: true, name: true } });
    const ltName = new Map(leaveTypes.map((t) => [t.id, t.name]));
    const dep = new Map(departments.map((d) => [d.id, d.name]));
    const pos = new Map(positions.map((p) => [p.id, p.name]));
    const hol = new Map(holidays.map((h) => [iso(h.date), h]));
    const leaveCode = statuses.find((s) => s.code === 'LEAVE')?.code ?? null;
    const statusCodes = new Set(statuses.map((s) => s.code));

    const days = Array.from({ length: count }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1));
      const date = iso(d);
      const weekday = ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday ... 7 = Sunday
      const h = hol.get(date);
      return { date, day: i + 1, weekday, workday: workDays.has(weekday) && !h, holiday: h ? h.name : null, collectiveLeave: !!h?.isCollectiveLeave, today: date === today, future: date > today };
    });
    const workingDays = days.filter((d) => d.workday).length;

    const byEmp = new Map<string, typeof records>();
    for (const r of records) (byEmp.get(r.employeeId) ?? byEmp.set(r.employeeId, []).get(r.employeeId)!).push(r);

    const summary: Record<string, number> = {};
    let missingTotal = 0;
    let pctSum = 0;
    const rows = employees.map((e) => {
      const cells: Record<string, { id?: string; status: string | null; checkIn: string | null; checkOut: string | null; notes: string | null; source: 'record' | 'leave'; leaveType?: string }> = {};
      for (const r of byEmp.get(e.id) ?? []) cells[iso(r.date)] = { id: r.id, status: r.statusCode, checkIn: this.hhmm(r.checkIn, tz), checkOut: this.hhmm(r.checkOut, tz), notes: r.notes, source: 'record' };
      for (const l of leaves.filter((x) => x.employeeId === e.id)) {
        for (const d of days) {
          if (d.date >= iso(l.startDate) && d.date <= iso(l.endDate) && !cells[d.date] && d.workday) cells[d.date] = { status: leaveCode, checkIn: null, checkOut: null, notes: null, source: 'leave', leaveType: ltName.get(l.leaveTypeId) };
        }
      }
      const employed = (date: string) => (!e.joinDate || date >= iso(e.joinDate)) && (!e.endDate || date <= iso(e.endDate));
      const totals: Record<string, number> = {};
      let missing = 0;
      let expected = 0;
      for (const d of days) {
        const c = cells[d.date];
        if (c?.status) totals[c.status] = (totals[c.status] ?? 0) + 1;
        if (d.workday && !d.future && employed(d.date)) {
          expected++;
          if (!c?.status) missing++;
        }
      }
      for (const [k, v] of Object.entries(totals)) summary[k] = (summary[k] ?? 0) + v;
      const attended = ['PRESENT', 'LATE', 'WFH'].filter((s) => statusCodes.has(s)).reduce((a, s) => a + (totals[s] ?? 0), 0);
      const pct = expected ? Math.round((attended / expected) * 1000) / 10 : null;
      if (pct !== null) pctSum += pct;
      missingTotal += missing;
      return {
        id: e.id,
        code: e.code,
        fullName: e.fullName,
        department: e.departmentId ? (dep.get(e.departmentId) ?? null) : null,
        position: e.positionId ? (pos.get(e.positionId) ?? null) : null,
        joinDate: e.joinDate ? iso(e.joinDate) : null,
        endDate: e.endDate ? iso(e.endDate) : null,
        cells,
        totals,
        missing,
        expected,
        pct,
      };
    });
    const withPct = rows.filter((r) => r.pct !== null).length;
    return {
      month: q.month,
      timezone: tz,
      days,
      workingDays,
      statuses,
      employees: rows,
      summary: { byStatus: summary, missing: missingTotal, avgPct: withPct ? Math.round((pctSum / withPct) * 10) / 10 : null, employees: rows.length },
      can: { create: RequestCtx.can('hris.attendance.create'), update: RequestCtx.can('hris.attendance.update'), delete: RequestCtx.can('hris.attendance.delete'), export: RequestCtx.can('hris.attendance.export') },
    };
  }

  private async assertEmployee(id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, ...this.access.scopeWhere({ branchField: 'branchId' }), deletedAt: null }, select: { id: true, branchId: true } });
    if (!e) throw new NotFoundException('Employee not found');
    return e;
  }

  private async assertStatus(code: string, companyId: string) {
    const ok = await this.prisma.lookupValue.findFirst({ where: { category: 'ATTENDANCE_STATUS', code, isActive: true, deletedAt: null, OR: [{ companyId }, { companyId: null }] }, select: { id: true } });
    if (!ok) throw new BadRequestException('Unknown attendance status');
  }

  /** Create, update or clear (no status) one day of one employee */
  async setCell(input: CellInput) {
    const u = RequestCtx.user();
    const companyId = u.companyId;
    if (!ISO_DATE.test(input.date ?? '')) throw new BadRequestException('Invalid date');
    for (const t of [input.checkIn, input.checkOut]) if (t && !HHMM.test(t)) throw new BadRequestException('Times must be HH:MM');
    if (input.checkIn && input.checkOut && input.checkOut < input.checkIn) throw new BadRequestException('Check-out must be after check-in');
    const emp = await this.assertEmployee(input.employeeId);
    const date = new Date(input.date);
    const existing = await this.prisma.attendance.findFirst({ where: { employeeId: emp.id, date } });
    const tz = await this.tz(companyId);
    const notes = input.notes?.trim().slice(0, 2000) || null;

    if (!input.statusCode) {
      if (!existing || existing.deletedAt) return { cleared: true };
      RequestCtx.assert('hris.attendance.delete');
      await this.prisma.attendance.update({ where: { id: existing.id }, data: { deletedAt: new Date(), updatedById: u.id } });
      await this.audit.record('Attendance', existing.id, 'DELETE', existing, undefined);
      return { cleared: true };
    }
    await this.assertStatus(input.statusCode, companyId);
    const data = {
      statusCode: input.statusCode,
      checkIn: input.checkIn ? this.toInstant(input.date, input.checkIn, tz) : null,
      checkOut: input.checkOut ? this.toInstant(input.date, input.checkOut, tz) : null,
      notes,
      updatedById: u.id,
    };
    if (existing) {
      RequestCtx.assert('hris.attendance.update');
      const after = await this.prisma.attendance.update({ where: { id: existing.id }, data: { ...data, deletedAt: null } });
      await this.audit.record('Attendance', existing.id, 'UPDATE', existing, after);
      return { id: after.id };
    }
    RequestCtx.assert('hris.attendance.create');
    const created = await this.prisma.attendance.create({ data: { ...data, companyId, branchId: emp.branchId, employeeId: emp.id, date, createdById: u.id } });
    await this.audit.record('Attendance', created.id, 'CREATE', undefined, created);
    return { id: created.id };
  }

  /** Same status for many employees x days (e.g. mark everybody WFH on a day). Existing records are kept unless overwrite. */
  async bulk(input: { employeeIds: string[]; dates: string[]; statusCode: string; overwrite?: boolean }) {
    RequestCtx.assert('hris.attendance.create');
    const u = RequestCtx.user();
    const employeeIds = [...new Set(input.employeeIds ?? [])].slice(0, 1000);
    const dates = [...new Set(input.dates ?? [])].filter((d) => ISO_DATE.test(d)).slice(0, 31);
    if (!employeeIds.length || !dates.length) throw new BadRequestException('Choose employees and days');
    if (input.overwrite) RequestCtx.assert('hris.attendance.update');
    await this.assertStatus(input.statusCode, u.companyId);
    const emps = await this.prisma.employee.findMany({ where: { id: { in: employeeIds }, ...this.access.scopeWhere({ branchField: 'branchId' }), deletedAt: null }, select: { id: true, branchId: true } });
    let created = 0;
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const e of emps) {
        for (const d of dates) {
          const date = new Date(d);
          const ex = await tx.attendance.findFirst({ where: { employeeId: e.id, date } });
          if (ex && !ex.deletedAt) {
            if (!input.overwrite) continue;
            await tx.attendance.update({ where: { id: ex.id }, data: { statusCode: input.statusCode, updatedById: u.id } });
            updated++;
          } else if (ex) {
            await tx.attendance.update({ where: { id: ex.id }, data: { statusCode: input.statusCode, checkIn: null, checkOut: null, notes: null, deletedAt: null, updatedById: u.id } });
            created++;
          } else {
            await tx.attendance.create({ data: { companyId: u.companyId, branchId: e.branchId, employeeId: e.id, date, statusCode: input.statusCode, createdById: u.id, updatedById: u.id } });
            created++;
          }
        }
      }
      await this.audit.record('Attendance', null, 'BULK_SET', undefined, { status: input.statusCode, employees: emps.length, dates, created, updated }, tx);
    });
    return { created, updated };
  }

  /** Excel / CSV sheet of the month (same layout as the screen) */
  async exportTable(q: MonthQuery) {
    RequestCtx.assert('hris.attendance.export');
    const m = await this.month(q);
    const label = new Map(m.statuses.map((s) => [s.code, s.name]));
    // same short codes as the screen: initials of the status name, unique within the list
    const short = new Map<string, string>();
    const used = new Set<string>();
    for (const s of m.statuses) {
      const words = s.name.split(/[\s/-]+/).filter(Boolean);
      let a = (words.length > 1 ? words.map((w) => w[0]).join('') : s.name.slice(0, 1)).toUpperCase().slice(0, 3);
      if (used.has(a)) a = s.code.slice(0, 2).toUpperCase();
      used.add(a);
      short.set(s.code, a);
    }
    const abbr = (code: string | null) => (code ? (short.get(code) ?? code.slice(0, 2)) : '');
    const columns = [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Employee' },
      { key: 'department', label: 'Department' },
      ...m.days.map((d) => ({ key: d.date, label: `${d.day}${d.holiday ? ' (H)' : !d.workday ? ' (-)' : ''}` })),
      ...m.statuses.map((s) => ({ key: `t_${s.code}`, label: s.name, type: 'integer' })),
      { key: 'missing', label: 'No record', type: 'integer' },
      { key: 'pct', label: 'Attendance %', type: 'number' },
    ];
    const rows = m.employees.map((e) => ({
      code: e.code,
      name: e.fullName,
      department: e.department ?? '',
      ...Object.fromEntries(m.days.map((d) => [d.date, abbr(e.cells[d.date]?.status ?? null)])),
      ...Object.fromEntries(m.statuses.map((s) => [`t_${s.code}`, e.totals[s.code] ?? 0])),
      missing: e.missing,
      pct: e.pct ?? '',
    }));
    const legend = m.statuses.map((s) => `${abbr(s.code)} = ${label.get(s.code)}`).join(', ');
    return { title: `Attendance ${m.month}`, subtitle: `${m.workingDays} working days. ${legend}. (H) = holiday, (-) = day off`, columns, rows };
  }
}
