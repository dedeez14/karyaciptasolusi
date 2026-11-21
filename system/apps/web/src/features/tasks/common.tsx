import { useQuery } from '@tanstack/react-query';
import { getLocale } from '@/lib/format';
import { api } from '@/lib/api';
import { cn } from '@/components/ui';
import { useLookups } from '@/features/resources/FieldInput';

export interface TaskStage {
  id: string;
  code: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isDone: boolean;
}

export interface TaskRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  projectId: string | null;
  customerId: string | null;
  stageId: string;
  priorityCode: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  estimateHours: string;
  spentHours: string;
  tags: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  assigneeName: string | null;
  reporterName: string | null;
  projectName: string | null;
  customerName: string | null;
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  fileCount: number;
}

export interface TaskDetail extends TaskRow {
  canEdit: boolean;
  checklist: { id: string; title: string; isDone: boolean }[];
  comments: { id: string; body: string; userName: string; mine: boolean; createdAt: string }[];
  timeLogs: { id: string; date: string; hours: string; note: string | null; userName: string; mine: boolean }[];
  files: { id: string; name: string; size: number; mimeType: string; createdAt: string }[];
}

export function useTaskStages() {
  return useQuery({ queryKey: ['tasks', 'stages'], queryFn: () => api.get<TaskStage[]>('/tasks/stages'), staleTime: 60_000 });
}

export function usePriorities() {
  return useLookups(['TASK_PRIORITY']).TASK_PRIORITY ?? [];
}

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const isOverdue = (t: Pick<TaskRow, 'dueDate' | 'completedAt'>) => !!t.dueDate && !t.completedAt && t.dueDate.slice(0, 10) < todayIso();

export function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ name, size = 'sm' }: { name: string | null | undefined; size?: 'sm' | 'md' }) {
  if (!name) return <span className={cn('inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs')}>?</span>;
  return (
    <span title={name} className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-600 font-semibold text-white', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs')}>
      {initials(name)}
    </span>
  );
}

export function PriorityBadge({ code, priorities }: { code: string | null; priorities: { value: string; label: string; color: string | null }[] }) {
  if (!code) return null;
  const p = priorities.find((x) => x.value === code);
  const color = p?.color ?? '#64748b';
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}33` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {p?.label ?? code}
    </span>
  );
}

export function DueLabel({ task }: { task: Pick<TaskRow, 'dueDate' | 'completedAt'> }) {
  if (!task.dueDate) return null;
  const overdue = isOverdue(task);
  const today = task.dueDate.slice(0, 10) === todayIso();
  const d = new Date(task.dueDate.slice(0, 10) + 'T00:00:00');
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-slate-500')}>
      {d.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' })}
      {overdue ? ' · overdue' : today ? ' · today' : ''}
    </span>
  );
}

/** Due-date filter choices and task state choices are master data (Lookup Values: DUE_FILTER, TASK_STATE) */
export function useDueFilters() {
  return useLookups(['DUE_FILTER']).DUE_FILTER ?? [];
}
export function useTaskStates() {
  return useLookups(['TASK_STATE']).TASK_STATE ?? [];
}
