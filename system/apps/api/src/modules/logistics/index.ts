import { LogisticsController } from './logistics.controller';
import { LogisticsService } from './logistics.service';

/** Logistics: fleet, drivers, rate cards, jobs / waybills, trips, POD, invoicing, job costing (registered in app.module.ts). */
export const LOGISTICS_CONTROLLERS: any[] = [LogisticsController];
export const LOGISTICS_PROVIDERS: any[] = [LogisticsService];
