import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtNumber, plural } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Button, Card, DataTable, EmptyState, Icon, Input, Pagination, PageHeader, Select, type Column } from '@/components/ui';
import { TaskDrawer } from './TaskDrawer';
import { Avatar, DueLabel, PriorityBadge, usePriorities, useTaskStages, type TaskRow, useTaskStates } from './common';

export default function TaskListPage() {
  const taskStates = useTaskStates();
  const { can } = useSession();
  const ls = useListState({ sort: 'dueDate', order: 'asc' });
  const stages = useTaskStages().data ?? [];
  const priorities = usePriorities();
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const f = ls.filters;
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, sort: ls.sort, order: ls.order, projectId: f.projectId, assigneeId: f.assigneeId, stageId: f.stageId, priorityCode: f.priorityCode, status: f.status, due: f.due };
  const q = useQuery({ queryKey: ['tasks', 'list', params], queryFn: () => api.get<Paged<TaskRow>>('/tasks', params), placeholderData: keepPreviousData });

  const columns: Column<TaskRow>[] = [
    {
      key: 'title',
      header: 'Task',
      sortable: true,
      render: (t) => (
        <div className="min-w-56 whitespace-normal">
          <p className={t.completedAt ? 'text-slate-500 line-through' : 'font-medium text-slate-900'}>{t.title}</p>
          <p className="font-mono text-[11px] text-slate-400">{t.code}</p>
        </div>
      ),
    },
    {
      key: 'stageId',
      header: 'Stage',
      render: (t) => {
        const s = stages.find((x) => x.id === t.stageId);
        return s ? (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? '#64748b' }} />
            {s.name}
          </span>
        ) : null;
      },
    },
    { key: 'priorityCode', header: 'Priority', render: (t) => <PriorityBadge code={t.priorityCode} priorities={priorities} /> },
    {
      key: 'assigneeName',
      header: 'Assignee',
      render: (t) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={t.assigneeName} />
          {t.assigneeName ?? <span className="text-slate-400">Unassigned</span>}
        </span>
      ),
    },
    { key: 'projectName', header: 'Project', hideOnMobile: true, render: (t) => t.projectName ?? <span className="text-slate-300">—</span> },
    { key: 'dueDate', header: 'Due', sortable: true, render: (t) => <DueLabel task={t} /> },
    {
      key: 'progress',
      header: 'Progress',
      render: (t) =>
        t.checklistTotal ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full bg-emerald-500" style={{ width: `${(t.checklistDone / t.checklistTotal) * 100}%` }} />
            </span>
            <span className="text-xs text-slate-500">
              {t.checklistDone}/{t.checklistTotal}
            </span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    { key: 'spentHours', header: 'Hours', align: 'right', render: (t) => `${fmtNumber(t.spentHours, 2)}${Number(t.estimateHours) ? ` / ${fmtNumber(t.estimateHours, 2)}` : ''}` },
  ];

  return (
    <div>
      <PageHeader
        title="All Tasks"
        subtitle={q.data ? plural(q.data.meta.total, 'task') : undefined}
        actions={
          can('task.task.create') && (
            <Button icon="plus" onClick={() => setOpen(null)}>
              New task
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <form
            className="relative sm:col-span-2 xl:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search tasks..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <Select value={f.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)} placeholder="Open & done" options={taskStates} />
          <Select value={f.stageId ?? ''} onChange={(e) => ls.setFilter('stageId', e.target.value)} placeholder="All stages" options={stages.map((s) => ({ value: s.id, label: s.name }))} />
          <Select value={f.priorityCode ?? ''} onChange={(e) => ls.setFilter('priorityCode', e.target.value)} placeholder="All priorities" options={priorities.map((p) => ({ value: p.value, label: p.label }))} />
          <AsyncSelect resource="users" value={f.assigneeId} onChange={(v) => ls.setFilter('assigneeId', v)} placeholder="All assignees" />
          <AsyncSelect resource="projects" value={f.projectId} onChange={(v) => ls.setFilter('projectId', v)} placeholder="All projects" />
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(t) => t.id}
          loading={q.isFetching}
          sort={{ field: ls.sort, order: ls.order }}
          onSort={ls.toggleSort}
          onRowClick={(t) => setOpen(t.id)}
          empty={<EmptyState icon="list-todo" title="No tasks found" description="Create a task or change the filters." />}
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <TaskDrawer open={open !== undefined} taskId={open ?? null} onClose={() => setOpen(undefined)} />
    </div>
  );
}
