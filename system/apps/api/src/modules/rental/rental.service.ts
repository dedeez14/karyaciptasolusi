import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';

type Tx = Prisma.TransactionClient;
const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const today = () => new Date(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const addDays = (d: Date, k: number) => new Date(d.getTime() + k * DAY);
const minD = (a: Date, b: Date) => (a < b ? a : b);
const maxD = (a: Date, b: Date) => (a > b ? a : b);
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));

/** days from a to b, both counted */
export const spanDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY) + 1;

/** months of rent from a to b (both counted): every calendar month counts its days over the days of that month */
export function monthsFraction(from: Date, to: Date) {
  let f = 0;
  for (let c = from; c <= to;) {
    const e = minD(monthEnd(c), to);
    f += spanDays(c, e) / monthEnd(c).getUTCDate();
    c = addDays(e, 1);
  }
  return f;
}

/** rent of one unit from a to b at the contract basis */
export function rentFor(basis: string, rate: number, from: Date, to: Date) {
  const d = spanDays(from, to);
  return r2(basis === 'DAY' ? rate * d : basis === 'WEEK' ? (rate * d) / 7 : rate * monthsFraction(from, to));
}

export const unitSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  category: optText(60),
  serialNo: optText(60),
  fixedAssetId: optUuid,
  meterUnit: z.enum(['NONE', 'HOUR', 'KM']).default('NONE'),
  meter: z.coerce.number().min(0).max(1e9).default(0),
  rateDay: z.coerce.number().min(0).max(1e13).default(0),
  rateWeek: z.coerce.number().min(0).max(1e13).default(0),
  rateMonth: z.coerce.number().min(0).max(1e13).default(0),
  meterAllowance: z.coerce.number().min(0).max(1e7).default(0),
  excessRate: z.coerce.number().min(0).max(1e12).default(0),
  status: z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED']).default('AVAILABLE'),
  notes: optText(1000),
});
export const contractSchema = z
  .object({
    customerId: z.uuid('Customer is required'),
    site: optText(300),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    basis: z.enum(['DAY', 'WEEK', 'MONTH']),
    billing: z.enum(['MONTHLY', 'END']),
    withOperator: z.boolean().default(false),
    deposit: z.coerce.number().min(0).max(1e13).default(0),
    notes: optText(2000),
    lines: z
      .array(z.object({ unitId: z.uuid(), rate: optNum, meterAllowance: optNum, excessRate: optNum }))
      .min(1, 'Add at least one unit')
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Before the start' });
    if (new Set(v.lines.map((l) => l.unitId)).size !== v.lines.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'A unit is listed twice' });
  });
export const handoverSchema = z.object({ date: z.coerce.date(), meters: z.record(z.string(), z.coerce.number().min(0).max(1e9)).default({}) });
export const meterSchema = z.object({ lineId: z.uuid(), date: z.coerce.date(), reading: z.coerce.number().min(0).max(1e9) });
export const returnSchema = z.object({
  date: z.coerce.date(),
  lines: z.array(z.object({ lineId: z.uuid(), meter: optNum, condition: optText(500) })).min(1),
  damage: z.coerce.number().min(0).max(1e13).default(0),
  damageNote: optText(300),
});
export const billSchema = z.object({
  upTo: z.coerce.date(),
  date: z.coerce.date().optional(),
  extras: z
    .array(z.object({ description: z.string().trim().min(1).max(200), amount: z.coerce.number().positive().max(1e13) }))
    .max(10)
    .default([]),
});
export const depositSchema = z.object({
  kind: z.enum(['RECEIVED', 'REFUNDED', 'FORFEITED']),
  amount: z.coerce.number().positive().max(1e13),
  date: z.coerce.date(),
  bankAccountId: optUuid,
  note: optText(300),
});

type Detail = { kind: 'RENT' | 'DAMAGE'; lines: { lineId: string; unitId: string; rent: number; excess: number; meter: number | null; prevMeter: number | null }[]; extras: number };

/**
 * Equipment rental. Rent of movable goods is a taxable service: PPN 12% x DPP 11/12 for a PKP; the lessee withholds
 * PPh 23 2% (sewa harta other than land / buildings, KOP 24-100-02) on the amount before PPN and gives the bukti
 * potong (recorded on the payment). A refundable deposit is a liability; a forfeited deposit or a damage charge is
 * compensation (ganti rugi), not a price for the service, so no PPN (DDTCNews consultation, S-495/PJ.32/1988).
 */
@Injectable()
export class RentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ units
  async units() {
    RequestCtx.assert('rental.read');
    const companyId = RequestCtx.companyId();
    const [units, busy] = await Promise.all([
      this.prisma.rentalUnit.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.rentalLine.findMany({
        where: { returnDate: null, outDate: { not: null }, contract: { companyId, status: 'ON_RENT' } },
        select: { unitId: true, contract: { select: { id: true, number: true } } },
      }),
    ]);
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: units.map((u) => u.fixedAssetId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } });
    return units.map((u) => ({
      ...u,
      meter: n(u.meter),
      rateDay: n(u.rateDay),
      rateWeek: n(u.rateWeek),
      rateMonth: n(u.rateMonth),
      meterAllowance: n(u.meterAllowance),
      excessRate: n(u.excessRate),
      asset: assets.find((a) => a.id === u.fixedAssetId) ?? null,
      onRent: busy.find((b) => b.unitId === u.id)?.contract ?? null,
    }));
  }

  async saveUnit(id: string | null, input: z.infer<typeof unitSchema>) {
    RequestCtx.assert('rental.manage');
    const u = RequestCtx.user();
    if (input.fixedAssetId && !(await this.prisma.fixedAsset.findFirst({ where: { id: input.fixedAssetId, companyId: u.companyId } }))) throw invalid({ fixedAssetId: 'Choose a fixed asset' });
    if (await this.prisma.rentalUnit.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } })) throw invalid({ code: 'Used by another unit' });
    const data = {
      ...input,
      category: input.category ?? null,
      serialNo: input.serialNo ?? null,
      fixedAssetId: input.fixedAssetId ?? null,
      notes: input.notes ?? null,
      meter: D(input.meter),
      rateDay: D(input.rateDay),
      rateWeek: D(input.rateWeek),
      rateMonth: D(input.rateMonth),
      meterAllowance: D(input.meterAllowance),
      excessRate: D(input.excessRate),
    };
    if (id) {
      const cur = await this.prisma.rentalUnit.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Unit not found');
      if (input.status !== 'AVAILABLE' && (await this.prisma.rentalLine.count({ where: { unitId: id, returnDate: null, contract: { status: { in: ['RESERVED', 'ON_RENT'] } } } })))
        throw invalid({ status: 'The unit is booked or on rent' });
      await this.prisma.rentalUnit.update({ where: { id }, data });
    } else await this.prisma.rentalUnit.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Rental Unit', id ?? input.code, id ? 'UPDATE' : 'CREATE', null, { code: input.code });
    return this.units();
  }

  /** units already booked or out on the dates (a line is free again from its return) */
  private async clashes(tx: Tx | PrismaService, companyId: string, unitIds: string[], from: Date, to: Date, excludeContractId: string | null) {
    const rows = await tx.rentalLine.findMany({
      where: {
        unitId: { in: unitIds },
        contract: { companyId, status: { in: ['RESERVED', 'ON_RENT'] }, ...(excludeContractId ? { id: { not: excludeContractId } } : {}) },
        returnDate: null,
      },
      include: { contract: { select: { number: true, startDate: true, endDate: true, status: true } } },
    });
    const t = today();
    return rows.filter((l) => {
      const s = l.outDate ?? l.contract.startDate;
      const e = l.contract.status === 'ON_RENT' ? maxD(l.contract.endDate, t) : l.contract.endDate;
      return s <= to && e >= from;
    });
  }

  // ------------------------------------------------------------------ contracts
  async contracts(status?: string) {
    RequestCtx.assert('rental.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.rentalContract.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      include: { lines: { select: { unitId: true, returnDate: true } } },
      orderBy: { startDate: 'desc' },
      take: 300,
    });
    const [customers, units] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } }),
      this.prisma.rentalUnit.findMany({ where: { companyId }, select: { id: true, code: true } }),
    ]);
    const t = today();
    return rows.map((c) => ({
      id: c.id,
      number: c.number,
      customer: customers.find((x) => x.id === c.customerId)?.name ?? null,
      startDate: iso(c.startDate),
      endDate: iso(c.endDate),
      status: c.status,
      basis: c.basis,
      billing: c.billing,
      billedTo: iso(c.billedTo),
      depositHeld: n(c.depositHeld),
      units: c.lines.map((l) => units.find((u) => u.id === l.unitId)?.code ?? '?'),
      overdue: c.status === 'ON_RENT' && c.endDate < t,
    }));
  }

  async contract(id: string) {
    RequestCtx.assert('rental.read');
    const companyId = RequestCtx.companyId();
    const c = await this.prisma.rentalContract.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!c) throw new NotFoundException('Contract not found');
    const [customer, units, readings, bills, deposits] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, code: true, name: true } }),
      this.prisma.rentalUnit.findMany({ where: { id: { in: c.lines.map((l) => l.unitId) } } }),
      this.prisma.rentalMeterReading.findMany({ where: { lineId: { in: c.lines.map((l) => l.id) } }, orderBy: { date: 'asc' } }),
      this.prisma.rentalBill.findMany({ where: { contractId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.rentalDeposit.findMany({ where: { contractId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const invoices = await this.prisma.tradeDocument.findMany({
      where: { id: { in: bills.map((b) => b.invoiceId).filter((x): x is string => !!x) } },
      select: { id: true, number: true, status: true, grandTotal: true, taxTotal: true, paidAmount: true },
    });
    return {
      ...c,
      deposit: n(c.deposit),
      depositHeld: n(c.depositHeld),
      startDate: iso(c.startDate),
      endDate: iso(c.endDate),
      billedTo: iso(c.billedTo),
      customer,
      lines: c.lines.map((l) => {
        const unit = units.find((x) => x.id === l.unitId)!;
        return {
          id: l.id,
          unitId: l.unitId,
          unit: { code: unit.code, name: unit.name, meterUnit: unit.meterUnit, meter: n(unit.meter) },
          rate: n(l.rate),
          meterAllowance: n(l.meterAllowance),
          excessRate: n(l.excessRate),
          outDate: iso(l.outDate),
          outMeter: l.outMeter === null ? null : n(l.outMeter),
          returnDate: iso(l.returnDate),
          returnMeter: l.returnMeter === null ? null : n(l.returnMeter),
          billedMeter: l.billedMeter === null ? null : n(l.billedMeter),
          condition: l.condition,
          readings: readings.filter((x) => x.lineId === l.id).map((x) => ({ id: x.id, date: iso(x.date), reading: n(x.reading) })),
        };
      }),
      bills: bills.map((b) => {
        const inv = invoices.find((i) => i.id === b.invoiceId);
        return {
          id: b.id,
          kind: (b.detail as Detail).kind,
          periodFrom: iso(b.periodFrom),
          periodTo: iso(b.periodTo),
          amount: n(b.amount),
          status: b.status,
          invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, grandTotal: n(inv.grandTotal), taxTotal: n(inv.taxTotal), paidAmount: n(inv.paidAmount) } : null,
        };
      }),
      deposits: deposits.map((d) => ({ ...d, amount: n(d.amount), date: iso(d.date) })),
    };
  }

  async saveContract(id: string | null, input: z.infer<typeof contractSchema>) {
    RequestCtx.assert('rental.manage');
    const u = RequestCtx.user();
    if (!(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Choose a customer' });
    const units = await this.prisma.rentalUnit.findMany({ where: { companyId: u.companyId, id: { in: input.lines.map((l) => l.unitId) } } });
    if (units.length !== input.lines.length) throw invalid({ lines: 'Choose the units' });
    const off = units.find((x) => x.status !== 'AVAILABLE');
    if (off) throw invalid({ lines: `${off.code} is ${off.status.toLowerCase()}` });
    const rateKey = input.basis === 'DAY' ? 'rateDay' : input.basis === 'WEEK' ? 'rateWeek' : 'rateMonth';
    const lines = input.lines.map((l) => {
      const unit = units.find((x) => x.id === l.unitId)!;
      const rate = l.rate ?? n(unit[rateKey]);
      if (!(rate > 0)) throw invalid({ lines: `${unit.code} has no ${input.basis.toLowerCase()} rate: enter one` });
      return { unitId: l.unitId, rate: D(rate), meterAllowance: D(l.meterAllowance ?? n(unit.meterAllowance)), excessRate: D(l.excessRate ?? n(unit.excessRate)) };
    });
    const saved = await this.prisma.$transaction(async (tx) => {
      const clash = await this.clashes(
        tx,
        u.companyId,
        input.lines.map((l) => l.unitId),
        input.startDate,
        input.endDate,
        id,
      );
      if (clash.length) {
        const c = clash[0];
        throw invalid({ lines: `${units.find((x) => x.id === c.unitId)?.code} is booked on ${c.contract.number} (${iso(c.outDate ?? c.contract.startDate)} to ${iso(c.contract.endDate)})` });
      }
      const head = {
        customerId: input.customerId,
        site: input.site ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        basis: input.basis,
        billing: input.billing,
        withOperator: input.withOperator,
        deposit: D(input.deposit),
        notes: input.notes ?? null,
      };
      if (id) {
        const cur = await tx.rentalContract.findFirst({ where: { id, companyId: u.companyId } });
        if (!cur) throw new NotFoundException('Contract not found');
        if (cur.status !== 'RESERVED') throw new ConflictException('Only a reserved contract changes: the equipment is out');
        await tx.rentalLine.deleteMany({ where: { contractId: id } });
        return tx.rentalContract.update({ where: { id }, data: { ...head, lines: { create: lines } } });
      }
      const number = await this.sequence.next('RENTAL_CONTRACT', u.companyId, input.startDate, tx);
      return tx.rentalContract.create({ data: { ...head, companyId: u.companyId, number, createdById: u.id, lines: { create: lines } } });
    });
    await this.audit.record('Rental Contract', saved.id, id ? 'UPDATE' : 'CREATE', null, { number: saved.number });
    return this.contract(saved.id);
  }

  private async owned(id: string) {
    const c = await this.prisma.rentalContract.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { lines: true } });
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  async cancel(id: string) {
    RequestCtx.assert('rental.manage');
    const c = await this.owned(id);
    if (c.status !== 'RESERVED') throw new ConflictException('Only a reserved contract is cancelled');
    if (n(c.depositHeld) > 0) throw new ConflictException('Refund the deposit first');
    await this.prisma.rentalContract.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Rental Contract', id, 'CANCEL');
    return this.contract(id);
  }

  /** the equipment leaves for the site: out date and meter of every unit */
  async handover(id: string, input: z.infer<typeof handoverSchema>) {
    RequestCtx.assert('rental.manage');
    const c = await this.owned(id);
    if (c.status !== 'RESERVED') throw new ConflictException('Hand over a reserved contract');
    if (input.date > c.endDate) throw invalid({ date: 'After the end of the contract' });
    const units = await this.prisma.rentalUnit.findMany({ where: { id: { in: c.lines.map((l) => l.unitId) } } });
    const bad = units.find((x) => x.status !== 'AVAILABLE');
    if (bad) throw new ConflictException(`${bad.code} is ${bad.status.toLowerCase()}`);
    await this.prisma.$transaction(async (tx) => {
      const clash = await this.clashes(
        tx,
        c.companyId,
        c.lines.map((l) => l.unitId),
        input.date,
        c.endDate,
        id,
      );
      if (clash.length) throw new ConflictException(`${units.find((x) => x.id === clash[0].unitId)?.code} is still on ${clash[0].contract.number}`);
      for (const l of c.lines) {
        const unit = units.find((x) => x.id === l.unitId)!;
        const meter = unit.meterUnit === 'NONE' ? null : (input.meters[l.id] ?? n(unit.meter));
        if (meter !== null && meter < n(unit.meter)) throw invalid({ meters: `${unit.code}: below the last reading ${n(unit.meter)}` });
        await tx.rentalLine.update({ where: { id: l.id }, data: { outDate: input.date, outMeter: meter === null ? null : D(meter), billedMeter: meter === null ? null : D(meter) } });
        if (meter !== null) await tx.rentalUnit.update({ where: { id: unit.id }, data: { meter: D(meter) } });
      }
      await tx.rentalContract.update({ where: { id }, data: { status: 'ON_RENT' } });
    });
    await this.audit.record('Rental Contract', id, 'HANDOVER', null, { date: iso(input.date) });
    return this.contract(id);
  }

  async addReading(id: string, input: z.infer<typeof meterSchema>) {
    RequestCtx.assert('rental.manage');
    const c = await this.owned(id);
    const l = c.lines.find((x) => x.id === input.lineId);
    if (!l || !l.outDate || l.returnDate) throw new ConflictException('Read the meter of a unit on rent');
    const unit = await this.prisma.rentalUnit.findUniqueOrThrow({ where: { id: l.unitId } });
    if (unit.meterUnit === 'NONE') throw new ConflictException(`${unit.code} has no meter`);
    if (input.date < l.outDate) throw invalid({ date: 'Before the handover' });
    const prev = await this.prisma.rentalMeterReading.findFirst({ where: { lineId: l.id, date: { lte: input.date } }, orderBy: [{ date: 'desc' }, { reading: 'desc' }] });
    const floor = Math.max(n(l.outMeter), n(prev?.reading));
    if (input.reading < floor) throw invalid({ reading: `Below the earlier reading ${floor}` });
    const later = await this.prisma.rentalMeterReading.findFirst({ where: { lineId: l.id, date: { gt: input.date }, reading: { lt: D(input.reading) } } });
    if (later) throw invalid({ reading: `Above the later reading of ${iso(later.date)}` });
    await this.prisma.$transaction(async (tx) => {
      await tx.rentalMeterReading.create({ data: { lineId: l.id, date: input.date, reading: D(input.reading) } });
      if (input.reading > n(unit.meter)) await tx.rentalUnit.update({ where: { id: unit.id }, data: { meter: D(input.reading) } });
    });
    return this.contract(id);
  }

  /** units come back (some or all); damage is taken from the deposit, the rest invoiced without PPN */
  async takeBack(id: string, input: z.infer<typeof returnSchema>) {
    RequestCtx.assert('rental.manage');
    const u = RequestCtx.user();
    const c = await this.owned(id);
    if (c.status !== 'ON_RENT') throw new ConflictException('Take back equipment on rent');
    if (input.date > today()) throw invalid({ date: 'In the future' });
    const units = await this.prisma.rentalUnit.findMany({ where: { id: { in: c.lines.map((l) => l.unitId) } } });
    for (const r of input.lines) {
      const l = c.lines.find((x) => x.id === r.lineId);
      if (!l || !l.outDate || l.returnDate) throw invalid({ lines: 'A unit is not on rent' });
      if (input.date < l.outDate) throw invalid({ date: 'Before the handover' });
      const unit = units.find((x) => x.id === l.unitId)!;
      if (unit.meterUnit !== 'NONE') {
        if (r.meter === null || r.meter === undefined) throw invalid({ lines: `${unit.code}: enter the meter` });
        const last = await this.prisma.rentalMeterReading.findFirst({ where: { lineId: l.id }, orderBy: { reading: 'desc' } });
        if (r.meter < Math.max(n(l.outMeter), n(last?.reading))) throw invalid({ lines: `${unit.code}: meter below the earlier reading` });
      }
    }
    const left = c.lines.filter((l) => !l.returnDate && !input.lines.some((r) => r.lineId === l.id));
    const forfeit = Math.min(input.damage, n(c.depositHeld));
    await this.prisma.$transaction(async (tx) => {
      for (const r of input.lines) {
        const l = c.lines.find((x) => x.id === r.lineId)!;
        const unit = units.find((x) => x.id === l.unitId)!;
        const meter = unit.meterUnit === 'NONE' ? null : r.meter!;
        await tx.rentalLine.update({ where: { id: l.id }, data: { returnDate: input.date, returnMeter: meter === null ? null : D(meter), condition: r.condition ?? null } });
        if (meter !== null && meter > n(unit.meter)) await tx.rentalUnit.update({ where: { id: unit.id }, data: { meter: D(meter) } });
      }
      if (!left.length) await tx.rentalContract.update({ where: { id }, data: { status: 'RETURNED' } });
      if (forfeit > 0) await this.depositRow(tx, c, { kind: 'FORFEITED', amount: forfeit, date: input.date, bankAccountId: null, note: `Damage: ${input.damageNote ?? 'on return'}` });
    });
    const rest = r2(input.damage - forfeit);
    if (rest > 0) await this.damageInvoice(c, rest, input.date, input.damageNote ?? 'Damage on return');
    await this.audit.record('Rental Contract', id, 'RETURN', null, { date: iso(input.date), lines: input.lines.length, damage: input.damage, user: u.id });
    return this.contract(id);
  }

  private async product(companyId: string, code: string, name: string, key: string) {
    const f = await this.prisma.product.findFirst({ where: { companyId, code, deletedAt: null }, select: { id: true } });
    if (f) return f.id;
    const acc = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, key));
    return (
      await this.prisma.product.create({
        data: { companyId, code, name, type: 'SERVICE', incomeAccountId: acc, isPurchasable: false, description: 'Made by the rental module', createdById: RequestCtx.user().id },
      })
    ).id;
  }

  private async vat(companyId: string) {
    if (!(await this.settings.bool('sales.vatPayer', companyId, true))) return null;
    const t = await this.prisma.tax.findFirst({ where: { companyId, code: 'PPN12', kind: 'VAT', deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException('Tax PPN12 is missing: add it in Master > Taxes');
    return t.id;
  }

  private async invoice(
    c: { id: string; customerId: string; number: string },
    date: Date,
    notes: string,
    lines: { productId: string; description: string; qty: number; unitPrice: number; taxId: string | null }[],
  ) {
    const si = (await this.docs.create('SI', { date, customerId: c.customerId, reference: c.number, notes, lines }, undefined, { skipPermission: true })) as { id: string };
    try {
      await this.docs.confirm('SI', si.id, { skipPermission: true });
    } catch (e) {
      await this.prisma.tradeDocument.update({ where: { id: si.id }, data: { deletedAt: new Date() } });
      throw e;
    }
    return si.id;
  }

  private async damageInvoice(c: { id: string; companyId: string; customerId: string; number: string }, amount: number, date: Date, note: string) {
    const productId = await this.product(c.companyId, 'RENTAL-DAMAGE', 'Rental damage compensation', 'RENTAL_COMPENSATION');
    const invoiceId = await this.invoice(c, date, `Rental ${c.number}: compensation for damage (ganti rugi), not a price for the rent: no PPN.`, [
      { productId, description: `Damage: ${note}`, qty: 1, unitPrice: amount, taxId: null },
    ]);
    await this.prisma.rentalBill.create({
      data: { companyId: c.companyId, contractId: c.id, periodFrom: date, periodTo: date, invoiceId, amount: D(amount), detail: { kind: 'DAMAGE', lines: [], extras: amount } satisfies Detail },
    });
  }

  /** what a bill up to a date would charge (also the preview) */
  private async compute(c: Prisma.RentalContractGetPayload<{ include: { lines: true } }>, upTo: Date) {
    const out = c.lines.filter((l) => l.outDate);
    if (!out.length) throw new ConflictException('Nothing handed over yet');
    const from = c.billedTo ? addDays(c.billedTo, 1) : out.map((l) => l.outDate!).reduce(minD);
    const units = await this.prisma.rentalUnit.findMany({ where: { id: { in: c.lines.map((l) => l.unitId) } } });
    const rows: (Detail['lines'][number] & { label: string; days: number; excessQty: number; allowance: number; s: Date; e: Date })[] = [];
    for (const l of out) {
      const s = maxD(from, l.outDate!);
      const e = minD(upTo, l.returnDate ?? upTo);
      if (s > e) continue;
      const unit = units.find((x) => x.id === l.unitId)!;
      const rent = rentFor(c.basis, n(l.rate), s, e);
      let meter: number | null = null;
      let prevMeter: number | null = null;
      let excessQty = 0;
      let allowance = 0;
      if (unit.meterUnit !== 'NONE') {
        prevMeter = n(l.billedMeter ?? l.outMeter);
        const rd = await this.prisma.rentalMeterReading.findFirst({ where: { lineId: l.id, date: { lte: e } }, orderBy: [{ date: 'desc' }, { reading: 'desc' }] });
        meter = l.returnDate && l.returnDate <= e ? n(l.returnMeter) : Math.max(prevMeter, n(rd?.reading));
        allowance = r1(n(l.meterAllowance) * monthsFraction(s, e));
        excessQty = r1(Math.max(0, meter - prevMeter - allowance));
      }
      rows.push({
        lineId: l.id,
        unitId: l.unitId,
        rent,
        excess: r2(excessQty * n(l.excessRate)),
        meter,
        prevMeter,
        label: `${unit.code} ${unit.name}`,
        days: spanDays(s, e),
        excessQty,
        allowance,
        s,
        e,
      });
    }
    return { from, rows, unitOf: (id: string) => units.find((x) => x.id === id)! };
  }

  async preview(id: string, upTo: Date) {
    RequestCtx.assert('rental.read');
    const c = await this.owned(id);
    if (!['ON_RENT', 'RETURNED'].includes(c.status)) return { from: null, rows: [], total: 0 };
    const { from, rows } = await this.compute(c, upTo);
    return {
      from: iso(from),
      rows: rows.map((r) => ({
        label: r.label,
        from: iso(r.s),
        to: iso(r.e),
        days: r.days,
        rent: r.rent,
        used: r.meter === null ? null : r1(r.meter - r.prevMeter!),
        allowance: r.allowance,
        excessQty: r.excessQty,
        excess: r.excess,
      })),
      total: r2(rows.reduce((a, r) => a + r.rent + r.excess, 0)),
    };
  }

  async bill(id: string, input: z.infer<typeof billSchema>) {
    RequestCtx.assert('rental.billing');
    const u = RequestCtx.user();
    const c = await this.owned(id);
    if (!['ON_RENT', 'RETURNED'].includes(c.status)) throw new ConflictException('Bill a contract on rent or returned');
    const lastReturn = c.lines.every((l) => l.returnDate) ? c.lines.map((l) => l.returnDate!).reduce(maxD) : null;
    const upTo = lastReturn && input.upTo > lastReturn ? lastReturn : input.upTo;
    if (c.billedTo && upTo <= c.billedTo) throw invalid({ upTo: `Billed up to ${iso(c.billedTo)} already` });
    const { from, rows, unitOf } = await this.compute(c, upTo);
    if (upTo < from) throw invalid({ upTo: `The rent runs from ${iso(from)}` });
    const total = r2(rows.reduce((a, r) => a + r.rent + r.excess, 0) + input.extras.reduce((a, x) => a + x.amount, 0));
    if (!(total > 0)) throw new ConflictException('Nothing to bill');
    const productId = await this.product(u.companyId, 'RENTAL-SERVICE', 'Equipment rental', 'RENTAL_REVENUE');
    const taxId = await this.vat(u.companyId);
    const unitWord = (m: string) => (m === 'HOUR' ? 'hours' : 'km');
    const lines = [
      ...rows
        .filter((r) => r.rent > 0)
        .map((r) => ({
          productId,
          description: `${r.label}: rent ${iso(r.s)} to ${iso(r.e)} (${r.days} days, ${c.basis.toLowerCase()} rate ${n(c.lines.find((l) => l.id === r.lineId)!.rate)})`,
          qty: 1,
          unitPrice: r.rent,
          taxId,
        })),
      ...rows
        .filter((r) => r.excess > 0)
        .map((r) => ({
          productId,
          description: `${r.label}: ${r.excessQty} ${unitWord(unitOf(r.unitId).meterUnit)} above the allowance of ${r.allowance} (meter ${r.prevMeter} to ${r.meter})`,
          qty: r.excessQty,
          unitPrice: n(c.lines.find((l) => l.id === r.lineId)!.excessRate),
          taxId,
        })),
      ...input.extras.map((x) => ({ productId, description: x.description, qty: 1, unitPrice: x.amount, taxId })),
    ];
    const invoiceId = await this.invoice(
      c,
      input.date ?? upTo,
      `Rental ${c.number}, ${iso(from)} to ${iso(upTo)}${c.withOperator ? ', with operator' : ''}. Rent of equipment: PPN. PPh 23 2% (sewa harta, KOP 24-100-02) is withheld by the lessee on the amount before PPN.`,
      lines,
    );
    const bill = await this.prisma.$transaction(async (tx) => {
      const b = await tx.rentalBill.create({
        data: {
          companyId: u.companyId,
          contractId: id,
          periodFrom: from,
          periodTo: upTo,
          invoiceId,
          amount: D(total),
          prevTo: c.billedTo,
          detail: {
            kind: 'RENT',
            lines: rows.map(({ lineId, unitId, rent, excess, meter, prevMeter }) => ({ lineId, unitId, rent, excess, meter, prevMeter })),
            extras: input.extras.reduce((a, x) => a + x.amount, 0),
          } satisfies Detail,
        },
      });
      for (const r of rows) if (r.meter !== null) await tx.rentalLine.update({ where: { id: r.lineId }, data: { billedMeter: D(r.meter) } });
      await tx.rentalContract.update({ where: { id }, data: { billedTo: upTo } });
      return b;
    });
    await this.audit.record('Rental Contract', id, 'BILL', null, { billId: bill.id, invoiceId, total });
    return this.contract(id);
  }

  /** the latest rent bill (or a damage bill) is undone while its invoice is unpaid */
  async cancelBill(billId: string) {
    RequestCtx.assert('rental.billing');
    const b = await this.prisma.rentalBill.findFirst({ where: { id: billId, companyId: RequestCtx.companyId(), status: 'POSTED' } });
    if (!b) throw new NotFoundException('Bill not found');
    const det = b.detail as Detail;
    const c = await this.owned(b.contractId);
    if (c.status === 'CLOSED') throw new ConflictException('The contract is closed');
    if (det.kind === 'RENT') {
      const later = await this.prisma.rentalBill.findFirst({ where: { contractId: b.contractId, status: 'POSTED', periodTo: { gt: b.periodTo } } });
      if (later && (later.detail as Detail).kind === 'RENT') throw new ConflictException('Cancel the later bill first');
    }
    if (b.invoiceId) await this.docs.cancel('SI', b.invoiceId, { skipPermission: true });
    await this.prisma.$transaction(async (tx) => {
      await tx.rentalBill.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
      if (det.kind === 'RENT') {
        for (const l of det.lines) if (l.prevMeter !== null) await tx.rentalLine.update({ where: { id: l.lineId }, data: { billedMeter: D(l.prevMeter) } });
        await tx.rentalContract.update({ where: { id: b.contractId }, data: { billedTo: b.prevTo } });
      }
    });
    await this.audit.record('Rental Contract', b.contractId, 'UNBILL', null, { billId });
    return this.contract(b.contractId);
  }

  // ------------------------------------------------------------------ deposits
  private async depositRow(
    tx: Tx,
    c: { id: string; companyId: string; number: string; depositHeld: Prisma.Decimal },
    d: { kind: string; amount: number; date: Date; bankAccountId: string | null; note: string | null },
  ) {
    const fresh = await tx.rentalContract.findUniqueOrThrow({ where: { id: c.id }, select: { depositHeld: true } });
    const held = n(fresh.depositHeld);
    if (d.kind !== 'RECEIVED' && d.amount > held + 0.001) throw invalid({ amount: `More than the deposit held (${held})` });
    let bankAcc: string | null = null;
    if (d.kind !== 'FORFEITED') {
      const bank = d.bankAccountId ? await tx.bankAccount.findFirst({ where: { id: d.bankAccountId, companyId: c.companyId } }) : null;
      if (!bank?.accountId) throw invalid({ bankAccountId: 'Choose a cash / bank account with a ledger account' });
      bankAcc = bank.accountId;
    }
    const row = await tx.rentalDeposit.create({ data: { companyId: c.companyId, contractId: c.id, kind: d.kind, amount: D(d.amount), date: d.date, bankAccountId: d.bankAccountId, note: d.note } });
    const label = { RECEIVED: 'received', REFUNDED: 'refunded', FORFEITED: 'forfeited' }[d.kind];
    const amt = D(d.amount);
    const j: PostingLine[] =
      d.kind === 'RECEIVED'
        ? [
            { accountId: bankAcc!, debit: amt, description: `Deposit ${c.number}` },
            { key: 'RENTAL_DEPOSIT', credit: amt, description: `Deposit ${c.number}` },
          ]
        : d.kind === 'REFUNDED'
          ? [
              { key: 'RENTAL_DEPOSIT', debit: amt, description: `Deposit refund ${c.number}` },
              { accountId: bankAcc!, credit: amt, description: `Deposit refund ${c.number}` },
            ]
          : [
              { key: 'RENTAL_DEPOSIT', debit: amt, description: `Deposit forfeited ${c.number}` },
              { key: 'RENTAL_COMPENSATION', credit: amt, description: `${d.note ?? 'Deposit forfeited'} ${c.number} (compensation, no PPN)` },
            ];
    await this.journal.post(tx, {
      companyId: c.companyId,
      date: d.date,
      description: `Rental deposit ${label} ${c.number}`,
      reference: c.number,
      sourceType: 'RENTAL_DEPOSIT',
      sourceId: row.id,
      lines: j,
    });
    await tx.rentalContract.update({ where: { id: c.id }, data: { depositHeld: D(r2(held + (d.kind === 'RECEIVED' ? d.amount : -d.amount))) } });
    return row;
  }

  async deposit(id: string, input: z.infer<typeof depositSchema>) {
    RequestCtx.assert('rental.billing');
    const c = await this.owned(id);
    if (['CLOSED', 'CANCELLED'].includes(c.status)) throw new ConflictException(`The contract is ${c.status.toLowerCase()}`);
    if (input.kind === 'FORFEITED' && !input.note) throw invalid({ note: 'Say why the deposit is forfeited' });
    await this.prisma.$transaction((tx) => this.depositRow(tx, c, { kind: input.kind, amount: input.amount, date: input.date, bankAccountId: input.bankAccountId ?? null, note: input.note ?? null }));
    await this.audit.record('Rental Contract', id, `DEPOSIT_${input.kind}`, null, { amount: input.amount });
    return this.contract(id);
  }

  async cancelDeposit(depositId: string) {
    RequestCtx.assert('rental.billing');
    const d = await this.prisma.rentalDeposit.findFirst({ where: { id: depositId, companyId: RequestCtx.companyId(), status: 'POSTED' } });
    if (!d) throw new NotFoundException('Not found');
    const c = await this.owned(d.contractId);
    if (c.status === 'CLOSED') throw new ConflictException('The contract is closed');
    const held = n(c.depositHeld);
    if (d.kind === 'RECEIVED' && n(d.amount) > held + 0.001) throw new ConflictException('Part of this deposit is refunded or forfeited: cancel those first');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'RENTAL_DEPOSIT', d.id);
      await tx.rentalDeposit.update({ where: { id: d.id }, data: { status: 'CANCELLED' } });
      await tx.rentalContract.update({ where: { id: c.id }, data: { depositHeld: D(r2(held + (d.kind === 'RECEIVED' ? -n(d.amount) : n(d.amount)))) } });
    });
    return this.contract(c.id);
  }

  async close(id: string) {
    RequestCtx.assert('rental.billing');
    const c = await this.owned(id);
    if (c.status !== 'RETURNED') throw new ConflictException('Close a contract whose equipment is back');
    const last = c.lines.map((l) => l.returnDate!).reduce(maxD);
    if (!c.billedTo || c.billedTo < last) throw new ConflictException(`Bill the rent up to the return ${iso(last)} first`);
    if (n(c.depositHeld) > 0) throw new ConflictException('Refund or forfeit the deposit held first');
    await this.prisma.rentalContract.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.audit.record('Rental Contract', id, 'CLOSE');
    return this.contract(id);
  }

  // ------------------------------------------------------------------ calendar and reports
  async calendar(from: Date, to: Date) {
    RequestCtx.assert('rental.read');
    const companyId = RequestCtx.companyId();
    const [units, lines] = await Promise.all([
      this.prisma.rentalUnit.findMany({ where: { companyId, status: { not: 'RETIRED' } }, orderBy: { code: 'asc' } }),
      this.prisma.rentalLine.findMany({ where: { contract: { companyId, status: { in: ['RESERVED', 'ON_RENT', 'RETURNED', 'CLOSED'] }, startDate: { lte: to } } }, include: { contract: true } }),
    ]);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.contract.customerId))] } }, select: { id: true, name: true } });
    const t = today();
    const span = (l: (typeof lines)[number]) => ({ s: l.outDate ?? l.contract.startDate, e: l.returnDate ?? (l.contract.status === 'ON_RENT' ? maxD(l.contract.endDate, t) : l.contract.endDate) });
    return {
      from: iso(from),
      to: iso(to),
      units: units.map((u) => ({
        id: u.id,
        code: u.code,
        name: u.name,
        status: u.status,
        bookings: lines
          .filter((l) => l.unitId === u.id && span(l).s <= to && span(l).e >= from)
          .map((l) => ({
            contractId: l.contractId,
            number: l.contract.number,
            customer: customers.find((x) => x.id === l.contract.customerId)?.name ?? null,
            from: iso(span(l).s),
            to: iso(span(l).e),
            status: l.returnDate ? 'RETURNED' : l.contract.status === 'ON_RENT' ? (l.contract.endDate < t ? 'OVERDUE' : 'ON_RENT') : l.contract.status,
          })),
      })),
    };
  }

  /** utilisation (days on rent over the days of the range) and rent billed per unit */
  async reports(from: Date, to: Date) {
    RequestCtx.assert('rental.read');
    const companyId = RequestCtx.companyId();
    const cal = await this.calendar(from, to);
    const bills = await this.prisma.rentalBill.findMany({ where: { companyId, status: 'POSTED', periodTo: { gte: from, lte: to } } });
    const days = spanDays(from, to);
    const units = cal.units.map((u) => {
      const on = u.bookings
        .filter((b) => b.status !== 'RESERVED')
        .reduce((a, b) => {
          const s = maxD(new Date(b.from!), from);
          const e = minD(new Date(b.to!), to);
          return a + (s <= e ? spanDays(s, e) : 0);
        }, 0);
      const billed = bills.reduce((a, b) => a + (b.detail as Detail).lines.filter((l) => l.unitId === u.id).reduce((x, l) => x + l.rent + l.excess, 0), 0);
      return { id: u.id, code: u.code, name: u.name, daysOnRent: Math.min(on, days), utilisation: r2((Math.min(on, days) / days) * 100), billed: r2(billed) };
    });
    const [held, overdue] = await Promise.all([
      this.prisma.rentalContract.aggregate({ where: { companyId, status: { notIn: ['CANCELLED'] } }, _sum: { depositHeld: true } }),
      this.prisma.rentalContract.count({ where: { companyId, status: 'ON_RENT', endDate: { lt: today() } } }),
    ]);
    return {
      days,
      units,
      billed: r2(bills.reduce((a, b) => a + n(b.amount), 0)),
      utilisation: units.length ? r2(units.reduce((a, u) => a + u.utilisation, 0) / units.length) : 0,
      depositsHeld: n(held._sum.depositHeld),
      overdue,
    };
  }
}
