import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { DocumentService } from '../documents/document.service';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optNum = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const optDate = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.date().nullable().optional());

export const contractSchema = z
  .object({
    partnerId: z.uuid(),
    siteId: optUuid,
    species: z.enum(['BROILER', 'LAYER', 'BREEDER', 'DUCK', 'QUAIL', 'FISH', 'SHRIMP', 'OTHER']).default('BROILER'),
    startDate: z.coerce.date(),
    endDate: optDate,
    docPrice: z.coerce.number().min(0).max(1e9),
    feedPrices: z.array(z.object({ productId: z.uuid(), price: z.coerce.number().min(0).max(1e9) })).max(50).default([]),
    medicineMarkupPct: z.coerce.number().min(0).max(1000).default(0),
    priceBands: z.array(z.object({ minKg: z.coerce.number().min(0).max(1000), maxKg: z.coerce.number().min(0).max(1000), price: z.coerce.number().min(0).max(1e9) })).min(1, 'Add the harvest price per weight range').max(50),
    standardFcr: optNum,
    fcrBonusPerPoint: z.coerce.number().min(0).max(1e9).default(0),
    ipThreshold: optNum,
    ipBonusPerKg: z.coerce.number().min(0).max(1e9).default(0),
    withholdPph22: z.boolean().default(false),
    terms: optText(20000),
    acknowledgedBy: optText(150),
    acknowledgedAt: optDate,
    status: z.enum(['ACTIVE', 'ENDED']).default('ACTIVE'),
  })
  .superRefine((k, ctx) => {
    k.priceBands.forEach((b, i) => b.maxKg < b.minKg && ctx.addIssue({ code: 'custom', path: ['priceBands', i, 'maxKg'], message: 'Below the minimum' }));
    if (k.endDate && k.endDate < k.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Before the start' });
  });
export const settleSchema = z.object({ date: z.coerce.date(), deductions: z.coerce.number().min(0).max(1e13).default(0), notes: optText(1000) });

/**
 * Inti-plasma partnership (Permentan 13/2017): the company supplies DOC, feed and medicines at contract prices and
 * buys the harvest at the contract price for its average weight; the farmer is paid the settlement (rekapitulasi
 * hasil pemeliharaan, RHPP) = harvest value - inputs + FCR / IP bonuses - deductions - loss carried from earlier
 * cycles. The written agreement holds the items of Art. 11 (2) and is acknowledged by the regency / city; the
 * partnership is reported at least every 3 months (Art. 19).
 */
@Injectable()
export class PartnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly documents: DocumentService,
  ) {}

  // ---------------------------------------------------------------- contracts
  async contracts() {
    RequestCtx.assert('farm.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.partnerContract.findMany({ where: { companyId, deletedAt: null }, orderBy: [{ status: 'asc' }, { startDate: 'desc' }] });
    const partners = new Map((await this.prisma.supplier.findMany({ where: { id: { in: rows.map((r) => r.partnerId) } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
    const sites = new Map((await this.prisma.farmSite.findMany({ where: { companyId } })).map((s) => [s.id, s]));
    const pids = [...new Set(rows.flatMap((r) => (r.feedPrices as { productId: string }[]).map((f) => f.productId)))];
    const products = new Map((await this.prisma.product.findMany({ where: { id: { in: pids } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      ...r,
      docPrice: n(r.docPrice),
      medicineMarkupPct: n(r.medicineMarkupPct),
      standardFcr: r.standardFcr === null ? null : n(r.standardFcr),
      fcrBonusPerPoint: n(r.fcrBonusPerPoint),
      ipThreshold: r.ipThreshold === null ? null : n(r.ipThreshold),
      ipBonusPerKg: n(r.ipBonusPerKg),
      carryForward: n(r.carryForward),
      feedPrices: (r.feedPrices as { productId: string; price: number }[]).map((f) => ({ ...f, name: products.get(f.productId) ?? '' })),
      partner: partners.get(r.partnerId) ?? null,
      site: r.siteId ? { id: r.siteId, name: sites.get(r.siteId)?.name ?? '' } : null,
    }));
  }

  async saveContract(id: string | null, input: z.infer<typeof contractSchema>) {
    RequestCtx.assert('farm.contract.manage');
    const u = RequestCtx.user();
    const err = (k: string, m: string) => new BadRequestException({ message: 'Validation failed', errors: { [k]: m } });
    if (!(await this.prisma.supplier.count({ where: { id: input.partnerId, companyId: u.companyId, deletedAt: null } }))) throw err('partnerId', 'Farmer not found');
    if (input.siteId) {
      const s = await this.prisma.farmSite.findFirst({ where: { id: input.siteId, companyId: u.companyId, deletedAt: null } });
      if (!s) throw err('siteId', 'Farm not found');
      if (s.ownership !== 'PLASMA') throw err('siteId', 'Mark the farm as a plasma farm first');
      if (s.partnerId && s.partnerId !== input.partnerId) throw err('siteId', 'This farm belongs to another farmer');
    }
    const pids = input.feedPrices.map((f) => f.productId);
    if (pids.length && (await this.prisma.product.count({ where: { id: { in: pids }, companyId: u.companyId } })) !== new Set(pids).size) throw err('feedPrices', 'A feed product was not found');
    const data = {
      partnerId: input.partnerId,
      siteId: input.siteId ?? null,
      species: input.species,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      docPrice: D(input.docPrice),
      feedPrices: input.feedPrices,
      medicineMarkupPct: D(input.medicineMarkupPct),
      priceBands: [...input.priceBands].sort((a, b) => a.minKg - b.minKg),
      standardFcr: input.standardFcr === null || input.standardFcr === undefined ? null : D(input.standardFcr),
      fcrBonusPerPoint: D(input.fcrBonusPerPoint),
      ipThreshold: input.ipThreshold === null || input.ipThreshold === undefined ? null : D(input.ipThreshold),
      ipBonusPerKg: D(input.ipBonusPerKg),
      withholdPph22: input.withholdPph22,
      terms: input.terms ?? null,
      acknowledgedBy: input.acknowledgedBy ?? null,
      acknowledgedAt: input.acknowledgedAt ?? null,
      status: input.status,
      updatedById: u.id,
    };
    let row;
    if (id) {
      if (!UUID.test(id)) throw new NotFoundException('Contract not found');
      const before = await this.prisma.partnerContract.findFirst({ where: { id, companyId: u.companyId, deletedAt: null } });
      if (!before) throw new NotFoundException('Contract not found');
      row = await this.prisma.partnerContract.update({ where: { id }, data });
      await this.audit.record('Partnership Contract', id, 'UPDATE', before, row);
    } else {
      row = await this.prisma.partnerContract.create({ data: { ...data, companyId: u.companyId, number: await this.sequence.next('PARTNER_CONTRACT', u.companyId, input.startDate), createdById: u.id } });
      await this.audit.record('Partnership Contract', row.id, 'CREATE', undefined, row);
    }
    if (input.siteId) await this.prisma.farmSite.updateMany({ where: { id: input.siteId, partnerId: null }, data: { partnerId: input.partnerId } });
    return row;
  }

  // ---------------------------------------------------------------- settlement (RHPP)
  /** what the farmer earns from a plasma cycle under its contract */
  async preview(cycleId: string, deductions = 0) {
    RequestCtx.assert('farm.read');
    const companyId = RequestCtx.companyId();
    if (!UUID.test(cycleId ?? '')) throw new NotFoundException('Cycle not found');
    const c = await this.prisma.livestockCycle.findFirst({ where: { id: cycleId, companyId } });
    if (!c) throw new NotFoundException('Cycle not found');
    if (!c.contractId) throw new BadRequestException('This is not a plasma cycle');
    const k = await this.prisma.partnerContract.findUniqueOrThrow({ where: { id: c.contractId } });
    const harvests = await this.prisma.livestockHarvest.findMany({ where: { cycleId, status: 'POSTED' } });
    const daily = await this.prisma.livestockDaily.findMany({ where: { cycleId } });
    const treatments = await this.prisma.livestockTreatment.findMany({ where: { cycleId, status: 'DONE' } });
    const qty = harvests.reduce((a, h) => a + h.qty, 0);
    const kg = harvests.reduce((a, h) => a + n(h.weightKg), 0);
    const avg = qty ? kg / qty : 0;
    const age = kg ? harvests.reduce((a, h) => a + h.ageDays * n(h.weightKg), 0) / kg : 0;
    const bands = k.priceBands as { minKg: number; maxKg: number; price: number }[];
    const band = bands.find((b) => avg >= b.minKg - 1e-9 && avg <= b.maxKg + 1e-9) ?? null;
    const price = band?.price ?? 0;
    const feedPrice = new Map((k.feedPrices as { productId: string; price: number }[]).map((f) => [f.productId, f.price]));
    const feedLines = new Map<string, { kg: number; cost: number }>();
    for (const d of daily) {
      if (!d.feedProductId || n(d.feedKg) <= 0) continue;
      const x = feedLines.get(d.feedProductId) ?? { kg: 0, cost: 0 };
      x.kg += n(d.feedKg);
      x.cost += n(d.feedCost);
      feedLines.set(d.feedProductId, x);
    }
    const names = new Map((await this.prisma.product.findMany({ where: { id: { in: [...feedLines.keys()] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const feed = [...feedLines.entries()].map(([pid, x]) => ({ productId: pid, name: names.get(pid) ?? '', kg: r2(x.kg), price: feedPrice.get(pid) ?? null, amount: Math.round(feedPrice.has(pid) ? x.kg * feedPrice.get(pid)! : x.cost) }));
    const feedKg = feed.reduce((a, f) => a + f.kg, 0);
    const feedCharge = feed.reduce((a, f) => a + f.amount, 0);
    const medicineCharge = Math.round(treatments.reduce((a, t) => a + n(t.cost), 0) * (1 + n(k.medicineMarkupPct) / 100));
    const docCharge = Math.round(c.initialQty * n(k.docPrice));
    const revenue = Math.round(kg * price);
    const fcr = kg > 0 ? feedKg / kg : 0;
    const livability = c.initialQty ? ((c.initialQty - c.mortality - c.culled) / c.initialQty) * 100 : 0;
    const ip = fcr > 0 && age > 0 ? (livability * avg) / (fcr * age) * 100 : 0;
    const std = k.standardFcr === null ? null : n(k.standardFcr);
    // each full 0.01 of FCR better than the standard earns the bonus per kg harvested
    const points = std !== null && fcr > 0 && fcr < std ? Math.floor((std - fcr) * 100 + 1e-9) : 0;
    const fcrBonus = Math.round(points * n(k.fcrBonusPerPoint) * kg);
    const ipBonus = k.ipThreshold !== null && ip >= n(k.ipThreshold) ? Math.round(n(k.ipBonusPerKg) * kg) : 0;
    // once settled, show what was posted (the contract's balance has moved on since)
    const posted = await this.prisma.partnerSettlement.findFirst({ where: { cycleId, status: 'POSTED' } });
    if (posted) deductions = n(posted.deductions);
    const carriedIn = posted ? n(posted.carriedIn) : n(k.carryForward);
    const net = revenue - docCharge - feedCharge - medicineCharge + fcrBonus + ipBonus - deductions - carriedIn;
    const alive = c.initialQty - c.mortality - c.culled - c.harvestedQty;
    const partner = await this.prisma.supplier.findUnique({ where: { id: k.partnerId }, select: { id: true, name: true } });
    return {
      settled: posted ? { id: posted.id, number: posted.number, net: n(posted.net) } : null,
      cycle: { id: c.id, number: c.number, status: c.status, alive, initialQty: c.initialQty, mortality: c.mortality, culled: c.culled },
      contract: { id: k.id, number: k.number, partner, withholdPph22: k.withholdPph22 },
      harvestQty: qty,
      harvestKg: r2(kg),
      avgWeightKg: Math.round(avg * 1000) / 1000,
      avgAgeDays: r2(age),
      band,
      pricePerKg: price,
      revenue,
      docCharge,
      feed,
      feedCharge,
      medicineCharge,
      fcr: Math.round(fcr * 1000) / 1000,
      standardFcr: std,
      fcrPoints: points,
      ip: Math.round(ip),
      fcrBonus,
      ipBonus,
      deductions,
      carriedIn,
      net,
      warnings: [...(alive > 0 ? [`${alive} heads still alive: settle after the last harvest`] : []), ...(!band && qty ? [`No contract price for an average weight of ${avg.toFixed(3)} kg`] : []), ...(!qty ? ['Nothing harvested yet'] : [])],
    };
  }

  /** posts the settlement: a positive result becomes a draft purchase invoice of the farmer; a loss is carried forward */
  async settle(cycleId: string, input: z.infer<typeof settleSchema>) {
    RequestCtx.assert('farm.settlement.manage');
    const u = RequestCtx.user();
    const p = await this.preview(cycleId, input.deductions);
    if (p.warnings.length) throw new ConflictException(p.warnings[0]);
    if (await this.prisma.partnerSettlement.count({ where: { cycleId, status: 'POSTED' } })) throw new ConflictException('This cycle is already settled');
    const k = await this.prisma.partnerContract.findUniqueOrThrow({ where: { id: p.contract.id } });
    const number = await this.sequence.next('PARTNER_SETTLE', u.companyId, input.date);
    let invoiceId: string | null = null;
    if (p.net > 0) {
      const product = await this.feeProduct(u.companyId);
      const doc = await this.documents.create(
        'PI',
        {
          date: input.date,
          supplierId: k.partnerId,
          reference: number,
          notes: `Plasma settlement (RHPP) ${number} of ${p.cycle.number}: harvest ${p.harvestKg} kg x ${p.pricePerKg} = ${p.revenue}; DOC ${p.docCharge}, feed ${p.feedCharge}, medicines ${p.medicineCharge}; FCR ${p.fcr} bonus ${p.fcrBonus}, IP ${p.ip} bonus ${p.ipBonus}; deductions ${p.deductions}; earlier loss ${p.carriedIn}.${k.withholdPph22 ? ' Collect PPh 22 0.25% on the harvest purchase when paying (PMK 51/2025).' : ''}`,
          lines: [{ productId: product.id, description: `Settlement ${p.cycle.number}`, qty: 1, unitPrice: p.net, taxId: null }],
        },
        undefined,
        { skipPermission: true },
      );
      invoiceId = (doc as { id: string }).id;
    }
    const s = await this.prisma.$transaction(async (tx) => {
      await tx.partnerContract.update({ where: { id: k.id }, data: { carryForward: D(p.net < 0 ? -p.net : 0) } });
      return tx.partnerSettlement.create({
        data: {
          companyId: u.companyId,
          number,
          contractId: k.id,
          cycleId,
          date: input.date,
          harvestQty: p.harvestQty,
          harvestKg: D(p.harvestKg),
          avgWeightKg: D(p.avgWeightKg),
          pricePerKg: D(p.pricePerKg),
          revenue: D(p.revenue),
          docCharge: D(p.docCharge),
          feedCharge: D(p.feedCharge),
          medicineCharge: D(p.medicineCharge),
          fcr: D(p.fcr),
          ip: D(p.ip),
          fcrBonus: D(p.fcrBonus),
          ipBonus: D(p.ipBonus),
          deductions: D(p.deductions),
          carriedIn: D(p.carriedIn),
          net: D(p.net),
          invoiceId,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
    });
    await this.audit.record('Plasma Settlement', s.id, 'CREATE', undefined, { number, net: p.net });
    return { ...s, net: p.net, invoiceId };
  }

  private async feeProduct(companyId: string) {
    const existing = await this.prisma.product.findFirst({ where: { companyId, code: 'PLASMA-FEE', deletedAt: null } });
    if (existing) return existing;
    const acc = await this.prisma.accountMapping.findFirst({ where: { companyId, key: 'PLASMA_FEE' } });
    return this.prisma.product.create({ data: { companyId, code: 'PLASMA-FEE', name: 'Plasma farmer settlement (RHPP)', type: 'SERVICE', isSellable: false, isPurchasable: true, expenseAccountId: acc?.accountId ?? null, description: 'Net amount due to a plasma farmer for a cycle under an inti-plasma partnership contract.' } });
  }

  async settlements(contractId?: string) {
    RequestCtx.assert('farm.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.partnerSettlement.findMany({ where: { companyId, ...(contractId && UUID.test(contractId) ? { contractId } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 300 });
    const cycles = new Map((await this.prisma.livestockCycle.findMany({ where: { id: { in: rows.map((r) => r.cycleId) } }, select: { id: true, number: true } })).map((c) => [c.id, c.number]));
    const docs = new Map((await this.prisma.tradeDocument.findMany({ where: { id: { in: rows.map((r) => r.invoiceId!).filter(Boolean) }, deletedAt: null }, select: { id: true, number: true, status: true } })).map((d) => [d.id, d]));
    return rows.map((r) => ({ id: r.id, number: r.number, date: r.date, status: r.status, cycleId: r.cycleId, cycle: cycles.get(r.cycleId) ?? '', harvestKg: n(r.harvestKg), fcr: n(r.fcr), ip: n(r.ip), revenue: n(r.revenue), net: n(r.net), invoice: r.invoiceId ? docs.get(r.invoiceId) ?? null : null }));
  }

  async cancelSettlement(id: string) {
    RequestCtx.assert('farm.settlement.manage');
    if (!UUID.test(id ?? '')) throw new NotFoundException('Settlement not found');
    const s = await this.prisma.partnerSettlement.findFirst({ where: { id, companyId: RequestCtx.companyId(), status: 'POSTED' } });
    if (!s) throw new NotFoundException('Settlement not found');
    const later = await this.prisma.partnerSettlement.findFirst({ where: { contractId: s.contractId, status: 'POSTED', createdAt: { gt: s.createdAt } } });
    if (later) throw new ConflictException(`Settlement ${later.number} came after it: cancel that one first`);
    await this.prisma.$transaction(async (tx) => {
      if (s.invoiceId) {
        const d = await tx.tradeDocument.findUnique({ where: { id: s.invoiceId } });
        if (d && !d.deletedAt && d.status !== 'DRAFT') throw new ConflictException(`Invoice ${d.number} is already confirmed: cancel it first`);
        if (d && !d.deletedAt) await tx.tradeDocument.update({ where: { id: d.id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
      }
      await tx.partnerContract.update({ where: { id: s.contractId }, data: { carryForward: s.carriedIn } });
      await tx.partnerSettlement.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Plasma Settlement', id, 'CANCEL');
    return { ok: true };
  }

  // ---------------------------------------------------------------- partnership report (Art. 19, Format-2)
  async report(year: number, quarter: number) {
    RequestCtx.assert('farm.read');
    if (!(year >= 2017 && year <= 2100 && quarter >= 1 && quarter <= 4)) throw new BadRequestException('Choose a year and quarter');
    const companyId = RequestCtx.companyId();
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3, 0));
    const contracts = await this.prisma.partnerContract.findMany({ where: { companyId, deletedAt: null, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] } });
    const partners = new Map((await this.prisma.supplier.findMany({ where: { id: { in: contracts.map((k) => k.partnerId) } }, select: { id: true, name: true, address: true, city: true } })).map((s) => [s.id, s]));
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });
    const rows = [];
    for (const k of contracts) {
      const cycles = await this.prisma.livestockCycle.findMany({ where: { contractId: k.id, status: { in: ['ACTIVE', 'CLOSED'] }, placementDate: { lte: to }, OR: [{ closedAt: null }, { closedAt: { gte: from } }] } });
      const ids = cycles.map((c) => c.id);
      const sites = await this.prisma.farmSite.findMany({ where: { id: { in: [...new Set(cycles.map((c) => c.siteId)), ...(k.siteId ? [k.siteId] : [])] } } });
      const harvests = await this.prisma.livestockHarvest.findMany({ where: { cycleId: { in: ids }, status: 'POSTED', date: { gte: from, lte: to } } });
      const settles = await this.prisma.partnerSettlement.findMany({ where: { contractId: k.id, status: 'POSTED', date: { gte: from, lte: to } } });
      const placed = cycles.filter((c) => c.placementDate >= from).reduce((a, c) => a + c.initialQty, 0);
      rows.push({
        contract: k.number,
        partner: partners.get(k.partnerId)?.name ?? '',
        pattern: 'Inti-plasma',
        species: k.species,
        locations: sites.map((s) => [s.name, s.regency].filter(Boolean).join(', ')),
        period: { start: k.startDate, end: k.endDate },
        acknowledgedBy: k.acknowledgedBy,
        cyclesActive: cycles.length,
        cyclesClosed: cycles.filter((c) => c.closedAt && c.closedAt <= to).length,
        placedHeads: placed,
        harvestedHeads: harvests.reduce((a, h) => a + h.qty, 0),
        harvestedKg: r2(harvests.reduce((a, h) => a + n(h.weightKg), 0)),
        settledValue: settles.reduce((a, s) => a + n(s.revenue), 0),
        paidToFarmer: settles.reduce((a, s) => a + Math.max(0, n(s.net)), 0),
        avgFcr: settles.length ? Math.round((settles.reduce((a, s) => a + n(s.fcr), 0) / settles.length) * 1000) / 1000 : null,
        avgIp: settles.length ? Math.round(settles.reduce((a, s) => a + n(s.ip), 0) / settles.length) : null,
        carryForward: n(k.carryForward),
      });
    }
    return { company: company?.legalName || company?.name, period: { year, quarter, from, to }, rows };
  }
}
