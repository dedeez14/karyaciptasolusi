import { CommodityController } from './commodity.controller';
import { CommodityService } from './commodity.service';

/** Bulk commodity sales (CPO, kernel): contracts, deliveries with quality claims, export shipments (registered in app.module.ts). */
export const COMMODITY_CONTROLLERS: any[] = [CommodityController];
export const COMMODITY_PROVIDERS: any[] = [CommodityService];
