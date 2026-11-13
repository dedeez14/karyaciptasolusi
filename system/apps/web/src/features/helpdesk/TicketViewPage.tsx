import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import { useLookups } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, cn, confirm, Dropdown, EmptyState, Icon, LookupSelect, PageHeader, previewFile, Spinner, Textarea, toast } from '@/components/ui';
import { CLOSED_STATUSES, dueIn, SlaBadge, TICKET_LOOKUPS, type TicketDetail } from './common';
import { TicketFormDrawer } from './TicketFormDrawer';

type Mode = 'reply' | 'note' | 'customer';

export default function TicketViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const lk = useLookups(TICKET_LOOKUPS);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<Mode>('reply');
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['helpdesk', 'one', id], queryFn: () => api.get<TicketDetail>(`/helpdesk/tickets/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Ticket not found" description={(q.error as Error)?.message} />;
  const t = q.data;
  const opt = (cat: string, code: string | null) => lk[cat]?.find((o) => o.value === code);
  const refresh = () => qc.invalidateQueries({ queryKey: ['helpdesk'] });

  const patch = async (data: Record<string, unknown>, msg = 'Ticket updated') => {
    setBusy('patch');
    try {
      await api.patch(`/helpdesk/tickets/${t.id}`, data);
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    if (!body.trim()) return;
    setBusy('send');
    try {
      const m = await api.post<{ emailedTo?: string | null }>(`/helpdesk/tickets/${t.id}/messages`, { body: body.trim(), isInternal: mode === 'note', fromCustomer: mode === 'customer' });
      if (m.emailedTo) toast.success(`Reply sent and e-mailed to ${m.emailedTo}`);
      setBody('');
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const removeMessage = async (messageId: string) => {
    if (!(await confirm({ title: 'Delete this message?', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/helpdesk/tickets/${t.id}/messages/${messageId}`);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ticket ${t.code}?`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/helpdesk/tickets/${t.id}`);
      toast.success('Ticket deleted');
      refresh();
      navigate('/helpdesk/tickets', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      fd.append('entityType', 'TICKET');
      fd.append('entityId', t.id);
      await api.post('/files/upload', fd);
      toast.success('Attachment uploaded');
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const rate = async (n: number) => {
    try {
      await api.post(`/helpdesk/tickets/${t.id}/rate`, { satisfaction: n });
      toast.success('Rating saved');
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const status = opt('TICKET_STATUS', t.statusCode);
  const isClosed = CLOSED_STATUSES.includes(t.statusCode);
  const modes: { value: Mode; label: string; icon: string }[] = [
    { value: 'reply', label: 'Reply', icon: 'reply' },
    ...(t.canEdit
      ? [
          { value: 'note' as Mode, label: 'Internal note', icon: 'lock' },
          { value: 'customer' as Mode, label: 'Customer message', icon: 'user-round' },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">{t.code}</span> {t.subject}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge color={status?.color} dot>
              {status?.label ?? t.statusCode}
            </Badge>
            <SlaBadge t={t} />
            <span>Opened {fmtDateTime(t.createdAt)} by {t.createdByName ?? 'system'}</span>
          </span>
        }
        back={() => navigate('/helpdesk/tickets')}
        actions={
          <>
            {t.canEdit && !isClosed && (
              <Button variant="success" icon="circle-check" loading={busy === 'patch'} onClick={() => patch({ statusCode: 'RESOLVED' }, 'Ticket resolved')}>
                Resolve
              </Button>
            )}
            {t.canEdit && isClosed && (
              <Button variant="outline" icon="rotate-ccw" loading={busy === 'patch'} onClick={() => patch({ statusCode: 'IN_PROGRESS' }, 'Ticket reopened')}>
                Reopen
              </Button>
            )}
            {t.canEdit && (
              <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {t.canDelete && <Dropdown trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />} items={[{ label: 'Delete ticket', icon: 'trash-2', danger: true, onClick: remove }]} />}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Conversation" bodyClass="p-0">
            <div className="space-y-4 p-5">
              {t.description && (
                <Bubble author={t.contactName ?? t.customerName ?? 'Customer'} at={t.createdAt} kind="customer">
                  {t.description}
                </Bubble>
              )}
              {t.messages.map((m) => (
                <Bubble key={m.id} author={m.authorName} at={m.createdAt} kind={m.isInternal ? 'note' : m.fromCustomer ? 'customer' : 'staff'} onDelete={m.mine || t.canEdit ? () => removeMessage(m.id) : undefined}>
                  {m.body}
                </Bubble>
              ))}
              {!t.description && !t.messages.length && <p className="py-6 text-center text-sm text-slate-400">No messages yet.</p>}
            </div>
            <div className="border-t border-line p-4">
              <div className="mb-2 flex flex-wrap gap-1">
                {modes.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium', mode === m.value ? (m.value === 'note' ? 'bg-amber-100 text-amber-800' : 'bg-brand-50 text-brand-700') : 'text-slate-500 hover:bg-slate-100')}
                  >
                    <Icon name={m.icon} className="h-3.5 w-3.5" />
                    {m.label}
                  </button>
                ))}
              </div>
              <Textarea
                rows={3}
                value={body}
                maxLength={20000}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
                }}
                placeholder={mode === 'note' ? 'Only visible to the team...' : mode === 'customer' ? 'What did the customer say (phone, WhatsApp, e-mail)?' : 'Write the answer to the customer...'}
                className={mode === 'note' ? 'bg-amber-50/60' : undefined}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="hidden text-xs text-slate-400 sm:block">Ctrl + Enter to send</span>
                <Button icon="send" loading={busy === 'send'} disabled={!body.trim()} onClick={send}>
                  {mode === 'note' ? 'Add note' : mode === 'customer' ? 'Log message' : 'Send reply'}
                </Button>
              </div>
            </div>
          </Card>

          <Card
            title="Attachments"
            actions={
              can('files.file.upload') && (
                <>
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
                  <Button size="sm" variant="secondary" icon="upload" loading={busy === 'upload'} onClick={() => fileInput.current?.click()}>
                    Upload
                  </Button>
                </>
              )
            }
          >
            {t.files.length ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {t.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
                      <Icon name={f.mimeType.startsWith('image/') ? 'image' : f.mimeType === 'application/pdf' ? 'file-text' : 'file'} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{f.name}</p>
                      <p className="text-xs text-slate-500">{fmtBytes(f.size)}</p>
                    </div>
                    {(f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf') && (
                      <button type="button" aria-label="Preview" className="text-slate-400 hover:text-brand-600" onClick={() => previewFile({ path: `/files/${f.id}/download`, title: f.name }).catch(toast.error)}>
                        <Icon name="eye" className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" aria-label="Download" className="text-slate-400 hover:text-brand-600" onClick={() => download(`/files/${f.id}/download`).catch(toast.error)}>
                      <Icon name="download" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No attachments.</p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Properties">
            <div className="space-y-3 text-sm">
              <Prop label="Status">
                <LookupSelect category="TICKET_STATUS" value={t.statusCode} onChange={(v) => v && patch({ statusCode: v })} disabled={!t.canEdit} clearable={false} />
              </Prop>
              <Prop label="Priority">
                <LookupSelect category="TICKET_PRIORITY" value={t.priorityCode} onChange={(v) => v && patch({ priorityCode: v }, 'Priority changed, SLA target updated')} disabled={!t.canEdit} clearable={false} />
              </Prop>
              <Prop label="Assignee">
                {t.canEdit ? <AsyncSelect resource="users" value={t.assigneeId} initialLabel={t.assigneeName ?? undefined} onChange={(v) => patch({ assigneeId: v ?? null }, v ? 'Ticket assigned' : 'Assignee removed')} placeholder="Unassigned" /> : <p className="font-medium">{t.assigneeName ?? 'Unassigned'}</p>}
              </Prop>
              <Prop label="Category">
                <LookupSelect category="TICKET_CATEGORY" value={t.categoryCode ?? ''} onChange={(v) => patch({ categoryCode: v || null })} disabled={!t.canEdit} />
              </Prop>
            </div>
          </Card>
          <Card title="Customer">
            <dl className="space-y-3 text-sm">
              <Info label="Customer" value={t.customerName} />
              <Info label="Contact" value={t.contactName} />
              <Info label="E-mail" value={t.contactEmail && <a className="text-brand-700 hover:underline" href={`mailto:${t.contactEmail}`}>{t.contactEmail}</a>} />
              <Info label="Phone" value={t.contactPhone && <a className="text-brand-700 hover:underline" href={`tel:${t.contactPhone}`}>{t.contactPhone}</a>} />
              <Info label="Project" value={t.projectName} />
              <Info label="Received via" value={opt('TICKET_CHANNEL', t.channelCode)?.label} />
            </dl>
          </Card>
          <Card title="Service level">
            <dl className="space-y-3 text-sm">
              <Info label="Resolution target" value={t.dueAt ? `${fmtDateTime(t.dueAt)}${!t.resolvedAt ? ` (${dueIn(t.dueAt)})` : ''}` : 'No target'} />
              <Info label="First response" value={t.firstResponseAt ? fmtDateTime(t.firstResponseAt) : 'Not answered yet'} />
              <Info label="Resolved" value={t.resolvedAt ? fmtDateTime(t.resolvedAt) : null} />
              <Info label="Closed" value={t.closedAt ? fmtDateTime(t.closedAt) : null} />
            </dl>
            {isClosed && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs font-medium text-slate-500">Customer satisfaction</p>
                <div className="mt-1 flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n} stars`} onClick={() => rate(n)} className={cn('transition-colors', (t.satisfaction ?? 0) >= n ? 'text-amber-400' : 'text-slate-200 hover:text-amber-300')}>
                      <Icon name="star" className="h-5 w-5 fill-current" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
      <TicketFormDrawer open={editing} onClose={() => setEditing(false)} ticket={t} />
    </div>
  );
}

function Bubble({ author, at, kind, children, onDelete }: { author: string; at: string; kind: 'customer' | 'staff' | 'note'; children: React.ReactNode; onDelete?: () => void }) {
  return (
    <div className={cn('group flex gap-3', kind === 'staff' && 'flex-row-reverse')}>
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', kind === 'customer' ? 'bg-slate-100 text-slate-600' : kind === 'note' ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>
        {kind === 'note' ? <Icon name="lock" className="h-3.5 w-3.5" /> : author.charAt(0).toUpperCase()}
      </div>
      <div className={cn('max-w-[85%] min-w-0 rounded-2xl px-4 py-2.5', kind === 'customer' ? 'rounded-tl-sm bg-slate-100' : kind === 'note' ? 'rounded-tl-sm border border-amber-200 bg-amber-50' : 'rounded-tr-sm bg-brand-50')}>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{author}</span>
          {kind === 'note' && <span className="text-amber-700">Internal note</span>}
          <span>{fmtDateTime(at)}</span>
          {onDelete && (
            <button type="button" aria-label="Delete message" onClick={onDelete} className="text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-600">
              <Icon name="trash-2" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1 text-sm break-words whitespace-pre-line text-slate-800">{children}</p>
      </div>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
