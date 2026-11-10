import { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, type MenuNode } from '@/stores/session';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import '@/hooks/useTheme';
import { Button, cn, Dropdown, Icon, Spinner, toast } from '@/components/ui';
import { PwaPrompt } from './PwaPrompt';
import { ErrorBoundary } from './ErrorBoundary';
import { CommandPalette } from './CommandPalette';
import { flattenMenus } from './menu-utils';

const COLLAPSE_KEY = 'kcs.sidebar.collapsed';

function findActive(nodes: MenuNode[], path: string) {
  const leaves = flattenMenus(nodes).filter(({ node }) => node.path && (node.path === '/' ? path === '/' : path === node.path || path.startsWith(node.path + '/') || path.startsWith(node.path + '?')));
  return leaves.sort((a, b) => (b.node.path?.length ?? 0) - (a.node.path?.length ?? 0))[0];
}

function initials(name: string) {
  return name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function NavItem({ node, depth, collapsed, open, toggle, onNavigate, activeCode }: { node: MenuNode; depth: number; collapsed: boolean; open: Set<string>; toggle: (c: string) => void; onNavigate: () => void; activeCode?: string }) {
  if (node.children.length) {
    const isOpen = open.has(node.code) && !collapsed;
    const containsActive = !!activeCode && flattenMenus(node.children).some((l) => l.node.code === activeCode);
    return (
      <li>
        <button
          type="button"
          title={collapsed ? node.label : undefined}
          onClick={() => toggle(node.code)}
          className={cn(
            'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
            containsActive ? 'text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            collapsed && 'justify-center',
          )}
          aria-expanded={isOpen}
        >
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', containsActive ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-brand-600')}>
            <Icon name={node.icon} className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">{node.label}</span>
              <Icon name="chevron-right" className={cn('h-4 w-4 text-slate-400 transition-transform', isOpen && 'rotate-90')} />
            </>
          )}
        </button>
        {isOpen && (
          <ul className="relative mt-1 mb-2 ml-[22px] space-y-0.5 border-l border-line pl-3">
            {node.children.map((c) => (
              <NavItem key={c.id} node={c} depth={depth + 1} collapsed={collapsed} open={open} toggle={toggle} onNavigate={onNavigate} activeCode={activeCode} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const active = node.code === activeCode;
  return (
    <li>
      <NavLink
        to={node.path ?? '/'}
        title={collapsed ? node.label : undefined}
        onClick={onNavigate}
        className={cn(
          'relative flex items-center gap-3 rounded-lg text-[13.5px] transition-colors',
          depth === 0 ? 'px-2.5 py-2 font-medium' : 'px-2.5 py-1.5',
          active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          collapsed && 'justify-center',
        )}
      >
        {depth > 0 && active && <span className="absolute top-1.5 bottom-1.5 -left-[13.5px] w-[3px] rounded-full bg-brand-600" />}
        {depth === 0 && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500')}>
            <Icon name={node.icon} className="h-4 w-4" />
          </span>
        )}
        {!collapsed && <span className="truncate">{node.label}</span>}
      </NavLink>
    </li>
  );
}

export function AppLayout() {
  const { me, logout, switchCompany, switchBranch } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState<Set<string>>(new Set());
  useIdleLogout(me?.prefs.idleTimeoutMinutes ?? 30);

  const active = useMemo(() => findActive(me?.menus ?? [], location.pathname), [me?.menus, location.pathname]);

  useEffect(() => {
    if (active?.trail.length) setOpen((o) => new Set([...o, ...active.trail.map((t) => t.code)]));
  }, [active]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  if (!me) return null;
  const toggle = (c: string) => {
    if (collapsed) setCollapsed(false);
    setOpen((o) => (o.has(c) ? new Set([...o].filter((x) => x !== c)) : new Set([...o, c])));
  };
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
  const signOut = async () => {
    await logout();
    qc.clear();
    navigate('/login');
  };

  const sidebar = (isMobile: boolean) => {
    const c = collapsed && !isMobile;
    return (
      <div className="flex h-full flex-col border-r border-line bg-white">
        <div className={cn('flex h-16 shrink-0 items-center gap-3 px-4', c && 'justify-center px-2')}>
          <img src="/favicon.svg" alt="" className="h-9 w-9 shrink-0 rounded-xl shadow-sm" />
          {!c && (
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-slate-900">{me.prefs.appName}</p>
              <p className="truncate text-xs text-slate-500">{me.company.name}</p>
            </div>
          )}
        </div>
        {!c && (
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                setPaletteOpen(true);
              }}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 text-sm text-slate-400 hover:border-slate-300 hover:bg-white"
            >
              <Icon name="search" className="h-4 w-4" />
              <span className="flex-1 text-left">Search menu...</span>
              <kbd className="rounded border border-line bg-white px-1.5 text-[10px] font-medium text-slate-500">Ctrl K</kbd>
            </button>
          </div>
        )}
        <nav className={cn('flex-1 overflow-y-auto pb-4', c ? 'px-2' : 'px-3')}>
          <ul className="space-y-0.5">
            {me.menus.map((m) => (
              <NavItem key={m.id} node={m} depth={0} collapsed={c} open={open} toggle={toggle} onNavigate={() => setMobileOpen(false)} activeCode={active?.node.code} />
            ))}
          </ul>
        </nav>
        <div className={cn('shrink-0 border-t border-line p-3', c && 'px-2')}>
          {!isMobile && (
            <button type="button" onClick={() => setCollapsed((v) => !v)} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-800', c && 'justify-center')}>
              <Icon name={c ? 'panel-left-open' : 'panel-left-close'} className="h-4 w-4" />
              {!c && 'Collapse sidebar'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const crumbs = active ? [...active.trail.map((t) => t.label), active.node.label] : [];

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className={cn('no-print hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-[72px]' : 'w-[264px]')}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-pop">{sidebar(true)}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white/80 px-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" icon="menu" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" />
          <nav className="hidden min-w-0 flex-1 items-center gap-1.5 text-sm md:flex" aria-label="Breadcrumb">
            <Link to="/" className="text-slate-400 hover:text-slate-700" aria-label="Dashboard">
              <Icon name="house" className="h-4 w-4" />
            </Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                <Icon name="chevron-right" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                <span className={cn('truncate', i === crumbs.length - 1 ? 'font-medium text-slate-800' : 'text-slate-500')}>{c}</span>
              </span>
            ))}
          </nav>
          <div className="flex-1 md:hidden" />
          <Button variant="ghost" size="icon" icon="search" className="md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search menu" />
          <div className="hidden items-center gap-2 sm:flex">
            {me.companies.length > 1 && (
              <div className="relative">
                <Icon name="building-2" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select className="input h-9 max-w-52 pl-8 text-[13px]" value={me.company.id} onChange={(e) => changeCompany(e.target.value)} aria-label="Company">
                  {me.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {me.branches.length > 0 && (
              <div className="relative">
                <Icon name="map-pin" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select className="input h-9 max-w-48 pl-8 text-[13px]" value={me.branchId ?? ''} onChange={(e) => changeBranch(e.target.value)} aria-label="Branch">
                  {me.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <Dropdown
            trigger={
              <button type="button" className="flex items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 hover:bg-slate-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-xs font-semibold text-white shadow-sm">{initials(me.user.fullName)}</span>
                <span className="hidden text-left lg:block">
                  <span className="block max-w-36 truncate text-sm leading-tight font-semibold text-slate-800">{me.user.fullName}</span>
                  <span className="block text-xs leading-tight text-slate-500">@{me.user.username}</span>
                </span>
                <Icon name="chevron-down" className="hidden h-4 w-4 text-slate-400 lg:block" />
              </button>
            }
            items={[
              { label: 'My profile & password', icon: 'user', onClick: () => navigate('/profile') },
              { label: 'Search menu (Ctrl K)', icon: 'search', onClick: () => setPaletteOpen(true) },
              'divider',
              { label: 'Sign out', icon: 'log-out', danger: true, onClick: signOut },
            ]}
          />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
            <Suspense
              fallback={
                <div className="flex justify-center py-24">
                  <Spinner className="h-6 w-6 text-brand-600" />
                </div>
              }
            >
              <ErrorBoundary key={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </Suspense>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} menus={me.menus} />
      <PwaPrompt />
    </div>
  );
}
