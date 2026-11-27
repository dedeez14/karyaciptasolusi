import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Activity, Permission } from '../../common/decorators';
import { BankRecService } from './bankrec.service';

@Controller('bank-reconciliation')
export class BankRecController {
  constructor(private readonly rec: BankRecService) {}

  @Get()
  @Permission('accounting.bankrec.read')
  list(@Query('bankAccountId') bankAccountId?: string, @Query('status') status?: string) {
    return this.rec.list({ bankAccountId: bankAccountId && /^[0-9a-f-]{36}$/i.test(bankAccountId) ? bankAccountId : undefined, status: status === 'OPEN' || status === 'RECONCILED' ? status : undefined });
  }

  @Get('suggest')
  @Permission('accounting.bankrec.read')
  suggest(@Query('bankAccountId') bankAccountId: string) {
    return this.rec.suggest(String(bankAccountId ?? ''));
  }

  @Get(':id')
  @Permission('accounting.bankrec.read')
  get(@Param('id') id: string) {
    return this.rec.get(id);
  }

  @Post()
  @Permission('accounting.bankrec.create')
  create(@Body() body: unknown) {
    return this.rec.create(body);
  }

  @Put(':id')
  @Permission('accounting.bankrec.create')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.rec.update(id, body);
  }

  @Delete(':id')
  @Permission('accounting.bankrec.delete')
  remove(@Param('id') id: string) {
    return this.rec.remove(id);
  }

  @Post(':id/lines')
  @Permission('accounting.bankrec.create')
  addLines(@Param('id') id: string, @Body() body: unknown) {
    return this.rec.addLines(id, body);
  }

  @Delete(':id/lines/:lineId')
  @Permission('accounting.bankrec.create')
  removeLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.rec.removeLine(id, lineId);
  }

  @Post(':id/auto-match')
  @Permission('accounting.bankrec.reconcile')
  autoMatch(@Param('id') id: string) {
    return this.rec.autoMatch(id);
  }

  @Post(':id/lines/:lineId/match')
  @Permission('accounting.bankrec.reconcile')
  match(@Param('id') id: string, @Param('lineId') lineId: string, @Body() body: unknown) {
    return this.rec.match(id, lineId, body);
  }

  @Delete(':id/lines/:lineId/match')
  @Permission('accounting.bankrec.reconcile')
  unmatch(@Param('id') id: string, @Param('lineId') lineId: string) {
    return this.rec.unmatch(id, lineId);
  }

  @Post(':id/lines/:lineId/create-transaction')
  @Permission('accounting.bankrec.reconcile')
  createTransaction(@Param('id') id: string, @Param('lineId') lineId: string, @Body() body: unknown) {
    return this.rec.createTransaction(id, lineId, body);
  }

  @Post(':id/reconcile')
  @Permission('accounting.bankrec.reconcile')
  @Activity('bankrec.reconcile')
  reconcile(@Param('id') id: string) {
    return this.rec.reconcile(id);
  }

  @Post(':id/reopen')
  @Permission('accounting.bankrec.reconcile')
  reopen(@Param('id') id: string) {
    return this.rec.reopen(id);
  }
}
