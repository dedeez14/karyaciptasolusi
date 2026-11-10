import type { ReactNode } from 'react';
import { routes as billing } from '@/features/billing/routes';
import { routes as assets } from '@/features/assets/routes';
import { routes as budget } from '@/features/budget/routes';
import { routes as approvals } from '@/features/approvals/routes';
import { routes as expenses } from '@/features/expenses/routes';
import { routes as helpdesk } from '@/features/helpdesk/routes';
import { routes as views } from '@/features/resources/views/routes';

/** Routes contributed by feature modules (keeps App.tsx free of per-module edits). */
export const extraRoutes: { path: string; element: ReactNode }[] = [...billing, ...assets, ...budget, ...approvals, ...expenses, ...helpdesk, ...views];
