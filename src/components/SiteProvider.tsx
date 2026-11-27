import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SITE_DEFAULTS } from '../data/siteDefaults';
import { CMS_ENABLED, fetchSiteContent, readCachedSite } from '../lib/site';
import { SiteContext, buildSiteValue } from '../lib/siteContext';
import type { SiteContent } from '../lib/siteTypes';

/**
 * Render pertama langsung memakai konten bawaan (atau cache sesi < 10 menit),
 * lalu — bila VITE_CMS_URL diisi — mengambil konten terbaru dari ERP sekali per
 * pemuatan halaman. Gagal/timeout → konten bawaan tetap tampil.
 */
export default function SiteProvider({ children }: { children: ReactNode }) {
  const [cached] = useState<SiteContent | null>(() => readCachedSite());
  const [site, setSite] = useState<SiteContent>(() => cached ?? SITE_DEFAULTS);

  useEffect(() => {
    if (!CMS_ENABLED || cached) return;
    const ctrl = new AbortController();
    fetchSiteContent(ctrl.signal).then((fresh) => {
      if (fresh && !ctrl.signal.aborted) setSite(fresh);
    });
    return () => ctrl.abort();
  }, [cached]);

  const value = useMemo(() => buildSiteValue(site), [site]);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
