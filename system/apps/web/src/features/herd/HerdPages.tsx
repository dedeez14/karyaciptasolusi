import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import {
  AsyncSelect,
  Badge,
  Button,
  Card,
  Checkbox,
  confirm,
  DatePicker,
  EmptyState,
  Field,
  Input,
  Modal,
  NumberInput,
  PageHeader,
  Select,
  Spinner,
  Switch,
  Tabs,
  Textarea,
  toast,
} from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv } from '@/features/compliance/common';

const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfMonth = () => isoDate().slice(0, 8) + '01';
const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86_400_000));
const SPECIES: Record<string, string> = { CATTLE: 'Cattle', BUFFALO: 'Buffalo', GOAT: 'Goat', SHEEP: 'Sheep' };
const PURPOSE: Record<string, { label: string; tone: Tone }> = {
  DAIRY: { label: 'Dairy', tone: 'blue' },
  BREEDING: { label: 'Breeding', tone: 'violet' },
  FATTENING: { label: 'Fattening', tone: 'amber' },
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'In the herd', tone: 'green' },
  SOLD: { label: 'Sold', tone: 'gray' },
  CULLED: { label: 'Culled', tone: 'gray' },
  DEAD: { label: 'Dead', tone: 'red' },
};
const REPRO: Record<string, { label: string; tone: Tone }> = { OPEN: { label: 'Open', tone: 'gray' }, SERVED: { label: 'Served', tone: 'amber' }, PREGNANT: { label: 'Pregnant', tone: 'green' } };
const EVENT: Record<string, string> = {
  HEAT: 'Heat',
  SERVICE: 'Service',
  PREG_CHECK: 'Pregnancy check',
  CALVING: 'Calving',
  ABORTION: 'Abortion',
  DRY_OFF: 'Dry off',
  MOVE: 'Moved',
  PRODUCTIVE: 'Productive',
  NOTE: 'Note',
};
/** SNI 3141:2024 raw cow milk (minimum / maximum) */
const SNI_MILK = { fat: 3.0, snf: 7.8, ts: 10.8, protein: 2.8, density: 1.027, tpc: 1_000_000 };

interface Unit {
  id: string;
  code: string;
  name: string;
  siteId: string;
  kind: string;
  capacity: number;
  heads: number;
}
interface Lists {
  sites: { id: string; code: string; name: string }[];
  units: Unit[];
  settings: { gestationDays: number; dryOffDays: number; waitingDays: number; pregCheckDays: number; lifeMonths: number; salvagePct: number };
}
const useLists = () => useQuery({ queryKey: ['herd', 'lists'], queryFn: () => api.get<Lists>('/herd/lists'), staleTime: 30_000 });

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
function Dt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

// ============================================================ overview and breeding board
interface Overview {
  settings: Lists['settings'];
  counts: { total: number; byPurpose: Record<string, number>; lactating: number; dry: number; pregnant: number; served: number; open: number; heifers: number; underWithdrawal: number };
  repro: { services: number; conceptions: number; servicesPerConception: number | null; firstServiceConceptionPct: number | null; calvingIntervalDays: number | null; daysOpen: number | null };
  milk: { days: { date: string; produced: number; discarded: number; cows: number; perCow: number | null; delivered: number }[]; avgPerCow: number | null };
  fattening: { heads: number; avgAdg: number | null };
  alerts: { kind: string; animalId: string; tagNo: string; date: string | null; text: string }[];
}
const ALERT: Record<string, { label: string; tone: Tone }> = {
  SERVE: { label: 'Heat watch', tone: 'violet' },
  PREG_CHECK: { label: 'Pregnancy check', tone: 'blue' },
  DRY_OFF: { label: 'Dry off', tone: 'amber' },
  CALVING: { label: 'Calving due', tone: 'green' },
  WITHDRAWAL: { label: 'Withdrawal', tone: 'red' },
  WEIGH: { label: 'Weigh', tone: 'gray' },
};

export function HerdOverviewPage() {
  const q = useQuery({ queryKey: ['herd', 'overview'], queryFn: () => api.get<Overview>('/herd/overview') });
  const [kind, setKind] = useState('');
  const o = q.data;
  if (q.isLoading || !o) return <Loading />;
  const alerts = o.alerts.filter((a) => !kind || a.kind === kind);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Herd & Breeding Board"
        subtitle="The herd today, reproduction performance and what needs doing: heat watch, pregnancy checks, dry-off, calvings, drug withdrawals, weighings"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Animals"
          value={fmtNumber(o.counts.total)}
          hint={`dairy ${o.counts.byPurpose.DAIRY ?? 0} · breeding ${o.counts.byPurpose.BREEDING ?? 0} · fattening ${o.counts.byPurpose.FATTENING ?? 0}`}
        />
        <Stat label="Cows in milk" value={fmtNumber(o.counts.lactating)} hint={`dry ${o.counts.dry} · heifers ${o.counts.heifers}`} />
        <Stat label="Pregnant" value={fmtNumber(o.counts.pregnant)} hint={`served ${o.counts.served} · open ${o.counts.open}`} />
        <Stat label="Milk per cow per day" value={o.milk.avgPerCow !== null ? `${num(o.milk.avgPerCow, 1)} l` : '-'} hint="last 7 days" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Services per conception" value={num(o.repro.servicesPerConception)} hint="target 1.6 - 2.0 (2 years)" />
        <Stat label="First-service conception" value={o.repro.firstServiceConceptionPct !== null ? `${o.repro.firstServiceConceptionPct}%` : '-'} hint="target 60% or more" />
        <Stat label="Calving interval" value={o.repro.calvingIntervalDays !== null ? `${o.repro.calvingIntervalDays} days` : '-'} hint={`target 365 - 395 · days open ${o.repro.daysOpen ?? '-'}`} />
        <Stat label="Feedlot daily gain" value={o.fattening.avgAdg !== null ? `${num(o.fattening.avgAdg, 2)} kg` : '-'} hint={`${o.fattening.heads} head fattening`} />
      </div>
      <Card
        title="To do"
        subtitle={`Waiting period ${o.settings.waitingDays} days after calving, pregnancy check ${o.settings.pregCheckDays} days after service, dry-off ${o.settings.dryOffDays} days before calving (Settings > Agriculture)`}
        actions={
          <div className="w-44">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} placeholder="All" options={Object.entries(ALERT).map(([value, a]) => ({ value, label: a.label }))} />
          </div>
        }
        bodyClass="p-0"
      >
        {!alerts.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">Nothing due.</p>
        ) : (
          <ul className="divide-y divide-line">
            {alerts.map((a, i) => (
              <li key={i}>
                <Link to={`/herd/animals/${a.animalId}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <span className="w-24 font-medium text-brand-600">{a.tagNo}</span>
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <Badge tone={ALERT[a.kind].tone}>{ALERT[a.kind].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {o.milk.days.length > 0 && (
        <Card title="Milk, last days" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Day</th>
                  <th className="px-2 py-2 text-right">Cows milked</th>
                  <th className="px-2 py-2 text-right">Litres</th>
                  <th className="px-2 py-2 text-right">Per cow</th>
                  <th className="px-2 py-2 text-right">Thrown away</th>
                  <th className="px-4 py-2 text-right">Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {o.milk.days.map((d) => (
                  <tr key={d.date}>
                    <td className="px-4 py-2">{fmtDate(d.date)}</td>
                    <td className="px-2 py-2 text-right">{d.cows}</td>
                    <td className="px-2 py-2 text-right">{num(d.produced, 1)}</td>
                    <td className="px-2 py-2 text-right">{num(d.perCow, 1)}</td>
                    <td className="px-2 py-2 text-right">{d.discarded ? num(d.discarded, 1) : '-'}</td>
                    <td className="px-4 py-2 text-right">{d.delivered ? num(d.delivered, 1) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================ animals
interface AnimalRow {
  id: string;
  tagNo: string;
  name: string | null;
  species: string;
  breed: string | null;
  sex: string;
  purpose: string;
  status: string;
  ageMonths: number | null;
  unit: { id: string; code: string; name: string } | null;
  reproStatus: string;
  lactating: boolean;
  lactationNo: number;
  daysInMilk: number | null;
  expectedCalving: string | null;
  lastWeightKg: number | null;
  lastWeighDate: string | null;
  adg: number | null;
  carryingCost: number;
  productive: boolean;
  withdrawal: { milk: string | null; meat: string | null } | null;
}

export function AnimalsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lists = useLists();
  const [f, setF] = useState({ status: 'ACTIVE', purpose: '', unitId: '', repro: '', search: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [modal, setModal] = useState<'' | 'register' | 'weigh' | 'treat' | 'exit'>('');
  const q = useQuery({ queryKey: ['herd', 'animals', f], queryFn: () => api.get<AnimalRow[]>('/herd/animals', { ...f, status: f.status || 'ALL' }) });
  const rows = q.data ?? [];
  const chosen = rows.filter((r) => sel.includes(r.id));
  const done = () => (setModal(''), setSel([]), qc.invalidateQueries({ queryKey: ['herd'] }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Animals"
        subtitle="Every animal by its ear tag: pen, reproduction, milk, weight gain and the cost it carries"
        actions={
          can('herd.animal.manage') && (
            <Button icon="plus" onClick={() => setModal('register')}>
              Register animals
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <Input value={f.search} placeholder="Tag, name, ID" onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search" />
        </div>
        <div className="w-36">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        </div>
        <div className="w-36">
          <Select
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
            placeholder="All purposes"
            options={Object.entries(PURPOSE).map(([value, p]) => ({ value, label: p.label }))}
          />
        </div>
        <div className="w-44">
          <Select
            value={f.unitId}
            onChange={(e) => setF({ ...f, unitId: e.target.value })}
            placeholder="All pens"
            options={(lists.data?.units ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.heads})` }))}
          />
        </div>
        <div className="w-36">
          <Select
            value={f.repro}
            onChange={(e) => setF({ ...f, repro: e.target.value })}
            placeholder="Any state"
            options={[{ value: 'LACTATING', label: 'In milk' }, { value: 'DRY', label: 'Dry' }, ...Object.entries(REPRO).map(([value, r]) => ({ value, label: r.label }))]}
          />
        </div>
        {sel.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-2">
            <span className="self-center text-sm text-slate-500">{sel.length} selected</span>
            {can('herd.record') && (
              <>
                <Button size="sm" variant="outline" icon="scale" onClick={() => setModal('weigh')}>
                  Weigh
                </Button>
                <Button size="sm" variant="outline" icon="syringe" onClick={() => setModal('treat')}>
                  Treat
                </Button>
              </>
            )}
            {can('herd.exit') && (
              <Button size="sm" variant="outline" icon="log-out" onClick={() => setModal('exit')}>
                Sell / cull / death
              </Button>
            )}
          </div>
        )}
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="tag" title="No animals" description="Set up the farm and its pens (Farm > Farms, Houses & Ponds), then register the animals" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      checked={sel.length === rows.filter((r) => r.status === 'ACTIVE').length && sel.length > 0}
                      onChange={(v) => setSel(v ? rows.filter((r) => r.status === 'ACTIVE').map((r) => r.id) : [])}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-2 py-2 text-left">Tag</th>
                  <th className="px-2 py-2 text-left">Animal</th>
                  <th className="px-2 py-2 text-left">Pen</th>
                  <th className="px-2 py-2 text-right">Age</th>
                  <th className="px-2 py-2 text-left">State</th>
                  <th className="px-2 py-2 text-right">Weight</th>
                  <th className="px-2 py-2 text-right">ADG</th>
                  <th className="px-4 py-2 text-right">Cost carried</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className={`hover:bg-slate-50 ${a.status !== 'ACTIVE' ? 'text-slate-400' : ''}`}>
                    <td className="px-3 py-2">
                      {a.status === 'ACTIVE' && <Checkbox checked={sel.includes(a.id)} onChange={(v) => setSel(v ? [...sel, a.id] : sel.filter((x) => x !== a.id))} aria-label={`Select ${a.tagNo}`} />}
                    </td>
                    <td className="cursor-pointer px-2 py-2" onClick={() => navigate(`/herd/animals/${a.id}`)}>
                      <Link to={`/herd/animals/${a.id}`} className="font-medium text-brand-600">
                        {a.tagNo}
                      </Link>
                      {a.name && <span className="block text-xs text-slate-500">{a.name}</span>}
                    </td>
                    <td className="px-2 py-2">
                      {a.breed ?? SPECIES[a.species]} · {a.sex === 'F' ? 'female' : 'male'}
                      <span className="ml-1">
                        <Badge tone={PURPOSE[a.purpose].tone}>{PURPOSE[a.purpose].label}</Badge>
                      </span>
                    </td>
                    <td className="px-2 py-2">{a.unit?.name ?? '-'}</td>
                    <td className="px-2 py-2 text-right">{a.ageMonths !== null ? `${a.ageMonths} mo` : '-'}</td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap gap-1">
                        {a.status !== 'ACTIVE' && <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>}
                        {a.lactating && <Badge tone="blue">In milk{a.daysInMilk !== null ? ` · ${a.daysInMilk} d` : ''}</Badge>}
                        {a.sex === 'F' && a.purpose !== 'FATTENING' && a.status === 'ACTIVE' && (a.lactationNo > 0 || a.reproStatus !== 'OPEN') && (
                          <Badge tone={REPRO[a.reproStatus].tone}>{REPRO[a.reproStatus].label}</Badge>
                        )}
                        {a.withdrawal && <Badge tone="red">Withdrawal</Badge>}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">{a.lastWeightKg !== null ? `${num(a.lastWeightKg, 0)} kg` : '-'}</td>
                    <td className="px-2 py-2 text-right">{a.adg !== null ? num(a.adg, 2) : '-'}</td>
                    <td className="px-4 py-2 text-right">{a.productive ? <span className="text-xs text-slate-500">fixed asset</span> : fmtMoney(a.carryingCost, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal === 'register' && <RegisterModal onClose={() => setModal('')} onDone={done} />}
      {modal === 'weigh' && <WeighModal animals={chosen} onClose={() => setModal('')} onDone={done} />}
      {modal === 'treat' && <TreatModal animals={chosen} onClose={() => setModal('')} onDone={done} />}
      {modal === 'exit' && <ExitModal animals={chosen} onClose={() => setModal('')} onDone={done} />}
    </div>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const lists = useLists();
  const [f, setF] = useState({
    tags: '',
    species: 'CATTLE',
    breed: '',
    sex: 'F',
    purpose: 'DAIRY',
    birthDate: '',
    origin: 'PURCHASED',
    acquisitionDate: isoDate(),
    costPerHead: '',
    weightKg: '',
    supplierId: null as string | null,
    siteId: '',
    unitId: '',
    sire: '',
    notes: '',
    lactationNo: '',
    lastCalving: '',
    lactating: false,
    lastService: '',
    pregnant: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!f.siteId && lists.data?.sites.length === 1) setF((x) => ({ ...x, siteId: lists.data!.sites[0].id }));
  }, [lists.data, f.siteId]);
  const tags = f.tags
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.post<{ count: number }>('/herd/animals', {
        ...f,
        tags,
        birthDate: f.birthDate || null,
        costPerHead: f.costPerHead || 0,
        weightKg: f.weightKg || null,
        unitId: f.unitId || null,
        lactationNo: f.lactationNo || 0,
        lastCalving: f.lastCalving || null,
        lastService: f.lastService || null,
      }),
    onSuccess: (r) => (toast.success(`${r.count} animals registered`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const opening = f.origin === 'OPENING';
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="Register animals"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!tags.length || !f.siteId} onClick={() => save.mutate()}>
          Register {tags.length || ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Ear tags"
          required
          className="lg:col-span-3"
          error={errors.tags}
          help={`${tags.length} tags. One per line (or separated by commas); animals registered together share the details below`}
        >
          <Textarea rows={3} className="font-mono text-xs" value={f.tags} placeholder={'BC-0101\nBC-0102'} onChange={(e) => set('tags')(e.target.value.toUpperCase())} />
        </Field>
        <Field label="How they came">
          <Select
            value={f.origin}
            onChange={(e) => set('origin')(e.target.value)}
            options={[
              { value: 'PURCHASED', label: 'Bought' },
              { value: 'OPENING', label: 'In the herd at go-live' },
              { value: 'BORN', label: 'Born here (without the dam record)' },
            ]}
          />
        </Field>
        <Field label="Species">
          <Select value={f.species} onChange={(e) => set('species')(e.target.value)} options={Object.entries(SPECIES).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Breed">
          <Input value={f.breed} maxLength={80} placeholder="FH, Brahman Cross, Bali, PO, Limousin..." onChange={(e) => set('breed')(e.target.value)} />
        </Field>
        <Field label="Sex">
          <Select
            value={f.sex}
            onChange={(e) => set('sex')(e.target.value)}
            options={[
              { value: 'F', label: 'Female' },
              { value: 'M', label: 'Male' },
            ]}
          />
        </Field>
        <Field label="Purpose">
          <Select value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} options={Object.entries(PURPOSE).map(([value, p]) => ({ value, label: p.label }))} />
        </Field>
        <Field label="Birth date (or estimate)">
          <DatePicker value={f.birthDate} max={isoDate()} onChange={(v) => set('birthDate')(v ?? '')} />
        </Field>
        <Field label="Farm" required error={errors.siteId}>
          <Select
            value={f.siteId}
            onChange={(e) => setF({ ...f, siteId: e.target.value, unitId: '' })}
            placeholder="Choose"
            options={(lists.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <Field label="Pen" error={errors.unitId}>
          <Select
            value={f.unitId}
            onChange={(e) => set('unitId')(e.target.value)}
            placeholder="-"
            options={(lists.data?.units ?? []).filter((u) => u.siteId === f.siteId).map((u) => ({ value: u.id, label: `${u.name} (${u.heads})` }))}
          />
        </Field>
        <Field label={opening ? 'Go-live date' : f.origin === 'BORN' ? 'Born on' : 'Arrival date'} required error={errors.acquisitionDate}>
          <DatePicker value={f.acquisitionDate} max={isoDate()} clearable={false} onChange={(v) => set('acquisitionDate')(v ?? isoDate())} />
        </Field>
        {f.origin !== 'BORN' && (
          <Field
            label={opening ? 'Value per head' : 'Price per head'}
            help={opening ? 'Carried value at go-live (against opening balance equity)' : 'Biological asset against goods received; a draft supplier invoice is made'}
            error={errors.costPerHead}
          >
            <NumberInput decimals={0} min={0} value={f.costPerHead} onChange={set('costPerHead')} />
          </Field>
        )}
        {f.origin === 'PURCHASED' && (
          <Field label="Supplier" error={errors.supplierId}>
            <AsyncSelect resource="suppliers" value={f.supplierId} onChange={set('supplierId')} />
          </Field>
        )}
        <Field label="Weight at arrival (kg)">
          <NumberInput decimals={1} min={0} value={f.weightKg} onChange={set('weightKg')} />
        </Field>
        <Field label="Sire (bull / semen code)">
          <Input value={f.sire} maxLength={60} onChange={(e) => set('sire')(e.target.value)} />
        </Field>
        {opening && f.sex === 'F' && f.purpose !== 'FATTENING' && (
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-3 lg:col-span-3">
            <p className="text-xs text-slate-500 sm:col-span-3">History before go-live: a cow that has calved becomes productive livestock (fixed asset) at the go-live date.</p>
            <Field label="Lactations so far" error={errors.lactationNo}>
              <NumberInput decimals={0} min={0} max={20} value={f.lactationNo} onChange={set('lactationNo')} />
            </Field>
            <Field label="Last calving" error={errors.lastCalving}>
              <DatePicker value={f.lastCalving} max={f.acquisitionDate} onChange={(v) => set('lastCalving')(v ?? '')} />
            </Field>
            <div className="flex items-end pb-2">
              <Switch checked={f.lactating} onChange={set('lactating')} label="In milk now" />
            </div>
            <Field label="Last service" error={errors.lastService}>
              <DatePicker value={f.lastService} max={f.acquisitionDate} onChange={(v) => set('lastService')(v ?? '')} />
            </Field>
            <div className="flex items-end pb-2">
              <Switch checked={f.pregnant} onChange={set('pregnant')} label="Confirmed pregnant" />
            </div>
          </div>
        )}
        <Field label="Notes" className="lg:col-span-3">
          <Textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function WeighModal({ animals, onClose, onDone }: { animals: { id: string; tagNo: string; lastWeightKg: number | null }[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(isoDate());
  const [kg, setKg] = useState<Record<string, string>>({});
  const [bcs, setBcs] = useState<Record<string, string>>({});
  const rows = animals.filter((a) => Number(kg[a.id]) > 0);
  const save = useMutation({
    mutationFn: () => api.post('/herd/weighings', { date, rows: rows.map((a) => ({ animalId: a.id, kg: kg[a.id], bcs: bcs[a.id] || null })) }),
    onSuccess: () => (toast.success(`${rows.length} weighings recorded`), onDone()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Weigh ${animals.length} animals`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!rows.length} onClick={() => save.mutate()}>
          Save {rows.length}
        </Button>
      }
    >
      <Field label="Date">
        <DatePicker value={date} max={isoDate()} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
      </Field>
      <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
        {animals.map((a) => (
          <div key={a.id} className="grid grid-cols-[1fr_8rem_5rem] items-center gap-2 text-sm">
            <span>
              {a.tagNo} <span className="text-xs text-slate-500">{a.lastWeightKg ? `last ${num(a.lastWeightKg, 0)} kg` : ''}</span>
            </span>
            <NumberInput decimals={1} min={0} max={3000} value={kg[a.id] ?? ''} placeholder="kg" onChange={(v) => setKg({ ...kg, [a.id]: v })} aria-label={`${a.tagNo} kg`} />
            <NumberInput decimals={1} min={1} max={5} value={bcs[a.id] ?? ''} placeholder="BCS" onChange={(v) => setBcs({ ...bcs, [a.id]: v })} aria-label={`${a.tagNo} body condition score`} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function TreatModal({ animals, onClose, onDone }: { animals: { id: string; tagNo: string }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    date: isoDate(),
    kind: 'VACCINE',
    description: '',
    diagnosis: '',
    productId: null as string | null,
    warehouseId: null as string | null,
    qtyPerHead: '',
    milkWithdrawalDays: '',
    meatWithdrawalDays: '',
    vet: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.post('/herd/treatments', {
        ...f,
        animalIds: animals.map((a) => a.id),
        qtyPerHead: f.qtyPerHead || 0,
        milkWithdrawalDays: f.milkWithdrawalDays || 0,
        meatWithdrawalDays: f.meatWithdrawalDays || 0,
      }),
    onSuccess: () => (toast.success(`${animals.length} animals treated`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Treat ${animals.length === 1 ? animals[0].tagNo : `${animals.length} animals`}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.description.trim()} onClick={() => save.mutate()}>
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        <Field label="Kind">
          <Select
            value={f.kind}
            onChange={(e) => set('kind')(e.target.value)}
            options={[
              { value: 'VACCINE', label: 'Vaccination' },
              { value: 'MEDICINE', label: 'Medicine' },
              { value: 'VITAMIN', label: 'Vitamin / mineral' },
              { value: 'DEWORMING', label: 'Deworming' },
              { value: 'OTHER', label: 'Other' },
            ]}
          />
        </Field>
        <Field label="What was given" required error={errors.description}>
          <Input value={f.description} maxLength={200} placeholder="Vaksin PMK dosis 2, Oxytetracycline 10 ml..." onChange={(e) => set('description')(e.target.value)} />
        </Field>
        <Field label="Disease / diagnosis">
          <Input value={f.diagnosis} maxLength={150} placeholder="PMK, LSD, mastitis, bloat..." onChange={(e) => set('diagnosis')(e.target.value)} />
        </Field>
        <Field label="Product from stock" error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} onChange={set('productId')} />
        </Field>
        <Field label="Store" error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={set('warehouseId')} />
        </Field>
        <Field label="Quantity per head" error={errors.qtyPerHead}>
          <NumberInput decimals={3} min={0} value={f.qtyPerHead} onChange={set('qtyPerHead')} />
        </Field>
        <Field label="Vet / technician">
          <Input value={f.vet} maxLength={100} onChange={(e) => set('vet')(e.target.value)} />
        </Field>
        <Field label="Milk withdrawal (days)" help="From the drug label: milk is thrown away until then">
          <NumberInput decimals={0} min={0} max={365} value={f.milkWithdrawalDays} onChange={set('milkWithdrawalDays')} />
        </Field>
        <Field label="Meat withdrawal (days)" help="No sale / slaughter until then">
          <NumberInput decimals={0} min={0} max={365} value={f.meatWithdrawalDays} onChange={set('meatWithdrawalDays')} />
        </Field>
      </div>
    </Modal>
  );
}

function ExitModal({
  animals,
  onClose,
  onDone,
}: {
  animals: { id: string; tagNo: string; lastWeightKg: number | null; withdrawal?: { meat: string | null } | null }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const [f, setF] = useState({ type: 'SALE', date: isoDate(), reason: '', customerId: null as string | null, priceBy: 'kg', price: '', overrideWithdrawal: '' });
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(animals.map((a) => [a.id, a.lastWeightKg ? String(a.lastWeightKg) : ''])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const blocked = animals.filter((a) => a.withdrawal?.meat && a.withdrawal.meat >= f.date);
  const total = f.type === 'DEATH' || !f.price ? 0 : f.priceBy === 'kg' ? animals.reduce((s, a) => s + Number(w[a.id] || 0) * Number(f.price), 0) : animals.length * Number(f.price);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ count: number; invoice: { id: string; number: string } | null }>('/herd/exits', {
        animalIds: animals.map((a) => a.id),
        type: f.type,
        date: f.date,
        reason: f.reason || null,
        customerId: f.type === 'DEATH' ? null : f.customerId,
        pricePerKg: f.priceBy === 'kg' ? f.price || null : null,
        pricePerHead: f.priceBy === 'head' ? f.price || null : null,
        weights: Object.fromEntries(Object.entries(w).filter(([, v]) => Number(v) > 0)),
        overrideWithdrawal: f.overrideWithdrawal || null,
      }),
    onSuccess: (r) => {
      toast.success(r.invoice ? `${r.count} animals out; draft invoice ${r.invoice.number}` : `${r.count} animals out of the herd`);
      onDone();
      if (r.invoice) navigate(`/documents/SI/${r.invoice.id}`);
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`${animals.length === 1 ? animals[0].tagNo : `${animals.length} animals`} leave the herd`}
      footer={
        <Button
          icon="check"
          variant={f.type === 'DEATH' ? 'danger' : 'primary'}
          loading={save.isPending}
          onClick={async () => (await confirm({ title: 'Record the exit?', message: 'The cost they carry (or the book value of productive animals) leaves the books.' })) && save.mutate()}
        >
          Record {total ? fmtMoney(total, 0) : ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="What happened">
          <Select
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value })}
            options={[
              { value: 'SALE', label: 'Sold' },
              { value: 'CULL', label: 'Culled (sold for slaughter)' },
              { value: 'DEATH', label: 'Died' },
            ]}
          />
        </Field>
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        {f.type !== 'DEATH' && (
          <>
            <Field label="Buyer" help="Empty: no invoice" error={errors.customerId}>
              <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Price by">
                <Select
                  value={f.priceBy}
                  onChange={(e) => setF({ ...f, priceBy: e.target.value })}
                  options={[
                    { value: 'kg', label: 'kg live weight' },
                    { value: 'head', label: 'head' },
                  ]}
                />
              </Field>
              <Field label="Price" error={errors.pricePerKg}>
                <NumberInput decimals={0} min={0} value={f.price} onChange={(v) => setF({ ...f, price: v })} />
              </Field>
            </div>
          </>
        )}
        <Field label={f.type === 'DEATH' ? 'Cause' : 'Reason / notes'} className="sm:col-span-2">
          <Input value={f.reason} maxLength={150} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        {f.type !== 'DEATH' && (
          <div className="max-h-56 space-y-2 overflow-y-auto sm:col-span-2">
            {animals.map((a) => (
              <div key={a.id} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
                <span>{a.tagNo}</span>
                <NumberInput decimals={1} min={0} value={w[a.id] ?? ''} placeholder="kg" onChange={(v) => setW({ ...w, [a.id]: v })} aria-label={`${a.tagNo} live weight`} />
              </div>
            ))}
          </div>
        )}
        {f.type !== 'DEATH' && blocked.length > 0 && (
          <Field
            label={`Drug withdrawal: ${blocked.map((a) => a.tagNo).join(', ')}`}
            className="sm:col-span-2"
            error={errors.overrideWithdrawal}
            help="Meat of treated animals may not be sold before the withdrawal ends; give a reason to go ahead (e.g. not for slaughter)"
          >
            <Input value={f.overrideWithdrawal} maxLength={200} onChange={(e) => setF({ ...f, overrideWithdrawal: e.target.value })} />
          </Field>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Live animals are exempt from PPN (PP 49/2022). Moving them needs the SKKH; across a regency / province also the Sertifikat Veteriner (Permentan 17/2023).
      </p>
    </Modal>
  );
}

// ============================================================ one animal
interface AnimalDetail {
  id: string;
  tagNo: string;
  nationalId: string | null;
  name: string | null;
  species: string;
  breed: string | null;
  sex: string;
  purpose: string;
  birthDate: string | null;
  birthWeightKg: number | null;
  origin: string;
  sire: string | null;
  status: string;
  reproStatus: string;
  lactating: boolean;
  lactationNo: number;
  lastCalving: string | null;
  lastService: string | null;
  servicesSinceCalving: number;
  expectedCalving: string | null;
  dryOffDate: string | null;
  lastWeightKg: number | null;
  milkWithdrawalUntil: string | null;
  meatWithdrawalUntil: string | null;
  acquisitionDate: string;
  acquisitionCost: number;
  carryingCost: number;
  productiveDate: string | null;
  exitDate: string | null;
  exitReason: string | null;
  exitWeightKg: number | null;
  exitValue: number | null;
  exitCost: number | null;
  saleDocId: string | null;
  notes: string | null;
  ageMonths: number | null;
  daysInMilk: number | null;
  site: { name: string } | null;
  unit: { id: string; name: string } | null;
  supplier: { name: string } | null;
  customer: { name: string } | null;
  dam: { id: string; tagNo: string } | null;
  calves: { id: string; tagNo: string; sex: string; birthDate: string | null; status: string }[];
  asset: { id: string; code: string; cost: number; salvageValue: number; accumulatedDepreciation: number; usefulLifeMonths: number; statusCode: string } | null;
  weights: { id: string; date: string; kg: number; bcs: number | null }[];
  adgLast: number | null;
  adgTotal: number | null;
  events: {
    id: string;
    date: string;
    type: string;
    method: string | null;
    sire: string | null;
    technician: string | null;
    result: string | null;
    fromUnit: string | null;
    toUnit: string | null;
    notes: string | null;
  }[];
  treatments: {
    id: string;
    date: string;
    kind: string;
    description: string;
    diagnosis: string | null;
    qty: number;
    cost: number;
    milkWithdrawalDays: number;
    meatWithdrawalDays: number;
    vet: string | null;
  }[];
  costs: { kind: string; capitalised: boolean; amount: number }[];
  milk: { date: string; am: number; pm: number; total: number; discarded: boolean }[];
}

export function AnimalPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [tab, setTab] = useState<'events' | 'weights' | 'health' | 'milk' | 'cost'>('events');
  const [modal, setModal] = useState<'' | 'event' | 'weigh' | 'treat' | 'exit' | 'edit' | 'productive'>('');
  const q = useQuery({ queryKey: ['herd', 'animal', id], queryFn: () => api.get<AnimalDetail>(`/herd/animals/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['herd'] }));
  const delEvent = useMutation({
    mutationFn: (eid: string) => api.delete(`/herd/animals/${id}/events/${eid}`),
    onSuccess: () => (toast.success('Event removed'), refresh()),
    onError: (e) => toast.error(e),
  });
  const delWeight = useMutation({
    mutationFn: (wid: string) => api.delete(`/herd/animals/${id}/weights/${wid}`),
    onSuccess: () => (toast.success('Weighing removed'), refresh()),
    onError: (e) => toast.error(e),
  });
  const cancelExit = useMutation({ mutationFn: () => api.post(`/herd/animals/${id}/cancel-exit`), onSuccess: () => (toast.success('Back in the herd'), refresh()), onError: (e) => toast.error(e) });
  const a = q.data;
  if (q.isLoading || !a) return <Loading />;
  const active = a.status === 'ACTIVE';
  const female = a.sex === 'F';
  const lastEvent = a.events.find((e) => e.type !== 'PRODUCTIVE');
  const costSum = (cap: boolean) => a.costs.filter((c) => c.capitalised === cap).reduce((s, c) => s + c.amount, 0);
  const today = isoDate();
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/herd/animals')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.tagNo}
            {a.name ? ` · ${a.name}` : ''} <Badge tone={PURPOSE[a.purpose].tone}>{PURPOSE[a.purpose].label}</Badge>
            <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
            {a.lactating && <Badge tone="blue">In milk</Badge>}
          </span>
        }
        subtitle={`${a.breed ?? SPECIES[a.species]} ${female ? 'female' : 'male'}${a.ageMonths !== null ? ` · ${a.ageMonths} months` : ''} · ${a.site?.name ?? ''}${a.unit ? ` / ${a.unit.name}` : ''}`}
        actions={
          active ? (
            <>
              {can('herd.record') && (
                <>
                  <Button icon="calendar-plus" onClick={() => setModal('event')}>
                    Record event
                  </Button>
                  <Button variant="outline" icon="scale" onClick={() => setModal('weigh')}>
                    Weigh
                  </Button>
                  <Button variant="outline" icon="syringe" onClick={() => setModal('treat')}>
                    Treat
                  </Button>
                </>
              )}
              {can('herd.animal.manage') && (
                <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                  Edit
                </Button>
              )}
              {can('herd.animal.manage') && !a.asset && a.purpose !== 'FATTENING' && !a.productiveDate && (
                <Button variant="outline" icon="badge-check" onClick={() => setModal('productive')}>
                  Put into production
                </Button>
              )}
              {can('herd.exit') && (
                <Button variant="ghost" icon="log-out" onClick={() => setModal('exit')}>
                  Exit
                </Button>
              )}
            </>
          ) : (
            can('herd.exit') && (
              <Button
                variant="outline"
                icon="undo-2"
                loading={cancelExit.isPending}
                onClick={async () => (await confirm({ title: `Bring ${a.tagNo} back into the herd?`, message: 'Only possible while its sales invoice is a draft or deleted.' })) && cancelExit.mutate()}
              >
                Cancel exit
              </Button>
            )
          )
        }
      />
      {(a.milkWithdrawalUntil && a.milkWithdrawalUntil >= today) || (a.meatWithdrawalUntil && a.meatWithdrawalUntil >= today) ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Drug withdrawal:{a.milkWithdrawalUntil && a.milkWithdrawalUntil >= today ? ` milk thrown away until ${fmtDate(a.milkWithdrawalUntil)}` : ''}
          {a.meatWithdrawalUntil && a.meatWithdrawalUntil >= today ? ` · no sale for slaughter until ${fmtDate(a.meatWithdrawalUntil)}` : ''}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Identity">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label="National ID / iSIKHNAS">{a.nationalId ?? '-'}</Dt>
            <Dt label="Birth">
              {a.birthDate ? fmtDate(a.birthDate) : '-'}
              {a.birthWeightKg ? ` · ${a.birthWeightKg} kg` : ''}
            </Dt>
            <Dt label="Dam">
              {a.dam ? (
                <Link to={`/herd/animals/${a.dam.id}`} className="text-brand-600">
                  {a.dam.tagNo}
                </Link>
              ) : (
                '-'
              )}
            </Dt>
            <Dt label="Sire">{a.sire ?? '-'}</Dt>
            <Dt label="Came">
              {a.origin === 'BORN' ? 'Born here' : a.origin === 'OPENING' ? 'At go-live' : `Bought${a.supplier ? ` from ${a.supplier.name}` : ''}`} · {fmtDate(a.acquisitionDate)}
            </Dt>
            <Dt label="Weight">
              {a.lastWeightKg !== null ? `${num(a.lastWeightKg, 0)} kg` : '-'}
              {a.adgLast !== null ? ` · ADG ${num(a.adgLast, 2)}` : ''}
            </Dt>
            {a.calves.length > 0 && (
              <Dt label="Calves">
                {a.calves.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <Link to={`/herd/animals/${c.id}`} className="text-brand-600">
                      {c.tagNo}
                    </Link>
                  </span>
                ))}
              </Dt>
            )}
          </dl>
        </Card>
        {female && a.purpose !== 'FATTENING' ? (
          <Card title="Reproduction">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dt label="State">
                <Badge tone={REPRO[a.reproStatus].tone}>{REPRO[a.reproStatus].label}</Badge>
              </Dt>
              <Dt label="Lactation">
                {a.lactationNo}
                {a.daysInMilk !== null ? ` · ${a.daysInMilk} days in milk` : ''}
              </Dt>
              <Dt label="Last calving">{a.lastCalving ? fmtDate(a.lastCalving) : '-'}</Dt>
              <Dt label="Last service">{a.lastService ? `${fmtDate(a.lastService)} (${a.servicesSinceCalving}x)` : '-'}</Dt>
              <Dt label="Expected calving">{a.expectedCalving ? fmtDate(a.expectedCalving) : '-'}</Dt>
              <Dt label="Dry off by">{a.dryOffDate ? fmtDate(a.dryOffDate) : '-'}</Dt>
            </dl>
          </Card>
        ) : (
          <Card title="Growth">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dt label="Days on farm">{Math.round((Date.now() - new Date(a.acquisitionDate).getTime()) / 86_400_000)}</Dt>
              <Dt label="Weighings">{a.weights.length}</Dt>
              <Dt label="ADG last">{a.adgLast !== null ? `${num(a.adgLast, 2)} kg/day` : '-'}</Dt>
              <Dt label="ADG overall">{a.adgTotal !== null ? `${num(a.adgTotal, 2)} kg/day` : '-'}</Dt>
            </dl>
          </Card>
        )}
        <Card title="Cost">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label={a.origin === 'OPENING' ? 'Value at go-live' : 'Purchase'}>{fmtMoney(a.acquisitionCost, 0)}</Dt>
            <Dt label="Carried now">{fmtMoney(a.carryingCost, 0)}</Dt>
            <Dt label="Capitalised feed & care">{fmtMoney(costSum(true) - (a.origin !== 'BORN' ? a.acquisitionCost : 0), 0)}</Dt>
            <Dt label="Expensed (productive)">{fmtMoney(costSum(false), 0)}</Dt>
            {a.asset && (
              <>
                <Dt label="Productive asset">
                  <Link to={`/assets/${a.asset.id}`} className="text-brand-600">
                    {a.asset.code}
                  </Link>{' '}
                  · {Math.round(a.asset.usefulLifeMonths / 12)} y
                </Dt>
                <Dt label="Book value">{fmtMoney(a.asset.cost - a.asset.accumulatedDepreciation, 0)}</Dt>
              </>
            )}
            {a.exitDate && (
              <>
                <Dt label={`${STATUS[a.status].label} on`}>
                  {fmtDate(a.exitDate)}
                  {a.exitReason ? ` · ${a.exitReason}` : ''}
                </Dt>
                <Dt label="Value / cost out">
                  {a.exitValue !== null ? fmtMoney(a.exitValue, 0) : '-'} / {fmtMoney(a.exitCost ?? 0, 0)}
                </Dt>
                {a.saleDocId && (
                  <Dt label="Invoice">
                    <Link to={`/documents/SI/${a.saleDocId}`} className="text-brand-600">
                      open
                    </Link>
                  </Dt>
                )}
              </>
            )}
          </dl>
        </Card>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'events', label: `Events (${a.events.length})` },
          { value: 'weights', label: `Weights (${a.weights.length})` },
          { value: 'health', label: `Health (${a.treatments.length})` },
          ...(female ? [{ value: 'milk' as const, label: 'Milk (60 days)' }] : []),
        ]}
      />
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          {tab === 'events' &&
            (a.events.length ? (
              <ul className="divide-y divide-line">
                {a.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-28 text-slate-500">{fmtDate(e.date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{EVENT[e.type]}</span>
                      {e.method ? ` · ${e.method}` : ''}
                      {e.result ? ` · ${e.result.toLowerCase()}` : ''}
                      {e.sire ? ` · ${e.sire}` : ''}
                      {e.technician ? ` · ${e.technician}` : ''}
                      {e.toUnit ? ` · ${e.fromUnit ?? '-'} → ${e.toUnit}` : ''}
                      {e.notes ? <span className="block text-xs text-slate-500">{e.notes}</span> : null}
                    </span>
                    {active && can('herd.record') && lastEvent?.id === e.id && e.type !== 'CALVING' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash-2"
                        aria-label="Remove last event"
                        onClick={async () => (await confirm({ title: `Remove ${EVENT[e.type].toLowerCase()} of ${fmtDate(e.date)}?`, danger: true, confirmText: 'Remove' })) && delEvent.mutate(e.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No events yet.</p>
            ))}
          {tab === 'weights' &&
            (a.weights.length ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-right">Kg</th>
                    <th className="px-2 py-2 text-right">Gain</th>
                    <th className="px-2 py-2 text-right">ADG</th>
                    <th className="px-2 py-2 text-right">BCS</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.weights.map((w, i) => {
                    const prev = a.weights[i - 1];
                    const days = prev ? Math.round((new Date(w.date).getTime() - new Date(prev.date).getTime()) / 86_400_000) : 0;
                    return (
                      <tr key={w.id}>
                        <td className="px-4 py-2">{fmtDate(w.date)}</td>
                        <td className="px-2 py-2 text-right">{num(w.kg, 1)}</td>
                        <td className="px-2 py-2 text-right">{prev ? num(w.kg - prev.kg, 1) : '-'}</td>
                        <td className="px-2 py-2 text-right">{prev && days > 0 ? num((w.kg - prev.kg) / days, 2) : '-'}</td>
                        <td className="px-2 py-2 text-right">{w.bcs ?? '-'}</td>
                        <td className="pr-2">
                          {active && can('herd.record') && <Button size="sm" variant="ghost" icon="trash-2" aria-label="Remove weighing" onClick={() => delWeight.mutate(w.id)} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">Not weighed yet.</p>
            ))}
          {tab === 'health' &&
            (a.treatments.length ? (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Treatment</th>
                    <th className="px-2 py-2 text-left">Diagnosis</th>
                    <th className="px-2 py-2 text-left">Withdrawal</th>
                    <th className="px-2 py-2 text-left">Vet</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.treatments.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2">{fmtDate(t.date)}</td>
                      <td className="px-2 py-2">{t.description}</td>
                      <td className="px-2 py-2">{t.diagnosis ?? '-'}</td>
                      <td className="px-2 py-2">
                        {[t.milkWithdrawalDays && `milk ${t.milkWithdrawalDays} d`, t.meatWithdrawalDays && `meat ${t.meatWithdrawalDays} d`].filter(Boolean).join(' · ') || '-'}
                      </td>
                      <td className="px-2 py-2">{t.vet ?? '-'}</td>
                      <td className="px-4 py-2 text-right">{fmtMoney(t.cost, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No treatments.</p>
            ))}
          {tab === 'milk' &&
            (a.milk.length ? (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Day</th>
                    <th className="px-2 py-2 text-right">AM</th>
                    <th className="px-2 py-2 text-right">PM</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...a.milk].reverse().map((m) => (
                    <tr key={m.date} className={m.discarded ? 'text-red-600' : ''}>
                      <td className="px-4 py-2">
                        {fmtDate(m.date)}
                        {m.discarded ? ' · thrown away' : ''}
                      </td>
                      <td className="px-2 py-2 text-right">{num(m.am, 1)}</td>
                      <td className="px-2 py-2 text-right">{num(m.pm, 1)}</td>
                      <td className="px-4 py-2 text-right font-medium">{num(m.total, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No milk recorded in the last 60 days.</p>
            ))}
        </div>
      </Card>
      {modal === 'event' && <EventModal a={a} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'weigh' && <WeighModal animals={[a]} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'treat' && <TreatModal animals={[a]} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'exit' && <ExitModal animals={[{ ...a, withdrawal: { meat: a.meatWithdrawalUntil } }]} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'edit' && <EditModal a={a} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'productive' && <ProductiveModal a={a} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function EventModal({ a, onClose, onDone }: { a: AnimalDetail; onClose: () => void; onDone: () => void }) {
  const lists = useLists();
  const female = a.sex === 'F';
  const [f, setF] = useState({ date: isoDate(), type: female ? 'SERVICE' : 'MOVE', method: 'AI', sire: '', technician: '', result: 'POSITIVE', toUnitId: '', notes: '' });
  const [calves, setCalves] = useState([{ tagNo: '', sex: 'F', birthWeightKg: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const types = female ? ['HEAT', 'SERVICE', 'PREG_CHECK', 'CALVING', 'ABORTION', ...(a.lactating ? ['DRY_OFF'] : []), 'MOVE', 'NOTE'] : ['MOVE', 'NOTE'];
  const save = useMutation({
    mutationFn: () =>
      api.post(`/herd/animals/${a.id}/events`, {
        date: f.date,
        type: f.type,
        method: f.type === 'SERVICE' ? f.method : f.type === 'CALVING' ? f.method || 'NORMAL' : null,
        sire: f.type === 'SERVICE' ? f.sire : null,
        technician: f.technician || null,
        result: f.type === 'PREG_CHECK' || f.type === 'CALVING' ? f.result : null,
        toUnitId: f.type === 'MOVE' ? f.toUnitId : null,
        calves: f.type === 'CALVING' && f.result === 'LIVE' ? calves.filter((c) => c.tagNo).map((c) => ({ ...c, birthWeightKg: c.birthWeightKg || null })) : [],
        notes: f.notes || null,
      }),
    onSuccess: () => (toast.success(`${EVENT[f.type]} recorded`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Event for ${a.tagNo}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Event" error={errors.type}>
          <Select
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value, result: e.target.value === 'CALVING' ? 'LIVE' : 'POSITIVE', method: e.target.value === 'CALVING' ? 'NORMAL' : 'AI' })}
            options={types.map((t) => ({ value: t, label: EVENT[t] }))}
          />
        </Field>
        <Field label="Date" required error={errors.date}>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        {f.type === 'SERVICE' && (
          <>
            <Field label="Service" error={errors.method}>
              <Select
                value={f.method}
                onChange={(e) => set('method')(e.target.value)}
                options={[
                  { value: 'AI', label: 'Artificial insemination (IB)' },
                  { value: 'NATURAL', label: 'Natural (bull)' },
                ]}
              />
            </Field>
            <Field label={f.method === 'AI' ? 'Semen straw code / bull' : 'Bull tag'}>
              <Input value={f.sire} maxLength={60} onChange={(e) => set('sire')(e.target.value)} />
            </Field>
          </>
        )}
        {f.type === 'PREG_CHECK' && (
          <Field label="Result" error={errors.result}>
            <Select
              value={f.result}
              onChange={(e) => set('result')(e.target.value)}
              options={[
                { value: 'POSITIVE', label: 'Pregnant' },
                { value: 'NEGATIVE', label: 'Not pregnant' },
              ]}
            />
          </Field>
        )}
        {f.type === 'CALVING' && (
          <>
            <Field label="Calving">
              <Select
                value={f.method}
                onChange={(e) => set('method')(e.target.value)}
                options={[
                  { value: 'NORMAL', label: 'Normal' },
                  { value: 'ASSISTED', label: 'Assisted' },
                  { value: 'CAESAREAN', label: 'Caesarean' },
                ]}
              />
            </Field>
            <Field label="Outcome" error={errors.result}>
              <Select
                value={f.result}
                onChange={(e) => set('result')(e.target.value)}
                options={[
                  { value: 'LIVE', label: 'Live calf' },
                  { value: 'STILLBORN', label: 'Stillborn' },
                ]}
              />
            </Field>
            {f.result === 'LIVE' && (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-xs text-slate-500">Calves (a new tag each){errors.calves ? <span className="ml-2 text-red-600">{errors.calves}</span> : null}</p>
                {calves.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_8rem_8rem] gap-2">
                    <Input
                      value={c.tagNo}
                      placeholder="Calf tag"
                      maxLength={40}
                      onChange={(e) => setCalves(calves.map((x, j) => (j === i ? { ...x, tagNo: e.target.value.toUpperCase() } : x)))}
                      aria-label="Calf tag"
                    />
                    <Select
                      value={c.sex}
                      onChange={(e) => setCalves(calves.map((x, j) => (j === i ? { ...x, sex: e.target.value } : x)))}
                      options={[
                        { value: 'F', label: 'Female' },
                        { value: 'M', label: 'Male' },
                      ]}
                      aria-label="Calf sex"
                    />
                    <NumberInput
                      decimals={1}
                      min={0}
                      value={c.birthWeightKg}
                      placeholder="kg"
                      onChange={(v) => setCalves(calves.map((x, j) => (j === i ? { ...x, birthWeightKg: v } : x)))}
                      aria-label="Birth weight"
                    />
                  </div>
                ))}
                {calves.length < 3 && (
                  <Button size="sm" variant="outline" icon="plus" onClick={() => setCalves([...calves, { tagNo: '', sex: 'F', birthWeightKg: '' }])}>
                    Twin
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {f.type === 'MOVE' && (
          <Field label="To pen" error={errors.toUnitId}>
            <Select
              value={f.toUnitId}
              onChange={(e) => set('toUnitId')(e.target.value)}
              placeholder="Choose"
              options={(lists.data?.units ?? []).filter((u) => u.id !== a.unit?.id).map((u) => ({ value: u.id, label: `${u.name} (${u.heads})` }))}
            />
          </Field>
        )}
        {['SERVICE', 'PREG_CHECK', 'CALVING', 'ABORTION'].includes(f.type) && (
          <Field label="Inseminator / vet">
            <Input value={f.technician} maxLength={100} onChange={(e) => set('technician')(e.target.value)} />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Input value={f.notes} maxLength={500} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
      {f.type === 'SERVICE' && lists.data && <p className="mt-3 text-xs text-slate-500">Expected calving {lists.data.settings.gestationDays} days after the service.</p>}
    </Modal>
  );
}

function EditModal({ a, onClose, onDone }: { a: AnimalDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: a.name ?? '',
    nationalId: a.nationalId ?? '',
    breed: a.breed ?? '',
    purpose: a.purpose,
    birthDate: a.birthDate?.slice(0, 10) ?? '',
    sire: a.sire ?? '',
    notes: a.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () => api.put(`/herd/animals/${a.id}`, { ...f, birthDate: f.birthDate || null }),
    onSuccess: () => (toast.success('Saved'), onDone()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${a.tagNo}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="National ID / iSIKHNAS">
          <Input value={f.nationalId} maxLength={60} onChange={(e) => setF({ ...f, nationalId: e.target.value })} />
        </Field>
        <Field label="Breed">
          <Input value={f.breed} maxLength={80} onChange={(e) => setF({ ...f, breed: e.target.value })} />
        </Field>
        <Field label="Purpose">
          <Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} options={Object.entries(PURPOSE).map(([value, p]) => ({ value, label: p.label }))} />
        </Field>
        <Field label="Birth date">
          <DatePicker value={f.birthDate} max={isoDate()} onChange={(v) => setF({ ...f, birthDate: v ?? '' })} />
        </Field>
        <Field label="Sire">
          <Input value={f.sire} maxLength={60} onChange={(e) => setF({ ...f, sire: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function ProductiveModal({ a, onClose, onDone }: { a: AnimalDetail; onClose: () => void; onDone: () => void }) {
  const lists = useLists();
  const s = lists.data?.settings;
  const [f, setF] = useState({ date: isoDate(), usefulLifeMonths: '', salvageValue: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post(`/herd/animals/${a.id}/productive`, { date: f.date, usefulLifeMonths: f.usefulLifeMonths || undefined, salvageValue: f.salvageValue === '' ? null : f.salvageValue }),
    onSuccess: () => (toast.success(`${a.tagNo} is productive`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Put ${a.tagNo} into production`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Confirm
        </Button>
      }
    >
      <p className="mb-3 text-sm">
        The cost carried ({fmtMoney(a.carryingCost, 0)}) becomes productive livestock, depreciated over its productive life down to its cull value. Cows do this by themselves at their first calving;
        use it for a bull put into service.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" error={errors.date}>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Productive life (months)" help={s ? `Empty: ${s.lifeMonths}` : undefined}>
          <NumberInput decimals={0} min={6} max={240} value={f.usefulLifeMonths} onChange={(v) => setF({ ...f, usefulLifeMonths: v })} />
        </Field>
        <Field label="Cull value" help={s ? `Empty: ${s.salvagePct}% of the cost` : undefined} error={errors.salvageValue}>
          <NumberInput decimals={0} min={0} value={f.salvageValue} onChange={(v) => setF({ ...f, salvageValue: v })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Tax: dairy and breeding cattle are group 2 (8 years) from the month sales begin; labour is not part of the fiscal cost (PMK 72/2023).</p>
    </Modal>
  );
}

// ============================================================ milking
interface SheetRow {
  id: string;
  tagNo: string;
  name: string | null;
  unit: string | null;
  daysInMilk: number | null;
  lactationNo: number;
  am: number | null;
  pm: number | null;
  withdrawal: string | null;
}

export function MilkPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [date, setDate] = useState(isoDate());
  const [session, setSession] = useState<'AM' | 'PM'>(new Date().getHours() < 12 ? 'AM' : 'PM');
  const [vals, setVals] = useState<Record<string, string>>({});
  const sheet = useQuery({ queryKey: ['herd', 'sheet', date], queryFn: () => api.get<SheetRow[]>('/herd/milk/sheet', { date }) });
  const summary = useQuery({
    queryKey: ['herd', 'milksum'],
    queryFn: () =>
      api.get<{ date: string; produced: number; discarded: number; cows: number; perCow: number | null; delivered: number; rejected: number }[]>('/herd/milk/summary', {
        from: daysAgo(30),
        to: isoDate(),
      }),
  });
  useEffect(() => {
    setVals(Object.fromEntries((sheet.data ?? []).map((r) => [r.id, (session === 'AM' ? r.am : r.pm) === null ? '' : String(session === 'AM' ? r.am : r.pm)])));
  }, [sheet.data, session]);
  const rows = sheet.data ?? [];
  const total = Object.values(vals).reduce((s, v) => s + Number(v || 0), 0);
  const save = useMutation({
    mutationFn: () => api.post('/herd/milk/records', { date, session, rows: rows.filter((r) => vals[r.id] !== undefined).map((r) => ({ animalId: r.id, liters: vals[r.id] || 0 })) }),
    onSuccess: () => (toast.success(`${session} milking saved: ${fmtNumber(total, 1)} l`), qc.invalidateQueries({ queryKey: ['herd'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Milking"
        subtitle="Litres per cow per milking; milk of cows in a drug withdrawal period is recorded as thrown away"
        actions={
          can('herd.record') && (
            <Button icon="save" loading={save.isPending} disabled={!rows.length} onClick={() => save.mutate()}>
              Save {session} ({fmtNumber(total, 1)} l)
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={date} max={isoDate()} clearable={false} onChange={(v) => setDate(v ?? isoDate())} aria-label="Day" />
        </div>
        <div className="w-36">
          <Select
            value={session}
            onChange={(e) => setSession(e.target.value as 'AM' | 'PM')}
            options={[
              { value: 'AM', label: 'Morning (AM)' },
              { value: 'PM', label: 'Afternoon (PM)' },
            ]}
          />
        </div>
      </div>
      <Card bodyClass="p-0">
        {sheet.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="milk" title="No cows in milk" description="Cows come into milk at their calving" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Cow</th>
                  <th className="px-2 py-2 text-left">Pen</th>
                  <th className="px-2 py-2 text-right">Lactation · days</th>
                  <th className="px-2 py-2 text-right">{session === 'AM' ? 'PM' : 'AM'} l</th>
                  <th className="w-36 px-2 py-2 text-right">{session} l</th>
                  <th className="px-4 py-2 text-left" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={r.withdrawal ? 'bg-red-50/60' : ''}>
                    <td className="px-4 py-1.5">
                      <Link to={`/herd/animals/${r.id}`} className="font-medium text-brand-600">
                        {r.tagNo}
                      </Link>
                      {r.name && <span className="text-xs text-slate-500"> {r.name}</span>}
                    </td>
                    <td className="px-2 py-1.5">{r.unit ?? '-'}</td>
                    <td className="px-2 py-1.5 text-right">
                      {r.lactationNo} · {r.daysInMilk ?? '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{num(session === 'AM' ? r.pm : r.am, 1)}</td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        disabled={!can('herd.record')}
                        decimals={1}
                        min={0}
                        max={100}
                        value={vals[r.id] ?? ''}
                        onChange={(v) => setVals({ ...vals, [r.id]: v })}
                        aria-label={`${r.tagNo} litres`}
                      />
                    </td>
                    <td className="px-4 py-1.5 text-xs text-red-600">{r.withdrawal ? `withdrawal to ${fmtDate(r.withdrawal)}: throw away` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Last 30 days" bodyClass="p-0">
        {!summary.data?.length ? (
          <p className="px-4 py-6 text-sm text-slate-500">No milk recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Day</th>
                  <th className="px-2 py-2 text-right">Cows</th>
                  <th className="px-2 py-2 text-right">Litres</th>
                  <th className="px-2 py-2 text-right">Per cow</th>
                  <th className="px-2 py-2 text-right">Thrown away</th>
                  <th className="px-2 py-2 text-right">Delivered</th>
                  <th className="px-4 py-2 text-right">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.data.map((d) => (
                  <tr key={d.date}>
                    <td className="px-4 py-2">{fmtDate(d.date)}</td>
                    <td className="px-2 py-2 text-right">{d.cows}</td>
                    <td className="px-2 py-2 text-right">{num(d.produced, 1)}</td>
                    <td className="px-2 py-2 text-right">{num(d.perCow, 1)}</td>
                    <td className="px-2 py-2 text-right">{d.discarded ? num(d.discarded, 1) : '-'}</td>
                    <td className="px-2 py-2 text-right">{d.delivered ? num(d.delivered, 1) : '-'}</td>
                    <td className="px-4 py-2 text-right">{d.rejected ? num(d.rejected, 1) : '-'}</td>
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

// ============================================================ milk deliveries, prices, invoicing
interface Delivery {
  id: string;
  number: string;
  date: string;
  session: string;
  customerId: string;
  customer: string;
  liters: number;
  fat: number | null;
  snf: number | null;
  ts: number | null;
  protein: number | null;
  tpc: number | null;
  density: number | null;
  alcoholTest: boolean | null;
  rejected: boolean;
  pricePerLiter: number;
  amount: number;
  status: string;
  invoice: { id: string; number: string } | null;
}
interface Scheme {
  id: string;
  customerId: string;
  customer: string;
  effectiveDate: string;
  basePrice: number;
  fatStd: number;
  fatStep: number;
  tsStd: number;
  tsStep: number;
  tpcGrades: { maxTpc: number; adj: number }[] | null;
  notes: string | null;
}

const sniFlags = (d: { fat: number | null; snf: number | null; ts: number | null; protein: number | null; tpc: number | null; density: number | null; alcoholTest: boolean | null }) =>
  [
    d.fat !== null && d.fat < SNI_MILK.fat && `fat < ${SNI_MILK.fat}`,
    d.snf !== null && d.snf < SNI_MILK.snf && `SNF < ${SNI_MILK.snf}`,
    d.ts !== null && d.ts < SNI_MILK.ts && `TS < ${SNI_MILK.ts}`,
    d.protein !== null && d.protein < SNI_MILK.protein && `protein < ${SNI_MILK.protein}`,
    d.density !== null && d.density < SNI_MILK.density && `density < ${SNI_MILK.density}`,
    d.tpc !== null && d.tpc > SNI_MILK.tpc && 'TPC > 1 million',
    d.alcoholTest === true && 'alcohol test positive',
  ].filter(Boolean) as string[];

export function MilkSalesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [modal, setModal] = useState<'' | 'delivery' | 'scheme' | 'settle'>('');
  const q = useQuery({ queryKey: ['herd', 'deliveries', from, to], queryFn: () => api.get<Delivery[]>('/herd/milk/deliveries', { from, to }) });
  const schemes = useQuery({ queryKey: ['herd', 'schemes'], queryFn: () => api.get<Scheme[]>('/herd/milk/schemes') });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/herd/milk/deliveries/${id}/cancel`),
    onSuccess: () => (toast.success('Delivery cancelled'), qc.invalidateQueries({ queryKey: ['herd'] })),
    onError: (e) => toast.error(e),
  });
  const delScheme = useMutation({
    mutationFn: (id: string) => api.delete(`/herd/milk/schemes/${id}`),
    onSuccess: () => (toast.success('Scheme removed'), qc.invalidateQueries({ queryKey: ['herd'] })),
    onError: (e) => toast.error(e),
  });
  const rows = (q.data ?? []).filter((r) => r.status === 'POSTED');
  const t = rows.reduce((a, r) => ({ l: a.l + (r.rejected ? 0 : r.liters), rej: a.rej + (r.rejected ? r.liters : 0), amt: a.amt + r.amount }), { l: 0, rej: 0, amt: 0 });
  const done = () => (setModal(''), qc.invalidateQueries({ queryKey: ['herd'] }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Milk Deliveries & Prices"
        subtitle="Milk handed to the cooperative / milk processor with its quality test; priced by the buyer's scheme (base price, fat, total solids, bacteria grade) and invoiced per period. Fresh milk is exempt from PPN (PP 49/2022)"
        actions={
          can('herd.milk.sell') && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon="file-text" onClick={() => setModal('settle')}>
                Invoice a period
              </Button>
              <Button icon="plus" onClick={() => setModal('delivery')}>
                New delivery
              </Button>
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? firstOfMonth())} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Delivered" value={`${num(t.l, 0)} l`} hint={`${rows.length} deliveries`} />
        <Stat label="Rejected" value={`${num(t.rej, 0)} l`} />
        <Stat label="Value" value={fmtMoney(t.amt, 0)} />
        <Stat label="Average price" value={t.l ? fmtMoney(t.amt / t.l, 0) : '-'} hint="per litre" />
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !(q.data ?? []).length ? (
          <EmptyState icon="truck" title="No deliveries in this period" description="Set the price scheme of the buyer first" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Delivery</th>
                  <th className="px-2 py-2 text-left">Buyer</th>
                  <th className="px-2 py-2 text-right">Litres</th>
                  <th className="px-2 py-2 text-right">Fat</th>
                  <th className="px-2 py-2 text-right">TS</th>
                  <th className="px-2 py-2 text-right">TPC</th>
                  <th className="px-2 py-2 text-left">SNI 3141</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-2 py-2 text-left">Invoice</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(q.data ?? []).map((r) => {
                  const flags = sniFlags(r);
                  return (
                    <tr key={r.id} className={r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                      <td className="px-4 py-2">
                        {r.number}
                        <span className="block text-xs text-slate-500">
                          {fmtDate(r.date)} {r.session !== 'DAY' ? r.session : ''}
                        </span>
                      </td>
                      <td className="px-2 py-2">{r.customer}</td>
                      <td className="px-2 py-2 text-right">{num(r.liters, 1)}</td>
                      <td className="px-2 py-2 text-right">{r.fat ?? '-'}</td>
                      <td className="px-2 py-2 text-right">{r.ts ?? '-'}</td>
                      <td className="px-2 py-2 text-right">{r.tpc !== null ? fmtNumber(r.tpc) : '-'}</td>
                      <td className="px-2 py-2">
                        {r.rejected ? (
                          <Badge tone="red">Rejected</Badge>
                        ) : flags.length ? (
                          <span className="text-xs text-amber-700">{flags.join(', ')}</span>
                        ) : (
                          <span className="text-xs text-emerald-700">meets</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">{fmtMoney(r.pricePerLiter, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(r.amount, 0)}</td>
                      <td className="px-2 py-2">
                        {r.invoice ? (
                          <Link to={`/documents/SI/${r.invoice.id}`} className="text-brand-600">
                            {r.invoice.number}
                          </Link>
                        ) : r.status === 'POSTED' && !r.rejected ? (
                          <Badge tone="amber">to invoice</Badge>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="pr-2">
                        {r.status === 'POSTED' && !r.invoice && can('herd.milk.sell') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="x"
                            aria-label="Cancel delivery"
                            onClick={async () => (await confirm({ title: `Cancel ${r.number}?`, danger: true, confirmText: 'Cancel delivery' })) && cancel.mutate(r.id)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card
        title="Price schemes"
        subtitle="Per buyer from a date: base price per litre, plus / minus a step per 0.1 % of fat and of total solids against the standard, plus the bacteria (TPC) grade adjustment"
        actions={
          can('herd.milk.sell') && (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setModal('scheme')}>
              Scheme
            </Button>
          )
        }
        bodyClass="p-0"
      >
        {!schemes.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No price schemes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {schemes.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.customer}</span> from {fmtDate(s.effectiveDate)} · base {fmtMoney(s.basePrice, 0)}
                  {s.fatStep ? ` · fat ${s.fatStd}% ± ${fmtMoney(s.fatStep, 0)}/0.1` : ''}
                  {s.tsStep ? ` · TS ${s.tsStd}% ± ${fmtMoney(s.tsStep, 0)}/0.1` : ''}
                  {s.tpcGrades?.length ? (
                    <span className="block text-xs text-slate-500">TPC: {s.tpcGrades.map((g) => `≤${fmtNumber(g.maxTpc)} ${g.adj >= 0 ? '+' : ''}${fmtNumber(g.adj)}`).join(' · ')}</span>
                  ) : null}
                </span>
                {can('herd.milk.sell') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash-2"
                    aria-label="Remove scheme"
                    onClick={async () => (await confirm({ title: 'Remove this price scheme?', danger: true, confirmText: 'Remove' })) && delScheme.mutate(s.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {modal === 'delivery' && <DeliveryModal onClose={() => setModal('')} onDone={done} />}
      {modal === 'scheme' && <SchemeModal onClose={() => setModal('')} onDone={done} />}
      {modal === 'settle' && <MilkSettleModal from={from} to={to} onClose={() => setModal('')} onDone={done} />}
    </div>
  );
}

function DeliveryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    date: isoDate(),
    session: 'DAY',
    customerId: null as string | null,
    liters: '',
    fat: '',
    snf: '',
    ts: '',
    protein: '',
    tpc: '',
    density: '',
    alcoholTest: false,
    rejected: false,
    pricePerLiter: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const quote = useQuery({
    queryKey: ['herd', 'quote', f.customerId, f.date, f.fat, f.snf, f.ts, f.tpc],
    queryFn: () =>
      api.get<{ price: number; base: number; fatAdj: number; tsAdj: number; tpcAdj: number; grade: number | null; ts: number | null } | null>('/herd/milk/quote', {
        customerId: f.customerId,
        date: f.date,
        fat: f.fat,
        snf: f.snf,
        ts: f.ts,
        tpc: f.tpc,
      }),
    enabled: !!f.customerId,
  });
  const nn = (v: string) => (v === '' ? null : Number(v));
  const flags = sniFlags({
    fat: nn(f.fat),
    snf: nn(f.snf),
    ts: nn(f.ts) ?? (f.fat && f.snf ? Number(f.fat) + Number(f.snf) : null),
    protein: nn(f.protein),
    tpc: nn(f.tpc),
    density: nn(f.density),
    alcoholTest: f.alcoholTest,
  });
  const price = f.rejected ? 0 : f.pricePerLiter !== '' ? Number(f.pricePerLiter) : (quote.data?.price ?? null);
  const save = useMutation({
    mutationFn: () => api.post('/herd/milk/deliveries', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))),
    onSuccess: () => (toast.success('Delivery recorded'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Milk delivery"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId || !(Number(f.liters) > 0) || price === null} onClick={() => save.mutate()}>
          Record {price !== null && f.liters ? fmtMoney(Number(f.liters) * price, 0) : ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Buyer" required className="sm:col-span-2" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={set('customerId')} />
        </Field>
        <Field label="Litres" required error={errors.liters}>
          <NumberInput decimals={1} min={0} value={f.liters} onChange={set('liters')} />
        </Field>
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        <Field label="Milking">
          <Select
            value={f.session}
            onChange={(e) => set('session')(e.target.value)}
            options={[
              { value: 'DAY', label: 'Whole day' },
              { value: 'AM', label: 'Morning' },
              { value: 'PM', label: 'Afternoon' },
            ]}
          />
        </Field>
        <Field label="Fat %">
          <NumberInput decimals={2} min={0} max={20} value={f.fat} onChange={set('fat')} />
        </Field>
        <Field label="SNF %">
          <NumberInput decimals={2} min={0} max={20} value={f.snf} onChange={set('snf')} />
        </Field>
        <Field label="TS %" help="Empty: fat + SNF">
          <NumberInput decimals={2} min={0} max={30} value={f.ts} onChange={set('ts')} />
        </Field>
        <Field label="Protein %">
          <NumberInput decimals={2} min={0} max={20} value={f.protein} onChange={set('protein')} />
        </Field>
        <Field label="TPC (CFU / ml)">
          <NumberInput decimals={0} min={0} value={f.tpc} onChange={set('tpc')} />
        </Field>
        <Field label="Density (27.5 °C)">
          <NumberInput decimals={4} min={0} max={2} grouping={false} value={f.density} onChange={set('density')} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <Switch checked={f.alcoholTest} onChange={set('alcoholTest')} label="Alcohol test positive" />
          <Switch checked={f.rejected} onChange={set('rejected')} label="Rejected by the buyer" />
        </div>
        <Field label="Price per litre" help={quote.data ? 'Empty: the scheme price' : 'No scheme for this buyer: enter the price'} error={errors.pricePerLiter}>
          <NumberInput decimals={2} min={0} value={f.pricePerLiter} placeholder={quote.data ? String(quote.data.price) : ''} onChange={set('pricePerLiter')} />
        </Field>
      </div>
      {quote.data && !f.rejected && (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          Scheme: base {fmtMoney(quote.data.base, 0)} {quote.data.fatAdj ? `${quote.data.fatAdj > 0 ? '+' : ''}${fmtNumber(quote.data.fatAdj)} fat` : ''}{' '}
          {quote.data.tsAdj ? `${quote.data.tsAdj > 0 ? '+' : ''}${fmtNumber(quote.data.tsAdj)} TS` : ''}{' '}
          {quote.data.tpcAdj ? `${quote.data.tpcAdj > 0 ? '+' : ''}${fmtNumber(quote.data.tpcAdj)} TPC grade ${quote.data.grade}` : ''} ={' '}
          <span className="font-semibold">{fmtMoney(quote.data.price, 0)}</span> per litre
        </p>
      )}
      {flags.length > 0 && <p className="mt-2 text-xs text-amber-700">Below SNI 3141:2024 raw milk: {flags.join(', ')}</p>}
    </Modal>
  );
}

function SchemeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ customerId: null as string | null, effectiveDate: isoDate(), basePrice: '', fatStd: '3.5', fatStep: '', tsStd: '11.5', tsStep: '', notes: '' });
  const [grades, setGrades] = useState([
    { maxTpc: '100000', adj: '' },
    { maxTpc: '500000', adj: '' },
    { maxTpc: '1000000', adj: '0' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api.post('/herd/milk/schemes', {
        ...f,
        fatStd: f.fatStd || 0,
        fatStep: f.fatStep || 0,
        tsStd: f.tsStd || 0,
        tsStep: f.tsStep || 0,
        tpcGrades: grades.filter((g) => g.maxTpc && g.adj !== '').map((g) => ({ maxTpc: g.maxTpc, adj: g.adj })),
      }),
    onSuccess: () => (toast.success('Price scheme saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Milk price scheme"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId || !f.basePrice} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Buyer" required className="sm:col-span-2" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="From" required>
          <DatePicker value={f.effectiveDate} clearable={false} onChange={(v) => setF({ ...f, effectiveDate: v ?? isoDate() })} />
        </Field>
        <Field label="Base price per litre" required error={errors.basePrice}>
          <NumberInput decimals={2} min={0} value={f.basePrice} onChange={(v) => setF({ ...f, basePrice: v })} />
        </Field>
        <Field label="Fat standard %">
          <NumberInput decimals={2} min={0} max={20} value={f.fatStd} onChange={(v) => setF({ ...f, fatStd: v })} />
        </Field>
        <Field label="Per 0.1 % fat (Rp)">
          <NumberInput decimals={2} min={0} value={f.fatStep} onChange={(v) => setF({ ...f, fatStep: v })} />
        </Field>
        <div />
        <Field label="TS standard %">
          <NumberInput decimals={2} min={0} max={30} value={f.tsStd} onChange={(v) => setF({ ...f, tsStd: v })} />
        </Field>
        <Field label="Per 0.1 % TS (Rp)">
          <NumberInput decimals={2} min={0} value={f.tsStep} onChange={(v) => setF({ ...f, tsStep: v })} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Bacteria (TPC) grades</span>
          <Button size="sm" variant="outline" icon="plus" onClick={() => setGrades([...grades, { maxTpc: '', adj: '' }])}>
            Grade
          </Button>
        </div>
        <div className="space-y-2">
          {grades.map((g, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2.5rem] gap-2">
              <NumberInput
                decimals={0}
                min={0}
                value={g.maxTpc}
                placeholder="up to CFU/ml"
                onChange={(v) => setGrades(grades.map((x, j) => (j === i ? { ...x, maxTpc: v } : x)))}
                aria-label="TPC up to"
              />
              <NumberInput
                decimals={2}
                allowNegative
                value={g.adj}
                placeholder="Rp per litre (+/-)"
                onChange={(v) => setGrades(grades.map((x, j) => (j === i ? { ...x, adj: v } : x)))}
                aria-label="Adjustment"
              />
              <Button variant="ghost" size="icon" icon="x" aria-label="Remove grade" onClick={() => setGrades(grades.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Milk above the last grade takes the last adjustment. SNI 3141:2011 allowed at most 1 million CFU / ml.</p>
      </div>
    </Modal>
  );
}

function MilkSettleModal({ from, to, onClose, onDone }: { from: string; to: string; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ customerId: null as string | null, from, to, date: to });
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string; deliveries: number; liters: number }>('/herd/milk/settlement', f),
    onSuccess: (r) => (toast.success(`Draft invoice ${r.number}: ${r.deliveries} deliveries, ${fmtNumber(r.liters)} l`), onDone(), navigate(`/documents/SI/${r.id}`)),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Invoice the milk of a period"
      footer={
        <Button icon="file-text" loading={save.isPending} disabled={!f.customerId} onClick={() => save.mutate()}>
          Make draft invoice
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Buyer" required className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="From">
          <DatePicker value={f.from} clearable={false} onChange={(v) => setF({ ...f, from: v ?? from })} />
        </Field>
        <Field label="To">
          <DatePicker value={f.to} clearable={false} onChange={(v) => setF({ ...f, to: v ?? to })} />
        </Field>
        <Field label="Invoice date">
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? to })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        One line per delivery not invoiced yet; rejected milk is left out. A milk processor buying above Rp20 million a month collects PPh 22 0.25% (PMK 51/2025).
      </p>
    </Modal>
  );
}

// ============================================================ pen feeding
interface Feeding {
  id: string;
  number: string;
  date: string;
  status: string;
  unit: { code: string; name: string } | null;
  product: string;
  qty: number;
  cost: number;
  heads: number;
  notes: string | null;
}

export function FeedingPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const lists = useLists();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['herd', 'feedings', from, to], queryFn: () => api.get<Feeding[]>('/herd/feedings', { from, to }) });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/herd/feedings/${id}/cancel`),
    onSuccess: () => (toast.success('Feeding cancelled'), qc.invalidateQueries({ queryKey: ['herd'] })),
    onError: (e) => toast.error(e),
  });
  const rows = q.data ?? [];
  const posted = rows.filter((r) => r.status === 'POSTED');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Pen Feeding"
        subtitle="Feed issued from the store to a pen; its cost is shared equally by the animals in the pen that day (capitalised for growing animals, a production cost for productive ones)"
        actions={
          can('herd.record') && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              Feed a pen
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? firstOfMonth())} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
      </div>
      {posted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Feedings" value={fmtNumber(posted.length)} />
          <Stat
            label="Feed cost"
            value={fmtMoney(
              posted.reduce((s, r) => s + r.cost, 0),
              0,
            )}
          />
          <Stat label="Head-days fed" value={fmtNumber(posted.reduce((s, r) => s + r.heads, 0))} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="wheat" title="No feeding in this period" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {fmtDate(r.date)} · {r.unit?.name} · {r.product}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {r.number} · {fmtNumber(r.qty)} · {r.heads} head · {fmtMoney(r.cost, 0)} ({fmtMoney(r.heads ? r.cost / r.heads : 0, 0)} per head)
                  </span>
                </span>
                {r.status === 'POSTED' && can('herd.record') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="x"
                    aria-label="Cancel feeding"
                    onClick={async () =>
                      (await confirm({ title: `Cancel ${r.number}?`, danger: true, message: 'The feed goes back to stock and its cost leaves the animals.', confirmText: 'Cancel feeding' })) &&
                      cancel.mutate(r.id)
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && <FeedModal units={lists.data?.units ?? []} onClose={() => setAdding(false)} onDone={() => (setAdding(false), qc.invalidateQueries({ queryKey: ['herd'] }))} />}
    </div>
  );
}

function FeedModal({ units, onClose, onDone }: { units: Unit[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: isoDate(), unitId: '', productId: null as string | null, warehouseId: null as string | null, qty: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post<{ number: string; cost: number; heads: number }>('/herd/feedings', f),
    onSuccess: (r) => (toast.success(`${r.number}: ${fmtMoney(r.cost, 0)} over ${r.heads} head`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Feed a pen"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.unitId || !f.productId || !f.warehouseId || !(Number(f.qty) > 0)} onClick={() => save.mutate()}>
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Pen" required error={errors.unitId}>
          <Select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })} placeholder="Choose" options={units.map((u) => ({ value: u.id, label: `${u.name} (${u.heads} head)` }))} />
        </Field>
        <Field label="Feed" required error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="Store" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
        </Field>
        <Field label="Quantity" required error={errors.qty}>
          <NumberInput decimals={3} min={0} value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        <Field label="Notes">
          <Input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ health register
export function HealthPage() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(isoDate());
  const q = useQuery({
    queryKey: ['herd', 'treatments', from, to],
    queryFn: () =>
      api.get<
        {
          id: string;
          date: string;
          tagNo: string;
          animalId: string;
          kind: string;
          description: string;
          diagnosis: string | null;
          product: string | null;
          qty: number;
          cost: number;
          vet: string | null;
          milkUntil: string | null;
          meatUntil: string | null;
        }[]
      >('/herd/treatments', { from, to }),
  });
  const rows = q.data ?? [];
  const csv = () =>
    downloadCsv(`health-register-${from}-${to}.csv`, [
      ['Date', 'Tag', 'Kind', 'Treatment', 'Diagnosis', 'Product', 'Qty', 'Vet', 'Milk withdrawal to', 'Meat withdrawal to', 'Cost'],
      ...rows.map((r) => [r.date.slice(0, 10), r.tagNo, r.kind, r.description, r.diagnosis, r.product, r.qty, r.vet, r.milkUntil?.slice(0, 10), r.meatUntil?.slice(0, 10), r.cost]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Health Register"
        subtitle="Vaccinations and treatments per animal with the drug withdrawal periods (records for the vet, the buyer and the livestock office)"
        actions={
          <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? daysAgo(90))} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="syringe" title="No treatments in this period" description="Select animals on the Animals page and choose Treat" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Tag</th>
                  <th className="px-2 py-2 text-left">Treatment</th>
                  <th className="px-2 py-2 text-left">Diagnosis</th>
                  <th className="px-2 py-2 text-left">Withdrawal to</th>
                  <th className="px-2 py-2 text-left">Vet</th>
                  <th className="px-4 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{fmtDate(r.date)}</td>
                    <td className="px-2 py-2">
                      <Link to={`/herd/animals/${r.animalId}`} className="text-brand-600">
                        {r.tagNo}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      {r.description}
                      {r.product && (
                        <span className="block text-xs text-slate-500">
                          {r.product} x {r.qty}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">{r.diagnosis ?? '-'}</td>
                    <td className="px-2 py-2 text-xs">{[r.milkUntil && `milk ${fmtDate(r.milkUntil)}`, r.meatUntil && `meat ${fmtDate(r.meatUntil)}`].filter(Boolean).join(' · ') || '-'}</td>
                    <td className="px-2 py-2">{r.vet ?? '-'}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(r.cost, 0)}</td>
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

// ============================================================ fattening
export function FatteningPage() {
  const q = useQuery({
    queryKey: ['herd', 'fattening'],
    queryFn: () =>
      api.get<
        {
          unit: { code: string; name: string } | null;
          heads: number;
          avgDays: number;
          avgStartKg: number | null;
          avgNowKg: number | null;
          avgAdg: number | null;
          gainedKg: number;
          cost: number;
          feedAndCare: number;
          costPerKgGained: number | null;
          costPerHead: number;
        }[]
      >('/herd/fattening'),
  });
  const rows = q.data ?? [];
  const t = useMemo(
    () => rows.reduce((a, r) => ({ heads: a.heads + r.heads, gained: a.gained + r.gainedKg, care: a.care + r.feedAndCare, cost: a.cost + r.cost }), { heads: 0, gained: 0, care: 0, cost: 0 }),
    [rows],
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Fattening (Feedlot)" subtitle="Animals being fattened by pen: days on feed, weights, daily gain and the cost per kg gained" />
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Head" value={fmtNumber(t.heads)} />
          <Stat label="Weight gained" value={`${fmtNumber(t.gained)} kg`} />
          <Stat label="Feed & care" value={fmtMoney(t.care, 0)} hint={t.gained ? `${fmtMoney(t.care / t.gained, 0)} per kg gained` : undefined} />
          <Stat label="Cost carried" value={fmtMoney(t.cost, 0)} hint={t.heads ? `${fmtMoney(t.cost / t.heads, 0)} per head` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="chart-column" title="No animals being fattened" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Pen</th>
                  <th className="px-2 py-2 text-right">Head</th>
                  <th className="px-2 py-2 text-right">Days on feed</th>
                  <th className="px-2 py-2 text-right">Arrival kg</th>
                  <th className="px-2 py-2 text-right">Now kg</th>
                  <th className="px-2 py-2 text-right">ADG</th>
                  <th className="px-2 py-2 text-right">Feed & care</th>
                  <th className="px-2 py-2 text-right">Per kg gained</th>
                  <th className="px-4 py-2 text-right">Cost per head</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{r.unit?.name ?? 'No pen'}</td>
                    <td className="px-2 py-2 text-right">{r.heads}</td>
                    <td className="px-2 py-2 text-right">{r.avgDays}</td>
                    <td className="px-2 py-2 text-right">{r.avgStartKg ?? '-'}</td>
                    <td className="px-2 py-2 text-right">{r.avgNowKg ?? '-'}</td>
                    <td className="px-2 py-2 text-right font-medium">{r.avgAdg !== null ? num(r.avgAdg, 2) : '-'}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.feedAndCare, 0)}</td>
                    <td className="px-2 py-2 text-right">{r.costPerKgGained !== null ? fmtMoney(r.costPerKgGained, 0) : '-'}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(r.costPerHead, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">Brahman Cross steers in Indonesian feedlots typically gain 1.0 to 1.5 kg a day over 90 to 120 days on feed.</p>
    </div>
  );
}
