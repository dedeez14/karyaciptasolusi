import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, DatePicker, EmptyState, Field, Icon, Input, LookupSelect, PageHeader, Spinner, Textarea, toast, NumberInput } from '@/components/ui';
import type { ExpenseDetail } from './common';

interface LineForm {
  key: string;
  date: string;
  categoryCode: string;
  accountId: string;
  accountName?: string | null;
  description: string;
  amount: string;
  projectId: string;
  projectName?: string | null;
  costCenterId: string;
  costCenterName?: string | null;
}

let seq = 0;
const newLine = (date = isoDate()): LineForm => ({ key: `n${++seq}`, date, categoryCode: '', accountId: '', description: '', amount: '', projectId: '', costCenterId: '' });

export default function ExpenseFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, me } = useSession();
  const manage = can('hris.expense.manage') || !!me?.user.isSuperAdmin;
  const existing = useQuery({ queryKey: ['expenses', 'one', id], queryFn: () => api.get<ExpenseDetail>(`/expenses/${id}`), enabled: !!id });
  const [head, setHead] = useState({ employeeId: '', date: isoDate(), title: '', notes: '' });
  const [lines, setLines] = useState<LineForm[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setHead({ employeeId: d.employeeId, date: d.date.slice(0, 10), title: d.title, notes: d.notes ?? '' });
    setLines(
      d.lines.map((l) => ({
        key: l.id ?? `n${++seq}`,
        date: l.date.slice(0, 10),
        categoryCode: l.categoryCode ?? '',
        accountId: l.accountId ?? '',
        accountName: l.accountName,
        description: l.description,
        amount: String(Number(l.amount)),
        projectId: l.projectId ?? '',
        projectName: l.projectName,
        costCenterId: l.costCenterId ?? '',
        costCenterName: l.costCenterName,
      })),
    );
  }, [existing.data]);

  if (id && existing.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (id && (!existing.data || !existing.data.can.edit)) return <EmptyState icon="file-lock" title="This claim cannot be edited" description={existing.data ? 'Only draft or rejected claims can be changed.' : (existing.error as Error)?.message} />;

  const setLine = (key: string, patch: Partial<LineForm>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const err = (i: number, f: string) => errors[`lines.${i}.${f}`];

  const save = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'save');
    setErrors({});
    const body = {
      employeeId: manage ? head.employeeId || null : undefined,
      date: head.date,
      title: head.title,
      notes: head.notes,
      lines: lines.map((l) => ({ date: l.date, categoryCode: l.categoryCode, accountId: l.accountId, description: l.description, amount: Number(l.amount), projectId: l.projectId, costCenterId: l.costCenterId })),
    };
    try {
      const saved = id ? await api.patch<{ id: string; number: string }>(`/expenses/${id}`, body) : await api.post<{ id: string; number: string }>('/expenses', body);
      if (submit) {
        const r = await api.post<{ approvalRequested: boolean }>(`/expenses/${saved.id}/submit`);
        toast.success(r.approvalRequested ? `${saved.number} submitted and sent to the approver` : `${saved.number} submitted for approval`);
      } else toast.success(`${saved.number} saved as draft`);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['approval'] });
      navigate(`/expenses/${saved.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title={id ? `Edit ${existing.data?.number}` : 'New expense claim'} subtitle="Add every expense with its receipt date; attach the receipts after saving" back={() => navigate(id ? `/expenses/${id}` : '/expenses')} />
      <Card title="Claim">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {manage && (
            <Field label="Employee" error={errors.employeeId} help="Leave empty to claim for yourself">
              <AsyncSelect resource="employees" value={head.employeeId} onChange={(v) => setHead({ ...head, employeeId: v ?? '' })} invalid={!!errors.employeeId} placeholder="Myself" />
            </Field>
          )}
          <Field label="Claim date" required error={errors.date}>
            <DatePicker value={head.date} onChange={(v) => setHead({ ...head, date: v })} clearable={false} invalid={!!errors.date} />
          </Field>
          <Field label="Title" required error={errors.title} className={manage ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <Input value={head.title} maxLength={200} onChange={(e) => setHead({ ...head, title: e.target.value })} placeholder="e.g. Client visit Bandung, 3-4 November" invalid={!!errors.title} />
          </Field>
        </div>
        {!manage && errors.employeeId && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.employeeId}</p>}
      </Card>

      <Card title="Expenses" subtitle="Expense account is optional; finance can leave it to the default expense account" bodyClass="p-0">
        <div className="divide-y divide-slate-100">
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
              <div className="flex items-center justify-between md:col-span-12">
                <span className="text-xs font-semibold text-slate-400 uppercase">Expense {i + 1}</span>
                {lines.length > 1 && <Button size="icon" variant="ghost" icon="trash-2" aria-label="Remove expense" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
              </div>
              <Field label="Date" required error={err(i, 'date')} className="md:col-span-2">
                <DatePicker value={l.date} onChange={(v) => setLine(l.key, { date: v })} clearable={false} invalid={!!err(i, 'date')} />
              </Field>
              <Field label="Category" error={err(i, 'categoryCode')} className="md:col-span-3">
                <LookupSelect category="EXPENSE_CATEGORY" value={l.categoryCode} onChange={(v) => setLine(l.key, { categoryCode: v })} invalid={!!err(i, 'categoryCode')} />
              </Field>
              <Field label="Description" required error={err(i, 'description')} className="md:col-span-5">
                <Input value={l.description} maxLength={500} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="What was it for?" invalid={!!err(i, 'description')} />
              </Field>
              <Field label="Amount" required error={err(i, 'amount')} className="md:col-span-2">
                <NumberInput fixed={2} className="font-semibold" value={l.amount} onChange={(v) => setLine(l.key, { amount: v })} invalid={!!err(i, 'amount')} />
              </Field>
              <Field label="Expense account" error={err(i, 'accountId')} className="md:col-span-4">
                <AsyncSelect resource="accounts" value={l.accountId} initialLabel={l.accountId === existing.data?.lines[i]?.accountId ? l.accountName ?? undefined : undefined} onChange={(v) => setLine(l.key, { accountId: v ?? '', accountName: null })} placeholder="Default expense account" invalid={!!err(i, 'accountId')} />
              </Field>
              <Field label="Project" error={err(i, 'projectId')} className="md:col-span-4">
                <AsyncSelect resource="projects" value={l.projectId} onChange={(v) => setLine(l.key, { projectId: v ?? '' })} placeholder="None" />
              </Field>
              <Field label="Cost center" error={err(i, 'costCenterId')} className="md:col-span-4">
                <AsyncSelect resource="cost-centers" value={l.costCenterId} onChange={(v) => setLine(l.key, { costCenterId: v ?? '' })} placeholder="None" />
              </Field>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-line p-4">
          <Button variant="secondary" icon="plus" onClick={() => setLines((ls) => [...ls, newLine(ls[ls.length - 1]?.date)])}>
            Add expense
          </Button>
          <div className="text-right">
            <p className="text-xs text-slate-500">Total claim</p>
            <p className="text-xl font-semibold tabular-nums">{fmtMoney(total)}</p>
          </div>
        </div>
        {errors.lines && <p className="px-4 pb-4 text-sm text-red-600">{errors.lines}</p>}
      </Card>

      <Card title="Notes">
        <Textarea rows={3} value={head.notes} maxLength={4000} onChange={(e) => setHead({ ...head, notes: e.target.value })} placeholder="Anything the approver should know (optional)" />
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 grid grid-cols-2 gap-2 border-t border-line bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex sm:justify-end sm:px-6 lg:-mx-8 lg:px-8">
        <Button variant="outline" className="hidden sm:inline-flex" onClick={() => navigate(id ? `/expenses/${id}` : '/expenses')}>
          Cancel
        </Button>
        <Button variant="outline" icon="save" loading={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button icon="send" loading={busy === 'submit'} disabled={!!busy} onClick={() => save(true)}>
          Save & submit
        </Button>
      </div>
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Icon name="paperclip" className="h-3.5 w-3.5" /> Receipts can be attached on the claim page after saving.
      </p>
    </div>
  );
}
