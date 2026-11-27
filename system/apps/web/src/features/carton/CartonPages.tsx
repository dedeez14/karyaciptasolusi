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
const EST_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'amber' },
  QUOTED: { label: 'Quoted', tone: 'blue' },
  WON: { label: 'Won', tone: 'green' },
  LOST: { label: 'Lost', tone: 'gray' },
};
const JOINT: Record<string, string> = { GLUE: 'Glued', STITCH: 'Stitched', TAPE: 'Taped', NONE: 'None' };
const FOOD: Record<string, string> = { NONE: 'No food contact', INDIRECT: 'Indirect (secondary / transport)', DIRECT: 'Direct (primary food packaging)' };

interface FluteT {
  id: string;
  code: string;
  name: string;
  walls: number;
  caliper: number;
  takeUp1: number;
  takeUp2: number | null;
  allowLW: number;
  allowH: number;
  isActive: boolean;
}
interface Meta {
  styles: Record<string, string>;
  flutes: FluteT[];
  rates: Record<string, number | number[]>;
}
const useMeta = () => useQuery({ queryKey: ['carton', 'meta'], queryFn: () => api.get<Meta>('/carton/meta') });

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

// ============================================================ grades & flutes
interface Grade {
  id: string;
  code: string;
  name: string;
  fluteId: string;
  ectNm: number | null;
  burstKpa: number | null;
  notes: string | null;
  isActive: boolean;
  gsm: number;
  paperGsm: number;
  starchGsm: number;
  costPerM2: number;
  flute: FluteT;
  layers: { role: 'LINER' | 'MEDIUM'; productId: string; gsm: number; pricePerKg: number; product: { code: string; name: string; sniRequired: boolean } | null }[];
}

export function GradesPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const meta = useMeta();
  const q = useQuery({ queryKey: ['carton', 'grades'], queryFn: () => api.get<Grade[]>('/carton/grades') });
  const [grade, setGrade] = useState<Grade | 'new' | null>(null);
  const [flute, setFlute] = useState<FluteT | null>(null);
  const done = () => (setGrade(null), setFlute(null), qc.invalidateQueries({ queryKey: ['carton'] }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Board Grades & Flutes"
        subtitle="Board weight = liners + mediums x take-up + starch per glue line; the cost per m2 comes from the paper price per kg"
        actions={
          can('carton.spec.manage') && (
            <Button icon="plus" onClick={() => setGrade('new')}>
              New grade
            </Button>
          )
        }
      />
      <Card title="Board grades" bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="layers" title="No board grades yet" description="Set up the paper products (liner, medium) with their price per kg first" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Grade</th>
                <th className="px-2 py-2 text-left">Layers (outside to inside)</th>
                <th className="px-2 py-2 text-right">g/m2</th>
                <th className="px-2 py-2 text-right">ECT (N/m)</th>
                <th className="px-4 py-2 text-right">Paper Rp/m2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((g) => (
                <tr key={g.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setGrade(g)}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{g.code}</span>
                    <span className="block text-xs text-slate-500">
                      {g.name} · {g.flute.name}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs">{g.layers.map((l) => `${l.role === 'LINER' ? 'L' : 'M'} ${l.gsm}`).join(' / ')}</td>
                  <td className="px-2 py-2 text-right">{fmtNumber(g.gsm, 1)}</td>
                  <td className="px-2 py-2 text-right">{g.ectNm ? fmtNumber(g.ectNm, 0) : '-'}</td>
                  <td className="px-4 py-2 text-right">{fmtNumber(g.costPerM2, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Flutes" subtitle="Calipers and take-up as measured on your own board; allowances added to the inside dimensions" bodyClass="p-0">
        {!meta.data ? (
          <Loading />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Flute</th>
                <th className="px-2 py-2 text-right">Caliper (mm)</th>
                <th className="px-2 py-2 text-right">Take-up</th>
                <th className="px-2 py-2 text-right">Allowance L / W (mm)</th>
                <th className="px-4 py-2 text-right">Allowance depth (mm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {meta.data.flutes.map((f) => (
                <tr key={f.id} className={can('carton.spec.manage') ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => can('carton.spec.manage') && setFlute(f)}>
                  <td className="px-4 py-2">
                    {f.name}
                    {!f.isActive ? ' (inactive)' : ''}
                  </td>
                  <td className="px-2 py-2 text-right">{f.caliper}</td>
                  <td className="px-2 py-2 text-right">
                    {f.takeUp1}
                    {f.takeUp2 ? ` / ${f.takeUp2}` : ''}
                  </td>
                  <td className="px-2 py-2 text-right">{f.allowLW}</td>
                  <td className="px-4 py-2 text-right">{f.allowH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {grade && meta.data && <GradeForm g={grade === 'new' ? undefined : grade} flutes={meta.data.flutes} readOnly={!can('carton.spec.manage')} onClose={() => setGrade(null)} onSaved={done} />}
      {flute && <FluteForm f={flute} onClose={() => setFlute(null)} onSaved={done} />}
    </div>
  );
}

function FluteForm({ f, onClose, onSaved }: { f: FluteT; onClose: () => void; onSaved: () => void }) {
  const [x, setX] = useState({
    name: f.name,
    caliper: String(f.caliper),
    takeUp1: String(f.takeUp1),
    takeUp2: f.takeUp2 ? String(f.takeUp2) : '',
    allowLW: String(f.allowLW),
    allowH: String(f.allowH),
    isActive: f.isActive,
  });
  const save = useMutation({
    mutationFn: () => api.put(`/carton/flutes/${f.id}`, { ...x, code: f.code, walls: f.walls, takeUp2: x.takeUp2 || null }),
    onSuccess: () => (toast.success('Flute saved'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={f.name}
      footer={
        <Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input value={x.name} maxLength={60} onChange={(e) => setX({ ...x, name: e.target.value })} />
        </Field>
        <Field label="Caliper (mm)">
          <NumberInput decimals={2} min={0} value={x.caliper} onChange={(v) => setX({ ...x, caliper: v })} />
        </Field>
        <Field label="Take-up (first medium)">
          <NumberInput decimals={4} min={1} max={2} value={x.takeUp1} onChange={(v) => setX({ ...x, takeUp1: v })} />
        </Field>
        {f.walls === 2 && (
          <Field label="Take-up (second medium)">
            <NumberInput decimals={4} min={1} max={2} value={x.takeUp2} onChange={(v) => setX({ ...x, takeUp2: v })} />
          </Field>
        )}
        <Field label="Allowance length / width (mm)">
          <NumberInput decimals={2} min={0} value={x.allowLW} onChange={(v) => setX({ ...x, allowLW: v })} />
        </Field>
        <Field label="Allowance depth (mm)">
          <NumberInput decimals={2} min={0} value={x.allowH} onChange={(v) => setX({ ...x, allowH: v })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={x.isActive} onChange={(e) => setX({ ...x, isActive: e.target.checked })} /> Active
      </label>
    </Modal>
  );
}

function GradeForm({ g, flutes, readOnly, onClose, onSaved }: { g?: Grade; flutes: FluteT[]; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const pattern = (walls: number) => (walls === 2 ? ['LINER', 'MEDIUM', 'LINER', 'MEDIUM', 'LINER'] : ['LINER', 'MEDIUM', 'LINER']) as ('LINER' | 'MEDIUM')[];
  const [f, setF] = useState({
    code: g?.code ?? '',
    name: g?.name ?? '',
    fluteId: g?.fluteId ?? flutes.find((x) => x.code === 'C')?.id ?? '',
    ectNm: g?.ectNm ? String(g.ectNm) : '',
    burstKpa: g?.burstKpa ? String(g.burstKpa) : '',
    notes: g?.notes ?? '',
    isActive: g?.isActive ?? true,
  });
  const fl = flutes.find((x) => x.id === f.fluteId);
  const [layers, setLayers] = useState(
    g?.layers.map((l) => ({ role: l.role, productId: l.productId as string | null, label: l.product ? `${l.product.code} - ${l.product.name}` : '', gsm: String(l.gsm), pricePerKg: '' })) ??
      pattern(1).map((role) => ({ role, productId: null as string | null, label: '', gsm: '', pricePerKg: '' })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setFlute = (id: string) => {
    const nf = flutes.find((x) => x.id === id);
    const p = pattern(nf?.walls ?? 1);
    setF({ ...f, fluteId: id });
    if (p.length !== layers.length) setLayers(p.map((role, i) => layers[i] ?? { role, productId: null, label: '', gsm: '', pricePerKg: '' }).map((l, i) => ({ ...l, role: p[i] })));
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, ectNm: f.ectNm || null, burstKpa: f.burstKpa || null, layers: layers.map((l) => ({ role: l.role, productId: l.productId, gsm: l.gsm, pricePerKg: l.pricePerKg || null })) };
      return g ? api.put(`/carton/grades/${g.id}`, body) : api.post('/carton/grades', body);
    },
    onSuccess: () => (toast.success('Board grade saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={g ? `Board grade ${g.code}` : 'New board grade'}
      footer={
        !readOnly && (
          <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || layers.some((l) => !l.productId || !l.gsm)} onClick={() => save.mutate()}>
            Save
          </Button>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required error={errors.code}>
          <Input disabled={readOnly} value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="sm:col-span-2">
          <Input disabled={readOnly} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Flute" required>
          <Select
            disabled={readOnly}
            value={f.fluteId}
            onChange={(e) => setFlute(e.target.value)}
            options={flutes.filter((x) => x.isActive || x.id === f.fluteId).map((x) => ({ value: x.id, label: x.name }))}
          />
        </Field>
        <Field label="ECT (N/m)" help="Measured (ISO 3037) or from the paper makers' SCT; drives the McKee box strength">
          <NumberInput disabled={readOnly} decimals={0} min={0} value={f.ectNm} onChange={(v) => setF({ ...f, ectNm: v })} />
        </Field>
        <Field label="Burst (kPa)">
          <NumberInput disabled={readOnly} decimals={0} min={0} value={f.burstKpa} onChange={(v) => setF({ ...f, burstKpa: v })} />
        </Field>
      </div>
      <p className="mb-2 mt-4 text-sm font-medium">Layers, outside to inside{fl ? ` (${fl.walls === 2 ? 'double' : 'single'} wall)` : ''}</p>
      {errors.layers && <p className="mb-1 text-xs text-red-600">{errors.layers}</p>}
      <div className="space-y-2">
        {layers.map((l, i) => (
          <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_7rem] items-center gap-2">
            <span className="text-xs text-slate-500">{l.role === 'LINER' ? 'Liner' : 'Medium'}</span>
            <AsyncSelect
              disabled={readOnly}
              resource="products"
              value={l.productId}
              initialLabel={l.label || undefined}
              onChange={(v, o) => setLayers(layers.map((x, j) => (j === i ? { ...x, productId: v, label: o?.label ?? '' } : x)))}
              aria-label="Paper"
            />
            <NumberInput
              disabled={readOnly}
              decimals={0}
              min={1}
              value={l.gsm}
              placeholder="gsm"
              onChange={(v) => setLayers(layers.map((x, j) => (j === i ? { ...x, gsm: v } : x)))}
              aria-label="gsm"
            />
            <NumberInput
              disabled={readOnly}
              decimals={0}
              min={0}
              value={l.pricePerKg}
              placeholder="Rp/kg"
              onChange={(v) => setLayers(layers.map((x, j) => (j === i ? { ...x, pricePerKg: v } : x)))}
              aria-label="Price per kg"
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Price per kg empty = the paper product's purchase price. For food-contact boxes buy liner and medium meeting SNI 8218:2024 (Permenperin 6/2025) and keep the supplier's SPPT-SNI.
      </p>
      {g && (
        <p className="mt-2 text-sm">
          {fmtNumber(g.gsm, 1)} g/m2 (paper {fmtNumber(g.paperGsm, 1)} + starch {fmtNumber(g.starchGsm, 1)}) · Rp {fmtNumber(g.costPerM2, 2)} per m2
        </p>
      )}
      <Field label="Notes" className="mt-3">
        <Textarea disabled={readOnly} rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

// ============================================================ specs
interface SpecRow {
  id: string;
  code: string;
  name: string;
  style: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  grade: string | null;
  colours: number;
  dieCut: boolean;
  foodContact: string;
  customer: string | null;
  isActive: boolean;
}
interface Spec {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  productId: string | null;
  style: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  gradeId: string;
  colours: number;
  printCoveragePct: number;
  joint: string;
  dieCut: boolean;
  blankLengthMm: number | null;
  blankWidthMm: number | null;
  bundleQty: number;
  grossKg: number | null;
  stackHeight: number | null;
  safetyFactor: number;
  foodContact: string;
  foodType: string | null;
  inkType: string | null;
  printSide: string | null;
  migrationReport: string | null;
  migrationDate: string | null;
  declarationUntil: string | null;
  recycledPct: number | null;
  recycledApproval: string | null;
  animalInput: boolean;
  halalCertNo: string | null;
  notes: string | null;
  isActive: boolean;
  customer: { id: string; name: string } | null;
  product: { id: string; code: string; name: string } | null;
  grade: { code: string; name: string; gsm: number; costPerM2: number; ectNm: number | null; flute: FluteT };
  blank: { length: number; width: number; fromDrawing: boolean; panels: { l: number; w: number; h: number; flap: number; glueFlap: number } };
  blankM2: number;
  boxWeightG: number;
  boardCostPerBox: number;
  outside: { length: number; width: number; height: number };
  strength: { bctN: number | null; requiredN: number | null; ok: boolean | null };
  compliance: { level: 'warn' | 'info'; text: string }[];
  tools: Tool[];
  estimates: { id: string; number: string; date: string; kind: string; status: string }[];
}

export function SpecsPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const meta = useMeta();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['carton', 'specs'], queryFn: () => api.get<SpecRow[]>('/carton/specs') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Box Specifications"
        subtitle="Customer items by FEFCO style and inside dimensions: blank size, board, print, finishing, strength and food-contact data"
        actions={
          can('carton.spec.manage') && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              New spec
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="box" title="No box specifications" description="Set up a board grade first" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Spec</th>
                <th className="px-2 py-2 text-left">Style</th>
                <th className="px-2 py-2 text-left">Inside L x W x H (mm)</th>
                <th className="px-2 py-2 text-left">Board</th>
                <th className="px-2 py-2 text-left">Print / finishing</th>
                <th className="px-4 py-2 text-left">Customer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/carton/specs/${s.id}`)}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{s.code}</span>
                    <span className="block text-xs text-slate-500">
                      {s.name}
                      {s.foodContact === 'DIRECT' ? ' · food contact' : ''}
                    </span>
                  </td>
                  <td className="px-2 py-2">{s.style}</td>
                  <td className="px-2 py-2">
                    {s.lengthMm} x {s.widthMm}
                    {s.heightMm ? ` x ${s.heightMm}` : ''}
                  </td>
                  <td className="px-2 py-2">{s.grade}</td>
                  <td className="px-2 py-2">
                    {s.colours ? `${s.colours} colour${s.colours > 1 ? 's' : ''}` : 'Plain'}
                    {s.dieCut ? ', die-cut' : ''}
                  </td>
                  <td className="px-4 py-2">{s.customer ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && meta.data && <SpecForm styles={meta.data.styles} onClose={() => setCreating(false)} onSaved={(id) => (setCreating(false), navigate(`/carton/specs/${id}`))} />}
    </div>
  );
}

function SpecForm({ s, styles, onClose, onSaved }: { s?: Spec; styles: Record<string, string>; onClose: () => void; onSaved: (id: string) => void }) {
  const grades = useQuery({ queryKey: ['carton', 'grades'], queryFn: () => api.get<Grade[]>('/carton/grades') });
  const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    code: s?.code ?? '',
    name: s?.name ?? '',
    customerId: s?.customerId ?? (null as string | null),
    productId: s?.productId ?? (null as string | null),
    style: s?.style ?? '0201',
    lengthMm: str(s?.lengthMm),
    widthMm: str(s?.widthMm),
    heightMm: str(s?.heightMm),
    gradeId: s?.gradeId ?? '',
    colours: str(s?.colours ?? 0),
    printCoveragePct: str(s?.printCoveragePct ?? 0),
    joint: s?.joint ?? 'GLUE',
    dieCut: s?.dieCut ?? false,
    blankLengthMm: str(s?.blankLengthMm),
    blankWidthMm: str(s?.blankWidthMm),
    bundleQty: str(s?.bundleQty ?? 25),
    grossKg: str(s?.grossKg),
    stackHeight: str(s?.stackHeight),
    safetyFactor: str(s?.safetyFactor ?? 4),
    foodContact: s?.foodContact ?? 'NONE',
    foodType: s?.foodType ?? '',
    inkType: s?.inkType ?? '',
    printSide: s?.printSide ?? '',
    migrationReport: s?.migrationReport ?? '',
    migrationDate: s?.migrationDate ?? '',
    declarationUntil: s?.declarationUntil ?? '',
    recycledPct: str(s?.recycledPct),
    recycledApproval: s?.recycledApproval ?? '',
    animalInput: s?.animalInput ?? false,
    halalCertNo: s?.halalCertNo ?? '',
    notes: s?.notes ?? '',
    isActive: s?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        foodType: f.foodType || null,
        printSide: f.printSide || null,
        migrationDate: f.migrationDate || null,
        declarationUntil: f.declarationUntil || null,
        heightMm: f.heightMm || 0,
      };
      return s ? api.put<{ id: string }>(`/carton/specs/${s.id}`, body) : api.post<{ id: string }>('/carton/specs', body);
    },
    onSuccess: (r) => (toast.success('Box specification saved'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const t = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nm = (k: keyof typeof f, dp = 0) => ({ decimals: dp, min: 0, value: f[k] as string, onChange: (v: string) => setF({ ...f, [k]: v }) });
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={s ? `Box ${s.code}` : 'New box specification'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name || !f.gradeId || !f.lengthMm || !f.widthMm} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required className="lg:col-span-2">
          <Input value={f.name} maxLength={150} onChange={t('name')} />
        </Field>
        <Field label="Style" required>
          <Select value={f.style} onChange={t('style')} options={Object.entries(styles).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Customer" className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} initialLabel={s?.customer?.name} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Product (finished box)" className="sm:col-span-2" help="Stock item the box is sold as; quotations use it" error={errors.productId}>
          <AsyncSelect resource="products" value={f.productId} initialLabel={s?.product ? `${s.product.code} - ${s.product.name}` : undefined} onChange={(v) => setF({ ...f, productId: v })} />
        </Field>
        <Field label="Inside length (mm)" required>
          <NumberInput {...nm('lengthMm', 1)} />
        </Field>
        <Field label="Inside width (mm)" required>
          <NumberInput {...nm('widthMm', 1)} />
        </Field>
        <Field label="Inside depth (mm)" required={f.style !== 'SHEET'} error={errors.heightMm}>
          <NumberInput {...nm('heightMm', 1)} />
        </Field>
        <Field label="Board grade" required error={errors.gradeId}>
          <Select
            value={f.gradeId}
            onChange={t('gradeId')}
            placeholder="Choose"
            options={(grades.data ?? []).filter((g) => g.isActive || g.id === f.gradeId).map((g) => ({ value: g.id, label: `${g.code} (${g.flute.code})` }))}
          />
        </Field>
        <Field label="Colours">
          <NumberInput decimals={0} min={0} max={8} value={f.colours} onChange={(v) => setF({ ...f, colours: v })} />
        </Field>
        <Field label="Print coverage %" help="Plate area per colour">
          <NumberInput decimals={0} min={0} max={100} value={f.printCoveragePct} onChange={(v) => setF({ ...f, printCoveragePct: v })} />
        </Field>
        <Field label="Joint">
          <Select value={f.joint} onChange={t('joint')} options={Object.entries(JOINT).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Bundle (boxes)">
          <NumberInput {...nm('bundleQty')} />
        </Field>
        <Field label="Blank length from drawing (mm)" help="Die-cut styles: the die drawing beats the formula">
          <NumberInput {...nm('blankLengthMm', 1)} />
        </Field>
        <Field label="Blank width from drawing (mm)" error={errors.blankWidthMm}>
          <NumberInput {...nm('blankWidthMm', 1)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.dieCut} onChange={(e) => setF({ ...f, dieCut: e.target.checked })} /> Die-cut (cutting die)
        </label>
        <Field label="Filled box gross weight (kg)">
          <NumberInput {...nm('grossKg', 2)} />
        </Field>
        <Field label="Boxes stacked">
          <NumberInput {...nm('stackHeight')} />
        </Field>
        <Field label="Safety factor" help="Humidity, storage time, stacking pattern: usually 3-5">
          <NumberInput decimals={2} min={1} max={10} value={f.safetyFactor} onChange={(v) => setF({ ...f, safetyFactor: v })} />
        </Field>
      </div>
      <p className="mb-2 mt-5 text-sm font-medium">Food contact and halal</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Food contact" className="sm:col-span-2" help="BPOM 11/2026 Kemasan Pangan">
          <Select value={f.foodContact} onChange={t('foodContact')} options={Object.entries(FOOD).map(([value, label]) => ({ value, label }))} />
        </Field>
        {f.foodContact !== 'NONE' && (
          <>
            <Field label="Food type">
              <Select value={f.foodType} onChange={t('foodType')} placeholder="-" options={['DRY', 'FATTY', 'MOIST', 'HOT'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
            </Field>
            <Field label="Printed side">
              <Select value={f.printSide} onChange={t('printSide')} placeholder="-" options={['OUTSIDE', 'INSIDE', 'BOTH'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
            </Field>
            <Field label="Ink / coating">
              <Input value={f.inkType} maxLength={60} placeholder="water-based, low migration" onChange={t('inkType')} />
            </Field>
            <Field label="Migration test report">
              <Input value={f.migrationReport} maxLength={120} onChange={t('migrationReport')} />
            </Field>
            <Field label="Report date">
              <DatePicker value={f.migrationDate} onChange={(v) => setF({ ...f, migrationDate: v ?? '' })} />
            </Field>
            <Field label="Declaration to customer valid until">
              <DatePicker value={f.declarationUntil} onChange={(v) => setF({ ...f, declarationUntil: v ?? '' })} />
            </Field>
            <Field label="Recycled fibre %">
              <NumberInput decimals={0} min={0} max={100} value={f.recycledPct} onChange={(v) => setF({ ...f, recycledPct: v })} />
            </Field>
            <Field label="BPOM approval (recycled)" help="Written approval for recycled material in direct contact">
              <Input value={f.recycledApproval} maxLength={120} onChange={t('recycledApproval')} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={f.animalInput} onChange={(e) => setF({ ...f, animalInput: e.target.checked })} /> Animal-derived input (e.g. animal glue)
            </label>
            <Field label="Halal certificate">
              <Input value={f.halalCertNo} maxLength={80} onChange={t('halalCertNo')} />
            </Field>
          </>
        )}
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={t('notes')} />
      </Field>
    </Modal>
  );
}

export function SpecPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const meta = useMeta();
  const [modal, setModal] = useState<'' | 'edit' | 'estimate'>('');
  const q = useQuery({ queryKey: ['carton', 'spec', id], queryFn: () => api.get<Spec>(`/carton/specs/${id}`) });
  const s = q.data;
  if (q.isLoading || !s) return <Loading />;
  const p = s.blank.panels;
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/carton/specs')}
        title={`${s.code} · ${s.name}`}
        subtitle={`${meta.data?.styles[s.style] ?? s.style} · inside ${s.lengthMm} x ${s.widthMm}${s.heightMm ? ` x ${s.heightMm}` : ''} mm · ${s.grade.code}${s.customer ? ` · ${s.customer.name}` : ''}`}
        actions={
          <>
            {can('carton.estimate') && (
              <Button icon="calculator" onClick={() => setModal('estimate')}>
                Estimate
              </Button>
            )}
            {can('carton.spec.manage') && (
              <Button variant="outline" icon="pencil" onClick={() => setModal('edit')}>
                Edit
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Blank (sheet)"
          value={`${fmtNumber(s.blank.length, 0)} x ${fmtNumber(s.blank.width, 0)} mm`}
          hint={`${fmtNumber(s.blankM2, 4)} m2${s.blank.fromDrawing ? ' · from the drawing' : ''}`}
        />
        <Stat label="Board" value={`${fmtNumber(s.boxWeightG, 0)} g per box`} hint={`${fmtNumber(s.grade.gsm, 1)} g/m2 · paper Rp ${fmtNumber(s.boardCostPerBox, 0)}`} />
        <Stat label="Outside" value={`${s.outside.length} x ${s.outside.width} x ${s.outside.height} mm`} hint={`caliper ${s.grade.flute.caliper} mm`} />
        <Stat
          label="Box compression (McKee)"
          value={s.strength.bctN ? `${fmtNumber(s.strength.bctN, 0)} N` : '-'}
          hint={
            s.strength.requiredN
              ? `${fmtNumber(s.strength.requiredN, 0)} N needed${s.strength.ok === false ? ': too weak' : s.strength.ok ? ': enough' : ''}`
              : s.grade.ectNm
                ? 'enter weight and stacking'
                : 'no ECT on the grade'
          }
          tone={s.strength.ok === false ? 'text-red-600' : undefined}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Blank layout" subtitle="Score-to-score panels; flutes run with the depth">
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${s.blank.length + 20} ${s.blank.width + 20}`} className="h-48 w-full" role="img" aria-label="Blank layout">
              <rect x="10" y="10" width={s.blank.length} height={s.blank.width} fill="none" stroke="currentColor" className="text-slate-400" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {s.style.startsWith('02') &&
                [p.glueFlap, p.glueFlap + p.l, p.glueFlap + p.l + p.w, p.glueFlap + 2 * p.l + p.w].map((x, i) => (
                  <line key={i} x1={10 + x} y1="10" x2={10 + x} y2={10 + s.blank.width} stroke="currentColor" className="text-brand-500" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
                ))}
              {s.style.startsWith('02') &&
                [p.flap, s.blank.width - (s.style === '0200' ? 0 : p.flap)]
                  .filter((y) => y > 0 && y < s.blank.width)
                  .map((y, i) => <line key={i} x1="10" y1={10 + y} x2={10 + s.blank.length} y2={10 + y} stroke="currentColor" className="text-amber-500" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />)}
            </svg>
          </div>
          <p className="text-xs text-slate-500">
            Panels L {fmtNumber(p.l, 1)}, W {fmtNumber(p.w, 1)}, depth {fmtNumber(p.h, 1)}, flaps {fmtNumber(p.flap, 1)}, glue flap {p.glueFlap} mm
          </p>
        </Card>
        <Card title="Compliance">
          {!s.compliance.length ? (
            <p className="text-sm text-slate-500">{s.foodContact === 'NONE' ? 'Not a food-contact box.' : 'Nothing missing.'}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {s.compliance.map((c, i) => (
                <li key={i} className={c.level === 'warn' ? 'text-amber-700' : 'text-slate-600'}>
                  {c.text}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            {FOOD[s.foodContact]}
            {s.migrationReport ? ` · migration report ${s.migrationReport}` : ''}
            {s.halalCertNo ? ` · halal ${s.halalCertNo}` : ''}
          </p>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Plates & dies" bodyClass="p-0">
          {!s.tools.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No tooling yet: the first estimate charges new plates{s.dieCut ? ' and a die' : ''}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.tools.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    {t.code} · {t.kind === 'PLATE' ? `plate${t.colour ? ` ${t.colour}` : ''}` : 'die'} · {t.owner === 'CUSTOMER' ? 'customer-owned' : 'ours'}
                    <span className="block text-xs text-slate-500">
                      {fmtNumber(t.impressions, 0)} impressions{t.lifeUsedPct !== null ? ` (${t.lifeUsedPct}% of its life)` : ''}
                      {t.location ? ` · ${t.location}` : ''}
                    </span>
                  </span>
                  <Badge tone={t.status === 'ACTIVE' ? 'green' : 'gray'}>{t.status === 'ACTIVE' ? 'Active' : 'Retired'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Estimates" bodyClass="p-0">
          {!s.estimates.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">No estimates yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.estimates.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <Link className="min-w-0 flex-1 text-brand-600" to={`/carton/estimates/${e.id}`}>
                    {e.number} · {fmtDate(e.date)}
                    {e.kind === 'MAKLON' ? ' · maklon' : ''}
                  </Link>
                  <Badge tone={EST_STATUS[e.status].tone}>{EST_STATUS[e.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {modal === 'edit' && meta.data && <SpecForm s={s} styles={meta.data.styles} onClose={() => setModal('')} onSaved={() => (setModal(''), qc.invalidateQueries({ queryKey: ['carton'] }))} />}
      {modal === 'estimate' && <EstimateModal specId={s.id} customerId={s.customerId} onClose={() => setModal('')} onSaved={(eid) => navigate(`/carton/estimates/${eid}`)} />}
    </div>
  );
}

// ============================================================ estimates
interface Line {
  qty: number;
  gross: number;
  boardM2: number;
  board: number;
  printing: number;
  dieCut: number;
  joint: number;
  tooling: number;
  overhead: number;
  cost: number;
  unitCost: number;
  unitPrice: number;
  total: number;
}
interface Preview {
  blank: { length: number; width: number };
  blankM2: number;
  tooling: { plates: number; die: number; total: number; plateCm2: number; ruleM: number; newPlates: boolean; newDie: boolean };
  result: Line[];
  trim: { rollWidth: number; outs: { outs: number }[]; trimPct: number } | null;
}

function ResultTable({ rows, onQuote, quoting }: { rows: Line[]; onQuote?: (qty: number) => void; quoting?: boolean }) {
  const cols: [keyof Line, string][] = [
    ['board', 'Board'],
    ['printing', 'Print / slot'],
    ['dieCut', 'Die-cut'],
    ['joint', 'Joint'],
    ['tooling', 'Tooling'],
    ['overhead', 'Overhead'],
    ['cost', 'Cost'],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">Quantity</th>
            {cols.map(([, l]) => (
              <th key={l} className="px-2 py-2 text-right">
                {l}
              </th>
            ))}
            <th className="px-2 py-2 text-right">Cost / box</th>
            <th className="px-2 py-2 text-right">Price / box</th>
            <th className="px-4 py-2 text-right">Total</th>
            {onQuote && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.qty}>
              <td className="px-4 py-2 font-medium">
                {fmtNumber(r.qty, 0)}
                <span className="block text-xs font-normal text-slate-500">
                  {fmtNumber(r.gross, 0)} sheets · {fmtNumber(r.boardM2, 0)} m2
                </span>
              </td>
              {cols.map(([k]) => (
                <td key={k} className="px-2 py-2 text-right">
                  {fmtNumber(r[k] as number, 0)}
                </td>
              ))}
              <td className="px-2 py-2 text-right">{fmtNumber(r.unitCost, 2)}</td>
              <td className="px-2 py-2 text-right font-semibold">{fmtNumber(r.unitPrice, 2)}</td>
              <td className="px-4 py-2 text-right">{fmtNumber(r.total, 0)}</td>
              {onQuote && (
                <td className="px-2 py-2 text-right">
                  <Button size="sm" variant="outline" icon="file-text" loading={quoting} onClick={() => onQuote(r.qty)}>
                    Quote
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstimateModal({ specId, customerId, onClose, onSaved }: { specId?: string; customerId?: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const specs = useQuery({ queryKey: ['carton', 'specs'], queryFn: () => api.get<SpecRow[]>('/carton/specs') });
  const [f, setF] = useState({
    specId: specId ?? '',
    customerId: customerId ?? (null as string | null),
    date: isoDate(),
    kind: 'GOODS',
    quantities: '1000, 3000, 5000, 10000',
    billToolingSeparately: true,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qs = f.quantities
    .split(/[\s,;]+/)
    .map((x) => Number(x.replace(/\./g, '')))
    .filter((x) => x > 0)
    .slice(0, 8);
  const body = { ...f, quantities: qs };
  const pv = useQuery({ queryKey: ['carton', 'preview', body], queryFn: () => api.post<Preview>('/carton/estimates/preview', body), enabled: !!f.specId && qs.length > 0 });
  const save = useMutation({
    mutationFn: () => api.post<{ id: string }>('/carton/estimates', body),
    onSuccess: (r) => (toast.success('Estimate saved'), onSaved(r.id)),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const d = pv.data;
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="New estimate"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.specId || !qs.length} onClick={() => save.mutate()}>
          Save estimate
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Box specification" required className="sm:col-span-2" error={errors.specId}>
          <Select
            value={f.specId}
            onChange={(e) => setF({ ...f, specId: e.target.value })}
            placeholder="Choose"
            options={(specs.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
          />
        </Field>
        <Field label="Customer" help="Empty: the spec's customer" className="sm:col-span-2">
          <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        <Field label="Date" required>
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Kind" help="Maklon: the customer supplies the board (PPh 23 2% jasa maklon)">
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'GOODS', label: 'Boxes from our board' },
              { value: 'MAKLON', label: 'Converting the customer’s board' },
            ]}
          />
        </Field>
        <Field label="Quantities" className="sm:col-span-2" help="Up to 8 breaks, separated by commas" error={errors.quantities}>
          <Input value={f.quantities} onChange={(e) => setF({ ...f, quantities: e.target.value })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.billToolingSeparately} onChange={(e) => setF({ ...f, billToolingSeparately: e.target.checked })} /> Bill new plates and dies separately (else spread over the
        boxes)
      </label>
      {pv.isFetching && !d ? (
        <Loading />
      ) : (
        d && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-slate-600">
              Blank {fmtNumber(d.blank.length, 0)} x {fmtNumber(d.blank.width, 0)} mm ({fmtNumber(d.blankM2, 4)} m2) · tooling {fmtMoney(d.tooling.total, 0)}
              {d.tooling.newPlates ? ` (plates ${fmtMoney(d.tooling.plates, 0)})` : ''}
              {d.tooling.newDie ? ` (die ${fmtMoney(d.tooling.die, 0)})` : ''}
              {d.trim ? ` · best deckle ${d.trim.rollWidth} mm, ${d.trim.outs[0].outs} outs, trim ${d.trim.trimPct}%` : ''}
            </p>
            <ResultTable rows={d.result} />
          </div>
        )
      )}
    </Modal>
  );
}

interface Estimate {
  id: string;
  number: string;
  date: string;
  kind: string;
  status: string;
  quantities: number[];
  inputs: {
    blank: { length: number; width: number };
    blankM2: number;
    grade: { code: string; gsm: number; costPerM2: number };
    strength: { bctN: number | null; requiredN: number | null };
    tooling: Preview['tooling'];
    trim: Preview['trim'];
    rates: Record<string, number>;
  };
  result: Line[];
  toolingCharge: number;
  billToolingSeparately: boolean;
  notes: string | null;
  spec: { id: string; code: string; name: string; style: string; lengthMm: number; widthMm: number; heightMm: number; colours: number; dieCut: boolean; joint: string } | null;
  customer: { id: string; name: string } | null;
  quotation: { id: string; number: string; status: string } | null;
}

export function EstimatesPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['carton', 'estimates', status],
    queryFn: () =>
      api.get<
        { id: string; number: string; date: string; kind: string; status: string; spec: { code: string; name: string } | null; customer: string | null; breaks: { qty: number; unitPrice: number }[] }[]
      >('/carton/estimates', { status: status || undefined }),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Carton Estimates"
        subtitle="Cost per box at quantity breaks from the board, printing, die-cutting, joint, tooling, overhead and margin; quote the chosen quantity"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={Object.entries(EST_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            {can('carton.estimate') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New estimate
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="calculator" title="No estimates" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((e) => (
              <li key={e.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50" onClick={() => navigate(`/carton/estimates/${e.id}`)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {e.number} · {e.spec?.code} {e.spec?.name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(e.date)} · {e.customer ?? '-'}
                      {e.kind === 'MAKLON' ? ' · maklon' : ''} · {e.breaks.map((b) => `${fmtNumber(b.qty, 0)} @ ${fmtNumber(b.unitPrice, 2)}`).join(', ')}
                    </span>
                  </span>
                  <Badge tone={EST_STATUS[e.status].tone}>{EST_STATUS[e.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <EstimateModal onClose={() => setCreating(false)} onSaved={(id) => navigate(`/carton/estimates/${id}`)} />}
    </div>
  );
}

export function EstimatePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['carton', 'estimate', id], queryFn: () => api.get<Estimate>(`/carton/estimates/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['carton'] });
  const quote = useMutation({
    mutationFn: (qty: number) => api.post<Estimate>(`/carton/estimates/${id}/quote`, { qty }),
    onSuccess: (r) => (toast.success(`Quotation ${r.quotation?.number} made`), refresh()),
    onError: (e) => toast.error(e),
  });
  const status = useMutation({
    mutationFn: (s: string) => api.post(`/carton/estimates/${id}/status`, { status: s }),
    onSuccess: () => (toast.success('Status updated'), refresh()),
    onError: (e) => toast.error(e),
  });
  const e = q.data;
  if (q.isLoading || !e) return <Loading />;
  const sp = e.spec;
  const print = () => {
    const cells = (r: Line) => [
      fmtNumber(r.qty, 0),
      fmtNumber(r.board, 0),
      fmtNumber(r.printing, 0),
      fmtNumber(r.dieCut, 0),
      fmtNumber(r.joint, 0),
      fmtNumber(r.tooling, 0),
      fmtNumber(r.overhead, 0),
      fmtNumber(r.cost, 0),
      fmtNumber(r.unitPrice, 2),
    ];
    printHtml(`<!doctype html><html><head><title>${esc(e.number)}</title><style>${PRINT_CSS}</style></head><body>
<h1>Carton estimate ${esc(e.number)} · ${esc(fmtDate(e.date))}</h1>
<p>${esc(sp?.code ?? '')} ${esc(sp?.name ?? '')} · inside ${sp?.lengthMm} x ${sp?.widthMm}${sp?.heightMm ? ` x ${sp.heightMm}` : ''} mm · ${esc(e.inputs.grade.code)} (${fmtNumber(e.inputs.grade.gsm, 1)} g/m2) · blank ${fmtNumber(e.inputs.blank.length, 0)} x ${fmtNumber(e.inputs.blank.width, 0)} mm${e.customer ? ` · ${esc(e.customer.name)}` : ''}${e.kind === 'MAKLON' ? ' · converting service (maklon)' : ''}</p>
<table><tr><th>Qty</th><th>Board</th><th>Print / slot</th><th>Die-cut</th><th>Joint</th><th>Tooling</th><th>Overhead</th><th>Cost</th><th>Price / box</th></tr>
${e.result
  .map(
    (r) =>
      `<tr>${cells(r)
        .map((c, i) => `<td${i ? ' class="r"' : ''}>${esc(c)}</td>`)
        .join('')}</tr>`,
  )
  .join('')}</table>
${e.billToolingSeparately && e.toolingCharge ? `<p>Tooling billed once: ${esc(fmtMoney(e.toolingCharge, 0))}</p>` : ''}
<p class="muted">Internal working paper: prices before PPN.</p></body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        back={() => navigate('/carton/estimates')}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {e.number} <Badge tone={EST_STATUS[e.status].tone}>{EST_STATUS[e.status].label}</Badge>
          </span>
        }
        subtitle={`${sp?.code} ${sp?.name} · ${fmtDate(e.date)}${e.customer ? ` · ${e.customer.name}` : ''}${e.kind === 'MAKLON' ? ' · converting the customer’s board (maklon)' : ''}`}
        actions={
          <>
            <Button variant="outline" icon="printer" onClick={print}>
              Print
            </Button>
            {can('carton.estimate') && e.status !== 'WON' && (
              <Button variant="outline" icon="trophy" onClick={() => status.mutate('WON')}>
                Won
              </Button>
            )}
            {can('carton.estimate') && e.status !== 'LOST' && (
              <Button variant="ghost" icon="x" onClick={async () => (await confirm({ title: `Mark ${e.number} lost?` })) && status.mutate('LOST')}>
                Lost
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Blank" value={`${fmtNumber(e.inputs.blank.length, 0)} x ${fmtNumber(e.inputs.blank.width, 0)} mm`} hint={`${fmtNumber(e.inputs.blankM2, 4)} m2`} />
        <Stat label="Board" value={e.inputs.grade.code} hint={`${fmtNumber(e.inputs.grade.gsm, 1)} g/m2 · Rp ${fmtNumber(e.inputs.grade.costPerM2, 2)}/m2`} />
        <Stat label="Tooling" value={fmtMoney(e.inputs.tooling.total, 0)} hint={e.billToolingSeparately ? 'billed once' : 'spread over the boxes'} />
        <Stat
          label="Corrugator"
          value={e.inputs.trim ? `${e.inputs.trim.rollWidth} mm, ${e.inputs.trim.outs[0].outs} outs` : '-'}
          hint={e.inputs.trim ? `side trim ${e.inputs.trim.trimPct}%` : 'no roll fits'}
        />
      </div>
      <Card title="Cost and price" subtitle="Before PPN" bodyClass="p-0">
        <ResultTable rows={e.result} onQuote={can('carton.estimate') && !e.quotation ? (qty) => quote.mutate(qty) : undefined} quoting={quote.isPending} />
      </Card>
      {e.quotation && (
        <p className="text-sm">
          Quoted on{' '}
          <Link className="text-brand-600" to={`/documents/SQ/${e.quotation.id}`}>
            {e.quotation.number}
          </Link>
        </p>
      )}
      {e.kind === 'MAKLON' && (
        <p className="text-xs text-slate-500">
          Converting the customer&apos;s board is a service (jasa maklon, PMK 141/2015): the customer withholds PPh 23 at 2% on the payment; PPN applies to the service.
        </p>
      )}
    </div>
  );
}

// ============================================================ trim planner
export function TrimPage() {
  const specs = useQuery({ queryKey: ['carton', 'specs'], queryFn: () => api.get<SpecRow[]>('/carton/specs') });
  const [items, setItems] = useState([{ specId: '', qty: '5000', sheetWidth: '', sheetLength: '', label: '' }]);
  const [rolls, setRolls] = useState('');
  const [minTrim, setMinTrim] = useState('');
  const run = useMutation({
    mutationFn: () =>
      api.post<{
        rolls: number[];
        minTrim: number;
        items: { key: string; label: string; sheetWidth: number; sheetLength: number; sheets: number; grade: string | null; options: Opt[] }[];
        pair: Opt[];
        pairWarning: string | null;
      }>('/carton/trim', {
        items: items.map((x) => ({ specId: x.specId || null, qty: x.qty, sheetWidth: x.sheetWidth || null, sheetLength: x.sheetLength || null, label: x.label || null })),
        rollWidths: rolls
          ? rolls
              .split(/[,;\s]+/)
              .map(Number)
              .filter(Boolean)
          : undefined,
        minTrim: minTrim || null,
      }),
    onError: (e) => toast.error(e),
  });
  type Opt = { rollWidth: number; outs: { key: string; outs: number }[]; usedWidth: number; trim: number; trimPct: number; runMetres: number; rollM2: number; trimM2: number };
  const d = run.data;
  const OptTable = ({ rows }: { rows: Opt[] }) => (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          <th className="px-4 py-2 text-left">Roll (deckle)</th>
          <th className="px-2 py-2 text-left">Outs</th>
          <th className="px-2 py-2 text-right">Used</th>
          <th className="px-2 py-2 text-right">Trim</th>
          <th className="px-2 py-2 text-right">Run (m)</th>
          <th className="px-4 py-2 text-right">Trim m2</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((o, i) => (
          <tr key={i} className={i === 0 ? 'bg-emerald-50/60' : ''}>
            <td className="px-4 py-2">{o.rollWidth} mm</td>
            <td className="px-2 py-2">{o.outs.map((x) => `${x.outs} x ${x.key}`).join(' + ')}</td>
            <td className="px-2 py-2 text-right">{o.usedWidth} mm</td>
            <td className="px-2 py-2 text-right">
              {o.trim} mm ({o.trimPct}%)
            </td>
            <td className="px-2 py-2 text-right">{fmtNumber(o.runMetres, 0)}</td>
            <td className="px-4 py-2 text-right">{fmtNumber(o.trimM2, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="Corrugator Trim Planner"
        subtitle="Sheets side by side across the corrugator: the roll width and number of outs with the least side trim (at least the minimum trim). Two items of the same board can share a run."
      />
      <Card>
        <div className="space-y-2">
          {items.map((x, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_2.5rem]">
              <Select
                value={x.specId}
                onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, specId: e.target.value } : y)))}
                placeholder="Box spec (or enter the sheet size)"
                options={(specs.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name} (${s.grade})` }))}
              />
              <NumberInput
                decimals={0}
                min={1}
                value={x.sheetWidth}
                disabled={!!x.specId}
                placeholder="Width mm"
                onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, sheetWidth: v } : y)))}
                aria-label="Sheet width"
              />
              <NumberInput
                decimals={0}
                min={1}
                value={x.sheetLength}
                disabled={!!x.specId}
                placeholder="Length mm"
                onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, sheetLength: v } : y)))}
                aria-label="Sheet length"
              />
              <NumberInput decimals={0} min={1} value={x.qty} placeholder="Sheets" onChange={(v) => setItems(items.map((y, j) => (j === i ? { ...y, qty: v } : y)))} aria-label="Sheets" />
              {items.length > 1 ? <Button variant="ghost" size="icon" icon="x" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))} /> : <span />}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {items.length < 2 && (
            <Button variant="outline" icon="plus" onClick={() => setItems([...items, { specId: '', qty: '5000', sheetWidth: '', sheetLength: '', label: '' }])}>
              Second item
            </Button>
          )}
          <div className="w-72">
            <Field label="Roll widths (empty = Settings)">
              <Input value={rolls} placeholder="1600, 1800, 2000, 2200, 2400, 2500" onChange={(e) => setRolls(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Minimum trim (mm)">
              <NumberInput decimals={0} min={0} value={minTrim} onChange={setMinTrim} />
            </Field>
          </div>
          <Button icon="scissors" loading={run.isPending} onClick={() => run.mutate()}>
            Plan
          </Button>
        </div>
      </Card>
      {d && (
        <>
          {d.items.map((it) => (
            <Card key={it.key} title={`${it.label}: ${it.sheetWidth} x ${it.sheetLength} mm sheets, ${fmtNumber(it.sheets, 0)} needed`} bodyClass="p-0">
              {it.options.length ? <OptTable rows={it.options} /> : <p className="px-4 py-4 text-sm text-slate-500">No roll is wide enough.</p>}
            </Card>
          ))}
          {d.pairWarning && <p className="text-sm text-amber-700">{d.pairWarning}</p>}
          {d.pair.length > 0 && (
            <Card title="Both items on one run" subtitle="The run length follows the item that needs more metres" bodyClass="p-0">
              <OptTable rows={d.pair} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================ tooling
interface Tool {
  id: string;
  code: string;
  kind: string;
  specId: string | null;
  customerId: string | null;
  owner: string;
  colour: string | null;
  cost: number;
  madeOn: string | null;
  location: string | null;
  impressions: number;
  lifeImpressions: number | null;
  lifeUsedPct: number | null;
  status: string;
  notes: string | null;
  spec?: { id: string; code: string; name: string } | null;
  customer?: string | null;
}

export function ToolsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [edit, setEdit] = useState<Tool | 'new' | null>(null);
  const [count, setCount] = useState<Tool | null>(null);
  const q = useQuery({ queryKey: ['carton', 'tools', status], queryFn: () => api.get<Tool[]>('/carton/tools', { status: status || undefined }) });
  const retire = useMutation({
    mutationFn: (id: string) => api.post(`/carton/tools/${id}/retire`),
    onSuccess: () => (toast.success('Updated'), qc.invalidateQueries({ queryKey: ['carton'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plates & Dies"
        subtitle="Printing plates (klise) and cutting dies (pisau pond): owner, location and impressions against their life"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-36">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="All"
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'RETIRED', label: 'Retired' },
                ]}
              />
            </div>
            {can('carton.tool.manage') && (
              <Button icon="plus" onClick={() => setEdit('new')}>
                New tool
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <EmptyState icon="stamp" title="No plates or dies" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Tool</th>
                <th className="px-2 py-2 text-left">Spec</th>
                <th className="px-2 py-2 text-left">Owner</th>
                <th className="px-2 py-2 text-left">Location</th>
                <th className="px-2 py-2 text-right">Impressions</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2">
                    <button type="button" className="text-left font-medium text-brand-600" onClick={() => setEdit(t)}>
                      {t.code}
                    </button>
                    <span className="block text-xs text-slate-500">
                      {t.kind === 'PLATE' ? `Plate${t.colour ? ` · ${t.colour}` : ''}` : 'Cutting die'} · {fmtMoney(t.cost, 0)}
                    </span>
                  </td>
                  <td className="px-2 py-2">{t.spec ? <Link to={`/carton/specs/${t.spec.id}`}>{t.spec.code}</Link> : '-'}</td>
                  <td className="px-2 py-2">{t.owner === 'CUSTOMER' ? (t.customer ?? 'Customer') : 'Ours'}</td>
                  <td className="px-2 py-2">{t.location ?? '-'}</td>
                  <td className={`px-2 py-2 text-right ${t.lifeUsedPct !== null && t.lifeUsedPct >= 90 ? 'text-red-600' : ''}`}>
                    {fmtNumber(t.impressions, 0)}
                    {t.lifeUsedPct !== null ? ` (${t.lifeUsedPct}%)` : ''}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {can('carton.tool.manage') && t.status === 'ACTIVE' && (
                      <Button size="sm" variant="outline" icon="plus" onClick={() => setCount(t)}>
                        Impressions
                      </Button>
                    )}
                    {can('carton.tool.manage') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={t.status === 'ACTIVE' ? 'archive' : 'undo-2'}
                        aria-label={t.status === 'ACTIVE' ? 'Retire' : 'Reactivate'}
                        onClick={() => retire.mutate(t.id)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <ToolForm t={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['carton'] }))} />}
      {count && <ImpressionsModal t={count} onClose={() => setCount(null)} onDone={() => (setCount(null), qc.invalidateQueries({ queryKey: ['carton'] }))} />}
    </div>
  );
}

function ToolForm({ t, onClose, onSaved }: { t?: Tool; onClose: () => void; onSaved: () => void }) {
  const specs = useQuery({ queryKey: ['carton', 'specs'], queryFn: () => api.get<SpecRow[]>('/carton/specs') });
  const [f, setF] = useState({
    code: t?.code ?? '',
    kind: t?.kind ?? 'PLATE',
    specId: t?.specId ?? '',
    customerId: t?.customerId ?? (null as string | null),
    owner: t?.owner ?? 'COMPANY',
    colour: t?.colour ?? '',
    cost: t ? String(t.cost) : '',
    madeOn: t?.madeOn ?? '',
    location: t?.location ?? '',
    lifeImpressions: t?.lifeImpressions ? String(t.lifeImpressions) : '',
    notes: t?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, specId: f.specId || null, madeOn: f.madeOn || null, cost: f.cost || 0 };
      return t ? api.put(`/carton/tools/${t.id}`, body) : api.post('/carton/tools', body);
    },
    onSuccess: () => (toast.success('Saved'), onSaved()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t ? `Tool ${t.code}` : 'New plate / die'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Kind" required>
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            options={[
              { value: 'PLATE', label: 'Printing plate (klise)' },
              { value: 'DIE', label: 'Cutting die (pisau pond)' },
            ]}
          />
        </Field>
        <Field label="Box spec" className="sm:col-span-2">
          <Select
            value={f.specId}
            onChange={(e) => setF({ ...f, specId: e.target.value })}
            placeholder="-"
            options={(specs.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
          />
        </Field>
        <Field label="Owner">
          <Select
            value={f.owner}
            onChange={(e) => setF({ ...f, owner: e.target.value })}
            options={[
              { value: 'COMPANY', label: 'Ours' },
              { value: 'CUSTOMER', label: 'Customer (paid by them)' },
            ]}
          />
        </Field>
        <Field label="Customer" error={errors.customerId}>
          <AsyncSelect resource="customers" value={f.customerId} initialLabel={t?.customer ?? undefined} onChange={(v) => setF({ ...f, customerId: v })} />
        </Field>
        {f.kind === 'PLATE' && (
          <Field label="Colour">
            <Input value={f.colour} maxLength={40} onChange={(e) => setF({ ...f, colour: e.target.value })} />
          </Field>
        )}
        <Field label="Cost">
          <NumberInput decimals={0} min={0} value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
        </Field>
        <Field label="Made on">
          <DatePicker value={f.madeOn} onChange={(v) => setF({ ...f, madeOn: v ?? '' })} />
        </Field>
        <Field label="Location (rack)">
          <Input value={f.location} maxLength={80} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label="Life (impressions)">
          <NumberInput decimals={0} min={1} value={f.lifeImpressions} onChange={(v) => setF({ ...f, lifeImpressions: v })} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <Textarea rows={2} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function ImpressionsModal({ t, onClose, onDone }: { t: Tool; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/carton/tools/${t.id}/impressions`, { count: Number(count) }),
    onSuccess: () => (toast.success('Impressions added'), onDone()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Impressions on ${t.code}`}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!Number(count)} onClick={() => save.mutate()}>
          Add
        </Button>
      }
    >
      <Field label="Sheets run with it" help={`So far ${fmtNumber(t.impressions, 0)}${t.lifeImpressions ? ` of ${fmtNumber(t.lifeImpressions, 0)}` : ''}`}>
        <NumberInput decimals={0} min={1} value={count} onChange={setCount} />
      </Field>
    </Modal>
  );
}
