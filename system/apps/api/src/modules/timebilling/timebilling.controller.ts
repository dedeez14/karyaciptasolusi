import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { TimesheetService } from './timesheet.service';
import { TimeBillingService } from './time-billing.service';

const optUser = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional());
const weekSchema = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), userId: optUser });
const cellSchema = z.object({
  taskId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.coerce.number().min(0).max(24),
  userId: optUser.nullable(),
  billable: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
const entrySchema = z.object({ billable: z.boolean().optional(), note: z.string().trim().max(500).nullable().optional() });
const invoiceSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), keys: z.array(z.string().max(80)).max(500).nullable().optional() });

@Controller()
export class TimeBillingController {
  constructor(
    private readonly timesheets: TimesheetService,
    private readonly billing: TimeBillingService,
  ) {}

  @Get('timesheets/week')
  week(@Query(new ZodPipe(weekSchema)) q: z.infer<typeof weekSchema>) {
    return this.timesheets.week(q);
  }

  @Get('timesheets/users')
  users() {
    return this.timesheets.users();
  }

  @Put('timesheets/cell')
  cell(@Body(new ZodPipe(cellSchema)) body: z.infer<typeof cellSchema>) {
    return this.timesheets.setCell(body);
  }

  @Patch('timesheets/entries/:id')
  entry(@Param('id') id: string, @Body(new ZodPipe(entrySchema)) body: z.infer<typeof entrySchema>) {
    return this.timesheets.updateEntry(id, body);
  }

  @Get('time-billing/projects/:id')
  summary(@Param('id') id: string) {
    return this.billing.summary(id);
  }

  @Activity('project.bill-time')
  @Post('time-billing/projects/:id/invoice')
  invoice(@Param('id') id: string, @Body(new ZodPipe(invoiceSchema)) body: z.infer<typeof invoiceSchema>) {
    return this.billing.invoice(id, body);
  }
}
