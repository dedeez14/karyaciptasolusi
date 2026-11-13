import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';
import { emptyGrading, GRADING_LABELS, GRADING_RULE, gradingBody, gradingPct } from '@/features/plantation/grading';

const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfMonth = () => isoDate().slice(0, 8) + '01';
const SUPPLIER_TYPES: Record<string, string> = { MITRA: 'Partner smallholder (mitra)', SWADAYA: 'Independent smallholder (swadaya)', AGENT: 'Dealer / collector', ESTATE: 'Other estate' };
const SHORT_TYPE: Record<string, string> = { MITRA: 'Mitra', SWADAYA: 'Swadaya', AGENT: 'Dealer', ESTATE: 'Estate' };
const DAILY_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'gray' },
  POSTED: { label: 'Posted', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const QUALITY: { key: string; label: string; limit?: string; group: 'cpo' | 'kernel' | 'loss' }[] = [
  { key: 'cpoFfa', label: 'CPO FFA %', limit: 'cpoFfa', group: 'cpo' },
  { key: 'cpoMoisture', label: 'CPO moisture %', limit: 'cpoMoisture', group: 'cpo' },
  { key: 'cpoDirt', label: 'CPO impurities %', limit: 'cpoDirt', group: 'cpo' },
  { key: 'cpoDobi', label: 'CPO DOBI', group: 'cpo' },
  { key: 'kernelMoisture', label: 'Kernel moisture %', limit: 'kernelMoisture', group: 'kernel' },
  { key: 'kernelDirt', label: 'Kernel dirt %', limit: 'kernelDirt', group: 'kernel' },
  { key: 'kernelBroken', label: 'Broken kernels %', limit: 'kernelBroken', group: 'kernel' },
  { key: 'lossFibre', label: 'Oil loss in fibre %', group: 'loss' },
  { key: 'lossEfb', label: 'Oil loss in EFB %', group: 'loss' },
  { key: 'lossNut', label: 'Oil loss in nuts %', group: 'loss' },
  { key: 'lossEffluent', label: 'Oil loss in effluent %', group: 'loss' },
  { key: 'lossKernel', label: 'Kernel losses %', group: 'loss' },
];
const LOSS_KEYS = ['lossFibre', 'lossEfb', 'lossNut', 'lossEffluent'];

interface Tank {
  id: string;
  code: string;
  name: string;
  kind: string;
  productId: string;
  warehouseId: string;
  capacityKg: number;
  calibration: { cm: number; litres: number }[] | null;
  calibrationTempC: number;
  isActive: boolean;
  product: { id: string; code: string; name: string } | null;
  warehouse: { id: string; code: string; name: string } | null;
}
interface Lists {
  capacityTph: number;
  costPerTon: number;
  density: { d0: number; t0: number; k: number };
  limits: Record<string, number>;
  tanks: Tank[];
  template: { tbsProductId: string; tbsWarehouseId: string; outputs: { productId: string; warehouseId: string; kind: string; price: number }[] } | null;
}
const useLists = () => useQuery({ queryKey: ['mill', 'lists'], queryFn: () => api.get<Lists>('/mill/lists'), staleTime: 30_000 });

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${tone === 'bad' ? 'text-red-600' : ''}`}>{value}</div>
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

// ============================================================ daily processing
interface DailyRow {
  id: string;
  number: string;
  date: string;
  status: string;
  tbsOpeningKg: number;
  tbsReceivedKg: number;
  tbsProcessedKg: number;
  restanKg: number;
  processingHours: number;
  breakdownHours: number;
  cpoKg: number;
  kernelKg: number;
  cpoFfa: number | null;
  totalLoss: number | null;
  oer: number | null;
  ker: number | null;
  throughput: number | null;
  utilisation: number | null;
  tbsCost: number;
  conversionCost: number;
}

export function DailyListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const q = useQuery({ queryKey: ['mill', 'dailies', from, to], queryFn: () => api.get<DailyRow[]>('/mill/dailies', { from, to }) });
  const rows = q.data ?? [];
  const posted = rows.filter((r) => r.status === 'POSTED');
  const t = posted.reduce((a, r) => ({ p: a.p + r.tbsProcessedKg, c: a.c + r.cpoKg, k: a.k + r.kernelKg, h: a.h + r.processingHours }), { p: 0, c: 0, k: 0, h: 0 });
  const lim = lists.data?.limits;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Processing"
        subtitle="Fruit processed, CPO and kernel made, quality and losses per day; posting moves the cost of the fruit and the processing into the products"
        actions={
          can('mill.daily.record') && (
            <Button icon="plus" onClick={() => navigate('/mill/daily/new')}>
              New day
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Fruit processed" value={`${num(t.p / 1000, 1)} t`} hint={`${posted.length} days · ${num(t.h, 1)} h`} />
          <Stat label="OER" value={t.p ? `${num((t.c / t.p) * 100)}%` : '-'} hint={`CPO ${num(t.c / 1000, 1)} t`} />
          <Stat label="KER" value={t.p ? `${num((t.k / t.p) * 100)}%` : '-'} hint={`Kernel ${num(t.k / 1000, 1)} t`} />
          <Stat label="Throughput" value={t.h ? `${num(t.p / 1000 / t.h)} t/h` : '-'} hint={lists.data ? `capacity ${lists.data.capacityTph} t/h` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="clipboard-list" title="No reports in this period" description="Set up the storage tanks first, then record each day of processing" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Day</th>
                  <th className="px-2 py-2 text-right">Received t</th>
                  <th className="px-2 py-2 text-right">Processed t</th>
                  <th className="px-2 py-2 text-right">Restan t</th>
                  <th className="px-2 py-2 text-right">CPO t</th>
                  <th className="px-2 py-2 text-right">OER</th>
                  <th className="px-2 py-2 text-right">Kernel t</th>
                  <th className="px-2 py-2 text-right">KER</th>
                  <th className="px-2 py-2 text-right">FFA</th>
                  <th className="px-2 py-2 text-right">Losses</th>
                  <th className="px-2 py-2 text-right">t/h</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/mill/daily/${r.id}`)}>
                    <td className="px-4 py-2">
                      <Link to={`/mill/daily/${r.id}`} className="font-medium text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {fmtDate(r.date)}
                      </Link>
                      <span className="block text-xs text-slate-500">{r.number}</span>
                    </td>
                    <td className="px-2 py-2 text-right">{num(r.tbsReceivedKg / 1000, 1)}</td>
                    <td className="px-2 py-2 text-right">{num(r.tbsProcessedKg / 1000, 1)}</td>
                    <td className="px-2 py-2 text-right">{num(r.restanKg / 1000, 1)}</td>
                    <td className="px-2 py-2 text-right">{num(r.cpoKg / 1000, 2)}</td>
                    <td className="px-2 py-2 text-right font-medium">{r.oer !== null ? `${num(r.oer)}%` : '-'}</td>
                    <td className="px-2 py-2 text-right">{num(r.kernelKg / 1000, 2)}</td>
                    <td className="px-2 py-2 text-right">{r.ker !== null ? `${num(r.ker)}%` : '-'}</td>
                    <td className={`px-2 py-2 text-right ${lim && r.cpoFfa !== null && r.cpoFfa > lim.cpoFfa ? 'font-medium text-red-600' : ''}`}>{r.cpoFfa !== null ? `${num(r.cpoFfa)}%` : '-'}</td>
                    <td className={`px-2 py-2 text-right ${lim && r.totalLoss !== null && r.totalLoss > lim.totalLoss ? 'font-medium text-red-600' : ''}`}>
                      {r.totalLoss !== null ? `${num(r.totalLoss)}%` : '-'}
                    </td>
                    <td className="px-2 py-2 text-right">{r.throughput ?? '-'}</td>
                    <td className="px-4 py-2">
                      <Badge tone={DAILY_STATUS[r.status].tone}>{DAILY_STATUS[r.status].label}</Badge>
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

interface Prefill {
  previous: { id: string; number: string; date: string } | null;
  tbs: { openingKg: number; receivedKg: number; ownKg: number; boughtKg: number } | null;
  tanks: (Tank & { openingKg: number | null; openingFrom: string })[];
  despatch: Record<string, number>;
  systemStock: Record<string, number>;
}
interface DailyDetail extends DailyRow {
  tbsProductId: string;
  tbsWarehouseId: string;
  tbsProduct: { code: string; name: string } | null;
  tbsWarehouse: { name: string } | null;
  quality: Record<string, number | null> | null;
  notes: string | null;
  outputs: {
    id: string;
    productId: string;
    warehouseId: string;
    kind: string;
    qty: number;
    price: number;
    cost: number;
    product: { code: string; name: string } | null;
    warehouse: { name: string } | null;
    tankKind: string | null;
  }[];
  soundings: { tankId: string; heightCm: number | null; temperatureC: number | null; volumeL: number | null; density: number | null; kg: number; ffa: number | null }[];
}
interface OutLine {
  productId: string | null;
  productName: string;
  warehouseId: string | null;
  warehouseName: string;
  kind: string;
  qty: string;
  price: string;
}
interface SoundLine {
  heightCm: string;
  temperatureC: string;
  kg: string;
  ffa: string;
}

/** kg of a sounding computed in the browser with the same rule as the server (preview only; the server recomputes) */
function previewKg(t: Tank, s: SoundLine, d: { d0: number; t0: number; k: number }) {
  if (t.kind !== 'CPO') return s.kg === '' ? null : Number(s.kg);
  if (s.heightCm === '' || s.temperatureC === '' || !t.calibration?.length) return null;
  const cm = Number(s.heightCm);
  const temp = Number(s.temperatureC);
  const tab = t.calibration;
  if (cm > tab[tab.length - 1].cm) return null;
  let litres = tab[0].cm > 0 && cm <= tab[0].cm ? (tab[0].litres * cm) / tab[0].cm : tab[0].litres;
  for (let i = 1; i < tab.length; i++)
    if (cm <= tab[i].cm && cm >= tab[i - 1].cm) {
      litres = tab[i - 1].litres + ((tab[i].litres - tab[i - 1].litres) * (cm - tab[i - 1].cm)) / (tab[i].cm - tab[i - 1].cm);
      break;
    }
  if (t.calibrationTempC > 0) litres *= 1 + 0.0000348 * (temp - t.calibrationTempC);
  return Math.round(litres * (d.d0 - d.k * (temp - d.t0)) * 100) / 100;
}

export function DailyPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const lists = useLists();
  const q = useQuery({ queryKey: ['mill', 'daily', id], queryFn: () => api.get<DailyDetail>(`/mill/dailies/${id}`), enabled: !isNew });
  const d = q.data;
  const [f, setF] = useState({
    date: isoDate(),
    tbsProductId: null as string | null,
    tbsWarehouseId: null as string | null,
    tbsProcessedKg: '',
    processingHours: '',
    breakdownHours: '',
    conversionCost: '',
    notes: '',
  });
  const [quality, setQuality] = useState<Record<string, string>>({});
  const [sound, setSound] = useState<Record<string, SoundLine>>({});
  const [outs, setOuts] = useState<OutLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    if (!isNew || loaded || !lists.data) return;
    setLoaded('new');
    const t = lists.data.template;
    const tanks = lists.data.tanks.filter((x) => x.isActive && x.kind !== 'OTHER');
    setF((x) => ({ ...x, tbsProductId: t?.tbsProductId ?? null, tbsWarehouseId: t?.tbsWarehouseId ?? null }));
    setOuts(
      t?.outputs.length
        ? t.outputs.map((o) => ({ productId: o.productId, productName: '', warehouseId: o.warehouseId, warehouseName: '', kind: o.kind, qty: '', price: String(o.price || '') }))
        : [...new Map(tanks.map((x) => [`${x.productId}|${x.warehouseId}`, x])).values()].map((x) => ({
            productId: x.productId,
            productName: x.product ? `${x.product.code} - ${x.product.name}` : '',
            warehouseId: x.warehouseId,
            warehouseName: x.warehouse?.name ?? '',
            kind: 'MAIN',
            qty: '',
            price: '',
          })),
    );
  }, [isNew, loaded, lists.data]);
  useEffect(() => {
    if (!d || loaded === d.id + d.status) return;
    setLoaded(d.id + d.status);
    setF({
      date: d.date.slice(0, 10),
      tbsProductId: d.tbsProductId,
      tbsWarehouseId: d.tbsWarehouseId,
      tbsProcessedKg: String(d.tbsProcessedKg),
      processingHours: String(d.processingHours || ''),
      breakdownHours: String(d.breakdownHours || ''),
      conversionCost: String(d.conversionCost),
      notes: d.notes ?? '',
    });
    setQuality(Object.fromEntries(Object.entries(d.quality ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)])));
    setSound(
      Object.fromEntries(
        d.soundings.map((s) => [
          s.tankId,
          { heightCm: s.heightCm === null ? '' : String(s.heightCm), temperatureC: s.temperatureC === null ? '' : String(s.temperatureC), kg: String(s.kg), ffa: s.ffa === null ? '' : String(s.ffa) },
        ]),
      ),
    );
    setOuts(
      d.outputs.map((o) => ({
        productId: o.productId,
        productName: o.product ? `${o.product.code} - ${o.product.name}` : '',
        warehouseId: o.warehouseId,
        warehouseName: o.warehouse?.name ?? '',
        kind: o.kind,
        qty: String(o.qty),
        price: String(o.price),
      })),
    );
  }, [d, loaded]);
  const pre = useQuery({
    queryKey: ['mill', 'prefill', f.date, f.tbsProductId, f.tbsWarehouseId, id],
    queryFn: () => api.get<Prefill>('/mill/dailies/prefill', { date: f.date, tbsProductId: f.tbsProductId ?? undefined, tbsWarehouseId: f.tbsWarehouseId ?? undefined, id: isNew ? undefined : id }),
    enabled: !!f.date,
  });
  const editable = isNew || d?.status === 'DRAFT';
  const dens = lists.data?.density ?? { d0: 0.9135, t0: 15, k: 0.00069 };
  const tanks = (pre.data?.tanks ?? []).filter((t) => t.isActive && t.kind !== 'OTHER');
  // production from the stock change of the tanks: closing - opening + despatched
  const derived = useMemo(() => {
    const m = new Map<string, { closing: number; opening: number; despatch: number; complete: boolean }>();
    for (const t of tanks) {
      const key = `${t.productId}|${t.warehouseId}`;
      const r = m.get(key) ?? { closing: 0, opening: 0, despatch: pre.data?.despatch[key] ?? 0, complete: true };
      const kg = previewKg(t, sound[t.id] ?? { heightCm: '', temperatureC: '', kg: '', ffa: '' }, dens);
      if (kg === null || t.openingKg === null) r.complete = false;
      r.closing += kg ?? 0;
      r.opening += t.openingKg ?? 0;
      m.set(key, r);
    }
    return m;
  }, [tanks, sound, dens, pre.data]);
  const processed = Number(f.tbsProcessedKg || 0);
  const cpoKg = outs.filter((o) => tanks.some((t) => t.kind === 'CPO' && t.productId === o.productId)).reduce((a, o) => a + Number(o.qty || 0), 0);
  const kernelKg = outs.filter((o) => tanks.some((t) => t.kind === 'KERNEL' && t.productId === o.productId)).reduce((a, o) => a + Number(o.qty || 0), 0);
  const hours = Number(f.processingHours || 0);
  const loss = LOSS_KEYS.some((k) => quality[k]) ? LOSS_KEYS.reduce((a, k) => a + Number(quality[k] || 0), 0) : null;
  const lim = lists.data?.limits ?? {};
  const body = () => ({
    ...f,
    tbsProcessedKg: f.tbsProcessedKg || 0,
    processingHours: f.processingHours || 0,
    breakdownHours: f.breakdownHours || 0,
    conversionCost: f.conversionCost === '' ? null : f.conversionCost,
    quality: Object.fromEntries(
      Object.entries(quality)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => [k, v]),
    ),
    soundings: tanks.filter((t) => sound[t.id] && (sound[t.id].heightCm !== '' || sound[t.id].kg !== '')).map((t) => ({ tankId: t.id, ...sound[t.id] })),
    outputs: outs.filter((o) => o.productId).map((o) => ({ productId: o.productId, warehouseId: o.warehouseId, kind: o.kind, qty: o.qty || 0, price: o.price || 0 })),
  });
  const save = useMutation({
    mutationFn: () => (isNew ? api.post<DailyDetail>('/mill/dailies', body()) : api.put<DailyDetail>(`/mill/dailies/${id}`, body())),
    onSuccess: (r) => {
      toast.success(`${r.number} saved`);
      setErrors({});
      qc.invalidateQueries({ queryKey: ['mill'] });
      setLoaded('');
      if (isNew) navigate(`/mill/daily/${r.id}`, { replace: true });
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const post = useMutation({
    mutationFn: () => api.post(`/mill/dailies/${id}/post`),
    onSuccess: () => (toast.success('Posted: fruit out, products in at cost'), qc.invalidateQueries({ queryKey: ['mill'] }), setLoaded('')),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/mill/dailies/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled'), qc.invalidateQueries({ queryKey: ['mill'] }), navigate('/mill/daily')),
    onError: (e) => toast.error(e),
  });
  if (!isNew && (q.isLoading || !d)) return <Loading />;
  const setS = (tankId: string, k: keyof SoundLine, v: string) => setSound((s) => ({ ...s, [tankId]: { ...(s[tankId] ?? { heightCm: '', temperatureC: '', kg: '', ffa: '' }), [k]: v } }));
  const print = () => {
    if (!d) return;
    printHtml(`<!doctype html><html><head><title>${esc(d.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Laporan Harian Pengolahan ${esc(d.number)}</h1><p>${esc(fmtDate(d.date))} · ${esc(DAILY_STATUS[d.status].label)}</p>
<table><tbody>
<tr><td>TBS opening (restan)</td><td class="r">${esc(fmtNumber(d.tbsOpeningKg))} kg</td><td>TBS received</td><td class="r">${esc(fmtNumber(d.tbsReceivedKg))} kg</td></tr>
<tr><td>TBS processed</td><td class="r">${esc(fmtNumber(d.tbsProcessedKg))} kg</td><td>TBS closing (restan)</td><td class="r">${esc(fmtNumber(d.restanKg))} kg</td></tr>
<tr><td>Processing hours</td><td class="r">${d.processingHours}</td><td>Breakdown hours</td><td class="r">${d.breakdownHours}</td></tr>
<tr class="b"><td>OER</td><td class="r">${esc(num(d.oer))}%</td><td>KER</td><td class="r">${esc(num(d.ker))}%</td></tr>
<tr><td>Throughput</td><td class="r">${d.throughput ?? '-'} t/h</td><td>Total oil losses</td><td class="r">${d.totalLoss ?? '-'}%</td></tr></tbody></table>
<h2>Products</h2><table><thead><tr><th>Product</th><th>Store</th><th>Kind</th><th class="r">Kg</th><th class="r">Cost</th></tr></thead><tbody>
${d.outputs.map((o) => `<tr><td>${esc(o.product?.name ?? '')}</td><td>${esc(o.warehouse?.name ?? '')}</td><td>${o.kind === 'MAIN' ? 'Main' : 'By-product'}</td><td class="r">${esc(fmtNumber(o.qty))}</td><td class="r">${esc(fmtMoney(o.cost, 0))}</td></tr>`).join('')}</tbody></table>
<h2>Tank stock (closing)</h2><table><thead><tr><th>Tank</th><th class="r">Sounding cm</th><th class="r">Temp °C</th><th class="r">Litres</th><th class="r">Density</th><th class="r">Kg</th><th class="r">FFA %</th></tr></thead><tbody>
${d.soundings.map((s) => `<tr><td>${esc(tanks.find((t) => t.id === s.tankId)?.name ?? '')}</td><td class="r">${s.heightCm ?? ''}</td><td class="r">${s.temperatureC ?? ''}</td><td class="r">${s.volumeL !== null ? esc(fmtNumber(s.volumeL)) : ''}</td><td class="r">${s.density ?? ''}</td><td class="r">${esc(fmtNumber(s.kg))}</td><td class="r">${s.ffa ?? ''}</td></tr>`).join('')}</tbody></table>
<h2>Quality and losses</h2><table><tbody>${QUALITY.filter((x) => d.quality?.[x.key] !== null && d.quality?.[x.key] !== undefined)
      .map((x) => `<tr><td>${esc(x.label)}</td><td class="r">${d.quality![x.key]}</td></tr>`)
      .join('')}</tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:50px;text-align:center"><div style="border-top:1px solid #333;padding-top:4px">Process assistant</div><div style="border-top:1px solid #333;padding-top:4px">Laboratory</div><div style="border-top:1px solid #333;padding-top:4px">Mill manager</div></div>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/mill/daily')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {isNew ? 'New daily report' : `Daily report ${fmtDate(d!.date)}`}
            {d && <Badge tone={DAILY_STATUS[d.status].tone}>{DAILY_STATUS[d.status].label}</Badge>}
          </span>
        }
        subtitle={d ? d.number : 'One report per day, posted in date order'}
        actions={
          <>
            {d && (
              <Button variant="outline" icon="printer" onClick={print}>
                Print
              </Button>
            )}
            {editable && can('mill.daily.record') && (
              <Button variant={isNew ? 'primary' : 'outline'} icon="save" loading={save.isPending} disabled={!f.tbsProductId || !f.tbsWarehouseId} onClick={() => save.mutate()}>
                Save draft
              </Button>
            )}
            {d?.status === 'DRAFT' && can('mill.daily.post') && (
              <Button
                icon="check"
                loading={post.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Post the report of ${fmtDate(d.date)}?`,
                    message: 'The fruit processed leaves stock; CPO, kernel and by-products enter their stores at the joint cost.',
                  })) && post.mutate()
                }
              >
                Post
              </Button>
            )}
            {d && d.status !== 'CANCELLED' && (can('mill.daily.post') || (d.status === 'DRAFT' && can('mill.daily.record'))) && (
              <Button
                variant="ghost"
                icon="x"
                loading={cancel.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    danger: true,
                    message: d.status === 'POSTED' ? 'Stock and cost of this day are reversed (only the last posted day).' : undefined,
                    confirmText: 'Cancel report',
                  })) && cancel.mutate()
                }
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="OER" value={processed ? `${num((cpoKg / processed) * 100)}%` : '-'} hint={`CPO ${num(cpoKg, 0)} kg`} />
        <Stat label="KER" value={processed ? `${num((kernelKg / processed) * 100)}%` : '-'} hint={`Kernel ${num(kernelKg, 0)} kg`} />
        <Stat
          label="Throughput"
          value={hours ? `${num(processed / 1000 / hours)} t/h` : '-'}
          hint={lists.data && hours ? `${num((processed / 1000 / hours / lists.data.capacityTph) * 100, 1)}% of ${lists.data.capacityTph} t/h` : undefined}
        />
        <Stat
          label="Oil losses"
          value={loss !== null ? `${num(loss)}%` : '-'}
          hint={lim.totalLoss ? `norm ${lim.totalLoss}%` : undefined}
          tone={loss !== null && lim.totalLoss && loss > lim.totalLoss ? 'bad' : undefined}
        />
      </div>
      <Card title="Fruit (TBS)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Day" required error={errors.date}>
            <DatePicker disabled={!editable} value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
          </Field>
          <Field label="Fruit product" required error={errors.tbsProductId}>
            <AsyncSelect
              disabled={!editable}
              resource="products"
              value={f.tbsProductId}
              initialLabel={d?.tbsProduct ? `${d.tbsProduct.code} - ${d.tbsProduct.name}` : undefined}
              onChange={(v) => setF({ ...f, tbsProductId: v })}
            />
          </Field>
          <Field label="Loading ramp (warehouse)" required error={errors.tbsWarehouseId}>
            <AsyncSelect disabled={!editable} resource="warehouses" value={f.tbsWarehouseId} initialLabel={d?.tbsWarehouse?.name} onChange={(v) => setF({ ...f, tbsWarehouseId: v })} />
          </Field>
          <Field label="Fruit processed (kg)" required error={errors.tbsProcessedKg}>
            <NumberInput disabled={!editable} decimals={2} min={0} value={f.tbsProcessedKg} onChange={(v) => setF({ ...f, tbsProcessedKg: v })} />
          </Field>
        </div>
        {(d || pre.data?.tbs) && (
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
            <Dt label="At the ramp at the start">{num(d && !editable ? d.tbsOpeningKg : pre.data?.tbs?.openingKg, 0)} kg</Dt>
            <Dt label="Received">
              {num(d && !editable ? d.tbsReceivedKg : pre.data?.tbs?.receivedKg, 0)} kg
              {pre.data?.tbs && editable ? (
                <span className="block text-xs text-slate-500">
                  own estates {num(pre.data.tbs.ownKg, 0)} · bought {num(pre.data.tbs.boughtKg, 0)}
                </span>
              ) : null}
            </Dt>
            <Dt label="Processed">{num(processed, 0)} kg</Dt>
            <Dt label="Left at the ramp (restan)">{num((d && !editable ? d.tbsOpeningKg + d.tbsReceivedKg : (pre.data?.tbs?.openingKg ?? 0) + (pre.data?.tbs?.receivedKg ?? 0)) - processed, 0)} kg</Dt>
          </dl>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Processing hours" error={errors.processingHours}>
            <NumberInput disabled={!editable} decimals={2} min={0} max={24} value={f.processingHours} onChange={(v) => setF({ ...f, processingHours: v })} />
          </Field>
          <Field label="Breakdown hours" error={errors.breakdownHours}>
            <NumberInput disabled={!editable} decimals={2} min={0} max={24} value={f.breakdownHours} onChange={(v) => setF({ ...f, breakdownHours: v })} />
          </Field>
          <Field
            label="Processing cost"
            help={lists.data?.costPerTon ? `Empty: ${fmtMoney(lists.data.costPerTon, 0)} per ton processed (Settings)` : 'Empty: the cost per ton in Settings > Agriculture'}
            error={errors.conversionCost}
          >
            <NumberInput disabled={!editable} decimals={0} min={0} value={f.conversionCost} onChange={(v) => setF({ ...f, conversionCost: v })} />
          </Field>
        </div>
      </Card>
      <Card
        title="Tank stock at the end of the day"
        subtitle={`Sounding height and oil temperature give the kg (calibration table, density ${dens.d0} at ${dens.t0} °C less ${dens.k} per °C). Opening: ${pre.data?.previous ? `report of ${fmtDate(pre.data.previous.date)}` : 'stock in the system'}`}
        bodyClass="p-0"
      >
        {!tanks.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">
            No tanks yet.{' '}
            <Link to="/mill/tanks" className="text-brand-600">
              Set up the storage tanks
            </Link>{' '}
            with their calibration tables.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Tank</th>
                  <th className="px-2 py-2 text-right">Opening kg</th>
                  <th className="w-28 px-1 py-2 text-right">Sounding cm</th>
                  <th className="w-24 px-1 py-2 text-right">Temp °C</th>
                  <th className="w-28 px-1 py-2 text-right">Kg</th>
                  <th className="w-24 px-1 py-2 text-right">FFA %</th>
                  <th className="px-4 py-2 text-right">Change kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tanks.map((t) => {
                  const s = sound[t.id] ?? { heightCm: '', temperatureC: '', kg: '', ffa: '' };
                  const kg = previewKg(t, s, dens);
                  const e = Object.entries(errors).find(([k]) => k.startsWith('soundings.'))?.[1];
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="px-4 py-2">
                        <span className="font-medium">{t.name}</span>
                        <span className="block text-xs text-slate-500">
                          {lists.data?.tanks.find((x) => x.id === t.id)?.product?.name ?? ''} · {t.kind === 'CPO' ? `${t.calibration?.length ?? 0} calibration rows` : 'kg entered'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {num(t.openingKg)}
                        <span className="block text-xs text-slate-400">{t.openingFrom === 'SOUNDING' ? 'last sounding' : 'system'}</span>
                      </td>
                      <td className="px-1 py-1.5">
                        {t.kind === 'CPO' && (
                          <NumberInput disabled={!editable} decimals={1} min={0} value={s.heightCm} onChange={(v) => setS(t.id, 'heightCm', v)} aria-label={`${t.name} sounding cm`} />
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        {t.kind === 'CPO' && (
                          <NumberInput
                            disabled={!editable}
                            decimals={1}
                            min={0}
                            max={120}
                            value={s.temperatureC}
                            onChange={(v) => setS(t.id, 'temperatureC', v)}
                            aria-label={`${t.name} temperature`}
                          />
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        {t.kind === 'CPO' ? (
                          <span className="block py-2 text-right font-medium">{kg !== null ? num(kg) : '-'}</span>
                        ) : (
                          <NumberInput disabled={!editable} decimals={2} min={0} value={s.kg} onChange={(v) => setS(t.id, 'kg', v)} aria-label={`${t.name} kg`} />
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        <NumberInput disabled={!editable} decimals={2} min={0} max={100} value={s.ffa} onChange={(v) => setS(t.id, 'ffa', v)} aria-label={`${t.name} FFA`} />
                      </td>
                      <td className="px-4 py-2 text-right">{kg !== null && t.openingKg !== null ? num(kg - t.openingKg) : '-'}</td>
                      {e && <td className="hidden">{e}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {Object.entries(errors)
          .filter(([k]) => k.startsWith('soundings.'))
          .map(([k, v]) => (
            <p key={k} className="px-4 py-1 text-sm text-red-600">
              {v}
            </p>
          ))}
      </Card>
      <Card
        title="Products made"
        subtitle="Main products share the joint cost (fruit + processing) by sales value; by-products (shell, fibre, EFB) are valued at their net realisable value (SAK EP / PSAK 202 joint products)"
        actions={
          editable && (
            <Button
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() => setOuts([...outs, { productId: null, productName: '', warehouseId: null, warehouseName: '', kind: 'BY', qty: '', price: '' }])}
            >
              Product
            </Button>
          )
        }
        bodyClass="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="w-48 px-1 py-2 text-left">Store</th>
                <th className="w-36 px-1 py-2 text-left">Kind</th>
                <th className="w-36 px-1 py-2 text-right">Kg made</th>
                <th className="w-32 px-1 py-2 text-right">Price / NRV per kg</th>
                <th className="w-28 px-2 py-2 text-right">Cost</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {outs.map((o, i) => {
                const dv = derived.get(`${o.productId}|${o.warehouseId}`);
                const sugg = dv && dv.complete ? Math.round((dv.closing - dv.opening + dv.despatch) * 100) / 100 : null;
                const e = errors[`outputs.${i}.productId`] || errors[`outputs.${i}.warehouseId`];
                return (
                  <tr key={i} className="align-top">
                    <td className="px-3 py-1.5">
                      <AsyncSelect
                        disabled={!editable}
                        resource="products"
                        value={o.productId}
                        initialLabel={o.productName || undefined}
                        invalid={!!e}
                        onChange={(v, opt) => setOuts(outs.map((x, j) => (j === i ? { ...x, productId: v, productName: opt?.label ?? '' } : x)))}
                        aria-label="Product"
                      />
                      {e && <p className="mt-0.5 text-xs text-red-600">{e}</p>}
                    </td>
                    <td className="px-1 py-1.5">
                      <AsyncSelect
                        disabled={!editable}
                        resource="warehouses"
                        value={o.warehouseId}
                        initialLabel={o.warehouseName || undefined}
                        onChange={(v, opt) => setOuts(outs.map((x, j) => (j === i ? { ...x, warehouseId: v, warehouseName: opt?.label ?? '' } : x)))}
                        aria-label="Store"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <Select
                        disabled={!editable}
                        value={o.kind}
                        onChange={(ev) => setOuts(outs.map((x, j) => (j === i ? { ...x, kind: ev.target.value } : x)))}
                        options={[
                          { value: 'MAIN', label: 'Main product' },
                          { value: 'BY', label: 'By-product' },
                        ]}
                        aria-label="Kind"
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <NumberInput disabled={!editable} decimals={2} min={0} value={o.qty} onChange={(v) => setOuts(outs.map((x, j) => (j === i ? { ...x, qty: v } : x)))} aria-label="Kg made" />
                      {sugg !== null && editable && (
                        <button
                          type="button"
                          className="mt-0.5 block w-full text-right text-xs text-brand-600 hover:underline"
                          onClick={() => setOuts(outs.map((x, j) => (j === i ? { ...x, qty: String(sugg) } : x)))}
                          title="Closing tank stock - opening + despatched today"
                        >
                          from tanks: {num(sugg)}
                        </button>
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      <NumberInput
                        disabled={!editable}
                        decimals={2}
                        min={0}
                        value={o.price}
                        onChange={(v) => setOuts(outs.map((x, j) => (j === i ? { ...x, price: v } : x)))}
                        aria-label="Price per kg"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="block py-2">
                        {d?.status === 'POSTED' ? fmtMoney(d.outputs[i]?.cost ?? 0, 0) : o.kind === 'BY' ? fmtMoney(Number(o.qty || 0) * Number(o.price || 0), 0) : 'on posting'}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">{editable && <Button variant="ghost" size="icon" icon="x" aria-label="Remove product" onClick={() => setOuts(outs.filter((_, j) => j !== i))} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {errors.outputs && <p className="px-4 py-2 text-sm text-red-600">{errors.outputs}</p>}
        {d?.status === 'POSTED' && (
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
            Joint cost: fruit {fmtMoney(d.tbsCost, 0)} + processing {fmtMoney(d.conversionCost, 0)} = {fmtMoney(d.tbsCost + d.conversionCost, 0)}
          </p>
        )}
      </Card>
      <Card title="Quality and losses" subtitle="Laboratory results of the day; figures above the limits in Settings > Agriculture are marked">
        {(['cpo', 'kernel', 'loss'] as const).map((g) => (
          <div key={g} className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {QUALITY.filter((x) => x.group === g).map((x) => {
              const over = x.limit && quality[x.key] && lim[x.limit] !== undefined && Number(quality[x.key]) > lim[x.limit];
              return (
                <Field key={x.key} label={x.label} help={x.limit && lim[x.limit] !== undefined ? `max ${lim[x.limit]}` : undefined} error={over ? 'Above the limit' : undefined}>
                  <NumberInput disabled={!editable} decimals={3} min={0} max={100} value={quality[x.key] ?? ''} onChange={(v) => setQuality({ ...quality, [x.key]: v })} />
                </Field>
              );
            })}
          </div>
        ))}
        <Field label="Notes">
          <Textarea disabled={!editable} rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </Card>
    </div>
  );
}

// ============================================================ fruit bought at the weighbridge
interface IntakeRow {
  id: string;
  number: string;
  date: string;
  weighedAt: string;
  status: string;
  supplier: { id: string; code: string; name: string } | null;
  supplierType: string;
  vehicleNo: string | null;
  ticketNo: string | null;
  bunches: number;
  netKg: number;
  sortingPct: number;
  acceptedKg: number;
  pricePerKg: number;
  amount: number;
  invoice: { id: string; number: string; status: string } | null;
}
interface IntakeDetail extends Omit<IntakeRow, 'supplier'> {
  supplier: { id: string; code: string; name: string } | null;
  origin: string | null;
  driver: string | null;
  grossKg: number;
  tareKg: number;
  sortingKg: number;
  grading: (Record<string, number | null> & { parts?: Record<string, number>; pct?: number }) | null;
  product: { code: string; name: string } | null;
  warehouse: { name: string } | null;
  receipt: { id: string; number: string; status: string } | null;
  notes: string | null;
}

export function IntakesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [status, setStatus] = useState('POSTED');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['mill', 'intakes', from, to, status], queryFn: () => api.get<IntakeRow[]>('/mill/intakes', { from, to, status: status || undefined }) });
  const rows = q.data ?? [];
  const posted = rows.filter((r) => r.status === 'POSTED');
  const t = posted.reduce((a, r) => ({ net: a.net + r.netKg, acc: a.acc + r.acceptedKg, amt: a.amt + r.amount }), { net: 0, acc: 0, amt: 0 });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Fruit Bought (Weighbridge)"
        subtitle="TBS bought from smallholders, dealers and other estates: weighed, graded and received into stock at the price of the day. Own estate fruit arrives through the SPB"
        actions={
          can('mill.intake') && (
            <Button icon="scale" onClick={() => setCreating(true)}>
              Weigh a truck
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
        <div className="w-36">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All"
            options={[
              { value: 'POSTED', label: 'Received' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </div>
      </div>
      {posted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tickets" value={fmtNumber(posted.length)} />
          <Stat label="Net weight" value={`${num(t.net / 1000, 2)} t`} />
          <Stat label="Accepted" value={`${num(t.acc / 1000, 2)} t`} hint={t.net ? `sorting ${num(((t.net - t.acc) / t.net) * 100)}%` : undefined} />
          <Stat label="Value" value={fmtMoney(t.amt, 0)} hint={t.acc ? `${fmtMoney(t.amt / t.acc, 0)} / kg` : undefined} />
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="scale" title="No fruit bought in this period" description="Set the TBS price board first, then weigh the trucks" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Ticket</th>
                  <th className="px-2 py-2 text-left">Supplier</th>
                  <th className="px-2 py-2 text-left">Vehicle</th>
                  <th className="px-2 py-2 text-right">Net kg</th>
                  <th className="px-2 py-2 text-right">Sorting</th>
                  <th className="px-2 py-2 text-right">Accepted kg</th>
                  <th className="px-2 py-2 text-right">Price</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-left">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className={`cursor-pointer hover:bg-slate-50 ${r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`} onClick={() => setOpen(r.id)}>
                    <td className="px-4 py-2">
                      <span className="font-medium text-brand-600">{r.number}</span>
                      <span className="block text-xs text-slate-500">{new Date(r.weighedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </td>
                    <td className="px-2 py-2">
                      {r.supplier?.name}
                      <span className="block text-xs text-slate-500">{SHORT_TYPE[r.supplierType]}</span>
                    </td>
                    <td className="px-2 py-2">{r.vehicleNo ?? '-'}</td>
                    <td className="px-2 py-2 text-right">{num(r.netKg, 0)}</td>
                    <td className="px-2 py-2 text-right">{num(r.sortingPct)}%</td>
                    <td className="px-2 py-2 text-right font-medium">{num(r.acceptedKg, 0)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.pricePerKg, 2)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.amount, 0)}</td>
                    <td className="px-4 py-2">{r.invoice ? r.invoice.number : r.status === 'POSTED' ? <Badge tone="amber">to settle</Badge> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <IntakeModal onClose={() => setCreating(false)} onDone={(id) => (setCreating(false), qc.invalidateQueries({ queryKey: ['mill'] }), setOpen(id))} />}
      {open && <IntakeView id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function IntakeModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const lists = useLists();
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({
    weighedAt: now,
    supplierId: null as string | null,
    supplierType: 'SWADAYA',
    origin: '',
    vehicleNo: '',
    driver: '',
    ticketNo: '',
    bunches: '',
    grossKg: '',
    tareKg: '',
    mode: 'grading' as 'grading' | 'pct' | 'kg',
    sortingPct: '',
    sortingKg: '',
    pricePerKg: '',
    productId: null as string | null,
    warehouseId: null as string | null,
    notes: '',
  });
  const [g, setG] = useState(emptyGrading());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = lists.data?.template;
    if (t && !f.productId) setF((x) => ({ ...x, productId: t.tbsProductId, warehouseId: t.tbsWarehouseId }));
  }, [lists.data, f.productId]);
  const board = useQuery({
    queryKey: ['mill', 'price', f.supplierType, f.weighedAt.slice(0, 10)],
    queryFn: () => api.get<{ id: string; pricePerKg: number; effectiveDate: string } | null>('/mill/prices/current', { type: f.supplierType, date: f.weighedAt.slice(0, 10) }),
  });
  const net = Number(f.grossKg || 0) - Number(f.tareKg || 0);
  const pct = f.mode === 'grading' ? gradingPct(g) : f.mode === 'pct' ? Number(f.sortingPct || 0) : net > 0 ? (Number(f.sortingKg || 0) / net) * 100 : 0;
  const sortKg = f.mode === 'kg' ? Number(f.sortingKg || 0) : Math.round(net * pct) / 100;
  const accepted = net - sortKg;
  const price = f.pricePerKg !== '' ? Number(f.pricePerKg) : (board.data?.pricePerKg ?? 0);
  const save = useMutation({
    mutationFn: () =>
      api.post<IntakeDetail>('/mill/intakes', {
        ...f,
        weighedAt: new Date(f.weighedAt).toISOString(),
        bunches: f.bunches || 0,
        tareKg: f.tareKg || 0,
        pricePerKg: f.pricePerKg === '' ? null : f.pricePerKg,
        ...(f.mode === 'grading' ? { grading: gradingBody(g) } : f.mode === 'pct' ? { sortingPct: f.sortingPct || 0 } : { sortingKg: f.sortingKg || 0 }),
      }),
    onSuccess: (r) => (toast.success(`${r.number}: ${fmtNumber(r.acceptedKg)} kg received`), onDone(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="Weigh bought fruit"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.supplierId || !f.productId || !f.warehouseId || !(net > 0) || !(accepted > 0) || !price} onClick={() => save.mutate()}>
          Receive {accepted > 0 ? `${fmtNumber(accepted, 0)} kg` : ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Supplier" required error={errors.supplierId}>
          <AsyncSelect resource="suppliers" value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} />
        </Field>
        <Field label="Kind of supplier" required help={f.supplierType === 'MITRA' ? 'Price set by the provincial Disbun (Permentan 13/2024)' : 'Price of the day'}>
          <Select value={f.supplierType} onChange={(e) => setF({ ...f, supplierType: e.target.value })} options={Object.entries(SUPPLIER_TYPES).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Origin (village / plot / STDB)" error={errors.origin}>
          <Input value={f.origin} maxLength={150} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        </Field>
        <Field label="Weighed at" required error={errors.weighedAt}>
          <Input type="datetime-local" value={f.weighedAt} max={now} onChange={(e) => setF({ ...f, weighedAt: e.target.value })} />
        </Field>
        <Field label="Vehicle no.">
          <Input value={f.vehicleNo} maxLength={20} onChange={(e) => setF({ ...f, vehicleNo: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Ticket no.">
          <Input value={f.ticketNo} maxLength={40} onChange={(e) => setF({ ...f, ticketNo: e.target.value })} />
        </Field>
        <Field label="Gross (truck + fruit) kg" required error={errors.grossKg}>
          <NumberInput decimals={2} min={0} value={f.grossKg} onChange={(v) => setF({ ...f, grossKg: v })} />
        </Field>
        <Field label="Tare (empty truck) kg" required error={errors.tareKg}>
          <NumberInput decimals={2} min={0} value={f.tareKg} onChange={(v) => setF({ ...f, tareKg: v })} />
        </Field>
        <Field label="Bunches">
          <NumberInput decimals={0} min={0} value={f.bunches} onChange={(v) => setF({ ...f, bunches: v })} />
        </Field>
        <Field label="Sorting deduction by" className="lg:col-span-3">
          <Select
            value={f.mode}
            onChange={(e) => setF({ ...f, mode: e.target.value as typeof f.mode })}
            options={[
              { value: 'grading', label: 'Grading sample (Permentan 13/2024 deductions)' },
              { value: 'pct', label: 'Percentage' },
              { value: 'kg', label: 'Kg' },
            ]}
          />
        </Field>
        {f.mode === 'grading' && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-4 lg:col-span-3 lg:grid-cols-7">
            {Object.entries(GRADING_LABELS).map(([k, l]) => (
              <Field key={k} label={`${l} %`}>
                <NumberInput decimals={2} min={0} max={100} value={g[k]} onChange={(v) => setG({ ...g, [k]: v })} aria-label={l} />
              </Field>
            ))}
            <p className="col-span-2 text-xs text-slate-500 sm:col-span-4 lg:col-span-7">{GRADING_RULE}</p>
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
        <Field
          label="Price per kg"
          help={
            board.data
              ? `Price board: ${fmtMoney(board.data.pricePerKg, 2)} from ${fmtDate(board.data.effectiveDate)}; leave empty to use it`
              : 'No price on the board for this kind of supplier: enter it'
          }
          error={errors.pricePerKg}
        >
          <NumberInput decimals={2} min={0} value={f.pricePerKg} placeholder={board.data ? String(board.data.pricePerKg) : ''} onChange={(v) => setF({ ...f, pricePerKg: v })} />
        </Field>
        <Field label="Fruit product" required error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="Loading ramp (warehouse)" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
        </Field>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-line p-3 text-sm sm:grid-cols-4">
        <Dt label="Net">{net > 0 ? `${num(net, 0)} kg` : '-'}</Dt>
        <Dt label="Sorting">{net > 0 ? `${num(pct)}% · ${num(sortKg, 0)} kg` : '-'}</Dt>
        <Dt label="Accepted">{net > 0 ? `${num(accepted, 0)} kg` : '-'}</Dt>
        <Dt label="Value">{net > 0 && price ? fmtMoney(accepted * price, 0) : '-'}</Dt>
      </dl>
    </Modal>
  );
}

function IntakeView({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['mill', 'intake', id], queryFn: () => api.get<IntakeDetail>(`/mill/intakes/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api.post(`/mill/intakes/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled: the receipt is reversed'), qc.invalidateQueries({ queryKey: ['mill'] }), onClose()),
    onError: (e) => toast.error(e),
  });
  const r = q.data;
  const print = () => {
    if (!r) return;
    printHtml(`<!doctype html><html><head><title>${esc(r.number)}</title><style>${PRINT_CSS} body{max-width:120mm}</style></head><body>
<h1>Tiket Timbang TBS ${esc(r.number)}</h1>
<p>${esc(new Date(r.weighedAt).toLocaleString('id-ID'))}${r.ticketNo ? ` · ${esc(r.ticketNo)}` : ''}</p>
<table><tbody>
<tr><td>Supplier</td><td>${esc(r.supplier?.name ?? '')} (${esc(SHORT_TYPE[r.supplierType])})</td></tr>
${r.origin ? `<tr><td>Origin</td><td>${esc(r.origin)}</td></tr>` : ''}
<tr><td>Vehicle</td><td>${esc(r.vehicleNo ?? '-')}${r.driver ? ` · ${esc(r.driver)}` : ''}</td></tr>
<tr><td>Gross</td><td class="r">${esc(fmtNumber(r.grossKg))} kg</td></tr>
<tr><td>Tare</td><td class="r">${esc(fmtNumber(r.tareKg))} kg</td></tr>
<tr><td>Net</td><td class="r">${esc(fmtNumber(r.netKg))} kg</td></tr>
<tr><td>Sorting ${esc(num(r.sortingPct))}%</td><td class="r">${esc(fmtNumber(r.sortingKg))} kg</td></tr>
<tr class="b"><td>Accepted</td><td class="r">${esc(fmtNumber(r.acceptedKg))} kg</td></tr>
<tr><td>Price</td><td class="r">${esc(fmtMoney(r.pricePerKg, 2))} / kg</td></tr>
<tr class="b"><td>Value</td><td class="r">${esc(fmtMoney(r.amount, 0))}</td></tr></tbody></table>
${
  r.grading?.parts
    ? `<p class="muted">Grading: ${Object.entries(GRADING_LABELS)
        .filter(([k]) => r.grading?.[k] !== null && r.grading?.[k] !== undefined)
        .map(([k, l]) => `${esc(l)} ${r.grading![k]}%`)
        .join(', ')}</p>`
    : ''
}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:40px;text-align:center"><div style="border-top:1px solid #333;padding-top:4px">Weighbridge clerk</div><div style="border-top:1px solid #333;padding-top:4px">Supplier / driver</div></div>
</body></html>`);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? `Ticket ${r.number}` : 'Ticket'}
      footer={
        r && (
          <div className="flex w-full flex-wrap justify-between gap-2">
            {r.status === 'POSTED' && can('mill.intake') ? (
              <Button
                variant="ghost"
                icon="x"
                loading={cancel.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${r.number}?`,
                    danger: true,
                    message: 'The goods receipt is reversed. Not possible once the fruit is processed or invoiced.',
                    confirmText: 'Cancel ticket',
                  })) && cancel.mutate()
                }
              >
                Cancel
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outline" icon="printer" onClick={print}>
              Print ticket
            </Button>
          </div>
        )
      }
    >
      {!r ? (
        <Loading />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Dt label="Supplier">
            {r.supplier?.name} <span className="text-xs text-slate-500">{SHORT_TYPE[r.supplierType]}</span>
          </Dt>
          <Dt label="Weighed">{new Date(r.weighedAt).toLocaleString('id-ID')}</Dt>
          <Dt label="Gross / tare">
            {num(r.grossKg, 0)} / {num(r.tareKg, 0)} kg
          </Dt>
          <Dt label="Net">{num(r.netKg, 0)} kg</Dt>
          <Dt label="Sorting">
            {num(r.sortingPct)}% · {num(r.sortingKg, 0)} kg
          </Dt>
          <Dt label="Accepted">{num(r.acceptedKg, 0)} kg</Dt>
          <Dt label="Price">{fmtMoney(r.pricePerKg, 2)} / kg</Dt>
          <Dt label="Value">{fmtMoney(r.amount, 0)}</Dt>
          <Dt label="Goods receipt">
            {r.receipt ? (
              <Link to={`/documents/GR/${r.receipt.id}`} className="text-brand-600">
                {r.receipt.number}
              </Link>
            ) : (
              '-'
            )}
          </Dt>
          <Dt label="Supplier invoice">
            {r.invoice ? (
              <Link to={`/documents/PI/${r.invoice.id}`} className="text-brand-600">
                {r.invoice.number}
              </Link>
            ) : (
              'not settled'
            )}
          </Dt>
          {r.origin && <Dt label="Origin">{r.origin}</Dt>}
          <Dt label="Status">{r.status === 'POSTED' ? 'Received' : 'Cancelled'}</Dt>
        </dl>
      )}
    </Modal>
  );
}

// ============================================================ suppliers and settlement
interface SupplierRow {
  supplier: { id: string; code: string; name: string } | null;
  supplierType: string;
  tickets: number;
  netKg: number;
  sortingKg: number;
  acceptedKg: number;
  amount: number;
  avgPrice: number | null;
  unsettled: number;
  pph22Months: string[];
}
interface SettlePreview {
  intakes: { id: string; number: string; date: string; ticketNo: string | null; acceptedKg: number; pricePerKg: number; amount: number }[];
  kg: number;
  amount: number;
  months: { month: string; purchases: number; pph22: boolean }[];
  pph22Base: number;
  pph22: number;
  threshold: number;
}

export function SuppliersPage() {
  const can = useSession((s) => s.can);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [settling, setSettling] = useState<SupplierRow | null>(null);
  const q = useQuery({ queryKey: ['mill', 'suppliers', from, to], queryFn: () => api.get<SupplierRow[]>('/mill/suppliers', { from, to }) });
  const rows = q.data ?? [];
  const csv = () =>
    downloadCsv(`tbs-suppliers-${from}-${to}.csv`, [
      ['Code', 'Supplier', 'Kind', 'Tickets', 'Net kg', 'Sorting kg', 'Accepted kg', 'Value', 'Average price', 'Not settled', 'PPh 22 months'],
      ...rows.map((r) => [
        r.supplier?.code,
        r.supplier?.name,
        SHORT_TYPE[r.supplierType],
        r.tickets,
        r.netKg,
        r.sortingKg,
        r.acceptedKg,
        r.amount,
        r.avgPrice?.toFixed(2),
        r.unsettled,
        r.pph22Months.join(' '),
      ]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Fruit Suppliers & Settlement"
        subtitle="Fruit bought per supplier; settle a period into one supplier invoice. PPh 22 0.25% is withheld at payment when purchases from a supplier exceed Rp20 million in a month (PMK 51/2025)"
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
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="handshake" title="No fruit bought in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Supplier</th>
                  <th className="px-2 py-2 text-right">Tickets</th>
                  <th className="px-2 py-2 text-right">Accepted kg</th>
                  <th className="px-2 py-2 text-right">Sorting</th>
                  <th className="px-2 py-2 text-right">Avg price</th>
                  <th className="px-2 py-2 text-right">Value</th>
                  <th className="px-2 py-2 text-left">PPh 22</th>
                  <th className="px-2 py-2 text-right">Not settled</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.supplier?.id}>
                    <td className="px-4 py-2">
                      {r.supplier?.name}
                      <span className="block text-xs text-slate-500">
                        {r.supplier?.code} · {SHORT_TYPE[r.supplierType]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">{r.tickets}</td>
                    <td className="px-2 py-2 text-right">{num(r.acceptedKg, 0)}</td>
                    <td className="px-2 py-2 text-right">{r.netKg ? `${num((r.sortingKg / r.netKg) * 100)}%` : '-'}</td>
                    <td className="px-2 py-2 text-right">{r.avgPrice ? fmtMoney(r.avgPrice, 2) : '-'}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.amount, 0)}</td>
                    <td className="px-2 py-2">{r.pph22Months.length ? <Badge tone="amber">{r.pph22Months.join(', ')}</Badge> : <span className="text-xs text-slate-500">below threshold</span>}</td>
                    <td className="px-2 py-2 text-right">{r.unsettled ? fmtMoney(r.unsettled, 0) : '-'}</td>
                    <td className="px-4 py-2 text-right">
                      {r.unsettled > 0 && can('mill.settle') && (
                        <Button size="sm" variant="outline" icon="file-text" onClick={() => setSettling(r)}>
                          Settle
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
      {settling?.supplier && <SettleModal supplier={settling.supplier} from={from} to={to} onClose={() => setSettling(null)} />}
    </div>
  );
}

function SettleModal({ supplier, from, to, onClose }: { supplier: { id: string; name: string }; from: string; to: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [date, setDate] = useState(to);
  const p = useQuery({ queryKey: ['mill', 'settle', supplier.id, from, to], queryFn: () => api.post<SettlePreview>('/mill/settlement/preview', { supplierId: supplier.id, from, to }) });
  const settle = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/mill/settlement', { supplierId: supplier.id, from, to, date }),
    onSuccess: (r) => (toast.success(`Draft supplier invoice ${r.number} made`), qc.invalidateQueries({ queryKey: ['mill'] }), navigate(`/documents/PI/${r.id}`)),
    onError: (e) => toast.error(e),
  });
  const d = p.data;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Settle ${supplier.name}`}
      footer={
        <Button icon="file-text" loading={settle.isPending} disabled={!d?.intakes.length} onClick={() => settle.mutate()}>
          Make draft supplier invoice
        </Button>
      }
    >
      {!d ? (
        <Loading />
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            {d.intakes.length} tickets from {fmtDate(from)} to {fmtDate(to)}: {num(d.kg, 0)} kg, {fmtMoney(d.amount, 0)}.
          </p>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {d.intakes.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5">
                      {r.number} <span className="text-xs text-slate-500">{fmtDate(r.date)}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{num(r.acceptedKg, 0)} kg</td>
                    <td className="px-3 py-1.5 text-right">{fmtMoney(r.amount, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.months.map((m) => (
            <p key={m.month} className={m.pph22 ? 'rounded-lg bg-amber-50 p-2 text-amber-800' : 'text-slate-500'}>
              {m.month}: purchases {fmtMoney(m.purchases, 0)} {m.pph22 ? `> Rp${fmtNumber(d.threshold)}: PPh 22 0.25% applies` : `up to Rp${fmtNumber(d.threshold)}: no PPh 22`}
            </p>
          ))}
          {d.pph22 > 0 && <p className="font-medium">Withhold PPh 22 {fmtMoney(d.pph22, 0)} (tax PPH22-AGRI) when paying, and give the supplier the bukti pungut.</p>}
          <Field label="Invoice date">
            <DatePicker value={date} max={isoDate()} clearable={false} onChange={(v) => setDate(v ?? to)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ============================================================ TBS price board
interface PriceRow {
  id: string;
  effectiveDate: string;
  supplierType: string;
  pricePerKg: number;
  kIndex: number | null;
  cpoPrice: number | null;
  kernelPrice: number | null;
  cpoYield: number | null;
  kernelYield: number | null;
  shellValue: number | null;
  scope: string | null;
  reference: string | null;
}

export function PricesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['mill', 'prices', type], queryFn: () => api.get<PriceRow[]>('/mill/prices', { type: type || undefined }) });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/mill/prices/${id}`),
    onSuccess: () => (toast.success('Price removed'), qc.invalidateQueries({ queryKey: ['mill'] })),
    onError: (e) => toast.error(e),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="TBS Price Board"
        subtitle="Purchase price per kg from a date, by kind of supplier. Partner smallholders: the price set by the provincial plantation office (Permentan 13/2024: K x (CPO price x CPO yield + kernel price x kernel yield) + shell value)"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-56">
              <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All kinds" options={Object.entries(SUPPLIER_TYPES).map(([value, label]) => ({ value, label }))} />
            </div>
            {can('mill.price.manage') && (
              <Button icon="plus" onClick={() => setAdding(true)}>
                New price
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="tags" title="No prices yet" description="Enter the Disbun price for partner smallholders and the daily price for the others" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">From</th>
                  <th className="px-2 py-2 text-left">Supplier kind</th>
                  <th className="px-2 py-2 text-right">Price / kg</th>
                  <th className="px-2 py-2 text-left">Formula</th>
                  <th className="px-2 py-2 text-left">Applies to</th>
                  <th className="px-2 py-2 text-left">Reference</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{fmtDate(r.effectiveDate)}</td>
                    <td className="px-2 py-2">{SHORT_TYPE[r.supplierType]}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.pricePerKg, 2)}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {r.kIndex !== null
                        ? `K ${r.kIndex}% x (CPO ${fmtNumber(r.cpoPrice)} x ${r.cpoYield}% + PK ${fmtNumber(r.kernelPrice)} x ${r.kernelYield}%)${r.shellValue ? ` + shell ${fmtNumber(r.shellValue)}` : ''}`
                        : '-'}
                    </td>
                    <td className="px-2 py-2">{r.scope ?? '-'}</td>
                    <td className="px-2 py-2">{r.reference ?? '-'}</td>
                    <td className="pr-2">
                      {can('mill.price.manage') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          icon="trash-2"
                          aria-label="Remove price"
                          onClick={async () => (await confirm({ title: 'Remove this price?', danger: true, confirmText: 'Remove' })) && del.mutate(r.id)}
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
      {adding && <PriceModal onClose={() => setAdding(false)} onDone={() => (setAdding(false), qc.invalidateQueries({ queryKey: ['mill'] }))} />}
    </div>
  );
}

function PriceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    effectiveDate: isoDate(),
    supplierType: 'MITRA',
    pricePerKg: '',
    kIndex: '',
    cpoPrice: '',
    kernelPrice: '',
    cpoYield: '',
    kernelYield: '',
    shellValue: '',
    scope: '',
    reference: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formula = f.kIndex !== '' && f.cpoPrice !== '' && f.kernelPrice !== '' && f.cpoYield !== '' && f.kernelYield !== '';
  const computed = formula
    ? Math.round(((Number(f.kIndex) / 100) * ((Number(f.cpoPrice) * Number(f.cpoYield)) / 100 + (Number(f.kernelPrice) * Number(f.kernelYield)) / 100) + Number(f.shellValue || 0)) * 100) / 100
    : null;
  const save = useMutation({
    mutationFn: () => api.post('/mill/prices', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))),
    onSuccess: () => (toast.success('Price saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New TBS price"
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save {computed !== null ? fmtMoney(computed, 2) : f.pricePerKg ? fmtMoney(Number(f.pricePerKg), 2) : ''}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From" required error={errors.effectiveDate}>
          <DatePicker value={f.effectiveDate} clearable={false} onChange={(v) => set('effectiveDate')(v ?? isoDate())} />
        </Field>
        <Field label="Supplier kind" required>
          <Select value={f.supplierType} onChange={(e) => set('supplierType')(e.target.value)} options={Object.entries(SUPPLIER_TYPES).map(([value, label]) => ({ value, label }))} />
        </Field>
        {f.supplierType === 'MITRA' && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-3">
            <Field label="K index %" help="Set monthly by the provincial Dinas" error={errors.kIndex}>
              <NumberInput decimals={4} min={0} max={100} value={f.kIndex} onChange={set('kIndex')} />
            </Field>
            <Field label="CPO price / kg" error={errors.cpoPrice}>
              <NumberInput decimals={2} min={0} value={f.cpoPrice} onChange={set('cpoPrice')} />
            </Field>
            <Field label="Kernel price / kg" error={errors.kernelPrice}>
              <NumberInput decimals={2} min={0} value={f.kernelPrice} onChange={set('kernelPrice')} />
            </Field>
            <Field label="CPO yield %" help="Rendemen of the palm age band" error={errors.cpoYield}>
              <NumberInput decimals={3} min={0} max={100} value={f.cpoYield} onChange={set('cpoYield')} />
            </Field>
            <Field label="Kernel yield %" error={errors.kernelYield}>
              <NumberInput decimals={3} min={0} max={100} value={f.kernelYield} onChange={set('kernelYield')} />
            </Field>
            <Field label="Shell value / kg TBS" help="When the shell is sold" error={errors.shellValue}>
              <NumberInput decimals={2} min={0} value={f.shellValue} onChange={set('shellValue')} />
            </Field>
            <p className="col-span-2 text-sm sm:col-span-3">
              {computed !== null ? (
                <>
                  Price: <span className="font-semibold">{fmtMoney(computed, 2)}</span> per kg
                </>
              ) : (
                'Fill in the formula, or enter the price announced by the Dinas below.'
              )}
            </p>
          </div>
        )}
        <Field label={f.supplierType === 'MITRA' ? 'Or the price announced (per kg)' : 'Price per kg'} required={f.supplierType !== 'MITRA'} error={errors.pricePerKg}>
          <NumberInput disabled={computed !== null} decimals={2} min={0} value={f.pricePerKg} onChange={set('pricePerKg')} />
        </Field>
        <Field label="Applies to" help="e.g. palm age 10-20 years, region">
          <Input value={f.scope} maxLength={100} onChange={(e) => set('scope')(e.target.value)} />
        </Field>
        <Field label="Reference" className="sm:col-span-2" help="Decision of the Disbun / price meeting, or the daily price board">
          <Input value={f.reference} maxLength={150} onChange={(e) => set('reference')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ performance and the Dinas report
interface Performance {
  capacityTph: number;
  days: DailyRow[];
  totals: {
    received: number;
    processed: number;
    cpo: number;
    kernel: number;
    hours: number;
    breakdown: number;
    cost: number;
    bought: number;
    oer: number | null;
    ker: number | null;
    throughput: number | null;
    utilisation: number | null;
    costPerKgProduct: number | null;
  };
}
interface DinasReport {
  month: string;
  company: { name: string; address: string | null } | null;
  production: Performance['totals'];
  days: number;
  byType: { supplierType: string; tickets: number; kg: number; amount: number }[];
  partners: { supplier: { code: string; name: string } | null; tickets: number; netKg: number; sortingKg: number; kg: number; amount: number; avgPrice: number | null }[];
  prices: {
    effectiveDate: string;
    pricePerKg: number;
    kIndex: number | null;
    cpoPrice: number | null;
    kernelPrice: number | null;
    cpoYield: number | null;
    kernelYield: number | null;
    scope: string | null;
    reference: string | null;
  }[];
}

export function PerformancePage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const q = useQuery({ queryKey: ['mill', 'performance', from, to], queryFn: () => api.get<Performance>('/mill/performance', { from, to }) });
  const t = q.data?.totals;
  const printDinas = async () => {
    try {
      const r = await api.get<DinasReport>('/mill/dinas-report', { month });
      printHtml(`<!doctype html><html><head><title>Laporan Bulanan PKS ${esc(r.month)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Laporan Bulanan Pembelian TBS dan Pengolahan, ${esc(r.month)}</h1>
<p>${esc(r.company?.name ?? '')}${r.company?.address ? ` · ${esc(r.company.address)}` : ''}<br><span class="muted">To the provincial plantation office (Permentan 13/2024 Art. 23)</span></p>
<h2>TBS price for partner smallholders</h2>
<table><thead><tr><th>From</th><th class="r">K %</th><th class="r">CPO price</th><th class="r">CPO yield</th><th class="r">Kernel price</th><th class="r">Kernel yield</th><th class="r">TBS price / kg</th><th>Applies to</th><th>Reference</th></tr></thead><tbody>
${r.prices.map((p) => `<tr><td>${esc(fmtDate(p.effectiveDate))}</td><td class="r">${p.kIndex ?? ''}</td><td class="r">${p.cpoPrice !== null ? esc(fmtNumber(p.cpoPrice)) : ''}</td><td class="r">${p.cpoYield ?? ''}</td><td class="r">${p.kernelPrice !== null ? esc(fmtNumber(p.kernelPrice)) : ''}</td><td class="r">${p.kernelYield ?? ''}</td><td class="r">${esc(fmtMoney(p.pricePerKg, 2))}</td><td>${esc(p.scope ?? '')}</td><td>${esc(p.reference ?? '')}</td></tr>`).join('') || '<tr><td colspan="9">No price recorded</td></tr>'}</tbody></table>
<h2>Fruit bought from partner smallholders</h2>
<table><thead><tr><th>Supplier</th><th class="r">Tickets</th><th class="r">Net kg</th><th class="r">Sorting kg</th><th class="r">Accepted kg</th><th class="r">Average price</th><th class="r">Value</th></tr></thead><tbody>
${r.partners.map((p) => `<tr><td>${esc(p.supplier?.name ?? '')}</td><td class="r">${p.tickets}</td><td class="r">${esc(fmtNumber(p.netKg))}</td><td class="r">${esc(fmtNumber(p.sortingKg))}</td><td class="r">${esc(fmtNumber(p.kg))}</td><td class="r">${p.avgPrice ? esc(fmtMoney(p.avgPrice, 2)) : ''}</td><td class="r">${esc(fmtMoney(p.amount, 0))}</td></tr>`).join('') || '<tr><td colspan="7">None</td></tr>'}</tbody></table>
<h2>All fruit bought</h2>
<table><thead><tr><th>Kind of supplier</th><th class="r">Tickets</th><th class="r">Kg</th><th class="r">Value</th></tr></thead><tbody>
${r.byType.map((b) => `<tr><td>${esc(SUPPLIER_TYPES[b.supplierType])}</td><td class="r">${b.tickets}</td><td class="r">${esc(fmtNumber(b.kg))}</td><td class="r">${esc(fmtMoney(b.amount, 0))}</td></tr>`).join('')}</tbody></table>
<h2>Processing</h2>
<table><tbody><tr><td>Days processed</td><td class="r">${r.days}</td><td>TBS processed</td><td class="r">${esc(fmtNumber(r.production.processed))} kg</td></tr>
<tr><td>CPO</td><td class="r">${esc(fmtNumber(r.production.cpo))} kg</td><td>OER</td><td class="r">${esc(num(r.production.oer))}%</td></tr>
<tr><td>Kernel</td><td class="r">${esc(fmtNumber(r.production.kernel))} kg</td><td>KER</td><td class="r">${esc(num(r.production.ker))}%</td></tr></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px;text-align:center"><div></div><div style="border-top:1px solid #333;padding-top:4px">Mill manager</div></div>
</body></html>`);
    } catch (e) {
      toast.error(e);
    }
  };
  const csv = () =>
    q.data &&
    downloadCsv(`mill-performance-${from}-${to}.csv`, [
      ['Date', 'Report', 'Received kg', 'Processed kg', 'Restan kg', 'CPO kg', 'OER %', 'Kernel kg', 'KER %', 'FFA %', 'Losses %', 'Hours', 'Breakdown h', 't/h'],
      ...q.data.days.map((d) => [
        d.date.slice(0, 10),
        d.number,
        d.tbsReceivedKg,
        d.tbsProcessedKg,
        d.restanKg,
        d.cpoKg,
        d.oer,
        d.kernelKg,
        d.ker,
        d.cpoFfa,
        d.totalLoss,
        d.processingHours,
        d.breakdownHours,
        d.throughput,
      ]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Mill Performance"
        subtitle="Extraction rates, throughput and cost of the posted days; OER and KER on the totals of the period"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="month" value={month} max={isoDate().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month of the Dinas report" className="w-40" />
            <Button variant="outline" icon="printer" onClick={printDinas}>
              Dinas monthly report
            </Button>
            <Button variant="outline" icon="download" disabled={!q.data?.days.length} onClick={csv}>
              CSV
            </Button>
          </div>
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
      {q.isLoading || !t ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Fruit processed" value={`${num(t.processed / 1000, 1)} t`} hint={`received ${num(t.received / 1000, 1)} t · bought ${num(t.bought / 1000, 1)} t`} />
            <Stat label="OER / KER" value={`${num(t.oer)}% / ${num(t.ker)}%`} hint={`CPO ${num(t.cpo / 1000, 1)} t · kernel ${num(t.kernel / 1000, 1)} t`} />
            <Stat
              label="Throughput"
              value={t.throughput !== null ? `${t.throughput} t/h` : '-'}
              hint={`${num(t.hours, 1)} h processing · ${num(t.breakdown, 1)} h breakdown${t.utilisation !== null ? ` · ${t.utilisation}% of capacity` : ''}`}
            />
            <Stat label="Cost per kg product" value={t.costPerKgProduct !== null ? fmtMoney(t.costPerKgProduct, 2) : '-'} hint={`fruit + processing ${fmtMoney(t.cost, 0)}`} />
          </div>
          <Card bodyClass="p-0">
            {!q.data!.days.length ? (
              <EmptyState icon="chart-column" title="No posted days in this period" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Day</th>
                      <th className="px-2 py-2 text-right">Processed t</th>
                      <th className="px-2 py-2 text-right">OER</th>
                      <th className="px-2 py-2 text-right">KER</th>
                      <th className="px-2 py-2 text-right">FFA</th>
                      <th className="px-2 py-2 text-right">Losses</th>
                      <th className="px-2 py-2 text-right">Hours</th>
                      <th className="px-2 py-2 text-right">t/h</th>
                      <th className="px-4 py-2 text-right">Capacity use</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.data!.days.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-2">
                          <Link to={`/mill/daily/${d.id}`} className="text-brand-600">
                            {fmtDate(d.date)}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right">{num(d.tbsProcessedKg / 1000, 1)}</td>
                        <td className="px-2 py-2 text-right">{num(d.oer)}%</td>
                        <td className="px-2 py-2 text-right">{num(d.ker)}%</td>
                        <td className="px-2 py-2 text-right">{d.cpoFfa !== null ? `${d.cpoFfa}%` : '-'}</td>
                        <td className="px-2 py-2 text-right">{d.totalLoss !== null ? `${d.totalLoss}%` : '-'}</td>
                        <td className="px-2 py-2 text-right">{num(d.processingHours, 1)}</td>
                        <td className="px-2 py-2 text-right">{d.throughput ?? '-'}</td>
                        <td className="px-4 py-2 text-right">{d.utilisation !== null ? `${d.utilisation}%` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ============================================================ storage tanks
export function TanksPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const lists = useLists();
  const [edit, setEdit] = useState<Tank | 'new' | null>(null);
  const tanks = lists.data?.tanks ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Storage Tanks"
        subtitle="CPO tanks with their calibration table (tabel tera from the metrology office) and kernel silos / bunkers; the daily report takes the stock from them"
        actions={
          can('mill.tank.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New tank
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {lists.isLoading ? (
          <Loading />
        ) : !tanks.length ? (
          <EmptyState icon="cylinder" title="No tanks yet" description="Add each CPO storage tank with its calibration table, and the kernel silo" />
        ) : (
          <ul className="divide-y divide-line">
            {tanks.map((t) => (
              <li key={t.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setEdit(t)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {t.code} · {t.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t.product?.name} in {t.warehouse?.name}
                      {t.capacityKg ? ` · capacity ${fmtNumber(t.capacityKg)} kg` : ''}
                      {t.kind === 'CPO' ? ` · ${t.calibration?.length ?? 0} calibration rows up to ${t.calibration?.length ? t.calibration[t.calibration.length - 1].cm : 0} cm` : ''}
                    </span>
                  </span>
                  <Badge tone={t.kind === 'CPO' ? 'amber' : 'blue'}>{t.kind === 'CPO' ? 'CPO tank' : t.kind === 'KERNEL' ? 'Kernel' : 'Other'}</Badge>
                  {!t.isActive && <Badge tone="gray">Inactive</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <TankModal tank={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['mill'] }))} />}
    </div>
  );
}

function TankModal({ tank, onClose, onDone }: { tank: Tank | null; onClose: () => void; onDone: () => void }) {
  const can = useSession((s) => s.can);
  const [f, setF] = useState({
    code: tank?.code ?? '',
    name: tank?.name ?? '',
    kind: tank?.kind ?? 'CPO',
    productId: tank?.productId ?? null,
    warehouseId: tank?.warehouseId ?? null,
    capacityKg: tank ? String(tank.capacityKg) : '',
    calibrationTempC: tank?.calibrationTempC ? String(tank.calibrationTempC) : '',
    isActive: tank?.isActive ?? true,
  });
  const [table, setTable] = useState((tank?.calibration ?? []).map((r) => `${r.cm};${r.litres}`).join('\n'));
  const [test, setTest] = useState({ cm: '', temp: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rows = table
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/[;,\t ]+/).map((x) => Number(x.replace(',', '.'))))
    .filter((r) => r.length >= 2 && r.every((x) => Number.isFinite(x)))
    .map(([cm, litres]) => ({ cm, litres }));
  const save = useMutation({
    mutationFn: () => {
      const b = { ...f, capacityKg: f.capacityKg || 0, calibrationTempC: f.calibrationTempC || 0, calibration: rows.length ? rows : null };
      return tank ? api.put(`/mill/tanks/${tank.id}`, b) : api.post('/mill/tanks', b);
    },
    onSuccess: () => (toast.success('Tank saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const del = useMutation({ mutationFn: () => api.delete(`/mill/tanks/${tank!.id}`), onSuccess: () => (toast.success('Tank removed'), onDone()), onError: (e) => toast.error(e) });
  const tryIt = useQuery({
    queryKey: ['mill', 'sounding', tank?.id, test.cm, test.temp],
    queryFn: () => api.get<{ litres: number; density: number; kg: number }>(`/mill/tanks/${tank!.id}/sounding`, { cm: test.cm, temp: test.temp }),
    enabled: !!tank && test.cm !== '' && test.temp !== '',
    retry: false,
  });
  const manage = can('mill.tank.manage');
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={tank ? `Tank ${tank.code}` : 'New tank'}
      footer={
        manage && (
          <div className="flex w-full justify-between gap-2">
            {tank ? (
              <Button variant="ghost" icon="trash-2" onClick={async () => (await confirm({ title: `Remove tank ${tank.code}?`, danger: true, confirmText: 'Remove' })) && del.mutate()}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || !f.productId || !f.warehouseId} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kind">
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'CPO', label: 'CPO tank (sounding)' },
              { value: 'KERNEL', label: 'Kernel silo / bunker (kg)' },
              { value: 'OTHER', label: 'Other (kg)' },
            ]}
          />
        </Field>
        <Field label="Capacity (kg)">
          <NumberInput decimals={0} min={0} value={f.capacityKg} onChange={(v) => setF({ ...f, capacityKg: v })} />
        </Field>
        <Field label="Product" required error={errors.productId}>
          <AsyncSelect
            resource="products"
            value={f.productId}
            initialLabel={tank?.product ? `${tank.product.code} - ${tank.product.name}` : undefined}
            onChange={(v) => setF({ ...f, productId: v })}
          />
        </Field>
        <Field label="Warehouse (stock of the tank)" required error={errors.warehouseId} help="One warehouse per tank keeps its system stock comparable with the sounding">
          <AsyncSelect resource="warehouses" value={f.warehouseId} initialLabel={tank?.warehouse?.name} onChange={(v) => setF({ ...f, warehouseId: v })} />
        </Field>
        {f.kind === 'CPO' && (
          <>
            <Field
              label="Calibration table (cm;litres per line)"
              className="sm:col-span-2"
              error={errors.calibration}
              help={`${rows.length} rows read. Paste from the tabel tera (height in cm and volume in litres, one pair per line); heights between rows are interpolated`}
            >
              <Textarea rows={6} className="font-mono text-xs" value={table} placeholder={'0;0\n10;5250\n20;10520\n...'} onChange={(e) => setTable(e.target.value)} />
            </Field>
            <Field label="Calibration temperature (°C)" help="Gives the steel shell correction 1 + 0.0000348 x (T - this); empty: no correction">
              <NumberInput decimals={1} min={0} max={100} value={f.calibrationTempC} onChange={(v) => setF({ ...f, calibrationTempC: v })} />
            </Field>
            {tank && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Try a sounding (saved table)</p>
                <div className="flex gap-2">
                  <NumberInput decimals={1} min={0} value={test.cm} placeholder="cm" onChange={(v) => setTest({ ...test, cm: v })} aria-label="Sounding cm" />
                  <NumberInput decimals={1} min={0} max={120} value={test.temp} placeholder="°C" onChange={(v) => setTest({ ...test, temp: v })} aria-label="Temperature" />
                </div>
                <p className="mt-2 text-sm">
                  {tryIt.data ? (
                    `${fmtNumber(tryIt.data.litres)} l x ${tryIt.data.density} = ${fmtNumber(tryIt.data.kg)} kg`
                  ) : tryIt.error ? (
                    <span className="text-red-600">{(tryIt.error as Error).message}</span>
                  ) : (
                    '-'
                  )}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
