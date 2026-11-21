import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, isoDate } from '@/lib/format';
import { AsyncSelect, Badge, Button, Card, DatePicker, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

interface ShiftRow {
  id: string;
  number: string;
  outlet: string;
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
interface RecapRow {
  date: string;
  receipts: number;
  discount: number;
  serviceCharge: number;
  dpp: number;
  ppn: number;
  pbjt: number;
  total: number;
}
interface PoolRow {
  outletId: string;
  outlet: string;
  toStaff: boolean;
  receipts: number;
  total: number;
  workers: number;
  lossAndDamage: number;
  staffDevelopment: number;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Point of Sale > Shifts & Daily Recap: shifts with cash differences, daily recap (SPT Masa PPN, PBJT), service charge pool, receipt export */
export default function PosShiftsPage() {
  const first = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(isoDate());
  const [outletId, setOutletId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const shifts = useQuery({ queryKey: ['pos', 'shifts'], queryFn: () => api.get<ShiftRow[]>('/pos/sessions') });
  const recap = useQuery({ queryKey: ['pos', 'recap', from, to, outletId], queryFn: () => api.get<RecapRow[]>('/pos/recap', { from, to, outletId: outletId ?? undefined }) });
  const pool = useQuery({ queryKey: ['pos', 'service-charge', from, to], queryFn: () => api.get<PoolRow[]>('/pos/service-charge', { from, to }) });
  const sum = (k: keyof Omit<RecapRow, 'date'>) => (recap.data ?? []).reduce((a, r) => a + r[k], 0);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await api.get<Record<string, unknown>[]>('/pos/export', { from, to, outletId: outletId ?? undefined });
      const cols = ['number', 'soldAt', 'outlet', 'orderType', 'status', 'discount', 'serviceCharge', 'dpp', 'ppn', 'pbjt', 'total', 'payment'];
      const text = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(c === 'soldAt' ? new Date(String(r[c])).toLocaleString('sv-SE') : r[c])).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `pos-receipts-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };
  const cols = ['Date', 'Receipts', 'Discounts', 'Service', 'DPP', 'PPN', 'PBJT', 'Total'];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Shifts & Daily Recap"
        subtitle="Cashier shifts with their cash differences; the daily recap (faktur pajak digunggung for the SPT Masa PPN, PBJT for the regional tax return); the service charge pool"
        actions={
          <Button variant="outline" icon="download" loading={exporting} onClick={exportCsv}>
            Export receipts (CSV)
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <div className="w-40">
          <DatePicker value={from} onChange={(v) => setFrom(v ?? first)} clearable={false} />
        </div>
        <div className="w-40">
          <DatePicker value={to} onChange={(v) => setTo(v ?? isoDate())} clearable={false} />
        </div>
        <div className="w-56">
          <AsyncSelect resource="pos-outlets" value={outletId} onChange={setOutletId} placeholder="All outlets" />
        </div>
      </div>
      <Card title="Daily recap" bodyClass="p-0">
        {recap.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !recap.data?.length ? (
          <EmptyState icon="receipt" title="No sales in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  {cols.map((c, i) => (
                    <th key={c} className={cn('px-3 py-2 font-semibold', i ? 'text-right' : 'pl-4 text-left')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recap.data.map((r) => (
                  <tr key={r.date} className="border-t border-line">
                    <td className="px-4 py-2">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.receipts}</td>
                    {(['discount', 'serviceCharge', 'dpp', 'ppn', 'pbjt'] as const).map((k) => (
                      <td key={k} className="px-3 py-2 text-right tabular-nums">
                        {fmtMoney(r[k], 0)}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{fmtMoney(r.total, 0)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sum('receipts')}</td>
                  {(['discount', 'serviceCharge', 'dpp', 'ppn', 'pbjt'] as const).map((k) => (
                    <td key={k} className="px-3 py-2 text-right tabular-nums">
                      {fmtMoney(sum(k), 0)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(sum('total'), 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {(pool.data?.length ?? 0) > 0 && (
        <Card title="Service charge" subtitle="Kept for the staff: shared 95% workers, 3% loss & damage, 2% staff development and announced monthly (Permenaker 7/2016); the workers' share is non-wage income for payroll (PPh 21)" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Outlet</th>
                <th className="px-3 py-2 text-right font-semibold">Receipts</th>
                <th className="px-3 py-2 text-right font-semibold">Collected</th>
                <th className="px-3 py-2 text-right font-semibold">Workers 95%</th>
                <th className="px-3 py-2 text-right font-semibold">Loss & damage 3%</th>
                <th className="px-4 py-2 text-right font-semibold">Development 2%</th>
              </tr>
            </thead>
            <tbody>
              {pool.data!.map((p) => (
                <tr key={p.outletId} className="border-t border-line">
                  <td className="px-4 py-2">
                    {p.outlet} {!p.toStaff && <Badge tone="gray">Income of the business</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.receipts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.total, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.toStaff ? fmtMoney(p.workers, 0) : '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.toStaff ? fmtMoney(p.lossAndDamage, 0) : '-'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.toStaff ? fmtMoney(p.staffDevelopment, 0) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
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
                      {s.outlet} · {s.cashier} · {fmtDateTime(s.openedAt)}
                      {s.closedAt ? ` – ${fmtDateTime(s.closedAt)}` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{fmtMoney(s.sales, 0)}</span>
                    <span className="block text-xs text-slate-500">{s.count} receipts</span>
                  </span>
                  {diff !== null && <span className={cn('w-36 text-right text-xs font-medium tabular-nums', Math.abs(diff) < 0.005 ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : 'text-amber-600')}>{Math.abs(diff) < 0.005 ? 'Cash matches' : `${diff < 0 ? 'Short' : 'Over'} ${fmtMoney(Math.abs(diff), 0)}`}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
