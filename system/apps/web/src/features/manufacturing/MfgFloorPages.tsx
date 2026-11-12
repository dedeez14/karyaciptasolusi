import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { AsyncSelect, Badge, Button, Card, EmptyState, Input, MonthInput, PageHeader, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { StepFinishModal } from './ManufacturingPages';

interface Step {
  id: string;
  seq: number;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE';
  plannedMinutes: number;
  actualMinutes: number;
  runningSince: string | null;
  workCenter: string;
  workCenterId: string;
  order: { id: string; number: string; qty: number; plannedDate: string };
  product: string;
  uom: string;
  ready: boolean;
}

const clock = (m: number) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** Shop floor: operators start, pause and finish the steps of released work orders (tablet at the machine) */
export function ShopFloorPage() {
  const qc = useQueryClient();
  const [centre, setCentre] = useState<string | null>(() => localStorage.getItem('kcs.shopfloor.centre'));
  const [search, setSearch] = useState('');
  const [finishing, setFinishing] = useState<Step | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      if (centre) localStorage.setItem('kcs.shopfloor.centre', centre);
      else localStorage.removeItem('kcs.shopfloor.centre');
    } catch {
      /* storage blocked */
    }
  }, [centre]);
  const q = useQuery({ queryKey: ['mfg', 'shop-floor', centre], queryFn: () => api.get<Step[]>('/manufacturing/shop-floor', centre ? { workCenterId: centre } : undefined), refetchInterval: 30_000 });
  const steps = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((x) => !s || x.order.number.toLowerCase().includes(s) || x.product.toLowerCase().includes(s));
  }, [q.data, search]);
  const act = async (path: string, msg: string) => {
    try {
      await api.post(`/manufacturing/operations/${path}`);
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['mfg'] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Shop Floor"
        subtitle="Start, pause and finish production steps; materials of a step leave the warehouse when it starts"
        actions={
          <div className="flex flex-wrap gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Scan / search work order" className="h-9 w-56" />
            <div className="w-56">
              <AsyncSelect resource="work-centers" value={centre} onChange={setCentre} placeholder="All work centres" />
            </div>
          </div>
        }
      />
      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !steps.length ? (
        <Card>
          <EmptyState icon="hard-hat" title="Nothing to do here" description="Steps of released work orders with a routing appear here" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((s) => {
            const elapsed = s.actualMinutes + (s.status === 'RUNNING' && s.runningSince ? (now - new Date(s.runningSince).getTime()) / 60000 : 0);
            const over = elapsed > s.plannedMinutes;
            return (
              <div key={s.id} className={cn('card flex flex-col gap-3 p-4', s.status === 'RUNNING' && 'ring-2 ring-brand-500', !s.ready && s.status === 'PENDING' && 'opacity-70')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/manufacturing/orders/${s.order.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                      {s.order.number}
                    </Link>
                    <p className="font-semibold">
                      {s.seq} · {s.name}
                    </p>
                    <p className="text-sm text-slate-600">
                      {fmtNumber(s.order.qty)} {s.uom} {s.product}
                    </p>
                    <p className="text-xs text-slate-500">
                      {s.workCenter} · planned {fmtDate(s.order.plannedDate)}
                    </p>
                  </div>
                  <Badge tone={s.status === 'RUNNING' ? 'blue' : s.status === 'PAUSED' ? 'amber' : s.ready ? 'green' : 'gray'}>{s.status === 'RUNNING' ? 'Running' : s.status === 'PAUSED' ? 'Paused' : s.ready ? 'Ready' : 'Earlier step open'}</Badge>
                </div>
                <div className="flex items-end justify-between">
                  <span className={cn('text-3xl font-semibold tabular-nums', over ? 'text-red-600' : 'text-slate-900')}>{clock(elapsed)}</span>
                  <span className="text-xs text-slate-500">planned {clock(s.plannedMinutes)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {s.status === 'RUNNING' ? (
                    <Button className="h-12" variant="outline" icon="pause" onClick={() => act(`${s.id}/pause`, 'Paused')}>
                      Pause
                    </Button>
                  ) : (
                    <Button className="h-12" variant="outline" icon="play" onClick={() => act(`${s.id}/start`, `${s.name} started`)}>
                      {s.status === 'PAUSED' ? 'Resume' : 'Start'}
                    </Button>
                  )}
                  <Button className="h-12" icon="check" onClick={() => setFinishing(s)}>
                    Finish
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {finishing && <StepFinishModal op={finishing} qty={finishing.order.qty} onClose={() => setFinishing(null)} onDone={() => (setFinishing(null), qc.invalidateQueries({ queryKey: ['mfg'] }))} />}
    </div>
  );
}

interface CapacityRow {
  id: string;
  code: string;
  name: string;
  capacityHours: number;
  workedHours: number;
  utilisationPct: number | null;
  loadHours: number;
  appliedCost: number;
  overheadApplied: number;
  overheadAtCapacity: number;
  unabsorbedOverhead: number;
}

/** Capacity & overhead: hours worked per work centre against normal capacity, load of open steps, overhead not absorbed */
export function CapacityPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ['mfg', 'capacity', month], queryFn: () => api.get<{ month: string; centres: CapacityRow[] }>('/manufacturing/capacity', { month }) });
  const rows = q.data?.centres ?? [];
  const total = (k: keyof CapacityRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Capacity & Overhead"
        subtitle="Hours worked against normal capacity. Overhead rates are set on normal capacity (SAK EP / PSAK 202), so overhead of hours not worked stays an expense of the month instead of raising the stock value"
        actions={
          <div className="w-44">
            <MonthInput value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="gauge" title="No work centres yet" description="Create them in Manufacturing > Work Centers" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Work centre</th>
                  <th className="px-3 py-2 text-right font-semibold">Capacity (h)</th>
                  <th className="px-3 py-2 text-left font-semibold">Worked</th>
                  <th className="px-3 py-2 text-right font-semibold">Open load (h)</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost applied</th>
                  <th className="px-4 py-2 text-right font-semibold">Overhead not absorbed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.name}</span> <span className="text-xs text-slate-500">{r.code}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.capacityHours)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', (r.utilisationPct ?? 0) > 100 ? 'bg-red-500' : (r.utilisationPct ?? 0) > 85 ? 'bg-amber-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, r.utilisationPct ?? 0)}%` }} />
                        </div>
                        <span className="text-xs tabular-nums">
                          {fmtNumber(r.workedHours)} h{r.utilisationPct !== null ? ` · ${fmtNumber(r.utilisationPct)}%` : ''}
                        </span>
                      </div>
                    </td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', r.capacityHours && r.loadHours > r.capacityHours ? 'font-medium text-red-600' : '')}>{fmtNumber(r.loadHours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.appliedCost, 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-700">{fmtMoney(r.unabsorbedOverhead, 0)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(total('capacityHours'))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtNumber(total('workedHours'))} h</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(total('loadHours'))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(total('appliedCost'), 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(total('unabsorbedOverhead'), 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        &quot;Overhead not absorbed&quot; = (capacity − hours worked) × machine and overhead rates: the share of the month&apos;s factory overhead that no product carried. It is already in the expense accounts (actual costs minus &quot;applied&quot;), so nothing needs posting.
      </p>
    </div>
  );
}
