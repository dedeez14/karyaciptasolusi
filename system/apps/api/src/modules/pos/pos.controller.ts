import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { closeSchema, openSchema, PosService, saleSchema } from './pos.service';

@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('config')
  config() {
    return this.pos.config();
  }

  @Get('products')
  products(@Query('warehouseId') warehouseId: string, @Query('search') search?: string) {
    return this.pos.products(String(warehouseId ?? ''), search);
  }

  @Get('sessions')
  sessions() {
    return this.pos.listSessions();
  }

  @Post('sessions')
  open(@Body(new ZodPipe(openSchema)) body: z.infer<typeof openSchema>) {
    return this.pos.open(body);
  }

  @Get('sessions/:id')
  session(@Param('id') id: string) {
    return this.pos.sessionSummary(id);
  }

  @Post('sessions/:id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @Body(new ZodPipe(closeSchema)) body: z.infer<typeof closeSchema>) {
    return this.pos.close(id, body);
  }

  @Post('sales')
  sell(@Body(new ZodPipe(saleSchema)) body: z.infer<typeof saleSchema>) {
    return this.pos.sell(body);
  }

  @Get('sales/:id/receipt')
  receipt(@Param('id') id: string) {
    return this.pos.receipt(id);
  }

  @Post('sales/:id/void')
  @HttpCode(200)
  void(@Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) }))) body: { reason: string }) {
    return this.pos.void(id, body.reason);
  }

  @Get('recap')
  recap(@Query('from') from: string, @Query('to') to: string) {
    const f = from ? new Date(from) : new Date(new Date().toISOString().slice(0, 8) + '01');
    const t = to ? new Date(to) : new Date(new Date().toISOString().slice(0, 10));
    return this.pos.dailyRecap(f, t);
  }
}
