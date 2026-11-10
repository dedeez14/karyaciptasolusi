/**
 * Menghasilkan src/data/blogMeta.generated.ts dari seluruh file di src/data/articles/.
 *
 * Tujuannya menjaga bundle utama tetap kecil: hanya metadata (judul, tanggal, dsb.)
 * yang ikut ke bundle awal, sedangkan isi artikel dimuat lazy saat dibuka.
 * Dijalankan otomatis sebelum build & dev lewat script di package.json.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const articlesDir = join(root, 'src', 'data', 'articles');
const outFile = join(root, 'src', 'data', 'blogMeta.generated.ts');

const FIELDS = ['slug', 'title', 'excerpt', 'category', 'date', 'isoDate', 'readTime', 'image'];

function readField(src, key) {
  const m = src.match(new RegExp(`${key}:\\s*(["'])([\\s\\S]*?)\\1,?\\s*\\n`));
  return m ? m[2] : null;
}

const posts = [];
const errors = [];

for (const file of readdirSync(articlesDir).filter((f) => f.endsWith('.ts')).sort()) {
  const src = readFileSync(join(articlesDir, file), 'utf8');
  const entry = {};
  for (const f of FIELDS) {
    const v = readField(src, f);
    if (v === null) {
      errors.push(`${file}: field "${f}" tidak ditemukan`);
      break;
    }
    entry[f] = v;
  }
  if (Object.keys(entry).length !== FIELDS.length) continue;
  if (entry.slug !== basename(file, '.ts')) {
    errors.push(`${file}: slug "${entry.slug}" tidak cocok dengan nama file`);
    continue;
  }
  posts.push(entry);
}

if (errors.length) {
  console.error('[blog-meta] gagal:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

posts.sort((a, b) => b.isoDate.localeCompare(a.isoDate));

const body = posts
  .map(
    (p) =>
      '  {\n' +
      FIELDS.map((f) => `    ${f}: ${JSON.stringify(p[f])},`).join('\n') +
      '\n  },',
  )
  .join('\n');

writeFileSync(
  outFile,
  `// File ini dibuat otomatis oleh scripts/generate-blog-meta.mjs — jangan diedit manual.\n` +
    `import type { BlogMeta } from './blogTypes';\n\n` +
    `export const blogMeta: BlogMeta[] = [\n${body}\n];\n`,
  'utf8',
);

console.log(`[blog-meta] ${posts.length} artikel -> src/data/blogMeta.generated.ts`);
