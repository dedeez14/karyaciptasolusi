import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'Available', tone: 'green' },
  BOOKED: { label: 'Booked', tone: 'amber' },
  SOLD: { label: 'Sold', tone: 'gray' },
  ACTIVE: { label: 'In progress', tone: 'blue' },
  HANDED_OVER: { label: 'Handed over', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const PPN: Record<string, string> = { STANDARD: 'PPN 11/12', DTP: 'PPN DTP (PMK 90/2025)', EXEMPT: 'PPN exempt (simple house)', NONE: 'No PPN' };
const SCHEME: Record<string, string> = { CASH: 'Cash (tunai keras)', INSTALMENT: 'Instalments (cicilan bertahap)', KPR: 'Mortgage (KPR)' };

// ============================================================ sites and units
interface Site {
  id: string;
  projectId: string;
  code: string;
  name: string;
  kind: string;
  address: string | null;
  estimatedCost: number;
  isActive: boolean;
  notes: string | null;
  project: { code: string; name: string } | null;
  units: number;
  available: number;
  booked: number;
  sold: number;
  listValue: number;
  costReleased: number;
  inventory: number;
}
interface Unit {
  id: string;
  siteId: string;
  code: string;
  unitType: string | null;
  landArea: number;
  buildingArea: number;
  price: number;
  ppnMode: string;
  pphRate: number;
  readyToOccupy: boolean;
  cost: number;
  certificateNo: string | null;
  status: string;
  notes: string | null;
  site: { code: string; name: string };
  sale: { id: string; number: string; status: string; customer: string | null } | null;
}
interface UnitRow {
  id?: string;
  code: string;
  unitType: string;
  landArea: string;
  buildingArea: string;
  price: string;
  ppnMode: string;
  pphRate: string;
  readyToOccupy: boolean;
  cost: string;
  certificateNo: string;
  status: string;
  sale?: Unit['sale'];
}
const toRow = (u: Unit): UnitRow => ({
  id: u.id,
  code: u.code,
  unitType: u.unitType ?? '',
  landArea: str(u.landArea),
  buildingArea: str(u.buildingArea),
  price: str(u.price),
  ppnMode: u.ppnMode,
  pphRate: str(u.pphRate),
  readyToOccupy: u.readyToOccupy,
  cost: str(u.cost),
  certificateNo: u.certificateNo ?? '',
  status: u.status,
  sale: u.sale,
});

export function UnitsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const sites = useQuery({ queryKey: ['property', 'sites'], queryFn: () => api.get<Site[]>('/property/sites') });
  const [siteId, setSiteId] = useState('');
  const [editSite, setEditSite] = useState<Site | 'new' | null>(null);
  const current = sites.data?.find((s) => s.id === siteId) ?? sites.data?.[0];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Sites, Units & Prices"
        subtitle="Price list per unit with its PPN treatment and PPh final rate; the estimated cost of the site spread over the units by relative sales value, charged to cost of sales at the handover"
        actions={
          can('property.manage') && (
            <Button icon="plus" onClick={() => setEditSite('new')}>
              New site
            </Button>
          )
        }
      />
      {sites.isLoading ? (
        <Loading />
      ) : !sites.data?.length ? (
        <Card>
          <EmptyState icon="building-2" title="No sites" description="Add a site for a project: its land and development invoices (product RE-DEV) go to Real Estate Inventory" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {sites.data.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSiteId(s.id)}
                className={`rounded-lg border bg-white p-4 text-left text-sm ${current?.id === s.id ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line'}`}
              >
                <span className="block font-medium">
                  {s.code} · {s.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {s.units} units: {s.available} available, {s.booked} booked, {s.sold} sold · project {s.project?.code}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  inventory {fmtMoney(s.inventory, 0)} · estimate {fmtMoney(s.estimatedCost, 0)} · released {fmtMoney(s.costReleased, 0)}
                </span>
              </button>
            ))}
          </div>
          {current && <UnitsEditor key={current.id} site={current} onEditSite={() => setEditSite(current)} />}
        </>
      )}
      {editSite && (
        <SiteForm
          s={editSite === 'new' ? undefined : editSite}
          onClose={() => setEditSite(null)}
          onSaved={(id) => (setEditSite(null), setSiteId(id), qc.invalidateQueries({ queryKey: ['property'] }))}
        />
      )}
    </div>
  );
}

function UnitsEditor({ site, onEditSite }: { site: Site; onEditSite: () => void }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const ro = !can('property.manage');
  const q = useQuery({ queryKey: ['property', 'units', site.id], queryFn: () => api.get<Unit[]>('/property/units', { siteId: site.id }) });
  const [rows, setRows] = useState<UnitRow[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const data = rows ?? q.data?.map(toRow) ?? [];
  const set = (i: number, patch: Partial<UnitRow>) => setRows(data.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = useMutation({
    mutationFn: () =>
      api.put<Unit[]>(`/property/sites/${site.id}/units`, {
        units: data.map((r) => ({
          id: r.id ?? null,
          code: r.code,
          unitType: r.unitType,
          landArea: r.landArea || 0,
          buildingArea: r.buildingArea || 0,
          price: r.price,
          ppnMode: r.ppnMode,
          pphRate: r.pphRate || 0,
          readyToOccupy: r.readyToOccupy,
          cost: r.cost || 0,
          certificateNo: r.certificateNo,
        })),
      }),
    onSuccess: () => (toast.success('Units saved'), setRows(null), setErrors({}), qc.invalidateQueries({ queryKey: ['property'] })),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const allocate = useMutation({
    mutationFn: () => api.post(`/property/sites/${site.id}/allocate`),
    onSuccess: () => (toast.success('Cost spread over the units'), setRows(null), qc.invalidateQueries({ queryKey: ['property'] })),
    onError: (e) => toast.error(e),
  });
  const errs = Object.entries(errors);
  return (
    <Card
      title={`${site.code} · ${site.name} units`}
      bodyClass="p-0"
      actions={
        <div className="flex flex-wrap gap-2">
          {!ro && (
            <Button size="sm" variant="ghost" icon="pencil" onClick={onEditSite}>
              Site
            </Button>
          )}
          {!ro && (
            <Button
              size="sm"
              variant="outline"
              icon="split"
              loading={allocate.isPending}
              disabled={!!rows}
              onClick={async () =>
                (await confirm({
                  title: 'Spread the estimated cost?',
                  message: `${fmtMoney(site.estimatedCost, 0)} less what the units handed over took, over the other units by their price.`,
                  confirmText: 'Spread',
                })) && allocate.mutate()
              }
            >
              Spread cost
            </Button>
          )}
          {!ro && (
            <Button size="sm" icon="save" loading={save.isPending} disabled={!rows} onClick={() => save.mutate()}>
              Save units
            </Button>
          )}
        </div>
      }
    >
      {errs.length > 0 && (
        <ul className="px-4 pt-3 text-xs text-red-600">
          {errs.map(([k, v]) => (
            <li key={k}>{v}</li>
          ))}
        </ul>
      )}
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-16 px-3 py-2 text-left">Unit</th>
                <th className="w-20 px-2 py-2 text-left">Type</th>
                <th className="w-16 px-2 py-2 text-left">Land m²</th>
                <th className="w-16 px-2 py-2 text-left">Bldg m²</th>
                <th className="w-32 px-2 py-2 text-left">Price (before PPN)</th>
                <th className="w-40 px-2 py-2 text-left">PPN</th>
                <th className="w-24 px-2 py-2 text-left">PPh final</th>
                <th className="w-28 px-2 py-2 text-left">Cost</th>
                <th className="w-24 px-2 py-2 text-left">Certificate</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((r, i) => {
                const lock = ro || r.status !== 'AVAILABLE';
                return (
                  <tr key={r.id ?? `n${i}`} className="align-top">
                    <td className="px-3 py-1.5">
                      <Input disabled={ro || r.status === 'SOLD'} value={r.code} maxLength={30} onChange={(e) => set(i, { code: e.target.value })} aria-label="Unit" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input disabled={ro} value={r.unitType} maxLength={60} onChange={(e) => set(i, { unitType: e.target.value })} aria-label="Type" />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput disabled={ro} decimals={2} min={0} value={r.landArea} onChange={(v) => set(i, { landArea: v })} aria-label="Land area" />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput disabled={ro} decimals={2} min={0} value={r.buildingArea} onChange={(v) => set(i, { buildingArea: v })} aria-label="Building area" />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput disabled={lock} decimals={0} min={0} value={r.price} onChange={(v) => set(i, { price: v })} aria-label="Price" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        disabled={lock}
                        value={r.ppnMode}
                        onChange={(e) => set(i, { ppnMode: e.target.value })}
                        options={Object.entries(PPN).map(([value, label]) => ({ value, label }))}
                        aria-label="PPN"
                      />
                      {r.ppnMode === 'DTP' && (
                        <label className="mt-1 flex items-center gap-1 text-xs">
                          <input type="checkbox" disabled={lock} checked={r.readyToOccupy} onChange={(e) => set(i, { readyToOccupy: e.target.checked })} /> ready to occupy
                        </label>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        disabled={lock}
                        value={String(Number(r.pphRate || 0))}
                        onChange={(e) => set(i, { pphRate: e.target.value })}
                        options={[
                          { value: '2.5', label: '2.5%' },
                          { value: '1', label: '1% simple' },
                          { value: '0', label: '0%' },
                        ]}
                        aria-label="PPh final"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput disabled={ro || r.status === 'SOLD'} decimals={0} min={0} value={r.cost} onChange={(v) => set(i, { cost: v })} aria-label="Cost" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input disabled={ro} value={r.certificateNo} maxLength={60} onChange={(e) => set(i, { certificateNo: e.target.value })} aria-label="Certificate" />
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      {r.sale && (
                        <Link className="mt-1 block text-xs text-brand-600" to={`/property/sales/${r.sale.id}`}>
                          {r.sale.number} · {r.sale.customer}
                        </Link>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">{!lock && <Button variant="ghost" size="icon" icon="x" aria-label="Remove unit" onClick={() => setRows(data.filter((_, j) => j !== i))} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!ro && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            icon="plus"
            onClick={() =>
              setRows([
                ...data,
                { code: '', unitType: '', landArea: '', buildingArea: '', price: '', ppnMode: 'STANDARD', pphRate: '2.5', readyToOccupy: false, cost: '', certificateNo: '', status: 'AVAILABLE' },
              ])
            }
          >
            Unit
          </Button>
          <span className="ml-3 text-xs text-slate-500">
            PPN DTP: houses up to Rp5 bn, new and ready to occupy, PPN borne on the price up to Rp2 bn. Exempt: simple houses within the price limits (code 08).
          </span>
        </div>
      )}
    </Card>
  );
}

function SiteForm({ s, onClose, onSaved }: { s?: Site; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    projectId: s?.projectId ?? (null as string | null),
    code: s?.code ?? '',
    name: s?.name ?? '',
    kind: s?.kind ?? 'HOUSE',
    address: s?.address ?? '',
    estimatedCost: str(s?.estimatedCost ?? 0),
    isActive: s?.isActive ?? true,
    notes: s?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (s ? api.put<Site>(`/property/sites/${s.id}`, f) : api.post<Site>('/property/sites', f)),
    onSuccess: (r) => (toast.success('Site saved'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={s ? `Site ${s.code}` : 'New site'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.projectId || !f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project" required error={errors.projectId} help="Costs booked to this project are the site's">
          <AsyncSelect resource="projects" value={f.projectId} initialLabel={s?.project ? `${s.project.code} - ${s.project.name}` : undefined} onChange={(v) => setF({ ...f, projectId: v })} />
        </Field>
        <Field label="Kind">
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'HOUSE', label: 'Landed houses' },
              { value: 'APARTMENT', label: 'Apartments (rusun)' },
              { value: 'SHOPHOUSE', label: 'Shophouses' },
              { value: 'LAND', label: 'Land lots' },
            ]}
          />
        </Field>
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required>
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Estimated total cost (land + development)" error={errors.estimatedCost}>
          <NumberInput decimals={0} min={0} value={f.estimatedCost} onChange={(v) => setF({ ...f, estimatedCost: v })} />
        </Field>
        <div className="pt-6">
          <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ sales
interface SaleRow {
  id: string;
  number: string;
  date: string;
  status: string;
  scheme: string;
  ppnMode: string;
  price: number;
  unit: { code: string; site: string; siteName: string } | null;
  customer: string | null;
  invoiced: number;
  paid: number;
  dueNotInvoiced: number;
  handoverDate: string | null;
}

export function SalesPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'HANDED_OVER' | 'CANCELLED'>('ACTIVE');
  const [book, setBook] = useState(false);
  const q = useQuery({ queryKey: ['property', 'sales', status], queryFn: () => api.get<SaleRow[]>('/property/sales', status === 'ALL' ? {} : { status }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Unit Sales"
        subtitle="Booking, payment schedule, PPJB, AJB and handover; payments before the handover are buyer deposits, recognised as sales when the unit is handed over"
        actions={
          can('property.sell') && (
            <Button icon="plus" onClick={() => setBook(true)}>
              Book a unit
            </Button>
          )
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'ACTIVE', label: 'In progress' },
          { value: 'HANDED_OVER', label: 'Handed over' },
          { value: 'CANCELLED', label: 'Cancelled' },
          { value: 'ALL', label: 'All' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="key-round" title="No sales" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((s) => (
              <li key={s.id}>
                <Link to={`/property/sales/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.number} · {s.unit?.site} {s.unit?.code} · {s.customer}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(s.date)} · {SCHEME[s.scheme]} · {PPN[s.ppnMode]} · {fmtMoney(s.price, 0)}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    invoiced {fmtMoney(s.invoiced, 0)} · paid {fmtMoney(s.paid, 0)}
                    {s.dueNotInvoiced > 0 && <span className="block text-amber-700">due, not invoiced {fmtMoney(s.dueNotInvoiced, 0)}</span>}
                  </span>
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {book && <BookForm onClose={() => setBook(false)} onBooked={(id) => navigate(`/property/sales/${id}`)} />}
    </div>
  );
}

function BookForm({ onClose, onBooked }: { onClose: () => void; onBooked: (id: string) => void }) {
  const units = useQuery({ queryKey: ['property', 'units', 'all'], queryFn: () => api.get<Unit[]>('/property/units') });
  const [f, setF] = useState({
    unitId: '',
    customerId: null as string | null,
    date: isoDate(),
    price: '',
    scheme: 'INSTALMENT',
    bookingFee: '',
    dpPct: '20',
    dpCount: '1',
    instalmentCount: '12',
    startDate: isoDate(),
    kprBank: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = units.data?.find((u) => u.id === f.unitId);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/property/sales', { ...f, price: f.price || null, bookingFee: f.bookingFee || 0 }),
    onSuccess: (r) => (toast.success(`${r.number} booked`), onBooked(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Book a unit"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.unitId || !f.customerId} onClick={() => save.mutate()}>
          Book and make the schedule
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Unit" required error={errors.unitId} className="sm:col-span-2">
          <Select
            value={f.unitId}
            placeholder="Choose an available unit"
            onChange={(e) => setF({ ...f, unitId: e.target.value })}
            options={(units.data ?? [])
              .filter((u) => u.status === 'AVAILABLE')
              .map((u) => ({ value: u.id, label: `${u.site.code} ${u.code}${u.unitType ? ` (${u.unitType})` : ''} · ${fmtMoney(u.price, 0)} · ${PPN[u.ppnMode]}` }))}
          />
        </Field>
        <Field label="Buyer" required error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Booking date" required>
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Price before PPN" help={unit ? `List price ${fmtMoney(unit.price, 0)}` : undefined}>
          <NumberInput decimals={0} min={0} value={f.price} placeholder={unit ? String(unit.price) : ''} onChange={(v) => setF({ ...f, price: v })} />
        </Field>
        <Field label="Scheme">
          <Select value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })} options={Object.entries(SCHEME).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Booking fee (tanda jadi)">
          <NumberInput decimals={0} min={0} value={f.bookingFee} onChange={(v) => setF({ ...f, bookingFee: v })} />
        </Field>
        <Field label={f.scheme === 'CASH' ? 'Full payment due' : 'First down payment due'}>
          <DatePicker value={f.startDate} clearable={false} onChange={(v) => setF({ ...f, startDate: v ?? isoDate() })} />
        </Field>
        {f.scheme !== 'CASH' && (
          <>
            <Field label="Down payment % (incl. booking fee)">
              <NumberInput decimals={2} min={0} max={100} value={f.dpPct} onChange={(v) => setF({ ...f, dpPct: v })} />
            </Field>
            <Field label="Down payment in (months)">
              <NumberInput decimals={0} min={1} max={60} value={f.dpCount} onChange={(v) => setF({ ...f, dpCount: v })} />
            </Field>
          </>
        )}
        {f.scheme === 'INSTALMENT' && (
          <Field label="Instalments (months)">
            <NumberInput decimals={0} min={1} max={240} value={f.instalmentCount} onChange={(v) => setF({ ...f, instalmentCount: v })} />
          </Field>
        )}
        {f.scheme === 'KPR' && (
          <Field label="Mortgage bank" required error={errors.kprBank}>
            <Input value={f.kprBank} maxLength={100} onChange={(e) => setF({ ...f, kprBank: e.target.value })} />
          </Field>
        )}
      </div>
      {errors.lines && <p className="mt-2 text-xs text-red-600">{errors.lines}</p>}
      <p className="mt-3 text-xs text-slate-500">The schedule can be changed on the sale while its lines are not invoiced.</p>
    </Modal>
  );
}

interface SaleLineD {
  id: string;
  seq: number;
  kind: string;
  label: string;
  dueDate: string;
  amount: number;
  invoice: { id: string; number: string; status: string; grandTotal: number; taxTotal: number; paidAmount: number } | null;
}
interface Sale {
  id: string;
  number: string;
  date: string;
  status: string;
  scheme: string;
  ppnMode: string;
  price: number;
  dtpBase: number;
  pphRate: number;
  kprBank: string | null;
  ppjbNo: string | null;
  ppjbDate: string | null;
  ajbNo: string | null;
  ajbDate: string | null;
  notary: string | null;
  handoverDate: string | null;
  cost: number;
  cancelReason: string | null;
  forfeit: number;
  refund: number;
  refundDue: string | null;
  unit: { id: string; code: string; unitType: string | null; landArea: number; buildingArea: number; readyToOccupy: boolean; cost: number; site: { code: string; name: string } };
  customer: { code: string; name: string } | null;
  lines: SaleLineD[];
  totals: { invoiced: number; ppn: number; billed: number; paid: number; notInvoiced: number; bphtbEstimate: number; pphFinal: number };
}

export function SalePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['property', 'sale', id], queryFn: () => api.get<Sale>(`/property/sales/${id}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <EmptyState icon="key-round" title="Sale not found" />;
  return <SaleView key={`${q.data.id}-${q.data.status}-${q.data.lines.map((l) => `${l.id}:${l.invoice?.id ?? ''}:${l.dueDate}`).join(',')}`} s={q.data} />;
}

function SaleView({ s }: { s: Sale }) {
  const can = useSession((x) => x.can);
  const qc = useQueryClient();
  const [lines, setLines] = useState(s.lines.map((l) => ({ ...l, dueDate: l.dueDate, amountS: str(l.amount) })));
  const [dirty, setDirty] = useState(false);
  const [deed, setDeed] = useState<'ppjb' | 'ajb' | 'handover' | 'cancel' | null>(null);
  const [d, setD] = useState({ no: '', date: isoDate(), notary: s.notary ?? '', reason: 'BUYER', forfeitPct: '10', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['property'] });
  const act = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api.post<Sale & { made?: string[] }>(`/property/sales/${s.id}/${a.path}`, a.body ?? {}),
    onSuccess: (r) => (toast.success(r.made?.length ? `Invoiced: ${r.made.join(', ')}` : 'Done'), setDeed(null), refresh()),
    onError: (e) => toast.error(e),
  });
  const schedule = useMutation({
    mutationFn: () => api.put(`/property/sales/${s.id}/schedule`, { lines: lines.map((l) => ({ id: l.id || null, kind: l.kind, label: l.label, dueDate: l.dueDate, amount: l.amountS })) }),
    onSuccess: () => (toast.success('Schedule saved'), setDirty(false), setErrors({}), refresh()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const active = s.status === 'ACTIVE';
  const sell = active && can('property.sell');
  const hand = can('property.handover');
  const sum = lines.reduce((a, l) => a + num(l.amountS), 0);
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => (setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x))), setDirty(true));
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${s.number} · ${s.unit.site.code} ${s.unit.code}`}
        subtitle={`${s.customer?.name ?? ''} · ${SCHEME[s.scheme]}${s.kprBank ? ` (${s.kprBank})` : ''} · ${PPN[s.ppnMode]} · PPh final ${s.pphRate}%`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
            {sell && (
              <Button icon="file-plus" variant="outline" loading={act.isPending} disabled={dirty} onClick={() => act.mutate({ path: 'invoice' })}>
                Invoice what is due
              </Button>
            )}
            {active && hand && (
              <>
                <Button variant="outline" icon="file-signature" onClick={() => (setD({ ...d, no: s.ppjbNo ?? '', date: s.ppjbDate ?? isoDate() }), setDeed('ppjb'))}>
                  PPJB
                </Button>
                <Button variant="outline" icon="stamp" onClick={() => (setD({ ...d, no: s.ajbNo ?? '', date: s.ajbDate ?? isoDate() }), setDeed('ajb'))}>
                  AJB
                </Button>
                <Button icon="key-round" onClick={() => (setD({ ...d, date: isoDate() }), setDeed('handover'))}>
                  Hand over
                </Button>
                <Button variant="ghost" icon="x" onClick={() => (setD({ ...d, date: isoDate(), reason: 'BUYER', forfeitPct: '10' }), setDeed('cancel'))}>
                  Cancel sale
                </Button>
              </>
            )}
            {s.status === 'HANDED_OVER' && hand && (
              <Button
                variant="ghost"
                icon="undo"
                onClick={async () =>
                  (await confirm({ title: 'Undo the handover?', message: 'The revenue and cost of sales entry is voided.', danger: true, confirmText: 'Undo handover' })) &&
                  act.mutate({ path: 'handover/undo' })
                }
              >
                Undo handover
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Price (before PPN)</span>
          <span className="block text-lg font-semibold">{fmtMoney(s.price, 0)}</span>
          <span className="block text-xs text-slate-500">{s.ppnMode === 'DTP' ? `PPN borne by the government on ${fmtMoney(s.dtpBase, 0)}` : PPN[s.ppnMode]}</span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Invoiced / paid</span>
          <span className="block text-lg font-semibold">{fmtMoney(s.totals.invoiced, 0)}</span>
          <span className="block text-xs text-slate-500">
            PPN {fmtMoney(s.totals.ppn, 0)} · paid {fmtMoney(s.totals.paid, 0)} of {fmtMoney(s.totals.billed, 0)}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Taxes on the transfer</span>
          <span className="block text-sm font-semibold">PPh final {fmtMoney(s.totals.pphFinal, 0)} (ours)</span>
          <span className="block text-xs text-slate-500">BPHTB about {fmtMoney(s.totals.bphtbEstimate, 0)} (the buyer's)</span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Deeds</span>
          <span className="block text-xs">PPJB {s.ppjbNo ? `${s.ppjbNo} · ${fmtDate(s.ppjbDate)}` : '-'}</span>
          <span className="block text-xs">AJB {s.ajbNo ? `${s.ajbNo} · ${fmtDate(s.ajbDate)}` : '-'}</span>
          <span className="block text-xs">Handover {s.handoverDate ? `${fmtDate(s.handoverDate)} · cost ${fmtMoney(s.cost, 0)}` : '-'}</span>
        </Card>
      </div>
      {s.status === 'CANCELLED' && (
        <Card bodyClass="px-4 py-3 text-sm">
          Cancelled {s.cancelReason === 'BUYER' ? 'by the buyer' : "through the developer's fault"}: {fmtMoney(s.forfeit, 0)} kept, refund {fmtMoney(s.refund, 0)} due by {fmtDate(s.refundDue)}{' '}
          (Refunds Due to Property Buyers; pay it from Cash & Bank).
        </Card>
      )}
      <Card
        title="Payment schedule"
        bodyClass="p-0"
        actions={
          sell &&
          dirty && (
            <Button size="sm" icon="save" loading={schedule.isPending} onClick={() => schedule.mutate()}>
              Save schedule
            </Button>
          )
        }
      >
        {errors.lines && <p className="px-4 pt-3 text-xs text-red-600">{errors.lines}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Payment</th>
                <th className="w-40 px-2 py-2 text-left">Due</th>
                <th className="w-40 px-2 py-2 text-left">Amount (before PPN)</th>
                <th className="px-4 py-2 text-left">Invoice</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l, i) => {
                const fixed = !sell || !!l.invoice;
                return (
                  <tr key={l.id || `n${i}`} className="align-top">
                    <td className="px-4 py-1.5">
                      <Input disabled={fixed} value={l.label} maxLength={100} onChange={(e) => setLine(i, { label: e.target.value })} aria-label="Payment" />
                    </td>
                    <td className="px-2 py-1.5">
                      <DatePicker disabled={!sell} value={l.dueDate} clearable={false} onChange={(v) => setLine(i, { dueDate: v ?? l.dueDate })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput disabled={fixed} decimals={2} min={0} value={l.amountS} onChange={(v) => setLine(i, { amountS: v })} aria-label="Amount" />
                    </td>
                    <td className="px-4 py-1.5">
                      {l.invoice ? (
                        <span className="text-xs">
                          <Link className="text-brand-600" to={`/documents/SI/${l.invoice.id}`}>
                            {l.invoice.number}
                          </Link>{' '}
                          · {fmtMoney(l.invoice.grandTotal, 0)} · paid {fmtMoney(l.invoice.paidAmount, 0)}
                        </span>
                      ) : (
                        sell &&
                        !dirty && (
                          <Button size="sm" variant="ghost" icon="file-plus" loading={act.isPending} onClick={() => act.mutate({ path: 'invoice', body: { lineIds: [l.id] } })}>
                            Invoice now
                          </Button>
                        )
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {!fixed && <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => (setLines(lines.filter((_, j) => j !== i)), setDirty(true))} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          {sell && (
            <Button
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() => (setLines([...lines, { id: '', seq: lines.length + 1, kind: 'INSTALMENT', label: 'Payment', dueDate: isoDate(), amount: 0, amountS: '', invoice: null }]), setDirty(true))}
            >
              Payment
            </Button>
          )}
          <span className={Math.abs(sum - s.price) > 0.004 ? 'text-red-600' : 'text-slate-500'}>
            Schedule {fmtMoney(sum, 0)} of {fmtMoney(s.price, 0)}
          </span>
        </div>
      </Card>

      {deed && (
        <Modal
          open
          onClose={() => setDeed(null)}
          title={{ ppjb: 'PPJB (sale and purchase binding agreement)', ajb: 'AJB (deed of sale)', handover: 'Handover (BAST)', cancel: `Cancel ${s.number}` }[deed]}
          footer={
            <Button
              icon="check"
              variant={deed === 'cancel' ? 'danger' : 'primary'}
              loading={act.isPending}
              onClick={() =>
                act.mutate(
                  deed === 'handover'
                    ? { path: 'handover', body: { date: d.date } }
                    : deed === 'cancel'
                      ? { path: 'cancel', body: { reason: d.reason, forfeitPct: d.reason === 'BUYER' ? d.forfeitPct : 0, date: d.date, notes: d.notes } }
                      : { path: deed, body: { no: d.no, date: d.date, notary: d.notary } },
                )
              }
            >
              {deed === 'cancel' ? 'Cancel sale' : 'Record'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(deed === 'ppjb' || deed === 'ajb') && (
              <>
                <Field label="Deed number" required>
                  <Input value={d.no} maxLength={60} onChange={(e) => setD({ ...d, no: e.target.value })} />
                </Field>
                <Field label="Notary / PPAT">
                  <Input value={d.notary} maxLength={150} onChange={(e) => setD({ ...d, notary: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Date" required>
              <DatePicker value={d.date} clearable={false} onChange={(v) => setD({ ...d, date: v ?? isoDate() })} />
            </Field>
            {deed === 'cancel' && (
              <>
                <Field label="Cancelled">
                  <Select
                    value={d.reason}
                    onChange={(e) => setD({ ...d, reason: e.target.value })}
                    options={[
                      { value: 'BUYER', label: 'by the buyer' },
                      { value: 'DEVELOPER', label: "through the developer's fault" },
                    ]}
                  />
                </Field>
                {d.reason === 'BUYER' && (
                  <Field label="Kept of the payments %" help="Permen PUPR 11/2019: at most 10%">
                    <NumberInput decimals={2} min={0} max={10} value={d.forfeitPct} onChange={(v) => setD({ ...d, forfeitPct: v })} />
                  </Field>
                )}
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea rows={2} value={d.notes} maxLength={500} onChange={(e) => setD({ ...d, notes: e.target.value })} />
                </Field>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {deed === 'ajb' && 'The whole price must be invoiced and the PPh final of the payments booked: the deed is signed only after the PPh is validated (PP 34/2016).'}
            {deed === 'handover' &&
              `The deposits of ${fmtMoney(s.price, 0)} become sales and the unit's cost ${fmtMoney(s.unit.cost, 0)} goes to cost of sales.${s.ppnMode === 'DTP' ? ' PPN DTP: the handover must fall in the incentive period.' : ''}`}
            {deed === 'cancel' && 'Unpaid invoices are cancelled; what was paid (with its PPN: replace the faktur in Coretax) becomes a refund due within 30 days, less the part kept.'}
            {deed === 'ppjb' && 'Permen PUPR 11/2019: the PPJB is signed once the land status, permits, facilities and at least 20% of the construction are in place.'}
          </p>
        </Modal>
      )}
    </div>
  );
}

// ============================================================ PPh final PHTB
interface Tax {
  period: string;
  depositBy: string;
  rows: { payment: string; date: string; sale: string; invoice: string; allocated: number; base: number; rate: number; due: number }[];
  totals: { base: number; due: number; booked: number; toBook: number };
  booked: { id: string; base: number; amount: number }[];
}

export function PropertyTaxPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [period, setPeriod] = useState(isoDate().slice(0, 7));
  const q = useQuery({ queryKey: ['property', 'final-tax', period], queryFn: () => api.get<Tax>('/property/final-tax', { period }) });
  const book = useMutation({
    mutationFn: () => api.post(`/property/final-tax/${period}/book`),
    onSuccess: () => (toast.success('Booked'), qc.invalidateQueries({ queryKey: ['property'] })),
    onError: (e) => toast.error(e),
  });
  const unbook = useMutation({
    mutationFn: (id: string) => api.post(`/property/final-tax/payments/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled'), qc.invalidateQueries({ queryKey: ['property'] })),
    onError: (e) => toast.error(e),
  });
  const t = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="PPh Final PHTB"
        subtitle="PP 34/2016: 2.5% (1% simple houses) of each payment received for a unit, before PPN, paid by the developer by the 15th of the next month; the AJB is signed only after it is validated"
        actions={
          <div className="w-44">
            <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />
          </div>
        }
      />
      {q.isLoading || !t ? (
        <Loading />
      ) : (
        <Card
          title={`Payments received · base ${fmtMoney(t.totals.base, 0)} · PPh ${fmtMoney(t.totals.due, 0)} · pay by ${fmtDate(t.depositBy)}`}
          bodyClass="p-0"
          actions={
            t.totals.toBook > 0 &&
            can('property.tax') && (
              <Button
                size="sm"
                icon="check"
                loading={book.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Book ${fmtMoney(t.totals.toBook, 0)}?`,
                    message: 'Dr Final Income Tax - Land & Building Transfers / Cr PPh 4(2) Payable, at the end of the month.',
                    confirmText: 'Book',
                  })) && book.mutate()
                }
              >
                Book {fmtMoney(t.totals.toBook, 0)}
              </Button>
            )
          }
        >
          {!t.rows.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No payments on unit sales this month.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {t.rows.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    {r.payment} · {fmtDate(r.date)} · {r.sale} · {r.invoice}
                  </span>
                  <span className="text-xs text-slate-500">
                    {r.rate}% of {fmtMoney(r.base, 0)}
                  </span>
                  <span className="w-28 text-right">{fmtMoney(r.due, 0)}</span>
                </li>
              ))}
            </ul>
          )}
          {t.booked.length > 0 && (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {t.booked.map((b) => (
                <li key={b.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1">Booked {fmtMoney(b.amount, 0)}</span>
                  {can('property.tax') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      aria-label="Cancel booking"
                      onClick={async () => (await confirm({ title: 'Cancel this booking?', message: 'The journal is voided.', danger: true, confirmText: 'Cancel booking' })) && unbook.mutate(b.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 py-3 text-xs text-slate-500">
            {fmtNumber(t.rows.length, 0)} payments · booked {fmtMoney(t.totals.booked, 0)}
          </p>
        </Card>
      )}
    </div>
  );
}
