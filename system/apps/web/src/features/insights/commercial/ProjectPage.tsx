import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtNumber, isoDate } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, Checkbox, cn, confirm, DatePicker, Field, Icon, StatusBadge, toast } from '@/components/ui';
import type { Row } from '@/features/resources/types';
import { MilestonesTab } from './MilestonesTab';
import { DetailShell, DOC_LABEL, InfoGrid, Kpi, Loading, LookupBadge, MiniTable, money, Muted, Progress, TabBar, useHashTab } from '../shared';

export interface ProjectStats {
  tasks: number | null;
  done: number | null;
  hours: number | null;
  invoiced: number | null;
  costs: number | null;
}
interface Overview {
  stats: ProjectStats;
  tasks:
    | {
        id: string;
        code: string;
        title: string;
        priorityCode: string | null;
        dueDate: string | null;
        completedAt: string | null;
        spentHours: number;
        assignee: string | null;
        stage: { name: string; color: string | null; isDone: boolean } | null;
      }[]
    | null;
  documents: { id: string; docType: string; number: string; date: string; status: string; grandTotal: number; currencyCode: string }[] | null;
  tickets: { id: string; code: string; subject: string; statusCode: string; priorityCode: string; createdAt: string }[] | null;
  time: { user: string; hours: number }[] | null;
  billing?: { hourlyRate: number; unbilledHours: number; unbilledAmount: number } | null;
}
interface Billing {
  project: { id: string; code: string; name: string; hourlyRate: number; customer: { id: string; code: string; name: string } | null; product: { id: string; code: string; name: string } | null };
  issues: string[];
  canBill: boolean;
  unbilled: { key: string; taskId: string; taskCode: string; taskTitle: string; userId: string; userName: string; hours: number; amount: number; from: string; to: string; entries: number }[];
  totalHours: number;
  totalAmount: number;
  invoices: { id: string; number: string; date: string; status: string; grandTotal: number; hours: number }[];
}

const TABS = ['overview', 'milestones', 'tasks', 'billing', 'documents', 'tickets'] as const;
type Tab = (typeof TABS)[number];

/** Project 360°: progress, budget vs actuals, tasks, documents, time and tickets */
export default function ProjectPage() {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const status = useLookupOptions('PROJECT_STATUS');
  return (
    <DetailShell
      resource="projects"
      id={id}
      backTo="/r/projects"
      avatar={() => (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
          <Icon name="folder-kanban" className="h-7 w-7" />
        </span>
      )}
      title={(r) => r.name}
      badges={(r) => (
        <>
          <span className="font-mono text-xs text-slate-400">{r.code}</span>
          <LookupBadge options={status} value={r.statusCode} />
          {r._labels?.customerId && <Badge tone="blue">{r._labels.customerId}</Badge>}
        </>
      )}
      actions={() =>
        can('task.task.read') ? (
          <Link to="/tasks/board">
            <Button variant="outline" icon="square-kanban">
              Task board
            </Button>
          </Link>
        ) : null
      }
    >
      {(r) => <Body id={id} r={r} />}
    </DetailShell>
  );
}

function Body({ id, r }: { id: string; r: Row }) {
  const navigate = useNavigate();
  const can = useSession((st) => st.can);
  const [tab, setTab] = useHashTab<Tab>(TABS, 'overview');
  const q = useQuery({ queryKey: ['insights', 'project', id], queryFn: () => api.get<Overview>(`/insights/projects/${id}`) });
  const pri = useLookupOptions('TASK_PRIORITY');
  const tst = useLookupOptions('TICKET_STATUS');
  const o = q.data;
  const s = o?.stats;
  const pct = s?.tasks ? Math.round(((s.done ?? 0) / s.tasks) * 100) : 0;
  const budget = Number(r.budget ?? 0);
  const used = budget > 0 && s?.costs !== null && s?.costs !== undefined ? (s.costs / budget) * 100 : null;
  const now = new Date().toISOString();
  const end = r.endDate ? String(r.endDate) : null;
  const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86400_000) : null;

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="list-checks" label="Progress" value={s?.tasks !== null && s ? `${pct}%` : '—'} hint={s?.tasks !== null && s ? `${s.done} of ${s.tasks} tasks done` : undefined} />
        <Kpi
          icon="clock"
          tone="violet"
          label="Time logged"
          value={s?.hours !== null && s ? `${fmtNumber(s.hours)} h` : '—'}
          hint={o?.billing && o.billing.unbilledHours > 0 ? `${fmtNumber(o.billing.unbilledHours)} h not invoiced yet` : undefined}
        />
        <Kpi
          icon="receipt"
          tone="green"
          label="Invoiced"
          value={s?.invoiced !== null && s ? money(s.invoiced) : '—'}
          hint={s && s.invoiced !== null && s.costs !== null ? `Margin ${money(s.invoiced - s.costs)}` : undefined}
        />
        <Kpi
          icon="calendar-clock"
          tone={daysLeft !== null && daysLeft < 0 ? 'red' : 'amber'}
          label="Deadline"
          value={end ? fmtDate(end) : '—'}
          hint={daysLeft === null ? 'No end date' : daysLeft < 0 ? `${-daysLeft} days late` : `${daysLeft} days left`}
        />
      </div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'milestones', label: 'Milestones', hidden: !can('master.project.read') },
          { value: 'tasks', label: 'Tasks', count: o?.tasks?.filter((t) => !t.completedAt).length ?? null, hidden: o && !o.tasks },
          { value: 'billing', label: 'Billing', count: o?.billing ? o.billing.unbilledHours || null : null, hidden: o && !o.billing },
          { value: 'documents', label: 'Documents', count: o?.documents?.length ?? null, hidden: o && !o.documents },
          { value: 'tickets', label: 'Tickets', count: o?.tickets?.length ?? null, hidden: o && !o.tickets },
        ]}
      />
      {q.isLoading ? (
        <Loading />
      ) : tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Project" className="lg:col-span-2">
            <InfoGrid
              items={[
                {
                  label: 'Customer',
                  value: r.customerId ? (
                    <Link className="text-brand-700 hover:underline" to={`/customers/${r.customerId}`}>
                      {r._labels?.customerId ?? 'Open'}
                    </Link>
                  ) : null,
                },
                { label: 'Branch', value: r._labels?.branchId ?? null },
                { label: 'Start', value: r.startDate ? fmtDate(r.startDate) : null },
                { label: 'End', value: r.endDate ? fmtDate(r.endDate) : null },
                { label: 'Description', value: r.description ?? null, wide: true },
              ]}
            />
            {s?.tasks !== null && s && (
              <div className="mt-5">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>Task completion</span>
                  <span>{pct}%</span>
                </div>
                <Progress value={pct} tone={pct === 100 ? 'green' : 'blue'} />
              </div>
            )}
          </Card>
          <div className="space-y-4">
            <Card title="Budget">
              <InfoGrid
                cols={1}
                items={[
                  { label: 'Budget', value: budget ? money(budget) : null },
                  { label: 'Costs (supplier bills)', value: s?.costs !== null && s ? money(s.costs) : undefined },
                  { label: 'Invoiced to customer', value: s?.invoiced !== null && s ? money(s.invoiced) : undefined },
                ]}
              />
              {used !== null && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>Budget used</span>
                    <span className={cn(used > 100 && 'font-semibold text-red-600')}>{Math.round(used)}%</span>
                  </div>
                  <Progress value={used} tone={used > 100 ? 'red' : used > 80 ? 'amber' : 'green'} />
                </div>
              )}
            </Card>
            {o?.time && (
              <Card title="Time by person">
                {!o.time.length && <Muted>No time logged</Muted>}
                <ul className="space-y-2">
                  {o.time.map((t) => (
                    <li key={t.user} className="flex justify-between text-sm">
                      <span className="text-slate-700">{t.user}</span>
                      <span className="font-medium tabular-nums">{fmtNumber(t.hours)} h</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      ) : tab === 'tasks' && o?.tasks ? (
        <Card bodyClass="px-5 py-2">
          <MiniTable
            rows={o.tasks}
            empty="No tasks in this project"
            cols={[
              { header: '', render: (t) => <Icon name={t.completedAt ? 'check-circle-2' : 'circle'} className={cn('h-4 w-4', t.completedAt ? 'text-emerald-500' : 'text-slate-300')} /> },
              {
                header: 'Task',
                render: (t) => (
                  <span className={cn('font-medium text-slate-800', t.completedAt && 'text-slate-400 line-through')}>
                    {t.title}
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400 no-underline">{t.code}</span>
                  </span>
                ),
              },
              { header: 'Stage', render: (t) => (t.stage ? <Badge color={t.stage.color}>{t.stage.name}</Badge> : null) },
              { header: 'Priority', render: (t) => <LookupBadge options={pri} value={t.priorityCode} /> },
              { header: 'Assignee', render: (t) => t.assignee ?? '—' },
              { header: 'Due', render: (t) => (t.dueDate ? <span className={cn(!t.completedAt && t.dueDate < now && 'font-medium text-red-600')}>{fmtDate(t.dueDate)}</span> : '—') },
              { header: 'Hours', align: 'right', render: (t) => (t.spentHours ? fmtNumber(t.spentHours) : '') },
            ]}
          />
        </Card>
      ) : tab === 'milestones' ? (
        <MilestonesTab id={id} projectName={r.name} />
      ) : tab === 'billing' && o?.billing ? (
        <BillingTab id={id} />
      ) : tab === 'documents' && o?.documents ? (
        <Card bodyClass="px-5 py-2">
          <MiniTable
            rows={o.documents}
            empty="No documents linked to this project"
            onRow={(d) => navigate(`/documents/${d.docType}/${d.id}`)}
            cols={[
              { header: 'Number', render: (d) => <span className="font-medium text-brand-700">{d.number}</span> },
              { header: 'Type', render: (d) => DOC_LABEL[d.docType] ?? d.docType },
              { header: 'Date', render: (d) => fmtDate(d.date) },
              { header: 'Total', align: 'right', render: (d) => `${d.currencyCode} ${money(d.grandTotal)}` },
              { header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
            ]}
          />
        </Card>
      ) : tab === 'tickets' && o?.tickets ? (
        <Card bodyClass="px-5 py-2">
          <MiniTable
            rows={o.tickets}
            empty="No tickets"
            onRow={(t) => navigate(`/helpdesk/tickets/${t.id}`)}
            cols={[
              { header: 'Code', render: (t) => <span className="font-mono text-xs text-brand-700">{t.code}</span> },
              { header: 'Subject', render: (t) => t.subject },
              { header: 'Status', render: (t) => <LookupBadge options={tst} value={t.statusCode} /> },
              { header: 'Opened', render: (t) => fmtDate(t.createdAt) },
            ]}
          />
        </Card>
      ) : (
        <Muted>Nothing to show.</Muted>
      )}
    </div>
  );
}

/** Billable hours not invoiced yet, and turning them into a draft sales invoice */
function BillingTab({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['insights', 'project-billing', id], queryFn: () => api.get<Billing>(`/time-billing/projects/${id}`) });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [date, setDate] = useState(isoDate());
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  const b = q.data;
  if (!b) return <Muted>Billing is not available.</Muted>;
  const chosen = picked ?? new Set(b.unbilled.map((g) => g.key));
  const sel = b.unbilled.filter((g) => chosen.has(g.key));
  const hours = Math.round(sel.reduce((a, g) => a + g.hours, 0) * 100) / 100;
  const amount = Math.round(sel.reduce((a, g) => a + g.amount, 0) * 100) / 100;
  const toggle = (k: string) => {
    const n = new Set(chosen);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setPicked(n);
  };
  const range = (a: string, z: string) => (a === z ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(z)}`);

  const create = async () => {
    if (!(await confirm({ title: 'Create the invoice?', message: `A draft sales invoice for ${fmtNumber(hours)} h (${money(amount)} before tax) is created for ${b.project.customer?.name}. You can review it before confirming.`, confirmText: 'Create draft invoice' }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ invoiceId: string; number: string }>(`/time-billing/projects/${id}/invoice`, { date, keys: sel.length === b.unbilled.length ? null : sel.map((g) => g.key) });
      toast.success(`Draft invoice ${r.number} created`);
      qc.invalidateQueries({ queryKey: ['insights'] });
      navigate(`/documents/SI/${r.invoiceId}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title="Hours to invoice" subtitle={`Billable hours not on an invoice yet · rate ${money(b.project.hourlyRate)} / h`} className="lg:col-span-2" bodyClass="p-0">
        {b.issues.length > 0 && (
          <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">Before invoicing time on this project:</p>
            <ul className="mt-1 list-disc pl-5">
              {b.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Edit the project (Time billing section) to fix this.</p>
          </div>
        )}
        {!b.unbilled.length ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            <Icon name="check-circle-2" className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
            All billable hours are invoiced. New hours appear here as soon as they are logged in the timesheet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/80 text-left text-xs text-slate-500">
                  <th className="w-10 px-3 py-2">
                    <Checkbox checked={sel.length === b.unbilled.length} onChange={(v) => setPicked(v ? null : new Set())} />
                  </th>
                  <th className="px-3 py-2 font-medium">Task</th>
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {b.unbilled.map((g) => (
                  <tr key={g.key} className={cn('border-b border-line last:border-0', !chosen.has(g.key) && 'text-slate-400')}>
                    <td className="px-3 py-2">
                      <Checkbox checked={chosen.has(g.key)} onChange={() => toggle(g.key)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{g.taskTitle}</div>
                      <div className="font-mono text-[10px] text-slate-400">{g.taskCode}</div>
                    </td>
                    <td className="px-3 py-2">{g.userName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{range(g.from, g.to)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(g.hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(g.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50/80 font-semibold">
                  <td />
                  <td className="px-3 py-2" colSpan={3}>
                    Selected
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(hours)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="Create invoice">
          <div className="space-y-3">
            <InfoGrid
              cols={1}
              items={[
                { label: 'Customer', value: b.project.customer ? `${b.project.customer.code} - ${b.project.customer.name}` : null },
                { label: 'Billing product', value: b.project.product ? `${b.project.product.code} - ${b.project.product.name}` : null },
                { label: 'Amount (before tax)', value: money(amount) },
              ]}
            />
            <Field label="Invoice date">
              <DatePicker clearable={false} value={date} onChange={setDate} />
            </Field>
            <Button className="w-full" icon="file-plus-2" loading={busy} disabled={!b.canBill || !!b.issues.length || !sel.length} onClick={create}>
              Create draft invoice
            </Button>
            {!b.canBill && <p className="text-xs text-slate-500">You need permission to invoice project hours.</p>}
          </div>
        </Card>
        <Card title="Time invoices">
          {!b.invoices.length && <Muted>No hours invoiced yet</Muted>}
          <ul className="space-y-2">
            {b.invoices.map((i) => (
              <li key={i.id}>
                <Link to={`/documents/SI/${i.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm hover:bg-slate-50">
                  <span>
                    <span className="font-medium text-brand-700">{i.number}</span>
                    <span className="block text-xs text-slate-500">
                      {fmtDate(i.date)} · {fmtNumber(i.hours)} h
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block tabular-nums">{money(i.grandTotal)}</span>
                    <StatusBadge status={i.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
