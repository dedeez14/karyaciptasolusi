import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { DocumentService } from '../documents/document.service';
import { LotService } from '../documents/lot.service';
import { gradingDeduction, weigh } from '../plantation/plantation-calc';
import { allocateJoint, millKpis, parseCalibration, soundingKg, tbsFormulaPrice, type CalibrationRow } from './mill-calc';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const SUPPLIER_TYPES = ['MITRA', 'SWADAYA', 'AGENT', 'ESTATE'] as const;

export const tankSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['CPO', 'KERNEL', 'OTHER']).default('CPO'),
  productId: z.uuid(),
  warehouseId: z.uuid(),
  capacityKg: z.coerce.number().min(0).max(1e9).default(0),
  calibration: z.array(z.object({ cm: z.coerce.number().min(0).max(100_000), litres: z.coerce.number().min(0).max(1e9) })).max(5000).nullable().optional(),
  /** temperature of the calibration (0 = no shell correction) */
  calibrationTempC: z.coerce.number().min(0).max(100).default(0),
  isActive: z.boolean().default(true),
});

export const priceSchema = z.object({
  effectiveDate: z.coerce.date(),
  supplierType: z.enum(SUPPLIER_TYPES),
  pricePerKg: optNum,
  kIndex: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  cpoPrice: optNum,
  kernelPrice: optNum,
  cpoYield: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  kernelYield: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  shellValue: optNum,
  scope: optText(100),
  reference: optText(150),
});

const gradingSchema = z.object({ unripe: optNum, overripe: optNum, empty: optNum, longStalk: optNum, looseFruit: optNum, dirty: optNum, under3kg: optNum }).partial().nullable().optional();

export const intakeSchema = z.object({
  weighedAt: z.coerce.date(),
  supplierId: z.uuid(),
  supplierType: z.enum(SUPPLIER_TYPES),
  origin: optText(150),
  vehicleNo: optText(20),
  driver: optText(100),
  ticketNo: optText(40),
  bunches: z.coerce.number().int().min(0).max(1_000_000).default(0),
  grossKg: z.coerce.number().positive().max(1e7),
  tareKg: z.coerce.number().min(0).max(1e7),
  grading: gradingSchema,
  sortingPct: z.coerce.number().min(0).max(100).default(0),
  sortingKg: optNum,
  /** empty: the price board of the day for the supplier type */
  pricePerKg: optNum,
  productId: z.uuid(),
  warehouseId: z.uuid(),
  notes: optText(1000),
});

export const settleSchema = z.object({ supplierId: z.uuid(), from: z.coerce.date(), to: z.coerce.date(), date: z.coerce.date().optional() });

const outputLine = z.object({ productId: z.uuid(), warehouseId: z.uuid(), kind: z.enum(['MAIN', 'BY']), qty: z.coerce.number().min(0).max(1e9), price: z.coerce.number().min(0).max(1e9).default(0) });
const soundingLine = z.object({
  tankId: z.uuid(),
  heightCm: optNum,
  temperatureC: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(120).nullable().optional()),
  kg: optNum,
  ffa: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
});
export const dailySchema = z.object({
  date: z.coerce.date(),
  tbsProductId: z.uuid(),
  tbsWarehouseId: z.uuid(),
  tbsProcessedKg: z.coerce.number().min(0).max(1e8),
  processingHours: z.coerce.number().min(0).max(24).default(0),
  breakdownHours: z.coerce.number().min(0).max(24).default(0),
  /** empty: TBS processed (t) x the processing cost per ton in Settings */
  conversionCost: optNum,
  quality: z.record(z.string().max(30), z.coerce.number().min(0).max(100).nullable()).nullable().optional(),
  soundings: z.array(soundingLine).max(100).default([]),
  outputs: z.array(outputLine).min(1).max(20),
  notes: optText(2000),
});

type Tank = Prisma.MillTankGetPayload<object>;

/**
 * Palm oil mill (PKS):
 * - fruit bought at the weighbridge from smallholders, dealers and other estates: the sorting deduction, the price of the
 *   day, a goods receipt (Dr Inventory / Cr GRNI) and, per supplier and period, a draft supplier invoice; PPh 22 is
 *   withheld when the invoice is paid (above Rp20 million a month, PMK 51/2025); own fruit arrives through the estate SPB;
 * - storage tanks with their calibration table: sounding -> litres -> kg at the oil temperature;
 * - daily processing report: TBS processed, CPO and kernel made (from the tank stock change plus despatches), quality and
 *   losses, OER / KER; posting moves the TBS cost and the processing cost into the products, the joint cost shared by
 *   sales value and by-products at net realisable value.
 */
@Injectable()
export class MillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly documents: DocumentService,
    private readonly lots: LotService,
  ) {}

  private async density(companyId: string) {
    return {
      d0: await this.settings.num('mill.cpoDensity', companyId, 0.9135),
      t0: await this.settings.num('mill.cpoDensityTemp', companyId, 15),
      k: await this.settings.num('mill.cpoDensityCoef', companyId, 0.00069),
    };
  }

  private async owned<T>(model: 'millTank' | 'millIntake' | 'millDaily', id: string, label: string, db: PrismaService | Tx = this.prisma): Promise<T> {
    if (!UUID.test(id ?? '')) throw new NotFoundException(`${label} not found`);
    const row = await (db[model] as unknown as { findFirst: (a: unknown) => Promise<T | null> }).findFirst({ where: { id, companyId: RequestCtx.companyId(), ...(model === 'millIntake' ? {} : { deletedAt: null }) } });
    if (!row) throw new NotFoundException(`${label} not found`);
    return row;
  }

  // ================================================================ settings & lists
  async lists() {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const tanks = await this.prisma.millTank.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' } });
    const ids = [...new Set(tanks.flatMap((t) => [t.productId]))];
    const whs = [...new Set(tanks.map((t) => t.warehouseId))];
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouse.findMany({ where: { id: { in: whs } }, select: { id: true, code: true, name: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const wm = new Map(warehouses.map((w) => [w.id, w]));
    const last = await this.prisma.millDaily.findFirst({ where: { companyId, deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: { date: 'desc' }, include: { outputs: { orderBy: { lineNo: 'asc' } } } });
    return {
      capacityTph: await this.settings.num('mill.capacityTph', companyId, 30),
      costPerTon: await this.settings.num('mill.processingCostPerTon', companyId, 0),
      density: await this.density(companyId),
      limits: await this.limits(companyId),
      tanks: tanks.map((t) => ({ ...this.tankOut(t), product: pm.get(t.productId) ?? null, warehouse: wm.get(t.warehouseId) ?? null })),
      template: last
        ? { tbsProductId: last.tbsProductId, tbsWarehouseId: last.tbsWarehouseId, outputs: last.outputs.map((o) => ({ productId: o.productId, warehouseId: o.warehouseId, kind: o.kind, price: n(o.price) })) }
        : null,
    };
  }

  /** quality limits and loss norm (SNI 01-2901-2006 for CPO, SNI 01-0002-1987 for kernel; set per mill) */
  private async limits(companyId: string) {
    const v = (k: string, d: number) => this.settings.num(`mill.limit.${k}`, companyId, d);
    return {
      cpoFfa: await v('cpoFfa', 5),
      cpoMoisture: await v('cpoMoisture', 0.5),
      cpoDirt: await v('cpoDirt', 0.5),
      kernelMoisture: await v('kernelMoisture', 8),
      kernelDirt: await v('kernelDirt', 6),
      kernelBroken: await v('kernelBroken', 15),
      totalLoss: await v('totalLoss', 1.7),
    };
  }

  private tankOut(t: Tank) {
    return { id: t.id, code: t.code, name: t.name, kind: t.kind, productId: t.productId, warehouseId: t.warehouseId, capacityKg: n(t.capacityKg), calibration: (t.calibration as CalibrationRow[] | null) ?? null, calibrationTempC: n(t.calibrationTempC), isActive: t.isActive };
  }

  // ================================================================ tanks
  async saveTank(id: string | null, input: z.infer<typeof tankSchema>) {
    RequestCtx.assert('mill.tank.manage');
    const u = RequestCtx.user();
    let calibration: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    if (input.calibration && input.calibration.length) {
      try {
        calibration = parseCalibration(input.calibration) as unknown as Prisma.InputJsonValue;
      } catch (e) {
        throw invalid({ calibration: (e as Error).message });
      }
    } else if (input.kind === 'CPO') throw invalid({ calibration: 'A CPO tank needs its calibration table (tabel tera)' });
    const [p, w] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }),
    ]);
    if (!p || p.type !== 'STOCK') throw invalid({ productId: 'Choose a stock product (CPO, kernel...)' });
    if (!w) throw invalid({ warehouseId: 'Warehouse not found' });
    if (await this.prisma.millTank.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } })) throw invalid({ code: 'Code is already used' });
    const data = { code: input.code, name: input.name, kind: input.kind, productId: input.productId, warehouseId: input.warehouseId, capacityKg: D(input.capacityKg), calibration, calibrationTempC: D(input.calibrationTempC), isActive: input.isActive, updatedById: u.id };
    const t = id ? (await this.owned<Tank>('millTank', id, 'Tank'), await this.prisma.millTank.update({ where: { id }, data })) : await this.prisma.millTank.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Mill Tank', t.id, id ? 'UPDATE' : 'CREATE', undefined, { code: t.code, rows: Array.isArray(t.calibration) ? t.calibration.length : 0 });
    return this.tankOut(t);
  }

  async deleteTank(id: string) {
    RequestCtx.assert('mill.tank.manage');
    const t = await this.owned<Tank>('millTank', id, 'Tank');
    if (await this.prisma.millSounding.count({ where: { tankId: t.id, daily: { status: { not: 'CANCELLED' }, deletedAt: null } } })) throw new ConflictException('The tank has soundings: set it inactive instead');
    await this.prisma.millTank.update({ where: { id: t.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    return { ok: true };
  }

  /** litres / density / kg of a sounding (the editor shows it while typing) */
  async sounding(tankId: string, heightCm: number, temperatureC: number) {
    RequestCtx.assert('mill.read');
    const t = await this.owned<Tank>('millTank', tankId, 'Tank');
    if (!t.calibration) throw new BadRequestException('The tank has no calibration table');
    try {
      return soundingKg(t.calibration as unknown as CalibrationRow[], heightCm, temperatureC, await this.density(t.companyId), n(t.calibrationTempC));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  // ================================================================ TBS price board
  async prices(type?: string) {
    RequestCtx.assert('mill.read');
    const rows = await this.prisma.millTbsPrice.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null, ...(type ? { supplierType: type } : {}) }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
    return rows.map((r) => ({ ...r, pricePerKg: n(r.pricePerKg), kIndex: r.kIndex === null ? null : n(r.kIndex), cpoPrice: r.cpoPrice === null ? null : n(r.cpoPrice), kernelPrice: r.kernelPrice === null ? null : n(r.kernelPrice), cpoYield: r.cpoYield === null ? null : n(r.cpoYield), kernelYield: r.kernelYield === null ? null : n(r.kernelYield), shellValue: r.shellValue === null ? null : n(r.shellValue) }));
  }

  async savePrice(input: z.infer<typeof priceSchema>) {
    RequestCtx.assert('mill.price.manage');
    const u = RequestCtx.user();
    const formula = [input.kIndex, input.cpoPrice, input.kernelPrice, input.cpoYield, input.kernelYield].every((x) => x !== null && x !== undefined);
    if (input.supplierType === 'MITRA' && !formula && !input.pricePerKg) throw invalid({ kIndex: 'Enter the Disbun price or the formula inputs (K, CPO and kernel prices and yields)' });
    const price = formula ? tbsFormulaPrice({ kIndex: input.kIndex!, cpoPrice: input.cpoPrice!, kernelPrice: input.kernelPrice!, cpoYield: input.cpoYield!, kernelYield: input.kernelYield!, shellValue: input.shellValue }) : input.pricePerKg;
    if (!price || price <= 0) throw invalid({ pricePerKg: 'Enter the price per kg' });
    const r = await this.prisma.millTbsPrice.create({
      data: {
        companyId: u.companyId,
        effectiveDate: input.effectiveDate,
        supplierType: input.supplierType,
        pricePerKg: D(price),
        kIndex: input.kIndex ?? null,
        cpoPrice: input.cpoPrice ?? null,
        kernelPrice: input.kernelPrice ?? null,
        cpoYield: input.cpoYield ?? null,
        kernelYield: input.kernelYield ?? null,
        shellValue: input.shellValue ?? null,
        scope: input.scope ?? null,
        reference: input.reference ?? null,
        createdById: u.id,
      },
    });
    await this.audit.record('TBS Price', r.id, 'CREATE', undefined, { type: r.supplierType, date: iso(r.effectiveDate), price });
    return { id: r.id, pricePerKg: price };
  }

  async deletePrice(id: string) {
    RequestCtx.assert('mill.price.manage');
    const r = await this.prisma.millTbsPrice.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!r) throw new NotFoundException('Price not found');
    if (await this.prisma.millIntake.count({ where: { priceId: r.id, status: 'POSTED' } })) throw new ConflictException('Fruit was bought at this price: enter a new price from a later date instead');
    await this.prisma.millTbsPrice.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    return { ok: true };
  }

  private async priceFor(companyId: string, type: string, date: Date) {
    return this.prisma.millTbsPrice.findFirst({ where: { companyId, supplierType: type, deletedAt: null, effectiveDate: { lte: date } }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
  }

  async currentPrice(type: string, date?: string) {
    RequestCtx.assert('mill.read');
    const p = await this.priceFor(RequestCtx.companyId(), type, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date) : todayDate());
    return p ? { id: p.id, pricePerKg: n(p.pricePerKg), effectiveDate: p.effectiveDate } : null;
  }

  // ================================================================ third-party fruit intake
  async intakes(q: { from?: string; to?: string; supplierId?: string; status?: string }) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.millIntake.findMany({
      where: {
        companyId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
    const sup = new Map((await this.prisma.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const settled = await this.liveInvoices(rows.map((r) => r.invoiceDocId));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      weighedAt: r.weighedAt,
      status: r.status,
      supplier: sup.get(r.supplierId) ?? null,
      supplierType: r.supplierType,
      vehicleNo: r.vehicleNo,
      ticketNo: r.ticketNo,
      bunches: r.bunches,
      netKg: n(r.netKg),
      sortingPct: n(r.sortingPct),
      acceptedKg: n(r.acceptedKg),
      pricePerKg: n(r.pricePerKg),
      amount: n(r.amount),
      invoice: r.invoiceDocId ? settled.get(r.invoiceDocId) ?? null : null,
    }));
  }

  /** supplier invoices that still stand (a cancelled / deleted invoice frees its fruit for a new settlement) */
  private async liveInvoices(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, { id: string; number: string; status: string }>();
    const docs = await this.prisma.tradeDocument.findMany({ where: { id: { in: list }, deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true, number: true, status: true } });
    return new Map(docs.map((d) => [d.id, d]));
  }

  async intake(id: string) {
    RequestCtx.assert('mill.read');
    const r = await this.owned<Prisma.MillIntakeGetPayload<object>>('millIntake', id, 'Fruit intake');
    const [supplier, product, warehouse, receipt, inv] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: r.supplierId }, select: { id: true, code: true, name: true } }),
      this.prisma.product.findUnique({ where: { id: r.productId }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouse.findUnique({ where: { id: r.warehouseId }, select: { id: true, name: true } }),
      r.receiptDocId ? this.prisma.tradeDocument.findUnique({ where: { id: r.receiptDocId }, select: { id: true, number: true, status: true } }) : null,
      this.liveInvoices([r.invoiceDocId]),
    ]);
    return {
      ...r,
      grossKg: n(r.grossKg),
      tareKg: n(r.tareKg),
      netKg: n(r.netKg),
      sortingPct: n(r.sortingPct),
      sortingKg: n(r.sortingKg),
      acceptedKg: n(r.acceptedKg),
      pricePerKg: n(r.pricePerKg),
      amount: n(r.amount),
      supplier,
      product,
      warehouse,
      receipt,
      invoice: r.invoiceDocId ? inv.get(r.invoiceDocId) ?? null : null,
    };
  }

  /**
   * Weighbridge ticket of bought fruit: accepted weight after the sorting deduction (grading sample by Permentan 13/2024
   * Lampiran II, a % or kg) at the price of the day; the fruit is received into stock with a goods receipt.
   */
  async createIntake(input: z.infer<typeof intakeSchema>) {
    RequestCtx.assert('mill.intake');
    const u = RequestCtx.user();
    const date = new Date(localIso(input.weighedAt));
    if (input.weighedAt.getTime() > Date.now() + 5 * 60_000) throw invalid({ weighedAt: 'Cannot be in the future' });
    const [sup, prod, wh] = await Promise.all([
      this.prisma.supplier.findFirst({ where: { id: input.supplierId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }),
    ]);
    if (!sup) throw invalid({ supplierId: 'Supplier not found' });
    if (!prod || prod.type !== 'STOCK') throw invalid({ productId: 'Choose the fruit (a stock product)' });
    if (!wh) throw invalid({ warehouseId: 'Warehouse not found' });
    const graded = input.grading && Object.values(input.grading).some((x) => x !== null && x !== undefined) ? gradingDeduction(Object.fromEntries(Object.entries(input.grading).map(([k, v]) => [k, v ?? undefined]))) : null;
    const w = weigh(input.grossKg, input.tareKg, graded && (input.sortingKg === null || input.sortingKg === undefined) ? graded.pct : input.sortingPct, input.sortingKg ?? null);
    if (w.netKg <= 0) throw invalid({ tareKg: 'The tare must be below the gross weight' });
    if (w.acceptedKg <= 0) throw invalid({ sortingKg: 'The sorting deduction takes the whole load' });
    const board = await this.priceFor(u.companyId, input.supplierType, date);
    const price = input.pricePerKg ?? (board ? n(board.pricePerKg) : null);
    if (!price) throw invalid({ pricePerKg: `No price for ${input.supplierType.toLowerCase()} suppliers on this date: enter it or set the price board` });
    const amount = round(D(w.acceptedKg).times(price));
    // goods receipt: stock in at the price (Dr Inventory / Cr GRNI); the supplier invoice comes with the settlement
    const gr = (await this.documents.create(
      'GR',
      { date, supplierId: sup.id, warehouseId: wh.id, reference: input.ticketNo ?? undefined, notes: `TBS bought at the weighbridge${input.vehicleNo ? `, vehicle ${input.vehicleNo}` : ''}: net ${w.netKg} kg, sorting ${w.sortingPct}% (${w.sortingKg} kg)`, lines: [{ productId: prod.id, qty: w.acceptedKg, unitPrice: price }] },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    try {
      await this.documents.confirm('GR', gr.id, { skipPermission: true });
      const row = await this.prisma.$transaction(async (tx) =>
        tx.millIntake.create({
          data: {
            companyId: u.companyId,
            branchId: u.branchId ?? null,
            number: await this.sequence.next('MILL_INTAKE', u.companyId, date, tx),
            date,
            weighedAt: input.weighedAt,
            supplierId: sup.id,
            supplierType: input.supplierType,
            origin: input.origin ?? null,
            vehicleNo: input.vehicleNo ?? null,
            driver: input.driver ?? null,
            ticketNo: input.ticketNo ?? null,
            bunches: input.bunches,
            grossKg: D(input.grossKg),
            tareKg: D(input.tareKg),
            netKg: D(w.netKg),
            grading: graded ? ({ ...input.grading, parts: graded.parts, pct: graded.pct } as Prisma.InputJsonValue) : Prisma.DbNull,
            sortingPct: D(w.sortingPct),
            sortingKg: D(w.sortingKg),
            acceptedKg: D(w.acceptedKg),
            pricePerKg: D(price),
            priceId: input.pricePerKg === null || input.pricePerKg === undefined ? board?.id ?? null : null,
            amount,
            productId: prod.id,
            warehouseId: wh.id,
            receiptDocId: gr.id,
            notes: input.notes ?? null,
            createdById: u.id,
          },
        }),
      );
      await this.prisma.tradeDocument.update({ where: { id: gr.id }, data: { reference: row.number } });
      await this.audit.record('Mill Intake', row.id, 'CREATE', undefined, { number: row.number, acceptedKg: w.acceptedKg, price });
      return this.intake(row.id);
    } catch (e) {
      // the receipt must not stay without its intake
      const doc = await this.prisma.tradeDocument.findUnique({ where: { id: gr.id } });
      if (doc?.status === 'CONFIRMED') await this.documents.cancel('GR', gr.id, { skipPermission: true });
      else await this.prisma.tradeDocument.update({ where: { id: gr.id }, data: { deletedAt: new Date() } });
      throw e;
    }
  }

  async cancelIntake(id: string) {
    RequestCtx.assert('mill.intake');
    const r = await this.owned<Prisma.MillIntakeGetPayload<object>>('millIntake', id, 'Fruit intake');
    if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    if (r.invoiceDocId && (await this.liveInvoices([r.invoiceDocId])).size) throw new ConflictException('The fruit is on a supplier invoice: cancel or delete that invoice first');
    if (r.receiptDocId) {
      const gr = await this.prisma.tradeDocument.findUnique({ where: { id: r.receiptDocId } });
      if (gr && gr.status !== 'CANCELLED' && !gr.deletedAt) await this.documents.cancel('GR', gr.id, { skipPermission: true });
    }
    await this.prisma.millIntake.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Mill Intake', id, 'CANCEL');
    return { ok: true };
  }

  /** purchases from the supplier per month (PPh 22 is withheld above Rp20 million excl. PPN in a month, PMK 51/2025 Art. 4) */
  private async monthTotals(companyId: string, supplierId: string, months: string[]) {
    const out = new Map<string, number>();
    for (const m of months) {
      const from = new Date(`${m}-01`);
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
      const s = await this.prisma.millIntake.aggregate({ where: { companyId, supplierId, status: 'POSTED', date: { gte: from, lte: to } }, _sum: { amount: true } });
      out.set(m, n(s._sum.amount));
    }
    return out;
  }

  async settlePreview(q: z.infer<typeof settleSchema>) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.millIntake.findMany({ where: { companyId, supplierId: q.supplierId, status: 'POSTED', date: { gte: q.from, lte: q.to } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] });
    const live = await this.liveInvoices(rows.map((r) => r.invoiceDocId));
    const open = rows.filter((r) => !r.invoiceDocId || !live.has(r.invoiceDocId));
    const months = [...new Set(open.map((r) => iso(r.date).slice(0, 7)))];
    const totals = await this.monthTotals(companyId, q.supplierId, months);
    const threshold = await this.settings.num('mill.pph22Threshold', companyId, 20_000_000);
    const amount = open.reduce((a, r) => a + n(r.amount), 0);
    const pph22Base = open.filter((r) => (totals.get(iso(r.date).slice(0, 7)) ?? 0) > threshold).reduce((a, r) => a + n(r.amount), 0);
    return {
      intakes: open.map((r) => ({ id: r.id, number: r.number, date: r.date, ticketNo: r.ticketNo, acceptedKg: n(r.acceptedKg), pricePerKg: n(r.pricePerKg), amount: n(r.amount) })),
      kg: open.reduce((a, r) => a + n(r.acceptedKg), 0),
      amount,
      months: months.map((m) => ({ month: m, purchases: totals.get(m) ?? 0, pph22: (totals.get(m) ?? 0) > threshold })),
      pph22Base,
      pph22: Math.round(pph22Base * 0.0025),
      threshold,
    };
  }

  /** one draft supplier invoice for the open fruit of a supplier in a period (Dr GRNI / Cr AP when confirmed) */
  async settle(input: z.infer<typeof settleSchema>) {
    RequestCtx.assert('mill.settle');
    const p = await this.settlePreview(input);
    if (!p.intakes.length) throw new BadRequestException('No unsettled fruit from this supplier in the period');
    const first = await this.prisma.millIntake.findUniqueOrThrow({ where: { id: p.intakes[0].id } });
    const doc = (await this.documents.create(
      'PI',
      {
        date: input.date ?? input.to,
        supplierId: input.supplierId,
        warehouseId: first.warehouseId,
        reference: `TBS ${iso(input.from)} - ${iso(input.to)}`,
        notes: [
          `Fresh fruit bunches bought ${iso(input.from)} to ${iso(input.to)}: ${p.intakes.length} weighbridge tickets, ${p.kg.toLocaleString('en-US')} kg.`,
          p.pph22Base > 0
            ? `PPh 22 0.25% (PMK 51/2025) applies: purchases above Rp${p.threshold.toLocaleString('en-US')} in ${p.months.filter((m) => m.pph22).map((m) => m.month).join(', ')}. Withhold ${p.pph22.toLocaleString('en-US')} (tax PPH22-AGRI) when paying and give the bukti pungut.`
            : `No PPh 22: purchases up to Rp${p.threshold.toLocaleString('en-US')} a month are exempt (PMK 51/2025 Art. 4).`,
          'A PKP seller using the deemed rate (PPN 1.1%, PMK 64/2022 jo 11/2025) issues the faktur; the mill as industrial buyer collects that PPN (Art. 8): pay the seller the price without the PPN and deposit the 1.1% yourself. A PKP seller on the normal rate charges PPN 12% x 11/12, which the mill can credit.',
        ].join(' '),
        lines: p.intakes.map((r) => ({ productId: first.productId, description: `${r.number}${r.ticketNo ? ` / ${r.ticketNo}` : ''} ${iso(r.date)}`, qty: r.acceptedKg, unitPrice: r.pricePerKg })),
      },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    await this.prisma.millIntake.updateMany({ where: { id: { in: p.intakes.map((r) => r.id) } }, data: { invoiceDocId: doc.id } });
    await this.audit.record('Mill Intake', doc.id, 'SETTLE', undefined, { supplierId: input.supplierId, intakes: p.intakes.length, invoice: doc.number });
    return { id: doc.id, number: doc.number, ...p };
  }

  /** purchases per supplier in a period with the monthly PPh 22 threshold */
  async suppliers(q: { from: string; to: string }) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.millIntake.groupBy({ by: ['supplierId', 'supplierType'], where: { companyId, status: 'POSTED', date: { gte: new Date(q.from), lte: new Date(q.to) } }, _sum: { acceptedKg: true, netKg: true, sortingKg: true, amount: true }, _count: { _all: true } });
    const sup = new Map((await this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const threshold = await this.settings.num('mill.pph22Threshold', companyId, 20_000_000);
    const open = await this.prisma.millIntake.findMany({ where: { companyId, status: 'POSTED', date: { gte: new Date(q.from), lte: new Date(q.to) } }, select: { supplierId: true, amount: true, invoiceDocId: true, date: true } });
    const live = await this.liveInvoices(open.map((r) => r.invoiceDocId));
    const byMonth = new Map<string, number>();
    for (const r of open) byMonth.set(`${r.supplierId}|${iso(r.date).slice(0, 7)}`, (byMonth.get(`${r.supplierId}|${iso(r.date).slice(0, 7)}`) ?? 0) + n(r.amount));
    return rows
      .map((r) => ({
        supplier: sup.get(r.supplierId) ?? null,
        supplierType: r.supplierType,
        tickets: r._count._all,
        netKg: n(r._sum.netKg),
        sortingKg: n(r._sum.sortingKg),
        acceptedKg: n(r._sum.acceptedKg),
        amount: n(r._sum.amount),
        avgPrice: n(r._sum.acceptedKg) ? n(r._sum.amount) / n(r._sum.acceptedKg) : null,
        unsettled: open.filter((x) => x.supplierId === r.supplierId && (!x.invoiceDocId || !live.has(x.invoiceDocId))).reduce((a, x) => a + n(x.amount), 0),
        pph22Months: [...byMonth.entries()].filter(([k, v]) => k.startsWith(`${r.supplierId}|`) && v > threshold).map(([k]) => k.split('|')[1]),
      }))
      .sort((a, b) => b.acceptedKg - a.acceptedKg);
  }

  // ================================================================ daily processing report
  /** stock of a product in a warehouse at the end of a day */
  private async stockAt(productId: string, warehouseId: string, date: Date, db: PrismaService | Tx = this.prisma) {
    const s = await db.stockMovement.aggregate({ where: { productId, warehouseId, date: { lte: date } }, _sum: { qty: true } });
    return n(s._sum.qty);
  }

  /** figures the report starts from: fruit at the ramp and received, tank stock at the previous report and despatches of the day */
  async prefill(dateStr: string, tbsProductId?: string, tbsWarehouseId?: string, excludeId?: string) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new BadRequestException('Choose a date');
    const date = new Date(dateStr);
    const prevDay = new Date(date.getTime() - 86_400_000);
    const tanks = await this.prisma.millTank.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { code: 'asc' } });
    const prev = await this.prisma.millDaily.findFirst({ where: { companyId, deletedAt: null, status: 'POSTED', date: { lt: date }, ...(excludeId ? { id: { not: excludeId } } : {}) }, orderBy: { date: 'desc' }, include: { soundings: true } });
    let tbs = null as null | { openingKg: number; receivedKg: number; ownKg: number; boughtKg: number };
    if (tbsProductId && tbsWarehouseId) {
      const opening = await this.stockAt(tbsProductId, tbsWarehouseId, prevDay);
      const ins = await this.prisma.stockMovement.findMany({ where: { companyId, productId: tbsProductId, warehouseId: tbsWarehouseId, date, qty: { gt: 0 }, docType: { not: 'MILL' } }, select: { qty: true, docType: true } });
      const own = ins.filter((m) => m.docType === 'FFB').reduce((a, m) => a + n(m.qty), 0);
      const received = ins.reduce((a, m) => a + n(m.qty), 0);
      tbs = { openingKg: opening, receivedKg: received, ownKg: own, boughtKg: received - own };
    }
    // despatch of the day per tank product / warehouse (sales deliveries, transfers out), the mill's own posting excluded
    const keys = [...new Set(tanks.map((t) => `${t.productId}|${t.warehouseId}`))];
    const despatch: Record<string, number> = {};
    const systemStock: Record<string, number> = {};
    for (const k of keys) {
      const [productId, warehouseId] = k.split('|');
      const out = await this.prisma.stockMovement.aggregate({ where: { companyId, productId, warehouseId, date, qty: { lt: 0 }, docType: { not: 'MILL' } }, _sum: { qty: true } });
      despatch[k] = -n(out._sum.qty);
      systemStock[k] = await this.stockAt(productId, warehouseId, prevDay);
    }
    return {
      previous: prev ? { id: prev.id, number: prev.number, date: prev.date } : null,
      tbs,
      tanks: tanks.map((t) => {
        const s = prev?.soundings.find((x) => x.tankId === t.id);
        const key = `${t.productId}|${t.warehouseId}`;
        // no earlier report: the opening is the stock in the system
        const shared = tanks.filter((x) => `${x.productId}|${x.warehouseId}` === key).length;
        return { ...this.tankOut(t), openingKg: s ? n(s.kg) : shared === 1 ? systemStock[key] : null, openingFrom: s ? 'SOUNDING' : 'SYSTEM' };
      }),
      despatch,
      systemStock,
    };
  }

  async dailies(q: { from?: string; to?: string; status?: string }) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.millDaily.findMany({
      where: { companyId, deletedAt: null, ...(q.status ? { status: q.status } : {}), ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) },
      orderBy: { date: 'desc' },
      take: 400,
      include: { outputs: true },
    });
    const capacity = await this.settings.num('mill.capacityTph', companyId, 30);
    const kinds = await this.outputKinds(rows.flatMap((r) => r.outputs.map((o) => o.productId)));
    return rows.map((r) => this.summary(r, kinds, capacity));
  }

  /** CPO / kernel product ids by the tank they are stored in */
  private async outputKinds(productIds: string[]) {
    const tanks = await this.prisma.millTank.findMany({ where: { companyId: RequestCtx.companyId(), productId: { in: productIds } }, select: { productId: true, kind: true } });
    return new Map(tanks.map((t) => [t.productId, t.kind]));
  }

  private summary(r: Prisma.MillDailyGetPayload<{ include: { outputs: true } }>, kinds: Map<string, string>, capacity: number) {
    const cpo = r.outputs.filter((o) => kinds.get(o.productId) === 'CPO').reduce((a, o) => a + n(o.qty), 0);
    const kernel = r.outputs.filter((o) => kinds.get(o.productId) === 'KERNEL').reduce((a, o) => a + n(o.qty), 0);
    const q = (r.quality ?? {}) as Record<string, number | null>;
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      tbsOpeningKg: n(r.tbsOpeningKg),
      tbsReceivedKg: n(r.tbsReceivedKg),
      tbsProcessedKg: n(r.tbsProcessedKg),
      restanKg: n(r.tbsOpeningKg) + n(r.tbsReceivedKg) - n(r.tbsProcessedKg),
      processingHours: n(r.processingHours),
      breakdownHours: n(r.breakdownHours),
      cpoKg: cpo,
      kernelKg: kernel,
      cpoFfa: q.cpoFfa ?? null,
      totalLoss: ['lossFibre', 'lossEfb', 'lossNut', 'lossEffluent'].some((k) => q[k] !== null && q[k] !== undefined) ? Math.round(['lossFibre', 'lossEfb', 'lossNut', 'lossEffluent'].reduce((a, k) => a + n(q[k]), 0) * 100) / 100 : null,
      ...millKpis({ processedKg: n(r.tbsProcessedKg), cpoKg: cpo, kernelKg: kernel, hours: n(r.processingHours), capacityTph: capacity }),
      tbsCost: n(r.tbsCost),
      conversionCost: n(r.conversionCost),
    };
  }

  async daily(id: string) {
    RequestCtx.assert('mill.read');
    const r = await this.prisma.millDaily.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { outputs: { orderBy: { lineNo: 'asc' } }, soundings: true } });
    if (!r || !UUID.test(id)) throw new NotFoundException('Daily report not found');
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [r.tbsProductId, ...r.outputs.map((o) => o.productId)] } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const warehouses = new Map((await this.prisma.warehouse.findMany({ where: { id: { in: [r.tbsWarehouseId, ...r.outputs.map((o) => o.warehouseId)] } }, select: { id: true, name: true } })).map((w) => [w.id, w]));
    const capacity = await this.settings.num('mill.capacityTph', r.companyId, 30);
    const kinds = await this.outputKinds(r.outputs.map((o) => o.productId));
    return {
      ...this.summary(r, kinds, capacity),
      tbsProductId: r.tbsProductId,
      tbsWarehouseId: r.tbsWarehouseId,
      tbsProduct: products.get(r.tbsProductId) ?? null,
      tbsWarehouse: warehouses.get(r.tbsWarehouseId) ?? null,
      quality: r.quality,
      notes: r.notes,
      postedAt: r.postedAt,
      outputs: r.outputs.map((o) => ({ ...o, qty: n(o.qty), price: n(o.price), cost: n(o.cost), product: products.get(o.productId) ?? null, warehouse: warehouses.get(o.warehouseId) ?? null, tankKind: kinds.get(o.productId) ?? null })),
      soundings: r.soundings.map((s) => ({ ...s, heightCm: s.heightCm === null ? null : n(s.heightCm), temperatureC: s.temperatureC === null ? null : n(s.temperatureC), volumeL: s.volumeL === null ? null : n(s.volumeL), density: s.density === null ? null : n(s.density), kg: n(s.kg), ffa: s.ffa === null ? null : n(s.ffa) })),
    };
  }

  async saveDaily(id: string | null, input: z.infer<typeof dailySchema>) {
    RequestCtx.assert('mill.daily.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'The date cannot be in the future' });
    const [tbsP, tbsW] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: input.tbsProductId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.warehouse.findFirst({ where: { id: input.tbsWarehouseId, companyId: u.companyId, deletedAt: null } }),
    ]);
    if (!tbsP || tbsP.type !== 'STOCK') throw invalid({ tbsProductId: 'Choose the fruit product' });
    if (!tbsW) throw invalid({ tbsWarehouseId: 'Warehouse not found' });
    const errors: Record<string, string> = {};
    const prods = await this.prisma.product.findMany({ where: { companyId: u.companyId, deletedAt: null, id: { in: input.outputs.map((o) => o.productId) } } });
    const whs = await this.prisma.warehouse.findMany({ where: { companyId: u.companyId, deletedAt: null, id: { in: input.outputs.map((o) => o.warehouseId) } } });
    input.outputs.forEach((o, i) => {
      const p = prods.find((x) => x.id === o.productId);
      if (!p || p.type !== 'STOCK') errors[`outputs.${i}.productId`] = 'Choose a stock product';
      if (!whs.some((w) => w.id === o.warehouseId)) errors[`outputs.${i}.warehouseId`] = 'Warehouse not found';
      if (o.productId === input.tbsProductId) errors[`outputs.${i}.productId`] = 'The fruit cannot be an output';
    });
    if (!input.outputs.some((o) => o.kind === 'MAIN')) errors.outputs = 'Add the main products (CPO, kernel)';
    if (Object.keys(errors).length) throw invalid(errors);
    // soundings -> kg
    const tanks = new Map((await this.prisma.millTank.findMany({ where: { companyId: u.companyId, id: { in: input.soundings.map((s) => s.tankId) } } })).map((t) => [t.id, t]));
    const dens = await this.density(u.companyId);
    const soundings = input.soundings.map((s, i) => {
      const t = tanks.get(s.tankId);
      if (!t) throw invalid({ [`soundings.${i}.tankId`]: 'Tank not found' });
      if (t.kind === 'CPO' && s.heightCm !== null && s.heightCm !== undefined) {
        if (s.temperatureC === null || s.temperatureC === undefined) throw invalid({ [`soundings.${i}.temperatureC`]: 'Enter the oil temperature' });
        try {
          const r = soundingKg(t.calibration as unknown as CalibrationRow[], s.heightCm, s.temperatureC, dens, n(t.calibrationTempC));
          return { tankId: t.id, heightCm: D(s.heightCm), temperatureC: D(s.temperatureC), volumeL: D(r.litres), density: D(r.density), kg: D(r.kg), ffa: s.ffa === null || s.ffa === undefined ? null : D(s.ffa) };
        } catch (e) {
          throw invalid({ [`soundings.${i}.heightCm`]: (e as Error).message });
        }
      }
      if (s.kg === null || s.kg === undefined) throw invalid({ [`soundings.${i}.kg`]: 'Enter the sounding or the kg' });
      return { tankId: t.id, heightCm: null, temperatureC: null, volumeL: null, density: null, kg: D(s.kg), ffa: s.ffa === null || s.ffa === undefined ? null : D(s.ffa) };
    });
    const pre = await this.prefill(localIso(input.date), input.tbsProductId, input.tbsWarehouseId, id ?? undefined);
    const available = (pre.tbs?.openingKg ?? 0) + (pre.tbs?.receivedKg ?? 0);
    if (input.tbsProcessedKg > available + 0.001) throw invalid({ tbsProcessedKg: `Only ${available.toLocaleString('en-US')} kg of fruit was at the mill on this day` });
    const costPerTon = await this.settings.num('mill.processingCostPerTon', u.companyId, 0);
    const conversion = input.conversionCost ?? Math.round((input.tbsProcessedKg / 1000) * costPerTon);
    const head = {
      date: input.date,
      tbsProductId: input.tbsProductId,
      tbsWarehouseId: input.tbsWarehouseId,
      tbsOpeningKg: D(pre.tbs?.openingKg ?? 0),
      tbsReceivedKg: D(pre.tbs?.receivedKg ?? 0),
      tbsProcessedKg: D(input.tbsProcessedKg),
      processingHours: D(input.processingHours),
      breakdownHours: D(input.breakdownHours),
      conversionCost: D(conversion),
      quality: input.quality ? (input.quality as Prisma.InputJsonValue) : Prisma.DbNull,
      notes: input.notes ?? null,
      updatedById: u.id,
    };
    const row = await this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM mill_dailies WHERE id = ${id}::uuid FOR UPDATE`;
        const before = await tx.millDaily.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
        if (!before) throw new NotFoundException('Daily report not found');
        if (before.status !== 'DRAFT') throw new ConflictException('Only a draft report can be changed');
        await tx.millDailyOutput.deleteMany({ where: { dailyId: id } });
        await tx.millSounding.deleteMany({ where: { dailyId: id } });
        return tx.millDaily.update({ where: { id }, data: { ...head, outputs: { create: input.outputs.map((o, i) => ({ ...o, lineNo: i + 1, qty: D(o.qty), price: D(o.price) })) }, soundings: { create: soundings } } });
      }
      if (await tx.millDaily.findFirst({ where: { companyId: u.companyId, date: input.date, deletedAt: null, status: { not: 'CANCELLED' } } })) throw invalid({ date: 'There is already a report for this day' });
      // a cancelled report of the same day keeps its number but frees the date
      await tx.millDaily.updateMany({ where: { companyId: u.companyId, date: input.date, status: 'CANCELLED', deletedAt: null }, data: { deletedAt: new Date() } });
      return tx.millDaily.create({
        data: {
          ...head,
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          number: await this.sequence.next('MILL_DAILY', u.companyId, input.date, tx),
          createdById: u.id,
          outputs: { create: input.outputs.map((o, i) => ({ ...o, lineNo: i + 1, qty: D(o.qty), price: D(o.price) })) },
          soundings: { create: soundings },
        },
      });
    });
    await this.audit.record('Mill Daily Report', row.id, id ? 'UPDATE' : 'CREATE', undefined, { number: row.number, processedKg: input.tbsProcessedKg });
    return this.daily(row.id);
  }

  /**
   * Posts the day: the TBS processed leaves stock at its cost; with the processing cost (credited to overhead applied)
   * it is the joint cost, less the by-products at net realisable value, shared by the main products in proportion to
   * their sales value; the products enter their tanks / stores at that cost.
   */
  async postDaily(id: string) {
    RequestCtx.assert('mill.daily.post');
    const u = RequestCtx.user();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mill_dailies WHERE id = ${id}::uuid FOR UPDATE`;
        const r = await tx.millDaily.findFirst({ where: { id, companyId: u.companyId, deletedAt: null }, include: { outputs: { orderBy: { lineNo: 'asc' } } } });
        if (!r) throw new NotFoundException('Daily report not found');
        if (r.status !== 'DRAFT') throw new ConflictException('The report is not a draft');
        const later = await tx.millDaily.findFirst({ where: { companyId: u.companyId, deletedAt: null, status: 'POSTED', date: { gt: r.date } } });
        if (later) throw new ConflictException(`The report of ${iso(later.date)} is already posted: post the days in order`);
        const processed = D(r.tbsProcessedKg);
        let tbsCost = D(0);
        if (processed.gt(0)) {
          const p = await tx.product.findFirstOrThrow({ where: { id: r.tbsProductId } });
          if (p.trackLots) {
            await this.lots.ensureOpening(tx, u.companyId, p.id, r.tbsWarehouseId);
            await this.lots.issue(tx, { companyId: u.companyId, documentId: r.id, lineId: r.id, productId: p.id, warehouseId: r.tbsWarehouseId, qty: processed });
          }
          const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: r.branchId, productId: p.id, productName: p.name, warehouseId: r.tbsWarehouseId, date: r.date, qty: processed.neg(), docType: 'MILL', documentId: r.id, documentNumber: r.number, allowNegative: false });
          tbsCost = round(mv.totalCost.abs());
        }
        const joint = n(tbsCost) + n(r.conversionCost);
        const alloc = allocateJoint(
          joint,
          r.outputs.map((o) => ({ kind: o.kind as 'MAIN' | 'BY', qty: n(o.qty), price: n(o.price) })),
        );
        if (alloc.pool < 0) throw new ConflictException('The by-products at net realisable value are worth more than the whole joint cost: check their values');
        let inValue = D(0);
        for (const [i, o] of r.outputs.entries()) {
          const cost = D(alloc.cost[i]);
          await tx.millDailyOutput.update({ where: { id: o.id }, data: { cost } });
          if (D(o.qty).lte(0)) continue;
          const p = await tx.product.findFirstOrThrow({ where: { id: o.productId } });
          const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: r.branchId, productId: p.id, productName: p.name, warehouseId: o.warehouseId, date: r.date, qty: D(o.qty), unitCost: cost.gt(0) ? cost.div(o.qty) : D(0.0001), docType: 'MILL', documentId: r.id, documentNumber: r.number, allowNegative: true });
          if (p.trackLots) await this.lots.receive(tx, { companyId: u.companyId, documentId: r.id, lineId: o.id, productId: p.id, warehouseId: o.warehouseId, qty: D(o.qty), lotNo: r.number, docNumber: r.number, docDate: r.date, shelfLifeDays: p.shelfLifeDays });
          inValue = inValue.plus(round(mv.totalCost));
        }
        // stock moves between inventory accounts net out; the processing cost (and its rounding) is what reaches the ledger
        const applied = inValue.minus(tbsCost);
        if (!applied.isZero())
          await this.journal.post(tx, {
            companyId: u.companyId,
            branchId: r.branchId,
            date: r.date,
            description: `Mill processing ${r.number}: ${n(processed).toLocaleString('en-US')} kg TBS`,
            reference: r.number,
            sourceType: 'MILL',
            sourceId: r.id,
            lines: applied.gt(0)
              ? [
                  { key: 'INVENTORY', debit: applied, description: 'Processing cost into CPO / kernel' },
                  { key: 'OVERHEAD_APPLIED', credit: applied, description: 'Mill processing cost applied' },
                ]
              : [
                  { key: 'OVERHEAD_APPLIED', debit: applied.abs(), description: 'Mill processing cost applied' },
                  { key: 'INVENTORY', credit: applied.abs(), description: 'Processing cost into CPO / kernel' },
                ],
          });
        await tx.millDaily.update({ where: { id: r.id }, data: { status: 'POSTED', tbsCost, postedAt: new Date(), postedById: u.id, updatedById: u.id } });
      },
      { timeout: 30_000 },
    );
    await this.audit.record('Mill Daily Report', id, 'POST');
    return this.daily(id);
  }

  /** cancels a report: a draft is dropped; the last posted day is reversed (products out, fruit back) */
  async cancelDaily(id: string) {
    const u = RequestCtx.user();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mill_dailies WHERE id = ${id}::uuid FOR UPDATE`;
        const r = await tx.millDaily.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
        if (!r) throw new NotFoundException('Daily report not found');
        if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
        if (r.status === 'DRAFT') {
          RequestCtx.assert('mill.daily.record');
          await tx.millDaily.update({ where: { id }, data: { status: 'CANCELLED', deletedAt: new Date(), updatedById: u.id } });
          return;
        }
        RequestCtx.assert('mill.daily.post');
        const later = await tx.millDaily.findFirst({ where: { companyId: u.companyId, deletedAt: null, status: 'POSTED', date: { gt: r.date } } });
        if (later) throw new ConflictException(`Cancel the report of ${iso(later.date)} first`);
        await this.inventory.reverse(tx, r.id, false);
        await this.lots.reverse(tx, r.id);
        await this.journal.voidBySource(tx, 'MILL', r.id);
        await tx.millDaily.update({ where: { id }, data: { status: 'CANCELLED', updatedById: u.id } });
      },
      { timeout: 30_000 },
    );
    await this.audit.record('Mill Daily Report', id, 'CANCEL');
    return { ok: true };
  }

  /**
   * Monthly report of the mill to the provincial plantation office (Permentan 13/2024 Art. 23 (1)): K index and TBS price
   * used, fruit bought from partner smallholders, fruit processed and CPO / kernel made.
   */
  async dinasReport(month: string) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('Choose a month');
    const from = new Date(`${month}-01`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    const perf = await this.performance({ from: iso(from), to: iso(to) });
    const byType = await this.prisma.millIntake.groupBy({ by: ['supplierType'], where: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, _sum: { acceptedKg: true, amount: true }, _count: { _all: true } });
    const partners = await this.prisma.millIntake.groupBy({ by: ['supplierId'], where: { companyId, status: 'POSTED', supplierType: 'MITRA', date: { gte: from, lte: to } }, _sum: { acceptedKg: true, amount: true, sortingKg: true, netKg: true }, _count: { _all: true } });
    const sup = new Map((await this.prisma.supplier.findMany({ where: { id: { in: partners.map((p) => p.supplierId) } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const prices = await this.prisma.millTbsPrice.findMany({ where: { companyId, deletedAt: null, supplierType: 'MITRA', effectiveDate: { lte: to } }, orderBy: { effectiveDate: 'desc' }, take: 10 });
    const used = prices.filter((p) => p.effectiveDate >= from).concat(prices.filter((p) => p.effectiveDate < from).slice(0, 1));
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, address: true } });
    return {
      month,
      company,
      production: perf.totals,
      days: perf.days.length,
      byType: byType.map((t) => ({ supplierType: t.supplierType, tickets: t._count._all, kg: n(t._sum.acceptedKg), amount: n(t._sum.amount) })),
      partners: partners
        .map((p) => ({ supplier: sup.get(p.supplierId) ?? null, tickets: p._count._all, netKg: n(p._sum.netKg), sortingKg: n(p._sum.sortingKg), kg: n(p._sum.acceptedKg), amount: n(p._sum.amount), avgPrice: n(p._sum.acceptedKg) ? n(p._sum.amount) / n(p._sum.acceptedKg) : null }))
        .sort((a, b) => b.kg - a.kg),
      prices: used.map((p) => ({ effectiveDate: p.effectiveDate, pricePerKg: n(p.pricePerKg), kIndex: p.kIndex === null ? null : n(p.kIndex), cpoPrice: p.cpoPrice === null ? null : n(p.cpoPrice), kernelPrice: p.kernelPrice === null ? null : n(p.kernelPrice), cpoYield: p.cpoYield === null ? null : n(p.cpoYield), kernelYield: p.kernelYield === null ? null : n(p.kernelYield), scope: p.scope, reference: p.reference })),
    };
  }

  /** mill performance per day in a period with totals (OER / KER on the totals, not the average of the days) */
  async performance(q: { from: string; to: string }) {
    RequestCtx.assert('mill.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.millDaily.findMany({ where: { companyId, deletedAt: null, status: 'POSTED', date: { gte: new Date(q.from), lte: new Date(q.to) } }, orderBy: { date: 'asc' }, include: { outputs: true } });
    const capacity = await this.settings.num('mill.capacityTph', companyId, 30);
    const kinds = await this.outputKinds(rows.flatMap((r) => r.outputs.map((o) => o.productId)));
    const days = rows.map((r) => this.summary(r, kinds, capacity));
    const t = days.reduce((a, d) => ({ received: a.received + d.tbsReceivedKg, processed: a.processed + d.tbsProcessedKg, cpo: a.cpo + d.cpoKg, kernel: a.kernel + d.kernelKg, hours: a.hours + d.processingHours, breakdown: a.breakdown + d.breakdownHours, cost: a.cost + d.tbsCost + d.conversionCost }), { received: 0, processed: 0, cpo: 0, kernel: 0, hours: 0, breakdown: 0, cost: 0 });
    const intake = await this.prisma.millIntake.aggregate({ where: { companyId, status: 'POSTED', date: { gte: new Date(q.from), lte: new Date(q.to) } }, _sum: { acceptedKg: true } });
    return {
      capacityTph: capacity,
      days,
      totals: { ...t, bought: n(intake._sum.acceptedKg), ...millKpis({ processedKg: t.processed, cpoKg: t.cpo, kernelKg: t.kernel, hours: t.hours, capacityTph: capacity }), costPerKgProduct: t.cpo + t.kernel ? t.cost / (t.cpo + t.kernel) : null },
    };
  }
}
