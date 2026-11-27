import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, ZERO } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { forEachCompany } from '../billing/job-context';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f-]{36}$/i;
const day = 86_400_000;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const todayDate = () => new Date(new Date().toISOString().slice(0, 10));

export const planSchema = z
  .object({
    equipmentId: z.uuid(),
    name: z.string().trim().min(1).max(150),
    intervalDays: z.coerce.number().int().min(0).max(3650).default(0),
    intervalCounter: z.coerce.number().min(0).max(1e9).default(0),
    leadDays: z.coerce.number().int().min(0).max(90).default(3),
    checklist: optText(4000),
    estimatedMinutes: z.coerce.number().int().min(0).max(100000).default(0),
    lastDoneAt: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
    lastCounter: z.coerce.number().min(0).max(1e12).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.intervalDays > 0 || p.intervalCounter > 0, { path: ['intervalDays'], message: 'Give an interval in days and / or in counter units' });
export const orderSchema = z.object({
  equipmentId: z.uuid(),
  type: z.enum(['PREVENTIVE', 'BREAKDOWN', 'INSPECTION']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  description: z.string().trim().min(3).max(4000),
  dueDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  /** a breakdown that stops the equipment: downtime runs until the order is done */
  stopsEquipment: z.boolean().default(false),
});
export const completeSchema = z.object({
  workDone: z.string().trim().min(3).max(4000),
  technician: optText(120),
  labourHours: z.coerce.number().min(0).max(10000).default(0),
  labourCost: z.coerce.number().min(0).max(1e12).default(0),
  warehouseId: optUuid,
  parts: z.array(z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e6) })).max(50).default([]),
  counter: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().min(0).max(1e12).optional()),
  /** inspection orders can renew the K3 certificate */
  inspectionCertNo: optText(100),
  inspectionExpiry: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
});
export const downtimeSchema = z.object({
  workCenterId: optUuid,
  equipmentId: optUuid,
  startAt: z.coerce.date(),
  endAt: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  reason: z.enum(['BREAKDOWN', 'SETUP', 'NO_MATERIAL', 'NO_OPERATOR', 'QUALITY', 'POWER', 'PLANNED']),
  notes: optText(500),
});

/**
 * Maintenance: preventive plans by time and / or usage (machine hours from the shop floor, shots of a mould...),
 * breakdown and inspection orders, spare parts issued from stock to the maintenance expense, downtime and OEE,
 * K3 periodic inspection certificates (riksa uji: Permenaker 38/2016 machines, 37/2016 pressure vessels) with expiry.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
  ) {}

  private async equipment(id: string) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Equipment not found');
    const e = await this.prisma.equipment.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!e) throw new NotFoundException('Equipment not found');
    return e;
  }

  // ---------------------------------------------------------------- plans
  private nextDue(p: { intervalDays: number; intervalCounter: Prisma.Decimal; lastDoneAt: Date | null; lastCounter: Prisma.Decimal; createdAt: Date }, counter: number) {
    const dueDate = p.intervalDays > 0 ? new Date((p.lastDoneAt ?? p.createdAt).getTime() + p.intervalDays * day) : null;
    const dueCounter = n(p.intervalCounter) > 0 ? n(p.lastCounter) + n(p.intervalCounter) : null;
    return { dueDate, dueCounter, counterLeft: dueCounter === null ? null : Math.round((dueCounter - counter) * 100) / 100 };
  }

  async plans() {
    RequestCtx.assert('maintenance.order.read');
    const companyId = RequestCtx.companyId();
    const [rows, equipment] = await Promise.all([this.prisma.maintenancePlan.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } }), this.prisma.equipment.findMany({ where: { companyId, deletedAt: null } })]);
    const em = new Map(equipment.map((e) => [e.id, e]));
    const open = await this.prisma.maintenanceOrder.findMany({ where: { companyId, planId: { in: rows.map((r) => r.id) }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { planId: true, number: true } });
    const today = todayDate();
    return rows.map((p) => {
      const e = em.get(p.equipmentId);
      const d = this.nextDue(p, n(e?.counter));
      const due = (d.dueDate && d.dueDate.getTime() - p.leadDays * day <= today.getTime()) || (d.counterLeft !== null && d.counterLeft <= n(p.intervalCounter) * 0.05);
      return { ...p, intervalCounter: n(p.intervalCounter), lastCounter: n(p.lastCounter), equipment: e ? { id: e.id, code: e.code, name: e.name, counter: n(e.counter), counterUnit: e.counterUnit } : null, ...d, due: !!due, openOrder: open.find((o) => o.planId === p.id)?.number ?? null };
    });
  }

  async savePlan(id: string | null, input: z.infer<typeof planSchema>) {
    RequestCtx.assert('maintenance.plan.manage');
    const e = await this.equipment(input.equipmentId);
    const data = { ...input, intervalCounter: D(input.intervalCounter), lastCounter: D(input.lastCounter), checklist: input.checklist ?? null, lastDoneAt: input.lastDoneAt ?? null };
    let r;
    if (id) {
      if (!(await this.prisma.maintenancePlan.count({ where: { id, companyId: e.companyId } }))) throw new NotFoundException('Plan not found');
      r = await this.prisma.maintenancePlan.update({ where: { id }, data });
    } else r = await this.prisma.maintenancePlan.create({ data: { ...data, companyId: e.companyId } });
    await this.audit.record('Maintenance Plan', r.id, id ? 'UPDATE' : 'CREATE', undefined, { equipment: e.code, name: input.name });
    return r;
  }

  /** creates the preventive orders of plans that are due and have no open order yet */
  async generateDue(companyId = RequestCtx.companyId()) {
    const plans = await this.prisma.maintenancePlan.findMany({ where: { companyId, isActive: true } });
    const equipment = new Map((await this.prisma.equipment.findMany({ where: { companyId, deletedAt: null, status: { not: 'RETIRED' }, isActive: true } })).map((e) => [e.id, e]));
    const created: string[] = [];
    const today = todayDate();
    for (const p of plans) {
      const e = equipment.get(p.equipmentId);
      if (!e) continue;
      const d = this.nextDue(p, n(e.counter));
      const byDate = !!d.dueDate && d.dueDate.getTime() - p.leadDays * day <= today.getTime();
      const byCounter = d.counterLeft !== null && d.counterLeft <= n(p.intervalCounter) * 0.05;
      if (!byDate && !byCounter) continue;
      if (await this.prisma.maintenanceOrder.count({ where: { planId: p.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } })) continue;
      const o = await this.prisma.$transaction(async (tx) =>
        tx.maintenanceOrder.create({
          data: {
            companyId,
            number: await this.sequence.next('MAINT_ORDER', companyId, new Date(), tx),
            equipmentId: e.id,
            planId: p.id,
            type: 'PREVENTIVE',
            description: `${p.name}${p.checklist ? `\n\n${p.checklist}` : ''}`,
            dueDate: d.dueDate && byDate ? d.dueDate : today,
          },
        }),
      );
      created.push(o.number);
    }
    return { created };
  }

  @Cron('0 5 * * *', { name: 'maintenance-due' })
  async nightly() {
    await forEachCompany(this.prisma, this.logger, 'maintenance-due', (companyId) => this.generateDue(companyId));
  }

  // ---------------------------------------------------------------- orders
  async orders(status?: string) {
    RequestCtx.assert('maintenance.order.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.maintenanceOrder.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: [{ status: 'asc' }, { reportedAt: 'desc' }], take: 300 });
    const eq = new Map((await this.prisma.equipment.findMany({ where: { id: { in: rows.map((r) => r.equipmentId) } }, select: { id: true, code: true, name: true, status: true } })).map((e) => [e.id, e]));
    return rows.map((r) => ({ ...r, equipment: eq.get(r.equipmentId) ?? null }));
  }

  private async ownOrder(id: string) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Maintenance order not found');
    const o = await this.prisma.maintenanceOrder.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { parts: true } });
    if (!o) throw new NotFoundException('Maintenance order not found');
    return o;
  }

  async order(id: string) {
    RequestCtx.assert('maintenance.order.read');
    const o = await this.ownOrder(id);
    const [equipment, products] = await Promise.all([this.prisma.equipment.findUnique({ where: { id: o.equipmentId } }), this.prisma.product.findMany({ where: { id: { in: o.parts.map((p) => p.productId) } }, select: { id: true, code: true, name: true } })]);
    const pm = new Map(products.map((p) => [p.id, p]));
    return { ...o, equipment, parts: o.parts.map((p) => ({ ...p, product: pm.get(p.productId) ?? null })) };
  }

  /** opens an order; a breakdown that stops the equipment marks it down and starts its downtime */
  async createOrder(input: z.infer<typeof orderSchema>) {
    RequestCtx.assert('maintenance.order.manage');
    const u = RequestCtx.user();
    const e = await this.equipment(input.equipmentId);
    const stops = input.type === 'BREAKDOWN' && input.stopsEquipment;
    const o = await this.prisma.$transaction(async (tx) => {
      const r = await tx.maintenanceOrder.create({ data: { companyId: u.companyId, number: await this.sequence.next('MAINT_ORDER', u.companyId, new Date(), tx), equipmentId: e.id, type: input.type, priority: input.priority, description: input.description, dueDate: input.dueDate ?? null, stopsEquipment: stops, createdById: u.id } });
      if (stops) {
        await tx.equipment.update({ where: { id: e.id }, data: { status: 'DOWN' } });
        await tx.downtimeEvent.create({ data: { companyId: u.companyId, equipmentId: e.id, workCenterId: e.workCenterId, startAt: r.reportedAt, reason: 'BREAKDOWN', maintenanceOrderId: r.id, notes: input.description.slice(0, 500), createdById: u.id } });
      }
      return r;
    });
    await this.audit.record('Maintenance Order', o.id, 'CREATE', undefined, { number: o.number, equipment: e.code, type: input.type, stops });
    return o;
  }

  async start(id: string) {
    RequestCtx.assert('maintenance.order.manage');
    const o = await this.ownOrder(id);
    if (o.status !== 'OPEN') throw new ConflictException('Only an open order can be started');
    return this.prisma.maintenanceOrder.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
  }

  /**
   * completes the work: parts out of stock (Dr maintenance expense / Cr inventory), downtime closed, equipment running,
   * the plan's last service moved forward, an inspection order can renew the K3 certificate.
   * Labour is recorded for the statistics only (wages are already expensed through payroll).
   */
  async complete(id: string, input: z.infer<typeof completeSchema>) {
    RequestCtx.assert('maintenance.order.manage');
    const u = RequestCtx.user();
    const o = await this.ownOrder(id);
    if (!['OPEN', 'IN_PROGRESS'].includes(o.status)) throw new ConflictException('This order is closed');
    if (input.parts.length && !input.warehouseId) throw new BadRequestException({ message: 'Validation failed', errors: { warehouseId: 'Choose the warehouse the parts come from' } });
    const wh = input.warehouseId ? await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }) : null;
    if (input.warehouseId && !wh) throw new BadRequestException('Warehouse not found');
    const allowNegative = await this.settings.bool('inventory.allowNegativeStock', u.companyId, false);
    const e = await this.prisma.equipment.findUniqueOrThrow({ where: { id: o.equipmentId } });
    const now = new Date();
    const date = todayDate();
    const r = await this.prisma.$transaction(
      async (tx) => {
        let partsCost = ZERO;
        if (input.parts.length) {
          const products = new Map((await tx.product.findMany({ where: { id: { in: input.parts.map((p) => p.productId) }, companyId: u.companyId } })).map((p) => [p.id, p]));
          for (const p of input.parts) {
            const prod = products.get(p.productId);
            if (!prod || prod.type !== 'STOCK') throw new BadRequestException('Parts must be stock products');
            const m = await this.inventory.move(tx, { companyId: u.companyId, branchId: wh!.branchId, date, docType: 'MNT', documentId: o.id, documentNumber: o.number, allowNegative, productId: prod.id, productName: prod.name, warehouseId: wh!.id, qty: D(p.qty).neg() });
            const cost = round(m.totalCost.abs());
            partsCost = partsCost.plus(cost);
            await tx.maintenancePart.create({ data: { orderId: o.id, productId: prod.id, qty: D(p.qty), unitCost: m.unitCost } });
          }
          if (partsCost.gt(0)) await this.journal.post(tx, { companyId: u.companyId, branchId: wh!.branchId, date, description: `${o.number}: parts for ${e.code} ${e.name}`, reference: o.number, sourceType: 'MNT', sourceId: o.id, lines: [{ key: 'MAINTENANCE_EXPENSE', debit: partsCost }, { key: 'INVENTORY', credit: partsCost }] });
        }
        let downtime = ZERO;
        if (o.stopsEquipment) {
          const ev = await tx.downtimeEvent.findFirst({ where: { maintenanceOrderId: o.id, endAt: null } });
          if (ev) {
            downtime = D((now.getTime() - ev.startAt.getTime()) / 60000).toDecimalPlaces(2);
            await tx.downtimeEvent.update({ where: { id: ev.id }, data: { endAt: now, minutes: downtime } });
          }
        }
        const counter = input.counter !== undefined ? D(input.counter) : D(e.counter);
        await tx.equipment.update({
          where: { id: e.id },
          data: {
            ...(e.status === 'DOWN' ? { status: 'RUNNING' } : {}),
            ...(input.counter !== undefined ? { counter } : {}),
            ...(o.type === 'INSPECTION' && input.inspectionCertNo ? { inspectionCertNo: input.inspectionCertNo, inspectionExpiry: input.inspectionExpiry ?? null } : {}),
          },
        });
        if (o.planId) await tx.maintenancePlan.update({ where: { id: o.planId }, data: { lastDoneAt: date, lastCounter: counter } });
        return tx.maintenanceOrder.update({
          where: { id },
          data: { status: 'DONE', doneAt: now, startedAt: o.startedAt ?? now, workDone: input.workDone, technician: input.technician ?? null, labourHours: D(input.labourHours), labourCost: D(input.labourCost), partsCost, downtimeMinutes: downtime, counterAtDone: counter, warehouseId: wh?.id ?? null },
        });
      },
      { timeout: 60_000 },
    );
    await this.audit.record('Maintenance Order', id, 'COMPLETE', { status: o.status }, { parts: r.partsCost.toString(), downtimeMinutes: r.downtimeMinutes.toString() });
    return r;
  }

  async cancel(id: string) {
    RequestCtx.assert('maintenance.order.manage');
    const o = await this.ownOrder(id);
    if (!['OPEN', 'IN_PROGRESS'].includes(o.status)) throw new ConflictException('This order is closed');
    await this.prisma.$transaction(async (tx) => {
      await tx.maintenanceOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
      if (o.stopsEquipment) {
        await tx.downtimeEvent.updateMany({ where: { maintenanceOrderId: id, endAt: null }, data: { endAt: new Date() } });
        await tx.equipment.updateMany({ where: { id: o.equipmentId, status: 'DOWN' }, data: { status: 'RUNNING' } });
      }
    });
    await this.audit.record('Maintenance Order', id, 'CANCEL');
    return { ok: true };
  }

  async setCounter(equipmentId: string, value: number) {
    RequestCtx.assert('maintenance.order.manage');
    const e = await this.equipment(equipmentId);
    if (value < n(e.counter)) throw new BadRequestException(`The counter cannot go back (now ${n(e.counter)})`);
    await this.prisma.equipment.update({ where: { id: e.id }, data: { counter: D(value) } });
    await this.audit.record('Equipment', e.id, 'COUNTER', { counter: e.counter.toString() }, { counter: value });
    return { ok: true };
  }

  // ---------------------------------------------------------------- downtime & OEE
  async downtime(from: Date, to: Date) {
    RequestCtx.assert('maintenance.order.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.downtimeEvent.findMany({ where: { companyId, startAt: { lt: to }, OR: [{ endAt: null }, { endAt: { gte: from } }] }, orderBy: { startAt: 'desc' }, take: 500 });
    const [wcs, eqs] = await Promise.all([this.prisma.workCenter.findMany({ where: { companyId } }), this.prisma.equipment.findMany({ where: { companyId } })]);
    const wm = new Map(wcs.map((w) => [w.id, w.name]));
    const em = new Map(eqs.map((e) => [e.id, e.name]));
    return rows.map((r) => ({ ...r, minutes: r.endAt ? n(r.minutes) : Math.round((Date.now() - r.startAt.getTime()) / 600) / 100, workCenter: r.workCenterId ? wm.get(r.workCenterId) ?? null : null, equipment: r.equipmentId ? em.get(r.equipmentId) ?? null : null }));
  }

  async addDowntime(input: z.infer<typeof downtimeSchema>) {
    RequestCtx.assert('maintenance.order.manage');
    const u = RequestCtx.user();
    if (!input.workCenterId && !input.equipmentId) throw new BadRequestException('Choose the work centre or the equipment');
    const e = input.equipmentId ? await this.equipment(input.equipmentId) : null;
    if (input.workCenterId && !(await this.prisma.workCenter.count({ where: { id: input.workCenterId, companyId: u.companyId } }))) throw new BadRequestException('Work centre not found');
    if (input.endAt && input.endAt <= input.startAt) throw new BadRequestException({ message: 'Validation failed', errors: { endAt: 'After the start' } });
    const minutes = input.endAt ? (input.endAt.getTime() - input.startAt.getTime()) / 60000 : 0;
    return this.prisma.downtimeEvent.create({ data: { companyId: u.companyId, workCenterId: input.workCenterId ?? e?.workCenterId ?? null, equipmentId: e?.id ?? null, startAt: input.startAt, endAt: input.endAt ?? null, minutes: D(minutes).toDecimalPlaces(2), reason: input.reason, planned: input.reason === 'PLANNED', notes: input.notes ?? null, createdById: u.id } });
  }

  async endDowntime(id: string) {
    RequestCtx.assert('maintenance.order.manage');
    const ev = await this.prisma.downtimeEvent.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!ev) throw new NotFoundException('Downtime not found');
    if (ev.endAt) throw new ConflictException('Already ended');
    const now = new Date();
    return this.prisma.downtimeEvent.update({ where: { id }, data: { endAt: now, minutes: D((now.getTime() - ev.startAt.getTime()) / 60000).toDecimalPlaces(2) } });
  }

  /**
   * OEE per work centre for a period:
   * Availability = (planned time - unplanned stops) / planned time, planned time = normal capacity of the period;
   * Performance = standard minutes of the steps finished / minutes actually worked;
   * Quality = good / (good + scrap) of those steps; OEE = A x P x Q. Utilisation = minutes worked / time available.
   */
  async oee(from: Date, to: Date) {
    RequestCtx.assert('maintenance.order.read');
    const companyId = RequestCtx.companyId();
    const days = Math.max(1, (to.getTime() - from.getTime()) / day);
    const [centres, ops, events, equipment] = await Promise.all([
      this.prisma.workCenter.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' } }),
      this.prisma.workOrderOperation.findMany({ where: { kind: 'INTERNAL', status: 'DONE', finishedAt: { gte: from, lt: to }, workOrder: { companyId, status: { not: 'CANCELLED' } } }, select: { workCenterId: true, plannedMinutes: true, actualMinutes: true, goodQty: true, scrapQty: true } }),
      this.prisma.downtimeEvent.findMany({ where: { companyId, planned: false, startAt: { lt: to }, OR: [{ endAt: null }, { endAt: { gte: from } }] } }),
      this.prisma.equipment.findMany({ where: { companyId, deletedAt: null }, select: { id: true, workCenterId: true } }),
    ]);
    const eqWc = new Map(equipment.map((e) => [e.id, e.workCenterId]));
    return centres.map((c) => {
      const planned = n(c.capacityHours) * c.stations * 60 * (days / 30.4);
      const stops = events
        .filter((e) => (e.workCenterId ?? (e.equipmentId ? eqWc.get(e.equipmentId) : null)) === c.id)
        .reduce((a, e) => {
          const s = Math.max(e.startAt.getTime(), from.getTime());
          const end = Math.min((e.endAt ?? new Date()).getTime(), to.getTime());
          return a + Math.max(0, (end - s) / 60000);
        }, 0);
      const mine = ops.filter((o) => o.workCenterId === c.id);
      const std = mine.reduce((a, o) => a + n(o.plannedMinutes), 0);
      const worked = mine.reduce((a, o) => a + n(o.actualMinutes), 0);
      const good = mine.reduce((a, o) => a + n(o.goodQty), 0);
      const scrap = mine.reduce((a, o) => a + n(o.scrapQty), 0);
      const A = planned > 0 ? Math.max(0, (planned - stops) / planned) : null;
      const P = worked > 0 ? std / worked : null;
      const Q = good + scrap > 0 ? good / (good + scrap) : null;
      const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        plannedHours: Math.round((planned / 60) * 10) / 10,
        downtimeHours: Math.round((stops / 60) * 10) / 10,
        workedHours: Math.round((worked / 60) * 10) / 10,
        availability: pct(A),
        performance: pct(P),
        quality: pct(Q),
        oee: A !== null && P !== null && Q !== null ? pct(A * Math.min(P, 1) * Q) : null,
        utilisation: planned - stops > 0 ? pct(worked / (planned - stops)) : null,
      };
    });
  }

  /** K3 inspection certificates expiring in the next 60 days (or expired) */
  async inspectionsDue() {
    RequestCtx.assert('maintenance.order.read');
    const limit = new Date(Date.now() + 60 * day);
    const rows = await this.prisma.equipment.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null, status: { not: 'RETIRED' }, inspectionExpiry: { not: null, lte: limit } }, orderBy: { inspectionExpiry: 'asc' } });
    return rows.map((e) => ({ id: e.id, code: e.code, name: e.name, kind: e.kind, certNo: e.inspectionCertNo, expiry: e.inspectionExpiry, daysLeft: Math.ceil((e.inspectionExpiry!.getTime() - todayDate().getTime()) / day) }));
  }
}
