import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';

/** Herd: cattle / dairy / small ruminants by head (registered in app.module.ts). */
export const HERD_CONTROLLERS: any[] = [HerdController];
export const HERD_PROVIDERS: any[] = [HerdService];
