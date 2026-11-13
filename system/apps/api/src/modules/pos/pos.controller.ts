import { BadRequestException, Body, Controller, Delete, Get, HttpCode, MessageEvent, Param, Post, Put, Query, Sse } from '@nestjs/common';
import { interval, map, merge, Observable, takeUntil, timer } from 'rxjs';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { addLinesSchema, closeSchema, openSchema, orderSchema, paySchema, PosService, quoteSchema, reasonSchema, saleSchema, splitSchema, updateOrderSchema } from './pos.service';
import { PosKitchenService } from './pos-kitchen.service';
import { memberSchema, modifierGroupSchema, pointsAdjustSchema, PosSetupService, priceItemsSchema, productSetupSchema, promotionSchema } from './pos-setup.service';
import { PosBus, PosTopic } from './pos-bus';
import { guestCallSchema, guestOrderSchema, guestQuoteSchema, PosSelfOrderService } from './pos-selforder.service';
import { Public } from '../../common/decorators';
import { Throttle } from '@nestjs/throttler';

const STREAM_LIFETIME_MS = 10 * 60_000;
const TOPICS: PosTopic[] = ['orders', 'kitchen', 'queue', 'display'];
const range = (from?: string, to?: string) => {
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(from) : new Date(new Date().toISOString().slice(0, 8) + '01');
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(to) : new Date(new Date().toISOString().slice(0, 10));
  return [f, t] as const;
};
const lineUpdate = z.object({ qty: z.coerce.number().positive().max(1e6).optional(), discountPct: z.coerce.number().min(0).max(100).optional(), note: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).nullable().optional()), course: z.coerce.number().int().min(1).max(9).optional() });

@Controller('pos')
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly kitchen: PosKitchenService,
    private readonly setup: PosSetupService,
    private readonly bus: PosBus,
    private readonly self: PosSelfOrderService,
  ) {}

  // ---------------------------------------------------------------- table QR codes, waiter calls
  @Get('outlets/:id/table-qr')
  tableQr(@Param('id') id: string) {
    return this.self.tableCodes(id);
  }

  @Post('tables/:id/qr/rotate')
  @HttpCode(200)
  rotateQr(@Param('id') id: string) {
    return this.self.rotate(id);
  }

  @Get('outlets/:id/calls')
  calls(@Param('id') id: string) {
    return this.pos.calls(id);
  }

  @Post('tables/:id/call/clear')
  @HttpCode(200)
  clearCall(@Param('id') id: string) {
    return this.pos.clearCall(id);
  }

  // ---------------------------------------------------------------- cashier
  @Get('config')
  config(@Query('outletId') outletId?: string) {
    return this.pos.config(outletId);
  }

  @Get('products')
  products(@Query('outletId') outletId: string, @Query('search') search?: string) {
    return this.pos.products(String(outletId ?? ''), search);
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    return this.pos.quote(body);
  }

  @Get('sessions')
  sessions() {
    return this.pos.listSessions();
  }

  @Post('sessions')
  open(@Body(new ZodPipe(openSchema)) body: z.infer<typeof openSchema>) {
    return this.pos.open(body);
  }

  @Get('sessions/:id')
  session(@Param('id') id: string) {
    return this.pos.sessionSummary(id);
  }

  @Post('sessions/:id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @Body(new ZodPipe(closeSchema)) body: z.infer<typeof closeSchema>) {
    return this.pos.close(id, body);
  }

  // ---------------------------------------------------------------- orders / open bills
  @Get('orders')
  orders(@Query('outletId') outletId: string) {
    return this.pos.openOrders(String(outletId ?? ''));
  }

  @Post('orders')
  createOrder(@Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    return this.pos.createOrder(body);
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.pos.getOrder(id);
  }

  @Put('orders/:id')
  updateOrder(@Param('id') id: string, @Body(new ZodPipe(updateOrderSchema)) body: z.infer<typeof updateOrderSchema>) {
    return this.pos.updateOrder(id, body);
  }

  @Post('orders/:id/lines')
  addLines(@Param('id') id: string, @Body(new ZodPipe(addLinesSchema)) body: z.infer<typeof addLinesSchema>) {
    return this.pos.addLines(id, body);
  }

  @Put('orders/:id/lines/:lineId')
  updateLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body(new ZodPipe(lineUpdate)) body: z.infer<typeof lineUpdate>) {
    return this.pos.updateLine(id, lineId, body);
  }

  @Post('orders/:id/lines/:lineId/void')
  @HttpCode(200)
  voidLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.pos.voidLine(id, lineId, body.reason);
  }

  @Post('orders/:id/send')
  @HttpCode(200)
  send(@Param('id') id: string) {
    return this.pos.send(id);
  }

  @Post('orders/:id/fire')
  @HttpCode(200)
  fire(@Param('id') id: string, @Body(new ZodPipe(z.object({ course: z.coerce.number().int().min(1).max(9) }))) body: { course: number }) {
    return this.pos.fire(id, body.course);
  }

  @Post('orders/:id/split')
  split(@Param('id') id: string, @Body(new ZodPipe(splitSchema)) body: z.infer<typeof splitSchema>) {
    return this.pos.split(id, body);
  }

  @Post('orders/:id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @Body(new ZodPipe(z.object({ fromId: z.uuid() }))) body: { fromId: string }) {
    return this.pos.merge(id, body.fromId);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.pos.cancelOrder(id, body.reason);
  }

  @Post('orders/:id/bill')
  @HttpCode(200)
  bill(@Param('id') id: string) {
    return this.pos.printBill(id);
  }

  @Post('orders/:id/pay')
  @HttpCode(200)
  pay(@Param('id') id: string, @Body(new ZodPipe(paySchema)) body: z.infer<typeof paySchema>) {
    return this.pos.pay(id, body);
  }

  @Post('orders/:id/collected')
  @HttpCode(200)
  collected(@Param('id') id: string) {
    return this.kitchen.collected(id);
  }

  // ---------------------------------------------------------------- receipts
  @Post('sales')
  sell(@Body(new ZodPipe(saleSchema)) body: z.infer<typeof saleSchema>) {
    return this.pos.sell(body);
  }

  @Get('sales/:id/receipt')
  receipt(@Param('id') id: string) {
    return this.pos.receipt(id);
  }

  @Post('sales/:id/void')
  @HttpCode(200)
  void(@Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }) {
    return this.pos.void(id, body.reason);
  }

  // ---------------------------------------------------------------- kitchen, queue, devices
  @Get('kitchen')
  tickets(@Query('outletId') outletId: string, @Query('station') station?: string) {
    return this.kitchen.tickets(String(outletId ?? ''), station);
  }

  @Post('kitchen/tickets/:id')
  @HttpCode(200)
  ticket(@Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['NEW', 'PREPARING', 'READY', 'SERVED']) }))) body: { status: string }) {
    return this.kitchen.setStatus(id, body.status);
  }

  @Get('queue')
  queue(@Query('outletId') outletId: string) {
    return this.kitchen.queue(String(outletId ?? ''));
  }

  /** the cashier publishes the cart to the customer display(s) of the outlet */
  @Post('outlets/:id/display')
  @HttpCode(200)
  async display(@Param('id') id: string, @Body() body: unknown) {
    RequestCtx.assert('pos.sale.create');
    const outlet = await this.pos.outlet(id);
    const text = JSON.stringify((body as { state?: unknown })?.state ?? null);
    if (text.length > 64_000) throw new BadRequestException('Display state too large');
    this.bus.emit({ companyId: outlet.companyId, outletId: outlet.id, topic: 'display', data: JSON.parse(text) });
    return { ok: true };
  }

  /** realtime stream of one outlet (Server-Sent Events): orders, kitchen, queue, display */
  @Sse('outlets/:id/stream')
  async stream(@Param('id') id: string, @Query('topics') topics?: string): Promise<Observable<MessageEvent>> {
    const outlet = await this.pos.assertOutletAccess(id);
    const want = (topics ?? '').split(',').filter((t): t is PosTopic => TOPICS.includes(t as PosTopic));
    const events$ = this.bus.stream(outlet.companyId, outlet.id, want.length ? want : TOPICS).pipe(map((e): MessageEvent => ({ type: e.topic, data: e.data ?? { t: Date.now() } })));
    const ping$ = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: { t: Date.now() } })));
    return merge(events$, ping$).pipe(takeUntil(timer(STREAM_LIFETIME_MS)));
  }

  // ---------------------------------------------------------------- reports
  @Get('recap')
  recap(@Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    const [f, t] = range(from, to);
    return this.pos.dailyRecap(f, t, outletId);
  }

  @Get('service-charge')
  serviceCharge(@Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    return this.pos.serviceChargePool(f, t);
  }

  @Get('export')
  export(@Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    const [f, t] = range(from, to);
    return this.pos.exportReceipts(f, t, outletId);
  }

  // ---------------------------------------------------------------- set-up
  @Get('setup/modifiers')
  modifierGroups() {
    return this.setup.modifierGroups();
  }

  @Post('setup/modifiers')
  createModifierGroup(@Body(new ZodPipe(modifierGroupSchema)) body: z.infer<typeof modifierGroupSchema>) {
    return this.setup.saveModifierGroup(null, body);
  }

  @Put('setup/modifiers/:id')
  updateModifierGroup(@Param('id') id: string, @Body(new ZodPipe(modifierGroupSchema)) body: z.infer<typeof modifierGroupSchema>) {
    return this.setup.saveModifierGroup(id, body);
  }

  @Delete('setup/modifiers/:id')
  deleteModifierGroup(@Param('id') id: string) {
    return this.setup.deleteModifierGroup(id);
  }

  @Get('setup/menu')
  menu(@Query('search') search?: string) {
    return this.setup.menu(search);
  }

  @Put('setup/menu/:productId')
  saveMenu(@Param('productId') productId: string, @Body(new ZodPipe(productSetupSchema)) body: z.infer<typeof productSetupSchema>) {
    return this.setup.saveProductSetup(productId, body);
  }

  @Post('setup/recipe/:bomId')
  @HttpCode(200)
  recipe(@Param('bomId') bomId: string, @Body(new ZodPipe(z.object({ on: z.boolean() }))) body: { on: boolean }) {
    return this.setup.setRecipe(bomId, body.on);
  }

  @Get('setup/price-lists/:id/items')
  priceItems(@Param('id') id: string) {
    return this.setup.priceItems(id);
  }

  @Put('setup/price-lists/:id/items')
  savePriceItems(@Param('id') id: string, @Body(new ZodPipe(priceItemsSchema)) body: z.infer<typeof priceItemsSchema>) {
    return this.setup.savePriceItems(id, body);
  }

  @Get('setup/promotions')
  promotions() {
    return this.setup.promotions();
  }

  @Post('setup/promotions')
  createPromotion(@Body(new ZodPipe(promotionSchema)) body: z.infer<typeof promotionSchema>) {
    return this.setup.savePromotion(null, body);
  }

  @Put('setup/promotions/:id')
  updatePromotion(@Param('id') id: string, @Body(new ZodPipe(promotionSchema)) body: z.infer<typeof promotionSchema>) {
    return this.setup.savePromotion(id, body);
  }

  // ---------------------------------------------------------------- members
  @Get('members')
  members(@Query('search') search?: string) {
    return this.setup.members(search);
  }

  @Post('members')
  createMember(@Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    return this.setup.createMember(body);
  }

  @Get('members/:id')
  member(@Param('id') id: string) {
    return this.setup.member(id);
  }

  @Post('members/:id/points')
  @HttpCode(200)
  points(@Param('id') id: string, @Body(new ZodPipe(pointsAdjustSchema)) body: z.infer<typeof pointsAdjustSchema>) {
    return this.setup.adjustPoints(id, body);
  }

  @Post('members/:id/end')
  @HttpCode(200)
  endMembership(@Param('id') id: string) {
    return this.setup.endMembership(id);
  }
}

/** guests ordering from the QR code on their table (no sign-in; rate-limited per address) */
@Controller('public/pos')
export class PosGuestController {
  constructor(private readonly self: PosSelfOrderService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('table/:token')
  info(@Param('token') token: string) {
    return this.self.info(token);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('table/:token/quote')
  @HttpCode(200)
  quote(@Param('token') token: string, @Body(new ZodPipe(guestQuoteSchema)) body: z.infer<typeof guestQuoteSchema>) {
    return this.self.quote(token, body);
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('table/:token/order')
  @HttpCode(200)
  order(@Param('token') token: string, @Body(new ZodPipe(guestOrderSchema)) body: z.infer<typeof guestOrderSchema>) {
    return this.self.order(token, body);
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('table/:token/call')
  @HttpCode(200)
  call(@Param('token') token: string, @Body(new ZodPipe(guestCallSchema)) body: z.infer<typeof guestCallSchema>) {
    return this.self.call(token, body.type);
  }
}
