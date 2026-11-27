import { cn } from './primitives';
import { Icon } from './Icon';

export interface Step {
  label: string;
  hint?: string;
}

/** Horizontal progress of a workflow (e.g. Draft → Confirmed → Paid). `current` is the index of the active step. */
export function Steps({ steps, current, cancelled }: { steps: Step[]; current: number; cancelled?: boolean }) {
  return (
    <ol className="card flex items-center gap-2 overflow-x-auto px-5 py-4">
      {steps.map((s, i) => {
        const done = !cancelled && i < current;
        const active = !cancelled && i === current;
        return (
          <li key={s.label} className="flex min-w-fit flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4',
                done && 'bg-emerald-500 text-white ring-emerald-50',
                active && 'bg-brand-600 text-white ring-brand-100',
                !done && !active && 'bg-slate-100 text-slate-400 ring-white',
                cancelled && 'bg-slate-100 text-slate-400',
              )}
            >
              {done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cn('block text-[13px] font-medium whitespace-nowrap', active ? 'text-slate-900' : done ? 'text-slate-700' : 'text-slate-400')}>{s.label}</span>
              {s.hint && <span className="block text-xs whitespace-nowrap text-slate-500">{s.hint}</span>}
            </span>
            {i < steps.length - 1 && <span className={cn('mx-2 h-px min-w-6 flex-1', done ? 'bg-emerald-300' : 'bg-line')} />}
          </li>
        );
      })}
      {cancelled && (
        <li className="ml-2 flex shrink-0 items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
          <Icon name="ban" className="h-3.5 w-3.5" /> Cancelled
        </li>
      )}
    </ol>
  );
}
