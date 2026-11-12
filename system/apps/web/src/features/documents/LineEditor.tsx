import { useEffect, useRef, type CSSProperties, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { useSession } from '@/stores/session';
import { useQuery } from '@tanstack/react-query';
import { api, type Paged } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { AsyncSelect, Button, cn, Icon, NumberInput } from '@/components/ui';
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
  /** description filled automatically from the product (replaced when the product changes) */
  autoDesc?: string;
}

let seq = 0;
export const newLine = (): EditLine => ({
  key: `n${++seq}`,
  productId: null,
  description: '',
  qty: '1',
  uomId: null,
  unitPrice: '',
  discountPct: '0',
  taxId: null,
  sourceLineId: null,
});
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
  autoDesc: l.product?.name,
});

/** Tax rates by id. Uses the tax list when permitted, otherwise parses the rate from the option label. */
export function useTaxRates() {
  const q = useQuery({
    queryKey: ['tax-rates'],
    queryFn: async () => {
      try {
        // effective rate: PPN 12% on DPP nilai lain 11/12 = 11% of the net price (PMK 131/2024)
        const r = await api.get<Paged<{ id: string; rate: string; baseNumerator?: number; baseDenominator?: number }>>('/resources/taxes', { pageSize: 200 });
        return Object.fromEntries(r.data.map((t) => [t.id, (Number(t.rate) * (t.baseNumerator ?? 1)) / (t.baseDenominator || 1)]));
      } catch {
        const opts = await api.get<{ value: string; label: string }[]>('/resources/taxes/options');
        return Object.fromEntries(
          opts.map((o) => {
            const rate = Number(/([\d.]+)\s*%/.exec(o.label)?.[1] ?? 0);
            const dpp = /DPP\s*(\d+)\s*\/\s*(\d+)/i.exec(o.label);
            return [o.value, dpp ? (rate * Number(dpp[1])) / Number(dpp[2]) : rate];
          }),
        );
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
      return {
        subtotal: a.subtotal + c.sub,
        discount: a.discount + c.disc,
        tax: a.tax + c.tax,
        total: a.total + c.total,
      };
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

// Container width from which every line is one table row instead of a card: `@min-[57rem]:` (Tailwind
// needs the literal class names, so the breakpoint is written out in full below).

/**
 * Line items editor shared by every trade document (quotation ... stock transfer).
 * Wide containers: a compact table (product + numbers on one row, description below).
 * Narrow containers / phones: one card per line with labelled fields - no horizontal scrolling.
 * Enter moves to the next line (and adds one at the end) instead of submitting the form.
 */
export function LineEditor({ def, lines, onChange, errors }: { def: DocTypeDef; lines: EditLine[]; onChange: Dispatch<SetStateAction<EditLine[]>>; errors?: Record<string, string> }) {
  const rates = useTaxRates();
  const priced = def.priced;
  const allowNegative = def.stock === 'adjust';
  const showPrice = priced || allowNegative;
  // a company that is not a VAT payer (PKP) charges no output VAT: no tax column on sales documents
  const vatPayer = useSession((s) => s.me?.prefs.vatPayer ?? true);
  const salesVat = def.taxField !== 'saleTaxId' || vatPayer;
  const showTax = priced && !!def.taxField && salesVat;
  const rowsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const focusKey = useRef<string | null>(null);

  // unit and tax get room for their label next to the clear / chevron icons; qty, discount and amount stay compact
  const cols = ['1.25rem', 'minmax(12rem,1fr)', '4.25rem', '8rem', ...(showPrice ? ['7.5rem'] : []), ...(priced ? ['3.75rem'] : []), ...(showTax ? ['9.5rem'] : []), ...(priced ? ['7.25rem'] : []), '2rem'];
  const gridStyle = { '--line-cols': cols.join(' ') } as CSSProperties;

  useEffect(() => {
    if (!focusKey.current) return;
    const el = rowsRef.current[focusKey.current]?.querySelector<HTMLElement>('[data-line-first-wrap] button');
    focusKey.current = null;
    el?.focus();
  }, [lines]);

  const update = (key: string, patch: Partial<EditLine>) => onChange((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => onChange((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.key !== key)));
  const add = (afterKey?: string) => {
    const nl = newLine();
    focusKey.current = nl.key;
    onChange((ls) => {
      if (!afterKey) return [...ls, nl];
      const i = ls.findIndex((l) => l.key === afterKey);
      return [...ls.slice(0, i + 1), nl, ...ls.slice(i + 1)];
    });
  };
  const duplicate = (l: EditLine) => {
    const copy = { ...l, key: newLine().key, sourceLineId: null };
    onChange((ls) => {
      const i = ls.findIndex((x) => x.key === l.key);
      return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
    });
  };

  const pickProduct = async (l: EditLine, productId: string | null, label?: string) => {
    const keepDesc = l.description && l.description !== l.autoDesc;
    if (!productId)
      return update(l.key, {
        productId: null,
        ...(keepDesc ? {} : { description: '', autoDesc: undefined }),
      });
    const guess = label?.replace(/^[^-]+ - /, '') ?? '';
    update(l.key, {
      productId,
      ...(keepDesc ? {} : { description: guess, autoDesc: guess }),
    });
    try {
      const p = await api.get<ProductDetail>(`/resources/products/${productId}`);
      const price = def.priceField ? p[def.priceField] : priced ? p.salePrice : '0';
      update(l.key, {
        productId,
        ...(keepDesc ? {} : { description: p.name, autoDesc: p.name }),
        uomId: p.uomId,
        unitPrice: priced || def.stock === 'adjust' ? String(Number(price ?? 0)) : '0',
        taxId: def.taxField && salesVat ? p[def.taxField] : null,
      });
    } catch {
      /* no product read permission: keep the selection, the server fills the defaults */
    }
  };

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    const t = e.target as HTMLElement;
    // handled already by a picker (product search, unit list...) rendered inside this row
    if (e.defaultPrevented || e.key !== 'Enter' || t.tagName !== 'INPUT' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (i === lines.length - 1) add();
    else rowsRef.current[lines[i + 1].key]?.querySelector<HTMLElement>('[data-line-first-wrap] button')?.focus();
  };

  const err = (i: number, f: string) => errors?.[`lines.${i}.${f}`];
  const label = (text: string) => <span className={cn('label', `@min-[57rem]:sr-only`)}>{text}</span>;
  const errText = (m?: string) => (m ? <p className="mt-1 text-xs text-red-600">{m}</p> : null);

  return (
    <div className="@container">
      {/* column headers (wide layout only) */}
      <div style={gridStyle} className={cn('hidden gap-x-1.5 border-b border-line bg-slate-50/80 px-1 py-2 text-xs font-medium text-slate-500', `@min-[57rem]:grid @min-[57rem]:grid-cols-[var(--line-cols)]`)}>
        <span>#</span>
        <span>Product / service</span>
        <span className="text-right">Qty</span>
        <span>Unit</span>
        {showPrice && <span className="text-right">{priced ? 'Unit price' : 'Unit cost'}</span>}
        {priced && <span className="text-right">Disc %</span>}
        {showTax && <span>Tax</span>}
        {priced && <span className="text-right">Amount</span>}
        <span />
      </div>

      <div className={cn('space-y-3', `@min-[57rem]:space-y-0`)}>
        {lines.map((l, i) => {
          const c = computeLine(l, rates, priced);
          return (
            <div
              key={l.key}
              ref={(el) => void (rowsRef.current[l.key] = el)}
              style={gridStyle}
              onKeyDown={(e) => onRowKey(e, i)}
              className={cn(
                'grid grid-cols-2 gap-x-2 gap-y-2 rounded-xl border border-line bg-white p-3 @min-[36rem]:grid-cols-4',
                `@min-[57rem]:grid-cols-[var(--line-cols)] @min-[57rem]:gap-x-1.5 @min-[57rem]:gap-y-1.5 @min-[57rem]:rounded-none @min-[57rem]:border-x-0 @min-[57rem]:border-t-0 @min-[57rem]:px-1 @min-[57rem]:py-2.5 @min-[57rem]:hover:bg-slate-50/50`,
              )}
            >
              {/* line number + actions: card header on small screens, first / last column when wide */}
              <div className={cn('col-span-full flex items-center justify-between', `@min-[57rem]:contents`)}>
                <span className={cn('text-xs font-semibold text-slate-400', `@min-[57rem]:col-start-1 @min-[57rem]:row-start-1 @min-[57rem]:pt-2.5 @min-[57rem]:font-normal`)}>
                  <span className={`@min-[57rem]:hidden`}>Line </span>
                  {i + 1}
                </span>
                <div className={cn('flex items-center', `@min-[57rem]:col-start-[-2] @min-[57rem]:row-start-1 @min-[57rem]:row-span-2 @min-[57rem]:flex-col @min-[57rem]:items-start`)}>
                  <Button variant="ghost" size="icon" icon="copy" className="h-8 w-8 text-slate-400" onClick={() => duplicate(l)} aria-label={`Duplicate line ${i + 1}`} title="Duplicate line" />
                  <Button variant="ghost" size="icon" icon="trash-2" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => remove(l.key)} disabled={lines.length <= 1} aria-label={`Remove line ${i + 1}`} title="Remove line" />
                </div>
              </div>

              <div className={cn('col-span-full min-w-0', `@min-[57rem]:col-span-1 @min-[57rem]:col-start-2 @min-[57rem]:row-start-1`)}>
                {label('Product / service')}
                <div data-line-first-wrap>
                  <AsyncSelect
                    resource="products"
                    value={l.productId}
                    onChange={(v, o) => pickProduct(l, v, o?.label)}
                    placeholder="Search product or service..."
                    disabled={!!l.sourceLineId}
                    invalid={!!err(i, 'productId')}
                    aria-label={`Line ${i + 1} product`}
                    className="h-9"
                  />
                </div>
                {l.sourceLineId && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                    <Icon name="link" className="h-3 w-3" />
                    Copied from the source document
                  </p>
                )}
                {errText(err(i, 'productId'))}
              </div>

              <div className={`@min-[57rem]:row-start-1`}>
                {label('Qty')}
                <NumberInput value={l.qty} onChange={(v) => update(l.key, { qty: v })} allowNegative={allowNegative} invalid={!!err(i, 'qty')} aria-label={`Line ${i + 1} quantity`} className="h-9" />
                {errText(err(i, 'qty'))}
              </div>

              <div className={cn('min-w-0', `@min-[57rem]:row-start-1`)}>
                {label('Unit')}
                <AsyncSelect resource="uoms" value={l.uomId} onChange={(v) => update(l.key, { uomId: v })} placeholder="Unit" invalid={!!err(i, 'uomId')} aria-label={`Line ${i + 1} unit`} className="h-9" />
              </div>

              {showPrice && (
                <div className={`@min-[57rem]:row-start-1`}>
                  {label(priced ? 'Unit price' : 'Unit cost')}
                  <NumberInput value={l.unitPrice} onChange={(v) => update(l.key, { unitPrice: v })} fixed={2} placeholder="0" invalid={!!err(i, 'unitPrice')} aria-label={`Line ${i + 1} ${priced ? 'unit price' : 'unit cost'}`} className="h-9" />
                  {errText(err(i, 'unitPrice'))}
                </div>
              )}

              {priced && (
                <div className={`@min-[57rem]:row-start-1`}>
                  {label('Disc %')}
                  <NumberInput value={l.discountPct} onChange={(v) => update(l.key, { discountPct: v })} decimals={2} max={100} invalid={!!err(i, 'discountPct')} aria-label={`Line ${i + 1} discount percent`} className="h-9" />
                </div>
              )}

              {showTax && (
                <div className={cn('col-span-2 min-w-0', `@min-[57rem]:col-span-1 @min-[57rem]:row-start-1`)}>
                  {label('Tax')}
                  <AsyncSelect resource="taxes" value={l.taxId} onChange={(v) => update(l.key, { taxId: v })} placeholder="No tax" aria-label={`Line ${i + 1} tax`} className="h-9" />
                </div>
              )}

              {priced && (
                <div
                  className={cn(
                    'col-span-2 flex items-center justify-between border-t border-dashed border-line pt-2',
                    `@min-[57rem]:col-span-1 @min-[57rem]:row-start-1 @min-[57rem]:block @min-[57rem]:border-0 @min-[57rem]:pt-2 @min-[57rem]:text-right`,
                  )}
                >
                  <span className={cn('text-xs font-medium text-slate-500', `@min-[57rem]:sr-only`)}>Amount</span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">{fmtMoney(c.net)}</span>
                  {c.disc > 0 && <span className={cn('hidden text-[11px] text-slate-400 tabular-nums', `@min-[57rem]:block`)}>-{fmtMoney(c.disc)} disc.</span>}
                </div>
              )}

              <div className={cn('col-span-full', `@min-[57rem]:col-start-2 @min-[57rem]:col-end-[-2] @min-[57rem]:row-start-2`)}>
                <label className="sr-only" htmlFor={`desc-${l.key}`}>
                  Line {i + 1} description
                </label>
                <textarea
                  id={`desc-${l.key}`}
                  rows={1}
                  value={l.description}
                  onChange={(e) => update(l.key, { description: e.target.value })}
                  placeholder="Description printed on the document (optional details, specification, period...)"
                  maxLength={1000}
                  className={cn('input field-sizing-content min-h-9 resize-none py-1.5 text-[13px] text-slate-600', !!err(i, 'description') && 'input-error')}
                />
                {errText(err(i, 'description'))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon="plus" onClick={() => add()}>
          Add line
        </Button>
        <span className="hidden text-xs text-slate-400 sm:inline">Tip: press Enter in a field to jump to the next line.</span>
      </div>
    </div>
  );
}

/** Subtotal / discount / tax / total block shown under the lines. */
export function LineTotals({ lines, rates, priced, currency }: { lines: EditLine[]; rates: Record<string, number>; priced: boolean; currency?: string }) {
  if (!priced) return null;
  const t = computeTotals(lines, rates, true);
  const row = (k: string, v: string, cls?: string) => (
    <div className={cn('flex justify-between gap-6', cls)}>
      <dt className="text-slate-500">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      {row('Subtotal', fmtMoney(t.subtotal))}
      {t.discount > 0 && row('Discount', `-${fmtMoney(t.discount)}`)}
      {row('Tax', fmtMoney(t.tax))}
      <div className="flex justify-between gap-6 border-t border-line pt-2 text-base font-semibold text-slate-900">
        <dt>Total</dt>
        <dd className="tabular-nums">
          {currency ? `${currency} ` : ''}
          {fmtMoney(t.total)}
        </dd>
      </div>
    </dl>
  );
}
