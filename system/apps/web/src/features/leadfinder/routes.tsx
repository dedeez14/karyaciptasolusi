import { lazy, type ReactNode } from 'react';

const LeadFinderPage = lazy(() => import('./LeadFinderPage'));
const JobPage = lazy(() => import('./JobPage'));

/** Authenticated routes of the leadfinder module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'crm/lead-finder', element: <LeadFinderPage /> },
  { path: 'crm/lead-finder/:id', element: <JobPage /> },
];
