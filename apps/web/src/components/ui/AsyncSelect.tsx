import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { cn, Spinner } from './primitives';
import { Icon } from './Icon';

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
}: {
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
  const ref = useRef<HTMLDivElement>(null);

  const list = useQuery({ queryKey: ['options', resource, q], queryFn: () => api.get<Option[]>(`/resources/${resource}/options`, { search: q }), enabled: open, staleTime: 30_000 });
  const selected = useQuery({
    queryKey: ['options', resource, 'id', value],
    queryFn: () => api.get<Option[]>(`/resources/${resource}/options`, { ids: value }),
    enabled: !!value && !initialLabel,
    staleTime: 300_000,
  });
  const label = useMemo(() => (value ? initialLabel ?? selected.data?.[0]?.label ?? list.data?.find((o) => o.value === value)?.label ?? '...' : ''), [value, initialLabel, selected.data, list.data]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const options = list.data ?? [];
  const pick = (o: Option | null) => {
    onChange(o?.value ?? null, o ?? undefined);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn('input flex items-center justify-between gap-2 text-left', invalid && 'input-error', !value && 'text-slate-400')}
      >
        <span className="truncate">{value ? label : placeholder}</span>
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
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <input
              autoFocus
              className="input py-1.5"
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
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
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
                className={cn('cursor-pointer px-3 py-2 text-sm', i === active && 'bg-brand-50 dark:bg-slate-800', o.value === value && 'font-semibold text-brand-700')}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
