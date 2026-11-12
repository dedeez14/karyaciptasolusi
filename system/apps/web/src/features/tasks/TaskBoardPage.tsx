import { useMemo, useState } from 'react';
import { plural } from '@/lib/format';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, cn, EmptyState, Icon, Input, PageHeader, Select, Spinner, toast } from '@/components/ui';
import { TaskCard } from './TaskCard';
import { TaskDrawer } from './TaskDrawer';
import { usePriorities, useTaskStages, type TaskRow, useDueFilters } from './common';

export default function TaskBoardPage() {
  const dueFilters = useDueFilters();
  const { me, can } = useSession();
  const qc = useQueryClient();
  const stagesQ = useTaskStages();
  const stages = stagesQ.data ?? [];
  const priorities = usePriorities();
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priorityCode, setPriorityCode] = useState('');
  const [due, setDue] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const q = useDebounce(search, 300);
  const params = { pageSize: 500, sort: 'position', order: 'asc', search: q, projectId: projectId ?? undefined, assigneeId: assigneeId ?? undefined, priorityCode: priorityCode || undefined, due: due || undefined };
  const key = ['tasks', 'board', params];
  const tasksQ = useQuery({ queryKey: key, queryFn: () => api.get<Paged<TaskRow>>('/tasks', params), placeholderData: keepPreviousData });
  const tasks = tasksQ.data?.data ?? [];

  const [open, setOpen] = useState<{ id: string | null; stageId?: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ stageId: string; beforeId: string | null } | null>(null);

  const byStage = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const s of stages) m.set(s.id, []);
    for (const t of tasks) m.get(t.stageId)?.push(t);
    for (const list of m.values()) list.sort((a, b) => a.position - b.position);
    return m;
  }, [tasks, stages]);

  const move = async (taskId: string, stageId: string, beforeId: string | null) => {
    const list = (byStage.get(stageId) ?? []).filter((t) => t.id !== taskId);
    const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
    const prev = list[idx - 1]?.position;
    const next = list[idx]?.position;
    const position = prev === undefined && next === undefined ? 1024 : prev === undefined ? next! - 1024 : next === undefined ? prev + 1024 : (prev + next) / 2;
    const stage = stages.find((s) => s.id === stageId);
    // optimistic update
    qc.setQueryData<Paged<TaskRow>>(key, (old) =>
      old ? { ...old, data: old.data.map((t) => (t.id === taskId ? { ...t, stageId, position, completedAt: stage?.isDone ? t.completedAt ?? new Date().toISOString() : null } : t)) } : old,
    );
    try {
      await api.post(`/tasks/${taskId}/move`, { stageId, position });
    } catch (e) {
      toast.error(e);
    } finally {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    }
  };

  const onDrop = (stageId: string) => {
    if (dragId && dropAt) move(dragId, stageId, dropAt.beforeId);
    setDragId(null);
    setDropAt(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Task Board"
        subtitle={tasksQ.data ? plural(tasksQ.data.meta.total, 'task') : undefined}
        actions={
          can('task.task.create') && (
            <Button icon="plus" onClick={() => setOpen({ id: null })}>
              New task
            </Button>
          )
        }
      />
      <div className="card mb-4 grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.8fr_auto]">
        <div className="relative">
          <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
          <Input className="pl-9" placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <AsyncSelect resource="projects" value={projectId} onChange={setProjectId} placeholder="All projects" />
        <div className="flex gap-1">
          <div className="flex-1">
            <AsyncSelect resource="users" value={assigneeId} onChange={setAssigneeId} placeholder="All assignees" />
          </div>
          <Button variant={assigneeId === me?.user.id ? 'secondary' : 'outline'} onClick={() => setAssigneeId(assigneeId === me?.user.id ? null : me?.user.id ?? null)}>
            Me
          </Button>
        </div>
        <Select value={priorityCode} onChange={(e) => setPriorityCode(e.target.value)} options={priorities.map((p) => ({ value: p.value, label: p.label }))} placeholder="All priorities" />
        <Select
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="Any due date"
          options={dueFilters}
        />
        <Button variant={hideDone ? 'secondary' : 'outline'} icon={hideDone ? 'eye-off' : 'eye'} onClick={() => setHideDone((v) => !v)}>
          Done
        </Button>
      </div>

      {stagesQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : stages.length === 0 ? (
        <EmptyState icon="columns-3" title="No task stages" description="Add board columns in Task Management > Task Stages." />
      ) : (
        <div className="-mx-4 flex flex-1 snap-x gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {stages
            .filter((s) => !(hideDone && s.isDone))
            .map((s) => {
              const list = byStage.get(s.id) ?? [];
              const color = s.color ?? '#64748b';
              return (
                <section
                  key={s.id}
                  className={cn('flex w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-line bg-slate-50/80', dropAt?.stageId === s.id && dragId && 'ring-2 ring-brand-300')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dropAt?.stageId !== s.id || (e.target as HTMLElement).dataset.col) setDropAt({ stageId: s.id, beforeId: dropAt?.stageId === s.id ? dropAt.beforeId : null });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDrop(s.id);
                  }}
                >
                  <header className="flex items-center gap-2 rounded-t-2xl border-b border-line bg-white px-3 py-2.5" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <h3 className="flex-1 truncate text-sm font-semibold text-slate-900">{s.name}</h3>
                    {s.isDone && <Icon name="circle-check" className="h-4 w-4 text-emerald-500" />}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{list.length}</span>
                  </header>
                  <div data-col="1" className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: 'calc(100dvh - 300px)' }}>
                    {list.map((t) => (
                      <div
                        key={t.id}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          const idx = list.findIndex((x) => x.id === t.id);
                          setDropAt({ stageId: s.id, beforeId: after ? list[idx + 1]?.id ?? null : t.id });
                        }}
                      >
                        {dropAt?.stageId === s.id && dropAt.beforeId === t.id && dragId && dragId !== t.id && <div className="mb-2 h-1 rounded-full bg-brand-400" />}
                        <TaskCard
                          task={t}
                          priorities={priorities}
                          stages={stages}
                          draggable={can('task.task.update')}
                          dragging={dragId === t.id}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.id);
                            setDragId(t.id);
                          }}
                          onOpen={() => setOpen({ id: t.id })}
                          onMove={(stageId) => move(t.id, stageId, null)}
                        />
                      </div>
                    ))}
                    {dropAt?.stageId === s.id && dropAt.beforeId === null && dragId && <div className="h-1 rounded-full bg-brand-400" />}
                    {list.length === 0 && !dragId && <p className="py-6 text-center text-xs text-slate-400">No tasks</p>}
                  </div>
                  {can('task.task.create') && (
                    <button type="button" onClick={() => setOpen({ id: null, stageId: s.id })} className="m-2 mt-0 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-white hover:text-brand-700">
                      <Icon name="plus" className="h-4 w-4" /> Add task
                    </button>
                  )}
                </section>
              );
            })}
        </div>
      )}
      <TaskDrawer open={!!open} taskId={open?.id ?? null} defaults={{ stageId: open?.stageId, projectId: projectId ?? undefined }} onClose={() => setOpen(null)} />
    </div>
  );
}
