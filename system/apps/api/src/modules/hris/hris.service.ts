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
import { CryptoService } from '../../common/crypto/crypto.service';
import type { ExportTable } from '../../common/export/export.service';
import { annualPph21, bpjs, monthlyPph21, severance, StatutoryRates, terCategory, TERMINATION_REASONS, thrAmount } from './payroll-statutory';

interface SlipLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
  accountId: string | null;
  /** posting key for statutory lines (PPH21_PAYABLE, BPJS_PAYABLE) */
  key?: string;
}

/** stored per payslip: how PPh 21 and BPJS were worked out (also read by the obligations calendar and reports) */
export interface SlipStatutory {
  category: 'A' | 'B' | 'C';
  ptkp: string;
  terRate: number;
  /** taxable gross of the month (incl. company JKK, JKM, BPJS Kesehatan) */
  bruto: number;
  pph21: number;
  method: 'TER' | 'ANNUAL';
  annual?: ReturnType<typeof annualPph21>;
  /** employee's JHT + JP (deductible for PPh 21) */
  pension: number;
  bpjs: { kes: number; tk: number; employee: Record<string, number>; company: Record<string, number>; bases: Record<string, number> };
  hasNpwp: boolean;
  grossUp: boolean;
  warnings: string[];
}

/** salary components replaced by the statutory calculation (old manual entries) */
const STATUTORY_CODES = new Set(['BPJS_TK', 'BPJS_KES', 'PPH21']);

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
    private readonly crypto: CryptoService,
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

  private async statutoryRates(companyId: string): Promise<StatutoryRates> {
    const n = (k: string, d: number) => this.settings.num(`payroll.${k}`, companyId, d);
    return {
      kesCompany: await n('bpjsKesCompany', 4),
      kesEmployee: await n('bpjsKesEmployee', 1),
      kesCap: await n('bpjsKesCap', 12_000_000),
      jhtCompany: await n('jhtCompany', 3.7),
      jhtEmployee: await n('jhtEmployee', 2),
      jpCompany: await n('jpCompany', 2),
      jpEmployee: await n('jpEmployee', 1),
      jpCap: await n('jpCap', 11_086_300),
      jkk: await n('jkk', 0.24),
      jkm: await n('jkm', 0.3),
      minimumWage: await n('minimumWage', 0),
    };
  }

  /**
   * Generates a draft payroll.
   * REGULAR: base salary + components, unpaid leave deducted pro rata, and (Settings > Payroll & BPJS) BPJS and PPh 21
   * with the TER method; December or the month an employee leaves gets the annual PPh 21 recalculation.
   * THR: the religious holiday allowance (1 month's wage after 12 months, pro rata from 1 month) with its PPh 21.
   */
  async generate(input: { periodStart: Date; periodEnd: Date; payDate: Date; branchId?: string | null; notes?: string | null; kind?: 'REGULAR' | 'THR'; holidayDate?: Date }) {
    RequestCtx.assert('hris.payroll.create');
    const u = RequestCtx.user();
    const kind = input.kind ?? 'REGULAR';
    if (input.periodEnd < input.periodStart) throw new BadRequestException('Period end must be after period start');
    if (kind === 'THR' && !input.holidayDate) throw new BadRequestException({ message: 'Validation failed', errors: { holidayDate: 'Enter the date of the religious holiday' } });
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: u.companyId,
        deletedAt: null,
        isActive: true,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        OR: [{ joinDate: null }, { joinDate: { lte: input.periodEnd } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: input.periodStart } }] }],
      },
    });
    if (!employees.length) throw new BadRequestException('No active employees found for this period');
    const ids = employees.map((e) => e.id);
    const yearStart = new Date(Date.UTC(input.periodEnd.getUTCFullYear(), 0, 1));
    const monthStart = new Date(Date.UTC(input.periodEnd.getUTCFullYear(), input.periodEnd.getUTCMonth(), 1));
    const [components, overrides, unpaid, earlier] = await Promise.all([
      this.prisma.salaryComponent.findMany({ where: { companyId: u.companyId, isActive: true, deletedAt: null } }),
      this.prisma.employeeSalaryComponent.findMany({ where: { companyId: u.companyId, deletedAt: null, employeeId: { in: ids } } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: u.companyId, status: 'APPROVED', deletedAt: null, startDate: { lte: input.periodEnd }, endDate: { gte: input.periodStart }, employeeId: { in: ids } },
      }),
      // payslips earlier this year (for the annual PPh 21) and THR already paid this month (taxed together with the salary)
      this.prisma.payslip.findMany({
        where: { employeeId: { in: ids }, payrollRun: { companyId: u.companyId, deletedAt: null, status: { not: 'CANCELLED' }, periodEnd: { gte: yearStart, lte: input.periodEnd } } },
        select: { employeeId: true, statutory: true, payrollRun: { select: { periodEnd: true, kind: true } } },
      }),
    ]);
    const unpaidTypes = new Set((await this.prisma.leaveType.findMany({ where: { companyId: u.companyId, isPaid: false } })).map((t) => t.id));
    const workDays = await this.settings.num('hris.workingDaysPerMonth', u.companyId, 22);
    const assignedOnly = await this.settings.bool('hris.assignedComponentsOnly', u.companyId, false);
    const statutoryOn = await this.settings.bool('payroll.statutory', u.companyId, true);
    const rates = await this.statutoryRates(u.companyId);
    const isLastMonth = (e: { endDate: Date | null }) => input.periodEnd.getUTCMonth() === 11 || (!!e.endDate && e.endDate <= input.periodEnd);

    const slips = employees.map((e) => {
      const base = kind === 'THR' ? D(0) : D(e.baseSalary);
      const lines: SlipLine[] = [];
      const warnings: string[] = [];
      let fixedAllowances = D(0);
      let taxableEarnings = D(0);
      for (const c of components) {
        if (statutoryOn && STATUTORY_CODES.has(c.code)) continue;
        const ov = overrides.find((o) => o.employeeId === e.id && o.componentId === c.id);
        if (assignedOnly && !ov) continue;
        const value = ov ? D(ov.amount) : D(c.amount);
        const amount = round(c.calcType === 'PERCENT_BASE' ? D(e.baseSalary).times(value).div(100) : value);
        if (amount.isZero()) continue;
        if (c.kind === 'EARNING' && c.fixedAllowance) fixedAllowances = fixedAllowances.plus(amount);
        if (kind === 'THR') continue; // a THR run pays only the THR
        if (c.kind === 'EARNING' && c.taxable) taxableEarnings = taxableEarnings.plus(amount);
        lines.push({ code: c.code, name: c.name, kind: c.kind as SlipLine['kind'], amount: amount.toString(), accountId: c.accountId });
      }
      // wage for BPJS, overtime and THR: base salary + fixed allowances (tunjangan tetap)
      const wage = Number(D(e.baseSalary).plus(fixedAllowances));
      if (rates.minimumWage && wage < rates.minimumWage && kind === 'REGULAR') warnings.push(`Wage ${Math.round(wage).toLocaleString('id-ID')} is below the minimum wage ${rates.minimumWage.toLocaleString('id-ID')} set in Settings`);

      let thr = 0;
      if (kind === 'THR') {
        const t = thrAmount(wage, e.joinDate, input.holidayDate!);
        thr = t.amount;
        if (!thr) return null; // less than 1 month of service: no THR
        lines.push({ code: 'THR', name: `THR (${t.months >= 12 ? '1 month wage' : `${t.months}/12 of the wage`})`, kind: 'EARNING', amount: String(thr), accountId: null });
      }
      if (kind === 'REGULAR') {
        const unpaidDays = unpaid.filter((l) => l.employeeId === e.id && unpaidTypes.has(l.leaveTypeId)).reduce((a, l) => a + Number(l.days), 0);
        if (unpaidDays > 0) lines.push({ code: 'UNPAID_LEAVE', name: `Unpaid leave (${unpaidDays} days)`, kind: 'DEDUCTION', amount: round(base.div(workDays).times(unpaidDays)).toString(), accountId: null });
      }

      let statutory: SlipStatutory | null = null;
      let employerCost = 0;
      if (statutoryOn) {
        const ptkp = e.ptkpCode ?? 'TK/0';
        if (!e.ptkpCode) warnings.push('No PTKP status: TK/0 assumed. Set it on the employee (Tax & BPJS).');
        const category = terCategory(ptkp);
        const hasNpwp = !!(e.taxNo || e.identityNo);
        if (!hasNpwp) warnings.push('No NPWP / NIK: PPh 21 is 20% higher');
        // BPJS only on the monthly payroll
        const b = kind === 'REGULAR' ? bpjs(wage, rates, { kes: e.bpjsKes, jht: e.bpjsJht, jp: e.bpjsJp }) : null;
        const unpaidDed = lines.filter((l) => l.code === 'UNPAID_LEAVE').reduce((a, l) => a + Number(l.amount), 0);
        // taxable gross: salary + taxable earnings (or THR) + company JKK, JKM and BPJS Kesehatan; THR already paid this month counts too
        const thrThisMonth = kind === 'REGULAR' ? earlier.filter((x) => x.employeeId === e.id && x.payrollRun.kind === 'THR' && x.payrollRun.periodEnd >= monthStart) : [];
        const thrBruto = thrThisMonth.reduce((a, x) => a + Number((x.statutory as unknown as SlipStatutory | null)?.bruto ?? 0), 0);
        const thrTax = thrThisMonth.reduce((a, x) => a + Number((x.statutory as unknown as SlipStatutory | null)?.pph21 ?? 0), 0);
        const benefits = b ? b.company.jkk + b.company.jkm + b.company.kes : 0;
        const ownBruto = Number(base) + Number(taxableEarnings) + thr - unpaidDed + benefits;
        const pension = b ? b.employee.jht + b.employee.jp : 0;

        // a THR run is taxed together with the salary of the month: tax(salary + THR) - tax(salary)
        const regularThisMonth = kind === 'THR' ? earlier.find((x) => x.employeeId === e.id && x.payrollRun.kind === 'REGULAR' && x.payrollRun.periodEnd >= monthStart) : undefined;
        const salaryBruto = kind === 'THR' ? Number((regularThisMonth?.statutory as unknown as SlipStatutory | null)?.bruto ?? wage) : 0;

        const grossUp = e.taxMethod === 'GROSS_UP';
        const taxFor = (allowance: number) => {
          const bruto = ownBruto + allowance;
          if (kind === 'THR') {
            const withThr = monthlyPph21(salaryBruto + bruto, category, hasNpwp);
            const without = monthlyPph21(salaryBruto, category, hasNpwp);
            return { bruto, rate: withThr.rate, tax: withThr.tax - without.tax, method: 'TER' as const, annual: undefined };
          }
          const prior = earlier.filter((x) => x.employeeId === e.id && x.payrollRun.periodEnd < input.periodStart);
          const st = prior.map((x) => x.statutory as unknown as SlipStatutory | null).filter((x): x is SlipStatutory => !!x && x.bruto !== undefined);
          const months = new Set(prior.filter((x) => x.payrollRun.kind === 'REGULAR' && (x.statutory as unknown as SlipStatutory | null)?.bruto !== undefined).map((x) => x.payrollRun.periodEnd.toISOString().slice(0, 7))).size + 1;
          // months employed this year: the annual recalculation needs a complete history (not the case right after go-live)
          const from = e.joinDate && e.joinDate > yearStart ? e.joinDate : yearStart;
          const employed = (input.periodEnd.getUTCFullYear() - from.getUTCFullYear()) * 12 + input.periodEnd.getUTCMonth() - from.getUTCMonth() + 1;
          if (isLastMonth(e) && months < employed) {
            warnings.push(`Annual PPh 21 recalculation skipped: only ${months} of ${employed} months of this year are in the system. TER was used; do the year-end recalculation (1721-A1) in Coretax with the full-year figures.`);
          }
          if (isLastMonth(e) && months >= employed) {
            const annual = annualPph21({
              grossYear: st.reduce((a, x) => a + Number(x.bruto), 0) + bruto + thrBruto,
              pensionYear: st.reduce((a, x) => a + Number(x.pension ?? 0), 0) + pension,
              months,
              ptkp,
              withheldBefore: st.reduce((a, x) => a + Number(x.pph21), 0) + thrTax,
              hasNpwp,
            });
            return { bruto, rate: 0, tax: annual.tax, method: 'ANNUAL' as const, annual };
          }
          const m = monthlyPph21(bruto + thrBruto, category, hasNpwp);
          return { bruto, rate: m.rate, tax: m.tax - thrTax, method: 'TER' as const, annual: undefined };
        };
        // gross-up: the company pays the tax as an allowance, which is itself taxable
        let allowance = 0;
        let t = taxFor(0);
        if (grossUp) {
          for (let i = 0; i < 30; i++) {
            const next = Math.max(0, t.tax);
            if (Math.abs(next - allowance) < 1) break;
            allowance = next;
            t = taxFor(allowance);
          }
          allowance = Math.max(0, t.tax);
          if (allowance) lines.push({ code: 'TAX_ALLOWANCE', name: 'PPh 21 allowance (gross-up)', kind: 'EARNING', amount: String(allowance), accountId: null });
        }
        if (b) {
          if (b.employee.kes) lines.push({ code: 'BPJS_KES', name: `BPJS Kesehatan ${rates.kesEmployee}%`, kind: 'DEDUCTION', amount: String(b.employee.kes), accountId: null, key: 'BPJS_PAYABLE' });
          if (b.employee.jht) lines.push({ code: 'BPJS_JHT', name: `BPJS JHT ${rates.jhtEmployee}%`, kind: 'DEDUCTION', amount: String(b.employee.jht), accountId: null, key: 'BPJS_PAYABLE' });
          if (b.employee.jp) lines.push({ code: 'BPJS_JP', name: `BPJS JP ${rates.jpEmployee}%`, kind: 'DEDUCTION', amount: String(b.employee.jp), accountId: null, key: 'BPJS_PAYABLE' });
          employerCost = b.company.kes + b.company.jht + b.company.jp + b.company.jkk + b.company.jkm;
        }
        if (t.tax > 0) lines.push({ code: 'PPH21', name: t.method === 'ANNUAL' ? 'PPh 21 (annual recalculation)' : `PPh 21 (TER ${category} ${t.rate}%)`, kind: 'DEDUCTION', amount: String(t.tax), accountId: null, key: 'PPH21_PAYABLE' });
        // over-withheld during the year: refunded with the December / final salary (PMK 168/2023 Pasal 15)
        if (t.tax < 0) lines.push({ code: 'PPH21_REFUND', name: 'PPh 21 over-withheld this year (refund)', kind: 'EARNING', amount: String(-t.tax), accountId: null, key: 'PPH21_PAYABLE' });
        statutory = {
          category,
          ptkp,
          terRate: t.rate,
          bruto: t.bruto,
          pph21: t.tax,
          method: t.method,
          ...(t.annual ? { annual: t.annual } : {}),
          pension,
          bpjs: {
            kes: b ? b.employee.kes + b.company.kes : 0,
            tk: b ? b.employee.jht + b.employee.jp + b.company.jht + b.company.jp + b.company.jkk + b.company.jkm : 0,
            employee: b ? b.employee : {},
            company: b ? b.company : {},
            bases: b ? b.bases : {},
          },
          hasNpwp,
          grossUp,
          warnings,
        };
      } else if (warnings.length) {
        statutory = null;
      }
      const earn = sum(lines.filter((l) => l.kind === 'EARNING').map((l) => D(l.amount)));
      const ded = sum(lines.filter((l) => l.kind === 'DEDUCTION').map((l) => D(l.amount)));
      return {
        employeeId: e.id,
        baseSalary: base,
        totalEarning: base.plus(earn),
        totalDeduction: ded,
        netPay: base.plus(earn).minus(ded),
        lines: lines as unknown as Prisma.InputJsonValue,
        statutory: (statutory ?? (warnings.length ? { warnings } : undefined)) as unknown as Prisma.InputJsonValue,
        employerCost: D(employerCost),
      };
    });
    const made = slips.filter(Boolean) as NonNullable<(typeof slips)[number]>[];
    if (!made.length) throw new BadRequestException(kind === 'THR' ? 'Nobody has worked at least 1 month by the holiday, so no THR is due' : 'Nothing to pay');
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          companyId: u.companyId,
          branchId: input.branchId ?? null,
          number: await this.sequence.next('PAYROLL', u.companyId, input.periodStart, tx),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payDate: input.payDate,
          kind,
          notes: input.notes ?? (kind === 'THR' ? `THR for the holiday on ${input.holidayDate!.toISOString().slice(0, 10)}` : null),
          totalGross: sum(made.map((s) => s.totalEarning)),
          totalDeduction: sum(made.map((s) => s.totalDeduction)),
          totalNet: sum(made.map((s) => s.netPay)),
          totalEmployerCost: sum(made.map((s) => s.employerCost)),
          createdById: u.id,
          payslips: { create: made },
        },
      });
      await this.audit.record('Payroll Run', run.id, 'CREATE', undefined, run, tx);
      return run;
    });
  }

  /** Estimate of what is due when employment ends (pesangon, UPMK, unused leave, PKWT compensation) */
  async severanceEstimate(input: { employeeId: string; endDate: Date; reason: string; unusedLeaveDays?: number; contract?: boolean }) {
    RequestCtx.assert('hris.employee.read');
    RequestCtx.assert('hris.employee.salary');
    const u = RequestCtx.user();
    const e = await this.prisma.employee.findFirst({ where: { id: input.employeeId, companyId: u.companyId, deletedAt: null } });
    if (!e) throw new NotFoundException('Employee not found');
    if (!e.joinDate) throw new BadRequestException('Set the join date of the employee first');
    const fixed = await this.prisma.employeeSalaryComponent.findMany({ where: { companyId: u.companyId, employeeId: e.id, deletedAt: null } });
    const comps = await this.prisma.salaryComponent.findMany({ where: { companyId: u.companyId, id: { in: fixed.map((f) => f.componentId) }, kind: 'EARNING', fixedAllowance: true, isActive: true } });
    const allowances = comps.reduce((a, c) => a + Number(fixed.find((f) => f.componentId === c.id)?.amount ?? 0), 0);
    const wage = Number(e.baseSalary) + allowances;
    const workDays = (await this.settings.str('hris.workDays', u.companyId, '1,2,3,4,5')).split(',').filter(Boolean).length;
    // unused annual leave this year when not given
    let unused = input.unusedLeaveDays;
    if (unused === undefined) {
      const bal = await this.leaveBalance(e.id, input.endDate.getUTCFullYear());
      unused = Math.max(0, bal.find((b) => /annual/i.test(b.name))?.remaining ?? 0);
    }
    const contract = input.contract ?? (e.employmentCode === 'CONTRACT' || e.employmentCode === 'PROBATION');
    const r = severance({ wage, joinDate: e.joinDate, endDate: input.endDate, reason: input.reason, contract, unusedLeaveDays: unused, workDaysPerWeek: workDays });
    return { employee: { id: e.id, code: e.code, fullName: e.fullName, joinDate: e.joinDate }, wage, unusedLeaveDays: unused, reason: TERMINATION_REASONS[input.reason]?.label ?? input.reason, ...r };
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
          // a PPh 21 refund reduces the PPh 21 payable instead of being a salary cost
          if (l.code === 'PPH21_REFUND') j.push({ key: 'PPH21_PAYABLE', debit: D(l.amount), description: l.name });
          else if (l.kind === 'EARNING') j.push({ accountId: l.accountId, key: l.accountId ? undefined : 'SALARY_EXPENSE', debit: D(l.amount), description: l.name });
          else if (l.code === 'UNPAID_LEAVE') j.push({ key: 'SALARY_EXPENSE', credit: D(l.amount), description: l.name });
          else j.push({ accountId: l.accountId, key: l.accountId ? undefined : (l.key ?? 'PAYROLL_DEDUCTION'), credit: D(l.amount), description: l.name });
        }
      }
      // company BPJS contributions: an expense of the company, paid together with the employees' share
      const employer = sum(run.payslips.map((s) => D(s.employerCost ?? 0)));
      if (employer.gt(0)) {
        j.push({ key: 'BPJS_EXPENSE', debit: employer, description: 'BPJS contributions (company share)' });
        j.push({ key: 'BPJS_PAYABLE', credit: employer, description: 'BPJS contributions (company share)' });
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
    if (run.paidAt) throw new ConflictException('Salaries of this payroll were already paid. Cancel the salary payment first.');
    return this.prisma.$transaction(async (tx) => {
      if (run.status !== 'DRAFT') await this.journal.voidBySource(tx, 'PAYROLL', id);
      const r = await tx.payrollRun.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
      await this.audit.record('Payroll Run', id, 'CANCEL', run, r, tx);
      return r;
    });
  }

  // ------------------------------------------------------------------ salary payment
  /** Pays the net salaries: Dr salaries payable / Cr the chosen cash or bank account */
  async payRun(id: string, input: { bankAccountId: string; date: Date }) {
    RequestCtx.assert('hris.payroll.pay');
    const u = RequestCtx.user();
    const run = await this.getRun(id);
    if (run.status === 'DRAFT') throw new ConflictException('Confirm the payroll before paying the salaries');
    if (run.status !== 'CONFIRMED') throw new ConflictException(`Payroll is ${run.status.toLowerCase()} and cannot be paid`);
    if (run.paidAt) throw new ConflictException('Salaries of this payroll are already paid');
    if (D(run.totalNet).lte(0)) throw new ConflictException('There is no net pay to transfer');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId, deletedAt: null, isActive: true } });
    if (!bank) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: 'Choose an active cash or bank account' } });
    if (!bank.accountId) throw new BadRequestException({ message: 'Validation failed', errors: { bankAccountId: `${bank.name} has no ledger account. Set it in Cash & Bank Accounts.` } });
    return this.prisma.$transaction(async (tx) => {
      const amount = D(run.totalNet);
      const entry = await this.journal.post(tx, {
        companyId: run.companyId,
        branchId: run.branchId,
        date: input.date,
        description: `Salary payment ${run.number}`,
        reference: run.number,
        sourceType: 'PAYROLL_PAY',
        sourceId: run.id,
        lines: [
          { key: 'SALARY_PAYABLE', debit: amount, description: `Net salaries ${run.number}` },
          { accountId: bank.accountId, credit: amount, description: `Salary transfer from ${bank.name}` },
        ],
      });
      const r = await tx.payrollRun.update({ where: { id }, data: { paidAt: input.date, paidBankAccountId: bank.id, paymentJournalId: entry?.id ?? null, updatedById: u.id } });
      await this.audit.record('Payroll Run', id, 'PAY', { paidAt: null }, { paidAt: r.paidAt, bankAccount: bank.name, amount: amount.toString(), journal: entry?.number }, tx);
      return r;
    });
  }

  /** Reverses a salary payment (voids its journal) */
  async unpayRun(id: string) {
    RequestCtx.assert('hris.payroll.pay');
    const run = await this.getRun(id);
    if (!run.paidAt) throw new ConflictException('Salaries of this payroll are not paid');
    return this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'PAYROLL_PAY', id);
      const r = await tx.payrollRun.update({ where: { id }, data: { paidAt: null, paidBankAccountId: null, paymentJournalId: null, updatedById: RequestCtx.user().id } });
      await this.audit.record('Payroll Run', id, 'UNPAY', { paidAt: run.paidAt, paymentJournalId: run.paymentJournalId }, { paidAt: null }, tx);
      return r;
    });
  }

  /** Bank transfer list of the net salaries (account numbers decrypted - permission & activity logged) */
  async transferFile(id: string, format: string): Promise<ExportTable> {
    RequestCtx.assert('hris.payroll.pay');
    const run = await this.getRun(id);
    if (run.status !== 'CONFIRMED') throw new ConflictException('Confirm the payroll before exporting the transfer file');
    const emps = await this.prisma.employee.findMany({ where: { id: { in: run.payslips.map((p) => p.employeeId) } }, select: { id: true, code: true, fullName: true, bankName: true, bankAccountNo: true } });
    const em = new Map(emps.map((e) => [e.id, e]));
    const period = run.periodStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const rows = run.payslips
      .filter((p) => D(p.netPay).gt(0))
      .map((p) => {
        const e = em.get(p.employeeId);
        const account = this.crypto.decrypt(e?.bankAccountNo ?? null) ?? '';
        return {
          code: e?.code ?? '',
          name: e?.fullName ?? '',
          bank: e?.bankName ?? '',
          account,
          amount: D(p.netPay).toNumber(),
          description: `Gaji ${period}`,
          note: !account || !e?.bankName ? 'Bank account missing' : '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const total = rows.reduce((a, r) => a + r.amount, 0);
    this.audit.activity('payroll.transfer-file', { runId: run.id, number: run.number, employees: rows.length, total, format });
    return {
      title: `Salary transfer ${run.number}`,
      subtitle: `Gaji ${period} - pay date ${run.payDate.toISOString().slice(0, 10)}`,
      columns: [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'bank', label: 'Bank' },
        { key: 'account', label: 'Account number' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'description', label: 'Description' },
        { key: 'note', label: 'Note' },
      ],
      rows,
      totals: { amount: total },
    };
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
    const locale = await this.settings.str('general.locale', RequestCtx.companyId(), 'id-ID');
    const m = (v: unknown) => this.pdf.money(v, locale);
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
          ...(run.paidAt ? [{ label: 'Paid on', value: fmt(run.paidAt) }] : []),
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
        notes: (() => {
          const st = slip.statutory as unknown as SlipStatutory | null;
          const tax = st?.category
            ? `PPh 21: PTKP ${st.ptkp}, ${st.method === 'ANNUAL' ? 'annual recalculation (Pasal 17)' : `TER category ${st.category} ${st.terRate}%`} on a taxable gross of ${m(st.bruto)}. ` +
              (Number(slip.employerCost) > 0 ? `The company also paid BPJS contributions of ${m(slip.employerCost)} for you. ` : '')
            : '';
          return `${tax}This payslip is confidential.`;
        })(),
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
