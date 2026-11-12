import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, Icon, Spinner, toast } from '@/components/ui';
import { useLookups } from '@/features/resources/FieldInput';

interface Attendance {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  statusCode: string | null;
}
interface MyAttendance {
  employee: { id: string; code: string; fullName: string } | null;
  today: Attendance | null;
  recent: Attendance[];
  workStartTime?: string;
}

const hhmm = (v: string | null) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '--:--');
const duration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** Self-service check-in / check-out with a live working-time counter */
export function MyAttendanceCard() {
  const qc = useQueryClient();
  const statuses = useLookups(['ATTENDANCE_STATUS']).ATTENDANCE_STATUS ?? [];
  const q = useQuery({ queryKey: ['my-attendance'], queryFn: () => api.get<MyAttendance>('/hris/my-attendance') });
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const act = async (kind: 'check-in' | 'check-out') => {
    setBusy(true);
    try {
      await api.post(`/hris/my-attendance/${kind}`);
      toast.success(kind === 'check-in' ? 'Checked in. Have a productive day!' : 'Checked out. See you tomorrow!');
      qc.invalidateQueries({ queryKey: ['my-attendance'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const d = q.data;
  const t = d?.today;
  const status = statuses.find((s) => s.value === t?.statusCode);
  const worked = t?.checkIn ? (t.checkOut ? new Date(t.checkOut).getTime() : now) - new Date(t.checkIn).getTime() : 0;

  return (
    <Card title="My attendance" subtitle={d?.workStartTime ? `Work starts at ${d.workStartTime}` : undefined} actions={status && <Badge color={status.color}>{status.label}</Badge>}>
      {q.isLoading ? (
        <Spinner className="h-5 w-5 text-brand-600" />
      ) : !d?.employee ? (
        <p className="text-sm text-slate-500">Your account is not linked to an employee record.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
            <div className="rounded-xl bg-slate-50 px-2 py-3 sm:p-3">
              <p className="text-xs text-slate-500">Check in</p>
              <p className="mt-1 text-base font-semibold whitespace-nowrap tabular-nums text-slate-900 sm:text-lg">{hhmm(t?.checkIn ?? null)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-2 py-3 sm:p-3">
              <p className="text-xs text-slate-500">Check out</p>
              <p className="mt-1 text-base font-semibold whitespace-nowrap tabular-nums text-slate-900 sm:text-lg">{hhmm(t?.checkOut ?? null)}</p>
            </div>
            <div className="rounded-xl bg-brand-50 px-2 py-3 sm:p-3">
              <p className="text-xs text-brand-700">Worked</p>
              <p className="mt-1 text-base font-semibold whitespace-nowrap tabular-nums text-brand-800 sm:text-lg">{t?.checkIn ? duration(worked) : '—'}</p>
            </div>
          </div>
          {!t?.checkIn ? (
            <Button className="w-full" icon="log-in" loading={busy} onClick={() => act('check-in')}>
              Check in now
            </Button>
          ) : !t.checkOut ? (
            <Button className="w-full" variant="outline" icon="log-out" loading={busy} onClick={() => act('check-out')}>
              Check out
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700">
              <Icon name="circle-check" className="h-4 w-4" /> Day completed
            </p>
          )}
          {d.recent.length > 1 && (
            <ul className="space-y-1.5 border-t border-line pt-3 text-xs">
              {d.recent.slice(1, 5).map((r) => {
                const s = statuses.find((x) => x.value === r.statusCode);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-slate-600">
                    <span>{fmtDate(r.date)}</span>
                    <span className="tabular-nums">
                      {hhmm(r.checkIn)} – {hhmm(r.checkOut)}
                    </span>
                    {s ? <Badge color={s.color}>{s.label}</Badge> : <span />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/** Personal task counters with a shortcut to My Tasks */
export function MyTasksCard() {
  const q = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get<{ open: number; overdue: number; dueToday: number; doneWeek: number }>('/tasks/summary') });
  const s = q.data;
  const items = [
    { label: 'Open', value: s?.open, icon: 'list-todo', cls: 'text-brand-700 bg-brand-50' },
    { label: 'Overdue', value: s?.overdue, icon: 'alarm-clock', cls: 'text-red-700 bg-red-50' },
    { label: 'Due today', value: s?.dueToday, icon: 'sun', cls: 'text-amber-700 bg-amber-50' },
    { label: 'Done (7 days)', value: s?.doneWeek, icon: 'circle-check', cls: 'text-emerald-700 bg-emerald-50' },
  ];
  return (
    <Card
      title="My tasks"
      actions={
        <Link to="/tasks/my" className="text-xs font-medium text-brand-700 hover:underline">
          Open My Tasks
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {items.map((i) => (
          <Link key={i.label} to="/tasks/my" className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-brand-200 hover:bg-slate-50">
            <span className={`rounded-lg p-2 ${i.cls}`}>
              <Icon name={i.icon} className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-lg font-semibold tabular-nums text-slate-900">{i.value ?? '—'}</span>
              <span className="block text-xs text-slate-500">{i.label}</span>
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** Row of personal widgets shown on the dashboard when relevant for the user */
export function PersonalWidgets() {
  const { me, can } = useSession();
  const showAttendance = !!me?.employeeId;
  const showTasks = can('task.task.read');
  if (!showAttendance && !showTasks) return null;
  return (
    <div className={`grid gap-5 ${showAttendance && showTasks ? 'lg:grid-cols-2' : ''}`}>
      {showAttendance && <MyAttendanceCard />}
      {showTasks && <MyTasksCard />}
    </div>
  );
}
