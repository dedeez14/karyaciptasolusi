import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtBytes, fmtDate, fmtDateTime, fmtMoney, isoDate } from '@/lib/format';
import { useLookupLabel, useLookupOptions } from '@/hooks/useLookups';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, Dropdown, EmptyState, Field, Icon, Input, Modal, PageHeader, previewFile, Spinner, StatusBadge, Steps, Textarea, toast } from '@/components/ui';
import { ApprovalPanel } from '@/features/approvals/ApprovalPanel';
import { EXPENSE_FLOW, type ExpenseDetail } from './common';

function RejectModal({ open, onClose, onDone, id }: { open: boolean; onClose: () => void; onDone: () => void; id: string }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/expenses/${id}/reject`, { reason });
      toast.success('Claim rejected');
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.reason) setError(e.errors.reason);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reject claim"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon="x" loading={busy} onClick={submit}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason" required error={error} help="The employee sees this and can correct and resubmit the claim.">
        <Textarea rows={4} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} invalid={!!error} autoFocus />
      </Field>
    </Modal>
  );
}

function PayModal({ open, onClose, onDone, claim }: { open: boolean; onClose: () => void; onDone: () => void; claim: ExpenseDetail }) {
  const [form, setForm] = useState({ bankAccountId: '', date: isoDate(), reference: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/expenses/${claim.id}/pay`, form);
      toast.success(`${claim.number} paid and posted`);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pay ${claim.number}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" icon="hand-coins" loading={busy} onClick={submit}>
            Pay {fmtMoney(claim.totalAmount)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
          Reimburse <span className="font-semibold">{claim.employeeName}</span> <span className="font-semibold tabular-nums">{fmtMoney(claim.totalAmount)}</span>
        </p>
        <Field label="Pay from" required error={errors.bankAccountId}>
          <AsyncSelect resource="bank-accounts" value={form.bankAccountId} onChange={(v) => setForm({ ...form, bankAccountId: v ?? '' })} invalid={!!errors.bankAccountId} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Payment date" required error={errors.date}>
            <DatePicker value={form.date} onChange={(v) => setForm({ ...form, date: v })} clearable={false} />
          </Field>
          <Field label="Reference">
            <Input value={form.reference} maxLength={100} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Transfer no." />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export default function ExpenseViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statuses = useLookupOptions('EXPENSE_STATUS');
  const category = useLookupLabel('EXPENSE_CATEGORY');
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<'reject' | 'pay' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['expenses', 'one', id], queryFn: () => api.get<ExpenseDetail>(`/expenses/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Claim not found" description={(q.error as Error)?.message} />;
  const c = q.data;
  const st = statuses.find((s) => s.value === c.statusCode);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['approval'] });
    qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const run = async (name: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(name);
    try {
      await fn();
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const ask = async (title: string, message: string, confirmText: string, danger = false) => confirm({ title, message, confirmText, danger });

  const submit = () => run('submit', () => api.post(`/expenses/${c.id}/submit`), 'Claim submitted');
  const approve = async () => {
    if (await ask(`Approve ${c.number}?`, `The expense of ${fmtMoney(c.totalAmount)} is booked and the claim is ready to be paid.`, 'Approve')) run('approve', () => api.post(`/expenses/${c.id}/approve`), 'Claim approved');
  };
  const withdraw = async () => {
    if (await ask(`Withdraw ${c.number}?`, 'The claim goes back to draft so you can change it.', 'Withdraw')) run('withdraw', () => api.post(`/expenses/${c.id}/withdraw`), 'Claim withdrawn');
  };
  const cancel = async () => {
    if (await ask(`Cancel ${c.number}?`, c.statusCode === 'APPROVED' ? 'The expense journal is voided. This cannot be undone.' : 'The claim is cancelled. This cannot be undone.', 'Cancel claim', true)) run('cancel', () => api.post(`/expenses/${c.id}/cancel`), 'Claim cancelled');
  };
  const remove = async () => {
    if (!(await ask(`Delete draft ${c.number}?`, 'The draft is removed.', 'Delete', true))) return;
    try {
      await api.delete(`/expenses/${c.id}`);
      toast.success('Draft deleted');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      navigate('/expenses', { replace: true });
    } catch (e) {
      toast.error(e);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      fd.append('entityType', 'EXPENSE');
      fd.append('entityId', c.id);
      fd.append('categoryCode', 'FINANCE');
      await api.post('/files/upload', fd);
      toast.success('Receipt uploaded');
      qc.invalidateQueries({ queryKey: ['expenses', 'one', id] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const flowIdx = EXPENSE_FLOW.indexOf(c.statusCode === 'REJECTED' ? 'SUBMITTED' : c.statusCode);
  const label = (code: string) => statuses.find((s) => s.value === code)?.label ?? code;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.number}
            <Badge color={st?.color} dot>
              {st?.label ?? c.statusCode}
            </Badge>
          </span>
        }
        subtitle={`${c.title} · ${c.employeeName ?? ''}`}
        back={() => navigate('/expenses')}
        actions={
          <>
            {c.can.edit && (
              <Button variant="outline" icon="pencil" onClick={() => navigate(`/expenses/${c.id}/edit`)}>
                Edit
              </Button>
            )}
            {c.can.submit && (
              <Button icon="send" loading={busy === 'submit'} onClick={submit}>
                Submit
              </Button>
            )}
            {c.can.approve && (
              <Button variant="success" icon="check" loading={busy === 'approve'} onClick={approve}>
                Approve
              </Button>
            )}
            {c.can.reject && (
              <Button variant="outline" icon="x" onClick={() => setModal('reject')}>
                Reject
              </Button>
            )}
            {c.can.pay && (
              <Button variant="success" icon="hand-coins" onClick={() => setModal('pay')}>
                Pay
              </Button>
            )}
            {(c.can.withdraw || c.can.cancel || c.can.delete) && (
              <Dropdown
                trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
                items={[
                  { label: 'Withdraw to draft', icon: 'undo-2', onClick: withdraw, hidden: !c.can.withdraw },
                  { label: 'Cancel claim', icon: 'ban', danger: true, onClick: cancel, hidden: !c.can.cancel },
                  { label: 'Delete draft', icon: 'trash-2', danger: true, onClick: remove, hidden: !c.can.delete },
                ]}
              />
            )}
          </>
        }
      />
      <div className="mb-5">
        <Steps
          steps={EXPENSE_FLOW.map((s) => ({ label: s === 'SUBMITTED' && c.statusCode === 'REJECTED' ? label('REJECTED') : label(s), hint: s === 'DRAFT' ? fmtDate(c.createdAt) : s === 'SUBMITTED' && c.submittedAt ? fmtDate(c.submittedAt) : s === 'APPROVED' && c.approvedAt ? fmtDate(c.approvedAt) : s === 'PAID' && c.paidAt ? fmtDate(c.paidAt) : undefined }))}
          current={c.statusCode === 'PAID' ? EXPENSE_FLOW.length : Math.max(0, flowIdx)}
          cancelled={c.statusCode === 'CANCELLED'}
        />
      </div>
      {c.statusCode === 'REJECTED' && c.rejectReason && (
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          <Icon name="circle-x" className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Rejected</p>
            <p>{c.rejectReason}</p>
            {c.can.edit && <p className="mt-1 text-xs text-red-700">Correct the claim and submit it again.</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Expenses" bodyClass="p-0">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(l.date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{l.description}</p>
                        <p className="text-xs text-slate-500">{[category(l.categoryCode), l.projectName, l.costCenterName].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{l.accountName ?? <span className="text-slate-400">Default expense account</span>}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50/80">
                    <td colSpan={3} className="px-4 py-3 text-right font-medium text-slate-600">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right text-base font-semibold tabular-nums">{fmtMoney(c.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {c.lines.map((l) => (
                <div key={l.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{l.description}</span>
                    <span className="font-medium tabular-nums">{fmtMoney(l.amount)}</span>
                  </div>
                  <p className="text-xs text-slate-500">{[fmtDate(l.date), category(l.categoryCode), l.projectName].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{fmtMoney(c.totalAmount)}</span>
              </div>
            </div>
          </Card>

          <Card
            title="Receipts"
            subtitle="Photos or PDFs of the receipts"
            actions={
              c.can.upload && (
                <>
                  <input ref={fileInput} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => upload(e.target.files)} />
                  <Button size="sm" variant="secondary" icon="upload" loading={busy === 'upload'} onClick={() => fileInput.current?.click()}>
                    Upload
                  </Button>
                </>
              )
            }
          >
            {c.files.length ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {c.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
                      <Icon name={f.mimeType.startsWith('image/') ? 'image' : f.mimeType === 'application/pdf' ? 'file-text' : 'file'} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{f.name}</p>
                      <p className="text-xs text-slate-500">{fmtBytes(f.size)}</p>
                    </div>
                    {(f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf') && (
                      <button type="button" aria-label="Preview" className="text-slate-400 hover:text-brand-600" onClick={() => previewFile({ path: `/files/${f.id}/download`, title: f.name }).catch(toast.error)}>
                        <Icon name="eye" className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" aria-label="Download" className="text-slate-400 hover:text-brand-600" onClick={() => download(`/files/${f.id}/download`).catch(toast.error)}>
                      <Icon name="download" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No receipts attached.</p>
            )}
          </Card>

          {c.notes && (
            <Card title="Notes">
              <p className="text-sm whitespace-pre-line">{c.notes}</p>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl bg-brand-600 p-5 text-white shadow-pop">
            <p className="text-sm text-white/80">Total claim</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(c.totalAmount)}</p>
            <p className="mt-2 text-xs text-white/80">{c.lines.length} expense{c.lines.length === 1 ? '' : 's'}</p>
          </div>
          <Card title="Details">
            <dl className="space-y-3 text-sm">
              <Info label="Employee" value={`${c.employeeName ?? '—'}${c.employeeCode ? ` (${c.employeeCode})` : ''}`} />
              <Info label="Claim date" value={fmtDate(c.date)} />
              <Info label="Created by" value={c.createdByName} />
              {c.submittedAt && <Info label="Submitted" value={fmtDateTime(c.submittedAt)} />}
              {c.approvedAt && <Info label="Approved" value={`${fmtDateTime(c.approvedAt)}${c.approvedByName ? ` by ${c.approvedByName}` : ''}`} />}
              {c.paidAt && <Info label="Paid" value={`${fmtDate(c.paidAt)}${c.paidBankAccountName ? ` from ${c.paidBankAccountName}` : ''}`} />}
            </dl>
          </Card>
          <ApprovalPanel basePath={`/expenses/${c.id}`} title={c.number} info={c.approval} />
          {c.journals.length > 0 && (
            <Card title="Journal entries">
              <ul className="space-y-2 text-sm">
                {c.journals.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-2">
                    <Link to={`/accounting/journals/${j.id}`} className="font-medium text-brand-700 hover:underline">
                      {j.number}
                    </Link>
                    <span className="text-xs text-slate-500">{j.sourceType === 'EXPENSE_PAYMENT' ? 'Payment' : 'Expense'}</span>
                    <StatusBadge status={j.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <RejectModal open={modal === 'reject'} onClose={() => setModal(null)} onDone={refresh} id={c.id} />
      {modal === 'pay' && <PayModal open onClose={() => setModal(null)} onDone={refresh} claim={c} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value ? String(value) : <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
