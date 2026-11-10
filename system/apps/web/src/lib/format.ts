let locale = 'id-ID';
export const setLocale = (l: string) => (locale = l || 'id-ID');

export const fmtMoney = (v: unknown, dp = 2) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n) : '';
};
export const fmtNumber = (v: unknown, max = 4) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? new Intl.NumberFormat(locale, { maximumFractionDigits: max }).format(n) : '';
};
export const fmtCompact = (v: unknown) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v ?? 0));
export const fmtDate = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: String(v).length <= 10 || String(v).endsWith('T00:00:00.000Z') ? 'UTC' : undefined });
};
export const fmtDateTime = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const fmtBytes = (n: number) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const isoDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const monthStart = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};
export const yearStart = () => isoDate(new Date(new Date().getFullYear(), 0, 1));
/** Formats a value according to a metadata type */
export const fmtByType = (v: unknown, type?: string) => {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'money':
      return fmtMoney(v);
    case 'number':
    case 'qty':
    case 'integer':
      return fmtNumber(v);
    case 'percent':
      return `${fmtNumber(v, 2)}%`;
    case 'date':
      return fmtDate(v);
    case 'datetime':
      return fmtDateTime(v);
    case 'boolean':
      return v ? 'Yes' : 'No';
    default:
      return String(v);
  }
};
