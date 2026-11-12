import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';

/** Manufacturing: bills of materials, work orders, production costing (registered in app.module.ts). */
export const MANUFACTURING_CONTROLLERS: any[] = [ManufacturingController];
export const MANUFACTURING_PROVIDERS: any[] = [ManufacturingService];
