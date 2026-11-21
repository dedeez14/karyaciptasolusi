import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type Paged } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Button, EmptyState, Icon, PageHeader, Spinner, StatCard, Tabs, toast } from '@/components/ui';
import { TaskDrawer } from './TaskDrawer';
import { DueLabel, PriorityBadge, todayIso, usePriorities, useTaskStages, type TaskRow, useTaskStates } from './common';

type Group = 'overdue' | 'today' | 'week' | 'later' | 'none';
const GROUPS: { key: Group; title: string; icon: string; tone: string }[] = [
  { key: 'overdue', title: 'Overdue', icon: 'alarm-clock', tone: 'text-red-600' },
  { key: 'today', title: 'Today', icon: 'sun', tone: 'text-amber-600' },
  { key: 'week', title: 'Next 7 days', icon: 'calendar-days', tone: 'text-brand-600' },
  { key: 'later', title: 'Later', icon: 'calendar-range', tone: 'text-slate-600' },
  { key: 'none', title: 'No due date', icon: 'calendar-off', tone: 'text-slate-500' },
];

export default function MyTasksPage() {
  const taskStates = useTaskStates();
  const { can } = useSession();
  const qc = useQueryClient();
  const stages = useTaskStages().data ?? [];
  const priorities = usePriorities();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const summary = useQuery({ queryKey: ['tasks', 'summary'], queryFn: () => api.get<{ open: number; overdue: number; dueToday: number; doneWeek: number }>('/tasks/summary') });
  const list = useQuery({ queryKey: ['tasks', 'mine', status], queryFn: () => api.get<Paged<TaskRow>>('/tasks', { mine: 1, status, pageSize: 500, sort: status === 'open' ? 'dueDate' : 'updatedAt', order: status === 'open' ? 'asc' : 'desc' }) });
  const doneStage = stages.find((s) => s.isDone);

  const groups = useMemo(() => {
    const today = todayIso();
    const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const g: Record<Group, TaskRow[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    for (const t of list.data?.data ?? []) {
      const d = t.dueDate?.slice(0, 10);
      if (!d) g.none.push(t);
      else if (d < today) g.overdue.push(t);
      else if (d === today) g.today.push(t);
      else if (d <= week) g.week.push(t);
      else g.later.push(t);
    }
    return g;
  }, [list.data]);

  const complete = async (t: TaskRow) => {
    if (!doneStage) return toast.error('No stage is marked as "done". Configure Task Stages.');
    try {
      await api.post(`/tasks/${t.id}/move`, { stageId: doneStage.id, position: Date.now() / 1000 });
      toast.success(`${t.code} completed`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const s = summary.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Tasks"
        subtitle="Everything assigned to you"
        actions={
          <>
            <Link to="/tasks/board">
              <Button variant="outline" icon="square-kanban">
                Board
              </Button>
            </Link>
            {can('task.task.create') && (
              <Button icon="plus" onClick={() => setOpen(null)}>
                New task
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={s?.open ?? '—'} icon="list-todo" tone="blue" />
        <StatCard label="Overdue" value={s?.overdue ?? '—'} icon="alarm-clock" tone="red" />
        <StatCard label="Due today" value={s?.dueToday ?? '—'} icon="sun" tone="amber" />
        <StatCard label="Done this week" value={s?.doneWeek ?? '—'} icon="circle-check" tone="green" />
      </div>
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={(taskStates.length ? taskStates : [{ value: 'open', label: 'Open' }]).map((t) => ({ value: t.value as 'open' | 'done', label: t.label }))}
      />
      {list.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : !list.data?.data.length ? (
        <div className="card">
          <EmptyState icon="party-popper" title={status === 'open' ? 'You are all caught up' : 'No completed tasks yet'} description={status === 'open' ? 'No open tasks are assigned to you.' : undefined} />
        </div>
      ) : status === 'done' ? (
        <TaskGroup title="Completed" icon="circle-check" tone="text-emerald-600" rows={list.data.data} priorities={priorities} onOpen={setOpen} />
      ) : (
        GROUPS.filter((g) => groups[g.key].length).map((g) => <TaskGroup key={g.key} title={g.title} icon={g.icon} tone={g.tone} rows={groups[g.key]} priorities={priorities} onOpen={setOpen} onComplete={can('task.task.update') ? complete : undefined} />)
      )}
      <TaskDrawer open={open !== undefined} taskId={open ?? null} onClose={() => setOpen(undefined)} />
    </div>
  );
}

function TaskGroup({ title, icon, tone, rows, priorities, onOpen, onComplete }: { title: string; icon: string; tone: string; rows: TaskRow[]; priorities: { value: string; label: string; color: string | null }[]; onOpen: (id: string) => void; onComplete?: (t: TaskRow) => void }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Icon name={icon} className={`h-4 w-4 ${tone}`} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-600">{rows.length}</span>
      </header>
      <ul className="divide-y divide-line/70">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/70">
            {onComplete ? (
              <button type="button" aria-label="Mark as done" onClick={() => onComplete(t)} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-500">
                <Icon name="check" className="h-3 w-3" />
              </button>
            ) : (
              <Icon name="circle-check" className="h-5 w-5 shrink-0 text-emerald-500" />
            )}
            <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
              <p className={t.completedAt ? 'truncate text-sm text-slate-500 line-through' : 'truncate text-sm font-medium text-slate-900'}>{t.title}</p>
              <p className="truncate text-xs text-slate-500">
                <span className="font-mono">{t.code}</span>
                {t.projectName ? ` · ${t.projectName}` : ''}
                {t.checklistTotal ? ` · ${t.checklistDone}/${t.checklistTotal} items` : ''}
              </p>
            </button>
            <PriorityBadge code={t.priorityCode} priorities={priorities} />
            <span className="hidden w-28 text-right sm:block">
              <DueLabel task={t} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
