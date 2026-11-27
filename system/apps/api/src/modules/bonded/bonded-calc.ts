/** Pure helpers of the bonded zone (KB) / KITE add-on: IT Inventory mutation rows, KITE conversion and FIFO allocation. */

export interface MoveRow {
  productId: string;
  qty: number; // signed
  docType: string;
  documentId: string | null;
}

export interface MutationRow {
  productId: string;
  opening: number;
  in: number;
  out: number;
  adjustment: number;
  closing: number;
  counted: number | null;
  difference: number | null;
}

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * One IT Inventory mutation line per item: opening + in - out + adjustment = closing (book), then the stock-opname
 * count and its difference. Adjustments posted by a stock count are left out of the adjustment column (they ARE the
 * difference), so the book closing is the figure the count is compared with.
 */
export function mutation(opening: Map<string, number>, moves: MoveRow[], countAdjustmentIds: Set<string>, counts: Map<string, number>): MutationRow[] {
  const rows = new Map<string, MutationRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { productId: id, opening: opening.get(id) ?? 0, in: 0, out: 0, adjustment: 0, closing: 0, counted: null, difference: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const id of opening.keys()) row(id);
  for (const id of counts.keys()) row(id);
  for (const m of moves) {
    const r = row(m.productId);
    if (m.docType === 'ADJ') {
      if (m.documentId && countAdjustmentIds.has(m.documentId)) continue;
      r.adjustment += m.qty;
    } else if (m.qty >= 0) r.in += m.qty;
    else r.out -= m.qty;
  }
  for (const r of rows.values()) {
    r.closing = r4(r.opening + r.in - r.out + r.adjustment);
    r.opening = r4(r.opening);
    r.in = r4(r.in);
    r.out = r4(r.out);
    r.adjustment = r4(r.adjustment);
    const c = counts.get(r.productId);
    if (c !== undefined) {
      r.counted = r4(c);
      r.difference = r4(c - r.closing);
    }
  }
  return [...rows.values()].filter((r) => r.opening || r.in || r.out || r.adjustment || r.closing || r.counted !== null);
}

export interface ImportLot {
  lineId: string;
  productId: string;
  date: string; // registration date, oldest first
  remaining: number;
}

/** raw material used by the exported goods: export qty x component qty per unit (BOM, including its loss %) */
export function conversion(exportQty: number, bom: { outputQty: number; lines: { productId: string; qty: number; scrapPct: number }[] }) {
  const out = bom.outputQty > 0 ? bom.outputQty : 1;
  return bom.lines.map((l) => ({ productId: l.productId, qty: r4((exportQty * l.qty * (1 + l.scrapPct / 100)) / out) }));
}

/** charge the raw material used against the imports still open, oldest registration first */
export function allocateFifo(lots: ImportLot[], productId: string, qty: number) {
  const out: { lineId: string; qty: number }[] = [];
  let left = qty;
  for (const l of lots.filter((x) => x.productId === productId && x.remaining > 0).sort((a, b) => a.date.localeCompare(b.date))) {
    if (left <= 0) break;
    const take = Math.min(l.remaining, left);
    l.remaining = r4(l.remaining - take);
    left = r4(left - take);
    out.push({ lineId: l.lineId, qty: r4(take) });
  }
  return { allocations: out, unallocated: r4(Math.max(0, left)) };
}

export interface BcType {
  code: string;
  label: string;
  dirs: ('IN' | 'OUT')[];
  duty: 'SUSPENDED' | 'PAYABLE' | 'GUARANTEE';
  faktur?: string;
}

/** customs document codes of a bonded zone / KITE company (PER-7/BC/2021 Art. 5(6), PER-8/BC/2022) and their usual duty treatment (PMK 131/2018 jo 65/2021) */
export const BC_TYPES: BcType[] = [
  { code: 'BC23', label: 'BC 2.3 Import into the bonded zone', dirs: ['IN'], duty: 'SUSPENDED' },
  { code: 'BC20', label: 'BC 2.0 Import (PIB) under KITE', dirs: ['IN'], duty: 'SUSPENDED' },
  { code: 'BC40', label: 'BC 4.0 Goods from the domestic area', dirs: ['IN'], duty: 'SUSPENDED', faktur: '07' },
  { code: 'BC262', label: 'BC 2.6.2 Back from subcontract / repair', dirs: ['IN'], duty: 'SUSPENDED' },
  { code: 'BC27', label: 'BC 2.7 Between bonded zones', dirs: ['IN', 'OUT'], duty: 'SUSPENDED', faktur: '07' },
  { code: 'BC25', label: 'BC 2.5 Release to the domestic area', dirs: ['OUT'], duty: 'PAYABLE', faktur: '01' },
  { code: 'BC261', label: 'BC 2.6.1 Temporary exit (subcontract, repair)', dirs: ['OUT'], duty: 'GUARANTEE' },
  { code: 'BC30', label: 'BC 3.0 Export (PEB)', dirs: ['OUT'], duty: 'SUSPENDED' },
  { code: 'BC41', label: 'BC 4.1 Local goods back to the domestic area', dirs: ['OUT'], duty: 'SUSPENDED', faktur: '01' },
  { code: 'BC24', label: 'BC 2.4 KITE materials settled by payment', dirs: ['OUT'], duty: 'PAYABLE' },
];
export const bcType = (code: string) => BC_TYPES.find((t) => t.code === code);

export const addMonths = (d: Date, months: number) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return x;
};
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * Domestic-sales quota (PMK 131 Art. 31, PER-19/BC/2018 Lampiran L): pct x last year's realisation (exports, sales to
 * other bonded zones, FTZ and KEK); a new company uses this year's realisation. Zero figures count as 1.
 */
export function domesticQuota(pct: number, lastYearRealisation: number, thisYearRealisation: number, used: number) {
  const firstYear = lastYearRealisation <= 0;
  const base = Math.max(1, firstYear ? thisYearRealisation : lastYearRealisation);
  const quota = Math.round((base * pct) / 100);
  const noBase = (firstYear ? thisYearRealisation : lastYearRealisation) <= 0;
  return { firstYear, noBase, base: Math.round(base), quota, used: Math.round(used), left: Math.round(quota - used), usedPct: noBase ? null : Math.round((used / Math.max(1, quota)) * 10_000) / 100 };
}
