import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { PaymentService } from './payment.service';
import { DocumentPrintService } from '../print/document-print.service';
import { FileOutputService } from '../files/file-output.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().max(100).optional(),
  partnerId: z.uuid().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService, private readonly printer: DocumentPrintService, private readonly output: FileOutputService) {}

  @Get(':direction')
  list(@Param('direction') direction: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.payments.list(direction, q);
  }

  @Get(':direction/open-invoices/:partnerId')
  open(@Param('direction') direction: string, @Param('partnerId') partnerId: string) {
    return this.payments.openInvoices(direction, partnerId);
  }

  @Get(':direction/:id')
  get(@Param('direction') direction: string, @Param('id') id: string) {
    return this.payments.get(direction, id);
  }

  @Post(':direction')
  create(@Param('direction') direction: string, @Body() body: unknown) {
    return this.payments.create(direction, body);
  }

  @Post(':direction/:id/cancel')
  cancel(@Param('direction') direction: string, @Param('id') id: string) {
    return this.payments.cancel(direction, id);
  }

  @Activity('payment.print')
  @Get(':direction/:id/pdf')
  async pdf(@Param('direction') direction: string, @Param('id') id: string, @Query('save') save: string, @Query('inline') inline: string, @Res() res: Response) {
    const d = this.payments.dir(direction);
    RequestCtx.assert(`${d.perm}.read`);
    const p = await this.payments.get(direction, id);
    await this.output.sendPdf(res, await this.printer.payment(p), `${d.label}_${p.number}.pdf`, { save: save === '1', inline: inline === '1', entity: { type: `PAY_${d.direction}`, id } });
  }
}
