import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Icon, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

type Prod = { id: string; code: string; name: string; uom?: { code: string } | null } | null;
interface Estimate {
  material: number;
  labour: number;
  overhead: number;
  batch: number;
  perUnit: number;
}
interface BomRow {
  id: string;
  code: string;
  name: string;
  productId: string;
  outputQty: string;
  labourCost: string;
  overheadCost: string;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  product: Prod;
  lineCount?: number;
  estimate: Estimate | null;
  lines?: { id: string; productId: string; qty: string; scrapPct: string; notes: string | null; product: Prod }[];
}
interface OrderLine {
  id: string;
  productId: string;
  plannedQty: string;
  consumedQty: string;
  unitCost: string;
  product: (Prod & { trackLots?: boolean }) | null;
  available: number;
  shortage: number;
  estCost: number;
}
interface Order {
  id: string;
  number: string;
  status: 'DRAFT' | 'RELEASED' | 'DONE' | 'CANCELLED';
  qty: string;
  producedQty: string;
  plannedDate: string;
  completedDate: string | null;
  labourCost: string;
  overheadCost: string;
  materialCost: string;
  totalCost: string;
  unitCost: string;
  lotNo: string | null;
  expiryDate: string | null;
  notes: string | null;
  product: (Prod & { trackLots?: boolean }) | null;
  bom?: { code: string; name: string; outputQty: string } | null;
  warehouseName?: string;
  outputWarehouseName?: string;
  lines?: OrderLine[];
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
        subtitle="What goes into each product, and the labour and overhead per batch"
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
                      {b.code} · makes {fmtNumber(b.outputQty)} × {b.product?.name ?? '-'} · {b.lineCount} component(s)
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

type EditLine = { key: string; productId: string | null; qty: string; scrapPct: string; notes: string };
let k = 0;
const blank = (): EditLine => ({ key: `l${++k}`, productId: null, qty: '1', scrapPct: '0', notes: '' });

export function BomEditPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['mfg', 'bom', id], queryFn: () => api.get<BomRow>(`/manufacturing/boms/${id}`), enabled: !isNew });
  const [f, setF] = useState({ code: '', name: '', productId: '' as string | null, outputQty: '1', labourCost: '0', overheadCost: '0', isDefault: true, isActive: true, notes: '' });
  const [lines, setLines] = useState<EditLine[]>([blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const b = q.data;
    if (!b) return;
    setF({ code: b.code, name: b.name, productId: b.productId, outputQty: String(Number(b.outputQty)), labourCost: String(Number(b.labourCost)), overheadCost: String(Number(b.overheadCost)), isDefault: b.isDefault, isActive: b.isActive, notes: b.notes ?? '' });
    setLines((b.lines ?? []).map((l) => ({ key: l.id, productId: l.productId, qty: String(Number(l.qty)), scrapPct: String(Number(l.scrapPct)), notes: l.notes ?? '' })));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, code: f.code || undefined, outputQty: Number(f.outputQty), labourCost: Number(f.labourCost) || 0, overheadCost: Number(f.overheadCost) || 0, lines: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, qty: Number(l.qty), scrapPct: Number(l.scrapPct) || 0, notes: l.notes })) };
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
            <Field label="Quantity per batch" required help="How many units one batch makes">
              <NumberInput decimals={4} min={0} value={f.outputQty} onChange={(v) => setF({ ...f, outputQty: v })} />
            </Field>
            <Field label="Direct labour per batch" help="Wages of the people making one batch">
              <NumberInput fixed={2} min={0} value={f.labourCost} onChange={(v) => setF({ ...f, labourCost: v })} />
            </Field>
            <Field label="Production overhead per batch" help="Factory costs (power, depreciation, supervision) at normal capacity (SAK EP)">
              <NumberInput fixed={2} min={0} value={f.overheadCost} onChange={(v) => setF({ ...f, overheadCost: v })} />
            </Field>
            <div className="flex flex-wrap gap-6 sm:col-span-2">
              <Switch checked={f.isDefault} onChange={(v) => setF({ ...f, isDefault: v })} label="Default BOM of this product" />
              <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
            </div>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Estimated cost" subtitle="From current average costs">
          {est ? (
            <dl className="space-y-2 text-sm">
              {[
                ['Materials', est.material],
                ['Direct labour', est.labour],
                ['Overhead', est.overhead],
              ].map(([l, v]) => (
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
                <dt>Per unit</dt>
                <dd className="font-semibold tabular-nums">{fmtMoney(est.perUnit)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Save to see the estimate.</p>
          )}
        </Card>
      </div>
      <Card title="Components" subtitle="Per batch; scrap % is added to the quantity issued" bodyClass="p-0">
        <ul className="divide-y divide-line">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_8rem_6rem_1fr_auto] sm:items-end">
              <Field label={i === 0 ? 'Component' : undefined} error={errors[`lines.${i}.productId`]}>
                <AsyncSelect resource="products" value={l.productId} onChange={(v) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, productId: v } : x)))} aria-label={`Component ${i + 1}`} />
              </Field>
              <Field label={i === 0 ? 'Qty' : undefined}>
                <NumberInput decimals={4} min={0} value={l.qty} onChange={(v) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} aria-label={`Quantity ${i + 1}`} />
              </Field>
              <Field label={i === 0 ? 'Scrap %' : undefined}>
                <NumberInput decimals={2} min={0} max={100} value={l.scrapPct} onChange={(v) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, scrapPct: v } : x)))} aria-label={`Scrap ${i + 1}`} />
              </Field>
              <Field label={i === 0 ? 'Notes' : undefined}>
                <Input value={l.notes} maxLength={300} onChange={(e) => setLines((xs) => xs.map((x) => (x.key === l.key ? { ...x, notes: e.target.value } : x)))} />
              </Field>
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

export function WorkOrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [finishing, setFinishing] = useState(false);
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
  const act = async (path: string, msg: string, ask?: { title: string; message: string; danger?: boolean }) => {
    if (ask && !(await confirm({ ...ask, confirmText: 'Yes' }))) return;
    try {
      await api.post(`/manufacturing/orders/${id}/${path}`);
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {o.number} <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
          </span>
        }
        subtitle={`${fmtNumber(o.qty)} × ${o.product?.name ?? '-'} · ${o.bom?.code ?? ''} · planned ${fmtDate(o.plannedDate)}`}
        back={() => navigate('/manufacturing/orders')}
        actions={
          <div className="flex flex-wrap gap-2">
            {o.status === 'DRAFT' && can('manufacturing.order.create') && (
              <Button variant="outline" icon="send" onClick={() => act('release', 'Released to production')}>
                Release
              </Button>
            )}
            {open && can('manufacturing.order.confirm') && (
              <Button icon="check-circle-2" onClick={() => setFinishing(true)}>
                Finish production
              </Button>
            )}
            {o.status !== 'CANCELLED' && can('manufacturing.order.cancel') && (
              <Button variant="outline" icon="ban" onClick={() => act('cancel', 'Work order cancelled', { title: `Cancel ${o.number}?`, message: o.status === 'DONE' ? 'Materials go back to stock, the finished goods are taken out again and the journal is voided.' : 'Nothing has been posted yet.', danger: true })}>
                Cancel
              </Button>
            )}
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Materials" subtitle={`From ${o.warehouseName}`} className="lg:col-span-2" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Component</th>
                <th className="px-3 py-2 text-right font-semibold">{o.status === 'DONE' ? 'Used' : 'Needed'}</th>
                {open && <th className="px-3 py-2 text-right font-semibold">Available</th>}
                <th className="px-4 py-2 text-right font-semibold">{o.status === 'DONE' ? 'Cost' : 'Est. cost'}</th>
              </tr>
            </thead>
            <tbody>
              {(o.lines ?? []).map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <span className="font-medium">{l.product?.name}</span>
                    <span className="block text-xs text-slate-500">
                      {l.product?.code}
                      {l.product?.trackLots ? ' · lot-tracked (FEFO)' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNumber(o.status === 'DONE' ? l.consumedQty : l.plannedQty)} {l.product?.uom?.code ?? ''}
                  </td>
                  {open && <td className={cn('px-3 py-2 text-right tabular-nums', l.shortage > 0 ? 'font-medium text-red-600' : 'text-emerald-700')}>{fmtNumber(l.available)}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(o.status === 'DONE' ? Number(l.consumedQty) * Number(l.unitCost) : l.estCost, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open && shortages.length > 0 && (
            <p className="flex items-center gap-2 border-t border-line bg-red-50 px-4 py-2 text-xs text-red-700">
              <Icon name="triangle-alert" className="h-4 w-4" /> {shortages.length} component(s) short. Buy them first (Inventory &gt; Reorder Planner) or finish with what was actually used.
            </p>
          )}
        </Card>
        <Card title={o.status === 'DONE' ? 'Production cost' : 'Planned conversion cost'}>
          <dl className="space-y-2 text-sm">
            {o.status === 'DONE' && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Materials</dt>
                <dd className="tabular-nums">{fmtMoney(o.materialCost, 0)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Direct labour</dt>
              <dd className="tabular-nums">{fmtMoney(o.labourCost, 0)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Overhead</dt>
              <dd className="tabular-nums">{fmtMoney(o.overheadCost, 0)}</dd>
            </div>
            {o.status === 'DONE' && (
              <>
                <div className="flex justify-between border-t border-line pt-2 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{fmtMoney(o.totalCost, 0)}</dd>
                </div>
                <div className="flex justify-between text-brand-700">
                  <dt>Per unit ({fmtNumber(o.producedQty)} made)</dt>
                  <dd className="font-semibold tabular-nums">{fmtMoney(o.unitCost)}</dd>
                </div>
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
    </div>
  );
}

function FinishModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: isoDate(), producedQty: String(Number(order.qty)), lotNo: order.lotNo ?? '', expiryDate: order.expiryDate?.slice(0, 10) ?? '' });
  const [used, setUsed] = useState<Record<string, string>>(Object.fromEntries((order.lines ?? []).map((l) => [l.id, String(Number(l.plannedQty))])));
  const save = useMutation({
    mutationFn: () => api.post(`/manufacturing/orders/${order.id}/complete`, { ...f, producedQty: Number(f.producedQty), expiryDate: f.expiryDate || null, lotNo: f.lotNo || null, consumed: Object.entries(used).map(([lineId, v]) => ({ lineId, qty: Number(v) || 0 })) }),
    onSuccess: () => {
      toast.success('Production recorded: materials issued, finished goods in stock');
      onDone();
    },
    onError: (e) => toast.error(e),
  });
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date">
            <DatePicker clearable={false} value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          </Field>
          <Field label="Good units made" help="The cost is spread over the units actually made">
            <NumberInput decimals={4} min={0} value={f.producedQty} onChange={(v) => setF({ ...f, producedQty: v })} />
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
                <span className="text-xs text-slate-500">planned {fmtNumber(l.plannedQty)}</span>
                <div className="w-28">
                  <NumberInput decimals={4} min={0} value={used[l.id] ?? ''} onChange={(v) => setUsed((u) => ({ ...u, [l.id]: v }))} aria-label={`Used ${l.product?.name}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          Finished goods are valued at materials (average cost) + labour {fmtMoney(order.labourCost, 0)} + overhead {fmtMoney(order.overheadCost, 0)}. Labour and overhead are credited to the &quot;applied&quot; accounts; what was spent but not absorbed stays an expense of the period (SAK EP).
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
