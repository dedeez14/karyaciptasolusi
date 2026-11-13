/**
 * Indonesian statutory payroll: PPh 21 (TER method) and BPJS contributions.
 *
 * - PPh 21: PP 58/2023 and PMK 168/2023 (effective 1 Jan 2024; unchanged in 2026).
 *   January–November: monthly gross x TER rate (category A / B / C from the PTKP status).
 *   December, or the month an employee leaves: annual tax with the Pasal 17 rates on
 *   (gross − biaya jabatan − employee JHT/JP − PTKP), less what was withheld earlier in the year.
 *   Gross includes the company's JKK, JKM and BPJS Kesehatan contributions, but not its JHT/JP contributions.
 * - BPJS: Kesehatan 4% + 1% (wage cap Rp12 juta, floor = minimum wage), JHT 3.7% + 2%, JP 2% + 1%
 *   (wage cap, Rp11.086.300 from March 2026), JKK by risk class, JKM 0.3%. Rates live in Settings > Payroll & BPJS.
 *
 * TER tables transcribed from the PP 58/2023 Lampiran (verified against the DJP BPMP converter, Nov 2026).
 */

type Band = [upTo: number, rate: number];
const INF = Number.POSITIVE_INFINITY;

const TER_A: Band[] = [
  [5_400_000, 0], [5_650_000, 0.25], [5_950_000, 0.5], [6_300_000, 0.75], [6_750_000, 1], [7_500_000, 1.25], [8_550_000, 1.5], [9_650_000, 1.75],
  [10_050_000, 2], [10_350_000, 2.25], [10_700_000, 2.5], [11_050_000, 3], [11_600_000, 3.5], [12_500_000, 4], [13_750_000, 5], [15_100_000, 6],
  [16_950_000, 7], [19_750_000, 8], [24_150_000, 9], [26_450_000, 10], [28_000_000, 11], [30_050_000, 12], [32_400_000, 13], [35_400_000, 14],
  [39_100_000, 15], [43_850_000, 16], [47_800_000, 17], [51_400_000, 18], [56_300_000, 19], [62_200_000, 20], [68_600_000, 21], [77_500_000, 22],
  [89_000_000, 23], [103_000_000, 24], [125_000_000, 25], [157_000_000, 26], [206_000_000, 27], [337_000_000, 28], [454_000_000, 29], [550_000_000, 30],
  [695_000_000, 31], [910_000_000, 32], [1_400_000_000, 33], [INF, 34],
];
const TER_B: Band[] = [
  [6_200_000, 0], [6_500_000, 0.25], [6_850_000, 0.5], [7_300_000, 0.75], [9_200_000, 1], [10_750_000, 1.5], [11_250_000, 2], [11_600_000, 2.5],
  [12_600_000, 3], [13_600_000, 4], [14_950_000, 5], [16_400_000, 6], [18_450_000, 7], [21_850_000, 8], [26_000_000, 9], [27_700_000, 10],
  [29_350_000, 11], [31_450_000, 12], [33_950_000, 13], [37_100_000, 14], [41_100_000, 15], [45_800_000, 16], [49_500_000, 17], [53_800_000, 18],
  [58_500_000, 19], [64_000_000, 20], [71_000_000, 21], [80_000_000, 22], [93_000_000, 23], [109_000_000, 24], [129_000_000, 25], [163_000_000, 26],
  [211_000_000, 27], [374_000_000, 28], [459_000_000, 29], [555_000_000, 30], [704_000_000, 31], [957_000_000, 32], [1_405_000_000, 33], [INF, 34],
];
const TER_C: Band[] = [
  [6_600_000, 0], [6_950_000, 0.25], [7_350_000, 0.5], [7_800_000, 0.75], [8_850_000, 1], [9_800_000, 1.25], [10_950_000, 1.5], [11_200_000, 1.75],
  [12_050_000, 2], [12_950_000, 3], [14_150_000, 4], [15_550_000, 5], [17_050_000, 6], [19_500_000, 7], [22_700_000, 8], [26_600_000, 9],
  [28_100_000, 10], [30_100_000, 11], [32_600_000, 12], [35_400_000, 13], [38_900_000, 14], [43_000_000, 15], [47_400_000, 16], [51_200_000, 17],
  [55_800_000, 18], [60_400_000, 19], [66_700_000, 20], [74_500_000, 21], [83_200_000, 22], [95_600_000, 23], [110_000_000, 24], [134_000_000, 25],
  [169_000_000, 26], [221_000_000, 27], [390_000_000, 28], [463_000_000, 29], [561_000_000, 30], [709_000_000, 31], [965_000_000, 32], [1_419_000_000, 33],
  [INF, 34],
];

export const PTKP: Record<string, number> = {
  'TK/0': 54_000_000,
  'TK/1': 58_500_000,
  'TK/2': 63_000_000,
  'TK/3': 67_500_000,
  'K/0': 58_500_000,
  'K/1': 63_000_000,
  'K/2': 67_500_000,
  'K/3': 72_000_000,
};

export function terCategory(ptkp: string | null | undefined): 'A' | 'B' | 'C' {
  const s = ptkp ?? 'TK/0';
  if (s === 'K/3') return 'C';
  if (['TK/2', 'TK/3', 'K/1', 'K/2'].includes(s)) return 'B';
  return 'A';
}

/** TER rate (%) for a monthly gross; bands are "above the previous limit up to and including this one" */
export function terRate(gross: number, category: 'A' | 'B' | 'C') {
  const table = category === 'A' ? TER_A : category === 'B' ? TER_B : TER_C;
  for (const [upTo, rate] of table) if (gross <= upTo) return rate;
  return 34;
}

/** UU PPh Pasal 17 ayat (1) huruf a (UU HPP) on a yearly taxable income already rounded down to full thousands */
export function pasal17(pkp: number) {
  const bands: Band[] = [
    [60_000_000, 5],
    [250_000_000, 15],
    [500_000_000, 25],
    [5_000_000_000, 30],
    [INF, 35],
  ];
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of bands) {
    if (pkp <= lower) break;
    tax += ((Math.min(pkp, upTo) - lower) * rate) / 100;
    lower = upTo;
  }
  return Math.floor(tax);
}

export interface StatutoryRates {
  kesCompany: number;
  kesEmployee: number;
  kesCap: number;
  jhtCompany: number;
  jhtEmployee: number;
  jpCompany: number;
  jpEmployee: number;
  jpCap: number;
  jkk: number;
  jkm: number;
  minimumWage: number;
}

export interface BpjsResult {
  employee: { kes: number; jht: number; jp: number };
  company: { kes: number; jht: number; jp: number; jkk: number; jkm: number };
  bases: { kes: number; jp: number; wage: number };
}

const pct = (base: number, rate: number) => Math.round((base * rate) / 100);

/** BPJS contributions on the monthly wage (base salary + fixed allowances) */
export function bpjs(wage: number, r: StatutoryRates, enrolled: { kes: boolean; jht: boolean; jp: boolean }): BpjsResult {
  const kesBase = Math.min(Math.max(wage, r.minimumWage || 0), r.kesCap || INF);
  const jpBase = Math.min(wage, r.jpCap || INF);
  return {
    employee: { kes: enrolled.kes ? pct(kesBase, r.kesEmployee) : 0, jht: enrolled.jht ? pct(wage, r.jhtEmployee) : 0, jp: enrolled.jp ? pct(jpBase, r.jpEmployee) : 0 },
    company: {
      kes: enrolled.kes ? pct(kesBase, r.kesCompany) : 0,
      jht: enrolled.jht ? pct(wage, r.jhtCompany) : 0,
      jp: enrolled.jp ? pct(jpBase, r.jpCompany) : 0,
      // JKK and JKM cover every employee (they are part of the employer's BPJS Ketenagakerjaan registration)
      jkk: pct(wage, r.jkk),
      jkm: pct(wage, r.jkm),
    },
    bases: { kes: enrolled.kes ? kesBase : 0, jp: enrolled.jp ? jpBase : 0, wage },
  };
}

/** monthly PPh 21 with TER; 20% higher without NPWP / NIK (UU PPh Pasal 21 ayat 5a) */
export function monthlyPph21(gross: number, category: 'A' | 'B' | 'C', hasNpwp: boolean) {
  const rate = terRate(gross, category);
  const tax = Math.floor((gross * rate) / 100);
  return { rate, tax: hasNpwp ? tax : Math.floor(tax * 1.2) };
}

/**
 * PPh 21 of the last tax period (December, or the month the employee leaves): tax for the year (or the part of it worked)
 * with Pasal 17, less the TER amounts already withheld. No annualisation for a part year (PMK 168/2023 examples).
 */
export function annualPph21(input: { grossYear: number; pensionYear: number; months: number; ptkp: string | null | undefined; withheldBefore: number; hasNpwp: boolean }) {
  const biayaJabatan = Math.min(input.grossYear * 0.05, 500_000 * Math.max(1, Math.min(12, input.months)));
  const neto = input.grossYear - biayaJabatan - input.pensionYear;
  const ptkp = PTKP[input.ptkp ?? 'TK/0'] ?? PTKP['TK/0'];
  const pkp = Math.max(0, Math.floor((neto - ptkp) / 1000) * 1000);
  let yearTax = pasal17(pkp);
  if (!input.hasNpwp) yearTax = Math.floor(yearTax * 1.2);
  return { biayaJabatan: Math.round(biayaJabatan), neto: Math.round(neto), ptkp, pkp, yearTax, tax: yearTax - input.withheldBefore };
}

/** THR (religious holiday allowance, Permenaker 6/2016): 1 month's wage after 12 months of service, pro rata from 1 month */
export function thrAmount(wage: number, joinDate: Date | null, holiday: Date) {
  if (!joinDate) return { months: 12, amount: Math.round(wage) };
  const months = (holiday.getUTCFullYear() - joinDate.getUTCFullYear()) * 12 + (holiday.getUTCMonth() - joinDate.getUTCMonth()) - (holiday.getUTCDate() < joinDate.getUTCDate() ? 1 : 0);
  if (months < 1) return { months, amount: 0 };
  return { months, amount: Math.round(months >= 12 ? wage : (wage * months) / 12) };
}

/**
 * End of employment (UU 27/2026 Pelindungan Ketenagakerjaan, with PP 35/2021 where the new implementing rules
 * are not out yet). An estimate to prepare the calculation: check it against the law, the work agreement and the
 * company regulation (PP / PKB) before paying.
 */
export const TERMINATION_REASONS: Record<string, { label: string; pesangon: number; upmk: number }> = {
  RESIGN: { label: 'Resignation by the employee', pesangon: 0, upmk: 0 },
  EFFICIENCY: { label: 'Efficiency / restructuring', pesangon: 1, upmk: 1 },
  CLOSURE_LOSS: { label: 'Business closed after losses', pesangon: 1, upmk: 1 },
  MERGER_EMPLOYEE: { label: 'Merger / takeover - employee does not continue', pesangon: 1, upmk: 1 },
  MERGER_EMPLOYER: { label: 'Merger / takeover - employer does not continue the employee', pesangon: 2, upmk: 1 },
  EMPLOYER_FAULT: { label: 'Employer at fault (employee requests termination)', pesangon: 2, upmk: 1 },
  RETIREMENT: { label: 'Retirement', pesangon: 2, upmk: 1 },
  DEATH: { label: 'Death of the employee', pesangon: 2, upmk: 1 },
  MUTUAL: { label: 'Other / mutual agreement', pesangon: 1, upmk: 1 },
};

/** months of wage for pesangon by full years of service: <1 year = 1 ... 8 years or more = 9 */
export const pesangonMonths = (years: number) => Math.min(9, Math.max(1, Math.floor(years) + 1));
/** months of wage for UPMK (uang penghargaan masa kerja) */
export function upmkMonths(years: number) {
  const steps: [number, number][] = [[24, 10], [21, 8], [18, 7], [15, 6], [12, 5], [9, 4], [6, 3], [3, 2]];
  for (const [y, m] of steps) if (years >= y) return m;
  return 0;
}

export function severance(input: { wage: number; joinDate: Date; endDate: Date; reason: string; contract: boolean; unusedLeaveDays: number; workDaysPerWeek: number }) {
  const ms = (input.endDate.getUTCFullYear() - input.joinDate.getUTCFullYear()) * 12 + (input.endDate.getUTCMonth() - input.joinDate.getUTCMonth()) - (input.endDate.getUTCDate() < input.joinDate.getUTCDate() ? 1 : 0);
  const months = Math.max(0, ms);
  const years = months / 12;
  // daily wage: 1/25 of the monthly wage for a 6-day week, 1/21 for a 5-day week (PP 35/2021)
  const daily = input.wage / (input.workDaysPerWeek >= 6 ? 25 : 21);
  const uph = Math.round(daily * Math.max(0, input.unusedLeaveDays));
  if (input.contract) {
    // PKWT compensation: months of service / 12 x 1 month wage, from 1 month of service (PP 35/2021 Pasal 15-16)
    const compensation = months >= 1 ? Math.round((input.wage * months) / 12) : 0;
    return { months, years: Math.floor(years), kind: 'PKWT' as const, compensation, pesangon: 0, upmk: 0, uph, total: compensation + uph, pesangonMonths: 0, upmkMonths: 0 };
  }
  const r = TERMINATION_REASONS[input.reason] ?? TERMINATION_REASONS.MUTUAL;
  const pm = r.pesangon ? pesangonMonths(years) * r.pesangon : 0;
  const um = r.upmk ? upmkMonths(years) * r.upmk : 0;
  const pesangon = Math.round(input.wage * pm);
  const upmk = Math.round(input.wage * um);
  return { months, years: Math.floor(years), kind: 'PKWTT' as const, compensation: 0, pesangon, upmk, uph, total: pesangon + upmk + uph, pesangonMonths: pm, upmkMonths: um };
}
