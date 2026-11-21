import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { Badge, Button, Card, Field, Icon, Modal, Spinner, StatusBadge, Textarea, toast, type Tone } from '@/components/ui';

export type ApprovalState = 'NOT_REQUIRED' | 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalInfo {
  enabled: boolean;
  status: ApprovalState;
  canRequest?: boolean;
  required: { level: number; name: string; approver: string; approved: boolean }[];
  pending: { id: string; level: number; approver: string; canDecide: boolean; canWithdraw: boolean } | null;
  history: { id: string; level: number; status: string; amount: string; approver: string; requestedBy: string | null; decidedBy: string | null; decidedAt: string | null; comment: string | null; createdAt: string }[];
}

export const APPROVAL_STATE: Record<ApprovalState, { label: string; tone: Tone; icon: string }> = {
  NOT_REQUIRED: { label: 'No approval needed', tone: 'gray', icon: 'circle-check' },
  NOT_REQUESTED: { label: 'Approval required', tone: 'amber', icon: 'stamp' },
  PENDING: { label: 'Waiting for approval', tone: 'amber', icon: 'hourglass' },
  APPROVED: { label: 'Approved', tone: 'green', icon: 'badge-check' },
  REJECTED: { label: 'Rejected', tone: 'red', icon: 'circle-x' },
};

/** Where a document of an approval request lives in the app */
export function approvalDocLink(docType: string, id: string) {
  if (docType === 'CASH') return `/accounting/cash/${id}`;
  if (docType === 'EXPENSE') return `/expenses/${id}`;
  return `/documents/${docType}/${id}`;
}

/** Approval info of a document; `basePath` is the document's API path, e.g. /documents/PO/<id> */
export function useApproval(basePath: string, enabled = true) {
  return useQuery({ queryKey: ['approval', basePath], queryFn: () => api.get<ApprovalInfo>(`${basePath}/approval`), enabled });
}

/** Approve / reject dialog (comment is required when rejecting) */
export function DecideModal({ requestId, title, decision, onClose, onDone }: { requestId: string; title: string; decision: 'APPROVED' | 'REJECTED' | null; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ final: string | null; nextLevel: number | null }>(`/approvals/requests/${requestId}/decide`, { decision, comment });
      toast.success(decision === 'REJECTED' ? 'Request rejected' : r.nextLevel ? `Approved. Sent on to level ${r.nextLevel}.` : 'Approved');
      qc.invalidateQueries({ queryKey: ['approval'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onDone?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.comment) setError(e.errors.comment);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!decision}
      onClose={onClose}
      title={`${decision === 'REJECTED' ? 'Reject' : 'Approve'} ${title}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision === 'REJECTED' ? 'danger' : 'success'} icon={decision === 'REJECTED' ? 'x' : 'check'} loading={busy} onClick={submit}>
            {decision === 'REJECTED' ? 'Reject' : 'Approve'}
          </Button>
        </>
      }
    >
      <Field label={decision === 'REJECTED' ? 'Reason' : 'Comment'} required={decision === 'REJECTED'} error={error} help={decision === 'REJECTED' ? 'The requester sees this reason.' : 'Optional'}>
        <Textarea rows={4} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} invalid={!!error} autoFocus />
      </Field>
    </Modal>
  );
}

/**
 * Approval status, required levels, actions and history of one document.
 * Used on sales/purchase documents, cash payments and expense claims.
 */
export function ApprovalPanel({ basePath, title, info, onRequest, requesting }: { basePath: string; title: string; info?: ApprovalInfo; onRequest?: () => void; requesting?: boolean }) {
  const qc = useQueryClient();
  const q = useApproval(basePath, !info);
  const data = info ?? q.data;
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return q.isLoading ? <Card title="Approval"><Spinner className="h-4 w-4 text-slate-400" /></Card> : null;
  if (data.status === 'NOT_REQUIRED' && !data.history.length) return null;
  const st = APPROVAL_STATE[data.status];
  const withdraw = async () => {
    if (!data.pending) return;
    setBusy(true);
    try {
      await api.post(`/approvals/requests/${data.pending.id}/withdraw`);
      toast.success('Request withdrawn');
      qc.invalidateQueries({ queryKey: ['approval'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Approval" actions={<Badge tone={st.tone} dot>{st.label}</Badge>}>
      {data.required.length > 0 && (
        <ol className="space-y-2">
          {data.required.map((r) => {
            const current = data.pending?.level === r.level;
            return (
              <li key={r.level} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${r.approved ? 'bg-emerald-500 text-white' : current ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {r.approved ? <Icon name="check" className="h-3 w-3" /> : r.level}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{r.approver}</p>
                  <p className="text-xs text-slate-500">
                    Level {r.level} · {r.name}
                    {current ? ' · waiting' : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {data.status === 'REJECTED' && data.history[0]?.comment && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-medium">Rejected:</span> {data.history[0].comment}
        </p>
      )}
      {(data.canRequest || data.pending?.canDecide || data.pending?.canWithdraw) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.canRequest && onRequest && (
            <Button size="sm" icon="send" loading={requesting} onClick={onRequest}>
              {data.status === 'REJECTED' ? 'Request again' : 'Request approval'}
            </Button>
          )}
          {data.pending?.canDecide && (
            <>
              <Button size="sm" variant="success" icon="check" onClick={() => setDecision('APPROVED')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" icon="x" onClick={() => setDecision('REJECTED')}>
                Reject
              </Button>
            </>
          )}
          {data.pending?.canWithdraw && !data.pending.canDecide && (
            <Button size="sm" variant="outline" icon="undo-2" loading={busy} onClick={withdraw}>
              Withdraw request
            </Button>
          )}
        </div>
      )}
      {data.history.length > 0 && (
        <details className="mt-4 border-t border-line pt-3" open={data.history.length <= 3}>
          <summary className="cursor-pointer text-xs font-medium text-slate-500 select-none">History ({data.history.length})</summary>
          <ul className="mt-2 space-y-2.5">
            {data.history.map((h) => (
              <li key={h.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">
                    Level {h.level} · {h.approver}
                  </span>
                  <StatusBadge status={h.status} />
                </div>
                <p className="text-slate-500">
                  {h.decidedBy ? `${h.decidedBy}, ${fmtDateTime(h.decidedAt)}` : `Requested by ${h.requestedBy ?? 'system'}, ${fmtDateTime(h.createdAt)}`} · {fmtMoney(h.amount)}
                </p>
                {h.comment && <p className="mt-0.5 text-slate-600 italic">“{h.comment}”</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.pending && <DecideModal requestId={data.pending.id} title={title} decision={decision} onClose={() => setDecision(null)} />}
    </Card>
  );
}
