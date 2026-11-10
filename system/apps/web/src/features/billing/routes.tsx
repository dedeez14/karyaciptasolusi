import { lazy, type ReactNode } from 'react';

const SubscriptionListPage = lazy(() => import('./SubscriptionListPage'));
const SubscriptionFormPage = lazy(() => import('./SubscriptionFormPage'));
const SubscriptionViewPage = lazy(() => import('./SubscriptionViewPage'));

/** Authenticated routes of the billing module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'billing/subscriptions', element: <SubscriptionListPage /> },
  { path: 'billing/subscriptions/new', element: <SubscriptionFormPage /> },
  { path: 'billing/subscriptions/:id', element: <SubscriptionViewPage /> },
  { path: 'billing/subscriptions/:id/edit', element: <SubscriptionFormPage /> },
];
