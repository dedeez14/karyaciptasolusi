import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, cn, Field, Icon, Input, LookupSelect, PageHeader, Spinner, Switch, Tabs, Textarea, toast } from '@/components/ui';

interface Setting {
  key: string;
  group: string;
  label: string | null;
  description: string | null;
  /** string | number | boolean | text | secret | json | lookup:<CATEGORY> */
  valueType: string;
  isSecret: boolean;
  scope: 'company' | 'global';
  value: string | null;
  hasValue: boolean;
}

const GROUPS: Record<string, { label: string; icon: string }> = {
  general: { label: 'General', icon: 'settings' },
  clock: { label: 'Clock', icon: 'clock' },
  notifications: { label: 'Notifications', icon: 'bell' },
  security: { label: 'Security', icon: 'shield' },
  document: { label: 'Documents', icon: 'file-text' },
  sales: { label: 'Sales', icon: 'shopping-cart' },
  inventory: { label: 'Inventory', icon: 'boxes' },
  hris: { label: 'HRIS', icon: 'id-card' },
  files: { label: 'Files', icon: 'folder' },
  mail: { label: 'E-mail', icon: 'mail' },
  integration: { label: 'Integrations', icon: 'plug' },
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { can, me, reload } = useSession();
  const [sp, setSp] = useSearchParams();
  const settings = useQuery({ queryKey: ['system', 'settings'], queryFn: () => api.get<Setting[]>('/system/settings') });
  const groups = useMemo(() => {
    const present = new Set((settings.data ?? []).map((s) => s.group));
    return [...Object.keys(GROUPS).filter((g) => present.has(g)), ...[...present].filter((g) => !GROUPS[g])];
  }, [settings.data]);
  const tab = sp.get('tab') && groups.includes(sp.get('tab')!) ? sp.get('tab')! : groups[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'company' | 'global'>('company');
  const [busy, setBusy] = useState(false);
  const editable = can('system.setting.update');

  useEffect(() => {
    if (settings.data) {
      setValues(Object.fromEntries(settings.data.map((s) => [s.key, s.isSecret ? '' : s.value ?? ''])));
      setDirty(new Set());
    }
  }, [settings.data]);

  const items = (settings.data ?? []).filter((s) => s.group === tab);
  const change = (key: string, v: string) => {
    setValues((s) => ({ ...s, [key]: v }));
    setDirty((d) => new Set([...d, key]));
  };
  const save = async () => {
    const changed = items.filter((s) => dirty.has(s.key) && !(s.isSecret && !values[s.key]));
    if (!changed.length) return toast.info('Nothing to save');
    setBusy(true);
    try {
      await api.put('/system/settings', { values: changed.map((s) => ({ key: s.key, value: values[s.key] === '' ? null : values[s.key], scope })) });
      toast.success('Settings saved');
      await qc.invalidateQueries({ queryKey: ['system', 'settings'] });
      await reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" subtitle="All business configuration lives here - nothing is hardcoded" />
      {settings.isLoading ? (
        <Spinner />
      ) : (
        <>
          <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={groups.map((g) => ({ value: g, label: <span className="inline-flex items-center gap-1.5"><Icon name={GROUPS[g]?.icon ?? 'settings'} />{GROUPS[g]?.label ?? g}</span> }))} />
          <Card
            className="mt-4"
            actions={
              editable && (
                <>
                  {me?.user.isSuperAdmin && (
                    <div className="inline-flex rounded-lg border border-line bg-slate-50 p-0.5 text-xs" role="radiogroup" aria-label="Save scope">
                      {(['company', 'global'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={scope === v}
                          onClick={() => setScope(v)}
                          className={cn('rounded-md px-2.5 py-1 font-medium transition-colors', scope === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                        >
                          {v === 'company' ? `This company` : 'Global default'}
                        </button>
                      ))}
                    </div>
                  )}
                  <Button size="sm" icon="save" loading={busy} onClick={save} disabled={!items.some((s) => dirty.has(s.key))}>
                    Save
                  </Button>
                </>
              )
            }
            title={GROUPS[tab]?.label ?? tab}
          >
            <div className="divide-y divide-line">
              {items.map((s) => (
                <div key={s.key} className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_1.3fr] sm:gap-6">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {s.label ?? s.key}
                      {s.scope === 'company' && <Badge tone="blue">Company</Badge>}
                      {s.isSecret && <Icon name="lock" className="h-3.5 w-3.5 text-emerald-600" />}
                    </p>
                    {s.description && <p className="mt-0.5 text-xs text-slate-500">{s.description}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">{s.key}</p>
                  </div>
                  <div>
                    {s.valueType.startsWith('lookup:') ? (
                      <LookupSelect category={s.valueType.slice(7)} value={values[s.key] ?? ''} disabled={!editable} onChange={(v) => change(s.key, v)} aria-label={s.label ?? s.key} />
                    ) : s.valueType === 'boolean' ? (
                      <Switch checked={values[s.key] === 'true'} disabled={!editable} onChange={(v) => change(s.key, String(v))} />
                    ) : s.valueType === 'text' || s.valueType === 'json' ? (
                      <Textarea rows={4} value={values[s.key] ?? ''} disabled={!editable} onChange={(e) => change(s.key, e.target.value)} className={s.valueType === 'json' ? 'font-mono text-xs' : undefined} />
                    ) : s.isSecret ? (
                      <Field help={s.hasValue ? 'A value is stored (encrypted). Type a new value to replace it.' : 'Not configured yet.'}>
                        <div className="flex items-center gap-2">
                          <Input type="password" autoComplete="new-password" placeholder={s.hasValue ? '••••••••••••' : 'Enter value'} value={values[s.key] ?? ''} disabled={!editable} onChange={(e) => change(s.key, e.target.value)} />
                          {s.hasValue ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Not set</Badge>}
                        </div>
                      </Field>
                    ) : s.key === 'document.primaryColor' ? (
                      <div className="flex gap-2">
                        <input type="color" className="h-10 w-12 cursor-pointer rounded-lg border border-line" value={/^#[0-9a-f]{6}$/i.test(values[s.key] ?? '') ? values[s.key] : '#1e40af'} disabled={!editable} onChange={(e) => change(s.key, e.target.value)} />
                        <Input value={values[s.key] ?? ''} disabled={!editable} onChange={(e) => change(s.key, e.target.value)} />
                      </div>
                    ) : (
                      <Input
                        type={s.valueType === 'number' ? 'number' : /Time$/.test(s.key) ? 'time' : 'text'}
                        className={s.valueType === 'number' ? 'max-w-40 text-right tabular-nums' : /Time$/.test(s.key) ? 'max-w-40' : undefined}
                        value={values[s.key] ?? ''}
                        disabled={!editable}
                        onChange={(e) => change(s.key, e.target.value)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
