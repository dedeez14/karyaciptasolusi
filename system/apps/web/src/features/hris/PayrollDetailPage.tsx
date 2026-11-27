import { Fragment, useState } from 'react';
import { ApiError } from '@/lib/api';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { previewFile } from '@/components/ui/preview';
import { fmtDate, fmtMoney, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, Dropdown, EmptyState, Field, Icon, Modal, PageHeader, Spinner, StatCard, StatusBadge, toast } from '@/components/ui';
import type { PayrollRun } from './PayrollListPage';

interface SlipLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
}
interface Statutory {
  category?: string;
  ptkp?: string;
  terRate?: number;
  bruto?: number;
  pph21?: number;
  method?: 'TER' | 'ANNUAL';
  annual?: { biayaJabatan: number; neto: number; ptkp: number; pkp: number; yearTax: number; tax: number };
  bpjs?: { company?: Record<string, number> };
  warnings?: string[];
}
interface Payslip {
  id: string;
  employeeId: string;
  baseSalary: string;
  totalEarning: string;
  totalDeduction: string;
  netPay: string;
  employerCost?: string;
  statutory?: Statutory | null;
  lines: SlipLine[];
  employee?: { id: string; code: string; fullName: string };
}
interface RunDetail extends PayrollRun {
  payslips: Payslip[];
}

/** Pay the net salaries from a cash or bank account (posts Dr salaries payable / Cr bank) */
function PayModal({ run, onClose, onPaid }: { run: RunDetail; onClose: () => void; onPaid: () => void }) {
  const [bankAccountId, setBank] = useState<string | null>(null);
  const [date, setDate] = useState(run.payDate ? run.payDate.slice(0, 10) : isoDate());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/hris/payroll/${run.id}/pay`, { bankAccountId, date });
      toast.success(`Salaries of ${run.number} paid`);
      onPaid();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay salaries ${run.number}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="banknote" loading={busy} disabled={!bankAccountId} onClick={pay}>
            Pay {fmtMoney(run.totalNet)}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Pay from" required error={errors.bankAccountId} className="sm:col-span-2">
          <AsyncSelect resource="bank-accounts" value={bankAccountId} onChange={setBank} placeholder="Choose a cash or bank account" manageHref="/r/bank-accounts" manageLabel="Manage cash & bank accounts" />
        </Field>
        <Field label="Payment date" required error={errors.date}>
          <DatePicker clearable={false} value={date} onChange={setDate} />
        </Field>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs text-slate-500">Net pay to transfer</div>
          <div className="font-semibold tabular-nums">{fmtMoney(run.totalNet)}</div>
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Posts one journal: debit Salaries Payable, credit the chosen account. Download the bank transfer file to upload the salary transfers to your bank.
        </p>
      </div>
    </Modal>
  );
}

export default function PayrollDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const q = useQuery({ queryKey: ['payroll', 'one', id], queryFn: () => api.get<RunDetail>(`/hris/payroll/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (q.error || !q.data) return <EmptyState icon="file-x" title="Payroll run not found" description={(q.error as Error)?.message} />;
  const run = q.data;

  const run_ = async (name: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(name);
    try {
      await fn();
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const confirmRun = async () => {
    if (!(await confirm({ title: `Confirm payroll ${run.number}?`, message: 'Salary expense and payables will be posted to the ledger. The run can no longer be regenerated.', confirmText: 'Confirm payroll' }))) return;
    run_(
      'confirm',
      async () => {
        await api.post(`/hris/payroll/${run.id}/confirm`);
        qc.invalidateQueries({ queryKey: ['payroll'] });
      },
      'Payroll confirmed and posted',
    );
  };
  const cancelRun = async () => {
    if (!(await confirm({ title: `Cancel payroll ${run.number}?`, message: run.status === 'DRAFT' ? 'The draft will be cancelled.' : 'The posted journal will be voided.', confirmText: 'Cancel payroll', danger: true }))) return;
    run_(
      'cancel',
      async () => {
        await api.post(`/hris/payroll/${run.id}/cancel`);
        qc.invalidateQueries({ queryKey: ['payroll'] });
      },
      'Payroll cancelled',
    );
  };
  const unpay = async () => {
    if (!(await confirm({ title: `Cancel the salary payment of ${run.number}?`, message: 'The payment journal is voided and the salaries become payable again.', confirmText: 'Cancel payment', danger: true }))) return;
    run_(
      'unpay',
      async () => {
        await api.post(`/hris/payroll/${run.id}/unpay`);
        qc.invalidateQueries({ queryKey: ['payroll'] });
      },
      'Salary payment cancelled',
    );
  };
  const transferFile = (format: 'xlsx' | 'csv') => run_(`tf-${format}`, () => download(`/hris/payroll/${run.id}/transfer-file`, { format }));
  const confirmed = run.status === 'CONFIRMED';
  const toggle = (sid: string) => setExpanded((s) => (s.has(sid) ? new Set([...s].filter((x) => x !== sid)) : new Set([...s, sid])));
  const pdfPath = (sid: string) => `/hris/payroll/${run.id}/payslips/${sid}/pdf`;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Payroll {run.number} <StatusBadge status={run.status} />
            {run.paidAt && (
              <Badge tone="green" dot>
                Paid {fmtDate(run.paidAt)}
              </Badge>
            )}
          </span>
        }
        subtitle={`${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)} · pay date ${fmtDate(run.payDate)}`}
        back={() => navigate('/hris/payroll')}
        actions={
          <>
            {run.journalEntryId && (
              <Link to={`/accounting/journals/${run.journalEntryId}`}>
                <Button variant="outline" icon="book-open">
                  Journal
                </Button>
              </Link>
            )}
            {run.paymentJournalId && (
              <Link to={`/accounting/journals/${run.paymentJournalId}`}>
                <Button variant="outline" icon="receipt">
                  Payment journal
                </Button>
              </Link>
            )}
            {confirmed && can('hris.payroll.pay') && (
              <Dropdown
                trigger={
                  <Button variant="outline" icon="file-down" loading={busy?.startsWith('tf-')}>
                    Transfer file
                  </Button>
                }
                items={[
                  { label: 'Excel (.xlsx)', icon: 'file-spreadsheet', onClick: () => transferFile('xlsx') },
                  { label: 'CSV', icon: 'file-text', onClick: () => transferFile('csv') },
                ]}
              />
            )}
            {confirmed && (
              <Button variant="outline" icon="file-code" loading={busy === 'bpmp'} title="Bukti potong PPh 21 bulanan for Coretax (XML, DJP template)" onClick={() => run_('bpmp', () => download('/coretax/bpmp', { month: run.periodEnd.slice(0, 7) }), 'File ready: upload it in Coretax (e-Bupot 21)')}>
                Coretax PPh 21
              </Button>
            )}
            {confirmed && !run.paidAt && can('hris.payroll.pay') && (
              <Button icon="banknote" onClick={() => setPaying(true)}>
                Pay salaries
              </Button>
            )}
            {run.paidAt && can('hris.payroll.pay') && (
              <Button variant="outline" icon="undo-2" loading={busy === 'unpay'} onClick={unpay}>
                Cancel payment
              </Button>
            )}
            {run.status === 'DRAFT' && can('hris.payroll.confirm') && (
              <Button icon="check-circle-2" loading={busy === 'confirm'} onClick={confirmRun}>
                Confirm & post
              </Button>
            )}
            {run.status !== 'CANCELLED' && !run.paidAt && can('hris.payroll.confirm') && (
              <Button variant="danger" icon="ban" loading={busy === 'cancel'} onClick={cancelRun}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Employees" value={run.payslips.length} icon="users" />
        <StatCard label="Gross pay" value={fmtMoney(run.totalGross)} icon="trending-up" tone="green" />
        <StatCard label="Deductions" value={fmtMoney(run.totalDeduction)} icon="trending-down" tone="amber" />
        <StatCard label="Net pay" value={fmtMoney(run.totalNet)} icon="wallet" tone="violet" />
      </div>
      {Number(run.totalEmployerCost ?? 0) > 0 && (
        <p className="mb-4 text-sm text-slate-600">
          Company BPJS contributions (JHT, JP, JKK, JKM, Kesehatan): <b className="tabular-nums">{fmtMoney(run.totalEmployerCost)}</b> · total employment cost{' '}
          <b className="tabular-nums">{fmtMoney(Number(run.totalGross) + Number(run.totalEmployerCost))}</b>
        </p>
      )}
      {run.payslips.some((s) => s.statutory?.warnings?.length) && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <Icon name="triangle-alert" className="h-4 w-4" /> Check before confirming
          </p>
          <ul className="ml-6 list-disc text-xs">
            {run.payslips.flatMap((s) => (s.statutory?.warnings ?? []).map((w) => <li key={s.id + w}>{`${s.employee?.fullName}: ${w}`}</li>))}
          </ul>
        </div>
      )}
      {run.notes && <p className="mb-4 text-sm text-slate-500">{run.notes}</p>}
      {confirmed && !run.paidAt && can('hris.payroll.pay') && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="clock" className="h-4 w-4 shrink-0" />
          <span className="flex-1">Net salaries of {fmtMoney(run.totalNet)} are still payable. Transfer them, then record the payment here.</span>
          <Button size="sm" icon="banknote" onClick={() => setPaying(true)}>
            Pay salaries
          </Button>
        </div>
      )}
      <Card title="Payslips" bodyClass="p-0">
        {!run.payslips.length ? (
          <EmptyState icon="users" title="No payslips" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Employee</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">Base</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">Earnings</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">Deductions</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-right">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {run.payslips.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer border-b border-line hover:bg-slate-50" onClick={() => toggle(s.id)}>
                      <td className="px-3 py-2">
                        <Icon name={expanded.has(s.id) ? 'chevron-down' : 'chevron-right'} className="h-4 w-4 text-slate-400" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{s.employee?.fullName}</div>
                        <div className="text-xs text-slate-500">{s.employee?.code}</div>
                      </td>
                      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{fmtMoney(s.baseSalary)}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{fmtMoney(s.totalEarning)}</td>
                      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{fmtMoney(s.totalDeduction)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(s.netPay)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" icon="eye" loading={busy === `v-${s.id}`} onClick={() => run_(`v-${s.id}`, () => previewFile({ path: pdfPath(s.id), title: `Payslip ${s.employee?.fullName ?? ''}` }))} aria-label="Preview payslip" />
                        <Button size="sm" variant="ghost" icon="download" loading={busy === `d-${s.id}`} onClick={() => run_(`d-${s.id}`, () => download(pdfPath(s.id)))} aria-label="Download payslip" />
                        <Button size="sm" variant="ghost" icon="folder-input" loading={busy === `s-${s.id}`} onClick={() => run_(`s-${s.id}`, () => download(pdfPath(s.id), { save: 1 }), 'Payslip saved to File Manager')} aria-label="Save payslip to File Manager" />
                      </td>
                    </tr>
                    {expanded.has(s.id) && (
                      <tr className="border-b border-line bg-slate-50/60">
                        <td />
                        <td colSpan={6} className="px-3 py-3">
                          <ul className="grid gap-1 text-xs sm:max-w-lg">
                            <li className="flex justify-between">
                              <span>Base salary</span>
                              <span className="tabular-nums">{fmtMoney(s.baseSalary)}</span>
                            </li>
                            {s.lines.map((l) => (
                              <li key={l.code} className="flex justify-between gap-2">
                                <span>
                                  <Badge tone={l.kind === 'EARNING' ? 'green' : 'red'}>{l.kind === 'EARNING' ? '+' : '−'}</Badge> {l.name}
                                </span>
                                <span className="tabular-nums">{fmtMoney(l.amount)}</span>
                              </li>
                            ))}
                            <li className="flex justify-between border-t border-line pt-1 font-semibold">
                              <span>Net pay</span>
                              <span className="tabular-nums">{fmtMoney(s.netPay)}</span>
                            </li>
                          </ul>
                          {s.statutory?.category && (
                            <div className="mt-3 grid gap-1 rounded-lg bg-white p-3 text-xs text-slate-600 ring-1 ring-line sm:max-w-lg">
                              <p className="font-medium text-slate-700">PPh 21 working</p>
                              <p>
                                PTKP {s.statutory.ptkp} · category {s.statutory.category} · taxable gross {fmtMoney(s.statutory.bruto)} (incl. company JKK, JKM and BPJS Kesehatan)
                              </p>
                              {s.statutory.method === 'ANNUAL' && s.statutory.annual ? (
                                <p>
                                  Annual: biaya jabatan {fmtMoney(s.statutory.annual.biayaJabatan)}, net {fmtMoney(s.statutory.annual.neto)}, PTKP {fmtMoney(s.statutory.annual.ptkp)}, taxable {fmtMoney(s.statutory.annual.pkp)}, tax for the year {fmtMoney(s.statutory.annual.yearTax)} → this month {fmtMoney(s.statutory.annual.tax)}
                                </p>
                              ) : (
                                <p>
                                  TER rate {s.statutory.terRate}% → PPh 21 {fmtMoney(s.statutory.pph21)}
                                </p>
                              )}
                              {Number(s.employerCost ?? 0) > 0 && (
                                <p>
                                  Paid by the company on top: {Object.entries(s.statutory.bpjs?.company ?? {})
                                    .filter(([, v]) => v)
                                    .map(([k, v]) => `${k.toUpperCase()} ${fmtMoney(v)}`)
                                    .join(' · ')}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {paying && (
        <PayModal
          run={run}
          onClose={() => setPaying(false)}
          onPaid={() => {
            setPaying(false);
            qc.invalidateQueries({ queryKey: ['payroll'] });
          }}
        />
      )}
    </div>
  );
}
