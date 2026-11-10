import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { StorageService } from '../files/storage.service';
import { amountInWords } from './amount-in-words';

export interface PrintColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** relative width weight (default 1) */
  width?: number;
}

/** One normalised structure for EVERY printable business document -> identical layout everywhere */
export interface PrintableDocument {
  title: string;
  number?: string;
  status?: string;
  meta: { label: string; value: string }[];
  parties?: { label: string; name: string; lines: string[] }[];
  columns: PrintColumn[];
  rows: Record<string, string>[];
  totals?: { label: string; value: string; bold?: boolean }[];
  amount?: { value: number; currency: string };
  notes?: string | null;
  terms?: string | null;
  paymentInfo?: string | null;
  signatures?: string[];
  landscape?: boolean;
}

interface Brand {
  name: string;
  lines: string[];
  logo?: Buffer;
  color: string;
  footer: string;
  paper: string;
  showSignatures: boolean;
  wordsLang: 'en' | 'id';
  locale: string;
}

const GREY = '#6b7280';
const LINE = '#e5e7eb';

@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
  ) {}

  async brand(companyId: string): Promise<Brand> {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    let logo: Buffer | undefined;
    if (c.logoFileId && (await this.settings.bool('document.showLogo', companyId, true))) {
      const f = await this.prisma.storedFile.findFirst({ where: { id: c.logoFileId, companyId, deletedAt: null } });
      if (f && ['image/png', 'image/jpeg'].includes(f.mimeType)) logo = await this.storage.get(f.storageKey, f.isEncrypted).catch(() => undefined);
    }
    const taxId = this.crypto.decrypt(c.taxId);
    return {
      name: c.legalName || c.name,
      lines: [
        [c.address, c.city].filter(Boolean).join(', '),
        [c.phone && `Phone ${c.phone}`, c.email, c.website].filter(Boolean).join('  |  '),
        taxId ? `Tax ID: ${taxId}` : '',
      ].filter(Boolean),
      logo,
      color: await this.settings.str('document.primaryColor', companyId, '#1e40af'),
      footer: await this.settings.str('document.footerText', companyId, ''),
      paper: await this.settings.str('document.paperSize', companyId, 'A4'),
      showSignatures: await this.settings.bool('document.showSignatures', companyId, true),
      wordsLang: (await this.settings.str('document.amountInWordsLanguage', companyId, 'en')) === 'id' ? 'id' : 'en',
      locale: await this.settings.str('general.locale', companyId, 'en-US'),
    };
  }

  money(v: unknown, locale = 'en-US', dp = 2) {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v ?? 0));
  }

  async render(companyId: string, d: PrintableDocument): Promise<Buffer> {
    const b = await this.brand(companyId);
    const doc = new PDFDocument({
      size: b.paper,
      layout: d.landscape ? 'landscape' : 'portrait',
      margins: { top: 40, bottom: 50, left: 40, right: 40 },
      bufferPages: true,
      info: { Title: `${d.title}${d.number ? ' ' + d.number : ''}`, Author: b.name, Creator: 'KCS ERP' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;

    // ---------- Letterhead
    let y = 40;
    let textX = L;
    if (b.logo) {
      try {
        doc.image(b.logo, L, y, { fit: [70, 50] });
        textX = L + 80;
      } catch {
        /* unsupported image -> skip */
      }
    }
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text(b.name, textX, y, { width: W * 0.6 - (textX - L) });
    doc.font('Helvetica').fontSize(8).fillColor(GREY);
    for (const line of b.lines) doc.text(line, textX, doc.y + 1, { width: W * 0.6 - (textX - L) });
    const leftBottom = Math.max(doc.y, y + 50);

    doc.font('Helvetica-Bold').fontSize(20).fillColor(b.color).text(d.title.toUpperCase(), L + W * 0.55, y, { width: W * 0.45, align: 'right' });
    if (d.number) doc.font('Helvetica').fontSize(10).fillColor('#111827').text(d.number, L + W * 0.55, doc.y + 2, { width: W * 0.45, align: 'right' });
    if (d.status) doc.font('Helvetica-Bold').fontSize(8).fillColor(GREY).text(d.status.toUpperCase(), L + W * 0.55, doc.y + 2, { width: W * 0.45, align: 'right' });
    y = Math.max(leftBottom, doc.y) + 10;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(2).strokeColor(b.color).stroke();
    y += 12;

    // ---------- Parties + meta
    const parties = d.parties ?? [];
    const colW = W / Math.max(1, parties.length + 1);
    let blockBottom = y;
    parties.forEach((p, i) => {
      const x = L + i * colW;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GREY).text(p.label.toUpperCase(), x, y, { width: colW - 10 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(p.name, x, doc.y + 2, { width: colW - 10 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
      for (const line of p.lines.filter(Boolean)) doc.text(line, x, doc.y + 1, { width: colW - 10 });
      blockBottom = Math.max(blockBottom, doc.y);
    });
    const mx = L + parties.length * colW;
    let my = y;
    for (const m of d.meta.filter((m) => m.value)) {
      doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(m.label, mx, my, { width: colW * 0.45 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(m.value, mx + colW * 0.45, my, { width: colW * 0.55, align: 'right' });
      my = Math.max(doc.y, my + 11) + 2;
    }
    y = Math.max(blockBottom, my) + 14;

    // ---------- Table
    y = this.table(doc, d.columns, d.rows, y, L, W, b.color);

    // ---------- Totals
    if (d.totals?.length) {
      const tx = L + W * 0.55;
      const tw = W * 0.45;
      y += 6;
      for (const t of d.totals) {
        y = this.ensure(doc, y, 18);
        if (t.bold) {
          doc.rect(tx, y - 3, tw, 18).fill(b.color);
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
        } else doc.font('Helvetica').fontSize(9).fillColor('#111827');
        doc.text(t.label, tx + 6, y, { width: tw * 0.5 });
        doc.text(t.value, tx + tw * 0.4, y, { width: tw * 0.6 - 6, align: 'right' });
        y += t.bold ? 20 : 15;
      }
    }
    if (d.amount) {
      y = this.ensure(doc, y + 4, 24);
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#374151').text(`${b.wordsLang === 'id' ? 'Terbilang' : 'Amount in words'}: ${amountInWords(d.amount.value, d.amount.currency, b.wordsLang)}`, L, y, { width: W });
      y = doc.y + 6;
    }

    // ---------- Notes / terms / payment info
    for (const [label, text] of [
      ['Payment Information', d.paymentInfo],
      ['Notes', d.notes],
      ['Terms & Conditions', d.terms],
    ] as const) {
      if (!text) continue;
      y = this.ensure(doc, y + 6, 40);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREY).text(label.toUpperCase(), L, y, { width: W });
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151').text(text, L, doc.y + 2, { width: W });
      y = doc.y + 4;
    }

    // ---------- Signatures
    if (b.showSignatures && d.signatures?.length) {
      y = this.ensure(doc, y + 20, 80);
      // fixed-width signature boxes, right aligned -> identical look for 1, 2 or 3 signatures
      const sw = Math.min(W / d.signatures.length, W / 3);
      const startX = L + W - sw * d.signatures.length;
      d.signatures.forEach((s, i) => {
        const x = startX + i * sw;
        doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(s, x, y, { width: sw - 20, align: 'center' });
        doc.moveTo(x + 15, y + 60).lineTo(x + sw - 35, y + 60).lineWidth(0.5).strokeColor('#9ca3af').stroke();
      });
    }

    // ---------- Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 35;
      doc.moveTo(L, fy - 5).lineTo(L + W, fy - 5).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(GREY);
      doc.text(b.footer || b.name, L, fy, { width: W * 0.7, lineBreak: false, height: 10 });
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W * 0.7, fy, { width: W * 0.3, align: 'right', lineBreak: false, height: 10 });
    }
    doc.end();
    return done;
  }

  private ensure(doc: PDFKit.PDFDocument, y: number, needed: number): number {
    if (y + needed > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      return doc.page.margins.top;
    }
    return y;
  }

  private table(doc: PDFKit.PDFDocument, cols: PrintColumn[], rows: Record<string, string>[], y: number, L: number, W: number, color: string): number {
    const weights = cols.map((c) => c.width ?? 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const pad = 4;
    const header = (yy: number) => {
      doc.rect(L, yy, W, 18).fill(color);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      cols.forEach((c, i) => {
        doc.text(c.label, x + pad, yy + 5, { width: widths[i] - pad * 2, align: c.align ?? 'left', lineBreak: false, height: 10 });
        x += widths[i];
      });
      return yy + 18;
    };
    y = header(y);
    doc.font('Helvetica').fontSize(8.5);
    rows.forEach((r, idx) => {
      const h = Math.max(...cols.map((c, i) => doc.heightOfString(r[c.key] ?? '', { width: widths[i] - pad * 2 }))) + pad * 2;
      if (y + h > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = header(doc.page.margins.top);
        doc.font('Helvetica').fontSize(8.5);
      }
      if (idx % 2 === 1) doc.rect(L, y, W, h).fill('#f9fafb');
      let x = L;
      doc.fillColor('#111827');
      cols.forEach((c, i) => {
        doc.text(r[c.key] ?? '', x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align ?? 'left' });
        x += widths[i];
      });
      y += h;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });
    if (!rows.length) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text('No data', L, y + 6, { width: W, align: 'center' });
      y += 22;
    }
    return y;
  }
}
