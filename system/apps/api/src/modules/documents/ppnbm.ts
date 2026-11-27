/**
 * PPnBM on motor vehicles (PP 73/2019 jo PP 74/2021, PMK 141/2021 jo 42/2022): tax = rate x DPP, the DPP a share of the
 * selling price. Charged once, by the manufacturer / importer. stage2 = the higher DPPs of Art. 36B, used once the
 * Minister of Finance decides the BEV investment trigger has been met.
 */
export interface PpnbmGroup {
  code: string;
  article: string;
  label: string;
  rate: number;
  basePct: number;
  basePctStage2?: number;
}

const g = (code: string, label: string, rate: number, basePct = 100, basePctStage2?: number): PpnbmGroup => ({ code, article: `Pasal ${code.slice(1)}`, label, rate, basePct, basePctStage2 });

export const PPNBM_GROUPS: PpnbmGroup[] = [
  g('P4', 'Passenger car < 10 seats, <= 3,000 cc, > 15.5 km/l petrol / > 17.5 diesel or CO2 < 150 g/km', 15),
  g('P5', 'Passenger car < 10 seats, <= 3,000 cc, 11.5-15.5 km/l petrol or CO2 150-200 g/km', 20),
  g('P6', 'Passenger car < 10 seats, <= 3,000 cc, 9.3-11.5 km/l petrol or CO2 200-250 g/km', 25),
  g('P7', 'Passenger car < 10 seats, <= 3,000 cc, < 9.3 km/l petrol or CO2 > 250 g/km', 40),
  g('P8', 'Passenger car < 10 seats, 3,000-4,000 cc, first band', 40),
  g('P9', 'Passenger car < 10 seats, 3,000-4,000 cc, second band', 50),
  g('P10', 'Passenger car < 10 seats, 3,000-4,000 cc, third band', 60),
  g('P11', 'Passenger car < 10 seats, 3,000-4,000 cc, fourth band', 70),
  g('P12', 'Passenger car < 10 seats, electric motor', 15),
  g('P13', '10-15 seats, <= 3,000 cc, > 11.6 km/l petrol / > 13.1 diesel or CO2 < 200 g/km', 15),
  g('P14', '10-15 seats, <= 3,000 cc, other', 20),
  g('P15', '10-15 seats, 3,000-4,000 cc, first band', 25),
  g('P16', '10-15 seats, 3,000-4,000 cc, other', 30),
  g('P17', '10-15 seats, electric motor', 15),
  g('P18', 'Double cabin, <= 3,000 cc, CO2 < 150 g/km', 10),
  g('P19', 'Double cabin, <= 3,000 cc, CO2 150-200 g/km', 12),
  g('P20', 'Double cabin, <= 3,000 cc, CO2 > 200 g/km', 15),
  g('P21', 'Double cabin, 3,000-4,000 cc, CO2 < 150 g/km', 20),
  g('P22', 'Double cabin, 3,000-4,000 cc, CO2 150-200 g/km', 25),
  g('P23', 'Double cabin, 3,000-4,000 cc, CO2 > 200 g/km', 30),
  g('P24', 'Double cabin, electric motor', 10),
  g('P25', 'Low-cost green car (KBH2 / LCGC)', 15, 20),
  g('P26', 'Full hybrid <= 3,000 cc, > 23 km/l petrol / > 26 diesel or CO2 < 100 g/km', 15, 40, 66.6667),
  g('P27', 'Full hybrid <= 3,000 cc, 18.4-23 km/l or CO2 100-125 g/km', 15, 46.6667, 73.3333),
  g('P28', 'Full hybrid <= 3,000 cc, 15.5-18.4 km/l or CO2 125-150 g/km', 15, 53.3333, 80),
  g('P29', 'Mild hybrid <= 3,000 cc, > 23 km/l or CO2 < 100 g/km', 15, 53.3333, 80),
  g('P30', 'Mild hybrid <= 3,000 cc, 18.4-23 km/l or CO2 100-125 g/km', 15, 66.6667, 86.6667),
  g('P31', 'Mild hybrid <= 3,000 cc, 15.5-18.4 km/l or CO2 125-150 g/km', 15, 80, 93.3333),
  g('P32', 'Full / mild hybrid 3,000-4,000 cc, first band', 20),
  g('P33', 'Full / mild hybrid 3,000-4,000 cc, second band', 25),
  g('P34', 'Full / mild hybrid 3,000-4,000 cc, third band', 30),
  g('P35', 'Flexy engine (bio fuel 100)', 15, 53.3333),
  g('P36', 'Battery / fuel-cell electric (BEV / FCEV)', 15, 0),
  g('P36A', 'Plug-in hybrid (PHEV), > 28 km/l or CO2 <= 100 g/km', 15, 33.3333, 53.3333),
  g('P38', 'Golf vehicles', 50),
  g('P39', 'Motorcycle / 3-wheeler 250-500 cc; snow, beach and mountain vehicles', 60),
  g('P40', 'Over 4,000 cc; motorcycle / 3-wheeler over 500 cc; caravan trailers', 95),
];
export const ppnbmGroup = (code: string | null | undefined) => (code ? PPNBM_GROUPS.find((x) => x.code === code) : undefined);

/** effective DPP share and rate of a group (stage 2 DPP when switched on and the group has one) */
export function ppnbmTerms(code: string | null | undefined, stage2: boolean) {
  const grp = ppnbmGroup(code);
  if (!grp) return null;
  return { code: grp.code, rate: grp.rate, basePct: stage2 && grp.basePctStage2 !== undefined ? grp.basePctStage2 : grp.basePct };
}

export interface VehicleSpec {
  category: string; // PASSENGER | MPV | DOUBLE_CABIN | PICKUP | TRUCK | BUS | MOTORCYCLE | GOLF | OTHER
  fuel: string; // PETROL | DIESEL | HEV | MHEV | PHEV | BEV | FCEV | FLEXY
  engineCc: number | null;
  seats: number | null;
  kmPerL: number | null;
  co2: number | null;
  lcgc?: boolean;
  dieselEngine?: boolean;
}

/**
 * Suggested PPnBM group from the type's specification and its emission / fuel test: either figure may qualify (the
 * better band wins). A hint only: the group follows PMK 141/2021 Lampiran I (HS code) and the Kemenhub test certificate.
 */
export function suggestPpnbm(s: VehicleSpec): { code: string | null; reason: string } {
  const cc = s.engineCc ?? 0;
  const diesel = !!s.dieselEngine || s.fuel === 'DIESEL';
  const km = s.kmPerL ?? 0;
  const co2 = s.co2 ?? Infinity;
  if (['PICKUP', 'TRUCK', 'BUS'].includes(s.category)) return { code: null, reason: 'Goods vehicles, pick-ups and buses are not subject to PPnBM' };
  if (s.category === 'GOLF') return { code: 'P38', reason: 'Golf vehicle' };
  if (s.category === 'MOTORCYCLE') return cc > 500 ? { code: 'P40', reason: 'Over 500 cc' } : cc > 250 ? { code: 'P39', reason: '250-500 cc' } : { code: null, reason: 'Motorcycles up to 250 cc are not subject to PPnBM' };
  if (cc > 4000) return { code: 'P40', reason: 'Over 4,000 cc' };
  if (s.fuel === 'BEV' || s.fuel === 'FCEV') return { code: 'P36', reason: 'Battery / fuel-cell electric (DPP 0%)' };
  if (s.fuel === 'PHEV') return km > 28 || co2 <= 100 ? { code: 'P36A', reason: 'Plug-in hybrid' } : { code: null, reason: 'PHEV above 100 g/km: check the group with the test certificate' };
  if (s.lcgc && cc <= (diesel ? 1500 : 1200) && (km >= (diesel ? 21.8 : 20) || co2 <= 120)) return { code: 'P25', reason: 'LCGC (KBH2)' };
  const band = (good: number, mid: number, low: number, co2Bands: number[]) => {
    const byKm = km > good ? 0 : km > mid ? 1 : km > low ? 2 : 3;
    const byCo2 = co2 < co2Bands[0] ? 0 : co2 <= co2Bands[1] ? 1 : co2 <= co2Bands[2] ? 2 : 3;
    return Math.min(byKm, byCo2);
  };
  if (s.fuel === 'HEV' || s.fuel === 'MHEV') {
    const b = band(diesel ? 26 : 23, diesel ? 20 : 18.4, diesel ? 17.5 : 15.5, [100, 125, 150]);
    if (b < 3) {
      if (cc > 3000) return { code: `P${32 + b}`, reason: 'Hybrid 3,000-4,000 cc' };
      return { code: `P${(s.fuel === 'HEV' ? 26 : 29) + b}`, reason: s.fuel === 'HEV' ? 'Full hybrid' : 'Mild hybrid' };
    }
  }
  if (s.category === 'DOUBLE_CABIN') {
    const b = co2 < 150 ? 0 : co2 <= 200 ? 1 : 2;
    return { code: `P${(cc > 3000 ? 21 : 18) + b}`, reason: 'Double cabin by CO2' };
  }
  if (s.category === 'MPV' || (s.seats ?? 0) >= 10) {
    const good = km > (diesel ? 13.1 : 11.6) || co2 < 200;
    return { code: cc > 3000 ? (good ? 'P15' : 'P16') : good ? 'P13' : 'P14', reason: '10-15 seats' };
  }
  const b = band(diesel ? 17.5 : 15.5, diesel ? 13 : 11.5, diesel ? 10.5 : 9.3, [150, 200, 250]);
  return { code: `P${(cc > 3000 ? 8 : 4) + b}`, reason: `Passenger car, band ${b + 1}` };
}

/** PPnBM of a line: net price x DPP % x rate */
export const ppnbmAmount = (net: number, rate: number, basePct: number) => Math.round(net * (basePct / 100) * (rate / 100) * 100) / 100;
