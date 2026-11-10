import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DataTable, PageHeader, toast, type Column } from '@/components/ui';

interface SessionRow {
  id: string;
  userId: string;
  user: { username: string; fullName: string };
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Very small UA summariser for display only */
function device(ua: string | null) {
  if (!ua) return 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}

export default function SessionsPage() {
  const qc = useQueryClient();
  const { can, me } = useSession();
  const list = useQuery({ queryKey: ['system', 'sessions'], queryFn: () => api.get<SessionRow[]>('/system/sessions') });

  const revoke = async (s: SessionRow) => {
    if (!(await confirm({ title: 'Revoke session?', message: `${s.user.fullName} will be signed out on ${device(s.userAgent)}.`, confirmText: 'Revoke', danger: true }))) return;
    try {
      await api.post(`/system/sessions/${s.id}/revoke`);
      toast.success('Session revoked');
      qc.invalidateQueries({ queryKey: ['system', 'sessions'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const columns: Column<SessionRow>[] = [
    {
      key: 'user',
      header: 'User',
      render: (s) => (
        <span>
          <span className="font-medium">{s.user.fullName}</span> <span className="text-xs text-slate-400">@{s.user.username}</span>
          {s.userId === me?.user.id && (
            <span className="ml-2">
              <Badge tone="green">You</Badge>
            </span>
          )}
        </span>
      ),
    },
    { key: 'device', header: 'Device', render: (s) => <span title={s.userAgent ?? ''}>{device(s.userAgent)}</span> },
    { key: 'ip', header: 'IP', render: (s) => <span className="font-mono text-xs">{s.ip}</span> },
    { key: 'createdAt', header: 'Signed in', render: (s) => fmtDateTime(s.createdAt) },
    { key: 'expiresAt', header: 'Expires', render: (s) => fmtDateTime(s.expiresAt) },
  ];

  return (
    <div>
      <PageHeader title="Active Sessions" subtitle={list.data ? `${list.data.length} active refresh sessions` : undefined} actions={<Button variant="outline" icon="refresh-cw" onClick={() => list.refetch()}>Refresh</Button>} />
      <Card bodyClass="p-0">
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          rowKey={(s) => s.id}
          loading={list.isFetching}
          actions={(s) =>
            can('system.session.revoke') ? (
              <Button size="sm" variant="outline" icon="log-out" onClick={() => revoke(s)}>
                Revoke
              </Button>
            ) : null
          }
        />
      </Card>
    </div>
  );
}
