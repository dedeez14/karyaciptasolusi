import { lazy, type ReactNode } from 'react';

const DocumentCenterPage = lazy(() => import('./DocumentCenterPage'));

/** Authenticated routes of the document center, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [{ path: 'document-center', element: <DocumentCenterPage /> }];
