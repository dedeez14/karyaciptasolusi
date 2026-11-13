import { lazy, type ReactNode } from 'react';

const CashflowPage = lazy(() => import('./CashflowPage'));
const ObligationsPage = lazy(() => import('./ObligationsPage'));

/** Authenticated routes of the director pages, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'director/cashflow', element: <CashflowPage /> },
  { path: 'director/obligations', element: <ObligationsPage /> },
];
