import { useMemo, useRef, useState, type ComponentType } from 'react';
import { getLocale } from '@/lib/format';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { useDebounce } from '@/hooks/useDebounce';
import { AsyncSelect, Button, Card, Checkbox, cn, EmptyState, Floating, Icon, Input, LookupSelect, Modal, PageHeader, Spinner, StatCard, Tabs, Textarea, toast } from '@/components/ui';
import type { ResourceMeta } from '@/features/resources/types';

interface Status {
  code: string;
  name: string;
  color: string | null;
}
interface Day {
  date: string;
  day: number;
  weekday: number;
  workday: boolean;
  holiday: string | null;
  collectiveLeave: boolean;
  today: boolean;
  future: boolean;
}
interface Cell {
  id?: string;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  notes: string | null;
  source: 'record' | 'leave';
  leaveType?: string;
}
interface EmpRow {
  id: string;
  code: string;
  fullName: string;
  department: string | null;
  position: string | null;
  joinDate: string | null;
  endDate: string | null;
  cells: Record<string, Cell>;
  totals: Record<string, number>;
  missing: number;
  expected: number;
  pct: number | null;
}
interface MonthData {
  month: string;
  timezone: string;
  days: Day[];
  workingDays: number;
  statuses: Status[];
  employees: EmpRow[];
  summary: { byStatus: Record<string, number>; missing: number; avgPct: number | null; employees: number };
  can: { create: boolean; update: boolean; delete: boolean; export: boolean };
}

const WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' });
};

/** Short, readable code per status (initials of its name), unique within the list */
function useAbbr(statuses: Status[]) {
  return useMemo(() => {
    const map = new Map<string, string>();
    const used = new Set<string>();
    for (const s of statuses) {
      const words = s.name.split(/[\s/-]+/).filter(Boolean);
      let a = (words.length > 1 ? words.map((w) => w[0]).join('') : s.name.slice(0, 1)).toUpperCase().slice(0, 3);
      if (used.has(a)) a = s.code.slice(0, 2).toUpperCase();
      used.add(a);
      map.set(s.code, a);
    }
    return map;
  }, [statuses]);
}

/** Attendance: monthly sheet (default) + the plain records list. Replaces the generic /r/attendances page. */
export default function AttendanceMonthPage({ meta, List }: { meta: ResourceMeta; List: ComponentType<{ meta: ResourceMeta; embedded?: boolean }> }) {
  const [tab, setTab] = useState<'sheet' | 'records'>('sheet');
  return (
    <div>
      <PageHeader title="Attendance" subtitle={tab === 'sheet' ? 'Monthly attendance sheet - click a day to record or correct it' : 'Every attendance record'} />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'sheet', label: 'Monthly sheet' },
            { value: 'records', label: 'Records' },
          ]}
        />
      </div>
      {tab === 'sheet' ? <MonthSheet /> : <List meta={meta} embedded />}
    </div>
  );
}

function MonthSheet() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, 300);
  const [editing, setEditing] = useState<{ emp: EmpRow; day: Day; anchor: HTMLElement } | null>(null);
  const [bulk, setBulk] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);

  const params = { month, departmentId: departmentId ?? undefined, branchId: branchId ?? undefined, search: search || undefined };
  const q = useQuery({ queryKey: ['attendance-month', params], queryFn: () => api.get<MonthData>('/hris/attendance/month', params), placeholderData: keepPreviousData });
  const data = q.data;
  const abbr = useAbbr(data?.statuses ?? []);
  const color = useMemo(() => new Map((data?.statuses ?? []).map((s) => [s.code, s.color ?? '#64748b'])), [data?.statuses]);
  const name = useMemo(() => new Map((data?.statuses ?? []).map((s) => [s.code, s.name])), [data?.statuses]);
  const canEdit = !!data && (data.can.create || data.can.update);
  const refresh = () => qc.invalidateQueries({ queryKey: ['attendance-month'] });

  const doExport = async () => {
    try {
      await download('/hris/attendance/month/export', { ...params, format: 'xlsx' });
    } catch (e) {
      toast.error(e);
    }
  };

  const late = data?.summary.byStatus.LATE ?? 0;
  const absent = data?.summary.byStatus.ABSENT ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Working days" value={data?.workingDays ?? '—'} hint={data ? `${data.days.length - data.workingDays} days off / holidays` : undefined} icon="calendar-days" />
        <StatCard label="Avg. attendance" value={data?.summary.avgPct != null ? `${data.summary.avgPct}%` : '—'} hint="Present, late or WFH vs. working days so far" icon="user-check" tone="green" />
        <StatCard label="Late" value={late} icon="alarm-clock" tone="amber" />
        <StatCard label="Absent" value={absent} icon="user-x" tone="red" />
        <StatCard label="No record" value={data?.summary.missing ?? '—'} hint="Past working days without attendance" icon="circle-help" tone="violet" />
      </div>

      <Card bodyClass="p-0">
        <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
          <MonthPicker value={month} onChange={setMonth} />
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <AsyncSelect resource="departments" value={departmentId} onChange={setDepartmentId} placeholder="All departments" />
            <AsyncSelect resource="branches" value={branchId} onChange={setBranchId} placeholder="All branches" />
            <div className="relative">
              <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <Input className="pl-9" placeholder="Search employee..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            {data?.can.create && (
              <Button variant="outline" icon="calendar-check" onClick={() => setBulk(true)} disabled={!data.employees.length}>
                Fill days
              </Button>
            )}
            {data?.can.export && (
              <Button variant="outline" icon="download" onClick={doExport}>
                Export
              </Button>
            )}
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
            {data.statuses.map((s) => (
              <span key={s.code} className="inline-flex items-center gap-1.5">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] font-bold text-white" style={{ background: color.get(s.code) }}>
                  {abbr.get(s.code)}
                </span>
                {s.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-5 w-5 rounded-md border border-dashed border-slate-300" /> Approved leave request
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-rose-50">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              </span>
              No record
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-5 w-5 rounded-md bg-slate-100" /> Weekend / holiday
            </span>
          </div>
        )}

        {q.isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner className="h-6 w-6 text-brand-700" />
          </div>
        ) : !data?.employees.length ? (
          <EmptyState icon="users" title="No employees" description={search || departmentId || branchId ? 'Nothing matches your filters.' : 'Add employees in HRIS > Employees to start recording attendance.'} />
        ) : (
          <div className={cn('relative max-h-[70vh] overflow-auto', q.isFetching && 'opacity-70')}>
            {/* fixed layout: the day columns share the available width so a whole month fits on a laptop screen;
                below the minimum width the sheet scrolls horizontally with the employee column pinned */}
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: 168 + data.days.length * 24 + data.statuses.length * 28 + 48 }}>
              <colgroup>
                <col style={{ width: 168 }} />
                {data.days.map((d) => (
                  <col key={d.date} />
                ))}
                {data.statuses.map((s) => (
                  <col key={s.code} style={{ width: 28 }} />
                ))}
                <col style={{ width: 48 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 border-r border-b border-line bg-white px-3 py-2 text-left text-xs font-semibold text-slate-500">Employee</th>
                  {data.days.map((d) => (
                    <th
                      key={d.date}
                      title={d.holiday ?? (d.workday ? undefined : 'Day off')}
                      className={cn('sticky top-0 z-20 border-b border-line px-0 py-1.5 text-center font-medium', d.today ? 'bg-brand-50 text-brand-700' : d.workday ? 'bg-white text-slate-600' : d.holiday ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500')}
                    >
                      <div className="text-[10px] leading-none">{WEEKDAY[d.weekday - 1]}</div>
                      <div className="mt-0.5 text-xs leading-none font-semibold">{d.day}</div>
                    </th>
                  ))}
                  {data.statuses.map((s) => (
                    <th key={s.code} title={s.name} className="sticky top-0 z-20 border-b border-l border-line bg-white px-0 py-2 text-center text-[10px] font-semibold" style={{ color: color.get(s.code) }}>
                      {abbr.get(s.code)}
                    </th>
                  ))}
                  <th className="sticky top-0 right-0 z-30 border-b border-l border-line bg-white px-2 py-2 text-right text-xs font-semibold text-slate-500 shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.15)]">%</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id} className="group">
                    <td className="sticky left-0 z-10 border-r border-b border-line bg-white px-3 py-1.5 group-hover:bg-slate-50">
                      <div className="truncate font-medium text-slate-800" title={e.fullName}>
                        {e.fullName}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{[e.code, e.position ?? e.department].filter(Boolean).join(' · ')}</div>
                    </td>
                    {data.days.map((d) => {
                      const c = e.cells[d.date];
                      const outside = (e.joinDate && d.date < e.joinDate) || (e.endDate && d.date > e.endDate);
                      const missing = !c?.status && d.workday && !d.future && !outside;
                      const editable = canEdit && !outside;
                      const title = [
                        `${e.fullName} - ${new Date(d.date).toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}`,
                        d.holiday,
                        c?.status ? name.get(c.status) : missing ? 'No record' : null,
                        c?.leaveType ? `${c.leaveType} (approved leave request)` : null,
                        c?.checkIn ? `In ${c.checkIn}${c.checkOut ? ` · Out ${c.checkOut}` : ''}` : null,
                        c?.notes,
                      ]
                        .filter(Boolean)
                        .join('\n');
                      return (
                        <td key={d.date} className={cn('border-b border-line p-0.5 text-center', d.today ? 'bg-brand-50/60' : !d.workday && (d.holiday ? 'bg-rose-50/60' : 'bg-slate-50'), outside && 'bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#fff_4px,#fff_8px)]')}>
                          <button
                            type="button"
                            title={title}
                            disabled={!editable}
                            onClick={(ev) => {
                              anchorRef.current = ev.currentTarget;
                              setEditing({ emp: e, day: d, anchor: ev.currentTarget });
                            }}
                            className={cn('mx-auto flex h-7 w-full max-w-8 items-center justify-center rounded-md text-[10px] font-bold transition', editable && 'hover:ring-2 hover:ring-brand-300 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none', editing?.emp.id === e.id && editing.day.date === d.date && 'ring-2 ring-brand-500')}
                            style={c?.status ? (c.source === 'leave' ? { border: `1.5px dashed ${color.get(c.status)}`, color: color.get(c.status) } : { background: color.get(c.status), color: '#fff' }) : undefined}
                          >
                            {c?.status ? abbr.get(c.status) ?? c.status.slice(0, 2) : missing ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> : null}
                          </button>
                        </td>
                      );
                    })}
                    {data.statuses.map((s) => (
                      <td key={s.code} className="border-b border-l border-line px-0 text-center text-xs text-slate-700 tabular-nums">
                        {e.totals[s.code] || <span className="text-slate-300">0</span>}
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 border-b border-l border-line bg-white px-2 text-right text-xs font-semibold tabular-nums shadow-[-4px_0_6px_-4px_rgba(15,23,42,0.15)] group-hover:bg-slate-50">
                      {e.pct === null ? <span className="text-slate-300">—</span> : <span className={e.pct >= 90 ? 'text-emerald-600' : e.pct >= 75 ? 'text-amber-600' : 'text-rose-600'}>{e.pct}%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <p className="border-t border-line px-3 py-2 text-[11px] text-slate-500">Times in {data.timezone}. Work days and holidays come from System Settings (HRIS) and HRIS → Public Holidays.</p>}
      </Card>

      {editing && data && (
        <CellEditor
          key={`${editing.emp.id}-${editing.day.date}`}
          anchorRef={anchorRef}
          emp={editing.emp}
          day={editing.day}
          statuses={data.statuses}
          color={color}
          canDelete={data.can.delete}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {bulk && data && <BulkDialog data={data} onClose={() => setBulk(false)} onDone={refresh} />}
    </div>
  );
}

function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" icon="chevron-left" aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))} />
      <button
        ref={ref}
        type="button"
        onClick={() => {
          setYear(Number(value.slice(0, 4)));
          setOpen((o) => !o);
        }}
        className="min-w-40 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
      >
        {monthLabel(value)}
      </button>
      <Button variant="ghost" size="icon" icon="chevron-right" aria-label="Next month" onClick={() => onChange(shiftMonth(value, 1))} />
      {value !== thisMonth() && (
        <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth())}>
          This month
        </Button>
      )}
      <Floating anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false} width={248} className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="icon" icon="chevron-left" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} />
          <span className="text-sm font-semibold">{year}</span>
          <Button variant="ghost" size="icon" icon="chevron-right" aria-label="Next year" onClick={() => setYear((y) => y + 1)} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((m, i) => {
            const v = `${year}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className={cn('rounded-lg py-2 text-sm', v === value ? 'bg-brand-600 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100')}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Floating>
    </div>
  );
}

function CellEditor({
  anchorRef,
  emp,
  day,
  statuses,
  color,
  canDelete,
  onClose,
  onSaved,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  emp: EmpRow;
  day: Day;
  statuses: Status[];
  color: Map<string, string>;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cell = emp.cells[day.date];
  const record = cell?.source === 'record' ? cell : null;
  const [status, setStatus] = useState<string | null>(record?.status ?? null);
  const [checkIn, setCheckIn] = useState(record?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(record?.checkOut ?? '');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (clear = false) => {
    setBusy(true);
    try {
      await api.put('/hris/attendance/cell', { employeeId: emp.id, date: day.date, statusCode: clear ? null : status, checkIn: clear ? null : checkIn || null, checkOut: clear ? null : checkOut || null, notes: clear ? null : notes || null });
      toast.success(clear ? 'Attendance cleared' : 'Attendance saved');
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Floating anchorRef={anchorRef} open onClose={onClose} matchWidth={false} width={300} preferredHeight={420} className="p-0">
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="shrink-0 border-b border-line px-4 py-3">
          <p className="truncate text-sm font-semibold text-slate-900">{emp.fullName}</p>
          <p className="text-xs text-slate-500">
            {new Date(day.date).toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {day.holiday && <span className="text-rose-600"> · {day.holiday}</span>}
          </p>
          {cell?.source === 'leave' && (
            <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
              <Icon name="info" className="mr-1 inline h-3.5 w-3.5" />
              {cell.leaveType ?? 'Leave'} (approved request). Saving here records the day explicitly.
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Status">
            {statuses.map((s) => (
              <button
                key={s.code}
                type="button"
                role="radio"
                aria-checked={status === s.code}
                onClick={() => setStatus(s.code)}
                className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition', status === s.code ? 'text-white' : 'border-line bg-white text-slate-700 hover:bg-slate-50')}
                style={status === s.code ? { background: color.get(s.code), borderColor: color.get(s.code) } : undefined}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              Check in
              <Input type="time" className="mt-1" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">
              Check out
              <Input type="time" className="mt-1" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </label>
          </div>
          <Textarea rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-slate-50/70 px-4 py-2.5">
          {record && canDelete ? (
            <Button variant="ghost" size="sm" icon="eraser" onClick={() => save(true)} disabled={busy}>
              Clear
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => save()} loading={busy} disabled={!status}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Floating>
  );
}

function BulkDialog({ data, onClose, onDone }: { data: MonthData; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<string>('');
  const [dates, setDates] = useState<Set<string>>(() => new Set(data.days.filter((d) => d.today && d.workday).map((d) => d.date)));
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = (date: string) =>
    setDates((s) => {
      const n = new Set(s);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });
  const offset = (data.days[0]?.weekday ?? 1) - 1;

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; updated: number }>('/hris/attendance/bulk', { employeeIds: data.employees.map((e) => e.id), dates: [...dates], statusCode: status, overwrite });
      toast.success(`${r.created} recorded${r.updated ? `, ${r.updated} updated` : ''}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Fill attendance for several days"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} loading={busy} disabled={!status || !dates.size}>
            Apply to {data.employees.length} employee{data.employees.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Applies to the employees currently shown on the sheet (use the department, branch or search filters to narrow them down).</p>
        <div>
          <label className="label">Status</label>
          <LookupSelect category="ATTENDANCE_STATUS" value={status} onChange={setStatus} clearable={false} placeholder="Choose a status" />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0">Days ({dates.size} selected)</label>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setDates(new Set(data.days.filter((d) => d.workday).map((d) => d.date)))}>
                All working days
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDates(new Set())}>
                None
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY.map((w, i) => (
              <span key={i} className="text-[11px] font-medium text-slate-400">
                {w}
              </span>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={`o${i}`} />
            ))}
            {data.days.map((d) => (
              <button
                key={d.date}
                type="button"
                title={d.holiday ?? undefined}
                onClick={() => toggle(d.date)}
                className={cn('rounded-lg py-1.5 text-sm transition', dates.has(d.date) ? 'bg-brand-600 font-semibold text-white' : d.workday ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100', d.holiday && !dates.has(d.date) && 'text-rose-500')}
              >
                {d.day}
              </button>
            ))}
          </div>
        </div>
        <Checkbox checked={overwrite} onChange={setOverwrite} label="Overwrite days that already have a record" />
      </div>
    </Modal>
  );
}
