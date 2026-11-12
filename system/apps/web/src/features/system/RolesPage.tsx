import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, cn, confirm, EmptyState, Field, Icon, Input, LookupSelect, PageHeader, Spinner, Switch, Textarea, toast } from '@/components/ui';

interface Role {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
  description: string | null;
  dataScope: 'ALL' | 'COMPANY' | 'BRANCH' | 'OWN';
  isSystem: boolean;
  isActive: boolean;
  _count?: { permissions: number; assignments: number };
}
interface Permission {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string | null;
}


export default function RolesPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const roles = useQuery({ queryKey: ['system', 'roles'], queryFn: () => api.get<Role[]>('/system/roles') });
  const perms = useQuery({ queryKey: ['system', 'permissions'], queryFn: () => api.get<Permission[]>('/system/roles/permissions'), staleTime: 10 * 60_000 });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [showList, setShowList] = useState(true);

  useEffect(() => {
    if (!selected && roles.data?.length) setSelected(roles.data[0].id);
  }, [roles.data, selected]);

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Role based access control: what each role can see and do"
        actions={
          can('system.role.create') && (
            <Button
              icon="plus"
              onClick={() => {
                setSelected('new');
                setShowList(false);
              }}
            >
              New role
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr] [&>*]:min-w-0">
        <Card bodyClass="p-2" className={cn(!showList && 'hidden lg:block')}>
          {roles.isLoading ? (
            <Spinner className="m-4" />
          ) : (
            <ul className="space-y-0.5">
              {roles.data?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r.id);
                      setShowList(false);
                    }}
                    className={cn('flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left', selected === r.id ? 'bg-brand-50' : 'hover:bg-slate-50')}
                  >
                    <Icon name={r.isSystem ? 'shield' : 'shield-check'} className="mt-0.5 h-4 w-4 text-brand-700" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-slate-400">
                        {r._count?.permissions ?? 0} permissions · {r._count?.assignments ?? 0} users
                      </span>
                    </span>
                    {!r.isActive && <Badge>Inactive</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className={cn(showList && 'hidden lg:block')}>
          <Button variant="ghost" icon="arrow-left" className="mb-2 lg:hidden" onClick={() => setShowList(true)}>
            All roles
          </Button>
          {selected && perms.data ? (
            <RoleEditor
              key={selected}
              roleId={selected === 'new' ? null : selected}
              permissions={perms.data}
              onSaved={(id) => {
                qc.invalidateQueries({ queryKey: ['system', 'roles'] });
                setSelected(id);
              }}
              onDeleted={() => {
                qc.invalidateQueries({ queryKey: ['system', 'roles'] });
                setSelected(null);
                setShowList(true);
              }}
            />
          ) : (
            <Card>
              <EmptyState icon="shield" title="Select a role" />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleEditor({ roleId, permissions, onSaved, onDeleted }: { roleId: string | null; permissions: Permission[]; onSaved: (id: string) => void; onDeleted: () => void }) {
  const { can, me } = useSession();
  const role = useQuery({ queryKey: ['system', 'role', roleId], queryFn: () => api.get<Role & { permissions: string[] }>(`/system/roles/${roleId}`), enabled: !!roleId });
  const [form, setForm] = useState({ code: '', name: '', description: '', dataScope: 'BRANCH', isActive: true });
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role.data) {
      setForm({ code: role.data.code, name: role.data.name, description: role.data.description ?? '', dataScope: role.data.dataScope, isActive: role.data.isActive });
      setGranted(new Set(role.data.permissions));
    }
  }, [role.data]);

  const readOnly = (!!role.data?.isSystem && !me?.user.isSuperAdmin) || !can(roleId ? 'system.role.update' : 'system.role.create');

  const tree = useMemo(() => {
    const s = search.toLowerCase();
    const filtered = permissions.filter((p) => !s || p.code.includes(s) || (p.description ?? '').toLowerCase().includes(s));
    const modules = new Map<string, Map<string, Permission[]>>();
    for (const p of filtered) {
      const m = modules.get(p.module) ?? new Map<string, Permission[]>();
      m.set(p.resource, [...(m.get(p.resource) ?? []), p]);
      modules.set(p.module, m);
    }
    return [...modules.entries()].map(([module, res]) => ({ module, resources: [...res.entries()].map(([resource, perms]) => ({ resource, perms })) }));
  }, [permissions, search]);

  const toggleMany = (codes: string[], on: boolean) =>
    setGranted((g) => {
      const n = new Set(g);
      codes.forEach((c) => (on ? n.add(c) : n.delete(c)));
      return n;
    });

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...form, description: form.description || null, permissions: [...granted] };
      const r = roleId ? await api.patch<Role>(`/system/roles/${roleId}`, body) : await api.post<Role>('/system/roles', body);
      toast.success('Role saved');
      onSaved(r.id);
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!roleId || !(await confirm({ title: 'Delete role?', message: 'Roles assigned to users cannot be deleted.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/system/roles/${roleId}`);
      toast.success('Role deleted');
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  };

  if (roleId && role.isLoading)
    return (
      <Card>
        <Spinner />
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card
        title={roleId ? form.name || 'Role' : 'New role'}
        actions={
          <>
            {role.data?.isSystem && <Badge tone="violet">System role</Badge>}
            {roleId && !role.data?.isSystem && can('system.role.delete') && <Button size="sm" variant="ghost" icon="trash-2" onClick={remove} aria-label="Delete role" />}
            {!readOnly && (
              <Button size="sm" icon="save" loading={busy} onClick={save}>
                Save
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required error={errors.code}>
            <Input value={form.code} disabled={readOnly || !!roleId} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
          </Field>
          <Field label="Name" required error={errors.name}>
            <Input value={form.name} disabled={readOnly} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Data access scope" help="Which records users with this role can see">
            <LookupSelect category="DATA_SCOPE" value={form.dataScope} disabled={readOnly} clearable={false} onChange={(v) => v && setForm({ ...form, dataScope: v })} aria-label="Data access scope" />
          </Field>
          <Field label="Status">
            <div className="pt-2">
              <Switch checked={form.isActive} disabled={readOnly} onChange={(v) => setForm({ ...form, isActive: v })} label={form.isActive ? 'Active' : 'Inactive'} />
            </div>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={form.description} disabled={readOnly} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card
        title={
          <span>
            Permissions <span className="font-normal text-slate-400">({granted.size} of {permissions.length})</span>
          </span>
        }
        actions={
          !readOnly && (
            <>
              <Button size="sm" variant="ghost" onClick={() => toggleMany(permissions.map((p) => p.code), true)}>
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setGranted(new Set())}>
                None
              </Button>
            </>
          )
        }
        bodyClass="p-0"
      >
        <div className="border-b border-line p-3">
          <div className="relative">
            <Icon name="search" className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Filter permissions..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {tree.map(({ module, resources }) => {
            const codes = resources.flatMap((r) => r.perms.map((p) => p.code));
            const count = codes.filter((c) => granted.has(c)).length;
            const isCollapsed = collapsed.has(module) && !search;
            return (
              <div key={module}>
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
                  <button type="button" onClick={() => setCollapsed((c) => (c.has(module) ? new Set([...c].filter((x) => x !== module)) : new Set([...c, module])))} className="flex flex-1 items-center gap-2 text-left">
                    <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-semibold capitalize">{module}</span>
                    <Badge tone={count === codes.length ? 'green' : count ? 'amber' : 'gray'}>
                      {count}/{codes.length}
                    </Badge>
                  </button>
                  {!readOnly && (
                    <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={count === codes.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < codes.length; }} onChange={(e) => toggleMany(codes, e.target.checked)} aria-label={`Select all ${module}`} />
                  )}
                </div>
                {!isCollapsed &&
                  resources.map(({ resource, perms }) => {
                    const rc = perms.map((p) => p.code);
                    const rcount = rc.filter((c) => granted.has(c)).length;
                    return (
                      <div key={resource} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                        <label className="flex w-56 shrink-0 items-center gap-2 text-sm">
                          <input type="checkbox" className="h-4 w-4 accent-brand-700" disabled={readOnly} checked={rcount === rc.length} ref={(el) => { if (el) el.indeterminate = rcount > 0 && rcount < rc.length; }} onChange={(e) => toggleMany(rc, e.target.checked)} />
                          <span className="truncate capitalize">{resource.replace(/[-.]/g, ' ') || module}</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {perms.map((p) => {
                            const on = granted.has(p.code);
                            return (
                              <button
                                key={p.code}
                                type="button"
                                title={p.description ?? p.code}
                                disabled={readOnly}
                                onClick={() => toggleMany([p.code], !on)}
                                className={cn('rounded-full border px-2.5 py-0.5 text-xs transition', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line text-slate-500 hover:border-brand-300', readOnly && 'cursor-default')}
                              >
                                {p.action}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
