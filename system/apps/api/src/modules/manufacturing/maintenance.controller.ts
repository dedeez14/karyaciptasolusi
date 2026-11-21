import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { completeSchema, downtimeSchema, MaintenanceService, orderSchema, planSchema } from './maintenance.service';

const range = (from?: string, to?: string) => {
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(new Date(to).getTime() + 86_400_000) : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(from) : new Date(t.getTime() - 30 * 86_400_000);
  return [f, to ? t : new Date(t.getTime() + 86_400_000)] as const;
};

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly mnt: MaintenanceService) {}

  @Get('plans')
  plans() {
    return this.mnt.plans();
  }

  @Post('plans')
  createPlan(@Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.mnt.savePlan(null, body);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.mnt.savePlan(id, body);
  }

  @Post('plans/generate')
  @HttpCode(200)
  generate() {
    RequestCtx.assert('maintenance.order.manage');
    return this.mnt.generateDue();
  }

  @Get('orders')
  orders(@Query('status') status?: string) {
    return this.mnt.orders(status || undefined);
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.mnt.order(id);
  }

  @Post('orders')
  create(@Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>) {
    return this.mnt.createOrder(body);
  }

  @Post('orders/:id/start')
  @HttpCode(200)
  start(@Param('id') id: string) {
    return this.mnt.start(id);
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  complete(@Param('id') id: string, @Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>) {
    return this.mnt.complete(id, body);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.mnt.cancel(id);
  }

  @Post('equipment/:id/counter')
  @HttpCode(200)
  counter(@Param('id') id: string, @Body(new ZodPipe(z.object({ value: z.coerce.number().min(0).max(1e12) }))) body: { value: number }) {
    return this.mnt.setCounter(id, body.value);
  }

  @Get('downtime')
  downtime(@Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    return this.mnt.downtime(f, t);
  }

  @Post('downtime')
  addDowntime(@Body(new ZodPipe(downtimeSchema)) body: z.infer<typeof downtimeSchema>) {
    return this.mnt.addDowntime(body);
  }

  @Post('downtime/:id/end')
  @HttpCode(200)
  endDowntime(@Param('id') id: string) {
    return this.mnt.endDowntime(id);
  }

  @Get('oee')
  oee(@Query('from') from?: string, @Query('to') to?: string) {
    const [f, t] = range(from, to);
    return this.mnt.oee(f, t);
  }

  @Get('inspections-due')
  inspectionsDue() {
    return this.mnt.inspectionsDue();
  }
}
