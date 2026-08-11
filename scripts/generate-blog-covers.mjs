/**
 * Membuat gambar sampul blog (SVG) bertema brand PT Karya Cipta Solusi.
 *
 * Setiap kategori punya warna khasnya sendiri (masih dalam spektrum biru-cyan-indigo
 * agar satu keluarga dengan identitas perusahaan) supaya pembaca bisa mengenali
 * kategori artikel sekilas. Empat varian per kategori dibedakan oleh komposisi
 * bentuk dekoratifnya, bukan warnanya, agar warna kategori tetap konsisten.
 *
 * 8 kategori x 4 varian = 32 sampul, masing-masing hanya ~1-2 KB.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'blog');
mkdirSync(outDir, { recursive: true });

// Ikon garis (viewBox 24) — dari set Lucide yang sudah dipakai di situs
const CATS = {
  panduan: {
    label: 'Panduan',
    from: '#2563EB',
    to: '#1D4ED8',
    icon: [
      'M12 7v14',
      'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    ],
  },
  seo: {
    label: 'SEO',
    from: '#0891B2',
    to: '#0E7490',
    icon: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'],
  },
  'toko-online': {
    label: 'Toko Online',
    from: '#4F46E5',
    to: '#4338CA',
    icon: [
      'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
      'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
      'M19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    ],
  },
  aplikasi: {
    label: 'Aplikasi',
    from: '#0284C7',
    to: '#075985',
    icon: ['M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M12 18h.01'],
  },
  bisnis: {
    label: 'Bisnis',
    from: '#0F4C81',
    to: '#0A3A63',
    icon: [
      'M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
      'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
    ],
  },
  keamanan: {
    label: 'Keamanan',
    from: '#1E40AF',
    to: '#1E3A8A',
    icon: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      'm9 12 2 2 4-4',
    ],
  },
  teknologi: {
    label: 'Teknologi',
    from: '#0E7490',
    to: '#164E63',
    icon: [
      'M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
      'M2 16a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
      'M6 6h.01',
      'M6 18h.01',
    ],
  },
  tips: {
    label: 'Tips',
    from: '#6366F1',
    to: '#4F46E5',
    icon: [
      'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
      'M9 18h6',
      'M10 22h4',
    ],
  },
};

/* Utilitas warna: campur hex dengan putih (t>0) atau hitam (t<0) */
function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) =>
    Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))
      .toString(16)
      .padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/**
 * Empat varian per kategori dibedakan sungguh-sungguh: arah gradasi, tingkat
 * terang-gelap, tekstur latar, komposisi bentuk, dan posisi ikon. Dengan begitu
 * daftar artikel dalam satu kategori pun tidak terlihat seperti kartu berulang.
 */
const VARIANTS = [
  {
    grad: { x1: 0, y1: 0, x2: 1, y2: 1 },
    tone: [0, 0],
    texture: (id) =>
      `<pattern id="${id}" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#fff" opacity=".14"/></pattern>`,
    decor: `<circle cx="1020" cy="150" r="250" fill="#fff" opacity=".07"/><circle cx="1020" cy="150" r="160" fill="#fff" opacity=".05"/><circle cx="140" cy="700" r="180" fill="#fff" opacity=".05"/>`,
    icon: { x: 600, y: 368, s: 9.5 },
  },
  {
    grad: { x1: 0, y1: 1, x2: 1, y2: 0 },
    tone: [-0.22, -0.3],
    texture: (id) =>
      `<pattern id="${id}" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="46" stroke="#fff" stroke-width="7" opacity=".07"/></pattern>`,
    decor: `<rect x="830" y="-90" width="440" height="440" rx="100" fill="#fff" opacity=".07" transform="rotate(20 1050 130)"/><rect x="-60" y="560" width="320" height="320" rx="80" fill="#fff" opacity=".05" transform="rotate(-15 100 720)"/>`,
    icon: { x: 600, y: 356, s: 10.5 },
  },
  {
    grad: { x1: 0, y1: 0, x2: 0, y2: 1 },
    tone: [0.16, 0.02],
    texture: (id) =>
      `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 0H40V40" fill="none" stroke="#fff" stroke-width="1.5" opacity=".1"/></pattern>`,
    decor: `<path d="M0 600 Q300 470 600 590 T1200 520 V800 H0Z" fill="#fff" opacity=".08"/><path d="M0 690 Q320 570 640 680 T1200 620 V800 H0Z" fill="#fff" opacity=".06"/>`,
    icon: { x: 600, y: 340, s: 9 },
  },
  {
    grad: { x1: 1, y1: 0, x2: 0, y2: 1 },
    tone: [-0.34, -0.12],
    texture: (id) =>
      `<pattern id="${id}" width="52" height="52" patternUnits="userSpaceOnUse"><circle cx="26" cy="26" r="15" fill="none" stroke="#fff" stroke-width="2" opacity=".08"/></pattern>`,
    decor: `<circle cx="1090" cy="660" r="280" fill="#fff" opacity=".07"/><rect x="70" y="70" width="250" height="250" rx="64" fill="#fff" opacity=".06"/><circle cx="196" cy="196" r="60" fill="#fff" opacity=".05"/>`,
    icon: { x: 600, y: 372, s: 10 },
  },
];

function cover(catKey, variant) {
  const c = CATS[catKey];
  const v = VARIANTS[variant - 1];
  const id = `${catKey}${variant}`;
  const paths = c.icon.map((d) => `<path d="${d}"/>`).join('');
  const from = shade(c.from, v.tone[0]);
  const to = shade(c.to, v.tone[1]);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img" aria-label="${c.label}">
<defs>
<linearGradient id="g${id}" x1="${v.grad.x1}" y1="${v.grad.y1}" x2="${v.grad.x2}" y2="${v.grad.y2}">
<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
</linearGradient>
${v.texture(`t${id}`)}
</defs>
<rect width="1200" height="800" fill="url(#g${id})"/>
<rect width="1200" height="800" fill="url(#t${id})"/>
${v.decor}
<g transform="translate(${v.icon.x} ${v.icon.y}) scale(${v.icon.s}) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".95">${paths}</g>
<text x="600" y="${v.icon.y + 244}" text-anchor="middle" font-family="'Space Grotesk','Segoe UI',system-ui,sans-serif" font-size="40" font-weight="700" fill="#fff" letter-spacing="7" opacity=".95">${c.label.toUpperCase()}</text>
<rect x="510" y="${v.icon.y + 280}" width="180" height="5" rx="2.5" fill="#fff" opacity=".55"/>
</svg>`;
}

let n = 0;
for (const key of Object.keys(CATS)) {
  for (let v = 1; v <= 4; v++) {
    writeFileSync(join(outDir, `${key}-${v}.svg`), cover(key, v), 'utf8');
    n++;
  }
}
console.log(`[blog-covers] ${n} sampul SVG dibuat di public/images/blog/`);
