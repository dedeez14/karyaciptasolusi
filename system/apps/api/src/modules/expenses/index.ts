import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';

/** Controllers and providers of the expenses module (registered in app.module.ts). */
export const EXPENSES_CONTROLLERS: any[] = [ExpenseController];
export const EXPENSES_PROVIDERS: any[] = [ExpenseService];
