import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSession } from '@/stores/session';
import { Button, Card, cn, EmptyState, Floating, Icon, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea, toast } from '@/components/ui';

interface Entry {
  id: string;
  hours: number;
  billable: boolean;
  note: string | null;
  billed: boolean;
}
interface Cell {
  hours: number;
  billedHours: number;
  billable: boolean;
  note: string | null;
  entries: Entry[];
}
interface Row {
  taskId: string;
  code: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  cells: Record<string, Cell>;
  total: number;
}
interface Week {
  start: string;
  end: string;
  days: string[];
  user: { id: string; fullName: string };
  canManage: boolean;
  rows: Row[];
  dayTotals: Record<string, number>;
  projectTotals: { projectId: string | null; name: string; hours: number; billable: number }[];
  total: number;
}
interface TaskOption {
  id: string;
  code: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
}

const DAY = 86_400_000;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const mondayOf = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return isoOf(t);
};
const shift = (iso: string, days: number) => isoOf(new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY));
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const dayNum = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rangeLabel = (a: string, b: string) => `${dayNum(a)} – ${new Date(`${b}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
const h = (n: number) => (n ? (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '');

/** "1.5", "1,5", "1:30", "90m" -> hours */
function parseHours(v: string): number | null {
  const s = v.trim().toLowerCase();
  if (!s) return 0;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const m = /^(\d+)\s*m$/.exec(s);
  if (m) return Number(m[1]) / 60;
  const n = Number(s.replace(',', '.').replace(/h$/, ''));
  return Number.isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 100) / 100 : null;
}

/** Weekly timesheet: hours per task and day, editable inline */
export default function TimesheetPage() {
  const qc = useQueryClient();
  const me = useSession((s) => s.me);
  const [start, setStart] = useState(() => mondayOf());
  const [userId, setUserId] = useState<string>('');
  const [extra, setExtra] = useState<TaskOption[]>([]);
  const [picking, setPicking] = useState(false);
  const params = { start, userId: userId || undefined };
  const q = useQuery({ queryKey: ['timesheet', params], queryFn: () => api.get<Week>('/timesheets/week', params), placeholderData: keepPreviousData });
  const users = useQuery({ queryKey: ['timesheet-users'], queryFn: () => api.get<{ id: string; fullName: string; username: string }[]>('/timesheets/users'), enabled: !!q.data?.canManage, staleTime: 300_000 });
  const w = q.data;
  const today = isoOf(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));

  useEffect(() => setExtra([]), [start, userId]);

  const rows: Row[] = useMemo(() => {
    const base = w?.rows ?? [];
    const added = extra.filter((t) => !base.some((r) => r.taskId === t.id)).map((t) => ({ taskId: t.id, code: t.code, title: t.title, projectId: t.projectId, projectName: t.projectName, cells: {}, total: 0 }));
    return [...base, ...added];
  }, [w, extra]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['timesheet'] });
  const save = async (taskId: string, date: string, hours: number, extraFields?: { billable?: boolean; note?: string | null }) => {
    try {
      await api.put('/timesheets/cell', { taskId, date, hours, userId: userId || null, ...extraFields });
      refresh();
      qc.invalidateQueries({ queryKey: ['insights'] });
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };

  const viewingOther = !!userId && userId !== me?.user.id;

  return (
    <div>
      <PageHeader
        title="Timesheets"
        subtitle={w ? `${w.user.fullName} · ${rangeLabel(w.start, w.end)}` : 'Hours per task and day'}
        actions={
          <Button icon="plus" onClick={() => setPicking(true)}>
            Add task
          </Button>
        }
      />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" icon="chevron-left" aria-label="Previous week" onClick={() => setStart(shift(start, -7))} />
            <span className="min-w-44 text-center text-sm font-semibold text-slate-800">{rangeLabel(start, shift(start, 6))}</span>
            <Button variant="ghost" size="icon" icon="chevron-right" aria-label="Next week" onClick={() => setStart(shift(start, 7))} />
            {start !== mondayOf() && (
              <Button variant="ghost" size="sm" onClick={() => setStart(mondayOf())}>
                This week
              </Button>
            )}
          </div>
          <div className="flex-1" />
          {w?.canManage && (
            <Select
              aria-label="Person"
              className="w-56"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="My timesheet"
              options={(users.data ?? []).filter((u) => u.id !== me?.user.id).map((u) => ({ value: u.id, label: u.fullName }))}
            />
          )}
        </div>

        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6 text-brand-700" />
          </div>
        ) : !rows.length ? (
          <EmptyState
            icon="timer"
            title="No hours this week"
            description={viewingOther ? 'This person has not logged time in this week.' : 'Add a task, then type the hours you worked on it each day.'}
            action={
              <Button icon="plus" onClick={() => setPicking(true)}>
                Add task
              </Button>
            }
          />
        ) : (
          <div className={cn('overflow-x-auto', q.isFetching && 'opacity-70')}>
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/80 text-xs text-slate-500">
                  <th className="px-3 py-2 text-left font-medium">Task</th>
                  {w!.days.map((d, i) => (
                    <th key={d} className={cn('w-[78px] px-1 py-2 text-center font-medium', i >= 5 && 'bg-slate-100/70', d === today && 'text-brand-700')}>
                      <div>{dayLabel(d)}</div>
                      <div className="text-[11px] font-normal">{dayNum(d)}</div>
                    </th>
                  ))}
                  <th className="w-[70px] px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.taskId} className="border-b border-line">
                    <td className="max-w-0 px-3 py-1.5">
                      <div className="truncate font-medium text-slate-800" title={r.title}>
                        {r.title}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {r.code}
                        {r.projectName && (
                          <>
                            {' · '}
                            {r.projectId ? (
                              <Link to={`/projects/${r.projectId}`} className="hover:text-brand-700">
                                {r.projectName}
                              </Link>
                            ) : (
                              r.projectName
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    {w!.days.map((d, i) => (
                      <td key={d} className={cn('px-1 py-1', i >= 5 && 'bg-slate-50/70')}>
                        <HourCell cell={r.cells[d]} label={`${r.title}, ${dayLabel(d)} ${dayNum(d)}`} onSave={(hours, f) => save(r.taskId, d, hours, f)} />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{h(r.total) || '0'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50/80 text-xs font-semibold text-slate-700">
                  <td className="px-3 py-2">Total</td>
                  {w!.days.map((d) => (
                    <td key={d} className="px-1 py-2 text-center tabular-nums">
                      {h(w!.dayTotals[d]) || '–'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-sm tabular-nums">{h(w!.total) || '0'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="border-t border-line px-3 py-2 text-[11px] text-slate-500">
          Type hours as 1.5, 1,5 or 1:30. A <Icon name="lock" className="inline h-3 w-3" /> marks hours already invoiced; <span className="italic">grey italic</span> hours are not billable.
        </p>
      </Card>

      {!!w?.projectTotals.length && (
        <Card title="By project" className="mt-4" bodyClass="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 text-right font-medium">Hours</th>
                <th className="px-4 py-2 text-right font-medium">Billable</th>
                <th className="px-4 py-2 text-right font-medium">Non-billable</th>
              </tr>
            </thead>
            <tbody>
              {w.projectTotals.map((p) => (
                <tr key={p.projectId ?? 'none'} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{p.projectId ? <Link to={`/projects/${p.projectId}`} className="text-brand-700 hover:underline">{p.name}</Link> : <span className="text-slate-500">{p.name}</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{h(p.hours)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{h(p.billable) || '0'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{h(Math.round((p.hours - p.billable) * 100) / 100) || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {picking && (
        <TaskPicker
          exclude={rows.map((r) => r.taskId)}
          onClose={() => setPicking(false)}
          onPick={(t) => {
            setExtra((x) => [...x, t]);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function HourCell({ cell, label, onSave }: { cell?: Cell; label: string; onSave: (hours: number, f?: { billable?: boolean; note?: string | null }) => Promise<boolean> }) {
  const shown = h(cell?.hours ?? 0);
  const [value, setValue] = useState(shown);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => setValue(shown), [shown]);
  const locked = (cell?.billedHours ?? 0) > 0;
  const nonBillable = !!cell && !cell.billable && cell.hours > cell.billedHours;

  const commit = async () => {
    if (value === shown) return;
    const hours = parseHours(value);
    if (hours === null) {
      toast.error('Enter hours between 0 and 24, e.g. 1.5 or 1:30');
      setValue(shown);
      return;
    }
    if (hours === (cell?.hours ?? 0)) {
      setValue(shown);
      return;
    }
    setSaving(true);
    const ok = await onSave(hours);
    setSaving(false);
    if (!ok) setValue(shown);
  };

  return (
    <div ref={anchor} className="group relative">
      <input
        aria-label={`${label} hours`}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setValue(shown);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          'h-9 w-full rounded-lg border border-transparent bg-transparent px-1.5 text-center text-sm tabular-nums transition hover:border-line focus:border-brand-400 focus:bg-white focus:outline-none',
          cell?.hours && 'bg-brand-50/60 font-medium text-slate-800',
          nonBillable && 'bg-slate-100 font-normal text-slate-500 italic',
        )}
      />
      {locked && <Icon name="lock" className="pointer-events-none absolute top-1 left-1 h-3 w-3 text-slate-400" />}
      {!!cell?.hours && (
        <button
          type="button"
          aria-label={`${label}: billable and note`}
          onClick={() => setOpen((o) => !o)}
          className={cn('absolute top-0.5 right-0.5 rounded p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 focus-visible:opacity-100', (open || cell.note) && 'opacity-100')}
        >
          <Icon name={cell.note ? 'message-square-text' : 'ellipsis'} className="h-3 w-3" />
        </button>
      )}
      {open && cell && (
        <Floating anchorRef={anchor} open onClose={() => setOpen(false)} matchWidth={false} width={280} className="p-0">
          <CellDetails
            cell={cell}
            onClose={() => setOpen(false)}
            onSave={async (f) => {
              const ok = await onSave(cell.hours, f);
              if (ok) setOpen(false);
            }}
          />
        </Floating>
      )}
    </div>
  );
}

function CellDetails({ cell, onClose, onSave }: { cell: Cell; onClose: () => void; onSave: (f: { billable: boolean; note: string | null }) => Promise<void> }) {
  const [billable, setBillable] = useState(cell.billable);
  const [note, setNote] = useState(cell.note ?? '');
  const [busy, setBusy] = useState(false);
  const editable = cell.hours > cell.billedHours;
  return (
    <div className="space-y-3 p-3 text-sm">
      {cell.billedHours > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          <Icon name="lock" className="h-3.5 w-3.5" />
          {h(cell.billedHours)} h already invoiced
        </p>
      )}
      {editable ? (
        <>
          <Switch checked={billable} onChange={setBillable} label="Billable to the customer" />
          <Textarea rows={2} placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await onSave({ billable, note: note.trim() || null });
                setBusy(false);
              }}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">All hours of this day are invoiced and can no longer be changed.</p>
      )}
    </div>
  );
}

function TaskPicker({ exclude, onClose, onPick }: { exclude: string[]; onClose: () => void; onPick: (t: TaskOption) => void }) {
  const [search, setSearch] = useState('');
  const s = useDebounce(search, 250);
  const q = useQuery({
    queryKey: ['timesheet-task-picker', s],
    queryFn: () => api.get<Paged<TaskOption>>('/tasks', { search: s || undefined, status: 'open', pageSize: 30, sort: 'updatedAt', order: 'desc' }),
  });
  const list = (q.data?.data ?? []).filter((t) => !exclude.includes(t.id));
  return (
    <Modal open onClose={onClose} title="Add a task to the timesheet">
      <div className="space-y-3">
        <div className="relative">
          <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input autoFocus className="pl-9" placeholder="Search tasks by title or code..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {q.isLoading && (
            <li className="flex justify-center py-6">
              <Spinner className="h-5 w-5 text-slate-400" />
            </li>
          )}
          {!q.isLoading && !list.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No open tasks found. Create the task first in Task Management.</li>}
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onPick(t)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                <Icon name="square-check-big" className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{t.title}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {t.code}
                    {t.projectName ? ` · ${t.projectName}` : ''}
                  </span>
                </span>
                <Icon name="plus" className="h-4 w-4 text-brand-600" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
