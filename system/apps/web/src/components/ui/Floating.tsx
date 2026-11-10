import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './primitives';

/**
 * Popover panel rendered in a portal and positioned next to its anchor.
 * Never clipped by scrolling / overflow containers (tables, cards, modals), flips above the
 * anchor when there is no room below, follows scrolling and closes on outside click.
 */
export function Floating({
  anchorRef,
  open,
  onClose,
  children,
  className,
  matchWidth = true,
  minWidth = 0,
  width,
  align = 'left',
  offset = 6,
  preferredHeight = 340,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** use the anchor width (at least `minWidth`) */
  matchWidth?: boolean;
  minWidth?: number;
  /** fixed width in px (overrides matchWidth) */
  width?: number;
  align?: 'left' | 'right';
  offset?: number;
  preferredHeight?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width ?? (matchWidth ? Math.max(r.width, minWidth) : minWidth || r.width), vw - 16);
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const below = vh - r.bottom - offset - 8;
      const above = r.top - offset - 8;
      // natural height of the content (the panel is already mounted here), capped by the preferred height
      const need = Math.min(panelRef.current?.scrollHeight || preferredHeight, preferredHeight);
      const up = below < need && above > below;
      const s: CSSProperties = { left, width: w, maxHeight: Math.max(160, up ? above : below) };
      if (up) s.bottom = vh - r.top + offset;
      else s.top = r.bottom + offset;
      setStyle(s);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, matchWidth, minWidth, width, align, offset, preferredHeight]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={panelRef} style={{ position: 'fixed', ...style }} className={cn('z-[90] flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-pop', className)}>
      {children}
    </div>,
    document.body,
  );
}
