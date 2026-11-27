import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const today = () => new Date(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const mask = (v: string | null) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : null);
const YEAR = /^(\d{4})\/(\d{4})$/;
const NO_LICENCE = 'Enter a valid operating licence in Classes & Fee Types: education is PPN-exempt only from a licensed unit (PP 49/2022 Art. 16(4))';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** academic year a month falls in, e.g. 2027-01 with the year starting in July -> 2026/2027 */
export function academicYearOf(period: string, firstMonth: number) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m >= firstMonth ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

const yearSchema = z
  .string()
  .regex(YEAR, 'Write the academic year as 2026/2027')
  .refine((v) => Number(v.slice(5)) === Number(v.slice(0, 4)) + 1, 'The years follow each other');
export const configSchema = z.object({
  name: z.string().trim().min(1).max(150),
  npsn: z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .regex(/^\d{8}$/, 'NPSN has 8 digits')
      .nullable()
      .optional(),
  ),
  kind: z.enum(['FORMAL', 'NONFORMAL']),
  licenceNo: optText(80),
  licenceExpiry: optDate,
  academicYear: yearSchema,
  firstMonth: z.coerce.number().int().min(1).max(12),
  dueDay: z.coerce.number().int().min(1).max(28),
  maxGrade: z.coerce.number().int().min(1).max(12),
});
export const classSchema = z.object({ academicYear: yearSchema, grade: z.coerce.number().int().min(0).max(12), name: z.string().trim().min(1).max(30), homeroomId: optUuid });
export const feeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['ENTRY', 'MONTHLY', 'ANNUAL', 'ITEM']),
  rates: z.record(z.string().regex(/^\d{1,2}$/), z.coerce.number().min(0).max(1e12)),
  isActive: z.boolean().default(true),
});
export const studentSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sex: z.enum(['M', 'F']),
  birthDate: z.coerce.date(),
  nisn: z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .regex(/^\d{10}$/, 'NISN has 10 digits')
      .nullable()
      .optional(),
  ),
  nik: z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .regex(/^\d{16}$/, 'NIK has 16 digits')
      .nullable()
      .optional(),
  ),
  guardianName: optText(150),
  guardianPhone: optText(30),
  guardianEmail: z.preprocess((v) => (v === '' ? null : v), z.email().max(150).nullable().optional()),
  address: optText(300),
  grade: z.coerce.number().int().min(0).max(12),
  notes: optText(500),
});
export const enrolSchema = z.object({ classId: z.uuid('Choose the class'), date: z.coerce.date(), nis: optText(20), billEntry: z.boolean().default(true) });
export const leaveSchema = z.object({ date: z.coerce.date(), note: optText(300) });
export const discountSchema = z.object({ feeId: z.uuid(), pct: z.coerce.number().min(0).max(100), reason: optText(150), validTo: optDate });
export const runSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), date: z.coerce.date() });
export const itemSchema = z.object({
  date: z.coerce.date(),
  items: z
    .array(z.object({ feeId: z.uuid(), qty: z.coerce.number().positive().max(1000) }))
    .min(1)
    .max(30),
});
export const promoteSchema = z.object({ toYear: yearSchema, date: z.coerce.date(), moves: z.array(z.object({ fromClassId: z.uuid(), toClassId: optUuid })).min(1) });

type Fee = Prisma.SchoolFeeGetPayload<object>;

/**
 * School fees. Education by a unit holding a formal / nonformal education licence is a service exempt from PPN
 * (PP 49/2022 Art. 16; a PKP issues faktur code 08); education sold as one inseparable bundle with goods is not, and
 * goods sold apart (books, uniforms) carry PPN for a PKP. Students are customers so every fee is an ordinary invoice
 * paid through Sales; arrears are read from those invoices.
 */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ set-up
  private async cfg(companyId: string) {
    return (await this.prisma.schoolConfig.findUnique({ where: { companyId } })) ?? (await this.prisma.schoolConfig.create({ data: { companyId } }));
  }

  async setup() {
    RequestCtx.assert('school.read');
    const companyId = RequestCtx.companyId();
    const config = await this.cfg(companyId);
    const [classes, fees, counts] = await Promise.all([
      this.prisma.schoolClass.findMany({ where: { companyId }, orderBy: [{ academicYear: 'desc' }, { grade: 'asc' }, { name: 'asc' }] }),
      this.prisma.schoolFee.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.schoolStudent.groupBy({ by: ['classId'], where: { companyId, status: 'ACTIVE' }, _count: true }),
    ]);
    const homerooms = await this.prisma.employee.findMany({ where: { id: { in: classes.map((c) => c.homeroomId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const t = today();
    return {
      config: { ...config, licenceExpiry: iso(config.licenceExpiry), licenceValid: !!config.licenceNo && (!config.licenceExpiry || config.licenceExpiry >= t) },
      classes: classes.map((c) => ({ ...c, homeroom: homerooms.find((h) => h.id === c.homeroomId)?.fullName ?? null, students: counts.find((x) => x.classId === c.id)?._count ?? 0 })),
      fees: fees.map((f) => ({ ...f, rates: f.rates as Record<string, number> })),
    };
  }

  async saveConfig(input: z.infer<typeof configSchema>) {
    RequestCtx.assert('school.setup');
    const c = await this.cfg(RequestCtx.companyId());
    await this.prisma.schoolConfig.update({ where: { id: c.id }, data: { ...input, npsn: input.npsn ?? null, licenceNo: input.licenceNo ?? null, licenceExpiry: input.licenceExpiry ?? null } });
    await this.audit.record('School Config', c.id, 'UPDATE', null, { academicYear: input.academicYear, licence: !!input.licenceNo });
    return this.setup();
  }

  async saveClass(id: string | null, input: z.infer<typeof classSchema>) {
    RequestCtx.assert('school.setup');
    const companyId = RequestCtx.companyId();
    if (input.homeroomId && !(await this.prisma.employee.findFirst({ where: { id: input.homeroomId, companyId } }))) throw invalid({ homeroomId: 'Choose an employee' });
    if (await this.prisma.schoolClass.findFirst({ where: { companyId, academicYear: input.academicYear, name: input.name, ...(id ? { id: { not: id } } : {}) } }))
      throw invalid({ name: 'Used in this academic year' });
    const data = { ...input, homeroomId: input.homeroomId ?? null };
    if (id) {
      const cur = await this.prisma.schoolClass.findFirst({ where: { id, companyId } });
      if (!cur) throw new NotFoundException('Class not found');
      if (cur.grade !== input.grade && (await this.prisma.schoolStudent.count({ where: { classId: id, status: 'ACTIVE' } }))) throw invalid({ grade: 'The class has students' });
      await this.prisma.schoolClass.update({ where: { id }, data });
    } else await this.prisma.schoolClass.create({ data: { ...data, companyId } });
    return this.setup();
  }

  async saveFee(id: string | null, input: z.infer<typeof feeSchema>) {
    RequestCtx.assert('school.setup');
    const u = RequestCtx.user();
    if (await this.prisma.schoolFee.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } })) throw invalid({ code: 'Used by another fee' });
    const rates = Object.fromEntries(Object.entries(input.rates).filter(([, v]) => v > 0));
    if (id) {
      const cur = await this.prisma.schoolFee.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Fee not found');
      if (cur.kind !== input.kind && cur.productId && (await this.prisma.tradeDocumentLine.count({ where: { productId: cur.productId } })))
        throw invalid({ kind: 'The fee is billed already: make a new fee type' });
      await this.prisma.schoolFee.update({ where: { id }, data: { name: input.name, kind: input.kind, rates, isActive: input.isActive } });
      if (cur.productId) await this.prisma.product.update({ where: { id: cur.productId }, data: { name: input.name } });
    } else {
      const productId = await this.prisma.$transaction(async (tx) => {
        const key = input.kind === 'ENTRY' ? 'SCHOOL_ENTRY_FEES' : input.kind === 'ITEM' ? 'SALES' : 'SCHOOL_FEES';
        const acc = await this.journal.mapping(tx, u.companyId, key);
        const code = `SCH-${input.code}`;
        const ex = await tx.product.findFirst({ where: { companyId: u.companyId, code, deletedAt: null }, select: { id: true } });
        if (ex) return ex.id;
        return (
          await tx.product.create({
            data: {
              companyId: u.companyId,
              code,
              name: input.name,
              type: input.kind === 'ITEM' ? 'CONSUMABLE' : 'SERVICE',
              incomeAccountId: acc,
              isPurchasable: input.kind === 'ITEM',
              description: 'Made by the school module',
              createdById: u.id,
            },
          })
        ).id;
      });
      await this.prisma.schoolFee.create({ data: { companyId: u.companyId, code: input.code, name: input.name, kind: input.kind, rates, isActive: input.isActive, productId } });
    }
    await this.audit.record('School Fee', id ?? input.code, id ? 'UPDATE' : 'CREATE', null, { code: input.code, kind: input.kind });
    return this.setup();
  }

  // ------------------------------------------------------------------ students
  async students(q: { q?: string; status?: string; classId?: string }) {
    RequestCtx.assert('school.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.schoolStudent.findMany({
      where: {
        companyId,
        ...(q.status ? { status: q.status } : { status: { in: ['APPLICANT', 'ACTIVE'] } }),
        ...(q.classId ? { classId: q.classId } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { nis: { contains: q.q } }, { regNumber: { contains: q.q } }, { nisn: { contains: q.q } }] } : {}),
      },
      orderBy: [{ grade: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    const [classes, open] = await Promise.all([
      this.prisma.schoolClass.findMany({ where: { companyId, id: { in: rows.map((r) => r.classId).filter((x): x is string => !!x) } } }),
      this.openByStudent(
        companyId,
        rows.map((r) => r.id),
      ),
    ]);
    return rows.map((s) => ({
      id: s.id,
      regNumber: s.regNumber,
      nis: s.nis,
      nisn: s.nisn,
      name: s.name,
      sex: s.sex,
      grade: s.grade,
      status: s.status,
      class: classes.find((c) => c.id === s.classId)?.name ?? null,
      guardianName: s.guardianName,
      guardianPhone: s.guardianPhone,
      open: open.get(s.id) ?? 0,
    }));
  }

  /** open (unpaid) amount of every student's invoices */
  private async openByStudent(companyId: string, ids: string[]) {
    const bills = await this.prisma.schoolBill.findMany({ where: { companyId, studentId: { in: ids }, status: 'POSTED' }, select: { studentId: true, invoiceId: true } });
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: bills.map((b) => b.invoiceId) }, status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null },
      select: { id: true, grandTotal: true, paidAmount: true, creditedAmount: true },
    });
    const m = new Map<string, number>();
    for (const b of bills) {
      const i = inv.find((x) => x.id === b.invoiceId);
      if (i) m.set(b.studentId, r2((m.get(b.studentId) ?? 0) + n(i.grandTotal) - n(i.paidAmount)));
    }
    return m;
  }

  async student(id: string) {
    RequestCtx.assert('school.read');
    const companyId = RequestCtx.companyId();
    const s = await this.prisma.schoolStudent.findFirst({ where: { id, companyId } });
    if (!s) throw new NotFoundException('Student not found');
    const [cls, discounts, bills, fees] = await Promise.all([
      s.classId ? this.prisma.schoolClass.findUnique({ where: { id: s.classId } }) : null,
      this.prisma.schoolDiscount.findMany({ where: { studentId: id } }),
      this.prisma.schoolBill.findMany({ where: { studentId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.schoolFee.findMany({ where: { companyId } }),
    ]);
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: bills.map((b) => b.invoiceId) } },
      select: { id: true, number: true, date: true, dueDate: true, status: true, grandTotal: true, paidAmount: true },
    });
    return {
      ...s,
      nik: mask(this.crypto.decrypt(s.nik)),
      birthDate: iso(s.birthDate),
      enrolledOn: iso(s.enrolledOn),
      leftOn: iso(s.leftOn),
      class: cls ? { id: cls.id, name: cls.name, academicYear: cls.academicYear } : null,
      discounts: discounts.map((d) => ({ ...d, pct: n(d.pct), validTo: iso(d.validTo), fee: fees.find((f) => f.id === d.feeId)?.name ?? null })),
      bills: bills.map((b) => {
        const i = inv.find((x) => x.id === b.invoiceId);
        return {
          id: b.id,
          period: b.period,
          amount: n(b.amount),
          status: b.status,
          invoice: i ? { id: i.id, number: i.number, date: iso(i.date), dueDate: iso(i.dueDate), status: i.status, grandTotal: n(i.grandTotal), paidAmount: n(i.paidAmount) } : null,
        };
      }),
    };
  }

  async saveStudent(id: string | null, input: z.infer<typeof studentSchema>) {
    RequestCtx.assert('school.students');
    const u = RequestCtx.user();
    if (input.birthDate > today()) throw invalid({ birthDate: 'Born in the future' });
    if (input.nisn && (await this.prisma.schoolStudent.findFirst({ where: { companyId: u.companyId, nisn: input.nisn, ...(id ? { id: { not: id } } : {}) } })))
      throw invalid({ nisn: 'Another student has this NISN' });
    const data = {
      name: input.name,
      sex: input.sex,
      birthDate: input.birthDate,
      nisn: input.nisn ?? null,
      guardianName: input.guardianName ?? null,
      guardianPhone: input.guardianPhone ?? null,
      guardianEmail: input.guardianEmail ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ...(input.nik ? { nik: this.crypto.encrypt(input.nik) } : {}),
    };
    let s;
    if (id) {
      const cur = await this.prisma.schoolStudent.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Student not found');
      if (cur.status === 'ACTIVE' && cur.grade !== input.grade) throw invalid({ grade: 'Move the student to a class of the other grade' });
      s = await this.prisma.schoolStudent.update({ where: { id }, data: { ...data, grade: cur.status === 'APPLICANT' ? input.grade : cur.grade } });
      if (s.customerId)
        await this.prisma.customer.update({ where: { id: s.customerId }, data: { name: s.name, contactPerson: s.guardianName, phone: s.guardianPhone, email: s.guardianEmail, address: s.address } });
    } else
      s = await this.prisma.$transaction(async (tx) =>
        tx.schoolStudent.create({ data: { ...data, grade: input.grade, companyId: u.companyId, regNumber: await this.sequence.next('SCHOOL_REG', u.companyId, today(), tx) } }),
      );
    await this.audit.record('School Student', s.id, id ? 'UPDATE' : 'CREATE', null, { reg: s.regNumber });
    return this.student(s.id);
  }

  private async ownedStudent(id: string) {
    const s = await this.prisma.schoolStudent.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Student not found');
    return s;
  }

  async reject(id: string) {
    RequestCtx.assert('school.students');
    const s = await this.ownedStudent(id);
    if (s.status !== 'APPLICANT') throw new ConflictException('Only an applicant is rejected');
    await this.prisma.schoolStudent.update({ where: { id }, data: { status: 'REJECTED' } });
    return this.student(id);
  }

  private async customer(s: {
    id: string;
    companyId: string;
    customerId: string | null;
    nis: string | null;
    regNumber: string;
    name: string;
    guardianName: string | null;
    guardianPhone: string | null;
    guardianEmail: string | null;
    address: string | null;
  }) {
    if (s.customerId) return s.customerId;
    const code = `STU-${(s.nis ?? s.regNumber).replace(/[^A-Za-z0-9-]/g, '')}`.slice(0, 30);
    const c =
      (await this.prisma.customer.findFirst({ where: { companyId: s.companyId, code, deletedAt: null } })) ??
      (await this.prisma.customer.create({
        data: { companyId: s.companyId, code, name: s.name, contactPerson: s.guardianName, phone: s.guardianPhone, email: s.guardianEmail, address: s.address, notes: 'Student (school module)' },
      }));
    await this.prisma.schoolStudent.update({ where: { id: s.id }, data: { customerId: c.id } });
    return c.id;
  }

  async enrol(id: string, input: z.infer<typeof enrolSchema>) {
    RequestCtx.assert('school.students');
    const u = RequestCtx.user();
    const s = await this.ownedStudent(id);
    if (s.status !== 'APPLICANT') throw new ConflictException('Enrol an applicant');
    const cfg = await this.cfg(u.companyId);
    const cls = await this.prisma.schoolClass.findFirst({ where: { id: input.classId, companyId: u.companyId } });
    if (!cls) throw invalid({ classId: 'Choose the class' });
    if (cls.academicYear !== cfg.academicYear) throw invalid({ classId: `Choose a class of ${cfg.academicYear}` });
    if (input.nis && (await this.prisma.schoolStudent.findFirst({ where: { companyId: u.companyId, nis: input.nis } }))) throw invalid({ nis: 'Another student has this NIS' });
    if (input.billEntry) {
      const t = await this.taxes(u.companyId, input.date);
      if (t.goods && !t.edu) throw new ConflictException(NO_LICENCE);
    }
    await this.prisma.$transaction(async (tx) => {
      const nis = input.nis ?? (await this.sequence.next('SCHOOL_NIS', u.companyId, input.date, tx));
      await tx.schoolStudent.update({ where: { id }, data: { status: 'ACTIVE', classId: cls.id, grade: cls.grade, nis, enrolledOn: input.date } });
    });
    await this.audit.record('School Student', id, 'ENROL', null, { classId: cls.id });
    if (input.billEntry) {
      const fees = await this.prisma.schoolFee.findMany({ where: { companyId: u.companyId, kind: 'ENTRY', isActive: true } });
      if (fees.some((f) => n((f.rates as Record<string, number>)[String(cls.grade)]) > 0)) await this.billEntry(id, input.date);
    }
    return this.student(id);
  }

  async moveClass(id: string, classId: string) {
    RequestCtx.assert('school.students');
    const s = await this.ownedStudent(id);
    if (s.status !== 'ACTIVE') throw new ConflictException('Move an active student');
    const cur = s.classId ? await this.prisma.schoolClass.findUnique({ where: { id: s.classId } }) : null;
    const cls = await this.prisma.schoolClass.findFirst({ where: { id: classId, companyId: s.companyId } });
    if (!cls || (cur && cls.academicYear !== cur.academicYear)) throw invalid({ classId: 'Choose a class of the same academic year' });
    await this.prisma.schoolStudent.update({ where: { id }, data: { classId, grade: cls.grade } });
    await this.audit.record('School Student', id, 'MOVE', { classId: s.classId }, { classId });
    return this.student(id);
  }

  async leave(id: string, input: z.infer<typeof leaveSchema>) {
    RequestCtx.assert('school.students');
    const s = await this.ownedStudent(id);
    if (s.status !== 'ACTIVE') throw new ConflictException('Only an active student leaves');
    await this.prisma.schoolStudent.update({
      where: { id },
      data: { status: 'LEFT', leftOn: input.date, notes: input.note ? `${s.notes ? `${s.notes}\n` : ''}Left: ${input.note}`.slice(0, 500) : s.notes },
    });
    await this.audit.record('School Student', id, 'LEAVE', null, { date: iso(input.date) });
    return this.student(id);
  }

  async saveDiscount(studentId: string, input: z.infer<typeof discountSchema>, remove = false) {
    RequestCtx.assert('school.students');
    const s = await this.ownedStudent(studentId);
    if (!(await this.prisma.schoolFee.findFirst({ where: { id: input.feeId, companyId: s.companyId } }))) throw invalid({ feeId: 'Choose a fee' });
    if (remove) await this.prisma.schoolDiscount.deleteMany({ where: { studentId, feeId: input.feeId } });
    else
      await this.prisma.schoolDiscount.upsert({
        where: { studentId_feeId: { studentId, feeId: input.feeId } },
        create: { companyId: s.companyId, studentId, feeId: input.feeId, pct: D(input.pct), reason: input.reason ?? null, validTo: input.validTo ?? null },
        update: { pct: D(input.pct), reason: input.reason ?? null, validTo: input.validTo ?? null },
      });
    await this.audit.record('School Student', studentId, remove ? 'DISCOUNT_REMOVE' : 'DISCOUNT', null, { feeId: input.feeId, pct: input.pct });
    return this.student(studentId);
  }

  // ------------------------------------------------------------------ billing
  /** PPN on the fee lines: exempt education needs a valid licence (PP 49/2022 Art. 16(4)); items carry PPN for a PKP */
  private async taxes(companyId: string, date: Date) {
    if (!(await this.settings.bool('sales.vatPayer', companyId, true))) return { edu: null as string | null, goods: null as string | null, licensed: undefined as boolean | undefined };
    const cfg = await this.cfg(companyId);
    const find = async (code: string) => {
      const t = await this.prisma.tax.findFirst({ where: { companyId, code, kind: 'VAT', deletedAt: null }, select: { id: true } });
      if (!t) throw new BadRequestException(`Tax ${code} is missing: add it in Master > Taxes`);
      return t.id;
    };
    const licensed = !!cfg.licenceNo && (!cfg.licenceExpiry || cfg.licenceExpiry >= date);
    return { edu: licensed ? await find('PPN-EDU') : null, goods: await find('PPN12'), licensed };
  }

  private async invoice(
    s: Prisma.SchoolStudentGetPayload<object>,
    period: string,
    date: Date,
    dueDate: Date | null,
    notes: string,
    lines: { productId: string; description: string; qty: number; unitPrice: number; discountPct: number; taxId: string | null }[],
  ) {
    const customerId = await this.customer(s);
    const si = (await this.docs.create('SI', { date, dueDate, customerId, reference: `${s.nis ?? s.regNumber} ${period}`, notes, lines }, undefined, { skipPermission: true })) as {
      id: string;
      grandTotal?: unknown;
    };
    try {
      await this.docs.confirm('SI', si.id, { skipPermission: true });
    } catch (e) {
      await this.prisma.tradeDocument.update({ where: { id: si.id }, data: { deletedAt: new Date() } });
      throw e;
    }
    const doc = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: si.id }, select: { grandTotal: true } });
    return this.prisma.schoolBill.create({ data: { companyId: s.companyId, studentId: s.id, period, invoiceId: si.id, amount: doc.grandTotal } });
  }

  private feeLines(fees: Fee[], grade: number, discounts: { feeId: string; pct: Prisma.Decimal; validTo: Date | null }[], on: Date, label: string, eduTax: string | null) {
    return fees
      .map((f) => {
        const amount = n((f.rates as Record<string, number>)[String(grade)]);
        const d = discounts.find((x) => x.feeId === f.id && (!x.validTo || x.validTo >= on));
        return { fee: f, amount, discountPct: d ? n(d.pct) : 0 };
      })
      .filter((x) => x.amount > 0)
      .map((x) => ({
        productId: x.fee.productId!,
        description: `${x.fee.name} ${label}`.trim(),
        qty: 1,
        unitPrice: x.amount,
        discountPct: x.discountPct,
        taxId: eduTax,
        net: r2(x.amount * (1 - x.discountPct / 100)),
        code: x.fee.code,
      }));
  }

  private eduNote(t: { licensed?: boolean }) {
    return t.licensed === undefined ? 'Education services.' : 'Education by a licensed unit: PPN dibebaskan (PP 49/2022 Art. 16, faktur code 08).';
  }

  async billEntry(id: string, date: Date) {
    RequestCtx.assert('school.billing');
    const s = await this.ownedStudent(id);
    if (s.status !== 'ACTIVE') throw new ConflictException('Bill an enrolled student');
    if (await this.prisma.schoolBill.findFirst({ where: { studentId: id, period: 'ENTRY', status: 'POSTED' } })) throw new ConflictException('The entry fee is billed already');
    const fees = await this.prisma.schoolFee.findMany({ where: { companyId: s.companyId, kind: 'ENTRY', isActive: true } });
    const t = await this.taxes(s.companyId, date);
    if (t.goods && !t.edu) throw new ConflictException(NO_LICENCE);
    const discounts = await this.prisma.schoolDiscount.findMany({ where: { studentId: id } });
    const lines = this.feeLines(fees, s.grade, discounts, date, '', t.edu);
    if (!lines.length) throw new ConflictException(`No entry fee for grade ${s.grade}`);
    await this.invoice(s, 'ENTRY', date, null, `Entry fee (uang pangkal). ${this.eduNote(t)}`, lines);
    await this.audit.record('School Student', id, 'BILL_ENTRY');
    return this.student(id);
  }

  private async runRows(companyId: string, period: string) {
    const cfg = await this.cfg(companyId);
    const year = academicYearOf(period, cfg.firstMonth);
    const firstOfYear = Number(period.slice(5, 7)) === cfg.firstMonth;
    const start = new Date(`${period}-01`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const fees = await this.prisma.schoolFee.findMany({ where: { companyId, isActive: true, kind: { in: firstOfYear ? ['MONTHLY', 'ANNUAL'] : ['MONTHLY'] } } });
    const classes = await this.prisma.schoolClass.findMany({ where: { companyId, academicYear: year } });
    const students = await this.prisma.schoolStudent.findMany({
      where: { companyId, status: 'ACTIVE', classId: { in: classes.map((c) => c.id) }, OR: [{ enrolledOn: null }, { enrolledOn: { lte: end } }] },
      orderBy: [{ grade: 'asc' }, { name: 'asc' }],
    });
    const [discounts, done] = await Promise.all([
      this.prisma.schoolDiscount.findMany({ where: { studentId: { in: students.map((s) => s.id) } } }),
      this.prisma.schoolBill.findMany({ where: { companyId, period, status: 'POSTED' }, select: { studentId: true } }),
    ]);
    const label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
    return {
      cfg,
      year,
      start,
      students: students.map((s) => ({
        s,
        class: classes.find((c) => c.id === s.classId)?.name ?? null,
        billed: done.some((d) => d.studentId === s.id),
        lines: this.feeLines(
          fees,
          s.grade,
          discounts.filter((d) => d.studentId === s.id),
          start,
          label,
          null,
        ),
      })),
    };
  }

  async preview(period: string) {
    RequestCtx.assert('school.read');
    const { year, students } = await this.runRows(RequestCtx.companyId(), period);
    return {
      period,
      academicYear: year,
      rows: students.map((x) => ({
        studentId: x.s.id,
        name: x.s.name,
        nis: x.s.nis,
        class: x.class,
        billed: x.billed,
        lines: x.lines.map((l) => ({ code: l.code, description: l.description, amount: l.unitPrice, discountPct: l.discountPct, net: l.net })),
        total: r2(x.lines.reduce((a, l) => a + l.net, 0)),
      })),
    };
  }

  /** one invoice per active student for the month (SPP, and the annual fees in the first month of the year) */
  async run(input: z.infer<typeof runSchema>) {
    RequestCtx.assert('school.billing');
    const companyId = RequestCtx.companyId();
    const { cfg, students, start } = await this.runRows(companyId, input.period);
    const t = await this.taxes(companyId, input.date);
    if (t.goods && !t.edu) throw new ConflictException(NO_LICENCE);
    const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), cfg.dueDay));
    const out = { created: 0, skipped: 0, total: 0, errors: [] as { name: string; error: string }[] };
    for (const x of students) {
      if (x.billed || !x.lines.length) {
        out.skipped++;
        continue;
      }
      try {
        const b = await this.invoice(
          x.s,
          input.period,
          input.date,
          due < input.date ? input.date : due,
          `School fees ${input.period}, class ${x.class ?? ''}. ${this.eduNote(t)}`,
          x.lines.map((l) => ({ ...l, taxId: t.edu })),
        );
        out.created++;
        out.total = r2(out.total + n(b.amount));
      } catch (e) {
        out.errors.push({ name: x.s.name, error: (e as Error).message });
      }
    }
    await this.audit.record('School Billing', input.period, 'RUN', null, { created: out.created, errors: out.errors.length });
    return out;
  }

  /** books, uniforms and other goods sold apart from the schooling: PPN for a PKP */
  async sellItems(id: string, input: z.infer<typeof itemSchema>) {
    RequestCtx.assert('school.billing');
    const s = await this.ownedStudent(id);
    if (!['ACTIVE', 'APPLICANT'].includes(s.status)) throw new ConflictException('Sell to an active student or applicant');
    const fees = await this.prisma.schoolFee.findMany({ where: { companyId: s.companyId, id: { in: input.items.map((i) => i.feeId) }, kind: 'ITEM', isActive: true } });
    const t = await this.taxes(s.companyId, input.date);
    const lines = input.items.map((i) => {
      const f = fees.find((x) => x.id === i.feeId);
      if (!f) throw invalid({ items: 'Choose item fees' });
      const price = n((f.rates as Record<string, number>)[String(s.grade)]);
      if (!(price > 0)) throw invalid({ items: `${f.name} has no price for grade ${s.grade}` });
      return { productId: f.productId!, description: f.name, qty: i.qty, unitPrice: price, discountPct: 0, taxId: t.goods };
    });
    await this.invoice(s, `ITEM-${iso(input.date)}`, input.date, null, 'Goods sold apart from the schooling (books, uniforms): not part of the exempt education, PPN for a PKP.', lines);
    await this.audit.record('School Student', id, 'SELL_ITEMS', null, { items: input.items.length });
    return this.student(id);
  }

  async cancelBill(billId: string) {
    RequestCtx.assert('school.billing');
    const b = await this.prisma.schoolBill.findFirst({ where: { id: billId, companyId: RequestCtx.companyId(), status: 'POSTED' } });
    if (!b) throw new NotFoundException('Bill not found');
    await this.docs.cancel('SI', b.invoiceId, { skipPermission: true });
    await this.prisma.schoolBill.update({ where: { id: billId }, data: { status: 'CANCELLED' } });
    await this.audit.record('School Student', b.studentId, 'BILL_CANCEL', null, { period: b.period });
    return this.student(b.studentId);
  }

  // ------------------------------------------------------------------ arrears, summary, promotion
  async arrears(asOf: Date) {
    RequestCtx.assert('school.read');
    const companyId = RequestCtx.companyId();
    const bills = await this.prisma.schoolBill.findMany({ where: { companyId, status: 'POSTED' } });
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: bills.map((b) => b.invoiceId) }, status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null },
      select: { id: true, number: true, dueDate: true, date: true, grandTotal: true, paidAmount: true },
    });
    const open = inv.filter((i) => n(i.grandTotal) - n(i.paidAmount) > 0.005);
    const students = await this.prisma.schoolStudent.findMany({ where: { id: { in: [...new Set(bills.filter((b) => open.some((i) => i.id === b.invoiceId)).map((b) => b.studentId))] } } });
    const classes = await this.prisma.schoolClass.findMany({ where: { id: { in: students.map((s) => s.classId).filter((x): x is string => !!x) } } });
    const rows = students.map((s) => {
      const mine = open.filter((i) => bills.some((b) => b.studentId === s.id && b.invoiceId === i.id));
      const overdue = mine.filter((i) => (i.dueDate ?? i.date) < asOf);
      const oldest = overdue.map((i) => i.dueDate ?? i.date).sort((a, b) => a.getTime() - b.getTime())[0];
      return {
        studentId: s.id,
        name: s.name,
        nis: s.nis,
        status: s.status,
        class: classes.find((c) => c.id === s.classId)?.name ?? null,
        guardianPhone: s.guardianPhone,
        invoices: mine.length,
        open: r2(mine.reduce((a, i) => a + n(i.grandTotal) - n(i.paidAmount), 0)),
        overdue: r2(overdue.reduce((a, i) => a + n(i.grandTotal) - n(i.paidAmount), 0)),
        daysOverdue: oldest ? Math.floor((asOf.getTime() - oldest.getTime()) / DAY) : 0,
      };
    });
    rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.open - a.open);
    return { asOf: iso(asOf), rows, open: r2(rows.reduce((a, r) => a + r.open, 0)), overdue: r2(rows.reduce((a, r) => a + r.overdue, 0)) };
  }

  /** billed and collected per month of an academic year */
  async summary(year: string) {
    RequestCtx.assert('school.read');
    const companyId = RequestCtx.companyId();
    const cfg = await this.cfg(companyId);
    const y0 = Number(year.slice(0, 4));
    const periods = Array.from({ length: 12 }, (_, k) => {
      const m = ((cfg.firstMonth - 1 + k) % 12) + 1;
      const y = m >= cfg.firstMonth ? y0 : y0 + 1;
      return `${y}-${String(m).padStart(2, '0')}`;
    });
    const bills = await this.prisma.schoolBill.findMany({ where: { companyId, period: { in: periods }, status: 'POSTED' } });
    const inv = await this.prisma.tradeDocument.findMany({ where: { id: { in: bills.map((b) => b.invoiceId) } }, select: { id: true, grandTotal: true, paidAmount: true } });
    const [students, applicants] = await Promise.all([
      this.prisma.schoolStudent.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.schoolStudent.count({ where: { companyId, status: 'APPLICANT' } }),
    ]);
    return {
      year,
      students,
      applicants,
      months: periods.map((p) => {
        const mine = bills.filter((b) => b.period === p);
        const ii = inv.filter((i) => mine.some((b) => b.invoiceId === i.id));
        const billed = r2(ii.reduce((a, i) => a + n(i.grandTotal), 0));
        const paid = r2(ii.reduce((a, i) => a + Math.min(n(i.paidAmount), n(i.grandTotal)), 0));
        return { period: p, invoices: mine.length, billed, paid, rate: billed ? r2((paid / billed) * 100) : 0 };
      }),
    };
  }

  /** year end: every class of the current year moves to a class of the next year, or graduates */
  async promote(input: z.infer<typeof promoteSchema>) {
    RequestCtx.assert('school.students');
    const u = RequestCtx.user();
    const cfg = await this.cfg(u.companyId);
    if (Number(input.toYear.slice(0, 4)) !== Number(cfg.academicYear.slice(0, 4)) + 1) throw invalid({ toYear: `The year after ${cfg.academicYear}` });
    const from = await this.prisma.schoolClass.findMany({ where: { companyId: u.companyId, academicYear: cfg.academicYear } });
    const to = await this.prisma.schoolClass.findMany({ where: { companyId: u.companyId, academicYear: input.toYear } });
    const errors: Record<string, string> = {};
    for (const m of input.moves) {
      const f = from.find((c) => c.id === m.fromClassId);
      if (!f) errors.moves = 'A class is not of the current year';
      else if (m.toClassId && !to.some((c) => c.id === m.toClassId)) errors.moves = `${f.name}: choose a class of ${input.toYear}`;
      else if (!m.toClassId && f.grade < cfg.maxGrade) errors.moves = `${f.name} is not the last grade: choose its next class`;
    }
    const withStudents = await this.prisma.schoolStudent.groupBy({ by: ['classId'], where: { companyId: u.companyId, status: 'ACTIVE', classId: { in: from.map((c) => c.id) } }, _count: true });
    const missing = withStudents.find((w) => !input.moves.some((m) => m.fromClassId === w.classId));
    if (missing) errors.moves = `${from.find((c) => c.id === missing.classId)?.name}: say where its students go`;
    if (Object.keys(errors).length) throw invalid(errors);
    const res = { moved: 0, graduated: 0 };
    await this.prisma.$transaction(async (tx) => {
      for (const m of input.moves) {
        if (m.toClassId) {
          const target = to.find((c) => c.id === m.toClassId)!;
          res.moved += (await tx.schoolStudent.updateMany({ where: { classId: m.fromClassId, status: 'ACTIVE' }, data: { classId: target.id, grade: target.grade } })).count;
        } else res.graduated += (await tx.schoolStudent.updateMany({ where: { classId: m.fromClassId, status: 'ACTIVE' }, data: { status: 'GRADUATED', leftOn: input.date } })).count;
      }
      await tx.schoolConfig.update({ where: { id: cfg.id }, data: { academicYear: input.toYear } });
    });
    await this.audit.record('School Config', cfg.id, 'PROMOTE', { academicYear: cfg.academicYear }, { academicYear: input.toYear, ...res });
    return res;
  }
}
