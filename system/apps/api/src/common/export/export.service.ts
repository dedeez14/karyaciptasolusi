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

  async xlsx(t: ExportTable, company?: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = company ?? 'KCS ERP';
    wb.created = new Date();
    const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
    ws.addRow([company ?? '']).font = { bold: true, size: 12 };
    ws.addRow([t.title]).font = { bold: true, size: 14 };
    if (t.subtitle) ws.addRow([t.subtitle]).font = { italic: true, color: { argb: 'FF666666' } };
    ws.addRow([]);
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      cell.alignment = { vertical: 'middle' };
    });
    for (const r of t.rows) {
      ws.addRow(
        t.columns.map((c) => {
          const v = this.safe(r[c.key]);
          return NUMERIC.has(c.type ?? '') && v !== '' ? Number(v) : v;
        }),
      );
    }
    if (t.totals) {
      const tr = ws.addRow(t.columns.map((c, i) => (i === 0 ? 'Total' : t.totals![c.key] !== undefined ? Number(t.totals![c.key]) : '')));
      tr.font = { bold: true };
    }
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(45, Math.max(12, c.label.length + 4));
      if (c.type === 'money') col.numFmt = '#,##0.00';
      if (c.type === 'date') col.numFmt = 'yyyy-mm-dd';
    });
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
