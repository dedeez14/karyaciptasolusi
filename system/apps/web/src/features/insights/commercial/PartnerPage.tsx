import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtDate, isoDate, yearStart } from '@/lib/format';
import { download } from '@/lib/download';
import { useLookupOptions } from '@/hooks/useLookups';
import { useSession } from '@/stores/session';
import { Badge, Button, Card, cn, DatePicker, Icon, Pagination, StatusBadge, toast } from '@/components/ui';
import type { Row } from '@/features/resources/types';
import type { ReportResult } from '@/features/reports/reportTypes';
import { Avatar, DetailShell, DOC_LABEL, DocRef, InfoGrid, Kpi, Loading, LookupBadge, MiniBars, MiniTable, money, Muted, Progress, TabBar, useHashTab } from '../shared';

type Kind = 'customer' | 'supplier';
interface Summary {
  kpi: { outstanding: number; overdue: number; openInvoices: number; ytd: number; creditLimit: number | null } | null;
  trend: { month: string; amount: number }[] | null;
  counts: Record<string, number>;
  last: { id: string; date: string; number: string; docType: string } | null;
  types: string[];
  payments: { id: string; number: string; date: string; amount: number; status: string; reference: string | null }[] | null;
  activities: { id: string; subject: string; typeCode: string | null; dueDate: string | null; isDone: boolean }[] | null;
  opportunities:
    { id: string; code: string; name: string; amount: number; probability: number; expectedCloseDate: string | null; stage: { name: string; isWon: boolean; isLost: boolean } | null }[] | null;
  tickets: { id: string; code: string; subject: string; statusCode: string; priorityCode: string; createdAt: string; dueAt: string | null }[] | null;
}
interface Doc {
  id: string;
  docType: string;
  number: string;
  date: string;
  dueDate: string | null;
  status: string;
  currencyCode: string;
  grandTotal: number;
  paidAmount: number;
}

const TABS = ['overview', 'documents', 'payments', 'statement', 'crm', 'tickets'] as const;
type Tab = (typeof TABS)[number];

/** Customer / supplier 360°: balances, documents, payments, statement and relationship history */
export default function PartnerPage({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const can = useSession((s) => s.can);
  const resource = kind === 'customer' ? 'customers' : 'suppliers';
  return (
    <DetailShell
      key={`${kind}-${id}`}
      resource={resource}
      id={id}
      backTo={`/r/${resource}`}
      avatar={(r) => <Avatar name={r.name} size="xl" className="rounded-2xl" />}
      title={(r) => r.name}
      badges={(r) => (
        <>
          <span className="font-mono text-xs text-slate-400">{r.code}</span>
          <Badge tone={kind === 'customer' ? 'blue' : 'amber'}>{kind === 'customer' ? 'Customer' : 'Supplier'}</Badge>
          {r._labels?.groupId && <Badge tone="violet">{r._labels.groupId}</Badge>}
          {r._labels?.industryCode && <Badge>{r._labels.industryCode}</Badge>}
          {r.isActive === false && <Badge tone="red">Inactive</Badge>}
        </>
      )}
      actions={() =>
        kind === 'customer' ? (
          <>
            {can('sales.payment.create') && (
              <Link to={`/payments/in/new?partnerId=${id}`}>
                <Button variant="outline" icon="hand-coins">
                  Receive payment
                </Button>
              </Link>
            )}
            {can('sales.quotation.create') && (
              <Link to="/documents/SQ/new">
                <Button icon="plus">New quotation</Button>
              </Link>
            )}
          </>
        ) : (
          <>
            {can('purchase.payment.create') && (
              <Link to={`/payments/out/new?partnerId=${id}`}>
                <Button variant="outline" icon="banknote">
                  Pay supplier
                </Button>
              </Link>
            )}
            {can('purchase.order.create') && (
              <Link to="/documents/PO/new">
                <Button icon="plus">New purchase order</Button>
              </Link>
            )}
          </>
        )
      }
    >
      {(r) => <Body kind={kind} id={id} r={r} />}
    </DetailShell>
  );
}

function Body({ kind, id, r }: { kind: Kind; id: string; r: Row }) {
  const navigate = useNavigate();
  const can = useSession((s) => s.can);
  const [tab, setTab] = useHashTab<Tab>(TABS, 'overview');
  const base = kind === 'customer' ? 'customers' : 'suppliers';
  const q = useQuery({ queryKey: ['insights', base, id], queryFn: () => api.get<Summary>(`/insights/${base}/${id}`) });
  const act = useLookupOptions('ACTIVITY_TYPE');
  const tst = useLookupOptions('TICKET_STATUS');
  const tpr = useLookupOptions('TICKET_PRIORITY');
  const s = q.data;
  const k = s?.kpi;
  const stmtKey = kind === 'customer' ? 'customer-statement' : 'supplier-statement';
  const creditUse = k?.creditLimit ? (k.outstanding / k.creditLimit) * 100 : null;

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon="wallet"
          label={kind === 'customer' ? 'Receivable' : 'Payable'}
          value={k ? money(k.outstanding) : '—'}
          hint={k ? `${k.openInvoices} open ${kind === 'customer' ? 'invoices' : 'bills'}` : undefined}
        />
        <Kpi icon="alarm-clock" tone={k?.overdue ? 'red' : 'green'} label="Overdue" value={k ? money(k.overdue) : '—'} hint={k?.overdue ? 'Past due date' : 'Nothing overdue'} />
        <Kpi icon="trending-up" tone="violet" label={`${kind === 'customer' ? 'Sales' : 'Purchases'} this year`} value={k ? money(k.ytd) : '—'} />
        <Kpi
          icon="history"
          tone="amber"
          label="Last transaction"
          value={s?.last ? fmtDate(s.last.date) : '—'}
          hint={s?.last ? `${DOC_LABEL[s.last.docType] ?? s.last.docType} ${s.last.number}` : 'None yet'}
        />
      </div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'documents', label: 'Documents', count: s ? Object.values(s.counts).reduce((a, b) => a + b, 0) : null, hidden: s && !s.types.length },
          { value: 'payments', label: 'Payments', count: s?.payments?.length, hidden: s && !s.payments },
          { value: 'statement', label: 'Statement', hidden: !can(`report.${stmtKey}.view`) },
          { value: 'crm', label: 'Deals & activities', hidden: kind !== 'customer' || (s && !s.activities && !s.opportunities) },
          { value: 'tickets', label: 'Tickets', count: s?.tickets?.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.statusCode)).length || null, hidden: kind !== 'customer' || (s && !s.tickets) },
        ]}
      />
      {q.isLoading && tab !== 'overview' && tab !== 'statement' ? (
        <Loading />
      ) : tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Contact & terms" className="lg:col-span-1">
            <InfoGrid
              cols={1}
              items={[
                { label: 'Contact person', value: r.contactPerson ?? null },
                {
                  label: 'E-mail',
                  value: r.email ? (
                    <a className="text-brand-700 hover:underline" href={`mailto:${r.email}`}>
                      {r.email}
                    </a>
                  ) : null,
                },
                {
                  label: 'Phone',
                  value: r.phone ? (
                    <a className="text-brand-700 hover:underline" href={`tel:${r.phone}`}>
                      {r.phone}
                    </a>
                  ) : null,
                },
                { label: 'Address', value: [r.address, r.city, r._labels?.countryCode].filter(Boolean).join(', ') || null },
                { label: 'Tax ID', value: r.taxId ?? null },
                { label: 'Payment term', value: r._labels?.paymentTermId ?? null },
                ...(kind === 'supplier' ? [{ label: 'Bank account', value: [r.bankName, r.bankAccountNo].filter(Boolean).join(' · ') || null }] : []),
                { label: 'Notes', value: r.notes ?? null },
              ]}
            />
          </Card>
          <div className="space-y-4 lg:col-span-2">
            {s?.trend && (
              <Card title={`${kind === 'customer' ? 'Invoiced' : 'Billed'} per month`} subtitle="Last 12 months, in company currency">
                <MiniBars data={s.trend.map((t) => ({ label: t.month, value: t.amount }))} height={96} />
                <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                  <span>{s.trend[0]?.month}</span>
                  <span>{s.trend[s.trend.length - 1]?.month}</span>
                </div>
              </Card>
            )}
            {kind === 'customer' && k?.creditLimit ? (
              <Card title="Credit limit">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-slate-600">
                    {money(k.outstanding)} of {money(k.creditLimit)}
                  </span>
                  <span className={cn('font-semibold', (creditUse ?? 0) > 100 ? 'text-red-600' : 'text-slate-700')}>{Math.round(creditUse ?? 0)}%</span>
                </div>
                <Progress value={creditUse ?? 0} tone={(creditUse ?? 0) > 100 ? 'red' : (creditUse ?? 0) > 80 ? 'amber' : 'green'} />
              </Card>
            ) : null}
            {s && s.types.length > 0 && (
              <Card title="Documents">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {s.types.map((t) => (
                    <Link key={t} to={`/documents/${t}?f.partnerId=${id}`} className="rounded-xl border border-line p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                      <p className="text-xs text-slate-500">{DOC_LABEL[t] ?? t}</p>
                      <p className="text-lg font-semibold text-slate-900">{s.counts[t] ?? 0}</p>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : tab === 'documents' && s ? (
        <DocumentsTab base={base} id={id} types={s.types} counts={s.counts} />
      ) : tab === 'payments' && s?.payments ? (
        <Card title="Payments" bodyClass="px-5 py-2">
          <MiniTable
            rows={s.payments}
            empty="No payments yet"
            onRow={(p) => navigate(`/payments/${kind === 'customer' ? 'in' : 'out'}/${p.id}`)}
            cols={[
              { header: 'Number', render: (p) => <span className="font-medium text-brand-700">{p.number}</span> },
              { header: 'Date', render: (p) => fmtDate(p.date) },
              { header: 'Reference', render: (p) => p.reference ?? '—' },
              { header: 'Amount', align: 'right', render: (p) => money(p.amount) },
              { header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            ]}
          />
        </Card>
      ) : tab === 'statement' ? (
        <StatementTab reportKey={stmtKey} param={kind === 'customer' ? 'customerId' : 'supplierId'} id={id} />
      ) : tab === 'crm' && s ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {s.opportunities && (
            <Card
              title="Opportunities"
              bodyClass="px-5 py-2"
              actions={
                <Link to="/crm/pipeline" className="text-xs font-medium text-brand-700 hover:underline">
                  Pipeline
                </Link>
              }
            >
              <MiniTable
                rows={s.opportunities}
                empty="No opportunities"
                cols={[
                  { header: 'Deal', render: (o) => <span className="font-medium text-slate-800">{o.name}</span> },
                  { header: 'Stage', render: (o) => (o.stage ? <Badge tone={o.stage.isWon ? 'green' : o.stage.isLost ? 'red' : 'blue'}>{o.stage.name}</Badge> : '—') },
                  { header: 'Close', render: (o) => (o.expectedCloseDate ? fmtDate(o.expectedCloseDate) : '—') },
                  { header: 'Amount', align: 'right', render: (o) => money(o.amount) },
                ]}
              />
            </Card>
          )}
          {s.activities && (
            <Card
              title="Activities"
              bodyClass="px-5 py-2"
              actions={
                <Link to="/r/crm-activities" className="text-xs font-medium text-brand-700 hover:underline">
                  All activities
                </Link>
              }
            >
              <MiniTable
                rows={s.activities}
                empty="No activities"
                cols={[
                  { header: '', render: (a) => <Icon name={a.isDone ? 'check-circle-2' : 'circle'} className={cn('h-4 w-4', a.isDone ? 'text-emerald-500' : 'text-slate-300')} /> },
                  { header: 'Subject', render: (a) => <span className={cn(a.isDone && 'text-slate-400 line-through')}>{a.subject}</span> },
                  { header: 'Type', render: (a) => <LookupBadge options={act} value={a.typeCode} /> },
                  { header: 'Due', render: (a) => (a.dueDate ? fmtDate(a.dueDate) : '—') },
                ]}
              />
            </Card>
          )}
        </div>
      ) : tab === 'tickets' && s?.tickets ? (
        <Card title="Support tickets" bodyClass="px-5 py-2">
          <MiniTable
            rows={s.tickets}
            empty="No tickets"
            onRow={(t) => navigate(`/helpdesk/tickets/${t.id}`)}
            cols={[
              { header: 'Code', render: (t) => <span className="font-mono text-xs text-brand-700">{t.code}</span> },
              { header: 'Subject', render: (t) => t.subject },
              { header: 'Priority', render: (t) => <LookupBadge options={tpr} value={t.priorityCode} /> },
              { header: 'Status', render: (t) => <LookupBadge options={tst} value={t.statusCode} /> },
              { header: 'Opened', render: (t) => fmtDate(t.createdAt) },
            ]}
          />
        </Card>
      ) : (
        <Muted>Nothing to show.</Muted>
      )}
    </div>
  );
}

function DocumentsTab({ base, id, types, counts }: { base: string; id: string; types: string[]; counts: Record<string, number> }) {
  const navigate = useNavigate();
  const [docType, setDocType] = useState<string>('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['insights', base, id, 'docs', docType, page],
    queryFn: () => api.get<Paged<Doc>>(`/insights/${base}/${id}/documents`, { docType: docType || undefined, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const today = isoDate();
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
        {['', ...types].map((t) => (
          <button
            key={t || 'all'}
            type="button"
            onClick={() => {
              setDocType(t);
              setPage(1);
            }}
            className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors', docType === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
          >
            {t ? (DOC_LABEL[t] ?? t) : 'All'} <span className="opacity-70">{t ? (counts[t] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0)}</span>
          </button>
        ))}
      </div>
      <div className="px-5 py-2">
        {q.isLoading ? (
          <Loading />
        ) : (
          <MiniTable
            rows={q.data?.data ?? []}
            empty="No documents"
            onRow={(d) => navigate(`/documents/${d.docType}/${d.id}`)}
            cols={[
              { header: 'Number', render: (d) => <DocRef type={d.docType} id={d.id} number={d.number} /> },
              { header: 'Type', render: (d) => DOC_LABEL[d.docType] ?? d.docType },
              { header: 'Date', render: (d) => fmtDate(d.date) },
              {
                header: 'Due',
                render: (d) =>
                  d.dueDate ? (
                    <span className={cn(['CONFIRMED', 'PARTIAL'].includes(d.status) && d.dueDate.slice(0, 10) < today && d.grandTotal > d.paidAmount && 'font-medium text-red-600')}>
                      {fmtDate(d.dueDate)}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              { header: 'Total', align: 'right', render: (d) => `${d.currencyCode} ${money(d.grandTotal)}` },
              { header: 'Open', align: 'right', render: (d) => (['SI', 'PI'].includes(d.docType) && d.status !== 'CANCELLED' ? money(d.grandTotal - d.paidAmount) : '') },
              { header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
            ]}
          />
        )}
      </div>
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={20} onPage={setPage} />}
    </Card>
  );
}

function StatementTab({ reportKey, param, id }: { reportKey: string; param: string; id: string }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(isoDate());
  const params = { [param]: id, from, to };
  const q = useQuery({ queryKey: ['report', reportKey, params], queryFn: () => api.get<ReportResult>(`/reports/${reportKey}`, params) });
  const rows = q.data?.rows ?? [];
  const closing = rows.length ? Number(rows[rows.length - 1].balance ?? 0) : 0;
  const exportAs = async (format: string) => {
    try {
      await download(`/reports/${reportKey}/export`, { ...params, format });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card
      title="Statement of account"
      subtitle={q.data?.subtitle}
      actions={
        <>
          <Button size="sm" variant="outline" icon="file" onClick={() => exportAs('pdf')}>
            PDF
          </Button>
          <Button size="sm" variant="outline" icon="file-spreadsheet" onClick={() => exportAs('xlsx')}>
            Excel
          </Button>
        </>
      }
      bodyClass="px-5 py-3"
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="label">From</label>
          <DatePicker value={from} onChange={(v) => v && setFrom(v)} clearable={false} />
        </div>
        <div className="w-44">
          <label className="label">To</label>
          <DatePicker value={to} onChange={(v) => v && setTo(v)} clearable={false} />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-500">Closing balance</p>
          <p className={cn('text-xl font-semibold tabular-nums', closing > 0 ? 'text-slate-900' : 'text-emerald-600')}>{money(closing)}</p>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : (
        <MiniTable
          rows={rows}
          empty="No entries in this period"
          cols={[
            { header: 'Date', render: (x) => fmtDate(x.date) },
            { header: 'Document', render: (x) => String(x.doc ?? '') },
            { header: 'Description', render: (x) => String(x.desc ?? '') },
            { header: q.data?.columns.find((c) => c.key === 'charge')?.label ?? 'Charge', align: 'right', render: (x) => (Number(x.charge) ? money(x.charge) : '') },
            { header: q.data?.columns.find((c) => c.key === 'payment')?.label ?? 'Payment', align: 'right', render: (x) => (Number(x.payment) ? money(x.payment) : '') },
            { header: 'Balance', align: 'right', render: (x) => <span className="font-medium">{money(x.balance)}</span> },
          ]}
        />
      )}
    </Card>
  );
}
