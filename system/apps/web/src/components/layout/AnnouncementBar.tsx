import { useState, type CSSProperties } from 'react';
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
 * Pauses on hover / focus, stands still for people who prefer reduced motion, and can be hidden until the
 * announcements change.
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
  if (!items.length || hidden === signature) return null;

  const tone = items.reduce((t, i) => ((RANK[i.tone] ?? 0) > (RANK[t] ?? 0) ? i.tone : t), 'INFO');
  // about 7 characters per second, never faster than 18 s per loop
  const duration = Math.max(18, Math.round(items.reduce((n, i) => n + i.message.length + 8, 0) / 7));

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
      <div className="announcement-viewport min-w-0 flex-1 overflow-hidden">
        <div className="announcement-track" style={{ '--announcement-duration': `${duration}s` } as CSSProperties}>
          <div className="flex shrink-0 items-center">{items.map((a) => entry(a, false))}</div>
          <div className="announcement-copy flex shrink-0 items-center">{items.map((a) => entry(a, true))}</div>
        </div>
      </div>
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
