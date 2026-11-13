import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, StatCard, Tabs, type Tone } from '@/components/ui/primitives';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const optNum = (v: string) => (v === '' ? null : Number(v));
const STATUS: Record<string, { label: string; tone: Tone }> = {
  RESERVED: { label: 'Reserved', tone: 'blue' },
  ON_RENT: { label: 'On rent', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  RETURNED: { label: 'Returned, to settle', tone: 'amber' },
  CLOSED: { label: 'Closed', tone: 'gray' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};
const UNIT_STATUS: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'Available', tone: 'green' },
  MAINTENANCE: { label: 'Maintenance', tone: 'amber' },
  RETIRED: { label: 'Retired', tone: 'gray' },
};
const BASIS: Record<string, string> = { DAY: 'Daily', WEEK: 'Weekly', MONTH: 'Monthly' };
const METER: Record<string, string> = { NONE: 'No meter', HOUR: 'Hour meter', KM: 'Odometer (km)' };
const meterWord = (m: string) => (m === 'HOUR' ? 'h' : m === 'KM' ? 'km' : '');
const BAR: Record<string, string> = {
  RESERVED: 'bg-blue-200 text-blue-900',
  ON_RENT: 'bg-green-300 text-green-900',
  OVERDUE: 'bg-red-300 text-red-900',
  RETURNED: 'bg-slate-200 text-slate-700',
  CLOSED: 'bg-slate-200 text-slate-700',
};

interface Unit {
  id: string;
  code: string;
  name: string;
  category: string | null;
  serialNo: string | null;
  fixedAssetId: string | null;
  meterUnit: string;
  meter: number;
  rateDay: number;
  rateWeek: number;
  rateMonth: number;
  meterAllowance: number;
  excessRate: number;
  status: string;
  notes: string | null;
  asset: { id: string; code: string; name: string } | null;
  onRent: { id: string; number: string } | null;
}
interface ContractRow {
  id: string;
  number: string;
  customer: string | null;
  startDate: string;
  endDate: string;
  status: string;
  basis: string;
  billing: string;
  billedTo: string | null;
  depositHeld: number;
  units: string[];
  overdue: boolean;
}
interface Line {
  id: string;
  unitId: string;
  unit: { code: string; name: string; meterUnit: string; meter: number };
  rate: number;
  meterAllowance: number;
  excessRate: number;
  outDate: string | null;
  outMeter: number | null;
  returnDate: string | null;
  returnMeter: number | null;
  billedMeter: number | null;
  condition: string | null;
  readings: { id: string; date: string; reading: number }[];
}
interface Contract {
  id: string;
  number: string;
  customerId: string;
  customer: { id: string; code: string; name: string } | null;
  site: string | null;
  startDate: string;
  endDate: string;
  basis: string;
  billing: string;
  withOperator: boolean;
  deposit: number;
  depositHeld: number;
  status: string;
  billedTo: string | null;
  notes: string | null;
  lines: Line[];
  bills: {
    id: string;
    kind: 'RENT' | 'DAMAGE';
    periodFrom: string;
    periodTo: string;
    amount: number;
    status: string;
    invoice: { id: string; number: string; status: string; grandTotal: number; taxTotal: number; paidAmount: number } | null;
  }[];
  deposits: { id: string; kind: string; amount: number; date: string; note: string | null; status: string }[];
}
interface Preview {
  from: string | null;
  rows: { label: string; from: string; to: string; days: number; rent: number; used: number | null; allowance: number; excessQty: number; excess: number }[];
  total: number;
}

// ============================================================ contracts
export function ContractsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'RESERVED' | 'ON_RENT' | 'RETURNED' | 'CLOSED' | 'CANCELLED'>('ALL');
  const [search, setSearch] = useState('');
  const [make, setMake] = useState(false);
  const q = useQuery({ queryKey: ['rental', 'contracts', status], queryFn: () => api.get<ContractRow[]>('/rental/contracts', status === 'ALL' ? {} : { status }) });
  const rows = (q.data ?? []).filter((r) => !search || `${r.number} ${r.customer ?? ''} ${r.units.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rental Contracts"
        subtitle="Equipment booked by date, handed over with the meter, billed by period with PPN (the lessee withholds PPh 23 2%), deposits held as a liability"
        actions={
          can('rental.manage') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New contract
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: 'ALL', label: 'Open & done' },
            { value: 'RESERVED', label: 'Reserved' },
            { value: 'ON_RENT', label: 'On rent' },
            { value: 'RETURNED', label: 'To settle' },
            { value: 'CLOSED', label: 'Closed' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
        <div className="w-64">
          <Input placeholder="Search number, customer, unit" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="clipboard-list" title="No contracts" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const st = r.overdue ? 'OVERDUE' : r.status;
              return (
                <li key={r.id}>
                  <Link to={`/rental/contracts/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {r.number} · {r.customer}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {fmtDate(r.startDate)} - {fmtDate(r.endDate)} · {BASIS[r.basis]} rate · {r.units.join(', ')}
                        {r.billedTo ? ` · billed to ${fmtDate(r.billedTo)}` : ''}
                      </span>
                    </span>
                    {r.depositHeld > 0 && <span className="text-xs text-slate-600">deposit {fmtMoney(r.depositHeld, 0)}</span>}
                    <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {make && <ContractForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/rental/contracts/${id}`)} />}
    </div>
  );
}

function ContractForm({ c, onClose, onSaved }: { c?: Contract; onClose: () => void; onSaved: (id: string) => void }) {
  const units = useQuery({ queryKey: ['rental', 'units'], queryFn: () => api.get<Unit[]>('/rental/units') });
  const end = new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    customerId: c?.customerId ?? (null as string | null),
    site: c?.site ?? '',
    startDate: c?.startDate ?? isoDate(),
    endDate: c?.endDate ?? end,
    basis: c?.basis ?? 'MONTH',
    billing: c?.billing ?? 'MONTHLY',
    withOperator: c?.withOperator ?? false,
    deposit: str(c?.deposit ?? 0),
    notes: c?.notes ?? '',
  });
  const [lines, setLines] = useState(
    c?.lines.map((l) => ({ unitId: l.unitId, rate: str(l.rate), meterAllowance: str(l.meterAllowance), excessRate: str(l.excessRate) })) ?? [
      { unitId: '', rate: '', meterAllowance: '', excessRate: '' },
    ],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        lines: lines.filter((l) => l.unitId).map((l) => ({ unitId: l.unitId, rate: optNum(l.rate), meterAllowance: optNum(l.meterAllowance), excessRate: optNum(l.excessRate) })),
      };
      return c ? api.put<Contract>(`/rental/contracts/${c.id}`, body) : api.post<Contract>('/rental/contracts', body);
    },
    onSuccess: (x) => (toast.success(`${x.number} saved`), onSaved(x.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const rateKey = f.basis === 'DAY' ? 'rateDay' : f.basis === 'WEEK' ? 'rateWeek' : 'rateMonth';
  const pick = (units.data ?? []).filter((u) => u.status === 'AVAILABLE');
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={c ? `Contract ${c.number}` : 'New rental contract'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.customerId || !lines.some((l) => l.unitId)} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} initialLabel={c?.customer ? `${c.customer.code} - ${c.customer.name}` : undefined} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Site / project">
          <Input value={f.site} maxLength={300} onChange={(e) => setF({ ...f, site: e.target.value })} />
        </Field>
        <Field label="Start" required>
          <DatePicker value={f.startDate} clearable={false} onChange={(v) => setF({ ...f, startDate: v ?? isoDate() })} />
        </Field>
        <Field label="End (planned)" required error={errors.endDate}>
          <DatePicker value={f.endDate} clearable={false} onChange={(v) => setF({ ...f, endDate: v ?? end })} />
        </Field>
        <Field label="Rate basis" help="A part month is charged by the days in that month">
          <Select value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Billing">
          <Select
            value={f.billing}
            onChange={(e) => setF({ ...f, billing: e.target.value })}
            options={[
              { value: 'MONTHLY', label: 'Every month' },
              { value: 'END', label: 'At the end' },
            ]}
          />
        </Field>
        <Field label="Security deposit asked" help="Held as a liability, not income" error={errors.deposit}>
          <NumberInput decimals={0} min={0} value={f.deposit} onChange={(v) => setF({ ...f, deposit: v })} />
        </Field>
        <Field label=" ">
          <Checkbox checked={f.withOperator} onChange={(v) => setF({ ...f, withOperator: v })} label="With operator / driver" />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">Units</span>
          {errors.lines && <span className="text-xs text-red-600">{errors.lines}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-2">Unit</th>
                <th className="w-36 pr-2">Rate ({BASIS[f.basis].toLowerCase()})</th>
                <th className="w-32 pr-2">Allowance / month</th>
                <th className="w-32 pr-2">Excess rate</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const u = units.data?.find((x) => x.id === l.unitId);
                const set = (p: Partial<typeof l>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <Select
                        value={l.unitId}
                        placeholder="Choose a unit"
                        onChange={(e) => set({ unitId: e.target.value })}
                        options={[...pick, ...(u && !pick.includes(u) ? [u] : [])].map((x) => ({ value: x.id, label: `${x.code} · ${x.name}${x.onRent ? ` (out on ${x.onRent.number})` : ''}` }))}
                      />
                    </td>
                    <td className="pr-2">
                      <NumberInput decimals={0} min={0} value={l.rate} placeholder={u ? String(u[rateKey]) : ''} onChange={(v) => set({ rate: v })} aria-label="Rate" />
                    </td>
                    <td className="pr-2">
                      <NumberInput
                        decimals={1}
                        min={0}
                        disabled={u?.meterUnit === 'NONE'}
                        value={l.meterAllowance}
                        placeholder={u && u.meterUnit !== 'NONE' ? `${u.meterAllowance} ${meterWord(u.meterUnit)}` : ''}
                        onChange={(v) => set({ meterAllowance: v })}
                        aria-label="Meter allowance"
                      />
                    </td>
                    <td className="pr-2">
                      <NumberInput
                        decimals={0}
                        min={0}
                        disabled={u?.meterUnit === 'NONE'}
                        value={l.excessRate}
                        placeholder={u && u.meterUnit !== 'NONE' ? String(u.excessRate) : ''}
                        onChange={(v) => set({ excessRate: v })}
                        aria-label="Excess rate"
                      />
                    </td>
                    <td>
                      <Button variant="ghost" size="icon" icon="trash-2" aria-label="Remove unit" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button className="mt-2" variant="ghost" size="sm" icon="plus" disabled={lines.length >= 50} onClick={() => setLines([...lines, { unitId: '', rate: '', meterAllowance: '', excessRate: '' }])}>
          Add unit
        </Button>
        <p className="mt-1 text-xs text-slate-500">Empty fields take the rates of the unit. A unit already booked on the same dates is refused.</p>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function ContractPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rental', 'contract', id], queryFn: () => api.get<Contract>(`/rental/contracts/${id}`) });
  const [modal, setModal] = useState<'' | 'edit' | 'handover' | 'meter' | 'return' | 'deposit'>('');
  const [upTo, setUpTo] = useState(isoDate());
  const [extras, setExtras] = useState<{ description: string; amount: string }[]>([]);
  const c = q.data;
  const billable = !!c && ['ON_RENT', 'RETURNED'].includes(c.status);
  const preview = useQuery({
    queryKey: ['rental', 'preview', id, upTo, c?.billedTo],
    queryFn: () => api.get<Preview>(`/rental/contracts/${id}/preview`, { upTo }),
    enabled: billable,
    retry: false,
  });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post<Contract>(x.path, x.body ?? {}),
    onSuccess: (x) => (toast.success('Done'), setModal(''), qc.setQueryData(['rental', 'contract', id], x), qc.invalidateQueries({ queryKey: ['rental'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  if (!c) return <EmptyState icon="clipboard-list" title="Contract not found" />;
  const overdue = c.status === 'ON_RENT' && c.endDate < isoDate();
  const st = overdue ? 'OVERDUE' : c.status;
  const extrasTotal = extras.reduce((a, x) => a + num(x.amount), 0);
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => history.back()}
        title={
          <span className="flex items-center gap-2">
            {c.number} <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
          </span>
        }
        subtitle={`${c.customer?.name ?? ''}${c.site ? ` · ${c.site}` : ''} · ${fmtDate(c.startDate)} - ${fmtDate(c.endDate)} · ${BASIS[c.basis]} rate, billed ${c.billing === 'MONTHLY' ? 'every month' : 'at the end'}${c.withOperator ? ' · with operator' : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {c.status === 'RESERVED' && can('rental.manage') && (
              <>
                <Button variant="secondary" icon="pencil" onClick={() => setModal('edit')}>
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  icon="x"
                  onClick={async () => (await confirm({ title: `Cancel ${c.number}?`, danger: true, confirmText: 'Cancel contract' })) && act.mutate({ path: `/rental/contracts/${id}/cancel` })}
                >
                  Cancel
                </Button>
                <Button icon="truck" onClick={() => setModal('handover')}>
                  Hand over
                </Button>
              </>
            )}
            {c.status === 'ON_RENT' && can('rental.manage') && (
              <>
                {c.lines.some((l) => l.unit.meterUnit !== 'NONE' && l.outDate && !l.returnDate) && (
                  <Button variant="secondary" icon="gauge" onClick={() => setModal('meter')}>
                    Meter reading
                  </Button>
                )}
                <Button icon="undo-2" onClick={() => setModal('return')}>
                  Take back
                </Button>
              </>
            )}
            {c.status === 'RETURNED' && can('rental.billing') && (
              <Button icon="lock" onClick={async () => (await confirm({ title: `Close ${c.number}?`, confirmText: 'Close' })) && act.mutate({ path: `/rental/contracts/${id}/close` })}>
                Close contract
              </Button>
            )}
          </div>
        }
      />
      <Card title="Units" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Unit</th>
                <th className="px-2 text-right">Rate</th>
                <th className="px-2">Out</th>
                <th className="px-2 text-right">Meter</th>
                <th className="px-2">Back</th>
                <th className="px-4">Condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.lines.map((l) => {
                const w = meterWord(l.unit.meterUnit);
                const last = l.readings.length ? l.readings[l.readings.length - 1] : null;
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{l.unit.code}</span> {l.unit.name}
                      {l.unit.meterUnit !== 'NONE' && (
                        <span className="block text-xs text-slate-500">
                          allowance {fmtNumber(l.meterAllowance)} {w}/month, excess {fmtMoney(l.excessRate, 0)}/{w}
                        </span>
                      )}
                    </td>
                    <td className="px-2 text-right">{fmtMoney(l.rate, 0)}</td>
                    <td className="px-2">{l.outDate ? fmtDate(l.outDate) : '-'}</td>
                    <td className="px-2 text-right text-xs">
                      {l.unit.meterUnit === 'NONE' || l.outMeter === null ? (
                        '-'
                      ) : (
                        <>
                          out {fmtNumber(l.outMeter)}
                          {last && (
                            <span className="block">
                              read {fmtNumber(last.reading)} on {fmtDate(last.date)}
                            </span>
                          )}
                          {l.returnMeter !== null && <span className="block">back {fmtNumber(l.returnMeter)}</span>}
                          {l.billedMeter !== null && <span className="block text-slate-500">billed to {fmtNumber(l.billedMeter)}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-2">{l.returnDate ? fmtDate(l.returnDate) : '-'}</td>
                    <td className="px-4 text-xs text-slate-600">{l.condition ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Billing" subtitle={c.billedTo ? `Billed up to ${fmtDate(c.billedTo)}` : 'Nothing billed yet'} bodyClass="space-y-3">
          {billable && can('rental.billing') && (
            <div className="rounded border border-line p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Bill up to">
                  <DatePicker value={upTo} clearable={false} onChange={(v) => setUpTo(v ?? isoDate())} />
                </Field>
                <Button variant="ghost" size="sm" icon="plus" disabled={extras.length >= 10} onClick={() => setExtras([...extras, { description: '', amount: '' }])}>
                  Extra charge (mobilisation, fuel)
                </Button>
              </div>
              {preview.isError ? (
                <p className="mt-2 text-sm text-slate-500">{(preview.error as Error).message}</p>
              ) : preview.data && preview.data.rows.length ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-1">Unit</th>
                      <th>Period</th>
                      <th className="text-right">Rent</th>
                      <th className="text-right">Use / allowance</th>
                      <th className="text-right">Excess</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.data.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1">{r.label}</td>
                        <td className="text-xs">
                          {fmtDate(r.from)} - {fmtDate(r.to)} ({r.days} d)
                        </td>
                        <td className="text-right">{fmtMoney(r.rent, 0)}</td>
                        <td className="text-right text-xs">{r.used === null ? '-' : `${fmtNumber(r.used)} / ${fmtNumber(r.allowance)}`}</td>
                        <td className="text-right">{r.excess ? `${fmtNumber(r.excessQty)} = ${fmtMoney(r.excess, 0)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Nothing to bill up to this date.</p>
              )}
              {extras.map((x, i) => (
                <div key={i} className="mt-2 flex gap-2">
                  <Input placeholder="Description" value={x.description} maxLength={200} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                  <div className="w-40">
                    <NumberInput decimals={0} min={0} value={x.amount} onChange={(v) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: v } : y)))} aria-label="Amount" />
                  </div>
                  <Button variant="ghost" size="icon" icon="trash-2" aria-label="Remove" onClick={() => setExtras(extras.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  Before PPN <strong>{fmtMoney((preview.data?.total ?? 0) + extrasTotal, 0)}</strong>
                  <span className="block text-xs text-slate-500">The invoice adds PPN 12% (DPP 11/12) for a PKP; the customer withholds PPh 23 2% on this amount.</span>
                </span>
                <Button
                  icon="receipt"
                  loading={act.isPending}
                  disabled={!((preview.data?.total ?? 0) + extrasTotal > 0) || extras.some((x) => !x.description || !num(x.amount))}
                  onClick={() =>
                    act.mutate(
                      { path: `/rental/contracts/${id}/bill`, body: { upTo, extras: extras.map((x) => ({ description: x.description, amount: num(x.amount) })) } },
                      { onSuccess: () => setExtras([]) },
                    )
                  }
                >
                  Make invoice
                </Button>
              </div>
            </div>
          )}
          {!c.bills.length ? (
            <p className="text-sm text-slate-500">No bills.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {c.bills.map((b) => (
                <li key={b.id} className={`flex flex-wrap items-center gap-2 py-2 ${b.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="flex-1">
                    {b.kind === 'DAMAGE' ? 'Damage compensation (no PPN)' : `Rent ${fmtDate(b.periodFrom)} - ${fmtDate(b.periodTo)}`}
                    {b.invoice && (
                      <>
                        {' · '}
                        <Link className="text-brand-600" to={`/documents/SI/${b.invoice.id}`}>
                          {b.invoice.number}
                        </Link>
                        <span className="text-xs text-slate-500">
                          {' '}
                          total {fmtMoney(b.invoice.grandTotal, 0)}, paid {fmtMoney(b.invoice.paidAmount, 0)}
                        </span>
                      </>
                    )}
                  </span>
                  <span>{fmtMoney(b.amount, 0)}</span>
                  {b.status === 'POSTED' && c.status !== 'CLOSED' && can('rental.billing') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="undo-2"
                      onClick={async () =>
                        (await confirm({ title: 'Cancel this bill?', message: 'The invoice is cancelled too (it must be unpaid).', danger: true, confirmText: 'Cancel bill' })) &&
                        act.mutate({ path: `/rental/bills/${b.id}/cancel` })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Deposit"
          subtitle={`Asked ${fmtMoney(c.deposit, 0)} · held ${fmtMoney(c.depositHeld, 0)}`}
          actions={
            !['CLOSED', 'CANCELLED'].includes(c.status) &&
            can('rental.billing') && (
              <Button size="sm" icon="plus" onClick={() => setModal('deposit')}>
                Record
              </Button>
            )
          }
        >
          {!c.deposits.length ? (
            <p className="text-sm text-slate-500">No deposit recorded.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {c.deposits.map((d) => (
                <li key={d.id} className={`flex items-center gap-2 py-2 ${d.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="flex-1">
                    {fmtDate(d.date)} · {{ RECEIVED: 'Received', REFUNDED: 'Refunded', FORFEITED: 'Forfeited' }[d.kind]}
                    {d.note && <span className="block text-xs text-slate-500">{d.note}</span>}
                  </span>
                  <span>{fmtMoney(d.amount, 0)}</span>
                  {d.status === 'POSTED' && c.status !== 'CLOSED' && can('rental.billing') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      icon="undo-2"
                      aria-label="Cancel deposit entry"
                      onClick={async () => (await confirm({ title: 'Cancel this deposit entry?', danger: true, confirmText: 'Cancel' })) && act.mutate({ path: `/rental/deposits/${d.id}/cancel` })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">A deposit is a liability until refunded. A forfeited deposit is compensation (ganti rugi), not a price for the rent, so it carries no PPN.</p>
        </Card>
      </div>
      {c.notes && (
        <Card title="Notes">
          <p className="whitespace-pre-line text-sm">{c.notes}</p>
        </Card>
      )}
      {modal === 'edit' && <ContractForm c={c} onClose={() => setModal('')} onSaved={() => (setModal(''), qc.invalidateQueries({ queryKey: ['rental'] }))} />}
      {modal === 'handover' && <HandoverModal c={c} pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/rental/contracts/${id}/handover`, body })} />}
      {modal === 'meter' && <MeterModal c={c} pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/rental/contracts/${id}/meter`, body })} />}
      {modal === 'return' && <ReturnModal c={c} pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/rental/contracts/${id}/return`, body })} />}
      {modal === 'deposit' && <DepositModal c={c} pending={act.isPending} onClose={() => setModal('')} onSubmit={(body) => act.mutate({ path: `/rental/contracts/${id}/deposits`, body })} />}
    </div>
  );
}

function HandoverModal({ c, pending, onClose, onSubmit }: { c: Contract; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const [date, setDate] = useState(c.startDate < isoDate() ? isoDate() : c.startDate);
  const metered = c.lines.filter((l) => l.unit.meterUnit !== 'NONE');
  const [meters, setMeters] = useState<Record<string, string>>(() => Object.fromEntries(metered.map((l) => [l.id, String(l.unit.meter)])));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Hand over ${c.number}`}
      footer={
        <Button
          icon="truck"
          loading={pending}
          disabled={metered.some((l) => meters[l.id] === undefined || meters[l.id] === '')}
          onClick={() => onSubmit({ date, meters: Object.fromEntries(Object.entries(meters).map(([k, v]) => [k, num(v)])) })}
        >
          Hand over
        </Button>
      }
    >
      <Field label="Out date" help="The rent runs from this day">
        <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
      </Field>
      {metered.map((l) => (
        <Field key={l.id} label={`${l.unit.code} meter out (${meterWord(l.unit.meterUnit)})`} help={`Last reading ${fmtNumber(l.unit.meter)}`} className="mt-3">
          <NumberInput decimals={1} min={0} value={meters[l.id] ?? ''} onChange={(v) => setMeters({ ...meters, [l.id]: v })} />
        </Field>
      ))}
      <p className="mt-3 text-xs text-slate-500">Check the condition with the customer and keep the signed handover note (berita acara serah terima).</p>
    </Modal>
  );
}

function MeterModal({ c, pending, onClose, onSubmit }: { c: Contract; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const open = c.lines.filter((l) => l.unit.meterUnit !== 'NONE' && l.outDate && !l.returnDate);
  const [f, setF] = useState({ lineId: open[0]?.id ?? '', date: isoDate(), reading: '' });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Meter reading"
      footer={
        <Button icon="check" loading={pending} disabled={!f.lineId || f.reading === ''} onClick={() => onSubmit({ ...f, reading: num(f.reading) })}>
          Save
        </Button>
      }
    >
      <Field label="Unit">
        <Select value={f.lineId} onChange={(e) => setF({ ...f, lineId: e.target.value })} options={open.map((l) => ({ value: l.id, label: `${l.unit.code} · ${l.unit.name}` }))} />
      </Field>
      <Field label="Date" className="mt-3">
        <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
      </Field>
      <Field label="Reading" className="mt-3">
        <NumberInput decimals={1} min={0} value={f.reading} onChange={(v) => setF({ ...f, reading: v })} />
      </Field>
    </Modal>
  );
}

function ReturnModal({ c, pending, onClose, onSubmit }: { c: Contract; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const open = c.lines.filter((l) => l.outDate && !l.returnDate);
  const [date, setDate] = useState(isoDate());
  const [rows, setRows] = useState(open.map((l) => ({ lineId: l.id, take: true, meter: '', condition: '' })));
  const [damage, setDamage] = useState('');
  const [damageNote, setDamageNote] = useState('');
  const chosen = rows.filter((r) => r.take);
  const missing = chosen.some((r) => open.find((l) => l.id === r.lineId)!.unit.meterUnit !== 'NONE' && r.meter === '');
  const dmg = num(damage);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Take back ${c.number}`}
      footer={
        <Button
          icon="undo-2"
          loading={pending}
          disabled={!chosen.length || missing || (dmg > 0 && !damageNote)}
          onClick={() =>
            onSubmit({
              date,
              damage: dmg,
              damageNote: damageNote || null,
              lines: chosen.map((r) => ({ lineId: r.lineId, meter: r.meter === '' ? null : num(r.meter), condition: r.condition || null })),
            })
          }
        >
          Take back
        </Button>
      }
    >
      <Field label="Return date">
        <DatePicker value={date} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
      </Field>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => {
          const l = open.find((x) => x.id === r.lineId)!;
          const set = (p: Partial<typeof r>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
          return (
            <div key={r.lineId} className="grid grid-cols-1 items-center gap-2 rounded border border-line p-2 sm:grid-cols-4">
              <Checkbox checked={r.take} onChange={(v) => set({ take: v })} label={`${l.unit.code} ${l.unit.name}`} />
              {l.unit.meterUnit !== 'NONE' ? (
                <NumberInput decimals={1} min={0} disabled={!r.take} placeholder={`Meter (${meterWord(l.unit.meterUnit)})`} value={r.meter} onChange={(v) => set({ meter: v })} aria-label="Meter" />
              ) : (
                <span />
              )}
              <div className="sm:col-span-2">
                <Input disabled={!r.take} placeholder="Condition" maxLength={500} value={r.condition} onChange={(e) => set({ condition: e.target.value })} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Damage to charge" help={`Taken from the deposit held (${fmtMoney(c.depositHeld, 0)}) first, the rest invoiced`}>
          <NumberInput decimals={0} min={0} value={damage} onChange={setDamage} />
        </Field>
        <Field label="Damage note" required={dmg > 0} className="sm:col-span-2">
          <Input value={damageNote} maxLength={300} onChange={(e) => setDamageNote(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Damage is compensation (ganti rugi), not rent: no PPN. Units left out stay on rent.</p>
    </Modal>
  );
}

function DepositModal({ c, pending, onClose, onSubmit }: { c: Contract; pending: boolean; onClose: () => void; onSubmit: (b: unknown) => void }) {
  const [f, setF] = useState({
    kind: c.depositHeld > 0 && c.status === 'RETURNED' ? 'REFUNDED' : 'RECEIVED',
    amount: c.depositHeld > 0 && c.status === 'RETURNED' ? str(c.depositHeld) : c.deposit > c.depositHeld ? str(c.deposit - c.depositHeld) : '',
    date: isoDate(),
    bankAccountId: null as string | null,
    note: '',
  });
  const forfeit = f.kind === 'FORFEITED';
  return (
    <Modal
      open
      onClose={onClose}
      title="Deposit"
      footer={
        <Button
          icon="check"
          loading={pending}
          disabled={!num(f.amount) || (!forfeit && !f.bankAccountId) || (forfeit && !f.note)}
          onClick={() => onSubmit({ ...f, amount: num(f.amount), bankAccountId: forfeit ? null : f.bankAccountId, note: f.note || null })}
        >
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'RECEIVED', label: 'Received from the customer' },
              { value: 'REFUNDED', label: 'Refunded to the customer' },
              { value: 'FORFEITED', label: 'Forfeited (compensation)' },
            ]}
          />
        </Field>
        <Field label="Amount">
          <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Date">
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        {!forfeit && (
          <Field label="Cash / bank">
            <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} />
          </Field>
        )}
        <Field label="Note" required={forfeit} className="sm:col-span-2">
          <Input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ calendar and utilisation
interface Calendar {
  from: string;
  to: string;
  units: { id: string; code: string; name: string; status: string; bookings: { contractId: string; number: string; customer: string | null; from: string; to: string; status: string }[] }[];
}
interface Reports {
  days: number;
  units: { id: string; code: string; name: string; daysOnRent: number; utilisation: number; billed: number }[];
  billed: number;
  utilisation: number;
  depositsHeld: number;
  overdue: number;
}
/** the booking shown on a day: an open one before one that came back that morning */
const bookingOn = <T extends { from: string; to: string; status: string }>(list: T[], d: string) => {
  const on = list.filter((x) => x.from <= d && x.to >= d);
  return on.find((x) => !['RETURNED', 'CLOSED'].includes(x.status)) ?? on[0];
};
const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);

export function CalendarPage() {
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const from = `${month}-01`;
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = from; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
    return out;
  }, [from, month]);
  const to = days[days.length - 1];
  const cal = useQuery({ queryKey: ['rental', 'calendar', from, to], queryFn: () => api.get<Calendar>('/rental/calendar', { from, to }) });
  const rep = useQuery({ queryKey: ['rental', 'reports', from, to], queryFn: () => api.get<Reports>('/rental/reports', { from, to }) });
  const today = isoDate();
  const shift = (m: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + m);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rental Calendar"
        subtitle="Which unit is out, booked or free each day; utilisation and rent billed in the month"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" icon="chevron-left" aria-label="Previous month" onClick={() => shift(-1)} />
            <div className="w-40">
              <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
            </div>
            <Button variant="secondary" size="icon" icon="chevron-right" aria-label="Next month" onClick={() => shift(1)} />
          </div>
        }
      />
      {rep.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Utilisation" value={`${fmtNumber(rep.data.utilisation)}%`} hint="Days on rent over the days of the month" icon="gauge" />
          <StatCard label="Rent billed" value={fmtMoney(rep.data.billed, 0)} hint="Bills ending in the month, before PPN" icon="receipt" tone="green" />
          <StatCard label="Deposits held" value={fmtMoney(rep.data.depositsHeld, 0)} hint="A liability until refunded" icon="wallet" tone="amber" />
          <StatCard label="Overdue" value={rep.data.overdue} hint="On rent past the end date" icon="alarm-clock" tone={rep.data.overdue ? 'red' : 'gray'} />
        </div>
      )}
      <Card bodyClass="p-0">
        {cal.isLoading ? (
          <Loading />
        ) : !cal.data?.units.length ? (
          <EmptyState icon="forklift" title="No units" description="Add the equipment in Units" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-40 border-b border-line bg-white px-3 py-2 text-left">Unit</th>
                  {days.map((d) => (
                    <th key={d} className={`min-w-7 border-b border-line px-0 py-2 text-center font-normal ${d === today ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-500'}`}>
                      {Number(d.slice(8))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cal.data.units.map((u) => (
                  <tr key={u.id}>
                    <td className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5">
                      <span className="font-medium">{u.code}</span> <span className="text-slate-500">{u.name}</span>
                      {u.status !== 'AVAILABLE' && <span className="block text-amber-700">{UNIT_STATUS[u.status].label}</span>}
                    </td>
                    {days.map((d) => {
                      const b = bookingOn(u.bookings, d);
                      const start = b && (d === from || bookingOn(u.bookings, addDays(d, -1))?.contractId !== b.contractId);
                      return (
                        <td key={d} className={`border-b border-line p-0 ${d === today ? 'bg-brand-50/50' : ''}`}>
                          {b ? (
                            <Link
                              to={`/rental/contracts/${b.contractId}`}
                              title={`${b.number} · ${b.customer ?? ''} · ${fmtDate(b.from)} - ${fmtDate(b.to)} · ${STATUS[b.status]?.label ?? b.status}`}
                              className={`block h-6 overflow-hidden whitespace-nowrap px-0.5 leading-6 ${BAR[b.status] ?? 'bg-slate-200'}`}
                            >
                              {start ? b.number.split('/').pop() : ' '}
                            </Link>
                          ) : (
                            <span className="block h-6" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-3 border-t border-line px-4 py-2 text-xs text-slate-600">
          {['RESERVED', 'ON_RENT', 'OVERDUE', 'RETURNED'].map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`inline-block h-3 w-5 rounded-sm ${BAR[s]}`} /> {STATUS[s].label.split(',')[0]}
            </span>
          ))}
        </div>
      </Card>
      {rep.data && rep.data.units.length > 0 && (
        <Card title="Per unit" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Unit</th>
                <th className="px-2 text-right">Days on rent</th>
                <th className="px-2 text-right">Utilisation</th>
                <th className="px-4 text-right">Rent billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rep.data.units.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{u.code}</span> {u.name}
                  </td>
                  <td className="px-2 text-right">
                    {u.daysOnRent} / {rep.data!.days}
                  </td>
                  <td className="px-2 text-right">{fmtNumber(u.utilisation)}%</td>
                  <td className="px-4 text-right">{fmtMoney(u.billed, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ============================================================ units
export function UnitsPage() {
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['rental', 'units'], queryFn: () => api.get<Unit[]>('/rental/units') });
  const [edit, setEdit] = useState<Unit | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const rows = (q.data ?? []).filter((u) => !search || `${u.code} ${u.name} ${u.category ?? ''} ${u.serialNo ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rental Units"
        subtitle="The equipment for hire with its daily, weekly and monthly rates, hour meter or odometer, and allowance before the excess rate"
        actions={
          can('rental.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New unit
            </Button>
          )
        }
      />
      <div className="w-64">
        <Input placeholder="Search code, name, serial" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="wrench" title="No units" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-2 text-right">Day</th>
                  <th className="px-2 text-right">Week</th>
                  <th className="px-2 text-right">Month</th>
                  <th className="px-2 text-right">Meter</th>
                  <th className="px-2">Status</th>
                  <th className="px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{u.code}</span> {u.name}
                      <span className="block text-xs text-slate-500">{[u.category, u.serialNo && `S/N ${u.serialNo}`, u.asset && `asset ${u.asset.code}`].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="px-2 text-right">{u.rateDay ? fmtMoney(u.rateDay, 0) : '-'}</td>
                    <td className="px-2 text-right">{u.rateWeek ? fmtMoney(u.rateWeek, 0) : '-'}</td>
                    <td className="px-2 text-right">{u.rateMonth ? fmtMoney(u.rateMonth, 0) : '-'}</td>
                    <td className="px-2 text-right text-xs">
                      {u.meterUnit === 'NONE' ? (
                        '-'
                      ) : (
                        <>
                          {fmtNumber(u.meter)} {meterWord(u.meterUnit)}
                          <span className="block text-slate-500">
                            {fmtNumber(u.meterAllowance)}/month, then {fmtMoney(u.excessRate, 0)}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-2">
                      {u.onRent ? (
                        <Link to={`/rental/contracts/${u.onRent.id}`}>
                          <Badge tone="blue">On rent {u.onRent.number}</Badge>
                        </Link>
                      ) : (
                        <Badge tone={UNIT_STATUS[u.status].tone}>{UNIT_STATUS[u.status].label}</Badge>
                      )}
                    </td>
                    <td className="px-4 text-right">{can('rental.manage') && <Button variant="ghost" size="icon" icon="pencil" aria-label={`Edit ${u.code}`} onClick={() => setEdit(u)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <UnitForm u={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UnitForm({ u, onClose }: { u?: Unit; onClose: () => void }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const assets = useQuery({
    queryKey: ['assets', 'pick'],
    queryFn: () => api.get<Paged<{ id: string; code: string; name: string }>>('/assets', { page: 1, pageSize: 200 }),
    enabled: can('accounting.asset.read'),
  });
  const [f, setF] = useState({
    code: u?.code ?? '',
    name: u?.name ?? '',
    category: u?.category ?? '',
    serialNo: u?.serialNo ?? '',
    fixedAssetId: u?.fixedAssetId ?? '',
    meterUnit: u?.meterUnit ?? 'NONE',
    meter: str(u?.meter ?? 0),
    rateDay: str(u?.rateDay ?? 0),
    rateWeek: str(u?.rateWeek ?? 0),
    rateMonth: str(u?.rateMonth ?? 0),
    meterAllowance: str(u?.meterAllowance ?? 0),
    excessRate: str(u?.excessRate ?? 0),
    status: u?.status ?? 'AVAILABLE',
    notes: u?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, fixedAssetId: f.fixedAssetId || null, category: f.category || null, serialNo: f.serialNo || null, notes: f.notes || null };
      return u ? api.put(`/rental/units/${u.id}`, body) : api.post('/rental/units', body);
    },
    onSuccess: () => (toast.success('Unit saved'), qc.invalidateQueries({ queryKey: ['rental'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const metered = f.meterUnit !== 'NONE';
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={u ? `Unit ${u.code}` : 'New unit'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Category" help="Excavator, crane, genset, scaffolding">
          <Input value={f.category} maxLength={60} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <Field label="Serial / chassis no.">
          <Input value={f.serialNo} maxLength={60} onChange={(e) => setF({ ...f, serialNo: e.target.value })} />
        </Field>
        <Field label="Fixed asset" help="Depreciated in Fixed Assets" error={errors.fixedAssetId}>
          <Select
            value={f.fixedAssetId}
            placeholder={can('accounting.asset.read') ? 'None' : 'No access to fixed assets'}
            disabled={!can('accounting.asset.read')}
            onChange={(e) => setF({ ...f, fixedAssetId: e.target.value })}
            options={(assets.data?.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))}
          />
        </Field>
        <Field label="Daily rate">
          <NumberInput decimals={0} min={0} value={f.rateDay} onChange={(v) => setF({ ...f, rateDay: v })} />
        </Field>
        <Field label="Weekly rate">
          <NumberInput decimals={0} min={0} value={f.rateWeek} onChange={(v) => setF({ ...f, rateWeek: v })} />
        </Field>
        <Field label="Monthly rate">
          <NumberInput decimals={0} min={0} value={f.rateMonth} onChange={(v) => setF({ ...f, rateMonth: v })} />
        </Field>
        <Field label="Meter">
          <Select value={f.meterUnit} onChange={(e) => setF({ ...f, meterUnit: e.target.value })} options={Object.entries(METER).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Current reading">
          <NumberInput decimals={1} min={0} disabled={!metered} value={f.meter} onChange={(v) => setF({ ...f, meter: v })} />
        </Field>
        <Field label="Status" error={errors.status}>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={Object.entries(UNIT_STATUS).map(([value, x]) => ({ value, label: x.label }))} />
        </Field>
        <Field label="Allowance a month" help="e.g. 200 hours; prorated for a part month">
          <NumberInput decimals={1} min={0} disabled={!metered} value={f.meterAllowance} onChange={(v) => setF({ ...f, meterAllowance: v })} />
        </Field>
        <Field label="Excess rate" help="Per hour / km above the allowance">
          <NumberInput decimals={0} min={0} disabled={!metered} value={f.excessRate} onChange={(v) => setF({ ...f, excessRate: v })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
