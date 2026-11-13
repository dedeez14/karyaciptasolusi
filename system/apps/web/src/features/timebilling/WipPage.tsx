import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DatePicker, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { downloadCsv } from '@/features/compliance/common';

interface Wip {
  asOf: string;
  rows: { projectId: string; code: string; name: string; customer: string | null; hours: number; amount: number; noRateHours: number; buckets: number[]; oldest: string }[];
  total: { hours: number; amount: number; buckets: number[] };
  accruals: { id: string; asOf: string; amount: number; hours: number; status: string }[];
}

const BUCKETS = ['0-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
/** last day of the previous month */
const lastMonthEnd = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0)).toISOString().slice(0, 10);
};

/** Work in progress: billable hours not invoiced yet, by project and age, and the month-end accrual of them */
export default function WipPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState(isoDate());
  const q = useQuery({ queryKey: ['time-billing', 'wip', asOf], queryFn: () => api.get<Wip>('/time-billing/wip', { asOf }) });
  const accrue = useMutation({
    mutationFn: (d: string) => api.post<Wip>('/time-billing/wip/accrue', { asOf: d }),
    onSuccess: () => (toast.success('Accrual posted, reversed on the 1st'), qc.invalidateQueries({ queryKey: ['time-billing'] })),
    onError: (e) => toast.error(e),
  });
  const voidIt = useMutation({
    mutationFn: (id: string) => api.post(`/time-billing/wip/accruals/${id}/void`),
    onSuccess: () => (toast.success('Accrual voided'), qc.invalidateQueries({ queryKey: ['time-billing'] })),
    onError: (e) => toast.error(e),
  });
  const d = q.data;
  const monthEnd = (() => {
    const x = new Date(asOf);
    return new Date(x.getTime() + 86_400_000).getUTCDate() === 1;
  })();
  const csv = () =>
    d &&
    downloadCsv(`unbilled-time-${asOf}.csv`, [
      ['Project', 'Name', 'Customer', 'Hours', 'Value', ...BUCKETS, 'Oldest hours', 'Hours without a rate'],
      ...d.rows.map((r) => [r.code, r.name, r.customer, r.hours, r.amount, ...r.buckets, r.oldest, r.noRateHours]),
    ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Unbilled Time (WIP)"
        subtitle="Billable hours not on an invoice yet, valued at each person's rate, by project and age; at month end they can be accrued as revenue (SAK EP: services by stage of completion) and reversed on the 1st"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <DatePicker value={asOf} clearable={false} onChange={(v) => setAsOf(v ?? isoDate())} aria-label="As of" />
            </div>
            <Button variant="outline" icon="download" disabled={!d?.rows.length} onClick={csv}>
              CSV
            </Button>
            {can('accounting.journal.post') && (
              <Button
                icon="book-check"
                loading={accrue.isPending}
                onClick={async () => {
                  const date = monthEnd ? asOf : lastMonthEnd();
                  if (
                    await confirm({
                      title: `Accrue the unbilled hours at ${fmtDate(date)}?`,
                      message: 'Dr Accrued Revenue / Cr Service Revenue on that day, reversed on the 1st of the next month.',
                      confirmText: 'Post accrual',
                    })
                  )
                    accrue.mutate(date);
                }}
              >
                Accrue {monthEnd ? fmtDate(asOf) : 'last month end'}
              </Button>
            )}
          </div>
        }
      />
      {q.isLoading || !d ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="card px-4 py-3">
              <div className="text-xs text-slate-500">Unbilled</div>
              <div className="mt-0.5 text-lg font-semibold">{fmtMoney(d.total.amount, 0)}</div>
              <div className="text-xs text-slate-500">{fmtNumber(d.total.hours)} h</div>
            </div>
            {BUCKETS.map((b, i) => (
              <div key={b} className="card px-4 py-3">
                <div className="text-xs text-slate-500">{b}</div>
                <div className={`mt-0.5 text-lg font-semibold ${i >= 2 && d.total.buckets[i] > 0 ? 'text-amber-600' : ''}`}>{fmtMoney(d.total.buckets[i], 0)}</div>
              </div>
            ))}
          </div>
          <Card bodyClass="p-0">
            {!d.rows.length ? (
              <EmptyState icon="check-circle-2" title="Every billable hour is invoiced" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Project</th>
                      <th className="px-2 py-2 text-right">Hours</th>
                      <th className="px-2 py-2 text-right">Value</th>
                      {BUCKETS.map((b) => (
                        <th key={b} className="px-2 py-2 text-right">
                          {b}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-left">Oldest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.rows.map((r) => (
                      <tr key={r.projectId}>
                        <td className="px-4 py-2">
                          <Link className="font-medium text-brand-600" to={`/projects/${r.projectId}#billing`}>
                            {r.code} · {r.name}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {r.customer ?? '-'}
                            {r.noRateHours ? <span className="text-red-600"> · {fmtNumber(r.noRateHours)} h without a rate</span> : null}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">{fmtNumber(r.hours)}</td>
                        <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.amount, 0)}</td>
                        {r.buckets.map((v, i) => (
                          <td key={i} className={`px-2 py-2 text-right ${i >= 2 && v > 0 ? 'text-amber-600' : ''}`}>
                            {v ? fmtNumber(v, 0) : '-'}
                          </td>
                        ))}
                        <td className="px-4 py-2">{fmtDate(r.oldest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Month-end accruals" bodyClass="p-0">
            {!d.accruals.length ? (
              <p className="px-4 py-4 text-sm text-slate-500">No accruals yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.accruals.map((a) => (
                  <li key={a.id} className={`flex items-center gap-2 px-4 py-2.5 text-sm ${a.status === 'VOID' ? 'text-slate-400 line-through' : ''}`}>
                    <span className="min-w-0 flex-1">
                      {fmtDate(a.asOf)} · {fmtNumber(a.hours)} h · {fmtMoney(a.amount, 0)}
                    </span>
                    <Badge tone={a.status === 'POSTED' ? 'green' : 'gray'}>{a.status === 'POSTED' ? 'Posted' : 'Void'}</Badge>
                    {a.status === 'POSTED' && can('accounting.journal.post') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        aria-label="Void accrual"
                        onClick={async () => (await confirm({ title: 'Void this accrual and its reversal?', danger: true, confirmText: 'Void' })) && voidIt.mutate(a.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
