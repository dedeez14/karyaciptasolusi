import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, confirm, DataTable, Dropdown, EmptyState, Icon, PageHeader, Spinner, StatusBadge, toast, type Column } from '@/components/ui';
import { runMessage, StateBadge, useIntervalText, type RunResult, type SubscriptionDetail } from './common';

type Invoice = SubscriptionDetail['invoices'][number];

export default function SubscriptionViewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const interval = useIntervalText();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['billing', 'subscription', id],
    queryFn: () => api.get<SubscriptionDetail>(`/billing/subscriptions/${id}`),
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  if (!q.data) return <EmptyState icon="file-x" title="Subscription not found" description={(q.error as Error)?.message} />;
  const s = q.data;

  const act = async (name: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(name);
    try {
      await fn();
      if (msg) toast.success(msg);
      qc.invalidateQueries({ queryKey: ['billing'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    const early = s.state !== 'DUE';
    if (
      !(await confirm({
        title: `Create the next invoice for ${s.code}?`,
        message: early ? `The period starting ${fmtDate(s.nextRunDate)} is billed now, before its scheduled date.` : `The period starting ${fmtDate(s.nextRunDate)} is billed.`,
        confirmText: 'Create invoice',
      }))
    )
      return;
    await act('run', async () => {
      const r = await api.post<RunResult>(`/billing/subscriptions/${s.id}/run`);
      if (r.warning) toast.info(runMessage(r));
      else toast.success(runMessage(r));
      qc.invalidateQueries({ queryKey: ['documents'] });
    });
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: `Delete ${s.code}?`,
        message: 'No more invoices will be generated. Invoices already created are kept.',
        confirmText: 'Delete',
        danger: true,
      }))
    )
      return;
    await act('delete', () => api.delete(`/billing/subscriptions/${s.id}`), `${s.code} deleted`);
    navigate('/billing/subscriptions');
  };

  const invoiceCols: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      render: (r) => <span className="font-medium text-brand-700">{r.number}</span>,
    },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) },
    { key: 'dueDate', header: 'Due', render: (r) => fmtDate(r.dueDate) },
    {
      key: 'grandTotal',
      header: 'Total',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtMoney(r.grandTotal)}</span>,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtMoney(Number(r.grandTotal) - Number(r.paidAmount))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.code}
            <StateBadge state={s.state} />
          </span>
        }
        subtitle={s.name}
        back={() => navigate('/billing/subscriptions')}
        actions={
          <>
            {can('sales.subscription.run') && s.isActive && s.state !== 'ENDED' && (
              <Button icon="play" loading={busy === 'run'} onClick={runNow}>
                Create next invoice
              </Button>
            )}
            {can('sales.subscription.update') && (
              <Button variant="outline" icon="pencil" onClick={() => navigate(`/billing/subscriptions/${s.id}/edit`)}>
                Edit
              </Button>
            )}
            <Dropdown
              trigger={<Button variant="outline" icon="more-horizontal" aria-label="More actions" />}
              items={[
                {
                  label: 'Pause',
                  icon: 'pause',
                  hidden: !can('sales.subscription.update') || !s.isActive,
                  onClick: () => act('pause', () => api.post(`/billing/subscriptions/${s.id}/pause`), `${s.code} paused`),
                },
                {
                  label: 'Resume',
                  icon: 'play',
                  hidden: !can('sales.subscription.update') || s.isActive,
                  onClick: () => act('resume', () => api.post(`/billing/subscriptions/${s.id}/resume`), `${s.code} resumed`),
                },
                'divider',
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  danger: true,
                  hidden: !can('sales.subscription.delete'),
                  onClick: remove,
                },
              ]}
            />
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Contract">
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Item label="Customer">
                <Link to={`/r/customers?search=${encodeURIComponent(s.customerName ?? '')}`} className="text-brand-700 hover:underline">
                  {s.customerName}
                </Link>
              </Item>
              <Item label="Interval">{interval(s.intervalCode, s.intervalCount)}</Item>
              <Item label="Start date">{fmtDate(s.startDate)}</Item>
              <Item label="End date">{s.endDate ? fmtDate(s.endDate) : 'Until cancelled'}</Item>
              <Item label="Payment term">{s.paymentTermName}</Item>
              <Item label="Project">{s.projectName}</Item>
              <Item label="Automation">
                <span className="flex flex-wrap gap-1">
                  <Badge tone={s.autoConfirm ? 'blue' : 'gray'}>{s.autoConfirm ? 'Auto confirm' : 'Left as draft'}</Badge>
                  {s.autoEmail && <Badge tone="violet">{`E-mail to ${s.emailTo || s.customerEmail || '(no address)'}`}</Badge>}
                </span>
              </Item>
              <Item label="Last run">{s.lastRunAt ? fmtDateTime(s.lastRunAt) : 'Never'}</Item>
              {s.notes && (
                <div className="sm:col-span-2">
                  <Item label="Notes">
                    <span className="whitespace-pre-line">{s.notes}</span>
                  </Item>
                </div>
              )}
            </dl>
          </Card>
          <Card title="Lines" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Price</th>
                    <th className="px-4 py-2 text-right">Disc</th>
                    <th className="px-4 py-2">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{l.description || l.product?.name}</span>
                        {l.product && <span className="block text-xs text-slate-500">{l.product.code}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                        {fmtNumber(l.qty)} {l.uomCode}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(l.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{Number(l.discountPct) ? `${fmtNumber(l.discountPct)}%` : '—'}</td>
                      <td className="px-4 py-2.5">{l.taxName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Generated invoices" subtitle="Invoices that reference this subscription" bodyClass="p-0">
            <DataTable
              columns={invoiceCols}
              rows={s.invoices}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/documents/SI/${r.id}`)}
              empty={<EmptyState icon="receipt" title="No invoices yet" description="The first invoice is created on the next invoice date." />}
            />
          </Card>
        </div>
        <div className="space-y-5">
          <div className="rounded-2xl bg-brand-600 p-5 text-white shadow-pop">
            <p className="text-sm text-white/80">Per invoice</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {s.currencyCode} {fmtMoney(s.amounts.total)}
            </p>
            <p className="mt-2 text-xs text-white/80">
              {fmtMoney(s.amounts.net)} + tax {fmtMoney(s.amounts.tax)}
            </p>
          </div>
          <Card title="Upcoming invoices">
            {s.upcoming.length && s.isActive ? (
              <ol className="space-y-2 text-sm">
                {s.upcoming.map((d, i) => (
                  <li key={d} className="flex items-center gap-3">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${i === 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className={i === 0 ? 'font-medium' : 'text-slate-600'}>{fmtDate(d)}</span>
                    {i === 0 && s.state === 'DUE' && <Badge tone="amber">Due</Badge>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Icon name="circle-pause" className="h-4 w-4" />
                {s.isActive ? 'The contract has ended.' : 'Paused - no invoices are generated.'}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{children || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}
