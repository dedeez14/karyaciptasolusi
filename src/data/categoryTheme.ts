/**
 * Warna khas tiap kategori blog.
 * Semuanya berada di spektrum navy-biru-cyan-indigo agar tetap satu keluarga dengan
 * identitas perusahaan, tapi cukup berbeda supaya pembaca bisa mengenali
 * kategori sebuah artikel hanya dari warnanya.
 */
export interface CategoryTheme {
  /** kunci nama file sampul, mis. "toko-online" */
  key: string;
  from: string;
  to: string;
  /** warna teks & aksen di atas latar terang */
  ink: string;
  /** latar lembut untuk badge */
  tint: string;
}

export const CATEGORY_THEME: Record<string, CategoryTheme> = {
  Panduan: { key: 'panduan', from: '#1d4f7a', to: '#163d5f', ink: '#1d4f7a', tint: '#eef4f9' },
  SEO: { key: 'seo', from: '#0891B2', to: '#0E7490', ink: '#0E7490', tint: '#ECFEFF' },
  'Toko Online': { key: 'toko-online', from: '#4F46E5', to: '#4338CA', ink: '#4338CA', tint: '#EEF2FF' },
  Aplikasi: { key: 'aplikasi', from: '#0284C7', to: '#075985', ink: '#0369A1', tint: '#F0F9FF' },
  Bisnis: { key: 'bisnis', from: '#163d5f', to: '#0f2a40', ink: '#163d5f', tint: '#eef4f9' },
  Keamanan: { key: 'keamanan', from: '#1E40AF', to: '#1E3A8A', ink: '#1E40AF', tint: '#EEF2FF' },
  Teknologi: { key: 'teknologi', from: '#0E7490', to: '#164E63', ink: '#155E75', tint: '#ECFEFF' },
  Tips: { key: 'tips', from: '#6366F1', to: '#4F46E5', ink: '#4F46E5', tint: '#EEF2FF' },
};

const FALLBACK: CategoryTheme = {
  key: 'panduan',
  from: '#1d4f7a',
  to: '#163d5f',
  ink: '#1d4f7a',
  tint: '#eef4f9',
};

export function themeOf(category: string): CategoryTheme {
  return CATEGORY_THEME[category] ?? FALLBACK;
}
