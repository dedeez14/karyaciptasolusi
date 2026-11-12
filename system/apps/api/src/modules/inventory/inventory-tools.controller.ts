import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { FileOutputService } from '../files/file-output.service';
import { InventoryToolsService } from './inventory-tools.service';

const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const countSchema = z.object({
  warehouseId: z.uuid(),
  countDate: z.coerce.date(),
  categoryId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  countedBy: optText(200),
  witnessedBy: optText(200),
  notes: optText(2000),
});
const countUpdateSchema = z.object({ countedBy: optText(200), witnessedBy: optText(200), notes: optText(2000) });
const countedSchema = z.object({
  productId: z.uuid(),
  countedQty: z.coerce.number().min(0).max(1e9).nullable(),
  note: optText(300),
  /** add to the quantity already entered (repeated scans) */
  add: z.boolean().optional(),
});
const poSchema = z.object({
  warehouseId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  lines: z.array(z.object({ productId: z.uuid(), supplierId: z.uuid(), qty: z.coerce.number().positive().max(1e9) })).min(1).max(300),
});

@Controller('inventory')
export class InventoryToolsController {
  constructor(private readonly tools: InventoryToolsService, private readonly output: FileOutputService) {}

  @Get('lookup')
  lookup(@Query('code') code: string) {
    return this.tools.lookup(String(code ?? ''));
  }

  @Get('labels')
  @Activity('PRINT_LABELS')
  async labels(@Query('ids') ids: string, @Query('copies') copies: string, @Query('price') price: string, @Res() res: Response) {
    const pdf = await this.tools.labels(String(ids ?? '').split(','), Number(copies) || 1, price === '1');
    this.output.send(res, pdf, 'Barcode_labels.pdf', 'application/pdf', true);
  }

  @Get('reorder')
  reorder(@Query('warehouseId') warehouseId?: string) {
    return this.tools.reorder(warehouseId);
  }

  @Post('reorder/purchase-orders')
  @HttpCode(200)
  createPurchaseOrders(@Body(new ZodPipe(poSchema)) body: z.infer<typeof poSchema>) {
    return this.tools.createPurchaseOrders(body);
  }

  @Get('counts')
  counts() {
    return this.tools.listCounts();
  }

  @Post('counts')
  startCount(@Body(new ZodPipe(countSchema)) body: z.infer<typeof countSchema>) {
    return this.tools.startCount(body);
  }

  @Get('counts/:id')
  count(@Param('id') id: string) {
    return this.tools.getCount(id);
  }

  @Patch('counts/:id')
  updateCount(@Param('id') id: string, @Body(new ZodPipe(countUpdateSchema)) body: z.infer<typeof countUpdateSchema>) {
    return this.tools.updateCount(id, body);
  }

  @Post('counts/:id/lines')
  @HttpCode(200)
  setCounted(@Param('id') id: string, @Body(new ZodPipe(countedSchema)) body: z.infer<typeof countedSchema>) {
    return this.tools.setCounted(id, body);
  }

  @Post('counts/:id/post')
  @HttpCode(200)
  post(@Param('id') id: string, @Body() body: { uncountedAsZero?: boolean }) {
    return this.tools.postCount(id, { uncountedAsZero: body?.uncountedAsZero === true });
  }

  @Post('counts/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.tools.cancelCount(id);
  }

  @Get('counts/:id/pdf')
  async countPdf(@Param('id') id: string, @Query('inline') inline: string, @Res() res: Response) {
    RequestCtx.assert('inventory.adjustment.read');
    const r = await this.tools.countReport(id);
    await this.output.sendPdf(res, r.doc, r.name, { inline: inline === '1', entity: { type: 'StockCount', id } });
  }
}
