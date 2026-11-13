import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { todayDate } from './local-date';
import { RequestCtx } from '../../common/context/request-context';

const num = z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(1e15).nullable().optional());
const txt = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

/** figures the ERP does not hold, entered for the quarter (SIINas production-stage report, Permenperin 13/2025) */
export const siinasInputsSchema = z.object({
  ownershipDomesticPct: num,
  ownershipForeignPct: num,
  machineryInvestment: num,
  otherInvestment: num,
  workingCapital: num,
  landBuildingValue: num,
  capacity: z.array(z.object({ productId: z.uuid(), annualCapacity: z.coerce.number().min(0).max(1e15), uom: txt(20) })).max(300).default([]),
  electricityPlnKwh: num,
  electricityPlnCost: num,
  electricityOwnKwh: num,
  electricitySoldKwh: num,
  generatorCapacityKva: num,
  fuels: z.array(z.object({ type: z.string().trim().min(1).max(60), uom: z.string().trim().min(1).max(20), qty: z.coerce.number().min(0).max(1e15), cost: z.coerce.number().min(0).max(1e15) })).max(30).default([]),
  water: z.array(z.object({ source: z.string().trim().min(1).max(60), m3: z.coerce.number().min(0).max(1e15), cost: z.coerce.number().min(0).max(1e15) })).max(20).default([]),
  otherWaste: z.array(z.object({ kind: z.enum(['SOLID', 'LIQUID', 'GAS']), description: z.string().trim().min(1).max(120), qty: z.coerce.number().min(0).max(1e15), uom: z.string().trim().min(1).max(20), treatment: txt(120) })).max(30).default([]),
  productionPlanNotes: txt(2000),
  indi40Notes: txt(2000),
  notes: txt(4000),
});
export const siinasSaveSchema = z.object({ year: z.coerce.number().int().min(2019).max(2100), quarter: z.coerce.number().int().min(1).max(4), inputs: siinasInputsSchema });
export const siinasSubmitSchema = z.object({ year: z.coerce.number().int().min(2019).max(2100), quarter: z.coerce.number().int().min(1).max(4), receiptNo: txt(100), undo: z.boolean().default(false) });

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Quarterly SIINas report (Permenperin 13/2025: every quarter, due the 10th day after the quarter): production,
 * sales, raw and auxiliary materials by origin, workforce, machines, inventory, expenses and waste come from the
 * ERP; capacity, energy, water and investment figures are entered. One SIINas account per factory location.
 */
@Injectable()
export class SiinasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static period(year: number, quarter: number) {
    const from = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3, 0));
    const due = new Date(Date.UTC(quarter === 4 ? year + 1 : year, quarter === 4 ? 0 : quarter * 3, 10));
    return { from, to, due };
  }

  async report(year: number, quarter: number) {
    RequestCtx.assert('compliance.read');
    if (!(year >= 2019 && year <= 2100 && quarter >= 1 && quarter <= 4)) throw new BadRequestException('Choose a year and quarter');
    const companyId = RequestCtx.companyId();
    const { from, to, due } = SiinasService.period(year, quarter);
    const saved = await this.prisma.siinasReport.findUnique({ where: { companyId_year_quarter: { companyId, year, quarter } } });
    const inputs = siinasInputsSchema.parse(saved?.inputs ?? {});

    // ---- production (finished work orders) and materials used
    const orders = await this.prisma.workOrder.findMany({ where: { companyId, deletedAt: null, status: 'DONE', completedDate: { gte: from, lte: to } }, include: { lines: true, outputs: true } });
    const made = new Map<string, { qty: number; value: number }>();
    const used = new Map<string, { qty: number; value: number }>();
    const add = (m: Map<string, { qty: number; value: number }>, id: string, q: number, v: number) => {
      const x = m.get(id) ?? { qty: 0, value: 0 };
      x.qty += q;
      x.value += v;
      m.set(id, x);
    };
    for (const o of orders) {
      add(made, o.productId, Number(o.producedQty), Number(o.producedQty) * Number(o.unitCost));
      for (const y of o.outputs) if (Number(y.producedQty) > 0) add(made, y.productId, Number(y.producedQty), Number(y.producedQty) * Number(y.unitCost));
      for (const l of o.lines) add(used, l.productId, Number(l.consumedQty), Number(l.consumedQty) * Number(l.unitCost));
    }
    // ---- sales of own products (invoices less returns), export = customer abroad
    const bomProducts = new Set((await this.prisma.bom.findMany({ where: { companyId, deletedAt: null }, select: { productId: true } })).map((b) => b.productId));
    const own = new Set([...made.keys(), ...bomProducts]);
    const docs = await this.prisma.tradeDocument.findMany({ where: { companyId, docType: { in: ['SI', 'SR'] }, status: { in: ['CONFIRMED', 'PARTIAL', 'COMPLETED'] }, date: { gte: from, lte: to } }, select: { docType: true, customerId: true, lines: { select: { productId: true, qty: true, lineTotal: true } } } });
    const custCountry = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.customerId!).filter(Boolean))] } }, select: { id: true, countryCode: true } })).map((c) => [c.id, (c.countryCode || 'ID').toUpperCase()]));
    const sold = new Map<string, { qty: number; value: number; exportQty: number; exportValue: number }>();
    for (const d of docs) {
      const sign = d.docType === 'SR' ? -1 : 1;
      const exp = d.customerId ? custCountry.get(d.customerId) !== 'ID' : false;
      for (const l of d.lines) {
        if (!l.productId || !own.has(l.productId)) continue;
        const x = sold.get(l.productId) ?? { qty: 0, value: 0, exportQty: 0, exportValue: 0 };
        x.qty += sign * Number(l.qty);
        x.value += sign * Number(l.lineTotal);
        if (exp) {
          x.exportQty += sign * Number(l.qty);
          x.exportValue += sign * Number(l.lineTotal);
        }
        sold.set(l.productId, x);
      }
    }
    const capIds = inputs.capacity.map((c) => c.productId);
    const ids = [...new Set([...made.keys(), ...used.keys(), ...sold.keys(), ...capIds])];
    const products = new Map(
      (await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, hsCode: true, originCountry: true, auxiliaryMaterial: true, preferredSupplierId: true, uom: { select: { code: true } } } })).map((p) => [p.id, p]),
    );
    const supCountry = new Map((await this.prisma.supplier.findMany({ where: { id: { in: [...products.values()].map((p) => p.preferredSupplierId!).filter(Boolean) } }, select: { id: true, countryCode: true } })).map((s) => [s.id, (s.countryCode || 'ID').toUpperCase()]));
    const p = (id: string) => products.get(id);
    const cap = new Map(inputs.capacity.map((c) => [c.productId, c]));
    const production = [...new Set([...made.keys(), ...sold.keys(), ...capIds])].map((id) => {
      const m = made.get(id) ?? { qty: 0, value: 0 };
      const s = sold.get(id) ?? { qty: 0, value: 0, exportQty: 0, exportValue: 0 };
      const c = cap.get(id);
      const quarterCapacity = c ? c.annualCapacity / 4 : null;
      return {
        productId: id,
        code: p(id)?.code ?? '',
        name: p(id)?.name ?? '',
        hsCode: p(id)?.hsCode ?? null,
        uom: p(id)?.uom?.code ?? '',
        producedQty: r2(m.qty),
        producedValue: Math.round(m.value),
        soldQty: r2(s.qty),
        soldValue: Math.round(s.value),
        exportQty: r2(s.exportQty),
        exportValue: Math.round(s.exportValue),
        annualCapacity: c?.annualCapacity ?? null,
        quarterCapacity,
        utilisation: quarterCapacity ? r2((m.qty / quarterCapacity) * 100) : null,
      };
    });
    const materials = [...used.entries()].map(([id, v]) => {
      const prod = p(id);
      const origin = (prod?.originCountry || supCountry.get(prod?.preferredSupplierId ?? '') || 'ID').toUpperCase();
      return { productId: id, code: prod?.code ?? '', name: prod?.name ?? '', hsCode: prod?.hsCode ?? null, uom: prod?.uom?.code ?? '', auxiliary: !!prod?.auxiliaryMaterial, origin, imported: origin !== 'ID', qty: r2(v.qty), value: Math.round(v.value) };
    });

    // ---- workforce at the end of the quarter
    const staff = await this.prisma.employee.findMany({ where: { companyId, deletedAt: null, AND: [{ OR: [{ joinDate: null }, { joinDate: { lte: to } }] }, { OR: [{ endDate: null }, { endDate: { gte: to } }] }], ...(to >= todayDate() ? { isActive: true } : {}) }, select: { genderCode: true, nationality: true, directLabour: true, educationCode: true } });
    const count = (f: (e: (typeof staff)[number]) => boolean) => staff.filter(f).length;
    const workforce = {
      total: staff.length,
      production: { male: count((e) => e.directLabour && e.genderCode === 'M'), female: count((e) => e.directLabour && e.genderCode === 'F'), unknown: count((e) => e.directLabour && !['M', 'F'].includes(e.genderCode ?? '')) },
      other: { male: count((e) => !e.directLabour && e.genderCode === 'M'), female: count((e) => !e.directLabour && e.genderCode === 'F'), unknown: count((e) => !e.directLabour && !['M', 'F'].includes(e.genderCode ?? '')) },
      indonesian: count((e) => (e.nationality || 'ID') === 'ID'),
      foreign: count((e) => (e.nationality || 'ID') !== 'ID'),
    };

    // ---- machines and equipment
    const eq = await this.prisma.equipment.findMany({ where: { companyId, deletedAt: null, status: { not: 'RETIRED' } }, orderBy: { code: 'asc' }, select: { code: true, name: true, kind: true, manufacturer: true, model: true, workCenterId: true } });
    const wcs = new Map((await this.prisma.workCenter.findMany({ where: { companyId }, select: { id: true, name: true, capacityHours: true } })).map((w) => [w.id, w]));
    const machines = eq.map((e) => ({ ...e, workCenter: e.workCenterId ? wcs.get(e.workCenterId)?.name ?? null : null }));

    // ---- inventory value at the end of the quarter: raw materials (BOM components), finished goods (have a BOM), other
    const comps = new Set((await this.prisma.bomLine.findMany({ where: { bom: { companyId, deletedAt: null } }, select: { productId: true } })).map((l) => l.productId));
    const stock = await this.prisma.stockMovement.groupBy({ by: ['productId'], where: { companyId, date: { lte: to } }, _sum: { totalCost: true } });
    const inventory = { raw: 0, finished: 0, other: 0 };
    for (const s of stock) {
      const v = Number(s._sum.totalCost ?? 0);
      if (bomProducts.has(s.productId)) inventory.finished += v;
      else if (comps.has(s.productId)) inventory.raw += v;
      else inventory.other += v;
    }

    // ---- expenses of the quarter by account (posted journals)
    const exp = await this.prisma.journalLine.groupBy({ by: ['accountId'], where: { entry: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, account: { type: 'EXPENSE' } }, _sum: { debit: true, credit: true } });
    const accts = new Map((await this.prisma.account.findMany({ where: { id: { in: exp.map((e) => e.accountId) } }, select: { id: true, code: true, name: true } })).map((a) => [a.id, a]));
    const expenses = exp
      .map((e) => ({ code: accts.get(e.accountId)?.code ?? '', name: accts.get(e.accountId)?.name ?? '', amount: Math.round(Number(e._sum.debit ?? 0) - Number(e._sum.credit ?? 0)) }))
      .filter((e) => e.amount)
      .sort((a, b) => a.code.localeCompare(b.code));

    // ---- B3 waste of the quarter
    const types = await this.prisma.wasteType.findMany({ where: { companyId, deletedAt: null } });
    const ents = await this.prisma.wasteEntry.groupBy({ by: ['wasteTypeId'], where: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, _sum: { qty: true } });
    const hos = await this.prisma.wasteHandover.findMany({ where: { companyId, status: 'POSTED', date: { gte: from, lte: to } }, include: { lines: true } });
    const waste = types
      .map((t) => ({
        code: t.code,
        name: t.name,
        generatedKg: Number(ents.find((e) => e.wasteTypeId === t.id)?._sum.qty ?? 0),
        handedKg: hos.reduce((a, h) => a + h.lines.filter((l) => l.wasteTypeId === t.id).reduce((x, l) => x + Number(l.qty), 0), 0),
        treatments: [...new Set(hos.filter((h) => h.lines.some((l) => l.wasteTypeId === t.id)).map((h) => h.treatment))],
      }))
      .filter((w) => w.generatedKg || w.handedKg);

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true, address: true } });
    return {
      company: company?.legalName || company?.name,
      period: { year, quarter, from, to, due, daysLeft: Math.ceil((due.getTime() - Date.now()) / 86_400_000) },
      status: saved?.status ?? 'NOT_STARTED',
      submittedAt: saved?.submittedAt ?? null,
      receiptNo: saved?.receiptNo ?? null,
      inputs,
      production,
      materials,
      workforce,
      machines,
      inventory: { raw: Math.round(inventory.raw), finished: Math.round(inventory.finished), other: Math.round(inventory.other) },
      expenses,
      waste,
      workCenters: [...wcs.values()].map((w) => ({ name: w.name, capacityHoursPerMonth: Number(w.capacityHours) })),
    };
  }

  async save(input: z.infer<typeof siinasSaveSchema>) {
    RequestCtx.assert('compliance.siinas.manage');
    const u = RequestCtx.user();
    const cur = await this.prisma.siinasReport.findUnique({ where: { companyId_year_quarter: { companyId: u.companyId, year: input.year, quarter: input.quarter } } });
    if (cur?.status === 'SUBMITTED') throw new ConflictException('This quarter was reported; reopen it first');
    if (input.inputs.capacity.length && (await this.prisma.product.count({ where: { id: { in: input.inputs.capacity.map((c) => c.productId) }, companyId: u.companyId } })) !== new Set(input.inputs.capacity.map((c) => c.productId)).size) throw new BadRequestException('A product was not found');
    await this.prisma.siinasReport.upsert({
      where: { companyId_year_quarter: { companyId: u.companyId, year: input.year, quarter: input.quarter } },
      create: { companyId: u.companyId, year: input.year, quarter: input.quarter, inputs: input.inputs, updatedById: u.id },
      update: { inputs: input.inputs, updatedById: u.id },
    });
    await this.audit.record('SIINas Report', null, 'SAVE', undefined, { year: input.year, quarter: input.quarter });
    return this.report(input.year, input.quarter);
  }

  /** marks the quarter as reported in SIINas (with the receipt number), or reopens it */
  async submit(input: z.infer<typeof siinasSubmitSchema>) {
    RequestCtx.assert('compliance.siinas.manage');
    const u = RequestCtx.user();
    const key = { companyId_year_quarter: { companyId: u.companyId, year: input.year, quarter: input.quarter } };
    const data = input.undo ? { status: 'DRAFT', submittedAt: null, receiptNo: null, updatedById: u.id } : { status: 'SUBMITTED', submittedAt: new Date(), receiptNo: input.receiptNo ?? null, updatedById: u.id };
    await this.prisma.siinasReport.upsert({ where: key, create: { companyId: u.companyId, year: input.year, quarter: input.quarter, ...data }, update: data });
    await this.audit.record('SIINas Report', null, input.undo ? 'REOPEN' : 'SUBMITTED', undefined, { year: input.year, quarter: input.quarter, receiptNo: input.receiptNo });
    return this.report(input.year, input.quarter);
  }
}
