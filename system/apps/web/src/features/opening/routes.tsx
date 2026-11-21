import { lazy, type ReactNode } from 'react';

const OpeningBalancesPage = lazy(() => import('./OpeningBalancesPage'));

/** Authenticated routes of the opening module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [{ path: 'accounting/opening-balances', element: <OpeningBalancesPage /> }];
