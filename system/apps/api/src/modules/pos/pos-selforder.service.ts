import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import QRCode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser, RequestCtx } from '../../common/context/request-context';
import { SYSTEM_ACTOR_ID } from '../billing/job-context';
import { PosBus } from './pos-bus';
import { PosService } from './pos.service';

const n = (v: unknown) => Number(v ?? 0);
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** what a guest may send from the table QR page (smaller limits than the cashier) */
export const guestOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        qty: z.coerce.number().int().min(1).max(20),
        modifiers: z.array(z.object({ optionId: z.uuid() })).max(15).default([]),
        note: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(120).nullable().optional()),
      }),
    )
    .min(1)
    .max(30),
  name: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(40).nullable().optional()),
});
export const guestQuoteSchema = guestOrderSchema.pick({ lines: true });
export const guestCallSchema = z.object({ type: z.enum(['WAITER', 'BILL']) });

/**
 * Ordering from the QR code on the table: the guest sees the outlet menu with prices, sends items to the table's bill
 * (straight to the kitchen, or first confirmed by a waiter), follows the status and can call a waiter or ask for the bill.
 * Payment stays at the cashier. No personal data is asked (an optional first name for the bill only).
 * Every request is re-checked here: secret table token, outlet open (a cashier shift is running), product, options and
 * prices from the server, small quantity limits (the controller also rate-limits per address).
 */
@Injectable()
export class PosSelfOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly pos: PosService,
    private readonly bus: PosBus,
  ) {}

  private async table(token: string) {
    if (!TOKEN.test(token ?? '')) throw new NotFoundException('This QR code is not valid. Please ask a waiter.');
    const t = await this.prisma.posTable.findFirst({ where: { qrToken: token, isActive: true, deletedAt: null } });
    const o = t ? await this.prisma.posOutlet.findFirst({ where: { id: t.outletId, isActive: true, deletedAt: null } }) : null;
    if (!t || !o || o.selfOrder === 'OFF') throw new NotFoundException('This QR code is not valid. Please ask a waiter.');
    return { t, o };
  }

  /** runs the cashier logic as the "QR guest" of the outlet's company (only what selling needs) */
  private asGuest<T>(companyId: string, fn: () => Promise<T>) {
    const outer = RequestCtx.get();
    const guest: AuthUser = { id: SYSTEM_ACTOR_ID, username: 'qr-guest', fullName: 'QR order (guest)', isSuperAdmin: false, companyId, branchId: null, branchIds: null, dataScope: 'ALL', permissions: new Set(['pos.sale.create']) };
    return RequestCtx.run({ requestId: outer?.requestId ?? 'qr', ip: outer?.ip, userAgent: outer?.userAgent, user: guest }, fn);
  }

  private async isOpen(outletId: string) {
    return (await this.prisma.posSession.count({ where: { outletId, status: 'OPEN' } })) > 0;
  }

  /** menu, taxes, and what this table has ordered so far */
  async info(token: string) {
    const { t, o } = await this.table(token);
    return this.asGuest(o.companyId, async () => {
      const company = await this.prisma.company.findUnique({ where: { id: o.companyId }, select: { name: true } });
      const products = (await this.pos.products(o.id)).map(({ stock, barcode, code, type, recipe, taxId, ...p }) => ({ ...p, soldOut: stock !== null && stock <= 0 }));
      const bill = await this.prisma.posSale.findFirst({ where: { outletId: o.id, tableId: t.id, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, include: { lines: { where: { status: 'ACTIVE' }, orderBy: { lineNo: 'asc' } }, tickets: true } });
      return {
        company: company?.name ?? '',
        outlet: { name: o.name, mode: o.mode, pricesIncludeTax: o.pricesIncludeTax, pbjtRate: n(o.pbjtRate), serviceChargePct: n(o.serviceChargePct), confirm: o.selfOrder === 'CONFIRM', vatPayer: await this.settings.bool('sales.vatPayer', o.companyId, true) },
        table: { name: t.name, callType: t.callType },
        open: await this.isOpen(o.id),
        products,
        bill: bill
          ? {
              total: n(bill.total),
              serviceCharge: n(bill.serviceCharge),
              localTax: n(bill.localTax),
              taxTotal: n(bill.taxTotal),
              discount: n(bill.discount),
              lines: bill.lines.map((l) => {
                const tk = bill.tickets.find((x) => x.id === l.ticketId);
                return { name: l.name, qty: n(l.qty), modifiers: (l.modifiers as { name: string }[]).map((m) => m.name), total: n(l.unitPrice) * n(l.qty) * (1 - n(l.discountPct) / 100), status: !l.sentAt ? (l.source === 'QR' ? 'WAITING' : 'ORDERED') : tk ? tk.status : 'SERVED' };
              }),
            }
          : null,
      };
    });
  }

  async quote(token: string, input: z.infer<typeof guestQuoteSchema>) {
    const { o } = await this.table(token);
    return this.asGuest(o.companyId, () => this.pos.quote({ outletId: o.id, lines: input.lines.map((l) => ({ ...l, discountPct: 0, course: 1 })) }));
  }

  async order(token: string, input: z.infer<typeof guestOrderSchema>) {
    const { t, o } = await this.table(token);
    if (!(await this.isOpen(o.id))) throw new ConflictException('Ordering is closed at the moment. Please ask a waiter.');
    const products = await this.prisma.product.findMany({ where: { id: { in: input.lines.map((l) => l.productId) }, companyId: o.companyId } });
    if (products.length !== new Set(input.lines.map((l) => l.productId)).size) throw new BadRequestException('An item is not on the menu any more');
    const send = o.selfOrder === 'AUTO';
    const lines = input.lines.map((l) => ({ ...l, discountPct: 0, course: 1 }));
    const result = await this.asGuest(o.companyId, async () => {
      const open = await this.prisma.posSale.findFirst({ where: { outletId: o.id, tableId: t.id, status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
      if (open) return this.pos.addLines(open.id, { lines, send }, { source: 'QR' });
      return this.pos.createOrder({ outletId: o.id, orderType: 'DINE_IN', tableId: t.id, covers: 0, label: input.name ?? null, lines, send }, { source: 'QR' });
    });
    await this.audit.record('POS Order', result.id, 'QR_ORDER', undefined, { table: t.code, items: input.lines.length, sentToKitchen: send }, undefined);
    this.bus.emit({ companyId: o.companyId, outletId: o.id, topic: 'orders', data: { kind: 'qr', table: t.name, confirm: !send } });
    return { ok: true, sentToKitchen: send };
  }

  async call(token: string, type: 'WAITER' | 'BILL') {
    const { t, o } = await this.table(token);
    if (t.callType && t.calledAt && Date.now() - t.calledAt.getTime() < 30_000) return { ok: true };
    await this.prisma.posTable.update({ where: { id: t.id }, data: { callType: type, calledAt: new Date() } });
    this.bus.emit({ companyId: o.companyId, outletId: o.id, topic: 'orders', data: { kind: 'call', table: t.name, type } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- staff: printable codes
  /** QR codes of every table of an outlet (a code is created the first time) */
  async tableCodes(outletId: string) {
    RequestCtx.assert('pos.table.read');
    const outlet = await this.pos.outlet(outletId);
    const base = (await this.settings.str('general.publicUrl', outlet.companyId, 'http://localhost:3000')).replace(/\/+$/, '');
    const tables = await this.prisma.posTable.findMany({ where: { outletId: outlet.id, deletedAt: null, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    const out = [];
    for (const t of tables) {
      let token = t.qrToken;
      if (!token) {
        token = randomBytes(24).toString('base64url');
        await this.prisma.posTable.update({ where: { id: t.id }, data: { qrToken: token } });
      }
      const url = `${base}/order/${token}`;
      out.push({ id: t.id, code: t.code, name: t.name, area: t.area, url, svg: await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }) });
    }
    return { outlet: { id: outlet.id, name: outlet.name, selfOrder: outlet.selfOrder }, base, tables: out };
  }

  /** a new code for a table: the printed one stops working (e.g. it was copied) */
  async rotate(tableId: string) {
    RequestCtx.assert('pos.table.update');
    const t = await this.prisma.posTable.findFirst({ where: { id: tableId, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!t) throw new NotFoundException('Table not found');
    await this.prisma.posTable.update({ where: { id: t.id }, data: { qrToken: randomBytes(24).toString('base64url') } });
    await this.audit.record('POS Table', t.id, 'QR_ROTATE');
    return { ok: true };
  }
}
