import { useEffect, useRef, useState } from 'react';
import { cn } from './primitives';
import { Icon } from './Icon';
import { Floating } from './Floating';
import type { SelectChange } from './Select';

const pad = (n: number) => String(n).padStart(2, '0');
const ev = (value: string): SelectChange => ({ target: { value }, currentTarget: { value } });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "930" / "9.30" / "09:30" -> "09:30"; '' when it is not a time */
export function normalizeTime(raw: string) {
  const d = raw.replace(/[^\d]/g, '');
  if (!d) return '';
  const [h, m] = d.length <= 2 ? [Number(d), 0] : [Number(d.slice(0, d.length - 2)), Number(d.slice(-2))];
  if (h > 23 || m > 59) return '';
  return `${pad(h)}:${pad(m)}`;
}

interface Common {
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

/**
 * Time field (HH:MM, 24 hours) without the browser's own picker: type it ("930" becomes 09:30) or pick from the
 * hour / minute columns. onChange receives a change-like event, so `(e) => set(e.target.value)` works.
 */
export function TimeInput({ value, onChange, step = 5, className, invalid, disabled, id, 'aria-label': ariaLabel }: Common & { value: string; onChange: (e: SelectChange) => void; step?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const [h, m] = (value || '').split(':');
  const commit = (v: string) => {
    if (v !== value) onChange(ev(v));
    setText(v);
  };
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (m && !minutes.includes(Number(m))) minutes.push(Number(m));
  minutes.sort((a, b) => a - b);

  return (
    <>
      <div ref={box} className={cn('input flex items-center gap-2 pr-2', invalid && 'input-error', disabled && 'cursor-not-allowed opacity-60', className)}>
        <input
          id={id}
          aria-label={ariaLabel}
          inputMode="numeric"
          placeholder="--:--"
          maxLength={5}
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d:.]/g, ''))}
          onBlur={() => commit(normalizeTime(text))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(normalizeTime(text));
            if (e.key === 'ArrowDown' && e.altKey) setOpen(true);
          }}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-sm tabular-nums outline-none focus:ring-0"
        />
        <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Pick a time">
          <Icon name="clock" className="h-4 w-4" />
        </button>
      </div>
      <Floating anchorRef={box} open={open} onClose={() => setOpen(false)} matchWidth={false} width={200} preferredHeight={290}>
        <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-line">
            {[
              { label: 'Hour', items: Array.from({ length: 24 }, (_, i) => i), cur: h, set: (n: number) => commit(`${pad(n)}:${m || '00'}`) },
              { label: 'Min', items: minutes, cur: m, set: (n: number) => commit(`${h || '08'}:${pad(n)}`) },
            ].map((col) => (
              <div key={col.label} className="flex min-h-0 flex-col">
                <p className="border-b border-line px-2 py-1.5 text-center text-[11px] font-semibold text-slate-400 uppercase">{col.label}</p>
                <ul className="max-h-52 overflow-y-auto p-1">
                  {col.items.map((n) => {
                    const sel = col.cur !== undefined && col.cur !== '' && Number(col.cur) === n;
                    return (
                      <li key={n}>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el && sel) el.scrollIntoView({ block: 'center' });
                          }}
                          onClick={() => col.set(n)}
                          className={cn('w-full rounded-md py-1.5 text-center text-sm tabular-nums', sel ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-100')}
                        >
                          {pad(n)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-line px-2 py-1.5 text-xs">
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => {
              const d = new Date();
              commit(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
              setOpen(false);
            }}>
              Now
            </button>
            <span className="flex gap-3">
              <button type="button" className="text-slate-500 hover:underline" onClick={() => (commit(''), setOpen(false))}>
                Clear
              </button>
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(false)}>
                Done
              </button>
            </span>
          </div>
        </div>
      </Floating>
    </>
  );
}

/** Month field (YYYY-MM) with a year / month grid instead of the browser's picker */
export function MonthInput({ value, onChange, min, max, className, invalid, disabled, id, 'aria-label': ariaLabel, placeholder = 'Select month' }: Common & { value: string; onChange: (e: SelectChange) => void; min?: string; max?: string; placeholder?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value || new Date().toISOString()).slice(0, 4)));
  useEffect(() => {
    if (open) setYear(Number((value || max || new Date().toISOString()).slice(0, 4)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const label = value ? `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : placeholder;
  const off = (k: string) => (!!min && k < min) || (!!max && k > max);

  return (
    <>
      <button ref={ref} type="button" id={id} disabled={disabled} aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cn('input flex items-center gap-2 text-left', invalid && 'input-error', className)}>
        <Icon name="calendar" className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-slate-400')}>{label}</span>
        <Icon name="chevron-down" className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      <Floating anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false} width={248}>
        <div className="p-3" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setYear((y) => y - 1)} disabled={!!min && `${year - 1}-12` < min} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Previous year">
              <Icon name="chevron-left" className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tabular-nums">{year}</span>
            <button type="button" onClick={() => setYear((y) => y + 1)} disabled={!!max && `${year + 1}-01` > max} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Next year">
              <Icon name="chevron-right" className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((mn, i) => {
              const k = `${year}-${pad(i + 1)}`;
              const sel = k === value;
              return (
                <button
                  key={mn}
                  type="button"
                  disabled={off(k)}
                  onClick={() => {
                    onChange(ev(k));
                    setOpen(false);
                  }}
                  className={cn('rounded-lg py-2 text-sm', sel ? 'bg-brand-600 font-semibold text-white' : 'hover:bg-slate-100', off(k) && 'cursor-not-allowed text-slate-300 hover:bg-transparent')}
                >
                  {mn}
                </button>
              );
            })}
          </div>
        </div>
      </Floating>
    </>
  );
}
