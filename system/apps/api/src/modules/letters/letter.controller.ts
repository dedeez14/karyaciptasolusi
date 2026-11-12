import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Activity, Permission } from '../../common/decorators';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/audit/audit.service';
import { PdfService } from '../print/pdf.service';
import { FileOutputService } from '../files/file-output.service';

/** Company letters (CRUD through the generic "letters" resource): the signed PDF */
@Controller('letters')
export class LetterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    private readonly output: FileOutputService,
    private readonly audit: AuditService,
  ) {}

  /** Every print is signed and registered, so the verification page knows this exact file */
  @Get(':id/pdf')
  @Permission('hris.letter.read')
  @Activity('letter.print')
  async print(@Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    const companyId = RequestCtx.companyId();
    const l = await this.prisma.companyLetter.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!l) throw new NotFoundException('Letter not found');
    const pdf = await this.pdf.renderLetter(companyId, {
      id: l.id,
      number: l.number,
      date: l.letterDate.toISOString().slice(0, 10),
      subject: l.subject,
      recipient: l.recipient,
      personName: l.personName,
      personIdNumber: this.crypto.decrypt(l.personIdNumber),
      personAddress: this.crypto.decrypt(l.personAddress),
      personPosition: l.personPosition,
      body: l.body,
      place: l.place,
      signerName: l.signerName,
      signerTitle: l.signerTitle,
    });
    await this.audit.record('CompanyLetter', l.id, 'PRINT', undefined, { number: l.number });
    this.output.send(res, pdf, `${l.subject} ${l.number}.pdf`.replace(/\//g, '-'), 'application/pdf', inline === '1');
  }
}
