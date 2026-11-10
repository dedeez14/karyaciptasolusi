import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, toast } from '@/components/ui';

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
}
interface SetupData {
  secret: string;
  otpauthUrl: string;
  qr: string;
  issuer: string;
  account: string;
}

const codeInput = (v: string) => v.replace(/[^\d]/g, '').slice(0, 6);

/** Two-factor sign-in with an authenticator app: set up, recovery codes, turn off */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const reload = useSession((s) => s.reload);
  const status = useQuery({ queryKey: ['mfa'], queryFn: () => api.get<MfaStatus>('/auth/mfa') });
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const s = status.data;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setSetup(await api.post<SetupData>('/auth/mfa/setup'));
      setCode('');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
      setSetup(null);
      setCodes(r.recoveryCodes);
      qc.invalidateQueries({ queryKey: ['mfa'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The code could not be checked');
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setCodes(null);
    toast.success('Two-factor sign-in is on');
    await reload(); // lifts the "set up first" restriction for administrators
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Two-factor sign-in
          {s?.enabled ? <Badge tone="green" dot>On</Badge> : <Badge tone={s?.required ? 'amber' : 'gray'} dot>{s?.required ? 'Required' : 'Off'}</Badge>}
        </span>
      }
      subtitle="A 6-digit code from an authenticator app on your phone, asked after your password"
    >
      {!s ? null : s.enabled ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-slate-500">Turned on</dt>
            <dd>{fmtDateTime(s.enabledAt)}</dd>
            <dt className="text-slate-500">Recovery codes left</dt>
            <dd className={s.recoveryCodesLeft <= 3 ? 'font-medium text-amber-700' : ''}>
              {s.recoveryCodesLeft} of 10{s.recoveryCodesLeft <= 3 && ' - make new ones'}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon="list-restart" onClick={() => setRenewing(true)}>
              New recovery codes
            </Button>
            {!s.required && (
              <Button variant="ghost" icon="shield-off" onClick={() => setDisabling(true)}>
                Turn off
              </Button>
            )}
          </div>
          {s.required && <p className="text-xs text-slate-500">Your role requires two-factor sign-in, so it cannot be turned off. Lost your phone? Sign in with a recovery code, or ask an administrator to reset it.</p>}
        </div>
      ) : !setup ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Even if someone learns your password, they cannot sign in without your phone. You need an authenticator app, for example <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> or <strong>Authy</strong> (free on Android and iPhone).
          </p>
          <Button icon="shield-check" loading={busy} onClick={start}>
            Set up two-factor sign-in
          </Button>
        </div>
      ) : (
        <form onSubmit={enable} className="space-y-5">
          <ol className="space-y-5 text-sm">
            <li className="flex gap-3">
              <Step n={1} />
              <p className="text-slate-700">Open the authenticator app on your phone and choose <strong>Add account</strong> → <strong>Scan a QR code</strong>.</p>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <div className="min-w-0 space-y-3">
                <p className="text-slate-700">Scan this code:</p>
                <img src={setup.qr} alt={`QR code to add ${setup.issuer} (${setup.account}) to an authenticator app`} width={180} height={180} className="rounded-lg border border-line bg-white p-1" />
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer">Cannot scan? Enter the key by hand</summary>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-sm tracking-wider text-slate-800 select-all">{setup.secret}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="copy"
                      onClick={() => {
                        void navigator.clipboard?.writeText(setup.secret.replace(/\s/g, ''));
                        toast.success('Key copied');
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="mt-1">Account: {setup.account} · type: time based</p>
                </details>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <div className="w-full max-w-xs">
                <Field label="Enter the 6-digit code the app shows" error={error}>
                  <Input value={code} onChange={(e) => setCode(codeInput(e.target.value))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="text-center font-mono text-lg tracking-[0.4em]" invalid={!!error} autoFocus />
                </Field>
              </div>
            </li>
          </ol>
          <div className="flex gap-2">
            <Button type="submit" icon="shield-check" loading={busy} disabled={code.length !== 6}>
              Turn on
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {codes && <RecoveryCodes codes={codes} onDone={finish} />}
      {disabling && <DisableModal onClose={() => setDisabling(false)} onDone={() => qc.invalidateQueries({ queryKey: ['mfa'] })} />}
      {renewing && (
        <RenewModal
          onClose={() => setRenewing(false)}
          onDone={(c) => {
            setRenewing(false);
            setCodes(c);
            qc.invalidateQueries({ queryKey: ['mfa'] });
          }}
        />
      )}
    </Card>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>;
}

/** shown once: the user must keep them somewhere safe */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `KCS ERP recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kcs-erp-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal
      open
      onClose={() => undefined}
      title="Save your recovery codes"
      size="sm"
      footer={
        <Button icon="check" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">If you lose your phone, sign in with one of these codes instead of the app code. Each code works once. They are shown only now.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 font-mono text-sm text-slate-800" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c} className="select-all">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            icon="copy"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              toast.success('Codes copied');
            }}
          >
            Copy
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={download}>
            Download .txt
          </Button>
        </div>
        <Checkbox checked={saved} onChange={setSaved} label="I saved these codes in a safe place" />
      </div>
    </Modal>
  );
}

function DisableModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/mfa/disable', { password, code });
      toast.success('Two-factor sign-in is off');
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not turn it off');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Turn off two-factor sign-in"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon="shield-off" loading={busy} disabled={!password || code.length < 6} onClick={submit}>
            Turn off
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Field label="Password" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Code from the app (or a recovery code)" required>
          <Input value={code} onChange={(e) => setCode(e.target.value.slice(0, 20))} autoComplete="one-time-code" />
        </Field>
      </div>
    </Modal>
  );
}

function RenewModal({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      onDone((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code })).recoveryCodes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make new codes');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New recovery codes"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="list-restart" loading={busy} disabled={code.length !== 6} onClick={submit}>
            Make new codes
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">The old codes stop working.</p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <Field label="Code from the app" required>
          <Input value={code} onChange={(e) => setCode(codeInput(e.target.value))} inputMode="numeric" autoComplete="one-time-code" className="text-center font-mono tracking-[0.4em]" />
        </Field>
      </div>
    </Modal>
  );
}

export default TwoFactorCard;
