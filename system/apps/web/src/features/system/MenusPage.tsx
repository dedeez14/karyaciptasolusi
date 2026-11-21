import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, cn, confirm, Field, Icon, Input, Modal, PageHeader, Select, Spinner, Switch, toast, NumberInput } from '@/components/ui';

interface MenuRow {
  id: string;
  parentId: string | null;
  code: string;
  label: string;
  icon: string | null;
  path: string | null;
  permissionCode: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function MenusPage() {
  const qc = useQueryClient();
  const { can, reload } = useSession();
  const editable = can('system.menu.update');
  const menus = useQuery({ queryKey: ['system', 'menus'], queryFn: () => api.get<MenuRow[]>('/system/menus') });
  const [editing, setEditing] = useState<Partial<MenuRow> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = menus.data ?? [];

  const children = (parentId: string | null) => rows.filter((m) => m.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  const after = async () => {
    await qc.invalidateQueries({ queryKey: ['system', 'menus'] });
    await reload();
  };

  const move = async (m: MenuRow, dir: -1 | 1) => {
    const siblings = children(m.parentId);
    const idx = siblings.findIndex((s) => s.id === m.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const reordered = [...siblings];
    reordered[idx] = swap;
    reordered[idx + dir] = m;
    try {
      await api.put('/system/menus/order', reordered.map((s, i) => ({ id: s.id, parentId: s.parentId, sortOrder: (i + 1) * 10 })));
      await after();
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async (m: MenuRow) => {
    if (!(await confirm({ title: 'Delete menu?', message: `"${m.label}" will be removed from navigation.`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/system/menus/${m.id}`);
      toast.success('Menu deleted');
      await after();
    } catch (e) {
      toast.error(e);
    }
  };

  const render = (parentId: string | null, depth: number): ReactNode =>
    children(parentId).map((m, i, arr) => {
      const kids = children(m.id);
      const isCollapsed = collapsed.has(m.id);
      return (
        <div key={m.id}>
          <div className={cn('flex items-center gap-2 border-b border-line py-2 pr-2', !m.isActive && 'opacity-50')} style={{ paddingLeft: 12 + depth * 24 }}>
            {kids.length ? (
              <button type="button" onClick={() => setCollapsed((c) => (c.has(m.id) ? new Set([...c].filter((x) => x !== m.id)) : new Set([...c, m.id])))} aria-label="Toggle">
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} className="h-4 w-4 text-slate-400" />
              </button>
            ) : (
              <span className="w-4" />
            )}
            <Icon name={m.icon || 'circle'} className="h-4 w-4 text-brand-700" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.label}</p>
              <p className="truncate text-xs text-slate-400">
                {m.path ?? 'group'} {m.permissionCode && <span className="font-mono">· {m.permissionCode}</span>}
              </p>
            </div>
            {!m.isActive && <Badge>Hidden</Badge>}
            {editable && (
              <div className="flex shrink-0 items-center">
                <Button variant="ghost" size="icon" icon="arrow-up" disabled={i === 0} onClick={() => move(m, -1)} aria-label="Move up" />
                <Button variant="ghost" size="icon" icon="arrow-down" disabled={i === arr.length - 1} onClick={() => move(m, 1)} aria-label="Move down" />
                <Button variant="ghost" size="icon" icon="plus" onClick={() => setEditing({ parentId: m.id, isActive: true, sortOrder: (kids.length + 1) * 10 })} aria-label="Add child" />
                <Button variant="ghost" size="icon" icon="pencil" onClick={() => setEditing(m)} aria-label="Edit" />
                <Button variant="ghost" size="icon" icon="trash-2" onClick={() => remove(m)} aria-label="Delete" />
              </div>
            )}
          </div>
          {!isCollapsed && render(m.id, depth + 1)}
        </div>
      );
    });

  return (
    <div>
      <PageHeader
        title="Menu Management"
        subtitle="Navigation is fully data driven: labels, icons, order and required permission"
        actions={
          editable && (
            <Button icon="plus" onClick={() => setEditing({ parentId: null, isActive: true, sortOrder: (children(null).length + 1) * 10 })}>
              New menu
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">{menus.isLoading ? <Spinner className="m-6" /> : render(null, 0)}</Card>
      <MenuForm menu={editing} menus={rows} onClose={() => setEditing(null)} onSaved={after} />
    </div>
  );
}

function MenuForm({ menu, menus, onClose, onSaved }: { menu: Partial<MenuRow> | null; menus: MenuRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const perms = useQuery({ queryKey: ['system', 'permissions'], queryFn: () => api.get<{ code: string }[]>('/system/roles/permissions'), staleTime: 10 * 60_000, enabled: !!menu });
  const [form, setForm] = useState<Partial<MenuRow>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (menu) {
      setForm(menu);
      setErrors({});
    }
  }, [menu]);
  const parentOptions = useMemo(() => menus.filter((m) => !m.path && m.id !== menu?.id).map((m) => ({ value: m.id, label: m.label })), [menus, menu]);
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        parentId: form.parentId || null,
        code: form.code,
        label: form.label,
        icon: form.icon || null,
        path: form.path || null,
        permissionCode: form.permissionCode || null,
        sortOrder: Number(form.sortOrder ?? 0),
        isActive: form.isActive ?? true,
      };
      if (menu?.id) await api.patch(`/system/menus/${menu.id}`, body);
      else await api.post('/system/menus', body);
      toast.success('Menu saved');
      await onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setErrors(e.errors);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!menu}
      onClose={onClose}
      title={menu?.id ? 'Edit menu' : 'New menu'}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Label" required error={errors.label}>
          <Input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <Field label="Code" required error={errors.code} help="Unique, e.g. sales.invoices">
          <Input value={form.code ?? ''} disabled={!!menu?.id} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Icon" error={errors.icon} help="Lucide icon name, e.g. receipt">
          <div className="flex gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <Icon name={form.icon || 'circle'} className="h-4 w-4" />
            </span>
            <Input value={form.icon ?? ''} onChange={(e) => setForm({ ...form, icon: e.target.value.toLowerCase() })} />
          </div>
        </Field>
        <Field label="Path" error={errors.path} help="Leave empty for a group">
          <Input value={form.path ?? ''} onChange={(e) => setForm({ ...form, path: e.target.value })} placeholder="/r/customers" />
        </Field>
        <Field label="Parent">
          <Select value={form.parentId ?? ''} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })} options={parentOptions} placeholder="(Top level)" />
        </Field>
        <Field label="Required permission" help="Menu is hidden for users without it">
          <Select value={form.permissionCode ?? ''} onChange={(e) => setForm({ ...form, permissionCode: e.target.value || null })} options={(perms.data ?? []).map((p) => ({ value: p.code, label: p.code }))} placeholder="(Everyone)" />
        </Field>
        <Field label="Sort order">
          <NumberInput decimals={0} grouping={false} min={0} max={9999} value={form.sortOrder ?? 0} onChange={(v) => setForm({ ...form, sortOrder: v === '' ? 0 : Number(v) })} />
        </Field>
        <Field label="Visible">
          <div className="pt-2">
            <Switch checked={form.isActive ?? true} onChange={(v) => setForm({ ...form, isActive: v })} />
          </div>
        </Field>
      </div>
    </Modal>
  );
}
