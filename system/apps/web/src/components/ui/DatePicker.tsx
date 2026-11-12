import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getLocale } from '@/lib/format';
import { createPortal } from 'react-dom';
import { cn } from './primitives';
import { Icon } from './Icon';

/** value format: 'YYYY-MM-DD' ('' = empty) */
export interface DatePickerProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  clearable?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v?: string | null) => {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * Consistent, accessible date picker used by every form and filter (replaces the browser's native date input).
 * Keyboard: arrows move the day, PageUp/PageDown change month, Enter selects, Escape closes.
 */
export function DatePicker({ value, onChange, placeholder = 'Select date', invalid, disabled, min, max, clearable = true, className, id, ...rest }: DatePickerProps) {
  const selected = parse(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected ?? new Date());
  const [focus, setFocus] = useState<Date>(() => selected ?? new Date());
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const minD = parse(min);
  const maxD = parse(max);
  const today = new Date();

  const label = selected ? selected.toLocaleDateString(getLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  useEffect(() => {
    if (!open) return;
    const s = parse(value) ?? new Date();
    setView(s);
    setFocus(s);
    setMode('days');
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const h = 360;
      const up = r.bottom + h > window.innerHeight && r.top > h;
      setPos({ top: up ? r.top - 8 : r.bottom + 6, left: Math.min(r.left, window.innerWidth - 300), up });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => popRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // monday first
    return Array.from({ length: 42 }, (_, i) => new Date(view.getFullYear(), view.getMonth(), 1 - offset + i));
  }, [view]);

  const outOfRange = (d: Date) => (minD && d < minD) || (maxD && d > maxD);
  const same = (a: Date | null, b: Date | null) => !!a && !!b && a.toDateString() === b.toDateString();
  const pick = (d: Date) => {
    if (outOfRange(d)) return;
    onChange(toIso(d));
    setOpen(false);
    btnRef.current?.focus();
  };
  const moveFocus = (d: Date) => {
    setFocus(d);
    if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) setView(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (mode !== 'days') return;
    const f = new Date(focus);
    const map: Record<string, () => void> = {
      ArrowLeft: () => f.setDate(f.getDate() - 1),
      ArrowRight: () => f.setDate(f.getDate() + 1),
      ArrowUp: () => f.setDate(f.getDate() - 7),
      ArrowDown: () => f.setDate(f.getDate() + 7),
      PageUp: () => f.setMonth(f.getMonth() - 1),
      PageDown: () => f.setMonth(f.getMonth() + 1),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
      moveFocus(f);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(focus);
    } else if (e.key === 'Escape') {
      setOpen(false);
      btnRef.current?.focus();
    }
  };

  const yearStart = view.getFullYear() - (view.getFullYear() % 12);

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={rest['aria-label'] ?? (label || placeholder)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn('input flex items-center gap-2 text-left', invalid && 'input-error', className)}
      >
        <Icon name="calendar" className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={cn('flex-1 truncate', !label && 'text-slate-400')}>{label || placeholder}</span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose date"
            tabIndex={-1}
            onKeyDown={onKey}
            className="fixed z-[80] w-[288px] rounded-2xl border border-line bg-white p-3 shadow-pop outline-none"
            style={{ left: pos.left, top: pos.top, transform: pos.up ? 'translateY(-100%)' : undefined }}
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-900 hover:bg-slate-100"
                onClick={() => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days')}
              >
                {mode === 'years' ? `${yearStart} – ${yearStart + 11}` : mode === 'months' ? view.getFullYear() : view.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' })}
                <Icon name="chevron-down" className="ml-1 inline h-3.5 w-3.5 text-slate-400" />
              </button>
              <div className="flex gap-1">
                {(['prev', 'next'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    aria-label={dir === 'prev' ? 'Previous' : 'Next'}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => {
                      const step = dir === 'prev' ? -1 : 1;
                      if (mode === 'days') setView(new Date(view.getFullYear(), view.getMonth() + step, 1));
                      else if (mode === 'months') setView(new Date(view.getFullYear() + step, view.getMonth(), 1));
                      else setView(new Date(view.getFullYear() + step * 12, view.getMonth(), 1));
                    }}
                  >
                    <Icon name={dir === 'prev' ? 'chevron-left' : 'chevron-right'} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            {mode === 'days' && (
              <>
                <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="py-1">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5" role="grid">
                  {days.map((d) => {
                    const inMonth = d.getMonth() === view.getMonth();
                    const isSel = same(d, selected);
                    const isToday = same(d, today);
                    const isFocus = same(d, focus);
                    const disabledDay = outOfRange(d);
                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        role="gridcell"
                        aria-selected={isSel}
                        disabled={!!disabledDay}
                        onClick={() => pick(d)}
                        onMouseEnter={() => setFocus(d)}
                        className={cn(
                          'relative flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                          !inMonth && 'text-slate-300',
                          inMonth && !isSel && 'text-slate-700',
                          isFocus && !isSel && 'bg-slate-100',
                          isSel && 'bg-brand-600 font-semibold text-white shadow-sm',
                          isToday && !isSel && 'font-semibold text-brand-700',
                          disabledDay && 'cursor-not-allowed opacity-30',
                        )}
                      >
                        {d.getDate()}
                        {isToday && !isSel && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brand-600" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {mode === 'months' && (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setView(new Date(view.getFullYear(), m, 1));
                      setMode('days');
                    }}
                    className={cn('rounded-lg py-2.5 text-sm hover:bg-slate-100', selected && selected.getMonth() === m && selected.getFullYear() === view.getFullYear() && 'bg-brand-600 font-semibold text-white hover:bg-brand-600')}
                  >
                    {new Date(2000, m, 1).toLocaleDateString(getLocale(), { month: 'short' })}
                  </button>
                ))}
              </div>
            )}

            {mode === 'years' && (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setView(new Date(y, view.getMonth(), 1));
                      setMode('months');
                    }}
                    className={cn('rounded-lg py-2.5 text-sm tabular-nums hover:bg-slate-100', selected?.getFullYear() === y && 'bg-brand-600 font-semibold text-white hover:bg-brand-600')}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50" onClick={() => pick(new Date())} disabled={!!outOfRange(today)}>
                Today
              </button>
              {clearable && (
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                  onClick={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
