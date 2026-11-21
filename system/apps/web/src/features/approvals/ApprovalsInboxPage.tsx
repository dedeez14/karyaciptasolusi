import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useListState } from '@/hooks/useListState';
import { useLookupLabel } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Button, Card, DataTable, EmptyState, Icon, Input, LookupSelect, Pagination, PageHeader, StatCard, StatusBadge, Tabs, type Column } from '@/components/ui';
import { approvalDocLink, DecideModal } from './ApprovalPanel';

interface RequestRow {
  id: string;
  docType: string;
  documentId: string;
  documentNumber: string;
  amount: string;
  level: number;
  statusCode: string;
  approverName: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
  canDecide: boolean;
  canWithdraw: boolean;
}

type Tab = 'waiting' | 'mine' | 'all';

export default function ApprovalsInboxPage() {
  const navigate = useNavigate();
  const { can } = useSession();
  const ls = useListState();
  const docLabel = useLookupLabel('APPROVAL_DOC_TYPE');
  const statusLabel = useLookupLabel('APPROVAL_STATUS');
  const tab = (ls.filters.tab as Tab) || 'waiting';
  const counts = useQuery({ queryKey: ['approvals', 'counts'], queryFn: () => api.get<{ waiting: number; minePending: number; canSeeAll: boolean }>('/approvals/counts') });
  const params = { page: ls.page, pageSize: ls.pageSize, search: ls.search, tab, status: ls.filters.status, docType: ls.filters.docType };
  const q = useQuery({ queryKey: ['approvals', 'list', params], queryFn: () => api.get<Paged<RequestRow>>('/approvals/requests', params), placeholderData: keepPreviousData });
  const [deciding, setDeciding] = useState<{ row: RequestRow; decision: 'APPROVED' | 'REJECTED' } | null>(null);

  const columns: Column<RequestRow>[] = [
    {
      key: 'document',
      header: 'Document',
      render: (r) => (
        <div>
          <span className="font-medium text-brand-700">{r.documentNumber}</span>
          <span className="block text-xs text-slate-500">{docLabel(r.docType)}</span>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <span className="font-medium tabular-nums">{fmtMoney(r.amount)}</span> },
    { key: 'level', header: 'Level', align: 'center', render: (r) => r.level },
    { key: 'approver', header: 'Approver', render: (r) => r.approverName },
    { key: 'requestedBy', header: 'Requested by', hideOnMobile: true, render: (r) => <span className="text-sm">{r.requestedByName ?? '—'}<span className="block text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span></span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div>
          <StatusBadge status={r.statusCode} label={statusLabel(r.statusCode)} />
          {r.decidedByName && <span className="mt-0.5 block text-xs text-slate-500">{r.decidedByName}</span>}
          {r.comment && <span className="block max-w-56 truncate text-xs text-slate-400 italic" title={r.comment}>“{r.comment}”</span>}
        </div>
      ),
    },
  ];

  const tabs: { value: Tab; label: React.ReactNode }[] = [
    { value: 'waiting', label: <span className="flex items-center gap-1.5">Waiting for me {!!counts.data?.waiting && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] text-white">{counts.data.waiting}</span>}</span> },
    { value: 'mine', label: 'Requested by me' },
    ...(counts.data?.canSeeAll ? [{ value: 'all' as Tab, label: 'All requests' }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" subtitle="Documents waiting for a decision and the requests you sent" actions={can('system.approval-rule.read') && <Button variant="outline" icon="list-checks" onClick={() => navigate('/system/approval-rules')}>Approval rules</Button>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Waiting for my decision" value={counts.data?.waiting ?? '—'} icon="stamp" tone="amber" />
        <StatCard label="My requests still pending" value={counts.data?.minePending ?? '—'} icon="hourglass" tone="blue" />
      </div>
      <Tabs value={tab} onChange={(v) => ls.setFilter('tab', v === 'waiting' ? null : v)} tabs={tabs} />
      <Card bodyClass="p-0">
        <div className="grid grid-cols-1 gap-2 border-b border-line p-3 sm:grid-cols-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ls.setSearch(ls.searchInput);
            }}
          >
            <Icon name="search" className="absolute top-3 left-3 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search document number..." value={ls.searchInput} onChange={(e) => ls.setSearchInput(e.target.value)} onBlur={() => ls.setSearch(ls.searchInput)} />
          </form>
          <LookupSelect category="APPROVAL_DOC_TYPE" value={ls.filters.docType ?? ''} onChange={(v) => ls.setFilter('docType', v || null)} placeholder="All document types" />
          {tab !== 'waiting' && <LookupSelect category="APPROVAL_STATUS" value={ls.filters.status ?? ''} onChange={(v) => ls.setFilter('status', v || null)} placeholder="Any status" />}
        </div>
        <DataTable
          columns={columns}
          rows={q.data?.data ?? []}
          rowKey={(r) => r.id}
          loading={q.isFetching}
          onRowClick={(r) => navigate(approvalDocLink(r.docType, r.documentId))}
          actions={(r) =>
            r.canDecide ? (
              <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="success" icon="check" onClick={() => setDeciding({ row: r, decision: 'APPROVED' })}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" icon="x" aria-label="Reject" onClick={() => setDeciding({ row: r, decision: 'REJECTED' })} />
              </div>
            ) : null
          }
          empty={<EmptyState icon="stamp" title={tab === 'waiting' ? 'Nothing to approve' : 'No requests'} description={tab === 'waiting' ? 'Requests assigned to you or your role appear here.' : 'Documents sent for approval appear here.'} />}
        />
        {q.data && <Pagination page={ls.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={ls.pageSize} onPage={ls.setPage} onPageSize={ls.setPageSize} />}
      </Card>
      {deciding && <DecideModal requestId={deciding.row.id} title={deciding.row.documentNumber} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}
