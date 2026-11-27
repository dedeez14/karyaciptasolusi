import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { DocumentService } from '../documents/document.service';
import { LotService } from '../documents/lot.service';
import { allocate, gradingDeduction, parsePolygons, polygonStats, weigh, workOutput, workPay, type ActivityRule } from './plantation-calc';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const int0 = z.coerce.number().int().min(0).max(1_000_000).default(0);

export const CROPS = ['OIL_PALM', 'RUBBER', 'COCOA', 'COFFEE', 'COCONUT', 'TEA', 'SUGARCANE', 'OTHER'] as const;
/** cost account of a mature block by activity kind */
const KIND_KEY: Record<string, string> = { HARVEST: 'PLANT_HARVEST', TRANSPORT: 'PLANT_HARVEST', FERTILISING: 'PLANT_FERTILISER' };

export const blockSchema = z.object({
  siteId: z.uuid(),
  divisionId: z.uuid(),
  code: z.string().trim().min(1).max(30),
  name: optText(150),
  crop: z.enum(CROPS).default('OIL_PALM'),
  variety: optText(100),
  plantingYear: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1900).max(2100).nullable().optional()),
  plantingDate: z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()),
  areaHa: z.coerce.number().min(0).max(1_000_000),
  stands: int0,
  phase: z.enum(['TBM', 'TM', 'INACTIVE']).default('TBM'),
  bjrKg: z.coerce.number().min(0).max(200).default(0),
  landTitle: optText(100),
  geometry: z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? JSON.parse(v) : v), z.unknown().nullable().optional()),
  latitude: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(-90).max(90).nullable().optional()),
  longitude: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(-180).max(180).nullable().optional()),
  notes: optText(2000),
  isActive: z.boolean().default(true),
});
export const matureSchema = z.object({ date: z.coerce.date(), usefulLifeMonths: z.coerce.number().int().min(12).max(600).default(240), taxGroupCode: optText(20).default('K4') });

const workLine = z.object({
  employeeId: z.uuid(),
  blockId: z.uuid(),
  activityId: z.uuid(),
  hk: z.coerce.number().min(0).max(1).default(1),
  qty: z.coerce.number().min(0).max(1e9).default(0),
  tph: optText(20),
  bunches: int0,
  looseFruitKg: z.coerce.number().min(0).max(1e6).default(0),
  unripe: int0,
  longStalk: int0,
  looseLeft: int0,
  otherFaults: int0,
  notes: optText(300),
});
const materialLine = z.object({ blockId: z.uuid(), activityId: optUuid, productId: z.uuid(), qty: z.coerce.number().positive().max(1e9) });
export const workdaySchema = z.object({
  divisionId: z.uuid(),
  date: z.coerce.date(),
  foremanId: optUuid,
  warehouseId: optUuid,
  notes: optText(2000),
  works: z.array(workLine).max(500).default([]),
  materials: z.array(materialLine).max(200).default([]),
});

const dispatchLine = z.object({ blockId: z.uuid(), tph: optText(20), bunches: z.coerce.number().int().min(0).max(1_000_000), looseFruitKg: z.coerce.number().min(0).max(1e6).default(0) });
export const dispatchSchema = z.object({
  date: z.coerce.date(),
  siteId: z.uuid(),
  divisionId: optUuid,
  vehicleNo: optText(20),
  driver: optText(100),
  customerId: optUuid,
  productId: z.uuid(),
  warehouseId: z.uuid(),
  notes: optText(2000),
  lines: z.array(dispatchLine).min(1).max(200),
});
export const weighSchema = z.object({
  ticketNo: optText(40),
  weighedAt: z.coerce.date(),
  grossKg: z.coerce.number().positive().max(1e7),
  tareKg: z.coerce.number().min(0).max(1e7),
  sortingPct: z.coerce.number().min(0).max(100).default(0),
  sortingKg: optNum,
  grading: z
    .object({ unripe: optNum, overripe: optNum, empty: optNum, longStalk: optNum, looseFruit: optNum, dirty: optNum, under3kg: optNum })
    .partial()
    .nullable()
    .optional(),
  pricePerKg: z.coerce.number().min(0).max(1e7).default(0),
});

type Block = Prisma.PlantationBlockGetPayload<object>;
type Activity = Prisma.PlantationActivityGetPayload<object>;

const rule = (a: Activity): ActivityRule => ({
  kind: a.kind,
  uom: a.uom,
  wageBasis: a.wageBasis,
  dailyRate: n(a.dailyRate),
  pieceRate: n(a.pieceRate),
  baseTask: n(a.baseTask),
  premiumRate: n(a.premiumRate),
  penaltyUnripe: n(a.penaltyUnripe),
  penaltyLongStalk: n(a.penaltyLongStalk),
  penaltyLooseLeft: n(a.penaltyLooseLeft),
  penaltyOther: n(a.penaltyOther),
});

const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

/**
 * Plantations: blocks (immature TBM -> mature TM bearer plants), the foreman's daily work book (BKM / checkroll) costed
 * to the blocks and paid through payroll, FFB transport notes (SPB) and the mill weighbridge.
 *
 * Accounting (bearer plants as property, plant and equipment; produce at fair value less costs to sell at harvest):
 * - work and materials on an immature block are capitalised (Dr Bearer plants - immature) and kept per block;
 * - declaring a block mature moves that cost into a fixed asset (Bearer plants - mature) depreciated by Fixed Assets;
 * - work and materials on mature blocks are production costs (harvesting / upkeep / fertilising);
 * - wages are credited to Checkroll wages accrued, which the payroll clears when it pays them;
 * - fruit accepted at the weighbridge enters stock at the agreed price (Dr Inventory / Cr Produce at harvest) and a draft
 *   delivery is made for the mill.
 */
@Injectable()
export class PlantationService {
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

  private allowNegative(companyId: string) {
    return this.settings.bool('inventory.allowNegativeStock', companyId, false);
  }

  private async site(id: string) {
    const s = await this.prisma.farmSite.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!s) throw invalid({ siteId: 'Estate not found' });
    if (s.kind !== 'PLANTATION' && s.kind !== 'MIXED') throw invalid({ siteId: 'Choose an estate (a farm of kind Plantation)' });
    return s;
  }

  private async division(id: string, siteId?: string) {
    const d = await this.prisma.plantationDivision.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!d || (siteId && d.siteId !== siteId)) throw invalid({ divisionId: 'Division not found on this estate' });
    return d;
  }

  private async ownBlock(id: string, db: PrismaService | Tx = this.prisma): Promise<Block> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Block not found');
    const b = await db.plantationBlock.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!b) throw new NotFoundException('Block not found');
    return b;
  }

  private async uomCodes(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, string>();
    return new Map((await this.prisma.uom.findMany({ where: { id: { in: list } }, select: { id: true, code: true } })).map((x) => [x.id, x.code]));
  }

  private async names() {
    const companyId = RequestCtx.companyId();
    const [sites, divisions, activities] = await Promise.all([
      this.prisma.farmSite.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
      this.prisma.plantationDivision.findMany({ where: { companyId }, select: { id: true, code: true, name: true, siteId: true } }),
      this.prisma.plantationActivity.findMany({ where: { companyId } }),
    ]);
    return { sites: new Map(sites.map((s) => [s.id, s])), divisions: new Map(divisions.map((d) => [d.id, d])), activities: new Map(activities.map((a) => [a.id, a])) };
  }

  /** pick lists for the forms: divisions with their estate, active activities with their wage rules */
  async lists() {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const [divisions, activities, sites] = await Promise.all([
      this.prisma.plantationDivision.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.plantationActivity.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.farmSite.findMany({ where: { companyId, deletedAt: null, kind: { in: ['PLANTATION', 'MIXED'] } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    return {
      sites,
      divisions: divisions.map((d) => ({ id: d.id, code: d.code, name: d.name, siteId: d.siteId })),
      activities: activities.map((a) => ({ id: a.id, code: a.code, name: a.name, ...rule(a) })),
    };
  }

  // ================================================================ blocks
  async blocks(q: { siteId?: string; divisionId?: string; phase?: string }) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.plantationBlock.findMany({
      where: { companyId, deletedAt: null, ...(q.siteId ? { siteId: q.siteId } : {}), ...(q.divisionId ? { divisionId: q.divisionId } : {}), ...(q.phase ? { phase: q.phase } : {}) },
      orderBy: { code: 'asc' },
      take: 2000,
    });
    const nm = await this.names();
    const today = todayDate();
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const kpi = new Map((await this.productionRows(rows, yearStart, today)).map((r) => [r.id, r]));
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      crop: b.crop,
      variety: b.variety,
      plantingYear: b.plantingYear,
      ageYears: b.plantingYear ? today.getUTCFullYear() - b.plantingYear : null,
      areaHa: n(b.areaHa),
      stands: b.stands,
      sph: n(b.areaHa) > 0 ? Math.round(b.stands / n(b.areaHa)) : null,
      phase: b.phase,
      matureDate: b.matureDate,
      bjrKg: n(b.bjrKg),
      tbmCost: n(b.tbmCost),
      hasGeometry: !!b.geometry,
      eudrPolygonNeeded: n(b.areaHa) > 4 && !b.geometry,
      isActive: b.isActive,
      site: nm.sites.get(b.siteId) ?? null,
      division: nm.divisions.get(b.divisionId) ?? null,
      ytd: kpi.get(b.id) ?? null,
    }));
  }

  async block(id: string) {
    RequestCtx.assert('plantation.read');
    const b = await this.ownBlock(id);
    const nm = await this.names();
    const today = todayDate();
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const [ytd] = await this.productionRows([b], yearStart, today);
    const [works, materials, loads, asset] = await Promise.all([
      this.prisma.plantationWork.findMany({ where: { blockId: b.id, workday: { status: 'APPROVED' } }, orderBy: { date: 'desc' }, take: 200, include: { workday: { select: { number: true } } } }),
      this.prisma.plantationMaterial.findMany({ where: { blockId: b.id, workday: { status: 'APPROVED' } }, orderBy: { date: 'desc' }, take: 100, include: { workday: { select: { number: true } } } }),
      this.prisma.ffbDispatchLine.findMany({ where: { blockId: b.id, dispatch: { status: { not: 'CANCELLED' }, deletedAt: null } }, include: { dispatch: { select: { number: true, date: true, status: true } } }, orderBy: { dispatch: { date: 'desc' } }, take: 100 }),
      b.fixedAssetId ? this.prisma.fixedAsset.findUnique({ where: { id: b.fixedAssetId }, select: { id: true, code: true, cost: true, accumulatedDepreciation: true, usefulLifeMonths: true, statusCode: true } }) : null,
    ]);
    const employees = new Map(
      (await this.prisma.employee.findMany({ where: { id: { in: [...new Set(works.map((w) => w.employeeId))] } }, select: { id: true, code: true, fullName: true } })).map((e) => [e.id, e]),
    );
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...new Set(materials.map((m) => m.productId))] } }, select: { id: true, name: true, uomId: true } })).map((p) => [p.id, p]));
    const uoms = await this.uomCodes([...products.values()].map((p) => p.uomId));
    // monthly production of the last 12 months
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    const monthly = new Map<string, { kg: number; bunches: number }>();
    for (const l of loads) {
      if (l.dispatch.status !== 'WEIGHED' || l.dispatch.date < from) continue;
      const k = iso(l.dispatch.date).slice(0, 7);
      const m = monthly.get(k) ?? { kg: 0, bunches: 0 };
      m.kg += n(l.actualKg);
      m.bunches += l.bunches;
      monthly.set(k, m);
    }
    return {
      ...b,
      areaHa: n(b.areaHa),
      bjrKg: n(b.bjrKg),
      tbmCost: n(b.tbmCost),
      latitude: b.latitude === null ? null : n(b.latitude),
      longitude: b.longitude === null ? null : n(b.longitude),
      taxBasis: await this.taxBasis(b.id),
      ageMonths: b.plantingDate ? Math.floor((today.getTime() - b.plantingDate.getTime()) / (30.4375 * DAY)) : b.plantingYear ? (today.getUTCFullYear() - b.plantingYear) * 12 : null,
      eudrPolygonNeeded: n(b.areaHa) > 4 && !b.geometry,
      polygonHa: b.geometry ? polygonStats(parsePolygons(b.geometry)).areaHa : null,
      site: nm.sites.get(b.siteId) ?? null,
      division: nm.divisions.get(b.divisionId) ?? null,
      asset: asset ? { ...asset, cost: n(asset.cost), accumulatedDepreciation: n(asset.accumulatedDepreciation) } : null,
      ytd,
      monthly: [...monthly.entries()].sort().map(([month, v]) => ({ month, ...v, tonPerHa: n(b.areaHa) > 0 ? v.kg / 1000 / n(b.areaHa) : null })),
      works: works.map((w) => ({
        id: w.id,
        date: w.date,
        number: w.workday.number,
        employee: employees.get(w.employeeId) ?? null,
        activity: nm.activities.get(w.activityId)?.name ?? '',
        hk: n(w.hk),
        qty: n(w.qty),
        uom: nm.activities.get(w.activityId)?.uom ?? '',
        bunches: w.bunches,
        amount: n(w.amount),
        capitalised: w.capitalised,
      })),
      materials: materials.map((m) => ({ id: m.id, date: m.date, number: m.workday.number, product: products.get(m.productId)?.name ?? '', unit: uoms.get(products.get(m.productId)?.uomId ?? '') ?? '', qty: n(m.qty), amount: n(m.amount), capitalised: m.capitalised })),
      loads: loads.map((l) => ({ id: l.id, number: l.dispatch.number, date: l.dispatch.date, status: l.dispatch.status, tph: l.tph, bunches: l.bunches, estimatedKg: n(l.estimatedKg), actualKg: n(l.actualKg) })),
    };
  }

  /** fiscal cost of the bearer plants: capitalised materials only, labour is not capitalised for tax (PMK 72/2023 Ps 14(2)) */
  private async taxBasis(blockId: string) {
    const m = await this.prisma.plantationMaterial.aggregate({ where: { blockId, capitalised: true, workday: { status: 'APPROVED' } }, _sum: { amount: true } });
    const w = await this.prisma.plantationWork.aggregate({ where: { blockId, capitalised: true, workday: { status: 'APPROVED' } }, _sum: { amount: true } });
    return { materials: n(m._sum.amount), labour: n(w._sum.amount) };
  }

  async saveBlock(id: string | null, input: z.infer<typeof blockSchema>) {
    RequestCtx.assert('plantation.block.manage');
    const u = RequestCtx.user();
    await this.site(input.siteId);
    await this.division(input.divisionId, input.siteId);
    let geometry: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let lat = input.latitude ?? null;
    let lng = input.longitude ?? null;
    if (input.geometry) {
      if (JSON.stringify(input.geometry).length > 500_000) throw invalid({ geometry: 'The boundary is too detailed (max 500 kB): simplify it' });
      try {
        const polys = parsePolygons(input.geometry);
        const st = polygonStats(polys);
        if (lat === null || lng === null) [lat, lng] = [st.latitude, st.longitude];
        geometry = input.geometry as Prisma.InputJsonValue;
      } catch (e) {
        throw invalid({ geometry: (e as Error).message });
      }
    }
    const dup = await this.prisma.plantationBlock.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code is already used' });
    const before = id ? await this.ownBlock(id) : null;
    if (before) {
      // a block becomes mature only through "Declare mature" once it carries capitalised cost
      if (before.phase !== input.phase && (before.phase === 'TM' || input.phase === 'TM') && (n(before.tbmCost) > 0 || before.fixedAssetId))
        throw invalid({ phase: before.fixedAssetId ? 'Use "Undo mature" to bring the block back to immature' : 'Use "Declare mature" to move the immature cost into bearer plants' });
    }
    const data = {
      siteId: input.siteId,
      divisionId: input.divisionId,
      code: input.code,
      name: input.name ?? null,
      crop: input.crop,
      variety: input.variety ?? null,
      plantingYear: input.plantingYear ?? (input.plantingDate ? input.plantingDate.getUTCFullYear() : null),
      plantingDate: input.plantingDate ?? null,
      areaHa: D(input.areaHa),
      stands: input.stands,
      phase: input.phase,
      bjrKg: D(input.bjrKg),
      landTitle: input.landTitle ?? null,
      geometry,
      latitude: lat === null ? null : D(lat),
      longitude: lng === null ? null : D(lng),
      notes: input.notes ?? null,
      isActive: input.isActive,
      updatedById: u.id,
    };
    const b = before
      ? await this.prisma.plantationBlock.update({ where: { id: before.id }, data })
      : await this.prisma.plantationBlock.create({ data: { ...data, companyId: u.companyId, branchId: u.branchId ?? null, createdById: u.id } });
    await this.audit.record('Plantation Block', b.id, before ? 'UPDATE' : 'CREATE', before ?? undefined, { ...b, geometry: b.geometry ? '(polygon)' : null });
    return this.block(b.id);
  }

  async deleteBlock(id: string) {
    RequestCtx.assert('plantation.block.manage');
    const b = await this.ownBlock(id);
    const used =
      (await this.prisma.plantationWork.count({ where: { blockId: b.id, workday: { status: { not: 'CANCELLED' }, deletedAt: null } } })) +
      (await this.prisma.ffbDispatchLine.count({ where: { blockId: b.id, dispatch: { status: { not: 'CANCELLED' }, deletedAt: null } } }));
    if (used || b.fixedAssetId || n(b.tbmCost) !== 0) throw new ConflictException('The block has work, fruit or cost recorded: set it inactive instead');
    await this.prisma.plantationBlock.update({ where: { id: b.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('Plantation Block', b.id, 'DELETE', b);
    return { ok: true };
  }

  /**
   * Declares an immature block mature (TBM -> TM): its capitalised cost becomes a fixed asset (bearer plants) that
   * Fixed Assets depreciates from the date; later work on the block is a production cost.
   */
  async declareMature(id: string, input: z.infer<typeof matureSchema>) {
    RequestCtx.assert('plantation.block.manage');
    RequestCtx.assert('accounting.asset.create');
    const u = RequestCtx.user();
    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM plantation_blocks WHERE id = ${id}::uuid FOR UPDATE`;
      const b = await this.ownBlock(id, tx);
      if (b.phase !== 'TBM') throw new ConflictException('Only an immature (TBM) block can be declared mature');
      if (input.date > todayDate()) throw invalid({ date: 'The date cannot be in the future' });
      if (b.plantingDate && input.date < b.plantingDate) throw invalid({ date: 'Before the planting date' });
      const later = await tx.plantationWork.count({ where: { blockId: b.id, capitalised: true, date: { gt: input.date }, workday: { status: 'APPROVED' } } });
      const laterM = await tx.plantationMaterial.count({ where: { blockId: b.id, capitalised: true, date: { gt: input.date }, workday: { status: 'APPROVED' } } });
      if (later + laterM) throw invalid({ date: 'Work after this date was capitalised to the block: choose a later date' });
      const cost = D(b.tbmCost);
      let assetId: string | null = null;
      if (cost.gt(0)) {
        const assetAcc = await this.journal.mapping(tx, u.companyId, 'BEARER_TM');
        const depAcc = await this.journal.mapping(tx, u.companyId, 'PLANT_DEPRECIATION').catch(() => null);
        const accum = await this.journal.mapping(tx, u.companyId, 'ACCUM_DEPRECIATION');
        const code = await this.sequence.next('ASSET', u.companyId, input.date, tx);
        const asset = await tx.fixedAsset.create({
          data: {
            companyId: u.companyId,
            branchId: b.branchId,
            code,
            name: `Bearer plants - block ${b.code}${b.plantingYear ? ` (planted ${b.plantingYear})` : ''}`.slice(0, 200),
            categoryCode: null,
            taxGroupCode: input.taxGroupCode ?? null,
            location: b.code,
            acquisitionDate: input.date,
            depreciationStartDate: input.date,
            cost,
            salvageValue: D(0),
            usefulLifeMonths: input.usefulLifeMonths,
            methodCode: 'STRAIGHT_LINE',
            assetAccountId: assetAcc,
            accumDepAccountId: accum,
            depExpenseAccountId: depAcc,
            notes: `Plantation block ${b.code}: ${n(b.areaHa)} ha, ${b.stands} palms. Immature cost capitalised until ${iso(input.date)}. Tax (PMK 72/2023): group 4, 20 years straight line from the first month of sales; labour is not part of the fiscal cost (fiscal cost of materials: ${(await this.taxBasis(b.id)).materials.toLocaleString('en-US')}).`,
            createdById: u.id,
          },
        });
        assetId = asset.id;
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: b.branchId,
          date: input.date,
          description: `Block ${b.code} declared mature: immature cost to bearer plants`,
          reference: code,
          sourceType: 'BLOCK_TM',
          sourceId: b.id,
          lines: [
            { accountId: assetAcc, debit: cost, description: `Bearer plants ${b.code}` },
            { key: 'BEARER_TBM', credit: cost, description: `Bearer plants ${b.code}` },
          ],
        });
      }
      return tx.plantationBlock.update({ where: { id: b.id }, data: { phase: 'TM', matureDate: input.date, fixedAssetId: assetId, updatedById: u.id } });
    });
    await this.audit.record('Plantation Block', id, 'MATURE', undefined, { date: iso(input.date), assetId: res.fixedAssetId });
    return this.block(id);
  }

  /** undoes "Declare mature" while the fixed asset has not been depreciated yet */
  async undoMature(id: string) {
    RequestCtx.assert('plantation.block.manage');
    RequestCtx.assert('accounting.asset.create');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM plantation_blocks WHERE id = ${id}::uuid FOR UPDATE`;
      const b = await this.ownBlock(id, tx);
      if (b.phase !== 'TM' || !b.matureDate) throw new ConflictException('The block was not declared mature in the system');
      if (b.fixedAssetId) {
        if (await tx.assetDepreciation.count({ where: { assetId: b.fixedAssetId } })) throw new ConflictException('The bearer plants were already depreciated: reverse the depreciation first');
        await tx.fixedAsset.update({ where: { id: b.fixedAssetId }, data: { deletedAt: new Date(), statusCode: 'DISPOSED', notes: 'Cancelled: block brought back to immature' } });
        await this.journal.voidBySource(tx, 'BLOCK_TM', b.id);
      }
      const costAfter = await tx.plantationWork.count({ where: { blockId: b.id, date: { gte: b.matureDate }, workday: { status: 'APPROVED' } } });
      if (costAfter) throw new ConflictException('Work was booked on the block as mature after that date: cancel those BKMs first');
      await tx.plantationBlock.update({ where: { id: b.id }, data: { phase: 'TBM', matureDate: null, fixedAssetId: null, updatedById: RequestCtx.user().id } });
    });
    await this.audit.record('Plantation Block', id, 'UNDO_MATURE');
    return this.block(id);
  }

  /** plot boundaries as a GeoJSON FeatureCollection (traceability: EUDR due diligence, ISPO, GIS) */
  async geojson(siteId?: string) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.plantationBlock.findMany({ where: { companyId, deletedAt: null, ...(siteId ? { siteId } : {}) }, orderBy: { code: 'asc' } });
    const nm = await this.names();
    return {
      type: 'FeatureCollection',
      features: rows
        .filter((b) => b.geometry || (b.latitude !== null && b.longitude !== null))
        .map((b) => {
          const g = b.geometry as { type?: string; geometry?: unknown } | null;
          const geometry = g ? (g.type === 'Feature' ? g.geometry : g.type === 'FeatureCollection' ? (g as unknown as { features: { geometry: unknown }[] }).features[0].geometry : g) : { type: 'Point', coordinates: [n(b.longitude), n(b.latitude)] };
          return {
            type: 'Feature',
            geometry,
            properties: {
              block: b.code,
              name: b.name,
              estate: nm.sites.get(b.siteId)?.name ?? null,
              division: nm.divisions.get(b.divisionId)?.name ?? null,
              crop: b.crop,
              plantingYear: b.plantingYear,
              areaHa: n(b.areaHa),
              landTitle: b.landTitle,
              phase: b.phase,
            },
          };
        }),
    };
  }

  // ================================================================ daily work book (BKM / checkroll)
  async workdays(q: { from?: string; to?: string; divisionId?: string; status?: string }) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.plantationWorkday.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.divisionId ? { divisionId: q.divisionId } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 500,
      include: { _count: { select: { works: true } } },
    });
    const nm = await this.names();
    const foremen = new Map((await this.prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.foremanId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      division: nm.divisions.get(r.divisionId) ?? null,
      site: nm.sites.get(r.siteId) ?? null,
      foreman: r.foremanId ? foremen.get(r.foremanId) ?? null : null,
      workers: r._count.works,
      totalHk: n(r.totalHk),
      totalWage: n(r.totalWage),
      totalMaterial: n(r.totalMaterial),
    }));
  }

  async workday(id: string) {
    RequestCtx.assert('plantation.read');
    if (!UUID.test(id ?? '')) throw new NotFoundException('BKM not found');
    const w = await this.prisma.plantationWorkday.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { works: { orderBy: { lineNo: 'asc' } }, materials: { orderBy: { lineNo: 'asc' } } } });
    if (!w) throw new NotFoundException('BKM not found');
    const nm = await this.names();
    const blocks = new Map((await this.prisma.plantationBlock.findMany({ where: { id: { in: [...w.works.map((x) => x.blockId), ...w.materials.map((x) => x.blockId)] } }, select: { id: true, code: true, phase: true } })).map((b) => [b.id, b]));
    const emps = new Map((await this.prisma.employee.findMany({ where: { id: { in: [...w.works.map((x) => x.employeeId), ...(w.foremanId ? [w.foremanId] : [])] } }, select: { id: true, code: true, fullName: true } })).map((e) => [e.id, e]));
    const prods = new Map((await this.prisma.product.findMany({ where: { id: { in: w.materials.map((m) => m.productId) } }, select: { id: true, code: true, name: true, uomId: true } })).map((p) => [p.id, p]));
    const uoms = await this.uomCodes([...prods.values()].map((p) => p.uomId));
    const paid = [...new Set(w.works.map((x) => x.payrollRunId).filter((x): x is string => !!x))];
    const runs = new Map((await this.prisma.payrollRun.findMany({ where: { id: { in: paid } }, select: { id: true, number: true } })).map((r) => [r.id, r.number]));
    return {
      ...w,
      totalHk: n(w.totalHk),
      totalWage: n(w.totalWage),
      totalMaterial: n(w.totalMaterial),
      division: nm.divisions.get(w.divisionId) ?? null,
      site: nm.sites.get(w.siteId) ?? null,
      foreman: w.foremanId ? emps.get(w.foremanId) ?? null : null,
      works: w.works.map((x) => {
        const a = nm.activities.get(x.activityId);
        return {
          ...x,
          hk: n(x.hk),
          qty: n(x.qty),
          looseFruitKg: n(x.looseFruitKg),
          wage: n(x.wage),
          premium: n(x.premium),
          penalty: n(x.penalty),
          amount: n(x.amount),
          employee: emps.get(x.employeeId) ?? null,
          block: blocks.get(x.blockId) ?? null,
          activity: a ? { id: a.id, code: a.code, name: a.name, kind: a.kind, uom: a.uom } : null,
          payrollRun: x.payrollRunId ? runs.get(x.payrollRunId) ?? null : null,
        };
      }),
      materials: w.materials.map((m) => ({ ...m, qty: n(m.qty), amount: n(m.amount), block: blocks.get(m.blockId) ?? null, product: prods.get(m.productId) ? { ...prods.get(m.productId)!, unit: uoms.get(prods.get(m.productId)!.uomId ?? '') ?? '' } : null, activity: m.activityId ? nm.activities.get(m.activityId)?.name ?? null : null })),
    };
  }

  /** prices the lines of a BKM (also used by the editor before saving) */
  async priceWorks(input: z.infer<typeof workdaySchema>, excludeWorkdayId?: string) {
    const companyId = RequestCtx.companyId();
    const div = await this.division(input.divisionId);
    const blockIds = [...new Set([...input.works.map((w) => w.blockId), ...input.materials.map((m) => m.blockId)])];
    const blocks = new Map((await this.prisma.plantationBlock.findMany({ where: { companyId, deletedAt: null, id: { in: blockIds } } })).map((b) => [b.id, b]));
    const activities = new Map(
      (await this.prisma.plantationActivity.findMany({ where: { companyId, deletedAt: null, id: { in: [...input.works.map((w) => w.activityId), ...input.materials.map((m) => m.activityId).filter((x): x is string => !!x)] } } })).map((a) => [a.id, a]),
    );
    const employees = new Map((await this.prisma.employee.findMany({ where: { companyId, deletedAt: null, id: { in: input.works.map((w) => w.employeeId) } }, select: { id: true, fullName: true, isActive: true, endDate: true } })).map((e) => [e.id, e]));
    const errors: Record<string, string> = {};
    const warnings: string[] = [];
    // HK already booked on the same day in other books
    const other = await this.prisma.plantationWork.groupBy({
      by: ['employeeId'],
      where: { companyId, date: input.date, employeeId: { in: [...employees.keys()] }, workday: { status: { not: 'CANCELLED' }, deletedAt: null, ...(excludeWorkdayId ? { id: { not: excludeWorkdayId } } : {}) } },
      _sum: { hk: true },
    });
    const hkDay = new Map(other.map((o) => [o.employeeId, n(o._sum.hk)]));
    const minimumWage = await this.settings.num('payroll.minimumWage', companyId, 0);
    const daysPerMonth = await this.settings.num('plantation.workDaysPerMonth', companyId, 25);
    const minDaily = minimumWage > 0 ? minimumWage / daysPerMonth : 0;
    const works = input.works.map((w, i) => {
      const b = blocks.get(w.blockId);
      const a = activities.get(w.activityId);
      const e = employees.get(w.employeeId);
      if (!b || b.divisionId !== div.id) errors[`works.${i}.blockId`] = 'Block not found in this division';
      if (!a || !a.isActive) errors[`works.${i}.activityId`] = 'Activity not found';
      if (!e || !e.isActive || (e.endDate && e.endDate < input.date)) errors[`works.${i}.employeeId`] = 'Employee not found or no longer employed';
      if (!b || !a || !e) return null;
      if (a.kind === 'HARVEST' && b.phase !== 'TM') errors[`works.${i}.blockId`] = `Block ${b.code} is not mature`;
      const hk = (hkDay.get(w.employeeId) ?? 0) + w.hk;
      hkDay.set(w.employeeId, hk);
      if (hk > 1.0001) errors[`works.${i}.hk`] = `${e.fullName} would have ${hk} HK on this day (max 1; book overtime separately)`;
      const output = workOutput(a, w, n(b.bjrKg));
      const pay = workPay(rule(a), w, output);
      if (pay.penaltyCapped) warnings.push(`${e.fullName}: the penalties exceed the pay of the line and were capped`);
      if (minDaily > 0 && w.hk > 0 && pay.amount / w.hk < minDaily && a.wageBasis === 'DAILY') warnings.push(`${e.fullName}: ${Math.round(pay.amount / w.hk).toLocaleString('id-ID')} per HK is below the minimum daily wage ${Math.round(minDaily).toLocaleString('id-ID')} (minimum wage / ${daysPerMonth})`);
      return { ...w, qty: output, ...pay, capitalised: b.phase === 'TBM' };
    });
    input.materials.forEach((m, i) => {
      const b = blocks.get(m.blockId);
      if (!b || b.divisionId !== div.id) errors[`materials.${i}.blockId`] = 'Block not found in this division';
    });
    if (input.materials.length && !input.warehouseId) errors.warehouseId = 'Choose the store the materials come from';
    if (Object.keys(errors).length) throw invalid(errors);
    return { division: div, works: works as NonNullable<(typeof works)[number]>[], warnings, blocks };
  }

  async previewWorkday(input: z.infer<typeof workdaySchema>, id?: string) {
    RequestCtx.assert('plantation.bkm.record');
    const p = await this.priceWorks(input, id);
    return { works: p.works.map((w) => ({ qty: w.qty, wage: w.wage, premium: w.premium, penalty: w.penalty, amount: w.amount })), warnings: p.warnings };
  }

  async saveWorkday(id: string | null, input: z.infer<typeof workdaySchema>) {
    RequestCtx.assert('plantation.bkm.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'The date cannot be in the future' });
    if (!input.works.length && !input.materials.length) throw invalid({ works: 'Add the work of the day' });
    if (input.foremanId && !(await this.prisma.employee.findFirst({ where: { id: input.foremanId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ foremanId: 'Employee not found' });
    if (input.warehouseId && !(await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ warehouseId: 'Warehouse not found' });
    if (input.materials.length) {
      const prods = await this.prisma.product.findMany({ where: { companyId: u.companyId, deletedAt: null, id: { in: input.materials.map((m) => m.productId) } } });
      input.materials.forEach((m, i) => {
        const p = prods.find((x) => x.id === m.productId);
        if (!p || p.type !== 'STOCK') throw invalid({ [`materials.${i}.productId`]: 'Choose a stock product' });
      });
    }
    const p = await this.priceWorks(input, id ?? undefined);
    const wd = await this.prisma.$transaction(async (tx) => {
      let row;
      const head = {
        siteId: p.division.siteId,
        divisionId: p.division.id,
        date: input.date,
        foremanId: input.foremanId ?? null,
        warehouseId: input.warehouseId ?? null,
        notes: input.notes ?? null,
        totalHk: D(p.works.reduce((a, w) => a + w.hk, 0)),
        totalWage: D(p.works.reduce((a, w) => a + w.amount, 0)),
        totalMaterial: D(0),
        updatedById: u.id,
      };
      if (id) {
        await tx.$queryRaw`SELECT id FROM plantation_workdays WHERE id = ${id}::uuid FOR UPDATE`;
        const before = await tx.plantationWorkday.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
        if (!before) throw new NotFoundException('BKM not found');
        if (before.status !== 'DRAFT') throw new ConflictException('Only a draft BKM can be changed');
        await tx.plantationWork.deleteMany({ where: { workdayId: id } });
        await tx.plantationMaterial.deleteMany({ where: { workdayId: id } });
        row = await tx.plantationWorkday.update({ where: { id }, data: head });
      } else {
        row = await tx.plantationWorkday.create({ data: { ...head, companyId: u.companyId, branchId: u.branchId ?? null, number: await this.sequence.next('PLANT_BKM', u.companyId, input.date, tx), createdById: u.id } });
      }
      if (p.works.length)
        await tx.plantationWork.createMany({
          data: p.works.map((w, i) => ({
            lineNo: i + 1,
            workdayId: row.id,
            companyId: u.companyId,
            date: input.date,
            employeeId: w.employeeId,
            blockId: w.blockId,
            activityId: w.activityId,
            hk: D(w.hk),
            qty: D(w.qty),
            tph: w.tph ?? null,
            bunches: w.bunches,
            looseFruitKg: D(w.looseFruitKg),
            unripe: w.unripe,
            longStalk: w.longStalk,
            looseLeft: w.looseLeft,
            otherFaults: w.otherFaults,
            wage: D(w.wage),
            premium: D(w.premium),
            penalty: D(w.penalty),
            amount: D(w.amount),
            capitalised: w.capitalised,
            notes: w.notes ?? null,
          })),
        });
      if (input.materials.length)
        await tx.plantationMaterial.createMany({ data: input.materials.map((m, i) => ({ lineNo: i + 1, workdayId: row.id, companyId: u.companyId, date: input.date, blockId: m.blockId, activityId: m.activityId ?? null, productId: m.productId, qty: D(m.qty), capitalised: p.blocks.get(m.blockId)?.phase === 'TBM' })) });
      return row;
    });
    await this.audit.record('BKM', wd.id, id ? 'UPDATE' : 'CREATE', undefined, { number: wd.number, works: p.works.length, materials: input.materials.length });
    return { ...(await this.workday(wd.id)), warnings: p.warnings };
  }

  /**
   * Approves a BKM: work is costed to the blocks (immature: capitalised; mature: production cost by activity),
   * wages are accrued for the payroll, materials are issued from the store.
   */
  async approveWorkday(id: string) {
    RequestCtx.assert('plantation.bkm.approve');
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM plantation_workdays WHERE id = ${id}::uuid FOR UPDATE`;
      const w = await tx.plantationWorkday.findFirst({ where: { id, companyId: u.companyId, deletedAt: null }, include: { works: true, materials: true } });
      if (!w) throw new NotFoundException('BKM not found');
      if (w.status !== 'DRAFT') throw new ConflictException('The BKM is not a draft');
      if (!w.works.length && !w.materials.length) throw new ConflictException('The BKM is empty');
      const blocks = new Map((await tx.plantationBlock.findMany({ where: { id: { in: [...w.works.map((x) => x.blockId), ...w.materials.map((x) => x.blockId)] } } })).map((b) => [b.id, b]));
      const activities = new Map((await tx.plantationActivity.findMany({ where: { companyId: u.companyId } })).map((a) => [a.id, a]));
      // the phase of the block on the day decides capitalisation (it may have changed since the draft)
      const debit = new Map<string, { accountId?: string; key?: string; amount: Prisma.Decimal; description: string }>();
      const tbm = new Map<string, Prisma.Decimal>();
      const charge = (blockId: string, activityId: string | null, amount: Prisma.Decimal, what: string) => {
        const b = blocks.get(blockId)!;
        const a = activityId ? activities.get(activityId) : undefined;
        if (b.phase === 'TBM') {
          tbm.set(b.id, (tbm.get(b.id) ?? D(0)).plus(amount));
          const k = 'key:BEARER_TBM';
          debit.set(k, { key: 'BEARER_TBM', amount: (debit.get(k)?.amount ?? D(0)).plus(amount), description: `Immature blocks (${what})` });
          return true;
        }
        const acc = a?.expenseAccountId ? { accountId: a.expenseAccountId } : { key: KIND_KEY[a?.kind ?? ''] ?? 'PLANT_UPKEEP' };
        const k = acc.accountId ? `acc:${acc.accountId}` : `key:${acc.key}`;
        debit.set(k, { ...acc, amount: (debit.get(k)?.amount ?? D(0)).plus(amount), description: a?.name ?? what });
        return false;
      };
      let wages = D(0);
      for (const x of w.works) {
        const cap = charge(x.blockId, x.activityId, D(x.amount), 'wages');
        if (cap !== x.capitalised) await tx.plantationWork.update({ where: { id: x.id }, data: { capitalised: cap } });
        wages = wages.plus(x.amount);
      }
      let materials = D(0);
      if (w.materials.length) {
        if (!w.warehouseId) throw new ConflictException('Choose the store the materials come from');
        const allowNegative = await this.allowNegative(u.companyId);
        for (const m of w.materials) {
          const p = await tx.product.findFirstOrThrow({ where: { id: m.productId } });
          if (p.trackLots) {
            await this.lots.ensureOpening(tx, u.companyId, p.id, w.warehouseId);
            await this.lots.issue(tx, { companyId: u.companyId, documentId: w.id, lineId: m.id, productId: p.id, warehouseId: w.warehouseId, qty: D(m.qty) });
          }
          const r = await this.inventory.move(tx, { companyId: u.companyId, branchId: w.branchId, productId: p.id, productName: p.name, warehouseId: w.warehouseId, date: w.date, qty: D(m.qty).neg(), docType: 'BKM', documentId: w.id, documentNumber: w.number, allowNegative });
          const value = round(r.totalCost.abs());
          const cap = charge(m.blockId, m.activityId, value, 'materials');
          await tx.plantationMaterial.update({ where: { id: m.id }, data: { amount: value, capitalised: cap } });
          materials = materials.plus(value);
        }
      }
      const lines: PostingLine[] = [...debit.values()].filter((d) => d.amount.gt(0)).map((d) => ({ accountId: d.accountId, key: d.key, debit: d.amount, description: d.description }));
      if (wages.gt(0)) lines.push({ key: 'CHECKROLL_ACCRUED', credit: wages, description: `Wages ${w.number}` });
      if (materials.gt(0)) lines.push({ key: 'INVENTORY', credit: materials, description: `Materials ${w.number}` });
      if (lines.length > 1) await this.journal.post(tx, { companyId: u.companyId, branchId: w.branchId, date: w.date, description: `BKM ${w.number}`, reference: w.number, sourceType: 'BKM', sourceId: w.id, lines });
      for (const [blockId, amt] of tbm) await tx.plantationBlock.update({ where: { id: blockId }, data: { tbmCost: { increment: amt } } });
      await tx.plantationWorkday.update({ where: { id: w.id }, data: { status: 'APPROVED', totalMaterial: materials, approvedAt: new Date(), approvedById: u.id, updatedById: u.id } });
    });
    await this.audit.record('BKM', id, 'APPROVE');
    return this.workday(id);
  }

  /** cancels a BKM: a draft is dropped; an approved one is reversed unless its wages were paid or its block has matured since */
  async cancelWorkday(id: string) {
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM plantation_workdays WHERE id = ${id}::uuid FOR UPDATE`;
      const w = await tx.plantationWorkday.findFirst({ where: { id, companyId: u.companyId, deletedAt: null }, include: { works: true, materials: true } });
      if (!w) throw new NotFoundException('BKM not found');
      if (w.status === 'CANCELLED') throw new ConflictException('The BKM is already cancelled');
      if (w.status === 'DRAFT') {
        RequestCtx.assert('plantation.bkm.record');
        await tx.plantationWorkday.update({ where: { id }, data: { status: 'CANCELLED', deletedAt: new Date(), updatedById: u.id } });
        return;
      }
      RequestCtx.assert('plantation.bkm.approve');
      if (w.works.some((x) => x.payrollRunId)) throw new ConflictException('Wages of this BKM were already put in a payroll: cancel that payroll first');
      const capBlocks = [...new Set([...w.works.filter((x) => x.capitalised).map((x) => x.blockId), ...w.materials.filter((x) => x.capitalised).map((x) => x.blockId)])];
      const matured = await tx.plantationBlock.findMany({ where: { id: { in: capBlocks }, phase: { not: 'TBM' } }, select: { code: true } });
      if (matured.length) throw new ConflictException(`Block ${matured.map((b) => b.code).join(', ')} was declared mature since: undo that first`);
      if (w.materials.length) {
        await this.inventory.reverse(tx, w.id, await this.allowNegative(u.companyId));
        await this.lots.reverse(tx, w.id);
      }
      await this.journal.voidBySource(tx, 'BKM', w.id);
      const tbm = new Map<string, number>();
      for (const x of [...w.works.filter((x) => x.capitalised), ...w.materials.filter((x) => x.capitalised)]) tbm.set(x.blockId, (tbm.get(x.blockId) ?? 0) + n(x.amount));
      for (const [blockId, amt] of tbm) await tx.plantationBlock.update({ where: { id: blockId }, data: { tbmCost: { decrement: D(amt) } } });
      await tx.plantationWorkday.update({ where: { id }, data: { status: 'CANCELLED', updatedById: u.id } });
    });
    await this.audit.record('BKM', id, 'CANCEL');
    return { ok: true };
  }

  // ================================================================ FFB dispatch (SPB) and weighbridge
  async dispatches(q: { from?: string; to?: string; siteId?: string; status?: string }) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.ffbDispatch.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.siteId ? { siteId: q.siteId } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 500,
      include: { lines: { select: { bunches: true } } },
    });
    const nm = await this.names();
    const customers = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      site: nm.sites.get(r.siteId) ?? null,
      division: r.divisionId ? nm.divisions.get(r.divisionId) ?? null : null,
      vehicleNo: r.vehicleNo,
      customer: r.customerId ? customers.get(r.customerId) ?? null : null,
      bunches: r.lines.reduce((a, l) => a + l.bunches, 0),
      netKg: n(r.netKg),
      acceptedKg: n(r.acceptedKg),
      sortingPct: n(r.sortingPct),
      amount: n(r.amount),
    }));
  }

  async dispatch(id: string) {
    RequestCtx.assert('plantation.read');
    if (!UUID.test(id ?? '')) throw new NotFoundException('Transport note not found');
    const d = await this.prisma.ffbDispatch.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!d) throw new NotFoundException('Transport note not found');
    const nm = await this.names();
    const blocks = new Map((await this.prisma.plantationBlock.findMany({ where: { id: { in: d.lines.map((l) => l.blockId) } }, select: { id: true, code: true, bjrKg: true } })).map((b) => [b.id, b]));
    const [customer, product, warehouse, delivery] = await Promise.all([
      d.customerId ? this.prisma.customer.findUnique({ where: { id: d.customerId }, select: { id: true, name: true, address: true } }) : null,
      this.prisma.product.findUnique({ where: { id: d.productId }, select: { id: true, code: true, name: true } }),
      this.prisma.warehouse.findUnique({ where: { id: d.warehouseId }, select: { id: true, name: true } }),
      d.deliveryDocId ? this.prisma.tradeDocument.findUnique({ where: { id: d.deliveryDocId }, select: { id: true, number: true, status: true, deletedAt: true } }) : null,
    ]);
    const n2 = (v: unknown) => n(v);
    return {
      ...d,
      grossKg: n2(d.grossKg),
      tareKg: n2(d.tareKg),
      netKg: n2(d.netKg),
      sortingPct: n2(d.sortingPct),
      sortingKg: n2(d.sortingKg),
      acceptedKg: n2(d.acceptedKg),
      pricePerKg: n2(d.pricePerKg),
      amount: n2(d.amount),
      site: nm.sites.get(d.siteId) ?? null,
      division: d.divisionId ? nm.divisions.get(d.divisionId) ?? null : null,
      customer,
      product,
      warehouse,
      delivery: delivery && !delivery.deletedAt ? delivery : null,
      lines: d.lines.map((l) => ({ ...l, looseFruitKg: n(l.looseFruitKg), estimatedKg: n(l.estimatedKg), actualKg: n(l.actualKg), block: blocks.get(l.blockId) ? { id: l.blockId, code: blocks.get(l.blockId)!.code, bjrKg: n(blocks.get(l.blockId)!.bjrKg) } : null })),
    };
  }

  async saveDispatch(id: string | null, input: z.infer<typeof dispatchSchema>) {
    RequestCtx.assert('plantation.dispatch');
    const u = RequestCtx.user();
    await this.site(input.siteId);
    if (input.divisionId) await this.division(input.divisionId, input.siteId);
    if (input.date > todayDate()) throw invalid({ date: 'The date cannot be in the future' });
    const [prod, wh, cust] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }),
      this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId, deletedAt: null } }),
      input.customerId ? this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }) : Promise.resolve(true),
    ]);
    if (!prod || prod.type !== 'STOCK') throw invalid({ productId: 'Choose the fruit (a stock product, e.g. TBS / FFB)' });
    if (!wh) throw invalid({ warehouseId: 'Warehouse not found' });
    if (!cust) throw invalid({ customerId: 'Customer not found' });
    const blocks = new Map((await this.prisma.plantationBlock.findMany({ where: { companyId: u.companyId, deletedAt: null, id: { in: input.lines.map((l) => l.blockId) } } })).map((b) => [b.id, b]));
    const errors: Record<string, string> = {};
    input.lines.forEach((l, i) => {
      const b = blocks.get(l.blockId);
      if (!b || b.siteId !== input.siteId) errors[`lines.${i}.blockId`] = 'Block not found on this estate';
      else if (b.phase !== 'TM') errors[`lines.${i}.blockId`] = `Block ${b.code} is not mature`;
      if (l.bunches + l.looseFruitKg <= 0) errors[`lines.${i}.bunches`] = 'Enter the bunches or the loose fruit';
    });
    if (Object.keys(errors).length) throw invalid(errors);
    const lines = input.lines.map((l, i) => ({ lineNo: i + 1, blockId: l.blockId, tph: l.tph ?? null, bunches: l.bunches, looseFruitKg: D(l.looseFruitKg), estimatedKg: D(Math.round((l.bunches * n(blocks.get(l.blockId)!.bjrKg) + l.looseFruitKg) * 100) / 100) }));
    const head = {
      date: input.date,
      siteId: input.siteId,
      divisionId: input.divisionId ?? null,
      vehicleNo: input.vehicleNo ?? null,
      driver: input.driver ?? null,
      customerId: input.customerId ?? null,
      productId: input.productId,
      warehouseId: input.warehouseId,
      notes: input.notes ?? null,
      updatedById: u.id,
    };
    const d = await this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM ffb_dispatches WHERE id = ${id}::uuid FOR UPDATE`;
        const before = await tx.ffbDispatch.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
        if (!before) throw new NotFoundException('Transport note not found');
        if (before.status !== 'DRAFT') throw new ConflictException('Only a transport note not yet weighed can be changed');
        await tx.ffbDispatchLine.deleteMany({ where: { dispatchId: id } });
        return tx.ffbDispatch.update({ where: { id }, data: { ...head, lines: { create: lines } } });
      }
      return tx.ffbDispatch.create({ data: { ...head, companyId: u.companyId, branchId: u.branchId ?? null, number: await this.sequence.next('FFB_SPB', u.companyId, input.date, tx), createdById: u.id, lines: { create: lines } } });
    });
    await this.audit.record('FFB Transport Note', d.id, id ? 'UPDATE' : 'CREATE', undefined, { number: d.number, lines: lines.length });
    return this.dispatch(d.id);
  }

  /**
   * Weighbridge ticket of the mill: accepted weight = net - sorting deduction, spread back over the blocks in proportion to
   * the estimate; the fruit enters stock at the agreed price (fair value less costs to sell at harvest) and a draft delivery
   * is made for the buying mill.
   */
  async weighDispatch(id: string, input: z.infer<typeof weighSchema>) {
    RequestCtx.assert('plantation.dispatch');
    const u = RequestCtx.user();
    // a grading sample sets the sorting % (Permentan 13/2024 Lampiran II) unless a deduction in kg was given
    const graded = input.grading && Object.values(input.grading).some((x) => x !== null && x !== undefined) ? gradingDeduction(Object.fromEntries(Object.entries(input.grading).map(([k, v]) => [k, v ?? undefined]))) : null;
    const w = weigh(input.grossKg, input.tareKg, graded && (input.sortingKg === null || input.sortingKg === undefined) ? graded.pct : input.sortingPct, input.sortingKg ?? null);
    if (w.netKg <= 0) throw invalid({ tareKg: 'The tare must be below the gross weight' });
    if (w.acceptedKg <= 0) throw invalid({ sortingKg: 'The sorting deduction takes the whole load' });
    const d = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ffb_dispatches WHERE id = ${id}::uuid FOR UPDATE`;
      const d = await tx.ffbDispatch.findFirst({ where: { id, companyId: u.companyId, deletedAt: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
      if (!d) throw new NotFoundException('Transport note not found');
      if (d.status !== 'DRAFT') throw new ConflictException('The transport note is already weighed or cancelled');
      const weighDay = new Date(localIso(input.weighedAt));
      if (weighDay < d.date) throw invalid({ weighedAt: 'Before the date of the transport note' });
      if (input.weighedAt.getTime() > Date.now() + 5 * 60_000) throw invalid({ weighedAt: 'Cannot be in the future' });
      const allEstimated = d.lines.every((l) => n(l.estimatedKg) > n(l.looseFruitKg) || l.bunches === 0);
      const shares = allocate(w.acceptedKg, d.lines.map((l) => (allEstimated ? n(l.estimatedKg) : l.bunches + n(l.looseFruitKg))));
      for (const [i, l] of d.lines.entries()) await tx.ffbDispatchLine.update({ where: { id: l.id }, data: { actualKg: D(shares[i]) } });
      const amount = round(D(w.acceptedKg).times(input.pricePerKg));
      const p = await tx.product.findFirstOrThrow({ where: { id: d.productId } });
      const qty = D(w.acceptedKg);
      await this.inventory.move(tx, { companyId: u.companyId, branchId: d.branchId, productId: p.id, productName: p.name, warehouseId: d.warehouseId, date: d.date, qty, unitCost: input.pricePerKg > 0 ? D(input.pricePerKg) : D(0.0001), docType: 'FFB', documentId: d.id, documentNumber: d.number, allowNegative: true });
      if (p.trackLots) await this.lots.receive(tx, { companyId: u.companyId, documentId: d.id, lineId: d.id, productId: p.id, warehouseId: d.warehouseId, qty, lotNo: d.number, docNumber: d.number, docDate: d.date, shelfLifeDays: p.shelfLifeDays });
      if (amount.gt(0))
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: d.branchId,
          date: d.date,
          description: `FFB harvested ${d.number}: ${w.acceptedKg.toLocaleString('en-US')} kg at fair value`,
          reference: d.number,
          sourceType: 'FFB',
          sourceId: d.id,
          lines: [
            { key: 'INVENTORY', debit: amount, description: `FFB ${d.number}` },
            { key: 'PRODUCE_AT_HARVEST', credit: amount, description: `FFB ${d.number}` },
          ],
        });
      return tx.ffbDispatch.update({
        where: { id: d.id },
        data: { status: 'WEIGHED', ticketNo: input.ticketNo ?? null, weighedAt: input.weighedAt, grossKg: D(input.grossKg), tareKg: D(input.tareKg), netKg: D(w.netKg), sortingPct: D(w.sortingPct), sortingKg: D(w.sortingKg), grading: graded ? ({ ...input.grading, parts: graded.parts, pct: graded.pct } as Prisma.InputJsonValue) : Prisma.DbNull, acceptedKg: qty, pricePerKg: D(input.pricePerKg), amount, updatedById: u.id },
      });
    });
    if (d.customerId) {
      const doc = await this.documents.create(
        'DO',
        {
          date: d.date,
          customerId: d.customerId,
          warehouseId: d.warehouseId,
          reference: d.number,
          notes: [
            `FFB transport note ${d.number}${d.vehicleNo ? `, vehicle ${d.vehicleNo}` : ''}${d.ticketNo ? `, weighbridge ticket ${d.ticketNo}` : ''}.`,
            `Net ${n(d.netKg).toLocaleString('en-US')} kg, sorting ${n(d.sortingPct)}% (${n(d.sortingKg).toLocaleString('en-US')} kg), accepted ${n(d.acceptedKg).toLocaleString('en-US')} kg${n(d.pricePerKg) ? ` at ${n(d.pricePerKg).toLocaleString('en-US')} per kg` : ''}.`,
            'Tax on the invoice: a PKP that chose the deemed rate charges PPN 1.1% of the price (PMK 64/2022 jo PMK 11/2025, faktur code 05, tax PPN-AGRI); a non-PKP charges none.',
            'The mill collects PPh 22 0.25% of the price excl. PPN when its purchases from us exceed Rp20 million in the month (PMK 51/2025): ask for the bukti pungut.',
          ].join(' '),
          lines: [{ productId: d.productId, qty: n(d.acceptedKg), unitPrice: n(d.pricePerKg) }],
        },
        undefined,
        { skipPermission: true },
      );
      await this.prisma.ffbDispatch.update({ where: { id: d.id }, data: { deliveryDocId: (doc as { id: string }).id } });
    }
    await this.audit.record('FFB Transport Note', d.id, 'WEIGH', undefined, { ticketNo: d.ticketNo, netKg: n(d.netKg), acceptedKg: n(d.acceptedKg) });
    return this.dispatch(d.id);
  }

  async cancelDispatch(id: string) {
    RequestCtx.assert('plantation.dispatch');
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ffb_dispatches WHERE id = ${id}::uuid FOR UPDATE`;
      const d = await tx.ffbDispatch.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
      if (!d) throw new NotFoundException('Transport note not found');
      if (d.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      if (d.status === 'WEIGHED') {
        if (d.deliveryDocId) {
          const doc = await tx.tradeDocument.findUnique({ where: { id: d.deliveryDocId } });
          if (doc && !doc.deletedAt && doc.status !== 'DRAFT' && doc.status !== 'CANCELLED') throw new ConflictException(`Delivery ${doc.number} is already confirmed: cancel it first`);
          if (doc && !doc.deletedAt) await tx.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
        }
        await this.inventory.reverse(tx, d.id, await this.allowNegative(u.companyId));
        await this.lots.reverse(tx, d.id);
        await this.journal.voidBySource(tx, 'FFB', d.id);
        await tx.ffbDispatchLine.updateMany({ where: { dispatchId: d.id }, data: { actualKg: D(0) } });
      }
      await tx.ffbDispatch.update({ where: { id: d.id }, data: { status: 'CANCELLED', updatedById: u.id } });
    });
    await this.audit.record('FFB Transport Note', id, 'CANCEL');
    return { ok: true };
  }

  // ================================================================ reports
  /** production and cost per block in a period: fruit weighed, BJR, yield per ha, HK, cost per ha and per kg, harvest rotation */
  private async productionRows(blocks: Block[], from: Date, to: Date) {
    if (!blocks.length) return [];
    const ids = blocks.map((b) => b.id);
    const [works, mats, loads, lastHarvest] = await Promise.all([
      this.prisma.plantationWork.findMany({ where: { blockId: { in: ids }, date: { gte: from, lte: to }, workday: { status: 'APPROVED' } }, select: { blockId: true, activityId: true, hk: true, amount: true, bunches: true, capitalised: true } }),
      this.prisma.plantationMaterial.groupBy({ by: ['blockId'], where: { blockId: { in: ids }, date: { gte: from, lte: to }, workday: { status: 'APPROVED' } }, _sum: { amount: true } }),
      this.prisma.ffbDispatchLine.findMany({ where: { blockId: { in: ids }, dispatch: { status: 'WEIGHED', deletedAt: null, date: { gte: from, lte: to } } }, select: { blockId: true, bunches: true, looseFruitKg: true, actualKg: true } }),
      this.prisma.plantationWork.groupBy({ by: ['blockId'], where: { blockId: { in: ids }, date: { lte: to }, bunches: { gt: 0 }, workday: { status: 'APPROVED' } }, _max: { date: true } }),
    ]);
    const lastLoad = (
      await this.prisma.$queryRaw<{ blockId: string; date: Date }[]>`SELECT l."blockId", max(d.date) AS date FROM ffb_dispatch_lines l JOIN ffb_dispatches d ON d.id = l."dispatchId" WHERE l."blockId" = ANY(${ids}::uuid[]) AND d.status = 'WEIGHED' AND d."deletedAt" IS NULL AND d.date <= ${to} GROUP BY l."blockId"`
    );
    const harvestActs = new Set((await this.prisma.plantationActivity.findMany({ where: { companyId: blocks[0].companyId, kind: 'HARVEST' }, select: { id: true } })).map((a) => a.id));
    return blocks.map((b) => {
      const w = works.filter((x) => x.blockId === b.id);
      const l = loads.filter((x) => x.blockId === b.id);
      const hk = w.reduce((a, x) => a + n(x.hk), 0);
      const harvestHk = w.filter((x) => harvestActs.has(x.activityId)).reduce((a, x) => a + n(x.hk), 0);
      const labour = w.reduce((a, x) => a + n(x.amount), 0);
      const material = n(mats.find((m) => m.blockId === b.id)?._sum.amount);
      const kg = l.reduce((a, x) => a + n(x.actualKg), 0);
      const bunches = l.reduce((a, x) => a + x.bunches, 0);
      const loose = l.reduce((a, x) => a + n(x.looseFruitKg), 0);
      const harvested = w.reduce((a, x) => a + x.bunches, 0);
      const area = n(b.areaHa);
      const cost = labour + material;
      const cut = lastHarvest.find((x) => x.blockId === b.id)?._max.date ?? null;
      const sent = lastLoad.find((x) => x.blockId === b.id)?.date ?? null;
      const last = cut && sent ? (cut > sent ? cut : sent) : cut ?? sent;
      return {
        id: b.id,
        kg,
        tonPerHa: area > 0 ? kg / 1000 / area : null,
        bunchesHarvested: harvested,
        bunchesDelivered: bunches,
        bjrActual: bunches > 0 ? Math.max(0, kg - loose) / bunches : null,
        hk,
        hkPerHa: area > 0 ? hk / area : null,
        kgPerHarvestHk: harvestHk > 0 ? kg / harvestHk : null,
        labour,
        material,
        cost,
        costPerHa: area > 0 ? cost / area : null,
        costPerKg: b.phase === 'TM' && kg > 0 ? cost / kg : null,
        lastHarvest: last,
        daysSinceHarvest: last ? Math.round((to.getTime() - last.getTime()) / DAY) : null,
      };
    });
  }

  async production(q: { from: string; to: string; siteId?: string; divisionId?: string }) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new BadRequestException('Choose a valid period');
    const blocks = await this.prisma.plantationBlock.findMany({ where: { companyId, deletedAt: null, ...(q.siteId ? { siteId: q.siteId } : {}), ...(q.divisionId ? { divisionId: q.divisionId } : {}) }, orderBy: { code: 'asc' } });
    const rows = await this.productionRows(blocks, from, to);
    const nm = await this.names();
    return blocks.map((b, i) => ({
      block: { id: b.id, code: b.code, phase: b.phase, plantingYear: b.plantingYear, areaHa: n(b.areaHa) },
      division: nm.divisions.get(b.divisionId)?.name ?? '',
      site: nm.sites.get(b.siteId)?.name ?? '',
      ...rows[i],
    }));
  }

  /** wages per worker in a period (checkroll), with the payroll that paid them and the minimum-wage check */
  async checkroll(q: { from: string; to: string; divisionId?: string }) {
    RequestCtx.assert('plantation.read');
    const companyId = RequestCtx.companyId();
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw new BadRequestException('Choose a valid period');
    const works = await this.prisma.plantationWork.findMany({ where: { companyId, date: { gte: from, lte: to }, workday: { status: 'APPROVED', ...(q.divisionId ? { divisionId: q.divisionId } : {}) } }, select: { employeeId: true, date: true, hk: true, wage: true, premium: true, penalty: true, amount: true, bunches: true, payrollRunId: true } });
    const emps = new Map((await this.prisma.employee.findMany({ where: { id: { in: [...new Set(works.map((w) => w.employeeId))] } }, select: { id: true, code: true, fullName: true, baseSalary: true } })).map((e) => [e.id, e]));
    const minimumWage = await this.settings.num('payroll.minimumWage', companyId, 0);
    const daysPerMonth = await this.settings.num('plantation.workDaysPerMonth', companyId, 25);
    const by = new Map<string, { days: Set<string>; hk: number; wage: number; premium: number; penalty: number; amount: number; paid: number; bunches: number }>();
    for (const w of works) {
      const r = by.get(w.employeeId) ?? { days: new Set<string>(), hk: 0, wage: 0, premium: 0, penalty: 0, amount: 0, paid: 0, bunches: 0 };
      r.days.add(iso(w.date));
      r.hk += n(w.hk);
      r.wage += n(w.wage);
      r.premium += n(w.premium);
      r.penalty += n(w.penalty);
      r.amount += n(w.amount);
      r.bunches += w.bunches;
      if (w.payrollRunId) r.paid += n(w.amount);
      by.set(w.employeeId, r);
    }
    return {
      minimumDaily: minimumWage > 0 ? minimumWage / daysPerMonth : null,
      daysPerMonth,
      rows: [...by.entries()]
        .map(([id, r]) => {
          const e = emps.get(id);
          const perHk = r.hk > 0 ? r.amount / r.hk : 0;
          return { employee: e ? { id: e.id, code: e.code, fullName: e.fullName } : null, monthlySalary: n(e?.baseSalary), days: r.days.size, hk: r.hk, wage: r.wage, premium: r.premium, penalty: r.penalty, amount: r.amount, paid: r.paid, unpaid: r.amount - r.paid, bunches: r.bunches, perHk, belowMinimum: minimumWage > 0 && n(e?.baseSalary) === 0 && perHk < minimumWage / daysPerMonth };
        })
        .sort((a, b) => (a.employee?.code ?? '').localeCompare(b.employee?.code ?? '')),
    };
  }
}
