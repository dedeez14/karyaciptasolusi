import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Activity, Permission } from '../../common/decorators';
import { OpeningService } from './opening.service';

@Controller('opening-balances')
export class OpeningController {
  constructor(private readonly opening: OpeningService) {}

  @Get()
  @Permission('accounting.opening.read')
  overview() {
    return this.opening.overview();
  }

  @Post('accounts')
  @Permission('accounting.opening.manage')
  @Activity('opening.accounts')
  postBalances(@Body() body: unknown) {
    return this.opening.postBalances(body);
  }

  @Delete('accounts')
  @Permission('accounting.opening.manage')
  voidBalances() {
    return this.opening.voidBalances();
  }

  @Get('invoices')
  @Permission('accounting.opening.read')
  invoices(@Query('kind') kind: string) {
    return this.opening.listInvoices(kind === 'PI' ? 'PI' : 'SI');
  }

  @Post('invoices')
  @Permission('accounting.opening.manage')
  @Activity('opening.invoices')
  createInvoices(@Body() body: unknown) {
    return this.opening.createInvoices(body);
  }

  @Get('stock')
  @Permission('accounting.opening.read')
  stock() {
    return this.opening.listStock();
  }

  @Post('stock')
  @Permission('accounting.opening.manage')
  @Activity('opening.stock')
  createStock(@Body() body: unknown) {
    return this.opening.createStock(body);
  }

  @Post(':type/:id/cancel')
  @Permission('accounting.opening.manage')
  cancel(@Param('type') type: string, @Param('id') id: string) {
    const t = type.toUpperCase();
    return this.opening.cancel(t === 'PI' ? 'PI' : t === 'ADJ' ? 'ADJ' : 'SI', id);
  }
}
