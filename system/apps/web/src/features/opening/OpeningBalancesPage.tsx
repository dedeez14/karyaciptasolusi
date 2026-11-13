import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, cn, confirm, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea, toast } from '@/components/ui';
import { downloadCsv, parseAmount, parseCsv, parseDate } from '@/features/bankrec/csv';

interface Overview {
  goLiveDate: string | null;
  journal: { id: string; number: string; date: string } | null;
  accounts: { id: string; code: string; name: string; type: string; isActive: boolean; debit: number; credit: number }[];
  excluded: { id: string; code: string; name: string; reason: 'documents' | 'system' }[];
  openingEquity: { accountId: string | null; balance: number };
  receivables: { count: number; total: number };
  payables: { count: number; total: number };
  stock: { count: number; value: number };
  transactionsBeforeGoLive: number;
  configured: boolean;
}
interface OpenInvoice {
  id: string;
  number: string;
  reference: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  partnerName: string | null;
  partnerCode: string | null;
  taxInvoiceNumber: string | null;
  total: string;
  paid: string;
  balance: string;
}
interface StockEntry {
  id: string;
  number: string;
  date: string;
  status: string;
  warehouseName: string | null;
  value: string;
  lines: { productCode: string | null; productName: string | null; qty: string; unitCost: string }[];
}

type Tab = 'accounts' | 'invoices' | 'stock';
const n = (v: unknown) => Number(v ?? 0);

/** Go-live: closing position of the previous system (balances, open invoices & bills, stock) */
export default function OpeningBalancesPage() {
  const [tab, setTab] = useState<Tab>('accounts');
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['opening', 'overview'], queryFn: () => api.get<Overview>('/opening-balances') });
  const o = q.data;
  const manage = can('accounting.opening.manage');

  return (
    <div>
      <PageHeader title="Opening Balances" subtitle="Bring the closing position of your previous books into KCS ERP (go-live)" />
      {q.isLoading || !o ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile icon="flag" label="Go-live date" value={o.goLiveDate ? fmtDate(o.goLiveDate) : 'Not set'} hint={o.journal ? `Journal ${o.journal.number}` : 'Set it with the account balances'} />
            <Tile icon="hand-coins" label="Open receivables" value={fmtMoney(o.receivables.total)} hint={`${o.receivables.count} invoice${o.receivables.count === 1 ? '' : 's'}`} />
            <Tile icon="receipt" label="Open payables" value={fmtMoney(o.payables.total)} hint={`${o.payables.count} bill${o.payables.count === 1 ? '' : 's'}`} />
            <Tile icon="package" label="Opening stock" value={fmtMoney(o.stock.value)} hint={`${o.stock.count} entr${o.stock.count === 1 ? 'y' : 'ies'}`} />
          </div>
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon name="scale" className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-slate-900">
                Opening Balance Equity: <span className="tabular-nums">{fmtMoney(o.openingEquity.balance)}</span>
              </p>
              <p className="text-slate-500">
                Every opening entry is balanced against this equity account. When everything is entered it equals the owners&apos; equity of the previous books (capital + retained earnings) - move it there with a journal once you have checked the balance sheet.
              </p>
            </div>
          </div>
          {!o.configured && <Notice tone="red">Posting account &quot;OPENING_EQUITY&quot; is not configured. Set it in Accounting &gt; Posting Accounts first.</Notice>}
          {o.transactionsBeforeGoLive > 0 && (
            <Notice>
              {o.transactionsBeforeGoLive} posted transaction{o.transactionsBeforeGoLive === 1 ? ' is' : 's are'} dated before the go-live date. Opening balances should be dated the day before your first transaction in KCS ERP.
            </Notice>
          )}
          <div className="mb-4">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'accounts', label: 'Account balances' },
                { value: 'invoices', label: 'Open invoices & bills' },
                { value: 'stock', label: 'Opening stock' },
              ]}
            />
          </div>
          {tab === 'accounts' && <AccountsTab o={o} manage={manage} />}
          {tab === 'invoices' && <InvoicesTab manage={manage} goLive={o.goLiveDate} />}
          {tab === 'stock' && <StockTab manage={manage} goLive={o.goLiveDate} />}
        </>
      )}
    </div>
  );
}

function Tile({ icon, label, value, hint }: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      <span className="rounded-xl bg-brand-50 p-2 text-brand-600">
        <Icon name={icon} className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-500">{label}</span>
        <span className="block truncate text-lg font-semibold text-slate-900 tabular-nums">{value}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </div>
  );
}

function Notice({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'red' }) {
  return (
    <div className={cn('mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm', tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
      <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ======================================================================= account balances
function AccountsTab({ o, manage }: { o: Overview; manage: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(o.goLiveDate?.slice(0, 10) ?? '');
  const [values, setValues] = useState<Record<string, { debit: string; credit: string }>>({});
  const [search, setSearch] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(o.accounts.map((a) => [a.id, { debit: a.debit ? String(a.debit) : '', credit: a.credit ? String(a.credit) : '' }])));
    setDate(o.goLiveDate?.slice(0, 10) ?? '');
  }, [o]);

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return o.accounts.filter((a) => (!t || `${a.code} ${a.name}`.toLowerCase().includes(t)) && (!onlyFilled || n(values[a.id]?.debit) || n(values[a.id]?.credit)));
  }, [o.accounts, search, onlyFilled, values]);
  const debit = Object.values(values).reduce((a, v) => a + n(v.debit), 0);
  const credit = Object.values(values).reduce((a, v) => a + n(v.credit), 0);
  const diff = Math.round((debit - credit) * 100) / 100;
  const set = (id: string, k: 'debit' | 'credit', v: string) => setValues((s) => ({ ...s, [id]: { ...(s[id] ?? { debit: '', credit: '' }), [k]: v, ...(v && n(v) ? { [k === 'debit' ? 'credit' : 'debit']: '' } : {}) } }));

  const post = async () => {
    const lines = Object.entries(values)
      .filter(([, v]) => n(v.debit) || n(v.credit))
      .map(([accountId, v]) => ({ accountId, debit: n(v.debit), credit: n(v.credit) }));
    const ok = await confirm({
      title: o.journal ? 'Replace the opening balances?' : 'Post the opening balances?',
      message: (
        <>
          {lines.length} account{lines.length === 1 ? '' : 's'} dated {fmtDate(date)}.{' '}
          {diff !== 0 && (
            <>
              The difference of <b>{fmtMoney(Math.abs(diff))}</b> is {diff > 0 ? 'credited' : 'debited'} to Opening Balance Equity.{' '}
            </>
          )}
          {o.journal && <>Journal {o.journal.number} is voided and replaced.</>}
        </>
      ),
      confirmText: o.journal ? 'Replace' : 'Post',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post('/opening-balances/accounts', { date, lines });
      toast.success('Opening balances posted');
      qc.invalidateQueries({ queryKey: ['opening'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remove the opening account balances?', message: `Journal ${o.journal?.number} is voided. Open invoices, bills and stock stay.`, confirmText: 'Remove', danger: true }))) return;
    try {
      await api.delete('/opening-balances/accounts');
      toast.success('Opening account balances removed');
      qc.invalidateQueries({ queryKey: ['opening'] });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-end">
        <Field label="Go-live date" required help="Usually the last day before you start working in KCS ERP" className="lg:w-56">
          <DatePicker value={date} onChange={setDate} disabled={!manage} />
        </Field>
        <div className="flex-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search account..." />
        </div>
        <Checkbox checked={onlyFilled} onChange={setOnlyFilled} label="Only accounts with a balance" />
      </div>
      <p className="border-b border-line bg-slate-50/70 px-4 py-2 text-xs text-slate-500">
        Receivables, payables and inventory are not typed here: they come from the open invoices, bills and opening stock tabs ({o.excluded.filter((x) => x.reason === 'documents').map((x) => x.code).join(', ')}).
      </p>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500 shadow-[0_1px_0_var(--color-line,#e5e7eb)]">
            <tr>
              <th className="px-4 py-2">Account</th>
              <th className="hidden px-4 py-2 sm:table-cell">Type</th>
              <th className="w-44 px-4 py-2 text-right">Debit</th>
              <th className="w-44 px-4 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-1.5">
                  <span className="font-mono text-xs text-slate-500">{a.code}</span> <span className="text-slate-800">{a.name}</span>
                </td>
                <td className="hidden px-4 py-1.5 text-xs text-slate-500 sm:table-cell">{a.type}</td>
                <td className="px-4 py-1.5">
                  <NumberInput aria-label={`${a.code} debit`} value={values[a.id]?.debit ?? ''} onChange={(v) => set(a.id, 'debit', v)} fixed={2} disabled={!manage} className="h-8" />
                </td>
                <td className="px-4 py-1.5">
                  <NumberInput aria-label={`${a.code} credit`} value={values[a.id]?.credit ?? ''} onChange={(v) => set(a.id, 'credit', v)} fixed={2} disabled={!manage} className="h-8" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center">
        <dl className="grid flex-1 grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Debit</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(debit)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Credit</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(credit)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">To Opening Balance Equity</dt>
            <dd className={cn('font-semibold tabular-nums', diff === 0 ? 'text-slate-500' : 'text-violet-700')}>{diff === 0 ? '—' : `${fmtMoney(Math.abs(diff))} ${diff > 0 ? 'Cr' : 'Dr'}`}</dd>
          </div>
        </dl>
        {manage && (
          <div className="flex gap-2">
            {o.journal && (
              <Button variant="ghost" icon="trash-2" onClick={remove}>
                Remove
              </Button>
            )}
            <Button icon="check" onClick={post} loading={busy} disabled={!date}>
              {o.journal ? 'Replace opening balances' : 'Post opening balances'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ======================================================================= open invoices & bills
function InvoicesTab({ manage, goLive }: { manage: boolean; goLive: string | null }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'SI' | 'PI'>('SI');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useQuery({ queryKey: ['opening', 'invoices', kind], queryFn: () => api.get<OpenInvoice[]>('/opening-balances/invoices', { kind }) });
  const rows = q.data ?? [];
  const label = kind === 'SI' ? 'Customer' : 'Supplier';

  const cancel = async (r: OpenInvoice) => {
    if (!(await confirm({ title: `Cancel ${r.number}?`, message: 'The opening entry is reversed. This is only possible while nothing was paid on it.', confirmText: 'Cancel entry', danger: true }))) return;
    try {
      await api.post(`/opening-balances/${kind}/${r.id}/cancel`);
      toast.success(`${r.number} cancelled`);
      qc.invalidateQueries({ queryKey: ['opening'] });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <Tabs value={kind} onChange={setKind} tabs={[{ value: 'SI', label: 'Customer invoices' }, { value: 'PI', label: 'Supplier bills' }]} />
        <p className="flex-1 text-xs text-slate-500">Unpaid or partly paid {kind === 'SI' ? 'invoices' : 'bills'} of the previous system, with the amount still open. They can be paid and appear in statements and aging like any other.</p>
        {manage && (
          <div className="flex gap-2">
            <Button variant="outline" icon="file-up" onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button icon="plus" onClick={() => setAdding(true)}>
              Add
            </Button>
          </div>
        )}
      </div>
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5 text-brand-700" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={kind === 'SI' ? 'hand-coins' : 'receipt'} title={`No open ${kind === 'SI' ? 'customer invoices' : 'supplier bills'}`} description="Add them one by one or import a CSV." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Entry</th>
                <th className="px-4 py-2">{label}</th>
                <th className="px-4 py-2">Their no.</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-right">Open</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link className="font-medium text-brand-700 hover:underline" to={`/documents/${kind}/${r.id}`}>
                      {r.number}
                    </Link>
                    {r.status === 'CANCELLED' && <Badge>Cancelled</Badge>}
                  </td>
                  <td className="px-4 py-2">{r.partnerName}</td>
                  <td className="px-4 py-2">
                    {r.reference}
                    {r.taxInvoiceNumber && <span className="block font-mono text-[11px] text-slate-400">{r.taxInvoiceNumber}</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.total)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMoney(r.balance)}</td>
                  <td className="px-4 py-2 text-right">
                    {manage && r.status !== 'CANCELLED' && n(r.paid) === 0 && (
                      <Button size="icon" variant="ghost" icon="x" aria-label={`Cancel ${r.number}`} onClick={() => cancel(r)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddInvoiceModal kind={kind} goLive={goLive} onClose={() => setAdding(false)} />}
      {importing && <ImportInvoicesModal kind={kind} onClose={() => setImporting(false)} />}
    </Card>
  );
}

function useSubmitInvoices(kind: 'SI' | 'PI') {
  const qc = useQueryClient();
  return async (rows: unknown[]) => {
    const r = await api.post<{ created: { row: number; number: string }[]; errors: { row: number; message: string }[] }>('/opening-balances/invoices', { kind, rows });
    qc.invalidateQueries({ queryKey: ['opening'] });
    return r;
  };
}

function AddInvoiceModal({ kind, goLive, onClose }: { kind: 'SI' | 'PI'; goLive: string | null; onClose: () => void }) {
  const submit = useSubmitInvoices(kind);
  const [f, setF] = useState({ partner: null as string | null, reference: '', date: goLive?.slice(0, 10) ?? '', dueDate: '', amount: '', taxInvoiceNumber: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await submit([{ ...f, amount: n(f.amount) }]);
      if (r.errors.length) toast.error(new Error(r.errors[0].message));
      else {
        toast.success(`${r.created[0].number} added`);
        onClose();
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'SI' ? 'Add an open customer invoice' : 'Add an open supplier bill'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!f.partner || !f.reference.trim() || !f.date || !n(f.amount)}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={kind === 'SI' ? 'Customer' : 'Supplier'} required className="sm:col-span-2">
          <AsyncSelect resource={kind === 'SI' ? 'customers' : 'suppliers'} value={f.partner} onChange={(v) => setF({ ...f, partner: v })} />
        </Field>
        <Field label={kind === 'SI' ? 'Invoice number' : 'Bill number'} required help="As issued in the previous system">
          <Input value={f.reference} maxLength={100} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <Field label="Amount still open" required>
          <NumberInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} fixed={2} />
        </Field>
        <Field label="Invoice date" required>
          <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v })} />
        </Field>
        <Field label="Due date" help="Empty = from the payment term">
          <DatePicker value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} />
        </Field>
        <Field label="Tax invoice no." className="sm:col-span-2">
          <Input value={f.taxInvoiceNumber} maxLength={40} onChange={(e) => setF({ ...f, taxInvoiceNumber: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

const TEMPLATE_HEADERS = ['partner', 'invoice_no', 'date', 'due_date', 'amount', 'tax_invoice_no'];

function ImportInvoicesModal({ kind, onClose }: { kind: 'SI' | 'PI'; onClose: () => void }) {
  const submit = useSubmitInvoices(kind);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: { row: number; number: string }[]; errors: { row: number; message: string }[] } | null>(null);
  const [numberStyle, setNumberStyle] = useState<'auto' | 'id' | 'en'>('auto');

  const rows = useMemo(() => {
    const t = parseCsv(text);
    if (!t.length) return [];
    const head = t[0].map((h) => h.toLowerCase().trim());
    const idx = (k: string, ...alts: string[]) => [k, ...alts].map((x) => head.indexOf(x)).find((i) => i >= 0) ?? -1;
    const c = { partner: idx('partner', 'customer', 'supplier', 'code'), reference: idx('invoice_no', 'invoice', 'number', 'reference'), date: idx('date', 'invoice_date'), due: idx('due_date', 'due'), amount: idx('amount', 'balance', 'open'), tin: idx('tax_invoice_no', 'faktur', 'tax_invoice') };
    return t.slice(1).map((r) => ({
      partner: c.partner >= 0 ? r[c.partner] : '',
      reference: c.reference >= 0 ? r[c.reference] : '',
      date: c.date >= 0 ? parseDate(r[c.date]) ?? r[c.date] : '',
      dueDate: c.due >= 0 ? (r[c.due] ? parseDate(r[c.due]) ?? r[c.due] : '') : '',
      amount: c.amount >= 0 ? parseAmount(r[c.amount], numberStyle) : NaN,
      taxInvoiceNumber: c.tin >= 0 ? r[c.tin] : '',
    }));
  }, [text, numberStyle]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await submit(rows.map((x) => ({ ...x, amount: Number.isFinite(x.amount) ? x.amount : 0 })));
      setResult(r);
      if (r.created.length) toast.success(`${r.created.length} added${r.errors.length ? `, ${r.errors.length} with problems` : ''}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={kind === 'SI' ? 'Import open customer invoices' : 'Import open supplier bills'}
      footer={
        <>
          <Button variant="ghost" icon="download" className="mr-auto" onClick={() => downloadCsv(kind === 'SI' ? 'opening-invoices.csv' : 'opening-bills.csv', [TEMPLATE_HEADERS, [kind === 'SI' ? 'CUS-00001' : 'SUP-00001', 'INV-2025-0815', '2025-11-15', '2025-12-15', '11100000', '']])}>
            Template
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={run} loading={busy} disabled={!rows.length || !!result}>
            Import {rows.length} row{rows.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Columns: <code className="text-xs">partner</code> ({kind === 'SI' ? 'customer' : 'supplier'} code or exact name), <code className="text-xs">invoice_no</code>, <code className="text-xs">date</code>, <code className="text-xs">due_date</code> (optional), <code className="text-xs">amount</code> (still open), <code className="text-xs">tax_invoice_no</code> (optional).
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50/40">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setText(await file.text());
                  setResult(null);
                }
                e.target.value = '';
              }}
            />
          </label>
          <Select value={numberStyle} onChange={(e) => setNumberStyle(e.target.value as 'auto' | 'id' | 'en')} options={[{ value: 'auto', label: 'Numbers: detect' }, { value: 'id', label: '1.234.567,89' }, { value: 'en', label: '1,234,567.89' }]} className="w-48" />
        </div>
        <Textarea
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          className="font-mono text-xs"
          placeholder={'partner,invoice_no,date,due_date,amount,tax_invoice_no\nCUS-00001,INV-2025-0815,15/11/2025,15/12/2025,"11.100.000,00",'}
        />
        {rows.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{kind === 'SI' ? 'Customer' : 'Supplier'}</th>
                  <th className="px-3 py-2">No.</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const err = result?.errors.find((x) => x.row === i + 1);
                  const ok = result?.created.find((x) => x.row === i + 1);
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-1.5 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-3 py-1.5">{r.partner}</td>
                      <td className="px-3 py-1.5">{r.reference}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number.isFinite(r.amount) ? fmtMoney(r.amount) : '—'}</td>
                      <td className="px-3 py-1.5 text-xs">{err ? <span className="text-red-600">{err.message}</span> : ok ? <span className="text-emerald-600">{ok.number}</span> : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ======================================================================= opening stock
function StockTab({ manage, goLive }: { manage: boolean; goLive: string | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opening', 'stock'], queryFn: () => api.get<StockEntry[]>('/opening-balances/stock') });
  const [date, setDate] = useState(goLive?.slice(0, 10) ?? '');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [lines, setLines] = useState<{ key: number; productId: string | null; qty: string; unitCost: string }[]>([{ key: 1, productId: null, qty: '', unitCost: '' }]);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((a, l) => a + n(l.qty) * n(l.unitCost), 0);
  const setLine = (key: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const post = async () => {
    const valid = lines.filter((l) => l.productId && n(l.qty) > 0);
    if (!(await confirm({ title: 'Post opening stock?', message: `${valid.length} product${valid.length === 1 ? '' : 's'} worth ${fmtMoney(total)} are added to the warehouse on ${fmtDate(date)}.`, confirmText: 'Post' }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ number: string }>('/opening-balances/stock', { date, warehouseId, lines: valid.map((l) => ({ productId: l.productId, qty: n(l.qty), unitCost: n(l.unitCost) })) });
      toast.success(`${r.number} posted`);
      setLines([{ key: Date.now(), productId: null, qty: '', unitCost: '' }]);
      qc.invalidateQueries({ queryKey: ['opening'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (e: StockEntry) => {
    if (!(await confirm({ title: `Cancel ${e.number}?`, message: 'The opening stock is taken out again (only possible while the stock is still on hand).', confirmText: 'Cancel entry', danger: true }))) return;
    try {
      await api.post(`/opening-balances/ADJ/${e.id}/cancel`);
      toast.success(`${e.number} cancelled`);
      qc.invalidateQueries({ queryKey: ['opening'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-5">
      {manage && (
        <Card title="Add opening stock" subtitle="Quantity on hand per warehouse at go-live, valued at cost">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={date} onChange={setDate} />
            </Field>
            <Field label="Warehouse" required>
              <AsyncSelect resource="warehouses" value={warehouseId} onChange={setWarehouseId} />
            </Field>
          </div>
          <div className="mt-4 space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_10rem_9rem_2.5rem]">
                <Field label={i === 0 ? 'Product' : undefined}>
                  <AsyncSelect resource="products" value={l.productId} onChange={(v) => setLine(l.key, { productId: v })} placeholder="Stock product..." />
                </Field>
                <Field label={i === 0 ? 'Quantity' : undefined}>
                  <NumberInput value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} />
                </Field>
                <Field label={i === 0 ? 'Unit cost' : undefined}>
                  <NumberInput value={l.unitCost} onChange={(v) => setLine(l.key, { unitCost: v })} fixed={2} />
                </Field>
                <div className="pb-2 text-right text-sm font-medium tabular-nums">{fmtMoney(n(l.qty) * n(l.unitCost))}</div>
                <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, { key: Date.now(), productId: null, qty: '', unitCost: '' }])}>
              Add product
            </Button>
            <span className="ml-auto text-sm text-slate-500">
              Total <b className="text-slate-900 tabular-nums">{fmtMoney(total)}</b>
            </span>
            <Button icon="check" onClick={post} loading={busy} disabled={!date || !warehouseId || !lines.some((l) => l.productId && n(l.qty) > 0)}>
              Post opening stock
            </Button>
          </div>
        </Card>
      )}
      <Card title="Posted opening stock" bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5 text-brand-700" />
          </div>
        ) : !(q.data ?? []).length ? (
          <EmptyState icon="package" title="No opening stock yet" />
        ) : (
          <ul className="divide-y divide-line">
            {(q.data ?? []).map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/documents/ADJ/${e.id}`} className="font-medium text-brand-700 hover:underline">
                    {e.number}
                  </Link>
                  <span className="text-sm text-slate-500">
                    {fmtDate(e.date)} · {e.warehouseName}
                  </span>
                  {e.status === 'CANCELLED' && <Badge>Cancelled</Badge>}
                  <span className="ml-auto font-semibold tabular-nums">{fmtMoney(e.value)}</span>
                  {manage && e.status !== 'CANCELLED' && <Button size="icon" variant="ghost" icon="x" aria-label={`Cancel ${e.number}`} onClick={() => cancel(e)} />}
                </div>
                <p className="mt-1 text-xs text-slate-500">{e.lines.map((l) => `${l.productName} × ${n(l.qty)}`).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
