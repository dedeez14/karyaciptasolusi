/** Pure calculations of the garment add-on: SKU codes, cut quantities, bundles, line efficiency. */

/** SKU product code of a style variant: STYLE-COLOUR-SIZE, upper case, safe characters only */
export function skuCode(style: string, colour: string, size: string) {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return `${clean(style)}-${clean(colour)}-${clean(size)}`.slice(0, 40);
}

/** pieces cut per size: ratio per ply x plies */
export function cutQuantities(ratio: Record<string, number>, plies: number) {
  return Object.fromEntries(Object.entries(ratio).filter(([, r]) => r > 0).map(([size, r]) => [size, r * plies]));
}

/**
 * Bundles of a lay: for each size and each marker repeat of that size, the plies are split into bundles of at most
 * bundleSize plies (pieces), numbered on from the last bundle of the order; ply ranges keep pieces of one shade together.
 */
export function makeBundles(ratio: Record<string, number>, plies: number, bundleSize: number, firstNo: number, sizes: string[]) {
  const out: { bundleNo: number; size: string; plyFrom: number; plyTo: number; qty: number }[] = [];
  let no = firstNo;
  const order = sizes.filter((s) => (ratio[s] ?? 0) > 0).concat(Object.keys(ratio).filter((s) => !sizes.includes(s) && ratio[s] > 0));
  for (const size of order) {
    for (let rep = 0; rep < ratio[size]; rep++) {
      for (let from = 1; from <= plies; from += bundleSize) {
        const to = Math.min(plies, from + bundleSize - 1);
        out.push({ bundleNo: no++, size, plyFrom: from, plyTo: to, qty: to - from + 1 });
      }
    }
  }
  return out;
}

/** sewing line efficiency (%): minutes produced (pieces x SAM) / minutes available (operators x minutes) */
export function lineEfficiency(pieces: number, sam: number, operators: number, minutes: number) {
  const available = operators * minutes;
  return available > 0 ? Math.round(((pieces * sam) / available) * 10_000) / 100 : 0;
}

/** fabric per piece actually cut against the standard per piece of the style (%) */
export function fabricVariance(fabricQty: number, pieces: number, standardPerPiece: number) {
  if (!pieces || !standardPerPiece) return null;
  const actual = fabricQty / pieces;
  return { actualPerPiece: Math.round(actual * 10_000) / 10_000, variancePct: Math.round(((actual - standardPerPiece) / standardPerPiece) * 10_000) / 100 };
}
