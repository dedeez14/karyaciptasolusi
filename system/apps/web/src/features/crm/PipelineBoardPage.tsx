import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtCompact, fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, cn, EmptyState, Icon, Input, PageHeader, Spinner, toast } from '@/components/ui';
import { ResourceForm } from '@/features/resources/ResourceForm';
import type { ResourceMeta } from '@/features/resources/types';

interface Stage {
  id: string;
  code: string;
  name: string;
  probability: number;
  sortOrder: number;
  isWon: boolean;
  isLost: boolean;
  isActive: boolean;
}
interface Opp {
  id: string;
  code: string;
  name: string;
  amount: string;
  probability: number;
  stageId: string | null;
  customerId: string | null;
  ownerId: string | null;
  expectedCloseDate: string | null;
  _labels?: Record<string, string>;
}

/** Visual sales pipeline: drag opportunities between stages */
export default function PipelineBoardPage() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const meta = useQuery({ queryKey: ['meta', 'opportunities'], queryFn: () => api.get<ResourceMeta>('/meta/resources/opportunities'), staleTime: 300_000 });
  const stagesQ = useQuery({ queryKey: ['resource', 'pipeline-stages', 'board'], queryFn: () => api.get<Paged<Stage>>('/resources/pipeline-stages', { pageSize: 100, sort: 'sortOrder', order: 'asc' }) });
  const params = { pageSize: 200, search: search || undefined, 'f.ownerId': ownerId ?? undefined, sort: 'expectedCloseDate', order: 'asc' };
  const oppQ = useQuery({ queryKey: ['resource', 'opportunities', 'board', params], queryFn: () => api.get<Paged<Opp>>('/resources/opportunities', params) });
  // open stages first (by board order), then Won, then Lost
  const rank = (s: Stage) => (s.isLost ? 2 : s.isWon ? 1 : 0);
  const stages = (stagesQ.data?.data ?? []).filter((s) => s.isActive).sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder);
  const opps = oppQ.data?.data ?? [];

  const byStage = useMemo(() => {
    const m = new Map<string, Opp[]>();
    for (const s of stages) m.set(s.id, []);
    for (const o of opps) if (o.stageId && m.has(o.stageId)) m.get(o.stageId)!.push(o);
    return m;
  }, [opps, stages]);

  const totals = useMemo(() => {
    const open = opps.filter((o) => {
      const s = stages.find((x) => x.id === o.stageId);
      return s && !s.isWon && !s.isLost;
    });
    return {
      open: open.reduce((a, o) => a + Number(o.amount), 0),
      weighted: open.reduce((a, o) => a + (Number(o.amount) * (stages.find((x) => x.id === o.stageId)?.probability ?? 0)) / 100, 0),
      won: opps.filter((o) => stages.find((x) => x.id === o.stageId)?.isWon).reduce((a, o) => a + Number(o.amount), 0),
    };
  }, [opps, stages]);

  const moveTo = async (id: string, stage: Stage) => {
    const key = ['resource', 'opportunities', 'board', params];
    qc.setQueryData<Paged<Opp>>(key, (old) => (old ? { ...old, data: old.data.map((o) => (o.id === id ? { ...o, stageId: stage.id, probability: stage.probability } : o)) } : old));
    try {
      await api.patch(`/resources/opportunities/${id}`, { stageId: stage.id, probability: stage.probability });
      if (stage.isWon) toast.success('Opportunity won 🎉');
    } catch (e) {
      toast.error(e);
    } finally {
      qc.invalidateQueries({ queryKey: ['resource', 'opportunities'] });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Pipeline Board"
        subtitle="Drag opportunities between stages"
        actions={
          <>
            <Link to="/r/opportunities">
              <Button variant="outline" icon="list">
                List view
              </Button>
            </Link>
            {meta.data?.can.create && (
              <Button icon="plus" onClick={() => setEditing(null)}>
                New opportunity
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Summary label="Open pipeline" value={totals.open} icon="target" tone="from-brand-500 to-brand-600" />
        <Summary label="Weighted forecast" value={totals.weighted} icon="trending-up" tone="from-violet-500 to-violet-600" />
        <Summary label="Won" value={totals.won} icon="trophy" tone="from-emerald-500 to-emerald-600" />
      </div>
      <div className="card mb-4 grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="relative">
          <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search opportunities..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <AsyncSelect resource="users" value={ownerId} onChange={setOwnerId} placeholder="All owners" />
        <Button variant={ownerId === me?.user.id ? 'secondary' : 'outline'} onClick={() => setOwnerId(ownerId === me?.user.id ? null : me?.user.id ?? null)}>
          My deals
        </Button>
      </div>

      {stagesQ.isLoading || oppQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : stages.length === 0 ? (
        <EmptyState icon="git-branch" title="No pipeline stages" description="Add stages in Master Data > Pipeline Stages." />
      ) : (
        <div className="-mx-4 flex flex-1 snap-x gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {stages.map((s) => {
            const list = byStage.get(s.id) ?? [];
            const sum = list.reduce((a, o) => a + Number(o.amount), 0);
            const tone = s.isWon ? '#16a34a' : s.isLost ? '#dc2626' : '#2563eb';
            return (
              <section
                key={s.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(s.id);
                }}
                onDragLeave={() => setOverStage((v) => (v === s.id ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) moveTo(dragId, s);
                  setDragId(null);
                  setOverStage(null);
                }}
                className={cn('flex w-[290px] shrink-0 snap-start flex-col rounded-2xl border border-line', s.isWon ? 'bg-emerald-50/60' : s.isLost ? 'bg-red-50/50' : 'bg-slate-50/80', overStage === s.id && 'ring-2 ring-brand-300')}
              >
                <header className="rounded-t-2xl border-b border-line bg-white px-3 py-2.5" style={{ boxShadow: `inset 0 3px 0 ${tone}` }}>
                  <div className="flex items-center gap-2">
                    <h3 className="flex-1 truncate text-sm font-semibold text-slate-900">{s.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{list.length}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {fmtCompact(sum)} · {s.probability}%
                  </p>
                </header>
                <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: 'calc(100dvh - 380px)' }}>
                  {list.map((o) => (
                    <div
                      key={o.id}
                      draggable={!!meta.data?.can.update}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', o.id);
                        setDragId(o.id);
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => meta.data?.can.update && setEditing(o.id)}
                      className={cn('cursor-pointer rounded-xl border border-line bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop', dragId === o.id && 'opacity-40')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm leading-snug font-medium text-slate-900">{o.name}</p>
                        <span className="font-mono text-[10px] text-slate-400">{o.code}</span>
                      </div>
                      {o._labels?.customerId && (
                        <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
                          <Icon name="building-2" className="h-3 w-3" />
                          {o._labels.customerId}
                        </p>
                      )}
                      <p className="mt-2 text-base font-semibold text-slate-900 tabular-nums">{fmtMoney(o.amount, 0)}</p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{o.expectedCloseDate ? `Close ${fmtDate(o.expectedCloseDate)}` : 'No close date'}</span>
                        <span className="truncate pl-2">{o._labels?.ownerId ?? ''}</span>
                      </div>
                      {meta.data?.can.update && (
                        <select
                          aria-label="Move to stage"
                          className="mt-2 w-full rounded-md border border-line bg-white px-2 py-1 text-xs text-slate-600 md:hidden"
                          value={o.stageId ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const st = stages.find((x) => x.id === e.target.value);
                            if (st) moveTo(o.id, st);
                          }}
                        >
                          {stages.map((x) => (
                            <option key={x.id} value={x.id}>
                              Move to: {x.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                  {list.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Drop deals here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {meta.data && editing !== undefined && can('crm.opportunity.read') && (
        <ResourceForm meta={meta.data} id={editing} open={editing !== undefined} onClose={() => setEditing(undefined)} onSaved={() => qc.invalidateQueries({ queryKey: ['resource', 'opportunities'] })} />
      )}
    </div>
  );
}

function Summary({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <span className={`rounded-xl bg-gradient-to-br ${tone} p-2.5 text-white shadow-sm`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="text-xl font-semibold text-slate-900 tabular-nums">{fmtMoney(value, 0)}</p>
      </div>
    </div>
  );
}
