import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtNumber } from '@/lib/format';
import { Badge, Card, cn } from '@/components/ui';
import type { Row } from '@/features/resources/types';
import { DetailShell, DocRef, InfoGrid, Kpi, Loading, MiniTable, money, Muted, TabBar, useHashTab } from '../shared';

interface History {
  ytdQty: number;
  ytdAmount: number;
  lines: { documentId: string; number: string; date: string; partner: string | null; qty: number; unitPrice: number; total: number; currency: string }[];
}
interface Overview {
  stock: { onHand: number; value: number; minStock: number; warehouses: { warehouseId: string; warehouse: string; qty: number; avgCost: number; value: number }[] } | null;
  movements: { id: string; date: string; warehouse: string; qty: number; unitCost: number; balanceQty: number; docType: string; documentId: string | null; documentNumber: string | null }[] | null;
  sales: History | null;
  purchases: History | null;
}

const TABS = ['overview', 'stock', 'sales', 'purchases'] as const;
type Tab = (typeof TABS)[number];

/** Product 360°: prices, stock per warehouse, movements, sales and purchase history */
export default function ProductPage() {
  const { id = '' } = useParams();
  return (
    <DetailShell
      resource="products"
      id={id}
      backTo="/r/products"
      avatar={(r) => (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-violet-100 text-xl font-semibold text-brand-700">
          {String(r.name ?? '?')
            .slice(0, 1)
            .toUpperCase()}
        </span>
      )}
      title={(r) => r.name}
      badges={(r) => (
        <>
          <span className="font-mono text-xs text-slate-400">{r.code}</span>
          <Badge tone="blue">{r._labels?.type ?? r.type}</Badge>
          {r._labels?.categoryId && <Badge tone="violet">{r._labels.categoryId}</Badge>}
          {r._labels?.brandId && <Badge>{r._labels.brandId}</Badge>}
          {r.isActive === false && <Badge tone="red">Inactive</Badge>}
        </>
      )}
    >
      {(r) => <Body id={id} r={r} />}
    </DetailShell>
  );
}

function Body({ id, r }: { id: string; r: Row }) {
  const navigate = useNavigate();
  const [tab, setTab] = useHashTab<Tab>(TABS, 'overview');
  const q = useQuery({ queryKey: ['insights', 'product', id], queryFn: () => api.get<Overview>(`/insights/products/${id}`) });
  const o = q.data;
  const isStock = r.type === 'STOCK';
  const low = o?.stock && isStock && o.stock.minStock > 0 && o.stock.onHand <= o.stock.minStock;
  const margin = Number(r.salePrice) > 0 ? ((Number(r.salePrice) - Number(r.purchasePrice)) / Number(r.salePrice)) * 100 : null;

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon="tag" label="Sale price" value={money(r.salePrice)} hint={margin !== null ? `${margin.toFixed(1)}% margin on purchase price` : undefined} />
        <Kpi
          icon="boxes"
          tone={low ? 'red' : 'green'}
          label="On hand"
          value={o?.stock && isStock ? `${fmtNumber(o.stock.onHand)} ${r._labels?.uomId ?? ''}` : '—'}
          hint={low ? `Below minimum (${fmtNumber(o!.stock!.minStock)})` : o?.stock && isStock ? `Value ${money(o.stock.value)}` : isStock ? undefined : 'Not a stock item'}
        />
        <Kpi icon="trending-up" tone="violet" label="Sold this year" value={o?.sales ? fmtNumber(o.sales.ytdQty) : '—'} hint={o?.sales ? money(o.sales.ytdAmount) : undefined} />
        <Kpi icon="shopping-bag" tone="amber" label="Bought this year" value={o?.purchases ? fmtNumber(o.purchases.ytdQty) : '—'} hint={o?.purchases ? money(o.purchases.ytdAmount) : undefined} />
      </div>
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Details' },
          { value: 'stock', label: 'Stock', hidden: !isStock || (o && !o.stock) },
          { value: 'sales', label: 'Sales history', hidden: o && !o.sales },
          { value: 'purchases', label: 'Purchase history', hidden: o && !o.purchases },
        ]}
      />
      {q.isLoading && tab !== 'overview' ? (
        <Loading />
      ) : tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Product" className="lg:col-span-2">
            <InfoGrid
              items={[
                { label: 'Type', value: r._labels?.type ?? r.type },
                { label: 'Unit', value: r._labels?.uomId ?? null },
                { label: 'Category', value: r._labels?.categoryId ?? null },
                { label: 'Brand', value: r._labels?.brandId ?? null },
                { label: 'Barcode', value: r.barcode ?? null },
                { label: 'Minimum stock', value: r.minStock !== undefined && r.minStock !== null ? fmtNumber(r.minStock) : null },
                { label: 'Sellable', value: r.isSellable ? 'Yes' : 'No' },
                { label: 'Purchasable', value: r.isPurchasable ? 'Yes' : 'No' },
                { label: 'Description', value: r.description ?? null, wide: true },
              ]}
            />
          </Card>
          <Card title="Pricing & accounts">
            <InfoGrid
              cols={1}
              items={[
                { label: 'Sale price', value: money(r.salePrice) },
                { label: 'Purchase price', value: money(r.purchasePrice) },
                { label: 'Sales tax', value: r._labels?.saleTaxId ?? null },
                { label: 'Purchase tax', value: r._labels?.purchaseTaxId ?? null },
                { label: 'Income account', value: r._labels?.incomeAccountId ?? null },
                { label: 'Expense account', value: r._labels?.expenseAccountId ?? null },
              ]}
            />
          </Card>
        </div>
      ) : tab === 'stock' && o?.stock ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card title="By warehouse" className="lg:col-span-2" bodyClass="px-5 py-2">
            <MiniTable
              rows={o.stock.warehouses}
              empty="No stock yet"
              cols={[
                { header: 'Warehouse', render: (w) => w.warehouse },
                { header: 'Qty', align: 'right', render: (w) => fmtNumber(w.qty) },
                { header: 'Avg cost', align: 'right', render: (w) => money(w.avgCost) },
                { header: 'Value', align: 'right', render: (w) => money(w.value) },
              ]}
            />
          </Card>
          <Card title="Recent movements" className="lg:col-span-3" bodyClass="px-5 py-2">
            <MiniTable
              rows={o.movements ?? []}
              empty="No movements yet"
              cols={[
                { header: 'Date', render: (m) => fmtDate(m.date) },
                { header: 'Document', render: (m) => (m.documentId && m.documentNumber ? <DocRef type={m.docType} id={m.documentId} number={m.documentNumber} /> : (m.documentNumber ?? m.docType)) },
                { header: 'Warehouse', render: (m) => m.warehouse },
                {
                  header: 'Qty',
                  align: 'right',
                  render: (m) => (
                    <span className={cn('font-medium', m.qty < 0 ? 'text-red-600' : 'text-emerald-700')}>
                      {m.qty > 0 ? '+' : ''}
                      {fmtNumber(m.qty)}
                    </span>
                  ),
                },
                { header: 'Balance', align: 'right', render: (m) => fmtNumber(m.balanceQty) },
              ]}
            />
          </Card>
        </div>
      ) : (tab === 'sales' && o?.sales) || (tab === 'purchases' && o?.purchases) ? (
        <Card title={tab === 'sales' ? 'Latest invoices' : 'Latest bills'} bodyClass="px-5 py-2">
          <MiniTable
            rows={(tab === 'sales' ? o!.sales! : o!.purchases!).lines}
            empty="No history yet"
            onRow={(l) => navigate(`/documents/${tab === 'sales' ? 'SI' : 'PI'}/${l.documentId}`)}
            cols={[
              { header: 'Document', render: (l) => <span className="font-medium text-brand-700">{l.number}</span> },
              { header: 'Date', render: (l) => fmtDate(l.date) },
              { header: tab === 'sales' ? 'Customer' : 'Supplier', render: (l) => l.partner ?? '—' },
              { header: 'Qty', align: 'right', render: (l) => fmtNumber(l.qty) },
              { header: 'Unit price', align: 'right', render: (l) => money(l.unitPrice) },
              { header: 'Total', align: 'right', render: (l) => `${l.currency} ${money(l.total)}` },
            ]}
          />
        </Card>
      ) : (
        <Muted>Nothing to show.</Muted>
      )}
    </div>
  );
}
