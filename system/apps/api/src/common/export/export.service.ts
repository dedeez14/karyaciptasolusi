import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface ExportColumn {
  key: string;
  label: string;
  type?: string;
}

export interface ExportTable {
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

const NUMERIC = new Set(['number', 'money', 'percent', 'integer', 'qty']);

/** Letterhead of the workbook: company name, brand colours, logo and number locale */
export interface XlsxBrand {
  name?: string;
  color?: string;
  color2?: string;
  logo?: Buffer;
  locale?: string;
}

/** Tabular export to XLSX / CSV, shared by resources, reports and documents. */
@Injectable()
export class ExportService {
  /** Neutralises spreadsheet formula injection (=, +, -, @ prefixed strings) */
  private safe(v: unknown): unknown {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object' && 'toNumber' in (v as any)) return (v as any).toNumber();
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return `'${v}`;
    return v;
  }

  /** Company letterhead and colours for the workbook (optional: plain header without it) */
  async xlsx(t: ExportTable, brand?: XlsxBrand): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = brand?.name ?? 'KCS ERP';
    wb.created = new Date();
    const n = Math.max(1, t.columns.length);
    const argb = (hex: string | undefined, fallback: string) => `FF${(/^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex! : fallback).slice(1).toUpperCase()}`;
    const main = argb(brand?.color, '#1d4f7a');
    const accent = argb(brand?.color2, '#f8b810');
    const tint = 'FFF3F6FA';
    const line = 'FFDCE3EC';
    const landscape = t.columns.length > 6;
    const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' ') || 'Sheet1', {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
      headerFooter: { oddFooter: `&L&8${(brand?.name ?? '').replace(/&/g, '&&')}&R&8Page &P of &N` },
    });

    // ---- letterhead: company, title, period / printed, then a blank row
    const textCol = brand?.logo ? 2 : 1;
    const last = Math.max(textCol, n);
    const head = (row: number, value: string, font: Partial<ExcelJS.Font>, height: number) => {
      const r = ws.getRow(row);
      r.height = height;
      const c = r.getCell(textCol);
      c.value = this.safe(value) as ExcelJS.CellValue;
      c.font = { name: 'Calibri', ...font };
      c.alignment = { vertical: 'middle' };
      if (last > textCol) ws.mergeCells(row, textCol, row, last);
    };
    head(1, brand?.name ?? '', { bold: true, size: 14, color: { argb: main } }, 22);
    head(2, t.title, { bold: true, size: 12, color: { argb: 'FF0F172A' } }, 18);
    const printed = new Date().toLocaleString(brand?.locale ?? 'id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    head(3, [t.subtitle && `Period: ${t.subtitle}`, `Printed: ${printed}`, `${t.rows.length} rows`].filter(Boolean).join('   ·   '), { size: 9, color: { argb: 'FF64748B' } }, 16);
    if (brand?.logo) {
      try {
        const id = wb.addImage({ buffer: brand.logo as any, extension: brand.logo[0] === 0x89 ? 'png' : 'jpeg' });
        ws.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: 52, height: 52 }, editAs: 'oneCell' });
      } catch {
        /* a broken logo never blocks the export */
      }
    }
    // thin brand bar under the letterhead
    for (let c = 1; c <= last; c++) ws.getRow(4).getCell(c).border = { bottom: { style: 'medium', color: { argb: c > last * 0.78 ? accent : main } } };
    ws.getRow(4).height = 6;
    ws.addRow([]);

    // ---- header
    const headerRow = ws.getRow(6);
    t.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = this.safe(c.label) as ExcelJS.CellValue;
      cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: main } };
      cell.alignment = { vertical: 'middle', horizontal: NUMERIC.has(c.type ?? '') ? 'right' : 'left', indent: 1, wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: main } } };
    });
    headerRow.height = 22;

    // ---- rows (real numbers and dates, so the user can sum and filter in Excel)
    const widths = t.columns.map((c) => Math.min(40, Math.max(10, c.label.length + 2)));
    const value = (c: ExportColumn, raw: unknown): ExcelJS.CellValue => {
      const v = this.safe(raw);
      if (v === '') return null;
      if (NUMERIC.has(c.type ?? '')) {
        const num = Number(v);
        return Number.isFinite(num) ? num : (v as string);
      }
      if (c.type === 'date' || c.type === 'datetime') {
        const d = v instanceof Date ? v : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : null;
        if (d && !Number.isNaN(d.getTime())) return d;
      }
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return v as ExcelJS.CellValue;
    };
    const textLen = (c: ExportColumn, v: ExcelJS.CellValue) =>
      v === null ? 0 : v instanceof Date ? 12 : typeof v === 'number' ? (c.type === 'money' ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(v).length : String(v).length + 2) : String(v).length;

    t.rows.forEach((r, ri) => {
      const row = ws.addRow(t.columns.map((c) => value(c, r[c.key])));
      row.eachCell({ includeEmpty: true }, (cell, ci) => {
        const c = t.columns[ci - 1];
        if (!c) return;
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        cell.border = { bottom: { style: 'hair', color: { argb: line } } };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFD' } };
        cell.alignment = { vertical: 'top', horizontal: NUMERIC.has(c.type ?? '') ? 'right' : 'left', indent: 1, wrapText: !NUMERIC.has(c.type ?? '') && c.type !== 'date' };
        widths[ci - 1] = Math.min(48, Math.max(widths[ci - 1], textLen(c, cell.value) + 2));
      });
    });

    // ---- totals
    if (t.totals) {
      const tr = ws.addRow(t.columns.map((c, i) => (i === 0 ? 'Total' : t.totals![c.key] !== undefined ? value(c, t.totals![c.key]) : null)));
      tr.height = 20;
      tr.eachCell({ includeEmpty: true }, (cell, ci) => {
        const c = t.columns[ci - 1];
        if (!c) return;
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint } };
        cell.border = { top: { style: 'thin', color: { argb: main } }, bottom: { style: 'double', color: { argb: main } } };
        cell.alignment = { vertical: 'middle', horizontal: NUMERIC.has(c.type ?? '') ? 'right' : 'left', indent: 1 };
      });
    }

    // ---- formats and widths per column
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = widths[i];
      if (c.type === 'money') col.numFmt = '#,##0.00;[Red]-#,##0.00';
      else if (c.type === 'integer') col.numFmt = '#,##0';
      else if (c.type === 'number' || c.type === 'qty') col.numFmt = '#,##0.####';
      else if (c.type === 'percent') col.numFmt = '0.##"%"';
      else if (c.type === 'date') col.numFmt = 'dd mmm yyyy';
      else if (c.type === 'datetime') col.numFmt = 'dd mmm yyyy hh:mm';
    });
    if (brand?.logo && widths[0] < 9) ws.getColumn(1).width = 9;

    // header stays visible while scrolling, filter buttons on every column, header repeats on printed pages
    ws.views = [{ state: 'frozen', ySplit: 6, xSplit: 0, topLeftCell: 'A7', activeCell: 'A7', showGridLines: false }];
    if (t.rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + t.rows.length, column: n } };
    ws.pageSetup.printTitlesRow = '6:6';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  csv(t: ExportTable): Buffer {
    const esc = (v: unknown) => {
      let s = this.safe(v);
      if (s instanceof Date) s = s.toISOString().slice(0, 10);
      const str = String(s);
      return /[",\n\r;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [t.columns.map((c) => esc(c.label)).join(','), ...t.rows.map((r) => t.columns.map((c) => esc(r[c.key])).join(','))];
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf8'); // BOM for Excel
  }
}
