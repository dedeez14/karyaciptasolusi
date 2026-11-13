import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, DataTable, DatePicker, EmptyState, Icon, Input, Pagination, PageHeader, StatCard, Tabs, type Column } from '@/components/ui';
import type { ExpenseRow } from './common';

type Summary = Record<string, { count: number; amount: number }>;

export default function ExpenseListPage() {
  const { can, me } = useSession();
  const navigate = useNavigate();
  const ls = useListState();
  const statuses = useLookupOptions('EXPENSE_STATUS');
  const f = ls.filters;
  const seesOthers = can('hris.expense.manage') || can('hris.expense.approve') || can('hris.expense.pay') || me?.user.isSuperAdmin;
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, status: f.status, employeeId: f.employeeId, mine: f.mine, from: f.from, to: f.to };
  const q = useQuery({ queryKey: ['expenses', 'list', params], queryFn: () => api.get<Paged<ExpenseRow> & { summary: Summary }>('/expenses', params), placeholderData: keepPreviousData });
  const st = (code: string) => statuses.find((s) => s.value === code);
  const sum = q.data?.summary ?? {};

  const columns: Column<ExpenseRow>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-medium text-brand-700">{r.number}</span> },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'title', header: 'Title' },
    ...(seesOthers ? [{ key: 'employeeName', header: 'Employee', render: (r: ExpenseRow) => r.employeeName ?? '—' }] : []),
    { key: 'totalAmount', header: 'Amount', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{fmtMoney(r.totalAmount)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge color={st(r.statusCode)?.color} dot>
          {st(r.statusCode)?.label ?? r.statusCode}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expense Claims"
        subtitle="Reimbursement of business expenses paid by employees"
        actions={
          can('hris.expense.create') && (
            <Button icon="plus" onClick={() => navigate('/expenses/new')}>
              New claim
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Waiting for approval" value={fmtMoney(sum.SUBMITTED?.amount ?? 0)} hint={`${sum.SUBMITTED?.count ?? 0} claims`} icon="hourglass" tone="amber" />
        <StatCard label="Approved, to be paid" value={fmtMoney(sum.APPROVED?.amount ?? 0)} hint={`${sum.APPROVED?.count ?? 0} claims`} icon="badge-check" tone="blue" />
        <StatCard label="Paid" value={fmtMoney(sum.PAID?.amount ?? 0)} hint={`${sum.PAID?.count ?? 0} claims`} icon="wallet" tone="green" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={f.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} tabs={[{ value: '', label: 'All' }, ...statuses.map((s) => ({ value: s.value, label: s.label }))]} />
        {seesOthers && (
          <Button size="sm" variant={f.mine === '1' ? 'secondary' : 'outline'} icon="user" onClick={() => ls.setFilter('mine', f.mine === '1' ? null : '1')}>
            My claims
          </Button>
        )}
      </div>
      <Card bodyClass="p-0">
        <div className={`grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 ${seesOthers ? 'lg:grid-cols-[1.4fr_1fr_0.8fr_0.8fr]' : 'lg:grid-cols-[1.4fr_0.8fr_0.8fr]'}`}>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search number or title..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          {seesOthers && <AsyncSelect resource="employees" value={f.employeeId} onChange={(v) => ls.setFilter('employeeId', v)} placeholder="All employees" />}
          <DatePicker value={f.from ?? ''} onChange={(v) => ls.setFilter('from', v || null)} placeholder="From date" />
          <DatePicker value={f.to ?? ''} onChange={(v) => ls.setFilter('to', v || null)} placeholder="To date" />
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(`/expenses/${r.id}`)}
          empty={
            <EmptyState
              icon="receipt-text"
              title="No expense claims"
              description="Claim back taxi fares, client meals, travel and other business costs you paid yourself. Attach the receipts and submit."
              action={
                can('hris.expense.create') && (
                  <Button icon="plus" onClick={() => navigate('/expenses/new')}>
                    New claim
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
    </div>
  );
}
