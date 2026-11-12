import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, DatePicker, EmptyState, Field, Input, PageHeader, Spinner, Textarea, toast, NumberInput } from '@/components/ui';
import { dirMeta, type PaymentRow } from './common';

interface OpenInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  grandTotal: string;
  paidAmount: string;
  currencyCode: string;
  balance: string;
}

export default function PaymentFormPage() {
  const { direction = 'in' } = useParams();
  const m = dirMeta(direction);
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [form, setForm] = useState({ date: isoDate(), partnerId: sp.get('partnerId') ?? '', bankAccountId: '', paymentMethodId: '', amount: '', reference: '', notes: '' });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [amountTouched, setAmountTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preselect = sp.get('invoiceId');

  const invoices = useQuery({
    queryKey: ['payments', m.dir, 'open', form.partnerId],
    queryFn: () => api.get<OpenInvoice[]>(`/payments/${m.dir}/open-invoices/${form.partnerId}`),
    enabled: !!form.partnerId,
  });

  useEffect(() => {
    setAlloc({});
    setAmountTouched(false);
  }, [form.partnerId]);

  useEffect(() => {
    if (!preselect || !invoices.data) return;
    const inv = invoices.data.find((i) => i.id === preselect);
    if (inv) setAlloc({ [inv.id]: String(Number(inv.balance)) });
  }, [preselect, invoices.data]);

  const allocTotal = useMemo(() => Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0), [alloc]);
  const amount = amountTouched ? Number(form.amount) || 0 : allocTotal;
  const overAllocated = allocTotal - amount > 0.005;

  const save = useMutation({
    mutationFn: () =>
      api.post<PaymentRow>(`/payments/${m.dir}`, {
        date: form.date,
        partnerId: form.partnerId,
        bankAccountId: form.bankAccountId,
        paymentMethodId: form.paymentMethodId || null,
        amount,
        reference: form.reference,
        notes: form.notes,
        allocations: Object.entries(alloc)
          .filter(([, v]) => Number(v) > 0)
          .map(([documentId, v]) => ({ documentId, amount: Number(v) })),
      }),
    onSuccess: (p) => {
      toast.success(`${m.singular} ${p.number} recorded`);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      navigate(`/payments/${m.dir}/${p.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (!can(`${m.perm}.create`)) return <EmptyState icon="shield-alert" title="You do not have permission to record payments" />;

  const toggle = (inv: OpenInvoice, on: boolean) =>
    setAlloc((a) => {
      const n = { ...a };
      if (on) n[inv.id] = String(Number(inv.balance));
      else delete n[inv.id];
      return n;
    });
  const payAll = () => setAlloc(Object.fromEntries((invoices.data ?? []).map((i) => [i.id, String(Number(i.balance))])));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={`New ${m.singular}`}
        back={() => navigate(-1)}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" icon="save" loading={save.isPending} disabled={!form.partnerId || !form.bankAccountId || amount <= 0 || overAllocated}>
              Save payment
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Payment" className="lg:col-span-1">
          <div className="grid gap-4">
            <Field label={m.partner} required error={errors.partnerId}>
              <AsyncSelect resource={m.partnerResource} value={form.partnerId || null} onChange={(v) => setForm({ ...form, partnerId: v ?? '' })} />
            </Field>
            <Field label="Date" required error={errors.date}>
              <DatePicker clearable={false} value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            </Field>
            <Field label={m.dir === 'in' ? 'Deposit to (cash / bank)' : 'Pay from (cash / bank)'} required error={errors.bankAccountId}>
              <AsyncSelect resource="bank-accounts" value={form.bankAccountId || null} onChange={(v) => setForm({ ...form, bankAccountId: v ?? '' })} />
            </Field>
            <Field label="Payment method">
              <AsyncSelect resource="payment-methods" value={form.paymentMethodId || null} onChange={(v) => setForm({ ...form, paymentMethodId: v ?? '' })} />
            </Field>
            <Field label="Amount" required error={errors.amount ?? (overAllocated ? 'Allocations exceed the payment amount' : undefined)} help={amountTouched ? undefined : 'Defaults to the total allocated below'}>
              <NumberInput
                fixed={2}
                value={amountTouched ? form.amount : allocTotal ? String(allocTotal) : ''}
                onChange={(v) => {
                  setAmountTouched(true);
                  setForm({ ...form, amount: v });
                }}
                invalid={overAllocated}
              />
            </Field>
            <Field label="Reference" help="e.g. transfer reference">
              <Input value={form.reference} maxLength={100} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Textarea value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card
          title="Apply to invoices"
          className="lg:col-span-2"
          bodyClass="p-0"
          actions={
            invoices.data?.length ? (
              <Button size="sm" variant="outline" icon="check-check" onClick={payAll}>
                Pay all
              </Button>
            ) : undefined
          }
        >
          {!form.partnerId ? (
            <EmptyState icon="user-search" title={`Select a ${m.partner.toLowerCase()} first`} description="Their open invoices will appear here." />
          ) : invoices.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : !invoices.data?.length ? (
            <EmptyState icon="check-circle-2" title="No open invoices" description="The payment will be recorded as an advance (unapplied)." />
          ) : (
            <div className="divide-y divide-slate-100">
              {invoices.data.map((inv) => {
                const on = inv.id in alloc;
                const overdue = inv.dueDate && new Date(inv.dueDate) < new Date();
                return (
                  <div key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <label className="flex flex-1 cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 accent-brand-700" checked={on} onChange={(e) => toggle(inv, e.target.checked)} />
                      <span className="text-sm">
                        <span className="font-medium">{inv.number}</span>
                        <span className="block text-xs text-slate-500">
                          {fmtDate(inv.date)} · due {fmtDate(inv.dueDate)}
                          {overdue && <span className="ml-1 font-medium text-red-600">overdue</span>}
                        </span>
                        <span className="block text-xs text-slate-500">
                          Total {fmtMoney(inv.grandTotal)} · Balance <b>{fmtMoney(inv.balance)}</b>
                        </span>
                      </span>
                    </label>
                    <NumberInput
                      fixed={2}
                      className="sm:w-44"
                      disabled={!on}
                      value={alloc[inv.id] ?? ''}
                      invalid={on && Number(alloc[inv.id]) > Number(inv.balance) + 0.005}
                      onChange={(v) => setAlloc((a) => ({ ...a, [inv.id]: v }))}
                      aria-label={`Amount for ${inv.number}`}
                    />
                  </div>
                );
              })}
              <div className="flex justify-between bg-slate-50 px-4 py-3 text-sm font-semibold">
                <span>Allocated</span>
                <span className="tabular-nums">{fmtMoney(allocTotal)}</span>
              </div>
              {amount - allocTotal > 0.005 && (
                <div className="flex justify-between px-4 py-2 text-sm text-amber-700">
                  <span>Unapplied (advance)</span>
                  <span className="tabular-nums">{fmtMoney(amount - allocTotal)}</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </form>
  );
}
