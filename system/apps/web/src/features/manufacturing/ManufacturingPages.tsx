import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, confirm, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

type Prod = { id: string; code: string; name: string; uom?: { code: string } | null } | null;
interface Estimate {
  material: number;
  conversion: number;
  labour: number;
  overhead: number;
  byProducts: number;
  batch: number;
  perUnit: number;
}
interface BomRow {
  id: string;
  code: string;
  name: string;
  productId: string;
  kind: 'STANDARD' | 'FORMULA';
  outputQty: string;
  normalScrapPct: string;
  labourCost: string;
  overheadCost: string;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  product: Prod;
  lineCount?: number;
  operationCount?: number;
  outputCount?: number;
  estimate: Estimate | null;
  lines?: { id: string; productId: string; qty: string; pct: string | null; scrapPct: string; phantom: boolean; operationSeq: number | null; notes: string | null; product: Prod; hasBom: boolean }[];
  operations?: { id: string; seq: number; name: string; kind?: 'INTERNAL' | 'SUBCONTRACT'; workCenterId: string | null; supplierId?: string | null; servicePrice?: string; setupMinutes: string; runMinutes: string; instructions: string | null; workCenter: { code: string; name: string } | null }[];
  outputs?: { id: string; productId: string; kind: 'CO' | 'BY'; qty: string; costSharePct: string; nrvPerUnit: string; product: Prod }[];
}
interface OrderLine {
  id: string;
  productId: string;
  plannedQty: string;
  consumedQty: string;
  issuedQty: string;
  unitCost: string;
  operationSeq: number | null;
  product: (Prod & { trackLots?: boolean }) | null;
  available: number;
  shortage: number;
  estCost: number;
  hasBom: boolean;
}
interface Operation {
  id: string;
  seq: number;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'DONE';
  plannedMinutes: string;
  actualMinutes: string;
  goodQty: string;
  scrapQty: string;
  runningSince: string | null;
  appliedCost: string;
  workCenter: { code: string; name: string } | null;
  kind?: 'INTERNAL' | 'SUBCONTRACT';
  supplierName?: string | null;
  servicePrice?: string;
  sentAt?: string | null;
  receivedAt?: string | null;
  invoiceId?: string | null;
}
interface Order {
  id: string;
  number: string;
  status: 'DRAFT' | 'RELEASED' | 'DONE' | 'CANCELLED';
  qty: string;
  producedQty: string;
  scrapQty: string;
  plannedDate: string;
  completedDate: string | null;
  labourCost: string;
  overheadCost: string;
  materialCost: string;
  totalCost: string;
  unitCost: string;
  wipMaterial: string;
  wipConversion: string;
  abnormalLoss: string;
  byProductValue: string;
  standardCost: string;
  lotNo: string | null;
  expiryDate: string | null;
  notes: string | null;
  steps?: number;
  stepsDone?: number;
  product: (Prod & { trackLots?: boolean }) | null;
  bom?: { code: string; name: string; outputQty: string; normalScrapPct: string; kind: string } | null;
  parent?: { id: string; number: string } | null;
  children?: { id: string; number: string; status: Order['status']; qty: string; product: Prod }[];
  warehouseName?: string;
  outputWarehouseName?: string;
  lines?: OrderLine[];
  operations?: Operation[];
  outputs?: { id: string; productId: string; kind: 'CO' | 'BY'; plannedQty: string; producedQty: string; unitCost: string; costSharePct: string; nrvPerUnit: string; product: Prod }[];
  costs?: { standardMaterial: number; standardConversion: number; actualMaterial: number; actualConversion: number };
}

const STATUS: Record<Order['status'], { label: string; tone: 'gray' | 'blue' | 'green' | 'red' }> = {
  DRAFT: { label: 'Draft', tone: 'gray' },
  RELEASED: { label: 'Released', tone: 'blue' },
  DONE: { label: 'Done', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
};

// ============================================================ bills of materials
export function BomListPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['mfg', 'boms'], queryFn: () => api.get<BomRow[]>('/manufacturing/boms') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Bills of Materials"
        subtitle="What goes into each product (quantities or a formula), the production steps, and co- / by-products"
        actions={
          can('manufacturing.bom.create') && (
            <Button icon="plus" onClick={() => navigate('/manufacturing/boms/new')}>
              New BOM
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="list-tree" title="No bills of materials yet" description="Describe the components of a product you make; work orders then issue them and value the result." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((b) => (
              <li key={b.id}>
                <Link to={`/manufacturing/boms/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                    <Icon name="list-tree" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      {b.name} {b.isDefault && <Badge tone="blue">Default</Badge>} {!b.isActive && <Badge tone="gray">Inactive</Badge>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {b.code} · makes {fmtNumber(b.outputQty)} × {b.product?.name ?? '-'} · {b.lineCount} component(s){b.operationCount ? ` · ${b.operationCount} step(s)` : ''}{b.outputCount ? ` · ${b.outputCount} co/by-product(s)` : ''}{b.kind === 'FORMULA' ? ' · formula' : ''}
                    </span>
                  </span>
                  {b.estimate && (
                    <span className="text-right text-sm">
                      <span className="block font-semibold tabular-nums">{fmtMoney(b.estimate.perUnit)}</span>
                      <span className="block text-xs text-slate-500">est. cost / unit</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type EditLine = { key: string; productId: string | null; qty: string; pct: string; scrapPct: string; phantom: boolean; operationSeq: string; notes: string };
type EditOp = { key: string; seq: string; name: string; kind: 'INTERNAL' | 'SUBCONTRACT'; workCenterId: string | null; supplierId: string | null; servicePrice: string; setupMinutes: string; runMinutes: string; instructions: string };
type EditOut = { key: string; productId: string | null; kind: 'CO' | 'BY'; qty: string; costSharePct: string; nrvPerUnit: string };
let k = 0;
const blank = (): EditLine => ({ key: `l${++k}`, productId: null, qty: '1', pct: '', scrapPct: '0', phantom: false, operationSeq: '', notes: '' });
const blankOp = (seq: number): EditOp => ({ key: `o${++k}`, seq: String(seq), name: '', kind: 'INTERNAL', workCenterId: null, supplierId: null, servicePrice: '0', setupMinutes: '0', runMinutes: '0', instructions: '' });
const blankOut = (): EditOut => ({ key: `x${++k}`, productId: null, kind: 'BY', qty: '1', costSharePct: '0', nrvPerUnit: '0' });

export function BomEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['mfg', 'bom', id], queryFn: () => api.get<BomRow>(`/manufacturing/boms/${id}`), enabled: !isNew });
  const [f, setF] = useState({ code: '', name: '', productId: '' as string | null, kind: 'STANDARD' as 'STANDARD' | 'FORMULA', outputQty: '1', normalScrapPct: '0', labourCost: '0', overheadCost: '0', isDefault: true, isActive: true, notes: '' });
  const [lines, setLines] = useState<EditLine[]>([blank()]);
  const [ops, setOps] = useState<EditOp[]>([]);
  const [outs, setOuts] = useState<EditOut[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const b = q.data;
    if (!b) return;
    setF({ code: b.code, name: b.name, productId: b.productId, kind: b.kind, outputQty: String(Number(b.outputQty)), normalScrapPct: String(Number(b.normalScrapPct)), labourCost: String(Number(b.labourCost)), overheadCost: String(Number(b.overheadCost)), isDefault: b.isDefault, isActive: b.isActive, notes: b.notes ?? '' });
    setLines((b.lines ?? []).map((l) => ({ key: l.id, productId: l.productId, qty: String(Number(l.qty)), pct: l.pct === null ? '' : String(Number(l.pct)), scrapPct: String(Number(l.scrapPct)), phantom: l.phantom, operationSeq: l.operationSeq ? String(l.operationSeq) : '', notes: l.notes ?? '' })));
    setOps((b.operations ?? []).map((o) => ({ key: o.id, seq: String(o.seq), name: o.name, kind: o.kind ?? 'INTERNAL', workCenterId: o.workCenterId, supplierId: o.supplierId ?? null, servicePrice: String(Number(o.servicePrice ?? 0)), setupMinutes: String(Number(o.setupMinutes)), runMinutes: String(Number(o.runMinutes)), instructions: o.instructions ?? '' })));
    setOuts((b.outputs ?? []).map((o) => ({ key: o.id, productId: o.productId, kind: o.kind, qty: String(Number(o.qty)), costSharePct: String(Number(o.costSharePct)), nrvPerUnit: String(Number(o.nrvPerUnit)) })));
  }, [q.data]);
  const formula = f.kind === 'FORMULA';
  const pctTotal = lines.reduce((a, l) => a + (Number(l.pct) || 0), 0);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        code: f.code || undefined,
        outputQty: Number(f.outputQty),
        normalScrapPct: Number(f.normalScrapPct) || 0,
        labourCost: Number(f.labourCost) || 0,
        overheadCost: Number(f.overheadCost) || 0,
        lines: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: formula ? 0 : Number(l.qty), pct: formula ? Number(l.pct) || 0 : null, scrapPct: Number(l.scrapPct) || 0, phantom: l.phantom, operationSeq: l.operationSeq ? Number(l.operationSeq) : null, notes: l.notes })),
        operations: ops.filter((o) => (o.kind === 'SUBCONTRACT' ? o.supplierId : o.workCenterId) && o.name.trim()).map((o) => ({ seq: Number(o.seq), name: o.name, kind: o.kind, workCenterId: o.kind === 'INTERNAL' ? o.workCenterId : null, supplierId: o.kind === 'SUBCONTRACT' ? o.supplierId : null, servicePrice: Number(o.servicePrice) || 0, setupMinutes: Number(o.setupMinutes) || 0, runMinutes: Number(o.runMinutes) || 0, instructions: o.instructions })),
        outputs: outs.filter((o) => o.productId).map((o) => ({ productId: o.productId, kind: o.kind, qty: Number(o.qty), costSharePct: Number(o.costSharePct) || 0, nrvPerUnit: Number(o.nrvPerUnit) || 0 })),
      };
      return isNew ? api.post<{ id: string }>('/manufacturing/boms', body) : api.patch<{ id: string }>(`/manufacturing/boms/${id}`, body);
    },
    onSuccess: (b) => {
      toast.success('Bill of materials saved');
      qc.invalidateQueries({ queryKey: ['mfg'] });
      navigate(`/manufacturing/boms/${b.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  if (!isNew && q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  const editable = isNew ? can('manufacturing.bom.create') : can('manufacturing.bom.update');
  const est = q.data?.estimate;
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setOp = (key: string, patch: Partial<EditOp>) => setOps((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setOut = (key: string, patch: Partial<EditOut>) => setOuts((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const subBom = new Set((q.data?.lines ?? []).filter((l) => l.hasBom).map((l) => l.productId));
  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? 'New bill of materials' : `${q.data?.code} · ${q.data?.name}`}
        back={() => navigate('/manufacturing/boms')}
        actions={
          <div className="flex gap-2">
            {!isNew && can('manufacturing.order.create') && (
              <Button variant="outline" icon="play" onClick={() => navigate(`/manufacturing/orders?bom=${id}`)}>
                New work order
              </Button>
            )}
            {editable && (
              <Button icon="save" loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Product" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}>
              <Input value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Standard recipe" />
            </Field>
            <Field label="Code" help="Empty = automatic">
              <Input value={f.code} maxLength={30} disabled={!isNew} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label="Product made" required error={errors.productId}>
              <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
            </Field>
            <Field label="Kind">
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['STANDARD', 'Quantities', 'parts per batch (assembly)'],
                    ['FORMULA', 'Formula %', 'share of the batch (paint, food, feed)'],
                  ] as const
                ).map(([v, label, hint]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, kind: v })} className={cn('rounded-lg px-2 py-1.5 text-left text-xs ring-1', f.kind === v ? 'bg-brand-600 text-white ring-brand-600' : 'ring-line')}>
                    <span className="block font-medium">{label}</span>
                    <span className="opacity-80">{hint}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label={formula ? 'Batch size' : 'Quantity per batch'} required help={formula ? 'Weight / volume of one batch, in the unit of the product' : 'How many units one batch makes'}>
              <NumberInput decimals={4} min={0} value={f.outputQty} onChange={(v) => setF({ ...f, outputQty: v })} />
            </Field>
            <Field label="Normal loss of finished units %" help="Expected loss (evaporation, rejects). Losses above it are abnormal: expensed, not in the stock value (SAK EP / PSAK 202)">
              <NumberInput decimals={2} min={0} max={100} value={f.normalScrapPct} onChange={(v) => setF({ ...f, normalScrapPct: v })} />
            </Field>
            {!ops.length && (
              <>
                <Field label="Direct labour per batch" help="Only when there is no routing below">
                  <NumberInput fixed={2} min={0} value={f.labourCost} onChange={(v) => setF({ ...f, labourCost: v })} />
                </Field>
                <Field label="Production overhead per batch" help="At normal capacity (SAK EP)">
                  <NumberInput fixed={2} min={0} value={f.overheadCost} onChange={(v) => setF({ ...f, overheadCost: v })} />
                </Field>
              </>
            )}
            <div className="flex flex-wrap gap-6 sm:col-span-2">
              <Switch checked={f.isDefault} onChange={(v) => setF({ ...f, isDefault: v })} label="Default BOM of this product" />
              <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
            </div>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Standard cost" subtitle="Rolled up through sub-assemblies, from current average costs">
          {est ? (
            <dl className="space-y-2 text-sm">
              {[
                ['Materials', est.material],
                ['Routing (labour, machine, overhead)', est.conversion],
                ['Flat labour', est.labour],
                ['Flat overhead', est.overhead],
                ['By-products (NRV)', -est.byProducts],
              ]
                .filter(([, v]) => v)
                .map(([l, v]) => (
                  <div key={l as string} className="flex justify-between">
                    <dt className="text-slate-500">{l}</dt>
                    <dd className="tabular-nums">{fmtMoney(v as number, 0)}</dd>
                  </div>
                ))}
              <div className="flex justify-between border-t border-line pt-2 font-semibold">
                <dt>Per batch</dt>
                <dd className="tabular-nums">{fmtMoney(est.batch, 0)}</dd>
              </div>
              <div className="flex justify-between text-brand-700">
                <dt>Per good unit</dt>
                <dd className="font-semibold tabular-nums">{fmtMoney(est.perUnit)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Save to see the estimate.</p>
          )}
        </Card>
      </div>
      <Card
        title="Components"
        subtitle={formula ? `Share of the batch; must total 100% (now ${fmtNumber(pctTotal)}%)` : 'Per batch; scrap % is added to the quantity issued. A phantom component is not stocked: its own BOM is used instead'}
        bodyClass="p-0"
      >
        {errors.lines && <p className="px-4 pt-3 text-xs text-red-600">{errors.lines}</p>}
        <ul className="divide-y divide-line">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_7rem_5.5rem_5.5rem_auto_auto] sm:items-end">
              <Field label={i === 0 ? 'Component' : undefined} error={errors[`lines.${i}.productId`]}>
                <AsyncSelect resource="products" value={l.productId} onChange={(v) => setLine(l.key, { productId: v })} aria-label={`Component ${i + 1}`} />
              </Field>
              <Field label={i === 0 ? (formula ? 'Share %' : 'Qty') : undefined} error={errors[`lines.${i}.qty`]}>
                {formula ? <NumberInput decimals={4} min={0} max={100} value={l.pct} onChange={(v) => setLine(l.key, { pct: v })} aria-label={`Share ${i + 1}`} /> : <NumberInput decimals={4} min={0} value={l.qty} onChange={(v) => setLine(l.key, { qty: v })} aria-label={`Quantity ${i + 1}`} />}
              </Field>
              <Field label={i === 0 ? 'Scrap %' : undefined}>
                <NumberInput decimals={2} min={0} max={100} value={l.scrapPct} onChange={(v) => setLine(l.key, { scrapPct: v })} aria-label={`Scrap ${i + 1}`} />
              </Field>
              <Field label={i === 0 ? 'At step' : undefined} error={errors[`lines.${i}.operationSeq`]}>
                <Select value={l.operationSeq} placeholder="Start" onChange={(e) => setLine(l.key, { operationSeq: e.target.value })} options={ops.filter((o) => o.seq).map((o) => ({ value: o.seq, label: `${o.seq} ${o.name}`.trim() }))} aria-label={`Step ${i + 1}`} />
              </Field>
              <div className="flex h-10 items-center gap-1.5">
                <Checkbox checked={l.phantom} onChange={(v) => setLine(l.key, { phantom: v })} label="Phantom" />
                {l.productId && subBom.has(l.productId) && !l.phantom && <Badge tone="violet">Sub-assembly</Badge>}
              </div>
              <Button variant="ghost" size="icon" icon="trash-2" disabled={lines.length <= 1} onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))} aria-label="Remove component" />
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-3">
          <Button size="sm" variant="outline" icon="plus" onClick={() => setLines((xs) => [...xs, blank()])}>
            Add component
          </Button>
        </div>
      </Card>
      <Card title="Routing" subtitle="Production steps at work centres: set-up minutes per batch and run minutes per unit. Steps cost actual minutes × the work centre rates" bodyClass="p-0">
        {errors.operations && <p className="px-4 pt-3 text-xs text-red-600">{errors.operations}</p>}
        {!ops.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">No steps: the flat labour and overhead above are used.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ops.map((o, i) => (
              <li key={o.key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[4.5rem_1fr_1fr_6rem_6rem_auto] sm:items-end">
                <Field label={i === 0 ? 'Step' : undefined}>
                  <NumberInput min={1} max={999} value={o.seq} onChange={(v) => setOp(o.key, { seq: v })} aria-label={`Step number ${i + 1}`} />
                </Field>
                <Field label={i === 0 ? 'Name' : undefined}>
                  <Input value={o.name} maxLength={120} onChange={(e) => setOp(o.key, { name: e.target.value })} placeholder="Mixing, cutting, assembly..." />
                </Field>
                <Field label={i === 0 ? 'Done by' : undefined}>
                  <div className="flex gap-1">
                    <Select
                      value={o.kind}
                      onChange={(e) => setOp(o.key, { kind: e.target.value as EditOp['kind'] })}
                      options={[
                        { value: 'INTERNAL', label: 'In house' },
                        { value: 'SUBCONTRACT', label: 'Maklon' },
                      ]}
                      className="w-32 shrink-0"
                      aria-label={`Done by ${i + 1}`}
                    />
                    {o.kind === 'INTERNAL' ? (
                      <AsyncSelect resource="work-centers" value={o.workCenterId} onChange={(v) => setOp(o.key, { workCenterId: v })} manageHref="/r/work-centers" manageLabel="Manage work centres" aria-label={`Work centre ${i + 1}`} />
                    ) : (
                      <AsyncSelect resource="suppliers" value={o.supplierId} onChange={(v) => setOp(o.key, { supplierId: v })} placeholder="Subcontractor" aria-label={`Subcontractor ${i + 1}`} />
                    )}
                  </div>
                </Field>
                {o.kind === 'INTERNAL' ? (
                  <>
                    <Field label={i === 0 ? 'Set-up min' : undefined}>
                      <NumberInput decimals={2} min={0} value={o.setupMinutes} onChange={(v) => setOp(o.key, { setupMinutes: v })} aria-label={`Set-up ${i + 1}`} />
                    </Field>
                    <Field label={i === 0 ? 'Min / unit' : undefined}>
                      <NumberInput decimals={4} min={0} value={o.runMinutes} onChange={(v) => setOp(o.key, { runMinutes: v })} aria-label={`Run ${i + 1}`} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label={i === 0 ? 'Fee / unit' : undefined} help={i === 0 ? 'Excl. PPN; PPh 23 2% withheld when paying' : undefined}>
                      <NumberInput fixed={2} min={0} value={o.servicePrice} onChange={(v) => setOp(o.key, { servicePrice: v })} aria-label={`Fee ${i + 1}`} />
                    </Field>
                    <span />
                  </>
                )}
                <Button variant="ghost" size="icon" icon="trash-2" onClick={() => setOps((xs) => xs.filter((x) => x.key !== o.key))} aria-label="Remove step" />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-3">
          <Button size="sm" variant="outline" icon="plus" onClick={() => setOps((xs) => [...xs, blankOp((Math.max(0, ...xs.map((x) => Number(x.seq) || 0)) || 0) + 10)])}>
            Add step
          </Button>
        </div>
      </Card>
      <Card title="Co- and by-products" subtitle="Other products the batch yields. Co-products share the joint cost by %; by-products are valued at net realisable value and lower the cost of the main product" bodyClass="p-0">
        {errors.outputs && <p className="px-4 pt-3 text-xs text-red-600">{errors.outputs}</p>}
        {outs.length > 0 && (
          <ul className="divide-y divide-line">
            {outs.map((o, i) => (
              <li key={o.key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_9rem_7rem_8rem_auto] sm:items-end">
                <Field label={i === 0 ? 'Product' : undefined} error={errors[`outputs.${i}.productId`]}>
                  <AsyncSelect resource="products" value={o.productId} onChange={(v) => setOut(o.key, { productId: v })} aria-label={`Output ${i + 1}`} />
                </Field>
                <Field label={i === 0 ? 'Kind' : undefined}>
                  <Select
                    value={o.kind}
                    onChange={(e) => setOut(o.key, { kind: e.target.value as 'CO' | 'BY' })}
                    options={[
                      { value: 'BY', label: 'By-product' },
                      { value: 'CO', label: 'Co-product' },
                    ]}
                  />
                </Field>
                <Field label={i === 0 ? 'Qty / batch' : undefined}>
                  <NumberInput decimals={4} min={0} value={o.qty} onChange={(v) => setOut(o.key, { qty: v })} />
                </Field>
                {o.kind === 'CO' ? (
                  <Field label={i === 0 ? 'Cost share %' : undefined}>
                    <NumberInput decimals={2} min={0} max={99} value={o.costSharePct} onChange={(v) => setOut(o.key, { costSharePct: v })} />
                  </Field>
                ) : (
                  <Field label={i === 0 ? 'NRV / unit' : undefined}>
                    <NumberInput fixed={2} min={0} value={o.nrvPerUnit} onChange={(v) => setOut(o.key, { nrvPerUnit: v })} />
                  </Field>
                )}
                <Button variant="ghost" size="icon" icon="trash-2" onClick={() => setOuts((xs) => xs.filter((x) => x.key !== o.key))} aria-label="Remove output" />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line p-3">
          <Button size="sm" variant="outline" icon="plus" onClick={() => setOuts((xs) => [...xs, blankOut()])}>
            Add co- / by-product
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ============================================================ work orders
export function WorkOrderListPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('bom'));
  const q = useQuery({ queryKey: ['mfg', 'orders', status], queryFn: () => api.get<Order[]>('/manufacturing/orders', status ? { status } : undefined) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Work Orders"
        subtitle="Production: issue components, receive finished products at full production cost"
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            {can('manufacturing.order.create') && (
              <Button icon="plus" onClick={() => setOpen('')}>
                New work order
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
          <EmptyState icon="clipboard-list" title="No work orders" description="Create one from a bill of materials." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((o) => (
              <li key={o.id}>
                <Link to={`/manufacturing/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      {o.number} · {o.product?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtNumber(o.status === 'DONE' ? o.producedQty : o.qty)} units · {fmtDate(o.completedDate ?? o.plannedDate)}
                      {o.status === 'DONE' ? ` · ${fmtMoney(o.unitCost)} / unit` : ''}
                      {o.status === 'RELEASED' && o.steps ? ` · step ${o.stepsDone}/${o.steps}` : ''}
                    </span>
                  </span>
                  <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open !== null && <NewOrderModal bomId={open || null} onClose={() => setOpen(null)} onCreated={(id) => navigate(`/manufacturing/orders/${id}`)} />}
    </div>
  );
}

function NewOrderModal({ bomId, onClose, onCreated }: { bomId: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const boms = useQuery({ queryKey: ['mfg', 'boms'], queryFn: () => api.get<BomRow[]>('/manufacturing/boms') });
  const [f, setF] = useState({ bomId: bomId ?? '', qty: '', warehouseId: '' as string | null, outputWarehouseId: '' as string | null, plannedDate: isoDate(), lotNo: '', expiryDate: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bom = boms.data?.find((b) => b.id === f.bomId);
  useEffect(() => {
    if (bom && !f.qty) setF((x) => ({ ...x, qty: String(Number(bom.outputQty)) }));
  }, [bom, f.qty]);
  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>('/manufacturing/orders', { ...f, qty: Number(f.qty), outputWarehouseId: f.outputWarehouseId || null, expiryDate: f.expiryDate || null }),
    onSuccess: (w) => {
      toast.success(`Work order ${w.number} created`);
      qc.invalidateQueries({ queryKey: ['mfg'] });
      onCreated(w.id);
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
      title="New work order"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="check" loading={save.isPending} disabled={!f.bomId || !(Number(f.qty) > 0) || !f.warehouseId} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bill of materials" required className="sm:col-span-2" error={errors.bomId}>
          <Select value={f.bomId} onChange={(e) => setF({ ...f, bomId: e.target.value, qty: '' })} placeholder="Choose" options={(boms.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}`, hint: `${b.product?.name ?? ''} · ${fmtNumber(b.outputQty)} per batch` }))} />
        </Field>
        <Field label="Quantity to make" required error={errors.qty}>
          <NumberInput decimals={4} min={0} value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        <Field label="Planned date" required>
          <DatePicker clearable={false} value={f.plannedDate} onChange={(v) => setF({ ...f, plannedDate: v })} />
        </Field>
        <Field label="Components from warehouse" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
        </Field>
        <Field label="Finished goods to warehouse" help="Empty = same warehouse">
          <AsyncSelect resource="warehouses" value={f.outputWarehouseId} onChange={(v) => setF({ ...f, outputWarehouseId: v })} />
        </Field>
        <Field label="Batch / lot no." help="For lot-tracked products (empty = work order no.)">
          <Input value={f.lotNo} maxLength={60} onChange={(e) => setF({ ...f, lotNo: e.target.value })} />
        </Field>
        <Field label="Expiry date">
          <DatePicker value={f.expiryDate} onChange={(v) => setF({ ...f, expiryDate: v })} />
        </Field>
      </div>
    </Modal>
  );
}

const OP_STATUS: Record<Operation['status'], { label: string; tone: 'gray' | 'blue' | 'amber' | 'green' }> = {
  PENDING: { label: 'Waiting', tone: 'gray' },
  RUNNING: { label: 'Running', tone: 'blue' },
  PAUSED: { label: 'Paused', tone: 'amber' },
  DONE: { label: 'Done', tone: 'green' },
};
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

export function WorkOrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [finishing, setFinishing] = useState(false);
  const [reporting, setReporting] = useState<Operation | null>(null);
  const q = useQuery({ queryKey: ['mfg', 'order', id], queryFn: () => api.get<Order>(`/manufacturing/orders/${id}`) });
  const o = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['mfg'] });
  if (q.isLoading || !o)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  const open = o.status === 'DRAFT' || o.status === 'RELEASED';
  const shortages = (o.lines ?? []).filter((l) => l.shortage > 0);
  const subShort = shortages.filter((l) => l.hasBom);
  const issuedAll = (o.lines ?? []).every((l) => Number(l.issuedQty) >= Number(l.plannedQty));
  const act = async (path: string, msg: string, ask?: { title: string; message: string; danger?: boolean }, body?: unknown) => {
    if (ask && !(await confirm({ ...ask, confirmText: 'Yes' }))) return;
    try {
      const r = await api.post<{ created?: string[] }>(`/manufacturing/${path}`, body);
      toast.success(r?.created ? (r.created.length ? `Created ${r.created.join(', ')}` : 'Nothing to make: no sub-assembly is short') : msg);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const c = o.costs;
  const actual = c ? c.actualMaterial + c.actualConversion : 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {o.number} <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
          </span>
        }
        subtitle={
          <>
            {fmtNumber(o.qty)} × {o.product?.name ?? '-'} · {o.bom?.code ?? ''} · planned {fmtDate(o.plannedDate)}
            {o.parent && (
              <>
                {' · for '}
                <Link className="text-brand-700 hover:underline" to={`/manufacturing/orders/${o.parent.id}`}>
                  {o.parent.number}
                </Link>
              </>
            )}
          </>
        }
        back={() => navigate('/manufacturing/orders')}
        actions={
          <div className="flex flex-wrap gap-2">
            {o.status === 'DRAFT' && can('manufacturing.order.create') && (
              <Button variant="outline" icon="send" onClick={() => act(`orders/${id}/release`, 'Released to production')}>
                Release
              </Button>
            )}
            {open && subShort.length > 0 && can('manufacturing.order.create') && (
              <Button variant="outline" icon="list-tree" onClick={() => act(`orders/${id}/sub-orders`, '')}>
                Make sub-assemblies
              </Button>
            )}
            {o.status === 'RELEASED' && !issuedAll && can('manufacturing.order.confirm') && (
              <Button variant="outline" icon="package-minus" onClick={() => act(`orders/${id}/issue`, 'Materials issued to production', { title: 'Issue all remaining materials?', message: 'They leave the warehouse into work in process.' }, { date: isoDate(), lines: [] })}>
                Issue materials
              </Button>
            )}
            {open && can('manufacturing.order.confirm') && (
              <Button icon="check-circle-2" onClick={() => setFinishing(true)}>
                Finish production
              </Button>
            )}
            {o.status !== 'CANCELLED' && can('manufacturing.order.cancel') && (
              <Button variant="outline" icon="ban" onClick={() => act(`orders/${id}/cancel`, 'Work order cancelled', { title: `Cancel ${o.number}?`, message: 'Materials issued go back to stock, products received are taken out again and every journal of this order is voided.', danger: true })}>
                Cancel
              </Button>
            )}
          </div>
        }
      />
      {(o.operations?.length ?? 0) > 0 && (
        <Card title="Routing" subtitle="Steps are reported on the Shop Floor screen (or here); their actual minutes cost the work centre rates" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Step</th>
                <th className="px-3 py-2 text-left font-semibold">Work centre</th>
                <th className="px-3 py-2 text-right font-semibold">Planned</th>
                <th className="px-3 py-2 text-right font-semibold">Actual</th>
                <th className="px-3 py-2 text-right font-semibold">Good / scrap</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {o.operations!.map((op) => (
                <tr key={op.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <span className="font-medium">
                      {op.seq} · {op.name}
                    </span>{' '}
                    <Badge tone={OP_STATUS[op.status].tone}>{OP_STATUS[op.status].label}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {op.kind === 'SUBCONTRACT' ? (
                      <span>
                        <Badge tone="violet">Maklon</Badge> {op.supplierName}
                        <span className="block text-xs text-slate-500">
                          {fmtMoney(op.servicePrice ?? 0, 0)} / unit{op.invoiceId ? ' · invoice drafted' : ''}
                        </span>
                      </span>
                    ) : (
                      op.workCenter?.name
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{op.kind === 'SUBCONTRACT' ? '-' : mins(Number(op.plannedMinutes))}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums', Number(op.actualMinutes) > Number(op.plannedMinutes) * 1.1 && 'text-amber-700')}>{op.kind === 'SUBCONTRACT' ? (op.sentAt ? `sent ${fmtDate(op.sentAt)}` : '-') : op.status === 'PENDING' ? '-' : mins(Number(op.actualMinutes))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{op.status === 'DONE' ? `${fmtNumber(op.goodQty)} / ${fmtNumber(op.scrapQty)}` : '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(op.appliedCost, 0)}</td>
                  <td className="px-4 py-2 text-right">
                    {o.status === 'RELEASED' && op.status !== 'DONE' && can('manufacturing.order.report') && (
                      <div className="flex justify-end gap-1">
                        {op.kind === 'SUBCONTRACT' ? (
                          op.status === 'PENDING' ? (
                            <Button size="sm" variant="outline" icon="truck" onClick={() => act(`operations/${op.id}/start`, `Materials sent to ${op.supplierName}`)}>
                              Send
                            </Button>
                          ) : (
                            <Link to="/manufacturing/subcontracting" className="self-center text-xs text-brand-700 hover:underline">
                              Delivery note
                            </Link>
                          )
                        ) : op.status !== 'RUNNING' ? (
                          <Button size="sm" variant="outline" icon="play" onClick={() => act(`operations/${op.id}/start`, `Step ${op.seq} started`)}>
                            Start
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" icon="pause" onClick={() => act(`operations/${op.id}/pause`, 'Paused')}>
                            Pause
                          </Button>
                        )}
                        <Button size="sm" icon="check" onClick={() => setReporting(op)}>
                          {op.kind === 'SUBCONTRACT' ? 'Receive' : 'Finish'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Materials" subtitle={`From ${o.warehouseName}`} className="lg:col-span-2" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Component</th>
                <th className="px-3 py-2 text-right font-semibold">{o.status === 'DONE' ? 'Used' : 'Needed'}</th>
                {open && <th className="px-3 py-2 text-right font-semibold">Issued</th>}
                {open && <th className="px-3 py-2 text-right font-semibold">Available</th>}
                <th className="px-4 py-2 text-right font-semibold">{o.status === 'DONE' ? 'Cost' : 'Est. cost'}</th>
              </tr>
            </thead>
            <tbody>
              {(o.lines ?? []).map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <span className="font-medium">{l.product?.name}</span> {l.hasBom && <Badge tone="violet">Sub-assembly</Badge>}
                    <span className="block text-xs text-slate-500">
                      {l.product?.code}
                      {l.operationSeq ? ` · at step ${l.operationSeq}` : ''}
                      {l.product?.trackLots ? ' · lot-tracked (FEFO)' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNumber(o.status === 'DONE' ? l.consumedQty : l.plannedQty)} {l.product?.uom?.code ?? ''}
                  </td>
                  {open && <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(l.issuedQty)}</td>}
                  {open && <td className={cn('px-3 py-2 text-right tabular-nums', l.shortage > 0 ? 'font-medium text-red-600' : 'text-emerald-700')}>{fmtNumber(l.available)}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(o.status === 'DONE' || Number(l.issuedQty) > 0 ? Number(l.consumedQty) * Number(l.unitCost) : l.estCost, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open && shortages.length > 0 && (
            <p className="flex items-center gap-2 border-t border-line bg-red-50 px-4 py-2 text-xs text-red-700">
              <Icon name="triangle-alert" className="h-4 w-4" /> {shortages.length} component(s) short.{subShort.length ? ' Sub-assemblies can be made with "Make sub-assemblies".' : ''} Buy the rest (Inventory &gt; Reorder Planner).
            </p>
          )}
        </Card>
        <Card title={o.status === 'DONE' ? 'Production cost' : 'Cost so far'} subtitle={o.status === 'DONE' ? undefined : 'Work in process vs the standard'}>
          <dl className="space-y-2 text-sm">
            {c && o.status !== 'DONE' && (
              <>
                {[
                  ['Materials', c.actualMaterial, c.standardMaterial],
                  ['Conversion', c.actualConversion, c.standardConversion],
                ].map(([l, a, s]) => (
                  <div key={l as string} className="flex justify-between">
                    <dt className="text-slate-500">{l}</dt>
                    <dd className="tabular-nums">
                      {fmtMoney(a as number, 0)} <span className="text-xs text-slate-400">/ std {fmtMoney(s as number, 0)}</span>
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-2 font-semibold">
                  <dt>In work in process</dt>
                  <dd className="tabular-nums">{fmtMoney(actual, 0)}</dd>
                </div>
              </>
            )}
            {o.status === 'DONE' && (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Total cost</dt>
                  <dd className="tabular-nums">{fmtMoney(o.totalCost, 0)}</dd>
                </div>
                {Number(o.byProductValue) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">By-products (NRV)</dt>
                    <dd className="tabular-nums">−{fmtMoney(o.byProductValue, 0)}</dd>
                  </div>
                )}
                {Number(o.abnormalLoss) > 0 && (
                  <div className="flex justify-between text-red-700">
                    <dt>Abnormal loss (expensed)</dt>
                    <dd className="tabular-nums">−{fmtMoney(o.abnormalLoss, 0)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-2 text-brand-700">
                  <dt>Per unit ({fmtNumber(o.producedQty)} made{Number(o.scrapQty) ? `, ${fmtNumber(o.scrapQty)} lost` : ''})</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(o.unitCost)}</dd>
                </div>
                {Number(o.standardCost) > 0 && (
                  <div className="flex justify-between text-xs">
                    <dt className="text-slate-500">Standard for this quantity</dt>
                    <dd className={cn('tabular-nums', Number(o.producedQty) * Number(o.unitCost) > Number(o.standardCost) ? 'text-red-600' : 'text-emerald-700')}>
                      {fmtMoney(o.standardCost, 0)} ({Number(o.producedQty) * Number(o.unitCost) > Number(o.standardCost) ? 'over' : 'under'} by {fmtMoney(Math.abs(Number(o.producedQty) * Number(o.unitCost) - Number(o.standardCost)), 0)})
                    </dd>
                  </div>
                )}
                {(o.outputs ?? []).filter((x) => Number(x.producedQty) > 0).map((x) => (
                  <div key={x.id} className="flex justify-between text-xs text-slate-500">
                    <dt>
                      {x.kind === 'BY' ? 'By' : 'Co'}-product {x.product?.name}
                    </dt>
                    <dd className="tabular-nums">
                      {fmtNumber(x.producedQty)} × {fmtMoney(x.unitCost)}
                    </dd>
                  </div>
                ))}
                <p className="pt-1 text-xs text-slate-500">
                  Into {o.outputWarehouseName}
                  {o.lotNo ? ` · lot ${o.lotNo}` : ''}
                  {o.expiryDate ? ` · expires ${fmtDate(o.expiryDate)}` : ''} · completed {fmtDate(o.completedDate)}
                </p>
              </>
            )}
          </dl>
        </Card>
      </div>
      {(o.children?.length ?? 0) > 0 && (
        <Card title="Sub-assembly orders" bodyClass="p-0">
          <ul className="divide-y divide-line">
            {o.children!.map((ch) => (
              <li key={ch.id}>
                <Link to={`/manufacturing/orders/${ch.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                  <span>
                    {ch.number} · {fmtNumber(ch.qty)} × {ch.product?.name}
                  </span>
                  <Badge tone={STATUS[ch.status].tone}>{STATUS[ch.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {finishing && (
        <FinishModal
          order={o}
          onClose={() => setFinishing(false)}
          onDone={() => {
            setFinishing(false);
            refresh();
          }}
        />
      )}
      {reporting && <StepFinishModal op={reporting} qty={Number(o.qty)} onClose={() => setReporting(null)} onDone={() => (setReporting(null), refresh())} />}
    </div>
  );
}

export function StepFinishModal({ op, qty, onClose, onDone }: { op: { id: string; seq: number; name: string; status: string; actualMinutes: string | number; runningSince: string | null; plannedMinutes: string | number; kind?: string; supplierName?: string | null; servicePrice?: string | number }; qty: number; onClose: () => void; onDone: () => void }) {
  const maklon = op.kind === 'SUBCONTRACT';
  const running = op.status === 'RUNNING' && op.runningSince ? (Date.now() - new Date(op.runningSince).getTime()) / 60000 : 0;
  const worked = Number(op.actualMinutes) + running;
  const [f, setF] = useState({ goodQty: String(qty), scrapQty: '0', minutes: worked > 0 ? String(Math.round(worked)) : String(Math.round(Number(op.plannedMinutes))), notes: '' });
  const save = useMutation({ mutationFn: () => api.post(`/manufacturing/operations/${op.id}/finish`, { goodQty: Number(f.goodQty) || 0, scrapQty: Number(f.scrapQty) || 0, ...(maklon ? {} : { minutes: Number(f.minutes) }), notes: f.notes }), onSuccess: () => (toast.success(maklon ? 'Received; the subcontractor invoice is drafted in Purchase Invoices' : `Step ${op.seq} finished`), onDone()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title={maklon ? `Receive from ${op.supplierName ?? 'the subcontractor'} · ${op.name}` : `Finish step ${op.seq} · ${op.name}`}
      size="sm"
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          {maklon ? 'Receive' : 'Finish step'}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Good quantity">
          <NumberInput decimals={4} min={0} value={f.goodQty} onChange={(v) => setF({ ...f, goodQty: v })} />
        </Field>
        <Field label="Scrap">
          <NumberInput decimals={4} min={0} value={f.scrapQty} onChange={(v) => setF({ ...f, scrapQty: v })} />
        </Field>
        {maklon ? (
          <p className="col-span-2 text-xs text-slate-500">
            Fee {fmtMoney(Number(op.servicePrice ?? 0) * (Number(f.goodQty) || 0), 0)} ({fmtNumber(f.goodQty)} × {fmtMoney(op.servicePrice ?? 0, 0)}) goes into work in process; a draft purchase invoice with PPN is made for the subcontractor. PPh 23 2% is withheld on the fee when you pay it (PMK 141/2015).
          </p>
        ) : (
          <Field label="Minutes worked" className="col-span-2" help={`Planned ${mins(Number(op.plannedMinutes))}${worked ? `, timer ${mins(worked)}` : ''}`}>
            <NumberInput decimals={1} min={0} value={f.minutes} onChange={(v) => setF({ ...f, minutes: v })} />
          </Field>
        )}
        <Field label="Notes" className="col-span-2">
          <Input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Machine stop, quality issue..." />
        </Field>
      </div>
    </Modal>
  );
}

function FinishModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: isoDate(), producedQty: String(Number(order.qty)), scrapQty: '0', lotNo: order.lotNo ?? '', expiryDate: order.expiryDate?.slice(0, 10) ?? '' });
  const [used, setUsed] = useState<Record<string, string>>(Object.fromEntries((order.lines ?? []).map((l) => [l.id, String(Number(l.issuedQty) > 0 ? Number(l.issuedQty) : Number(l.plannedQty))])));
  const [outs, setOuts] = useState<Record<string, string>>(Object.fromEntries((order.outputs ?? []).map((x) => [x.id, String(Number(x.plannedQty))])));
  const normal = Number(order.bom?.normalScrapPct ?? 0);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/manufacturing/orders/${order.id}/complete`, {
        ...f,
        producedQty: Number(f.producedQty),
        scrapQty: Number(f.scrapQty) || 0,
        expiryDate: f.expiryDate || null,
        lotNo: f.lotNo || null,
        consumed: Object.entries(used).map(([lineId, v]) => ({ lineId, qty: Number(v) || 0 })),
        outputs: Object.entries(outs).map(([outputId, v]) => ({ outputId, qty: Number(v) || 0 })),
      }),
    onSuccess: () => {
      toast.success('Production recorded: work in process closed into the finished goods');
      onDone();
    },
    onError: (e) => toast.error(e),
  });
  const total = (Number(f.producedQty) || 0) + (Number(f.scrapQty) || 0);
  const abnormal = Math.max(0, (Number(f.scrapQty) || 0) - (total * normal) / 100);
  const pending = (order.operations ?? []).filter((x) => x.status !== 'DONE');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Finish ${order.number}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="check" loading={save.isPending} disabled={!(Number(f.producedQty) > 0)} onClick={() => save.mutate()}>
            Record production
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Date">
            <DatePicker clearable={false} value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="Good units made">
            <NumberInput decimals={4} min={0} value={f.producedQty} onChange={(v) => setF({ ...f, producedQty: v })} />
          </Field>
          <Field label="Units lost" help={`Normal loss ${fmtNumber(normal)}%${abnormal > 0 ? `; ${fmtNumber(abnormal)} abnormal (expensed)` : ''}`}>
            <NumberInput decimals={4} min={0} value={f.scrapQty} onChange={(v) => setF({ ...f, scrapQty: v })} />
          </Field>
          {order.product?.trackLots && (
            <>
              <Field label="Batch / lot no.">
                <Input value={f.lotNo} maxLength={60} onChange={(e) => setF({ ...f, lotNo: e.target.value })} placeholder={order.number} />
              </Field>
              <Field label="Expiry date">
                <DatePicker value={f.expiryDate} onChange={(v) => setF({ ...f, expiryDate: v })} />
              </Field>
            </>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Materials actually used</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {(order.lines ?? []).map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{l.product?.name}</span>
                <span className="text-xs text-slate-500">
                  planned {fmtNumber(l.plannedQty)}
                  {Number(l.issuedQty) > 0 ? ` · issued ${fmtNumber(l.issuedQty)}` : ''}
                </span>
                <div className="w-28">
                  <NumberInput decimals={4} min={0} value={used[l.id] ?? ''} onChange={(v) => setUsed((u) => ({ ...u, [l.id]: v }))} aria-label={`Used ${l.product?.name}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        {(order.outputs?.length ?? 0) > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Co- and by-products received</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {order.outputs!.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">
                    {x.product?.name} <Badge tone="gray">{x.kind === 'BY' ? `by-product · NRV ${fmtMoney(x.nrvPerUnit)}` : `co-product · ${fmtNumber(x.costSharePct)}%`}</Badge>
                  </span>
                  <div className="w-28">
                    <NumberInput decimals={4} min={0} value={outs[x.id] ?? ''} onChange={(v) => setOuts((u) => ({ ...u, [x.id]: v }))} aria-label={`Received ${x.product?.name}`} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-slate-500">
          {pending.length > 0 && `${pending.length} step(s) not reported are costed at their planned time. `}
          Work in process (materials + steps) goes to: by-products at net realisable value, losses above the normal rate to expense (SAK EP / PSAK 202), co-products by their share, the rest to {order.product?.name}.
        </p>
      </div>
    </Modal>
  );
}

// ============================================================ SIINas production summary
export function ProductionSummaryPage() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [quarter, setQuarter] = useState(String(Math.floor(now.getMonth() / 3) + 1));
  const q = useQuery({
    queryKey: ['mfg', 'summary', year, quarter],
    queryFn: () => api.get<{ period: { from: string; to: string; due: string }; production: { code: string; name: string; uom: string; qty: number; value: number; orders: number }[]; materials: { code: string; name: string; uom: string; qty: number; value: number }[] }>('/manufacturing/production-summary', { year, quarter }),
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Production Summary (SIINas)"
        subtitle="What was produced and used per quarter, for the quarterly industry report in SIINas (Permenperin 13/2025)"
        actions={
          <div className="flex gap-2">
            <div className="w-28">
              <Select value={year} onChange={(e) => setYear(e.target.value)} options={Array.from({ length: 5 }, (_, i) => String(now.getFullYear() - i)).map((y) => ({ value: y, label: y }))} />
            </div>
            <div className="w-32">
              <Select value={quarter} onChange={(e) => setQuarter(e.target.value)} options={[1, 2, 3, 4].map((x) => ({ value: String(x), label: `Quarter ${x}` }))} />
            </div>
          </div>
        }
      />
      {!d ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            <Icon name="calendar-clock" className="h-4 w-4" />
            {fmtDate(d.period.from)} – {fmtDate(d.period.to)} · report in SIINas by {fmtDate(d.period.due)}. Labour, investment and energy data are entered in SIINas itself.
          </p>
          {[
            { title: 'Products made', rows: d.production, extra: true },
            { title: 'Materials used', rows: d.materials, extra: false },
          ].map((t) => (
            <Card key={t.title} title={t.title} bodyClass="p-0">
              {!t.rows.length ? (
                <EmptyState icon="factory" title="Nothing in this quarter" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Product</th>
                      <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                      <th className="px-4 py-2 text-right font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.code} className="border-t border-line">
                        <td className="px-4 py-2">
                          {r.name} <span className="text-xs text-slate-500">{r.code}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtNumber(r.qty)} {r.uom}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.value, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
