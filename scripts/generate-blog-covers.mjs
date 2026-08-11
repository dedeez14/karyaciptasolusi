/**
 * Membuat gambar sampul blog (SVG) bertema brand PT Karya Cipta Solusi.
 * 8 kategori x 4 varian = 32 sampul, masing-masing hanya ~1-2 KB.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'blog');
mkdirSync(outDir, { recursive: true });

// Ikon garis (viewBox 24) — diambil dari set Lucide yang sudah dipakai di situs
const ICONS = {
  panduan: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
  seo: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'],
  'toko-online': ['M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12', 'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  aplikasi: ['M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M12 18h.01'],
  bisnis: ['M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'],
  keamanan: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
  teknologi: ['M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M2 16a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M6 6h.01', 'M6 18h.01'],
  tips: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
};

const LABELS = {
  panduan: 'Panduan', seo: 'SEO', 'toko-online': 'Toko Online', aplikasi: 'Aplikasi',
  bisnis: 'Bisnis', keamanan: 'Keamanan', teknologi: 'Teknologi', tips: 'Tips',
};

// 4 kombinasi warna biru brand agar tiap varian terasa berbeda tapi tetap satu keluarga
const THEMES = [
  { from: '#1D4ED8', to: '#0F4C81' },
  { from: '#0F4C81', to: '#1E6BAF' },
  { from: '#2563EB', to: '#1D4ED8' },
  { from: '#1E40AF', to: '#2563EB' },
];

function cover(cat, variant) {
  const t = THEMES[variant - 1];
  const id = `${cat}${variant}`;
  const paths = ICONS[cat].map((d) => `<path d="${d}"/>`).join('');

  // Bentuk dekoratif berbeda per varian supaya tidak terasa seragam
  const decor = [
    `<circle cx="1020" cy="140" r="230" fill="#fff" opacity=".06"/><circle cx="150" cy="700" r="180" fill="#fff" opacity=".05"/>`,
    `<rect x="820" y="-80" width="420" height="420" rx="90" fill="#fff" opacity=".06" transform="rotate(18 1030 130)"/><circle cx="120" cy="660" r="150" fill="#fff" opacity=".05"/>`,
    `<path d="M0 640 Q300 520 600 620 T1200 560 V800 H0Z" fill="#fff" opacity=".06"/><circle cx="980" cy="180" r="150" fill="#fff" opacity=".06"/>`,
    `<circle cx="1080" cy="640" r="260" fill="#fff" opacity=".055"/><rect x="80" y="80" width="240" height="240" rx="60" fill="#fff" opacity=".05"/>`,
  ][variant - 1];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img" aria-label="${LABELS[cat]}">
<defs>
<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${t.from}"/><stop offset="1" stop-color="${t.to}"/>
</linearGradient>
<pattern id="d${id}" width="34" height="34" patternUnits="userSpaceOnUse">
<circle cx="2" cy="2" r="2" fill="#fff" opacity=".13"/>
</pattern>
</defs>
<rect width="1200" height="800" fill="url(#g${id})"/>
<rect width="1200" height="800" fill="url(#d${id})"/>
${decor}
<g transform="translate(600 372) scale(9.5) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".95">${paths}</g>
<text x="600" y="612" text-anchor="middle" font-family="'Space Grotesk','Segoe UI',system-ui,sans-serif" font-size="40" font-weight="700" fill="#fff" letter-spacing="7" opacity=".95">${LABELS[cat].toUpperCase()}</text>
<rect x="510" y="648" width="180" height="5" rx="2.5" fill="#fff" opacity=".55"/>
</svg>`;
}

let n = 0;
for (const cat of Object.keys(ICONS)) {
  for (let v = 1; v <= 4; v++) {
    writeFileSync(join(outDir, `${cat}-${v}.svg`), cover(cat, v), 'utf8');
    n++;
  }
}
console.log(`[blog-covers] ${n} sampul SVG dibuat di public/images/blog/`);
