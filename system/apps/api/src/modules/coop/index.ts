import { CoopController } from './coop.controller';
import { CoopService } from './coop.service';

/** Cooperative: members, savings, savings interest, loans, collectibility, SHU (registered in app.module.ts). */
export const COOP_CONTROLLERS: any[] = [CoopController];
export const COOP_PROVIDERS: any[] = [CoopService];
