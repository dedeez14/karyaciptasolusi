import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { download } from '@/lib/download';
import { previewFile } from '@/components/ui/preview';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Button, Card, confirm, DataTable, EmptyState, PageHeader, Spinner, StatusBadge, toast } from '@/components/ui';
import { dirMeta, type PaymentDetail } from './common';

export default function PaymentViewPage() {
  const { direction = 'in', id = '' } = useParams();
  const m = dirMeta(direction);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['payments', m.dir, 'one', id], queryFn: () => api.get<PaymentDetail>(`/payments/${m.dir}/${id}`) });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-700" />
      </div>
    );
  if (q.error || !q.data) return <EmptyState icon="file-x" title="Payment not found" description={(q.error as Error)?.message} />;
  const p = q.data;
  const allocated = p.allocations.reduce((a, x) => a + Number(x.amount), 0);

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
    if (!(await confirm({ title: `Cancel ${p.number}?`, message: 'The journal entry will be voided and the invoices will become unpaid again.', confirmText: 'Cancel payment', danger: true }))) return;
    await run(
      'cancel',
      async () => {
        await api.post(`/payments/${m.dir}/${p.id}/cancel`);
        qc.invalidateQueries({ queryKey: ['payments'] });
        qc.invalidateQueries({ queryKey: ['documents'] });
      },
      'Payment cancelled',
    );
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {m.singular} {p.number} <StatusBadge status={p.status} />
          </span>
        }
        subtitle={p.partnerName ?? undefined}
        back={() => navigate(`/payments/${m.dir}`)}
        actions={
          <>
            <Button variant="outline" icon="eye" loading={busy === 'preview'} onClick={() => run('preview', () => previewFile({ path: `/payments/${m.dir}/${p.id}/pdf`, title: p.number }))}>
              Preview
            </Button>
            <Button variant="outline" icon="download" loading={busy === 'pdf'} onClick={() => run('pdf', () => download(`/payments/${m.dir}/${p.id}/pdf`))}>
              PDF
            </Button>
            <Button variant="outline" icon="folder-input" loading={busy === 'save'} onClick={() => run('save', () => download(`/payments/${m.dir}/${p.id}/pdf`, { save: 1 }), 'Saved to File Manager')}>
              Save to files
            </Button>
            {p.status !== 'CANCELLED' && can(`${m.perm}.cancel`) && (
              <Button variant="danger" icon="ban" loading={busy === 'cancel'} onClick={cancel}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details">
          <dl className="grid gap-3 text-sm">
            {[
              [m.partner, p.partnerName],
              ['Date', fmtDate(p.date)],
              [m.dir === 'in' ? 'Deposited to' : 'Paid from', p.bankAccountName],
              ['Reference', p.reference],
              ['Notes', p.notes],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="font-medium whitespace-pre-line">{v || <span className="text-slate-300">—</span>}</dd>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="text-xl font-semibold tabular-nums">{fmtMoney(p.amount)}</dd>
              {Number(p.amount) - allocated > 0.005 && <dd className="text-xs text-amber-700">Unapplied: {fmtMoney(Number(p.amount) - allocated)}</dd>}
            </div>
          </dl>
        </Card>
        <Card title="Applied to invoices" className="lg:col-span-2" bodyClass="p-0">
          <DataTable
            rows={p.allocations}
            rowKey={(a) => a.id}
            columns={[
              {
                key: 'doc',
                header: 'Invoice',
                render: (a) => (
                  <Link className="font-medium text-brand-700 hover:underline" to={`/documents/${a.document.docType}/${a.document.id}`}>
                    {a.document.number}
                  </Link>
                ),
              },
              { key: 'date', header: 'Date', render: (a) => fmtDate(a.document.date) },
              { key: 'total', header: 'Invoice total', align: 'right', render: (a) => fmtMoney(a.document.grandTotal) },
              { key: 'amount', header: 'Applied', align: 'right', render: (a) => <b>{fmtMoney(a.amount)}</b> },
            ]}
            empty={<EmptyState icon="receipt" title="Not applied to any invoice" description="This payment is an advance." />}
          />
        </Card>
      </div>
    </div>
  );
}
