import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { DocumentService } from '../documents/document.service';
import { PPNBM_GROUPS, ppnbmAmount, ppnbmGroup, ppnbmTerms, suggestPpnbm } from '../documents/ppnbm';
import { checkVin, onTheRoad, yearCode } from './automotive-calc';

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = (max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const CATEGORIES = ['PASSENGER', 'MPV', 'DOUBLE_CABIN', 'PICKUP', 'TRUCK', 'BUS', 'MOTORCYCLE', 'GOLF', 'OTHER'] as const;
export const FUELS = ['PETROL', 'DIESEL', 'HEV', 'MHEV', 'PHEV', 'BEV', 'FCEV', 'FLEXY'] as const;

export const modelSchema = z.object({
  code: z.string().trim().min(1).max(30),
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80),
  typeName: z.string().trim().min(1).max(120),
  variant: optText(80),
  category: z.enum(CATEGORIES),
  fuel: z.enum(FUELS),
  dieselEngine: z.boolean().default(false),
  lcgc: z.boolean().default(false),
  engineCc: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(0).max(20_000).nullable().optional()),
  motorKw: optNum(10_000),
  seats: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(100).nullable().optional()),
  kmPerL: optNum(1000),
  co2: optNum(2000),
  emissionCertNo: optText(60),
  sutNumber: optText(60),
  sutDate: optDate,
  wmi: z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.toUpperCase() : v), z.string().regex(/^[A-HJ-NPR-Z0-9]{3}$/, 'Three letters / digits, no I, O or Q').nullable().optional()),
  requireCheckDigit: z.boolean().default(false),
  productId: optUuid,
  luxuryGroup: z.preprocess((v) => (v === '' ? null : v), z.string().max(6).nullable().optional()),
  tkdnPct: optNum(100),
  notes: optText(2000),
  isActive: z.boolean().default(true),
});
export const registerSchema = z.object({
  modelId: z.uuid(),
  colour: z.string().trim().min(1).max(40),
  yearMade: z.coerce.number().int().min(1950).max(2100),
  modelYear: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1950).max(2100).nullable().optional()),
  productionDate: optDate,
  warehouseId: optUuid,
  inDocument: optText(40),
  customsDocNo: optText(60),
  units: z.array(z.object({ vin: z.string().trim().min(1).max(30), engineNo: z.string().trim().min(1).max(30), colour: optText(40), srutNumber: optText(60), srutDate: optDate })).min(1).max(500),
});
export const vehicleSchema = z.object({
  colour: z.string().trim().min(1).max(40),
  engineNo: z.string().trim().min(1).max(30),
  yearMade: z.coerce.number().int().min(1950).max(2100),
  modelYear: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1950).max(2100).nullable().optional()),
  srutNumber: optText(60),
  srutDate: optDate,
  customsDocNo: optText(60),
  notes: optText(2000),
});
export const reserveSchema = z.object({
  customerId: z.uuid(),
  date: z.coerce.date(),
  unitPrice: z.coerce.number().positive().max(1e13).optional(),
  njkb: optNum(1e13),
  weighting: z.coerce.number().min(0.5).max(2).default(1),
  ownerName: optText(200),
  ownerIdNo: optText(40),
  ownerAddress: optText(300),
});
export const deliverSchema = z.object({ fakturNo: z.string().trim().min(1).max(60), deliveredAt: z.coerce.date() });

/**
 * Automotive add-on: vehicle types (SUT, specification, PPnBM group of PP 74/2021), vehicles by VIN (Permenperin
 * 23/2021, ISO 3779) and engine number with their SRUT (PM 33/2018 Art. 65-68), sale through a sales order (PPnBM on the
 * invoice when the company collects it), on-the-road price (UU 1/2022) and the data for the faktur kendaraan / BPKB
 * (Perpol 7/2021 Art. 16).
 */
@Injectable()
export class AutomotiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly documents: DocumentService,
  ) {}

  async meta() {
    RequestCtx.assert('automotive.read');
    const companyId = RequestCtx.companyId();
    const [collector, stage2] = await Promise.all([this.settings.bool('sales.ppnbmCollector', companyId, false), this.settings.bool('automotive.ppnbmStage2', companyId, false)]);
    return { groups: PPNBM_GROUPS, categories: CATEGORIES, fuels: FUELS, collector, stage2, yearCode: yearCode(new Date().getFullYear()) };
  }

  suggest(spec: z.infer<typeof modelSchema>) {
    RequestCtx.assert('automotive.read');
    return suggestPpnbm({ category: spec.category, fuel: spec.fuel, engineCc: spec.engineCc ?? null, seats: spec.seats ?? null, kmPerL: spec.kmPerL ?? null, co2: spec.co2 ?? null, lcgc: spec.lcgc, dieselEngine: spec.dieselEngine });
  }

  // ------------------------------------------------------------------ models
  private shapeModel(m: Prisma.VehicleModelGetPayload<object>) {
    return { ...m, motorKw: nn(m.motorKw), kmPerL: nn(m.kmPerL), co2: nn(m.co2), tkdnPct: nn(m.tkdnPct) };
  }

  async models() {
    RequestCtx.assert('automotive.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.vehicleModel.findMany({ where: { companyId }, orderBy: [{ brand: 'asc' }, { model: 'asc' }, { code: 'asc' }] });
    const [counts, products] = await Promise.all([
      this.prisma.vehicle.groupBy({ by: ['modelId', 'status'], where: { companyId }, _count: { _all: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId!).filter(Boolean) } }, select: { id: true, code: true, name: true, salePrice: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    return rows.map((m) => ({
      ...this.shapeModel(m),
      product: m.productId ? { ...pm.get(m.productId), salePrice: n(pm.get(m.productId)?.salePrice) } : null,
      group: ppnbmGroup(m.luxuryGroup) ?? null,
      units: Object.fromEntries(counts.filter((c) => c.modelId === m.id).map((c) => [c.status, c._count._all])),
    }));
  }

  async saveModel(id: string | null, input: z.infer<typeof modelSchema>) {
    RequestCtx.assert('automotive.model.manage');
    const u = RequestCtx.user();
    if (input.luxuryGroup && !ppnbmGroup(input.luxuryGroup)) throw invalid({ luxuryGroup: 'Unknown PPnBM group' });
    if (input.lcgc && !['PETROL', 'DIESEL'].includes(input.fuel)) throw invalid({ lcgc: 'LCGC (KBH2) are petrol or diesel cars' });
    if (['BEV', 'FCEV'].includes(input.fuel) && input.engineCc) throw invalid({ engineCc: 'An electric vehicle has motor power, not engine capacity' });
    const before = id ? await this.prisma.vehicleModel.findFirst({ where: { id, companyId: u.companyId } }) : null;
    if (id && !before) throw new NotFoundException('Vehicle type not found');
    if (input.productId) {
      const p = await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null }, select: { id: true, type: true } });
      if (!p || p.type !== 'STOCK') throw invalid({ productId: 'Choose a stock product' });
      const other = await this.prisma.vehicleModel.findFirst({ where: { companyId: u.companyId, productId: input.productId, id: { not: id ?? undefined } } });
      if (other) throw invalid({ productId: `Already the product of type ${other.code}` });
    }
    const dup = await this.prisma.vehicleModel.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } });
    if (dup) throw invalid({ code: 'Code already used' });
    const suggestion = this.suggest(input);
    const luxuryGroup = input.luxuryGroup === undefined ? suggestion.code : input.luxuryGroup;
    const data = { ...input, luxuryGroup, motorKw: input.motorKw === null || input.motorKw === undefined ? null : D(input.motorKw), kmPerL: input.kmPerL === null || input.kmPerL === undefined ? null : D(input.kmPerL), co2: input.co2 === null || input.co2 === undefined ? null : D(input.co2), tkdnPct: input.tkdnPct === null || input.tkdnPct === undefined ? null : D(input.tkdnPct), updatedById: u.id };
    let note: string | null = null;
    const saved = await this.prisma.$transaction(async (tx) => {
      const m = id ? await tx.vehicleModel.update({ where: { id }, data }) : await tx.vehicleModel.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
      if (m.productId) {
        // the product carries the PPnBM group; a PPnBM product takes PPN 12% on the full price (PMK 131/2024)
        const p = await tx.product.findUniqueOrThrow({ where: { id: m.productId }, select: { saleTaxId: true } });
        const tax = p.saleTaxId ? await tx.tax.findUnique({ where: { id: p.saleTaxId } }) : null;
        let saleTaxId = p.saleTaxId;
        if (m.luxuryGroup && (!tax || tax.baseNumerator !== tax.baseDenominator)) {
          const full = await tx.tax.findFirst({ where: { companyId: u.companyId, kind: 'VAT', deletedAt: null, isActive: true, rate: 12, baseNumerator: 1, baseDenominator: 1 } });
          if (full) {
            saleTaxId = full.id;
            note = `Sales tax of the product set to ${full.name}`;
          }
        }
        await tx.product.update({ where: { id: m.productId }, data: { luxuryGroup: m.luxuryGroup, saleTaxId } });
      }
      if (before?.productId && before.productId !== m.productId) await tx.product.update({ where: { id: before.productId }, data: { luxuryGroup: null } });
      return m;
    });
    await this.audit.record('Vehicle Type', saved.id, id ? 'UPDATE' : 'CREATE', before, { code: saved.code, luxuryGroup: saved.luxuryGroup });
    return { ...this.shapeModel(saved), suggestion, note };
  }

  // ------------------------------------------------------------------ vehicles
  async vehicles(f: { status?: string; modelId?: string; q?: string; noSrut?: boolean }) {
    RequestCtx.assert('automotive.read');
    const companyId = RequestCtx.companyId();
    const q = f.q?.toUpperCase();
    const rows = await this.prisma.vehicle.findMany({
      where: { companyId, ...(f.status ? { status: f.status } : {}), ...(f.modelId ? { modelId: f.modelId } : {}), ...(f.noSrut ? { srutNumber: null, status: { not: 'CANCELLED' } } : {}), ...(q ? { OR: [{ vin: { contains: q } }, { engineNo: { contains: q } }, { srutNumber: { contains: q } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    const [models, customers] = await Promise.all([
      this.prisma.vehicleModel.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.modelId))] } }, select: { id: true, code: true, brand: true, model: true, typeName: true } }),
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    const mm = new Map(models.map((m) => [m.id, m]));
    const cm = new Map(customers.map((c) => [c.id, c.name]));
    return rows.map((v) => ({ id: v.id, vin: v.vin, engineNo: v.engineNo, colour: v.colour, yearMade: v.yearMade, status: v.status, srutNumber: v.srutNumber, deliveredAt: iso(v.deliveredAt), fakturNo: v.fakturNo, model: mm.get(v.modelId) ?? null, customer: v.customerId ? (cm.get(v.customerId) ?? null) : null }));
  }

  async vehicle(id: string) {
    RequestCtx.assert('automotive.read');
    const companyId = RequestCtx.companyId();
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const m = await this.prisma.vehicleModel.findUniqueOrThrow({ where: { id: v.modelId } });
    const [customer, so, inv, wh, product] = await Promise.all([
      v.customerId ? this.prisma.customer.findUnique({ where: { id: v.customerId }, select: { id: true, name: true } }) : null,
      v.salesOrderId ? this.prisma.tradeDocument.findUnique({ where: { id: v.salesOrderId }, select: { id: true, number: true, status: true, grandTotal: true, taxTotal: true, luxuryTaxTotal: true, subtotal: true, discountTotal: true, deletedAt: true } }) : null,
      v.invoiceId ? this.prisma.tradeDocument.findUnique({ where: { id: v.invoiceId }, select: { id: true, number: true, status: true } }) : null,
      v.warehouseId ? this.prisma.warehouse.findUnique({ where: { id: v.warehouseId }, select: { id: true, name: true } }) : null,
      m.productId ? this.prisma.product.findUnique({ where: { id: m.productId }, select: { code: true, name: true, salePrice: true } }) : null,
    ]);
    const canSee = RequestCtx.user().isSuperAdmin || RequestCtx.user().permissions.has('automotive.sell');
    const check = checkVin(v.vin, { wmi: m.wmi, requireCheckDigit: m.requireCheckDigit });
    return {
      ...v,
      productionDate: iso(v.productionDate),
      srutDate: iso(v.srutDate),
      deliveredAt: iso(v.deliveredAt),
      ownerIdNo: v.ownerIdNo ? (canSee ? this.crypto.decrypt(v.ownerIdNo) : '••••••') : null,
      model: { ...this.shapeModel(m), group: ppnbmGroup(m.luxuryGroup) ?? null, product: product ? { ...product, salePrice: n(product.salePrice) } : null },
      vinCheck: { checkDigitOk: check.checkDigit.ok, expected: check.checkDigit.expected, yearCodeOk: !v.modelYear || check.yearCode === yearCode(v.modelYear), wmi: check.wmi, vds: check.vds, vis: check.vis },
      customer,
      salesOrder: so && !so.deletedAt ? { ...so, grandTotal: n(so.grandTotal), taxTotal: n(so.taxTotal), luxuryTaxTotal: n(so.luxuryTaxTotal), net: n(so.subtotal) - n(so.discountTotal) } : null,
      invoice: inv,
      warehouse: wh,
    };
  }

  /** register units of a type: VIN structure (ISO 3779), manufacturer code, unique VIN and engine number */
  async register(input: z.infer<typeof registerSchema>) {
    RequestCtx.assert('automotive.vehicle.manage');
    const u = RequestCtx.user();
    const m = await this.prisma.vehicleModel.findFirst({ where: { id: input.modelId, companyId: u.companyId } });
    if (!m) throw invalid({ modelId: 'Vehicle type not found' });
    if (input.modelYear && input.modelYear < input.yearMade - 1) throw invalid({ modelYear: 'Model year is the year made or the next one' });
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenVin = new Set<string>();
    const seenEngine = new Set<string>();
    const units = input.units.map((x, i) => {
      const c = checkVin(x.vin, { wmi: m.wmi, requireCheckDigit: m.requireCheckDigit });
      const engineNo = x.engineNo.trim().toUpperCase().replace(/\s+/g, '');
      if (!c.ok) errors.push(`Row ${i + 1} ${c.vin}: ${c.errors.join('; ')}`);
      else {
        if (!m.requireCheckDigit && !c.checkDigit.ok) warnings.push(`Row ${i + 1} ${c.vin}: position 9 is not the check digit (${c.checkDigit.expected})`);
        if (!/[A-HJ-NPR-TV-Y1-9]/.test(c.yearCode)) warnings.push(`Row ${i + 1} ${c.vin}: position 10 is not a model-year code`);
        else if (input.modelYear && c.yearCode !== yearCode(input.modelYear)) warnings.push(`Row ${i + 1} ${c.vin}: position 10 is ${c.yearCode}, model year ${input.modelYear} is ${yearCode(input.modelYear)}`);
      }
      if (seenVin.has(c.vin)) errors.push(`Row ${i + 1}: VIN ${c.vin} twice in the list`);
      if (seenEngine.has(engineNo)) errors.push(`Row ${i + 1}: engine number ${engineNo} twice in the list`);
      seenVin.add(c.vin);
      seenEngine.add(engineNo);
      return { vin: c.vin, engineNo, colour: x.colour ?? input.colour, srutNumber: x.srutNumber ?? null, srutDate: x.srutDate ?? null };
    });
    const taken = await this.prisma.vehicle.findMany({ where: { companyId: u.companyId, OR: [{ vin: { in: units.map((x) => x.vin) } }, { engineNo: { in: units.map((x) => x.engineNo) } }] }, select: { vin: true, engineNo: true } });
    for (const t of taken) errors.push(units.some((x) => x.vin === t.vin) ? `VIN ${t.vin} is already registered` : `Engine number ${t.engineNo} is already registered`);
    if (errors.length) throw invalid({ units: errors.slice(0, 20).join('\n') });
    if (m.productId) {
      const [stock, units0] = await Promise.all([
        this.prisma.stockBalance.aggregate({ where: { productId: m.productId, ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}) }, _sum: { qty: true } }),
        this.prisma.vehicle.count({ where: { companyId: u.companyId, modelId: m.id, status: { in: ['IN_STOCK', 'RESERVED'] }, ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}) } }),
      ]);
      if (units0 + units.length > n(stock._sum.qty)) warnings.push(`${units0 + units.length} units registered against ${n(stock._sum.qty)} in stock: post the goods receipt / production`);
    }
    await this.prisma.vehicle.createMany({
      data: units.map((x) => ({ companyId: u.companyId, modelId: m.id, vin: x.vin, engineNo: x.engineNo, colour: x.colour, yearMade: input.yearMade, modelYear: input.modelYear ?? null, productionDate: input.productionDate ?? null, warehouseId: input.warehouseId ?? null, inDocument: input.inDocument ?? null, customsDocNo: input.customsDocNo ?? null, srutNumber: x.srutNumber, srutDate: x.srutDate, createdById: u.id, updatedById: u.id })),
    });
    await this.audit.record('Vehicle', m.id, 'REGISTER', null, { model: m.code, units: units.length });
    return { registered: units.length, warnings };
  }

  async update(id: string, input: z.infer<typeof vehicleSchema>) {
    RequestCtx.assert('automotive.vehicle.manage');
    const u = RequestCtx.user();
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId: u.companyId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const engineNo = input.engineNo.toUpperCase().replace(/\s+/g, '');
    if (v.status === 'SOLD' && (engineNo !== v.engineNo || input.yearMade !== v.yearMade || (v.srutNumber && input.srutNumber !== v.srutNumber))) throw new ConflictException('A sold vehicle keeps its engine number, year and SRUT (they are on the faktur kendaraan)');
    if (engineNo !== v.engineNo && (await this.prisma.vehicle.findFirst({ where: { companyId: u.companyId, engineNo, id: { not: id } } }))) throw invalid({ engineNo: 'Engine number already registered' });
    await this.prisma.vehicle.update({ where: { id }, data: { ...input, engineNo, updatedById: u.id } });
    await this.audit.record('Vehicle', id, 'UPDATE', { engineNo: v.engineNo, srutNumber: v.srutNumber }, { engineNo, srutNumber: input.srutNumber });
    return this.vehicle(id);
  }

  async cancelUnit(id: string) {
    RequestCtx.assert('automotive.vehicle.manage');
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!v) throw new NotFoundException('Vehicle not found');
    if (v.status !== 'IN_STOCK') throw new ConflictException('Only a vehicle in stock (not reserved or sold) can be taken off the register');
    await this.prisma.vehicle.update({ where: { id }, data: { status: 'CANCELLED', updatedById: RequestCtx.user().id } });
    await this.audit.record('Vehicle', id, 'CANCEL', { status: v.status }, { status: 'CANCELLED' });
    return this.vehicle(id);
  }

  private async otrSettings(companyId: string) {
    const [bbnkbPct, pkbPct, opsenPct, swdkllj, pnbp] = await Promise.all([
      this.settings.num('automotive.bbnkbPct', companyId, 12),
      this.settings.num('automotive.pkbPct', companyId, 1.2),
      this.settings.num('automotive.opsenPct', companyId, 66),
      this.settings.num('automotive.swdkllj', companyId, 143_000),
      this.settings.num('automotive.pnbp', companyId, 675_000),
    ]);
    return { bbnkbPct, pkbPct, opsenPct, swdkllj, pnbp };
  }

  /** price preview of a type: PPN, PPnBM (when the company collects it) and the on-the-road build-up */
  async quote(modelId: string, unitPrice: number, njkb: number | null, weighting = 1) {
    RequestCtx.assert('automotive.read');
    const companyId = RequestCtx.companyId();
    const m = await this.prisma.vehicleModel.findFirst({ where: { id: modelId, companyId } });
    if (!m) throw new NotFoundException('Vehicle type not found');
    if (!(unitPrice > 0)) throw new BadRequestException('Enter the price');
    const [collector, stage2, vatPayer] = await Promise.all([this.settings.bool('sales.ppnbmCollector', companyId, false), this.settings.bool('automotive.ppnbmStage2', companyId, false), this.settings.bool('sales.vatPayer', companyId, true)]);
    const lux = collector && vatPayer ? ppnbmTerms(m.luxuryGroup, stage2) : null;
    const ppn = vatPayer ? Math.round(unitPrice * (m.luxuryGroup ? 1 : 11 / 12) * 0.12) : 0;
    const ppnbm = lux ? ppnbmAmount(unitPrice, lux.rate, lux.basePct) : 0;
    const offRoad = unitPrice + ppn + ppnbm;
    const otr = onTheRoad({ offRoad, njkb: njkb ?? unitPrice, weighting, ...(await this.otrSettings(companyId)) });
    return { unitPrice, ppn, ppnbm, ppnbmTerms: lux, offRoad, otr, njkbAssumed: njkb === null };
  }

  /** reserve a vehicle for a customer: a draft sales order with the VIN and engine number on the line */
  async reserve(id: string, input: z.infer<typeof reserveSchema>) {
    RequestCtx.assert('automotive.sell');
    const u = RequestCtx.user();
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId: u.companyId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    if (v.status !== 'IN_STOCK') throw new ConflictException('The vehicle is not free (reserved, sold or off the register)');
    const m = await this.prisma.vehicleModel.findUniqueOrThrow({ where: { id: v.modelId } });
    if (!m.productId) throw new ConflictException('Link the vehicle type to its stock product first');
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: m.productId }, select: { salePrice: true } });
    const unitPrice = input.unitPrice ?? n(product.salePrice);
    if (!(unitPrice > 0)) throw invalid({ unitPrice: 'Enter the price (the product has no sale price)' });
    const so = await this.documents.create(
      'SO',
      {
        date: localIso(input.date),
        customerId: input.customerId,
        warehouseId: v.warehouseId ?? undefined,
        reference: `VIN ${v.vin}`,
        lines: [{ productId: m.productId, qty: 1, unitPrice, description: `${m.brand} ${m.model} ${m.typeName}${m.variant ? ` ${m.variant}` : ''}, ${v.colour}, ${v.yearMade} - VIN ${v.vin}, engine ${v.engineNo}` }],
      },
      undefined,
      { skipPermission: true },
    );
    const doc = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: so.id }, select: { grandTotal: true } });
    const otr = onTheRoad({ offRoad: n(doc.grandTotal), njkb: input.njkb ?? unitPrice, weighting: input.weighting, ...(await this.otrSettings(u.companyId)) });
    await this.prisma.vehicle.update({
      where: { id },
      data: { status: 'RESERVED', customerId: input.customerId, salesOrderId: so.id, ownerName: input.ownerName ?? null, ownerIdNo: input.ownerIdNo ? this.crypto.encrypt(input.ownerIdNo) : null, ownerAddress: input.ownerAddress ?? null, otr: { ...otr, njkbAssumed: input.njkb === null || input.njkb === undefined } as Prisma.InputJsonValue, updatedById: u.id },
    });
    await this.audit.record('Vehicle', id, 'RESERVE', { status: 'IN_STOCK' }, { salesOrderId: so.id, customerId: input.customerId });
    return this.vehicle(id);
  }

  /** release a reservation: the draft sales order is dropped; a confirmed one must be cancelled first */
  async release(id: string) {
    RequestCtx.assert('automotive.sell');
    const u = RequestCtx.user();
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId: u.companyId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    if (v.status !== 'RESERVED') throw new ConflictException('Only a reserved vehicle can be released');
    const so = v.salesOrderId ? await this.prisma.tradeDocument.findUnique({ where: { id: v.salesOrderId } }) : null;
    if (so && !so.deletedAt && so.status !== 'DRAFT' && so.status !== 'CANCELLED') throw new ConflictException(`Sales order ${so.number} is confirmed: cancel it first`);
    await this.prisma.$transaction(async (tx) => {
      if (so && so.status === 'DRAFT' && !so.deletedAt) await tx.tradeDocument.update({ where: { id: so.id }, data: { deletedAt: new Date(), updatedById: u.id } });
      await tx.vehicle.update({ where: { id }, data: { status: 'IN_STOCK', customerId: null, salesOrderId: null, ownerName: null, ownerIdNo: null, ownerAddress: null, otr: Prisma.DbNull, updatedById: u.id } });
    });
    await this.audit.record('Vehicle', id, 'RELEASE', { status: 'RESERVED', salesOrderId: v.salesOrderId }, { status: 'IN_STOCK' });
    return this.vehicle(id);
  }

  /** hand-over: the delivery of the sales order is confirmed, the SRUT is there, the faktur kendaraan number is given */
  async deliver(id: string, input: z.infer<typeof deliverSchema>) {
    RequestCtx.assert('automotive.sell');
    const u = RequestCtx.user();
    const v = await this.prisma.vehicle.findFirst({ where: { id, companyId: u.companyId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    if (v.status !== 'RESERVED' || !v.salesOrderId) throw new ConflictException('Reserve the vehicle for the buyer first');
    if (!v.srutNumber) throw new ConflictException('No SRUT number: the vehicle cannot be registered (BPKB / STNK) without it');
    const dos = await this.prisma.tradeDocument.findMany({ where: { companyId: u.companyId, sourceId: v.salesOrderId, deletedAt: null, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] } }, select: { id: true, docType: true, number: true } });
    const delivery = dos.find((d) => d.docType === 'DO');
    if (!delivery) throw new ConflictException('Confirm the delivery order of the sales order first (the vehicle leaves the stock with it)');
    const invoice = dos.find((d) => d.docType === 'SI') ?? (await this.prisma.tradeDocument.findFirst({ where: { companyId: u.companyId, sourceId: delivery.id, docType: 'SI', deletedAt: null, status: { not: 'CANCELLED' } }, select: { id: true } }));
    const dupFaktur = await this.prisma.vehicle.findFirst({ where: { companyId: u.companyId, fakturNo: input.fakturNo, id: { not: id } } });
    if (dupFaktur) throw invalid({ fakturNo: 'Faktur number already given to another vehicle' });
    await this.prisma.vehicle.update({ where: { id }, data: { status: 'SOLD', deliveryNumber: delivery.number, invoiceId: invoice?.id ?? null, deliveredAt: input.deliveredAt, fakturNo: input.fakturNo, updatedById: u.id } });
    await this.audit.record('Vehicle', id, 'DELIVER', { status: 'RESERVED' }, { deliveryNumber: delivery.number, fakturNo: input.fakturNo });
    return this.vehicle(id);
  }
}
