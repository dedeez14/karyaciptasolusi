import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { Badge, Button, Card, cn, confirm, EmptyState, Icon, PageHeader, Spinner, toast } from '@/components/ui';

interface PeriodRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  closingJournal: { id: string; number: string | null } | null;
  income: string;
  expense: string;
  result: string;
}

interface Preview {
  period: { id: string; name: string; startDate: string; endDate: string; isClosed: boolean; closedAt: string | null; closingJournalId: string | null };
  accounts: { id: string; code: string; name: string; type: 'INCOME' | 'EXPENSE'; amount: string }[];
  income: string;
  expense: string;
  result: string;
  retainedEarnings: { code: string; name: string } | null;
  draftJournals: number;
  warnings: string[];
  canClose: boolean;
  canReopen: boolean;
}

const n = (v: unknown) => Number(v ?? 0);

/** Year-end closing: result of the year into retained earnings + lock, and the way back (reopen) */
export default function YearEndPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const list = useQuery({ queryKey: ['year-end'], queryFn: () => api.get<PeriodRow[]>('/year-end') });
  const selected = sp.get('period') ?? list.data?.find((p) => !p.isClosed)?.id ?? list.data?.[0]?.id ?? null;
  const pv = useQuery({ queryKey: ['year-end', 'preview', selected], queryFn: () => api.get<Preview>(`/year-end/${selected}`), enabled: !!selected });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sp.get('period') && selected) setSp({ period: selected }, { replace: true });
  }, [selected, sp, setSp]);

  const act = async (kind: 'close' | 'reopen') => {
    const p = pv.data;
    if (!p) return;
    const yes = await confirm(
      kind === 'close'
        ? {
            title: `Close ${p.period.name}?`,
            message: (
              <>
                The {n(p.result) >= 0 ? 'profit' : 'loss'} of <b>{fmtMoney(Math.abs(n(p.result)))}</b> is moved to {p.retainedEarnings ? `${p.retainedEarnings.code} ${p.retainedEarnings.name}` : 'retained earnings'} by a closing journal dated {fmtDate(p.period.endDate)}, and no posting dated in this year is accepted anymore.
              </>
            ),
            confirmText: 'Close year',
          }
        : { title: `Reopen ${p.period.name}?`, message: 'The closing journal is voided and postings dated in this year are allowed again. This is recorded in the audit trail.', confirmText: 'Reopen', danger: true },
    );
    if (!yes) return;
    setBusy(true);
    try {
      await api.post(`/year-end/${p.period.id}/${kind}`);
      toast.success(kind === 'close' ? `${p.period.name} closed` : `${p.period.name} reopened`);
      qc.invalidateQueries({ queryKey: ['year-end'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (list.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  const periods = list.data ?? [];
  const p = pv.data;

  return (
    <div>
      <PageHeader title="Year-end Closing" subtitle="Move the result of a financial year into retained earnings and lock the year" />
      {periods.length === 0 ? (
        <EmptyState icon="calendar-range" title="No fiscal periods" description="Create the financial years first." action={<Link to="/r/fiscal-periods"><Button icon="plus">Fiscal periods</Button></Link>} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card title="Financial years" bodyClass="p-0">
            <ul className="divide-y divide-line">
              {periods.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSp({ period: r.id })} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50', r.id === selected && 'bg-brand-50')}>
                    <Icon name={r.isClosed ? 'lock' : 'lock-open'} className={cn('h-4 w-4 shrink-0', r.isClosed ? 'text-slate-400' : 'text-emerald-500')} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{r.name}</span>
                      <span className="block text-xs text-slate-500">
                        {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn('block text-sm font-semibold tabular-nums', n(r.result) >= 0 ? 'text-emerald-700' : 'text-red-600')}>{fmtMoney(r.result)}</span>
                      {r.isClosed ? <Badge>Closed</Badge> : <Badge tone="green">Open</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5 lg:col-span-2">
            {!p || pv.isFetching ? (
              <Card>
                <div className="flex justify-center py-10">
                  <Spinner className="h-5 w-5 text-brand-700" />
                </div>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Stat label="Income" value={fmtMoney(p.income)} />
                  <Stat label="Expenses" value={fmtMoney(p.expense)} />
                  <Stat label={n(p.result) >= 0 ? 'Profit' : 'Loss'} value={fmtMoney(p.result)} tone={n(p.result) >= 0 ? 'good' : 'bad'} />
                </div>
                {p.warnings.length > 0 && (
                  <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {p.warnings.map((w) => (
                      <li key={w} className="flex gap-2">
                        <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                <Card
                  title={p.period.isClosed ? `${p.period.name} is closed` : `Closing entry for ${p.period.name}`}
                  subtitle={
                    p.period.isClosed
                      ? `Closed ${p.period.closedAt ? fmtDateTime(p.period.closedAt) : ''}${periods.find((x) => x.id === p.period.id)?.closedBy ? ` by ${periods.find((x) => x.id === p.period.id)?.closedBy}` : ''}`
                      : `Every income and expense account is zeroed on ${fmtDate(p.period.endDate)}; the difference goes to ${p.retainedEarnings ? `${p.retainedEarnings.code} ${p.retainedEarnings.name}` : 'retained earnings'}.`
                  }
                  actions={
                    p.period.isClosed ? (
                      <Button variant="outline" icon="rotate-ccw" onClick={() => act('reopen')} loading={busy} disabled={!p.canReopen}>
                        Reopen year
                      </Button>
                    ) : (
                      <Button icon="lock" onClick={() => act('close')} loading={busy} disabled={!p.canClose}>
                        Close year
                      </Button>
                    )
                  }
                  bodyClass="p-0"
                >
                  {p.accounts.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-400">No income or expense was posted in this year. Closing only locks it.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-4 py-2">Account</th>
                            <th className="px-4 py-2 text-right">Balance</th>
                            <th className="px-4 py-2 text-right">Closing debit</th>
                            <th className="px-4 py-2 text-right">Closing credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.accounts.map((a) => {
                            // income has a credit balance -> debited to zero it; expense the other way round
                            const debit = a.type === 'INCOME' ? n(a.amount) : -n(a.amount);
                            return (
                              <tr key={a.id} className="border-t border-line">
                                <td className="px-4 py-2">
                                  <span className="font-mono text-xs text-slate-500">{a.code}</span> {a.name}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(a.amount)}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{debit > 0 ? fmtMoney(debit) : ''}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{debit < 0 ? fmtMoney(-debit) : ''}</td>
                              </tr>
                            );
                          })}
                          <tr className="border-t-2 border-line bg-slate-50 font-medium">
                            <td className="px-4 py-2">{p.retainedEarnings ? `${p.retainedEarnings.code} ${p.retainedEarnings.name}` : 'Retained earnings'}</td>
                            <td />
                            <td className="px-4 py-2 text-right tabular-nums">{n(p.result) < 0 ? fmtMoney(-n(p.result)) : ''}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{n(p.result) > 0 ? fmtMoney(p.result) : ''}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                {p.period.closingJournalId && (
                  <p className="text-sm text-slate-500">
                    Closing journal: <Link className="font-medium text-brand-700 hover:underline" to={`/accounting/journals/${p.period.closingJournalId}`}>{periods.find((x) => x.id === p.period.id)?.closingJournal?.number ?? 'open'}</Link>. The Profit &amp; Loss report ignores it, so it keeps showing this year&apos;s real result.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
    </div>
  );
}
