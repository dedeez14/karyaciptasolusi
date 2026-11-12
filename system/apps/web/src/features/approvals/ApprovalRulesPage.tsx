import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useLookupLabel, useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, cn, confirm, DataTable, Drawer, EmptyState, Field, Icon, Input, LookupSelect, PageHeader, Select, Switch, toast, type Column, NumberInput } from '@/components/ui';

interface Rule {
  id: string;
  name: string;
  docType: string;
  minAmount: string;
  level: number;
  approverRoleId: string | null;
  approverUserId: string | null;
  approverName: string;
  isActive: boolean;
}

const blank = { name: '', docType: '', minAmount: '0', level: '1', approverKind: 'role' as 'role' | 'user', approverRoleId: '', approverUserId: '', isActive: true };

function RuleDrawer({ rule, open, onClose }: { rule: Rule | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['approvals', 'roles'], queryFn: () => api.get<{ value: string; label: string }[]>('/approvals/rules/roles'), enabled: open, staleTime: 60_000 });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      rule
        ? { name: rule.name, docType: rule.docType, minAmount: String(Number(rule.minAmount)), level: String(rule.level), approverKind: rule.approverUserId ? 'user' : 'role', approverRoleId: rule.approverRoleId ?? '', approverUserId: rule.approverUserId ?? '', isActive: rule.isActive }
        : blank,
    );
  }, [open, rule]);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = {
      name: form.name,
      docType: form.docType,
      minAmount: Number(form.minAmount || 0),
      level: Number(form.level || 1),
      approverRoleId: form.approverKind === 'role' ? form.approverRoleId : null,
      approverUserId: form.approverKind === 'user' ? form.approverUserId : null,
      isActive: form.isActive,
    };
    try {
      if (rule) await api.patch(`/approvals/rules/${rule.id}`, body);
      else await api.post('/approvals/rules', body);
      toast.success(rule ? 'Rule updated' : 'Rule created');
      qc.invalidateQueries({ queryKey: ['approvals', 'rules'] });
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
      title={rule ? 'Edit approval rule' : 'New approval rule'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon="save" loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Rule name" required error={errors.name}>
          <Input value={form.name} maxLength={150} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Purchase orders above 10 million" invalid={!!errors.name} />
        </Field>
        <Field label="Document type" required error={errors.docType}>
          <LookupSelect category="APPROVAL_DOC_TYPE" value={form.docType} onChange={(v) => set('docType', v)} invalid={!!errors.docType} clearable={false} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies from amount" required error={errors.minAmount} help="Total in base currency; 0 = every document">
            <NumberInput fixed={2} value={form.minAmount} onChange={(v) => set('minAmount', v)} invalid={!!errors.minAmount} />
          </Field>
          <Field label="Approval level" required error={errors.level} help="Level 1 decides first, then level 2, ...">
            <NumberInput decimals={0} grouping={false} min={1} max={10} value={form.level} onChange={(v) => set('level', v)} invalid={!!errors.level} />
          </Field>
        </div>
        <Field label="Approver" required error={errors.approverRoleId ?? errors.approverUserId}>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {(['role', 'user'] as const).map((k) => (
                <button key={k} type="button" onClick={() => set('approverKind', k)} className={cn('flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium', form.approverKind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                  <Icon name={k === 'role' ? 'users' : 'user'} className="h-4 w-4" />
                  {k === 'role' ? 'Anyone with a role' : 'A specific user'}
                </button>
              ))}
            </div>
            {form.approverKind === 'role' ? (
              <Select value={form.approverRoleId} onChange={(e) => set('approverRoleId', e.target.value)} options={roles.data ?? []} placeholder="Select role..." invalid={!!errors.approverRoleId} />
            ) : (
              <AsyncSelect resource="users" value={form.approverUserId} onChange={(v) => set('approverUserId', v ?? '')} invalid={!!errors.approverUserId} />
            )}
          </div>
        </Field>
        <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Active" />
        <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          When several rules of the same level match a document, the one with the highest amount applies. Requesters can never approve their own documents.
        </p>
      </div>
    </Drawer>
  );
}

export default function ApprovalRulesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const docLabel = useLookupLabel('APPROVAL_DOC_TYPE');
  const docTypes = useLookupOptions('APPROVAL_DOC_TYPE');
  const q = useQuery({ queryKey: ['approvals', 'rules'], queryFn: () => api.get<Rule[]>('/approvals/rules') });
  const [editing, setEditing] = useState<Rule | null | undefined>(undefined);
  const [docType, setDocType] = useState('');
  const settings = useQuery({ queryKey: ['system', 'settings'], queryFn: () => api.get<{ key: string; value: string | null }[]>('/system/settings'), enabled: can('system.setting.read'), staleTime: 60_000 });
  const disabled = settings.data?.find((s) => s.key === 'approvals.enabled')?.value === 'false';
  const rows = useMemo(() => (q.data ?? []).filter((r) => !docType || r.docType === docType), [q.data, docType]);

  const remove = async (r: Rule) => {
    if (!(await confirm({ title: `Delete rule "${r.name}"?`, message: 'Pending requests keep their approver. New documents no longer need this approval.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/approvals/rules/${r.id}`);
      toast.success('Rule deleted');
      qc.invalidateQueries({ queryKey: ['approvals', 'rules'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<Rule>[] = [
    { key: 'docType', header: 'Document', render: (r) => <span className="font-medium">{docLabel(r.docType)}</span> },
    { key: 'name', header: 'Rule' },
    { key: 'minAmount', header: 'From amount', align: 'right', render: (r) => <span className="tabular-nums">{fmtMoney(r.minAmount)}</span> },
    { key: 'level', header: 'Level', align: 'center', render: (r) => <Badge tone="blue">L{r.level}</Badge> },
    { key: 'approver', header: 'Approver', render: (r) => r.approverName },
    { key: 'isActive', header: 'Status', render: (r) => (r.isActive ? <Badge tone="green" dot>Active</Badge> : <Badge dot>Inactive</Badge>) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approval Rules"
        subtitle="Which documents need approval, from which amount and by whom"
        actions={
          can('system.approval-rule.create') && (
            <Button icon="plus" onClick={() => setEditing(null)}>
              New rule
            </Button>
          )
        }
      />
      {disabled && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Icon name="triangle-alert" className="h-4 w-4" />
          The approval workflow is switched off in System → Settings (Approvals). Rules are ignored until it is enabled.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={docType ? 'outline' : 'secondary'} onClick={() => setDocType('')}>
          All
        </Button>
        {docTypes.map((d) => (
          <Button key={d.value} size="sm" variant={docType === d.value ? 'secondary' : 'outline'} onClick={() => setDocType(d.value)}>
            {d.label}
            <span className="text-xs text-slate-400">{(q.data ?? []).filter((r) => r.docType === d.value).length || ''}</span>
          </Button>
        ))}
      </div>
      <Card bodyClass="p-0">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={can('system.approval-rule.update') ? (r) => setEditing(r) : undefined}
          actions={(r) =>
            can('system.approval-rule.delete') ? (
              <Button
                size="icon"
                variant="ghost"
                icon="trash-2"
                aria-label="Delete rule"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(r);
                }}
              />
            ) : null
          }
          empty={<EmptyState icon="list-checks" title="No approval rules" description="Without rules documents are confirmed directly. Add a rule to require approval, e.g. purchase orders above a certain amount." />}
        />
      </Card>
      <RuleDrawer open={editing !== undefined} rule={editing ?? null} onClose={() => setEditing(undefined)} />
    </div>
  );
}
