import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { advanceSchema, driverSchema, finishSchema, jobSchema, linkSchema, LogisticsService, podSchema, rateSchema, settleSchema, tripSchema, vehicleSchema } from './logistics.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const idsSchema = z.object({ jobIds: z.array(z.uuid()).max(300) });
const quoteSchema = z.object({
  customerId: z.uuid(),
  service: z.enum(['TRUCKING', 'FORWARDING']),
  origin: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(80),
  vehicleType: z.preprocess((v) => (v === '' ? null : v), z.string().max(10).nullable().optional()),
  weightKg: z.coerce.number().min(0).default(0),
  volumeM3: z.coerce.number().min(0).default(0),
});
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};

@Controller('logistics')
export class LogisticsController {
  constructor(private readonly svc: LogisticsService) {}

  @Get('vehicles')
  vehicles() {
    return this.svc.vehicles();
  }

  @Post('vehicles')
  createVehicle(@Body(new ZodPipe(vehicleSchema)) body: z.infer<typeof vehicleSchema>) {
    return this.svc.saveVehicle(null, body);
  }

  @Put('vehicles/:id')
  updateVehicle(@Param('id') vid: string, @Body(new ZodPipe(vehicleSchema)) body: z.infer<typeof vehicleSchema>) {
    return this.svc.saveVehicle(id(vid), body);
  }

  @Get('drivers')
  drivers() {
    return this.svc.drivers();
  }

  @Post('drivers')
  createDriver(@Body(new ZodPipe(driverSchema)) body: z.infer<typeof driverSchema>) {
    return this.svc.saveDriver(null, body);
  }

  @Put('drivers/:id')
  updateDriver(@Param('id') did: string, @Body(new ZodPipe(driverSchema)) body: z.infer<typeof driverSchema>) {
    return this.svc.saveDriver(id(did), body);
  }

  @Get('alerts')
  alerts() {
    return this.svc.alerts();
  }

  @Get('fleet-report')
  fleetReport(@Query('from') from?: string, @Query('to') to?: string) {
    const t = new Date().toISOString().slice(0, 10);
    return this.svc.fleetReport(new Date(DAY.test(from ?? '') ? from! : `${t.slice(0, 8)}01`), new Date(DAY.test(to ?? '') ? to! : t));
  }

  @Get('rates')
  rates() {
    return this.svc.rates();
  }

  @Post('rates')
  createRate(@Body(new ZodPipe(rateSchema)) body: z.infer<typeof rateSchema>) {
    return this.svc.saveRate(null, body);
  }

  @Put('rates/:id')
  updateRate(@Param('id') rid: string, @Body(new ZodPipe(rateSchema)) body: z.infer<typeof rateSchema>) {
    return this.svc.saveRate(id(rid), body);
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    return this.svc.quote(body);
  }

  @Get('jobs')
  jobs(@Query('status') status?: string) {
    return this.svc.jobs(['OPEN', 'DISPATCHED', 'DELIVERED', 'INVOICED', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('jobs/:id')
  job(@Param('id') jid: string) {
    return this.svc.job(id(jid));
  }

  @Post('jobs')
  createJob(@Body(new ZodPipe(jobSchema)) body: z.infer<typeof jobSchema>) {
    return this.svc.saveJob(null, body);
  }

  @Put('jobs/:id')
  updateJob(@Param('id') jid: string, @Body(new ZodPipe(jobSchema)) body: z.infer<typeof jobSchema>) {
    return this.svc.saveJob(id(jid), body);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancelJob(@Param('id') jid: string) {
    return this.svc.cancelJob(id(jid));
  }

  @Post('jobs/:id/pod')
  @HttpCode(200)
  pod(@Param('id') jid: string, @Body(new ZodPipe(podSchema)) body: z.infer<typeof podSchema>) {
    return this.svc.pod(id(jid), body);
  }

  @Post('jobs/invoice')
  @HttpCode(200)
  invoice(@Body(new ZodPipe(idsSchema)) body: z.infer<typeof idsSchema>) {
    return this.svc.invoiceJobs(body.jobIds);
  }

  @Post('jobs/:id/uninvoice')
  @HttpCode(200)
  uninvoice(@Param('id') jid: string) {
    return this.svc.uninvoice(id(jid));
  }

  @Get('carrier-lines')
  carrierLines() {
    return this.svc.openCarrierLines();
  }

  @Post('carrier-product')
  @HttpCode(200)
  carrierProduct() {
    return this.svc.ensureCarrierProduct();
  }

  @Post('jobs/:id/carrier')
  @HttpCode(200)
  link(@Param('id') jid: string, @Body(new ZodPipe(linkSchema)) body: z.infer<typeof linkSchema>) {
    return this.svc.linkCarrier(id(jid), body);
  }

  @Post('carrier-costs/:id/remove')
  @HttpCode(200)
  unlink(@Param('id') cid: string) {
    return this.svc.unlinkCarrier(id(cid));
  }

  @Get('trips')
  trips(@Query('status') status?: string) {
    return this.svc.trips(['OPEN', 'DONE', 'SETTLED', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('trips/:id')
  trip(@Param('id') tid: string) {
    return this.svc.trip(id(tid));
  }

  @Post('trips')
  createTrip(@Body(new ZodPipe(tripSchema)) body: z.infer<typeof tripSchema>) {
    return this.svc.createTrip(body);
  }

  @Put('trips/:id/jobs')
  setJobs(@Param('id') tid: string, @Body(new ZodPipe(idsSchema)) body: z.infer<typeof idsSchema>) {
    return this.svc.setTripJobs(id(tid), body.jobIds);
  }

  @Post('trips/:id/advance')
  @HttpCode(200)
  advance(@Param('id') tid: string, @Body(new ZodPipe(advanceSchema)) body: z.infer<typeof advanceSchema>) {
    return this.svc.giveAdvance(id(tid), body);
  }

  @Post('trips/:id/finish')
  @HttpCode(200)
  finish(@Param('id') tid: string, @Body(new ZodPipe(finishSchema)) body: z.infer<typeof finishSchema>) {
    return this.svc.finishTrip(id(tid), body);
  }

  @Post('trips/:id/settle')
  @HttpCode(200)
  settle(@Param('id') tid: string, @Body(new ZodPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.svc.settle(id(tid), body);
  }

  @Post('trips/:id/unsettle')
  @HttpCode(200)
  unsettle(@Param('id') tid: string) {
    return this.svc.unsettle(id(tid));
  }

  @Post('trips/:id/cancel')
  @HttpCode(200)
  cancelTrip(@Param('id') tid: string) {
    return this.svc.cancelTrip(id(tid));
  }
}
