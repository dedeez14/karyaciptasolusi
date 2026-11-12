import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useLookups } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, DataTable, EmptyState, Icon, Input, LookupSelect, Pagination, PageHeader, StatCard, Tabs, type Column } from '@/components/ui';
import { SlaBadge, TICKET_LOOKUPS, useTicketSummary, type TicketRow } from './common';
import { TicketFormDrawer } from './TicketFormDrawer';

export default function TicketListPage() {
  const navigate = useNavigate();
  const { can } = useSession();
  const ls = useListState({ sort: 'createdAt', order: 'desc' });
  const lk = useLookups(TICKET_LOOKUPS);
  const summary = useTicketSummary();
  const [creating, setCreating] = useState(false);
  const f = ls.filters;
  // default view: unresolved tickets
  const view = f.view ?? 'open';
  const params = {
    page: ls.page,
    pageSize: ls.pageSize,
    search: ls.search,
    sort: ls.sort,
    order: ls.order,
    open: view === 'open' ? '1' : undefined,
    status: view !== 'open' && view !== 'all' ? view : undefined,
    priority: f.priority,
    category: f.category,
    assignee: f.assignee,
    sla: f.sla,
  };
  const q = useQuery({ queryKey: ['helpdesk', 'list', params], queryFn: () => api.get<Paged<TicketRow>>('/helpdesk/tickets', params), placeholderData: keepPreviousData });
  const opt = (cat: string, code: string | null) => lk[cat]?.find((o) => o.value === code);

  const columns: Column<TicketRow>[] = [
    {
      key: 'code',
      header: 'Ticket',
      sortable: true,
      render: (r) => (
        <div className="min-w-0">
          <span className="text-xs font-medium text-brand-700">{r.code}</span>
          <p className="font-medium text-slate-900">{r.subject}</p>
          <p className="text-xs text-slate-500">{[r.customerName ?? r.contactName, opt('TICKET_CATEGORY', r.categoryCode)?.label].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      key: 'priorityCode',
      header: 'Priority',
      render: (r) => (
        <Badge color={opt('TICKET_PRIORITY', r.priorityCode)?.color} dot>
          {opt('TICKET_PRIORITY', r.priorityCode)?.label ?? r.priorityCode}
        </Badge>
      ),
    },
    {
      key: 'statusCode',
      header: 'Status',
      render: (r) => (
        <Badge color={opt('TICKET_STATUS', r.statusCode)?.color} dot>
          {opt('TICKET_STATUS', r.statusCode)?.label ?? r.statusCode}
        </Badge>
      ),
    },
    { key: 'assignee', header: 'Assignee', render: (r) => r.assigneeName ?? <span className="text-slate-400">Unassigned</span> },
    { key: 'dueAt', header: 'SLA', sortable: true, render: (r) => <SlaBadge t={r} compact /> },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs text-slate-500">
          {fmtDateTime(r.updatedAt)}
          {r.messageCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-0.5">
              <Icon name="message-square" className="h-3 w-3" />
              {r.messageCount}
            </span>
          )}
        </span>
      ),
    },
  ];

  const s = summary.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Support Tickets"
        subtitle="Customer requests, issues and questions with SLA tracking"
        actions={
          <>
            <Button variant="outline" icon="square-kanban" onClick={() => navigate('/helpdesk/board')}>
              Board
            </Button>
            {can('support.ticket.create') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New ticket
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Open" value={s?.open ?? '—'} icon="inbox" tone="blue" />
        <StatCard label="Unassigned" value={s?.unassigned ?? '—'} icon="user-x" tone="amber" />
        <StatCard label="SLA breached" value={s?.breached ?? '—'} icon="siren" tone="red" />
        <StatCard label="Assigned to me" value={s?.mine ?? '—'} icon="user-check" tone="violet" />
        <StatCard label="First response (avg)" value={s?.avgFirstResponseHours == null ? '—' : `${s.avgFirstResponseHours} h`} hint={`${s?.resolvedWeek ?? 0} resolved in 7 days`} icon="timer" tone="green" />
      </div>
      <Tabs
        value={view}
        onChange={(v) => ls.setFilter('view', v === 'open' ? null : v)}
        tabs={[{ value: 'open', label: 'Unresolved' }, ...(lk.TICKET_STATUS ?? []).map((o) => ({ value: o.value, label: o.label })), { value: 'all', label: 'All' }]}
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.9fr_0.9fr_1.2fr_auto]">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search code, subject, contact..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <LookupSelect category="TICKET_PRIORITY" value={f.priority ?? ''} onChange={(v) => ls.setFilter('priority', v || null)} placeholder="All priorities" />
          <LookupSelect category="TICKET_CATEGORY" value={f.category ?? ''} onChange={(v) => ls.setFilter('category', v || null)} placeholder="All categories" />
          <div className="flex gap-1">
            <div className="min-w-0 flex-1">
              <AsyncSelect resource="users" value={f.assignee && f.assignee !== 'me' && f.assignee !== 'none' ? f.assignee : null} onChange={(v) => ls.setFilter('assignee', v)} placeholder={f.assignee === 'me' ? 'Me' : f.assignee === 'none' ? 'Unassigned' : 'All assignees'} />
            </div>
            <Button variant={f.assignee === 'me' ? 'secondary' : 'outline'} onClick={() => ls.setFilter('assignee', f.assignee === 'me' ? null : 'me')}>
              Me
            </Button>
            <Button variant={f.assignee === 'none' ? 'secondary' : 'outline'} aria-label="Unassigned" icon="user-x" onClick={() => ls.setFilter('assignee', f.assignee === 'none' ? null : 'none')} />
          </div>
          <Button variant={f.sla === 'breached' ? 'secondary' : 'outline'} icon="siren" onClick={() => ls.setFilter('sla', f.sla ? null : 'breached')}>
            Breached
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          sort={{ field: ls.sort, order: ls.order }}
          onSort={ls.toggleSort}
          onRowClick={(r) => navigate(`/helpdesk/tickets/${r.id}`)}
          empty={
            <EmptyState
              icon="life-buoy"
              title="No tickets"
              description="Log customer requests from e-mail, WhatsApp or phone to keep track of every answer and the SLA."
              action={
                can('support.ticket.create') && (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    New ticket
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <TicketFormDrawer open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/helpdesk/tickets/${id}`)} />
    </div>
  );
}
