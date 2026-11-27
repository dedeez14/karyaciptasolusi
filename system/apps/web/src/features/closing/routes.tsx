import { lazy, type ReactNode } from 'react';

const YearEndPage = lazy(() => import('./YearEndPage'));

/** Authenticated routes of the closing module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [{ path: 'accounting/year-end', element: <YearEndPage /> }];
