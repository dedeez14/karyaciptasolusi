import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, cn, Icon } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { money, Muted } from '../shared';

interface BankStat {
  balance: number;
  inflow30: number;
  outflow30: number;
  recent: { date: string; number: string; description: string | null; amount: number }[];
}

/** Cash & bank accounts as cards with live ledger balance and latest movements */
export function BankCardsView({ rows, open }: ResourceViewProps) {
  const can = useSession((s) => s.can);
  const ids = rows.map((r) => r.id).join(',');
  const q = useQuery({ queryKey: ['insights', 'banks', ids], queryFn: () => api.get<{ balances: boolean; items: Record<string, BankStat> }>('/insights/bank-accounts', { ids }), enabled: !!ids });
  const total = Object.values(q.data?.items ?? {}).reduce((a, s) => a + s.balance, 0);

  return (
    <div>
      {q.data?.balances && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-brand-600 px-5 py-4 text-white shadow-card">
          <div>
            <p className="text-xs font-medium text-white/80">Total cash & bank</p>
            <p className="text-2xl font-semibold tabular-nums">{money(total)}</p>
          </div>
          <p className="text-xs text-white/80">{rows.length} accounts · ledger balances of posted journals</p>
          {can('accounting.cash.read') && (
            <Link to="/accounting/cash" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25">
              <Icon name="arrow-left-right" className="h-4 w-4" />
              Cash & bank transactions
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const s = q.data?.items[r.id];
          return (
            <button key={r.id} type="button" onClick={() => open(r)} className={cn('card flex flex-col p-4 text-left transition-shadow hover:shadow-pop', !r.isActive && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className={cn('rounded-xl p-2.5', r.isCash ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600')}>
                  <Icon name={r.isCash ? 'wallet' : 'landmark'} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{r.name}</p>
                  <p className="truncate text-xs text-slate-500">{r.isCash ? 'Cash account' : [r._labels?.bankId, r.accountNumber].filter(Boolean).join(' · ') || 'Bank account'}</p>
                </div>
                <Badge>{r.currencyCode}</Badge>
              </div>
              {s ? (
                <>
                  <p className={cn('mt-4 text-2xl font-semibold tabular-nums', s.balance < 0 ? 'text-red-600' : 'text-slate-900')}>{money(s.balance)}</p>
                  <div className="mt-1 flex gap-4 text-xs">
                    <span className="text-emerald-600">▲ {money(s.inflow30)}</span>
                    <span className="text-red-500">▼ {money(s.outflow30)}</span>
                    <span className="text-slate-400">last 30 days</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                    {s.recent.length === 0 && <li className="text-xs text-slate-400">No postings yet</li>}
                    {s.recent.map((x, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-16 shrink-0 text-slate-400">{fmtDate(x.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-600" title={x.description ?? x.number}>
                          {x.description || x.number}
                        </span>
                        <span className={cn('tabular-nums', x.amount < 0 ? 'text-red-600' : 'text-emerald-700')}>{money(x.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-4 text-xs text-slate-400">{q.isLoading ? 'Loading balance…' : (r._labels?.accountId ?? 'No ledger account')}</p>
              )}
            </button>
          );
        })}
      </div>
      {!rows.length && <Muted>No accounts</Muted>}
    </div>
  );
}
