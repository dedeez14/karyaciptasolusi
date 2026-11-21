import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const UUID = /^[0-9a-f-]{36}$/i;
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(-1e12).max(1e12).nullable().optional());

export const planSchema = z
  .object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(150),
    stage: z.enum(['RECEIPT', 'PRODUCTION']),
    productId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
    categoryId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
    sampling: optText(200),
    holdLots: z.boolean().default(true),
    isActive: z.boolean().default(true),
    params: z
      .array(z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(['NUMBER', 'CHECK', 'TEXT']), unit: optText(20), min: optNum, max: optNum, target: optNum, method: optText(200), critical: z.boolean().default(true) }))
      .min(1, 'Add at least one check')
      .max(60),
  })
  .superRefine((p, ctx) =>
    p.params.forEach((x, i) => {
      if (x.kind === 'NUMBER' && x.min === null && x.max === null && x.min === undefined) ctx.addIssue({ code: 'custom', path: ['params', i, 'min'], message: 'Give a minimum and / or maximum' });
      if (x.min !== null && x.min !== undefined && x.max !== null && x.max !== undefined && x.min > x.max) ctx.addIssue({ code: 'custom', path: ['params', i, 'max'], message: 'Below the minimum' });
    }),
  );
export const resultsSchema = z.object({
  sampleQty: z.coerce.number().min(0).max(1e9).default(0),
  notes: optText(2000),
  results: z.array(z.object({ id: z.uuid(), valueNumber: optNum, valueText: optText(500), pass: z.boolean().nullable().optional() })).max(60),
});
export const decideSchema = z.object({ decision: z.enum(['PASSED', 'FAILED', 'CONDITIONAL']), notes: optText(2000) });
export const ncrSchema = z.object({
  productId: z.uuid(),
  lotId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  supplierId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  qty: z.coerce.number().min(0).max(1e9).default(0),
  description: z.string().trim().min(3).max(4000),
});
export const ncrUpdateSchema = z.object({
  disposition: z.preprocess((v) => (v === '' ? null : v), z.enum(['REWORK', 'SCRAP', 'USE_AS_IS', 'RETURN', 'SORT']).nullable().optional()),
  rootCause: optText(4000),
  correctiveAction: optText(4000),
  dueDate: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.date().nullable().optional()),
  close: z.boolean().default(false),
});

/**
 * Quality control: inspection plans per stage (incoming goods, finished production), inspections created when goods
 * are received or produced, lots held until the quality decision, results with specifications, certificates of
 * analysis, non-conformance reports with disposition and corrective action.
 * Practice of CPPOB (Peraturan BPOM 32/2022): quality control at each step up to the release of the finished product,
 * with records of the checks of raw materials and finished goods.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- plans
  async plans() {
    RequestCtx.assert('quality.inspection.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.qcPlan.findMany({ where: { companyId, deletedAt: null }, orderBy: [{ stage: 'asc' }, { code: 'asc' }], include: { params: { orderBy: { seq: 'asc' } } } });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId!).filter(Boolean) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const cats = new Map((await this.prisma.productCategory.findMany({ where: { id: { in: rows.map((r) => r.categoryId!).filter(Boolean) } }, select: { id: true, name: true } })).map((c) => [c.id, c]));
    return rows.map((r) => ({ ...r, product: r.productId ? products.get(r.productId) ?? null : null, category: r.categoryId ? cats.get(r.categoryId) ?? null : null, params: r.params.map((p) => ({ ...p, min: n(p.min), max: n(p.max), target: n(p.target) })) }));
  }

  async savePlan(id: string | null, input: z.infer<typeof planSchema>) {
    RequestCtx.assert('quality.plan.manage');
    const u = RequestCtx.user();
    if (input.productId && !(await this.prisma.product.count({ where: { id: input.productId, companyId: u.companyId } }))) throw new BadRequestException('Product not found');
    if (input.categoryId && !(await this.prisma.productCategory.count({ where: { id: input.categoryId, companyId: u.companyId } }))) throw new BadRequestException('Category not found');
    const dup = await this.prisma.qcPlan.findFirst({ where: { companyId: u.companyId, code: input.code, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new ConflictException({ message: 'Validation failed', errors: { code: 'This code is already used' } });
    const { params, ...head } = input;
    const data = { ...head, productId: head.productId ?? null, categoryId: head.categoryId ?? null, sampling: head.sampling ?? null, updatedById: u.id };
    const plan = await this.prisma.$transaction(async (tx) => {
      const p = id
        ? await tx.qcPlan.update({ where: { id: (await this.ownPlan(id, tx)).id }, data })
        : await tx.qcPlan.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
      await tx.qcPlanParam.deleteMany({ where: { planId: p.id } });
      await tx.qcPlanParam.createMany({ data: params.map((x, i) => ({ planId: p.id, seq: i + 1, name: x.name, kind: x.kind, unit: x.unit ?? null, min: x.min ?? null, max: x.max ?? null, target: x.target ?? null, method: x.method ?? null, critical: x.critical })) });
      return p;
    });
    await this.audit.record('QC Plan', plan.id, id ? 'UPDATE' : 'CREATE', undefined, { code: input.code, stage: input.stage, checks: params.length });
    return plan;
  }

  private async ownPlan(id: string, db: Tx | PrismaService = this.prisma) {
    if (!UUID.test(id)) throw new NotFoundException('Inspection plan not found');
    const p = await db.qcPlan.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!p) throw new NotFoundException('Inspection plan not found');
    return p;
  }

  async deletePlan(id: string) {
    RequestCtx.assert('quality.plan.manage');
    const p = await this.ownPlan(id);
    await this.prisma.qcPlan.update({ where: { id: p.id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.record('QC Plan', id, 'DELETE');
    return { ok: true };
  }

  /** the plan that applies to a product at a stage: its own plan, else one of its category, else a general one */
  private async planFor(tx: Tx, companyId: string, stage: string, product: { id: string; categoryId: string | null }) {
    const plans = await tx.qcPlan.findMany({ where: { companyId, stage, isActive: true, deletedAt: null, OR: [{ productId: product.id }, ...(product.categoryId ? [{ productId: null, categoryId: product.categoryId }] : []), { productId: null, categoryId: null }] }, include: { params: { orderBy: { seq: 'asc' } } } });
    return plans.find((p) => p.productId === product.id) ?? plans.find((p) => p.categoryId && p.categoryId === product.categoryId) ?? plans.find((p) => !p.productId && !p.categoryId) ?? null;
  }

  /** creates the inspection of a received / produced lot and puts the lot on hold when the plan says so */
  private async createInspection(tx: Tx, c: { companyId: string; stage: 'RECEIPT' | 'PRODUCTION'; productId: string; sourceType: string; sourceId: string; sourceNumber: string; qty: Prisma.Decimal; lotId: string | null }) {
    const product = await tx.product.findUnique({ where: { id: c.productId }, select: { id: true, categoryId: true, type: true } });
    if (!product || product.type !== 'STOCK') return null;
    const plan = await this.planFor(tx, c.companyId, c.stage, product);
    if (!plan) return null;
    const lot = c.lotId ? await tx.stockLot.findUnique({ where: { id: c.lotId } }) : null;
    const number = await this.sequence.next('QC_INSPECTION', c.companyId, new Date(), tx);
    const insp = await tx.qcInspection.create({
      data: {
        companyId: c.companyId,
        number,
        planId: plan.id,
        stage: c.stage,
        productId: c.productId,
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        sourceNumber: c.sourceNumber,
        lotId: lot?.id ?? null,
        lotNo: lot?.lotNo ?? null,
        qty: c.qty,
        results: { create: plan.params.map((p) => ({ seq: p.seq, name: p.name, kind: p.kind, unit: p.unit, min: p.min, max: p.max, method: p.method, critical: p.critical })) },
      },
    });
    if (plan.holdLots && lot && lot.qcStatus === 'RELEASED') await tx.stockLot.update({ where: { id: lot.id }, data: { qcStatus: 'HOLD' } });
    return insp;
  }

  /** after a goods receipt is confirmed: one inspection per received line that has a plan */
  async onReceipt(tx: Tx, doc: { id: string; companyId: string; number: string; lines: { id: string; productId: string | null; qty: Prisma.Decimal }[] }) {
    for (const l of doc.lines) {
      if (!l.productId || D(l.qty).lte(0)) continue;
      const lot = await tx.lineLot.findFirst({ where: { documentId: doc.id, lineId: l.id, qty: { gt: 0 } }, select: { lotId: true } });
      await this.createInspection(tx, { companyId: doc.companyId, stage: 'RECEIPT', productId: l.productId, sourceType: 'GR', sourceId: doc.id, sourceNumber: doc.number, qty: D(l.qty), lotId: lot?.lotId ?? null });
    }
  }

  /** after a work order is finished: the inspection of the produced lot */
  async onProduction(tx: Tx, w: { id: string; companyId: string; number: string; productId: string }, qty: Prisma.Decimal) {
    const lot = await tx.lineLot.findFirst({ where: { documentId: w.id, lineId: w.id, qty: { gt: 0 } }, select: { lotId: true } });
    await this.createInspection(tx, { companyId: w.companyId, stage: 'PRODUCTION', productId: w.productId, sourceType: 'WO', sourceId: w.id, sourceNumber: w.number, qty, lotId: lot?.lotId ?? null });
  }

  /** a cancelled receipt / work order drops its pending inspections (and their holds) */
  async onCancel(tx: Tx, sourceId: string) {
    const list = await tx.qcInspection.findMany({ where: { sourceId, status: 'PENDING' } });
    for (const i of list) {
      await tx.qcInspection.update({ where: { id: i.id }, data: { status: 'FAILED', notes: `${i.notes ? i.notes + '\n' : ''}Source cancelled` } });
      if (i.lotId) await tx.stockLot.updateMany({ where: { id: i.lotId, qcStatus: 'HOLD' }, data: { qcStatus: 'RELEASED' } });
    }
  }

  // ---------------------------------------------------------------- inspections
  async inspections(status?: string, search?: string) {
    RequestCtx.assert('quality.inspection.read');
    const companyId = RequestCtx.companyId();
    const s = (search ?? '').trim();
    const rows = await this.prisma.qcInspection.findMany({
      where: { companyId, ...(status ? { status } : {}), ...(s ? { OR: [{ number: { contains: s, mode: 'insensitive' } }, { lotNo: { contains: s, mode: 'insensitive' } }, { sourceNumber: { contains: s, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, qty: Number(r.qty), product: products.get(r.productId) ?? null }));
  }

  private async ownInspection(id: string, db: Tx | PrismaService = this.prisma) {
    if (!UUID.test(id)) throw new NotFoundException('Inspection not found');
    const i = await db.qcInspection.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { results: { orderBy: { seq: 'asc' } } } });
    if (!i) throw new NotFoundException('Inspection not found');
    return i;
  }

  /** an inspection with everything a certificate of analysis prints */
  async inspection(id: string) {
    RequestCtx.assert('quality.inspection.read');
    const i = await this.ownInspection(id);
    const [product, plan, lot, inspector, company, ncrs] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: i.productId }, select: { code: true, name: true, uom: { select: { code: true } } } }),
      this.prisma.qcPlan.findUnique({ where: { id: i.planId }, select: { code: true, name: true, sampling: true, holdLots: true } }),
      i.lotId ? this.prisma.stockLot.findUnique({ where: { id: i.lotId }, select: { lotNo: true, expiryDate: true, manufactureDate: true, qcStatus: true } }) : null,
      i.inspectorId ? this.prisma.user.findUnique({ where: { id: i.inspectorId }, select: { fullName: true } }) : null,
      this.prisma.company.findUnique({ where: { id: i.companyId }, select: { name: true, legalName: true, address: true, city: true, phone: true } }),
      this.prisma.qcNcr.findMany({ where: { inspectionId: i.id }, select: { id: true, number: true, status: true } }),
    ]);
    return { ...i, qty: Number(i.qty), sampleQty: Number(i.sampleQty), results: i.results.map((r) => ({ ...r, min: n(r.min), max: n(r.max), valueNumber: n(r.valueNumber) })), product, plan, lot, inspector: inspector?.fullName ?? null, company, ncrs };
  }

  /** records the measured values; a numeric result passes inside its min / max, a check takes the inspector's verdict */
  async record(id: string, input: z.infer<typeof resultsSchema>) {
    RequestCtx.assert('quality.inspection.record');
    const u = RequestCtx.user();
    const i = await this.ownInspection(id);
    if (i.status !== 'PENDING') throw new ConflictException('This inspection is already decided');
    const byId = new Map(input.results.map((r) => [r.id, r]));
    await this.prisma.$transaction(async (tx) => {
      for (const r of i.results) {
        const v = byId.get(r.id);
        if (!v) continue;
        let pass: boolean | null = null;
        if (r.kind === 'NUMBER' && v.valueNumber !== null && v.valueNumber !== undefined) pass = (r.min === null || v.valueNumber >= Number(r.min)) && (r.max === null || v.valueNumber <= Number(r.max));
        if (r.kind === 'CHECK') pass = v.pass ?? null;
        await tx.qcResult.update({ where: { id: r.id }, data: { valueNumber: r.kind === 'NUMBER' ? (v.valueNumber ?? null) : null, valueText: v.valueText ?? null, pass } });
      }
      await tx.qcInspection.update({ where: { id }, data: { sampleQty: D(input.sampleQty), notes: input.notes ?? null, inspectorId: u.id, inspectedAt: new Date() } });
    });
    return this.inspection(id);
  }

  /**
   * quality decision. PASSED needs every critical check recorded and passed; CONDITIONAL (accepted with a deviation)
   * needs a note; FAILED rejects the lot and opens a non-conformance report.
   */
  async decide(id: string, input: z.infer<typeof decideSchema>) {
    RequestCtx.assert('quality.inspection.release');
    const u = RequestCtx.user();
    const i = await this.ownInspection(id);
    if (i.status !== 'PENDING') throw new ConflictException('This inspection is already decided');
    const critical = i.results.filter((r) => r.critical && r.kind !== 'TEXT');
    const missing = critical.filter((r) => r.pass === null);
    const failed = i.results.filter((r) => r.pass === false && r.kind !== 'TEXT');
    if (input.decision !== 'FAILED' && missing.length) throw new BadRequestException(`Record the results first: ${missing.map((r) => r.name).join(', ')}`);
    if (input.decision === 'PASSED' && failed.some((r) => r.critical)) throw new BadRequestException(`Out of specification: ${failed.filter((r) => r.critical).map((r) => r.name).join(', ')}. Reject it, or accept it with a deviation (conditional)`);
    if (input.decision === 'CONDITIONAL' && !input.notes) throw new BadRequestException('Explain the deviation accepted');
    const ncr = await this.prisma.$transaction(async (tx) => {
      await tx.qcInspection.update({ where: { id }, data: { status: input.decision, notes: input.notes ? `${i.notes ? i.notes + '\n' : ''}${input.notes}` : i.notes, inspectorId: i.inspectorId ?? u.id, inspectedAt: i.inspectedAt ?? new Date() } });
      if (i.lotId) await tx.stockLot.update({ where: { id: i.lotId }, data: { qcStatus: input.decision === 'FAILED' ? 'REJECTED' : 'RELEASED' } });
      if (input.decision !== 'FAILED') return null;
      const supplierId = i.sourceType === 'GR' ? (await tx.tradeDocument.findUnique({ where: { id: i.sourceId }, select: { supplierId: true } }))?.supplierId ?? null : null;
      return tx.qcNcr.create({
        data: {
          companyId: i.companyId,
          number: await this.sequence.next('QC_NCR', i.companyId, new Date(), tx),
          inspectionId: i.id,
          productId: i.productId,
          lotId: i.lotId,
          lotNo: i.lotNo,
          supplierId,
          qty: i.qty,
          description: [`Failed inspection ${i.number} (${i.sourceType} ${i.sourceNumber})`, ...failed.map((r) => `- ${r.name}: ${r.valueNumber ?? r.valueText ?? 'fail'}${r.unit ? ' ' + r.unit : ''} (spec ${r.min ?? '…'} – ${r.max ?? '…'})`), input.notes ?? ''].filter(Boolean).join('\n'),
          createdById: u.id,
        },
      });
    });
    await this.audit.record('QC Inspection', id, 'DECIDE', { status: 'PENDING' }, { status: input.decision, lot: i.lotNo, ncr: ncr?.number ?? null });
    return { ...(await this.inspection(id)), ncr };
  }

  // ---------------------------------------------------------------- non-conformances
  async ncrs(status?: string) {
    RequestCtx.assert('quality.inspection.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.qcNcr.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], take: 300 });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const suppliers = new Map((await this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId!).filter(Boolean) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, qty: Number(r.qty), product: products.get(r.productId) ?? null, supplier: r.supplierId ? suppliers.get(r.supplierId) ?? null : null }));
  }

  async createNcr(input: z.infer<typeof ncrSchema>) {
    RequestCtx.assert('quality.ncr.manage');
    const u = RequestCtx.user();
    if (!(await this.prisma.product.count({ where: { id: input.productId, companyId: u.companyId } }))) throw new BadRequestException('Product not found');
    const lot = input.lotId ? await this.prisma.stockLot.findFirst({ where: { id: input.lotId, companyId: u.companyId, productId: input.productId } }) : null;
    if (input.lotId && !lot) throw new BadRequestException('Lot not found for this product');
    const r = await this.prisma.$transaction(async (tx) =>
      tx.qcNcr.create({ data: { companyId: u.companyId, number: await this.sequence.next('QC_NCR', u.companyId, new Date(), tx), productId: input.productId, lotId: lot?.id ?? null, lotNo: lot?.lotNo ?? null, supplierId: input.supplierId ?? null, qty: D(input.qty), description: input.description, createdById: u.id } }),
    );
    await this.audit.record('QC NCR', r.id, 'CREATE', undefined, { number: r.number });
    return r;
  }

  /**
   * disposition, root cause, corrective action; closing an NCR whose disposition is "use as is" (concession) releases
   * the rejected lot; scrap / return / rework are done with their own documents (stock disposal, purchase return, work order)
   */
  async updateNcr(id: string, input: z.infer<typeof ncrUpdateSchema>) {
    RequestCtx.assert('quality.ncr.manage');
    const u = RequestCtx.user();
    if (!UUID.test(id)) throw new NotFoundException('Non-conformance not found');
    const r = await this.prisma.qcNcr.findFirst({ where: { id, companyId: u.companyId } });
    if (!r) throw new NotFoundException('Non-conformance not found');
    if (r.status === 'CLOSED') throw new ConflictException('This report is closed');
    const disposition = input.disposition !== undefined ? input.disposition : r.disposition;
    if (input.close && (!disposition || !(input.correctiveAction ?? r.correctiveAction))) throw new BadRequestException('Give the disposition and the corrective action before closing');
    await this.prisma.$transaction(async (tx) => {
      await tx.qcNcr.update({
        where: { id },
        data: {
          disposition: disposition ?? null,
          ...(input.rootCause !== undefined ? { rootCause: input.rootCause } : {}),
          ...(input.correctiveAction !== undefined ? { correctiveAction: input.correctiveAction } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.close ? { status: 'CLOSED', closedAt: new Date(), closedById: u.id } : {}),
        },
      });
      if (input.close && disposition === 'USE_AS_IS' && r.lotId) await tx.stockLot.updateMany({ where: { id: r.lotId, qcStatus: 'REJECTED' }, data: { qcStatus: 'RELEASED' } });
    });
    await this.audit.record('QC NCR', id, input.close ? 'CLOSE' : 'UPDATE', { status: r.status, disposition: r.disposition }, { disposition, closed: input.close });
    return this.prisma.qcNcr.findUnique({ where: { id } });
  }
}
