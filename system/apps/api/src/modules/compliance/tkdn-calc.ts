/**
 * TKDN of goods, Permenperin 35/2025 (in force 11 Dec 2025):
 * - Art. 4: direct material 75%, direct labour 10%, factory overhead 15%;
 * - Art. 5 + Annex I form 1.1: material factor = sum of (cost share of each main component x its credited domestic
 *   share); a certified component counts 100 / 80 / 60 / 40 / 25% by its TKDN band, an uncertified one 100% when
 *   made in Indonesia from all-domestic materials (or a domestic natural resource), 25% when made in Indonesia by an
 *   industrial company, else 0%;
 * - Art. 6 / 7: labour and overhead 100% (own or rented factory), 60% (own staff in another firm's factory), 30%
 *   (made by another firm), 0% when fewer than 50% of direct workers are Indonesian / the firm did not invest here;
 * - Art. 10-12 + Annex II form 1.5: brainware adds up to 20% (criteria weights 30 / 20 / 20 / 30), total capped at 100%.
 */

export type TkdnMode = 'OWN' | 'OTHER_FACTORY' | 'OUTSOURCED';

export interface TkdnLineInput {
  qty: number;
  unitPrice: number;
  originCountry: string;
  hasCertificate: boolean;
  certTkdn?: number | null;
  domesticProducer: boolean;
  allDomesticMaterials: boolean;
}

export interface TkdnInput {
  lines: TkdnLineInput[];
  productionMode: TkdnMode;
  investedInIndonesia: boolean;
  directLabourTotal: number;
  directLabourWni: number;
  bwInvestment: number;
  bwUnit: number;
  bwProgram: number;
  bwImplementation: number;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const domestic = (country: string) => (country || 'ID').toUpperCase() === 'ID' || (country || '').toUpperCase() === 'IDN';

/** Art. 5 (2): the domestic share credited for one main component */
export function componentCredit(l: TkdnLineInput): number {
  if (!domestic(l.originCountry)) return 0;
  if (l.hasCertificate && l.certTkdn !== null && l.certTkdn !== undefined) {
    const v = Number(l.certTkdn);
    if (v > 80) return 100;
    if (v > 60) return 80;
    if (v > 40) return 60;
    if (v >= 25) return 40;
    return 25;
  }
  if (l.allDomesticMaterials) return 100;
  if (l.domesticProducer) return 25;
  return 0;
}

const modeCredit = (mode: TkdnMode) => (mode === 'OWN' ? 100 : mode === 'OTHER_FACTORY' ? 60 : 30);

export function computeTkdn(input: TkdnInput) {
  const costs = input.lines.map((l) => Math.max(0, Number(l.qty) * Number(l.unitPrice)));
  const total = costs.reduce((a, b) => a + b, 0);
  const lines = input.lines.map((l, i) => {
    const creditPct = componentCredit(l);
    const proportion = total > 0 ? (costs[i] / total) * 100 : 0;
    return { cost: costs[i], proportion: r4(proportion), creditPct, share: r4((proportion * creditPct) / 100) };
  });
  const materialFactor = r4(lines.reduce((a, l) => a + l.share, 0));
  const wniShare = input.directLabourTotal > 0 ? (input.directLabourWni / input.directLabourTotal) * 100 : 0;
  const labourFactor = input.directLabourTotal > 0 && wniShare >= 50 ? modeCredit(input.productionMode) : 0;
  const overheadFactor = input.investedInIndonesia ? modeCredit(input.productionMode) : 0;
  const goods = r4(materialFactor * 0.75 + labourFactor * 0.1 + overheadFactor * 0.15);
  const criteria = r4(input.bwInvestment * 0.3 + input.bwUnit * 0.2 + input.bwProgram * 0.2 + input.bwImplementation * 0.3);
  const brainware = r4((criteria * 20) / 100);
  const tkdn = r4(Math.min(100, goods + brainware));
  const warnings: string[] = [];
  if (input.lines.length && input.lines.every((l) => !domestic(l.originCountry))) warnings.push('All materials are imported: TKDN cannot be calculated for such goods (Art. 9 (2) a)');
  if (input.directLabourTotal <= 0) warnings.push('Enter the number of direct production workers (form 1.2)');
  else if (wniShare < 50) warnings.push('Fewer than 50% of direct workers are Indonesian: labour counts 0% (Art. 6 d)');
  if (input.directLabourWni > input.directLabourTotal) warnings.push('Indonesian workers exceed the total');
  return {
    total,
    lines,
    wniShare: r4(wniShare),
    materialFactor,
    labourFactor,
    overheadFactor,
    materialTkdn: r4(materialFactor * 0.75),
    labourTkdn: r4(labourFactor * 0.1),
    overheadTkdn: r4(overheadFactor * 0.15),
    goods,
    brainwareCriteria: criteria,
    brainware,
    tkdn,
    warnings,
  };
}
