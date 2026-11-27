/** Loan schedules: flat (interest on the original principal) or annuity (effective rate on the balance). */
const r2 = (v: number) => Math.round(v * 100) / 100;

export const addMonths = (d: Date, k: number) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), Math.min(d.getUTCDate(), last)));
};

export function schedule(principal: number, ratePct: number, months: number, method: string, firstDue: Date) {
  const out: { seq: number; dueDate: Date; principal: number; interest: number }[] = [];
  const r = ratePct / 100 / 12;
  let left = principal;
  if (method === 'ANNUITY' && r > 0) {
    const pay = (principal * r) / (1 - Math.pow(1 + r, -months));
    for (let k = 0; k < months; k++) {
      const interest = r2(left * r);
      const p = k === months - 1 ? r2(left) : r2(pay - interest);
      left = r2(left - p);
      out.push({ seq: k + 1, dueDate: addMonths(firstDue, k), principal: p, interest });
    }
  } else {
    const p = Math.floor((principal / months) * 100) / 100;
    const interest = r2(principal * r);
    for (let k = 0; k < months; k++) {
      const pp = k === months - 1 ? r2(left) : p;
      left = r2(left - pp);
      out.push({ seq: k + 1, dueDate: addMonths(firstDue, k), principal: pp, interest });
    }
  }
  return out;
}

/** effective annual rate of a flat rate (shown to the member) */
export function effectiveOfFlat(ratePct: number, months: number) {
  const pay = (1 + (ratePct / 100 / 12) * months) / months;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const ann = mid / (1 - Math.pow(1 + mid, -months));
    if (ann > pay) hi = mid;
    else lo = mid;
  }
  return Math.round(lo * 12 * 10000) / 100;
}

/** provision rates "days:pct,days:pct" -> sorted thresholds */
export function parseRates(s: string) {
  return s
    .split(',')
    .map((x) => x.split(':').map(Number))
    .filter(([d, p]) => Number.isFinite(d) && Number.isFinite(p))
    .map(([days, pct]) => ({ days, pct }))
    .sort((a, b) => a.days - b.days);
}

export const COLLECT = [
  { from: 0, label: 'Current (lancar)' },
  { from: 1, label: 'Special mention (dalam perhatian khusus)' },
  { from: 91, label: 'Substandard (kurang lancar)' },
  { from: 121, label: 'Doubtful (diragukan)' },
  { from: 181, label: 'Loss (macet)' },
];
export const collectOf = (days: number) => [...COLLECT].reverse().find((c) => days >= c.from)!.label;
