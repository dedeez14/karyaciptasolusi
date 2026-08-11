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

/**
 * Artikel terkait: sebagian besar dari kategori yang sama agar relevan, tapi selalu
 * sisakan satu slot untuk kategori lain supaya pembaca menemukan topik baru
 * dan deretan kartunya tidak terlihat seragam.
 */
export function relatedPosts(slug: string, limit = 3): BlogMeta[] {
  const current = getPostBySlug(slug);
  if (!current) return blogPosts.slice(0, limit);

  const sameCat = blogPosts.filter((p) => p.slug !== slug && p.category === current.category);
  const others = blogPosts.filter((p) => p.slug !== slug && p.category !== current.category);

  // sebarkan pilihan lintas kategori agar tidak selalu artikel terbaru yang muncul
  const seenCat = new Set<string>();
  const diverse = others.filter((p) => {
    if (seenCat.has(p.category)) return false;
    seenCat.add(p.category);
    return true;
  });

  const sameCount = Math.max(1, limit - 1);
  const picked = [...sameCat.slice(0, sameCount), ...diverse].slice(0, limit);

  // jika kategori ini artikelnya sedikit, lengkapi dari sisa artikel mana pun
  if (picked.length < limit) {
    for (const p of [...sameCat, ...others]) {
      if (picked.length >= limit) break;
      if (!picked.some((x) => x.slug === p.slug)) picked.push(p);
    }
  }
  return picked;
}
