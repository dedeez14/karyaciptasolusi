import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '@/lib/api';
import { fmtCompact, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, cn, confirm, Dropdown, EmptyState, Field, Icon, Input, PageHeader, Select, Spinner, StatCard, Switch, Tabs, Textarea, toast, NumberInput } from '@/components/ui';
import { BudgetStatus, MONTHS, NewBudgetModal, type BudgetDetail, type GridRow } from './common';

let seq = 0;
const newRow = (): GridRow => ({
  key: `n${++seq}`,
  accountId: null,
  costCenterId: null,
  projectId: null,
  amounts: Array(12).fill(''),
});
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rowTotal = (r: GridRow) => r.amounts.reduce((t, v) => t + num(v), 0);

export default function BudgetPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<'plan' | 'actual'>('plan');
  const [copying, setCopying] = useState(false);
  const q = useQuery({
    queryKey: ['budgets', 'one', id],
    queryFn: () => api.get<BudgetDetail>(`/budgets/${id}`),
  });

  const [head, setHead] = useState({ name: '', year: '', notes: '' });
  const [rows, setRows] = useState<GridRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [dims, setDims] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const b = q.data;
    if (!b) return;
    setHead({ name: b.name, year: String(b.year), notes: b.notes ?? '' });
    setRows(
      b.rows.map((r) => ({
        key: `${r.accountId}|${r.costCenterId}|${r.projectId}`,
        accountId: r.accountId,
        costCenterId: r.costCenterId,
        projectId: r.projectId,
        amounts: r.amounts.map((a) => (a ? String(a) : '')),
        accountType: r.accountType,
        accountCode: r.accountCode,
        accountName: r.accountName,
      })),
    );
    setDims(b.rows.some((r) => r.costCenterId || r.projectId));
    setDirty(false);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/budgets/${id}`, {
        ...head,
        rows: rows
          .filter((r) => r.accountId)
          .map((r) => ({
            accountId: r.accountId,
            costCenterId: r.costCenterId,
            projectId: r.projectId,
            amounts: r.amounts.map(num),
          })),
      }),
    onSuccess: () => {
      toast.success('Budget saved');
      setErrors({});
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Budget not found" description={(q.error as Error)?.message} />;
  const b = q.data;
  const editable = b.statusCode === 'DRAFT' && can('accounting.budget.update');

  const transition = async (action: 'approve' | 'reopen' | 'close', title: string, message: string) => {
    if (dirty) return toast.error('Save your changes first');
    if (
      !(await confirm({
        title,
        message,
        confirmText: title.replace(/\?$/, ''),
      }))
    )
      return;
    try {
      await api.post(`/budgets/${id}/${action}`);
      toast.success(`${b.code} updated`);
      qc.invalidateQueries({ queryKey: ['budgets'] });
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `Delete ${b.code}?`,
        message: 'The draft budget and all its lines are removed.',
        confirmText: 'Delete',
        danger: true,
      }))
    )
      return;
    try {
      await api.delete(`/budgets/${id}`);
      toast.success(`${b.code} deleted`);
      qc.invalidateQueries({ queryKey: ['budgets'] });
      navigate('/budgets');
    } catch (e) {
      toast.error(e);
    }
  };

  const update = (key: string, patch: Partial<GridRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const pickAccount = async (key: string, accountId: string | null) => {
    update(key, {
      accountId,
      accountType: null,
      accountCode: undefined,
      accountName: undefined,
    });
    if (!accountId) return;
    try {
      const a = await api.get<{ code: string; name: string; type: string }>(`/resources/accounts/${accountId}`);
      update(key, {
        accountType: a.type,
        accountCode: a.code,
        accountName: a.name,
      });
    } catch {
      /* no account read permission: type is resolved after saving */
    }
  };
  const spread = (key: string, total: number) => {
    const each = Math.floor((total / 12) * 100) / 100;
    const last = Math.round((total - each * 11) * 100) / 100;
    update(key, {
      amounts: Array.from({ length: 12 }, (_, i) => String(i === 11 ? last : each)),
    });
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {b.code}
            <BudgetStatus code={b.statusCode} />
          </span>
        }
        subtitle={`${b.name} · ${b.year}${b.approvedAt ? ` · approved ${fmtDateTime(b.approvedAt)}${b.approvedByName ? ` by ${b.approvedByName}` : ''}` : ''}`}
        back={() => navigate('/budgets')}
        actions={
          <>
            {editable && (
              <Button icon="save" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
                Save
              </Button>
            )}
            {b.statusCode === 'DRAFT' && can('accounting.budget.approve') && (
              <Button variant="success" icon="badge-check" onClick={() => transition('approve', 'Approve budget?', 'Approved budgets are locked and used in the Budget vs Actual report.')}>
                Approve
              </Button>
            )}
            <Dropdown
              trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
              items={[
                {
                  label: 'Copy to a new budget',
                  icon: 'copy',
                  hidden: !can('accounting.budget.create'),
                  onClick: () => setCopying(true),
                },
                {
                  label: 'Re-open for editing',
                  icon: 'lock-open',
                  hidden: b.statusCode === 'DRAFT' || !can('accounting.budget.approve'),
                  onClick: () => transition('reopen', 'Re-open budget?', 'The budget goes back to draft and can be edited again. It must be approved again afterwards.'),
                },
                {
                  label: 'Close budget',
                  icon: 'archive',
                  hidden: b.statusCode !== 'APPROVED' || !can('accounting.budget.approve'),
                  onClick: () => transition('close', 'Close budget?', 'Closed budgets stay in the reports but are marked as finished.'),
                },
                'divider',
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  danger: true,
                  hidden: b.statusCode !== 'DRAFT' || !can('accounting.budget.delete'),
                  onClick: remove,
                },
              ]}
            />
          </>
        }
      />
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'plan', label: 'Budget' },
            { value: 'actual', label: 'Budget vs Actual' },
          ]}
        />
      </div>

      {tab === 'actual' ? (
        <VsActual id={id} />
      ) : (
        <div className="space-y-5">
          {editable && (
            <Card title="General">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
                <Field label="Name" required error={errors.name}>
                  <Input
                    value={head.name}
                    maxLength={200}
                    onChange={(e) => {
                      setHead((h) => ({ ...h, name: e.target.value }));
                      setDirty(true);
                    }}
                  />
                </Field>
                <Field label="Year" required error={errors.year}>
                  <NumberInput
                    decimals={0}
                    grouping={false}
                    min={2000}
                    max={2100}
                    value={head.year}
                    onChange={(v) => {
                      setHead((h) => ({ ...h, year: v }));
                      setDirty(true);
                    }}
                  />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    value={head.notes}
                    maxLength={4000}
                    onChange={(e) => {
                      setHead((h) => ({ ...h, notes: e.target.value }));
                      setDirty(true);
                    }}
                  />
                </Field>
              </div>
            </Card>
          )}
          <Card
            title="Monthly plan"
            subtitle={editable ? 'Type a yearly amount in Total to spread it evenly over the months' : 'Re-open the budget to change it'}
            bodyClass="p-0"
            actions={<Switch checked={dims} onChange={setDims} label="Cost center / project" />}
          >
            <Grid rows={rows} dims={dims} editable={editable} errors={errors} onAccount={pickAccount} onUpdate={update} onSpread={spread} onRemove={(key) => (setRows((rs) => rs.filter((r) => r.key !== key)), setDirty(true))} />
            {editable && (
              <div className="border-t border-line p-3">
                <Button variant="outline" size="sm" icon="plus" onClick={() => setRows((rs) => [...rs, newRow()])}>
                  Add account
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
      <NewBudgetModal open={copying} onClose={() => setCopying(false)} copyFrom={b} />
    </div>
  );
}

function Grid({
  rows,
  dims,
  editable,
  errors,
  onAccount,
  onUpdate,
  onSpread,
  onRemove,
}: {
  rows: GridRow[];
  dims: boolean;
  editable: boolean;
  errors: Record<string, string>;
  onAccount: (key: string, id: string | null) => void;
  onUpdate: (key: string, patch: Partial<GridRow>) => void;
  onSpread: (key: string, total: number) => void;
  onRemove: (key: string) => void;
}) {
  const sums = (type: string) => MONTHS.map((_, i) => rows.filter((r) => r.accountType === type).reduce((t, r) => t + num(r.amounts[i]), 0));
  const income = sums('INCOME');
  const expense = sums('EXPENSE');
  if (!rows.length) return <EmptyState icon="table" title="No lines" description={editable ? 'Add the income and expense accounts you want to plan.' : 'This budget has no lines.'} />;
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[1400px] text-sm">
        <thead>
          <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
            <th className="sticky left-0 z-10 min-w-64 bg-slate-50 px-3 py-2">Account</th>
            {dims && <th className="min-w-44 px-2 py-2">Cost center</th>}
            {dims && <th className="min-w-44 px-2 py-2">Project</th>}
            {MONTHS.map((m) => (
              <th key={m} className="min-w-24 px-1 py-2 text-right">
                {m}
              </th>
            ))}
            <th className="min-w-32 px-2 py-2 text-right">Total</th>
            {editable && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-b border-line align-top">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                {editable ? (
                  <>
                    <AsyncSelect
                      resource="accounts"
                      value={r.accountId}
                      onChange={(v) => onAccount(r.key, v)}
                      initialLabel={r.accountCode && r.accountName ? `${r.accountCode} - ${r.accountName}` : undefined}
                      invalid={!!errors[`rows.${i}.accountId`]}
                      placeholder="Select account..."
                    />
                    {errors[`rows.${i}.accountId`] && <p className="mt-0.5 text-xs text-red-600">{errors[`rows.${i}.accountId`]}</p>}
                  </>
                ) : (
                  <span className="block py-1.5">
                    <span className="font-medium">{r.accountCode}</span> <span className="text-slate-600">{r.accountName}</span>
                  </span>
                )}
                {r.accountType && (
                  <span className={cn('text-[11px] font-medium', r.accountType === 'INCOME' ? 'text-emerald-600' : r.accountType === 'EXPENSE' ? 'text-rose-600' : 'text-slate-400')}>
                    {r.accountType.charAt(0) + r.accountType.slice(1).toLowerCase()}
                  </span>
                )}
              </td>
              {dims && (
                <td className="px-2 py-1.5">
                  <AsyncSelect resource="cost-centers" value={r.costCenterId} onChange={(v) => onUpdate(r.key, { costCenterId: v })} placeholder="All" disabled={!editable} />
                </td>
              )}
              {dims && (
                <td className="px-2 py-1.5">
                  <AsyncSelect resource="projects" value={r.projectId} onChange={(v) => onUpdate(r.key, { projectId: v })} placeholder="All" disabled={!editable} />
                </td>
              )}
              {r.amounts.map((a, m) => (
                <td key={m} className="px-1 py-1.5">
                  {editable ? (
                    <NumberInput
                      decimals={2}
                      allowNegative
                      className="h-9 px-2"
                      value={a}
                      aria-label={`${MONTHS[m]} amount`}
                      onChange={(v) =>
                        onUpdate(r.key, {
                          amounts: r.amounts.map((x, j) => (j === m ? v : x)),
                        })
                      }
                    />
                  ) : (
                    <span className="block py-1.5 text-right tabular-nums">{num(a) ? fmtCompact(a) : '—'}</span>
                  )}
                </td>
              ))}
              <td className="px-2 py-1.5">{editable ? <TotalCell total={rowTotal(r)} onSpread={(t) => onSpread(r.key, t)} /> : <span className="block py-1.5 text-right font-semibold tabular-nums">{fmtMoney(rowTotal(r))}</span>}</td>
              {editable && (
                <td className="px-1 py-1.5">
                  <Button variant="ghost" size="icon" icon="trash-2" className="text-red-500" onClick={() => onRemove(r.key)} aria-label="Remove line" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="text-xs font-semibold">
          {[
            { label: 'Total income', v: income, cls: 'text-emerald-700' },
            { label: 'Total expenses', v: expense, cls: 'text-rose-700' },
            {
              label: 'Planned result',
              v: income.map((x, i) => x - expense[i]),
              cls: 'text-slate-900',
            },
          ].map((t) => (
            <tr key={t.label} className="border-t border-line bg-slate-50/70">
              <td className="sticky left-0 bg-slate-50 px-3 py-2" colSpan={1}>
                {t.label}
              </td>
              {dims && <td colSpan={2} />}
              {t.v.map((x, i) => (
                <td key={i} className={cn('px-1 py-2 text-right tabular-nums', t.cls)}>
                  {fmtCompact(x)}
                </td>
              ))}
              <td className={cn('px-2 py-2 text-right tabular-nums', t.cls)}>{fmtMoney(t.v.reduce((a, x) => a + x, 0))}</td>
              {editable && <td />}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

/** Shows the row total; typing a new yearly amount spreads it evenly over 12 months */
function TotalCell({ total, onSpread }: { total: number; onSpread: (t: number) => void }) {
  const [v, setV] = useState(String(Math.round(total * 100) / 100));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setV(String(Math.round(total * 100) / 100));
  }, [total, focused]);
  const commit = () => {
    setFocused(false);
    const n = Number(v);
    if (Number.isFinite(n) && Math.abs(n - total) > 0.004) onSpread(n);
  };
  return (
    <NumberInput
      decimals={2}
      allowNegative
      className="h-9 px-2 font-semibold"
      value={v}
      aria-label="Yearly total"
      title="Type a yearly amount to spread it evenly"
      onFocus={() => setFocused(true)}
      onChange={setV}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

// ------------------------------------------------------------------ budget vs actual
interface VsRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string | null;
  costCenterName: string | null;
  projectName: string | null;
  budgetToDate: number;
  actualToDate: number;
  variance: number;
  usedPct: number | null;
  favourable: boolean;
}
interface VsResponse {
  through: number;
  rows: VsRow[];
  summary: {
    income: { budget: number; actual: number };
    expense: { budget: number; actual: number };
    profit: { budget: number; actual: number };
  };
  monthly: {
    month: number;
    incomeBudget: number;
    incomeActual: number;
    expenseBudget: number;
    expenseActual: number;
  }[];
}

function VsActual({ id }: { id: string }) {
  const [through, setThrough] = useState(String(new Date().getMonth() + 1));
  const q = useQuery({
    queryKey: ['budgets', 'vs', id, through],
    queryFn: () => api.get<VsResponse>(`/budgets/${id}/vs-actual`, { through }),
  });
  const chart = useMemo(
    () =>
      (q.data?.monthly ?? []).map((m) => ({
        ...m,
        label: MONTHS[m.month - 1],
      })),
    [q.data],
  );
  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="circle-alert" title="Could not load the comparison" description={(q.error as Error)?.message} />;
  const s = q.data.summary;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}% of budget` : 'No budget');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Year to date through">
          <Select value={through} onChange={(e) => setThrough(e.target.value)} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} className="w-40" />
        </Field>
        <p className="pb-2 text-xs text-slate-500">Actual = posted journals. Rows with a cost center or project only count postings tagged with it.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Income" value={fmtMoney(s.income.actual)} icon="trending-up" tone="green" hint={`Budget ${fmtMoney(s.income.budget)} · ${pct(s.income.actual, s.income.budget)}`} />
        <StatCard label="Expenses" value={fmtMoney(s.expense.actual)} icon="trending-down" tone={s.expense.actual > s.expense.budget ? 'red' : 'amber'} hint={`Budget ${fmtMoney(s.expense.budget)} · ${pct(s.expense.actual, s.expense.budget)}`} />
        <StatCard label="Result" value={fmtMoney(s.profit.actual)} icon="scale" tone={s.profit.actual >= s.profit.budget ? 'green' : 'red'} hint={`Planned ${fmtMoney(s.profit.budget)}`} />
      </div>
      <Card title="Monthly comparison">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="incomeBudget" name="Income budget" fill="#a7f3d0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="incomeActual" name="Income actual" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenseBudget" name="Expense budget" fill="#fecdd3" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenseActual" name="Expense actual" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title={`Per account · January – ${MONTHS[q.data.through - 1]}`} bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-right">Budget</th>
                <th className="px-4 py-2 text-right">Actual</th>
                <th className="px-4 py-2 text-right">Variance</th>
                <th className="w-56 px-4 py-2">Used</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => {
                const used = r.usedPct ?? 0;
                return (
                  <tr key={`${r.accountId}|${r.costCenterName}|${r.projectName}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{r.accountCode}</span> {r.accountName}
                      {(r.costCenterName || r.projectName) && <span className="block text-xs text-slate-500">{[r.costCenterName, r.projectName].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.budgetToDate)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.actualToDate)}</td>
                    <td className={cn('px-4 py-2.5 text-right font-medium tabular-nums', r.favourable ? 'text-emerald-600' : 'text-red-600')}>
                      <span className="inline-flex items-center gap-1">
                        <Icon name={r.favourable ? 'circle-check' : 'circle-alert'} className="h-3.5 w-3.5" />
                        {fmtMoney(Math.abs(r.variance))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', r.favourable ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${Math.min(100, used)}%` }} />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-slate-500">{r.usedPct === null ? '—' : `${used}%`}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!q.data.rows.length && <p className="px-4 py-8 text-center text-sm text-slate-400">This budget has no lines.</p>}
        </div>
      </Card>
    </div>
  );
}
