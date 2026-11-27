import { BondedController } from './bonded.controller';
import { BondedService } from './bonded.service';

/** Bonded zone (KB) / KITE add-on: customs documents, IT Inventory reports, domestic quota, KITE accountability (registered in app.module.ts). */
export const BONDED_CONTROLLERS: any[] = [BondedController];
export const BONDED_PROVIDERS: any[] = [BondedService];
