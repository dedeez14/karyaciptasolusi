import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useLookupLabel, useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Button, Card, DataTable, EmptyState, Icon, Input, LookupSelect, Pagination, PageHeader, StatCard, Tabs, type Column } from '@/components/ui';
import { AssetFormDrawer, AssetStatus, DepreciationRunModal, type AssetRow } from './common';

interface ListResponse extends Paged<AssetRow> {
  summary: {
    count: number;
    cost: string;
    accumulated: string;
    bookValue: string;
  };
}

export default function AssetListPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const ls = useListState({ sort: 'code' });
  const f = ls.filters;
  const statuses = useLookupOptions('ASSET_STATUS');
  const category = useLookupLabel('ASSET_CATEGORY');
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const params = {
    page: ls.page,
    pageSize: ls.pageSize,
    search: ls.search,
    status: f.status,
    category: f.category,
    sort: ls.sort,
    order: ls.order,
  };
  const q = useQuery({
    queryKey: ['assets', 'list', params],
    queryFn: () => api.get<ListResponse>('/assets', params),
    placeholderData: keepPreviousData,
  });
  const s = q.data?.summary;

  const columns: Column<AssetRow>[] = [
    {
      key: 'code',
      header: 'Asset',
      sortable: true,
      className: 'max-w-64',
      render: (r) => (
        <div className="min-w-0">
          <span className="font-medium text-brand-700">{r.code}</span>
          <span className="block truncate text-xs text-slate-500">{r.name}</span>
        </div>
      ),
    },
    {
      key: 'categoryCode',
      header: 'Category',
      render: (r) => category(r.categoryCode) || <span className="text-slate-300">—</span>,
    },
    {
      key: 'acquisitionDate',
      header: 'Acquired',
      sortable: true,
      render: (r) => fmtDate(r.acquisitionDate),
    },
    {
      key: 'custodianName',
      header: 'Custodian',
      hideOnMobile: true,
      render: (r) => r.custodianName ?? <span className="text-slate-300">—</span>,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      sortable: true,
      render: (r) => <span className="tabular-nums">{fmtMoney(r.cost)}</span>,
    },
    {
      key: 'accumulatedDepreciation',
      header: 'Depreciated',
      align: 'right',
      hideOnMobile: true,
      render: (r) => <span className="tabular-nums text-slate-500">{fmtMoney(r.accumulatedDepreciation)}</span>,
    },
    {
      key: 'bookValue',
      header: 'Book value',
      align: 'right',
      render: (r) => <span className="font-semibold tabular-nums">{r.statusCode === 'DISPOSED' ? '—' : fmtMoney(r.bookValue)}</span>,
    },
    {
      key: 'statusCode',
      header: 'Status',
      render: (r) => <AssetStatus code={r.statusCode} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register, depreciation and disposals"
        actions={
          <>
            {can('accounting.asset.depreciate') && (
              <Button variant="outline" icon="calendar-check" onClick={() => setRunning(true)}>
                Run depreciation
              </Button>
            )}
            {can('accounting.asset.create') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                Register asset
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assets on the books" value={s?.count ?? '—'} icon="monitor-cog" tone="blue" hint="Excludes disposed assets" />
        <StatCard label="Total cost" value={s ? fmtMoney(s.cost) : '—'} icon="wallet" tone="violet" />
        <StatCard label="Accumulated depreciation" value={s ? fmtMoney(s.accumulated) : '—'} icon="trending-down" tone="amber" />
        <StatCard label="Net book value" value={s ? fmtMoney(s.bookValue) : '—'} icon="scale" tone="green" />
      </div>
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <Tabs value={f.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} tabs={[{ value: '', label: 'All' }, ...statuses.map((x) => ({ value: x.value, label: x.label }))]} />
          <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr]">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                ls.setSearch(ls.searchInput);
              }}
            >
              <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search code, name, serial number, location..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
            </form>
            <LookupSelect category="ASSET_CATEGORY" value={f.category ?? ''} onChange={(v) => ls.setFilter('category', v || null)} placeholder="All categories" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          sort={{ field: ls.sort, order: ls.order }}
          onSort={ls.toggleSort}
          onRowClick={(r) => navigate(`/assets/${r.id}`)}
          empty={
            <EmptyState
              icon="monitor-cog"
              title="No fixed assets"
              description="Register laptops, servers, vehicles and furniture to track their value and post depreciation automatically."
              action={
                can('accounting.asset.create') && (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    Register asset
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <AssetFormDrawer open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/assets/${id}`)} />
      <DepreciationRunModal open={running} onClose={() => setRunning(false)} />
    </div>
  );
}
