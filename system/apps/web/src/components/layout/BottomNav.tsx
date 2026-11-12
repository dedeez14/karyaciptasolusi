import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Icon } from '@/components/ui';
import { cn } from '@/components/ui/primitives';
import { useSession, type MenuNode } from '@/stores/session';
import { flattenMenus } from './menu-utils';

/**
 * Work profiles, recognised from the user's permissions (roles can be renamed or combined, permissions say what
 * the person actually does). Each lists the menus that person opens most, best first.
 */
const PROFILES: { id: string; label: string; when: (can: (p: string) => boolean, admin: boolean) => boolean; menus: string[] }[] = [
  { id: 'admin', label: 'Administrator', when: (_c, admin) => admin, menus: ['sales.invoices', 'crm.leads', 'approvals', 'tasks.mine'] },
  { id: 'finance', label: 'Finance', when: (c) => c('accounting.cash.read'), menus: ['sales.invoices', 'accounting.cash', 'purchase.invoices', 'approvals'] },
  { id: 'sales', label: 'Sales & Marketing', when: (c) => c('crm.lead.read') || c('sales.quotation.read'), menus: ['crm.leads', 'sales.quotations', 'crm.pipeline', 'tasks.mine'] },
  { id: 'purchasing', label: 'Purchasing', when: (c) => c('purchase.order.read'), menus: ['purchase.orders', 'purchase.requests', 'purchase.receipts', 'approvals'] },
  { id: 'warehouse', label: 'Warehouse', when: (c) => c('inventory.adjustment.read') || c('report.stock-balance.view'), menus: ['inventory.stock', 'sales.deliveries', 'purchase.receipts', 'inventory.transfers'] },
  { id: 'hr', label: 'Human Resources', when: (c) => c('hris.employee.read'), menus: ['hris.attendance', 'hris.leave', 'hris.employees', 'approvals'] },
  { id: 'employee', label: 'Employee', when: () => true, menus: ['tasks.mine', 'hris.leave', 'hris.expenses', 'support.tickets'] },
];
/** used when a profile's own menus are not all available */
const FILL = ['tasks.mine', 'approvals', 'support.tickets', 'hris.expenses', 'files', 'reports'];

/** short labels for the narrow bar */
const SHORT: Record<string, string> = {
  'sales.invoices': 'Invoices',
  'sales.quotations': 'Quotes',
  'sales.deliveries': 'Deliveries',
  'crm.leads': 'Leads',
  'crm.pipeline': 'Pipeline',
  'accounting.cash': 'Cash & Bank',
  'purchase.invoices': 'Bills',
  'purchase.orders': 'Orders',
  'purchase.requests': 'Requests',
  'purchase.receipts': 'Receipts',
  'inventory.stock': 'Stock',
  'inventory.transfers': 'Transfers',
  'hris.attendance': 'Attendance',
  'hris.leave': 'Leave',
  'hris.employees': 'Employees',
  'hris.expenses': 'Expenses',
  'tasks.mine': 'My Tasks',
  'support.tickets': 'Tickets',
  approvals: 'Approvals',
  files: 'Files',
  reports: 'Reports',
};

const pathOnly = (p: string) => p.split('?')[0];

/** The work profile of a user and the three menus for the bar (only menus the user can open: `menus` is already filtered) */
export function pickBottomNav(menus: MenuNode[], can: (p: string) => boolean, admin: boolean) {
  const leaves = new Map(flattenMenus(menus).filter((l) => l.node.path).map((l) => [l.node.code, l.node] as const));
  const profile = PROFILES.find((p) => p.when(can, admin))!;
  const items: MenuNode[] = [];
  for (const code of [...profile.menus, ...FILL]) {
    const n = leaves.get(code);
    if (n && n.path !== '/' && !items.some((x) => x.code === n.code)) items.push(n);
    if (items.length === 3) break;
  }
  return { profile: profile.id, items };
}

/**
 * Bottom navigation of the phone / installed app (below the lg breakpoint, where the sidebar is hidden):
 * Home, the three menus this user's work profile needs most (only menus the user may open) and Menu for the rest.
 */
export function BottomNav({ onMenu }: { onMenu: () => void }) {
  const { me, can } = useSession();
  const loc = useLocation();
  const items = useMemo(() => (me ? pickBottomNav(me.menus, can, me.user.isSuperAdmin || can('system.setting.update')).items : []), [me, can]);
  if (!me) return null;

  // the longest matching path wins, so /documents/SI/123 lights up Invoices
  const here = loc.pathname;
  const activeCode = items
    .filter((n) => {
      const p = pathOnly(n.path!);
      return here === p || here.startsWith(`${p}/`);
    })
    .sort((a, b) => pathOnly(b.path!).length - pathOnly(a.path!).length)[0]?.code;

  const tab = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[11px] font-medium transition-colors';
  const mark = (on: boolean) => (
    <span aria-hidden className={cn('absolute top-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-b-full', on ? 'bg-accent-400' : 'bg-transparent')} />
  );

  return (
    <nav aria-label="Quick navigation" className="no-print relative z-30 shrink-0 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex h-16 max-w-lg items-stretch">
        <NavLink to="/" end className={({ isActive }) => cn(tab, 'relative', isActive ? 'text-brand-700' : 'text-slate-500')}>
          {({ isActive }) => (
            <>
              {mark(isActive)}
              <Icon name="house" className="h-5 w-5" />
              <span className="truncate">Home</span>
            </>
          )}
        </NavLink>
        {items.map((n) => {
          const on = n.code === activeCode;
          return (
            <NavLink key={n.code} to={n.path!} aria-current={on ? 'page' : undefined} className={cn(tab, 'relative', on ? 'text-brand-700' : 'text-slate-500')}>
              {mark(on)}
              <Icon name={n.icon ?? 'circle'} className="h-5 w-5" />
              <span className="max-w-full truncate">{SHORT[n.code] ?? n.label}</span>
            </NavLink>
          );
        })}
        <button type="button" onClick={onMenu} className={cn(tab, 'relative text-slate-500')} aria-label="All menus">
          {mark(false)}
          <Icon name="layout-grid" className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
