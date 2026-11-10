/**
 * CSV reader for the google-maps-scraper output (RFC 4180: quoted fields, "" escapes, line breaks
 * inside quotes, UTF-8 BOM). The scraper writes nested JSON into some columns, so a naive split
 * on commas or lines does not work.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Rows as objects keyed by the (lower-cased) header. Incomplete trailing rows (file still being written) are dropped. */
export function csvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < header.length - 1) continue; // half-written line
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (r[i] ?? '').trim()));
    out.push(rec);
  }
  return out;
}

/** Same as csvRecords, but only counts (cheap progress while the scraper is still writing). */
export function countCsvRows(text: string): number {
  return Math.max(0, csvRecords(text).length);
}
