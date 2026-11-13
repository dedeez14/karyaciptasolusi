import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { downloadCsv, esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const num = (v: unknown, dp = 2) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : fmtNumber(v as number, dp));
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const firstOfMonth = () => isoDate().slice(0, 8) + '01';
const STATUS: Record<string, { label: string; tone: Tone }> = { OPEN: { label: 'Open', tone: 'green' }, CLOSED: { label: 'Closed', tone: 'blue' }, CANCELLED: { label: 'Cancelled', tone: 'gray' } };
const k = (c: string, s: string) => `${c}|${s}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}
function Progress({ label, value, max }: { label: string; value: number; max: number }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>
          {fmtNumber(value)} / {fmtNumber(max)}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${p >= 100 ? 'bg-emerald-500' : 'bg-brand-600'}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

// ============================================================ styles
interface Style {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  customer: { id: string; name: string } | string | null;
  season: string | null;
  category: string | null;
  sizes: string[];
  colours: { code: string; name: string }[];
  composition: string | null;
  care: string | null;
  sam: number;
  salePrice: number;
  notes: string | null;
  isActive: boolean;
  operations: { id: string; seq: number; name: string; machine: string | null; sam: number; pieceRate: number }[];
  materials: { id: string; kind: string; productId: string; qtyPerPiece: number; colour: string | null; product?: { code: string; name: string } | null }[];
  variants: { id: string; colour: string; size: string; productId: string; product?: { code: string; name: string } | null }[];
}

export function StylesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const q = useQuery({ queryKey: ['garment', 'styles'], queryFn: () => api.get<Style[]>('/garment/styles') });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Styles & SKUs"
        subtitle="Each style has its size run and colours (one stock product per colour x size), its operation bulletin with standard minutes (SAM) and its fabric and trims per piece"
        actions={
          can('garment.style.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New style
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="shirt" title="No styles yet" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => setEdit(s.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.code} · {s.name}
                      {typeof s.customer === 'string' ? ` · ${s.customer}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      sizes {s.sizes.join(' ')} · {s.colours.map((c) => c.name).join(', ')} · {s.variants.length} SKUs · SAM {num(s.sam, 3)} · {s.operations.length} operations
                      {s.season ? ` · ${s.season}` : ''}
                    </span>
                  </span>
                  {!s.isActive && <Badge tone="gray">Inactive</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <StyleEditor id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['garment'] }))} />}
    </div>
  );
}

function StyleEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['garment', 'style', id], queryFn: () => api.get<Style>(`/garment/styles/${id}`), enabled: !!id });
  if (id && (q.isLoading || !q.data))
    return (
      <Modal open onClose={onClose} title="Style">
        <Loading />
      </Modal>
    );
  return <StyleForm s={q.data} readOnly={!can('garment.style.manage')} onClose={onClose} onSaved={onSaved} />;
}

function StyleForm({ s, readOnly, onClose, onSaved }: { s?: Style; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: s?.code ?? '',
    name: s?.name ?? '',
    customerId: s?.customerId ?? (null as string | null),
    season: s?.season ?? '',
    category: s?.category ?? '',
    sizes: s?.sizes.join(' ') ?? 'S M L XL',
    composition: s?.composition ?? '',
    care: s?.care ?? '',
    salePrice: s ? String(s.salePrice) : '',
    notes: s?.notes ?? '',
  });
  const [colours, setColours] = useState(s?.colours ?? [{ code: '', name: '' }]);
  const [ops, setOps] = useState((s?.operations ?? []).map((o) => ({ name: o.name, machine: o.machine ?? '', sam: String(o.sam), pieceRate: String(o.pieceRate || '') })));
  const [mats, setMats] = useState(
    (s?.materials ?? []).map((m) => ({
      kind: m.kind,
      productId: m.productId as string | null,
      productName: m.product ? `${m.product.code} - ${m.product.name}` : '',
      qtyPerPiece: String(m.qtyPerPiece),
      colour: m.colour ?? '',
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sizes = f.sizes
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const sam = ops.reduce((a, o) => a + Number(o.sam || 0), 0);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        customerId: f.customerId,
        sizes,
        colours: colours.filter((c) => c.code),
        salePrice: f.salePrice || 0,
        operations: ops.filter((o) => o.name).map((o) => ({ ...o, sam: o.sam || 0, pieceRate: o.pieceRate || 0 })),
        materials: mats.filter((m) => m.productId).map((m) => ({ kind: m.kind, productId: m.productId, qtyPerPiece: m.qtyPerPiece, colour: m.colour || null })),
      };
      return s ? api.put(`/garment/styles/${s.id}`, body) : api.post('/garment/styles', body);
    },
    onSuccess: () => (toast.success('Style saved: SKUs made'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={s ? `Style ${s.code}` : 'New style'}
      footer={
        !readOnly && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || !sizes.length} onClick={() => save.mutate()}>
            Save ({sizes.length * colours.filter((c) => c.code).length} SKUs)
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Style code" required error={errors.code}>
          <Input disabled={readOnly} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="lg:col-span-2" error={errors.name}>
          <Input disabled={readOnly} value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Season">
          <Input disabled={readOnly} value={f.season} maxLength={40} onChange={(e) => setF({ ...f, season: e.target.value })} />
        </Field>
        <Field label="Buyer" className="sm:col-span-2">
          <AsyncSelect
            disabled={readOnly}
            resource="customers"
            value={f.customerId}
            initialLabel={s && typeof s.customer === 'object' && s.customer ? s.customer.name : undefined}
            onChange={(v) => setF({ ...f, customerId: v })}
          />
        </Field>
        <Field label="Category" help="Baby clothing (up to 36 months) needs SNI 7617 with SPPT-SNI and the SNI mark: no formaldehyde detected, no carcinogenic azo dyes">
          <Input disabled={readOnly} value={f.category} maxLength={60} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </Field>
        <Field label="Price per piece">
          <NumberInput disabled={readOnly} decimals={0} min={0} value={f.salePrice} onChange={(v) => setF({ ...f, salePrice: v })} />
        </Field>
        <Field label="Size run" required className="sm:col-span-2" help="In order, separated by spaces: XS S M L XL / 28 30 32 34" error={errors.sizes}>
          <Input disabled={readOnly} value={f.sizes} onChange={(e) => setF({ ...f, sizes: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Fibre composition (label)" help="On the garment with brand, size, care and country of manufacture (Permendag 25/2021 Lampiran D)">
          <Input disabled={readOnly} value={f.composition} maxLength={150} placeholder="100% cotton" onChange={(e) => setF({ ...f, composition: e.target.value })} />
        </Field>
        <Field label="Care (label)" help="Item name and producer name / address go on the packaging">
          <Input disabled={readOnly} value={f.care} maxLength={200} onChange={(e) => setF({ ...f, care: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Colours</span>
            {!readOnly && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setColours([...colours, { code: '', name: '' }])}>
                Colour
              </Button>
            )}
          </div>
          {errors.colours && <p className="mb-1 text-xs text-red-600">{errors.colours}</p>}
          <div className="space-y-2">
            {colours.map((c, i) => (
              <div key={i} className="grid grid-cols-[7rem_1fr_2.5rem] gap-2">
                <Input
                  disabled={readOnly}
                  value={c.code}
                  maxLength={30}
                  placeholder="Code"
                  onChange={(e) => setColours(colours.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))}
                  aria-label="Colour code"
                />
                <Input
                  disabled={readOnly}
                  value={c.name}
                  maxLength={60}
                  placeholder="Name"
                  onChange={(e) => setColours(colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  aria-label="Colour name"
                />
                {!readOnly && <Button variant="ghost" size="icon" icon="x" aria-label="Remove colour" onClick={() => setColours(colours.filter((_, j) => j !== i))} />}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Operation bulletin · SAM {num(sam, 3)}</span>
            {!readOnly && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setOps([...ops, { name: '', machine: '', sam: '', pieceRate: '' }])}>
                Operation
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {ops.map((o, i) => (
              <div key={i} className="grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_5rem_2.5rem] items-center gap-2">
                <span className="text-xs text-slate-500">{i + 1}</span>
                <Input
                  disabled={readOnly}
                  value={o.name}
                  maxLength={120}
                  placeholder="Operation"
                  onChange={(e) => setOps(ops.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  aria-label="Operation"
                />
                <Input
                  disabled={readOnly}
                  value={o.machine}
                  maxLength={20}
                  placeholder="SNLS"
                  onChange={(e) => setOps(ops.map((x, j) => (j === i ? { ...x, machine: e.target.value.toUpperCase() } : x)))}
                  aria-label="Machine"
                />
                <NumberInput disabled={readOnly} decimals={3} min={0} value={o.sam} placeholder="SAM" onChange={(v) => setOps(ops.map((x, j) => (j === i ? { ...x, sam: v } : x)))} aria-label="SAM" />
                <NumberInput
                  disabled={readOnly}
                  decimals={0}
                  min={0}
                  value={o.pieceRate}
                  placeholder="Rp/pc"
                  onChange={(v) => setOps(ops.map((x, j) => (j === i ? { ...x, pieceRate: v } : x)))}
                  aria-label="Piece rate"
                />
                {!readOnly && <Button variant="ghost" size="icon" icon="x" aria-label="Remove operation" onClick={() => setOps(ops.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {!ops.length && (
              <p className="text-xs text-slate-500">
                Operations with their standard minutes give the SAM used for line efficiency and the conversion cost. Piece rates print on the bundle coupons; piece-rate pay must still reach the
                minimum wage (PP 36/2021 Art. 23).
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Materials per piece</span>
          {!readOnly && (
            <Button size="sm" variant="outline" icon="plus" onClick={() => setMats([...mats, { kind: 'TRIM', productId: null, productName: '', qtyPerPiece: '', colour: '' }])}>
              Material
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {mats.map((m, i) => (
            <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_7rem_8rem_2.5rem] gap-2">
              <Select
                disabled={readOnly}
                value={m.kind}
                onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                options={[
                  { value: 'FABRIC', label: 'Fabric' },
                  { value: 'TRIM', label: 'Trim' },
                ]}
                aria-label="Kind"
              />
              <AsyncSelect
                disabled={readOnly}
                resource="products"
                value={m.productId}
                initialLabel={m.productName || undefined}
                onChange={(v, o) => setMats(mats.map((x, j) => (j === i ? { ...x, productId: v, productName: o?.label ?? '' } : x)))}
                aria-label="Material"
              />
              <NumberInput
                disabled={readOnly}
                decimals={4}
                min={0}
                value={m.qtyPerPiece}
                placeholder="per pc"
                onChange={(v) => setMats(mats.map((x, j) => (j === i ? { ...x, qtyPerPiece: v } : x)))}
                aria-label="Quantity per piece"
              />
              <Select
                disabled={readOnly}
                value={m.colour}
                onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, colour: e.target.value } : x)))}
                placeholder="All"
                options={colours.filter((c) => c.code).map((c) => ({ value: c.code, label: c.code }))}
                aria-label="For colour"
              />
              {!readOnly && <Button variant="ghost" size="icon" icon="x" aria-label="Remove material" onClick={() => setMats(mats.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {!mats.length && <p className="text-xs text-slate-500">Fabric is issued when cutting, trims when the pieces are packed.</p>}
        </div>
      </div>
      {s && s.variants.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <p className="mb-2 text-sm font-medium">SKU products</p>
          <table className="text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-slate-500" />
                {s.sizes.map((z) => (
                  <th key={z} className="px-2 py-1 text-left text-slate-500">
                    {z}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.colours.map((c) => (
                <tr key={c.code}>
                  <td className="px-2 py-1 font-medium">{c.name}</td>
                  {s.sizes.map((z) => (
                    <td key={z} className="px-2 py-1 font-mono">
                      {s.variants.find((v) => v.colour === c.code && v.size === z)?.product?.code ?? '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Field label="Notes" className="mt-3">
        <Textarea disabled={readOnly} rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

// ============================================================ orders
interface OrderRow {
  id: string;
  number: string;
  styleId: string;
  buyerRef: string | null;
  orderDate: string;
  shipDate: string | null;
  status: string;
  qty: number;
  cut: number;
  sewn: number;
  received: number;
  rejects: number;
  style?: { code: string; name: string } | null;
  customer?: string | null;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('OPEN');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['garment', 'orders', status], queryFn: () => api.get<OrderRow[]>('/garment/orders', { status: status || undefined }) });
  const rows = q.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Garment Production Orders"
        subtitle="Orders by colour x size: cutting, sewing and packing progress per SKU"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            {can('garment.order.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New order
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="clipboard-list" title="No orders" description="Set up the style first (sizes, colours, operations), then enter the order as a matrix" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="grid w-full grid-cols-1 gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 lg:grid-cols-[1fr_28rem]"
                  onClick={() => navigate(`/garment/orders/${o.id}`)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {o.number} · {o.style?.code} {o.style?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {o.customer ?? 'stock'}
                      {o.buyerRef ? ` · PO ${o.buyerRef}` : ''} · {fmtNumber(o.qty)} pcs{o.shipDate ? ` · ship ${fmtDate(o.shipDate)}` : ''}{' '}
                      <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                    </span>
                  </span>
                  <span className="grid grid-cols-3 gap-3">
                    <Progress label="Cut" value={o.cut} max={o.qty} />
                    <Progress label="Sewn" value={o.sewn} max={o.qty} />
                    <Progress label="Packed" value={o.received} max={o.qty} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <NewOrder onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), navigate(`/garment/orders/${id}`))} />}
    </div>
  );
}

function MatrixInput({
  style,
  values,
  onChange,
  max,
  disabled,
}: {
  style: { sizes: string[]; colours: { code: string; name: string }[] };
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  max?: Record<string, number>;
  disabled?: boolean;
}) {
  const colTotal = (z: string) => style.colours.reduce((a, c) => a + Number(values[k(c.code, z)] || 0), 0);
  const rowTotal = (c: string) => style.sizes.reduce((a, z) => a + Number(values[k(c, z)] || 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="px-2 py-1 text-left">Colour</th>
            {style.sizes.map((z) => (
              <th key={z} className="w-24 px-1 py-1 text-right">
                {z}
              </th>
            ))}
            <th className="px-2 py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {style.colours.map((c) => (
            <tr key={c.code}>
              <td className="px-2 py-1 font-medium whitespace-nowrap">{c.name}</td>
              {style.sizes.map((z) => {
                const m = max?.[k(c.code, z)];
                return (
                  <td key={z} className="px-1 py-1">
                    <NumberInput
                      disabled={disabled || (max !== undefined && !m)}
                      decimals={0}
                      min={0}
                      max={m}
                      value={values[k(c.code, z)] ?? ''}
                      placeholder={m !== undefined ? String(m) : ''}
                      onChange={(v) => onChange({ ...values, [k(c.code, z)]: v })}
                      aria-label={`${c.name} ${z}`}
                    />
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right font-medium">{fmtNumber(rowTotal(c.code))}</td>
            </tr>
          ))}
          <tr className="text-xs text-slate-500">
            <td className="px-2 py-1">Total</td>
            {style.sizes.map((z) => (
              <td key={z} className="px-1 py-1 text-right">
                {fmtNumber(colTotal(z))}
              </td>
            ))}
            <td className="px-2 py-1 text-right font-semibold text-slate-800">{fmtNumber(style.colours.reduce((a, c) => a + rowTotal(c.code), 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function NewOrder({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const styles = useQuery({ queryKey: ['garment', 'styles'], queryFn: () => api.get<Style[]>('/garment/styles') });
  const [f, setF] = useState({
    styleId: '',
    customerId: null as string | null,
    buyerRef: '',
    orderDate: isoDate(),
    shipDate: '',
    warehouseId: null as string | null,
    fgWarehouseId: null as string | null,
    cutAllowancePct: '3',
    notes: '',
  });
  const [m, setM] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const style = styles.data?.find((s) => s.id === f.styleId);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/garment/orders', {
        ...f,
        shipDate: f.shipDate || null,
        cutAllowancePct: f.cutAllowancePct || 0,
        matrix: Object.entries(m)
          .filter(([, v]) => Number(v) > 0)
          .map(([key, v]) => ({ colour: key.split('|')[0], size: key.split('|')[1], qty: v })),
      }),
    onSuccess: (r) => (toast.success('Order made'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="New garment production order"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!style || !f.warehouseId || !f.fgWarehouseId} onClick={() => save.mutate()}>
          Make order
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Style" required className="sm:col-span-2" error={errors.styleId}>
          <Select
            value={f.styleId}
            onChange={(e) => (setF({ ...f, styleId: e.target.value }), setM({}))}
            placeholder="Choose"
            options={(styles.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
          />
        </Field>
        <Field label="Buyer" help="Empty: the buyer of the style, or for stock">
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Buyer PO no.">
          <Input value={f.buyerRef} maxLength={60} onChange={(e) => setF({ ...f, buyerRef: e.target.value })} />
        </Field>
        <Field label="Order date" required>
          <DatePicker value={f.orderDate} clearable={false} onChange={(v) => setF({ ...f, orderDate: v ?? isoDate() })} />
        </Field>
        <Field label="Ship date">
          <DatePicker value={f.shipDate} onChange={(v) => setF({ ...f, shipDate: v ?? '' })} />
        </Field>
        <Field label="Fabric & trims store" required error={errors.warehouseId}>
          <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
        </Field>
        <Field label="Finished goods store" required error={errors.fgWarehouseId}>
          <AsyncSelect resource="warehouses" value={f.fgWarehouseId} onChange={(v) => setF({ ...f, fgWarehouseId: v })} />
        </Field>
        <Field label="Cut allowance %" help="Extra cut over the order for rejects">
          <NumberInput decimals={2} min={0} max={30} value={f.cutAllowancePct} onChange={(v) => setF({ ...f, cutAllowancePct: v })} />
        </Field>
      </div>
      {style ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Quantities by colour and size</p>
          {errors.matrix && <p className="mb-1 text-xs text-red-600">{errors.matrix}</p>}
          <MatrixInput style={style} values={m} onChange={setM} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Choose the style to enter the matrix.</p>
      )}
    </Modal>
  );
}

interface OrderDetail extends Omit<OrderRow, 'customer' | 'style'> {
  warehouseId: string;
  fgWarehouseId: string;
  customerId: string | null;
  notes: string | null;
  cutAllowancePct: number;
  costs: { fabric: number; fabricRelieved: number; trims: number; conversion: number; closedLoss: number; wip: number };
  style: Style;
  customer: { id: string; name: string } | null;
  warehouse: { name: string } | null;
  fgWarehouse: { name: string } | null;
  salesOrder: { id: string; number: string; status: string } | null;
  lines: { id: string; colour: string; size: string; productId: string; qty: number; cutQty: number; sewnQty: number; receivedQty: number; rejectQty: number; toCut: number }[];
  lays: {
    id: string;
    number: string;
    date: string;
    colour: string;
    ratio: Record<string, number>;
    plies: number;
    markerLengthM: number | null;
    markerEfficiency: number | null;
    fabricQty: number;
    fabricCost: number;
    shade: string | null;
    status: string;
    pieces: number;
    fabric: { actualPerPiece: number; variancePct: number } | null;
    bundles: { id: string; bundleNo: number; colour: string; size: string; plyFrom: number; plyTo: number; qty: number }[];
  }[];
  fabricUsed: number;
  outputs: {
    id: string;
    date: string;
    line: { code: string; name: string } | null;
    operators: number;
    helpers: number;
    minutes: number;
    totalPieces: number;
    rejects: number;
    efficiency: number;
    pieces: Record<string, number>;
  }[];
  receipts: {
    id: string;
    number: string;
    date: string;
    totalPieces: number;
    fabricCost: number;
    trimCost: number;
    conversionCost: number;
    status: string;
    lines: { colour: string; size: string; qty: number; unitCost: number }[];
  }[];
}

export function OrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [modal, setModal] = useState<'' | 'lay' | 'output' | 'receive' | 'matrix'>('');
  const q = useQuery({ queryKey: ['garment', 'order', id], queryFn: () => api.get<OrderDetail>(`/garment/orders/${id}`) });
  const refresh = () => (setModal(''), qc.invalidateQueries({ queryKey: ['garment'] }));
  const act = useMutation({
    mutationFn: (a: string) => api.post<{ id?: string; number?: string }>(`/garment/orders/${id}/${a}`),
    onSuccess: (r, a) => (toast.success(a === 'sales-order' ? `Draft sales order ${r.number}` : 'Order updated'), refresh(), a === 'sales-order' && r.id ? navigate(`/documents/SO/${r.id}`) : null),
    onError: (e) => toast.error(e),
  });
  const cancelLay = useMutation({
    mutationFn: (lid: string) => api.post(`/garment/lays/${lid}/cancel`),
    onSuccess: () => (toast.success('Lay cancelled: fabric back in the store'), refresh()),
    onError: (e) => toast.error(e),
  });
  const delOut = useMutation({ mutationFn: (oid: string) => api.delete(`/garment/outputs/${oid}`), onSuccess: () => (toast.success('Output removed'), refresh()), onError: (e) => toast.error(e) });
  const cancelRec = useMutation({
    mutationFn: (rid: string) => api.post(`/garment/receipts/${rid}/cancel`),
    onSuccess: () => (toast.success('Receipt cancelled'), refresh()),
    onError: (e) => toast.error(e),
  });
  const o = q.data;
  if (q.isLoading || !o) return <Loading />;
  const open = o.status === 'OPEN';
  const cell = (c: string, z: string) => o.lines.find((l) => l.colour === c && l.size === z);
  const printBundles = (lay: OrderDetail['lays'][number]) => {
    const colour = o.style.colours.find((c) => c.code === lay.colour)?.name ?? lay.colour;
    printHtml(`<!doctype html><html><head><title>Bundles ${esc(lay.number)}</title><style>${PRINT_CSS} .t{border:1px dashed #555;padding:6px;margin:0 0 8px;page-break-inside:avoid} .h{display:flex;justify-content:space-between;font-weight:600;font-size:13px} .c{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px} .c div{border:1px solid #999;padding:3px;font-size:9px}</style></head><body>
<h1>Bundle tickets ${esc(lay.number)} · ${esc(o.number)} · ${esc(o.style.code)}</h1>
${lay.bundles
  .map(
    (b) => `<div class="t"><div class="h"><span>Bundle #${b.bundleNo}</span><span>${esc(o.style.code)} · ${esc(colour)} · ${esc(b.size)}</span><span>${b.qty} pcs</span></div>
<div>Order ${esc(o.number)}${o.buyerRef ? ` / PO ${esc(o.buyerRef)}` : ''} · lay ${esc(lay.number)} · plies ${b.plyFrom}-${b.plyTo}${lay.shade ? ` · shade ${esc(lay.shade)}` : ''}</div>
<div class="c">${o.style.operations.map((op) => `<div>#${b.bundleNo} · ${op.seq}. ${esc(op.name)}<br>${b.qty} pcs · SAM ${op.sam}${op.pieceRate ? ` · Rp${fmtNumber(op.pieceRate * b.qty)}` : ''}</div>`).join('')}</div></div>`,
  )
  .join('')}
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/garment/orders')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.number} <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
          </span>
        }
        subtitle={`${o.style.code} ${o.style.name} · ${o.customer?.name ?? 'stock'}${o.buyerRef ? ` · PO ${o.buyerRef}` : ''}${o.shipDate ? ` · ship ${fmtDate(o.shipDate)}` : ''}`}
        actions={
          open ? (
            <>
              {can('garment.cut') && (
                <Button icon="scissors" onClick={() => setModal('lay')}>
                  Cut
                </Button>
              )}
              {can('garment.output') && (
                <Button variant="outline" icon="gauge" onClick={() => setModal('output')}>
                  Line output
                </Button>
              )}
              {can('garment.receive') && (
                <Button variant="outline" icon="package-check" onClick={() => setModal('receive')}>
                  Pack & receive
                </Button>
              )}
              {can('garment.order.manage') && (
                <>
                  <Button variant="outline" icon="grid-3x3" onClick={() => setModal('matrix')}>
                    Matrix
                  </Button>
                  {!o.salesOrder && o.customer && (
                    <Button variant="outline" icon="file-text" loading={act.isPending} onClick={() => act.mutate('sales-order')}>
                      Sales order
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    icon="check-check"
                    onClick={async () =>
                      (await confirm({ title: `Close ${o.number}?`, message: o.costs.wip > 0 ? `Fabric cost of ${fmtMoney(o.costs.wip, 0)} for cut pieces not packed is written off.` : undefined })) &&
                      act.mutate('close')
                    }
                  >
                    Close
                  </Button>
                  {!o.lays.some((l) => l.status === 'POSTED') && (
                    <Button variant="ghost" icon="x" onClick={async () => (await confirm({ title: `Cancel ${o.number}?`, danger: true, confirmText: 'Cancel order' })) && act.mutate('cancel')}>
                      Cancel
                    </Button>
                  )}
                </>
              )}
            </>
          ) : (
            o.status === 'CLOSED' &&
            can('garment.order.manage') && (
              <Button variant="outline" icon="undo-2" onClick={() => act.mutate('reopen')}>
                Reopen
              </Button>
            )
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ordered" value={`${fmtNumber(o.qty)} pcs`} hint={`cut allowance ${o.cutAllowancePct}%`} />
        <Stat label="Cut" value={`${fmtNumber(o.cut)} pcs`} hint={`${num(o.fabricUsed, 1)} fabric used`} />
        <Stat label="Sewn" value={`${fmtNumber(o.sewn)} pcs`} />
        <Stat label="Packed" value={`${fmtNumber(o.received)} pcs`} hint={o.rejects ? `${o.rejects} rejected` : undefined} />
      </div>
      <Card title="Progress by SKU" subtitle="ordered · cut · sewn · packed" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Colour</th>
                {o.style.sizes.map((z) => (
                  <th key={z} className="px-2 py-2 text-right">
                    {z}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.style.colours.map((c) => (
                <tr key={c.code}>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  {o.style.sizes.map((z) => {
                    const l = cell(c.code, z);
                    return (
                      <td key={z} className="px-2 py-2 text-right">
                        {l ? (
                          <span className="block leading-tight">
                            <span className="font-medium">{fmtNumber(l.qty)}</span>
                            <span className="block text-xs text-slate-500">
                              {l.cutQty} · {l.sewnQty} · <span className={l.receivedQty >= l.qty && l.qty > 0 ? 'text-emerald-600' : ''}>{l.receivedQty}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Cutting" bodyClass="p-0">
          {!o.lays.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nothing cut yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.lays.map((l) => (
                <li key={l.id} className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm ${l.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{l.number}</span> · {fmtDate(l.date)} · {l.colour} ·{' '}
                    {Object.entries(l.ratio)
                      .map(([z, r]) => `${z}${r}`)
                      .join(' ')}{' '}
                    x {l.plies} plies = {fmtNumber(l.pieces)} pcs
                    <span className="block text-xs text-slate-500">
                      {l.bundles.length} bundles · fabric {num(l.fabricQty, 1)} ({fmtMoney(l.fabricCost, 0)})
                      {l.fabric ? ` · ${num(l.fabric.actualPerPiece, 3)}/pc, ${l.fabric.variancePct > 0 ? '+' : ''}${l.fabric.variancePct}% vs standard` : ''}
                      {l.markerEfficiency ? ` · marker ${l.markerEfficiency}%` : ''}
                    </span>
                  </span>
                  {l.status === 'POSTED' && (
                    <>
                      <Button size="sm" variant="outline" icon="printer" onClick={() => printBundles(l)}>
                        Tickets
                      </Button>
                      {open && can('garment.cut') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="x"
                          aria-label="Cancel lay"
                          onClick={async () => (await confirm({ title: `Cancel ${l.number}?`, danger: true, confirmText: 'Cancel lay' })) && cancelLay.mutate(l.id)}
                        />
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Cost" subtitle={`Conversion at SAM ${num(o.style.sam, 3)} per piece`}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Fabric cut</dt>
              <dd>{fmtMoney(o.costs.fabric, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Fabric in finished goods</dt>
              <dd>{fmtMoney(o.costs.fabricRelieved, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Trims</dt>
              <dd>{fmtMoney(o.costs.trims, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Conversion</dt>
              <dd>{fmtMoney(o.costs.conversion, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Still in work in process</dt>
              <dd className="font-medium">{fmtMoney(o.costs.wip, 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Cost per packed piece</dt>
              <dd>{o.received ? fmtMoney((o.costs.fabricRelieved + o.costs.trims + o.costs.conversion) / o.received, 0) : '-'}</dd>
            </div>
            {o.salesOrder && (
              <div>
                <dt className="text-xs text-slate-500">Sales order</dt>
                <dd>
                  <Link to={`/documents/SO/${o.salesOrder.id}`} className="text-brand-600">
                    {o.salesOrder.number}
                  </Link>
                </dd>
              </div>
            )}
            {o.costs.closedLoss > 0 && (
              <div>
                <dt className="text-xs text-slate-500">Written off at closing</dt>
                <dd>{fmtMoney(o.costs.closedLoss, 0)}</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Line output" bodyClass="p-0">
          {!o.outputs.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No output yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.outputs.map((x) => (
                <li key={x.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    {fmtDate(x.date)} · {x.line?.name} · {fmtNumber(x.totalPieces)} pcs
                    <span className="block text-xs text-slate-500">
                      {x.operators} operators{x.helpers ? ` + ${x.helpers} helpers` : ''} · {x.minutes} min{x.rejects ? ` · ${x.rejects} rejects` : ''}
                    </span>
                  </span>
                  <Badge tone={x.efficiency >= 60 ? 'green' : x.efficiency >= 40 ? 'amber' : 'red'}>{x.efficiency}%</Badge>
                  {open && can('garment.output') && <Button size="sm" variant="ghost" icon="trash-2" aria-label="Remove output" onClick={() => delOut.mutate(x.id)} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Packed into finished goods" bodyClass="p-0">
          {!o.receipts.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nothing packed yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.receipts.map((r, i) => (
                <li key={r.id} className={`flex items-center gap-2 px-4 py-2.5 text-sm ${r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}>
                  <span className="min-w-0 flex-1">
                    {r.number} · {fmtDate(r.date)} · {fmtNumber(r.totalPieces)} pcs
                    <span className="block text-xs text-slate-500">
                      {r.lines.map((x) => `${x.colour} ${x.size} ${x.qty}`).join(', ')} · {fmtMoney(r.fabricCost + r.trimCost + r.conversionCost, 0)}
                    </span>
                  </span>
                  {open && i === o.receipts.findIndex((x) => x.status === 'POSTED') && r.status === 'POSTED' && can('garment.receive') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      aria-label="Cancel receipt"
                      onClick={async () => (await confirm({ title: `Cancel ${r.number}?`, danger: true, confirmText: 'Cancel receipt' })) && cancelRec.mutate(r.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {modal === 'lay' && <LayModal o={o} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'output' && <OutputModal o={o} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'receive' && <ReceiveModal o={o} onClose={() => setModal('')} onDone={refresh} />}
      {modal === 'matrix' && <MatrixModal o={o} onClose={() => setModal('')} onDone={refresh} />}
    </div>
  );
}

function LayModal({ o, onClose, onDone }: { o: OrderDetail; onClose: () => void; onDone: () => void }) {
  const fabricStd = o.style.materials.filter((m) => m.kind === 'FABRIC');
  const [f, setF] = useState({
    date: isoDate(),
    colour: o.style.colours[0]?.code ?? '',
    plies: '',
    markerLengthM: '',
    markerEfficiency: '',
    fabricProductId: (fabricStd[0]?.productId ?? null) as string | null,
    fabricQty: '',
    shade: '',
    bundleSize: '20',
  });
  const [ratio, setRatio] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const plies = Number(f.plies || 0);
  const pieces = o.style.sizes.reduce((a, z) => a + Number(ratio[z] || 0) * plies, 0);
  const std = fabricStd.find((m) => !m.colour || m.colour === f.colour);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/garment/orders/${o.id}/lays`, {
        ...f,
        ratio: Object.fromEntries(Object.entries(ratio).filter(([, v]) => Number(v) > 0)),
        markerLengthM: f.markerLengthM || null,
        markerEfficiency: f.markerEfficiency || null,
        fabricQty: f.fabricQty || 0,
        bundleSize: f.bundleSize || 20,
      }),
    onSuccess: () => (toast.success(`${pieces} pieces cut, bundle tickets ready`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Cutting lay for ${o.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!pieces} onClick={() => save.mutate()}>
          Cut {pieces || ''} pcs
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Colour" required error={errors.colour}>
          <Select value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value })} options={o.style.colours.map((c) => ({ value: c.code, label: c.name }))} />
        </Field>
        <Field label="Plies" required error={errors.plies}>
          <NumberInput decimals={0} min={1} max={1000} value={f.plies} onChange={(v) => setF({ ...f, plies: v })} />
        </Field>
      </div>
      <p className="mb-1 mt-3 text-sm font-medium">Marker ratio (pieces per ply)</p>
      {errors.ratio && <p className="text-xs text-red-600">{errors.ratio}</p>}
      <div className="flex flex-wrap gap-2">
        {o.style.sizes.map((z) => {
          const l = o.lines.find((x) => x.colour === f.colour && x.size === z);
          return (
            <div key={z} className="w-24">
              <Field label={`${z}${l ? ` (to cut ${l.toCut})` : ''}`}>
                <NumberInput decimals={0} min={0} max={50} value={ratio[z] ?? ''} onChange={(v) => setRatio({ ...ratio, [z]: v })} />
              </Field>
              {plies > 0 && Number(ratio[z] || 0) > 0 && <p className="text-right text-xs text-slate-500">= {Number(ratio[z]) * plies}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Fabric" error={errors.fabricProductId}>
          <AsyncSelect resource="products" value={f.fabricProductId} onChange={(v) => setF({ ...f, fabricProductId: v })} />
        </Field>
        <Field label="Fabric used" help={std && pieces ? `standard ${num(std.qtyPerPiece * pieces, 1)} (${std.qtyPerPiece} / pc)` : undefined} error={errors.fabricQty}>
          <NumberInput decimals={3} min={0} value={f.fabricQty} onChange={(v) => setF({ ...f, fabricQty: v })} />
        </Field>
        <Field label="Shade / roll lot">
          <Input value={f.shade} maxLength={20} onChange={(e) => setF({ ...f, shade: e.target.value })} />
        </Field>
        <Field label="Marker length (m)">
          <NumberInput decimals={3} min={0} value={f.markerLengthM} onChange={(v) => setF({ ...f, markerLengthM: v })} />
        </Field>
        <Field label="Marker efficiency %">
          <NumberInput decimals={2} min={0} max={100} value={f.markerEfficiency} onChange={(v) => setF({ ...f, markerEfficiency: v })} />
        </Field>
        <Field label="Pieces per bundle">
          <NumberInput decimals={0} min={1} max={200} value={f.bundleSize} onChange={(v) => setF({ ...f, bundleSize: v })} />
        </Field>
      </div>
    </Modal>
  );
}

function OutputModal({ o, onClose, onDone }: { o: OrderDetail; onClose: () => void; onDone: () => void }) {
  const lists = useQuery({ queryKey: ['garment', 'lists'], queryFn: () => api.get<{ lines: { id: string; code: string; name: string }[]; costPerMinute: number }>('/garment/lists') });
  const [f, setF] = useState({ date: isoDate(), lineId: '', operators: '', helpers: '', minutes: '480', rejects: '', notes: '' });
  const [m, setM] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const max = useMemo(() => Object.fromEntries(o.lines.map((l) => [k(l.colour, l.size), Math.max(0, l.cutQty - l.sewnQty)])), [o.lines]);
  const total = Object.values(m).reduce((a, v) => a + Number(v || 0), 0);
  const eff = Number(f.operators) && Number(f.minutes) ? Math.round(((total * o.style.sam) / (Number(f.operators) * Number(f.minutes))) * 10_000) / 100 : null;
  const save = useMutation({
    mutationFn: () =>
      api.post(`/garment/orders/${o.id}/outputs`, { ...f, helpers: f.helpers || 0, rejects: f.rejects || 0, pieces: Object.fromEntries(Object.entries(m).filter(([, v]) => Number(v) > 0)) }),
    onSuccess: () => (toast.success(`Output recorded${eff !== null ? `: ${eff}% efficiency` : ''}`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={`Sewing output for ${o.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.lineId || !total || !f.operators} onClick={() => save.mutate()}>
          Record {total || ''} pcs
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Date" required>
          <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Sewing line" required className="lg:col-span-2" error={errors.lineId}>
          <Select
            value={f.lineId}
            onChange={(e) => setF({ ...f, lineId: e.target.value })}
            placeholder="Choose"
            options={(lists.data?.lines ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))}
          />
        </Field>
        <Field label="Operators" required>
          <NumberInput decimals={0} min={1} value={f.operators} onChange={(v) => setF({ ...f, operators: v })} />
        </Field>
        <Field label="Helpers">
          <NumberInput decimals={0} min={0} value={f.helpers} onChange={(v) => setF({ ...f, helpers: v })} />
        </Field>
        <Field label="Minutes worked" required>
          <NumberInput decimals={0} min={1} max={1440} value={f.minutes} onChange={(v) => setF({ ...f, minutes: v })} />
        </Field>
      </div>
      <p className="mb-1 mt-3 text-sm font-medium">Pieces sewn (cut pieces left in grey)</p>
      {errors.pieces && <p className="text-xs text-red-600">{errors.pieces}</p>}
      <MatrixInput style={o.style} values={m} onChange={setM} max={max} />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Rejects">
          <NumberInput decimals={0} min={0} value={f.rejects} onChange={(v) => setF({ ...f, rejects: v })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="self-end pb-2 text-sm">Efficiency: {eff !== null ? <span className="font-semibold">{eff}%</span> : '-'}</div>
      </div>
    </Modal>
  );
}

function ReceiveModal({ o, onClose, onDone }: { o: OrderDetail; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(isoDate());
  const max = useMemo(() => Object.fromEntries(o.lines.map((l) => [k(l.colour, l.size), Math.max(0, l.sewnQty - l.receivedQty)])), [o.lines]);
  const [m, setM] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(max)
        .filter(([, v]) => v > 0)
        .map(([key, v]) => [key, String(v)]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = Object.values(m).reduce((a, v) => a + Number(v || 0), 0);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/garment/orders/${o.id}/receipts`, {
        date,
        rows: Object.entries(m)
          .filter(([, v]) => Number(v) > 0)
          .map(([key, v]) => ({ colour: key.split('|')[0], size: key.split('|')[1], qty: v })),
      }),
    onSuccess: () => (toast.success(`${total} pieces into finished goods`), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={`Pack & receive ${o.number}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!total} onClick={() => save.mutate()}>
          Receive {total || ''} pcs
        </Button>
      }
    >
      <Field label="Date">
        <DatePicker value={date} max={isoDate()} clearable={false} onChange={(v) => setDate(v ?? isoDate())} />
      </Field>
      <p className="mb-1 mt-3 text-sm font-medium">Pieces packed (sewn and not packed yet in grey)</p>
      {errors.rows && <p className="text-xs text-red-600">{errors.rows}</p>}
      <MatrixInput style={o.style} values={m} onChange={setM} max={max} />
      <p className="mt-3 text-xs text-slate-500">
        Each piece takes its share of the fabric cut, its trims (issued now from {o.warehouse?.name}) and SAM {num(o.style.sam, 3)} x the cost per minute in Settings; into {o.fgWarehouse?.name}.
      </p>
    </Modal>
  );
}

function MatrixModal({ o, onClose, onDone }: { o: OrderDetail; onClose: () => void; onDone: () => void }) {
  const [m, setM] = useState<Record<string, string>>(Object.fromEntries(o.lines.map((l) => [k(l.colour, l.size), String(l.qty)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/garment/orders/${o.id}/matrix`, { matrix: Object.entries(m).map(([key, v]) => ({ colour: key.split('|')[0], size: key.split('|')[1], qty: v || 0 })) }),
    onSuccess: () => (toast.success('Matrix updated'), onDone()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={`Order quantities of ${o.number}`}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      {errors.matrix && <p className="mb-1 text-xs text-red-600">{errors.matrix}</p>}
      <MatrixInput style={o.style} values={m} onChange={setM} />
    </Modal>
  );
}

// ============================================================ efficiency
export function EfficiencyPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(isoDate());
  const q = useQuery({
    queryKey: ['garment', 'efficiency', from, to],
    queryFn: () =>
      api.get<{
        rows: {
          id: string;
          date: string;
          line: { code: string; name: string } | null;
          order: string;
          style: string;
          operators: number;
          helpers: number;
          minutes: number;
          pieces: number;
          rejects: number;
          sam: number;
          efficiency: number;
        }[];
        lines: { line: { code: string; name: string } | null; days: number; pieces: number; rejects: number; efficiency: number; rejectPct: number }[];
      }>('/garment/efficiency', { from, to }),
  });
  const d = q.data;
  const csv = () =>
    d &&
    downloadCsv(`line-efficiency-${from}-${to}.csv`, [
      ['Date', 'Line', 'Order', 'Style', 'Operators', 'Helpers', 'Minutes', 'Pieces', 'Rejects', 'SAM', 'Efficiency %'],
      ...d.rows.map((r) => [r.date.slice(0, 10), r.line?.code, r.order, r.style, r.operators, r.helpers, r.minutes, r.pieces, r.rejects, r.sam, r.efficiency]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Line Efficiency"
        subtitle="Minutes produced (pieces x SAM) against minutes available (sewing operators x minutes worked, helpers left out), by sewing line and day. Usual range 50-70%"
        actions={
          <Button variant="outline" icon="download" disabled={!d?.rows.length} onClick={csv}>
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? firstOfMonth())} clearable={false} aria-label="From" />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} aria-label="To" />
        </div>
      </div>
      {q.isLoading || !d ? (
        <Loading />
      ) : !d.rows.length ? (
        <EmptyState icon="gauge" title="No line output in this period" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.lines.map((l) => (
              <Stat key={l.line?.code} label={l.line?.name ?? '-'} value={`${l.efficiency}%`} hint={`${fmtNumber(l.pieces)} pcs · ${l.days} days · rejects ${l.rejectPct}%`} />
            ))}
          </div>
          <Card bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Day</th>
                    <th className="px-2 py-2 text-left">Line</th>
                    <th className="px-2 py-2 text-left">Order / style</th>
                    <th className="px-2 py-2 text-right">Operators</th>
                    <th className="px-2 py-2 text-right">Minutes</th>
                    <th className="px-2 py-2 text-right">Pieces</th>
                    <th className="px-2 py-2 text-right">SAM</th>
                    <th className="px-4 py-2 text-right">Efficiency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2">{fmtDate(r.date)}</td>
                      <td className="px-2 py-2">{r.line?.name}</td>
                      <td className="px-2 py-2">
                        {r.order} · {r.style}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {r.operators}
                        {r.helpers ? ` + ${r.helpers}` : ''}
                      </td>
                      <td className="px-2 py-2 text-right">{r.minutes}</td>
                      <td className="px-2 py-2 text-right">{fmtNumber(r.pieces)}</td>
                      <td className="px-2 py-2 text-right">{num(r.sam, 3)}</td>
                      <td className="px-4 py-2 text-right">
                        <Badge tone={r.efficiency >= 60 ? 'green' : r.efficiency >= 40 ? 'amber' : 'red'}>{r.efficiency}%</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
