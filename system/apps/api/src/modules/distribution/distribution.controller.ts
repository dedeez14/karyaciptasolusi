import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { checkInSchema, collectSchema, DistributionService, noOrderSchema, orderSchema, routeSchema, settleSchema, vanSaleSchema } from './distribution.service';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

@Controller('distribution')
export class DistributionController {
  constructor(private readonly svc: DistributionService) {}

  @Get('routes')
  routes() {
    return this.svc.routes();
  }

  @Get('routes/:id')
  route(@Param('id') id: string) {
    return this.svc.route(id);
  }

  @Post('routes')
  createRoute(@Body(new ZodPipe(routeSchema)) body: z.infer<typeof routeSchema>) {
    return this.svc.saveRoute(null, body);
  }

  @Put('routes/:id')
  updateRoute(@Param('id') id: string, @Body(new ZodPipe(routeSchema)) body: z.infer<typeof routeSchema>) {
    return this.svc.saveRoute(id, body);
  }

  @Get('journey')
  journey(@Query('date') date?: string, @Query('routeId') routeId?: string) {
    return this.svc.journey(DAY.test(date ?? '') ? date : undefined, UUID.test(routeId ?? '') ? routeId : undefined);
  }

  @Post('visits')
  checkIn(@Body(new ZodPipe(checkInSchema)) body: z.infer<typeof checkInSchema>) {
    return this.svc.checkIn(body);
  }

  @Get('visits')
  visits(@Query('from') from?: string, @Query('to') to?: string, @Query('routeId') routeId?: string) {
    return this.svc.visits(DAY.test(from ?? '') ? from! : today(), DAY.test(to ?? '') ? to! : today(), UUID.test(routeId ?? '') ? routeId : undefined);
  }

  @Get('visits/:id')
  visit(@Param('id') id: string) {
    return this.svc.visit(id);
  }

  @Post('visits/:id/order')
  @HttpCode(200)
  order(@Param('id') id: string, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    return this.svc.order(id, body);
  }

  @Post('visits/:id/van-sale')
  @HttpCode(200)
  vanSale(@Param('id') id: string, @Body(new ZodPipe(vanSaleSchema)) body: z.infer<typeof vanSaleSchema>) {
    return this.svc.vanSale(id, body);
  }

  @Post('visits/:id/collect')
  @HttpCode(200)
  collect(@Param('id') id: string, @Body(new ZodPipe(collectSchema)) body: z.infer<typeof collectSchema>) {
    return this.svc.collect(id, body);
  }

  @Post('visits/:id/no-order')
  @HttpCode(200)
  noOrder(@Param('id') id: string, @Body(new ZodPipe(noOrderSchema)) body: z.infer<typeof noOrderSchema>) {
    return this.svc.noOrder(id, body);
  }

  @Post('visits/:id/check-out')
  @HttpCode(200)
  checkOut(@Param('id') id: string) {
    return this.svc.checkOut(id);
  }

  @Get('credit')
  credit() {
    return this.svc.credit();
  }

  @Post('credit/:customerId/hold')
  @HttpCode(200)
  hold(@Param('customerId') id: string, @Body() body: { hold?: boolean }) {
    return this.svc.setHold(id, !!body?.hold);
  }

  @Get('settlements')
  settlements(@Query('routeId') routeId?: string) {
    return this.svc.settlements(UUID.test(routeId ?? '') ? routeId : undefined);
  }

  @Get('settlements/preview')
  preview(@Query('routeId') routeId: string, @Query('date') date?: string) {
    return this.svc.settlementPreview(routeId, DAY.test(date ?? '') ? date! : today());
  }

  @Post('settlements')
  settle(@Body(new ZodPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.svc.settle(body);
  }

  @Post('settlements/:id/void')
  @HttpCode(200)
  voidIt(@Param('id') id: string) {
    return this.svc.voidSettlement(id);
  }
}
