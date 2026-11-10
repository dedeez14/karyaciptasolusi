import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, Dropdown, EmptyState, Icon, PageHeader, previewFile, Spinner, StatusBadge, toast } from '@/components/ui';
import { useLookups } from '@/features/resources/FieldInput';
import { CASH_ICON } from './CashFormDrawer';
import type { CashRow } from './CashListPage';

interface CashDetail extends CashRow {
  createdAt: string;
  journal: { id: string; number: string; status: string } | null;
}

export default function CashViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const types = useLookups(['CASH_TYPE']).CASH_TYPE ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['cash', 'one', id], queryFn: () => api.get<CashDetail>(`/cash/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Transaction not found" description={(q.error as Error)?.message} />;
  const t = q.data;
  const type = types.find((x) => x.value === t.type);
  const path = `/cash/${t.id}/pdf`;

  const run = async (name: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(name);
    try {
      await fn();
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel ${t.number}?`, message: 'The journal entry will be voided. This cannot be undone.', confirmText: 'Cancel transaction', danger: true }))) return;
    await run('cancel', () => api.post(`/cash/${t.id}/cancel`), `${t.number} cancelled`);
    qc.invalidateQueries({ queryKey: ['cash'] });
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.number}
            <StatusBadge status={t.status} label={t.status === 'CONFIRMED' ? 'Posted' : undefined} />
          </span>
        }
        subtitle={type?.label ?? t.type}
        back={() => navigate('/accounting/cash')}
        actions={
          <>
            <Button variant="outline" icon="eye" loading={busy === 'preview'} onClick={() => run('preview', () => previewFile({ path, title: t.number }))}>
              Preview
            </Button>
            <Dropdown
              trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
              items={[
                { label: 'Download PDF', icon: 'download', onClick: () => run('dl', () => download(path)) },
                { label: 'Save PDF to File Manager', icon: 'folder-input', onClick: () => run('save', () => download(path, { save: 1 }), 'PDF saved to File Manager') },
                'divider',
                { label: 'Cancel transaction', icon: 'ban', danger: true, onClick: cancel, hidden: !can('accounting.cash.cancel') || t.status === 'CANCELLED' },
              ]}
            />
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Item label="Type">
              <Badge color={type?.color}>
                <Icon name={CASH_ICON[t.type]} className="h-3 w-3" />
                {type?.label ?? t.type}
              </Badge>
            </Item>
            <Item label="Date">{fmtDate(t.date)}</Item>
            <Item label={t.type === 'RECEIPT' ? 'Deposited to' : t.type === 'PAYMENT' ? 'Paid from' : 'From account'}>{t.bankAccountName}</Item>
            {t.type === 'TRANSFER' ? <Item label="To account">{t.toBankAccountName}</Item> : <Item label={t.type === 'RECEIPT' ? 'Income account' : 'Expense account'}>{t.accountName}</Item>}
            {t.partyName && <Item label={t.type === 'RECEIPT' ? 'Received from' : 'Paid to'}>{t.partyName}</Item>}
            <Item label="Reference">{t.reference}</Item>
            <div className="sm:col-span-2">
              <Item label="Description">{t.description}</Item>
            </div>
            <Item label="Recorded">{fmtDateTime(t.createdAt)}</Item>
          </dl>
        </Card>
        <div className="space-y-5">
          <div className={`rounded-2xl bg-gradient-to-br p-5 text-white shadow-pop ${t.type === 'RECEIPT' ? 'from-emerald-500 to-emerald-600' : t.type === 'PAYMENT' ? 'from-rose-500 to-rose-600' : 'from-brand-500 to-brand-700'}`}>
            <p className="text-sm text-white/80">Amount</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtMoney(t.amount)}</p>
          </div>
          <Card title="Journal">
            {t.journal ? (
              <Link to={`/accounting/journals/${t.journal.id}`} className="flex items-center justify-between text-sm">
                <span className="font-medium text-brand-700 hover:underline">{t.journal.number}</span>
                <StatusBadge status={t.journal.status} />
              </Link>
            ) : (
              <p className="text-sm text-slate-400">No journal entry.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
