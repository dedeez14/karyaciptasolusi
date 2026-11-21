import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Activity } from '../../common/decorators';
import { MarketplaceService } from './marketplace.service';
import { MarketplacePostingService } from './marketplace-posting.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    private readonly mp: MarketplaceService,
    private readonly posting: MarketplacePostingService,
  ) {}

  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.mp.overview(Number(days) || 30);
  }

  @Get('options')
  options() {
    return this.mp.options();
  }

  // ---------------------------------------------------------------- stores & listings
  @Get('stores')
  stores() {
    return this.mp.stores();
  }

  @Activity('marketplace.store.create')
  @Post('stores')
  createStore(@Body() body: unknown) {
    return this.mp.createStore(body);
  }

  @Activity('marketplace.store.update')
  @Put('stores/:id')
  updateStore(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.updateStore(id, body);
  }

  @Delete('stores/:id')
  deleteStore(@Param('id') id: string) {
    return this.mp.deleteStore(id);
  }

  @Post('stores/:id/setup-accounts')
  setupAccounts(@Param('id') id: string) {
    return this.mp.setupAccounts(id);
  }

  @Get('stores/:id/listings')
  listings(@Param('id') id: string) {
    return this.mp.listings(id);
  }

  @Post('stores/:id/listings')
  createListing(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.createListing(id, body);
  }

  @Put('stores/:id/listings')
  mapListings(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.mapListings(id, body);
  }

  // ---------------------------------------------------------------- data in
  @Activity('marketplace.sync')
  @Post('stores/:id/sync')
  sync(@Param('id') id: string) {
    return this.mp.sync(id);
  }

  @Activity('marketplace.import')
  @Post('stores/:id/import')
  importFile(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.importFile(id, body);
  }

  @Get('imports')
  imports(@Query('storeId') storeId?: string) {
    return this.mp.imports(storeId);
  }

  // ---------------------------------------------------------------- orders
  @Get('orders')
  orders(@Query() q: Record<string, string>) {
    return this.mp.orders({ ...q, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 50 });
  }

  @Post('stores/:id/orders')
  addOrder(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.addOrder(id, body);
  }

  @Put('orders/:id/refund')
  refund(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.setRefund(id, body);
  }

  @Delete('orders/:id')
  deleteOrder(@Param('id') id: string) {
    return this.mp.deleteOrder(id);
  }

  // ---------------------------------------------------------------- statistics
  @Get('stats')
  stats(@Query() q: Record<string, string>) {
    return this.mp.stats(q);
  }

  @Put('stores/:id/stats')
  saveStat(@Param('id') id: string, @Body() body: unknown) {
    return this.mp.saveStat(id, body);
  }

  @Delete('stats/:id')
  deleteStat(@Param('id') id: string) {
    return this.mp.deleteStat(id);
  }

  // ---------------------------------------------------------------- settlements & payouts
  @Get('settlements')
  settlements(@Query('storeId') storeId?: string) {
    return this.posting.settlements(storeId);
  }

  @Post('stores/:id/settlements/preview')
  preview(@Param('id') id: string, @Body() body: unknown) {
    return this.posting.preview(id, body);
  }

  @Activity('marketplace.settle')
  @Post('stores/:id/settlements')
  settle(@Param('id') id: string, @Body() body: unknown) {
    return this.posting.settle(id, body);
  }

  @Activity('marketplace.settle.undo')
  @Post('settlements/:id/undo')
  undo(@Param('id') id: string) {
    return this.posting.undo(id);
  }

  @Get('payouts')
  payouts(@Query('storeId') storeId?: string) {
    return this.posting.payouts(storeId);
  }

  @Get('balances')
  balances() {
    return this.posting.balances();
  }

  @Activity('marketplace.payout')
  @Post('stores/:id/payouts')
  postPayout(@Param('id') id: string, @Body() body: unknown) {
    return this.posting.postPayout(id, body);
  }

  @Activity('marketplace.payout')
  @Post('stores/:id/payouts/:payoutId')
  postPendingPayout(@Param('id') id: string, @Param('payoutId') payoutId: string, @Body() body: unknown) {
    return this.posting.postPayout(id, body, payoutId);
  }

  @Post('payouts/:id/cancel')
  cancelPayout(@Param('id') id: string) {
    return this.posting.cancelPayout(id);
  }
}
