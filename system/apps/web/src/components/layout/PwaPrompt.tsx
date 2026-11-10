import { useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui';

const FLAG = 'kcs.updating';

function readFlag(): number {
  try {
    return Number(sessionStorage.getItem(FLAG) ?? 0);
  } catch {
    return 0;
  }
}
function setFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(FLAG, String(Date.now()));
    else sessionStorage.removeItem(FLAG);
  } catch {
    /* storage unavailable: the update still works, only the safety net is skipped */
  }
}

// Safety net: when the reload after "Update now" happened before the new service worker took control,
// this page still runs the old bundle. Reload once more as soon as the new worker becomes the controller.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const started = readFlag();
  setFlag(false);
  if (started && Date.now() - started < 60_000) {
    const reloadOnce = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
    setTimeout(() => navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce), 20_000);
  }
}

/** Notifies the user when a new version is available (never reloads in the middle of their work). */
export function PwaPrompt() {
  const [updating, setUpdating] = useState(false);
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      regRef.current = reg;
      // long-running tabs: look for a new version every 30 minutes
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
    },
  });
  if (!needRefresh) return null;

  /**
   * Activates the waiting service worker and reloads only once it controls the page, so the reload is
   * served by the new worker (new bundles). Forms with unsaved changes still get their "leave page?" prompt.
   */
  const update = async () => {
    setUpdating(true);
    setFlag(true);
    const reg = regRef.current ?? (await navigator.serviceWorker.getRegistration());
    const waiting = reg?.waiting;
    if (waiting) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    }
    window.location.reload();
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
