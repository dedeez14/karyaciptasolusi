import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

/** Controllers and providers of the budget module (registered in app.module.ts). */
export const BUDGET_CONTROLLERS: any[] = [BudgetController];
export const BUDGET_PROVIDERS: any[] = [BudgetService];
