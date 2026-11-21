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
import { DocumentService, openOrderValue } from '../documents/document.service';
import { PaymentService } from '../payments/payment.service';
import { SchemeService } from './schemes.service';

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const localIso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optCoord = (min: number, max: number) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable().optional());
const invalid = (errors: Record<string, string>) => new BadRequestException({ message: 'Validation failed', errors });

/** ISO weekday 1 (Monday) ... 7 (Sunday) and ISO week number of a date */
export function isoWeekday(d: Date) {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - isoWeekday(t));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}
/** great-circle distance in metres */
export function metres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
export const dueOn = (stop: { days: unknown; weeks: string }, d: Date) => (stop.days as number[]).includes(isoWeekday(d)) && (stop.weeks === 'EVERY' || (stop.weeks === 'ODD') === (isoWeek(d) % 2 === 1));

export const routeSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  salesmanId: z.uuid(),
  vanWarehouseId: optUuid,
  cashAccountId: optUuid,
  isActive: z.boolean().default(true),
  notes: optText(2000),
  stops: z.array(z.object({ customerId: z.uuid(), days: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7), weeks: z.enum(['EVERY', 'ODD', 'EVEN']).default('EVERY') })).max(500),
});
export const checkInSchema = z.object({ routeId: optUuid, customerId: z.uuid(), latitude: optCoord(-90, 90), longitude: optCoord(-180, 180), notes: optText(500) });
const lineSchema = z.object({ productId: z.uuid(), qty: z.coerce.number().positive().max(1e7), unitPrice: z.coerce.number().min(0).max(1e12).optional() });
export const orderSchema = z.object({ lines: z.array(lineSchema).min(1).max(200), applySchemes: z.boolean().default(true), notes: optText(500) });
export const vanSaleSchema = z.object({ lines: z.array(lineSchema).min(1).max(200), collect: z.coerce.number().min(0).max(1e13).default(0), applySchemes: z.boolean().default(true), notes: optText(500) });
export const collectSchema = z.object({ amount: z.coerce.number().positive().max(1e13), notes: optText(500) });
export const noOrderSchema = z.object({ reason: z.string().trim().min(1).max(200), closed: z.boolean().default(false) });
export const settleSchema = z.object({ routeId: z.uuid(), date: z.coerce.date(), countedCash: z.coerce.number().min(0).max(1e13), notes: optText(1000) });

/**
 * Distribution: salesman routes with their outlets by weekday (journey plan), visits with GPS check-in, orders taken
 * at the outlet, van (canvas) sales delivered and invoiced on the spot, cash collected against the oldest invoices,
 * the van's end-of-day settlement, and the credit position of customers (the credit check itself runs in the documents).
 */
@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly journal: JournalService,
    private readonly docs: DocumentService,
    private readonly payments: PaymentService,
    private readonly schemes: SchemeService,
  ) {}

  // ------------------------------------------------------------------ routes
  async routes() {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.salesRoute.findMany({ where: { companyId }, include: { _count: { select: { stops: true } } }, orderBy: { code: 'asc' } });
    const [users, whs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.salesmanId) } }, select: { id: true, fullName: true } }),
      this.prisma.warehouse.findMany({ where: { id: { in: rows.map((r) => r.vanWarehouseId!).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    return rows.map((r) => ({ ...r, stopCount: r._count.stops, salesman: users.find((u) => u.id === r.salesmanId)?.fullName ?? null, vanWarehouse: whs.find((w) => w.id === r.vanWarehouseId)?.name ?? null }));
  }

  async route(id: string) {
    RequestCtx.assert('distribution.read');
    const r = await this.prisma.salesRoute.findFirst({ where: { id, companyId: RequestCtx.companyId() }, include: { stops: { orderBy: { seq: 'asc' } } } });
    if (!r) throw new NotFoundException('Route not found');
    const [customers, salesman, wh, cash] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: r.stops.map((s) => s.customerId) } }, select: { id: true, code: true, name: true, address: true, city: true, channel: true } }),
      this.prisma.user.findUnique({ where: { id: r.salesmanId }, select: { id: true, fullName: true } }),
      r.vanWarehouseId ? this.prisma.warehouse.findUnique({ where: { id: r.vanWarehouseId }, select: { id: true, name: true } }) : null,
      r.cashAccountId ? this.prisma.bankAccount.findUnique({ where: { id: r.cashAccountId }, select: { id: true, name: true } }) : null,
    ]);
    return { ...r, salesman, vanWarehouse: wh, cashAccount: cash, stops: r.stops.map((s) => ({ ...s, customer: customers.find((c) => c.id === s.customerId) ?? null })) };
  }

  async saveRoute(id: string | null, input: z.infer<typeof routeSchema>) {
    RequestCtx.assert('distribution.route.manage');
    const u = RequestCtx.user();
    if (await this.prisma.salesRoute.findFirst({ where: { companyId: u.companyId, code: input.code, id: { not: id ?? undefined } } })) throw invalid({ code: 'Code already used' });
    if (!(await this.prisma.user.findFirst({ where: { id: input.salesmanId } }))) throw invalid({ salesmanId: 'User not found' });
    if (input.vanWarehouseId && !(await this.prisma.warehouse.findFirst({ where: { id: input.vanWarehouseId, companyId: u.companyId } }))) throw invalid({ vanWarehouseId: 'Warehouse not found' });
    if (input.cashAccountId && !(await this.prisma.bankAccount.findFirst({ where: { id: input.cashAccountId, companyId: u.companyId, deletedAt: null } }))) throw invalid({ cashAccountId: 'Cash / bank account not found' });
    const ids = input.stops.map((s) => s.customerId);
    if (new Set(ids).size !== ids.length) throw invalid({ stops: 'Each outlet once on a route' });
    if ((await this.prisma.customer.count({ where: { id: { in: ids }, companyId: u.companyId, deletedAt: null } })) !== ids.length) throw invalid({ stops: 'Unknown outlet' });
    const { stops, ...data } = input;
    const r = await this.prisma.$transaction(async (tx) => {
      const saved = id ? await tx.salesRoute.update({ where: { id, companyId: u.companyId }, data }) : await tx.salesRoute.create({ data: { ...data, companyId: u.companyId, branchId: u.branchId ?? null } });
      await tx.routeStop.deleteMany({ where: { routeId: saved.id } });
      await tx.routeStop.createMany({ data: stops.map((s, i) => ({ routeId: saved.id, customerId: s.customerId, seq: i + 1, days: [...new Set(s.days)].sort(), weeks: s.weeks })) });
      return saved;
    });
    await this.audit.record('Sales Route', r.id, id ? 'UPDATE' : 'CREATE', null, { code: r.code, stops: stops.length });
    return this.route(r.id);
  }

  // ------------------------------------------------------------------ credit position
  /** open receivables, open orders, overdue and what is left of the limit, for some customers */
  async creditOf(customerIds: string[]) {
    const companyId = RequestCtx.companyId();
    const today = new Date(localIso());
    const [customers, invs, sos] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, creditLimit: true, creditHold: true } }),
      this.prisma.tradeDocument.findMany({ where: { companyId, customerId: { in: customerIds }, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null }, select: { customerId: true, grandTotal: true, paidAmount: true, exchangeRate: true, dueDate: true, date: true } }),
      this.prisma.tradeDocument.findMany({ where: { companyId, customerId: { in: customerIds }, docType: 'SO', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null }, select: { customerId: true, exchangeRate: true, lines: { select: { qty: true, processedQty: true, lineTotal: true } } } }),
    ]);
    const out = new Map<string, { limit: number; hold: boolean; ar: number; orders: number; overdue: number; oldestDays: number; available: number | null }>();
    for (const c of customers) {
      const mine = invs.filter((x) => x.customerId === c.id);
      const ar = mine.reduce((a, x) => a + (n(x.grandTotal) - n(x.paidAmount)) * (n(x.exchangeRate) || 1), 0);
      const late = mine.filter((x) => (x.dueDate ?? x.date) < today && n(x.grandTotal) > n(x.paidAmount));
      const overdue = late.reduce((a, x) => a + (n(x.grandTotal) - n(x.paidAmount)) * (n(x.exchangeRate) || 1), 0);
      const oldestDays = late.reduce((a, x) => Math.max(a, Math.floor((today.getTime() - (x.dueDate ?? x.date).getTime()) / 86_400_000)), 0);
      const orders = sos.filter((x) => x.customerId === c.id).reduce((a, x) => a + Number(openOrderValue(x.lines)) * (n(x.exchangeRate) || 1), 0);
      const limit = n(c.creditLimit);
      out.set(c.id, { limit, hold: c.creditHold, ar: r2(ar), orders: r2(orders), overdue: r2(overdue), oldestDays, available: limit > 0 ? r2(limit - ar - orders) : null });
    }
    return out;
  }

  /** customers with a limit, a hold or money overdue: the credit controller's list */
  async credit() {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const withOpen = await this.prisma.tradeDocument.findMany({ where: { companyId, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null }, select: { customerId: true }, distinct: ['customerId'] });
    const flagged = await this.prisma.customer.findMany({ where: { companyId, deletedAt: null, OR: [{ creditLimit: { gt: 0 } }, { creditHold: true }, { id: { in: withOpen.map((x) => x.customerId!).filter(Boolean) } }] }, select: { id: true, code: true, name: true, channel: true }, take: 1000 });
    const cr = await this.creditOf(flagged.map((c) => c.id));
    const overdueDays = await this.settings.num('sales.creditOverdueDays', companyId, 0);
    return {
      overdueDays,
      rows: flagged
        .map((c) => {
          const x = cr.get(c.id)!;
          const blocked = x.hold || (overdueDays > 0 && x.oldestDays > overdueDays) || (x.limit > 0 && (x.available ?? 0) < 0);
          return { ...c, ...x, blocked };
        })
        .sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.overdue - a.overdue || b.ar - a.ar),
    };
  }

  async setHold(customerId: string, hold: boolean) {
    RequestCtx.assert('sales.credit.override');
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, companyId: RequestCtx.companyId() } });
    if (!c) throw new NotFoundException('Customer not found');
    await this.prisma.customer.update({ where: { id: customerId }, data: { creditHold: hold } });
    await this.audit.record('Customer', customerId, hold ? 'CREDIT_HOLD' : 'CREDIT_RELEASE', { creditHold: c.creditHold }, { creditHold: hold });
    return { ok: true };
  }

  // ------------------------------------------------------------------ journey plan and visits
  private async myRoutes(routeId?: string) {
    const u = RequestCtx.user();
    const where: Prisma.SalesRouteWhereInput = { companyId: u.companyId, isActive: true, ...(routeId ? { id: routeId } : RequestCtx.can('distribution.route.manage') ? {} : { salesmanId: u.id }) };
    return this.prisma.salesRoute.findMany({ where, include: { stops: { orderBy: { seq: 'asc' } } }, orderBy: { code: 'asc' } });
  }

  /** outlets to visit on the date (by weekday and week), what happened at each, their credit position */
  async journey(dateIso?: string, routeId?: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const date = new Date(dateIso ?? localIso());
    const routes = await this.myRoutes(routeId);
    const stops = routes.flatMap((r) => r.stops.filter((s) => dueOn(s, date)).map((s) => ({ route: r, stop: s })));
    const ids = [...new Set(stops.map((s) => s.stop.customerId))];
    const [customers, visits, credit] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, address: true, city: true, phone: true, channel: true, latitude: true, longitude: true } }),
      this.prisma.salesVisit.findMany({ where: { companyId, date, customerId: { in: ids } }, orderBy: { checkInAt: 'asc' } }),
      this.creditOf(ids),
    ]);
    const planned = stops.map(({ route, stop }) => {
      const c = customers.find((x) => x.id === stop.customerId)!;
      const v = visits.filter((x) => x.customerId === stop.customerId);
      return { routeId: route.id, routeCode: route.code, seq: stop.seq, customer: { ...c, latitude: c.latitude === null ? null : n(c.latitude), longitude: c.longitude === null ? null : n(c.longitude) }, credit: credit.get(stop.customerId), visits: v.map((x) => ({ id: x.id, outcome: x.outcome, checkInAt: x.checkInAt, sales: n(x.sales), collected: n(x.collected), distanceM: x.distanceM, reason: x.reason })) };
    });
    const extra = await this.prisma.salesVisit.findMany({ where: { companyId, date, userId: RequestCtx.user().id, customerId: { notIn: ids } } });
    return {
      date: iso(date),
      routes: routes.map((r) => ({ id: r.id, code: r.code, name: r.name, vanWarehouseId: r.vanWarehouseId, cashAccountId: r.cashAccountId })),
      planned,
      unplanned: extra.length,
      done: planned.filter((p) => p.visits.some((v) => v.outcome !== 'OPEN')).length,
      productive: planned.filter((p) => p.visits.some((v) => v.outcome === 'ORDER' || v.outcome === 'VAN_SALE')).length,
    };
  }

  async checkIn(input: z.infer<typeof checkInSchema>) {
    RequestCtx.assert('distribution.visit');
    const u = RequestCtx.user();
    const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, companyId: u.companyId, deletedAt: null } });
    if (!c) throw invalid({ customerId: 'Outlet not found' });
    if (input.routeId && !(await this.prisma.salesRoute.findFirst({ where: { id: input.routeId, companyId: u.companyId } }))) throw invalid({ routeId: 'Route not found' });
    const dist = input.latitude !== null && input.latitude !== undefined && input.longitude !== null && input.longitude !== undefined && c.latitude !== null && c.longitude !== null ? metres(input.latitude, input.longitude, n(c.latitude), n(c.longitude)) : null;
    const v = await this.prisma.salesVisit.create({
      data: { companyId: u.companyId, routeId: input.routeId ?? null, customerId: c.id, userId: u.id, date: new Date(localIso()), latitude: input.latitude === null || input.latitude === undefined ? null : D(input.latitude), longitude: input.longitude === null || input.longitude === undefined ? null : D(input.longitude), distanceM: dist, notes: input.notes ?? null },
    });
    return this.visit(v.id);
  }

  async visit(id: string) {
    RequestCtx.assert('distribution.read');
    const v = await this.prisma.salesVisit.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!v) throw new NotFoundException('Visit not found');
    const radius = await this.settings.num('distribution.visitRadiusM', v.companyId, 200);
    const [customer, docs, credit, route] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: v.customerId }, select: { id: true, code: true, name: true, address: true, phone: true, priceListId: true } }),
      this.prisma.tradeDocument.findMany({ where: { id: { in: [v.orderId, v.invoiceId, v.deliveryId].filter((x): x is string => !!x) } }, select: { id: true, docType: true, number: true, status: true, grandTotal: true } }),
      this.creditOf([v.customerId]),
      v.routeId ? this.prisma.salesRoute.findUnique({ where: { id: v.routeId }, select: { id: true, code: true, vanWarehouseId: true, cashAccountId: true } }) : null,
    ]);
    return { ...v, latitude: v.latitude === null ? null : n(v.latitude), longitude: v.longitude === null ? null : n(v.longitude), sales: n(v.sales), collected: n(v.collected), farAway: v.distanceM !== null && v.distanceM > radius, radius, customer, docs: docs.map((d) => ({ ...d, grandTotal: n(d.grandTotal) })), credit: credit.get(v.customerId), route };
  }

  private async openVisit(id: string) {
    const v = await this.prisma.salesVisit.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!v) throw new NotFoundException('Visit not found');
    if (v.userId !== RequestCtx.user().id && !RequestCtx.can('distribution.route.manage')) throw new ConflictException('Another salesman’s visit');
    if (v.checkOutAt) throw new ConflictException('The visit is closed');
    return v;
  }

  /**
   * lines with the schemes applied: the best discount per line; bonus goods either as extra lines at a 100% discount
   * (bonus mode DISCOUNT) or as free supplies apart (FREE_SUPPLY, the default)
   */
  private async priced(customerId: string, lines: { productId: string; qty: number; unitPrice?: number }[], apply: boolean) {
    const empty = { lines: lines.map((l) => ({ ...l, discountPct: undefined as number | undefined })), applied: lines.map((l) => ({ productId: l.productId, schemeId: null as string | null })), schemes: new Map(), gifts: [] as { schemeId: string; productId: string; qty: number }[] };
    if (!apply) return empty;
    const ev = await this.schemes.evaluate(customerId, new Date(localIso()), lines);
    const mode = await this.schemes.bonusMode(RequestCtx.companyId());
    const out = ev.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct }));
    const applied = ev.lines.map((l) => ({ productId: l.productId, schemeId: l.schemeId }));
    const gifts: { schemeId: string; productId: string; qty: number }[] = [];
    for (const b of ev.bonuses) {
      if (mode === 'DISCOUNT') {
        out.push({ productId: b.productId, qty: b.qty, unitPrice: undefined, discountPct: 100 });
        applied.push({ productId: b.productId, schemeId: b.schemeId });
      } else gifts.push({ schemeId: b.schemeId, productId: b.productId, qty: b.qty });
    }
    return { lines: out, applied, schemes: ev.schemes, gifts };
  }

  /** order taken at the outlet: a sales order, confirmed when the credit check allows (else it stays a draft) */
  async order(id: string, input: z.infer<typeof orderSchema>) {
    RequestCtx.assert('distribution.visit');
    const v = await this.openVisit(id);
    const plan = await this.priced(v.customerId, input.lines, input.applySchemes !== false);
    const so = await this.docs.create('SO', { date: localIso(), customerId: v.customerId, reference: `Visit ${iso(v.date)}`, notes: input.notes ?? undefined, lines: plan.lines }, undefined, { skipPermission: true });
    let warning: string | null = null;
    try {
      await this.docs.confirm('SO', so.id, { skipPermission: true });
    } catch (e) {
      warning = `Order ${so.number} saved as a draft: ${(e as Error).message}`;
    }
    const doc = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: so.id } });
    await this.schemes.recordDiscounts(so.id, plan.applied, plan.schemes);
    // bonus goods as a free supply: delivered later with the order
    for (const b of plan.gifts) await this.schemes.createGift(this.prisma, b, { id: so.id, customerId: v.customerId, date: doc.date });
    await this.prisma.salesVisit.update({ where: { id }, data: { outcome: 'ORDER', orderId: so.id, sales: { increment: doc.grandTotal } } });
    await this.audit.record('Sales Visit', id, 'ORDER', null, { order: so.number, warning });
    return { ...(await this.visit(id)), warning };
  }

  /** van (canvas) sale: delivered from the van and invoiced at once (credit check first), cash collected on the spot */
  async vanSale(id: string, input: z.infer<typeof vanSaleSchema>) {
    RequestCtx.assert('distribution.visit');
    const v = await this.openVisit(id);
    const route = v.routeId ? await this.prisma.salesRoute.findUnique({ where: { id: v.routeId } }) : null;
    if (!route?.vanWarehouseId) throw new ConflictException('Van sales need a route with a van warehouse');
    if (input.collect > 0 && !route.cashAccountId) throw new ConflictException('Set the cash account of the route to collect cash');
    const plan = await this.priced(v.customerId, input.lines, input.applySchemes !== false);
    const dO = await this.docs.create('DO', { date: localIso(), customerId: v.customerId, warehouseId: route.vanWarehouseId, reference: `Van ${route.code}`, lines: plan.lines.map((l) => ({ productId: l.productId, qty: l.qty })) }, undefined, { skipPermission: true });
    await this.docs.confirm('DO', dO.id, { skipPermission: true }).catch(async (e) => {
      await this.prisma.tradeDocument.update({ where: { id: dO.id }, data: { deletedAt: new Date() } });
      throw e;
    });
    const doLines = await this.prisma.tradeDocumentLine.findMany({ where: { documentId: dO.id }, orderBy: { lineNo: 'asc' } });
    let si: { id: string; number: string };
    try {
      si = await this.docs.create('SI', { date: localIso(), customerId: v.customerId, reference: dO.number, notes: input.notes ?? undefined, lines: plan.lines.map((l, i) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, sourceLineId: doLines[i]?.id })) }, dO.id, { skipPermission: true });
      await this.docs.confirm('SI', si.id, { skipPermission: true });
    } catch (e) {
      // not sold after all: the draft invoice is dropped and the goods go back on the van
      await this.prisma.tradeDocument.updateMany({ where: { sourceId: dO.id, docType: 'SI', status: 'DRAFT', deletedAt: null }, data: { deletedAt: new Date() } });
      await this.docs.cancel('DO', dO.id, { skipPermission: true });
      throw e;
    }
    const inv = await this.prisma.tradeDocument.findUniqueOrThrow({ where: { id: si.id } });
    await this.schemes.recordDiscounts(si.id, plan.applied, plan.schemes);
    // bonus goods as a free supply: handed over from the van now, apart from the sale
    for (const b of plan.gifts) {
      const g = await this.schemes.createGift(this.prisma, b, { id: si.id, customerId: v.customerId, date: inv.date });
      await this.schemes.deliverGift(g.id, route.vanWarehouseId);
    }
    let paymentId: string | null = null;
    const collect = Math.min(input.collect, n(inv.grandTotal));
    if (collect > 0) {
      const pay = await this.payments.create('IN', { date: localIso(), partnerId: v.customerId, bankAccountId: route.cashAccountId!, amount: collect, reference: `Van ${route.code} ${inv.number}`, allocations: [{ documentId: inv.id, amount: collect }] });
      paymentId = (pay as { id: string }).id;
    }
    await this.prisma.salesVisit.update({ where: { id }, data: { outcome: 'VAN_SALE', deliveryId: dO.id, invoiceId: si.id, paymentId: paymentId ?? v.paymentId, sales: { increment: inv.grandTotal }, collected: { increment: D(collect) } } });
    await this.audit.record('Sales Visit', id, 'VAN_SALE', null, { delivery: dO.number, invoice: si.number, collected: collect });
    return this.visit(id);
  }

  /** cash collected: settles the outlet's oldest open invoices first */
  async collect(id: string, input: z.infer<typeof collectSchema>) {
    RequestCtx.assert('distribution.visit');
    const v = await this.openVisit(id);
    const route = v.routeId ? await this.prisma.salesRoute.findUnique({ where: { id: v.routeId } }) : null;
    if (!route?.cashAccountId) throw new ConflictException('Collections need a route with a cash account');
    const open = await this.prisma.tradeDocument.findMany({ where: { companyId: v.companyId, customerId: v.customerId, docType: 'SI', status: { in: ['CONFIRMED', 'PARTIAL'] }, deletedAt: null }, orderBy: [{ dueDate: 'asc' }, { date: 'asc' }] });
    let left = input.amount;
    const allocations: { documentId: string; amount: number }[] = [];
    for (const d of open) {
      if (left <= 0) break;
      const bal = r2(n(d.grandTotal) - n(d.paidAmount));
      if (bal <= 0) continue;
      const a = Math.min(bal, left);
      allocations.push({ documentId: d.id, amount: r2(a) });
      left = r2(left - a);
    }
    if (!allocations.length) throw new ConflictException('The outlet has no open invoices');
    if (left > 0) throw invalid({ amount: `More than the open invoices (${r2(input.amount - left)})` });
    const pay = await this.payments.create('IN', { date: localIso(), partnerId: v.customerId, bankAccountId: route.cashAccountId, amount: input.amount, reference: `Collection ${route.code}`, notes: input.notes ?? undefined, allocations });
    await this.prisma.salesVisit.update({ where: { id }, data: { outcome: v.outcome === 'OPEN' || v.outcome === 'NO_ORDER' ? 'COLLECTION' : v.outcome, paymentId: (pay as { id: string }).id, collected: { increment: D(input.amount) } } });
    await this.audit.record('Sales Visit', id, 'COLLECT', null, { amount: input.amount, invoices: allocations.length });
    return this.visit(id);
  }

  async noOrder(id: string, input: z.infer<typeof noOrderSchema>) {
    RequestCtx.assert('distribution.visit');
    const v = await this.openVisit(id);
    await this.prisma.salesVisit.update({ where: { id }, data: { outcome: v.outcome === 'OPEN' ? (input.closed ? 'CLOSED' : 'NO_ORDER') : v.outcome, reason: input.reason, checkOutAt: new Date() } });
    return this.visit(id);
  }

  async checkOut(id: string) {
    RequestCtx.assert('distribution.visit');
    const v = await this.openVisit(id);
    if (v.outcome === 'OPEN') throw new ConflictException('Record what came of the visit (order, sale, collection or no order) first');
    await this.prisma.salesVisit.update({ where: { id }, data: { checkOutAt: new Date() } });
    return this.visit(id);
  }

  /** calls and productivity: planned calls, visited, productive (order / van sale), strike rate, drop size, collections */
  async visits(from: string, to: string, routeId?: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const f = new Date(from);
    const t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t || t.getTime() - f.getTime() > 92 * 86_400_000) throw new BadRequestException('Choose a period of up to three months');
    const routes = await this.prisma.salesRoute.findMany({ where: { companyId, ...(routeId ? { id: routeId } : {}) }, include: { stops: true } });
    const visits = await this.prisma.salesVisit.findMany({ where: { companyId, date: { gte: f, lte: t }, ...(routeId ? { routeId } : {}) }, orderBy: { checkInAt: 'desc' }, take: 2000 });
    const [users, customers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set([...visits.map((v) => v.userId), ...routes.map((r) => r.salesmanId)])] } }, select: { id: true, fullName: true } }),
      this.prisma.customer.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.customerId))] } }, select: { id: true, code: true, name: true } }),
    ]);
    const summary = routes.map((r) => {
      let planned = 0;
      for (let d = new Date(f); d <= t; d = new Date(d.getTime() + 86_400_000)) planned += r.stops.filter((s) => dueOn(s, d)).length;
      const mine = visits.filter((v) => v.routeId === r.id);
      const productive = mine.filter((v) => v.outcome === 'ORDER' || v.outcome === 'VAN_SALE');
      const sales = productive.reduce((a, v) => a + n(v.sales), 0);
      return { routeId: r.id, code: r.code, salesman: users.find((u) => u.id === r.salesmanId)?.fullName ?? null, planned, visited: mine.length, productive: productive.length, callRate: planned ? Math.round((mine.length / planned) * 1000) / 10 : null, strikeRate: mine.length ? Math.round((productive.length / mine.length) * 1000) / 10 : null, sales: r2(sales), dropSize: productive.length ? r2(sales / productive.length) : 0, collected: r2(mine.reduce((a, v) => a + n(v.collected), 0)), farCheckIns: mine.filter((v) => v.distanceM !== null && v.distanceM > 200).length };
    });
    return {
      summary,
      rows: visits.slice(0, 500).map((v) => ({ id: v.id, date: iso(v.date), checkInAt: v.checkInAt, outcome: v.outcome, reason: v.reason, sales: n(v.sales), collected: n(v.collected), distanceM: v.distanceM, salesman: users.find((u) => u.id === v.userId)?.fullName ?? null, customer: customers.find((c) => c.id === v.customerId) ?? null, routeCode: routes.find((r) => r.id === v.routeId)?.code ?? null })),
    };
  }

  // ------------------------------------------------------------------ van settlement
  /** the van's day: sales, cash taken (van sales and collections into the route's cash account), the stock left on it */
  async settlementPreview(routeId: string, dateIso: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const route = await this.prisma.salesRoute.findFirst({ where: { id: routeId, companyId } });
    if (!route) throw new NotFoundException('Route not found');
    const date = new Date(dateIso);
    const visits = await this.prisma.salesVisit.findMany({ where: { companyId, routeId, date } });
    const vanSales = visits.filter((v) => v.outcome === 'VAN_SALE');
    // every receipt into the van's cash box that day (van sales and collections)
    const pays = route.cashAccountId ? await this.prisma.payment.findMany({ where: { companyId, bankAccountId: route.cashAccountId, direction: 'IN', date, status: { not: 'CANCELLED' }, deletedAt: null }, select: { id: true, amount: true } }) : [];
    const expected = r2(pays.reduce((a, p) => a + n(p.amount), 0));
    const stock = route.vanWarehouseId ? await this.prisma.stockBalance.findMany({ where: { warehouseId: route.vanWarehouseId, qty: { not: 0 } }, select: { productId: true, qty: true } }) : [];
    const products = await this.prisma.product.findMany({ where: { id: { in: stock.map((s) => s.productId) } }, select: { id: true, code: true, name: true } });
    const done = await this.prisma.vanSettlement.findFirst({ where: { companyId, routeId, date, status: 'POSTED' }, select: { id: true, number: true } });
    return {
      route: { id: route.id, code: route.code, name: route.name },
      date: iso(date),
      visits: visits.length,
      productive: visits.filter((v) => v.outcome === 'ORDER' || v.outcome === 'VAN_SALE').length,
      sales: r2(vanSales.reduce((a, v) => a + n(v.sales), 0)),
      orders: r2(visits.filter((v) => v.outcome === 'ORDER').reduce((a, v) => a + n(v.sales), 0)),
      expectedCash: expected,
      stock: stock.map((s) => ({ productId: s.productId, qty: n(s.qty), code: products.find((p) => p.id === s.productId)?.code, name: products.find((p) => p.id === s.productId)?.name })),
      settled: done,
    };
  }

  /** close the van's day: counted cash against expected, the difference to Cash Over / Short */
  async settle(input: z.infer<typeof settleSchema>) {
    RequestCtx.assert('distribution.settle');
    const u = RequestCtx.user();
    const p = await this.settlementPreview(input.routeId, iso(input.date)!);
    if (p.settled) throw new ConflictException(`Already settled on ${p.settled.number}`);
    const route = await this.prisma.salesRoute.findUniqueOrThrow({ where: { id: input.routeId } });
    const diff = r2(input.countedCash - p.expectedCash);
    if (diff !== 0 && !route.cashAccountId) throw new ConflictException('The route has no cash account to post the difference to');
    const s = await this.prisma.$transaction(async (tx) => {
      const number = await this.sequence.next('VAN_SETTLE', u.companyId, input.date, tx);
      const rec = await tx.vanSettlement.create({
        data: { companyId: u.companyId, number, routeId: route.id, date: input.date, sales: D(p.sales), cashSales: D(0), collections: D(p.expectedCash), expectedCash: D(p.expectedCash), countedCash: D(input.countedCash), difference: D(diff), stock: p.stock.map((x) => ({ productId: x.productId, qty: x.qty })) as Prisma.InputJsonValue, visits: p.visits, productive: p.productive, notes: input.notes ?? null, createdById: u.id },
      });
      if (diff !== 0) {
        const bank = await tx.bankAccount.findUniqueOrThrow({ where: { id: route.cashAccountId! } });
        const amt = D(Math.abs(diff));
        const lines = diff < 0 ? [{ key: 'CASH_OVER_SHORT', debit: amt, description: `Van ${route.code} short` }, { accountId: bank.accountId!, credit: amt, description: `Cash short ${iso(input.date)}` }] : [{ accountId: bank.accountId!, debit: amt, description: `Cash over ${iso(input.date)}` }, { key: 'CASH_OVER_SHORT', credit: amt, description: `Van ${route.code} over` }];
        await this.journal.post(tx, { companyId: u.companyId, date: input.date, description: `${number}: van ${route.code} cash ${diff < 0 ? 'short' : 'over'}`, reference: number, sourceType: 'VANSET', sourceId: rec.id, lines });
      }
      return rec;
    });
    await this.audit.record('Van Settlement', s.id, 'POST', null, { expected: p.expectedCash, counted: input.countedCash, difference: diff });
    return { ...s, expectedCash: n(s.expectedCash), countedCash: n(s.countedCash), difference: n(s.difference), sales: n(s.sales) };
  }

  async settlements(routeId?: string) {
    RequestCtx.assert('distribution.read');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.vanSettlement.findMany({ where: { companyId, ...(routeId ? { routeId } : {}) }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 200 });
    const routes = await this.prisma.salesRoute.findMany({ where: { id: { in: rows.map((r) => r.routeId) } }, select: { id: true, code: true } });
    return rows.map((r) => ({ ...r, date: iso(r.date), sales: n(r.sales), expectedCash: n(r.expectedCash), countedCash: n(r.countedCash), difference: n(r.difference), routeCode: routes.find((x) => x.id === r.routeId)?.code ?? null }));
  }

  async voidSettlement(id: string) {
    RequestCtx.assert('distribution.settle');
    const s = await this.prisma.vanSettlement.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Settlement not found');
    if (s.status !== 'POSTED') throw new ConflictException('Already void');
    await this.prisma.$transaction(async (tx) => {
      await this.journal.voidBySource(tx, 'VANSET', id);
      await tx.vanSettlement.update({ where: { id }, data: { status: 'VOID' } });
    });
    await this.audit.record('Van Settlement', id, 'VOID');
    return { ok: true };
  }
}
