import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, DataTable, DatePicker, EmptyState, Icon, Input, Pagination, PageHeader, StatCard, StatusBadge, Tabs, type Column } from '@/components/ui';
import { useLookups } from '@/features/resources/FieldInput';
import { CASH_ICON, CashFormDrawer, type CashType } from './CashFormDrawer';

export interface CashRow {
  id: string;
  number: string;
  date: string;
  type: CashType;
  amount: string;
  status: string;
  partyName: string | null;
  description: string;
  reference: string | null;
  bankAccountName: string | null;
  toBankAccountName: string | null;
  accountName: string | null;
}

export default function CashListPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const ls = useListState();
  const types = useLookups(['CASH_TYPE']).CASH_TYPE ?? [];
  const [creating, setCreating] = useState<CashType | null>(null);
  const f = ls.filters;
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, type: f.type, bankAccountId: f.bankAccountId, from: f.from, to: f.to };
  const q = useQuery({ queryKey: ['cash', 'list', params], queryFn: () => api.get<Paged<CashRow> & { totals: Partial<Record<CashType, number>> }>('/cash', params), placeholderData: keepPreviousData });
  const typeLabel = (v: string) => types.find((t) => t.value === v);

  const columns: Column<CashRow>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-medium text-brand-700">{r.number}</span> },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <Badge color={typeLabel(r.type)?.color}>
          <Icon name={CASH_ICON[r.type]} className="h-3 w-3" />
          {typeLabel(r.type)?.label ?? r.type}
        </Badge>
      ),
    },
    { key: 'description', header: 'Description' },
    {
      key: 'account',
      header: 'Account',
      render: (r) => (
        <span className="text-sm">
          {r.type === 'TRANSFER' ? `${r.bankAccountName} → ${r.toBankAccountName}` : r.bankAccountName}
          {r.accountName && <span className="block text-xs text-slate-500">{r.accountName}</span>}
        </span>
      ),
    },
    { key: 'partyName', header: 'Party', render: (r) => r.partyName ?? <span className="text-slate-300">—</span> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => <span className={r.type === 'RECEIPT' ? 'font-semibold text-emerald-600' : r.type === 'PAYMENT' ? 'font-semibold text-red-600' : 'font-semibold'}>{`${r.type === 'PAYMENT' ? '-' : r.type === 'RECEIPT' ? '+' : ''}${fmtMoney(r.amount)}`}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} label={r.status === 'CONFIRMED' ? 'Posted' : r.status === 'DRAFT' ? 'Draft (approval)' : undefined} /> },
  ];

  const totals = q.data?.totals ?? {};
  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash & Bank Transactions"
        subtitle="Money in, money out and transfers that are not linked to invoices"
        actions={
          can('accounting.cash.create') && (
            <>
              <Button variant="outline" icon="arrow-down-left" onClick={() => setCreating('RECEIPT')}>
                Money in
              </Button>
              <Button variant="outline" icon="arrow-left-right" onClick={() => setCreating('TRANSFER')}>
                Transfer
              </Button>
              <Button icon="arrow-up-right" onClick={() => setCreating('PAYMENT')}>
                Money out
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={typeLabel('RECEIPT')?.label ?? 'Money in'} value={fmtMoney(totals.RECEIPT ?? 0)} icon="arrow-down-left" tone="green" hint="Filtered period" />
        <StatCard label={typeLabel('PAYMENT')?.label ?? 'Money out'} value={fmtMoney(totals.PAYMENT ?? 0)} icon="arrow-up-right" tone="red" hint="Filtered period" />
        <StatCard label={typeLabel('TRANSFER')?.label ?? 'Transfers'} value={fmtMoney(totals.TRANSFER ?? 0)} icon="arrow-left-right" tone="blue" hint="Filtered period" />
      </div>
      <Tabs value={f.type ?? ''} onChange={(v) => ls.setFilter('type', v || null)} tabs={[{ value: '', label: 'All' }, ...types.map((t) => ({ value: t.value, label: t.label }))]} />
      <Card bodyClass="p-0">
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_0.8fr_0.8fr]">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search number, description, party..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => ls.setFilter('bankAccountId', v)} placeholder="All cash & bank accounts" />
          <DatePicker value={f.from ?? ''} onChange={(v) => ls.setFilter('from', v || null)} placeholder="From date" />
          <DatePicker value={f.to ?? ''} onChange={(v) => ls.setFilter('to', v || null)} placeholder="To date" />
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(`/accounting/cash/${r.id}`)}
          empty={
            <EmptyState
              icon="wallet-cards"
              title="No transactions"
              description="Record expenses, other income and transfers between your cash and bank accounts."
              action={
                can('accounting.cash.create') && (
                  <Button icon="plus" onClick={() => setCreating('PAYMENT')}>
                    New transaction
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <CashFormDrawer open={!!creating} initialType={creating ?? 'PAYMENT'} onClose={() => setCreating(null)} onSaved={(id) => navigate(`/accounting/cash/${id}`)} />
    </div>
  );
}
