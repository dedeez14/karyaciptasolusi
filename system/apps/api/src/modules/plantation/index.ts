import { PlantationController } from './plantation.controller';
import { PlantationService } from './plantation.service';

/** Plantations: blocks, daily work book (BKM / checkroll), FFB transport notes and weighbridge (registered in app.module.ts). */
export const PLANTATION_CONTROLLERS: any[] = [PlantationController];
export const PLANTATION_PROVIDERS: any[] = [PlantationService];
