import { useEffect } from 'react';
import { useSession } from '@/stores/session';
import { toast } from '@/components/ui/toast';

/** Signs the user out after a period of inactivity (configured in System > Settings). */
export function useIdleLogout(minutes: number) {
  const logout = useSession((s) => s.logout);
  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await logout();
        toast.info('You were signed out due to inactivity.');
      }, minutes * 60_000);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, logout]);
}
