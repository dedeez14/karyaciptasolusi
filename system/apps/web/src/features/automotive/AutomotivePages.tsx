import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  IN_STOCK: { label: 'In stock', tone: 'green' },
  RESERVED: { label: 'Reserved', tone: 'amber' },
  SOLD: { label: 'Sold', tone: 'blue' },
  CANCELLED: { label: 'Off the register', tone: 'gray' },
};
const CATEGORY: Record<string, string> = {
  PASSENGER: 'Passenger car (< 10 seats)',
  MPV: '10-15 seats',
  DOUBLE_CABIN: 'Double cabin',
  PICKUP: 'Pick-up',
  TRUCK: 'Truck',
  BUS: 'Bus',
  MOTORCYCLE: 'Motorcycle / 3-wheeler',
  GOLF: 'Golf vehicle',
  OTHER: 'Other',
};
const FUEL: Record<string, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HEV: 'Full hybrid',
  MHEV: 'Mild hybrid',
  PHEV: 'Plug-in hybrid',
  BEV: 'Battery electric',
  FCEV: 'Fuel cell electric',
  FLEXY: 'Flexy engine (BF100)',
};

interface Group {
  code: string;
  article: string;
  label: string;
  rate: number;
  basePct: number;
  basePctStage2?: number;
}
interface Meta {
  groups: Group[];
  collector: boolean;
  stage2: boolean;
  yearCode: string;
}
const useMeta = () => useQuery({ queryKey: ['automotive', 'meta'], queryFn: () => api.get<Meta>('/automotive/meta') });
const groupText = (g: Group | null | undefined, stage2 = false) =>
  g ? `${g.article}: ${g.rate}% x DPP ${fmtNumber(stage2 && g.basePctStage2 !== undefined ? g.basePctStage2 : g.basePct, 2)}%` : 'No PPnBM';

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
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

// ============================================================ vehicle types
interface Model {
  id: string;
  code: string;
  brand: string;
  model: string;
  typeName: string;
  variant: string | null;
  category: string;
  fuel: string;
  dieselEngine: boolean;
  lcgc: boolean;
  engineCc: number | null;
  motorKw: number | null;
  seats: number | null;
  kmPerL: number | null;
  co2: number | null;
  emissionCertNo: string | null;
  sutNumber: string | null;
  sutDate: string | null;
  wmi: string | null;
  requireCheckDigit: boolean;
  productId: string | null;
  luxuryGroup: string | null;
  tkdnPct: number | null;
  notes: string | null;
  isActive: boolean;
  product?: { code: string; name: string; salePrice: number } | null;
  group?: Group | null;
  units?: Record<string, number>;
}

export function ModelsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const meta = useMeta();
  const [edit, setEdit] = useState<Model | 'new' | null>(null);
  const q = useQuery({ queryKey: ['automotive', 'models'], queryFn: () => api.get<Model[]>('/automotive/models') });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicle Types"
        subtitle="One type per type-test certificate (SUT): specification, emission / fuel figures, manufacturer code (WMI) and the PPnBM group they lead to"
        actions={
          can('automotive.model.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New type
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="car" title="No vehicle types yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Specification</th>
                  <th className="px-2 py-2 text-left">SUT / WMI</th>
                  <th className="px-2 py-2 text-left">PPnBM</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-4 py-2 text-right">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEdit(m)}>
                    <td className="px-4 py-2">
                      <span className="font-medium">
                        {m.brand} {m.model} {m.typeName}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {m.code}
                        {m.variant ? ` · ${m.variant}` : ''}
                        {!m.isActive ? ' · inactive' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {CATEGORY[m.category]} · {FUEL[m.fuel]}
                      <span className="block text-slate-500">
                        {m.engineCc ? `${fmtNumber(m.engineCc, 0)} cc` : m.motorKw ? `${m.motorKw} kW` : ''}
                        {m.kmPerL ? ` · ${m.kmPerL} km/l` : ''}
                        {m.co2 ? ` · ${m.co2} g/km` : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {m.sutNumber ?? <span className="text-amber-600">No SUT</span>}
                      <span className="block text-slate-500">{m.wmi ?? '-'}</span>
                    </td>
                    <td className="px-2 py-2 text-xs">{groupText(m.group, meta.data?.stage2)}</td>
                    <td className="px-2 py-2 text-right">{m.product ? fmtMoney(m.product.salePrice, 0) : <span className="text-xs text-amber-600">No product</span>}</td>
                    <td className="px-4 py-2 text-right text-xs">
                      {Object.entries(m.units ?? {})
                        .filter(([k]) => k !== 'CANCELLED')
                        .map(([k, c]) => `${c} ${STATUS[k]?.label.toLowerCase()}`)
                        .join(', ') || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <ModelForm
          m={edit === 'new' ? undefined : edit}
          readOnly={!can('automotive.model.manage')}
          onClose={() => setEdit(null)}
          onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['automotive'] }))}
        />
      )}
    </div>
  );
}

function ModelForm({ m, readOnly, onClose, onSaved }: { m?: Model; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta();
  const [f, setF] = useState({
    code: m?.code ?? '',
    brand: m?.brand ?? '',
    model: m?.model ?? '',
    typeName: m?.typeName ?? '',
    variant: m?.variant ?? '',
    category: m?.category ?? 'PASSENGER',
    fuel: m?.fuel ?? 'PETROL',
    dieselEngine: m?.dieselEngine ?? false,
    lcgc: m?.lcgc ?? false,
    engineCc: m?.engineCc ? String(m.engineCc) : '',
    motorKw: m?.motorKw ? String(m.motorKw) : '',
    seats: m?.seats ? String(m.seats) : '',
    kmPerL: m?.kmPerL ? String(m.kmPerL) : '',
    co2: m?.co2 ? String(m.co2) : '',
    emissionCertNo: m?.emissionCertNo ?? '',
    sutNumber: m?.sutNumber ?? '',
    sutDate: m?.sutDate ?? '',
    wmi: m?.wmi ?? '',
    requireCheckDigit: m?.requireCheckDigit ?? false,
    productId: m?.productId ?? (null as string | null),
    luxuryGroup: m?.luxuryGroup ?? '',
    tkdnPct: m?.tkdnPct ? String(m.tkdnPct) : '',
    notes: m?.notes ?? '',
    isActive: m?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const body = () => ({ ...f, luxuryGroup: f.luxuryGroup || null, sutDate: f.sutDate || null });
  const suggest = useMutation({
    mutationFn: () => api.post<{ code: string | null; reason: string }>('/automotive/suggest', body()),
    onSuccess: (r) => (setF({ ...f, luxuryGroup: r.code ?? '' }), toast.success(`${r.code ?? 'No PPnBM'}: ${r.reason}`)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const save = useMutation({
    mutationFn: () => (m ? api.put<{ note: string | null }>(`/automotive/models/${m.id}`, body()) : api.post<{ note: string | null }>('/automotive/models', body())),
    onSuccess: (r) => (toast.success(r.note ? `Saved. ${r.note}` : 'Saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const g = meta.data?.groups.find((x) => x.code === f.luxuryGroup);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const electric = f.fuel === 'BEV' || f.fuel === 'FCEV';
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={m ? `${m.brand} ${m.model} ${m.typeName}` : 'New vehicle type'}
      footer={
        !readOnly && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.brand || !f.model || !f.typeName} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code" required error={errors.code}>
          <Input disabled={readOnly} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Brand" required>
          <Input disabled={readOnly} value={f.brand} maxLength={60} onChange={set('brand')} />
        </Field>
        <Field label="Model" required>
          <Input disabled={readOnly} value={f.model} maxLength={80} onChange={set('model')} />
        </Field>
        <Field label="Type" required>
          <Input disabled={readOnly} value={f.typeName} maxLength={120} onChange={set('typeName')} />
        </Field>
        <Field label="Variant">
          <Input disabled={readOnly} value={f.variant} maxLength={80} onChange={set('variant')} />
        </Field>
        <Field label="Category" required>
          <Select disabled={readOnly} value={f.category} onChange={set('category')} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Energy" required error={errors.lcgc}>
          <Select disabled={readOnly} value={f.fuel} onChange={set('fuel')} options={Object.entries(FUEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Seats">
          <NumberInput disabled={readOnly} decimals={0} min={1} value={f.seats} onChange={(v) => setF({ ...f, seats: v })} />
        </Field>
        {electric ? (
          <Field label="Motor power (kW)">
            <NumberInput disabled={readOnly} decimals={2} min={0} value={f.motorKw} onChange={(v) => setF({ ...f, motorKw: v })} />
          </Field>
        ) : (
          <Field label="Engine (cc)" error={errors.engineCc}>
            <NumberInput disabled={readOnly} decimals={0} min={0} value={f.engineCc} onChange={(v) => setF({ ...f, engineCc: v })} />
          </Field>
        )}
        <Field label="Fuel use (km/l)" help="Kemenhub test certificate">
          <NumberInput disabled={readOnly} decimals={2} min={0} value={f.kmPerL} onChange={(v) => setF({ ...f, kmPerL: v })} />
        </Field>
        <Field label="CO2 (g/km)">
          <NumberInput disabled={readOnly} decimals={2} min={0} value={f.co2} onChange={(v) => setF({ ...f, co2: v })} />
        </Field>
        <Field label="Test certificate no.">
          <Input disabled={readOnly} value={f.emissionCertNo} maxLength={60} onChange={set('emissionCertNo')} />
        </Field>
        <div className="flex flex-col justify-end gap-1 pb-1 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={readOnly} checked={f.dieselEngine} onChange={(e) => setF({ ...f, dieselEngine: e.target.checked })} /> Diesel engine (hybrid / LCGC bands)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={readOnly} checked={f.lcgc} onChange={(e) => setF({ ...f, lcgc: e.target.checked })} /> Low-cost green car (KBH2 / LCGC programme)
          </label>
        </div>
        <Field label="SUT number" help="Type test certificate (PM 33/2018)">
          <Input disabled={readOnly} value={f.sutNumber} maxLength={60} onChange={set('sutNumber')} />
        </Field>
        <Field label="SUT date">
          <DatePicker disabled={readOnly} value={f.sutDate} onChange={(v) => setF({ ...f, sutDate: v ?? '' })} />
        </Field>
        <Field label="Manufacturer code (WMI)" help="First 3 VIN characters, from the Kemenperin code letter" error={errors.wmi}>
          <Input disabled={readOnly} value={f.wmi} maxLength={3} onChange={(e) => setF({ ...f, wmi: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="TKDN %" help="EV incentives: 40% until 2026, 60% from 2027">
          <NumberInput disabled={readOnly} decimals={2} min={0} max={100} value={f.tkdnPct} onChange={(v) => setF({ ...f, tkdnPct: v })} />
        </Field>
        <Field label="Stock product" className="sm:col-span-2" help="Sales and stock run on this product; it takes the PPnBM group" error={errors.productId}>
          <AsyncSelect
            disabled={readOnly}
            resource="products"
            value={f.productId}
            initialLabel={m?.product ? `${m.product.code} - ${m.product.name}` : undefined}
            onChange={(v) => setF({ ...f, productId: v })}
          />
        </Field>
        <Field label="PPnBM group" className="sm:col-span-2" help={g ? g.label : 'Pick-ups, trucks and buses: none'} error={errors.luxuryGroup}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Select
                disabled={readOnly}
                value={f.luxuryGroup}
                onChange={set('luxuryGroup')}
                placeholder="No PPnBM"
                options={(meta.data?.groups ?? []).map((x) => ({ value: x.code, label: groupText(x, meta.data?.stage2) }))}
              />
            </div>
            {!readOnly && (
              <Button variant="outline" icon="wand-sparkles" loading={suggest.isPending} onClick={() => suggest.mutate()}>
                Suggest
              </Button>
            )}
          </div>
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={readOnly} checked={f.requireCheckDigit} onChange={(e) => setF({ ...f, requireCheckDigit: e.target.checked })} /> Position 9 of the VIN is a check digit (refuse
        VINs that fail it)
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={readOnly} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
      </label>
      <Field label="Notes" className="mt-3">
        <Textarea disabled={readOnly} rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} />
      </Field>
      <p className="mt-2 text-xs text-slate-500">The group follows the HS code mapping of PMK 141/2021 Lampiran I and the test certificate; the suggestion reads the figures above.</p>
    </Modal>
  );
}

// ============================================================ PPnBM groups
export function PpnbmPage() {
  const meta = useMeta();
  const d = meta.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="PPnBM Groups"
        subtitle="PP 73/2019 jo PP 74/2021: tax = rate x DPP (share of the selling price), charged once by the manufacturer or importer; PPN on these goods is 12% of the full price (PMK 131/2024)"
      />
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Stat label="This company charges PPnBM" value={d.collector ? 'Yes (manufacturer / importer)' : 'No (dealer)'} hint="Settings > Sales" />
            <Stat label="Tax bases in use" value={d.stage2 ? 'Stage 2 (Art. 36B)' : 'Stage 1'} hint="Stage 2 only after the Minister of Finance decision; Settings > Automotive" />
          </div>
          <Card bodyClass="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Article</th>
                  <th className="px-2 py-2 text-left">Vehicles</th>
                  <th className="px-2 py-2 text-right">Rate</th>
                  <th className="px-2 py-2 text-right">DPP</th>
                  <th className="px-2 py-2 text-right">Stage 2 DPP</th>
                  <th className="px-4 py-2 text-right">Effective</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.groups.map((g) => {
                  const base = d.stage2 && g.basePctStage2 !== undefined ? g.basePctStage2 : g.basePct;
                  return (
                    <tr key={g.code}>
                      <td className="px-4 py-2 whitespace-nowrap">{g.article}</td>
                      <td className="px-2 py-2">{g.label}</td>
                      <td className="px-2 py-2 text-right">{g.rate}%</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(g.basePct, 2)}%</td>
                      <td className="px-2 py-2 text-right">{g.basePctStage2 !== undefined ? `${fmtNumber(g.basePctStage2, 2)}%` : '-'}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmtNumber((g.rate * base) / 100, 2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-slate-500">
            Not subject to PPnBM: pick-ups, trucks, buses for goods or more than 15 people, motorcycles up to 250 cc; exempt by use (Art. 41): ambulances, hearses, fire engines, public transport,
            state protocol cars and others. No PPnBM / PPN government-borne (DTP) incentive is in force for 2026 so far (PMK 12/2025 ended 31 Dec 2025).
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================ vehicles
interface VehicleRow {
  id: string;
  vin: string;
  engineNo: string;
  colour: string;
  yearMade: number;
  status: string;
  srutNumber: string | null;
  deliveredAt: string | null;
  fakturNo: string | null;
  model: { id: string; code: string; brand: string; model: string; typeName: string } | null;
  customer: string | null;
}

export function VehiclesPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [f, setF] = useState({ status: '', modelId: '', q: '', noSrut: false });
  const [registering, setRegistering] = useState(false);
  const models = useQuery({ queryKey: ['automotive', 'models'], queryFn: () => api.get<Model[]>('/automotive/models') });
  const q = useQuery({
    queryKey: ['automotive', 'vehicles', f],
    queryFn: () => api.get<VehicleRow[]>('/automotive/vehicles', { status: f.status || undefined, modelId: f.modelId || undefined, q: f.q || undefined, noSrut: f.noSrut ? 'true' : undefined }),
  });
  const rows = q.data ?? [];
  const csv = () =>
    downloadCsv(`vehicles-${isoDate()}.csv`, [
      ['VIN', 'Engine no', 'Type', 'Colour', 'Year', 'Status', 'SRUT', 'Customer', 'Delivered', 'Faktur'],
      ...rows.map((r) => [
        r.vin,
        r.engineNo,
        r.model ? `${r.model.brand} ${r.model.model} ${r.model.typeName}` : '',
        r.colour,
        r.yearMade,
        STATUS[r.status].label,
        r.srutNumber,
        r.customer,
        r.deliveredAt,
        r.fakturNo,
      ]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicles (VIN Register)"
        subtitle="Every unit by VIN and engine number, with its SRUT: reserve it for a buyer, hand it over, give the faktur kendaraan for the BPKB"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>
              CSV
            </Button>
            {can('automotive.vehicle.manage') && (
              <Button icon="plus" onClick={() => setRegistering(true)}>
                Register vehicles
              </Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-36">
          <Select
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            placeholder="Any status"
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))}
          />
        </div>
        <div className="w-64">
          <Select
            value={f.modelId}
            onChange={(e) => setF({ ...f, modelId: e.target.value })}
            placeholder="All types"
            options={(models.data ?? []).map((m) => ({ value: m.id, label: `${m.brand} ${m.model} ${m.typeName}` }))}
          />
        </div>
        <div className="w-56">
          <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="VIN, engine or SRUT number" aria-label="Search" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.noSrut} onChange={(e) => setF({ ...f, noSrut: e.target.checked })} /> Without SRUT
        </label>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="car-front" title="No vehicles" description="Register the units of a type with their VIN and engine numbers after the goods receipt or production" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">VIN</th>
                  <th className="px-2 py-2 text-left">Engine no.</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Colour / year</th>
                  <th className="px-2 py-2 text-left">SRUT</th>
                  <th className="px-2 py-2 text-left">Customer</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((v) => (
                  <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/automotive/vehicles/${v.id}`)}>
                    <td className="px-4 py-2 font-mono">{v.vin}</td>
                    <td className="px-2 py-2 font-mono">{v.engineNo}</td>
                    <td className="px-2 py-2">{v.model ? `${v.model.brand} ${v.model.model} ${v.model.typeName}` : '-'}</td>
                    <td className="px-2 py-2">
                      {v.colour} · {v.yearMade}
                    </td>
                    <td className="px-2 py-2">{v.srutNumber ?? (v.status !== 'CANCELLED' ? <span className="text-amber-600">Missing</span> : '-')}</td>
                    <td className="px-2 py-2">{v.customer ?? '-'}</td>
                    <td className="px-4 py-2">
                      <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {registering && <RegisterModal models={models.data ?? []} onClose={() => setRegistering(false)} />}
    </div>
  );
}

function RegisterModal({ models, onClose }: { models: Model[]; onClose: () => void }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    modelId: '',
    colour: '',
    yearMade: String(year),
    modelYear: String(year),
    productionDate: '',
    warehouseId: null as string | null,
    inDocument: '',
    customsDocNo: '',
    text: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  // one unit per line: VIN, engine number[, colour][, SRUT]
  const units = f.text
    .split(/\r?\n/)
    .map((l) => l.split(/[\t,;]+/).map((x) => x.trim()))
    .filter((p) => p[0])
    .map((p) => ({ vin: p[0], engineNo: p[1] ?? '', colour: p[2] || null, srutNumber: p[3] || null }));
  const save = useMutation({
    mutationFn: () => api.post<{ registered: number; warnings: string[] }>('/automotive/vehicles', { ...f, modelYear: f.modelYear || null, productionDate: f.productionDate || null, units }),
    onSuccess: (r) => {
      toast.success(`${r.registered} vehicles registered`);
      qc.invalidateQueries({ queryKey: ['automotive'] });
      if (r.warnings.length) setWarnings(r.warnings);
      else onClose();
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const m = models.find((x) => x.id === f.modelId);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Register vehicles"
      footer={
        warnings.length ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <Button icon="check" loading={save.isPending} disabled={!f.modelId || !f.colour || !units.length} onClick={() => save.mutate()}>
            Register {units.length || ''}
          </Button>
        )
      }
    >
      {warnings.length ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium">Registered, with these warnings:</p>
          {warnings.map((w, i) => (
            <p key={i} className="text-amber-700">
              {w}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Vehicle type" required className="sm:col-span-2" error={errors.modelId}>
              <Select
                value={f.modelId}
                onChange={(e) => setF({ ...f, modelId: e.target.value })}
                placeholder="Choose"
                options={models.filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.brand} ${x.model} ${x.typeName}${x.wmi ? ` (WMI ${x.wmi})` : ''}` }))}
              />
            </Field>
            <Field label="Colour" required>
              <Input value={f.colour} maxLength={40} onChange={(e) => setF({ ...f, colour: e.target.value })} />
            </Field>
            <Field label="Year made" required error={errors.yearMade}>
              <NumberInput decimals={0} min={1950} max={2100} value={f.yearMade} onChange={(v) => setF({ ...f, yearMade: v })} />
            </Field>
            <Field label="Model year" help="Checked against VIN position 10" error={errors.modelYear}>
              <NumberInput decimals={0} min={1950} max={2100} value={f.modelYear} onChange={(v) => setF({ ...f, modelYear: v })} />
            </Field>
            <Field label="Production date">
              <DatePicker value={f.productionDate} onChange={(v) => setF({ ...f, productionDate: v ?? '' })} />
            </Field>
            <Field label="Warehouse / yard">
              <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
            </Field>
            <Field label="Came in on (GR / production no.)">
              <Input value={f.inDocument} maxLength={40} onChange={(e) => setF({ ...f, inDocument: e.target.value })} />
            </Field>
            <Field label="Customs document (CBU)" className="sm:col-span-2">
              <Input value={f.customsDocNo} maxLength={60} onChange={(e) => setF({ ...f, customsDocNo: e.target.value })} />
            </Field>
          </div>
          <Field
            label={`Units (${units.length})`}
            className="mt-3"
            help="One per line: VIN, engine number, colour (optional), SRUT number (optional); separated by tab, comma or semicolon"
            error={errors.units}
          >
            <Textarea
              rows={8}
              value={f.text}
              className="font-mono"
              placeholder={`${m?.wmi ?? 'MHK'}A1B2C3TP000123, 1NR-A123456`}
              onChange={(e) => setF({ ...f, text: e.target.value.toUpperCase() })}
            />
          </Field>
          {errors.units && <pre className="mt-2 text-xs whitespace-pre-wrap text-red-600">{errors.units}</pre>}
        </>
      )}
    </Modal>
  );
}

interface VehicleDetail {
  id: string;
  vin: string;
  engineNo: string;
  colour: string;
  yearMade: number;
  modelYear: number | null;
  productionDate: string | null;
  inDocument: string | null;
  srutNumber: string | null;
  srutDate: string | null;
  customsDocNo: string | null;
  status: string;
  deliveryNumber: string | null;
  deliveredAt: string | null;
  fakturNo: string | null;
  ownerName: string | null;
  ownerIdNo: string | null;
  ownerAddress: string | null;
  notes: string | null;
  otr: {
    offRoad: number;
    njkb: number;
    bbnkb: number;
    opsenBbnkb: number;
    pkb: number;
    opsenPkb: number;
    swdkllj: number;
    pnbp: number;
    total: number;
    bbnkbPct: number;
    pkbPct: number;
    opsenPct: number;
    njkbAssumed?: boolean;
  } | null;
  model: Model & { group: Group | null };
  vinCheck: { checkDigitOk: boolean; expected: string; yearCodeOk: boolean; wmi: string; vds: string; vis: string };
  customer: { id: string; name: string } | null;
  salesOrder: { id: string; number: string; status: string; grandTotal: number; taxTotal: number; luxuryTaxTotal: number; net: number } | null;
  invoice: { id: string; number: string; status: string } | null;
  warehouse: { name: string } | null;
}

export function VehiclePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'edit' | 'reserve' | 'deliver'>('');
  const q = useQuery({ queryKey: ['automotive', 'vehicle', id], queryFn: () => api.get<VehicleDetail>(`/automotive/vehicles/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['automotive'] }));
  const release = useMutation({
    mutationFn: () => api.post(`/automotive/vehicles/${id}/release`),
    onSuccess: () => (toast.success('Reservation released'), refresh()),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/automotive/vehicles/${id}/cancel`),
    onSuccess: () => (toast.success('Taken off the register'), refresh()),
    onError: (e) => toast.error(e),
  });
  const v = q.data;
  if (q.isLoading || !v) return <Loading />;
  const m = v.model;
  const printFaktur = () => {
    const rows: [string, string | number | null][] = [
      ['Faktur number', v.fakturNo],
      ['Date', v.deliveredAt ? fmtDate(v.deliveredAt) : ''],
      ['Owner', v.ownerName ?? v.customer?.name ?? ''],
      ['NIK / NIB', v.ownerIdNo],
      ['Address', v.ownerAddress],
      ['Make / brand', m.brand],
      ['Type', `${m.model} ${m.typeName}${m.variant ? ` ${m.variant}` : ''}`],
      ['Kind', CATEGORY[m.category]],
      ['Year of manufacture', v.yearMade],
      [m.fuel === 'BEV' || m.fuel === 'FCEV' ? 'Motor power' : 'Engine capacity', m.engineCc ? `${fmtNumber(m.engineCc, 0)} cc` : m.motorKw ? `${m.motorKw} kW` : ''],
      ['Colour', v.colour],
      ['Chassis number (VIN)', v.vin],
      ['Engine number', v.engineNo],
      ['Fuel / energy', FUEL[m.fuel]],
      ['SRUT number', v.srutNumber],
      ['SUT number', m.sutNumber],
      ['Customs document', v.customsDocNo],
    ];
    printHtml(`<!doctype html><html><head><title>Faktur ${esc(v.fakturNo ?? v.vin)}</title><style>${PRINT_CSS} td:first-child{width:35%;color:#555}</style></head><body>
<h1>Vehicle data for registration (faktur kendaraan bermotor)</h1>
<p class="muted">Data for the BPKB / STNK application (Perpol 7/2021 Art. 16-17). Attach the SRUT and the VIN certificate of the brand holder.</p>
<table>${rows.map(([k, val]) => `<tr><td>${esc(k)}</td><td class="b">${esc(val === null || val === undefined ? '-' : String(val))}</td></tr>`).join('')}</table>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/automotive/vehicles')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{v.vin}</span> <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
          </span>
        }
        subtitle={`${m.brand} ${m.model} ${m.typeName} · ${v.colour} · ${v.yearMade} · engine ${v.engineNo}`}
        actions={
          <>
            {v.status !== 'CANCELLED' && can('automotive.vehicle.manage') && (
              <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                SRUT & details
              </Button>
            )}
            {v.status === 'IN_STOCK' && can('automotive.sell') && (
              <Button icon="handshake" onClick={() => setModal('reserve')}>
                Reserve for a buyer
              </Button>
            )}
            {v.status === 'RESERVED' && can('automotive.sell') && (
              <>
                <Button icon="key-round" onClick={() => setModal('deliver')}>
                  Hand over
                </Button>
                <Button
                  variant="ghost"
                  icon="undo-2"
                  loading={release.isPending}
                  onClick={async () => (await confirm({ title: 'Release the reservation?', message: 'A draft sales order is dropped.' })) && release.mutate()}
                >
                  Release
                </Button>
              </>
            )}
            {v.status === 'SOLD' && (
              <Button variant="outline" icon="printer" onClick={printFaktur}>
                Faktur data
              </Button>
            )}
            {v.status === 'IN_STOCK' && can('automotive.vehicle.manage') && (
              <Button variant="ghost" icon="x" onClick={async () => (await confirm({ title: 'Take the vehicle off the register?', danger: true, confirmText: 'Take off' })) && cancel.mutate()}>
                Off register
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="SRUT" value={v.srutNumber ?? 'Missing'} hint={v.srutDate ? fmtDate(v.srutDate) : 'needed for the BPKB / STNK'} />
        <Stat label="PPnBM group" value={m.group ? m.group.article : 'None'} hint={m.group ? `${m.group.rate}% x DPP ${fmtNumber(m.group.basePct, 2)}%` : undefined} />
        <Stat label="Buyer" value={v.customer?.name ?? '-'} hint={v.salesOrder ? `${v.salesOrder.number} (${v.salesOrder.status.toLowerCase()})` : undefined} />
        <Stat label="Handed over" value={v.deliveredAt ? fmtDate(v.deliveredAt) : '-'} hint={v.fakturNo ? `faktur ${v.fakturNo} · ${v.deliveryNumber}` : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="VIN" subtitle="ISO 3779: manufacturer code, vehicle description, vehicle identifier">
          <div className="flex flex-wrap gap-1 font-mono text-lg">
            <span className="rounded bg-brand-50 px-2 py-1" title="WMI">
              {v.vinCheck.wmi}
            </span>
            <span className="rounded bg-slate-100 px-2 py-1" title="VDS">
              {v.vinCheck.vds}
            </span>
            <span className="rounded bg-amber-50 px-2 py-1" title="VIS">
              {v.vinCheck.vis}
            </span>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            <li>{m.wmi ? (v.vinCheck.wmi === m.wmi ? `Manufacturer code ${m.wmi} as set on the type` : `Manufacturer code differs from ${m.wmi}`) : 'No manufacturer code on the type'}</li>
            <li className={v.vinCheck.checkDigitOk ? '' : 'text-amber-700'}>
              {v.vinCheck.checkDigitOk ? 'Position 9 is a valid check digit' : `Position 9 is not the check digit (${v.vinCheck.expected})${m.requireCheckDigit ? '' : ': not required for this type'}`}
            </li>
            <li className={v.vinCheck.yearCodeOk ? '' : 'text-amber-700'}>
              {v.modelYear ? (v.vinCheck.yearCodeOk ? `Position 10 matches model year ${v.modelYear}` : `Position 10 does not match model year ${v.modelYear}`) : 'No model year'}
            </li>
          </ul>
        </Card>
        <Card title="Price" subtitle={v.otr?.njkbAssumed ? 'NJKB not given: the price was used as the tax base' : undefined}>
          {v.otr ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {v.salesOrder && (
                <>
                  <dt className="text-slate-500">Price</dt>
                  <dd className="text-right">{fmtMoney(v.salesOrder.net, 0)}</dd>
                  <dt className="text-slate-500">PPN</dt>
                  <dd className="text-right">{fmtMoney(v.salesOrder.taxTotal, 0)}</dd>
                  <dt className="text-slate-500">PPnBM</dt>
                  <dd className="text-right">{fmtMoney(v.salesOrder.luxuryTaxTotal, 0)}</dd>
                </>
              )}
              <dt className="font-medium">Off the road</dt>
              <dd className="text-right font-medium">{fmtMoney(v.otr.offRoad, 0)}</dd>
              <dt className="text-slate-500">
                BBNKB {v.otr.bbnkbPct}% of NJKB {fmtMoney(v.otr.njkb, 0)}
              </dt>
              <dd className="text-right">{fmtMoney(v.otr.bbnkb, 0)}</dd>
              <dt className="text-slate-500">Opsen BBNKB {v.otr.opsenPct}%</dt>
              <dd className="text-right">{fmtMoney(v.otr.opsenBbnkb, 0)}</dd>
              <dt className="text-slate-500">PKB {v.otr.pkbPct}% (first year)</dt>
              <dd className="text-right">{fmtMoney(v.otr.pkb, 0)}</dd>
              <dt className="text-slate-500">Opsen PKB {v.otr.opsenPct}%</dt>
              <dd className="text-right">{fmtMoney(v.otr.opsenPkb, 0)}</dd>
              <dt className="text-slate-500">SWDKLLJ</dt>
              <dd className="text-right">{fmtMoney(v.otr.swdkllj, 0)}</dd>
              <dt className="text-slate-500">STNK, TNKB, BPKB</dt>
              <dd className="text-right">{fmtMoney(v.otr.pnbp, 0)}</dd>
              <dt className="font-semibold">On the road</dt>
              <dd className="text-right font-semibold">{fmtMoney(v.otr.total, 0)}</dd>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Reserve the vehicle for a buyer to work out the on-the-road price.</p>
          )}
          {v.salesOrder && (
            <p className="mt-3 text-sm">
              <Link className="text-brand-600" to={`/documents/SO/${v.salesOrder.id}`}>
                Sales order {v.salesOrder.number}
              </Link>
              {v.invoice && (
                <>
                  {' · '}
                  <Link className="text-brand-600" to={`/documents/SI/${v.invoice.id}`}>
                    invoice {v.invoice.number}
                  </Link>
                </>
              )}
            </p>
          )}
        </Card>
      </div>
      <Card title="Details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-4">
          {[
            ['Model year', v.modelYear],
            ['Production date', v.productionDate ? fmtDate(v.productionDate) : null],
            ['Came in on', v.inDocument],
            ['Yard', v.warehouse?.name],
            ['Customs document', v.customsDocNo],
            ['SUT', m.sutNumber],
            ['Owner (registration)', v.ownerName],
            ['Owner NIK / NIB', v.ownerIdNo],
          ].map(([k, val]) => (
            <div key={k as string}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd>{val ?? '-'}</dd>
            </div>
          ))}
        </dl>
        {v.notes && <p className="mt-3 text-sm whitespace-pre-line text-slate-600">{v.notes}</p>}
      </Card>
      {modal === 'edit' && <EditVehicle v={v} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'reserve' && <ReserveModal v={v} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'deliver' && <DeliverModal v={v} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function EditVehicle({ v, onClose, onDone }: { v: VehicleDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    colour: v.colour,
    engineNo: v.engineNo,
    yearMade: String(v.yearMade),
    modelYear: v.modelYear ? String(v.modelYear) : '',
    srutNumber: v.srutNumber ?? '',
    srutDate: v.srutDate ?? '',
    customsDocNo: v.customsDocNo ?? '',
    notes: v.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/automotive/vehicles/${v.id}`, { ...f, modelYear: f.modelYear || null, srutDate: f.srutDate || null }),
    onSuccess: () => (toast.success('Saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const sold = v.status === 'SOLD';
  return (
    <Modal
      open
      onClose={onClose}
      title={`Vehicle ${v.vin}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="SRUT number" help="Per unit, issued by Ditjen Hubdat (PM 33/2018 Art. 65-68)">
          <Input disabled={sold && !!v.srutNumber} value={f.srutNumber} maxLength={60} onChange={(e) => setF({ ...f, srutNumber: e.target.value })} />
        </Field>
        <Field label="SRUT date">
          <DatePicker value={f.srutDate} onChange={(v2) => setF({ ...f, srutDate: v2 ?? '' })} />
        </Field>
        <Field label="Engine number" required error={errors.engineNo}>
          <Input disabled={sold} value={f.engineNo} maxLength={30} onChange={(e) => setF({ ...f, engineNo: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Colour" required>
          <Input value={f.colour} maxLength={40} onChange={(e) => setF({ ...f, colour: e.target.value })} />
        </Field>
        <Field label="Year made" required>
          <NumberInput disabled={sold} decimals={0} min={1950} max={2100} value={f.yearMade} onChange={(x) => setF({ ...f, yearMade: x })} />
        </Field>
        <Field label="Model year">
          <NumberInput decimals={0} min={1950} max={2100} value={f.modelYear} onChange={(x) => setF({ ...f, modelYear: x })} />
        </Field>
        <Field label="Customs document (CBU)" className="sm:col-span-2">
          <Input value={f.customsDocNo} maxLength={60} onChange={(e) => setF({ ...f, customsDocNo: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function ReserveModal({ v, onClose, onDone }: { v: VehicleDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ customerId: null as string | null, date: isoDate(), unitPrice: '', njkb: '', weighting: '1', ownerName: '', ownerIdNo: '', ownerAddress: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const price = Number(f.unitPrice || v.model.product?.salePrice || 0);
  const quote = useQuery({
    queryKey: ['automotive', 'quote', v.model.id, price, f.njkb, f.weighting],
    queryFn: () =>
      api.get<{ ppn: number; ppnbm: number; offRoad: number; otr: { bbnkb: number; opsenBbnkb: number; pkb: number; opsenPkb: number; swdkllj: number; pnbp: number; total: number } }>(
        `/automotive/models/${v.model.id}/quote`,
        { price, njkb: f.njkb || undefined, weighting: f.weighting || 1 },
      ),
    enabled: price > 0,
  });
  const save = useMutation({
    mutationFn: () => api.post(`/automotive/vehicles/${v.id}/reserve`, { ...f, unitPrice: f.unitPrice || undefined, njkb: f.njkb || null }),
    onSuccess: () => (toast.success('Reserved: draft sales order made'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const qd = quote.data;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Reserve ${v.vin}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId} onClick={() => save.mutate()}>
          Reserve
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Buyer" required className="sm:col-span-2" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={(x, o) => setF({ ...f, customerId: x, ownerName: f.ownerName || (o?.label ?? '').replace(/^.*? - /, '') })} />
        </Field>
        <Field label="Date" required>
          <DatePicker value={f.date} clearable={false} onChange={(x) => setF({ ...f, date: x ?? isoDate() })} />
        </Field>
        <Field label="Price (before tax)" help={v.model.product ? `List price ${fmtMoney(v.model.product.salePrice, 0)}` : undefined} error={errors.unitPrice}>
          <NumberInput decimals={0} min={0} value={f.unitPrice} placeholder={v.model.product ? String(v.model.product.salePrice) : ''} onChange={(x) => setF({ ...f, unitPrice: x })} />
        </Field>
        <Field label="NJKB" help="Vehicle sale value set by Permendagri: base of the BBNKB and PKB (empty = the price)">
          <NumberInput decimals={0} min={0} value={f.njkb} onChange={(x) => setF({ ...f, njkb: x })} />
        </Field>
        <Field label="PKB weighting" help="1.0 private passenger cars">
          <NumberInput decimals={3} min={0.5} max={2} value={f.weighting} onChange={(x) => setF({ ...f, weighting: x })} />
        </Field>
        <Field label="Registered owner" help="As on the BPKB (leasing buyers: the person)">
          <Input value={f.ownerName} maxLength={200} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
        </Field>
        <Field label="Owner NIK / NIB" help="Stored encrypted">
          <Input value={f.ownerIdNo} maxLength={40} onChange={(e) => setF({ ...f, ownerIdNo: e.target.value })} />
        </Field>
        <Field label="Owner address" className="sm:col-span-2">
          <Input value={f.ownerAddress} maxLength={300} onChange={(e) => setF({ ...f, ownerAddress: e.target.value })} />
        </Field>
      </div>
      {qd && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <dt className="text-slate-500">PPN</dt>
          <dd className="text-right">{fmtMoney(qd.ppn, 0)}</dd>
          <dt className="text-slate-500">PPnBM</dt>
          <dd className="text-right">{fmtMoney(qd.ppnbm, 0)}</dd>
          <dt className="text-slate-500">Off the road</dt>
          <dd className="text-right font-medium">{fmtMoney(qd.offRoad, 0)}</dd>
          <dt className="text-slate-500">BBNKB + opsen</dt>
          <dd className="text-right">{fmtMoney(qd.otr.bbnkb + qd.otr.opsenBbnkb, 0)}</dd>
          <dt className="text-slate-500">PKB + opsen</dt>
          <dd className="text-right">{fmtMoney(qd.otr.pkb + qd.otr.opsenPkb, 0)}</dd>
          <dt className="text-slate-500">SWDKLLJ + fees</dt>
          <dd className="text-right">{fmtMoney(qd.otr.swdkllj + qd.otr.pnbp, 0)}</dd>
          <dt className="font-semibold">On the road</dt>
          <dd className="text-right font-semibold">{fmtMoney(qd.otr.total, 0)}</dd>
        </dl>
      )}
      <p className="mt-2 text-xs text-slate-500">Regional rates in Settings, Automotive (UU 1/2022: BBNKB at most 12%, PKB 1.2%, opsen 66%).</p>
    </Modal>
  );
}

function DeliverModal({ v, onClose, onDone }: { v: VehicleDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fakturNo: '', deliveredAt: isoDate() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post(`/automotive/vehicles/${v.id}/deliver`, f),
    onSuccess: () => (toast.success('Handed over'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Hand over ${v.vin}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.fakturNo} onClick={() => save.mutate()}>
          Hand over
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">The delivery order of {v.salesOrder?.number} must be confirmed (the vehicle leaves the stock with it) and the SRUT number entered.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Faktur kendaraan number" required error={errors.fakturNo}>
          <Input value={f.fakturNo} maxLength={60} onChange={(e) => setF({ ...f, fakturNo: e.target.value })} />
        </Field>
        <Field label="Handed over on" required>
          <DatePicker value={f.deliveredAt} max={isoDate()} clearable={false} onChange={(x) => setF({ ...f, deliveredAt: x ?? isoDate() })} />
        </Field>
      </div>
    </Modal>
  );
}
