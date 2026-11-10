import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, type Column, DataTable, DatePicker, EmptyState, Field, Modal, PageHeader, Pagination, StatusBadge, Textarea, toast } from '@/components/ui';

export interface PayrollRun {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: string;
  totalDeduction: string;
  totalNet: string;
  notes: string | null;
  journalEntryId: string | null;
  _count?: { payslips: number };
}

function GenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    periodStart: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    periodEnd: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    payDate: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    branchId: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const gen = useMutation({
    mutationFn: () => api.post<PayrollRun>('/hris/payroll', { ...form, branchId: form.branchId || null, notes: form.notes || null }),
    onSuccess: (r) => {
      toast.success(`Payroll ${r.number} generated as draft`);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
      navigate(`/hris/payroll/${r.id}`);
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
      title="Generate payroll"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="play" loading={gen.isPending} onClick={() => gen.mutate()}>
            Generate
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Period start" required error={errors.periodStart}>
          <DatePicker clearable={false} value={form.periodStart} onChange={(v) => setForm({ ...form, periodStart: v })} />
        </Field>
        <Field label="Period end" required error={errors.periodEnd}>
          <DatePicker clearable={false} value={form.periodEnd} onChange={(v) => setForm({ ...form, periodEnd: v })} />
        </Field>
        <Field label="Pay date" required error={errors.payDate}>
          <DatePicker clearable={false} value={form.payDate} onChange={(v) => setForm({ ...form, payDate: v })} />
        </Field>
        <Field label="Branch" help="Empty = all branches">
          <AsyncSelect resource="branches" value={form.branchId || null} onChange={(v) => setForm({ ...form, branchId: v ?? '' })} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Payslips are calculated from each active employee&apos;s base salary, salary components and approved unpaid leave. You can review the draft before confirming.
        </p>
      </div>
    </Modal>
  );
}

export default function PayrollListPage() {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1) || 1;
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['payroll', 'list', page], queryFn: () => api.get<Paged<PayrollRun>>('/hris/payroll', { page, pageSize: 20 }), placeholderData: keepPreviousData });

  const columns: Column<PayrollRun>[] = [
    { key: 'number', header: 'Run', render: (r) => <span className="font-medium text-brand-700">{r.number}</span> },
    { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
    { key: 'payDate', header: 'Pay date', render: (r) => fmtDate(r.payDate) },
    { key: 'employees', header: 'Employees', align: 'right', render: (r) => r._count?.payslips ?? 0 },
    { key: 'totalGross', header: 'Gross', align: 'right', render: (r) => fmtMoney(r.totalGross) },
    { key: 'totalNet', header: 'Net pay', align: 'right', render: (r) => <b>{fmtMoney(r.totalNet)}</b> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={list.data ? `${list.data.meta.total} payroll runs` : undefined}
        actions={
          can('hris.payroll.create') && (
            <Button icon="plus" onClick={() => setOpen(true)}>
              Generate payroll
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={list.isFetching}
          onRowClick={(r) => navigate(`/hris/payroll/${r.id}`)}
          empty={
            <EmptyState
              icon="wallet"
              title="No payroll runs yet"
              action={
                can('hris.payroll.create') && (
                  <Button icon="plus" onClick={() => setOpen(true)}>
                    Generate payroll
                  </Button>
                )
              }
            />
          }
        />
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={20} onPage={(p) => setSp({ page: String(p) })} />}
      </Card>
      {open && <GenerateModal open={open} onClose={() => setOpen(false)} />}
    </div>
  );
}
