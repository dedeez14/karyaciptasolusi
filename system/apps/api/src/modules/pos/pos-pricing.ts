import { Prisma } from '@prisma/client';
import { D, round, sum, ZERO } from '../../common/utils/money';

/**
 * POS pricing: one pure function used for quotes, open bills and payment, so the screen, the customer display
 * and the posted receipt always agree.
 *
 * Order of calculation (Indonesian practice):
 * 1. shelf price x qty (prices include PPN when the outlet says so), manual line discount
 * 2. item promotions (percent / amount off, buy X get Y): at most one per line, the best for the customer
 * 3. one bill promotion (percent with cap / amount, minimum spend), spread over the lines pro rata
 * 4. PPN per line (RETAIL outlets of a PKP: effective rate, e.g. 12% x 11/12 = 11%, PMK 131/2024)
 * 5. service charge on the amount after discounts (excl. PPN)
 * 6. PBJT (FNB outlets, UU 1/2022): on the amount after discounts INCLUDING the service charge
 *    (e.g. Pergub DKI 35/2024: Rp3,000,000 + 5% service = Rp3,150,000 x 10%)
 * A restaurant's food & drinks are a PBJT object, not PPN, so a FNB outlet never charges PPN and a RETAIL outlet
 * never charges PBJT.
 */

export interface PriceLine {
  key: string;
  productId: string;
  categoryId: string | null;
  qty: Prisma.Decimal;
  /** shelf price incl. modifiers */
  unitPrice: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  /** effective VAT rate in percent (0 when not taxed) */
  vatRate: Prisma.Decimal;
}

export interface Promo {
  id: string;
  code: string;
  name: string;
  type: string;
  value: Prisma.Decimal;
  buyQty: number;
  getQty: number;
  minSpend: Prisma.Decimal;
  maxDiscount: Prisma.Decimal;
  productIds: string[];
  categoryIds: string[];
}

export interface OutletTax {
  mode: string;
  pricesIncludeTax: boolean;
  pbjtRate: Prisma.Decimal;
  serviceChargePct: Prisma.Decimal;
  vatPayer: boolean;
}

export interface PricedLine {
  key: string;
  gross: Prisma.Decimal;
  promoDiscount: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface PriceResult {
  lines: PricedLine[];
  /** sum of shelf amounts after manual discounts */
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  /** DPP: lines net of PPN + service charge */
  subtotal: Prisma.Decimal;
  serviceCharge: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  localTax: Prisma.Decimal;
  total: Prisma.Decimal;
  promotions: { promotionId: string; code: string; name: string; amount: number }[];
}

/** discounts, service charge and PBJT in whole rupiah (cash cannot pay sen) */
const rp = (d: Prisma.Decimal) => d.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

const applies = (p: Promo, l: PriceLine) => (!p.productIds.length && !p.categoryIds.length) || p.productIds.includes(l.productId) || (!!l.categoryId && p.categoryIds.includes(l.categoryId));

export function priceOrder(input: PriceLine[], promos: Promo[], o: OutletTax): PriceResult {
  const lines = input.map((l) => {
    const gross = round(l.unitPrice.times(l.qty));
    const manual = rp(gross.times(l.discountPct).div(100));
    return { l, base: gross.minus(manual), promo: ZERO, promoId: null as string | null };
  });

  // --- item promotions: best single promotion per line
  const credit = new Map<string, Prisma.Decimal>();
  const consider = (i: number, promoId: string, amount: Prisma.Decimal) => {
    const x = lines[i];
    const a = Prisma.Decimal.min(amount, x.base);
    if (a.gt(x.promo)) {
      x.promo = a;
      x.promoId = promoId;
    }
  };
  for (const p of promos) {
    if (p.type === 'ITEM_PERCENT') lines.forEach((x, i) => applies(p, x.l) && consider(i, p.id, rp(x.base.times(p.value).div(100))));
    else if (p.type === 'ITEM_AMOUNT') lines.forEach((x, i) => applies(p, x.l) && consider(i, p.id, rp(p.value.times(x.l.qty))));
    else if (p.type === 'BUY_X_GET_Y' && p.buyQty > 0 && p.getQty > 0) {
      // every (buy + get) eligible units: the cheapest `get` units are free
      const units: { i: number; price: Prisma.Decimal }[] = [];
      lines.forEach((x, i) => {
        if (!applies(p, x.l) || x.l.qty.lte(0)) return;
        const unit = x.base.div(x.l.qty);
        for (let k = 0; k < Math.floor(x.l.qty.toNumber()); k++) units.push({ i, price: unit });
      });
      const free = Math.floor(units.length / (p.buyQty + p.getQty)) * p.getQty;
      if (!free) continue;
      units.sort((a, b) => a.price.comparedTo(b.price));
      const perLine = new Map<number, Prisma.Decimal>();
      for (const u of units.slice(0, free)) perLine.set(u.i, (perLine.get(u.i) ?? ZERO).plus(u.price));
      for (const [i, a] of perLine) consider(i, p.id, rp(a));
    }
  }
  for (const x of lines) if (x.promoId) credit.set(x.promoId, (credit.get(x.promoId) ?? ZERO).plus(x.promo));

  // --- one bill promotion (the best), spread pro rata
  const afterItems = sum(lines.map((x) => x.base.minus(x.promo)));
  let bill: { p: Promo; amount: Prisma.Decimal } | null = null;
  for (const p of promos) {
    if (p.type !== 'BILL_PERCENT' && p.type !== 'BILL_AMOUNT') continue;
    if (afterItems.lt(p.minSpend) || afterItems.lte(0)) continue;
    let a = p.type === 'BILL_PERCENT' ? rp(afterItems.times(p.value).div(100)) : p.value;
    if (p.type === 'BILL_PERCENT' && p.maxDiscount.gt(0)) a = Prisma.Decimal.min(a, p.maxDiscount);
    a = Prisma.Decimal.min(a, afterItems);
    if (!bill || a.gt(bill.amount)) bill = { p, amount: a };
  }
  if (bill && bill.amount.gt(0)) {
    let left = bill.amount;
    const idx = lines.map((_, i) => i).filter((i) => lines[i].base.minus(lines[i].promo).gt(0));
    idx.forEach((i, k) => {
      const x = lines[i];
      const share = k === idx.length - 1 ? left : round(bill!.amount.times(x.base.minus(x.promo)).div(afterItems));
      const a = Prisma.Decimal.min(share, x.base.minus(x.promo));
      x.promo = x.promo.plus(a);
      left = left.minus(a);
    });
    credit.set(bill.p.id, (credit.get(bill.p.id) ?? ZERO).plus(bill.amount.minus(left)));
  }

  // --- taxes
  const vatOn = o.vatPayer && o.mode !== 'FNB';
  const priced: PricedLine[] = lines.map((x) => {
    const amount = x.base.minus(x.promo);
    const eff = vatOn ? x.l.vatRate : ZERO;
    const net = eff.gt(0) && o.pricesIncludeTax ? round(amount.times(100).div(D(100).plus(eff))) : amount;
    const tax = eff.gt(0) ? (o.pricesIncludeTax ? amount.minus(net) : round(net.times(eff).div(100))) : ZERO;
    return { key: x.l.key, gross: x.base, promoDiscount: x.promo, net, tax, total: net.plus(tax) };
  });
  const linesNet = sum(priced.map((l) => l.net));
  const serviceCharge = o.serviceChargePct.gt(0) ? rp(linesNet.times(o.serviceChargePct).div(100)) : ZERO;
  // PPN on the service charge at the highest rate of the bill (consideration for the same supply)
  const maxRate = vatOn ? input.reduce((m, l) => (l.vatRate.gt(m) ? l.vatRate : m), ZERO) : ZERO;
  const serviceTax = serviceCharge.gt(0) && maxRate.gt(0) ? round(serviceCharge.times(maxRate).div(100)) : ZERO;
  const subtotal = linesNet.plus(serviceCharge);
  const localTax = o.mode === 'FNB' && o.pbjtRate.gt(0) ? rp(subtotal.times(o.pbjtRate).div(100)) : ZERO;
  const taxTotal = sum(priced.map((l) => l.tax)).plus(serviceTax);
  const promoById = new Map(promos.map((p) => [p.id, p]));
  return {
    lines: priced,
    gross: sum(lines.map((x) => x.base)),
    discount: sum(lines.map((x) => x.promo)),
    subtotal,
    serviceCharge,
    taxTotal,
    localTax,
    total: subtotal.plus(taxTotal).plus(localTax),
    promotions: [...credit].filter(([, a]) => a.gt(0)).map(([id, a]) => ({ promotionId: id, code: promoById.get(id)!.code, name: promoById.get(id)!.name, amount: a.toNumber() })),
  };
}

/** local wall-clock of the company (happy hours, days of week) */
export function localClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit', hour12: false }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, hhmm: `${get('hour').replace('24', '00')}:${get('minute')}`, date: `${get('year')}-${get('month')}-${get('day')}` };
}

/** is the promotion valid at this moment / outlet / for this customer */
export function promoActive(
  p: { startDate: Date | null; endDate: Date | null; days: number[]; timeFrom: string | null; timeTo: string | null; outletIds: string[]; membersOnly: boolean; voucherCode: string | null; maxUses: number; usedCount: number },
  ctx: { clock: { day: number; hhmm: string; date: string }; outletId: string; isMember: boolean; voucherCode: string | null },
) {
  if (p.startDate && ctx.clock.date < p.startDate.toISOString().slice(0, 10)) return false;
  if (p.endDate && ctx.clock.date > p.endDate.toISOString().slice(0, 10)) return false;
  if (p.days.length && !p.days.includes(ctx.clock.day)) return false;
  if (p.timeFrom && p.timeTo) {
    const inside = p.timeFrom <= p.timeTo ? ctx.clock.hhmm >= p.timeFrom && ctx.clock.hhmm < p.timeTo : ctx.clock.hhmm >= p.timeFrom || ctx.clock.hhmm < p.timeTo;
    if (!inside) return false;
  }
  if (p.outletIds.length && !p.outletIds.includes(ctx.outletId)) return false;
  if (p.membersOnly && !ctx.isMember) return false;
  if (p.voucherCode && (!ctx.voucherCode || p.voucherCode.toUpperCase() !== ctx.voucherCode.toUpperCase())) return false;
  if (p.maxUses > 0 && p.usedCount >= p.maxUses) return false;
  return true;
}
