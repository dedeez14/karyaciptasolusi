import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { bookSchema, cancelSchema, deedSchema, PropertyService, scheduleSchema, siteSchema, unitsSchema } from './property.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateSchema = z.object({ date: z.coerce.date() });
const invoiceSchema = z.object({ lineIds: z.array(z.uuid()).max(300).optional() });
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};

@Controller('property')
export class PropertyController {
  constructor(private readonly svc: PropertyService) {}

  @Get('sites')
  sites() {
    return this.svc.sites();
  }

  @Post('sites')
  createSite(@Body(new ZodPipe(siteSchema)) body: z.infer<typeof siteSchema>) {
    return this.svc.saveSite(null, body);
  }

  @Put('sites/:id')
  updateSite(@Param('id') sid: string, @Body(new ZodPipe(siteSchema)) body: z.infer<typeof siteSchema>) {
    return this.svc.saveSite(id(sid), body);
  }

  @Get('units')
  units(@Query('siteId') siteId?: string) {
    return this.svc.units(siteId && UUID.test(siteId) ? siteId : undefined);
  }

  @Put('sites/:id/units')
  saveUnits(@Param('id') sid: string, @Body(new ZodPipe(unitsSchema)) body: z.infer<typeof unitsSchema>) {
    return this.svc.saveUnits(id(sid), body);
  }

  @Post('sites/:id/allocate')
  @HttpCode(200)
  allocate(@Param('id') sid: string) {
    return this.svc.allocateCost(id(sid));
  }

  @Get('sales')
  sales(@Query('status') status?: string) {
    return this.svc.sales(['ACTIVE', 'HANDED_OVER', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('sales/:id')
  sale(@Param('id') sid: string) {
    return this.svc.sale(id(sid));
  }

  @Post('sales')
  book(@Body(new ZodPipe(bookSchema)) body: z.infer<typeof bookSchema>) {
    return this.svc.book(body);
  }

  @Put('sales/:id/schedule')
  schedule(@Param('id') sid: string, @Body(new ZodPipe(scheduleSchema)) body: z.infer<typeof scheduleSchema>) {
    return this.svc.updateSchedule(id(sid), body);
  }

  @Post('sales/:id/invoice')
  @HttpCode(200)
  invoice(@Param('id') sid: string, @Body(new ZodPipe(invoiceSchema)) body: z.infer<typeof invoiceSchema>) {
    return this.svc.invoiceLines(id(sid), body.lineIds);
  }

  @Post('sales/:id/ppjb')
  @HttpCode(200)
  ppjb(@Param('id') sid: string, @Body(new ZodPipe(deedSchema)) body: z.infer<typeof deedSchema>) {
    return this.svc.ppjb(id(sid), body);
  }

  @Post('sales/:id/ajb')
  @HttpCode(200)
  ajb(@Param('id') sid: string, @Body(new ZodPipe(deedSchema)) body: z.infer<typeof deedSchema>) {
    return this.svc.ajb(id(sid), body);
  }

  @Post('sales/:id/handover')
  @HttpCode(200)
  handover(@Param('id') sid: string, @Body(new ZodPipe(dateSchema)) body: z.infer<typeof dateSchema>) {
    return this.svc.handover(id(sid), body);
  }

  @Post('sales/:id/handover/undo')
  @HttpCode(200)
  undoHandover(@Param('id') sid: string) {
    return this.svc.undoHandover(id(sid));
  }

  @Post('sales/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') sid: string, @Body(new ZodPipe(cancelSchema)) body: z.infer<typeof cancelSchema>) {
    return this.svc.cancel(id(sid), body);
  }

  @Get('final-tax')
  finalTax(@Query('period') period?: string) {
    return this.svc.finalTax(PERIOD.test(period ?? '') ? period! : new Date().toISOString().slice(0, 7));
  }

  @Post('final-tax/:period/book')
  @HttpCode(200)
  bookTax(@Param('period') period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Invalid period');
    return this.svc.bookTax(period);
  }

  @Post('final-tax/payments/:id/cancel')
  @HttpCode(200)
  cancelTax(@Param('id') pid: string) {
    return this.svc.cancelTax(id(pid));
  }
}
