import { TimeBillingController } from './timebilling.controller';
import { TimesheetService } from './timesheet.service';
import { TimeBillingService } from './time-billing.service';

/** Controllers and providers of the timebilling module (registered in app.module.ts). */
export const TIMEBILLING_CONTROLLERS: any[] = [TimeBillingController];
export const TIMEBILLING_PROVIDERS: any[] = [TimesheetService, TimeBillingService];
