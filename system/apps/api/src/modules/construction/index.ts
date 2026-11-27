import { ConstructionController } from './construction.controller';
import { ConstructionService } from './construction.service';

/** Construction: contracts, BoQ, certificates, handover, subcontracts, PPh final 4(2) (registered in app.module.ts). */
export const CONSTRUCTION_CONTROLLERS: any[] = [ConstructionController];
export const CONSTRUCTION_PROVIDERS: any[] = [ConstructionService];
