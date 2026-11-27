import { useEffect } from 'react';

const SITE = 'https://karyaciptasolusi.com';
const DEFAULT_TITLE = 'Jasa Pembuatan Website & Aplikasi Depok | PT Karya Cipta Solusi';
const DEFAULT_DESCRIPTION =
  'Jasa pembuatan website company profile, toko online, dan aplikasi custom di Depok — melayani seluruh Indonesia. Konsultasi gratis, bayar bertahap, garansi 1 bulan.';

/**
 * Set judul dokumen, meta description, canonical, dan JSON-LD opsional untuk halaman SPA; kembali ke default beranda saat unmount.
 * Halaman blog & legal juga di-prerender saat build (scripts/prerender-meta.mjs) supaya HTML mentahnya sudah benar.
 */
export function usePageMeta(options: {
  title: string;
  description: string;
  canonicalPath?: string;
  jsonLd?: object;
}) {
  const { title, description, canonicalPath, jsonLd } = options;

  useEffect(() => {
    document.title = title;

    // JSON-LD bawaan prerender diganti dengan yang dipasang di bawah, supaya tidak dobel.
    document.querySelectorAll('script[data-prerendered]').forEach((s) => s.remove());

    const metaDesc = document.querySelector('meta[name="description"]');
    metaDesc?.setAttribute('content', description);

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonicalPath) canonical.setAttribute('href', new URL(canonicalPath, SITE).href);

    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    // Selalu kembali ke nilai beranda (bukan nilai "sebelumnya"): bila halaman pertama yang dibuka
    // adalah halaman prerender, nilai sebelumnya milik halaman itu, bukan beranda.
    return () => {
      document.title = DEFAULT_TITLE;
      metaDesc?.setAttribute('content', DEFAULT_DESCRIPTION);
      canonical?.setAttribute('href', `${SITE}/`);
      script?.remove();
    };
  }, [title, description, canonicalPath, jsonLd]);
}
