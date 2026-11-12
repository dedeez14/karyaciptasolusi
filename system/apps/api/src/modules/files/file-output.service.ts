import { BadRequestException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService, ExportTable } from '../../common/export/export.service';
import { RequestCtx } from '../../common/context/request-context';
import { PdfService, PrintableDocument } from '../print/pdf.service';
import { FilesService } from './files.service';

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

/** Sends generated files to the browser and (optionally) archives them in File Management. */
@Injectable()
export class FileOutputService {
  constructor(private readonly exporter: ExportService, readonly pdf: PdfService, private readonly files: FilesService) {}

  safeName(s: string) {
    return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 120);
  }

  send(res: Response, data: Buffer, filename: string, mime: string, inline = false) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', data.length);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${this.safeName(filename)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (inline) {
      // passive content only (PDF / images): let the browser's own viewer render it and allow our in-app preview frame
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.removeHeader('Cross-Origin-Resource-Policy');
    }
    res.end(data);
  }

  async archive(data: Buffer, filename: string, mime: string, source: 'GENERATED' | 'EXPORT', entity?: { type: string; id: string }, category = 'GENERATED') {
    return this.files.store({ buffer: data, originalName: this.safeName(filename), mimeType: mime, source, categoryCode: category, entityType: entity?.type, entityId: entity?.id, skipPolicy: true, tags: [source.toLowerCase()] });
  }

  /** inline = open in the browser's viewer (Print button) instead of downloading */
  async sendTable(res: Response, table: ExportTable, format: string, save = false, inline = false) {
    const stamp = new Date().toISOString().slice(0, 10);
    const companyId = RequestCtx.companyId();
    let data: Buffer;
    let ext: keyof typeof MIME;
    const brand = format === 'csv' ? null : await this.pdf.brand(companyId);
    const locale = brand?.locale || 'id-ID';
    if (format === 'csv') {
      data = this.exporter.csv(table);
      ext = 'csv';
    } else if (format === 'pdf') {
      data = await this.pdf.render(companyId, {
        title: table.title,
        meta: [
          ...(table.subtitle ? [{ label: 'Period', value: this.prettyDates(table.subtitle, locale) }] : []),
          { label: 'Printed', value: new Date().toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
          { label: 'Rows', value: String(table.rows.length) },
        ],
        columns: table.columns.map((c) => ({ key: c.key, label: c.label, align: ['money', 'number', 'integer', 'percent', 'qty'].includes(c.type ?? '') ? 'right' : 'left' })),
        rows: table.rows.map((r) => Object.fromEntries(table.columns.map((c) => [c.key, this.statusText(c.key, this.fmt(r[c.key], c.type, locale))]))),
        // totals sit under their own columns, the first column says what the row is
        footer: table.totals ? Object.fromEntries(table.columns.map((c, i) => [c.key, table.totals![c.key] !== undefined ? this.fmt(table.totals![c.key], c.type, locale) : i === 0 ? 'Total' : ''])) : undefined,
        landscape: table.columns.length > 6,
      });
      ext = 'pdf';
    } else if (format === 'xlsx') {
      data = await this.exporter.xlsx({ ...table, rows: table.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? this.statusText(k, v) : v]))), subtitle: table.subtitle ? this.prettyDates(table.subtitle, locale) : undefined }, { name: brand?.name, color: brand?.color, color2: brand?.color2, logo: brand?.logo, locale });
      ext = 'xlsx';
    } else throw new BadRequestException('Unsupported format');
    const filename = `${table.title}_${stamp}.${ext}`;
    if (save) await this.archive(data, filename, MIME[ext], 'EXPORT', undefined, 'EXPORT');
    this.send(res, data, filename, MIME[ext], inline && ext === 'pdf');
  }

  /** "2026-11-01 to 2026-11-12" -> "1 Nov 2026 to 12 Nov 2026" */
  private prettyDates(text: string, locale = 'id-ID') {
    return text.replace(/(\d{4})-(\d{2})-(\d{2})/g, (_m, y, mo, d) => this.date(new Date(Date.UTC(+y, +mo - 1, +d)), locale));
  }

  /** "PARTIALLY_PAID" -> "Partially paid" in status columns */
  private statusText(key: string, v: string) {
    return /status/i.test(key) && /^[A-Z][A-Z_]+$/.test(v) ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : v;
  }

  private date(d: Date, locale: string) {
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  async sendPdf(res: Response, doc: PrintableDocument, filename: string, opts: { save?: boolean; inline?: boolean; entity?: { type: string; id: string } } = {}) {
    const data = await this.pdf.render(RequestCtx.companyId(), doc);
    if (opts.save) await this.archive(data, filename, MIME.pdf, 'GENERATED', opts.entity, 'GENERATED');
    this.send(res, data, filename, MIME.pdf, opts.inline);
  }

  /** a value as printed in PDF tables, in the company's number and date format */
  fmt(v: unknown, type?: string, locale = 'id-ID'): string {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object' && v !== null && 'toNumber' in v) v = (v as { toNumber: () => number }).toNumber();
    if (v instanceof Date) return type === 'datetime' ? v.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : this.date(v, locale);
    if (type === 'money') return this.pdf.money(v, locale);
    if (type === 'qty' || type === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(v));
    if (type === 'integer') return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(v));
    if (type === 'percent') return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(v))}%`;
    if (type === 'boolean' || typeof v === 'boolean') return v ? 'Yes' : 'No';
    if ((type === 'date' || type === 'datetime') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return this.fmt(new Date(v.length === 10 ? `${v}T00:00:00Z` : v), type, locale);
    return String(v);
  }

}
