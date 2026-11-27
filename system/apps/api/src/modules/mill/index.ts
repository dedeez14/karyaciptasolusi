import { MillController } from './mill.controller';
import { MillService } from './mill.service';

/** Palm oil mill: bought fruit, TBS price board, tanks, daily processing report (registered in app.module.ts). */
export const MILL_CONTROLLERS: any[] = [MillController];
export const MILL_PROVIDERS: any[] = [MillService];
