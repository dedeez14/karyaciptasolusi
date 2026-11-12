import type { ResourceUi } from './types';
import { hrUi } from './hr';
import { financeUi } from './finance';
import { commercialUi } from './commercial';
import { generalUi } from './general';
import { websiteUi } from './website';

/**
 * Purpose-built UI per resource key (see ResourceUi). Resources without an entry use the generic table.
 * Grouped by area so each file stays small: hr.tsx, finance.tsx, commercial.tsx (CRM, sales, purchase, inventory, projects), general.tsx.
 */
export const RESOURCE_UI: Record<string, ResourceUi> = { ...generalUi, ...hrUi, ...financeUi, ...commercialUi, ...websiteUi };
