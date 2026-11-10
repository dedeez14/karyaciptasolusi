import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, isoDate } from '@/lib/format';
import { useLookupOptions } from '@/hooks/useLookups';
import { Badge, Button, cn, DatePicker, Icon } from '@/components/ui';
import type { ResourceViewProps } from '@/features/resources/views/types';
import { Loading, money, Muted } from '../shared';

interface Acc {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  isGroup: boolean;
  isActive: boolean;
  debit: number;
  credit: number;
  balance: number;
}
interface Node extends Acc {
  children: Node[];
  total: number;
  depth: number;
}

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const TYPE_ICON: Record<string, string> = { ASSET: 'landmark', LIABILITY: 'scale', EQUITY: 'gem', INCOME: 'trending-up', EXPENSE: 'trending-down' };

/** Chart of accounts as a collapsible tree grouped by account type, with posted balances */
export function AccountTreeView({ params, edit, meta }: ResourceViewProps) {
  const [asOf, setAsOf] = useState(isoDate());
  const types = useLookupOptions('ACCOUNT_TYPE');
  const q = useQuery({ queryKey: ['insights', 'accounts', asOf], queryFn: () => api.get<{ balances: boolean; accounts: Acc[] }>('/insights/accounts/tree', { asOf }) });
  const search = String(params.search ?? '')
    .trim()
    .toLowerCase();
  const [open, setOpen] = useState<Set<string> | 'all'>('all');
  const [hideZero, setHideZero] = useState(false);

  const groups = useMemo(() => {
    const list = q.data?.accounts ?? [];
    const byId = new Map<string, Node>(list.map((a) => [a.id, { ...a, children: [], total: 0, depth: 0 }]));
    const roots: Node[] = [];
    for (const n of byId.values()) {
      const p = n.parentId ? byId.get(n.parentId) : undefined;
      if (p) p.children.push(n);
      else roots.push(n);
    }
    const sum = (n: Node, depth: number): number => {
      n.depth = depth;
      n.children.sort((a, b) => a.code.localeCompare(b.code));
      n.total = n.balance + n.children.reduce((a, c) => a + sum(c, depth + 1), 0);
      return n.total;
    };
    roots.forEach((r) => sum(r, 0));
    // search: keep matches and their ancestors
    const keep = (n: Node): Node | null => {
      const kids = n.children.map(keep).filter((x): x is Node => !!x);
      const hit = !search || n.code.toLowerCase().includes(search) || n.name.toLowerCase().includes(search);
      const nonZero = !hideZero || Math.abs(n.total) > 0.004;
      return (hit && nonZero) || kids.length ? { ...n, children: kids } : null;
    };
    return TYPE_ORDER.map((t) => {
      const rs = roots.filter((r) => r.type === t).sort((a, b) => a.code.localeCompare(b.code));
      return { type: t, total: rs.reduce((a, r) => a + r.total, 0), nodes: rs.map(keep).filter((x): x is Node => !!x) };
    });
  }, [q.data, search, hideZero]);

  const isOpen = (id: string) => open === 'all' || open.has(id) || !!search;
  const toggle = (id: string) =>
    setOpen((prev) => {
      const s = new Set(prev === 'all' ? (q.data?.accounts ?? []).map((a) => a.id) : prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  if (q.isLoading) return <Loading />;
  const showBal = !!q.data?.balances;
  const t = Object.fromEntries(groups.map((g) => [g.type, g.total]));
  const profit = (t.INCOME ?? 0) - (t.EXPENSE ?? 0);
  const diff = (t.ASSET ?? 0) - ((t.LIABILITY ?? 0) + (t.EQUITY ?? 0) + profit);

  const row = (n: Node) => (
    <div key={n.id}>
      <div className={cn('group flex items-center gap-2 border-b border-line/60 py-2 pr-2 text-sm hover:bg-slate-50', !n.isActive && 'opacity-60')} style={{ paddingLeft: 8 + n.depth * 20 }}>
        {n.children.length ? (
          <button type="button" onClick={() => toggle(n.id)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={isOpen(n.id) ? 'Collapse' : 'Expand'}>
            <Icon name={isOpen(n.id) ? 'chevron-down' : 'chevron-right'} className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button type="button" disabled={!meta.can.update} onClick={() => edit(n.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
          <span className="w-16 shrink-0 font-mono text-xs text-slate-500">{n.code}</span>
          <span className={cn('truncate', n.isGroup || n.children.length ? 'font-semibold text-slate-900' : 'text-slate-700')}>{n.name}</span>
          {!n.isActive && <Badge>Inactive</Badge>}
        </button>
        {showBal && (
          <>
            <span className="hidden w-32 text-right text-xs text-slate-400 tabular-nums lg:block">{n.debit ? money(n.debit) : ''}</span>
            <span className="hidden w-32 text-right text-xs text-slate-400 tabular-nums lg:block">{n.credit ? money(n.credit) : ''}</span>
            <span className={cn('w-36 text-right tabular-nums', n.children.length ? 'font-semibold text-slate-900' : 'text-slate-700', n.total < 0 && 'text-red-600')}>{money(n.total)}</span>
          </>
        )}
      </div>
      {isOpen(n.id) && n.children.map(row)}
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {showBal && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Balances as of</span>
            <div className="w-44">
              <DatePicker value={asOf} onChange={(v) => setAsOf(v || isoDate())} clearable={false} />
            </div>
          </div>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {showBal && (
            <Button variant={hideZero ? 'secondary' : 'outline'} size="sm" icon="eye-off" onClick={() => setHideZero((v) => !v)}>
              Hide zero
            </Button>
          )}
          <Button variant="outline" size="sm" icon="chevrons-down" onClick={() => setOpen('all')}>
            Expand all
          </Button>
          <Button variant="outline" size="sm" icon="chevrons-up" onClick={() => setOpen(new Set())}>
            Collapse
          </Button>
        </div>
      </div>
      {groups.every((g) => !g.nodes.length) && <Muted>No accounts match.</Muted>}
      <div className="space-y-4">
        {groups
          .filter((g) => g.nodes.length)
          .map((g) => (
            <section key={g.type} className="overflow-hidden rounded-xl border border-line">
              <header className="flex items-center gap-2 bg-slate-50 px-3 py-2.5">
                <Icon name={TYPE_ICON[g.type] ?? 'folder'} className="h-4 w-4 text-brand-600" />
                <h3 className="flex-1 text-sm font-semibold text-slate-900">{types.find((x) => x.value === g.type)?.label ?? g.type}</h3>
                {showBal && (
                  <>
                    <span className="hidden w-32 text-right text-[11px] font-medium text-slate-400 uppercase lg:block">Debit</span>
                    <span className="hidden w-32 text-right text-[11px] font-medium text-slate-400 uppercase lg:block">Credit</span>
                    <span className="w-36 text-right text-sm font-semibold text-slate-900 tabular-nums">{money(g.total)}</span>
                  </>
                )}
              </header>
              <div>{g.nodes.map(row)}</div>
            </section>
          ))}
      </div>
      {showBal && !search && (
        <div
          className={cn(
            'mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border px-4 py-3 text-sm',
            Math.abs(diff) < 0.01 ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Icon name={Math.abs(diff) < 0.01 ? 'check-circle-2' : 'alert-triangle'} className="h-4 w-4" />
            {Math.abs(diff) < 0.01 ? 'Books are balanced' : `Out of balance by ${money(diff)}`}
          </span>
          <span>Profit / loss to date: {money(profit)}</span>
          <span className="text-xs opacity-80">as of {fmtDate(asOf)}</span>
        </div>
      )}
    </div>
  );
}
