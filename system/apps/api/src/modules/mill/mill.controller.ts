import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { dailySchema, intakeSchema, MillService, priceSchema, settleSchema, tankSchema } from './mill.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v?: string) => (v && DAY.test(v) ? v : undefined);
const period = (from?: string, to?: string) => {
  if (!day(from) || !day(to)) throw new BadRequestException('Choose a valid period');
  return { from: from!, to: to! };
};

@Controller('mill')
export class MillController {
  constructor(private readonly svc: MillService) {}

  @Get('lists')
  lists() {
    return this.svc.lists();
  }

  // ----- tanks
  @Post('tanks')
  createTank(@Body(new ZodPipe(tankSchema)) body: z.infer<typeof tankSchema>) {
    return this.svc.saveTank(null, body);
  }

  @Put('tanks/:id')
  updateTank(@Param('id') id: string, @Body(new ZodPipe(tankSchema)) body: z.infer<typeof tankSchema>) {
    return this.svc.saveTank(id, body);
  }

  @Delete('tanks/:id')
  deleteTank(@Param('id') id: string) {
    return this.svc.deleteTank(id);
  }

  @Get('tanks/:id/sounding')
  sounding(@Param('id') id: string, @Query('cm') cm: string, @Query('temp') temp: string) {
    const h = Number(cm);
    const t = Number(temp);
    if (!Number.isFinite(h) || h < 0 || !Number.isFinite(t) || t < 0 || t > 120) throw new BadRequestException('Enter the height and the temperature');
    return this.svc.sounding(id, h, t);
  }

  // ----- TBS price board
  @Get('prices')
  prices(@Query('type') type?: string) {
    return this.svc.prices(type || undefined);
  }

  @Get('prices/current')
  currentPrice(@Query('type') type: string, @Query('date') date?: string) {
    return this.svc.currentPrice(type, date);
  }

  @Post('prices')
  savePrice(@Body(new ZodPipe(priceSchema)) body: z.infer<typeof priceSchema>) {
    return this.svc.savePrice(body);
  }

  @Delete('prices/:id')
  deletePrice(@Param('id') id: string) {
    return this.svc.deletePrice(id);
  }

  // ----- fruit bought at the weighbridge
  @Get('intakes')
  intakes(@Query('from') from?: string, @Query('to') to?: string, @Query('supplierId') supplierId?: string, @Query('status') status?: string) {
    return this.svc.intakes({ from: day(from), to: day(to), supplierId: supplierId || undefined, status: status || undefined });
  }

  @Get('intakes/:id')
  intake(@Param('id') id: string) {
    return this.svc.intake(id);
  }

  @Post('intakes')
  createIntake(@Body(new ZodPipe(intakeSchema)) body: z.infer<typeof intakeSchema>) {
    return this.svc.createIntake(body);
  }

  @Post('intakes/:id/cancel')
  @HttpCode(200)
  cancelIntake(@Param('id') id: string) {
    return this.svc.cancelIntake(id);
  }

  @Post('settlement/preview')
  @HttpCode(200)
  settlePreview(@Body(new ZodPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.svc.settlePreview(body);
  }

  @Post('settlement')
  settle(@Body(new ZodPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.svc.settle(body);
  }

  @Get('suppliers')
  suppliers(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.suppliers(period(from, to));
  }

  // ----- daily processing report
  @Get('dailies')
  dailies(@Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    return this.svc.dailies({ from: day(from), to: day(to), status: status || undefined });
  }

  @Get('dailies/prefill')
  prefill(@Query('date') date: string, @Query('tbsProductId') tbsProductId?: string, @Query('tbsWarehouseId') tbsWarehouseId?: string, @Query('id') id?: string) {
    return this.svc.prefill(date, tbsProductId || undefined, tbsWarehouseId || undefined, id || undefined);
  }

  @Get('dailies/:id')
  daily(@Param('id') id: string) {
    return this.svc.daily(id);
  }

  @Post('dailies')
  createDaily(@Body(new ZodPipe(dailySchema)) body: z.infer<typeof dailySchema>) {
    return this.svc.saveDaily(null, body);
  }

  @Put('dailies/:id')
  updateDaily(@Param('id') id: string, @Body(new ZodPipe(dailySchema)) body: z.infer<typeof dailySchema>) {
    return this.svc.saveDaily(id, body);
  }

  @Post('dailies/:id/post')
  @HttpCode(200)
  post(@Param('id') id: string) {
    return this.svc.postDaily(id);
  }

  @Post('dailies/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancelDaily(id);
  }

  @Get('dinas-report')
  dinasReport(@Query('month') month: string) {
    return this.svc.dinasReport(month);
  }

  @Get('performance')
  performance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.performance(period(from, to));
  }
}
