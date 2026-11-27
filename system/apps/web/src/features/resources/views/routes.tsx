import { lazy, type ReactNode } from 'react';

const EmployeeProfilePage = lazy(() => import('@/features/insights/hr/EmployeeProfilePage'));
const PartnerPage = lazy(() => import('@/features/insights/commercial/PartnerPage'));
const ProductPage = lazy(() => import('@/features/insights/commercial/ProductPage'));
const ProjectPage = lazy(() => import('@/features/insights/commercial/ProjectPage'));

/** Detail pages of the purpose-built resource views (e.g. /customers/:id). */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'employees/:id', element: <EmployeeProfilePage /> },
  { path: 'customers/:id', element: <PartnerPage kind="customer" /> },
  { path: 'suppliers/:id', element: <PartnerPage kind="supplier" /> },
  { path: 'products/:id', element: <ProductPage /> },
  { path: 'projects/:id', element: <ProjectPage /> },
];
