import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, cn, Icon } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';

/** Fiscal periods as a year grid; closing / reopening goes through Accounting > Year-end Closing */
export function FiscalYearView({ rows, open, refresh }: ResourceViewProps) {
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const years = useMemo(() => {
    const m = new Map<number, typeof rows>();
    for (const r of [...rows].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))) {
      const y = Number(String(r.startDate).slice(0, 4));
      m.set(y, [...(m.get(y) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);

  // closing a year = closing journal into retained earnings + lock: one flow, on the Year-end Closing page
  const toggle = (r: (typeof rows)[number]) => navigate(`/accounting/year-end?period=${r.id}`);


  return (
    <div className="space-y-6">
      {years.map(([year, list]) => {
        const closed = list.filter((r) => r.isClosed).length;
        return (
          <section key={year}>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{year}</h3>
              <span className="text-xs text-slate-500">
                {closed} of {list.length} closed
              </span>
              <div className="h-1.5 max-w-48 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-500" style={{ width: `${(closed / Math.max(1, list.length)) * 100}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {list.map((r) => {
                const current = String(r.startDate).slice(0, 10) <= today && today <= String(r.endDate).slice(0, 10);
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded-xl border p-3 transition-shadow hover:shadow-card',
                      r.isClosed ? 'border-line bg-slate-50' : 'border-emerald-200 bg-white',
                      current && 'ring-2 ring-brand-300',
                    )}
                  >
                    <button type="button" onClick={() => open(r)} className="block w-full text-left" disabled={!!r.isClosed}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{r.name}</p>
                        <Icon name={r.isClosed ? 'lock' : 'lock-open'} className={cn('h-4 w-4 shrink-0', r.isClosed ? 'text-slate-400' : 'text-emerald-500')} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                      </p>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {r.isClosed ? <Badge>Closed</Badge> : <Badge tone="green">Open</Badge>}
                      {current && <Badge tone="blue">Current</Badge>}
                    </div>
                    {can('accounting.closing.read') && (
                      <Button size="sm" variant={r.isClosed ? 'ghost' : 'outline'} className="mt-2 w-full" icon={r.isClosed ? 'rotate-ccw' : 'lock'} onClick={() => toggle(r)}>
                        {r.isClosed ? 'Reopen...' : 'Year-end close...'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
