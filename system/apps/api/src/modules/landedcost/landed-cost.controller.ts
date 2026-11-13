import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { LandedCostService, landedCostSchema } from './landed-cost.service';

const STATUS = new Set(['DRAFT', 'POSTED', 'CANCELLED']);

@Controller('landed-costs')
export class LandedCostController {
  constructor(private readonly svc: LandedCostService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.svc.list(STATUS.has(status ?? '') ? status : undefined);
  }

  @Get('setup')
  setup() {
    return this.svc.setup();
  }

  @Post('setup')
  @HttpCode(200)
  createChargeProducts() {
    return this.svc.createChargeProducts();
  }

  @Get('receipts')
  receipts(@Query('q') q?: string) {
    return this.svc.receipts(q ? String(q).slice(0, 60) : undefined);
  }

  @Get('receipt-lines')
  receiptLines(@Query('ids') ids?: string) {
    return this.svc.receiptLines(
      String(ids ?? '')
        .split(',')
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
        .slice(0, 50),
    );
  }

  @Get('open-charges')
  openCharges() {
    return this.svc.openCharges();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body(new ZodPipe(landedCostSchema)) body: z.infer<typeof landedCostSchema>) {
    return this.svc.save(null, body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(landedCostSchema)) body: z.infer<typeof landedCostSchema>) {
    return this.svc.save(id, body);
  }

  @Post(':id/post')
  @HttpCode(200)
  post(@Param('id') id: string) {
    return this.svc.post(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }
}
