import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, confirm, DatePicker, EmptyState, Icon, Input, NumberInput, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { Kpi, Loading, money, Progress } from '../shared';

interface Milestone {
  id?: string;
  name: string;
  percent: number | null;
  amount: number;
  dueDate: string | null;
  trigger: string | null;
  state?: 'PLANNED' | 'DUE' | 'DRAFT' | 'INVOICED' | 'PARTIAL' | 'PAID';
  invoice?: { id: string; number: string; status: string; total: number; paid: number; dueDate: string | null } | null;
  locked?: boolean;
}
interface Plan {
  contractValue: number;
  customer: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  issues: string[];
  canEdit: boolean;
  canInvoice: boolean;
  totals: { planned: number; invoiced: number; paid: number; outstanding: number; notInvoiced: number; unplanned: number };
  milestones: Milestone[];
}

const STATE: Record<NonNullable<Milestone['state']>, { label: string; tone: 'gray' | 'amber' | 'blue' | 'green' | 'red' | 'violet' }> = {
  PLANNED: { label: 'Planned', tone: 'gray' },
  DUE: { label: 'Due - not invoiced', tone: 'red' },
  DRAFT: { label: 'Invoice draft', tone: 'amber' },
  INVOICED: { label: 'Invoiced', tone: 'blue' },
  PARTIAL: { label: 'Partly paid', tone: 'violet' },
  PAID: { label: 'Paid', tone: 'green' },
};

/** common Indonesian project payment schemes */
const PRESETS: { label: string; parts: [string, number, string][] }[] = [
  {
    label: '30 / 40 / 30',
    parts: [
      ['Uang muka', 30, 'Setelah perjanjian ditandatangani'],
      ['Termin 2 - demo / versi uji', 40, 'Setelah demo disetujui'],
      ['Pelunasan', 30, 'Setelah BAST ditandatangani'],
    ],
  },
  {
    label: '50 / 50',
    parts: [
      ['Uang muka', 50, 'Setelah perjanjian ditandatangani'],
      ['Pelunasan', 50, 'Setelah BAST ditandatangani'],
    ],
  },
  { label: '100% at handover', parts: [['Pembayaran penuh', 100, 'Setelah BAST ditandatangani']] },
];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Project page > Milestones: the contract value split into billing milestones (termin), each invoiced in one click */
export function MilestonesTab({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['projects', id, 'milestones'], queryFn: () => api.get<Plan>(`/projects/${id}/milestones`) });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(0);
  const [rows, setRows] = useState<Milestone[]>([]);
  const [busy, setBusy] = useState('');
  const p = q.data;

  useEffect(() => {
    if (p && !editing) {
      setValue(p.contractValue);
      setRows(p.milestones);
    }
  }, [p, editing]);

  if (q.isLoading || !p) return <Loading />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['projects', id, 'milestones'] });
    qc.invalidateQueries({ queryKey: ['insights', 'project', id] });
  };
  const sum = r2(rows.reduce((a, m) => a + (Number(m.amount) || 0), 0));
  const update = (i: number, patch: Partial<Milestone>) =>
    setRows((list) =>
      list.map((m, j) => {
        if (j !== i) return m;
        const next = { ...m, ...patch };
        // a percentage recalculates the amount from the contract value
        if (patch.percent !== undefined && patch.percent !== null && value > 0) next.amount = r2((value * patch.percent) / 100);
        if (patch.amount !== undefined && value > 0) next.percent = r2((patch.amount / value) * 100);
        return next;
      }),
    );
  const applyPreset = async (preset: (typeof PRESETS)[number]) => {
    if (!(value > 0)) return toast.error('Fill in the contract value first');
    if (rows.some((r) => !r.locked) && !(await confirm({ title: `Use ${preset.label}?`, message: 'Milestones without an invoice are replaced.', confirmText: 'Replace' }))) return;
    const kept = rows.filter((r) => r.locked);
    const left = r2(value - kept.reduce((a, m) => a + m.amount, 0));
    const base = preset.parts.map(([name, pct, trigger]) => ({ name, percent: pct, amount: r2((value * pct) / 100), dueDate: null, trigger }));
    // rounding: the last milestone takes what is left so the plan equals the contract value
    const total = base.reduce((a, m) => a + m.amount, 0);
    if (base.length && !kept.length) base[base.length - 1].amount = r2(base[base.length - 1].amount + (value - total));
    setRows([...kept, ...(kept.length ? base.filter(() => left > 0) : base)]);
  };
  const save = async () => {
    if (rows.some((r) => !r.name.trim())) return toast.error('Every milestone needs a name');
    if (value > 0 && sum > value + 0.005) return toast.error('The milestones add up to more than the contract value');
    setBusy('save');
    try {
      await api.put(`/projects/${id}/milestones`, {
        contractValue: value,
        milestones: rows.map((m) => ({ id: m.id, name: m.name, percent: m.percent, amount: Number(m.amount) || 0, dueDate: m.dueDate || null, trigger: m.trigger || null })),
      });
      toast.success('Milestones saved');
      setEditing(false);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };
  const invoice = async (m: Milestone) => {
    if (!m.id) return;
    if (!(await confirm({ title: `Invoice "${m.name}"?`, message: `A draft sales invoice of ${money(m.amount)} is created for ${p.customer?.name ?? 'the customer'}. Check it, then confirm and send it.`, confirmText: 'Create invoice' }))) return;
    setBusy(m.id);
    try {
      const r = await api.post<{ invoiceId: string; number: string }>(`/projects/${id}/milestones/${m.id}/invoice`, {});
      toast.success(`Invoice ${r.number} created as draft`);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  };

  const t = p.totals;
  const paidPct = p.contractValue > 0 ? (t.paid / p.contractValue) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="file-badge" label="Contract value" value={p.contractValue > 0 ? money(p.contractValue) : '—'} hint={t.unplanned > 0.005 && p.contractValue > 0 ? `${money(t.unplanned)} not in a milestone yet` : undefined} />
        <Kpi icon="receipt" tone="violet" label="Invoiced" value={money(t.invoiced)} hint={p.contractValue > 0 ? `${money(t.notInvoiced)} still to invoice` : undefined} />
        <Kpi icon="badge-check" tone="green" label="Paid" value={money(t.paid)} hint={p.contractValue > 0 ? `${Math.round(paidPct)}% of the contract` : undefined} />
        <Kpi icon="hourglass" tone={t.outstanding > 0 ? 'amber' : 'green'} label="Waiting for payment" value={money(t.outstanding)} />
      </div>
      {p.contractValue > 0 && <Progress value={paidPct} tone="green" />}

      {!!p.issues.length && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Before invoicing: {p.issues.join('; ')}. Edit the project to fix this.
          </span>
        </div>
      )}

      <Card
        title="Billing milestones (termin)"
        subtitle="Split the contract value; each milestone becomes its own invoice"
        actions={
          p.canEdit &&
          (editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button icon="save" loading={busy === 'save'} onClick={save}>
                Save
              </Button>
            </div>
          ) : (
            <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>
              {p.milestones.length ? 'Edit plan' : 'Plan milestones'}
            </Button>
          ))
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block w-60">
                <span className="label">Contract value</span>
                <NumberInput value={value} onChange={(v) => setValue(Number(v) || 0)} fixed={2} decimals={2} min={0} />
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((pr) => (
                  <Button key={pr.label} variant="outline" size="sm" onClick={() => applyPreset(pr)}>
                    {pr.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {rows.map((m, i) => (
                <div key={m.id ?? `new-${i}`} className={cn('grid grid-cols-1 gap-2 rounded-xl border border-line p-3 md:grid-cols-[minmax(0,1.4fr)_5.5rem_9rem_9.5rem_minmax(0,1.2fr)_auto] md:items-center', m.locked && 'bg-slate-50')}>
                  <Input value={m.name} aria-label="Milestone" placeholder="e.g. Uang muka" maxLength={150} disabled={m.locked} onChange={(e) => update(i, { name: e.target.value })} />
                  <NumberInput value={m.percent ?? ''} aria-label="Percent" placeholder="%" decimals={2} min={0} max={100} disabled={m.locked} onChange={(v) => update(i, { percent: v === '' ? null : Number(v) })} />
                  <NumberInput value={m.amount} aria-label="Amount" fixed={2} decimals={2} min={0} disabled={m.locked} onChange={(v) => update(i, { amount: Number(v) || 0 })} />
                  <DatePicker value={m.dueDate ?? ''} onChange={(v) => update(i, { dueDate: v || null })} placeholder="Due date" />
                  <Input value={m.trigger ?? ''} aria-label="When" placeholder="When, e.g. after BAST" maxLength={200} onChange={(e) => update(i, { trigger: e.target.value })} />
                  {m.locked ? (
                    <span className="px-2 text-xs text-slate-500">Invoiced</span>
                  ) : (
                    <Button variant="ghost" size="icon" icon="x" aria-label={`Remove ${m.name || 'milestone'}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))} />
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" icon="plus" onClick={() => setRows((l) => [...l, { name: '', percent: null, amount: 0, dueDate: null, trigger: null }])}>
                Add milestone
              </Button>
            </div>
            <p className={cn('text-sm', value > 0 && Math.abs(sum - value) > 0.005 ? 'text-amber-700' : 'text-slate-500')}>
              Milestones total {money(sum)}
              {value > 0 && (Math.abs(sum - value) > 0.005 ? ` · ${sum > value ? 'over' : 'short of'} the contract value by ${money(Math.abs(value - sum))}` : ' · equals the contract value')}
            </p>
          </div>
        ) : p.milestones.length ? (
          <ul className="divide-y divide-line">
            {p.milestones.map((m, i) => {
              const st = STATE[m.state ?? 'PLANNED'];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      {m.name}
                      {m.percent !== null && <span className="ml-1.5 text-sm font-normal text-slate-500">{m.percent}%</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {[m.trigger, m.dueDate && `due ${fmtDate(m.dueDate)}`].filter(Boolean).join(' · ') || 'No due date'}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums text-slate-900">{money(m.amount)}</span>
                    {m.invoice && m.invoice.paid > 0 && m.invoice.paid < m.invoice.total && <span className="block text-xs text-slate-500">paid {money(m.invoice.paid)}</span>}
                  </span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {m.invoice ? (
                    <Link to={`/documents/SI/${m.invoice.id}`} className="link text-sm">
                      {m.invoice.number}
                    </Link>
                  ) : (
                    p.canInvoice && (
                      <Button size="sm" icon="receipt" loading={busy === m.id} onClick={() => invoice(m)}>
                        Invoice
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon="list-ordered" title="No milestones yet" description={p.canEdit ? 'Plan the payment terms of this project, e.g. 30% down payment, 40% after the demo, 30% after handover.' : undefined} />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <Icon name="file-signature" className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="flex-1">Agreement with the client (Perjanjian Kerja Sama) and handover (BAST) for this project are made in the Document Center.</span>
        <Link to="/document-center" className="link">
          Open Document Center
        </Link>
      </div>
    </div>
  );
}
