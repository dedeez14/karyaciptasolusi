import { BillingController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { ReminderService } from './reminder.service';
import { SubscriptionService } from './subscription.service';

/** Controllers and providers of the billing module (registered in app.module.ts). */
export const BILLING_CONTROLLERS: any[] = [BillingController];
export const BILLING_PROVIDERS: any[] = [SubscriptionService, ReminderService, BillingScheduler];
