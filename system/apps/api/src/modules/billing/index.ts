import { BillingController } from './billing.controller';
import { InstalmentController } from './instalment.controller';
import { InstalmentService } from './instalment.service';
import { BillingScheduler } from './billing.scheduler';
import { ReminderService } from './reminder.service';
import { SubscriptionService } from './subscription.service';

/** Controllers and providers of the billing module (registered in app.module.ts). */
export const BILLING_CONTROLLERS: any[] = [BillingController, InstalmentController];
export const BILLING_PROVIDERS: any[] = [SubscriptionService, ReminderService, InstalmentService, BillingScheduler];
