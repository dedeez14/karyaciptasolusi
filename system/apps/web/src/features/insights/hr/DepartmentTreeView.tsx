import { useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, cn, Icon } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { Avatar, Loading, Muted } from '../shared';

interface Dep {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  headcount: number | null;
  members: { id: string; fullName: string; position: string | null }[];
}
interface Node extends Dep {
  children: Node[];
  total: number;
}

/** Organisation structure: nested departments with head count and people */
export function DepartmentTreeView({ edit, meta, params }: ResourceViewProps) {
  const q = useQuery({ queryKey: ['insights', 'departments'], queryFn: () => api.get<{ headcount: boolean; unassigned: number; departments: Dep[] }>('/insights/departments') });
  const search = String(params.search ?? '').toLowerCase();
  const roots = useMemo(() => {
    const byId = new Map<string, Node>((q.data?.departments ?? []).map((d) => [d.id, { ...d, children: [], total: 0 }]));
    const rs: Node[] = [];
    for (const n of byId.values()) (n.parentId && byId.get(n.parentId) ? byId.get(n.parentId)!.children : rs).push(n);
    const sum = (n: Node): number => (n.total = (n.headcount ?? 0) + n.children.reduce((a, c) => a + sum(c), 0));
    rs.forEach(sum);
    const keep = (n: Node): Node | null => {
      const kids = n.children.map(keep).filter((x): x is Node => !!x);
      return !search || n.name.toLowerCase().includes(search) || n.code.toLowerCase().includes(search) || kids.length ? { ...n, children: kids } : null;
    };
    return rs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(keep)
      .filter((x): x is Node => !!x);
  }, [q.data, search]);

  if (q.isLoading) return <Loading />;
  if (!roots.length) return <Muted>No departments{search ? ' match your search' : ''}.</Muted>;
  const total = roots.reduce((a, r) => a + r.total, 0) + (q.data?.unassigned ?? 0);

  const node = (n: Node, depth: number) => (
    <li key={n.id} className="relative">
      <div className={cn('card flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center', !n.isActive && 'opacity-60')}>
        <button type="button" disabled={!meta.can.update} onClick={() => edit(n.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
          <span className={cn('rounded-xl p-2', depth === 0 ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}>
            <Icon name={depth === 0 ? 'building-2' : 'network'} className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-900">{n.name}</span>
            <span className="block font-mono text-[11px] text-slate-400">{n.code}</span>
          </span>
          {!n.isActive && <Badge>Inactive</Badge>}
        </button>
        {q.data?.headcount && (
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              {n.members.slice(0, 5).map((m) => (
                <Link key={m.id} to={`/employees/${m.id}`} title={`${m.fullName}${m.position ? ` · ${m.position}` : ''}`} className="rounded-full ring-2 ring-white">
                  <Avatar name={m.fullName} size="sm" />
                </Link>
              ))}
              {(n.headcount ?? 0) > 5 && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white">+{(n.headcount ?? 0) - 5}</span>
              )}
            </div>
            <span className="text-xs whitespace-nowrap text-slate-500">
              <b className="text-slate-800">{n.headcount}</b> people{n.children.length ? ` · ${n.total} incl. sub-units` : ''}
            </span>
          </div>
        )}
      </div>
      {n.children.length > 0 && (
        <ul className="mt-2 ml-5 space-y-2 border-l-2 border-dashed border-slate-200 pl-4">{n.children.sort((a, b) => a.name.localeCompare(b.name)).map((c) => node(c, depth + 1))}</ul>
      )}
    </li>
  );

  return (
    <div>
      {q.data?.headcount && (
        <p className="mb-3 text-sm text-slate-500">
          <b className="text-slate-800">{total}</b> active employees{q.data.unassigned ? ` · ${q.data.unassigned} without a department` : ''}
        </p>
      )}
      <ul className="space-y-2">{roots.map((r) => node(r, 0))}</ul>
    </div>
  );
}
