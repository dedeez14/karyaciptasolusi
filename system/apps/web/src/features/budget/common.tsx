import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Paged } from '@/lib/api';
import { useLookupOptions } from '@/hooks/useLookups';
import { Badge, Button, Field, Input, Modal, Select, Textarea, toast, NumberInput } from '@/components/ui';

export interface BudgetListRow {
  id: string;
  code: string;
  name: string;
  year: number;
  statusCode: string;
  approvedAt: string | null;
  lineCount: number;
  income: string;
  expense: string;
  other: string;
  updatedAt: string;
}

export interface GridRow {
  key: string;
  accountId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  amounts: string[];
  accountType?: string | null;
  accountCode?: string;
  accountName?: string;
}

export interface BudgetDetail {
  id: string;
  code: string;
  name: string;
  year: number;
  statusCode: string;
  notes: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rows: {
    accountId: string;
    costCenterId: string | null;
    projectId: string | null;
    amounts: number[];
    accountCode: string;
    accountName: string;
    accountType: string | null;
    costCenterName: string | null;
    projectName: string | null;
    total: number;
  }[];
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }));

export function BudgetStatus({ code }: { code: string }) {
  const o = useLookupOptions('BUDGET_STATUS').find((x) => x.value === code);
  return (
    <Badge color={o?.color} dot>
      {o?.label ?? code}
    </Badge>
  );
}

/** New budget: empty, copied from another budget, or seeded from last year's actual figures */
export function NewBudgetModal({ open, onClose, copyFrom }: { open: boolean; onClose: () => void; copyFrom?: BudgetDetail | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [f, setF] = useState({
    name: '',
    year: String(thisYear),
    source: 'empty',
    copyFromBudgetId: '',
    fromActualYear: String(thisYear - 1),
    upliftPct: '0',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    const y = copyFrom ? copyFrom.year + 1 : thisYear;
    setF({
      name: copyFrom ? copyFrom.name.replace(String(copyFrom.year), String(y)) : `Budget ${y}`,
      year: String(y),
      source: copyFrom ? 'budget' : 'empty',
      copyFromBudgetId: copyFrom?.id ?? '',
      fromActualYear: String(y - 1),
      upliftPct: '0',
      notes: '',
    });
  }, [open, copyFrom, thisYear]);
  const budgets = useQuery({
    queryKey: ['budgets', 'all'],
    queryFn: () => api.get<Paged<BudgetListRow>>('/budgets', { pageSize: 200 }),
    enabled: open && !copyFrom,
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      copyFrom
        ? api.post<{ id: string; code: string }>(`/budgets/${copyFrom.id}/copy`, { name: f.name, year: f.year, upliftPct: f.upliftPct })
        : api.post<{ id: string; code: string }>('/budgets', {
            name: f.name,
            year: f.year,
            notes: f.notes,
            copyFromBudgetId: f.source === 'budget' ? f.copyFromBudgetId : null,
            fromActualYear: f.source === 'actual' ? f.fromActualYear : null,
            upliftPct: f.upliftPct,
          }),
    onSuccess: (r) => {
      toast.success(`${r.code} created`);
      qc.invalidateQueries({ queryKey: ['budgets'] });
      onClose();
      navigate(`/budgets/${r.id}`);
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
      title={copyFrom ? `Copy ${copyFrom.code}` : 'New budget'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="save" loading={save.isPending} disabled={f.source === 'budget' && !f.copyFromBudgetId} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          <Input value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} />
        </Field>
        <Field label="Year" required error={errors.year}>
          <NumberInput decimals={0} grouping={false} min={2000} max={2100} value={f.year} onChange={(v) => set('year', v)} invalid={!!errors.year} />
        </Field>
        {!copyFrom && (
          <div className="space-y-2 sm:col-span-3">
            <span className="label">Start from</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                {
                  v: 'empty',
                  t: 'Empty budget',
                  d: 'Enter every figure yourself',
                },
                { v: 'budget', t: 'Another budget', d: 'Copy its lines' },
                {
                  v: 'actual',
                  t: 'Actual figures',
                  d: 'Posted income & expenses of a year',
                },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => set('source', o.v)}
                  className={`rounded-xl border p-3 text-left text-sm transition-colors ${f.source === o.v ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-line hover:bg-slate-50'}`}
                >
                  <span className="font-medium">{o.t}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{o.d}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {f.source === 'budget' && !copyFrom && (
          <Field label="Copy from" required className="sm:col-span-2">
            <Select
              value={f.copyFromBudgetId}
              onChange={(e) => set('copyFromBudgetId', e.target.value)}
              placeholder="Select budget"
              options={(budgets.data?.data ?? []).map((b) => ({
                value: b.id,
                label: `${b.code} · ${b.name} (${b.year})`,
              }))}
            />
          </Field>
        )}
        {f.source === 'actual' && (
          <Field label="Actuals of year" required className="sm:col-span-2">
            <NumberInput decimals={0} grouping={false} min={2000} max={2100} value={f.fromActualYear} onChange={(v) => set('fromActualYear', v)} />
          </Field>
        )}
        {f.source !== 'empty' && (
          <Field label="Adjust by %" help="e.g. 10 = +10%">
            <NumberInput decimals={2} allowNegative min={-100} max={1000} value={f.upliftPct} onChange={(v) => set('upliftPct', v)} />
          </Field>
        )}
        {!copyFrom && (
          <Field label="Notes" className="sm:col-span-3">
            <Textarea rows={2} value={f.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
