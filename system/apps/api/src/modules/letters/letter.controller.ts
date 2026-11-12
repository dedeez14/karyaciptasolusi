import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { Activity, Permission } from '../../common/decorators';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { PdfService, type LetterContent } from '../print/pdf.service';
import { FileOutputService } from '../files/file-output.service';
import { ResourceService } from '../resources/resource.service';
import { MailService } from '../integrations/mail.service';

const text = (max: number) => z.string().trim().max(max);
const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const letterBody = z.object({
  letterType: text(30).min(1),
  layout: z.enum(['PERSON', 'PLAIN']).default('PERSON'),
  letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  subject: text(200).min(1, 'Subject is required'),
  recipient: opt(500),
  personName: opt(150),
  personIdNumber: opt(40),
  personAddress: opt(500),
  personPosition: opt(150),
  body: text(6000).min(1, 'Text is required'),
  place: text(80).min(1),
  signerName: text(150).min(1),
  signerTitle: text(100).min(1),
});
/** complete letters, one per person (the page fills each person's details into the text) */
const bulkBody = z.object({ letters: z.array(letterBody).min(1, 'Add at least one person').max(50, 'At most 50 people at once') });
const emailBody = z.object({
  to: z.string().trim().toLowerCase().email('Invalid e-mail address').max(150),
  message: z.string().trim().max(4000).optional(),
});

const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Invalid data');
  return r.data;
};

/** Company letters (CRUD through the generic "letters" resource): previews, signed PDFs, bulk issue, e-mail */
@Controller('letters')
export class LetterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    private readonly output: FileOutputService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly resources: ResourceService,
    private readonly mail: MailService,
  ) {}

  /** Who signs generated documents and whether a signature image is available (Document Center banner) */
  @Get('signer')
  @Permission('hris.letter.read')
  async signer() {
    const companyId = RequestCtx.companyId();
    const brand = await this.pdf.brand(companyId);
    const name = (await this.settings.str('document.signerName', companyId, '')) || 'Dede Febriansyah';
    const title = (await this.settings.str('document.signerTitle', companyId, '')) || 'Direktur';
    return { signerName: brand.signer?.name ?? name, signerTitle: brand.signer?.title || title, hasSignature: !!brand.signer };
  }

  /** The document as it will look, before it is saved: no number, not signed, marked PRATINJAU */
  @Post('preview')
  @Permission('hris.letter.create')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async preview(@Body() raw: unknown, @Res() res: Response) {
    const b = parse(letterBody, raw);
    const pdf = await this.pdf.renderLetter(RequestCtx.companyId(), {
      id: '00000000-0000-0000-0000-000000000000',
      number: '(diberikan saat disimpan)',
      date: b.letterDate,
      subject: b.subject,
      layout: b.layout,
      type: b.letterType,
      recipient: b.recipient,
      personName: b.personName,
      personIdNumber: b.personIdNumber,
      personAddress: b.personAddress,
      personPosition: b.personPosition,
      body: b.body,
      place: b.place,
      signerName: b.signerName,
      signerTitle: b.signerTitle,
      draft: true,
    });
    this.output.send(res, pdf, 'Pratinjau.pdf', 'application/pdf', true);
  }

  /** One numbered, signed letter per person (e.g. an assignment letter for the whole team) */
  @Post('bulk')
  @Permission('hris.letter.create')
  @Activity('letter.bulk')
  async bulk(@Body() raw: unknown) {
    const { letters } = parse(bulkBody, raw);
    const created: { id: string; number: string; personName: string | null }[] = [];
    for (const l of letters) {
      const row = await this.resources.create('letters', l);
      created.push({ id: String(row.id), number: String(row.number), personName: l.personName });
    }
    return { created };
  }

  /** Several letters in one PDF, ready to print (each page set is signed and registered like a single print) */
  @Get('merged')
  @Permission('hris.letter.read')
  @Activity('letter.print')
  async merged(@Query('ids') ids: string | undefined, @Res() res: Response) {
    const list = String(ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 50);
    if (!list.length) throw new BadRequestException('No documents selected');
    const companyId = RequestCtx.companyId();
    const rows = await this.prisma.companyLetter.findMany({ where: { id: { in: list }, companyId, deletedAt: null } });
    if (!rows.length) throw new NotFoundException('Letters not found');
    const order = new Map(list.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const out = await PDFDocument.create();
    out.setTitle(`${rows[0].subject} (${rows.length})`);
    out.setProducer('KCS ERP');
    for (const l of rows) {
      const one = await PDFDocument.load(await this.pdf.renderLetter(companyId, this.content(l)));
      for (const page of await out.copyPages(one, one.getPageIndices())) out.addPage(page);
      await this.audit.record('CompanyLetter', l.id, 'PRINT', undefined, { number: l.number, merged: rows.length });
    }
    this.output.send(res, Buffer.from(await out.save()), `${rows[0].subject} (${rows.length} dokumen).pdf`.replace(/[\\/]/g, '-'), 'application/pdf', true);
  }

  /** Every print is signed and registered, so the verification page knows this exact file */
  @Get(':id/pdf')
  @Permission('hris.letter.read')
  @Activity('letter.print')
  async print(@Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const l = await this.letter(id);
    const pdf = await this.pdf.renderLetter(RequestCtx.companyId(), this.content(l));
    await this.audit.record('CompanyLetter', l.id, 'PRINT', undefined, { number: l.number });
    this.output.send(res, pdf, this.fileName(l), 'application/pdf', inline === '1');
  }

  /** Sends the signed PDF to one address (the company's SMTP settings) */
  @Post(':id/email')
  @Permission('hris.letter.read')
  @Activity('letter.email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async email(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    const b = parse(emailBody, raw);
    const companyId = RequestCtx.companyId();
    const l = await this.letter(id);
    const pdf = await this.pdf.renderLetter(companyId, this.content(l));
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });
    const from = company?.legalName || company?.name || '';
    const text = [b.message || `Dengan hormat,\n\nBersama e-mail ini kami sampaikan ${l.subject} nomor ${l.number} (terlampir).`, '', 'Hormat kami,', l.signerName, `${l.signerTitle}, ${from}`].join('\n');
    await this.mail.send({ to: b.to, subject: `${l.subject} - ${l.number}`, text, fromName: from, attachments: [{ filename: this.fileName(l), content: pdf }] }, companyId);
    await this.audit.record('CompanyLetter', l.id, 'EMAIL', undefined, { number: l.number, to: b.to });
    return { ok: true };
  }

  private async letter(id: string) {
    const l = await this.prisma.companyLetter.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!l) throw new NotFoundException('Letter not found');
    return l;
  }

  private fileName(l: { subject: string; number: string }) {
    return `${l.subject} ${l.number}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
  }

  private content(l: Awaited<ReturnType<LetterController['letter']>>): LetterContent {
    return {
      id: l.id,
      number: l.number,
      date: l.letterDate.toISOString().slice(0, 10),
      subject: l.subject,
      layout: l.layout,
      type: l.letterType,
      recipient: l.recipient,
      personName: l.personName,
      personIdNumber: this.crypto.decrypt(l.personIdNumber),
      personAddress: this.crypto.decrypt(l.personAddress),
      personPosition: l.personPosition,
      body: l.body,
      place: l.place,
      signerName: l.signerName,
      signerTitle: l.signerTitle,
    };
  }
}
