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
import { JournalService, PostingLine } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';
import { pasal17 } from '../hris/payroll-statutory';

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
const ICD10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/;

/** PMK 168/2023: PPh 21 of a practitioner who is not an employee = Pasal 17 rates x 50% of the gross, not cumulative */
export function practitionerPph21(gross: number) {
  const base = r2(gross / 2);
  return { base, pph21: Math.floor(pasal17(base)) };
}

export const configSchema = z.object({ name: z.string().trim().min(1).max(150), facilityCode: optText(30), pharmacyWarehouseId: optUuid });
export const patientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sex: z.enum(['M', 'F']),
  birthDate: z.coerce.date(),
  nik: optText(20),
  bpjsNo: optText(20),
  phone: optText(30),
  address: optText(300),
  allergies: optText(1000),
  bloodType: optText(3),
  isActive: z.boolean().default(true),
});
export const practitionerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  profession: z.enum(['DOCTOR', 'DENTIST', 'MIDWIFE', 'NURSE', 'OTHER']),
  strNo: optText(40),
  strExpiry: optDate,
  sipNo: optText(60),
  sipExpiry: optDate,
  employeeId: optUuid,
  isEmployee: z.boolean().default(false),
  feePct: z.coerce.number().min(0).max(100).default(0),
  isActive: z.boolean().default(true),
});
export const serviceSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['CONSULT', 'PROCEDURE', 'LAB', 'OTHER']).default('CONSULT'),
  price: z.coerce.number().min(0).max(1e12),
  feeable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export const controlledSchema = z.object({ productId: z.uuid(), class: z.enum(['NARKOTIKA', 'PSIKOTROPIKA', 'PREKURSOR']) });
export const visitSchema = z.object({
  patientId: z.uuid(),
  practitionerId: z.uuid(),
  date: z.coerce.date(),
  payer: z.enum(['GENERAL', 'BPJS', 'INSURANCE', 'CORPORATE']).default('GENERAL'),
  customerId: optUuid,
});
export const examSchema = z.object({
  subjective: optText(4000),
  objective: optText(4000),
  plan: optText(4000),
  vitals: z
    .object({ bp: optText(10), hr: optText(5), temp: optText(5), rr: optText(5), weight: optText(6), height: optText(6), spo2: optText(5) })
    .partial()
    .optional(),
  diagnoses: z
    .array(z.object({ code: z.string().trim().toUpperCase().regex(ICD10, 'ICD-10 code, e.g. J06.9'), name: z.string().trim().min(1).max(200), primary: z.boolean().default(false) }))
    .max(20)
    .default([]),
  referral: optText(300),
  followUp: optDate,
  items: z
    .array(
      z.object({
        kind: z.enum(['SERVICE', 'DRUG']),
        serviceId: optUuid,
        productId: optUuid,
        qty: z.coerce.number().positive().max(10000),
        price: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).max(1e12).optional()),
        dosage: optText(120),
      }),
    )
    .max(100)
    .default([]),
  finish: z.boolean().default(false),
});
export const capitationSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  date: z.coerce.date(),
  members: z.coerce.number().int().min(0).max(1e7),
  amount: z.coerce.number().positive().max(1e13),
  withheld: z.coerce.number().min(0).max(1e12).default(0),
  bankAccountId: z.uuid(),
});

/**
 * Clinic. The electronic medical record (Permenkes 24/2022) is kept 25 years: the SOAP notes and allergies are stored
 * encrypted, read only with clinic.records and every read is in the audit log (rahasia kedokteran, UU 17/2023; health
 * data is specific personal data, UU 27/2022). Billing: medical services are PPN-exempt (UU PPN Art. 16B, PP 49/2022
 * Art. 11), medicines dispensed are goods with PPN for a PKP; medicines leave the pharmacy FEFO. Practitioners who are
 * not employees get their fee with PPh 21 = Pasal 17 x 50% of the gross they billed (PMK 168/2023).
 */
@Injectable()
export class ClinicService {
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
    return (await this.prisma.clinicConfig.findUnique({ where: { companyId } })) ?? (await this.prisma.clinicConfig.create({ data: { companyId } }));
  }

  async setup() {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const [config, practitioners, services, controlled] = await Promise.all([
      this.cfg(companyId),
      this.prisma.clinicPractitioner.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      this.prisma.clinicService.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.clinicControlledDrug.findMany({ where: { companyId } }),
    ]);
    const products = await this.prisma.product.findMany({ where: { id: { in: controlled.map((c) => c.productId) } }, select: { id: true, code: true, name: true } });
    const wh = config.pharmacyWarehouseId ? await this.prisma.warehouse.findUnique({ where: { id: config.pharmacyWarehouseId }, select: { id: true, code: true, name: true } }) : null;
    const soon = new Date(today().getTime() + 60 * DAY);
    return {
      config: { ...config, warehouse: wh },
      practitioners: practitioners.map((p) => ({
        ...p,
        feePct: n(p.feePct),
        strExpiry: iso(p.strExpiry),
        sipExpiry: iso(p.sipExpiry),
        licenceDue: [p.strExpiry, p.sipExpiry].some((d) => !d || d <= soon),
      })),
      services: services.map((s) => ({ ...s, price: n(s.price) })),
      controlled: controlled.map((c) => ({ ...c, product: products.find((p) => p.id === c.productId) ?? null })),
    };
  }

  async saveConfig(input: z.infer<typeof configSchema>) {
    RequestCtx.assert('clinic.setup');
    const u = RequestCtx.user();
    if (input.pharmacyWarehouseId && !(await this.prisma.warehouse.findFirst({ where: { id: input.pharmacyWarehouseId, companyId: u.companyId } })))
      throw invalid({ pharmacyWarehouseId: 'Choose a warehouse' });
    const c = await this.cfg(u.companyId);
    await this.prisma.clinicConfig.update({ where: { id: c.id }, data: { name: input.name, facilityCode: input.facilityCode ?? null, pharmacyWarehouseId: input.pharmacyWarehouseId ?? null } });
    return this.setup();
  }

  async savePractitioner(id: string | null, input: z.infer<typeof practitionerSchema>) {
    RequestCtx.assert('clinic.setup');
    const u = RequestCtx.user();
    const data = {
      ...input,
      feePct: D(input.feePct),
      strNo: input.strNo ?? null,
      strExpiry: input.strExpiry ?? null,
      sipNo: input.sipNo ?? null,
      sipExpiry: input.sipExpiry ?? null,
      employeeId: input.employeeId ?? null,
    };
    if (id) {
      if (!(await this.prisma.clinicPractitioner.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Practitioner not found');
      await this.prisma.clinicPractitioner.update({ where: { id }, data });
    } else await this.prisma.clinicPractitioner.create({ data: { ...data, companyId: u.companyId } });
    return this.setup();
  }

  async saveService(id: string | null, input: z.infer<typeof serviceSchema>) {
    RequestCtx.assert('clinic.setup');
    const u = RequestCtx.user();
    const dup = await this.prisma.clinicService.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code already used' });
    const data = { ...input, price: D(input.price) };
    if (id) {
      if (!(await this.prisma.clinicService.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Tariff not found');
      await this.prisma.clinicService.update({ where: { id }, data });
    } else await this.prisma.clinicService.create({ data: { ...data, companyId: u.companyId } });
    return this.setup();
  }

  async setControlled(input: z.infer<typeof controlledSchema>, remove = false) {
    RequestCtx.assert('clinic.setup');
    const u = RequestCtx.user();
    if (remove) await this.prisma.clinicControlledDrug.deleteMany({ where: { companyId: u.companyId, productId: input.productId } });
    else {
      const p = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, type: 'STOCK' } });
      if (!p) throw invalid({ productId: 'Choose a stock product' });
      await this.prisma.clinicControlledDrug.upsert({
        where: { companyId_productId: { companyId: u.companyId, productId: p.id } },
        update: { class: input.class },
        create: { companyId: u.companyId, productId: p.id, class: input.class },
      });
    }
    return this.setup();
  }

  // ------------------------------------------------------------------ patients
  private shapePatient(p: Prisma.ClinicPatientGetPayload<object>, clinical: boolean) {
    return {
      ...p,
      birthDate: iso(p.birthDate),
      nik: mask(this.crypto.decrypt(p.nik)),
      bpjsNo: mask(this.crypto.decrypt(p.bpjsNo)),
      allergies: clinical ? this.crypto.decrypt(p.allergies) : p.allergies ? '(recorded)' : null,
      age: Math.floor((today().getTime() - p.birthDate.getTime()) / (365.25 * DAY)),
    };
  }

  async patients(q?: string) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.clinicPatient.findMany({
      where: { companyId, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { rmNumber: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { rmNumber: 'desc' },
      take: 200,
    });
    const clinical = RequestCtx.can('clinic.records');
    return rows.map((p) => this.shapePatient(p, clinical));
  }

  async patient(id: string) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const p = await this.prisma.clinicPatient.findFirst({ where: { id, companyId } });
    if (!p) throw new NotFoundException('Patient not found');
    const clinical = RequestCtx.can('clinic.records');
    const visits = await this.prisma.clinicVisit.findMany({ where: { patientId: id }, orderBy: [{ date: 'desc' }, { queueNo: 'desc' }], take: 100 });
    const prs = await this.prisma.clinicPractitioner.findMany({ where: { id: { in: visits.map((v) => v.practitionerId) } }, select: { id: true, name: true } });
    if (clinical) await this.audit.record('Clinic Patient', id, 'VIEW_RECORD');
    return {
      ...this.shapePatient(p, clinical),
      visits: visits.map((v) => ({
        id: v.id,
        number: v.number,
        date: iso(v.date),
        status: v.status,
        payer: v.payer,
        practitioner: prs.find((x) => x.id === v.practitionerId)?.name ?? null,
        diagnoses: clinical ? ((v.diagnoses as { code: string; name: string; primary: boolean }[] | null) ?? []) : null,
      })),
    };
  }

  async savePatient(id: string | null, input: z.infer<typeof patientSchema>) {
    RequestCtx.assert('clinic.register');
    const u = RequestCtx.user();
    if (input.birthDate > today()) throw invalid({ birthDate: 'Born in the future' });
    if (input.nik && !/^\d{16}$/.test(input.nik)) throw invalid({ nik: 'NIK has 16 digits' });
    if (input.bpjsNo && !/^\d{13}$/.test(input.bpjsNo)) throw invalid({ bpjsNo: 'The JKN card number has 13 digits' });
    const data = {
      name: input.name,
      sex: input.sex,
      birthDate: input.birthDate,
      phone: input.phone ?? null,
      address: input.address ?? null,
      bloodType: input.bloodType ?? null,
      isActive: input.isActive,
      ...(input.nik ? { nik: this.crypto.encrypt(input.nik) } : {}),
      ...(input.bpjsNo ? { bpjsNo: this.crypto.encrypt(input.bpjsNo) } : {}),
      ...(input.allergies && RequestCtx.can('clinic.records') ? { allergies: this.crypto.encrypt(input.allergies) } : {}),
    };
    let p;
    if (id) {
      if (!(await this.prisma.clinicPatient.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Patient not found');
      p = await this.prisma.clinicPatient.update({ where: { id }, data });
    } else
      p = await this.prisma.$transaction(async (tx) =>
        tx.clinicPatient.create({ data: { ...data, companyId: u.companyId, rmNumber: await this.sequence.next('CLINIC_RM', u.companyId, today(), tx), createdById: u.id } }),
      );
    await this.audit.record('Clinic Patient', p.id, id ? 'UPDATE' : 'CREATE', null, { rm: p.rmNumber });
    return this.patient(p.id);
  }

  // ------------------------------------------------------------------ visits
  async queue(date: Date) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.clinicVisit.findMany({ where: { companyId, date }, orderBy: { queueNo: 'asc' } });
    const [pats, prs] = await Promise.all([
      this.prisma.clinicPatient.findMany({ where: { id: { in: rows.map((r) => r.patientId) } }, select: { id: true, rmNumber: true, name: true, sex: true, birthDate: true } }),
      this.prisma.clinicPractitioner.findMany({ where: { id: { in: rows.map((r) => r.practitionerId) } }, select: { id: true, name: true } }),
    ]);
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } },
      select: { id: true, number: true, grandTotal: true, paidAmount: true },
    });
    return rows.map((v) => {
      const p = pats.find((x) => x.id === v.patientId);
      return {
        id: v.id,
        number: v.number,
        queueNo: v.queueNo,
        date: iso(v.date),
        status: v.status,
        payer: v.payer,
        patient: p ? { id: p.id, rmNumber: p.rmNumber, name: p.name, sex: p.sex, age: Math.floor((today().getTime() - p.birthDate.getTime()) / (365.25 * DAY)) } : null,
        practitioner: prs.find((x) => x.id === v.practitionerId)?.name ?? null,
        invoice: inv.find((i) => i.id === v.invoiceId) ?? null,
      };
    });
  }

  async register(input: z.infer<typeof visitSchema>) {
    RequestCtx.assert('clinic.register');
    const u = RequestCtx.user();
    const p = await this.prisma.clinicPatient.findFirst({ where: { id: input.patientId, companyId: u.companyId, isActive: true } });
    if (!p) throw invalid({ patientId: 'Choose a patient' });
    const pr = await this.prisma.clinicPractitioner.findFirst({ where: { id: input.practitionerId, companyId: u.companyId, isActive: true } });
    if (!pr) throw invalid({ practitionerId: 'Choose a practitioner' });
    if (!pr.sipExpiry || pr.sipExpiry < input.date) throw invalid({ practitionerId: `${pr.name}: practice licence (SIP) ${pr.sipExpiry ? `expired ${iso(pr.sipExpiry)}` : 'not recorded'}` });
    if (input.payer === 'BPJS' && !p.bpjsNo) throw invalid({ payer: 'Record the JKN card number of the patient first' });
    if (['INSURANCE', 'CORPORATE'].includes(input.payer) && !input.customerId) throw invalid({ customerId: 'Choose the insurer / company billed' });
    const v = await this.prisma.$transaction(async (tx) => {
      const last = await tx.clinicVisit.aggregate({ where: { companyId: u.companyId, date: input.date }, _max: { queueNo: true } });
      return tx.clinicVisit.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('CLINIC_VISIT', u.companyId, input.date, tx),
          patientId: p.id,
          practitionerId: pr.id,
          date: input.date,
          queueNo: (last._max.queueNo ?? 0) + 1,
          payer: input.payer,
          customerId: input.customerId ?? null,
          createdById: u.id,
        },
      });
    });
    await this.audit.record('Clinic Visit', v.id, 'CREATE', null, { number: v.number, queue: v.queueNo });
    return (await this.queue(input.date)).find((x) => x.id === v.id);
  }

  async cancelVisit(id: string) {
    RequestCtx.assert('clinic.register');
    const u = RequestCtx.user();
    const v = await this.prisma.clinicVisit.findFirst({ where: { id, companyId: u.companyId } });
    if (!v || !['WAITING', 'IN_EXAM'].includes(v.status)) throw new ConflictException('Only a visit not finished can be cancelled');
    await this.prisma.clinicVisit.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Clinic Visit', id, 'CANCEL');
    return { ok: true };
  }

  /** the medical record of a visit: clinic.records only, every read logged */
  async visit(id: string) {
    RequestCtx.assert('clinic.records');
    const companyId = RequestCtx.companyId();
    const v = await this.prisma.clinicVisit.findFirst({ where: { id, companyId }, include: { items: true } });
    if (!v) throw new NotFoundException('Visit not found');
    const [patient, pr, services, products, inv, cust] = await Promise.all([
      this.prisma.clinicPatient.findUniqueOrThrow({ where: { id: v.patientId } }),
      this.prisma.clinicPractitioner.findUnique({ where: { id: v.practitionerId }, select: { id: true, name: true, profession: true, feePct: true, isEmployee: true } }),
      this.prisma.clinicService.findMany({ where: { id: { in: v.items.map((i) => i.serviceId).filter(Boolean) as string[] } }, select: { id: true, code: true } }),
      this.prisma.product.findMany({ where: { id: { in: v.items.map((i) => i.productId).filter(Boolean) as string[] } }, select: { id: true, code: true } }),
      v.invoiceId ? this.prisma.tradeDocument.findUnique({ where: { id: v.invoiceId }, select: { id: true, number: true, status: true, grandTotal: true, taxTotal: true, paidAmount: true } }) : null,
      v.customerId ? this.prisma.customer.findUnique({ where: { id: v.customerId }, select: { id: true, name: true } }) : null,
    ]);
    await this.audit.record('Clinic Visit', id, 'VIEW_RECORD');
    const controlled = await this.prisma.clinicControlledDrug.findMany({ where: { companyId, productId: { in: v.items.map((i) => i.productId).filter(Boolean) as string[] } } });
    const { items, ...head } = v;
    return {
      ...head,
      date: iso(v.date),
      followUp: iso(v.followUp),
      subjective: this.crypto.decrypt(v.subjective),
      objective: this.crypto.decrypt(v.objective),
      plan: this.crypto.decrypt(v.plan),
      practitionerFee: n(v.practitionerFee),
      feeGross: n(v.feeGross),
      patient: this.shapePatient(patient, true),
      practitioner: pr ? { ...pr, feePct: n(pr.feePct) } : null,
      customer: cust,
      invoice: inv ? { ...inv, grandTotal: n(inv.grandTotal), taxTotal: n(inv.taxTotal), paidAmount: n(inv.paidAmount) } : null,
      items: items.map((i) => ({
        ...i,
        qty: n(i.qty),
        price: n(i.price),
        code: services.find((s) => s.id === i.serviceId)?.code ?? products.find((p) => p.id === i.productId)?.code ?? null,
        controlled: controlled.find((c) => c.productId === i.productId)?.class ?? null,
      })),
    };
  }

  /** examination: SOAP (encrypted), vitals, ICD-10 diagnoses, services and prescriptions; finish needs a primary diagnosis */
  async saveExam(id: string, input: z.infer<typeof examSchema>) {
    RequestCtx.assert('clinic.records');
    const u = RequestCtx.user();
    const v = await this.prisma.clinicVisit.findFirst({ where: { id, companyId: u.companyId } });
    if (!v) throw new NotFoundException('Visit not found');
    if (!['WAITING', 'IN_EXAM', 'DONE'].includes(v.status)) throw new ConflictException('The visit is billed or cancelled');
    const primaries = input.diagnoses.filter((d) => d.primary).length;
    if (primaries > 1) throw invalid({ diagnoses: 'One primary diagnosis' });
    if (input.finish && !primaries) throw invalid({ diagnoses: 'Finishing needs the primary diagnosis (ICD-10)' });
    const svcIds = input.items.filter((i) => i.kind === 'SERVICE').map((i) => i.serviceId!);
    const drugIds = input.items.filter((i) => i.kind === 'DRUG').map((i) => i.productId!);
    if (input.items.some((i) => (i.kind === 'SERVICE' ? !i.serviceId : !i.productId))) throw invalid({ items: 'Each line names a tariff or a medicine' });
    const [svcs, drugs] = await Promise.all([
      this.prisma.clinicService.findMany({ where: { companyId: u.companyId, id: { in: svcIds } } }),
      this.prisma.product.findMany({ where: { companyId: u.companyId, id: { in: drugIds }, type: 'STOCK' } }),
    ]);
    if (svcs.length !== new Set(svcIds).size || drugs.length !== new Set(drugIds).size) throw invalid({ items: 'Choose tariffs and stock medicines of this clinic' });
    if (input.items.some((i) => i.kind === 'DRUG' && !i.dosage)) throw invalid({ items: 'Each medicine needs its signa (how to take it)' });
    await this.prisma.$transaction(async (tx) => {
      await tx.clinicVisitItem.deleteMany({ where: { visitId: id } });
      if (input.items.length)
        await tx.clinicVisitItem.createMany({
          data: input.items.map((i) => {
            const s = svcs.find((x) => x.id === i.serviceId);
            const d = drugs.find((x) => x.id === i.productId);
            return {
              visitId: id,
              kind: i.kind,
              serviceId: s?.id ?? null,
              productId: d?.id ?? null,
              description: s?.name ?? d?.name ?? '',
              qty: D(i.qty),
              price: D(i.price ?? n(s?.price ?? d?.salePrice)),
              dosage: i.dosage ?? null,
            };
          }),
        });
      await tx.clinicVisit.update({
        where: { id },
        data: {
          subjective: this.crypto.encrypt(input.subjective ?? null),
          objective: this.crypto.encrypt(input.objective ?? null),
          plan: this.crypto.encrypt(input.plan ?? null),
          vitals: input.vitals ?? Prisma.JsonNull,
          diagnoses: input.diagnoses,
          referral: input.referral ?? null,
          followUp: input.followUp ?? null,
          status: input.finish ? 'DONE' : 'IN_EXAM',
        },
      });
    });
    await this.audit.record('Clinic Visit', id, 'RECORD', null, { finish: input.finish, diagnoses: input.diagnoses.map((d) => d.code) });
    return this.visit(id);
  }

  private async customer(companyId: string, code: string, name: string, field: 'walkInCustomerId' | 'bpjsCustomerId') {
    const c = await this.cfg(companyId);
    if (c[field]) return c[field]!;
    const cust = (await this.prisma.customer.findFirst({ where: { companyId, code, deletedAt: null } })) ?? (await this.prisma.customer.create({ data: { companyId, code, name } }));
    await this.prisma.clinicConfig.update({ where: { id: c.id }, data: { [field]: cust.id } });
    return cust.id;
  }

  private async tax(companyId: string, code: string) {
    const t = await this.prisma.tax.findFirst({ where: { companyId, code, kind: 'VAT', deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException(`Tax ${code} is missing: add it in Master > Taxes`);
    return t.id;
  }

  /**
   * Billing: medicines leave the pharmacy (delivery, FEFO lots, cost of goods) and the invoice carries the services
   * (PPN-exempt) and the medicines (PPN for a PKP). A BPJS visit is covered by the capitation: the medicines leave
   * the stock, nothing is invoiced to the patient.
   */
  async bill(id: string) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    const v = await this.prisma.clinicVisit.findFirst({ where: { id, companyId: u.companyId }, include: { items: true } });
    if (!v) throw new NotFoundException('Visit not found');
    if (v.status !== 'DONE') throw new ConflictException('Bill a finished examination');
    const cfg = await this.cfg(u.companyId);
    const pr = await this.prisma.clinicPractitioner.findUniqueOrThrow({ where: { id: v.practitionerId } });
    const drugs = v.items.filter((i) => i.kind === 'DRUG');
    const services = v.items.filter((i) => i.kind === 'SERVICE');
    if (drugs.length && !cfg.pharmacyWarehouseId) throw new ConflictException('Choose the pharmacy warehouse in Practitioners & Tariffs first');
    const customerId =
      v.payer === 'GENERAL'
        ? await this.customer(u.companyId, 'CLINIC-UMUM', 'Pasien Umum (klinik)', 'walkInCustomerId')
        : v.payer === 'BPJS'
          ? await this.customer(u.companyId, 'CLINIC-BPJS', 'BPJS Kesehatan (JKN)', 'bpjsCustomerId')
          : v.customerId!;
    const svcRows = await this.prisma.clinicService.findMany({ where: { id: { in: services.map((s) => s.serviceId!) } } });
    const feeGross = r2(services.filter((s) => svcRows.find((x) => x.id === s.serviceId)?.feeable).reduce((a, s) => a + n(s.qty) * n(s.price), 0));
    let deliveryId: string | null = null;
    let doLines: { id: string; productId: string | null }[] = [];
    if (drugs.length) {
      const dO = (await this.docs.create(
        'DO',
        {
          date: v.date,
          customerId,
          warehouseId: cfg.pharmacyWarehouseId,
          reference: v.number,
          notes: `Dispensed on visit ${v.number}`,
          lines: drugs.map((d) => ({ productId: d.productId, qty: n(d.qty), description: `${d.description}${d.dosage ? ` (${d.dosage})` : ''}` })),
        },
        undefined,
        { skipPermission: true },
      )) as { id: string };
      try {
        await this.docs.confirm('DO', dO.id, { skipPermission: true });
      } catch (e) {
        await this.prisma.tradeDocument.update({ where: { id: dO.id }, data: { deletedAt: new Date() } });
        throw e;
      }
      deliveryId = dO.id;
      doLines = await this.prisma.tradeDocumentLine.findMany({ where: { documentId: dO.id }, orderBy: { lineNo: 'asc' }, select: { id: true, productId: true } });
    }
    let invoiceId: string | null = null;
    if (v.payer !== 'BPJS' && (services.length || drugs.length)) {
      const pkp = await this.settings.bool('sales.vatPayer', u.companyId, true);
      const exempt = pkp ? await this.tax(u.companyId, 'PPN-EXEMPT') : null;
      const ppn = pkp ? await this.tax(u.companyId, 'PPN12') : null;
      const svcProduct = await this.svcProduct(u.companyId);
      const lines = [
        ...services.map((s) => ({ productId: svcProduct, description: s.description, qty: n(s.qty), unitPrice: n(s.price), taxId: exempt })),
        ...drugs.map((d, k) => ({ productId: d.productId, description: d.description, qty: n(d.qty), unitPrice: n(d.price), taxId: ppn, sourceLineId: doLines[k]?.id })),
      ];
      try {
        const si = (await this.docs.create(
          'SI',
          {
            date: v.date,
            customerId,
            reference: v.number,
            notes: `Visit ${v.number}. Medical services PPN dibebaskan (UU PPN Art. 16B, PP 49/2022 Art. 11, faktur code 08); medicines are goods with PPN.`,
            lines,
          },
          deliveryId ?? undefined,
          { skipPermission: true },
        )) as { id: string };
        await this.docs.confirm('SI', si.id, { skipPermission: true });
        invoiceId = si.id;
      } catch (e) {
        if (deliveryId) await this.docs.cancel('DO', deliveryId, { skipPermission: true });
        throw e;
      }
    }
    await this.prisma.clinicVisit.update({ where: { id }, data: { status: 'BILLED', invoiceId, deliveryId, feeGross: D(feeGross), practitionerFee: D(r2((feeGross * n(pr.feePct)) / 100)) } });
    await this.audit.record('Clinic Visit', id, 'BILL', null, { invoiceId, deliveryId });
    return (await this.queue(v.date)).find((x) => x.id === id);
  }

  private async svcProduct(companyId: string) {
    const f = await this.prisma.product.findFirst({ where: { companyId, code: 'CLINIC-SERVICE', deletedAt: null }, select: { id: true } });
    if (f) return f.id;
    const acc = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, 'CLINIC_REVENUE'));
    return (
      await this.prisma.product.create({
        data: {
          companyId,
          code: 'CLINIC-SERVICE',
          name: 'Medical services (clinic)',
          type: 'SERVICE',
          incomeAccountId: acc,
          isPurchasable: false,
          description: 'Made by the clinic module',
          createdById: RequestCtx.user().id,
        },
      })
    ).id;
  }

  /** undoes the billing while the invoice is unpaid and the fee not paid out */
  async unbill(id: string) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    const v = await this.prisma.clinicVisit.findFirst({ where: { id, companyId: u.companyId } });
    if (!v || v.status !== 'BILLED') throw new ConflictException('Only a billed visit');
    if (v.feeRunId) throw new ConflictException("The practitioner's fee of this visit is booked: cancel that fee run first");
    if (v.invoiceId) await this.docs.cancel('SI', v.invoiceId, { skipPermission: true });
    if (v.deliveryId) await this.docs.cancel('DO', v.deliveryId, { skipPermission: true });
    await this.prisma.clinicVisit.update({ where: { id }, data: { status: 'DONE', invoiceId: null, deliveryId: null, feeGross: D(0), practitionerFee: D(0) } });
    await this.audit.record('Clinic Visit', id, 'UNBILL');
    return { ok: true };
  }

  // ------------------------------------------------------------------ capitation and fees
  async capitations() {
    RequestCtx.assert('clinic.read');
    return (await this.prisma.clinicCapitation.findMany({ where: { companyId: RequestCtx.companyId() }, orderBy: { period: 'desc' } })).map((c) => ({
      ...c,
      amount: n(c.amount),
      withheld: n(c.withheld),
      date: iso(c.date),
    }));
  }

  async addCapitation(input: z.infer<typeof capitationSchema>) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    if (await this.prisma.clinicCapitation.findFirst({ where: { companyId: u.companyId, period: input.period, status: 'POSTED' } }))
      throw new ConflictException(`Capitation of ${input.period} is recorded already`);
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId } });
    if (!bank?.accountId) throw invalid({ bankAccountId: 'Choose a bank account with a ledger account' });
    if (input.withheld >= input.amount) throw invalid({ withheld: 'More than the capitation' });
    const c = await this.prisma.$transaction(async (tx) => {
      const row = await tx.clinicCapitation.create({
        data: { companyId: u.companyId, period: input.period, members: input.members, amount: D(input.amount), withheld: D(input.withheld), bankAccountId: bank.id, date: input.date },
      });
      const j: PostingLine[] = [
        { accountId: bank.accountId, debit: D(r2(input.amount - input.withheld)), description: `Kapitasi JKN ${input.period}` },
        { key: 'CAPITATION_REVENUE', credit: D(input.amount), description: `Kapitasi JKN ${input.period}, ${input.members} participants` },
      ];
      if (input.withheld > 0) j.push({ key: 'WHT_PREPAID', debit: D(input.withheld), description: `Tax withheld by BPJS Kesehatan ${input.period}` });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `BPJS capitation ${input.period}`,
        reference: input.period,
        sourceType: 'CLINIC_CAPITATION',
        sourceId: row.id,
        lines: j,
      });
      return row;
    });
    await this.audit.record('Clinic Capitation', c.id, 'CREATE', null, { period: input.period, amount: input.amount });
    return this.capitations();
  }

  async cancelCapitation(id: string) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    const c = await this.prisma.clinicCapitation.findFirst({ where: { id, companyId: u.companyId, status: 'POSTED' } });
    if (!c) throw new NotFoundException('Not found');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'CLINIC_CAPITATION', id);
      await tx.clinicCapitation.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    return this.capitations();
  }

  /** practitioners not employed: fees of the month's billed visits with PPh 21 (PMK 168/2023) */
  async feePreview(period: string) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const [y, m] = period.split('-').map(Number);
    const visits = await this.prisma.clinicVisit.findMany({
      where: { companyId, status: 'BILLED', feeRunId: null, date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
      select: { id: true, practitionerId: true, feeGross: true, practitionerFee: true },
    });
    const prs = await this.prisma.clinicPractitioner.findMany({ where: { companyId } });
    const runs = await this.prisma.clinicFeeRun.findMany({ where: { companyId, period, status: 'POSTED' } });
    const rows = prs
      .map((p) => {
        const vs = visits.filter((v) => v.practitionerId === p.id);
        const gross = r2(vs.reduce((a, v) => a + n(v.feeGross), 0));
        const fee = r2(vs.reduce((a, v) => a + n(v.practitionerFee), 0));
        const t = practitionerPph21(gross);
        const pph21 = Math.min(t.pph21, fee);
        return {
          practitionerId: p.id,
          name: p.name,
          isEmployee: p.isEmployee,
          visits: vs.length,
          gross,
          fee,
          base: t.base,
          pph21: p.isEmployee ? 0 : pph21,
          net: p.isEmployee ? fee : r2(fee - pph21),
        };
      })
      .filter((r) => r.visits > 0);
    return {
      period,
      rows,
      runs: runs.map((r) => ({ ...r, gross: n(r.gross), fee: n(r.fee), base: n(r.base), pph21: n(r.pph21), net: n(r.net), practitioner: prs.find((p) => p.id === r.practitionerId)?.name ?? null })),
    };
  }

  async postFees(period: string) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    const pv = await this.feePreview(period);
    const rows = pv.rows.filter((r) => !r.isEmployee && r.fee > 0);
    if (!rows.length) throw new ConflictException('No fees of practitioners outside the payroll to book');
    const [y, m] = period.split('-').map(Number);
    const date = new Date(Date.UTC(y, m, 0));
    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const run = await tx.clinicFeeRun.create({
          data: { companyId: u.companyId, period, practitionerId: r.practitionerId, visits: r.visits, gross: D(r.gross), fee: D(r.fee), base: D(r.base), pph21: D(r.pph21), net: D(r.net) },
        });
        const j: PostingLine[] = [
          { key: 'PRACTITIONER_FEES', debit: D(r.fee), description: `Fees ${r.name} ${period}` },
          { key: 'PRACTITIONER_FEES_PAYABLE', credit: D(r.net), description: `Fees ${r.name} ${period} after PPh 21` },
        ];
        if (r.pph21 > 0) j.push({ key: 'PPH21_PAYABLE', credit: D(r.pph21), description: `PPh 21 bukan pegawai ${r.name} ${period} (PMK 168/2023)` });
        await this.journal.post(tx, { companyId: u.companyId, date, description: `Practitioner fees ${r.name} ${period}`, reference: period, sourceType: 'CLINIC_FEES', sourceId: run.id, lines: j });
        await tx.clinicVisit.updateMany({
          where: { companyId: u.companyId, practitionerId: r.practitionerId, status: 'BILLED', feeRunId: null, date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
          data: { feeRunId: run.id },
        });
      }
    });
    await this.audit.record('Clinic Fees', u.companyId, 'CREATE', null, { period, practitioners: rows.length });
    return this.feePreview(period);
  }

  async cancelFeeRun(id: string) {
    RequestCtx.assert('clinic.billing');
    const u = RequestCtx.user();
    const r = await this.prisma.clinicFeeRun.findFirst({ where: { id, companyId: u.companyId, status: 'POSTED' } });
    if (!r) throw new NotFoundException('Not found');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'CLINIC_FEES', id);
      await tx.clinicVisit.updateMany({ where: { feeRunId: id }, data: { feeRunId: null } });
      await tx.clinicFeeRun.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    return this.feePreview(r.period);
  }

  // ------------------------------------------------------------------ reports
  async reports(from: Date, to: Date) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const visits = await this.prisma.clinicVisit.findMany({
      where: { companyId, date: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      select: { payer: true, status: true, diagnoses: true, invoiceId: true, date: true },
    });
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: visits.map((v) => v.invoiceId).filter(Boolean) as string[] }, status: { not: 'CANCELLED' } },
      select: { grandTotal: true, taxTotal: true },
    });
    const byPayer: Record<string, number> = {};
    for (const v of visits) byPayer[v.payer] = (byPayer[v.payer] ?? 0) + 1;
    const dx = new Map<string, { code: string; name: string; count: number }>();
    for (const v of visits)
      for (const d of (v.diagnoses as { code: string; name: string; primary: boolean }[] | null) ?? [])
        if (d.primary) dx.set(d.code, { code: d.code, name: d.name, count: (dx.get(d.code)?.count ?? 0) + 1 });
    return {
      visits: visits.length,
      byPayer,
      billed: r2(inv.reduce((a, i) => a + n(i.grandTotal), 0)),
      ppn: r2(inv.reduce((a, i) => a + n(i.taxTotal), 0)),
      topDiagnoses: [...dx.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    };
  }

  /** controlled medicines of a month: opening, in, out, closing over every warehouse (monthly SIPNAP report) */
  async sipnap(period: string) {
    RequestCtx.assert('clinic.read');
    const companyId = RequestCtx.companyId();
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const ctrl = await this.prisma.clinicControlledDrug.findMany({ where: { companyId } });
    const products = await this.prisma.product.findMany({ where: { id: { in: ctrl.map((c) => c.productId) } }, select: { id: true, code: true, name: true } });
    const moves = await this.prisma.stockMovement.findMany({
      where: { companyId, productId: { in: ctrl.map((c) => c.productId) }, date: { lt: to } },
      select: { productId: true, date: true, qty: true, docType: true },
    });
    return {
      period,
      rows: ctrl.map((c) => {
        const mv = moves.filter((x) => x.productId === c.productId);
        const opening = mv.filter((x) => x.date < from).reduce((a, x) => a + n(x.qty), 0);
        // a reversal (cancelled document) nets against the movement it undoes, not a receipt / issue of its own
        const cur = mv.filter((x) => x.date >= from);
        const rev = (x: { docType: string }) => x.docType.endsWith('-REV');
        const inQ = cur.filter((x) => !rev(x) && n(x.qty) > 0).reduce((a, x) => a + n(x.qty), 0) + cur.filter((x) => rev(x) && n(x.qty) < 0).reduce((a, x) => a + n(x.qty), 0);
        const outQ = -cur.filter((x) => !rev(x) && n(x.qty) < 0).reduce((a, x) => a + n(x.qty), 0) - cur.filter((x) => rev(x) && n(x.qty) > 0).reduce((a, x) => a + n(x.qty), 0);
        const p = products.find((x) => x.id === c.productId);
        return { productId: c.productId, code: p?.code ?? null, name: p?.name ?? null, class: c.class, opening, in: inQ, out: outQ, closing: opening + inQ - outQ };
      }),
    };
  }
}
