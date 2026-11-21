import { HotelController } from './hotel.controller';
import { HotelService } from './hotel.service';

/** Hotel: rooms, reservations, folios, night audit, PBJT, APOA list (registered in app.module.ts). */
export const HOTEL_CONTROLLERS: any[] = [HotelController];
export const HOTEL_PROVIDERS: any[] = [HotelService];
