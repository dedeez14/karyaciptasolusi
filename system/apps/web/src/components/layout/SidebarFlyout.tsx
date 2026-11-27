import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router';
import type { MenuNode } from '@/stores/session';
import { cn, Icon } from '@/components/ui';
import { flattenMenus } from './menu-utils';

/**
 * Collapsed-sidebar group: hovering (or clicking / pressing Enter) the icon opens a flyout
 * with the group title and all of its pages, so navigation keeps working while collapsed.
 */
export function SidebarFlyout({ node, activeCode, children }: { node: MenuNode; activeCode?: string; children: (props: { open: boolean; toggle: () => void }) => ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const leaves = flattenMenus(node.children);

  const place = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const estimated = 52 + leaves.length * 36;
    setPos({ x: r.right + 8, y: Math.max(8, Math.min(r.top - 6, window.innerHeight - estimated - 8)) });
  };
  const openSoon = () => {
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(place, 120);
  };
  const closeSoon = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPos(null), 180);
  };
  const toggle = () => (pos ? setPos(null) : place());

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <div ref={anchor} onMouseEnter={openSoon} onMouseLeave={closeSoon}>
      {children({ open: !!pos, toggle })}
      {pos &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={node.label}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={closeSoon}
            className="fixed z-[85] w-60 overflow-hidden rounded-xl border border-line bg-white p-1.5 shadow-pop"
            style={{ left: pos.x, top: pos.y }}
          >
            <p className="flex items-center gap-2 px-2.5 pt-1.5 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <Icon name={node.icon} className="h-3.5 w-3.5" />
              {node.label}
            </p>
            <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto">
              {leaves.map(({ node: leaf, trail }) => (
                <li key={leaf.id}>
                  <NavLink
                    to={leaf.path ?? '/'}
                    role="menuitem"
                    onClick={() => setPos(null)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px]',
                      leaf.code === activeCode ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    <span className="truncate">{leaf.label}</span>
                    {trail.length > 1 && <span className="ml-auto truncate text-[11px] text-slate-400">{trail[trail.length - 1].label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
