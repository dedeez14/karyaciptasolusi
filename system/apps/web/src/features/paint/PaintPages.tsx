import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import type { Tone } from '@/components/ui/primitives';
import { esc, printHtml, PRINT_CSS } from '@/features/compliance/common';

const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const UNIT_LABEL: Record<string, string> = { ML: 'ml', Y: 'oz (Y)', SHOT48: 'shots (1/48 oz)', SHOT64: 'shots (1/64 oz)', SHOT384: 'shots (1/384 oz)' };
const F_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  RETIRED: { label: 'Retired', tone: 'gray' },
};
const BASE_TYPES: Record<string, string> = { PASTEL: 'Pastel / white', MEDIUM: 'Medium', DEEP: 'Deep', ACCENT: 'Accent', CLEAR: 'Clear' };
const GHS: Record<string, string> = {
  GHS01: 'Exploding bomb',
  GHS02: 'Flame',
  GHS03: 'Flame over circle',
  GHS04: 'Gas cylinder',
  GHS05: 'Corrosion',
  GHS06: 'Skull and crossbones',
  GHS07: 'Exclamation mark',
  GHS08: 'Health hazard',
  GHS09: 'Environment',
};
const SIGNAL: Record<string, string> = { DANGER: 'BAHAYA (Danger)', WARNING: 'AWAS (Warning)', NONE: '-' };

interface Meta {
  unit: string;
  tintFee: number;
  margin: number;
  tol: number;
  lead: number;
}
const useMeta = () => useQuery({ queryKey: ['paint', 'meta'], queryFn: () => api.get<Meta>('/paint/meta') });

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}
function Swatch({ hex, size = 'h-8 w-8' }: { hex: string | null | undefined; size?: string }) {
  return <span className={`inline-block shrink-0 rounded-md border border-line ${size}`} style={{ background: hex ?? 'transparent' }} aria-hidden />;
}

// ============================================================ colours & formulas
interface Colour {
  id: string;
  code: string;
  name: string;
  collection: string | null;
  L: number;
  a: number;
  b: number;
  tolerance: number | null;
  limit: number;
  hex: string;
  notes: string | null;
  isActive: boolean;
  approved?: number;
}
interface Formula {
  id: string;
  colourId: string;
  baseId: string;
  version: number;
  status: string;
  lines: { colorantId: string; mlPerLitre: number; colorant: { code: string; name: string; hex: string | null } | null }[];
  drawL: number | null;
  drawA: number | null;
  drawB: number | null;
  dE00: number | null;
  loadPct: number;
  drawHex: string | null;
  notes: string | null;
  colour: { id: string; code: string; name: string; hex: string; limit: number };
  base: { id: string; code: string; name: string; baseType: string; maxColorantPct: number; cans: { productId: string; litres: number }[] };
}
interface Base {
  id: string;
  code: string;
  name: string;
  productLine: string | null;
  baseType: string;
  maxColorantPct: number;
  isActive: boolean;
  cans: { productId: string; litres: number; product: { code: string; name: string; salePrice: number } | null }[];
}
interface Colorant {
  id: string;
  code: string;
  name: string;
  productId: string;
  unitMl: number;
  hex: string | null;
  isActive: boolean;
  product: { code: string; name: string } | null;
  stockMl: number;
  costPerMl: number;
}

export function ColoursPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Colour | null>(null);
  const [edit, setEdit] = useState<Colour | 'new' | null>(null);
  const colours = useQuery({ queryKey: ['paint', 'colours', q], queryFn: () => api.get<Colour[]>('/paint/colours', { q: q || undefined }) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Colours & Formulas"
        subtitle="Colour standards in CIELAB (D65/10) and their tint formulas per base: ml of colorant per litre, approved on a drawdown within the dE2000 limit"
        actions={
          can('paint.colour.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New colour
            </Button>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <Card bodyClass="p-0">
          <div className="border-b border-line p-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colour" aria-label="Search colour" />
          </div>
          {colours.isLoading ? (
            <Loading />
          ) : !colours.data?.length ? (
            <EmptyState icon="palette" title="No colours" />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {colours.data.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${sel?.id === c.id ? 'bg-brand-50' : ''}`} onClick={() => setSel(c)}>
                    <Swatch hex={c.hex} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {c.code} · {c.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        L {c.L} a {c.a} b {c.b}
                        {c.approved ? ` · ${c.approved} formula${c.approved > 1 ? 's' : ''}` : ' · no formula'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {sel ? <ColourFormulas colour={sel} onEdit={() => setEdit(sel)} /> : <EmptyState icon="palette" title="Choose a colour" description="Its tint formulas per base show here" />}
      </div>
      {edit && <ColourForm c={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={(c) => (setEdit(null), setSel(c), qc.invalidateQueries({ queryKey: ['paint'] }))} />}
    </div>
  );
}

function ColourForm({ c, onClose, onSaved }: { c?: Colour; onClose: () => void; onSaved: (c: Colour) => void }) {
  const [f, setF] = useState({
    code: c?.code ?? '',
    name: c?.name ?? '',
    collection: c?.collection ?? '',
    L: c ? String(c.L) : '',
    a: c ? String(c.a) : '',
    b: c ? String(c.b) : '',
    tolerance: c?.tolerance ? String(c.tolerance) : '',
    notes: c?.notes ?? '',
    isActive: c?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (c ? api.put<Colour>(`/paint/colours/${c.id}`, f) : api.post<Colour>('/paint/colours', f)),
    onSuccess: (r) => (toast.success('Colour saved'), onSaved(r)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={c ? `Colour ${c.code}` : 'New colour'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || f.L === ''} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="L*" required>
          <NumberInput decimals={3} min={0} max={100} value={f.L} onChange={(v) => setF({ ...f, L: v })} />
        </Field>
        <Field label="a*" required>
          <NumberInput decimals={3} min={-128} max={128} value={f.a} onChange={(v) => setF({ ...f, a: v })} />
        </Field>
        <Field label="b*" required>
          <NumberInput decimals={3} min={-128} max={128} value={f.b} onChange={(v) => setF({ ...f, b: v })} />
        </Field>
        <Field label="Collection / fan deck" className="sm:col-span-2">
          <Input value={f.collection} maxLength={60} onChange={(e) => setF({ ...f, collection: e.target.value })} />
        </Field>
        <Field label="Limit (dE2000)" help="Empty: the default in Settings">
          <NumberInput decimals={2} min={0} max={10} value={f.tolerance} onChange={(v) => setF({ ...f, tolerance: v })} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Measure with a spectrophotometer, D65 illuminant, 10 degree observer; check metamerism under a second light (A or TL84).</p>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function ColourFormulas({ colour, onEdit }: { colour: Colour; onEdit: () => void }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Formula | 'new' | null>(null);
  const q = useQuery({ queryKey: ['paint', 'formulas', colour.id], queryFn: () => api.get<Formula[]>('/paint/formulas', { colourId: colour.id }) });
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/paint/formulas/${id}/approve`),
    onSuccess: () => (toast.success('Formula approved'), qc.invalidateQueries({ queryKey: ['paint'] })),
    onError: (e) => toast.error(e),
  });
  const retire = useMutation({
    mutationFn: (id: string) => api.post(`/paint/formulas/${id}/retire`),
    onSuccess: () => (toast.success('Formula retired'), qc.invalidateQueries({ queryKey: ['paint'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-3">
          <Swatch hex={colour.hex} size="h-10 w-10" /> {colour.code} · {colour.name}
        </span>
      }
      subtitle={`L ${colour.L} a ${colour.a} b ${colour.b} · limit dE2000 ${colour.limit}${colour.collection ? ` · ${colour.collection}` : ''}`}
      actions={
        can('paint.colour.manage') && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon="pencil" onClick={onEdit}>
              Colour
            </Button>
            <Button size="sm" icon="plus" onClick={() => setEdit('new')}>
              Formula
            </Button>
          </div>
        )
      }
      bodyClass="p-0"
    >
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <p className="px-4 py-4 text-sm text-slate-500">No formulas yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              {f.drawHex && <Swatch hex={f.drawHex} />}
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {f.base.name} · v{f.version}
                </span>{' '}
                <Badge tone={F_STATUS[f.status].tone}>{F_STATUS[f.status].label}</Badge>
                <span className="block text-xs text-slate-500">
                  {f.lines.map((l) => `${l.colorant?.code} ${l.mlPerLitre} ml/L`).join(' + ')} · load {f.loadPct}% of {f.base.maxColorantPct}%
                  {f.dE00 !== null ? ` · drawdown dE2000 ${f.dE00}` : ' · no drawdown'}
                </span>
              </span>
              {can('paint.colour.manage') && f.status === 'DRAFT' && (
                <>
                  <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(f)}>
                    Edit
                  </Button>
                  <Button size="sm" icon="check" loading={approve.isPending} onClick={() => approve.mutate(f.id)}>
                    Approve
                  </Button>
                </>
              )}
              {can('paint.colour.manage') && f.status === 'APPROVED' && (
                <Button size="sm" variant="ghost" icon="archive" aria-label="Retire" onClick={async () => (await confirm({ title: 'Retire this formula?' })) && retire.mutate(f.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && <FormulaForm colour={colour} f={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['paint'] }))} />}
    </Card>
  );
}

function FormulaForm({ colour, f, onClose, onSaved }: { colour: Colour; f?: Formula; onClose: () => void; onSaved: () => void }) {
  const bases = useQuery({ queryKey: ['paint', 'bases'], queryFn: () => api.get<Base[]>('/paint/bases') });
  const colorants = useQuery({ queryKey: ['paint', 'colorants'], queryFn: () => api.get<Colorant[]>('/paint/colorants') });
  const [baseId, setBaseId] = useState(f?.baseId ?? '');
  const [lines, setLines] = useState(f?.lines.map((l) => ({ colorantId: l.colorantId, mlPerLitre: String(l.mlPerLitre) })) ?? [{ colorantId: '', mlPerLitre: '' }]);
  const [draw, setDraw] = useState({
    drawL: f?.drawL !== null && f?.drawL !== undefined ? String(f.drawL) : '',
    drawA: f?.drawA !== null && f?.drawA !== undefined ? String(f.drawA) : '',
    drawB: f?.drawB !== null && f?.drawB !== undefined ? String(f.drawB) : '',
    notes: f?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = bases.data?.find((b) => b.id === baseId);
  const load = Math.round((lines.reduce((a, l) => a + Number(l.mlPerLitre || 0), 0) / 1000) * 10000) / 100;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        colourId: colour.id,
        baseId,
        lines: lines.filter((l) => l.colorantId && Number(l.mlPerLitre) > 0),
        drawL: draw.drawL || null,
        drawA: draw.drawA || null,
        drawB: draw.drawB || null,
        notes: draw.notes,
      };
      return f ? api.put(`/paint/formulas/${f.id}`, body) : api.post('/paint/formulas', body);
    },
    onSuccess: () => (toast.success('Formula saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`${f ? `Formula v${f.version}` : 'New formula'} for ${colour.code}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!baseId} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <Field label="Base" required error={errors.baseId}>
        <Select
          disabled={!!f}
          value={baseId}
          onChange={(e) => setBaseId(e.target.value)}
          placeholder="Choose"
          options={(bases.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: `${b.name} (${BASE_TYPES[b.baseType]}, max ${b.maxColorantPct}%)` }))}
        />
      </Field>
      <p className="mb-2 mt-4 text-sm font-medium">
        Colorants per litre of base · load {load}%{base ? ` of ${base.maxColorantPct}%` : ''}
      </p>
      {errors.lines && <p className="mb-1 text-xs text-red-600">{errors.lines}</p>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_8rem_2.5rem] gap-2">
            <Select
              value={l.colorantId}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, colorantId: e.target.value } : x)))}
              placeholder="Colorant"
              options={(colorants.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
            />
            <NumberInput
              decimals={3}
              min={0}
              value={l.mlPerLitre}
              placeholder="ml / L"
              onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, mlPerLitre: v } : x)))}
              aria-label="ml per litre"
            />
            <Button variant="ghost" size="icon" icon="x" aria-label="Remove colorant" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setLines([...lines, { colorantId: '', mlPerLitre: '' }])}>
        Colorant
      </Button>
      <p className="mb-2 mt-4 text-sm font-medium">Drawdown measured (D65/10) · approved when dE2000 is within {colour.limit}</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="L*">
          <NumberInput decimals={3} min={0} max={100} value={draw.drawL} onChange={(v) => setDraw({ ...draw, drawL: v })} />
        </Field>
        <Field label="a*">
          <NumberInput decimals={3} min={-128} max={128} value={draw.drawA} onChange={(v) => setDraw({ ...draw, drawA: v })} />
        </Field>
        <Field label="b*">
          <NumberInput decimals={3} min={-128} max={128} value={draw.drawB} onChange={(v) => setDraw({ ...draw, drawB: v })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={draw.notes} onChange={(e) => setDraw({ ...draw, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

// ============================================================ bases & colorants
export function BasesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [base, setBase] = useState<Base | 'new' | null>(null);
  const [col, setCol] = useState<Colorant | 'new' | null>(null);
  const bases = useQuery({ queryKey: ['paint', 'bases'], queryFn: () => api.get<Base[]>('/paint/bases') });
  const colorants = useQuery({ queryKey: ['paint', 'colorants'], queryFn: () => api.get<Colorant[]>('/paint/colorants') });
  const done = () => (setBase(null), setCol(null), qc.invalidateQueries({ queryKey: ['paint'] }));
  return (
    <div className="space-y-5">
      <PageHeader title="Bases & Colorants" subtitle="Tinting bases (each can size a stock product, short-filled for the colorant) and the machine's colorants with their cost per ml" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Bases"
          actions={
            can('paint.colour.manage') && (
              <Button size="sm" icon="plus" onClick={() => setBase('new')}>
                Base
              </Button>
            )
          }
          bodyClass="p-0"
        >
          {!bases.data?.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No bases yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {bases.data.map((b) => (
                <li key={b.id}>
                  <button type="button" className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => setBase(b)}>
                    <span className="font-medium">{b.name}</span> · {BASE_TYPES[b.baseType]} · max {b.maxColorantPct}%
                    <span className="block text-xs text-slate-500">{b.cans.map((c) => `${c.litres} L ${c.product ? fmtMoney(c.product.salePrice, 0) : ''}`).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Colorants"
          actions={
            can('paint.colour.manage') && (
              <Button size="sm" icon="plus" onClick={() => setCol('new')}>
                Colorant
              </Button>
            )
          }
          bodyClass="p-0"
        >
          {!colorants.data?.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No colorants yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {colorants.data.map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => setCol(c)}>
                    <Swatch hex={c.hex} size="h-6 w-6" />
                    <span className="min-w-0 flex-1">
                      {c.code} · {c.name}
                      <span className="block text-xs text-slate-500">
                        Rp {fmtNumber(c.costPerMl, 2)} per ml · {fmtNumber(c.stockMl, 0)} ml in stock
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {base && <BaseForm b={base === 'new' ? undefined : base} onClose={() => setBase(null)} onSaved={done} />}
      {col && <ColorantForm c={col === 'new' ? undefined : col} onClose={() => setCol(null)} onSaved={done} />}
    </div>
  );
}

function BaseForm({ b, onClose, onSaved }: { b?: Base; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: b?.code ?? '',
    name: b?.name ?? '',
    productLine: b?.productLine ?? '',
    baseType: b?.baseType ?? 'PASTEL',
    maxColorantPct: b ? String(b.maxColorantPct) : '3',
    isActive: b?.isActive ?? true,
  });
  const [cans, setCans] = useState(
    b?.cans.map((c) => ({ productId: c.productId as string | null, label: c.product ? `${c.product.code} - ${c.product.name}` : '', litres: String(c.litres) })) ?? [
      { productId: null as string | null, label: '', litres: '' },
    ],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, cans: cans.filter((c) => c.productId && Number(c.litres) > 0).map((c) => ({ productId: c.productId, litres: c.litres })) };
      return b ? api.put(`/paint/bases/${b.id}`, body) : api.post('/paint/bases', body);
    },
    onSuccess: () => (toast.success('Base saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={b ? `Base ${b.code}` : 'New base'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required>
          <Input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Product line">
          <Input value={f.productLine} maxLength={60} onChange={(e) => setF({ ...f, productLine: e.target.value })} />
        </Field>
        <Field label="Base type">
          <Select value={f.baseType} onChange={(e) => setF({ ...f, baseType: e.target.value })} options={Object.entries(BASE_TYPES).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Most colorant (% of volume)" help="Pastel about 3%, medium 4.7%, deep 6.25%, accent 12.5%: more weakens the film">
          <NumberInput decimals={2} min={0} max={30} value={f.maxColorantPct} onChange={(v) => setF({ ...f, maxColorantPct: v })} />
        </Field>
      </div>
      <p className="mb-2 mt-4 text-sm font-medium">Can sizes</p>
      {errors.cans && <p className="mb-1 text-xs text-red-600">{errors.cans}</p>}
      <div className="space-y-2">
        {cans.map((c, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_2.5rem] gap-2">
            <AsyncSelect
              resource="products"
              value={c.productId}
              initialLabel={c.label || undefined}
              onChange={(v, o) => setCans(cans.map((x, j) => (j === i ? { ...x, productId: v, label: o?.label ?? '' } : x)))}
              aria-label="Base can product"
            />
            <NumberInput decimals={3} min={0} value={c.litres} placeholder="Litres" onChange={(v) => setCans(cans.map((x, j) => (j === i ? { ...x, litres: v } : x)))} aria-label="Litres" />
            <Button variant="ghost" size="icon" icon="x" aria-label="Remove can" onClick={() => setCans(cans.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setCans([...cans, { productId: null, label: '', litres: '' }])}>
        Can size
      </Button>
    </Modal>
  );
}

function ColorantForm({ c, onClose, onSaved }: { c?: Colorant; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: c?.code ?? '',
    name: c?.name ?? '',
    productId: c?.productId ?? (null as string | null),
    unitMl: c ? String(c.unitMl) : '1000',
    hex: c?.hex ?? '',
    isActive: c?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => (c ? api.put(`/paint/colorants/${c.id}`, f) : api.post('/paint/colorants', f)),
    onSuccess: () => (toast.success('Colorant saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={c ? `Colorant ${c.code}` : 'New colorant'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.productId} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code (machine canister)" required error={errors.code}>
          <Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required>
          <Input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Stock product" required className="sm:col-span-2" error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} initialLabel={c?.product ? `${c.product.code} - ${c.product.name}` : undefined} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="ml per stock unit" help="1000 when stocked in litres">
          <NumberInput decimals={3} min={0} value={f.unitMl} onChange={(v) => setF({ ...f, unitMl: v })} />
        </Field>
        <Field label="Swatch colour" error={errors.hex}>
          <Input value={f.hex} maxLength={7} placeholder="#c8a040" onChange={(e) => setF({ ...f, hex: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ shop tinting
interface Quote {
  status: string;
  unit: string;
  can: { productId: string; litres: number; product: { code: string; name: string; salePrice: number } };
  dispensed: { colorantId: string; code: string; name: string; hex: string | null; ml: number; units: number; cost: number }[];
  perCan: { baseCost: number; colorantCost: number; tintFee: number; unitPrice: number };
  cans: number;
  total: number;
}
interface JobRow {
  id: string;
  number: string;
  date: string;
  status: string;
  cans: number;
  canLitres: number;
  colour: { code: string; name: string; hex: string };
  base: string;
  customer: string | null;
  cost: number;
  price: number;
}

export function TintPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['paint', 'jobs'], queryFn: () => api.get<JobRow[]>('/paint/jobs') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tinting"
        subtitle="Tint at the shop from an approved formula: the base can and the colorants leave the stock, a draft invoice is made for the customer"
        actions={
          can('paint.tint') && (
            <Button icon="paint-bucket" onClick={() => setCreating(true)}>
              Tint
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="paint-bucket" title="No tinting yet" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${j.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}`}
                  onClick={() => setOpen(j.id)}
                >
                  <Swatch hex={j.colour.hex} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {j.number} · {j.colour.code} {j.colour.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(j.date)} · {j.cans} x {j.base} · {j.customer ?? 'walk-in'}
                    </span>
                  </span>
                  <span className="text-right text-xs">
                    {fmtMoney(j.price, 0)}
                    <span className="block text-slate-500">cost {fmtMoney(j.cost, 0)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <TintModal onClose={() => setCreating(false)} onDone={(id) => (setCreating(false), setOpen(id), qc.invalidateQueries({ queryKey: ['paint'] }))} />}
      {open && <JobModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TintModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const meta = useMeta();
  const [q, setQ] = useState('');
  const colours = useQuery({ queryKey: ['paint', 'colours', q], queryFn: () => api.get<Colour[]>('/paint/colours', { q: q || undefined }) });
  const [f, setF] = useState({ colourId: '', formulaId: '', baseProductId: '', cans: '1', warehouseId: null as string | null, customerId: null as string | null, date: isoDate(), notes: '' });
  const formulas = useQuery({
    queryKey: ['paint', 'formulas', f.colourId, 'APPROVED'],
    queryFn: () => api.get<Formula[]>('/paint/formulas', { colourId: f.colourId, status: 'APPROVED' }),
    enabled: !!f.colourId,
  });
  const fm = formulas.data?.find((x) => x.id === f.formulaId);
  const quote = useQuery({
    queryKey: ['paint', 'quote', f.formulaId, f.baseProductId, f.cans],
    queryFn: () => api.get<Quote>('/paint/quote', { formulaId: f.formulaId, baseProductId: f.baseProductId, cans: f.cans || 1 }),
    enabled: !!f.formulaId && !!f.baseProductId,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post<{ id: string }>('/paint/jobs', f),
    onSuccess: (r) => (toast.success('Tinted'), onDone(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const d = quote.data;
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="Tint paint"
      footer={
        <Button icon="paint-bucket" loading={save.isPending} disabled={!f.formulaId || !f.baseProductId || !f.warehouseId} onClick={() => save.mutate()}>
          Dispense {f.cans} can{Number(f.cans) > 1 ? 's' : ''}
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Colour code or name" aria-label="Search colour" />
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {(colours.data ?? [])
              .filter((c) => c.isActive && c.approved)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${f.colourId === c.id ? 'bg-brand-50' : ''}`}
                    onClick={() => setF({ ...f, colourId: c.id, formulaId: '', baseProductId: '' })}
                  >
                    <Swatch hex={c.hex} size="h-6 w-6" /> {c.code} · {c.name}
                  </button>
                </li>
              ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Base and formula" required>
              <Select
                value={f.formulaId}
                onChange={(e) => setF({ ...f, formulaId: e.target.value, baseProductId: '' })}
                placeholder={f.colourId ? 'Choose' : 'Choose the colour first'}
                options={(formulas.data ?? []).map((x) => ({ value: x.id, label: `${x.base.name} v${x.version}` }))}
              />
            </Field>
            <Field label="Can" required error={errors.baseProductId}>
              <Select
                value={f.baseProductId}
                onChange={(e) => setF({ ...f, baseProductId: e.target.value })}
                placeholder="Choose"
                options={(fm?.base.cans ?? []).map((c) => ({ value: c.productId, label: `${c.litres} L` }))}
              />
            </Field>
            <Field label="Cans" required>
              <NumberInput decimals={0} min={1} max={10000} value={f.cans} onChange={(v) => setF({ ...f, cans: v })} />
            </Field>
            <Field label="Shop warehouse" required error={errors.warehouseId}>
              <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
            </Field>
            <Field label="Customer" help="Empty: walk-in (stock out only, no invoice)">
              <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
            </Field>
            <Field label="Date" required>
              <DatePicker value={f.date} max={isoDate()} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
            </Field>
          </div>
          {d && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-2 font-medium">
                Dispense per {d.can.litres} L can ({UNIT_LABEL[d.unit] ?? d.unit})
              </p>
              <table className="w-full">
                <tbody>
                  {d.dispensed.map((x) => (
                    <tr key={x.colorantId}>
                      <td className="py-0.5">
                        <span className="inline-flex items-center gap-2">
                          <Swatch hex={x.hex} size="h-4 w-4" /> {x.code} {x.name}
                        </span>
                      </td>
                      <td className="text-right font-semibold">{fmtNumber(x.units, 2)}</td>
                      <td className="text-right text-xs text-slate-500">{fmtNumber(x.ml, 2)} ml</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">
                Base {fmtMoney(d.can.product.salePrice, 0)} + colorants (cost {fmtMoney(d.perCan.colorantCost, 0)} + {meta.data?.margin ?? 0}%) + tinting {fmtMoney(d.perCan.tintFee, 0)} ={' '}
                <span className="font-semibold text-slate-800">{fmtMoney(d.perCan.unitPrice, 0)}</span> per can · {fmtMoney(d.total, 0)} in all
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function JobModal({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['paint', 'job', id],
    queryFn: () =>
      api.get<{
        id: string;
        number: string;
        date: string;
        status: string;
        cans: number;
        canLitres: number;
        dispensed: Quote['dispensed'];
        baseCost: number;
        colorantCost: number;
        tintFee: number;
        unitPrice: number;
        colour: { code: string; name: string; hex: string };
        customer: { name: string } | null;
        invoice: { id: string; number: string; status: string } | null;
        base: { code: string; name: string } | null;
      }>(`/paint/jobs/${id}`),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/paint/jobs/${id}/cancel`),
    onSuccess: () => (toast.success('Cancelled: base and colorants back in stock'), qc.invalidateQueries({ queryKey: ['paint'] })),
    onError: (e) => toast.error(e),
  });
  const j = q.data;
  const label = () => {
    if (!j) return;
    printHtml(`<!doctype html><html><head><title>${esc(j.number)}</title><style>${PRINT_CSS} .lbl{border:1px solid #333;padding:8px;width:90mm;margin-bottom:6mm} .sw{display:inline-block;width:14mm;height:14mm;border:1px solid #333;vertical-align:middle;margin-right:4px}</style></head><body>
${Array.from({ length: Math.min(j.cans, 50) })
  .map(
    () => `<div class="lbl"><div><span class="sw" style="background:${esc(j.colour.hex)}"></span><b>${esc(j.colour.code)} ${esc(j.colour.name)}</b></div>
<div>${esc(j.base?.name ?? '')} · ${j.canLitres} L</div><div>Tinted ${esc(fmtDate(j.date))} · ${esc(j.number)}</div>
<div class="muted">${j.dispensed.map((x) => `${esc(x.code)} ${fmtNumber(x.units, 2)}`).join(' · ')}</div></div>`,
  )
  .join('')}</body></html>`);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={j ? `${j.number}` : 'Tinting job'}
      footer={
        j && (
          <div className="flex gap-2">
            <Button variant="outline" icon="printer" onClick={label}>
              Can labels
            </Button>
            {j.status === 'DONE' && can('paint.tint') && (
              <Button
                variant="ghost"
                icon="x"
                loading={cancel.isPending}
                onClick={async () =>
                  (await confirm({ title: `Cancel ${j.number}?`, message: 'Base and colorants go back into stock; a draft invoice is dropped.', danger: true, confirmText: 'Cancel job' })) &&
                  cancel.mutate()
                }
              >
                Cancel (mistint)
              </Button>
            )}
          </div>
        )
      }
    >
      {!j ? (
        <Loading />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-3">
            <Swatch hex={j.colour.hex} size="h-10 w-10" />
            <span>
              <span className="block font-medium">
                {j.colour.code} {j.colour.name}
              </span>
              {j.cans} x {j.base?.name} ({j.canLitres} L) · {fmtDate(j.date)} · {j.customer?.name ?? 'walk-in'} {j.status === 'CANCELLED' && <Badge tone="gray">Cancelled</Badge>}
            </span>
          </p>
          <p>{j.dispensed.map((x) => `${x.code} ${fmtNumber(x.units, 2)} (${fmtNumber(x.ml, 2)} ml)`).join(' · ')} per can</p>
          <p className="text-slate-600">
            Cost: base {fmtMoney(j.baseCost, 0)} + colorants {fmtMoney(j.colorantCost, 0)} · price {fmtMoney(j.unitPrice, 0)} per can
          </p>
          {j.invoice && (
            <p>
              Invoice{' '}
              <Link className="text-brand-600" to={`/documents/SI/${j.invoice.id}`}>
                {j.invoice.number}
              </Link>{' '}
              ({j.invoice.status.toLowerCase()})
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ colour lab & CoA
interface Check {
  id: string;
  number: string;
  seq: number;
  lotNo: string | null;
  L: number;
  a: number;
  b: number;
  dE76: number;
  dE00: number;
  tolerance: number;
  pass: boolean;
  reading: string | null;
  hex: string;
  createdAt: string;
  colour: { code: string; name: string } | null;
  product: { code: string; name: string } | null;
  workOrder: { number: string } | null;
  additions: { productId: string; qty: number; code: string }[];
}

export function LabPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const checks = useQuery({ queryKey: ['paint', 'checks'], queryFn: () => api.get<Check[]>('/paint/checks') });
  const coas = useQuery({
    queryKey: ['paint', 'coa'],
    queryFn: () => api.get<{ id: string; number: string; batch: string; lotNo: string | null; inspectedAt: string | null; product: { code: string; name: string } | null }[]>('/paint/coa'),
  });
  const printCoa = async (id: string) => {
    try {
      const c = await api.get<{
        company: string;
        number: string;
        product: { code: string; name: string } | null;
        lotNo: string | null;
        batch: string;
        qty: number;
        inspectedAt: string | null;
        status: string;
        results: { name: string; unit: string | null; method: string | null; min: number | null; max: number | null; value: number | string | null; pass: boolean | null }[];
        colour: { standard: string; dE00: number; tolerance: number; pass: boolean; checks: number } | null;
        lead: { ppm: number; limit: number; pass: boolean } | null;
        vocGL: number | null;
      }>(`/paint/coa/${id}`);
      const spec = (r: { min: number | null; max: number | null }) =>
        r.min !== null && r.max !== null ? `${r.min} - ${r.max}` : r.min !== null ? `min ${r.min}` : r.max !== null ? `max ${r.max}` : '';
      printHtml(`<!doctype html><html><head><title>CoA ${esc(c.lotNo ?? c.batch)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Certificate of Analysis</h1>
<p><b>${esc(c.company ?? '')}</b><br>${esc(c.product?.code ?? '')} ${esc(c.product?.name ?? '')} · lot ${esc(c.lotNo ?? '-')} · batch ${esc(c.batch)} · ${fmtNumber(c.qty, 2)} · inspected ${c.inspectedAt ? esc(fmtDate(c.inspectedAt.slice(0, 10))) : '-'} · ${esc(c.number)}</p>
<table><tr><th>Test</th><th>Method</th><th>Specification</th><th>Result</th><th>Pass</th></tr>
${c.results.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.method ?? '')}</td><td>${esc(spec(r))} ${esc(r.unit ?? '')}</td><td>${esc(r.value === null ? '-' : String(r.value))} ${esc(r.unit ?? '')}</td><td>${r.pass === null ? '' : r.pass ? 'Yes' : 'No'}</td></tr>`).join('')}
${c.colour ? `<tr><td>Colour vs ${esc(c.colour.standard)}</td><td>CIEDE2000, D65/10</td><td>dE00 max ${c.colour.tolerance}</td><td>${c.colour.dE00}</td><td>${c.colour.pass ? 'Yes' : 'No'}</td></tr>` : ''}
${c.lead ? `<tr><td>Lead (dry film)</td><td></td><td>max ${c.lead.limit} ppm</td><td>${c.lead.ppm} ppm</td><td>${c.lead.pass ? 'Yes' : 'No'}</td></tr>` : ''}
${c.vocGL !== null ? `<tr><td>VOC</td><td></td><td></td><td>${c.vocGL} g/L</td><td></td></tr>` : ''}
</table><p class="muted">Released by quality control (${esc(c.status.toLowerCase())}).</p></body></html>`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Colour Lab & CoA"
        subtitle="Batches measured against their colour standard (dE2000); tinters added to correct a batch are issued to its work order; certificates of analysis for released lots"
        actions={
          can('paint.lab') && (
            <Button icon="flask-conical" onClick={() => setCreating(true)}>
              Colour check
            </Button>
          )
        }
      />
      <Card title="Colour checks" bodyClass="p-0">
        {checks.isLoading ? (
          <Loading />
        ) : !checks.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No colour checks yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {checks.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Swatch hex={c.hex} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {c.workOrder?.number ?? c.product?.code} · check {c.seq} · {c.colour?.code}
                  </span>
                  <span className="block text-xs text-slate-500">
                    dE2000 {c.dE00} (dE*ab {c.dE76}) · {c.reading}
                    {c.lotNo ? ` · lot ${c.lotNo}` : ''}
                    {c.additions.length ? ` · added ${c.additions.map((a) => `${a.code} ${a.qty}`).join(', ')}` : ''}
                  </span>
                </span>
                <Badge tone={c.pass ? 'green' : 'red'}>{c.pass ? 'Pass' : 'Out'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Certificates of analysis" subtitle="Production lots that passed the QC inspection (Quality module)" bodyClass="p-0">
        {!coas.data?.length ? (
          <p className="px-4 py-4 text-sm text-slate-500">No released production lots yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {coas.data.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {c.product?.code} {c.product?.name} · lot {c.lotNo ?? '-'} · {c.batch}
                </span>
                <Button size="sm" variant="outline" icon="printer" onClick={() => printCoa(c.id)}>
                  CoA
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <CheckModal onClose={() => setCreating(false)} onDone={() => (setCreating(false), qc.invalidateQueries({ queryKey: ['paint'] }))} />}
    </div>
  );
}

function CheckModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const orders = useQuery({
    queryKey: ['paint', 'wo'],
    queryFn: () => api.get<{ id: string; number: string; productId: string; product: { code: string; name: string } | null }[]>('/manufacturing/orders', { status: 'RELEASED' }),
  });
  const colours = useQuery({ queryKey: ['paint', 'colours', ''], queryFn: () => api.get<Colour[]>('/paint/colours') });
  const [f, setF] = useState({ workOrderId: '', productId: null as string | null, lotNo: '', colourId: '', L: '', a: '', b: '', notes: '' });
  const [adds, setAdds] = useState<{ productId: string | null; qty: string }[]>([]);
  const [res, setRes] = useState<{ dE00: number; dE76: number; pass: boolean; reading: string; stdHex: string; trialHex: string; dL: number; dC: number; dH: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const wo = orders.data?.find((o) => o.id === f.workOrderId);
  const save = useMutation({
    mutationFn: () =>
      api.post<typeof res>('/paint/checks', { ...f, workOrderId: f.workOrderId || null, productId: wo?.productId ?? f.productId, additions: adds.filter((a) => a.productId && Number(a.qty) > 0) }),
    onSuccess: (r) => (setRes(r), toast.success(r?.pass ? 'Within tolerance' : 'Out of tolerance')),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={res ? onDone : onClose}
      title="Colour check"
      footer={
        res ? (
          <Button onClick={onDone}>Close</Button>
        ) : (
          <Button icon="check" loading={save.isPending} disabled={!f.colourId || f.L === '' || !(wo || f.productId)} onClick={() => save.mutate()}>
            Record
          </Button>
        )
      }
    >
      {res ? (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-center text-xs">
              <Swatch hex={res.stdHex} size="h-14 w-14" />
              <span className="block">Standard</span>
            </span>
            <span className="text-center text-xs">
              <Swatch hex={res.trialHex} size="h-14 w-14" />
              <span className="block">Batch</span>
            </span>
            <span>
              <span className={`block text-2xl font-semibold ${res.pass ? 'text-emerald-600' : 'text-red-600'}`}>dE2000 {res.dE00}</span>
              dE*ab {res.dE76} · {res.reading}
              <span className="block text-xs text-slate-500">
                dL {res.dL} · dC {res.dC} · dH {res.dH}
              </span>
            </span>
          </div>
          {adds.length > 0 && <p>Additions issued to {wo?.number}. Disperse, draw down again and record the next check.</p>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Work order (batch)" help="Empty: a lot outside production">
              <Select
                value={f.workOrderId}
                onChange={(e) => setF({ ...f, workOrderId: e.target.value })}
                placeholder="-"
                options={(orders.data ?? []).map((o) => ({ value: o.id, label: `${o.number} · ${o.product?.name ?? ''}` }))}
              />
            </Field>
            {!f.workOrderId && (
              <Field label="Product" required>
                <AsyncSelect resource="products" value={f.productId} onChange={(v) => setF({ ...f, productId: v })} />
              </Field>
            )}
            <Field label="Lot">
              <Input value={f.lotNo} maxLength={60} onChange={(e) => setF({ ...f, lotNo: e.target.value })} />
            </Field>
            <Field label="Colour standard" required error={errors.colourId}>
              <Select
                value={f.colourId}
                onChange={(e) => setF({ ...f, colourId: e.target.value })}
                placeholder="Choose"
                options={(colours.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))}
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="L*" required>
              <NumberInput decimals={3} min={0} max={100} value={f.L} onChange={(v) => setF({ ...f, L: v })} />
            </Field>
            <Field label="a*" required>
              <NumberInput decimals={3} min={-128} max={128} value={f.a} onChange={(v) => setF({ ...f, a: v })} />
            </Field>
            <Field label="b*" required>
              <NumberInput decimals={3} min={-128} max={128} value={f.b} onChange={(v) => setF({ ...f, b: v })} />
            </Field>
          </div>
          {f.workOrderId && (
            <>
              <p className="mb-2 mt-4 text-sm font-medium">Tinter additions (when out of tolerance; about 70-80% of the computed correction)</p>
              {errors.additions && <p className="mb-1 text-xs text-red-600">{errors.additions}</p>}
              <div className="space-y-2">
                {adds.map((a, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_2.5rem] gap-2">
                    <AsyncSelect resource="products" value={a.productId} onChange={(v) => setAdds(adds.map((x, j) => (j === i ? { ...x, productId: v } : x)))} aria-label="Tinter" />
                    <NumberInput decimals={4} min={0} value={a.qty} placeholder="Qty" onChange={(v) => setAdds(adds.map((x, j) => (j === i ? { ...x, qty: v } : x)))} aria-label="Quantity" />
                    <Button variant="ghost" size="icon" icon="x" aria-label="Remove" onClick={() => setAdds(adds.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setAdds([...adds, { productId: null, qty: '' }])}>
                Addition
              </Button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

// ============================================================ SDS & GHS
interface Sds {
  id: string;
  productId: string;
  version: string;
  revisionDate: string;
  nextReview: string;
  language: string;
  hazardClasses: string | null;
  pictograms: string[];
  signalWord: string;
  hStatements: string[];
  pStatements: string[];
  components: { name: string; cas: string | null; pct: string | null }[];
  flashPointC: number | null;
  boilingPointC: number | null;
  unNumber: string | null;
  shippingName: string | null;
  transportClass: string | null;
  packingGroup: string | null;
  leadPpm: number | null;
  vocGL: number | null;
  notes: string | null;
  dueForReview: boolean;
  leadOver?: boolean;
  product: { id?: string; code: string; name: string } | null;
  company?: { name: string; address: string | null; phone: string | null } | null;
}

export function SdsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Sds | 'new' | null>(null);
  const q = useQuery({ queryKey: ['paint', 'sds'], queryFn: () => api.get<Sds[]>('/paint/sds') });
  const label = async (id: string) => {
    try {
      const s = await api.get<Sds>(`/paint/sds/${id}`);
      printHtml(`<!doctype html><html><head><title>Label ${esc(s.product?.code ?? '')}</title><style>${PRINT_CSS} .lbl{border:2px solid #000;padding:10px;width:120mm} .pg{display:inline-block;border:2px solid #c00;transform:rotate(45deg);width:14mm;height:14mm;margin:6mm 5mm 4mm;position:relative} .pg span{position:absolute;inset:0;transform:rotate(-45deg);font-size:7px;display:flex;align-items:center;justify-content:center;text-align:center}</style></head><body>
<div class="lbl"><h1>${esc(s.product?.name ?? '')}</h1>
<div>${s.pictograms.map((p) => `<span class="pg"><span>${esc(p)}<br>${esc(GHS[p] ?? '')}</span></span>`).join('')}</div>
<h2>${esc(SIGNAL[s.signalWord] ?? '')}</h2>
<p>${s.hStatements.map(esc).join('<br>')}</p><p class="muted">${s.pStatements.map(esc).join('<br>')}</p>
${s.unNumber ? `<p>${esc(s.unNumber)} ${esc(s.shippingName ?? '')}, ${esc(s.transportClass ?? '')}${s.packingGroup ? `, PG ${esc(s.packingGroup)}` : ''}</p>` : ''}
<p class="muted">${esc(s.company?.name ?? '')}${s.company?.address ? `, ${esc(s.company.address)}` : ''}${s.company?.phone ? ` · ${esc(s.company.phone)}` : ''}</p>
<p class="muted">SDS ${esc(s.version)} · ${esc(fmtDate(s.revisionDate))}</p></div>
<p class="muted">Pictograms print as red diamonds with their name: use the official GHS symbols on the production label (Permenperin 87/2009 jo 23/2013, label in Bahasa Indonesia).</p></body></html>`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="SDS & GHS Labels"
        subtitle="Safety data sheets and label data in Bahasa Indonesia (Permenperin 87/2009 jo 23/2013), reviewed at every change and at least every 5 years; kept where workers can see them (Kepmenaker 187/1999)"
        actions={
          can('paint.sds.manage') && (
            <Button icon="plus" onClick={() => setEdit('new')}>
              New SDS
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="triangle-alert" title="No safety data sheets" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-2 py-2 text-left">Hazard</th>
                <th className="px-2 py-2 text-left">Transport</th>
                <th className="px-2 py-2 text-left">Lead / VOC</th>
                <th className="px-2 py-2 text-left">Review</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2">
                    <button type="button" className="text-left font-medium text-brand-600" onClick={() => setEdit(s)}>
                      {s.product?.code} · {s.product?.name}
                    </button>
                    <span className="block text-xs text-slate-500">
                      SDS {s.version} · {fmtDate(s.revisionDate)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {SIGNAL[s.signalWord]}
                    <span className="block text-slate-500">{s.pictograms.join(' ')}</span>
                  </td>
                  <td className="px-2 py-2 text-xs">{s.unNumber ? `${s.unNumber} cl. ${s.transportClass ?? '-'}${s.packingGroup ? ` PG ${s.packingGroup}` : ''}` : '-'}</td>
                  <td className={`px-2 py-2 text-xs ${s.leadOver ? 'text-red-600' : ''}`}>
                    {s.leadPpm !== null ? `${s.leadPpm} ppm Pb` : '-'}
                    {s.vocGL !== null ? ` · ${s.vocGL} g/L` : ''}
                  </td>
                  <td className="px-2 py-2">{s.dueForReview ? <Badge tone="red">Due {fmtDate(s.nextReview)}</Badge> : <span className="text-xs">{fmtDate(s.nextReview)}</span>}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" icon="printer" onClick={() => label(s.id)}>
                      Label
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && (
        <SdsForm
          s={edit === 'new' ? undefined : edit}
          readOnly={!can('paint.sds.manage')}
          onClose={() => setEdit(null)}
          onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['paint'] }))}
        />
      )}
    </div>
  );
}

function SdsForm({ s, readOnly, onClose, onSaved }: { s?: Sds; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    productId: s?.productId ?? (null as string | null),
    version: s ? '' : '1.0',
    revisionDate: isoDate(),
    language: s?.language ?? 'ID',
    hazardClasses: s?.hazardClasses ?? '',
    pictograms: s?.pictograms ?? ([] as string[]),
    signalWord: s?.signalWord ?? 'NONE',
    hStatements: (s?.hStatements ?? []).join('\n'),
    pStatements: (s?.pStatements ?? []).join('\n'),
    components: (s?.components ?? []).map((c) => [c.name, c.cas ?? '', c.pct ?? ''].join(' | ')).join('\n'),
    flashPointC: str(s?.flashPointC),
    boilingPointC: str(s?.boilingPointC),
    unNumber: s?.unNumber ?? '',
    shippingName: s?.shippingName ?? '',
    transportClass: s?.transportClass ?? '',
    packingGroup: s?.packingGroup ?? '',
    leadPpm: str(s?.leadPpm),
    vocGL: str(s?.vocGL),
    notes: s?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lines = (t: string) =>
    t
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api.post('/paint/sds', {
        ...f,
        hStatements: lines(f.hStatements),
        pStatements: lines(f.pStatements),
        components: lines(f.components).map((l) => {
          const [name, cas, pct] = l.split('|').map((x) => x.trim());
          return { name, cas: cas || null, pct: pct || null };
        }),
        packingGroup: f.packingGroup || null,
      }),
    onSuccess: () => (toast.success('Safety data sheet saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const t = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={s ? `New version of the SDS of ${s.product?.code}` : 'New safety data sheet'}
      footer={
        !readOnly && (
          <Button icon="check" loading={save.isPending} disabled={!f.productId || !f.version} onClick={() => save.mutate()}>
            Save as current
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Product" required className="sm:col-span-2" error={errors.productId}>
          <AsyncSelect
            disabled={!!s}
            resource="products"
            value={f.productId}
            initialLabel={s?.product ? `${s.product.code} - ${s.product.name}` : undefined}
            onChange={(v) => setF({ ...f, productId: v })}
          />
        </Field>
        <Field label="Version" required help={s ? `Current ${s.version}` : undefined}>
          <Input value={f.version} maxLength={20} onChange={t('version')} />
        </Field>
        <Field label="Revision date" required>
          <DatePicker value={f.revisionDate} clearable={false} onChange={(v) => setF({ ...f, revisionDate: v ?? isoDate() })} />
        </Field>
        <Field label="Hazard classes" className="sm:col-span-2 lg:col-span-3">
          <Input value={f.hazardClasses} maxLength={500} placeholder="Flam. Liq. 3; Skin Irrit. 2" onChange={t('hazardClasses')} />
        </Field>
        <Field label="Signal word" error={errors.signalWord}>
          <Select value={f.signalWord} onChange={t('signalWord')} options={Object.entries(SIGNAL).map(([value, label]) => ({ value, label }))} />
        </Field>
      </div>
      <p className="mb-1 mt-3 text-sm font-medium">Pictograms</p>
      <div className="flex flex-wrap gap-3 text-sm">
        {Object.entries(GHS).map(([k, v]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={f.pictograms.includes(k)} onChange={(e) => setF({ ...f, pictograms: e.target.checked ? [...f.pictograms, k] : f.pictograms.filter((x) => x !== k) })} /> {k}{' '}
            {v}
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Field label="Hazard statements (one per line)">
          <Textarea rows={4} value={f.hStatements} placeholder="H226 Cairan dan uap mudah menyala" onChange={t('hStatements')} />
        </Field>
        <Field label="Precautionary statements (one per line)">
          <Textarea rows={4} value={f.pStatements} placeholder="P210 Jauhkan dari panas, percikan api..." onChange={t('pStatements')} />
        </Field>
        <Field label="Hazardous components: name | CAS | % (one per line)" className="lg:col-span-2">
          <Textarea rows={3} value={f.components} placeholder="Xylene | 1330-20-7 | 5-10" onChange={t('components')} />
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Flash point (C)">
          <NumberInput decimals={1} min={-100} value={f.flashPointC} onChange={(v) => setF({ ...f, flashPointC: v })} />
        </Field>
        <Field label="Boiling point (C)">
          <NumberInput decimals={1} min={-100} value={f.boilingPointC} onChange={(v) => setF({ ...f, boilingPointC: v })} />
        </Field>
        <Field label="UN number" error={errors.unNumber}>
          <Input value={f.unNumber} maxLength={10} placeholder="UN1263" onChange={t('unNumber')} />
        </Field>
        <Field label="Shipping name">
          <Input value={f.shippingName} maxLength={120} placeholder="PAINT" onChange={t('shippingName')} />
        </Field>
        <Field label="Class">
          <Input value={f.transportClass} maxLength={10} placeholder="3" onChange={t('transportClass')} />
        </Field>
        <Field label="Packing group" help="Empty: from the flash point (UN 1263)">
          <Select value={f.packingGroup} onChange={t('packingGroup')} placeholder="Auto" options={['I', 'II', 'III'].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Lead, dry film (ppm)">
          <NumberInput decimals={1} min={0} value={f.leadPpm} onChange={(v) => setF({ ...f, leadPpm: v })} />
        </Field>
        <Field label="VOC (g/L)">
          <NumberInput decimals={1} min={0} value={f.vocGL} onChange={(v) => setF({ ...f, vocGL: v })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={t('notes')} />
      </Field>
    </Modal>
  );
}
