import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const STATE: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PART: { label: 'Part paid', tone: 'blue' },
  DUE: { label: 'Due', tone: 'gray' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
};
const KIND: Record<string, string> = { BILLING: 'Invoiced per instalment', SALE: 'One invoice, paid in instalments' };
const BUCKETS = ['Not due', '1-30 days late', '31-60 days', '61-90 days', 'Over 90 days'];

interface Row {
  id: string;
  seq: number;
  dueDate: string;
  amount: number;
  paid: number;
  open: number;
  daysLate: number;
  lateFeeCharged: number;
  invoice: { id: string; number: string; status: string; total: number; paid: number } | null;
  state: string;
}
interface Totals {
  total: number;
  paid: number;
  open: number;
  overdue: number;
  invoiced: number;
  next: { dueDate: string; open: number; seq: number } | null;
  paidUp: boolean;
}
interface Plan extends Totals {
  id: string;
  number: string;
  name: string;
  kind: string;
  status: string;
  customer: string | null;
  totalAmount: number;
  count: number;
}
interface PlanDetail {
  id: string;
  number: string;
  name: string;
  kind: string;
  status: string;
  totalAmount: number;
  downPayment: number;
  count: number;
  intervalMonths: number;
  firstDueDate: string;
  leadDays: number;
  autoConfirm: boolean;
  lateFeePct: number;
  lateFeeCapPct: number | null;
  graceDays: number;
  notes: string | null;
  customer: { id: string; code: string; name: string } | null;
  product: { code: string; name: string } | null;
  tax: { name: string } | null;
  project: { code: string; name: string } | null;
  rows: Row[];
  sale: { id: string; number: string; status: string; total: number; paid: number } | null;
  totals: Totals;
}
const label = (seq: number) => (seq === 0 ? 'Down payment' : `Instalment ${seq}`);

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

export function InstalmentsPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['instalments', 'list', status], queryFn: () => api.get<Plan[]>('/instalments', { status: status || undefined }) });
  const ov = useQuery({
    queryKey: ['instalments', 'overview'],
    queryFn: () =>
      api.get<{
        buckets: number[];
        overdue: { planId: string; number: string; name: string; customer: string | null; seq: number; dueDate: string; open: number; daysLate: number }[];
        upcoming: { planId: string; number: string; customer: string | null; seq: number; dueDate: string; open: number }[];
      }>('/instalments/overview'),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ created: number; failed: number }>('/instalments/run'),
    onSuccess: (r) => (toast.success(`${r.created} instalment invoice(s) made${r.failed ? `, ${r.failed} failed` : ''}`), qc.invalidateQueries({ queryKey: ['instalments'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Instalment Plans"
        subtitle="School fees, rent and service fees invoiced instalment by instalment, or goods and property sold on one invoice and paid in instalments; late fees on overdue instalments"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="All"
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
            </div>
            {can('sales.instalment.manage') && (
              <>
                <Button variant="outline" icon="play" loading={run.isPending} onClick={() => run.mutate()}>
                  Invoice due now
                </Button>
                <Button icon="plus" onClick={() => setCreating(true)}>
                  New plan
                </Button>
              </>
            )}
          </div>
        }
      />
      {ov.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {BUCKETS.map((b, i) => (
            <div key={b} className="card px-4 py-3">
              <div className="text-xs text-slate-500">{b}</div>
              <div className={`mt-0.5 text-lg font-semibold ${i > 0 && ov.data!.buckets[i] > 0 ? 'text-red-600' : ''}`}>{fmtMoney(ov.data!.buckets[i], 0)}</div>
            </div>
          ))}
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="calendar-range" title="No instalment plans" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Plan</th>
                  <th className="px-2 py-2 text-left">Customer</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Paid</th>
                  <th className="px-2 py-2 text-right">Overdue</th>
                  <th className="px-4 py-2 text-left">Next</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/billing/instalments/${p.id}`)}>
                    <td className="px-4 py-2">
                      <span className="font-medium">
                        {p.number} · {p.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {KIND[p.kind]} · {p.count} instalments{p.status === 'CANCELLED' ? ' · cancelled' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-2">{p.customer}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(p.total, 0)}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(p.paid, 0)}</td>
                    <td className={`px-2 py-2 text-right ${p.overdue > 0 ? 'font-medium text-red-600' : ''}`}>{p.overdue ? fmtMoney(p.overdue, 0) : '-'}</td>
                    <td className="px-4 py-2">{p.paidUp ? <Badge tone="green">Paid up</Badge> : p.next ? `${fmtDate(p.next.dueDate)} · ${fmtMoney(p.next.open, 0)}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {ov.data && ov.data.overdue.length > 0 && (
        <Card title="Overdue instalments" bodyClass="p-0">
          <ul className="divide-y divide-line">
            {ov.data.overdue.slice(0, 30).map((r) => (
              <li key={`${r.planId}-${r.seq}`} className="flex items-center gap-2 px-4 py-2 text-sm">
                <Link className="min-w-0 flex-1 text-brand-600" to={`/billing/instalments/${r.planId}`}>
                  {r.number} · {r.customer} · {label(r.seq)} due {fmtDate(r.dueDate)}
                </Link>
                <span className="text-red-600">{r.daysLate} days</span>
                <span className="w-32 text-right">{fmtMoney(r.open, 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {creating && <NewPlan onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), navigate(`/billing/instalments/${id}`))} />}
    </div>
  );
}

function NewPlan({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    kind: 'BILLING',
    name: '',
    customerId: null as string | null,
    productId: null as string | null,
    taxId: null as string | null,
    saleInvoiceId: '',
    totalAmount: '',
    downPayment: '',
    downPaymentDate: isoDate(),
    count: '12',
    intervalMonths: '1',
    firstDueDate: isoDate(),
    leadDays: '0',
    autoConfirm: true,
    lateFeePct: '0',
    lateFeeCapPct: '',
    graceDays: '0',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invoices = useQuery({
    queryKey: ['instalments', 'open-invoices', f.customerId],
    queryFn: () => api.get<{ data: { id: string; number: string; date: string; grandTotal: string; status: string }[] }>('/documents/SI', { partnerId: f.customerId, pageSize: 50 }),
    enabled: f.kind === 'SALE' && !!f.customerId,
  });
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/instalments', {
        ...f,
        totalAmount: f.kind === 'BILLING' ? f.totalAmount : undefined,
        saleInvoiceId: f.kind === 'SALE' ? f.saleInvoiceId : null,
        productId: f.kind === 'BILLING' ? f.productId : null,
        taxId: f.taxId ?? undefined,
        downPayment: f.downPayment || 0,
        lateFeeCapPct: f.lateFeeCapPct || null,
      }),
    onSuccess: (r) => (toast.success('Instalment plan made'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New instalment plan"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.name || !f.customerId} onClick={() => save.mutate()}>
          Make plan
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Kind"
          required
          className="sm:col-span-2"
          help={
            f.kind === 'SALE'
              ? 'Goods or property delivered on one invoice (its PPN in full at delivery); the instalments follow its payments'
              : 'Each instalment becomes an invoice when due (fees, rent, school fees: choose the exempt PPN for education)'
          }
        >
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(KIND).map(([value, l]) => ({ value, label: l }))} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={200} placeholder="School fees 2026/2027 - Andi" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Customer" required error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v, saleInvoiceId: '' })} />
        </Field>
        {f.kind === 'BILLING' ? (
          <>
            <Field label="Product / service" required error={errors.productId}>
              <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
            </Field>
            <Field label="Total (before tax)" required error={errors.totalAmount}>
              <NumberInput decimals={0} min={0} value={f.totalAmount} onChange={set('totalAmount')} />
            </Field>
            <Field label="Tax" help="Empty: the product's sales tax" error={errors.taxId}>
              <AsyncSelect resource="taxes" value={f.taxId} onChange={(v) => setF({ ...f, taxId: v })} />
            </Field>
          </>
        ) : (
          <Field label="Sales invoice" required error={errors.saleInvoiceId} help="Confirmed and not fully paid">
            <Select
              value={f.saleInvoiceId}
              onChange={(e) => setF({ ...f, saleInvoiceId: e.target.value })}
              placeholder={f.customerId ? 'Choose' : 'Choose the customer first'}
              options={(invoices.data?.data ?? [])
                .filter((d) => ['CONFIRMED', 'PARTIAL'].includes(d.status))
                .map((d) => ({ value: d.id, label: `${d.number} · ${fmtDate(d.date)} · ${fmtMoney(Number(d.grandTotal), 0)}` }))}
            />
          </Field>
        )}
        <Field label="Down payment" error={errors.downPayment}>
          <NumberInput decimals={0} min={0} value={f.downPayment} onChange={set('downPayment')} />
        </Field>
        <Field label="Down payment due">
          <DatePicker value={f.downPaymentDate} clearable={false} onChange={(v) => setF({ ...f, downPaymentDate: v ?? isoDate() })} />
        </Field>
        <Field label="Instalments" required>
          <NumberInput decimals={0} min={1} max={600} value={f.count} onChange={set('count')} />
        </Field>
        <Field label="Every (months)" required>
          <Select
            value={f.intervalMonths}
            onChange={(e) => setF({ ...f, intervalMonths: e.target.value })}
            options={['1', '2', '3', '6', '12'].map((v) => ({ value: v, label: v === '1' ? 'Month' : `${v} months` }))}
          />
        </Field>
        <Field label="First instalment due" required>
          <DatePicker value={f.firstDueDate} clearable={false} onChange={(v) => setF({ ...f, firstDueDate: v ?? isoDate() })} />
        </Field>
        {f.kind === 'BILLING' && (
          <Field label="Invoice days before the due date">
            <NumberInput decimals={0} min={0} max={60} value={f.leadDays} onChange={set('leadDays')} />
          </Field>
        )}
        <Field label="Late fee (% per month)" help="On the overdue amount, pro rata by day; no PPN by default">
          <NumberInput decimals={3} min={0} max={10} value={f.lateFeePct} onChange={set('lateFeePct')} />
        </Field>
        <Field label="Grace days">
          <NumberInput decimals={0} min={0} max={90} value={f.graceDays} onChange={set('graceDays')} />
        </Field>
        <Field label="Late fee cap (% of the instalment)">
          <NumberInput decimals={2} min={0} max={100} value={f.lateFeeCapPct} onChange={set('lateFeeCapPct')} />
        </Field>
      </div>
      {f.kind === 'BILLING' && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.autoConfirm} onChange={(e) => setF({ ...f, autoConfirm: e.target.checked })} /> Confirm the instalment invoices automatically
        </label>
      )}
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <p className="mt-2 text-xs text-slate-500">
        No interest is added: credit with a financing charge can be a licensed financing activity (UU 4/2023, POJK 32/2025). Contract clauses must respect UU 8/1999 Art. 18.
      </p>
    </Modal>
  );
}

export function InstalmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'fees' | 'schedule'>('');
  const q = useQuery({ queryKey: ['instalments', 'plan', id], queryFn: () => api.get<PlanDetail>(`/instalments/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['instalments'] }));
  const bill = useMutation({
    mutationFn: (lineId: string) => api.post(`/instalments/${id}/lines/${lineId}/invoice`),
    onSuccess: () => (toast.success('Instalment invoiced'), refresh()),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/instalments/${id}/cancel`), onSuccess: () => (toast.success('Plan cancelled'), refresh()), onError: (e) => toast.error(e) });
  const p = q.data;
  if (q.isLoading || !p) return <Loading />;
  const active = p.status === 'ACTIVE';
  const statement = () =>
    printHtml(`<!doctype html><html><head><title>${esc(p.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Instalment statement ${esc(p.number)}</h1>
<p><b>${esc(p.customer?.name ?? '')}</b><br>${esc(p.name)} · ${esc(KIND[p.kind])}${p.sale ? ` · invoice ${esc(p.sale.number)}` : ''} · as of ${esc(fmtDate(isoDate()))}</p>
<table><tr><th>Instalment</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Open</th><th>Status</th></tr>
${p.rows.map((r) => `<tr><td>${esc(label(r.seq))}</td><td>${esc(fmtDate(r.dueDate))}</td><td class="r">${fmtNumber(r.amount, 0)}</td><td class="r">${fmtNumber(r.paid, 0)}</td><td class="r">${fmtNumber(r.open, 0)}</td><td>${esc(STATE[r.state].label)}${r.daysLate > 0 ? ` (${r.daysLate} days)` : ''}</td></tr>`).join('')}
<tr class="b"><td colspan="2">Total</td><td class="r">${fmtNumber(p.totals.total, 0)}</td><td class="r">${fmtNumber(p.totals.paid, 0)}</td><td class="r">${fmtNumber(p.totals.open, 0)}</td><td></td></tr></table>
${p.lateFeePct ? `<p class="muted">Late fee ${p.lateFeePct}% per month of the overdue amount after ${p.graceDays} days' grace${p.lateFeeCapPct ? `, at most ${p.lateFeeCapPct}% of the instalment` : ''}.</p>` : ''}</body></html>`);
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/billing/instalments')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.number} · {p.name} {!active && <Badge tone="gray">Cancelled</Badge>}
            {p.totals.paidUp && <Badge tone="green">Paid up</Badge>}
          </span>
        }
        subtitle={`${p.customer?.name} · ${KIND[p.kind]}${p.product ? ` · ${p.product.name}` : ''}${p.sale ? ` · invoice ${p.sale.number}` : ''}`}
        actions={
          <>
            <Button variant="outline" icon="printer" onClick={statement}>
              Statement
            </Button>
            {active && can('sales.instalment.manage') && p.lateFeePct > 0 && (
              <Button variant="outline" icon="alarm-clock" onClick={() => setModal('fees')}>
                Late fees
              </Button>
            )}
            {active && can('sales.instalment.manage') && (
              <>
                <Button variant="outline" icon="calendar-cog" onClick={() => setModal('schedule')}>
                  Reschedule
                </Button>
                <Button
                  variant="ghost"
                  icon="x"
                  onClick={async () =>
                    (await confirm({
                      title: `Cancel ${p.number}?`,
                      message: 'Instalments not invoiced yet will not be invoiced. Invoices already made stay.',
                      danger: true,
                      confirmText: 'Cancel plan',
                    })) && cancel.mutate()
                  }
                >
                  Cancel
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Total', fmtMoney(p.totals.total, 0), `${p.count} instalments${p.downPayment ? ' + down payment' : ''}`],
          ['Paid', fmtMoney(p.totals.paid, 0), `${p.totals.total ? Math.round((p.totals.paid / p.totals.total) * 100) : 0}%`],
          ['Open', fmtMoney(p.totals.open, 0), p.totals.next ? `next ${fmtDate(p.totals.next.dueDate)}` : undefined],
          ['Overdue', fmtMoney(p.totals.overdue, 0), p.lateFeePct ? `late fee ${p.lateFeePct}% / month` : 'no late fee'],
        ].map(([l, v, h]) => (
          <div key={l} className="card px-4 py-3">
            <div className="text-xs text-slate-500">{l}</div>
            <div className={`mt-0.5 text-lg font-semibold ${l === 'Overdue' && p.totals.overdue > 0 ? 'text-red-600' : ''}`}>{v}</div>
            {h && <div className="text-xs text-slate-500">{h}</div>}
          </div>
        ))}
      </div>
      <Card title="Schedule" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Instalment</th>
                <th className="px-2 py-2 text-left">Due</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2 text-right">Open</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{label(r.seq)}</td>
                  <td className="px-2 py-2">{fmtDate(r.dueDate)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(r.amount, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(r.paid, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(r.open, 0)}</td>
                  <td className="px-2 py-2">
                    <Badge tone={STATE[r.state].tone}>
                      {STATE[r.state].label}
                      {r.daysLate > 0 ? ` ${r.daysLate}d` : ''}
                    </Badge>
                    {r.lateFeeCharged > 0 && <span className="ml-1 text-xs text-slate-500">fee {fmtNumber(r.lateFeeCharged, 0)}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {r.invoice ? (
                      <Link className="text-brand-600" to={`/documents/SI/${r.invoice.id}`}>
                        {r.invoice.number}
                      </Link>
                    ) : p.kind === 'BILLING' && active && can('sales.instalment.manage') ? (
                      <Button size="sm" variant="outline" icon="file-plus-2" loading={bill.isPending && bill.variables === r.id} onClick={() => bill.mutate(r.id)}>
                        Invoice now
                      </Button>
                    ) : p.kind === 'SALE' && p.sale ? (
                      <span className="text-xs text-slate-500">on {p.sale.number}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {p.notes && <p className="text-sm whitespace-pre-line text-slate-600">{p.notes}</p>}
      {modal === 'fees' && <FeesModal p={p} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'schedule' && <ScheduleModal p={p} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function FeesModal({ p, onClose, onDone }: { p: PlanDetail; onClose: () => void; onDone: () => void }) {
  const [asOf, setAsOf] = useState(isoDate());
  const q = useQuery({
    queryKey: ['instalments', 'fees', p.id, asOf],
    queryFn: () =>
      api.get<{ rows: { lineId: string; seq: number; dueDate: string; open: number; days: number; charged: number; fee: number }[]; total: number }>(`/instalments/${p.id}/late-fees`, { asOf }),
  });
  const charge = useMutation({
    mutationFn: () => api.post<{ number: string; invoiceId: string }>(`/instalments/${p.id}/late-fees`, { asOf }),
    onSuccess: (r) => (toast.success(`Draft late fee invoice ${r.number}`), onDone()),
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  return (
    <Modal
      open
      onClose={onClose}
      title="Late fees"
      footer={
        <Button icon="file-plus-2" loading={charge.isPending} disabled={!d?.total} onClick={() => charge.mutate()}>
          Invoice {d?.total ? fmtMoney(d.total, 0) : ''}
        </Button>
      }
    >
      <Field label="As of">
        <DatePicker value={asOf} clearable={false} onChange={(v) => setAsOf(v ?? isoDate())} />
      </Field>
      {!d ? (
        <Loading />
      ) : !d.rows.length ? (
        <p className="mt-3 text-sm text-slate-500">No late fees owed on this date.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line text-sm">
          {d.rows.map((r) => (
            <li key={r.lineId} className="flex justify-between gap-2 py-1.5">
              <span>
                {label(r.seq)} due {fmtDate(r.dueDate)}: {r.days} days on {fmtNumber(r.open, 0)}
                {r.charged ? ` (${fmtNumber(r.charged, 0)} charged before)` : ''}
              </span>
              <span className="font-medium">{fmtNumber(r.fee, 0)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {p.lateFeePct}% per month after {p.graceDays} days&apos; grace{p.lateFeeCapPct ? `, at most ${p.lateFeeCapPct}% of the instalment` : ''}. Invoiced as a draft without PPN (late fees are not
        part of the price, DJP S-380/PJ.32/1990), to Late Payment Fees.
      </p>
    </Modal>
  );
}

function ScheduleModal({ p, onClose, onDone }: { p: PlanDetail; onClose: () => void; onDone: () => void }) {
  const free = p.rows.filter((r) => !r.invoice);
  const fixedTotal = p.rows.filter((r) => r.invoice).reduce((a, r) => a + r.amount, 0);
  const [rows, setRows] = useState(free.map((r) => ({ seq: r.seq, dueDate: r.dueDate, amount: String(r.amount) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sum = rows.reduce((a, r) => a + Number(r.amount || 0), 0) + fixedTotal;
  const save = useMutation({
    mutationFn: () => api.put(`/instalments/${p.id}/schedule`, { rows: rows.map((r) => ({ ...r, amount: Number(r.amount) })) }),
    onSuccess: () => (toast.success('Rescheduled'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Reschedule ${p.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={Math.abs(sum - p.totals.total) > 0.005 || !rows.length} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <p className="mb-2 text-sm text-slate-500">
        Instalments already invoiced stay as they are. The plan must still add up to {fmtMoney(p.totals.total, 0)} (now {fmtMoney(sum, 0)}).
      </p>
      {errors.rows && <p className="mb-1 text-xs text-red-600">{errors.rows}</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.seq} className="grid grid-cols-[8rem_10rem_minmax(0,1fr)] items-center gap-2 text-sm">
            <span>{label(r.seq)}</span>
            <DatePicker value={r.dueDate} clearable={false} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: v ?? x.dueDate } : x)))} />
            <NumberInput decimals={0} min={0} value={r.amount} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} aria-label={`Amount of ${label(r.seq)}`} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
