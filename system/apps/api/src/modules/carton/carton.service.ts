import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { DocumentService } from '../documents/document.service';
import { blankSize, boardWeight, costFor, DEFAULT_FLUTES, EstimateInput, Flute, layerPattern, mckee, Rates, requiredBct, STYLES, toolingCost } from './carton-calc';
import { planPair, planSingle, TrimItem } from './trim-plan';

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());
const optNum = (max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const fluteSchema = z.object({
  code: z.string().trim().min(1).max(6),
  name: z.string().trim().min(1).max(60),
  walls: z.coerce.number().int().min(1).max(3),
  caliper: z.coerce.number().positive().max(30),
  takeUp1: z.coerce.number().min(1).max(2),
  takeUp2: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(1).max(2).nullable().optional()),
  allowLW: z.coerce.number().min(0).max(50),
  allowH: z.coerce.number().min(0).max(80),
  isActive: z.boolean().default(true),
});
export const gradeSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  fluteId: z.uuid(),
  layers: z.array(z.object({ role: z.enum(['LINER', 'MEDIUM']), productId: z.uuid(), gsm: z.coerce.number().positive().max(1000), pricePerKg: optNum(1e7) })).min(3).max(7),
  ectNm: optNum(1e6),
  burstKpa: optNum(1e5),
  notes: optText(2000),
  isActive: z.boolean().default(true),
});
export const specSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  customerId: optUuid,
  productId: optUuid,
  style: z.enum(Object.keys(STYLES) as [string, ...string[]]),
  lengthMm: z.coerce.number().positive().max(5000),
  widthMm: z.coerce.number().positive().max(5000),
  heightMm: z.coerce.number().min(0).max(5000).default(0),
  gradeId: z.uuid(),
  colours: z.coerce.number().int().min(0).max(8).default(0),
  printCoveragePct: z.coerce.number().min(0).max(100).default(0),
  joint: z.enum(['GLUE', 'STITCH', 'TAPE', 'NONE']).default('GLUE'),
  dieCut: z.boolean().default(false),
  blankLengthMm: optNum(10_000),
  blankWidthMm: optNum(10_000),
  bundleQty: z.coerce.number().int().min(1).max(1000).default(25),
  grossKg: optNum(10_000),
  stackHeight: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(100).nullable().optional()),
  safetyFactor: z.coerce.number().min(1).max(10).default(4),
  foodContact: z.enum(['NONE', 'INDIRECT', 'DIRECT']).default('NONE'),
  foodType: z.preprocess((v) => (v === '' ? null : v), z.enum(['DRY', 'FATTY', 'MOIST', 'HOT']).nullable().optional()),
  inkType: optText(60),
  printSide: z.preprocess((v) => (v === '' ? null : v), z.enum(['OUTSIDE', 'INSIDE', 'BOTH']).nullable().optional()),
  migrationReport: optText(120),
  migrationDate: optDate,
  declarationUntil: optDate,
  recycledPct: optNum(100),
  recycledApproval: optText(120),
  animalInput: z.boolean().default(false),
  halalCertNo: optText(80),
  notes: optText(2000),
  isActive: z.boolean().default(true),
});
export const estimateSchema = z.object({
  specId: z.uuid(),
  customerId: optUuid,
  date: z.coerce.date(),
  kind: z.enum(['GOODS', 'MAKLON']).default('GOODS'),
  quantities: z.array(z.coerce.number().int().min(1).max(100_000_000)).min(1).max(8),
  newPlates: z.boolean().optional(),
  newDie: z.boolean().optional(),
  billToolingSeparately: z.boolean().default(true),
  notes: optText(2000),
});
export const quoteSchema = z.object({ qty: z.coerce.number().int().min(1), date: z.coerce.date().optional() });
export const trimSchema = z.object({
  items: z.array(z.object({ specId: optUuid, label: optText(60), sheetWidth: optNum(10_000), sheetLength: optNum(10_000), qty: z.coerce.number().int().min(1).max(100_000_000) })).min(1).max(2),
  rollWidths: z.array(z.coerce.number().int().min(300).max(4000)).max(30).optional(),
  minTrim: optNum(500),
});
export const toolSchema = z.object({
  code: z.string().trim().min(1).max(30),
  kind: z.enum(['PLATE', 'DIE']),
  specId: optUuid,
  customerId: optUuid,
  owner: z.enum(['COMPANY', 'CUSTOMER']).default('COMPANY'),
  colour: optText(40),
  cost: z.coerce.number().min(0).max(1e12).default(0),
  madeOn: optDate,
  location: optText(80),
  lifeImpressions: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).max(1e9).nullable().optional()),
  notes: optText(2000),
});

/**
 * Carton / corrugated box estimator: flutes and board grades (paper layers, take-up, starch), box specifications by FEFCO
 * style with blank size and compression strength (McKee), cost estimates at quantity breaks that become quotations,
 * corrugator trim planning and the register of printing plates and cutting dies. Food-contact (BPOM 11/2026, SNI 8218
 * paper, Permenperin 6/2025) and halal (PP 42/2024, Kep. BPJPH 374/2026) data are kept on the spec.
 */
@Injectable()
export class CartonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly documents: DocumentService,
  ) {}

  private async rates(companyId: string): Promise<Rates & { starchPerLine: number; starchPricePerKg: number; glueFlapMm: number; minTrimMm: number; rollWidths: number[] }> {
    const s = (k: string, d: number) => this.settings.num(`carton.${k}`, companyId, d);
    const [corrugatingPerM2, corrugatorWastePct, printSetupPerColour, printPer1000PerColour, slotPer1000, printWastePct, dieSetup, diePer1000, dieWastePct, gluePerBox, stitchPerBox, tapePerBox, jointWastePct, overheadPct, marginPct, platePerCm2, diePerMetre, starchPerLine, starchPricePerKg, glueFlapMm, minTrimMm, rolls] = await Promise.all([
      s('corrugatingPerM2', 1500),
      s('corrugatorWastePct', 5),
      s('printSetupPerColour', 150_000),
      s('printPer1000PerColour', 60_000),
      s('slotPer1000', 40_000),
      s('printWastePct', 2),
      s('dieSetup', 250_000),
      s('diePer1000', 90_000),
      s('dieWastePct', 5),
      s('gluePerBox', 60),
      s('stitchPerBox', 120),
      s('tapePerBox', 150),
      s('jointWastePct', 1),
      s('overheadPct', 12),
      s('marginPct', 15),
      s('platePerCm2', 60),
      s('diePerMetre', 150_000),
      s('starchPerLine', 5.5),
      s('starchPricePerKg', 9000),
      s('glueFlapMm', 35),
      s('minTrimMm', 25),
      this.settings.str('carton.rollWidths', companyId, '1600,1800,2000,2200,2400,2500'),
    ]);
    if (marginPct >= 100 || corrugatorWastePct >= 100) throw new BadRequestException('Check the carton rates in Settings (margin and waste below 100%)');
    const rollWidths = rolls
      .split(/[,;\s]+/)
      .map(Number)
      .filter((x) => x >= 300 && x <= 4000);
    return { corrugatingPerM2, corrugatorWastePct, printSetupPerColour, printPer1000PerColour, slotPer1000, printWastePct, dieSetup, diePer1000, dieWastePct, gluePerBox, stitchPerBox, tapePerBox, jointWastePct, overheadPct, marginPct, platePerCm2, diePerMetre, starchPerLine, starchPricePerKg, glueFlapMm, minTrimMm, rollWidths };
  }

  /** the plant's flutes, created from the defaults the first time */
  private async ensureFlutes(companyId: string) {
    const count = await this.prisma.cartonFlute.count({ where: { companyId } });
    if (!count) await this.prisma.cartonFlute.createMany({ data: DEFAULT_FLUTES.map((f) => ({ companyId, code: f.code, name: f.name, walls: f.walls, caliper: D(f.caliper), takeUp1: D(f.takeUp1), takeUp2: f.takeUp2 === null ? null : D(f.takeUp2), allowLW: D(f.allowLW), allowH: D(f.allowH) })), skipDuplicates: true });
    return this.prisma.cartonFlute.findMany({ where: { companyId }, orderBy: [{ walls: 'asc' }, { code: 'asc' }] });
  }
  private flute(f: Prisma.CartonFluteGetPayload<object>): Flute & { id: string; name: string; isActive: boolean } {
    return { id: f.id, code: f.code, name: f.name, walls: f.walls, caliper: n(f.caliper), takeUp1: n(f.takeUp1), takeUp2: nn(f.takeUp2), allowLW: n(f.allowLW), allowH: n(f.allowH), isActive: f.isActive };
  }

  async meta() {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const [flutes, rates] = await Promise.all([this.ensureFlutes(companyId), this.rates(companyId)]);
    return { styles: STYLES, flutes: flutes.map((f) => this.flute(f)), rates };
  }

  async saveFlute(id: string, input: z.infer<typeof fluteSchema>) {
    RequestCtx.assert('carton.spec.manage');
    const u = RequestCtx.user();
    const f = await this.prisma.cartonFlute.findFirst({ where: { id, companyId: u.companyId } });
    if (!f) throw new NotFoundException('Flute not found');
    if (input.walls === 2 && !input.takeUp2) throw invalid({ takeUp2: 'Double wall: take-up of the second medium' });
    await this.prisma.cartonFlute.update({ where: { id }, data: { name: input.name, walls: input.walls, caliper: D(input.caliper), takeUp1: D(input.takeUp1), takeUp2: input.takeUp2 ? D(input.takeUp2) : null, allowLW: D(input.allowLW), allowH: D(input.allowH), isActive: input.isActive } });
    await this.audit.record('Carton Flute', id, 'UPDATE', { caliper: n(f.caliper), takeUp1: n(f.takeUp1) }, { caliper: input.caliper, takeUp1: input.takeUp1 });
    return this.meta();
  }

  // ------------------------------------------------------------------ grades
  /** board weight and cost of a grade: paper price per kg from the layer, else the product's purchase price */
  private async gradeFigures(companyId: string, g: { fluteId: string; layers: unknown }) {
    const r = await this.rates(companyId);
    const f = await this.prisma.cartonFlute.findUniqueOrThrow({ where: { id: g.fluteId } });
    const layers = g.layers as { role: 'LINER' | 'MEDIUM'; productId: string; gsm: number; pricePerKg?: number | null }[];
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: layers.map((l) => l.productId) } }, select: { id: true, code: true, name: true, purchasePrice: true, sniRequired: true } })).map((p) => [p.id, p]));
    const w = boardWeight(
      layers.map((l) => ({ role: l.role, gsm: n(l.gsm), pricePerKg: l.pricePerKg ?? n(products.get(l.productId)?.purchasePrice) })),
      this.flute(f),
      r.starchPerLine,
      r.starchPricePerKg,
    );
    return { ...w, flute: this.flute(f), layers: layers.map((l) => ({ ...l, product: products.get(l.productId) ? { code: products.get(l.productId)!.code, name: products.get(l.productId)!.name, sniRequired: products.get(l.productId)!.sniRequired } : null, pricePerKg: l.pricePerKg ?? n(products.get(l.productId)?.purchasePrice) })) };
  }

  async grades() {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    await this.ensureFlutes(companyId);
    const rows = await this.prisma.cartonGrade.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    return Promise.all(rows.map(async (g) => ({ ...g, ectNm: nn(g.ectNm), burstKpa: nn(g.burstKpa), ...(await this.gradeFigures(companyId, g)) })));
  }

  async saveGrade(id: string | null, input: z.infer<typeof gradeSchema>) {
    RequestCtx.assert('carton.spec.manage');
    const u = RequestCtx.user();
    const f = await this.prisma.cartonFlute.findFirst({ where: { id: input.fluteId, companyId: u.companyId } });
    if (!f) throw invalid({ fluteId: 'Flute not found' });
    const pattern = layerPattern(f.walls);
    if (input.layers.length !== pattern.length || input.layers.some((l, i) => l.role !== pattern[i])) throw invalid({ layers: `${f.name}: layers ${pattern.join(' - ').toLowerCase()} (outside to inside)` });
    const ids = [...new Set(input.layers.map((l) => l.productId))];
    if ((await this.prisma.product.count({ where: { id: { in: ids }, companyId: u.companyId, deletedAt: null } })) !== ids.length) throw invalid({ layers: 'Choose the paper products' });
    if (await this.prisma.cartonGrade.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { code: input.code, name: input.name, fluteId: input.fluteId, layers: input.layers as Prisma.InputJsonValue, ectNm: input.ectNm === null || input.ectNm === undefined ? null : D(input.ectNm), burstKpa: input.burstKpa === null || input.burstKpa === undefined ? null : D(input.burstKpa), notes: input.notes ?? null, isActive: input.isActive, updatedById: u.id };
    const g = id ? await this.prisma.cartonGrade.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.cartonGrade.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Carton Grade', g.id, id ? 'UPDATE' : 'CREATE', null, { code: g.code });
    return { ...g, ...(await this.gradeFigures(u.companyId, g)) };
  }

  // ------------------------------------------------------------------ specs
  private async specFigures(companyId: string, s: Prisma.CartonSpecGetPayload<object>) {
    const r = await this.rates(companyId);
    const grade = await this.prisma.cartonGrade.findUniqueOrThrow({ where: { id: s.gradeId } });
    const g = await this.gradeFigures(companyId, grade);
    const formula = blankSize(s.style, n(s.lengthMm), n(s.widthMm), n(s.heightMm), g.flute, r.glueFlapMm);
    const blank = { ...formula, length: s.blankLengthMm ? n(s.blankLengthMm) : formula.length, width: s.blankWidthMm ? n(s.blankWidthMm) : formula.width, fromDrawing: !!(s.blankLengthMm && s.blankWidthMm) };
    const m2 = Math.round(((blank.length * blank.width) / 1e6) * 10_000) / 10_000;
    const outsideL = n(s.lengthMm) + 2 * g.flute.caliper;
    const outsideW = n(s.widthMm) + 2 * g.flute.caliper;
    const bct = grade.ectNm && ['0201', '0200', '0203'].includes(s.style) ? mckee(n(grade.ectNm), g.flute.caliper, outsideL, outsideW) : null;
    const required = s.grossKg && s.stackHeight ? requiredBct(n(s.grossKg), s.stackHeight, n(s.safetyFactor)) : null;
    return {
      grade: { id: grade.id, code: grade.code, name: grade.name, ectNm: nn(grade.ectNm), gsm: g.gsm, costPerM2: g.costPerM2, layers: g.layers, flute: g.flute },
      blank,
      blankM2: m2,
      boxWeightG: Math.round(m2 * g.gsm),
      boardCostPerBox: Math.round(m2 * g.costPerM2),
      outside: { length: Math.round(outsideL), width: Math.round(outsideW), height: Math.round(n(s.heightMm) + (s.style === '0300' ? g.flute.caliper : 2 * g.flute.caliper)) },
      strength: { bctN: bct, requiredN: required, ok: bct !== null && required !== null ? bct >= required : null },
      compliance: this.compliance(s, g.layers),
    };
  }

  /** what a food-contact box still needs (BPOM 11/2026, Permenperin 6/2025 / SNI 8218, Kep. BPJPH 374/2026) */
  private compliance(s: Prisma.CartonSpecGetPayload<object>, layers: { product: { sniRequired: boolean } | null }[]) {
    const items: { level: 'warn' | 'info'; text: string }[] = [];
    if (s.foodContact === 'DIRECT') {
      if (layers.some((l) => l.product && !l.product.sniRequired)) items.push({ level: 'warn', text: 'Liner / medium in direct food contact must meet SNI 8218:2024 (Permenperin 6/2025): mark the paper products "Mandatory SNI" and keep the supplier\'s SPPT-SNI' });
      if (!s.migrationReport) items.push({ level: 'warn', text: 'No migration test report (BPOM 11/2026: total migration for paper and board); existing packaging must comply by 30 Jun 2027' });
      if (n(s.recycledPct) > 0 && !s.recycledApproval) items.push({ level: 'warn', text: 'Recycled fibre in direct contact needs the written approval of the Head of BPOM (BPOM 11/2026 Art. 9-11)' });
      if (!s.inkType) items.push({ level: 'info', text: 'Record the ink / coating and the printed side' });
      if (s.animalInput && !s.halalCertNo) items.push({ level: 'warn', text: 'Animal-derived input in direct-contact packaging: halal certificate required (Kep. BPJPH 374/2026; deadline 17 Oct 2028)' });
      if (s.declarationUntil && s.declarationUntil < new Date()) items.push({ level: 'warn', text: 'The declaration of compliance to the customer has expired' });
    }
    if (s.foodContact !== 'NONE' && !s.animalInput) items.push({ level: 'info', text: 'No animal-derived input: halal certification not required; keep the non-animal statement with its evidence' });
    return items;
  }

  async specs() {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.cartonSpec.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    const [customers, grades] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.cartonGrade.findMany({ where: { companyId }, select: { id: true, code: true } }),
    ]);
    const cm = new Map(customers.map((c) => [c.id, c.name]));
    const gm = new Map(grades.map((g) => [g.id, g.code]));
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, style: s.style, lengthMm: n(s.lengthMm), widthMm: n(s.widthMm), heightMm: n(s.heightMm), grade: gm.get(s.gradeId) ?? null, colours: s.colours, dieCut: s.dieCut, foodContact: s.foodContact, customer: s.customerId ? (cm.get(s.customerId) ?? null) : null, isActive: s.isActive }));
  }

  async spec(id: string) {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const s = await this.prisma.cartonSpec.findFirst({ where: { id, companyId } });
    if (!s) throw new NotFoundException('Box specification not found');
    const [fig, customer, product, tools, estimates] = await Promise.all([
      this.specFigures(companyId, s),
      s.customerId ? this.prisma.customer.findUnique({ where: { id: s.customerId }, select: { id: true, name: true } }) : null,
      s.productId ? this.prisma.product.findUnique({ where: { id: s.productId }, select: { id: true, code: true, name: true } }) : null,
      this.prisma.cartonTool.findMany({ where: { companyId, specId: id }, orderBy: { code: 'asc' } }),
      this.prisma.cartonEstimate.findMany({ where: { companyId, specId: id }, orderBy: { date: 'desc' }, take: 20, select: { id: true, number: true, date: true, kind: true, status: true } }),
    ]);
    return {
      ...s,
      lengthMm: n(s.lengthMm),
      widthMm: n(s.widthMm),
      heightMm: n(s.heightMm),
      printCoveragePct: n(s.printCoveragePct),
      blankLengthMm: nn(s.blankLengthMm),
      blankWidthMm: nn(s.blankWidthMm),
      grossKg: nn(s.grossKg),
      safetyFactor: n(s.safetyFactor),
      recycledPct: nn(s.recycledPct),
      migrationDate: iso(s.migrationDate),
      declarationUntil: iso(s.declarationUntil),
      customer,
      product,
      tools: tools.map((t) => this.shapeTool(t)),
      estimates: estimates.map((e) => ({ ...e, date: iso(e.date) })),
      ...fig,
    };
  }

  async saveSpec(id: string | null, input: z.infer<typeof specSchema>) {
    RequestCtx.assert('carton.spec.manage');
    const u = RequestCtx.user();
    if (!(await this.prisma.cartonGrade.findFirst({ where: { id: input.gradeId, companyId: u.companyId } }))) throw invalid({ gradeId: 'Board grade not found' });
    if (input.style !== 'SHEET' && !input.heightMm) throw invalid({ heightMm: 'Enter the inside depth' });
    if (input.style === '0427' && !input.dieCut) input.dieCut = true;
    if ((input.blankLengthMm && !input.blankWidthMm) || (!input.blankLengthMm && input.blankWidthMm)) throw invalid({ blankWidthMm: 'Both blank sizes, or none' });
    if (input.colours === 0) input.printCoveragePct = 0;
    if (input.productId && !(await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ productId: 'Product not found' });
    if (await this.prisma.cartonSpec.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : D(v));
    const data = {
      ...input,
      lengthMm: D(input.lengthMm),
      widthMm: D(input.widthMm),
      heightMm: D(input.heightMm),
      printCoveragePct: D(input.printCoveragePct),
      blankLengthMm: dec(input.blankLengthMm),
      blankWidthMm: dec(input.blankWidthMm),
      grossKg: dec(input.grossKg),
      safetyFactor: D(input.safetyFactor),
      recycledPct: dec(input.recycledPct),
      updatedById: u.id,
    };
    const s = id ? await this.prisma.cartonSpec.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.cartonSpec.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Box Specification', s.id, id ? 'UPDATE' : 'CREATE', null, { code: s.code });
    return this.spec(s.id);
  }

  // ------------------------------------------------------------------ estimates
  /** cost at each quantity: board (paper + starch + corrugating), printing / slotting, die-cutting, joint, tooling, overhead, margin */
  private async calc(companyId: string, input: z.infer<typeof estimateSchema>) {
    const s = await this.prisma.cartonSpec.findFirst({ where: { id: input.specId, companyId } });
    if (!s) throw invalid({ specId: 'Box specification not found' });
    const r = await this.rates(companyId);
    const fig = await this.specFigures(companyId, s);
    const tools = await this.prisma.cartonTool.findMany({ where: { companyId, specId: s.id, status: 'ACTIVE' }, select: { kind: true } });
    const newPlates = s.colours > 0 && (input.newPlates ?? !tools.some((t) => t.kind === 'PLATE'));
    const newDie = s.dieCut && (input.newDie ?? !tools.some((t) => t.kind === 'DIE'));
    const ei: EstimateInput = { kind: input.kind, blankM2: fig.blankM2, blankLength: fig.blank.length, blankWidth: fig.blank.width, boardCostPerM2: fig.grade.costPerM2, colours: s.colours, printCoveragePct: n(s.printCoveragePct), dieCut: s.dieCut, joint: s.joint as EstimateInput['joint'], newPlates, newDie, billToolingSeparately: input.billToolingSeparately };
    const tooling = toolingCost(ei, r);
    const quantities = [...new Set(input.quantities)].sort((a, b) => a - b);
    const trim = planSingle({ key: s.code, sheetWidth: fig.blank.width, sheetLength: fig.blank.length, sheets: quantities[0] }, r.rollWidths, r.minTrimMm)[0] ?? null;
    return {
      spec: s,
      fig,
      tooling: { ...tooling, newPlates, newDie },
      rates: r,
      quantities,
      result: quantities.map((q) => costFor(q, ei, r)),
      trim,
    };
  }

  async preview(input: z.infer<typeof estimateSchema>) {
    RequestCtx.assert('carton.estimate');
    const c = await this.calc(RequestCtx.companyId(), input);
    return { blank: c.fig.blank, blankM2: c.fig.blankM2, grade: c.fig.grade, strength: c.fig.strength, tooling: c.tooling, result: c.result, trim: c.trim };
  }

  async createEstimate(input: z.infer<typeof estimateSchema>) {
    RequestCtx.assert('carton.estimate');
    const u = RequestCtx.user();
    const c = await this.calc(u.companyId, input);
    const e = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequence.next('CARTON_ESTIMATE', u.companyId, input.date, tx);
      return tx.cartonEstimate.create({
        data: {
          companyId: u.companyId,
          number,
          specId: c.spec.id,
          customerId: input.customerId ?? c.spec.customerId,
          date: input.date,
          kind: input.kind,
          quantities: c.quantities,
          inputs: { rates: c.rates, blank: c.fig.blank, blankM2: c.fig.blankM2, grade: c.fig.grade, strength: c.fig.strength, tooling: c.tooling, trim: c.trim } as unknown as Prisma.InputJsonValue,
          result: c.result as unknown as Prisma.InputJsonValue,
          toolingCharge: D(input.billToolingSeparately ? c.tooling.total : 0),
          billToolingSeparately: input.billToolingSeparately,
          notes: input.notes ?? null,
          createdById: u.id,
          updatedById: u.id,
        },
      });
    });
    await this.audit.record('Carton Estimate', e.id, 'CREATE', null, { number: e.number, spec: c.spec.code });
    return this.estimate(e.id);
  }

  async estimates(status?: string) {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.cartonEstimate.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 300 });
    const [specs, customers] = await Promise.all([
      this.prisma.cartonSpec.findMany({ where: { id: { in: rows.map((r) => r.specId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    const sm = new Map(specs.map((s) => [s.id, s]));
    const cm = new Map(customers.map((c) => [c.id, c.name]));
    return rows.map((e) => {
      const res = e.result as unknown as ReturnType<typeof costFor>[];
      return { id: e.id, number: e.number, date: iso(e.date), kind: e.kind, status: e.status, spec: sm.get(e.specId) ?? null, customer: e.customerId ? (cm.get(e.customerId) ?? null) : null, breaks: res.map((x) => ({ qty: x.qty, unitPrice: x.unitPrice })) };
    });
  }

  async estimate(id: string) {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const e = await this.prisma.cartonEstimate.findFirst({ where: { id, companyId } });
    if (!e) throw new NotFoundException('Estimate not found');
    const [spec, customer, quotation] = await Promise.all([
      this.prisma.cartonSpec.findUnique({ where: { id: e.specId }, select: { id: true, code: true, name: true, style: true, lengthMm: true, widthMm: true, heightMm: true, colours: true, dieCut: true, joint: true } }),
      e.customerId ? this.prisma.customer.findUnique({ where: { id: e.customerId }, select: { id: true, name: true } }) : null,
      e.quotationId ? this.prisma.tradeDocument.findUnique({ where: { id: e.quotationId }, select: { id: true, number: true, status: true, deletedAt: true } }) : null,
    ]);
    return { ...e, date: iso(e.date), toolingCharge: n(e.toolingCharge), spec: spec ? { ...spec, lengthMm: n(spec.lengthMm), widthMm: n(spec.widthMm), heightMm: n(spec.heightMm) } : null, customer, quotation: quotation && !quotation.deletedAt ? quotation : null };
  }

  /** the chosen quantity break becomes a draft sales quotation (tooling as its own line when billed separately) */
  async quote(id: string, input: z.infer<typeof quoteSchema>) {
    RequestCtx.assert('carton.estimate');
    const u = RequestCtx.user();
    const e = await this.prisma.cartonEstimate.findFirst({ where: { id, companyId: u.companyId } });
    if (!e) throw new NotFoundException('Estimate not found');
    if (!e.customerId) throw new ConflictException('The estimate has no customer: set the customer on the box spec or the estimate');
    if (e.quotationId) {
      const q = await this.prisma.tradeDocument.findUnique({ where: { id: e.quotationId } });
      if (q && !q.deletedAt && q.status !== 'CANCELLED') throw new ConflictException(`Already quoted on ${q.number}`);
    }
    const res = (e.result as unknown as ReturnType<typeof costFor>[]).find((x) => x.qty === input.qty);
    if (!res) throw invalid({ qty: 'Choose one of the estimated quantities' });
    const spec = await this.prisma.cartonSpec.findUniqueOrThrow({ where: { id: e.specId } });
    const vat = await this.settings.bool('sales.vatPayer', u.companyId, true);
    const ppn = vat ? await this.prisma.tax.findFirst({ where: { companyId: u.companyId, kind: 'VAT', isActive: true, deletedAt: null, rate: 12, baseNumerator: 11, baseDenominator: 12 } }) : null;
    const dims = `${n(spec.lengthMm)} x ${n(spec.widthMm)}${n(spec.heightMm) ? ` x ${n(spec.heightMm)}` : ''} mm`;
    const what = e.kind === 'MAKLON' ? `Jasa maklon / converting ${spec.name} (${dims}) from the customer's board` : `${spec.name}, ${STYLES[spec.style] ?? spec.style}, ${dims}`;
    const lines: Record<string, unknown>[] = [{ ...(spec.productId && e.kind === 'GOODS' ? { productId: spec.productId } : {}), description: what, qty: res.qty, unitPrice: res.unitPrice, taxId: ppn?.id ?? null }];
    if (e.billToolingSeparately && n(e.toolingCharge) > 0) lines.push({ description: `Printing plates and cutting die for ${spec.code} (one-off)`, qty: 1, unitPrice: n(e.toolingCharge), taxId: ppn?.id ?? null });
    const doc = await this.documents.create(
      'SQ',
      {
        date: localIso(input.date ?? new Date()),
        customerId: e.customerId,
        reference: e.number,
        notes: e.kind === 'MAKLON' ? 'Converting service (jasa maklon): the customer withholds PPh 23 at 2% (PMK 141/2015).' : undefined,
        lines,
      },
      undefined,
      { skipPermission: true },
    );
    await this.prisma.cartonEstimate.update({ where: { id }, data: { quotationId: doc.id, status: 'QUOTED', updatedById: u.id } });
    await this.audit.record('Carton Estimate', id, 'QUOTE', null, { quotationId: doc.id, qty: res.qty });
    return this.estimate(id);
  }

  async setStatus(id: string, status: 'WON' | 'LOST' | 'DRAFT') {
    RequestCtx.assert('carton.estimate');
    const e = await this.prisma.cartonEstimate.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!e) throw new NotFoundException('Estimate not found');
    await this.prisma.cartonEstimate.update({ where: { id }, data: { status: status === 'DRAFT' && e.quotationId ? 'QUOTED' : status, updatedById: RequestCtx.user().id } });
    await this.audit.record('Carton Estimate', id, 'STATUS', { status: e.status }, { status });
    return this.estimate(id);
  }

  // ------------------------------------------------------------------ trim
  async trim(input: z.infer<typeof trimSchema>) {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const r = await this.rates(companyId);
    const rolls = input.rollWidths?.length ? input.rollWidths : r.rollWidths;
    const minTrim = input.minTrim ?? r.minTrimMm;
    const items: (TrimItem & { label: string; grade: string | null })[] = [];
    for (const [i, it] of input.items.entries()) {
      if (it.specId) {
        const s = await this.prisma.cartonSpec.findFirst({ where: { id: it.specId, companyId } });
        if (!s) throw invalid({ items: 'Box specification not found' });
        const fig = await this.specFigures(companyId, s);
        items.push({ key: s.code, label: `${s.code} ${s.name}`, sheetWidth: fig.blank.width, sheetLength: fig.blank.length, sheets: it.qty, grade: fig.grade.code });
      } else {
        if (!it.sheetWidth || !it.sheetLength) throw invalid({ items: `Item ${i + 1}: choose a box spec or enter the sheet size` });
        items.push({ key: it.label || `Item ${i + 1}`, label: it.label || `Item ${i + 1}`, sheetWidth: it.sheetWidth, sheetLength: it.sheetLength, sheets: it.qty, grade: null });
      }
    }
    const pairWarning = items.length === 2 && items[0].grade && items[1].grade && items[0].grade !== items[1].grade ? 'The two items are on different board grades: they cannot run side by side' : null;
    return {
      rolls,
      minTrim,
      items: items.map((x) => ({ key: x.key, label: x.label, sheetWidth: x.sheetWidth, sheetLength: x.sheetLength, sheets: x.sheets, grade: x.grade, options: planSingle(x, rolls, minTrim).slice(0, 6) })),
      pair: items.length === 2 && !pairWarning ? planPair(items[0], items[1], rolls, minTrim).slice(0, 10) : [],
      pairWarning,
    };
  }

  // ------------------------------------------------------------------ tooling
  private shapeTool(t: Prisma.CartonToolGetPayload<object>) {
    return { ...t, cost: n(t.cost), madeOn: iso(t.madeOn), lifeUsedPct: t.lifeImpressions ? Math.round((t.impressions / t.lifeImpressions) * 1000) / 10 : null };
  }

  async tools(f: { specId?: string; status?: string }) {
    RequestCtx.assert('carton.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.cartonTool.findMany({ where: { companyId, ...(f.specId ? { specId: f.specId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: { code: 'asc' } });
    const [specs, customers] = await Promise.all([
      this.prisma.cartonSpec.findMany({ where: { id: { in: rows.map((r) => r.specId!).filter(Boolean) } }, select: { id: true, code: true, name: true } }),
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    const sm = new Map(specs.map((s) => [s.id, s]));
    const cm = new Map(customers.map((c) => [c.id, c.name]));
    return rows.map((t) => ({ ...this.shapeTool(t), spec: t.specId ? (sm.get(t.specId) ?? null) : null, customer: t.customerId ? (cm.get(t.customerId) ?? null) : null }));
  }

  async saveTool(id: string | null, input: z.infer<typeof toolSchema>) {
    RequestCtx.assert('carton.tool.manage');
    const u = RequestCtx.user();
    if (input.owner === 'CUSTOMER' && !input.customerId) throw invalid({ customerId: 'Whose tooling is it?' });
    if (input.specId && !(await this.prisma.cartonSpec.findFirst({ where: { id: input.specId, companyId: u.companyId } }))) throw invalid({ specId: 'Box specification not found' });
    if (await this.prisma.cartonTool.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { ...input, cost: D(input.cost), updatedById: u.id };
    const t = id ? await this.prisma.cartonTool.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.cartonTool.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Carton Tool', t.id, id ? 'UPDATE' : 'CREATE', null, { code: t.code, kind: t.kind });
    return this.shapeTool(t);
  }

  /** impressions run with the tool (a production run); warns near the end of its life */
  async addImpressions(id: string, count: number) {
    RequestCtx.assert('carton.tool.manage');
    if (!(count > 0 && count < 1e8)) throw new BadRequestException('Enter the impressions');
    const t = await this.prisma.cartonTool.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!t) throw new NotFoundException('Tool not found');
    if (t.status !== 'ACTIVE') throw new ConflictException('The tool is retired');
    const u = await this.prisma.cartonTool.update({ where: { id }, data: { impressions: { increment: Math.round(count) }, updatedById: RequestCtx.user().id } });
    return this.shapeTool(u);
  }

  async retireTool(id: string) {
    RequestCtx.assert('carton.tool.manage');
    const t = await this.prisma.cartonTool.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!t) throw new NotFoundException('Tool not found');
    await this.prisma.cartonTool.update({ where: { id }, data: { status: t.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE', updatedById: RequestCtx.user().id } });
    await this.audit.record('Carton Tool', id, t.status === 'ACTIVE' ? 'RETIRE' : 'REACTIVATE');
    return this.shapeTool((await this.prisma.cartonTool.findUnique({ where: { id } }))!);
  }
}
