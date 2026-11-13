import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { InventoryService } from '../documents/inventory.service';
import { DocumentService } from '../documents/document.service';
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import { colorantLoadPct, deltaE00, deltaE76, describe, Lab, labToHex, packingGroup, scaleFormula, UNIT_ML } from './paint-calc';

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optNum = (min: number, max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });
const labNum = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const colourSchema = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(120), collection: optText(60), L: labNum(0, 100), a: labNum(-128, 128), b: labNum(-128, 128), tolerance: optNum(0.05, 10), notes: optText(2000), isActive: z.boolean().default(true) });
export const baseSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  productLine: optText(60),
  baseType: z.enum(['PASTEL', 'MEDIUM', 'DEEP', 'ACCENT', 'CLEAR']),
  maxColorantPct: z.coerce.number().min(0).max(30),
  cans: z.array(z.object({ productId: z.uuid(), litres: z.coerce.number().positive().max(1000) })).min(1).max(12),
  isActive: z.boolean().default(true),
});
export const colorantSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(80), productId: z.uuid(), unitMl: z.coerce.number().positive().max(1e6).default(1000), hex: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()), isActive: z.boolean().default(true) });
export const formulaSchema = z.object({
  colourId: z.uuid(),
  baseId: z.uuid(),
  lines: z.array(z.object({ colorantId: z.uuid(), mlPerLitre: z.coerce.number().positive().max(300) })).min(1).max(12),
  drawL: optNum(0, 100),
  drawA: optNum(-128, 128),
  drawB: optNum(-128, 128),
  notes: optText(2000),
});
export const tintSchema = z.object({ date: z.coerce.date(), warehouseId: z.uuid(), customerId: optUuid, formulaId: z.uuid(), baseProductId: z.uuid(), cans: z.coerce.number().int().min(1).max(10_000), notes: optText(500) });
export const checkSchema = z.object({
  workOrderId: optUuid,
  productId: z.uuid(),
  lotNo: optText(60),
  colourId: z.uuid(),
  L: labNum(0, 100),
  a: labNum(-128, 128),
  b: labNum(-128, 128),
  additions: z.array(z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e6) })).max(12).default([]),
  date: z.coerce.date().optional(),
  notes: optText(1000),
});
export const sdsSchema = z.object({
  productId: z.uuid(),
  version: z.string().trim().min(1).max(20),
  revisionDate: z.coerce.date(),
  language: z.string().trim().min(2).max(10).default('ID'),
  hazardClasses: optText(500),
  pictograms: z.array(z.enum(['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'])).max(9).default([]),
  signalWord: z.enum(['DANGER', 'WARNING', 'NONE']).default('NONE'),
  hStatements: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
  pStatements: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
  components: z.array(z.object({ name: z.string().trim().min(1).max(150), cas: optText(20), pct: optText(20) })).max(40).default([]),
  flashPointC: optNum(-100, 400),
  boilingPointC: optNum(-100, 600),
  unNumber: optText(10),
  shippingName: optText(120),
  transportClass: optText(10),
  packingGroup: z.preprocess((v) => (v === '' ? null : v), z.enum(['I', 'II', 'III']).nullable().optional()),
  leadPpm: optNum(0, 1e6),
  vocGL: optNum(0, 2000),
  notes: optText(2000),
});

type Tx = Prisma.TransactionClient;
type FormulaLine = { colorantId: string; mlPerLitre: number };
type Can = { productId: string; litres: number };

/**
 * Paint add-on: colour standards in CIELAB, tinting bases and colorants, tint formulas (ml per litre of base, approved
 * on a drawdown within dE2000), shop tinting (base and colorants out of stock at cost, draft invoice), colour checks of
 * production batches with tinter additions issued to the work order, certificates of analysis, and safety data sheets
 * / GHS labels (Permenperin 87/2009 jo 23/2013, Kepmenaker 187/1999).
 */
@Injectable()
export class PaintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly inventory: InventoryService,
    private readonly documents: DocumentService,
    private readonly mfg: ManufacturingService,
  ) {}

  private async opts(companyId: string) {
    const [unit, tintFee, margin, tol, lead] = await Promise.all([
      this.settings.str('paint.dispenserUnit', companyId, 'SHOT48'),
      this.settings.num('paint.tintFee', companyId, 5000),
      this.settings.num('paint.tintMarginPct', companyId, 100),
      this.settings.num('paint.deTolerance', companyId, 1),
      this.settings.num('paint.leadLimitPpm', companyId, 90),
    ]);
    return { unit: (UNIT_ML[unit] ? unit : 'ML') as keyof typeof UNIT_ML, tintFee, margin, tol, lead };
  }

  async meta() {
    RequestCtx.assert('paint.read');
    return { ...(await this.opts(RequestCtx.companyId())), units: Object.keys(UNIT_ML) };
  }

  // ------------------------------------------------------------------ colours
  private shapeColour(c: Prisma.PaintColourGetPayload<object>, tol: number) {
    const lab = { L: n(c.L), a: n(c.a), b: n(c.b) };
    return { ...c, ...lab, tolerance: nn(c.tolerance), limit: nn(c.tolerance) ?? tol, hex: labToHex(lab) };
  }

  async colours(q?: string) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const { tol } = await this.opts(companyId);
    const rows = await this.prisma.paintColour.findMany({ where: { companyId, ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: { code: 'asc' }, take: 500 });
    const counts = await this.prisma.tintFormula.groupBy({ by: ['colourId', 'status'], where: { companyId, colourId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return rows.map((c) => ({ ...this.shapeColour(c, tol), approved: counts.filter((x) => x.colourId === c.id && x.status === 'APPROVED').reduce((a, x) => a + x._count._all, 0) }));
  }

  async saveColour(id: string | null, input: z.infer<typeof colourSchema>) {
    RequestCtx.assert('paint.colour.manage');
    const u = RequestCtx.user();
    if (await this.prisma.paintColour.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { ...input, L: D(input.L), a: D(input.a), b: D(input.b), tolerance: input.tolerance ? D(input.tolerance) : null, updatedById: u.id };
    const c = id ? await this.prisma.paintColour.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.paintColour.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('Paint Colour', c.id, id ? 'UPDATE' : 'CREATE', null, { code: c.code });
    return this.shapeColour(c, (await this.opts(u.companyId)).tol);
  }

  // ------------------------------------------------------------------ bases & colorants
  async bases() {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.paintBase.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    const ids = rows.flatMap((b) => (b.cans as Can[]).map((c) => c.productId));
    const pm = new Map((await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, salePrice: true } })).map((p) => [p.id, p]));
    return rows.map((b) => ({ ...b, maxColorantPct: n(b.maxColorantPct), cans: (b.cans as Can[]).map((c) => ({ ...c, product: pm.get(c.productId) ? { ...pm.get(c.productId)!, salePrice: n(pm.get(c.productId)!.salePrice) } : null })) }));
  }

  async saveBase(id: string | null, input: z.infer<typeof baseSchema>) {
    RequestCtx.assert('paint.colour.manage');
    const u = RequestCtx.user();
    const ids = [...new Set(input.cans.map((c) => c.productId))];
    if (ids.length !== input.cans.length) throw invalid({ cans: 'Each can size its own product' });
    if ((await this.prisma.product.count({ where: { id: { in: ids }, companyId: u.companyId, type: 'STOCK', deletedAt: null } })) !== ids.length) throw invalid({ cans: 'Choose the stock products of the base cans' });
    if (await this.prisma.paintBase.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { ...input, maxColorantPct: D(input.maxColorantPct), cans: input.cans as Prisma.InputJsonValue };
    const b = id ? await this.prisma.paintBase.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.paintBase.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Paint Base', b.id, id ? 'UPDATE' : 'CREATE', null, { code: b.code });
    return b;
  }

  async colorants() {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.paintColorant.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    const ids = rows.map((r) => r.productId);
    const [pm, bal] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, purchasePrice: true } }),
      this.prisma.stockBalance.groupBy({ by: ['productId'], where: { productId: { in: ids } }, _sum: { qty: true } }),
    ]);
    const costs = await this.unitCosts(ids);
    return rows.map((c) => {
      const p = pm.find((x) => x.id === c.productId);
      const perUnit = costs.get(c.productId) ?? n(p?.purchasePrice);
      return { ...c, unitMl: n(c.unitMl), product: p ? { code: p.code, name: p.name } : null, stockMl: Math.round(n(bal.find((x) => x.productId === c.productId)?._sum.qty) * n(c.unitMl)), costPerMl: r2((perUnit / n(c.unitMl)) * 100) / 100 };
    });
  }

  /** average cost per stock unit across warehouses (falls back to the purchase price) */
  private async unitCosts(productIds: string[]) {
    const rows = await this.prisma.stockBalance.findMany({ where: { productId: { in: productIds } }, select: { productId: true, qty: true, avgCost: true } });
    const m = new Map<string, { q: number; v: number }>();
    for (const r of rows) {
      const x = m.get(r.productId) ?? { q: 0, v: 0 };
      if (n(r.qty) > 0) {
        x.q += n(r.qty);
        x.v += n(r.qty) * n(r.avgCost);
      }
      m.set(r.productId, x);
    }
    const out = new Map<string, number>();
    for (const [k, x] of m) if (x.q > 0) out.set(k, x.v / x.q);
    const missing = productIds.filter((id) => !out.has(id));
    if (missing.length) for (const p of await this.prisma.product.findMany({ where: { id: { in: missing } }, select: { id: true, purchasePrice: true } })) out.set(p.id, n(p.purchasePrice));
    return out;
  }

  async saveColorant(id: string | null, input: z.infer<typeof colorantSchema>) {
    RequestCtx.assert('paint.colour.manage');
    const u = RequestCtx.user();
    if (!(await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, type: 'STOCK', deletedAt: null } }))) throw invalid({ productId: 'Choose the stock product of the colorant' });
    if (await this.prisma.paintColorant.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { ...input, unitMl: D(input.unitMl) };
    const c = id ? await this.prisma.paintColorant.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.paintColorant.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Paint Colorant', c.id, id ? 'UPDATE' : 'CREATE', null, { code: c.code });
    return c;
  }

  // ------------------------------------------------------------------ formulas
  private async shapeFormulas(companyId: string, rows: Prisma.TintFormulaGetPayload<object>[]) {
    const [colours, bases, colorants, o] = await Promise.all([
      this.prisma.paintColour.findMany({ where: { id: { in: rows.map((r) => r.colourId) } } }),
      this.prisma.paintBase.findMany({ where: { id: { in: rows.map((r) => r.baseId) } } }),
      this.prisma.paintColorant.findMany({ where: { companyId } }),
      this.opts(companyId),
    ]);
    return rows.map((f) => {
      const c = colours.find((x) => x.id === f.colourId)!;
      const b = bases.find((x) => x.id === f.baseId)!;
      const lines = f.lines as FormulaLine[];
      const total = lines.reduce((a, l) => a + l.mlPerLitre, 0);
      return {
        ...f,
        drawL: nn(f.drawL),
        drawA: nn(f.drawA),
        drawB: nn(f.drawB),
        dE00: nn(f.dE00),
        colour: { id: c.id, code: c.code, name: c.name, hex: labToHex({ L: n(c.L), a: n(c.a), b: n(c.b) }), limit: nn(c.tolerance) ?? o.tol },
        base: { id: b.id, code: b.code, name: b.name, baseType: b.baseType, maxColorantPct: n(b.maxColorantPct), cans: b.cans as Can[] },
        lines: lines.map((l) => ({ ...l, colorant: colorants.find((x) => x.id === l.colorantId) ? { code: colorants.find((x) => x.id === l.colorantId)!.code, name: colorants.find((x) => x.id === l.colorantId)!.name, hex: colorants.find((x) => x.id === l.colorantId)!.hex } : null })),
        loadPct: colorantLoadPct(total),
        drawHex: f.drawL !== null ? labToHex({ L: n(f.drawL), a: n(f.drawA), b: n(f.drawB) }) : null,
      };
    });
  }

  async formulas(f: { colourId?: string; status?: string }) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.tintFormula.findMany({ where: { companyId, ...(f.colourId ? { colourId: f.colourId } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: [{ colourId: 'asc' }, { baseId: 'asc' }, { version: 'desc' }], take: 500 });
    return this.shapeFormulas(companyId, rows);
  }

  async saveFormula(id: string | null, input: z.infer<typeof formulaSchema>) {
    RequestCtx.assert('paint.colour.manage');
    const u = RequestCtx.user();
    const [colour, base] = await Promise.all([this.prisma.paintColour.findFirst({ where: { id: input.colourId, companyId: u.companyId } }), this.prisma.paintBase.findFirst({ where: { id: input.baseId, companyId: u.companyId } })]);
    if (!colour) throw invalid({ colourId: 'Colour not found' });
    if (!base) throw invalid({ baseId: 'Base not found' });
    const ids = [...new Set(input.lines.map((l) => l.colorantId))];
    if (ids.length !== input.lines.length) throw invalid({ lines: 'Each colorant once' });
    if ((await this.prisma.paintColorant.count({ where: { id: { in: ids }, companyId: u.companyId } })) !== ids.length) throw invalid({ lines: 'Unknown colorant' });
    const load = colorantLoadPct(input.lines.reduce((a, l) => a + l.mlPerLitre, 0));
    if (load > n(base.maxColorantPct)) throw invalid({ lines: `Colorant ${load}% of the volume is above the ${n(base.maxColorantPct)}% the ${base.name} takes: use a deeper base` });
    const hasDraw = input.drawL !== null && input.drawL !== undefined && input.drawA !== null && input.drawA !== undefined && input.drawB !== null && input.drawB !== undefined;
    const dE = hasDraw ? deltaE00({ L: n(colour.L), a: n(colour.a), b: n(colour.b) }, { L: input.drawL!, a: input.drawA!, b: input.drawB! }).dE : null;
    const data = { colourId: input.colourId, baseId: input.baseId, lines: input.lines as Prisma.InputJsonValue, drawL: hasDraw ? D(input.drawL!) : null, drawA: hasDraw ? D(input.drawA!) : null, drawB: hasDraw ? D(input.drawB!) : null, dE00: dE === null ? null : D(dE), notes: input.notes ?? null };
    let f;
    if (id) {
      const before = await this.prisma.tintFormula.findFirst({ where: { id, companyId: u.companyId } });
      if (!before) throw new NotFoundException('Formula not found');
      if (before.status !== 'DRAFT') throw new ConflictException('An approved formula is not changed: make a new version');
      f = await this.prisma.tintFormula.update({ where: { id }, data });
    } else {
      const last = await this.prisma.tintFormula.findFirst({ where: { companyId: u.companyId, colourId: input.colourId, baseId: input.baseId }, orderBy: { version: 'desc' } });
      f = await this.prisma.tintFormula.create({ data: { ...data, companyId: u.companyId, version: (last?.version ?? 0) + 1, createdById: u.id } });
    }
    await this.audit.record('Tint Formula', f.id, id ? 'UPDATE' : 'CREATE', null, { colour: colour.code, base: base.code, version: f.version });
    return (await this.shapeFormulas(u.companyId, [f]))[0];
  }

  /** approval needs a drawdown within the colour's dE2000 limit; the earlier approved version of the colour on that base retires */
  async approveFormula(id: string) {
    RequestCtx.assert('paint.colour.manage');
    const u = RequestCtx.user();
    const f = await this.prisma.tintFormula.findFirst({ where: { id, companyId: u.companyId } });
    if (!f) throw new NotFoundException('Formula not found');
    if (f.status !== 'DRAFT') throw new ConflictException('Only a draft is approved');
    const colour = await this.prisma.paintColour.findUniqueOrThrow({ where: { id: f.colourId } });
    const limit = nn(colour.tolerance) ?? (await this.opts(u.companyId)).tol;
    if (f.dE00 === null) throw new ConflictException('Measure a drawdown of the formula first');
    if (n(f.dE00) > limit) throw new ConflictException(`Drawdown dE2000 ${n(f.dE00)} is above the ${limit} limit: correct the formula`);
    await this.prisma.$transaction([
      this.prisma.tintFormula.updateMany({ where: { companyId: u.companyId, colourId: f.colourId, baseId: f.baseId, status: 'APPROVED' }, data: { status: 'RETIRED' } }),
      this.prisma.tintFormula.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: u.id } }),
    ]);
    await this.audit.record('Tint Formula', id, 'APPROVE', null, { dE00: n(f.dE00) });
    return (await this.shapeFormulas(u.companyId, [(await this.prisma.tintFormula.findUnique({ where: { id } }))!]))[0];
  }

  async retireFormula(id: string) {
    RequestCtx.assert('paint.colour.manage');
    const f = await this.prisma.tintFormula.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!f) throw new NotFoundException('Formula not found');
    await this.prisma.tintFormula.update({ where: { id }, data: { status: 'RETIRED' } });
    await this.audit.record('Tint Formula', id, 'RETIRE');
    return { ok: true };
  }

  // ------------------------------------------------------------------ shop tinting
  /** what the machine dispenses for a can and what the tinted can costs and sells for */
  async quote(formulaId: string, baseProductId: string, cans = 1) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const f = await this.prisma.tintFormula.findFirst({ where: { id: formulaId, companyId } });
    if (!f) throw new NotFoundException('Formula not found');
    const base = await this.prisma.paintBase.findUniqueOrThrow({ where: { id: f.baseId } });
    const can = (base.cans as Can[]).find((c) => c.productId === baseProductId);
    if (!can) throw invalid({ baseProductId: `Not a can of ${base.name}` });
    const o = await this.opts(companyId);
    const lines = f.lines as FormulaLine[];
    const colorants = await this.prisma.paintColorant.findMany({ where: { id: { in: lines.map((l) => l.colorantId) } } });
    const costs = await this.unitCosts([baseProductId, ...colorants.map((c) => c.productId)]);
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: baseProductId }, select: { code: true, name: true, salePrice: true } });
    const scaled = scaleFormula(lines, can.litres, o.unit).map((s) => {
      const c = colorants.find((x) => x.id === s.colorantId)!;
      const costPerMl = (costs.get(c.productId) ?? 0) / n(c.unitMl);
      return { ...s, code: c.code, name: c.name, hex: c.hex, productId: c.productId, unitMl: n(c.unitMl), cost: r2(s.ml * costPerMl) };
    });
    const colorantCost = r2(scaled.reduce((a, s) => a + s.cost, 0));
    const baseCost = r2(costs.get(baseProductId) ?? 0);
    const unitPrice = Math.round(n(product.salePrice) + colorantCost * (1 + o.margin / 100) + o.tintFee);
    return { status: f.status, unit: o.unit, can: { ...can, product: { code: product.code, name: product.name, salePrice: n(product.salePrice) } }, dispensed: scaled, perCan: { baseCost, colorantCost, tintFee: o.tintFee, unitPrice }, cans, total: unitPrice * cans };
  }

  /** a tinting job: base cans and colorants leave the stock at cost (Dr COGS / Cr Inventory) and a draft invoice is made */
  async tint(input: z.infer<typeof tintSchema>) {
    RequestCtx.assert('paint.tint');
    const u = RequestCtx.user();
    const f = await this.prisma.tintFormula.findFirst({ where: { id: input.formulaId, companyId: u.companyId } });
    if (!f) throw invalid({ formulaId: 'Formula not found' });
    if (f.status !== 'APPROVED') throw new ConflictException('Only an approved formula is dispensed');
    if (!(await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, companyId: u.companyId } }))) throw invalid({ warehouseId: 'Warehouse not found' });
    const q = await this.quote(input.formulaId, input.baseProductId, input.cans);
    const allowNegative = await this.settings.bool('inventory.allowNegative', u.companyId, false);
    const colour = await this.prisma.paintColour.findUniqueOrThrow({ where: { id: f.colourId } });
    const id = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.sequence.next('TINT_JOB', u.companyId, input.date, tx);
        const job = await tx.tintJob.create({
          data: { companyId: u.companyId, branchId: u.branchId ?? null, number, date: input.date, warehouseId: input.warehouseId, customerId: input.customerId ?? null, colourId: f.colourId, formulaId: f.id, baseProductId: input.baseProductId, canLitres: D(q.can.litres), cans: input.cans, dispensed: q.dispensed as unknown as Prisma.InputJsonValue, tintFee: D(q.perCan.tintFee * input.cans), unitPrice: D(q.perCan.unitPrice), notes: input.notes ?? null, createdById: u.id },
        });
        const base = { companyId: u.companyId, branchId: u.branchId ?? null, warehouseId: input.warehouseId, date: input.date, docType: 'TINT', documentId: job.id, documentNumber: number, allowNegative };
        const baseProduct = await tx.product.findUniqueOrThrow({ where: { id: input.baseProductId }, select: { name: true } });
        const rb = await this.inventory.move(tx, { ...base, productId: input.baseProductId, productName: baseProduct.name, qty: D(-input.cans) });
        let colorantCost = D(0);
        for (const d of q.dispensed) {
          const qty = D((d.ml * input.cans) / d.unitMl).toDecimalPlaces(4);
          if (qty.lte(0)) continue;
          const r = await this.inventory.move(tx, { ...base, productId: d.productId, productName: d.name, qty: qty.neg() });
          colorantCost = colorantCost.plus(r.totalCost.abs());
        }
        const baseCost = round(rb.totalCost.abs());
        colorantCost = round(colorantCost);
        const total = baseCost.plus(colorantCost);
        if (total.gt(0))
          await this.journal.post(tx, {
            companyId: u.companyId,
            branchId: u.branchId ?? null,
            date: input.date,
            description: `${number}: ${input.cans} x ${q.can.product.name} tinted ${colour.code}`,
            reference: number,
            sourceType: 'TINT',
            sourceId: job.id,
            lines: [
              { key: 'COGS', debit: total, description: `Tinted ${colour.code} ${colour.name}`, customerId: input.customerId ?? null },
              { key: 'INVENTORY', credit: total, description: 'Base and colorants' },
            ],
          });
        await tx.tintJob.update({ where: { id: job.id }, data: { baseCost, colorantCost } });
        return job.id;
      },
      { timeout: 60_000 },
    );
    // draft invoice for the customer (the sale; the stock already left with the job)
    if (input.customerId) {
      const productId = await this.tintedProduct(u.companyId);
      const vat = await this.settings.bool('sales.vatPayer', u.companyId, true);
      const ppn = vat ? await this.prisma.tax.findFirst({ where: { companyId: u.companyId, kind: 'VAT', isActive: true, deletedAt: null, rate: 12, baseNumerator: 11, baseDenominator: 12 } }) : null;
      const job = await this.prisma.tintJob.findUniqueOrThrow({ where: { id } });
      const si = await this.documents.create(
        'SI',
        { date: localIso(input.date), customerId: input.customerId, reference: job.number, lines: [{ productId, description: `${q.can.product.name} tinted ${colour.code} ${colour.name} (${q.can.litres} L)`, qty: input.cans, unitPrice: q.perCan.unitPrice, taxId: ppn?.id ?? null }] },
        undefined,
        { skipPermission: true },
      );
      await this.prisma.tintJob.update({ where: { id }, data: { invoiceId: si.id } });
    }
    await this.audit.record('Tint Job', id, 'CREATE', null, { colour: colour.code, cans: input.cans });
    return this.job(id);
  }

  /** a service item for tinted cans: income to Sales (the goods), no stock of its own */
  private async tintedProduct(companyId: string) {
    const found = await this.prisma.product.findFirst({ where: { companyId, code: 'TINTED-PAINT', deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const income = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, 'SALES'));
    const p = await this.prisma.product.create({ data: { companyId, code: 'TINTED-PAINT', name: 'Tinted paint', type: 'SERVICE', incomeAccountId: income, isPurchasable: false, description: 'Made by the paint module: tinted cans (the base and colorants leave the stock with the tinting job)', createdById: RequestCtx.user().id } });
    return p.id;
  }

  async jobs(f: { from?: string; to?: string }) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.tintJob.findMany({ where: { companyId, ...(f.from || f.to ? { date: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 300 });
    const [colours, customers, products] = await Promise.all([
      this.prisma.paintColour.findMany({ where: { id: { in: rows.map((r) => r.colourId) } } }),
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.baseProductId) } }, select: { id: true, name: true } }),
    ]);
    return rows.map((j) => {
      const c = colours.find((x) => x.id === j.colourId)!;
      return { id: j.id, number: j.number, date: iso(j.date), status: j.status, cans: j.cans, canLitres: n(j.canLitres), colour: { code: c.code, name: c.name, hex: labToHex({ L: n(c.L), a: n(c.a), b: n(c.b) }) }, base: products.find((p) => p.id === j.baseProductId)?.name ?? '', customer: customers.find((x) => x.id === j.customerId)?.name ?? null, cost: n(j.baseCost) + n(j.colorantCost), price: n(j.unitPrice) * j.cans };
    });
  }

  async job(id: string) {
    RequestCtx.assert('paint.read');
    const j = await this.prisma.tintJob.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!j) throw new NotFoundException('Tinting job not found');
    const [c, cust, inv, prod] = await Promise.all([
      this.prisma.paintColour.findUniqueOrThrow({ where: { id: j.colourId } }),
      j.customerId ? this.prisma.customer.findUnique({ where: { id: j.customerId }, select: { id: true, name: true } }) : null,
      j.invoiceId ? this.prisma.tradeDocument.findUnique({ where: { id: j.invoiceId }, select: { id: true, number: true, status: true, deletedAt: true } }) : null,
      this.prisma.product.findUnique({ where: { id: j.baseProductId }, select: { code: true, name: true } }),
    ]);
    return { ...j, date: iso(j.date), canLitres: n(j.canLitres), baseCost: n(j.baseCost), colorantCost: n(j.colorantCost), tintFee: n(j.tintFee), unitPrice: n(j.unitPrice), colour: { code: c.code, name: c.name, hex: labToHex({ L: n(c.L), a: n(c.a), b: n(c.b) }) }, customer: cust, invoice: inv && !inv.deletedAt ? inv : null, base: prod };
  }

  /** mistint / cancellation: stock back, journal voided; a draft invoice is dropped, a confirmed one must be credited first */
  async cancelTint(id: string) {
    RequestCtx.assert('paint.tint');
    const u = RequestCtx.user();
    const j = await this.prisma.tintJob.findFirst({ where: { id, companyId: u.companyId } });
    if (!j) throw new NotFoundException('Tinting job not found');
    if (j.status !== 'DONE') throw new ConflictException('Already cancelled');
    const inv = j.invoiceId ? await this.prisma.tradeDocument.findUnique({ where: { id: j.invoiceId } }) : null;
    if (inv && !inv.deletedAt && inv.status !== 'DRAFT' && inv.status !== 'CANCELLED') throw new ConflictException(`Invoice ${inv.number} is confirmed: cancel it or issue a credit note first`);
    const allowNegative = await this.settings.bool('inventory.allowNegative', u.companyId, false);
    await this.prisma.$transaction(async (tx) => {
      await this.inventory.reverse(tx, id, allowNegative);
      await this.journal.voidBySource(tx, 'TINT', id);
      if (inv && inv.status === 'DRAFT' && !inv.deletedAt) await tx.tradeDocument.update({ where: { id: inv.id }, data: { deletedAt: new Date(), updatedById: u.id } });
      await tx.tintJob.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Tint Job', id, 'CANCEL', { status: 'DONE' }, { status: 'CANCELLED' });
    return this.job(id);
  }

  // ------------------------------------------------------------------ colour lab
  /** a batch measured against its standard; tinters added after a failed check are issued to the work order */
  async check(input: z.infer<typeof checkSchema>) {
    RequestCtx.assert('paint.lab');
    const u = RequestCtx.user();
    input.additions ??= [];
    const colour = await this.prisma.paintColour.findFirst({ where: { id: input.colourId, companyId: u.companyId } });
    if (!colour) throw invalid({ colourId: 'Colour not found' });
    const wo = input.workOrderId ? await this.prisma.workOrder.findFirst({ where: { id: input.workOrderId, companyId: u.companyId, deletedAt: null } }) : null;
    if (input.workOrderId && !wo) throw invalid({ workOrderId: 'Work order not found' });
    if (wo && wo.productId !== input.productId) throw invalid({ productId: 'Not the product of the work order' });
    if (input.additions.length && !wo) throw invalid({ additions: 'Additions are issued to a work order: choose it' });
    if (input.additions.length && wo!.status !== 'RELEASED') throw new ConflictException('The work order is not released (or already completed)');
    const limit = nn(colour.tolerance) ?? (await this.opts(u.companyId)).tol;
    const std: Lab = { L: n(colour.L), a: n(colour.a), b: n(colour.b) };
    const trial: Lab = { L: input.L, a: input.a, b: input.b };
    const d00 = deltaE00(std, trial);
    const d76 = deltaE76(std, trial);
    const seq = (await this.prisma.colourCheck.count({ where: { companyId: u.companyId, workOrderId: wo?.id ?? undefined, productId: input.productId, lotNo: input.lotNo ?? undefined } })) + 1;
    const pass = d00.dE <= limit;
    if (pass && input.additions.length) throw invalid({ additions: 'The batch is within tolerance: no additions' });
    // additions: new work order lines for the tinters, issued at once
    if (input.additions.length) {
      const ids = [...new Set(input.additions.map((a) => a.productId))];
      if ((await this.prisma.product.count({ where: { id: { in: ids }, companyId: u.companyId, type: 'STOCK', deletedAt: null } })) !== ids.length) throw invalid({ additions: 'Choose stock tinters' });
      const lineIds: { lineId: string; qty: number }[] = [];
      const last = await this.prisma.workOrderLine.findFirst({ where: { workOrderId: wo!.id }, orderBy: { lineNo: 'desc' } });
      let lineNo = last?.lineNo ?? 0;
      for (const a of input.additions) {
        const l = await this.prisma.workOrderLine.create({ data: { workOrderId: wo!.id, lineNo: ++lineNo, productId: a.productId, plannedQty: D(a.qty) } });
        lineIds.push({ lineId: l.id, qty: a.qty });
      }
      try {
        await this.mfg.issue(wo!.id, { date: input.date ?? new Date(localIso()), lines: lineIds });
      } catch (e) {
        await this.prisma.workOrderLine.deleteMany({ where: { id: { in: lineIds.map((x) => x.lineId) }, issuedQty: 0 } });
        throw e;
      }
    }
    const number = await this.prisma.$transaction((tx: Tx) => this.sequence.next('COLOUR_CHECK', u.companyId, new Date(), tx));
    const c = await this.prisma.colourCheck.create({
      data: { companyId: u.companyId, number, workOrderId: wo?.id ?? null, productId: input.productId, lotNo: input.lotNo ?? null, colourId: colour.id, seq, L: D(input.L), a: D(input.a), b: D(input.b), dE76: D(d76), dE00: D(d00.dE), tolerance: D(limit), pass, reading: describe(std, trial), additions: input.additions.length ? (input.additions as Prisma.InputJsonValue) : Prisma.DbNull, notes: input.notes ?? null, createdById: u.id },
    });
    await this.audit.record('Colour Check', c.id, 'CREATE', null, { dE00: d00.dE, pass, additions: input.additions.length });
    return { ...this.shapeCheck(c), dL: d00.dL, dC: d00.dC, dH: d00.dH, stdHex: labToHex(std), trialHex: labToHex(trial) };
  }

  private shapeCheck(c: Prisma.ColourCheckGetPayload<object>) {
    return { ...c, L: n(c.L), a: n(c.a), b: n(c.b), dE76: n(c.dE76), dE00: n(c.dE00), tolerance: n(c.tolerance), hex: labToHex({ L: n(c.L), a: n(c.a), b: n(c.b) }) };
  }

  async checks(f: { workOrderId?: string }) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.colourCheck.findMany({ where: { companyId, ...(f.workOrderId ? { workOrderId: f.workOrderId } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 });
    const [colours, products, orders] = await Promise.all([
      this.prisma.paintColour.findMany({ where: { id: { in: rows.map((r) => r.colourId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.workOrder.findMany({ where: { id: { in: rows.map((r) => r.workOrderId!).filter(Boolean) } }, select: { id: true, number: true } }),
    ]);
    const pm = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.flatMap((r) => ((r.additions as { productId: string }[] | null) ?? []).map((a) => a.productId)) } }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
    return rows.map((c) => ({ ...this.shapeCheck(c), colour: colours.find((x) => x.id === c.colourId) ?? null, product: products.find((x) => x.id === c.productId) ?? null, workOrder: orders.find((x) => x.id === c.workOrderId) ?? null, additions: ((c.additions as { productId: string; qty: number }[] | null) ?? []).map((a) => ({ ...a, code: pm.get(a.productId) ?? '' })) }));
  }

  /** certificate of analysis of a production lot: the QC inspection results, the last colour check of the batch, lead and VOC from the SDS */
  async coa(inspectionId: string) {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const i = await this.prisma.qcInspection.findFirst({ where: { id: inspectionId, companyId }, include: { results: { orderBy: { seq: 'asc' } } } });
    if (!i) throw new NotFoundException('Inspection not found');
    if (i.status !== 'PASSED' && i.status !== 'CONDITIONAL') throw new ConflictException('A certificate is issued for a passed inspection only');
    const [product, colourCheck, sds, company] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: i.productId }, select: { code: true, name: true } }),
      i.sourceType === 'WO' ? this.prisma.colourCheck.findFirst({ where: { companyId, workOrderId: i.sourceId }, orderBy: { createdAt: 'desc' } }) : null,
      this.prisma.productSds.findFirst({ where: { companyId, productId: i.productId, isCurrent: true } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    ]);
    const colour = colourCheck ? await this.prisma.paintColour.findUnique({ where: { id: colourCheck.colourId }, select: { code: true, name: true } }) : null;
    const lead = await this.opts(companyId);
    return {
      company: company?.name,
      number: i.number,
      product,
      lotNo: i.lotNo,
      batch: i.sourceNumber,
      qty: n(i.qty),
      inspectedAt: i.inspectedAt,
      status: i.status,
      results: i.results.map((r) => ({ name: r.name, unit: r.unit, method: r.method, min: nn(r.min), max: nn(r.max), value: r.valueNumber !== null ? n(r.valueNumber) : r.valueText, pass: r.pass })),
      colour: colourCheck && colour ? { standard: `${colour.code} ${colour.name}`, dE00: n(colourCheck.dE00), tolerance: n(colourCheck.tolerance), pass: colourCheck.pass, checks: colourCheck.seq } : null,
      lead: sds?.leadPpm !== null && sds?.leadPpm !== undefined ? { ppm: n(sds.leadPpm), limit: lead.lead, pass: n(sds.leadPpm) <= lead.lead } : null,
      vocGL: nn(sds?.vocGL),
    };
  }

  /** production inspections (passed) that can get a certificate */
  async coaList() {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.qcInspection.findMany({ where: { companyId, stage: 'PRODUCTION', status: { in: ['PASSED', 'CONDITIONAL'] } }, orderBy: { inspectedAt: 'desc' }, take: 100 });
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } });
    return rows.map((r) => ({ id: r.id, number: r.number, batch: r.sourceNumber, lotNo: r.lotNo, inspectedAt: r.inspectedAt, product: products.find((p) => p.id === r.productId) ?? null }));
  }

  // ------------------------------------------------------------------ SDS / GHS
  private shapeSds(s: Prisma.ProductSdsGetPayload<object>) {
    return { ...s, revisionDate: iso(s.revisionDate), nextReview: iso(s.nextReview), flashPointC: nn(s.flashPointC), boilingPointC: nn(s.boilingPointC), leadPpm: nn(s.leadPpm), vocGL: nn(s.vocGL), dueForReview: s.nextReview < new Date() };
  }

  async sdsList() {
    RequestCtx.assert('paint.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.productSds.findMany({ where: { companyId, isCurrent: true }, orderBy: { nextReview: 'asc' } });
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } });
    const lead = (await this.opts(companyId)).lead;
    return rows.map((s) => ({ ...this.shapeSds(s), product: products.find((p) => p.id === s.productId) ?? null, leadOver: s.leadPpm !== null && n(s.leadPpm) > lead }));
  }

  async sds(id: string) {
    RequestCtx.assert('paint.read');
    const s = await this.prisma.productSds.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Safety data sheet not found');
    const [product, history, company] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: s.productId }, select: { id: true, code: true, name: true } }),
      this.prisma.productSds.findMany({ where: { companyId: s.companyId, productId: s.productId }, orderBy: { revisionDate: 'desc' }, select: { id: true, version: true, revisionDate: true, isCurrent: true } }),
      this.prisma.company.findUnique({ where: { id: s.companyId }, select: { name: true, address: true, phone: true } }),
    ]);
    return { ...this.shapeSds(s), product, company, history: history.map((h) => ({ ...h, revisionDate: iso(h.revisionDate) })) };
  }

  /** a new SDS version: the earlier one stops being current; review again within 5 years (Permenperin 23/2013 Art. 11) */
  async saveSds(input: z.infer<typeof sdsSchema>) {
    RequestCtx.assert('paint.sds.manage');
    const u = RequestCtx.user();
    input = { ...input, pictograms: input.pictograms ?? [], hStatements: input.hStatements ?? [], pStatements: input.pStatements ?? [], components: input.components ?? [], signalWord: input.signalWord ?? 'NONE', language: input.language ?? 'ID' };
    if (!(await this.prisma.product.findFirst({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ productId: 'Product not found' });
    if (input.signalWord === 'NONE' && input.pictograms.some((p) => p !== 'GHS07')) throw invalid({ signalWord: 'A hazard pictogram goes with a signal word (Bahaya / Awas)' });
    if (input.unNumber && !/^(UN)?\d{4}$/i.test(input.unNumber)) throw invalid({ unNumber: 'Four digits, e.g. UN1263' });
    const pg = input.packingGroup ?? (input.unNumber ? packingGroup(input.flashPointC ?? null, input.boilingPointC ?? null) : null);
    const next = new Date(input.revisionDate);
    next.setUTCFullYear(next.getUTCFullYear() + 5);
    const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : D(v));
    const s = await this.prisma.$transaction(async (tx) => {
      await tx.productSds.updateMany({ where: { companyId: u.companyId, productId: input.productId, isCurrent: true }, data: { isCurrent: false } });
      return tx.productSds.create({
        data: {
          ...input,
          companyId: u.companyId,
          unNumber: input.unNumber ? `UN${input.unNumber.replace(/^UN/i, '')}` : null,
          packingGroup: pg,
          nextReview: next,
          pictograms: input.pictograms,
          hStatements: input.hStatements,
          pStatements: input.pStatements,
          components: input.components,
          flashPointC: dec(input.flashPointC),
          boilingPointC: dec(input.boilingPointC),
          leadPpm: dec(input.leadPpm),
          vocGL: dec(input.vocGL),
          createdById: u.id,
          updatedById: u.id,
        },
      });
    });
    await this.audit.record('Safety Data Sheet', s.id, 'CREATE', null, { productId: input.productId, version: input.version });
    return this.sds(s.id);
  }
}
