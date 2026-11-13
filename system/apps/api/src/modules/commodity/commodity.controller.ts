import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { CommodityService, contractSchema, deliverySchema, dheSchema, invoiceSchema, referenceSchema, shipmentSchema, shipSchema } from './commodity.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v?: string) => (v && DAY.test(v) ? v : undefined);
const statusBody = z.object({ status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']) });
const previewBody = z.object({ qtyKg: z.coerce.number().positive().max(1e9), ffa: z.coerce.number().min(0).max(100).nullable().optional(), mi: z.coerce.number().min(0).max(100).nullable().optional(), dobi: z.coerce.number().min(0).max(10).nullable().optional() });

@Controller('commodity')
export class CommodityController {
  constructor(private readonly svc: CommodityService) {}

  // ----- contracts
  @Get('contracts')
  contracts(@Query('status') status?: string, @Query('market') market?: string) {
    return this.svc.contracts({ status: status || undefined, market: market || undefined });
  }

  @Get('contracts/:id')
  contract(@Param('id') id: string) {
    return this.svc.contract(id);
  }

  @Post('contracts')
  create(@Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(null, body);
  }

  @Put('contracts/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(id, body);
  }

  @Post('contracts/:id/status')
  @HttpCode(200)
  status(@Param('id') id: string, @Body(new ZodPipe(statusBody)) body: z.infer<typeof statusBody>) {
    return this.svc.setStatus(id, body.status);
  }

  @Post('contracts/:id/preview')
  @HttpCode(200)
  preview(@Param('id') id: string, @Body(new ZodPipe(previewBody)) body: z.infer<typeof previewBody>) {
    return this.svc.previewDelivery(id, body);
  }

  @Post('contracts/:id/deliveries')
  deliver(@Param('id') id: string, @Body(new ZodPipe(deliverySchema)) body: z.infer<typeof deliverySchema>) {
    return this.svc.createDelivery(id, body);
  }

  @Post('contracts/:id/invoice')
  invoice(@Param('id') id: string, @Body(new ZodPipe(invoiceSchema)) body: z.infer<typeof invoiceSchema>) {
    return this.svc.invoice(id, body);
  }

  @Post('deliveries/:id/cancel')
  @HttpCode(200)
  cancelDelivery(@Param('id') id: string) {
    return this.svc.cancelDelivery(id);
  }

  // ----- export
  @Get('references')
  references(@Query('productId') productId?: string) {
    return this.svc.references(productId || undefined);
  }

  @Post('references')
  saveReference(@Body(new ZodPipe(referenceSchema)) body: z.infer<typeof referenceSchema>) {
    return this.svc.saveReference(body);
  }

  @Delete('references/:id')
  deleteReference(@Param('id') id: string) {
    return this.svc.deleteReference(id);
  }

  @Get('shipments')
  shipments(@Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string) {
    return this.svc.shipments({ from: day(from), to: day(to), status: status || undefined });
  }

  @Get('shipments/:id')
  shipment(@Param('id') id: string) {
    return this.svc.shipment(id);
  }

  @Post('shipments')
  createShipment(@Body(new ZodPipe(shipmentSchema)) body: z.infer<typeof shipmentSchema>) {
    return this.svc.saveShipment(null, body);
  }

  @Put('shipments/:id')
  updateShipment(@Param('id') id: string, @Body(new ZodPipe(shipmentSchema)) body: z.infer<typeof shipmentSchema>) {
    return this.svc.saveShipment(id, body);
  }

  @Post('shipments/:id/ship')
  @HttpCode(200)
  ship(@Param('id') id: string, @Body(new ZodPipe(shipSchema)) body: z.infer<typeof shipSchema>) {
    return this.svc.ship(id, body);
  }

  @Post('shipments/:id/unship')
  @HttpCode(200)
  unship(@Param('id') id: string) {
    return this.svc.unship(id);
  }

  @Post('shipments/:id/cancel')
  @HttpCode(200)
  cancelShipment(@Param('id') id: string) {
    return this.svc.cancelShipment(id);
  }

  @Put('shipments/:id/dhe')
  dhe(@Param('id') id: string, @Body(new ZodPipe(dheSchema)) body: z.infer<typeof dheSchema>) {
    return this.svc.recordDhe(id, body);
  }

  @Get('register')
  register(@Query('from') from?: string, @Query('to') to?: string) {
    if (!day(from) || !day(to)) throw new BadRequestException('Choose a valid period');
    return this.svc.register({ from: from!, to: to! });
  }
}
