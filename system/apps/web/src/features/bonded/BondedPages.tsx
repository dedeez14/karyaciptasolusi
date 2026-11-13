import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfMonth = () => isoDate().slice(0, 8) + '01';
const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'amber' },
  REGISTERED: { label: 'Registered', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'gray' },
};
const DUTY: Record<string, string> = { SUSPENDED: 'Suspended / not collected', PAYABLE: 'Paid by us (journal)', GUARANTEE: 'Covered by a guarantee' };
const CLASS_LABEL: Record<string, string> = {
  RAW: 'Raw materials',
  AUX: 'Auxiliary materials',
  FG: 'Finished goods',
  CAPITAL: 'Capital goods / machines',
  RND: 'R&D goods',
  FUEL: 'Fuel',
  OFFICE: 'Office equipment',
  SCRAP: 'Scrap / waste',
};
const short = (code: string) => code.replace(/^BC(\d)(\d)(\d?)$/, (_, a, b, c) => `BC ${a}.${b}${c ? `.${c}` : ''}`);

interface BcType {
  code: string;
  label: string;
  dirs: ('IN' | 'OUT')[];
  duty: string;
  faktur?: string;
}
interface Meta {
  types: BcType[];
  classes: string[];
}
const useMeta = () => useQuery({ queryKey: ['bonded', 'meta'], queryFn: () => api.get<Meta>('/bonded/meta'), staleTime: Infinity });

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${tone ?? ''}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
function Period({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="w-40">
        <DatePicker value={from} clearable={false} onChange={(v) => setFrom(v ?? firstOfMonth())} aria-label="From" />
      </div>
      <div className="w-40">
        <DatePicker value={to} clearable={false} onChange={(v) => setTo(v ?? isoDate())} aria-label="To" />
      </div>
    </div>
  );
}

// ============================================================ documents
interface DocRow {
  id: string;
  number: string;
  bcType: string;
  typeLabel: string;
  direction: 'IN' | 'OUT';
  facility: string;
  destination: string | null;
  ajuNo: string | null;
  registrationNo: string | null;
  registrationDate: string | null;
  officeCode: string | null;
  tradeDocumentId: string | null;
  receiptNumber: string | null;
  receiptDate: string | null;
  partnerName: string | null;
  supplierId: string | null;
  customerId: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalValue: number;
  totalValueIdr: number;
  dutyBasis: string | null;
  bm: number;
  ppn: number;
  ppnbm: number;
  pph22: number;
  fine: number;
  dutyStatus: string;
  ppnCreditable: boolean;
  returnDueDate: string | null;
  linkedId: string | null;
  kiteDueDate: string | null;
  taxInvoiceCode: string | null;
  status: string;
  notes: string | null;
  lineCount?: number;
}
interface Line {
  id: string;
  lineNo: number;
  productId: string;
  hsCode: string | null;
  description: string | null;
  qty: number;
  uom: string | null;
  value: number;
  valueIdr: number;
  originCountry: string | null;
  wastePct: number | null;
  settledQty: number;
  product: { code: string; name: string; customsClass: string | null } | null;
}
interface DocDetail extends DocRow {
  trade: { id: string; docType: string; number: string; date: string } | null;
  linked: { id: string; number: string; bcType: string; registrationNo: string | null } | null;
  returns: { id: string; number: string; registrationNo: string | null; registrationDate: string | null; status: string }[];
  lines: Line[];
  allocations: {
    id: string;
    kind: string;
    qty: number;
    product: { code: string; name: string } | null;
    source: { lineNo: number; document: { id: string; number: string; bcType: string; registrationNo: string | null } } | null;
    target: { id: string; number: string; bcType: string; registrationNo: string | null } | null;
    sourceLineId: string;
  }[];
}

export function DocumentsPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const meta = useMeta();
  const [f, setF] = useState({ bcType: '', direction: '', status: '', q: '' });
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['bonded', 'documents', f],
    queryFn: () => api.get<DocRow[]>('/bonded/documents', { bcType: f.bcType || undefined, direction: f.direction || undefined, status: f.status || undefined, q: f.q || undefined }),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Customs Documents (BC)"
        subtitle="Every movement in or out of the bonded zone carries its customs document; prepare it from the goods receipt or delivery, then enter the registration number"
        actions={
          can('bonded.document.manage') && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              New document
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <div className="w-64">
          <Select
            value={f.bcType}
            onChange={(e) => setF({ ...f, bcType: e.target.value })}
            placeholder="All types"
            options={(meta.data?.types ?? []).map((t) => ({ value: t.code, label: t.label }))}
          />
        </div>
        <div className="w-32">
          <Select
            value={f.direction}
            onChange={(e) => setF({ ...f, direction: e.target.value })}
            placeholder="In & out"
            options={[
              { value: 'IN', label: 'In' },
              { value: 'OUT', label: 'Out' },
            ]}
          />
        </div>
        <div className="w-36">
          <Select
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
            placeholder="Any status"
            options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))}
          />
        </div>
        <div className="w-60">
          <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Number, registration, aju, partner" aria-label="Search" />
        </div>
      </div>
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="file-stack" title="No customs documents" description="Confirm the goods receipt or delivery first, then make its BC document here" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Document</th>
                  <th className="px-2 py-2 text-left">Registration</th>
                  <th className="px-2 py-2 text-left">Stock document</th>
                  <th className="px-2 py-2 text-left">Partner</th>
                  <th className="px-2 py-2 text-right">Value (Rp)</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/bonded/documents/${d.id}`)}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="font-medium">{short(d.bcType)}</span> {d.direction === 'IN' ? 'in' : 'out'}
                      {d.facility === 'KITE' && (
                        <span className="ml-1">
                          <Badge tone="blue">KITE</Badge>
                        </span>
                      )}
                      <span className="block text-xs text-slate-500">{d.number}</span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{d.registrationNo ? `${d.registrationNo} · ${fmtDate(d.registrationDate!)}` : <span className="text-slate-400">-</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{d.receiptNumber ?? <span className="text-slate-400">-</span>}</td>
                    <td className="max-w-[16rem] truncate px-2 py-2">{d.partnerName ?? '-'}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{fmtMoney(d.totalValueIdr, 0)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewDocument onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), navigate(`/bonded/documents/${id}`))} />}
    </div>
  );
}

function NewDocument({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const meta = useMeta();
  const [f, setF] = useState({
    bcType: 'BC23',
    direction: 'IN' as 'IN' | 'OUT',
    facility: 'KB',
    tradeDocumentId: '',
    destination: '',
    ajuNo: '',
    officeCode: '',
    partnerName: '',
    currencyCode: 'IDR',
    exchangeRate: '1',
    dutyBasis: 'FG',
    returnDueDate: '',
    linkedId: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const type = meta.data?.types.find((t) => t.code === f.bcType);
  const cands = useQuery({
    queryKey: ['bonded', 'candidates', f.direction],
    queryFn: () =>
      api.get<{ id: string; docType: string; number: string; date: string; partner: string | null; grandTotal: number; currencyCode: string }[]>('/bonded/candidates', { direction: f.direction }),
  });
  const outs = useQuery({
    queryKey: ['bonded', 'documents', 'bc261'],
    queryFn: () => api.get<DocRow[]>('/bonded/documents', { bcType: 'BC261', status: 'REGISTERED' }),
    enabled: f.bcType === 'BC262',
  });
  const setType = (code: string) => {
    const t = meta.data?.types.find((x) => x.code === code);
    setF({
      ...f,
      bcType: code,
      direction: t?.dirs[0] ?? 'IN',
      facility: code === 'BC20' || code === 'BC24' ? 'KITE' : f.facility === 'KITE' && t?.dirs[0] === 'IN' && code !== 'BC23' ? 'KB' : f.facility,
      tradeDocumentId: '',
      destination: '',
      linkedId: '',
    });
  };
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/bonded/documents', {
        ...f,
        tradeDocumentId: f.tradeDocumentId || null,
        destination: f.destination || null,
        dutyBasis: f.bcType === 'BC25' ? f.dutyBasis : null,
        returnDueDate: f.returnDueDate || null,
        linkedId: f.linkedId || null,
        exchangeRate: f.currencyCode === 'IDR' ? 1 : f.exchangeRate,
      }),
    onSuccess: (r) => (toast.success('Customs document prepared: check the lines and values'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New customs document"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.tradeDocumentId && f.bcType !== 'BC261' && f.bcType !== 'BC262' && f.bcType !== 'BC24'} onClick={() => save.mutate()}>
          Prepare
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Document type" required className="sm:col-span-2" error={errors.bcType}>
          <Select value={f.bcType} onChange={(e) => setType(e.target.value)} options={(meta.data?.types ?? []).map((t) => ({ value: t.code, label: t.label }))} />
        </Field>
        {type && type.dirs.length > 1 && (
          <Field label="Direction" required error={errors.direction}>
            <Select
              value={f.direction}
              onChange={(e) => setF({ ...f, direction: e.target.value as 'IN' | 'OUT', tradeDocumentId: '' })}
              options={[
                { value: 'IN', label: 'In (from another bonded zone)' },
                { value: 'OUT', label: 'Out (to another bonded zone)' },
              ]}
            />
          </Field>
        )}
        <Field label="Facility" required error={errors.facility} help="KITE: imports exempted for export production (PMK 149/2022)">
          <Select
            value={f.facility}
            onChange={(e) => setF({ ...f, facility: e.target.value })}
            options={[
              { value: 'KB', label: 'Bonded zone (KB)' },
              { value: 'KITE', label: 'KITE' },
            ]}
          />
        </Field>
        <Field
          label={f.direction === 'IN' ? 'Goods receipt / stock document' : 'Delivery / stock document'}
          required={!['BC261', 'BC262', 'BC24'].includes(f.bcType)}
          className="sm:col-span-2"
          error={errors.tradeDocumentId}
          help="Its lines, quantities and values are taken over; the number and date become the receipt / release proof"
        >
          <Select
            value={f.tradeDocumentId}
            onChange={(e) => {
              const c = cands.data?.find((x) => x.id === e.target.value);
              setF({ ...f, tradeDocumentId: e.target.value, partnerName: c?.partner ?? f.partnerName });
            }}
            placeholder={cands.isLoading ? 'Loading...' : cands.data?.length ? 'Choose' : 'No confirmed stock document without a BC document'}
            options={(cands.data ?? []).map((c) => ({ value: c.id, label: `${c.number} · ${fmtDate(c.date)}${c.partner ? ` · ${c.partner}` : ''}` }))}
          />
        </Field>
        {f.bcType === 'BC262' && (
          <Field label="Back from BC 2.6.1" required className="sm:col-span-2" error={errors.linkedId}>
            <Select
              value={f.linkedId}
              onChange={(e) => setF({ ...f, linkedId: e.target.value })}
              placeholder="Choose"
              options={(outs.data ?? []).map((d) => ({ value: d.id, label: `${d.registrationNo} · ${fmtDate(d.registrationDate!)} · ${d.partnerName ?? ''}` }))}
            />
          </Field>
        )}
        {(f.bcType === 'BC25' || (f.bcType === 'BC27' && f.direction === 'OUT')) && (
          <Field label="Destination" help="Counts for the domestic quota: TLDDP uses it, FTZ / KEK / other bonded zones add to the realisation">
            <Select
              value={f.destination}
              onChange={(e) => setF({ ...f, destination: e.target.value })}
              placeholder={f.bcType === 'BC25' ? 'Domestic area (TLDDP)' : 'Bonded zone'}
              options={[
                { value: 'TLDDP', label: 'Domestic area (TLDDP)' },
                { value: 'FTZ', label: 'Free trade zone (FTZ)' },
                { value: 'KEK', label: 'Special economic zone (KEK)' },
                { value: 'KB', label: 'Other bonded zone' },
              ]}
            />
          </Field>
        )}
        {f.bcType === 'BC25' && (
          <Field label="Duty basis" help="PMK 131 Art. 29: the selling price of the finished goods; raw-material values only when the conversion is clear and the goods were already sold at entry">
            <Select
              value={f.dutyBasis}
              onChange={(e) => setF({ ...f, dutyBasis: e.target.value })}
              options={[
                { value: 'FG', label: 'Finished goods (selling price)' },
                { value: 'RAW', label: 'Raw materials at entry' },
              ]}
            />
          </Field>
        )}
        {f.bcType === 'BC261' && (
          <Field label="Return deadline" help="Set by the customs office (for subcontracts: the subcontract agreement)">
            <DatePicker value={f.returnDueDate} onChange={(v) => setF({ ...f, returnDueDate: v ?? '' })} />
          </Field>
        )}
        <Field label="Partner (as on the document)" error={errors.partnerName}>
          <Input value={f.partnerName} maxLength={200} onChange={(e) => setF({ ...f, partnerName: e.target.value })} />
        </Field>
        <Field label="Aju number">
          <Input value={f.ajuNo} maxLength={30} onChange={(e) => setF({ ...f, ajuNo: e.target.value })} />
        </Field>
        <Field label="Customs office code">
          <Input value={f.officeCode} maxLength={8} onChange={(e) => setF({ ...f, officeCode: e.target.value })} />
        </Field>
        <Field label="Currency" help="Empty / IDR = the stock document's currency">
          <Input value={f.currencyCode} maxLength={3} onChange={(e) => setF({ ...f, currencyCode: e.target.value.toUpperCase() })} />
        </Field>
        {f.currencyCode !== 'IDR' && (
          <Field label="Exchange rate (KMK)" required>
            <NumberInput decimals={2} min={0} value={f.exchangeRate} onChange={(v) => setF({ ...f, exchangeRate: v })} />
          </Field>
        )}
      </div>
      {['BC261', 'BC262', 'BC24'].includes(f.bcType) && !f.tradeDocumentId && <p className="mt-3 text-xs text-slate-500">Without a stock document, add the goods on the next screen.</p>}
    </Modal>
  );
}

export function DocumentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'edit' | 'register'>('');
  const q = useQuery({ queryKey: ['bonded', 'document', id], queryFn: () => api.get<DocDetail>(`/bonded/documents/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['bonded'] }));
  const cancel = useMutation({
    mutationFn: () => api.post(`/bonded/documents/${id}/cancel`),
    onSuccess: () => (toast.success('Customs document cancelled'), refresh()),
    onError: (e) => toast.error(e),
  });
  const settle = useMutation({
    mutationFn: () => api.post<{ allocations: number; unallocated: number }>(`/bonded/documents/${id}/kite-settle`),
    onSuccess: (r) => (toast.success(`Charged to the KITE imports (${r.allocations} lines)${r.unallocated ? `; ${r.unallocated} not covered by KITE imports` : ''}`), refresh()),
    onError: (e) => toast.error(e),
  });
  const release = useMutation({
    mutationFn: () => api.post(`/bonded/documents/${id}/kite-release`),
    onSuccess: () => (toast.success('KITE charge released'), refresh()),
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  if (q.isLoading || !d) return <Loading />;
  const kiteOut = d.facility === 'KITE' && d.direction === 'OUT' && d.status === 'REGISTERED';
  const charged = d.allocations.some((a) => a.kind === 'KITE' && a.target?.id === d.id);
  const duties = d.bm + d.ppn + d.ppnbm + d.pph22 + d.fine;
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/bonded/documents')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.typeLabel} <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            {d.facility === 'KITE' && <Badge tone="blue">KITE</Badge>}
          </span>
        }
        subtitle={`${d.number}${d.registrationNo ? ` · registration ${d.registrationNo} of ${fmtDate(d.registrationDate!)}` : ''}${d.partnerName ? ` · ${d.partnerName}` : ''}`}
        actions={
          <>
            {d.status === 'DRAFT' && can('bonded.document.manage') && (
              <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                Lines & values
              </Button>
            )}
            {d.status === 'DRAFT' && can('bonded.register') && (
              <Button icon="stamp" onClick={() => setModal('register')}>
                Register
              </Button>
            )}
            {kiteOut && !charged && can('bonded.kite') && (
              <Button icon="link" loading={settle.isPending} onClick={() => settle.mutate()}>
                Charge to KITE imports
              </Button>
            )}
            {kiteOut && charged && can('bonded.kite') && (
              <Button variant="outline" icon="unlink" loading={release.isPending} onClick={() => release.mutate()}>
                Release KITE charge
              </Button>
            )}
            {d.status !== 'CANCELLED' && can('bonded.register') && (
              <Button
                variant="ghost"
                icon="x"
                onClick={async () =>
                  (await confirm({
                    title: `Cancel ${d.number}?`,
                    message: d.status === 'REGISTERED' && d.dutyStatus === 'PAYABLE' && duties > 0 ? 'The duty journal is voided too.' : undefined,
                    danger: true,
                    confirmText: 'Cancel document',
                  })) && cancel.mutate()
                }
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={d.direction === 'IN' ? 'Received on' : 'Released on'}
          value={d.trade ? d.trade.number : (d.receiptNumber ?? '-')}
          hint={d.receiptDate ? fmtDate(d.receiptDate) : 'no stock document'}
        />
        <Stat
          label="Value"
          value={`${d.currencyCode} ${fmtNumber(d.totalValue, 2)}`}
          hint={d.currencyCode !== 'IDR' ? `Rp ${fmtNumber(d.totalValueIdr, 0)} at ${fmtNumber(d.exchangeRate, 2)}` : undefined}
        />
        <Stat label="Duties & taxes" value={fmtMoney(duties, 0)} hint={DUTY[d.dutyStatus]} />
        <Stat
          label={d.kiteDueDate ? 'KITE period ends' : d.returnDueDate ? 'Return deadline' : 'Aju / office'}
          value={d.kiteDueDate ? fmtDate(d.kiteDueDate) : d.returnDueDate ? fmtDate(d.returnDueDate) : (d.ajuNo ?? '-')}
          hint={d.kiteDueDate ? 'BCL.KT01 due 60 days later' : (d.officeCode ?? undefined)}
        />
      </div>
      <Card title="Goods" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Serial</th>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-left">HS</th>
                <th className="px-2 py-2 text-right">Quantity</th>
                <th className="px-2 py-2 text-right">Value ({d.currencyCode})</th>
                <th className="px-2 py-2 text-right">Rupiah</th>
                <th className="px-4 py-2 text-right">{d.facility === 'KITE' && d.direction === 'IN' ? 'Charged to exports' : d.bcType === 'BC261' ? 'Back' : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2">{l.lineNo}</td>
                  <td className="px-2 py-2">
                    {l.product?.code} · {l.description || l.product?.name}
                    {!l.product?.customsClass && <span className="block text-xs text-amber-600">No IT Inventory class on the product</span>}
                  </td>
                  <td className="px-2 py-2">{l.hsCode ?? '-'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {num(l.qty, 4)} {l.uom}
                  </td>
                  <td className="px-2 py-2 text-right">{num(l.value)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(l.valueIdr, 0)}</td>
                  <td className="px-4 py-2 text-right">
                    {(d.facility === 'KITE' && d.direction === 'IN') || d.bcType === 'BC261' ? `${num(l.settledQty, 4)}${l.wastePct !== null ? ` · waste ${l.wastePct}%` : ''}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Duties and taxes" subtitle={DUTY[d.dutyStatus]}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[
              ['Import duty (BM)', d.bm],
              [`Import PPN${d.ppnCreditable ? '' : ' (not creditable)'}`, d.ppn],
              ['PPnBM', d.ppnbm],
              ['PPh 22 import', d.pph22],
              ['Fine', d.fine],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd>{fmtMoney(v as number, 0)}</dd>
              </div>
            ))}
            {d.dutyBasis && (
              <div>
                <dt className="text-xs text-slate-500">Duty basis</dt>
                <dd>{d.dutyBasis === 'FG' ? 'Finished goods (selling price)' : 'Raw materials at entry'}</dd>
              </div>
            )}
            {d.taxInvoiceCode && (
              <div>
                <dt className="text-xs text-slate-500">Tax invoice code</dt>
                <dd>{d.taxInvoiceCode}</dd>
              </div>
            )}
            {d.destination && (
              <div>
                <dt className="text-xs text-slate-500">Destination</dt>
                <dd>{d.destination}</dd>
              </div>
            )}
          </dl>
          {d.notes && <p className="mt-3 text-sm whitespace-pre-line text-slate-600">{d.notes}</p>}
        </Card>
        <Card title="Links">
          <ul className="space-y-1.5 text-sm">
            {d.linked && (
              <li>
                Back from{' '}
                <Link className="text-brand-600" to={`/bonded/documents/${d.linked.id}`}>
                  {short(d.linked.bcType)} {d.linked.registrationNo}
                </Link>
              </li>
            )}
            {d.returns.map((r) => (
              <li key={r.id}>
                Returned on{' '}
                <Link className="text-brand-600" to={`/bonded/documents/${r.id}`}>
                  BC 2.6.2 {r.registrationNo ?? r.number}
                </Link>{' '}
                ({STATUS[r.status].label})
              </li>
            ))}
            {d.allocations.map((a) =>
              a.target?.id === d.id ? (
                <li key={a.id}>
                  {a.product?.code}: {num(a.qty, 4)} from{' '}
                  {a.source && (
                    <Link className="text-brand-600" to={`/bonded/documents/${a.source.document.id}`}>
                      {short(a.source.document.bcType)} {a.source.document.registrationNo} serial {a.source.lineNo}
                    </Link>
                  )}
                </li>
              ) : (
                <li key={a.id}>
                  {a.product?.code}: {num(a.qty, 4)} {a.kind === 'KITE' ? 'charged to' : 'back on'}{' '}
                  {a.target && (
                    <Link className="text-brand-600" to={`/bonded/documents/${a.target.id}`}>
                      {short(a.target.bcType)} {a.target.registrationNo}
                    </Link>
                  )}
                </li>
              ),
            )}
            {!d.linked && !d.returns.length && !d.allocations.length && (
              <li className="text-slate-500">{kiteOut ? 'Charge it to the KITE imports: materials by the bill of materials of each product, oldest import first.' : 'No linked customs documents.'}</li>
            )}
          </ul>
        </Card>
      </div>
      {modal === 'edit' && <EditLines d={d} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'register' && <RegisterModal d={d} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function EditLines({ d, onClose, onDone }: { d: DocDetail; onClose: () => void; onDone: () => void }) {
  const [h, setH] = useState({
    partnerName: d.partnerName ?? '',
    ajuNo: d.ajuNo ?? '',
    officeCode: d.officeCode ?? '',
    currencyCode: d.currencyCode,
    exchangeRate: String(d.exchangeRate),
    taxInvoiceCode: d.taxInvoiceCode ?? '',
    returnDueDate: d.returnDueDate ?? '',
    notes: d.notes ?? '',
  });
  const [lines, setLines] = useState(
    d.lines.map((l) => ({
      productId: l.productId as string | null,
      productName: l.product ? `${l.product.code} - ${l.product.name}` : '',
      hsCode: l.hsCode ?? '',
      description: l.description ?? '',
      qty: String(l.qty),
      uom: l.uom ?? '',
      value: String(l.value),
      originCountry: l.originCountry ?? '',
      wastePct: l.wastePct === null ? '' : String(l.wastePct),
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const kiteIn = d.facility === 'KITE' && d.direction === 'IN';
  const total = lines.reduce((a, l) => a + Number(l.value || 0), 0);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/bonded/documents/${d.id}`, {
        bcType: d.bcType,
        direction: d.direction,
        facility: d.facility,
        destination: d.destination,
        dutyBasis: d.dutyBasis,
        linkedId: d.linkedId,
        ...h,
        returnDueDate: h.returnDueDate || null,
        exchangeRate: h.currencyCode === 'IDR' ? 1 : h.exchangeRate,
        lines: lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ ...l, wastePct: l.wastePct === '' ? null : l.wastePct })),
      }),
    onSuccess: () => (toast.success('Saved'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={`${d.number}: lines and values`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save ({h.currencyCode} {fmtNumber(total, 2)})
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Partner" className="col-span-2">
          <Input value={h.partnerName} maxLength={200} onChange={(e) => setH({ ...h, partnerName: e.target.value })} />
        </Field>
        <Field label="Aju number">
          <Input value={h.ajuNo} maxLength={30} onChange={(e) => setH({ ...h, ajuNo: e.target.value })} />
        </Field>
        <Field label="Office code">
          <Input value={h.officeCode} maxLength={8} onChange={(e) => setH({ ...h, officeCode: e.target.value })} />
        </Field>
        <Field label="Currency">
          <Input value={h.currencyCode} maxLength={3} onChange={(e) => setH({ ...h, currencyCode: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Exchange rate">
          <NumberInput decimals={2} min={0} disabled={h.currencyCode === 'IDR'} value={h.currencyCode === 'IDR' ? '1' : h.exchangeRate} onChange={(v) => setH({ ...h, exchangeRate: v })} />
        </Field>
        <Field label="Tax invoice code" help="07 PPN not collected, 01 collected">
          <Input value={h.taxInvoiceCode} maxLength={2} onChange={(e) => setH({ ...h, taxInvoiceCode: e.target.value })} />
        </Field>
        {d.bcType === 'BC261' && (
          <Field label="Return deadline">
            <DatePicker value={h.returnDueDate} onChange={(v) => setH({ ...h, returnDueDate: v ?? '' })} />
          </Field>
        )}
      </div>
      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-sm font-medium">Goods (serials in this order)</span>
        <Button
          size="sm"
          variant="outline"
          icon="plus"
          onClick={() => setLines([...lines, { productId: null, productName: '', hsCode: '', description: '', qty: '', uom: '', value: '', originCountry: '', wastePct: '' }])}
        >
          Line
        </Button>
      </div>
      {errors.lines && <p className="mb-1 text-xs text-red-600">{errors.lines}</p>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className={`grid gap-2 ${kiteIn ? 'grid-cols-[minmax(0,1fr)_6rem_6.5rem_4.5rem_8rem_4rem_4.5rem_2.5rem]' : 'grid-cols-[minmax(0,1fr)_6rem_6.5rem_4.5rem_8rem_4rem_2.5rem]'}`}>
            <AsyncSelect
              resource="products"
              value={l.productId}
              initialLabel={l.productName || undefined}
              onChange={(v, o) => set(i, { productId: v, productName: o?.label ?? '' })}
              aria-label="Item"
            />
            <Input value={l.hsCode} maxLength={12} placeholder="HS" onChange={(e) => set(i, { hsCode: e.target.value })} aria-label="HS code" />
            <NumberInput decimals={4} min={0} value={l.qty} placeholder="Qty" onChange={(v) => set(i, { qty: v })} aria-label="Quantity" />
            <Input value={l.uom} maxLength={20} placeholder="Unit" onChange={(e) => set(i, { uom: e.target.value })} aria-label="Unit" />
            <NumberInput decimals={2} min={0} value={l.value} placeholder="Value" onChange={(v) => set(i, { value: v })} aria-label="Value" />
            <Input value={l.originCountry} maxLength={3} placeholder="Origin" onChange={(e) => set(i, { originCountry: e.target.value.toUpperCase() })} aria-label="Origin country" />
            {kiteIn && <NumberInput decimals={2} min={0} max={100} value={l.wastePct} placeholder="Waste %" onChange={(v) => set(i, { wastePct: v })} aria-label="Waste %" />}
            <Button variant="ghost" size="icon" icon="x" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function RegisterModal({ d, onClose, onDone }: { d: DocDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    registrationNo: '',
    registrationDate: isoDate(),
    ajuNo: d.ajuNo ?? '',
    officeCode: d.officeCode ?? '',
    bm: '',
    ppn: '',
    ppnbm: '',
    pph22: '',
    fine: '',
    dutyStatus: d.dutyStatus,
    ppnCreditable: d.facility !== 'KITE' || d.bcType !== 'BC24',
    kiteDueDate: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = ['bm', 'ppn', 'ppnbm', 'pph22', 'fine'].reduce((a, k) => a + Number(f[k as 'bm'] || 0), 0);
  const save = useMutation({
    mutationFn: () => api.post(`/bonded/documents/${d.id}/register`, { ...f, kiteDueDate: f.kiteDueDate || null }),
    onSuccess: () => (toast.success(f.dutyStatus === 'PAYABLE' && total > 0 ? `Registered: ${fmtMoney(total, 0)} booked to Import Duties & Taxes Payable` : 'Registered'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Register ${d.typeLabel}`}
      footer={
        <Button icon="stamp" loading={save.isPending} disabled={!f.registrationNo} onClick={() => save.mutate()}>
          Register
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Registration number" required error={errors.registrationNo}>
          <Input value={f.registrationNo} maxLength={20} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} />
        </Field>
        <Field label="Registration date" required error={errors.registrationDate}>
          <DatePicker value={f.registrationDate} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, registrationDate: v ?? isoDate() })} />
        </Field>
        <Field label="Aju number">
          <Input value={f.ajuNo} maxLength={30} onChange={(e) => setF({ ...f, ajuNo: e.target.value })} />
        </Field>
        <Field label="Office code">
          <Input value={f.officeCode} maxLength={8} onChange={(e) => setF({ ...f, officeCode: e.target.value })} />
        </Field>
        <Field
          label="Duties and taxes"
          className="sm:col-span-2"
          help="Suspended / not collected: shown on the reports only. Paid by us: Dr import duty (expense), import PPN (input tax when creditable), PPh 22 (prepaid), fine / Cr Import Duties & Taxes Payable"
        >
          <Select value={f.dutyStatus} onChange={(e) => setF({ ...f, dutyStatus: e.target.value })} options={Object.entries(DUTY).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Import duty (BM)">
          <NumberInput decimals={0} min={0} value={f.bm} onChange={(v) => setF({ ...f, bm: v })} />
        </Field>
        <Field label="Import PPN">
          <NumberInput decimals={0} min={0} value={f.ppn} onChange={(v) => setF({ ...f, ppn: v })} />
        </Field>
        <Field label="PPnBM">
          <NumberInput decimals={0} min={0} value={f.ppnbm} onChange={(v) => setF({ ...f, ppnbm: v })} />
        </Field>
        <Field label="PPh 22 import">
          <NumberInput decimals={0} min={0} value={f.pph22} onChange={(v) => setF({ ...f, pph22: v })} />
        </Field>
        <Field label="Fine" help="E.g. 100% of BM for goods not returned from subcontract (PMK 131 Art. 34(4)) or unaccounted (UU Kepabeanan Art. 45(4))">
          <NumberInput decimals={0} min={0} value={f.fine} onChange={(v) => setF({ ...f, fine: v })} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.ppnCreditable} onChange={(e) => setF({ ...f, ppnCreditable: e.target.checked })} /> Import PPN can be credited
        </label>
        {d.facility === 'KITE' && d.direction === 'IN' && (
          <Field label="KITE period ends" help="Empty: registration + the months in Settings (12)">
            <DatePicker value={f.kiteDueDate} onChange={(v) => setF({ ...f, kiteDueDate: v ?? '' })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ============================================================ IT Inventory reports
type InOutRow = {
  documentId: string;
  bcType: string;
  facility: string;
  registrationNo: string;
  registrationDate: string;
  receiptNumber: string | null;
  receiptDate: string | null;
  partner: string | null;
  lineNo: number;
  code: string;
  name: string;
  hsCode: string | null;
  uom: string | null;
  qty: number;
  currency: string;
  value: number;
  valueIdr: number;
};
type MutRow = {
  productId: string;
  code: string;
  name: string;
  uom: string;
  opening: number;
  in: number;
  out: number;
  adjustment: number;
  closing: number;
  counted: number | null;
  difference: number | null;
};

export function ReportsPage() {
  const [tab, setTab] = useState('in');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const [cls, setCls] = useState('RAW');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const periodTab = ['in', 'out', 'mutation', 'unlinked'].includes(tab);
  const q = useQuery({
    queryKey: ['bonded', 'report', tab, from, to, cls, warehouseId],
    queryFn: (): Promise<unknown> => {
      if (tab === 'in' || tab === 'out') return api.get<InOutRow[]>(`/bonded/reports/${tab}`, { from, to });
      if (tab === 'mutation') return api.get<{ rows: MutRow[] }>('/bonded/reports/mutation', { class: cls, from, to, warehouseId: warehouseId || undefined });
      if (tab === 'unlinked') return api.get<{ id: string; docType: string; number: string; date: string; partner: string | null }[]>('/bonded/reports/unlinked', { from, to });
      return api.get<unknown[]>(`/bonded/reports/${tab}`);
    },
  });
  const csv = () => {
    const d = q.data as unknown;
    if (!d) return;
    if (tab === 'in' || tab === 'out')
      downloadCsv(`goods-${tab}-${from}-${to}.csv`, [
        [
          'Doc type',
          'Registration no',
          'Registration date',
          tab === 'in' ? 'Receipt no' : 'Release no',
          'Date',
          'Partner',
          'Serial',
          'Item code',
          'Item name',
          'HS',
          'Unit',
          'Quantity',
          'Currency',
          'Value',
          'Value (Rp)',
        ],
        ...(d as InOutRow[]).map((r) => [
          short(r.bcType),
          r.registrationNo,
          r.registrationDate,
          r.receiptNumber,
          r.receiptDate,
          r.partner,
          r.lineNo,
          r.code,
          r.name,
          r.hsCode,
          r.uom,
          r.qty,
          r.currency,
          r.value,
          r.valueIdr,
        ]),
      ]);
    else if (tab === 'mutation')
      downloadCsv(`mutation-${cls}-${from}-${to}.csv`, [
        ['Item code', 'Item name', 'Unit', 'Opening', 'In', 'Out', 'Adjustment', 'Closing', 'Stock count', 'Difference', 'Notes'],
        ...(d as { rows: MutRow[] }).rows.map((r) => [
          r.code,
          r.name,
          r.uom,
          r.opening,
          r.in,
          r.out,
          r.adjustment,
          r.closing,
          r.counted,
          r.difference,
          r.difference ? (r.difference < 0 ? 'shortage' : 'surplus') : '',
        ]),
      ]);
    else if (tab === 'wip')
      downloadCsv(`wip-${isoDate()}.csv`, [
        ['Item code', 'Item name', 'Unit', 'Quantity', 'Notes'],
        ...(d as { code: string; name: string; uom: string; qty: number; note: string }[]).map((r) => [r.code, r.name, r.uom, r.qty, r.note]),
      ]);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="IT Inventory Reports"
        subtitle="The reports a bonded zone keeps open to customs and tax (PER-19/BC/2018 Art. 19 jo PER-9/BC/2021): goods in and out per customs document, work in process and the mutation of each class of goods"
        actions={
          ['in', 'out', 'mutation', 'wip'].includes(tab) && (
            <Button variant="outline" icon="download" disabled={!q.data} onClick={csv}>
              CSV
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'in', label: 'Goods in' },
          { value: 'out', label: 'Goods out' },
          { value: 'mutation', label: 'Mutation' },
          { value: 'wip', label: 'Work in process' },
          { value: 'subcontract', label: 'Subcontract out' },
          { value: 'unlinked', label: 'Without a BC document' },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {periodTab && <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />}
        {tab === 'mutation' && (
          <>
            <div className="w-56">
              <Select value={cls} onChange={(e) => setCls(e.target.value)} options={Object.entries(CLASS_LABEL).map(([value, label]) => ({ value, label }))} />
            </div>
            <div className="w-56">
              <AsyncSelect resource="warehouses" value={warehouseId} onChange={(v) => setWarehouseId(v)} placeholder="All warehouses" />
            </div>
          </>
        )}
      </div>
      <Card bodyClass="p-0">{q.isLoading || !q.data ? <Loading /> : <ReportBody tab={tab} data={q.data as unknown} />}</Card>
      {tab === 'mutation' && (
        <p className="text-xs text-slate-500">
          Items are listed by the "Bonded zone class" on the product. Stock-count adjustments are left out of the adjustment column: they show as the difference between the count and the book closing.
        </p>
      )}
    </div>
  );
}

function ReportBody({ tab, data }: { tab: string; data: unknown }) {
  const th = 'px-2 py-2 text-left';
  const thr = 'px-2 py-2 text-right';
  if (tab === 'in' || tab === 'out') {
    const rows = data as InOutRow[];
    if (!rows.length) return <EmptyState icon="file-stack" title="No registered customs documents in this period" />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Document</th>
              <th className={th}>Registration</th>
              <th className={th}>{tab === 'in' ? 'Receipt' : 'Release'}</th>
              <th className={th}>Partner</th>
              <th className={th}>Item</th>
              <th className={thr}>Quantity</th>
              <th className={thr}>Value</th>
              <th className="px-4 py-2 text-right">Rupiah</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link className="text-brand-600" to={`/bonded/documents/${r.documentId}`}>
                    {short(r.bcType)}
                  </Link>
                  {r.facility === 'KITE' ? ' KITE' : ''} · {r.lineNo}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {r.registrationNo} · {fmtDate(r.registrationDate)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{r.receiptNumber ? `${r.receiptNumber} · ${fmtDate(r.receiptDate!)}` : '-'}</td>
                <td className="max-w-[12rem] truncate px-2 py-2">{r.partner ?? '-'}</td>
                <td className="px-2 py-2">
                  {r.code} · {r.name}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {num(r.qty, 4)} {r.uom}
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {r.currency} {num(r.value)}
                </td>
                <td className="px-4 py-2 text-right">{fmtNumber(r.valueIdr, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (tab === 'mutation') {
    const rows = (data as { rows: MutRow[] }).rows;
    if (!rows.length) return <EmptyState icon="table" title="Nothing in this class" description="Set the bonded zone class on the products (Compliance section)" />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Item</th>
              <th className={th}>Unit</th>
              {['Opening', 'In', 'Out', 'Adjustment', 'Closing', 'Stock count', 'Difference'].map((h) => (
                <th key={h} className={thr}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.productId}>
                <td className="px-4 py-2">
                  {r.code} · {r.name}
                </td>
                <td className="px-2 py-2">{r.uom}</td>
                <td className="px-2 py-2 text-right">{num(r.opening, 4)}</td>
                <td className="px-2 py-2 text-right">{num(r.in, 4)}</td>
                <td className="px-2 py-2 text-right">{num(r.out, 4)}</td>
                <td className="px-2 py-2 text-right">{num(r.adjustment, 4)}</td>
                <td className="px-2 py-2 text-right font-medium">{num(r.closing, 4)}</td>
                <td className="px-2 py-2 text-right">{r.counted === null ? '-' : num(r.counted, 4)}</td>
                <td className={`px-2 py-2 text-right ${r.difference && r.difference < 0 ? 'text-red-600' : ''}`}>{r.difference === null ? '-' : num(r.difference, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (tab === 'wip') {
    const rows = data as { productId: string; code: string; name: string; uom: string; qty: number; note: string }[];
    if (!rows.length) return <EmptyState icon="factory" title="Nothing in process" />;
    return (
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Item</th>
            <th className={th}>Unit</th>
            <th className={thr}>Quantity</th>
            <th className="px-4 py-2 text-left">Order</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2">
                {r.code} · {r.name}
              </td>
              <td className="px-2 py-2">{r.uom}</td>
              <td className="px-2 py-2 text-right">{num(r.qty, 4)}</td>
              <td className="px-4 py-2">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tab === 'subcontract') {
    const rows = data as {
      id: string;
      number: string;
      registrationNo: string;
      registrationDate: string;
      partner: string | null;
      returnDueDate: string | null;
      overdue: boolean;
      guarantee: number;
      lines: { code: string; name: string; uom: string | null; qty: number; back: number; open: number }[];
    }[];
    if (!rows.length) return <EmptyState icon="truck" title="Nothing out on BC 2.6.1" />;
    return (
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-medium text-brand-600" to={`/bonded/documents/${r.id}`}>
                BC 2.6.1 {r.registrationNo}
              </Link>
              <span className="text-slate-500">
                {fmtDate(r.registrationDate)} · {r.partner ?? '-'} · guarantee {fmtMoney(r.guarantee, 0)}
              </span>
              {r.returnDueDate && (
                <Badge tone={r.overdue ? 'red' : 'amber'}>
                  {r.overdue ? 'Overdue' : 'Due'} {fmtDate(r.returnDueDate)}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">{r.lines.map((l) => `${l.code} ${num(l.open, 4)} ${l.uom ?? ''} still out (${num(l.back, 4)} back)`).join(' · ')}</div>
          </li>
        ))}
      </ul>
    );
  }
  const rows = data as { id: string; docType: string; number: string; date: string; partner: string | null }[];
  if (!rows.length) return <EmptyState icon="check-circle" title="Every goods receipt and delivery has its customs document" />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-2 px-4 py-2.5 text-sm">
          <Link className="font-medium text-brand-600" to={`/documents/${r.docType}/${r.id}`}>
            {r.number}
          </Link>
          <span className="text-slate-500">
            {fmtDate(r.date)} · {r.partner ?? '-'}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ============================================================ quota
export function QuotaPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({
    queryKey: ['bonded', 'quota', year],
    queryFn: () =>
      api.get<{
        year: number;
        pct: number;
        firstYear: boolean;
        base: number;
        quota: number;
        used: number;
        left: number;
        usedPct: number | null;
        lastYearRealisation: number;
        thisYearRealisation: number;
        months: { month: number; realisation: number; domestic: number }[];
      }>('/bonded/quota', { year }),
  });
  const d = q.data;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Domestic Sales Quota"
        subtitle="PMK 131/2018 Art. 31: releases to the domestic area (BC 2.5, BC 4.1) up to a share of last year's exports, sales to other bonded zones, FTZ and KEK"
        actions={
          <div className="w-28">
            <Select
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              options={Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
        }
      />
      {q.isLoading || !d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={d.firstYear ? `Realisation ${d.year} (first year)` : `Realisation ${d.year - 1}`} value={fmtMoney(d.base, 0)} hint="exports, other bonded zones, FTZ, KEK" />
            <Stat label={`Quota ${d.pct}%`} value={fmtMoney(d.quota, 0)} hint="change the % in Settings, Customs" />
            <Stat label="Released to the domestic area" value={fmtMoney(d.used, 0)} hint={d.usedPct === null ? 'no exports or zone sales yet: the quota is nil' : `${d.usedPct}% of the quota`} tone={d.used > d.quota ? 'text-red-600' : undefined} />
            <Stat
              label={d.left >= 0 ? 'Left' : 'Over the quota'}
              value={fmtMoney(Math.abs(d.left), 0)}
              tone={d.left < 0 ? 'text-red-600' : 'text-emerald-600'}
              hint={d.left < 0 ? 'next year: % x quota / actual; twice running: licence frozen up to 3 months' : undefined}
            />
          </div>
          <Card title={`By month, ${d.year}`} bodyClass="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Month</th>
                  <th className="px-2 py-2 text-right">Realisation (exports, KB, FTZ, KEK)</th>
                  <th className="px-4 py-2 text-right">Domestic (BC 2.5, BC 4.1)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-4 py-2">{MONTHS[m.month - 1]}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(m.realisation, 0)}</td>
                    <td className="px-4 py-2 text-right">{fmtNumber(m.domestic, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-slate-500">
            Values are the rupiah values of the registered KB customs documents. A higher share needs the regional office approval with an industry ministry recommendation. A cut to 25% has been
            announced but not issued (Nov 2026).
          </p>
        </>
      )}
    </div>
  );
}

// ============================================================ KITE
interface KiteData {
  imports: {
    id: string;
    number: string;
    bcType: string;
    ajuNo: string | null;
    registrationNo: string;
    registrationDate: string;
    partner: string | null;
    kiteDueDate: string | null;
    reportDue: string | null;
    daysLeft: number | null;
    state: string;
    lines: { id: string; lineNo: number; code: string; name: string; uom: string | null; qty: number; settled: number; open: number; valueIdr: number }[];
  }[];
  exports: {
    id: string;
    number: string;
    bcType: string;
    registrationNo: string;
    registrationDate: string;
    partner: string | null;
    settled: boolean;
    lines: { code: string; name: string; uom: string | null; qty: number }[];
  }[];
}
interface Kt01 {
  header: { pibCount: number; pebCount: number; rawQty: number; finishedQty: number };
  finished: {
    bcType: string;
    ajuNo: string | null;
    registrationNo: string;
    registrationDate: string;
    officeCode: string | null;
    lineNo: number;
    code: string;
    name: string;
    uom: string | null;
    qty: number;
  }[];
  raw: {
    ajuNo: string | null;
    registrationNo: string;
    registrationDate: string;
    officeCode: string | null;
    lineNo: number;
    code: string;
    name: string;
    uom: string | null;
    qty: number;
    wastePct: number | null;
    cif: number;
    bm: number;
    ppn: number;
    ppnbm: number;
  }[];
  totals: { cif: number; bm: number; ppn: number; ppnbm: number };
  unsettled: { id: string; number: string; bcType: string; registrationNo: string }[];
}
const KSTATE: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'blue' },
  DUE_SOON: { label: 'Due within 30 days', tone: 'amber' },
  OVERDUE: { label: 'Period ended', tone: 'red' },
  SETTLED: { label: 'Settled', tone: 'green' },
};

export function KitePage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [from, setFrom] = useState(isoDate().slice(0, 4) + '-01-01');
  const [to, setTo] = useState(isoDate());
  const q = useQuery({ queryKey: ['bonded', 'kite'], queryFn: () => api.get<KiteData>('/bonded/kite') });
  const kt = useQuery({ queryKey: ['bonded', 'kt01', from, to], queryFn: () => api.get<Kt01>('/bonded/kite/bclkt01', { from, to }) });
  const settle = useMutation({
    mutationFn: (id: string) => api.post<{ allocations: number; unallocated: number }>(`/bonded/documents/${id}/kite-settle`),
    onSuccess: (r) => (toast.success(`Charged (${r.allocations} lines)${r.unallocated ? `; ${r.unallocated} not covered` : ''}`), qc.invalidateQueries({ queryKey: ['bonded'] })),
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  const k = kt.data;
  const print = () => {
    if (!k) return;
    const row = (cells: (string | number | null)[]) =>
      `<tr>${cells.map((c) => `<td${typeof c === 'number' ? ' class="r"' : ''}>${esc(c === null ? '-' : typeof c === 'number' ? fmtNumber(c, 2) : c)}</td>`).join('')}</tr>`;
    printHtml(`<!doctype html><html><head><title>BCL.KT01 ${esc(from)} ${esc(to)}</title><style>${PRINT_CSS}</style></head><body>
<h1>KITE accountability data (BCL.KT01) ${esc(fmtDate(from))} - ${esc(fmtDate(to))}</h1>
<p class="muted">PIB: ${k.header.pibCount} · PEB: ${k.header.pebCount} · raw materials: ${fmtNumber(k.header.rawQty, 4)} · finished goods: ${fmtNumber(k.header.finishedQty, 4)}. Working paper for the CEISA submission (PER-8/BC/2022 Lampiran IX).</p>
<h2>Finished goods</h2><table><tr><th>Doc</th><th>Aju</th><th>Registration</th><th>Date</th><th>Office</th><th>Serial</th><th>Item</th><th>Qty</th></tr>
${k.finished.map((r) => row([short(r.bcType), r.ajuNo, r.registrationNo, fmtDate(r.registrationDate), r.officeCode, String(r.lineNo), `${r.code} ${r.name}`, r.qty])).join('')}</table>
<h2>Raw materials</h2><table><tr><th>Aju</th><th>Registration</th><th>Date</th><th>Office</th><th>Serial</th><th>Item</th><th>Qty</th><th>Waste %</th><th>CIF (Rp)</th><th>BM</th><th>PPN</th><th>PPnBM</th></tr>
${k.raw.map((r) => row([r.ajuNo, r.registrationNo, fmtDate(r.registrationDate), r.officeCode, String(r.lineNo), `${r.code} ${r.name}`, r.qty, r.wastePct, r.cif, r.bm, r.ppn, r.ppnbm])).join('')}
<tr class="b"><td colspan="8">Total</td><td class="r">${fmtNumber(k.totals.cif, 0)}</td><td class="r">${fmtNumber(k.totals.bm, 0)}</td><td class="r">${fmtNumber(k.totals.ppn, 0)}</td><td class="r">${fmtNumber(k.totals.ppnbm, 0)}</td></tr></table>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="KITE Accountability"
        subtitle="PMK 149/2022: imported materials must go out as exports (or to a KB / other KITE company) within the period, usually 12 months; the BCL.KT01 report is due 60 days after the period ends"
      />
      {q.isLoading || !d ? (
        <Loading />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="KITE imports" bodyClass="p-0">
            {!d.imports.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">No registered KITE imports.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.imports.map((i) => (
                  <li key={i.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="font-medium text-brand-600" to={`/bonded/documents/${i.id}`}>
                        {short(i.bcType)} {i.registrationNo}
                      </Link>
                      <span className="text-slate-500">
                        {fmtDate(i.registrationDate)} · {i.partner ?? '-'}
                      </span>
                      <Badge tone={KSTATE[i.state].tone}>{KSTATE[i.state].label}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">
                      {i.kiteDueDate ? `period ends ${fmtDate(i.kiteDueDate)}${i.daysLeft !== null && i.daysLeft >= 0 ? ` (${i.daysLeft} days)` : ''} · report due ${fmtDate(i.reportDue!)}` : ''}
                    </div>
                    <div className="mt-1 text-xs">{i.lines.map((l) => `${l.code}: ${num(l.settled, 2)} of ${num(l.qty, 2)} ${l.uom ?? ''} accounted`).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Exports and other settlements" subtitle="Charge each one to the imports: materials by the bill of materials, oldest import first" bodyClass="p-0">
            {!d.exports.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">No registered KITE exports.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.exports.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <Link className="font-medium text-brand-600" to={`/bonded/documents/${x.id}`}>
                        {short(x.bcType)} {x.registrationNo}
                      </Link>{' '}
                      · {fmtDate(x.registrationDate)} · {x.partner ?? '-'}
                      <span className="block text-xs text-slate-500">{x.lines.map((l) => `${l.code} ${num(l.qty, 2)} ${l.uom ?? ''}`).join(', ')}</span>
                    </span>
                    {x.settled ? (
                      <Badge tone="green">Charged</Badge>
                    ) : (
                      can('bonded.kite') && (
                        <Button size="sm" icon="link" loading={settle.isPending && settle.variables === x.id} onClick={() => settle.mutate(x.id)}>
                          Charge
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Card
        title="BCL.KT01 data"
        subtitle="Finished goods exported and the imported materials they used, with the CIF and duties settled"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Period from={from} to={to} setFrom={setFrom} setTo={setTo} />
            <Button variant="outline" icon="printer" disabled={!k?.raw.length} onClick={print}>
              Print
            </Button>
          </div>
        }
        bodyClass="p-0"
      >
        {kt.isLoading || !k ? (
          <Loading />
        ) : !k.raw.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">Nothing charged in this period.{k.unsettled.length ? ` ${k.unsettled.length} KITE exports not charged yet.` : ''}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Import (PIB)</th>
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Used</th>
                  <th className="px-2 py-2 text-right">Waste %</th>
                  <th className="px-2 py-2 text-right">CIF (Rp)</th>
                  <th className="px-2 py-2 text-right">BM</th>
                  <th className="px-4 py-2 text-right">PPN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {k.raw.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.registrationNo} · {fmtDate(r.registrationDate)} · {r.lineNo}
                    </td>
                    <td className="px-2 py-2">
                      {r.code} · {r.name}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {num(r.qty, 4)} {r.uom}
                    </td>
                    <td className="px-2 py-2 text-right">{r.wastePct ?? '-'}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(r.cif, 0)}</td>
                    <td className="px-2 py-2 text-right">{fmtNumber(r.bm, 0)}</td>
                    <td className="px-4 py-2 text-right">{fmtNumber(r.ppn, 0)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-4 py-2" colSpan={4}>
                    {k.header.pebCount} exports, {k.header.pibCount} imports
                  </td>
                  <td className="px-2 py-2 text-right">{fmtNumber(k.totals.cif, 0)}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(k.totals.bm, 0)}</td>
                  <td className="px-4 py-2 text-right">{fmtNumber(k.totals.ppn, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
