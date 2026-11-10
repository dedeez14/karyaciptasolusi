import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { CashService } from './cash.service';
import { DocumentPrintService } from '../print/document-print.service';
import { FileOutputService } from '../files/file-output.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().max(100).optional(),
  type: z.enum(['RECEIPT', 'PAYMENT', 'TRANSFER']).optional(),
  bankAccountId: z.uuid().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService, private readonly printer: DocumentPrintService, private readonly output: FileOutputService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.cash.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.cash.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.cash.create(body);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.cash.cancel(id);
  }

  @Activity('cash.print')
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Query('save') save: string, @Query('inline') inline: string, @Res() res: Response) {
    RequestCtx.assert('accounting.cash.read');
    const t = await this.cash.get(id);
    await this.output.sendPdf(res, await this.printer.cash(t), `${t.number}.pdf`, { save: save === '1', inline: inline === '1', entity: { type: 'CASH', id } });
  }
}
