import type { BlogBlock, BlogMeta } from './blogTypes';
import { blogMeta } from './blogMeta.generated';

/**
 * Registry artikel blog.
 * - Metadata datang dari blogMeta.generated.ts (dibuat otomatis dari folder articles/)
 *   sehingga bundle awal tetap kecil walau artikelnya ratusan.
 * - Isi artikel dimuat lazy per slug saat halaman artikel dibuka.
 */
const contentLoaders = import.meta.glob<{ default: BlogBlock[] }>('./articles/*.ts');

export const blogPosts: BlogMeta[] = blogMeta;

const postsBySlug = new Map(blogPosts.map((p) => [p.slug, p]));

export function getPostBySlug(slug: string): BlogMeta | undefined {
  return postsBySlug.get(slug);
}

export async function loadContent(slug: string): Promise<BlogBlock[] | null> {
  const loader = contentLoaders[`./articles/${slug}.ts`];
  if (!loader) return null;
  const mod = await loader();
  return mod.default;
}

export const categories: string[] = Array.from(
  new Set(blogPosts.map((p) => p.category)),
).sort();

export function postsByCategory(category: string): BlogMeta[] {
  return blogPosts.filter((p) => p.category === category);
}

/** Artikel terkait: prioritaskan kategori sama, lalu lengkapi dengan yang terbaru. */
export function relatedPosts(slug: string, limit = 3): BlogMeta[] {
  const current = getPostBySlug(slug);
  if (!current) return blogPosts.slice(0, limit);
  const sameCat = blogPosts.filter((p) => p.slug !== slug && p.category === current.category);
  const others = blogPosts.filter((p) => p.slug !== slug && p.category !== current.category);
  return [...sameCat, ...others].slice(0, limit);
}
