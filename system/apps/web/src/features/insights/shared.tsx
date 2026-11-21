import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtCompact, fmtDate, fmtMoney } from '@/lib/format';
import { Badge, Button, cn, EmptyState, Icon, PageHeader, Spinner, StatusBadge, type Tone } from '@/components/ui';
import { ResourceForm } from '@/features/resources/ResourceForm';
import type { ResourceMeta, Row } from '@/features/resources/types';

// ------------------------------------------------------------------ small building blocks

const PALETTE = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#0d9488', '#ea580c', '#64748b'];
export function colorFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function Avatar({ name, size = 'md', className }: { name?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const s = { sm: 'h-7 w-7 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-16 w-16 text-lg' }[size];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm', s, className)}
      style={{ background: colorFor(name ?? '') }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export const money = (v: unknown) => fmtMoney(v, 0);

/** compact KPI tile used on the detail pages */
export function Kpi({ label, value, hint, icon, tone = 'blue' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string; tone?: Tone }) {
  const bg: Record<Tone, string> = {
    blue: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
    gray: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="card flex items-start gap-3 p-4">
      {icon && (
        <span className={cn('rounded-xl p-2', bg[tone])}>
          <Icon name={icon} className="h-4.5 w-4.5" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-lg font-semibold text-slate-900 tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

/** label / value grid for record details */
export function InfoGrid({ items, cols = 2 }: { items: { label: string; value: ReactNode; wide?: boolean }[]; cols?: 1 | 2 | 3 }) {
  const shown = items.filter((i) => i.value !== undefined);
  return (
    <dl className={cn('grid gap-x-6 gap-y-3.5', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {shown.map((i) => (
        <div key={i.label} className={cn('min-w-0', i.wide && 'sm:col-span-2 lg:col-span-3')}>
          <dt className="text-xs font-medium text-slate-500">{i.label}</dt>
          <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-slate-800">{i.value === null || i.value === '' ? <span className="text-slate-300">—</span> : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** tiny bar chart (no axes) for 12-month trends */
export function MiniBars({ data, height = 64, format = fmtCompact }: { data: { label: string; value: number }[]; height?: number; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${format(d.value)}`}>
          <div
            className={cn('w-full rounded-t-md transition-colors', d.value ? 'bg-brand-400 group-hover:bg-brand-600' : 'bg-slate-100')}
            style={{ height: `${Math.max(d.value ? 6 : 3, (d.value / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'green' | 'amber' | 'red'; className?: string }) {
  const c = { blue: 'bg-brand-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="h-6 w-6 text-brand-600" />
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

/** simple responsive table for detail tabs */
export function MiniTable<T>({
  rows,
  cols,
  empty = 'Nothing yet',
  onRow,
}: {
  rows: T[];
  cols: { header: string; render: (r: T) => ReactNode; align?: 'right'; className?: string }[];
  empty?: string;
  onRow?: (r: T) => void;
}) {
  if (!rows.length) return <Muted>{empty}</Muted>;
  return (
    <div className="scrollbar-thin -mx-5 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-slate-500">
            {cols.map((c) => (
              <th key={c.header} className={cn('px-5 py-2 font-medium', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={onRow ? () => onRow(r) : undefined} className={cn('border-b border-line/70 last:border-0', onRow && 'cursor-pointer hover:bg-slate-50')}>
              {cols.map((c) => (
                <td key={c.header} className={cn('px-5 py-2.5 align-top text-slate-700', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const DOC_LABEL: Record<string, string> = {
  SQ: 'Quotation',
  SO: 'Sales Order',
  DO: 'Delivery',
  SI: 'Invoice',
  PR: 'Purchase Request',
  PO: 'Purchase Order',
  GR: 'Goods Receipt',
  PI: 'Bill',
  ADJ: 'Adjustment',
  TRF: 'Transfer',
};

export function DocRef({ type, id, number }: { type: string; id: string; number: string }) {
  return (
    <Link to={`/documents/${type}/${id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
      {number}
    </Link>
  );
}

export { fmtDate, StatusBadge, Badge };

// ------------------------------------------------------------------ detail page shell

/** meta + record of a resource (detail pages) */
export function useRecord(key: string, id: string | undefined) {
  const meta = useQuery({ queryKey: ['meta', key], queryFn: () => api.get<ResourceMeta>(`/meta/resources/${key}`), staleTime: 300_000 });
  const record = useQuery({ queryKey: ['resource', key, 'one', id], queryFn: () => api.get<Row>(`/resources/${key}/${id}`), enabled: !!id });
  return { meta, record };
}

/**
 * Shared layout of the 360° pages: header with avatar / title / badges / actions, KPI strip and tabs.
 * Includes the generic edit form so every detail page can edit the record in place.
 */
export function DetailShell({
  resource,
  id,
  backTo,
  title,
  subtitle,
  avatar,
  badges,
  actions,
  children,
}: {
  resource: string;
  id: string;
  backTo: string;
  title: (r: Row) => ReactNode;
  subtitle?: (r: Row) => ReactNode;
  avatar?: (r: Row) => ReactNode;
  badges?: (r: Row) => ReactNode;
  actions?: (r: Row) => ReactNode;
  children: (r: Row, meta: ResourceMeta) => ReactNode;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { meta, record } = useRecord(resource, id);
  const [editing, setEditing] = useState(false);
  if (meta.isLoading || record.isLoading) return <Loading />;
  if (record.error || !record.data || !meta.data)
    return (
      <EmptyState
        icon="search-x"
        title="Not found"
        description={(record.error as Error)?.message ?? 'This record does not exist or you have no access to it.'}
        action={<Button onClick={() => navigate(backTo)}>Back to list</Button>}
      />
    );
  const r = record.data;
  return (
    <div>
      <PageHeader
        back={() => (window.history.length > 1 ? navigate(-1) : navigate(backTo))}
        title={
          <span className="flex min-w-0 items-center gap-3">
            {avatar?.(r)}
            <span className="min-w-0">
              <span className="block truncate">{title(r)}</span>
              {badges && <span className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-normal">{badges(r)}</span>}
            </span>
          </span>
        }
        subtitle={subtitle?.(r)}
        actions={
          <>
            {actions?.(r)}
            {meta.data.can.update && (
              <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      />
      {children(r, meta.data)}
      <ResourceForm
        meta={meta.data}
        id={id}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['resource', resource] });
          qc.invalidateQueries({ queryKey: ['insights'] });
        }}
      />
    </div>
  );
}

/** underline tabs for detail pages (keeps the selected tab in the URL hash) */
export function useHashTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const read = () => {
    const h = window.location.hash.slice(1) as T;
    return tabs.includes(h) ? h : fallback;
  };
  const [tab, setTab] = useState<T>(read);
  const set = (t: T) => {
    setTab(t);
    window.history.replaceState(null, '', `#${t}`);
  };
  return [tab, set];
}

export function TabBar<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number | null; hidden?: boolean }[] }) {
  return (
    <div className="scrollbar-thin mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cn('rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>
            )}
          </button>
        ))}
    </div>
  );
}

/** lookup value as coloured badge */
export function LookupBadge({ options, value }: { options: { value: string; label: string; color?: string | null }[]; value?: string | null }) {
  if (!value) return null;
  const o = options.find((x) => x.value === value);
  return <Badge color={o?.color}>{o?.label ?? value}</Badge>;
}
