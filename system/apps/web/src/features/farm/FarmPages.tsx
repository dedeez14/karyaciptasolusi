import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Tabs, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const SPECIES: Record<string, string> = { BROILER: 'Broiler', LAYER: 'Layer', BREEDER: 'Breeder', DUCK: 'Duck', QUAIL: 'Quail', FISH: 'Fish', SHRIMP: 'Shrimp', OTHER: 'Other' };
const STATUS: Record<string, { label: string; tone: Tone }> = { PLANNED: { label: 'Planned', tone: 'gray' }, ACTIVE: { label: 'Active', tone: 'green' }, CLOSED: { label: 'Closed', tone: 'blue' }, CANCELLED: { label: 'Cancelled', tone: 'gray' } };
const AQUA = ['FISH', 'SHRIMP'];
const LAYING = ['LAYER', 'BREEDER', 'DUCK', 'QUAIL'];
const num = (v: unknown, dp = 2) => (v === null || v === undefined ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};

interface Kpi {
  alive: number;
  ageDays: number;
  depletionPct: number;
  livabilityPct: number;
  liveKg: number;
  avgWeightKg: number | null;
  fcr: number | null;
  ip: number | null;
  feedPerHeadKg: number;
  hdpPct: number | null;
  carrying: number;
  costPerKg: number | null;
}

// ============================================================ cycles list
interface CycleRow {
  id: string;
  number: string;
  species: string;
  strain: string | null;
  status: string;
  phase: string;
  placementDate: string;
  initialQty: number;
  site: { name: string; ownership: string } | null;
  unit: string | null;
  plasma: boolean;
  withdrawalUntil: string | null;
  kpi: Kpi;
}

export function CyclesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('ACTIVE');
  const [species, setSpecies] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['farm', 'cycles', status, species], queryFn: () => api.get<CycleRow[]>('/farm/cycles', { status: status || undefined, species: species || undefined }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Production Cycles"
        subtitle="Flocks, batches and pond crops: daily records, health, harvests and their cost. Own farms and plasma partner farms"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-32">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            <div className="w-32">
              <Select value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="All species" options={Object.entries(SPECIES).map(([value, label]) => ({ value, label }))} />
            </div>
            {can('farm.cycle.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New cycle
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="egg" title="No cycles" description="Set up the farms and houses / ponds first, then open a cycle" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((c) => (
              <li key={c.id}>
                <Link to={`/farm/cycles/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {c.number} · {SPECIES[c.species]}
                      {c.strain ? ` ${c.strain}` : ''} · {c.site?.name} / {c.unit}
                    </span>
                    <span className="block text-xs text-slate-500">
                      placed {fmtDate(c.placementDate)} · {fmtNumber(c.initialQty)} heads · age {c.kpi.ageDays} d · alive {fmtNumber(c.kpi.alive)} · depletion {num(c.kpi.depletionPct)}%{c.kpi.fcr ? ` · FCR ${num(c.kpi.fcr, 3)}` : ''}
                      {c.kpi.ip ? ` · IP ${c.kpi.ip}` : ''}
                    </span>
                  </span>
                  {c.plasma && <Badge tone="violet">Plasma</Badge>}
                  {c.phase === 'LAYING' && <Badge tone="amber">Laying</Badge>}
                  {c.withdrawalUntil && new Date(c.withdrawalUntil) > new Date() && <Badge tone="red">Withdrawal to {fmtDate(c.withdrawalUntil)}</Badge>}
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <NewCycle onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), qc.invalidateQueries({ queryKey: ['farm'] }), navigate(`/farm/cycles/${id}`))} />}
    </div>
  );
}

interface ContractRow {
  id: string;
  number: string;
  status: string;
  partnerId: string;
  partner: { id: string; code: string; name: string } | null;
  siteId: string | null;
  site: { id: string; name: string } | null;
  species: string;
  startDate: string;
  endDate: string | null;
  docPrice: number;
  feedPrices: { productId: string; price: number; name: string }[];
  medicineMarkupPct: number;
  priceBands: { minKg: number; maxKg: number; price: number }[];
  standardFcr: number | null;
  fcrBonusPerPoint: number;
  ipThreshold: number | null;
  ipBonusPerKg: number;
  withholdPph22: boolean;
  carryForward: number;
  terms: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

function NewCycle({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ unitId: null as string | null, species: 'BROILER', strain: '', placementDate: isoDate(), initialQty: '', initialAgeDays: '0', warehouseId: null as string | null, stockProductId: null as string | null, outputProductId: null as string | null, cullProductId: null as string | null, eggProductId: null as string | null, eggUnit: 'KG', contractId: '', targetFcr: '', targetWeightKg: '', targetAgeDays: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const contracts = useQuery({ queryKey: ['farm', 'contracts'], queryFn: () => api.get<ContractRow[]>('/farm/contracts') });
  const save = useMutation({ mutationFn: () => api.post<{ id: string; number: string }>('/farm/cycles', { ...f, contractId: f.contractId || null }), onSuccess: (r) => (toast.success(`Cycle ${r.number} opened`), onSaved(r.id)), onError: (e) => (setErrors(errorsOf(e)), toast.error(e)) });
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const laying = LAYING.includes(f.species);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New production cycle"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.unitId || !f.warehouseId || !(Number(f.initialQty) > 0)} onClick={() => save.mutate()}>
          Open cycle
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="House / pond" required error={errors.unitId}>
          <AsyncSelect resource="farm-units" value={f.unitId} onChange={set('unitId')} manageHref="/r/farm-units" manageLabel="Manage houses & ponds" />
        </Field>
        <Field label="Species">
          <Select value={f.species} onChange={(e) => set('species')(e.target.value)} options={Object.entries(SPECIES).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Strain / variety">
          <Input value={f.strain} maxLength={100} placeholder={AQUA.includes(f.species) ? 'Vannamei, nila merah...' : 'Cobb 500, Ross 308, Lohmann...'} onChange={(e) => set('strain')(e.target.value)} />
        </Field>
        <Field label="Placement date" required>
          <DatePicker value={f.placementDate} onChange={(v) => set('placementDate')(v ?? isoDate())} />
        </Field>
        <Field label={AQUA.includes(f.species) ? 'Fry / seed stocked (heads)' : 'Heads placed'} required error={errors.initialQty}>
          <NumberInput decimals={0} min={1} value={f.initialQty} onChange={set('initialQty')} />
        </Field>
        <Field label="Age at placement (days)" help="DOC 0, point-of-lay pullets about 112">
          <NumberInput decimals={0} min={0} value={f.initialAgeDays} onChange={set('initialAgeDays')} />
        </Field>
        <Field label="Warehouse" required help="Feed and medicines are taken from it; the harvest goes into it" error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={set('warehouseId')} />
        </Field>
        <Field label="Stock placed (DOC / fry / pullets)" help="Leaves stock at placement; its cost starts the cycle" error={errors.stockProductId}>
          <AsyncSelect resource="products" value={f.stockProductId} onChange={set('stockProductId')} />
        </Field>
        <Field label="Harvested product (kg)" help="e.g. live broiler (kg), fresh fish (kg)" error={errors.outputProductId}>
          <AsyncSelect resource="products" value={f.outputProductId} onChange={set('outputProductId')} />
        </Field>
        {laying && (
          <>
            <Field label="Egg product" error={errors.eggProductId}>
              <AsyncSelect resource="products" value={f.eggProductId} onChange={set('eggProductId')} />
            </Field>
            <Field label="Eggs into stock by">
              <Select value={f.eggUnit} onChange={(e) => set('eggUnit')(e.target.value)} options={[{ value: 'KG', label: 'Kilogram' }, { value: 'PCS', label: 'Pieces' }]} />
            </Field>
            <Field label="Culled birds product (afkir, kg)" error={errors.cullProductId}>
              <AsyncSelect resource="products" value={f.cullProductId} onChange={set('cullProductId')} />
            </Field>
          </>
        )}
        <Field label="Plasma contract" help="Only for a plasma partner farm" error={errors.contractId}>
          <Select value={f.contractId} onChange={(e) => set('contractId')(e.target.value)} placeholder="Own farm" options={(contracts.data ?? []).filter((k) => k.status === 'ACTIVE').map((k) => ({ value: k.id, label: `${k.number} · ${k.partner?.name ?? ''}` }))} />
        </Field>
        <Field label="Target FCR">
          <NumberInput decimals={3} min={0} value={f.targetFcr} onChange={set('targetFcr')} />
        </Field>
        <Field label="Target weight (kg / head)">
          <NumberInput decimals={3} min={0} value={f.targetWeightKg} onChange={set('targetWeightKg')} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ cycle page
interface Daily {
  id: string;
  date: string;
  age: number;
  aliveStart: number;
  mortality: number;
  culled: number;
  abnormal: boolean;
  feedProduct: string | null;
  feedKg: number;
  waterL: number | null;
  avgWeightG: number | null;
  sampleSize: number | null;
  eggsGood: number;
  eggsCracked: number;
  eggsKg: number;
  tempMin: number | null;
  tempMax: number | null;
  humidity: number | null;
  waterQuality: Record<string, number | null> | null;
  notes: string | null;
  feedCost: number;
  lossValue: number;
  eggCost: number;
}
interface Treatment {
  id: string;
  kind: string;
  status: string;
  date: string;
  product: string | null;
  description: string;
  qty: number;
  cost: number;
  method: string | null;
  withdrawalDays: number;
  withdrawalUntil: string | null;
  vet: string | null;
}
interface Harvest {
  id: string;
  number: string;
  date: string;
  kind: string;
  qty: number;
  weightKg: number;
  ageDays: number;
  pricePerKg: number | null;
  fairValue: number | null;
  cost: number;
  customer: string | null;
  delivery: { id: string; number: string; status: string } | null;
  vehicleNo: string | null;
  overrideReason: string | null;
  status: string;
}
interface CycleDetail {
  id: string;
  number: string;
  species: string;
  strain: string | null;
  status: string;
  phase: string;
  placementDate: string;
  initialQty: number;
  initialAgeDays: number;
  mortality: number;
  culled: number;
  harvestedQty: number;
  harvestedKg: number;
  feedKg: number;
  eggsGood: number;
  eggsKg: number;
  costIn: number;
  costOut: number;
  abnormalLoss: number;
  rearingCost: number;
  rearingAmortised: number;
  layStartDate: string | null;
  expectedLayWeeks: number;
  withdrawalUntil: string | null;
  targetFcr: number | null;
  targetWeightKg: number | null;
  closedAt: string | null;
  layingSpecies: boolean;
  site: { name: string; ownership: string } | null;
  unit: { name: string } | null;
  products: { stock: { name: string } | null; output: { name: string } | null; cull: { name: string } | null; egg: { name: string } | null };
  contract: { id: string; number: string; partner: { id: string; name: string } | null } | null;
  settlement: { id: string; number: string; net: number } | null;
  kpi: Kpi;
  daily: Daily[];
  treatments: Treatment[];
  costs: { id: string; date: string; kind: string; description: string; amount: number }[];
  harvests: Harvest[];
}

export function CyclePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [tab, setTab] = useState<'daily' | 'health' | 'harvest' | 'costs' | 'settlement'>('daily');
  const [modal, setModal] = useState<'day' | 'treat' | 'harvest' | 'cost' | 'lay' | 'close' | null>(null);
  const q = useQuery({ queryKey: ['farm', 'cycle', id], queryFn: () => api.get<CycleDetail>(`/farm/cycles/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['farm'] });
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/farm/cycles/${id}/${path}`, body ?? {}), onSuccess: () => (toast.success('Done'), refresh()), onError: (e) => toast.error(e) });
  const c = q.data;
  if (q.isLoading || !c)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const active = c.status === 'ACTIVE';
  const aqua = AQUA.includes(c.species);
  const k = c.kpi;
  const withdrawal = c.withdrawalUntil && new Date(c.withdrawalUntil) > new Date(isoDate()) ? c.withdrawalUntil : null;
  const kpis = [
    { label: 'Alive', value: fmtNumber(k.alive), hint: `of ${fmtNumber(c.initialQty)}` },
    { label: 'Age', value: `${k.ageDays} d`, hint: c.phase === 'LAYING' ? `laying since ${fmtDate(c.layStartDate)}` : '' },
    { label: aqua ? 'Survival' : 'Depletion', value: aqua ? `${num(k.livabilityPct)}%` : `${num(k.depletionPct)}%`, hint: `${c.mortality} dead · ${c.culled} culled` },
    { label: 'Average weight', value: k.avgWeightKg ? `${num(k.avgWeightKg, 3)} kg` : '-', hint: c.targetWeightKg ? `target ${num(c.targetWeightKg, 3)}` : '' },
    { label: 'FCR', value: k.fcr ? num(k.fcr, 3) : '-', hint: c.targetFcr ? `target ${num(c.targetFcr, 3)}` : `${fmtNumber(c.feedKg)} kg feed` },
    c.layingSpecies && c.phase === 'LAYING' ? { label: 'HDP (last day)', value: k.hdpPct === null ? '-' : `${num(k.hdpPct)}%`, hint: `${fmtNumber(c.eggsGood)} eggs · ${num(c.eggsKg, 1)} kg` } : { label: 'IP', value: k.ip ?? '-', hint: 'livability x weight / (FCR x age)' },
    { label: 'Cost / kg', value: k.costPerKg ? fmtMoney(k.costPerKg, 0) : '-', hint: `in the cycle ${fmtMoney(k.carrying, 0)}` },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.number}
            <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
            {c.contract && <Badge tone="violet">Plasma · {c.contract.partner?.name}</Badge>}
          </span>
        }
        subtitle={`${SPECIES[c.species]}${c.strain ? ` ${c.strain}` : ''} · ${c.site?.name} / ${c.unit?.name} · placed ${fmtDate(c.placementDate)}`}
        back={() => navigate('/farm/cycles')}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.status === 'PLANNED' && can('farm.cycle.manage') && (
              <>
                <Button variant="ghost" loading={act.isPending} onClick={() => act.mutate({ path: 'cancel' })}>
                  Cancel
                </Button>
                <Button icon="check" loading={act.isPending} onClick={() => act.mutate({ path: 'place' })}>
                  Place {c.products.stock ? 'from stock' : ''}
                </Button>
              </>
            )}
            {active && c.layingSpecies && c.phase === 'GROWING' && can('farm.cycle.manage') && (
              <Button variant="outline" icon="egg" onClick={() => setModal('lay')}>
                Start laying
              </Button>
            )}
            {active && can('farm.cycle.manage') && (
              <Button variant="outline" onClick={() => setModal('close')}>
                Close cycle
              </Button>
            )}
          </div>
        }
      />
      {withdrawal && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          Withdrawal period until <b>{fmtDate(withdrawal)}</b>: medicine residues may remain, do not harvest or sell eggs / meat before it ends.
        </div>
      )}
      <Card bodyClass="p-0">
        <dl className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
          {kpis.map((x) => (
            <div key={x.label} className="border-b border-line px-4 py-3 xl:border-b-0">
              <dt className="text-xs text-slate-500">{x.label}</dt>
              <dd className="text-lg font-semibold">{x.value}</dd>
              <dd className="truncate text-xs text-slate-500">{x.hint}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'daily', label: 'Daily records' },
          { value: 'health', label: 'Health' },
          { value: 'harvest', label: 'Harvests' },
          { value: 'costs', label: 'Costs' },
          ...(c.contract ? [{ value: 'settlement' as const, label: 'Settlement (RHPP)' }] : []),
        ]}
      />
      {tab === 'daily' && <DailyTab c={c} onAdd={() => setModal('day')} onChanged={refresh} />}
      {tab === 'health' && <HealthTab c={c} onAdd={() => setModal('treat')} onChanged={refresh} />}
      {tab === 'harvest' && <HarvestTab c={c} onAdd={() => setModal('harvest')} onChanged={refresh} />}
      {tab === 'costs' && <CostsTab c={c} onAdd={() => setModal('cost')} />}
      {tab === 'settlement' && c.contract && <SettlementTab c={c} onChanged={refresh} />}
      {modal === 'day' && <DayModal c={c} onClose={() => setModal(null)} onSaved={() => (setModal(null), refresh())} />}
      {modal === 'treat' && <TreatmentModal c={c} onClose={() => setModal(null)} onSaved={() => (setModal(null), refresh())} />}
      {modal === 'harvest' && <HarvestModal c={c} withdrawal={withdrawal} onClose={() => setModal(null)} onSaved={() => (setModal(null), refresh())} />}
      {modal === 'cost' && <CostModal c={c} onClose={() => setModal(null)} onSaved={() => (setModal(null), refresh())} />}
      {modal === 'lay' && <LayModal c={c} onClose={() => setModal(null)} onSaved={() => (setModal(null), refresh())} />}
      {modal === 'close' && (
        <Modal
          open
          size="sm"
          onClose={() => setModal(null)}
          title={`Close ${c.number}`}
          footer={
            <Button icon="check" loading={act.isPending} disabled={k.alive > 0} onClick={() => act.mutate({ path: 'close', body: { date: isoDate() } }, { onSuccess: () => setModal(null) })}>
              Close
            </Button>
          }
        >
          <p className="text-sm">{k.alive > 0 ? `${fmtNumber(k.alive)} heads are still alive: harvest them, or record them as dead / culled, first.` : `Cost still in the cycle (${fmtMoney(k.carrying, 0)}) is written off as a loss.`}</p>
        </Modal>
      )}
    </div>
  );
}

function DailyTab({ c, onAdd, onChanged }: { c: CycleDetail; onAdd: () => void; onChanged: () => void }) {
  const can = useSession((s) => s.can);
  const aqua = AQUA.includes(c.species);
  const last = c.daily[c.daily.length - 1];
  const del = async () => {
    if (!(await confirm({ title: `Delete the record of ${fmtDate(last.date)}?`, message: 'Feed and eggs go back, costs are reversed.', danger: true, confirmText: 'Delete' }))) return;
    try {
      await api.delete(`/farm/cycles/${c.id}/daily/${last.id}`);
      toast.success('Deleted');
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  let cumFeed = 0;
  return (
    <Card
      bodyClass="p-0 overflow-x-auto"
      actions={
        c.status === 'ACTIVE' &&
        can('farm.record') && (
          <div className="flex gap-2">
            {last && (
              <Button size="sm" variant="ghost" onClick={del}>
                Delete last day
              </Button>
            )}
            <Button size="sm" icon="plus" onClick={onAdd}>
              Record day
            </Button>
          </div>
        )
      }
      title="Daily records"
      subtitle={aqua ? 'Feed, mortality, sampling and water quality' : 'Mortality, culls, feed, water, weight sampling, climate and eggs'}
    >
      {!c.daily.length ? (
        <EmptyState icon="clipboard-list" title="No days recorded" />
      ) : (
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-right">Age</th>
              <th className="px-2 py-2 text-right">Alive</th>
              <th className="px-2 py-2 text-right">Dead</th>
              <th className="px-2 py-2 text-right">Culled</th>
              <th className="px-2 py-2 text-right">Feed kg</th>
              <th className="px-2 py-2 text-right">Cum. feed</th>
              <th className="px-2 py-2 text-right">Weight g</th>
              {c.layingSpecies && <th className="px-2 py-2 text-right">Eggs</th>}
              {c.layingSpecies && <th className="px-2 py-2 text-right">HDP</th>}
              <th className="px-2 py-2 text-left">{aqua ? 'Water' : 'Climate'}</th>
              <th className="px-2 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {c.daily.map((d) => {
              cumFeed += d.feedKg;
              const hens = d.aliveStart - d.mortality - d.culled;
              const eggs = d.eggsGood + d.eggsCracked;
              const wq = d.waterQuality ?? {};
              return (
                <tr key={d.id}>
                  <td className="px-3 py-2">{fmtDate(d.date)}</td>
                  <td className="px-2 py-2 text-right">{d.age}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(hens)}</td>
                  <td className={d.abnormal ? 'px-2 py-2 text-right font-medium text-red-600' : 'px-2 py-2 text-right'}>{d.mortality || ''}</td>
                  <td className="px-2 py-2 text-right">{d.culled || ''}</td>
                  <td className="px-2 py-2 text-right">{d.feedKg ? fmtNumber(d.feedKg, 1) : ''}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{fmtNumber(cumFeed, 0)}</td>
                  <td className="px-2 py-2 text-right">{d.avgWeightG ? fmtNumber(d.avgWeightG, 0) : ''}</td>
                  {c.layingSpecies && <td className="px-2 py-2 text-right">{eggs ? `${fmtNumber(eggs)} · ${fmtNumber(d.eggsKg, 1)} kg` : ''}</td>}
                  {c.layingSpecies && <td className="px-2 py-2 text-right">{eggs && hens ? `${fmtNumber((eggs / hens) * 100, 1)}%` : ''}</td>}
                  <td className="px-2 py-2 text-xs text-slate-600">
                    {aqua
                      ? [wq.do != null && `DO ${wq.do}`, wq.ph != null && `pH ${wq.ph}`, wq.salinity != null && `sal ${wq.salinity}‰`, wq.tempC != null && `${wq.tempC}°C`].filter(Boolean).join(' · ')
                      : [d.tempMin != null && d.tempMax != null && `${d.tempMin}-${d.tempMax}°C`, d.humidity != null && `RH ${d.humidity}%`, d.waterL != null && `${fmtNumber(d.waterL, 0)} L`].filter(Boolean).join(' · ')}
                  </td>
                  <td className="max-w-[16rem] truncate px-2 py-2 text-xs text-slate-600">{[d.abnormal ? 'abnormal' : '', d.notes].filter(Boolean).join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DayModal({ c, onClose, onSaved }: { c: CycleDetail; onClose: () => void; onSaved: () => void }) {
  const aqua = AQUA.includes(c.species);
  const laying = c.layingSpecies;
  const last = c.daily[c.daily.length - 1];
  const next = last ? isoDate(new Date(new Date(last.date).getTime() + 86_400_000)) : c.placementDate.slice(0, 10);
  const [f, setF] = useState({ date: next > isoDate() ? isoDate() : next, mortality: '', culled: '', abnormal: false, feedProductId: null as string | null, feedKg: '', waterL: '', avgWeightG: '', sampleSize: '', eggsGood: '', eggsCracked: '', eggsKg: '', tempMin: '', tempMax: '', humidity: '', do: '', ph: '', salinity: '', tempC: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const z = (v: string) => (v === '' ? 0 : v);
      return api.post(`/farm/cycles/${c.id}/daily`, {
        date: f.date,
        mortality: z(f.mortality),
        culled: z(f.culled),
        abnormal: f.abnormal,
        feedProductId: f.feedProductId,
        feedKg: z(f.feedKg),
        waterL: f.waterL,
        avgWeightG: f.avgWeightG,
        sampleSize: f.sampleSize,
        eggsGood: z(f.eggsGood),
        eggsCracked: z(f.eggsCracked),
        eggsKg: z(f.eggsKg),
        tempMin: f.tempMin,
        tempMax: f.tempMax,
        humidity: f.humidity,
        waterQuality: aqua ? { do: f.do, ph: f.ph, salinity: f.salinity, tempC: f.tempC } : null,
        notes: f.notes,
      });
    },
    onSuccess: () => (toast.success('Day recorded'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const nf = (k: keyof typeof f, label: string, dec = 0, help?: string) => (
    <Field label={label} help={help} error={errors[k]}>
      <NumberInput decimals={dec} min={0} value={f[k] as string} onChange={set(k)} />
    </Field>
  );
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Record day · ${c.number}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save day
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Date" required className="col-span-2" error={errors.date}>
          <DatePicker value={f.date} min={c.placementDate.slice(0, 10)} max={isoDate()} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        {nf('mortality', 'Dead')}
        {nf('culled', 'Culled')}
        <div className="col-span-2 sm:col-span-4">
          <Checkbox checked={f.abnormal} onChange={set('abnormal')} label="Mortality above normal (disease outbreak, heat stress...): its cost is written off as a loss" />
        </div>
        <Field label="Feed" className="col-span-2" error={errors.feedProductId}>
          <AsyncSelect resource="products" value={f.feedProductId} onChange={set('feedProductId')} />
        </Field>
        {nf('feedKg', 'Feed kg', 3)}
        {!aqua && nf('waterL', 'Water L', 2)}
        {nf('avgWeightG', aqua ? 'Sample weight g / head' : 'Average weight g', 2)}
        {nf('sampleSize', 'Sample size')}
        {laying && (
          <>
            {nf('eggsGood', 'Eggs good')}
            {nf('eggsCracked', 'Eggs cracked')}
            {nf('eggsKg', 'Eggs kg', 3, c.products.egg ? `into ${c.products.egg.name}` : 'set the egg product of the cycle')}
          </>
        )}
        {aqua ? (
          <>
            {nf('do', 'DO mg/L', 2)}
            {nf('ph', 'pH', 2)}
            {nf('salinity', 'Salinity ‰', 2)}
            {nf('tempC', 'Water °C', 1)}
          </>
        ) : (
          <>
            {nf('tempMin', 'Temp min °C', 1)}
            {nf('tempMax', 'Temp max °C', 1)}
            {nf('humidity', 'Humidity %', 1)}
          </>
        )}
        <Field label="Notes" className="col-span-2 sm:col-span-4">
          <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

const KIND: Record<string, string> = { VACCINE: 'Vaccine', MEDICINE: 'Medicine', VITAMIN: 'Vitamin / supplement', DISINFECTANT: 'Disinfectant' };

function HealthTab({ c, onAdd, onChanged }: { c: CycleDetail; onAdd: () => void; onChanged: () => void }) {
  const can = useSession((s) => s.can);
  const done = useMutation({ mutationFn: (t: Treatment) => api.post(`/farm/cycles/${c.id}/treatments/${t.id}/done`, { date: t.date.slice(0, 10) <= isoDate() ? t.date.slice(0, 10) : isoDate() }), onSuccess: () => (toast.success('Given'), onChanged()), onError: (e) => toast.error(e) });
  const cancel = useMutation({ mutationFn: (t: Treatment) => api.post(`/farm/cycles/${c.id}/treatments/${t.id}/cancel`), onSuccess: () => onChanged(), onError: (e) => toast.error(e) });
  const rows = c.treatments.filter((t) => t.status !== 'CANCELLED');
  return (
    <Card
      title="Vaccinations and medicines"
      subtitle="Plan the vaccination programme; giving a product takes it from stock. Medicines with a withdrawal period block the harvest until it ends"
      bodyClass="p-0"
      actions={
        ['PLANNED', 'ACTIVE'].includes(c.status) &&
        can('farm.record') && (
          <Button size="sm" icon="plus" onClick={onAdd}>
            Add
          </Button>
        )
      }
    >
      {!rows.length ? (
        <EmptyState icon="syringe" title="Nothing recorded" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {fmtDate(t.date)} · {t.description}
                </span>
                <span className="block text-xs text-slate-500">
                  {KIND[t.kind]}
                  {t.product ? ` · ${t.product} x ${fmtNumber(t.qty)}` : ''}
                  {t.method ? ` · ${t.method}` : ''}
                  {t.cost ? ` · ${fmtMoney(t.cost, 0)}` : ''}
                  {t.vet ? ` · ${t.vet}` : ''}
                </span>
              </span>
              {t.withdrawalUntil && <Badge tone={new Date(t.withdrawalUntil) > new Date() ? 'red' : 'gray'}>withdrawal to {fmtDate(t.withdrawalUntil)}</Badge>}
              {t.status === 'PLANNED' ? (
                <>
                  <Badge tone={new Date(t.date) < new Date(isoDate()) ? 'amber' : 'gray'}>Planned</Badge>
                  {c.status === 'ACTIVE' && can('farm.record') && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(t)}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="outline" loading={done.isPending} onClick={() => done.mutate(t)}>
                        Given
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <Badge tone="green">Given</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TreatmentModal({ c, onClose, onSaved }: { c: CycleDetail; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'VACCINE', status: c.status === 'ACTIVE' ? 'DONE' : 'PLANNED', date: isoDate(), productId: null as string | null, description: '', qty: '', method: '', withdrawalDays: '0', vet: '', notes: '' });
  const save = useMutation({ mutationFn: () => api.post(`/farm/cycles/${c.id}/treatments`, { ...f, qty: f.qty || 0 }), onSuccess: () => (toast.success('Saved'), onSaved()), onError: (e) => toast.error(e) });
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      title="Vaccination / medicine"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.description.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={f.kind} onChange={(e) => set('kind')(e.target.value)} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status')(e.target.value)} options={[{ value: 'DONE', label: 'Given now' }, { value: 'PLANNED', label: 'Planned (programme)' }]} />
        </Field>
        <Field label="Date">
          <DatePicker value={f.date} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        <Field label="What" required>
          <Input value={f.description} maxLength={200} placeholder="ND-IB day 4, Gumboro, enrofloxacin..." onChange={(e) => set('description')(e.target.value)} />
        </Field>
        <Field label="Product from stock">
          <AsyncSelect resource="products" value={f.productId} onChange={set('productId')} />
        </Field>
        <Field label="Quantity">
          <NumberInput decimals={4} min={0} value={f.qty} onChange={set('qty')} />
        </Field>
        <Field label="Method">
          <Input value={f.method} maxLength={40} placeholder="drinking water, eye drop, injection..." onChange={(e) => set('method')(e.target.value)} />
        </Field>
        <Field label="Withdrawal period (days)" help="From the product label: no harvest / eggs for consumption before it ends">
          <NumberInput decimals={0} min={0} max={365} value={f.withdrawalDays} onChange={set('withdrawalDays')} />
        </Field>
        <Field label="Veterinarian" className="sm:col-span-2">
          <Input value={f.vet} maxLength={120} onChange={(e) => set('vet')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function HarvestTab({ c, onAdd, onChanged }: { c: CycleDetail; onAdd: () => void; onChanged: () => void }) {
  const can = useSession((s) => s.can);
  const posted = c.harvests.filter((h) => h.status === 'POSTED');
  const lastId = posted[posted.length - 1]?.id;
  const cancel = async (h: Harvest) => {
    if (!(await confirm({ title: `Cancel ${h.number}?`, message: 'The produce leaves stock and its cost goes back to the cycle; a draft delivery is deleted.', danger: true, confirmText: 'Cancel harvest' }))) return;
    try {
      await api.post(`/farm/cycles/${c.id}/harvests/${h.id}/cancel`);
      toast.success('Cancelled');
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card
      title="Harvests"
      subtitle="Each harvest takes its share of the cycle cost into stock (or the fair value less costs to sell, when given). With a buyer a draft delivery order is made: live animals and fresh produce are exempt from PPN (PP 49/2022)"
      bodyClass="p-0"
      actions={
        c.status === 'ACTIVE' &&
        can('farm.harvest') && (
          <Button size="sm" icon="plus" onClick={onAdd}>
            Harvest
          </Button>
        )
      }
    >
      {!c.harvests.length ? (
        <EmptyState icon="truck" title="No harvests" />
      ) : (
        <ul className="divide-y divide-line">
          {c.harvests.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {h.number} · {fmtDate(h.date)} · {h.kind === 'CULL' ? 'Culled (afkir)' : 'Harvest'} {fmtNumber(h.qty)} heads · {fmtNumber(h.weightKg, 1)} kg
                </span>
                <span className="block text-xs text-slate-500">
                  age {h.ageDays} d · avg {fmtNumber(h.weightKg / Math.max(1, h.qty), 3)} kg · cost {fmtMoney(h.cost, 0)}
                  {h.fairValue !== null ? ` · fair value ${fmtMoney(h.fairValue, 0)}` : ''}
                  {h.customer ? ` · ${h.customer}` : ''}
                  {h.pricePerKg ? ` @ ${fmtMoney(h.pricePerKg, 0)}/kg` : ''}
                  {h.vehicleNo ? ` · ${h.vehicleNo}` : ''}
                  {h.overrideReason ? ` · inside withdrawal: ${h.overrideReason}` : ''}
                </span>
              </span>
              {h.delivery && (
                <Link to={`/documents/DO/${h.delivery.id}`} className="text-xs text-brand-600">
                  {h.delivery.number}
                </Link>
              )}
              {h.status === 'CANCELLED' ? (
                <Badge tone="gray">Cancelled</Badge>
              ) : (
                h.id === lastId &&
                c.status === 'ACTIVE' &&
                c.phase !== 'LAYING' &&
                can('farm.harvest') && (
                  <Button size="sm" variant="ghost" onClick={() => cancel(h)}>
                    Cancel
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HarvestModal({ c, withdrawal, onClose, onSaved }: { c: CycleDetail; withdrawal: string | null; onClose: () => void; onSaved: () => void }) {
  const aqua = AQUA.includes(c.species);
  const [f, setF] = useState({ date: isoDate(), kind: c.phase === 'LAYING' ? 'CULL' : 'HARVEST', final: false, qty: '', weightKg: '', customerId: null as string | null, pricePerKg: '', fairValue: '', vehicleNo: '', deliveryNo: '', overrideReason: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: () => api.post<{ number: string }>(`/farm/cycles/${c.id}/harvests`, { ...f, qty: f.final ? 0 : f.qty || 0 }), onSuccess: (r) => (toast.success(`${r.number} recorded`), onSaved()), onError: (e) => (setErrors(errorsOf(e)), toast.error(e)) });
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const inWithdrawal = withdrawal && f.date < withdrawal.slice(0, 10);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Harvest · ${c.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!(Number(f.weightKg) > 0) || (!f.final && !(Number(f.qty) > 0)) || (!!inWithdrawal && !f.overrideReason.trim())} onClick={() => save.mutate()}>
          Record harvest
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date">
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        {c.layingSpecies && (
          <Field label="Kind">
            <Select value={f.kind} onChange={(e) => set('kind')(e.target.value)} options={[{ value: 'HARVEST', label: 'Harvest' }, { value: 'CULL', label: 'Culled birds (afkir)' }]} />
          </Field>
        )}
        <div className="flex items-end pb-2 sm:col-span-2">
          <Switch checked={f.final} onChange={set('final')} label={`Final: take all ${fmtNumber(c.kpi.alive)} still alive${aqua ? ' (pond count is an estimate)' : ''}`} />
        </div>
        {!f.final && (
          <Field label="Heads" required error={errors.qty}>
            <NumberInput decimals={0} min={1} max={c.kpi.alive} value={f.qty} onChange={set('qty')} />
          </Field>
        )}
        <Field label="Weight (kg)" required error={errors.weightKg}>
          <NumberInput decimals={3} min={0} value={f.weightKg} onChange={set('weightKg')} />
        </Field>
        <Field label="Buyer" help="Makes a draft delivery order" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={set('customerId')} />
        </Field>
        <Field label="Agreed price per kg">
          <NumberInput decimals={2} min={0} value={f.pricePerKg} onChange={set('pricePerKg')} />
        </Field>
        <Field label="Fair value less costs to sell (optional)" help="Market value of the whole harvest at the farm gate minus selling costs; empty = at cost" className="sm:col-span-2">
          <NumberInput decimals={2} min={0} value={f.fairValue} onChange={set('fairValue')} />
        </Field>
        <Field label="Vehicle no.">
          <Input value={f.vehicleNo} maxLength={30} onChange={(e) => set('vehicleNo')(e.target.value)} />
        </Field>
        <Field label="Delivery / DO no.">
          <Input value={f.deliveryNo} maxLength={60} onChange={(e) => set('deliveryNo')(e.target.value)} />
        </Field>
        {inWithdrawal && (
          <Field label="Reason to harvest inside the withdrawal period" required className="sm:col-span-2" help={`Withdrawal runs until ${fmtDate(withdrawal)}`}>
            <Input value={f.overrideReason} maxLength={300} onChange={(e) => set('overrideReason')(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

const COST_KIND: Record<string, string> = { STOCK: 'Stock placed', FEED: 'Feed', TREATMENT: 'Health', LABOUR: 'Labour', OVERHEAD: 'Overhead', LOSS: 'Abnormal loss', HARVEST: 'Harvest', EGGS: 'Eggs', WRITE_OFF: 'Written off' };

function CostsTab({ c, onAdd }: { c: CycleDetail; onAdd: () => void }) {
  const can = useSession((s) => s.can);
  const by = new Map<string, number>();
  c.costs.forEach((x) => by.set(x.kind, (by.get(x.kind) ?? 0) + x.amount));
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Summary" subtitle="Biological asset at cost (SAK EP): charged in, taken out by harvests and eggs">
        <dl className="space-y-1 text-sm">
          {[...by.entries()].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt>{COST_KIND[k] ?? k}</dt>
              <dd className={v < 0 ? 'text-slate-500' : ''}>{fmtMoney(v, 0)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <dt>Still in the cycle</dt>
            <dd>{fmtMoney(c.kpi.carrying, 0)}</dd>
          </div>
        </dl>
        {c.phase === 'LAYING' && (
          <p className="mt-3 text-xs text-slate-500">
            Rearing cost {fmtMoney(c.rearingCost, 0)} written off into the eggs over {c.expectedLayWeeks} weeks: {fmtMoney(c.rearingAmortised, 0)} so far.
          </p>
        )}
      </Card>
      <Card
        title="Cost ledger"
        className="lg:col-span-2"
        bodyClass="p-0"
        actions={
          c.status === 'ACTIVE' &&
          can('farm.cycle.manage') && (
            <Button size="sm" icon="plus" variant="outline" onClick={onAdd}>
              Labour / overhead
            </Button>
          )
        }
      >
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto text-sm">
          {c.costs.map((x) => (
            <li key={x.id} className="flex justify-between gap-3 px-4 py-1.5">
              <span className="min-w-0 truncate">
                <span className="text-slate-500">{fmtDate(x.date)}</span> · {COST_KIND[x.kind] ?? x.kind} · {x.description}
              </span>
              <span className={x.amount < 0 ? 'text-slate-500' : ''}>{fmtMoney(x.amount, 0)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CostModal({ c, onClose, onSaved }: { c: CycleDetail; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: isoDate(), kind: 'OVERHEAD', description: '', amount: '' });
  const save = useMutation({ mutationFn: () => api.post(`/farm/cycles/${c.id}/costs`, f), onSuccess: () => (toast.success('Charged to the cycle'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Charge a cost to the cycle"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.description.trim() || !(Number(f.amount) > 0)} onClick={() => save.mutate()}>
          Charge
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Date">
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Kind" help="Credited to labour / overhead applied (the expenses themselves are booked as usual)">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'LABOUR', label: 'Farm labour' }, { value: 'OVERHEAD', label: 'Overhead (electricity, litter, gas, depreciation...)' }]} />
        </Field>
        <Field label="Description" required>
          <Input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Amount" required>
          <NumberInput decimals={2} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
      </div>
    </Modal>
  );
}

function LayModal({ c, onClose, onSaved }: { c: CycleDetail; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: isoDate(), expectedLayWeeks: '60' });
  const save = useMutation({ mutationFn: () => api.post(`/farm/cycles/${c.id}/laying`, f), onSuccess: () => (toast.success('Laying started'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Onset of lay"
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Start laying
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">The rearing cost so far ({fmtMoney(c.kpi.carrying, 0)}) is written off into the eggs over the laying period; feed and health costs from now on go to the eggs.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Expected laying weeks">
          <NumberInput decimals={0} min={1} max={260} value={f.expectedLayWeeks} onChange={(v) => setF({ ...f, expectedLayWeeks: v })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ settlement (RHPP)
interface Preview {
  cycle: { number: string; alive: number; initialQty: number; mortality: number; culled: number };
  contract: { number: string; partner: { name: string } | null; withholdPph22: boolean };
  harvestQty: number;
  harvestKg: number;
  avgWeightKg: number;
  avgAgeDays: number;
  pricePerKg: number;
  revenue: number;
  docCharge: number;
  feed: { name: string; kg: number; price: number | null; amount: number }[];
  feedCharge: number;
  medicineCharge: number;
  fcr: number;
  standardFcr: number | null;
  fcrPoints: number;
  ip: number;
  fcrBonus: number;
  ipBonus: number;
  deductions: number;
  carriedIn: number;
  net: number;
  settled: { id: string; number: string; net: number } | null;
  warnings: string[];
}

function SettlementTab({ c, onChanged }: { c: CycleDetail; onChanged: () => void }) {
  const can = useSession((s) => s.can);
  const [deductions, setDeductions] = useState('');
  const [notes, setNotes] = useState('');
  const q = useQuery({ queryKey: ['farm', 'rhpp', c.id, deductions], queryFn: () => api.get<Preview>(`/farm/cycles/${c.id}/settlement`, { deductions: deductions || undefined }) });
  const settle = useMutation({ mutationFn: () => api.post<{ number: string; net: number }>(`/farm/cycles/${c.id}/settlement`, { date: isoDate(), deductions: deductions || 0, notes }), onSuccess: (r) => (toast.success(r.net > 0 ? `${r.number}: draft invoice made for the farmer` : `${r.number}: loss carried to the next cycle`), onChanged()), onError: (e) => toast.error(e) });
  const p = q.data;
  if (!p)
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  const rows: [string, number, string?][] = [
    [`Harvest ${fmtNumber(p.harvestKg, 1)} kg x ${fmtMoney(p.pricePerKg, 0)} (avg ${fmtNumber(p.avgWeightKg, 3)} kg)`, p.revenue],
    [`DOC ${fmtNumber(p.cycle.initialQty)} heads`, -p.docCharge],
    ...p.feed.map((x) => [`${x.name}: ${fmtNumber(x.kg, 1)} kg${x.price !== null ? ` x ${fmtMoney(x.price, 0)}` : ' (at cost)'}`, -x.amount] as [string, number]),
    ['Medicines and vaccines', -p.medicineCharge],
    [`FCR bonus (${fmtNumber(p.fcr, 3)} vs ${p.standardFcr ?? '-'}: ${p.fcrPoints} points)`, p.fcrBonus],
    [`IP bonus (IP ${p.ip})`, p.ipBonus],
    ['Deductions', -p.deductions],
    ['Loss carried from earlier cycles', -p.carriedIn],
  ].map(([l, v]) => [l, v || 0] as [string, number]);
  const print = () =>
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>RHPP ${esc(p.cycle.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Rekapitulasi Hasil Pemeliharaan Plasma (RHPP)</h1><div>Cycle <b>${esc(p.cycle.number)}</b> · contract ${esc(p.contract.number)} · farmer <b>${esc(p.contract.partner?.name)}</b></div>
<table><tbody><tr><td>Placed</td><td class="r">${fmtNumber(p.cycle.initialQty)}</td><td>Dead / culled</td><td class="r">${fmtNumber(p.cycle.mortality + p.cycle.culled)}</td></tr>
<tr><td>Harvested heads</td><td class="r">${fmtNumber(p.harvestQty)}</td><td>Harvested kg</td><td class="r">${fmtNumber(p.harvestKg, 1)}</td></tr>
<tr><td>Average weight</td><td class="r">${fmtNumber(p.avgWeightKg, 3)} kg</td><td>Average age</td><td class="r">${fmtNumber(p.avgAgeDays, 1)} d</td></tr>
<tr><td>FCR</td><td class="r">${fmtNumber(p.fcr, 3)}</td><td>IP</td><td class="r">${p.ip}</td></tr></tbody></table>
<table><thead><tr><th>Item</th><th class="r">Amount (Rp)</th></tr></thead><tbody>${rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="r">${esc(fmtMoney(v, 0))}</td></tr>`).join('')}
<tr class="b"><td>${p.net >= 0 ? 'Due to the farmer' : 'Loss carried to the next cycle'}</td><td class="r">${esc(fmtMoney(p.net, 0))}</td></tr></tbody></table>
${p.contract.withholdPph22 ? '<p class="muted">PPh 22 0.25% is collected on the harvest purchase (PMK 51/2025).</p>' : ''}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px;text-align:center"><div style="border-top:1px solid #333;padding-top:4px">Inti</div><div style="border-top:1px solid #333;padding-top:4px">Plasma</div></div>
</body></html>`);
  return (
    <Card title="Settlement (RHPP)" subtitle="Harvest at the contract price for its average weight, less the inputs supplied at contract prices, plus FCR / IP bonuses (Permentan 13/2017 partnership)" actions={<Button size="sm" variant="outline" icon="printer" onClick={print}>Print</Button>}>
      {c.settlement && (
        <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Settled: {c.settlement.number} · {fmtMoney(c.settlement.net, 0)}. Cancel it on the partnership contracts page to redo it.
        </p>
      )}
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([l, v]) => (
            <tr key={l}>
              <td className="py-1.5">{l}</td>
              <td className={v < 0 ? 'py-1.5 text-right text-red-700' : 'py-1.5 text-right'}>{fmtMoney(v, 0)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2">{p.net >= 0 ? 'Due to the farmer' : 'Loss carried to the next cycle'}</td>
            <td className="py-2 text-right">{fmtMoney(p.net, 0)}</td>
          </tr>
        </tbody>
      </table>
      {p.warnings.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!c.settlement && can('farm.settlement.manage') && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Other deductions">
            <NumberInput decimals={0} min={0} value={deductions} onChange={setDeductions} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="sm:col-span-3">
            <Button icon="check" loading={settle.isPending} disabled={p.warnings.length > 0} onClick={() => settle.mutate()}>
              Settle
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================ contracts
export function ContractsPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [edit, setEdit] = useState<ContractRow | 'new' | null>(null);
  const q = useQuery({ queryKey: ['farm', 'contracts'], queryFn: () => api.get<ContractRow[]>('/farm/contracts') });
  const s = useQuery({ queryKey: ['farm', 'settlements'], queryFn: () => api.get<{ id: string; number: string; date: string; status: string; cycleId: string; cycle: string; harvestKg: number; fcr: number; ip: number; revenue: number; net: number; invoice: { id: string; number: string; status: string } | null }[]>('/farm/settlements') });
  const cancel = async (id: string, number: string) => {
    if (!(await confirm({ title: `Cancel settlement ${number}?`, message: 'Its draft invoice is deleted and the cycle can be settled again.', danger: true, confirmText: 'Cancel settlement' }))) return;
    try {
      await api.post(`/farm/settlements/${id}/cancel`);
      toast.success('Cancelled');
      qc.invalidateQueries({ queryKey: ['farm'] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Partnership Contracts"
        subtitle="Inti-plasma agreements (Permentan 13/2017): input prices, harvest price by weight, bonuses. The written agreement is acknowledged by the regency / city livestock office"
        actions={
          can('farm.contract.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New contract
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {!q.data?.length ? (
          <EmptyState icon="handshake" title="No partnership contracts" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((k) => (
              <li key={k.id}>
                <button type="button" onClick={() => setEdit(k)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {k.number} · {k.partner?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {SPECIES[k.species]} · from {fmtDate(k.startDate)}
                      {k.endDate ? ` to ${fmtDate(k.endDate)}` : ''} · DOC {fmtMoney(k.docPrice, 0)} · {k.priceBands.map((b) => `${b.minKg}-${b.maxKg} kg ${fmtMoney(b.price, 0)}`).join(', ')}
                    </span>
                  </span>
                  {k.carryForward > 0 && <Badge tone="red">owes {fmtMoney(k.carryForward, 0)}</Badge>}
                  {!k.acknowledgedBy && <Badge tone="amber">not acknowledged</Badge>}
                  <Badge tone={k.status === 'ACTIVE' ? 'green' : 'gray'}>{k.status === 'ACTIVE' ? 'Active' : 'Ended'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Settlements (RHPP)" bodyClass="p-0">
        {!s.data?.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">No settlements yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {s.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {x.number} · <Link to={`/farm/cycles/${x.cycleId}`} className="text-brand-600">{x.cycle}</Link> · {fmtDate(x.date)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {fmtNumber(x.harvestKg, 1)} kg · FCR {fmtNumber(x.fcr, 3)} · IP {x.ip} · harvest value {fmtMoney(x.revenue, 0)}
                    {x.invoice ? ` · invoice ${x.invoice.number} (${x.invoice.status.toLowerCase()})` : ''}
                  </span>
                </span>
                <span className={x.net < 0 ? 'font-semibold text-red-700' : 'font-semibold'}>{fmtMoney(x.net, 0)}</span>
                {x.status === 'CANCELLED' ? (
                  <Badge tone="gray">Cancelled</Badge>
                ) : (
                  can('farm.settlement.manage') && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(x.id, x.number)}>
                      Cancel
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <ContractEditor k={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['farm'] }))} />}
    </div>
  );
}

function ContractEditor({ k, onClose, onSaved }: { k: ContractRow | null; onClose: () => void; onSaved: () => void }) {
  const can = useSession((s) => s.can);
  const editable = can('farm.contract.manage');
  const [f, setF] = useState({
    partnerId: k?.partnerId ?? (null as string | null),
    siteId: k?.siteId ?? (null as string | null),
    species: k?.species ?? 'BROILER',
    startDate: k?.startDate.slice(0, 10) ?? isoDate(),
    endDate: k?.endDate?.slice(0, 10) ?? '',
    docPrice: String(k?.docPrice ?? ''),
    medicineMarkupPct: String(k?.medicineMarkupPct ?? 0),
    standardFcr: k?.standardFcr === null || k?.standardFcr === undefined ? '' : String(k.standardFcr),
    fcrBonusPerPoint: String(k?.fcrBonusPerPoint ?? 0),
    ipThreshold: k?.ipThreshold === null || k?.ipThreshold === undefined ? '' : String(k.ipThreshold),
    ipBonusPerKg: String(k?.ipBonusPerKg ?? 0),
    withholdPph22: k?.withholdPph22 ?? false,
    terms: k?.terms ?? '',
    acknowledgedBy: k?.acknowledgedBy ?? '',
    acknowledgedAt: k?.acknowledgedAt?.slice(0, 10) ?? '',
    status: k?.status ?? 'ACTIVE',
  });
  const [bands, setBands] = useState((k?.priceBands ?? [{ minKg: 0, maxKg: 3, price: 0 }]).map((b) => ({ minKg: String(b.minKg), maxKg: String(b.maxKg), price: String(b.price) })));
  const [feeds, setFeeds] = useState((k?.feedPrices ?? []).map((x) => ({ productId: x.productId as string | null, name: x.name, price: String(x.price) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, endDate: f.endDate || null, acknowledgedAt: f.acknowledgedAt || null, priceBands: bands, feedPrices: feeds.filter((x) => x.productId).map((x) => ({ productId: x.productId, price: x.price || 0 })) };
      return k ? api.put(`/farm/contracts/${k.id}`, body) : api.post('/farm/contracts', body);
    },
    onSuccess: () => (toast.success('Contract saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const set = (key: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [key]: v }));
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={k ? `Contract ${k.number}` : 'New partnership contract'}
      footer={
        editable ? (
          <Button icon="check" loading={save.isPending} disabled={!f.partnerId} onClick={() => save.mutate()}>
            Save
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Plasma farmer" required error={errors.partnerId} help="Registered as a supplier">
          <AsyncSelect resource="suppliers" value={f.partnerId} initialLabel={k?.partner?.name} onChange={set('partnerId')} />
        </Field>
        <Field label="Farm" error={errors.siteId} help="Plasma farm of the farmer">
          <AsyncSelect resource="farm-sites" value={f.siteId} initialLabel={k?.site?.name} onChange={set('siteId')} />
        </Field>
        <Field label="Species">
          <Select value={f.species} onChange={(e) => set('species')(e.target.value)} options={Object.entries(SPECIES).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Start">
          <DatePicker value={f.startDate} onChange={(v) => set('startDate')(v ?? isoDate())} />
        </Field>
        <Field label="End" error={errors.endDate}>
          <DatePicker value={f.endDate} onChange={(v) => set('endDate')(v ?? '')} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status')(e.target.value)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ENDED', label: 'Ended' }]} />
        </Field>
        <Field label="DOC price per head">
          <NumberInput decimals={2} min={0} value={f.docPrice} onChange={set('docPrice')} />
        </Field>
        <Field label="Medicines: our cost + %">
          <NumberInput decimals={2} min={0} value={f.medicineMarkupPct} onChange={set('medicineMarkupPct')} />
        </Field>
        <div />
        <Field label="Standard FCR">
          <NumberInput decimals={3} min={0} value={f.standardFcr} onChange={set('standardFcr')} />
        </Field>
        <Field label="FCR bonus per 0.01 better (Rp / kg)">
          <NumberInput decimals={2} min={0} value={f.fcrBonusPerPoint} onChange={set('fcrBonusPerPoint')} />
        </Field>
        <div />
        <Field label="IP bonus from IP">
          <NumberInput decimals={0} min={0} value={f.ipThreshold} onChange={set('ipThreshold')} />
        </Field>
        <Field label="IP bonus (Rp / kg)">
          <NumberInput decimals={2} min={0} value={f.ipBonusPerKg} onChange={set('ipBonusPerKg')} />
        </Field>
        <div className="flex items-end pb-2">
          <Switch checked={f.withholdPph22} onChange={set('withholdPph22')} label="Collect PPh 22 0.25%" />
        </div>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Harvest price by average weight</span>
            {editable && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setBands([...bands, { minKg: '', maxKg: '', price: '' }])}>
                Range
              </Button>
            )}
          </div>
          {errors.priceBands && <p className="text-xs text-red-600">{errors.priceBands}</p>}
          <div className="space-y-2">
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <NumberInput decimals={3} min={0} value={b.minKg} aria-label="From kg" placeholder="from kg" onChange={(v) => setBands(bands.map((x, j) => (j === i ? { ...x, minKg: v } : x)))} />
                <NumberInput decimals={3} min={0} value={b.maxKg} aria-label="To kg" placeholder="to kg" onChange={(v) => setBands(bands.map((x, j) => (j === i ? { ...x, maxKg: v } : x)))} />
                <NumberInput decimals={2} min={0} value={b.price} aria-label="Price per kg" placeholder="Rp / kg" onChange={(v) => setBands(bands.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setBands(bands.filter((_, j) => j !== i))} />}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Feed prices (per kg)</span>
            {editable && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setFeeds([...feeds, { productId: null, name: '', price: '' }])}>
                Feed
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {feeds.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <AsyncSelect resource="products" value={x.productId} initialLabel={x.name} onChange={(v, o) => setFeeds(feeds.map((y, j) => (j === i ? { ...y, productId: v, name: o?.label ?? '' } : y)))} />
                </div>
                <div className="w-32">
                  <NumberInput decimals={2} min={0} value={x.price} aria-label="Price per kg" onChange={(v) => setFeeds(feeds.map((y, j) => (j === i ? { ...y, price: v } : y)))} />
                </div>
                {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setFeeds(feeds.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {!feeds.length && <p className="text-xs text-slate-500">Feed without a contract price is charged at our cost.</p>}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Acknowledged by (regency / city)" help="Art. 11 (3): the written agreement is known to the local government">
          <Input value={f.acknowledgedBy} maxLength={150} onChange={(e) => set('acknowledgedBy')(e.target.value)} />
        </Field>
        <Field label="Acknowledged on">
          <DatePicker value={f.acknowledgedAt} onChange={(v) => set('acknowledgedAt')(v ?? '')} />
        </Field>
        <Field label="Terms" className="sm:col-span-2" help="Art. 11 (2): livestock / inputs, rights and duties, quality standard, prices, market guarantee, sharing of profit and risk, financing, payment, period, disputes">
          <Textarea rows={4} maxLength={20000} value={f.terms} onChange={(e) => set('terms')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ partnership report
interface ReportRow {
  contract: string;
  partner: string;
  pattern: string;
  species: string;
  locations: string[];
  period: { start: string; end: string | null };
  acknowledgedBy: string | null;
  cyclesActive: number;
  cyclesClosed: number;
  placedHeads: number;
  harvestedHeads: number;
  harvestedKg: number;
  settledValue: number;
  paidToFarmer: number;
  avgFcr: number | null;
  avgIp: number | null;
  carryForward: number;
}

export function PartnershipReportPage() {
  const [sp, setSp] = useSearchParams();
  const now = new Date();
  const year = Number(sp.get('year')) || now.getFullYear();
  const quarter = Number(sp.get('quarter')) || Math.floor(now.getMonth() / 3) + 1;
  const q = useQuery({ queryKey: ['farm', 'report', year, quarter], queryFn: () => api.get<{ company: string; period: { from: string; to: string }; rows: ReportRow[] }>('/farm/partnership-report', { year, quarter }) });
  const r = q.data;
  const print = () =>
    r &&
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Laporan kemitraan ${year} Q${quarter}</title><style>${PRINT_CSS} @page { size: A4 landscape; }</style></head><body>
<h1>Laporan Pelaksanaan Kemitraan Usaha Peternakan</h1><div>${esc(r.company)} · ${esc(fmtDate(r.period.from))} - ${esc(fmtDate(r.period.to))}</div><div class="muted">Permentan 13/2017 Art. 19: business and partnership pattern, location and time, activity, value and volume, progress</div>
<table><thead><tr><th>Contract</th><th>Farmer</th><th>Pattern / business</th><th>Location</th><th>Period</th><th class="r">Placed</th><th class="r">Harvested heads</th><th class="r">Harvested kg</th><th class="r">Value (Rp)</th><th class="r">Paid to farmer</th><th>Progress</th></tr></thead><tbody>
${r.rows.map((x) => `<tr><td>${esc(x.contract)}</td><td>${esc(x.partner)}</td><td>${esc(x.pattern)} · ${esc(SPECIES[x.species])}</td><td>${esc(x.locations.join('; '))}</td><td>${esc(fmtDate(x.period.start))}${x.period.end ? ' - ' + esc(fmtDate(x.period.end)) : ''}</td><td class="r">${fmtNumber(x.placedHeads)}</td><td class="r">${fmtNumber(x.harvestedHeads)}</td><td class="r">${fmtNumber(x.harvestedKg, 1)}</td><td class="r">${fmtMoney(x.settledValue, 0)}</td><td class="r">${fmtMoney(x.paidToFarmer, 0)}</td><td>${x.cyclesActive} cycles, ${x.cyclesClosed} closed${x.avgFcr ? `, FCR ${fmtNumber(x.avgFcr, 3)}, IP ${x.avgIp}` : ''}</td></tr>`).join('')}
</tbody></table></body></html>`);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Partnership Report"
        subtitle="Quarterly report of the livestock partnerships to the regency / city livestock office (Permentan 13/2017 Art. 19, at least every 3 months)"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-28">
              <Select value={String(year)} onChange={(e) => setSp({ year: e.target.value, quarter: String(quarter) })} options={[0, 1, 2, 3, 4].map((i) => ({ value: String(now.getFullYear() - i), label: String(now.getFullYear() - i) }))} />
            </div>
            <div className="w-24">
              <Select value={String(quarter)} onChange={(e) => setSp({ year: String(year), quarter: e.target.value })} options={[1, 2, 3, 4].map((x) => ({ value: String(x), label: `Q${x}` }))} />
            </div>
            <Button variant="outline" icon="printer" disabled={!r?.rows.length} onClick={print}>
              Print
            </Button>
            <Button variant="outline" icon="download" disabled={!r?.rows.length} onClick={() => r && downloadCsv(`kemitraan-${year}-q${quarter}.csv`, [['Contract', 'Farmer', 'Pattern', 'Species', 'Location', 'Placed', 'Harvested heads', 'Harvested kg', 'Value', 'Paid to farmer', 'Cycles', 'Closed', 'FCR', 'IP', 'Owed by farmer'], ...r.rows.map((x) => [x.contract, x.partner, x.pattern, x.species, x.locations.join('; '), x.placedHeads, x.harvestedHeads, x.harvestedKg, x.settledValue, x.paidToFarmer, x.cyclesActive, x.cyclesClosed, x.avgFcr, x.avgIp, x.carryForward])])}>
              CSV
            </Button>
          </div>
        }
      />
      <Card bodyClass="p-0 overflow-x-auto">
        {q.isLoading || !r ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !r.rows.length ? (
          <EmptyState icon="handshake" title="No partnerships in this quarter" />
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Contract / farmer</th>
                <th className="px-2 py-2 text-left">Location</th>
                <th className="px-2 py-2 text-right">Placed</th>
                <th className="px-2 py-2 text-right">Harvested</th>
                <th className="px-2 py-2 text-right">Value</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2 text-left">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.rows.map((x) => (
                <tr key={x.contract}>
                  <td className="px-3 py-2">
                    {x.contract} · {x.partner}
                    <div className="text-xs text-slate-500">
                      {x.pattern} · {SPECIES[x.species]}
                      {x.acknowledgedBy ? ` · acknowledged by ${x.acknowledgedBy}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs">{x.locations.join('; ')}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(x.placedHeads)}</td>
                  <td className="px-2 py-2 text-right">
                    {fmtNumber(x.harvestedHeads)} · {fmtNumber(x.harvestedKg, 1)} kg
                  </td>
                  <td className="px-2 py-2 text-right">{fmtMoney(x.settledValue, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(x.paidToFarmer, 0)}</td>
                  <td className="px-2 py-2 text-xs">
                    {x.cyclesActive} cycles, {x.cyclesClosed} closed{x.avgFcr ? ` · FCR ${fmtNumber(x.avgFcr, 3)} · IP ${x.avgIp}` : ''}
                    {x.carryForward ? ` · owes ${fmtMoney(x.carryForward, 0)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
