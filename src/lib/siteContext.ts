import { createContext, useContext } from 'react';
import { SITE_DEFAULTS } from '../data/siteDefaults';
import type { SectionKey, SiteContent } from './siteTypes';
import { telLink as tel, waLink as wa } from './site';

export interface SiteContextValue {
  site: SiteContent;
  isHidden: (key: SectionKey) => boolean;
  /** https://wa.me/<nomor perusahaan>?text=… */
  waLink: (text?: string) => string;
  /** tel:<telepon perusahaan> */
  telLink: () => string;
}

export function buildSiteValue(site: SiteContent): SiteContextValue {
  const hidden = new Set(site.hiddenSections);
  return {
    site,
    isHidden: (key) => hidden.has(key),
    waLink: (text) => wa(site.company.whatsapp, text),
    telLink: () => tel(site.company.phone),
  };
}

export const SiteContext = createContext<SiteContextValue>(buildSiteValue(SITE_DEFAULTS));

/** Konten situs (dari ERP bila tersedia, selain itu konten bawaan). */
export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}
