import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Button, cn } from './primitives';
import { Icon } from './Icon';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

/** Centered dialog; becomes a bottom sheet on phones */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size])}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" icon="x" onClick={onClose} aria-label="Close" />
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-line bg-slate-50/70 px-6 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Side panel used for create/edit forms */
export function Drawer({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative flex h-full w-full flex-col bg-white shadow-pop sm:rounded-l-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" icon="x" onClick={onClose} aria-label="Close" />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line bg-slate-50/70 px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:rounded-bl-2xl">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Confirm dialog (promise based)
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
}
const useConfirmStore = create<{ opts: ConfirmOpts | null; resolve: ((v: boolean) => void) | null }>(() => ({ opts: null, resolve: null }));

export function confirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ opts, resolve }));
}

export function ConfirmHost() {
  const { opts, resolve } = useConfirmStore();
  const close = (v: boolean) => {
    resolve?.(v);
    useConfirmStore.setState({ opts: null, resolve: null });
  };
  return (
    <Modal
      open={!!opts}
      onClose={() => close(false)}
      title={opts?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {opts?.confirmText ?? 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{opts?.message}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Dropdown menu
export function Dropdown({ trigger, items, align = 'right' }: { trigger: ReactNode; items: ({ label: string; icon?: string; onClick: () => void; danger?: boolean; hidden?: boolean } | 'divider')[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const visible = items.filter((i) => i === 'divider' || !i.hidden);
  if (!visible.some((i) => i !== 'divider')) return null;
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={cn('absolute z-40 mt-1.5 min-w-52 overflow-hidden rounded-xl border border-line bg-white p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map((i, idx) =>
            i === 'divider' ? (
              <div key={idx} className="my-1 border-t border-line" />
            ) : (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setOpen(false);
                  i.onClick();
                }}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100', i.danger && 'text-red-600 hover:bg-red-50')}
              >
                <Icon name={i.icon} />
                {i.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
