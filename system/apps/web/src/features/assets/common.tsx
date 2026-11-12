import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney, isoDate, getLocale } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { AsyncSelect, Badge, Button, DatePicker, Drawer, Field, Icon, Input, LookupSelect, Modal, Spinner, Textarea, toast, NumberInput, MonthInput } from '@/components/ui';

export interface AssetRow {
  id: string;
  code: string;
  name: string;
  categoryCode: string | null;
  taxGroupCode?: string | null;
  serialNumber: string | null;
  location: string | null;
  custodianEmployeeId: string | null;
  custodianName: string | null;
  supplierId: string | null;
  acquisitionDate: string;
  depreciationStartDate: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  methodCode: string;
  assetAccountId: string | null;
  accumDepAccountId: string | null;
  depExpenseAccountId: string | null;
  accumulatedDepreciation: string;
  lastDepreciationPeriod: string | null;
  statusCode: string;
  disposalDate: string | null;
  disposalAmount: string | null;
  notes: string | null;
  bookValue: string;
}

export interface AssetDetail extends AssetRow {
  createdAt: string;
  supplierName: string | null;
  assetAccountName: string | null;
  accumDepAccountName: string | null;
  depExpenseAccountName: string | null;
  depreciations: {
    id: string;
    period: string;
    date: string;
    amount: string;
    bookValueAfter: string;
    journal: { id: string; number: string; status: string } | null;
  }[];
  journals: {
    id: string;
    number: string;
    status: string;
    sourceType: string;
    date: string;
  }[];
  schedule: {
    period: string;
    amount: string;
    accumulated: string;
    bookValue: string;
  }[];
}

/** Badge coloured from Master Data > ASSET_STATUS */
export function AssetStatus({ code }: { code: string }) {
  const o = useLookupOptions('ASSET_STATUS').find((x) => x.value === code);
  return (
    <Badge color={o?.color} dot>
      {o?.label ?? code}
    </Badge>
  );
}

export const prevPeriod = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return isoDate(d).slice(0, 7);
};
export const fmtPeriod = (p: string) =>
  new Date(`${p}-01T00:00:00`).toLocaleDateString(getLocale(), {
    month: 'short',
    year: 'numeric',
  });
const lifeText = (m: number) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : m > 12 ? `${Math.floor(m / 12)} y ${m % 12} m` : `${m} months`);

// ------------------------------------------------------------------ register / edit
const empty = () => ({
  code: '',
  name: '',
  categoryCode: '',
  taxGroupCode: '',
  serialNumber: '',
  location: '',
  custodianEmployeeId: null as string | null,
  supplierId: null as string | null,
  acquisitionDate: isoDate(),
  depreciationStartDate: '',
  cost: '',
  salvageValue: '0',
  usefulLifeMonths: '48',
  methodCode: 'STRAIGHT_LINE',
  assetAccountId: null as string | null,
  accumDepAccountId: null as string | null,
  depExpenseAccountId: null as string | null,
  openingAccumulated: '0',
  acquisitionCreditAccountId: null as string | null,
  notes: '',
});
type Form = ReturnType<typeof empty>;

export function AssetFormDrawer({ open, onClose, asset, onSaved }: { open: boolean; onClose: () => void; asset?: AssetDetail | null; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = !!asset && (asset.depreciations.length > 0 || asset.journals.some((j) => j.sourceType === 'ASSET_ACQ' && j.status === 'POSTED'));
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      asset
        ? {
            ...empty(),
            code: asset.code,
            name: asset.name,
            categoryCode: asset.categoryCode ?? '',
            taxGroupCode: asset.taxGroupCode ?? '',
            serialNumber: asset.serialNumber ?? '',
            location: asset.location ?? '',
            custodianEmployeeId: asset.custodianEmployeeId,
            supplierId: asset.supplierId,
            acquisitionDate: asset.acquisitionDate.slice(0, 10),
            depreciationStartDate: asset.depreciationStartDate.slice(0, 10),
            cost: String(Number(asset.cost)),
            salvageValue: String(Number(asset.salvageValue)),
            usefulLifeMonths: String(asset.usefulLifeMonths),
            methodCode: asset.methodCode,
            assetAccountId: asset.assetAccountId,
            accumDepAccountId: asset.accumDepAccountId,
            depExpenseAccountId: asset.depExpenseAccountId,
            notes: asset.notes ?? '',
          }
        : empty(),
    );
  }, [open, asset]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const life = Number(f.usefulLifeMonths) || 0;
  const monthly = life ? (Number(f.cost || 0) - Number(f.salvageValue || 0) - Number(f.openingAccumulated || 0)) / life : 0;

  const save = useMutation({
    mutationFn: () => (asset ? api.patch<{ id: string; code: string }>(`/assets/${asset.id}`, f) : api.post<{ id: string; code: string }>('/assets', f)),
    onSuccess: (r) => {
      toast.success(`${r.code} saved`);
      qc.invalidateQueries({ queryKey: ['assets'] });
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
      wide
      title={asset ? `Edit ${asset.code}` : 'Register fixed asset'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="save" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            <Input value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} placeholder="e.g. MacBook Pro 14 - Design team" invalid={!!errors.name} />
          </Field>
          <Field label="Code" error={errors.code} help={asset ? undefined : 'Empty = next number'}>
            <Input value={f.code} maxLength={30} onChange={(e) => set('code', e.target.value)} invalid={!!errors.code} />
          </Field>
          <Field label="Category" error={errors.categoryCode}>
            <LookupSelect category="ASSET_CATEGORY" value={f.categoryCode} onChange={(v) => set('categoryCode', v)} placeholder="Select category" />
          </Field>
          <Field label="Tax group (fiscal depreciation)" error={errors.taxGroupCode} help="PMK 72/2023: computers and office equipment are group 1 (4 years). Used by the Fiscal Depreciation report">
            <LookupSelect category="TAX_ASSET_GROUP" value={f.taxGroupCode} onChange={(v) => set('taxGroupCode', v)} placeholder="Select tax group" />
          </Field>
          <Field label="Serial number">
            <Input value={f.serialNumber} maxLength={100} onChange={(e) => set('serialNumber', e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={f.location} maxLength={150} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Head office, 2nd floor" />
          </Field>
          <Field label="Custodian" help="Employee responsible for the asset">
            <AsyncSelect resource="employees" value={f.custodianEmployeeId} onChange={(v) => set('custodianEmployeeId', v)} placeholder="None" />
          </Field>
          <Field label="Supplier">
            <AsyncSelect resource="suppliers" value={f.supplierId} onChange={(v) => set('supplierId', v)} placeholder="None" />
          </Field>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Icon name="calculator" className="h-4 w-4 text-brand-600" />
            Value & depreciation
          </h3>
          {locked && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Journals have been posted for this asset, so its value, dates, method and accounts are locked.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Acquisition date" required error={errors.acquisitionDate}>
              <DatePicker value={f.acquisitionDate} onChange={(v) => set('acquisitionDate', v)} clearable={false} disabled={locked} />
            </Field>
            <Field label="Depreciation starts" error={errors.depreciationStartDate} help="Empty = acquisition month">
              <DatePicker value={f.depreciationStartDate} onChange={(v) => set('depreciationStartDate', v)} min={f.acquisitionDate} disabled={locked} />
            </Field>
            <Field label="Cost" required error={errors.cost}>
              <NumberInput fixed={2} decimals={2} min={0} value={f.cost} onChange={(v) => set('cost', v)} invalid={!!errors.cost} disabled={locked} />
            </Field>
            <Field label="Salvage value" error={errors.salvageValue} help="Expected value at the end of its life">
              <NumberInput fixed={2} decimals={2} min={0} value={f.salvageValue} onChange={(v) => set('salvageValue', v)} invalid={!!errors.salvageValue} disabled={locked} />
            </Field>
            <Field label="Useful life (months)" required error={errors.usefulLifeMonths} help={life ? lifeText(life) : undefined}>
              <NumberInput decimals={0} min={1} max={600} value={f.usefulLifeMonths} onChange={(v) => set('usefulLifeMonths', v)} invalid={!!errors.usefulLifeMonths} disabled={locked} />
            </Field>
            <Field label="Method" required error={errors.methodCode}>
              <LookupSelect category="DEPRECIATION_METHOD" value={f.methodCode} onChange={(v) => set('methodCode', v)} clearable={false} disabled={locked} />
            </Field>
            {!asset && (
              <Field label="Depreciation already booked" error={errors.openingAccumulated} help="Only for existing assets moved into this system">
                <NumberInput fixed={2} decimals={2} min={0} value={f.openingAccumulated} onChange={(v) => set('openingAccumulated', v)} invalid={!!errors.openingAccumulated} />
              </Field>
            )}
          </div>
          {monthly > 0 && f.methodCode === 'STRAIGHT_LINE' && <p className="mt-2 text-xs text-slate-500">≈ {fmtMoney(monthly)} per month</p>}
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Icon name="book-open" className="h-4 w-4 text-brand-600" />
            Ledger accounts
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Fixed asset account" error={errors.assetAccountId} help="Empty = default posting account">
              <AsyncSelect resource="accounts" value={f.assetAccountId} onChange={(v) => set('assetAccountId', v)} placeholder="Default" disabled={locked} />
            </Field>
            <Field label="Accumulated depreciation" error={errors.accumDepAccountId} help="Empty = default posting account">
              <AsyncSelect resource="accounts" value={f.accumDepAccountId} onChange={(v) => set('accumDepAccountId', v)} placeholder="Default" disabled={locked} />
            </Field>
            <Field label="Depreciation expense" error={errors.depExpenseAccountId} help="Empty = default posting account">
              <AsyncSelect resource="accounts" value={f.depExpenseAccountId} onChange={(v) => set('depExpenseAccountId', v)} placeholder="Default" disabled={locked} />
            </Field>
            {!asset && (
              <Field label="Record the purchase against" error={errors.acquisitionCreditAccountId} help="Optional: posts Dr fixed asset / Cr this account (bank, payable, equity). Leave empty if the purchase is already booked.">
                <AsyncSelect resource="accounts" value={f.acquisitionCreditAccountId} onChange={(v) => set('acquisitionCreditAccountId', v)} placeholder="Do not post" />
              </Field>
            )}
          </div>
        </section>

        <Field label="Notes">
          <Textarea value={f.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ depreciation run
interface Preview {
  period: string;
  total: string;
  rows: {
    id: string;
    code: string;
    name: string;
    periods: string[];
    amount: string;
  }[];
}
interface RunResponse {
  period: string;
  assets: number;
  entries: number;
  total: string;
  failed: number;
  results: { code: string; error?: string }[];
}

export function DepreciationRunModal({ open, onClose, assetIds, title = 'Run depreciation' }: { open: boolean; onClose: () => void; assetIds?: string[]; title?: string }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(prevPeriod);
  useEffect(() => {
    if (open) setPeriod(prevPeriod());
  }, [open]);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const preview = useQuery({
    queryKey: ['assets', 'preview', period],
    queryFn: () => api.get<Preview>('/assets/depreciation/preview', { period }),
    enabled: open && valid,
  });
  const rows = (preview.data?.rows ?? []).filter((r) => !assetIds || assetIds.includes(r.id));
  const total = rows.reduce((t, r) => t + Number(r.amount), 0);

  const run = useMutation({
    mutationFn: () => api.post<RunResponse>('/assets/depreciation/run', { period, assetIds }),
    onSuccess: (r) => {
      if (r.failed) toast.error(`${r.entries} entr${r.entries === 1 ? 'y' : 'ies'} posted, ${r.failed} failed: ${r.results.find((x) => x.error)?.error ?? ''}`);
      else if (!r.entries) toast.info('Nothing to post for this period');
      else toast.success(`${r.entries} depreciation entr${r.entries === 1 ? 'y' : 'ies'} posted (${fmtMoney(r.total)})`);
      qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="play" loading={run.isPending} disabled={!valid || !rows.length} onClick={() => run.mutate()}>
            Post {rows.length ? fmtMoney(total) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Up to and including" help="Missed months before this period are posted too (one journal per asset per month)">
          <MonthInput aria-label="Period" value={period} max={isoDate().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} className="max-w-48" />
        </Field>
        {preview.isFetching ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-5 w-5 text-brand-600" />
          </div>
        ) : rows.length ? (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Months</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.code}</span> <span className="text-slate-500">{r.name}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.periods.length === 1 ? fmtPeriod(r.periods[0]) : `${fmtPeriod(r.periods[0])} – ${fmtPeriod(r.periods[r.periods.length - 1])}`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-slate-50 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{valid ? 'Everything is already depreciated up to this period.' : 'Choose a period.'}</p>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ disposal
export function DisposeModal({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: AssetDetail }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    date: isoDate(),
    proceeds: '0',
    bankAccountId: null as string | null,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setF({ date: isoDate(), proceeds: '0', bankAccountId: null, notes: '' });
      setErrors({});
    }
  }, [open]);
  const result = Number(f.proceeds || 0) - Number(asset.bookValue);
  const save = useMutation({
    mutationFn: () => api.post<{ journalNumber: string | null; gainLoss: string }>(`/assets/${asset.id}/dispose`, f),
    onSuccess: (r) => {
      toast.success(`${asset.code} disposed${r.journalNumber ? ` (journal ${r.journalNumber})` : ''}`);
      qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Dispose ${asset.code}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon="archive-x" loading={save.isPending} onClick={() => save.mutate()}>
            Dispose asset
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Sold, scrapped or written off. Depreciation up to the previous month is posted first, then the asset is removed from the books.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Disposal date" required error={errors.date}>
            <DatePicker value={f.date} onChange={(v) => setF((s) => ({ ...s, date: v }))} min={asset.acquisitionDate.slice(0, 10)} clearable={false} />
          </Field>
          <Field label="Sale proceeds" error={errors.proceeds} help="0 when scrapped">
            <NumberInput fixed={2} decimals={2} min={0} value={f.proceeds} onChange={(v) => setF((s) => ({ ...s, proceeds: v }))} invalid={!!errors.proceeds} />
          </Field>
          {Number(f.proceeds) > 0 && (
            <Field label="Received in" required error={errors.bankAccountId} className="sm:col-span-2">
              <AsyncSelect resource="bank-accounts" value={f.bankAccountId} onChange={(v) => setF((s) => ({ ...s, bankAccountId: v }))} invalid={!!errors.bankAccountId} />
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} placeholder="e.g. Sold to employee" />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-600">
            Estimated {result >= 0 ? 'gain' : 'loss'} (vs current book value {fmtMoney(asset.bookValue)})
          </span>
          <span className={`font-semibold tabular-nums ${result >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(Math.abs(result))}</span>
        </div>
      </div>
    </Modal>
  );
}
