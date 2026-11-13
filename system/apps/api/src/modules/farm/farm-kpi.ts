/**
 * Performance figures of a cycle (common Indonesian poultry / aquaculture practice):
 * - depletion % = (dead + culled) / placed x 100; livability = 100 - depletion
 * - FCR = feed kg / live weight kg produced (harvested + still alive x latest average weight)
 * - IP (index performance) = livability % x average weight kg / (FCR x average harvest age days) x 100
 * - HDP (hen-day production) % = eggs of the day / hens alive x 100
 */
export interface KpiInput {
  initialQty: number;
  initialAgeDays: number;
  placementDate: Date;
  mortality: number;
  culled: number;
  harvestedQty: number;
  harvestedKg: number;
  feedKg: number;
  costIn: number;
  costOut: number;
  abnormalLoss: number;
  closedAt: Date | null;
  /** latest weight sample of the birds / fish still alive (kg per head) */
  latestWeightKg: number | null;
  /** kg-weighted average age at harvest */
  harvestAgeDays: number | null;
  /** last day with eggs: eggs laid and hens alive that day */
  lastEggs?: { eggs: number; hens: number } | null;
}

const r = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const DAY = 86_400_000;

export function cycleKpis(k: KpiInput, today: Date) {
  const alive = k.initialQty - k.mortality - k.culled - k.harvestedQty;
  const depletion = k.initialQty ? ((k.mortality + k.culled) / k.initialQty) * 100 : 0;
  const livability = 100 - depletion;
  const ref = k.closedAt ?? today;
  const ageDays = k.initialAgeDays + Math.max(0, Math.round((ref.getTime() - k.placementDate.getTime()) / DAY));
  const liveKg = k.harvestedKg + Math.max(0, alive) * (k.latestWeightKg ?? 0);
  const fcr = liveKg > 0 && k.feedKg > 0 ? k.feedKg / liveKg : null;
  const abw = k.harvestedQty > 0 ? k.harvestedKg / k.harvestedQty : k.latestWeightKg;
  const age = k.harvestAgeDays ?? ageDays;
  const ip = fcr && abw && age > 0 ? (livability * abw) / (fcr * age) * 100 : null;
  const carrying = k.costIn - k.costOut;
  return {
    alive,
    ageDays,
    depletionPct: r(depletion),
    livabilityPct: r(livability),
    liveKg: r(liveKg, 3),
    avgWeightKg: abw === null ? null : r(abw, 3),
    fcr: fcr === null ? null : r(fcr, 3),
    ip: ip === null ? null : r(ip, 0),
    feedPerHeadKg: k.initialQty ? r(k.feedKg / k.initialQty, 3) : 0,
    hdpPct: k.lastEggs && k.lastEggs.hens > 0 ? r((k.lastEggs.eggs / k.lastEggs.hens) * 100) : null,
    carrying: r(carrying),
    costPerKg: liveKg > 0 ? r((k.costIn - k.abnormalLoss) / liveKg) : null,
  };
}
