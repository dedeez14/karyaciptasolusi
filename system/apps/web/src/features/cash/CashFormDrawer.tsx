import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { isoDate } from '@/lib/format';
import { AsyncSelect, Button, cn, DatePicker, Drawer, Field, Icon, Input, Textarea, toast, NumberInput } from '@/components/ui';
import { useLookups } from '@/features/resources/FieldInput';

export type CashType = 'RECEIPT' | 'PAYMENT' | 'TRANSFER';
export const CASH_ICON: Record<string, string> = { RECEIPT: 'arrow-down-left', PAYMENT: 'arrow-up-right', TRANSFER: 'arrow-left-right' };

const empty = (type: CashType) => ({ type, date: isoDate(), bankAccountId: '', toBankAccountId: '', accountId: '', amount: '', partyName: '', costCenterId: '', projectId: '', reference: '', description: '' });

/** Record money in / money out / transfer between cash & bank accounts */
export function CashFormDrawer({ open, onClose, initialType = 'PAYMENT', onSaved }: { open: boolean; onClose: () => void; initialType?: CashType; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const types = useLookups(['CASH_TYPE']).CASH_TYPE ?? [];
  const [form, setForm] = useState(empty(initialType));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setForm(empty(initialType));
      setErrors({});
    }
  }, [open, initialType]);
  const set = (k: keyof ReturnType<typeof empty>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const t = form.type as CashType;

  const save = useMutation({
    mutationFn: () => api.post<{ id: string; number: string; approvalRequested?: boolean }>('/cash', { ...form, amount: Number(form.amount), toBankAccountId: t === 'TRANSFER' ? form.toBankAccountId : null, accountId: t === 'TRANSFER' ? null : form.accountId }),
    onSuccess: (r) => {
      if (r.approvalRequested) toast.success(`${r.number} saved as draft and sent for approval. It is posted after approval.`);
      else toast.success(`${r.number} recorded and posted`);
      qc.invalidateQueries({ queryKey: ['cash'] });
      onSaved?.(r.id);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New cash / bank transaction"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="save" loading={save.isPending} onClick={() => save.mutate()}>
            Save & post
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-1">
          {types.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set('type', o.value)}
              className={cn('flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors', t === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              <Icon name={CASH_ICON[o.value] ?? 'circle'} className="h-4 w-4" />
              {o.label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required error={errors.date}>
            <DatePicker value={form.date} onChange={(v) => set('date', v)} clearable={false} invalid={!!errors.date} />
          </Field>
          <Field label="Amount" required error={errors.amount}>
            <NumberInput fixed={2} value={form.amount} onChange={(v) => set('amount', v)} className="text-base font-semibold" invalid={!!errors.amount} />
          </Field>
          <Field label={t === 'RECEIPT' ? 'Deposit to' : t === 'PAYMENT' ? 'Pay from' : 'From account'} required error={errors.bankAccountId}>
            <AsyncSelect resource="bank-accounts" value={form.bankAccountId} onChange={(v) => set('bankAccountId', v ?? '')} invalid={!!errors.bankAccountId} />
          </Field>
          {t === 'TRANSFER' ? (
            <Field label="To account" required error={errors.toBankAccountId}>
              <AsyncSelect resource="bank-accounts" value={form.toBankAccountId} onChange={(v) => set('toBankAccountId', v ?? '')} invalid={!!errors.toBankAccountId} />
            </Field>
          ) : (
            <Field label={t === 'RECEIPT' ? 'Income account' : 'Expense account'} required error={errors.accountId} help="Ledger account the amount is posted to">
              <AsyncSelect resource="accounts" value={form.accountId} onChange={(v) => set('accountId', v ?? '')} invalid={!!errors.accountId} />
            </Field>
          )}
          {t !== 'TRANSFER' && (
            <Field label={t === 'RECEIPT' ? 'Received from' : 'Paid to'}>
              <Input value={form.partyName} maxLength={150} onChange={(e) => set('partyName', e.target.value)} placeholder="Name (optional)" />
            </Field>
          )}
          <Field label="Reference">
            <Input value={form.reference} maxLength={100} onChange={(e) => set('reference', e.target.value)} placeholder="Receipt / transfer no." />
          </Field>
          {t !== 'TRANSFER' && (
            <>
              <Field label="Cost center">
                <AsyncSelect resource="cost-centers" value={form.costCenterId} onChange={(v) => set('costCenterId', v ?? '')} placeholder="None" />
              </Field>
              <Field label="Project">
                <AsyncSelect resource="projects" value={form.projectId} onChange={(v) => set('projectId', v ?? '')} placeholder="None" />
              </Field>
            </>
          )}
        </div>
        <Field label="Description" required error={errors.description}>
          <Textarea rows={3} value={form.description} maxLength={1000} onChange={(e) => set('description', e.target.value)} placeholder={t === 'PAYMENT' ? 'e.g. Office rent November' : t === 'RECEIPT' ? 'e.g. Bank interest' : 'e.g. Top up petty cash'} invalid={!!errors.description} />
        </Field>
        <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The journal entry is posted automatically. Payments above an approval threshold are saved as a draft and posted once approved. To correct a transaction, cancel it and record a new one.
        </p>
      </div>
    </Drawer>
  );
}
