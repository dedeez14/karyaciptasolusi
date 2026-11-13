/** Pure calculations of the plantation module (wages of the daily work book, weighbridge, plot geometry). */

export interface ActivityRule {
  kind: string;
  uom: string;
  wageBasis: string;
  dailyRate: number;
  pieceRate: number;
  baseTask: number;
  premiumRate: number;
  penaltyUnripe: number;
  penaltyLongStalk: number;
  penaltyLooseLeft: number;
  penaltyOther: number;
}

export interface WorkInput {
  hk: number;
  qty: number;
  bunches: number;
  looseFruitKg: number;
  unripe: number;
  longStalk: number;
  looseLeft: number;
  otherFaults: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r0 = (v: number) => Math.round(v);

/**
 * Output of a harvester: bunches (uom BUNCH) or kg estimated from the bunches and the BJR of the block plus loose fruit (uom KG).
 * Other activities: the output entered (ha, palms, metres...).
 */
export function workOutput(a: Pick<ActivityRule, 'kind' | 'uom'>, w: Pick<WorkInput, 'qty' | 'bunches' | 'looseFruitKg'>, bjrKg: number) {
  if (a.kind !== 'HARVEST') return w.qty;
  if (a.uom === 'BUNCH') return w.bunches;
  if (a.uom === 'KG') return r2(w.bunches * bjrKg + w.looseFruitKg);
  return w.qty;
}

/**
 * Pay of one line of the BKM.
 * DAILY: HK x daily rate, plus the premium per unit above the base task (basis borong x HK).
 * PIECE: output x piece rate, plus the same premium when a base task is set.
 * Penalties (harvest grading) are capped at the pay of the line: a worker never owes money for a day of work.
 */
export function workPay(a: ActivityRule, w: WorkInput, output: number) {
  const wage = a.wageBasis === 'PIECE' ? r0(output * a.pieceRate) : r0(w.hk * a.dailyRate);
  const base = a.baseTask * w.hk;
  const premium = a.baseTask > 0 && a.premiumRate > 0 && output > base ? r0((output - base) * a.premiumRate) : 0;
  const rawPenalty = r0(w.unripe * a.penaltyUnripe + w.longStalk * a.penaltyLongStalk + w.looseLeft * a.penaltyLooseLeft + w.otherFaults * a.penaltyOther);
  const penalty = Math.min(rawPenalty, wage + premium);
  return { wage, premium, penalty, amount: wage + premium - penalty, penaltyCapped: rawPenalty > penalty };
}

/** Weighbridge: net = gross - tare; sorting deduction by kg or % of the net; accepted = net - sorting */
export function weigh(grossKg: number, tareKg: number, sortingPct: number, sortingKg: number | null) {
  const netKg = r2(grossKg - tareKg);
  const sort = sortingKg !== null ? r2(sortingKg) : r2((netKg * sortingPct) / 100);
  const pct = netKg > 0 ? r2((sort / netKg) * 100) : 0;
  return { netKg, sortingKg: sort, sortingPct: pct, acceptedKg: r2(netKg - sort) };
}

/** grading sample: percentage of the load found in each class (by weight, as the mill reports it) */
export interface Grading {
  unripe?: number;
  overripe?: number;
  empty?: number;
  longStalk?: number;
  /** loose fruit share of the load (the norm is at least 10%) */
  looseFruit?: number | null;
  dirty?: number;
  under3kg?: number;
}

/**
 * Sorting deduction (% of the net weight) by Permentan 13/2024 Lampiran II, binding on purchases from partner smallholders
 * and commonly used by mills otherwise: unripe 50%, overripe 25% of the share above 5%, empty bunches 100%, long stalks 1%,
 * loose fruit short of 10%: 30% of the shortfall, dirty loose fruit 2x, bunches under 3 kg 70%.
 */
export function gradingDeduction(g: Grading) {
  const v = (x: number | null | undefined) => Math.max(0, Number(x ?? 0));
  const parts = {
    unripe: 0.5 * v(g.unripe),
    overripe: 0.25 * Math.max(0, v(g.overripe) - 5),
    empty: v(g.empty),
    longStalk: 0.01 * v(g.longStalk),
    looseFruit: g.looseFruit === null || g.looseFruit === undefined ? 0 : 0.3 * Math.max(0, 10 - v(g.looseFruit)),
    dirty: 2 * v(g.dirty),
    under3kg: 0.7 * v(g.under3kg),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, pct: Math.min(100, Math.round(total * 100) / 100) };
}

/** Spreads the accepted weight over the lines in proportion to the estimate (bunches when nothing was estimated); the last line takes the rounding */
export function allocate(total: number, weights: number[]) {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let left = total;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) out.push(r2(left));
    else {
      const v = sumW > 0 ? r2((total * w) / sumW) : r2(total / weights.length);
      out.push(v);
      left -= v;
    }
  });
  return out;
}

// ------------------------------------------------------------------ geometry (GeoJSON, WGS84)

type Ring = [number, number][];

/** validates a GeoJSON Polygon / MultiPolygon (or a Feature holding one) and returns its polygons; throws a message */
export function parsePolygons(g: unknown): Ring[][] {
  let geo = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (geo?.type === 'FeatureCollection') {
    if (!Array.isArray(geo.features) || geo.features.length !== 1) throw new Error('Paste one plot (a single Feature)');
    geo = geo.features[0] as typeof geo;
  }
  if (geo?.type === 'Feature') geo = geo.geometry as typeof geo;
  if (!geo || (geo.type !== 'Polygon' && geo.type !== 'MultiPolygon')) throw new Error('The boundary must be a GeoJSON Polygon or MultiPolygon');
  const polys = (geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates) as unknown[];
  if (!Array.isArray(polys) || !polys.length) throw new Error('The polygon has no coordinates');
  return polys.map((p) => {
    if (!Array.isArray(p) || !p.length) throw new Error('The polygon has no rings');
    return (p as unknown[]).map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('A ring needs at least 4 points (the first repeated at the end)');
      const pts = (ring as unknown[]).map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) throw new Error('Each point is [longitude, latitude]');
        const [lng, lat] = pt.map(Number);
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new Error('A point is outside longitude -180..180 / latitude -90..90');
        return [lng, lat] as [number, number];
      });
      const [f, l] = [pts[0], pts[pts.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) throw new Error('A ring must end on its first point');
      return pts;
    });
  });
}

const R = 6_378_137; // WGS84 equatorial radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** spherical area of a ring in m² (good to a fraction of a percent for plantation blocks) */
function ringArea(ring: Ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((a * R * R) / 2);
}

/** area in hectares (holes subtracted) and the centre of the outer rings */
export function polygonStats(polys: Ring[][]) {
  let m2 = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of polys) {
    p.forEach((ring, i) => (m2 += (i === 0 ? 1 : -1) * ringArea(ring)));
    for (const [x, y] of p[0].slice(0, -1)) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return { areaHa: Math.round((m2 / 10_000) * 10_000) / 10_000, longitude: n ? Math.round((sx / n) * 1e7) / 1e7 : null, latitude: n ? Math.round((sy / n) * 1e7) / 1e7 : null };
}
