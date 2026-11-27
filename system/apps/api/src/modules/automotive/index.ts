import { AutomotiveController } from './automotive.controller';
import { AutomotiveService } from './automotive.service';

/** Automotive add-on: vehicle types, VIN register, SRUT, PPnBM, on-the-road price (registered in app.module.ts). */
export const AUTOMOTIVE_CONTROLLERS: any[] = [AutomotiveController];
export const AUTOMOTIVE_PROVIDERS: any[] = [AutomotiveService];
