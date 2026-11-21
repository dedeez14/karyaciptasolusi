/** Pure calculations of the herd: milk price by quality, weight gain, reproduction dates and KPIs. */

const DAY = 86_400_000;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface MilkScheme {
  basePrice: number;
  fatStd: number;
  fatStep: number;
  tsStd: number;
  tsStep: number;
  tpcGrades: { maxTpc: number; adj: number }[] | null;
}

export interface MilkQuality {
  fat?: number | null;
  ts?: number | null;
  snf?: number | null;
  tpc?: number | null;
}

/**
 * Price per litre: base price, plus / minus a step per 0.1 % of fat and of total solids (TS = fat + SNF when not
 * measured) against the standard, plus the adjustment of the bacteria (TPC) grade the sample falls in.
 */
export function milkPrice(s: MilkScheme, q: MilkQuality) {
  const ts = q.ts ?? (q.fat !== null && q.fat !== undefined && q.snf !== null && q.snf !== undefined ? r2(q.fat + q.snf) : null);
  const fatAdj = s.fatStep && s.fatStd && q.fat !== null && q.fat !== undefined ? r2(Math.round((q.fat - s.fatStd) * 10) * s.fatStep) : 0;
  const tsAdj = s.tsStep && s.tsStd && ts !== null ? r2(Math.round((ts - s.tsStd) * 10) * s.tsStep) : 0;
  let tpcAdj = 0;
  let grade: number | null = null;
  if (s.tpcGrades?.length && q.tpc !== null && q.tpc !== undefined) {
    const g = [...s.tpcGrades].sort((a, b) => a.maxTpc - b.maxTpc);
    const i = g.findIndex((x) => q.tpc! <= x.maxTpc);
    grade = i === -1 ? g.length : i + 1;
    tpcAdj = (i === -1 ? g[g.length - 1] : g[i]).adj;
  }
  return { base: s.basePrice, fatAdj, ts, tsAdj, tpcAdj, grade, price: Math.max(0, r2(s.basePrice + fatAdj + tsAdj + tpcAdj)) };
}

/** average daily gain between two weighings (kg / day) */
export function adg(from: { date: Date; kg: number } | null, to: { date: Date; kg: number } | null) {
  if (!from || !to) return null;
  const days = Math.round((to.date.getTime() - from.date.getTime()) / DAY);
  return days > 0 ? Math.round(((to.kg - from.kg) / days) * 1000) / 1000 : null;
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/**
 * Reproduction KPIs of a set of cows from their events:
 * - services per conception (S/C): services / pregnancies confirmed (or calvings) in the period
 * - calving interval (days) between successive calvings, days open (calving to the conceiving service)
 */
export function reproKpis(events: { animalId: string; date: Date; type: string; result: string | null }[]) {
  const byCow = new Map<string, typeof events>();
  for (const e of events) byCow.set(e.animalId, [...(byCow.get(e.animalId) ?? []), e]);
  let services = 0;
  let conceptions = 0;
  const intervals: number[] = [];
  const open: number[] = [];
  let firstServiceOk = 0;
  let firstServices = 0;
  for (const list of byCow.values()) {
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    let lastCalving: Date | null = null;
    let lastService: Date | null = null;
    let servicesThisCycle = 0;
    for (const e of list) {
      if (e.type === 'SERVICE') {
        services++;
        servicesThisCycle++;
        lastService = e.date;
      } else if (e.type === 'PREG_CHECK' && e.result === 'POSITIVE' && servicesThisCycle > 0) {
        conceptions++;
        firstServices++;
        if (servicesThisCycle === 1) firstServiceOk++;
        if (lastCalving && lastService) open.push(daysBetween(lastCalving, lastService));
        servicesThisCycle = -1_000; // counted; ignore more checks until the next calving
      } else if (e.type === 'CALVING') {
        if (lastCalving) intervals.push(daysBetween(lastCalving, e.date));
        lastCalving = e.date;
        servicesThisCycle = 0;
        lastService = null;
      }
    }
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return {
    services,
    conceptions,
    servicesPerConception: conceptions ? r2(services / conceptions) : null,
    firstServiceConceptionPct: firstServices ? Math.round((firstServiceOk / firstServices) * 1000) / 10 : null,
    calvingIntervalDays: avg(intervals),
    daysOpen: avg(open),
  };
}
