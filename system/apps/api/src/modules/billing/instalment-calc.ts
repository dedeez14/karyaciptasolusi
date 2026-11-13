/** Pure helpers of instalment plans: the schedule, payments spread over it, lateness and late fees. */

const r2 = (v: number) => Math.round(v * 100) / 100;
const DAY = 86_400_000;

/** add whole months to a date, keeping the day where the month allows (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(d: Date, months: number, day?: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const want = day ?? d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(want, last)));
}

export interface ScheduleRow {
  seq: number; // 0 = down payment
  dueDate: Date;
  amount: number;
}

/**
 * Down payment (on its date) then `count` equal instalments every `intervalMonths` from the first due date; the
 * rounding difference goes to the last instalment so the rows add up to the total exactly.
 */
export function buildSchedule(total: number, downPayment: number, count: number, firstDue: Date, intervalMonths: number, dpDate?: Date): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  if (downPayment > 0) rows.push({ seq: 0, dueDate: dpDate ?? firstDue, amount: r2(downPayment) });
  const rest = r2(total - downPayment);
  const each = Math.floor((rest / count) * 100) / 100;
  for (let i = 1; i <= count; i++) rows.push({ seq: i, dueDate: addMonths(firstDue, (i - 1) * intervalMonths, firstDue.getUTCDate()), amount: i === count ? r2(rest - each * (count - 1)) : each });
  return rows;
}

/** spread what has been paid over the rows in due order (oldest first) */
export function waterfall(rows: { amount: number }[], paid: number) {
  let left = paid;
  return rows.map((r) => {
    const p = Math.max(0, Math.min(r.amount, left));
    left = r2(left - p);
    return { paid: r2(p), open: r2(r.amount - p) };
  });
}

/** days late after the grace period (0 = not late) */
export const daysLate = (due: Date, asOf: Date, graceDays: number) => Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / DAY) - graceDays);

/** late fee: open amount x % per month, pro rata by day (30-day month), less what was already charged */
export function lateFee(open: number, days: number, pctPerMonth: number, alreadyCharged: number, capPct?: number | null) {
  if (open <= 0 || days <= 0 || pctPerMonth <= 0) return 0;
  let fee = (open * pctPerMonth * days) / 100 / 30;
  if (capPct && capPct > 0) fee = Math.min(fee, (open * capPct) / 100);
  return Math.max(0, Math.round(fee - alreadyCharged));
}
