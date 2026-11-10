import { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, type MenuNode } from '@/stores/session';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import '@/hooks/useTheme';
import { Button, cn, Dropdown, Icon, Spinner, toast } from '@/components/ui';
import { PwaPrompt } from './PwaPrompt';
import { ErrorBoundary } from './ErrorBoundary';

function MenuItem({ node, depth, onNavigate, open, toggle }: { node: MenuNode; depth: number; onNavigate: () => void; open: Set<string>; toggle: (c: string) => void }) {
  if (node.children.length) {
    const isOpen = open.has(node.code);
    return (
      <li>
        <button
          type="button"
          onClick={() => toggle(node.code)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-800"
          aria-expanded={isOpen}
        >
          <Icon name={node.icon} className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">{node.label}</span>
          <Icon name="chevron-down" className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
        </button>
        {isOpen && (
          <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-slate-200 pl-2">
            {node.children.map((c) => (
              <MenuItem key={c.id} node={c} depth={depth + 1} onNavigate={onNavigate} open={open} toggle={toggle} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <NavLink
        to={node.path ?? '/'}
        end={node.path === '/'}
        onClick={onNavigate}
        className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-100' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
      >
        {depth === 0 && <Icon name={node.icon} className="h-4 w-4 shrink-0" />}
        <span className="truncate">{node.label}</span>
      </NavLink>
    </li>
  );
}

function findParents(nodes: MenuNode[], path: string, trail: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.path && n.path !== '/' && path.startsWith(n.path)) return trail;
    const r = findParents(n.children, path, [...trail, n.code]);
    if (r) return r;
  }
  return null;
}

export function AppLayout() {
  const { me, logout, switchCompany, switchBranch } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Set<string>>(new Set());
  useIdleLogout(me?.prefs.idleTimeoutMinutes ?? 30);

  useEffect(() => {
    const parents = findParents(me?.menus ?? [], location.pathname);
    if (parents?.length) setOpen((o) => new Set([...o, ...parents]));
  }, [location.pathname, me?.menus]);

  const menus = useMemo(() => {
    if (!filter) return me?.menus ?? [];
    const f = filter.toLowerCase();
    const walk = (nodes: MenuNode[]): MenuNode[] =>
      nodes
        .map((n) => ({ ...n, children: walk(n.children) }))
        .filter((n) => n.label.toLowerCase().includes(f) || n.children.length > 0);
    return walk(me?.menus ?? []);
  }, [me?.menus, filter]);
  const openSet = filter ? new Set(menus.map((m) => m.code)) : open;

  if (!me) return null;
  const toggle = (c: string) => setOpen((o) => (o.has(c) ? new Set([...o].filter((x) => x !== c)) : new Set([...o, c])));
  const changeCompany = async (id: string) => {
    await switchCompany(id);
    qc.clear();
    navigate('/');
    toast.info('Company switched');
  };
  const changeBranch = async (id: string) => {
    await switchBranch(id || null);
    qc.invalidateQueries();
  };

  const sidebar = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white text-slate-700">
      <div className="flex h-14 items-center gap-2 px-4">
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{me.prefs.appName}</p>
          <p className="truncate text-xs text-slate-500">{me.company.name}</p>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Icon name="search" className="absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find menu..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-2 pl-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none" />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {menus.map((m) => (
            <MenuItem key={m.id} node={m} depth={0} onNavigate={() => setMobileOpen(false)} open={openSet} toggle={toggle} />
          ))}
        </ul>
      </nav>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="no-print hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-4 dark:border-slate-800 dark:bg-slate-900">
          <Button variant="ghost" size="icon" icon="menu" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {me.companies.length > 1 && (
              <select className="input h-9 max-w-44 py-1 text-xs sm:max-w-56" value={me.company.id} onChange={(e) => changeCompany(e.target.value)} aria-label="Company">
                {me.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {me.branches.length > 0 && (
              <select className="input hidden h-9 max-w-44 py-1 text-xs sm:block" value={me.branchId ?? ''} onChange={(e) => changeBranch(e.target.value)} aria-label="Branch">
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Dropdown
            trigger={
              <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                  {me.user.fullName
                    .split(' ')
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm leading-tight font-medium">{me.user.fullName}</span>
                  <span className="block text-xs leading-tight text-slate-400">@{me.user.username}</span>
                </span>
              </button>
            }
            items={[
              { label: 'My profile & password', icon: 'user', onClick: () => navigate('/profile') },
              'divider',
              {
                label: 'Sign out',
                icon: 'log-out',
                danger: true,
                onClick: async () => {
                  await logout();
                  qc.clear();
                  navigate('/login');
                },
              },
            ]}
          />
        </header>
        <main className="flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          <Suspense
            fallback={
              <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6 text-brand-700" />
              </div>
            }
          >
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </Suspense>
        </main>
      </div>
      <PwaPrompt />
    </div>
  );
}
