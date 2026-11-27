import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import zlib from 'node:zlib';
import { normalizeEmail } from '../emailcampaign/render';

/**
 * Reads public business websites to find contact e-mail addresses.
 * Safe against SSRF: only http(s) on ports 80/443, every hop (redirects included) is resolved and must be a
 * public address, and the connection is made to exactly that checked address (no DNS rebinding).
 */

const MAX_BYTES = 1_500_000;
const PAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; KCS-ERP-LeadFinder/1.0; contact page reader)';

/** sites that cannot be read without a login or never show an e-mail address */
const SKIP_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|wa\.me|whatsapp\.com|linktr\.ee|tiktok\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|linkedin\.com|tokopedia\.com|shopee\.co\.id|bukalapak\.com|blibli\.com|lazada\.co\.id|bit\.ly|goo\.gl|maps\.google\.com|g\.page|lynk\.id|s\.id)$/i;

/** addresses that show up on many sites but are never the business (plugins, trackers, theme authors, placeholders) */
const JUNK_DOMAINS = /(^|\.)(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|company\.com|mail\.com|test\.com|godaddy\.com|wordpress\.(com|org)|w3\.org|schema\.org|cloudflare\.com|googleapis\.com|gstatic\.com|squarespace\.com|shopify\.com|jquery\.com|getbootstrap\.com|fontawesome\.com|latofonts\.com|indoweb\.id|blog\.com|blogger\.com|blogspot\.com)$/i;
const FREE_MAIL = /(^|\.)(gmail\.com|yahoo\.(com|co\.id)|ymail\.com|hotmail\.com|outlook\.(com|co\.id)|live\.com|icloud\.com|aol\.com|proton(mail)?\.(me|com))$/i;

export class ScanError extends Error {}

/** the 8 groups of an IPv6 address as numbers (null when it is not one) */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** true for addresses on the public internet (not loopback, private, link-local, CGNAT, multicast or reserved) */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')) || (b === 0 && ip.startsWith('192.0.2.')))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && ip.startsWith('198.51.100.')))) return false;
    if (a === 203 && ip.startsWith('203.0.113.')) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    // NAT64 (64:ff9b::/96, DNS64 networks): the IPv4 address inside decides
    const g = ipv6Groups(s);
    if (g && g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    if (/^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff') || s.startsWith('2001:db8') || s.startsWith('64:ff9b') || s.startsWith('::ffff')) return false;
    return true;
  }
  return false;
}

/** The URL a scan may open, or a reason why not */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`);
  } catch {
    throw new ScanError('Not a valid website address');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ScanError('Only http and https websites are read');
  if (u.username || u.password) throw new ScanError('Website addresses with a login are not read');
  if (u.port && u.port !== '80' && u.port !== '443') throw new ScanError('Only websites on the standard ports are read');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/i.test(host) || /^localhost$/i.test(host)) throw new ScanError('Not a public website');
  if (isIP(host) && !isPublicAddress(host)) throw new ScanError('Not a public website');
  return u;
}

async function publicAddress(host: string): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) throw new ScanError('Not a public website');
    return { address: bare, family: isIP(bare) };
  }
  let all: { address: string; family: number }[];
  try {
    all = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new ScanError('The website address does not exist');
  }
  // every answer must be public, otherwise a host could mix in an internal address
  if (!all.length || all.some((a) => !isPublicAddress(a.address))) throw new ScanError('Not a public website');
  return all.find((a) => a.family === 4) ?? all[0];
}

interface Page {
  url: string;
  html: string;
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const stream = encoding.includes('br') ? res.pipe(zlib.createBrotliDecompress()) : encoding.includes('gzip') ? res.pipe(zlib.createGunzip()) : encoding.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        res.destroy();
        resolve(Buffer.concat(chunks).toString('utf8')); // the top of a page is enough
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function requestOnce(u: URL, pinned: { address: string; family: number }, insecureTls: boolean): Promise<{ status: number; location?: string; type: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'id,en;q=0.8' },
        // connect to the address that was checked, never re-resolve
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => (opts?.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family))) as never,
        rejectUnauthorized: !insecureTls,
        servername: isIP(u.hostname) ? undefined : u.hostname,
        timeout: PAGE_TIMEOUT_MS,
      },
      async (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers['content-type'] ?? '');
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, location: String(res.headers.location), type });
          return;
        }
        if (status >= 400 || (type && !/html|xml|text\/plain/i.test(type))) {
          res.resume();
          resolve({ status, type });
          return;
        }
        try {
          resolve({ status, type, body: await readBody(res) });
        } catch (e) {
          reject(e);
        }
      },
    );
    req.on('timeout', () => req.destroy(new ScanError('The website did not answer in time')));
    req.on('error', reject);
    req.end();
  });
}

/** Opens one page (following at most 3 redirects, each checked again). Returns null for non-HTML or error pages. */
export async function fetchPage(raw: string): Promise<Page | null> {
  let u = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const pinned = await publicAddress(u.hostname);
    let r: Awaited<ReturnType<typeof requestOnce>>;
    try {
      r = await requestOnce(u, pinned, false);
    } catch (e) {
      // many small business sites have an expired or self-signed certificate: the page is public, read it anyway
      const code = (e as { code?: string }).code ?? '';
      if (u.protocol === 'https:' && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME|ALTNAME/i.test(code)) r = await requestOnce(u, pinned, true);
      else throw e;
    }
    if (r.location) {
      u = checkUrl(new URL(r.location, u).toString());
      continue;
    }
    return r.body !== undefined ? { url: u.toString(), html: r.body } : null;
  }
  throw new ScanError('Too many redirects');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', commat: '@', period: '.', lowbar: '_', hyphen: '-', dash: '-' };
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Cloudflare "email protection": hex string, first byte is the XOR key */
export function decodeCloudflare(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

const siteDomain = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** Contact e-mail addresses on a page, the business's own domain first, at most 5 */
export function extractEmails(html: string, siteHost: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) found.push(decodeCloudflare(m[1]) ?? '');
  for (const m of html.matchAll(/email-protection#([0-9a-f]+)/gi)) found.push(decodeCloudflare(m[1]) ?? '');
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    try {
      found.push(decodeURIComponent(m[1]));
    } catch {
      found.push(m[1]);
    }
  }
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi)) found.push(m[0]);
  // "info [at] example [dot] co [dot] id"
  for (const m of text.matchAll(/([a-z0-9._%+-]{1,64})\s*[[(]\s*at\s*[\])]\s*([a-z0-9-]+(?:\s*[[(]\s*dot\s*[\])]\s*[a-z0-9-]+)+)/gi)) found.push(`${m[1]}@${m[2].replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.')}`);

  const own = siteDomain(siteHost);
  const clean = new Set<string>();
  for (const raw of found) {
    const e = normalizeEmail(raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''));
    if (!e) continue;
    const [local, domain] = e.split('@');
    if (JUNK_DOMAINS.test(domain)) continue;
    if (/^[0-9a-f]{24,}$/i.test(local) || /\.(js|css|webp|png|jpe?g|gif|svg|ico)$/i.test(domain)) continue;
    if (/^(noreply|no-reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|wordpress|user|username|name|email|your-?email)$/i.test(local)) continue;
    clean.add(e);
  }
  const rank = (e: string) => {
    const d = e.split('@')[1];
    return d === own || d.endsWith(`.${own}`) || own.endsWith(`.${d}`) ? 0 : FREE_MAIL.test(d) ? 1 : 2;
  };
  return [...clean].sort((a, b) => rank(a) - rank(b)).slice(0, 5);
}

/** Links to contact / about pages on the same site, at most `max` */
export function contactLinks(html: string, base: string, max = 3): string[] {
  const b = new URL(base);
  const host = siteDomain(b.hostname);
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2].replace(/<[^>]+>/g, ' ')}`;
    if (!/kontak|contact|hubungi|about|tentang|reach-us|lokasi|alamat/i.test(label)) continue;
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]), b);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || siteDomain(u.hostname) !== host) continue;
    u.hash = '';
    const s = u.toString();
    if (s !== b.toString() && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export interface ScanResult {
  emails: string[];
  note: string;
  pages: number;
}

/** Reads the home page and up to three contact / about pages of a business website */
export async function scanWebsite(website: string): Promise<ScanResult> {
  let start: URL;
  try {
    start = checkUrl(website);
  } catch (e) {
    return { emails: [], note: (e as Error).message, pages: 0 };
  }
  if (SKIP_HOSTS.test(start.hostname)) return { emails: [], note: 'Social media or marketplace page, no e-mail to read', pages: 0 };
  const emails = new Set<string>();
  let pages = 0;
  let home: Page | null = null;
  try {
    home = await fetchPage(start.toString());
  } catch (e) {
    return { emails: [], note: e instanceof ScanError ? e.message : 'The website could not be opened', pages: 0 };
  }
  if (!home) return { emails: [], note: 'The website did not return a page', pages: 0 };
  pages++;
  const host = new URL(home.url).hostname;
  for (const e of extractEmails(home.html, host)) emails.add(e);
  if (emails.size < 2) {
    const links = contactLinks(home.html, home.url);
    const guesses = ['/kontak', '/contact', '/hubungi-kami', '/contact-us'].map((p) => new URL(p, home!.url).toString());
    for (const link of [...links, ...guesses].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3)) {
      try {
        const p = await fetchPage(link);
        if (!p) continue;
        pages++;
        for (const e of extractEmails(p.html, host)) emails.add(e);
        if (emails.size >= 2) break;
      } catch {
        /* a missing contact page is normal */
      }
    }
  }
  const list = extractEmails([...emails].map((e) => `mailto:${e}`).join(' '), host);
  return { emails: list, note: list.length ? `Found on the website (${pages} page${pages > 1 ? 's' : ''} read)` : `No e-mail address on the website (${pages} page${pages > 1 ? 's' : ''} read)`, pages };
}
