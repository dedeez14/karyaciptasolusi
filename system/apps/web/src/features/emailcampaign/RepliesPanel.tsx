import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime, plural } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, EmptyState, Icon, LookupSelect, Pagination, Spinner, Switch, toast } from '@/components/ui';
import { InboxBanner, useStatusLookup, type InboxStatus, type ReplyRow } from './common';

const ENTITY_LINK: Record<string, (id: string) => string> = {
  LEAD: (id) => `/r/leads?open=${id}`,
  CUSTOMER: (id) => `/r/customers?open=${id}`,
};

function mailto(r: ReplyRow) {
  const subject = r.subject ? (/^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`) : '';
  return `mailto:${encodeURIComponent(r.fromEmail)}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}

/**
 * Replies, automatic replies and bounces found in the mailbox for campaign e-mails.
 * With a campaignId it shows only that campaign (compact card on the campaign page).
 */
export function RepliesPanel({ campaignId, inbox, compact }: { campaignId?: string; inbox?: InboxStatus; compact?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = useSession();
  const canUpdate = can('crm.emailcampaign.update');
  const [kind, setKind] = useState(compact ? '' : 'REPLY');
  const [open, setOpen] = useState(!compact);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(compact ? 5 : 20);
  const kindLookup = useStatusLookup('EMAIL_REPLY_KIND');
  const params = { page, pageSize, kind: kind || undefined, open: open || undefined, campaignId };
  const q = useQuery({ queryKey: ['email-replies', params], queryFn: () => api.get<Paged<ReplyRow>>('/email-campaigns/replies', params), placeholderData: keepPreviousData, refetchInterval: 60_000 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['email-replies'] });
    qc.invalidateQueries({ queryKey: ['email-campaigns'] });
    qc.invalidateQueries({ queryKey: ['email-campaign'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const check = useMutation({
    mutationFn: () => api.post<{ checked: number; replies: number; bounces: number; autoReplies: number }>('/email-campaigns/replies/check'),
    onSuccess: (r) => {
      const found = [r.replies && plural(r.replies, 'reply', 'replies'), r.bounces && plural(r.bounces, 'bounce'), r.autoReplies && plural(r.autoReplies, 'automatic reply', 'automatic replies')].filter(Boolean);
      toast.success(found.length ? `Found ${found.join(', ')}` : r.checked ? `${plural(r.checked, 'new message')} checked, none belongs to a campaign` : 'No new messages in the mailbox');
      refresh();
    },
    onError: (e) => {
      toast.error(e);
      refresh();
    },
  });
  const handled = useMutation({
    mutationFn: (v: { id: string; handled: boolean }) => api.post(`/email-campaigns/replies/${v.id}/handled`, { handled: v.handled }),
    onSuccess: (_r, v) => {
      toast.success(v.handled ? 'Marked as answered' : 'Moved back to open replies');
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const rows = q.data?.data ?? [];
  const lastChecked = inbox?.lastCheckedAt ? `Mailbox checked ${fmtDateTime(inbox.lastCheckedAt)}` : inbox?.configured ? 'Mailbox not checked yet' : null;

  return (
    <Card
      title={compact ? 'Replies' : undefined}
      subtitle={compact ? 'Replies stop the follow-ups for that person automatically' : undefined}
      bodyClass="p-0"
      actions={
        compact && canUpdate && inbox?.configured ? (
          <Button size="sm" variant="outline" icon="refresh-cw" loading={check.isPending} onClick={() => check.mutate()}>
            Check now
          </Button>
        ) : undefined
      }
    >
      {!compact && (
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
          <div className="sm:w-52">
            <LookupSelect
              category="EMAIL_REPLY_KIND"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setPage(1);
              }}
              placeholder="Replies, bounces, automatic"
            />
          </div>
          <Switch
            checked={open}
            onChange={(v) => {
              setOpen(v);
              setPage(1);
            }}
            label="Only not answered yet"
          />
          <div className="flex items-center gap-3 sm:ml-auto">
            {lastChecked && <span className="text-xs text-slate-500">{lastChecked}</span>}
            {canUpdate && inbox?.configured && (
              <Button size="sm" variant="outline" icon="refresh-cw" loading={check.isPending} onClick={() => check.mutate()}>
                Check mailbox now
              </Button>
            )}
          </div>
        </div>
      )}
      {!compact && (
        <div className="px-3 pt-3 empty:hidden">
          <InboxBanner inbox={inbox} />
        </div>
      )}
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-brand-700" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="mail-check"
          title={open && !compact ? 'No replies waiting' : 'No replies yet'}
          description={
            compact
              ? 'When someone answers, the reply shows up here within about 5 minutes and their follow-ups stop.'
              : 'Replies to campaign e-mails appear here within about 5 minutes. Each reply also creates an e-mail activity on the lead, so the lead owner sees it in their tasks.'
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const k = kindLookup(r.kindCode);
            const link = r.contact?.entityType && r.contact.entityId ? ENTITY_LINK[r.contact.entityType]?.(r.contact.entityId) : undefined;
            return (
              <li key={r.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${r.handledAt ? 'bg-slate-50/60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-800">{r.fromName || r.contact?.name || r.fromEmail}</span>
                    {(r.fromName || r.contact?.name) && <span className="text-xs text-slate-500">{r.fromEmail}</span>}
                    <Badge color={k?.color} dot>
                      {k?.label ?? r.kindCode}
                    </Badge>
                    {r.handledAt && (
                      <Badge tone="green">
                        <Icon name="check" className="h-3 w-3" /> Answered
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmtDateTime(r.receivedAt)}
                    {r.contact?.company ? ` · ${r.contact.company}` : ''}
                    {r.campaign && !compact && (
                      <>
                        {' · '}
                        <Link to={`/crm/email-campaigns/${r.campaign.id}`} className="text-brand-700 hover:underline">
                          {r.campaign.code}
                        </Link>
                      </>
                    )}
                  </p>
                  {r.subject && <p className="mt-1 truncate text-sm text-slate-700">{r.subject}</p>}
                  {r.snippet && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{r.kindCode === 'BOUNCE' ? r.snippet : `“${r.snippet}”`}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {link && (
                    <Button size="sm" variant="ghost" icon="user-round" onClick={() => navigate(link)}>
                      {r.contact?.entityType === 'CUSTOMER' ? 'Customer' : 'Lead'}
                    </Button>
                  )}
                  {r.kindCode !== 'BOUNCE' && (
                    <Button size="sm" variant="ghost" icon="reply" title="Opens your e-mail program" onClick={() => (window.location.href = mailto(r))}>
                      Reply
                    </Button>
                  )}
                  {canUpdate && r.kindCode === 'REPLY' && (
                    <Button size="sm" variant={r.handledAt ? 'ghost' : 'outline'} icon={r.handledAt ? 'undo-2' : 'check'} loading={handled.isPending && handled.variables?.id === r.id} onClick={() => handled.mutate({ id: r.id, handled: !r.handledAt })}>
                      {r.handledAt ? 'Reopen' : 'Answered'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {q.data && q.data.meta.total > pageSize && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
    </Card>
  );
}
