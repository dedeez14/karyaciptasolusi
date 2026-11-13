import { lazy, type ReactNode } from 'react';

const BankRecListPage = lazy(() => import('./BankRecListPage'));
const BankStatementPage = lazy(() => import('./BankStatementPage'));

/** Authenticated routes of the bankrec module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'accounting/bank-reconciliation', element: <BankRecListPage /> },
  { path: 'accounting/bank-reconciliation/:id', element: <BankStatementPage /> },
];
