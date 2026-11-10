import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { Badge, cn, Icon } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { Avatar } from '../shared';

const tenure = (join?: string | null) => {
  if (!join) return null;
  const months = Math.max(0, Math.floor((Date.now() - new Date(join).getTime()) / (30.44 * 86400_000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? `${y}y ${m}m` : `${m}m`;
};

/** Employee directory: people cards grouped by department */
export function EmployeeDirectoryView({ rows, open, renderValue, field }: ResourceViewProps) {
  const [group, setGroup] = useState(true);
  const groups = useMemo(() => {
    if (!group) return [{ key: '', label: '', items: rows }];
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r._labels?.departmentId ?? '';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1)).map(([k, items]) => ({ key: k || '_none', label: k || 'No department', items }));
  }, [rows, group]);
  const emp = field('employmentCode');

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={group} onChange={(e) => setGroup(e.target.checked)} />
          Group by department
        </label>
      </div>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.key || 'all'}>
            {g.label && (
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Icon name="network" className="h-4 w-4 text-slate-400" />
                {g.label}
                <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-500">{g.items.length}</span>
              </h3>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {g.items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open(r)}
                  className={cn('card group flex flex-col p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-pop', r.isActive === false && 'opacity-60')}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={r.fullName} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{r.fullName}</p>
                      <p className="truncate text-xs text-slate-500">{r._labels?.positionId ?? 'No position'}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">{r.code}</p>
                    </div>
                    {r.isActive === false && <Badge>Inactive</Badge>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {emp && r.employmentCode && renderValue(emp, r)}
                    {!group && r._labels?.departmentId && <Badge tone="violet">{r._labels.departmentId}</Badge>}
                    {r._labels?.branchId && <Badge>{r._labels.branchId}</Badge>}
                  </div>
                  <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-slate-600">
                    {r.email && (
                      <p className="flex items-center gap-2 truncate">
                        <Icon name="mail" className="h-3.5 w-3.5 text-slate-400" />
                        <span className="truncate">{r.email}</span>
                      </p>
                    )}
                    {r.phone && (
                      <p className="flex items-center gap-2">
                        <Icon name="phone" className="h-3.5 w-3.5 text-slate-400" />
                        {r.phone}
                      </p>
                    )}
                    {r.joinDate && (
                      <p className="flex items-center gap-2">
                        <Icon name="calendar-check" className="h-3.5 w-3.5 text-slate-400" />
                        Joined {fmtDate(r.joinDate)} · {tenure(r.joinDate)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
