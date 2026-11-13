import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

type Tone = 'gray' | 'amber' | 'green' | 'red' | 'blue' | 'violet';
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'To inspect', tone: 'amber' },
  PASSED: { label: 'Released', tone: 'green' },
  CONDITIONAL: { label: 'Released with deviation', tone: 'blue' },
  FAILED: { label: 'Rejected', tone: 'red' },
};
const STAGE: Record<string, string> = { RECEIPT: 'Incoming goods', PRODUCTION: 'Finished production' };

interface InspectionRow {
  id: string;
  number: string;
  stage: string;
  status: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  lotNo: string | null;
  qty: number;
  createdAt: string;
  inspectedAt: string | null;
  product: { code: string; name: string } | null;
}
interface Result {
  id: string;
  seq: number;
  name: string;
  kind: 'NUMBER' | 'CHECK' | 'TEXT';
  unit: string | null;
  min: number | null;
  max: number | null;
  method: string | null;
  critical: boolean;
  valueNumber: number | null;
  valueText: string | null;
  pass: boolean | null;
}
interface Inspection extends InspectionRow {
  sampleQty: number;
  notes: string | null;
  results: Result[];
  product: { code: string; name: string; uom: { code: string } | null } | null;
  plan: { code: string; name: string; sampling: string | null; holdLots: boolean } | null;
  lot: { lotNo: string; expiryDate: string | null; manufactureDate: string | null; qcStatus: string } | null;
  inspector: string | null;
  company: { name: string; legalName: string | null; address: string | null; city: string | null; phone: string | null } | null;
  ncrs: { id: string; number: string; status: string }[];
}

const spec = (r: { kind: string; min: number | null; max: number | null; unit: string | null }) =>
  r.kind === 'NUMBER' ? `${r.min !== null && r.max !== null ? `${fmtNumber(r.min)} – ${fmtNumber(r.max)}` : r.min !== null ? `≥ ${fmtNumber(r.min)}` : `≤ ${fmtNumber(r.max)}`}${r.unit ? ` ${r.unit}` : ''}` : r.kind === 'CHECK' ? 'Conforms' : 'Observation';

// ============================================================ inspections
export function InspectionsPage() {
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['qc', 'inspections', status, search], queryFn: () => api.get<InspectionRow[]>('/quality/inspections', { status: status || undefined, search: search || undefined }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inspections"
        subtitle="Created when goods are received or produced and an inspection plan applies; lots stay on hold until the quality decision"
        actions={
          <div className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, lot, document" className="h-9 w-52" />
            <div className="w-48">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="clipboard-check" title={status === 'PENDING' ? 'Nothing waiting for inspection' : 'No inspections'} description="Set up inspection plans for incoming goods and finished products" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((i) => (
              <li key={i.id}>
                <Link to={`/quality/inspections/${i.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {i.number} · {i.product?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {STAGE[i.stage]} · {i.sourceType === 'GR' ? 'Goods receipt' : 'Work order'} {i.sourceNumber}
                      {i.lotNo ? ` · lot ${i.lotNo}` : ' · no lot (stock is not blocked)'} · {fmtNumber(i.qty)} · {fmtDate(i.createdAt)}
                    </span>
                  </span>
                  <Badge tone={STATUS[i.status]?.tone ?? 'gray'}>{STATUS[i.status]?.label ?? i.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function InspectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['qc', 'inspection', id], queryFn: () => api.get<Inspection>(`/quality/inspections/${id}`) });
  const i = q.data;
  const [vals, setVals] = useState<Record<string, { valueNumber: string; valueText: string; pass: boolean | null }>>({});
  const [sample, setSample] = useState('');
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState<'PASSED' | 'FAILED' | 'CONDITIONAL' | null>(null);
  useEffect(() => {
    if (!i) return;
    setVals(Object.fromEntries(i.results.map((r) => [r.id, { valueNumber: r.valueNumber === null ? '' : String(r.valueNumber), valueText: r.valueText ?? '', pass: r.pass }])));
    setSample(i.sampleQty ? String(i.sampleQty) : '');
    setNotes(i.notes ?? '');
  }, [i]);
  const save = useMutation({
    mutationFn: () => api.put<Inspection>(`/quality/inspections/${id}/results`, { sampleQty: Number(sample) || 0, notes, results: (i?.results ?? []).map((r) => ({ id: r.id, valueNumber: vals[r.id]?.valueNumber === '' ? null : Number(vals[r.id]?.valueNumber), valueText: vals[r.id]?.valueText || null, pass: vals[r.id]?.pass ?? null })) }),
    onSuccess: (x) => (qc.setQueryData(['qc', 'inspection', id], x), toast.success('Results saved')),
    onError: (e) => toast.error(e),
  });
  if (q.isLoading || !i)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  const open = i.status === 'PENDING';
  const live = (r: Result) => {
    const v = vals[r.id];
    if (!v) return r.pass;
    if (r.kind === 'NUMBER') return v.valueNumber === '' ? null : (r.min === null || Number(v.valueNumber) >= r.min) && (r.max === null || Number(v.valueNumber) <= r.max);
    if (r.kind === 'CHECK') return v.pass;
    return null;
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {i.number} <Badge tone={STATUS[i.status]?.tone ?? 'gray'}>{STATUS[i.status]?.label}</Badge>
          </span>
        }
        subtitle={`${i.product?.name} · ${fmtNumber(i.qty)} ${i.product?.uom?.code ?? ''} · ${STAGE[i.stage]} · ${i.sourceType === 'GR' ? 'goods receipt' : 'work order'} ${i.sourceNumber}`}
        back={() => navigate('/quality/inspections')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="printer" onClick={() => printCoa(i)}>
              {i.status === 'PENDING' ? 'Print test sheet' : 'Certificate of analysis'}
            </Button>
            {open && can('quality.inspection.record') && (
              <Button variant="outline" icon="save" loading={save.isPending} onClick={() => save.mutate()}>
                Save results
              </Button>
            )}
            {open && can('quality.inspection.release') && (
              <>
                <Button variant="danger" icon="x" onClick={() => setDeciding('FAILED')}>
                  Reject
                </Button>
                <Button variant="outline" onClick={() => setDeciding('CONDITIONAL')}>
                  Accept with deviation
                </Button>
                <Button icon="check" onClick={() => setDeciding('PASSED')}>
                  Release
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Checks" subtitle={i.plan ? `${i.plan.code} · ${i.plan.name}${i.plan.sampling ? ` · sampling: ${i.plan.sampling}` : ''}` : undefined} className="lg:col-span-2" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Parameter</th>
                <th className="px-3 py-2 text-left font-semibold">Specification</th>
                <th className="px-3 py-2 text-left font-semibold">Result</th>
                <th className="px-4 py-2 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {i.results.map((r) => {
                const p = live(r);
                const v = vals[r.id] ?? { valueNumber: '', valueText: '', pass: null };
                const set = (patch: Partial<typeof v>) => setVals((x) => ({ ...x, [r.id]: { ...v, ...patch } }));
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="px-4 py-2">
                      <span className="font-medium">{r.name}</span> {r.critical && r.kind !== 'TEXT' && <Badge tone="gray">critical</Badge>}
                      {r.method && <span className="block text-xs text-slate-500">{r.method}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{spec(r)}</td>
                    <td className="px-3 py-2">
                      {!open ? (
                        <span>{r.kind === 'NUMBER' ? `${fmtNumber(r.valueNumber ?? '')}${r.unit ? ` ${r.unit}` : ''}` : r.kind === 'CHECK' ? (r.pass ? 'Conforms' : r.pass === false ? 'Does not conform' : '-') : (r.valueText ?? '-')}</span>
                      ) : r.kind === 'NUMBER' ? (
                        <NumberInput className="h-8 w-32" decimals={6} allowNegative value={v.valueNumber} onChange={(x) => set({ valueNumber: x })} aria-label={r.name} />
                      ) : r.kind === 'CHECK' ? (
                        <div className="flex gap-1">
                          {[true, false].map((b) => (
                            <button key={String(b)} type="button" onClick={() => set({ pass: b })} className={cn('rounded-lg px-3 py-1 text-xs ring-1', v.pass === b ? (b ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-red-600 text-white ring-red-600') : 'ring-line')}>
                              {b ? 'Conforms' : 'Does not'}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Input className="h-8" value={v.valueText} maxLength={500} onChange={(e) => set({ valueText: e.target.value })} aria-label={r.name} />
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{p === true ? <Badge tone="green">OK</Badge> : p === false ? <Badge tone="red">Out</Badge> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-1 gap-3 border-t border-line p-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Sample size">
              <NumberInput decimals={4} min={0} disabled={!open} value={sample} onChange={setSample} />
            </Field>
            <Field label="Notes">
              <Textarea rows={2} disabled={!open} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card title="Lot">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Lot / batch</dt>
              <dd className="font-medium">{i.lot?.lotNo ?? 'not lot-tracked'}</dd>
            </div>
            {i.lot && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Quality status</dt>
                <dd>
                  <Badge tone={i.lot.qcStatus === 'RELEASED' ? 'green' : i.lot.qcStatus === 'HOLD' ? 'amber' : 'red'}>{i.lot.qcStatus === 'HOLD' ? 'On hold' : i.lot.qcStatus === 'RELEASED' ? 'Released' : 'Rejected'}</Badge>
                </dd>
              </div>
            )}
            {i.lot?.expiryDate && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Expiry</dt>
                <dd>{fmtDate(i.lot.expiryDate)}</dd>
              </div>
            )}
            {i.inspectedAt && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Inspected</dt>
                <dd>
                  {fmtDateTime(i.inspectedAt)}
                  {i.inspector ? ` · ${i.inspector}` : ''}
                </dd>
              </div>
            )}
            {!i.lot && <p className="text-xs text-amber-700">The product is not lot-tracked, so its stock cannot be blocked while waiting. Turn on lot tracking on the product for a real hold.</p>}
            {i.ncrs.map((x) => (
              <Link key={x.id} to="/quality/ncr" className="flex justify-between text-red-700 hover:underline">
                <span>Non-conformance {x.number}</span>
                <span>{x.status === 'OPEN' ? 'open' : 'closed'}</span>
              </Link>
            ))}
          </dl>
        </Card>
      </div>
      {deciding && (
        <DecideModal
          decision={deciding}
          onClose={() => setDeciding(null)}
          onSubmit={async (n) => {
            if (open && can('quality.inspection.record')) await save.mutateAsync();
            const r = await api.post<Inspection & { ncr: { number: string } | null }>(`/quality/inspections/${id}/decide`, { decision: deciding, notes: n || null });
            toast.success(deciding === 'FAILED' ? `Rejected · non-conformance ${r.ncr?.number ?? ''} opened` : 'Lot released for use');
            qc.invalidateQueries({ queryKey: ['qc'] });
            setDeciding(null);
          }}
        />
      )}
    </div>
  );
}

function DecideModal({ decision, onClose, onSubmit }: { decision: 'PASSED' | 'FAILED' | 'CONDITIONAL'; onClose: () => void; onSubmit: (notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={decision === 'PASSED' ? 'Release the lot' : decision === 'FAILED' ? 'Reject the lot' : 'Accept with a deviation'}
      footer={
        <Button
          variant={decision === 'FAILED' ? 'danger' : 'primary'}
          loading={busy}
          disabled={decision === 'CONDITIONAL' && !notes.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(notes.trim());
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {decision === 'PASSED' ? 'The lot can be used and sold.' : decision === 'FAILED' ? 'The lot stays blocked and a non-conformance report is opened (return, scrap, rework or concession).' : 'The lot is released although a result is out of specification. Explain the deviation and who accepted it.'}
      </p>
      <Field label="Notes" required={decision === 'CONDITIONAL'}>
        <Textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** certificate of analysis (or the blank test sheet while pending), printed from the browser */
function printCoa(i: Inspection) {
  const c = i.company;
  const pending = i.status === 'PENDING';
  const rows = i.results
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}${r.method ? `<div class="m">${esc(r.method)}</div>` : ''}</td><td>${esc(spec(r))}</td><td>${pending ? '' : esc(r.kind === 'NUMBER' ? `${r.valueNumber ?? ''}${r.unit ? ' ' + r.unit : ''}` : r.kind === 'CHECK' ? (r.pass ? 'Conforms' : r.pass === false ? 'Does not conform' : '') : (r.valueText ?? ''))}</td><td>${pending || r.pass === null ? '' : r.pass ? 'Pass' : 'Fail'}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(i.number)}</title><style>
@page { size: A4; margin: 16mm; } body { font: 11px system-ui, sans-serif; color: #111; }
h1 { font-size: 18px; margin: 12px 0 4px; } .muted { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; } th { background: #f1f5f9; } .m { color: #666; font-size: 10px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 8px; } .sign { margin-top: 48px; display: flex; justify-content: flex-end; } .sign div { width: 220px; border-top: 1px solid #333; padding-top: 4px; text-align: center; }
</style></head><body>
<div><b>${esc(c?.legalName ?? c?.name)}</b><div class="muted">${esc([c?.address, c?.city].filter(Boolean).join(', '))}${c?.phone ? ' · ' + esc(c.phone) : ''}</div></div>
<h1>${pending ? 'Test sheet' : 'Certificate of Analysis'}</h1><div class="muted">${esc(i.number)}</div>
<div class="grid"><div>Product: <b>${esc(i.product?.name)}</b> (${esc(i.product?.code)})</div><div>Lot / batch: <b>${esc(i.lot?.lotNo ?? '-')}</b></div>
<div>Quantity: ${esc(fmtNumber(i.qty))} ${esc(i.product?.uom?.code ?? '')}</div><div>Expiry: ${esc(i.lot?.expiryDate ? fmtDate(i.lot.expiryDate) : '-')}</div>
<div>Source: ${esc(i.sourceType === 'GR' ? 'Goods receipt' : 'Work order')} ${esc(i.sourceNumber)}</div><div>Sample: ${esc(i.sampleQty ? fmtNumber(i.sampleQty) : '')}${i.plan?.sampling ? ' · ' + esc(i.plan.sampling) : ''}</div></div>
<table><thead><tr><th>Parameter</th><th>Specification</th><th>Result</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
${pending ? '' : `<p><b>Decision: ${esc(STATUS[i.status]?.label)}</b>${i.notes ? ' — ' + esc(i.notes) : ''}</p>`}
<div class="sign"><div>${esc(i.inspector ?? 'Quality control')}<br>${esc(i.inspectedAt ? fmtDate(i.inspectedAt) : '')}</div></div>
</body></html>`;
  const f = document.createElement('iframe');
  Object.assign(f.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(f);
  f.contentDocument!.open();
  f.contentDocument!.write(html);
  f.contentDocument!.close();
  setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 2000);
  }, 200);
}

// ============================================================ plans
interface Plan {
  id: string;
  code: string;
  name: string;
  stage: 'RECEIPT' | 'PRODUCTION';
  productId: string | null;
  categoryId: string | null;
  sampling: string | null;
  holdLots: boolean;
  isActive: boolean;
  product: { code: string; name: string } | null;
  category: { name: string } | null;
  params: { name: string; kind: 'NUMBER' | 'CHECK' | 'TEXT'; unit: string | null; min: number | null; max: number | null; target: number | null; method: string | null; critical: boolean }[];
}

export function PlansPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qc', 'plans'], queryFn: () => api.get<Plan[]>('/quality/plans') });
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inspection Plans"
        subtitle="What to check on incoming goods and finished production, with the specification of each parameter. The most specific plan applies: product, then its category, then a general one"
        actions={
          <Button icon="plus" onClick={() => setEdit('new')}>
            New plan
          </Button>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="list-checks" title="No inspection plans yet" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500">{p.code}</span> {!p.isActive && <Badge tone="gray">Inactive</Badge>}
                  <span className="block text-xs text-slate-500">
                    {STAGE[p.stage]} · {p.product ? p.product.name : p.category ? `category ${p.category.name}` : 'all products'} · {p.params.length} check(s){p.holdLots ? ' · lots held until released' : ''}
                  </span>
                </span>
                <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(p)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <PlanEditor plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['qc', 'plans'] }))} />}
    </div>
  );
}

function PlanEditor({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: plan?.code ?? '', name: plan?.name ?? '', stage: plan?.stage ?? 'RECEIPT', productId: plan?.productId ?? null, categoryId: plan?.categoryId ?? null, sampling: plan?.sampling ?? '', holdLots: plan?.holdLots ?? true, isActive: plan?.isActive ?? true });
  const [params, setParams] = useState(plan?.params.map((p) => ({ ...p, min: p.min === null ? '' : String(p.min), max: p.max === null ? '' : String(p.max), unit: p.unit ?? '', method: p.method ?? '' })) ?? [{ name: '', kind: 'NUMBER' as const, unit: '', min: '', max: '', target: null, method: '', critical: true }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, sampling: f.sampling || null, params: params.filter((p) => p.name.trim()).map((p) => ({ name: p.name, kind: p.kind, unit: p.unit || null, min: p.min === '' ? null : Number(p.min), max: p.max === '' ? null : Number(p.max), method: p.method || null, critical: p.critical })) };
      return plan ? api.put(`/quality/plans/${plan.id}`, body) : api.post('/quality/plans', body);
    },
    onSuccess: () => (toast.success('Plan saved'), onSaved()),
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  const setP = (i: number, patch: Partial<(typeof params)[number]>) => setParams((x) => x.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={plan ? `Edit ${plan.name}` : 'New inspection plan'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr_14rem]">
          <Field label="Code" required error={errors.code}>
            <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name" required>
            <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="When">
            <Select
              value={f.stage}
              onChange={(e) => setF({ ...f, stage: e.target.value as 'RECEIPT' | 'PRODUCTION' })}
              options={[
                { value: 'RECEIPT', label: 'Incoming goods (receipt)' },
                { value: 'PRODUCTION', label: 'Finished production' },
              ]}
            />
          </Field>
          <Field label="Product" help="Or a category; both empty = every product">
            <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} placeholder="Any" />
          </Field>
          <Field label="Category">
            <AsyncSelect resource="product-categories" value={f.categoryId} onChange={(v) => setF({ ...f, categoryId: v })} placeholder="Any" />
          </Field>
          <Field label="Sampling">
            <Input value={f.sampling} maxLength={200} onChange={(e) => setF({ ...f, sampling: e.target.value })} placeholder="AQL 2.5 / 3 cans per batch" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Switch checked={f.holdLots} onChange={(v) => setF({ ...f, holdLots: v })} label="Hold the lot until released" />
          <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Checks</p>
          {errors.params && <p className="text-xs text-red-600">{errors.params}</p>}
          {params.map((p, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg p-2 ring-1 ring-line sm:grid-cols-[1fr_8rem_5rem_6rem_6rem_1fr_auto_auto]">
              <Field label={i === 0 ? 'Parameter' : undefined}>
                <Input value={p.name} maxLength={120} onChange={(e) => setP(i, { name: e.target.value })} placeholder="Viscosity, moisture, colour..." />
              </Field>
              <Field label={i === 0 ? 'Kind' : undefined}>
                <Select
                  value={p.kind}
                  onChange={(e) => setP(i, { kind: e.target.value as 'NUMBER' | 'CHECK' | 'TEXT' })}
                  options={[
                    { value: 'NUMBER', label: 'Measured' },
                    { value: 'CHECK', label: 'Pass / fail' },
                    { value: 'TEXT', label: 'Note' },
                  ]}
                />
              </Field>
              <Field label={i === 0 ? 'Unit' : undefined}>
                <Input value={p.unit} maxLength={20} disabled={p.kind !== 'NUMBER'} onChange={(e) => setP(i, { unit: e.target.value })} />
              </Field>
              <Field label={i === 0 ? 'Min' : undefined} error={errors[`params.${i}.min`]}>
                <NumberInput decimals={6} allowNegative disabled={p.kind !== 'NUMBER'} value={p.min} onChange={(v) => setP(i, { min: v })} />
              </Field>
              <Field label={i === 0 ? 'Max' : undefined} error={errors[`params.${i}.max`]}>
                <NumberInput decimals={6} allowNegative disabled={p.kind !== 'NUMBER'} value={p.max} onChange={(v) => setP(i, { max: v })} />
              </Field>
              <Field label={i === 0 ? 'Method' : undefined}>
                <Input value={p.method} maxLength={200} onChange={(e) => setP(i, { method: e.target.value })} placeholder="SNI / ASTM / visual" />
              </Field>
              <div className="flex h-10 items-center">
                <Checkbox checked={p.critical} onChange={(v) => setP(i, { critical: v })} label="Critical" />
              </div>
              <Button variant="ghost" size="icon" icon="trash-2" aria-label="Remove check" onClick={() => setParams((x) => x.filter((_, k) => k !== i))} />
            </div>
          ))}
          <Button size="sm" variant="outline" icon="plus" onClick={() => setParams((x) => [...x, { name: '', kind: 'NUMBER', unit: '', min: '', max: '', target: null, method: '', critical: true }])}>
            Add check
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ non-conformances
interface Ncr {
  id: string;
  number: string;
  status: 'OPEN' | 'CLOSED';
  lotNo: string | null;
  qty: number;
  description: string;
  disposition: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  dueDate: string | null;
  createdAt: string;
  closedAt: string | null;
  product: { code: string; name: string } | null;
  supplier: string | null;
}
const DISPOSITION: Record<string, string> = { REWORK: 'Rework', SCRAP: 'Scrap (Inventory > Lots > dispose)', USE_AS_IS: 'Use as is (concession: releases the lot)', RETURN: 'Return to the supplier (purchase return)', SORT: 'Sort / 100% inspection' };

export function NcrPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('OPEN');
  const q = useQuery({ queryKey: ['qc', 'ncrs', status], queryFn: () => api.get<Ncr[]>('/quality/ncrs', { status: status || undefined }) });
  const [edit, setEdit] = useState<Ncr | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Non-conformances"
        subtitle="Rejected lots and other quality problems: disposition, root cause and corrective / preventive action (CAPA)"
        actions={
          <div className="flex gap-2">
            <div className="w-36">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="All"
                options={[
                  { value: 'OPEN', label: 'Open' },
                  { value: 'CLOSED', label: 'Closed' },
                ]}
              />
            </div>
            {can('quality.ncr.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New report
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="triangle-alert" title={status === 'OPEN' ? 'No open non-conformances' : 'Nothing here'} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setEdit(r)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {r.number} · {r.product?.name}
                      {r.lotNo ? ` · lot ${r.lotNo}` : ''}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.supplier ? `${r.supplier} · ` : ''}
                      {r.description.split('\n')[0]}
                    </span>
                  </span>
                  {r.disposition && <Badge tone="violet">{DISPOSITION[r.disposition]?.split(' (')[0]}</Badge>}
                  {r.dueDate && r.status === 'OPEN' && <Badge tone={new Date(r.dueDate) < new Date() ? 'red' : 'gray'}>due {fmtDate(r.dueDate)}</Badge>}
                  <Badge tone={r.status === 'OPEN' ? 'amber' : 'green'}>{r.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <NcrEditor ncr={edit} readOnly={!can('quality.ncr.manage') || edit.status === 'CLOSED'} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['qc'] }))} />}
      {creating && <NcrCreate onClose={() => setCreating(false)} onSaved={() => (setCreating(false), qc.invalidateQueries({ queryKey: ['qc', 'ncrs'] }))} />}
    </div>
  );
}

function NcrEditor({ ncr, readOnly, onClose, onSaved }: { ncr: Ncr; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ disposition: ncr.disposition ?? '', rootCause: ncr.rootCause ?? '', correctiveAction: ncr.correctiveAction ?? '', dueDate: ncr.dueDate?.slice(0, 10) ?? '' });
  const save = useMutation({ mutationFn: (close: boolean) => api.put(`/quality/ncrs/${ncr.id}`, { ...f, disposition: f.disposition || null, dueDate: f.dueDate || null, close }), onSuccess: (_, close) => (toast.success(close ? 'Closed' : 'Saved'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${ncr.number} · ${ncr.product?.name}`}
      footer={
        !readOnly && (
          <>
            <Button variant="outline" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
              Save
            </Button>
            <Button icon="check" loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
              Close report
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <pre className="rounded-lg bg-slate-50 p-3 font-sans text-xs whitespace-pre-wrap">{ncr.description}</pre>
        <p className="text-xs text-slate-500">
          {ncr.lotNo ? `Lot ${ncr.lotNo} · ` : ''}
          {fmtNumber(ncr.qty)} · {ncr.supplier ? `supplier ${ncr.supplier} · ` : ''}opened {fmtDate(ncr.createdAt)}
          {ncr.closedAt ? ` · closed ${fmtDate(ncr.closedAt)}` : ''}
        </p>
        <Field label="Disposition">
          <Select value={f.disposition} disabled={readOnly} onChange={(e) => setF({ ...f, disposition: e.target.value })} placeholder="Choose" options={Object.entries(DISPOSITION).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Root cause">
          <Textarea rows={2} disabled={readOnly} maxLength={4000} value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} />
        </Field>
        <Field label="Corrective / preventive action">
          <Textarea rows={2} disabled={readOnly} maxLength={4000} value={f.correctiveAction} onChange={(e) => setF({ ...f, correctiveAction: e.target.value })} />
        </Field>
        <Field label="Due date">
          <DatePicker value={f.dueDate} disabled={readOnly} onChange={(v) => setF({ ...f, dueDate: v ?? '' })} />
        </Field>
      </div>
    </Modal>
  );
}

function NcrCreate({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ productId: null as string | null, supplierId: null as string | null, qty: '', description: '' });
  const save = useMutation({ mutationFn: () => api.post('/quality/ncrs', { ...f, qty: Number(f.qty) || 0 }), onSuccess: () => (toast.success('Report opened'), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title="New non-conformance"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.productId || f.description.trim().length < 3} onClick={() => save.mutate()}>
          Open report
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Product" required>
          <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="Supplier">
          <AsyncSelect resource="suppliers" value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} placeholder="None" />
        </Field>
        <Field label="Quantity">
          <NumberInput decimals={4} min={0} value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        <Field label="What is wrong" required className="sm:col-span-2">
          <Textarea rows={4} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Customer complaint, damage found in the warehouse, process deviation..." />
        </Field>
      </div>
    </Modal>
  );
}
