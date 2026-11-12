/**
 * Bentuk konten situs. Sama persis dengan respons ERP:
 * GET {VITE_CMS_URL}/api/v1/public/website
 */

export type SocialLinks = {
  instagram?: string;
  linkedin?: string;
  facebook?: string;
  tiktok?: string;
  youtube?: string;
};

export interface CompanyInfo {
  name: string;
  phone: string;
  /** hanya digit, format internasional, mis. "6283898911244" */
  whatsapp: string;
  email: string;
  /** baris dipisah "\n" */
  address: string;
  mapsUrl: string;
  mapsEmbedUrl: string;
  hours: string[];
  social: SocialLinks;
}

export interface HeroContent {
  badge: string;
  /** baris dipisah "\n"; teks di antara *bintang* diberi warna aksen */
  title: string;
  subtitle: string;
  typing: string[];
  ctaText: string;
}

export interface ServiceItem { title: string; desc: string; icon: string | null; image: string | null; link: string | null }
export interface PortfolioItem { title: string; summary: string; category: string; url: string | null; image: string | null; tech: string[] }
export interface TestimonialItem { name: string; role: string; content: string; rating: number }
export interface FaqItem { q: string; a: string }
export interface ClientItem { name: string; logo: string | null; url: string | null }
export interface StatItem { value: number; prefix: string; suffix: string; label: string; sub: string; icon: string | null }
export interface ReasonItem { title: string; desc: string; icon: string | null }
export interface StepItem { title: string; desc: string; icon: string | null }
export interface JobItem { title: string; type: string; location: string; salary: string; edu: string; desc: string; requirements: string[] }

export const SECTION_KEYS = [
  'stats', 'clients', 'portfolio', 'services', 'whyus', 'testimonials', 'consultation',
  'faq', 'blog', 'business', 'career', 'newsletter', 'contact',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SiteContent {
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
}
