import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, getLocale } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { Badge, Button, Card, cn, Icon, previewFile, StatusBadge, toast } from '@/components/ui';
import type { Row } from '@/features/resources/types';
import { Avatar, DetailShell, InfoGrid, Kpi, Loading, LookupBadge, MiniTable, money, Muted, Progress, TabBar, useHashTab } from '../shared';

interface Profile {
  month: string;
  attendance: { summary: Record<string, number>; days: { date: string; statusCode: string | null; checkIn: string | null; checkOut: string | null }[] } | null;
  leave: {
    year: number;
    balance: { leaveTypeId: string; name: string; entitlement: number; used: number; remaining: number | null }[];
    requests: { id: string; leaveType: string; startDate: string; endDate: string; days: number; status: string; reason: string | null }[];
  } | null;
  payslips: { id: string; runId: string; number: string; periodStart: string; periodEnd: string; payDate: string; status: string; netPay: number; earnings: number; deductions: number }[] | null;
  tasks: { id: string; code: string; title: string; dueDate: string | null; priorityCode: string | null; stage: { name: string; color: string | null } | null }[] | null;
  assets: { id: string; code: string; name: string; categoryCode: string | null; statusCode: string; acquisitionDate: string; cost: number }[] | null;
  expenses: { id: string; number: string; date: string; title: string; statusCode: string; totalAmount: number }[] | null;
  team: { id: string; code: string; fullName: string; position: string | null }[];
  manager: { id: string; fullName: string } | null;
}

const TABS = ['overview', 'attendance', 'leave', 'payslips', 'work'] as const;
type Tab = (typeof TABS)[number];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + d, 1));
  return x.toISOString().slice(0, 7);
};

/** Employee 360°: profile, attendance, leave, payslips, tasks, assets and expense claims */
export default function EmployeeProfilePage() {
  const { id = '' } = useParams();
  return (
    <DetailShell
      resource="employees"
      id={id}
      backTo="/r/employees"
      avatar={(r) => <Avatar name={r.fullName} size="xl" />}
      title={(r) => r.fullName}
      badges={(r) => (
        <>
          <span className="font-mono text-xs text-slate-400">{r.code}</span>
          {r._labels?.positionId && <Badge tone="blue">{r._labels.positionId}</Badge>}
          {r._labels?.departmentId && <Badge tone="violet">{r._labels.departmentId}</Badge>}
          {r.isActive === false ? <Badge tone="red">Inactive</Badge> : <Badge tone="green">Active</Badge>}
        </>
      )}
    >
      {(r) => <Body r={r} id={id} />}
    </DetailShell>
  );
}

function Body({ r, id }: { r: Row; id: string }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useHashTab<Tab>(TABS, 'overview');
  const q = useQuery({ queryKey: ['insights', 'employee', id, month], queryFn: () => api.get<Profile>(`/insights/employees/${id}`, { month }) });
  const att = useLookupOptions('ATTENDANCE_STATUS');
  const exp = useLookupOptions('EXPENSE_STATUS');
  const ast = useLookupOptions('ASSET_STATUS');
  const pri = useLookupOptions('TASK_PRIORITY');
  const p = q.data;

  const presentDays = (p?.attendance?.summary.PRESENT ?? 0) + (p?.attendance?.summary.LATE ?? 0) + (p?.attendance?.summary.WFH ?? 0);
  const recorded = Object.values(p?.attendance?.summary ?? {}).reduce((a, b) => a + b, 0);
  // headline leave = annual leave (or the smallest yearly entitlement); summing every type (e.g. maternity) would mislead
  const mainLeave = p?.leave?.balance.find((b) => /annual|tahunan/i.test(b.name)) ?? p?.leave?.balance.filter((b) => b.entitlement > 0).sort((a, b) => a.entitlement - b.entitlement)[0];

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="calendar-check" label="Joined" value={r.joinDate ? fmtDate(r.joinDate) : '—'} hint={r._labels?.employmentCode ?? undefined} />
        <Kpi
          icon="clock"
          tone="green"
          label={`Attendance ${month}`}
          value={p?.attendance ? `${presentDays} days present` : '—'}
          hint={p?.attendance ? `${p.attendance.summary.LATE ?? 0} late · ${p.attendance.summary.ABSENT ?? 0} absent · ${recorded} recorded` : 'No access'}
        />
        <Kpi
          icon="palmtree"
          tone="violet"
          label={`${mainLeave?.name ?? 'Leave'} left ${p?.leave?.year ?? ''}`}
          value={mainLeave && mainLeave.remaining !== null ? `${mainLeave.remaining} of ${mainLeave.entitlement} days` : '—'}
          hint={p?.leave && p.leave.balance.length > 1 ? 'Other leave types in the Leave tab' : undefined}
        />
        <Kpi
          icon="list-checks"
          tone="amber"
          label="Open tasks"
          value={p?.tasks ? p.tasks.length : '—'}
          hint={p?.tasks?.some((t) => t.dueDate && t.dueDate < new Date().toISOString()) ? 'Some are overdue' : undefined}
        />
      </div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Profile' },
          { value: 'attendance', label: 'Attendance', hidden: p && !p.attendance },
          { value: 'leave', label: 'Leave', count: p?.leave?.requests.filter((x) => x.status === 'PENDING').length || null, hidden: p && !p.leave },
          { value: 'payslips', label: 'Payslips', count: p?.payslips?.length, hidden: p && !p.payslips },
          { value: 'work', label: 'Tasks, assets & claims' },
        ]}
      />
      {q.isLoading && tab !== 'overview' ? (
        <Loading />
      ) : tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Employment" className="lg:col-span-2">
            <InfoGrid
              items={[
                { label: 'Employee ID', value: r.code },
                { label: 'Employment type', value: r._labels?.employmentCode ?? r.employmentCode },
                { label: 'Department', value: r._labels?.departmentId ?? null },
                { label: 'Position', value: r._labels?.positionId ?? null },
                { label: 'Branch', value: r._labels?.branchId ?? null },
                {
                  label: 'Reports to',
                  value: p?.manager ? (
                    <Link className="text-brand-700 hover:underline" to={`/employees/${p.manager.id}`}>
                      {p.manager.fullName}
                    </Link>
                  ) : (
                    (r._labels?.managerId ?? null)
                  ),
                },
                { label: 'Join date', value: r.joinDate ? fmtDate(r.joinDate) : null },
                { label: 'End date', value: r.endDate ? fmtDate(r.endDate) : null },
                { label: 'Base salary', value: r.baseSalary !== undefined ? fmtMoney(r.baseSalary) : undefined },
                { label: 'Linked user', value: r._labels?.userId ?? null },
              ]}
            />
          </Card>
          <Card title="Contact">
            <InfoGrid
              cols={1}
              items={[
                {
                  label: 'E-mail',
                  value: r.email ? (
                    <a className="text-brand-700 hover:underline" href={`mailto:${r.email}`}>
                      {r.email}
                    </a>
                  ) : null,
                },
                {
                  label: 'Phone',
                  value: r.phone ? (
                    <a className="text-brand-700 hover:underline" href={`tel:${r.phone}`}>
                      {r.phone}
                    </a>
                  ) : null,
                },
                { label: 'Address', value: r.address ?? null },
              ]}
            />
          </Card>
          <Card title="Personal" className="lg:col-span-2">
            <InfoGrid
              items={[
                { label: 'Gender', value: r._labels?.genderCode ?? r.genderCode ?? null },
                { label: 'Place / date of birth', value: [r.birthPlace, r.birthDate ? fmtDate(r.birthDate) : null].filter(Boolean).join(', ') || null },
                { label: 'Religion', value: r._labels?.religionCode ?? r.religionCode ?? null },
                { label: 'Marital status', value: r._labels?.maritalCode ?? r.maritalCode ?? null },
                { label: 'Education', value: r._labels?.educationCode ?? r.educationCode ?? null },
                { label: 'Identity no.', value: r.identityNo !== undefined ? r.identityNo : undefined },
                { label: 'Tax no.', value: r.taxNo !== undefined ? r.taxNo : undefined },
                { label: 'Bank', value: r.bankName !== undefined ? [r.bankName, r.bankAccountNo].filter(Boolean).join(' · ') || null : undefined },
              ]}
            />
          </Card>
          <Card title="Team" subtitle={p?.team.length ? `${p.team.length} direct reports` : undefined}>
            {!p?.team.length ? (
              <Muted>No direct reports</Muted>
            ) : (
              <ul className="space-y-2">
                {p.team.map((t) => (
                  <li key={t.id}>
                    <Link to={`/employees/${t.id}`} className="flex items-center gap-2.5 rounded-lg p-1 hover:bg-slate-50">
                      <Avatar name={t.fullName} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{t.fullName}</span>
                        <span className="block truncate text-xs text-slate-500">{t.position ?? t.code}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : tab === 'attendance' && p?.attendance ? (
        <Card
          title="Attendance"
          actions={
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" icon="chevron-left" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
              <span className="w-24 text-center text-sm font-medium">{new Date(`${month}-01T00:00:00`).toLocaleDateString(getLocale(), { month: 'short', year: 'numeric' })}</span>
              <Button size="icon" variant="ghost" icon="chevron-right" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} />
            </div>
          }
        >
          <AttendanceMonth month={month} days={p.attendance.days} options={att} />
          <div className="mt-4 flex flex-wrap gap-2">
            {att.map((o) => (
              <Badge key={o.value} color={o.color}>
                {o.label}: {p.attendance!.summary[o.value] ?? 0}
              </Badge>
            ))}
          </div>
        </Card>
      ) : tab === 'leave' && p?.leave ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title={`Balance ${p.leave.year}`}>
            {!p.leave.balance.length && <Muted>No leave types</Muted>}
            <ul className="space-y-3">
              {p.leave.balance.map((b) => (
                <li key={b.leaveTypeId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{b.name}</span>
                    <span className="text-slate-500 tabular-nums">{b.entitlement ? `${b.used} / ${b.entitlement}` : `${b.used} used`}</span>
                  </div>
                  {b.entitlement > 0 && <Progress value={(b.used / b.entitlement) * 100} tone={b.remaining !== null && b.remaining <= 0 ? 'red' : 'blue'} />}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Requests" className="lg:col-span-2" bodyClass="px-5 py-2">
            <MiniTable
              rows={p.leave.requests}
              empty="No leave requests"
              cols={[
                { header: 'Type', render: (x) => x.leaveType },
                { header: 'Period', render: (x) => `${fmtDate(x.startDate)} – ${fmtDate(x.endDate)}` },
                { header: 'Days', align: 'right', render: (x) => x.days },
                { header: 'Status', render: (x) => <StatusBadge status={x.status} /> },
                { header: 'Reason', render: (x) => <span className="line-clamp-2 text-xs text-slate-500">{x.reason}</span> },
              ]}
            />
          </Card>
        </div>
      ) : tab === 'payslips' && p?.payslips ? (
        <Card title="Payslips" bodyClass="px-5 py-2">
          <MiniTable
            rows={p.payslips}
            empty="No payslips yet"
            cols={[
              {
                header: 'Payroll',
                render: (x) => (
                  <Link className="font-medium text-brand-700 hover:underline" to={`/hris/payroll/${x.runId}`}>
                    {x.number}
                  </Link>
                ),
              },
              { header: 'Period', render: (x) => `${fmtDate(x.periodStart)} – ${fmtDate(x.periodEnd)}` },
              { header: 'Pay date', render: (x) => fmtDate(x.payDate) },
              { header: 'Earnings', align: 'right', render: (x) => money(x.earnings) },
              { header: 'Deductions', align: 'right', render: (x) => money(x.deductions) },
              { header: 'Net pay', align: 'right', render: (x) => <span className="font-semibold">{money(x.netPay)}</span> },
              { header: 'Status', render: (x) => <StatusBadge status={x.status} /> },
              {
                header: '',
                render: (x) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="eye"
                    aria-label="Preview payslip"
                    onClick={() => previewFile({ path: `/hris/payroll/${x.runId}/payslips/${x.id}/pdf`, title: `Payslip ${x.number}` }).catch((e) => toast.error(e))}
                  />
                ),
              },
            ]}
          />
        </Card>
      ) : tab === 'work' && p ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {p.tasks && (
            <Card
              title="Open tasks"
              bodyClass="px-5 py-2"
              actions={
                <Link to="/tasks" className="text-xs font-medium text-brand-700 hover:underline">
                  All tasks
                </Link>
              }
            >
              <MiniTable
                rows={p.tasks}
                empty="No open tasks"
                cols={[
                  {
                    header: 'Task',
                    render: (t) => (
                      <span className="font-medium text-slate-800">
                        {t.title}
                        <span className="ml-1.5 font-mono text-[10px] text-slate-400">{t.code}</span>
                      </span>
                    ),
                  },
                  { header: 'Stage', render: (t) => (t.stage ? <Badge color={t.stage.color}>{t.stage.name}</Badge> : null) },
                  { header: 'Priority', render: (t) => <LookupBadge options={pri} value={t.priorityCode} /> },
                  { header: 'Due', render: (t) => (t.dueDate ? <span className={cn(t.dueDate < new Date().toISOString() && 'font-medium text-red-600')}>{fmtDate(t.dueDate)}</span> : '—') },
                ]}
              />
            </Card>
          )}
          {p.assets && (
            <Card title="Assets in custody" bodyClass="px-5 py-2">
              <MiniTable
                rows={p.assets}
                empty="No assets assigned"
                onRow={(a) => navigate(`/assets/${a.id}`)}
                cols={[
                  {
                    header: 'Asset',
                    render: (a) => (
                      <span className="font-medium text-slate-800">
                        {a.name}
                        <span className="ml-1.5 font-mono text-[10px] text-slate-400">{a.code}</span>
                      </span>
                    ),
                  },
                  { header: 'Acquired', render: (a) => fmtDate(a.acquisitionDate) },
                  { header: 'Cost', align: 'right', render: (a) => money(a.cost) },
                  { header: 'Status', render: (a) => <LookupBadge options={ast} value={a.statusCode} /> },
                ]}
              />
            </Card>
          )}
          {p.expenses && (
            <Card title="Expense claims" bodyClass="px-5 py-2" className="lg:col-span-2">
              <MiniTable
                rows={p.expenses}
                empty="No expense claims"
                onRow={(e) => navigate(`/expenses/${e.id}`)}
                cols={[
                  { header: 'Number', render: (e) => <span className="font-medium text-brand-700">{e.number}</span> },
                  { header: 'Date', render: (e) => fmtDate(e.date) },
                  { header: 'Title', render: (e) => e.title },
                  { header: 'Amount', align: 'right', render: (e) => money(e.totalAmount) },
                  { header: 'Status', render: (e) => <LookupBadge options={exp} value={e.statusCode} /> },
                ]}
              />
            </Card>
          )}
          {!p.tasks && !p.assets && !p.expenses && <Muted>Nothing you have access to.</Muted>}
        </div>
      ) : null}
    </div>
  );
}

/** month calendar coloured by attendance status */
function AttendanceMonth({
  month,
  days,
  options,
}: {
  month: string;
  days: { date: string; statusCode: string | null; checkIn: string | null; checkOut: string | null }[];
  options: { value: string; label: string; color: string | null }[];
}) {
  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    const byDay = new Map(days.map((d) => [d.date.slice(0, 10), d]));
    return {
      offset,
      list: Array.from({ length: count }, (_, i) => {
        const iso = `${month}-${String(i + 1).padStart(2, '0')}`;
        return { iso, day: i + 1, dow: (offset + i) % 7, rec: byDay.get(iso) };
      }),
    };
  }, [month, days]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-slate-400">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: cells.offset }).map((_, i) => (
          <div key={`e${i}`} />
        ))}
        {cells.list.map((c) => {
          const o = options.find((x) => x.value === c.rec?.statusCode);
          const tip = c.rec
            ? `${o?.label ?? c.rec.statusCode ?? 'Recorded'}${c.rec.checkIn ? ` · in ${fmtDateTime(c.rec.checkIn).slice(-5)}` : ''}${c.rec.checkOut ? ` · out ${fmtDateTime(c.rec.checkOut).slice(-5)}` : ''}`
            : c.dow >= 5
              ? 'Weekend'
              : 'No record';
          return (
            <div
              key={c.iso}
              title={tip}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-lg border text-xs sm:aspect-[4/3]',
                c.dow >= 5 && !c.rec ? 'border-transparent bg-slate-50 text-slate-300' : 'border-line text-slate-600',
                c.iso === today && 'ring-2 ring-brand-400',
              )}
              style={o?.color ? { backgroundColor: `${o.color}1f`, borderColor: `${o.color}55`, color: o.color } : undefined}
            >
              <span className="font-semibold">{c.day}</span>
              {o && <span className="hidden max-w-full truncate px-1 text-[9px] font-medium sm:block">{o.label}</span>}
            </div>
          );
        })}
      </div>
      {!days.length && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          <Icon name="info" className="h-3.5 w-3.5" />
          No attendance recorded this month.
        </p>
      )}
    </div>
  );
}
