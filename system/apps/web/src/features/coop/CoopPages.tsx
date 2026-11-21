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
  ACTIVE: { label: 'Active', tone: 'green' },
  LEFT: { label: 'Left', tone: 'gray' },
  APPLIED: { label: 'Applied', tone: 'blue' },
  PAID: { label: 'Paid off', tone: 'gray' },
  WRITTEN_OFF: { label: 'Written off', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
  CLOSED: { label: 'Closed', tone: 'gray' },
};
const KIND: Record<string, string> = { PRINCIPAL: 'Simpanan pokok', MANDATORY: 'Simpanan wajib', VOLUNTARY: 'Simpanan sukarela', TERM: 'Simpanan berjangka' };
const TXN: Record<string, string> = { DEPOSIT: 'Deposit', WITHDRAW: 'Withdrawal', INTEREST: 'Interest', TAX: 'PPh withheld', LOAN: 'From a loan', SHU: 'SHU', CLOSE: 'Closed / reversed' };

// ============================================================ members
interface MemberRow {
  id: string;
  number: string;
  name: string;
  kind: string;
  idNumber: string | null;
  phone: string | null;
  address: string | null;
  employeeId: string | null;
  customerId: string | null;
  joinDate: string;
  status: string;
  leftDate: string | null;
  notes: string | null;
  capital?: number;
  savings?: number;
  loans?: number;
}
interface Account {
  id: string;
  number: string;
  balance: number;
  openedAt: string;
  maturityDate: string | null;
  status: string;
  product: { id: string; code: string; name: string; kind: string; amount: number; ratePct: number };
  txns: { id: string; date: string; kind: string; amount: number; balanceAfter: number; reference: string | null }[];
}
interface Products {
  saving: { id: string; code: string; name: string; kind: string; amount: number; ratePct: number; termMonths: number | null; isActive: boolean }[];
  loan: { id: string; code: string; name: string; ratePct: number; method: string; adminPct: number; savingPct: number; latePct: number; maxTerm: number; isActive: boolean; effectivePct: number }[];
}

export function MembersPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'ACTIVE' | 'LEFT' | 'INTEREST'>('ACTIVE');
  const [make, setMake] = useState(false);
  const q = useQuery({ queryKey: ['coop', 'members', tab], queryFn: () => api.get<MemberRow[]>('/coop/members', { status: tab }), enabled: tab !== 'INTEREST' });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Members & Savings"
        subtitle="Members with their simpanan pokok and wajib (equity) and sukarela / berjangka (liabilities); savings interest monthly with PPh final 10% above Rp240,000 (PP 15/2009)"
        actions={
          can('coop.member') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New member
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'ACTIVE', label: 'Members' },
          { value: 'LEFT', label: 'Left' },
          { value: 'INTEREST', label: 'Savings interest' },
        ]}
      />
      {tab === 'INTEREST' ? (
        <InterestCard />
      ) : (
        <Card bodyClass="p-0">
          {q.isLoading ? (
            <Loading />
          ) : !q.data?.length ? (
            <EmptyState icon="id-card" title="No members" description="Set up the savings products first, then register members" />
          ) : (
            <ul className="divide-y divide-line">
              {q.data.map((m) => (
                <li key={m.id}>
                  <Link to={`/coop/members/${m.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {m.number} · {m.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {m.kind === 'ENTITY' ? 'Entity' : 'Individual'} · since {fmtDate(m.joinDate)} {m.phone ? `· ${m.phone}` : ''}
                      </span>
                    </span>
                    <span className="text-right text-xs">
                      capital {fmtMoney(m.capital ?? 0, 0)} · savings {fmtMoney(m.savings ?? 0, 0)}
                      {(m.loans ?? 0) > 0 && <span className="block">loans {fmtMoney(m.loans ?? 0, 0)}</span>}
                    </span>
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {make && <MemberForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/coop/members/${id}`)} />}
    </div>
  );
}

function MemberForm({ m, onClose, onSaved }: { m?: MemberRow; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: m?.name ?? '',
    kind: m?.kind ?? 'INDIVIDUAL',
    idNumber: '',
    phone: m?.phone ?? '',
    address: m?.address ?? '',
    employeeId: m?.employeeId ?? (null as string | null),
    customerId: m?.customerId ?? (null as string | null),
    joinDate: m?.joinDate ?? isoDate(),
    notes: m?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () => (m ? api.put<MemberRow>(`/coop/members/${m.id}`, f) : api.post<MemberRow>('/coop/members', f)),
    onSuccess: (r) => (toast.success(`${r.number} saved`), onSaved(r.id)),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={m ? `${m.number} · ${m.name}` : 'New member'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Member" help="An entity's savings interest carries PPh 23 15%">
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'INDIVIDUAL', label: 'Individual' },
              { value: 'ENTITY', label: 'Entity (cooperative, company)' },
            ]}
          />
        </Field>
        <Field label="NIK / NPWP" help={m?.idNumber ? `Stored: ${m.idNumber} (empty keeps it)` : 'Stored encrypted'}>
          <Input value={f.idNumber} maxLength={40} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />
        </Field>
        <Field label="Joined" required>
          <DatePicker value={f.joinDate} clearable={false} onChange={(v) => setF({ ...f, joinDate: v ?? isoDate() })} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Employee record (employee cooperative)">
          <AsyncSelect resource="employees" value={f.employeeId} onChange={(v) => setF({ ...f, employeeId: v })} />
        </Field>
        <Field label="Customer record (purchases count for the SHU)" className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function InterestCard() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const d = new Date();
  const [period, setPeriod] = useState(new Date(d.getFullYear(), d.getMonth() - 1, 15).toISOString().slice(0, 7));
  const q = useQuery({
    queryKey: ['coop', 'interest', period],
    queryFn: () =>
      api.get<{
        rows: { accountId: string; number: string; member: string; balance: number; rate: number; interest: number; memberInterest: number; taxPct: number; tax: number }[];
        interest: number;
        tax: number;
        run: { id: string } | null;
      }>('/coop/interest', { period }),
  });
  const act = useMutation({ mutationFn: (path: string) => api.post(path), onSuccess: () => (toast.success('Done'), qc.invalidateQueries({ queryKey: ['coop'] })), onError: (e) => toast.error(e) });
  const t = q.data;
  return (
    <Card
      title={t ? `Interest ${fmtMoney(t.interest, 0)} · PPh ${fmtMoney(t.tax, 0)}` : 'Savings interest'}
      bodyClass="p-0"
      actions={
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />
          </div>
          {t && !t.run && t.rows.length > 0 && can('coop.saving') && (
            <Button
              size="sm"
              icon="check"
              loading={act.isPending}
              onClick={async () =>
                (await confirm({ title: `Credit the interest of ${period}?`, message: `${fmtMoney(t.interest, 0)} to the savings, ${fmtMoney(t.tax, 0)} PPh withheld.`, confirmText: 'Credit' })) &&
                act.mutate(`/coop/interest/${period}`)
              }
            >
              Credit
            </Button>
          )}
          {t?.run && can('coop.saving') && (
            <Button
              size="sm"
              variant="ghost"
              icon="undo"
              onClick={async () => (await confirm({ title: 'Cancel the interest of this month?', danger: true, confirmText: 'Cancel run' })) && act.mutate(`/coop/interest-runs/${t.run!.id}/cancel`)}
            >
              Cancel run
            </Button>
          )}
        </div>
      }
    >
      {!t ? (
        <Loading />
      ) : !t.rows.length ? (
        <p className="px-4 py-4 text-sm text-slate-500">No interest-bearing balances at the end of the month.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {t.rows.map((r) => (
            <li key={r.accountId} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1">
                {r.number} · {r.member}
                <span className="block text-xs text-slate-500">
                  balance {fmtMoney(r.balance, 0)} at {r.rate}% · member total this month {fmtMoney(r.memberInterest, 0)}
                </span>
              </span>
              <span className="text-right text-xs">
                {fmtMoney(r.interest, 0)}
                {r.tax > 0 && (
                  <span className="block text-slate-500">
                    PPh {r.taxPct}% {fmtMoney(r.tax, 0)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {t?.run && <p className="px-4 py-3 text-xs text-green-700">Credited.</p>}
    </Card>
  );
}

export function MemberPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['coop', 'member', id],
    queryFn: () =>
      api.get<MemberRow & { accounts: Account[]; loans: { id: string; number: string; principal: number; outstanding: number; status: string; applicationDate: string }[] }>(`/coop/members/${id}`),
  });
  const products = useQuery({ queryKey: ['coop', 'products'], queryFn: () => api.get<Products>('/coop/products') });
  const [txn, setTxn] = useState<{ a: Account; dir: 'deposit' | 'withdraw' } | null>(null);
  const [t, setT] = useState({ date: isoDate(), amount: '', bankAccountId: null as string | null, reference: '' });
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [leave, setLeave] = useState(false);
  const [edit, setEdit] = useState(false);
  const done = () => (toast.success('Done'), setTxn(null), setOpen(false), setLeave(false), qc.invalidateQueries({ queryKey: ['coop'] }));
  const act = useMutation({ mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}), onSuccess: done, onError: (e) => toast.error(e) });
  if (q.isLoading) return <Loading />;
  const m = q.data;
  if (!m) return <EmptyState icon="id-card" title="Member not found" />;
  const activeM = m.status === 'ACTIVE';
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${m.number} · ${m.name}`}
        subtitle={`${m.kind === 'ENTITY' ? 'Entity' : 'Individual'} · joined ${fmtDate(m.joinDate)}${m.leftDate ? ` · left ${fmtDate(m.leftDate)}` : ''}${m.idNumber ? ` · ID ${m.idNumber}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
            {activeM && can('coop.member') && (
              <Button variant="outline" icon="pencil" onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
            {activeM && can('coop.saving') && (
              <Button variant="outline" icon="plus" onClick={() => setOpen(true)}>
                Open account
              </Button>
            )}
            {activeM && can('coop.member') && (
              <Button variant="ghost" icon="log-out" onClick={() => (setT({ ...t, date: isoDate() }), setLeave(true))}>
                Leaves
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {m.accounts.map((a) => (
          <Card
            key={a.id}
            title={`${a.number} · ${a.product.name}`}
            bodyClass="p-0"
            actions={
              a.status === 'ACTIVE' &&
              activeM &&
              can('coop.saving') && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    icon="arrow-down"
                    onClick={() => (
                      setT({
                        date: isoDate(),
                        amount: a.product.kind === 'PRINCIPAL' ? str(a.product.amount - a.balance) : a.product.kind === 'MANDATORY' ? str(a.product.amount) : '',
                        bankAccountId: t.bankAccountId,
                        reference: '',
                      }),
                      setTxn({ a, dir: 'deposit' })
                    )}
                  >
                    Deposit
                  </Button>
                  {['VOLUNTARY', 'TERM'].includes(a.product.kind) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="arrow-up"
                      onClick={() => (setT({ date: isoDate(), amount: '', bankAccountId: t.bankAccountId, reference: '' }), setTxn({ a, dir: 'withdraw' }))}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              )
            }
          >
            <div className="flex items-baseline justify-between px-4 py-2">
              <span className="text-xs text-slate-500">
                {KIND[a.product.kind]} {a.product.ratePct > 0 ? `· ${a.product.ratePct}% a year` : ''} {a.maturityDate ? `· matures ${fmtDate(a.maturityDate)}` : ''}
              </span>
              <span className="text-lg font-semibold">{fmtMoney(a.balance, 0)}</span>
            </div>
            {a.txns.length > 0 && (
              <ul className="divide-y divide-line border-t border-line text-xs">
                {a.txns.slice(0, 6).map((x) => (
                  <li key={x.id} className="flex gap-2 px-4 py-1.5">
                    <span className="w-20 text-slate-500">{fmtDate(x.date)}</span>
                    <span className="flex-1">
                      {TXN[x.kind]} {x.reference ? `· ${x.reference}` : ''}
                    </span>
                    <span className={x.amount < 0 ? 'text-red-600' : ''}>{fmtMoney(x.amount, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <Card title="Loans" bodyClass="p-0">
        {!m.loans.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">No loans.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {m.loans.map((l) => (
              <li key={l.id}>
                <Link to={`/coop/loans/${l.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50">
                  <span className="flex-1 text-brand-600">
                    {l.number} · {fmtDate(l.applicationDate)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {fmtMoney(l.outstanding, 0)} of {fmtMoney(l.principal, 0)}
                  </span>
                  <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {txn && (
        <Modal
          open
          onClose={() => setTxn(null)}
          title={`${txn.dir === 'deposit' ? 'Deposit to' : 'Withdraw from'} ${txn.a.number}`}
          footer={
            <Button icon="check" disabled={!num(t.amount) || !t.bankAccountId} loading={act.isPending} onClick={() => act.mutate({ path: `/coop/accounts/${txn.a.id}/${txn.dir}`, body: t })}>
              {txn.dir === 'deposit' ? 'Deposit' : 'Withdraw'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={t.date} clearable={false} onChange={(v) => setT({ ...t, date: v ?? isoDate() })} />
            </Field>
            <Field label="Amount" required help={txn.dir === 'withdraw' ? `Balance ${fmtMoney(txn.a.balance, 0)}` : undefined}>
              <NumberInput decimals={0} min={0} value={t.amount} onChange={(v) => setT({ ...t, amount: v })} />
            </Field>
            <Field label={txn.dir === 'deposit' ? 'Received into' : 'Paid from'} required>
              <AsyncSelect resource="bank-accounts" value={t.bankAccountId} onChange={(v) => setT({ ...t, bankAccountId: v })} />
            </Field>
            <Field label="Reference">
              <Input value={t.reference} maxLength={100} onChange={(e) => setT({ ...t, reference: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Open a savings account"
          footer={
            <Button icon="check" disabled={!productId} loading={act.isPending} onClick={() => act.mutate({ path: `/coop/members/${m.id}/accounts`, body: { productId, date: isoDate() } })}>
              Open
            </Button>
          }
        >
          <Field label="Product" required>
            <Select
              value={productId}
              placeholder="Choose"
              onChange={(e) => setProductId(e.target.value)}
              options={(products.data?.saving ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.code} · ${p.name} · ${KIND[p.kind]}` }))}
            />
          </Field>
        </Modal>
      )}
      {leave && (
        <Modal
          open
          onClose={() => setLeave(false)}
          title={`${m.name} leaves`}
          footer={
            <Button
              icon="check"
              variant="danger"
              disabled={!t.bankAccountId}
              loading={act.isPending}
              onClick={() => act.mutate({ path: `/coop/members/${m.id}/leave`, body: { date: t.date, bankAccountId: t.bankAccountId } })}
            >
              Record and pay back
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={t.date} clearable={false} onChange={(v) => setT({ ...t, date: v ?? isoDate() })} />
            </Field>
            <Field label="Paid from" required>
              <AsyncSelect resource="bank-accounts" value={t.bankAccountId} onChange={(v) => setT({ ...t, bankAccountId: v })} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">No loan may be open and the voluntary / term savings must be withdrawn first; the simpanan pokok and wajib are paid back.</p>
        </Modal>
      )}
      {edit && <MemberForm m={m} onClose={() => setEdit(false)} onSaved={() => (setEdit(false), qc.invalidateQueries({ queryKey: ['coop'] }))} />}
    </div>
  );
}

// ============================================================ loans
interface LoanRow {
  id: string;
  number: string;
  status: string;
  principal: number;
  outstanding: number;
  ratePct: number;
  method: string;
  termMonths: number;
  applicationDate: string;
  member: { id: string; number: string; name: string } | null;
  daysOverdue: number;
  overdueAmount: number;
  collectibility: string | null;
  nextDue: { date: string; amount: number } | null;
}

export function LoansPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'ALL' | 'APPLIED' | 'ACTIVE' | 'PAID' | 'WRITTEN_OFF'>('ACTIVE');
  const [make, setMake] = useState(false);
  const q = useQuery({ queryKey: ['coop', 'loans', status], queryFn: () => api.get<LoanRow[]>('/coop/loans', status === 'ALL' ? {} : { status }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Member Loans"
        subtitle="Loans to members only, at most 24% a year (Permenkop UKM 8/2023), with an admin fee and a savings deduction; payments go to the oldest instalment first"
        actions={
          can('coop.loan') && (
            <Button icon="plus" onClick={() => setMake(true)}>
              New loan
            </Button>
          )
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'ACTIVE', label: 'Running' },
          { value: 'APPLIED', label: 'Applied' },
          { value: 'PAID', label: 'Paid off' },
          { value: 'WRITTEN_OFF', label: 'Written off' },
          { value: 'ALL', label: 'All' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="hand-coins" title="No loans" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((l) => (
              <li key={l.id}>
                <Link to={`/coop/loans/${l.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {l.number} · {l.member?.number} {l.member?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtMoney(l.principal, 0)} · {l.termMonths} months · {l.ratePct}% {l.method.toLowerCase()} {l.nextDue ? `· next ${fmtDate(l.nextDue.date)} ${fmtMoney(l.nextDue.amount, 0)}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    outstanding {fmtMoney(l.outstanding, 0)}
                    {l.daysOverdue > 0 && (
                      <span className="block text-red-600">
                        {l.daysOverdue} days late · {fmtMoney(l.overdueAmount, 0)}
                      </span>
                    )}
                  </span>
                  <Badge tone={l.daysOverdue > 90 ? 'red' : l.daysOverdue > 0 ? 'amber' : STATUS[l.status].tone}>
                    {l.status === 'ACTIVE' ? (l.collectibility ?? '').split(' (')[0] : STATUS[l.status].label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {make && <LoanForm onClose={() => setMake(false)} onSaved={(id) => navigate(`/coop/loans/${id}`)} />}
    </div>
  );
}

function LoanForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const members = useQuery({ queryKey: ['coop', 'members', 'ACTIVE'], queryFn: () => api.get<MemberRow[]>('/coop/members', { status: 'ACTIVE' }) });
  const products = useQuery({ queryKey: ['coop', 'products'], queryFn: () => api.get<Products>('/coop/products') });
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ memberId: '', productId: '', applicationDate: isoDate(), principal: '', termMonths: '12', firstDue: nextMonth, purpose: '', collateral: '', guarantor: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const p = products.data?.loan.find((x) => x.id === f.productId);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/coop/loans', f),
    onSuccess: (r) => (toast.success(`${r.number} applied`), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const monthly =
    p && num(f.principal) && num(f.termMonths)
      ? p.method === 'FLAT'
        ? num(f.principal) / num(f.termMonths) + (num(f.principal) * p.ratePct) / 1200
        : (num(f.principal) * (p.ratePct / 1200)) / (1 - Math.pow(1 + p.ratePct / 1200, -num(f.termMonths)))
      : 0;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New loan"
      footer={
        <Button icon="check" disabled={!f.memberId || !f.productId || !num(f.principal)} loading={save.isPending} onClick={() => save.mutate()}>
          Apply
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Member" required error={errors.memberId} className="sm:col-span-2">
          <Select
            value={f.memberId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, memberId: e.target.value })}
            options={(members.data ?? []).map((m) => ({ value: m.id, label: `${m.number} · ${m.name}` }))}
          />
        </Field>
        <Field label="Product" required error={errors.productId}>
          <Select
            value={f.productId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, productId: e.target.value })}
            options={(products.data?.loan ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: `${x.code} · ${x.ratePct}% ${x.method.toLowerCase()}` }))}
          />
        </Field>
        <Field label="Amount" required>
          <NumberInput decimals={0} min={0} value={f.principal} onChange={(v) => setF({ ...f, principal: v })} />
        </Field>
        <Field label="Months" required error={errors.termMonths} help={p ? `At most ${p.maxTerm}` : undefined}>
          <NumberInput decimals={0} min={1} max={240} value={f.termMonths} onChange={(v) => setF({ ...f, termMonths: v })} />
        </Field>
        <Field label="Applied on" required>
          <DatePicker value={f.applicationDate} clearable={false} onChange={(v) => setF({ ...f, applicationDate: v ?? isoDate() })} />
        </Field>
        <Field label="First instalment" required error={errors.firstDue}>
          <DatePicker value={f.firstDue} clearable={false} onChange={(v) => setF({ ...f, firstDue: v ?? nextMonth })} />
        </Field>
        <Field label="Purpose" className="sm:col-span-2">
          <Input value={f.purpose} maxLength={200} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </Field>
        <Field label="Collateral" className="sm:col-span-2">
          <Input value={f.collateral} maxLength={300} onChange={(e) => setF({ ...f, collateral: e.target.value })} />
        </Field>
        <Field label="Guarantor">
          <Input value={f.guarantor} maxLength={150} onChange={(e) => setF({ ...f, guarantor: e.target.value })} />
        </Field>
      </div>
      {p && monthly > 0 && (
        <p className="mt-3 text-sm">
          About {fmtMoney(monthly, 0)} a month · admin {fmtMoney((num(f.principal) * p.adminPct) / 100, 0)} · to savings {fmtMoney((num(f.principal) * p.savingPct) / 100, 0)} · paid out{' '}
          {fmtMoney(num(f.principal) * (1 - (p.adminPct + p.savingPct) / 100), 0)}
          {p.method === 'FLAT' && (
            <span className="block text-xs text-slate-500">
              Flat {p.ratePct}% is about {p.effectivePct}% a year effective.
            </span>
          )}
        </p>
      )}
    </Modal>
  );
}

interface LoanD extends LoanRow {
  adminFee: number;
  savingDeduction: number;
  firstDue: string;
  disbursedAt: string | null;
  purpose: string | null;
  collateral: string | null;
  guarantor: string | null;
  notes: string | null;
  effectivePct: number;
  totalInterest: number;
  product: { code: string; name: string; latePct: number } | null;
  bmpp: { ownCapital: number; exposure: number; pct: number | null; limitPct: number };
  schedule: { id: string; seq: number; dueDate: string; principal: number; interest: number; paidPrincipal: number; paidInterest: number; paidAt: string | null }[];
  payments: { id: string; date: string; amount: number; principal: number; interest: number; lateFee: number; status: string }[];
}

export function LoanPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['coop', 'loan', id], queryFn: () => api.get<LoanD>(`/coop/loans/${id}`) });
  const [modal, setModal] = useState<'disburse' | 'pay' | null>(null);
  const [f, setF] = useState({ date: isoDate(), amount: '', lateFee: '', bankAccountId: null as string | null });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), setModal(null), qc.invalidateQueries({ queryKey: ['coop'] })),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading) return <Loading />;
  const l = q.data;
  if (!l) return <EmptyState icon="hand-coins" title="Loan not found" />;
  const due = l.schedule.filter((s) => s.dueDate <= isoDate()).reduce((a, s) => a + s.principal + s.interest - s.paidPrincipal - s.paidInterest, 0);
  const lastPayment = l.payments.find((p) => p.status === 'POSTED');
  const loan = can('coop.loan');
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${l.number} · ${l.member?.name ?? ''}`}
        subtitle={`${l.product?.name ?? ''} · ${fmtMoney(l.principal, 0)} · ${l.termMonths} months · ${l.ratePct}% ${l.method.toLowerCase()} (about ${l.effectivePct}% effective)`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[l.status]?.tone ?? 'gray'}>{l.status === 'ACTIVE' ? 'Running' : STATUS[l.status].label}</Badge>
            {l.status === 'APPLIED' && loan && (
              <>
                <Button icon="banknote" onClick={() => setModal('disburse')}>
                  Disburse
                </Button>
                <Button
                  variant="ghost"
                  icon="x"
                  onClick={async () => (await confirm({ title: `Cancel ${l.number}?`, danger: true, confirmText: 'Cancel loan' })) && act.mutate({ path: `/coop/loans/${l.id}/cancel` })}
                >
                  Cancel
                </Button>
              </>
            )}
            {l.status === 'ACTIVE' && loan && (
              <Button
                icon="hand-coins"
                onClick={() => (
                  setF({
                    ...f,
                    amount: str(
                      Math.round(
                        due > 0
                          ? due
                          : (l.schedule.find((s) => s.principal + s.interest - s.paidPrincipal - s.paidInterest > 0)?.principal ?? 0) +
                              (l.schedule.find((s) => s.principal + s.interest - s.paidPrincipal - s.paidInterest > 0)?.interest ?? 0),
                      ),
                    ),
                    lateFee: '',
                  }),
                  setModal('pay')
                )}
              >
                Payment
              </Button>
            )}
            {l.status === 'ACTIVE' && can('coop.close') && l.daysOverdue > 180 && (
              <Button
                variant="ghost"
                icon="trash-2"
                onClick={async () =>
                  (await confirm({
                    title: `Write ${l.number} off?`,
                    message: `${fmtMoney(l.outstanding, 0)} out of the allowance; collection may go on off the books.`,
                    danger: true,
                    confirmText: 'Write off',
                  })) && act.mutate({ path: `/coop/loans/${l.id}/write-off`, body: { date: isoDate() } })
                }
              >
                Write off
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Outstanding</span>
          <span className="block text-lg font-semibold">{fmtMoney(l.outstanding, 0)}</span>
          <span className="block text-xs text-slate-500">interest over the term {fmtMoney(l.totalInterest, 0)}</span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Collectibility</span>
          <span className={`block font-semibold ${l.daysOverdue > 90 ? 'text-red-600' : l.daysOverdue > 0 ? 'text-amber-700' : ''}`}>{l.collectibility ?? '-'}</span>
          <span className="block text-xs text-slate-500">{l.daysOverdue > 0 ? `${l.daysOverdue} days late, ${fmtMoney(l.overdueAmount, 0)} due` : 'nothing overdue'}</span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Paid out</span>
          <span className="block font-semibold">{l.disbursedAt ? fmtDate(l.disbursedAt) : 'not yet'}</span>
          <span className="block text-xs text-slate-500">
            admin {fmtMoney(l.adminFee, 0)} · to savings {fmtMoney(l.savingDeduction, 0)}
          </span>
        </Card>
        <Card bodyClass="px-4 py-3 text-sm">
          <span className="block text-xs text-slate-500">Member exposure / own capital (BMPP)</span>
          <span className={`block font-semibold ${(l.bmpp.pct ?? 0) > l.bmpp.limitPct ? 'text-red-600' : ''}`}>{l.bmpp.pct !== null ? `${fmtNumber(l.bmpp.pct, 2)}%` : '-'}</span>
          <span className="block text-xs text-slate-500">
            {l.bmpp.ownCapital > 0
              ? `${fmtMoney(l.bmpp.exposure, 0)} of ${fmtMoney(l.bmpp.ownCapital, 0)} · at most ${l.bmpp.limitPct}% for a KSP`
              : `own capital on the books is ${fmtMoney(l.bmpp.ownCapital, 0)}: no BMPP room for a KSP`}
          </span>
        </Card>
      </div>
      {(l.purpose || l.collateral || l.guarantor) && (
        <Card bodyClass="px-4 py-3 text-sm">
          {l.purpose && <p>Purpose: {l.purpose}</p>}
          {l.collateral && <p>Collateral: {l.collateral}</p>}
          {l.guarantor && <p>Guarantor: {l.guarantor}</p>}
        </Card>
      )}
      <Card title="Schedule" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Due</th>
                <th className="px-2 py-2 text-right">Principal</th>
                <th className="px-2 py-2 text-right">Interest</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {l.schedule.map((s) => {
                const left = s.principal + s.interest - s.paidPrincipal - s.paidInterest;
                const late = left > 0.004 && s.dueDate < isoDate() && l.status === 'ACTIVE';
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-1.5">{s.seq}</td>
                    <td className={`px-2 py-1.5 ${late ? 'text-red-600' : ''}`}>{fmtDate(s.dueDate)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(s.principal, 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(s.interest, 0)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(s.paidPrincipal + s.paidInterest, 0)}</td>
                    <td className="px-4 py-1.5 text-xs">{s.paidAt ? `paid ${fmtDate(s.paidAt)}` : late ? 'late' : left < s.principal + s.interest ? 'part paid' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {l.payments.length > 0 && (
        <Card title="Payments" bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {l.payments.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${p.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                <span className="flex-1">{fmtDate(p.date)}</span>
                <span className="text-xs text-slate-500">
                  principal {fmtMoney(p.principal, 0)} · interest {fmtMoney(p.interest, 0)} {p.lateFee > 0 ? `· late ${fmtMoney(p.lateFee, 0)}` : ''}
                </span>
                <span className="w-28 text-right">{fmtMoney(p.amount, 0)}</span>
                {p.id === lastPayment?.id && loan && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="undo"
                    aria-label="Cancel payment"
                    onClick={async () => (await confirm({ title: 'Cancel this payment?', danger: true, confirmText: 'Cancel payment' })) && act.mutate({ path: `/coop/payments/${p.id}/cancel` })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal === 'disburse' ? `Disburse ${l.number}` : `Payment on ${l.number}`}
          footer={
            <Button
              icon="check"
              disabled={!f.bankAccountId || (modal === 'pay' && !num(f.amount))}
              loading={act.isPending}
              onClick={() =>
                act.mutate(
                  modal === 'disburse'
                    ? { path: `/coop/loans/${l.id}/disburse`, body: { date: f.date, bankAccountId: f.bankAccountId } }
                    : { path: `/coop/loans/${l.id}/pay`, body: { date: f.date, amount: f.amount, lateFee: f.lateFee || 0, bankAccountId: f.bankAccountId } },
                )
              }
            >
              {modal === 'disburse' ? 'Pay out' : 'Record'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
            </Field>
            <Field label={modal === 'disburse' ? 'Paid from' : 'Received into'} required>
              <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => setF({ ...f, bankAccountId: v })} />
            </Field>
            {modal === 'pay' && (
              <>
                <Field label="Amount" required help={due > 0 ? `Due now ${fmtMoney(due, 0)}` : 'More than due pays the principal ahead'}>
                  <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
                </Field>
                <Field label="Of which late charge" help={l.product?.latePct ? `${l.product.latePct}% a month on the overdue` : undefined}>
                  <NumberInput decimals={0} min={0} value={f.lateFee} onChange={(v) => setF({ ...f, lateFee: v })} />
                </Field>
              </>
            )}
          </div>
          {modal === 'disburse' && (
            <p className="mt-2 text-sm">
              Paid out {fmtMoney(l.principal - l.adminFee - l.savingDeduction, 0)} = {fmtMoney(l.principal, 0)} − admin {fmtMoney(l.adminFee, 0)} − savings {fmtMoney(l.savingDeduction, 0)}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

// ============================================================ products
export function ProductsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['coop', 'products'], queryFn: () => api.get<Products>('/coop/products') });
  const [sp, setSp] = useState<Products['saving'][number] | 'new' | null>(null);
  const [lp, setLp] = useState<Products['loan'][number] | 'new' | null>(null);
  const saved = () => (setSp(null), setLp(null), qc.invalidateQueries({ queryKey: ['coop'] }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Savings & Loan Products"
        subtitle="Simpanan pokok, wajib, sukarela and berjangka (interest at most 9% a year); loan products at most 24% a year, flat or effective, with admin fee, savings deduction and late charge (Permenkop UKM 8/2023)"
      />
      <Card
        title="Savings"
        bodyClass="p-0"
        actions={
          can('coop.saving') && (
            <Button size="sm" icon="plus" onClick={() => setSp('new')}>
              Savings product
            </Button>
          )
        }
      >
        {!q.data?.saving.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">None yet: set up simpanan pokok, wajib and sukarela before registering members.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {q.data.saving.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setSp(p)}>
                  <span className="flex-1">
                    {p.code} · {p.name}
                    <span className="block text-xs text-slate-500">
                      {KIND[p.kind]} {p.amount > 0 ? `· ${fmtMoney(p.amount, 0)}${p.kind === 'MANDATORY' ? ' a month' : ''}` : ''} {p.ratePct > 0 ? `· ${p.ratePct}% a year` : ''}{' '}
                      {p.termMonths ? `· ${p.termMonths} months` : ''}
                    </span>
                  </span>
                  <Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Loans"
        bodyClass="p-0"
        actions={
          can('coop.loan') && (
            <Button size="sm" icon="plus" onClick={() => setLp('new')}>
              Loan product
            </Button>
          )
        }
      >
        {!q.data?.loan.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {q.data.loan.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50" onClick={() => setLp(p)}>
                  <span className="flex-1">
                    {p.code} · {p.name}
                    <span className="block text-xs text-slate-500">
                      {p.ratePct}% {p.method.toLowerCase()} {p.method === 'FLAT' ? `(about ${p.effectivePct}% effective over 12 months)` : ''} · admin {p.adminPct}% · savings {p.savingPct}% · up to{' '}
                      {p.maxTerm} months
                    </span>
                  </span>
                  <Badge tone={p.isActive ? 'green' : 'gray'}>{p.isActive ? 'active' : 'off'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {sp && <SavingProductForm p={sp === 'new' ? undefined : sp} onClose={() => setSp(null)} onSaved={saved} />}
      {lp && <LoanProductForm p={lp === 'new' ? undefined : lp} onClose={() => setLp(null)} onSaved={saved} />}
    </div>
  );
}

function SavingProductForm({ p, onClose, onSaved }: { p?: Products['saving'][number]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: p?.code ?? '',
    name: p?.name ?? '',
    kind: p?.kind ?? 'VOLUNTARY',
    amount: str(p?.amount ?? 0),
    ratePct: str(p?.ratePct ?? 0),
    termMonths: str(p?.termMonths),
    isActive: p?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (p ? api.put(`/coop/saving-products/${p.id}`, f) : api.post('/coop/saving-products', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={p ? p.name : 'New savings product'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required>
          <Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kind" error={errors.kind}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
        </Field>
        {['PRINCIPAL', 'MANDATORY'].includes(f.kind) ? (
          <Field label={f.kind === 'PRINCIPAL' ? 'Amount (once)' : 'Amount a month'} required error={errors.amount}>
            <NumberInput decimals={0} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
        ) : (
          <Field label="Interest % a year" error={errors.ratePct} help="At most 9%">
            <NumberInput decimals={2} min={0} max={9} value={f.ratePct} onChange={(v) => setF({ ...f, ratePct: v })} />
          </Field>
        )}
        {f.kind === 'TERM' && (
          <Field label="Term (months)" required error={errors.termMonths}>
            <NumberInput decimals={0} min={1} max={120} value={f.termMonths} onChange={(v) => setF({ ...f, termMonths: v })} />
          </Field>
        )}
        <div className="pt-6 text-sm">
          <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

function LoanProductForm({ p, onClose, onSaved }: { p?: Products['loan'][number]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: p?.code ?? '',
    name: p?.name ?? '',
    ratePct: str(p?.ratePct ?? 12),
    method: p?.method ?? 'FLAT',
    adminPct: str(p?.adminPct ?? 0),
    savingPct: str(p?.savingPct ?? 0),
    latePct: str(p?.latePct ?? 0),
    maxTerm: str(p?.maxTerm ?? 36),
    isActive: p?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (p ? api.put(`/coop/loan-products/${p.id}`, f) : api.post('/coop/loan-products', f)),
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={p ? p.name : 'New loan product'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Interest % a year" required error={errors.ratePct} help="At most 24%">
          <NumberInput decimals={2} min={0} max={24} value={f.ratePct} onChange={(v) => setF({ ...f, ratePct: v })} />
        </Field>
        <Field label="Method">
          <Select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value })}
            options={[
              { value: 'FLAT', label: 'Flat' },
              { value: 'ANNUITY', label: 'Effective (annuity)' },
            ]}
          />
        </Field>
        <Field label="Longest term (months)">
          <NumberInput decimals={0} min={1} max={240} value={f.maxTerm} onChange={(v) => setF({ ...f, maxTerm: v })} />
        </Field>
        <Field label="Admin fee %">
          <NumberInput decimals={2} min={0} max={10} value={f.adminPct} onChange={(v) => setF({ ...f, adminPct: v })} />
        </Field>
        <Field label="To savings %" help="Risk reduction (Art. 29)">
          <NumberInput decimals={2} min={0} max={20} value={f.savingPct} onChange={(v) => setF({ ...f, savingPct: v })} />
        </Field>
        <Field label="Late charge % a month">
          <NumberInput decimals={2} min={0} max={5} value={f.latePct} onChange={(v) => setF({ ...f, latePct: v })} />
        </Field>
        <div className="pt-2 text-sm sm:col-span-3">
          <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ collectibility and SHU
interface Shu {
  year: number;
  computed: number;
  shu: number;
  split: Record<string, number>;
  reserve: number;
  capitalPart: number;
  txnPart: number;
  funds: number;
  fundsDetail: { board: number; staff: number; education: number; social: number };
  members: { memberId: string; member: string; capitalBase: number; txnBase: number; capitalShu: number; txnShu: number; total: number }[];
  run: { id: string; date: string; shu: number; payout: string } | null;
}

export function ShuPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'COLLECT' | 'SHU'>('COLLECT');
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [amount, setAmount] = useState('');
  const [d, setD] = useState({ date: isoDate(), payout: 'PAYABLE', ratNotes: '' });
  const col = useQuery({
    queryKey: ['coop', 'collect'],
    queryFn: () =>
      api.get<{
        rows: { loanId: string; number: string; member: { number: string; name: string } | null; outstanding: number; daysOverdue: number; collectibility: string; pct: number; required: number }[];
        outstanding: number;
        nplPct: number;
        required: number;
        current: number;
        delta: number;
      }>('/coop/collectibility'),
    enabled: tab === 'COLLECT',
  });
  const shu = useQuery({
    queryKey: ['coop', 'shu', year, amount],
    queryFn: () => api.get<Shu>('/coop/shu', { year, ...(num(amount) > 0 ? { shu: amount } : {}) }),
    enabled: tab === 'SHU' && /^\d{4}$/.test(year),
  });
  const act = useMutation({
    mutationFn: (x: { path: string; body?: unknown }) => api.post(x.path, x.body ?? {}),
    onSuccess: () => (toast.success('Done'), qc.invalidateQueries({ queryKey: ['coop'] })),
    onError: (e) => toast.error(e),
  });
  const c = col.data;
  const s = shu.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Collectibility & SHU"
        subtitle="Loans by days overdue with the allowance they need (incurred loss, SAK EP; rates in Settings), and the SHU of a year split as the members meeting decided (UU 25/1992 Art. 45)"
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'COLLECT', label: 'Collectibility & allowance' },
          { value: 'SHU', label: 'SHU distribution' },
        ]}
      />
      {tab === 'COLLECT' && (
        <Card
          title={c ? `Outstanding ${fmtMoney(c.outstanding, 0)} · NPL ${fmtNumber(c.nplPct, 2)}% · allowance needed ${fmtMoney(c.required, 0)}, booked ${fmtMoney(c.current, 0)}` : 'Collectibility'}
          bodyClass="p-0"
          actions={
            c &&
            Math.abs(c.delta) >= 0.01 &&
            can('coop.close') && (
              <Button
                size="sm"
                icon="check"
                loading={act.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Adjust the allowance by ${fmtMoney(c.delta, 0)}?`,
                    message: 'Dr / Cr Loan Loss Provision against the Allowance for Loan Losses, dated today.',
                    confirmText: 'Post',
                  })) && act.mutate({ path: '/coop/provision', body: { date: isoDate() } })
                }
              >
                Post {fmtMoney(c.delta, 0)}
              </Button>
            )
          }
        >
          {!c ? (
            <Loading />
          ) : !c.rows.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No running loans.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {c.rows.map((r) => (
                <li key={r.loanId}>
                  <Link to={`/coop/loans/${r.loanId}`} className="flex flex-wrap items-center gap-2 px-4 py-2 hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      {r.number} · {r.member?.number} {r.member?.name}
                      <span className="block text-xs text-slate-500">
                        {r.collectibility} · {r.daysOverdue} days
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">
                      {r.pct}% of {fmtMoney(r.outstanding, 0)}
                    </span>
                    <span className="w-28 text-right">{fmtMoney(r.required, 0)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === 'SHU' && (
        <>
          <Card bodyClass="px-4 py-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Financial year">
                <Input value={year} maxLength={4} onChange={(e) => setYear(e.target.value)} />
              </Field>
              <Field label="SHU to distribute" help={s ? `The books show ${fmtMoney(s.computed, 0)} (income less expenses)` : undefined}>
                <NumberInput decimals={0} min={0} value={amount} placeholder={s ? String(s.computed) : ''} onChange={setAmount} />
              </Field>
              <Field label="Members' part goes">
                <Select
                  value={d.payout}
                  onChange={(e) => setD({ ...d, payout: e.target.value })}
                  options={[
                    { value: 'PAYABLE', label: 'To SHU payable (paid out)' },
                    { value: 'SAVINGS', label: 'Into their voluntary savings' },
                  ]}
                />
              </Field>
              <Field label="Date of the members meeting (RAT)">
                <DatePicker value={d.date} clearable={false} onChange={(v) => setD({ ...d, date: v ?? isoDate() })} />
              </Field>
            </div>
          </Card>
          {s && (
            <Card
              title={`SHU ${s.year}: ${fmtMoney(s.shu, 0)}`}
              bodyClass="p-0"
              actions={
                can('coop.close') &&
                (s.run ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="undo"
                    onClick={async () =>
                      (await confirm({ title: `Cancel the SHU ${s.year} distribution?`, danger: true, confirmText: 'Cancel' })) && act.mutate({ path: `/coop/shu/${s.run!.id}/cancel` })
                    }
                  >
                    Cancel distribution
                  </Button>
                ) : (
                  s.shu > 0 && (
                    <Button
                      size="sm"
                      icon="check"
                      loading={act.isPending}
                      onClick={async () =>
                        (await confirm({
                          title: `Distribute the SHU ${s.year}?`,
                          message: 'As the members meeting decided: Dr Retained Earnings (after the year-end closing) / Cr reserve, funds and the members.',
                          confirmText: 'Distribute',
                        })) && act.mutate({ path: '/coop/shu', body: { year: Number(year), date: d.date, shu: s.shu, payout: d.payout, ratNotes: d.ratNotes } })
                      }
                    >
                      Distribute
                    </Button>
                  )
                ))
              }
            >
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 px-4 py-3 text-sm sm:grid-cols-4">
                <dt className="text-slate-500">Reserve ({s.split.reserve}%)</dt>
                <dd className="text-right">{fmtMoney(s.reserve, 0)}</dd>
                <dt className="text-slate-500">Capital ({s.split.capital}%)</dt>
                <dd className="text-right">{fmtMoney(s.capitalPart, 0)}</dd>
                <dt className="text-slate-500">Transactions ({s.split.transactions}%)</dt>
                <dd className="text-right">{fmtMoney(s.txnPart, 0)}</dd>
                <dt className="text-slate-500">Board / staff / education / social</dt>
                <dd className="text-right">{fmtMoney(s.funds, 0)}</dd>
              </dl>
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[700px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Member</th>
                      <th className="px-2 py-2 text-right">Pokok + wajib</th>
                      <th className="px-2 py-2 text-right">Transactions</th>
                      <th className="px-2 py-2 text-right">Jasa modal</th>
                      <th className="px-2 py-2 text-right">Jasa usaha</th>
                      <th className="px-4 py-2 text-right">SHU</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {s.members.map((m) => (
                      <tr key={m.memberId}>
                        <td className="px-4 py-1.5">{m.member}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(m.capitalBase, 0)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(m.txnBase, 0)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(m.capitalShu, 0)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtMoney(m.txnShu, 0)}</td>
                        <td className="px-4 py-1.5 text-right font-medium">{fmtMoney(m.total, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-3 text-xs text-slate-500">
                {s.run
                  ? `Distributed on ${fmtDate(s.run.date)} (${s.run.payout === 'SAVINGS' ? 'into savings' : 'payable'}).`
                  : 'The split percentages are in Settings (coop.shuSplit) as set by the articles; a part nobody earned stays in the reserve.'}{' '}
                SHU received by members is not taxable to them (UU PPh Art. 4(3) as amended by UU 6/2023).
              </p>
            </Card>
          )}
          <Field label="Members meeting notes">
            <Textarea rows={2} value={d.ratNotes} maxLength={300} onChange={(e) => setD({ ...d, ratNotes: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}
