import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { computeTkdn, TkdnMode } from './tkdn-calc';

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const UUID = /^[0-9a-f-]{36}$/i;
const DAY = 86_400_000;
import { localIso, todayDate } from './local-date';
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.date().nullable().optional());
const optPct = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable().optional());
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());

export const CERT_TYPES = ['HALAL', 'BPOM_MD', 'BPOM_ML', 'PIRT', 'SNI', 'TKDN', 'ISO', 'HACCP', 'NKV', 'ISPO', 'OTHER'] as const;

export const certificateSchema = z
  .object({
    type: z.enum(CERT_TYPES),
    number: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    issuer: optText(150),
    holder: z.enum(['OWN', 'SUPPLIER']).default('OWN'),
    supplierId: optUuid,
    issuedAt: optDate,
    expiresAt: optDate,
    tkdnValue: optPct,
    bmpValue: optPct,
    scope: optText(4000),
    notes: optText(4000),
    isActive: z.boolean().default(true),
    productIds: z.array(z.uuid()).max(500).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.holder === 'SUPPLIER' && !c.supplierId) ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Choose the supplier holding the certificate' });
    if (c.issuedAt && c.expiresAt && c.expiresAt < c.issuedAt) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Before the issue date' });
    if (c.type === 'TKDN' && (c.tkdnValue === null || c.tkdnValue === undefined)) ctx.addIssue({ code: 'custom', path: ['tkdnValue'], message: 'Enter the TKDN value on the certificate' });
  });

const tkdnLine = z.object({
  productId: optUuid,
  description: z.string().trim().min(1).max(200),
  specification: optText(200),
  uom: optText(20),
  originCountry: z.string().trim().min(2).max(3).transform((v) => v.toUpperCase()),
  qty: z.coerce.number().positive().max(1e9),
  unitPrice: z.coerce.number().min(0).max(1e13),
  hasCertificate: z.boolean().default(false),
  certTkdn: optPct,
  domesticProducer: z.boolean().default(false),
  allDomesticMaterials: z.boolean().default(false),
});
export const tkdnSchema = z
  .object({
    productId: z.uuid(),
    bomId: optUuid,
    date: z.coerce.date(),
    productType: optText(150),
    specification: optText(300),
    standard: optText(100),
    productionMode: z.enum(['OWN', 'OTHER_FACTORY', 'OUTSOURCED']),
    investedInIndonesia: z.boolean().default(true),
    directLabourTotal: z.coerce.number().int().min(0).max(1_000_000),
    directLabourWni: z.coerce.number().int().min(0).max(1_000_000),
    bwInvestment: z.coerce.number().min(0).max(100).default(0),
    bwUnit: z.coerce.number().min(0).max(100).default(0),
    bwProgram: z.coerce.number().min(0).max(100).default(0),
    bwImplementation: z.coerce.number().min(0).max(100).default(0),
    notes: optText(4000),
    lines: z.array(tkdnLine).min(1, 'Add the main components').max(300),
  })
  .superRefine((t, ctx) => {
    if (t.directLabourWni > t.directLabourTotal) ctx.addIssue({ code: 'custom', path: ['directLabourWni'], message: 'More than the total' });
    t.lines.forEach((l, i) => {
      if (l.hasCertificate && (l.certTkdn === null || l.certTkdn === undefined)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'certTkdn'], message: 'TKDN on the certificate' });
    });
  });

/** status of a certificate today */
export function certStatus(c: { expiresAt: Date | null; isActive: boolean; reviewNeeded: boolean }, today = todayDate()) {
  if (!c.isActive) return 'INACTIVE';
  if (c.expiresAt && c.expiresAt < today) return 'EXPIRED';
  if (c.reviewNeeded) return 'REVIEW';
  if (c.expiresAt && c.expiresAt.getTime() - today.getTime() <= 90 * DAY) return 'EXPIRING';
  return 'VALID';
}

/**
 * Compliance register: certificates and licences with expiry alerts (halal, BPOM, SNI, TKDN...), what each product
 * must hold, halal status of the ingredients of halal products, TKDN self-assessments.
 * Halal: UU 33/2014 Art. 42 as amended by UU 6/2023 - the certificate stays valid while the ingredients and the
 * production process do not change, so changing the recipe of a certified product flags the certificate for review.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ certificates
  async certificates(type?: string, status?: string, productId?: string) {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.complianceCertificate.findMany({
      where: { companyId, deletedAt: null, ...(type ? { type } : {}), ...(productId && UUID.test(productId) ? { products: { some: { productId } } } : {}) },
      include: { products: true },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
    });
    const out = await this.decorate(rows);
    return status ? out.filter((c) => c.status === status) : out;
  }

  private async decorate(rows: (Prisma.ComplianceCertificateGetPayload<{ include: { products: true } }>)[]) {
    const pids = [...new Set(rows.flatMap((r) => r.products.map((p) => p.productId)))];
    const sids = [...new Set(rows.map((r) => r.supplierId!).filter(Boolean))];
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: pids } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    const suppliers = new Map((await this.prisma.supplier.findMany({ where: { id: { in: sids } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const today = todayDate();
    return rows.map((r) => ({
      ...r,
      tkdnValue: n(r.tkdnValue),
      bmpValue: n(r.bmpValue),
      products: r.products.map((p) => products.get(p.productId)).filter(Boolean) as { id: string; code: string; name: string }[],
      supplier: r.supplierId ? suppliers.get(r.supplierId) ?? null : null,
      status: certStatus(r, today),
      daysLeft: r.expiresAt ? Math.ceil((r.expiresAt.getTime() - today.getTime()) / DAY) : null,
    }));
  }

  async certificate(id: string) {
    RequestCtx.assert('compliance.read');
    const c = await this.ownCert(id);
    return (await this.decorate([c]))[0];
  }

  private async ownCert(id: string) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Certificate not found');
    const c = await this.prisma.complianceCertificate.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { products: true } });
    if (!c) throw new NotFoundException('Certificate not found');
    return c;
  }

  async saveCertificate(id: string | null, input: z.infer<typeof certificateSchema>) {
    RequestCtx.assert('compliance.certificate.manage');
    const u = RequestCtx.user();
    const productIds = [...new Set(input.productIds)];
    if (productIds.length && (await this.prisma.product.count({ where: { id: { in: productIds }, companyId: u.companyId, deletedAt: null } })) !== productIds.length) throw new BadRequestException({ message: 'Validation failed', errors: { productIds: 'A product was not found' } });
    if (input.supplierId && !(await this.prisma.supplier.count({ where: { id: input.supplierId, companyId: u.companyId, deletedAt: null } }))) throw new BadRequestException({ message: 'Validation failed', errors: { supplierId: 'Supplier not found' } });
    const dup = await this.prisma.complianceCertificate.findFirst({ where: { companyId: u.companyId, type: input.type, number: input.number, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new ConflictException({ message: 'Validation failed', errors: { number: 'This certificate is already registered' } });
    const data = {
      type: input.type,
      number: input.number,
      title: input.title,
      issuer: input.issuer ?? null,
      holder: input.holder,
      supplierId: input.holder === 'SUPPLIER' ? input.supplierId ?? null : null,
      issuedAt: input.issuedAt ?? null,
      expiresAt: input.expiresAt ?? null,
      tkdnValue: input.tkdnValue === null || input.tkdnValue === undefined ? null : D(input.tkdnValue),
      bmpValue: input.bmpValue === null || input.bmpValue === undefined ? null : D(input.bmpValue),
      scope: input.scope ?? null,
      notes: input.notes ?? null,
      isActive: input.isActive,
      updatedById: u.id,
    };
    const before = id ? await this.ownCert(id) : null;
    const cert = await this.prisma.$transaction(async (tx) => {
      const c = before ? await tx.complianceCertificate.update({ where: { id: before.id }, data }) : await tx.complianceCertificate.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
      await tx.complianceCertificateProduct.deleteMany({ where: { certificateId: c.id } });
      if (productIds.length) await tx.complianceCertificateProduct.createMany({ data: productIds.map((productId) => ({ certificateId: c.id, productId })) });
      return c;
    });
    await this.audit.record('Certificate', cert.id, id ? 'UPDATE' : 'CREATE', before ?? undefined, { ...data, products: productIds.length });
    return this.certificate(cert.id);
  }

  async deleteCertificate(id: string) {
    RequestCtx.assert('compliance.certificate.manage');
    const c = await this.ownCert(id);
    await this.prisma.complianceCertificate.update({ where: { id: c.id }, data: { deletedAt: new Date(), isActive: false, updatedById: RequestCtx.user().id } });
    await this.audit.record('Certificate', id, 'DELETE', c);
    return { ok: true };
  }

  /** the change was checked (new certificate not needed, or the certification body was informed) */
  async markReviewed(id: string, note?: string | null) {
    RequestCtx.assert('compliance.certificate.manage');
    const c = await this.ownCert(id);
    const stamp = `${localIso()} reviewed by ${RequestCtx.user().fullName ?? RequestCtx.user().username}${note ? `: ${note}` : ''}`;
    await this.prisma.complianceCertificate.update({ where: { id: c.id }, data: { reviewNeeded: false, notes: [c.notes, `${c.reviewReason ?? ''} -> ${stamp}`].filter(Boolean).join('\n').slice(0, 4000), reviewReason: null, updatedById: RequestCtx.user().id } });
    await this.audit.record('Certificate', id, 'REVIEWED', undefined, { reason: c.reviewReason, note });
    return this.certificate(id);
  }

  /**
   * Called when a bill of materials is saved: if the ingredients of a product holding our halal certificate
   * changed, the certificate must be reviewed (a new ingredient needs the halal body's approval).
   */
  async onRecipeChanged(tx: Tx, companyId: string, productId: string, before: string[], after: string[], bomCode: string) {
    const b = new Set(before);
    const a = new Set(after);
    const added = [...a].filter((x) => !b.has(x));
    const removed = [...b].filter((x) => !a.has(x));
    if (!added.length && !removed.length) return;
    const certs = await tx.complianceCertificate.findMany({ where: { companyId, type: 'HALAL', holder: 'OWN', isActive: true, deletedAt: null, products: { some: { productId } } } });
    if (!certs.length) return;
    const names = new Map((await tx.product.findMany({ where: { id: { in: [...added, ...removed] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const reason = `${localIso()} recipe ${bomCode} changed${added.length ? `; added: ${added.map((x) => names.get(x)).join(', ')}` : ''}${removed.length ? `; removed: ${removed.map((x) => names.get(x)).join(', ')}` : ''}`.slice(0, 1000);
    for (const c of certs) await tx.complianceCertificate.update({ where: { id: c.id }, data: { reviewNeeded: true, reviewReason: c.reviewReason ? `${c.reviewReason}\n${reason}`.slice(0, 4000) : reason } });
  }

  /** valid certificates of a type covering each product (own or a supplier's) */
  private async covered(companyId: string, type: string | string[]) {
    const today = todayDate();
    const rows = await this.prisma.complianceCertificate.findMany({
      where: { companyId, deletedAt: null, isActive: true, type: Array.isArray(type) ? { in: type } : type, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] },
      include: { products: true },
    });
    const map = new Map<string, typeof rows>();
    for (const r of rows) for (const p of r.products) map.set(p.productId, [...(map.get(p.productId) ?? []), r]);
    return map;
  }

  /**
   * Products missing a certificate they must hold, and ingredients of halal products without a valid halal
   * certificate of their own or of their supplier (halal assurance: all materials must be halal, PP 42/2024).
   */
  async productCheck() {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const products = await this.prisma.product.findMany({ where: { companyId, deletedAt: null, isActive: true, OR: [{ halalRequired: true }, { bpomRequired: true }, { sniRequired: true }] }, select: { id: true, code: true, name: true, halalRequired: true, bpomRequired: true, sniRequired: true } });
    const halal = await this.covered(companyId, 'HALAL');
    const bpom = await this.covered(companyId, ['BPOM_MD', 'BPOM_ML', 'PIRT']);
    const sni = await this.covered(companyId, 'SNI');
    const missing = products
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        missing: [p.halalRequired && !halal.get(p.id)?.some((c) => c.holder === 'OWN') ? 'HALAL' : null, p.bpomRequired && !bpom.get(p.id)?.length ? 'BPOM' : null, p.sniRequired && !sni.get(p.id)?.some((c) => c.holder === 'OWN') ? 'SNI' : null].filter(Boolean) as string[],
      }))
      .filter((p) => p.missing.length);
    // ingredients of halal products (default bills of materials, phantoms exploded)
    const halalIds = products.filter((p) => p.halalRequired).map((p) => p.id);
    const boms = await this.prisma.bom.findMany({ where: { companyId, productId: { in: halalIds }, isDefault: true, isActive: true, deletedAt: null }, include: { lines: true } });
    const uses = new Map<string, Set<string>>();
    const seen = new Set<string>();
    const walk = async (finished: string, lines: { productId: string; phantom: boolean }[], depth: number) => {
      for (const l of lines) {
        if (l.phantom && depth < 8) {
          const sub = await this.prisma.bom.findFirst({ where: { companyId, productId: l.productId, isDefault: true, deletedAt: null }, include: { lines: true } });
          if (sub) {
            await walk(finished, sub.lines, depth + 1);
            continue;
          }
        }
        uses.set(l.productId, (uses.get(l.productId) ?? new Set()).add(finished));
        seen.add(l.productId);
      }
    };
    for (const b of boms) await walk(b.productId, b.lines, 0);
    const ing = await this.prisma.product.findMany({ where: { id: { in: [...seen] } }, select: { id: true, code: true, name: true, preferredSupplierId: true } });
    const pname = new Map(products.map((p) => [p.id, p.name]));
    const ingredients = ing
      .filter((p) => !halal.get(p.id)?.length)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, usedIn: [...(uses.get(p.id) ?? [])].map((x) => pname.get(x) ?? '') }));
    return { missing, ingredients };
  }

  // ------------------------------------------------------------------ overview
  async overview() {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const today = todayDate();
    const certs = await this.certificates();
    const attention = certs.filter((c) => ['EXPIRED', 'EXPIRING', 'REVIEW'].includes(c.status));
    const check = await this.productCheck();
    const k3 = await this.prisma.equipment.findMany({ where: { companyId, deletedAt: null, status: { not: 'RETIRED' }, inspectionExpiry: { not: null, lte: new Date(today.getTime() + 60 * DAY) } }, orderBy: { inspectionExpiry: 'asc' }, select: { id: true, code: true, name: true, inspectionCertNo: true, inspectionExpiry: true } });
    const waste = await this.prisma.wasteEntry.findMany({ where: { companyId, status: 'POSTED', remainingQty: { gt: 0 }, maxStorageDate: { lte: new Date(today.getTime() + 14 * DAY) } }, orderBy: { maxStorageDate: 'asc' } });
    const types = new Map((await this.prisma.wasteType.findMany({ where: { id: { in: [...new Set(waste.map((w) => w.wasteTypeId))] } }, select: { id: true, code: true, name: true } })).map((t) => [t.id, t]));
    // SIINas: the last finished quarter is due on the 10th of the next month
    const m = today.getUTCMonth();
    const lastQ = m < 3 ? { year: today.getUTCFullYear() - 1, quarter: 4 } : { year: today.getUTCFullYear(), quarter: Math.floor(m / 3) };
    const due = new Date(Date.UTC(lastQ.quarter === 4 ? lastQ.year + 1 : lastQ.year, lastQ.quarter === 4 ? 0 : lastQ.quarter * 3, 10));
    const rep = await this.prisma.siinasReport.findUnique({ where: { companyId_year_quarter: { companyId, ...lastQ } } });
    return {
      certificates: attention.map((c) => ({ id: c.id, type: c.type, number: c.number, title: c.title, status: c.status, expiresAt: c.expiresAt, daysLeft: c.daysLeft, reviewReason: c.reviewReason })),
      counts: { total: certs.length, valid: certs.filter((c) => c.status === 'VALID').length, expiring: certs.filter((c) => c.status === 'EXPIRING').length, expired: certs.filter((c) => c.status === 'EXPIRED').length, review: certs.filter((c) => c.status === 'REVIEW').length },
      missing: check.missing,
      ingredients: check.ingredients,
      k3: k3.map((e) => ({ ...e, daysLeft: Math.ceil((e.inspectionExpiry!.getTime() - today.getTime()) / DAY) })),
      waste: waste.map((w) => ({ id: w.id, date: w.date, type: types.get(w.wasteTypeId), remainingQty: Number(w.remainingQty), maxStorageDate: w.maxStorageDate, daysLeft: Math.ceil((w.maxStorageDate.getTime() - today.getTime()) / DAY) })),
      siinas: { ...lastQ, due, status: rep?.status ?? 'NOT_STARTED', submittedAt: rep?.submittedAt ?? null, daysLeft: Math.ceil((due.getTime() - today.getTime()) / DAY) },
    };
  }

  // ------------------------------------------------------------------ TKDN self-assessment
  async tkdnList() {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.tkdnAssessment.findMany({ where: { companyId, deletedAt: null }, orderBy: [{ date: 'desc' }, { number: 'desc' }] });
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
    return rows.map((r) => ({ id: r.id, number: r.number, date: r.date, status: r.status, product: products.get(r.productId) ?? null, productionMode: r.productionMode, materialFactor: n(r.materialFactor), labourFactor: n(r.labourFactor), overheadFactor: n(r.overheadFactor), brainware: n(r.brainware), tkdn: n(r.tkdn) }));
  }

  async tkdn(id: string) {
    RequestCtx.assert('compliance.read');
    const a = await this.ownTkdn(id);
    const product = await this.prisma.product.findUnique({ where: { id: a.productId }, select: { id: true, code: true, name: true } });
    const company = await this.prisma.company.findUnique({ where: { id: a.companyId }, select: { name: true, legalName: true, address: true } });
    const lines = a.lines.sort((x, y) => x.seq - y.seq).map((l) => ({ ...l, qty: Number(l.qty), unitPrice: Number(l.unitPrice), certTkdn: n(l.certTkdn), creditPct: Number(l.creditPct), share: Number(l.share) }));
    const calc = computeTkdn({ ...this.tkdnInput(a), lines });
    return { ...a, product, company, lines: lines.map((l, i) => ({ ...l, cost: calc.lines[i].cost, proportion: calc.lines[i].proportion })), bwInvestment: Number(a.bwInvestment), bwUnit: Number(a.bwUnit), bwProgram: Number(a.bwProgram), bwImplementation: Number(a.bwImplementation), calc };
  }

  private tkdnInput(a: { productionMode: string; investedInIndonesia: boolean; directLabourTotal: number; directLabourWni: number; bwInvestment: Prisma.Decimal | number; bwUnit: Prisma.Decimal | number; bwProgram: Prisma.Decimal | number; bwImplementation: Prisma.Decimal | number }) {
    return { productionMode: a.productionMode as TkdnMode, investedInIndonesia: a.investedInIndonesia, directLabourTotal: a.directLabourTotal, directLabourWni: a.directLabourWni, bwInvestment: Number(a.bwInvestment), bwUnit: Number(a.bwUnit), bwProgram: Number(a.bwProgram), bwImplementation: Number(a.bwImplementation) };
  }

  private async ownTkdn(id: string) {
    if (!UUID.test(id ?? '')) throw new NotFoundException('Assessment not found');
    const a = await this.prisma.tkdnAssessment.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null }, include: { lines: true } });
    if (!a) throw new NotFoundException('Assessment not found');
    return a;
  }

  /**
   * Main components of the product from its bill of materials (phantoms exploded), per unit of product, priced at
   * the average stock cost; origin from the product, else its usual supplier, else the last receipt's supplier;
   * TKDN certificates registered for the component; direct workers from the employee register.
   */
  async tkdnPrefill(productId: string, bomId?: string) {
    RequestCtx.assert('compliance.read');
    const companyId = RequestCtx.companyId();
    if (!UUID.test(productId ?? '')) throw new BadRequestException('Choose a product');
    const product = await this.prisma.product.findFirst({ where: { id: productId, companyId, deletedAt: null }, select: { id: true, name: true, description: true } });
    if (!product) throw new NotFoundException('Product not found');
    const bom = await this.prisma.bom.findFirst({ where: { companyId, productId, deletedAt: null, ...(bomId && UUID.test(bomId) ? { id: bomId } : { isDefault: true }) }, include: { lines: true } });
    const qty = new Map<string, number>();
    const walk = async (lines: { productId: string; qty: Prisma.Decimal; scrapPct: Prisma.Decimal; phantom: boolean }[], factor: number, depth: number) => {
      for (const l of lines) {
        const q = Number(l.qty) * (1 + Number(l.scrapPct) / 100) * factor;
        if (l.phantom && depth < 8) {
          const sub = await this.prisma.bom.findFirst({ where: { companyId, productId: l.productId, isDefault: true, deletedAt: null }, include: { lines: true } });
          if (sub) {
            await walk(sub.lines, q / Number(sub.outputQty || 1), depth + 1);
            continue;
          }
        }
        qty.set(l.productId, (qty.get(l.productId) ?? 0) + q);
      }
    };
    if (bom) await walk(bom.lines, 1 / Number(bom.outputQty || 1), 0);
    const ids = [...qty.keys()];
    const comps = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, purchasePrice: true, originCountry: true, preferredSupplierId: true, uom: { select: { code: true } } } });
    const balances = await this.prisma.stockBalance.groupBy({ by: ['productId'], where: { productId: { in: ids }, qty: { gt: 0 } }, _sum: { qty: true }, _avg: { avgCost: true } });
    const avg = new Map(balances.map((b) => [b.productId, Number(b._avg.avgCost ?? 0)]));
    const supIds = comps.map((c) => c.preferredSupplierId!).filter(Boolean);
    const lastGr = await this.prisma.tradeDocumentLine.findMany({ where: { productId: { in: ids }, document: { companyId, docType: 'GR', status: { not: 'CANCELLED' } } }, orderBy: { document: { date: 'desc' } }, select: { productId: true, document: { select: { supplierId: true } } } });
    const grSupplier = new Map<string, string>();
    for (const g of lastGr) if (!grSupplier.has(g.productId!) && g.document.supplierId) grSupplier.set(g.productId!, g.document.supplierId);
    const suppliers = new Map((await this.prisma.supplier.findMany({ where: { id: { in: [...supIds, ...grSupplier.values()] } }, select: { id: true, countryCode: true } })).map((s) => [s.id, s.countryCode]));
    const tkdnCerts = await this.covered(companyId, 'TKDN');
    const workers = await this.prisma.employee.groupBy({ by: ['nationality'], where: { companyId, deletedAt: null, isActive: true, directLabour: true }, _count: true });
    const lines = comps
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => {
        const origin = (c.originCountry || suppliers.get(c.preferredSupplierId ?? '') || suppliers.get(grSupplier.get(c.id) ?? '') || 'ID').toUpperCase();
        const cert = (tkdnCerts.get(c.id) ?? []).sort((a, b) => Number(b.tkdnValue ?? 0) - Number(a.tkdnValue ?? 0))[0];
        return {
          productId: c.id,
          description: c.name,
          specification: c.code,
          uom: c.uom?.code ?? null,
          originCountry: origin,
          qty: Math.round((qty.get(c.id) ?? 0) * 10000) / 10000,
          unitPrice: Math.round(avg.get(c.id) || Number(c.purchasePrice)),
          hasCertificate: !!cert,
          certTkdn: cert ? Number(cert.tkdnValue) : null,
          certNumber: cert?.number ?? null,
          domesticProducer: origin === 'ID',
          allDomesticMaterials: false,
        };
      });
    const total = workers.reduce((a, w) => a + w._count, 0);
    const wni = workers.filter((w) => w.nationality === 'ID').reduce((a, w) => a + w._count, 0);
    return { product, bomId: bom?.id ?? null, bomCode: bom?.code ?? null, lines, directLabourTotal: total, directLabourWni: wni };
  }

  async saveTkdn(id: string | null, input: z.infer<typeof tkdnSchema>) {
    RequestCtx.assert('compliance.tkdn.manage');
    const u = RequestCtx.user();
    if (!(await this.prisma.product.count({ where: { id: input.productId, companyId: u.companyId, deletedAt: null } }))) throw new BadRequestException({ message: 'Validation failed', errors: { productId: 'Product not found' } });
    const before = id ? await this.ownTkdn(id) : null;
    if (before && before.status !== 'DRAFT') throw new ConflictException('A final assessment cannot be changed; copy it into a new one');
    const calc = computeTkdn({ ...input, productionMode: input.productionMode });
    const head = {
      productId: input.productId,
      bomId: input.bomId ?? null,
      date: input.date,
      productType: input.productType ?? null,
      specification: input.specification ?? null,
      standard: input.standard ?? null,
      productionMode: input.productionMode,
      investedInIndonesia: input.investedInIndonesia,
      directLabourTotal: input.directLabourTotal,
      directLabourWni: input.directLabourWni,
      bwInvestment: D(input.bwInvestment),
      bwUnit: D(input.bwUnit),
      bwProgram: D(input.bwProgram),
      bwImplementation: D(input.bwImplementation),
      materialFactor: D(calc.materialFactor),
      labourFactor: D(calc.labourFactor),
      overheadFactor: D(calc.overheadFactor),
      brainware: D(calc.brainware),
      tkdn: D(calc.tkdn),
      notes: input.notes ?? null,
      updatedById: u.id,
    };
    const a = await this.prisma.$transaction(async (tx) => {
      const row = before
        ? await tx.tkdnAssessment.update({ where: { id: before.id }, data: head })
        : await tx.tkdnAssessment.create({ data: { ...head, companyId: u.companyId, number: await this.sequence.next('TKDN_ASSESS', u.companyId, input.date, tx), createdById: u.id } });
      await tx.tkdnAssessmentLine.deleteMany({ where: { assessmentId: row.id } });
      await tx.tkdnAssessmentLine.createMany({
        data: input.lines.map((l, i) => ({
          assessmentId: row.id,
          seq: i + 1,
          productId: l.productId ?? null,
          description: l.description,
          specification: l.specification ?? null,
          uom: l.uom ?? null,
          originCountry: l.originCountry,
          qty: D(l.qty),
          unitPrice: D(l.unitPrice),
          hasCertificate: l.hasCertificate,
          certTkdn: l.hasCertificate && l.certTkdn !== null && l.certTkdn !== undefined ? D(l.certTkdn) : null,
          domesticProducer: l.domesticProducer,
          allDomesticMaterials: l.allDomesticMaterials,
          creditPct: D(calc.lines[i].creditPct),
          share: D(calc.lines[i].share),
        })),
      });
      return row;
    });
    await this.audit.record('TKDN Assessment', a.id, id ? 'UPDATE' : 'CREATE', undefined, { number: a.number, tkdn: calc.tkdn });
    return this.tkdn(a.id);
  }

  async finaliseTkdn(id: string) {
    RequestCtx.assert('compliance.tkdn.manage');
    const a = await this.ownTkdn(id);
    if (a.status !== 'DRAFT') throw new ConflictException('Already final');
    await this.prisma.tkdnAssessment.update({ where: { id: a.id }, data: { status: 'FINAL', updatedById: RequestCtx.user().id } });
    await this.audit.record('TKDN Assessment', id, 'FINALISE', undefined, { tkdn: Number(a.tkdn) });
    return this.tkdn(id);
  }

  async deleteTkdn(id: string) {
    RequestCtx.assert('compliance.tkdn.manage');
    const a = await this.ownTkdn(id);
    if (a.status !== 'DRAFT') throw new ConflictException('A final assessment is kept as a record');
    await this.prisma.tkdnAssessment.update({ where: { id: a.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('TKDN Assessment', id, 'DELETE', { number: a.number });
    return { ok: true };
  }
}
