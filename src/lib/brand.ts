/**
 * Warna brand dalam bentuk hex untuk tempat yang tidak bisa memakai CSS variable
 * (canvas, nilai animasi framer-motion). Harus sama dengan :root di src/index.css.
 */
export const BRAND = {
  navy: '#1d4f7a',
  navyDark: '#163d5f',
  navyDarker: '#0f2a40',
  navyLight: '#2f6a9a',
  tint: '#eef4f9',
  tintStrong: '#d7e5f0',
  gold: '#f8b810',
  goldDark: '#e0a50e',
  /** teks di atas gold */
  goldInk: '#0f2a40',
} as const;
