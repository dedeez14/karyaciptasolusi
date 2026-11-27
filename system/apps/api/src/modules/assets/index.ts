import { AssetController } from './asset.controller';
import { AssetScheduler } from './asset.scheduler';
import { AssetService } from './asset.service';

/** Controllers and providers of the assets module (registered in app.module.ts). */
export const ASSETS_CONTROLLERS: any[] = [AssetController];
export const ASSETS_PROVIDERS: any[] = [AssetService, AssetScheduler];
