import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, EmptyState, Icon, NumberInput, PageHeader, Spinner, toast } from '@/components/ui';

interface Suggestion {
  productId: string;
  code: string;
  name: string;
  uom: string | null;
  onHand: number;
  onOrder: number;
  reserved: number;
  available: number;
  minStock: number;
  maxStock: number;
  reorderQty: number;
  leadTimeDays: number;
  suggested: number;
  unitPrice: number;
  supplierId: string | null;
  supplierName: string | null;
}
type Pick = { on: boolean; qty: string; supplierId: string | null };

/** Inventory > Reorder Planner: what to buy, grouped by supplier, turned into draft purchase orders */
export default function ReorderPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const q = useQuery({ queryKey: ['inventory', 'reorder', warehouseId], queryFn: () => api.get<Suggestion[]>('/inventory/reorder', warehouseId ? { warehouseId } : undefined) });

  useEffect(() => {
    setPicks(Object.fromEntries((q.data ?? []).map((s) => [s.productId, { on: !!s.supplierId, qty: String(s.suggested), supplierId: s.supplierId }])));
  }, [q.data]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: Suggestion[] }>();
    for (const s of q.data ?? []) {
      const sid = picks[s.productId]?.supplierId ?? s.supplierId ?? '';
      const key = sid || '__none';
      const g = m.get(key) ?? { name: sid === s.supplierId ? s.supplierName ?? 'Supplier' : sid ? 'Chosen supplier' : 'No supplier yet', rows: [] };
      g.rows.push(s);
      m.set(key, g);
    }
    return [...m.entries()].sort((a, b) => (a[0] === '__none' ? 1 : b[0] === '__none' ? -1 : a[1].name.localeCompare(b[1].name)));
  }, [q.data, picks]);

  const chosen = (q.data ?? []).filter((s) => picks[s.productId]?.on && picks[s.productId]?.supplierId && Number(picks[s.productId]?.qty) > 0);
  const total = chosen.reduce((a, s) => a + Number(picks[s.productId].qty) * s.unitPrice, 0);
  const create = useMutation({
    mutationFn: () => api.post<{ created: { id: string; number: string }[] }>('/inventory/reorder/purchase-orders', { warehouseId, lines: chosen.map((s) => ({ productId: s.productId, supplierId: picks[s.productId].supplierId, qty: Number(picks[s.productId].qty) })) }),
    onSuccess: (r) => {
      toast.success(`${r.created.length} draft purchase order(s): ${r.created.map((c) => c.number).join(', ')}`);
      qc.invalidateQueries({ queryKey: ['inventory', 'reorder'] });
    },
    onError: (e) => toast.error(e),
  });
  const set = (id: string, p: Partial<Pick>) => setPicks((x) => ({ ...x, [id]: { ...x[id], ...p } }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reorder Planner"
        subtitle="Products at or below their reorder point, counting goods already ordered and promised to customers"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-56">
              <AsyncSelect resource="warehouses" value={warehouseId} onChange={(v) => setWarehouseId(v)} placeholder="All warehouses" />
            </div>
            {can('purchase.order.create') && (
              <Button icon="file-plus" loading={create.isPending} disabled={!chosen.length} onClick={() => create.mutate()}>
                Create {chosen.length ? `${new Set(chosen.map((s) => picks[s.productId].supplierId)).size} ` : ''}draft PO
              </Button>
            )}
          </div>
        }
      />
      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon="package-check" title="Nothing to reorder" description="Set a minimum stock (reorder point), and optionally a maximum stock, reorder quantity and usual supplier, on the products you keep in stock." />
      ) : (
        <>
          {chosen.length > 0 && (
            <p className="text-sm text-slate-600">
              {chosen.length} product(s) selected · estimated <b className="tabular-nums">{fmtMoney(total, 0)}</b> before tax
            </p>
          )}
          {groups.map(([key, g]) => (
            <Card key={key} title={key === '__none' ? 'No supplier yet' : g.name} subtitle={key === '__none' ? 'Choose a supplier per product, or set the usual supplier on the product' : `${g.rows.length} product(s)`} bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-3 py-2 text-left font-semibold">Product</th>
                      <th className="px-3 py-2 text-right font-semibold">On hand</th>
                      <th className="px-3 py-2 text-right font-semibold">On order</th>
                      <th className="px-3 py-2 text-right font-semibold">Reserved</th>
                      <th className="px-3 py-2 text-right font-semibold">Min / Max</th>
                      <th className="px-3 py-2 text-left font-semibold">Supplier</th>
                      <th className="px-3 py-2 text-right font-semibold">Order qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((s) => {
                      const p = picks[s.productId] ?? { on: false, qty: '', supplierId: null };
                      return (
                        <tr key={s.productId} className="border-t border-line">
                          <td className="px-3 py-2">
                            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={p.on} onChange={(e) => set(s.productId, { on: e.target.checked })} aria-label={`Order ${s.name}`} />
                          </td>
                          <td className="min-w-60 px-3 py-2">
                            <Link to={`/products/${s.productId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                              {s.name}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {s.code} · available{' '}
                              <span className={s.available <= 0 ? 'font-medium text-red-600' : 'font-medium text-amber-600'}>
                                {fmtNumber(s.available)} {s.uom ?? ''}
                              </span>
                              {s.leadTimeDays ? ` · lead time ${s.leadTimeDays} days` : ''}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(s.onHand)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.onOrder ? fmtNumber(s.onOrder) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.reserved ? fmtNumber(s.reserved) : '—'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                            {fmtNumber(s.minStock)} / {s.maxStock ? fmtNumber(s.maxStock) : '—'}
                          </td>
                          <td className="min-w-48 px-3 py-2">
                            <AsyncSelect resource="suppliers" value={p.supplierId} onChange={(v) => set(s.productId, { supplierId: v, on: !!v })} placeholder="Choose supplier" className="h-8 text-xs" />
                          </td>
                          <td className="w-32 px-3 py-2">
                            <NumberInput decimals={4} min={0} value={p.qty} onChange={(v) => set(s.productId, { qty: v })} className="h-8 text-right" aria-label={`Quantity for ${s.name}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Suggested quantity: up to the maximum stock (or reorder point + reorder quantity), at least the reorder quantity. Purchase orders are created as drafts at the product&apos;s purchase price, so you can check them before confirming.
          </p>
        </>
      )}
      {!can('purchase.order.create') && <Badge tone="gray">You can view suggestions; creating purchase orders needs purchase permission.</Badge>}
    </div>
  );
}
