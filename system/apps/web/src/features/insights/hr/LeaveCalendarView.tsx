import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, getLocale } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, cn, confirm, Icon, StatusBadge, toast } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { Avatar, Loading } from '../shared';

interface Item {
  id: string;
  employeeId: string;
  employee: string;
  employeeCode: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: 'PENDING' | 'APPROVED';
  reason: string | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const shift = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);
};

/** Who is off when: month timeline of leave requests with inline approval */
export function LeaveCalendarView({ open }: ResourceViewProps) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['insights', 'leave', month], queryFn: () => api.get<{ items: Item[] }>('/insights/leave/calendar', { month }) });
  const items = q.data?.items ?? [];

  const { days, rows } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const ds = Array.from({ length: count }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1, i + 1));
      return { iso: d.toISOString().slice(0, 10), day: i + 1, weekend: [0, 6].includes(d.getUTCDay()) };
    });
    const per = new Map<string, { id: string; name: string; code: string; items: Item[] }>();
    for (const it of items) {
      const e = per.get(it.employeeId) ?? { id: it.employeeId, name: it.employee, code: it.employeeCode, items: [] };
      e.items.push(it);
      per.set(it.employeeId, e);
    }
    return { days: ds, rows: [...per.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }, [month, items]);

  const today = new Date().toISOString().slice(0, 10);
  const offToday = items.filter((i) => i.status === 'APPROVED' && i.startDate.slice(0, 10) <= today && i.endDate.slice(0, 10) >= today);
  const pending = items.filter((i) => i.status === 'PENDING');

  const decide = async (it: Item, decision: 'approve' | 'reject') => {
    if (
      decision === 'reject' &&
      !(await confirm({ title: 'Reject leave request?', message: `${it.employee} · ${it.leaveType} · ${fmtDate(it.startDate)} – ${fmtDate(it.endDate)}`, confirmText: 'Reject', danger: true }))
    )
      return;
    setBusy(it.id + decision);
    try {
      await api.post(`/hris/leave-requests/${it.id}/${decision}`);
      toast.success(decision === 'approve' ? 'Leave approved' : 'Leave rejected');
      qc.invalidateQueries({ queryKey: ['insights', 'leave'] });
      qc.invalidateQueries({ queryKey: ['resource', 'leave-requests'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-xl border border-line bg-white">
          <Button size="icon" variant="ghost" icon="chevron-left" aria-label="Previous month" onClick={() => setMonth(shift(month, -1))} />
          <span className="w-36 text-center text-sm font-semibold">{label}</span>
          <Button size="icon" variant="ghost" icon="chevron-right" aria-label="Next month" onClick={() => setMonth(shift(month, 1))} />
        </div>
        {month !== thisMonth() && (
          <Button size="sm" variant="ghost" onClick={() => setMonth(thisMonth())}>
            Today
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded bg-emerald-500" /> Approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded border border-dashed border-amber-500 bg-amber-200" /> Pending
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
            <Icon name="plane" className="h-3.5 w-3.5" /> Off today ({offToday.length})
          </p>
          {offToday.length ? (
            <div className="flex flex-wrap gap-2">
              {offToday.map((i) => (
                <Link key={i.id} to={`/employees/${i.employeeId}`} className="flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pr-2.5 pl-0.5 text-xs text-slate-700 hover:bg-slate-100">
                  <Avatar name={i.employee} size="sm" />
                  {i.employee}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Everyone is in.</p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase">
            <Icon name="hourglass" className="h-3.5 w-3.5" /> Waiting for approval ({pending.length})
          </p>
          {pending.length ? (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-medium text-slate-800">{i.employee}</b>{' '}
                    <span className="text-slate-500">
                      · {i.leaveType} · {fmtDate(i.startDate)} – {fmtDate(i.endDate)} ({i.days}d)
                    </span>
                  </span>
                  {can('hris.leave.approve') && (
                    <>
                      <Button size="sm" variant="outline" icon="check" loading={busy === i.id + 'approve'} onClick={() => decide(i, 'approve')} aria-label="Approve" />
                      <Button size="sm" variant="ghost" icon="x" loading={busy === i.id + 'reject'} onClick={() => decide(i, 'reject')} aria-label="Reject" />
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Nothing pending.</p>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <p className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-slate-400">No leave in {label}.</p>
      ) : (
        <div className="scrollbar-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[900px] border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 w-48 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">Employee</th>
                {days.map((d) => (
                  <th key={d.iso} className={cn('w-7 py-2 text-center font-medium', d.weekend ? 'text-slate-300' : 'text-slate-500', d.iso === today && 'text-brand-700')}>
                    {d.day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                    <Link to={`/employees/${e.id}`} className="flex items-center gap-2 hover:text-brand-700">
                      <Avatar name={e.name} size="sm" />
                      <span className="truncate font-medium text-slate-800">{e.name}</span>
                    </Link>
                  </td>
                  {days.map((d) => {
                    const it = e.items.find((x) => x.startDate.slice(0, 10) <= d.iso && x.endDate.slice(0, 10) >= d.iso);
                    const start = it && it.startDate.slice(0, 10) === d.iso;
                    const end = it && it.endDate.slice(0, 10) === d.iso;
                    return (
                      <td key={d.iso} className={cn('h-9 p-0', d.weekend && 'bg-slate-50/80', d.iso === today && 'bg-brand-50/60')}>
                        {it && (
                          <button
                            type="button"
                            title={`${it.leaveType} · ${fmtDate(it.startDate)} – ${fmtDate(it.endDate)} · ${it.status}${it.reason ? `\n${it.reason}` : ''}`}
                            onClick={() => open({ id: it.id, status: it.status } as never)}
                            className={cn(
                              'block h-5 w-full',
                              it.status === 'APPROVED' ? 'bg-emerald-500 hover:bg-emerald-600' : 'border-y border-dashed border-amber-500 bg-amber-200 hover:bg-amber-300',
                              start && 'ml-0.5 rounded-l-md',
                              end && 'rounded-r-md',
                            )}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {[...new Set(items.map((i) => i.leaveType))].map((t) => (
          <Badge key={t}>
            {t}: {items.filter((i) => i.leaveType === t).reduce((a, i) => a + i.days, 0)} days
          </Badge>
        ))}
        {pending.length > 0 && <StatusBadge status="PENDING" label={`${pending.length} pending`} />}
      </div>
    </div>
  );
}
