import { createHash } from 'node:crypto';

/** "null", "{}", "[]" and blanks written by the scraper mean "no value" */
export function clean(v: string | null | undefined, max = 1000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (!s || s === 'null' || s === '{}' || s === '[]') return null;
  return s.slice(0, max);
}

/** Digits of an Indonesian phone number in international form: 0812-1234-5678 / +62 812... -> +6281212345678 */
export function normPhone(v: string | null | undefined): string | null {
  const raw = clean(v, 80);
  if (!raw) return null;
  // the scraper sometimes joins several numbers; keep the first one
  const first = raw.split(/[,;/]| atau /i)[0];
  let d = first.replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (d.startsWith('0062')) d = d.slice(2);
  if (d.startsWith('62')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length < 6 || d.length > 14) return null;
  return `+62${d}`;
}

/** Comparison key of a phone number (last 9 digits ignore +62 / 0 prefixes and area code formatting) */
export function phoneKey(v: string | null | undefined): string | null {
  const p = normPhone(v);
  return p ? p.replace(/\D/g, '').slice(-9) : null;
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;
/** addresses scraped from websites that are not real contacts */
const JUNK = [/\.(png|jpe?g|gif|webp|svg|css|js)$/, /@(example|domain|email|yourdomain|sentry|wixpress|sentry-next)\./, /^(no-?reply|noreply|donotreply)@/, /@2x\./];

/** Valid, de-duplicated, lower-case e-mail addresses (max 5) */
export function splitEmails(v: string | null | undefined): string[] {
  const raw = clean(v, 4000);
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\s,;|]+/)) {
    const e = part.trim().replace(/^mailto:/i, '').replace(/[.)>\]]+$/, '').toLowerCase();
    if (!EMAIL.test(e) || e.length > 150 || JUNK.some((j) => j.test(e))) continue;
    if (!out.includes(e)) out.push(e);
    if (out.length === 5) break;
  }
  return out;
}

export function num(v: string | null | undefined): number | null {
  const s = clean(v, 40);
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function int(v: string | null | undefined): number | null {
  const n = num(v);
  return n === null ? null : Math.max(0, Math.round(n));
}

export function website(v: string | null | undefined): string | null {
  const s = clean(v, 500);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s.slice(0, 300);
}

/** Lower-case words without legal-form prefixes and punctuation, for duplicate checks */
export function nameKey(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .replace(/\b(pt|cv|tbk|ud|toko|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function addressKey(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(jl|jln|jalan|no|rt|rw|kec|kel|kab|kota)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

/**
 * Stable de-duplication key of a place across searches: Google place id, then cid, then the
 * internal data id, then the listing link; fast mode returns none of those, so fall back to a hash
 * of name + coordinates (5 decimals is about one metre).
 */
export function placeKey(r: Record<string, string>): string | null {
  const pid = clean(r.place_id, 110);
  if (pid) return `pid:${pid}`;
  const cid = clean(r.cid, 110);
  if (cid) return `cid:${cid}`;
  const did = clean(r.data_id, 110);
  if (did) return `did:${did}`;
  const link = clean(r.link, 2000);
  if (link) return `url:${createHash('sha256').update(link).digest('hex').slice(0, 40)}`;
  const title = clean(r.title, 300);
  const lat = num(r.latitude);
  const lng = num(r.longitude);
  if (!title || lat === null || lng === null) return null;
  return `geo:${createHash('sha256').update(`${nameKey(title)}|${lat.toFixed(5)}|${lng.toFixed(5)}`).digest('hex').slice(0, 40)}`;
}

/** Google Maps link of a place (the listing link when there is one, otherwise a search link) */
export function mapsUrl(r: Record<string, string>, title: string, lat: number | null, lng: number | null): string | null {
  const link = clean(r.link, 1000);
  if (link && /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(link)) return link;
  const q = lat !== null && lng !== null ? `${title} ${lat},${lng}` : `${title} ${clean(r.address, 200) ?? ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q.trim())}`.slice(0, 1000);
}
