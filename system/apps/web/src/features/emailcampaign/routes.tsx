import { lazy, type ReactNode } from 'react';

const CampaignListPage = lazy(() => import('./CampaignListPage'));
const CampaignFormPage = lazy(() => import('./CampaignFormPage'));
const CampaignViewPage = lazy(() => import('./CampaignViewPage'));

/** Authenticated routes of the emailcampaign module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'crm/email-campaigns', element: <CampaignListPage /> },
  { path: 'crm/email-campaigns/new', element: <CampaignFormPage /> },
  { path: 'crm/email-campaigns/:id', element: <CampaignViewPage /> },
  { path: 'crm/email-campaigns/:id/edit', element: <CampaignFormPage /> },
];
