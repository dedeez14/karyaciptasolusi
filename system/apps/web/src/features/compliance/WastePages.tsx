import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea, toast } from '@/components/ui';
import { downloadCsv, esc, printHtml, PRINT_CSS, TREATMENT } from './common';

// ============================================================ B3 waste
interface StockRow {
  id: string;
  code: string;
  name: string;
  category: number;
  sourceType: string;
  atLeast50KgPerDay: boolean;
  isActive: boolean;
  storageLocation: string | null;
  storageDays: number;
  inStore: number;
  overdue: number;
  nextDeadline: string | null;
  daysLeft: number | null;
  perDay: number;
  rateWarning: boolean;
}
interface Handover {
  id: string;
  number: string;
  date: string;
  treatment: string;
  status: string;
  manifestNo: string | null;
  vehicleNo: string | null;
  licenceNo: string | null;
  notes: string | null;
  transporter: { name: string } | null;
  receiver: { name: string } | null;
  lines: { code: string; name: string; qty: number }[];
  totalQty: number;
}
interface LogRow {
  id: string;
  code: string;
  name: string;
  date: string;
  source: string | null;
  qty: number;
  maxStorageDate: string;
  outs: { date: string; qty: number; number: string; manifestNo: string | null; treatment: string; destination: string }[];
  remaining: number;
}
interface Balance {
  company: string;
  from: string;
  to: string;
  rows: { code: string; name: string; category: number; openingKg: number; generatedKg: number; storedKg: number; unmanagedKg: number; treatedKg: Record<string, number> }[];
  totals: { A: number; B: number; C: number; D: number; remaining: number };
  performance: number | null;
  months: { month: string; storedKg: number; handedKg: number }[];
}

const kg = (v: number) => `${fmtNumber(v, 3)} kg`;
const halfYear = () => {
  const d = new Date();
  return { from: isoDate(new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1)), to: isoDate(d) };
};

/** B3 waste: what is in the temporary store and until when, logbook, hand-overs with Festronik, waste balance */
export function WastePage() {
  const [tab, setTab] = useState<'store' | 'logbook' | 'handovers' | 'balance'>('store');
  return (
    <div className="space-y-5">
      <PageHeader
        title="B3 Waste"
        subtitle="Hazardous waste in the temporary store (TPS): storage limits of Permen LHK 6/2021 Art. 79, hand-overs with the Festronik manifest (Art. 99), logbook and waste balance reported at least every 6 months at plb3.menlhk.go.id (Art. 80)"
        actions={
          <Link to="/r/waste-types" className="text-sm text-brand-600">
            Waste types
          </Link>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'store', label: 'In store' },
          { value: 'logbook', label: 'Logbook' },
          { value: 'handovers', label: 'Hand-overs' },
          { value: 'balance', label: 'Waste balance' },
        ]}
      />
      {tab === 'store' && <WasteStore />}
      {tab === 'logbook' && <WasteLogbook />}
      {tab === 'handovers' && <WasteHandovers />}
      {tab === 'balance' && <WasteBalance />}
    </div>
  );
}

function WasteStore() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [entry, setEntry] = useState<StockRow | 'any' | null>(null);
  const [handover, setHandover] = useState(false);
  const q = useQuery({ queryKey: ['compliance', 'waste', 'stock'], queryFn: () => api.get<StockRow[]>('/compliance/waste/stock') });
  const common = useMutation({ mutationFn: () => api.post<{ added: string[] }>('/compliance/waste/types/common'), onSuccess: (r) => (toast.success(r.added.length ? `Added ${r.added.join(', ')}` : 'All common codes are already there'), qc.invalidateQueries({ queryKey: ['compliance', 'waste'] })), onError: (e) => toast.error(e) });
  const manage = can('compliance.waste.manage');
  const rows = (q.data ?? []).filter((r) => r.isActive || r.inStore > 0);
  return (
    <>
      {manage && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" icon="list-checks" loading={common.isPending} onClick={() => common.mutate()}>
            Add common waste codes
          </Button>
          <Button variant="outline" icon="plus" disabled={!rows.length} onClick={() => setEntry('any')}>
            Store waste
          </Button>
          <Button icon="truck" disabled={!rows.some((r) => r.inStore > 0)} onClick={() => setHandover(true)}>
            Hand over / treat
          </Button>
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="biohazard" title="No B3 waste types" description="Add the waste your site produces (e.g. B105d used oil, B110d rags, A102d batteries) with the code of PP 22/2021 Annex IX" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {r.code} · {r.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Category {r.category} · max {r.storageDays} days in store{r.storageLocation ? ` · ${r.storageLocation}` : ''} · about {fmtNumber(r.perDay, 1)} kg a day
                  </span>
                  {r.rateWarning && <span className="block text-xs text-red-600">Generated at 50 kg a day or more: the limit is 90 days - update the waste type</span>}
                </span>
                <span className="text-right">
                  <span className="block font-semibold">{kg(r.inStore)}</span>
                  {r.nextDeadline && <span className="block text-xs text-slate-500">oldest until {fmtDate(r.nextDeadline)}</span>}
                </span>
                {r.overdue > 0 ? <Badge tone="red">{kg(r.overdue)} over the limit</Badge> : r.daysLeft !== null && r.inStore > 0 ? <Badge tone={r.daysLeft <= 14 ? 'amber' : 'green'}>{r.daysLeft} days left</Badge> : null}
                {manage && r.isActive && (
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => setEntry(r)}>
                    Store
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {entry && <StoreWaste types={rows.filter((r) => r.isActive)} initial={entry === 'any' ? null : entry.id} onClose={() => setEntry(null)} onSaved={() => (setEntry(null), qc.invalidateQueries({ queryKey: ['compliance'] }))} />}
      {handover && <NewHandover types={rows.filter((r) => r.inStore > 0)} onClose={() => setHandover(false)} onSaved={() => (setHandover(false), qc.invalidateQueries({ queryKey: ['compliance'] }))} />}
    </>
  );
}

function StoreWaste({ types, initial, onClose, onSaved }: { types: StockRow[]; initial: string | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ wasteTypeId: initial ?? types[0]?.id ?? '', date: isoDate(), qty: '', source: '', notes: '' });
  const t = types.find((x) => x.id === f.wasteTypeId);
  const until = t && f.date ? isoDate(new Date(new Date(f.date).getTime() + t.storageDays * 86_400_000)) : null;
  const save = useMutation({ mutationFn: () => api.post('/compliance/waste/entries', f), onSuccess: () => (toast.success('Recorded in the logbook'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title="Store B3 waste"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.wasteTypeId || !(Number(f.qty) > 0)} onClick={() => save.mutate()}>
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Waste" required className="sm:col-span-2">
          <Select value={f.wasteTypeId} onChange={(e) => setF({ ...f, wasteTypeId: e.target.value })} options={types.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
        </Field>
        <Field label="Date put in the store" required>
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Quantity (kg)" required help="Convert litres with the density (used oil about 0.9 kg/L)">
          <NumberInput decimals={3} min={0} value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        <Field label="Source" className="sm:col-span-2" help="Process, machine or department that produced it">
          <Input value={f.source} maxLength={200} onChange={(e) => setF({ ...f, source: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      {until && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          May be stored until <b>{fmtDate(until)}</b> ({t!.storageDays} days, Permen LHK 6/2021 Art. 79).
        </p>
      )}
    </Modal>
  );
}

function NewHandover({ types, onClose, onSaved }: { types: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: isoDate(), treatment: 'HANDED_OVER', transporterId: null as string | null, receiverId: null as string | null, manifestNo: '', vehicleNo: '', licenceNo: '', notes: '' });
  const [lines, setLines] = useState<{ wasteTypeId: string; qty: string }[]>(types.slice(0, 1).map((t) => ({ wasteTypeId: t.id, qty: String(t.inStore) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const outside = f.treatment === 'HANDED_OVER' || f.treatment === 'EXPORTED';
  const save = useMutation({
    mutationFn: () => api.post<{ number: string }>('/compliance/waste/handovers', { ...f, lines }),
    onSuccess: (r) => (toast.success(`${r.number} recorded`), onSaved()),
    onError: (e: unknown) => {
      const errs = (e as { errors?: Record<string, string> })?.errors;
      if (errs) setErrors(errs);
      toast.error(e);
    },
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="B3 waste leaving the store"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!lines.length || lines.some((l) => !(Number(l.qty) > 0))} onClick={() => save.mutate()}>
          Record
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="What happens to it">
          <Select value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })} options={Object.entries(TREATMENT).map(([value, label]) => ({ value, label }))} />
        </Field>
        {outside && (
          <>
            <Field label="Licensed transporter" required error={errors.transporterId}>
              <AsyncSelect resource="suppliers" value={f.transporterId} onChange={(v) => setF({ ...f, transporterId: v })} />
            </Field>
            <Field label="Licensed receiver (collector / processor)" required error={errors.receiverId}>
              <AsyncSelect resource="suppliers" value={f.receiverId} onChange={(v) => setF({ ...f, receiverId: v })} />
            </Field>
            <Field label="Festronik manifest no." required error={errors.manifestNo} help="Filled by the transporter at festronik.menlhk.go.id and confirmed by us">
              <Input value={f.manifestNo} maxLength={60} onChange={(e) => setF({ ...f, manifestNo: e.target.value })} />
            </Field>
            <Field label="Vehicle no.">
              <Input value={f.vehicleNo} maxLength={30} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} />
            </Field>
            <Field label="Receiver's licence (KLHK)" className="sm:col-span-2">
              <Input value={f.licenceNo} maxLength={100} onChange={(e) => setF({ ...f, licenceNo: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Waste</span>
          {lines.length < types.length && (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setLines([...lines, { wasteTypeId: types.find((t) => !lines.some((l) => l.wasteTypeId === t.id))!.id, qty: '' }])}>
              Add
            </Button>
          )}
        </div>
        {lines.map((l, i) => {
          const t = types.find((x) => x.id === l.wasteTypeId);
          return (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <Select value={l.wasteTypeId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, wasteTypeId: e.target.value } : x)))} options={types.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
              </div>
              <div className="w-40">
                <NumberInput decimals={3} min={0} max={t?.inStore} value={l.qty} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: v } : x)))} aria-label="Kilograms" />
                <span className="text-xs text-slate-500">of {kg(t?.inStore ?? 0)}</span>
                {errors[`lines.${i}.qty`] && <span className="block text-xs text-red-600">{errors[`lines.${i}.qty`]}</span>}
              </div>
              <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
            </div>
          );
        })}
        <p className="text-xs text-slate-500">Taken from the store oldest deadline first.</p>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function PeriodPicker({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="From">
        <DatePicker value={value.from} clearable={false} onChange={(v) => v && onChange({ ...value, from: v })} />
      </Field>
      <Field label="To">
        <DatePicker value={value.to} clearable={false} onChange={(v) => v && onChange({ ...value, to: v })} />
      </Field>
    </div>
  );
}

function WasteLogbook() {
  const [p, setP] = useState(halfYear);
  const q = useQuery({ queryKey: ['compliance', 'waste', 'logbook', p], queryFn: () => api.get<LogRow[]>('/compliance/waste/logbook', p) });
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const cancel = async (r: LogRow) => {
    if (!(await confirm({ title: `Cancel the entry of ${kg(r.qty)} ${r.code}?`, danger: true, confirmText: 'Cancel entry' }))) return;
    try {
      await api.post(`/compliance/waste/entries/${r.id}/cancel`);
      toast.success('Entry cancelled');
      qc.invalidateQueries({ queryKey: ['compliance'] });
    } catch (e) {
      toast.error(e);
    }
  };
  const print = () => {
    const rows = q.data ?? [];
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Logbook B3 ${esc(p.from)} - ${esc(p.to)}</title><style>${PRINT_CSS} @page { size: A4 landscape; }</style></head><body>
<h1>Pencatatan penyimpanan limbah B3 (logbook)</h1><div class="muted">Permen LHK 6/2021 Annex IX form A · ${esc(fmtDate(p.from))} - ${esc(fmtDate(p.to))}</div>
<table><thead><tr><th>No</th><th>Waste</th><th>Date in</th><th>Source</th><th class="r">Qty in (kg)</th><th>Store until</th><th>Date out</th><th class="r">Qty out (kg)</th><th>Destination</th><th>Document no.</th><th class="r">Left (kg)</th></tr></thead><tbody>
${rows
  .map((r, i) => {
    const outs = r.outs.length ? r.outs : [null];
    return outs
      .map(
        (o, j) =>
          `<tr>${j === 0 ? `<td rowspan="${outs.length}">${i + 1}</td><td rowspan="${outs.length}">${esc(r.code)} ${esc(r.name)}</td><td rowspan="${outs.length}">${esc(fmtDate(r.date))}</td><td rowspan="${outs.length}">${esc(r.source)}</td><td class="r" rowspan="${outs.length}">${esc(fmtNumber(r.qty, 3))}</td><td rowspan="${outs.length}">${esc(fmtDate(r.maxStorageDate))}</td>` : ''}<td>${o ? esc(fmtDate(o.date)) : ''}</td><td class="r">${o ? esc(fmtNumber(o.qty, 3)) : ''}</td><td>${o ? esc(o.destination || TREATMENT[o.treatment]) : ''}</td><td>${o ? esc(o.manifestNo || o.number) : ''}</td>${j === 0 ? `<td class="r" rowspan="${outs.length}">${esc(fmtNumber(r.remaining, 3))}</td>` : ''}</tr>`,
      )
      .join('');
  })
  .join('')}
</tbody></table></body></html>`);
  };
  return (
    <Card title="Logbook (form A)" subtitle="Waste stored in the period and waste still in store from before, with what left the store" actions={<PeriodPicker value={p} onChange={setP} />} bodyClass="p-0 overflow-x-auto">
      <div className="flex justify-end gap-2 px-4 pt-3">
        <Button size="sm" variant="outline" icon="printer" disabled={!q.data?.length} onClick={print}>
          Print
        </Button>
        <Button size="sm" variant="outline" icon="download" disabled={!q.data?.length} onClick={() => downloadCsv(`logbook-b3-${p.from}-${p.to}.csv`, [['Code', 'Waste', 'Date in', 'Source', 'Qty in (kg)', 'Store until', 'Date out', 'Qty out (kg)', 'Destination', 'Document', 'Left (kg)'], ...(q.data ?? []).flatMap((r) => (r.outs.length ? r.outs : [null]).map((o, j) => [r.code, r.name, j ? '' : r.date.slice(0, 10), j ? '' : r.source, j ? '' : r.qty, j ? '' : r.maxStorageDate.slice(0, 10), o?.date.slice(0, 10), o?.qty, o ? o.destination || TREATMENT[o.treatment] : '', o ? o.manifestNo || o.number : '', j ? '' : r.remaining]))])}>
          CSV
        </Button>
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="biohazard" title="Nothing in this period" />
      ) : (
        <table className="mt-2 w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Waste</th>
              <th className="px-2 py-2 text-left">Date in</th>
              <th className="px-2 py-2 text-right">In</th>
              <th className="px-2 py-2 text-left">Store until</th>
              <th className="px-2 py-2 text-left">Out</th>
              <th className="px-2 py-2 text-right">Left</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data.map((r) => {
              const late = r.remaining > 0 && new Date(r.maxStorageDate) < new Date(isoDate());
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-3 py-2">
                    {r.code} · {r.name}
                    {r.source && <div className="text-xs text-slate-500">{r.source}</div>}
                  </td>
                  <td className="px-2 py-2">{fmtDate(r.date)}</td>
                  <td className="px-2 py-2 text-right">{kg(r.qty)}</td>
                  <td className={late ? 'px-2 py-2 font-medium text-red-600' : 'px-2 py-2'}>{fmtDate(r.maxStorageDate)}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.outs.map((o, i) => (
                      <div key={i}>
                        {fmtDate(o.date)} · {kg(o.qty)} · {o.destination || TREATMENT[o.treatment]} {o.manifestNo ? `· ${o.manifestNo}` : `· ${o.number}`}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-right font-medium">{kg(r.remaining)}</td>
                  <td className="px-2 py-2">
                    {can('compliance.waste.manage') && !r.outs.length && (
                      <Button size="sm" variant="ghost" onClick={() => cancel(r)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function WasteHandovers() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['compliance', 'waste', 'handovers'], queryFn: () => api.get<Handover[]>('/compliance/waste/handovers') });
  const cancel = async (h: Handover) => {
    if (!(await confirm({ title: `Cancel ${h.number}?`, message: 'The waste goes back into the store.', danger: true, confirmText: 'Cancel hand-over' }))) return;
    try {
      await api.post(`/compliance/waste/handovers/${h.id}/cancel`);
      toast.success('Cancelled');
      qc.invalidateQueries({ queryKey: ['compliance'] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card bodyClass="p-0">
      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="truck" title="No hand-overs yet" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {h.number} · {fmtDate(h.date)} · {TREATMENT[h.treatment]}
                </span>
                <span className="block text-xs text-slate-500">
                  {h.lines.map((l) => `${l.code} ${kg(l.qty)}`).join(', ')}
                  {h.transporter ? ` · by ${h.transporter.name}` : ''}
                  {h.receiver ? ` to ${h.receiver.name}` : ''}
                  {h.manifestNo ? ` · Festronik ${h.manifestNo}` : ''}
                </span>
              </span>
              <span className="font-semibold">{kg(h.totalQty)}</span>
              {h.status === 'CANCELLED' ? (
                <Badge tone="gray">Cancelled</Badge>
              ) : (
                can('compliance.waste.manage') && (
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

function WasteBalance() {
  const [p, setP] = useState(halfYear);
  const q = useQuery({ queryKey: ['compliance', 'waste', 'balance', p], queryFn: () => api.get<Balance>('/compliance/waste/balance', p) });
  const b = q.data;
  const t = (v: number) => fmtNumber(v / 1000, 3);
  const TR = ['HANDED_OVER', 'UTILISED', 'TREATED', 'LANDFILLED', 'EXPORTED', 'OTHER'];
  const print = () => {
    if (!b) return;
    const sumT = (k: string) => b.rows.reduce((a, r) => a + (r.treatedKg[k] ?? 0), 0);
    const stored = b.rows.reduce((a, r) => a + r.storedKg, 0);
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Neraca limbah B3</title><style>${PRINT_CSS}</style></head><body>
<h1>Neraca Limbah B3</h1><div>Company: <b>${esc(b.company)}</b> · Period: ${esc(fmtDate(b.from))} - ${esc(fmtDate(b.to))}</div><div class="muted">Permen LHK 6/2021 Annex IX form B</div>
<h2>I. Waste at the start and generated (ton)</h2><table><thead><tr><th>No</th><th>Waste</th><th class="r">Brought forward</th><th class="r">Generated</th><th class="r">Total</th></tr></thead><tbody>
${b.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.code)} ${esc(r.name)}</td><td class="r">${t(r.openingKg)}</td><td class="r">${t(r.generatedKg)}</td><td class="r">${t(r.openingKg + r.generatedKg)}</td></tr>`).join('')}
<tr class="b"><td colspan="4">TOTAL A (+)</td><td class="r">${fmtNumber(b.totals.A, 3)}</td></tr></tbody></table>
<h2>II. Treatment (ton)</h2><table><tbody>
<tr><td>1. Stored (within the storage limit)</td><td class="r">${t(stored)}</td></tr>
<tr><td>2. Utilised</td><td class="r">${t(sumT('UTILISED'))}</td></tr><tr><td>3. Treated</td><td class="r">${t(sumT('TREATED'))}</td></tr><tr><td>4. Landfilled</td><td class="r">${t(sumT('LANDFILLED'))}</td></tr>
<tr><td>5. Handed to a third party</td><td class="r">${t(sumT('HANDED_OVER'))}</td></tr><tr><td>6. Exported</td><td class="r">${t(sumT('EXPORTED'))}</td></tr><tr><td>7. Other treatment</td><td class="r">${t(sumT('OTHER'))}</td></tr>
<tr class="b"><td>TOTAL B (-)</td><td class="r">${fmtNumber(b.totals.B, 3)}</td></tr><tr><td>Residue C (+)</td><td class="r">${fmtNumber(b.totals.C, 3)}</td></tr><tr><td>Waste not yet managed D (+) (stored beyond the limit)</td><td class="r">${fmtNumber(b.totals.D, 3)}</td></tr>
<tr class="b"><td>Total waste remaining (C + D)</td><td class="r">${fmtNumber(b.totals.C + b.totals.D, 3)}</td></tr>
<tr class="b"><td>Performance {[A - (C + D)] / A} x 100%</td><td class="r">${b.performance === null ? '-' : fmtNumber(b.performance, 2) + '%'}</td></tr></tbody></table>
<h2>Monthly (kg)</h2><table><thead><tr><th>Month</th><th class="r">Stored</th><th class="r">Handed over / treated</th></tr></thead><tbody>${b.months.map((m) => `<tr><td>${esc(m.month)}</td><td class="r">${fmtNumber(m.storedKg, 3)}</td><td class="r">${fmtNumber(m.handedKg, 3)}</td></tr>`).join('')}</tbody></table>
</body></html>`);
  };
  return (
    <Card title="Waste balance (neraca limbah B3, form B)" subtitle="Report the logbook and balance at least every 6 months at plb3.menlhk.go.id" actions={<PeriodPicker value={p} onChange={setP} />}>
      {q.isLoading || !b ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !b.rows.length ? (
        <EmptyState icon="biohazard" title="No waste in this period" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              A (start + generated) <b>{fmtNumber(b.totals.A, 3)} t</b> · managed B <b>{fmtNumber(b.totals.B, 3)} t</b> · beyond the limit D <b className={b.totals.D ? 'text-red-600' : ''}>{fmtNumber(b.totals.D, 3)} t</b> · performance <b>{b.performance === null ? '-' : `${fmtNumber(b.performance, 2)}%`}</b>
            </div>
            <Button size="sm" variant="outline" icon="printer" onClick={print}>
              Print form B
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Waste</th>
                  <th className="px-2 py-2 text-right">Brought fwd</th>
                  <th className="px-2 py-2 text-right">Generated</th>
                  <th className="px-2 py-2 text-right">Handed over</th>
                  <th className="px-2 py-2 text-right">Own treatment</th>
                  <th className="px-2 py-2 text-right">In store</th>
                  <th className="px-2 py-2 text-right">Over limit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.rows.map((r) => (
                  <tr key={r.code}>
                    <td className="px-3 py-2">
                      {r.code} · {r.name}
                    </td>
                    <td className="px-2 py-2 text-right">{kg(r.openingKg)}</td>
                    <td className="px-2 py-2 text-right">{kg(r.generatedKg)}</td>
                    <td className="px-2 py-2 text-right">{kg((r.treatedKg.HANDED_OVER ?? 0) + (r.treatedKg.EXPORTED ?? 0))}</td>
                    <td className="px-2 py-2 text-right">{kg(TR.filter((k) => !['HANDED_OVER', 'EXPORTED'].includes(k)).reduce((a, k) => a + (r.treatedKg[k] ?? 0), 0))}</td>
                    <td className="px-2 py-2 text-right">{kg(r.storedKg)}</td>
                    <td className={r.unmanagedKg ? 'px-2 py-2 text-right font-medium text-red-600' : 'px-2 py-2 text-right'}>{kg(r.unmanagedKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================ SIINas
interface Siinas {
  company: string;
  period: { year: number; quarter: number; from: string; to: string; due: string; daysLeft: number };
  status: string;
  submittedAt: string | null;
  receiptNo: string | null;
  inputs: Inputs;
  production: { productId: string; code: string; name: string; hsCode: string | null; uom: string; producedQty: number; producedValue: number; soldQty: number; soldValue: number; exportQty: number; exportValue: number; annualCapacity: number | null; quarterCapacity: number | null; utilisation: number | null }[];
  materials: { productId: string; code: string; name: string; hsCode: string | null; uom: string; auxiliary: boolean; origin: string; imported: boolean; qty: number; value: number }[];
  workforce: { total: number; production: { male: number; female: number; unknown: number }; other: { male: number; female: number; unknown: number }; indonesian: number; foreign: number };
  machines: { code: string; name: string; kind: string; manufacturer: string | null; model: string | null; workCenter: string | null }[];
  inventory: { raw: number; finished: number; other: number };
  expenses: { code: string; name: string; amount: number }[];
  waste: { code: string; name: string; generatedKg: number; handedKg: number; treatments: string[] }[];
}
interface Inputs {
  ownershipDomesticPct?: number | null;
  ownershipForeignPct?: number | null;
  machineryInvestment?: number | null;
  otherInvestment?: number | null;
  workingCapital?: number | null;
  landBuildingValue?: number | null;
  capacity: { productId: string; annualCapacity: number; uom?: string | null }[];
  electricityPlnKwh?: number | null;
  electricityPlnCost?: number | null;
  electricityOwnKwh?: number | null;
  electricitySoldKwh?: number | null;
  generatorCapacityKva?: number | null;
  fuels: { type: string; uom: string; qty: number; cost: number }[];
  water: { source: string; m3: number; cost: number }[];
  otherWaste: { kind: 'SOLID' | 'LIQUID' | 'GAS'; description: string; qty: number; uom: string; treatment?: string | null }[];
  productionPlanNotes?: string | null;
  indi40Notes?: string | null;
  notes?: string | null;
}
type Num = string | number | null | undefined;

function lastQuarter() {
  const d = new Date();
  const m = d.getMonth();
  return m < 3 ? { year: d.getFullYear() - 1, quarter: 4 } : { year: d.getFullYear(), quarter: Math.floor(m / 3) };
}

/** Quarterly SIINas report: what the ERP knows plus the figures entered by hand, printable and exportable */
export function SiinasPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [sp, setSp] = useSearchParams();
  const lq = lastQuarter();
  const year = Number(sp.get('year')) || lq.year;
  const quarter = Number(sp.get('quarter')) || lq.quarter;
  const q = useQuery({ queryKey: ['compliance', 'siinas', year, quarter], queryFn: () => api.get<Siinas>('/compliance/siinas', { year, quarter }) });
  const [inp, setInp] = useState<Inputs | null>(null);
  const [submit, setSubmit] = useState(false);
  const [receipt, setReceipt] = useState('');
  useEffect(() => setInp(q.data ? structuredClone(q.data.inputs) : null), [q.data]);
  const r = q.data;
  const locked = r?.status === 'SUBMITTED';
  const editable = can('compliance.siinas.manage') && !locked;
  const save = useMutation({ mutationFn: () => api.put<Siinas>('/compliance/siinas', { year, quarter, inputs: inp }), onSuccess: (d) => (toast.success('Saved'), qc.setQueryData(['compliance', 'siinas', year, quarter], d)), onError: (e) => toast.error(e) });
  const mark = useMutation({
    mutationFn: (undo: boolean) => api.post<Siinas>('/compliance/siinas/submit', { year, quarter, receiptNo: receipt || undefined, undo }),
    onSuccess: (d) => (toast.success(d.status === 'SUBMITTED' ? 'Marked as reported' : 'Reopened'), setSubmit(false), qc.setQueryData(['compliance', 'siinas', year, quarter], d), qc.invalidateQueries({ queryKey: ['compliance', 'overview'] })),
    onError: (e) => toast.error(e),
  });
  const years = Array.from({ length: 6 }, (_, i) => lq.year + 1 - i);
  const set = (k: keyof Inputs) => (v: Num) => setInp((x) => ({ ...x!, [k]: v === '' ? null : v }));
  const numF = (k: keyof Inputs, label: string, help?: string, dec = 0) => (
    <Field label={label} help={help}>
      <NumberInput decimals={dec} min={0} value={(inp?.[k] as Num) ?? ''} disabled={!editable} onChange={set(k)} />
    </Field>
  );

  const csv = () => {
    if (!r) return;
    const rows: (string | number | null | undefined)[][] = [[`SIINas ${r.period.year} Q${r.period.quarter}`, r.company], [], ['Production and sales'], ['Code', 'Product', 'HS', 'Unit', 'Produced', 'Production value', 'Sold', 'Sales value', 'Export qty', 'Export value', 'Capacity / year', 'Utilisation %']];
    r.production.forEach((p) => rows.push([p.code, p.name, p.hsCode, p.uom, p.producedQty, p.producedValue, p.soldQty, p.soldValue, p.exportQty, p.exportValue, p.annualCapacity, p.utilisation]));
    rows.push([], ['Raw and auxiliary materials'], ['Code', 'Material', 'HS', 'Unit', 'Kind', 'Origin', 'Qty', 'Value']);
    r.materials.forEach((m) => rows.push([m.code, m.name, m.hsCode, m.uom, m.auxiliary ? 'Auxiliary' : 'Raw', m.imported ? `Import (${m.origin})` : 'Domestic', m.qty, m.value]));
    const w = r.workforce;
    rows.push([], ['Workforce at quarter end'], ['', 'Male', 'Female', 'Unknown'], ['Production', w.production.male, w.production.female, w.production.unknown], ['Non-production', w.other.male, w.other.female, w.other.unknown], ['Indonesian', w.indonesian], ['Foreign', w.foreign]);
    rows.push([], ['Machines'], ['Code', 'Name', 'Kind', 'Make', 'Model', 'Work centre']);
    r.machines.forEach((m) => rows.push([m.code, m.name, m.kind, m.manufacturer, m.model, m.workCenter]));
    rows.push([], ['Inventory at quarter end'], ['Raw materials', r.inventory.raw], ['Finished goods', r.inventory.finished], ['Other', r.inventory.other]);
    rows.push([], ['Expenses'], ...r.expenses.map((e) => [e.code, e.name, e.amount]));
    const i = r.inputs;
    rows.push([], ['Energy and water'], ['PLN electricity kWh', i.electricityPlnKwh], ['PLN electricity cost', i.electricityPlnCost], ['Own generation kWh', i.electricityOwnKwh], ['Electricity sold kWh', i.electricitySoldKwh], ['Generator capacity kVA', i.generatorCapacityKva]);
    i.fuels.forEach((f) => rows.push(['Fuel', f.type, f.qty, f.uom, f.cost]));
    i.water.forEach((x) => rows.push(['Water', x.source, x.m3, 'm3', x.cost]));
    rows.push([], ['Investment'], ['Machinery', i.machineryInvestment], ['Other investment', i.otherInvestment], ['Working capital (quarter)', i.workingCapital], ['Land and buildings', i.landBuildingValue], ['Domestic ownership %', i.ownershipDomesticPct], ['Foreign ownership %', i.ownershipForeignPct]);
    rows.push([], ['Waste'], ['B3', 'Code', 'Generated kg', 'Handed / treated kg'], ...r.waste.map((x) => ['B3', `${x.code} ${x.name}`, x.generatedKg, x.handedKg]), ...i.otherWaste.map((x) => [x.kind, x.description, x.qty, x.uom, x.treatment]));
    downloadCsv(`siinas-${r.period.year}-q${r.period.quarter}.csv`, rows);
  };

  if (q.isLoading || !r || !inp)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  const prodName = (id: string) => r.production.find((p) => p.productId === id)?.name;
  const raw = r.materials.filter((m) => !m.auxiliary);
  const aux = r.materials.filter((m) => m.auxiliary);
  const MatTable = ({ rows }: { rows: Siinas['materials'] }) =>
    !rows.length ? (
      <p className="px-4 py-4 text-sm text-slate-500">None used in finished work orders this quarter.</p>
    ) : (
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Material</th>
            <th className="px-2 py-2 text-left">HS</th>
            <th className="px-2 py-2 text-left">Origin</th>
            <th className="px-2 py-2 text-right">Quantity</th>
            <th className="px-2 py-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => (
            <tr key={m.productId}>
              <td className="px-3 py-2">
                {m.name} <span className="text-xs text-slate-500">{m.code}</span>
              </td>
              <td className="px-2 py-2">{m.hsCode ?? <span className="text-xs text-amber-600">missing</span>}</td>
              <td className="px-2 py-2">{m.imported ? <Badge tone="amber">Import {m.origin}</Badge> : <Badge tone="green">Domestic</Badge>}</td>
              <td className="px-2 py-2 text-right">
                {fmtNumber(m.qty)} {m.uom}
              </td>
              <td className="px-2 py-2 text-right">{fmtMoney(m.value, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div className="space-y-5">
      <PageHeader
        title="SIINas Quarterly Report"
        subtitle={`Permenperin 13/2025: reported every quarter by the 10th of the following month, one report per factory location. ${r.period.year} Q${r.period.quarter} is due ${fmtDate(r.period.due)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-28">
              <Select value={String(year)} onChange={(e) => setSp({ year: e.target.value, quarter: String(quarter) })} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
            </div>
            <div className="w-24">
              <Select value={String(quarter)} onChange={(e) => setSp({ year: String(year), quarter: e.target.value })} options={[1, 2, 3, 4].map((x) => ({ value: String(x), label: `Q${x}` }))} />
            </div>
            <Button variant="outline" icon="download" onClick={csv}>
              CSV
            </Button>
            {editable && (
              <Button variant="outline" icon="check" loading={save.isPending} onClick={() => save.mutate()}>
                Save inputs
              </Button>
            )}
            {can('compliance.siinas.manage') &&
              (locked ? (
                <Button variant="ghost" loading={mark.isPending} onClick={() => mark.mutate(true)}>
                  Reopen
                </Button>
              ) : (
                <Button icon="send" onClick={() => setSubmit(true)}>
                  Mark as reported
                </Button>
              ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {locked ? <Badge tone="green">Reported {fmtDate(r.submittedAt)}{r.receiptNo ? ` · receipt ${r.receiptNo}` : ''}</Badge> : <Badge tone={r.period.daysLeft < 0 ? 'red' : 'amber'}>{r.status === 'DRAFT' ? 'Draft' : 'Not started'} · {r.period.daysLeft >= 0 ? `${r.period.daysLeft} days left` : `${-r.period.daysLeft} days late`}</Badge>}
        <span className="text-slate-500">
          {fmtDate(r.period.from)} - {fmtDate(r.period.to)} · enter the figures below into siinas.kemenperin.go.id
        </span>
      </div>

      <Card title="Production capacity, production and sales" subtitle="Produced = finished work orders; sales = invoices less returns of own products; export = customers abroad. Enter the installed capacity per year (from the business licence) for utilisation" bodyClass="p-0 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Product</th>
              <th className="px-2 py-2 text-left">HS</th>
              <th className="px-2 py-2 text-right">Produced</th>
              <th className="px-2 py-2 text-right">Production value</th>
              <th className="px-2 py-2 text-right">Sold</th>
              <th className="px-2 py-2 text-right">Sales value</th>
              <th className="px-2 py-2 text-right">of which export</th>
              <th className="w-40 px-2 py-2 text-right">Capacity / year</th>
              <th className="px-2 py-2 text-right">Utilisation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.production.map((p) => {
              const c = inp.capacity.find((x) => x.productId === p.productId);
              return (
                <tr key={p.productId}>
                  <td className="px-3 py-2">
                    {p.name} <span className="text-xs text-slate-500">{p.code}</span>
                  </td>
                  <td className="px-2 py-2">{p.hsCode ?? <span className="text-xs text-amber-600">missing</span>}</td>
                  <td className="px-2 py-2 text-right">
                    {fmtNumber(p.producedQty)} {p.uom}
                  </td>
                  <td className="px-2 py-2 text-right">{fmtMoney(p.producedValue, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(p.soldQty)}</td>
                  <td className="px-2 py-2 text-right">{fmtMoney(p.soldValue, 0)}</td>
                  <td className="px-2 py-2 text-right">{p.exportQty ? `${fmtNumber(p.exportQty)} · ${fmtMoney(p.exportValue, 0)}` : '-'}</td>
                  <td className="px-2 py-2">
                    <NumberInput
                      min={0}
                      disabled={!editable}
                      value={c?.annualCapacity ?? ''}
                      onChange={(v) => setInp((x) => ({ ...x!, capacity: v === '' ? x!.capacity.filter((y) => y.productId !== p.productId) : [...x!.capacity.filter((y) => y.productId !== p.productId), { productId: p.productId, annualCapacity: Number(v), uom: p.uom }] }))}
                      aria-label={`Capacity of ${p.name}`}
                    />
                  </td>
                  <td className="px-2 py-2 text-right">{c?.annualCapacity ? `${fmtNumber((p.producedQty / (c.annualCapacity / 4)) * 100, 1)}%` : '-'}</td>
                </tr>
              );
            })}
            {!r.production.length && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No production or sales of own products this quarter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card title="Raw materials (bahan baku)" subtitle="Consumed by finished work orders; origin from the product or its usual supplier" bodyClass="p-0 overflow-x-auto">
        <MatTable rows={raw} />
      </Card>
      <Card title="Auxiliary materials (bahan penolong)" subtitle="Products marked as auxiliary material" bodyClass="p-0 overflow-x-auto">
        <MatTable rows={aux} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Workforce at the end of the quarter" subtitle="Production = employees marked as direct production workers">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-left" />
                <th className="py-1 text-right">Male</th>
                <th className="py-1 text-right">Female</th>
                <th className="py-1 text-right">Not set</th>
              </tr>
            </thead>
            <tbody>
              {(['production', 'other'] as const).map((k) => (
                <tr key={k}>
                  <td className="py-1">{k === 'production' ? 'Production' : 'Non-production'}</td>
                  <td className="py-1 text-right">{r.workforce[k].male}</td>
                  <td className="py-1 text-right">{r.workforce[k].female}</td>
                  <td className="py-1 text-right">{r.workforce[k].unknown}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm">
            Total {r.workforce.total} · Indonesian {r.workforce.indonesian} · foreign {r.workforce.foreign}
          </p>
        </Card>
        <Card title="Inventory at the end of the quarter" subtitle="Value at average cost">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt>Raw materials</dt>
            <dd className="text-right">{fmtMoney(r.inventory.raw, 0)}</dd>
            <dt>Finished goods</dt>
            <dd className="text-right">{fmtMoney(r.inventory.finished, 0)}</dd>
            <dt>Other</dt>
            <dd className="text-right">{fmtMoney(r.inventory.other, 0)}</dd>
          </dl>
        </Card>
        <Card title="Machines and equipment" subtitle="From the equipment register (not retired)" bodyClass="p-0">
          {!r.machines.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No equipment registered.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {r.machines.map((m) => (
                <li key={m.code} className="px-4 py-2">
                  {m.name} <span className="text-xs text-slate-500">{[m.code, m.kind, m.manufacturer, m.model, m.workCenter].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Expenses of the quarter" subtitle="Posted journals on expense accounts" bodyClass="p-0">
          {!r.expenses.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No expenses posted.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {r.expenses.map((e) => (
                <li key={e.code} className="flex justify-between px-4 py-1.5">
                  <span>
                    {e.code} {e.name}
                  </span>
                  <span>{fmtMoney(e.amount, 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Energy, water and investment" subtitle="Not held in the ERP: enter them from the bills and the books">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {numF('electricityPlnKwh', 'PLN electricity (kWh)')}
          {numF('electricityPlnCost', 'PLN electricity cost (Rp)')}
          {numF('electricityOwnKwh', 'Own generation (kWh)')}
          {numF('electricitySoldKwh', 'Electricity sold (kWh)')}
          {numF('generatorCapacityKva', 'Generator capacity (kVA)')}
          {numF('machineryInvestment', 'Machinery investment (Rp)')}
          {numF('otherInvestment', 'Other investment (Rp)')}
          {numF('workingCapital', 'Working capital this quarter (Rp)', 'Since 2025 per quarter, no longer one turnover')}
          {numF('landBuildingValue', 'Land and buildings (Rp)')}
          {numF('ownershipDomesticPct', 'Domestic ownership (%)', undefined, 2)}
          {numF('ownershipForeignPct', 'Foreign ownership (%)', undefined, 2)}
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <ListEditor
            title="Fuels and lubricants"
            disabled={!editable}
            rows={inp.fuels}
            blank={{ type: '', uom: 'L', qty: 0, cost: 0 }}
            onChange={(fuels) => setInp({ ...inp, fuels })}
            cols={[
              { key: 'type', label: 'Type (solar, LPG, coal...)', kind: 'text' },
              { key: 'uom', label: 'Unit', kind: 'text', w: 'w-20' },
              { key: 'qty', label: 'Quantity', kind: 'num' },
              { key: 'cost', label: 'Cost (Rp)', kind: 'num' },
            ]}
          />
          <ListEditor
            title="Process water"
            disabled={!editable}
            rows={inp.water}
            blank={{ source: '', m3: 0, cost: 0 }}
            onChange={(water) => setInp({ ...inp, water })}
            cols={[
              { key: 'source', label: 'Source (PDAM, ground water, river)', kind: 'text' },
              { key: 'm3', label: 'm³', kind: 'num' },
              { key: 'cost', label: 'Cost (Rp)', kind: 'num' },
            ]}
          />
        </div>
      </Card>

      <Card title="Waste" subtitle="B3 waste from the B3 waste register; add other solid / liquid waste and its treatment">
        {r.waste.length ? (
          <ul className="mb-4 divide-y divide-line text-sm">
            {r.waste.map((w) => (
              <li key={w.code} className="flex justify-between py-1.5">
                <span>
                  B3 {w.code} {w.name}
                </span>
                <span>
                  generated {kg(w.generatedKg)} · out {kg(w.handedKg)}
                  {w.treatments.length ? ` (${w.treatments.map((x) => TREATMENT[x]).join(', ')})` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-500">No B3 waste recorded this quarter.</p>
        )}
        <ListEditor
          title="Other waste"
          disabled={!editable}
          rows={inp.otherWaste}
          blank={{ kind: 'SOLID', description: '', qty: 0, uom: 'kg', treatment: '' }}
          onChange={(otherWaste) => setInp({ ...inp, otherWaste })}
          cols={[
            { key: 'kind', label: 'Kind', kind: 'select', options: ['SOLID', 'LIQUID', 'GAS'], w: 'w-28' },
            { key: 'description', label: 'Description', kind: 'text' },
            { key: 'qty', label: 'Quantity', kind: 'num' },
            { key: 'uom', label: 'Unit', kind: 'text', w: 'w-20' },
            { key: 'treatment', label: 'Treatment', kind: 'text' },
          ]}
        />
      </Card>

      <Card title="Plans and notes">
        <div className="grid gap-3 lg:grid-cols-3">
          <Field label="Production and distribution plan">
            <Textarea rows={3} maxLength={2000} disabled={!editable} value={inp.productionPlanNotes ?? ''} onChange={(e) => set('productionPlanNotes')(e.target.value)} />
          </Field>
          <Field label="INDI 4.0 (industry 4.0 readiness)">
            <Textarea rows={3} maxLength={2000} disabled={!editable} value={inp.indi40Notes ?? ''} onChange={(e) => set('indi40Notes')(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea rows={3} maxLength={4000} disabled={!editable} value={inp.notes ?? ''} onChange={(e) => set('notes')(e.target.value)} />
          </Field>
        </div>
        {inp.capacity.some((c) => !prodName(c.productId)) && <p className="mt-2 text-xs text-slate-500">Capacities are kept for products without production this quarter too.</p>}
      </Card>

      {submit && (
        <Modal
          open
          size="sm"
          onClose={() => setSubmit(false)}
          title={`Mark ${r.period.year} Q${r.period.quarter} as reported`}
          footer={
            <Button icon="check" loading={mark.isPending} onClick={() => mark.mutate(false)}>
              Mark as reported
            </Button>
          }
        >
          <p className="mb-3 text-sm text-slate-600">After submitting the report in SIINas, record its receipt here. The inputs are then locked.</p>
          <Field label="Receipt / submission number">
            <Input value={receipt} maxLength={100} onChange={(e) => setReceipt(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

type Col = { key: string; label: string; kind: 'text' | 'num' | 'select'; options?: string[]; w?: string };
function ListEditor<T extends Record<string, unknown>>({ title, rows, blank, cols, onChange, disabled }: { title: string; rows: T[]; blank: T; cols: Col[]; onChange: (rows: T[]) => void; disabled?: boolean }) {
  const upd = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        {!disabled && (
          <Button size="sm" variant="outline" icon="plus" onClick={() => onChange([...rows, { ...blank }])}>
            Add
          </Button>
        )}
      </div>
      {!rows.length ? (
        <p className="text-xs text-slate-500">None.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              {cols.map((c) => (
                <div key={c.key} className={c.w ?? 'min-w-[7rem] flex-1'}>
                  {c.kind === 'num' ? (
                    <NumberInput min={0} decimals={2} disabled={disabled} value={(r[c.key] as Num) ?? ''} aria-label={c.label} placeholder={c.label} onChange={(v) => upd(i, c.key, v === '' ? 0 : Number(v))} />
                  ) : c.kind === 'select' ? (
                    <Select value={String(r[c.key] ?? '')} disabled={disabled} onChange={(e) => upd(i, c.key, e.target.value)} options={(c.options ?? []).map((o) => ({ value: o, label: o.charAt(0) + o.slice(1).toLowerCase() }))} />
                  ) : (
                    <Input value={String(r[c.key] ?? '')} disabled={disabled} maxLength={120} placeholder={c.label} aria-label={c.label} onChange={(e) => upd(i, c.key, e.target.value)} />
                  )}
                </div>
              ))}
              {!disabled && <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
