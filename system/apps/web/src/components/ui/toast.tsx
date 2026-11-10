import { create } from 'zustand';
import { ApiError } from '@/lib/api';
import { cn } from './primitives';
import { Icon } from './Icon';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}
const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let seq = 0;

function push(kind: Toast['kind'], message: string) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), { id, kind, message }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
}

export const toast = {
  success: (m: string) => push('success', m),
  info: (m: string) => push('info', m),
  error: (e: unknown) => push('error', e instanceof ApiError || e instanceof Error ? e.message : String(e)),
};

export function ToastHost() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-pop',
            t.kind === 'success' && 'bg-emerald-600',
            t.kind === 'error' && 'bg-red-600',
            t.kind === 'info' && 'bg-slate-900',
          )}
        >
          <Icon name={t.kind === 'success' ? 'check-circle-2' : t.kind === 'error' ? 'alert-circle' : 'info'} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
