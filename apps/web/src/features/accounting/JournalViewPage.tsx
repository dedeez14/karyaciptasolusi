import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, EmptyState, PageHeader, Spinner, StatusBadge, toast } from '@/components/ui';
import { SOURCE_LABELS, type JournalRow } from './JournalListPage';

interface JournalDetail extends JournalRow {
  lines: { id: string; lineNo: number; description: string | null; debit: string; credit: string; account: { code: string; name: string } }[];
}

const sourceLink = (type: string | null, id: string | null) => {
  if (!type || !id || type === 'MANUAL') return null;
  if (type === 'PAY_IN') return `/payments/in/${id}`;
  if (type === 'PAY_OUT') return `/payments/out/${id}`;
  if (type === 'PAYROLL') return `/hris/payroll/${id}`;
  return `/documents/${type}/${id}`;
};

export default function JournalViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['journals', 'one', id], queryFn: () => api.get<JournalDetail>(`/journals/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (q.error || !q.data) return <EmptyState icon="file-x" title="Journal not found" description={(q.error as Error)?.message} />;
  const j = q.data;
  const link = sourceLink(j.sourceType, j.sourceId);

  const act = async (name: 'post' | 'void') => {
    const ok = await confirm(
      name === 'post'
        ? { title: `Post ${j.number}?`, message: 'Posted journals affect the ledger and cannot be edited.', confirmText: 'Post' }
        : { title: `Void ${j.number}?`, message: 'The journal will no longer affect the ledger.', confirmText: 'Void', danger: true },
    );
    if (!ok) return;
    setBusy(name);
    try {
      await api.post(`/journals/${j.id}/${name}`);
      toast.success(name === 'post' ? 'Journal posted' : 'Journal voided');
      qc.invalidateQueries({ queryKey: ['journals'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Journal {j.number} <StatusBadge status={j.status} />
          </span>
        }
        subtitle={j.description ?? undefined}
        back={() => navigate('/accounting/journals')}
        actions={
          <>
            {j.status === 'DRAFT' && can('accounting.journal.post') && (
              <Button icon="check-circle-2" loading={busy === 'post'} onClick={() => act('post')}>
                Post
              </Button>
            )}
            {j.status !== 'VOID' && j.sourceType === 'MANUAL' && can('accounting.journal.void') && (
              <Button variant="danger" icon="ban" loading={busy === 'void'} onClick={() => act('void')}>
                Void
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Date</dt>
              <dd className="font-medium">{fmtDate(j.date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Source</dt>
              <dd>
                <Badge tone={j.sourceType === 'MANUAL' ? 'violet' : 'blue'}>{SOURCE_LABELS[j.sourceType ?? ''] ?? j.sourceType}</Badge>
                {link && (
                  <Link to={link} className="ml-2 text-brand-700 hover:underline">
                    Open source
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reference</dt>
              <dd className="font-medium">{j.reference || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Posted at</dt>
              <dd className="font-medium">{fmtDateTime(j.postedAt) || '—'}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Lines" className="lg:col-span-2" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60">
                  <th className="px-3 py-2">Account</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {j.lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-slate-500">{l.account.code}</span> {l.account.name}
                      <div className="text-xs text-slate-400 sm:hidden">{l.description}</div>
                    </td>
                    <td className="hidden px-3 py-2 text-slate-500 sm:table-cell">{l.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) ? fmtMoney(l.debit) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) ? fmtMoney(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(j.totalDebit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(j.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
