import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { blockSchema, dispatchSchema, matureSchema, PlantationService, weighSchema, workdaySchema } from './plantation.service';

const period = (q: { from?: string; to?: string }) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return { from: re.test(q.from ?? '') ? q.from! : '', to: re.test(q.to ?? '') ? q.to! : '' };
};

@Controller('plantation')
export class PlantationController {
  constructor(private readonly svc: PlantationService) {}

  @Get('lists')
  lists() {
    return this.svc.lists();
  }

  // ----- blocks
  @Get('blocks')
  blocks(@Query('siteId') siteId?: string, @Query('divisionId') divisionId?: string, @Query('phase') phase?: string) {
    return this.svc.blocks({ siteId: siteId || undefined, divisionId: divisionId || undefined, phase: phase || undefined });
  }

  @Get('blocks.geojson')
  geojson(@Query('siteId') siteId?: string) {
    return this.svc.geojson(siteId || undefined);
  }

  @Get('blocks/:id')
  block(@Param('id') id: string) {
    return this.svc.block(id);
  }

  @Post('blocks')
  createBlock(@Body(new ZodPipe(blockSchema)) body: z.infer<typeof blockSchema>) {
    return this.svc.saveBlock(null, body);
  }

  @Put('blocks/:id')
  updateBlock(@Param('id') id: string, @Body(new ZodPipe(blockSchema)) body: z.infer<typeof blockSchema>) {
    return this.svc.saveBlock(id, body);
  }

  @Delete('blocks/:id')
  deleteBlock(@Param('id') id: string) {
    return this.svc.deleteBlock(id);
  }

  @Post('blocks/:id/mature')
  @HttpCode(200)
  mature(@Param('id') id: string, @Body(new ZodPipe(matureSchema)) body: z.infer<typeof matureSchema>) {
    return this.svc.declareMature(id, body);
  }

  @Post('blocks/:id/undo-mature')
  @HttpCode(200)
  undoMature(@Param('id') id: string) {
    return this.svc.undoMature(id);
  }

  // ----- daily work book (BKM)
  @Get('workdays')
  workdays(@Query('from') from?: string, @Query('to') to?: string, @Query('divisionId') divisionId?: string, @Query('status') status?: string) {
    const p = period({ from, to });
    return this.svc.workdays({ from: p.from || undefined, to: p.to || undefined, divisionId: divisionId || undefined, status: status || undefined });
  }

  @Post('workdays/preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(workdaySchema)) body: z.infer<typeof workdaySchema>, @Query('id') id?: string) {
    return this.svc.previewWorkday(body, id || undefined);
  }

  @Get('workdays/:id')
  workday(@Param('id') id: string) {
    return this.svc.workday(id);
  }

  @Post('workdays')
  createWorkday(@Body(new ZodPipe(workdaySchema)) body: z.infer<typeof workdaySchema>) {
    return this.svc.saveWorkday(null, body);
  }

  @Put('workdays/:id')
  updateWorkday(@Param('id') id: string, @Body(new ZodPipe(workdaySchema)) body: z.infer<typeof workdaySchema>) {
    return this.svc.saveWorkday(id, body);
  }

  @Post('workdays/:id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string) {
    return this.svc.approveWorkday(id);
  }

  @Post('workdays/:id/cancel')
  @HttpCode(200)
  cancelWorkday(@Param('id') id: string) {
    return this.svc.cancelWorkday(id);
  }

  // ----- FFB transport notes (SPB) and weighbridge
  @Get('dispatches')
  dispatches(@Query('from') from?: string, @Query('to') to?: string, @Query('siteId') siteId?: string, @Query('status') status?: string) {
    const p = period({ from, to });
    return this.svc.dispatches({ from: p.from || undefined, to: p.to || undefined, siteId: siteId || undefined, status: status || undefined });
  }

  @Get('dispatches/:id')
  dispatch(@Param('id') id: string) {
    return this.svc.dispatch(id);
  }

  @Post('dispatches')
  createDispatch(@Body(new ZodPipe(dispatchSchema)) body: z.infer<typeof dispatchSchema>) {
    return this.svc.saveDispatch(null, body);
  }

  @Put('dispatches/:id')
  updateDispatch(@Param('id') id: string, @Body(new ZodPipe(dispatchSchema)) body: z.infer<typeof dispatchSchema>) {
    return this.svc.saveDispatch(id, body);
  }

  @Post('dispatches/:id/weigh')
  @HttpCode(200)
  weigh(@Param('id') id: string, @Body(new ZodPipe(weighSchema)) body: z.infer<typeof weighSchema>) {
    return this.svc.weighDispatch(id, body);
  }

  @Post('dispatches/:id/cancel')
  @HttpCode(200)
  cancelDispatch(@Param('id') id: string) {
    return this.svc.cancelDispatch(id);
  }

  // ----- reports
  @Get('production')
  production(@Query('from') from: string, @Query('to') to: string, @Query('siteId') siteId?: string, @Query('divisionId') divisionId?: string) {
    const p = period({ from, to });
    return this.svc.production({ ...p, siteId: siteId || undefined, divisionId: divisionId || undefined });
  }

  @Get('checkroll')
  checkroll(@Query('from') from: string, @Query('to') to: string, @Query('divisionId') divisionId?: string) {
    const p = period({ from, to });
    return this.svc.checkroll({ ...p, divisionId: divisionId || undefined });
  }
}
