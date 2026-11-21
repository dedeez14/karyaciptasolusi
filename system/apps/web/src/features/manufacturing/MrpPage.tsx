import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/stores/session';
import { AsyncSelect, Badge, Button, Card, Checkbox, EmptyState, PageHeader, Spinner, toast } from '@/components/ui';
import { cn } from '@/components/ui/primitives';

interface Suggestion {
  productId: string;
  code: string;
  name: string;
  uom: string;
  action: 'MAKE' | 'BUY';
  qty: number;
  needBy: string;
  startBy: string;
  late: boolean;
  demand: number;
  safety: number;
  onHand: number;
  held: number;
  onOrder: number;
  supplierId: string | null;
  supplierName: string | null;
  unitPrice: number;
  sources: string[];
}

/** Material requirements planning: what to make and to buy, and when, from orders, work orders and safety stock */
export default function MrpPage() {
  const qc = useQueryClient();
  const can = useSession((s) => s.can);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = useQuery({ queryKey: ['mfg', 'mrp', warehouseId], queryFn: () => api.get<{ generatedAt: string; suggestions: Suggestion[] }>('/manufacturing/mrp', warehouseId ? { warehouseId } : undefined) });
  const rows = useMemo(() => q.data?.suggestions ?? [], [q.data]);
  const chosen = rows.filter((r) => picked.has(r.productId));
  const make = chosen.filter((r) => r.action === 'MAKE');
  const buy = chosen.filter((r) => r.action === 'BUY');
  const after = (msg: string) => {
    toast.success(msg);
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: ['mfg'] });
  };
  const createWo = useMutation({ mutationFn: () => api.post<{ created: string[] }>('/manufacturing/mrp/work-orders', { warehouseId, lines: make.map((r) => ({ productId: r.productId, qty: r.qty, date: r.startBy })) }), onSuccess: (r) => after(`Work orders ${r.created.join(', ')} created (draft)`), onError: (e) => toast.error(e) });
  const createPo = useMutation({ mutationFn: () => api.post<{ created: { number: string }[] }>('/inventory/reorder/purchase-orders', { warehouseId, lines: buy.filter((r) => r.supplierId).map((r) => ({ productId: r.productId, supplierId: r.supplierId, qty: r.qty })) }), onSuccess: (r) => after(`Purchase orders ${r.created.map((x) => x.number).join(', ')} created (draft)`), onError: (e) => toast.error(e) });
  const noSupplier = buy.filter((r) => !r.supplierId);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Material Planning (MRP)"
        subtitle="Net requirements by bill of materials level: open sales orders, components of open work orders and safety stock, against stock released by quality control, purchase orders and production on the way"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="w-56">
              <AsyncSelect resource="warehouses" value={warehouseId} onChange={setWarehouseId} placeholder="All warehouses" />
            </div>
            <Button variant="outline" icon="refresh-cw" loading={q.isFetching} onClick={() => q.refetch()}>
              Recalculate
            </Button>
          </div>
        }
      />
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm">
          <span className="mr-auto">{chosen.length} selected</span>
          {make.length > 0 && can('manufacturing.order.create') && (
            <Button size="sm" icon="factory" loading={createWo.isPending} disabled={!warehouseId} title={!warehouseId ? 'Choose the warehouse first' : undefined} onClick={() => createWo.mutate()}>
              Create {make.length} work order(s)
            </Button>
          )}
          {buy.length > 0 && can('purchase.order.create') && (
            <Button size="sm" icon="shopping-bag" loading={createPo.isPending} disabled={buy.length === noSupplier.length} onClick={() => createPo.mutate()}>
              Create purchase orders ({buy.length - noSupplier.length})
            </Button>
          )}
          {!warehouseId && make.length > 0 && <span className="w-full text-xs text-amber-700">Choose the warehouse to produce in.</span>}
          {noSupplier.length > 0 && <span className="w-full text-xs text-amber-700">{noSupplier.map((r) => r.name).join(', ')}: no usual supplier on the product.</span>}
        </div>
      )}
      <Card bodyClass="p-0">
        {q.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon="calendar-range" title="Nothing to plan" description="Stock and orders on the way cover the open orders and safety stock" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <Checkbox checked={picked.size === rows.length} onChange={(v) => setPicked(v ? new Set(rows.map((r) => r.productId)) : new Set())} />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Product</th>
                  <th className="px-3 py-2 text-left font-semibold">Action</th>
                  <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                  <th className="px-3 py-2 text-left font-semibold">Start by</th>
                  <th className="px-3 py-2 text-left font-semibold">Needed by</th>
                  <th className="px-3 py-2 text-right font-semibold">Demand</th>
                  <th className="px-3 py-2 text-right font-semibold">On hand</th>
                  <th className="px-4 py-2 text-right font-semibold">On the way</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId} className={cn('border-t border-line align-top', picked.has(r.productId) && 'bg-brand-50/40')}>
                    <td className="px-4 py-2">
                      <Checkbox checked={picked.has(r.productId)} onChange={(v) => setPicked((s) => { const x = new Set(s); if (v) x.add(r.productId); else x.delete(r.productId); return x; })} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.name}</span> <span className="text-xs text-slate-500">{r.code}</span>
                      <span className="block text-xs text-slate-500">{r.sources.join(' · ')}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.action === 'MAKE' ? 'violet' : 'blue'}>{r.action === 'MAKE' ? 'Make' : 'Buy'}</Badge>
                      {r.action === 'BUY' && <span className="block text-xs text-slate-500">{r.supplierName ?? 'no supplier'}{r.unitPrice ? ` · ${fmtMoney(r.unitPrice * r.qty, 0)}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {fmtNumber(r.qty)} {r.uom}
                    </td>
                    <td className={cn('px-3 py-2', r.late && 'font-medium text-red-600')}>
                      {fmtDate(r.startBy)}
                      {r.late && <span className="block text-xs">late</span>}
                    </td>
                    <td className="px-3 py-2">{fmtDate(r.needBy)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNumber(r.demand)}
                      {r.safety ? <span className="block text-xs text-slate-500">+ safety {fmtNumber(r.safety)}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNumber(r.onHand)}
                      {r.held ? <span className="block text-xs text-amber-700">{fmtNumber(r.held)} on QC hold</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtNumber(r.onOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">Quantities respect each product&apos;s reorder quantity as a minimum. Start dates are the need date minus the product lead time. Created orders are drafts: review, then release / confirm them.</p>
    </div>
  );
}
