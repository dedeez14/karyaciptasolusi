import { TicketController } from './ticket.controller';
import { TicketService } from './ticket.service';

/** Controllers and providers of the helpdesk module (registered in app.module.ts). */
export const HELPDESK_CONTROLLERS: any[] = [TicketController];
export const HELPDESK_PROVIDERS: any[] = [TicketService];
