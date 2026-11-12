import { FarmController } from './farm.controller';
import { FarmService } from './farm.service';
import { PartnershipService } from './partnership.service';

/** Farm: livestock / aquaculture cycles and inti-plasma partnership (registered in app.module.ts). */
export const FARM_CONTROLLERS: any[] = [FarmController];
export const FARM_PROVIDERS: any[] = [FarmService, PartnershipService];
