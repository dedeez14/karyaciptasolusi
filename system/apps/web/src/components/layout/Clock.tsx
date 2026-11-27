import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/stores/session';
import { Icon, Tooltip } from '@/components/ui';

/** Real-time clock in the top bar, configured in System > Settings > Clock. */
export function Clock() {
  const clock = useSession((s) => s.me?.clock);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!clock?.enabled) return;
    // align ticks to the start of each second (or minute when seconds are hidden)
    const step = clock.showSeconds ? 1000 : 60_000;
    let interval: ReturnType<typeof setInterval>;
    const first = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), step);
      },
      step - (Date.now() % step),
    );
    setNow(new Date());
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [clock?.enabled, clock?.showSeconds]);

  const fmt = useMemo(() => {
    if (!clock) return null;
    const tz = (() => {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: clock.timezone });
        return clock.timezone;
      } catch {
        return undefined; // unknown zone -> browser time
      }
    })();
    return {
      time: new Intl.DateTimeFormat(clock.format24h ? 'en-GB' : 'en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: clock.showSeconds ? '2-digit' : undefined, hour12: !clock.format24h }),
      date: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
      full: new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }),
      tz,
    };
  }, [clock]);

  if (!clock?.enabled || !fmt) return null;
  return (
    <Tooltip content={`${fmt.full.format(now)}${fmt.tz ? ` · ${fmt.tz}` : ''}`} side="bottom" className="hidden md:block">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] shadow-[0_1px_2px_rgb(16_24_40/0.04)]" aria-live="off">
        <Icon name="clock" className="h-4 w-4 text-brand-600" />
        {clock.showDate && <span className="hidden text-slate-500 xl:inline">{fmt.date.format(now)}</span>}
        <span className="font-semibold text-slate-800 tabular-nums">{fmt.time.format(now)}</span>
        {clock.label && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">{clock.label}</span>}
      </div>
    </Tooltip>
  );
}
