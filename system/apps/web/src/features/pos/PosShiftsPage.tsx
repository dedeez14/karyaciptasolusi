import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, isoDate } from '@/lib/format';
import { Badge, Card, DatePicker, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

interface ShiftRow {
  id: string;
  number: string;
  cashier: string;
  openedAt: string;
  closedAt: string | null;
  status: 'OPEN' | 'CLOSED';
  openingCash: string;
  expectedCash: string;
  countedCash: string | null;
  sales: number;
  count: number;
}

/** Point of Sale > Shifts & Daily Recap: cashier shifts with cash differences, and the daily recap for the SPT Masa PPN */
export default function PosShiftsPage() {
  const first = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(isoDate());
  const shifts = useQuery({ queryKey: ['pos', 'shifts'], queryFn: () => api.get<ShiftRow[]>('/pos/sessions') });
  const recap = useQuery({ queryKey: ['pos', 'recap', from, to], queryFn: () => api.get<{ date: string; receipts: number; dpp: number; ppn: number; pbjt: number; total: number }[]>('/pos/recap', { from, to }) });
  const sum = (k: 'receipts' | 'dpp' | 'ppn' | 'pbjt' | 'total') => (recap.data ?? []).reduce((a, r) => a + r[k], 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Shifts & Daily Recap" subtitle="Cashier shifts with their cash differences, and the daily sales recap (faktur pajak digunggung for the SPT Masa PPN; PBJT for the regional tax return)" />
      <Card title="Daily recap" actions={<div className="flex gap-2"><div className="w-40"><DatePicker value={from} onChange={setFrom} clearable={false} /></div><div className="w-40"><DatePicker value={to} onChange={setTo} clearable={false} /></div></div>} bodyClass="p-0">
        {recap.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !recap.data?.length ? (
          <EmptyState icon="receipt" title="No sales in this period" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Receipts</th>
                <th className="px-3 py-2 text-right font-semibold">DPP</th>
                <th className="px-3 py-2 text-right font-semibold">PPN</th>
                <th className="px-3 py-2 text-right font-semibold">PBJT</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {recap.data.map((r) => (
                <tr key={r.date} className="border-t border-line">
                  <td className="px-4 py-2">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.receipts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.dpp, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.ppn, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.pbjt, 0)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMoney(r.total, 0)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{sum('receipts')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sum('dpp'), 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sum('ppn'), 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(sum('pbjt'), 0)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(sum('total'), 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Shifts" bodyClass="p-0">
        {shifts.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !shifts.data?.length ? (
          <EmptyState icon="clock" title="No shifts yet" />
        ) : (
          <ul className="divide-y divide-line">
            {shifts.data.map((s) => {
              const diff = s.countedCash === null ? null : Number(s.countedCash) - Number(s.expectedCash);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.number}</span> <Badge tone={s.status === 'OPEN' ? 'amber' : 'gray'}>{s.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
                    <span className="block text-xs text-slate-500">
                      {s.cashier} · {fmtDateTime(s.openedAt)}
                      {s.closedAt ? ` – ${fmtDateTime(s.closedAt)}` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{fmtMoney(s.sales, 0)}</span>
                    <span className="block text-xs text-slate-500">{s.count} receipts</span>
                  </span>
                  {diff !== null && <span className={cn('w-36 text-right text-xs font-medium tabular-nums', diff === 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : 'text-amber-600')}>{diff === 0 ? 'Cash matches' : `${diff < 0 ? 'Short' : 'Over'} ${fmtMoney(Math.abs(diff), 0)}`}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
