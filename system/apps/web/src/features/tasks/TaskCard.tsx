import { cn, Icon } from '@/components/ui';
import { Avatar, DueLabel, PriorityBadge, type TaskRow, type TaskStage } from './common';
import { Select } from '@/components/ui';

interface Props {
  task: TaskRow;
  priorities: { value: string; label: string; color: string | null }[];
  stages?: TaskStage[];
  onOpen: () => void;
  onMove?: (stageId: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  dragging?: boolean;
}

/** Compact task card used on the board and in My Tasks */
export function TaskCard({ task, priorities, stages, onOpen, onMove, draggable, onDragStart, dragging }: Props) {
  const done = !!task.completedAt;
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={cn(
        'group cursor-pointer rounded-xl border border-line bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-pop',
        dragging && 'opacity-40',
        done && 'bg-slate-50/80',
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium text-slate-400">{task.code}</span>
        <PriorityBadge code={task.priorityCode} priorities={priorities} />
      </div>
      <p className={cn('text-sm leading-snug font-medium text-slate-900', done && 'text-slate-500 line-through')}>{task.title}</p>
      {task.projectName && (
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
          <Icon name="folder-kanban" className="h-3 w-3 shrink-0" />
          {task.projectName}
        </p>
      )}
      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              #{t}
            </span>
          ))}
        </div>
      )}
      {task.checklistTotal > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(task.checklistDone / task.checklistTotal) * 100}%` }} />
          </div>
          <span className="text-[10px] font-medium text-slate-500 tabular-nums">
            {task.checklistDone}/{task.checklistTotal}
          </span>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2.5 text-slate-400">
        <DueLabel task={task} />
        <span className="flex-1" />
        {task.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px]">
            <Icon name="message-square" className="h-3 w-3" />
            {task.commentCount}
          </span>
        )}
        {task.fileCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px]">
            <Icon name="paperclip" className="h-3 w-3" />
            {task.fileCount}
          </span>
        )}
        <Avatar name={task.assigneeName} />
      </div>
      {onMove && stages && (
        <Select
          aria-label="Move to stage"
          className="mt-2 h-8 w-full px-2 text-xs text-slate-600 md:hidden"
          value={task.stageId}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMove(e.target.value)}
          options={stages.map((s) => ({ value: s.id, label: `Move to: ${s.name}` }))}
        />
      )}
    </div>
  );
}
