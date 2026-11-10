import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, confirm, DataTable, DatePicker, Dropdown, EmptyState, Field, Icon, Input, LookupSelect, Modal, Pagination, PageHeader, Spinner, StatCard, toast, type Column } from '@/components/ui';
import { EmailFrame, SmtpWarning, StatusBadge, useStatusLookup, type CampaignDetail } from './common';

interface RecipientRow {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  entityType: string | null;
  statusCode: string;
  error: string | null;
  sentAt: string | null;
  openedAt: string | null;
  attempts: number;
}

const SOURCE_LABEL: Record<string, string> = { LEAD: 'Lead', CUSTOMER: 'Customer', MAP_PLACE: 'Google Maps', MANUAL: 'Pasted list' };

export default function CampaignViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['email-campaign', id], queryFn: () => api.get<CampaignDetail>(`/email-campaigns/${id}`), refetchInterval: (query) => (query.state.data?.statusCode === 'SENDING' ? 15_000 : false) });
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const recipients = useQuery({
    queryKey: ['email-campaign', id, 'recipients', status, page, pageSize],
    queryFn: () => api.get<Paged<RecipientRow>>(`/email-campaigns/${id}/recipients`, { status: status || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: q.data?.statusCode === 'SENDING' ? 15_000 : false,
  });
  const [scheduling, setScheduling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const recipientStatus = useStatusLookup('EMAIL_RECIPIENT_STATUS');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['email-campaign', id] });
    qc.invalidateQueries({ queryKey: ['email-campaigns'] });
  };
  const act = useMutation({
    mutationFn: (action: string) => api.post(`/email-campaigns/${id}/${action}`),
    onSuccess: (_r, action) => {
      toast.success({ 'send-now': 'Sending started', pause: 'Campaign paused', resume: 'Sending resumed', cancel: 'Campaign cancelled', duplicate: 'Copy created' }[action] ?? 'Done');
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!q.data) return <EmptyState icon="mail-x" title="Campaign not found" />;
  const c = q.data;
  const queued = c.counts.QUEUED ?? 0;
  const done = c.totalCount - queued;
  const pct = c.totalCount ? Math.round((done / c.totalCount) * 100) : 0;

  const run = async (action: string, title?: string, message?: string, danger?: boolean) => {
    if (title && !(await confirm({ title, message, confirmText: title.replace(/\?$/, ''), danger }))) return;
    act.mutate(action);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${c.code}?`, message: 'The campaign and its delivery history are removed from the list. This is recorded in the audit trail.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/email-campaigns/${id}`);
      toast.success('Campaign deleted');
      qc.invalidateQueries({ queryKey: ['email-campaigns'] });
      navigate('/crm/email-campaigns', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };
  const duplicate = async () => {
    try {
      const r = await api.post<{ id: string }>(`/email-campaigns/${id}/duplicate`);
      toast.success('Copy created as draft');
      navigate(`/crm/email-campaigns/${r.id}/edit`);
    } catch (e) {
      toast.error(e);
    }
  };
  const openPreview = async (email?: string) => {
    try {
      setPreview(await api.get<{ subject: string; html: string }>(`/email-campaigns/${id}/preview`, { email }));
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<RecipientRow>[] = [
    {
      key: 'email',
      header: 'Recipient',
      render: (r) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-slate-800">{r.email}</span>
          <span className="block truncate text-xs text-slate-500">{[r.name, r.company].filter(Boolean).join(' · ') || '—'}</span>
        </div>
      ),
    },
    { key: 'source', header: 'Source', hideOnMobile: true, render: (r) => <span className="text-xs text-slate-600">{SOURCE_LABEL[r.entityType ?? ''] ?? '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="space-y-0.5">
          <Badge color={recipientStatus(r.statusCode)?.color} dot>
            {recipientStatus(r.statusCode)?.label ?? r.statusCode}
          </Badge>
          {r.error && <span className="block max-w-72 truncate text-xs text-red-600" title={r.error}>{r.error}</span>}
          {r.attempts > 0 && r.statusCode === 'QUEUED' && <span className="block text-xs text-amber-600">Retry {r.attempts}/3</span>}
        </div>
      ),
    },
    { key: 'sentAt', header: 'Sent', hideOnMobile: true, render: (r) => <span className="text-xs whitespace-nowrap">{r.sentAt ? fmtDateTime(r.sentAt) : '—'}</span> },
    ...(c.trackOpens ? [{ key: 'openedAt', header: 'Opened', hideOnMobile: true, render: (r: RecipientRow) => <span className="text-xs whitespace-nowrap">{r.openedAt ? fmtDateTime(r.openedAt) : '—'}</span> }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        back={() => navigate('/crm/email-campaigns')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.code} <StatusBadge category="EMAIL_CAMPAIGN_STATUS" code={c.statusCode} />
            {c.automatic && (
              <Badge tone="violet">
                <Icon name="repeat" className="h-3 w-3" /> Automatic
              </Badge>
            )}
          </span>
        }
        subtitle={c.name}
        actions={
          <>
            {c.can.sendNow && (
              <Button icon="send" loading={act.isPending && act.variables === 'send-now'} onClick={() => run('send-now', 'Send now?', c.automatic ? 'E-mails go out right away within the sending limits, and new matching contacts keep receiving it until you pause or cancel.' : `About ${c.totalCount || 'all'} recipients receive this e-mail within the sending limits.`)}>
                Send now
              </Button>
            )}
            {c.can.schedule && (
              <Button variant="outline" icon="calendar-clock" onClick={() => setScheduling(true)}>
                {c.statusCode === 'SCHEDULED' ? 'Reschedule' : 'Schedule'}
              </Button>
            )}
            {c.can.resume && (
              <Button icon="play" onClick={() => run('resume')}>
                Resume
              </Button>
            )}
            {c.can.pause && (
              <Button variant="outline" icon="pause" onClick={() => run('pause')}>
                {c.statusCode === 'SCHEDULED' ? 'Unschedule' : 'Pause'}
              </Button>
            )}
            {c.can.edit && (
              <Button variant="outline" icon="pencil" onClick={() => navigate(`/crm/email-campaigns/${id}/edit`)}>
                Edit
              </Button>
            )}
            <Dropdown
              trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="More actions" />}
              items={[
                { label: 'Preview e-mail', icon: 'eye', onClick: () => openPreview() },
                { label: 'Send a test e-mail', icon: 'flask-conical', onClick: () => setTesting(true), hidden: !c.can.test },
                { label: 'Duplicate', icon: 'copy', onClick: duplicate },
                { label: 'Export recipients (Excel)', icon: 'file-spreadsheet', onClick: () => download(`/email-campaigns/${id}/recipients/export`, { format: 'xlsx', status: status || undefined }).catch((e) => toast.error(e)) },
                'divider',
                { label: 'Cancel campaign', icon: 'ban', danger: true, hidden: !c.can.cancel, onClick: () => run('cancel', 'Cancel campaign?', 'E-mails not sent yet are skipped. This cannot be undone.', true) },
                { label: 'Delete', icon: 'trash-2', danger: true, hidden: !c.can.delete, onClick: remove },
              ]}
            />
          </>
        }
      />

      <SmtpWarning ready={c.smtpReady} />
      {c.statusCode === 'PAUSED' && c.pausedReason && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Icon name="circle-pause" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">Paused automatically.</span> {c.pausedReason}
          </p>
        </div>
      )}
      {c.statusCode === 'SCHEDULED' && c.scheduledAt && (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          Scheduled for <strong>{fmtDateTime(c.scheduledAt)}</strong>. Sending starts within a minute of that time.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Recipients" value={c.totalCount.toLocaleString()} hint={queued ? `${queued} waiting` : c.automatic ? 'Grows with new contacts' : undefined} icon="users" />
        <StatCard label="Sent" value={c.sentCount.toLocaleString()} icon="send" tone="green" />
        <StatCard label="Failed / bounced" value={c.failedCount.toLocaleString()} icon="mail-x" tone="red" />
        <StatCard label="Unsubscribed" value={c.unsubscribeCount.toLocaleString()} icon="user-minus" tone="amber" />
        <StatCard label="Opened" value={c.trackOpens ? c.openCount.toLocaleString() : 'Off'} hint={c.trackOpens && c.sentCount ? `${Math.round((c.openCount / c.sentCount) * 100)}% of sent` : 'Open tracking disabled'} icon="mail-open" tone="violet" />
      </div>

      {c.totalCount > 0 && (
        <Card bodyClass="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">Progress</span>
            <span className="tabular-nums text-slate-500">
              {done.toLocaleString()} / {c.totalCount.toLocaleString()} processed · {pct}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {c.startedAt ? `Started ${fmtDateTime(c.startedAt)}` : 'Not started'}
            {c.finishedAt ? ` · finished ${fmtDateTime(c.finishedAt)}` : ''} · up to {c.ratePerMinute} e-mails per minute
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          title="Recipients"
          bodyClass="p-0"
          actions={
            <div className="w-48">
              <LookupSelect
                category="EMAIL_RECIPIENT_STATUS"
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                placeholder="All statuses"
              />
            </div>
          }
        >
          <DataTable
            columns={columns}
            rows={recipients.data?.data ?? []}
            rowKey={(r) => r.id}
            loading={recipients.isFetching}
            onRowClick={(r) => openPreview(r.email)}
            empty={<EmptyState icon="inbox" title={c.statusCode === 'DRAFT' || c.statusCode === 'SCHEDULED' ? 'Recipients are added when sending starts' : 'No recipients in this view'} />}
          />
          {recipients.data && <Pagination page={page} totalPages={recipients.data.meta.totalPages} total={recipients.data.meta.total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
        </Card>
        <Card title="E-mail">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Subject</dt>
              <dd className="font-medium text-slate-800">{c.subject}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Sender</dt>
              <dd className="text-slate-700">{c.fromName || 'Default sender'}{c.replyTo ? ` · replies to ${c.replyTo}` : ''}</dd>
            </div>
            {c.linkedCampaign && (
              <div>
                <dt className="text-xs text-slate-500">Marketing campaign</dt>
                <dd className="text-slate-700">
                  {c.linkedCampaign.code} · {c.linkedCampaign.name}
                </dd>
              </div>
            )}
          </dl>
          <Button className="mt-4 w-full" variant="outline" icon="eye" onClick={() => openPreview()}>
            Preview e-mail
          </Button>
        </Card>
      </div>

      {scheduling && <ScheduleModal id={id} current={c.scheduledAt} onClose={() => setScheduling(false)} onDone={refresh} />}
      {testing && <TestModal id={id} onClose={() => setTesting(false)} />}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.subject ?? 'Preview'} size="lg">
        {preview && <EmailFrame html={preview.html} className="h-[65vh]" />}
      </Modal>
    </div>
  );
}

function ScheduleModal({ id, current, onClose, onDone }: { id: string; current: string | null; onClose: () => void; onDone: () => void }) {
  const init = current ? new Date(current) : new Date(Date.now() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${init.getFullYear()}-${pad(init.getMonth() + 1)}-${pad(init.getDate())}`);
  const [time, setTime] = useState(`${pad(init.getHours())}:${pad(init.getMinutes())}`);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/email-campaigns/${id}/schedule`, { scheduledAt: new Date(`${date}T${time}:00`).toISOString() });
      toast.success('Campaign scheduled');
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
      title="Schedule sending"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="calendar-clock" onClick={save} loading={busy} disabled={!date || !time}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required>
          <DatePicker value={date} onChange={setDate} clearable={false} />
        </Field>
        <Field label="Time" required help="Your local time">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function TestModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/email-campaigns/${id}/test`, { email });
      toast.success(`Test e-mail sent to ${email}`);
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
      title="Send a test e-mail"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="send" onClick={send} loading={busy} disabled={!email.includes('@')}>
            Send test
          </Button>
        </>
      }
    >
      <Field label="Send to" help="Uses the first contact of the audience as example data. The subject starts with [Test].">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
      </Field>
    </Modal>
  );
}
