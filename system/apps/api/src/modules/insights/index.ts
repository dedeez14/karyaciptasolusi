import { InsightsController } from './insights.controller';
import { FinanceInsightsService } from './finance.insights';
import { CommercialInsightsService } from './commercial.insights';
import { HrInsightsService } from './hr.insights';

/** Read-only endpoints behind the purpose-built master data views (360 pages, trees, calendars). */
export const INSIGHTS_CONTROLLERS: any[] = [InsightsController];
export const INSIGHTS_PROVIDERS: any[] = [FinanceInsightsService, CommercialInsightsService, HrInsightsService];
