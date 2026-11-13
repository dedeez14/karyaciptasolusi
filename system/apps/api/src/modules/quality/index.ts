import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

/** Quality control: inspection plans, inspections and lot release, non-conformances (registered in app.module.ts). */
export const QUALITY_CONTROLLERS: any[] = [QualityController];
export const QUALITY_PROVIDERS: any[] = [QualityService];
