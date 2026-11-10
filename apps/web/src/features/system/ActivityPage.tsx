import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Card, DataTable, Pagination, PageHeader, type Column } from '@/components/ui';
import { LogFilters, type LogFilterValue } from './LogFilters';

interface ActivityRow {
  id: string;
  createdAt: string;
  username: string | null;
  action: string;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
}

const statusTone = (s: number | null) => (!s ? 'gray' : s < 300 ? 'green' : s < 400 ? 'blue' : s < 500 ? 'amber' : 'red');

export default function ActivityPage() {
  const [filters, setFilters] = useState<LogFilterValue>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const list = useQuery({ queryKey: ['system', 'activity', filters, page, pageSize], queryFn: () => api.get<Paged<ActivityRow>>('/system/activity-logs', { ...filters, page, pageSize }), placeholderData: keepPreviousData });

  const columns: Column<ActivityRow>[] = [
    { key: 'createdAt', header: 'Time', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    { key: 'username', header: 'User', render: (r) => r.username ?? <span className="text-slate-400">anonymous</span> },
    { key: 'action', header: 'Activity', render: (r) => <span className="font-medium">{r.action}</span> },
    {
      key: 'path',
      header: 'Request',
      render: (r) =>
        r.path ? (
          <span className="font-mono text-xs">
            <span className="text-slate-400">{r.method}</span> {r.path}
          </span>
        ) : (
          ''
        ),
    },
    { key: 'statusCode', header: 'Status', render: (r) => (r.statusCode ? <Badge tone={statusTone(r.statusCode)}>{r.statusCode}</Badge> : '') },
    { key: 'durationMs', header: 'Duration', align: 'right', render: (r) => (r.durationMs !== null ? `${r.durationMs} ms` : '') },
    { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs" title={r.userAgent ?? ''}>{r.ip}</span> },
  ];

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Sign-ins, failed logins, changes, exports and downloads" />
      <Card bodyClass="p-0">
        <LogFilters
          value={filters}
          actionPlaceholder="Activity starts with (e.g. auth.)"
          onChange={(v) => {
            setFilters(v);
            setPage(1);
          }}
        />
        <DataTable columns={columns} rows={list.data?.data ?? []} rowKey={(r) => String(r.id)} loading={list.isFetching} />
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => (setPageSize(s), setPage(1))} />}
      </Card>
    </div>
  );
}
