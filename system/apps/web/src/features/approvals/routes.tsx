import { lazy, type ReactNode } from 'react';

const ApprovalsInboxPage = lazy(() => import('./ApprovalsInboxPage'));
const ApprovalRulesPage = lazy(() => import('./ApprovalRulesPage'));

/** Authenticated routes of the approvals module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'approvals', element: <ApprovalsInboxPage /> },
  { path: 'system/approval-rules', element: <ApprovalRulesPage /> },
];
