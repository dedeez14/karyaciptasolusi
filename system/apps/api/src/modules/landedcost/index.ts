import { LandedCostController } from './landed-cost.controller';
import { LandedCostService } from './landed-cost.service';

/** Landed costs: import duties and charges added to the cost of goods received (registered in app.module.ts). */
export const LANDED_COST_CONTROLLERS: any[] = [LandedCostController];
export const LANDED_COST_PROVIDERS: any[] = [LandedCostService];
