/**
 * Pure helpers of the carton estimator: blank sizes (FEFCO styles), board weight and cost, box compression (McKee) and
 * the cost build-up per quantity.
 */

export interface Flute {
  code: string;
  walls: number; // 1 single wall, 2 double wall
  caliper: number; // mm
  takeUp1: number;
  takeUp2: number | null;
  allowLW: number; // mm added to L and W panels (score to score)
  allowH: number; // mm added to the depth
}

/** plant defaults, to be replaced by the plant's own measured calipers (FEFCO ranges; allowances per flute) */
export const DEFAULT_FLUTES: (Flute & { name: string })[] = [
  { code: 'A', name: 'A flute', walls: 1, caliper: 4.8, takeUp1: 1.52, takeUp2: null, allowLW: 6, allowH: 12 },
  { code: 'C', name: 'C flute', walls: 1, caliper: 3.8, takeUp1: 1.43, takeUp2: null, allowLW: 5, allowH: 10 },
  { code: 'B', name: 'B flute', walls: 1, caliper: 2.8, takeUp1: 1.33, takeUp2: null, allowLW: 3, allowH: 6 },
  { code: 'E', name: 'E flute', walls: 1, caliper: 1.4, takeUp1: 1.27, takeUp2: null, allowLW: 2, allowH: 3 },
  { code: 'F', name: 'F flute', walls: 1, caliper: 0.7, takeUp1: 1.2, takeUp2: null, allowLW: 1, allowH: 2 },
  { code: 'BC', name: 'BC double wall', walls: 2, caliper: 6.6, takeUp1: 1.33, takeUp2: 1.43, allowLW: 6, allowH: 13 },
  { code: 'EB', name: 'EB double wall', walls: 2, caliper: 4.2, takeUp1: 1.27, takeUp2: 1.33, allowLW: 5, allowH: 10 },
];

export const STYLES: Record<string, string> = {
  '0201': 'FEFCO 0201 regular slotted case (RSC)',
  '0200': 'FEFCO 0200 half slotted case (HSC)',
  '0203': 'FEFCO 0203 full overlap (FOL)',
  '0300': 'FEFCO 0300 tray',
  '0427': 'FEFCO 0427 die-cut mailer',
  SHEET: 'Flat sheet / pad',
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * blank (sheet) size from the inside dimensions: length runs along the corrugator (cut-off), width across it (flutes
 * parallel to the depth, for stacking strength). Glue flap J for the slotted styles.
 */
export function blankSize(style: string, L: number, W: number, H: number, f: Pick<Flute, 'allowLW' | 'allowH'>, glueFlap = 35) {
  const l = L + f.allowLW;
  const w = W + f.allowLW;
  const h = H + f.allowH;
  switch (style) {
    case '0201':
      return { length: r1(glueFlap + 2 * l + 2 * w), width: r1(h + w), panels: { l, w, h, flap: r1(w / 2), glueFlap } };
    case '0200':
      return { length: r1(glueFlap + 2 * l + 2 * w), width: r1(h + w / 2), panels: { l, w, h, flap: r1(w / 2), glueFlap } };
    case '0203':
      return { length: r1(glueFlap + 2 * l + 2 * w), width: r1(h + 2 * w), panels: { l, w, h, flap: w, glueFlap } };
    case '0300':
      return { length: r1(l + 2 * h), width: r1(w + 2 * h), panels: { l, w, h, flap: 0, glueFlap: 0 } };
    case '0427': {
      // approximation: the die drawing gives the real blank
      const tuck = Math.max(10, h - 5);
      return { length: r1(2 * w + 4 * h + tuck), width: r1(l + 4 * h), panels: { l, w, h, flap: tuck, glueFlap: 0 } };
    }
    default:
      return { length: r1(L), width: r1(W), panels: { l: L, w: W, h: 0, flap: 0, glueFlap: 0 } };
  }
}

export interface Layer {
  role: 'LINER' | 'MEDIUM';
  gsm: number;
  pricePerKg: number;
}

/** board basis weight and paper cost per m2: liners + mediums x take-up + starch per glue line */
export function boardWeight(layers: Layer[], f: Pick<Flute, 'walls' | 'takeUp1' | 'takeUp2'>, starchPerLine: number, starchPricePerKg: number) {
  let mediumNo = 0;
  let gsm = 0;
  let cost = 0;
  for (const x of layers) {
    let g = x.gsm;
    if (x.role === 'MEDIUM') {
      mediumNo++;
      g = x.gsm * (mediumNo === 1 ? f.takeUp1 : (f.takeUp2 ?? f.takeUp1));
    }
    gsm += g;
    cost += (g / 1000) * x.pricePerKg;
  }
  const glueLines = 2 * f.walls;
  const starch = glueLines * starchPerLine;
  return { gsm: r1(gsm + starch), paperGsm: r1(gsm), starchGsm: r1(starch), costPerM2: r2(cost + (starch / 1000) * starchPricePerKg) };
}

/** expected layer count for the flute: single wall L-M-L, double wall L-M-L-M-L */
export const layerPattern = (walls: number) => (walls === 2 ? ['LINER', 'MEDIUM', 'LINER', 'MEDIUM', 'LINER'] : ['LINER', 'MEDIUM', 'LINER']);

/** McKee: BCT (N) = 5.87 x ECT (N/m) x sqrt(caliper (m) x perimeter (m)); perimeter of the box outside */
export function mckee(ectNm: number, caliperMm: number, L: number, W: number) {
  const perimeter = (2 * (L + W)) / 1000;
  return Math.round(5.87 * ectNm * Math.sqrt((caliperMm / 1000) * perimeter));
}

/** compression the bottom box must hold: boxes above x gross weight x g x safety factor */
export function requiredBct(grossKg: number, stackHeight: number, safetyFactor: number) {
  return Math.round(Math.max(0, stackHeight - 1) * grossKg * 9.81 * safetyFactor);
}

export interface Rates {
  corrugatingPerM2: number;
  corrugatorWastePct: number;
  printSetupPerColour: number;
  printPer1000PerColour: number;
  slotPer1000: number;
  printWastePct: number;
  dieSetup: number;
  diePer1000: number;
  dieWastePct: number;
  gluePerBox: number;
  stitchPerBox: number;
  tapePerBox: number;
  jointWastePct: number;
  overheadPct: number;
  marginPct: number;
  platePerCm2: number;
  diePerMetre: number;
}

export interface EstimateInput {
  kind: 'GOODS' | 'MAKLON';
  blankM2: number;
  blankLength: number;
  blankWidth: number;
  boardCostPerM2: number; // paper + starch
  colours: number;
  printCoveragePct: number;
  dieCut: boolean;
  joint: 'GLUE' | 'STITCH' | 'TAPE' | 'NONE';
  /** new tooling to make: plates and / or die (existing customer / plant tooling is reused) */
  newPlates: boolean;
  newDie: boolean;
  billToolingSeparately: boolean;
}

/** tooling one-offs: plates per colour on the printed area, die by its rule length (blank outline x 1.6 for scores and cuts) */
export function toolingCost(i: Pick<EstimateInput, 'blankLength' | 'blankWidth' | 'colours' | 'printCoveragePct' | 'dieCut' | 'newPlates' | 'newDie'>, r: Pick<Rates, 'platePerCm2' | 'diePerMetre'>) {
  const plateCm2 = Math.round(((i.blankLength * i.blankWidth) / 100) * (i.printCoveragePct / 100));
  const plates = i.newPlates && i.colours > 0 ? Math.round(i.colours * plateCm2 * r.platePerCm2) : 0;
  const ruleM = r2(((2 * (i.blankLength + i.blankWidth)) / 1000) * 1.6);
  const die = i.newDie && i.dieCut ? Math.round(ruleM * r.diePerMetre) : 0;
  return { plateCm2, plates, ruleM, die, total: plates + die };
}

/** cost and price per box for one order quantity */
export function costFor(qty: number, i: EstimateInput, r: Rates) {
  const convWaste = (i.colours > 0 || !i.dieCut ? r.printWastePct : 0) + (i.dieCut ? r.dieWastePct : 0) + (i.joint !== 'NONE' ? r.jointWastePct : 0);
  const gross = Math.ceil(qty / (1 - convWaste / 100));
  const boardM2 = (gross * i.blankM2) / (1 - r.corrugatorWastePct / 100);
  const board = i.kind === 'MAKLON' ? 0 : boardM2 * (i.boardCostPerM2 + r.corrugatingPerM2);
  const printing = i.colours > 0 ? i.colours * (r.printSetupPerColour + (r.printPer1000PerColour * gross) / 1000) : i.dieCut ? 0 : (r.slotPer1000 * gross) / 1000;
  const dieCut = i.dieCut ? r.dieSetup + (r.diePer1000 * gross) / 1000 : 0;
  const joint = qty * (i.joint === 'GLUE' ? r.gluePerBox : i.joint === 'STITCH' ? r.stitchPerBox : i.joint === 'TAPE' ? r.tapePerBox : 0);
  const tooling = i.billToolingSeparately ? 0 : toolingCost(i, r).total;
  const direct = board + printing + dieCut + joint + tooling;
  const overhead = (direct * r.overheadPct) / 100;
  const cost = direct + overhead;
  const price = cost / (1 - r.marginPct / 100);
  return {
    qty,
    gross,
    boardM2: Math.round(boardM2),
    board: Math.round(board),
    printing: Math.round(printing),
    dieCut: Math.round(dieCut),
    joint: Math.round(joint),
    tooling: Math.round(tooling),
    overhead: Math.round(overhead),
    cost: Math.round(cost),
    unitCost: r2(cost / qty),
    unitPrice: Math.ceil((price / qty) * 100) / 100,
    total: Math.round(price),
  };
}
