import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Paged } from '@/lib/api';
import { fmtDate, fmtMoney, isoDate, plural } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, type Column, DataTable, DatePicker, EmptyState, Field, Modal, PageHeader, Pagination, Select, StatusBadge, Textarea, toast } from '@/components/ui';

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
  totalEmployerCost?: string;
  kind?: 'REGULAR' | 'THR';
  notes: string | null;
  journalEntryId: string | null;
  paidAt?: string | null;
  paidBankAccountId?: string | null;
  paymentJournalId?: string | null;
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
    kind: 'REGULAR' as 'REGULAR' | 'THR',
    holidayDate: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const gen = useMutation({
    mutationFn: () => api.post<PayrollRun>('/hris/payroll', { ...form, branchId: form.branchId || null, notes: form.notes || null, holidayDate: form.kind === 'THR' ? form.holidayDate || null : null }),
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
        <Field label="Type" className="sm:col-span-2">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'REGULAR' | 'THR' })}
            options={[
              { value: 'REGULAR', label: 'Monthly salary', hint: 'Salary, allowances, BPJS and PPh 21 (TER; December = annual recalculation)' },
              { value: 'THR', label: 'THR (religious holiday allowance)', hint: '1 month wage after 12 months of service, pro rata from 1 month; pay at least 7 days before the holiday' },
            ]}
          />
        </Field>
        {form.kind === 'THR' && (
          <Field label="Holiday date" required error={errors.holidayDate} help="Service is counted up to this date" className="sm:col-span-2">
            <DatePicker value={form.holidayDate} onChange={(v) => setForm({ ...form, holidayDate: v })} />
          </Field>
        )}
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
          Payslips are calculated from each active employee&apos;s base salary, salary components and approved unpaid leave, with BPJS and PPh 21 (rates in Settings &gt; Payroll &amp; BPJS). You can review the draft before confirming.
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
    {
      key: 'number',
      header: 'Run',
      render: (r) => (
        <span className="font-medium text-brand-700">
          {r.number} {r.kind === 'THR' && <Badge tone="amber">THR</Badge>}
        </span>
      ),
    },
    { key: 'period', header: 'Period', render: (r) => `${fmtDate(r.periodStart)} – ${fmtDate(r.periodEnd)}` },
    { key: 'payDate', header: 'Pay date', render: (r) => fmtDate(r.payDate) },
    { key: 'employees', header: 'Employees', align: 'right', render: (r) => r._count?.payslips ?? 0 },
    { key: 'totalGross', header: 'Gross', align: 'right', render: (r) => fmtMoney(r.totalGross) },
    { key: 'totalNet', header: 'Net pay', align: 'right', render: (r) => <b>{fmtMoney(r.totalNet)}</b> },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.paidAt && r.status === 'CONFIRMED' ? (
          <Badge tone="green" dot>
            Paid {fmtDate(r.paidAt)}
          </Badge>
        ) : (
          <StatusBadge status={r.status} />
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={list.data ? plural(list.data.meta.total, 'payroll run') : undefined}
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
