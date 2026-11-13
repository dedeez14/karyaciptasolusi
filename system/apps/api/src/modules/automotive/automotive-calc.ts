/** Pure helpers of the automotive add-on: VIN (ISO 3779) structure, check digit, model year, PPnBM. */

const TRANSLIT: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** ISO 3780 model-year codes (position 10): 30-year cycle without I, O, Q, U, Z and 0 */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

const val = (c: string) => (/\d/.test(c) ? Number(c) : TRANSLIT[c]);

/** check digit of position 9 (North American practice, also used by many makers): weighted sum mod 11, 10 = X */
export function vinCheckDigit(vin: string) {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (val(vin[i]) ?? 0) * WEIGHTS[i];
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

/** model years a position-10 code can stand for (every 30 years), the latest not after `maxYear` first */
export function modelYears(code: string, maxYear: number) {
  const i = YEAR_CODES.indexOf(code);
  if (i < 0) return [];
  const out: number[] = [];
  for (let y = 1980 + i; y <= maxYear; y += 30) out.push(y);
  return out.reverse();
}
export const yearCode = (year: number) => YEAR_CODES[(((year - 1980) % 30) + 30) % 30];

export interface VinCheck {
  vin: string;
  ok: boolean;
  errors: string[];
  wmi: string;
  vds: string;
  vis: string;
  yearCode: string;
  plantCode: string;
  serial: string;
  checkDigit: { expected: string; actual: string; ok: boolean };
}

/**
 * VIN structure (ISO 3779): 17 characters, letters except I, O and Q; WMI (1-3, ISO 3780), VDS (4-9), VIS (10-17:
 * model year, plant, serial). The check digit is reported, enforced only when asked (the maker's rule).
 */
export function checkVin(raw: string, opts: { requireCheckDigit?: boolean; wmi?: string | null; year?: number | null } = {}): VinCheck {
  const vin = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  const errors: string[] = [];
  if (vin.length !== 17) errors.push(`A VIN has 17 characters (this one has ${vin.length})`);
  if (/[IOQ]/.test(vin)) errors.push('The letters I, O and Q are not used in a VIN');
  if (/[^A-Z0-9]/.test(vin)) errors.push('Only letters and digits');
  const padded = vin.padEnd(17, '0').slice(0, 17);
  const expected = vin.length === 17 && !errors.length ? vinCheckDigit(vin) : '';
  const cd = { expected, actual: padded[8], ok: !!expected && expected === padded[8] };
  if (opts.requireCheckDigit && vin.length === 17 && !errors.length && !cd.ok) errors.push(`Check digit (position 9) should be ${expected}`);
  if (opts.wmi && vin.length >= 3 && !vin.startsWith(opts.wmi.toUpperCase())) errors.push(`The manufacturer code (WMI) should be ${opts.wmi.toUpperCase()}`);
  if (opts.year && vin.length === 17 && YEAR_CODES.includes(padded[9]) && padded[9] !== yearCode(opts.year)) errors.push(`Position 10 should be ${yearCode(opts.year)} for model year ${opts.year}`);
  return { vin, ok: !errors.length, errors, wmi: vin.slice(0, 3), vds: vin.slice(3, 9), vis: vin.slice(9), yearCode: padded[9], plantCode: padded[10], serial: vin.slice(11), checkDigit: cd };
}

export interface OtrInput {
  offRoad: number; // price including PPN and PPnBM
  njkb: number; // sale value for vehicle tax (Permendagri), the BBNKB / PKB base
  bbnkbPct: number;
  pkbPct: number;
  opsenPct: number;
  weighting?: number; // PKB weighting (1 for private passenger cars)
  swdkllj: number;
  pnbp: number;
}

/** on-the-road price: off-the-road price + BBNKB + opsen + first-year PKB + opsen + SWDKLLJ + registration fees (UU 1/2022) */
export function onTheRoad(i: OtrInput) {
  const r0 = (v: number) => Math.round(v);
  const bbnkb = r0((i.njkb * i.bbnkbPct) / 100);
  const opsenBbnkb = r0((bbnkb * i.opsenPct) / 100);
  const pkb = r0((i.njkb * (i.weighting ?? 1) * i.pkbPct) / 100);
  const opsenPkb = r0((pkb * i.opsenPct) / 100);
  const regional = bbnkb + opsenBbnkb + pkb + opsenPkb + i.swdkllj + i.pnbp;
  return { ...i, bbnkb, opsenBbnkb, pkb, opsenPkb, regional, total: r0(i.offRoad + regional) };
}
