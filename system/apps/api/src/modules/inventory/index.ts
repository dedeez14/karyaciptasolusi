import { InventoryToolsController } from './inventory-tools.controller';
import { InventoryToolsService } from './inventory-tools.service';

/** Inventory tools: barcode lookup and labels, reorder planning, stock counts (registered in app.module.ts). */
export const INVENTORY_CONTROLLERS: any[] = [InventoryToolsController];
export const INVENTORY_PROVIDERS: any[] = [InventoryToolsService];
