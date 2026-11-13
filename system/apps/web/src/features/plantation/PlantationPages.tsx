import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';
import { GRADING_LABELS, gradingPct } from './grading';

const CROPS: Record<string, string> = {
  OIL_PALM: 'Oil palm',
  RUBBER: 'Rubber',
  COCOA: 'Cocoa',
  COFFEE: 'Coffee',
  COCONUT: 'Coconut',
  TEA: 'Tea',
  SUGARCANE: 'Sugar cane',
  OTHER: 'Other',
};
const PHASE: Record<string, { label: string; tone: Tone }> = {
  TBM: { label: 'Immature (TBM)', tone: 'amber' },
  TM: { label: 'Mature (TM)', tone: 'green' },
  INACTIVE: { label: 'Inactive', tone: 'gray' },
};
const BKM_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'gray' },
  APPROVED: { label: 'Approved', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const SPB_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'On the road', tone: 'amber' },
  WEIGHED: { label: 'Weighed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const UOM: Record<string, string> = {
  HA: 'ha',
  BUNCH: 'bunches',
  KG: 'kg',
  PALM: 'palms',
  M: 'm',
  TRIP: 'trips',
  HK: 'HK',
};
const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const firstOfMonth = () => isoDate().slice(0, 8) + '01';

interface Lists {
  sites: { id: string; code: string; name: string }[];
  divisions: { id: string; code: string; name: string; siteId: string }[];
  activities: {
    id: string;
    code: string;
    name: string;
    kind: string;
    uom: string;
    wageBasis: string;
    dailyRate: number;
    pieceRate: number;
    baseTask: number;
    premiumRate: number;
    penaltyUnripe: number;
    penaltyLongStalk: number;
    penaltyLooseLeft: number;
    penaltyOther: number;
  }[];
}
const useLists = () =>
  useQuery({
    queryKey: ['plantation', 'lists'],
    queryFn: () => api.get<Lists>('/plantation/lists'),
    staleTime: 60_000,
  });

interface Ytd {
  kg: number;
  tonPerHa: number | null;
  bunchesHarvested: number;
  bunchesDelivered: number;
  bjrActual: number | null;
  hk: number;
  hkPerHa: number | null;
  kgPerHarvestHk: number | null;
  labour: number;
  material: number;
  cost: number;
  costPerHa: number | null;
  costPerKg: number | null;
  lastHarvest: string | null;
  daysSinceHarvest: number | null;
}
interface BlockRow {
  id: string;
  code: string;
  name: string | null;
  crop: string;
  variety: string | null;
  plantingYear: number | null;
  ageYears: number | null;
  areaHa: number;
  stands: number;
  sph: number | null;
  phase: string;
  matureDate: string | null;
  bjrKg: number;
  tbmCost: number;
  hasGeometry: boolean;
  eudrPolygonNeeded: boolean;
  isActive: boolean;
  site: { id: string; code: string; name: string } | null;
  division: { id: string; code: string; name: string } | null;
  ytd: Ytd | null;
}

// ============================================================ blocks
export function BlocksPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const [divisionId, setDivisionId] = useState('');
  const [phase, setPhase] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['plantation', 'blocks', divisionId, phase],
    queryFn: () =>
      api.get<BlockRow[]>('/plantation/blocks', {
        divisionId: divisionId || undefined,
        phase: phase || undefined,
      }),
  });
  const rows = q.data ?? [];
  const total = rows.reduce(
    (a, b) => ({
      ha: a.ha + b.areaHa,
      tm: a.tm + (b.phase === 'TM' ? b.areaHa : 0),
      kg: a.kg + (b.ytd?.kg ?? 0),
    }),
    { ha: 0, tm: 0, kg: 0 },
  );
  const exportGeo = async () => {
    const fc = await api.get<unknown>('/plantation/blocks.geojson');
    const url = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `blocks-${isoDate()}.geojson`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plantation Blocks"
        subtitle="Planted blocks by estate and division: immature cost, maturity, yield and cost this year"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-44">
              <Select
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                placeholder="All divisions"
                options={(lists.data?.divisions ?? []).map((d) => ({
                  value: d.id,
                  label: `${d.code} · ${d.name}`,
                }))}
              />
            </div>
            <div className="w-40">
              <Select
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                placeholder="All phases"
                options={Object.entries(PHASE).map(([value, p]) => ({
                  value,
                  label: p.label,
                }))}
              />
            </div>
            <Button variant="outline" icon="download" onClick={exportGeo}>
              GeoJSON
            </Button>
            {can('plantation.block.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New block
              </Button>
            )}
          </div>
        }
      />
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Blocks" value={fmtNumber(rows.length)} />
          <Stat label="Planted area" value={`${num(total.ha)} ha`} />
          <Stat label="Mature area" value={`${num(total.tm)} ha`} />
          <Stat label="Fruit this year" value={`${num(total.kg / 1000, 1)} t`} hint={total.tm ? `${num(total.kg / 1000 / total.tm)} t/ha mature` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="map" title="No blocks" description="Create the estate (Farm > Farms, kind Plantation) and its divisions first, then the blocks" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Block</th>
                  <th className="px-2 py-2 text-left">Division</th>
                  <th className="px-2 py-2 text-right">Planted</th>
                  <th className="px-2 py-2 text-right">Area ha</th>
                  <th className="px-2 py-2 text-right">SPH</th>
                  <th className="px-2 py-2 text-left">Phase</th>
                  <th className="px-2 py-2 text-right">Fruit YTD t</th>
                  <th className="px-2 py-2 text-right">t/ha</th>
                  <th className="px-2 py-2 text-right">BJR kg</th>
                  <th className="px-2 py-2 text-right">Cost / ha</th>
                  <th className="px-2 py-2 text-right">Last harvest</th>
                  <th className="px-4 py-2 text-right">Immature cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/plantation/blocks/${b.id}`)}>
                    <td className="px-4 py-2">
                      <Link to={`/plantation/blocks/${b.id}`} className="font-medium text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {b.code}
                      </Link>
                      <span className="block text-xs text-slate-500">
                        {CROPS[b.crop]}
                        {b.variety ? ` · ${b.variety}` : ''}
                        {b.eudrPolygonNeeded ? ' · no boundary' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2">{b.division?.name}</td>
                    <td className="px-2 py-2 text-right">{b.plantingYear ?? '-'}</td>
                    <td className="px-2 py-2 text-right">{num(b.areaHa)}</td>
                    <td className="px-2 py-2 text-right">{b.sph ?? '-'}</td>
                    <td className="px-2 py-2">
                      <Badge tone={PHASE[b.phase].tone}>{b.phase}</Badge>
                    </td>
                    <td className="px-2 py-2 text-right">{b.ytd?.kg ? num(b.ytd.kg / 1000, 2) : '-'}</td>
                    <td className="px-2 py-2 text-right">{b.ytd?.tonPerHa ? num(b.ytd.tonPerHa) : '-'}</td>
                    <td className="px-2 py-2 text-right">{b.ytd?.bjrActual ? num(b.ytd.bjrActual, 1) : b.bjrKg ? <span className="text-slate-400">{num(b.bjrKg, 1)}</span> : '-'}</td>
                    <td className="px-2 py-2 text-right">{b.ytd?.costPerHa ? fmtMoney(b.ytd.costPerHa, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{b.ytd?.lastHarvest ? <span title={fmtDate(b.ytd.lastHarvest)}>{b.ytd.daysSinceHarvest} d ago</span> : '-'}</td>
                    <td className="px-4 py-2 text-right">{b.phase === 'TBM' ? fmtMoney(b.tbmCost, 0) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <BlockEditor onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), qc.invalidateQueries({ queryKey: ['plantation'] }), navigate(`/plantation/blocks/${id}`))} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

interface BlockDetail {
  id: string;
  code: string;
  name: string | null;
  siteId: string;
  divisionId: string;
  crop: string;
  variety: string | null;
  plantingYear: number | null;
  plantingDate: string | null;
  areaHa: number;
  stands: number;
  phase: string;
  matureDate: string | null;
  bjrKg: number;
  landTitle: string | null;
  geometry: unknown;
  latitude: number | null;
  longitude: number | null;
  tbmCost: number;
  notes: string | null;
  isActive: boolean;
  polygonHa: number | null;
  ageMonths: number | null;
  eudrPolygonNeeded: boolean;
  taxBasis: { materials: number; labour: number };
  site: { id: string; code: string; name: string } | null;
  division: { id: string; code: string; name: string } | null;
  asset: {
    id: string;
    code: string;
    cost: number;
    accumulatedDepreciation: number;
    usefulLifeMonths: number;
    statusCode: string;
  } | null;
  ytd: Ytd;
  monthly: {
    month: string;
    kg: number;
    bunches: number;
    tonPerHa: number | null;
  }[];
  works: {
    id: string;
    date: string;
    number: string;
    employee: { code: string; fullName: string } | null;
    activity: string;
    hk: number;
    qty: number;
    uom: string;
    bunches: number;
    amount: number;
    capitalised: boolean;
  }[];
  materials: {
    id: string;
    date: string;
    number: string;
    product: string;
    unit: string;
    qty: number;
    amount: number;
    capitalised: boolean;
  }[];
  loads: {
    id: string;
    number: string;
    date: string;
    status: string;
    tph: string | null;
    bunches: number;
    estimatedKg: number;
    actualKg: number;
  }[];
}

export function BlockPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'edit' | 'mature'>('');
  const [tab, setTab] = useState<'work' | 'materials' | 'fruit'>('work');
  const q = useQuery({
    queryKey: ['plantation', 'block', id],
    queryFn: () => api.get<BlockDetail>(`/plantation/blocks/${id}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['plantation'] });
  const undo = useMutation({
    mutationFn: () => api.post(`/plantation/blocks/${id}/undo-mature`),
    onSuccess: () => (toast.success('Block is immature again'), refresh()),
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/plantation/blocks/${id}`),
    onSuccess: () => (toast.success('Block deleted'), refresh(), navigate('/plantation/blocks')),
    onError: (e) => toast.error(e),
  });
  const b = q.data;
  if (q.isLoading || !b)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const manage = can('plantation.block.manage');
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/plantation/blocks')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Block {b.code} <Badge tone={PHASE[b.phase].tone}>{PHASE[b.phase].label}</Badge>
            {!b.isActive && <Badge tone="gray">Inactive</Badge>}
          </span>
        }
        subtitle={`${b.site?.name ?? ''} / ${b.division?.name ?? ''} · ${CROPS[b.crop]}${b.variety ? ` ${b.variety}` : ''}${b.plantingYear ? ` · planted ${b.plantingYear}` : ''}`}
        actions={
          manage && (
            <>
              <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                Edit
              </Button>
              {b.phase === 'TBM' && (
                <Button icon="sprout" onClick={() => setModal('mature')}>
                  Declare mature
                </Button>
              )}
              {b.phase === 'TM' && b.matureDate && (
                <Button
                  variant="outline"
                  icon="undo-2"
                  loading={undo.isPending}
                  onClick={async () =>
                    (await confirm({
                      title: 'Undo mature?',
                      message: 'The bearer-plant asset is removed and its cost goes back to immature. Only possible before it is depreciated.',
                    })) && undo.mutate()
                  }
                >
                  Undo mature
                </Button>
              )}
              <Button
                variant="ghost"
                icon="trash-2"
                aria-label="Delete"
                onClick={async () =>
                  (await confirm({
                    title: `Delete block ${b.code}?`,
                    danger: true,
                    confirmText: 'Delete',
                  })) && del.mutate()
                }
              />
            </>
          )
        }
      />
      {b.eudrPolygonNeeded && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          No plot boundary yet. Buyers exporting to the EU need the polygon of plots above 4 ha (EUDR Art. 2(28), from 30 Dec 2026 for large and medium operators). Paste it from a GPS survey under
          Edit.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Block">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label="Area">
              {num(b.areaHa, 4)} ha
              {b.polygonHa ? <span className="text-slate-500"> (map {num(b.polygonHa, 2)})</span> : null}
            </Dt>
            <Dt label="Palms / trees">
              {fmtNumber(b.stands)}
              {b.areaHa ? <span className="text-slate-500"> · {Math.round(b.stands / b.areaHa)} per ha</span> : null}
            </Dt>
            <Dt label="Age">{b.ageMonths !== null ? `${b.ageMonths} months` : '-'}</Dt>
            <Dt label="Planting date">{b.plantingDate ? fmtDate(b.plantingDate) : '-'}</Dt>
            <Dt label="Expected BJR">{b.bjrKg ? `${num(b.bjrKg, 1)} kg` : '-'}</Dt>
            <Dt label="Land title">{b.landTitle ?? '-'}</Dt>
            <Dt label="Position">{b.latitude !== null ? `${num(b.latitude, 6)}, ${num(b.longitude, 6)}` : '-'}</Dt>
            <Dt label="Mature since">{b.matureDate ? fmtDate(b.matureDate) : '-'}</Dt>
          </dl>
          {b.geometry ? <PlotSketch geometry={b.geometry} /> : null}
        </Card>
        <Card title="This year" subtitle={b.ytd.lastHarvest ? `Last harvest ${fmtDate(b.ytd.lastHarvest)} (${b.ytd.daysSinceHarvest} days ago)` : 'No harvest yet'}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label="Fruit weighed">{num(b.ytd.kg / 1000, 2)} t</Dt>
            <Dt label="Yield">{b.ytd.tonPerHa !== null ? `${num(b.ytd.tonPerHa)} t/ha` : '-'}</Dt>
            <Dt label="Bunches delivered">{fmtNumber(b.ytd.bunchesDelivered)}</Dt>
            <Dt label="Actual BJR">{b.ytd.bjrActual !== null ? `${num(b.ytd.bjrActual, 2)} kg` : '-'}</Dt>
            <Dt label="Work days">
              {num(b.ytd.hk)} HK
              {b.ytd.hkPerHa !== null ? ` · ${num(b.ytd.hkPerHa)} / ha` : ''}
            </Dt>
            <Dt label="Harvester output">{b.ytd.kgPerHarvestHk !== null ? `${num(b.ytd.kgPerHarvestHk, 0)} kg / HK` : '-'}</Dt>
            <Dt label="Labour">{fmtMoney(b.ytd.labour, 0)}</Dt>
            <Dt label="Materials">{fmtMoney(b.ytd.material, 0)}</Dt>
            <Dt label="Cost per ha">{b.ytd.costPerHa !== null ? fmtMoney(b.ytd.costPerHa, 0) : '-'}</Dt>
            <Dt label="Cost per kg">{b.ytd.costPerKg !== null ? fmtMoney(b.ytd.costPerKg, 2) : '-'}</Dt>
          </dl>
        </Card>
        <Card title="Bearer plants" subtitle={b.phase === 'TBM' ? 'Cost capitalised while immature' : 'Fixed asset since the block matured'}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {b.phase === 'TBM' && <Dt label="Immature cost">{fmtMoney(b.tbmCost, 0)}</Dt>}
            {b.asset && (
              <>
                <Dt label="Asset">
                  <Link to={`/assets/${b.asset.id}`} className="text-brand-600">
                    {b.asset.code}
                  </Link>
                </Dt>
                <Dt label="Cost">{fmtMoney(b.asset.cost, 0)}</Dt>
                <Dt label="Depreciated">{fmtMoney(b.asset.accumulatedDepreciation, 0)}</Dt>
                <Dt label="Life">{Math.round(b.asset.usefulLifeMonths / 12)} years</Dt>
              </>
            )}
            {b.phase === 'TM' && !b.asset && <p className="col-span-2 text-xs text-amber-700">No bearer-plant asset: a block mature at go-live is registered under Fixed Assets.</p>}
            <Dt label="Tax cost (materials)">{fmtMoney(b.taxBasis.materials, 0)}</Dt>
            <Dt label="Labour (not for tax)">{fmtMoney(b.taxBasis.labour, 0)}</Dt>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Tax: oil palm and rubber are group 4 (20 years, straight line) from the first month of sales; labour is not part of the fiscal cost (PMK 72/2023 Art. 12-15).
          </p>
        </Card>
      </div>
      {b.monthly.length > 0 && (
        <Card title="Fruit per month" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Month</th>
                  <th className="px-2 py-2 text-right">Bunches</th>
                  <th className="px-2 py-2 text-right">Kg</th>
                  <th className="px-2 py-2 text-right">BJR</th>
                  <th className="px-4 py-2 text-right">t/ha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.monthly.map((m) => (
                  <tr key={m.month}>
                    <td className="px-4 py-2">{m.month}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(m.bunches)}</td>
                    <td className="px-2 py-2 text-right">{num(m.kg, 0)}</td>
                    <td className="px-2 py-2 text-right">{m.bunches ? num(m.kg / m.bunches, 1) : '-'}</td>
                    <td className="px-4 py-2 text-right">{num(m.tonPerHa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'work', label: `Work (${b.works.length})` },
          { value: 'materials', label: `Materials (${b.materials.length})` },
          { value: 'fruit', label: `Fruit dispatched (${b.loads.length})` },
        ]}
      />
      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          {tab === 'work' &&
            (b.works.length ? (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">BKM</th>
                    <th className="px-2 py-2 text-left">Worker</th>
                    <th className="px-2 py-2 text-left">Activity</th>
                    <th className="px-2 py-2 text-right">HK</th>
                    <th className="px-2 py-2 text-right">Output</th>
                    <th className="px-4 py-2 text-right">Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {b.works.map((w) => (
                    <tr key={w.id}>
                      <td className="px-4 py-2">{fmtDate(w.date)}</td>
                      <td className="px-2 py-2">{w.number}</td>
                      <td className="px-2 py-2">{w.employee?.fullName}</td>
                      <td className="px-2 py-2">
                        {w.activity}
                        {w.capitalised && <span className="ml-1 text-xs text-amber-700">capitalised</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{num(w.hk)}</td>
                      <td className="px-2 py-2 text-right">
                        {num(w.qty)} {UOM[w.uom] ?? w.uom}
                      </td>
                      <td className="px-4 py-2 text-right">{fmtMoney(w.amount, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No approved work on this block.</p>
            ))}
          {tab === 'materials' &&
            (b.materials.length ? (
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">BKM</th>
                    <th className="px-2 py-2 text-left">Material</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {b.materials.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2">{fmtDate(m.date)}</td>
                      <td className="px-2 py-2">{m.number}</td>
                      <td className="px-2 py-2">
                        {m.product}
                        {m.capitalised && <span className="ml-1 text-xs text-amber-700">capitalised</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {num(m.qty, 3)} {m.unit}
                      </td>
                      <td className="px-4 py-2 text-right">{fmtMoney(m.amount, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No materials used on this block.</p>
            ))}
          {tab === 'fruit' &&
            (b.loads.length ? (
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">SPB</th>
                    <th className="px-2 py-2 text-left">TPH</th>
                    <th className="px-2 py-2 text-right">Bunches</th>
                    <th className="px-2 py-2 text-right">Estimated kg</th>
                    <th className="px-4 py-2 text-right">Weighed kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {b.loads.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{fmtDate(l.date)}</td>
                      <td className="px-2 py-2">
                        {l.number} {l.status === 'DRAFT' && <Badge tone="amber">on the road</Badge>}
                      </td>
                      <td className="px-2 py-2">{l.tph ?? '-'}</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(l.bunches)}</td>
                      <td className="px-2 py-2 text-right">{num(l.estimatedKg, 0)}</td>
                      <td className="px-4 py-2 text-right">{l.status === 'WEIGHED' ? num(l.actualKg, 0) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-slate-500">No fruit dispatched from this block.</p>
            ))}
        </div>
      </Card>
      {modal === 'edit' && <BlockEditor block={b} onClose={() => setModal('')} onSaved={() => (setModal(''), refresh())} />}
      {modal === 'mature' && <MatureModal block={b} onClose={() => setModal('')} onDone={() => (setModal(''), refresh())} />}
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

/** outline of the plot (equirectangular projection, enough for a block) */
function PlotSketch({ geometry }: { geometry: unknown }) {
  const rings = useMemo(() => {
    let g = geometry as {
      type?: string;
      coordinates?: unknown;
      geometry?: unknown;
      features?: { geometry: unknown }[];
    };
    if (g?.type === 'FeatureCollection') g = g.features?.[0]?.geometry as typeof g;
    if (g?.type === 'Feature') g = g.geometry as typeof g;
    const polys = (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []) as number[][][][];
    return polys.flatMap((p) => p);
  }, [geometry]);
  if (!rings.length) return null;
  const pts = rings.flat();
  const lat0 = (pts.reduce((a, p) => a + p[1], 0) / pts.length) * (Math.PI / 180);
  const xs = pts.map((p) => p[0] * Math.cos(lat0));
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const sx = (x: number) => 5 + ((x * Math.cos(lat0) - minX) / span) * 190;
  const sy = (y: number) => 5 + ((maxY - y) / span) * 190;
  return (
    <svg viewBox="0 0 200 200" className="mt-4 h-40 w-full rounded-lg border border-line bg-emerald-50/50" role="img" aria-label="Plot boundary">
      {rings.map((r, i) => (
        <polygon
          key={i}
          points={r.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')}
          className={i === 0 ? 'fill-emerald-200/70 stroke-emerald-700' : 'fill-white stroke-emerald-700'}
          strokeWidth={1.2}
        />
      ))}
    </svg>
  );
}

function BlockEditor({ block, onClose, onSaved }: { block?: BlockDetail; onClose: () => void; onSaved: (id: string) => void }) {
  const lists = useLists();
  const [f, setF] = useState({
    siteId: block?.siteId ?? '',
    divisionId: block?.divisionId ?? '',
    code: block?.code ?? '',
    name: block?.name ?? '',
    crop: block?.crop ?? 'OIL_PALM',
    variety: block?.variety ?? '',
    plantingYear: block?.plantingYear ? String(block.plantingYear) : '',
    plantingDate: block?.plantingDate?.slice(0, 10) ?? '',
    areaHa: block ? String(block.areaHa) : '',
    stands: block ? String(block.stands) : '',
    phase: block?.phase ?? 'TBM',
    bjrKg: block?.bjrKg ? String(block.bjrKg) : '',
    landTitle: block?.landTitle ?? '',
    geometry: block?.geometry ? JSON.stringify(block.geometry) : '',
    latitude: block?.latitude !== null && block?.latitude !== undefined ? String(block.latitude) : '',
    longitude: block?.longitude !== null && block?.longitude !== undefined ? String(block.longitude) : '',
    notes: block?.notes ?? '',
    isActive: block?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!f.siteId && lists.data?.sites.length === 1) setF((x) => ({ ...x, siteId: lists.data!.sites[0].id }));
  }, [lists.data, f.siteId]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        plantingDate: f.plantingDate || null,
        geometry: f.geometry.trim() || null,
        stands: f.stands || 0,
        bjrKg: f.bjrKg || 0,
      };
      return block ? api.put<{ id: string }>(`/plantation/blocks/${block.id}`, body) : api.post<{ id: string }>('/plantation/blocks', body);
    },
    onSuccess: (r) => (toast.success('Block saved'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const divisions = (lists.data?.divisions ?? []).filter((d) => d.siteId === f.siteId);
  const readFile = (file: File | undefined) => file && file.text().then((t) => set('geometry')(t.trim()));
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={block ? `Edit block ${block.code}` : 'New block'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.siteId || !f.divisionId || !f.code.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Estate" required error={errors.siteId} help={lists.data && !lists.data.sites.length ? 'Create a farm of kind Plantation first (Farm > Farms)' : undefined}>
          <Select
            value={f.siteId}
            onChange={(e) => setF((x) => ({ ...x, siteId: e.target.value, divisionId: '' }))}
            placeholder="Choose"
            options={(lists.data?.sites ?? []).map((s) => ({
              value: s.id,
              label: `${s.code} · ${s.name}`,
            }))}
          />
        </Field>
        <Field label="Division (afdeling)" required error={errors.divisionId}>
          <Select
            value={f.divisionId}
            onChange={(e) => set('divisionId')(e.target.value)}
            placeholder="Choose"
            options={divisions.map((d) => ({
              value: d.id,
              label: `${d.code} · ${d.name}`,
            }))}
          />
        </Field>
        <Field label="Block code" required error={errors.code}>
          <Input value={f.code} maxLength={30} placeholder="A01" onChange={(e) => set('code')(e.target.value)} />
        </Field>
        <Field label="Name">
          <Input value={f.name} maxLength={150} onChange={(e) => set('name')(e.target.value)} />
        </Field>
        <Field label="Crop">
          <Select
            value={f.crop}
            onChange={(e) => set('crop')(e.target.value)}
            options={Object.entries(CROPS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Field>
        <Field label="Variety / seed source">
          <Input value={f.variety} maxLength={100} placeholder="DxP Simalungun, PPKS 540..." onChange={(e) => set('variety')(e.target.value)} />
        </Field>
        <Field label="Planting date" error={errors.plantingDate}>
          <DatePicker value={f.plantingDate} onChange={(v) => set('plantingDate')(v ?? '')} />
        </Field>
        <Field label="Planting year" help="When the exact date is not known" error={errors.plantingYear}>
          <NumberInput decimals={0} grouping={false} min={1900} max={2100} value={f.plantingYear} onChange={set('plantingYear')} />
        </Field>
        <Field label="Area (ha)" required error={errors.areaHa}>
          <NumberInput decimals={4} min={0} value={f.areaHa} onChange={set('areaHa')} />
        </Field>
        <Field label="Palms / trees standing" error={errors.stands}>
          <NumberInput decimals={0} min={0} value={f.stands} onChange={set('stands')} />
        </Field>
        <Field
          label="Phase"
          error={errors.phase}
          help={block ? 'Immature to mature with "Declare mature"' : 'A block already mature at go-live can start as Mature; register its bearer-plant asset under Fixed Assets'}
        >
          <Select
            value={f.phase}
            onChange={(e) => set('phase')(e.target.value)}
            options={Object.entries(PHASE).map(([value, p]) => ({
              value,
              label: p.label,
            }))}
          />
        </Field>
        <Field label="Expected bunch weight (BJR, kg)" help="Estimates the weight at the collection point; the weighbridge gives the actual BJR" error={errors.bjrKg}>
          <NumberInput decimals={2} min={0} max={200} value={f.bjrKg} onChange={set('bjrKg')} />
        </Field>
        <Field label="Land title (HGU / SHM / STDB)">
          <Input value={f.landTitle} maxLength={100} onChange={(e) => set('landTitle')(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude" error={errors.latitude}>
            <NumberInput decimals={7} grouping={false} allowNegative min={-90} max={90} value={f.latitude} onChange={set('latitude')} />
          </Field>
          <Field label="Longitude" error={errors.longitude}>
            <NumberInput decimals={7} grouping={false} allowNegative min={-180} max={180} value={f.longitude} onChange={set('longitude')} />
          </Field>
        </div>
        <Field
          label="Boundary (GeoJSON polygon, WGS84)"
          className="sm:col-span-2"
          error={errors.geometry}
          help="From a GPS survey or GIS (QGIS: export the block as GeoJSON). Needed for plots above 4 ha by EU buyers (EUDR); the centre is filled in when the position is empty"
        >
          <Textarea rows={3} className="font-mono text-xs" value={f.geometry} placeholder='{"type":"Polygon","coordinates":[[[101.40,0.50],...]]}' onChange={(e) => set('geometry')(e.target.value)} />
          <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="mt-1 text-xs" aria-label="Load a GeoJSON file" onChange={(e) => readFile(e.target.files?.[0])} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function MatureModal({ block, onClose, onDone }: { block: BlockDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    date: isoDate(),
    usefulLifeMonths: '240',
    taxGroupCode: 'K4',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post(`/plantation/blocks/${block.id}/mature`, f),
    onSuccess: () => (toast.success(`Block ${block.code} is mature`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const young = block.ageMonths !== null && block.ageMonths < 30;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Declare block ${block.code} mature`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Declare mature
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p>The immature cost of {fmtMoney(block.tbmCost, 0)} becomes a fixed asset (bearer plants) depreciated from this date. Later work on the block is a production cost.</p>
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Guidance for oil palm (Permentan 131/2013): usually after about 30 months, when more than 60% of the palms carry ripe bunches of about 4 kg on average. Age now: {block.ageMonths ?? '?'}{' '}
          months.
        </p>
        {young && <p className="text-xs text-amber-700">The block is younger than 30 months.</p>}
        <Field label="Date" required error={errors.date}>
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => setF((x) => ({ ...x, date: v ?? isoDate() }))} />
        </Field>
        <Field label="Useful life (months)" error={errors.usefulLifeMonths} help="Accounting life; 240 = 20 years, the tax life of group 4">
          <NumberInput decimals={0} min={12} max={600} value={f.usefulLifeMonths} onChange={(v) => setF((x) => ({ ...x, usefulLifeMonths: v }))} />
        </Field>
        <Field label="Tax group">
          <Select
            value={f.taxGroupCode}
            onChange={(e) => setF((x) => ({ ...x, taxGroupCode: e.target.value }))}
            options={[
              {
                value: 'K4',
                label: 'Group 4 - 20 years (perkebunan tanaman keras)',
              },
              { value: 'K3', label: 'Group 3 - 16 years' },
              { value: 'NONE', label: 'Not depreciable for tax' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ daily work book (BKM)
interface WorkdayRow {
  id: string;
  number: string;
  date: string;
  status: string;
  division: { name: string } | null;
  site: { name: string } | null;
  foreman: string | null;
  workers: number;
  totalHk: number;
  totalWage: number;
  totalMaterial: number;
}

export function BkmListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [divisionId, setDivisionId] = useState('');
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['plantation', 'workdays', from, to, divisionId, status],
    queryFn: () =>
      api.get<WorkdayRow[]>('/plantation/workdays', {
        from,
        to,
        divisionId: divisionId || undefined,
        status: status || undefined,
      }),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Work Book (BKM)"
        subtitle="The foreman's daily record of who worked where, on what and how much: costed to the blocks on approval, paid through payroll"
        actions={
          can('plantation.bkm.record') && (
            <Button icon="plus" onClick={() => navigate('/plantation/bkm/new')}>
              New BKM
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
        <div className="w-44">
          <Select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            placeholder="All divisions"
            options={(lists.data?.divisions ?? []).map((d) => ({
              value: d.id,
              label: `${d.code} · ${d.name}`,
            }))}
          />
        </div>
        <div className="w-36">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All"
            options={Object.entries(BKM_STATUS).map(([value, s]) => ({
              value,
              label: s.label,
            }))}
          />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="clipboard-list" title="No BKM in this period" description="Set up the divisions, blocks and field activities with their rates first" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/plantation/bkm/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {fmtDate(r.date)} · {r.division?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.foreman ? `${r.foreman} · ` : ''}
                      {r.workers} lines · {num(r.totalHk)} HK · wages {fmtMoney(r.totalWage, 0)}
                      {r.totalMaterial ? ` · materials ${fmtMoney(r.totalMaterial, 0)}` : ''}
                    </span>
                  </span>
                  <Badge tone={BKM_STATUS[r.status].tone}>{BKM_STATUS[r.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface WorkLine {
  employeeId: string | null;
  employeeName: string;
  blockId: string;
  activityId: string;
  hk: string;
  qty: string;
  tph: string;
  bunches: string;
  looseFruitKg: string;
  unripe: string;
  longStalk: string;
  looseLeft: string;
  otherFaults: string;
  notes: string;
}
interface MaterialLine {
  blockId: string;
  activityId: string;
  productId: string | null;
  productName: string;
  qty: string;
}
interface WorkdayDetail {
  id: string;
  number: string;
  status: string;
  date: string;
  divisionId: string;
  foremanId: string | null;
  warehouseId: string | null;
  notes: string | null;
  totalHk: number;
  totalWage: number;
  totalMaterial: number;
  approvedAt: string | null;
  division: { id: string; code: string; name: string } | null;
  site: { name: string } | null;
  foreman: { code: string; fullName: string } | null;
  works: {
    id: string;
    employeeId: string;
    blockId: string;
    activityId: string;
    hk: number;
    qty: number;
    tph: string | null;
    bunches: number;
    looseFruitKg: number;
    unripe: number;
    longStalk: number;
    looseLeft: number;
    otherFaults: number;
    wage: number;
    premium: number;
    penalty: number;
    amount: number;
    capitalised: boolean;
    notes: string | null;
    employee: { code: string; fullName: string } | null;
    block: { code: string; phase: string } | null;
    activity: { name: string; kind: string; uom: string } | null;
    payrollRun: string | null;
  }[];
  materials: {
    id: string;
    blockId: string;
    activityId: string | null;
    productId: string;
    qty: number;
    amount: number;
    capitalised: boolean;
    block: { code: string } | null;
    product: { code: string; name: string; unit: string } | null;
    activity: string | null;
  }[];
}
interface BlockOpt {
  id: string;
  code: string;
  phase: string;
  bjrKg: number;
  division: { id: string } | null;
  site: { id: string } | null;
}

const HARVEST_LABELS = {
  bunches: 'Bunches',
  looseFruitKg: 'Loose fruit kg',
  unripe: 'Unripe bunches',
  longStalk: 'Long-stalk bunches',
  looseLeft: 'Loose fruit left (cases)',
} as const;
const blankWork = (): WorkLine => ({
  employeeId: null,
  employeeName: '',
  blockId: '',
  activityId: '',
  hk: '1',
  qty: '',
  tph: '',
  bunches: '',
  looseFruitKg: '',
  unripe: '',
  longStalk: '',
  looseLeft: '',
  otherFaults: '',
  notes: '',
});

export function BkmPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const q = useQuery({
    queryKey: ['plantation', 'workday', id],
    queryFn: () => api.get<WorkdayDetail>(`/plantation/workdays/${id}`),
    enabled: !isNew,
  });
  const d = q.data;
  const [head, setHead] = useState({
    divisionId: '',
    date: isoDate(),
    foremanId: null as string | null,
    warehouseId: null as string | null,
    notes: '',
  });
  const [works, setWorks] = useState<WorkLine[]>([blankWork()]);
  const [mats, setMats] = useState<MaterialLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<{
    works: {
      qty: number;
      wage: number;
      premium: number;
      penalty: number;
      amount: number;
    }[];
    warnings: string[];
  } | null>(null);
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    if (!d || loaded === d.id + d.status) return;
    setLoaded(d.id + d.status);
    setHead({
      divisionId: d.divisionId,
      date: d.date.slice(0, 10),
      foremanId: d.foremanId,
      warehouseId: d.warehouseId,
      notes: d.notes ?? '',
    });
    setWorks(
      d.works.map((w) => ({
        employeeId: w.employeeId,
        employeeName: w.employee ? `${w.employee.code} - ${w.employee.fullName}` : '',
        blockId: w.blockId,
        activityId: w.activityId,
        hk: String(w.hk),
        qty: String(w.qty),
        tph: w.tph ?? '',
        bunches: String(w.bunches || ''),
        looseFruitKg: String(w.looseFruitKg || ''),
        unripe: String(w.unripe || ''),
        longStalk: String(w.longStalk || ''),
        looseLeft: String(w.looseLeft || ''),
        otherFaults: String(w.otherFaults || ''),
        notes: w.notes ?? '',
      })),
    );
    setMats(
      d.materials.map((m) => ({
        blockId: m.blockId,
        activityId: m.activityId ?? '',
        productId: m.productId,
        productName: m.product ? `${m.product.code} - ${m.product.name}` : '',
        qty: String(m.qty),
      })),
    );
    setPay({
      works: d.works.map((w) => ({
        qty: w.qty,
        wage: w.wage,
        premium: w.premium,
        penalty: w.penalty,
        amount: w.amount,
      })),
      warnings: [],
    });
  }, [d, loaded]);
  const blocks = useQuery({
    queryKey: ['plantation', 'blocks', head.divisionId, ''],
    queryFn: () =>
      api.get<BlockOpt[]>('/plantation/blocks', {
        divisionId: head.divisionId,
      }),
    enabled: !!head.divisionId,
  });
  const editable = isNew || d?.status === 'DRAFT';
  const acts = new Map((lists.data?.activities ?? []).map((a) => [a.id, a]));
  const blockOpts = (blocks.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.code} · ${b.phase}`,
  }));
  const body = () => ({
    ...head,
    works: works
      .filter((w) => w.employeeId || w.blockId || w.activityId)
      .map((w) => ({
        ...w,
        qty: w.qty || 0,
        bunches: w.bunches || 0,
        looseFruitKg: w.looseFruitKg || 0,
        unripe: w.unripe || 0,
        longStalk: w.longStalk || 0,
        looseLeft: w.looseLeft || 0,
        otherFaults: w.otherFaults || 0,
      })),
    materials: mats.filter((m) => m.productId || m.blockId).map((m) => ({ ...m, activityId: m.activityId || null })),
  });
  const onErr = (e: unknown) => (setErrors(errorsOf(e)), toast.error(e));
  const preview = useMutation({
    mutationFn: () => api.post<NonNullable<typeof pay>>(`/plantation/workdays/preview${isNew ? '' : `?id=${id}`}`, body()),
    onSuccess: (r) => (setErrors({}), setPay(r)),
    onError: onErr,
  });
  const save = useMutation({
    mutationFn: () =>
      isNew ? api.post<WorkdayDetail & { warnings: string[] }>('/plantation/workdays', body()) : api.put<WorkdayDetail & { warnings: string[] }>(`/plantation/workdays/${id}`, body()),
    onSuccess: (r) => {
      toast.success(`${r.number} saved`);
      setErrors({});
      setPay({
        works: r.works.map((w) => ({
          qty: w.qty,
          wage: w.wage,
          premium: w.premium,
          penalty: w.penalty,
          amount: w.amount,
        })),
        warnings: r.warnings,
      });
      qc.invalidateQueries({ queryKey: ['plantation'] });
      setLoaded('');
      if (isNew) navigate(`/plantation/bkm/${r.id}`, { replace: true });
    },
    onError: onErr,
  });
  const approve = useMutation({
    mutationFn: () => api.post(`/plantation/workdays/${id}/approve`),
    onSuccess: () => (toast.success('Approved: costs booked to the blocks, wages accrued'), qc.invalidateQueries({ queryKey: ['plantation'] }), setLoaded('')),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/plantation/workdays/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled'), qc.invalidateQueries({ queryKey: ['plantation'] }), navigate('/plantation/bkm')),
    onError: (e) => toast.error(e),
  });
  const setW = (i: number, k: keyof WorkLine, v: string | null) => (setWorks(works.map((w, j) => (j === i ? { ...w, [k]: v } : w))), setPay(null));
  const setM = (i: number, k: keyof MaterialLine, v: string | null) => setMats(mats.map((m, j) => (j === i ? { ...m, [k]: v } : m)));
  const totals = pay
    ? pay.works.reduce(
        (a, w) => ({
          wage: a.wage + w.amount,
          premium: a.premium + w.premium,
          penalty: a.penalty + w.penalty,
        }),
        { wage: 0, premium: 0, penalty: 0 },
      )
    : null;
  const hasHarvest = works.some((w) => acts.get(w.activityId)?.kind === 'HARVEST');
  if (!isNew && (q.isLoading || !d))
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const print = () => {
    if (!d) return;
    printHtml(`<!doctype html><html><head><title>${esc(d.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Buku Kegiatan Mandor (BKM) ${esc(d.number)}</h1>
<p>${esc(d.site?.name ?? '')} / ${esc(d.division?.name ?? '')} · ${esc(fmtDate(d.date))}${d.foreman ? ` · Foreman ${esc(d.foreman.fullName)}` : ''} · ${esc(BKM_STATUS[d.status].label)}</p>
<table><thead><tr><th>Worker</th><th>Block</th><th>Activity</th><th class="r">HK</th><th class="r">Output</th><th>TPH</th><th class="r">Bunches</th><th class="r">Faults</th><th class="r">Wage</th><th class="r">Premium</th><th class="r">Penalty</th><th class="r">Pay</th></tr></thead><tbody>
${d.works.map((w) => `<tr><td>${esc(w.employee?.fullName ?? '')}</td><td>${esc(w.block?.code ?? '')}</td><td>${esc(w.activity?.name ?? '')}</td><td class="r">${w.hk}</td><td class="r">${esc(fmtNumber(w.qty))} ${esc(UOM[w.activity?.uom ?? ''] ?? '')}</td><td>${esc(w.tph ?? '')}</td><td class="r">${w.bunches || ''}</td><td class="r">${w.unripe + w.longStalk + w.looseLeft + w.otherFaults || ''}</td><td class="r">${esc(fmtMoney(w.wage, 0))}</td><td class="r">${esc(fmtMoney(w.premium, 0))}</td><td class="r">${esc(fmtMoney(w.penalty, 0))}</td><td class="r">${esc(fmtMoney(w.amount, 0))}</td></tr>`).join('')}
<tr class="b"><td colspan="3">Total</td><td class="r">${d.totalHk}</td><td colspan="7"></td><td class="r">${esc(fmtMoney(d.totalWage, 0))}</td></tr></tbody></table>
${d.materials.length ? `<h2>Materials</h2><table><thead><tr><th>Block</th><th>Material</th><th class="r">Qty</th><th class="r">Cost</th></tr></thead><tbody>${d.materials.map((m) => `<tr><td>${esc(m.block?.code ?? '')}</td><td>${esc(m.product?.name ?? '')}</td><td class="r">${esc(fmtNumber(m.qty, 3))} ${esc(m.product?.unit ?? '')}</td><td class="r">${esc(fmtMoney(m.amount, 0))}</td></tr>`).join('')}</tbody></table>` : ''}
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:50px;text-align:center"><div style="border-top:1px solid #333;padding-top:4px">Foreman (mandor)</div><div style="border-top:1px solid #333;padding-top:4px">Clerk (kerani)</div><div style="border-top:1px solid #333;padding-top:4px">Division assistant</div></div>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/plantation/bkm')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {isNew ? 'New BKM' : `BKM ${d!.number}`}
            {d && <Badge tone={BKM_STATUS[d.status].tone}>{BKM_STATUS[d.status].label}</Badge>}
          </span>
        }
        subtitle={d ? `${d.site?.name ?? ''} / ${d.division?.name ?? ''} · ${fmtDate(d.date)}` : 'Work of one division on one day'}
        actions={
          <>
            {d && (
              <Button variant="outline" icon="printer" onClick={print}>
                Print
              </Button>
            )}
            {editable && can('plantation.bkm.record') && (
              <>
                <Button variant="outline" icon="calculator" loading={preview.isPending} disabled={!head.divisionId} onClick={() => preview.mutate()}>
                  Calculate pay
                </Button>
                <Button icon="save" loading={save.isPending} disabled={!head.divisionId} onClick={() => save.mutate()}>
                  Save draft
                </Button>
              </>
            )}
            {d?.status === 'DRAFT' && can('plantation.bkm.approve') && (
              <Button
                icon="check"
                loading={approve.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Approve ${d.number}?`,
                    message: 'Costs are booked to the blocks, wages accrued for the payroll and materials issued from the store.',
                  })) && approve.mutate()
                }
              >
                Approve
              </Button>
            )}
            {d && d.status !== 'CANCELLED' && (can('plantation.bkm.approve') || (d.status === 'DRAFT' && can('plantation.bkm.record'))) && (
              <Button
                variant="ghost"
                icon="x"
                loading={cancel.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    danger: true,
                    message: d.status === 'APPROVED' ? 'The costs, wages and materials of this BKM are reversed.' : undefined,
                    confirmText: 'Cancel BKM',
                  })) && cancel.mutate()
                }
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Division" required error={errors.divisionId}>
            <Select
              disabled={!editable}
              value={head.divisionId}
              onChange={(e) => (setHead({ ...head, divisionId: e.target.value }), setPay(null))}
              placeholder="Choose"
              options={(lists.data?.divisions ?? []).map((x) => ({
                value: x.id,
                label: `${x.code} · ${x.name}`,
              }))}
            />
          </Field>
          <Field label="Date" required error={errors.date}>
            <DatePicker disabled={!editable} value={head.date} max={isoDate()} clearable={false} onChange={(v) => setHead({ ...head, date: v ?? isoDate() })} />
          </Field>
          <Field label="Foreman (mandor)" error={errors.foremanId}>
            <AsyncSelect
              disabled={!editable}
              resource="employees"
              value={head.foremanId}
              initialLabel={d?.foreman ? `${d.foreman.code} - ${d.foreman.fullName}` : undefined}
              onChange={(v) => setHead({ ...head, foremanId: v })}
            />
          </Field>
          <Field label="Store for materials" error={errors.warehouseId}>
            <AsyncSelect disabled={!editable} resource="warehouses" value={head.warehouseId} onChange={(v) => setHead({ ...head, warehouseId: v })} />
          </Field>
        </div>
      </Card>
      {!editable && d && <WorksReadOnly d={d} />}
      {editable && (
        <Card
          title="Work"
          subtitle={
            hasHarvest
              ? 'Harvesters: bunches cut at the collection point (TPH) and the grading faults found by the foreman; output in kg uses the BJR of the block'
              : 'One line per worker, block and activity. HK: share of a work day (max 1 per worker per day)'
          }
          actions={
            editable && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setWorks([...works, blankWork()])}>
                Line
              </Button>
            )
          }
          bodyClass="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-52 px-3 py-2 text-left">Worker</th>
                  <th className="w-32 px-1 py-2 text-left">Block</th>
                  <th className="w-48 px-1 py-2 text-left">Activity</th>
                  <th className="w-16 px-1 py-2 text-right">HK</th>
                  <th className="w-28 px-1 py-2 text-right">Output</th>
                  <th className="w-24 px-1 py-2 text-left">TPH</th>
                  <th className="w-20 px-1 py-2 text-right">Bunches</th>
                  <th className="w-20 px-1 py-2 text-right">Loose kg</th>
                  <th className="w-16 px-1 py-2 text-right" title="Unripe bunches">
                    Unripe
                  </th>
                  <th className="w-16 px-1 py-2 text-right" title="Long stalk">
                    Stalk
                  </th>
                  <th className="w-16 px-1 py-2 text-right" title="Loose fruit left">
                    Left
                  </th>
                  <th className="w-28 px-2 py-2 text-right">Pay</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {works.map((w, i) => {
                  const a = acts.get(w.activityId);
                  const harvest = a?.kind === 'HARVEST';
                  const p = pay?.works[i];
                  const e = (k: string) => errors[`works.${i}.${k}`];
                  return (
                    <tr key={i} className="align-top">
                      <td className="px-3 py-1.5">
                        <AsyncSelect
                          disabled={!editable}
                          resource="employees"
                          value={w.employeeId}
                          initialLabel={w.employeeName}
                          invalid={!!e('employeeId')}
                          onChange={(v, o) => (setW(i, 'employeeId', v), setWorks((ws) => ws.map((x, j) => (j === i ? { ...x, employeeName: o?.label ?? '' } : x))))}
                          aria-label="Worker"
                        />
                        {(e('employeeId') || e('hk')) && <p className="mt-0.5 text-xs text-red-600">{e('employeeId') || e('hk')}</p>}
                      </td>
                      <td className="px-1 py-1.5">
                        <Select
                          disabled={!editable}
                          value={w.blockId}
                          invalid={!!e('blockId')}
                          onChange={(ev) => setW(i, 'blockId', ev.target.value)}
                          placeholder="-"
                          options={blockOpts}
                          aria-label="Block"
                        />
                        {e('blockId') && <p className="mt-0.5 text-xs text-red-600">{e('blockId')}</p>}
                      </td>
                      <td className="px-1 py-1.5">
                        <Select
                          disabled={!editable}
                          value={w.activityId}
                          invalid={!!e('activityId')}
                          onChange={(ev) => setW(i, 'activityId', ev.target.value)}
                          placeholder="-"
                          options={(lists.data?.activities ?? []).map((x) => ({
                            value: x.id,
                            label: x.name,
                            hint: x.wageBasis === 'PIECE' ? `${fmtMoney(x.pieceRate, 0)} / ${UOM[x.uom]}` : `${fmtMoney(x.dailyRate, 0)} / HK`,
                          }))}
                          aria-label="Activity"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <NumberInput disabled={!editable} decimals={2} min={0} max={1} value={w.hk} onChange={(v) => setW(i, 'hk', v)} aria-label="HK" />
                      </td>
                      <td className="px-1 py-1.5">
                        {harvest && (a?.uom === 'BUNCH' || a?.uom === 'KG') ? (
                          <span className="block py-2 text-right whitespace-nowrap text-slate-500">{p ? `${num(p.qty)} ${UOM[a.uom]}` : 'from bunches'}</span>
                        ) : (
                          <NumberInput
                            disabled={!editable || a?.uom === 'HK'}
                            decimals={2}
                            min={0}
                            value={w.qty}
                            onChange={(v) => setW(i, 'qty', v)}
                            aria-label={`Output ${a ? UOM[a.uom] : ''}`}
                            placeholder={a ? UOM[a.uom] : ''}
                          />
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        <Input disabled={!editable || !harvest} value={w.tph} maxLength={20} onChange={(ev) => setW(i, 'tph', ev.target.value)} aria-label="Collection point (TPH)" />
                      </td>
                      {(['bunches', 'looseFruitKg', 'unripe', 'longStalk', 'looseLeft'] as const).map((k) => (
                        <td key={k} className="px-1 py-1.5">
                          <NumberInput disabled={!editable || !harvest} decimals={k === 'looseFruitKg' ? 2 : 0} min={0} value={w[k]} onChange={(v) => setW(i, k, v)} aria-label={HARVEST_LABELS[k]} />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        {p ? (
                          <span className="block py-1" title={`wage ${fmtMoney(p.wage, 0)} + premium ${fmtMoney(p.premium, 0)} - penalty ${fmtMoney(p.penalty, 0)}`}>
                            <span className="font-medium">{fmtMoney(p.amount, 0)}</span>
                            {(p.premium > 0 || p.penalty > 0) && (
                              <span className="block text-xs text-slate-500">
                                {p.premium > 0 ? `+${fmtNumber(p.premium)}` : ''} {p.penalty > 0 ? `-${fmtNumber(p.penalty)}` : ''}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="block py-2 text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => (setWorks(works.filter((_, j) => j !== i)), setPay(null))} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {totals && (
                <tfoot className="border-t border-line bg-slate-50 text-sm font-medium">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-1 py-2 text-right">{num(works.reduce((a, w) => a + Number(w.hk || 0), 0))}</td>
                    <td colSpan={7} />
                    <td className="px-2 py-2 text-right">{fmtMoney(totals.wage, 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {errors.works && <p className="px-4 py-2 text-sm text-red-600">{errors.works}</p>}
          {pay?.warnings.length ? (
            <ul className="space-y-1 border-t border-line bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {pay.warnings.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
          {d?.works.some((w) => w.payrollRun) && (
            <p className="border-t border-line px-4 py-2 text-xs text-slate-500">Paid in payroll {[...new Set(d.works.map((w) => w.payrollRun).filter(Boolean))].join(', ')}</p>
          )}
        </Card>
      )}
      <Card
        title="Materials"
        subtitle="Fertiliser, herbicide and other stock used on the blocks: issued from the store on approval"
        actions={
          editable && (
            <Button
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() =>
                setMats([
                  ...mats,
                  {
                    blockId: '',
                    activityId: '',
                    productId: null,
                    productName: '',
                    qty: '',
                  },
                ])
              }
            >
              Material
            </Button>
          )
        }
        bodyClass="p-0"
      >
        {!mats.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No materials.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-36 px-3 py-2 text-left">Block</th>
                  <th className="w-56 px-1 py-2 text-left">Activity</th>
                  <th className="px-1 py-2 text-left">Material</th>
                  <th className="w-28 px-1 py-2 text-right">Qty</th>
                  <th className="w-28 px-2 py-2 text-right">Cost</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {mats.map((m, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">
                      <Select
                        disabled={!editable}
                        value={m.blockId}
                        invalid={!!errors[`materials.${i}.blockId`]}
                        onChange={(ev) => setM(i, 'blockId', ev.target.value)}
                        placeholder="-"
                        options={blockOpts}
                        aria-label="Block"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <Select
                        disabled={!editable}
                        value={m.activityId}
                        onChange={(ev) => setM(i, 'activityId', ev.target.value)}
                        placeholder="-"
                        options={(lists.data?.activities ?? []).map((x) => ({
                          value: x.id,
                          label: x.name,
                        }))}
                        aria-label="Activity"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <AsyncSelect
                        disabled={!editable}
                        resource="products"
                        value={m.productId}
                        initialLabel={m.productName}
                        invalid={!!errors[`materials.${i}.productId`]}
                        onChange={(v, o) =>
                          setMats(
                            mats.map((x, j) =>
                              j === i
                                ? {
                                    ...x,
                                    productId: v,
                                    productName: o?.label ?? '',
                                  }
                                : x,
                            ),
                          )
                        }
                        aria-label="Material"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <NumberInput disabled={!editable} decimals={3} min={0} value={m.qty} onChange={(v) => setM(i, 'qty', v)} aria-label="Quantity" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{d?.status === 'APPROVED' ? fmtMoney(d.materials[i]?.amount ?? 0, 0) : 'on approval'}</td>
                    <td className="py-1.5 pr-2">{editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove material" onClick={() => setMats(mats.filter((_, j) => j !== i))} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {errors.warehouseId && <p className="px-4 py-2 text-sm text-red-600">{errors.warehouseId}</p>}
      </Card>
      <Card>
        <Field label="Notes">
          <Textarea disabled={!editable} rows={2} maxLength={2000} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
        </Field>
      </Card>
    </div>
  );
}

function WorksReadOnly({ d }: { d: WorkdayDetail }) {
  const paid = [...new Set(d.works.map((w) => w.payrollRun).filter(Boolean))];
  return (
    <Card title="Work" subtitle={`${d.works.length} lines · ${num(d.totalHk)} HK · ${fmtMoney(d.totalWage, 0)}${paid.length ? ` · paid in ${paid.join(', ')}` : ''}`} bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Worker</th>
              <th className="px-2 py-2 text-left">Block</th>
              <th className="px-2 py-2 text-left">Activity</th>
              <th className="px-2 py-2 text-right">HK</th>
              <th className="px-2 py-2 text-right">Output</th>
              <th className="px-2 py-2 text-left">TPH</th>
              <th className="px-2 py-2 text-left">Grading faults</th>
              <th className="px-2 py-2 text-right">Wage</th>
              <th className="px-2 py-2 text-right">Premium</th>
              <th className="px-2 py-2 text-right">Penalty</th>
              <th className="px-4 py-2 text-right">Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.works.map((w) => {
              const faults = [w.unripe && `${w.unripe} unripe`, w.longStalk && `${w.longStalk} long stalk`, w.looseLeft && `${w.looseLeft} loose left`, w.otherFaults && `${w.otherFaults} other`]
                .filter(Boolean)
                .join(', ');
              return (
                <tr key={w.id}>
                  <td className="px-4 py-2">
                    {w.employee?.fullName} <span className="text-xs text-slate-500">{w.employee?.code}</span>
                  </td>
                  <td className="px-2 py-2">
                    {w.block?.code}
                    {w.capitalised && <span className="ml-1 text-xs text-amber-700">TBM</span>}
                  </td>
                  <td className="px-2 py-2">{w.activity?.name}</td>
                  <td className="px-2 py-2 text-right">{num(w.hk)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {num(w.qty)} {UOM[w.activity?.uom ?? ''] ?? ''}
                    {w.looseFruitKg ? <span className="block text-xs text-slate-500">+ {num(w.looseFruitKg)} kg loose</span> : null}
                  </td>
                  <td className="px-2 py-2">{w.tph ?? '-'}</td>
                  <td className="px-2 py-2 text-xs">{faults || '-'}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(w.wage, 0)}</td>
                  <td className="px-2 py-2 text-right">{w.premium ? fmtMoney(w.premium, 0) : '-'}</td>
                  <td className="px-2 py-2 text-right">{w.penalty ? fmtMoney(w.penalty, 0) : '-'}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmtMoney(w.amount, 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line bg-slate-50 font-medium">
            <tr>
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-2 py-2 text-right">{num(d.totalHk)}</td>
              <td colSpan={6} />
              <td className="px-4 py-2 text-right">{fmtMoney(d.totalWage, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ============================================================ FFB transport notes (SPB) and weighbridge
interface DispatchRow {
  id: string;
  number: string;
  date: string;
  status: string;
  site: { name: string } | null;
  division: { name: string } | null;
  vehicleNo: string | null;
  customer: string | null;
  bunches: number;
  netKg: number;
  acceptedKg: number;
  sortingPct: number;
  amount: number;
}
interface DispatchDetail {
  id: string;
  number: string;
  date: string;
  status: string;
  siteId: string;
  divisionId: string | null;
  vehicleNo: string | null;
  driver: string | null;
  customerId: string | null;
  productId: string;
  warehouseId: string;
  notes: string | null;
  ticketNo: string | null;
  weighedAt: string | null;
  grossKg: number;
  tareKg: number;
  netKg: number;
  sortingPct: number;
  sortingKg: number;
  grading:
    | (Record<string, number | null> & {
        parts?: Record<string, number>;
        pct?: number;
      })
    | null;
  acceptedKg: number;
  pricePerKg: number;
  amount: number;
  site: { name: string } | null;
  division: { name: string } | null;
  customer: { id: string; name: string; address: string | null } | null;
  product: { id: string; code: string; name: string } | null;
  warehouse: { id: string; name: string } | null;
  delivery: { id: string; number: string; status: string } | null;
  lines: {
    id: string;
    blockId: string;
    tph: string | null;
    bunches: number;
    looseFruitKg: number;
    estimatedKg: number;
    actualKg: number;
    block: { code: string; bjrKg: number } | null;
  }[];
}

export function DispatchesPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['plantation', 'dispatches', from, to, status],
    queryFn: () =>
      api.get<DispatchRow[]>('/plantation/dispatches', {
        from,
        to,
        status: status || undefined,
      }),
  });
  const rows = q.data ?? [];
  const weighed = rows.filter((r) => r.status === 'WEIGHED');
  const sum = weighed.reduce(
    (a, r) => ({
      net: a.net + r.netKg,
      acc: a.acc + r.acceptedKg,
      amt: a.amt + r.amount,
      b: a.b + r.bunches,
    }),
    { net: 0, acc: 0, amt: 0, b: 0 },
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="FFB Transport & Weighbridge"
        subtitle="Transport notes (SPB) for the fruit leaving the collection points and the mill's weighbridge ticket: net weight, sorting deduction, accepted weight"
        actions={
          can('plantation.dispatch') && (
            <Button icon="plus" onClick={() => navigate('/plantation/dispatches/new')}>
              New SPB
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
        <div className="w-40">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All"
            options={Object.entries(SPB_STATUS).map(([value, s]) => ({
              value,
              label: s.label,
            }))}
          />
        </div>
      </div>
      {weighed.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Loads weighed" value={fmtNumber(weighed.length)} hint={`${fmtNumber(sum.b)} bunches`} />
          <Stat label="Net weight" value={`${num(sum.net / 1000, 2)} t`} />
          <Stat label="Accepted" value={`${num(sum.acc / 1000, 2)} t`} hint={sum.net ? `sorting ${num(((sum.net - sum.acc) / sum.net) * 100)}%` : undefined} />
          <Stat label="Value" value={fmtMoney(sum.amt, 0)} hint={sum.acc ? `${fmtMoney(sum.amt / sum.acc, 0)} / kg` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="truck" title="No transport notes in this period" description="Make an SPB when a truck leaves with fruit; record the weighbridge ticket when the mill has weighed it" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/plantation/dispatches/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {fmtDate(r.date)} · {r.vehicleNo ?? 'no vehicle'}
                      {r.customer ? ` · ${r.customer}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.site?.name}
                      {r.division ? ` / ${r.division.name}` : ''} · {fmtNumber(r.bunches)} bunches
                      {r.status === 'WEIGHED'
                        ? ` · net ${num(r.netKg, 0)} kg · sorting ${num(r.sortingPct)}% · accepted ${num(r.acceptedKg, 0)} kg${r.amount ? ` · ${fmtMoney(r.amount, 0)}` : ''}`
                        : ''}
                    </span>
                  </span>
                  <Badge tone={SPB_STATUS[r.status].tone}>{SPB_STATUS[r.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface LoadLine {
  blockId: string;
  tph: string;
  bunches: string;
  looseFruitKg: string;
}

export function DispatchPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const q = useQuery({
    queryKey: ['plantation', 'dispatch', id],
    queryFn: () => api.get<DispatchDetail>(`/plantation/dispatches/${id}`),
    enabled: !isNew,
  });
  const d = q.data;
  const [f, setF] = useState({
    date: isoDate(),
    siteId: '',
    divisionId: '',
    vehicleNo: '',
    driver: '',
    customerId: null as string | null,
    productId: null as string | null,
    warehouseId: null as string | null,
    notes: '',
  });
  const [lines, setLines] = useState<LoadLine[]>([{ blockId: '', tph: '', bunches: '', looseFruitKg: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [weighing, setWeighing] = useState(false);
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    if (!d || loaded === d.id + d.status) return;
    setLoaded(d.id + d.status);
    setF({
      date: d.date.slice(0, 10),
      siteId: d.siteId,
      divisionId: d.divisionId ?? '',
      vehicleNo: d.vehicleNo ?? '',
      driver: d.driver ?? '',
      customerId: d.customerId,
      productId: d.productId,
      warehouseId: d.warehouseId,
      notes: d.notes ?? '',
    });
    setLines(
      d.lines.map((l) => ({
        blockId: l.blockId,
        tph: l.tph ?? '',
        bunches: String(l.bunches || ''),
        looseFruitKg: String(l.looseFruitKg || ''),
      })),
    );
  }, [d, loaded]);
  useEffect(() => {
    if (isNew && !f.siteId && lists.data?.sites.length === 1) setF((x) => ({ ...x, siteId: lists.data!.sites[0].id }));
  }, [isNew, lists.data, f.siteId]);
  const blocks = useQuery({
    queryKey: ['plantation', 'blocks', 'site', f.siteId],
    queryFn: () =>
      api.get<BlockOpt[]>('/plantation/blocks', {
        siteId: f.siteId,
        phase: 'TM',
      }),
    enabled: !!f.siteId,
  });
  const blockMap = new Map((blocks.data ?? []).map((b) => [b.id, b]));
  const editable = isNew || d?.status === 'DRAFT';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        divisionId: f.divisionId || null,
        lines: lines
          .filter((l) => l.blockId)
          .map((l) => ({
            ...l,
            bunches: l.bunches || 0,
            looseFruitKg: l.looseFruitKg || 0,
          })),
      };
      return isNew ? api.post<DispatchDetail>('/plantation/dispatches', body) : api.put<DispatchDetail>(`/plantation/dispatches/${id}`, body);
    },
    onSuccess: (r) => {
      toast.success(`${r.number} saved`);
      setErrors({});
      qc.invalidateQueries({ queryKey: ['plantation'] });
      setLoaded('');
      if (isNew) navigate(`/plantation/dispatches/${r.id}`, { replace: true });
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/plantation/dispatches/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled'), qc.invalidateQueries({ queryKey: ['plantation'] }), navigate('/plantation/dispatches')),
    onError: (e) => toast.error(e),
  });
  const estimate = lines.reduce((a, l) => a + Number(l.bunches || 0) * (blockMap.get(l.blockId)?.bjrKg ?? 0) + Number(l.looseFruitKg || 0), 0);
  if (!isNew && (q.isLoading || !d))
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const print = () => {
    if (!d) return;
    printHtml(`<!doctype html><html><head><title>${esc(d.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Surat Pengantar Buah (SPB) ${esc(d.number)}</h1>
<p>${esc(d.site?.name ?? '')}${d.division ? ` / ${esc(d.division.name)}` : ''} · ${esc(fmtDate(d.date))} · vehicle ${esc(d.vehicleNo ?? '-')} · driver ${esc(d.driver ?? '-')}${d.customer ? ` · to ${esc(d.customer.name)}` : ''}</p>
<table><thead><tr><th>Block</th><th>TPH</th><th class="r">Bunches</th><th class="r">Loose fruit kg</th><th class="r">Estimated kg</th>${d.status === 'WEIGHED' ? '<th class="r">Weighed kg</th>' : ''}</tr></thead><tbody>
${d.lines.map((l) => `<tr><td>${esc(l.block?.code ?? '')}</td><td>${esc(l.tph ?? '')}</td><td class="r">${l.bunches}</td><td class="r">${esc(fmtNumber(l.looseFruitKg))}</td><td class="r">${esc(fmtNumber(l.estimatedKg, 0))}</td>${d.status === 'WEIGHED' ? `<td class="r">${esc(fmtNumber(l.actualKg, 0))}</td>` : ''}</tr>`).join('')}
<tr class="b"><td colspan="2">Total</td><td class="r">${d.lines.reduce((a, l) => a + l.bunches, 0)}</td><td class="r">${esc(fmtNumber(d.lines.reduce((a, l) => a + l.looseFruitKg, 0)))}</td><td class="r">${esc(
      fmtNumber(
        d.lines.reduce((a, l) => a + l.estimatedKg, 0),
        0,
      ),
    )}</td>${d.status === 'WEIGHED' ? `<td class="r">${esc(fmtNumber(d.acceptedKg, 0))}</td>` : ''}</tr></tbody></table>
${d.status === 'WEIGHED' ? `<h2>Weighbridge ${esc(d.ticketNo ?? '')}</h2><table><tbody><tr><td>Gross</td><td class="r">${esc(fmtNumber(d.grossKg))} kg</td><td>Tare</td><td class="r">${esc(fmtNumber(d.tareKg))} kg</td></tr><tr><td>Net</td><td class="r">${esc(fmtNumber(d.netKg))} kg</td><td>Sorting</td><td class="r">${esc(fmtNumber(d.sortingPct))}% (${esc(fmtNumber(d.sortingKg))} kg)</td></tr><tr class="b"><td>Accepted</td><td class="r">${esc(fmtNumber(d.acceptedKg))} kg</td><td>Value</td><td class="r">${esc(fmtMoney(d.amount, 0))}</td></tr></tbody></table>` : ''}
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:50px;text-align:center"><div style="border-top:1px solid #333;padding-top:4px">Clerk (kerani)</div><div style="border-top:1px solid #333;padding-top:4px">Driver</div><div style="border-top:1px solid #333;padding-top:4px">Received (mill)</div></div>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/plantation/dispatches')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {isNew ? 'New transport note (SPB)' : `SPB ${d!.number}`}
            {d && <Badge tone={SPB_STATUS[d.status].tone}>{SPB_STATUS[d.status].label}</Badge>}
          </span>
        }
        subtitle={d ? `${d.site?.name ?? ''} · ${fmtDate(d.date)}` : 'Fruit loaded from the collection points onto one truck'}
        actions={
          <>
            {d && (
              <Button variant="outline" icon="printer" onClick={print}>
                Print
              </Button>
            )}
            {editable && can('plantation.dispatch') && (
              <Button variant={isNew ? 'primary' : 'outline'} icon="save" loading={save.isPending} disabled={!f.siteId || !f.productId || !f.warehouseId} onClick={() => save.mutate()}>
                Save
              </Button>
            )}
            {d?.status === 'DRAFT' && can('plantation.dispatch') && (
              <Button icon="scale" onClick={() => setWeighing(true)}>
                Weighbridge ticket
              </Button>
            )}
            {d && d.status !== 'CANCELLED' && can('plantation.dispatch') && (
              <Button
                variant="ghost"
                icon="x"
                loading={cancel.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    danger: true,
                    message: d.status === 'WEIGHED' ? 'The fruit leaves stock again and its draft delivery is deleted.' : undefined,
                    confirmText: 'Cancel SPB',
                  })) && cancel.mutate()
                }
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      {d?.status === 'WEIGHED' && (
        <Card title={`Weighbridge ticket ${d.ticketNo ?? ''}`} subtitle={d.weighedAt ? `Weighed ${new Date(d.weighedAt).toLocaleString('id-ID')}` : undefined}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Dt label="Gross">{num(d.grossKg, 0)} kg</Dt>
            <Dt label="Tare">{num(d.tareKg, 0)} kg</Dt>
            <Dt label="Net">{num(d.netKg, 0)} kg</Dt>
            <Dt label="Sorting deduction">
              {num(d.sortingPct)}% · {num(d.sortingKg, 0)} kg
            </Dt>
            <Dt label="Accepted">{num(d.acceptedKg, 0)} kg</Dt>
            <Dt label="Price">{d.pricePerKg ? `${fmtMoney(d.pricePerKg, 0)} / kg` : '-'}</Dt>
            <Dt label="Value">{fmtMoney(d.amount, 0)}</Dt>
            <Dt label="Delivery">
              {d.delivery ? (
                <Link to={`/documents/DO/${d.delivery.id}`} className="text-brand-600">
                  {d.delivery.number} ({d.delivery.status.toLowerCase()})
                </Link>
              ) : (
                '-'
              )}
            </Dt>
          </dl>
          {d.grading?.parts && (
            <p className="mt-3 text-xs text-slate-500">
              Grading sample:{' '}
              {Object.entries(GRADING_LABELS)
                .filter(([k]) => d.grading?.[k] !== null && d.grading?.[k] !== undefined)
                .map(([k, l]) => `${l} ${d.grading![k]}% (-${num(d.grading!.parts![k])}%)`)
                .join(' · ')}
            </p>
          )}
        </Card>
      )}
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Estate" required error={errors.siteId}>
            <Select
              disabled={!editable}
              value={f.siteId}
              onChange={(e) => setF({ ...f, siteId: e.target.value, divisionId: '' })}
              placeholder="Choose"
              options={(lists.data?.sites ?? []).map((s) => ({
                value: s.id,
                label: `${s.code} · ${s.name}`,
              }))}
            />
          </Field>
          <Field label="Division" error={errors.divisionId}>
            <Select
              disabled={!editable}
              value={f.divisionId}
              onChange={(e) => setF({ ...f, divisionId: e.target.value })}
              placeholder="Several"
              options={(lists.data?.divisions ?? []).filter((x) => x.siteId === f.siteId).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))}
            />
          </Field>
          <Field label="Date" required error={errors.date}>
            <DatePicker disabled={!editable} value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
          </Field>
          <Field label="Mill (buyer)" help="Leave empty for our own mill" error={errors.customerId}>
            <AsyncSelect disabled={!editable} resource="customers" value={f.customerId} initialLabel={d?.customer?.name} onChange={(v) => setF({ ...f, customerId: v })} />
          </Field>
          <Field label="Vehicle no." error={errors.vehicleNo}>
            <Input disabled={!editable} value={f.vehicleNo} maxLength={20} placeholder="BM 8123 XY" onChange={(e) => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Driver">
            <Input disabled={!editable} value={f.driver} maxLength={100} onChange={(e) => setF({ ...f, driver: e.target.value })} />
          </Field>
          <Field label="Fruit product" required help="e.g. TBS / FFB (kg)" error={errors.productId}>
            <AsyncSelect
              disabled={!editable}
              resource="products"
              value={f.productId}
              initialLabel={d?.product ? `${d.product.code} - ${d.product.name}` : undefined}
              onChange={(v) => setF({ ...f, productId: v })}
            />
          </Field>
          <Field label="Into warehouse" required error={errors.warehouseId}>
            <AsyncSelect disabled={!editable} resource="warehouses" value={f.warehouseId} initialLabel={d?.warehouse?.name} onChange={(v) => setF({ ...f, warehouseId: v })} />
          </Field>
        </div>
      </Card>
      <Card
        title="Fruit loaded"
        subtitle={`Estimated ${num(estimate, 0)} kg from the expected bunch weight of each block`}
        actions={
          editable && (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setLines([...lines, { blockId: '', tph: '', bunches: '', looseFruitKg: '' }])}>
              Line
            </Button>
          )
        }
        bodyClass="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-48 px-3 py-2 text-left">Block (mature)</th>
                <th className="w-28 px-1 py-2 text-left">TPH</th>
                <th className="w-28 px-1 py-2 text-right">Bunches</th>
                <th className="w-28 px-1 py-2 text-right">Loose fruit kg</th>
                <th className="w-28 px-2 py-2 text-right">Estimated kg</th>
                <th className="w-28 px-2 py-2 text-right">Weighed kg</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l, i) => {
                const b = blockMap.get(l.blockId);
                const e = errors[`lines.${i}.blockId`] || errors[`lines.${i}.bunches`];
                return (
                  <tr key={i} className="align-top">
                    <td className="px-3 py-1.5">
                      <Select
                        disabled={!editable}
                        value={l.blockId}
                        invalid={!!e}
                        onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, blockId: ev.target.value } : x)))}
                        placeholder="-"
                        options={(blocks.data ?? []).map((x) => ({
                          value: x.id,
                          label: `${x.code}${x.bjrKg ? ` · BJR ${x.bjrKg}` : ''}`,
                        }))}
                        aria-label="Block"
                      />
                      {e && <p className="mt-0.5 text-xs text-red-600">{e}</p>}
                    </td>
                    <td className="px-1 py-1.5">
                      <Input disabled={!editable} value={l.tph} maxLength={20} onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, tph: ev.target.value } : x)))} aria-label="TPH" />
                    </td>
                    <td className="px-1 py-1.5">
                      <NumberInput
                        disabled={!editable}
                        decimals={0}
                        min={0}
                        value={l.bunches}
                        onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, bunches: v } : x)))}
                        aria-label="Bunches"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <NumberInput
                        disabled={!editable}
                        decimals={2}
                        min={0}
                        value={l.looseFruitKg}
                        onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, looseFruitKg: v } : x)))}
                        aria-label="Loose fruit kg"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-500">
                      <span className="block py-2">{b ? num(Number(l.bunches || 0) * b.bjrKg + Number(l.looseFruitKg || 0), 0) : '-'}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="block py-2">{d?.status === 'WEIGHED' ? num(d.lines[i]?.actualKg, 0) : '-'}</span>
                    </td>
                    <td className="py-1.5 pr-2">{editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <Field label="Notes">
          <Textarea disabled={!editable} rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </Card>
      {weighing && d && <WeighModal d={d} onClose={() => setWeighing(false)} onDone={() => (setWeighing(false), setLoaded(''), qc.invalidateQueries({ queryKey: ['plantation'] }))} />}
    </div>
  );
}

function WeighModal({ d, onClose, onDone }: { d: DispatchDetail; onClose: () => void; onDone: () => void }) {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({
    ticketNo: '',
    weighedAt: now,
    grossKg: '',
    tareKg: '',
    mode: 'grading' as 'grading' | 'pct' | 'kg',
    sortingPct: '',
    sortingKg: '',
    pricePerKg: '',
  });
  const [g, setG] = useState<Record<string, string>>({
    unripe: '',
    overripe: '',
    empty: '',
    longStalk: '',
    looseFruit: '',
    dirty: '',
    under3kg: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const net = Number(f.grossKg || 0) - Number(f.tareKg || 0);
  const pct = f.mode === 'grading' ? gradingPct(g) : f.mode === 'pct' ? Number(f.sortingPct || 0) : net > 0 ? (Number(f.sortingKg || 0) / net) * 100 : 0;
  const sortKg = f.mode === 'kg' ? Number(f.sortingKg || 0) : Math.round(net * pct) / 100;
  const accepted = net - sortKg;
  const save = useMutation({
    mutationFn: () =>
      api.post(`/plantation/dispatches/${d.id}/weigh`, {
        ticketNo: f.ticketNo,
        weighedAt: new Date(f.weighedAt).toISOString(),
        grossKg: f.grossKg,
        tareKg: f.tareKg || 0,
        pricePerKg: f.pricePerKg || 0,
        ...(f.mode === 'grading'
          ? {
              grading: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v === '' ? null : v])),
            }
          : f.mode === 'pct'
            ? { sortingPct: f.sortingPct || 0 }
            : { sortingKg: f.sortingKg || 0 }),
      }),
    onSuccess: () => (toast.success(d.customerId ? 'Weighed: fruit in stock, draft delivery made for the mill' : 'Weighed: fruit in stock'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Weighbridge ticket for ${d.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!(net > 0) || !(accepted > 0)} onClick={() => save.mutate()}>
          Record ticket
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Ticket no." error={errors.ticketNo}>
          <Input value={f.ticketNo} maxLength={40} onChange={(e) => setF({ ...f, ticketNo: e.target.value })} />
        </Field>
        <Field label="Weighed at" required error={errors.weighedAt}>
          <Input type="datetime-local" value={f.weighedAt} max={now} onChange={(e) => setF({ ...f, weighedAt: e.target.value })} />
        </Field>
        <Field label="Gross (truck + fruit) kg" required error={errors.grossKg}>
          <NumberInput decimals={2} min={0} value={f.grossKg} onChange={(v) => setF({ ...f, grossKg: v })} />
        </Field>
        <Field label="Tare (empty truck) kg" required error={errors.tareKg}>
          <NumberInput decimals={2} min={0} value={f.tareKg} onChange={(v) => setF({ ...f, tareKg: v })} />
        </Field>
        <Field label="Sorting deduction by" className="sm:col-span-2">
          <Select
            value={f.mode}
            onChange={(e) => setF({ ...f, mode: e.target.value as typeof f.mode })}
            options={[
              {
                value: 'grading',
                label: 'Grading sample (Permentan 13/2024 deductions)',
              },
              { value: 'pct', label: 'Percentage given by the mill' },
              { value: 'kg', label: 'Kg given by the mill' },
            ]}
          />
        </Field>
        {f.mode === 'grading' && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-4">
            {Object.entries(GRADING_LABELS).map(([k, l]) => (
              <Field key={k} label={`${l} %`}>
                <NumberInput decimals={2} min={0} max={100} value={g[k]} onChange={(v) => setG({ ...g, [k]: v })} aria-label={l} />
              </Field>
            ))}
            <p className="col-span-2 text-xs text-slate-500 sm:col-span-4">
              Deduction: unripe 50%, overripe 25% of the share above 5%, empty bunches 100%, long stalks 1%, loose fruit short of 10%: 30% of the shortfall, dirty loose fruit 2x, bunches under 3 kg
              70%. Binding for purchases from partner smallholders; mills often use it otherwise.
            </p>
          </div>
        )}
        {f.mode === 'pct' && (
          <Field label="Sorting %" error={errors.sortingPct}>
            <NumberInput decimals={2} min={0} max={100} value={f.sortingPct} onChange={(v) => setF({ ...f, sortingPct: v })} />
          </Field>
        )}
        {f.mode === 'kg' && (
          <Field label="Sorting kg" error={errors.sortingKg}>
            <NumberInput decimals={2} min={0} value={f.sortingKg} onChange={(v) => setF({ ...f, sortingKg: v })} />
          </Field>
        )}
        <Field label="Price per kg" help="Agreed with the mill; also the fair value of the fruit at harvest" error={errors.pricePerKg}>
          <NumberInput decimals={2} min={0} value={f.pricePerKg} onChange={(v) => setF({ ...f, pricePerKg: v })} />
        </Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-line p-3 text-sm sm:grid-cols-4">
        <Dt label="Net">{net > 0 ? `${num(net, 0)} kg` : '-'}</Dt>
        <Dt label="Sorting">{net > 0 ? `${num(pct)}% · ${num(sortKg, 0)} kg` : '-'}</Dt>
        <Dt label="Accepted">{net > 0 ? `${num(accepted, 0)} kg` : '-'}</Dt>
        <Dt label="Value">{net > 0 && f.pricePerKg ? fmtMoney(accepted * Number(f.pricePerKg), 0) : '-'}</Dt>
      </div>
    </Modal>
  );
}

// ============================================================ reports
interface ProdRow extends Ytd {
  id: string;
  block: {
    id: string;
    code: string;
    phase: string;
    plantingYear: number | null;
    areaHa: number;
  };
  division: string;
  site: string;
}

export function ProductionPage() {
  const lists = useLists();
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(isoDate());
  const [siteId, setSiteId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const q = useQuery({
    queryKey: ['plantation', 'production', from, to, siteId, divisionId],
    queryFn: () =>
      api.get<ProdRow[]>('/plantation/production', {
        from,
        to,
        siteId: siteId || undefined,
        divisionId: divisionId || undefined,
      }),
  });
  const rows = q.data ?? [];
  const tm = rows.filter((r) => r.block.phase === 'TM');
  const t = rows.reduce(
    (a, r) => ({
      ha: a.ha + (r.block.phase === 'TM' ? r.block.areaHa : 0),
      kg: a.kg + r.kg,
      hk: a.hk + r.hk,
      cost: a.cost + r.cost,
      tmCost: a.tmCost + (r.block.phase === 'TM' ? r.cost : 0),
      bunches: a.bunches + r.bunchesDelivered,
    }),
    { ha: 0, kg: 0, hk: 0, cost: 0, tmCost: 0, bunches: 0 },
  );
  const csv = () =>
    downloadCsv(`plantation-production-${from}-${to}.csv`, [
      [
        'Estate',
        'Division',
        'Block',
        'Phase',
        'Planted',
        'Area ha',
        'Fruit kg',
        't/ha',
        'Bunches delivered',
        'BJR kg',
        'HK',
        'HK/ha',
        'Kg per harvest HK',
        'Labour',
        'Materials',
        'Cost',
        'Cost/ha',
        'Cost/kg',
        'Last harvest',
      ],
      ...rows.map((r) => [
        r.site,
        r.division,
        r.block.code,
        r.block.phase,
        r.block.plantingYear,
        r.block.areaHa,
        Math.round(r.kg),
        r.tonPerHa?.toFixed(3),
        r.bunchesDelivered,
        r.bjrActual?.toFixed(2),
        r.hk,
        r.hkPerHa?.toFixed(2),
        r.kgPerHarvestHk?.toFixed(0),
        Math.round(r.labour),
        Math.round(r.material),
        Math.round(r.cost),
        r.costPerHa?.toFixed(0),
        r.costPerKg?.toFixed(2),
        r.lastHarvest?.slice(0, 10),
      ]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Production & Cost"
        subtitle="Fruit weighed, yield per ha, bunch weight, work days and field cost per block for a period"
        actions={
          <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? firstOfYear())} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
        <div className="w-44">
          <Select
            value={siteId}
            onChange={(e) => (setSiteId(e.target.value), setDivisionId(''))}
            placeholder="All estates"
            options={(lists.data?.sites ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
        </div>
        <div className="w-44">
          <Select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            placeholder="All divisions"
            options={(lists.data?.divisions ?? []).filter((d) => !siteId || d.siteId === siteId).map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Fruit weighed" value={`${num(t.kg / 1000, 2)} t`} hint={`${tm.length} mature blocks · ${num(t.ha)} ha`} />
          <Stat label="Yield" value={t.ha ? `${num(t.kg / 1000 / t.ha)} t/ha` : '-'} hint={t.bunches ? `BJR ${num(t.kg / t.bunches, 1)} kg` : undefined} />
          <Stat label="Work days" value={`${num(t.hk, 1)} HK`} />
          <Stat label="Mature-block cost per kg" value={t.kg ? fmtMoney(t.tmCost / t.kg, 2) : '-'} hint={`field cost ${fmtMoney(t.cost, 0)}`} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="chart-column" title="No blocks" description="Set up blocks first" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Block</th>
                  <th className="px-2 py-2 text-left">Division</th>
                  <th className="px-2 py-2 text-right">Area ha</th>
                  <th className="px-2 py-2 text-right">Fruit kg</th>
                  <th className="px-2 py-2 text-right">t/ha</th>
                  <th className="px-2 py-2 text-right">BJR</th>
                  <th className="px-2 py-2 text-right">HK</th>
                  <th className="px-2 py-2 text-right">Kg / harvest HK</th>
                  <th className="px-2 py-2 text-right">Labour</th>
                  <th className="px-2 py-2 text-right">Materials</th>
                  <th className="px-2 py-2 text-right">Cost / ha</th>
                  <th className="px-2 py-2 text-right">Cost / kg</th>
                  <th className="px-4 py-2 text-right">Rotation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <Link to={`/plantation/blocks/${r.block.id}`} className="font-medium text-brand-600">
                        {r.block.code}
                      </Link>{' '}
                      <Badge tone={PHASE[r.block.phase].tone}>{r.block.phase}</Badge>
                    </td>
                    <td className="px-2 py-2">{r.division}</td>
                    <td className="px-2 py-2 text-right">{num(r.block.areaHa)}</td>
                    <td className="px-2 py-2 text-right">{r.kg ? num(r.kg, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.tonPerHa ? num(r.tonPerHa) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.bjrActual ? num(r.bjrActual, 1) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.hk ? num(r.hk, 1) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.kgPerHarvestHk ? num(r.kgPerHarvestHk, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.labour ? fmtMoney(r.labour, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.material ? fmtMoney(r.material, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.costPerHa ? fmtMoney(r.costPerHa, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.costPerKg ? fmtMoney(r.costPerKg, 2) : '-'}</td>
                    <td className={`px-4 py-2 text-right ${r.daysSinceHarvest !== null && r.daysSinceHarvest > 10 && r.block.phase === 'TM' ? 'text-amber-700' : ''}`}>
                      {r.daysSinceHarvest !== null ? `${r.daysSinceHarvest} d` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Rotation: days since the last harvest up to the end of the period (oil palm is usually harvested every 7 to 10 days). Cost per kg covers mature blocks only; immature cost is capitalised.
      </p>
    </div>
  );
}

interface CheckrollRow {
  employee: { id: string; code: string; fullName: string } | null;
  monthlySalary: number;
  days: number;
  hk: number;
  wage: number;
  premium: number;
  penalty: number;
  amount: number;
  paid: number;
  unpaid: number;
  bunches: number;
  perHk: number;
  belowMinimum: boolean;
}

export function CheckrollPage() {
  const lists = useLists();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [divisionId, setDivisionId] = useState('');
  const q = useQuery({
    queryKey: ['plantation', 'checkroll', from, to, divisionId],
    queryFn: () =>
      api.get<{
        minimumDaily: number | null;
        daysPerMonth: number;
        rows: CheckrollRow[];
      }>('/plantation/checkroll', {
        from,
        to,
        divisionId: divisionId || undefined,
      }),
  });
  const rows = q.data?.rows ?? [];
  const t = rows.reduce(
    (a, r) => ({
      hk: a.hk + r.hk,
      wage: a.wage + r.wage,
      premium: a.premium + r.premium,
      penalty: a.penalty + r.penalty,
      amount: a.amount + r.amount,
      unpaid: a.unpaid + r.unpaid,
    }),
    { hk: 0, wage: 0, premium: 0, penalty: 0, amount: 0, unpaid: 0 },
  );
  const csv = () =>
    downloadCsv(`checkroll-${from}-${to}.csv`, [
      ['Code', 'Name', 'Days', 'HK', 'Bunches', 'Wage', 'Premium', 'Penalty', 'Pay', 'Paid', 'Unpaid', 'Pay per HK', 'Below minimum'],
      ...rows.map((r) => [r.employee?.code, r.employee?.fullName, r.days, r.hk, r.bunches, r.wage, r.premium, r.penalty, r.amount, r.paid, r.unpaid, Math.round(r.perHk), r.belowMinimum ? 'yes' : '']),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Checkroll"
        subtitle={`Approved field work per worker: work days, premiums and penalties, and what payroll has paid.${q.data?.minimumDaily ? ` Minimum per HK: ${fmtMoney(q.data.minimumDaily, 0)} (minimum wage / ${q.data.daysPerMonth}).` : ''}`}
        actions={
          <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? firstOfMonth())} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
        <div className="w-44">
          <Select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            placeholder="All divisions"
            options={(lists.data?.divisions ?? []).map((d) => ({
              value: d.id,
              label: d.name,
            }))}
          />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="users" title="No approved work in this period" description="Approve the BKMs of the period first" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Worker</th>
                  <th className="px-2 py-2 text-right">Days</th>
                  <th className="px-2 py-2 text-right">HK</th>
                  <th className="px-2 py-2 text-right">Bunches</th>
                  <th className="px-2 py-2 text-right">Wage</th>
                  <th className="px-2 py-2 text-right">Premium</th>
                  <th className="px-2 py-2 text-right">Penalty</th>
                  <th className="px-2 py-2 text-right">Pay</th>
                  <th className="px-2 py-2 text-right">Per HK</th>
                  <th className="px-4 py-2 text-right">Not paid yet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.employee?.id}>
                    <td className="px-4 py-2">
                      {r.employee?.fullName} <span className="text-xs text-slate-500">{r.employee?.code}</span>
                    </td>
                    <td className="px-2 py-2 text-right">{r.days}</td>
                    <td className="px-2 py-2 text-right">{num(r.hk)}</td>
                    <td className="px-2 py-2 text-right">{r.bunches ? fmtNumber(r.bunches) : '-'}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.wage, 0)}</td>
                    <td className="px-2 py-2 text-right">{r.premium ? fmtMoney(r.premium, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.penalty ? fmtMoney(r.penalty, 0) : '-'}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.amount, 0)}</td>
                    <td className="px-2 py-2 text-right">
                      {fmtMoney(r.perHk, 0)}
                      {r.belowMinimum && (
                        <span className="ml-1">
                          <Badge tone="red">below min.</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{r.unpaid ? fmtMoney(r.unpaid, 0) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-slate-50 font-medium">
                <tr>
                  <td className="px-4 py-2">Total ({rows.length})</td>
                  <td />
                  <td className="px-2 py-2 text-right">{num(t.hk)}</td>
                  <td />
                  <td className="px-2 py-2 text-right">{fmtMoney(t.wage, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(t.premium, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(t.penalty, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(t.amount, 0)}</td>
                  <td />
                  <td className="px-4 py-2 text-right">{fmtMoney(t.unpaid, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Approved wages are paid by the next payroll run (Payroll &gt; Generate): it adds a Checkroll line to each worker's payslip. PP 36/2021: piece-rate and daily pay must not fall below the minimum
        wage.
      </p>
    </div>
  );
}
