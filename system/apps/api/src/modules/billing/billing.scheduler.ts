import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { SubscriptionService } from './subscription.service';
import { ReminderService } from './reminder.service';
import { forEachCompany } from './job-context';

/** Daily jobs of the billing module (server local time). Each company is processed as the audited "system" actor. */
@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger('BillingScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly subs: SubscriptionService,
    private readonly reminders: ReminderService,
    private readonly bus: NotificationBus,
  ) {}

  /** 06:00 - create invoices for subscriptions that are due */
  @Cron('0 6 * * *', { name: 'recurring-billing' })
  async recurring() {
    await forEachCompany(this.prisma, this.logger, 'recurring-billing', async (companyId) => {
      if (!(await this.settings.bool('sales.recurringAutoRun', companyId, true))) return null;
      const r = await this.subs.runDue();
      if (r.created) this.bus.emit(companyId);
      return r.processed ? `${r.created} invoice(s) created, ${r.failed} failed` : null;
    });
  }

  /** 08:00 - e-mail overdue invoice reminders */
  @Cron('0 8 * * *', { name: 'invoice-reminders' })
  async overdueReminders() {
    await forEachCompany(this.prisma, this.logger, 'invoice-reminders', async () => {
      const r = await this.reminders.run(false);
      return r.sent || r.failed ? `${r.sent} reminder(s) sent, ${r.failed} failed` : null;
    });
  }
}
