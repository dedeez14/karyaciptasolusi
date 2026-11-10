import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, DataTable, EmptyState, Icon, Input, Pagination, PageHeader, Select, StatusBadge, type Column } from '@/components/ui';

export interface JournalRow {
  id: string;
  number: string;
  date: string;
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: string;
  totalDebit: string;
  totalCredit: string;
  postedAt: string | null;
}

export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  SI: 'Sales Invoice',
  PI: 'Purchase Invoice',
  DO: 'Delivery',
  GR: 'Goods Receipt',
  ADJ: 'Stock Adjustment',
  PAY_IN: 'Customer Receipt',
  PAY_OUT: 'Supplier Payment',
  PAYROLL: 'Payroll',
};

export default function JournalListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const ls = useListState();
  const f = ls.filters;
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, status: f.status, sourceType: f.sourceType, from: f.from, to: f.to };
  const list = useQuery({ queryKey: ['journals', 'list', params], queryFn: () => api.get<Paged<JournalRow>>('/journals', params), placeholderData: keepPreviousData });

  const columns: Column<JournalRow>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-medium text-brand-700 dark:text-brand-500">{r.number}</span> },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'description', header: 'Description', render: (r) => <span className="line-clamp-1">{r.description}</span> },
    { key: 'sourceType', header: 'Source', render: (r) => <Badge tone={r.sourceType === 'MANUAL' ? 'violet' : 'blue'}>{SOURCE_LABELS[r.sourceType ?? ''] ?? r.sourceType}</Badge> },
    { key: 'totalDebit', header: 'Amount', align: 'right', render: (r) => fmtMoney(r.totalDebit) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        subtitle={list.data ? `${list.data.meta.total} entries` : undefined}
        actions={
          can('accounting.journal.create') && (
            <Button icon="plus" onClick={() => navigate('/accounting/journals/new')}>
              New journal
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-6 dark:border-slate-800">
          <form
            className="relative sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search number, description..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <Select value={f.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)} placeholder="All statuses" options={['DRAFT', 'POSTED', 'VOID'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
          <Select value={f.sourceType ?? ''} onChange={(e) => ls.setFilter('sourceType', e.target.value)} placeholder="All sources" options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
          <Input type="date" value={f.from ?? ''} onChange={(e) => ls.setFilter('from', e.target.value)} aria-label="From date" />
          <Input type="date" value={f.to ?? ''} onChange={(e) => ls.setFilter('to', e.target.value)} aria-label="To date" />
        </div>
        <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => r.id} loading={list.isFetching} onRowClick={(r) => navigate(`/accounting/journals/${r.id}`)} empty={<EmptyState icon="book-open" title="No journal entries found" />} />
        {list.data && <Pagination page={ls.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
    </div>
  );
}
