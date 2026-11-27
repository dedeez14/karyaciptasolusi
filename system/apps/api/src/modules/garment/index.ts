import { GarmentController } from './garment.controller';
import { GarmentService } from './garment.service';

/** Garment add-on: styles with size / colour SKUs, cutting and bundles, sewing output, finished goods (registered in app.module.ts). */
export const GARMENT_CONTROLLERS: any[] = [GarmentController];
export const GARMENT_PROVIDERS: any[] = [GarmentService];
