import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Card, EmptyState, Icon, PageHeader, Select, Spinner } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

export interface Obligation {
  date: string;
  kind: 'TAX' | 'BPJS' | 'CONTRACT' | 'RECEIVABLE' | 'PAYABLE' | 'MILESTONE' | 'SUBSCRIPTION';
  title: string;
  detail?: string;
  amount?: number;
  link?: string;
  urgency: 'OVERDUE' | 'SOON' | 'LATER';
}
export interface Obligations {
  asOf: string;
  until: string;
  counts: { overdue: number; soon: number; total: number };
  items: Obligation[];
}

export const KIND: Record<Obligation['kind'], { label: string; icon: string; tone: 'red' | 'amber' | 'blue' | 'green' | 'violet' | 'gray' }> = {
  TAX: { label: 'Tax', icon: 'landmark', tone: 'violet' },
  BPJS: { label: 'BPJS', icon: 'shield-plus', tone: 'blue' },
  CONTRACT: { label: 'Employee contract', icon: 'file-signature', tone: 'amber' },
  RECEIVABLE: { label: 'To collect', icon: 'arrow-down-left', tone: 'green' },
  PAYABLE: { label: 'To pay', icon: 'arrow-up-right', tone: 'red' },
  MILESTONE: { label: 'Milestone', icon: 'list-ordered', tone: 'blue' },
  SUBSCRIPTION: { label: 'Recurring billing', icon: 'repeat', tone: 'gray' },
};

const dayLabel = (iso: string, today: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  const text = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { text, rel: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 0 ? `${-diff} days late` : `in ${diff} days` };
};

/** One obligation row (shared with the dashboard widget) */
export function ObligationRow({ o, compact }: { o: Obligation; compact?: boolean }) {
  const k = KIND[o.kind];
  const body = (
    <>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', o.urgency === 'OVERDUE' ? 'bg-red-50 text-red-600' : o.urgency === 'SOON' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500')}>
        <Icon name={k.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{o.title}</span>
        {!compact && o.detail && <span className="block text-xs text-slate-500">{o.detail}</span>}
        {compact && <span className="block text-xs text-slate-500">{new Date(`${o.date}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>}
      </span>
      {o.amount !== undefined && o.amount > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{fmtMoney(o.amount)}</span>}
      {!compact && <Badge tone={k.tone}>{k.label}</Badge>}
    </>
  );
  return o.link ? (
    <Link to={o.link} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-2 py-2">{body}</div>
  );
}

/** Director > Obligations calendar: what has to be paid, filed, collected or decided, day by day */
export default function ObligationsPage() {
  const { can } = useSession();
  const [days, setDays] = useState('60');
  const [kind, setKind] = useState('');
  const q = useQuery({ queryKey: ['director', 'obligations', days], queryFn: () => api.get<Obligations>('/director/obligations', { days }) });
  const data = q.data;
  const items = useMemo(() => (data?.items ?? []).filter((o) => !kind || o.kind === kind), [data, kind]);
  const byDate = useMemo(() => {
    const m = new Map<string, Obligation[]>();
    for (const o of items) m.set(o.date, [...(m.get(o.date) ?? []), o]);
    return [...m.entries()];
  }, [items]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Obligations Calendar"
        subtitle="Tax and BPJS deadlines, employee contracts, invoices to collect, bills to pay and milestones to invoice"
        actions={
          <div className="flex gap-2">
            <div className="w-44">
              <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type" placeholder="All types" options={Object.entries(KIND).map(([value, k]) => ({ value, label: k.label }))} />
            </div>
            <div className="w-40">
              <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period" options={[{ value: '30', label: 'Next 30 days' }, { value: '60', label: 'Next 60 days' }, { value: '120', label: 'Next 120 days' }]} />
            </div>
          </div>
        }
      />
      {q.isLoading || !data ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Late', value: data.counts.overdue, tone: 'bg-red-50 text-red-700', icon: 'alarm-clock-off' },
              { label: 'Within 7 days', value: data.counts.soon, tone: 'bg-amber-50 text-amber-700', icon: 'alarm-clock' },
              { label: 'In this period', value: data.counts.total, tone: 'bg-slate-50 text-slate-700', icon: 'calendar-clock' },
            ].map((c) => (
              <div key={c.label} className={cn('flex items-center gap-3 rounded-xl px-4 py-3', c.tone)}>
                <Icon name={c.icon} className="h-5 w-5 shrink-0" />
                <span>
                  <span className="block text-xl font-semibold tabular-nums">{c.value}</span>
                  <span className="text-xs">{c.label}</span>
                </span>
              </div>
            ))}
          </div>

          {byDate.length ? (
            <div className="space-y-3">
              {byDate.map(([date, list]) => {
                const l = dayLabel(date, data.asOf);
                const late = list[0].urgency === 'OVERDUE';
                return (
                  <Card key={date} bodyClass="p-2">
                    <div className="flex items-baseline justify-between gap-2 px-2 pt-1 pb-2">
                      <span className="text-sm font-semibold text-slate-800 capitalize">{l.text}</span>
                      <span className={cn('text-xs font-medium', late ? 'text-red-600' : list[0].urgency === 'SOON' ? 'text-amber-600' : 'text-slate-400')}>{l.rel}</span>
                    </div>
                    <div className="divide-y divide-line">
                      {list.map((o, i) => (
                        <ObligationRow key={i} o={o} />
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="calendar-check" title="Nothing due in this period" />
          )}
          <p className="text-xs text-slate-500">
            Tax and BPJS reminders follow the usual deadlines (payment by the 15th, filing by the 20th, BPJS Kesehatan by the 10th) and can be switched off in{' '}
            {can('system.setting.read') ? (
              <Link to="/system/settings?tab=obligations" className="link">
                Settings &gt; Obligations
              </Link>
            ) : (
              'Settings > Obligations'
            )}
            . Check the exact amounts and dates with your tax consultant; a deadline on a weekend or holiday moves to the next working day.
          </p>
        </>
      )}
    </div>
  );
}
