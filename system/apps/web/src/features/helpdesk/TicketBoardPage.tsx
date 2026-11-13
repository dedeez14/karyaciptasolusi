import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useLookups } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, cn, EmptyState, Icon, Input, LookupSelect, PageHeader, Spinner, toast } from '@/components/ui';
import { SlaBadge, TICKET_LOOKUPS, type TicketRow } from './common';
import { TicketFormDrawer } from './TicketFormDrawer';
import { Select } from '@/components/ui';

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export default function TicketBoardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, me } = useSession();
  const lk = useLookups(TICKET_LOOKUPS);
  const statuses = lk.TICKET_STATUS ?? [];
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [priority, setPriority] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const qText = useDebounce(search, 300);
  const params = { pageSize: 500, sort: 'createdAt', order: 'desc', search: qText, assignee: assignee ?? undefined, priority: priority || undefined, status: showClosed ? undefined : statuses.filter((s) => s.value !== 'CLOSED').map((s) => s.value).join(',') || undefined };
  const key = ['helpdesk', 'board', params];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Paged<TicketRow>>('/helpdesk/tickets', params), placeholderData: keepPreviousData, enabled: statuses.length > 0 });
  const canMove = can('support.ticket.update');

  const byStatus = useMemo(() => {
    const m = new Map<string, TicketRow[]>(statuses.map((s) => [s.value, []]));
    for (const t of q.data?.data ?? []) m.get(t.statusCode)?.push(t);
    // most urgent first, then oldest due date
    for (const list of m.values()) list.sort((a, b) => (PRIORITY_RANK[a.priorityCode] ?? 9) - (PRIORITY_RANK[b.priorityCode] ?? 9) || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
    return m;
  }, [q.data, statuses]);

  const move = async (id: string, statusCode: string) => {
    const t = q.data?.data.find((x) => x.id === id);
    if (!t || t.statusCode === statusCode) return;
    qc.setQueryData<Paged<TicketRow>>(key, (old) => (old ? { ...old, data: old.data.map((x) => (x.id === id ? { ...x, statusCode } : x)) } : old));
    try {
      await api.post(`/helpdesk/tickets/${id}/move`, { statusCode });
    } catch (e) {
      toast.error(e);
    } finally {
      qc.invalidateQueries({ queryKey: ['helpdesk'] });
    }
  };

  const columns = statuses.filter((s) => showClosed || s.value !== 'CLOSED');
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Ticket Board"
        subtitle={q.data ? `${q.data.meta.total} tickets` : undefined}
        actions={
          <>
            <Button variant="outline" icon="list" onClick={() => navigate('/helpdesk/tickets')}>
              List
            </Button>
            {can('support.ticket.create') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New ticket
              </Button>
            )}
          </>
        }
      />
      <div className="card mb-4 grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_1fr_auto]">
        <div className="relative">
          <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <div className="min-w-0 flex-1">
            <AsyncSelect resource="users" value={assignee !== 'me' ? assignee : null} onChange={setAssignee} placeholder={assignee === 'me' ? 'Me' : 'All assignees'} />
          </div>
          <Button variant={assignee === 'me' || assignee === me?.user.id ? 'secondary' : 'outline'} onClick={() => setAssignee(assignee === 'me' ? null : 'me')}>
            Me
          </Button>
        </div>
        <LookupSelect category="TICKET_PRIORITY" value={priority} onChange={setPriority} placeholder="All priorities" />
        <Button variant={showClosed ? 'secondary' : 'outline'} icon={showClosed ? 'eye' : 'eye-off'} onClick={() => setShowClosed((v) => !v)}>
          Closed
        </Button>
      </div>
      {!statuses.length || q.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <div className="-mx-4 flex flex-1 snap-x gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {columns.map((s) => {
            const list = byStatus.get(s.value) ?? [];
            const color = s.color ?? '#64748b';
            return (
              <section
                key={s.value}
                className={cn('flex w-[290px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-slate-50/80', over === s.value && dragId && 'ring-2 ring-brand-300')}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOver(s.value);
                }}
                onDragLeave={() => setOver((o) => (o === s.value ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) move(dragId, s.value);
                  setDragId(null);
                  setOver(null);
                }}
              >
                <header className="flex items-center gap-2 rounded-t-2xl border-b border-line bg-white px-3 py-2.5" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <h3 className="flex-1 truncate text-sm font-semibold text-slate-900">{s.label}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{list.length}</span>
                </header>
                <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: 'calc(100dvh - 300px)' }}>
                  {list.map((t) => {
                    const p = lk.TICKET_PRIORITY?.find((o) => o.value === t.priorityCode);
                    return (
                      <article
                        key={t.id}
                        draggable={canMove}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', t.id);
                          setDragId(t.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onClick={() => navigate(`/helpdesk/tickets/${t.id}`)}
                        className={cn('cursor-pointer rounded-xl border border-line bg-white p-3 shadow-card transition hover:border-brand-200 hover:shadow-pop', dragId === t.id && 'opacity-50')}
                        style={{ borderLeft: `3px solid ${p?.color ?? '#cbd5e1'}` }}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-brand-700">{t.code}</span>
                          <Badge color={p?.color}>{p?.label ?? t.priorityCode}</Badge>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm font-medium text-slate-900">{t.subject}</p>
                        {(t.customerName || t.contactName) && <p className="mt-0.5 truncate text-xs text-slate-500">{t.customerName ?? t.contactName}</p>}
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <SlaBadge t={t} compact />
                          <span className="flex items-center gap-2 text-xs text-slate-500">
                            {t.messageCount > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Icon name="message-square" className="h-3 w-3" />
                                {t.messageCount}
                              </span>
                            )}
                            {t.assigneeName ? (
                              <span title={t.assigneeName} className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                                {t.assigneeName.charAt(0).toUpperCase()}
                              </span>
                            ) : (
                              <Icon name="user-x" className="h-4 w-4 text-slate-300" />
                            )}
                          </span>
                        </div>
                        {canMove && (
                          <Select
                            aria-label="Move to"
                            className="mt-2 h-8 w-full bg-slate-50 px-2 text-xs text-slate-600 md:hidden"
                            value={t.statusCode}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => move(t.id, e.target.value)}
                            options={statuses.map((o) => ({ value: o.value, label: o.label }))}
                          />
                        )}
                      </article>
                    );
                  })}
                  {list.length === 0 && <p className="py-6 text-center text-xs text-slate-400">{dragId ? 'Drop here' : 'No tickets'}</p>}
                </div>
              </section>
            );
          })}
          {!columns.length && <EmptyState icon="columns-3" title="No ticket statuses" />}
        </div>
      )}
      <TicketFormDrawer open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/helpdesk/tickets/${id}`)} />
    </div>
  );
}
