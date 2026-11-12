import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtDateTime, getLocale } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DataTable, DatePicker, Dropdown, EmptyState, Field, Icon, Input, LookupSelect, Modal, Pagination, PageHeader, Spinner, StatCard, toast, type Column } from '@/components/ui';
import { EmailFrame, InboxBanner, SmtpWarning, StatusBadge, useStatusLookup, type CampaignDetail } from './common';
import { RepliesPanel } from './RepliesPanel';

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
  step: number;
  lastSentAt: string | null;
  nextSendAt: string | null;
  repliedAt: string | null;
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
  const [testing, setTesting] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const { can } = useSession();
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
  const markReplied = useMutation({
    mutationFn: (r: RecipientRow) => api.post(`/email-campaigns/${id}/recipients/${r.id}/replied`),
    onSuccess: (_x, r) => {
      toast.success(`${r.email} marked as replied: no more follow-ups`);
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
  const hasSteps = c.steps.length > 0;
  const totalEmails = c.steps.length + 1;
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
  const openPreview = async (email?: string, step?: number) => {
    try {
      setPreview(await api.get<{ subject: string; html: string }>(`/email-campaigns/${id}/preview`, { email, step: step || undefined }));
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
    ...(hasSteps
      ? [
          {
            key: 'sequence',
            header: 'Sequence',
            hideOnMobile: true,
            render: (r: RecipientRow) =>
              !r.sentAt ? (
                <span className="text-xs text-slate-400">—</span>
              ) : (
                <div className="text-xs whitespace-nowrap">
                  <span className="font-medium text-slate-700">
                    {r.step + 1} of {totalEmails} sent
                  </span>
                  {r.repliedAt ? (
                    <span className="block text-violet-700">Replied {fmtDateTime(r.repliedAt)}</span>
                  ) : r.nextSendAt ? (
                    <span className="block text-slate-500">Next {fmtDateTime(r.nextSendAt)}</span>
                  ) : r.step + 1 >= totalEmails ? (
                    <span className="block text-emerald-700">Sequence finished</span>
                  ) : (
                    <span className="block text-slate-500">Stopped</span>
                  )}
                </div>
              ),
          },
        ]
      : []),
    ...(c.trackOpens ? [{ key: 'openedAt', header: 'Opened', hideOnMobile: true, render: (r: RecipientRow) => <span className="text-xs whitespace-nowrap">{r.openedAt ? fmtDateTime(r.openedAt) : '—'}</span> }] : []),
    ...(can('crm.emailcampaign.update')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: RecipientRow) =>
              r.sentAt && !r.repliedAt && ['SENT'].includes(r.statusCode) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="message-square-reply"
                  title="Replied by phone, WhatsApp or another mailbox: stop the follow-ups"
                  loading={markReplied.isPending && markReplied.variables?.id === r.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    markReplied.mutate(r);
                  }}
                >
                  Mark replied
                </Button>
              ) : null,
          },
        ]
      : []),
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
              <Button icon="send" loading={act.isPending && act.variables === 'send-now'} onClick={() =>
                  run(
                    'send-now',
                    'Send now?',
                    (c.automatic ? 'E-mails go out right away within the sending limits, and new matching contacts keep receiving it until you pause or cancel.' : c.totalCount ? `${c.totalCount === 1 ? '1 recipient receives' : `${c.totalCount} recipients receive`} this e-mail within the sending limits.` : 'Everyone in the audience receives this e-mail within the sending limits.') +
                      (hasSteps ? ` ${c.steps.length === 1 ? '1 follow-up follows' : `${c.steps.length} follow-ups follow`} for those who do not reply (day ${c.steps.reduce<number[]>((a, st) => [...a, (a[a.length - 1] ?? 0) + st.delayDays], []).join(', day ')}).` : ''),
                  )
                }>
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
                { label: 'Send a test e-mail', icon: 'flask-conical', onClick: () => setTesting(0), hidden: !c.can.test },
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
      {!['DRAFT', 'CANCELLED'].includes(c.statusCode) && <InboxBanner inbox={c.inbox} followUps={hasSteps} />}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Recipients" value={c.totalCount.toLocaleString(getLocale())} hint={queued ? `${queued} waiting` : c.automatic ? 'Grows with new contacts' : undefined} icon="users" />
        <StatCard label="Reached" value={c.sentCount.toLocaleString(getLocale())} hint={hasSteps ? `${c.sequence.reduce((a, x) => a + x.sent, 0).toLocaleString(getLocale())} e-mails incl. follow-ups` : undefined} icon="send" tone="green" />
        <StatCard label="Replied" value={c.replyCount.toLocaleString(getLocale())} hint={c.sentCount ? `${Math.round((c.replyCount / c.sentCount) * 100)}% of reached` : 'Replies stop the follow-ups'} icon="message-square-reply" tone="violet" />
        <StatCard label="Failed / bounced" value={c.failedCount.toLocaleString(getLocale())} icon="mail-x" tone="red" />
        <StatCard label="Unsubscribed" value={c.unsubscribeCount.toLocaleString(getLocale())} icon="user-minus" tone="amber" />
        <StatCard label="Opened" value={c.trackOpens ? c.openCount.toLocaleString(getLocale()) : 'Off'} hint={c.trackOpens && c.sentCount ? `${Math.round((c.openCount / c.sentCount) * 100)}% of sent` : 'Open tracking disabled'} icon="mail-open" tone="violet" />
      </div>

      {c.totalCount > 0 && (
        <Card bodyClass="p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">Progress</span>
            <span className="tabular-nums text-slate-500">
              {done.toLocaleString(getLocale())} / {c.totalCount.toLocaleString(getLocale())} processed · {pct}%
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

      {hasSteps && (
        <Card title="Sequence" subtitle={c.followUpWeekdays ? 'Follow-ups go only to people who have not replied · office hours, Mon–Fri' : 'Follow-ups go only to people who have not replied'} bodyClass="p-0">
          <ol className="divide-y divide-line">
            {c.sequence.map((st, i) => {
              const day = c.sequence.slice(1, i + 1).reduce((a, x) => a + x.delayDays, 0);
              return (
                <li key={st.step} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      {i === 0 ? 'First e-mail' : `Follow-up ${i}`} <span className="font-normal text-slate-500">· day {day}{i > 0 ? ` (${st.delayDays} day${st.delayDays > 1 ? 's' : ''} after the previous one)` : ''}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">{st.subject}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm tabular-nums">
                    <span>
                      <span className="font-semibold text-slate-800">{st.sent.toLocaleString(getLocale())}</span> <span className="text-slate-500">sent</span>
                    </span>
                    {i > 0 && (
                      <span>
                        <span className="font-semibold text-slate-800">{st.waiting.toLocaleString(getLocale())}</span> <span className="text-slate-500">waiting</span>
                      </span>
                    )}
                    <Button size="sm" variant="ghost" icon="eye" aria-label={`Preview ${i === 0 ? 'first e-mail' : `follow-up ${i}`}`} onClick={() => openPreview(undefined, st.step)} />
                    {c.can.test && <Button size="sm" variant="ghost" icon="flask-conical" aria-label={`Send a test of ${i === 0 ? 'the first e-mail' : `follow-up ${i}`}`} onClick={() => setTesting(st.step)} />}
                  </div>
                </li>
              );
            })}
          </ol>
          {c.nextFollowUpAt && <p className="border-t border-line px-4 py-2.5 text-xs text-slate-500">Next follow-up due {fmtDateTime(c.nextFollowUpAt)}{c.statusCode === 'PAUSED' ? ' (paused: resume to send it)' : ''}</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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

      {c.startedAt && <RepliesPanel campaignId={id} inbox={c.inbox} compact />}

      {scheduling && <ScheduleModal id={id} current={c.scheduledAt} onClose={() => setScheduling(false)} onDone={refresh} />}
      {testing !== null && <TestModal id={id} step={testing} onClose={() => setTesting(null)} />}
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

function TestModal({ id, step, onClose }: { id: string; step: number; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/email-campaigns/${id}/test`, { email, step });
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
      title={step ? `Send a test of follow-up ${step}` : 'Send a test e-mail'}
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
