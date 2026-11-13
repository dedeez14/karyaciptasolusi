import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
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
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const LIVE = ['TENTATIVE', 'CONFIRMED', 'CHECKED_IN'];
const CHARGE_KINDS = ['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'OTHER'] as const;

/** service charge on the amount, PBJT on the amount with the service charge (UU 1/2022), whole rupiah */
export function charges(amount: number, servicePct: number, pbjtPct: number) {
  const service = Math.round((amount * servicePct) / 100);
  const tax = Math.round(((amount + service) * pbjtPct) / 100);
  return { service, tax, total: r2(amount + service + tax) };
}

export const configSchema = z.object({
  name: z.string().trim().min(1).max(150),
  pbjtPct: z.coerce.number().min(0).max(10, 'PBJT on hotel services is at most 10% (UU 1/2022 Art. 58)'),
  servicePct: z.coerce.number().min(0).max(25).default(0),
  serviceToStaff: z.boolean().default(true),
  checkoutTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('12:00'),
  businessDate: z.coerce.date().optional(),
});
export const roomTypeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  capacity: z.coerce.number().int().min(1).max(20).default(2),
  rate: z.coerce.number().positive().max(1e12),
  weekendRate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().positive().max(1e12).nullable().optional()),
  breakfast: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const roomSchema = z.object({ number: z.string().trim().min(1).max(10), floor: optText(10), roomTypeId: z.uuid(), notes: optText(200) });
export const reservationSchema = z.object({
  guestName: z.string().trim().min(1).max(150),
  guestPhone: optText(30),
  guestEmail: optText(150),
  nationality: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toUpperCase())
    .default('ID'),
  idType: z.preprocess((v) => (v === '' ? null : v), z.enum(['KTP', 'PASSPORT', 'KITAS', 'SIM', 'OTHER']).nullable().optional()),
  idNumber: optText(40),
  customerId: optUuid,
  source: z.enum(['WALK_IN', 'DIRECT', 'OTA', 'CORPORATE', 'GROUP']).default('DIRECT'),
  sourceRef: optText(80),
  roomTypeId: z.uuid(),
  arrival: z.coerce.date(),
  departure: z.coerce.date(),
  adults: z.coerce.number().int().min(1).max(20).default(1),
  children: z.coerce.number().int().min(0).max(20).default(0),
  rate: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).max(1e12).optional()),
  status: z.enum(['TENTATIVE', 'CONFIRMED']).default('CONFIRMED'),
  notes: optText(1000),
});
export const chargeSchema = z.object({ kind: z.enum(CHARGE_KINDS), description: z.string().trim().min(1).max(200), amount: z.coerce.number().positive().max(1e12) });
export const receiptSchema = z.object({ kind: z.enum(['DEPOSIT', 'PAYMENT', 'REFUND']), amount: z.coerce.number().positive().max(1e12), bankAccountId: z.uuid(), description: optText(200) });
export const checkInSchema = z.object({ roomId: z.uuid() });
export const checkOutSchema = z.object({ settle: z.enum(['PAYMENT', 'CITY_LEDGER', 'NONE']).default('NONE'), bankAccountId: optUuid });

type Tx = Prisma.TransactionClient;

/**
 * Hotel: rooms sold through reservations; the night audit posts each in-house room night to the guest folio with the
 * service charge (staff pool, Permenaker 7/2016) and PBJT jasa perhotelan on the amount with the service charge (UU
 * 1/2022, at most 10%; hotel services are not a PPN object), marks the no-shows and moves the business date. Check-out
 * settles the folio by payment or to the company's account (city ledger invoice). Foreign guests are listed for the
 * immigration report (APOA) due within 24 hours of the check-in.
 */
@Injectable()
export class HotelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ set-up
  private async cfg(companyId: string) {
    const c = await this.prisma.hotelConfig.findUnique({ where: { companyId } });
    return c ?? (await this.prisma.hotelConfig.create({ data: { companyId, businessDate: today() } }));
  }

  private shapeCfg(c: Prisma.HotelConfigGetPayload<object>) {
    return { ...c, businessDate: iso(c.businessDate), pbjtPct: n(c.pbjtPct), servicePct: n(c.servicePct) };
  }

  async config() {
    RequestCtx.assert('hotel.read');
    return this.shapeCfg(await this.cfg(RequestCtx.companyId()));
  }

  async saveConfig(input: z.infer<typeof configSchema>) {
    RequestCtx.assert('hotel.setup');
    const u = RequestCtx.user();
    const c = await this.cfg(u.companyId);
    const audited = await this.prisma.hotelNightAudit.count({ where: { companyId: u.companyId } });
    if (input.businessDate && audited && iso(input.businessDate) !== iso(c.businessDate)) throw invalid({ businessDate: 'The night audit moves the business date once it has run' });
    const r = await this.prisma.hotelConfig.update({
      where: { id: c.id },
      data: {
        name: input.name,
        pbjtPct: D(input.pbjtPct),
        servicePct: D(input.servicePct),
        serviceToStaff: input.serviceToStaff,
        checkoutTime: input.checkoutTime,
        ...(input.businessDate && !audited ? { businessDate: input.businessDate } : {}),
      },
    });
    await this.audit.record('Hotel', r.id, 'CONFIG');
    return this.shapeCfg(r);
  }

  async roomTypes() {
    RequestCtx.assert('hotel.read');
    const companyId = RequestCtx.companyId();
    const [types, rooms] = await Promise.all([
      this.prisma.hotelRoomType.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
      this.prisma.hotelRoom.groupBy({ by: ['roomTypeId'], where: { companyId }, _count: { _all: true } }),
    ]);
    return types.map((t) => ({ ...t, rate: n(t.rate), weekendRate: t.weekendRate === null ? null : n(t.weekendRate), rooms: rooms.find((r) => r.roomTypeId === t.id)?._count._all ?? 0 }));
  }

  async saveRoomType(id: string | null, input: z.infer<typeof roomTypeSchema>) {
    RequestCtx.assert('hotel.setup');
    const u = RequestCtx.user();
    const dup = await this.prisma.hotelRoomType.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code already used' });
    const data = { ...input, rate: D(input.rate), weekendRate: input.weekendRate ? D(input.weekendRate) : null };
    if (id) {
      if (!(await this.prisma.hotelRoomType.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Room type not found');
      await this.prisma.hotelRoomType.update({ where: { id }, data });
    } else await this.prisma.hotelRoomType.create({ data: { ...data, companyId: u.companyId } });
    return this.roomTypes();
  }

  async saveRoom(id: string | null, input: z.infer<typeof roomSchema>) {
    RequestCtx.assert('hotel.setup');
    const u = RequestCtx.user();
    if (!(await this.prisma.hotelRoomType.findFirst({ where: { id: input.roomTypeId, companyId: u.companyId } }))) throw invalid({ roomTypeId: 'Choose a room type' });
    const dup = await this.prisma.hotelRoom.findFirst({ where: { companyId: u.companyId, number: input.number, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ number: 'Room number already listed' });
    const data = { number: input.number, floor: input.floor ?? null, roomTypeId: input.roomTypeId, notes: input.notes ?? null };
    if (id) {
      if (!(await this.prisma.hotelRoom.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Room not found');
      await this.prisma.hotelRoom.update({ where: { id }, data });
    } else await this.prisma.hotelRoom.create({ data: { ...data, companyId: u.companyId } });
    return this.board();
  }

  /** housekeeping: clean / dirty / out of order (an occupied room changes at check-out only) */
  async setRoomStatus(id: string, status: string) {
    RequestCtx.assert('hotel.housekeeping');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelRoom.findFirst({ where: { id, companyId: u.companyId } });
    if (!r) throw new NotFoundException('Room not found');
    if (!['VACANT_CLEAN', 'VACANT_DIRTY', 'OUT_OF_ORDER'].includes(status)) throw invalid({ status: 'Clean, dirty or out of order' });
    if (r.status === 'OCCUPIED') throw new ConflictException('The room is occupied: it changes at check-out');
    await this.prisma.hotelRoom.update({ where: { id }, data: { status } });
    return this.board();
  }

  /** room board: every room with its guest; arrivals and departures of the business date */
  async board() {
    RequestCtx.assert('hotel.read');
    const companyId = RequestCtx.companyId();
    const c = await this.cfg(companyId);
    const bd = c.businessDate;
    const [rooms, types, inHouse, arrivals, departures] = await Promise.all([
      this.prisma.hotelRoom.findMany({ where: { companyId }, orderBy: { number: 'asc' } }),
      this.prisma.hotelRoomType.findMany({ where: { companyId } }),
      this.prisma.hotelReservation.findMany({ where: { companyId, status: 'CHECKED_IN' } }),
      this.prisma.hotelReservation.findMany({ where: { companyId, status: { in: ['TENTATIVE', 'CONFIRMED'] }, arrival: { lte: bd } }, orderBy: { arrival: 'asc' } }),
      this.prisma.hotelReservation.findMany({ where: { companyId, status: 'CHECKED_IN', departure: { lte: bd } } }),
    ]);
    const balances = await this.balances(inHouse.map((r) => r.id));
    const lite = (r: (typeof inHouse)[number]) => ({
      id: r.id,
      number: r.number,
      guestName: r.guestName,
      nationality: r.nationality,
      arrival: iso(r.arrival),
      departure: iso(r.departure),
      roomTypeId: r.roomTypeId,
      roomId: r.roomId,
      balance: balances.get(r.id) ?? 0,
    });
    return {
      config: this.shapeCfg(c),
      rooms: rooms.map((r) => {
        const g = inHouse.find((x) => x.roomId === r.id);
        return { ...r, type: types.find((t) => t.id === r.roomTypeId)?.code ?? null, guest: g ? lite(g) : null };
      }),
      arrivals: arrivals.map(lite),
      departures: departures.map(lite),
      inHouse: inHouse.length,
    };
  }

  private async balances(ids: string[]) {
    const rows = await this.prisma.hotelFolioLine.groupBy({ by: ['reservationId'], where: { reservationId: { in: ids }, status: 'POSTED' }, _sum: { total: true } });
    return new Map(rows.map((r) => [r.reservationId, r2(n(r._sum.total))]));
  }

  // ------------------------------------------------------------------ reservations
  /** rooms of the type left on the busiest night of the stay */
  private async available(tx: Tx | PrismaService, companyId: string, roomTypeId: string, arrival: Date, departure: Date, excludeId: string | null) {
    const rooms = await tx.hotelRoom.count({ where: { companyId, roomTypeId, status: { not: 'OUT_OF_ORDER' } } });
    const res = await tx.hotelReservation.findMany({
      where: { companyId, roomTypeId, status: { in: LIVE }, arrival: { lt: departure }, departure: { gt: arrival }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { arrival: true, departure: true },
    });
    let worst = 0;
    for (let t = arrival.getTime(); t < departure.getTime(); t += DAY) worst = Math.max(worst, res.filter((r) => r.arrival.getTime() <= t && r.departure.getTime() > t).length);
    return rooms - worst;
  }

  async reservations(q: { status?: string; from?: Date; to?: Date }) {
    RequestCtx.assert('hotel.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.hotelReservation.findMany({
      where: { companyId, ...(q.status ? { status: q.status } : { status: { notIn: ['CANCELLED'] } }), ...(q.from && q.to ? { arrival: { lte: q.to }, departure: { gte: q.from } } : {}) },
      orderBy: [{ arrival: 'desc' }],
      take: 500,
    });
    const types = await this.prisma.hotelRoomType.findMany({ where: { companyId }, select: { id: true, code: true } });
    const rooms = await this.prisma.hotelRoom.findMany({ where: { id: { in: rows.map((r) => r.roomId).filter(Boolean) as string[] } }, select: { id: true, number: true } });
    const bal = await this.balances(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...this.shapeRes(r),
      type: types.find((t) => t.id === r.roomTypeId)?.code ?? null,
      room: rooms.find((x) => x.id === r.roomId)?.number ?? null,
      balance: bal.get(r.id) ?? 0,
    }));
  }

  private shapeRes(r: Prisma.HotelReservationGetPayload<object>) {
    const idn = this.crypto.decrypt(r.idNumber);
    return {
      ...r,
      idNumber: idn ? `${'•'.repeat(Math.max(0, idn.length - 4))}${idn.slice(-4)}` : null,
      arrival: iso(r.arrival),
      departure: iso(r.departure),
      rate: n(r.rate),
      nights: Math.round((r.departure.getTime() - r.arrival.getTime()) / DAY),
    };
  }

  async reservation(id: string) {
    RequestCtx.assert('hotel.read');
    const companyId = RequestCtx.companyId();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Reservation not found');
    const [lines, type, room, customer, cfg] = await Promise.all([
      this.prisma.hotelFolioLine.findMany({ where: { reservationId: id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.hotelRoomType.findUnique({ where: { id: r.roomTypeId } }),
      r.roomId ? this.prisma.hotelRoom.findUnique({ where: { id: r.roomId } }) : null,
      r.customerId ? this.prisma.customer.findUnique({ where: { id: r.customerId }, select: { id: true, code: true, name: true } }) : null,
      this.cfg(companyId),
    ]);
    const posted = lines.filter((l) => l.status === 'POSTED');
    const nightly = charges(n(r.rate), n(cfg.servicePct), n(cfg.pbjtPct));
    return {
      ...this.shapeRes(r),
      type: type ? { id: type.id, code: type.code, name: type.name } : null,
      room: room ? { id: room.id, number: room.number } : null,
      customer,
      nightly,
      folio: lines.map((l) => ({ ...l, date: iso(l.date), amount: n(l.amount), service: n(l.service), tax: n(l.tax), total: n(l.total) })),
      balance: r2(posted.reduce((s, l) => s + n(l.total), 0)),
      charged: r2(posted.filter((l) => n(l.total) > 0 && !['REFUND'].includes(l.kind)).reduce((s, l) => s + n(l.total), 0)),
      apoaDue: r.nationality !== 'ID' && r.checkedInAt ? new Date(r.checkedInAt.getTime() + DAY).toISOString() : null,
    };
  }

  async saveReservation(id: string | null, input: z.infer<typeof reservationSchema>) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    if (input.departure <= input.arrival) throw invalid({ departure: 'Departure is after the arrival' });
    const type = await this.prisma.hotelRoomType.findFirst({ where: { id: input.roomTypeId, companyId: u.companyId, isActive: true } });
    if (!type) throw invalid({ roomTypeId: 'Choose a room type' });
    if (input.adults + input.children > type.capacity + 1) throw invalid({ adults: `${type.name} takes ${type.capacity} guests` });
    if (input.source === 'CORPORATE' && !input.customerId) throw invalid({ customerId: 'A corporate booking names the company billed' });
    const cur = id ? await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } }) : null;
    if (id && !cur) throw new NotFoundException('Reservation not found');
    if (cur && !['TENTATIVE', 'CONFIRMED', 'CHECKED_IN'].includes(cur.status)) throw new ConflictException('The reservation is closed');
    if (cur?.status === 'CHECKED_IN' && (iso(cur.arrival) !== iso(input.arrival) || cur.roomTypeId !== input.roomTypeId))
      throw new ConflictException('In house: only the departure, rate and guest details change');
    if ((await this.available(this.prisma, u.companyId, input.roomTypeId, input.arrival, input.departure, id)) < 1 && cur?.status !== 'CHECKED_IN')
      throw invalid({ roomTypeId: `No ${type.name} free for every night of the stay` });
    const data = {
      guestName: input.guestName,
      guestPhone: input.guestPhone ?? null,
      guestEmail: input.guestEmail ?? null,
      nationality: input.nationality,
      idType: input.idType ?? null,
      ...(input.idNumber ? { idNumber: this.crypto.encrypt(input.idNumber) } : {}),
      customerId: input.customerId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      roomTypeId: input.roomTypeId,
      arrival: input.arrival,
      departure: input.departure,
      adults: input.adults,
      children: input.children,
      rate: D(input.rate ?? n(type.rate)),
      notes: input.notes ?? null,
      ...(cur?.status === 'CHECKED_IN' ? {} : { status: input.status }),
    };
    const r = cur
      ? await this.prisma.hotelReservation.update({ where: { id: cur.id }, data })
      : await this.prisma.$transaction(async (tx) =>
          tx.hotelReservation.create({ data: { ...data, companyId: u.companyId, number: await this.sequence.next('HOTEL_RES', u.companyId, input.arrival, tx), createdById: u.id } }),
        );
    await this.audit.record('Hotel Reservation', r.id, id ? 'UPDATE' : 'CREATE', null, { number: r.number });
    return this.reservation(r.id);
  }

  async cancel(id: string) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } });
    if (!r || !['TENTATIVE', 'CONFIRMED', 'NO_SHOW'].includes(r.status)) throw new ConflictException('Only a reservation not checked in');
    const bal = (await this.balances([id])).get(id) ?? 0;
    if (Math.abs(bal) > 0.004) throw new ConflictException(`The folio stands at ${bal.toLocaleString('id-ID')}: refund the deposit or charge a cancellation fee first`);
    await this.prisma.hotelReservation.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Hotel Reservation', id, 'CANCEL');
    return this.reservation(id);
  }

  // ------------------------------------------------------------------ folio
  private async postLine(
    tx: Tx,
    companyId: string,
    r: { id: string; number: string; guestName: string; customerId: string | null },
    line: { date: Date; kind: string; description: string; amount: number; service: number; tax: number; total: number; bankAccountId?: string | null },
    j: PostingLine[],
    serviceToStaff: boolean,
  ) {
    const row = await tx.hotelFolioLine.create({
      data: {
        reservationId: r.id,
        date: line.date,
        kind: line.kind,
        description: line.description,
        amount: D(line.amount),
        service: D(line.service),
        tax: D(line.tax),
        total: D(line.total),
        bankAccountId: line.bankAccountId ?? null,
        createdById: RequestCtx.user().id,
      },
    });
    if (!j.length) {
      j.push({ key: 'GUEST_LEDGER', debit: D(line.total), description: `${r.number} ${r.guestName}` });
      j.push({ key: line.kind === 'ROOM' ? 'ROOM_REVENUE' : 'HOTEL_OTHER_REVENUE', credit: D(line.amount), description: line.description });
      if (line.service > 0) j.push({ key: serviceToStaff ? 'SERVICE_CHARGE_PAYABLE' : 'SERVICE_CHARGE_INCOME', credit: D(line.service), description: `Service charge ${r.number}` });
      if (line.tax > 0) j.push({ key: 'PBJT_PAYABLE', credit: D(line.tax), description: `PBJT jasa perhotelan ${r.number}` });
    }
    await this.journal.post(tx, {
      companyId,
      date: line.date,
      description: `${r.number} ${r.guestName}: ${line.description}`,
      reference: r.number,
      sourceType: 'HOTEL_FOLIO',
      sourceId: row.id,
      lines: j,
    });
    return row;
  }

  async charge(id: string, input: z.infer<typeof chargeSchema>) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } });
    if (!r || !['CHECKED_IN', 'CONFIRMED', 'NO_SHOW', 'TENTATIVE'].includes(r.status)) throw new ConflictException('Charges go on an open folio');
    if (r.status !== 'CHECKED_IN' && input.kind !== 'OTHER') throw new ConflictException('Before the check-in only a fee (e.g. cancellation or no-show) can be charged');
    const c = await this.cfg(u.companyId);
    const x = charges(input.amount, n(c.servicePct), n(c.pbjtPct));
    await this.prisma.$transaction((tx) =>
      this.postLine(tx, u.companyId, r, { date: c.businessDate, kind: input.kind, description: input.description, amount: input.amount, ...x }, [], c.serviceToStaff),
    );
    await this.audit.record('Hotel Reservation', id, 'CHARGE', null, { kind: input.kind, amount: input.amount });
    return this.reservation(id);
  }

  /** deposit / payment: Dr cash or bank / Cr guest ledger; refund the other way */
  async receipt(id: string, input: z.infer<typeof receiptSchema>) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } });
    if (!r || ['CANCELLED', 'CHECKED_OUT'].includes(r.status)) throw new ConflictException('The folio is closed');
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: u.companyId } });
    if (!bank?.accountId) throw invalid({ bankAccountId: 'Choose a cash / bank account with a ledger account' });
    if (input.kind === 'REFUND') {
      const bal = (await this.balances([id])).get(id) ?? 0;
      if (input.amount > -bal + 0.004) throw invalid({ amount: `Only ${Math.max(0, -bal).toLocaleString('id-ID')} to refund` });
    }
    const c = await this.cfg(u.companyId);
    const signed = input.kind === 'REFUND' ? input.amount : -input.amount;
    const desc = input.description ?? (input.kind === 'DEPOSIT' ? 'Deposit' : input.kind === 'REFUND' ? 'Refund' : 'Payment');
    const j: PostingLine[] =
      input.kind === 'REFUND'
        ? [
            { key: 'GUEST_LEDGER', debit: D(input.amount), description: `${r.number} refund` },
            { accountId: bank.accountId, credit: D(input.amount), description: `${r.number} ${r.guestName} refund` },
          ]
        : [
            { accountId: bank.accountId, debit: D(input.amount), description: `${r.number} ${r.guestName}` },
            { key: 'GUEST_LEDGER', credit: D(input.amount), description: `${r.number} ${desc}` },
          ];
    await this.prisma.$transaction((tx) =>
      this.postLine(tx, u.companyId, r, { date: c.businessDate, kind: input.kind, description: desc, amount: signed, service: 0, tax: 0, total: signed, bankAccountId: bank.id }, j, c.serviceToStaff),
    );
    await this.audit.record('Hotel Reservation', id, input.kind, null, { amount: input.amount });
    return this.reservation(id);
  }

  async voidLine(lineId: string) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const l = await this.prisma.hotelFolioLine.findFirst({ where: { id: lineId, status: 'POSTED' } });
    const r = l ? await this.prisma.hotelReservation.findFirst({ where: { id: l.reservationId, companyId: u.companyId } }) : null;
    if (!l || !r) throw new NotFoundException('Folio line not found');
    if (r.status === 'CHECKED_OUT') throw new ConflictException('The guest has checked out');
    if (l.kind === 'CITY_LEDGER') throw new ConflictException('Cancel the city ledger invoice instead');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'HOTEL_FOLIO', l.id);
      await tx.hotelFolioLine.update({ where: { id: l.id }, data: { status: 'VOID' } });
    });
    await this.audit.record('Hotel Reservation', r.id, 'VOID_LINE', null, { line: l.description, total: n(l.total) });
    return this.reservation(r.id);
  }

  // ------------------------------------------------------------------ check-in / out
  async checkIn(id: string, input: z.infer<typeof checkInSchema>) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } });
    if (!r || !['TENTATIVE', 'CONFIRMED'].includes(r.status)) throw new ConflictException('Only a reservation not checked in');
    const c = await this.cfg(u.companyId);
    if (r.arrival > c.businessDate) throw new ConflictException(`The arrival is ${iso(r.arrival)}; the business date is ${iso(c.businessDate)}`);
    if (r.departure <= c.businessDate) throw new ConflictException('The stay is over: change the departure first');
    if (r.nationality !== 'ID' && (!['PASSPORT', 'KITAS'].includes(r.idType ?? '') || !r.idNumber))
      throw invalid({ idNumber: 'A foreign guest checks in with a passport or KITAS: it is reported to immigration (APOA)' });
    if (r.nationality === 'ID' && !r.idNumber) throw invalid({ idNumber: 'Record the guest ID (KTP) at the check-in' });
    const room = await this.prisma.hotelRoom.findFirst({ where: { id: input.roomId, companyId: u.companyId } });
    if (!room) throw invalid({ roomId: 'Choose a room' });
    if (room.status !== 'VACANT_CLEAN') throw invalid({ roomId: `Room ${room.number} is ${room.status.toLowerCase().replace('_', ' ')}` });
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.hotelRoom.updateMany({ where: { id: room.id, status: 'VACANT_CLEAN' }, data: { status: 'OCCUPIED' } });
      if (!locked.count) throw new ConflictException('The room was just taken');
      await tx.hotelReservation.update({ where: { id }, data: { status: 'CHECKED_IN', roomId: room.id, checkedInAt: new Date() } });
    });
    await this.audit.record('Hotel Reservation', id, 'CHECK_IN', null, { room: room.number });
    return this.reservation(id);
  }

  /** check-out: the folio settled by payment or to the company (city ledger invoice), credit refunded; the room to housekeeping */
  async checkOut(id: string, input: z.infer<typeof checkOutSchema>) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId } });
    if (!r || r.status !== 'CHECKED_IN') throw new ConflictException('Only an in-house guest checks out');
    const c = await this.cfg(u.companyId);
    let bal = (await this.balances([id])).get(id) ?? 0;
    if (bal > 0.004 && input.settle === 'PAYMENT') {
      if (!input.bankAccountId) throw invalid({ bankAccountId: 'Choose where the payment goes' });
      await this.receipt(id, { kind: 'PAYMENT', amount: bal, bankAccountId: input.bankAccountId, description: 'Payment at check-out' });
      bal = 0;
    }
    let invoiceId: string | null = null;
    if (bal > 0.004 && input.settle === 'CITY_LEDGER') {
      if (!r.customerId) throw invalid({ settle: 'The reservation names no company to bill' });
      const product = await this.cityLedgerProduct(u.companyId);
      const doc = (await this.docs.create(
        'SI',
        {
          date: c.businessDate,
          customerId: r.customerId,
          reference: r.number,
          notes: `Hotel stay ${r.guestName}, ${iso(r.arrival)} to ${iso(r.departure)} (folio ${r.number}), PBJT included; not a PPN object.`,
          lines: [{ productId: product, description: `Folio ${r.number} ${r.guestName}`, qty: 1, unitPrice: bal, taxId: null }],
        },
        undefined,
        { skipPermission: true },
      )) as { id: string; number: string };
      await this.docs.confirm('SI', doc.id, { skipPermission: true });
      await this.prisma.hotelFolioLine.create({
        data: { reservationId: id, date: c.businessDate, kind: 'CITY_LEDGER', description: `To the company account (${doc.number})`, amount: D(-bal), total: D(-bal), createdById: u.id },
      });
      invoiceId = doc.id;
      bal = 0;
    }
    if (Math.abs(bal) > 0.004)
      throw new ConflictException(
        bal > 0 ? `${bal.toLocaleString('id-ID')} is open: take the payment or bill the company` : `${(-bal).toLocaleString('id-ID')} is due back to the guest: refund it first`,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.hotelReservation.update({ where: { id }, data: { status: 'CHECKED_OUT', checkedOutAt: new Date(), invoiceId } });
      if (r.roomId) await tx.hotelRoom.update({ where: { id: r.roomId }, data: { status: 'VACANT_DIRTY' } });
    });
    await this.audit.record('Hotel Reservation', id, 'CHECK_OUT');
    return this.reservation(id);
  }

  private async cityLedgerProduct(companyId: string) {
    const found = await this.prisma.product.findFirst({ where: { companyId, code: 'HOTEL-CL', deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const account = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, 'GUEST_LEDGER'));
    return (
      await this.prisma.product.create({
        data: {
          companyId,
          code: 'HOTEL-CL',
          name: 'Hotel folio transferred to the company account',
          type: 'SERVICE',
          incomeAccountId: account,
          isPurchasable: false,
          description: 'Made by the hotel module: city ledger',
          createdById: RequestCtx.user().id,
        },
      })
    ).id;
  }

  // ------------------------------------------------------------------ night audit
  /** closes the business date: room nights of the in-house guests posted, no-shows marked, the date moves on */
  async nightAudit() {
    RequestCtx.assert('hotel.audit');
    const u = RequestCtx.user();
    const c = await this.cfg(u.companyId);
    const bd = c.businessDate;
    if (await this.prisma.hotelNightAudit.findUnique({ where: { companyId_businessDate: { companyId: u.companyId, businessDate: bd } } })) throw new ConflictException(`${iso(bd)} is audited already`);
    const inHouse = await this.prisma.hotelReservation.findMany({ where: { companyId: u.companyId, status: 'CHECKED_IN' } });
    const types = await this.prisma.hotelRoomType.findMany({ where: { companyId: u.companyId } });
    const weekend = [5, 6].includes(bd.getUTCDay()); // Friday and Saturday nights
    let revenue = 0;
    let service = 0;
    let tax = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const r of inHouse) {
          if (await tx.hotelFolioLine.count({ where: { reservationId: r.id, kind: 'ROOM', date: bd, status: 'POSTED' } })) continue;
          const t = types.find((x) => x.id === r.roomTypeId);
          // the weekend rate applies when the reservation carries the type's normal rate
          const rate = weekend && t?.weekendRate && n(r.rate) === n(t.rate) ? n(t.weekendRate) : n(r.rate);
          const x = charges(rate, n(c.servicePct), n(c.pbjtPct));
          await this.postLine(tx, u.companyId, r, { date: bd, kind: 'ROOM', description: `Room night ${iso(bd)}`, amount: rate, ...x }, [], c.serviceToStaff);
          revenue += rate;
          service += x.service;
          tax += x.tax;
        }
        const noShow = await tx.hotelReservation.updateMany({ where: { companyId: u.companyId, status: { in: ['TENTATIVE', 'CONFIRMED'] }, arrival: { lte: bd } }, data: { status: 'NO_SHOW' } });
        const available = await tx.hotelRoom.count({ where: { companyId: u.companyId, status: { not: 'OUT_OF_ORDER' } } });
        await tx.hotelNightAudit.create({
          data: {
            companyId: u.companyId,
            businessDate: bd,
            roomsAvailable: available,
            roomsSold: inHouse.length,
            roomRevenue: D(r2(revenue)),
            service: D(service),
            tax: D(tax),
            noShows: noShow.count,
            createdById: u.id,
          },
        });
        await tx.hotelConfig.update({ where: { id: c.id }, data: { businessDate: new Date(bd.getTime() + DAY) } });
      },
      { timeout: 120_000 },
    );
    await this.audit.record('Hotel', c.id, 'NIGHT_AUDIT', null, { date: iso(bd), rooms: inHouse.length, revenue });
    return this.reports(new Date(bd.getTime() - 30 * DAY), bd);
  }

  // ------------------------------------------------------------------ reports
  async reports(from: Date, to: Date) {
    RequestCtx.assert('hotel.read');
    const companyId = RequestCtx.companyId();
    const audits = await this.prisma.hotelNightAudit.findMany({ where: { companyId, businessDate: { gte: from, lte: to } }, orderBy: { businessDate: 'asc' } });
    const days = audits.map((a) => ({
      date: iso(a.businessDate),
      available: a.roomsAvailable,
      sold: a.roomsSold,
      occupancy: a.roomsAvailable ? r2((a.roomsSold / a.roomsAvailable) * 100) : 0,
      revenue: n(a.roomRevenue),
      adr: a.roomsSold ? r2(n(a.roomRevenue) / a.roomsSold) : 0,
      revpar: a.roomsAvailable ? r2(n(a.roomRevenue) / a.roomsAvailable) : 0,
      noShows: a.noShows,
    }));
    const sum = (k: 'available' | 'sold' | 'revenue') => days.reduce((s, d) => s + d[k], 0);
    // PBJT and service charge of every charge posted in the period (the regional return is monthly)
    const lines = await this.prisma.hotelFolioLine.findMany({
      where: {
        status: 'POSTED',
        date: { gte: from, lte: to },
        kind: { in: [...CHARGE_KINDS] },
        reservationId: { in: (await this.prisma.hotelReservation.findMany({ where: { companyId }, select: { id: true } })).map((r) => r.id) },
      },
      select: { date: true, kind: true, amount: true, service: true, tax: true },
    });
    const months = new Map<string, { month: string; amount: number; service: number; tax: number }>();
    for (const l of lines) {
      const m = iso(l.date)!.slice(0, 7);
      const x = months.get(m) ?? { month: m, amount: 0, service: 0, tax: 0 };
      x.amount = r2(x.amount + n(l.amount));
      x.service = r2(x.service + n(l.service));
      x.tax = r2(x.tax + n(l.tax));
      months.set(m, x);
    }
    const foreign = await this.prisma.hotelReservation.findMany({
      where: { companyId, nationality: { not: 'ID' }, checkedInAt: { not: null }, OR: [{ apoaReportedAt: null }, { checkedInAt: { gte: from } }] },
      orderBy: { checkedInAt: 'desc' },
      take: 200,
    });
    const rooms = await this.prisma.hotelRoom.findMany({ where: { id: { in: foreign.map((f) => f.roomId).filter(Boolean) as string[] } }, select: { id: true, number: true } });
    const now = Date.now();
    return {
      days,
      totals: {
        available: sum('available'),
        sold: sum('sold'),
        revenue: r2(sum('revenue')),
        occupancy: sum('available') ? r2((sum('sold') / sum('available')) * 100) : 0,
        adr: sum('sold') ? r2(sum('revenue') / sum('sold')) : 0,
        revpar: sum('available') ? r2(sum('revenue') / sum('available')) : 0,
      },
      pbjt: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
      foreign: foreign.map((f) => {
        const due = f.checkedInAt!.getTime() + DAY;
        return {
          id: f.id,
          number: f.number,
          guestName: f.guestName,
          nationality: f.nationality,
          idType: f.idType,
          idNumber: this.shapeRes(f).idNumber,
          room: rooms.find((x) => x.id === f.roomId)?.number ?? null,
          arrival: iso(f.arrival),
          departure: iso(f.departure),
          checkedInAt: f.checkedInAt,
          due: new Date(due).toISOString(),
          late: !f.apoaReportedAt && now > due,
          reportedAt: f.apoaReportedAt,
          ref: f.apoaRef,
        };
      }),
    };
  }

  async markReported(id: string, ref: string | null) {
    RequestCtx.assert('hotel.frontdesk');
    const u = RequestCtx.user();
    const r = await this.prisma.hotelReservation.findFirst({ where: { id, companyId: u.companyId, nationality: { not: 'ID' }, checkedInAt: { not: null } } });
    if (!r) throw new NotFoundException('Foreign guest stay not found');
    await this.prisma.hotelReservation.update({ where: { id }, data: { apoaReportedAt: new Date(), apoaRef: ref } });
    await this.audit.record('Hotel Reservation', id, 'APOA', null, { ref });
    return { ok: true };
  }
}
