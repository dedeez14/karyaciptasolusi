import { PaintController } from './paint.controller';
import { PaintService } from './paint.service';

/** Paint add-on: colours, tint formulas, shop tinting, colour lab, CoA, SDS / GHS (registered in app.module.ts). */
export const PAINT_CONTROLLERS: any[] = [PaintController];
export const PAINT_PROVIDERS: any[] = [PaintService];
