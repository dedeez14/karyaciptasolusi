/**
 * Corrugator deckle / trim planning: put sheets (blank widths across the machine) side by side on a paper roll width
 * so that the side trim is at least the minimum and as small as possible. One item (n outs) or two items run together.
 */
export interface TrimItem {
  key: string;
  sheetWidth: number; // mm across the corrugator
  sheetLength: number; // mm along the corrugator (cut-off)
  sheets: number; // sheets needed
}

export interface TrimOption {
  rollWidth: number;
  outs: { key: string; outs: number }[];
  usedWidth: number;
  trim: number;
  trimPct: number;
  /** running metres of board for the item(s) on this combination */
  runMetres: number;
  /** m2 of the roll consumed and m2 lost as side trim */
  rollM2: number;
  trimM2: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** best ways to run one item: every roll width, the most outs that leave at least minTrim, ranked by trim % */
export function planSingle(item: TrimItem, rollWidths: number[], minTrim: number, maxOuts = 8): TrimOption[] {
  const out: TrimOption[] = [];
  for (const roll of rollWidths) {
    const outs = Math.min(maxOuts, Math.floor((roll - minTrim) / item.sheetWidth));
    if (outs < 1) continue;
    const used = outs * item.sheetWidth;
    const trim = roll - used;
    const runMetres = (Math.ceil(item.sheets / outs) * item.sheetLength) / 1000;
    out.push({ rollWidth: roll, outs: [{ key: item.key, outs }], usedWidth: used, trim, trimPct: r2((trim / roll) * 100), runMetres: r2(runMetres), rollM2: r2((runMetres * roll) / 1000), trimM2: r2((runMetres * trim) / 1000) });
  }
  return out.sort((a, b) => a.trimPct - b.trimPct || b.outs[0].outs - a.outs[0].outs);
}

/**
 * two items side by side on the same run (same board grade and flute): a outs of the first + b outs of the second.
 * The run length follows the item that needs more metres; ranked by trim %.
 */
export function planPair(a: TrimItem, b: TrimItem, rollWidths: number[], minTrim: number, maxOuts = 6): TrimOption[] {
  const res: TrimOption[] = [];
  for (const roll of rollWidths) {
    for (let x = 1; x <= maxOuts; x++) {
      for (let y = 1; y <= maxOuts; y++) {
        const used = x * a.sheetWidth + y * b.sheetWidth;
        if (used > roll - minTrim) break;
        const trim = roll - used;
        const metresA = (Math.ceil(a.sheets / x) * a.sheetLength) / 1000;
        const metresB = (Math.ceil(b.sheets / y) * b.sheetLength) / 1000;
        const runMetres = Math.max(metresA, metresB);
        res.push({
          rollWidth: roll,
          outs: [
            { key: a.key, outs: x },
            { key: b.key, outs: y },
          ],
          usedWidth: used,
          trim,
          trimPct: r2((trim / roll) * 100),
          runMetres: r2(runMetres),
          rollM2: r2((runMetres * roll) / 1000),
          trimM2: r2((runMetres * trim) / 1000),
        });
      }
    }
  }
  return res.sort((p, q) => p.trimPct - q.trimPct).slice(0, 20);
}
