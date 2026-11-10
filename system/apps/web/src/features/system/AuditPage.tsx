import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Card, DataTable, Modal, Pagination, PageHeader, type Column, type Tone } from '@/components/ui';
import { LogFilters, type LogFilterValue } from './LogFilters';

interface AuditRow {
  id: string;
  createdAt: string;
  username: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const ACTION_TONE: Record<string, Tone> = { CREATE: 'green', UPDATE: 'blue', DELETE: 'red', CANCEL: 'red', CONFIRM: 'violet', APPROVED: 'green', REJECTED: 'red' };
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function AuditPage() {
  const [filters, setFilters] = useState<LogFilterValue>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const entities = useQuery({ queryKey: ['system', 'audit-entities'], queryFn: () => api.get<string[]>('/system/audit-logs/entities') });
  const list = useQuery({
    queryKey: ['system', 'audit', filters, page, pageSize],
    queryFn: () => api.get<Paged<AuditRow>>('/system/audit-logs', { ...filters, action: filters.action?.toUpperCase(), page, pageSize }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AuditRow>[] = [
    { key: 'createdAt', header: 'Time', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    { key: 'username', header: 'User', render: (r) => r.username ?? <span className="text-slate-400">system</span> },
    { key: 'action', header: 'Action', render: (r) => <Badge tone={ACTION_TONE[r.action] ?? 'gray'}>{r.action}</Badge> },
    { key: 'entity', header: 'Entity' },
    { key: 'entityId', header: 'Record', render: (r) => <span className="font-mono text-xs text-slate-500">{r.entityId?.slice(0, 8) ?? ''}</span> },
    {
      key: 'changes',
      header: 'Changes',
      render: (r) => {
        const keys = Object.keys(r.after ?? r.before ?? {});
        return <span className="text-xs text-slate-500">{keys.slice(0, 4).join(', ')}{keys.length > 4 ? ` +${keys.length - 4}` : ''}</span>;
      },
    },
    { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
  ];

  const fields = detail ? [...new Set([...Object.keys(detail.before ?? {}), ...Object.keys(detail.after ?? {})])] : [];

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Immutable history of every data change (who, what, when, before & after)" />
      <Card bodyClass="p-0">
        <LogFilters
          value={filters}
          entities={entities.data}
          actionPlaceholder="Action (e.g. UPDATE)"
          onChange={(v) => {
            setFilters(v);
            setPage(1);
          }}
        />
        <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => String(r.id)} loading={list.isFetching} onRowClick={setDetail} />
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => (setPageSize(s), setPage(1))} />}
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg" title={detail ? `${detail.action} · ${detail.entity}` : ''}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <p className="text-slate-400">Time</p>
                <p>{fmtDateTime(detail.createdAt)}</p>
              </div>
              <div>
                <p className="text-slate-400">User</p>
                <p>{detail.username ?? 'system'}</p>
              </div>
              <div>
                <p className="text-slate-400">IP</p>
                <p className="font-mono">{detail.ip ?? '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">Record ID</p>
                <p className="font-mono break-all">{detail.entityId ?? '—'}</p>
              </div>
            </div>
            {fields.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Field</th>
                      <th className="px-3 py-2">Before</th>
                      <th className="px-3 py-2">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-medium">{f}</td>
                        <td className="px-3 py-2 break-all text-red-600">{show(detail.before?.[f])}</td>
                        <td className="px-3 py-2 break-all text-emerald-700">{show(detail.after?.[f])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No field level details recorded for this action.</p>
            )}
            {detail.userAgent && <p className="text-xs break-all text-slate-400">{detail.userAgent}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
