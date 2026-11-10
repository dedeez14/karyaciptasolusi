import { useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, type Column, DataTable, DatePicker, EmptyState, Icon, Input, PageHeader, Pagination, StatusBadge } from '@/components/ui';
import { dirMeta, type PaymentRow } from './common';

export default function PaymentListPage() {
  const { direction = 'in' } = useParams();
  const m = dirMeta(direction);
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const ls = useListState();
  const f = ls.filters;
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, partnerId: f.partnerId, from: f.from, to: f.to };
  const list = useQuery({ queryKey: ['payments', m.dir, 'list', params], queryFn: () => api.get<Paged<PaymentRow>>(`/payments/${m.dir}`, params), placeholderData: keepPreviousData });

  const filtered = !!ls.search || Object.keys(f).length > 0;
  const clear = () => {
    ls.setSearchInput('');
    navigate({ search: '' }, { replace: true });
  };
  const columns: Column<PaymentRow>[] = [
    { key: 'number', header: 'Number', render: (r) => <span className="font-medium text-brand-700">{r.number}</span> },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'partnerName', header: m.partner, render: (r) => r.partnerName ?? '' },
    { key: 'bankAccountName', header: m.dir === 'in' ? 'Deposited to' : 'Paid from', render: (r) => r.bankAccountName ?? '' },
    { key: 'reference', header: 'Reference', render: (r) => r.reference ?? '' },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title={m.title}
        subtitle={list.data ? `${list.data.meta.total} payments` : undefined}
        actions={
          can(`${m.perm}.create`) && (
            <Button icon="plus" onClick={() => navigate(`/payments/${m.dir}/new`)}>
              New {m.singular}
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-5">
          <form
            className="relative sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search number or reference..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <AsyncSelect resource={m.partnerResource} value={f.partnerId} onChange={(v) => ls.setFilter('partnerId', v)} placeholder={`All ${m.partner.toLowerCase()}s`} />
          <DatePicker value={f.from ?? ''} onChange={(v) => ls.setFilter('from', v)} placeholder="From date" aria-label="From date" />
          <DatePicker value={f.to ?? ''} onChange={(v) => ls.setFilter('to', v)} placeholder="To date" aria-label="To date" />
          {filtered && (
            <div className="sm:col-span-2 lg:col-span-5">
              <Button size="sm" variant="ghost" icon="x" onClick={clear}>
                Clear search & filters
              </Button>
            </div>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={list.isFetching}
          onRowClick={(r) => navigate(`/payments/${m.dir}/${r.id}`)}
          empty={
            <EmptyState
              icon="hand-coins"
              title={filtered ? 'No payments match your filters' : `No ${m.title.toLowerCase()} yet`}
              description={filtered ? 'Try another search or clear the filters.' : `Record a ${m.singular.toLowerCase()} here, or open an invoice and use its payment action.`}
              action={
                filtered ? (
                  <Button variant="outline" icon="x" onClick={clear}>
                    Clear search & filters
                  </Button>
                ) : (
                  can(`${m.perm}.create`) && (
                    <Button icon="plus" onClick={() => navigate(`/payments/${m.dir}/new`)}>
                      New {m.singular}
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
