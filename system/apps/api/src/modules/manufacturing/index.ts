import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';
import { MrpService } from './mrp.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

/** Manufacturing: bills of materials, work orders, production costing (registered in app.module.ts). */
export const MANUFACTURING_CONTROLLERS: any[] = [ManufacturingController, MaintenanceController];
export const MANUFACTURING_PROVIDERS: any[] = [ManufacturingService, MrpService, MaintenanceService];
