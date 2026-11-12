import type { ReactNode } from 'react';
import { routes as billing } from '@/features/billing/routes';
import { routes as assets } from '@/features/assets/routes';
import { routes as budget } from '@/features/budget/routes';
import { routes as approvals } from '@/features/approvals/routes';
import { routes as expenses } from '@/features/expenses/routes';
import { routes as helpdesk } from '@/features/helpdesk/routes';
import { routes as views } from '@/features/resources/views/routes';
import { routes as opening } from '@/features/opening/routes';
import { routes as bankrec } from '@/features/bankrec/routes';
import { routes as closing } from '@/features/closing/routes';
import { routes as timebilling } from '@/features/timebilling/routes';
import { routes as leadfinder } from '@/features/leadfinder/routes';
import { routes as emailcampaign } from '@/features/emailcampaign/routes';
import { routes as documentcenter } from '@/features/documentcenter/routes';

/** Routes contributed by feature modules (keeps App.tsx free of per-module edits). */
export const extraRoutes: { path: string; element: ReactNode }[] = [...billing, ...assets, ...budget, ...approvals, ...expenses, ...helpdesk, ...views, ...opening, ...bankrec, ...closing, ...timebilling, ...leadfinder, ...emailcampaign, ...documentcenter];
