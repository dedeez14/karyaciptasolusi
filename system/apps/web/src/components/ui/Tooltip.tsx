import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './primitives';

type Side = 'right' | 'top' | 'bottom';

/**
 * Lightweight tooltip: dark bubble with arrow, rendered in a portal so it is never clipped by
 * scroll containers. Opens on hover (after a short delay) and on keyboard focus.
 */
export function Tooltip({ content, children, side = 'right', disabled, className, delay = 150 }: { content: ReactNode; children: ReactNode; side?: Side; disabled?: boolean; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    if (disabled || !content) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      if (side === 'right') setPos({ x: r.right + 10, y: r.top + r.height / 2 });
      else if (side === 'top') setPos({ x: r.left + r.width / 2, y: r.top - 8 });
      else setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
    }, delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setPos(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);

  return (
    <div ref={ref} className={cn('relative', className)} onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide}>
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className={cn(
              'pointer-events-none fixed z-[90] max-w-xs rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-pop',
              side === 'right' && '-translate-y-1/2',
              side === 'top' && '-translate-x-1/2 -translate-y-full',
              side === 'bottom' && '-translate-x-1/2',
            )}
            style={{ left: pos.x, top: pos.y }}
          >
            {content}
            <span
              className={cn(
                'absolute h-2 w-2 rotate-45 bg-slate-900',
                side === 'right' && 'top-1/2 -left-1 -translate-y-1/2',
                side === 'top' && '-bottom-1 left-1/2 -translate-x-1/2',
                side === 'bottom' && '-top-1 left-1/2 -translate-x-1/2',
              )}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
