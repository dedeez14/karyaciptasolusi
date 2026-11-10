import type { Dispatch, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { AsyncSelect, Button, Input } from '@/components/ui';
import type { DocLine, DocTypeDef } from './useDocTypes';

export interface EditLine {
  key: string;
  productId: string | null;
  description: string;
  qty: string;
  uomId: string | null;
  unitPrice: string;
  discountPct: string;
  taxId: string | null;
  sourceLineId: string | null;
}

let seq = 0;
export const newLine = (): EditLine => ({ key: `n${++seq}`, productId: null, description: '', qty: '1', uomId: null, unitPrice: '', discountPct: '0', taxId: null, sourceLineId: null });
export const fromDocLine = (l: DocLine): EditLine => ({
  key: l.id ?? `n${++seq}`,
  productId: l.productId,
  description: l.description ?? '',
  qty: String(Number(l.qty)),
  uomId: l.uomId,
  unitPrice: String(Number(l.unitPrice)),
  discountPct: String(Number(l.discountPct)),
  taxId: l.taxId,
  sourceLineId: l.sourceLineId ?? null,
});

/** Tax rates by id. Uses the tax list when permitted, otherwise parses the rate from the option label. */
export function useTaxRates() {
  const q = useQuery({
    queryKey: ['tax-rates'],
    queryFn: async () => {
      try {
        const r = await api.get<Paged<{ id: string; rate: string }>>('/resources/taxes', { pageSize: 200 });
        return Object.fromEntries(r.data.map((t) => [t.id, Number(t.rate)]));
      } catch {
        const opts = await api.get<{ value: string; label: string }[]>('/resources/taxes/options');
        return Object.fromEntries(opts.map((o) => [o.value, Number(/([\d.]+)\s*%/.exec(o.label)?.[1] ?? 0)]));
      }
    },
    staleTime: 5 * 60_000,
  });
  return q.data ?? {};
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeLine(l: EditLine, rates: Record<string, number>, priced: boolean) {
  const sub = round2(n(l.qty) * n(l.unitPrice));
  const disc = priced ? round2((sub * n(l.discountPct)) / 100) : 0;
  const tax = priced && l.taxId ? round2(((sub - disc) * (rates[l.taxId] ?? 0)) / 100) : 0;
  return { sub, disc, tax, net: sub - disc, total: sub - disc + tax };
}

export function computeTotals(lines: EditLine[], rates: Record<string, number>, priced: boolean) {
  return lines.reduce(
    (a, l) => {
      const c = computeLine(l, rates, priced);
      return { subtotal: a.subtotal + c.sub, discount: a.discount + c.disc, tax: a.tax + c.tax, total: a.total + c.total };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
}

interface ProductDetail {
  id: string;
  name: string;
  uomId: string | null;
  salePrice: string;
  purchasePrice: string;
  saleTaxId: string | null;
  purchaseTaxId: string | null;
}

export function LineEditor({ def, lines, onChange, errors }: { def: DocTypeDef; lines: EditLine[]; onChange: Dispatch<SetStateAction<EditLine[]>>; errors?: Record<string, string> }) {
  const rates = useTaxRates();
  const priced = def.priced;
  const allowNegative = def.stock === 'adjust';

  const update = (key: string, patch: Partial<EditLine>) => onChange((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange((ls) => ls.filter((l) => l.key !== key));

  const pickProduct = async (key: string, productId: string | null, label?: string) => {
    if (!productId) return update(key, { productId: null });
    update(key, { productId, description: label?.replace(/^[^-]+ - /, '') ?? '' });
    try {
      const p = await api.get<ProductDetail>(`/resources/products/${productId}`);
      const price = def.priceField ? p[def.priceField] : priced ? p.salePrice : '0';
      update(key, {
        productId,
        description: p.name,
        uomId: p.uomId,
        unitPrice: priced || def.stock === 'adjust' ? String(Number(price ?? 0)) : '0',
        taxId: def.taxField ? p[def.taxField] : null,
      });
    } catch {
      /* no product read permission: keep the selection, server fills defaults */
    }
  };

  const err = (i: number, f: string) => errors?.[`lines.${i}.${f}`];

  return (
    <div>
      {/* desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1000px] text-sm [&_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase dark:border-slate-800">
              <th className="w-8 px-2 py-2">#</th>
              <th className="min-w-72 px-2 py-2">Product / Description</th>
              <th className="w-24 min-w-24 px-2 py-2 text-right">Qty</th>
              <th className="w-32 min-w-32 px-2 py-2">Unit</th>
              {(priced || allowNegative) && <th className="w-40 min-w-40 px-2 py-2 text-right">{priced ? 'Unit Price' : 'Unit Cost'}</th>}
              {priced && <th className="w-24 min-w-24 px-2 py-2 text-right">Disc %</th>}
              {priced && def.taxField && <th className="w-48 min-w-48 px-2 py-2">Tax</th>}
              {priced && <th className="w-36 min-w-36 px-2 py-2 text-right">Amount</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = computeLine(l, rates, priced);
              return (
                <tr key={l.key} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                  <td className="space-y-1 px-2 py-2">
                    <AsyncSelect resource="products" value={l.productId} onChange={(v, o) => pickProduct(l.key, v, o?.label)} placeholder="Select product..." disabled={!!l.sourceLineId} />
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="Description" maxLength={1000} invalid={!!err(i, 'description')} />
                  </td>
                  <td className="px-2 py-2">
                    <Input type="number" inputMode="decimal" step="any" min={allowNegative ? undefined : 0} className="text-right" value={l.qty} invalid={!!err(i, 'qty')} onChange={(e) => update(l.key, { qty: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <AsyncSelect resource="uoms" value={l.uomId} onChange={(v) => update(l.key, { uomId: v })} placeholder="Unit" />
                  </td>
                  {(priced || allowNegative) && (
                    <td className="px-2 py-2">
                      <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                    </td>
                  )}
                  {priced && (
                    <td className="px-2 py-2">
                      <Input type="number" inputMode="decimal" step="any" min={0} max={100} className="text-right" value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                    </td>
                  )}
                  {priced && def.taxField && (
                    <td className="px-2 py-2">
                      <AsyncSelect resource="taxes" value={l.taxId} onChange={(v) => update(l.key, { taxId: v })} placeholder="No tax" />
                    </td>
                  )}
                  {priced && <td className="px-2 py-2 pt-4 text-right font-medium tabular-nums">{fmtMoney(c.net)}</td>}
                  <td className="px-1 py-2">
                    <Button variant="ghost" size="icon" icon="trash-2" className="text-red-500" onClick={() => remove(l.key)} disabled={lines.length <= 1} aria-label="Remove line" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="space-y-3 md:hidden">
        {lines.map((l, i) => {
          const c = computeLine(l, rates, priced);
          return (
            <div key={l.key} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">Line {i + 1}</span>
                <Button variant="ghost" size="icon" icon="trash-2" className="text-red-500" onClick={() => remove(l.key)} disabled={lines.length <= 1} aria-label="Remove line" />
              </div>
              <AsyncSelect resource="products" value={l.productId} onChange={(v, o) => pickProduct(l.key, v, o?.label)} placeholder="Select product..." disabled={!!l.sourceLineId} />
              <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="Description" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Qty</label>
                  <Input type="number" inputMode="decimal" step="any" className="text-right" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                </div>
                <div>
                  <label className="label">Unit</label>
                  <AsyncSelect resource="uoms" value={l.uomId} onChange={(v) => update(l.key, { uomId: v })} placeholder="Unit" />
                </div>
                {(priced || allowNegative) && (
                  <div>
                    <label className="label">{priced ? 'Unit price' : 'Unit cost'}</label>
                    <Input type="number" inputMode="decimal" step="0.01" className="text-right" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                  </div>
                )}
                {priced && (
                  <div>
                    <label className="label">Disc %</label>
                    <Input type="number" inputMode="decimal" step="any" className="text-right" value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                  </div>
                )}
                {priced && def.taxField && (
                  <div className="col-span-2">
                    <label className="label">Tax</label>
                    <AsyncSelect resource="taxes" value={l.taxId} onChange={(v) => update(l.key, { taxId: v })} placeholder="No tax" />
                  </div>
                )}
              </div>
              {priced && <div className="text-right text-sm font-medium">Amount: {fmtMoney(c.net)}</div>}
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" icon="plus" className="mt-3" onClick={() => onChange((ls) => [...ls, newLine()])}>
        Add line
      </Button>
    </div>
  );
}
