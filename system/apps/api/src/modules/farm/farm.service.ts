import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round, ZERO } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { DocumentService } from '../documents/document.service';
import { LotService } from '../documents/lot.service';
import { cycleKpis } from './farm-kpi';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());

export const SPECIES = ['BROILER', 'LAYER', 'BREEDER', 'DUCK', 'QUAIL', 'FISH', 'SHRIMP', 'OTHER'] as const;
const LAYING_SPECIES = ['LAYER', 'BREEDER', 'DUCK', 'QUAIL'];

export const cycleSchema = z.object({
  unitId: z.uuid(),
  species: z.enum(SPECIES),
  strain: optText(100),
  placementDate: z.coerce.date(),
  initialQty: z.coerce.number().int().positive().max(100_000_000),
  initialAgeDays: z.coerce.number().int().min(0).max(3650).default(0),
  warehouseId: z.uuid(),
  stockProductId: optUuid,
  outputProductId: optUuid,
  cullProductId: optUuid,
  eggProductId: optUuid,
  eggUnit: z.enum(['KG', 'PCS']).default('KG'),
  contractId: optUuid,
  targetFcr: optNum,
  targetWeightKg: optNum,
  targetAgeDays: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(3650).nullable().optional()),
  notes: optText(2000),
});
export const dailySchema = z.object({
  date: z.coerce.date(),
  mortality: z.coerce.number().int().min(0).max(100_000_000).default(0),
  culled: z.coerce.number().int().min(0).max(100_000_000).default(0),
  abnormal: z.boolean().default(false),
  feedProductId: optUuid,
  feedKg: z.coerce.number().min(0).max(1e9).default(0),
  waterL: optNum,
  avgWeightG: optNum,
  sampleSize: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(1_000_000).nullable().optional()),
  eggsGood: z.coerce.number().int().min(0).max(100_000_000).default(0),
  eggsCracked: z.coerce.number().int().min(0).max(100_000_000).default(0),
  eggsKg: z.coerce.number().min(0).max(1e9).default(0),
  tempMin: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(-50).max(80).nullable().optional()),
  tempMax: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(-50).max(80).nullable().optional()),
  humidity: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  waterQuality: z.object({ do: optNum, ph: optNum, salinity: optNum, tempC: optNum, ammonia: optNum, transparencyCm: optNum }).partial().nullable().optional(),
  notes: optText(1000),
});
export const treatmentSchema = z.object({
  kind: z.enum(['VACCINE', 'MEDICINE', 'VITAMIN', 'DISINFECTANT']),
  status: z.enum(['PLANNED', 'DONE']).default('DONE'),
  date: z.coerce.date(),
  productId: optUuid,
  description: z.string().trim().min(1).max(200),
  qty: z.coerce.number().min(0).max(1e9).default(0),
  method: optText(40),
  withdrawalDays: z.coerce.number().int().min(0).max(365).default(0),
  vet: optText(120),
  notes: optText(500),
});
export const costSchema = z.object({ date: z.coerce.date(), kind: z.enum(['LABOUR', 'OVERHEAD']), description: z.string().trim().min(1).max(200), amount: z.coerce.number().positive().max(1e13) });
export const harvestSchema = z.object({
  date: z.coerce.date(),
  kind: z.enum(['HARVEST', 'CULL']).default('HARVEST'),
  /** final: everything still alive is taken (fish / shrimp ponds where the count is an estimate) */
  final: z.boolean().default(false),
  qty: z.coerce.number().int().min(0).max(100_000_000).default(0),
  weightKg: z.coerce.number().positive().max(1e9),
  customerId: optUuid,
  pricePerKg: optNum,
  fairValue: optNum,
  deliveryNo: optText(60),
  vehicleNo: optText(30),
  overrideReason: optText(300),
  notes: optText(500),
});

type Cycle = Prisma.LivestockCycleGetPayload<object>;

/**
 * Livestock and aquaculture production cycles (broiler, layer, breeder, duck, quail, fish, shrimp): placement from
 * stock, daily records, vaccinations and medicines with withdrawal periods, harvests into stock, KPIs.
 * Accounting (SAK EP, cost model for biological assets whose fair value is not readily determinable): stock, feed,
 * medicines, labour and overhead are charged to biological assets (1-1450); abnormal mortality is expensed; the
 * harvest takes its share of the cost into inventory, or its fair value less costs to sell when given (difference to
 * 4-9200); eggs take the laying-phase costs and the write-off of the rearing cost over the laying period.
 * PP 49/2022: livestock, feed, eggs and meat are exempt from PPN (faktur code 08).
 */
@Injectable()
export class FarmService {
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

  // ---------------------------------------------------------------- helpers
  private async own(id: string, db: PrismaService | Tx = this.prisma): Promise<Cycle> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Cycle not found');
    const c = await db.livestockCycle.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!c) throw new NotFoundException('Cycle not found');
    return c;
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM livestock_cycles WHERE id = ${id}::uuid FOR UPDATE`;
    return this.own(id, tx);
  }

  private alive(c: Cycle) {
    return c.initialQty - c.mortality - c.culled - c.harvestedQty;
  }

  private carrying(c: Cycle) {
    return D(c.costIn).minus(c.costOut);
  }

  private allowNegative(companyId: string) {
    return this.settings.bool('inventory.allowNegativeStock', companyId, false);
  }

  private assertDate(c: Cycle, date: Date) {
    if (date < c.placementDate) throw new BadRequestException({ message: 'Validation failed', errors: { date: 'Before the placement of the cycle' } });
    if (date > new Date(todayDate().getTime() + DAY)) throw new BadRequestException({ message: 'Validation failed', errors: { date: 'In the future' } });
  }

  /** issues stock to the cycle and charges its cost (Dr biological assets / Cr inventory) */
  private async issueToCycle(tx: Tx, c: Cycle, productId: string, qty: Prisma.Decimal, date: Date, kind: string, docType: string, sourceId: string, label: string) {
    const p = await tx.product.findFirst({ where: { id: productId, companyId: c.companyId, deletedAt: null } });
    if (!p || p.type !== 'STOCK') throw new BadRequestException(`${p?.name ?? 'The product'} is not a stock product`);
    if (p.trackLots) {
      await this.lots.ensureOpening(tx, c.companyId, p.id, c.warehouseId);
      await this.lots.issue(tx, { companyId: c.companyId, documentId: sourceId, lineId: sourceId, productId: p.id, warehouseId: c.warehouseId, qty });
    }
    const r = await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: c.warehouseId, date, qty: qty.neg(), docType, documentId: sourceId, documentNumber: c.number, allowNegative: await this.allowNegative(c.companyId) });
    const value = round(r.totalCost.abs());
    await this.charge(tx, c, value, date, kind, `${label}: ${p.name}`, docType, sourceId, 'INVENTORY');
    return { value, product: p };
  }

  /** charges a cost to the cycle */
  private async charge(tx: Tx, c: Cycle, value: Prisma.Decimal, date: Date, kind: string, description: string, sourceType: string, sourceId: string, creditKey: string) {
    if (value.lte(0)) return;
    await this.journal.post(tx, { companyId: c.companyId, branchId: c.branchId, date, description: `${c.number}: ${description}`, reference: c.number, sourceType, sourceId, lines: [{ key: 'BIO_ASSET', debit: value }, { key: creditKey, credit: value }] });
    await tx.livestockCycle.update({ where: { id: c.id }, data: { costIn: { increment: value }, ...(c.phase === 'LAYING' ? { layingPool: { increment: value } } : {}) } });
    await tx.livestockCost.create({ data: { cycleId: c.id, date, kind, description: description.slice(0, 200), amount: value, sourceType, sourceId } });
  }

  /** produce received into stock gets its own lot when the product is tracked by lot */
  private async receiveLot(tx: Tx, c: Cycle, p: { id: string; trackLots: boolean; shelfLifeDays: number }, qty: Prisma.Decimal, sourceId: string, lotNo: string, date: Date) {
    if (!p.trackLots || qty.lte(0)) return;
    await this.lots.receive(tx, { companyId: c.companyId, documentId: sourceId, lineId: sourceId, productId: p.id, warehouseId: c.warehouseId, qty, lotNo, docNumber: lotNo, docDate: date, shelfLifeDays: p.shelfLifeDays });
  }

  // ---------------------------------------------------------------- cycles
  async list(status?: string, species?: string) {
    RequestCtx.assert('farm.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.livestockCycle.findMany({ where: { companyId, ...(status ? { status } : { status: { not: 'CANCELLED' } }), ...(species ? { species } : {}) }, orderBy: [{ placementDate: 'desc' }, { number: 'desc' }], take: 500 });
    const sites = new Map((await this.prisma.farmSite.findMany({ where: { companyId } })).map((s) => [s.id, s]));
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId } })).map((u) => [u.id, u]));
    const weights = await this.latestWeights(rows.map((r) => r.id));
    const today = todayDate();
    return rows.map((c) => ({
      id: c.id,
      number: c.number,
      species: c.species,
      strain: c.strain,
      status: c.status,
      phase: c.phase,
      placementDate: c.placementDate,
      initialQty: c.initialQty,
      site: sites.get(c.siteId) ? { name: sites.get(c.siteId)!.name, ownership: sites.get(c.siteId)!.ownership } : null,
      unit: units.get(c.unitId)?.name ?? null,
      plasma: !!c.contractId,
      withdrawalUntil: c.withdrawalUntil,
      kpi: cycleKpis(this.kpiInput(c, weights.get(c.id) ?? null, null, null), today),
    }));
  }

  private kpiInput(c: Cycle, latestWeightKg: number | null, harvestAgeDays: number | null, lastEggs: { eggs: number; hens: number } | null) {
    return { initialQty: c.initialQty, initialAgeDays: c.initialAgeDays, placementDate: c.placementDate, mortality: c.mortality, culled: c.culled, harvestedQty: c.harvestedQty, harvestedKg: n(c.harvestedKg), feedKg: n(c.feedKg), costIn: n(c.costIn), costOut: n(c.costOut), abnormalLoss: n(c.abnormalLoss), closedAt: c.closedAt, latestWeightKg, harvestAgeDays, lastEggs };
  }

  private async latestWeights(ids: string[]) {
    const rows = await this.prisma.livestockDaily.findMany({ where: { cycleId: { in: ids }, avgWeightG: { not: null } }, orderBy: { date: 'desc' }, select: { cycleId: true, avgWeightG: true } });
    const m = new Map<string, number>();
    for (const r of rows) if (!m.has(r.cycleId)) m.set(r.cycleId, n(r.avgWeightG) / 1000);
    return m;
  }

  async get(id: string) {
    RequestCtx.assert('farm.read');
    const c = await this.own(id);
    const [site, unit, daily, treatments, costs, harvests, products, contract, settlement] = await Promise.all([
      this.prisma.farmSite.findUnique({ where: { id: c.siteId } }),
      this.prisma.farmUnit.findUnique({ where: { id: c.unitId } }),
      this.prisma.livestockDaily.findMany({ where: { cycleId: c.id }, orderBy: { date: 'asc' } }),
      this.prisma.livestockTreatment.findMany({ where: { cycleId: c.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.livestockCost.findMany({ where: { cycleId: c.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.livestockHarvest.findMany({ where: { cycleId: c.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.product.findMany({ where: { id: { in: [c.stockProductId, c.outputProductId, c.cullProductId, c.eggProductId].filter(Boolean) as string[] } }, select: { id: true, code: true, name: true } }),
      c.contractId ? this.prisma.partnerContract.findUnique({ where: { id: c.contractId } }) : null,
      this.prisma.partnerSettlement.findFirst({ where: { cycleId: c.id, status: 'POSTED' } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const feedIds = [...new Set([...daily.map((d) => d.feedProductId!), ...treatments.map((t) => t.productId!)].filter(Boolean))];
    const names = new Map((await this.prisma.product.findMany({ where: { id: { in: feedIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const custIds = harvests.map((h) => h.customerId!).filter(Boolean);
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const docs = new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: harvests.map((h) => h.deliveryDocId!).filter(Boolean) }, deletedAt: null }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]));
    const partner = contract ? await this.prisma.supplier.findUnique({ where: { id: contract.partnerId }, select: { id: true, name: true } }) : null;
    // population per day
    let alive = c.initialQty;
    const posted = harvests.filter((h) => h.status === 'POSTED');
    const days = daily.map((d) => {
      const harvestedBefore = posted.filter((h) => h.date < d.date).reduce((a, h) => a + h.qty, 0);
      const start = alive - harvestedBefore;
      alive -= d.mortality + d.culled;
      const age = c.initialAgeDays + Math.round((d.date.getTime() - c.placementDate.getTime()) / DAY);
      return { ...d, age, aliveStart: start, feedProduct: d.feedProductId ? names.get(d.feedProductId) ?? null : null, feedKg: n(d.feedKg), waterL: d.waterL === null ? null : n(d.waterL), avgWeightG: d.avgWeightG === null ? null : n(d.avgWeightG), eggsKg: n(d.eggsKg), feedCost: n(d.feedCost), lossValue: n(d.lossValue), eggCost: n(d.eggCost), amortisation: n(d.amortisation), tempMin: d.tempMin === null ? null : n(d.tempMin), tempMax: d.tempMax === null ? null : n(d.tempMax), humidity: d.humidity === null ? null : n(d.humidity) };
    });
    const weighed = [...daily].reverse().find((d) => d.avgWeightG !== null);
    const kgSum = posted.reduce((a, h) => a + n(h.weightKg), 0);
    const harvestAge = kgSum ? posted.reduce((a, h) => a + h.ageDays * n(h.weightKg), 0) / kgSum : null;
    const lastEgg = [...days].reverse().find((d) => d.eggsGood + d.eggsCracked > 0);
    const kpi = cycleKpis(this.kpiInput(c, weighed ? n(weighed.avgWeightG) / 1000 : null, harvestAge, lastEgg ? { eggs: lastEgg.eggsGood + lastEgg.eggsCracked, hens: lastEgg.aliveStart - lastEgg.mortality - lastEgg.culled } : null), todayDate());
    return {
      ...c,
      costIn: n(c.costIn),
      costOut: n(c.costOut),
      abnormalLoss: n(c.abnormalLoss),
      harvestedKg: n(c.harvestedKg),
      feedKg: n(c.feedKg),
      eggsKg: n(c.eggsKg),
      rearingCost: n(c.rearingCost),
      rearingAmortised: n(c.rearingAmortised),
      layingPool: n(c.layingPool),
      targetFcr: c.targetFcr === null ? null : n(c.targetFcr),
      targetWeightKg: c.targetWeightKg === null ? null : n(c.targetWeightKg),
      site,
      unit,
      products: { stock: pm.get(c.stockProductId!) ?? null, output: pm.get(c.outputProductId!) ?? null, cull: pm.get(c.cullProductId!) ?? null, egg: pm.get(c.eggProductId!) ?? null },
      contract: contract ? { id: contract.id, number: contract.number, partner } : null,
      settlement: settlement ? { id: settlement.id, number: settlement.number, net: n(settlement.net) } : null,
      layingSpecies: LAYING_SPECIES.includes(c.species),
      kpi,
      daily: days,
      treatments: treatments.map((t) => ({ ...t, qty: n(t.qty), cost: n(t.cost), product: t.productId ? names.get(t.productId) ?? null : null })),
      costs: costs.map((x) => ({ ...x, amount: n(x.amount) })),
      harvests: harvests.map((h) => ({ ...h, weightKg: n(h.weightKg), pricePerKg: h.pricePerKg === null ? null : n(h.pricePerKg), fairValue: h.fairValue === null ? null : n(h.fairValue), cost: n(h.cost), customer: h.customerId ? customers.get(h.customerId) ?? null : null, delivery: h.deliveryDocId ? docs.get(h.deliveryDocId) ?? null : null })),
    };
  }

  async create(input: z.infer<typeof cycleSchema>) {
    RequestCtx.assert('farm.cycle.manage');
    const u = RequestCtx.user();
    const err = (k: string, m: string) => new BadRequestException({ message: 'Validation failed', errors: { [k]: m } });
    const unit = await this.prisma.farmUnit.findFirst({ where: { id: input.unitId, companyId: u.companyId, deletedAt: null, isActive: true } });
    if (!unit) throw err('unitId', 'House / pond not found');
    const site = await this.prisma.farmSite.findFirst({ where: { id: unit.siteId, companyId: u.companyId, deletedAt: null } });
    if (!site) throw err('unitId', 'Its farm was not found');
    if (unit.capacity > 0 && input.initialQty > unit.capacity) throw err('initialQty', `More than the capacity of ${unit.name} (${unit.capacity})`);
    if (await this.prisma.livestockCycle.count({ where: { unitId: unit.id, status: { in: ['PLANNED', 'ACTIVE'] } } })) throw err('unitId', `${unit.name} already has an open cycle`);
    if (!(await this.prisma.warehouse.count({ where: { id: input.warehouseId, companyId: u.companyId } }))) throw err('warehouseId', 'Warehouse not found');
    for (const k of ['stockProductId', 'outputProductId', 'cullProductId', 'eggProductId'] as const) {
      const v = input[k];
      if (v && !(await this.prisma.product.count({ where: { id: v, companyId: u.companyId, deletedAt: null, type: 'STOCK' } }))) throw err(k, 'Choose a stock product');
    }
    if (input.contractId) {
      const k = await this.prisma.partnerContract.findFirst({ where: { id: input.contractId, companyId: u.companyId, deletedAt: null, status: 'ACTIVE' } });
      if (!k) throw err('contractId', 'Active partnership contract not found');
      if (site.ownership !== 'PLASMA' || (site.partnerId && site.partnerId !== k.partnerId)) throw err('contractId', 'The contract must be with the farmer of this plasma farm');
    } else if (site.ownership === 'PLASMA') throw err('contractId', 'A plasma farm needs the partnership contract');
    const c = await this.prisma.livestockCycle.create({
      data: {
        companyId: u.companyId,
        branchId: site.branchId,
        number: await this.sequence.next('FARM_CYCLE', u.companyId, input.placementDate),
        siteId: site.id,
        unitId: unit.id,
        species: input.species,
        strain: input.strain ?? null,
        placementDate: input.placementDate,
        initialQty: input.initialQty,
        initialAgeDays: input.initialAgeDays,
        warehouseId: input.warehouseId,
        stockProductId: input.stockProductId ?? null,
        outputProductId: input.outputProductId ?? null,
        cullProductId: input.cullProductId ?? null,
        eggProductId: input.eggProductId ?? null,
        eggUnit: input.eggUnit,
        contractId: input.contractId ?? null,
        targetFcr: input.targetFcr === null || input.targetFcr === undefined ? null : D(input.targetFcr),
        targetWeightKg: input.targetWeightKg === null || input.targetWeightKg === undefined ? null : D(input.targetWeightKg),
        targetAgeDays: input.targetAgeDays ?? null,
        notes: input.notes ?? null,
        createdById: u.id,
      },
    });
    await this.audit.record('Livestock Cycle', c.id, 'CREATE', undefined, { number: c.number, species: c.species, qty: c.initialQty });
    return c;
  }

  /** places the animals: the DOC / fry / pullets leave stock into the cycle */
  async place(id: string) {
    RequestCtx.assert('farm.cycle.manage');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'PLANNED') throw new ConflictException('Only a planned cycle can be placed');
      await tx.livestockCycle.update({ where: { id: c.id }, data: { status: 'ACTIVE' } });
      if (c.stockProductId) await this.issueToCycle(tx, { ...c, status: 'ACTIVE' }, c.stockProductId, D(c.initialQty), c.placementDate, 'STOCK', 'LVP', c.id, `placement of ${c.initialQty}`);
    });
    await this.audit.record('Livestock Cycle', id, 'PLACE');
    return this.get(id);
  }

  async cancel(id: string) {
    RequestCtx.assert('farm.cycle.manage');
    const c = await this.own(id);
    if (c.status !== 'PLANNED') throw new ConflictException('Only a planned cycle can be cancelled');
    await this.prisma.livestockCycle.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Livestock Cycle', id, 'CANCEL');
    return { ok: true };
  }

  // ---------------------------------------------------------------- daily records
  async addDaily(id: string, input: z.infer<typeof dailySchema>) {
    RequestCtx.assert('farm.record');
    const rec = await this.prisma.$transaction(async (tx) => {
      let c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      this.assertDate(c, input.date);
      if (await tx.livestockDaily.findUnique({ where: { cycleId_date: { cycleId: c.id, date: input.date } } })) throw new ConflictException('This day is already recorded; delete it first to correct it');
      const last = await tx.livestockDaily.findFirst({ where: { cycleId: c.id }, orderBy: { date: 'desc' } });
      if (last && last.date > input.date) throw new ConflictException(`Days are recorded in order: the last one is ${localIso(last.date)}`);
      const alive = this.alive(c);
      if (input.mortality + input.culled > alive) throw new BadRequestException({ message: 'Validation failed', errors: { mortality: `Only ${alive} alive` } });
      if (input.feedKg > 0 && !input.feedProductId) throw new BadRequestException({ message: 'Validation failed', errors: { feedProductId: 'Which feed' } });
      const eggs = input.eggsGood + input.eggsCracked;
      if (eggs > 0 && !LAYING_SPECIES.includes(c.species)) throw new BadRequestException({ message: 'Validation failed', errors: { eggsGood: 'This species does not lay eggs' } });
      const r = await tx.livestockDaily.create({
        data: {
          cycleId: c.id,
          date: input.date,
          mortality: input.mortality,
          culled: input.culled,
          abnormal: input.abnormal,
          feedProductId: input.feedKg > 0 ? input.feedProductId ?? null : null,
          feedKg: D(input.feedKg),
          waterL: input.waterL === null || input.waterL === undefined ? null : D(input.waterL),
          avgWeightG: input.avgWeightG === null || input.avgWeightG === undefined ? null : D(input.avgWeightG),
          sampleSize: input.sampleSize ?? null,
          eggsGood: input.eggsGood,
          eggsCracked: input.eggsCracked,
          eggsKg: D(input.eggsKg),
          tempMin: input.tempMin ?? null,
          tempMax: input.tempMax ?? null,
          humidity: input.humidity ?? null,
          waterQuality: input.waterQuality ? (input.waterQuality as Prisma.InputJsonValue) : Prisma.JsonNull,
          notes: input.notes ?? null,
          poolBefore: c.layingPool,
          amortisedToBefore: c.amortisedTo,
          createdById: RequestCtx.user().id,
        },
      });
      // 1. abnormal depletion: its share of the cost is a loss
      let lossValue = ZERO;
      if (input.abnormal && input.mortality + input.culled > 0) {
        lossValue = round(this.carrying(c).times(input.mortality + input.culled).div(alive));
        if (lossValue.gt(0)) {
          await this.journal.post(tx, { companyId: c.companyId, branchId: c.branchId, date: input.date, description: `${c.number}: abnormal mortality ${input.mortality + input.culled}`, reference: c.number, sourceType: 'LVD', sourceId: r.id, lines: [{ key: 'ABNORMAL_LOSS', debit: lossValue }, { key: 'BIO_ASSET', credit: lossValue }] });
          await tx.livestockCost.create({ data: { cycleId: c.id, date: input.date, kind: 'LOSS', description: `Abnormal mortality ${input.mortality + input.culled}`, amount: lossValue.neg(), sourceType: 'LVD', sourceId: r.id } });
        }
      }
      await tx.livestockCycle.update({ where: { id: c.id }, data: { mortality: { increment: input.mortality }, culled: { increment: input.culled }, costOut: { increment: lossValue }, abnormalLoss: { increment: lossValue } } });
      c = await this.own(c.id, tx);
      // 2. feed from stock
      let feedCost = ZERO;
      if (input.feedKg > 0 && input.feedProductId) {
        feedCost = (await this.issueToCycle(tx, c, input.feedProductId, D(input.feedKg), input.date, 'FEED', 'LVD', r.id, `feed ${input.feedKg} kg`)).value;
        await tx.livestockCycle.update({ where: { id: c.id }, data: { feedKg: { increment: D(input.feedKg) } } });
        c = await this.own(c.id, tx);
      }
      // 3. eggs into stock: laying-phase costs since the last collection + write-off of the rearing cost
      let eggCost = ZERO;
      let amort = ZERO;
      if (eggs > 0) {
        if (!c.eggProductId) throw new BadRequestException({ message: 'Validation failed', errors: { eggsGood: 'Set the egg product of the cycle first' } });
        const qty = c.eggUnit === 'KG' ? D(input.eggsKg) : D(eggs);
        if (qty.lte(0)) throw new BadRequestException({ message: 'Validation failed', errors: { eggsKg: 'Weight of the eggs (kg)' } });
        if (c.phase === 'LAYING' && c.expectedLayWeeks > 0 && c.amortisedTo && D(c.rearingCost).gt(c.rearingAmortised)) {
          const days = Math.max(0, Math.round((input.date.getTime() - c.amortisedTo.getTime()) / DAY));
          amort = D(c.rearingCost).times(days).div(c.expectedLayWeeks * 7);
          const left = D(c.rearingCost).minus(c.rearingAmortised);
          if (amort.gt(left)) amort = left;
          amort = round(amort);
        }
        eggCost = D(c.layingPool).plus(amort);
        const carrying = this.carrying(c);
        if (eggCost.gt(carrying)) eggCost = carrying.gt(0) ? carrying : ZERO;
        eggCost = round(eggCost);
        const p = await tx.product.findUniqueOrThrow({ where: { id: c.eggProductId } });
        await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: c.warehouseId, date: input.date, qty, unitCost: eggCost.gt(0) ? eggCost.div(qty) : D(0.0001), docType: 'LVD', documentId: r.id, documentNumber: c.number, allowNegative: true });
        await this.receiveLot(tx, c, p, qty, r.id, `${c.number}-${localIso(input.date)}`, input.date);
        if (eggCost.gt(0)) {
          await this.journal.post(tx, { companyId: c.companyId, branchId: c.branchId, date: input.date, description: `${c.number}: eggs ${eggs}`, reference: c.number, sourceType: 'LVD', sourceId: r.id, lines: [{ key: 'INVENTORY', debit: eggCost }, { key: 'BIO_ASSET', credit: eggCost }] });
          await tx.livestockCost.create({ data: { cycleId: c.id, date: input.date, kind: 'EGGS', description: `Eggs ${eggs}${amort.gt(0) ? ` (incl. rearing cost ${amort.toFixed(0)})` : ''}`, amount: eggCost.neg(), sourceType: 'LVD', sourceId: r.id } });
        }
        await tx.livestockCycle.update({ where: { id: c.id }, data: { eggsGood: { increment: input.eggsGood }, eggsKg: { increment: D(input.eggsKg) }, costOut: { increment: eggCost }, layingPool: ZERO, rearingAmortised: { increment: amort }, ...(amort.gt(0) || c.phase === 'LAYING' ? { amortisedTo: input.date } : {}) } });
      }
      return tx.livestockDaily.update({ where: { id: r.id }, data: { feedCost, lossValue, eggCost, amortisation: amort } });
    });
    return rec;
  }

  /** deletes the last day recorded, putting back stock and costs */
  async deleteDaily(id: string, recordId: string) {
    RequestCtx.assert('farm.record');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      const r = await tx.livestockDaily.findFirst({ where: { id: recordId, cycleId: c.id } });
      if (!r) throw new NotFoundException('Record not found');
      const last = await tx.livestockDaily.findFirst({ where: { cycleId: c.id }, orderBy: { date: 'desc' } });
      if (last?.id !== r.id) throw new ConflictException('Only the last day can be deleted');
      if (await tx.livestockHarvest.count({ where: { cycleId: c.id, status: 'POSTED', date: { gte: r.date } } })) throw new ConflictException('A harvest was recorded after this day');
      const allowNegative = await this.allowNegative(c.companyId);
      if (n(r.feedKg) > 0 && r.feedProductId) {
        const p = await tx.product.findUniqueOrThrow({ where: { id: r.feedProductId } });
        await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: c.warehouseId, date: r.date, qty: D(r.feedKg), unitCost: D(r.feedCost).div(r.feedKg), docType: 'LVD', documentId: r.id, documentNumber: c.number, allowNegative });
      }
      const eggs = r.eggsGood + r.eggsCracked;
      if (eggs > 0 && c.eggProductId) {
        const qty = c.eggUnit === 'KG' ? D(r.eggsKg) : D(eggs);
        const p = await tx.product.findUniqueOrThrow({ where: { id: c.eggProductId } });
        if (qty.gt(0)) await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: c.warehouseId, date: r.date, qty: qty.neg(), unitCost: D(r.eggCost).gt(0) ? D(r.eggCost).div(qty) : undefined, docType: 'LVD', documentId: r.id, documentNumber: c.number, allowNegative });
      }
      await this.lots.reverse(tx, r.id);
      await this.journal.voidBySource(tx, 'LVD', r.id);
      await tx.livestockCost.deleteMany({ where: { sourceType: 'LVD', sourceId: r.id } });
      await tx.livestockCycle.update({
        where: { id: c.id },
        data: {
          mortality: { decrement: r.mortality },
          culled: { decrement: r.culled },
          feedKg: { decrement: r.feedKg },
          eggsGood: { decrement: r.eggsGood },
          eggsKg: { decrement: r.eggsKg },
          costIn: { decrement: r.feedCost },
          costOut: { decrement: D(r.lossValue).plus(r.eggCost) },
          abnormalLoss: { decrement: r.lossValue },
          rearingAmortised: { decrement: r.amortisation },
          layingPool: r.poolBefore,
          amortisedTo: r.amortisedToBefore,
        },
      });
      await tx.livestockDaily.delete({ where: { id: r.id } });
    });
    await this.audit.record('Livestock Cycle', id, 'DELETE_DAY', undefined, { recordId });
    return { ok: true };
  }

  // ---------------------------------------------------------------- treatments
  async addTreatment(id: string, input: z.infer<typeof treatmentSchema>) {
    RequestCtx.assert('farm.record');
    const t = await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (!['PLANNED', 'ACTIVE'].includes(c.status)) throw new ConflictException('The cycle is closed');
      if (input.status === 'DONE') {
        if (c.status !== 'ACTIVE') throw new ConflictException('Place the cycle first');
        this.assertDate(c, input.date);
      }
      const row = await tx.livestockTreatment.create({
        data: { cycleId: c.id, kind: input.kind, status: input.status, date: input.date, productId: input.productId ?? null, description: input.description, qty: D(input.qty), method: input.method ?? null, withdrawalDays: input.withdrawalDays, vet: input.vet ?? null, notes: input.notes ?? null, createdById: RequestCtx.user().id },
      });
      return input.status === 'DONE' ? this.applyTreatment(tx, c, row.id) : row;
    });
    return t;
  }

  /** gives a treatment: its product leaves stock into the cycle; the withdrawal period starts */
  private async applyTreatment(tx: Tx, c: Cycle, treatmentId: string) {
    const t = await tx.livestockTreatment.findUniqueOrThrow({ where: { id: treatmentId } });
    let cost = ZERO;
    if (t.productId && D(t.qty).gt(0)) cost = (await this.issueToCycle(tx, c, t.productId, D(t.qty), t.date, 'TREATMENT', 'LVT', t.id, t.description)).value;
    const until = t.withdrawalDays > 0 ? new Date(t.date.getTime() + t.withdrawalDays * DAY) : null;
    if (until && (!c.withdrawalUntil || until > c.withdrawalUntil)) await tx.livestockCycle.update({ where: { id: c.id }, data: { withdrawalUntil: until } });
    return tx.livestockTreatment.update({ where: { id: t.id }, data: { status: 'DONE', cost, withdrawalUntil: until } });
  }

  async completeTreatment(id: string, treatmentId: string, input: { date: Date; qty?: number }) {
    RequestCtx.assert('farm.record');
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      const t = await tx.livestockTreatment.findFirst({ where: { id: treatmentId, cycleId: c.id, status: 'PLANNED' } });
      if (!t) throw new NotFoundException('Planned treatment not found');
      this.assertDate(c, input.date);
      await tx.livestockTreatment.update({ where: { id: t.id }, data: { date: input.date, ...(input.qty !== undefined ? { qty: D(input.qty) } : {}) } });
      return this.applyTreatment(tx, c, t.id);
    });
  }

  async cancelTreatment(id: string, treatmentId: string) {
    RequestCtx.assert('farm.record');
    const c = await this.own(id);
    const t = await this.prisma.livestockTreatment.findFirst({ where: { id: treatmentId, cycleId: c.id, status: 'PLANNED' } });
    if (!t) throw new ConflictException('Only a planned treatment can be cancelled');
    await this.prisma.livestockTreatment.update({ where: { id: t.id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- other costs and the laying phase
  async addCost(id: string, input: z.infer<typeof costSchema>) {
    RequestCtx.assert('farm.cycle.manage');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      this.assertDate(c, input.date);
      await this.charge(tx, c, round(D(input.amount)), input.date, input.kind, input.description, 'LVC', randomUUID(), input.kind === 'LABOUR' ? 'LABOUR_APPLIED' : 'OVERHEAD_APPLIED');
    });
    return this.get(id);
  }

  /** onset of lay: the cost so far (rearing) is written off into the eggs over the expected laying period */
  async startLaying(id: string, input: { date: Date; expectedLayWeeks: number }) {
    RequestCtx.assert('farm.cycle.manage');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE' || c.phase !== 'GROWING') throw new ConflictException('Only a growing active cycle can start laying');
      if (!LAYING_SPECIES.includes(c.species)) throw new ConflictException('This species does not lay eggs');
      this.assertDate(c, input.date);
      await tx.livestockCycle.update({ where: { id: c.id }, data: { phase: 'LAYING', layStartDate: input.date, expectedLayWeeks: input.expectedLayWeeks, rearingCost: this.carrying(c), rearingAmortised: ZERO, amortisedTo: input.date, layingPool: ZERO } });
    });
    await this.audit.record('Livestock Cycle', id, 'START_LAYING', undefined, input);
    return this.get(id);
  }

  // ---------------------------------------------------------------- harvest
  async harvest(id: string, input: z.infer<typeof harvestSchema>) {
    RequestCtx.assert('farm.harvest');
    const h = await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      this.assertDate(c, input.date);
      const alive = this.alive(c);
      const qty = input.final ? alive : input.qty;
      if (qty <= 0) throw new BadRequestException({ message: 'Validation failed', errors: { qty: 'How many heads' } });
      if (qty > alive) throw new BadRequestException({ message: 'Validation failed', errors: { qty: `Only ${alive} alive` } });
      if (c.withdrawalUntil && input.date < c.withdrawalUntil && !input.overrideReason) {
        const t = await tx.livestockTreatment.findFirst({ where: { cycleId: c.id, status: 'DONE', withdrawalUntil: c.withdrawalUntil } });
        throw new ConflictException(`Withdrawal period of ${t?.description ?? 'a medicine'} runs until ${localIso(c.withdrawalUntil)}: residues may remain in the meat / eggs. Give a reason to harvest anyway`);
      }
      const productId = input.kind === 'CULL' ? c.cullProductId ?? c.outputProductId : c.outputProductId;
      if (!productId) throw new BadRequestException({ message: 'Validation failed', errors: { kind: 'Set the harvested product of the cycle first' } });
      if (input.customerId && !(await tx.customer.count({ where: { id: input.customerId, companyId: c.companyId, deletedAt: null } }))) throw new BadRequestException({ message: 'Validation failed', errors: { customerId: 'Customer not found' } });
      const carrying = this.carrying(c);
      const share = qty === alive ? carrying : round(carrying.times(qty).div(alive));
      const value = input.fairValue !== null && input.fairValue !== undefined ? round(D(input.fairValue)) : share;
      const kg = D(input.weightKg);
      const ageDays = c.initialAgeDays + Math.round((input.date.getTime() - c.placementDate.getTime()) / DAY);
      const number = await this.sequence.next('FARM_HARVEST', c.companyId, input.date, tx);
      const row = await tx.livestockHarvest.create({
        data: { companyId: c.companyId, cycleId: c.id, number, date: input.date, kind: input.kind, qty, weightKg: kg, ageDays, productId, warehouseId: c.warehouseId, customerId: input.customerId ?? null, pricePerKg: input.pricePerKg === null || input.pricePerKg === undefined ? null : D(input.pricePerKg), fairValue: input.fairValue === null || input.fairValue === undefined ? null : D(input.fairValue), cost: share, deliveryNo: input.deliveryNo ?? null, vehicleNo: input.vehicleNo ?? null, overrideReason: input.overrideReason ?? null, notes: input.notes ?? null, createdById: RequestCtx.user().id },
      });
      const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: c.warehouseId, date: input.date, qty: kg, unitCost: value.gt(0) ? value.div(kg) : D(0.0001), docType: 'LVH', documentId: row.id, documentNumber: number, allowNegative: true });
      await this.receiveLot(tx, c, p, kg, row.id, number, input.date);
      const diff = value.minus(share);
      const lines = [{ key: 'INVENTORY', debit: value }, { key: 'BIO_ASSET', credit: share }, ...(diff.gt(0) ? [{ key: 'BIO_FV_GAIN', credit: diff }] : diff.lt(0) ? [{ key: 'BIO_FV_GAIN', debit: diff.abs() }] : [])];
      if (value.gt(0) || share.gt(0)) await this.journal.post(tx, { companyId: c.companyId, branchId: c.branchId, date: input.date, description: `${c.number}: ${input.kind === 'CULL' ? 'culled layers' : 'harvest'} ${qty} heads ${kg.toString()} kg`, reference: number, sourceType: 'LVH', sourceId: row.id, lines });
      await tx.livestockCost.create({ data: { cycleId: c.id, date: input.date, kind: 'HARVEST', description: `${number}: ${qty} heads, ${kg.toString()} kg`, amount: share.neg(), sourceType: 'LVH', sourceId: row.id } });
      await tx.livestockCycle.update({ where: { id: c.id }, data: { harvestedQty: { increment: qty }, harvestedKg: { increment: kg }, costOut: { increment: share } } });
      return row;
    });
    // draft delivery order to the buyer
    if (h.customerId) {
      const c = await this.own(id);
      const doc = await this.documents.create(
        'DO',
        {
          date: h.date,
          customerId: h.customerId,
          warehouseId: h.warehouseId,
          reference: h.number,
          notes: `Harvest ${h.number} of ${c.number}: ${h.qty} heads${h.vehicleNo ? `, vehicle ${h.vehicleNo}` : ''}${h.pricePerKg ? `. Agreed price ${Number(h.pricePerKg)} per kg` : ''}. Live animals and fresh produce are exempt from PPN (PP 49/2022, faktur code 08).`,
          lines: [{ productId: h.productId, qty: Number(h.weightKg) }],
        },
        undefined,
        { skipPermission: true },
      );
      await this.prisma.livestockHarvest.update({ where: { id: h.id }, data: { deliveryDocId: (doc as { id: string }).id } });
    }
    await this.audit.record('Livestock Harvest', h.id, 'CREATE', undefined, { number: h.number, qty: h.qty, kg: Number(h.weightKg) });
    return this.prisma.livestockHarvest.findUniqueOrThrow({ where: { id: h.id } });
  }

  /** cancels the last harvest of an active cycle (its draft delivery is deleted) */
  async cancelHarvest(id: string, harvestId: string) {
    RequestCtx.assert('farm.harvest');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is closed');
      if (c.phase === 'LAYING') throw new ConflictException('Harvests of a laying flock cannot be cancelled: record a correction');
      const h = await tx.livestockHarvest.findFirst({ where: { id: harvestId, cycleId: c.id, status: 'POSTED' } });
      if (!h) throw new NotFoundException('Harvest not found');
      const last = await tx.livestockHarvest.findFirst({ where: { cycleId: c.id, status: 'POSTED' }, orderBy: { createdAt: 'desc' } });
      if (last?.id !== h.id) throw new ConflictException('Only the last harvest can be cancelled');
      if (await tx.livestockDaily.count({ where: { cycleId: c.id, date: { gt: h.date } } })) throw new ConflictException('Days were recorded after this harvest');
      if (h.deliveryDocId) {
        const d = await tx.tradeDocument.findUnique({ where: { id: h.deliveryDocId } });
        if (d && !d.deletedAt && d.status !== 'DRAFT') throw new ConflictException(`Delivery ${d.number} is already confirmed: cancel it first`);
        if (d && !d.deletedAt) await tx.tradeDocument.update({ where: { id: d.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
      }
      const value = h.fairValue !== null ? D(h.fairValue) : D(h.cost);
      const p = await tx.product.findUniqueOrThrow({ where: { id: h.productId } });
      await this.inventory.move(tx, { companyId: c.companyId, branchId: c.branchId, productId: p.id, productName: p.name, warehouseId: h.warehouseId, date: h.date, qty: D(h.weightKg).neg(), unitCost: value.gt(0) ? value.div(h.weightKg) : undefined, docType: 'LVH', documentId: h.id, documentNumber: h.number, allowNegative: await this.allowNegative(c.companyId) });
      await this.lots.reverse(tx, h.id);
      await this.journal.voidBySource(tx, 'LVH', h.id);
      await tx.livestockCost.deleteMany({ where: { sourceType: 'LVH', sourceId: h.id } });
      await tx.livestockCycle.update({ where: { id: c.id }, data: { harvestedQty: { decrement: h.qty }, harvestedKg: { decrement: h.weightKg }, costOut: { decrement: h.cost } } });
      await tx.livestockHarvest.update({ where: { id: h.id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Livestock Harvest', harvestId, 'CANCEL');
    return { ok: true };
  }

  /** closes a cycle with nothing alive; cost left over (all animals died) is written off */
  async close(id: string, input: { date: Date }) {
    RequestCtx.assert('farm.cycle.manage');
    await this.prisma.$transaction(async (tx) => {
      const c = await this.lock(tx, id);
      if (c.status !== 'ACTIVE') throw new ConflictException('The cycle is not active');
      const alive = this.alive(c);
      if (alive > 0) throw new ConflictException(`${alive} heads are still alive: harvest them or record them as dead / culled`);
      this.assertDate(c, input.date);
      const left = round(this.carrying(c));
      if (left.abs().gte(1)) {
        await this.journal.post(tx, { companyId: c.companyId, branchId: c.branchId, date: input.date, description: `${c.number}: cost left at closing`, reference: c.number, sourceType: 'LVC', sourceId: c.id, lines: left.gt(0) ? [{ key: 'ABNORMAL_LOSS', debit: left }, { key: 'BIO_ASSET', credit: left }] : [{ key: 'BIO_ASSET', debit: left.abs() }, { key: 'ABNORMAL_LOSS', credit: left.abs() }] });
        await tx.livestockCost.create({ data: { cycleId: c.id, date: input.date, kind: 'WRITE_OFF', description: 'Cost left at closing', amount: left.neg(), sourceType: 'LVC', sourceId: c.id } });
      }
      await tx.livestockCycle.update({ where: { id: c.id }, data: { status: 'CLOSED', closedAt: input.date, costOut: { increment: left }, abnormalLoss: { increment: left.gt(0) ? left : ZERO }, updatedById: RequestCtx.user().id } });
    });
    await this.audit.record('Livestock Cycle', id, 'CLOSE');
    return this.get(id);
  }
}
