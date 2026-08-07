import { useEffect } from 'react';

const DEFAULT_TITLE = 'Jasa Pembuatan Website & Aplikasi Depok | PT Karya Cipta Solusi';
const DEFAULT_DESCRIPTION =
  'Jasa pembuatan website company profile, toko online, dan aplikasi custom di Depok — melayani seluruh Indonesia. Konsultasi gratis, bayar bertahap, garansi 1 bulan.';

/** Set judul dokumen, meta description, canonical, dan JSON-LD opsional untuk halaman SPA; dikembalikan ke default saat unmount. */
export function usePageMeta(options: {
  title: string;
  description: string;
  canonicalPath?: string;
  jsonLd?: object;
}) {
  const { title, description, canonicalPath, jsonLd } = options;

  useEffect(() => {
    document.title = title;

    const metaDesc = document.querySelector('meta[name="description"]');
    const prevDesc = metaDesc?.getAttribute('content') ?? DEFAULT_DESCRIPTION;
    metaDesc?.setAttribute('content', description);

    const canonical = document.querySelector('link[rel="canonical"]');
    const prevCanonical = canonical?.getAttribute('href') ?? '';
    if (canonical && canonicalPath) {
      canonical.setAttribute('href', new URL(canonicalPath, prevCanonical || window.location.origin).href);
    }

    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      document.title = DEFAULT_TITLE;
      metaDesc?.setAttribute('content', prevDesc);
      if (canonical && prevCanonical) canonical.setAttribute('href', prevCanonical);
      script?.remove();
    };
  }, [title, description, canonicalPath, jsonLd]);
}
