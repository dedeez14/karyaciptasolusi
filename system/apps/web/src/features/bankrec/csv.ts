/**
 * CSV helpers for bank statements and opening balance imports.
 * Handles quoted cells, ',' ';' or tab separators, Indonesian (1.234.567,89) and English (1,234,567.89) numbers,
 * and the date formats banks export (31/12/2026, 2026-12-31, 31-12-2026, 31 Des 2026, 31 Dec 2026, 31/12/26).
 */

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/)[0] ?? '';
  const counts = { ',': (first.match(/,/g) ?? []).length, ';': (first.match(/;/g) ?? []).length, '\t': (first.match(/\t/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export type NumberStyle = 'auto' | 'id' | 'en';

/** "1.234.567,89" / "1,234,567.89" / "(1.500)" / "1.500 CR" -> number, NaN when it is not a number */
export function parseAmount(raw: string, style: NumberStyle = 'auto'): number {
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\s*(DB|DR|D)$/i.test(s)) {
    sign = -1;
    s = s.replace(/\s*(DB|DR|D)$/i, '');
  } else s = s.replace(/\s*(CR|C|K)$/i, '');
  s = s.replace(/[^\d.,-]/g, '');
  if (s.startsWith('-')) {
    sign *= -1;
    s = s.slice(1);
  }
  if (!s) return NaN;
  let st = style;
  if (st === 'auto') {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) st = lastComma > lastDot ? 'id' : 'en';
    else if (lastComma >= 0) st = /,\d{3}$/.test(s) && (s.match(/,/g) ?? []).length >= 1 && !/,\d{1,2}$/.test(s) ? 'en' : 'id';
    else if (lastDot >= 0) st = /\.\d{3}$/.test(s) && !/\.\d{1,2}$/.test(s) ? 'id' : 'en';
    else st = 'en';
  }
  const normalized = st === 'id' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const v = Number(normalized);
  return Number.isFinite(v) ? sign * v : NaN;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, ags: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, nop: 11, november: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

export type DateStyle = 'auto' | 'dmy' | 'mdy' | 'ymd';

/** -> 'YYYY-MM-DD' or null. Day-first is assumed for ambiguous numeric dates unless 'mdy' is chosen. */
export function parseDate(raw: string, style: DateStyle = 'auto'): string | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{2,4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (style === 'mdy' || (style === 'auto' && b > 12 && a <= 12)) return valid(y, a, b);
    return valid(y, b, a);
  }
  return null;
}

/** Saves rows as a CSV file (template downloads) */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** best guess of which column holds what, from the header names */
export function guessColumn(headers: string[], ...patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = headers.findIndex((h) => re.test(h.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}
