import { randomUUID } from 'node:crypto';
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
import { addDays, adg, daysBetween, milkPrice, reproKpis, type MilkScheme } from './herd-calc';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const todayDate = () => new Date(localIso());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const pct = (max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const SPECIES = ['CATTLE', 'BUFFALO', 'GOAT', 'SHEEP'] as const;
export const PURPOSES = ['DAIRY', 'BREEDING', 'FATTENING'] as const;

export const registerSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).min(1).max(500),
  nationalIds: z.array(z.string().trim().max(60)).max(500).optional(),
  species: z.enum(SPECIES).default('CATTLE'),
  breed: optText(80),
  sex: z.enum(['F', 'M']),
  purpose: z.enum(PURPOSES),
  birthDate: optDate,
  origin: z.enum(['PURCHASED', 'OPENING', 'BORN']),
  acquisitionDate: z.coerce.date(),
  /** cost per head */
  costPerHead: z.coerce.number().min(0).max(1e12).default(0),
  weightKg: optNum,
  supplierId: optUuid,
  siteId: z.uuid(),
  unitId: optUuid,
  damId: optUuid,
  sire: optText(60),
  /** go-live: lactations so far, last calving, in milk, last service and pregnancy */
  lactationNo: z.coerce.number().int().min(0).max(20).default(0),
  lastCalving: optDate,
  lactating: z.boolean().default(false),
  lastService: optDate,
  pregnant: z.boolean().default(false),
  notes: optText(1000),
});
export const updateSchema = z.object({ name: optText(100), nationalId: optText(60), breed: optText(80), purpose: z.enum(PURPOSES), birthDate: optDate, sire: optText(60), notes: optText(2000) });
export const weighSchema = z.object({ date: z.coerce.date(), rows: z.array(z.object({ animalId: z.uuid(), kg: z.coerce.number().positive().max(3000), bcs: optNum })).min(1).max(1000) });
export const eventSchema = z.object({
  date: z.coerce.date(),
  type: z.enum(['HEAT', 'SERVICE', 'PREG_CHECK', 'CALVING', 'ABORTION', 'DRY_OFF', 'MOVE', 'NOTE']),
  method: optText(10),
  sire: optText(60),
  technician: optText(100),
  result: optText(10),
  toUnitId: optUuid,
  calves: z.array(z.object({ tagNo: z.string().trim().min(1).max(40), sex: z.enum(['F', 'M']), birthWeightKg: optNum, purpose: z.enum(PURPOSES).optional() })).max(4).default([]),
  notes: optText(500),
});
export const treatSchema = z.object({
  animalIds: z.array(z.uuid()).min(1).max(1000),
  date: z.coerce.date(),
  kind: z.enum(['VACCINE', 'MEDICINE', 'VITAMIN', 'DEWORMING', 'OTHER']),
  description: z.string().trim().min(1).max(200),
  diagnosis: optText(150),
  productId: optUuid,
  warehouseId: optUuid,
  qtyPerHead: z.coerce.number().min(0).max(1e6).default(0),
  milkWithdrawalDays: z.coerce.number().int().min(0).max(365).default(0),
  meatWithdrawalDays: z.coerce.number().int().min(0).max(365).default(0),
  vet: optText(100),
  notes: optText(500),
});
export const feedSchema = z.object({ date: z.coerce.date(), unitId: z.uuid(), productId: z.uuid(), warehouseId: z.uuid(), qty: z.coerce.number().positive().max(1e8), notes: optText(500) });
export const productiveSchema = z.object({ date: z.coerce.date(), usefulLifeMonths: z.coerce.number().int().min(6).max(240).optional(), salvageValue: optNum });
export const exitSchema = z.object({
  animalIds: z.array(z.uuid()).min(1).max(1000),
  type: z.enum(['SALE', 'CULL', 'DEATH']),
  date: z.coerce.date(),
  reason: optText(150),
  customerId: optUuid,
  /** price per kg live weight, or a total per head */
  pricePerKg: optNum,
  pricePerHead: optNum,
  weights: z.record(z.string(), z.coerce.number().positive().max(3000)).default({}),
  overrideWithdrawal: optText(200),
});
export const milkRecordSchema = z.object({ date: z.coerce.date(), session: z.enum(['AM', 'PM']), rows: z.array(z.object({ animalId: z.uuid(), liters: z.coerce.number().min(0).max(100) })).max(2000) });
export const schemeSchema = z.object({
  customerId: z.uuid(),
  effectiveDate: z.coerce.date(),
  basePrice: z.coerce.number().positive().max(1e6),
  fatStd: z.coerce.number().min(0).max(20).default(0),
  fatStep: z.coerce.number().min(0).max(1e5).default(0),
  tsStd: z.coerce.number().min(0).max(30).default(0),
  tsStep: z.coerce.number().min(0).max(1e5).default(0),
  tpcGrades: z.array(z.object({ maxTpc: z.coerce.number().positive().max(1e12), adj: z.coerce.number().min(-1e6).max(1e6) })).max(10).default([]),
  notes: optText(300),
});
export const deliverySchema = z.object({
  date: z.coerce.date(),
  session: z.enum(['AM', 'PM', 'DAY']).default('DAY'),
  customerId: z.uuid(),
  liters: z.coerce.number().positive().max(1e7),
  fat: pct(20),
  snf: pct(20),
  ts: pct(30),
  protein: pct(20),
  tpc: optNum,
  density: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0.9).max(1.2).nullable().optional()),
  alcoholTest: z.boolean().nullable().optional(),
  rejected: z.boolean().default(false),
  pricePerLiter: optNum,
  notes: optText(500),
});
export const milkSettleSchema = z.object({ customerId: z.uuid(), from: z.coerce.date(), to: z.coerce.date(), date: z.coerce.date().optional() });

type Animal = Prisma.AnimalGetPayload<object>;

/**
 * Herd kept by head (cattle, buffalo, goats, sheep): register, weighings and gain, reproduction (service, pregnancy,
 * calving, dry-off), health with drug withdrawal periods for milk and meat, feed given to a pen shared by its animals,
 * milk recording per cow and deliveries priced on quality, sales and deaths.
 *
 * Accounting (cost model, SAK EP Section 34): a growing / fattening animal carries its cost (purchase, feed, health) as
 * a biological asset; a breeding or dairy animal becomes productive at its first calving (or when put into service):
 * its cost becomes a fixed asset depreciated over its productive life, and later feed / health are production costs.
 */
@Injectable()
export class HerdService {
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

  private async cfg(companyId: string) {
    const v = (k: string, d: number) => this.settings.num(`herd.${k}`, companyId, d);
    return {
      gestationDays: await v('gestationDays', 283),
      dryOffDays: await v('dryOffDays', 60),
      waitingDays: await v('voluntaryWaitingDays', 45),
      pregCheckDays: await v('pregCheckDays', 60),
      lifeMonths: await v('productiveLifeMonths', 60),
      salvagePct: await v('salvagePct', 40),
    };
  }

  private async own(id: string, db: PrismaService | Tx = this.prisma): Promise<Animal> {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Animal not found');
    const a = await db.animal.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!a) throw new NotFoundException('Animal not found');
    return a;
  }

  private async lock(tx: Tx, ids: string[]) {
    await tx.$queryRaw`SELECT id FROM animals WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  }

  /** non-stock product used on the documents the herd makes (bought / sold animals, milk), made once per company */
  private async product(code: string, name: string, accounts: { expenseKey?: string; incomeKey?: string }) {
    const companyId = RequestCtx.companyId();
    const found = await this.prisma.product.findFirst({ where: { companyId, code } });
    if (found) return found;
    const acc = await this.prisma.$transaction(async (tx) => ({
      expense: accounts.expenseKey ? await this.journal.mapping(tx, companyId, accounts.expenseKey) : null,
      income: accounts.incomeKey ? await this.journal.mapping(tx, companyId, accounts.incomeKey) : null,
    }));
    return this.prisma.product.create({
      data: { companyId, code, name, type: 'CONSUMABLE', expenseAccountId: acc.expense, incomeAccountId: acc.income, isSellable: !!accounts.incomeKey, isPurchasable: !!accounts.expenseKey, description: 'Made by the herd module for its documents', createdById: RequestCtx.user().id },
    });
  }

  /** PPN exemption code on the invoice (faktur code 08): only a PKP issues a faktur, a non-PKP charges no tax at all */
  private async exemptTax(companyId: string) {
    if (!(await this.settings.bool('sales.vatPayer', companyId, true))) return null;
    return this.prisma.tax.findFirst({ where: { companyId, code: 'PPN-EXEMPT', deletedAt: null } });
  }

  /** charges a cost to animals: capitalised for growing ones, a production cost for productive ones */
  private async charge(tx: Tx, animals: Animal[], total: Prisma.Decimal, date: Date, kind: string, sourceType: string, sourceId: string, creditKey: string, description: string) {
    if (total.lte(0) || !animals.length) return;
    const each = round(total.div(animals.length));
    let left = total;
    let capital = D(0);
    let expense = D(0);
    for (const [i, a] of animals.entries()) {
      const amt = i === animals.length - 1 ? left : each;
      left = left.minus(amt);
      const cap = !a.fixedAssetId;
      await tx.animalCost.create({ data: { animalId: a.id, date, kind, amount: amt, capitalised: cap, sourceType, sourceId } });
      if (cap) {
        await tx.animal.update({ where: { id: a.id }, data: { carryingCost: { increment: amt } } });
        capital = capital.plus(amt);
      } else expense = expense.plus(amt);
    }
    const lines: PostingLine[] = [];
    if (capital.gt(0)) lines.push({ key: 'BIO_ASSET', debit: capital, description: `${description} (growing animals)` });
    if (expense.gt(0)) lines.push({ key: 'HERD_COST', debit: expense, description: `${description} (productive animals)` });
    lines.push({ key: creditKey, credit: total, description });
    await this.journal.post(tx, { companyId: animals[0].companyId, branchId: animals[0].branchId, date, description, sourceType, sourceId, lines });
  }

  /** takes the cost of a source back from the animals (cancel) */
  private async uncharge(tx: Tx, sourceType: string, sourceId: string) {
    const rows = await tx.animalCost.findMany({ where: { sourceId } });
    const animals = await tx.animal.findMany({ where: { id: { in: rows.map((r) => r.animalId) } } });
    for (const r of rows.filter((x) => x.capitalised)) {
      const a = animals.find((x) => x.id === r.animalId)!;
      if (a.status !== 'ACTIVE' || a.fixedAssetId) throw new ConflictException(`Animal ${a.tagNo} has left the herd or become productive since: its cost cannot be taken back`);
      await tx.animal.update({ where: { id: a.id }, data: { carryingCost: { decrement: r.amount } } });
    }
    await tx.animalCost.deleteMany({ where: { sourceId } });
    await this.journal.voidBySource(tx, sourceType, sourceId);
  }

  // ================================================================ lists
  async lists() {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const sites = await this.prisma.farmSite.findMany({ where: { companyId, deletedAt: null, isActive: true, kind: { in: ['LIVESTOCK', 'MIXED'] } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    const units = await this.prisma.farmUnit.findMany({ where: { companyId, deletedAt: null, isActive: true, siteId: { in: sites.map((s) => s.id) } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, siteId: true, kind: true, capacity: true } });
    const heads = await this.prisma.animal.groupBy({ by: ['unitId'], where: { companyId, status: 'ACTIVE', deletedAt: null }, _count: { _all: true } });
    return { sites, units: units.map((u) => ({ ...u, heads: heads.find((h) => h.unitId === u.id)?._count._all ?? 0 })), settings: await this.cfg(companyId) };
  }

  // ================================================================ register
  async animals(q: { status?: string; purpose?: string; unitId?: string; repro?: string; search?: string }) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.animal.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(q.status ? (q.status === 'ALL' ? {} : { status: q.status }) : { status: 'ACTIVE' }),
        ...(q.purpose ? { purpose: q.purpose } : {}),
        ...(q.unitId ? { unitId: q.unitId } : {}),
        ...(q.repro === 'LACTATING' ? { lactating: true } : q.repro === 'DRY' ? { lactating: false, lactationNo: { gt: 0 }, sex: 'F' } : q.repro ? { reproStatus: q.repro, sex: 'F' } : {}),
        ...(q.search ? { OR: [{ tagNo: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { nationalId: { contains: q.search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { tagNo: 'asc' },
      take: 3000,
    });
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId }, select: { id: true, code: true, name: true } })).map((u) => [u.id, u]));
    const gains = await this.gains(rows.map((r) => r.id));
    const today = todayDate();
    return rows.map((a) => ({
      id: a.id,
      tagNo: a.tagNo,
      name: a.name,
      species: a.species,
      breed: a.breed,
      sex: a.sex,
      purpose: a.purpose,
      status: a.status,
      ageMonths: a.birthDate ? Math.floor(daysBetween(a.birthDate, today) / 30.4375) : null,
      unit: a.unitId ? units.get(a.unitId) ?? null : null,
      reproStatus: a.reproStatus,
      lactating: a.lactating,
      lactationNo: a.lactationNo,
      daysInMilk: a.lactating && a.lastCalving ? daysBetween(a.lastCalving, today) : null,
      expectedCalving: a.expectedCalving,
      lastWeightKg: a.lastWeightKg === null ? null : n(a.lastWeightKg),
      lastWeighDate: a.lastWeighDate,
      adg: gains.get(a.id) ?? null,
      carryingCost: n(a.carryingCost),
      productive: !!a.fixedAssetId,
      withdrawal: (a.milkWithdrawalUntil && a.milkWithdrawalUntil >= today) || (a.meatWithdrawalUntil && a.meatWithdrawalUntil >= today) ? { milk: a.milkWithdrawalUntil, meat: a.meatWithdrawalUntil } : null,
    }));
  }

  /** ADG between the last two weighings of each animal */
  private async gains(ids: string[]) {
    const out = new Map<string, number | null>();
    if (!ids.length) return out;
    const w = await this.prisma.animalWeight.findMany({ where: { animalId: { in: ids } }, orderBy: [{ animalId: 'asc' }, { date: 'desc' }], select: { animalId: true, date: true, kg: true } });
    const by = new Map<string, { date: Date; kg: number }[]>();
    for (const r of w) by.set(r.animalId, [...(by.get(r.animalId) ?? []), { date: r.date, kg: n(r.kg) }]);
    for (const [id, list] of by) out.set(id, list.length >= 2 ? adg(list[1], list[0]) : null);
    return out;
  }

  async animal(id: string) {
    RequestCtx.assert('herd.read');
    const a = await this.own(id);
    const today = todayDate();
    const [weights, events, treatments, costs, milk, dam, calves, asset] = await Promise.all([
      this.prisma.animalWeight.findMany({ where: { animalId: a.id }, orderBy: { date: 'asc' } }),
      this.prisma.animalEvent.findMany({ where: { animalId: a.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.animalTreatment.findMany({ where: { animalId: a.id }, orderBy: { date: 'desc' } }),
      this.prisma.animalCost.groupBy({ by: ['kind', 'capitalised'], where: { animalId: a.id }, _sum: { amount: true } }),
      this.prisma.milkRecord.findMany({ where: { animalId: a.id, date: { gte: addDays(today, -60) } }, orderBy: { date: 'asc' } }),
      a.damId ? this.prisma.animal.findUnique({ where: { id: a.damId }, select: { id: true, tagNo: true } }) : null,
      this.prisma.animal.findMany({ where: { damId: a.id, deletedAt: null }, select: { id: true, tagNo: true, sex: true, birthDate: true, status: true }, orderBy: { birthDate: 'desc' } }),
      a.fixedAssetId ? this.prisma.fixedAsset.findUnique({ where: { id: a.fixedAssetId }, select: { id: true, code: true, cost: true, salvageValue: true, accumulatedDepreciation: true, usefulLifeMonths: true, statusCode: true } }) : null,
    ]);
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId: a.companyId }, select: { id: true, code: true, name: true } })).map((u) => [u.id, u]));
    const site = await this.prisma.farmSite.findUnique({ where: { id: a.siteId }, select: { id: true, code: true, name: true } });
    const supplier = a.supplierId ? await this.prisma.supplier.findUnique({ where: { id: a.supplierId }, select: { id: true, name: true } }) : null;
    const customer = a.customerId ? await this.prisma.customer.findUnique({ where: { id: a.customerId }, select: { id: true, name: true } }) : null;
    const wl = weights.map((w) => ({ id: w.id, date: w.date, kg: n(w.kg), bcs: w.bcs === null ? null : n(w.bcs) }));
    const milkDays = new Map<string, { am: number; pm: number; discarded: boolean }>();
    for (const m of milk) {
      const k = iso(m.date);
      const r = milkDays.get(k) ?? { am: 0, pm: 0, discarded: false };
      if (m.session === 'AM') r.am = n(m.liters);
      else r.pm = n(m.liters);
      r.discarded = r.discarded || m.discarded;
      milkDays.set(k, r);
    }
    return {
      ...a,
      birthWeightKg: a.birthWeightKg === null ? null : n(a.birthWeightKg),
      lastWeightKg: a.lastWeightKg === null ? null : n(a.lastWeightKg),
      acquisitionCost: n(a.acquisitionCost),
      carryingCost: n(a.carryingCost),
      exitWeightKg: a.exitWeightKg === null ? null : n(a.exitWeightKg),
      exitValue: a.exitValue === null ? null : n(a.exitValue),
      exitCost: a.exitCost === null ? null : n(a.exitCost),
      ageMonths: a.birthDate ? Math.floor(daysBetween(a.birthDate, today) / 30.4375) : null,
      daysInMilk: a.lactating && a.lastCalving ? daysBetween(a.lastCalving, today) : null,
      site,
      unit: a.unitId ? units.get(a.unitId) ?? null : null,
      supplier,
      customer,
      dam,
      calves,
      asset: asset ? { ...asset, cost: n(asset.cost), salvageValue: n(asset.salvageValue), accumulatedDepreciation: n(asset.accumulatedDepreciation) } : null,
      weights: wl,
      adgLast: wl.length >= 2 ? adg(wl[wl.length - 2], wl[wl.length - 1]) : null,
      adgTotal: wl.length >= 2 ? adg(wl[0], wl[wl.length - 1]) : null,
      events: events.map((e) => ({ ...e, fromUnit: e.fromUnitId ? units.get(e.fromUnitId)?.name ?? null : null, toUnit: e.toUnitId ? units.get(e.toUnitId)?.name ?? null : null })),
      treatments: treatments.map((t) => ({ ...t, qty: n(t.qty), cost: n(t.cost) })),
      costs: costs.map((c) => ({ kind: c.kind, capitalised: c.capitalised, amount: n(c._sum.amount) })),
      milk: [...milkDays.entries()].map(([date, v]) => ({ date, ...v, total: Math.round((v.am + v.pm) * 100) / 100 })),
    };
  }

  /**
   * Registers animals (one or many with the same details): bought animals carry their purchase cost (Dr Biological
   * assets / Cr Goods received not invoiced, with a draft supplier invoice), animals at go-live their opening value
   * (Cr Opening balance equity), born animals start at no cost.
   */
  async register(input: z.infer<typeof registerSchema>) {
    RequestCtx.assert('herd.animal.manage');
    const u = RequestCtx.user();
    if (input.acquisitionDate > todayDate()) throw invalid({ acquisitionDate: 'Cannot be in the future' });
    const tags = input.tags.map((t) => t.toUpperCase());
    if (new Set(tags).size !== tags.length) throw invalid({ tags: 'A tag appears twice' });
    const taken = await this.prisma.animal.findMany({ where: { companyId: u.companyId, tagNo: { in: tags } }, select: { tagNo: true } });
    if (taken.length) throw invalid({ tags: `Already in the herd: ${taken.map((t) => t.tagNo).join(', ')}` });
    const site = await this.prisma.farmSite.findFirst({ where: { id: input.siteId, companyId: u.companyId, deletedAt: null } });
    if (!site) throw invalid({ siteId: 'Farm not found' });
    if (input.unitId && !(await this.prisma.farmUnit.findFirst({ where: { id: input.unitId, siteId: site.id, deletedAt: null } }))) throw invalid({ unitId: 'Pen not found on this farm' });
    if (input.origin === 'PURCHASED' && input.costPerHead > 0 && !input.supplierId) throw invalid({ supplierId: 'Who sold the animals' });
    if (input.supplierId && !(await this.prisma.supplier.findFirst({ where: { id: input.supplierId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ supplierId: 'Supplier not found' });
    if (input.damId) await this.own(input.damId);
    if (input.origin === 'OPENING' && input.sex === 'F') {
      if (input.lactationNo > 0 && !input.lastCalving) throw invalid({ lastCalving: 'Date of the last calving' });
      if (input.pregnant && !input.lastService) throw invalid({ lastService: 'Date of the service she conceived from' });
      if (input.lastCalving && input.lastCalving > input.acquisitionDate) throw invalid({ lastCalving: 'After the go-live date' });
      if (input.lastService && input.lastService > input.acquisitionDate) throw invalid({ lastService: 'After the go-live date' });
    }
    const cost = input.origin === 'BORN' ? 0 : input.costPerHead;
    const total = round(D(cost).times(tags.length));
    const batch = randomUUID();
    const buyProduct = input.origin === 'PURCHASED' && total.gt(0) ? await this.product('LIVESTOCK-IN', 'Livestock bought (received into the herd)', { expenseKey: 'GRNI' }) : null;
    const created = await this.prisma.$transaction(async (tx) => {
      const rows: Animal[] = [];
      for (const [i, tag] of tags.entries()) {
        rows.push(
          await tx.animal.create({
            data: {
              companyId: u.companyId,
              branchId: u.branchId ?? null,
              tagNo: tag,
              nationalId: input.nationalIds?.[i] || null,
              species: input.species,
              breed: input.breed ?? null,
              sex: input.sex,
              purpose: input.purpose,
              birthDate: input.birthDate ?? null,
              origin: input.origin,
              damId: input.damId ?? null,
              sire: input.sire ?? null,
              siteId: site.id,
              unitId: input.unitId ?? null,
              acquisitionDate: input.acquisitionDate,
              acquisitionCost: D(cost),
              carryingCost: D(cost),
              supplierId: input.supplierId ?? null,
              lastWeightKg: input.weightKg ?? null,
              lastWeighDate: input.weightKg ? input.acquisitionDate : null,
              notes: input.notes ?? null,
              createdById: u.id,
            },
          }),
        );
        if (input.weightKg) await tx.animalWeight.create({ data: { animalId: rows[i].id, date: input.acquisitionDate, kg: D(input.weightKg), notes: 'At arrival', createdById: u.id } });
        if (cost > 0) await tx.animalCost.create({ data: { animalId: rows[i].id, date: input.acquisitionDate, kind: 'PURCHASE', amount: D(cost), capitalised: true, sourceType: 'HREG', sourceId: batch } });
        // history before go-live, as events (so the reproduction state is computed like any other)
        if (input.origin === 'OPENING' && input.sex === 'F' && (input.lastCalving || input.lastService)) {
          if (input.lastCalving && input.lactationNo > 0)
            await tx.animalEvent.create({ data: { animalId: rows[i].id, date: input.lastCalving, type: 'CALVING', result: 'LIVE', data: { opening: true, lactationNo: input.lactationNo, lactating: input.lactating } as Prisma.InputJsonValue, notes: 'Last calving before go-live', createdById: u.id } });
          if (input.lastService) {
            await tx.animalEvent.create({ data: { animalId: rows[i].id, date: input.lastService, type: 'SERVICE', method: 'AI', notes: 'Last service before go-live', createdById: u.id } });
            if (input.pregnant) await tx.animalEvent.create({ data: { animalId: rows[i].id, date: input.acquisitionDate, type: 'PREG_CHECK', result: 'POSITIVE', notes: 'Pregnant at go-live', createdById: u.id } });
          }
          await this.recompute(tx, rows[i]);
        }
      }
      if (total.gt(0))
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          date: input.acquisitionDate,
          description: `${input.origin === 'OPENING' ? 'Opening herd' : 'Animals bought'}: ${tags.length} head`,
          reference: tags.length === 1 ? tags[0] : `${tags[0]}..${tags[tags.length - 1]}`,
          sourceType: 'HREG',
          sourceId: batch,
          lines: [
            { key: 'BIO_ASSET', debit: total, description: `${tags.length} head` },
            input.origin === 'OPENING' ? { key: 'OPENING_EQUITY', credit: total } : { key: 'GRNI', credit: total, supplierId: input.supplierId ?? null },
          ],
        });
      return rows;
    });
    if (buyProduct) {
      const doc = (await this.documents.create(
        'PI',
        {
          date: input.acquisitionDate,
          supplierId: input.supplierId!,
          reference: tags.length === 1 ? tags[0] : `${tags.length} head`,
          notes: `${tags.length} ${input.species.toLowerCase()} (${input.breed ?? 'breed not given'}): ${tags.join(', ')}. Live animals are exempt from PPN (PP 49/2022).`,
          lines: [{ productId: buyProduct.id, description: `${input.species} ${input.breed ?? ''} ${input.sex === 'F' ? 'female' : 'male'}`.trim(), qty: tags.length, unitPrice: cost }],
        },
        undefined,
        { skipPermission: true },
      )) as { id: string };
      await this.prisma.animal.updateMany({ where: { id: { in: created.map((a) => a.id) } }, data: { purchaseDocId: doc.id } });
    }
    if (input.origin === 'OPENING' && input.purpose !== 'FATTENING' && (input.lactationNo > 0 || input.sex === 'M') && cost > 0) {
      for (const a of created) await this.declareProductive(a.id, { date: input.acquisitionDate }, true);
    }
    await this.audit.record('Animal', batch, 'CREATE', undefined, { tags, origin: input.origin, cost });
    return { ids: created.map((a) => a.id), count: created.length };
  }

  async update(id: string, input: z.infer<typeof updateSchema>) {
    RequestCtx.assert('herd.animal.manage');
    const a = await this.own(id);
    const r = await this.prisma.animal.update({ where: { id: a.id }, data: { name: input.name ?? null, nationalId: input.nationalId ?? null, breed: input.breed ?? null, purpose: input.purpose, birthDate: input.birthDate ?? null, sire: input.sire ?? null, notes: input.notes ?? null, updatedById: RequestCtx.user().id } });
    await this.audit.record('Animal', a.id, 'UPDATE', a, r);
    return this.animal(a.id);
  }

  // ================================================================ weighings
  async weigh(input: z.infer<typeof weighSchema>) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const animals = await this.prisma.animal.findMany({ where: { companyId: u.companyId, id: { in: input.rows.map((r) => r.animalId) }, status: 'ACTIVE', deletedAt: null } });
    if (animals.length !== new Set(input.rows.map((r) => r.animalId)).size) throw invalid({ rows: 'An animal is not in the herd' });
    await this.prisma.$transaction(async (tx) => {
      for (const r of input.rows) {
        await tx.animalWeight.create({ data: { animalId: r.animalId, date: input.date, kg: D(r.kg), bcs: r.bcs === null || r.bcs === undefined ? null : D(r.bcs), createdById: u.id } });
        const a = animals.find((x) => x.id === r.animalId)!;
        if (!a.lastWeighDate || a.lastWeighDate <= input.date) await tx.animal.update({ where: { id: a.id }, data: { lastWeightKg: D(r.kg), lastWeighDate: input.date } });
      }
    });
    return { count: input.rows.length };
  }

  async deleteWeight(animalId: string, weightId: string) {
    RequestCtx.assert('herd.record');
    const a = await this.own(animalId);
    const w = await this.prisma.animalWeight.findFirst({ where: { id: weightId, animalId: a.id } });
    if (!w) throw new NotFoundException('Weighing not found');
    await this.prisma.animalWeight.delete({ where: { id: w.id } });
    const last = await this.prisma.animalWeight.findFirst({ where: { animalId: a.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    await this.prisma.animal.update({ where: { id: a.id }, data: { lastWeightKg: last?.kg ?? null, lastWeighDate: last?.date ?? null } });
    return { ok: true };
  }

  // ================================================================ events (reproduction, moves)
  /** reproduction state from the history of events (so an event can be added or removed in any order) */
  private async recompute(tx: Tx, a: Animal) {
    const c = await this.cfg(a.companyId);
    const events = await tx.animalEvent.findMany({ where: { animalId: a.id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    const s = { reproStatus: 'OPEN', lactating: false, lactationNo: 0, lastCalving: null as Date | null, lastService: null as Date | null, servicesSinceCalving: 0, expectedCalving: null as Date | null, dryOffDate: null as Date | null };
    for (const e of events) {
      if (e.type === 'SERVICE') {
        s.reproStatus = 'SERVED';
        s.lastService = e.date;
        s.servicesSinceCalving++;
        s.expectedCalving = addDays(e.date, c.gestationDays);
        s.dryOffDate = null;
      } else if (e.type === 'PREG_CHECK') {
        if (e.result === 'POSITIVE') {
          s.reproStatus = 'PREGNANT';
          s.expectedCalving = s.lastService ? addDays(s.lastService, c.gestationDays) : s.expectedCalving;
          s.dryOffDate = s.expectedCalving && a.purpose === 'DAIRY' ? addDays(s.expectedCalving, -c.dryOffDays) : null;
        } else {
          s.reproStatus = 'OPEN';
          s.expectedCalving = null;
          s.dryOffDate = null;
        }
      } else if (e.type === 'CALVING') {
        const opening = (e.data as { opening?: boolean; lactationNo?: number; lactating?: boolean } | null) ?? null;
        s.lactationNo = opening?.opening ? opening.lactationNo ?? s.lactationNo + 1 : s.lactationNo + 1;
        s.lastCalving = e.date;
        s.lactating = a.purpose === 'DAIRY' && (opening?.opening ? opening.lactating !== false : true);
        s.reproStatus = 'OPEN';
        s.servicesSinceCalving = 0;
        s.expectedCalving = null;
        s.dryOffDate = null;
      } else if (e.type === 'ABORTION') {
        s.reproStatus = 'OPEN';
        s.expectedCalving = null;
        s.dryOffDate = null;
      } else if (e.type === 'DRY_OFF') s.lactating = false;
    }
    await tx.animal.update({ where: { id: a.id }, data: s });
  }

  async addEvent(id: string, input: z.infer<typeof eventSchema>) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    const res = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, [id]);
      const a = await this.own(id, tx);
      if (a.status !== 'ACTIVE') throw new ConflictException('The animal has left the herd');
      if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
      if (input.date < (a.birthDate ?? a.acquisitionDate) && a.origin !== 'OPENING') throw invalid({ date: 'Before the animal was born / arrived' });
      const repro = ['HEAT', 'SERVICE', 'PREG_CHECK', 'CALVING', 'ABORTION', 'DRY_OFF'].includes(input.type);
      if (repro && a.sex !== 'F') throw invalid({ type: 'Only for females' });
      if (input.type === 'SERVICE' && !['AI', 'NATURAL'].includes(input.method ?? '')) throw invalid({ method: 'Artificial insemination or natural service' });
      if (input.type === 'PREG_CHECK' && !['POSITIVE', 'NEGATIVE'].includes(input.result ?? '')) throw invalid({ result: 'Pregnant or not' });
      if (input.type === 'PREG_CHECK' && !a.lastService) throw invalid({ type: 'Record the service first' });
      if (input.type === 'DRY_OFF' && !a.lactating) throw invalid({ type: 'The cow is not in milk' });
      let fromUnitId: string | null = null;
      if (input.type === 'MOVE') {
        if (!input.toUnitId) throw invalid({ toUnitId: 'Where to' });
        const unit = await tx.farmUnit.findFirst({ where: { id: input.toUnitId, companyId: u.companyId, deletedAt: null } });
        if (!unit) throw invalid({ toUnitId: 'Pen not found' });
        if (unit.id === a.unitId) throw invalid({ toUnitId: 'Already there' });
        fromUnitId = a.unitId;
        await tx.animal.update({ where: { id: a.id }, data: { unitId: unit.id, siteId: unit.siteId } });
      }
      const calfIds: string[] = [];
      if (input.type === 'CALVING') {
        if (!['LIVE', 'STILLBORN'].includes(input.result ?? 'LIVE')) throw invalid({ result: 'Live or stillborn' });
        if (input.result !== 'STILLBORN' && !input.calves.length) throw invalid({ calves: 'Tag the calf (or record a stillbirth)' });
        const tags = input.calves.map((x) => x.tagNo.toUpperCase());
        const taken = await tx.animal.findMany({ where: { companyId: u.companyId, tagNo: { in: tags } }, select: { tagNo: true } });
        if (taken.length) throw invalid({ calves: `Tag already used: ${taken.map((t) => t.tagNo).join(', ')}` });
        const sire = (await tx.animalEvent.findFirst({ where: { animalId: a.id, type: 'SERVICE' }, orderBy: { date: 'desc' } }))?.sire ?? null;
        for (const cv of input.calves) {
          const calf = await tx.animal.create({
            data: {
              companyId: u.companyId,
              branchId: a.branchId,
              tagNo: cv.tagNo.toUpperCase(),
              species: a.species,
              breed: a.breed,
              sex: cv.sex,
              purpose: cv.purpose ?? (cv.sex === 'F' ? a.purpose : 'FATTENING'),
              birthDate: input.date,
              birthWeightKg: cv.birthWeightKg ?? null,
              origin: 'BORN',
              damId: a.id,
              sire,
              siteId: a.siteId,
              unitId: a.unitId,
              acquisitionDate: input.date,
              lastWeightKg: cv.birthWeightKg ?? null,
              lastWeighDate: cv.birthWeightKg ? input.date : null,
              createdById: u.id,
            },
          });
          if (cv.birthWeightKg) await tx.animalWeight.create({ data: { animalId: calf.id, date: input.date, kg: D(cv.birthWeightKg), notes: 'Birth weight', createdById: u.id } });
          calfIds.push(calf.id);
        }
      }
      const ev = await tx.animalEvent.create({
        data: {
          animalId: a.id,
          date: input.date,
          type: input.type,
          method: input.method ?? null,
          sire: input.sire ?? null,
          technician: input.technician ?? null,
          result: input.type === 'CALVING' ? input.result ?? 'LIVE' : input.result ?? null,
          fromUnitId,
          toUnitId: input.toUnitId ?? null,
          data: calfIds.length ? ({ calves: calfIds } as Prisma.InputJsonValue) : Prisma.JsonNull,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
      if (repro) await this.recompute(tx, a);
      return { ev, a, calfIds };
    });
    // the first calving makes a breeding / dairy cow productive
    if (input.type === 'CALVING' && !res.a.fixedAssetId && res.a.purpose !== 'FATTENING') await this.declareProductive(id, { date: input.date }, true);
    await this.audit.record('Animal', id, `EVENT_${input.type}`, undefined, { date: iso(input.date), calves: res.calfIds.length });
    return this.animal(id);
  }

  /** removes the last event of an animal (not a calving: its calves exist) */
  async deleteEvent(id: string, eventId: string) {
    RequestCtx.assert('herd.record');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, [id]);
      const a = await this.own(id, tx);
      const last = await tx.animalEvent.findFirst({ where: { animalId: a.id, type: { not: 'PRODUCTIVE' } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      if (!last || last.id !== eventId) throw new ConflictException('Only the last event can be removed');
      if (last.type === 'CALVING') throw new ConflictException('A calving cannot be removed: its calves are in the herd');
      if (last.type === 'MOVE') await tx.animal.update({ where: { id: a.id }, data: { unitId: last.fromUnitId } });
      await tx.animalEvent.delete({ where: { id: last.id } });
      await this.recompute(tx, a);
    });
    await this.audit.record('Animal', id, 'EVENT_DELETE', undefined, { eventId });
    return this.animal(id);
  }

  // ================================================================ productive animals
  /**
   * Puts a breeding / dairy animal into production: its carried cost becomes a fixed asset (productive livestock)
   * depreciated over its productive life down to its expected cull value.
   */
  async declareProductive(id: string, input: z.infer<typeof productiveSchema>, auto = false) {
    if (!auto) RequestCtx.assert('herd.animal.manage');
    const u = RequestCtx.user();
    const c = await this.cfg(u.companyId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, [id]);
      const a = await this.own(id, tx);
      if (a.fixedAssetId) throw new ConflictException('Already productive');
      if (a.purpose === 'FATTENING') throw new ConflictException('A fattening animal is sold, not put into production');
      if (a.status !== 'ACTIVE') throw new ConflictException('The animal has left the herd');
      if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
      const later = await tx.animalCost.count({ where: { animalId: a.id, capitalised: true, date: { gt: input.date } } });
      if (later) throw invalid({ date: 'Cost after this date was capitalised to the animal: choose a later date' });
      const cost = D(a.carryingCost);
      let assetId: string | null = null;
      if (cost.gt(0)) {
        const salvage = input.salvageValue !== null && input.salvageValue !== undefined ? D(input.salvageValue) : round(cost.times(c.salvagePct).div(100));
        if (salvage.gt(cost)) throw invalid({ salvageValue: 'Cull value above the cost' });
        const assetAcc = await this.journal.mapping(tx, u.companyId, 'BIO_MATURE');
        const depAcc = await this.journal.mapping(tx, u.companyId, 'HERD_DEPRECIATION');
        const accum = await this.journal.mapping(tx, u.companyId, 'ACCUM_DEPRECIATION');
        const code = await this.sequence.next('ASSET', u.companyId, input.date, tx);
        const asset = await tx.fixedAsset.create({
          data: {
            companyId: u.companyId,
            branchId: a.branchId,
            code,
            name: `${a.purpose === 'DAIRY' ? 'Dairy' : 'Breeding'} ${a.sex === 'F' ? 'cow' : 'bull'} ${a.tagNo}${a.breed ? ` (${a.breed})` : ''}`.slice(0, 200),
            location: a.tagNo,
            acquisitionDate: input.date,
            depreciationStartDate: input.date,
            cost,
            salvageValue: salvage,
            usefulLifeMonths: input.usefulLifeMonths ?? c.lifeMonths,
            methodCode: 'STRAIGHT_LINE',
            taxGroupCode: 'K2',
            assetAccountId: assetAcc,
            accumDepAccountId: accum,
            depExpenseAccountId: depAcc,
            notes: `Productive livestock ${a.tagNo}: rearing / purchase cost ${cost.toString()} carried until ${iso(input.date)}; depreciated to its expected cull value. Tax (PMK 72/2023 Art. 12-15): group 2, 8 years straight line from the month sales begin; labour is not part of the fiscal cost.`,
            createdById: u.id,
          },
        });
        assetId = asset.id;
        await this.journal.post(tx, {
          companyId: u.companyId,
          branchId: a.branchId,
          date: input.date,
          description: `Animal ${a.tagNo} productive: cost to productive livestock`,
          reference: code,
          sourceType: 'HPROD',
          sourceId: a.id,
          lines: [
            { accountId: assetAcc, debit: cost, description: a.tagNo },
            { key: 'BIO_ASSET', credit: cost, description: a.tagNo },
          ],
        });
      }
      await tx.animal.update({ where: { id: a.id }, data: { fixedAssetId: assetId, productiveDate: input.date, carryingCost: D(0), updatedById: u.id } });
      await tx.animalEvent.create({ data: { animalId: a.id, date: input.date, type: 'PRODUCTIVE', notes: assetId ? `Fixed asset for ${Number(cost).toLocaleString('id-ID')}` : 'No cost carried', createdById: u.id } });
    });
    if (!auto) await this.audit.record('Animal', id, 'PRODUCTIVE');
    return this.animal(id);
  }

  // ================================================================ health
  async treat(input: z.infer<typeof treatSchema>) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    if (input.productId && !input.warehouseId) throw invalid({ warehouseId: 'Which store the medicine comes from' });
    if (input.productId && !(input.qtyPerHead > 0)) throw invalid({ qtyPerHead: 'How much per head' });
    const batch = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.animalIds);
      const animals = await tx.animal.findMany({ where: { companyId: u.companyId, id: { in: input.animalIds }, status: 'ACTIVE', deletedAt: null } });
      if (animals.length !== new Set(input.animalIds).size) throw invalid({ animalIds: 'An animal is not in the herd' });
      let cost = D(0);
      const qty = D(input.qtyPerHead).times(animals.length);
      if (input.productId) {
        const p = await tx.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } });
        if (!p || p.type !== 'STOCK') throw invalid({ productId: 'Choose a stock product' });
        if (p.trackLots) {
          await this.lots.ensureOpening(tx, u.companyId, p.id, input.warehouseId!);
          await this.lots.issue(tx, { companyId: u.companyId, documentId: batch, lineId: batch, productId: p.id, warehouseId: input.warehouseId!, qty });
        }
        const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: u.branchId ?? null, productId: p.id, productName: p.name, warehouseId: input.warehouseId!, date: input.date, qty: qty.neg(), docType: 'HTRT', documentId: batch, documentNumber: input.description.slice(0, 40), allowNegative: await this.settings.bool('inventory.allowNegativeStock', u.companyId, false) });
        cost = round(mv.totalCost.abs());
      }
      const each = animals.length ? round(cost.div(animals.length)) : D(0);
      for (const [i, a] of animals.entries()) {
        const share = i === animals.length - 1 ? cost.minus(each.times(animals.length - 1)) : each;
        await tx.animalTreatment.create({
          data: { animalId: a.id, companyId: u.companyId, date: input.date, kind: input.kind, description: input.description, diagnosis: input.diagnosis ?? null, productId: input.productId ?? null, qty: D(input.qtyPerHead), cost: share, milkWithdrawalDays: input.milkWithdrawalDays, meatWithdrawalDays: input.meatWithdrawalDays, vet: input.vet ?? null, batchId: batch, notes: input.notes ?? null, createdById: u.id },
        });
        const milkUntil = input.milkWithdrawalDays ? addDays(input.date, input.milkWithdrawalDays) : null;
        const meatUntil = input.meatWithdrawalDays ? addDays(input.date, input.meatWithdrawalDays) : null;
        await tx.animal.update({
          where: { id: a.id },
          data: {
            ...(milkUntil && (!a.milkWithdrawalUntil || a.milkWithdrawalUntil < milkUntil) ? { milkWithdrawalUntil: milkUntil } : {}),
            ...(meatUntil && (!a.meatWithdrawalUntil || a.meatWithdrawalUntil < meatUntil) ? { meatWithdrawalUntil: meatUntil } : {}),
          },
        });
      }
      await this.charge(tx, animals, cost, input.date, 'HEALTH', 'HTRT', batch, 'INVENTORY', `${input.kind.toLowerCase()}: ${input.description}`);
    });
    await this.audit.record('Animal Treatment', batch, 'CREATE', undefined, { heads: input.animalIds.length, description: input.description });
    return { batchId: batch };
  }

  /** treatments in a period (the register the vet / dinas asks for) */
  async treatments(q: { from: string; to: string }) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.animalTreatment.findMany({ where: { companyId, date: { gte: new Date(q.from), lte: new Date(q.to) } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 3000 });
    const animals = new Map((await this.prisma.animal.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.animalId))] } }, select: { id: true, tagNo: true } })).map((a) => [a.id, a.tagNo]));
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, qty: n(r.qty), cost: n(r.cost), tagNo: animals.get(r.animalId) ?? '', product: r.productId ? products.get(r.productId) ?? null : null, milkUntil: r.milkWithdrawalDays ? addDays(r.date, r.milkWithdrawalDays) : null, meatUntil: r.meatWithdrawalDays ? addDays(r.date, r.meatWithdrawalDays) : null }));
  }

  // ================================================================ feeding by pen
  async feedings(q: { from?: string; to?: string; unitId?: string }) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.herdFeeding.findMany({
      where: { companyId, ...(q.unitId ? { unitId: q.unitId } : {}), ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId }, select: { id: true, code: true, name: true } })).map((u) => [u.id, u]));
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, qty: n(r.qty), cost: n(r.cost), unit: units.get(r.unitId) ?? null, product: products.get(r.productId) ?? '' }));
  }

  /** feed given to a pen: issued from the store, its cost shared equally by the animals in the pen that day */
  async feed(input: z.infer<typeof feedSchema>) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const unit = await this.prisma.farmUnit.findFirst({ where: { id: input.unitId, companyId: u.companyId, deletedAt: null } });
    if (!unit) throw invalid({ unitId: 'Pen not found' });
    const p = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } });
    if (!p || p.type !== 'STOCK') throw invalid({ productId: 'Choose a stock product' });
    const row = await this.prisma.$transaction(async (tx) => {
      const animals = await tx.animal.findMany({ where: { companyId: u.companyId, unitId: unit.id, status: 'ACTIVE', deletedAt: null, acquisitionDate: { lte: input.date } } });
      if (!animals.length) throw invalid({ unitId: 'No animals in this pen on that day' });
      await this.lock(tx, animals.map((a) => a.id));
      const id = randomUUID();
      const number = await this.sequence.next('HERD_FEED', u.companyId, input.date, tx);
      if (p.trackLots) {
        await this.lots.ensureOpening(tx, u.companyId, p.id, input.warehouseId);
        await this.lots.issue(tx, { companyId: u.companyId, documentId: id, lineId: id, productId: p.id, warehouseId: input.warehouseId, qty: D(input.qty) });
      }
      const mv = await this.inventory.move(tx, { companyId: u.companyId, branchId: u.branchId ?? null, productId: p.id, productName: p.name, warehouseId: input.warehouseId, date: input.date, qty: D(input.qty).neg(), docType: 'HFEED', documentId: id, documentNumber: number, allowNegative: await this.settings.bool('inventory.allowNegativeStock', u.companyId, false) });
      const cost = round(mv.totalCost.abs());
      await this.charge(tx, animals, cost, input.date, 'FEED', 'HFEED', id, 'INVENTORY', `Feed ${number} ${unit.name}: ${p.name}`);
      return tx.herdFeeding.create({ data: { id, companyId: u.companyId, branchId: u.branchId ?? null, number, date: input.date, unitId: unit.id, productId: p.id, warehouseId: input.warehouseId, qty: D(input.qty), cost, heads: animals.length, notes: input.notes ?? null, createdById: u.id } });
    });
    await this.audit.record('Herd Feeding', row.id, 'CREATE', undefined, { number: row.number, heads: row.heads, cost: n(row.cost) });
    return { ...row, qty: n(row.qty), cost: n(row.cost) };
  }

  async cancelFeeding(id: string) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    await this.prisma.$transaction(async (tx) => {
      const f = await tx.herdFeeding.findFirst({ where: { id, companyId: u.companyId } });
      if (!f) throw new NotFoundException('Feeding not found');
      if (f.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      await this.uncharge(tx, 'HFEED', f.id);
      await this.inventory.reverse(tx, f.id, true);
      await this.lots.reverse(tx, f.id);
      await tx.herdFeeding.update({ where: { id: f.id }, data: { status: 'CANCELLED', updatedById: u.id } });
    });
    await this.audit.record('Herd Feeding', id, 'CANCEL');
    return { ok: true };
  }

  // ================================================================ exits (sale, cull, death)
  /**
   * Animals leave the herd: their carried cost (or the book value of a productive animal) goes to cost of sales
   * (sale / cull) or to abnormal loss (death); sold / culled animals get a draft sales invoice, exempt from PPN
   * (PP 49/2022). The meat withdrawal period blocks a sale unless a reason is given.
   */
  async exit(input: z.infer<typeof exitSchema>) {
    RequestCtx.assert('herd.exit');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const selling = input.type !== 'DEATH' && !!input.customerId;
    if (selling && !(await this.prisma.customer.findFirst({ where: { id: input.customerId!, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Customer not found' });
    if (selling && !input.pricePerKg && !input.pricePerHead) throw invalid({ pricePerKg: 'Enter the price per kg or per head' });
    const product = selling ? await this.product('LIVESTOCK-OUT', 'Live animals sold', { incomeKey: 'SALES' }) : null;
    const sold = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.animalIds);
      const animals = await tx.animal.findMany({ where: { companyId: u.companyId, id: { in: input.animalIds }, deletedAt: null } });
      if (animals.length !== new Set(input.animalIds).size) throw invalid({ animalIds: 'Animal not found' });
      const out: { a: Animal; kg: number | null; value: number | null; cost: Prisma.Decimal }[] = [];
      for (const a of animals) {
        if (a.status !== 'ACTIVE') throw new ConflictException(`${a.tagNo} has already left the herd`);
        if (input.type !== 'DEATH' && a.meatWithdrawalUntil && a.meatWithdrawalUntil >= input.date && !input.overrideWithdrawal) throw invalid({ overrideWithdrawal: `${a.tagNo} is in a drug withdrawal period until ${iso(a.meatWithdrawalUntil)}` });
        if (input.date < a.acquisitionDate) throw invalid({ date: `Before ${a.tagNo} arrived` });
        const kg = input.weights[a.id] ?? (a.lastWeightKg ? n(a.lastWeightKg) : null);
        if (selling && input.pricePerKg && !kg) throw invalid({ weights: `Weight of ${a.tagNo}` });
        const value = selling ? (input.pricePerKg ? Math.round(kg! * input.pricePerKg) : input.pricePerHead!) : null;
        // cost leaving the herd
        let cost = D(a.carryingCost);
        const lines: PostingLine[] = [];
        const outKey = input.type === 'DEATH' ? 'ABNORMAL_LOSS' : 'COGS';
        if (a.fixedAssetId) {
          const fa = await tx.fixedAsset.findUniqueOrThrow({ where: { id: a.fixedAssetId } });
          const accum = D(fa.accumulatedDepreciation);
          cost = D(fa.cost).minus(accum);
          if (accum.gt(0)) lines.push({ accountId: fa.accumDepAccountId, key: fa.accumDepAccountId ? undefined : 'ACCUM_DEPRECIATION', debit: accum, description: a.tagNo });
          if (cost.gt(0)) lines.push({ key: outKey, debit: cost, description: `${a.tagNo} book value` });
          lines.push({ accountId: fa.assetAccountId, key: fa.assetAccountId ? undefined : 'BIO_MATURE', credit: D(fa.cost), description: a.tagNo });
          await tx.fixedAsset.update({ where: { id: fa.id }, data: { statusCode: 'DISPOSED', disposalDate: input.date, disposalAmount: value !== null ? D(value) : D(0) } });
        } else if (cost.gt(0)) {
          lines.push({ key: outKey, debit: cost, description: a.tagNo }, { key: 'BIO_ASSET', credit: cost, description: a.tagNo });
        }
        if (lines.length > 1) await this.journal.post(tx, { companyId: u.companyId, branchId: a.branchId, date: input.date, description: `${input.type === 'SALE' ? 'Sale' : input.type === 'CULL' ? 'Cull' : 'Death'} of ${a.tagNo}`, reference: a.tagNo, sourceType: 'HEXIT', sourceId: a.id, lines });
        await tx.animal.update({
          where: { id: a.id },
          data: { status: input.type === 'SALE' ? 'SOLD' : input.type === 'CULL' ? 'CULLED' : 'DEAD', exitDate: input.date, exitReason: input.reason ?? input.overrideWithdrawal ?? null, exitWeightKg: kg !== null ? D(kg) : null, exitValue: value !== null ? D(value) : null, exitCost: cost, carryingCost: D(0), lactating: false, customerId: selling ? input.customerId! : null, updatedById: u.id },
        });
        out.push({ a, kg, value, cost });
      }
      return out;
    });
    let doc: { id: string; number: string } | null = null;
    if (selling && product) {
      const tax = await this.exemptTax(u.companyId);
      doc = (await this.documents.create(
        'SI',
        {
          date: input.date,
          customerId: input.customerId!,
          reference: sold.length === 1 ? sold[0].a.tagNo : `${sold.length} head`,
          notes: `Live animals: ${sold.map((s) => s.a.tagNo).join(', ')}. Exempt from PPN (PP 49/2022, faktur code 08). Movement needs the animal health certificate (SKKH); across a regency / province also the Sertifikat Veteriner (valid 30 days) and the entry / exit recommendations (Permentan 17/2023).`,
          lines: sold.map((s) =>
            input.pricePerKg
              ? { productId: product.id, description: `${s.a.tagNo} ${s.a.breed ?? s.a.species.toLowerCase()} ${s.kg} kg live weight`, qty: s.kg!, unitPrice: input.pricePerKg, taxId: tax?.id }
              : { productId: product.id, description: `${s.a.tagNo} ${s.a.breed ?? s.a.species.toLowerCase()}`, qty: 1, unitPrice: input.pricePerHead!, taxId: tax?.id },
          ),
        },
        undefined,
        { skipPermission: true },
      )) as { id: string; number: string };
      await this.prisma.animal.updateMany({ where: { id: { in: sold.map((s) => s.a.id) } }, data: { saleDocId: doc.id } });
    }
    await this.audit.record('Animal', sold[0].a.id, `EXIT_${input.type}`, undefined, { tags: sold.map((s) => s.a.tagNo), invoice: doc?.number });
    return { count: sold.length, invoice: doc, cost: sold.reduce((x, s) => x + n(s.cost), 0), value: sold.reduce((x, s) => x + (s.value ?? 0), 0) };
  }

  /** brings an animal back (exit recorded by mistake) while its sales invoice is still a draft or gone */
  async cancelExit(id: string) {
    RequestCtx.assert('herd.exit');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, [id]);
      const a = await this.own(id, tx);
      if (a.status === 'ACTIVE') throw new ConflictException('The animal is in the herd');
      if (a.saleDocId) {
        const doc = await tx.tradeDocument.findUnique({ where: { id: a.saleDocId } });
        if (doc && !doc.deletedAt && doc.status !== 'DRAFT' && doc.status !== 'CANCELLED') throw new ConflictException(`Invoice ${doc.number} is confirmed: cancel it first`);
        const others = await tx.animal.count({ where: { saleDocId: a.saleDocId, id: { not: a.id }, status: { not: 'ACTIVE' } } });
        if (doc && !doc.deletedAt && doc.status === 'DRAFT') {
          const onIt = await tx.tradeDocumentLine.count({ where: { documentId: doc.id, description: { startsWith: `${a.tagNo} ` } } });
          if (others && onIt) throw new ConflictException(`Draft invoice ${doc.number} also sells other animals: take ${a.tagNo} off it (or delete it) first`);
          if (!others) await tx.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
        }
      }
      await this.journal.voidBySource(tx, 'HEXIT', a.id);
      if (a.fixedAssetId) await tx.fixedAsset.update({ where: { id: a.fixedAssetId }, data: { statusCode: 'ACTIVE', disposalDate: null, disposalAmount: null } });
      await tx.animal.update({ where: { id: a.id }, data: { status: 'ACTIVE', carryingCost: a.fixedAssetId ? D(0) : D(a.exitCost ?? 0), exitDate: null, exitReason: null, exitWeightKg: null, exitValue: null, exitCost: null, saleDocId: null, customerId: null, updatedById: RequestCtx.user().id } });
    });
    await this.audit.record('Animal', id, 'EXIT_CANCEL');
    return this.animal(id);
  }

  // ================================================================ milk
  /** milking sheet of a day: cows in milk with what is recorded and their withdrawal period */
  async milkSheet(dateStr: string) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Choose a date');
    const cows = await this.prisma.animal.findMany({ where: { companyId, deletedAt: null, sex: 'F', status: 'ACTIVE', lactating: true }, orderBy: { tagNo: 'asc' } });
    const recs = await this.prisma.milkRecord.findMany({ where: { companyId, date } });
    const recorded = await this.prisma.animal.findMany({ where: { id: { in: recs.map((r) => r.animalId).filter((id) => !cows.some((c) => c.id === id)) } } });
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return [...cows, ...recorded].map((a) => {
      const am = recs.find((r) => r.animalId === a.id && r.session === 'AM');
      const pm = recs.find((r) => r.animalId === a.id && r.session === 'PM');
      return {
        id: a.id,
        tagNo: a.tagNo,
        name: a.name,
        unit: a.unitId ? units.get(a.unitId) ?? null : null,
        daysInMilk: a.lastCalving ? daysBetween(a.lastCalving, date) : null,
        lactationNo: a.lactationNo,
        am: am ? n(am.liters) : null,
        pm: pm ? n(pm.liters) : null,
        withdrawal: a.milkWithdrawalUntil && a.milkWithdrawalUntil >= date ? a.milkWithdrawalUntil : null,
      };
    });
  }

  async recordMilk(input: z.infer<typeof milkRecordSchema>) {
    RequestCtx.assert('herd.record');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    const animals = await this.prisma.animal.findMany({ where: { companyId: u.companyId, id: { in: input.rows.map((r) => r.animalId) }, sex: 'F', deletedAt: null } });
    if (animals.length !== new Set(input.rows.map((r) => r.animalId)).size) throw invalid({ rows: 'Only cows can be milked' });
    await this.prisma.$transaction(async (tx) => {
      for (const r of input.rows) {
        const a = animals.find((x) => x.id === r.animalId)!;
        const discarded = !!a.milkWithdrawalUntil && a.milkWithdrawalUntil >= input.date;
        if (r.liters === 0) {
          await tx.milkRecord.deleteMany({ where: { animalId: a.id, date: input.date, session: input.session } });
          continue;
        }
        await tx.milkRecord.upsert({
          where: { animalId_date_session: { animalId: a.id, date: input.date, session: input.session } },
          create: { companyId: u.companyId, animalId: a.id, date: input.date, session: input.session, liters: D(r.liters), discarded, createdById: u.id },
          update: { liters: D(r.liters), discarded },
        });
      }
    });
    return { count: input.rows.length };
  }

  /** milk per day in a period: produced, thrown away (withdrawal), delivered, cows milked */
  async milkSummary(q: { from: string; to: string }) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const from = new Date(q.from);
    const to = new Date(q.to);
    const recs = await this.prisma.milkRecord.findMany({ where: { companyId, date: { gte: from, lte: to } }, select: { date: true, animalId: true, liters: true, discarded: true } });
    const del = await this.prisma.milkDelivery.findMany({ where: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, select: { date: true, liters: true, rejected: true, amount: true } });
    const days = new Map<string, { produced: number; discarded: number; cows: Set<string>; delivered: number; rejected: number; amount: number }>();
    const day = (d: Date) => {
      const k = iso(d);
      if (!days.has(k)) days.set(k, { produced: 0, discarded: 0, cows: new Set(), delivered: 0, rejected: 0, amount: 0 });
      return days.get(k)!;
    };
    for (const r of recs) {
      const d = day(r.date);
      d.produced += n(r.liters);
      if (r.discarded) d.discarded += n(r.liters);
      d.cows.add(r.animalId);
    }
    for (const r of del) {
      const d = day(r.date);
      if (r.rejected) d.rejected += n(r.liters);
      else d.delivered += n(r.liters);
      d.amount += n(r.amount);
    }
    return [...days.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, d]) => ({ date, produced: Math.round(d.produced * 100) / 100, discarded: Math.round(d.discarded * 100) / 100, cows: d.cows.size, perCow: d.cows.size ? Math.round((d.produced / d.cows.size) * 100) / 100 : null, delivered: d.delivered, rejected: d.rejected, amount: d.amount }));
  }

  async schemes(customerId?: string) {
    RequestCtx.assert('herd.read');
    const rows = await this.prisma.milkPriceScheme.findMany({ where: { companyId: RequestCtx.companyId(), deletedAt: null, ...(customerId ? { customerId } : {}) }, orderBy: { effectiveDate: 'desc' } });
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...this.schemeOut(r), id: r.id, customerId: r.customerId, customer: cust.get(r.customerId) ?? '', effectiveDate: r.effectiveDate, notes: r.notes }));
  }

  private schemeOut(r: Prisma.MilkPriceSchemeGetPayload<object>): MilkScheme {
    return { basePrice: n(r.basePrice), fatStd: n(r.fatStd), fatStep: n(r.fatStep), tsStd: n(r.tsStd), tsStep: n(r.tsStep), tpcGrades: (r.tpcGrades as { maxTpc: number; adj: number }[] | null) ?? null };
  }

  async saveScheme(input: z.infer<typeof schemeSchema>) {
    RequestCtx.assert('herd.milk.sell');
    const u = RequestCtx.user();
    if (!(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Customer not found' });
    const r = await this.prisma.milkPriceScheme.create({ data: { companyId: u.companyId, customerId: input.customerId, effectiveDate: input.effectiveDate, basePrice: D(input.basePrice), fatStd: D(input.fatStd), fatStep: D(input.fatStep), tsStd: D(input.tsStd), tsStep: D(input.tsStep), tpcGrades: input.tpcGrades.length ? (input.tpcGrades.sort((a, b) => a.maxTpc - b.maxTpc) as Prisma.InputJsonValue) : Prisma.DbNull, notes: input.notes ?? null, createdById: u.id } });
    await this.audit.record('Milk Price Scheme', r.id, 'CREATE', undefined, { customerId: input.customerId, base: input.basePrice });
    return { id: r.id };
  }

  async deleteScheme(id: string) {
    RequestCtx.assert('herd.milk.sell');
    const r = await this.prisma.milkPriceScheme.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!r) throw new NotFoundException('Price scheme not found');
    await this.prisma.milkPriceScheme.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** price of a delivery by the buyer's scheme of the day */
  async quote(customerId: string, date: Date, q: { fat?: number | null; snf?: number | null; ts?: number | null; tpc?: number | null }) {
    const s = await this.prisma.milkPriceScheme.findFirst({ where: { companyId: RequestCtx.companyId(), customerId, deletedAt: null, effectiveDate: { lte: date } }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
    return s ? { schemeId: s.id, ...milkPrice(this.schemeOut(s), q) } : null;
  }

  async deliveries(q: { from?: string; to?: string; customerId?: string }) {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.milkDelivery.findMany({ where: { companyId, ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.from || q.to ? { date: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 2000 });
    const cust = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const inv = await this.liveDocs(rows.map((r) => r.invoiceDocId));
    return rows.map((r) => ({ ...r, liters: n(r.liters), fat: r.fat === null ? null : n(r.fat), snf: r.snf === null ? null : n(r.snf), ts: r.ts === null ? null : n(r.ts), protein: r.protein === null ? null : n(r.protein), tpc: r.tpc === null ? null : n(r.tpc), density: r.density === null ? null : n(r.density), pricePerLiter: n(r.pricePerLiter), amount: n(r.amount), customer: cust.get(r.customerId) ?? '', invoice: r.invoiceDocId ? inv.get(r.invoiceDocId) ?? null : null }));
  }

  private async liveDocs(ids: (string | null)[]) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, { id: string; number: string; status: string }>();
    return new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: list }, deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]));
  }

  async createDelivery(input: z.infer<typeof deliverySchema>) {
    RequestCtx.assert('herd.milk.sell');
    const u = RequestCtx.user();
    if (input.date > todayDate()) throw invalid({ date: 'Cannot be in the future' });
    if (!(await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ customerId: 'Customer not found' });
    const quoted = await this.quote(input.customerId, input.date, input);
    const price = input.rejected ? 0 : input.pricePerLiter ?? quoted?.price ?? null;
    if (price === null) throw invalid({ pricePerLiter: 'No price scheme for this buyer: enter the price or set the scheme' });
    const amount = round(D(input.liters).times(price));
    const row = await this.prisma.$transaction(async (tx) =>
      tx.milkDelivery.create({
        data: {
          companyId: u.companyId,
          branchId: u.branchId ?? null,
          number: await this.sequence.next('MILK_DELIVERY', u.companyId, input.date, tx),
          date: input.date,
          session: input.session,
          customerId: input.customerId,
          liters: D(input.liters),
          fat: input.fat ?? null,
          snf: input.snf ?? null,
          ts: input.ts ?? (input.fat !== null && input.fat !== undefined && input.snf !== null && input.snf !== undefined ? Math.round((input.fat + input.snf) * 100) / 100 : null),
          protein: input.protein ?? null,
          tpc: input.tpc ?? null,
          density: input.density ?? null,
          alcoholTest: input.alcoholTest ?? null,
          rejected: input.rejected,
          pricePerLiter: D(price),
          priceDetail: quoted && (input.pricePerLiter === null || input.pricePerLiter === undefined) && !input.rejected ? (quoted as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          amount,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      }),
    );
    await this.audit.record('Milk Delivery', row.id, 'CREATE', undefined, { number: row.number, liters: input.liters, price });
    return { ...row, liters: n(row.liters), pricePerLiter: n(row.pricePerLiter), amount: n(row.amount), quote: quoted };
  }

  async cancelDelivery(id: string) {
    RequestCtx.assert('herd.milk.sell');
    const r = await this.prisma.milkDelivery.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!r) throw new NotFoundException('Delivery not found');
    if (r.status === 'CANCELLED') throw new ConflictException('Already cancelled');
    if (r.invoiceDocId && (await this.liveDocs([r.invoiceDocId])).size) throw new ConflictException('The delivery is on an invoice: cancel or delete it first');
    await this.prisma.milkDelivery.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Milk Delivery', id, 'CANCEL');
    return { ok: true };
  }

  /** one draft sales invoice for the open milk deliveries of a buyer in a period (fresh milk exempt from PPN) */
  async settleMilk(input: z.infer<typeof milkSettleSchema>) {
    RequestCtx.assert('herd.milk.sell');
    const u = RequestCtx.user();
    const rows = await this.prisma.milkDelivery.findMany({ where: { companyId: u.companyId, customerId: input.customerId, status: 'POSTED', rejected: false, date: { gte: input.from, lte: input.to } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] });
    const live = await this.liveDocs(rows.map((r) => r.invoiceDocId));
    const open = rows.filter((r) => !r.invoiceDocId || !live.has(r.invoiceDocId));
    if (!open.length) throw new BadRequestException('No uninvoiced milk to this buyer in the period');
    const product = await this.product('MILK-FRESH', 'Fresh milk (litre)', { incomeKey: 'SALES' });
    const tax = await this.exemptTax(u.companyId);
    const liters = open.reduce((a, r) => a + n(r.liters), 0);
    const doc = (await this.documents.create(
      'SI',
      {
        date: input.date ?? input.to,
        customerId: input.customerId,
        reference: `Milk ${iso(input.from)} - ${iso(input.to)}`,
        notes: `Fresh milk ${iso(input.from)} to ${iso(input.to)}: ${open.length} deliveries, ${liters.toLocaleString('en-US')} litres, priced on the quality tested at each delivery. Fresh / pasteurised milk without additions is exempt from PPN (PP 49/2022, faktur code 08). A milk processor buying above Rp20 million a month collects PPh 22 0.25% (PMK 51/2025): ask for the bukti pungut.`,
        lines: open.map((r) => ({ productId: product.id, description: `${r.number} ${iso(r.date)}${r.session !== 'DAY' ? ` ${r.session}` : ''}${r.fat !== null ? ` fat ${n(r.fat)}%` : ''}${r.ts !== null ? ` TS ${n(r.ts)}%` : ''}${r.tpc !== null ? ` TPC ${n(r.tpc).toLocaleString('en-US')}` : ''}`, qty: n(r.liters), unitPrice: n(r.pricePerLiter), taxId: tax?.id })),
      },
      undefined,
      { skipPermission: true },
    )) as { id: string; number: string };
    await this.prisma.milkDelivery.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { invoiceDocId: doc.id } });
    await this.audit.record('Milk Delivery', doc.id, 'SETTLE', undefined, { customerId: input.customerId, deliveries: open.length, invoice: doc.number });
    return { id: doc.id, number: doc.number, deliveries: open.length, liters, amount: open.reduce((a, r) => a + n(r.amount), 0) };
  }

  // ================================================================ overview, breeding board, fattening
  async overview() {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const c = await this.cfg(companyId);
    const today = todayDate();
    const herd = await this.prisma.animal.findMany({ where: { companyId, status: 'ACTIVE', deletedAt: null } });
    const females = herd.filter((a) => a.sex === 'F' && (a.lactationNo > 0 || a.purpose !== 'FATTENING'));
    const alerts: { kind: string; animalId: string; tagNo: string; date: string | null; text: string }[] = [];
    for (const a of females) {
      const dim = a.lastCalving ? daysBetween(a.lastCalving, today) : null;
      if (a.reproStatus === 'OPEN' && a.lastCalving && dim! >= c.waitingDays) alerts.push({ kind: 'SERVE', animalId: a.id, tagNo: a.tagNo, date: null, text: `Open ${dim} days after calving: watch for heat and serve` });
      if (a.reproStatus === 'SERVED' && a.lastService && daysBetween(a.lastService, today) >= c.pregCheckDays) alerts.push({ kind: 'PREG_CHECK', animalId: a.id, tagNo: a.tagNo, date: iso(addDays(a.lastService, c.pregCheckDays)), text: `Served ${daysBetween(a.lastService, today)} days ago: pregnancy check due` });
      if (a.lactating && a.dryOffDate && a.dryOffDate <= addDays(today, 7)) alerts.push({ kind: 'DRY_OFF', animalId: a.id, tagNo: a.tagNo, date: iso(a.dryOffDate), text: `Dry off by ${iso(a.dryOffDate)} (${c.dryOffDays} days before calving)` });
      if (a.expectedCalving && a.reproStatus === 'PREGNANT' && a.expectedCalving <= addDays(today, 21)) alerts.push({ kind: 'CALVING', animalId: a.id, tagNo: a.tagNo, date: iso(a.expectedCalving), text: `Calving expected ${iso(a.expectedCalving)}` });
    }
    for (const a of herd) {
      if (a.milkWithdrawalUntil && a.milkWithdrawalUntil >= today && a.lactating) alerts.push({ kind: 'WITHDRAWAL', animalId: a.id, tagNo: a.tagNo, date: iso(a.milkWithdrawalUntil), text: `Milk withdrawal until ${iso(a.milkWithdrawalUntil)}: throw the milk away` });
      if (a.purpose === 'FATTENING' && (!a.lastWeighDate || daysBetween(a.lastWeighDate, today) > 30)) alerts.push({ kind: 'WEIGH', animalId: a.id, tagNo: a.tagNo, date: a.lastWeighDate ? iso(a.lastWeighDate) : null, text: a.lastWeighDate ? `Not weighed for ${daysBetween(a.lastWeighDate, today)} days` : 'Never weighed' });
    }
    const events = await this.prisma.animalEvent.findMany({ where: { animalId: { in: females.map((a) => a.id) }, date: { gte: addDays(today, -730) }, type: { in: ['SERVICE', 'PREG_CHECK', 'CALVING'] } }, select: { animalId: true, date: true, type: true, result: true } });
    const milk = await this.milkSummary({ from: iso(addDays(today, -7)), to: iso(today) });
    const gains = await this.gains(herd.filter((a) => a.purpose === 'FATTENING').map((a) => a.id));
    const g = [...gains.values()].filter((x): x is number => x !== null);
    return {
      settings: c,
      counts: {
        total: herd.length,
        byPurpose: Object.fromEntries(PURPOSES.map((p) => [p, herd.filter((a) => a.purpose === p).length])),
        lactating: herd.filter((a) => a.lactating).length,
        dry: females.filter((a) => !a.lactating && a.lactationNo > 0).length,
        pregnant: females.filter((a) => a.reproStatus === 'PREGNANT').length,
        served: females.filter((a) => a.reproStatus === 'SERVED').length,
        open: females.filter((a) => a.reproStatus === 'OPEN' && a.lactationNo > 0).length,
        heifers: females.filter((a) => a.lactationNo === 0).length,
        underWithdrawal: herd.filter((a) => (a.milkWithdrawalUntil && a.milkWithdrawalUntil >= today) || (a.meatWithdrawalUntil && a.meatWithdrawalUntil >= today)).length,
      },
      repro: reproKpis(events),
      milk: { days: milk.slice(0, 7), avgPerCow: milk.length ? Math.round((milk.reduce((a, d) => a + (d.perCow ?? 0), 0) / milk.filter((d) => d.perCow !== null).length || 0) * 100) / 100 : null },
      fattening: { heads: herd.filter((a) => a.purpose === 'FATTENING').length, avgAdg: g.length ? Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 1000) / 1000 : null },
      alerts: alerts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    };
  }

  /** fattening by pen: heads, weights, gain, cost carried and cost per kg gained */
  async fattening() {
    RequestCtx.assert('herd.read');
    const companyId = RequestCtx.companyId();
    const herd = await this.prisma.animal.findMany({ where: { companyId, status: 'ACTIVE', deletedAt: null, purpose: 'FATTENING' } });
    const units = new Map((await this.prisma.farmUnit.findMany({ where: { companyId }, select: { id: true, code: true, name: true } })).map((u) => [u.id, u]));
    const first = await this.prisma.animalWeight.findMany({ where: { animalId: { in: herd.map((a) => a.id) } }, orderBy: { date: 'asc' }, distinct: ['animalId'] });
    const gains = await this.gains(herd.map((a) => a.id));
    const today = todayDate();
    const by = new Map<string, Animal[]>();
    for (const a of herd) by.set(a.unitId ?? '', [...(by.get(a.unitId ?? '') ?? []), a]);
    return [...by.entries()].map(([unitId, list]) => {
      const w0 = list.map((a) => first.find((f) => f.animalId === a.id)).filter((x): x is NonNullable<typeof x> => !!x);
      const startKg = w0.reduce((s, x) => s + n(x.kg), 0);
      const nowKg = list.reduce((s, a) => s + n(a.lastWeightKg), 0);
      const gained = list.filter((a) => a.lastWeightKg !== null && first.some((f) => f.animalId === a.id)).reduce((s, a) => s + n(a.lastWeightKg) - n(first.find((f) => f.animalId === a.id)!.kg), 0);
      const cost = list.reduce((s, a) => s + n(a.carryingCost), 0);
      const purchase = list.reduce((s, a) => s + n(a.acquisitionCost), 0);
      const g = list.map((a) => gains.get(a.id)).filter((x): x is number => x !== null && x !== undefined);
      return {
        unit: units.get(unitId) ?? null,
        heads: list.length,
        avgDays: Math.round(list.reduce((s, a) => s + daysBetween(a.acquisitionDate, today), 0) / list.length),
        avgStartKg: w0.length ? Math.round(startKg / w0.length) : null,
        avgNowKg: list.length ? Math.round(nowKg / list.length) : null,
        avgAdg: g.length ? Math.round((g.reduce((s, x) => s + x, 0) / g.length) * 1000) / 1000 : null,
        gainedKg: Math.round(gained),
        cost,
        feedAndCare: cost - purchase,
        costPerKgGained: gained > 0 ? Math.round((cost - purchase) / gained) : null,
        costPerHead: Math.round(cost / list.length),
      };
    });
  }
}
