/**
 * Parsing of marketplace files and API answers into neutral rows.
 *
 * Privacy: buyer names, e-mails, addresses and phone numbers are never read. Only the buyer country is kept.
 */

export const CHANNELS = ['GUMROAD', 'ETSY', 'SHOPEE', 'TOKOPEDIA', 'TIKTOK', 'LAZADA', 'WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'PINTEREST', 'OTHER'] as const;
export type Channel = (typeof CHANNELS)[number];
/** channels that are audience only by default */
export const SOCIAL_CHANNELS = new Set<Channel>(['FACEBOOK', 'INSTAGRAM', 'PINTEREST']);

export interface OrderRow {
  externalId: string;
  orderDate: Date;
  currencyCode: string | null;
  gross: number;
  fee: number;
  taxCollected: number;
  refunded: number;
  feeRefunded: number;
  country: string | null;
  lines: { externalId: string | null; title: string; qty: number; amount: number }[];
}

export interface StatRow {
  date: string;
  rangeLabel: string | null;
  visits: number | null;
  views: number | null;
  orders: number | null;
  revenue: number | null;
  followers: number | null;
  favorites: number | null;
  impressions: number | null;
  clicks: number | null;
  saves: number | null;
  listings: number | null;
}

export interface ListingRow {
  externalId: string;
  title: string;
  url: string | null;
  price: number;
  currencyCode: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
}

export interface PayoutRow {
  externalId: string;
  date: string;
  amount: number;
  currencyCode: string | null;
  status: string;
}

// ------------------------------------------------------------------ CSV

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF / LF); delimiter , or ; or tab detected from the header */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** header aliases, first match wins (Gumroad sales export, Etsy "Sold Orders" / "Sold Order Items", Shopee / Tokopedia, our template) */
const ORDER_FIELDS: Record<string, string[]> = {
  externalId: ['order id', 'order_id', 'purchase id', 'sale id', 'no pesanan', 'nomor invoice', 'invoice', 'id'],
  date: ['sale date', 'order date', 'date', 'purchase date', 'created at', 'waktu pesanan dibuat', 'tanggal pembayaran', 'payment date'],
  itemId: ['listing id', 'item id', 'product id', 'product permalink', 'sku induk', 'sku'],
  title: ['item name', 'product name', 'product title', 'title', 'nama produk', 'item'],
  qty: ['quantity', 'qty', 'number of items', 'jumlah'],
  gross: ['item total', 'order value', 'sale price', 'price', 'gross', 'total harga produk', 'subtotal', 'amount', 'order total'],
  fee: ['fees', 'fee', 'gumroad fee', 'card processing fees', 'transaction fees', 'biaya administrasi', 'biaya layanan', 'marketplace fee'],
  taxCollected: ['sales tax', 'vat paid by buyer', 'tax', 'taxes collected'],
  refunded: ['refunded', 'refund amount', 'adjusted refund', 'refunds', 'amount refunded'],
  feeRefunded: ['fee refunded', 'fees refunded'],
  currency: ['currency', 'order currency', 'mata uang'],
  country: ['buyer country', 'ship country', 'country', 'country code', 'negara'],
  status: ['status', 'order status', 'status pesanan'],
};

const STAT_FIELDS: Record<string, string[]> = {
  date: ['date', 'tanggal', 'day'],
  rangeLabel: ['range', 'period'],
  visits: ['visits', 'kunjungan', 'sessions'],
  views: ['views', 'page views', 'monthly views', 'views 28d', 'tayangan'],
  orders: ['orders', 'pesanan'],
  revenue: ['revenue', 'pendapatan', 'sales'],
  followers: ['followers', 'follows', 'shop follows', 'pengikut'],
  favorites: ['favorites', 'favourites', 'likes'],
  impressions: ['impressions', 'impresi', 'reach'],
  clicks: ['clicks', 'outbound clicks', 'link clicks', 'klik'],
  saves: ['saves', 'pin saves'],
  listings: ['listings', 'active listings'],
};

function indexer(header: string[], fields: Record<string, string[]>) {
  const h = header.map(norm);
  const at: Record<string, number> = {};
  for (const [k, aliases] of Object.entries(fields)) {
    const i = aliases.map((a) => h.indexOf(norm(a))).find((x) => x >= 0);
    if (i !== undefined) at[k] = i;
  }
  return at;
}

/** "1.234,56" / "1,234.56" / "$12.00" / "Rp 15.000" / "(5.00)" -> number */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  // "15.000" / "1.250.000": dots as thousand separators (IDR style)
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };

/** ISO, "MM/DD/YY(YY)" (Etsy, Gumroad), "DD-MM-YYYY HH:mm" (Shopee / Tokopedia), "Nov 20, 2026" */
export function toDate(v: unknown, dayFirst = false): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(/T|\s\d/.test(s) || s.length > 10 ? s.replace(' ', 'T') : `${s}T00:00:00+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12) dayFirst = true;
    if (b > 12) dayFirst = false;
    const [day, month] = dayFirst ? [a, b] : [b, a];
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const t = `${String(m[4] ?? 0).padStart(2, '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
    const d = new Date(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${t}+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return new Date(`${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00+07:00`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const country = (v: unknown) => {
  const s = String(v ?? '').trim();
  return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
};

/** Orders from a CSV export. Rows with the same order id are one order with several items. */
export function ordersFromCsv(text: string, channel: Channel): { rows: OrderRow[]; messages: string[] } {
  const table = parseCsv(text);
  const messages: string[] = [];
  if (table.length < 2) return { rows: [], messages: ['The file has no rows'] };
  const at = indexer(table[0], ORDER_FIELDS);
  for (const need of ['externalId', 'date', 'gross']) if (at[need] === undefined) messages.push(`Column not found: ${need} (header: ${table[0].slice(0, 12).join(', ')})`);
  if (messages.length) return { rows: [], messages };
  const dayFirst = ['SHOPEE', 'TOKOPEDIA', 'TIKTOK', 'LAZADA'].includes(channel);
  const byId = new Map<string, OrderRow>();
  table.slice(1).forEach((r, i) => {
    const get = (k: string) => (at[k] === undefined ? '' : (r[at[k]] ?? ''));
    const id = get('externalId').trim();
    const date = toDate(get('date'), dayFirst);
    if (!id || !date) {
      messages.push(`Row ${i + 2}: no order id or date, skipped`);
      return;
    }
    const status = get('status').toLowerCase();
    if (/cancel|batal|failed|gagal/.test(status)) {
      messages.push(`Row ${i + 2}: order ${id} is cancelled, skipped`);
      return;
    }
    const qty = at.qty === undefined ? 1 : toNumber(get('qty')) || 1;
    const amount = toNumber(get('gross'));
    const o =
      byId.get(id) ??
      ({ externalId: id.slice(0, 80), orderDate: date, currencyCode: get('currency').trim().toUpperCase().slice(0, 3) || null, gross: 0, fee: 0, taxCollected: 0, refunded: 0, feeRefunded: 0, country: country(get('country')), lines: [] } as OrderRow);
    o.gross += amount;
    o.fee += Math.abs(toNumber(get('fee')));
    o.taxCollected += Math.abs(toNumber(get('taxCollected')));
    o.refunded += Math.abs(toNumber(get('refunded')));
    o.feeRefunded += Math.abs(toNumber(get('feeRefunded')));
    if (/refund|dikembalikan/.test(status) && !o.refunded) o.refunded = o.gross;
    o.lines.push({ externalId: get('itemId').trim().slice(0, 80) || null, title: (get('title').trim() || 'Order item').slice(0, 300), qty, amount });
    byId.set(id, o);
  });
  return { rows: [...byId.values()], messages };
}

const kNumber = (v: unknown) => {
  if (typeof v === 'number') return Math.round(v);
  const m = /([\d.,]+)\s*(k|rb|ribu|m|jt)?/i.exec(String(v ?? ''));
  if (!m) return null;
  const n = toNumber(m[1]);
  const mult = m[2] ? (/^(k|rb|ribu)$/i.test(m[2]) ? 1000 : 1_000_000) : 1;
  return Math.round(n * mult);
};

/** whole number, "1.2k" / "3 rb" / "1,5 jt" understood; empty = null */
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : kNumber(v));

const jakartaDate = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * Statistics from JSON (one object, an array of objects, or the files collected for the Rupakala dashboard:
 * etsy.json, facebook.json, pinterest.json) or from a CSV with a date column.
 */
export function statsFromFile(text: string, fallbackDate: string): { rows: StatRow[]; messages: string[] } {
  const messages: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { rows: [], messages: ['The file is not valid JSON'] };
    }
    const list = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
    const rows = list.map((o) => {
      const at = o.collected_at ?? o.date ?? o.as_of;
      const d = at ? toDate(at) : null;
      const listings = Array.isArray(o.listings) ? o.listings.length : null;
      return {
        date: d ? jakartaDate(d) : fallbackDate,
        rangeLabel: typeof o.range === 'string' ? o.range.slice(0, 100) : null,
        visits: intOrNull(o.visits),
        views: intOrNull(o.views ?? o.views_28d ?? o.monthly_views ?? o.views_30d),
        orders: intOrNull(o.orders),
        revenue: o.revenue === undefined || o.revenue === null ? null : toNumber(o.revenue),
        followers: o.followers !== undefined ? kNumber(o.followers) : o.follows !== undefined ? kNumber(o.follows) : null,
        favorites: intOrNull(o.favorites),
        impressions: intOrNull(o.impressions ?? o.impressions_30d),
        clicks: intOrNull(o.clicks ?? o.outbound_clicks_30d ?? o.outbound_clicks),
        saves: intOrNull(o.saves ?? o.saves_30d),
        listings: intOrNull(o.active_listings) ?? listings,
      } satisfies StatRow;
    });
    return { rows, messages };
  }
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], messages: ['The file has no rows'] };
  const at = indexer(table[0], STAT_FIELDS);
  if (at.date === undefined) return { rows: [], messages: ['Column not found: date'] };
  const rows: StatRow[] = [];
  table.slice(1).forEach((r, i) => {
    const get = (k: string) => (at[k] === undefined ? null : (r[at[k]] ?? null));
    const d = toDate(get('date'));
    if (!d) {
      messages.push(`Row ${i + 2}: no date, skipped`);
      return;
    }
    rows.push({
      date: jakartaDate(d),
      rangeLabel: get('rangeLabel')?.slice(0, 100) || null,
      visits: intOrNull(get('visits')),
      views: intOrNull(get('views')),
      orders: intOrNull(get('orders')),
      revenue: get('revenue') === null || get('revenue') === '' ? null : toNumber(get('revenue')),
      followers: get('followers') === null || get('followers') === '' ? null : kNumber(get('followers')),
      favorites: intOrNull(get('favorites')),
      impressions: intOrNull(get('impressions')),
      clicks: intOrNull(get('clicks')),
      saves: intOrNull(get('saves')),
      listings: intOrNull(get('listings')),
    });
  });
  return { rows, messages };
}

// ------------------------------------------------------------------ Gumroad API (https://api.gumroad.com/v2)

const cents = (v: unknown) => toNumber(v) / 100;

/** GET /v2/products item */
export function gumroadListing(p: Record<string, any>): ListingRow {
  return {
    externalId: String(p.id).slice(0, 80),
    title: String(p.name ?? 'Untitled').slice(0, 300),
    url: typeof p.short_url === 'string' ? p.short_url.slice(0, 500) : null,
    price: cents(p.price),
    currencyCode: String(p.currency ?? 'usd').toUpperCase().slice(0, 3),
    status: p.published === false ? 'DRAFT' : p.deleted ? 'INACTIVE' : 'ACTIVE',
  };
}

/** GET /v2/sales item. The buyer e-mail and name are in the answer but are never read. */
export function gumroadOrder(s: Record<string, any>): OrderRow | null {
  const date = toDate(s.created_at);
  if (!s.id || !date) return null;
  const gross = cents(s.price);
  const refundedAll = !!(s.refunded || s.chargedback || s.disputed);
  const partial = !refundedAll && !!s.partially_refunded;
  const refundedAmt = refundedAll ? gross : partial ? cents(s.amount_refunded_cents ?? s.refunded_amount_cents ?? 0) : 0;
  const fee = cents(s.gumroad_fee);
  return {
    externalId: String(s.id).slice(0, 80),
    orderDate: date,
    currencyCode: typeof s.currency === 'string' ? s.currency.toUpperCase().slice(0, 3) : null,
    gross,
    fee,
    taxCollected: cents(s.vat_amount_cents ?? s.tax_cents ?? 0),
    refunded: refundedAmt,
    // Gumroad keeps its fee on a refund: no fee refund unless the API says so
    feeRefunded: cents(s.gumroad_fee_refunded_cents ?? 0),
    country: country(s.country_iso2),
    lines: [{ externalId: s.product_id ? String(s.product_id).slice(0, 80) : null, title: String(s.product_name ?? 'Gumroad product').slice(0, 300), qty: toNumber(s.quantity) || 1, amount: gross }],
  };
}

/** GET /v2/payouts item (amount given in cents or as a decimal string) */
export function gumroadPayout(p: Record<string, any>): PayoutRow | null {
  const date = toDate(p.processed_at ?? p.paid_at ?? p.created_at ?? p.payout_date);
  if (!p.id || !date) return null;
  const amount = p.amount_cents !== undefined ? cents(p.amount_cents) : typeof p.amount === 'string' && p.amount.includes('.') ? toNumber(p.amount) : p.amount !== undefined ? toNumber(p.amount) : 0;
  return { externalId: String(p.id).slice(0, 80), date: jakartaDate(date), amount, currencyCode: typeof p.currency === 'string' ? p.currency.toUpperCase().slice(0, 3) : null, status: String(p.status ?? 'completed').toLowerCase() };
}
