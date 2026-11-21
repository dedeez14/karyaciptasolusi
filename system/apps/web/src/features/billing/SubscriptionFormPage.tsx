import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, DatePicker, EmptyState, Field, Input, LookupSelect, PageHeader, Spinner, Switch, Textarea, toast, NumberInput } from '@/components/ui';
import { computeTotals, LineEditor, newLine, useTaxRates, type EditLine } from '@/features/documents/LineEditor';
import { SUBSCRIPTION_LINE_DEF, useIntervalText, type SubscriptionDetail } from './common';

interface Form {
  code: string;
  name: string;
  customerId: string | null;
  projectId: string | null;
  intervalCode: string;
  intervalCount: string;
  startDate: string;
  endDate: string;
  nextRunDate: string;
  paymentTermId: string | null;
  currencyCode: string;
  autoConfirm: boolean;
  autoEmail: boolean;
  emailTo: string;
  notes: string;
  isActive: boolean;
}

const empty = (): Form => ({
  code: '',
  name: '',
  customerId: null,
  projectId: null,
  intervalCode: '',
  intervalCount: '1',
  startDate: isoDate(),
  endDate: '',
  nextRunDate: '',
  paymentTermId: null,
  currencyCode: '',
  autoConfirm: true,
  autoEmail: false,
  emailTo: '',
  notes: '',
  isActive: true,
});

export default function SubscriptionFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const interval = useIntervalText();
  const rates = useTaxRates();
  const [f, setF] = useState<Form>(empty);
  const [lines, setLines] = useState<EditLine[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const existing = useQuery({
    queryKey: ['billing', 'subscription', id],
    queryFn: () => api.get<SubscriptionDetail>(`/billing/subscriptions/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setF({
      code: s.code,
      name: s.name,
      customerId: s.customerId,
      projectId: s.projectId,
      intervalCode: s.intervalCode,
      intervalCount: String(s.intervalCount),
      startDate: s.startDate.slice(0, 10),
      endDate: s.endDate?.slice(0, 10) ?? '',
      nextRunDate: s.nextRunDate.slice(0, 10),
      paymentTermId: s.paymentTermId,
      currencyCode: s.currencyCode,
      autoConfirm: s.autoConfirm,
      autoEmail: s.autoEmail,
      emailTo: s.emailTo ?? '',
      notes: s.notes ?? '',
      isActive: s.isActive,
    });
    setLines(
      s.lines.length
        ? s.lines.map((l) => ({
            key: l.id,
            productId: l.productId,
            description: l.description ?? '',
            qty: String(Number(l.qty)),
            uomId: l.uomId,
            unitPrice: String(Number(l.unitPrice)),
            discountPct: String(Number(l.discountPct)),
            taxId: l.taxId,
            sourceLineId: null,
          }))
        : [newLine()],
    );
  }, [existing.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        intervalCount: Number(f.intervalCount) || 1,
        endDate: f.endDate || null,
        nextRunDate: isEdit ? f.nextRunDate || null : null,
        lines: lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          qty: Number(l.qty),
          uomId: l.uomId,
          unitPrice: Number(l.unitPrice) || 0,
          discountPct: Number(l.discountPct) || 0,
          taxId: l.taxId,
        })),
      };
      return isEdit ? api.patch<{ id: string; code: string }>(`/billing/subscriptions/${id}`, body) : api.post<{ id: string; code: string }>('/billing/subscriptions', body);
    },
    onSuccess: (s) => {
      toast.success(`Subscription ${s.code} saved`);
      qc.invalidateQueries({ queryKey: ['billing'] });
      navigate(`/billing/subscriptions/${s.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (isEdit && existing.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!can(isEdit ? 'sales.subscription.update' : 'sales.subscription.create')) return <EmptyState icon="shield-alert" title="You do not have permission for this action" />;
  if (isEdit && !existing.data) return <EmptyState icon="file-x" title="Subscription not found" description={(existing.error as Error)?.message} />;

  const totals = computeTotals(lines, rates, true);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={isEdit ? `Edit subscription ${existing.data?.code ?? ''}` : 'New subscription'}
        subtitle="Invoices are created from these lines on every billing date"
        back={() => navigate(-1)}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" icon="save" loading={save.isPending}>
              Save
            </Button>
          </>
        }
      />
      <div className="grid gap-4">
        <Card title="Contract">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" required error={errors.name} className="sm:col-span-2">
              <Input value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Website maintenance - Gold plan" invalid={!!errors.name} />
            </Field>
            <Field label="Code" error={errors.code} help={isEdit ? undefined : 'Empty = next number'}>
              <Input value={f.code} maxLength={30} onChange={(e) => set('code', e.target.value)} invalid={!!errors.code} />
            </Field>
            <Field label="Status">
              <div className="flex h-10 items-center">
                <Switch checked={f.isActive} onChange={(v) => set('isActive', v)} label={f.isActive ? 'Active' : 'Paused'} />
              </div>
            </Field>
            <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
              <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => set('customerId', v)} invalid={!!errors.customerId} manageHref="/r/customers" manageLabel="Manage customers" />
            </Field>
            <Field label="Project">
              <AsyncSelect resource="projects" value={f.projectId} onChange={(v) => set('projectId', v)} placeholder="None" />
            </Field>
            <Field label="Payment term" help="Sets the invoice due date">
              <AsyncSelect resource="payment-terms" value={f.paymentTermId} onChange={(v) => set('paymentTermId', v)} placeholder="Due on invoice date" />
            </Field>
          </div>
        </Card>

        <Card title="Schedule" subtitle={f.intervalCode ? `Invoiced ${interval(f.intervalCode, Number(f.intervalCount) || 1).toLowerCase()}` : undefined}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Billing interval" required error={errors.intervalCode}>
              <LookupSelect category="BILLING_INTERVAL" value={f.intervalCode} onChange={(v) => set('intervalCode', v)} invalid={!!errors.intervalCode} clearable={false} />
            </Field>
            <Field label="Repeat every" help="e.g. 2 with Monthly = every 2 months" error={errors.intervalCount}>
              <NumberInput decimals={0} min={1} max={36} value={f.intervalCount} onChange={(v) => set('intervalCount', v)} invalid={!!errors.intervalCount} />
            </Field>
            <Field label="Start date" required error={errors.startDate} help={isEdit ? undefined : 'The first invoice is created on this date'}>
              <DatePicker value={f.startDate} onChange={(v) => set('startDate', v)} clearable={false} invalid={!!errors.startDate} />
            </Field>
            <Field label="End date" error={errors.endDate} help="Empty = until cancelled">
              <DatePicker value={f.endDate} onChange={(v) => set('endDate', v)} min={f.startDate} invalid={!!errors.endDate} />
            </Field>
            {isEdit && (
              <Field label="Next invoice date" error={errors.nextRunDate} help="Change to skip or repeat a period">
                <DatePicker value={f.nextRunDate} onChange={(v) => set('nextRunDate', v)} min={f.startDate} clearable={false} invalid={!!errors.nextRunDate} />
              </Field>
            )}
            <Field label="Currency" help="Empty = company currency">
              <AsyncSelect resource="currencies" value={f.currencyCode || null} onChange={(v) => set('currencyCode', v ?? '')} />
            </Field>
          </div>
        </Card>

        <Card title="Lines" subtitle="Billed on every invoice">
          {errors.lines && <p className="mb-2 text-sm text-red-600">{errors.lines}</p>}
          <LineEditor def={SUBSCRIPTION_LINE_DEF} lines={lines} onChange={setLines} errors={errors} />
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Automation & notes" className="lg:col-span-2">
            <div className="grid gap-4">
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-slate-50/60 p-4">
                <Switch checked={f.autoConfirm} onChange={(v) => set('autoConfirm', v)} label="Confirm invoices automatically (post to the ledger)" />
                <Switch checked={f.autoEmail} onChange={(v) => set('autoEmail', v)} label="E-mail the invoice PDF to the customer" disabled={!f.autoConfirm} />
                {f.autoEmail && f.autoConfirm && (
                  <Field label="Send to" error={errors.emailTo} help="Empty = the customer's e-mail address">
                    <Input type="email" value={f.emailTo} maxLength={150} onChange={(e) => set('emailTo', e.target.value)} placeholder="billing@customer.com" invalid={!!errors.emailTo} />
                  </Field>
                )}
              </div>
              <Field label="Notes" help="Printed on every invoice together with the billing period">
                <Textarea value={f.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card title="Per invoice">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="tabular-nums">{fmtMoney(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd className="tabular-nums">-{fmtMoney(totals.discount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Tax</dt>
                <dd className="tabular-nums">{fmtMoney(totals.tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {f.currencyCode} {fmtMoney(totals.total)}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </form>
  );
}
