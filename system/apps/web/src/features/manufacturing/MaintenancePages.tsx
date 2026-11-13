import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Switch, Textarea, TimeInput, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function printHtml(html: string) {
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

// ============================================================ subcontracting (maklon)
interface Job {
  id: string;
  seq: number;
  name: string;
  status: string;
  servicePrice: number;
  fee: number;
  goodQty: number;
  scrapQty: number;
  sentAt: string | null;
  receivedAt: string | null;
  supplier: { id: string; name: string; address: string | null; city: string | null; phone: string | null } | null;
  invoice: { id: string; number: string; status: string } | null;
  order: { id: string; number: string; qty: number; plannedDate: string; status: string; product: { code: string; name: string; uom: { code: string } | null } | null };
  materials: { name: string; code: string; uom: string; planned: number; sent: number }[];
}

/** Subcontracting (maklon): what is at which subcontractor, goods back, supplier invoices; delivery notes */
export function SubcontractingPage() {
  const [status, setStatus] = useState('OPEN');
  const q = useQuery({ queryKey: ['mfg', 'subcontracting', status], queryFn: () => api.get<{ company: { name: string; legalName: string | null; address: string | null; city: string | null } | null; jobs: Job[] }>('/manufacturing/subcontracting', { status: status || undefined }) });
  const jobs = q.data?.jobs ?? [];
  const note = (j: Job) => {
    const c = q.data?.company;
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Surat jalan ${esc(j.order.number)}</title><style>
@page { size: A4; margin: 16mm; } body { font: 11px system-ui, sans-serif; } h1 { font-size: 17px; margin: 10px 0; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #aaa; padding: 6px; text-align: left; } th { background: #f1f5f9; } .r { text-align: right; } .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; text-align: center; } .sign div { border-top: 1px solid #333; padding-top: 4px; }
</style></head><body>
<b>${esc(c?.legalName ?? c?.name)}</b><div>${esc([c?.address, c?.city].filter(Boolean).join(', '))}</div>
<h1>Surat Jalan Maklon / Subcontracting Delivery Note</h1>
<div class="grid"><div>To: <b>${esc(j.supplier?.name)}</b><br>${esc([j.supplier?.address, j.supplier?.city].filter(Boolean).join(', '))}${j.supplier?.phone ? '<br>' + esc(j.supplier.phone) : ''}</div>
<div>Work order: <b>${esc(j.order.number)}</b><br>Process: ${esc(j.name)}<br>To make: ${esc(fmtNumber(j.order.qty))} ${esc(j.order.product?.uom?.code ?? '')} ${esc(j.order.product?.name)}<br>Date: ${esc(fmtDate(j.sentAt ?? new Date().toISOString()))}</div></div>
<table><thead><tr><th>Material (property of the sender)</th><th class="r">Quantity</th></tr></thead><tbody>
${j.materials.length ? j.materials.map((m) => `<tr><td>${esc(m.name)} <small>${esc(m.code)}</small></td><td class="r">${esc(fmtNumber(m.sent || m.planned))} ${esc(m.uom)}</td></tr>`).join('') : `<tr><td>Semi-finished goods of ${esc(j.order.number)} (${esc(j.order.product?.name)})</td><td class="r">${esc(fmtNumber(j.order.qty))}</td></tr>`}
</tbody></table>
<p>The goods remain our property; they are sent for processing (maklon) at ${esc(fmtMoney(j.servicePrice, 0))} per finished unit, excl. PPN.</p>
<div class="sign"><div>Sent by</div><div>Received by ${esc(j.supplier?.name)}</div></div>
</body></html>`);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Subcontracting (Maklon)"
        subtitle="Routing steps done by subcontractors: materials sent stay ours (work in process); the fee goes into the product cost and is invoiced by the subcontractor (PPN on the fee, PPh 23 2% withheld when paying, PMK 141/2015)"
        actions={
          <div className="w-40">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="All"
              options={[
                { value: 'OPEN', label: 'At subcontractor' },
                { value: 'DONE', label: 'Received' },
              ]}
            />
          </div>
        }
      />
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !jobs.length ? (
          <EmptyState icon="truck" title="No maklon jobs" description="Add a routing step done by a subcontractor in a bill of materials" />
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {j.supplier?.name} · {j.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    <Link className="text-brand-700 hover:underline" to={`/manufacturing/orders/${j.order.id}`}>
                      {j.order.number}
                    </Link>{' '}
                    · {fmtNumber(j.order.qty)} × {j.order.product?.name} · {fmtMoney(j.servicePrice, 0)} / unit
                    {j.sentAt ? ` · sent ${fmtDate(j.sentAt)}` : ' · not sent yet'}
                    {j.receivedAt ? ` · received ${fmtNumber(j.goodQty)} good, ${fmtNumber(j.scrapQty)} rejected on ${fmtDate(j.receivedAt)}` : ''}
                  </span>
                </span>
                {j.invoice && <Badge tone={j.invoice.status === 'DRAFT' ? 'amber' : 'green'}>{`${j.invoice.number} ${j.invoice.status === 'DRAFT' ? '(draft)' : ''}`}</Badge>}
                {j.status === 'DONE' && <span className="font-semibold tabular-nums">{fmtMoney(j.fee, 0)}</span>}
                <Badge tone={j.status === 'DONE' ? 'green' : j.sentAt ? 'violet' : 'gray'}>{j.status === 'DONE' ? 'Received' : j.sentAt ? 'At subcontractor' : 'To send'}</Badge>
                <Button size="sm" variant="outline" icon="printer" onClick={() => note(j)}>
                  Delivery note
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ============================================================ maintenance orders
interface MOrder {
  id: string;
  number: string;
  type: 'PREVENTIVE' | 'BREAKDOWN' | 'INSPECTION';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  priority: string;
  description: string;
  dueDate: string | null;
  reportedAt: string;
  doneAt: string | null;
  stopsEquipment: boolean;
  downtimeMinutes: string;
  partsCost: string;
  labourHours: string;
  workDone: string | null;
  technician: string | null;
  equipment: { id: string; code: string; name: string; status: string; counterUnit?: string; counter?: string } | null;
  parts?: { productId: string; qty: string; unitCost: string; product: { name: string } | null }[];
}
const TYPE: Record<MOrder['type'], { label: string; tone: 'blue' | 'red' | 'violet' }> = { PREVENTIVE: { label: 'Preventive', tone: 'blue' }, BREAKDOWN: { label: 'Breakdown', tone: 'red' }, INSPECTION: { label: 'K3 inspection', tone: 'violet' } };
const MSTATUS: Record<MOrder['status'], { label: string; tone: 'amber' | 'blue' | 'green' | 'gray' }> = { OPEN: { label: 'Open', tone: 'amber' }, IN_PROGRESS: { label: 'In progress', tone: 'blue' }, DONE: { label: 'Done', tone: 'green' }, CANCELLED: { label: 'Cancelled', tone: 'gray' } };

export function MaintenanceOrdersPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [status, setStatus] = useState('OPEN');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['mnt', 'orders', status], queryFn: () => api.get<MOrder[]>('/maintenance/orders', { status: status || undefined }) });
  const due = useQuery({ queryKey: ['mnt', 'k3'], queryFn: () => api.get<{ id: string; code: string; name: string; certNo: string | null; expiry: string; daysLeft: number }[]>('/maintenance/inspections-due') });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Maintenance Orders"
        subtitle="Preventive work, breakdown repairs and K3 inspections. Parts used leave stock to the maintenance expense; a breakdown that stops a machine counts as downtime"
        actions={
          <div className="flex gap-2">
            <div className="w-40">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(MSTATUS).map(([value, s]) => ({ value, label: s.label }))} />
            </div>
            {can('maintenance.order.manage') && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                New order
              </Button>
            )}
          </div>
        }
      />
      {(due.data?.length ?? 0) > 0 && (
        <Card title="K3 inspection certificates (riksa uji)" subtitle="Expired or expiring within 60 days: plan the inspection by a K3 expert / labour inspector (Permenaker 38/2016, 37/2016)" bodyClass="p-0">
          <ul className="divide-y divide-line">
            {due.data!.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {e.name} <span className="text-xs text-slate-500">{e.code}{e.certNo ? ` · ${e.certNo}` : ''}</span>
                </span>
                <Badge tone={e.daysLeft < 0 ? 'red' : 'amber'}>{e.daysLeft < 0 ? `expired ${-e.daysLeft} days ago` : `${fmtDate(e.expiry)} · ${e.daysLeft} days`}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !q.data?.length ? (
          <EmptyState icon="wrench" title="No maintenance orders" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setOpen(o.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {o.number} · {o.equipment?.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {o.description.split('\n')[0]} · reported {fmtDate(o.reportedAt)}
                      {o.dueDate ? ` · due ${fmtDate(o.dueDate)}` : ''}
                    </span>
                  </span>
                  {o.equipment?.status === 'DOWN' && <Badge tone="red">Machine down</Badge>}
                  <Badge tone={TYPE[o.type].tone}>{TYPE[o.type].label}</Badge>
                  <Badge tone={MSTATUS[o.status].tone}>{MSTATUS[o.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && <NewMaintenance onClose={() => setCreating(false)} onSaved={() => (setCreating(false), qc.invalidateQueries({ queryKey: ['mnt'] }))} />}
      {open && <MaintenanceDialog id={open} onClose={() => setOpen(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['mnt'] })} />}
    </div>
  );
}

function NewMaintenance({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ equipmentId: null as string | null, type: 'BREAKDOWN', priority: 'NORMAL', description: '', dueDate: '', stopsEquipment: true });
  const save = useMutation({ mutationFn: () => api.post<{ number: string }>('/maintenance/orders', { ...f, dueDate: f.dueDate || null, stopsEquipment: f.type === 'BREAKDOWN' && f.stopsEquipment }), onSuccess: (r) => (toast.success(`Order ${r.number} opened`), onSaved()), onError: (e) => toast.error(e) });
  return (
    <Modal
      open
      onClose={onClose}
      title="New maintenance order"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.equipmentId || f.description.trim().length < 3} onClick={() => save.mutate()}>
          Open order
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Equipment" required className="sm:col-span-2">
          <AsyncSelect resource="equipment" value={f.equipmentId} onChange={(v) => setF({ ...f, equipmentId: v })} manageHref="/r/equipment" manageLabel="Manage equipment" />
        </Field>
        <Field label="Kind">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(TYPE).map(([value, t]) => ({ value, label: t.label }))} />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} />
        </Field>
        <Field label="What is the problem / work" required className="sm:col-span-2">
          <Textarea rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Due">
          <DatePicker value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v ?? '' })} />
        </Field>
        {f.type === 'BREAKDOWN' && (
          <div className="flex items-end pb-2">
            <Switch checked={f.stopsEquipment} onChange={(v) => setF({ ...f, stopsEquipment: v })} label="The machine is stopped (downtime)" />
          </div>
        )}
      </div>
    </Modal>
  );
}

function MaintenanceDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['mnt', 'order', id], queryFn: () => api.get<MOrder>(`/maintenance/orders/${id}`) });
  const o = q.data;
  const [f, setF] = useState({ workDone: '', technician: '', labourHours: '', warehouseId: null as string | null, counter: '', inspectionCertNo: '', inspectionExpiry: '' });
  const [parts, setParts] = useState<{ productId: string | null; qty: string }[]>([]);
  const act = useMutation({
    mutationFn: (what: 'start' | 'cancel' | 'complete') =>
      api.post(`/maintenance/orders/${id}/${what}`, what === 'complete' ? { ...f, labourHours: Number(f.labourHours) || 0, counter: f.counter === '' ? undefined : Number(f.counter), inspectionExpiry: f.inspectionExpiry || null, parts: parts.filter((p) => p.productId && Number(p.qty) > 0).map((p) => ({ productId: p.productId, qty: Number(p.qty) })) } : undefined),
    onSuccess: (_, what) => (toast.success(what === 'complete' ? 'Work done recorded' : what === 'start' ? 'Started' : 'Cancelled'), onChanged(), onClose()),
    onError: (e) => toast.error(e),
  });
  const openOrder = o && (o.status === 'OPEN' || o.status === 'IN_PROGRESS');
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={o ? `${o.number} · ${o.equipment?.name}` : 'Maintenance order'}
      footer={
        o &&
        openOrder &&
        can('maintenance.order.manage') && (
          <>
            <Button variant="outline" className="mr-auto" loading={act.isPending && act.variables === 'cancel'} onClick={() => act.mutate('cancel')}>
              Cancel order
            </Button>
            {o.status === 'OPEN' && (
              <Button variant="outline" icon="play" loading={act.isPending && act.variables === 'start'} onClick={() => act.mutate('start')}>
                Start
              </Button>
            )}
            <Button icon="check" disabled={f.workDone.trim().length < 3} loading={act.isPending && act.variables === 'complete'} onClick={() => act.mutate('complete')}>
              Work done
            </Button>
          </>
        )
      }
    >
      {!o ? (
        <Spinner />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={TYPE[o.type].tone}>{TYPE[o.type].label}</Badge>
            <Badge tone={MSTATUS[o.status].tone}>{MSTATUS[o.status].label}</Badge>
            {o.stopsEquipment && <Badge tone="red">Stops the machine</Badge>}
          </div>
          <pre className="rounded-lg bg-slate-50 p-3 font-sans text-xs whitespace-pre-wrap">{o.description}</pre>
          {!openOrder ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-slate-500">Work done</dt>
              <dd>{o.workDone ?? '-'}</dd>
              <dt className="text-slate-500">Technician</dt>
              <dd>{o.technician ?? '-'}</dd>
              <dt className="text-slate-500">Finished</dt>
              <dd>{o.doneAt ? fmtDateTime(o.doneAt) : '-'}</dd>
              <dt className="text-slate-500">Downtime</dt>
              <dd>{fmtNumber(o.downtimeMinutes)} min</dd>
              <dt className="text-slate-500">Parts</dt>
              <dd>
                {fmtMoney(o.partsCost, 0)}
                {o.parts?.map((p) => (
                  <span key={p.productId} className="block text-slate-500">
                    {fmtNumber(p.qty)} × {p.product?.name}
                  </span>
                ))}
              </dd>
            </dl>
          ) : (
            can('maintenance.order.manage') && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Work done" required className="sm:col-span-3">
                  <Textarea rows={2} maxLength={4000} value={f.workDone} onChange={(e) => setF({ ...f, workDone: e.target.value })} />
                </Field>
                <Field label="Technician">
                  <Input value={f.technician} maxLength={120} onChange={(e) => setF({ ...f, technician: e.target.value })} />
                </Field>
                <Field label="Hours worked">
                  <NumberInput decimals={2} min={0} value={f.labourHours} onChange={(v) => setF({ ...f, labourHours: v })} />
                </Field>
                <Field label={`Counter now (${o.equipment?.counterUnit?.toLowerCase() ?? 'hours'})`}>
                  <NumberInput decimals={2} min={0} value={f.counter} onChange={(v) => setF({ ...f, counter: v })} placeholder={o.equipment?.counter ? String(Number(o.equipment.counter)) : ''} />
                </Field>
                {o.type === 'INSPECTION' && (
                  <>
                    <Field label="New K3 certificate no.">
                      <Input value={f.inspectionCertNo} maxLength={100} onChange={(e) => setF({ ...f, inspectionCertNo: e.target.value })} />
                    </Field>
                    <Field label="Valid until">
                      <DatePicker value={f.inspectionExpiry} onChange={(v) => setF({ ...f, inspectionExpiry: v ?? '' })} />
                    </Field>
                  </>
                )}
                <div className="space-y-2 sm:col-span-3">
                  <p className="text-sm font-medium">Spare parts used</p>
                  {parts.length > 0 && (
                    <Field label="From warehouse">
                      <AsyncSelect resource="warehouses" value={f.warehouseId} onChange={(v) => setF({ ...f, warehouseId: v })} />
                    </Field>
                  )}
                  {parts.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                      <AsyncSelect resource="products" value={p.productId} onChange={(v) => setParts((x) => x.map((y, k) => (k === i ? { ...y, productId: v } : y)))} aria-label={`Part ${i + 1}`} />
                      <NumberInput decimals={4} min={0} value={p.qty} onChange={(v) => setParts((x) => x.map((y, k) => (k === i ? { ...y, qty: v } : y)))} aria-label={`Quantity ${i + 1}`} />
                      <Button variant="ghost" size="icon" icon="trash-2" aria-label="Remove part" onClick={() => setParts((x) => x.filter((_, k) => k !== i))} />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" icon="plus" onClick={() => setParts((x) => [...x, { productId: null, qty: '1' }])}>
                    Add part
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ preventive plans
interface MPlan {
  id: string;
  equipmentId: string;
  name: string;
  intervalDays: number;
  intervalCounter: number;
  leadDays: number;
  checklist: string | null;
  estimatedMinutes: number;
  lastDoneAt: string | null;
  lastCounter: number;
  isActive: boolean;
  equipment: { id: string; code: string; name: string; counter: number; counterUnit: string } | null;
  dueDate: string | null;
  dueCounter: number | null;
  counterLeft: number | null;
  due: boolean;
  openOrder: string | null;
}

export function MaintenancePlansPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const q = useQuery({ queryKey: ['mnt', 'plans'], queryFn: () => api.get<MPlan[]>('/maintenance/plans') });
  const [edit, setEdit] = useState<MPlan | 'new' | null>(null);
  const gen = useMutation({ mutationFn: () => api.post<{ created: string[] }>('/maintenance/plans/generate'), onSuccess: (r) => (toast.success(r.created.length ? `Orders ${r.created.join(', ')} created` : 'Nothing due'), qc.invalidateQueries({ queryKey: ['mnt'] })), onError: (e) => toast.error(e) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Preventive Plans"
        subtitle="Service every N days and / or every N hours, shots or km. Machine hours come from the shop floor; due plans get an order every morning"
        actions={
          <div className="flex gap-2">
            {can('maintenance.order.manage') && (
              <Button variant="outline" icon="refresh-cw" loading={gen.isPending} onClick={() => gen.mutate()}>
                Create due orders now
              </Button>
            )}
            {can('maintenance.plan.manage') && (
              <Button icon="plus" onClick={() => setEdit('new')}>
                New plan
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
          <EmptyState icon="calendar-clock" title="No preventive plans" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500">· {p.equipment?.name}</span> {!p.isActive && <Badge tone="gray">Inactive</Badge>}
                  <span className="block text-xs text-slate-500">
                    {[p.intervalDays ? `every ${p.intervalDays} days` : '', p.intervalCounter ? `every ${fmtNumber(p.intervalCounter)} ${p.equipment?.counterUnit.toLowerCase()}` : ''].filter(Boolean).join(' or ')}
                    {p.dueDate ? ` · next ${fmtDate(p.dueDate)}` : ''}
                    {p.counterLeft !== null ? ` · ${fmtNumber(p.counterLeft)} ${p.equipment?.counterUnit.toLowerCase()} left (now ${fmtNumber(p.equipment?.counter)})` : ''}
                  </span>
                </span>
                {p.openOrder ? <Badge tone="blue">{p.openOrder}</Badge> : p.due ? <Badge tone="red">Due</Badge> : <Badge tone="green">OK</Badge>}
                {can('maintenance.plan.manage') && (
                  <Button size="sm" variant="outline" icon="pencil" onClick={() => setEdit(p)}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <PlanEditor plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), qc.invalidateQueries({ queryKey: ['mnt'] }))} />}
    </div>
  );
}

function PlanEditor({ plan, onClose, onSaved }: { plan: MPlan | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ equipmentId: plan?.equipmentId ?? null, name: plan?.name ?? '', intervalDays: String(plan?.intervalDays ?? ''), intervalCounter: String(plan?.intervalCounter || ''), leadDays: String(plan?.leadDays ?? 3), checklist: plan?.checklist ?? '', estimatedMinutes: String(plan?.estimatedMinutes || ''), lastDoneAt: plan?.lastDoneAt?.slice(0, 10) ?? '', lastCounter: String(plan?.lastCounter ?? 0), isActive: plan?.isActive ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, intervalDays: Number(f.intervalDays) || 0, intervalCounter: Number(f.intervalCounter) || 0, leadDays: Number(f.leadDays) || 0, estimatedMinutes: Number(f.estimatedMinutes) || 0, lastCounter: Number(f.lastCounter) || 0, lastDoneAt: f.lastDoneAt || null, checklist: f.checklist || null };
      return plan ? api.put(`/maintenance/plans/${plan.id}`, body) : api.post('/maintenance/plans', body);
    },
    onSuccess: () => (toast.success('Plan saved'), onSaved()),
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={plan ? `Edit ${plan.name}` : 'New preventive plan'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.equipmentId || !f.name.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Equipment" required className="sm:col-span-2">
          <AsyncSelect resource="equipment" value={f.equipmentId} onChange={(v) => setF({ ...f, equipmentId: v })} />
        </Field>
        <Field label="Active">
          <div className="flex h-10 items-center">
            <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
          </div>
        </Field>
        <Field label="Name" required className="sm:col-span-3">
          <Input value={f.name} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Monthly lubrication, 500-hour service..." />
        </Field>
        <Field label="Every (days)" error={errors.intervalDays}>
          <NumberInput min={0} value={f.intervalDays} onChange={(v) => setF({ ...f, intervalDays: v })} />
        </Field>
        <Field label="And / or every (counter)">
          <NumberInput decimals={2} min={0} value={f.intervalCounter} onChange={(v) => setF({ ...f, intervalCounter: v })} />
        </Field>
        <Field label="Create order days ahead">
          <NumberInput min={0} max={90} value={f.leadDays} onChange={(v) => setF({ ...f, leadDays: v })} />
        </Field>
        <Field label="Last done">
          <DatePicker value={f.lastDoneAt} onChange={(v) => setF({ ...f, lastDoneAt: v ?? '' })} />
        </Field>
        <Field label="Counter at last service">
          <NumberInput decimals={2} min={0} value={f.lastCounter} onChange={(v) => setF({ ...f, lastCounter: v })} />
        </Field>
        <Field label="Estimated minutes">
          <NumberInput min={0} value={f.estimatedMinutes} onChange={(v) => setF({ ...f, estimatedMinutes: v })} />
        </Field>
        <Field label="Checklist" className="sm:col-span-3">
          <Textarea rows={4} maxLength={4000} value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} placeholder={'- check oil level\n- grease bearings\n- inspect belt'} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ downtime & OEE
interface OeeRow {
  id: string;
  code: string;
  name: string;
  plannedHours: number;
  downtimeHours: number;
  workedHours: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  utilisation: number | null;
}
interface Downtime {
  id: string;
  startAt: string;
  endAt: string | null;
  minutes: number;
  reason: string;
  planned: boolean;
  notes: string | null;
  workCenter: string | null;
  equipment: string | null;
}
const REASONS: Record<string, string> = { BREAKDOWN: 'Breakdown', SETUP: 'Set-up / changeover', NO_MATERIAL: 'No material', NO_OPERATOR: 'No operator', QUALITY: 'Quality problem', POWER: 'Power cut', PLANNED: 'Planned stop (not counted)' };
const pct = (v: number | null) => (v === null ? '-' : `${fmtNumber(v)}%`);

export function OeePage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(isoDate());
  const [adding, setAdding] = useState(false);
  const oee = useQuery({ queryKey: ['mnt', 'oee', from, to], queryFn: () => api.get<OeeRow[]>('/maintenance/oee', { from, to }) });
  const dt = useQuery({ queryKey: ['mnt', 'downtime', from, to], queryFn: () => api.get<Downtime[]>('/maintenance/downtime', { from, to }) });
  const end = useMutation({ mutationFn: (id: string) => api.post(`/maintenance/downtime/${id}/end`), onSuccess: () => qc.invalidateQueries({ queryKey: ['mnt'] }), onError: (e) => toast.error(e) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Downtime & OEE"
        subtitle="OEE = Availability (normal capacity minus unplanned stops) × Performance (standard vs actual minutes) × Quality (good vs scrap)"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-40">
              <DatePicker value={from} onChange={(v) => setFrom(v ?? from)} clearable={false} />
            </div>
            <div className="w-40">
              <DatePicker value={to} onChange={(v) => setTo(v ?? to)} clearable={false} />
            </div>
            {can('maintenance.order.manage') && (
              <Button icon="plus" onClick={() => setAdding(true)}>
                Record stop
              </Button>
            )}
          </div>
        }
      />
      <Card bodyClass="p-0">
        {oee.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !oee.data?.length ? (
          <EmptyState icon="gauge" title="No work centres" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Work centre</th>
                  <th className="px-3 py-2 text-right font-semibold">Planned h</th>
                  <th className="px-3 py-2 text-right font-semibold">Stops h</th>
                  <th className="px-3 py-2 text-right font-semibold">Worked h</th>
                  <th className="px-3 py-2 text-right font-semibold">Availability</th>
                  <th className="px-3 py-2 text-right font-semibold">Performance</th>
                  <th className="px-3 py-2 text-right font-semibold">Quality</th>
                  <th className="px-3 py-2 text-right font-semibold">OEE</th>
                  <th className="px-4 py-2 text-right font-semibold">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {oee.data.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.plannedHours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.downtimeHours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(r.workedHours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.availability)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.performance)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.quality)}</td>
                    <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', r.oee === null ? '' : r.oee >= 85 ? 'text-emerald-700' : r.oee >= 60 ? 'text-amber-700' : 'text-red-600')}>{pct(r.oee)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{pct(r.utilisation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Stops" bodyClass="p-0">
        {!dt.data?.length ? (
          <EmptyState icon="timer" title="No stops in this period" />
        ) : (
          <ul className="divide-y divide-line">
            {dt.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.equipment ?? d.workCenter}</span> · {REASONS[d.reason] ?? d.reason}
                  <span className="block text-xs text-slate-500">
                    {fmtDateTime(d.startAt)}
                    {d.endAt ? ` – ${fmtDateTime(d.endAt)}` : ' · still stopped'}
                    {d.notes ? ` · ${d.notes}` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{fmtNumber(d.minutes)} min</span>
                {!d.endAt && can('maintenance.order.manage') && (
                  <Button size="sm" variant="outline" onClick={() => end.mutate(d.id)}>
                    End now
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-slate-500">
        A breakdown order that stops a machine records its stop automatically. <Link to="/maintenance/orders" className="text-brand-700 hover:underline">Maintenance orders</Link>
      </p>
      {adding && <AddStop onClose={() => setAdding(false)} onSaved={() => (setAdding(false), qc.invalidateQueries({ queryKey: ['mnt'] }))} />}
    </div>
  );
}

function AddStop({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ workCenterId: null as string | null, equipmentId: null as string | null, date: isoDate(), from: '08:00', to: '', reason: 'SETUP', notes: '' });
  const save = useMutation({
    mutationFn: () => api.post('/maintenance/downtime', { workCenterId: f.workCenterId, equipmentId: f.equipmentId, startAt: new Date(`${f.date}T${f.from}`).toISOString(), endAt: f.to ? new Date(`${f.date}T${f.to}`).toISOString() : null, reason: f.reason, notes: f.notes || null }),
    onSuccess: () => (toast.success('Stop recorded'), onSaved()),
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Record a stop"
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.workCenterId && !f.equipmentId} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Work centre">
          <AsyncSelect resource="work-centers" value={f.workCenterId} onChange={(v) => setF({ ...f, workCenterId: v })} />
        </Field>
        <Field label="Or equipment">
          <AsyncSelect resource="equipment" value={f.equipmentId} onChange={(v) => setF({ ...f, equipmentId: v })} />
        </Field>
        <Field label="Reason">
          <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={Object.entries(REASONS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Date">
          <DatePicker value={f.date} onChange={(v) => setF({ ...f, date: v ?? f.date })} clearable={false} />
        </Field>
        <Field label="From">
          <TimeInput value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </Field>
        <Field label="To" help="Empty = still stopped">
          <TimeInput value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
