import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const t = (kg: number, dp = 1) => `${num(kg / 1000, dp)} t`;
const money = (v: number, cur: string, dp = 0) => (cur === 'IDR' ? fmtMoney(v, dp) : `${cur} ${fmtNumber(v, 2)}`);
const STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'green' },
  COMPLETED: { label: 'Completed', tone: 'blue' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};
const SHIP: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Loading', tone: 'amber' },
  SHIPPED: { label: 'PEB recorded', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};

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
function Bar({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${p >= 100 ? 'bg-emerald-500' : 'bg-brand-600'}`} style={{ width: `${p}%` }} />
    </div>
  );
}

// ============================================================ contracts
interface ContractRow {
  id: string;
  number: string;
  buyerRef: string | null;
  date: string;
  customerId: string;
  productId: string;
  customer: string;
  product: string;
  market: string;
  channel: string;
  incoterm: string;
  deliveryPoint: string | null;
  qtyKg: number;
  tolerancePct: number;
  currencyCode: string;
  price: number;
  priceUnit: string;
  taxId: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
  spec: { ffaMax?: number | null; miMax?: number | null; dobiMin?: number | null };
  claims: { ffaRatePct?: number | null; miDeductWeight?: boolean | null; dobiRatePct?: number | null };
  paymentTerms: string | null;
  status: string;
  notes: string | null;
  deliveredKg: number;
  remainingKg: number;
  maxKg: number;
  minKg: number;
  canDeliverKg: number;
  fulfilled: boolean;
}

export function ContractsPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('OPEN');
  const [market, setMarket] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['commodity', 'contracts', status, market],
    queryFn: () => api.get<ContractRow[]>('/commodity/contracts', { status: status || undefined, market: market || undefined }),
  });
  const rows = q.data ?? [];
  const open = rows.filter((r) => r.status === 'OPEN');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Contracts"
        subtitle="CPO, palm kernel and other bulk sales: direct or KPBN tender (Franco / Loco), and export (FOB / CFR / CIF); deliveries with quality claims and the position of each contract"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            <div className="w-36">
              <Select
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                placeholder="All markets"
                options={[
                  { value: 'DOMESTIC', label: 'Domestic' },
                  { value: 'EXPORT', label: 'Export' },
                ]}
              />
            </div>
            {can('commodity.contract.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New contract
              </Button>
            )}
          </div>
        }
      />
      {open.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open contracts" value={fmtNumber(open.length)} />
          <Stat label="Contracted" value={t(open.reduce((a, r) => a + r.qtyKg, 0))} />
          <Stat label="Delivered" value={t(open.reduce((a, r) => a + r.deliveredKg, 0))} />
          <Stat label="Still to deliver" value={t(open.reduce((a, r) => a + r.remainingKg, 0))} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="file-signature" title="No contracts" description="Make a contract for each sale or won tender, then deliver against it" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left text-sm hover:bg-slate-50 sm:grid-cols-[1fr_16rem]"
                  onClick={() => navigate(`/commodity/contracts/${r.id}`)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {r.number}
                      {r.buyerRef ? ` · ${r.buyerRef}` : ''} · {r.customer}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.product} · {r.market === 'EXPORT' ? 'Export' : r.channel === 'TENDER' ? 'KPBN tender' : 'Domestic'} {r.incoterm}
                      {r.deliveryPoint ? ` ${r.deliveryPoint}` : ''} · {t(r.qtyKg)} ± {r.tolerancePct}% · {money(r.price, r.currencyCode, 2)} / {r.priceUnit === 'MT' ? 'MT' : 'kg'}
                      {r.deliveryTo ? ` · deliver by ${fmtDate(r.deliveryTo)}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col justify-center gap-1">
                    <span className="flex items-center justify-between text-xs text-slate-500">
                      <span>
                        {t(r.deliveredKg)} of {t(r.qtyKg)}
                      </span>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </span>
                    <Bar value={r.deliveredKg} max={r.qtyKg} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <ContractEditor onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), navigate(`/commodity/contracts/${id}`))} />}
    </div>
  );
}

function ContractEditor({ contract, onClose, onSaved }: { contract?: Omit<ContractRow, 'customer' | 'product'>; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const c = contract;
  const [f, setF] = useState({
    buyerRef: c?.buyerRef ?? '',
    date: c?.date.slice(0, 10) ?? isoDate(),
    customerId: c?.customerId ?? (null as string | null),
    productId: c?.productId ?? (null as string | null),
    market: c?.market ?? 'DOMESTIC',
    channel: c?.channel ?? 'DIRECT',
    incoterm: c?.incoterm ?? 'FRANCO',
    deliveryPoint: c?.deliveryPoint ?? '',
    qtyKg: c ? String(c.qtyKg) : '',
    tolerancePct: c ? String(c.tolerancePct) : '0',
    currencyCode: c?.currencyCode ?? 'IDR',
    price: c ? String(c.price) : '',
    priceUnit: c?.priceUnit ?? 'KG',
    taxId: c?.taxId ?? (null as string | null),
    deliveryFrom: c?.deliveryFrom?.slice(0, 10) ?? '',
    deliveryTo: c?.deliveryTo?.slice(0, 10) ?? '',
    ffaMax: c?.spec.ffaMax !== undefined && c?.spec.ffaMax !== null ? String(c?.spec.ffaMax) : '5',
    miMax: c?.spec.miMax !== undefined && c?.spec.miMax !== null ? String(c?.spec.miMax) : '0.5',
    dobiMin: c?.spec.dobiMin !== undefined && c?.spec.dobiMin !== null ? String(c?.spec.dobiMin) : '',
    ffaRatePct: c?.claims.ffaRatePct !== undefined && c?.claims.ffaRatePct !== null ? String(c?.claims.ffaRatePct) : '',
    miDeductWeight: c?.claims.miDeductWeight ?? true,
    dobiRatePct: c?.claims.dobiRatePct !== undefined && c?.claims.dobiRatePct !== null ? String(c?.claims.dobiRatePct) : '',
    paymentTerms: c?.paymentTerms ?? '',
    notes: c?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const exportMarket = f.market === 'EXPORT';
  const save = useMutation({
    mutationFn: () => {
      const nn = (v: string) => (v === '' ? null : v);
      const body = {
        buyerRef: f.buyerRef,
        date: f.date,
        customerId: f.customerId,
        productId: f.productId,
        market: f.market,
        channel: exportMarket ? 'DIRECT' : f.channel,
        incoterm: f.incoterm,
        deliveryPoint: f.deliveryPoint,
        qtyKg: f.qtyKg,
        tolerancePct: f.tolerancePct || 0,
        currencyCode: f.currencyCode,
        price: f.price,
        priceUnit: f.priceUnit,
        taxId: exportMarket ? null : f.taxId,
        deliveryFrom: nn(f.deliveryFrom),
        deliveryTo: nn(f.deliveryTo),
        spec: { ffaMax: nn(f.ffaMax), miMax: nn(f.miMax), dobiMin: nn(f.dobiMin) },
        claims: { ffaRatePct: nn(f.ffaRatePct), miDeductWeight: f.miDeductWeight, dobiRatePct: nn(f.dobiRatePct) },
        paymentTerms: f.paymentTerms,
        notes: f.notes,
      };
      return c ? api.put<{ id: string }>(`/commodity/contracts/${c.id}`, body) : api.post<{ id: string }>('/commodity/contracts', body);
    },
    onSuccess: (r) => (toast.success('Contract saved'), qc.invalidateQueries({ queryKey: ['commodity'] }), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={c ? `Edit contract ${c.number}` : 'New sales contract'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId || !f.productId || !f.qtyKg || !f.price} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Market">
          <Select
            value={f.market}
            onChange={(e) =>
              setF({
                ...f,
                market: e.target.value,
                incoterm: e.target.value === 'EXPORT' ? 'FOB' : 'FRANCO',
                currencyCode: e.target.value === 'EXPORT' ? 'USD' : 'IDR',
                priceUnit: e.target.value === 'EXPORT' ? 'MT' : 'KG',
              })
            }
            options={[
              { value: 'DOMESTIC', label: 'Domestic' },
              { value: 'EXPORT', label: 'Export' },
            ]}
          />
        </Field>
        {!exportMarket && (
          <Field label="Channel">
            <Select
              value={f.channel}
              onChange={(e) => set('channel')(e.target.value)}
              options={[
                { value: 'DIRECT', label: 'Direct sale' },
                { value: 'TENDER', label: 'KPBN tender' },
              ]}
            />
          </Field>
        )}
        <Field label="Terms" error={errors.incoterm}>
          <Select
            value={f.incoterm}
            onChange={(e) => set('incoterm')(e.target.value)}
            options={
              exportMarket
                ? ['FOB', 'CFR', 'CIF'].map((x) => ({ value: x, label: x }))
                : [
                    { value: 'FRANCO', label: 'Franco (delivered to the buyer)' },
                    { value: 'LOCO', label: 'Loco (collected at the mill)' },
                  ]
            }
          />
        </Field>
        <Field label={exportMarket ? 'Port' : 'Delivery point'}>
          <Input value={f.deliveryPoint} maxLength={150} onChange={(e) => set('deliveryPoint')(e.target.value)} />
        </Field>
        <Field label="Buyer" required className="sm:col-span-2" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={set('customerId')} />
        </Field>
        <Field label="Product" required error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} onChange={set('productId')} />
        </Field>
        <Field label={f.channel === 'TENDER' ? 'Tender contract no.' : 'Buyer contract no.'}>
          <Input value={f.buyerRef} maxLength={60} onChange={(e) => set('buyerRef')(e.target.value)} />
        </Field>
        <Field label="Contract date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        <Field label="Quantity (kg)" required error={errors.qtyKg}>
          <NumberInput decimals={0} min={0} value={f.qtyKg} onChange={set('qtyKg')} />
        </Field>
        <Field label="Tolerance ± %">
          <NumberInput decimals={2} min={0} max={20} value={f.tolerancePct} onChange={set('tolerancePct')} />
        </Field>
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <Field label="Currency" error={errors.currencyCode}>
            <Input value={f.currencyCode} maxLength={3} onChange={(e) => set('currencyCode')(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Price unit">
            <Select
              value={f.priceUnit}
              onChange={(e) => set('priceUnit')(e.target.value)}
              options={[
                { value: 'KG', label: 'per kg' },
                { value: 'MT', label: 'per MT' },
              ]}
            />
          </Field>
        </div>
        <Field label={`Price per ${f.priceUnit === 'MT' ? 'MT' : 'kg'} (excl. PPN)`} required error={errors.price}>
          <NumberInput decimals={4} min={0} value={f.price} onChange={set('price')} />
        </Field>
        {!exportMarket && (
          <Field label="PPN" help="Domestic CPO: PPN 12% x DPP 11/12 when the company is PKP" error={errors.taxId}>
            <AsyncSelect resource="taxes" value={f.taxId} onChange={set('taxId')} />
          </Field>
        )}
        <Field label="Deliver from">
          <DatePicker value={f.deliveryFrom} onChange={(v) => set('deliveryFrom')(v ?? '')} />
        </Field>
        <Field label="Deliver by" error={errors.deliveryTo}>
          <DatePicker value={f.deliveryTo} onChange={(v) => set('deliveryTo')(v ?? '')} />
        </Field>
        <Field label="Payment terms" className="sm:col-span-2">
          <Input value={f.paymentTerms} maxLength={150} placeholder="7 days after delivery / 100% against documents..." onChange={(e) => set('paymentTerms')(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <p className="col-span-2 text-xs font-medium text-slate-600 sm:col-span-3 lg:col-span-6">Quality and claims</p>
        <Field label="FFA max %">
          <NumberInput decimals={2} min={0} max={100} value={f.ffaMax} onChange={set('ffaMax')} />
        </Field>
        <Field label="Price cut per 1% FFA above" help="% of the price, pro rata">
          <NumberInput decimals={3} min={0} max={100} value={f.ffaRatePct} onChange={set('ffaRatePct')} />
        </Field>
        <Field label="M&I max %">
          <NumberInput decimals={2} min={0} max={100} value={f.miMax} onChange={set('miMax')} />
        </Field>
        <div className="flex items-end pb-2">
          <Switch checked={f.miDeductWeight} onChange={set('miDeductWeight')} label="Excess M&I off the weight" />
        </div>
        <Field label="DOBI min">
          <NumberInput decimals={2} min={0} max={10} value={f.dobiMin} onChange={set('dobiMin')} />
        </Field>
        <Field label="Price cut per 0.1 DOBI below" help="% of the price">
          <NumberInput decimals={3} min={0} max={100} value={f.dobiRatePct} onChange={set('dobiRatePct')} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
    </Modal>
  );
}

interface DeliveryRow {
  id: string;
  number: string;
  date: string;
  status: string;
  warehouse: string;
  vehicle: string | null;
  sealNo: string | null;
  qtyKg: number;
  ffa: number | null;
  mi: number | null;
  dobi: number | null;
  claimPct: number;
  claimKg: number;
  invoiceKg: number;
  unitPrice: number;
  amount: number;
  shipmentId: string | null;
  delivery: { id: string; number: string } | null;
  invoice: { id: string; number: string } | null;
}
interface ShipmentRow {
  id: string;
  number: string;
  status: string;
  vessel: string | null;
  pebNo: string | null;
  pebDate: string | null;
  qtyKg: number;
  fobUsd: number;
  dutyIdr: number;
  levyIdr: number;
  destinationCountry: string | null;
  dheReceivedDate: string | null;
  contract?: { id: string; number: string; buyer: string; currencyCode: string } | null;
}
interface ContractDetail extends Omit<ContractRow, 'customer' | 'product'> {
  customer: { id: string; code: string; name: string };
  product: { id: string; code: string; name: string; hsCode: string | null };
  tax: { code: string; name: string } | null;
  invoicedKg: number;
  claimKg: number;
  amount: number;
  deliveries: DeliveryRow[];
  shipments: ShipmentRow[];
}

export function ContractPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'edit' | 'deliver' | 'shipment'>('');
  const [sel, setSel] = useState<string[]>([]);
  const q = useQuery({ queryKey: ['commodity', 'contract', id], queryFn: () => api.get<ContractDetail>(`/commodity/contracts/${id}`) });
  const refresh = () => (setModal(''), setSel([]), qc.invalidateQueries({ queryKey: ['commodity'] }));
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/commodity/contracts/${id}/status`, { status: s }),
    onSuccess: () => (toast.success('Contract updated'), refresh()),
    onError: (e) => toast.error(e),
  });
  const cancelDel = useMutation({
    mutationFn: (did: string) => api.post(`/commodity/deliveries/${did}/cancel`),
    onSuccess: () => (toast.success('Delivery cancelled: oil back in the tank'), refresh()),
    onError: (e) => toast.error(e),
  });
  const invoice = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>(`/commodity/contracts/${id}/invoice`, { deliveryIds: sel }),
    onSuccess: (r) => (toast.success(`Draft invoice ${r.number}`), refresh(), navigate(`/documents/SI/${r.id}`)),
    onError: (e) => toast.error(e),
  });
  const c = q.data;
  if (q.isLoading || !c) return <Loading />;
  const open = c.status === 'OPEN';
  const invoiceable = c.deliveries.filter((d) => d.status === 'POSTED' && !d.invoice);
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/commodity/contracts')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Contract {c.number} <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
            <Badge tone={c.market === 'EXPORT' ? 'violet' : 'blue'}>{c.market === 'EXPORT' ? 'Export' : c.channel === 'TENDER' ? 'KPBN tender' : 'Domestic'}</Badge>
          </span>
        }
        subtitle={`${c.customer.name}${c.buyerRef ? ` · ${c.buyerRef}` : ''} · ${c.product.name} · ${c.incoterm}${c.deliveryPoint ? ` ${c.deliveryPoint}` : ''}`}
        actions={
          <>
            {open && can('commodity.deliver') && (
              <Button icon="truck" onClick={() => setModal('deliver')}>
                Delivery
              </Button>
            )}
            {open && c.market === 'EXPORT' && can('commodity.export') && (
              <Button variant="outline" icon="ship" onClick={() => setModal('shipment')}>
                New shipment
              </Button>
            )}
            {open && can('commodity.contract.manage') && (
              <>
                <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  icon="check-check"
                  onClick={async () =>
                    (await confirm({ title: `Complete ${c.number}?`, message: c.fulfilled ? undefined : `Only ${t(c.deliveredKg)} of ${t(c.qtyKg)} delivered.` })) && status.mutate('COMPLETED')
                  }
                >
                  Complete
                </Button>
                {!c.deliveries.some((d) => d.status === 'POSTED') && (
                  <Button variant="ghost" icon="x" onClick={async () => (await confirm({ title: `Cancel ${c.number}?`, danger: true, confirmText: 'Cancel contract' })) && status.mutate('CANCELLED')}>
                    Cancel
                  </Button>
                )}
              </>
            )}
            {c.status === 'COMPLETED' && can('commodity.contract.manage') && (
              <Button variant="outline" icon="undo-2" onClick={() => status.mutate('OPEN')}>
                Reopen
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contracted" value={t(c.qtyKg)} hint={`± ${c.tolerancePct}% (${t(c.minKg)} - ${t(c.maxKg)})`} />
        <Stat label="Delivered" value={t(c.deliveredKg)} hint={c.fulfilled ? 'within the tolerance' : `${t(c.remainingKg)} to go`} />
        <Stat label="Claimed" value={`${num(c.claimKg, 0)} kg`} hint="M&I off the weight" />
        <Stat label="Value" value={money(c.amount, c.currencyCode)} hint={`${money(c.price, c.currencyCode, 2)} / ${c.priceUnit === 'MT' ? 'MT' : 'kg'}${c.tax ? ` + ${c.tax.code}` : ''}`} />
      </div>
      <Card title="Terms">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Dt label="Contract date">{fmtDate(c.date)}</Dt>
          <Dt label="Delivery">{c.deliveryFrom || c.deliveryTo ? `${c.deliveryFrom ? fmtDate(c.deliveryFrom) : '...'} - ${c.deliveryTo ? fmtDate(c.deliveryTo) : '...'}` : '-'}</Dt>
          <Dt label="Payment">{c.paymentTerms ?? '-'}</Dt>
          <Dt label="HS code">{c.product.hsCode ?? '-'}</Dt>
          <Dt label="FFA">
            max {c.spec.ffaMax ?? '-'}%{c.claims.ffaRatePct ? ` · ${c.claims.ffaRatePct}% price per 1% above` : ''}
          </Dt>
          <Dt label="Moisture & impurities">
            max {c.spec.miMax ?? '-'}%{c.claims.miDeductWeight ? ' · excess off the weight' : ''}
          </Dt>
          <Dt label="DOBI">{c.spec.dobiMin ? `min ${c.spec.dobiMin}${c.claims.dobiRatePct ? ` · ${c.claims.dobiRatePct}% per 0.1 below` : ''}` : '-'}</Dt>
          <Dt label="Notes">{c.notes ?? '-'}</Dt>
        </dl>
      </Card>
      {c.market === 'EXPORT' && (
        <Card title="Shipments" bodyClass="p-0">
          {!c.shipments.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No shipment yet: make one for each vessel, then load the deliveries on it.</p>
          ) : (
            <ul className="divide-y divide-line">
              {c.shipments.map((s) => (
                <li key={s.id}>
                  <Link to={`/commodity/shipments/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.number}</span> · {s.vessel ?? 'vessel not set'} · {t(s.qtyKg)}
                      {s.pebNo ? ` · PEB ${s.pebNo} ${s.pebDate ? fmtDate(s.pebDate) : ''}` : ''}
                    </span>
                    <Badge tone={SHIP[s.status].tone}>{SHIP[s.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card
        title="Deliveries"
        subtitle="Each delivery takes the oil out of the tank (confirmed delivery order); the quality fixes the claim"
        actions={
          can('commodity.invoice') &&
          invoiceable.length > 0 && (
            <Button size="sm" icon="file-text" disabled={!sel.length} loading={invoice.isPending} onClick={() => invoice.mutate()}>
              Invoice {sel.length || ''}
            </Button>
          )
        }
        bodyClass="p-0"
      >
        {!c.deliveries.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] whitespace-nowrap text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-2 py-2 text-left">Delivery</th>
                  <th className="px-2 py-2 text-left">Vehicle</th>
                  <th className="px-2 py-2 text-right">Kg loaded</th>
                  <th className="px-2 py-2 text-right">FFA</th>
                  <th className="px-2 py-2 text-right">M&I</th>
                  <th className="px-2 py-2 text-right">DOBI</th>
                  <th className="px-2 py-2 text-right">Claim</th>
                  <th className="px-2 py-2 text-right">Kg invoiced</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-2 py-2 text-left">Invoice</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.deliveries.map((d) => (
                  <tr key={d.id} className={d.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                    <td className="px-3 py-2">
                      {d.status === 'POSTED' && !d.invoice && (
                        <Checkbox checked={sel.includes(d.id)} onChange={(v) => setSel(v ? [...sel, d.id] : sel.filter((x) => x !== d.id))} aria-label={`Select ${d.number}`} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {d.number}
                      <span className="block text-xs text-slate-500">
                        {fmtDate(d.date)} · {d.warehouse}
                        {d.delivery ? ` · ${d.delivery.number}` : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {d.vehicle ?? '-'}
                      {d.sealNo && <span className="block text-xs text-slate-500">seal {d.sealNo}</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{num(d.qtyKg, 0)}</td>
                    <td className={`px-2 py-2 text-right ${c.spec.ffaMax !== null && c.spec.ffaMax !== undefined && d.ffa !== null && d.ffa > c.spec.ffaMax ? 'font-medium text-red-600' : ''}`}>
                      {d.ffa ?? '-'}
                    </td>
                    <td className={`px-2 py-2 text-right ${c.spec.miMax !== null && c.spec.miMax !== undefined && d.mi !== null && d.mi > c.spec.miMax ? 'font-medium text-red-600' : ''}`}>
                      {d.mi ?? '-'}
                    </td>
                    <td className={`px-2 py-2 text-right ${c.spec.dobiMin && d.dobi !== null && d.dobi < c.spec.dobiMin ? 'font-medium text-red-600' : ''}`}>{d.dobi ?? '-'}</td>
                    <td className="px-2 py-2 text-right">
                      {d.claimPct || d.claimKg ? `${d.claimPct ? `${num(d.claimPct, 3)}%` : ''}${d.claimPct && d.claimKg ? ' · ' : ''}${d.claimKg ? `${num(d.claimKg, 0)} kg` : ''}` : '-'}
                    </td>
                    <td className="px-2 py-2 text-right">{num(d.invoiceKg, 0)}</td>
                    <td className="px-2 py-2 text-right">{num(d.unitPrice, 2)}</td>
                    <td className="px-2 py-2 text-right">{money(d.amount, c.currencyCode)}</td>
                    <td className="px-2 py-2">
                      {d.invoice ? (
                        <Link to={`/documents/SI/${d.invoice.id}`} className="text-brand-600">
                          {d.invoice.number}
                        </Link>
                      ) : d.status === 'POSTED' ? (
                        <Badge tone="amber">to invoice</Badge>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="pr-2">
                      {d.status === 'POSTED' && !d.invoice && can('commodity.deliver') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="x"
                          aria-label="Cancel delivery"
                          onClick={async () =>
                            (await confirm({
                              title: `Cancel ${d.number}?`,
                              danger: true,
                              message: 'The delivery order is cancelled and the oil goes back into the tank.',
                              confirmText: 'Cancel delivery',
                            })) && cancelDel.mutate(d.id)
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal === 'edit' && <ContractEditor contract={c} onClose={() => setModal('')} onSaved={refresh} />}
      {modal === 'deliver' && <DeliveryModal c={c} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'shipment' && <ShipmentEditor contractId={c.id} onClose={() => setModal('')} onSaved={(sid) => (refresh(), navigate(`/commodity/shipments/${sid}`))} />}
    </div>
  );
}

function DeliveryModal({ c, onClose, onDone }: { c: ContractDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: isoDate(), warehouseId: null as string | null, vehicle: '', sealNo: '', qtyKg: '', ffa: '', mi: '', dobi: '', shipmentId: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const qty = Number(f.qtyKg || 0);
  const preview = useQuery({
    queryKey: ['commodity', 'preview', c.id, f.qtyKg, f.ffa, f.mi, f.dobi],
    queryFn: () =>
      api.post<{ claimPct: number; claimKg: number; invoiceKg: number; unitPrice: number; amount: number; offSpec: boolean }>(`/commodity/contracts/${c.id}/preview`, {
        qtyKg: f.qtyKg,
        ffa: f.ffa || null,
        mi: f.mi || null,
        dobi: f.dobi || null,
      }),
    enabled: qty > 0,
  });
  const loading = c.shipments.filter((s) => s.status === 'DRAFT');
  const save = useMutation({
    mutationFn: () => api.post(`/commodity/contracts/${c.id}/deliveries`, { ...f, ffa: f.ffa || null, mi: f.mi || null, dobi: f.dobi || null, shipmentId: f.shipmentId || null }),
    onSuccess: () => (toast.success('Delivered: delivery order confirmed'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const p = preview.data;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Delivery on ${c.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.warehouseId || !(qty > 0)} onClick={() => save.mutate()}>
          Deliver {qty ? `${fmtNumber(qty)} kg` : ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required error={errors.date}>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => set('date')(v ?? isoDate())} />
        </Field>
        <Field label="From tank / store" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={set('warehouseId')} />
        </Field>
        <Field label="Kg loaded (net)" required help={`up to ${fmtNumber(c.canDeliverKg)} kg on the contract`} error={errors.qtyKg}>
          <NumberInput decimals={0} min={0} value={f.qtyKg} onChange={set('qtyKg')} />
        </Field>
        {c.market === 'EXPORT' && (
          <Field label="Shipment (vessel)" required className="sm:col-span-3" error={errors.shipmentId}>
            <Select
              value={f.shipmentId}
              onChange={(e) => set('shipmentId')(e.target.value)}
              placeholder="Choose"
              options={loading.map((s) => ({ value: s.id, label: `${s.number} · ${s.vessel ?? 'vessel not set'}` }))}
            />
          </Field>
        )}
        <Field label="Truck / barge">
          <Input value={f.vehicle} maxLength={60} onChange={(e) => set('vehicle')(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Seal no.">
          <Input value={f.sealNo} maxLength={60} onChange={(e) => set('sealNo')(e.target.value)} />
        </Field>
        <div />
        <Field label="FFA %" help={c.spec.ffaMax ? `max ${c.spec.ffaMax}` : undefined}>
          <NumberInput decimals={2} min={0} max={100} value={f.ffa} onChange={set('ffa')} />
        </Field>
        <Field label="Moisture & impurities %" help={c.spec.miMax ? `max ${c.spec.miMax}` : undefined}>
          <NumberInput decimals={2} min={0} max={100} value={f.mi} onChange={set('mi')} />
        </Field>
        <Field label="DOBI" help={c.spec.dobiMin ? `min ${c.spec.dobiMin}` : undefined}>
          <NumberInput decimals={2} min={0} max={10} value={f.dobi} onChange={set('dobi')} />
        </Field>
      </div>
      {p && (
        <dl className={`mt-4 grid grid-cols-2 gap-3 rounded-lg p-3 text-sm sm:grid-cols-4 ${p.offSpec ? 'bg-amber-50' : 'bg-slate-50'}`}>
          <Dt label="Claim">
            {p.claimPct ? `${num(p.claimPct, 3)}% price` : 'none'}
            {p.claimKg ? ` · ${num(p.claimKg, 0)} kg` : ''}
          </Dt>
          <Dt label="Kg invoiced">{num(p.invoiceKg, 0)}</Dt>
          <Dt label="Price">{num(p.unitPrice, 2)}</Dt>
          <Dt label="Value">{money(p.amount, c.currencyCode)}</Dt>
        </dl>
      )}
    </Modal>
  );
}

// ============================================================ export shipments
interface ShipmentDetail extends Omit<ShipmentRow, 'contract'> {
  contractId: string;
  npeNo: string | null;
  npeDate: string | null;
  blNo: string | null;
  blDate: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  hsCode: string | null;
  surveyorReport: string | null;
  originCertificate: string | null;
  sustainabilityRef: string | null;
  eudrRef: string | null;
  refPriceUsd: number;
  dutyUsdPerMt: number;
  levyUsdPerMt: number;
  rate: number;
  dutyBilling: string | null;
  levyBilling: string | null;
  dheReceivedUsd: number | null;
  dheBank: string | null;
  dheRetainedUsd: number | null;
  dheRetainUntil: string | null;
  notes: string | null;
  contract: Omit<ContractRow, 'customer' | 'product'> & { customer: string };
  product: { name: string; hsCode: string | null } | null;
  deliveries: { id: string; number: string; date: string; status: string; qtyKg: number; invoiceKg: number; amount: number; vehicle: string | null }[];
  reference: { month: string; refPriceUsd: number; dutyUsdPerMt: number; levyPct: number | null; levyUsdPerMt: number | null } | null;
  dheRequired: boolean;
  dheThresholdUsd: number;
}

export function ShipmentsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['commodity', 'shipments', status], queryFn: () => api.get<ShipmentRow[]>('/commodity/shipments', { status: status || undefined }) });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Export Shipments"
        subtitle="One shipment per vessel / PEB: documents, the oil loaded from the tanks, export duty and levy, and the export proceeds. From 1 Jan 2027 CPO and its derivatives are exported through PT Danantara Sumberdaya Indonesia (Permendag 16/2026)"
        actions={
          <div className="w-40">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(SHIP).map(([value, s]) => ({ value, label: s.label }))} />
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="ship" title="No shipments" description="Make a shipment from an export contract" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => navigate(`/commodity/shipments/${s.id}`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.number} · {s.vessel ?? 'vessel not set'} · {s.contract?.buyer}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {s.contract?.number} · {t(s.qtyKg)}
                      {s.destinationCountry ? ` to ${s.destinationCountry}` : ''}
                      {s.pebNo ? ` · PEB ${s.pebNo} ${s.pebDate ? fmtDate(s.pebDate) : ''} · FOB USD ${fmtNumber(s.fobUsd)} · duty ${fmtMoney(s.dutyIdr, 0)} · levy ${fmtMoney(s.levyIdr, 0)}` : ''}
                    </span>
                  </span>
                  {s.status === 'SHIPPED' && !s.dheReceivedDate && <Badge tone="amber">proceeds due</Badge>}
                  <Badge tone={SHIP[s.status].tone}>{SHIP[s.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ShipmentEditor({ contractId, shipment, onClose, onSaved }: { contractId: string; shipment?: ShipmentDetail; onClose: () => void; onSaved: (id: string) => void }) {
  const s = shipment;
  const [f, setF] = useState({
    vessel: s?.vessel ?? '',
    blNo: s?.blNo ?? '',
    blDate: s?.blDate?.slice(0, 10) ?? '',
    portOfLoading: s?.portOfLoading ?? '',
    portOfDischarge: s?.portOfDischarge ?? '',
    destinationCountry: s?.destinationCountry ?? '',
    hsCode: s?.hsCode ?? '',
    surveyorReport: s?.surveyorReport ?? '',
    originCertificate: s?.originCertificate ?? '',
    sustainabilityRef: s?.sustainabilityRef ?? '',
    eudrRef: s?.eudrRef ?? '',
    notes: s?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, contractId, blDate: f.blDate || null };
      return s ? api.put<{ id: string }>(`/commodity/shipments/${s.id}`, body) : api.post<{ id: string }>('/commodity/shipments', body);
    },
    onSuccess: (r) => (toast.success('Shipment saved'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const fields: [keyof typeof f, string, number, string?][] = [
    ['vessel', 'Vessel / voyage', 100],
    ['portOfLoading', 'Port of loading', 100],
    ['portOfDischarge', 'Port of discharge', 100],
    ['destinationCountry', 'Destination country (ISO)', 3, 'IN, CN, PK, NL...'],
    ['hsCode', 'HS code', 12, 'empty: from the product'],
    ['blNo', 'Bill of lading no.', 60],
    ['surveyorReport', 'Survey report (draft survey / quality)', 60],
    ['originCertificate', 'Certificate of origin (SKA / COO)', 60],
    ['sustainabilityRef', 'ISPO / RSPO certificate', 100],
    ['eudrRef', 'EUDR due diligence ref.', 100, 'EU buyers'],
  ];
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={s ? `Shipment ${s.number}` : 'New export shipment'}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(([k, label, max, help]) => (
          <Field key={k} label={label} help={help} error={errors[k]}>
            <Input value={f[k]} maxLength={max} onChange={(e) => set(k)(k === 'destinationCountry' ? e.target.value.toUpperCase() : e.target.value)} />
          </Field>
        ))}
        <Field label="B/L date">
          <DatePicker value={f.blDate} max={isoDate()} onChange={(v) => set('blDate')(v ?? '')} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ShipmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'edit' | 'peb' | 'dhe'>('');
  const q = useQuery({ queryKey: ['commodity', 'shipment', id], queryFn: () => api.get<ShipmentDetail>(`/commodity/shipments/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['commodity'] }));
  const unship = useMutation({
    mutationFn: () => api.post(`/commodity/shipments/${id}/unship`),
    onSuccess: () => (toast.success('PEB undone: duty and levy reversed'), refresh()),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/commodity/shipments/${id}/cancel`), onSuccess: () => (toast.success('Shipment cancelled'), refresh()), onError: (e) => toast.error(e) });
  const s = q.data;
  if (q.isLoading || !s) return <Loading />;
  const print = () =>
    printHtml(`<!doctype html><html><head><title>${esc(s.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Export shipment ${esc(s.number)}</h1>
<p>Contract ${esc(s.contract.number)} · ${esc(s.contract.customer)} · ${esc(s.contract.incoterm)} ${esc(s.contract.deliveryPoint ?? '')}</p>
<table><tbody>
<tr><td>Vessel</td><td>${esc(s.vessel ?? '')}</td><td>B/L</td><td>${esc(s.blNo ?? '')} ${s.blDate ? esc(fmtDate(s.blDate)) : ''}</td></tr>
<tr><td>Port of loading</td><td>${esc(s.portOfLoading ?? '')}</td><td>Port of discharge</td><td>${esc(s.portOfDischarge ?? '')} (${esc(s.destinationCountry ?? '')})</td></tr>
<tr><td>PEB</td><td>${esc(s.pebNo ?? '-')} ${s.pebDate ? esc(fmtDate(s.pebDate)) : ''}</td><td>NPE</td><td>${esc(s.npeNo ?? '-')}</td></tr>
<tr><td>HS code</td><td>${esc(s.hsCode ?? '')}</td><td>Surveyor report</td><td>${esc(s.surveyorReport ?? '-')}</td></tr>
<tr><td>Certificate of origin</td><td>${esc(s.originCertificate ?? '-')}</td><td>ISPO / RSPO</td><td>${esc(s.sustainabilityRef ?? '-')}</td></tr>
<tr class="b"><td>Quantity</td><td class="r">${esc(fmtNumber(s.qtyKg))} kg</td><td>FOB</td><td class="r">USD ${esc(fmtNumber(s.fobUsd, 2))}</td></tr>
<tr><td>Reference price</td><td class="r">USD ${esc(fmtNumber(s.refPriceUsd, 2))} / MT</td><td>Rate</td><td class="r">${esc(fmtNumber(s.rate))}</td></tr>
<tr><td>Export duty</td><td class="r">USD ${esc(fmtNumber(s.dutyUsdPerMt, 2))} / MT = ${esc(fmtMoney(s.dutyIdr, 0))}</td><td>Export levy</td><td class="r">USD ${esc(fmtNumber(s.levyUsdPerMt, 2))} / MT = ${esc(fmtMoney(s.levyIdr, 0))}</td></tr></tbody></table>
<h2>Loaded</h2><table><thead><tr><th>Delivery</th><th>Date</th><th>Barge / truck</th><th class="r">Kg</th></tr></thead><tbody>${s.deliveries
      .filter((d) => d.status === 'POSTED')
      .map((d) => `<tr><td>${esc(d.number)}</td><td>${esc(fmtDate(d.date))}</td><td>${esc(d.vehicle ?? '')}</td><td class="r">${esc(fmtNumber(d.qtyKg))}</td></tr>`)
      .join('')}</tbody></table>
</body></html>`);
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/commodity/shipments')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Shipment {s.number} <Badge tone={SHIP[s.status].tone}>{SHIP[s.status].label}</Badge>
          </span>
        }
        subtitle={
          <>
            <Link to={`/commodity/contracts/${s.contractId}`} className="text-brand-600">
              {s.contract.number}
            </Link>{' '}
            · {s.contract.customer} · {s.vessel ?? 'vessel not set'}
          </>
        }
        actions={
          <>
            <Button variant="outline" icon="printer" onClick={print}>
              Print
            </Button>
            {s.status !== 'CANCELLED' && can('commodity.export') && (
              <>
                <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                  Documents
                </Button>
                {s.status === 'DRAFT' && (
                  <Button icon="stamp" onClick={() => setModal('peb')}>
                    Record PEB
                  </Button>
                )}
                {s.status === 'SHIPPED' && (
                  <>
                    <Button icon="landmark" onClick={() => setModal('dhe')}>
                      Export proceeds
                    </Button>
                    <Button
                      variant="ghost"
                      icon="undo-2"
                      loading={unship.isPending}
                      onClick={async () => (await confirm({ title: 'Undo the PEB?', message: 'The duty and levy entries are reversed; loading can continue.' })) && unship.mutate()}
                    >
                      Undo PEB
                    </Button>
                  </>
                )}
                {s.status === 'DRAFT' && (
                  <Button
                    variant="ghost"
                    icon="x"
                    loading={cancel.isPending}
                    onClick={async () => (await confirm({ title: `Cancel ${s.number}?`, danger: true, confirmText: 'Cancel shipment' })) && cancel.mutate()}
                  >
                    Cancel
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Loaded" value={t(s.qtyKg, 3)} hint={`${s.deliveries.filter((d) => d.status === 'POSTED').length} deliveries`} />
        <Stat label="FOB value" value={`USD ${fmtNumber(s.fobUsd, 2)}`} />
        <Stat label="Export duty" value={fmtMoney(s.dutyIdr, 0)} hint={s.status === 'SHIPPED' ? `USD ${num(s.dutyUsdPerMt)} / MT at ${fmtNumber(s.rate)}` : 'at the PEB'} />
        <Stat label="Export levy" value={fmtMoney(s.levyIdr, 0)} hint={s.status === 'SHIPPED' ? `USD ${num(s.levyUsdPerMt)} / MT` : 'at the PEB'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Documents">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label="PEB">{s.pebNo ? `${s.pebNo} · ${s.pebDate ? fmtDate(s.pebDate) : ''}` : '-'}</Dt>
            <Dt label="NPE">{s.npeNo ?? '-'}</Dt>
            <Dt label="Vessel">{s.vessel ?? '-'}</Dt>
            <Dt label="B/L">{s.blNo ? `${s.blNo}${s.blDate ? ` · ${fmtDate(s.blDate)}` : ''}` : '-'}</Dt>
            <Dt label="Route">
              {s.portOfLoading ?? '-'} → {s.portOfDischarge ?? '-'} {s.destinationCountry ? `(${s.destinationCountry})` : ''}
            </Dt>
            <Dt label="HS code">{s.hsCode ?? '-'}</Dt>
            <Dt label="Survey report">{s.surveyorReport ?? '-'}</Dt>
            <Dt label="Certificate of origin">{s.originCertificate ?? '-'}</Dt>
            <Dt label="ISPO / RSPO">{s.sustainabilityRef ?? '-'}</Dt>
            <Dt label="EUDR due diligence">{s.eudrRef ?? '-'}</Dt>
            <Dt label="Duty / levy billing">{[s.dutyBilling, s.levyBilling].filter(Boolean).join(' · ') || '-'}</Dt>
          </dl>
        </Card>
        <Card
          title="Export proceeds (DHE)"
          subtitle={
            s.dheRequired
              ? `FOB from USD ${fmtNumber(s.dheThresholdUsd)}: proceeds into an Indonesian bank and partly retained (PP 36/2023 jo PP 21/2026)`
              : `Below USD ${fmtNumber(s.dheThresholdUsd)} per PEB`
          }
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Dt label="Received">{s.dheReceivedDate ? `${fmtDate(s.dheReceivedDate)} · USD ${fmtNumber(s.dheReceivedUsd ?? 0, 2)}` : 'not yet'}</Dt>
            <Dt label="Bank">{s.dheBank ?? '-'}</Dt>
            <Dt label="Retained">{s.dheRetainedUsd !== null ? `USD ${fmtNumber(s.dheRetainedUsd, 2)}` : '-'}</Dt>
            <Dt label="Retained until">{s.dheRetainUntil ? fmtDate(s.dheRetainUntil) : '-'}</Dt>
          </dl>
        </Card>
      </div>
      <Card title="Loaded from the tanks" subtitle={s.status === 'DRAFT' ? 'Record the deliveries on the contract with this shipment' : undefined} bodyClass="p-0">
        {!s.deliveries.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">Nothing loaded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Delivery</th>
                <th className="px-2 py-2 text-left">Barge / truck</th>
                <th className="px-2 py-2 text-right">Kg</th>
                <th className="px-4 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.deliveries.map((d) => (
                <tr key={d.id} className={d.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                  <td className="px-4 py-2">
                    {d.number} <span className="text-xs text-slate-500">{fmtDate(d.date)}</span>
                  </td>
                  <td className="px-2 py-2">{d.vehicle ?? '-'}</td>
                  <td className="px-2 py-2 text-right">{num(d.qtyKg, 0)}</td>
                  <td className="px-4 py-2 text-right">{money(d.amount, s.contract.currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {modal === 'edit' && <ShipmentEditor contractId={s.contractId} shipment={s} onClose={() => setModal('')} onSaved={refresh} />}
      {modal === 'peb' && <PebModal s={s} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'dhe' && <DheModal s={s} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function PebModal({ s, onClose, onDone }: { s: ShipmentDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ pebNo: '', pebDate: isoDate(), npeNo: '', npeDate: '', rate: '', fobUsd: '', dutyBilling: '', levyBilling: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const r = s.reference;
  const mt = s.qtyKg / 1000;
  const levyPerMt = r ? (r.levyUsdPerMt ? r.levyUsdPerMt : Math.round(r.refPriceUsd * (r.levyPct ?? 0)) / 100) : 0;
  const save = useMutation({
    mutationFn: () => api.post(`/commodity/shipments/${s.id}/ship`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))),
    onSuccess: () => (toast.success('PEB recorded: duty and levy booked'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Record the PEB of ${s.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.pebNo} onClick={() => save.mutate()}>
          Record PEB
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="PEB no." required error={errors.pebNo}>
          <Input value={f.pebNo} maxLength={40} onChange={(e) => set('pebNo')(e.target.value)} />
        </Field>
        <Field label="PEB date" required error={errors.pebDate}>
          <DatePicker value={f.pebDate} max={isoDate()} clearable={false} onChange={(v) => set('pebDate')(v ?? isoDate())} />
        </Field>
        <Field label="NPE no.">
          <Input value={f.npeNo} maxLength={40} onChange={(e) => set('npeNo')(e.target.value)} />
        </Field>
        <Field label="NPE date">
          <DatePicker value={f.npeDate} max={isoDate()} onChange={(v) => set('npeDate')(v ?? '')} />
        </Field>
        <Field
          label="USD rate for duty / levy"
          help="The Minister of Finance (KMK) rate in force when the duty is paid; empty: the USD rate of the PEB date in Accounting > Exchange Rates"
          error={errors.rate}
        >
          <NumberInput decimals={4} min={0} value={f.rate} onChange={set('rate')} />
        </Field>
        <Field label="FOB value (USD)" help="Empty: the value of the deliveries (USD contract)">
          <NumberInput decimals={2} min={0} value={f.fobUsd} onChange={set('fobUsd')} />
        </Field>
        <Field label="Duty billing / NTPN">
          <Input value={f.dutyBilling} maxLength={60} onChange={(e) => set('dutyBilling')(e.target.value)} />
        </Field>
        <Field label="Levy billing (BPDP)">
          <Input value={f.levyBilling} maxLength={60} onChange={(e) => set('levyBilling')(e.target.value)} />
        </Field>
      </div>
      <p className={`mt-3 rounded-lg p-3 text-sm ${r ? 'bg-slate-50' : 'bg-amber-50 text-amber-800'}`}>
        {r ? (
          <>
            {r.month}: reference USD {fmtNumber(r.refPriceUsd, 2)} / MT · duty USD {fmtNumber(r.dutyUsdPerMt, 2)} · levy USD {fmtNumber(levyPerMt, 2)} / MT. For {num(mt, 3)} MT: duty USD{' '}
            {fmtNumber(mt * r.dutyUsdPerMt, 2)}, levy USD {fmtNumber(mt * levyPerMt, 2)}.
          </>
        ) : (
          <>
            No reference price for this month yet:{' '}
            <Link to="/commodity/references" className="text-brand-600">
              enter it
            </Link>{' '}
            from the Kemendag / Kemenkeu announcement.
          </>
        )}
      </p>
    </Modal>
  );
}

function DheModal({ s, onClose, onDone }: { s: ShipmentDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    dheReceivedDate: s.dheReceivedDate?.slice(0, 10) ?? isoDate(),
    dheReceivedUsd: s.dheReceivedUsd !== null ? String(s.dheReceivedUsd) : String(s.fobUsd || ''),
    dheBank: s.dheBank ?? '',
    dheRetainedUsd: s.dheRetainedUsd !== null ? String(s.dheRetainedUsd) : s.dheRequired ? String(s.fobUsd || '') : '',
    dheRetainUntil: s.dheRetainUntil?.slice(0, 10) ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/commodity/shipments/${s.id}/dhe`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))),
    onSuccess: () => (toast.success('Export proceeds recorded'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Export proceeds of ${s.number}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Received on" error={errors.dheReceivedDate}>
          <DatePicker value={f.dheReceivedDate} max={isoDate()} onChange={(v) => setF({ ...f, dheReceivedDate: v ?? '' })} />
        </Field>
        <Field label="Amount received (USD)">
          <NumberInput decimals={2} min={0} value={f.dheReceivedUsd} onChange={(v) => setF({ ...f, dheReceivedUsd: v })} />
        </Field>
        <Field label="Bank (DHE account)" className="sm:col-span-2">
          <Input value={f.dheBank} maxLength={100} onChange={(e) => setF({ ...f, dheBank: e.target.value })} />
        </Field>
        <Field label="Amount retained (USD)" error={errors.dheRetainedUsd}>
          <NumberInput decimals={2} min={0} value={f.dheRetainedUsd} onChange={(v) => setF({ ...f, dheRetainedUsd: v })} />
        </Field>
        <Field label="Retained until" help="Empty: retention period in Settings from the receipt">
          <DatePicker value={f.dheRetainUntil} onChange={(v) => setF({ ...f, dheRetainUntil: v ?? '' })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        From USD {fmtNumber(s.dheThresholdUsd)} per PEB: into the special DHE account (Reksus) at a state-owned bank by the end of the 3rd month after the PEB month, 100% retained for at least 12
        months, at most 50% converted to rupiah (PP 21/2026, PBI 8/2026). Record the receipt itself in Cash & Bank (customer payment of the export invoice).
      </p>
    </Modal>
  );
}

// ============================================================ export register and references
export function RegisterPage() {
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(isoDate());
  const q = useQuery({
    queryKey: ['commodity', 'register', from, to],
    queryFn: () => api.get<(ShipmentDetail & { contract: string; buyer: string; dheDue: string | null; dheLate: boolean })[]>('/commodity/register', { from, to }),
  });
  const rows = q.data ?? [];
  const tot = rows.reduce((a, r) => ({ kg: a.kg + r.qtyKg, fob: a.fob + r.fobUsd, duty: a.duty + r.dutyIdr, levy: a.levy + r.levyIdr }), { kg: 0, fob: 0, duty: 0, levy: 0 });
  const csv = () =>
    downloadCsv(`export-register-${from}-${to}.csv`, [
      [
        'PEB',
        'PEB date',
        'Shipment',
        'Contract',
        'Buyer',
        'Vessel',
        'Destination',
        'HS',
        'Kg',
        'FOB USD',
        'Reference USD/MT',
        'Duty USD/MT',
        'Levy USD/MT',
        'Rate',
        'Duty IDR',
        'Levy IDR',
        'DHE due',
        'DHE received',
        'DHE USD',
        'Retained USD',
        'Retained until',
      ],
      ...rows.map((r) => [
        r.pebNo,
        r.pebDate?.slice(0, 10),
        r.number,
        r.contract,
        r.buyer,
        r.vessel,
        r.destinationCountry,
        r.hsCode,
        r.qtyKg,
        r.fobUsd,
        r.refPriceUsd,
        r.dutyUsdPerMt,
        r.levyUsdPerMt,
        r.rate,
        r.dutyIdr,
        r.levyIdr,
        r.dheDue?.slice(0, 10),
        r.dheReceivedDate?.slice(0, 10),
        r.dheReceivedUsd,
        r.dheRetainedUsd,
        r.dheRetainUntil?.slice(0, 10),
      ]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Export Register & DHE"
        subtitle="Shipments with their PEB in a period: tonnes, FOB value, export duty and levy, and the export proceeds (received, retained, overdue)"
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
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Exported" value={t(tot.kg)} hint={`${rows.length} PEB`} />
          <Stat label="FOB" value={`USD ${fmtNumber(tot.fob, 0)}`} />
          <Stat label="Export duty" value={fmtMoney(tot.duty, 0)} />
          <Stat label="Export levy" value={fmtMoney(tot.levy, 0)} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="file-text" title="No PEB in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] whitespace-nowrap text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">PEB</th>
                  <th className="px-2 py-2 text-left">Buyer / vessel</th>
                  <th className="px-2 py-2 text-right">Tonnes</th>
                  <th className="px-2 py-2 text-right">FOB USD</th>
                  <th className="px-2 py-2 text-right">Duty</th>
                  <th className="px-2 py-2 text-right">Levy</th>
                  <th className="px-4 py-2 text-left">Proceeds (DHE)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <Link to={`/commodity/shipments/${r.id}`} className="font-medium text-brand-600">
                        {r.pebNo}
                      </Link>
                      <span className="block text-xs text-slate-500">{r.pebDate ? fmtDate(r.pebDate) : ''}</span>
                    </td>
                    <td className="px-2 py-2">
                      {r.buyer}
                      <span className="block text-xs text-slate-500">
                        {r.vessel ?? '-'} {r.destinationCountry ? `→ ${r.destinationCountry}` : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">{num(r.qtyKg / 1000, 3)}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(r.fobUsd, 2)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.dutyIdr, 0)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.levyIdr, 0)}</td>
                    <td className="px-4 py-2">
                      {r.dheReceivedDate ? (
                        <span className="text-xs">
                          received {fmtDate(r.dheReceivedDate)}
                          {r.dheRetainUntil ? ` · retained to ${fmtDate(r.dheRetainUntil)}` : ''}
                        </span>
                      ) : r.dheLate ? (
                        <Badge tone="red">overdue since {r.dheDue ? fmtDate(r.dheDue) : ''}</Badge>
                      ) : r.dheRequired ? (
                        <Badge tone="amber">due by {r.dheDue ? fmtDate(r.dheDue) : ''}</Badge>
                      ) : (
                        <span className="text-xs text-slate-500">below threshold</span>
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

export function ReferencesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['commodity', 'references'],
    queryFn: () =>
      api.get<{ id: string; month: string; product: string; refPriceUsd: number; dutyUsdPerMt: number; levyPct: number | null; levyUsdPerMt: number | null; reference: string | null }[]>(
        '/commodity/references',
      ),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/commodity/references/${id}`),
    onSuccess: () => (toast.success('Removed'), qc.invalidateQueries({ queryKey: ['commodity'] })),
    onError: (e) => toast.error(e),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Reference Prices, Duty & Levy"
        subtitle="Each month: the reference price set by Kemendag, the export duty per ton of its bracket (Kemenkeu) and the export levy (% of the reference price or per ton), used when a PEB is recorded"
        actions={
          can('commodity.export') && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              Month
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="landmark" title="No reference prices yet" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Month</th>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-right">Reference USD/MT</th>
                <th className="px-2 py-2 text-right">Duty USD/MT</th>
                <th className="px-2 py-2 text-right">Levy</th>
                <th className="px-2 py-2 text-left">Source</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.month}</td>
                  <td className="px-2 py-2">{r.product}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(r.refPriceUsd, 2)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(r.dutyUsdPerMt, 2)}</td>
                  <td className="px-2 py-2 text-right">{r.levyUsdPerMt ? `USD ${fmtNumber(r.levyUsdPerMt, 2)}/MT` : `${r.levyPct}%`}</td>
                  <td className="px-2 py-2 text-xs">{r.reference ?? '-'}</td>
                  <td className="pr-2">
                    {can('commodity.export') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash-2"
                        aria-label="Remove"
                        onClick={async () => (await confirm({ title: `Remove ${r.month}?`, danger: true, confirmText: 'Remove' })) && del.mutate(r.id)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding && <ReferenceModal onClose={() => setAdding(false)} onDone={() => (setAdding(false), qc.invalidateQueries({ queryKey: ['commodity'] }))} />}
    </div>
  );
}

function ReferenceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ month: isoDate().slice(0, 7), productId: null as string | null, refPriceUsd: '', dutyUsdPerMt: '', levyBy: 'pct', levyPct: '12.5', levyUsdPerMt: '', reference: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api.post('/commodity/references', {
        month: f.month,
        productId: f.productId,
        refPriceUsd: f.refPriceUsd,
        dutyUsdPerMt: f.dutyUsdPerMt || 0,
        levyPct: f.levyBy === 'pct' ? f.levyPct || null : null,
        levyUsdPerMt: f.levyBy === 'mt' ? f.levyUsdPerMt || null : null,
        reference: f.reference || null,
      }),
    onSuccess: () => (toast.success('Reference saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Reference price of a month"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.productId || !f.refPriceUsd} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Month" required error={errors.month}>
          <Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </Field>
        <Field label="Product" required error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="Reference price (USD / MT)" required error={errors.refPriceUsd}>
          <NumberInput decimals={2} min={0} value={f.refPriceUsd} onChange={(v) => setF({ ...f, refPriceUsd: v })} />
        </Field>
        <Field label="Export duty (USD / MT)" help="From the bracket of the reference price (0 at or below the lowest bracket)">
          <NumberInput decimals={2} min={0} value={f.dutyUsdPerMt} onChange={(v) => setF({ ...f, dutyUsdPerMt: v })} />
        </Field>
        <Field label="Export levy by">
          <Select
            value={f.levyBy}
            onChange={(e) => setF({ ...f, levyBy: e.target.value })}
            options={[
              { value: 'pct', label: '% of the reference price' },
              { value: 'mt', label: 'USD per MT' },
            ]}
          />
        </Field>
        {f.levyBy === 'pct' ? (
          <Field label="Levy %" error={errors.levyPct}>
            <NumberInput decimals={3} min={0} max={100} value={f.levyPct} onChange={(v) => setF({ ...f, levyPct: v })} />
          </Field>
        ) : (
          <Field label="Levy USD / MT" error={errors.levyPct}>
            <NumberInput decimals={2} min={0} value={f.levyUsdPerMt} onChange={(v) => setF({ ...f, levyUsdPerMt: v })} />
          </Field>
        )}
        <Field label="Source" className="sm:col-span-2" help="Kepmendag / PMK reference">
          <Input value={f.reference} maxLength={200} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
