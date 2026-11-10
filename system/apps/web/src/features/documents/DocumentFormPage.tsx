import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate } from '@/lib/format';
import { AsyncSelect, Button, Card, DatePicker, EmptyState, Field, Input, PageHeader, Spinner, Textarea, toast } from '@/components/ui';
import { useDocType, type TradeDoc } from './useDocTypes';
import { computeTotals, fromDocLine, LineEditor, newLine, useTaxRates, type EditLine } from './LineEditor';

interface Header {
  date: string;
  dueDate: string;
  customerId: string | null;
  supplierId: string | null;
  warehouseId: string | null;
  toWarehouseId: string | null;
  paymentTermId: string | null;
  projectId: string | null;
  ownerId: string | null;
  currencyCode: string;
  exchangeRate: string;
  reference: string;
  notes: string;
  terms: string;
}

const emptyHeader = (): Header => ({
  date: isoDate(),
  dueDate: '',
  customerId: null,
  supplierId: null,
  warehouseId: null,
  toWarehouseId: null,
  paymentTermId: null,
  projectId: null,
  ownerId: null,
  currencyCode: '',
  exchangeRate: '1',
  reference: '',
  notes: '',
  terms: '',
});

export default function DocumentFormPage() {
  const { type = '', id } = useParams();
  const { def, isLoading } = useDocType(type);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [h, setH] = useState<Header>(emptyHeader);
  const [lines, setLines] = useState<EditLine[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rates = useTaxRates();

  const doc = useQuery({ queryKey: ['documents', type.toUpperCase(), 'one', id], queryFn: () => api.get<TradeDoc>(`/documents/${type}/${id}`), enabled: isEdit });

  useEffect(() => {
    const d = doc.data;
    if (!d) return;
    setH({
      date: d.date.slice(0, 10),
      dueDate: d.dueDate?.slice(0, 10) ?? '',
      customerId: d.customerId,
      supplierId: d.supplierId,
      warehouseId: d.warehouseId,
      toWarehouseId: d.toWarehouseId,
      paymentTermId: d.paymentTermId,
      projectId: d.projectId,
      ownerId: d.ownerId,
      currencyCode: d.currencyCode,
      exchangeRate: String(Number(d.exchangeRate)),
      reference: d.reference ?? '',
      notes: d.notes ?? '',
      terms: d.terms ?? '',
    });
    setLines(d.lines.length ? d.lines.map(fromDocLine) : [newLine()]);
  }, [doc.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        date: h.date,
        dueDate: h.dueDate || null,
        customerId: h.customerId,
        supplierId: h.supplierId,
        warehouseId: h.warehouseId,
        toWarehouseId: h.toWarehouseId,
        paymentTermId: h.paymentTermId,
        projectId: h.projectId,
        ownerId: h.ownerId,
        currencyCode: h.currencyCode || undefined,
        exchangeRate: Number(h.exchangeRate) || 1,
        reference: h.reference,
        notes: h.notes,
        terms: h.terms,
        lines: lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          qty: Number(l.qty),
          uomId: l.uomId,
          unitPrice: l.unitPrice === '' ? undefined : Number(l.unitPrice),
          discountPct: Number(l.discountPct) || 0,
          taxId: l.taxId,
          sourceLineId: l.sourceLineId,
        })),
      };
      return isEdit ? api.patch<TradeDoc>(`/documents/${type}/${id}`, body) : api.post<TradeDoc>(`/documents/${type}`, body);
    },
    onSuccess: (d) => {
      toast.success(`${def?.label} ${d.number} saved`);
      qc.invalidateQueries({ queryKey: ['documents', type.toUpperCase()] });
      navigate(`/documents/${type.toUpperCase()}/${d.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });

  if (isLoading || (isEdit && doc.isLoading))
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (!def) return <EmptyState icon="shield-alert" title="Not available" />;
  if (isEdit && doc.data && doc.data.status !== 'DRAFT') return <EmptyState icon="lock" title="Document is locked" description="Only draft documents can be edited." />;
  if (!(isEdit ? def.can.update : def.can.create)) return <EmptyState icon="shield-alert" title="You do not have permission for this action" />;

  const totals = computeTotals(lines, rates, def.priced);
  const set = <K extends keyof Header>(k: K, v: Header[K]) => setH((s) => ({ ...s, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={isEdit ? `Edit ${def.label} ${doc.data?.number ?? ''}` : `New ${def.label}`}
        back={() => navigate(-1)}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" icon="save" loading={save.isPending}>
              Save draft
            </Button>
          </>
        }
      />
      <div className="grid gap-4">
        <Card title="Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {def.partner && (
              <Field label={def.partyLabel ?? (def.partner === 'customer' ? 'Customer' : 'Supplier')} required error={errors.customerId ?? errors.supplierId} className="sm:col-span-2">
                <AsyncSelect
                  resource={def.partner === 'customer' ? 'customers' : 'suppliers'}
                  value={def.partner === 'customer' ? h.customerId : h.supplierId}
                  onChange={(v) => set(def.partner === 'customer' ? 'customerId' : 'supplierId', v)}
                  invalid={!!(errors.customerId ?? errors.supplierId)}
                />
              </Field>
            )}
            <Field label="Date" required error={errors.date}>
              <DatePicker clearable={false} value={h.date} onChange={(v) => set('date', v)} />
            </Field>
            {def.dueDate && (
              <Field label={def.code === 'SQ' ? 'Valid until' : 'Due date'} help="Empty = from payment term">
                <DatePicker value={h.dueDate} onChange={(v) => set('dueDate', v)} />
              </Field>
            )}
            {def.warehouse !== 'none' && (
              <Field label={def.warehouse === 'transfer' ? 'From warehouse' : 'Warehouse'} required={def.warehouse !== 'optional'} error={errors.warehouseId}>
                <AsyncSelect resource="warehouses" value={h.warehouseId} onChange={(v) => set('warehouseId', v)} />
              </Field>
            )}
            {def.warehouse === 'transfer' && (
              <Field label="To warehouse" required error={errors.toWarehouseId}>
                <AsyncSelect resource="warehouses" value={h.toWarehouseId} onChange={(v) => set('toWarehouseId', v)} />
              </Field>
            )}
            {def.partner && (
              <Field label="Payment term">
                <AsyncSelect resource="payment-terms" value={h.paymentTermId} onChange={(v) => set('paymentTermId', v)} />
              </Field>
            )}
            <Field label="Reference" help={def.module === 'sales' ? 'e.g. customer PO number' : undefined}>
              <Input value={h.reference} maxLength={100} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            {def.module !== 'inventory' && (
              <Field label="Project">
                <AsyncSelect resource="projects" value={h.projectId} onChange={(v) => set('projectId', v)} />
              </Field>
            )}
            {def.module !== 'inventory' && (
              <Field label={def.module === 'sales' ? 'Sales person' : 'Requested by'}>
                <AsyncSelect resource="users" value={h.ownerId} onChange={(v) => set('ownerId', v)} />
              </Field>
            )}
            {def.priced && (
              <>
                <Field label="Currency" help="Empty = company currency">
                  <AsyncSelect resource="currencies" value={h.currencyCode || null} onChange={(v) => set('currencyCode', v ?? '')} />
                </Field>
                {h.currencyCode && (
                  <Field label="Exchange rate">
                    <Input type="number" step="any" min={0} className="text-right" value={h.exchangeRate} onChange={(e) => set('exchangeRate', e.target.value)} />
                  </Field>
                )}
              </>
            )}
          </div>
        </Card>

        <Card title="Lines">
          {errors.lines && <p className="mb-2 text-sm text-red-600">{errors.lines}</p>}
          <LineEditor def={def} lines={lines} onChange={setLines} errors={errors} />
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Notes & terms" className="lg:col-span-2">
            <div className="grid gap-4">
              <Field label="Notes" help="Printed on the document">
                <Textarea value={h.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </Field>
              {def.module !== 'inventory' && (
                <Field label="Terms & conditions" help={isEdit ? undefined : 'Empty = default terms from settings'}>
                  <Textarea rows={4} value={h.terms} maxLength={4000} onChange={(e) => set('terms', e.target.value)} />
                </Field>
              )}
            </div>
          </Card>
          {def.priced && (
            <Card title="Summary">
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
                    {h.currencyCode} {fmtMoney(totals.total)}
                  </dd>
                </div>
                <p className="text-xs text-slate-400">Preview — final amounts are calculated by the server.</p>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </form>
  );
}
