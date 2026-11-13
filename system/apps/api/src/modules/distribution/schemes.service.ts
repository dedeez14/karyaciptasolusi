import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

export const CLAIM_TYPES = ['AWARD', 'SERVICE', 'SPACE_RENT', 'EQUIPMENT_RENT', 'COMPENSATION'] as const;
/**
 * SE-24/PJ/2018: what the distributor's claim is decides the tax. Award (target / volume bonus) and compensation
 * (price protection, programmes run on the principal's orders) are not a delivery: no PPN; services and rent of display
 * space / equipment are services of the distributor: PPN. The principal withholds the income tax shown.
 */
export const CLAIM_TAX: Record<string, { vat: boolean; key: string; wht: string; label: string }> = {
  AWARD: { vat: false, key: 'PRINCIPAL_SUPPORT', wht: 'PPh 23 15% (award / bonus)', label: 'Award / target bonus' },
  SERVICE: { vat: true, key: 'SERVICE_REVENUE', wht: 'PPh 23 2% (services)', label: 'Promotion services' },
  SPACE_RENT: { vat: true, key: 'DISPLAY_RENT', wht: 'PPh 4(2) 10% (space rent)', label: 'Display space rent' },
  EQUIPMENT_RENT: { vat: true, key: 'DISPLAY_RENT', wht: 'PPh 23 2% (equipment rent)', label: 'Display equipment rent' },
  COMPENSATION: { vat: false, key: 'PRINCIPAL_SUPPORT', wht: 'none', label: 'Compensation (programme on the principal’s orders)' },
};

export const schemeSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  supplierId: optUuid,
  type: z.enum(['DISCOUNT', 'BONUS']),
  productIds: z.array(z.uuid()).min(1).max(500),
  channels: z.array(z.string().max(20)).max(10).default([]),
  minQty: z.coerce.number().positive().max(1e9).default(1),
  discountPct: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().positive().max(100).nullable().optional()),
  bonusProductId: optUuid,
  bonusQty: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().positive().max(1e9).nullable().optional()),
  principalSharePct: z.coerce.number().min(0).max(100).default(0),
  claimType: z.enum(CLAIM_TYPES).default('COMPENSATION'),
  dateFrom: z.coerce.date(),
  dateTo: z.coerce.date(),
  isActive: z.boolean().default(true),
  notes: optText(2000),
});
export const claimSchema = z.object({ supplierId: z.uuid(), customerId: z.uuid(), claimType: z.enum(CLAIM_TYPES), periodFrom: z.coerce.date(), periodTo: z.coerce.date(), notes: optText(1000) });

type Line = { productId: string; qty: number; unitPrice?: number; discountPct?: number };
type Tx = Prisma.TransactionClient;

/**
 * Trade schemes: the best discount for each line and the bonus goods earned, applied to orders and van sales; bonus
 * goods as a free supply (pemberian cuma-cuma) or as a 100% discount line; principals' shares claimed by type.
 */
@Injectable()
export class SchemeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ schemes
  private shape(s: Prisma.TradeSchemeGetPayload<object>) {
    return { ...s, minQty: n(s.minQty), discountPct: s.discountPct === null ? null : n(s.discountPct), bonusQty: s.bonusQty === null ? null : n(s.bonusQty), principalSharePct: n(s.principalSharePct), dateFrom: iso(s.dateFrom), dateTo: iso(s.dateTo) };
  }

  async schemes() {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.tradeScheme.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { dateTo: 'desc' }] });
    const [sups, prods, used] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { id: { in: [...rows.flatMap((r) => r.productIds as string[]), ...rows.map((r) => r.bonusProductId!).filter(Boolean)] } }, select: { id: true, code: true, name: true } }),
      this.prisma.schemeUsage.groupBy({ by: ['schemeId'], where: { companyId }, _sum: { value: true, principalShare: true } }),
    ]);
    return rows.map((s) => ({
      ...this.shape(s),
      supplier: sups.find((x) => x.id === s.supplierId)?.name ?? null,
      products: (s.productIds as string[]).map((id) => prods.find((p) => p.id === id)).filter(Boolean),
      bonusProduct: prods.find((p) => p.id === s.bonusProductId) ?? null,
      given: n(used.find((u) => u.schemeId === s.id)?._sum.value),
      claimable: n(used.find((u) => u.schemeId === s.id)?._sum.principalShare),
    }));
  }

  async saveScheme(id: string | null, input: z.infer<typeof schemeSchema>) {
    RequestCtx.assert('distribution.scheme.manage');
    const u = RequestCtx.user();
    if (input.dateTo < input.dateFrom) throw invalid({ dateTo: 'Ends before it starts' });
    if (input.type === 'DISCOUNT' && !input.discountPct) throw invalid({ discountPct: 'Enter the discount %' });
    if (input.type === 'BONUS' && (!input.bonusProductId || !input.bonusQty)) throw invalid({ bonusProductId: 'Choose the bonus product and quantity' });
    if (input.principalSharePct > 0 && !input.supplierId) throw invalid({ supplierId: 'Choose the principal that funds its share' });
    const ids = [...new Set([...input.productIds, ...(input.bonusProductId ? [input.bonusProductId] : [])])];
    if ((await this.prisma.product.count({ where: { id: { in: ids }, companyId: u.companyId, deletedAt: null } })) !== ids.length) throw invalid({ productIds: 'Unknown product' });
    if (await this.prisma.tradeScheme.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    const data = { ...input, productIds: [...new Set(input.productIds)], channels: input.channels, minQty: D(input.minQty), discountPct: input.type === 'DISCOUNT' ? D(input.discountPct!) : null, bonusProductId: input.type === 'BONUS' ? input.bonusProductId! : null, bonusQty: input.type === 'BONUS' ? D(input.bonusQty!) : null, principalSharePct: D(input.principalSharePct) };
    const s = id ? await this.prisma.tradeScheme.update({ where: { id, companyId: u.companyId }, data }) : await this.prisma.tradeScheme.create({ data: { ...data, companyId: u.companyId } });
    await this.audit.record('Trade Scheme', s.id, id ? 'UPDATE' : 'CREATE', null, { code: s.code });
    return this.shape(s);
  }

  // ------------------------------------------------------------------ applying
  /** the best discount % per line and the bonus goods earned, for a customer on a date */
  async evaluate(customerId: string, date: Date, lines: Line[]) {
    const companyId = RequestCtx.companyId();
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { channel: true } });
    const all = await this.prisma.tradeScheme.findMany({ where: { companyId, isActive: true, dateFrom: { lte: date }, dateTo: { gte: date } } });
    const fits = (s: (typeof all)[number]) => !(s.channels as string[]).length || (!!c?.channel && (s.channels as string[]).includes(c.channel));
    const schemes = all.filter(fits);
    const out = lines.map((l) => {
      if (l.discountPct !== undefined && l.discountPct > 0) return { ...l, schemeId: null as string | null };
      const best = schemes.filter((s) => s.type === 'DISCOUNT' && (s.productIds as string[]).includes(l.productId) && l.qty >= n(s.minQty)).sort((a, b) => n(b.discountPct) - n(a.discountPct))[0];
      return best ? { ...l, discountPct: n(best.discountPct), schemeId: best.id } : { ...l, schemeId: null };
    });
    const bonuses = schemes
      .filter((s) => s.type === 'BONUS')
      .map((s) => {
        const bought = lines.filter((l) => (s.productIds as string[]).includes(l.productId)).reduce((a, l) => a + l.qty, 0);
        const times = Math.floor(bought / n(s.minQty));
        return { schemeId: s.id, productId: s.bonusProductId!, qty: r2(times * n(s.bonusQty)), share: n(s.principalSharePct) };
      })
      .filter((b) => b.qty > 0);
    return { lines: out, bonuses, schemes: new Map(schemes.map((s) => [s.id, s])) };
  }

  /** usages of the discounts given on a confirmed document (value = what the customer did not pay) */
  async recordDiscounts(documentId: string, applied: { productId: string; schemeId: string | null }[], schemes: Map<string, Prisma.TradeSchemeGetPayload<object>>) {
    const doc = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: documentId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    const rows: Prisma.SchemeUsageCreateManyInput[] = [];
    doc.lines.forEach((l, i) => {
      const a = applied[i];
      if (!a?.schemeId || !l.productId) return;
      const s = schemes.get(a.schemeId)!;
      const value = n(l.lineDiscount) * (n(doc.exchangeRate) || 1);
      if (value <= 0) return;
      rows.push({ companyId: doc.companyId, schemeId: s.id, documentId: doc.id, docType: doc.docType, documentNumber: doc.number, date: doc.date, customerId: doc.customerId!, productId: l.productId, qty: l.qty, value: D(r2(value)), principalShare: D(r2((value * n(s.principalSharePct)) / 100)) });
    });
    if (rows.length) await this.prisma.schemeUsage.createMany({ data: rows });
  }

  async bonusMode(companyId: string) {
    return (await this.settings.str('distribution.bonusMode', companyId, 'FREE_SUPPLY')) === 'DISCOUNT' ? 'DISCOUNT' : 'FREE_SUPPLY';
  }

  /** bonus goods earned on a document as a free supply: a gift record, delivered now (van) or later */
  async createGift(tx: Tx | PrismaService, b: { schemeId: string; productId: string; qty: number }, doc: { id: string; customerId: string; date: Date }) {
    const companyId = RequestCtx.companyId();
    const number = await this.sequence.next('GIFT', companyId, doc.date, tx as Tx);
    return tx.giftRecord.create({ data: { companyId, number, date: doc.date, schemeId: b.schemeId, customerId: doc.customerId, productId: b.productId, qty: D(b.qty), sourceDocId: doc.id } });
  }

  /**
   * deliver a free supply: a zero-priced delivery out of the warehouse (cost to cost of sales), PPN on 11/12 x
   * (price - gross profit) = 11/12 x cost (PMK 11/2025 Art. 2b), borne by the company and booked when it is a PKP
   */
  async deliverGift(id: string, warehouseId: string) {
    RequestCtx.assert('distribution.visit');
    const u = RequestCtx.user();
    const g = await this.prisma.giftRecord.findFirst({ where: { id, companyId: u.companyId } });
    if (!g) throw new NotFoundException('Free goods record not found');
    if (g.status !== 'PENDING') throw new ConflictException('Already delivered or cancelled');
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: g.productId }, select: { name: true, salePrice: true } });
    const dO = await this.docs.create('DO', { date: localIso(), customerId: g.customerId, warehouseId, reference: `Free goods ${g.number}`, notes: 'Pemberian cuma-cuma (bonus): not sold', lines: [{ productId: g.productId, qty: n(g.qty), description: `${product.name} - bonus (free supply)` }] }, undefined, { skipPermission: true });
    try {
      await this.docs.confirm('DO', dO.id, { skipPermission: true });
    } catch (e) {
      await this.prisma.tradeDocument.update({ where: { id: dO.id }, data: { deletedAt: new Date() } });
      throw e;
    }
    const line = await this.prisma.tradeDocumentLine.findFirstOrThrow({ where: { documentId: dO.id } });
    const cost = r2(n(line.unitCost) * n(g.qty));
    const price = r2(n(product.salePrice) * n(g.qty));
    const dpp = r2((cost * 11) / 12);
    const pkp = await this.settings.bool('sales.vatPayer', u.companyId, true);
    const ppn = pkp ? Math.round(dpp * 0.12) : 0;
    await this.prisma.$transaction(async (tx) => {
      if (ppn > 0)
        await this.journal.post(tx, {
          companyId: u.companyId,
          date: new Date(localIso()),
          description: `${g.number}: PPN on free goods (pemberian cuma-cuma), DPP ${dpp}`,
          reference: g.number,
          sourceType: 'GIFT',
          sourceId: g.id,
          lines: [
            { key: 'PROMOTION_EXPENSE', debit: D(ppn), description: `PPN 12% x DPP 11/12 of cost ${cost}`, customerId: g.customerId },
            { key: 'TAX_OUT', credit: D(ppn), description: `PPN free goods ${g.number}` },
          ],
        });
      await tx.giftRecord.update({ where: { id }, data: { status: 'DELIVERED', deliveryId: dO.id, cost: D(cost), price: D(price), dpp: D(dpp), ppn: D(ppn) } });
      if (g.schemeId) {
        const s = await tx.tradeScheme.findUnique({ where: { id: g.schemeId } });
        if (s)
          await tx.schemeUsage.create({ data: { companyId: u.companyId, schemeId: s.id, documentId: dO.id, docType: 'DO', documentNumber: dO.number, date: new Date(localIso()), customerId: g.customerId, productId: g.productId, qty: g.qty, value: D(price), principalShare: D(r2((price * n(s.principalSharePct)) / 100)) } });
      }
    });
    await this.audit.record('Free Goods', id, 'DELIVER', null, { delivery: dO.number, dpp, ppn });
    return this.gift(id);
  }

  async cancelGift(id: string) {
    RequestCtx.assert('distribution.scheme.manage');
    const g = await this.prisma.giftRecord.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!g) throw new NotFoundException('Free goods record not found');
    if (g.status !== 'PENDING') throw new ConflictException('Only pending free goods are cancelled (cancel the delivery for delivered ones)');
    await this.prisma.giftRecord.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record('Free Goods', id, 'CANCEL');
    return this.gift(id);
  }

  private async gift(id: string) {
    const g = await this.prisma.giftRecord.findUniqueOrThrow({ where: { id } });
    return { ...g, qty: n(g.qty), cost: n(g.cost), price: n(g.price), dpp: n(g.dpp), ppn: n(g.ppn), date: iso(g.date) };
  }

  async gifts(status?: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.giftRecord.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 });
    const [customers, products, dos] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } }),
      this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, code: true, name: true } }),
      this.prisma.tradeDocument.findMany({ where: { id: { in: rows.map((r) => r.deliveryId!).filter(Boolean) } }, select: { id: true, number: true } }),
    ]);
    return rows.map((g) => ({ ...g, qty: n(g.qty), cost: n(g.cost), price: n(g.price), dpp: n(g.dpp), ppn: n(g.ppn), date: iso(g.date), customer: customers.find((c) => c.id === g.customerId)?.name ?? null, product: products.find((p) => p.id === g.productId) ?? null, delivery: dos.find((d) => d.id === g.deliveryId) ?? null }));
  }

  // ------------------------------------------------------------------ principal claims
  /** what each principal owes for its share of the schemes, not yet claimed, by claim type */
  async claimable(from: string, to: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.schemeUsage.findMany({ where: { companyId, claimId: null, principalShare: { gt: 0 }, date: { gte: new Date(from), lte: new Date(to) } } });
    const schemes = await this.prisma.tradeScheme.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.schemeId))] } } });
    const sups = await this.prisma.supplier.findMany({ where: { id: { in: schemes.map((s) => s.supplierId!).filter(Boolean) } }, select: { id: true, name: true } });
    // only usages on documents still standing count
    const live = new Set((await this.prisma.tradeDocument.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.documentId))] }, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null }, select: { id: true } })).map((d) => d.id));
    const groups = new Map<string, { supplierId: string; supplier: string | null; claimType: string; amount: number; value: number; lines: number; schemes: Set<string> }>();
    for (const r of rows) {
      if (!live.has(r.documentId)) continue;
      const s = schemes.find((x) => x.id === r.schemeId);
      if (!s?.supplierId) continue;
      const key = `${s.supplierId}|${s.claimType}`;
      const g = groups.get(key) ?? { supplierId: s.supplierId, supplier: sups.find((x) => x.id === s.supplierId)?.name ?? null, claimType: s.claimType, amount: 0, value: 0, lines: 0, schemes: new Set<string>() };
      g.amount += n(r.principalShare);
      g.value += n(r.value);
      g.lines++;
      g.schemes.add(s.code);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ ...g, amount: r2(g.amount), value: r2(g.value), schemes: [...g.schemes], tax: CLAIM_TAX[g.claimType] }));
  }

  /** claim one principal's share of one type: a draft invoice to the principal (as a customer), PPN only for services / rent */
  async createClaim(input: z.infer<typeof claimSchema>) {
    RequestCtx.assert('distribution.claim');
    const u = RequestCtx.user();
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!customer) throw invalid({ customerId: 'Choose the principal as a customer (to bill the claim)' });
    const schemes = await this.prisma.tradeScheme.findMany({ where: { companyId: u.companyId, supplierId: input.supplierId, claimType: input.claimType } });
    const usages = await this.prisma.schemeUsage.findMany({ where: { companyId: u.companyId, claimId: null, schemeId: { in: schemes.map((s) => s.id) }, principalShare: { gt: 0 }, date: { gte: input.periodFrom, lte: input.periodTo } } });
    const live = new Set((await this.prisma.tradeDocument.findMany({ where: { id: { in: [...new Set(usages.map((x) => x.documentId))] }, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, deletedAt: null }, select: { id: true } })).map((d) => d.id));
    const take = usages.filter((x) => live.has(x.documentId));
    const amount = r2(take.reduce((a, x) => a + n(x.principalShare), 0));
    if (!(amount > 0)) throw new ConflictException('Nothing to claim from this principal for this type and period');
    const t = CLAIM_TAX[input.claimType];
    const productId = await this.claimProduct(u.companyId, input.claimType);
    const pkp = await this.settings.bool('sales.vatPayer', u.companyId, true);
    const ppn = t.vat && pkp ? await this.prisma.tax.findFirst({ where: { companyId: u.companyId, kind: 'VAT', isActive: true, deletedAt: null, rate: 12, baseNumerator: 11, baseDenominator: 12 } }) : null;
    const number = await this.prisma.$transaction((tx) => this.sequence.next('PRINCIPAL_CLAIM', u.companyId, new Date(), tx));
    const si = await this.docs.create(
      'SI',
      {
        date: localIso(),
        customerId: input.customerId,
        reference: number,
        notes: `${t.label} for ${iso(input.periodFrom)} to ${iso(input.periodTo)}: ${[...new Set(take.map((x) => schemes.find((s) => s.id === x.schemeId)?.code))].join(', ')}. ${t.vat ? 'PPN charged (a service / rent of the distributor).' : 'No PPN (not a delivery, SE-24/PJ/2018).'} Withholding by the principal: ${t.wht}.`,
        lines: [{ productId, description: `${t.label}: schemes ${iso(input.periodFrom)} - ${iso(input.periodTo)} (${take.length} lines)`, qty: 1, unitPrice: amount, taxId: ppn?.id ?? null }],
      },
      undefined,
      { skipPermission: true },
    );
    const claim = await this.prisma.$transaction(async (tx) => {
      const c = await tx.principalClaim.create({ data: { companyId: u.companyId, number, supplierId: input.supplierId, customerId: input.customerId, claimType: input.claimType, periodFrom: input.periodFrom, periodTo: input.periodTo, amount: D(amount), invoiceId: si.id, notes: input.notes ?? null, createdById: u.id } });
      await tx.schemeUsage.updateMany({ where: { id: { in: take.map((x) => x.id) } }, data: { claimId: c.id } });
      return c;
    });
    await this.audit.record('Principal Claim', claim.id, 'CREATE', null, { number, amount, invoice: si.number });
    return { ...claim, amount: n(claim.amount), invoice: { id: si.id, number: si.number } };
  }

  private async claimProduct(companyId: string, type: string) {
    const code = `CLAIM-${type}`.slice(0, 40);
    const found = await this.prisma.product.findFirst({ where: { companyId, code, deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const income = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, CLAIM_TAX[type].key));
    const p = await this.prisma.product.create({ data: { companyId, code, name: `Principal claim - ${CLAIM_TAX[type].label}`, type: 'SERVICE', incomeAccountId: income, isPurchasable: false, description: 'Made by trade schemes: claims to principals', createdById: RequestCtx.user().id } });
    return p.id;
  }

  async claims() {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.principalClaim.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const [sups, invs] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.supplierId) } }, select: { id: true, name: true } }),
      this.prisma.tradeDocument.findMany({ where: { id: { in: rows.map((r) => r.invoiceId!).filter(Boolean) } }, select: { id: true, number: true, status: true, grandTotal: true, paidAmount: true, deletedAt: true } }),
    ]);
    return rows.map((c) => {
      const inv = invs.find((i) => i.id === c.invoiceId);
      return { ...c, amount: n(c.amount), periodFrom: iso(c.periodFrom), periodTo: iso(c.periodTo), supplier: sups.find((s) => s.id === c.supplierId)?.name ?? null, tax: CLAIM_TAX[c.claimType], invoice: inv && !inv.deletedAt ? { id: inv.id, number: inv.number, status: inv.status, total: n(inv.grandTotal), paid: n(inv.paidAmount) } : null };
    });
  }

  /** cancel a claim whose invoice is still a draft: the usages can be claimed again */
  async cancelClaim(id: string) {
    RequestCtx.assert('distribution.claim');
    const c = await this.prisma.principalClaim.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!c) throw new NotFoundException('Claim not found');
    if (c.status !== 'INVOICED') throw new ConflictException('Already cancelled');
    const inv = c.invoiceId ? await this.prisma.tradeDocument.findUnique({ where: { id: c.invoiceId } }) : null;
    if (inv && !inv.deletedAt && inv.status !== 'DRAFT' && inv.status !== 'CANCELLED') throw new ConflictException(`Invoice ${inv.number} is confirmed: cancel it first`);
    await this.prisma.$transaction(async (tx) => {
      if (inv && inv.status === 'DRAFT' && !inv.deletedAt) await tx.tradeDocument.update({ where: { id: inv.id }, data: { deletedAt: new Date() } });
      await tx.schemeUsage.updateMany({ where: { claimId: id }, data: { claimId: null } });
      await tx.principalClaim.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Principal Claim', id, 'CANCEL');
    return { ok: true };
  }
}
