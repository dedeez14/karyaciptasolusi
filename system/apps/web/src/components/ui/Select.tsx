import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from './primitives';
import { Icon } from './Icon';
import { Floating } from './Floating';

export interface SelectOption {
  value: string;
  label: string;
  /** optional leading icon (lucide name) */
  icon?: string;
  /** optional second line */
  hint?: string;
  disabled?: boolean;
}

/** what onChange receives - shaped like a change event so `(e) => set(e.target.value)` keeps working */
export interface SelectChange {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

export interface SelectProps {
  value?: string | number | null;
  onChange?: (e: SelectChange) => void;
  options: SelectOption[];
  /** first entry meaning "nothing chosen" (value ''); also shown in the closed box when nothing is chosen */
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  title?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  /** shown before the label in the closed box */
  leading?: ReactNode;
  /** show a search box (default: when there are more than 8 options) */
  searchable?: boolean;
  /** width of the open list in px when wider than the box */
  menuWidth?: number;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  onBlur?: () => void;
}

/**
 * Drop-in replacement for a native <select>: same value / onChange(e.target.value) / options API, but a styled list
 * that matches the app on every platform (no OS popup), with keyboard support, type-ahead and search on long lists.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onChange, options, placeholder, invalid, disabled, required, className, id, name, title, autoFocus, leading, searchable, menuWidth, onClick, onBlur, 'aria-label': ariaLabel, 'aria-describedby': describedBy },
  outer,
) {
  const ref = useRef<HTMLButtonElement>(null);
  useImperativeHandle(outer, () => ref.current as HTMLButtonElement);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });

  const current = value === null || value === undefined ? '' : String(value);
  const all = useMemo<SelectOption[]>(() => (placeholder !== undefined ? [{ value: '', label: placeholder }, ...options] : options), [options, placeholder]);
  const withSearch = searchable ?? options.length > 8;
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? all.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : all;
  }, [all, search]);
  const selected = all.find((o) => o.value === current);
  const display = selected && (selected.value !== '' || placeholder !== undefined) ? selected.label : current ? current : placeholder ?? '';
  const empty = current === '';

  const emit = (v: string) => {
    const t = { value: v, name };
    onChange?.({ target: t, currentTarget: t });
  };
  const pick = (o: SelectOption) => {
    if (o.disabled) return;
    if (o.value !== current) emit(o.value);
    close();
  };
  const close = () => {
    setOpen(false);
    setSearch('');
    ref.current?.focus();
    onBlur?.();
  };
  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, all.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  // keep the highlighted row in view
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (dir: 1 | -1, from = active) => {
    let i = from;
    for (let n = 0; n < shown.length; n++) {
      i = Math.min(Math.max(i + dir, 0), shown.length - 1);
      if (!shown[i]?.disabled) break;
    }
    setActive(i);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close();
    } else if (!withSearch && e.key.length === 1 && /\S/.test(e.key)) {
      // type-ahead: jump to the next option starting with the typed letters
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const t = typed.current.text;
      const start = t.length === 1 ? active + 1 : active;
      const order = [...shown.slice(start), ...shown.slice(0, start)];
      const hit = order.find((o) => o.label.toLowerCase().startsWith(t));
      if (hit) setActive(shown.indexOf(hit));
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        id={id}
        title={title ?? (display || undefined)}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${display}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        onClick={(e) => {
          onClick?.(e);
          if (open) close();
          else openList();
        }}
        onKeyDown={(e) => {
          if (open) return onListKey(e);
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            openList();
          }
        }}
        className={cn('input flex min-w-0 items-center gap-2 text-left', invalid && 'input-error', open && 'border-brand-400 ring-2 ring-brand-500/15', disabled && 'cursor-not-allowed', className)}
      >
        {leading}
        {selected?.icon && <Icon name={selected.icon} className="h-4 w-4 shrink-0 text-slate-500" />}
        <span className={cn('min-w-0 flex-1 truncate', empty && 'text-slate-400')}>{display || ' '}</span>
        <Icon name="chevron-down" className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      <Floating anchorRef={ref} open={open} onClose={() => (setOpen(false), setSearch(''))} minWidth={menuWidth ?? 180} preferredHeight={320}>
        {/* the list lives in a portal: keep its clicks from reaching clickable rows / cards around the select */}
        <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {withSearch && (
            <div className="shrink-0 border-b border-line p-2">
              <div className="relative">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  className="input h-8 pl-8 text-sm"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onListKey}
                  aria-label="Search options"
                />
              </div>
            </div>
          )}
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={withSearch ? -1 : 0}
            autoFocus={!withSearch}
            aria-label={ariaLabel}
            onKeyDown={withSearch ? undefined : onListKey}
            className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
          >
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
            {shown.map((o, i) => {
              const sel = o.value === current;
              return (
                <li
                  key={o.value || '__empty'}
                  data-i={i}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                    i === active && 'bg-slate-100',
                    sel && 'font-medium text-brand-700',
                    o.value === '' && placeholder !== undefined && !sel && 'text-slate-500',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {o.icon && <Icon name={o.icon} className="h-4 w-4 shrink-0 text-slate-500" />}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{o.label}</span>
                    {o.hint && <span className="block text-xs font-normal text-slate-400">{o.hint}</span>}
                  </span>
                  <Icon name="check" className={cn('h-4 w-4 shrink-0 text-brand-600', !sel && 'invisible')} />
                </li>
              );
            })}
          </ul>
        </div>
      </Floating>
    </>
  );
});
