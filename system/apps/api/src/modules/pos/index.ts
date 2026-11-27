import { PosController, PosGuestController } from './pos.controller';
import { PosSelfOrderService } from './pos-selforder.service';
import { PosService } from './pos.service';
import { PosKitchenService } from './pos-kitchen.service';
import { PosSetupService } from './pos-setup.service';
import { PosBus } from './pos-bus';

/** Point of sale (registered in app.module.ts). */
export const POS_CONTROLLERS: any[] = [PosController, PosGuestController];
export const POS_PROVIDERS: any[] = [PosBus, PosService, PosKitchenService, PosSetupService, PosSelfOrderService];
