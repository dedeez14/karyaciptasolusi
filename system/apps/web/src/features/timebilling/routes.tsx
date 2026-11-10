import { lazy, type ReactNode } from 'react';

const TimesheetPage = lazy(() => import('./TimesheetPage'));

/** Authenticated routes of the timebilling module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [{ path: 'tasks/timesheets', element: <TimesheetPage /> }];
