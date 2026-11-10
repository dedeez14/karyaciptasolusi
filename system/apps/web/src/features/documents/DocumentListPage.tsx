import { useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { AsyncSelect, Badge, Button, Card, type Column, DataTable, DatePicker, EmptyState, Icon, Input, PageHeader, Pagination, Select, Spinner, StatusBadge } from '@/components/ui';
import { statusLabel, useDocType, type TradeDoc } from './useDocTypes';
import { useLookupOptions } from '@/hooks/useLookups';

export default function DocumentListPage() {
  const { type = '' } = useParams();
  const { def, isLoading } = useDocType(type);
  const navigate = useNavigate();
  const ls = useListState({ sort: 'date', order: 'desc' });
  const docStatuses = useLookupOptions('DOC_STATUS');
  const f = ls.filters;
  const params = {
    page: ls.page,
    pageSize: ls.pageSize,
    search: ls.search,
    sort: ls.sort,
    order: ls.order,
    status: f.status,
    partnerId: f.partnerId,
    from: f.from,
    to: f.to,
    unpaid: f.unpaid,
  };
  const list = useQuery({
    queryKey: ['documents', type.toUpperCase(), 'list', params],
    queryFn: () => api.get<Paged<TradeDoc & { balance: string }>>(`/documents/${type}`, params),
    enabled: !!def,
    placeholderData: keepPreviousData,
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!def) return <EmptyState icon="shield-alert" title="Not available" description="This document type does not exist or you have no access." />;

  const today = isoDate();
  const columns: Column<TradeDoc>[] = [
    {
      key: 'number',
      header: 'Number',
      sortable: true,
      render: (r) => <span className="font-medium text-brand-700">{r.number}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (r) => fmtDate(r.date),
    },
    ...(def.partner
      ? [
          {
            key: 'partnerName',
            header: def.partner === 'customer' ? 'Customer' : 'Supplier',
            render: (r: TradeDoc) => r.partnerName ?? <span className="text-slate-300">—</span>,
          },
        ]
      : []),
    ...(def.dueDate
      ? [
          {
            key: 'dueDate',
            header: def.code === 'SQ' ? 'Valid until' : 'Due',
            sortable: true,
            render: (r: TradeDoc) => {
              const late = !!r.dueDate && r.dueDate.slice(0, 10) < today && ['CONFIRMED', 'PARTIAL'].includes(r.status) && (!def.payable || Number(r.balance) > 0);
              return (
                <span className={late ? 'inline-flex items-center gap-1.5 font-medium text-red-600' : undefined}>
                  {fmtDate(r.dueDate)}
                  {late && <Badge tone="red">{def.code === 'SQ' ? 'Expired' : 'Overdue'}</Badge>}
                </span>
              );
            },
          },
        ]
      : []),
    { key: 'reference', header: 'Reference', render: (r) => r.reference ?? '' },
    ...(def.priced
      ? [
          {
            key: 'grandTotal',
            header: 'Total',
            align: 'right' as const,
            sortable: true,
            render: (r: TradeDoc) => fmtMoney(r.grandTotal),
          },
        ]
      : []),
    ...(def.payable
      ? [
          {
            key: 'balance',
            header: 'Balance',
            align: 'right' as const,
            render: (r: TradeDoc) => fmtMoney(r.balance),
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusBadge status={r.status} label={statusLabel(def, r.status)} />
          <ApprovalBadge approval={r.approval} />
        </span>
      ),
    },
  ];

  const hasFilters = Object.keys(f).length > 0;

  return (
    <div>
      <PageHeader
        title={def.label}
        subtitle={list.data ? `${list.data.meta.total} documents` : undefined}
        actions={
          def.can.create && (
            <Button icon="plus" onClick={() => navigate(`/documents/${def.code}/new`)}>
              New {def.label}
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-6">
          <form
            className="relative sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search number, reference..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <Select
            value={f.status ?? ''}
            onChange={(e) => ls.setFilter('status', e.target.value)}
            placeholder="All statuses"
            options={docStatuses.map((o) => ({
              value: o.value,
              label: statusLabel(def, o.value) ?? o.label,
            }))}
          />
          {def.partner ? <AsyncSelect resource={def.partner === 'customer' ? 'customers' : 'suppliers'} value={f.partnerId} onChange={(v) => ls.setFilter('partnerId', v)} placeholder={`All ${def.partner}s`} /> : <div className="hidden lg:block" />}
          <DatePicker value={f.from ?? ''} onChange={(v) => ls.setFilter('from', v)} placeholder="From date" aria-label="From date" />
          <DatePicker value={f.to ?? ''} onChange={(v) => ls.setFilter('to', v)} placeholder="To date" aria-label="To date" />
          {(def.payable || hasFilters) && (
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
              {def.payable && (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-brand-700" checked={f.unpaid === '1'} onChange={(e) => ls.setFilter('unpaid', e.target.checked ? '1' : null)} />
                  Outstanding only
                </label>
              )}
              {hasFilters && (
                <Button size="sm" variant="ghost" icon="x" onClick={ls.clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={list.isFetching}
          sort={{ field: ls.sort, order: ls.order }}
          onSort={ls.toggleSort}
          onRowClick={(r) => navigate(`/documents/${def.code}/${r.id}`)}
          empty={
            <EmptyState
              icon="file-text"
              title={hasFilters || ls.search ? `No ${def.label.toLowerCase()} match your filters` : `No ${def.label.toLowerCase()} yet`}
              description={hasFilters || ls.search ? 'Try another search or clear the filters.' : def.can.create ? `Create your first ${def.label.toLowerCase()} to get started.` : undefined}
              action={
                hasFilters || ls.search ? (
                  <Button
                    variant="outline"
                    icon="x"
                    onClick={() => {
                      ls.setSearchInput('');
                      navigate({ search: '' }, { replace: true });
                    }}
                  >
                    Clear search & filters
                  </Button>
                ) : (
                  def.can.create && (
                    <Button icon="plus" onClick={() => navigate(`/documents/${def.code}/new`)}>
                      New {def.label}
                    </Button>
                  )
                )
              }
            />
          }
        />
        {list.data && <Pagination page={ls.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
    </div>
  );
}

/** Where a document stands in the approval workflow (only shown when an approval rule applies) */
function ApprovalBadge({ approval }: { approval: TradeDoc['approval'] }) {
  if (!approval) return null;
  const map = {
    NOT_REQUESTED: { tone: 'amber' as const, label: 'Needs approval', title: 'An approval rule applies. Use "Request approval" on the document.' },
    PENDING: { tone: 'blue' as const, label: `Awaiting approval${approval.level ? ` (L${approval.level})` : ''}`, title: 'Waiting for an approver' },
    APPROVED: { tone: 'green' as const, label: 'Approved', title: 'All approval levels are approved' },
    REJECTED: { tone: 'red' as const, label: 'Rejected', title: 'The approver rejected this document' },
  };
  const m = map[approval.status];
  return (
    <span title={m.title}>
      <Badge tone={m.tone} dot>
        {m.label}
      </Badge>
    </span>
  );
}
