/** Pure calculations of the palm oil mill: tank sounding, TBS price formula, joint cost, KPIs. */

export interface CalibrationRow {
  cm: number;
  litres: number;
}

/** validates a calibration table (tabel tera): at least 2 rows, heights and volumes rising */
export function parseCalibration(rows: unknown): CalibrationRow[] {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('The calibration table needs at least 2 rows');
  const out = rows.map((r) => {
    const cm = Number((r as CalibrationRow).cm);
    const litres = Number((r as CalibrationRow).litres);
    if (!Number.isFinite(cm) || !Number.isFinite(litres) || cm < 0 || litres < 0) throw new Error('Each row is a height in cm and a volume in litres');
    return { cm, litres };
  });
  out.sort((a, b) => a.cm - b.cm);
  for (let i = 1; i < out.length; i++) {
    if (out[i].cm === out[i - 1].cm) throw new Error(`Height ${out[i].cm} cm appears twice`);
    if (out[i].litres < out[i - 1].litres) throw new Error(`The volume falls at ${out[i].cm} cm`);
  }
  return out;
}

/** litres at a sounding height, interpolated linearly between the rows of the calibration table */
export function volumeAt(table: CalibrationRow[], cm: number) {
  if (cm <= table[0].cm) return table[0].litres * (table[0].cm > 0 ? cm / table[0].cm : 1);
  const last = table[table.length - 1];
  if (cm > last.cm) throw new Error(`The sounding ${cm} cm is above the calibration table (max ${last.cm} cm)`);
  for (let i = 1; i < table.length; i++) {
    const [a, b] = [table[i - 1], table[i]];
    if (cm <= b.cm) return a.litres + ((b.litres - a.litres) * (cm - a.cm)) / (b.cm - a.cm);
  }
  return last.litres;
}

/**
 * Density of crude palm oil (kg / litre) at a temperature: density = d0 - k x (T - T0). The default 0.9135 at 15 °C less
 * 0.00069 per °C fits the density tables used by mills and surveyors (0.8997 at 35 °C, 0.8887 at 51 °C); a mill with its
 * own laboratory table sets its own figures.
 */
export function cpoDensity(tempC: number, d0 = 0.9135, t0 = 15, k = 0.00069) {
  return Math.round((d0 - k * (tempC - t0)) * 100_000) / 100_000;
}

/**
 * kg in a CPO tank from the sounding: volume from the calibration table, corrected for the expansion of the steel shell
 * (1 + 0.0000348 x (T - calibration temperature)) when the table gives its temperature, x density at the oil temperature.
 */
export function soundingKg(table: CalibrationRow[], cm: number, tempC: number, density?: { d0: number; t0: number; k: number }, calibrationTempC = 0) {
  const shell = calibrationTempC > 0 ? 1 + 0.0000348 * (tempC - calibrationTempC) : 1;
  const litres = volumeAt(table, cm) * shell;
  const d = density ? cpoDensity(tempC, density.d0, density.t0, density.k) : cpoDensity(tempC);
  return { litres: Math.round(litres * 100) / 100, density: d, kg: Math.round(litres * d * 100) / 100 };
}

/**
 * TBS price for partner smallholders (Permentan 13/2024): HTBS = K x (HCPO x RCPO + HPK x RPK) + shell value.
 * K in % (e.g. 90.5), yields in % (e.g. 22.5), prices per kg.
 */
export function tbsFormulaPrice(i: { kIndex: number; cpoPrice: number; kernelPrice: number; cpoYield: number; kernelYield: number; shellValue?: number | null }) {
  const base = (i.cpoPrice * i.cpoYield) / 100 + (i.kernelPrice * i.kernelYield) / 100;
  return Math.round(((i.kIndex / 100) * base + (i.shellValue ?? 0)) * 100) / 100;
}

export interface JointOutput {
  kind: 'MAIN' | 'BY';
  qty: number;
  price: number;
}

/**
 * Joint cost of the day: TBS processed + processing cost, less by-products at net realisable value,
 * shared by the main products (CPO, kernel) in proportion to their sales value (SAK EP / PSAK 202 on joint products).
 * The last main product takes the rounding.
 */
export function allocateJoint(joint: number, outputs: JointOutput[]) {
  const by = outputs.map((o) => (o.kind === 'BY' ? Math.round(o.qty * o.price) : 0));
  const byTotal = by.reduce((a, b) => a + b, 0);
  const pool = joint - byTotal;
  const mains = outputs.map((o, i) => ({ o, i })).filter((x) => x.o.kind === 'MAIN');
  const value = mains.reduce((a, x) => a + x.o.qty * x.o.price, 0);
  const cost = [...by];
  let left = pool;
  mains.forEach((x, k) => {
    if (k === mains.length - 1) cost[x.i] = Math.round(left);
    else {
      const c = value > 0 ? Math.round((pool * x.o.qty * x.o.price) / value) : Math.round(pool / mains.length);
      cost[x.i] = c;
      left -= c;
    }
  });
  return { byTotal, pool, cost };
}

/** OER / KER (% of TBS processed), throughput (t / h) and capacity use */
export function millKpis(i: { processedKg: number; cpoKg: number; kernelKg: number; hours: number; capacityTph: number }) {
  const pct = (v: number) => (i.processedKg > 0 ? Math.round((v / i.processedKg) * 10_000) / 100 : null);
  const tph = i.hours > 0 ? Math.round((i.processedKg / 1000 / i.hours) * 100) / 100 : null;
  return { oer: pct(i.cpoKg), ker: pct(i.kernelKg), throughput: tph, utilisation: tph !== null && i.capacityTph > 0 ? Math.round((tph / i.capacityTph) * 1000) / 10 : null };
}
