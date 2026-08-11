export interface BlogBlock {
  type: 'p' | 'h2' | 'ul';
  text?: string;
  items?: string[];
}

export interface BlogMeta {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  isoDate: string;
  readTime: string;
  image: string;
}

export const BLOG_CATEGORIES = [
  'Panduan',
  'SEO',
  'Toko Online',
  'Aplikasi',
  'Bisnis',
  'Keamanan',
  'Teknologi',
  'Tips',
] as const;
