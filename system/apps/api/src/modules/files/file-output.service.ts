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

  async sendTable(res: Response, table: ExportTable, format: string, save = false) {
    const stamp = new Date().toISOString().slice(0, 10);
    const companyId = RequestCtx.companyId();
    let data: Buffer;
    let ext: keyof typeof MIME;
    if (format === 'csv') {
      data = this.exporter.csv(table);
      ext = 'csv';
    } else if (format === 'pdf') {
      data = await this.pdf.render(companyId, {
        title: table.title,
        meta: [{ label: 'Generated', value: new Date().toLocaleString('en-GB') }, ...(table.subtitle ? [{ label: 'Period', value: table.subtitle }] : [])],
        columns: table.columns.map((c) => ({ key: c.key, label: c.label, align: ['money', 'number', 'integer', 'percent', 'qty'].includes(c.type ?? '') ? 'right' : 'left' })),
        rows: table.rows.map((r) => Object.fromEntries(table.columns.map((c) => [c.key, this.fmt(r[c.key], c.type)]))),
        totals: table.totals ? table.columns.filter((c) => table.totals![c.key] !== undefined).map((c) => ({ label: c.label, value: this.fmt(table.totals![c.key], c.type) })) : undefined,
        landscape: table.columns.length > 6,
      });
      ext = 'pdf';
    } else if (format === 'xlsx') {
      data = await this.exporter.xlsx(table);
      ext = 'xlsx';
    } else throw new BadRequestException('Unsupported format');
    const filename = `${table.title}_${stamp}.${ext}`;
    if (save) await this.archive(data, filename, MIME[ext], 'EXPORT', undefined, 'EXPORT');
    this.send(res, data, filename, MIME[ext]);
  }

  async sendPdf(res: Response, doc: PrintableDocument, filename: string, opts: { save?: boolean; inline?: boolean; entity?: { type: string; id: string } } = {}) {
    const data = await this.pdf.render(RequestCtx.companyId(), doc);
    if (opts.save) await this.archive(data, filename, MIME.pdf, 'GENERATED', opts.entity, 'GENERATED');
    this.send(res, data, filename, MIME.pdf, opts.inline);
  }

  fmt(v: unknown, type?: string): string {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (type === 'money') return this.pdf.money(v);
    if (type === 'qty' || type === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Number(v));
    if (type === 'percent') return `${Number(v)}%`;
    if (type === 'boolean' || typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (type === 'date' && typeof v === 'string') return v.slice(0, 10);
    return String(v);
  }
}
