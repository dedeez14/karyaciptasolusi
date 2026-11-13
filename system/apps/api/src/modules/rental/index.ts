import { RentalController } from './rental.controller';
import { RentalService } from './rental.service';

/** Equipment rental: units and rates, contracts, handover and return with meters, billing, deposits (registered in app.module.ts). */
export const RENTAL_CONTROLLERS: any[] = [RentalController];
export const RENTAL_PROVIDERS: any[] = [RentalService];
