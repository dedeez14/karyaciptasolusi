import type { Tone } from '@/components/ui/primitives';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function printHtml(html: string) {
  const f = document.createElement('iframe');
  Object.assign(f.style, { position: 'fixed', width: '0', height: '0', border: '0' });
  document.body.appendChild(f);
  f.contentDocument!.open();
  f.contentDocument!.write(html);
  f.contentDocument!.close();
  setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 2000);
  }, 200);
}

export const PRINT_CSS = `@page { size: A4; margin: 14mm; } body { font: 10.5px system-ui, sans-serif; color: #111; } h1 { font-size: 15px; margin: 6px 0 2px; } h2 { font-size: 12.5px; margin: 16px 0 4px; } table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { border: 1px solid #999; padding: 4px 5px; text-align: left; vertical-align: top; } th { background: #eef2f7; } .r { text-align: right; } .muted { color: #555; } .b { font-weight: 600; }`;

/** CSV download (semicolon separated, opens in Excel with an Indonesian locale) */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const CERT_TYPES: Record<string, { label: string; hint: string }> = {
  HALAL: { label: 'Halal (BPJPH)', hint: 'Valid while ingredients and process stay the same (UU 33/2014 Art. 42 as amended by UU 6/2023)' },
  BPOM_MD: { label: 'BPOM MD (domestic)', hint: 'Marketing authorisation for processed food / cosmetics made in Indonesia' },
  BPOM_ML: { label: 'BPOM ML (imported)', hint: 'Marketing authorisation for imported products' },
  PIRT: { label: 'SPP-IRT (home industry)', hint: 'Home-industry food production certificate from the regency / city' },
  SNI: { label: 'SPPT-SNI', hint: 'Certificate for using the SNI mark' },
  TKDN: { label: 'TKDN', hint: 'Local content certificate: the value is valid 5 years (Permenperin 35/2025 Art. 45)' },
  ISO: { label: 'ISO', hint: 'ISO 9001 / 14001 / 22000 / 45001...' },
  HACCP: { label: 'HACCP', hint: 'Food safety' },
  NKV: { label: 'NKV', hint: 'Veterinary control number (animal products)' },
  ISPO: { label: 'ISPO', hint: 'Indonesian sustainable palm oil' },
  OTHER: { label: 'Other licence', hint: '' },
};

export const CERT_STATUS: Record<string, { label: string; tone: Tone }> = {
  VALID: { label: 'Valid', tone: 'green' },
  EXPIRING: { label: 'Expiring', tone: 'amber' },
  EXPIRED: { label: 'Expired', tone: 'red' },
  REVIEW: { label: 'Review needed', tone: 'violet' },
  INACTIVE: { label: 'Inactive', tone: 'gray' },
};

export const TREATMENT: Record<string, string> = {
  HANDED_OVER: 'Handed to a licensed collector / processor',
  UTILISED: 'Utilised by us (pemanfaatan)',
  TREATED: 'Treated by us (pengolahan)',
  LANDFILLED: 'Landfilled (penimbunan)',
  EXPORTED: 'Exported',
  OTHER: 'Other treatment',
};

/** same rules as the server (Permenperin 35/2025 Art. 4-12) for the live preview while editing */
export function tkdnCredit(l: { originCountry: string; hasCertificate: boolean; certTkdn: number | null; domesticProducer: boolean; allDomesticMaterials: boolean }) {
  const dom = ['ID', 'IDN'].includes((l.originCountry || 'ID').toUpperCase());
  if (!dom) return 0;
  if (l.hasCertificate && l.certTkdn !== null && !Number.isNaN(l.certTkdn)) {
    const v = l.certTkdn;
    return v > 80 ? 100 : v > 60 ? 80 : v > 40 ? 60 : v >= 25 ? 40 : 25;
  }
  if (l.allDomesticMaterials) return 100;
  if (l.domesticProducer) return 25;
  return 0;
}
