/**
 * Landed cost arithmetic (pure, no database):
 * - customs value (nilai pabean) is CIF (PMK 190/2022): the price plus freight / insurance not in it, at the NDPBM rate;
 * - import duty and additional duties (anti-dumping, safeguard) per item, the total of each levy in one PIB rounded UP to
 *   the full thousand rupiah (PMK 190/2022 Art. 22(4));
 * - import value (nilai impor) = customs value + duties; PPN 12% on DPP 11/12 of it (PMK 131/2024 Art. 3), luxury goods
 *   (PPnBM) on the full value; PPnBM rate x import value; PPh 22 import x import value (PMK 51/2025 Art. 3: 10% list A,
 *   7.5% list B, 0.5% list C, 0.25% gold bars, otherwise 2.5% with an API / 7.5% without); taxes rounded down to the rupiah;
 * - charges spread by value, quantity or weight; the cost added = duties + PPnBM + PPN not creditable + charges
 *   (SAK EP Bab 13 / PSAK 202: import duties and taxes that cannot be recovered, transport and handling).
 */
export const CIF_TERMS = ['CIF', 'CIP', 'DAP', 'DPU', 'DDP'];
export const FREIGHT_IN_PRICE = ['CFR', 'CPT', ...CIF_TERMS];
export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'];
export const PPN_RATE = 12;
export const PPN_DPP = 11 / 12;

export interface CalcLine {
  qty: number;
  valueFx: number;
  value: number;
  weight: number;
  bmPct: number;
  bmadPct: number;
  ppnbmPct: number;
  pph22Pct: number | null;
}
export interface CalcCharge {
  amount: number;
  method: 'VALUE' | 'QTY' | 'WEIGHT';
}
export interface CalcHeader {
  customs: boolean;
  ndpbm: number;
  freightFx: number;
  insuranceFx: number;
  apiHolder: boolean;
  ppnCreditable: boolean;
  bmActual: number | null;
  ppnActual: number | null;
  pph22Actual: number | null;
}
export interface CalcResultLine {
  customsValue: number;
  bm: number;
  bmad: number;
  ppn: number;
  ppnbm: number;
  pph22: number;
  pph22Pct: number;
  charges: number;
  capitalize: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const ceilK = (v: number) => Math.ceil(Math.round(v * 100) / 100 / 1000) * 1000;
const floorR = (v: number) => Math.floor(Math.round(v * 100) / 100);

/** spreads a total over weights, to the cent, the rounding left on the largest share */
export function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map(() => 0);
  const out = weights.map((w) => r2((total * w) / sum));
  const diff = r2(total - out.reduce((a, v) => a + v, 0));
  if (diff !== 0) {
    let k = 0;
    weights.forEach((w, i) => (w > weights[k] ? (k = i) : null));
    out[k] = r2(out[k] + diff);
  }
  return out;
}

export function calculate(h: CalcHeader, lines: CalcLine[], charges: CalcCharge[]): { lines: CalcResultLine[]; errors: string[] } {
  const errors: string[] = [];
  const addFx = spread(
    h.freightFx + h.insuranceFx,
    lines.map((l) => l.valueFx),
  );
  const cv = lines.map((l, i) => (h.customs ? r2((l.valueFx + addFx[i]) * h.ndpbm) : 0));
  const rawBm = lines.map((l, i) => (cv[i] * l.bmPct) / 100);
  const rawBmad = lines.map((l, i) => (cv[i] * l.bmadPct) / 100);
  const sumBm = rawBm.reduce((a, v) => a + v, 0);
  const sumBmad = rawBmad.reduce((a, v) => a + v, 0);
  const bmTotal = !h.customs ? 0 : h.bmActual !== null ? h.bmActual : sumBm > 0 ? ceilK(sumBm) : 0;
  const bm = spread(bmTotal, sumBm > 0 ? rawBm : cv);
  const bmad = spread(sumBmad > 0 ? ceilK(sumBmad) : 0, rawBmad);
  const nilai = lines.map((_, i) => cv[i] + bm[i] + bmad[i]);
  const rawPpn = lines.map((l, i) => (l.ppnbmPct > 0 ? nilai[i] : nilai[i] * PPN_DPP) * (PPN_RATE / 100));
  const rawPpnbm = lines.map((l, i) => (nilai[i] * l.ppnbmPct) / 100);
  const pct22 = lines.map((l) => (l.pph22Pct !== null ? l.pph22Pct : h.apiHolder ? 2.5 : 7.5));
  const rawPph = lines.map((_, i) => (nilai[i] * pct22[i]) / 100);
  const total = (raw: number[], actual: number | null) => (!h.customs ? 0 : actual !== null ? actual : floorR(raw.reduce((a, v) => a + v, 0)));
  const ppn = spread(total(rawPpn, h.ppnActual), rawPpn);
  const ppnbm = spread(total(rawPpnbm, null), rawPpnbm);
  const pph22 = spread(total(rawPph, h.pph22Actual), rawPph);
  const chg = lines.map(() => 0);
  charges.forEach((c, k) => {
    const w = lines.map((l) => (c.method === 'QTY' ? l.qty : c.method === 'WEIGHT' ? l.weight : l.value));
    if (w.reduce((a, v) => a + v, 0) <= 0) {
      errors.push(`Charge ${k + 1}: the lines have no ${c.method === 'WEIGHT' ? 'weight' : c.method === 'QTY' ? 'quantity' : 'value'} to spread it by`);
      return;
    }
    spread(c.amount, w).forEach((v, i) => (chg[i] = r2(chg[i] + v)));
  });
  return {
    errors,
    lines: lines.map((_, i) => ({
      customsValue: cv[i],
      bm: bm[i],
      bmad: bmad[i],
      ppn: ppn[i],
      ppnbm: ppnbm[i],
      pph22: pph22[i],
      pph22Pct: pct22[i],
      charges: chg[i],
      capitalize: r2(bm[i] + bmad[i] + ppnbm[i] + (h.ppnCreditable ? 0 : ppn[i]) + chg[i]),
    })),
  };
}
