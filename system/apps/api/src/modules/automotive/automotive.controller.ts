import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { AutomotiveService, deliverSchema, modelSchema, registerSchema, reserveSchema, vehicleSchema } from './automotive.service';
import { checkVin } from './automotive-calc';

@Controller('automotive')
export class AutomotiveController {
  constructor(private readonly svc: AutomotiveService) {}

  @Get('meta')
  meta() {
    return this.svc.meta();
  }

  @Get('vin-check')
  vinCheck(@Query('vin') vin?: string) {
    if (!vin || vin.length > 30) throw new BadRequestException('Enter a VIN');
    return checkVin(vin);
  }

  @Post('suggest')
  @HttpCode(200)
  suggest(@Body(new ZodPipe(modelSchema)) body: z.infer<typeof modelSchema>) {
    return this.svc.suggest(body);
  }

  @Get('models')
  models() {
    return this.svc.models();
  }

  @Post('models')
  createModel(@Body(new ZodPipe(modelSchema)) body: z.infer<typeof modelSchema>) {
    return this.svc.saveModel(null, body);
  }

  @Put('models/:id')
  updateModel(@Param('id') id: string, @Body(new ZodPipe(modelSchema)) body: z.infer<typeof modelSchema>) {
    return this.svc.saveModel(id, body);
  }

  @Get('models/:id/quote')
  quote(@Param('id') id: string, @Query('price') price: string, @Query('njkb') njkb?: string, @Query('weighting') weighting?: string) {
    return this.svc.quote(id, Number(price), njkb ? Number(njkb) : null, weighting ? Math.min(2, Math.max(0.5, Number(weighting))) : 1);
  }

  @Get('vehicles')
  vehicles(@Query() q: Record<string, string>) {
    return this.svc.vehicles({ status: q.status || undefined, modelId: /^[0-9a-f-]{36}$/i.test(q.modelId ?? '') ? q.modelId : undefined, q: q.q?.slice(0, 30) || undefined, noSrut: q.noSrut === 'true' });
  }

  @Get('vehicles/:id')
  vehicle(@Param('id') id: string) {
    return this.svc.vehicle(id);
  }

  @Post('vehicles')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.svc.register(body);
  }

  @Put('vehicles/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(vehicleSchema)) body: z.infer<typeof vehicleSchema>) {
    return this.svc.update(id, body);
  }

  @Post('vehicles/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancelUnit(id);
  }

  @Post('vehicles/:id/reserve')
  @HttpCode(200)
  reserve(@Param('id') id: string, @Body(new ZodPipe(reserveSchema)) body: z.infer<typeof reserveSchema>) {
    return this.svc.reserve(id, body);
  }

  @Post('vehicles/:id/release')
  @HttpCode(200)
  release(@Param('id') id: string) {
    return this.svc.release(id);
  }

  @Post('vehicles/:id/deliver')
  @HttpCode(200)
  deliver(@Param('id') id: string, @Body(new ZodPipe(deliverSchema)) body: z.infer<typeof deliverSchema>) {
    return this.svc.deliver(id, body);
  }
}
