import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import type { MenuNode } from '@/stores/session';
import { cn, Icon } from '@/components/ui';
import { flattenMenus } from './menu-utils';

/** Quick navigation to any menu the user can access (Ctrl/Cmd + K) */
export function CommandPalette({ open, onClose, menus }: { open: boolean; onClose: () => void; menus: MenuNode[] }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const items = useMemo(() => {
    const all = flattenMenus(menus);
    const seen = new Set<string>();
    const unique = all.filter(({ node }) => (seen.has(node.path!) ? false : (seen.add(node.path!), true)));
    const term = q.trim().toLowerCase();
    if (!term) return unique.slice(0, 12);
    return unique.filter(({ node, trail }) => [node.label, ...trail.map((t) => t.label)].join(' ').toLowerCase().includes(term)).slice(0, 20);
  }, [menus, q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  if (!open) return null;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" className="h-5 w-5 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && items[active]) go(items[active].node.path!);
            }}
            placeholder="Go to... (e.g. invoice, customers, payroll)"
            className="h-14 flex-1 bg-transparent text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-slate-500">ESC</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-slate-500">No menu found</li>}
          {items.map(({ node, trail }, i) => (
            <li key={node.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(node.path!)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}
              >
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', i === active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500')}>
                  <Icon name={node.icon ?? trail[trail.length - 1]?.icon ?? 'circle'} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{node.label}</span>
                  {trail.length > 0 && <span className="block truncate text-xs text-slate-500">{trail.map((t) => t.label).join(' / ')}</span>}
                </span>
                {i === active && <Icon name="corner-down-left" className="h-4 w-4 text-brand-600" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
