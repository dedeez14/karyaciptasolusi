import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplacePostingService } from './marketplace-posting.service';

/**
 * Marketplace: stores on Gumroad / Etsy / Shopee / Tokopedia... and social channels, orders from the API or files,
 * settlements (invoice + receipt into the marketplace balance + fees and refunds), payouts and channel statistics
 * (registered in app.module.ts).
 */
export const MARKETPLACE_CONTROLLERS: any[] = [MarketplaceController];
export const MARKETPLACE_PROVIDERS: any[] = [MarketplaceService, MarketplacePostingService];
