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

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const today = () => new Date(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const VEHICLE_TYPES = ['PICKUP', 'VAN', 'CDE', 'CDD', 'FUSO', 'TRONTON', 'TRAILER', 'OTHER'] as const;
export const EXPENSE_KINDS = ['FUEL', 'TOLL', 'PARKING', 'DRIVER', 'LOADING', 'REPAIR', 'OTHER'] as const;

export const vehicleSchema = z.object({
  plateNo: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, ' ')),
  vehicleType: z.enum(VEHICLE_TYPES),
  brand: optText(60),
  capacityKg: z.coerce.number().min(0).max(1e7).default(0),
  capacityM3: z.coerce.number().min(0).max(1e5).default(0),
  ownership: z.enum(['OWNED', 'RENTED', 'PARTNER']).default('OWNED'),
  assetId: optUuid,
  kirExpiry: optDate,
  stnkExpiry: optDate,
  insuranceExpiry: optDate,
  odometer: z.coerce.number().int().min(0).max(1e8).default(0),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).default('ACTIVE'),
  notes: optText(1000),
});
export const driverSchema = z.object({
  name: z.string().trim().min(1).max(120),
  employeeId: optUuid,
  phone: optText(30),
  simType: optText(12),
  simNo: optText(30),
  simExpiry: optDate,
  isActive: z.boolean().default(true),
});
export const rateSchema = z.object({
  customerId: optUuid,
  service: z.enum(['TRUCKING', 'FORWARDING']),
  origin: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(80),
  vehicleType: z.preprocess((v) => (v === '' ? null : v), z.enum(VEHICLE_TYPES).nullable().optional()),
  basis: z.enum(['TRIP', 'KG', 'M3']).default('TRIP'),
  rate: z.coerce.number().positive().max(1e13),
  minCharge: z.coerce.number().min(0).max(1e13).default(0),
  leadDays: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(0).max(365).nullable().optional()),
  isActive: z.boolean().default(true),
});
export const jobSchema = z.object({
  date: z.coerce.date(),
  customerId: z.uuid(),
  service: z.enum(['TRUCKING', 'FORWARDING']),
  origin: z.string().trim().min(1).max(80),
  originAddress: optText(300),
  destination: z.string().trim().min(1).max(80),
  consignee: optText(150),
  consigneeAddress: optText(300),
  consigneePhone: optText(30),
  cargo: z.string().trim().min(1).max(200),
  pieces: z.coerce.number().int().min(0).max(1e7).default(0),
  weightKg: z.coerce.number().min(0).max(1e8).default(0),
  volumeM3: z.coerce.number().min(0).max(1e6).default(0),
  vehicleType: z.preprocess((v) => (v === '' ? null : v), z.enum(VEHICLE_TYPES).nullable().optional()),
  pickupDate: optDate,
  /// empty = from the rate card
  amount: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).max(1e13).optional()),
  freightCharge: z.coerce.number().min(0).max(1e13).default(0),
  customerRef: optText(80),
  notes: optText(2000),
});
export const tripSchema = z.object({
  date: z.coerce.date(),
  vehicleId: z.uuid(),
  driverId: z.uuid(),
  helper: optText(120),
  route: optText(200),
  odoStart: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().min(0).max(1e8).nullable().optional()),
  jobIds: z.array(z.uuid()).min(1).max(100),
  notes: optText(1000),
});
export const advanceSchema = z.object({ date: z.coerce.date(), amount: z.coerce.number().positive().max(1e12), bankAccountId: z.uuid() });
export const finishSchema = z.object({ odoEnd: z.coerce.number().int().min(0).max(1e8) });
export const settleSchema = z.object({
  date: z.coerce.date(),
  bankAccountId: optUuid,
  expenses: z.array(z.object({ kind: z.enum(EXPENSE_KINDS), amount: z.coerce.number().positive().max(1e12), liters: z.coerce.number().min(0).max(1e6).default(0), note: optText(200) })).max(100),
});
export const podSchema = z.object({ date: z.coerce.date(), receiver: z.string().trim().min(1).max(120), note: optText(300) });
export const linkSchema = z.object({ sourceLineId: z.uuid(), amount: z.coerce.number().positive().max(1e13) });

type Tx = Prisma.TransactionClient;

/**
 * Logistics: trucking and forwarding jobs (waybills) dispatched on trips with checks on the vehicle's KIR (PM 19/2021),
 * STNK and the driver's SIM, and on the load against the capacity (no overloading, UU 22/2009); trip advances settled
 * against the expenses, which are spread over the jobs; jobs invoiced once delivered: public road transport of goods
 * PPN-exempt (PP 49/2022 Art. 19) unless set otherwise, forwarding with freight charges at PPN besaran tertentu 1.1%
 * (PMK 71/2022 jo 11/2025); the customer withholds PPh 23 2% on the service (freight charges reimbursed excluded).
 */
@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  private async product(companyId: string, code: string, name: string, key: string, side: 'income' | 'expense') {
    const found = await this.prisma.product.findFirst({ where: { companyId, code, deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const account = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, key));
    const p = await this.prisma.product.create({
      data: {
        companyId,
        code,
        name,
        type: 'SERVICE',
        ...(side === 'income' ? { incomeAccountId: account, isPurchasable: false } : { expenseAccountId: account, isSellable: false }),
        description: 'Made by the logistics module',
        createdById: RequestCtx.user().id,
      },
    });
    return p.id;
  }

  private async tax(companyId: string, code: string) {
    const t = await this.prisma.tax.findFirst({ where: { companyId, code, kind: 'VAT', deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException(`Tax ${code} is missing: add it in Master > Taxes`);
    return t.id;
  }

  // ------------------------------------------------------------------ fleet
  private shapeVehicle(v: Prisma.FleetVehicleGetPayload<object>) {
    return { ...v, capacityKg: n(v.capacityKg), capacityM3: n(v.capacityM3), kirExpiry: iso(v.kirExpiry), stnkExpiry: iso(v.stnkExpiry), insuranceExpiry: iso(v.insuranceExpiry) };
  }

  async vehicles() {
    RequestCtx.assert('logistics.read');
    return (await this.prisma.fleetVehicle.findMany({ where: { companyId: RequestCtx.companyId() }, orderBy: { plateNo: 'asc' } })).map((v) => this.shapeVehicle(v));
  }

  async saveVehicle(id: string | null, input: z.infer<typeof vehicleSchema>) {
    RequestCtx.assert('logistics.fleet');
    const u = RequestCtx.user();
    const dup = await this.prisma.fleetVehicle.findFirst({ where: { companyId: u.companyId, plateNo: input.plateNo, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ plateNo: 'Plate number already listed' });
    if (id && !(await this.prisma.fleetVehicle.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Vehicle not found');
    const data = {
      ...input,
      capacityKg: D(input.capacityKg),
      capacityM3: D(input.capacityM3),
      assetId: input.assetId ?? null,
      brand: input.brand ?? null,
      kirExpiry: input.kirExpiry ?? null,
      stnkExpiry: input.stnkExpiry ?? null,
      insuranceExpiry: input.insuranceExpiry ?? null,
      notes: input.notes ?? null,
    };
    const v = id ? await this.prisma.fleetVehicle.update({ where: { id }, data }) : await this.prisma.fleetVehicle.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Fleet Vehicle', v.id, id ? 'UPDATE' : 'CREATE', null, { plateNo: v.plateNo });
    return this.shapeVehicle(v);
  }

  async drivers() {
    RequestCtx.assert('logistics.read');
    return (await this.prisma.fleetDriver.findMany({ where: { companyId: RequestCtx.companyId() }, orderBy: { name: 'asc' } })).map((d) => ({ ...d, simExpiry: iso(d.simExpiry) }));
  }

  async saveDriver(id: string | null, input: z.infer<typeof driverSchema>) {
    RequestCtx.assert('logistics.fleet');
    const u = RequestCtx.user();
    if (id && !(await this.prisma.fleetDriver.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Driver not found');
    const data = {
      name: input.name,
      employeeId: input.employeeId ?? null,
      phone: input.phone ?? null,
      simType: input.simType ?? null,
      simNo: input.simNo ?? null,
      simExpiry: input.simExpiry ?? null,
      isActive: input.isActive,
    };
    const d = id ? await this.prisma.fleetDriver.update({ where: { id }, data }) : await this.prisma.fleetDriver.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Fleet Driver', d.id, id ? 'UPDATE' : 'CREATE', null, { name: d.name });
    return { ...d, simExpiry: iso(d.simExpiry) };
  }

  /** documents expired or expiring within 30 days */
  async alerts() {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const soon = new Date(today().getTime() + 30 * DAY);
    const t = today();
    const out: { kind: string; ref: string; doc: string; expiry: string; expired: boolean }[] = [];
    for (const v of await this.prisma.fleetVehicle.findMany({ where: { companyId, status: { not: 'INACTIVE' } } })) {
      for (const [doc, d] of [
        ['KIR (uji berkala)', v.kirExpiry],
        ['STNK', v.stnkExpiry],
        ['Insurance', v.insuranceExpiry],
      ] as const)
        if (d && d <= soon) out.push({ kind: 'VEHICLE', ref: v.plateNo, doc, expiry: iso(d)!, expired: d < t });
    }
    for (const d of await this.prisma.fleetDriver.findMany({ where: { companyId, isActive: true } }))
      if (d.simExpiry && d.simExpiry <= soon) out.push({ kind: 'DRIVER', ref: d.name, doc: `SIM ${d.simType ?? ''}`.trim(), expiry: iso(d.simExpiry)!, expired: d.simExpiry < t });
    return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
  }

  /** per vehicle over a period: trips, km, fuel, costs, revenue of the jobs carried */
  async fleetReport(from: Date, to: Date) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const trips = await this.prisma.logisticsTrip.findMany({ where: { companyId, status: { in: ['DONE', 'SETTLED'] }, date: { gte: from, lte: to } } });
    const jobs = await this.prisma.logisticsJob.findMany({ where: { tripId: { in: trips.map((t) => t.id) }, status: { not: 'CANCELLED' } }, select: { tripId: true, amount: true } });
    const vehicles = await this.prisma.fleetVehicle.findMany({ where: { companyId } });
    return vehicles
      .map((v) => {
        const ts = trips.filter((t) => t.vehicleId === v.id);
        const km = ts.reduce((a, t) => a + Math.max(0, (t.odoEnd ?? 0) - (t.odoStart ?? t.odoEnd ?? 0)), 0);
        const fuel = r2(ts.reduce((a, t) => a + n(t.fuelLiters), 0));
        const cost = r2(ts.reduce((a, t) => a + n(t.expenses), 0));
        const revenue = r2(jobs.filter((j) => ts.some((t) => t.id === j.tripId)).reduce((a, j) => a + n(j.amount), 0));
        return {
          vehicleId: v.id,
          plateNo: v.plateNo,
          vehicleType: v.vehicleType,
          trips: ts.length,
          km,
          fuel,
          kmPerLiter: fuel > 0 ? r2(km / fuel) : null,
          cost,
          costPerKm: km > 0 ? r2(cost / km) : null,
          revenue,
          margin: r2(revenue - cost),
        };
      })
      .filter((x) => x.trips > 0);
  }

  // ------------------------------------------------------------------ rates
  async rates() {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.freightRate.findMany({ where: { companyId }, orderBy: [{ origin: 'asc' }, { destination: 'asc' }] });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, rate: n(r.rate), minCharge: n(r.minCharge), customer: cust.find((c) => c.id === r.customerId)?.name ?? null }));
  }

  async saveRate(id: string | null, input: z.infer<typeof rateSchema>) {
    RequestCtx.assert('logistics.fleet');
    const u = RequestCtx.user();
    if (id && !(await this.prisma.freightRate.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Rate not found');
    const data = {
      customerId: input.customerId ?? null,
      service: input.service,
      origin: input.origin,
      destination: input.destination,
      vehicleType: input.vehicleType ?? null,
      basis: input.basis,
      rate: D(input.rate),
      minCharge: D(input.minCharge),
      leadDays: input.leadDays ?? null,
      isActive: input.isActive,
    };
    const r = id ? await this.prisma.freightRate.update({ where: { id }, data }) : await this.prisma.freightRate.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Freight Rate', r.id, id ? 'UPDATE' : 'CREATE');
    return { ...r, rate: n(r.rate), minCharge: n(r.minCharge) };
  }

  /** the customer's own rate first, then the general one; the vehicle type must match when the rate names one */
  async quote(q: { customerId: string; service: string; origin: string; destination: string; vehicleType?: string | null; weightKg: number; volumeM3: number }) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.freightRate.findMany({
      where: {
        companyId,
        isActive: true,
        service: q.service,
        origin: { equals: q.origin, mode: 'insensitive' },
        destination: { equals: q.destination, mode: 'insensitive' },
        OR: [{ customerId: q.customerId }, { customerId: null }],
      },
    });
    const fit = rows
      .filter((r) => !r.vehicleType || r.vehicleType === q.vehicleType)
      .sort((a, b) => (a.customerId ? 0 : 1) - (b.customerId ? 0 : 1) || (a.vehicleType ? 0 : 1) - (b.vehicleType ? 0 : 1));
    const r = fit[0];
    if (!r) return null;
    const raw = r.basis === 'KG' ? n(r.rate) * q.weightKg : r.basis === 'M3' ? n(r.rate) * q.volumeM3 : n(r.rate);
    return { rateId: r.id, basis: r.basis, rate: n(r.rate), amount: r2(Math.max(raw, n(r.minCharge))), leadDays: r.leadDays, own: !!r.customerId };
  }

  // ------------------------------------------------------------------ jobs
  private shapeJob(j: Prisma.LogisticsJobGetPayload<object>) {
    return {
      ...j,
      date: iso(j.date),
      pickupDate: iso(j.pickupDate),
      podDate: iso(j.podDate),
      weightKg: n(j.weightKg),
      volumeM3: n(j.volumeM3),
      rate: n(j.rate),
      amount: n(j.amount),
      freightCharge: n(j.freightCharge),
      tripCost: n(j.tripCost),
    };
  }

  async jobs(status?: string) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.logisticsJob.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 500,
    });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } });
    const trips = await this.prisma.logisticsTrip.findMany({ where: { id: { in: rows.map((r) => r.tripId).filter(Boolean) as string[] } }, select: { id: true, number: true } });
    const inv = await this.prisma.tradeDocument.findMany({ where: { id: { in: rows.map((r) => r.invoiceId).filter(Boolean) as string[] } }, select: { id: true, number: true } });
    return rows.map((r) => ({
      ...this.shapeJob(r),
      customer: cust.find((c) => c.id === r.customerId)?.name ?? null,
      trip: trips.find((t) => t.id === r.tripId)?.number ?? null,
      invoice: inv.find((i) => i.id === r.invoiceId) ?? null,
    }));
  }

  async job(id: string) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const j = await this.prisma.logisticsJob.findFirst({ where: { id, companyId } });
    if (!j) throw new NotFoundException('Job not found');
    const [customer, trip, invoice, carrier] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: j.customerId }, select: { id: true, code: true, name: true } }),
      j.tripId ? this.prisma.logisticsTrip.findUnique({ where: { id: j.tripId } }) : null,
      j.invoiceId ? this.prisma.tradeDocument.findUnique({ where: { id: j.invoiceId }, select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true } }) : null,
      this.prisma.jobCarrierCost.findMany({ where: { jobId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const vehicle = trip ? await this.prisma.fleetVehicle.findUnique({ where: { id: trip.vehicleId }, select: { plateNo: true, vehicleType: true } }) : null;
    const driver = trip ? await this.prisma.fleetDriver.findUnique({ where: { id: trip.driverId }, select: { name: true, phone: true } }) : null;
    const pis = await this.prisma.tradeDocument.findMany({ where: { id: { in: carrier.map((c) => c.sourceDocId) } }, select: { id: true, number: true, supplierId: true } });
    const carrierCost = r2(carrier.reduce((a, c) => a + n(c.amount), 0));
    return {
      ...this.shapeJob(j),
      customer,
      trip: trip ? { id: trip.id, number: trip.number, date: iso(trip.date), status: trip.status, vehicle, driver } : null,
      invoice: invoice ? { ...invoice, grandTotal: n(invoice.grandTotal), paidAmount: n(invoice.paidAmount) } : null,
      carrierCosts: carrier.map((c) => ({ id: c.id, amount: n(c.amount), bill: pis.find((p) => p.id === c.sourceDocId)?.number ?? null })),
      costing: { revenue: n(j.amount), tripCost: n(j.tripCost), carrierCost, margin: r2(n(j.amount) - n(j.tripCost) - carrierCost) },
    };
  }

  async saveJob(id: string | null, input: z.infer<typeof jobSchema>) {
    RequestCtx.assert('logistics.job');
    const u = RequestCtx.user();
    const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!c) throw invalid({ customerId: 'Choose the customer' });
    let amount = input.amount;
    let rate: Awaited<ReturnType<LogisticsService['quote']>> = null;
    if (amount === undefined) {
      rate = await this.quote({
        customerId: input.customerId,
        service: input.service,
        origin: input.origin,
        destination: input.destination,
        vehicleType: input.vehicleType ?? null,
        weightKg: input.weightKg,
        volumeM3: input.volumeM3,
      });
      if (!rate) throw invalid({ amount: `No rate card for ${input.origin} - ${input.destination}: enter the price` });
      amount = rate.amount;
    }
    if (input.service === 'FORWARDING' && input.freightCharge > amount) throw invalid({ freightCharge: 'Freight charges are more than the price' });
    const data = {
      date: input.date,
      customerId: input.customerId,
      service: input.service,
      origin: input.origin,
      originAddress: input.originAddress ?? null,
      destination: input.destination,
      consignee: input.consignee ?? null,
      consigneeAddress: input.consigneeAddress ?? null,
      consigneePhone: input.consigneePhone ?? null,
      cargo: input.cargo,
      pieces: input.pieces,
      weightKg: D(input.weightKg),
      volumeM3: D(input.volumeM3),
      vehicleType: input.vehicleType ?? null,
      pickupDate: input.pickupDate ?? null,
      rateId: rate?.rateId ?? null,
      basis: rate?.basis ?? 'TRIP',
      rate: D(rate?.rate ?? amount),
      amount: D(amount),
      freightCharge: D(input.service === 'FORWARDING' ? input.freightCharge : 0),
      customerRef: input.customerRef ?? null,
      notes: input.notes ?? null,
    };
    let j;
    if (id) {
      const cur = await this.prisma.logisticsJob.findFirst({ where: { id, companyId: u.companyId } });
      if (!cur) throw new NotFoundException('Job not found');
      if (['INVOICED', 'CANCELLED'].includes(cur.status)) throw new ConflictException('The job is invoiced or cancelled');
      if (cur.status !== 'OPEN' && (cur.customerId !== input.customerId || cur.service !== input.service)) throw new ConflictException('Dispatched: customer and service stay');
      j = await this.prisma.logisticsJob.update({ where: { id }, data });
    } else
      j = await this.prisma.logisticsJob.create({
        data: { ...data, companyId: u.companyId, number: await this.prisma.$transaction((tx) => this.sequence.next('LOG_JOB', u.companyId, input.date, tx)), createdById: u.id },
      });
    await this.audit.record('Logistics Job', j.id, id ? 'UPDATE' : 'CREATE', null, { number: j.number, amount });
    return this.job(j.id);
  }

  async cancelJob(id: string) {
    RequestCtx.assert('logistics.job');
    const u = RequestCtx.user();
    const j = await this.prisma.logisticsJob.findFirst({ where: { id, companyId: u.companyId } });
    if (!j) throw new NotFoundException('Job not found');
    if (j.status !== 'OPEN') throw new ConflictException('Only a job not dispatched can be cancelled (take it off its trip first)');
    await this.prisma.logisticsJob.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Logistics Job', id, 'CANCEL');
    return this.job(id);
  }

  async pod(id: string, input: z.infer<typeof podSchema>) {
    RequestCtx.assert('logistics.job');
    const u = RequestCtx.user();
    const j = await this.prisma.logisticsJob.findFirst({ where: { id, companyId: u.companyId } });
    if (!j) throw new NotFoundException('Job not found');
    if (j.status !== 'DISPATCHED') throw new ConflictException('Proof of delivery is for a dispatched job');
    const trip = await this.prisma.logisticsTrip.findUniqueOrThrow({ where: { id: j.tripId! } });
    if (input.date < trip.date) throw invalid({ date: 'Delivered before the trip left' });
    await this.prisma.logisticsJob.update({ where: { id }, data: { status: 'DELIVERED', podDate: input.date, podReceiver: input.receiver, podNote: input.note ?? null } });
    await this.audit.record('Logistics Job', id, 'POD', null, { receiver: input.receiver });
    return this.job(id);
  }

  // ------------------------------------------------------------------ trips
  private async checkDispatch(tx: Tx, companyId: string, date: Date, vehicleId: string, driverId: string, jobIds: string[], tripId: string | null) {
    const v = await tx.fleetVehicle.findFirst({ where: { id: vehicleId, companyId } });
    if (!v || v.status !== 'ACTIVE') throw invalid({ vehicleId: 'Choose an active vehicle' });
    if (!v.kirExpiry || v.kirExpiry < date)
      throw invalid({ vehicleId: `${v.plateNo}: KIR (uji berkala) ${v.kirExpiry ? `expired ${iso(v.kirExpiry)}` : 'not recorded'}: a goods vehicle needs a valid periodic test (PM 19/2021)` });
    if (!v.stnkExpiry || v.stnkExpiry < date) throw invalid({ vehicleId: `${v.plateNo}: STNK ${v.stnkExpiry ? `expired ${iso(v.stnkExpiry)}` : 'not recorded'}` });
    const d = await tx.fleetDriver.findFirst({ where: { id: driverId, companyId, isActive: true } });
    if (!d) throw invalid({ driverId: 'Choose an active driver' });
    if (!d.simExpiry || d.simExpiry < date) throw invalid({ driverId: `${d.name}: SIM ${d.simExpiry ? `expired ${iso(d.simExpiry)}` : 'not recorded'}` });
    const busy = await tx.logisticsTrip.findFirst({ where: { companyId, status: 'OPEN', OR: [{ vehicleId }, { driverId }], ...(tripId ? { id: { not: tripId } } : {}) } });
    if (busy) throw new ConflictException(`${busy.vehicleId === vehicleId ? v.plateNo : d.name} is on trip ${busy.number} still open`);
    const jobs = await tx.logisticsJob.findMany({ where: { id: { in: jobIds }, companyId } });
    if (jobs.length !== new Set(jobIds).size) throw invalid({ jobIds: 'Choose jobs of this company' });
    const wrong = jobs.find((j) => !(j.status === 'OPEN' || (tripId && j.tripId === tripId && j.status === 'DISPATCHED')));
    if (wrong) throw invalid({ jobIds: `${wrong.number} is not open` });
    const kg = jobs.reduce((a, j) => a + n(j.weightKg), 0);
    const m3 = jobs.reduce((a, j) => a + n(j.volumeM3), 0);
    if (n(v.capacityKg) > 0 && kg > n(v.capacityKg)) throw invalid({ jobIds: `${fmt(kg)} kg on ${v.plateNo} with a capacity of ${fmt(n(v.capacityKg))} kg: overloading is not allowed (UU 22/2009)` });
    if (n(v.capacityM3) > 0 && m3 > n(v.capacityM3)) throw invalid({ jobIds: `${fmt(m3)} m3 on ${v.plateNo} with room for ${fmt(n(v.capacityM3))} m3` });
    return { v, d, jobs };
  }

  async trips(status?: string) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.logisticsTrip.findMany({
      where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 300,
    });
    const vs = await this.prisma.fleetVehicle.findMany({ where: { id: { in: rows.map((r) => r.vehicleId) } }, select: { id: true, plateNo: true, vehicleType: true } });
    const ds = await this.prisma.fleetDriver.findMany({ where: { id: { in: rows.map((r) => r.driverId) } }, select: { id: true, name: true } });
    const jobs = await this.prisma.logisticsJob.groupBy({
      by: ['tripId'],
      where: { tripId: { in: rows.map((r) => r.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { amount: true, weightKg: true },
    });
    return rows.map((r) => {
      const j = jobs.find((x) => x.tripId === r.id);
      return {
        ...this.shapeTrip(r),
        vehicle: vs.find((v) => v.id === r.vehicleId) ?? null,
        driver: ds.find((d) => d.id === r.driverId)?.name ?? null,
        jobs: j?._count._all ?? 0,
        revenue: n(j?._sum.amount),
        weightKg: n(j?._sum.weightKg),
      };
    });
  }

  private shapeTrip(t: Prisma.LogisticsTripGetPayload<object>) {
    return { ...t, date: iso(t.date), advance: n(t.advance), expenses: n(t.expenses), fuelLiters: n(t.fuelLiters), km: t.odoEnd !== null && t.odoStart !== null ? t.odoEnd - t.odoStart : null };
  }

  async trip(id: string) {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId }, include: { costs: true } });
    if (!t) throw new NotFoundException('Trip not found');
    const [vehicle, driver, jobs] = await Promise.all([
      this.prisma.fleetVehicle.findUnique({ where: { id: t.vehicleId } }),
      this.prisma.fleetDriver.findUnique({ where: { id: t.driverId } }),
      this.prisma.logisticsJob.findMany({ where: { tripId: id, status: { not: 'CANCELLED' } }, orderBy: { number: 'asc' } }),
    ]);
    const cust = await this.prisma.customer.findMany({ where: { id: { in: jobs.map((j) => j.customerId) } }, select: { id: true, name: true } });
    const { costs, ...head } = t;
    return {
      ...this.shapeTrip(head),
      vehicle: vehicle ? this.shapeVehicle(vehicle) : null,
      driver: driver ? { ...driver, simExpiry: iso(driver.simExpiry) } : null,
      expenseLines: costs.map((c) => ({ ...c, amount: n(c.amount), liters: n(c.liters) })),
      jobs: jobs.map((j) => ({ ...this.shapeJob(j), customer: cust.find((c) => c.id === j.customerId)?.name ?? null })),
    };
  }

  async createTrip(input: z.infer<typeof tripSchema>) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const trip = await this.prisma.$transaction(async (tx) => {
      const { v } = await this.checkDispatch(tx, u.companyId, input.date, input.vehicleId, input.driverId, input.jobIds, null);
      const t = await tx.logisticsTrip.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('LOG_TRIP', u.companyId, input.date, tx),
          date: input.date,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          helper: input.helper ?? null,
          route: input.route ?? null,
          odoStart: input.odoStart ?? v.odometer,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
      await tx.logisticsJob.updateMany({ where: { id: { in: input.jobIds } }, data: { status: 'DISPATCHED', tripId: t.id } });
      return t;
    });
    await this.audit.record('Logistics Trip', trip.id, 'CREATE', null, { number: trip.number, jobs: input.jobIds.length });
    return this.trip(trip.id);
  }

  /** jobs on an open trip: add or take off (only jobs not delivered) */
  async setTripJobs(id: string, jobIds: string[]) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || t.status !== 'OPEN') throw new ConflictException('Only an open trip');
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.logisticsJob.findMany({ where: { tripId: id, status: { not: 'CANCELLED' } } });
      const off = current.filter((j) => !jobIds.includes(j.id));
      if (off.some((j) => j.status !== 'DISPATCHED')) throw new ConflictException('A delivered job stays on its trip');
      if (!jobIds.length) throw invalid({ jobIds: 'A trip carries at least one job (cancel the trip instead)' });
      await this.checkDispatch(tx, u.companyId, t.date, t.vehicleId, t.driverId, jobIds, id);
      await tx.logisticsJob.updateMany({ where: { id: { in: off.map((j) => j.id) } }, data: { status: 'OPEN', tripId: null } });
      await tx.logisticsJob.updateMany({ where: { id: { in: jobIds }, status: 'OPEN' }, data: { status: 'DISPATCHED', tripId: id } });
    });
    await this.audit.record('Logistics Trip', id, 'JOBS', null, { jobs: jobIds.length });
    return this.trip(id);
  }

  /** trip advance (uang jalan): Dr Driver advances / Cr the cash or bank account */
  async giveAdvance(id: string, input: z.infer<typeof advanceSchema>) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || !['OPEN', 'DONE'].includes(t.status)) throw new ConflictException('Only a trip not settled');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId } });
    if (!bank?.accountId) throw invalid({ bankAccountId: 'Choose a cash / bank account with a ledger account' });
    if (t.advanceAccountId && t.advanceAccountId !== bank.id) throw invalid({ bankAccountId: 'Give the advances of a trip from one account' });
    const driver = await this.prisma.fleetDriver.findUniqueOrThrow({ where: { id: t.driverId } });
    await this.prisma.$transaction(async (tx) => {
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Trip advance ${t.number} to ${driver.name}`,
        reference: t.number,
        sourceType: 'LOG_TRIP_ADV',
        sourceId: id,
        lines: [
          { key: 'DRIVER_ADVANCE', debit: D(input.amount), description: `${t.number} ${driver.name}` },
          { accountId: bank.accountId, credit: D(input.amount), description: `Trip advance ${t.number}` },
        ],
      });
      await tx.logisticsTrip.update({ where: { id }, data: { advance: { increment: D(input.amount) }, advanceAccountId: bank.id } });
    });
    await this.audit.record('Logistics Trip', id, 'ADVANCE', null, { amount: input.amount });
    return this.trip(id);
  }

  async finishTrip(id: string, input: z.infer<typeof finishSchema>) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || t.status !== 'OPEN') throw new ConflictException('Only an open trip');
    if (t.odoStart !== null && input.odoEnd < t.odoStart) throw invalid({ odoEnd: `The odometer was ${t.odoStart} at the start` });
    const open = await this.prisma.logisticsJob.count({ where: { tripId: id, status: 'DISPATCHED' } });
    if (open) throw new ConflictException(`${open} job(s) without proof of delivery: record the POD or take them off the trip`);
    await this.prisma.$transaction(async (tx) => {
      await tx.logisticsTrip.update({ where: { id }, data: { status: 'DONE', odoEnd: input.odoEnd } });
      const v = await tx.fleetVehicle.findUniqueOrThrow({ where: { id: t.vehicleId } });
      if (input.odoEnd > v.odometer) await tx.fleetVehicle.update({ where: { id: v.id }, data: { odometer: input.odoEnd } });
    });
    await this.audit.record('Logistics Trip', id, 'FINISH', null, { odoEnd: input.odoEnd });
    return this.trip(id);
  }

  /**
   * Settlement of the trip: the expenses to Trip Costs, the advance cleared, the difference returned by the driver or paid
   * to him; the expenses spread over the jobs by their price (equally when unpriced).
   */
  async settle(id: string, input: z.infer<typeof settleSchema>) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || t.status !== 'DONE') throw new ConflictException('Finish the trip first');
    const total = r2(input.expenses.reduce((a, e) => a + e.amount, 0));
    const diff = r2(n(t.advance) - total);
    const bankId = input.bankAccountId ?? t.advanceAccountId;
    const bank = bankId ? await this.prisma.bankAccount.findFirst({ where: { id: bankId, companyId: u.companyId } }) : null;
    if (diff !== 0 && !bank?.accountId) throw invalid({ bankAccountId: 'Choose the cash / bank account for the difference' });
    const driver = await this.prisma.fleetDriver.findUniqueOrThrow({ where: { id: t.driverId } });
    const jobs = await this.prisma.logisticsJob.findMany({ where: { tripId: id, status: { not: 'CANCELLED' } }, orderBy: { number: 'asc' } });
    await this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [];
      if (total > 0) j.push({ key: 'TRIP_COST', debit: D(total), description: `Trip ${t.number} expenses` });
      if (n(t.advance) > 0) j.push({ key: 'DRIVER_ADVANCE', credit: t.advance, description: `${t.number} ${driver.name} settled` });
      if (diff > 0) j.push({ accountId: bank!.accountId, debit: D(diff), description: `Returned by ${driver.name}` });
      if (diff < 0) j.push({ accountId: bank!.accountId, credit: D(-diff), description: `Paid to ${driver.name}` });
      if (j.length)
        await this.journal.post(tx, {
          companyId: u.companyId,
          date: input.date,
          description: `Trip settlement ${t.number}`,
          reference: t.number,
          sourceType: 'LOG_TRIP_SETTLE',
          sourceId: id,
          lines: j,
        });
      await tx.tripExpense.deleteMany({ where: { tripId: id } });
      if (input.expenses.length) await tx.tripExpense.createMany({ data: input.expenses.map((e) => ({ tripId: id, kind: e.kind, amount: D(e.amount), liters: D(e.liters), note: e.note ?? null })) });
      const base = jobs.reduce((a, x) => a + n(x.amount), 0);
      let given = 0;
      for (const [k, x] of jobs.entries()) {
        const share = k === jobs.length - 1 ? r2(total - given) : r2(base > 0 ? (total * n(x.amount)) / base : total / jobs.length);
        given = r2(given + share);
        await tx.logisticsJob.update({ where: { id: x.id }, data: { tripCost: D(share) } });
      }
      await tx.logisticsTrip.update({
        where: { id },
        data: { status: 'SETTLED', expenses: D(total), fuelLiters: D(r2(input.expenses.reduce((a, e) => a + (e.kind === 'FUEL' ? e.liters : 0), 0))), settledAt: new Date() },
      });
    });
    await this.audit.record('Logistics Trip', id, 'SETTLE', null, { expenses: total, difference: diff });
    return this.trip(id);
  }

  async unsettle(id: string) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || t.status !== 'SETTLED') throw new ConflictException('Only a settled trip');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'LOG_TRIP_SETTLE', id);
      await tx.logisticsJob.updateMany({ where: { tripId: id }, data: { tripCost: D(0) } });
      await tx.logisticsTrip.update({ where: { id }, data: { status: 'DONE', expenses: D(0), fuelLiters: D(0), settledAt: null } });
    });
    await this.audit.record('Logistics Trip', id, 'UNSETTLE');
    return this.trip(id);
  }

  async cancelTrip(id: string) {
    RequestCtx.assert('logistics.dispatch');
    const u = RequestCtx.user();
    const t = await this.prisma.logisticsTrip.findFirst({ where: { id, companyId: u.companyId } });
    if (!t || t.status !== 'OPEN') throw new ConflictException('Only an open trip can be cancelled');
    if (n(t.advance) > 0) throw new ConflictException('An advance was given: finish and settle the trip instead');
    if (await this.prisma.logisticsJob.count({ where: { tripId: id, status: 'DELIVERED' } })) throw new ConflictException('Jobs are delivered on this trip');
    await this.prisma.$transaction(async (tx) => {
      await tx.logisticsJob.updateMany({ where: { tripId: id }, data: { status: 'OPEN', tripId: null } });
      await tx.logisticsTrip.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Logistics Trip', id, 'CANCEL');
    return this.trip(id);
  }

  // ------------------------------------------------------------------ invoicing
  /** delivered jobs of one customer: one invoice per service (trucking / forwarding have different PPN) */
  async invoiceJobs(jobIds: string[]) {
    RequestCtx.assert('logistics.invoice');
    const u = RequestCtx.user();
    const jobs = await this.prisma.logisticsJob.findMany({ where: { id: { in: jobIds }, companyId: u.companyId }, orderBy: { number: 'asc' } });
    if (!jobs.length || jobs.length !== new Set(jobIds).size) throw invalid({ jobIds: 'Choose jobs of this company' });
    const bad = jobs.find((j) => j.status !== 'DELIVERED');
    if (bad) throw invalid({ jobIds: `${bad.number} is ${bad.status === 'INVOICED' ? 'invoiced already' : 'not delivered yet'}` });
    if (new Set(jobs.map((j) => j.customerId)).size > 1) throw invalid({ jobIds: 'Invoice the jobs of one customer at a time' });
    const pkp = await this.settings.bool('sales.vatPayer', u.companyId, true);
    const truckVat = await this.settings.str('logistics.truckVat', u.companyId, 'EXEMPT');
    const freight = await this.product(u.companyId, 'LOG-FREIGHT', 'Freight and logistics service', 'FREIGHT_REVENUE', 'income');
    const made: string[] = [];
    // forwarding with freight charges on the invoice: besaran tertentu (code 05); a fee-only forwarding job: normal PPN (code 04)
    const kinds = {
      TRUCKING: (j: (typeof jobs)[number]) => j.service === 'TRUCKING',
      FORWARDING: (j: (typeof jobs)[number]) => j.service === 'FORWARDING' && n(j.freightCharge) > 0,
      FEE: (j: (typeof jobs)[number]) => j.service === 'FORWARDING' && n(j.freightCharge) <= 0,
    };
    for (const [service, pick] of Object.entries(kinds)) {
      const group = jobs.filter(pick);
      if (!group.length) continue;
      const lines: Record<string, unknown>[] = [];
      let fee = 0;
      if (service === 'TRUCKING') {
        const taxId = !pkp ? null : await this.tax(u.companyId, truckVat === 'STANDARD' ? 'PPN12' : 'PPN-ANGKUTAN');
        for (const j of group) {
          lines.push({
            productId: freight,
            description: `${j.number} ${j.origin} - ${j.destination}: ${j.cargo}${j.customerRef ? ` (ref ${j.customerRef})` : ''}, delivered ${iso(j.podDate)}`,
            qty: 1,
            unitPrice: n(j.amount),
            taxId,
          });
          fee += n(j.amount);
        }
      } else {
        const taxId = !pkp ? null : await this.tax(u.companyId, service === 'FORWARDING' ? 'PPN-FF' : 'PPN12');
        for (const j of group) {
          if (n(j.freightCharge) > 0) lines.push({ productId: freight, description: `${j.number} freight charges ${j.origin} - ${j.destination}`, qty: 1, unitPrice: n(j.freightCharge), taxId });
          if (n(j.amount) - n(j.freightCharge) > 0)
            lines.push({ productId: freight, description: `${j.number} forwarding service: ${j.cargo}`, qty: 1, unitPrice: r2(n(j.amount) - n(j.freightCharge)), taxId });
          fee += n(j.amount) - n(j.freightCharge);
        }
      }
      const notes = [
        service === 'TRUCKING'
          ? truckVat === 'STANDARD' || !pkp
            ? ''
            : 'PPN DIBEBASKAN SESUAI PP 49 TAHUN 2022 (jasa angkutan umum di jalan, faktur code 08).'
          : service === 'FORWARDING' && pkp
            ? 'PPN besaran tertentu 1.1% of the amount billed, the invoice including the freight charges (PMK 71/2022 jo PMK 11/2025, faktur code 05).'
            : '',
        `PPh 23 2% is withheld on the service of Rp${r2(fee).toLocaleString('id-ID')}${service === 'FORWARDING' ? ', not on the freight charges reimbursed' : ''} (PMK 141/2015).`,
      ]
        .filter(Boolean)
        .join('\n');
      const doc = (await this.docs.create(
        'SI',
        {
          date: today(),
          customerId: group[0].customerId,
          reference: group
            .map((j) => j.number)
            .join(', ')
            .slice(0, 100),
          notes,
          lines,
        },
        undefined,
        { skipPermission: true },
      )) as { id: string; number: string };
      try {
        await this.docs.confirm('SI', doc.id, { skipPermission: true });
      } catch (e) {
        await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
        throw e;
      }
      await this.prisma.logisticsJob.updateMany({ where: { id: { in: group.map((j) => j.id) } }, data: { status: 'INVOICED', invoiceId: doc.id } });
      made.push(doc.number);
    }
    await this.audit.record('Logistics Job', jobs[0].id, 'INVOICE', null, { invoices: made, jobs: jobs.length });
    return { invoices: made };
  }

  /** cancels the invoice of a job (while unpaid): its jobs go back to delivered */
  async uninvoice(jobId: string) {
    RequestCtx.assert('logistics.invoice');
    const u = RequestCtx.user();
    const j = await this.prisma.logisticsJob.findFirst({ where: { id: jobId, companyId: u.companyId } });
    if (!j || j.status !== 'INVOICED' || !j.invoiceId) throw new ConflictException('The job is not invoiced');
    const inv = await this.prisma.tradeDocument.findUnique({ where: { id: j.invoiceId } });
    if (inv && inv.status !== 'CANCELLED') await this.docs.cancel('SI', inv.id, { skipPermission: true });
    await this.prisma.logisticsJob.updateMany({ where: { invoiceId: j.invoiceId }, data: { status: 'DELIVERED', invoiceId: null } });
    await this.audit.record('Logistics Job', jobId, 'UNINVOICE', null, { invoice: inv?.number });
    return this.job(jobId);
  }

  // ------------------------------------------------------------------ carrier bills on forwarding jobs
  async openCarrierLines() {
    RequestCtx.assert('logistics.read');
    const companyId = RequestCtx.companyId();
    const p = await this.prisma.product.findFirst({ where: { companyId, code: 'LOG-CARRIER', deletedAt: null } });
    if (!p) return [];
    const lines = await this.prisma.tradeDocumentLine.findMany({
      where: { productId: p.id, document: { companyId, docType: 'PI', status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null } },
      include: { document: { select: { id: true, number: true, date: true, supplierId: true, exchangeRate: true } } },
      take: 300,
      orderBy: { document: { date: 'desc' } },
    });
    const used = await this.prisma.jobCarrierCost.groupBy({ by: ['sourceLineId'], where: { sourceLineId: { in: lines.map((l) => l.id) } }, _sum: { amount: true } });
    const sup = await this.prisma.supplier.findMany({ where: { id: { in: lines.map((l) => l.document.supplierId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    return lines
      .map((l) => {
        const amount = r2((n(l.lineSubtotal) - n(l.lineDiscount)) * n(l.document.exchangeRate));
        return {
          lineId: l.id,
          bill: l.document.number,
          date: iso(l.document.date),
          supplier: sup.find((s) => s.id === l.document.supplierId)?.name ?? null,
          description: l.description,
          amount,
          open: r2(amount - n(used.find((x) => x.sourceLineId === l.id)?._sum.amount)),
        };
      })
      .filter((l) => l.open > 0.004);
  }

  async ensureCarrierProduct() {
    RequestCtx.assert('logistics.invoice');
    await this.product(RequestCtx.companyId(), 'LOG-CARRIER', 'Carrier / agent freight on forwarding jobs', 'CARRIER_COST', 'expense');
    return { ok: true };
  }

  async linkCarrier(jobId: string, input: z.infer<typeof linkSchema>) {
    RequestCtx.assert('logistics.invoice');
    const u = RequestCtx.user();
    const j = await this.prisma.logisticsJob.findFirst({ where: { id: jobId, companyId: u.companyId } });
    if (!j || j.status === 'CANCELLED') throw new NotFoundException('Job not found');
    const open = (await this.openCarrierLines()).find((l) => l.lineId === input.sourceLineId);
    if (!open) throw invalid({ sourceLineId: 'Choose a confirmed carrier bill line (product LOG-CARRIER) with something left' });
    if (input.amount > open.open + 0.004) throw invalid({ amount: `Only ${open.open.toLocaleString('id-ID')} left on ${open.bill}` });
    const line = await this.prisma.tradeDocumentLine.findUniqueOrThrow({ where: { id: input.sourceLineId } });
    await this.prisma.jobCarrierCost.create({ data: { jobId, sourceDocId: line.documentId, sourceLineId: line.id, amount: D(r2(input.amount)) } });
    await this.audit.record('Logistics Job', jobId, 'CARRIER', null, { bill: open.bill, amount: input.amount });
    return this.job(jobId);
  }

  async unlinkCarrier(id: string) {
    RequestCtx.assert('logistics.invoice');
    const u = RequestCtx.user();
    const c = await this.prisma.jobCarrierCost.findUnique({ where: { id } });
    const j = c ? await this.prisma.logisticsJob.findFirst({ where: { id: c.jobId, companyId: u.companyId } }) : null;
    if (!c || !j) throw new NotFoundException('Not found');
    await this.prisma.jobCarrierCost.delete({ where: { id } });
    return this.job(j.id);
  }
}

const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
