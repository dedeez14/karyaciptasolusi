import { CartonController } from './carton.controller';
import { CartonService } from './carton.service';

/** Carton / corrugated box add-on: board grades, box specs, estimates, trim planning, plates and dies (registered in app.module.ts). */
export const CARTON_CONTROLLERS: any[] = [CartonController];
export const CARTON_PROVIDERS: any[] = [CartonService];
