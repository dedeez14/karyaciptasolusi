import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, humanize } from '@/lib/format';
import { Card, Icon, StatusBadge, type Tone } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

// ------------------------------------------------------------------ data shapes (GET /dashboard)
export interface KpiItem {
  key: string;
  label: string;
  value: number;
  type: 'money' | 'number';
  hint?: string;
  prev?: number;
  spark?: number[];
  link?: string;
  goodWhenUp?: boolean;
}
export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  amount?: number;
  link: string;
  icon: string;
  tone: 'red' | 'amber' | 'blue' | 'violet' | 'gray';
}
export interface Aging {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  over90: number;
  total: number;
  count: number;
}
export interface Overview {
  kpi: KpiItem[];
  attention: AttentionItem[];
  monthly?: { month: string; sales: number; purchases: number }[];
  arAging?: Aging;
  apAging?: Aging;
  cashAccounts?: { id: string; name: string; isCash: boolean; balance: number }[];
  pipeline?: { id: string; name: string; isWon: boolean; isLost: boolean; count: number; amount: number }[];
  topCustomers?: { id: string | null; name: string; value: number; count: number }[];
  topProducts?: { id: string; code: string; name: string; qty: number; value: number }[];
  team?: { total: number; present: number; late: number; wfh: number; sick: number; onLeave: number; absent: number; notIn: number };
  lowStock?: { id: string; code: string; name: string; onHand: number; min: number }[];
  recentInvoices?: { id: string; number: string; date: string; dueDate: string | null; grandTotal: string; paidAmount: string; status: string; customerName: string | null }[];
  activity?: { id: string; user: string | null; entity: string; action: string; label: string | null; at: string }[];
  generatedAt: string;
}

const KPI_STYLE: Record<string, { icon: string; tone: Tone }> = {
  salesMonth: { icon: 'trending-up', tone: 'blue' },
  receivable: { icon: 'hand-coins', tone: 'amber' },
  purchaseMonth: { icon: 'shopping-bag', tone: 'violet' },
  payable: { icon: 'banknote', tone: 'red' },
  cash: { icon: 'landmark', tone: 'green' },
  profit: { icon: 'scale', tone: 'blue' },
  openLeads: { icon: 'user-plus', tone: 'blue' },
  pipeline: { icon: 'target', tone: 'violet' },
  employees: { icon: 'id-card', tone: 'gray' },
  lowStock: { icon: 'package-x', tone: 'amber' },
};
const CHIP: Record<Tone, string> = {
  blue: 'bg-brand-50 text-brand-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-700',
  gray: 'bg-slate-100 text-slate-600',
};
const SPARK: Record<Tone, string> = { blue: '#1d4f7a', green: '#059669', amber: '#d97706', red: '#dc2626', violet: '#7c3aed', gray: '#64748b' };

export const money = (v: number, currency = 'IDR') => `${currency === 'IDR' ? 'Rp' : currency} ${fmtCompact(v)}`;

const ViewAll = ({ to, children = 'View all' }: { to: string; children?: ReactNode }) => (
  <Link to={to} className="text-xs font-medium whitespace-nowrap text-brand-700 hover:underline">
    {children}
  </Link>
);
const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-400">
    <Icon name={icon} className="h-6 w-6" />
    {text}
  </div>
);

/** tiny trend line for the last months */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 64;
  const h = 22;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity={0.08} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

/** change against the same days of last month */
function Delta({ value, prev, goodWhenUp }: { value: number; prev: number; goodWhenUp?: boolean }) {
  if (!prev && !value) return null;
  if (!prev) return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">new</span>;
  const pct = ((value - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const good = goodWhenUp === undefined ? null : up === goodWhenUp;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', good === null ? 'bg-slate-100 text-slate-600' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>
      <Icon name={up ? 'arrow-up-right' : 'arrow-down-right'} className="h-3 w-3" />
      {Math.abs(pct) >= 1000 ? '>999' : fmtNumber(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}

export function KpiTile({ k, currency }: { k: KpiItem; currency: string }) {
  const st = KPI_STYLE[k.key] ?? { icon: 'circle-dot', tone: 'gray' as Tone };
  const negative = k.type === 'money' && k.value < 0;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[12.5px] leading-tight font-medium text-slate-500">{k.label}</span>
        <span className={cn('shrink-0 rounded-lg p-1.5', CHIP[st.tone])}>
          <Icon name={st.icon} className="h-4 w-4" />
        </span>
      </div>
      <p className={cn('mt-2 truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl', negative ? 'text-red-600' : 'text-slate-900')} title={k.type === 'money' ? fmtMoney(k.value, 0) : undefined}>
        {k.type === 'money' ? money(k.value, currency) : fmtNumber(k.value)}
      </p>
      {/* change, hint and the trend line share the bottom row so the amount always has the full width */}
      <div className="mt-1 flex min-h-6 items-end justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {k.prev !== undefined && <Delta value={k.value} prev={k.prev} goodWhenUp={k.goodWhenUp} />}
          {k.hint && <span className="truncate text-[11.5px] text-slate-500">{k.hint}</span>}
        </div>
        {k.spark && <Sparkline values={k.spark} color={SPARK[st.tone]} />}
      </div>
    </>
  );
  const cls = 'card block min-w-0 p-4 transition-shadow';
  return k.link ? (
    <Link to={k.link} className={cn(cls, 'hover:shadow-pop focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="card p-4">
      <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
      <div className="mt-4 h-6 w-32 animate-pulse rounded bg-slate-100" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

// ------------------------------------------------------------------ needs attention
export function AttentionCard({ items, currency }: { items: AttentionItem[]; currency: string }) {
  return (
    <Card title="Needs attention" subtitle={items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'} to follow up` : 'Everything is up to date'} bodyClass="p-2">
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="rounded-full bg-emerald-50 p-3 text-emerald-600">
            <Icon name="check-check" className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-slate-700">All clear</p>
          <p className="text-xs text-slate-400">No approvals, overdue invoices or shortages right now.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.key}>
              <Link to={a.link} className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50">
                <span className={cn('shrink-0 rounded-lg p-2', CHIP[a.tone])}>
                  <Icon name={a.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">{a.label}</span>
                  {a.amount !== undefined && <span className="block text-xs text-slate-500 tabular-nums">{fmtMoney(a.amount, 0)}</span>}
                </span>
                <span className={cn('min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums', CHIP[a.tone])}>{a.count}</span>
                <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only">{currency}</span>
    </Card>
  );
}

// ------------------------------------------------------------------ aging
const BUCKETS: { key: keyof Aging; label: string; color: string }[] = [
  { key: 'current', label: 'Not yet due', color: '#10b981' },
  { key: 'd30', label: '1–30 days', color: '#f59e0b' },
  { key: 'd60', label: '31–60 days', color: '#f97316' },
  { key: 'd90', label: '61–90 days', color: '#ef4444' },
  { key: 'over90', label: 'Over 90 days', color: '#991b1b' },
];

export function AgingCard({ title, data, link, currency, empty }: { title: string; data: Aging; link: string; currency: string; empty: string }) {
  const late = data.total - data.current;
  return (
    <Card title={title} subtitle={data.count ? `${data.count} open · ${late > 0 ? `${money(late, currency)} overdue` : 'nothing overdue'}` : undefined} actions={<ViewAll to={link}>Details</ViewAll>}>
      {data.total <= 0 ? (
        <Empty icon="circle-check" text={empty} />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500">Outstanding</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{fmtMoney(data.total, 0)}</p>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {BUCKETS.map((b) => (data[b.key] > 0 ? <div key={b.key} style={{ width: `${(data[b.key] / data.total) * 100}%`, background: b.color }} title={`${b.label}: ${fmtMoney(data[b.key], 0)}`} /> : null))}
          </div>
          <ul className="space-y-1.5 text-sm">
            {BUCKETS.map((b) => (
              <li key={b.key} className={cn('flex items-center gap-2', data[b.key] <= 0 && 'text-slate-400')}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: b.color }} />
                <span className="flex-1">{b.label}</span>
                <span className="text-xs text-slate-400 tabular-nums">{data.total ? Math.round((data[b.key] / data.total) * 100) : 0}%</span>
                <span className="w-28 text-right font-medium tabular-nums">{fmtMoney(data[b.key], 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ cash position
export function CashCard({ accounts }: { accounts: NonNullable<Overview['cashAccounts']> }) {
  const total = accounts.reduce((a, r) => a + r.balance, 0);
  const max = Math.max(1, ...accounts.map((a) => Math.abs(a.balance)));
  return (
    <Card title="Cash position" subtitle="Balance per cash and bank account" actions={<ViewAll to="/accounting/cash">Cash & bank</ViewAll>}>
      {!accounts.length ? (
        <Empty icon="landmark" text="No cash or bank accounts linked to the ledger yet" />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500">Total available</p>
            <p className={cn('text-2xl font-semibold tracking-tight tabular-nums', total < 0 && 'text-red-600')}>{fmtMoney(total, 0)}</p>
          </div>
          <ul className="space-y-3">
            {accounts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <div className="flex items-center gap-2 text-sm">
                  <Icon name={a.isCash ? 'wallet' : 'landmark'} className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className={cn('font-medium tabular-nums', a.balance < 0 && 'text-red-600')}>{fmtMoney(a.balance, 0)}</span>
                </div>
                <div className="mt-1 ml-6 h-1.5 rounded-full bg-slate-100">
                  <div className={cn('h-1.5 rounded-full', a.balance < 0 ? 'bg-red-400' : 'bg-emerald-500')} style={{ width: `${(Math.abs(a.balance) / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ CRM pipeline
export function PipelineCard({ stages, currency }: { stages: NonNullable<Overview['pipeline']>; currency: string }) {
  const shown = stages.filter((s) => !s.isLost);
  const max = Math.max(1, ...shown.map((s) => s.amount));
  const open = shown.filter((s) => !s.isWon);
  return (
    <Card title="Sales pipeline" subtitle={`${open.reduce((a, s) => a + s.count, 0)} open deals · ${money(open.reduce((a, s) => a + s.amount, 0), currency)}`} actions={<ViewAll to="/crm/pipeline">Board</ViewAll>}>
      {!shown.some((s) => s.count) ? (
        <Empty icon="target" text="No opportunities yet" />
      ) : (
        <ul className="space-y-2.5">
          {shown.map((s) => (
            <li key={s.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {s.name} <span className="text-xs text-slate-400">· {s.count}</span>
                </span>
                <span className="font-medium tabular-nums">{s.amount ? money(s.amount, currency) : '—'}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div className={cn('h-2 rounded-full', s.isWon ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: `${Math.max(s.amount ? 3 : 0, (s.amount / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ ranked lists
export function RankCard({ title, subtitle, link, rows, empty, icon }: { title: string; subtitle?: string; link?: string; rows: { key: string; name: string; sub?: string; value: number; to?: string }[]; empty: string; icon: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card title={title} subtitle={subtitle} actions={link && <ViewAll to={link}>Report</ViewAll>}>
      {!rows.length ? (
        <Empty icon={icon} text={empty} />
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-3">
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', i === 0 ? 'bg-accent-400 text-brand-900' : 'bg-slate-100 text-slate-500')}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2 text-sm">
                  {r.to ? (
                    <Link to={r.to} className="truncate hover:text-brand-700 hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="truncate">{r.name}</span>
                  )}
                  <span className="shrink-0 font-medium tabular-nums">{fmtCompact(r.value)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(r.value / max) * 100}%` }} />
                  </div>
                  {r.sub && <span className="shrink-0 text-[11px] text-slate-400">{r.sub}</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ team today
export function TeamCard({ team }: { team: NonNullable<Overview['team']> }) {
  const parts = [
    { label: 'On time', value: team.present - team.late, color: '#10b981' },
    { label: 'Late', value: team.late, color: '#f59e0b' },
    { label: 'On leave', value: team.onLeave, color: '#64748b' },
    { label: 'Sick', value: team.sick, color: '#a855f7' },
    { label: 'Absent', value: team.absent, color: '#dc2626' },
    { label: 'Not checked in', value: team.notIn, color: '#cbd5e1' },
  ];
  const total = Math.max(1, team.total);
  return (
    <Card title="Team today" subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} actions={<ViewAll to="/r/attendances">Attendance</ViewAll>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">At work</p>
          <p className="text-2xl font-semibold tabular-nums">
            {team.present}
            <span className="text-base font-normal text-slate-400"> / {team.total}</span>
          </p>
        </div>
        {team.wfh > 0 && <span className="rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-700">{team.wfh} working from home</span>}
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {parts.map((p) => (p.value > 0 ? <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className={cn('flex items-center gap-2', !p.value && 'text-slate-400')}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="flex-1 truncate">{p.label}</span>
            <span className="font-medium tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ low stock
export function LowStockCard({ rows }: { rows: NonNullable<Overview['lowStock']> }) {
  return (
    <Card title="Low stock" subtitle="Products at or below their minimum" actions={<ViewAll to="/reports/low-stock">Report</ViewAll>}>
      {!rows.length ? (
        <Empty icon="package-check" text="All products are above their minimum stock" />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/products/${r.id}`} className="min-w-0 truncate hover:text-brand-700 hover:underline">
                  {r.name} <span className="text-xs text-slate-400">{r.code}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums">
                  <span className={cn('font-semibold', r.onHand <= 0 ? 'text-red-600' : 'text-amber-600')}>{fmtNumber(r.onHand)}</span>
                  <span className="text-slate-400"> / min {fmtNumber(r.min)}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div className={cn('h-1.5 rounded-full', r.onHand <= 0 ? 'bg-red-500' : 'bg-amber-500')} style={{ width: `${Math.min(100, (r.onHand / (r.min || 1)) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ recent invoices
export function RecentInvoicesCard({ rows }: { rows: NonNullable<Overview['recentInvoices']> }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card title="Recent invoices" actions={<ViewAll to="/documents/SI" />} bodyClass="p-0">
      {!rows.length ? (
        <Empty icon="receipt" text="No invoices yet" />
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">Invoice</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Due</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
                <th className="px-5 py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bal = Number(r.grandTotal) - Number(r.paidAmount);
                const late = !!r.dueDate && r.dueDate.slice(0, 10) < today && bal > 0 && ['CONFIRMED', 'PARTIAL'].includes(r.status);
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to={`/documents/SI/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.number}
                      </Link>
                      {r.customerName && <p className="max-w-56 truncate text-xs text-slate-500">{r.customerName}</p>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(r.date)}</td>
                    <td className={cn('px-3 py-2.5 whitespace-nowrap', late ? 'font-medium text-red-600' : 'text-slate-600')}>{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.grandTotal, 0)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', bal > 0 ? 'text-slate-900' : 'text-slate-400')}>{fmtMoney(bal, 0)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <StatusBadge status={r.status} label={r.status === 'COMPLETED' ? 'Paid' : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/documents/SI/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.number}</p>
                    <p className="truncate text-xs text-slate-500">
                      {r.customerName ? `${r.customerName} · ` : ''}
                      {fmtDate(r.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm tabular-nums">{fmtMoney(r.grandTotal, 0)}</span>
                    <StatusBadge status={r.status} label={r.status === 'COMPLETED' ? 'Paid' : undefined} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ activity
const ACTION_WORD: Record<string, string> = { CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted', CONFIRM: 'confirmed', CANCEL: 'cancelled', APPROVED: 'approved', REJECTED: 'rejected', POST: 'posted', SEND: 'sent', UPLOAD: 'uploaded' };
const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 60) return 'just now';
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 7 * 86_400) return rtf.format(-Math.floor(s / 86_400), 'day');
  return fmtDate(iso);
};

export function ActivityCard({ rows }: { rows: NonNullable<Overview['activity']> }) {
  return (
    <Card title="Recent activity" actions={<ViewAll to="/system/audit">Audit trail</ViewAll>} bodyClass="px-5 py-3">
      {!rows.length ? (
        <Empty icon="activity" text="Nothing recorded yet" />
      ) : (
        <ol className="relative space-y-3.5 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-line">
          {rows.map((r) => (
            <li key={r.id} className="relative flex gap-3">
              <span className="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 uppercase ring-2 ring-white">{(r.user ?? '?').slice(0, 2)}</span>
              <div className="min-w-0 text-sm">
                <p className="leading-snug text-slate-700">
                  <span className="font-medium text-slate-900">{r.user ?? 'Someone'}</span> {ACTION_WORD[r.action] ?? humanize(r.action).toLowerCase()} {r.entity.toLowerCase()}
                  {r.label && <span className="font-medium text-slate-900"> {r.label}</span>}
                </p>
                <p className="text-xs text-slate-400" title={new Date(r.at).toLocaleString()}>
                  {ago(r.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
