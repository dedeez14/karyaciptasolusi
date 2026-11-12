import { SITE_DEFAULTS, PORTFOLIO_SLUGS } from '../data/siteDefaults';
import {
  SECTION_KEYS,
  type ClientItem, type CompanyInfo, type FaqItem, type HeroContent, type JobItem, type PortfolioItem,
  type ReasonItem, type SectionKey, type ServiceItem, type SiteContent, type SocialLinks, type StatItem,
  type StepItem, type TestimonialItem,
} from './siteTypes';

/* ───────────────────────── konfigurasi ───────────────────────── */

/** Origin ERP tanpa garis miring di akhir; '' = fitur CMS mati (pakai konten bawaan). */
export const CMS_URL: string = String(import.meta.env.VITE_CMS_URL ?? '').trim().replace(/\/+$/, '');
export const CMS_ENABLED = /^https?:\/\/[^/\s]+/i.test(CMS_URL);

const CACHE_KEY = 'kcs-site-content-v1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const SUBMIT_TIMEOUT_MS = 12000;

/* ───────────────────────── validasi defensif ───────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** string terpangkas (non-string → '') */
function str(v: unknown, max = 2000): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strList(v: unknown, maxItems = 30, maxLen = 300): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}

function list<T>(v: unknown, map: (o: Obj) => T | null, maxItems = 60): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    if (!isObj(item)) continue;
    const mapped = map(item);
    if (mapped) out.push(mapped);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Tautan aman: https/http absolut, path situs "/x", atau anchor "#x". Lainnya (javascript:, data:, //host) → null. */
export function safeLink(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  if ((s.startsWith('/') && !s.startsWith('//')) || /^#[\w-]+$/.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Gambar: hanya https absolut atau path situs (http akan diblok sebagai mixed content). */
function safeImage(v: unknown): string | null {
  const s = safeLink(v);
  if (!s || s.startsWith('#')) return null;
  return s.startsWith('/') || s.startsWith('https://') ? s : null;
}

function safeHttps(v: unknown): string {
  const s = safeLink(v);
  return s && s.startsWith('https://') ? s : '';
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Hasil parse: string kosong / array kosong / null berarti "pakai bawaan". */
type Parsed = {
  updatedAt: string | null;
  company: CompanyInfo;
  hero: HeroContent;
  announcement: string | null;
  hiddenSections: SectionKey[];
  services: ServiceItem[];
  portfolio: PortfolioItem[];
  testimonials: TestimonialItem[];
  faqs: FaqItem[];
  clients: ClientItem[];
  stats: StatItem[];
  reasons: ReasonItem[];
  steps: StepItem[];
  jobs: JobItem[];
};

/** Validasi respons ERP. Mengembalikan null bila bentuknya tidak dikenali sama sekali. */
export function parseSiteContent(raw: unknown): Parsed | null {
  if (!isObj(raw)) return null;
  const known = ['company', 'hero', 'services', 'portfolio', 'faqs', 'stats', 'hiddenSections'];
  if (!known.some((k) => k in raw)) return null;

  const c = isObj(raw.company) ? raw.company : {};
  const socialRaw = isObj(c.social) ? c.social : {};
  const social: SocialLinks = {};
  for (const k of ['instagram', 'linkedin', 'facebook', 'tiktok', 'youtube'] as const) {
    const url = safeHttps(socialRaw[k]);
    if (url) social[k] = url;
  }
  const email = str(c.email, 150);
  const whatsapp = str(c.whatsapp, 20).replace(/\D/g, '');
  const embed = safeHttps(c.mapsEmbedUrl);

  const h = isObj(raw.hero) ? raw.hero : {};
  const announcement = str(raw.announcement, 300);

  return {
    updatedAt: str(raw.updatedAt, 64) || null,
    company: {
      name: str(c.name, 150),
      phone: str(c.phone, 50),
      whatsapp: whatsapp.length >= 8 && whatsapp.length <= 15 ? whatsapp : '',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      address: str(c.address, 500),
      mapsUrl: safeHttps(c.mapsUrl),
      // CSP frame-src hanya mengizinkan www.google.com
      mapsEmbedUrl: embed.startsWith('https://www.google.com/maps/embed') ? embed : '',
      hours: strList(c.hours, 10, 120),
      social,
    },
    hero: {
      badge: str(h.badge, 80),
      title: str(h.title, 200),
      subtitle: str(h.subtitle, 600),
      typing: strList(h.typing, 10, 80),
      ctaText: str(h.ctaText, 40),
    },
    announcement: announcement || null,
    hiddenSections: strList(raw.hiddenSections, 20, 40).filter((k): k is SectionKey =>
      (SECTION_KEYS as readonly string[]).includes(k),
    ),
    services: list(raw.services, (o) => {
      const title = str(o.title, 120);
      return title ? { title, desc: str(o.desc, 400), icon: str(o.icon, 40) || null, image: safeImage(o.image), link: safeLink(o.link) } : null;
    }, 12),
    portfolio: list(raw.portfolio, (o) => {
      const title = str(o.title, 120);
      return title
        ? { title, summary: str(o.summary, 400), category: str(o.category, 40), url: safeLink(o.url), image: safeImage(o.image), tech: strList(o.tech, 8, 30) }
        : null;
    }, 24),
    testimonials: list(raw.testimonials, (o) => {
      const name = str(o.name, 100);
      const content = str(o.content, 800);
      if (!name || !content) return null;
      const r = num(o.rating);
      return { name, role: str(o.role, 120), content, rating: r === null || r < 1 ? 5 : Math.min(5, Math.round(r)) };
    }, 20),
    faqs: list(raw.faqs, (o) => {
      const q = str(o.q, 300);
      const a = str(o.a, 2000);
      return q && a ? { q, a } : null;
    }, 40),
    clients: list(raw.clients, (o) => {
      const name = str(o.name, 100);
      return name ? { name, logo: safeImage(o.logo), url: safeLink(o.url) } : null;
    }, 40),
    stats: list(raw.stats, (o) => {
      const value = num(o.value);
      const label = str(o.label, 40);
      return value !== null && label
        ? { value, prefix: str(o.prefix, 6), suffix: str(o.suffix, 6), label, sub: str(o.sub, 60), icon: str(o.icon, 40) || null }
        : null;
    }, 8),
    reasons: list(raw.reasons, (o) => {
      const title = str(o.title, 120);
      return title ? { title, desc: str(o.desc, 400), icon: str(o.icon, 40) || null } : null;
    }, 12),
    steps: list(raw.steps, (o) => {
      const title = str(o.title, 120);
      return title ? { title, desc: str(o.desc, 400), icon: str(o.icon, 40) || null } : null;
    }, 8),
    jobs: list(raw.jobs, (o) => {
      const title = str(o.title, 120);
      return title
        ? {
            title,
            type: str(o.type, 40),
            location: str(o.location, 80),
            salary: str(o.salary, 80),
            edu: str(o.edu, 80),
            desc: str(o.desc, 600),
            requirements: strList(o.requirements, 12, 200),
          }
        : null;
    }, 20),
  };
}

/* ───────────────────────── merge dengan bawaan ───────────────────────── */

const pick = (v: string, d: string) => (v ? v : d);
const pickList = <T,>(v: T[], d: T[]) => (v.length ? v : d);

/** Gambar portofolio bawaan bila judul cocok dengan proyek/slug yang dikenal. */
function portfolioImageFor(title: string): string | null {
  const t = title.toLowerCase();
  const byDefault = SITE_DEFAULTS.portfolio.find((p) => p.title.toLowerCase() === t);
  if (byDefault?.image) return byDefault.image;
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const slug = PORTFOLIO_SLUGS.find((s) => words.includes(s) || words.join('-') === s);
  return slug ? `/images/portofolio/${slug}.png` : null;
}

export function mergeSite(defaults: SiteContent, p: Parsed | null): SiteContent {
  if (!p) return defaults;
  const dc = defaults.company;
  const dh = defaults.hero;
  return {
    updatedAt: p.updatedAt,
    company: {
      name: pick(p.company.name, dc.name),
      phone: pick(p.company.phone, dc.phone),
      whatsapp: pick(p.company.whatsapp, dc.whatsapp),
      email: pick(p.company.email, dc.email),
      address: pick(p.company.address, dc.address),
      mapsUrl: pick(p.company.mapsUrl, dc.mapsUrl),
      mapsEmbedUrl: pick(p.company.mapsEmbedUrl, dc.mapsEmbedUrl),
      hours: pickList(p.company.hours, dc.hours),
      social: { ...dc.social, ...p.company.social },
    },
    hero: {
      badge: pick(p.hero.badge, dh.badge),
      title: pick(p.hero.title, dh.title),
      subtitle: pick(p.hero.subtitle, dh.subtitle),
      typing: pickList(p.hero.typing, dh.typing),
      ctaText: pick(p.hero.ctaText, dh.ctaText),
    },
    announcement: p.announcement,
    hiddenSections: p.hiddenSections,
    services: p.services.length
      ? p.services.map((s) => {
          const d = defaults.services.find((x) => x.title.toLowerCase() === s.title.toLowerCase());
          return { ...s, icon: s.icon ?? d?.icon ?? null, image: s.image ?? d?.image ?? null, desc: s.desc || d?.desc || '' };
        })
      : defaults.services,
    portfolio: p.portfolio.length
      ? p.portfolio.map((it) => ({ ...it, category: it.category || 'Proyek', image: it.image ?? portfolioImageFor(it.title) }))
      : defaults.portfolio,
    testimonials: pickList(p.testimonials, defaults.testimonials),
    faqs: pickList(p.faqs, defaults.faqs),
    clients: pickList(p.clients, defaults.clients),
    stats: pickList(p.stats, defaults.stats),
    reasons: pickList(p.reasons, defaults.reasons),
    steps: pickList(p.steps, defaults.steps),
    jobs: pickList(p.jobs, defaults.jobs),
  };
}

/* ───────────────────────── fetch + cache sesi ───────────────────────── */

type CacheEntry = { at: number; data: unknown };

/** Konten dari sessionStorage bila masih segar (< 10 menit), sudah divalidasi ulang. */
export function readCachedSite(): SiteContent | null {
  if (!CMS_ENABLED) return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.at !== 'number' || Date.now() - entry.at > CACHE_TTL_MS) return null;
    const parsed = parseSiteContent(entry.data);
    return parsed ? mergeSite(SITE_DEFAULTS, parsed) : null;
  } catch {
    return null;
  }
}

/** Ambil konten dari ERP (timeout 4 detik). Gagal / tidak valid → null (situs tetap pakai bawaan). */
export async function fetchSiteContent(signal?: AbortSignal): Promise<SiteContent | null> {
  if (!CMS_ENABLED) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${CMS_URL}/api/v1/public/website`, {
      signal: ctrl.signal,
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const parsed = parseSiteContent(data);
    if (!parsed) return null;
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data } satisfies CacheEntry));
    } catch {
      /* storage penuh / diblok: abaikan */
    }
    return mergeSite(SITE_DEFAULTS, parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ───────────────────────── helper kontak ───────────────────────── */

export function waLink(whatsapp: string, text?: string): string {
  return `https://wa.me/${whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** "0838-9891-1244" → "tel:083898911244"; "+62 838…" → "tel:+62838…" */
export function telLink(phone: string): string {
  const trimmed = phone.trim();
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
}

export function addressLines(address: string): string[] {
  return address.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function addressOneLine(address: string): string {
  return addressLines(address).join(', ');
}

/* ───────────────────────── kirim pesan / newsletter ───────────────────────── */

export const ENQUIRY_LIMITS = { name: 150, email: 150, phone: 50, subject: 150, message: 4000 } as const;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EnquiryPayload {
  kind: 'contact' | 'newsletter';
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message?: string;
  /** honeypot — harus kosong */
  website: string;
  /** UU PDP: pemberitahuan / persetujuan yang dilihat pengirim, disimpan bersama datanya */
  consentText?: string;
}

/** teks pemberitahuan pemrosesan data yang tampil di bawah formulir (disimpan bersama lead di ERP) */
export const CONTACT_NOTICE = 'Data Anda hanya dipakai untuk membalas pesan ini.';
export const NEWSLETTER_NOTICE = 'Dengan berlangganan, Anda setuju menerima e-mail informasi dari kami. Anda bisa berhenti berlangganan kapan saja.';

export type EnquiryResult =
  | { ok: true }
  /** network = server tak terjangkau / timeout / VITE_CMS_URL kosong → alihkan ke WhatsApp */
  | { ok: false; reason: 'network' | 'invalid' | 'rate' | 'server'; message: string };

export const RATE_LIMIT_MESSAGE = 'Terlalu banyak percobaan, coba lagi sebentar lagi.';

export async function submitEnquiry(payload: EnquiryPayload): Promise<EnquiryResult> {
  if (!CMS_ENABLED) return { ok: false, reason: 'network', message: 'Server tidak dikonfigurasi.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${CMS_URL}/api/v1/public/website/enquiry`, {
      method: 'POST',
      signal: ctrl.signal,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, reason: 'network', message: 'Tidak dapat terhubung ke server.' };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 201 || res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, reason: 'rate', message: RATE_LIMIT_MESSAGE };
  let message = '';
  try {
    const body: unknown = await res.json();
    if (isObj(body)) message = str(body.message, 300);
  } catch {
    /* body bukan JSON */
  }
  if (res.status === 400) return { ok: false, reason: 'invalid', message: message || 'Data yang dikirim belum valid.' };
  return { ok: false, reason: 'server', message: 'Server sedang bermasalah. Silakan coba lagi atau hubungi kami via WhatsApp.' };
}
