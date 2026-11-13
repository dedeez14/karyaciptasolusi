import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86_400_000;
import { todayDate } from './local-date';
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());

export const TREATMENTS = ['HANDED_OVER', 'UTILISED', 'TREATED', 'LANDFILLED', 'EXPORTED', 'OTHER'] as const;

export const entrySchema = z.object({
  wasteTypeId: z.uuid(),
  date: z.coerce.date(),
  qty: z.coerce.number().positive().max(1e9),
  source: optText(200),
  notes: optText(500),
});
export const handoverSchema = z
  .object({
    date: z.coerce.date(),
    treatment: z.enum(TREATMENTS),
    transporterId: optUuid,
    receiverId: optUuid,
    manifestNo: optText(60),
    vehicleNo: optText(30),
    licenceNo: optText(100),
    notes: optText(500),
    lines: z.array(z.object({ wasteTypeId: z.uuid(), qty: z.coerce.number().positive().max(1e9) })).min(1).max(50),
  })
  .superRefine((h, ctx) => {
    // Permen LHK 6/2021 Art. 99: transport of B3 waste must carry the Festronik manifest
    if (h.treatment === 'HANDED_OVER' || h.treatment === 'EXPORTED') {
      if (!h.transporterId) ctx.addIssue({ code: 'custom', path: ['transporterId'], message: 'Licensed transporter' });
      if (!h.receiverId) ctx.addIssue({ code: 'custom', path: ['receiverId'], message: 'Licensed collector / processor receiving it' });
      if (!h.manifestNo) ctx.addIssue({ code: 'custom', path: ['manifestNo'], message: 'Festronik manifest number' });
    }
    const ids = h.lines.map((l) => l.wasteTypeId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'One line per waste type' });
  });

/**
 * Maximum storage at the producer, Permen LHK 6/2021 Art. 79 (1): 90 days when generated at 50 kg a day or more;
 * otherwise 180 days for category 1, 365 days for category 2 from non-specific / general specific sources and for
 * category 2 from special specific sources. Category 2 expired / spilled products are not named there: the shorter
 * 180 days is used.
 */
export function storageDays(t: { atLeast50KgPerDay: boolean; category: number; sourceType: string }) {
  if (t.atLeast50KgPerDay) return 90;
  if (t.category === 1) return 180;
  if (t.sourceType === 'EXPIRED') return 180;
  return 365;
}

/** common codes of PP 22/2021 Annex IX table 1 (non-specific sources) */
export const COMMON_WASTE: [string, string, number][] = [
  ['A102d', 'Used accumulators / batteries (aki / baterai bekas)', 1],
  ['A106d', 'Laboratory waste containing B3', 1],
  ['A108d', 'Waste contaminated with B3', 1],
  ['A111d', 'Used refrigerant from electronic equipment', 1],
  ['B104d', 'Used B3 packaging (kemasan bekas B3)', 2],
  ['B105d', 'Used lubricating oil: hydraulic, engine, gear, insulation oil... (minyak pelumas bekas)', 2],
  ['B107d', 'Electronic waste: CRT, fluorescent lamps, printed circuit boards, metal wire', 2],
  ['B109d', 'Used filters from air pollution control', 2],
  ['B110d', 'Used rags and the like (kain majun bekas)', 2],
];

type Alloc = { entryId: string; qty: number };

/**
 * B3 waste store: logbook of waste put in and taken out (Permen LHK 6/2021 Annex IX form A) with the maximum storage
 * date of each entry, hand-overs with the Festronik manifest, the waste balance (neraca, form B) with monthly figures
 * (Art. 80 (7)); records are reported at least every 6 months at plb3.menlhk.go.id (Art. 80 (8), (10)).
 */
@Injectable()
export class WasteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  private async types(companyId: string) {
    return this.prisma.wasteType.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' } });
  }

  async addCommonTypes() {
    RequestCtx.assert('compliance.waste.manage');
    const u = RequestCtx.user();
    const have = new Set((await this.prisma.wasteType.findMany({ where: { companyId: u.companyId }, select: { code: true } })).map((t) => t.code));
    const add = COMMON_WASTE.filter(([code]) => !have.has(code));
    if (add.length) await this.prisma.wasteType.createMany({ data: add.map(([code, name, category]) => ({ companyId: u.companyId, code, name, category, sourceType: 'NON_SPECIFIC', createdById: u.id })) });
    return { added: add.map(([c]) => c) };
  }

  // ---------------------------------------------------------------- store
  async stock() {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const today = todayDate();
    const types = await this.types(companyId);
    const entries = await this.prisma.wasteEntry.findMany({ where: { companyId, status: 'POSTED' }, orderBy: [{ maxStorageDate: 'asc' }, { date: 'asc' }] });
    const since = new Date(today.getTime() - 90 * DAY);
    return types.map((t) => {
      const mine = entries.filter((e) => e.wasteTypeId === t.id);
      const open = mine.filter((e) => Number(e.remainingQty) > 0);
      const recent = mine.filter((e) => e.date >= since).reduce((a, e) => a + Number(e.qty), 0);
      const first = mine.length ? mine.reduce((a, e) => (e.date < a ? e.date : a), mine[0].date) : null;
      const days = first ? Math.max(1, Math.min(90, Math.ceil((today.getTime() - Math.max(first.getTime(), since.getTime())) / DAY) + 1)) : 0;
      const perDay = days ? r3(recent / days) : 0;
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        category: t.category,
        sourceType: t.sourceType,
        atLeast50KgPerDay: t.atLeast50KgPerDay,
        isActive: t.isActive,
        storageLocation: t.storageLocation,
        storageDays: storageDays(t),
        inStore: r3(open.reduce((a, e) => a + Number(e.remainingQty), 0)),
        overdue: r3(open.filter((e) => e.maxStorageDate < today).reduce((a, e) => a + Number(e.remainingQty), 0)),
        nextDeadline: open[0]?.maxStorageDate ?? null,
        daysLeft: open[0] ? Math.ceil((open[0].maxStorageDate.getTime() - today.getTime()) / DAY) : null,
        perDay,
        // 50 kg a day or more means 90 days, whatever the type is set to
        rateWarning: !t.atLeast50KgPerDay && perDay >= 50,
      };
    });
  }

  async addEntry(input: z.infer<typeof entrySchema>) {
    RequestCtx.assert('compliance.waste.manage');
    const u = RequestCtx.user();
    const t = await this.prisma.wasteType.findFirst({ where: { id: input.wasteTypeId, companyId: u.companyId, deletedAt: null, isActive: true } });
    if (!t) throw new BadRequestException({ message: 'Validation failed', errors: { wasteTypeId: 'Waste type not found' } });
    if (input.date > new Date(todayDate().getTime() + DAY)) throw new BadRequestException({ message: 'Validation failed', errors: { date: 'In the future' } });
    const days = storageDays(t);
    const e = await this.prisma.wasteEntry.create({
      data: { companyId: u.companyId, wasteTypeId: t.id, date: input.date, qty: D(input.qty), remainingQty: D(input.qty), storageDays: days, maxStorageDate: new Date(input.date.getTime() + days * DAY), source: input.source ?? null, notes: input.notes ?? null, createdById: u.id },
    });
    await this.audit.record('B3 Waste', e.id, 'STORE', undefined, { code: t.code, qty: input.qty, until: e.maxStorageDate });
    return e;
  }

  async cancelEntry(id: string) {
    RequestCtx.assert('compliance.waste.manage');
    if (!UUID.test(id ?? '')) throw new NotFoundException('Entry not found');
    const e = await this.prisma.wasteEntry.findFirst({ where: { id, companyId: RequestCtx.companyId(), status: 'POSTED' } });
    if (!e) throw new NotFoundException('Entry not found');
    if (!e.remainingQty.eq(e.qty)) throw new ConflictException('Part of this waste has already left the store; cancel that hand-over first');
    await this.prisma.wasteEntry.update({ where: { id }, data: { status: 'CANCELLED', remainingQty: D(0) } });
    await this.audit.record('B3 Waste', id, 'CANCEL');
    return { ok: true };
  }

  // ---------------------------------------------------------------- hand-overs
  async handovers(from?: Date, to?: Date) {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.wasteHandover.findMany({ where: { companyId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, include: { lines: true }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 500 });
    const types = new Map((await this.types(companyId)).map((t) => [t.id, t]));
    const sup = new Map((await this.prisma.supplier.findMany({ where: { id: { in: rows.flatMap((r) => [r.transporterId!, r.receiverId!]).filter(Boolean) } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    return rows.map((r) => ({
      ...r,
      transporter: r.transporterId ? sup.get(r.transporterId) ?? null : null,
      receiver: r.receiverId ? sup.get(r.receiverId) ?? null : null,
      lines: r.lines.map((l) => ({ id: l.id, wasteTypeId: l.wasteTypeId, code: types.get(l.wasteTypeId)?.code ?? '', name: types.get(l.wasteTypeId)?.name ?? '', qty: Number(l.qty) })),
      totalQty: r3(r.lines.reduce((a, l) => a + Number(l.qty), 0)),
    }));
  }

  async addHandover(input: z.infer<typeof handoverSchema>) {
    RequestCtx.assert('compliance.waste.manage');
    const u = RequestCtx.user();
    for (const k of ['transporterId', 'receiverId'] as const) {
      const v = input[k];
      if (v && !(await this.prisma.supplier.count({ where: { id: v, companyId: u.companyId, deletedAt: null } }))) throw new BadRequestException({ message: 'Validation failed', errors: { [k]: 'Not found' } });
    }
    const h = await this.prisma.$transaction(async (tx) => {
      const lines: { wasteTypeId: string; qty: number; allocations: Alloc[] }[] = [];
      for (const [i, l] of input.lines.entries()) {
        const t = await tx.wasteType.findFirst({ where: { id: l.wasteTypeId, companyId: u.companyId, deletedAt: null } });
        if (!t) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.wasteTypeId`]: 'Waste type not found' } });
        // oldest deadline first; only waste stored on or before the hand-over date
        const open = await tx.wasteEntry.findMany({ where: { companyId: u.companyId, wasteTypeId: t.id, status: 'POSTED', remainingQty: { gt: 0 }, date: { lte: input.date } }, orderBy: [{ maxStorageDate: 'asc' }, { date: 'asc' }] });
        const avail = open.reduce((a, e) => a + Number(e.remainingQty), 0);
        if (l.qty > avail + 1e-9) throw new BadRequestException({ message: 'Validation failed', errors: { [`lines.${i}.qty`]: `Only ${r3(avail)} kg of ${t.code} in the store on that date` } });
        let left = l.qty;
        const allocations: Alloc[] = [];
        for (const e of open) {
          if (left <= 1e-9) break;
          const take = Math.min(left, Number(e.remainingQty));
          await tx.wasteEntry.update({ where: { id: e.id }, data: { remainingQty: e.remainingQty.minus(D(take)) } });
          allocations.push({ entryId: e.id, qty: r3(take) });
          left = r3(left - take);
        }
        lines.push({ wasteTypeId: t.id, qty: l.qty, allocations });
      }
      return tx.wasteHandover.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('B3_HANDOVER', u.companyId, input.date, tx),
          date: input.date,
          treatment: input.treatment,
          transporterId: input.transporterId ?? null,
          receiverId: input.receiverId ?? null,
          manifestNo: input.manifestNo ?? null,
          vehicleNo: input.vehicleNo ?? null,
          licenceNo: input.licenceNo ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
          lines: { create: lines.map((l) => ({ wasteTypeId: l.wasteTypeId, qty: D(l.qty), allocations: l.allocations })) },
        },
      });
    });
    await this.audit.record('B3 Hand-over', h.id, 'CREATE', undefined, { number: h.number, treatment: h.treatment, manifest: h.manifestNo });
    return h;
  }

  async cancelHandover(id: string) {
    RequestCtx.assert('compliance.waste.manage');
    if (!UUID.test(id ?? '')) throw new NotFoundException('Hand-over not found');
    const h = await this.prisma.wasteHandover.findFirst({ where: { id, companyId: RequestCtx.companyId(), status: 'POSTED' }, include: { lines: true } });
    if (!h) throw new NotFoundException('Hand-over not found');
    await this.prisma.$transaction(async (tx) => {
      for (const l of h.lines) for (const a of (l.allocations as Alloc[]) ?? []) await tx.wasteEntry.update({ where: { id: a.entryId }, data: { remainingQty: { increment: D(a.qty) } } });
      await tx.wasteHandover.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('B3 Hand-over', id, 'CANCEL', { number: h.number });
    return { ok: true };
  }

  // ---------------------------------------------------------------- logbook and balance
  /** form A: each entry with its maximum storage date, what left the store and when, and what is left */
  async logbook(from: Date, to: Date, wasteTypeId?: string) {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const types = new Map((await this.types(companyId)).map((t) => [t.id, t]));
    const entries = await this.prisma.wasteEntry.findMany({
      where: { companyId, status: 'POSTED', ...(wasteTypeId && UUID.test(wasteTypeId) ? { wasteTypeId } : {}), OR: [{ date: { gte: from, lte: to } }, { date: { lt: from }, remainingQty: { gt: 0 } }] },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const outs = await this.allocations(companyId);
    const sup = new Map((await this.prisma.supplier.findMany({ where: { companyId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return entries.map((e) => {
      const taken = (outs.get(e.id) ?? []).filter((o) => o.date <= to);
      return {
        id: e.id,
        code: types.get(e.wasteTypeId)?.code ?? '',
        name: types.get(e.wasteTypeId)?.name ?? '',
        date: e.date,
        source: e.source,
        qty: Number(e.qty),
        maxStorageDate: e.maxStorageDate,
        outs: taken.map((o) => ({ date: o.date, qty: o.qty, number: o.number, manifestNo: o.manifestNo, treatment: o.treatment, destination: o.receiverId ? sup.get(o.receiverId) ?? '' : '' })),
        remaining: r3(Number(e.qty) - taken.reduce((a, o) => a + o.qty, 0)),
      };
    });
  }

  private async allocations(companyId: string) {
    const hs = await this.prisma.wasteHandover.findMany({ where: { companyId, status: 'POSTED' }, include: { lines: true } });
    const m = new Map<string, { date: Date; qty: number; number: string; manifestNo: string | null; treatment: string; receiverId: string | null }[]>();
    for (const h of hs) for (const l of h.lines) for (const a of (l.allocations as Alloc[]) ?? []) m.set(a.entryId, [...(m.get(a.entryId) ?? []), { date: h.date, qty: a.qty, number: h.number, manifestNo: h.manifestNo, treatment: h.treatment, receiverId: h.receiverId }]);
    return m;
  }

  /** form B (neraca limbah B3) for a period, in tonnes, with the monthly amounts stored and handed over (Art. 80 (7)) */
  async balance(from: Date, to: Date) {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });
    const types = await this.types(companyId);
    const entries = await this.prisma.wasteEntry.findMany({ where: { companyId, status: 'POSTED', date: { lte: to } } });
    const outs = await this.allocations(companyId);
    const hs = await this.prisma.wasteHandover.findMany({ where: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, include: { lines: true } });
    const t = (kg: number) => Math.round(kg) / 1000;
    const rows = types
      .map((ty) => {
        const mine = entries.filter((e) => e.wasteTypeId === ty.id);
        let opening = 0;
        let generated = 0;
        let stored = 0;
        let unmanaged = 0;
        for (const e of mine) {
          const o = outs.get(e.id) ?? [];
          if (e.date < from) opening += Number(e.qty) - o.filter((x) => x.date < from).reduce((a, x) => a + x.qty, 0);
          else generated += Number(e.qty);
          const left = Number(e.qty) - o.filter((x) => x.date <= to).reduce((a, x) => a + x.qty, 0);
          if (left > 1e-9) {
            if (e.maxStorageDate < to) unmanaged += left;
            else stored += left;
          }
        }
        const treated: Record<string, number> = Object.fromEntries(TREATMENTS.map((k) => [k, 0]));
        for (const h of hs) for (const l of h.lines.filter((x) => x.wasteTypeId === ty.id)) treated[h.treatment] += Number(l.qty);
        return { id: ty.id, code: ty.code, name: ty.name, category: ty.category, openingKg: r3(opening), generatedKg: r3(generated), storedKg: r3(stored), unmanagedKg: r3(unmanaged), treatedKg: Object.fromEntries(Object.entries(treated).map(([k, v]) => [k, r3(v)])) };
      })
      .filter((r) => r.openingKg || r.generatedKg || Object.values(r.treatedKg).some(Boolean));
    const A = rows.reduce((a, r) => a + r.openingKg + r.generatedKg, 0);
    const D_ = rows.reduce((a, r) => a + r.unmanagedKg, 0);
    const B = rows.reduce((a, r) => a + r.storedKg + Object.values(r.treatedKg).reduce((x, y) => x + y, 0), 0);
    // monthly amounts collected and handed over
    const months: { month: string; storedKg: number; handedKg: number }[] = [];
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const key = d.toISOString().slice(0, 7);
      months.push({
        month: key,
        storedKg: r3(entries.filter((e) => e.date >= d && e.date <= end && e.date >= from).reduce((a, e) => a + Number(e.qty), 0)),
        handedKg: r3(hs.filter((h) => h.date >= d && h.date <= end).reduce((a, h) => a + h.lines.reduce((x, l) => x + Number(l.qty), 0), 0)),
      });
    }
    return {
      company: company?.legalName || company?.name,
      from,
      to,
      rows: rows.map((r) => ({ ...r, openingT: t(r.openingKg), generatedT: t(r.generatedKg) })),
      totals: { A: t(A), B: t(B), C: 0, D: t(D_), remaining: t(D_) },
      // KINERJA = [A - (C + D)] / A x 100%
      performance: A > 0 ? Math.round(((A - D_) / A) * 10000) / 100 : null,
      months,
    };
  }
}
