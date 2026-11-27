import { lazy, type ReactNode } from 'react';

const ExpenseListPage = lazy(() => import('./ExpenseListPage'));
const ExpenseFormPage = lazy(() => import('./ExpenseFormPage'));
const ExpenseViewPage = lazy(() => import('./ExpenseViewPage'));

/** Authenticated routes of the expenses module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'expenses', element: <ExpenseListPage /> },
  { path: 'expenses/new', element: <ExpenseFormPage /> },
  { path: 'expenses/:id', element: <ExpenseViewPage /> },
  { path: 'expenses/:id/edit', element: <ExpenseFormPage /> },
];
