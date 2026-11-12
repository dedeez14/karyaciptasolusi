import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { StorageService } from '../files/storage.service';
import { amountInWords } from './amount-in-words';
import QRCode from 'qrcode';
import { createHash } from 'node:crypto';
import { SignedFacts, SigningService, tokenHash } from '../security/signing.service';

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
  /** totals row printed at the bottom of the table, keyed like the rows (lists and reports) */
  footer?: Record<string, string>;
  amount?: { value: number; currency: string };
  notes?: string | null;
  terms?: string | null;
  paymentInfo?: string | null;
  signatures?: string[];
  landscape?: boolean;
  /** facts to digitally sign; adds a verification QR code */
  verify?: SignedFacts;
}

interface Brand {
  name: string;
  lines: string[];
  logo?: Buffer;
  color: string;
  /** small accents (top bar) */
  color2: string;
  footer: string;
  paper: string;
  showSignatures: boolean;
  wordsLang: 'en' | 'id';
  locale: string;
  /** the configured signer (Settings > Documents) with the signature saved on their profile, if they allow it */
  signer?: { name: string; title: string; image: Buffer };
}

/** content of an official company letter (see renderLetter) */
export interface LetterContent {
  id: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  subject: string;
  recipient: string | null;
  /** PERSON (default) or PLAIN */
  layout?: string;
  /** LETTER_TYPE code, picks the opening sentence */
  type?: string;
  personName: string | null;
  personIdNumber: string | null;
  personAddress: string | null;
  personPosition: string | null;
  body: string;
  place: string;
  signerName: string;
  signerTitle: string;
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
    private readonly signing: SigningService,
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
      // address / phone + e-mail / website + tax number: short lines that do not break in the middle
      lines: [
        [c.address, c.city].filter(Boolean).join(', '),
        [c.phone && `Phone ${c.phone}`, c.email].filter(Boolean).join('  ·  '),
        [c.website?.replace(/^https?:\/\//, '').replace(/\/$/, ''), taxId ? `${c.countryCode === 'ID' ? 'NPWP' : 'Tax ID'} ${taxId}` : ''].filter(Boolean).join('  ·  '),
      ].filter(Boolean),
      logo,
      color: await this.settings.str('document.primaryColor', companyId, '#1e40af'),
      color2: (await this.settings.str('document.secondaryColor', companyId, '')) || '',
      footer: await this.settings.str('document.footerText', companyId, ''),
      paper: await this.settings.str('document.paperSize', companyId, 'A4'),
      showSignatures: await this.settings.bool('document.showSignatures', companyId, true),
      wordsLang: (await this.settings.str('document.amountInWordsLanguage', companyId, 'en')) === 'id' ? 'id' : 'en',
      locale: await this.settings.str('general.locale', companyId, 'en-US'),
      signer: await this.signer(companyId),
    };
  }

  /** Signature of the user named in document.signerUsername - only while that user keeps it enabled */
  private async signer(companyId: string): Promise<Brand['signer']> {
    const username = (await this.settings.str('document.signerUsername', companyId, ''))?.trim();
    if (!username) return undefined;
    const u = await this.prisma.user.findFirst({ where: { username, deletedAt: null, isActive: true }, select: { fullName: true, signatureKey: true, signatureEnabled: true } });
    if (!u?.signatureKey || !u.signatureEnabled) return undefined;
    const image = await this.storage.get(u.signatureKey, true).catch(() => null);
    if (!image) return undefined;
    return {
      name: (await this.settings.str('document.signerName', companyId, '')) || u.fullName,
      title: (await this.settings.str('document.signerTitle', companyId, '')) || '',
      image,
    };
  }

  money(v: unknown, locale = 'en-US', dp = 2) {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v ?? 0));
  }

  async render(companyId: string, d: PrintableDocument): Promise<Buffer> {
    const b = await this.brand(companyId);
    const party = d.verify?.p ?? d.parties?.[0]?.name;
    const token = d.verify ? await this.signing.sign(companyId, { ...d.verify, ...(party ? { p: party.slice(0, 150) } : {}) }) : null;
    // the QR carries a short code only (small QR that phones scan easily); the server keeps the full signed token
    const code = token ? tokenHash(token).slice(0, 20) : null;
    const publicUrl = (await this.settings.str('general.publicUrl', companyId, 'http://localhost:3000')).replace(/\/$/, '');
    const verifyUrl = code ? `${publicUrl}/verify?c=${code}` : null;
    const doc = new PDFDocument({
      size: b.paper,
      layout: d.landscape ? 'landscape' : 'portrait',
      margins: { top: 44, bottom: 56, left: 42, right: 42 },
      bufferPages: true,
      info: { Title: `${d.title}${d.number ? ' ' + d.number : ''}`, Author: b.name, Creator: 'KCS ERP', ...(token ? { Subject: 'Digitally signed (Ed25519)', Keywords: `kcs-signature:${token}` } : {}) },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const accent = b.color;
    const tint = mix(accent, '#ffffff', 0.92);
    const soft = mix(accent, '#ffffff', 0.8);
    const ink = '#0f172a';
    const body = '#334155';

    // ---------- Letterhead: logo (or monogram) + company | document title, number, status
    let y = doc.page.margins.top;
    let textX = L;
    let logoDrawn = false;
    if (b.logo) {
      try {
        doc.image(b.logo, L, y - 2, { fit: [48, 48], align: 'center', valign: 'center' });
        textX = L + 60;
        logoDrawn = true;
      } catch {
        /* unsupported image -> monogram */
      }
    }
    if (!logoDrawn) {
      const initials = b.name.replace(/^(PT|CV|UD|TBK)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'K';
      doc.roundedRect(L, y, 40, 40, 8).fill(accent);
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text(initials, L, y + 12.5, { width: 40, align: 'center', lineBreak: false });
      textX = L + 52;
    }
    const leftW = W * 0.62 - (textX - L);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(ink).text(b.name, textX, y + 1, { width: leftW });
    doc.font('Helvetica').fontSize(7.8).fillColor(GREY);
    for (const line of b.lines) {
      // a line that does not fit breaks at its last ", " (e.g. the city goes to its own line) instead of mid-phrase
      const cut = line.lastIndexOf(', ');
      const parts = doc.widthOfString(line) > leftW && cut > 0 ? [line.slice(0, cut), line.slice(cut + 2)] : [line];
      for (const part of parts) doc.text(part, textX, doc.y + 1.5, { width: leftW });
    }
    const leftBottom = Math.max(doc.y, y + 44);

    const rx = L + W * 0.62;
    const rw = W * 0.38;
    doc.font('Helvetica-Bold').fontSize(18).fillColor(accent).text(d.title.toUpperCase(), rx, y, { width: rw, align: 'right', characterSpacing: 0.6 });
    if (d.number) doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(d.number, rx, doc.y + 3, { width: rw, align: 'right' });
    let rightBottom = doc.y;
    const stamp = statusStyle(d.status);
    if (d.status && stamp) {
      doc.font('Helvetica-Bold').fontSize(7.5);
      const label = d.status.toUpperCase();
      const pw = doc.widthOfString(label, { characterSpacing: 0.8 }) + 16;
      const py = rightBottom + 6;
      doc.roundedRect(L + W - pw, py, pw, 15, 7.5).fill(stamp.bg);
      doc.fillColor(stamp.fg).text(label, L + W - pw, py + 4, { width: pw, align: 'center', characterSpacing: 0.8, lineBreak: false });
      rightBottom = py + 15;
    }
    y = Math.max(leftBottom, rightBottom) + 14;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 16;

    // ---------- Parties (cards) + document details (panel)
    const parties = d.parties ?? [];
    const meta = d.meta.filter((m) => m.value);
    if (parties.length) {
      const gap = 14;
      const metaW = Math.min(W * 0.38, 230);
      const partyW = (W - metaW - gap * parties.length) / parties.length;
      let blockBottom = y;
      parties.forEach((p, i) => {
        const x = L + i * (partyW + gap);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(accent).text(p.label.toUpperCase(), x, y, { width: partyW, characterSpacing: 0.7 });
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ink).text(p.name, x, doc.y + 4, { width: partyW });
        doc.font('Helvetica').fontSize(8.3).fillColor(body);
        for (const line of p.lines.filter(Boolean)) {
          // "phone | e-mail" lines that do not fit: one item per line instead of a break in the middle
          const parts = doc.widthOfString(line) > partyW && /\s\|\s/.test(line) ? line.split(/\s+\|\s+/) : [line];
          for (const part of parts) doc.text(part, x, doc.y + 1.5, { width: partyW });
        }
        blockBottom = Math.max(blockBottom, doc.y);
      });
      const mx = L + W - metaW;
      const metaBottom = this.metaPanel(doc, meta, mx, y - 6, metaW, tint, ink);
      y = Math.max(blockBottom, metaBottom) + 18;
    } else if (meta.length) {
      // reports / lists: one compact line of details
      doc.font('Helvetica').fontSize(8.3);
      let x = L;
      for (const m of meta) {
        const lw = doc.font('Helvetica').widthOfString(`${m.label}  `);
        const vw = doc.font('Helvetica-Bold').widthOfString(m.value);
        if (x + lw + vw > L + W) {
          x = L;
          y += 13;
        }
        doc.font('Helvetica').fillColor(GREY).text(`${m.label}  `, x, y, { lineBreak: false });
        doc.font('Helvetica-Bold').fillColor(ink).text(m.value, x + lw, y, { lineBreak: false });
        x += lw + vw + 22;
      }
      y += 24;
    }

    // ---------- Watermark for drafts and cancelled documents (every page, under the content)
    const watermark = d.status && /^(draft|cancelled)$/i.test(d.status) ? { text: d.status.toUpperCase(), color: /cancel/i.test(d.status) ? '#dc2626' : '#64748b' } : null;
    const drawWatermark = () => {
      if (!watermark) return;
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(96).fillColor(watermark.color).fillOpacity(0.07).text(watermark.text, 0, doc.page.height / 2 - 48, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    };
    drawWatermark();
    doc.on('pageAdded', drawWatermark);

    // ---------- Line items
    y = this.table(doc, d.columns, d.rows, y, L, W, { accent, tint, soft, ink, body, footer: d.footer });

    // ---------- Amount in words (left) + totals (right)
    const words = d.amount ? amountInWords(d.amount.value, d.amount.currency, b.wordsLang) : null;
    if (d.totals?.length || words) {
      const tw = Math.min(W * 0.42, 250);
      const tx = L + W - tw;
      const rows = d.totals ?? [];
      const totalsH = rows.reduce((h, t) => h + (t.bold ? 26 : 16), 0) + 8;
      doc.font('Helvetica-Oblique').fontSize(8.3);
      const wordsH = words ? doc.heightOfString(words, { width: W - tw - 34 }) + 30 : 0;
      y = this.ensure(doc, y + 10, Math.max(totalsH, wordsH));
      const top = y;
      if (words) {
        const ww = rows.length ? W - tw - 18 : W;
        doc.roundedRect(L, top, ww, wordsH - 4, 6).fill(tint);
        doc.font('Helvetica-Bold').fontSize(6.8).fillColor(accent).text((b.wordsLang === 'id' ? 'Terbilang' : 'Amount in words').toUpperCase(), L + 10, top + 8, { width: ww - 20, characterSpacing: 0.7 });
        doc.font('Helvetica-Oblique').fontSize(8.3).fillColor(ink).text(words, L + 10, doc.y + 3, { width: ww - 20 });
      }
      let ty = top;
      for (const t of rows) {
        if (t.bold) {
          ty += 4;
          doc.roundedRect(tx, ty, tw, 22, 5).fill(accent);
          doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#ffffff');
          doc.text(t.label, tx + 10, ty + 6.5, { width: tw * 0.45, lineBreak: false });
          doc.text(t.value, tx + tw * 0.35, ty + 6.5, { width: tw * 0.65 - 10, align: 'right', lineBreak: false });
          ty += 22;
        } else {
          doc.font('Helvetica').fontSize(8.6).fillColor(GREY).text(t.label, tx + 10, ty + 3, { width: tw * 0.5, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(8.6).fillColor(ink).text(t.value, tx + tw * 0.35, ty + 3, { width: tw * 0.65 - 10, align: 'right', lineBreak: false });
          ty += 16;
          doc.moveTo(tx + 10, ty).lineTo(tx + tw - 10, ty).lineWidth(0.4).strokeColor(LINE).stroke();
        }
      }
      y = Math.max(ty, top + wordsH) + 6;
    }

    // ---------- Payment information / notes / terms
    for (const [label, text] of [
      ['Payment Information', d.paymentInfo],
      ['Notes', d.notes],
      ['Terms & Conditions', d.terms],
    ] as const) {
      if (!text) continue;
      doc.font('Helvetica').fontSize(8.3);
      const h = doc.heightOfString(text, { width: W - 14 }) + 18;
      y = this.ensure(doc, y + 10, Math.min(h, 120));
      const start = y;
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(accent).text(label.toUpperCase(), L + 12, y, { width: W - 14, characterSpacing: 0.7 });
      doc.font('Helvetica').fontSize(8.3).fillColor(body).text(text, L + 12, doc.y + 3, { width: W - 14 });
      y = doc.y;
      doc.rect(L, start - 1, 2.2, Math.max(12, y - start + 1)).fill(soft);
    }

    // ---------- Signatures (fixed-width boxes, right aligned)
    if (b.showSignatures && d.signatures?.length) {
      y = this.ensure(doc, y + 24, 92);
      const sw = Math.min(W / d.signatures.length, W / 3.2);
      const startX = L + W - sw * d.signatures.length;
      d.signatures.forEach((s, i) => {
        const x = startX + i * sw + 8;
        const w = sw - 16;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(GREY).text(s.toUpperCase(), x, y, { width: w, align: 'center', characterSpacing: 0.6 });
        const signHere = !!b.signer && /authori|approv/i.test(s) && !/draft|cancel/i.test(d.status ?? '');
        if (signHere) {
          try {
            doc.image(b.signer!.image, x + 6, y + 12, { fit: [w - 12, 48], align: 'center', valign: 'bottom' });
          } catch {
            /* unreadable image: leave the box empty */
          }
        }
        doc.moveTo(x + 6, y + 62).lineTo(x + w - 6, y + 62).lineWidth(0.6).strokeColor('#94a3b8').stroke();
        if (signHere) {
          doc.font('Helvetica-Bold').fontSize(7.4).fillColor('#0f172a').text(b.signer!.name, x, y + 65, { width: w, align: 'center' });
          if (b.signer!.title) doc.font('Helvetica').fontSize(6.8).fillColor('#64748b').text(b.signer!.title, x, doc.y + 0.5, { width: w, align: 'center' });
        } else doc.font('Helvetica').fontSize(6.8).fillColor('#94a3b8').text('Name & date', x, y + 66, { width: w, align: 'center' });
      });
      y += 82;
    }

    // ---------- Digital signature: QR + how to verify (only once the system has a public address)
    if (verifyUrl && !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(publicUrl.replace(/^https?:\/\//, ''))) {
      const qr = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 180, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
      const QR = 42;
      const boxH = QR + 12;
      y = this.ensure(doc, y + 10, boxH);
      doc.roundedRect(L, y, W, boxH, 6).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.image(qr, L + 6, y + 6, { width: QR, height: QR });
      const host = publicUrl.replace(/^https?:\/\//, '');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ink).text('Digitally signed document', L + QR + 18, y + 11, { width: W - QR - 30 });
      doc.font('Helvetica').fontSize(7.6).fillColor(GREY).text(`Issued by ${b.name}.${/^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(host) ? '' : ` Scan the code (or open ${host}/verify) to check that this document is authentic and has not been changed.`}`, L + QR + 18, doc.y + 3, { width: W - QR - 30 });
      y += boxH;
    }

    // ---------- Accent bar + footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 0, doc.page.width, 4).fill(accent);
      if (b.color2) doc.rect(doc.page.width * 0.78, 0, doc.page.width * 0.22, 4).fill(b.color2);
      const fy = doc.page.height - 38;
      doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(GREY);
      doc.text(b.footer || b.name, L, fy, { width: W * 0.6, lineBreak: false, height: 10, ellipsis: true });
      doc.text(`${d.number ? `${d.title} ${d.number}  ·  ` : ''}Page ${i - range.start + 1} of ${range.count}`, L + W * 0.6, fy, { width: W * 0.4, align: 'right', lineBreak: false, height: 10 });
    }
    doc.end();
    const pdf = await done;
    if (token && d.verify) {
      // fingerprint of the exact bytes issued: the verify page uses it to detect edited copies
      await this.prisma.signedFile.create({
        data: { companyId, tokenHash: tokenHash(token), code, token, sha256: createHash('sha256').update(pdf).digest('hex'), size: pdf.length, docKind: d.verify.k, docNumber: d.verify.n?.slice(0, 60) ?? null },
      });
    }
    return pdf;
  }

  /** document details: label / value rows on a tinted panel; returns the bottom */
  private metaPanel(doc: PDFKit.PDFDocument, meta: { label: string; value: string }[], x: number, y: number, w: number, tint: string, ink: string): number {
    if (!meta.length) return y;
    const pad = 10;
    // the label column is as wide as the longest label, the values get the rest
    doc.font('Helvetica').fontSize(8.3);
    const labelW = Math.min(w * 0.5, Math.max(...meta.map((m) => doc.widthOfString(m.label))) + 12);
    const valueW = w - labelW - pad * 2;
    const rows = meta.map((m) => {
      doc.font('Helvetica-Bold').fontSize(8.3);
      return { ...m, h: Math.max(10, doc.heightOfString(m.value, { width: valueW })) };
    });
    const gap = 5;
    const h = rows.reduce((a, r) => a + r.h + gap, 0) - gap + pad * 2 - 2;
    doc.roundedRect(x, y, w, h, 6).fill(tint);
    let ry = y + pad;
    for (const r of rows) {
      doc.font('Helvetica').fontSize(8.3).fillColor(GREY).text(r.label, x + pad, ry, { width: labelW, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.3).fillColor(ink).text(r.value, x + pad + labelW, ry, { width: valueW, align: 'right' });
      ry += r.h + gap;
    }
    return y + h;
  }

  private ensure(doc: PDFKit.PDFDocument, y: number, needed: number): number {
    if (y + needed > doc.page.height - doc.page.margins.bottom - 2) {
      doc.addPage();
      return doc.page.margins.top + 6;
    }
    return y;
  }

  /**
   * Column widths follow the content: short columns (numbers, dates, codes) get what they need and never wrap,
   * the rest of the width goes to the text columns by their weight.
   */
  private widths(doc: PDFKit.PDFDocument, cols: PrintColumn[], rows: Record<string, string>[], W: number, pad: number): number[] {
    doc.font('Helvetica').fontSize(8.5);
    const natural = cols.map((c) => {
      doc.font('Helvetica-Bold').fontSize(7.3);
      const head = doc.widthOfString(c.label.toUpperCase(), { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5);
      const cell = rows.reduce((m, r) => Math.max(m, ...(r[c.key] ?? '').split('\n').map((l) => doc.widthOfString(l))), 0);
      return Math.ceil(Math.max(head, cell)) + pad * 2 + 1;
    });
    // text columns may wrap: everything that is not right / center aligned and has room to share
    const flexible = cols.map((c, i) => (c.align ?? 'left') === 'left' && natural[i] > 90);
    const fixed = natural.reduce((a, n, i) => a + (flexible[i] ? 0 : n), 0);
    const weights = cols.map((c, i) => (flexible[i] ? (c.width ?? 1) : 0));
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (!wsum || fixed > W) {
      // nothing to share, or too many fixed columns: fall back to the weights
      const all = cols.map((c) => c.width ?? 1);
      const s = all.reduce((a, b) => a + b, 0);
      const natTotal = natural.reduce((a, b) => a + b, 0);
      return natTotal <= W ? natural.map((n) => n + (W - natTotal) * (n / natTotal)) : all.map((w) => (w / s) * W);
    }
    const share = W - fixed;
    return cols.map((c, i) => (flexible[i] ? Math.max(60, (weights[i] / wsum) * share) : natural[i]));
  }

  private table(
    doc: PDFKit.PDFDocument,
    cols: PrintColumn[],
    rows: Record<string, string>[],
    y: number,
    L: number,
    W: number,
    s: { accent: string; tint: string; soft: string; ink: string; body: string; footer?: Record<string, string> },
  ): number {
    const pad = 6;
    let widths = this.widths(doc, cols, s.footer ? [...rows, s.footer] : rows, W, pad);
    const sum = widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => (w * W) / sum); // exact fit
    const HEAD = 20;
    const header = (yy: number) => {
      doc.roundedRect(L, yy, W, HEAD, 4).fill(s.tint);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(7.3).fillColor(s.accent);
      cols.forEach((c, i) => {
        doc.text(c.label.toUpperCase(), x + pad, yy + 7, { width: widths[i] - pad * 2, align: c.align ?? 'left', lineBreak: false, height: 10, characterSpacing: 0.5 });
        x += widths[i];
      });
      return yy + HEAD + 2;
    };
    y = this.ensure(doc, y, HEAD + 24);
    y = header(y);
    const drawRow = (r: Record<string, string>, bold: boolean) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const h = Math.max(20, Math.max(...cols.map((c, i) => doc.heightOfString(r[c.key] || ' ', { width: widths[i] - pad * 2 }))) + pad * 2);
      if (y + h > doc.page.height - doc.page.margins.bottom - 10) {
        doc.addPage();
        y = header(doc.page.margins.top + 6);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      }
      if (bold) {
        doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1).strokeColor(s.accent).stroke();
        doc.rect(L, y, W, h).fill(s.tint);
        doc.font('Helvetica-Bold').fontSize(8.5);
      }
      let x = L;
      cols.forEach((c, i) => {
        doc.fillColor(i === 0 || bold ? s.ink : s.body).text(r[c.key] ?? '', x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align ?? 'left' });
        x += widths[i];
      });
      y += h;
      if (!bold) doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.5).strokeColor('#eef0f4').stroke();
    };
    rows.forEach((r) => drawRow(r, false));
    if (!rows.length) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text('No data', L, y + 8, { width: W, align: 'center' });
      y += 26;
    }
    if (s.footer && rows.length) drawRow(s.footer, true);
    return y;
  }

  /**
   * Official letter on the company letterhead (Indonesian layout): number / attachment / subject, addressee,
   * signer and person details, the text, and an electronic signature by the system - a QR code that opens the
   * public verification page - instead of a hand-drawn signature.
   */
  async renderLetter(companyId: string, l: LetterContent): Promise<Buffer> {
    const b = await this.brand(companyId);
    const token = await this.signing.sign(companyId, { k: 'LETTER', id: l.id, n: l.number, d: l.date, a: null, cur: null, ...(l.personName ? { p: l.personName.slice(0, 150) } : {}) });
    const code = tokenHash(token).slice(0, 20);
    const publicUrl = (await this.settings.str('general.publicUrl', companyId, 'http://localhost:3000')).replace(/\/$/, '');
    const verifyUrl = `${publicUrl}/verify?c=${code}`;
    const host = publicUrl.replace(/^https?:\/\//, '');
    // a local address means nobody outside this computer can open the check page: do not print it
    const publicHost = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(host) ? null : host;
    const doc = new PDFDocument({
      size: b.paper,
      margins: { top: 40, bottom: 50, left: 64, right: 60 },
      bufferPages: true,
      info: { Title: `${l.subject} ${l.number}`, Author: b.name, Creator: 'KCS ERP', Subject: 'Digitally signed (Ed25519)', Keywords: `kcs-signature:${token}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const ink = '#111827';
    const accent = b.color;
    const size = 10.5;
    const gap = 4;

    // ---------- letterhead
    let y = doc.page.margins.top;
    let textX = L;
    if (b.logo) {
      try {
        doc.image(b.logo, L, y, { fit: [56, 56], align: 'center', valign: 'center' });
        textX = L + 68;
      } catch {
        /* no logo */
      }
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(accent).text(b.name.toUpperCase(), textX, y + 2, { width: W - (textX - L) });
    doc.font('Helvetica').fontSize(8).fillColor(GREY);
    for (const line of b.lines) doc.text(line, textX, doc.y + 1.5, { width: W - (textX - L) });
    y = Math.max(doc.y, y + 56) + 8;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(2.2).strokeColor(accent).stroke();
    if (b.color2) doc.moveTo(L, y + 3).lineTo(L + W, y + 3).lineWidth(0.8).strokeColor(b.color2).stroke();
    y += 18;

    // ---------- number / attachment / subject
    const kv = (rows: [string, string, boolean?][], x: number, labelW: number, top: number) => {
      let yy = top;
      for (const [k, v, bold] of rows) {
        doc.font('Helvetica').fontSize(size).fillColor(ink).text(k, x, yy, { width: labelW });
        doc.text(':', x + labelW, yy, { width: 8 });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(v || '-', x + labelW + 10, yy, { width: W - (x - L) - labelW - 10 });
        yy = Math.max(doc.y, yy + size + 2) + 2;
      }
      return yy;
    };
    y = kv([['Nomor', l.number], ['Lampiran', '-'], ['Perihal', l.subject, true]], L, 62, y) + 10;

    // ---------- addressee
    if (l.recipient?.trim()) {
      doc.font('Helvetica').fontSize(size).fillColor(ink).text('Kepada Yth.', L, y);
      const lines = l.recipient.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      lines.forEach((line, i) => doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').text(line, L, doc.y + 1, { width: W }));
      y = doc.y + 12;
    }
    if (l.layout !== 'PLAIN') {
      doc.font('Helvetica').fontSize(size).text('Dengan hormat,', L, y);
      y = doc.y + 8;
      doc.text('Yang bertanda tangan di bawah ini:', L, y);
      y = kv([['Nama', l.signerName, true], ['Jabatan', l.signerTitle], ['Perusahaan', b.name]], L + 8, 110, doc.y + gap) + 6;
      if (l.personName) {
        const INTRO: Record<string, string> = {
          RECOMMENDATION: 'dengan ini menerangkan dan memberikan rekomendasi kepada:',
          ASSIGNMENT: 'dengan ini memberikan tugas kepada:',
          POWER_OF_ATTORNEY: 'dengan ini memberikan kuasa kepada:',
          APPOINTMENT: 'dengan ini menetapkan, atas nama:',
          WARNING: 'dengan ini memberikan Surat Peringatan kepada:',
        };
        doc.font('Helvetica').fontSize(size).text(INTRO[l.type ?? ''] ?? 'dengan ini menerangkan bahwa:', L, y);
        const person: [string, string, boolean?][] = [['Nama', l.personName, true]];
        if (l.personIdNumber) person.push(['NIK', l.personIdNumber]);
        if (l.personAddress) person.push(['Alamat', l.personAddress.replace(/\s*\r?\n\s*/g, ', ')]);
        if (l.personPosition) person.push(['Jabatan', l.personPosition]);
        y = kv(person, L + 8, 110, doc.y + gap) + 8;
      }
    }

    // ---------- text: "# " starts a heading (e.g. Pasal 1), lines starting with "- " or "1." form a list
    for (const block of l.body.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      y = this.ensure(doc, y, 40);
      const lines = block.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (lines[0].startsWith('# ')) {
        doc.font('Helvetica-Bold').fontSize(size).fillColor(ink).text(lines[0].slice(2), L, y, { width: W, align: lines[0].length < 40 ? 'center' : 'left' });
        y = doc.y + 4;
        lines.shift();
        if (!lines.length) continue;
      }
      if (lines.every((x) => /^(-|\d+[.)]|[a-z][.)])\s+/.test(x))) {
        for (const item of lines) {
          const m = /^(-|\d+[.)]|[a-z][.)])\s+(.*)$/.exec(item)!;
          const bullet = m[1] === '-' ? '•' : m[1];
          doc.font('Helvetica').fontSize(size).fillColor(ink).text(bullet, L + 6, y, { width: 18 });
          doc.text(m[2], L + 24, y, { width: W - 24, align: 'justify', lineGap: 1.5 });
          y = doc.y + 3;
        }
        y += 4;
        continue;
      }
      doc.font('Helvetica').fontSize(size).fillColor(ink).text(lines.join(' '), L, y, { width: W, align: 'justify', lineGap: 1.5 });
      y = doc.y + 7;
    }

    // ---------- signature: place & date, company, electronic signature (QR) and the signer
    const blockH = 150;
    if (y + blockH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const sx = L + W * 0.52;
    const sw = W * 0.48;
    const dateText = new Date(`${l.date}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    doc.font('Helvetica').fontSize(size).fillColor(ink).text(`${l.place}, ${dateText}`, sx, y + 4, { width: sw });
    doc.text('Hormat kami,', sx, doc.y + 1, { width: sw });
    doc.font('Helvetica-Bold').text(b.name, sx, doc.y + 1, { width: sw });
    const qy = doc.y + 6;
    const qr = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
    // the signer's own signature (My Profile) when they are the configured document signer
    const sig = b.signer && b.signer.name.trim().toLowerCase() === l.signerName.trim().toLowerCase() ? b.signer.image : null;
    let ny: number;
    if (!publicHost) {
      // no public address yet: nobody could open the QR, so it is left out (the file itself stays signed)
      if (sig) {
        try {
          doc.image(sig, sx, qy, { fit: [Math.min(sw, 190), 64], valign: 'bottom' });
        } catch {
          /* unreadable image */
        }
      }
      ny = qy + 70;
    } else if (sig) {
      const QR = 50;
      try {
        doc.image(sig, sx, qy, { fit: [sw - QR - 16, 62], valign: 'bottom' });
      } catch {
        /* unreadable image */
      }
      doc.image(qr, sx + sw - QR, qy + 6, { width: QR, height: QR });
      doc.font('Helvetica').fontSize(5.6).fillColor(GREY).text('Tanda tangan elektronik', sx + sw - QR - 8, qy + QR + 8, { width: QR + 16, align: 'center' });
      ny = qy + 66;
    } else {
      const QR = 64;
      doc.image(qr, sx, qy, { width: QR, height: QR });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accent).text('DITANDATANGANI SECARA ELEKTRONIK', sx + QR + 8, qy + 4, { width: sw - QR - 8, characterSpacing: 0.3 });
      doc.font('Helvetica').fontSize(7).fillColor(GREY).text(`oleh sistem ${b.name}.${publicHost ? ' Pindai kode QR untuk memeriksa keaslian surat ini.' : ''}`, sx + QR + 8, doc.y + 2, { width: sw - QR - 8 });
      doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text(`Kode: ${code}`, sx + QR + 8, doc.y + 3, { width: sw - QR - 8 });
      ny = qy + QR + 8;
    }
    doc.font('Helvetica-Bold').fontSize(size).fillColor(ink).text(l.signerName, sx, ny, { width: sw, underline: true });
    doc.font('Helvetica').text(l.signerTitle, sx, doc.y + 1, { width: sw });

    // ---------- footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 0, doc.page.width, 4).fill(accent);
      if (b.color2) doc.rect(doc.page.width * 0.78, 0, doc.page.width * 0.22, 4).fill(b.color2);
      const fy = doc.page.height - 36;
      doc.moveTo(L, fy - 6).lineTo(L + W, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(6.8).fillColor(GREY);
      doc.text(`Dokumen ini ditandatangani secara elektronik oleh sistem ${b.name}${publicHost ? `. Verifikasi keaslian: ${publicHost}/verify` : ''}  ·  ${l.number}`, L, fy, { width: W, lineBreak: false, height: 10, ellipsis: true });
    }
    doc.end();
    const pdf = await done;
    // fingerprint of the exact bytes issued: the verify page detects edited copies
    await this.prisma.signedFile.create({
      data: { companyId, tokenHash: tokenHash(token), code, token, sha256: createHash('sha256').update(pdf).digest('hex'), size: pdf.length, docKind: 'LETTER', docNumber: l.number.slice(0, 60) },
    });
    return pdf;
  }
}

/** hex color mixed with another (t = share of the second one) */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const s = h.replace('#', '');
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const [x, y] = [p(/^#?[0-9a-f]{3,6}$/i.test(a) ? a : '#1e40af'), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function statusStyle(status?: string): { bg: string; fg: string } | null {
  if (!status) return null;
  if (/cancel|void|reject/i.test(status)) return { bg: '#fee2e2', fg: '#b91c1c' };
  if (/draft/i.test(status)) return { bg: '#f1f5f9', fg: '#475569' };
  if (/paid|complete|approved|posted/i.test(status)) return { bg: '#dcfce7', fg: '#15803d' };
  return { bg: '#e0e7ff', fg: '#3730a3' };
}
