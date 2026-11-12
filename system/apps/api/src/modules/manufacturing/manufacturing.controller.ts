import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { MrpService, plannedWoSchema } from './mrp.service';
import { bomSchema, completeSchema, finishOpSchema, issueSchema, ManufacturingService, workOrderSchema } from './manufacturing.service';

@Controller('manufacturing')
export class ManufacturingController {
  constructor(
    private readonly mfg: ManufacturingService,
    private readonly mrp: MrpService,
  ) {}

  @Get('mrp')
  runMrp(@Query('warehouseId') warehouseId?: string) {
    return this.mrp.run(warehouseId);
  }

  @Post('mrp/work-orders')
  @HttpCode(200)
  plannedOrders(@Body(new ZodPipe(plannedWoSchema)) body: z.infer<typeof plannedWoSchema>) {
    return this.mrp.createWorkOrders(body);
  }

  @Get('boms')
  boms() {
    return this.mfg.listBoms();
  }

  @Get('boms/:id')
  bom(@Param('id') id: string) {
    return this.mfg.getBom(id);
  }

  @Post('boms')
  createBom(@Body(new ZodPipe(bomSchema)) body: z.infer<typeof bomSchema>) {
    return this.mfg.saveBom(null, body);
  }

  @Patch('boms/:id')
  updateBom(@Param('id') id: string, @Body(new ZodPipe(bomSchema)) body: z.infer<typeof bomSchema>) {
    return this.mfg.saveBom(id, body);
  }

  @Delete('boms/:id')
  deleteBom(@Param('id') id: string) {
    return this.mfg.deleteBom(id);
  }

  @Get('orders')
  orders(@Query('status') status?: string) {
    return this.mfg.listOrders(status || undefined);
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.mfg.getOrder(id);
  }

  @Post('orders')
  createOrder(@Body(new ZodPipe(workOrderSchema)) body: z.infer<typeof workOrderSchema>) {
    return this.mfg.createOrder(body);
  }

  @Post('orders/:id/release')
  @HttpCode(200)
  release(@Param('id') id: string) {
    return this.mfg.release(id);
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string, @Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>) {
    return this.mfg.complete(id, body);
  }

  @Post('orders/:id/issue')
  @HttpCode(200)
  issue(@Param('id') id: string, @Body(new ZodPipe(issueSchema)) body: z.infer<typeof issueSchema>) {
    return this.mfg.issue(id, body);
  }

  @Post('orders/:id/sub-orders')
  @HttpCode(200)
  subOrders(@Param('id') id: string) {
    return this.mfg.createSubOrders(id);
  }

  @Get('shop-floor')
  shopFloor(@Query('workCenterId') workCenterId?: string) {
    return this.mfg.shopFloor(workCenterId);
  }

  @Post('operations/:id/start')
  @HttpCode(200)
  start(@Param('id') id: string) {
    return this.mfg.startOperation(id);
  }

  @Post('operations/:id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string) {
    return this.mfg.pauseOperation(id);
  }

  @Post('operations/:id/finish')
  @HttpCode(200)
  finish(@Param('id') id: string, @Body(new ZodPipe(finishOpSchema)) body: z.infer<typeof finishOpSchema>) {
    return this.mfg.finishOperation(id, body);
  }

  @Get('capacity')
  capacity(@Query('month') month?: string) {
    return this.mfg.capacity(month ?? '');
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.mfg.cancel(id);
  }

  @Get('production-summary')
  summary(@Query('year') year: string, @Query('quarter') quarter: string) {
    const y = Number(year) || new Date().getFullYear();
    const q = Math.min(4, Math.max(1, Number(quarter) || Math.floor(new Date().getMonth() / 3) + 1));
    return this.mfg.productionSummary(y, q);
  }
}
