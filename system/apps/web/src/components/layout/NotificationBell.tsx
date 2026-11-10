import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, subscribe } from '@/lib/api';
import { useSession } from '@/stores/session';
import { cn, Icon } from '@/components/ui';

interface Item {
  key: string;
  title: string;
  message: string;
  count: number;
  severity: 'info' | 'warning' | 'danger';
  icon: string;
  link: string;
}
interface Summary {
  enabled: boolean;
  refreshSeconds: number;
  desktop: boolean;
  sound: boolean;
  total: number;
  items: Item[];
  at: string;
}

const TONE: Record<Item['severity'], string> = {
  info: 'bg-brand-50 text-brand-600 ring-brand-100',
  warning: 'bg-amber-50 text-amber-600 ring-amber-100',
  danger: 'bg-red-50 text-red-600 ring-red-100',
};

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}

const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Real-time notification bell. Uses a Server-Sent Events stream (pushed instantly when data changes
 * in the company) with automatic reconnect; falls back to polling when streaming is unavailable.
 */
export function NotificationBell() {
  const me = useSession((s) => s.me);
  const can = useSession((s) => s.can);
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (desktopSupported() ? Notification.permission : 'unsupported'));
  const prev = useRef<Map<string, number> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const companyId = me?.company.id;
  const branchId = me?.branchId;

  // announce new / increased items (never on the first payload after connecting)
  const handle = (s: Summary) => {
    setSummary(s);
    const before = prev.current;
    const next = new Map(s.items.map((i) => [i.key, i.count]));
    prev.current = next;
    if (!before || !s.enabled) return;
    const fresh = s.items.filter((i) => i.count > (before.get(i.key) ?? 0));
    if (!fresh.length) return;
    if (s.sound) beep();
    if (s.desktop && desktopSupported() && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      for (const i of fresh.slice(0, 3)) {
        const n = new Notification(i.title, { body: i.message, tag: `kcs-${i.key}`, icon: '/pwa-192.png' });
        n.onclick = () => {
          window.focus();
          navigate(i.link);
          n.close();
        };
      }
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!companyId) return;
    prev.current = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        handleRef.current(await api.get<Summary>('/notifications'));
      } catch {
        /* keep last state */
      }
    };
    const unsubscribe = subscribe<Summary>('/notifications/stream', {
      onOpen: () => {
        setLive(true);
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = undefined;
        }
      },
      onEvent: (e) => {
        if (e.event === 'notifications') handleRef.current(e.data);
      },
      onFallback: () => {
        setLive(false);
        void poll();
        if (!pollTimer) pollTimer = setInterval(poll, Math.max(15, summary?.refreshSeconds ?? 30) * 1000);
      },
    });
    return () => {
      unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
      setLive(false);
    };
    // reconnect when the working company / branch changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, branchId]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);

  if (summary && !summary.enabled) return null;
  const total = summary?.total ?? 0;
  const items = summary?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={total ? `${total} notifications` : 'Notifications'}
        aria-expanded={open}
        className={cn('relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900', open && 'bg-slate-100 text-slate-900')}
      >
        <Icon name="bell" className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-bold text-white ring-2 ring-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-[68px] z-50 overflow-hidden rounded-2xl border border-line bg-white shadow-pop sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px]">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-500' : 'bg-slate-300')} />
                {live ? 'Live' : 'Updating periodically'}
              </p>
            </div>
            {total > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-red-100">{total} open</span>}
          </header>
          <ul className="max-h-[60vh] overflow-y-auto p-1.5">
            {items.length === 0 && (
              <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="rounded-full bg-emerald-50 p-3 text-emerald-600 ring-1 ring-emerald-100">
                  <Icon name="check-check" className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium text-slate-800">You&apos;re all caught up</span>
                <span className="text-xs text-slate-500">New items will appear here instantly.</span>
              </li>
            )}
            {items.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(i.link);
                  }}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                >
                  <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', TONE[i.severity])}>
                    <Icon name={i.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{i.title}</span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600 tabular-nums">{i.count}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500">{i.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <footer className="flex items-center justify-between gap-2 border-t border-line bg-slate-50/70 px-4 py-2.5">
            {summary?.desktop && permission === 'default' ? (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                onClick={async () => setPermission(await Notification.requestPermission())}
              >
                <Icon name="monitor" className="h-3.5 w-3.5" /> Enable desktop pop-ups
              </button>
            ) : (
              <span className="text-xs text-slate-400">{permission === 'denied' && summary?.desktop ? 'Desktop pop-ups are blocked in this browser' : ''}</span>
            )}
            {can('system.setting.read') && (
              <Link to="/system/settings?tab=notifications" onClick={() => setOpen(false)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                <Icon name="settings-2" className="h-3.5 w-3.5" /> Notification settings
              </Link>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}
