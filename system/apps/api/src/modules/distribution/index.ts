import { DistributionController } from './distribution.controller';
import { DistributionService } from './distribution.service';

/** Distribution: routes, journey plan, visits, van sales, collections, van settlement, credit control (registered in app.module.ts). */
export const DISTRIBUTION_CONTROLLERS: any[] = [DistributionController];
export const DISTRIBUTION_PROVIDERS: any[] = [DistributionService];
