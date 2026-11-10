import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon, Spinner } from '@/components/ui';

interface Info {
  company: string;
  email: string;
  unsubscribed: boolean;
}

const HEADERS = { 'X-Requested-With': 'kcs-web' };

/** Public page opened from the unsubscribe link in campaign e-mails (no sign-in). */
export default function UnsubscribePage() {
  const [sp] = useSearchParams();
  const token = sp.get('t') ?? '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      setError('This unsubscribe link is not valid.');
      return;
    }
    fetch(`/api/v1/public/email/unsubscribe/${encodeURIComponent(token)}`, { headers: HEADERS })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.message || 'This unsubscribe link is not valid or has expired.');
        setInfo(body);
        setDone(!!body.unsubscribed);
      })
      .catch((e: Error) => setError(e.message || 'The service is not reachable. Please try again later.'));
  }, [token]);

  const confirmUnsubscribe = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/public/email/unsubscribe/${encodeURIComponent(token)}`, { method: 'POST', headers: HEADERS });
      if (!r.ok) throw new Error();
      setDone(true);
    } catch {
      setError('Something went wrong. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas p-4 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{info?.company || 'E-mail preferences'}</p>
            <p className="text-xs text-slate-500">Marketing e-mail subscription</p>
          </div>
        </div>
        <div className="px-6 py-8">
          {!info && !error && (
            <div className="flex justify-center py-6">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          )}
          {error && (
            <div className="space-y-2 text-center">
              <Icon name="link-2-off" className="mx-auto h-9 w-9 text-slate-400" />
              <p className="text-sm text-slate-700">{error}</p>
            </div>
          )}
          {info && !error && done && (
            <div className="space-y-3 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Icon name="check" className="h-6 w-6" />
              </span>
              <p className="text-lg font-semibold text-slate-900">You are unsubscribed</p>
              <p className="text-sm text-slate-600">
                <span className="font-mono">{info.email}</span> will no longer receive marketing e-mails from {info.company}. It can take a few minutes for e-mails that are already on their way.
              </p>
            </div>
          )}
          {info && !error && !done && (
            <div className="space-y-4 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Icon name="mail-minus" className="h-6 w-6" />
              </span>
              <p className="text-lg font-semibold text-slate-900">Stop receiving our e-mails?</p>
              <p className="text-sm text-slate-600">
                <span className="font-mono">{info.email}</span> will be removed from all marketing e-mails of {info.company}.
              </p>
              <button type="button" onClick={confirmUnsubscribe} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy && <Spinner className="h-4 w-4" />}
                Unsubscribe
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
