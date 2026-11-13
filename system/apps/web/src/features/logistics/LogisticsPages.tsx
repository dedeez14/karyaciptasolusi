import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, Tabs, type Tone } from '@/components/ui/primitives';
import { esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'blue' },
  DISPATCHED: { label: 'On the road', tone: 'amber' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  INVOICED: { label: 'Invoiced', tone: 'gray' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
  DONE: { label: 'Back, to settle', tone: 'amber' },
  SETTLED: { label: 'Settled', tone: 'green' },
};
const SERVICE: Record<string, string> = { TRUCKING: 'Trucking', FORWARDING: 'Forwarding' };
const VTYPES = ['PICKUP', 'VAN', 'CDE', 'CDD', 'FUSO', 'TRONTON', 'TRAILER', 'OTHER'];
const EXP: Record<string, string> = {
  FUEL: 'Fuel',
  TOLL: 'Tolls',
  PARKING: 'Parking / levies',
  DRIVER: 'Driver allowance',
  LOADING: 'Loading / unloading',
  REPAIR: 'Repair on the road',
  OTHER: 'Other',
};

// ============================================================ jobs
interface Job {
  id: string;
  number: string;
  date: string;
  customerId: string;
  customer: string | { id: string; code: string; name: string } | null;
  service: string;
  origin: string;
  originAddress: string | null;
  destination: string;
  consignee: string | null;
  consigneeAddress: string | null;
  consigneePhone: string | null;
  cargo: string;
  pieces: number;
  weightKg: number;
  volumeM3: number;
  vehicleType: string | null;
  pickupDate: string | null;
  basis: string;
  rate: number;
  amount: number;
  freightCharge: number;
  customerRef: string | null;
  status: string;
  podDate: string | null;
  podReceiver: string | null;
  podNote: string | null;
  tripCost: number;
  notes: string | null;
  trip: string | { id: string; number: string; date: string; status: string; vehicle: { plateNo: string; vehicleType: string } | null; driver: { name: string; phone: string | null } | null } | null;
  invoice: { id: string; number: string; status?: string; grandTotal?: number; paidAmount?: number } | null;
}
const custName = (c: Job['customer']) => (typeof c === 'string' ? c : (c?.name ?? null));

export function JobsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'DISPATCHED' | 'DELIVERED' | 'INVOICED'>('ALL');
  const [edit, setEdit] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const q = useQuery({ queryKey: ['logistics', 'jobs', status], queryFn: () => api.get<Job[]>('/logistics/jobs', status === 'ALL' ? {} : { status }) });
  const invoice = useMutation({
    mutationFn: () => api.post<{ invoices: string[] }>('/logistics/jobs/invoice', { jobIds: sel }),
    onSuccess: (r) => (toast.success(`Invoiced: ${r.invoices.join(', ')}`), setSel([]), qc.invalidateQueries({ queryKey: ['logistics'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Jobs & Waybills"
        subtitle="Shipment jobs priced from the rate cards, dispatched on trips, delivered with proof, invoiced: trucking PPN-exempt as public road transport (PP 49/2022), forwarding with freight charges at PPN 1.1% (PMK 71/2022 jo 11/2025)"
        actions={
          <div className="flex gap-2">
            {sel.length > 0 && can('logistics.invoice') && (
              <Button icon="file-plus" loading={invoice.isPending} onClick={() => invoice.mutate()}>
                Invoice {sel.length} job{sel.length > 1 ? 's' : ''}
              </Button>
            )}
            {can('logistics.job') && (
              <Button icon="plus" variant={sel.length ? 'outline' : 'primary'} onClick={() => setEdit(true)}>
                New job
              </Button>
            )}
          </div>
        }
      />
      <Tabs
        value={status}
        onChange={(v) => (setStatus(v), setSel([]))}
        tabs={[
          { value: 'ALL', label: 'All open' },
          { value: 'OPEN', label: 'To dispatch' },
          { value: 'DISPATCHED', label: 'On the road' },
          { value: 'DELIVERED', label: 'To invoice' },
          { value: 'INVOICED', label: 'Invoiced' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="package" title="No jobs" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                {j.status === 'DELIVERED' && can('logistics.invoice') ? (
                  <input type="checkbox" aria-label={`Select ${j.number}`} checked={sel.includes(j.id)} onChange={(e) => setSel(e.target.checked ? [...sel, j.id] : sel.filter((x) => x !== j.id))} />
                ) : (
                  <span className="w-[13px]" />
                )}
                <button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left" onClick={() => navigate(`/logistics/jobs/${j.id}`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {j.number} · {custName(j.customer)} · {j.origin} → {j.destination}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(j.date)} · {SERVICE[j.service]} · {j.cargo} · {fmtNumber(j.weightKg, 0)} kg {j.trip ? `· ${typeof j.trip === 'string' ? j.trip : j.trip.number}` : ''}{' '}
                      {j.invoice ? `· ${j.invoice.number}` : ''}
                    </span>
                  </span>
                  <span className="w-28 text-right">{fmtMoney(j.amount, 0)}</span>
                  <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <JobForm onClose={() => setEdit(false)} onSaved={(id) => navigate(`/logistics/jobs/${id}`)} />}
    </div>
  );
}

function JobForm({ j, onClose, onSaved }: { j?: Job; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    date: j?.date ?? isoDate(),
    customerId: j?.customerId ?? (null as string | null),
    service: j?.service ?? 'TRUCKING',
    origin: j?.origin ?? '',
    originAddress: j?.originAddress ?? '',
    destination: j?.destination ?? '',
    consignee: j?.consignee ?? '',
    consigneeAddress: j?.consigneeAddress ?? '',
    consigneePhone: j?.consigneePhone ?? '',
    cargo: j?.cargo ?? '',
    pieces: str(j?.pieces ?? 0),
    weightKg: str(j?.weightKg ?? 0),
    volumeM3: str(j?.volumeM3 ?? 0),
    vehicleType: j?.vehicleType ?? '',
    pickupDate: j?.pickupDate ?? (null as string | null),
    amount: str(j?.amount),
    freightCharge: str(j?.freightCharge ?? 0),
    customerRef: j?.customerRef ?? '',
    notes: j?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const quote = useMutation({
    mutationFn: () =>
      api.post<{ amount: number; basis: string; rate: number; own: boolean } | null>('/logistics/quote', {
        customerId: f.customerId,
        service: f.service,
        origin: f.origin,
        destination: f.destination,
        vehicleType: f.vehicleType,
        weightKg: f.weightKg || 0,
        volumeM3: f.volumeM3 || 0,
      }),
    onSuccess: (r) =>
      r
        ? (setF((s) => ({ ...s, amount: String(r.amount) })), toast.success(`${r.own ? 'Customer' : 'General'} rate ${fmtMoney(r.rate, 0)} per ${r.basis.toLowerCase()}`))
        : toast.error('No rate card for this route'),
    onError: (e) => toast.error(e),
  });
  const save = useMutation({
    mutationFn: () => (j ? api.put<Job>(`/logistics/jobs/${j.id}`, f) : api.post<Job>('/logistics/jobs', f)),
    onSuccess: (r) => (toast.success(`${r.number} saved`), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={j ? `Job ${j.number}` : 'New shipment job'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId || !f.origin || !f.destination || !f.cargo} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
          <AsyncSelect
            resource="customers"
            value={f.customerId}
            initialLabel={typeof j?.customer === 'object' && j?.customer ? `${j.customer.code} - ${j.customer.name}` : undefined}
            onChange={(v) => setF({ ...f, customerId: v })}
          />
        </Field>
        <Field label="Service">
          <Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} options={Object.entries(SERVICE).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="From" required>
          <Input value={f.origin} maxLength={80} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        </Field>
        <Field label="To" required>
          <Input value={f.destination} maxLength={80} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        </Field>
        <Field label="Vehicle type">
          <Select value={f.vehicleType} placeholder="Any" onChange={(e) => setF({ ...f, vehicleType: e.target.value })} options={VTYPES.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Pick-up address" className="sm:col-span-3">
          <Input value={f.originAddress} maxLength={300} onChange={(e) => setF({ ...f, originAddress: e.target.value })} />
        </Field>
        <Field label="Consignee">
          <Input value={f.consignee} maxLength={150} onChange={(e) => setF({ ...f, consignee: e.target.value })} />
        </Field>
        <Field label="Consignee phone">
          <Input value={f.consigneePhone} maxLength={30} onChange={(e) => setF({ ...f, consigneePhone: e.target.value })} />
        </Field>
        <Field label="Customer reference (PO / DO)">
          <Input value={f.customerRef} maxLength={80} onChange={(e) => setF({ ...f, customerRef: e.target.value })} />
        </Field>
        <Field label="Delivery address" className="sm:col-span-3">
          <Input value={f.consigneeAddress} maxLength={300} onChange={(e) => setF({ ...f, consigneeAddress: e.target.value })} />
        </Field>
        <Field label="Cargo" required className="sm:col-span-3">
          <Input value={f.cargo} maxLength={200} onChange={(e) => setF({ ...f, cargo: e.target.value })} />
        </Field>
        <Field label="Pieces">
          <NumberInput decimals={0} min={0} value={f.pieces} onChange={(v) => setF({ ...f, pieces: v })} />
        </Field>
        <Field label="Weight (kg)">
          <NumberInput decimals={2} min={0} value={f.weightKg} onChange={(v) => setF({ ...f, weightKg: v })} />
        </Field>
        <Field label="Volume (m³)">
          <NumberInput decimals={3} min={0} value={f.volumeM3} onChange={(v) => setF({ ...f, volumeM3: v })} />
        </Field>
        <Field label="Job date" required>
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Pick-up date">
          <DatePicker value={f.pickupDate} onChange={(v) => setF({ ...f, pickupDate: v })} />
        </Field>
        <Field label="Price before PPN" error={errors.amount} help="Empty: from the rate card">
          <div className="flex gap-1">
            <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            <Button
              variant="outline"
              size="icon"
              icon="calculator"
              aria-label="Price from the rate card"
              disabled={!f.customerId || !f.origin || !f.destination}
              loading={quote.isPending}
              onClick={() => quote.mutate()}
            />
          </div>
        </Field>
        {f.service === 'FORWARDING' && (
          <Field label="Of which freight charges (carrier)" error={errors.freightCharge} help="On the invoice: PPN 1.1% on the total; PPh 23 only on the fee" className="sm:col-span-2">
            <NumberInput decimals={0} min={0} value={f.freightCharge} onChange={(v) => setF({ ...f, freightCharge: v })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export function JobPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['logistics', 'job', id],
    queryFn: () =>
      api.get<Job & { costing: { revenue: number; tripCost: number; carrierCost: number; margin: number }; carrierCosts: { id: string; amount: number; bill: string | null }[] }>(
        `/logistics/jobs/${id}`,
      ),
  });
  const lines = useQuery({
    queryKey: ['logistics', 'carrier-lines'],
    queryFn: () => api.get<{ lineId: string; bill: string; supplier: string | null; description: string | null; open: number }[]>('/logistics/carrier-lines'),
    enabled: can('logistics.invoice'),
  });
  const [edit, setEdit] = useState(false);
  const [pod, setPod] = useState(false);
  const [p, setP] = useState({ date: isoDate(), receiver: '', note: '' });
  const [link, setLink] = useState({ sourceLineId: '', amount: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['logistics'] });
  const act = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api.post(a.path, a.body ?? {}),
    onSuccess: () => (toast.success('Done'), setPod(false), setLink({ sourceLineId: '', amount: '' }), refresh()),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const j = q.data;
  if (!j) return <EmptyState icon="package" title="Job not found" />;
  const trip = typeof j.trip === 'object' ? j.trip : null;
  const printWaybill = () =>
    printHtml(
      `<html><head><title>${esc(j.number)}</title><style>${PRINT_CSS} .box{border:1px solid #999;padding:6px;min-height:50px}</style></head><body>` +
        `<h1>Waybill / Surat Jalan ${esc(j.number)}</h1><p class="muted">${esc(fmtDate(j.date))}${j.customerRef ? ` · Ref ${esc(j.customerRef)}` : ''}</p>` +
        `<table><tr><th>Shipper</th><th>Consignee</th></tr><tr><td>${esc(custName(j.customer))}<br>${esc(j.origin)}<br>${esc(j.originAddress ?? '')}</td><td>${esc(j.consignee ?? '')}<br>${esc(j.destination)}<br>${esc(j.consigneeAddress ?? '')}<br>${esc(j.consigneePhone ?? '')}</td></tr></table>` +
        `<table><tr><th>Cargo</th><th class="r">Pieces</th><th class="r">Weight (kg)</th><th class="r">Volume (m³)</th></tr><tr><td>${esc(j.cargo)}</td><td class="r">${j.pieces}</td><td class="r">${fmtNumber(j.weightKg, 2)}</td><td class="r">${fmtNumber(j.volumeM3, 3)}</td></tr></table>` +
        `<table><tr><th>Trip</th><th>Vehicle</th><th>Driver</th></tr><tr><td>${esc(trip?.number ?? '')}</td><td>${esc(trip?.vehicle ? `${trip.vehicle.plateNo} (${trip.vehicle.vehicleType})` : '')}</td><td>${esc(trip?.driver?.name ?? '')}</td></tr></table>` +
        `<table><tr><th>Shipper</th><th>Driver</th><th>Received in good order by (name, date, signature, stamp)</th></tr><tr><td class="box"></td><td class="box"></td><td class="box"></td></tr></table></body></html>`,
    );
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${j.number} · ${j.origin} → ${j.destination}`}
        subtitle={`${custName(j.customer)} · ${SERVICE[j.service]} · ${j.cargo}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
            <Button variant="outline" icon="printer" onClick={printWaybill}>
              Waybill
            </Button>
            {['OPEN', 'DISPATCHED', 'DELIVERED'].includes(j.status) && can('logistics.job') && (
              <Button variant="outline" icon="pencil" onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
            {j.status === 'DISPATCHED' && can('logistics.job') && (
              <Button icon="check" onClick={() => setPod(true)}>
                Proof of delivery
              </Button>
            )}
            {j.status === 'INVOICED' && can('logistics.invoice') && (
              <Button
                variant="ghost"
                icon="undo"
                onClick={async () =>
                  (await confirm({
                    title: 'Cancel the invoice of this job?',
                    message: 'Only while unpaid; all jobs on that invoice go back to delivered.',
                    danger: true,
                    confirmText: 'Cancel invoice',
                  })) && act.mutate({ path: `/logistics/jobs/${j.id}/uninvoice` })
                }
              >
                Cancel invoice
              </Button>
            )}
            {j.status === 'OPEN' && can('logistics.job') && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () => (await confirm({ title: `Cancel ${j.number}?`, danger: true, confirmText: 'Cancel job' })) && act.mutate({ path: `/logistics/jobs/${j.id}/cancel` })}
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card title="Shipment" bodyClass="px-4 py-3 text-sm space-y-1">
          <p>
            {j.pieces} pcs · {fmtNumber(j.weightKg, 2)} kg · {fmtNumber(j.volumeM3, 3)} m³ {j.vehicleType ? `· ${j.vehicleType}` : ''}
          </p>
          <p className="text-xs text-slate-500">From {j.originAddress || j.origin}</p>
          <p className="text-xs text-slate-500">
            To {j.consignee} · {j.consigneeAddress || j.destination} {j.consigneePhone ?? ''}
          </p>
          {j.podDate && (
            <p className="text-xs">
              Delivered {fmtDate(j.podDate)}, received by {j.podReceiver} {j.podNote ? `(${j.podNote})` : ''}
            </p>
          )}
        </Card>
        <Card title="Trip" bodyClass="px-4 py-3 text-sm space-y-1">
          {trip ? (
            <>
              <Link className="text-brand-600" to={`/logistics/trips/${trip.id}`}>
                {trip.number}
              </Link>{' '}
              · {fmtDate(trip.date)}
              <p className="text-xs text-slate-500">
                {trip.vehicle?.plateNo} · {trip.driver?.name} {trip.driver?.phone ?? ''}
              </p>
            </>
          ) : (
            <p className="text-slate-500">Not dispatched</p>
          )}
        </Card>
        <Card title="Job costing" bodyClass="px-4 py-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-slate-500">Price</dt>
            <dd className="text-right">{fmtMoney(j.costing.revenue, 0)}</dd>
            {j.service === 'FORWARDING' && (
              <>
                <dt className="text-slate-500">of which freight charges</dt>
                <dd className="text-right">{fmtMoney(j.freightCharge, 0)}</dd>
              </>
            )}
            <dt className="text-slate-500">Trip costs (share)</dt>
            <dd className="text-right">{fmtMoney(j.costing.tripCost, 0)}</dd>
            <dt className="text-slate-500">Carrier bills</dt>
            <dd className="text-right">{fmtMoney(j.costing.carrierCost, 0)}</dd>
            <dt className="font-medium">Margin</dt>
            <dd className={`text-right font-medium ${j.costing.margin < 0 ? 'text-red-600' : ''}`}>{fmtMoney(j.costing.margin, 0)}</dd>
          </dl>
          {j.invoice && (
            <p className="mt-2 text-xs">
              Invoice{' '}
              <Link className="text-brand-600" to={`/documents/SI/${j.invoice.id}`}>
                {j.invoice.number}
              </Link>{' '}
              · paid {fmtMoney(j.invoice.paidAmount ?? 0, 0)} of {fmtMoney(j.invoice.grandTotal ?? 0, 0)}
            </p>
          )}
        </Card>
      </div>
      {can('logistics.invoice') && j.status !== 'CANCELLED' && (
        <Card title="Carrier and agent bills" bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {j.carrierCosts.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1">{c.bill}</span>
                <span>{fmtMoney(c.amount, 0)}</span>
                <Button size="sm" variant="ghost" icon="x" aria-label="Remove" onClick={() => act.mutate({ path: `/logistics/carrier-costs/${c.id}/remove` })} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 px-4 py-3">
            <div className="min-w-64 flex-1">
              <Select
                value={link.sourceLineId}
                placeholder={lines.data?.length ? 'Purchase invoice line on LOG-CARRIER' : 'No open carrier bills (product LOG-CARRIER)'}
                onChange={(e) => setLink({ sourceLineId: e.target.value, amount: String(lines.data?.find((l) => l.lineId === e.target.value)?.open ?? '') })}
                options={(lines.data ?? []).map((l) => ({ value: l.lineId, label: `${l.bill} · ${l.supplier ?? ''} · ${l.description ?? ''} · open ${fmtMoney(l.open, 0)}` }))}
                aria-label="Carrier bill line"
              />
            </div>
            <div className="w-36">
              <NumberInput decimals={0} min={0} value={link.amount} onChange={(v) => setLink({ ...link, amount: v })} aria-label="Amount" />
            </div>
            <Button
              size="sm"
              icon="link"
              disabled={!link.sourceLineId || !num(link.amount)}
              loading={act.isPending}
              onClick={() => act.mutate({ path: `/logistics/jobs/${j.id}/carrier`, body: link })}
            >
              Charge to job
            </Button>
            {!lines.data?.length && (
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: '/logistics/carrier-product' })}>
                Make product LOG-CARRIER
              </Button>
            )}
          </div>
        </Card>
      )}
      {edit && <JobForm j={j} onClose={() => setEdit(false)} onSaved={() => (setEdit(false), refresh())} />}
      {pod && (
        <Modal
          open
          onClose={() => setPod(false)}
          title="Proof of delivery"
          footer={
            <Button icon="check" disabled={!p.receiver} loading={act.isPending} onClick={() => act.mutate({ path: `/logistics/jobs/${j.id}/pod`, body: p })}>
              Delivered
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Delivered on" required>
              <DatePicker value={p.date} clearable={false} onChange={(v) => setP({ ...p, date: v ?? isoDate() })} />
            </Field>
            <Field label="Received by" required>
              <Input value={p.receiver} maxLength={120} onChange={(e) => setP({ ...p, receiver: e.target.value })} />
            </Field>
            <Field label="Note (shortage, damage...)" className="sm:col-span-2">
              <Input value={p.note} maxLength={300} onChange={(e) => setP({ ...p, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================ trips
interface Vehicle {
  id: string;
  plateNo: string;
  vehicleType: string;
  brand: string | null;
  capacityKg: number;
  capacityM3: number;
  ownership: string;
  kirExpiry: string | null;
  stnkExpiry: string | null;
  insuranceExpiry: string | null;
  odometer: number;
  status: string;
  notes: string | null;
}
interface Driver {
  id: string;
  name: string;
  employeeId: string | null;
  phone: string | null;
  simType: string | null;
  simNo: string | null;
  simExpiry: string | null;
  isActive: boolean;
}
interface TripRow {
  id: string;
  number: string;
  date: string;
  status: string;
  route: string | null;
  vehicle: { plateNo: string; vehicleType: string } | null;
  driver: string | null;
  jobs: number;
  revenue: number;
  weightKg: number;
  advance: number;
  expenses: number;
  km: number | null;
}

export function TripsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'DONE' | 'SETTLED'>('ALL');
  const [make, setMake] = useState(false);
  const q = useQuery({ queryKey: ['logistics', 'trips', status], queryFn: () => api.get<TripRow[]>('/logistics/trips', status === 'ALL' ? {} : { status }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Trips & Trip Advances"
        subtitle="Jobs dispatched on a vehicle and driver (valid KIR, STNK and SIM; no overloading), trip advance (uang jalan) given and settled against the expenses, which are spread over the jobs"
        actions={
          can('logistics.dispatch') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New trip
            </Button>
          )
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'ALL', label: 'All' },
          { value: 'OPEN', label: 'On the road' },
          { value: 'DONE', label: 'To settle' },
          { value: 'SETTLED', label: 'Settled' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="route" title="No trips" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((t) => (
              <li key={t.id}>
                <Link to={`/logistics/trips/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {t.number} · {t.vehicle?.plateNo} · {t.driver}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(t.date)} · {t.route ?? ''} · {t.jobs} jobs · {fmtNumber(t.weightKg, 0)} kg {t.km !== null ? `· ${fmtNumber(t.km, 0)} km` : ''}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    advance {fmtMoney(t.advance, 0)}
                    {t.status === 'SETTLED' && <span className="block">costs {fmtMoney(t.expenses, 0)}</span>}
                  </span>
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {make && <TripForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/logistics/trips/${id}`)} />}
    </div>
  );
}

function TripForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const vehicles = useQuery({ queryKey: ['logistics', 'vehicles'], queryFn: () => api.get<Vehicle[]>('/logistics/vehicles') });
  const drivers = useQuery({ queryKey: ['logistics', 'drivers'], queryFn: () => api.get<Driver[]>('/logistics/drivers') });
  const jobs = useQuery({ queryKey: ['logistics', 'jobs', 'OPEN'], queryFn: () => api.get<Job[]>('/logistics/jobs', { status: 'OPEN' }) });
  const [f, setF] = useState({ date: isoDate(), vehicleId: '', driverId: '', helper: '', route: '', odoStart: '', jobIds: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const v = vehicles.data?.find((x) => x.id === f.vehicleId);
  const kg = (jobs.data ?? []).filter((j) => f.jobIds.includes(j.id)).reduce((a, j) => a + j.weightKg, 0);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/logistics/trips', { ...f, odoStart: f.odoStart || null }),
    onSuccess: (r) => (toast.success(`${r.number} dispatched`), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New trip"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.vehicleId || !f.driverId || !f.jobIds.length} onClick={() => save.mutate()}>
          Dispatch
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          <DatePicker value={f.date} clearable={false} onChange={(d) => setF({ ...f, date: d ?? isoDate() })} />
        </Field>
        <Field label="Vehicle" required error={errors.vehicleId}>
          <Select
            value={f.vehicleId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, vehicleId: e.target.value })}
            options={(vehicles.data ?? []).filter((x) => x.status === 'ACTIVE').map((x) => ({ value: x.id, label: `${x.plateNo} · ${x.vehicleType} · ${fmtNumber(x.capacityKg, 0)} kg` }))}
          />
        </Field>
        <Field label="Driver" required error={errors.driverId}>
          <Select
            value={f.driverId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, driverId: e.target.value })}
            options={(drivers.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.name}${x.simExpiry ? ` · SIM to ${fmtDate(x.simExpiry)}` : ''}` }))}
          />
        </Field>
        <Field label="Helper (kenek)">
          <Input value={f.helper} maxLength={120} onChange={(e) => setF({ ...f, helper: e.target.value })} />
        </Field>
        <Field label="Route">
          <Input value={f.route} maxLength={200} onChange={(e) => setF({ ...f, route: e.target.value })} />
        </Field>
        <Field label="Odometer at the start" help={v ? `Vehicle shows ${fmtNumber(v.odometer, 0)} km` : undefined}>
          <NumberInput decimals={0} min={0} value={f.odoStart} onChange={(x) => setF({ ...f, odoStart: x })} />
        </Field>
      </div>
      <p className="mb-1 mt-4 text-sm font-medium">Jobs to carry {v ? `· ${fmtNumber(kg, 0)} of ${fmtNumber(v.capacityKg, 0)} kg` : ''}</p>
      {errors.jobIds && <p className="mb-1 text-xs text-red-600">{errors.jobIds}</p>}
      <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded border border-line text-sm">
        {(jobs.data ?? []).map((j) => (
          <li key={j.id} className="flex items-center gap-2 px-3 py-2">
            <Checkbox
              checked={f.jobIds.includes(j.id)}
              onChange={(c) => setF({ ...f, jobIds: c ? [...f.jobIds, j.id] : f.jobIds.filter((x) => x !== j.id) })}
              label={`${j.number} · ${custName(j.customer)} · ${j.origin} → ${j.destination}`}
            />
            <span className="ml-auto text-xs text-slate-500">{fmtNumber(j.weightKg, 0)} kg</span>
          </li>
        ))}
        {!jobs.data?.length && <li className="px-3 py-3 text-slate-500">No open jobs.</li>}
      </ul>
    </Modal>
  );
}

interface TripD {
  id: string;
  number: string;
  date: string;
  status: string;
  route: string | null;
  helper: string | null;
  odoStart: number | null;
  odoEnd: number | null;
  km: number | null;
  advance: number;
  expenses: number;
  fuelLiters: number;
  vehicle: Vehicle | null;
  driver: Driver | null;
  expenseLines: { id: string; kind: string; amount: number; liters: number; note: string | null }[];
  jobs: Job[];
}

export function TripPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['logistics', 'trip', id], queryFn: () => api.get<TripD>(`/logistics/trips/${id}`) });
  const [modal, setModal] = useState<'advance' | 'finish' | 'settle' | null>(null);
  const [a, setA] = useState({ date: isoDate(), amount: '', bankAccountId: null as string | null, odoEnd: '' });
  const [exp, setExp] = useState<{ kind: string; amount: string; liters: string; note: string }[]>([{ kind: 'FUEL', amount: '', liters: '', note: '' }]);
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(`/logistics/trips/${id}/${x.path}`, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), setModal(null), qc.invalidateQueries({ queryKey: ['logistics'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const t = q.data;
  if (!t) return <EmptyState icon="route" title="Trip not found" />;
  const total = exp.reduce((s, e) => s + num(e.amount), 0);
  const dispatch = can('logistics.dispatch');
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${t.number} · ${t.vehicle?.plateNo ?? ''}`}
        subtitle={`${fmtDate(t.date)} · ${t.driver?.name ?? ''}${t.helper ? ` + ${t.helper}` : ''} · ${t.route ?? ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
            {['OPEN', 'DONE'].includes(t.status) && dispatch && (
              <Button variant="outline" icon="wallet" onClick={() => setModal('advance')}>
                Give advance
              </Button>
            )}
            {t.status === 'OPEN' && dispatch && (
              <Button icon="flag" onClick={() => (setA({ ...a, odoEnd: str(t.odoStart) }), setModal('finish'))}>
                Back at base
              </Button>
            )}
            {t.status === 'DONE' && dispatch && (
              <Button icon="calculator" onClick={() => setModal('settle')}>
                Settle expenses
              </Button>
            )}
            {t.status === 'SETTLED' && dispatch && (
              <Button
                variant="ghost"
                icon="undo"
                onClick={async () =>
                  (await confirm({ title: 'Undo the settlement?', message: 'Its journal is voided and the job costs cleared.', danger: true, confirmText: 'Undo' })) && act.mutate({ path: 'unsettle' })
                }
              >
                Undo settlement
              </Button>
            )}
            {t.status === 'OPEN' && dispatch && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({ title: `Cancel ${t.number}?`, message: 'Its jobs go back to open.', danger: true, confirmText: 'Cancel trip' })) && act.mutate({ path: 'cancel' })
                }
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Vehicle</span>
          <span className="block font-semibold">
            {t.vehicle?.plateNo} · {t.vehicle?.vehicleType}
          </span>
          <span className="block text-xs text-slate-500">
            KIR to {fmtDate(t.vehicle?.kirExpiry)} · STNK to {fmtDate(t.vehicle?.stnkExpiry)}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Distance</span>
          <span className="block font-semibold">{t.km !== null ? `${fmtNumber(t.km, 0)} km` : '-'}</span>
          <span className="block text-xs text-slate-500">
            odometer {t.odoStart ?? '-'} → {t.odoEnd ?? '-'} {t.fuelLiters > 0 ? `· ${fmtNumber(t.fuelLiters, 1)} l` : ''}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Advance / expenses</span>
          <span className="block font-semibold">
            {fmtMoney(t.advance, 0)} / {fmtMoney(t.expenses, 0)}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Jobs</span>
          <span className="block font-semibold">{t.jobs.length}</span>
          <span className="block text-xs text-slate-500">
            {fmtMoney(
              t.jobs.reduce((s, j) => s + j.amount, 0),
              0,
            )}{' '}
            billed
          </span>
        </Card>
      </div>
      <Card title="Jobs on the trip" bodyClass="p-0">
        <ul className="divide-y divide-line text-sm">
          {t.jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Link to={`/logistics/jobs/${j.id}`} className="min-w-0 flex-1 text-brand-600">
                {j.number} · {custName(j.customer)} · {j.origin} → {j.destination}
              </Link>
              <span className="text-xs text-slate-500">
                {fmtNumber(j.weightKg, 0)} kg {j.podReceiver ? `· received by ${j.podReceiver}` : ''} {t.status === 'SETTLED' ? `· cost ${fmtMoney(j.tripCost, 0)}` : ''}
              </span>
              <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      {t.expenseLines.length > 0 && (
        <Card title="Expenses" bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {t.expenseLines.map((e) => (
              <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1">
                  {EXP[e.kind]} {e.liters > 0 ? `· ${fmtNumber(e.liters, 1)} l` : ''} {e.note ? `· ${e.note}` : ''}
                </span>
                <span>{fmtMoney(e.amount, 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {modal === 'advance' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title="Trip advance (uang jalan)"
          footer={
            <Button
              icon="check"
              disabled={!num(a.amount) || !a.bankAccountId}
              loading={act.isPending}
              onClick={() => act.mutate({ path: 'advance', body: { date: a.date, amount: a.amount, bankAccountId: a.bankAccountId } })}
            >
              Give
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Date" required>
              <DatePicker value={a.date} clearable={false} onChange={(d) => setA({ ...a, date: d ?? isoDate() })} />
            </Field>
            <Field label="Amount" required>
              <NumberInput decimals={0} min={0} value={a.amount} onChange={(v) => setA({ ...a, amount: v })} />
            </Field>
            <Field label="Paid from" required>
              <AsyncSelect resource="bank-accounts" value={a.bankAccountId} onChange={(v) => setA({ ...a, bankAccountId: v })} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">Dr Employee Advances / Cr the cash or bank account, until the trip is settled.</p>
        </Modal>
      )}
      {modal === 'finish' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title="Back at base"
          footer={
            <Button icon="check" loading={act.isPending} onClick={() => act.mutate({ path: 'finish', body: { odoEnd: a.odoEnd } })}>
              Record
            </Button>
          }
        >
          <Field label="Odometer at the end" required help={`Started at ${t.odoStart ?? '-'}`}>
            <NumberInput decimals={0} min={0} value={a.odoEnd} onChange={(v) => setA({ ...a, odoEnd: v })} />
          </Field>
          <p className="mt-2 text-xs text-slate-500">Every job needs its proof of delivery (or is taken off the trip) first.</p>
        </Modal>
      )}
      {modal === 'settle' && (
        <Modal
          open
          size="lg"
          onClose={() => setModal(null)}
          title={`Settle ${t.number}`}
          footer={
            <Button
              icon="check"
              loading={act.isPending}
              onClick={() =>
                act.mutate({
                  path: 'settle',
                  body: {
                    date: a.date,
                    bankAccountId: a.bankAccountId,
                    expenses: exp.filter((e) => num(e.amount) > 0).map((e) => ({ kind: e.kind, amount: e.amount, liters: e.liters || 0, note: e.note })),
                  },
                })
              }
            >
              Settle
            </Button>
          }
        >
          <div className="space-y-2">
            {exp.map((e, i) => (
              <div key={i} className="grid grid-cols-[10rem_8rem_6rem_minmax(0,1fr)_2.5rem] gap-2">
                <Select
                  value={e.kind}
                  onChange={(x) => setExp(exp.map((y, k) => (k === i ? { ...y, kind: x.target.value } : y)))}
                  options={Object.entries(EXP).map(([value, label]) => ({ value, label }))}
                  aria-label="Expense"
                />
                <NumberInput decimals={0} min={0} value={e.amount} onChange={(v) => setExp(exp.map((y, k) => (k === i ? { ...y, amount: v } : y)))} aria-label="Amount" />
                <NumberInput
                  decimals={1}
                  min={0}
                  value={e.liters}
                  placeholder="litres"
                  disabled={e.kind !== 'FUEL'}
                  onChange={(v) => setExp(exp.map((y, k) => (k === i ? { ...y, liters: v } : y)))}
                  aria-label="Litres"
                />
                <Input value={e.note} maxLength={200} placeholder="Note / receipt" onChange={(x) => setExp(exp.map((y, k) => (k === i ? { ...y, note: x.target.value } : y)))} />
                <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setExp(exp.filter((_, k) => k !== i))} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setExp([...exp, { kind: 'TOLL', amount: '', liters: '', note: '' }])}>
            Expense
          </Button>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Settlement date" required>
              <DatePicker value={a.date} clearable={false} onChange={(d) => setA({ ...a, date: d ?? isoDate() })} />
            </Field>
            <Field label="Difference through" help="Empty: the account the advance came from">
              <AsyncSelect resource="bank-accounts" value={a.bankAccountId} onChange={(v) => setA({ ...a, bankAccountId: v })} />
            </Field>
          </div>
          <p className="mt-2 text-sm">
            Expenses {fmtMoney(total, 0)} · advance {fmtMoney(t.advance, 0)} ·{' '}
            {t.advance - total >= 0 ? `driver returns ${fmtMoney(t.advance - total, 0)}` : `pay the driver ${fmtMoney(total - t.advance, 0)}`}
          </p>
        </Modal>
      )}
    </div>
  );
}

// ============================================================ fleet and drivers
export function FleetPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'VEHICLES' | 'DRIVERS' | 'ALERTS' | 'REPORT'>('VEHICLES');
  const [ve, setVe] = useState<Vehicle | 'new' | null>(null);
  const [de, setDe] = useState<Driver | 'new' | null>(null);
  const [from, setFrom] = useState(isoDate().slice(0, 8) + '01');
  const [to, setTo] = useState(isoDate());
  const vehicles = useQuery({ queryKey: ['logistics', 'vehicles'], queryFn: () => api.get<Vehicle[]>('/logistics/vehicles') });
  const drivers = useQuery({ queryKey: ['logistics', 'drivers'], queryFn: () => api.get<Driver[]>('/logistics/drivers') });
  const alerts = useQuery({ queryKey: ['logistics', 'alerts'], queryFn: () => api.get<{ kind: string; ref: string; doc: string; expiry: string; expired: boolean }[]>('/logistics/alerts') });
  const report = useQuery({
    queryKey: ['logistics', 'report', from, to],
    queryFn: () =>
      api.get<
        {
          vehicleId: string;
          plateNo: string;
          vehicleType: string;
          trips: number;
          km: number;
          fuel: number;
          kmPerLiter: number | null;
          cost: number;
          costPerKm: number | null;
          revenue: number;
          margin: number;
        }[]
      >('/logistics/fleet-report', { from, to }),
    enabled: tab === 'REPORT',
  });
  const today = isoDate();
  const due = (d: string | null) => (!d ? 'text-red-600' : d < today ? 'text-red-600' : d <= new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) ? 'text-amber-700' : 'text-slate-500');
  const refresh = () => qc.invalidateQueries({ queryKey: ['logistics'] });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet & Drivers"
        subtitle="Vehicles with KIR (every 6 months, PM 19/2021), STNK and insurance dates; drivers with their SIM; a trip needs them all valid"
        actions={
          can('logistics.fleet') && (
            <div className="flex gap-2">
              <Button variant="outline" icon="plus" onClick={() => setDe('new')}>
                Driver
              </Button>
              <Button icon="plus" onClick={() => setVe('new')}>
                Vehicle
              </Button>
            </div>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'VEHICLES', label: 'Vehicles' },
          { value: 'DRIVERS', label: 'Drivers' },
          { value: 'ALERTS', label: `Documents due${alerts.data?.length ? ` (${alerts.data.length})` : ''}` },
          { value: 'REPORT', label: 'Cost per km' },
        ]}
      />
      {tab === 'VEHICLES' && (
        <Card bodyClass="p-0">
          {!vehicles.data?.length ? (
            <EmptyState icon="truck" title="No vehicles" />
          ) : (
            <ul className="divide-y divide-line">
              {vehicles.data.map((v) => (
                <li key={v.id}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setVe(v)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {v.plateNo} · {v.vehicleType} {v.brand ?? ''}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {fmtNumber(v.capacityKg, 0)} kg · {fmtNumber(v.capacityM3, 1)} m³ · {v.ownership.toLowerCase()} · {fmtNumber(v.odometer, 0)} km
                      </span>
                    </span>
                    <span className="text-right text-xs">
                      <span className={`block ${due(v.kirExpiry)}`}>KIR {fmtDate(v.kirExpiry) || '-'}</span>
                      <span className={`block ${due(v.stnkExpiry)}`}>STNK {fmtDate(v.stnkExpiry) || '-'}</span>
                    </span>
                    <Badge tone={v.status === 'ACTIVE' ? 'green' : 'gray'}>{v.status.toLowerCase()}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'DRIVERS' && (
        <Card bodyClass="p-0">
          {!drivers.data?.length ? (
            <EmptyState icon="users" title="No drivers" />
          ) : (
            <ul className="divide-y divide-line">
              {drivers.data.map((d) => (
                <li key={d.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setDe(d)}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.name}</span>
                      <span className="block text-xs text-slate-500">
                        {d.phone ?? ''} · SIM {d.simType ?? ''} {d.simNo ?? ''}
                      </span>
                    </span>
                    <span className={`text-xs ${due(d.simExpiry)}`}>SIM to {fmtDate(d.simExpiry) || '-'}</span>
                    <Badge tone={d.isActive ? 'green' : 'gray'}>{d.isActive ? 'active' : 'off'}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'ALERTS' && (
        <Card bodyClass="p-0">
          {!alerts.data?.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nothing expires in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {alerts.data.map((x, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1">
                    {x.ref} · {x.doc}
                  </span>
                  <span className={x.expired ? 'text-red-600' : 'text-amber-700'}>
                    {x.expired ? 'expired' : 'expires'} {fmtDate(x.expiry)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'REPORT' && (
        <Card
          bodyClass="p-0"
          actions={
            <div className="flex gap-2">
              <div className="w-40">
                <DatePicker value={from} clearable={false} onChange={(d) => setFrom(d ?? isoDate())} aria-label="From" />
              </div>
              <div className="w-40">
                <DatePicker value={to} clearable={false} onChange={(d) => setTo(d ?? isoDate())} aria-label="To" />
              </div>
            </div>
          }
          title="Trips finished in the period"
        >
          {!report.data?.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No finished trips in the period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Vehicle</th>
                    <th className="px-2 py-2 text-right">Trips</th>
                    <th className="px-2 py-2 text-right">km</th>
                    <th className="px-2 py-2 text-right">Fuel (l)</th>
                    <th className="px-2 py-2 text-right">km/l</th>
                    <th className="px-2 py-2 text-right">Trip costs</th>
                    <th className="px-2 py-2 text-right">Cost/km</th>
                    <th className="px-4 py-2 text-right">Revenue / margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.data.map((r) => (
                    <tr key={r.vehicleId}>
                      <td className="px-4 py-2">
                        {r.plateNo} · {r.vehicleType}
                      </td>
                      <td className="px-2 py-2 text-right">{r.trips}</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(r.km, 0)}</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(r.fuel, 1)}</td>
                      <td className="px-2 py-2 text-right">{r.kmPerLiter ?? '-'}</td>
                      <td className="px-2 py-2 text-right">{fmtMoney(r.cost, 0)}</td>
                      <td className="px-2 py-2 text-right">{r.costPerKm !== null ? fmtMoney(r.costPerKm, 0) : '-'}</td>
                      <td className="px-4 py-2 text-right">
                        {fmtMoney(r.revenue, 0)} <span className="block text-xs text-slate-500">{fmtMoney(r.margin, 0)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {ve && <VehicleForm v={ve === 'new' ? undefined : ve} onClose={() => setVe(null)} onSaved={() => (setVe(null), refresh())} />}
      {de && <DriverForm d={de === 'new' ? undefined : de} onClose={() => setDe(null)} onSaved={() => (setDe(null), refresh())} />}
    </div>
  );
}

function VehicleForm({ v, onClose, onSaved }: { v?: Vehicle; onClose: () => void; onSaved: () => void }) {
  const ro = !useSession((s) => s.can)('logistics.fleet');
  const [f, setF] = useState({
    plateNo: v?.plateNo ?? '',
    vehicleType: v?.vehicleType ?? 'CDD',
    brand: v?.brand ?? '',
    capacityKg: str(v?.capacityKg ?? 0),
    capacityM3: str(v?.capacityM3 ?? 0),
    ownership: v?.ownership ?? 'OWNED',
    kirExpiry: v?.kirExpiry ?? (null as string | null),
    stnkExpiry: v?.stnkExpiry ?? (null as string | null),
    insuranceExpiry: v?.insuranceExpiry ?? (null as string | null),
    odometer: str(v?.odometer ?? 0),
    status: v?.status ?? 'ACTIVE',
    notes: v?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (v ? api.put(`/logistics/vehicles/${v.id}`, f) : api.post('/logistics/vehicles', f)),
    onSuccess: () => (toast.success('Vehicle saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={v ? v.plateNo : 'New vehicle'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.plateNo} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Plate number" required error={errors.plateNo}>
          <Input disabled={ro} value={f.plateNo} maxLength={20} onChange={(e) => setF({ ...f, plateNo: e.target.value })} />
        </Field>
        <Field label="Type">
          <Select disabled={ro} value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} options={VTYPES.map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="Brand / model">
          <Input disabled={ro} value={f.brand} maxLength={60} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        </Field>
        <Field label="Capacity (kg)" help="Allowed load (JBI / KIR)">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.capacityKg} onChange={(x) => setF({ ...f, capacityKg: x })} />
        </Field>
        <Field label="Capacity (m³)">
          <NumberInput disabled={ro} decimals={1} min={0} value={f.capacityM3} onChange={(x) => setF({ ...f, capacityM3: x })} />
        </Field>
        <Field label="Ownership">
          <Select
            disabled={ro}
            value={f.ownership}
            onChange={(e) => setF({ ...f, ownership: e.target.value })}
            options={[
              { value: 'OWNED', label: 'Owned' },
              { value: 'RENTED', label: 'Rented' },
              { value: 'PARTNER', label: 'Partner' },
            ]}
          />
        </Field>
        <Field label="KIR valid until">
          <DatePicker disabled={ro} value={f.kirExpiry} onChange={(x) => setF({ ...f, kirExpiry: x })} />
        </Field>
        <Field label="STNK valid until">
          <DatePicker disabled={ro} value={f.stnkExpiry} onChange={(x) => setF({ ...f, stnkExpiry: x })} />
        </Field>
        <Field label="Insurance until">
          <DatePicker disabled={ro} value={f.insuranceExpiry} onChange={(x) => setF({ ...f, insuranceExpiry: x })} />
        </Field>
        <Field label="Odometer (km)">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.odometer} onChange={(x) => setF({ ...f, odometer: x })} />
        </Field>
        <Field label="Status">
          <Select
            disabled={ro}
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'MAINTENANCE', label: 'In maintenance' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
        </Field>
        <Field label="Notes" className="sm:col-span-3">
          <Textarea disabled={ro} rows={2} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function DriverForm({ d, onClose, onSaved }: { d?: Driver; onClose: () => void; onSaved: () => void }) {
  const ro = !useSession((s) => s.can)('logistics.fleet');
  const [f, setF] = useState({
    name: d?.name ?? '',
    employeeId: d?.employeeId ?? (null as string | null),
    phone: d?.phone ?? '',
    simType: d?.simType ?? 'B1 Umum',
    simNo: d?.simNo ?? '',
    simExpiry: d?.simExpiry ?? (null as string | null),
    isActive: d?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (d ? api.put(`/logistics/drivers/${d.id}`, f) : api.post('/logistics/drivers', f)),
    onSuccess: () => (toast.success('Driver saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={d ? d.name : 'New driver'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input disabled={ro} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Employee record">
          <AsyncSelect disabled={ro} resource="employees" value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} />
        </Field>
        <Field label="Phone">
          <Input disabled={ro} value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="SIM class">
          <Select
            disabled={ro}
            value={f.simType}
            onChange={(e) => setF({ ...f, simType: e.target.value })}
            options={['A', 'A Umum', 'B1', 'B1 Umum', 'B2', 'B2 Umum'].map((x) => ({ value: x, label: x }))}
          />
        </Field>
        <Field label="SIM number">
          <Input disabled={ro} value={f.simNo} maxLength={30} onChange={(e) => setF({ ...f, simNo: e.target.value })} />
        </Field>
        <Field label="SIM valid until">
          <DatePicker disabled={ro} value={f.simExpiry} onChange={(x) => setF({ ...f, simExpiry: x })} />
        </Field>
        <div className="pt-6 text-sm">
          <Checkbox disabled={ro} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ rate cards
interface Rate {
  id: string;
  customerId: string | null;
  customer: string | null;
  service: string;
  origin: string;
  destination: string;
  vehicleType: string | null;
  basis: string;
  rate: number;
  minCharge: number;
  leadDays: number | null;
  isActive: boolean;
}

export function RatesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Rate | 'new' | null>(null);
  const q = useQuery({ queryKey: ['logistics', 'rates'], queryFn: () => api.get<Rate[]>('/logistics/rates') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rate Cards"
        subtitle="Prices per route, service and vehicle type, per trip, kg or m³ with a minimum; a customer's own rate comes before the general one"
        actions={
          can('logistics.fleet') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New rate
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="tags" title="No rates" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setEdit(r)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.origin} → {r.destination} · {SERVICE[r.service]}
                      {r.vehicleType ? ` · ${r.vehicleType}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.customer ?? 'General price list'}
                      {r.leadDays !== null ? ` · ${r.leadDays} days` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    {fmtMoney(r.rate, 0)} / {r.basis.toLowerCase()}
                    {r.minCharge > 0 && <span className="block text-xs text-slate-500">min {fmtMoney(r.minCharge, 0)}</span>}
                  </span>
                  <Badge tone={r.isActive ? 'green' : 'gray'}>{r.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <RateForm r={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['logistics'] }))} />}
    </div>
  );
}

function RateForm({ r, onClose, onSaved }: { r?: Rate; onClose: () => void; onSaved: () => void }) {
  const ro = !useSession((s) => s.can)('logistics.fleet');
  const [f, setF] = useState({
    customerId: r?.customerId ?? (null as string | null),
    service: r?.service ?? 'TRUCKING',
    origin: r?.origin ?? '',
    destination: r?.destination ?? '',
    vehicleType: r?.vehicleType ?? '',
    basis: r?.basis ?? 'TRIP',
    rate: str(r?.rate),
    minCharge: str(r?.minCharge ?? 0),
    leadDays: str(r?.leadDays),
    isActive: r?.isActive ?? true,
  });
  const save = useMutation({
    mutationFn: () => (r ? api.put(`/logistics/rates/${r.id}`, f) : api.post('/logistics/rates', f)),
    onSuccess: () => (toast.success('Rate saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? 'Rate' : 'New rate'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.origin || !f.destination || !num(f.rate)} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Customer" help="Empty: general price list" className="sm:col-span-2">
          <AsyncSelect disabled={ro} resource="customers" value={f.customerId} initialLabel={r?.customer ?? undefined} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Service">
          <Select disabled={ro} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} options={Object.entries(SERVICE).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="From" required>
          <Input disabled={ro} value={f.origin} maxLength={80} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        </Field>
        <Field label="To" required>
          <Input disabled={ro} value={f.destination} maxLength={80} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        </Field>
        <Field label="Vehicle type">
          <Select disabled={ro} value={f.vehicleType} placeholder="Any" onChange={(e) => setF({ ...f, vehicleType: e.target.value })} options={VTYPES.map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="Per">
          <Select
            disabled={ro}
            value={f.basis}
            onChange={(e) => setF({ ...f, basis: e.target.value })}
            options={[
              { value: 'TRIP', label: 'Trip' },
              { value: 'KG', label: 'kg' },
              { value: 'M3', label: 'm³' },
            ]}
          />
        </Field>
        <Field label="Rate" required>
          <NumberInput disabled={ro} decimals={2} min={0} value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
        </Field>
        <Field label="Minimum charge">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.minCharge} onChange={(v) => setF({ ...f, minCharge: v })} />
        </Field>
        <Field label="Lead time (days)">
          <NumberInput disabled={ro} decimals={0} min={0} value={f.leadDays} onChange={(v) => setF({ ...f, leadDays: v })} />
        </Field>
        <div className="pt-6 text-sm sm:col-span-2">
          <Checkbox disabled={ro} checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}
