import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DataTable, EmptyState, Icon, Input, Pagination, PageHeader, StatCard, StatusBadge, Tabs, toast, type Column } from '@/components/ui';
import { runMessage, StateBadge, stateLabel, SUB_STATES, useIntervalText, type RunResult, type SubscriptionRow } from './common';

interface ListResponse extends Paged<SubscriptionRow> {
  summary: { active: number; due: number; monthlyRecurring: string };
}

interface ReminderRow {
  id: string;
  documentId: string;
  level: number;
  days: number | null;
  sentTo: string;
  sentAt: string;
  invoiceNumber?: string;
  dueDate?: string | null;
  invoiceStatus?: string;
  balance: string | null;
  customerName: string | null;
}
interface ReminderResponse extends Paged<ReminderRow> {
  settings: { enabled: boolean; steps: number[]; mailConfigured: boolean };
}
interface ReminderRun {
  enabled: boolean;
  mailConfigured: boolean;
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  message?: string;
}

export default function SubscriptionListPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ls = useListState();
  const f = ls.filters;
  const view = f.view === 'reminders' ? 'reminders' : 'subscriptions';
  const [busy, setBusy] = useState<string | null>(null);

  const runDue = async () => {
    if (
      !(await confirm({
        title: 'Generate due invoices now?',
        message: 'An invoice is created for every active subscription whose next invoice date is today or earlier.',
        confirmText: 'Generate invoices',
      }))
    )
      return;
    setBusy('run');
    try {
      const r = await api.post<{
        processed: number;
        created: number;
        failed: number;
        results: RunResult[];
      }>('/billing/subscriptions/run-due');
      if (!r.processed) toast.info('No subscription is due');
      else if (r.failed) toast.error(`${r.created} invoice(s) created, ${r.failed} failed: ${r.results.find((x) => x.error)?.error ?? ''}`);
      else toast.success(`${r.created} invoice(s) created`);
      const warn = r.results.find((x) => x.warning);
      if (warn) toast.info(runMessage(warn));
      qc.invalidateQueries({ queryKey: ['billing'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const sendReminders = async () => {
    setBusy('remind');
    try {
      const r = await api.post<ReminderRun>('/billing/reminders/run');
      if (!r.mailConfigured) toast.error('E-mail is not configured. Set the SMTP settings in System > Settings first.');
      else if (r.message) toast.info(r.message);
      else if (!r.sent && !r.failed) toast.info(`No reminder is due (${r.checked} overdue invoice(s) checked)`);
      else toast.success(`${r.sent} reminder(s) sent${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `, ${r.skipped} skipped (no e-mail address)` : ''}`);
      qc.invalidateQueries({ queryKey: ['billing', 'reminders'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring Billing"
        subtitle="Maintenance, hosting and retainer contracts that invoice automatically"
        actions={
          <>
            {can('sales.subscription.run') && (
              <>
                <Button variant="outline" icon="mail-warning" loading={busy === 'remind'} onClick={sendReminders}>
                  Send overdue reminders
                </Button>
                <Button variant="outline" icon="play" loading={busy === 'run'} onClick={runDue}>
                  Run due now
                </Button>
              </>
            )}
            {can('sales.subscription.create') && (
              <Button icon="plus" onClick={() => navigate('/billing/subscriptions/new')}>
                New subscription
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={view}
        onChange={(v) => ls.setFilter('view', v === 'subscriptions' ? null : v)}
        tabs={[{ value: 'subscriptions', label: 'Subscriptions' }, ...(can('sales.invoice.read') ? [{ value: 'reminders' as const, label: 'Reminder log' }] : [])]}
      />
      {view === 'subscriptions' ? <Subscriptions ls={ls} /> : <Reminders ls={ls} />}
    </div>
  );
}

type LS = ReturnType<typeof useListState>;

function Subscriptions({ ls }: { ls: LS }) {
  const navigate = useNavigate();
  const { can } = useSession();
  const interval = useIntervalText();
  const f = ls.filters;
  const params = {
    page: ls.page,
    pageSize: ls.pageSize,
    search: ls.search,
    status: f.status,
    customerId: f.customerId,
  };
  const q = useQuery({
    queryKey: ['billing', 'subscriptions', params],
    queryFn: () => api.get<ListResponse>('/billing/subscriptions', params),
    placeholderData: keepPreviousData,
  });
  const s = q.data?.summary;

  const columns: Column<SubscriptionRow>[] = [
    {
      key: 'code',
      header: 'Subscription',
      render: (r) => (
        <div className="min-w-0">
          <span className="font-medium text-brand-700">{r.code}</span>
          <span className="block truncate text-xs text-slate-500">{r.name}</span>
        </div>
      ),
    },
    { key: 'customerName', header: 'Customer' },
    {
      key: 'interval',
      header: 'Interval',
      render: (r) => interval(r.intervalCode, r.intervalCount),
    },
    {
      key: 'nextRunDate',
      header: 'Next invoice',
      render: (r) => (r.state === 'ENDED' ? <span className="text-slate-300">—</span> : <span className={r.state === 'DUE' ? 'font-medium text-amber-600' : ''}>{fmtDate(r.nextRunDate)}</span>),
    },
    {
      key: 'amount',
      header: 'Per invoice',
      align: 'right',
      render: (r) => <span className="font-medium tabular-nums">{`${r.currencyCode} ${fmtMoney(r.amount)}`}</span>,
    },
    {
      key: 'auto',
      header: 'Automation',
      hideOnMobile: true,
      render: (r) => (
        <span className="flex gap-1">
          {r.autoConfirm && <Badge tone="blue">Auto confirm</Badge>}
          {r.autoEmail && <Badge tone="violet">Auto e-mail</Badge>}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      render: (r) => <StateBadge state={r.state} />,
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active subscriptions" value={s?.active ?? '—'} icon="repeat" tone="blue" />
        <StatCard label="Due for invoicing" value={s?.due ?? '—'} icon="calendar-clock" tone={s?.due ? 'amber' : 'green'} hint="Next invoice date today or earlier" />
        <StatCard label="Monthly recurring revenue" value={s ? fmtMoney(s.monthlyRecurring) : '—'} icon="trending-up" tone="green" hint="Before tax, normalised to one month" />
      </div>
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <Tabs value={f.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} tabs={[{ value: '', label: 'All' }, ...SUB_STATES.map((x) => ({ value: x, label: stateLabel(x) }))]} />
          <div className="grid gap-2 sm:grid-cols-2">
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
            <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => ls.setFilter('customerId', v)} placeholder="All customers" />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(`/billing/subscriptions/${r.id}`)}
          empty={
            <EmptyState
              icon="repeat"
              title="No subscriptions"
              description="Create a subscription for every contract that is billed periodically. Invoices are generated automatically on the due date."
              action={
                can('sales.subscription.create') && (
                  <Button icon="plus" onClick={() => navigate('/billing/subscriptions/new')}>
                    New subscription
                  </Button>
                )
              }
            />
          }
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
    </>
  );
}

function Reminders({ ls }: { ls: LS }) {
  const { can } = useSession();
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search };
  const q = useQuery({
    queryKey: ['billing', 'reminders', params],
    queryFn: () => api.get<ReminderResponse>('/billing/reminders', params),
    placeholderData: keepPreviousData,
  });
  const st = q.data?.settings;
  const columns: Column<ReminderRow>[] = [
    { key: 'sentAt', header: 'Sent', render: (r) => fmtDateTime(r.sentAt) },
    {
      key: 'invoiceNumber',
      header: 'Invoice',
      render: (r) => (
        <Link to={`/documents/SI/${r.documentId}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          {r.invoiceNumber ?? '—'}
        </Link>
      ),
    },
    { key: 'customerName', header: 'Customer' },
    {
      key: 'level',
      header: 'Reminder',
      render: (r) => <Badge tone={r.level >= 3 ? 'red' : r.level === 2 ? 'amber' : 'blue'}>{`#${r.level}${r.days !== null ? ` · ${r.days} days late` : ''}`}</Badge>,
    },
    { key: 'sentTo', header: 'Sent to', hideOnMobile: true },
    { key: 'dueDate', header: 'Due date', render: (r) => fmtDate(r.dueDate) },
    {
      key: 'balance',
      header: 'Outstanding now',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtMoney(r.balance)}</span>,
    },
    {
      key: 'invoiceStatus',
      header: 'Invoice status',
      render: (r) => (r.invoiceStatus ? <StatusBadge status={r.invoiceStatus} /> : null),
    },
  ];
  return (
    <>
      {st && (
        <div className={`flex flex-wrap items-start gap-2 rounded-xl border px-4 py-3 text-sm ${st.enabled && st.mailConfigured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <Icon name={st.enabled && st.mailConfigured ? 'circle-check' : 'triangle-alert'} className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            {st.enabled ? `Automatic reminders are on: e-mailed ${st.steps.join(', ')} days after the due date (every morning at 08:00).` : 'Automatic reminders are off. You can still send them manually.'}
            {!st.mailConfigured && ' E-mail (SMTP) is not configured yet, so no reminder can be sent.'}
            {can('system.setting.read') && (
              <Link to="/system/settings" className="ml-1 font-medium underline">
                Change in Settings
              </Link>
            )}
          </div>
        </div>
      )}
      <Card bodyClass="p-0">
        <div className="border-b border-line p-3">
          <form
            className="relative max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search invoice number..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          empty={<EmptyState icon="mail-check" title="No reminders sent yet" description="Overdue invoices are reminded by e-mail with the invoice PDF attached." />}
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
    </>
  );
}
