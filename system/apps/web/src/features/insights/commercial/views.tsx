import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtCompact, fmtDate, fmtNumber, getLocale } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { Badge, Button, cn, Icon, toast } from '@/components/ui';
import type { ResourceMeta, Row } from '@/features/resources/types';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { Avatar, LookupBadge, money, Progress } from '../shared';
import type { ProjectStats } from './ProjectPage';
import { Select } from '@/components/ui';

const cardCls = 'card group flex flex-col p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-pop';

// ------------------------------------------------------------------ customers / suppliers
export function PartnerCardsView({ rows, open }: ResourceViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {rows.map((r) => (
        <button key={r.id} type="button" onClick={() => open(r)} className={cn(cardCls, r.isActive === false && 'opacity-60')}>
          <div className="flex items-start gap-3">
            <Avatar name={r.name} size="lg" className="rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{r.name}</p>
              <p className="font-mono text-[10px] text-slate-400">{r.code}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r._labels?.groupId && <Badge tone="violet">{r._labels.groupId}</Badge>}
                {r._labels?.industryCode && <Badge>{r._labels.industryCode}</Badge>}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-slate-600">
            {r.contactPerson && (
              <p className="flex items-center gap-2 truncate">
                <Icon name="user" className="h-3.5 w-3.5 text-slate-400" />
                {r.contactPerson}
              </p>
            )}
            {r.email && (
              <p className="flex items-center gap-2 truncate">
                <Icon name="mail" className="h-3.5 w-3.5 text-slate-400" />
                <span className="truncate">{r.email}</span>
              </p>
            )}
            {r.phone && (
              <p className="flex items-center gap-2">
                <Icon name="phone" className="h-3.5 w-3.5 text-slate-400" />
                {r.phone}
              </p>
            )}
            {(r.city || r._labels?.countryCode) && (
              <p className="flex items-center gap-2 truncate">
                <Icon name="map-pin" className="h-3.5 w-3.5 text-slate-400" />
                {[r.city, r._labels?.countryCode].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ products
export function ProductCatalogView({ rows, open }: ResourceViewProps) {
  const ids = rows.map((r) => r.id).join(',');
  const stock = useQuery({
    queryKey: ['insights', 'product-stock', ids],
    queryFn: () => api.get<{ stock: boolean; items: Record<string, number> }>('/insights/products/stock', { ids }),
    enabled: !!ids,
  });
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {rows.map((r) => {
        const qty = stock.data?.items[r.id] ?? 0;
        const isStock = r.type === 'STOCK';
        const low = isStock && Number(r.minStock) > 0 && qty <= Number(r.minStock);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => open(r)}
            className={cn('card group flex flex-col overflow-hidden text-left transition-all hover:-translate-y-0.5 hover:shadow-pop', r.isActive === false && 'opacity-60')}
          >
            <div className="relative flex aspect-[4/3] items-center justify-center bg-slate-50">
              <span className="text-3xl font-semibold text-brand-300">
                {String(r.name ?? '?')
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="absolute top-2 left-2">
                <Badge tone={isStock ? 'blue' : 'gray'}>{r._labels?.type ?? r.type}</Badge>
              </span>
              {stock.data?.stock && isStock && (
                <span
                  className={cn(
                    'absolute right-2 bottom-2 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm',
                    low ? 'bg-red-500 text-white' : qty > 0 ? 'bg-white text-emerald-700' : 'bg-white text-slate-500',
                  )}
                >
                  {qty > 0 ? `${fmtNumber(qty)} ${r._labels?.uomId ?? ''}` : 'Out of stock'}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col p-3">
              <p className="line-clamp-2 text-sm leading-snug font-semibold text-slate-900 group-hover:text-brand-700">{r.name}</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">{r.code}</p>
              {r._labels?.categoryId && <p className="mt-1 truncate text-xs text-slate-500">{r._labels.categoryId}</p>}
              <p className="mt-auto pt-2 text-base font-semibold text-slate-900 tabular-nums">{money(r.salePrice)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ warehouses
export function WarehouseCardsView({ rows, open }: ResourceViewProps) {
  const q = useQuery({
    queryKey: ['insights', 'warehouses'],
    queryFn: () => api.get<{ stock: boolean; items: Record<string, { items: number; qty: number; value: number; low: number }> }>('/insights/warehouses'),
  });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const s = q.data?.items[r.id];
        return (
          <button key={r.id} type="button" onClick={() => open(r)} className={cn(cardCls, r.isActive === false && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                <Icon name="warehouse" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{r.name}</p>
                <p className="truncate text-xs text-slate-500">{[r.code, r._labels?.branchId].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            {q.data?.stock ? (
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{s?.items ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Items</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-900">{fmtCompact(s?.value ?? 0)}</p>
                  <p className="text-[11px] text-slate-500">Value</p>
                </div>
                <div>
                  <p className={cn('text-lg font-semibold', s?.low ? 'text-red-600' : 'text-slate-900')}>{s?.low ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Low stock</p>
                </div>
              </div>
            ) : (
              r.address && <p className="mt-3 line-clamp-2 text-xs text-slate-500">{r.address}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ leads kanban
export function LeadKanbanView({ rows, open, meta, refresh }: ResourceViewProps) {
  const statuses = useLookupOptions('LEAD_STATUS');
  const src = useLookupOptions('LEAD_SOURCE');
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const status = (r: Row) => local[r.id] ?? r.statusCode ?? '';
  const move = async (id: string, code: string) => {
    setLocal((m) => ({ ...m, [id]: code }));
    try {
      await api.patch(`/resources/leads/${id}`, { statusCode: code });
      qc.invalidateQueries({ queryKey: ['resource', 'leads'] });
      refresh();
    } catch (e) {
      setLocal((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
      toast.error(e);
    }
  };
  const cols = [...statuses.map((s) => ({ code: s.value, label: s.label, color: s.color })), ...(rows.some((r) => !status(r)) ? [{ code: '', label: 'No status', color: '#94a3b8' }] : [])];
  return (
    <div className="scrollbar-thin -mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:-mx-4 sm:px-4">
      {cols.map((c) => {
        const list = rows.filter((r) => status(r) === c.code);
        const value = list.reduce((a, r) => a + Number(r.estimatedValue ?? 0), 0);
        return (
          <section
            key={c.code || 'none'}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(c.code);
            }}
            onDragLeave={() => setOver((v) => (v === c.code ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && c.code) move(dragId, c.code);
              setDragId(null);
              setOver(null);
            }}
            className={cn('flex w-[270px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-slate-50/80', over === c.code && 'ring-2 ring-brand-300')}
          >
            <header className="rounded-t-2xl border-b border-line bg-white px-3 py-2.5" style={{ boxShadow: `inset 0 3px 0 ${c.color ?? '#2563eb'}` }}>
              <div className="flex items-center gap-2">
                <h3 className="flex-1 truncate text-sm font-semibold text-slate-900">{c.label}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{list.length}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{fmtCompact(value)} estimated</p>
            </header>
            <div className="flex min-h-24 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: 'calc(100dvh - 360px)' }}>
              {list.map((r) => (
                <div
                  key={r.id}
                  draggable={meta.can.update}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', r.id);
                    setDragId(r.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => open(r)}
                  className={cn('cursor-pointer rounded-xl border border-line bg-white p-3 shadow-card transition-all hover:shadow-pop', dragId === r.id && 'opacity-40')}
                >
                  <div className="flex items-start gap-2">
                    <Avatar name={r.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{r.name}</p>
                      {r.companyName && <p className="truncate text-xs text-slate-500">{r.companyName}</p>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <LookupBadge options={src} value={r.sourceCode} />
                    {r.customerId && <Badge tone="green">Customer</Badge>}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-800 tabular-nums">{Number(r.estimatedValue) ? money(r.estimatedValue) : ''}</span>
                    <span className="truncate pl-2">{r._labels?.ownerId ?? ''}</span>
                  </div>
                  {meta.can.update && (
                    <Select
                      aria-label="Move to status"
                      className="mt-2 h-8 w-full px-2 text-xs text-slate-600 md:hidden"
                      value={status(r)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => e.target.value && move(r.id, e.target.value)}
                      options={statuses.map((s) => ({ value: s.value, label: `Move to: ${s.label}` }))}
                    />
                  )}
                </div>
              ))}
              {!list.length && <p className="py-6 text-center text-xs text-slate-400">{c.code ? 'Drop leads here' : 'Empty'}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ CRM activities agenda
export function ActivityAgendaView({ rows, open, meta, refresh }: ResourceViewProps) {
  const types = useLookupOptions('ACTIVITY_TYPE');
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const done = (r: Row) => local[r.id] ?? !!r.isDone;
  const groups = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endToday = startToday + 86400_000;
    const endWeek = startToday + 7 * 86400_000;
    const g: Record<string, Row[]> = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
    for (const r of rows) {
      if (done(r)) g.done.push(r);
      else if (!r.dueDate) g.none.push(r);
      else {
        const t = new Date(r.dueDate).getTime();
        if (t < startToday) g.overdue.push(r);
        else if (t < endToday) g.today.push(r);
        else if (t < endWeek) g.week.push(r);
        else g.later.push(r);
      }
    }
    for (const k of Object.keys(g)) g[k].sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')));
    g.done.reverse();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, local]);
  const toggle = async (r: Row) => {
    const v = !done(r);
    setLocal((m) => ({ ...m, [r.id]: v }));
    try {
      await api.patch(`/resources/crm-activities/${r.id}`, { isDone: v });
      qc.invalidateQueries({ queryKey: ['resource', 'crm-activities'] });
      refresh();
    } catch (e) {
      setLocal((m) => ({ ...m, [r.id]: !v }));
      toast.error(e);
    }
  };
  const SECTIONS: { key: string; label: string; icon: string; tone: string }[] = [
    { key: 'overdue', label: 'Overdue', icon: 'alarm-clock', tone: 'text-red-600' },
    { key: 'today', label: 'Today', icon: 'sun', tone: 'text-brand-700' },
    { key: 'week', label: 'Next 7 days', icon: 'calendar-days', tone: 'text-slate-700' },
    { key: 'later', label: 'Later', icon: 'calendar', tone: 'text-slate-700' },
    { key: 'none', label: 'No due date', icon: 'circle-dashed', tone: 'text-slate-500' },
  ];
  const item = (r: Row) => (
    <li key={r.id} className="flex items-start gap-3 rounded-xl border border-line bg-white p-3 transition-shadow hover:shadow-card">
      <button
        type="button"
        disabled={!meta.can.update}
        onClick={() => toggle(r)}
        className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500 disabled:cursor-default"
        aria-label={done(r) ? 'Mark as not done' : 'Mark as done'}
      >
        <Icon name={done(r) ? 'check-circle-2' : 'circle'} className={cn('h-5 w-5', done(r) && 'text-emerald-500')} />
      </button>
      <button type="button" onClick={() => open(r)} className="min-w-0 flex-1 text-left">
        <p className={cn('text-sm font-medium text-slate-900', done(r) && 'text-slate-400 line-through')}>{r.subject}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <LookupBadge options={types} value={r.typeCode} />
          {r.dueDate && (
            <span className="flex items-center gap-1">
              <Icon name="clock" className="h-3 w-3" />
              {new Date(r.dueDate).toLocaleString(getLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {(r._labels?.customerId || r._labels?.leadId || r._labels?.opportunityId) && (
            <span className="flex items-center gap-1 truncate">
              <Icon name="link" className="h-3 w-3" />
              {r._labels?.customerId ?? r._labels?.leadId ?? r._labels?.opportunityId}
            </span>
          )}
          {r._labels?.ownerId && <span className="truncate">· {r._labels.ownerId}</span>}
        </p>
      </button>
    </li>
  );
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {SECTIONS.filter((s) => groups[s.key].length).map((s) => (
        <section key={s.key}>
          <h3 className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', s.tone)}>
            <Icon name={s.icon} className="h-4 w-4" />
            {s.label}
            <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-500">{groups[s.key].length}</span>
          </h3>
          <ul className="space-y-2">{groups[s.key].map(item)}</ul>
        </section>
      ))}
      {SECTIONS.every((s) => !groups[s.key].length) && <p className="py-6 text-center text-sm text-slate-400 lg:col-span-2">All caught up 🎉</p>}
      {groups.done.length > 0 && (
        <section className="lg:col-span-2">
          <Button variant="ghost" size="sm" icon={showDone ? 'chevron-down' : 'chevron-right'} onClick={() => setShowDone((v) => !v)}>
            Completed ({groups.done.length})
          </Button>
          {showDone && <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">{groups.done.map(item)}</ul>}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ campaigns
export function CampaignCardsView({ rows, open }: ResourceViewProps) {
  const status = useLookupOptions('CAMPAIGN_STATUS');
  const channel = useLookupOptions('CAMPAIGN_CHANNEL');
  const q = useQuery({
    queryKey: ['insights', 'campaigns'],
    queryFn: () =>
      api.get<{ leads: boolean; items: Record<string, { leads: number; pipeline: number; converted: number; opportunities: number; oppAmount: number; won: number }> }>('/insights/campaigns'),
  });
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const s = q.data?.items[r.id];
        const budget = Number(r.budget ?? 0);
        const cost = Number(r.actualCost ?? 0);
        const target = Number(r.targetLeads ?? 0);
        const roi = cost > 0 && s ? ((s.won - cost) / cost) * 100 : null;
        return (
          <button key={r.id} type="button" onClick={() => open(r)} className={cardCls}>
            <div className="flex items-start gap-2">
              <span className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
                <Icon name="megaphone" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{r.name}</p>
                <p className="truncate text-xs text-slate-500">{r.startDate ? `${fmtDate(r.startDate)}${r.endDate ? ` – ${fmtDate(r.endDate)}` : ''}` : r.code}</p>
              </div>
              <LookupBadge options={status} value={r.statusCode} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <LookupBadge options={channel} value={r.channelCode} />
              {r._labels?.ownerId && <Badge>{r._labels.ownerId}</Badge>}
            </div>
            <div className="mt-4 space-y-3 border-t border-line pt-3">
              {q.data?.leads && (
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-500">Leads</span>
                    <span className="font-medium text-slate-800">
                      {s?.leads ?? 0}
                      {target ? ` / ${target}` : ''} · {s?.converted ?? 0} converted
                    </span>
                  </div>
                  {target > 0 && <Progress value={((s?.leads ?? 0) / target) * 100} tone="blue" />}
                </div>
              )}
              {budget > 0 && (
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-500">Spent</span>
                    <span className="font-medium text-slate-800">
                      {fmtCompact(cost)} / {fmtCompact(budget)}
                    </span>
                  </div>
                  <Progress value={(cost / budget) * 100} tone={cost > budget ? 'red' : 'green'} />
                </div>
              )}
              {s && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{s.opportunities}</p>
                    <p className="text-[10px] text-slate-500">Deals</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">{fmtCompact(s.won)}</p>
                    <p className="text-[10px] text-slate-500">Won</p>
                  </div>
                  <div>
                    <p className={cn('text-sm font-semibold', roi !== null && roi < 0 ? 'text-red-600' : 'text-slate-900')}>{roi === null ? '—' : `${Math.round(roi)}%`}</p>
                    <p className="text-[10px] text-slate-500">ROI</p>
                  </div>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ projects
export function ProjectCardsView({ rows, open }: ResourceViewProps) {
  const status = useLookupOptions('PROJECT_STATUS');
  const ids = rows.map((r) => r.id).join(',');
  const q = useQuery({ queryKey: ['insights', 'project-stats', ids], queryFn: () => api.get<{ items: Record<string, ProjectStats> }>('/insights/projects/stats', { ids }), enabled: !!ids });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const s = q.data?.items[r.id];
        const pct = s?.tasks ? Math.round(((s.done ?? 0) / s.tasks) * 100) : 0;
        const late = r.endDate && String(r.endDate).slice(0, 10) < today && !['DONE', 'CANCELLED'].includes(r.statusCode);
        return (
          <button key={r.id} type="button" onClick={() => open(r)} className={cn(cardCls, r.isActive === false && 'opacity-60')}>
            <div className="flex items-start gap-2">
              <span className="rounded-xl bg-brand-50 p-2.5 text-brand-600">
                <Icon name="folder-kanban" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{r.name}</p>
                <p className="truncate text-xs text-slate-500">{r._labels?.customerId ?? r.code}</p>
              </div>
              <LookupBadge options={status} value={r.statusCode} />
            </div>
            {s?.tasks !== null && s !== undefined && (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-500">
                    {s.done} / {s.tasks} tasks
                  </span>
                  <span className="font-medium text-slate-800">{pct}%</span>
                </div>
                <Progress value={pct} tone={pct === 100 ? 'green' : 'blue'} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-slate-500">
              {r.endDate && (
                <span className={cn('flex items-center gap-1', late && 'font-medium text-red-600')}>
                  <Icon name="calendar-clock" className="h-3.5 w-3.5" />
                  {late ? 'Overdue · ' : 'Due '}
                  {fmtDate(r.endDate)}
                </span>
              )}
              {s?.hours ? (
                <span className="flex items-center gap-1">
                  <Icon name="clock" className="h-3.5 w-3.5" />
                  {fmtNumber(s.hours)} h
                </span>
              ) : null}
              {Number(r.budget) > 0 && (
                <span className="flex items-center gap-1">
                  <Icon name="wallet" className="h-3.5 w-3.5" />
                  {s?.costs !== null && s?.costs !== undefined ? `${fmtCompact(s.costs)} / ` : ''}
                  {fmtCompact(r.budget)}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ opportunities: link to the board
export function OpportunityHeader({ meta }: { meta: ResourceMeta }) {
  void meta;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
      <Icon name="square-kanban" className="h-5 w-5 text-brand-600" />
      <p className="flex-1 text-sm text-slate-700">Prefer a visual pipeline? Drag deals between stages on the board.</p>
      <Link to="/crm/pipeline">
        <Button size="sm" icon="arrow-right">
          Open pipeline board
        </Button>
      </Link>
    </div>
  );
}
