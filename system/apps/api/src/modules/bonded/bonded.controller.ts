import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { BondedService, documentSchema, registerSchema } from './bonded.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const period = (from?: string, to?: string) => {
  if (!DAY.test(from ?? '') || !DAY.test(to ?? '')) throw new BadRequestException('Choose a valid period');
  return [from!, to!] as const;
};

@Controller('bonded')
export class BondedController {
  constructor(private readonly svc: BondedService) {}

  @Get('meta')
  meta() {
    return this.svc.meta();
  }

  @Get('documents')
  documents(@Query() q: Record<string, string>) {
    return this.svc.documents({ bcType: q.bcType || undefined, direction: q.direction || undefined, status: q.status || undefined, facility: q.facility || undefined, from: DAY.test(q.from ?? '') ? q.from : undefined, to: DAY.test(q.to ?? '') ? q.to : undefined, q: q.q?.slice(0, 60) || undefined });
  }

  @Get('documents/:id')
  document(@Param('id') id: string) {
    return this.svc.document(id);
  }

  @Get('candidates')
  candidates(@Query('direction') direction: string, @Query('q') q?: string) {
    return this.svc.candidates(direction === 'OUT' ? 'OUT' : 'IN', q?.slice(0, 40) || undefined);
  }

  @Post('documents')
  create(@Body(new ZodPipe(documentSchema)) body: z.infer<typeof documentSchema>) {
    return this.svc.create(body);
  }

  @Put('documents/:id')
  update(@Param('id') id: string, @Body(new ZodPipe(documentSchema)) body: z.infer<typeof documentSchema>) {
    return this.svc.update(id, body);
  }

  @Post('documents/:id/register')
  @HttpCode(200)
  register(@Param('id') id: string, @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.svc.register(id, body);
  }

  @Post('documents/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Post('documents/:id/kite-settle')
  @HttpCode(200)
  kiteSettle(@Param('id') id: string) {
    return this.svc.kiteSettle(id);
  }

  @Post('documents/:id/kite-release')
  @HttpCode(200)
  kiteRelease(@Param('id') id: string) {
    return this.svc.kiteRelease(id);
  }

  @Get('reports/in')
  goodsIn(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.movements('IN', ...period(from, to));
  }

  @Get('reports/out')
  goodsOut(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.movements('OUT', ...period(from, to));
  }

  @Get('reports/mutation')
  mutation(@Query('class') cls: string, @Query('from') from?: string, @Query('to') to?: string, @Query('warehouseId') warehouseId?: string) {
    const [f, t] = period(from, to);
    return this.svc.mutationReport(cls, f, t, /^[0-9a-f-]{36}$/i.test(warehouseId ?? '') ? warehouseId : undefined);
  }

  @Get('reports/wip')
  wip() {
    return this.svc.wip();
  }

  @Get('reports/unlinked')
  unlinked(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.unlinked(...period(from, to));
  }

  @Get('reports/subcontract')
  subcontract() {
    return this.svc.subcontract();
  }

  @Get('quota')
  quota(@Query('year') year: string) {
    return this.svc.quota(Number(year));
  }

  @Get('kite')
  kite() {
    return this.svc.kite();
  }

  @Get('kite/bclkt01')
  bclkt01(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.bclkt01(...period(from, to));
  }
}
