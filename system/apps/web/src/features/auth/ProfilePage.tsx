import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Button, Card, Field, Icon, Input, PageHeader, toast } from '@/components/ui';
import { TwoFactorCard } from './TwoFactorCard';
import { SignatureCard } from './SignatureCard';

export default function ProfilePage() {
  const { me, logout } = useSession();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const forced = sp.get('force') === '1' || me?.user.mustChangePassword;
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    setErrors({});
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password changed. Please sign in again.');
      await logout();
      navigate('/login');
    } catch (err) {
      if (err instanceof ApiError) setErrors({ newPassword: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Profile" subtitle={me?.user.email} />
      {forced && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="key-round" className="mt-0.5 h-4 w-4" /> For your security, please set a new password before continuing.
        </div>
      )}
      {!forced && me?.user.mfaSetupRequired && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="shield-alert" className="mt-0.5 h-4 w-4" /> Your role requires two-factor sign-in. Set it up below to continue using the app.
        </div>
      )}
      <div className="grid gap-4">
        {!forced && <SignatureCard />}
        {!forced && <TwoFactorCard />}
        <Card title="Account">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd>{me?.user.fullName}</dd>
            <dt className="text-slate-500">Username</dt>
            <dd>{me?.user.username}</dd>
            <dt className="text-slate-500">Company</dt>
            <dd>{me?.company.name}</dd>
            <dt className="text-slate-500">Data access</dt>
            <dd>{me?.dataScope}</dd>
            <dt className="text-slate-500">Last sign in</dt>
            <dd>{fmtDateTime(me?.user.lastLoginAt)}</dd>
          </dl>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Current password" required>
              <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
            </Field>
            <Field label="New password" required error={errors.newPassword} help="At least 10 characters with upper & lower case, a number and a symbol.">
              <Input type="password" autoComplete="new-password" value={form.newPassword} invalid={!!errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
            </Field>
            <Field label="Confirm new password" required error={errors.confirm}>
              <Input type="password" autoComplete="new-password" value={form.confirm} invalid={!!errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={busy} icon="key-round">
                Update password
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
