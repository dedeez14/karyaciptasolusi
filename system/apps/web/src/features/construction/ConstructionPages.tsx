import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
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
const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'In progress', tone: 'blue' },
  PHO: { label: 'Handed over (PHO)', tone: 'amber' },
  FHO: { label: 'Final handover', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
  DRAFT: { label: 'Draft', tone: 'gray' },
  APPROVED: { label: 'Approved', tone: 'green' },
  CLOSED: { label: 'Closed', tone: 'green' },
};
const KIND: Record<string, string> = { WORK: 'Construction work', INTEGRATED: 'Integrated (design and build)', CONSULTANCY: 'Construction consultancy' };
const QUAL: Record<string, string> = { SMALL: 'SBU small / SKK (individual)', OTHER: 'SBU medium / large', NONE: 'No SBU / SKK' };
const RATES: Record<string, Record<string, number>> = {
  WORK: { SMALL: 1.75, OTHER: 2.65, NONE: 4 },
  INTEGRATED: { SMALL: 2.65, OTHER: 2.65, NONE: 4 },
  CONSULTANCY: { SMALL: 3.5, OTHER: 3.5, NONE: 6 },
};
const COST_TYPES = ['MIXED', 'MATERIAL', 'LABOUR', 'EQUIPMENT', 'SUBCON', 'OVERHEAD'];
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const num = (v: string) => Number(v || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Inv {
  id: string;
  number: string;
  status: string;
  grandTotal: number | string;
  paidAmount: number | string;
  dueDate?: string | null;
}
const InvLink = ({ i }: { i: Inv | null }) =>
  i ? (
    <Link className="text-brand-600" to={`/documents/SI/${i.id}`}>
      {i.number}
    </Link>
  ) : null;

// ============================================================ contracts
interface ContractRow {
  id: string;
  contractNo: string;
  title: string;
  contractDate: string;
  status: string;
  customer: string | null;
  project: { code: string; name: string } | null;
  contractValue: number;
  certified: number;
  progressPct: number;
  retentionHeld: number;
  pphRate: number;
}

export function ContractsPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'OPEN' | 'ACTIVE' | 'PHO' | 'FHO' | 'CANCELLED'>('OPEN');
  const q = useQuery({ queryKey: ['construction', 'contracts', status], queryFn: () => api.get<ContractRow[]>('/construction/contracts', status === 'OPEN' ? {} : { status }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Contracts & BoQ"
        subtitle="Construction contracts with their bill of quantities and budget, advance, progress certificates, handover and retention (UU 2/2017 jo UU 6/2023; PPh final 4(2) PP 9/2022)"
        actions={
          can('construction.manage') && (
            <Button icon="plus" onClick={() => navigate('/construction/contracts/new')}>
              New contract
            </Button>
          )
        }
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: 'OPEN', label: 'All open' },
          { value: 'ACTIVE', label: 'In progress' },
          { value: 'PHO', label: 'Maintenance' },
          { value: 'FHO', label: 'Finished' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="hard-hat" title="No contracts" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((c) => (
              <li key={c.id}>
                <Link to={`/construction/contracts/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {c.contractNo} · {c.title}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {c.customer} · {c.project?.code} · {fmtDate(c.contractDate)} · PPh final {c.pphRate}%
                    </span>
                  </span>
                  <span className="w-48">
                    <span className="block h-2 overflow-hidden rounded bg-slate-100">
                      <span className="block h-2 bg-brand-500" style={{ width: `${Math.min(100, c.progressPct)}%` }} />
                    </span>
                    <span className="mt-0.5 block text-right text-xs text-slate-500">
                      {fmtNumber(c.progressPct, 2)}% of {fmtMoney(c.contractValue, 0)}
                    </span>
                  </span>
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface BoqRow {
  id?: string;
  code: string;
  description: string;
  unit: string;
  qty: string;
  unitPrice: string;
  budgetUnitCost: string;
  costType: string;
  certifiedQty?: number;
}
interface Contract {
  id: string;
  projectId: string;
  customerId: string;
  contractNo: string;
  contractDate: string;
  title: string;
  contractValue: number;
  vat: boolean;
  govCollector: boolean;
  serviceKind: string;
  qualification: string;
  pphRate: number;
  advancePct: number;
  advanceAmount: number;
  retentionPct: number;
  maintenanceDays: number;
  startDate: string | null;
  finishDate: string | null;
  phoDate: string | null;
  fhoDate: string | null;
  status: string;
  notes: string | null;
  customer: { code: string; name: string } | null;
  project: { code: string; name: string } | null;
  boq: {
    id: string;
    code: string;
    description: string;
    unit: string;
    qty: number;
    unitPrice: number;
    budgetUnitCost: number;
    costType: string;
    certifiedQty: number;
    value: number;
    budget: number;
    certifiedValue: number;
  }[];
  certificates: {
    id: string;
    number: string;
    date: string;
    status: string;
    thisValue: number;
    cumulativeValue: number;
    advanceRecovery: number;
    retention: number;
    netAmount: number;
    ppn: number;
    invoice: Inv | null;
  }[];
  subcontracts: { id: string; scope: string; value: number; claimedPct: number; retentionHeld: number }[];
  advanceInvoice: Inv | null;
  retentionInvoice: Inv | null;
  summary: {
    budgetCost: number;
    budgetMargin: number;
    certified: number;
    progressPct: number;
    actualCost: number;
    costPct: number;
    earnedByCost: number;
    overBilling: number;
    advance: number;
    advanceRecovered: number;
    advanceOutstanding: number;
    retentionHeld: number;
    billed: number;
    received: number;
    maintenanceEnds: string | null;
  };
}

export function ContractPage() {
  const { id = 'new' } = useParams();
  const q = useQuery({ queryKey: ['construction', 'contract', id], queryFn: () => api.get<Contract>(`/construction/contracts/${id}`), enabled: id !== 'new' });
  if (id !== 'new' && q.isLoading) return <Loading />;
  if (id !== 'new' && !q.data) return <EmptyState icon="hard-hat" title="Contract not found" />;
  return <ContractForm key={`${id}-${q.data?.status ?? ''}`} c={id === 'new' ? undefined : q.data} />;
}

function ContractForm({ c }: { c?: Contract }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editable = (!c || c.status === 'ACTIVE') && can('construction.manage');
  const [f, setF] = useState({
    projectId: c?.projectId ?? (null as string | null),
    customerId: c?.customerId ?? (null as string | null),
    contractNo: c?.contractNo ?? '',
    contractDate: c?.contractDate ?? isoDate(),
    title: c?.title ?? '',
    vat: c?.vat ?? true,
    govCollector: c?.govCollector ?? false,
    serviceKind: c?.serviceKind ?? 'WORK',
    qualification: c?.qualification ?? 'SMALL',
    advancePct: str(c?.advancePct ?? 0),
    retentionPct: str(c?.retentionPct ?? 5),
    maintenanceDays: str(c?.maintenanceDays ?? 180),
    startDate: c?.startDate ?? (null as string | null),
    finishDate: c?.finishDate ?? (null as string | null),
    notes: c?.notes ?? '',
  });
  const [boq, setBoq] = useState<BoqRow[]>(
    c?.boq.map((b) => ({
      id: b.id,
      code: b.code,
      description: b.description,
      unit: b.unit,
      qty: str(b.qty),
      unitPrice: str(b.unitPrice),
      budgetUnitCost: str(b.budgetUnitCost),
      costType: b.costType,
      certifiedQty: b.certifiedQty,
    })) ?? [{ code: '1', description: '', unit: 'ls', qty: '1', unitPrice: '', budgetUnitCost: '', costType: 'MIXED' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [handover, setHandover] = useState<'pho' | 'fho' | null>(null);
  const [hDate, setHDate] = useState(isoDate());
  const total = r2(boq.reduce((a, b) => a + r2(num(b.qty) * num(b.unitPrice)), 0));
  const budget = r2(boq.reduce((a, b) => a + r2(num(b.qty) * num(b.budgetUnitCost)), 0));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        boq: boq.map((b) => ({
          id: b.id ?? null,
          code: b.code,
          description: b.description,
          unit: b.unit,
          qty: b.qty,
          unitPrice: b.unitPrice || 0,
          budgetUnitCost: b.budgetUnitCost || 0,
          costType: b.costType,
        })),
      };
      return c ? api.put<Contract>(`/construction/contracts/${c.id}`, body) : api.post<Contract>('/construction/contracts', body);
    },
    onSuccess: (r) => {
      toast.success('Contract saved');
      setErrors({});
      qc.invalidateQueries({ queryKey: ['construction'] });
      if (!c) navigate(`/construction/contracts/${r.id}`, { replace: true });
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const act = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api.post<Contract>(`/construction/contracts/${c!.id}/${a.path}`, a.body ?? {}),
    onSuccess: () => (toast.success('Done'), setHandover(null), qc.invalidateQueries({ queryKey: ['construction'] })),
    onError: (e) => toast.error(e),
  });
  const setRow = (i: number, patch: Partial<BoqRow>) => setBoq(boq.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const s = c?.summary;
  const draftCert = c?.certificates.find((x) => x.status === 'DRAFT');
  return (
    <div className="space-y-5">
      <PageHeader
        title={c ? `${c.contractNo} · ${c.title}` : 'New construction contract'}
        subtitle={
          c
            ? `${c.customer?.name ?? ''} · project ${c.project?.code ?? ''} · ${KIND[c.serviceKind]} · PPh final ${c.pphRate}%`
            : 'One contract per project: costs booked to the project are the contract costs'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {c && <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}
            {editable && (
              <Button icon="save" loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            )}
            {c?.status === 'ACTIVE' && c.advancePct > 0 && !c.advanceInvoice && !c.certificates.some((x) => x.status === 'APPROVED') && can('construction.manage') && (
              <Button
                variant="outline"
                icon="file-plus"
                loading={act.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Invoice the ${c.advancePct}% advance?`,
                    message: `${fmtMoney((c.contractValue * c.advancePct) / 100, 0)} plus PPN (due when it is paid); recovered from each certificate.`,
                    confirmText: 'Invoice advance',
                  })) && act.mutate({ path: 'advance' })
                }
              >
                Invoice advance
              </Button>
            )}
            {c?.status === 'ACTIVE' && can('construction.certify') && (
              <Button variant="outline" icon="clipboard-check" onClick={() => navigate(draftCert ? `/construction/certificates/${draftCert.id}` : `/construction/certificates/new?contract=${c.id}`)}>
                {draftCert ? 'Open draft certificate' : 'New certificate'}
              </Button>
            )}
            {c?.status === 'ACTIVE' && can('construction.manage') && (
              <Button variant="outline" icon="flag" onClick={() => (setHDate(isoDate()), setHandover('pho'))}>
                Handover (PHO)
              </Button>
            )}
            {c?.status === 'PHO' && can('construction.manage') && (
              <>
                <Button variant="outline" icon="flag" onClick={() => (setHDate(isoDate()), setHandover('fho'))}>
                  Final handover (FHO)
                </Button>
                <Button
                  variant="ghost"
                  icon="undo"
                  onClick={async () =>
                    (await confirm({ title: 'Undo the provisional handover?', message: 'Its retention invoice is cancelled (only while unpaid).', danger: true, confirmText: 'Undo PHO' })) &&
                    act.mutate({ path: 'pho/undo' })
                  }
                >
                  Undo PHO
                </Button>
              </>
            )}
            {c?.status === 'ACTIVE' && can('construction.manage') && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({ title: `Cancel ${c.contractNo}?`, message: 'Only a contract without approved certificates or advance.', danger: true, confirmText: 'Cancel contract' })) &&
                  act.mutate({ path: 'cancel' }, { onSuccess: () => navigate('/construction/contracts') })
                }
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />

      {c && s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card bodyClass="px-4 py-3 text-sm">
            <span className="block text-xs text-slate-500">Contract / budget (RAP)</span>
            <span className="block text-lg font-semibold">{fmtMoney(c.contractValue, 0)}</span>
            <span className="block text-xs text-slate-500">
              budget {fmtMoney(s.budgetCost, 0)} · margin {fmtMoney(s.budgetMargin, 0)}
            </span>
          </Card>
          <Card bodyClass="px-4 py-3 text-sm">
            <span className="block text-xs text-slate-500">Certified</span>
            <span className="block text-lg font-semibold">{fmtNumber(s.progressPct, 2)}%</span>
            <span className="block text-xs text-slate-500">
              {fmtMoney(s.certified, 0)} · invoiced incl. PPN {fmtMoney(s.billed, 0)}, received {fmtMoney(s.received, 0)}
            </span>
          </Card>
          <Card bodyClass="px-4 py-3 text-sm">
            <span className="block text-xs text-slate-500">Cost booked to the project</span>
            <span className="block text-lg font-semibold">{fmtMoney(s.actualCost, 0)}</span>
            <span className={`block text-xs ${s.costPct > s.progressPct + 5 ? 'text-red-600' : 'text-slate-500'}`}>
              {fmtNumber(s.costPct, 2)}% of the budget · earned by cost {fmtMoney(s.earnedByCost, 0)} ({s.overBilling >= 0 ? 'billed ahead' : 'billed behind'} {fmtMoney(Math.abs(s.overBilling), 0)})
            </span>
          </Card>
          <Card bodyClass="px-4 py-3 text-sm">
            <span className="block text-xs text-slate-500">Advance / retention</span>
            <span className="block text-sm font-semibold">
              advance left {fmtMoney(s.advanceOutstanding, 0)} of {fmtMoney(s.advance, 0)}
            </span>
            <span className="block text-xs text-slate-500">
              retention {fmtMoney(s.retentionHeld, 0)}
              {c.retentionInvoice && (
                <>
                  {' '}
                  on <InvLink i={c.retentionInvoice} /> due {fmtDate(s.maintenanceEnds)}
                </>
              )}
            </span>
          </Card>
        </div>
      )}

      <Card title="Contract">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Project" required error={errors.projectId}>
            <AsyncSelect
              disabled={!editable || !!c}
              resource="projects"
              value={f.projectId}
              initialLabel={c?.project ? `${c.project.code} - ${c.project.name}` : undefined}
              onChange={(v) => setF({ ...f, projectId: v })}
            />
          </Field>
          <Field label="Client" required error={errors.customerId}>
            <AsyncSelect
              disabled={!editable}
              resource="customers"
              value={f.customerId}
              initialLabel={c?.customer ? `${c.customer.code} - ${c.customer.name}` : undefined}
              onChange={(v) => setF({ ...f, customerId: v })}
            />
          </Field>
          <Field label="Contract number (SPK)" required error={errors.contractNo}>
            <Input disabled={!editable} value={f.contractNo} maxLength={60} onChange={(e) => setF({ ...f, contractNo: e.target.value })} />
          </Field>
          <Field label="Contract date" required>
            <DatePicker disabled={!editable} value={f.contractDate} clearable={false} onChange={(v) => setF({ ...f, contractDate: v ?? isoDate() })} />
          </Field>
          <Field label="Title" required className="sm:col-span-2" error={errors.title}>
            <Input disabled={!editable} value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Start">
            <DatePicker disabled={!editable} value={f.startDate} onChange={(v) => setF({ ...f, startDate: v })} />
          </Field>
          <Field label="Planned finish">
            <DatePicker disabled={!editable} value={f.finishDate} onChange={(v) => setF({ ...f, finishDate: v })} />
          </Field>
          <Field label="Service">
            <Select
              disabled={!editable}
              value={f.serviceKind}
              onChange={(e) => setF({ ...f, serviceKind: e.target.value })}
              options={Object.entries(KIND).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Our certificate" help={`PPh final ${RATES[f.serviceKind][f.qualification]}% (PP 9/2022)`}>
            <Select
              disabled={!editable}
              value={f.qualification}
              onChange={(e) => setF({ ...f, qualification: e.target.value })}
              options={Object.entries(QUAL).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Advance (uang muka) %" error={errors.advancePct}>
            <NumberInput disabled={!editable} decimals={2} min={0} max={100} value={f.advancePct} onChange={(v) => setF({ ...f, advancePct: v })} />
          </Field>
          <Field label="Retention %" help="Held from each certificate until the handover">
            <NumberInput disabled={!editable} decimals={2} min={0} max={20} value={f.retentionPct} onChange={(v) => setF({ ...f, retentionPct: v })} />
          </Field>
          <Field label="Maintenance period (days)">
            <NumberInput disabled={!editable} decimals={0} min={0} max={3650} value={f.maintenanceDays} onChange={(v) => setF({ ...f, maintenanceDays: v })} />
          </Field>
          <div className="space-y-2 pt-6 text-sm sm:col-span-3">
            <Checkbox disabled={!editable} checked={f.vat} onChange={(v) => setF({ ...f, vat: v })} label="PPN on the invoices (we are a PKP)" />
            <Checkbox disabled={!editable} checked={f.govCollector} onChange={(v) => setF({ ...f, govCollector: v })} label="Client is a government PPN collector (faktur code 02, DPP 11/12)" />
          </div>
        </div>
      </Card>

      <Card title={`Bill of quantities (RAB) · ${fmtMoney(total, 0)} · budget (RAP) ${fmtMoney(budget, 0)}`} bodyClass="p-0">
        {errors.boq && <p className="px-4 pt-3 text-xs text-red-600">{errors.boq}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-20 px-3 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">Description</th>
                <th className="w-16 px-2 py-2 text-left">Unit</th>
                <th className="w-24 px-2 py-2 text-left">Qty</th>
                <th className="w-32 px-2 py-2 text-left">Unit price</th>
                <th className="w-32 px-2 py-2 text-left">Budget / unit</th>
                <th className="w-28 px-2 py-2 text-left">Cost type</th>
                <th className="w-36 px-2 py-2 text-right">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {boq.map((b, i) => (
                <tr key={b.id ?? `n${i}`} className="align-top">
                  <td className="px-3 py-1.5">
                    <Input disabled={!editable} value={b.code} maxLength={30} onChange={(e) => setRow(i, { code: e.target.value })} aria-label="Item" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input disabled={!editable} value={b.description} maxLength={300} onChange={(e) => setRow(i, { description: e.target.value })} aria-label="Description" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input disabled={!editable} value={b.unit} maxLength={20} onChange={(e) => setRow(i, { unit: e.target.value })} aria-label="Unit" />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput disabled={!editable} decimals={3} min={0} value={b.qty} onChange={(v) => setRow(i, { qty: v })} aria-label="Quantity" />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput disabled={!editable || (b.certifiedQty ?? 0) > 0} decimals={2} min={0} value={b.unitPrice} onChange={(v) => setRow(i, { unitPrice: v })} aria-label="Unit price" />
                  </td>
                  <td className="px-2 py-1.5">
                    <NumberInput disabled={!editable} decimals={2} min={0} value={b.budgetUnitCost} onChange={(v) => setRow(i, { budgetUnitCost: v })} aria-label="Budget per unit" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      disabled={!editable}
                      value={b.costType}
                      onChange={(e) => setRow(i, { costType: e.target.value })}
                      options={COST_TYPES.map((t) => ({ value: t, label: t.toLowerCase() }))}
                      aria-label="Cost type"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {fmtMoney(r2(num(b.qty) * num(b.unitPrice)), 0)}
                    {(b.certifiedQty ?? 0) > 0 && (
                      <span className="block text-xs text-slate-500">
                        {fmtNumber(b.certifiedQty ?? 0, 2)} {b.unit} certified
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable && !(b.certifiedQty ?? 0) && <Button variant="ghost" size="icon" icon="x" aria-label="Remove item" onClick={() => setBoq(boq.filter((_, j) => j !== i))} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              icon="plus"
              onClick={() => setBoq([...boq, { code: String(boq.length + 1), description: '', unit: 'ls', qty: '1', unitPrice: '', budgetUnitCost: '', costType: 'MIXED' }])}
            >
              BoQ item
            </Button>
            {c && <span className="ml-3 text-xs text-slate-500">An addendum changes the BoQ: certified items keep their price and at least the quantity certified.</span>}
          </div>
        )}
      </Card>

      {c && (
        <Card title="Advance and certificates" bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {c.advanceInvoice && (
              <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  Advance {c.advancePct}% · <InvLink i={c.advanceInvoice} />
                </span>
                <span>{fmtMoney(c.advanceAmount, 0)}</span>
              </li>
            )}
            {c.certificates.map((x) => (
              <li key={x.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${x.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                <Link to={`/construction/certificates/${x.id}`} className="min-w-0 flex-1 text-brand-600">
                  {x.number} · {fmtDate(x.date)}
                </Link>
                <span className="text-xs text-slate-500">
                  work {fmtMoney(x.thisValue, 0)} − advance {fmtMoney(x.advanceRecovery, 0)} − retention {fmtMoney(x.retention, 0)}
                  {x.invoice && (
                    <>
                      {' '}
                      · <InvLink i={x.invoice} />
                    </>
                  )}
                </span>
                <span className="w-32 text-right">{fmtMoney(x.netAmount, 0)}</span>
                <Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>
              </li>
            ))}
            {!c.advanceInvoice && !c.certificates.length && <li className="px-4 py-3 text-slate-500">No advance or certificates yet.</li>}
          </ul>
        </Card>
      )}

      <Card title="Notes">
        <Textarea disabled={!editable} rows={2} value={f.notes} maxLength={4000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Card>

      {handover && c && (
        <Modal
          open
          onClose={() => setHandover(null)}
          title={handover === 'pho' ? 'Provisional handover (BAST 1)' : 'Final handover (BAST 2)'}
          footer={
            <Button icon="check" loading={act.isPending} onClick={() => act.mutate({ path: handover, body: { date: hDate } })}>
              Record
            </Button>
          }
        >
          <Field label="Date of the handover" required>
            <DatePicker value={hDate} clearable={false} onChange={(v) => setHDate(v ?? isoDate())} />
          </Field>
          <p className="mt-2 text-xs text-slate-500">
            {handover === 'pho'
              ? `The service is delivered: the retention held (${fmtMoney(s?.retentionHeld ?? 0, 0)}) is invoiced now with its PPN, due after the ${c.maintenanceDays}-day maintenance period. No more certificates after this.`
              : 'The maintenance period is over; the retention invoice can be collected.'}
          </p>
        </Modal>
      )}
    </div>
  );
}

// ============================================================ progress certificates
interface CertRow {
  id: string;
  number: string;
  contractId: string;
  contractNo: string;
  title: string;
  customer: string | null;
  date: string;
  status: string;
  thisValue: number;
  progressPct: number;
  netAmount: number;
  ppn: number;
  invoice: Inv | null;
}

export function CertificatesPage() {
  const q = useQuery({ queryKey: ['construction', 'certificates'], queryFn: () => api.get<CertRow[]>('/construction/certificates') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Progress Certificates"
        subtitle="Cumulative quantities per BoQ item (opname); each approved certificate is a termin invoice: the work less the advance recovered and the retention held"
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="clipboard-check" title="No certificates" description="Start one from a contract" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link to={`/construction/certificates/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {r.contractNo}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {r.customer} · {fmtDate(r.date)} · cumulative {fmtNumber(r.progressPct, 2)}% {r.invoice ? `· ${r.invoice.number}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    work {fmtMoney(r.thisValue, 0)}
                    <span className="block font-medium">net {fmtMoney(r.netAmount, 0)}</span>
                  </span>
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

interface CertDetail {
  id: string;
  number: string;
  status: string;
  date: string;
  periodTo: string;
  clientRef: string | null;
  notes: string | null;
  thisValue: number;
  previousValue: number;
  cumulativeValue: number;
  advanceRecovery: number;
  retention: number;
  netAmount: number;
  ppn: number;
  contract: { id: string; contractNo: string; title: string; contractValue: number; retentionPct: number; advancePct: number; pphRate: number };
  invoice: Inv | null;
  lines: { boqItemId: string; code: string; description: string; unit: string; qty: number; unitPrice: number; prevQty: number; cumQty: number; thisQty: number; thisValue: number }[];
}

export function CertificatePage() {
  const { id = 'new' } = useParams();
  const [sp] = useSearchParams();
  const contractId = sp.get('contract') ?? '';
  const isNew = id === 'new';
  const q = useQuery({ queryKey: ['construction', 'certificate', id], queryFn: () => api.get<CertDetail>(`/construction/certificates/${id}`), enabled: !isNew });
  const cq = useQuery({ queryKey: ['construction', 'contract', contractId], queryFn: () => api.get<Contract>(`/construction/contracts/${contractId}`), enabled: isNew && !!contractId });
  if ((!isNew && q.isLoading) || (isNew && cq.isLoading)) return <Loading />;
  if (!isNew && !q.data) return <EmptyState icon="clipboard-check" title="Certificate not found" />;
  if (isNew && !cq.data) return <EmptyState icon="clipboard-check" title="Choose a contract first" description="Start a certificate from the contract page" />;
  const d: CertDetail =
    q.data ??
    ({
      id: '',
      number: 'New certificate',
      status: 'DRAFT',
      date: isoDate(),
      periodTo: isoDate(),
      clientRef: null,
      notes: null,
      thisValue: 0,
      previousValue: 0,
      cumulativeValue: 0,
      advanceRecovery: 0,
      retention: 0,
      netAmount: 0,
      ppn: 0,
      contract: {
        id: cq.data!.id,
        contractNo: cq.data!.contractNo,
        title: cq.data!.title,
        contractValue: cq.data!.contractValue,
        retentionPct: cq.data!.retentionPct,
        advancePct: cq.data!.advancePct,
        pphRate: cq.data!.pphRate,
      },
      invoice: null,
      lines: cq.data!.boq.map((b) => ({
        boqItemId: b.id,
        code: b.code,
        description: b.description,
        unit: b.unit,
        qty: b.qty,
        unitPrice: b.unitPrice,
        prevQty: b.certifiedQty,
        cumQty: b.certifiedQty,
        thisQty: 0,
        thisValue: 0,
      })),
    } as CertDetail);
  return <CertificateForm key={`${id}-${d.status}`} d={d} isNew={isNew} />;
}

function CertificateForm({ d, isNew }: { d: CertDetail; isNew: boolean }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editable = d.status === 'DRAFT' && can('construction.certify');
  const [h, setH] = useState({ date: d.date, periodTo: d.periodTo, clientRef: d.clientRef ?? '', notes: d.notes ?? '' });
  const [cum, setCum] = useState<Record<string, string>>(Object.fromEntries(d.lines.map((l) => [l.boqItemId, str(l.cumQty)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preview = useMemo(() => {
    const work = r2(d.lines.reduce((a, l) => a + r2((num(cum[l.boqItemId]) - l.prevQty) * l.unitPrice), 0));
    const retention = r2((work * d.contract.retentionPct) / 100);
    return { work, retention, cumulative: r2(d.lines.reduce((a, l) => a + r2(num(cum[l.boqItemId]) * l.unitPrice), 0)) };
  }, [cum, d]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...h, lines: d.lines.map((l) => ({ boqItemId: l.boqItemId, cumQty: cum[l.boqItemId] || 0 })) };
      return isNew ? api.post<CertDetail>(`/construction/contracts/${d.contract.id}/certificates`, body) : api.put<CertDetail>(`/construction/contracts/${d.contract.id}/certificates/${d.id}`, body);
    },
    onSuccess: (r) => {
      toast.success(`${r.number} saved`);
      setErrors({});
      qc.invalidateQueries({ queryKey: ['construction'] });
      if (isNew) navigate(`/construction/certificates/${r.id}`, { replace: true });
    },
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const act = useMutation({
    mutationFn: (a: 'approve' | 'cancel') => api.post<CertDetail>(`/construction/certificates/${d.id}/${a}`),
    onSuccess: (r) => (
      toast.success(r.status === 'APPROVED' ? `${r.number} approved, invoice ${r.invoice?.number ?? ''}` : `${r.number} cancelled`),
      qc.invalidateQueries({ queryKey: ['construction'] })
    ),
    onError: (e) => toast.error(e),
  });
  const lineErr = (i: number) => errors[`lines.${i}.cumQty`];
  return (
    <div className="space-y-5">
      <PageHeader
        title={`${d.number} · ${d.contract.contractNo}`}
        subtitle={`${d.contract.title} · contract ${fmtMoney(d.contract.contractValue, 0)} · advance ${d.contract.advancePct}% · retention ${d.contract.retentionPct}% · PPh final ${d.contract.pphRate}%`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            <Button variant="ghost" icon="arrow-left" onClick={() => navigate(`/construction/contracts/${d.contract.id}`)}>
              Contract
            </Button>
            {editable && (
              <Button icon="save" variant={isNew ? 'primary' : 'outline'} loading={save.isPending} onClick={() => save.mutate()}>
                Save draft
              </Button>
            )}
            {!isNew && d.status === 'DRAFT' && can('construction.certify') && (
              <Button
                icon="check"
                loading={act.isPending}
                onClick={async () =>
                  (await confirm({
                    title: `Approve ${d.number}?`,
                    message:
                      'The termin invoice is made and confirmed: the work certified less the advance recovered (with PPN) and the retention (no PPN until the handover). Save first if you changed anything.',
                    confirmText: 'Approve and invoice',
                  })) && act.mutate('approve')
                }
              >
                Approve and invoice
              </Button>
            )}
            {!isNew && d.status !== 'CANCELLED' && can('construction.certify') && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    message: d.status === 'APPROVED' ? 'Only the last certificate; its invoice is cancelled (only while unpaid).' : 'The draft is dropped.',
                    danger: true,
                    confirmText: 'Cancel certificate',
                  })) && act.mutate('cancel')
                }
              >
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Certificate date" required>
            <DatePicker disabled={!editable} value={h.date} clearable={false} onChange={(v) => setH({ ...h, date: v ?? isoDate() })} />
          </Field>
          <Field label="Progress up to" required error={errors.periodTo}>
            <DatePicker disabled={!editable} value={h.periodTo} clearable={false} onChange={(v) => setH({ ...h, periodTo: v ?? isoDate() })} />
          </Field>
          <Field label="Client reference (BAP / MC no.)">
            <Input disabled={!editable} value={h.clientRef} maxLength={80} onChange={(e) => setH({ ...h, clientRef: e.target.value })} />
          </Field>
          <div className="text-sm sm:pt-6">
            {d.invoice && (
              <>
                Invoice <InvLink i={d.invoice} /> ({d.invoice.status.toLowerCase()})
              </>
            )}
          </div>
        </div>
      </Card>
      <Card title="Quantities (cumulative)" bodyClass="p-0">
        {errors.lines && <p className="px-4 pt-3 text-xs text-red-600">{errors.lines}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">BoQ item</th>
                <th className="px-2 py-2 text-right">BoQ qty</th>
                <th className="px-2 py-2 text-right">Before</th>
                <th className="w-32 px-2 py-2 text-left">Cumulative now</th>
                <th className="px-2 py-2 text-right">This certificate</th>
                <th className="px-4 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.lines.map((l, i) => {
                const now = num(cum[l.boqItemId]);
                const pct = l.qty > 0 ? (now / l.qty) * 100 : 0;
                return (
                  <tr key={l.boqItemId} className="align-top">
                    <td className="px-4 py-2">
                      <span className="block font-medium">
                        {l.code} · {l.description}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {fmtMoney(l.unitPrice, 0)} / {l.unit}
                      </span>
                      {lineErr(i) && <span className="block text-xs text-red-600">{lineErr(i)}</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {fmtNumber(l.qty, 2)} {l.unit}
                    </td>
                    <td className="px-2 py-2 text-right">{fmtNumber(l.prevQty, 2)}</td>
                    <td className="px-2 py-2">
                      <NumberInput
                        disabled={!editable}
                        decimals={3}
                        min={0}
                        max={l.qty}
                        value={cum[l.boqItemId] ?? ''}
                        onChange={(v) => setCum({ ...cum, [l.boqItemId]: v })}
                        aria-label={`Cumulative ${l.code}`}
                      />
                      <span className="block text-xs text-slate-500">{fmtNumber(pct, 1)}%</span>
                    </td>
                    <td className="px-2 py-2 text-right">{fmtNumber(now - l.prevQty, 3)}</td>
                    <td className="px-4 py-2 text-right">{fmtMoney(r2((now - l.prevQty) * l.unitPrice), 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Termin">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-slate-500">Cumulative certified</dt>
          <dd className="text-right">{fmtMoney(editable ? preview.cumulative : d.cumulativeValue, 0)}</dd>
          <dt className="text-slate-500">Work this certificate</dt>
          <dd className="text-right">{fmtMoney(editable ? preview.work : d.thisValue, 0)}</dd>
          <dt className="text-slate-500">Advance recovered</dt>
          <dd className="text-right">− {fmtMoney(d.advanceRecovery, 0)}</dd>
          <dt className="text-slate-500">Retention {d.contract.retentionPct}%</dt>
          <dd className="text-right">− {fmtMoney(editable ? preview.retention : d.retention, 0)}</dd>
          <dt className="font-medium">Net (before PPN)</dt>
          <dd className="text-right font-medium">{fmtMoney(d.netAmount, 0)}</dd>
          {d.status === 'APPROVED' && (
            <>
              <dt className="text-slate-500">PPN on the invoice</dt>
              <dd className="text-right">{fmtMoney(d.ppn, 0)}</dd>
            </>
          )}
        </dl>
        {editable && <p className="mt-2 text-xs text-slate-500">The advance recovered and the net are worked out when you save.</p>}
      </Card>
      <Card title="Notes">
        <Textarea disabled={!editable} rows={2} value={h.notes} maxLength={2000} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </Card>
    </div>
  );
}

// ============================================================ subcontracts
interface Sub {
  id: string;
  contractId: string;
  supplierId: string;
  supplier: string | null;
  contractNo: string;
  contractTitle: string;
  contractStatus: string;
  scope: string;
  value: number;
  retentionPct: number;
  vat: boolean;
  pphRate: number;
  claimedPct: number;
  retentionHeld: number;
  status: string;
  notes: string | null;
  retentionRelease: Inv | null;
  claims: { id: string; number: string; date: string; prevPct: number; cumPct: number; thisValue: number; retention: number; netAmount: number; status: string; invoice: Inv | null }[];
}

export function SubcontractsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['construction', 'subcontracts'], queryFn: () => api.get<Sub[]>('/construction/subcontracts') });
  const [edit, setEdit] = useState<Sub | 'new' | null>(null);
  const [claim, setClaim] = useState<Sub | null>(null);
  const [release, setRelease] = useState<Sub | null>(null);
  const [c, setC] = useState({ date: isoDate(), cumPct: '', supplierRef: '' });
  const done = (m: string) => (toast.success(m), setClaim(null), setRelease(null), qc.invalidateQueries({ queryKey: ['construction'] }));
  const doClaim = useMutation({
    mutationFn: () => api.post<Sub & { invoice: { number: string; confirmed: boolean; reason?: string } }>(`/construction/subcontracts/${claim!.id}/claims`, c),
    onSuccess: (r) => done(r.invoice.confirmed ? `Claim invoiced: ${r.invoice.number}` : `Invoice ${r.invoice.number} kept as a draft: ${r.invoice.reason ?? ''}`),
    onError: (e) => toast.error(e),
  });
  const doRelease = useMutation({
    mutationFn: () => api.post(`/construction/subcontracts/${release!.id}/release`, { date: c.date, supplierRef: c.supplierRef }),
    onSuccess: () => done('Retention released'),
    onError: (e) => toast.error(e),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/construction/claims/${id}/cancel`), onSuccess: () => done('Claim cancelled'), onError: (e) => toast.error(e) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Subcontracts"
        subtitle="Subcontractor claims on their cumulative progress: a purchase invoice of the work less the retention we hold, charged to the project; withhold PPh final 4(2) when paying (PP 9/2022)"
        actions={
          can('construction.subcon') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New subcontract
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState icon="users" title="No subcontracts" />
        </Card>
      ) : (
        q.data.map((s) => (
          <Card key={s.id} bodyClass="p-0">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(s)}>
                <span className="block font-medium">
                  {s.supplier} · {s.scope}
                </span>
                <span className="block text-xs text-slate-500">
                  {s.contractNo} · {fmtMoney(s.value, 0)} · retention {s.retentionPct}% · PPh final {s.pphRate}% {s.vat ? '· PKP' : '· not PKP'}
                </span>
              </button>
              <span className="text-right text-xs">
                claimed {fmtNumber(s.claimedPct, 2)}%<span className="block text-slate-500">retention held {fmtMoney(s.retentionHeld, 0)}</span>
              </span>
              {s.status === 'ACTIVE' && s.claimedPct < 100 && can('construction.subcon') && (
                <Button size="sm" icon="file-plus" onClick={() => (setC({ date: isoDate(), cumPct: '', supplierRef: '' }), setClaim(s))}>
                  Claim
                </Button>
              )}
              {s.status === 'ACTIVE' && s.retentionHeld > 0 && s.contractStatus !== 'ACTIVE' && can('construction.subcon') && (
                <Button size="sm" variant="outline" icon="lock-open" onClick={() => (setC({ date: isoDate(), cumPct: '', supplierRef: '' }), setRelease(s))}>
                  Release retention
                </Button>
              )}
              <Badge tone={STATUS[s.status]?.tone ?? 'gray'}>{STATUS[s.status]?.label ?? s.status}</Badge>
            </div>
            {(s.claims.length > 0 || s.retentionRelease) && (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {s.claims.map((x, i) => (
                  <li key={x.id} className={`flex flex-wrap items-center gap-2 px-4 py-2 ${x.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                    <span className="min-w-0 flex-1">
                      {x.number} · {fmtDate(x.date)} · {fmtNumber(x.prevPct, 2)}% → {fmtNumber(x.cumPct, 2)}%
                      {x.invoice && (
                        <span className="text-xs">
                          {' '}
                          ·{' '}
                          <Link className="text-brand-600" to={`/documents/PI/${x.invoice.id}`}>
                            {x.invoice.number}
                          </Link>{' '}
                          ({x.invoice.status.toLowerCase()})
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500">
                      {fmtMoney(x.thisValue, 0)} − retention {fmtMoney(x.retention, 0)}
                    </span>
                    <span className="w-28 text-right">{fmtMoney(x.netAmount, 0)}</span>
                    {x.status === 'APPROVED' && i === s.claims.map((y) => y.status).lastIndexOf('APPROVED') && !s.retentionRelease && can('construction.subcon') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        aria-label="Cancel claim"
                        onClick={async () =>
                          (await confirm({ title: `Cancel ${x.number}?`, message: 'Its purchase invoice is cancelled (only while unpaid).', danger: true, confirmText: 'Cancel claim' })) &&
                          cancel.mutate(x.id)
                        }
                      />
                    )}
                  </li>
                ))}
                {s.retentionRelease && (
                  <li className="px-4 py-2">
                    Retention released ·{' '}
                    <Link className="text-brand-600" to={`/documents/PI/${s.retentionRelease.id}`}>
                      {s.retentionRelease.number}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Card>
        ))
      )}
      {edit && <SubcontractForm s={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['construction'] }))} />}
      {claim && (
        <Modal
          open
          onClose={() => setClaim(null)}
          title={`Claim · ${claim.supplier}`}
          footer={
            <Button icon="check" loading={doClaim.isPending} disabled={!c.cumPct} onClick={() => doClaim.mutate()}>
              Certify and invoice
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={c.date} clearable={false} onChange={(v) => setC({ ...c, date: v ?? isoDate() })} />
            </Field>
            <Field label="Cumulative progress %" required help={`${claim.claimedPct}% claimed before`}>
              <NumberInput decimals={2} min={0} max={100} value={c.cumPct} onChange={(v) => setC({ ...c, cumPct: v })} />
            </Field>
            <Field label="Subcontractor invoice no." className="sm:col-span-2">
              <Input value={c.supplierRef} maxLength={80} onChange={(e) => setC({ ...c, supplierRef: e.target.value })} />
            </Field>
          </div>
          {num(c.cumPct) > claim.claimedPct && (
            <p className="mt-2 text-sm">
              Work {fmtMoney(r2((claim.value * (num(c.cumPct) - claim.claimedPct)) / 100), 0)} − retention{' '}
              {fmtMoney(r2((((claim.value * (num(c.cumPct) - claim.claimedPct)) / 100) * claim.retentionPct) / 100), 0)}
              {claim.vat ? ' + PPN on the work' : ''}
            </p>
          )}
        </Modal>
      )}
      {release && (
        <Modal
          open
          onClose={() => setRelease(null)}
          title={`Release retention · ${release.supplier}`}
          footer={
            <Button icon="check" loading={doRelease.isPending} onClick={() => doRelease.mutate()}>
              Invoice the retention
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required>
              <DatePicker value={c.date} clearable={false} onChange={(v) => setC({ ...c, date: v ?? isoDate() })} />
            </Field>
            <Field label="Subcontractor invoice no.">
              <Input value={c.supplierRef} maxLength={80} onChange={(e) => setC({ ...c, supplierRef: e.target.value })} />
            </Field>
          </div>
          <p className="mt-2 text-sm">
            {fmtMoney(release.retentionHeld, 0)}
            {release.vat ? ' + PPN' : ''}: a purchase invoice to pay; the subcontract is then closed.
          </p>
        </Modal>
      )}
    </div>
  );
}

function SubcontractForm({ s, onClose, onSaved }: { s?: Sub; onClose: () => void; onSaved: () => void }) {
  const can = useSession((x) => x.can);
  const ro = !can('construction.subcon') || (s && s.status !== 'ACTIVE');
  const contracts = useQuery({ queryKey: ['construction', 'contracts', 'OPEN'], queryFn: () => api.get<ContractRow[]>('/construction/contracts') });
  const [f, setF] = useState({
    contractId: s?.contractId ?? '',
    supplierId: s?.supplierId ?? (null as string | null),
    scope: s?.scope ?? '',
    value: str(s?.value),
    retentionPct: str(s?.retentionPct ?? 5),
    vat: s?.vat ?? true,
    pphRate: str(s?.pphRate ?? 1.75),
    notes: s?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (s ? api.put(`/construction/subcontracts/${s.id}`, f) : api.post('/construction/subcontracts', f)),
    onSuccess: () => (toast.success('Subcontract saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={s ? `Subcontract · ${s.supplier}` : 'New subcontract'}
      footer={
        !ro && (
          <Button icon="check" loading={save.isPending} disabled={!f.contractId || !f.supplierId || !f.value} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contract" required error={errors.contractId}>
          <Select
            disabled={ro}
            value={f.contractId}
            placeholder="Choose"
            onChange={(e) => setF({ ...f, contractId: e.target.value })}
            options={(contracts.data ?? []).map((c) => ({ value: c.id, label: `${c.contractNo} · ${c.title}` }))}
          />
        </Field>
        <Field label="Subcontractor" required error={errors.supplierId}>
          <AsyncSelect disabled={ro} resource="suppliers" value={f.supplierId} initialLabel={s?.supplier ?? undefined} onChange={(v) => setF({ ...f, supplierId: v })} />
        </Field>
        <Field label="Scope" required className="sm:col-span-2">
          <Input disabled={ro} value={f.scope} maxLength={300} onChange={(e) => setF({ ...f, scope: e.target.value })} />
        </Field>
        <Field label="Value (before PPN)" required error={errors.value}>
          <NumberInput disabled={ro} decimals={2} min={0} value={f.value} onChange={(v) => setF({ ...f, value: v })} />
        </Field>
        <Field label="Retention %">
          <NumberInput disabled={ro} decimals={2} min={0} max={20} value={f.retentionPct} onChange={(v) => setF({ ...f, retentionPct: v })} />
        </Field>
        <Field label="PPh final 4(2) to withhold" help="By the subcontractor's SBU (PP 9/2022)">
          <Select
            disabled={ro}
            value={f.pphRate}
            onChange={(e) => setF({ ...f, pphRate: e.target.value })}
            options={[
              { value: '1.75', label: '1.75% work, SBU small / SKK' },
              { value: '2.65', label: '2.65% work, SBU medium / large, or integrated' },
              { value: '4', label: '4% work / integrated without SBU' },
              { value: '3.5', label: '3.5% consultancy with SBU / SKK' },
              { value: '6', label: '6% consultancy without SBU' },
            ]}
          />
        </Field>
        <div className="pt-6 text-sm">
          <Checkbox disabled={ro} checked={f.vat} onChange={(v) => setF({ ...f, vat: v })} label="Subcontractor is a PKP (charges PPN)" />
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea disabled={ro} rows={2} value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ PPh final 4(2)
interface FinalTax {
  period: string;
  depositBy: string;
  rows: {
    paymentId: string;
    payment: string;
    date: string;
    contractNo: string;
    invoice: string;
    allocated: number;
    base: number;
    rate: number;
    due: number;
    withheld: number;
    slipNo: string | null;
    selfPay: number;
  }[];
  totals: { base: number; due: number; withheld: number; selfPay: number; booked: number; toBook: number };
  booked: { id: string; amount: number; base: number; createdAt: string }[];
  subcontractors: { payment: string; date: string; supplier: string | null; base: number; rate: number; amount: number; slipNo: string | null }[];
}

export function FinalTaxPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [period, setPeriod] = useState(isoDate().slice(0, 7));
  const q = useQuery({ queryKey: ['construction', 'final-tax', period], queryFn: () => api.get<FinalTax>('/construction/final-tax', { period }) });
  const book = useMutation({
    mutationFn: () => api.post(`/construction/final-tax/${period}/book`),
    onSuccess: () => (toast.success('Booked'), qc.invalidateQueries({ queryKey: ['construction', 'final-tax'] })),
    onError: (e) => toast.error(e),
  });
  const unbook = useMutation({
    mutationFn: (id: string) => api.post(`/construction/final-tax/self-pay/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled'), qc.invalidateQueries({ queryKey: ['construction', 'final-tax'] })),
    onError: (e) => toast.error(e),
  });
  const t = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="PPh Final 4(2) · Construction"
        subtitle="Due on each payment received for construction work, before PPN (PP 9/2022): withheld by the client (bukti potong) or paid by us; and what we withheld from subcontractors"
        actions={
          <div className="w-44">
            <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Month" />
          </div>
        }
      />
      {q.isLoading || !t ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">Payments received (before PPN)</span>
              <span className="block text-lg font-semibold">{fmtMoney(t.totals.base, 0)}</span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">PPh final due</span>
              <span className="block text-lg font-semibold">{fmtMoney(t.totals.due, 0)}</span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">Withheld by clients</span>
              <span className="block text-lg font-semibold">{fmtMoney(t.totals.withheld, 0)}</span>
            </Card>
            <Card bodyClass="px-4 py-3 text-sm">
              <span className="block text-xs text-slate-500">To pay ourselves by {fmtDate(t.depositBy)}</span>
              <span className="block text-lg font-semibold">{fmtMoney(t.totals.selfPay, 0)}</span>
              <span className="block text-xs text-slate-500">booked {fmtMoney(t.totals.booked, 0)}</span>
            </Card>
          </div>
          <Card
            title="Payments received"
            bodyClass="p-0"
            actions={
              t.totals.toBook > 0 &&
              can('construction.tax') && (
                <Button
                  size="sm"
                  icon="check"
                  loading={book.isPending}
                  onClick={async () =>
                    (await confirm({
                      title: `Book ${fmtMoney(t.totals.toBook, 0)}?`,
                      message: 'Dr Final Income Tax - Construction / Cr PPh 4(2) Payable, at the end of the month; pay it with a billing code by the 15th.',
                      confirmText: 'Book',
                    })) && book.mutate()
                  }
                >
                  Book {fmtMoney(t.totals.toBook, 0)} to pay
                </Button>
              )
            }
          >
            {!t.rows.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">No payments on construction invoices this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Payment</th>
                      <th className="px-2 py-2 text-left">Contract / invoice</th>
                      <th className="px-2 py-2 text-right">Base</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                      <th className="px-2 py-2 text-right">Due</th>
                      <th className="px-4 py-2 text-right">Withheld / to pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {t.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">
                          {r.payment}
                          <span className="block text-xs text-slate-500">{fmtDate(r.date)}</span>
                        </td>
                        <td className="px-2 py-2">
                          {r.contractNo}
                          <span className="block text-xs text-slate-500">{r.invoice}</span>
                        </td>
                        <td className="px-2 py-2 text-right">{fmtMoney(r.base, 0)}</td>
                        <td className="px-2 py-2 text-right">{r.rate}%</td>
                        <td className="px-2 py-2 text-right">{fmtMoney(r.due, 0)}</td>
                        <td className="px-4 py-2 text-right">
                          {r.withheld > 0 ? `withheld ${fmtMoney(r.withheld, 0)}${r.slipNo ? ` (${r.slipNo})` : ''}` : <span className="text-amber-700">to pay {fmtMoney(r.selfPay, 0)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {t.booked.length > 0 && (
              <ul className="divide-y divide-line border-t border-line text-sm">
                {t.booked.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="flex-1">
                      Booked {fmtMoney(b.amount, 0)} on a base of {fmtMoney(b.base, 0)}
                    </span>
                    {can('construction.tax') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        aria-label="Cancel booking"
                        onClick={async () => (await confirm({ title: 'Cancel this booking?', message: 'The journal is voided.', danger: true, confirmText: 'Cancel booking' })) && unbook.mutate(b.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Withheld from subcontractors" bodyClass="p-0">
            {!t.subcontractors.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">None this month. Choose the construction PPh 4(2) on the supplier payment to withhold it.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {t.subcontractors.map((x, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      {x.payment} · {fmtDate(x.date)} · {x.supplier}
                      {x.slipNo ? ` · ${x.slipNo}` : ''}
                    </span>
                    <span className="text-xs text-slate-500">
                      {x.rate}% of {fmtMoney(x.base, 0)}
                    </span>
                    <span className="w-28 text-right">{fmtMoney(x.amount, 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
