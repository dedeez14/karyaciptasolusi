import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'In visit', tone: 'amber' },
  ORDER: { label: 'Order', tone: 'green' },
  VAN_SALE: { label: 'Van sale', tone: 'green' },
  COLLECTION: { label: 'Collection', tone: 'blue' },
  NO_ORDER: { label: 'No order', tone: 'gray' },
  CLOSED: { label: 'Outlet closed', tone: 'gray' },
};

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}
interface Credit {
  limit: number;
  hold: boolean;
  ar: number;
  orders: number;
  overdue: number;
  oldestDays: number;
  available: number | null;
}
function CreditLine({ c }: { c?: Credit }) {
  if (!c) return null;
  return (
    <span className="text-xs text-slate-500">
      {c.hold && <Badge tone="red">Credit hold</Badge>} open {fmtMoney(c.ar, 0)}
      {c.overdue > 0 && (
        <span className="text-red-600">
          {' '}
          · overdue {fmtMoney(c.overdue, 0)} ({c.oldestDays} d)
        </span>
      )}
      {c.available !== null && <span className={c.available < 0 ? 'text-red-600' : ''}> · available {fmtMoney(c.available, 0)}</span>}
    </span>
  );
}

// ============================================================ journey plan (salesman)
interface Planned {
  routeId: string;
  routeCode: string;
  seq: number;
  customer: { id: string; code: string; name: string; address: string | null; city: string | null; phone: string | null; channel: string | null };
  credit?: Credit;
  visits: { id: string; outcome: string; sales: number; collected: number; distanceM: number | null; reason: string | null }[];
}

export function JourneyPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [date, setDate] = useState(isoDate());
  const [visitId, setVisitId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['distribution', 'journey', date],
    queryFn: () =>
      api.get<{ date: string; routes: { id: string; code: string; name: string }[]; planned: Planned[]; done: number; productive: number; unplanned: number }>('/distribution/journey', { date }),
  });
  const d = q.data;
  const checkIn = async (p: Planned) => {
    setBusy(p.customer.id);
    const pos = await new Promise<GeolocationPosition | null>((res) =>
      navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 8000, enableHighAccuracy: true }) : res(null),
    );
    try {
      const v = await api.post<{ id: string; farAway: boolean; distanceM: number | null }>('/distribution/visits', {
        routeId: p.routeId,
        customerId: p.customer.id,
        latitude: pos?.coords.latitude ?? null,
        longitude: pos?.coords.longitude ?? null,
      });
      if (v.farAway) toast.error(`Checked in ${v.distanceM} m from the outlet's location`);
      setVisitId(v.id);
      qc.invalidateQueries({ queryKey: ['distribution'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Journey Plan"
        subtitle="The outlets on your route today: check in at the outlet, take the order or sell from the van, collect, and say why when there is no order"
        actions={
          <div className="w-40">
            <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} aria-label="Date" />
          </div>
        }
      />
      {q.isLoading || !d ? (
        <Loading />
      ) : !d.routes.length ? (
        <EmptyState icon="route" title="No route" description="You are not the salesman of an active route" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="card px-4 py-3">
              <div className="text-xs text-slate-500">Planned</div>
              <div className="text-lg font-semibold">{d.planned.length}</div>
            </div>
            <div className="card px-4 py-3">
              <div className="text-xs text-slate-500">Visited</div>
              <div className="text-lg font-semibold">{d.done}</div>
            </div>
            <div className="card px-4 py-3">
              <div className="text-xs text-slate-500">Productive</div>
              <div className="text-lg font-semibold">{d.productive}</div>
            </div>
          </div>
          <Card bodyClass="p-0">
            {!d.planned.length ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No outlets planned on {fmtDate(d.date)}.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.planned.map((p) => {
                  const last = p.visits[p.visits.length - 1];
                  return (
                    <li key={`${p.routeId}-${p.customer.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="w-6 text-xs text-slate-400">{p.seq}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {p.customer.name} <span className="text-xs font-normal text-slate-500">{p.customer.code}</span>
                        </span>
                        <span className="block text-xs text-slate-500">{[p.customer.address, p.customer.city, p.customer.phone].filter(Boolean).join(' · ')}</span>
                        <CreditLine c={p.credit} />
                      </span>
                      {last && (
                        <button type="button" onClick={() => setVisitId(last.id)}>
                          <Badge tone={OUTCOME[last.outcome].tone}>{OUTCOME[last.outcome].label}</Badge>
                        </button>
                      )}
                      {can('distribution.visit') && date === isoDate() && (
                        <Button size="sm" variant={last ? 'outline' : 'primary'} icon="map-pin" loading={busy === p.customer.id} onClick={() => checkIn(p)}>
                          {last ? 'Visit again' : 'Check in'}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
      {visitId && <VisitModal id={visitId} onClose={() => (setVisitId(null), qc.invalidateQueries({ queryKey: ['distribution'] }))} />}
    </div>
  );
}

interface Visit {
  id: string;
  outcome: string;
  checkOutAt: string | null;
  distanceM: number | null;
  farAway: boolean;
  sales: number;
  collected: number;
  reason: string | null;
  customer: { id: string; code: string; name: string; address: string | null; phone: string | null };
  docs: { id: string; docType: string; number: string; status: string; grandTotal: number }[];
  credit?: Credit;
  route: { id: string; code: string; vanWarehouseId: string | null; cashAccountId: string | null } | null;
}

function VisitModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'' | 'order' | 'van' | 'collect' | 'none'>('');
  const [lines, setLines] = useState<{ productId: string | null; label: string; qty: string }[]>([{ productId: null, label: '', qty: '' }]);
  const [collect, setCollect] = useState('');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['distribution', 'visit', id], queryFn: () => api.get<Visit>(`/distribution/visits/${id}`) });
  const done = (msg: string) => (toast.success(msg), setMode(''), setLines([{ productId: null, label: '', qty: '' }]), setCollect(''), qc.invalidateQueries({ queryKey: ['distribution'] }));
  const body = () => ({ lines: lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ productId: l.productId, qty: Number(l.qty) })) });
  const act = useMutation({
    mutationFn: (m: string) => {
      if (m === 'order') return api.post<Visit & { warning?: string }>(`/distribution/visits/${id}/order`, body());
      if (m === 'van') return api.post<Visit>(`/distribution/visits/${id}/van-sale`, { ...body(), collect: Number(collect || 0) });
      if (m === 'collect') return api.post<Visit>(`/distribution/visits/${id}/collect`, { amount: Number(collect) });
      if (m === 'none') return api.post<Visit>(`/distribution/visits/${id}/no-order`, { reason, closed: reason.toLowerCase().includes('closed') });
      return api.post<Visit>(`/distribution/visits/${id}/check-out`);
    },
    onSuccess: (r, m) => {
      const w = (r as { warning?: string }).warning;
      if (w) toast.error(w);
      done(m === 'order' ? (w ? 'Order saved as a draft' : 'Order taken') : m === 'van' ? 'Sold from the van' : m === 'collect' ? 'Payment collected' : m === 'none' ? 'Visit closed' : 'Checked out');
    },
    onError: (e) => toast.error(e),
  });
  const v = q.data;
  const closed = !!v?.checkOutAt;
  return (
    <Modal open size="lg" onClose={onClose} title={v ? `Visit: ${v.customer.name}` : 'Visit'}>
      {!v ? (
        <Loading />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={OUTCOME[v.outcome].tone}>{OUTCOME[v.outcome].label}</Badge>
            {v.farAway && <Badge tone="amber">{v.distanceM} m from the outlet</Badge>}
            {closed && <Badge tone="gray">Checked out</Badge>}
            <CreditLine c={v.credit} />
          </div>
          {(v.sales > 0 || v.collected > 0) && (
            <p>
              Sales {fmtMoney(v.sales, 0)} · collected {fmtMoney(v.collected, 0)}
            </p>
          )}
          {v.docs.length > 0 && (
            <p className="flex flex-wrap gap-3">
              {v.docs.map((d) => (
                <Link key={d.id} className="text-brand-600" to={`/documents/${d.docType}/${d.id}`}>
                  {d.number} ({d.status.toLowerCase()})
                </Link>
              ))}
            </p>
          )}
          {!closed && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={mode === 'order' ? 'primary' : 'outline'} icon="clipboard-list" onClick={() => setMode('order')}>
                Order
              </Button>
              {v.route?.vanWarehouseId && (
                <Button size="sm" variant={mode === 'van' ? 'primary' : 'outline'} icon="truck" onClick={() => setMode('van')}>
                  Sell from van
                </Button>
              )}
              {v.route?.cashAccountId && (
                <Button size="sm" variant={mode === 'collect' ? 'primary' : 'outline'} icon="banknote" onClick={() => setMode('collect')}>
                  Collect
                </Button>
              )}
              <Button size="sm" variant={mode === 'none' ? 'primary' : 'outline'} icon="circle-slash" onClick={() => setMode('none')}>
                No order
              </Button>
              {v.outcome !== 'OPEN' && (
                <Button size="sm" variant="ghost" icon="log-out" loading={act.isPending && act.variables === 'out'} onClick={() => act.mutate('out')}>
                  Check out
                </Button>
              )}
            </div>
          )}
          {(mode === 'order' || mode === 'van') && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] gap-2">
                  <AsyncSelect
                    resource="products"
                    value={l.productId}
                    initialLabel={l.label || undefined}
                    onChange={(val, o) => setLines(lines.map((x, j) => (j === i ? { ...x, productId: val, label: o?.label ?? '' } : x)))}
                    aria-label="Product"
                  />
                  <NumberInput decimals={2} min={0} value={l.qty} placeholder="Qty" onChange={(val) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: val } : x)))} aria-label="Quantity" />
                  <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                </div>
              ))}
              <Button size="sm" variant="outline" icon="plus" onClick={() => setLines([...lines, { productId: null, label: '', qty: '' }])}>
                Line
              </Button>
              {mode === 'van' && (
                <Field label="Cash collected now">
                  <NumberInput decimals={0} min={0} value={collect} onChange={setCollect} />
                </Field>
              )}
              <p className="text-xs text-slate-500">Prices from the outlet&apos;s price list. The credit check runs before the order is confirmed or the goods leave the van.</p>
              <Button icon="check" loading={act.isPending} disabled={!body().lines.length} onClick={() => act.mutate(mode)}>
                {mode === 'order' ? 'Take order' : 'Sell and invoice'}
              </Button>
            </div>
          )}
          {mode === 'collect' && (
            <div className="flex items-end gap-2 rounded-lg bg-slate-50 p-3">
              <Field label="Amount collected" className="flex-1" help="Settles the oldest open invoices first">
                <NumberInput decimals={0} min={0} value={collect} onChange={setCollect} />
              </Field>
              <Button icon="check" loading={act.isPending} disabled={!Number(collect)} onClick={() => act.mutate('collect')}>
                Collect
              </Button>
            </div>
          )}
          {mode === 'none' && (
            <div className="flex items-end gap-2 rounded-lg bg-slate-50 p-3">
              <Field label="Reason" className="flex-1">
                <Select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Choose"
                  options={['Stock still enough', 'Owner away', 'Outlet closed', 'No money', 'Prices too high', 'Bought from a competitor'].map((x) => ({ value: x, label: x }))}
                />
              </Field>
              <Button icon="check" loading={act.isPending} disabled={!reason} onClick={() => act.mutate('none')}>
                Close visit
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ routes
interface RouteRow {
  id: string;
  code: string;
  name: string;
  salesman: string | null;
  vanWarehouse: string | null;
  stopCount: number;
  isActive: boolean;
}
interface RouteDetail {
  id: string;
  code: string;
  name: string;
  salesmanId: string;
  vanWarehouseId: string | null;
  cashAccountId: string | null;
  isActive: boolean;
  notes: string | null;
  salesman: { id: string; fullName: string } | null;
  vanWarehouse: { name: string } | null;
  cashAccount: { name: string } | null;
  stops: { customerId: string; seq: number; days: number[]; weeks: string; customer: { code: string; name: string } | null }[];
}

export function RoutesPage() {
  const can = useSession((s) => s.can);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const q = useQuery({ queryKey: ['distribution', 'routes'], queryFn: () => api.get<RouteRow[]>('/distribution/routes') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Routes"
        subtitle="Each salesman's outlets by weekday (every week or every other week), the van warehouse and the cash box of van sales"
        actions={
          can('distribution.route.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New route
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="route" title="No routes yet" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <button type="button" className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setEdit(r.id)}>
                  <span className="block font-medium">
                    {r.code} · {r.name}
                    {!r.isActive ? ' (inactive)' : ''}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {r.salesman ?? '-'} · {r.stopCount} outlets{r.vanWarehouse ? ` · van ${r.vanWarehouse}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <RouteForm id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RouteForm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['distribution', 'route', id], queryFn: () => api.get<RouteDetail>(`/distribution/routes/${id}`), enabled: !!id });
  if (id && !q.data) return null;
  return <RouteFormBody r={q.data} onClose={onClose} onSaved={() => (qc.invalidateQueries({ queryKey: ['distribution'] }), onClose())} />;
}

function RouteFormBody({ r, onClose, onSaved }: { r?: RouteDetail; onClose: () => void; onSaved: () => void }) {
  const can = useSession((s) => s.can);
  const ro = !can('distribution.route.manage');
  const [f, setF] = useState({
    code: r?.code ?? '',
    name: r?.name ?? '',
    salesmanId: r?.salesmanId ?? (null as string | null),
    vanWarehouseId: r?.vanWarehouseId ?? (null as string | null),
    cashAccountId: r?.cashAccountId ?? (null as string | null),
    isActive: r?.isActive ?? true,
    notes: r?.notes ?? '',
  });
  const [stops, setStops] = useState(
    r?.stops.map((s) => ({ customerId: s.customerId as string | null, label: s.customer ? `${s.customer.code} - ${s.customer.name}` : '', days: s.days, weeks: s.weeks })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, stops: stops.filter((s) => s.customerId && s.days.length).map((s) => ({ customerId: s.customerId, days: s.days, weeks: s.weeks })) };
      return r ? api.put(`/distribution/routes/${r.id}`, body) : api.post('/distribution/routes', body);
    },
    onSuccess: () => (toast.success('Route saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const toggle = (i: number, d: number) => setStops(stops.map((s, j) => (j === i ? { ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort() } : s)));
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={r ? `Route ${r.code}` : 'New route'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || !f.salesmanId} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input disabled={ro} value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="lg:col-span-2">
          <Input disabled={ro} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Salesman" required error={errors.salesmanId}>
          <AsyncSelect disabled={ro} resource="users" value={f.salesmanId} initialLabel={r?.salesman?.fullName} onChange={(v) => setF({ ...f, salesmanId: v })} />
        </Field>
        <Field label="Van warehouse" help="For van (canvas) sales" error={errors.vanWarehouseId}>
          <AsyncSelect disabled={ro} resource="warehouses" value={f.vanWarehouseId} initialLabel={r?.vanWarehouse?.name} onChange={(v) => setF({ ...f, vanWarehouseId: v })} />
        </Field>
        <Field label="Cash box" help="Van sales and collections are received here" error={errors.cashAccountId}>
          <AsyncSelect disabled={ro} resource="bank-accounts" value={f.cashAccountId} initialLabel={r?.cashAccount?.name} onChange={(v) => setF({ ...f, cashAccountId: v })} />
        </Field>
      </div>
      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-sm font-medium">Outlets in visiting order ({stops.length})</span>
        {!ro && (
          <Button size="sm" variant="outline" icon="plus" onClick={() => setStops([...stops, { customerId: null, label: '', days: [1], weeks: 'EVERY' }])}>
            Outlet
          </Button>
        )}
      </div>
      {errors.stops && <p className="mb-1 text-xs text-red-600">{errors.stops}</p>}
      <div className="space-y-2">
        {stops.map((s, i) => (
          <div key={i} className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[minmax(0,1fr)_auto_8rem_2.5rem]">
            <AsyncSelect
              disabled={ro}
              resource="customers"
              value={s.customerId}
              initialLabel={s.label || undefined}
              onChange={(v, o) => setStops(stops.map((x, j) => (j === i ? { ...x, customerId: v, label: o?.label ?? '' } : x)))}
              aria-label="Outlet"
            />
            <div className="flex gap-1">
              {DAYS.map((d, k) => (
                <button
                  key={d}
                  type="button"
                  disabled={ro}
                  className={`rounded px-1.5 py-1 text-xs ${s.days.includes(k + 1) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  onClick={() => toggle(i, k + 1)}
                >
                  {d}
                </button>
              ))}
            </div>
            <Select
              disabled={ro}
              value={s.weeks}
              onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, weeks: e.target.value } : x)))}
              options={[
                { value: 'EVERY', label: 'Every week' },
                { value: 'ODD', label: 'Odd weeks' },
                { value: 'EVEN', label: 'Even weeks' },
              ]}
            />
            {!ro && <Button variant="ghost" size="icon" icon="x" aria-label="Remove outlet" onClick={() => setStops(stops.filter((_, j) => j !== i))} />}
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={ro} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
      </label>
      <Field label="Notes" className="mt-3">
        <Textarea disabled={ro} rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

// ============================================================ visits & productivity
export function VisitsPage() {
  const [from, setFrom] = useState(isoDate().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDate());
  const q = useQuery({
    queryKey: ['distribution', 'visits', from, to],
    queryFn: () =>
      api.get<{
        summary: {
          routeId: string;
          code: string;
          salesman: string | null;
          planned: number;
          visited: number;
          productive: number;
          callRate: number | null;
          strikeRate: number | null;
          sales: number;
          dropSize: number;
          collected: number;
          farCheckIns: number;
        }[];
        rows: {
          id: string;
          date: string;
          outcome: string;
          reason: string | null;
          sales: number;
          collected: number;
          distanceM: number | null;
          salesman: string | null;
          customer: { code: string; name: string } | null;
          routeCode: string | null;
        }[];
      }>('/distribution/visits', { from, to }),
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Visits & Productivity"
        subtitle="Call rate (visited / planned), strike rate (productive / visited), drop size (sales per productive call) and collections per route"
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <DatePicker value={from} clearable={false} onChange={(v) => setFrom(v ?? isoDate())} aria-label="From" />
            </div>
            <div className="w-40">
              <DatePicker value={to} clearable={false} onChange={(v) => setTo(v ?? isoDate())} aria-label="To" />
            </div>
          </div>
        }
      />
      {q.isLoading || !d ? (
        <Loading />
      ) : (
        <>
          <Card bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Route</th>
                    <th className="px-2 py-2 text-right">Planned</th>
                    <th className="px-2 py-2 text-right">Visited</th>
                    <th className="px-2 py-2 text-right">Call rate</th>
                    <th className="px-2 py-2 text-right">Productive</th>
                    <th className="px-2 py-2 text-right">Strike rate</th>
                    <th className="px-2 py-2 text-right">Sales</th>
                    <th className="px-2 py-2 text-right">Drop size</th>
                    <th className="px-4 py-2 text-right">Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.summary.map((s) => (
                    <tr key={s.routeId}>
                      <td className="px-4 py-2">
                        {s.code} · {s.salesman}
                        {s.farCheckIns > 0 && <span className="block text-xs text-amber-600">{s.farCheckIns} check-ins far from the outlet</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{s.planned}</td>
                      <td className="px-2 py-2 text-right">{s.visited}</td>
                      <td className="px-2 py-2 text-right">{s.callRate ?? '-'}%</td>
                      <td className="px-2 py-2 text-right">{s.productive}</td>
                      <td className="px-2 py-2 text-right">{s.strikeRate ?? '-'}%</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(s.sales, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(s.dropSize, 0)}</td>
                      <td className="px-4 py-2 text-right">{fmtNumber(s.collected, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Visits" bodyClass="p-0">
            {!d.rows.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">No visits in this period.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.rows.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {fmtDate(v.date)} · {v.customer?.name} · {v.salesman}
                      {v.routeCode ? ` · ${v.routeCode}` : ' · unplanned'}
                      {v.reason ? <span className="text-slate-500"> · {v.reason}</span> : null}
                      {v.distanceM !== null && v.distanceM > 200 ? <span className="text-amber-600"> · {v.distanceM} m away</span> : null}
                    </span>
                    {v.sales > 0 && <span>{fmtMoney(v.sales, 0)}</span>}
                    <Badge tone={OUTCOME[v.outcome].tone}>{OUTCOME[v.outcome].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================================ van settlement
export function SettlementsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const routes = useQuery({ queryKey: ['distribution', 'routes'], queryFn: () => api.get<RouteRow[]>('/distribution/routes') });
  const [routeId, setRouteId] = useState('');
  const [date, setDate] = useState(isoDate());
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const pv = useQuery({
    queryKey: ['distribution', 'settle-preview', routeId, date],
    queryFn: () =>
      api.get<{
        route: { code: string };
        visits: number;
        productive: number;
        sales: number;
        orders: number;
        expectedCash: number;
        stock: { productId: string; qty: number; code: string; name: string }[];
        settled: { id: string; number: string } | null;
      }>('/distribution/settlements/preview', { routeId, date }),
    enabled: !!routeId,
  });
  const list = useQuery({
    queryKey: ['distribution', 'settlements'],
    queryFn: () =>
      api.get<{ id: string; number: string; date: string; routeCode: string; sales: number; expectedCash: number; countedCash: number; difference: number; status: string }[]>(
        '/distribution/settlements',
      ),
  });
  const settle = useMutation({
    mutationFn: () => api.post<{ number: string; difference: number }>('/distribution/settlements', { routeId, date, countedCash: Number(counted || 0), notes }),
    onSuccess: (r) => (
      toast.success(`${r.number} posted${r.difference ? `: ${r.difference > 0 ? 'over' : 'short'} ${fmtMoney(Math.abs(r.difference), 0)}` : ''}`),
      setCounted(''),
      qc.invalidateQueries({ queryKey: ['distribution'] })
    ),
    onError: (e) => toast.error(e),
  });
  const voidIt = useMutation({
    mutationFn: (id: string) => api.post(`/distribution/settlements/${id}/void`),
    onSuccess: () => (toast.success('Settlement voided'), qc.invalidateQueries({ queryKey: ['distribution'] })),
    onError: (e) => toast.error(e),
  });
  const p = pv.data;
  const diff = Number(counted || 0) - (p?.expectedCash ?? 0);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Van Settlements"
        subtitle="End of the van's day: cash counted against the van sales and collections received, the difference to Cash Over / Short, and the stock left on the van"
      />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Route">
            <Select
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              placeholder="Choose"
              options={(routes.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.salesman ?? ''}` }))}
            />
          </Field>
          <Field label="Date">
            <DatePicker value={date} clearable={false} max={isoDate()} onChange={(v) => setDate(v ?? isoDate())} />
          </Field>
        </div>
        {p && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Visits / productive</dt>
              <dd className="text-right">
                {p.visits} / {p.productive}
              </dd>
              <dt className="text-slate-500">Van sales</dt>
              <dd className="text-right">{fmtMoney(p.sales, 0)}</dd>
              <dt className="text-slate-500">Orders taken</dt>
              <dd className="text-right">{fmtMoney(p.orders, 0)}</dd>
              <dt className="font-medium">Cash expected</dt>
              <dd className="text-right font-medium">{fmtMoney(p.expectedCash, 0)}</dd>
            </dl>
            <div>
              <p className="mb-1 text-sm font-medium">Left on the van</p>
              <ul className="max-h-40 overflow-y-auto text-sm">
                {p.stock.map((s) => (
                  <li key={s.productId} className="flex justify-between">
                    <span>
                      {s.code} {s.name}
                    </span>
                    <span>{fmtNumber(s.qty, 2)}</span>
                  </li>
                ))}
                {!p.stock.length && <li className="text-slate-500">Empty</li>}
              </ul>
            </div>
            {p.settled ? (
              <p className="text-sm lg:col-span-2">Already settled on {p.settled.number}.</p>
            ) : (
              can('distribution.settle') && (
                <div className="flex flex-wrap items-end gap-2 lg:col-span-2">
                  <Field label="Cash counted" className="w-48">
                    <NumberInput decimals={0} min={0} value={counted} onChange={setCounted} />
                  </Field>
                  <Field label="Notes" className="min-w-0 flex-1">
                    <Input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <span className={`pb-2 text-sm ${diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-600' : ''}`}>
                    {counted !== '' && (diff === 0 ? 'Exact' : `${diff > 0 ? 'Over' : 'Short'} ${fmtMoney(Math.abs(diff), 0)}`)}
                  </span>
                  <Button icon="check" loading={settle.isPending} disabled={counted === ''} onClick={() => settle.mutate()}>
                    Settle
                  </Button>
                </div>
              )
            )}
          </div>
        )}
      </Card>
      <Card title="Settlements" bodyClass="p-0">
        {!list.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No settlements yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((s) => (
              <li key={s.id} className={`flex items-center gap-2 px-4 py-2.5 text-sm ${s.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>
                <span className="min-w-0 flex-1">
                  {s.number} · {fmtDate(s.date)} · {s.routeCode} · sales {fmtMoney(s.sales, 0)} · cash {fmtMoney(s.countedCash, 0)} of {fmtMoney(s.expectedCash, 0)}
                </span>
                {s.difference !== 0 && (
                  <Badge tone={s.difference < 0 ? 'red' : 'amber'}>
                    {s.difference < 0 ? 'Short' : 'Over'} {fmtNumber(Math.abs(s.difference), 0)}
                  </Badge>
                )}
                {s.status === 'POSTED' && can('distribution.settle') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="Void"
                    onClick={async () => (await confirm({ title: `Void ${s.number}?`, danger: true, confirmText: 'Void' })) && voidIt.mutate(s.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ============================================================ credit control
export function CreditPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['distribution', 'credit'],
    queryFn: () => api.get<{ overdueDays: number; rows: ({ id: string; code: string; name: string; channel: string | null; blocked: boolean } & Credit)[] }>('/distribution/credit'),
  });
  const hold = useMutation({
    mutationFn: (x: { id: string; hold: boolean }) => api.post(`/distribution/credit/${x.id}/hold`, { hold: x.hold }),
    onSuccess: () => (toast.success('Updated'), qc.invalidateQueries({ queryKey: ['distribution', 'credit'] })),
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Credit Control"
        subtitle={`Customers' open invoices and orders against their credit limit; blocked when on hold, over the limit${d?.overdueDays ? ` or more than ${d.overdueDays} days overdue` : ''} (Settings > Sales)`}
      />
      <Card bodyClass="p-0">
        {q.isLoading || !d ? (
          <Loading />
        ) : !d.rows.length ? (
          <EmptyState icon="shield-check" title="No customers with credit" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Customer</th>
                  <th className="px-2 py-2 text-right">Limit</th>
                  <th className="px-2 py-2 text-right">Open invoices</th>
                  <th className="px-2 py-2 text-right">Open orders</th>
                  <th className="px-2 py-2 text-right">Available</th>
                  <th className="px-2 py-2 text-right">Overdue</th>
                  <th className="px-4 py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.rows.map((r) => (
                  <tr key={r.id} className={r.blocked ? 'bg-red-50/40' : ''}>
                    <td className="px-4 py-2">
                      <Link className="font-medium text-brand-600" to={`/customers/${r.id}`}>
                        {r.name}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {r.code}
                        {r.channel ? ` · ${r.channel.toLowerCase()}` : ''}
                        {r.blocked ? ' · blocked' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">{r.limit ? fmtNumber(r.limit, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(r.ar, 0)}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(r.orders, 0)}</td>
                    <td className={`px-2 py-2 text-right ${r.available !== null && r.available < 0 ? 'text-red-600' : ''}`}>{r.available === null ? '-' : fmtNumber(r.available, 0)}</td>
                    <td className={`px-2 py-2 text-right ${r.overdue > 0 ? 'text-red-600' : ''}`}>{r.overdue ? `${fmtNumber(r.overdue, 0)} (${r.oldestDays} d)` : '-'}</td>
                    <td className="px-4 py-2 text-right">
                      {can('sales.credit.override') && (
                        <Button size="sm" variant={r.hold ? 'primary' : 'outline'} icon={r.hold ? 'lock-open' : 'lock'} onClick={() => hold.mutate({ id: r.id, hold: !r.hold })}>
                          {r.hold ? 'Release' : 'Hold'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================ trade schemes and free goods
const CLAIM_LABEL: Record<string, string> = {
  AWARD: 'Award / target bonus',
  SERVICE: 'Promotion services',
  SPACE_RENT: 'Display space rent',
  EQUIPMENT_RENT: 'Display equipment rent',
  COMPENSATION: 'Compensation (programme of the principal)',
};
const CHANNELS = ['WHOLESALE', 'GROCERY', 'MINIMARKET', 'SUPERMARKET', 'HORECA', 'PHARMACY', 'OTHER'];
interface Scheme {
  id: string;
  code: string;
  name: string;
  supplierId: string | null;
  supplier: string | null;
  type: string;
  productIds: string[];
  products: { id: string; code: string; name: string }[];
  channels: string[];
  minQty: number;
  discountPct: number | null;
  bonusProductId: string | null;
  bonusProduct: { code: string; name: string } | null;
  bonusQty: number | null;
  principalSharePct: number;
  claimType: string;
  dateFrom: string;
  dateTo: string;
  isActive: boolean;
  notes: string | null;
  given: number;
  claimable: number;
}

export function SchemesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Scheme | 'new' | null>(null);
  const [deliver, setDeliver] = useState<string | null>(null);
  const [wh, setWh] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['distribution', 'schemes'], queryFn: () => api.get<Scheme[]>('/distribution/schemes') });
  const gifts = useQuery({
    queryKey: ['distribution', 'gifts'],
    queryFn: () =>
      api.get<
        {
          id: string;
          number: string;
          date: string;
          status: string;
          qty: number;
          cost: number;
          dpp: number;
          ppn: number;
          customer: string | null;
          product: { code: string; name: string } | null;
          delivery: { id: string; number: string } | null;
        }[]
      >('/distribution/gifts'),
  });
  const act = useMutation({
    mutationFn: (x: { id: string; action: 'deliver' | 'cancel' }) => api.post(`/distribution/gifts/${x.id}/${x.action}`, x.action === 'deliver' ? { warehouseId: wh } : {}),
    onSuccess: () => (toast.success('Done'), setDeliver(null), qc.invalidateQueries({ queryKey: ['distribution'] })),
    onError: (e) => toast.error(e),
  });
  const today = isoDate();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Trade Schemes & Free Goods"
        subtitle="Discounts and bonus goods applied to orders and van sales (the best discount per line); bonus goods are a free supply (pemberian cuma-cuma) delivered apart with PPN on 11/12 x cost, unless Settings say otherwise"
        actions={
          can('distribution.scheme.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New scheme
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="badge-percent" title="No schemes" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((s) => {
              const live = s.isActive && s.dateFrom <= today && s.dateTo >= today;
              return (
                <li key={s.id}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setEdit(s)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {s.code} · {s.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {s.type === 'DISCOUNT' ? `${s.discountPct}% from ${s.minQty}` : `buy ${s.minQty} get ${s.bonusQty} ${s.bonusProduct?.code}`} · {s.products.map((p) => p.code).join(', ')}
                        {s.channels.length ? ` · ${s.channels.join(', ').toLowerCase()}` : ''} · {fmtDate(s.dateFrom)} - {fmtDate(s.dateTo)}
                        {s.supplier ? ` · ${s.principalSharePct}% by ${s.supplier} (${CLAIM_LABEL[s.claimType].toLowerCase()})` : ''}
                      </span>
                    </span>
                    <span className="text-right text-xs">
                      given {fmtMoney(s.given, 0)}
                      {s.claimable > 0 && <span className="block text-slate-500">principal {fmtMoney(s.claimable, 0)}</span>}
                    </span>
                    <Badge tone={live ? 'green' : 'gray'}>{live ? 'Running' : s.isActive ? 'Out of period' : 'Off'}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Free goods (pemberian cuma-cuma)" bodyClass="p-0">
        {!gifts.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No free goods yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {gifts.data.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {g.number} · {fmtDate(g.date)} · {g.customer} · {fmtNumber(g.qty, 2)} {g.product?.code}
                  {g.status === 'DELIVERED' && (
                    <span className="block text-xs text-slate-500">
                      on {g.delivery?.number} · cost {fmtMoney(g.cost, 0)} · DPP {fmtMoney(g.dpp, 0)} · PPN {fmtMoney(g.ppn, 0)}
                    </span>
                  )}
                </span>
                <Badge tone={g.status === 'DELIVERED' ? 'green' : g.status === 'PENDING' ? 'amber' : 'gray'}>{g.status.toLowerCase()}</Badge>
                {g.status === 'PENDING' && can('distribution.visit') && (
                  <Button size="sm" variant="outline" icon="truck" onClick={() => setDeliver(g.id)}>
                    Deliver
                  </Button>
                )}
                {g.status === 'PENDING' && can('distribution.scheme.manage') && (
                  <Button size="sm" variant="ghost" icon="x" aria-label="Cancel" onClick={() => act.mutate({ id: g.id, action: 'cancel' })} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <SchemeForm s={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['distribution'] }))} />}
      {deliver && (
        <Modal
          open
          onClose={() => setDeliver(null)}
          title="Deliver free goods"
          footer={
            <Button icon="check" loading={act.isPending} disabled={!wh} onClick={() => act.mutate({ id: deliver, action: 'deliver' })}>
              Deliver
            </Button>
          }
        >
          <Field label="From warehouse" required>
            <AsyncSelect resource="warehouses" value={wh} onChange={setWh} />
          </Field>
          <p className="mt-2 text-xs text-slate-500">A zero-priced delivery; PPN 12% on 11/12 x the cost is booked to Trade Promotion when the company is a PKP (PMK 11/2025).</p>
        </Modal>
      )}
    </div>
  );
}

function SchemeForm({ s, onClose, onSaved }: { s?: Scheme; onClose: () => void; onSaved: () => void }) {
  const can = useSession((x) => x.can);
  const ro = !can('distribution.scheme.manage');
  const [f, setF] = useState({
    code: s?.code ?? '',
    name: s?.name ?? '',
    supplierId: s?.supplierId ?? (null as string | null),
    type: s?.type ?? 'DISCOUNT',
    minQty: String(s?.minQty ?? 1),
    discountPct: s?.discountPct ? String(s.discountPct) : '',
    bonusProductId: s?.bonusProductId ?? (null as string | null),
    bonusQty: s?.bonusQty ? String(s.bonusQty) : '',
    principalSharePct: String(s?.principalSharePct ?? 0),
    claimType: s?.claimType ?? 'COMPENSATION',
    dateFrom: s?.dateFrom ?? isoDate(),
    dateTo: s?.dateTo ?? isoDate(),
    channels: s?.channels ?? [],
    isActive: s?.isActive ?? true,
    notes: s?.notes ?? '',
  });
  const [products, setProducts] = useState(s?.products.map((p) => ({ id: p.id as string | null, label: `${p.code} - ${p.name}` })) ?? [{ id: null as string | null, label: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        productIds: products.map((p) => p.id).filter(Boolean),
        discountPct: f.type === 'DISCOUNT' ? f.discountPct : null,
        bonusProductId: f.type === 'BONUS' ? f.bonusProductId : null,
        bonusQty: f.type === 'BONUS' ? f.bonusQty : null,
      };
      return s ? api.put(`/distribution/schemes/${s.id}`, body) : api.post('/distribution/schemes', body);
    },
    onSuccess: () => (toast.success('Scheme saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={s ? `Scheme ${s.code}` : 'New trade scheme'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input disabled={ro} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required>
          <Input disabled={ro} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Type">
          <Select
            disabled={ro}
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value })}
            options={[
              { value: 'DISCOUNT', label: 'Discount %' },
              { value: 'BONUS', label: 'Bonus goods (buy X get Y)' },
            ]}
          />
        </Field>
        <Field label={f.type === 'DISCOUNT' ? 'From quantity (per line)' : 'For every (quantity bought)'}>
          <NumberInput disabled={ro} decimals={2} min={0} value={f.minQty} onChange={(v) => setF({ ...f, minQty: v })} />
        </Field>
        {f.type === 'DISCOUNT' ? (
          <Field label="Discount %" required error={errors.discountPct}>
            <NumberInput disabled={ro} decimals={3} min={0} max={100} value={f.discountPct} onChange={(v) => setF({ ...f, discountPct: v })} />
          </Field>
        ) : (
          <>
            <Field label="Bonus product" required error={errors.bonusProductId}>
              <AsyncSelect
                disabled={ro}
                resource="products"
                value={f.bonusProductId}
                initialLabel={s?.bonusProduct ? `${s.bonusProduct.code} - ${s.bonusProduct.name}` : undefined}
                onChange={(v) => setF({ ...f, bonusProductId: v })}
              />
            </Field>
            <Field label="Bonus quantity" required>
              <NumberInput disabled={ro} decimals={2} min={0} value={f.bonusQty} onChange={(v) => setF({ ...f, bonusQty: v })} />
            </Field>
          </>
        )}
        <Field label="From" required>
          <DatePicker disabled={ro} value={f.dateFrom} clearable={false} onChange={(v) => setF({ ...f, dateFrom: v ?? isoDate() })} />
        </Field>
        <Field label="To" required error={errors.dateTo}>
          <DatePicker disabled={ro} value={f.dateTo} clearable={false} onChange={(v) => setF({ ...f, dateTo: v ?? isoDate() })} />
        </Field>
        <Field label="Principal" error={errors.supplierId}>
          <AsyncSelect disabled={ro} resource="suppliers" value={f.supplierId} initialLabel={s?.supplier ?? undefined} onChange={(v) => setF({ ...f, supplierId: v })} />
        </Field>
        <Field label="Principal share %" help="Of the discount / bonus value, claimed back">
          <NumberInput disabled={ro} decimals={2} min={0} max={100} value={f.principalSharePct} onChange={(v) => setF({ ...f, principalSharePct: v })} />
        </Field>
        <Field label="Claimed as" className="sm:col-span-2" help="SE-24/PJ/2018: awards and compensation carry no PPN; services and display rent are services of the distributor, with PPN">
          <Select disabled={ro} value={f.claimType} onChange={(e) => setF({ ...f, claimType: e.target.value })} options={Object.entries(CLAIM_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
      </div>
      <p className="mb-1 mt-4 text-sm font-medium">Products</p>
      {errors.productIds && <p className="mb-1 text-xs text-red-600">{errors.productIds}</p>}
      <div className="space-y-2">
        {products.map((p, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-2">
            <AsyncSelect
              disabled={ro}
              resource="products"
              value={p.id}
              initialLabel={p.label || undefined}
              onChange={(v, o) => setProducts(products.map((x, j) => (j === i ? { id: v, label: o?.label ?? '' } : x)))}
              aria-label="Product"
            />
            {!ro && <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setProducts(products.filter((_, j) => j !== i))} />}
          </div>
        ))}
      </div>
      {!ro && (
        <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setProducts([...products, { id: null, label: '' }])}>
          Product
        </Button>
      )}
      <p className="mb-1 mt-4 text-sm font-medium">Outlet channels (none = all)</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {CHANNELS.map((c) => (
          <label key={c} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              disabled={ro}
              checked={f.channels.includes(c)}
              onChange={(e) => setF({ ...f, channels: e.target.checked ? [...f.channels, c] : f.channels.filter((x) => x !== c) })}
            />{' '}
            {c.toLowerCase()}
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={ro} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
      </label>
    </Modal>
  );
}

// ============================================================ principal claims
export function ClaimsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [from, setFrom] = useState(isoDate().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDate());
  const [make, setMake] = useState<{ supplierId: string; supplier: string | null; claimType: string; amount: number } | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const cl = useQuery({
    queryKey: ['distribution', 'claimable', from, to],
    queryFn: () =>
      api.get<{ supplierId: string; supplier: string | null; claimType: string; amount: number; value: number; lines: number; schemes: string[]; tax: { vat: boolean; wht: string; label: string } }[]>(
        '/distribution/claims/claimable',
        { from, to },
      ),
  });
  const list = useQuery({
    queryKey: ['distribution', 'claims'],
    queryFn: () =>
      api.get<
        {
          id: string;
          number: string;
          supplier: string | null;
          claimType: string;
          periodFrom: string;
          periodTo: string;
          amount: number;
          status: string;
          tax: { vat: boolean; wht: string };
          invoice: { id: string; number: string; status: string; total: number; paid: number } | null;
        }[]
      >('/distribution/claims'),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<{ number: string; invoice: { id: string; number: string } }>('/distribution/claims', {
        supplierId: make!.supplierId,
        customerId,
        claimType: make!.claimType,
        periodFrom: from,
        periodTo: to,
      }),
    onSuccess: (r) => (toast.success(`${r.number}: draft invoice ${r.invoice.number}`), setMake(null), qc.invalidateQueries({ queryKey: ['distribution'] })),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/distribution/claims/${id}/cancel`),
    onSuccess: () => (toast.success('Claim cancelled'), qc.invalidateQueries({ queryKey: ['distribution'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Principal Claims"
        subtitle="The principals' share of the schemes given on confirmed sales, claimed by type (SE-24/PJ/2018): an invoice to the principal, PPN only for services and display rent, the principal withholding the income tax shown"
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <DatePicker value={from} clearable={false} onChange={(v) => setFrom(v ?? isoDate())} aria-label="From" />
            </div>
            <div className="w-40">
              <DatePicker value={to} clearable={false} onChange={(v) => setTo(v ?? isoDate())} aria-label="To" />
            </div>
          </div>
        }
      />
      <Card title="To claim" bodyClass="p-0">
        {cl.isLoading ? (
          <Loading />
        ) : !cl.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">Nothing to claim in this period.</p>
        ) : (
          <ul className="divide-y divide-line">
            {cl.data.map((c) => (
              <li key={`${c.supplierId}-${c.claimType}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {c.supplier} · {c.tax.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {c.lines} lines of {c.schemes.join(', ')} · given {fmtMoney(c.value, 0)} · {c.tax.vat ? 'with PPN' : 'no PPN'} · withholding {c.tax.wht}
                  </span>
                </span>
                <span className="font-semibold">{fmtMoney(c.amount, 0)}</span>
                {can('distribution.claim') && (
                  <Button size="sm" icon="file-signature" onClick={() => (setMake(c), setCustomerId(null))}>
                    Claim
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Claims" bodyClass="p-0">
        {!list.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No claims yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm ${c.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                <span className="min-w-0 flex-1">
                  {c.number} · {c.supplier} · {CLAIM_LABEL[c.claimType]} · {fmtDate(c.periodFrom)} - {fmtDate(c.periodTo)}
                  {c.invoice && (
                    <span className="block text-xs">
                      <Link className="text-brand-600" to={`/documents/SI/${c.invoice.id}`}>
                        {c.invoice.number}
                      </Link>{' '}
                      ({c.invoice.status.toLowerCase()}, paid {fmtMoney(c.invoice.paid, 0)} of {fmtMoney(c.invoice.total, 0)})
                    </span>
                  )}
                </span>
                <span>{fmtMoney(c.amount, 0)}</span>
                {c.status === 'INVOICED' && can('distribution.claim') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="Cancel claim"
                    onClick={async () =>
                      (await confirm({ title: `Cancel ${c.number}?`, message: 'Only while its invoice is a draft; the schemes can be claimed again.', danger: true, confirmText: 'Cancel claim' })) &&
                      cancel.mutate(c.id)
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {make && (
        <Modal
          open
          onClose={() => setMake(null)}
          title={`Claim ${fmtMoney(make.amount, 0)} from ${make.supplier}`}
          footer={
            <Button icon="check" loading={create.isPending} disabled={!customerId} onClick={() => create.mutate()}>
              Make claim invoice
            </Button>
          }
        >
          <Field label="Bill the principal as customer" required help="The customer record of the principal (the claim is an invoice to it)">
            <AsyncSelect resource="customers" value={customerId} onChange={setCustomerId} />
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            {CLAIM_LABEL[make.claimType]} for {fmtDate(from)} - {fmtDate(to)}: a draft invoice to review and send.
          </p>
        </Modal>
      )}
    </div>
  );
}
