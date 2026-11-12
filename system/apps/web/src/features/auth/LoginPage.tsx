import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Button, Field, Icon, Input } from '@/components/ui';

export default function LoginPage() {
  const { status, login, verifyMfa } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** second step: password accepted, code from the authenticator app (or a recovery code) */
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const brand = useQuery({ queryKey: ['branding'], queryFn: () => api.get<{ appName: string; tagline: string }>('/public/branding'), staleTime: Infinity });

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mfaToken) await verifyMfa(mfaToken, code.trim());
      else {
        const r = await login(username.trim(), password);
        setPassword('');
        if (r.mfaToken) {
          setMfaToken(r.mfaToken);
          setCode('');
          return;
        }
      }
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.';
      // the 5 minute challenge expired or was used: back to the password
      if (mfaToken && /took too long/i.test(msg)) {
        setMfaToken(null);
        setCode('');
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };
  const backToPassword = () => {
    setMfaToken(null);
    setCode('');
    setRecovery(false);
    setError('');
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-1.5 bg-accent-400" />
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-11 w-11 rounded-xl bg-white p-1 shadow-sm" />
          <span className="text-lg font-semibold text-white">{brand.data?.appName ?? 'KCS ERP'}</span>
        </div>
        <div>
          <h1 className="text-4xl leading-tight font-bold text-white">From marketing to reporting, in one place.</h1>
          <p className="mt-4 max-w-md text-brand-100">{brand.data?.tagline}</p>
          <ul className="mt-8 grid max-w-md grid-cols-2 gap-3 text-sm text-brand-100">
            {['CRM & Marketing', 'Sales & Invoicing', 'Purchasing', 'Inventory', 'Accounting', 'HRIS & Payroll', 'File Manager', 'Reports'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Icon name="check-circle-2" className="h-4 w-4 text-accent-400" />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-200">© {new Date().getFullYear()} Karya Cipta Solusi</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" autoComplete="on">
          <div className="lg:hidden">
            <img src="/logo.png" alt="" className="mb-3 h-12 w-12" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold">{mfaToken ? 'Two-factor sign-in' : 'Sign in'}</h2>
            <p className="mt-1 text-sm text-slate-500">{mfaToken ? (recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.') : 'Use your company account to continue.'}</p>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {mfaToken ? (
            <>
              <Field label={recovery ? 'Recovery code' : 'Authentication code'} required>
                <Input
                  value={code}
                  onChange={(e) => setCode(recovery ? e.target.value.slice(0, 20) : e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  inputMode={recovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  placeholder={recovery ? 'xxxx-xxxx' : '123456'}
                  className="text-center font-mono text-lg tracking-[0.3em]"
                  autoFocus
                  required
                />
              </Field>
              <Button type="submit" className="w-full" loading={busy} disabled={recovery ? code.trim().length < 8 : code.length !== 6}>
                Verify
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="text-brand-700 hover:underline" onClick={() => { setRecovery((r) => !r); setCode(''); setError(''); }}>
                  {recovery ? 'Use the app code' : 'Lost your phone? Use a recovery code'}
                </button>
                <button type="button" className="text-slate-500 hover:underline" onClick={backToPassword}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
          <Field label="Username or email" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required maxLength={150} />
          </Field>
          <Field label="Password" required>
            <div className="relative">
              <Input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} className="pr-10" />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-2 right-2 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                <Icon name={show ? 'eye-off' : 'eye'} className="h-5 w-5" />
              </button>
            </div>
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!username || !password}>
            Sign in
          </Button>
            </>
          )}
          <p className="flex items-center justify-center gap-1 text-xs text-slate-400">
            <Icon name="shield-check" className="h-3.5 w-3.5" /> Secured session · auto sign-out when idle
          </p>
        </form>
      </div>
    </div>
  );
}
