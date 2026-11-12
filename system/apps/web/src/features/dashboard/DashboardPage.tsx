import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, getLocale } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Button, Card, EmptyState, Icon, Spinner, StatCard, StatusBadge, type Tone } from '@/components/ui';

import { PersonalWidgets } from './PersonalWidgets';

const TrendChart = lazy(() => import('./TrendChart'));

interface Overview {
  kpi: { key: string; label: string; value: number; type: 'money' | 'number'; hint?: string }[];
  monthly?: { month: string; sales: number; purchases: number }[];
  topCustomers?: { name: string; value: number }[];
  recentInvoices?: { id: string; number: string; date: string; grandTotal: string; paidAmount: string; status: string }[];
  generatedAt: string;
}

const KPI_STYLE: Record<string, { icon: string; tone: Tone }> = {
  salesMonth: { icon: 'trending-up', tone: 'blue' },
  receivable: { icon: 'hand-coins', tone: 'amber' },
  purchaseMonth: { icon: 'shopping-bag', tone: 'violet' },
  payable: { icon: 'banknote', tone: 'red' },
  cash: { icon: 'landmark', tone: 'green' },
  openLeads: { icon: 'user-plus', tone: 'blue' },
  pipeline: { icon: 'target', tone: 'violet' },
  employees: { icon: 'id-card', tone: 'gray' },
  lowStock: { icon: 'alert-triangle', tone: 'amber' },
};

const QUICK = [
  { label: 'New quotation', icon: 'file-text', to: '/documents/SQ/new', perm: 'sales.quotation.create' },
  { label: 'New invoice', icon: 'receipt', to: '/documents/SI/new', perm: 'sales.invoice.create' },
  { label: 'Receive payment', icon: 'hand-coins', to: '/payments/in/new', perm: 'sales.payment.create' },
  { label: 'New purchase order', icon: 'clipboard-check', to: '/documents/PO/new', perm: 'purchase.order.create' },
  { label: 'New lead', icon: 'user-plus', to: '/r/leads', perm: 'crm.lead.create' },
  { label: 'Upload files', icon: 'upload', to: '/files', perm: 'files.file.upload' },
];

export default function DashboardPage() {
  const { me, can } = useSession();
  const q = useQuery({ queryKey: ['dashboard', me?.company.id], queryFn: () => api.get<Overview>('/dashboard'), refetchInterval: 120_000 });
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Good night';
  const quick = QUICK.filter((a) => can(a.perm));

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-brand-600 p-6 text-white shadow-pop sm:p-8">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-brand-100">{new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
              {greet}, {me?.user.fullName.split(' ')[0]} 👋
            </h1>
            <p className="mt-1 text-sm text-brand-100">Here is what is happening at {me?.company.name} today.</p>
          </div>
          <Button variant="outline" size="sm" icon="refresh-cw" onClick={() => q.refetch()} loading={q.isFetching} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            Refresh
          </Button>
        </div>
        {quick.length > 0 && (
          <div className="relative mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {quick.map((a) => (
              <Link key={a.to + a.label} to={a.to} className="flex min-w-0 items-center gap-2 rounded-lg bg-white/15 px-3 py-2.5 text-[13px] font-medium text-white ring-1 ring-white/20 transition hover:bg-white hover:text-brand-700 sm:py-2">
                <Icon name={a.icon} className="h-4 w-4 shrink-0" />
                <span className="leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <PersonalWidgets />

      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-brand-700" />
        </div>
      ) : !q.data?.kpi.length ? (
        <EmptyState icon="layout-dashboard" title="Welcome" description="Your dashboard widgets appear here based on your access rights." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.kpi.map((k) => (
              <StatCard
                key={k.key}
                label={k.label}
                value={k.type === 'money' ? `${me?.company.currencyCode} ${fmtCompact(k.value)}` : fmtNumber(k.value)}
                hint={k.hint ?? (k.type === 'money' ? fmtMoney(k.value, 0) : undefined)}
                icon={KPI_STYLE[k.key]?.icon}
                tone={KPI_STYLE[k.key]?.tone}
              />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {q.data.monthly && (
              <Card title="Sales vs purchases (12 months)" className="xl:col-span-2">
                <Suspense fallback={<div className="h-72" />}>
                  <TrendChart data={q.data.monthly} />
                </Suspense>
              </Card>
            )}
            {q.data.topCustomers && (
              <Card title="Top customers (12 months)">
                {q.data.topCustomers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">No sales yet</p>
                ) : (
                  <ul className="space-y-3">
                    {q.data.topCustomers.map((c, i) => {
                      const max = q.data!.topCustomers![0].value || 1;
                      return (
                        <li key={c.name + i}>
                          <div className="flex justify-between text-sm">
                            <span className="truncate pr-2">{c.name}</span>
                            <span className="font-medium tabular-nums">{fmtCompact(c.value)}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(c.value / max) * 100}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}
          </div>
          {q.data.recentInvoices && (
            <Card
              title="Recent invoices"
              actions={
                <Link to="/documents/SI" className="text-xs font-medium text-brand-700 hover:underline">
                  View all
                </Link>
              }
              bodyClass="p-0"
            >
              {q.data.recentInvoices.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No invoices yet</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {q.data.recentInvoices.map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/documents/SI/${inv.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{inv.number}</p>
                          <p className="text-xs text-slate-400">{fmtDate(inv.date)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm tabular-nums">{fmtMoney(inv.grandTotal)}</span>
                          <StatusBadge status={inv.status} label={inv.status === 'COMPLETED' ? 'Paid' : undefined} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
