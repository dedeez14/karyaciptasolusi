import { lazy, type ReactNode } from 'react';

const TicketListPage = lazy(() => import('./TicketListPage'));
const TicketViewPage = lazy(() => import('./TicketViewPage'));
const TicketBoardPage = lazy(() => import('./TicketBoardPage'));

/** Authenticated routes of the helpdesk module, mounted by src/routes/extra.tsx */
export const routes: { path: string; element: ReactNode }[] = [
  { path: 'helpdesk/tickets', element: <TicketListPage /> },
  { path: 'helpdesk/tickets/:id', element: <TicketViewPage /> },
  { path: 'helpdesk/board', element: <TicketBoardPage /> },
];
