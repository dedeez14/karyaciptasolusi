import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime, plural, getLocale } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DataTable, EmptyState, Field, Icon, Input, LookupSelect, Modal, Pagination, PageHeader, StatCard, Tabs, Textarea, toast, type Column } from '@/components/ui';
import { SmtpWarning, StatusBadge, type CampaignRow, type InboxStatus } from './common';
import { RepliesPanel } from './RepliesPanel';

interface Summary {
  active: number;
  scheduled: number;
  suppressed: number;
  sentToday: number;
  dailyLimit: number;
  smtpReady: boolean;
  newReplies: number;
  inbox: InboxStatus;
}

const AUDIENCE_LABEL: Record<string, string> = { LEADS: 'Leads', CUSTOMERS: 'Customers', MAP_PLACES: 'Google Maps', MANUAL: 'Pasted list' };

export default function CampaignListPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'campaigns' | 'replies' | 'suppressions') ?? 'campaigns';
  const summary = useQuery({ queryKey: ['email-campaigns', 'summary'], queryFn: () => api.get<Summary>('/email-campaigns/summary') });
  const s = summary.data;
  return (
    <div className="space-y-4">
      <PageHeader title="E-mail Campaigns" subtitle="Marketing e-mails to leads, customers and Google Maps results - sent within safe limits, always with an unsubscribe link" actions={<NewButton />} />
      <SmtpWarning ready={s?.smtpReady} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sending now" value={s?.active ?? '—'} icon="send" />
        <StatCard label="Scheduled" value={s?.scheduled ?? '—'} icon="calendar-clock" tone="violet" />
        <StatCard label="Sent today" value={s ? `${s.sentToday} / ${s.dailyLimit}` : '—'} hint="Daily limit from System Settings" icon="gauge" tone="green" />
        <StatCard label="Do-not-email list" value={s?.suppressed ?? '—'} hint="Unsubscribed, bounced or added by hand" icon="shield-off" tone="amber" />
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setSp(v === 'campaigns' ? {} : { tab: v })}
        tabs={[
          { value: 'campaigns', label: 'Campaigns' },
          {
            value: 'replies',
            label: (
              <span className="flex items-center gap-1.5">
                Replies
                {!!s?.newReplies && <span className={`rounded-full px-1.5 text-xs font-semibold ${tab === 'replies' ? 'bg-white/25 text-white' : 'bg-violet-100 text-violet-700'}`}>{s.newReplies}</span>}
              </span>
            ),
          },
          { value: 'suppressions', label: 'Do-not-email list' },
        ]}
      />
      {tab === 'campaigns' ? <Campaigns /> : tab === 'replies' ? <RepliesPanel inbox={s?.inbox} /> : <Suppressions />}
    </div>
  );
}

function NewButton() {
  const navigate = useNavigate();
  const { can } = useSession();
  if (!can('crm.emailcampaign.create')) return null;
  return (
    <Button icon="plus" onClick={() => navigate('/crm/email-campaigns/new')}>
      New campaign
    </Button>
  );
}

function Campaigns() {
  const navigate = useNavigate();
  const ls = useListState();
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search || undefined, status: ls.filters.status };
  const q = useQuery({ queryKey: ['email-campaigns', 'list', params], queryFn: () => api.get<Paged<CampaignRow>>('/email-campaigns', params), placeholderData: keepPreviousData, refetchInterval: 30_000 });

  const columns: Column<CampaignRow>[] = [
    {
      key: 'name',
      header: 'Campaign',
      render: (r) => (
        <div className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-medium text-brand-700">{r.code}</span>
            {r.automatic && (
              <Badge tone="violet">
                <Icon name="repeat" className="h-3 w-3" /> Auto
              </Badge>
            )}
          </span>
          <span className="block truncate text-sm text-slate-800">{r.name}</span>
          <span className="block truncate text-xs text-slate-500">
            {r.subject}
            {r.followUps > 0 && <span className="text-slate-400"> · +{plural(r.followUps, 'follow-up')}</span>}
          </span>
        </div>
      ),
    },
    { key: 'audience', header: 'Audience', hideOnMobile: true, render: (r) => <span className="text-sm text-slate-600">{AUDIENCE_LABEL[r.audienceSource ?? ''] ?? '—'}</span> },
    {
      key: 'progress',
      header: 'Sent',
      align: 'right',
      render: (r) => (
        <div className="text-right text-sm tabular-nums">
          <span className="font-medium">{r.sentCount.toLocaleString(getLocale())}</span>
          <span className="text-slate-400"> / {r.totalCount.toLocaleString(getLocale())}</span>
          {(r.replyCount > 0 || r.failedCount > 0 || r.unsubscribeCount > 0) && (
            <span className="block text-xs text-slate-500">
              {[r.replyCount ? `${r.replyCount} replied` : '', r.failedCount ? `${r.failedCount} failed` : '', r.unsubscribeCount ? `${r.unsubscribeCount} unsubscribed` : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'when',
      header: 'When',
      hideOnMobile: true,
      render: (r) => <span className="text-xs whitespace-nowrap text-slate-600">{r.statusCode === 'SCHEDULED' && r.scheduledAt ? `Scheduled ${fmtDateTime(r.scheduledAt)}` : r.finishedAt ? `Finished ${fmtDateTime(r.finishedAt)}` : r.startedAt ? `Started ${fmtDateTime(r.startedAt)}` : `Created ${fmtDateTime(r.createdAt)}`}</span>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge category="EMAIL_CAMPAIGN_STATUS" code={r.statusCode} /> },
  ];

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            ls.setSearch(ls.searchInput);
          }}
        >
          <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search campaigns..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
        </form>
        <div className="sm:w-52">
          <LookupSelect category="EMAIL_CAMPAIGN_STATUS" value={ls.filters.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} placeholder="All statuses" />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.data ?? []}
        rowKey={(r) => r.id}
        loading={q.isFetching}
        onRowClick={(r) => navigate(`/crm/email-campaigns/${r.id}`)}
        empty={<EmptyState icon="mails" title="No e-mail campaigns yet" description={ls.search || ls.filters.status ? 'Nothing matches your search or filter.' : 'Create a campaign, pick an audience (for example leads found on Google Maps) and send it now, schedule it or let it run automatically.'} action={<NewButton />} />}
      />
      {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
    </Card>
  );
}

interface SuppressionRow {
  id: string;
  email: string;
  reasonCode: string;
  note: string | null;
  createdAt: string;
}

function Suppressions() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const params = { page, pageSize, search: search || undefined, reason: reason || undefined };
  const q = useQuery({ queryKey: ['email-campaigns', 'suppressions', params], queryFn: () => api.get<Paged<SuppressionRow>>('/email-campaigns/suppressions', params), placeholderData: keepPreviousData });
  const manage = can('crm.suppression.manage');

  const remove = async (r: SuppressionRow) => {
    if (!(await confirm({ title: `Remove ${r.email}?`, message: 'This address can receive marketing e-mails again. Only do this when the person asked for it.', confirmText: 'Remove', danger: true }))) return;
    try {
      await api.delete(`/email-campaigns/suppressions/${r.id}`);
      toast.success('Removed from the do-not-email list');
      qc.invalidateQueries({ queryKey: ['email-campaigns'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<SuppressionRow>[] = [
    { key: 'email', header: 'E-mail', render: (r) => <span className="font-mono text-sm">{r.email}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <StatusBadge category="EMAIL_SUPPRESSION_REASON" code={r.reasonCode} /> },
    { key: 'note', header: 'Note', hideOnMobile: true, render: (r) => <span className="block max-w-80 truncate text-xs text-slate-500" title={r.note ?? ''}>{r.note || '—'}</span> },
    { key: 'createdAt', header: 'Since', hideOnMobile: true, render: (r) => <span className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: SuppressionRow) => <Button variant="ghost" size="icon" icon="trash-2" aria-label={`Remove ${r.email}`} onClick={() => remove(r)} />,
          },
        ]
      : []),
  ];

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search e-mail..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sm:w-52">
          <LookupSelect
            category="EMAIL_SUPPRESSION_REASON"
            value={reason}
            onChange={(v) => {
              setReason(v);
              setPage(1);
            }}
            placeholder="All reasons"
          />
        </div>
        {manage && (
          <Button icon="plus" onClick={() => setAdding(true)}>
            Add addresses
          </Button>
        )}
      </div>
      <DataTable columns={columns} rows={q.data?.data ?? []} rowKey={(r) => r.id} loading={q.isFetching} empty={<EmptyState icon="shield-check" title="The do-not-email list is empty" description="People who unsubscribe or whose address bounces are added automatically." />} />
      {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
      {adding && <AddSuppressions onClose={() => setAdding(false)} onDone={() => qc.invalidateQueries({ queryKey: ['email-campaigns'] })} />}
    </Card>
  );
}

function AddSuppressions({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [emails, setEmails] = useState('');
  const [reason, setReason] = useState('MANUAL');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; alreadyListed: number; invalid: number }>('/email-campaigns/suppressions', { emails, reasonCode: reason, note });
      toast.success(`${plural(r.added, 'address', 'addresses')} added${r.alreadyListed ? `, ${r.alreadyListed} already listed` : ''}${r.invalid ? `, ${r.invalid} invalid skipped` : ''}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to the do-not-email list"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="shield-off" onClick={save} loading={busy} disabled={!emails.trim()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="E-mail addresses" required help="Paste one or many, separated by new lines, commas or spaces">
          <Textarea rows={6} value={emails} onChange={(e) => setEmails(e.target.value)} className="font-mono text-xs" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Reason">
            <LookupSelect category="EMAIL_SUPPRESSION_REASON" value={reason} onChange={setReason} clearable={false} />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. asked by phone" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
