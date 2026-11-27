/**
 * Prerender meta per halaman (dijalankan setelah `vite build`).
 *
 * Situs ini SPA: tanpa langkah ini, HTML mentah setiap URL adalah dist/index.html milik beranda,
 * sehingga artikel blog terbaca crawler non-JS dan pratinjau Facebook/WhatsApp sebagai beranda
 * (judul, description, og:*, dan canonical → beranda).
 *
 * Skrip ini menulis satu file HTML per halaman penting dengan <head> yang benar dan isi artikel
 * yang bisa dibaca tanpa JavaScript. React (createRoot) mengganti isi #root saat aplikasi jalan,
 * jadi tampilan pengguna tidak berubah.
 *
 * Cloudflare Pages menyajikan /blog/slug dari dist/blog/slug.html (file statis didahulukan
 * daripada aturan SPA di _redirects).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = 'https://karyaciptasolusi.com';
const BRAND = 'PT Karya Cipta Solusi';

const template = readFileSync(join(dist, 'index.html'), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ganti atribut content/href pada tag yang cocok; gagal keras bila tag tidak ditemukan (template berubah). */
function setAttr(html, tagPattern, attr, value) {
  let hit = false;
  const out = html.replace(tagPattern, (tag) => {
    hit = true;
    return tag.replace(new RegExp(`${attr}="[^"]*"`), `${attr}="${esc(value)}"`);
  });
  if (!hit) throw new Error(`[prerender] tag tidak ditemukan di index.html: ${tagPattern}`);
  return out;
}
const meta = (attr, key) => new RegExp(`<meta\\s+${attr}="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`);

function page({ path, title, description, type = 'website', jsonLd, body }) {
  const url = `${SITE}${path}`;
  let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = setAttr(html, meta('name', 'description'), 'content', description);
  html = setAttr(html, /<link\s+rel="canonical"[^>]*>/, 'href', url);
  html = setAttr(html, meta('property', 'og:type'), 'content', type);
  html = setAttr(html, meta('property', 'og:url'), 'content', url);
  html = setAttr(html, meta('property', 'og:title'), 'content', title);
  html = setAttr(html, meta('property', 'og:description'), 'content', description);
  html = setAttr(html, meta('name', 'twitter:title'), 'content', title);
  html = setAttr(html, meta('name', 'twitter:description'), 'content', description);
  // FAQ beranda tidak tampil di halaman lain: data terstruktur FAQ hanya untuk beranda.
  html = html.replace(/\s*<!-- FAQ Structured Data[\s\S]*?<\/script>/, '');
  if (jsonLd) {
    html = html.replace('</head>', `    <script type="application/ld+json" data-prerendered>${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n  </head>`);
  }
  if (body) {
    const style = 'max-width:760px;margin:0 auto;padding:32px 20px;font-family:Inter,system-ui,sans-serif;line-height:1.75;color:#0f172a';
    html = html.replace('<div id="root"></div>', `<div id="root"><main data-prerendered style="${style}">${body}</main></div>`);
  }
  if (html === template) throw new Error(`[prerender] tidak ada perubahan untuk ${path}`);
  const file = join(dist, `${path.replace(/^\//, '')}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

/** Baca src/data/articles/<slug>.ts tanpa TypeScript: berkas ini hanya berisi objek literal milik repo sendiri. */
function loadArticle(file) {
  const src = readFileSync(file, 'utf8')
    .replace(/^import type .*$/m, '')
    .replace('export const meta =', 'const meta =')
    .replace(/const content:\s*BlogBlock\[\]\s*=/, 'const content =')
    .replace(/export default content;?/, 'return { meta, content };');
  return new Function(src)();
}

const blockHtml = (b) =>
  b.type === 'h2' ? `<h2>${esc(b.text)}</h2>` : b.type === 'ul' ? `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p>${esc(b.text)}</p>`;

const articlesDir = join(root, 'src', 'data', 'articles');
const posts = readdirSync(articlesDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => loadArticle(join(articlesDir, f)))
  .sort((a, b) => b.meta.isoDate.localeCompare(a.meta.isoDate));

for (const { meta: m, content } of posts) {
  const path = `/blog/${m.slug}`;
  page({
    path,
    title: `${m.title} | ${BRAND}`,
    description: m.excerpt,
    type: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          headline: m.title,
          description: m.excerpt,
          datePublished: m.isoDate,
          inLanguage: 'id-ID',
          image: `${SITE}${m.image}`,
          articleSection: m.category,
          author: { '@type': 'Organization', name: BRAND },
          publisher: { '@type': 'Organization', name: BRAND },
          mainEntityOfPage: `${SITE}${path}`,
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Beranda', item: `${SITE}/` },
            { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
            { '@type': 'ListItem', position: 3, name: m.title },
          ],
        },
      ],
    },
    body: [
      `<p><a href="/">Beranda</a> › <a href="/blog">Blog</a> › ${esc(m.category)}</p>`,
      `<h1>${esc(m.title)}</h1>`,
      `<p>${esc(m.date)} · ${esc(m.readTime)} baca</p>`,
      `<p><strong>${esc(m.excerpt)}</strong></p>`,
      ...content.map(blockHtml),
      `<p><a href="/blog">← Semua artikel</a> · <a href="https://wa.me/6283898911244">Konsultasi gratis via WhatsApp</a></p>`,
    ].join('\n'),
  });
}

// Halaman daftar blog: berisi tautan ke semua artikel (membantu crawler menemukan setiap artikel).
/** Judul & description dari panggilan usePageMeta di sebuah halaman (sumber tunggal: kode halaman itu sendiri). */
function pageMeta(file) {
  const src = readFileSync(join(root, 'src', 'pages', file), 'utf8');
  const m = /usePageMeta\(\{\s*title:\s*'([^']+)',\s*description:\s*'([^']+)'/.exec(src);
  if (!m) throw new Error(`[prerender] judul/description tidak terbaca dari ${file}`);
  return { title: m[1], description: m[2] };
}

page({
  path: '/blog',
  ...pageMeta('Blog.tsx'),
  body: [
    `<h1>Blog &amp; Artikel</h1>`,
    `<ul>${posts.map(({ meta: m }) => `<li><a href="/blog/${m.slug}">${esc(m.title)}</a> — ${esc(m.excerpt)}</li>`).join('\n')}</ul>`,
  ].join('\n'),
});

// Halaman legal: cukup <head> yang benar (judul, description, canonical).
for (const [path, file] of [
  ['/kebijakan-privasi', 'KebijakanPrivasi.tsx'],
  ['/penghapusan-data', 'PenghapusanData.tsx'],
  ['/syarat-ketentuan', 'SyaratKetentuan.tsx'],
]) {
  page({ path, ...pageMeta(file) });
}

console.log(`[prerender] ${posts.length} artikel + /blog + 3 halaman legal ditulis ke dist/`);
