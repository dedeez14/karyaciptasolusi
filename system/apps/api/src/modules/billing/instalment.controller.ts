import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { InstalmentService, planSchema, scheduleSchema } from './instalment.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

@Controller('instalments')
export class InstalmentController {
  constructor(private readonly svc: InstalmentService) {}

  @Get()
  list(@Query('status') status?: string, @Query('customerId') customerId?: string) {
    return this.svc.list({ status: status || undefined, customerId: UUID.test(customerId ?? '') ? customerId : undefined });
  }

  @Get('overview')
  overview(@Query('asOf') asOf?: string) {
    return this.svc.overview(DAY.test(asOf ?? '') ? asOf : undefined);
  }

  @Post('run')
  @HttpCode(200)
  run() {
    return this.svc.runNow();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>) {
    return this.svc.create(body);
  }

  @Put(':id/schedule')
  reschedule(@Param('id') id: string, @Body(new ZodPipe(scheduleSchema)) body: z.infer<typeof scheduleSchema>) {
    return this.svc.reschedule(id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Post(':id/lines/:lineId/invoice')
  @HttpCode(200)
  bill(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.svc.billLine(id, lineId);
  }

  @Get(':id/late-fees')
  lateFees(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.svc.lateFees(id, DAY.test(asOf ?? '') ? asOf : undefined);
  }

  @Post(':id/late-fees')
  @HttpCode(200)
  charge(@Param('id') id: string, @Body() body: { asOf?: string }) {
    return this.svc.chargeLateFees(id, DAY.test(body?.asOf ?? '') ? body.asOf : undefined);
  }
}
