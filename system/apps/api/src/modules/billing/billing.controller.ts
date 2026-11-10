import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { SubscriptionService } from './subscription.service';
import { ReminderService } from './reminder.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'DUE', 'PAUSED', 'ENDED']).optional(),
  customerId: z.uuid().optional(),
});
const reminderListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
});

@Controller('billing')
export class BillingController {
  constructor(
    private readonly subs: SubscriptionService,
    private readonly reminders: ReminderService,
  ) {}

  @Get('subscriptions')
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.subs.list(q);
  }

  @Activity('billing.run-due')
  @Post('subscriptions/run-due')
  runDue() {
    return this.subs.runDueForUser();
  }

  @Get('subscriptions/:id')
  get(@Param('id') id: string) {
    return this.subs.get(id);
  }

  @Post('subscriptions')
  create(@Body() body: unknown) {
    return this.subs.create(body);
  }

  @Patch('subscriptions/:id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.subs.update(id, body);
  }

  @Post('subscriptions/:id/pause')
  pause(@Param('id') id: string) {
    return this.subs.setActive(id, false);
  }

  @Post('subscriptions/:id/resume')
  resume(@Param('id') id: string) {
    return this.subs.setActive(id, true);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subs.remove(id);
  }

  @Activity('billing.run')
  @Post('subscriptions/:id/run')
  run(@Param('id') id: string) {
    return this.subs.runOne(id);
  }

  @Get('reminders')
  reminderLog(
    @Query(new ZodPipe(reminderListSchema))
    q: z.infer<typeof reminderListSchema>,
  ) {
    return this.reminders.list(q);
  }

  @Activity('billing.reminders')
  @Post('reminders/run')
  sendReminders() {
    return this.reminders.runForUser();
  }
}
