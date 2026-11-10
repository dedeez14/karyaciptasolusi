import type { ReactNode } from 'react';
import { Button, cn, EmptyState, Spinner } from './primitives';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** hide on small screens (cards still show it) */
  hideOnMobile?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  sort?: { field?: string; order: 'asc' | 'desc' };
  onSort?: (field: string) => void;
  actions?: (row: T) => ReactNode;
  empty?: ReactNode;
  selectable?: { selected: Set<string>; onChange: (s: Set<string>) => void };
  footer?: ReactNode;
}

/** long free text may wrap; short values (dates, amounts, codes, badges) stay on one line */
const isLong = (v: unknown) => typeof v === 'string' && v.length > 40;

/** Responsive table: classic table on desktop, card list on phones. */
export function DataTable<T>({ columns, rows, rowKey, loading, onRowClick, sort, onSort, actions, empty, selectable, footer }: Props<T>) {
  const allSelected = !!selectable && rows.length > 0 && rows.every((r) => selectable.selected.has(rowKey(r)));
  const toggleAll = () => selectable && selectable.onChange(allSelected ? new Set() : new Set(rows.map(rowKey)));
  const toggle = (id: string) => {
    if (!selectable) return;
    const s = new Set(selectable.selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selectable.onChange(s);
  };
  const cell = (c: Column<T>, r: T) => (c.render ? c.render(r) : String((r as any)[c.key] ?? ''));

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/60 pt-16 backdrop-blur-[1px]">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      )}
      {/* desktop */}
      <div className="scrollbar-thin hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" className="accent-brand-700" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-3 whitespace-nowrap', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                  {c.sortable && onSort ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => onSort(c.key)}>
                      {c.header}
                      <Icon name={sort?.field === c.key ? (sort.order === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'} className="h-3 w-3" />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
              {actions && <th className="w-12 px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('border-b border-line/70 transition-colors last:border-0 hover:bg-slate-50/80', onRowClick && 'cursor-pointer hover:bg-brand-50/60')}
              >
                {selectable && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-brand-700" checked={selectable.selected.has(rowKey(r))} onChange={() => toggle(rowKey(r))} aria-label="Select row" />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle text-slate-700 first:font-medium first:text-slate-900', isLong((r as any)[c.key]) ? 'min-w-64 whitespace-normal' : 'whitespace-nowrap', c.align === 'right' && 'text-right tabular-nums', c.align === 'center' && 'text-center', c.className)}>
                    {cell(c, r)}
                  </td>
                ))}
                {actions && (
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {actions(r)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {footer}
        </table>
      </div>
      {/* mobile */}
      <div className="divide-y divide-line md:hidden">
        {rows.map((r) => (
          <div key={rowKey(r)} className={cn('flex gap-3 px-4 py-3.5', onRowClick && 'active:bg-brand-50/60')} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {selectable && (
              <input type="checkbox" className="mt-1 accent-brand-700" checked={selectable.selected.has(rowKey(r))} onClick={(e) => e.stopPropagation()} onChange={() => toggle(rowKey(r))} />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="mb-1 font-semibold text-slate-900">{cell(columns[0], r)}</div>
              {columns.slice(1).map((c) => (
                <div key={c.key} className="flex justify-between gap-3 text-xs">
                  <span className="text-slate-500">{c.header}</span>
                  <span className="truncate text-right text-slate-700">{cell(c, r)}</span>
                </div>
              ))}
            </div>
            {actions && <div onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
          </div>
        ))}
      </div>
      {!loading && rows.length === 0 && (empty ?? <EmptyState title="No data found" description="Try changing the filters or add a new record." />)}
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage, onPageSize }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize?: (s: number) => void }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm sm:flex-row">
      <div className="flex items-center gap-2 text-slate-500">
        <span>
          {from}-{to} of {total}
        </span>
        {onPageSize && (
          <select className="rounded-md border border-line bg-white px-1.5 py-1 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 20, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="px-2 font-medium text-slate-700">
          {page} / {totalPages}
        </span>
        <Button size="sm" variant="outline" icon="chevron-right" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </div>
  );
}
