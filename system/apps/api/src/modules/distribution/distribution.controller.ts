import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { checkInSchema, collectSchema, DistributionService, noOrderSchema, orderSchema, routeSchema, settleSchema, vanSaleSchema } from './distribution.service';
import { claimSchema, SchemeService, schemeSchema } from './schemes.service';

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

@Controller('distribution')
export class DistributionController {
  constructor(
    private readonly svc: DistributionService,
    private readonly schemes: SchemeService,
  ) {}

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

  @Get('schemes')
  schemeList() {
    return this.schemes.schemes();
  }

  @Post('schemes')
  createScheme(@Body(new ZodPipe(schemeSchema)) body: z.infer<typeof schemeSchema>) {
    return this.schemes.saveScheme(null, body);
  }

  @Put('schemes/:id')
  updateScheme(@Param('id') id: string, @Body(new ZodPipe(schemeSchema)) body: z.infer<typeof schemeSchema>) {
    return this.schemes.saveScheme(id, body);
  }

  @Get('gifts')
  gifts(@Query('status') status?: string) {
    return this.schemes.gifts(status || undefined);
  }

  @Post('gifts/:id/deliver')
  @HttpCode(200)
  deliverGift(@Param('id') id: string, @Body() body: { warehouseId?: string }) {
    if (!UUID.test(body?.warehouseId ?? '')) throw new BadRequestException('Choose the warehouse');
    return this.schemes.deliverGift(id, body.warehouseId!);
  }

  @Post('gifts/:id/cancel')
  @HttpCode(200)
  cancelGift(@Param('id') id: string) {
    return this.schemes.cancelGift(id);
  }

  @Get('claims/claimable')
  claimable(@Query('from') from?: string, @Query('to') to?: string) {
    return this.schemes.claimable(DAY.test(from ?? '') ? from! : today().slice(0, 8) + '01', DAY.test(to ?? '') ? to! : today());
  }

  @Get('claims')
  claims() {
    return this.schemes.claims();
  }

  @Post('claims')
  createClaim(@Body(new ZodPipe(claimSchema)) body: z.infer<typeof claimSchema>) {
    return this.schemes.createClaim(body);
  }

  @Post('claims/:id/cancel')
  @HttpCode(200)
  cancelClaim(@Param('id') id: string) {
    return this.schemes.cancelClaim(id);
  }
}
