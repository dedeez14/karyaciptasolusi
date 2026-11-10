import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { cn } from './primitives';
import { Icon } from './Icon';
import { Floating } from './Floating';

/**
 * Searchable dropdown whose options come from Master Data > Lookup Values (category).
 * Shows the lookup colour, supports keyboard and offers a "Manage values" shortcut.
 */
export function LookupSelect({
  category,
  value,
  onChange,
  placeholder = 'Select...',
  invalid,
  disabled,
  clearable = true,
  id,
  className,
  'aria-label': ariaLabel,
}: {
  category: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const options = useLookupOptions(category);
  const can = useSession((s) => s.can);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t)) : options;
  }, [options, search]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const dot = (color: string | null | undefined) => (color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : null);

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={ref}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? (current?.label || placeholder)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'Enter') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn('input flex items-center gap-2 text-left', invalid && 'input-error')}
      >
        {dot(current?.color)}
        <span className={cn('flex-1 truncate', !current && !value && 'text-slate-400')}>{current?.label ?? (value || placeholder)}</span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </span>
        )}
        <Icon name="chevrons-up-down" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      <Floating anchorRef={ref} open={open} onClose={() => setOpen(false)} minWidth={210}>
          {options.length > 7 && (
            <div className="shrink-0 border-b border-line p-2">
              <input
                autoFocus
                className="input h-9"
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => keys(e)}
              />
            </div>
          )}
          <ul className="max-h-72 min-h-0 flex-1 overflow-y-auto py-1 outline-none" role="listbox" tabIndex={-1} onKeyDown={(e) => keys(e)} ref={(el) => void (options.length <= 7 && el?.focus())}>
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No values</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={cn('mx-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm', i === active && 'bg-brand-50', o.value === value && 'font-semibold text-brand-700')}
              >
                {dot(o.color)}
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Icon name="check" className="h-4 w-4 text-brand-600" />}
              </li>
            ))}
          </ul>
          {can('system.lookup.read') && (
            <Link to={`/r/lookups?f.category=${encodeURIComponent(category)}`} onClick={() => setOpen(false)} className="flex shrink-0 items-center gap-1.5 border-t border-line bg-slate-50/70 px-3 py-2 text-xs font-medium text-slate-600 hover:text-brand-700">
              <Icon name="settings-2" className="h-3.5 w-3.5" />
              Manage values
            </Link>
          )}
      </Floating>
    </div>
  );

  function keys(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
      ref.current?.focus();
    }
  }
}
