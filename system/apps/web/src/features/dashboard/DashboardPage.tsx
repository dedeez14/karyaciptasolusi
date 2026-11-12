import { lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber, getLocale } from '@/lib/format';
import { useSession } from '@/stores/session';
import { Button, Card, EmptyState, Icon, Tabs } from '@/components/ui';
import { Floating } from '@/components/ui/Floating';
import { cn } from '@/components/ui/primitives';

import { PersonalWidgets } from './PersonalWidgets';
import { UpcomingObligations } from '@/features/director/UpcomingObligations';
import { ActivityCard, AgingCard, AttentionCard, CashCard, KpiSkeleton, KpiTile, LowStockCard, PipelineCard, RankCard, RecentInvoicesCard, TeamCard, type Overview } from './widgets';

const TrendChart = lazy(() => import('./TrendChart'));

const QUICK = [
  { label: 'Quotation', icon: 'file-text', to: '/documents/SQ/new', perm: 'sales.quotation.create' },
  { label: 'Invoice', icon: 'receipt', to: '/documents/SI/new', perm: 'sales.invoice.create' },
  { label: 'Receive payment', icon: 'hand-coins', to: '/payments/in/new', perm: 'sales.payment.create' },
  { label: 'Purchase order', icon: 'clipboard-check', to: '/documents/PO/new', perm: 'purchase.order.create' },
  { label: 'Pay supplier', icon: 'banknote', to: '/payments/out/new', perm: 'purchase.payment.create' },
  { label: 'Lead', icon: 'user-plus', to: '/r/leads', perm: 'crm.lead.create' },
  { label: 'Expense claim', icon: 'wallet', to: '/expenses/new', perm: 'hris.expense.create' },
  { label: 'Document', icon: 'file-signature', to: '/document-center', perm: 'hris.letter.create' },
];

/** dashboard sections a user can hide (kept per browser) */
const SECTIONS = [
  { id: 'kpi', label: 'Key figures' },
  { id: 'trend', label: 'Sales vs purchases' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'aging', label: 'Receivables & payables aging' },
  { id: 'cash', label: 'Cash position' },
  { id: 'pipeline', label: 'Sales pipeline' },
  { id: 'top', label: 'Top customers & products' },
  { id: 'personal', label: 'My attendance & tasks' },
  { id: 'team', label: 'Team today' },
  { id: 'stock', label: 'Low stock' },
  { id: 'obligations', label: 'Due soon' },
  { id: 'recent', label: 'Recent invoices' },
  { id: 'activity', label: 'Recent activity' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];
const STORE = 'kcs.dashboard.hidden';

function useHidden() {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(STORE, JSON.stringify([...n]));
      } catch {
        /* private mode: keep it for this visit only */
      }
      return n;
    });
  const reset = () => {
    setHidden(new Set());
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
  };
  return { hidden, toggle, reset };
}

function Customize({ hidden, toggle, reset }: ReturnType<typeof useHidden>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={ref} variant="outline" size="sm" icon="sliders-horizontal" onClick={() => setOpen((o) => !o)} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" aria-expanded={open}>
        <span className="hidden sm:inline">Customize</span>
      </Button>
      <Floating anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth={false} width={260} align="right" className="p-2">
        <p className="px-2 pt-1 pb-2 text-xs font-semibold text-slate-500 uppercase">Show on dashboard</p>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hidden.has(s.id)} onChange={() => toggle(s.id)} />
                {s.label}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-line px-2 pt-2 pb-1">
          <button type="button" onClick={reset} className="text-xs font-medium text-brand-700 hover:underline">
            Show everything
          </button>
        </div>
      </Floating>
    </>
  );
}

function TrendCard({ data }: { data: NonNullable<Overview['monthly']> }) {
  const [range, setRange] = useState<'6' | '12'>('12');
  const rows = data.slice(-Number(range));
  const sales = rows.reduce((a, r) => a + r.sales, 0);
  const purchases = rows.reduce((a, r) => a + r.purchases, 0);
  return (
    <Card title="Sales vs purchases" subtitle="Confirmed invoices and supplier bills per month" actions={<Tabs value={range} onChange={setRange} tabs={[{ value: '6', label: '6 mo' }, { value: '12', label: '12 mo' }]} />} className="lg:col-span-2" bodyClass="pt-3">
      <div className="mb-2 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">Sales</p>
          <p className="font-semibold tabular-nums">{fmtMoney(sales, 0)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Purchases</p>
          <p className="font-semibold tabular-nums">{fmtMoney(purchases, 0)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Difference</p>
          <p className={cn('font-semibold tabular-nums', sales - purchases < 0 ? 'text-red-600' : 'text-emerald-700')}>{fmtMoney(sales - purchases, 0)}</p>
        </div>
      </div>
      <Suspense fallback={<div className="h-64" />}>
        <TrendChart data={rows} />
      </Suspense>
    </Card>
  );
}

const Row = ({ children, className }: { children: ReactNode[]; className: string }) => {
  const items = children.filter(Boolean);
  return items.length ? <div className={cn('grid grid-cols-1 gap-4', className)}>{items}</div> : null;
};

export default function DashboardPage() {
  const { me, can } = useSession();
  const q = useQuery({ queryKey: ['dashboard', me?.company.id], queryFn: () => api.get<Overview>('/dashboard'), refetchInterval: 120_000 });
  const custom = useHidden();
  const show = (id: SectionId) => !custom.hidden.has(id);
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Good morning' : hour < 15 ? 'Good afternoon' : hour < 19 ? 'Good evening' : 'Good night';
  const quick = QUICK.filter((a) => can(a.perm));
  const d = q.data;
  const currency = me?.company.currencyCode ?? 'IDR';
  const updated = d?.generatedAt ? new Date(d.generatedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-brand-700 px-5 py-5 text-white shadow-card sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-brand-100">{new Date().toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <h1 className="mt-0.5 truncate text-xl font-semibold text-white sm:text-2xl">
              {greet}, {me?.user.fullName.split(' ')[0]}
            </h1>
            <p className="mt-0.5 text-sm text-brand-100">Overview of {me?.company.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {updated && <span className="hidden text-xs text-brand-100 md:inline">Updated {updated}</span>}
            <Customize {...custom} />
            <Button variant="outline" size="sm" icon="refresh-cw" onClick={() => q.refetch()} loading={q.isFetching} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" aria-label="Refresh">
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
        {quick.length > 0 && (
          <div className="scrollbar-thin -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            <span className="flex shrink-0 items-center pr-1 text-xs font-medium text-brand-100">
              <Icon name="plus" className="mr-1 h-3.5 w-3.5" />
              New
            </span>
            {quick.map((a) => (
              <Link key={a.to + a.label} to={a.to} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white ring-1 ring-white/20 transition hover:bg-white hover:text-brand-700">
                <Icon name={a.icon} className="h-4 w-4 shrink-0" />
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      {show('kpi') &&
        (q.isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
        ) : d?.kpi.length ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-5">
            {d.kpi.map((k) => (
              <KpiTile key={k.key} k={k} currency={currency} />
            ))}
          </div>
        ) : null)}

      {d && (
        <>
          <Row className="lg:grid-cols-3">
            {[show('trend') && d.monthly && <TrendCard key="trend" data={d.monthly} />, show('attention') && <AttentionCard key="att" items={d.attention ?? []} currency={currency} />]}
          </Row>

          <Row className="md:grid-cols-2 xl:grid-cols-3">
            {[
              show('aging') && d.arAging && <AgingCard key="ar" title="Receivables aging" data={d.arAging} link="/reports/ar-aging" currency={currency} empty="No unpaid customer invoices" />,
              show('aging') && d.apAging && <AgingCard key="ap" title="Payables aging" data={d.apAging} link="/reports/ap-aging" currency={currency} empty="No unpaid supplier bills" />,
              show('cash') && d.cashAccounts && <CashCard key="cash" accounts={d.cashAccounts} />,
            ]}
          </Row>

          <Row className="md:grid-cols-2 xl:grid-cols-3">
            {[
              show('pipeline') && d.pipeline && <PipelineCard key="pipe" stages={d.pipeline} currency={currency} />,
              show('top') && d.topCustomers && (
                <RankCard key="cust" title="Top customers" subtitle="Last 12 months" link="/reports/sales-by-customer" icon="users" empty="No sales yet" rows={d.topCustomers.map((c, i) => ({ key: c.id ?? String(i), name: c.name, sub: `${c.count} ${c.count === 1 ? 'invoice' : 'invoices'}`, value: c.value, to: c.id ? `/customers/${c.id}` : undefined }))} />
              ),
              show('top') && d.topProducts && (
                <RankCard key="prod" title="Top products & services" subtitle="Last 12 months, before tax" link="/reports/sales-by-product" icon="package" empty="No product sales yet" rows={d.topProducts.map((p) => ({ key: p.id, name: p.name, sub: `${fmtNumber(p.qty)} sold`, value: p.value, to: `/products/${p.id}` }))} />
              ),
            ]}
          </Row>
        </>
      )}

      {show('personal') && <PersonalWidgets />}

      {d && (
        <Row className="lg:grid-cols-2">
          {[show('team') && d.team && <TeamCard key="team" team={d.team} />, show('stock') && d.lowStock && <LowStockCard key="stock" rows={d.lowStock} />]}
        </Row>
      )}

      {show('obligations') && <UpcomingObligations />}

      {d && (
        <Row className="xl:grid-cols-3">
          {[
            show('recent') && d.recentInvoices && (
              <div key="inv" className={d.activity && show('activity') ? 'xl:col-span-2' : 'xl:col-span-3'}>
                <RecentInvoicesCard rows={d.recentInvoices} />
              </div>
            ),
            show('activity') && d.activity && <ActivityCard key="act" rows={d.activity} />,
          ]}
        </Row>
      )}

      {d && !d.kpi.length && !d.attention.length && <EmptyState icon="layout-dashboard" title="Welcome" description="Your dashboard widgets appear here based on your access rights." />}
      {q.isError && (
        <Card>
          <p className="text-sm text-red-600">The dashboard could not be loaded. Check your connection and press Refresh.</p>
        </Card>
      )}
    </div>
  );
}
