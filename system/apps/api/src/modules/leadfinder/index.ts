import { LeadFinderController } from './leadfinder.controller';
import { LeadFinderService } from './leadfinder.service';
import { PlaceImportService } from './place-import.service';
import { ScraperRunnerService } from './scraper-runner.service';

/** Controllers and providers of the leadfinder module (registered in app.module.ts). */
export const LEADFINDER_CONTROLLERS: any[] = [LeadFinderController];
export const LEADFINDER_PROVIDERS: any[] = [PlaceImportService, ScraperRunnerService, LeadFinderService];
