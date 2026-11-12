# karyaciptasolusi.com — situs PT Karya Cipta Solusi

## Konten dari ERP

Isi situs (kontak perusahaan, hero, layanan, portofolio, testimoni, FAQ, klien, statistik,
alasan, langkah kerja sama, lowongan, pengumuman, section yang disembunyikan) bisa diedit dari ERP.

- Atur `VITE_CMS_URL` (lihat `.env.example`), mis. `VITE_CMS_URL=https://erp.karyaciptasolusi.com`
  di environment variables Vercel. Nilai ini dibaca saat build.
- Saat halaman dibuka, situs mengambil `GET ${VITE_CMS_URL}/api/v1/public/website` sekali
  (timeout 4 detik, cache `sessionStorage` 10 menit). Render pertama selalu memakai konten bawaan
  di `src/data/siteDefaults.ts`, lalu teks diganti bila ERP membalas.
- Field kosong (`""` / `[]` / `null`) dari ERP = pakai konten bawaan untuk field/section itu.
  Respons yang tidak valid diabaikan. ERP mati / `VITE_CMS_URL` kosong → situs tetap utuh.
- Formulir kontak & newsletter mengirim `POST ${VITE_CMS_URL}/api/v1/public/website/enquiry`
  (menjadi lead CRM). Tanpa `VITE_CMS_URL` atau saat server tak terjangkau, formulir kembali
  meneruskan pesan ke WhatsApp.
- Origin ERP harus diizinkan di CSP `connect-src` (`vercel.json` dan `public/_headers`;
  saat ini `https://*.karyaciptasolusi.com`).
- Ikon item memakai nama lucide kebab-case yang terdaftar di `src/lib/icons.ts`
  (nama lain → ikon bawaan). Judul hero: baris dipisah `
`, teks di antara `*bintang*` diberi warna aksen.
- Kode: tipe di `src/lib/siteTypes.ts`, fetch/validasi/merge di `src/lib/site.ts`,
  `useSite()` di `src/lib/siteContext.ts`, provider di `src/components/SiteProvider.tsx`.

## Warna brand

Navy `#1d4f7a` (utama) dan gold `#f8b810` (aksen), didefinisikan sekali sebagai CSS variable di
`src/index.css` (`--brand`, `--brand-dark`, `--brand-darker`, `--brand-light`, `--brand-tint`,
`--brand-tint-strong`, `--gold`, `--gold-dark`) dan tersedia di Tailwind sebagai `brand`, `brand-dark`,
`brand-light`, `brand-tint`, `gold`, `gold-ink`, dst. Teks di atas gold selalu navy gelap (`text-gold-ink`),
tidak pernah putih.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
