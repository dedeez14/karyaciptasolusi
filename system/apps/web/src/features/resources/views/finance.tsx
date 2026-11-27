import type { ResourceUi } from './types';
import { AccountTreeView } from '@/features/insights/finance/AccountTreeView';
import { BankCardsView } from '@/features/insights/finance/BankCardsView';
import { FiscalYearView } from '@/features/insights/finance/FiscalYearView';

export const financeUi: Record<string, ResourceUi> = {
  accounts: { views: [{ id: 'tree', label: 'Tree & balances', icon: 'list-tree', component: AccountTreeView, pageSize: 1, selfLoading: true }] },
  'bank-accounts': { views: [{ id: 'cards', label: 'Cards', icon: 'layout-grid', component: BankCardsView }] },
  'fiscal-periods': { views: [{ id: 'year', label: 'Year view', icon: 'calendar-range', component: FiscalYearView }] },
};
