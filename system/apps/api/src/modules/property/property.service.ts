import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { JournalService, PostingLine } from '../accounting/journal.service';
import { DocumentService } from '../documents/document.service';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DAY = 86_400_000;
const today = () => new Date(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const addMonths = (d: Date, k: number) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), Math.min(d.getUTCDate(), last)));
};
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

/** PMK 90/2025: PPN on houses up to Rp5 bn, borne by the government on the part of the price up to Rp2 bn */
export const DTP_CEILING = 5_000_000_000;
export const DTP_PART = 2_000_000_000;
export const PPN_MODES = ['STANDARD', 'DTP', 'EXEMPT', 'NONE'] as const;

export const siteSchema = z.object({
  projectId: z.uuid(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['HOUSE', 'APARTMENT', 'SHOPHOUSE', 'LAND']).default('HOUSE'),
  address: optText(300),
  estimatedCost: z.coerce.number().min(0).max(1e15).default(0),
  isActive: z.boolean().default(true),
  notes: optText(2000),
});
export const unitsSchema = z.object({
  units: z
    .array(
      z.object({
        id: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
        code: z.string().trim().min(1).max(30),
        unitType: optText(60),
        landArea: z.coerce.number().min(0).max(1e9).default(0),
        buildingArea: z.coerce.number().min(0).max(1e9).default(0),
        price: z.coerce.number().positive().max(1e15),
        ppnMode: z.enum(PPN_MODES).default('STANDARD'),
        pphRate: z.coerce
          .number()
          .refine((v) => [0, 1, 2.5].includes(v), 'PP 34/2016: 2.5%, 1% (simple houses) or 0%')
          .default(2.5),
        readyToOccupy: z.boolean().default(false),
        cost: z.coerce.number().min(0).max(1e15).default(0),
        certificateNo: optText(60),
        notes: optText(500),
      }),
    )
    .max(3000),
});
const lineSchema = z.object({
  kind: z.enum(['BOOKING', 'DP', 'INSTALMENT', 'KPR', 'CASH']),
  label: z.string().trim().min(1).max(100),
  dueDate: z.coerce.date(),
  amount: z.coerce.number().positive().max(1e15),
});
export const bookSchema = z.object({
  unitId: z.uuid(),
  customerId: z.uuid(),
  date: z.coerce.date(),
  price: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().positive().max(1e15).optional()),
  scheme: z.enum(['CASH', 'INSTALMENT', 'KPR']),
  bookingFee: z.coerce.number().min(0).max(1e13).default(0),
  dpPct: z.coerce.number().min(0).max(100).default(0),
  dpCount: z.coerce.number().int().min(1).max(60).default(1),
  instalmentCount: z.coerce.number().int().min(1).max(240).default(12),
  startDate: z.coerce.date(),
  kprBank: optText(100),
  lines: z.array(lineSchema).max(300).optional(),
  notes: optText(2000),
});
export const scheduleSchema = z.object({
  lines: z
    .array(lineSchema.extend({ id: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()) }))
    .min(1)
    .max(300),
});
export const deedSchema = z.object({ no: z.string().trim().min(1).max(60), date: z.coerce.date(), notary: optText(150) });
export const cancelSchema = z.object({ reason: z.enum(['BUYER', 'DEVELOPER']), forfeitPct: z.coerce.number().min(0).max(10).default(10), date: z.coerce.date(), notes: optText(500) });

type Tx = Prisma.TransactionClient;
type SaleLine = { kind: string; label: string; dueDate: Date; amount: number };

/**
 * Property development. Payments before the handover are buyer deposits (SAK EP Bab 23: a sale of goods, recognised
 * when the unit is handed over); each payment carries PPN as it is received (UU PPN Art. 11), or the PPN DTP of PMK
 * 90/2025 (faktur code 07 for the part up to Rp2 bn), or none for exempt simple houses; PPh final PP 34/2016 (2.5% / 1%)
 * on each payment received, paid by us by the 15th of the next month and before the AJB.
 */
@Injectable()
export class PropertyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
  ) {}

  // ------------------------------------------------------------------ helpers
  private async product(companyId: string, code: string, name: string, key: string, side: 'income' | 'expense') {
    const found = await this.prisma.product.findFirst({ where: { companyId, code, deletedAt: null }, select: { id: true } });
    if (found) return found.id;
    const account = await this.prisma.$transaction((tx) => this.journal.mapping(tx, companyId, key));
    const p = await this.prisma.product.create({
      data: {
        companyId,
        code,
        name,
        type: 'SERVICE',
        ...(side === 'income' ? { incomeAccountId: account, isPurchasable: false } : { expenseAccountId: account, isSellable: false }),
        description: 'Made by the property module',
        createdById: RequestCtx.user().id,
      },
    });
    return p.id;
  }

  private async tax(companyId: string, code: string) {
    const t = await this.prisma.tax.findFirst({ where: { companyId, code, kind: 'VAT', deletedAt: null }, select: { id: true } });
    if (!t) throw new BadRequestException(`Tax ${code} is missing: add it in Master > Taxes`);
    return t.id;
  }

  private async liveInvoice(id: string | null) {
    if (!id) return null;
    const d = await this.prisma.tradeDocument.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, number: true, status: true, date: true, dueDate: true, subtotal: true, discountTotal: true, taxTotal: true, grandTotal: true, paidAmount: true },
    });
    return d && d.status !== 'CANCELLED' ? d : null;
  }

  private async dtpWindow(companyId: string) {
    const from = await this.settings.str('property.dtpFrom', companyId, '2026-01-01');
    const until = await this.settings.str('property.dtpUntil', companyId, '2026-12-31');
    return { from: new Date(from), until: new Date(until) };
  }

  /** reasons a sale cannot take the PPN DTP (empty = it can) */
  private async dtpProblems(companyId: string, unit: { price: number; readyToOccupy: boolean }, price: number, date: Date) {
    const w = await this.dtpWindow(companyId);
    const out: string[] = [];
    if (price > DTP_CEILING) out.push('the price is above Rp5 bn');
    if (!unit.readyToOccupy) out.push('the unit is not ready to occupy (siap huni)');
    if (date < w.from || date > w.until) out.push(`the booking falls outside the incentive period (${iso(w.from)} to ${iso(w.until)})`);
    return out;
  }

  // ------------------------------------------------------------------ sites and units
  async sites() {
    RequestCtx.assert('property.read');
    const companyId = RequestCtx.companyId();
    const sites = await this.prisma.propertySite.findMany({ where: { companyId }, orderBy: { code: 'asc' }, include: { units: { select: { status: true, price: true, cost: true } } } });
    const re = await this.prisma.accountMapping.findUnique({ where: { companyId_key: { companyId, key: 'RE_INVENTORY' } } });
    const projects = await this.prisma.project.findMany({ where: { id: { in: sites.map((s) => s.projectId) } }, select: { id: true, code: true, name: true } });
    const booked = re?.accountId
      ? await this.prisma.journalLine.groupBy({
          by: ['projectId'],
          where: { accountId: re.accountId, projectId: { in: sites.map((s) => s.projectId) }, entry: { status: 'POSTED', companyId } },
          _sum: { debit: true, credit: true },
        })
      : [];
    return sites.map(({ units, ...s }) => {
      const b = booked.find((x) => x.projectId === s.projectId);
      return {
        ...s,
        estimatedCost: n(s.estimatedCost),
        project: projects.find((p) => p.id === s.projectId) ?? null,
        units: units.length,
        available: units.filter((u) => u.status === 'AVAILABLE').length,
        booked: units.filter((u) => u.status === 'BOOKED').length,
        sold: units.filter((u) => u.status === 'SOLD').length,
        listValue: r2(units.reduce((a, u) => a + n(u.price), 0)),
        costReleased: r2(units.filter((u) => u.status === 'SOLD').reduce((a, u) => a + n(u.cost), 0)),
        inventory: b ? r2(n(b._sum.debit) - n(b._sum.credit)) : 0,
      };
    });
  }

  async saveSite(id: string | null, input: z.infer<typeof siteSchema>) {
    RequestCtx.assert('property.manage');
    const u = RequestCtx.user();
    const project = await this.prisma.project.findFirst({ where: { id: input.projectId, companyId: u.companyId, deletedAt: null } });
    if (!project) throw invalid({ projectId: 'Choose a project' });
    const dup = await this.prisma.propertySite.findFirst({ where: { companyId: u.companyId, code: input.code, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalid({ code: 'Code used by another site' });
    const data = {
      projectId: input.projectId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      address: input.address ?? null,
      estimatedCost: D(input.estimatedCost),
      isActive: input.isActive,
      notes: input.notes ?? null,
    };
    if (id && !(await this.prisma.propertySite.findFirst({ where: { id, companyId: u.companyId } }))) throw new NotFoundException('Site not found');
    const row = id ? await this.prisma.propertySite.update({ where: { id }, data }) : await this.prisma.propertySite.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    // land and development invoices go to Real Estate Inventory through this product
    await this.product(u.companyId, 'RE-DEV', 'Land and development cost (real estate inventory)', 'RE_INVENTORY', 'expense');
    await this.audit.record('Property Site', row.id, id ? 'UPDATE' : 'CREATE', null, { code: input.code });
    return (await this.sites()).find((s) => s.id === row.id);
  }

  async units(siteId?: string) {
    RequestCtx.assert('property.read');
    const companyId = RequestCtx.companyId();
    const units = await this.prisma.propertyUnit.findMany({
      where: { site: { companyId }, ...(siteId ? { siteId } : {}) },
      orderBy: [{ site: { code: 'asc' } }, { code: 'asc' }],
      include: { site: { select: { code: true, name: true } } },
    });
    const sales = await this.prisma.propertySale.findMany({
      where: { unitId: { in: units.map((x) => x.id) }, status: { not: 'CANCELLED' } },
      select: { id: true, number: true, unitId: true, customerId: true, status: true },
    });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: sales.map((s) => s.customerId) } }, select: { id: true, name: true } });
    return units.map((x) => {
      const s = sales.find((y) => y.unitId === x.id);
      return {
        ...x,
        landArea: n(x.landArea),
        buildingArea: n(x.buildingArea),
        price: n(x.price),
        pphRate: n(x.pphRate),
        cost: n(x.cost),
        sale: s ? { id: s.id, number: s.number, status: s.status, customer: cust.find((c) => c.id === s.customerId)?.name ?? null } : null,
      };
    });
  }

  async saveUnits(siteId: string, input: z.infer<typeof unitsSchema>) {
    RequestCtx.assert('property.manage');
    const u = RequestCtx.user();
    const site = await this.prisma.propertySite.findFirst({ where: { id: siteId, companyId: u.companyId }, include: { units: true } });
    if (!site) throw new NotFoundException('Site not found');
    const codes = new Set<string>();
    for (const [i, x] of input.units.entries()) {
      if (codes.has(x.code)) throw invalid({ [`units.${i}.code`]: `Unit ${x.code} is listed twice` });
      codes.add(x.code);
      if (x.ppnMode === 'DTP' && x.price > DTP_CEILING) throw invalid({ [`units.${i}.ppnMode`]: `${x.code}: the PPN DTP is for houses up to Rp5 bn (PMK 90/2025)` });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const cur of site.units) {
        const keep = input.units.find((x) => x.id === cur.id);
        if (!keep && cur.status !== 'AVAILABLE') throw invalid({ units: `${cur.code} is booked or sold: it cannot be removed` });
        if (keep && cur.status === 'SOLD' && n(keep.cost) !== n(cur.cost)) throw invalid({ units: `${cur.code} is handed over: its cost is in cost of sales` });
      }
      await tx.propertyUnit.deleteMany({ where: { siteId, id: { notIn: input.units.map((x) => x.id).filter(Boolean) as string[] }, status: 'AVAILABLE' } });
      for (const x of input.units) {
        const data = {
          code: x.code,
          unitType: x.unitType ?? null,
          landArea: D(x.landArea),
          buildingArea: D(x.buildingArea),
          price: D(x.price),
          ppnMode: x.ppnMode,
          pphRate: D(x.pphRate),
          readyToOccupy: x.readyToOccupy,
          cost: D(x.cost),
          certificateNo: x.certificateNo ?? null,
          notes: x.notes ?? null,
        };
        if (x.id && site.units.some((y) => y.id === x.id)) await tx.propertyUnit.update({ where: { id: x.id }, data });
        else await tx.propertyUnit.create({ data: { ...data, siteId } });
      }
    });
    await this.audit.record('Property Site', siteId, 'UNITS', null, { units: input.units.length });
    return this.units(siteId);
  }

  /** the estimated cost not yet charged to cost of sales, spread over the units not handed over by relative sales value */
  async allocateCost(siteId: string) {
    RequestCtx.assert('property.manage');
    const u = RequestCtx.user();
    const site = await this.prisma.propertySite.findFirst({ where: { id: siteId, companyId: u.companyId }, include: { units: true } });
    if (!site) throw new NotFoundException('Site not found');
    if (n(site.estimatedCost) <= 0) throw invalid({ estimatedCost: 'Enter the estimated total cost of the site first' });
    const sold = site.units.filter((x) => x.status === 'SOLD');
    const open = site.units.filter((x) => x.status !== 'SOLD');
    const left = r2(n(site.estimatedCost) - sold.reduce((a, x) => a + n(x.cost), 0));
    const total = open.reduce((a, x) => a + n(x.price), 0);
    if (!open.length || total <= 0) throw new ConflictException('No units left to take the cost');
    if (left < 0) throw new ConflictException('The units handed over have taken more than the estimate: raise the estimate');
    let given = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const [i, x] of open.entries()) {
        const c = i === open.length - 1 ? r2(left - given) : r2((left * n(x.price)) / total);
        given = r2(given + c);
        await tx.propertyUnit.update({ where: { id: x.id }, data: { cost: D(c) } });
      }
    });
    await this.audit.record('Property Site', siteId, 'ALLOCATE', null, { cost: left, units: open.length });
    return this.units(siteId);
  }

  // ------------------------------------------------------------------ sales
  private plan(input: z.infer<typeof bookSchema>, price: number): SaleLine[] {
    const lines: SaleLine[] = [];
    const booking = Math.min(input.bookingFee, price);
    if (booking > 0) lines.push({ kind: 'BOOKING', label: 'Booking fee (tanda jadi)', dueDate: input.date, amount: r2(booking) });
    const split = (total: number, count: number, kind: string, label: string, start: Date) => {
      let given = 0;
      for (let k = 0; k < count; k++) {
        const amt = k === count - 1 ? r2(total - given) : r2(Math.floor((total / count) * 100) / 100);
        given = r2(given + amt);
        if (amt > 0) lines.push({ kind, label: count > 1 ? `${label} ${k + 1}/${count}` : label, dueDate: addMonths(start, k), amount: amt });
      }
    };
    if (input.scheme === 'CASH') {
      if (price - booking > 0) lines.push({ kind: 'CASH', label: 'Full payment (tunai keras)', dueDate: input.startDate, amount: r2(price - booking) });
      return lines;
    }
    const dp = Math.max(0, r2((price * input.dpPct) / 100 - booking));
    split(dp, input.dpCount, 'DP', 'Down payment', input.startDate);
    const rest = r2(price - booking - dp);
    if (input.scheme === 'INSTALMENT') split(rest, input.instalmentCount, 'INSTALMENT', 'Instalment', addMonths(input.startDate, dp > 0 ? input.dpCount : 0));
    else if (rest > 0)
      lines.push({ kind: 'KPR', label: `Mortgage (KPR${input.kprBank ? ` ${input.kprBank}` : ''}) at the AJB`, dueDate: addMonths(input.startDate, dp > 0 ? input.dpCount : 0), amount: rest });
    return lines;
  }

  async book(input: z.infer<typeof bookSchema>) {
    RequestCtx.assert('property.sell');
    const u = RequestCtx.user();
    const unit = await this.prisma.propertyUnit.findFirst({ where: { id: input.unitId, site: { companyId: u.companyId } } });
    if (!unit) throw invalid({ unitId: 'Choose a unit' });
    if (unit.status !== 'AVAILABLE') throw new ConflictException('The unit is booked or sold');
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!customer) throw invalid({ customerId: 'Choose the buyer' });
    const price = r2(input.price ?? n(unit.price));
    if (input.scheme === 'KPR' && !input.kprBank) throw invalid({ kprBank: 'Enter the bank of the mortgage' });
    const lines = input.lines?.length ? input.lines.map((l) => ({ ...l, amount: r2(l.amount) })) : this.plan(input, price);
    const total = r2(lines.reduce((a, l) => a + l.amount, 0));
    if (Math.abs(total - price) > 0.004) throw invalid({ lines: `The schedule adds up to ${total.toLocaleString('id-ID')}, not the price ${price.toLocaleString('id-ID')}` });
    if (unit.ppnMode === 'DTP') {
      const p = await this.dtpProblems(u.companyId, { price: n(unit.price), readyToOccupy: unit.readyToOccupy }, price, input.date);
      if (p.length) throw invalid({ unitId: `No PPN DTP: ${p.join('; ')} (PMK 90/2025). Set the unit to standard PPN first.` });
    }
    const sale = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.propertyUnit.updateMany({ where: { id: unit.id, status: 'AVAILABLE' }, data: { status: 'BOOKED' } });
      if (!locked.count) throw new ConflictException('The unit was just booked');
      const s = await tx.propertySale.create({
        data: {
          companyId: u.companyId,
          number: await this.sequence.next('PROP_SALE', u.companyId, input.date, tx),
          unitId: unit.id,
          customerId: input.customerId,
          date: input.date,
          price: D(price),
          scheme: input.scheme,
          ppnMode: unit.ppnMode,
          dtpBase: D(unit.ppnMode === 'DTP' ? Math.min(price, DTP_PART) : 0),
          pphRate: unit.pphRate,
          kprBank: input.kprBank ?? null,
          notes: input.notes ?? null,
          createdById: u.id,
        },
      });
      await tx.propertySaleLine.createMany({ data: lines.map((l, i) => ({ saleId: s.id, seq: i + 1, kind: l.kind, label: l.label, dueDate: l.dueDate, amount: D(l.amount) })) });
      return s;
    });
    await this.audit.record('Property Sale', sale.id, 'CREATE', null, { number: sale.number, unit: unit.code, price });
    return this.sale(sale.id);
  }

  async sales(status?: string) {
    RequestCtx.assert('property.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.propertySale.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: [{ date: 'desc' }, { number: 'desc' }],
      take: 300,
      include: { lines: { select: { amount: true, invoiceId: true, dueDate: true } } },
    });
    const units = await this.prisma.propertyUnit.findMany({ where: { id: { in: rows.map((r) => r.unitId) } }, include: { site: { select: { code: true, name: true } } } });
    const cust = await this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } });
    const inv = await this.prisma.tradeDocument.findMany({
      where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.invoiceId)).filter(Boolean) as string[] }, status: { not: 'CANCELLED' } },
      select: { id: true, grandTotal: true, paidAmount: true },
    });
    const t = today();
    return rows.map(({ lines, ...r }) => {
      const unit = units.find((x) => x.id === r.unitId);
      const live = lines.filter((l) => l.invoiceId && inv.some((i) => i.id === l.invoiceId));
      return {
        ...this.shapeSale(r),
        unit: unit ? { id: unit.id, code: unit.code, site: unit.site.code, siteName: unit.site.name } : null,
        customer: cust.find((c) => c.id === r.customerId)?.name ?? null,
        invoiced: r2(live.reduce((a, l) => a + n(l.amount), 0)),
        paid: r2(inv.filter((i) => live.some((l) => l.invoiceId === i.id)).reduce((a, i) => a + n(i.paidAmount), 0)),
        dueNotInvoiced: r2(lines.filter((l) => !live.includes(l) && l.dueDate <= t).reduce((a, l) => a + n(l.amount), 0)),
      };
    });
  }

  private shapeSale<T extends Prisma.PropertySaleGetPayload<object>>(r: T) {
    return {
      ...r,
      date: iso(r.date),
      price: n(r.price),
      dtpBase: n(r.dtpBase),
      pphRate: n(r.pphRate),
      ppjbDate: iso(r.ppjbDate),
      ajbDate: iso(r.ajbDate),
      handoverDate: iso(r.handoverDate),
      cost: n(r.cost),
      forfeit: n(r.forfeit),
      refund: n(r.refund),
      refundDue: iso(r.refundDue),
    };
  }

  async sale(id: string) {
    RequestCtx.assert('property.read');
    const companyId = RequestCtx.companyId();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { seq: 'asc' } } } });
    if (!s) throw new NotFoundException('Sale not found');
    const unit = await this.prisma.propertyUnit.findUniqueOrThrow({ where: { id: s.unitId }, include: { site: true } });
    const customer = await this.prisma.customer.findUnique({ where: { id: s.customerId }, select: { id: true, code: true, name: true } });
    const invs = await this.prisma.tradeDocument.findMany({
      where: { id: { in: s.lines.map((l) => l.invoiceId).filter(Boolean) as string[] } },
      select: { id: true, number: true, status: true, date: true, grandTotal: true, taxTotal: true, paidAmount: true },
    });
    const rate = await this.settings.num('property.bphtbRate', companyId, 5);
    const npoptkp = await this.settings.num('property.npoptkp', companyId, 80_000_000);
    const lines = s.lines.map((l) => {
      const i = invs.find((x) => x.id === l.invoiceId && x.status !== 'CANCELLED');
      return {
        id: l.id,
        seq: l.seq,
        kind: l.kind,
        label: l.label,
        dueDate: iso(l.dueDate),
        amount: n(l.amount),
        invoice: i ? { id: i.id, number: i.number, status: i.status, grandTotal: n(i.grandTotal), taxTotal: n(i.taxTotal), paidAmount: n(i.paidAmount) } : null,
      };
    });
    const live = lines.filter((l) => l.invoice);
    return {
      ...this.shapeSale(s),
      unit: {
        id: unit.id,
        code: unit.code,
        unitType: unit.unitType,
        landArea: n(unit.landArea),
        buildingArea: n(unit.buildingArea),
        readyToOccupy: unit.readyToOccupy,
        cost: n(unit.cost),
        site: { id: unit.site.id, code: unit.site.code, name: unit.site.name, projectId: unit.site.projectId },
      },
      customer,
      lines,
      totals: {
        invoiced: r2(live.reduce((a, l) => a + l.amount, 0)),
        ppn: r2(live.reduce((a, l) => a + (l.invoice?.taxTotal ?? 0), 0)),
        billed: r2(live.reduce((a, l) => a + (l.invoice?.grandTotal ?? 0), 0)),
        paid: r2(live.reduce((a, l) => a + (l.invoice?.paidAmount ?? 0), 0)),
        notInvoiced: r2(lines.filter((l) => !l.invoice).reduce((a, l) => a + l.amount, 0)),
        bphtbEstimate: r2((Math.max(0, n(s.price) - npoptkp) * rate) / 100),
        pphFinal: r2((n(s.price) * n(s.pphRate)) / 100),
      },
    };
  }

  async updateSchedule(id: string, input: z.infer<typeof scheduleSchema>) {
    RequestCtx.assert('property.sell');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!s) throw new NotFoundException('Sale not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('The sale is handed over or cancelled');
    const invoiced: typeof s.lines = [];
    for (const l of s.lines) if (await this.liveInvoice(l.invoiceId)) invoiced.push(l);
    for (const l of invoiced) {
      const keep = input.lines.find((x) => x.id === l.id);
      if (!keep || r2(keep.amount) !== n(l.amount)) throw invalid({ lines: `${l.label} is invoiced: it stays as it is` });
    }
    const total = r2(input.lines.reduce((a, l) => a + l.amount, 0));
    if (Math.abs(total - n(s.price)) > 0.004) throw invalid({ lines: `The schedule adds up to ${total.toLocaleString('id-ID')}, not the price ${n(s.price).toLocaleString('id-ID')}` });
    await this.prisma.$transaction(async (tx) => {
      await tx.propertySaleLine.deleteMany({ where: { saleId: id, id: { notIn: invoiced.map((l) => l.id) } } });
      for (const [i, l] of input.lines.entries()) {
        if (l.id && invoiced.some((x) => x.id === l.id)) await tx.propertySaleLine.update({ where: { id: l.id }, data: { seq: i + 1, label: l.label, dueDate: l.dueDate } });
        else await tx.propertySaleLine.create({ data: { saleId: id, seq: i + 1, kind: l.kind, label: l.label, dueDate: l.dueDate, amount: D(r2(l.amount)) } });
      }
    });
    await this.audit.record('Property Sale', id, 'SCHEDULE', null, { lines: input.lines.length });
    return this.sale(id);
  }

  /** invoices the lines asked for (default: everything due by today) as buyer deposits with the PPN of the unit */
  async invoiceLines(id: string, lineIds?: string[]) {
    RequestCtx.assert('property.sell');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId }, include: { lines: { orderBy: { seq: 'asc' } } } });
    if (!s) throw new NotFoundException('Sale not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('The sale is handed over or cancelled');
    const unit = await this.prisma.propertyUnit.findUniqueOrThrow({ where: { id: s.unitId }, include: { site: true } });
    const t = today();
    const pick = [];
    for (const l of s.lines) {
      if (await this.liveInvoice(l.invoiceId)) continue;
      if (lineIds?.length ? lineIds.includes(l.id) : l.dueDate <= t) pick.push(l);
    }
    if (!pick.length) throw new ConflictException(lineIds?.length ? 'Those lines are invoiced already' : 'Nothing is due');
    const pkp = await this.settings.bool('sales.vatPayer', u.companyId, true);
    const deposit = await this.product(u.companyId, 'PROP-DEPOSIT', 'Property purchase payment (before handover)', 'PROPERTY_DEPOSIT', 'income');
    const ppn = pkp && (s.ppnMode === 'STANDARD' || s.ppnMode === 'DTP') ? await this.tax(u.companyId, 'PPN12') : null;
    const dtp = pkp && s.ppnMode === 'DTP' ? await this.tax(u.companyId, 'PPN-DTP-RUMAH') : null;
    const exempt = pkp && s.ppnMode === 'EXEMPT' ? await this.tax(u.companyId, 'PPN-EXEMPT') : null;
    const share = s.ppnMode === 'DTP' && n(s.price) > 0 ? n(s.dtpBase) / n(s.price) : 0;
    const made: string[] = [];
    for (const l of pick) {
      const what = `${l.label} - unit ${unit.site.code} ${unit.code} (${s.number})`;
      let docLines: Record<string, unknown>[];
      if (dtp) {
        const part = r2(n(l.amount) * share);
        docLines = [{ productId: deposit, description: `${what}: PPN ditanggung pemerintah`, qty: 1, unitPrice: part, taxId: dtp }];
        if (r2(n(l.amount) - part) > 0) docLines.push({ productId: deposit, description: `${what}: part above Rp2 bn`, qty: 1, unitPrice: r2(n(l.amount) - part), taxId: ppn });
      } else docLines = [{ productId: deposit, description: what, qty: 1, unitPrice: n(l.amount), taxId: ppn ?? exempt }];
      const notes = [
        `Payment for unit ${unit.site.code} ${unit.code} (${unit.site.name}), sale ${s.number}.`,
        dtp
          ? 'PPN DITANGGUNG PEMERINTAH SESUAI PMK NOMOR 90 TAHUN 2025 (faktur code 07 for the part up to Rp2 bn, 04 for the rest).'
          : s.ppnMode === 'EXEMPT'
            ? 'PPN dibebaskan (simple house, faktur code 08).'
            : '',
        `PPh final ${n(s.pphRate)}% on this payment is paid by the developer (PP 34/2016).`,
      ]
        .filter(Boolean)
        .join('\n');
      const doc = (await this.docs.create(
        'SI',
        { date: t, dueDate: l.dueDate > t ? l.dueDate : t, customerId: s.customerId, projectId: unit.site.projectId, reference: s.number, notes, lines: docLines },
        undefined,
        { skipPermission: true },
      )) as { id: string; number: string };
      try {
        await this.docs.confirm('SI', doc.id, { skipPermission: true });
      } catch (e) {
        await this.prisma.tradeDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
        throw e;
      }
      await this.prisma.propertySaleLine.update({ where: { id: l.id }, data: { invoiceId: doc.id } });
      made.push(doc.number);
    }
    await this.audit.record('Property Sale', id, 'INVOICE', null, { invoices: made });
    return { ...(await this.sale(id)), made };
  }

  async ppjb(id: string, input: z.infer<typeof deedSchema>) {
    RequestCtx.assert('property.handover');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId } });
    if (!s || s.status !== 'ACTIVE') throw new ConflictException('Only an active sale');
    await this.prisma.propertySale.update({ where: { id }, data: { ppjbNo: input.no, ppjbDate: input.date, notary: input.notary ?? s.notary, updatedById: u.id } });
    await this.audit.record('Property Sale', id, 'PPJB', null, { no: input.no });
    return this.sale(id);
  }

  /** months whose payments on this sale still have PPh final to book */
  private async pphOpen(saleId: string) {
    const lines = await this.prisma.propertySaleLine.findMany({ where: { saleId, invoiceId: { not: null } }, select: { invoiceId: true } });
    const allocs = await this.prisma.paymentAllocation.findMany({
      where: { documentId: { in: lines.map((l) => l.invoiceId!) }, payment: { status: 'CONFIRMED', deletedAt: null, direction: 'IN' } },
      include: { payment: { select: { date: true } } },
    });
    const months = [...new Set(allocs.map((a) => iso(a.payment.date)!.slice(0, 7)))];
    const open: string[] = [];
    for (const m of months) if ((await this.finalTax(m)).totals.toBook > 0) open.push(m);
    return open;
  }

  /** AJB: all of the price invoiced and the PPh final of the payments booked (PP 34/2016: the deed is signed once the PPh is validated) */
  async ajb(id: string, input: z.infer<typeof deedSchema>) {
    RequestCtx.assert('property.handover');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!s || s.status === 'CANCELLED') throw new ConflictException('The sale is cancelled');
    for (const l of s.lines) if (!(await this.liveInvoice(l.invoiceId))) throw new ConflictException(`Invoice "${l.label}" first: the whole price is due at the AJB`);
    const open = await this.pphOpen(id);
    if (open.length) throw new ConflictException(`Book and pay the PPh final of ${open.join(', ')} first: the AJB is signed only after the PPh is validated (PP 34/2016)`);
    await this.prisma.propertySale.update({ where: { id }, data: { ajbNo: input.no, ajbDate: input.date, notary: input.notary ?? s.notary, updatedById: u.id } });
    await this.audit.record('Property Sale', id, 'AJB', null, { no: input.no });
    return this.sale(id);
  }

  /** handover (BAST): the deposits become revenue and the unit's cost goes to cost of sales */
  async handover(id: string, input: { date: Date }) {
    RequestCtx.assert('property.handover');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!s) throw new NotFoundException('Sale not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('Handed over or cancelled already');
    for (const l of s.lines) if (!(await this.liveInvoice(l.invoiceId))) throw new ConflictException(`Invoice "${l.label}" first: the whole price is invoiced by the handover`);
    if (s.ppnMode === 'DTP') {
      const w = await this.dtpWindow(u.companyId);
      if (input.date < w.from || input.date > w.until) throw new ConflictException(`The PPN DTP needs the handover between ${iso(w.from)} and ${iso(w.until)} (PMK 90/2025)`);
    }
    const unit = await this.prisma.propertyUnit.findUniqueOrThrow({ where: { id: s.unitId }, include: { site: true } });
    const cost = n(unit.cost);
    await this.prisma.$transaction(async (tx) => {
      const j: PostingLine[] = [
        { key: 'PROPERTY_DEPOSIT', debit: s.price, customerId: s.customerId, description: `Deposits of ${s.number}` },
        { key: 'PROPERTY_REVENUE', credit: s.price, customerId: s.customerId, projectId: unit.site.projectId, description: `Unit ${unit.site.code} ${unit.code} handed over` },
      ];
      if (cost > 0)
        j.push(
          { key: 'PROPERTY_COGS', debit: D(cost), projectId: unit.site.projectId, description: `Cost of unit ${unit.site.code} ${unit.code}` },
          { key: 'RE_INVENTORY', credit: D(cost), projectId: unit.site.projectId, description: `Unit ${unit.site.code} ${unit.code} handed over` },
        );
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: input.date,
        description: `Handover ${s.number} unit ${unit.site.code} ${unit.code}`,
        reference: s.ajbNo ?? s.number,
        sourceType: 'PROP_HANDOVER',
        sourceId: id,
        lines: j,
      });
      await tx.propertySale.update({ where: { id }, data: { status: 'HANDED_OVER', handoverDate: input.date, cost: D(cost), updatedById: u.id } });
      await tx.propertyUnit.update({ where: { id: unit.id }, data: { status: 'SOLD' } });
    });
    await this.audit.record('Property Sale', id, 'HANDOVER', null, { date: iso(input.date), cost });
    return this.sale(id);
  }

  async undoHandover(id: string) {
    RequestCtx.assert('property.handover');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId } });
    if (!s || s.status !== 'HANDED_OVER') throw new ConflictException('Only a handed-over sale');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'PROP_HANDOVER', id);
      await tx.propertySale.update({ where: { id }, data: { status: 'ACTIVE', handoverDate: null, cost: D(0), updatedById: u.id } });
      await tx.propertyUnit.update({ where: { id: s.unitId }, data: { status: 'BOOKED' } });
    });
    await this.audit.record('Property Sale', id, 'HANDOVER_UNDO');
    return this.sale(id);
  }

  /**
   * Permen PUPR 11/2019: cancelled not through the developer's fault, the developer refunds what was paid less at most 10%
   * within 30 days; through its fault, all of it. Unpaid invoices are cancelled; paid ones leave the deposits and their
   * PPN (replace the faktur in Coretax) for the refund due.
   */
  async cancel(id: string, input: z.infer<typeof cancelSchema>) {
    RequestCtx.assert('property.handover');
    const u = RequestCtx.user();
    const s = await this.prisma.propertySale.findFirst({ where: { id, companyId: u.companyId }, include: { lines: true } });
    if (!s) throw new NotFoundException('Sale not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('Only a sale not handed over can be cancelled');
    const invs = [];
    for (const l of s.lines) {
      const i = await this.liveInvoice(l.invoiceId);
      if (!i) continue;
      if (n(i.paidAmount) > 0 && n(i.paidAmount) < n(i.grandTotal) - 0.004) throw new ConflictException(`${i.number} is part paid: settle it or record the rest first`);
      invs.push(i);
    }
    for (const i of invs.filter((x) => n(x.paidAmount) === 0)) await this.docs.cancel('SI', i.id, { skipPermission: true });
    const paid = invs.filter((x) => n(x.paidAmount) > 0);
    const paidTotal = r2(paid.reduce((a, i) => a + n(i.grandTotal), 0));
    const paidTax = r2(paid.reduce((a, i) => a + n(i.taxTotal), 0));
    const paidDpp = r2(paidTotal - paidTax);
    const forfeit = input.reason === 'BUYER' ? r2((paidTotal * input.forfeitPct) / 100) : 0;
    const refund = r2(paidTotal - forfeit);
    await this.prisma.$transaction(async (tx) => {
      if (paidTotal > 0) {
        const j: PostingLine[] = [{ key: 'PROPERTY_DEPOSIT', debit: D(paidDpp), customerId: s.customerId, description: `Deposits of cancelled sale ${s.number}` }];
        if (paidTax > 0) j.push({ key: 'TAX_OUT', debit: D(paidTax), description: `PPN of cancelled sale ${s.number} (replace / cancel the faktur)` });
        if (refund > 0) j.push({ key: 'PROPERTY_REFUND', credit: D(refund), customerId: s.customerId, description: `Refund due by ${iso(new Date(input.date.getTime() + 30 * DAY))}` });
        if (forfeit > 0) j.push({ key: 'PROPERTY_FORFEIT', credit: D(forfeit), customerId: s.customerId, description: `${input.forfeitPct}% kept, cancelled by the buyer` });
        await this.journal.post(tx, {
          companyId: u.companyId,
          date: input.date,
          description: `Cancelled property sale ${s.number}`,
          reference: s.number,
          sourceType: 'PROP_CANCEL',
          sourceId: id,
          lines: j,
        });
      }
      await tx.propertySale.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: input.reason,
          forfeit: D(forfeit),
          refund: D(refund),
          refundDue: refund > 0 ? new Date(input.date.getTime() + 30 * DAY) : null,
          cancelledAt: new Date(),
          notes: input.notes ? `${s.notes ?? ''}\nCancelled: ${input.notes}`.trim() : s.notes,
          updatedById: u.id,
        },
      });
      await tx.propertyUnit.update({ where: { id: s.unitId }, data: { status: 'AVAILABLE' } });
    });
    await this.audit.record('Property Sale', id, 'CANCEL', null, { reason: input.reason, forfeit, refund });
    return this.sale(id);
  }

  // ------------------------------------------------------------------ PPh final PHTB
  async finalTax(period: string) {
    RequestCtx.assert('property.read');
    const companyId = RequestCtx.companyId();
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const lines = await this.prisma.propertySaleLine.findMany({
      where: { invoiceId: { not: null }, sale: { companyId } },
      select: { invoiceId: true, sale: { select: { id: true, number: true, pphRate: true, unitId: true } } },
    });
    const owner = new Map(lines.map((l) => [l.invoiceId!, l.sale]));
    const payments = await this.prisma.payment.findMany({
      where: { companyId, direction: 'IN', status: 'CONFIRMED', deletedAt: null, date: { gte: from, lt: to }, allocations: { some: { documentId: { in: [...owner.keys()] } } } },
      include: { allocations: { include: { document: { select: { number: true, grandTotal: true, taxTotal: true } } } } },
    });
    const rows = [];
    for (const p of payments)
      for (const a of p.allocations) {
        const s = owner.get(a.documentId);
        if (!s) continue;
        const gt = n(a.document.grandTotal);
        const base = gt > 0 ? r2((n(a.amount) * (gt - n(a.document.taxTotal))) / gt) : 0;
        rows.push({ payment: p.number, date: iso(p.date), sale: s.number, invoice: a.document.number, allocated: n(a.amount), base, rate: n(s.pphRate), due: Math.floor((base * n(s.pphRate)) / 100) });
      }
    const booked = await this.prisma.propertyTaxPayment.findMany({ where: { companyId, period, status: 'POSTED' }, orderBy: { createdAt: 'asc' } });
    const due = r2(rows.reduce((a, r) => a + r.due, 0));
    const bookedTotal = r2(booked.reduce((a, b) => a + n(b.amount), 0));
    return {
      period,
      depositBy: iso(new Date(Date.UTC(y, m, 15))),
      rows,
      totals: { base: r2(rows.reduce((a, r) => a + r.base, 0)), due, booked: bookedTotal, toBook: r2(due - bookedTotal) },
      booked: booked.map((b) => ({ id: b.id, base: n(b.base), amount: n(b.amount), createdAt: b.createdAt })),
    };
  }

  async bookTax(period: string) {
    RequestCtx.assert('property.tax');
    const u = RequestCtx.user();
    const t = await this.finalTax(period);
    if (t.totals.toBook <= 0) throw new ConflictException('Nothing to book for this month');
    const [y, m] = period.split('-').map(Number);
    const rec = await this.prisma.$transaction(async (tx) => {
      const r = await tx.propertyTaxPayment.create({ data: { companyId: u.companyId, period, base: D(t.totals.base), amount: D(t.totals.toBook), createdById: u.id } });
      await this.journal.post(tx, {
        companyId: u.companyId,
        date: new Date(Date.UTC(y, m, 0)),
        description: `PPh final PHTB ${period}`,
        reference: period,
        sourceType: 'PROP_PPH',
        sourceId: r.id,
        lines: [
          { key: 'PROPERTY_FINAL_TAX', debit: D(t.totals.toBook), description: `PPh final PHTB ${period} (PP 34/2016)` },
          { key: 'FINAL_TAX_PAYABLE', credit: D(t.totals.toBook), description: `PPh final PHTB ${period}, pay by ${t.depositBy}` },
        ],
      });
      return r;
    });
    await this.audit.record('Property Tax', rec.id, 'CREATE', null, { period, amount: t.totals.toBook });
    return this.finalTax(period);
  }

  async cancelTax(id: string) {
    RequestCtx.assert('property.tax');
    const u = RequestCtx.user();
    const rec = await this.prisma.propertyTaxPayment.findFirst({ where: { id, companyId: u.companyId, status: 'POSTED' } });
    if (!rec) throw new NotFoundException('Not found');
    await this.prisma.$transaction(async (tx: Tx) => {
      await this.journal.voidBySource(tx, 'PROP_PPH', id);
      await tx.propertyTaxPayment.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.record('Property Tax', id, 'CANCEL');
    return this.finalTax(rec.period);
  }
}
