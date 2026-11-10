import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui';

/** Notifies the user when a new version is available (never reloads in the middle of their work). */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
      <span>A new version is available.</span>
      <Button size="sm" onClick={() => updateServiceWorker(true)}>
        Update
      </Button>
      <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
    </div>
  );
}
