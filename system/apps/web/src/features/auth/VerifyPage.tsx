import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { Icon, Spinner } from '@/components/ui';

interface VerifyResult {
  valid: boolean;
  message: string;
  warnings?: string[];
  document?: { type: string; number: string; date: string; amount: number | null; currency: string | null; issuedAt: string; status: string | null };
  issuer?: string;
  fingerprint?: string;
}

/** Public page opened by the QR code printed on every document (no sign-in required). */
export default function VerifyPage() {
  const [sp] = useSearchParams();
  const token = sp.get('t') ?? '';
  const [r, setR] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('No document code in this link.');
      return;
    }
    fetch(`/api/v1/public/verify?t=${encodeURIComponent(token)}`, { headers: { 'X-Requested-With': 'kcs-web' } })
      .then((res) => res.json())
      .then(setR)
      .catch(() => setError('The verification service is not reachable.'));
  }, [token]);

  const ok = r?.valid && !(r.warnings?.length ?? 0);
  const tone = !r ? '' : ok ? 'from-emerald-500 to-emerald-600' : r.valid ? 'from-amber-400 to-amber-500' : 'from-rose-500 to-rose-600';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Document verification</p>
            <p className="text-xs text-slate-500">Digital signature check (Ed25519)</p>
          </div>
        </div>
        {!r && !error && (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7 text-brand-600" />
          </div>
        )}
        {error && <p className="px-6 py-10 text-center text-sm text-red-600">{error}</p>}
        {r && (
          <>
            <div className={`bg-gradient-to-br ${tone} px-6 py-6 text-white`}>
              <Icon name={ok ? 'shield-check' : r.valid ? 'shield-alert' : 'shield-x'} className="h-10 w-10" />
              <p className="mt-3 text-xl font-semibold text-white">{ok ? 'Genuine document' : r.valid ? 'Genuine, with warnings' : 'Not verified'}</p>
              <p className="mt-1 text-sm text-white/90">{r.message}</p>
            </div>
            {r.warnings && r.warnings.length > 0 && (
              <ul className="space-y-1 border-b border-line bg-amber-50 px-6 py-3 text-sm text-amber-800">
                {r.warnings.map((w) => (
                  <li key={w} className="flex gap-2">
                    <Icon name="triangle-alert" className="mt-0.5 h-4 w-4 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
            {r.document && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-6 py-5 text-sm">
                <dt className="text-slate-500">Issued by</dt>
                <dd className="text-right font-medium text-slate-900">{r.issuer}</dd>
                <dt className="text-slate-500">Document</dt>
                <dd className="text-right font-medium text-slate-900">{r.document.type}</dd>
                <dt className="text-slate-500">Number</dt>
                <dd className="text-right font-mono text-slate-900">{r.document.number}</dd>
                <dt className="text-slate-500">Date</dt>
                <dd className="text-right text-slate-900">{fmtDate(r.document.date)}</dd>
                {r.document.amount !== null && (
                  <>
                    <dt className="text-slate-500">Amount</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {r.document.currency} {fmtMoney(r.document.amount)}
                    </dd>
                  </>
                )}
                <dt className="text-slate-500">Signed at</dt>
                <dd className="text-right text-slate-900">{fmtDateTime(r.document.issuedAt)}</dd>
                <dt className="text-slate-500">Signing key</dt>
                <dd className="text-right font-mono text-[11px] break-all text-slate-500">{r.fingerprint}</dd>
              </dl>
            )}
          </>
        )}
        <p className="border-t border-line px-6 py-3 text-center text-xs text-slate-400">Karya Cipta Solusi · karyaciptasolusi.com</p>
      </div>
    </div>
  );
}
