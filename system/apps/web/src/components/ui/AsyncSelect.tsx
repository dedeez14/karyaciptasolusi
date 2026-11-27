import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, Spinner } from './primitives';
import { Icon } from './Icon';
import { Floating } from './Floating';

interface Option {
  value: string;
  label: string;
}

/**
 * Searchable select backed by /resources/:key/options (works for every master data resource).
 * Keyboard accessible, mobile friendly.
 */
export function AsyncSelect({
  resource,
  value,
  onChange,
  placeholder = 'Select...',
  invalid,
  disabled,
  initialLabel,
  manageHref,
  manageLabel,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  className?: string;
  id?: string;
  'aria-label'?: string;
  /** optional link to the master data page of this list (shown in the dropdown footer) */
  manageHref?: string;
  manageLabel?: string;
  resource: string;
  value: string | null | undefined;
  onChange: (v: string | null, opt?: Option) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  initialLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounce(search, 250);
  const ref = useRef<HTMLButtonElement>(null);

  const list = useQuery({ queryKey: ['options', resource, q], queryFn: () => api.get<Option[]>(`/resources/${resource}/options`, { search: q }), enabled: open, staleTime: 30_000 });
  const selected = useQuery({
    queryKey: ['options', resource, 'id', value],
    queryFn: () => api.get<Option[]>(`/resources/${resource}/options`, { ids: value }),
    enabled: !!value && !initialLabel,
    staleTime: 300_000,
  });
  const label = useMemo(() => (value ? initialLabel ?? selected.data?.[0]?.label ?? list.data?.find((o) => o.value === value)?.label ?? '...' : ''), [value, initialLabel, selected.data, list.data]);

  const options = list.data ?? [];
  const pick = (o: Option | null) => {
    onChange(o?.value ?? null, o ?? undefined);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative min-w-0">
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        id={id}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? label : placeholder}` : value ? label : placeholder}
        title={value ? label : undefined}
        className={cn('input flex items-center justify-between gap-2 text-left', invalid && 'input-error', !value && 'text-slate-400', className)}
      >
        <span className="min-w-0 truncate">{value ? label : placeholder}</span>
        <span className="flex items-center gap-1">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                pick(null);
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
              aria-label="Clear"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </span>
          )}
          <Icon name="chevrons-up-down" className="h-3.5 w-3.5 text-slate-400" />
        </span>
      </button>
      <Floating anchorRef={ref} open={open} onClose={() => setOpen(false)} minWidth={260}>
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
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
                else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (options[active]) pick(options[active]);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                  ref.current?.focus();
                }
              }}
            />
          </div>
          <ul className="max-h-72 min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
            {list.isFetching && (
              <li className="flex justify-center py-3">
                <Spinner className="h-4 w-4 text-slate-400" />
              </li>
            )}
            {!list.isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No results</li>}
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                title={o.label}
                className={cn('mx-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm', i === active && 'bg-brand-50', o.value === value && 'font-semibold text-brand-700')}
              >
                <span className="flex-1 break-words">{o.label}</span>
                {o.value === value && <Icon name="check" className="h-4 w-4 shrink-0 text-brand-600" />}
              </li>
            ))}
          </ul>
          {manageHref && (
            <Link to={manageHref} onClick={() => setOpen(false)} className="flex shrink-0 items-center gap-1.5 border-t border-line bg-slate-50/70 px-3 py-2 text-xs font-medium text-slate-600 hover:text-brand-700">
              <Icon name="settings-2" className="h-3.5 w-3.5" />
              {manageLabel ?? 'Manage list'}
            </Link>
          )}
      </Floating>
    </div>
  );
}
