import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestCtx } from '../../common/context/request-context';
import { PosBus } from './pos-bus';
import { PosService } from './pos.service';

const UUID = /^[0-9a-f-]{36}$/i;
const n = (v: unknown) => Number(v ?? 0);

/** allowed ticket moves: bump forward, recall back */
const NEXT: Record<string, string[]> = {
  NEW: ['PREPARING', 'READY'],
  PREPARING: ['READY', 'NEW'],
  READY: ['SERVED', 'PREPARING'],
  SERVED: ['READY'],
};

/** Kitchen display (KDS), expo and the order-ready queue board of an outlet */
@Injectable()
export class PosKitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pos: PosService,
    private readonly bus: PosBus,
  ) {}

  private assertView() {
    if (!RequestCtx.can('pos.kitchen.view') && !RequestCtx.can('pos.sale.create')) RequestCtx.assert('pos.kitchen.view');
  }

  /** active tickets of a station (or all stations = expo), oldest first; served tickets of the last 10 minutes for recall */
  async tickets(outletId: string, station?: string) {
    this.assertView();
    const outlet = await this.pos.outlet(outletId);
    const recent = new Date(Date.now() - 10 * 60_000);
    const rows = await this.prisma.posKitchenTicket.findMany({
      where: {
        outletId: outlet.id,
        ...(station && station !== 'ALL' ? { station } : {}),
        OR: [{ status: { in: ['NEW', 'PREPARING', 'READY'] } }, { status: 'SERVED', servedAt: { gte: recent } }, { status: 'HELD' }],
      },
      orderBy: [{ firedAt: 'asc' }, { createdAt: 'asc' }],
      take: 300,
      include: {
        lines: { orderBy: { lineNo: 'asc' }, select: { id: true, name: true, qty: true, modifiers: true, note: true, status: true, course: true } },
        sale: { select: { id: true, orderType: true, queueNo: true, covers: true, label: true, status: true } },
      },
    });
    return {
      outlet: { id: outlet.id, name: outlet.name, warn: outlet.kdsWarnMinutes, late: outlet.kdsLateMinutes },
      tickets: rows.map((t) => ({
        id: t.id,
        saleId: t.saleId,
        label: t.label,
        station: t.station,
        course: t.course,
        round: t.round,
        status: t.status,
        orderType: t.sale.orderType,
        queueNo: t.sale.queueNo,
        covers: t.sale.covers,
        firedAt: t.firedAt,
        createdAt: t.createdAt,
        readyAt: t.readyAt,
        lines: t.lines.map((l) => ({ ...l, qty: n(l.qty), modifiers: (l.modifiers as { name: string }[]).map((m) => m.name) })),
      })),
    };
  }

  /** bump / recall a ticket */
  async setStatus(id: string, status: string) {
    this.assertView();
    if (!UUID.test(id)) throw new NotFoundException('Ticket not found');
    const t = await this.prisma.posKitchenTicket.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!t) throw new NotFoundException('Ticket not found');
    if (t.status === status) return t;
    if (!(NEXT[t.status] ?? []).includes(status)) throw new ConflictException(`A ${t.status.toLowerCase()} ticket cannot become ${status.toLowerCase()}`);
    const now = new Date();
    const r = await this.prisma.$transaction(async (tx) => {
      const x = await tx.posKitchenTicket.update({
        where: { id },
        data: { status, ...(status === 'PREPARING' && !t.startedAt ? { startedAt: now } : {}), ...(status === 'READY' ? { readyAt: now } : {}), ...(status === 'SERVED' ? { servedAt: now } : {}) },
      });
      await this.pos.refreshKitchenStatus(tx, t.saleId);
      return x;
    });
    this.bus.changed(t.companyId, t.outletId, ['kitchen', 'queue', 'orders']);
    return r;
  }

  /** order-ready board: queue numbers being prepared and ready for pick-up (today) */
  async queue(outletId: string) {
    this.assertView();
    const outlet = await this.pos.outlet(outletId);
    const since = new Date(Date.now() - 12 * 3600_000);
    const rows = await this.prisma.posSale.findMany({
      where: { outletId: outlet.id, queueNo: { not: null }, kitchenStatus: { in: ['PREPARING', 'READY'] }, status: { in: ['OPEN', 'PAID'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, queueNo: true, kitchenStatus: true, readyAt: true, label: true },
    });
    return {
      outlet: { id: outlet.id, name: outlet.name, announcement: outlet.readyAnnouncement },
      preparing: rows.filter((r) => r.kitchenStatus === 'PREPARING'),
      ready: rows.filter((r) => r.kitchenStatus === 'READY').sort((a, b) => (b.readyAt?.getTime() ?? 0) - (a.readyAt?.getTime() ?? 0)),
    };
  }

  /** the customer picked the order up: it leaves the board, its tickets are served */
  async collected(saleId: string) {
    this.assertView();
    if (!UUID.test(saleId)) throw new NotFoundException('Order not found');
    const s = await this.prisma.posSale.findFirst({ where: { id: saleId, companyId: RequestCtx.companyId() } });
    if (!s) throw new NotFoundException('Order not found');
    if (s.kitchenStatus !== 'READY') throw new BadRequestException('The order is not ready yet');
    await this.prisma.$transaction([
      this.prisma.posSale.update({ where: { id: saleId }, data: { kitchenStatus: 'COLLECTED', collectedAt: new Date() } }),
      this.prisma.posKitchenTicket.updateMany({ where: { saleId, status: 'READY' }, data: { status: 'SERVED', servedAt: new Date() } }),
    ]);
    this.bus.changed(s.companyId, s.outletId, ['kitchen', 'queue', 'orders']);
    return { ok: true };
  }
}
