/** Pure helpers of the paint add-on: colour difference (CIE76, CIEDE2000), tint formula scaling, colorant units. */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** CIE76 colour difference */
export function deltaE76(x: Lab, y: Lab) {
  return r3(Math.sqrt((x.L - y.L) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2));
}

/**
 * CIEDE2000 (CIE 142-2001), as written out by Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference formula:
 * implementation notes". kL = kC = kH = 1 (paint practice). Returns the total and the lightness / chroma / hue parts.
 */
export function deltaE00(x: Lab, y: Lab, kL = 1, kC = 1, kH = 1) {
  const deg = Math.PI / 180;
  const C1 = Math.hypot(x.a, x.b);
  const C2 = Math.hypot(y.a, y.b);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1 = (1 + G) * x.a;
  const a2 = (1 + G) * y.a;
  const C1p = Math.hypot(a1, x.b);
  const C2p = Math.hypot(a2, y.b);
  const hp = (b: number, a: number) => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) / deg;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hp(x.b, a1);
  const h2p = hp(y.b, a2);
  const dLp = y.L - x.L;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * deg);
  const Lbarp = (x.L + y.L) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbarp - 30) * deg) + 0.24 * Math.cos(2 * hbarp * deg) + 0.32 * Math.cos((3 * hbarp + 6) * deg) - 0.2 * Math.cos((4 * hbarp - 63) * deg);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * deg) * Rc;
  const l = dLp / (kL * Sl);
  const c = dCp / (kC * Sc);
  const h = dHp / (kH * Sh);
  return { dE: r3(Math.sqrt(l * l + c * c + h * h + Rt * c * h)), dL: r3(dLp), dC: r3(dCp), dH: r3(dHp) };
}

/** human reading of a trial against the standard: lighter / darker, redder / greener, yellower / bluer */
export function describe(std: Lab, trial: Lab) {
  const out: string[] = [];
  const dL = trial.L - std.L;
  const da = trial.a - std.a;
  const db = trial.b - std.b;
  if (Math.abs(dL) >= 0.3) out.push(dL > 0 ? 'lighter' : 'darker');
  if (Math.abs(da) >= 0.3) out.push(da > 0 ? 'redder' : 'greener');
  if (Math.abs(db) >= 0.3) out.push(db > 0 ? 'yellower' : 'bluer');
  return out.length ? out.join(', ') : 'on shade';
}

const OZ = 29.5735295625;
/** colorant units: ml (stored), or the dispenser's: Y = 1 US fl oz, shots of 1/48, 1/64 or 1/384 oz (machine calibration) */
export const UNIT_ML: Record<string, number> = { ML: 1, Y: OZ, SHOT48: OZ / 48, SHOT64: OZ / 64, SHOT384: OZ / 384 };

/** colorants for one can: ml per litre of base x the can's litres, in ml and in the dispenser unit */
export function scaleFormula(lines: { colorantId: string; mlPerLitre: number }[], canLitres: number, unit: keyof typeof UNIT_ML = 'ML') {
  return lines.map((l) => {
    const ml = Math.round(l.mlPerLitre * canLitres * 1000) / 1000;
    return { colorantId: l.colorantId, ml, units: Math.round((ml / UNIT_ML[unit]) * 100) / 100 };
  });
}

/** colorant load as % of the can volume, to check against the base's maximum */
export const colorantLoadPct = (mlPerLitreTotal: number) => Math.round((mlPerLitreTotal / 1000) * 100 * 100) / 100;

/** CIELAB (D65/10) to an sRGB hex for the on-screen swatch (approximate: screens are not colour-managed) */
export function labToHex({ L, a, b }: Lab) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * f(fx);
  const Y = 1.0 * f(fy);
  const Z = 1.08883 * f(fz);
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const g = (c: number) => Math.round(Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)) * 255);
  return '#' + lin.map((c) => g(c).toString(16).padStart(2, '0')).join('');
}

/** UN 1263 packing group from the flash point (closed cup) and initial boiling point: I below 35 C boiling, II below 23 C flash, III 23-60 C */
export function packingGroup(flashC: number | null, boilC: number | null) {
  if (flashC === null) return null;
  if (boilC !== null && boilC <= 35) return 'I';
  if (flashC < 23) return 'II';
  if (flashC <= 60) return 'III';
  return null;
}
