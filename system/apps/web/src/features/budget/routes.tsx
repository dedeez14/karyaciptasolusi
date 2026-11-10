import { lazy, type ReactNode } from 'react';

const BudgetListPage = lazy(() => import('./BudgetListPage'));
const BudgetPage = lazy(() => import('./BudgetPage'));

/** Authenticated routes of the budget module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'budgets', element: <BudgetListPage /> },
  { path: 'budgets/:id', element: <BudgetPage /> },
];
