import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { Icon, Spinner } from '@/components/ui';

interface VerifyResult {
  valid: boolean;
  message: string;
  warnings?: string[];
  document?: { type: string; number: string; date: string; amount: number | null; currency: string | null; party?: string | null; issuedAt: string; status: string | null };
  issuer?: string;
  fingerprint?: string;
  /** full signature token (when the QR carried a short code) */
  token?: string;
}

interface FileResult {
  result: 'MATCH' | 'ALTERED' | 'UNKNOWN' | 'NOT_FOUND';
  message: string;
  document?: { type: string; number: string | null; issuedAt: string };
  issuer?: string;
  fileName: string;
  /** the file carries the signature of a different document than the scanned QR */
  otherDocument?: boolean;
}

const HEADERS = { 'X-Requested-With': 'kcs-web' };
const TOKEN_RE = /kcs-signature:([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/;

async function sha256Hex(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Finds the signature token pdfkit stores in the PDF metadata (Keywords). */
function tokenInFile(buf: ArrayBuffer): string | null {
  const text = new TextDecoder('latin1').decode(buf);
  return TOKEN_RE.exec(text)?.[1] ?? null;
}

/**
 * Public page opened by the QR code printed on every document (no sign-in required).
 * 1. checks the Ed25519 signature of the QR code (the facts printed on the document);
 * 2. optionally checks a PDF file: hashed in the browser and compared with the fingerprints of
 *    the files we issued, so an edited PDF is reported as altered even if its QR is genuine.
 */
export default function VerifyPage() {
  const [sp] = useSearchParams();
  const token = sp.get('t') ?? '';
  const code = sp.get('c') ?? '';
  const [r, setR] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token && !code) return;
    fetch(`/api/v1/public/verify?${token ? `t=${encodeURIComponent(token)}` : `c=${encodeURIComponent(code)}`}`, { headers: HEADERS })
      .then((res) => res.json())
      .then(setR)
      .catch(() => setError('The verification service is not reachable.'));
  }, [token, code]);

  const ok = r?.valid && !(r.warnings?.length ?? 0);
  const tone = !r ? '' : ok ? 'from-emerald-500 to-emerald-600' : r.valid ? 'from-amber-400 to-amber-500' : 'from-rose-500 to-rose-600';

  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas p-4 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Document verification</p>
            <p className="text-xs text-slate-500">Digital signature & file integrity check</p>
          </div>
        </div>
        {(token || code) && !r && !error && (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7 text-brand-600" />
          </div>
        )}
        {error && <p className="px-6 py-10 text-center text-sm text-red-600">{error}</p>}
        {r && (
          <>
            <div className={`bg-gradient-to-br ${tone} px-6 py-5 text-white`}>
              <div className="flex items-center gap-3">
                <Icon name={ok ? 'shield-check' : r.valid ? 'shield-alert' : 'shield-x'} className="h-8 w-8 shrink-0" />
                <p className="text-lg font-semibold text-white">{ok ? 'Signature valid' : r.valid ? 'Signature valid, with warnings' : 'Not verified'}</p>
              </div>
              <p className="mt-2 text-sm text-white/90">{r.message}</p>
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
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-6 py-5 text-sm">
                <dt className="text-slate-500">Issued by</dt>
                <dd className="text-right font-medium text-slate-900">{r.issuer}</dd>
                <dt className="text-slate-500">Document</dt>
                <dd className="text-right font-medium text-slate-900">{r.document.type}</dd>
                <dt className="text-slate-500">Number</dt>
                <dd className="text-right font-mono text-slate-900">{r.document.number}</dd>
                {r.document.party && (
                  <>
                    <dt className="text-slate-500">Issued to</dt>
                    <dd className="text-right text-slate-900">{r.document.party}</dd>
                  </>
                )}
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
              </dl>
            )}
          </>
        )}
        <FileCheck urlToken={token || r?.token || ''} />
      </div>
    </div>
  );
}

function FileCheck({ urlToken }: { urlToken: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<FileResult | null>(null);
  const [err, setErr] = useState('');

  const check = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    setRes(null);
    if (!crypto?.subtle) {
      setErr('This browser cannot check files on an insecure (http) connection. Open this page over https.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setErr('The file is too large (max 30 MB).');
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const fileToken = tokenInFile(buf);
      const sha256 = await sha256Hex(buf);
      const response = await fetch('/api/v1/public/verify/file', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256, token: fileToken ?? urlToken ?? '' }),
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as Omit<FileResult, 'fileName'>;
      setRes({ ...data, fileName: file.name, otherDocument: !!(fileToken && urlToken && fileToken !== urlToken && data.result !== 'MATCH') });
    } catch {
      setErr('The file could not be checked. Please try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const look = {
    MATCH: { icon: 'file-check-2', title: 'Original file', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    ALTERED: { icon: 'file-x-2', title: 'Modified file', cls: 'border-rose-200 bg-rose-50 text-rose-800' },
    NOT_FOUND: { icon: 'file-x-2', title: 'Unknown or modified file', cls: 'border-rose-200 bg-rose-50 text-rose-800' },
    UNKNOWN: { icon: 'file-question', title: 'Cannot compare this file', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  } as const;

  return (
    <div className="border-t border-line px-6 py-5">
      <p className="text-sm font-semibold text-slate-900">Check the PDF file</p>
      <p className="mt-0.5 text-xs text-slate-500">A QR code proves who issued the document. To make sure a PDF was not edited, check the file itself. It is checked in your browser and never uploaded.</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          check(e.dataTransfer.files?.[0]);
        }}
        className={`mt-3 flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-sm transition-colors ${drag ? 'border-brand-400 bg-brand-50' : 'border-line hover:border-brand-300 hover:bg-slate-50'}`}
      >
        {busy ? <Spinner className="h-5 w-5 text-brand-600" /> : <Icon name="file-up" className="h-6 w-6 text-slate-400" />}
        <span className="font-medium text-slate-700">{busy ? 'Checking...' : 'Choose or drop a PDF'}</span>
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => check(e.target.files?.[0])} />
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {res && (
        <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${look[res.result].cls}`}>
          <div className="flex items-center gap-2 font-semibold">
            <Icon name={look[res.result].icon} className="h-5 w-5 shrink-0" />
            {look[res.result].title}
          </div>
          <p className="mt-1">{res.message}</p>
          {res.otherDocument && <p className="mt-1 font-medium">This file belongs to a different document than the QR code you scanned.</p>}
          <p className="mt-2 truncate text-xs opacity-75">
            {res.fileName}
            {res.document?.number ? ` · ${res.document.type} ${res.document.number}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
