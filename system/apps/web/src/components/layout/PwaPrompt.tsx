import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui';

/** Notifies the user when a new version is available (never reloads in the middle of their work). */
export function PwaPrompt() {
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      // long-running tabs: look for a new version every 30 minutes
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
    },
  });
  if (!needRefresh) return null;

  const update = async () => {
    setUpdating(true);
    // activates the new service worker and reloads once it controls the page;
    // the timeout is a safety net when the browser never fires "controlling"
    setTimeout(() => window.location.reload(), 4000);
    try {
      await updateServiceWorker(true);
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl" role="status">
      <span>A new version is available.</span>
      <Button size="sm" onClick={update} loading={updating}>
        Update now
      </Button>
      <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => setNeedRefresh(false)} disabled={updating}>
        Later
      </Button>
    </div>
  );
}
