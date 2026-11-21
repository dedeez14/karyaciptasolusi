import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, subscribe } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { Button, Card, Icon, Select, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import type { DisplayState, PosConfig } from './pos-types';

/** outlet chosen in the URL (?outlet=) or picked once on the device */
function useOutletParam() {
  const [params, setParams] = useSearchParams();
  const id = params.get('outlet');
  const options = useQuery({ queryKey: ['options', 'pos-outlets', ''], queryFn: () => api.get<{ value: string; label: string }[]>('/resources/pos-outlets/options', { search: '' }) });
  return {
    id,
    name: options.data?.find((o) => o.value === id)?.label ?? '',
    options: options.data ?? [],
    set: (v: string, extra: Record<string, string> = {}) => setParams({ outlet: v, ...Object.fromEntries([...params.entries()].filter(([k]) => k !== 'outlet')), ...extra }),
    params,
    setParams,
  };
}

function PickOutlet({ title, options, onPick }: { title: string; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <Card title={title} className="w-full max-w-sm">
        <Select value="" placeholder="Choose the outlet" options={options} onChange={(e) => onPick(e.target.value)} />
        <Link to="/pos" className="mt-4 block text-center text-xs text-slate-500 hover:underline">
          Back to the app
        </Link>
      </Card>
    </div>
  );
}

/** short chime without audio files (WebAudio) */
function chime(times = 2) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.35);
      o.stop(ctx.currentTime + i * 0.35 + 0.32);
    }
    setTimeout(() => ctx.close(), times * 400 + 200);
  } catch {
    /* audio not available */
  }
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const elapsed = (from: string | null, now: Date) => {
  if (!from) return { min: 0, text: '0:00' };
  const s = Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 1000));
  return { min: s / 60, text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
};

// ------------------------------------------------------------------ customer display
/** second screen facing the customer: the cart while ordering, totals and change, the queue number, a welcome message when idle */
export function CustomerDisplayScreen() {
  const o = useOutletParam();
  const cfg = useQuery({ queryKey: ['pos', 'config', o.id], queryFn: () => api.get<PosConfig>('/pos/config', { outletId: o.id }), enabled: !!o.id });
  const [state, setState] = useState<DisplayState>({ phase: 'idle', lines: [] });
  const now = useClock();
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!o.id) return;
    return subscribe<DisplayState>(`/pos/outlets/${o.id}/stream?topics=display`, {
      onEvent: (e) => {
        if (e.event !== 'display' || !e.data || !('phase' in (e.data as object))) return;
        setState(e.data);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        if (e.data.phase === 'done') idleTimer.current = setTimeout(() => setState({ phase: 'idle', lines: [] }), 15_000);
      },
    });
  }, [o.id]);
  if (!o.id) return <PickOutlet title="Customer display" options={o.options} onPick={(v) => o.set(v)} />;
  const outlet = cfg.data?.outlets.find((x) => x.id === o.id);
  const message = cfg.data?.outlet?.id === o.id ? cfg.data.outlet.displayMessage : null;
  const t = state.totals;
  return (
    <div className="flex h-dvh flex-col bg-gradient-to-br from-brand-900 via-brand-800 to-slate-900 text-white">
      <header className="flex items-center justify-between px-8 py-5">
        <p className="text-2xl font-semibold">{outlet?.name ?? o.name}</p>
        <p className="text-xl tabular-nums opacity-80">{now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
      </header>
      {state.phase === 'idle' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <Icon name="store" className="h-16 w-16 opacity-80" />
          <p className="text-5xl font-semibold">{message || 'Selamat datang'}</p>
          <p className="text-xl opacity-70">Welcome</p>
        </div>
      )}
      {(state.phase === 'cart' || state.phase === 'pay') && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-[1fr_26rem]">
          <ul className="min-h-0 space-y-2 overflow-y-auto rounded-2xl bg-white/10 p-5">
            {state.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-4 border-b border-white/10 pb-2 text-xl">
                <span>
                  <span className="tabular-nums opacity-80">{fmtNumber(l.qty)} ×</span> {l.name}
                  {l.detail && <span className="block text-base opacity-70">{l.detail}</span>}
                </span>
                <span className="tabular-nums">{fmtMoney(l.total, 0)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col justify-end gap-2 rounded-2xl bg-white/10 p-6 text-lg">
            {state.member && (
              <p className="mb-2 flex items-center gap-2 text-base">
                <Icon name="id-card" className="h-5 w-5" /> {state.member.name} · {fmtNumber(state.member.points)} points
              </p>
            )}
            {t?.promotions.map((p) => (
              <p key={p.promotionId} className="flex justify-between text-emerald-300">
                <span>{p.name}</span>
                <span className="tabular-nums">−{fmtMoney(p.amount, 0)}</span>
              </p>
            ))}
            {!!t?.serviceCharge && (
              <p className="flex justify-between opacity-80">
                <span>Service</span>
                <span className="tabular-nums">{fmtMoney(t.serviceCharge, 0)}</span>
              </p>
            )}
            {!!t?.taxTotal && (
              <p className="flex justify-between opacity-80">
                <span>PPN</span>
                <span className="tabular-nums">{fmtMoney(t.taxTotal, 0)}</span>
              </p>
            )}
            {!!t?.localTax && (
              <p className="flex justify-between opacity-80">
                <span>PBJT</span>
                <span className="tabular-nums">{fmtMoney(t.localTax, 0)}</span>
              </p>
            )}
            <p className="mt-2 flex items-end justify-between border-t border-white/20 pt-3">
              <span className="text-2xl">Total</span>
              <span className="text-5xl font-bold tabular-nums">{fmtMoney(t?.total ?? 0, 0)}</span>
            </p>
            {state.phase === 'pay' && <p className="mt-2 text-center text-base opacity-80">Please pay at the cashier · QRIS, card, cash</p>}
          </div>
        </div>
      )}
      {state.phase === 'done' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Icon name="check-check" className="h-20 w-20 text-emerald-300" />
          <p className="text-5xl font-semibold">Terima kasih</p>
          {!!state.change && <p className="text-3xl">Kembalian / change <span className="font-bold tabular-nums">{fmtMoney(state.change, 0)}</span></p>}
          {state.queueNo && (
            <div className="mt-4 rounded-3xl bg-white/10 px-12 py-6">
              <p className="text-xl opacity-80">Nomor antrean</p>
              <p className="text-8xl font-bold tracking-wider">{state.queueNo}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ kitchen display
interface Ticket {
  id: string;
  saleId: string;
  label: string;
  station: string;
  course: number;
  round: number;
  status: 'HELD' | 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
  orderType: string;
  queueNo: string | null;
  covers: number;
  firedAt: string | null;
  createdAt: string;
  lines: { id: string; name: string; qty: number; modifiers: string[]; note: string | null; status: string }[];
}

/** kitchen display (KDS): tickets per station with timers, bump / recall, all-day counts; ALL = expo */
export function KitchenDisplayScreen() {
  const o = useOutletParam();
  const qc = useQueryClient();
  const stations = useLookupOptions('POS_STATION');
  const station = o.params.get('station') ?? 'ALL';
  const key = ['pos', 'kitchen', o.id, station];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ outlet: { name: string; warn: number; late: number }; tickets: Ticket[] }>('/pos/kitchen', { outletId: o.id, station }), enabled: !!o.id, refetchInterval: 20_000 });
  const now = useClock();
  const seen = useRef<Set<string> | null>(null);
  const [recall, setRecall] = useState<{ id: string; status: string }[]>([]);
  useEffect(() => {
    if (!o.id) return;
    return subscribe(`/pos/outlets/${o.id}/stream?topics=kitchen`, { onEvent: (e) => e.event === 'kitchen' && qc.invalidateQueries({ queryKey: ['pos', 'kitchen', o.id] }) });
  }, [o.id, qc]);
  useEffect(() => {
    const ids = new Set((q.data?.tickets ?? []).filter((t) => t.status === 'NEW').map((t) => t.id));
    if (seen.current && [...ids].some((x) => !seen.current!.has(x))) chime(2);
    seen.current = ids;
  }, [q.data]);
  if (!o.id) return <PickOutlet title="Kitchen display" options={o.options} onPick={(v) => o.set(v)} />;
  const data = q.data;
  const tickets = data?.tickets ?? [];
  const live = tickets.filter((t) => t.status === 'NEW' || t.status === 'PREPARING' || (station === 'ALL' && t.status === 'READY'));
  const held = tickets.filter((t) => t.status === 'HELD');
  const allDay = new Map<string, number>();
  for (const t of tickets.filter((x) => x.status === 'NEW' || x.status === 'PREPARING')) for (const l of t.lines.filter((x) => x.status === 'ACTIVE')) allDay.set(l.name, (allDay.get(l.name) ?? 0) + l.qty);
  const move = async (t: Ticket, status: string) => {
    try {
      await api.post(`/pos/kitchen/tickets/${t.id}`, { status });
      setRecall((r) => [{ id: t.id, status: t.status }, ...r].slice(0, 10));
      qc.invalidateQueries({ queryKey: ['pos', 'kitchen', o.id] });
    } catch (e) {
      toast.error(e);
    }
  };
  const bump = (t: Ticket) => move(t, t.status === 'NEW' ? 'PREPARING' : t.status === 'PREPARING' ? 'READY' : 'SERVED');
  return (
    <div className="flex h-dvh flex-col bg-slate-900 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2">
        <Link to="/pos" className="text-slate-400 hover:text-white" aria-label="Back to the app">
          <Icon name="arrow-left" className="h-5 w-5" />
        </Link>
        <p className="font-semibold">{data?.outlet.name ?? o.name}</p>
        <div className="flex gap-1">
          {[{ value: 'ALL', label: 'Expo (all)' }, ...stations].map((s) => (
            <button key={s.value} type="button" onClick={() => o.set(o.id!, { station: s.value })} className={cn('rounded-lg px-3 py-1 text-sm', station === s.value ? 'bg-white text-slate-900' : 'bg-white/10')}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm tabular-nums text-slate-400">{now.toLocaleTimeString('id-ID')}</span>
        <Button size="sm" variant="secondary" icon="undo-2" disabled={!recall.length} onClick={() => recall[0] && api.post(`/pos/kitchen/tickets/${recall[0].id}`, { status: recall[0].status }).then(() => (setRecall((r) => r.slice(1)), qc.invalidateQueries({ queryKey: ['pos', 'kitchen', o.id] }))).catch((e) => toast.error(e))}>
          Recall
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-auto p-3">
          {q.isLoading ? (
            <Spinner />
          ) : !live.length ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500">
              <Icon name="chef-hat" className="mb-3 h-12 w-12" />
              <p>No orders</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
              {live.map((t) => {
                const e = elapsed(t.firedAt ?? t.createdAt, now);
                const late = e.min >= (data?.outlet.late ?? 20);
                const warn = e.min >= (data?.outlet.warn ?? 10);
                return (
                  <button key={t.id} type="button" onClick={() => bump(t)} className={cn('flex flex-col overflow-hidden rounded-xl bg-white text-left text-slate-900 shadow transition active:scale-[0.98]', t.status === 'READY' && 'opacity-70')}>
                    <div className={cn('flex items-center justify-between px-3 py-2 text-white', t.status === 'READY' ? 'bg-emerald-600' : late ? 'bg-red-600' : warn ? 'bg-amber-500' : t.status === 'PREPARING' ? 'bg-brand-600' : 'bg-slate-700')}>
                      <span className="text-lg font-bold">{t.label}</span>
                      <span className="text-sm tabular-nums">{e.text}</span>
                    </div>
                    <div className="flex items-center justify-between px-3 pt-1 text-[11px] text-slate-500 uppercase">
                      <span>
                        {t.orderType === 'DINE_IN' ? 'Dine in' : t.orderType === 'TAKEAWAY' ? 'Take away' : t.orderType.toLowerCase()}
                        {t.covers ? ` · ${t.covers} pax` : ''}
                      </span>
                      <span>
                        {station === 'ALL' ? `${t.station} · ` : ''}
                        {t.course > 1 ? `course ${t.course}` : ''}
                        {t.round > 1 ? ` · round ${t.round}` : ''}
                      </span>
                    </div>
                    <ul className="flex-1 space-y-1 px-3 py-2">
                      {t.lines.map((l) => (
                        <li key={l.id} className={cn('text-[15px]', l.status === 'VOID' && 'text-red-600 line-through')}>
                          <span className="font-bold tabular-nums">{fmtNumber(l.qty)}×</span> {l.name}
                          {l.modifiers.length > 0 && <span className="block pl-5 text-sm font-semibold text-brand-700">{l.modifiers.join(', ')}</span>}
                          {l.note && <span className="block pl-5 text-sm font-semibold text-red-600">! {l.note}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-slate-100 px-3 py-1.5 text-center text-xs font-medium text-slate-500">{t.status === 'NEW' ? 'Tap: start cooking' : t.status === 'PREPARING' ? 'Tap: ready' : 'Tap: served / picked up'}</div>
                  </button>
                );
              })}
            </div>
          )}
          {held.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">On hold: next courses</p>
              <div className="flex flex-wrap gap-2">
                {held.map((t) => (
                  <span key={t.id} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">
                    {t.label} · course {t.course} · {t.lines.reduce((a, l) => a + l.qty, 0)} item(s)
                  </span>
                ))}
              </div>
            </div>
          )}
        </main>
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-l border-white/10 p-3 md:block">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">All day</p>
          <ul className="space-y-1 text-sm">
            {[...allDay].sort((a, b) => b[1] - a[1]).map(([name, qty]) => (
              <li key={name} className="flex justify-between gap-2">
                <span className="truncate">{name}</span>
                <span className="font-bold tabular-nums">{fmtNumber(qty)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ queue board
/** order-ready board for the customers: numbers being prepared and ready, with a chime and a spoken call */
export function QueueBoardScreen() {
  const o = useOutletParam();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['pos', 'queue', o.id],
    queryFn: () => api.get<{ outlet: { name: string; announcement: string }; preparing: { id: string; queueNo: string }[]; ready: { id: string; queueNo: string; readyAt: string | null }[] }>('/pos/queue', { outletId: o.id }),
    enabled: !!o.id,
    refetchInterval: 30_000,
  });
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const now = useClock();
  useEffect(() => {
    if (!o.id) return;
    return subscribe(`/pos/outlets/${o.id}/stream?topics=queue`, { onEvent: (e) => e.event === 'queue' && qc.invalidateQueries({ queryKey: ['pos', 'queue', o.id] }) });
  }, [o.id, qc]);
  // keep "ready" numbers on the board for 15 minutes unless picked up earlier
  const ready = useMemo(() => (q.data?.ready ?? []).filter((r) => !r.readyAt || now.getTime() - new Date(r.readyAt).getTime() < 15 * 60_000), [q.data, now]);
  useEffect(() => {
    const ids = new Set(ready.map((r) => r.id));
    const fresh = seen.current ? ready.filter((r) => !seen.current!.has(r.id)) : [];
    seen.current = ids;
    if (!sound || !fresh.length) return;
    chime(3);
    const text = q.data?.outlet.announcement || 'Order {number} is ready';
    const lang = /pesanan|nomor|silakan|antrean/i.test(text) ? 'id-ID' : 'en-US';
    setTimeout(() => {
      for (const r of fresh) {
        const spoken = r.queueNo.replace(/^([A-Za-z]*)0*(\d+)$/, (_, p: string, n: string) => `${p.split('').join(' ')} ${n}`);
        const u = new SpeechSynthesisUtterance(text.replace('{number}', spoken));
        u.lang = lang;
        window.speechSynthesis?.speak(u);
      }
    }, 1100);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o.id) return <PickOutlet title="Queue board" options={o.options} onPick={(v) => o.set(v)} />;
  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between px-8 py-4">
        <p className="text-2xl font-semibold">{q.data?.outlet.name ?? o.name}</p>
        <p className="text-xl tabular-nums opacity-70">{now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 px-8 pb-8">
        <section className="flex min-h-0 flex-col rounded-3xl bg-white/5 p-6">
          <h2 className="mb-4 text-3xl font-semibold text-amber-300">Sedang disiapkan · Preparing</h2>
          <div className="flex flex-wrap content-start gap-3 overflow-hidden">
            {(q.data?.preparing ?? []).map((r) => (
              <span key={r.id} className="rounded-2xl bg-white/10 px-5 py-3 text-5xl font-bold tabular-nums">
                {r.queueNo}
              </span>
            ))}
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-3xl bg-emerald-500/15 p-6">
          <h2 className="mb-4 text-3xl font-semibold text-emerald-300">Siap diambil · Ready</h2>
          <div className="flex flex-wrap content-start gap-3 overflow-hidden">
            {ready.map((r, i) => (
              <span key={r.id} className={cn('rounded-2xl px-6 py-4 font-bold tabular-nums', i === 0 ? 'animate-pulse bg-emerald-500 text-7xl text-white' : 'bg-emerald-500/30 text-6xl')}>
                {r.queueNo}
              </span>
            ))}
          </div>
        </section>
      </div>
      {!sound && (
        <button type="button" onClick={() => (setSound(true), chime(1))} className="absolute right-4 bottom-4 flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
          <Icon name="bell-ring" className="h-4 w-4" /> Turn on sound
        </button>
      )}
    </div>
  );
}
