/** Pure calculations of commodity (CPO / kernel) sales: quality claims, export duty and levy. */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

export interface Spec {
  ffaMax?: number | null;
  miMax?: number | null;
  dobiMin?: number | null;
}
export interface ClaimRules {
  /** price reduction (% of the price) per 1 % of FFA above the contract maximum, pro rata */
  ffaRatePct?: number | null;
  /** moisture & impurities above the maximum are deducted from the invoiced weight */
  miDeductWeight?: boolean | null;
  /** price reduction (% of the price) per 0.1 of DOBI below the contract minimum */
  dobiRatePct?: number | null;
}

/**
 * Quality claim of one delivery: FFA above the contract maximum reduces the price pro rata, moisture & impurities above
 * the maximum come off the invoiced weight, DOBI below the minimum reduces the price.
 */
export function qualityClaim(qtyKg: number, price: number, q: { ffa?: number | null; mi?: number | null; dobi?: number | null }, spec: Spec, rules: ClaimRules) {
  const ffaExcess = spec.ffaMax !== null && spec.ffaMax !== undefined && q.ffa !== null && q.ffa !== undefined ? Math.max(0, q.ffa - spec.ffaMax) : 0;
  const miExcess = spec.miMax !== null && spec.miMax !== undefined && q.mi !== null && q.mi !== undefined ? Math.max(0, q.mi - spec.miMax) : 0;
  const dobiShort = spec.dobiMin !== null && spec.dobiMin !== undefined && q.dobi !== null && q.dobi !== undefined ? Math.max(0, spec.dobiMin - q.dobi) : 0;
  const ffaPct = r4(ffaExcess * (rules.ffaRatePct ?? 0));
  const dobiPct = r4((dobiShort / 0.1) * (rules.dobiRatePct ?? 0));
  const claimPct = Math.min(100, r4(ffaPct + dobiPct));
  const claimKg = rules.miDeductWeight ? r2((qtyKg * miExcess) / 100) : 0;
  const invoiceKg = r2(qtyKg - claimKg);
  const unitPrice = r4(price * (1 - claimPct / 100));
  return { ffaExcess: r4(ffaExcess), miExcess: r4(miExcess), dobiShort: r4(dobiShort), ffaPct, dobiPct, claimPct, claimKg, invoiceKg, unitPrice, offSpec: ffaExcess > 0 || miExcess > 0 || dobiShort > 0 };
}

/**
 * Export duty and levy of a shipment: duty = tonnes x duty per tonne of the month (bracket of the reference price);
 * levy = tonnes x (a specific amount per tonne, or the % of the reference price); both converted at the rate given.
 */
export function exportCharges(i: { qtyKg: number; refPriceUsd: number; dutyUsdPerMt: number; levyPct?: number | null; levyUsdPerMt?: number | null; rate: number }) {
  const mt = i.qtyKg / 1000;
  const levyPerMt = i.levyUsdPerMt !== null && i.levyUsdPerMt !== undefined && i.levyUsdPerMt > 0 ? i.levyUsdPerMt : r2((i.refPriceUsd * (i.levyPct ?? 0)) / 100);
  const dutyUsd = r2(mt * i.dutyUsdPerMt);
  const levyUsd = r2(mt * levyPerMt);
  return { mt: r4(mt), dutyUsd, levyUsd, levyPerMt, dutyIdr: Math.round(dutyUsd * i.rate), levyIdr: Math.round(levyUsd * i.rate) };
}

/** contract position: delivered against the quantity with its tolerance */
export function position(qtyKg: number, tolerancePct: number, deliveredKg: number) {
  const max = qtyKg * (1 + tolerancePct / 100);
  const min = qtyKg * (1 - tolerancePct / 100);
  return { remainingKg: r2(Math.max(0, qtyKg - deliveredKg)), maxKg: r2(max), minKg: r2(min), canDeliverKg: r2(Math.max(0, max - deliveredKg)), fulfilled: deliveredKg >= min };
}
