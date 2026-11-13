import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { DocumentService } from './document.service';
import { DocumentPrintService } from '../print/document-print.service';
import { FileOutputService } from '../files/file-output.service';
import { MailService } from '../integrations/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().max(100).optional(),
  status: z.string().regex(/^[A-Z,]+$/).max(60).optional(),
  partnerId: z.uuid().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  unpaid: z.string().max(1).optional(),
  sort: z.string().max(20).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
const emailSchema = z.object({ to: z.email(), cc: z.email().optional().or(z.literal('')), subject: z.string().trim().min(1).max(200), message: z.string().max(5000).default('') });

@Controller('documents')
export class DocumentController {
  constructor(private readonly docs: DocumentService, private readonly printer: DocumentPrintService, private readonly output: FileOutputService, private readonly mail: MailService, private readonly prisma: PrismaService) {}

  @Get('types')
  types() {
    return this.docs.types();
  }

  @Get(':type')
  list(@Param('type') type: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.docs.list(type, q);
  }

  @Get(':type/:id')
  get(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.get(type, id);
  }

  /** Change history of a document (from the immutable audit trail) */
  @Get(':type/:id/history')
  async history(@Param('type') type: string, @Param('id') id: string) {
    await this.docs.get(type, id); // permission + ownership check
    return this.prisma.auditLog.findMany({ where: { entityId: id, companyId: RequestCtx.companyId() }, orderBy: { id: 'desc' }, take: 100, select: { id: true, action: true, username: true, createdAt: true, before: true, after: true } });
  }

  @Post(':type')
  create(@Param('type') type: string, @Body() body: unknown) {
    return this.docs.create(type, body);
  }

  @Patch(':type/:id')
  update(@Param('type') type: string, @Param('id') id: string, @Body() body: unknown) {
    return this.docs.update(type, id, body);
  }

  /** Nomor Faktur Pajak - can be filled in after the invoice was confirmed */
  @Patch(':type/:id/tax-invoice-number')
  taxInvoiceNumber(@Param('type') type: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ taxInvoiceNumber: z.string().trim().max(40).nullable().optional() }))) body: { taxInvoiceNumber?: string | null }) {
    return this.docs.setTaxInvoiceNumber(type, id, body.taxInvoiceNumber ?? null);
  }

  @Delete(':type/:id')
  remove(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.remove(type, id);
  }

  @Post(':type/:id/confirm')
  confirm(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.confirm(type, id);
  }

  /** Approval status, required levels and history of a document */
  @Get(':type/:id/approval')
  approval(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.approval(type, id);
  }

  @Post(':type/:id/request-approval')
  requestApproval(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.requestApproval(type, id);
  }

  @Post(':type/:id/cancel')
  cancel(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.cancel(type, id);
  }

  /** credit / debit notes: where they were applied; invoices: which notes settled them */
  @Get(':type/:id/credits')
  credits(@Param('type') type: string, @Param('id') id: string) {
    return this.docs.credits(type, id);
  }

  @Post(':type/:id/apply-credit')
  applyCredit(@Param('type') type: string, @Param('id') id: string, @Body(new ZodPipe(z.object({ invoiceId: z.uuid(), amount: z.coerce.number().positive().max(1e14) }))) body: { invoiceId: string; amount: number }) {
    return this.docs.applyCredit(type, id, body);
  }

  @Post(':type/:id/convert/:target')
  convert(@Param('type') type: string, @Param('id') id: string, @Param('target') target: string) {
    return this.docs.convert(type, id, target);
  }

  /** Uniform PDF for every document type. ?save=1 archives a copy in File Management */
  @Activity('document.print')
  @Get(':type/:id/pdf')
  async pdf(@Param('type') type: string, @Param('id') id: string, @Query('save') save: string, @Query('inline') inline: string, @Res() res: Response) {
    const def = this.docs.def(type);
    RequestCtx.assert(`${def.permission}.print`);
    const doc = await this.docs.get(type, id);
    const printable = await this.printer.trade(def, doc);
    await this.output.sendPdf(res, printable, `${def.printTitle}_${doc.number}.pdf`, { save: save === '1', inline: inline === '1', entity: { type: def.code, id } });
  }

  @Activity('document.email')
  @Post(':type/:id/email')
  async email(@Param('type') type: string, @Param('id') id: string, @Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>) {
    const def = this.docs.def(type);
    RequestCtx.assert(`${def.permission}.print`);
    const doc = await this.docs.get(type, id);
    const printable = await this.printer.trade(def, doc);
    const pdf = await this.output.pdf.render(RequestCtx.companyId(), printable);
    await this.mail.send({ to: body.to, cc: body.cc || undefined, subject: body.subject, text: body.message, attachments: [{ filename: `${def.printTitle}_${doc.number}.pdf`.replace(/[^\w.-]+/g, '_'), content: pdf }] });
    await this.output.archive(pdf, `${def.printTitle}_${doc.number}.pdf`, 'application/pdf', 'GENERATED', { type: def.code, id });
    return { success: true };
  }
}
