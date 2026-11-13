import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

interface Announcement {
  id: string;
  message: string;
  tone: 'INFO' | 'SUCCESS' | 'WARNING' | 'URGENT' | string;
  link: string | null;
  updatedAt: string;
}

const KEY = 'kcs.announcements.hidden';
const RANK: Record<string, number> = { URGENT: 3, WARNING: 2, SUCCESS: 1, INFO: 0 };
/** solid colours only (no gradients) */
const BAR: Record<string, string> = {
  URGENT: 'bg-red-600 text-white',
  WARNING: 'bg-accent-400 text-brand-950',
  SUCCESS: 'bg-emerald-600 text-white',
  INFO: 'bg-brand-600 text-white',
};
const CHIP: Record<string, string> = {
  URGENT: 'bg-white/15',
  WARNING: 'bg-brand-950/10',
  SUCCESS: 'bg-white/15',
  INFO: 'bg-white/15',
};
const LABEL: Record<string, string> = { URGENT: 'Urgent', WARNING: 'Attention', SUCCESS: 'Good news', INFO: 'Announcement' };

/**
 * Running text under the top bar with the company's active announcements (managed in System > Announcements).
 * Each loop is at least as wide as the bar, so a short message also travels across it. Pauses on hover / focus
 * and with its pause button (WCAG 2.2.2), runs slower when the device asks for reduced motion, and can be hidden
 * until the announcements change.
 */
export function AnnouncementBar() {
  const q = useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: () => api.get<Announcement[]>('/announcements/active'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const items = q.data ?? [];
  const signature = items.map((i) => `${i.id}:${i.updatedAt}`).join('|');
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [paused, setPaused] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ view: 0, loop: 0 });
  const show = items.length > 0 && hidden !== signature;

  // width of the bar and of one loop (never narrower than the bar): speed stays the same for any text length
  useLayoutEffect(() => {
    if (!show || !viewport.current) return;
    const measure = () => setSize({ view: viewport.current?.clientWidth ?? 0, loop: group.current?.scrollWidth ?? 0 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [show, signature]);
  if (!show) return null;

  const tone = items.reduce((t, i) => ((RANK[i.tone] ?? 0) > (RANK[t] ?? 0) ? i.tone : t), 'INFO');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ~70 px per second (45 with reduced motion), at least 12 s per loop
  const duration = Math.max(12, Math.round(Math.max(size.loop, size.view) / (reduced ? 45 : 70)));

  const entry = (a: Announcement, copy: boolean) => {
    const body = (
      <>
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
        <span className="whitespace-nowrap">{a.message}</span>
        {a.link && <Icon name="arrow-up-right" className="h-3.5 w-3.5 shrink-0 opacity-75" />}
      </>
    );
    const cls = 'inline-flex items-center gap-2 px-6';
    const extra = copy ? { 'aria-hidden': true, tabIndex: -1 } : {};
    if (!a.link) return <span key={a.id + copy} className={cls} {...extra}>{body}</span>;
    if (a.link.startsWith('/'))
      return (
        <Link key={a.id + copy} to={a.link} className={cn(cls, 'hover:underline')} {...extra}>
          {body}
        </Link>
      );
    return (
      <a key={a.id + copy} href={a.link} target="_blank" rel="noopener noreferrer" className={cn(cls, 'hover:underline')} {...extra}>
        {body}
      </a>
    );
  };

  return (
    <div role="region" aria-label="Announcements" className={cn('no-print relative z-20 flex h-9 shrink-0 items-center text-[13px] font-medium', BAR[tone] ?? BAR.INFO)}>
      <span className={cn('ml-2 flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold sm:ml-4', CHIP[tone] ?? CHIP.INFO)}>
        <Icon name="megaphone" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{LABEL[tone] ?? LABEL.INFO}</span>
      </span>
      <div ref={viewport} className="announcement-viewport min-w-0 flex-1 overflow-hidden">
        <div className={cn('announcement-track', paused && 'is-paused')} style={{ '--announcement-duration': `${duration}s` } as CSSProperties}>
          <div ref={group} className="flex shrink-0 items-center" style={{ minWidth: size.view || undefined }}>
            {items.map((a) => entry(a, false))}
          </div>
          <div aria-hidden className="flex shrink-0 items-center" style={{ minWidth: size.view || undefined }}>
            {items.map((a) => entry(a, true))}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-80 hover:opacity-100"
        aria-label={paused ? 'Play announcements' : 'Pause announcements'}
        title={paused ? 'Play' : 'Pause'}
      >
        <Icon name={paused ? 'play' : 'pause'} className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          setHidden(signature);
          try {
            sessionStorage.setItem(KEY, signature);
          } catch {
            /* private mode */
          }
        }}
        className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-80 hover:opacity-100 focus-visible:outline-current sm:mr-3"
        aria-label="Hide announcements"
        title="Hide until something new is announced"
      >
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}
