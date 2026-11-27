import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { billSchema, contractSchema, depositSchema, handoverSchema, meterSchema, RentalService, returnSchema, unitSchema } from './rental.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const day = (v: string | undefined, fallback: string) => new Date(DAY.test(v ?? '') ? v! : fallback);

@Controller('rental')
export class RentalController {
  constructor(private readonly svc: RentalService) {}

  @Get('units')
  units() {
    return this.svc.units();
  }

  @Post('units')
  createUnit(@Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    return this.svc.saveUnit(null, body);
  }

  @Put('units/:id')
  updateUnit(@Param('id') uid: string, @Body(new ZodPipe(unitSchema)) body: z.infer<typeof unitSchema>) {
    return this.svc.saveUnit(id(uid), body);
  }

  @Get('contracts')
  contracts(@Query('status') status?: string) {
    return this.svc.contracts(['RESERVED', 'ON_RENT', 'RETURNED', 'CLOSED', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('contracts/:id')
  contract(@Param('id') cid: string) {
    return this.svc.contract(id(cid));
  }

  @Post('contracts')
  createContract(@Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(null, body);
  }

  @Put('contracts/:id')
  updateContract(@Param('id') cid: string, @Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(id(cid), body);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') cid: string) {
    return this.svc.cancel(id(cid));
  }

  @Post('contracts/:id/handover')
  @HttpCode(200)
  handover(@Param('id') cid: string, @Body(new ZodPipe(handoverSchema)) body: z.infer<typeof handoverSchema>) {
    return this.svc.handover(id(cid), body);
  }

  @Post('contracts/:id/meter')
  @HttpCode(200)
  meter(@Param('id') cid: string, @Body(new ZodPipe(meterSchema)) body: z.infer<typeof meterSchema>) {
    return this.svc.addReading(id(cid), body);
  }

  @Post('contracts/:id/return')
  @HttpCode(200)
  takeBack(@Param('id') cid: string, @Body(new ZodPipe(returnSchema)) body: z.infer<typeof returnSchema>) {
    return this.svc.takeBack(id(cid), body);
  }

  @Get('contracts/:id/preview')
  preview(@Param('id') cid: string, @Query('upTo') upTo?: string) {
    return this.svc.preview(id(cid), day(upTo, todayIso()));
  }

  @Post('contracts/:id/bill')
  @HttpCode(200)
  bill(@Param('id') cid: string, @Body(new ZodPipe(billSchema)) body: z.infer<typeof billSchema>) {
    return this.svc.bill(id(cid), body);
  }

  @Post('bills/:id/cancel')
  @HttpCode(200)
  cancelBill(@Param('id') bid: string) {
    return this.svc.cancelBill(id(bid));
  }

  @Post('contracts/:id/deposits')
  @HttpCode(200)
  deposit(@Param('id') cid: string, @Body(new ZodPipe(depositSchema)) body: z.infer<typeof depositSchema>) {
    return this.svc.deposit(id(cid), body);
  }

  @Post('deposits/:id/cancel')
  @HttpCode(200)
  cancelDeposit(@Param('id') did: string) {
    return this.svc.cancelDeposit(id(did));
  }

  @Post('contracts/:id/close')
  @HttpCode(200)
  close(@Param('id') cid: string) {
    return this.svc.close(id(cid));
  }

  @Get('calendar')
  calendar(@Query('from') from?: string, @Query('to') to?: string) {
    const t = todayIso();
    const f = day(from, t);
    const e = day(to, new Date(f.getTime() + 41 * 86_400_000).toISOString().slice(0, 10));
    if (e < f || e.getTime() - f.getTime() > 186 * 86_400_000) throw new BadRequestException('Choose up to six months');
    return this.svc.calendar(f, e);
  }

  @Get('reports')
  reports(@Query('from') from?: string, @Query('to') to?: string) {
    const t = todayIso();
    const f = day(from, `${t.slice(0, 8)}01`);
    const e = day(to, t);
    if (e < f) throw new BadRequestException('The range ends before it starts');
    return this.svc.reports(f, e);
  }
}
