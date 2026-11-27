import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { capitationSchema, ClinicService, configSchema, controlledSchema, examSchema, patientSchema, practitionerSchema, serviceSchema, visitSchema } from './clinic.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

@Controller('clinic')
export class ClinicController {
  constructor(private readonly svc: ClinicService) {}

  @Get('setup')
  setup() {
    return this.svc.setup();
  }

  @Put('config')
  config(@Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>) {
    return this.svc.saveConfig(body);
  }

  @Post('practitioners')
  createPractitioner(@Body(new ZodPipe(practitionerSchema)) body: z.infer<typeof practitionerSchema>) {
    return this.svc.savePractitioner(null, body);
  }

  @Put('practitioners/:id')
  updatePractitioner(@Param('id') pid: string, @Body(new ZodPipe(practitionerSchema)) body: z.infer<typeof practitionerSchema>) {
    return this.svc.savePractitioner(id(pid), body);
  }

  @Post('services')
  createService(@Body(new ZodPipe(serviceSchema)) body: z.infer<typeof serviceSchema>) {
    return this.svc.saveService(null, body);
  }

  @Put('services/:id')
  updateService(@Param('id') sid: string, @Body(new ZodPipe(serviceSchema)) body: z.infer<typeof serviceSchema>) {
    return this.svc.saveService(id(sid), body);
  }

  @Post('controlled')
  @HttpCode(200)
  controlled(@Body(new ZodPipe(controlledSchema)) body: z.infer<typeof controlledSchema>) {
    return this.svc.setControlled(body);
  }

  @Post('controlled/remove')
  @HttpCode(200)
  removeControlled(@Body(new ZodPipe(controlledSchema)) body: z.infer<typeof controlledSchema>) {
    return this.svc.setControlled(body, true);
  }

  @Get('patients')
  patients(@Query('q') q?: string) {
    return this.svc.patients(q ? String(q).slice(0, 60) : undefined);
  }

  @Get('patients/:id')
  patient(@Param('id') pid: string) {
    return this.svc.patient(id(pid));
  }

  @Post('patients')
  createPatient(@Body(new ZodPipe(patientSchema)) body: z.infer<typeof patientSchema>) {
    return this.svc.savePatient(null, body);
  }

  @Put('patients/:id')
  updatePatient(@Param('id') pid: string, @Body(new ZodPipe(patientSchema)) body: z.infer<typeof patientSchema>) {
    return this.svc.savePatient(id(pid), body);
  }

  @Get('queue')
  queue(@Query('date') date?: string) {
    return this.svc.queue(new Date(DAY.test(date ?? '') ? date! : todayIso()));
  }

  @Post('visits')
  register(@Body(new ZodPipe(visitSchema)) body: z.infer<typeof visitSchema>) {
    return this.svc.register(body);
  }

  @Get('visits/:id')
  visit(@Param('id') vid: string) {
    return this.svc.visit(id(vid));
  }

  @Put('visits/:id/exam')
  exam(@Param('id') vid: string, @Body(new ZodPipe(examSchema)) body: z.infer<typeof examSchema>) {
    return this.svc.saveExam(id(vid), body);
  }

  @Post('visits/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') vid: string) {
    return this.svc.cancelVisit(id(vid));
  }

  @Post('visits/:id/bill')
  @HttpCode(200)
  bill(@Param('id') vid: string) {
    return this.svc.bill(id(vid));
  }

  @Post('visits/:id/unbill')
  @HttpCode(200)
  unbill(@Param('id') vid: string) {
    return this.svc.unbill(id(vid));
  }

  @Get('capitations')
  capitations() {
    return this.svc.capitations();
  }

  @Post('capitations')
  addCapitation(@Body(new ZodPipe(capitationSchema)) body: z.infer<typeof capitationSchema>) {
    return this.svc.addCapitation(body);
  }

  @Post('capitations/:id/cancel')
  @HttpCode(200)
  cancelCapitation(@Param('id') cid: string) {
    return this.svc.cancelCapitation(id(cid));
  }

  @Get('fees')
  fees(@Query('period') period?: string) {
    return this.svc.feePreview(PERIOD.test(period ?? '') ? period! : todayIso().slice(0, 7));
  }

  @Post('fees/:period')
  @HttpCode(200)
  postFees(@Param('period') period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Invalid period');
    return this.svc.postFees(period);
  }

  @Post('fee-runs/:id/cancel')
  @HttpCode(200)
  cancelFeeRun(@Param('id') rid: string) {
    return this.svc.cancelFeeRun(id(rid));
  }

  @Get('reports')
  reports(@Query('from') from?: string, @Query('to') to?: string) {
    const t = todayIso();
    return this.svc.reports(new Date(DAY.test(from ?? '') ? from! : `${t.slice(0, 8)}01`), new Date(DAY.test(to ?? '') ? to! : t));
  }

  @Get('sipnap')
  sipnap(@Query('period') period?: string) {
    return this.svc.sipnap(PERIOD.test(period ?? '') ? period! : todayIso().slice(0, 7));
  }
}
