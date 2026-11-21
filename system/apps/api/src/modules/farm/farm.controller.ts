import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { costSchema, cycleSchema, dailySchema, FarmService, harvestSchema, treatmentSchema } from './farm.service';
import { contractSchema, PartnershipService, settleSchema } from './partnership.service';

const dateBody = z.object({ date: z.coerce.date() });
const layBody = z.object({ date: z.coerce.date(), expectedLayWeeks: z.coerce.number().int().min(1).max(260) });
const completeBody = z.object({ date: z.coerce.date(), qty: z.coerce.number().min(0).max(1e9).optional() });

@Controller('farm')
export class FarmController {
  constructor(
    private readonly farm: FarmService,
    private readonly partnership: PartnershipService,
  ) {}

  @Get('cycles')
  cycles(@Query('status') status?: string, @Query('species') species?: string) {
    return this.farm.list(status || undefined, species || undefined);
  }

  @Get('cycles/:id')
  cycle(@Param('id') id: string) {
    return this.farm.get(id);
  }

  @Post('cycles')
  create(@Body(new ZodPipe(cycleSchema)) body: z.infer<typeof cycleSchema>) {
    return this.farm.create(body);
  }

  @Post('cycles/:id/place')
  @HttpCode(200)
  place(@Param('id') id: string) {
    return this.farm.place(id);
  }

  @Post('cycles/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.farm.cancel(id);
  }

  @Post('cycles/:id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @Body(new ZodPipe(dateBody)) body: z.infer<typeof dateBody>) {
    return this.farm.close(id, body);
  }

  @Post('cycles/:id/laying')
  @HttpCode(200)
  laying(@Param('id') id: string, @Body(new ZodPipe(layBody)) body: z.infer<typeof layBody>) {
    return this.farm.startLaying(id, body);
  }

  @Post('cycles/:id/daily')
  daily(@Param('id') id: string, @Body(new ZodPipe(dailySchema)) body: z.infer<typeof dailySchema>) {
    return this.farm.addDaily(id, body);
  }

  @Delete('cycles/:id/daily/:recordId')
  deleteDaily(@Param('id') id: string, @Param('recordId') recordId: string) {
    return this.farm.deleteDaily(id, recordId);
  }

  @Post('cycles/:id/treatments')
  treatment(@Param('id') id: string, @Body(new ZodPipe(treatmentSchema)) body: z.infer<typeof treatmentSchema>) {
    return this.farm.addTreatment(id, body);
  }

  @Post('cycles/:id/treatments/:tid/done')
  @HttpCode(200)
  treatmentDone(@Param('id') id: string, @Param('tid') tid: string, @Body(new ZodPipe(completeBody)) body: z.infer<typeof completeBody>) {
    return this.farm.completeTreatment(id, tid, body);
  }

  @Post('cycles/:id/treatments/:tid/cancel')
  @HttpCode(200)
  treatmentCancel(@Param('id') id: string, @Param('tid') tid: string) {
    return this.farm.cancelTreatment(id, tid);
  }

  @Post('cycles/:id/costs')
  cost(@Param('id') id: string, @Body(new ZodPipe(costSchema)) body: z.infer<typeof costSchema>) {
    return this.farm.addCost(id, body);
  }

  @Post('cycles/:id/harvests')
  harvest(@Param('id') id: string, @Body(new ZodPipe(harvestSchema)) body: z.infer<typeof harvestSchema>) {
    return this.farm.harvest(id, body);
  }

  @Post('cycles/:id/harvests/:hid/cancel')
  @HttpCode(200)
  cancelHarvest(@Param('id') id: string, @Param('hid') hid: string) {
    return this.farm.cancelHarvest(id, hid);
  }

  @Get('cycles/:id/settlement')
  settlementPreview(@Param('id') id: string, @Query('deductions') deductions?: string) {
    return this.partnership.preview(id, Math.max(0, Number(deductions) || 0));
  }

  @Post('cycles/:id/settlement')
  settle(@Param('id') id: string, @Body(new ZodPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.partnership.settle(id, body);
  }

  // ---- partnership
  @Get('contracts')
  contracts() {
    return this.partnership.contracts();
  }

  @Post('contracts')
  createContract(@Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.partnership.saveContract(null, body);
  }

  @Put('contracts/:id')
  updateContract(@Param('id') id: string, @Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.partnership.saveContract(id, body);
  }

  @Get('settlements')
  settlements(@Query('contractId') contractId?: string) {
    return this.partnership.settlements(contractId || undefined);
  }

  @Post('settlements/:id/cancel')
  @HttpCode(200)
  cancelSettlement(@Param('id') id: string) {
    return this.partnership.cancelSettlement(id);
  }

  @Get('partnership-report')
  report(@Query('year') year: string, @Query('quarter') quarter: string) {
    return this.partnership.report(Number(year), Number(quarter));
  }
}
