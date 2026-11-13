import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { fmtCompact, fmtDate, fmtMoney } from '@/lib/format';
import { themeColor } from '@/lib/theme';
import { Badge, Card, EmptyState, Icon, PageHeader, Select, Spinner } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { Kpi } from '@/features/insights/shared';

interface Item {
  date: string;
  kind: 'RECEIVABLE' | 'MILESTONE' | 'SUBSCRIPTION' | 'PAYABLE' | 'PAYROLL';
  label: string;
  amount: number;
  overdue?: boolean;
  link?: string;
}
interface Forecast {
  asOf: string;
  opening: number;
  accounts: { name: string; balance: number }[];
  weeks: { start: string; end: string; inflow: number; outflow: number; net: number; balance: number; items: number }[];
  lowest: { week: string; balance: number } | null;
  firstNegative: { week: string; balance: number } | null;
  totals: { inflow: number; outflow: number; overdueIn: number; overdueOut: number };
  items: Item[];
}

const KIND: Record<Item['kind'], { label: string; icon: string; tone: 'green' | 'blue' | 'violet' | 'red' | 'amber' }> = {
  RECEIVABLE: { label: 'Customer invoice', icon: 'receipt', tone: 'green' },
  MILESTONE: { label: 'Milestone to invoice', icon: 'list-ordered', tone: 'blue' },
  SUBSCRIPTION: { label: 'Recurring billing', icon: 'repeat', tone: 'violet' },
  PAYABLE: { label: 'Supplier bill', icon: 'file-minus', tone: 'red' },
  PAYROLL: { label: 'Salaries', icon: 'wallet', tone: 'amber' },
};

/** Director > Cash flow forecast: weekly cash in, cash out and the expected balance for the next weeks */
export default function CashflowPage() {
  const [weeks, setWeeks] = useState('13');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['director', 'cashflow', weeks], queryFn: () => api.get<Forecast>('/director/cashflow', { weeks }) });
  const f = q.data;
  const brand = themeColor('brand');
  const accent = themeColor('accent');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash Flow Forecast"
        subtitle="Expected cash in and out per week, from open invoices and bills, project milestones, recurring billing and payroll"
        actions={
          <div className="w-44">
            <Select value={weeks} onChange={(e) => setWeeks(e.target.value)} aria-label="Horizon" options={[{ value: '8', label: 'Next 8 weeks' }, { value: '13', label: 'Next 13 weeks' }, { value: '26', label: 'Next 26 weeks' }]} />
          </div>
        }
      />
      {q.isLoading || !f ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : (
        <>
          {f.firstNegative ? (
            <div className="flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
              <Icon name="triangle-alert" className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                Cash is expected to fall below zero in the week of <strong>{fmtDate(f.firstNegative.week)}</strong> ({fmtMoney(f.firstNegative.balance)}). Collect overdue invoices, invoice the next milestones or move bills.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Icon name="badge-check" className="h-5 w-5 shrink-0" />
              <span>Cash stays positive for the whole period{f.lowest ? `; the lowest expected balance is ${fmtMoney(f.lowest.balance)} in the week of ${fmtDate(f.lowest.week)}` : ''}.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon="landmark" label="Cash & bank today" value={fmtMoney(f.opening)} hint={`${f.accounts.length} account${f.accounts.length === 1 ? '' : 's'}`} />
            <Kpi icon="arrow-down-left" tone="green" label="Expected in" value={fmtMoney(f.totals.inflow)} hint={f.totals.overdueIn > 0 ? `${fmtMoney(f.totals.overdueIn)} already late` : undefined} />
            <Kpi icon="arrow-up-right" tone="red" label="Expected out" value={fmtMoney(f.totals.outflow)} hint={f.totals.overdueOut > 0 ? `${fmtMoney(f.totals.overdueOut)} already late` : undefined} />
            <Kpi icon="trending-down" tone={f.lowest && f.lowest.balance < 0 ? 'red' : 'amber'} label="Lowest balance" value={f.lowest ? fmtMoney(f.lowest.balance) : '—'} hint={f.lowest ? `week of ${fmtDate(f.lowest.week)}` : undefined} />
          </div>

          <Card title="Weekly cash flow" bodyClass="pt-2">
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={f.weeks.map((w) => ({ ...w, label: fmtDate(w.start).replace(/ \d{4}$/, ''), out: -w.outflow }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip formatter={(v: number, n: string) => [fmtMoney(Math.abs(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey="inflow" name="In" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="out" name="Out" fill="#f87171" radius={[0, 0, 4, 4]} />
                  <Line type="monotone" dataKey="balance" name="Balance" stroke={brand} strokeWidth={2.5} dot={{ r: 2.5, fill: accent, stroke: brand }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Week by week" subtitle="Click a week to see what is expected" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Week</th>
                    <th className="px-3 py-2.5 text-right font-semibold">In</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Out</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Net</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {f.weeks.map((w) => {
                    const items = f.items.filter((x) => x.date >= w.start && x.date <= w.end);
                    const isOpen = open === w.start;
                    return (
                      <Fragment key={w.start}>
                        <tr onClick={() => setOpen(isOpen ? null : w.start)} className={cn('cursor-pointer border-t border-line hover:bg-slate-50', isOpen && 'bg-brand-50/40')}>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                            {fmtDate(w.start)} – {fmtDate(w.end)}
                            {!!items.length && <span className="ml-2 text-xs text-slate-400">{items.length}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-emerald-700 tabular-nums">{w.inflow ? fmtMoney(w.inflow) : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-red-600 tabular-nums">{w.outflow ? fmtMoney(w.outflow) : '—'}</td>
                          <td className={cn('px-3 py-2.5 text-right tabular-nums', w.net < 0 ? 'text-red-600' : 'text-slate-700')}>{fmtMoney(w.net)}</td>
                          <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums', w.balance < 0 ? 'text-red-600' : 'text-slate-900')}>{fmtMoney(w.balance)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={5} className="px-4 py-2">
                              {items.length ? (
                                <ul className="divide-y divide-line">
                                  {items.map((x, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                                      <Badge tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Badge>
                                      {x.overdue && <Badge tone="red">Late</Badge>}
                                      <span className="min-w-0 flex-1 truncate">{x.link ? <Link to={x.link} className="link">{x.label}</Link> : x.label}</span>
                                      <span className="text-xs text-slate-500">{fmtDate(x.date)}</span>
                                      <span className={cn('w-36 text-right font-medium tabular-nums', x.amount < 0 ? 'text-red-600' : 'text-emerald-700')}>{fmtMoney(x.amount)}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="py-2 text-xs text-slate-500">Nothing expected this week.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {!f.items.length && <EmptyState icon="chart-spline" title="Nothing to forecast yet" description="Open invoices, bills, milestones, recurring billing and payroll appear here." />}
          <p className="text-xs text-slate-500">
            A forecast, not a promise: customer payments are expected on their due date (late ones in the first week), salaries repeat the last payroll. Tax and other spending that is not recorded as a bill is not included.
          </p>
        </>
      )}
    </div>
  );
}
