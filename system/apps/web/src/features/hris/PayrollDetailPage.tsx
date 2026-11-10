import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { previewFile } from '@/components/ui/preview';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, EmptyState, Icon, PageHeader, Spinner, StatCard, StatusBadge, toast } from '@/components/ui';
import type { PayrollRun } from './PayrollListPage';

interface SlipLine {
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
}
interface Payslip {
  id: string;
  employeeId: string;
  baseSalary: string;
  totalEarning: string;
  totalDeduction: string;
  netPay: string;
  lines: SlipLine[];
  employee?: { id: string; code: string; fullName: string };
}
interface RunDetail extends PayrollRun {
  payslips: Payslip[];
}

export default function PayrollDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
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
  const toggle = (sid: string) => setExpanded((s) => (s.has(sid) ? new Set([...s].filter((x) => x !== sid)) : new Set([...s, sid])));
  const pdfPath = (sid: string) => `/hris/payroll/${run.id}/payslips/${sid}/pdf`;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Payroll {run.number} <StatusBadge status={run.status} />
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
            {run.status === 'DRAFT' && can('hris.payroll.confirm') && (
              <Button icon="check-circle-2" loading={busy === 'confirm'} onClick={confirmRun}>
                Confirm & post
              </Button>
            )}
            {run.status !== 'CANCELLED' && can('hris.payroll.confirm') && (
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
      {run.notes && <p className="mb-4 text-sm text-slate-500">{run.notes}</p>}
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
    </div>
  );
}
