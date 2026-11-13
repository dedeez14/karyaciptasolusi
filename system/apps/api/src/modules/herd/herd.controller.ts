import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { deliverySchema, eventSchema, exitSchema, feedSchema, HerdService, milkRecordSchema, milkSettleSchema, productiveSchema, registerSchema, schemeSchema, treatSchema, updateSchema, weighSchema } from './herd.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v?: string) => (v && DAY.test(v) ? v : undefined);
const period = (from?: string, to?: string) => {
  if (!day(from) || !day(to)) throw new BadRequestException('Choose a valid period');
  return { from: from!, to: to! };
};

@Controller('herd')
export class HerdController {
  constructor(private readonly svc: HerdService) {}

  @Get('lists')
  lists() {
    return this.svc.lists();
  }

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('fattening')
  fattening() {
    return this.svc.fattening();
  }

  // ----- animals
  @Get('animals')
  animals(@Query('status') status?: string, @Query('purpose') purpose?: string, @Query('unitId') unitId?: string, @Query('repro') repro?: string, @Query('search') search?: string) {
    return this.svc.animals({ status: status || undefined, purpose: purpose || undefined, unitId: unitId || undefined, repro: repro || undefined, search: search?.trim().slice(0, 60) || undefined });
  }

  @Get('animals/:id')
  animal(@Param('id') id: string) {
    return this.svc.animal(id);
  }

  @Post('animals')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.svc.register(body);
  }

  @Put('animals/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.svc.update(id, body);
  }

  @Post('animals/:id/events')
  addEvent(@Param('id') id: string, @Body(new ZodPipe(eventSchema)) body: z.infer<typeof eventSchema>) {
    return this.svc.addEvent(id, body);
  }

  @Delete('animals/:id/events/:eventId')
  deleteEvent(@Param('id') id: string, @Param('eventId') eventId: string) {
    return this.svc.deleteEvent(id, eventId);
  }

  @Post('animals/:id/productive')
  @HttpCode(200)
  productive(@Param('id') id: string, @Body(new ZodPipe(productiveSchema)) body: z.infer<typeof productiveSchema>) {
    return this.svc.declareProductive(id, body);
  }

  @Delete('animals/:id/weights/:weightId')
  deleteWeight(@Param('id') id: string, @Param('weightId') weightId: string) {
    return this.svc.deleteWeight(id, weightId);
  }

  @Post('animals/:id/cancel-exit')
  @HttpCode(200)
  cancelExit(@Param('id') id: string) {
    return this.svc.cancelExit(id);
  }

  @Post('weighings')
  weigh(@Body(new ZodPipe(weighSchema)) body: z.infer<typeof weighSchema>) {
    return this.svc.weigh(body);
  }

  @Post('treatments')
  treat(@Body(new ZodPipe(treatSchema)) body: z.infer<typeof treatSchema>) {
    return this.svc.treat(body);
  }

  @Get('treatments')
  treatments(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.treatments(period(from, to));
  }

  @Post('exits')
  exit(@Body(new ZodPipe(exitSchema)) body: z.infer<typeof exitSchema>) {
    return this.svc.exit(body);
  }

  // ----- feeding
  @Get('feedings')
  feedings(@Query('from') from?: string, @Query('to') to?: string, @Query('unitId') unitId?: string) {
    return this.svc.feedings({ from: day(from), to: day(to), unitId: unitId || undefined });
  }

  @Post('feedings')
  feed(@Body(new ZodPipe(feedSchema)) body: z.infer<typeof feedSchema>) {
    return this.svc.feed(body);
  }

  @Post('feedings/:id/cancel')
  @HttpCode(200)
  cancelFeeding(@Param('id') id: string) {
    return this.svc.cancelFeeding(id);
  }

  // ----- milk
  @Get('milk/sheet')
  milkSheet(@Query('date') date: string) {
    if (!day(date)) throw new BadRequestException('Choose a date');
    return this.svc.milkSheet(date);
  }

  @Post('milk/records')
  @HttpCode(200)
  recordMilk(@Body(new ZodPipe(milkRecordSchema)) body: z.infer<typeof milkRecordSchema>) {
    return this.svc.recordMilk(body);
  }

  @Get('milk/summary')
  milkSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.milkSummary(period(from, to));
  }

  @Get('milk/schemes')
  schemes(@Query('customerId') customerId?: string) {
    return this.svc.schemes(customerId || undefined);
  }

  @Post('milk/schemes')
  saveScheme(@Body(new ZodPipe(schemeSchema)) body: z.infer<typeof schemeSchema>) {
    return this.svc.saveScheme(body);
  }

  @Delete('milk/schemes/:id')
  deleteScheme(@Param('id') id: string) {
    return this.svc.deleteScheme(id);
  }

  @Get('milk/quote')
  async quote(@Query('customerId') customerId: string, @Query('date') date: string, @Query('fat') fat?: string, @Query('snf') snf?: string, @Query('ts') ts?: string, @Query('tpc') tpc?: string) {
    if (!day(date) || !/^[0-9a-f-]{36}$/i.test(customerId ?? '')) throw new BadRequestException('Choose the buyer and the date');
    const num = (v?: string) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return this.svc.quote(customerId, new Date(date), { fat: num(fat), snf: num(snf), ts: num(ts), tpc: num(tpc) });
  }

  @Get('milk/deliveries')
  deliveries(@Query('from') from?: string, @Query('to') to?: string, @Query('customerId') customerId?: string) {
    return this.svc.deliveries({ from: day(from), to: day(to), customerId: customerId || undefined });
  }

  @Post('milk/deliveries')
  createDelivery(@Body(new ZodPipe(deliverySchema)) body: z.infer<typeof deliverySchema>) {
    return this.svc.createDelivery(body);
  }

  @Post('milk/deliveries/:id/cancel')
  @HttpCode(200)
  cancelDelivery(@Param('id') id: string) {
    return this.svc.cancelDelivery(id);
  }

  @Post('milk/settlement')
  settleMilk(@Body(new ZodPipe(milkSettleSchema)) body: z.infer<typeof milkSettleSchema>) {
    return this.svc.settleMilk(body);
  }
}
