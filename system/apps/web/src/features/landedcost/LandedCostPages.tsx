import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const STATUS: Record<string, { label: string; tone: Tone }> = { DRAFT: { label: 'Draft', tone: 'gray' }, POSTED: { label: 'Posted', tone: 'green' }, CANCELLED: { label: 'Cancelled', tone: 'red' } };
const CHARGE_LABEL: Record<string, string> = {
  FREIGHT: 'Freight',
  INSURANCE: 'Cargo insurance',
  BROKER: 'Customs broker (PPJK)',
  PORT: 'Port charges (THC, port storage, handling)',
  TRUCKING: 'Trucking to the warehouse',
  STORAGE: 'Storage before receipt',
  OTHER: 'Other import charges',
};
const METHOD: Record<string, string> = { VALUE: 'by value', QTY: 'by quantity', WEIGHT: 'by weight' };
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'];
const CIF_TERMS = ['CIF', 'CIP', 'DAP', 'DPU', 'DDP'];
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);

interface Row {
  id: string;
  number: string;
  date: string;
  status: string;
  supplier: string | null;
  pibNo: string | null;
  receipts: string[];
  bm: number;
  bmad: number;
  ppn: number;
  ppnbm: number;
  pph22: number;
  charges: number;
  toInventory: number;
  toCogs: number;
}

export function LandedCostsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'DRAFT' | 'POSTED' | 'CANCELLED'>('ALL');
  const q = useQuery({ queryKey: ['landed-costs', status], queryFn: () => api.get<Row[]>('/landed-costs', status === 'ALL' ? {} : { status }) });
  const setup = useQuery({
    queryKey: ['landed-costs', 'setup'],
    queryFn: () => api.get<{ missing: string[]; products: { id: string; code: string; name: string }[]; clearing: { code: string; name: string; balance: number } | null }>('/landed-costs/setup'),
  });
  const make = useMutation({
    mutationFn: () => api.post('/landed-costs/setup'),
    onSuccess: () => (toast.success('Charge products made'), qc.invalidateQueries({ queryKey: ['landed-costs'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Landed Costs"
        subtitle="Import duties and taxes of the PIB and the charges of getting goods in (freight, insurance, broker, port, trucking), added to the cost of goods received; the share of goods already sold goes to cost of sales"
        actions={
          can('purchase.landedcost.manage') && (
            <Button icon="plus" onClick={() => navigate('/purchase/landed-costs/new')}>
              New landed cost
            </Button>
          )
        }
      />
      {setup.data && (
        <Card bodyClass="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            {setup.data.missing.length ? (
              <>Book forwarder, insurer and broker invoices on the LC-* service products so they wait on Landed Costs Clearing until spread here.</>
            ) : (
              <>Charge products: {setup.data.products.map((p) => p.code).join(', ')}. Invoices on them wait on Landed Costs Clearing until spread here.</>
            )}
            {setup.data.clearing && (
              <span className="block text-xs text-slate-500">
                {setup.data.clearing.code} {setup.data.clearing.name}: {fmtMoney(setup.data.clearing.balance, 0)} not yet spread
              </span>
            )}
          </span>
          {setup.data.missing.length > 0 && can('purchase.landedcost.manage') && (
            <Button size="sm" variant="outline" icon="plus" loading={make.isPending} onClick={() => make.mutate()}>
              Make charge products
            </Button>
          )}
        </Card>
      )}
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'ALL', label: 'All' },
          { value: 'DRAFT', label: 'Draft' },
          { value: 'POSTED', label: 'Posted' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="ship" title="No landed costs" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link to={`/purchase/landed-costs/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {fmtDate(r.date)} {r.pibNo ? `· PIB ${r.pibNo}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.supplier} · {r.receipts.join(', ')} · duties {fmtMoney(r.bm + r.bmad + r.ppnbm, 0)} · PPN {fmtMoney(r.ppn, 0)} · PPh 22 {fmtMoney(r.pph22, 0)} · charges{' '}
                      {fmtMoney(r.charges, 0)}
                    </span>
                  </span>
                  {r.status === 'POSTED' && (
                    <span className="text-right text-xs">
                      stock {fmtMoney(r.toInventory, 0)}
                      {r.toCogs > 0 && <span className="block text-slate-500">cost of sales {fmtMoney(r.toCogs, 0)}</span>}
                    </span>
                  )}
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface LineIn {
  receiptLineId: string;
  receipt: string | null;
  product: { code: string; name: string } | null;
  qty: number;
  valueFx: number;
  value: number;
  hsCode: string;
  weight: string;
  bmPct: string;
  bmadPct: string;
  ppnbmPct: string;
  pph22Pct: string;
}
interface Detail {
  id: string;
  number: string;
  status: string;
  date: string;
  reference: string | null;
  supplier: string | null;
  pibNo: string | null;
  pibDate: string | null;
  incoterm: string;
  currencyCode: string;
  ndpbm: number;
  freightFx: number;
  insuranceFx: number;
  apiHolder: boolean;
  ppnCreditable: boolean;
  bmActual: number | null;
  ppnActual: number | null;
  pph22Actual: number | null;
  customsValue: number;
  bm: number;
  bmad: number;
  ppn: number;
  ppnbm: number;
  pph22: number;
  charges: number;
  toInventory: number;
  toCogs: number;
  notes: string | null;
  receiptIds: string[];
  lines: {
    id: string;
    receiptLineId: string;
    receipt: string | null;
    product: { code: string; name: string } | null;
    warehouse: string | null;
    qty: number;
    valueFx: number;
    value: number;
    weight: number;
    hsCode: string | null;
    bmPct: number;
    bmadPct: number;
    ppnbmPct: number;
    pph22Pct: number | null;
    customsValue: number;
    bm: number;
    bmad: number;
    ppn: number;
    ppnbm: number;
    pph22: number;
    charges: number;
    cost: number;
    qtyOnHand: number;
    toInventory: number;
    toCogs: number;
  }[];
  chargeRows: { type: string; description: string | null; amount: number; method: string; sourceLineId: string | null; invoice: string | null }[];
}
interface ChargeRow {
  type: string;
  description: string;
  amount: string;
  method: string;
  sourceLineId: string;
}
interface OpenCharge {
  lineId: string;
  invoiceId: string;
  invoice: string;
  date: string;
  supplier: string | null;
  type: string;
  description: string | null;
  amount: number;
  open: number;
}
interface ReceiptPick {
  id: string;
  number: string;
  date: string;
  supplier: string | null;
  reference: string | null;
  currencyCode: string;
  exchangeRate: number;
  value: number;
  landedCosts: number;
}
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export function LandedCostFormPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const q = useQuery({ queryKey: ['landed-costs', 'one', id], queryFn: () => api.get<Detail>(`/landed-costs/${id}`), enabled: !isNew });
  if (!isNew && q.isLoading) return <Loading />;
  if (!isNew && !q.data) return <EmptyState icon="ship" title="Landed cost not found" />;
  return <LandedCostForm key={isNew ? 'new' : `${id}-${q.data?.status}`} d={isNew ? undefined : q.data} />;
}

function LandedCostForm({ d }: { d?: Detail }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editable = (!d || d.status === 'DRAFT') && can('purchase.landedcost.manage');
  const savedCharges = d?.chargeRows ?? [];
  const [h, setH] = useState({
    date: d?.date ?? isoDate(),
    reference: d?.reference ?? '',
    pibNo: d?.pibNo ?? '',
    pibDate: d?.pibDate ?? (null as string | null),
    incoterm: d?.incoterm ?? 'CIF',
    ndpbm: str(d?.ndpbm ?? 1),
    freightFx: str(d?.freightFx ?? 0),
    insuranceFx: str(d?.insuranceFx ?? 0),
    apiHolder: d?.apiHolder ?? true,
    ppnCreditable: d?.ppnCreditable ?? true,
    bmActual: str(d?.bmActual),
    ppnActual: str(d?.ppnActual),
    pph22Actual: str(d?.pph22Actual),
    notes: d?.notes ?? '',
  });
  const [receiptIds, setReceiptIds] = useState<string[]>(d?.receiptIds ?? []);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<LineIn[]>(
    d?.lines.map((l) => ({
      receiptLineId: l.receiptLineId,
      receipt: l.receipt,
      product: l.product,
      qty: l.qty,
      valueFx: l.valueFx,
      value: l.value,
      hsCode: l.hsCode ?? '',
      weight: str(l.weight),
      bmPct: str(l.bmPct),
      bmadPct: str(l.bmadPct),
      ppnbmPct: str(l.ppnbmPct),
      pph22Pct: str(l.pph22Pct),
    })) ?? [],
  );
  const [charges, setCharges] = useState<ChargeRow[]>(
    savedCharges.map((c) => ({ type: c.type, description: c.description ?? '', amount: str(c.amount), method: c.method, sourceLineId: c.sourceLineId ?? '' })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const picks = useQuery({ queryKey: ['landed-costs', 'receipts', search], queryFn: () => api.get<ReceiptPick[]>('/landed-costs/receipts', search ? { q: search } : {}), enabled: editable });
  const open = useQuery({ queryKey: ['landed-costs', 'open-charges'], queryFn: () => api.get<OpenCharge[]>('/landed-costs/open-charges'), enabled: editable });
  const rl = useQuery({
    queryKey: ['landed-costs', 'receipt-lines', receiptIds.join(',')],
    queryFn: () =>
      api.get<{ receiptLineId: string; receipt: string; currencyCode: string; product: { code: string; name: string }; qty: number; valueFx: number; value: number; hsCode: string | null }[]>(
        '/landed-costs/receipt-lines',
        { ids: receiptIds.join(',') },
      ),
    enabled: editable && receiptIds.length > 0,
  });
  // keep the rate rows in step with the receipts chosen
  useEffect(() => {
    if (!rl.data) return;
    setLines((cur) =>
      rl.data.map(
        (r) =>
          cur.find((c) => c.receiptLineId === r.receiptLineId) ?? {
            receiptLineId: r.receiptLineId,
            receipt: r.receipt,
            product: r.product,
            qty: r.qty,
            valueFx: r.valueFx,
            value: r.value,
            hsCode: r.hsCode ?? '',
            weight: '',
            bmPct: '',
            bmadPct: '',
            ppnbmPct: '',
            pph22Pct: '',
          },
      ),
    );
  }, [rl.data]);
  const currency = rl.data?.[0]?.currencyCode ?? d?.currencyCode ?? 'IDR';
  const pickedRows = useMemo(() => (picks.data ?? []).filter((p) => receiptIds.includes(p.id)), [picks.data, receiptIds]);
  const body = () => ({
    ...h,
    pibNo: h.pibNo || null,
    receiptIds,
    lines: lines.map((l) => ({
      receiptLineId: l.receiptLineId,
      hsCode: l.hsCode || null,
      weight: l.weight || 0,
      bmPct: l.bmPct || 0,
      bmadPct: l.bmadPct || 0,
      ppnbmPct: l.ppnbmPct || 0,
      pph22Pct: l.pph22Pct === '' ? null : l.pph22Pct,
    })),
    charges: charges.map((c) => ({ ...c, sourceLineId: c.sourceLineId || null })),
  });
  const save = useMutation({
    mutationFn: () => (d ? api.put<Detail>(`/landed-costs/${d.id}`, body()) : api.post<Detail>('/landed-costs', body())),
    onSuccess: (r) => {
      toast.success(`${r.number} saved`);
      setErrors({});
      qc.invalidateQueries({ queryKey: ['landed-costs'] });
      if (!d) navigate(`/purchase/landed-costs/${r.id}`, { replace: true });
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const act = useMutation({
    mutationFn: (a: 'post' | 'cancel') => api.post<Detail>(`/landed-costs/${d!.id}/${a}`),
    onSuccess: (r) => (toast.success(r.status === 'POSTED' ? `${r.number} posted` : `${r.number} cancelled`), qc.invalidateQueries({ queryKey: ['landed-costs'] })),
    onError: (e) => toast.error(e),
  });
  const setLine = (i: number, k: keyof LineIn, v: string) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const setCharge = (i: number, patch: Partial<ChargeRow>) => setCharges(charges.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const freightInPrice = CIF_TERMS.includes(h.incoterm);
  const chargeErrors = Object.entries(errors).filter(([k]) => k.startsWith('charges'));
  const out = d?.lines ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title={d ? `Landed cost ${d.number}` : 'New landed cost'}
        subtitle={d ? `${d.supplier ?? ''} · ${fmtDate(d.date)}${d.pibNo ? ` · PIB ${d.pibNo}` : ''}` : 'Choose the goods receipts, enter the PIB and the charges, save to see the amounts, then post'}
        actions={
          <div className="flex flex-wrap gap-2">
            {d && <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>}
            {editable && (
              <Button icon="save" variant={d ? 'outline' : 'primary'} loading={save.isPending} disabled={!receiptIds.length} onClick={() => save.mutate()}>
                Save draft
              </Button>
            )}
            {d?.status === 'DRAFT' && can('purchase.landedcost.post') && (
              <Button
                icon="check"
                loading={act.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Post ${d.number}?`,
                    message: 'The costs are added to the stock still on hand (average cost); the share of goods sold since goes to cost of sales. Save first if you changed anything.',
                    confirmText: 'Post',
                  })) && act.mutate('post')
                }
              >
                Post
              </Button>
            )}
            {d && d.status !== 'CANCELLED' && can('purchase.landedcost.post') && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    message:
                      d.status === 'POSTED'
                        ? 'The value comes out of the stock in proportion to what is left of it, the rest out of cost of sales; the payable and the clearing are given back.'
                        : 'The draft is dropped.',
                    danger: true,
                    confirmText: 'Cancel landed cost',
                  })) && act.mutate('cancel')
                }
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />

      {editable && (
        <Card title="Goods receipts">
          {errors.receiptIds && <p className="mb-2 text-xs text-red-600">{errors.receiptIds}</p>}
          <div className="mb-2 max-w-sm">
            <Input placeholder="Search receipt number or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded border border-line text-sm">
            {[...pickedRows, ...(picks.data ?? []).filter((p) => !receiptIds.includes(p.id))].map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Checkbox
                  checked={receiptIds.includes(p.id)}
                  onChange={(v) => setReceiptIds(v ? [...receiptIds, p.id] : receiptIds.filter((x) => x !== p.id))}
                  label={`${p.number} · ${fmtDate(p.date)} · ${p.supplier ?? ''}`}
                />
                <span className="ml-auto text-xs text-slate-500">
                  {p.currencyCode} {fmtNumber(p.value, 2)}
                  {p.landedCosts > 0 && ` · ${p.landedCosts} landed cost${p.landedCosts > 1 ? 's' : ''}`}
                </span>
              </li>
            ))}
            {!picks.data?.length && <li className="px-3 py-3 text-slate-500">No confirmed goods receipts.</li>}
          </ul>
          {!d && receiptIds.length > 0 && !pickedRows.length && <p className="mt-1 text-xs text-slate-500">{receiptIds.length} chosen</p>}
        </Card>
      )}

      <Card title="Customs (PIB, BC 2.0)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Date" required>
            <DatePicker disabled={!editable} value={h.date} clearable={false} onChange={(v) => setH({ ...h, date: v ?? isoDate() })} />
          </Field>
          <Field label="PIB number" help="Empty: charges only" error={errors.pibNo}>
            <Input disabled={!editable} value={h.pibNo} maxLength={20} onChange={(e) => setH({ ...h, pibNo: e.target.value })} />
          </Field>
          <Field label="PIB date" error={errors.pibDate}>
            <DatePicker disabled={!editable} value={h.pibDate} onChange={(v) => setH({ ...h, pibDate: v })} />
          </Field>
          <Field label="Incoterm (price on the receipt)">
            <Select disabled={!editable} value={h.incoterm} onChange={(e) => setH({ ...h, incoterm: e.target.value })} options={INCOTERMS.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label={`NDPBM (IDR per ${currency})`} help="The weekly rate for duties" error={errors.ndpbm}>
            <NumberInput disabled={!editable || currency === 'IDR'} decimals={4} min={0} value={currency === 'IDR' ? '1' : h.ndpbm} onChange={(v) => setH({ ...h, ndpbm: v })} />
          </Field>
          <Field label={`Freight not in the price (${currency})`} help="For the customs value (CIF)" error={errors.freightFx}>
            <NumberInput disabled={!editable || freightInPrice || ['CFR', 'CPT'].includes(h.incoterm)} decimals={2} min={0} value={h.freightFx} onChange={(v) => setH({ ...h, freightFx: v })} />
          </Field>
          <Field label={`Insurance not in the price (${currency})`}>
            <NumberInput disabled={!editable || freightInPrice} decimals={2} min={0} value={h.insuranceFx} onChange={(v) => setH({ ...h, insuranceFx: v })} />
          </Field>
          <Field label="Reference">
            <Input disabled={!editable} value={h.reference} maxLength={100} onChange={(e) => setH({ ...h, reference: e.target.value })} />
          </Field>
          <Field label="Import duty on the SPPB" help="Empty: computed">
            <NumberInput disabled={!editable} decimals={0} min={0} value={h.bmActual} onChange={(v) => setH({ ...h, bmActual: v })} />
          </Field>
          <Field label="Import PPN on the SPPB" help="Empty: computed">
            <NumberInput disabled={!editable} decimals={0} min={0} value={h.ppnActual} onChange={(v) => setH({ ...h, ppnActual: v })} />
          </Field>
          <Field label="PPh 22 import on the SPPB" help="Empty: computed">
            <NumberInput disabled={!editable} decimals={0} min={0} value={h.pph22Actual} onChange={(v) => setH({ ...h, pph22Actual: v })} />
          </Field>
          <div className="space-y-2 pt-6 text-sm">
            <Checkbox disabled={!editable} checked={h.apiHolder} onChange={(v) => setH({ ...h, apiHolder: v })} label="Importer has an API" />
            <Checkbox disabled={!editable} checked={h.ppnCreditable} onChange={(v) => setH({ ...h, ppnCreditable: v })} label="Import PPN is input tax (PKP)" />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Customs value = CIF x NDPBM; import duty rounded up to the thousand per PIB (PMK 190/2022); PPN 12% x 11/12 of the import value (PMK 131/2024), full value for goods with PPnBM; PPh 22 import
          on the import value (PMK 51/2025): 10% list A, 7.5% list B, 0.5% list C, otherwise 2.5% with an API or 7.5% without. Not a PKP: the PPN is part of the cost.
        </p>
      </Card>

      <Card title="Goods and tariff" bodyClass="p-0">
        {!lines.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">{editable ? 'Choose goods receipts first.' : 'No lines.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Goods</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Value ({currency})</th>
                  <th className="w-24 px-2 py-2 text-left">HS code</th>
                  <th className="w-20 px-2 py-2 text-left">Weight</th>
                  <th className="w-16 px-2 py-2 text-left">BM %</th>
                  <th className="w-16 px-2 py-2 text-left">BMAD %</th>
                  <th className="w-16 px-2 py-2 text-left">PPnBM %</th>
                  <th className="w-20 px-2 py-2 text-left">PPh 22 %</th>
                  {d && <th className="w-52 px-4 py-2 text-right">Amounts</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lines.map((l, i) => {
                  const o = out.find((x) => x.receiptLineId === l.receiptLineId);
                  return (
                    <tr key={l.receiptLineId} className="align-top">
                      <td className="px-4 py-2">
                        <span className="block font-medium">
                          {l.product?.code} · {l.product?.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {l.receipt}
                          {o?.warehouse ? ` · ${o.warehouse}` : ''}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">{fmtNumber(l.qty, 2)}</td>
                      <td className="px-2 py-2 text-right">
                        {fmtNumber(l.valueFx, 2)}
                        {currency !== 'IDR' && <span className="block text-xs text-slate-500">{fmtMoney(l.value, 0)}</span>}
                      </td>
                      <td className="px-2 py-2">
                        <Input disabled={!editable} value={l.hsCode} maxLength={12} onChange={(e) => setLine(i, 'hsCode', e.target.value)} aria-label="HS code" />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput disabled={!editable} decimals={3} min={0} value={l.weight} onChange={(v) => setLine(i, 'weight', v)} aria-label="Weight" />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput disabled={!editable} decimals={2} min={0} max={200} value={l.bmPct} onChange={(v) => setLine(i, 'bmPct', v)} aria-label="Import duty %" />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput disabled={!editable} decimals={2} min={0} max={500} value={l.bmadPct} onChange={(v) => setLine(i, 'bmadPct', v)} aria-label="Additional duties %" />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput disabled={!editable} decimals={2} min={0} max={200} value={l.ppnbmPct} onChange={(v) => setLine(i, 'ppnbmPct', v)} aria-label="PPnBM %" />
                      </td>
                      <td className="px-2 py-2">
                        <NumberInput
                          disabled={!editable}
                          decimals={2}
                          min={0}
                          max={10}
                          value={l.pph22Pct}
                          placeholder={h.apiHolder ? '2.5' : '7.5'}
                          onChange={(v) => setLine(i, 'pph22Pct', v)}
                          aria-label="PPh 22 %"
                        />
                      </td>
                      {d && (
                        <td className="whitespace-nowrap px-4 py-2 text-right text-xs">
                          {o ? (
                            <>
                              {o.customsValue > 0 && <span className="block">CIF {fmtMoney(o.customsValue, 0)}</span>}
                              {o.bm + o.bmad > 0 && <span className="block">duty {fmtMoney(o.bm + o.bmad, 0)}</span>}
                              {o.ppn > 0 && <span className="block">PPN {fmtMoney(o.ppn, 0)}</span>}
                              {o.pph22 > 0 && <span className="block">PPh 22 {fmtMoney(o.pph22, 0)}</span>}
                              {o.charges > 0 && <span className="block">charges {fmtMoney(o.charges, 0)}</span>}
                              <span className="block font-semibold">cost +{fmtMoney(o.cost, 0)}</span>
                              {d.status === 'POSTED' && (
                                <span className="block text-slate-500">
                                  stock {fmtMoney(o.toInventory, 0)} ({fmtNumber(Math.min(o.qtyOnHand, o.qty), 2)} on hand){o.toCogs > 0 ? ` · sold ${fmtMoney(o.toCogs, 0)}` : ''}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">save to see</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Charges">
        {chargeErrors.length > 0 && (
          <ul className="mb-2 text-xs text-red-600">
            {chargeErrors.map(([k, v]) => (
              <li key={k}>{v}</li>
            ))}
          </ul>
        )}
        {!charges.length && <p className="mb-2 text-sm text-slate-500">No charges.</p>}
        <div className="space-y-2">
          {charges.map((c, i) => {
            const src = open.data?.find((o) => o.lineId === c.sourceLineId);
            const savedInv = savedCharges.find((s) => s.sourceLineId && s.sourceLineId === c.sourceLineId)?.invoice;
            return (
              <div key={i} className="grid grid-cols-1 gap-2 rounded border border-line p-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_8rem_8rem_2.5rem]">
                <Select
                  disabled={!editable}
                  value={c.sourceLineId}
                  aria-label="From invoice"
                  placeholder={savedInv && !src ? `${savedInv} (saved)` : 'Entered (booked to clearing otherwise)'}
                  options={(open.data ?? []).map((o) => ({ value: o.lineId, label: `${o.invoice} · ${o.supplier ?? ''} · ${CHARGE_LABEL[o.type]} · open ${fmtMoney(o.open, 0)}` }))}
                  onChange={(e) => {
                    const o = open.data?.find((x) => x.lineId === e.target.value);
                    setCharge(i, o ? { sourceLineId: o.lineId, type: o.type, amount: String(o.open), description: o.description ?? '' } : { sourceLineId: '' });
                  }}
                />
                <Select
                  disabled={!editable}
                  value={c.type}
                  aria-label="Charge"
                  options={Object.entries(CHARGE_LABEL).map(([value, label]) => ({ value, label }))}
                  onChange={(e) => setCharge(i, { type: e.target.value })}
                />
                <Input disabled={!editable} value={c.description} maxLength={200} placeholder="Description" onChange={(e) => setCharge(i, { description: e.target.value })} />
                <NumberInput disabled={!editable} decimals={2} min={0} value={c.amount} onChange={(v) => setCharge(i, { amount: v })} aria-label="Amount (IDR)" />
                <Select
                  disabled={!editable}
                  value={c.method}
                  aria-label="Spread"
                  options={Object.entries(METHOD).map(([value, label]) => ({ value, label }))}
                  onChange={(e) => setCharge(i, { method: e.target.value })}
                />
                {editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove charge" onClick={() => setCharges(charges.filter((_, j) => j !== i))} />}
              </div>
            );
          })}
        </div>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            icon="plus"
            className="mt-2"
            onClick={() => setCharges([...charges, { type: 'FREIGHT', description: '', amount: '', method: 'VALUE', sourceLineId: '' }])}
          >
            Charge
          </Button>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Charges are in rupiah. Pick the forwarder / insurer / broker invoice line (booked on an LC-* product); an entered charge must already be booked to Landed Costs Clearing (by an expense or a
          payment).
        </p>
      </Card>

      {d && (
        <Card title="Totals">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-slate-500">Customs value</dt>
            <dd className="text-right">{fmtMoney(d.customsValue, 0)}</dd>
            <dt className="text-slate-500">Import duty (+ additional)</dt>
            <dd className="text-right">{fmtMoney(d.bm + d.bmad, 0)}</dd>
            <dt className="text-slate-500">Import PPN {d.ppnCreditable ? '(input tax)' : '(in the cost)'}</dt>
            <dd className="text-right">{fmtMoney(d.ppn, 0)}</dd>
            <dt className="text-slate-500">PPnBM</dt>
            <dd className="text-right">{fmtMoney(d.ppnbm, 0)}</dd>
            <dt className="text-slate-500">PPh 22 import (prepaid)</dt>
            <dd className="text-right">{fmtMoney(d.pph22, 0)}</dd>
            <dt className="text-slate-500">Charges</dt>
            <dd className="text-right">{fmtMoney(d.charges, 0)}</dd>
            <dt className="font-medium">To customs</dt>
            <dd className="text-right font-medium">{fmtMoney(d.bm + d.bmad + d.ppn + d.ppnbm + d.pph22, 0)}</dd>
            {d.status === 'POSTED' && (
              <>
                <dt className="font-medium">Added to stock / cost of sales</dt>
                <dd className="text-right font-medium">
                  {fmtMoney(d.toInventory, 0)} / {fmtMoney(d.toCogs, 0)}
                </dd>
              </>
            )}
          </dl>
        </Card>
      )}

      <Card title="Notes">
        <Textarea disabled={!editable} rows={2} value={h.notes} maxLength={2000} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </Card>
    </div>
  );
}
