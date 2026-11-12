import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** Point of sale (registered in app.module.ts). */
export const POS_CONTROLLERS: any[] = [PosController];
export const POS_PROVIDERS: any[] = [PosService];
