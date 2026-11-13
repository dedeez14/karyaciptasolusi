import { lazy, type ReactNode } from 'react';

const AssetListPage = lazy(() => import('./AssetListPage'));
const AssetViewPage = lazy(() => import('./AssetViewPage'));

/** Authenticated routes of the assets module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'assets', element: <AssetListPage /> },
  { path: 'assets/:id', element: <AssetViewPage /> },
];
