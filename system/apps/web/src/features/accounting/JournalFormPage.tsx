import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, EmptyState, Field, Input, PageHeader, toast } from '@/components/ui';

interface JLine {
  key: number;
  accountId: string | null;
  description: string;
  debit: string;
  credit: string;
  costCenterId: string | null;
  projectId: string | null;
}
let seq = 0;
const blank = (): JLine => ({ key: ++seq, accountId: null, description: '', debit: '', credit: '', costCenterId: null, projectId: null });

export default function JournalFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [head, setHead] = useState({ date: isoDate(), description: '', reference: '' });
  const [lines, setLines] = useState<JLine[]>([blank(), blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dr = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const valid = head.description.trim() && dr > 0 && diff === 0 && lines.every((l) => l.accountId && (Number(l.debit) > 0) !== (Number(l.credit) > 0));

  const save = useMutation({
    mutationFn: (post: boolean) =>
      api.post<{ id: string; number: string }>('/journals', {
        ...head,
        post,
        lines: lines.map((l) => ({ accountId: l.accountId, description: l.description || null, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, costCenterId: l.costCenterId, projectId: l.projectId })),
      }),
    onSuccess: (j) => {
      toast.success(`Journal ${j.number} saved`);
      qc.invalidateQueries({ queryKey: ['journals'] });
      navigate(`/accounting/journals/${j.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (!can('accounting.journal.create') && !can('accounting.journal.post')) return <EmptyState icon="shield-alert" title="You do not have permission to create journals" />;
  const update = (key: number, patch: Partial<JLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div>
      <PageHeader
        title="New Journal Entry"
        back={() => navigate(-1)}
        actions={
          <>
            {can('accounting.journal.create') && (
              <Button variant="outline" icon="save" disabled={!valid} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
                Save draft
              </Button>
            )}
            {can('accounting.journal.post') && (
              <Button icon="check-circle-2" disabled={!valid} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
                Save & post
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4">
        <Card title="Header">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Date" required error={errors.date}>
              <Input type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
            </Field>
            <Field label="Description" required error={errors.description} className="sm:col-span-2">
              <Input value={head.description} maxLength={500} onChange={(e) => setHead({ ...head, description: e.target.value })} />
            </Field>
            <Field label="Reference">
              <Input value={head.reference} maxLength={100} onChange={(e) => setHead({ ...head, reference: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Lines">
          {errors.lines && <p className="mb-2 text-sm text-red-600">{errors.lines}</p>}
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-12 md:border-0 md:p-0 dark:border-slate-700">
                <div className="col-span-2 md:col-span-3">
                  {i === 0 && <label className="label hidden md:block">Account</label>}
                  <AsyncSelect resource="accounts" value={l.accountId} onChange={(v) => update(l.key, { accountId: v })} placeholder="Account..." />
                </div>
                <div className="col-span-2 md:col-span-3">
                  {i === 0 && <label className="label hidden md:block">Description</label>}
                  <Input value={l.description} maxLength={500} placeholder="Line description" onChange={(e) => update(l.key, { description: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  {i === 0 && <label className="label hidden md:block">Cost center</label>}
                  <AsyncSelect resource="cost-centers" value={l.costCenterId} onChange={(v) => update(l.key, { costCenterId: v })} placeholder="Cost center" />
                </div>
                <div className="md:col-span-1">
                  {i === 0 && <label className="label hidden md:block">Debit</label>}
                  <Input type="number" inputMode="decimal" step="0.01" min={0} placeholder="Debit" className="text-right" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                </div>
                <div className="md:col-span-2">
                  {i === 0 && <label className="label hidden md:block">Credit</label>}
                  <Input type="number" inputMode="decimal" step="0.01" min={0} placeholder="Credit" className="text-right" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                </div>
                <div className="col-span-2 flex items-end justify-end md:col-span-1">
                  <Button variant="ghost" size="icon" icon="trash-2" className="text-red-500" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" size="sm" icon="plus" onClick={() => setLines((ls) => [...ls, blank()])}>
              Add line
            </Button>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                Debit <b className="tabular-nums">{fmtMoney(dr)}</b>
              </span>
              <span>
                Credit <b className="tabular-nums">{fmtMoney(cr)}</b>
              </span>
              <span className={diff === 0 && dr > 0 ? 'text-emerald-600' : 'text-red-600'}>
                Difference <b className="tabular-nums">{fmtMoney(diff)}</b>
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
