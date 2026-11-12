import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, DataTable, DatePicker, Drawer, EmptyState, Field, NumberInput, PageHeader, Select, toast, type Column } from '@/components/ui';
import type { StatementRow } from './common';

export default function BankRecListPage() {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['bankrec', 'list', bankAccountId, status], queryFn: () => api.get<StatementRow[]>('/bank-reconciliation', { bankAccountId: bankAccountId ?? undefined, status: status || undefined }) });

  const columns: Column<StatementRow>[] = [
    { key: 'number', header: 'Statement', render: (r) => <span className="font-medium text-brand-700">{r.number}</span> },
    { key: 'bank', header: 'Account', render: (r) => r.bankAccountName },
    { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
    { key: 'opening', header: 'Opening', align: 'right', hideOnMobile: true, render: (r) => <span className="tabular-nums">{fmtMoney(r.openingBalance)}</span> },
    { key: 'closing', header: 'Closing', align: 'right', render: (r) => <span className="tabular-nums">{fmtMoney(r.closingBalance)}</span> },
    {
      key: 'progress',
      header: 'Matched',
      render: (r) => (
        <div className="flex min-w-28 items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.lineCount ? (r.matchedCount / r.lineCount) * 100 : 0}%` }} />
          </div>
          <span className="text-xs text-slate-500 tabular-nums">
            {r.matchedCount}/{r.lineCount}
          </span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => (r.statusCode === 'RECONCILED' ? <Badge tone="green">Reconciled</Badge> : <Badge tone="amber">In progress</Badge>) },
  ];

  return (
    <div>
      <PageHeader
        title="Bank Reconciliation"
        subtitle="Match bank statements with the books, month by month"
        actions={
          can('accounting.bankrec.create') && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              New statement
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-[minmax(0,18rem)_12rem]">
          <AsyncSelect resource="bank-accounts" value={bankAccountId} onChange={setBankAccountId} placeholder="All cash & bank accounts" />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'OPEN', label: 'In progress' },
              { value: 'RECONCILED', label: 'Reconciled' },
            ]}
          />
        </div>
        <DataTable
          columns={columns}
          rows={q.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(`/accounting/bank-reconciliation/${r.id}`)}
          empty={
            <EmptyState
              icon="scale"
              title="No bank statements yet"
              description="Create a statement for a month, import the lines from your internet banking (CSV) and match them with the books."
              action={
                can('accounting.bankrec.create') && (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    New statement
                  </Button>
                )
              }
            />
          }
        />
      </Card>
      {creating && <NewStatementDrawer onClose={() => setCreating(false)} onCreated={(id) => navigate(`/accounting/bank-reconciliation/${id}`)} />}
    </div>
  );
}

function NewStatementDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const today = isoDate();
  const [form, setForm] = useState({ bankAccountId: null as string | null, periodStart: today.slice(0, 8) + '01', periodEnd: today, openingBalance: '0', closingBalance: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string | null) => setForm((f) => ({ ...f, [k]: v }));

  const pickBank = async (id: string | null) => {
    set('bankAccountId', id);
    setHint(null);
    if (!id) return;
    try {
      const s = await api.get<{ periodStart: string | null; openingBalance: string | number; previous: string | null }>('/bank-reconciliation/suggest', { bankAccountId: id });
      if (s.previous) {
        setForm((f) => ({ ...f, bankAccountId: id, periodStart: s.periodStart ?? f.periodStart, openingBalance: String(Number(s.openingBalance)) }));
        setHint(`Continues after ${s.previous}: start date and opening balance taken from its closing.`);
      }
    } catch {
      /* suggestion only */
    }
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.post<{ id: string; number: string }>('/bank-reconciliation', { ...form, openingBalance: Number(form.openingBalance || 0), closingBalance: Number(form.closingBalance || 0) });
      toast.success(`${r.number} created - now add its lines`);
      onCreated(r.id);
    } catch (e) {
      const err = e as { errors?: Record<string, string> };
      if (err.errors) setErrors(err.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="New bank statement"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!form.bankAccountId || form.closingBalance === ''}>
            Create statement
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Cash / bank account" required error={errors.bankAccountId}>
          <AsyncSelect resource="bank-accounts" value={form.bankAccountId} onChange={pickBank} invalid={!!errors.bankAccountId} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required error={errors.periodStart}>
            <DatePicker value={form.periodStart} onChange={(v) => set('periodStart', v)} clearable={false} />
          </Field>
          <Field label="To" required error={errors.periodEnd}>
            <DatePicker value={form.periodEnd} onChange={(v) => set('periodEnd', v)} clearable={false} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening balance" help="As printed on the statement">
            <NumberInput value={form.openingBalance} onChange={(v) => set('openingBalance', v)} fixed={2} allowNegative />
          </Field>
          <Field label="Closing balance" required help="As printed on the statement">
            <NumberInput value={form.closingBalance} onChange={(v) => set('closingBalance', v)} fixed={2} allowNegative />
          </Field>
        </div>
        {hint && <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800">{hint}</p>}
        <Field label="Notes">
          <textarea className="input min-h-20" value={form.notes} maxLength={2000} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
