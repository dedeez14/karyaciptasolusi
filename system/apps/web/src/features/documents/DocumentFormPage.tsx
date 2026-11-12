import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSession } from '@/stores/session';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate } from '@/lib/format';
import { AsyncSelect, Button, Card, confirm, DatePicker, EmptyState, Field, Icon, Input, NumberInput, PageHeader, Spinner, Textarea, toast } from '@/components/ui';
import { useDocType, type TradeDoc } from './useDocTypes';
import { computeTotals, fromDocLine, LineEditor, LineTotals, newLine, useTaxRates, type EditLine } from './LineEditor';

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
  taxInvoiceNumber: string;
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
  taxInvoiceNumber: '',
  notes: '',
  terms: '',
});

export default function DocumentFormPage() {
  // non-PKP companies issue no Faktur Pajak (a purchase invoice can still record the supplier's)
  const vatPayer = useSession((st) => st.me?.prefs.vatPayer ?? true);
  const { type = '', id } = useParams();
  const { def, isLoading } = useDocType(type);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [h, setH] = useState<Header>(emptyHeader);
  const [lines, setLines] = useState<EditLine[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const confirmAfterSave = useRef(false);
  const rates = useTaxRates();
  const [sp] = useSearchParams();

  // shortcuts from other pages (customer / supplier 360, project) pre-fill the new document:
  // ?customerId= / ?supplierId= / ?partnerId= (either side) and ?projectId=
  useEffect(() => {
    if (isEdit || !def) return;
    const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    const partner = def.partner === 'customer' ? uuid(sp.get('customerId')) ?? uuid(sp.get('partnerId')) : def.partner === 'supplier' ? uuid(sp.get('supplierId')) ?? uuid(sp.get('partnerId')) : null;
    const projectId = uuid(sp.get('projectId'));
    if (!partner && !projectId) return;
    setH((x) => ({
      ...x,
      ...(partner ? (def.partner === 'customer' ? { customerId: partner } : { supplierId: partner }) : {}),
      ...(projectId ? { projectId } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, def?.code]);

  // warn before closing / reloading the tab with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const doc = useQuery({
    queryKey: ['documents', type.toUpperCase(), 'one', id],
    queryFn: () => api.get<TradeDoc>(`/documents/${type}/${id}`),
    enabled: isEdit,
  });

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
      taxInvoiceNumber: d.taxInvoiceNumber ?? '',
      notes: d.notes ?? '',
      terms: d.terms ?? '',
    });
    setLines(d.lines.length ? d.lines.map(fromDocLine) : [newLine()]);
    setDirty(false);
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
        taxInvoiceNumber: def?.code === 'SI' || def?.code === 'PI' ? h.taxInvoiceNumber : undefined,
        notes: h.notes,
        terms: h.terms,
        // completely blank lines (no product, no description) are ignored instead of blocking the save
        lines: (lines.some((l) => l.productId || l.description?.trim()) ? lines.filter((l) => l.productId || l.description?.trim()) : lines).map((l) => ({
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
    onSuccess: async (d) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['documents', type.toUpperCase()] });
      if (confirmAfterSave.current) {
        try {
          await api.post(`/documents/${type}/${d.id}/confirm`);
          toast.success(`${def?.label} ${d.number} saved and confirmed`);
        } catch (e) {
          // e.g. approval required: the draft is saved, the document page shows what to do next
          toast.error(e);
        }
        qc.invalidateQueries({ queryKey: ['documents'] });
      } else toast.success(`${def?.label} ${d.number} saved as draft`);
      navigate(`/documents/${type.toUpperCase()}/${d.id}`, { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) {
        setErrors(e.errors);
        requestAnimationFrame(() => document.querySelector('[aria-invalid="true"], .input-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
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
  const set = <K extends keyof Header>(k: K, v: Header[K]) => {
    setDirty(true);
    setH((s) => ({ ...s, [k]: v }));
  };
  const setLinesDirty: typeof setLines = (v) => {
    setDirty(true);
    setLines(v);
  };
  const submit = (e: FormEvent, andConfirm = false) => {
    e.preventDefault();
    if (save.isPending) return;
    confirmAfterSave.current = andConfirm;
    setErrors({});
    save.mutate();
  };
  const cancel = async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes on this document. Leave without saving?',
        confirmText: 'Discard',
        danger: true,
      }))
    )
      return;
    navigate(-1);
  };
  // Enter in a single-line field must not submit the whole document by accident
  const blockEnter = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && t.tagName === 'INPUT') e.preventDefault();
  };
  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={(e) => submit(e)} onKeyDown={blockEnter} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${def.label} ${doc.data?.number ?? ''}` : `New ${def.label}`}
        subtitle={isEdit ? 'Draft - changes are saved when you click Save' : 'Fill in the details and the lines, then save it as a draft or confirm it right away.'}
        back={cancel}
      />
      {errorCount > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <Icon name="circle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Please check the highlighted field{errorCount > 1 ? 's' : ''} below
            {errors.lines ? ` - ${errors.lines}` : ''}.
          </span>
        </div>
      )}
      <div className="grid gap-4 pb-4">
        <Card title="Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {def.partner && (
              <Field label={def.partyLabel ?? (def.partner === 'customer' ? 'Customer' : 'Supplier')} required error={errors.customerId ?? errors.supplierId} className="sm:col-span-2">
                <AsyncSelect
                  resource={def.partner === 'customer' ? 'customers' : 'suppliers'}
                  value={def.partner === 'customer' ? h.customerId : h.supplierId}
                  onChange={(v) => {
                    set(def.partner === 'customer' ? 'customerId' : 'supplierId', v);
                    // take over the partner's payment term (drives the due date) unless one was chosen already
                    if (v && !h.paymentTermId)
                      api
                        .get<{ paymentTermId?: string | null }>(`/resources/${def.partner === 'customer' ? 'customers' : 'suppliers'}/${v}`)
                        .then((p) => p.paymentTermId && setH((s) => (s.paymentTermId ? s : { ...s, paymentTermId: p.paymentTermId ?? null })))
                        .catch(() => undefined);
                  }}
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
            {((def.code === 'SI' && vatPayer) || def.code === 'PI') && (
              <Field label="Tax invoice no." help="Nomor Faktur Pajak - can also be added after confirming">
                <Input value={h.taxInvoiceNumber} maxLength={40} placeholder="010.000-26.00000001" onChange={(e) => set('taxInvoiceNumber', e.target.value)} />
              </Field>
            )}
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
                  <Field label="Exchange rate" help={`1 ${h.currencyCode} = ? company currency`}>
                    <NumberInput value={h.exchangeRate} onChange={(v) => set('exchangeRate', v)} decimals={6} />
                  </Field>
                )}
              </>
            )}
          </div>
        </Card>

        <Card
          title="Lines"
          subtitle={def.priced ? 'Prices exclude tax. Choose a product to fill in unit, price and tax automatically.' : 'Choose a product and enter the quantity.'}
          actions={
            <span className="text-xs text-slate-400">
              {lines.length} line{lines.length > 1 ? 's' : ''}
            </span>
          }
        >
          {errors.lines && <p className="mb-2 text-sm text-red-600">{errors.lines}</p>}
          <LineEditor def={def} lines={lines} onChange={setLinesDirty} errors={errors} />
          {def.priced && (
            <div className="mt-4 border-t border-line pt-4">
              <LineTotals lines={lines} rates={rates} priced currency={h.currencyCode} />
              <p className="mt-2 text-right text-[11px] text-slate-400">Preview - the final amounts are calculated when you save.</p>
            </div>
          )}
        </Card>

        <Card title="Notes & terms">
          <div className={def.module !== 'inventory' ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
            <Field label="Notes" help="Printed on the document">
              <Textarea value={h.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
            </Field>
            {def.module !== 'inventory' && (
              <Field label="Terms & conditions" help={isEdit ? undefined : 'Leave empty to use the default terms from Settings'}>
                <Textarea rows={4} value={h.terms} maxLength={4000} onChange={(e) => set('terms', e.target.value)} />
              </Field>
            )}
          </div>
        </Card>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {def.priced && (
            <div className="mr-auto text-sm">
              <span className="text-slate-500">Total </span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {h.currencyCode} {fmtMoney(totals.total)}
              </span>
            </div>
          )}
          {!def.priced && <span className="mr-auto text-xs text-slate-400">{dirty ? 'Unsaved changes' : ''}</span>}
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" variant={def.can.confirm ? 'outline' : 'primary'} icon="save" loading={save.isPending && !confirmAfterSave.current}>
            Save draft
          </Button>
          {def.can.confirm && (
            <Button icon="circle-check" loading={save.isPending && confirmAfterSave.current} onClick={(e) => submit(e, true)} title="Save and confirm in one step">
              Save &amp; confirm
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
