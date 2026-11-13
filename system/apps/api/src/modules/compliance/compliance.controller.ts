import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { certificateSchema, ComplianceService, tkdnSchema } from './compliance.service';
import { entrySchema, handoverSchema, WasteService } from './waste.service';
import { siinasSaveSchema, siinasSubmitSchema, SiinasService } from './siinas.service';

import { todayDate } from './local-date';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const range = (from?: string, to?: string) => {
  const today = todayDate();
  const t = to && ISO.test(to) ? new Date(to) : today;
  const f = from && ISO.test(from) ? new Date(from) : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() < 6 ? 0 : 6, 1));
  return [f, t] as const;
};

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly svc: ComplianceService,
    private readonly waste: WasteService,
    private readonly siinas: SiinasService,
  ) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  // ---- certificates
  @Get('certificates')
  certificates(@Query('type') type?: string, @Query('status') status?: string, @Query('productId') productId?: string) {
    return this.svc.certificates(type || undefined, status || undefined, productId || undefined);
  }

  @Get('certificates/:id')
  certificate(@Param('id') id: string) {
    return this.svc.certificate(id);
  }

  @Post('certificates')
  createCertificate(@Body(new ZodPipe(certificateSchema)) body: z.infer<typeof certificateSchema>) {
    return this.svc.saveCertificate(null, body);
  }

  @Put('certificates/:id')
  updateCertificate(@Param('id') id: string, @Body(new ZodPipe(certificateSchema)) body: z.infer<typeof certificateSchema>) {
    return this.svc.saveCertificate(id, body);
  }

  @Delete('certificates/:id')
  deleteCertificate(@Param('id') id: string) {
    return this.svc.deleteCertificate(id);
  }

  @Post('certificates/:id/reviewed')
  @HttpCode(200)
  reviewed(@Param('id') id: string, @Body(new ZodPipe(z.object({ note: z.string().trim().max(500).optional() }))) body: { note?: string }) {
    return this.svc.markReviewed(id, body.note);
  }

  @Get('product-check')
  productCheck() {
    return this.svc.productCheck();
  }

  // ---- TKDN
  @Get('tkdn')
  tkdnList() {
    return this.svc.tkdnList();
  }

  @Get('tkdn/prefill')
  prefill(@Query('productId') productId: string, @Query('bomId') bomId?: string) {
    return this.svc.tkdnPrefill(productId, bomId || undefined);
  }

  @Get('tkdn/:id')
  tkdn(@Param('id') id: string) {
    return this.svc.tkdn(id);
  }

  @Post('tkdn')
  createTkdn(@Body(new ZodPipe(tkdnSchema)) body: z.infer<typeof tkdnSchema>) {
    return this.svc.saveTkdn(null, body);
  }

  @Put('tkdn/:id')
  updateTkdn(@Param('id') id: string, @Body(new ZodPipe(tkdnSchema)) body: z.infer<typeof tkdnSchema>) {
    return this.svc.saveTkdn(id, body);
  }

  @Post('tkdn/:id/finalise')
  @HttpCode(200)
  finalise(@Param('id') id: string) {
    return this.svc.finaliseTkdn(id);
  }

  @Delete('tkdn/:id')
  deleteTkdn(@Param('id') id: string) {
    return this.svc.deleteTkdn(id);
  }

  // ---- B3 waste
  @Get('waste/stock')
  wasteStock() {
    return this.waste.stock();
  }

  @Post('waste/types/common')
  @HttpCode(200)
  commonTypes() {
    return this.waste.addCommonTypes();
  }

  @Post('waste/entries')
  addEntry(@Body(new ZodPipe(entrySchema)) body: z.infer<typeof entrySchema>) {
    return this.waste.addEntry(body);
  }

  @Post('waste/entries/:id/cancel')
  @HttpCode(200)
  cancelEntry(@Param('id') id: string) {
    return this.waste.cancelEntry(id);
  }

  @Get('waste/handovers')
  handovers(@Query('from') from?: string, @Query('to') to?: string) {
    return this.waste.handovers(from && ISO.test(from) ? new Date(from) : undefined, to && ISO.test(to) ? new Date(to) : undefined);
  }

  @Post('waste/handovers')
  addHandover(@Body(new ZodPipe(handoverSchema)) body: z.infer<typeof handoverSchema>) {
    return this.waste.addHandover(body);
  }

  @Post('waste/handovers/:id/cancel')
  @HttpCode(200)
  cancelHandover(@Param('id') id: string) {
    return this.waste.cancelHandover(id);
  }

  @Get('waste/logbook')
  logbook(@Query('from') from?: string, @Query('to') to?: string, @Query('typeId') typeId?: string) {
    const [f, t] = range(from, to);
    return this.waste.logbook(f, t, typeId || undefined);
  }

  @Get('waste/balance')
  balance(@Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    return this.waste.balance(f, t);
  }

  // ---- SIINas
  @Get('siinas')
  siinasReport(@Query('year') year: string, @Query('quarter') quarter: string) {
    return this.siinas.report(Number(year), Number(quarter));
  }

  @Put('siinas')
  saveSiinas(@Body(new ZodPipe(siinasSaveSchema)) body: z.infer<typeof siinasSaveSchema>) {
    return this.siinas.save(body);
  }

  @Post('siinas/submit')
  @HttpCode(200)
  submitSiinas(@Body(new ZodPipe(siinasSubmitSchema)) body: z.infer<typeof siinasSubmitSchema>) {
    return this.siinas.submit(body);
  }
}
