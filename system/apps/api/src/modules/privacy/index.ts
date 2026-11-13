import { PrivacyController, PrivacyScheduler } from './privacy.controller';
import { PrivacyService } from './privacy.service';

/** UU 27/2022 Pelindungan Data Pribadi: personal data export, anonymisation and retention (registered in app.module.ts). */
export const PRIVACY_CONTROLLERS: any[] = [PrivacyController];
export const PRIVACY_PROVIDERS: any[] = [PrivacyService, PrivacyScheduler];
