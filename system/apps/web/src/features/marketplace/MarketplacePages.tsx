import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Paged } from '@/lib/api';
import { fmtCompact, fmtDate, fmtDateTime, fmtMoney, fmtNumber, isoDate } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, confirm, DatePicker, EmptyState, Field, Input, Modal, NumberInput, PageHeader, Select, Spinner, Textarea, toast } from '@/components/ui';
import { Checkbox, StatCard, Tabs, type Tone } from '@/components/ui/primitives';

// ============================================================ shared
const errorsOf = (e: unknown) => (e as { errors?: Record<string, string> })?.errors ?? {};
const Loading = () => (
  <div className="flex justify-center py-10">
    <Spinner />
  </div>
);
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const optNum = (v: string) => (v === '' ? null : Number(v));
const money = (v: number | null | undefined, ccy: string) => (v === null || v === undefined ? '—' : ccy === 'IDR' ? fmtMoney(v, 0) : `${ccy} ${fmtMoney(v, 2)}`);
const yesterday = () => isoDate(new Date(Date.now() - 86_400_000));

export const CHANNEL_LABEL: Record<string, string> = {
  GUMROAD: 'Gumroad',
  ETSY: 'Etsy',
  SHOPEE: 'Shopee',
  TOKOPEDIA: 'Tokopedia',
  TIKTOK: 'TikTok Shop',
  LAZADA: 'Lazada',
  WEBSITE: 'Own website',
  FACEBOOK: 'Facebook Page',
  INSTAGRAM: 'Instagram',
  PINTEREST: 'Pinterest',
  OTHER: 'Other',
};
const CHANNEL_TONE: Record<string, Tone> = { GUMROAD: 'violet', ETSY: 'amber', SHOPEE: 'red', TOKOPEDIA: 'green', FACEBOOK: 'blue', PINTEREST: 'red', INSTAGRAM: 'violet' };
const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PARTIAL: { label: 'Part refunded', tone: 'amber' },
  REFUNDED: { label: 'Refunded', tone: 'red' },
};

function ChannelBadge({ channel }: { channel: string }) {
  return <Badge tone={CHANNEL_TONE[channel] ?? 'gray'}>{CHANNEL_LABEL[channel] ?? channel}</Badge>;
}

interface Store {
  id: string;
  code: string;
  name: string;
  channel: string;
  kind: 'STORE' | 'SOCIAL';
  url: string | null;
  currencyCode: string;
  customerId: string | null;
  balanceBankAccountId: string | null;
  payoutBankAccountId: string | null;
  taxId: string | null;
  whtTaxId: string | null;
  defaultProductId: string | null;
  syncFrom: string | null;
  lastSyncAt: string | null;
  isActive: boolean;
  notes: string | null;
  hasToken: boolean;
  autoSync: boolean;
  autoSettle: boolean;
  autoHour: number;
  lastAutoRunAt: string | null;
  lastAutoResult: string | null;
  listings: number;
  unmapped: number;
  unposted: number;
  issues: string[];
}
interface Options {
  banks: { id: string; code: string; name: string; currencyCode: string; isCash: boolean }[];
  taxes: { id: string; code: string; name: string; kind: string; rate: number }[];
  channels: string[];
}
interface Metric {
  value: number | null;
  change: number | null;
}
interface Overview {
  days: number;
  from: string;
  to: string;
  rates: Record<string, number>;
  missingRates: string[];
  totals: { revenueBase: number; orders: number; prevOrders: number; unposted: number; pendingPayouts: number; followers: number };
  channels: {
    id: string;
    code: string;
    name: string;
    channel: string;
    kind: string;
    url: string | null;
    currencyCode: string;
    lastSyncAt: string | null;
    sales: { orders: number; revenue: number; revenueBase: number | null; fees: number; refunds: number; prevOrders: number; prevRevenue: number; unposted: number; unpostedGross: number; pendingPayouts: number; pendingPayoutAmount: number } | null;
    stats: { date: string; previousDate: string | null; rangeLabel: string | null; visits: Metric | null; views: Metric | null; followers: Metric | null; favorites: Metric | null; impressions: Metric | null; clicks: Metric | null; saves: Metric | null; orders: Metric | null; revenue: number | null } | null;
    issues: string[];
  }[];
  daily: { day: string; revenue: number; orders: number }[];
  top: { listingId: string | null; title: string; store: string; currencyCode: string; qty: number; amount: number }[];
}

const useStores = () => useQuery({ queryKey: ['marketplace', 'stores'], queryFn: () => api.get<Store[]>('/marketplace/stores') });
const useOptions = () => useQuery({ queryKey: ['marketplace', 'options'], queryFn: () => api.get<Options>('/marketplace/options'), staleTime: 60_000 });

function StoreSelect({ value, onChange, kind, all, label = 'Store' }: { value: string; onChange: (v: string) => void; kind?: 'STORE' | 'SOCIAL'; all?: boolean; label?: string }) {
  const stores = useStores();
  const list = (stores.data ?? []).filter((s) => !kind || s.kind === kind);
  return (
    <Select
      aria-label={label}
      value={value}
      placeholder={all ? 'All stores & channels' : undefined}
      onChange={(e) => onChange(e.target.value)}
      options={list.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}${s.isActive ? '' : ' (inactive)'}` }))}
    />
  );
}

function Change({ v, suffix = '' }: { v: number | null | undefined; suffix?: string }) {
  if (v === null || v === undefined || v === 0) return <span className="text-xs text-slate-400">±0</span>;
  return (
    <span className={`text-xs font-medium ${v > 0 ? 'text-green-600' : 'text-red-600'}`}>
      {v > 0 ? '+' : ''}
      {fmtNumber(v)}
      {suffix}
    </span>
  );
}

/** reads a file chosen by the user as text (CSV / JSON) */
function FileImport({ store, kind, onClose }: { store: Store; kind: 'ORDERS' | 'STATS'; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; messages: string[] } | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file');
      if (file.size > 1_900_000) throw new Error('The file is too large (max about 1.9 MB): export a shorter period');
      const content = await file.text();
      return api.post<{ created: number; updated: number; skipped: number; messages: string[] }>(`/marketplace/stores/${store.id}/import`, { kind, fileName: file.name, content });
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${r.created} new, ${r.updated} updated`);
      qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Import ${kind === 'ORDERS' ? 'orders' : 'statistics'} · ${store.name}`}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <Button icon="upload" loading={run.isPending} disabled={!file} onClick={() => run.mutate()}>
            Import
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {kind === 'ORDERS' ? (
          <p className="text-slate-600">
            CSV export of the orders: Etsy <em>Sold Orders</em> / <em>Sold Order Items</em>, Gumroad sales export, Shopee / Tokopedia order export, or your own file with the columns{' '}
            <code>order_id, date, item_title, qty, gross, fee, refunded, country</code>. Buyer names, e-mails and addresses in the file are not read. Orders already imported only get their refunds updated.
          </p>
        ) : (
          <p className="text-slate-600">
            JSON collected from the channel (for example <code>etsy.json</code>, <code>facebook.json</code>, <code>pinterest.json</code> of the daily dashboard refresh) or a CSV with <code>date</code> and any of{' '}
            <code>visits, views, followers, favorites, impressions, clicks, saves, orders, revenue</code>. One row per day; a day already recorded is updated.
          </p>
        )}
        <input type="file" accept={kind === 'ORDERS' ? '.csv,.txt,text/csv' : '.json,.csv,application/json,text/csv'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        {result && (
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium">
              {result.created} new · {result.updated} updated · {result.skipped} skipped
            </p>
            {!!result.messages.length && (
              <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-slate-600">
                {result.messages.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SyncButton({ store }: { store: Store | Overview['channels'][number] }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.post<{ listings: { created: number; updated: number }; orders: { created: number; updated: number; skipped: number }; payouts: number; messages: string[] }>(`/marketplace/stores/${store.id}/sync`),
    onSuccess: (r) => {
      toast.success(`${store.name}: ${r.orders.created} new orders, ${r.orders.updated} updated, ${r.listings.created} new listings, ${r.payouts} payouts`);
      if (r.messages.length) toast.error(r.messages.slice(0, 3).join(' · '));
      qc.invalidateQueries({ queryKey: ['marketplace'] });
    },
    onError: (e) => toast.error(e),
  });
  if (store.channel !== 'GUMROAD' || !can('marketplace.import')) return null;
  return (
    <Button size="sm" variant="secondary" icon="refresh-cw" loading={sync.isPending} onClick={() => sync.mutate()}>
      Sync
    </Button>
  );
}

// ============================================================ overview
export function OverviewPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const q = useQuery({ queryKey: ['marketplace', 'overview', days], queryFn: () => api.get<Overview>('/marketplace/overview', { days }) });
  const o = q.data;
  const selling = o?.channels.filter((c) => c.kind === 'STORE') ?? [];
  const social = o?.channels.filter((c) => c.kind === 'SOCIAL') ?? [];
  const issues = o?.channels.flatMap((c) => c.issues.map((i) => `${c.name}: ${i}`)) ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Channels Overview"
        subtitle="Sales, traffic and followers of every marketplace and social channel in one place"
        actions={<Tabs value={days} onChange={setDays} tabs={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      />
      {q.isLoading || !o ? (
        <Loading />
      ) : !o.channels.length ? (
        <EmptyState icon="store" title="No stores or channels yet" description="Add your marketplace stores and social channels first" action={<Link to="/marketplace/stores" className="text-sm font-medium text-brand">Set up stores</Link>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={`Revenue, ${o.days} days`} value={fmtMoney(o.totals.revenueBase, 0)} icon="banknote" tone="green" hint={o.missingRates.length ? `Without ${o.missingRates.join(', ')}: no exchange rate` : 'After refunds, in IDR at the latest rates'} />
            <StatCard label="Orders" value={fmtNumber(o.totals.orders)} icon="shopping-cart" tone="blue" hint={<Change v={o.totals.orders - o.totals.prevOrders} suffix=" vs the period before" />} />
            <StatCard label="Followers (all channels)" value={fmtNumber(o.totals.followers)} icon="users" tone="violet" />
            <StatCard label="To book" value={`${fmtNumber(o.totals.unposted)} orders`} icon="wallet" tone={o.totals.unposted ? 'amber' : 'gray'} hint={`${o.totals.pendingPayouts} payout(s) waiting`} />
          </div>
          <Card title={`Revenue per day (IDR) · ${fmtDate(o.from)} – ${fmtDate(o.to)}`}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={o.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis yAxisId="r" tickFormatter={(v) => fmtCompact(v)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                  <YAxis yAxisId="o" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip formatter={(v, name) => (name === 'Orders' ? fmtNumber(v) : fmtMoney(v, 0))} labelFormatter={(l) => fmtDate(l)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar yAxisId="r" dataKey="revenue" name="Revenue" fill="#1d4f7a" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="o" dataKey="orders" name="Orders" stroke="#f8b810" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          {!!selling.length && (
            <Card title="Stores" bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Store</th>
                      <th className="px-3 py-2 text-right">Orders</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">Fees</th>
                      <th className="px-3 py-2 text-right">Visits</th>
                      <th className="px-3 py-2 text-right">Favorites</th>
                      <th className="px-3 py-2 text-right">Followers</th>
                      <th className="px-3 py-2">To book</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selling.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2">
                          <div className="font-medium">{c.name}</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <ChannelBadge channel={c.channel} />
                            {c.lastSyncAt ? `synced ${fmtDateTime(c.lastSyncAt)}` : c.stats ? `stats of ${fmtDate(c.stats.date)}` : 'no statistics yet'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {fmtNumber(c.sales?.orders ?? 0)}
                          <div>
                            <Change v={(c.sales?.orders ?? 0) - (c.sales?.prevOrders ?? 0)} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {money(c.sales?.revenue ?? 0, c.currencyCode)}
                          {c.currencyCode !== 'IDR' && c.sales?.revenueBase !== null && <div className="text-xs text-slate-500">{fmtMoney(c.sales?.revenueBase ?? 0, 0)}</div>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">{money(c.sales?.fees ?? 0, c.currencyCode)}</td>
                        <td className="px-3 py-2 text-right">
                          {c.stats?.visits?.value ?? c.stats?.views?.value ?? '—'}
                          <div>{c.stats?.visits && <Change v={c.stats.visits.change} />}</div>
                        </td>
                        <td className="px-3 py-2 text-right">{c.stats?.favorites?.value ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          {c.stats?.followers?.value ?? '—'}
                          <div>{c.stats?.followers && <Change v={c.stats.followers.change} />}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {c.sales?.unposted ? <Link to={`/marketplace/settlements?store=${c.id}`} className="text-amber-700 hover:underline">{c.sales.unposted} orders</Link> : <span className="text-slate-400">nothing</span>}
                          {!!c.sales?.pendingPayouts && <div className="text-blue-700">{c.sales.pendingPayouts} payout(s)</div>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <SyncButton store={c} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {!!social.length && (
              <Card title="Social channels" subtitle="Latest snapshot and the change since the one before" bodyClass="p-0">
                <ul className="divide-y divide-line">
                  {social.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{c.name}</span>
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          <ChannelBadge channel={c.channel} />
                          {c.stats ? `${fmtDate(c.stats.date)}${c.stats.rangeLabel ? ` · ${c.stats.rangeLabel}` : ''}` : 'no statistics yet'}
                        </span>
                      </span>
                      {c.stats &&
                        ([
                          ['Followers', c.stats.followers],
                          ['Views', c.stats.views],
                          ['Impressions', c.stats.impressions],
                          ['Clicks', c.stats.clicks],
                          ['Saves', c.stats.saves],
                        ] as const)
                          .filter(([, m]) => m && m.value !== null)
                          .map(([label, m]) => (
                            <span key={label} className="text-right">
                              <span className="block text-xs text-slate-500">{label}</span>
                              <span className="font-medium">{fmtNumber(m!.value)}</span> <Change v={m!.change} />
                            </span>
                          ))}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title={`Best sellers, ${o.days} days`} bodyClass="p-0">
              {!o.top.length ? (
                <EmptyState icon="package" title="No sales in this period" />
              ) : (
                <ul className="divide-y divide-line">
                  {o.top.map((t, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-5 text-xs text-slate-400">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-xs text-slate-500">{t.store}</span>
                      <span className="w-14 text-right text-xs">{fmtNumber(t.qty)}×</span>
                      <span className="w-28 text-right font-medium">{money(t.amount, t.currencyCode)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          {!!issues.length && (
            <Card title="To fix before booking">
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                {issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
              <Link to="/marketplace/stores" className="mt-2 inline-block text-sm font-medium text-brand">
                Open Stores & Listings
              </Link>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================ orders
interface Order {
  id: string;
  externalId: string;
  orderDate: string;
  currencyCode: string;
  gross: number;
  fee: number;
  taxCollected: number;
  refunded: number;
  feeRefunded: number;
  refundBooked: number;
  net: number;
  status: string;
  country: string | null;
  source: string;
  settlementId: string | null;
  settlement: string | null;
  store: { code: string; name: string; channel: string };
  lines: { title: string; qty: number; amount: number; listingId: string | null }[];
}

export function OrdersPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const stores = useStores();
  const [storeId, setStoreId] = useState('');
  const [posted, setPosted] = useState<'all' | 'no' | 'yes'>('all');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refund, setRefund] = useState<Order | null>(null);
  const store = stores.data?.find((s) => s.id === storeId);
  const q = useQuery({
    queryKey: ['marketplace', 'orders', storeId, posted, status, from, to, search, page],
    queryFn: () => api.get<Paged<Order> & { totals: { currencyCode: string; orders: number; gross: number; fee: number; refunded: number }[] }>('/marketplace/orders', { storeId, posted: posted === 'all' ? '' : posted, status, from: from ?? '', to: to ?? '', search, page, pageSize: 50 }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/orders/${id}`),
    onSuccess: () => (toast.success('Order deleted'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const data = q.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Marketplace Orders"
        subtitle="Orders from the Gumroad API and from the exports of Etsy, Shopee, Tokopedia... Only the buyer country is kept, never names or e-mails."
        actions={
          store &&
          store.kind === 'STORE' &&
          can('marketplace.import') && (
            <div className="flex gap-2">
              <SyncButton store={store} />
              <Button variant="secondary" icon="upload" onClick={() => setImporting(true)}>
                Import file
              </Button>
              <Button icon="plus" onClick={() => setAdding(true)}>
                Add order
              </Button>
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <StoreSelect value={storeId} kind="STORE" all onChange={(v) => (setStoreId(v), setPage(1))} />
        </div>
        <Tabs value={posted} onChange={(v) => (setPosted(v), setPage(1))} tabs={[{ value: 'all', label: 'All' }, { value: 'no', label: 'To book' }, { value: 'yes', label: 'Booked' }]} />
        <div className="w-40">
          <Select value={status} placeholder="Any status" onChange={(e) => (setStatus(e.target.value), setPage(1))} options={Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        </div>
        <div className="w-40">
          <DatePicker value={from} placeholder="From" onChange={(v) => (setFrom(v), setPage(1))} />
        </div>
        <div className="w-40">
          <DatePicker value={to} placeholder="To" onChange={(v) => (setTo(v), setPage(1))} />
        </div>
        <div className="w-56">
          <Input placeholder="Order id or product" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>
      </div>
      {!storeId && can('marketplace.import') && <p className="text-xs text-slate-500">Choose a store to sync, import a file or add an order.</p>}
      {!!data?.totals.length && (
        <div className="flex flex-wrap gap-4 text-sm">
          {data.totals.map((t) => (
            <span key={t.currencyCode} className="rounded-lg bg-slate-50 px-3 py-2">
              <b>{fmtNumber(t.orders)}</b> orders · gross <b>{money(t.gross, t.currencyCode)}</b> · fees {money(t.fee, t.currencyCode)} · refunds {money(t.refunded, t.currencyCode)}
            </span>
          ))}
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <Loading />
        ) : !data?.data.length ? (
          <EmptyState icon="shopping-cart" title="No orders" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Order</th>
                  <th className="px-3 py-2">Items</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Fee</th>
                  <th className="px-3 py-2 text-right">Refunded</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Booked</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.data.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{o.externalId}</div>
                      <div className="text-xs text-slate-500">
                        {fmtDateTime(o.orderDate)} · {o.store.code}
                        {o.country ? ` · ${o.country}` : ''} · {o.source.toLowerCase()}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs">
                      {o.lines.map((l, i) => (
                        <div key={i} className={`truncate ${l.listingId ? '' : 'text-amber-700'}`} title={l.listingId ? l.title : 'Listing not known yet'}>
                          {l.qty !== 1 ? `${fmtNumber(l.qty)}× ` : ''}
                          {l.title}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right">{money(o.gross, o.currencyCode)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{money(o.fee - o.feeRefunded, o.currencyCode)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{o.refunded ? money(o.refunded, o.currencyCode) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{money(o.net, o.currencyCode)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={ORDER_STATUS[o.status]?.tone ?? 'gray'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{o.settlement ?? <span className="text-amber-700">to book</span>}{o.settlement && o.refunded > o.refundBooked ? <div className="text-amber-700">refund to book</div> : null}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {can('marketplace.import') && (
                        <>
                          <Button size="sm" variant="ghost" icon="rotate-left" title="Refund" onClick={() => setRefund(o)} />
                          {!o.settlementId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash-2"
                              title="Delete"
                              onClick={async () => (await confirm({ title: `Delete order ${o.externalId}?`, message: 'A synced order comes back on the next sync.', danger: true })) && del.mutate(o.id)}
                            />
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.meta.total > data.meta.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-sm">
            <span className="text-slate-500">
              {fmtNumber(data.meta.total)} orders · page {page} of {data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      {importing && store && <FileImport store={store} kind="ORDERS" onClose={() => setImporting(false)} />}
      {adding && store && <OrderForm store={store} onClose={() => setAdding(false)} />}
      {refund && <RefundForm order={refund} onClose={() => setRefund(null)} />}
    </div>
  );
}

function OrderForm({ store, onClose }: { store: Store; onClose: () => void }) {
  const qc = useQueryClient();
  const listings = useQuery({ queryKey: ['marketplace', 'listings', store.id], queryFn: () => api.get<Listing[]>(`/marketplace/stores/${store.id}/listings`) });
  const [f, setF] = useState({ externalId: '', date: isoDate(), listingId: '', title: '', qty: '1', gross: '', fee: '', country: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post(`/marketplace/stores/${store.id}/orders`, { ...f, qty: Number(f.qty || 1), gross: Number(f.gross || 0), fee: Number(f.fee || 0) }),
    onSuccess: () => (toast.success('Order added'), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Add an order · ${store.name}`} footer={<Button icon="check" loading={save.isPending} disabled={!f.externalId || !f.gross} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Order id on the marketplace" required error={errors.externalId}>
          <Input value={f.externalId} maxLength={80} onChange={(e) => setF({ ...f, externalId: e.target.value })} />
        </Field>
        <Field label="Date" required>
          <DatePicker value={f.date} clearable={false} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label="Listing" className="sm:col-span-2" error={errors.listingId}>
          <Select value={f.listingId} placeholder="Not listed / type a title" onChange={(e) => setF({ ...f, listingId: e.target.value })} options={(listings.data ?? []).map((l) => ({ value: l.id, label: l.title }))} />
        </Field>
        {!f.listingId && (
          <Field label="Item title" className="sm:col-span-2">
            <Input value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        )}
        <Field label="Quantity">
          <NumberInput decimals={0} min={1} value={f.qty} onChange={(v) => setF({ ...f, qty: v })} />
        </Field>
        <Field label={`Paid by the buyer (${store.currencyCode})`} required error={errors.gross}>
          <NumberInput decimals={2} min={0} value={f.gross} onChange={(v) => setF({ ...f, gross: v })} />
        </Field>
        <Field label={`Marketplace fee (${store.currencyCode})`} error={errors.fee}>
          <NumberInput decimals={2} min={0} value={f.fee} onChange={(v) => setF({ ...f, fee: v })} />
        </Field>
        <Field label="Buyer country (2 letters)" error={errors.country}>
          <Input value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />
        </Field>
      </div>
    </Modal>
  );
}

function RefundForm({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ refunded: str(order.refunded || order.gross), feeRefunded: str(order.feeRefunded) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/marketplace/orders/${order.id}/refund`, { refunded: Number(f.refunded || 0), feeRefunded: Number(f.feeRefunded || 0) }),
    onSuccess: () => (toast.success('Refund saved: it is booked by the next settlement'), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal open size="sm" onClose={onClose} title={`Refund of ${order.externalId}`} footer={<Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">
          The buyer paid {money(order.gross, order.currencyCode)}, the fee was {money(order.fee, order.currencyCode)}. Set 0 to clear the refund.
        </p>
        <Field label={`Refunded to the buyer (${order.currencyCode})`} error={errors.refunded}>
          <NumberInput decimals={2} min={0} value={f.refunded} onChange={(v) => setF({ ...f, refunded: v })} />
        </Field>
        <Field label={`Fee given back by the marketplace (${order.currencyCode})`} help="Gumroad keeps its fee on refunds" error={errors.feeRefunded}>
          <NumberInput decimals={2} min={0} value={f.feeRefunded} onChange={(v) => setF({ ...f, feeRefunded: v })} />
        </Field>
      </div>
    </Modal>
  );
}

// ============================================================ settlements & payouts
interface Settlement {
  id: string;
  number: string;
  date: string;
  storeId: string;
  store: { code: string; name: string; currencyCode: string };
  rate: number;
  orders: number;
  gross: number;
  fees: number;
  withheld: number;
  refunds: number;
  net: number;
  status: string;
  invoice: { id: string; number: string; status: string } | null;
  receipt: { id: string; number: string; status: string } | null;
}
interface Preview {
  store: { id: string; code: string; name: string; currencyCode: string };
  to: string;
  rate: number;
  orders: number;
  refundsLater: number;
  lines: { productId: string; title: string; qty: number; amount: number; net: number }[];
  gross: number;
  sales: number;
  vat: number;
  tax: string | null;
  withheld: number;
  wht: string | null;
  fees: number;
  refunds: number;
  net: number;
  issues: string[];
  canPost: boolean;
}
interface Payout {
  id: string;
  storeId: string;
  store: { code: string; name: string; currencyCode: string };
  externalId: string | null;
  date: string;
  amount: number;
  amountBase: number;
  fee: number;
  bank: { id: string; code: string; name: string } | null;
  bankAccountId: string | null;
  reference: string | null;
  status: string;
  source: string;
}

export function SettlementsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const initial = new URLSearchParams(window.location.search).get('store') ?? '';
  const [storeId, setStoreId] = useState(initial);
  const [settling, setSettling] = useState(false);
  const [payout, setPayout] = useState<Payout | 'new' | null>(null);
  const stores = useStores();
  const store = stores.data?.find((s) => s.id === storeId);
  const st = useQuery({ queryKey: ['marketplace', 'settlements', storeId], queryFn: () => api.get<Settlement[]>('/marketplace/settlements', { storeId }) });
  const po = useQuery({ queryKey: ['marketplace', 'payouts', storeId], queryFn: () => api.get<Payout[]>('/marketplace/payouts', { storeId }) });
  const bal = useQuery({ queryKey: ['marketplace', 'balances'], queryFn: () => api.get<{ id: string; code: string; name: string; credited: number; paidOut: number; balance: number }[]>('/marketplace/balances') });
  const undo = useMutation({
    mutationFn: (id: string) => api.post(`/marketplace/settlements/${id}/undo`),
    onSuccess: () => (toast.success('Settlement undone'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const cancelPayout = useMutation({
    mutationFn: (id: string) => api.post(`/marketplace/payouts/${id}/cancel`),
    onSuccess: () => (toast.success('Payout cancelled'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const latest = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of st.data ?? []) if (s.status === 'POSTED' && !m.has(s.storeId)) m.set(s.storeId, s.id);
    return m;
  }, [st.data]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settlements & Payouts"
        subtitle="Book the orders of a store: one sales invoice paid into the marketplace balance, the fees, the PPh 22 the marketplace collects and the refunds. Payouts move the balance to the bank."
        actions={
          store &&
          store.kind === 'STORE' &&
          can('marketplace.post') && (
            <div className="flex gap-2">
              <Button variant="secondary" icon="banknote" onClick={() => setPayout('new')}>
                Record payout
              </Button>
              <Button icon="check" onClick={() => setSettling(true)}>
                Book orders
              </Button>
            </div>
          )
        }
      />
      <div className="w-72">
        <StoreSelect value={storeId} kind="STORE" all onChange={setStoreId} />
      </div>
      {!!bal.data?.length && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {bal.data
            .filter((b) => !storeId || b.id === storeId)
            .map((b) => (
              <StatCard key={b.id} label={`${b.name} balance`} value={fmtMoney(b.balance, 0)} icon="wallet" tone={b.balance < 0 ? 'red' : 'blue'} hint={`Credited ${fmtMoney(b.credited, 0)} · paid out ${fmtMoney(b.paidOut, 0)}`} />
            ))}
        </div>
      )}
      <Card title="Settlements" bodyClass="p-0">
        {st.isLoading ? (
          <Loading />
        ) : !st.data?.length ? (
          <EmptyState icon="wallet" title="Nothing booked yet" description={store ? undefined : 'Choose a store, then Book orders'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Settlement</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-3 py-2 text-right">PPh 22</th>
                  <th className="px-3 py-2 text-right">Fees</th>
                  <th className="px-3 py-2 text-right">Refunds</th>
                  <th className="px-3 py-2 text-right">To balance</th>
                  <th className="px-3 py-2">Documents</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {st.data.map((s) => (
                  <tr key={s.id} className={s.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{s.number}</div>
                      <div className="text-xs text-slate-500">
                        up to {fmtDate(s.date)} · {s.store.code}
                        {s.store.currencyCode !== 'IDR' ? ` · ${s.store.currencyCode} ${fmtNumber(s.rate)}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{s.orders}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.gross, 0)}</td>
                    <td className="px-3 py-2 text-right">{s.withheld ? fmtMoney(s.withheld, 0) : '—'}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.fees, 0)}</td>
                    <td className="px-3 py-2 text-right">{s.refunds ? fmtMoney(s.refunds, 0) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtMoney(s.net, 0)}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.invoice && (
                        <Link to={`/documents/SI/${s.invoice.id}`} className="block text-brand hover:underline">
                          {s.invoice.number}
                        </Link>
                      )}
                      {s.receipt && <span className="block text-slate-500">{s.receipt.number}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.status === 'POSTED' && can('marketplace.post') && latest.get(s.storeId) === s.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="rotate-left"
                          loading={undo.isPending}
                          onClick={async () => (await confirm({ title: `Undo ${s.number}?`, message: 'The receipt and the invoice are cancelled, the journal voided and the orders can be booked again.', danger: true })) && undo.mutate(s.id)}
                        >
                          Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Payouts" bodyClass="p-0">
        {po.isLoading ? (
          <Loading />
        ) : !po.data?.length ? (
          <EmptyState icon="banknote" title="No payouts" />
        ) : (
          <ul className="divide-y divide-line">
            {po.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {fmtDate(p.date)} · {p.store.name} · {money(p.amount, p.store.currencyCode)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {p.status === 'POSTED' ? `received ${fmtMoney(p.amountBase, 0)}${p.fee ? `, fee ${fmtMoney(p.fee, 0)}` : ''} in ${p.bank?.name ?? '—'}` : 'read from the marketplace, not booked yet'}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                </span>
                <Badge tone={p.status === 'POSTED' ? 'green' : p.status === 'PENDING' ? 'amber' : 'gray'}>{p.status === 'PENDING' ? 'Waiting' : p.status === 'POSTED' ? 'Booked' : 'Cancelled'}</Badge>
                {can('marketplace.post') && p.status === 'PENDING' && (
                  <Button size="sm" onClick={() => setPayout(p)}>
                    Book
                  </Button>
                )}
                {can('marketplace.post') && p.status !== 'CANCELLED' && (
                  <Button size="sm" variant="ghost" icon="x" title="Cancel" onClick={async () => (await confirm({ title: 'Cancel this payout?', danger: true })) && cancelPayout.mutate(p.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {settling && store && <SettleForm store={store} onClose={() => setSettling(false)} />}
      {payout && (payout === 'new' ? store : stores.data?.find((s) => s.id === payout.storeId)) && (
        <PayoutForm store={(payout === 'new' ? store : stores.data!.find((s) => s.id === payout.storeId))!} payout={payout === 'new' ? null : payout} onClose={() => setPayout(null)} />
      )}
    </div>
  );
}

function SettleForm({ store, onClose }: { store: Store; onClose: () => void }) {
  const qc = useQueryClient();
  const [to, setTo] = useState(yesterday());
  const [rate, setRate] = useState('');
  const pv = useQuery({ queryKey: ['marketplace', 'preview', store.id, to, rate], queryFn: () => api.post<Preview>(`/marketplace/stores/${store.id}/settlements/preview`, { to, rate: optNum(rate) }) });
  const post = useMutation({
    mutationFn: () => api.post<{ number: string }>(`/marketplace/stores/${store.id}/settlements`, { to, rate: optNum(rate) }),
    onSuccess: (r) => (toast.success(`${r.number} booked`), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => toast.error(e),
  });
  const p = pv.data;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Book orders · ${store.name}`}
      footer={
        <Button icon="check" loading={post.isPending} disabled={!p?.canPost} onClick={() => post.mutate()}>
          Book settlement
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Orders up to (Jakarta time)" help="Also the date of the invoice and the journal">
          <DatePicker value={to} clearable={false} max={isoDate()} onChange={(v) => setTo(v ?? yesterday())} />
        </Field>
        {store.currencyCode !== 'IDR' && (
          <Field label={`IDR per ${store.currencyCode}`} help="Empty = the exchange rate of the day in Master Data">
            <NumberInput decimals={4} min={0} value={rate} placeholder={p?.rate ? String(p.rate) : ''} onChange={setRate} />
          </Field>
        )}
      </div>
      {pv.isLoading || !p ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-3 text-sm">
          {!!p.issues.length && (
            <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-8 text-amber-900">
              {p.issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          )}
          {!!p.lines.length && (
            <table className="w-full">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">Invoice line (product)</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Before VAT</th>
                  <th className="text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.lines.map((l) => (
                  <tr key={l.productId}>
                    <td className="py-1">{l.title}</td>
                    <td className="text-right">{fmtNumber(l.qty)}</td>
                    <td className="text-right">{fmtMoney(l.net, 0)}</td>
                    <td className="text-right">{fmtMoney(l.amount, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3">
            <dt>Orders booked</dt>
            <dd className="text-right">
              {p.orders}
              {p.refundsLater ? ` + ${p.refundsLater} later refund(s)` : ''}
            </dd>
            <dt>Sales invoice{p.tax ? ` (VAT ${p.tax} ${fmtMoney(p.vat, 0)})` : ''}</dt>
            <dd className="text-right">{fmtMoney(p.gross, 0)}</dd>
            {p.wht && (
              <>
                <dt>PPh 22 collected by the marketplace ({p.wht})</dt>
                <dd className="text-right">− {fmtMoney(p.withheld, 0)}</dd>
              </>
            )}
            <dt>Marketplace fees</dt>
            <dd className="text-right">− {fmtMoney(p.fees, 0)}</dd>
            <dt>Refunds of orders booked before</dt>
            <dd className="text-right">− {fmtMoney(p.refunds, 0)}</dd>
            <dt className="font-semibold">Into the marketplace balance</dt>
            <dd className="text-right font-semibold">{fmtMoney(p.net, 0)}</dd>
          </dl>
        </div>
      )}
    </Modal>
  );
}

function PayoutForm({ store, payout, onClose }: { store: Store; payout: Payout | null; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const [f, setF] = useState({
    date: payout?.date ?? isoDate(),
    amount: str(payout?.amount),
    amountBase: str(payout?.amountBase || (store.currencyCode === 'IDR' ? payout?.amount : undefined)),
    fee: str(payout?.fee || 0),
    bankAccountId: payout?.bankAccountId ?? store.payoutBankAccountId ?? '',
    reference: payout?.reference ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post(payout ? `/marketplace/stores/${store.id}/payouts/${payout.id}` : `/marketplace/stores/${store.id}/payouts`, { ...f, amount: Number(f.amount || 0), amountBase: Number(f.amountBase || 0), fee: Number(f.fee || 0) }),
    onSuccess: () => (toast.success('Payout booked'), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const banks = (opts.data?.banks ?? []).filter((b) => b.id !== store.balanceBankAccountId);
  return (
    <Modal open onClose={onClose} title={`Payout from ${store.name}`} footer={<Button icon="check" loading={save.isPending} disabled={!f.amount || !f.amountBase || !f.bankAccountId} onClick={() => save.mutate()}>Book payout</Button>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date received" required error={errors.date}>
          <DatePicker value={f.date} clearable={false} max={isoDate()} onChange={(v) => setF({ ...f, date: v ?? isoDate() })} />
        </Field>
        <Field label={`Payout (${store.currencyCode})`} required error={errors.amount}>
          <NumberInput decimals={2} min={0} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Received in the bank (IDR)" required error={errors.amountBase}>
          <NumberInput decimals={0} min={0} value={f.amountBase} onChange={(v) => setF({ ...f, amountBase: v })} />
        </Field>
        <Field label="Transfer / conversion fee (IDR)" error={errors.fee}>
          <NumberInput decimals={0} min={0} value={f.fee} onChange={(v) => setF({ ...f, fee: v })} />
        </Field>
        <Field label="Bank" required error={errors.bankAccountId}>
          <Select value={f.bankAccountId} placeholder="Choose" onChange={(e) => setF({ ...f, bankAccountId: e.target.value })} options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
        </Field>
        <Field label="Reference" error={errors.reference}>
          <Input value={f.reference} maxLength={100} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">Dr Bank (received) + Marketplace Fees (fee) / Cr Marketplace Balance (received + fee).</p>
    </Modal>
  );
}

// ============================================================ statistics
interface StatRowT {
  id: string;
  storeId: string;
  date: string;
  rangeLabel: string | null;
  visits: number | null;
  views: number | null;
  orders: number | null;
  revenue: number | null;
  followers: number | null;
  favorites: number | null;
  impressions: number | null;
  clicks: number | null;
  saves: number | null;
  listings: number | null;
  source: string;
  store: { code: string; name: string; channel: string };
}
const METRICS = ['visits', 'views', 'followers', 'favorites', 'impressions', 'clicks', 'saves', 'orders', 'revenue', 'listings'] as const;
const METRIC_LABEL: Record<(typeof METRICS)[number], string> = { visits: 'Visits', views: 'Views', followers: 'Followers', favorites: 'Favorites', impressions: 'Impressions', clicks: 'Clicks', saves: 'Saves', orders: 'Orders', revenue: 'Revenue', listings: 'Listings' };

export function StatsPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const stores = useStores();
  const [storeId, setStoreId] = useState('');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<StatRowT | 'new' | null>(null);
  const store = stores.data?.find((s) => s.id === storeId);
  const q = useQuery({ queryKey: ['marketplace', 'stats', storeId], queryFn: () => api.get<{ from: string; to: string; rows: StatRowT[] }>('/marketplace/stats', { storeId }) });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/stats/${id}`),
    onSuccess: () => (toast.success('Deleted'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const rows = q.data?.rows ?? [];
  const used = METRICS.filter((m) => rows.some((r) => r[m] !== null));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Channel Statistics"
        subtitle="Daily snapshots of visits, views, followers, impressions and saves, as each channel reports them (typed, or imported from the collected JSON / CSV)"
        actions={
          store &&
          can('marketplace.import') && (
            <div className="flex gap-2">
              <Button variant="secondary" icon="upload" onClick={() => setImporting(true)}>
                Import file
              </Button>
              <Button icon="plus" onClick={() => setEditing('new')}>
                Add day
              </Button>
            </div>
          )
        }
      />
      <div className="w-72">
        <StoreSelect value={storeId} all onChange={setStoreId} />
      </div>
      <Card bodyClass="p-0" title={q.data ? `${fmtDate(q.data.from)} – ${fmtDate(q.data.to)}` : undefined}>
        {q.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon="eye" title="No statistics in the last 90 days" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">Day</th>
                  {!storeId && <th className="px-3 py-2">Channel</th>}
                  {used.map((m) => (
                    <th key={m} className="px-3 py-2 text-right">
                      {METRIC_LABEL[m]}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => {
                  const prev = rows.slice(i + 1).find((x) => x.storeId === r.storeId);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2">
                        <div>{fmtDate(r.date)}</div>
                        {r.rangeLabel && <div className="text-xs text-slate-500">{r.rangeLabel}</div>}
                      </td>
                      {!storeId && (
                        <td className="px-3 py-2">
                          <span className="mr-2">{r.store.code}</span>
                          <ChannelBadge channel={r.store.channel} />
                        </td>
                      )}
                      {used.map((m) => (
                        <td key={m} className="px-3 py-2 text-right">
                          {r[m] === null ? '—' : fmtNumber(r[m])}
                          {prev && r[m] !== null && prev[m] !== null && m !== 'listings' && (
                            <div>
                              <Change v={Math.round(((r[m] as number) - (prev[m] as number)) * 100) / 100} />
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {can('marketplace.import') && (
                          <>
                            <Button size="sm" variant="ghost" icon="pencil" title="Edit" onClick={() => (setStoreId(r.storeId), setEditing(r))} />
                            <Button size="sm" variant="ghost" icon="trash-2" title="Delete" onClick={async () => (await confirm({ title: `Delete ${r.store.code} of ${fmtDate(r.date)}?`, danger: true })) && del.mutate(r.id)} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {importing && store && <FileImport store={store} kind="STATS" onClose={() => setImporting(false)} />}
      {editing && (editing === 'new' ? store : stores.data?.find((s) => s.id === editing.storeId)) && (
        <StatForm store={(editing === 'new' ? store : stores.data!.find((s) => s.id === editing.storeId))!} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function StatForm({ store, row, onClose }: { store: Store; row: StatRowT | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(row?.date.slice(0, 10) ?? isoDate());
  const [rangeLabel, setRangeLabel] = useState(row?.rangeLabel ?? '');
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(METRICS.map((m) => [m, str(row?.[m] as number | null | undefined)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shown = store.kind === 'SOCIAL' ? (['followers', 'views', 'impressions', 'clicks', 'saves'] as const) : METRICS;
  const save = useMutation({
    mutationFn: () => api.put(`/marketplace/stores/${store.id}/stats`, { date, rangeLabel, ...Object.fromEntries(METRICS.map((m) => [m, optNum(v[m])])) }),
    onSuccess: () => (toast.success('Saved'), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Statistics · ${store.name}`} footer={<Button icon="check" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Day" required error={errors.date}>
          <DatePicker value={date} clearable={false} max={isoDate()} onChange={(x) => setDate(x ?? isoDate())} />
        </Field>
        <Field label="Period shown" className="sm:col-span-2" help='e.g. "Last 30 days"'>
          <Input value={rangeLabel} maxLength={100} onChange={(e) => setRangeLabel(e.target.value)} />
        </Field>
        {shown.map((m) => (
          <Field key={m} label={METRIC_LABEL[m]} error={errors[m]}>
            <NumberInput decimals={m === 'revenue' ? 2 : 0} min={0} value={v[m]} onChange={(x) => setV({ ...v, [m]: x })} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

// ============================================================ stores & listings
interface Listing {
  id: string;
  externalId: string;
  title: string;
  url: string | null;
  price: number;
  currencyCode: string;
  status: string;
  productId: string | null;
  product: { id: string; code: string; name: string } | null;
  sold30: number;
  revenue30: number;
}

export function StoresPage() {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const stores = useStores();
  const [editing, setEditing] = useState<Store | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const setup = useMutation({
    mutationFn: (id: string) => api.post<{ made: string[] }>(`/marketplace/stores/${id}/setup-accounts`),
    onSuccess: (r) => (toast.success(r.made.length ? `Created ${r.made.join(' and ')}` : 'Nothing to create'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const runDaily = useMutation({
    mutationFn: (id: string) => api.post<{ result: string }>(`/marketplace/stores/${id}/run-daily`),
    onSuccess: (r) => (r.result.includes('failed') || r.result.includes('blocked') ? toast.error(r.result) : toast.success(r.result), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/stores/${id}`),
    onSuccess: () => (toast.success('Store deleted'), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stores & Listings"
        subtitle="Marketplace stores (they sell) and social channels (audience only), their accounts, API token and the product of each listing"
        actions={
          can('marketplace.manage') && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              New store or channel
            </Button>
          )
        }
      />
      <Card bodyClass="p-0">
        {stores.isLoading ? (
          <Loading />
        ) : !stores.data?.length ? (
          <EmptyState icon="store" title="No stores yet" description="Add Gumroad, Etsy, Shopee, Tokopedia... and your Facebook Page or Pinterest account" />
        ) : (
          <ul className="divide-y divide-line">
            {stores.data.map((s) => (
              <li key={s.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <span className="block font-medium">
                      {s.code} · {s.name} {!s.isActive && <Badge tone="gray">Inactive</Badge>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <ChannelBadge channel={s.channel} />
                      {s.kind === 'STORE' ? `${s.currencyCode} · ${s.listings} listings${s.unmapped ? ` (${s.unmapped} not mapped)` : ''} · ${s.unposted} orders to book` : 'audience only'}
                      {s.channel === 'GUMROAD' && (s.hasToken ? ' · API token saved' : ' · no API token')}
                    </span>
                    {!!s.issues.length && <span className="block text-xs text-amber-700">{s.issues.join(' · ')}</span>}
                    {(s.autoSync || s.autoSettle) && (
                      <span className="block text-xs text-slate-500">
                        Daily from {String(s.autoHour).padStart(2, '0')}:00 WIB: {[s.autoSync && 'sync', s.autoSettle && 'book yesterday’s orders'].filter(Boolean).join(' + ')}
                        {s.lastAutoRunAt ? (
                          <span className={s.lastAutoResult?.startsWith('ERROR') ? 'text-red-600' : ''}>
                            {' '}
                            · last run {fmtDateTime(s.lastAutoRunAt)}: {s.lastAutoResult}
                          </span>
                        ) : (
                          ' · not run yet'
                        )}
                      </span>
                    )}
                  </button>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-xs text-brand hover:underline">
                      Open
                    </a>
                  )}
                  <SyncButton store={s} />
                  {(s.autoSync || s.autoSettle) && can('marketplace.import') && (!s.autoSettle || can('marketplace.post')) && (
                    <Button size="sm" variant="secondary" icon="play" loading={runDaily.isPending && runDaily.variables === s.id} onClick={() => runDaily.mutate(s.id)}>
                      Run daily job now
                    </Button>
                  )}
                  {can('marketplace.manage') && s.kind === 'STORE' && (!s.customerId || !s.balanceBankAccountId) && (
                    <Button size="sm" variant="secondary" loading={setup.isPending} onClick={() => setup.mutate(s.id)}>
                      Set up accounts
                    </Button>
                  )}
                  {can('marketplace.manage') && (
                    <>
                      <Button size="sm" variant="ghost" icon="pencil" title="Edit" onClick={() => setEditing(s)} />
                      <Button size="sm" variant="ghost" icon="trash-2" title="Delete" onClick={async () => (await confirm({ title: `Delete ${s.name}?`, message: 'Only a store without orders, settlements or payouts can be deleted.', danger: true })) && del.mutate(s.id)} />
                    </>
                  )}
                </div>
                {open === s.id && s.kind === 'STORE' && <ListingsPanel store={s} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <StoreForm store={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ListingsPanel({ store }: { store: Store }) {
  const can = useSession((s) => s.can);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketplace', 'listings', store.id], queryFn: () => api.get<Listing[]>(`/marketplace/stores/${store.id}/listings`) });
  const [map, setMap] = useState<Record<string, { productId: string | null; label?: string }>>({});
  const [adding, setAdding] = useState(false);
  const [nl, setNl] = useState({ externalId: '', title: '', price: '' });
  const save = useMutation({
    mutationFn: () => api.put(`/marketplace/stores/${store.id}/listings`, { rows: Object.entries(map).map(([id, v]) => ({ id, productId: v.productId })) }),
    onSuccess: () => (toast.success('Listings mapped'), setMap({}), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  const add = useMutation({
    mutationFn: () => api.post(`/marketplace/stores/${store.id}/listings`, { ...nl, price: Number(nl.price || 0) }),
    onSuccess: () => (toast.success('Listing added'), setAdding(false), setNl({ externalId: '', title: '', price: '' }), qc.invalidateQueries({ queryKey: ['marketplace'] })),
    onError: (e) => toast.error(e),
  });
  return (
    <div className="border-t border-line bg-slate-50/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Listings and the product booked for each</span>
        {can('marketplace.manage') && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(!adding)}>
              Add listing
            </Button>
            <Button size="sm" icon="check" disabled={!Object.keys(map).length} loading={save.isPending} onClick={() => save.mutate()}>
              Save mapping
            </Button>
          </div>
        )}
      </div>
      {adding && (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Input placeholder="Listing id on the marketplace" value={nl.externalId} onChange={(e) => setNl({ ...nl, externalId: e.target.value })} />
          <Input className="sm:col-span-2" placeholder="Title" value={nl.title} onChange={(e) => setNl({ ...nl, title: e.target.value })} />
          <div className="flex gap-2">
            <NumberInput decimals={2} min={0} value={nl.price} placeholder={`Price ${store.currencyCode}`} onChange={(v) => setNl({ ...nl, price: v })} />
            <Button size="sm" disabled={!nl.externalId || !nl.title} loading={add.isPending} onClick={() => add.mutate()}>
              Add
            </Button>
          </div>
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <p className="text-sm text-slate-500">{store.channel === 'GUMROAD' ? 'Sync the store to read its products.' : 'Listings are added by hand; orders imported with a known item id or title are linked to them.'}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Listing</th>
              <th className="text-right">Price</th>
              <th className="text-right">30 days</th>
              <th className="w-80 pl-3">ERP product</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.data.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5">
                  <div className={l.productId || map[l.id]?.productId ? '' : 'text-amber-700'}>{l.title}</div>
                  <div className="text-xs text-slate-500">
                    {l.externalId} · {l.status.toLowerCase()}
                    {l.url && (
                      <>
                        {' · '}
                        <a href={l.url} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
                          open
                        </a>
                      </>
                    )}
                  </div>
                </td>
                <td className="text-right">{money(l.price, l.currencyCode)}</td>
                <td className="text-right text-xs">
                  {fmtNumber(l.sold30)}× · {money(l.revenue30, l.currencyCode)}
                </td>
                <td className="pl-3">
                  <AsyncSelect
                    resource="products"
                    value={map[l.id] ? map[l.id].productId : l.productId}
                    initialLabel={l.product ? `${l.product.code} - ${l.product.name}` : undefined}
                    disabled={!can('marketplace.manage')}
                    placeholder={store.defaultProductId ? 'Default product of the store' : 'Choose a product'}
                    onChange={(v) => setMap({ ...map, [l.id]: { productId: v } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StoreForm({ store, onClose }: { store: Store | null; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useOptions();
  const [f, setF] = useState({
    code: store?.code ?? '',
    name: store?.name ?? '',
    channel: store?.channel ?? 'GUMROAD',
    kind: store?.kind ?? ('STORE' as 'STORE' | 'SOCIAL'),
    url: store?.url ?? '',
    currencyCode: store?.currencyCode ?? 'USD',
    customerId: store?.customerId ?? (null as string | null),
    balanceBankAccountId: store?.balanceBankAccountId ?? '',
    payoutBankAccountId: store?.payoutBankAccountId ?? '',
    taxId: store?.taxId ?? '',
    whtTaxId: store?.whtTaxId ?? '',
    defaultProductId: store?.defaultProductId ?? (null as string | null),
    syncFrom: store?.syncFrom?.slice(0, 10) ?? (null as string | null),
    isActive: store?.isActive ?? true,
    notes: store?.notes ?? '',
    autoSync: store?.autoSync ?? false,
    autoSettle: store?.autoSettle ?? false,
    autoHour: String(store?.autoHour ?? 7),
  });
  const [token, setToken] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, autoHour: Number(f.autoHour || 0), ...(token === undefined ? {} : { apiToken: token }) };
      return store ? api.put(`/marketplace/stores/${store.id}`, body) : api.post('/marketplace/stores', body);
    },
    onSuccess: () => (toast.success('Saved'), qc.invalidateQueries({ queryKey: ['marketplace'] }), onClose()),
    onError: (e) => (setErrors(errorsOf(e)), toast.error(e)),
  });
  const banks = opts.data?.banks ?? [];
  const vat = (opts.data?.taxes ?? []).filter((t) => t.kind === 'VAT');
  const wht = (opts.data?.taxes ?? []).filter((t) => t.kind === 'WHT');
  const social = ['FACEBOOK', 'INSTAGRAM', 'PINTEREST'];
  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={store ? `${store.code} · ${store.name}` : 'New store or channel'}
      footer={
        <Button icon="check" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Channel" required>
          <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value, kind: social.includes(e.target.value) ? 'SOCIAL' : 'STORE' })} options={(opts.data?.channels ?? Object.keys(CHANNEL_LABEL)).map((c) => ({ value: c, label: CHANNEL_LABEL[c] ?? c }))} />
        </Field>
        <Field label="Code" required error={errors.code}>
          <Input value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Kind" help="An audience-only channel keeps statistics but no orders">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'STORE' | 'SOCIAL' })} options={[{ value: 'STORE', label: 'Store (sells)' }, { value: 'SOCIAL', label: 'Audience only' }]} />
        </Field>
        <Field label="Address (URL)" className="sm:col-span-2" error={errors.url}>
          <Input value={f.url} maxLength={300} placeholder="https://" onChange={(e) => setF({ ...f, url: e.target.value })} />
        </Field>
      </div>
      {f.kind === 'STORE' && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold">Booking</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Currency paid in" error={errors.currencyCode}>
              <Input value={f.currencyCode} maxLength={3} onChange={(e) => setF({ ...f, currencyCode: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Customer (the marketplace)" className="sm:col-span-2" help='Empty: "Set up accounts" creates MP-<code>' error={errors.customerId}>
              <AsyncSelect resource="customers" value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} />
            </Field>
            <Field label="Marketplace balance account" help="Cash / bank account on Marketplace Balances (1-1210)" error={errors.balanceBankAccountId}>
              <Select value={f.balanceBankAccountId} placeholder="Create with Set up accounts" onChange={(e) => setF({ ...f, balanceBankAccountId: e.target.value })} options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Field>
            <Field label="Payouts go to" error={errors.payoutBankAccountId}>
              <Select value={f.payoutBankAccountId} placeholder="Choose when booking" onChange={(e) => setF({ ...f, payoutBankAccountId: e.target.value })} options={banks.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            </Field>
            <Field label="Default product" help="For listings not mapped to a product" error={errors.defaultProductId}>
              <AsyncSelect resource="products" value={f.defaultProductId} onChange={(v) => setF({ ...f, defaultProductId: v })} />
            </Field>
            <Field label="VAT on the sales" help="Prices are taken as VAT-inclusive. Empty for sales abroad without VAT" error={errors.taxId}>
              <Select value={f.taxId} placeholder="No VAT" onChange={(e) => setF({ ...f, taxId: e.target.value })} options={vat.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} />
            </Field>
            <Field label="Income tax collected by the marketplace" help="PPh 22 PMSE 0.5% on domestic marketplaces (PMK 37/2025)" error={errors.whtTaxId}>
              <Select value={f.whtTaxId} placeholder="None" onChange={(e) => setF({ ...f, whtTaxId: e.target.value })} options={wht.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} />
            </Field>
          </div>
          {f.channel === 'GUMROAD' && (
            <>
              <h3 className="mb-2 mt-5 text-sm font-semibold">Gumroad API</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Access token" className="sm:col-span-2" help={store?.hasToken ? 'Saved (encrypted). Type a new one to replace it.' : 'Gumroad: Settings > Advanced > Applications > Generate access token'} error={errors.apiToken}>
                  <Input type="password" autoComplete="off" value={token ?? ''} placeholder={store?.hasToken ? '••••••••' : ''} onChange={(e) => setToken(e.target.value)} />
                </Field>
                <Field label="Read sales from" help="First sync only">
                  <DatePicker value={f.syncFrom} onChange={(v) => setF({ ...f, syncFrom: v })} />
                </Field>
              </div>
              {store?.hasToken && (
                <div className="mt-2">
                  <Checkbox checked={token === ''} onChange={(v) => setToken(v ? '' : undefined)} label="Remove the saved token" />
                </div>
              )}
            </>
          )}
          <h3 className="mb-2 mt-5 text-sm font-semibold">Daily job</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Runs every day from" help="Jakarta time. Checked every 15 minutes, so a server that was off catches up when it starts">
              <Select value={f.autoHour} onChange={(e) => setF({ ...f, autoHour: e.target.value })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00 WIB` }))} />
            </Field>
            <Field label=" ">
              <Checkbox checked={f.autoSync && f.channel === 'GUMROAD'} disabled={f.channel !== 'GUMROAD'} onChange={(v) => setF({ ...f, autoSync: v })} label={f.channel === 'GUMROAD' ? 'Sync every day (products, sales, payouts)' : 'Sync every day: Gumroad only, import files for the others'} />
            </Field>
            <Field label=" " help="Only when nothing blocks it (rates, mapping, accounts); otherwise the reason is shown on the store">
              <Checkbox checked={f.autoSettle} onChange={(v) => setF({ ...f, autoSettle: v })} label="Book the orders up to yesterday every day" />
            </Field>
          </div>
        </>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <Field label=" ">
          <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </Field>
      </div>
    </Modal>
  );
}
