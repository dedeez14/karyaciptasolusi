import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { previewFile } from '@/components/ui/preview';
import { cn } from '@/components/ui/primitives';

interface LotRow {
  lotId: string;
  lotNo: string;
  productId: string;
  code: string;
  name: string;
  uom: string | null;
  warehouseId: string;
  warehouse: string;
  expiryDate: string | null;
  daysLeft: number | null;
  status: 'EXPIRED' | 'EXPIRING' | 'OK' | 'NO_EXPIRY';
  qcStatus?: 'RELEASED' | 'HOLD' | 'REJECTED';
  qty: number;
  value: number;
}
interface Trace {
  lot: { id: string; lotNo: string; expiryDate: string | null; productCode: string; productName: string };
  balances: { warehouse: string; qty: number }[];
  movements: { date: string; docType: string; documentId: string; number: string; warehouse: string; partner: string; qty: number }[];
  customers: { id: string; name: string; phone: string | null; email: string | null; qty: number }[];
}
interface Disposal {
  id: string;
  number: string;
  date: string;
  reasonCode: string;
  warehouse: string;
  totalValue: string;
}

const STATUS: Record<LotRow['status'], { label: string; tone: 'red' | 'amber' | 'green' | 'gray' }> = {
  EXPIRED: { label: 'Expired', tone: 'red' },
  EXPIRING: { label: 'Expiring soon', tone: 'amber' },
  OK: { label: 'OK', tone: 'green' },
  NO_EXPIRY: { label: 'No expiry', tone: 'gray' },
};
const REASONS = [
  { value: 'EXPIRED', label: 'Expired (kedaluwarsa)' },
  { value: 'DAMAGED', label: 'Damaged (rusak)' },
  { value: 'RECALL', label: 'Recall (penarikan kembali)' },
  { value: 'OTHER', label: 'Other' },
];

/** Inventory > Lots & Expiry: batches in stock, expiry warnings, lot tracing for recalls and destruction of expired goods */
export default function LotsPage() {
  const [sp, setSp] = useSearchParams();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState(sp.get('status') ?? 'ALL');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [disposing, setDisposing] = useState(false);
  const traceId = sp.get('lot');
  const q = useQuery({ queryKey: ['inventory', 'lots', 'page', status, warehouseId], queryFn: () => api.get<LotRow[]>('/inventory/lots', { status, ...(warehouseId ? { warehouseId } : {}) }) });
  const disposals = useQuery({ queryKey: ['inventory', 'disposals'], queryFn: () => api.get<Disposal[]>('/inventory/disposals'), enabled: can('inventory.adjustment.read') });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || r.lotNo.toLowerCase().includes(s) || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
  }, [q.data, search]);
  const key = (r: LotRow) => `${r.lotId}:${r.warehouseId}`;
  const chosen = rows.filter((r) => picked[key(r)] !== undefined);
  const sameWarehouse = new Set(chosen.map((r) => r.warehouseId)).size <= 1;
  const counts = (q.data ?? []).reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lots & Expiry"
        subtitle="Batches in stock, what expires first, where a batch went (recalls) and the destruction of expired goods"
        actions={
          can('inventory.adjustment.confirm') && (
            <Button icon="flame" variant="danger" disabled={!chosen.length || !sameWarehouse} onClick={() => setDisposing(true)} title={!sameWarehouse ? 'Choose batches of one warehouse' : undefined}>
              Dispose {chosen.length ? `(${chosen.length})` : ''}
            </Button>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['EXPIRED', 'EXPIRING', 'OK', 'NO_EXPIRY'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setStatus(status === k ? 'ALL' : k)} className={cn('card p-3 text-left transition', status === k && 'ring-2 ring-brand-500')}>
            <p className="text-xs text-slate-500">{STATUS[k].label}</p>
            <p className={cn('text-xl font-semibold tabular-nums', k === 'EXPIRED' ? 'text-red-600' : k === 'EXPIRING' ? 'text-amber-600' : 'text-slate-900')}>{status === 'ALL' || status === k ? counts[k] ?? 0 : '·'}</p>
          </button>
        ))}
      </div>
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find batch or product" className="h-9 max-w-64" />
          <div className="w-56">
            <AsyncSelect resource="warehouses" value={warehouseId} onChange={setWarehouseId} placeholder="All warehouses" />
          </div>
          <div className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'ALL', label: 'All batches' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          </div>
        </div>
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="calendar-x" title="No batches" description="Switch on “Track batch / lot and expiry” on a product; receipts then record the batch number and expiry date." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 text-left font-semibold">Product</th>
                  <th className="px-3 py-2 text-left font-semibold">Batch</th>
                  <th className="px-3 py-2 text-left font-semibold">Warehouse</th>
                  <th className="px-3 py-2 text-left font-semibold">Expiry</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={key(r)} className="border-t border-line">
                    <td className="px-3 py-2">
                      {can('inventory.adjustment.confirm') && r.qty > 0 && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={picked[key(r)] !== undefined}
                          onChange={(e) =>
                            setPicked((p) => {
                              const n = { ...p };
                              if (e.target.checked) n[key(r)] = String(r.qty);
                              else delete n[key(r)];
                              return n;
                            })
                          }
                          aria-label={`Select batch ${r.lotNo}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{r.name}</span>
                      <span className="block text-xs text-slate-500">{r.code}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[13px]">{r.lotNo}</td>
                    <td className="px-3 py-2 text-slate-600">{r.warehouse}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.expiryDate ? fmtDate(r.expiryDate) : '—'}{' '}
                      <Badge tone={STATUS[r.status].tone}>{r.daysLeft === null ? STATUS[r.status].label : r.daysLeft < 0 ? `${-r.daysLeft} days ago` : `${r.daysLeft} days`}</Badge>
                      {r.qcStatus && r.qcStatus !== 'RELEASED' && <Badge tone={r.qcStatus === 'HOLD' ? 'amber' : 'red'}>{r.qcStatus === 'HOLD' ? 'QC hold' : 'QC rejected'}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNumber(r.qty)} {r.uom ?? ''}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.value, 0)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" icon="git-branch" onClick={() => setSp({ lot: r.lotId }, { replace: true })}>
                        Trace
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!!disposals.data?.length && (
        <Card title="Destructions (pemusnahan)" bodyClass="p-0">
          <ul className="divide-y divide-line">
            {disposals.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Icon name="flame" className="h-4 w-4 text-red-500" />
                <span className="flex-1">
                  <span className="font-medium">{d.number}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {fmtDate(d.date)} · {d.warehouse} · {REASONS.find((x) => x.value === d.reasonCode)?.label ?? d.reasonCode}
                  </span>
                </span>
                <span className="tabular-nums">{fmtMoney(d.totalValue, 0)}</span>
                <Button size="sm" variant="outline" icon="printer" onClick={() => previewFile({ path: `/inventory/disposals/${d.id}/pdf`, params: { inline: 1 }, title: `Berita Acara ${d.number}` }).catch((e) => toast.error(e))}>
                  Berita acara
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {traceId && <TraceModal id={traceId} onClose={() => setSp({}, { replace: true })} />}
      {disposing && (
        <DisposeModal
          rows={chosen}
          picked={picked}
          setPicked={setPicked}
          onClose={() => setDisposing(false)}
          onDone={() => {
            setPicked({});
            setDisposing(false);
          }}
        />
      )}
    </div>
  );
}

function TraceModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['inventory', 'lot-trace', id], queryFn: () => api.get<Trace>(`/inventory/lots/${id}`) });
  const t = q.data;
  return (
    <Modal open onClose={onClose} title={t ? `Batch ${t.lot.lotNo} · ${t.lot.productName}` : 'Batch'} size="lg">
      {!t ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            {t.lot.productCode} · expiry {t.lot.expiryDate ? fmtDate(t.lot.expiryDate) : 'not set'} · in stock: {t.balances.length ? t.balances.map((b) => `${b.warehouse} ${fmtNumber(b.qty)}`).join(', ') : 'none'}
          </p>
          <div>
            <p className="mb-1 font-medium text-slate-800">Customers who received this batch (for a recall)</p>
            {t.customers.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {t.customers.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <Link to={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs text-slate-500">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
                    <span className="tabular-nums">{fmtNumber(c.qty)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">Not delivered to any customer yet.</p>
            )}
          </div>
          <div>
            <p className="mb-1 font-medium text-slate-800">Movements</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {t.movements.map((m, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-24 text-xs text-slate-500">{fmtDate(m.date)}</span>
                  <Link to={`/documents/${m.docType}/${m.documentId}`} className="flex-1 font-medium text-brand-700 hover:underline">
                    {m.number}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {m.partner || m.warehouse}
                  </span>
                  <span className={cn('w-20 text-right font-medium tabular-nums', m.qty < 0 ? 'text-red-600' : 'text-emerald-700')}>
                    {m.qty > 0 ? '+' : ''}
                    {fmtNumber(m.qty)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DisposeModal({ rows, picked, setPicked, onClose, onDone }: { rows: LotRow[]; picked: Record<string, string>; setPicked: (f: (p: Record<string, string>) => Record<string, string>) => void; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ date: isoDate(), reasonCode: rows.every((r) => r.status === 'EXPIRED') ? 'EXPIRED' : 'DAMAGED', method: '', witnessedBy: '', externalWitness: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = rows.reduce((a, r) => a + (Number(picked[`${r.lotId}:${r.warehouseId}`]) || 0) * (r.qty ? r.value / r.qty : 0), 0);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/inventory/disposals', { ...f, warehouseId: rows[0].warehouseId, items: rows.map((r) => ({ lotId: r.lotId, qty: Number(picked[`${r.lotId}:${r.warehouseId}`]) })) }),
    onSuccess: (d) => {
      toast.success(`Destruction ${d.number} recorded`);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      previewFile({ path: `/inventory/disposals/${d.id}/pdf`, params: { inline: 1 }, title: `Berita Acara ${d.number}` }).catch(() => undefined);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Destroy stock (pemusnahan)"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon="flame" loading={save.isPending} onClick={() => save.mutate()}>
            Record destruction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {rows.map((r) => (
            <li key={r.lotId} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1">
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{r.lotNo}</span>
              </span>
              <div className="w-28">
                <NumberInput decimals={4} min={0} max={r.qty} value={picked[`${r.lotId}:${r.warehouseId}`] ?? ''} onChange={(v) => setPicked((p) => ({ ...p, [`${r.lotId}:${r.warehouseId}`]: v }))} aria-label={`Quantity of ${r.lotNo}`} />
              </div>
              <span className="w-12 text-xs text-slate-500">{r.uom}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date" required error={errors.date}>
            <DatePicker clearable={false} value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="Reason" required>
            <Select value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })} options={REASONS} />
          </Field>
          <Field label="How it was destroyed" help="e.g. crushed and disposed of through a licensed waste contractor">
            <Input value={f.method} maxLength={200} onChange={(e) => setF({ ...f, method: e.target.value })} />
          </Field>
          <Field label="Witnesses (company)">
            <Input value={f.witnessedBy} maxLength={300} onChange={(e) => setF({ ...f, witnessedBy: e.target.value })} placeholder="Names and positions" />
          </Field>
          <Field label="Outside witness" help="Recommended: the tax office account representative (AR), or BPOM / Dinkes for medicines and food" className="sm:col-span-2">
            <Input value={f.externalWitness} maxLength={300} onChange={(e) => setF({ ...f, externalWitness: e.target.value })} placeholder="Name, position, institution" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          Value about {fmtMoney(total, 0)} at average cost, booked as a stock loss. For it to count as a tax-deductible cost, keep the itemised berita acara with photos / video of the destruction and, ideally, an outside witness.
        </p>
      </div>
    </Modal>
  );
}
