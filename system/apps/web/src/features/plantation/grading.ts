/** TBS grading sample: percentages found per class (by weight, as the mill reports it) */
export const GRADING_LABELS: Record<string, string> = {
  unripe: 'Unripe',
  overripe: 'Overripe',
  empty: 'Empty bunches',
  longStalk: 'Long stalk',
  looseFruit: 'Loose fruit',
  dirty: 'Dirty loose fruit',
  under3kg: 'Bunches < 3 kg',
};

export const GRADING_RULE =
  'Deduction: unripe 50%, overripe 25% of the share above 5%, empty bunches 100%, long stalks 1%, loose fruit short of 10%: 30% of the shortfall, dirty loose fruit 2x, bunches under 3 kg 70% (Permentan 13/2024 Lampiran II). Binding for purchases from partner smallholders; mills often use it otherwise.';

export const emptyGrading = (): Record<string, string> => Object.fromEntries(Object.keys(GRADING_LABELS).map((k) => [k, '']));

/** sorting deduction % from a grading sample: same rule as the server */
export function gradingPct(g: Record<string, string>) {
  const v = (k: string) => Math.max(0, Number(g[k] || 0));
  const loose = !g.looseFruit ? 0 : 0.3 * Math.max(0, 10 - v('looseFruit'));
  return Math.min(100, Math.round((0.5 * v('unripe') + 0.25 * Math.max(0, v('overripe') - 5) + v('empty') + 0.01 * v('longStalk') + loose + 2 * v('dirty') + 0.7 * v('under3kg')) * 100) / 100);
}

/** request body part for the grading sample (empty fields left out) */
export const gradingBody = (g: Record<string, string>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v === '' ? null : v]));
