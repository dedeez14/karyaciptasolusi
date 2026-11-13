import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { baseSchema, checkSchema, colorantSchema, colourSchema, formulaSchema, PaintService, sdsSchema, tintSchema } from './paint.service';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

@Controller('paint')
export class PaintController {
  constructor(private readonly svc: PaintService) {}

  @Get('meta')
  meta() {
    return this.svc.meta();
  }

  @Get('colours')
  colours(@Query('q') q?: string) {
    return this.svc.colours(q?.slice(0, 40) || undefined);
  }

  @Post('colours')
  createColour(@Body(new ZodPipe(colourSchema)) body: z.infer<typeof colourSchema>) {
    return this.svc.saveColour(null, body);
  }

  @Put('colours/:id')
  updateColour(@Param('id') id: string, @Body(new ZodPipe(colourSchema)) body: z.infer<typeof colourSchema>) {
    return this.svc.saveColour(id, body);
  }

  @Get('bases')
  bases() {
    return this.svc.bases();
  }

  @Post('bases')
  createBase(@Body(new ZodPipe(baseSchema)) body: z.infer<typeof baseSchema>) {
    return this.svc.saveBase(null, body);
  }

  @Put('bases/:id')
  updateBase(@Param('id') id: string, @Body(new ZodPipe(baseSchema)) body: z.infer<typeof baseSchema>) {
    return this.svc.saveBase(id, body);
  }

  @Get('colorants')
  colorants() {
    return this.svc.colorants();
  }

  @Post('colorants')
  createColorant(@Body(new ZodPipe(colorantSchema)) body: z.infer<typeof colorantSchema>) {
    return this.svc.saveColorant(null, body);
  }

  @Put('colorants/:id')
  updateColorant(@Param('id') id: string, @Body(new ZodPipe(colorantSchema)) body: z.infer<typeof colorantSchema>) {
    return this.svc.saveColorant(id, body);
  }

  @Get('formulas')
  formulas(@Query('colourId') colourId?: string, @Query('status') status?: string) {
    return this.svc.formulas({ colourId: UUID.test(colourId ?? '') ? colourId : undefined, status: status || undefined });
  }

  @Post('formulas')
  createFormula(@Body(new ZodPipe(formulaSchema)) body: z.infer<typeof formulaSchema>) {
    return this.svc.saveFormula(null, body);
  }

  @Put('formulas/:id')
  updateFormula(@Param('id') id: string, @Body(new ZodPipe(formulaSchema)) body: z.infer<typeof formulaSchema>) {
    return this.svc.saveFormula(id, body);
  }

  @Post('formulas/:id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string) {
    return this.svc.approveFormula(id);
  }

  @Post('formulas/:id/retire')
  @HttpCode(200)
  retire(@Param('id') id: string) {
    return this.svc.retireFormula(id);
  }

  @Get('quote')
  quote(@Query('formulaId') formulaId: string, @Query('baseProductId') baseProductId: string, @Query('cans') cans?: string) {
    return this.svc.quote(formulaId, baseProductId, Math.max(1, Math.min(10_000, Number(cans) || 1)));
  }

  @Get('jobs')
  jobs(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.jobs({ from: DAY.test(from ?? '') ? from : undefined, to: DAY.test(to ?? '') ? to : undefined });
  }

  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.svc.job(id);
  }

  @Post('jobs')
  tint(@Body(new ZodPipe(tintSchema)) body: z.infer<typeof tintSchema>) {
    return this.svc.tint(body);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancelTint(id);
  }

  @Get('checks')
  checks(@Query('workOrderId') workOrderId?: string) {
    return this.svc.checks({ workOrderId: UUID.test(workOrderId ?? '') ? workOrderId : undefined });
  }

  @Post('checks')
  check(@Body(new ZodPipe(checkSchema)) body: z.infer<typeof checkSchema>) {
    return this.svc.check(body);
  }

  @Get('coa')
  coaList() {
    return this.svc.coaList();
  }

  @Get('coa/:inspectionId')
  coa(@Param('inspectionId') id: string) {
    return this.svc.coa(id);
  }

  @Get('sds')
  sdsList() {
    return this.svc.sdsList();
  }

  @Get('sds/:id')
  sds(@Param('id') id: string) {
    return this.svc.sds(id);
  }

  @Post('sds')
  saveSds(@Body(new ZodPipe(sdsSchema)) body: z.infer<typeof sdsSchema>) {
    return this.svc.saveSds(body);
  }
}
