import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Button, Card, DataTable, EmptyState, Icon, Input, Pagination, PageHeader, Tabs, type Column, NumberInput } from '@/components/ui';
import { BudgetStatus, NewBudgetModal, type BudgetListRow } from './common';

export default function BudgetListPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const ls = useListState();
  const f = ls.filters;
  const statuses = useLookupOptions('BUDGET_STATUS');
  const [creating, setCreating] = useState(false);
  const [yearInput, setYearInput] = useState(f.year ?? '');
  const params = {
    page: ls.page,
    pageSize: ls.pageSize,
    search: ls.search,
    status: f.status,
    year: f.year,
  };
  const q = useQuery({
    queryKey: ['budgets', 'list', params],
    queryFn: () => api.get<Paged<BudgetListRow>>('/budgets', params),
    placeholderData: keepPreviousData,
  });

  const columns: Column<BudgetListRow>[] = [
    {
      key: 'code',
      header: 'Budget',
      render: (r) => (
        <div className="min-w-0">
          <span className="font-medium text-brand-700">{r.code}</span>
          <span className="block truncate text-xs text-slate-500">{r.name}</span>
        </div>
      ),
    },
    {
      key: 'year',
      header: 'Year',
      render: (r) => <span className="font-medium">{r.year}</span>,
    },
    {
      key: 'income',
      header: 'Income',
      align: 'right',
      render: (r) => <span className="tabular-nums text-emerald-700">{fmtMoney(r.income)}</span>,
    },
    {
      key: 'expense',
      header: 'Expenses',
      align: 'right',
      render: (r) => <span className="tabular-nums text-rose-700">{fmtMoney(r.expense)}</span>,
    },
    {
      key: 'profit',
      header: 'Planned result',
      align: 'right',
      hideOnMobile: true,
      render: (r) => <span className="font-semibold tabular-nums">{fmtMoney(Number(r.income) - Number(r.expense))}</span>,
    },
    {
      key: 'approvedAt',
      header: 'Approved',
      hideOnMobile: true,
      render: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : <span className="text-slate-300">—</span>),
    },
    {
      key: 'statusCode',
      header: 'Status',
      render: (r) => <BudgetStatus code={r.statusCode} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Budgets"
        subtitle="Plan income and expenses per account and month, then track them against actual postings"
        actions={
          can('accounting.budget.create') && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              New budget
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <Tabs value={f.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} tabs={[{ value: '', label: 'All' }, ...statuses.map((x) => ({ value: x.value, label: x.label }))]} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_0.5fr]">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                ls.setSearch(ls.searchInput);
              }}
            >
              <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search code or name..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
            </form>
            <NumberInput
              decimals={0}
              grouping={false}
              min={2000}
              max={2100}
              placeholder="Any year"
              value={yearInput}
              onChange={(v) => {
                setYearInput(v);
                if (!v || /^\d{4}$/.test(v)) ls.setFilter('year', v || null);
              }}
              aria-label="Year"
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(`/budgets/${r.id}`)}
          empty={
            <EmptyState
              icon="piggy-bank"
              title="No budgets yet"
              description="Create a yearly budget - start empty, copy last year's budget or use last year's actual figures."
              action={
                can('accounting.budget.create') && (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    New budget
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <NewBudgetModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
