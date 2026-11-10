import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Paged } from '@/lib/api';
import { fmtDateTime, plural } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DataTable, Drawer, Dropdown, Field, Icon, Input, Modal, Pagination, PageHeader, Select, Switch, toast, type Column } from '@/components/ui';
import { useLookupOptions } from '@/hooks/useLookups';

interface Assignment {
  id?: string;
  companyId: string;
  branchId: string | null;
  roleId: string;
  company?: { name: string };
  branch?: { name: string } | null;
  role?: { name: string };
}
interface UserRow {
  id: string;
  username: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lockedUntil: string | null;
  defaultCompanyId: string | null;
  defaultBranchId: string | null;
  createdAt: string;
  assignments: Assignment[];
}
interface Role {
  id: string;
  code: string;
  name: string;
}

const isLocked = (u: UserRow) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();

export default function UsersPage() {
  const recordStatus = useLookupOptions('RECORD_STATUS');
  const ls = useListState();
  const qc = useQueryClient();
  const { can, me } = useSession();
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const list = useQuery({ queryKey: ['system', 'users', ls.params], queryFn: () => api.get<Paged<UserRow>>('/system/users', ls.params), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['system', 'users'] });

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<UserRow>[] = [
    {
      key: 'fullName',
      header: 'User',
      render: (u) => (
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{u.fullName.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{u.fullName}</span>
            <span className="block text-xs text-slate-400">@{u.username}</span>
          </span>
        </span>
      ),
    },
    { key: 'email', header: 'Email' },
    {
      key: 'roles',
      header: 'Access',
      render: (u) => (
        <span className="flex flex-wrap justify-end gap-1 md:justify-start">
          {u.isSuperAdmin && <Badge tone="violet">Super admin</Badge>}
          {u.assignments.slice(0, 3).map((a, i) => (
            <Badge key={i} tone="blue">
              {a.role?.name}
              {a.branch ? ` · ${a.branch.name}` : ''}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (
        <span className="flex flex-wrap items-center gap-1">
          {isLocked(u) ? <Badge tone="red">Locked</Badge> : u.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
          {u.mfaEnabled && (
            <Badge tone="blue">
              <Icon name="shield-check" className="h-3 w-3" /> 2FA
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'lastLoginAt', header: 'Last sign in', render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-slate-300">Never</span>) },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={list.data ? plural(list.data.meta.total, 'user') : undefined}
        actions={
          can('system.user.create') && (
            <Button icon="user-plus" onClick={() => setEditing(null)}>
              New user
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, username, email..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <Select className="sm:w-44" value={ls.filters.isActive ?? ''} onChange={(e) => ls.setFilter('isActive', e.target.value)} placeholder="All statuses" options={recordStatus} />
        </div>
        <DataTable
          columns={columns}
          rows={list.data?.data ?? []}
          rowKey={(u) => u.id}
          loading={list.isFetching}
          onRowClick={can('system.user.update') ? (u) => setEditing(u) : undefined}
          actions={(u) => (
            <Dropdown
              trigger={<Button variant="ghost" size="icon" icon="more-vertical" aria-label="Actions" />}
              items={[
                { label: 'Edit', icon: 'pencil', onClick: () => setEditing(u), hidden: !can('system.user.update') },
                { label: 'Reset password', icon: 'key-round', onClick: () => setResetFor(u), hidden: !can('system.user.reset-password') },
                {
                  label: 'Reset two-factor sign-in',
                  icon: 'shield-off',
                  hidden: !u.mfaEnabled || !can('system.user.update') || u.id === me?.user.id,
                  onClick: async () => {
                    if (!(await confirm({ title: 'Reset two-factor sign-in?', message: `${u.fullName} is signed out and sets up an authenticator app again at the next sign-in. Use this when the phone was lost.`, confirmText: 'Reset', danger: true }))) return;
                    act(() => api.post(`/system/users/${u.id}/reset-mfa`), 'Two-factor sign-in reset');
                  },
                },
                { label: 'Unlock account', icon: 'lock-open', onClick: () => act(() => api.post(`/system/users/${u.id}/unlock`), 'Account unlocked'), hidden: !isLocked(u) || !can('system.user.update') },
                'divider',
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  danger: true,
                  hidden: !can('system.user.delete') || u.id === me?.user.id,
                  onClick: async () => {
                    if (await confirm({ title: 'Delete user?', message: `${u.fullName} will lose access immediately.`, confirmText: 'Delete', danger: true })) act(() => api.delete(`/system/users/${u.id}`), 'User deleted');
                  },
                },
              ]}
            />
          )}
        />
        {list.data && <Pagination page={ls.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      <UserForm user={editing} onClose={() => setEditing(undefined)} onSaved={refresh} />
      <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />
    </div>
  );
}

function UserForm({ user, onClose, onSaved }: { user: UserRow | null | undefined; onClose: () => void; onSaved: () => void }) {
  const open = user !== undefined;
  const isEdit = !!user;
  const { me } = useSession();
  const roles = useQuery({ queryKey: ['system', 'roles'], queryFn: () => api.get<Role[]>('/system/roles'), enabled: open });
  const [form, setForm] = useState<Record<string, any>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      user
        ? { username: user.username, email: user.email, fullName: user.fullName, phone: user.phone ?? '', isActive: user.isActive, isSuperAdmin: user.isSuperAdmin, mustChangePassword: user.mustChangePassword, defaultCompanyId: user.defaultCompanyId ?? '', defaultBranchId: user.defaultBranchId ?? '' }
        : { username: '', email: '', fullName: '', phone: '', password: '', isActive: true, isSuperAdmin: false, mustChangePassword: true, defaultCompanyId: me?.company.id ?? '', defaultBranchId: '' },
    );
    setAssignments(user ? user.assignments.map((a) => ({ companyId: a.companyId, branchId: a.branchId, roleId: a.roleId })) : [{ companyId: me?.company.id ?? '', branchId: null, roleId: '' }]);
  }, [open, user, me]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = { ...form, phone: form.phone || null, defaultCompanyId: form.defaultCompanyId || null, defaultBranchId: form.defaultBranchId || null, assignments: assignments.filter((a) => a.companyId && a.roleId) };
      if (isEdit) await api.patch(`/system/users/${user!.id}`, payload);
      else await api.post('/system/users', payload);
      toast.success(isEdit ? 'User updated' : 'User created');
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={isEdit ? `Edit user · ${user?.username}` : 'New user'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} icon="save">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors.fullName}>
            <Input value={form.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <Field label="Username" required error={errors.username} help="Letters, numbers, dot, dash, underscore">
            <Input value={form.username ?? ''} onChange={(e) => set('username', e.target.value.toLowerCase())} autoComplete="off" />
          </Field>
          <Field label="Email" required error={errors.email}>
            <Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <Input type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          {!isEdit && (
            <Field label="Initial password" required error={errors.password} help="Min. 10 chars with upper & lower case, number and symbol" className="sm:col-span-2">
              <Input type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => set('password', e.target.value)} />
            </Field>
          )}
          <Field label="Default company">
            <AsyncSelect resource="companies" value={form.defaultCompanyId} onChange={(v) => set('defaultCompanyId', v ?? '')} />
          </Field>
          <Field label="Default branch">
            <AsyncSelect resource="branches" value={form.defaultBranchId} onChange={(v) => set('defaultBranchId', v ?? '')} placeholder="(None)" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Switch checked={!!form.isActive} onChange={(v) => set('isActive', v)} label="Active" />
          <Switch checked={!!form.mustChangePassword} onChange={(v) => set('mustChangePassword', v)} label="Must change password at next sign in" />
          {me?.user.isSuperAdmin && <Switch checked={!!form.isSuperAdmin} onChange={(v) => set('isSuperAdmin', v)} label="Super administrator" />}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Company access (ACL)</h3>
              <p className="text-xs text-slate-500">Each row grants a role in a company, optionally limited to one branch.</p>
            </div>
            <Button size="sm" variant="outline" icon="plus" onClick={() => setAssignments((a) => [...a, { companyId: me?.company.id ?? '', branchId: null, roleId: '' }])}>
              Add
            </Button>
          </div>
          <div className="space-y-2">
            {assignments.map((a, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <AsyncSelect resource="companies" value={a.companyId} onChange={(v) => setAssignments((s) => s.map((x, j) => (j === i ? { ...x, companyId: v ?? '' } : x)))} placeholder="Company" />
                <AsyncSelect resource="branches" value={a.branchId} onChange={(v) => setAssignments((s) => s.map((x, j) => (j === i ? { ...x, branchId: v } : x)))} placeholder="All branches" />
                <Select value={a.roleId} onChange={(e) => setAssignments((s) => s.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} placeholder="Select role" />
                <Button variant="ghost" size="icon" icon="trash-2" onClick={() => setAssignments((s) => s.filter((_, j) => j !== i))} aria-label="Remove" />
              </div>
            ))}
            {!assignments.length && <p className="text-sm text-slate-400">No access assigned. The user will not be able to open any company.</p>}
          </div>
        </div>
        {isEdit && user && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
            <span className="text-slate-500">Created</span>
            <span>{fmtDateTime(user.createdAt)}</span>
            <span className="text-slate-500">Last sign in</span>
            <span>
              {fmtDateTime(user.lastLoginAt) || 'Never'} {user.lastLoginIp && `from ${user.lastLoginIp}`}
            </span>
            {isLocked(user) && (
              <>
                <span className="text-slate-500">Locked until</span>
                <span className="text-red-600">{fmtDateTime(user.lockedUntil)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ResetPassword({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPassword(''), [user]);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/system/users/${user!.id}/reset-password`, { password });
      toast.success('Password reset. The user must change it at next sign in.');
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title={`Reset password · ${user?.username ?? ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!password} icon="key-round">
            Reset
          </Button>
        </>
      }
    >
      <Field label="New temporary password" help="All sessions of this user will be signed out.">
        <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}
