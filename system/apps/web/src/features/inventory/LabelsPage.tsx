import { useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { AsyncSelect, Button, Card, EmptyState, Field, Icon, NumberInput, PageHeader, toast } from '@/components/ui';
import { previewFile } from '@/components/ui/preview';
import { ScanInput } from './ScanInput';

interface Found {
  id: string;
  code: string;
  name: string;
  barcode: string | null;
  uom: string | null;
  salePrice: number;
  onHand: number;
  stock: { warehouse: string; qty: number }[];
}

/** Inventory > Barcode Labels: find products by scanning, check their stock, print label sheets (Code 128) */
export default function LabelsPage() {
  const [items, setItems] = useState<{ p: Found; copies: string }[]>([]);
  const [last, setLast] = useState<Found | null>(null);
  const [price, setPrice] = useState(true);
  const add = (p: Found) => {
    setLast(p);
    setItems((xs) => (xs.some((x) => x.p.id === p.id) ? xs : [...xs, { p, copies: '1' }]));
  };
  const scan = async (code: string) => {
    try {
      add(await api.get<Found>('/inventory/lookup', { code }));
    } catch (e) {
      toast.error(e);
    }
  };
  const pick = (id: string | null) => {
    if (id) void scan(id);
  };
  const print = () => {
    const ids = items.flatMap((i) => Array.from({ length: Math.max(1, Math.min(100, Number(i.copies) || 1)) }, () => i.p.id));
    previewFile({ path: '/inventory/labels', params: { ids: ids.join(','), copies: 1, price: price ? 1 : 0 }, title: 'Barcode labels' }).catch((e) => toast.error(e));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Barcode Labels"
        subtitle="Scan or search products, check their stock and print Code 128 labels (A4, 3 x 8 labels of 70 x 37 mm)"
        actions={
          <Button icon="printer" disabled={!items.length} onClick={print}>
            Print labels
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Find a product" className="lg:col-span-1">
          <div className="space-y-3">
            <ScanInput onScan={scan} />
            <Field label="Or search">
              <AsyncSelect resource="products" value={null} onChange={(v) => pick(v)} placeholder="Search products" />
            </Field>
            {last && (
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-medium text-slate-900">{last.name}</p>
                <p className="text-xs text-slate-500">
                  {last.code}
                  {last.barcode ? ` · ${last.barcode}` : ' · no barcode (the code is printed)'}
                </p>
                <p className="mt-2 flex justify-between">
                  <span>Price</span>
                  <b className="tabular-nums">{fmtMoney(last.salePrice, 0)}</b>
                </p>
                <p className="flex justify-between">
                  <span>On hand</span>
                  <b className="tabular-nums">
                    {fmtNumber(last.onHand)} {last.uom ?? ''}
                  </b>
                </p>
                {last.stock.length > 1 && (
                  <ul className="mt-1 text-xs text-slate-500">
                    {last.stock.map((s) => (
                      <li key={s.warehouse} className="flex justify-between">
                        <span>{s.warehouse}</span>
                        <span className="tabular-nums">{fmtNumber(s.qty)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>
        <Card title="Labels to print" subtitle={items.length ? `${items.reduce((a, i) => a + (Number(i.copies) || 1), 0)} label(s)` : undefined} className="lg:col-span-2" bodyClass="p-0">
          {!items.length ? (
            <EmptyState icon="barcode" title="No products yet" description="Scan a barcode or search a product to add it." />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {items.map((i) => (
                  <li key={i.p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon name="barcode" className="h-5 w-5 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{i.p.name}</span>
                      <span className="block text-xs text-slate-500">{i.p.barcode ?? i.p.code}</span>
                    </span>
                    <div className="w-24">
                      <NumberInput decimals={0} min={1} max={100} value={i.copies} onChange={(v) => setItems((xs) => xs.map((x) => (x.p.id === i.p.id ? { ...x, copies: v } : x)))} aria-label={`Copies of ${i.p.name}`} />
                    </div>
                    <Button size="sm" variant="ghost" icon="x" onClick={() => setItems((xs) => xs.filter((x) => x.p.id !== i.p.id))} aria-label="Remove" />
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={price} onChange={(e) => setPrice(e.target.checked)} />
                Print the selling price
              </label>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
