import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { GarmentService, laySchema, orderSchema, outputSchema, receiveSchema, styleSchema } from './garment.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const matrixBody = orderSchema.pick({ matrix: true });

@Controller('garment')
export class GarmentController {
  constructor(private readonly svc: GarmentService) {}

  @Get('lists')
  lists() {
    return this.svc.lists();
  }

  // ----- styles
  @Get('styles')
  styles() {
    return this.svc.styles();
  }

  @Get('styles/:id')
  style(@Param('id') id: string) {
    return this.svc.style(id);
  }

  @Post('styles')
  createStyle(@Body(new ZodPipe(styleSchema)) body: z.infer<typeof styleSchema>) {
    return this.svc.saveStyle(null, body);
  }

  @Put('styles/:id')
  updateStyle(@Param('id') id: string, @Body(new ZodPipe(styleSchema)) body: z.infer<typeof styleSchema>) {
    return this.svc.saveStyle(id, body);
  }

  // ----- orders
  @Get('orders')
  orders(@Query('status') status?: string, @Query('styleId') styleId?: string) {
    return this.svc.orders({ status: status || undefined, styleId: styleId || undefined });
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.svc.order(id);
  }

  @Post('orders')
  createOrder(@Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    return this.svc.createOrder(body);
  }

  @Put('orders/:id/matrix')
  matrix(@Param('id') id: string, @Body(new ZodPipe(matrixBody)) body: z.infer<typeof matrixBody>) {
    return this.svc.updateMatrix(id, body.matrix);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancelOrder(id);
  }

  @Post('orders/:id/close')
  @HttpCode(200)
  close(@Param('id') id: string) {
    return this.svc.closeOrder(id);
  }

  @Post('orders/:id/reopen')
  @HttpCode(200)
  reopen(@Param('id') id: string) {
    return this.svc.reopenOrder(id);
  }

  @Post('orders/:id/sales-order')
  salesOrder(@Param('id') id: string) {
    return this.svc.salesOrder(id);
  }

  @Post('orders/:id/lays')
  addLay(@Param('id') id: string, @Body(new ZodPipe(laySchema)) body: z.infer<typeof laySchema>) {
    return this.svc.addLay(id, body);
  }

  @Post('lays/:id/cancel')
  @HttpCode(200)
  cancelLay(@Param('id') id: string) {
    return this.svc.cancelLay(id);
  }

  @Post('orders/:id/outputs')
  addOutput(@Param('id') id: string, @Body(new ZodPipe(outputSchema)) body: z.infer<typeof outputSchema>) {
    return this.svc.addOutput(id, body);
  }

  @Delete('outputs/:id')
  deleteOutput(@Param('id') id: string) {
    return this.svc.deleteOutput(id);
  }

  @Post('orders/:id/receipts')
  receive(@Param('id') id: string, @Body(new ZodPipe(receiveSchema)) body: z.infer<typeof receiveSchema>) {
    return this.svc.receive(id, body);
  }

  @Post('receipts/:id/cancel')
  @HttpCode(200)
  cancelReceipt(@Param('id') id: string) {
    return this.svc.cancelReceipt(id);
  }

  @Get('efficiency')
  efficiency(@Query('from') from?: string, @Query('to') to?: string, @Query('lineId') lineId?: string) {
    if (!DAY.test(from ?? '') || !DAY.test(to ?? '')) throw new BadRequestException('Choose a valid period');
    return this.svc.efficiency({ from: from!, to: to!, lineId: lineId || undefined });
  }
}
