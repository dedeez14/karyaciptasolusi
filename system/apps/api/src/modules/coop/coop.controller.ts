import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { CoopService, disburseSchema, leaveSchema, loanProductSchema, loanSchema, memberSchema, openSchema, paySchema, savingProductSchema, shuSchema, txnSchema } from './coop.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateSchema = z.object({ date: z.coerce.date() });
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};
const yearOf = (v?: string) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear() - 1;
};

@Controller('coop')
export class CoopController {
  constructor(private readonly svc: CoopService) {}

  @Get('products')
  products() {
    return this.svc.products();
  }

  @Post('saving-products')
  createSavingProduct(@Body(new ZodPipe(savingProductSchema)) body: z.infer<typeof savingProductSchema>) {
    return this.svc.saveSavingProduct(null, body);
  }

  @Put('saving-products/:id')
  updateSavingProduct(@Param('id') pid: string, @Body(new ZodPipe(savingProductSchema)) body: z.infer<typeof savingProductSchema>) {
    return this.svc.saveSavingProduct(id(pid), body);
  }

  @Post('loan-products')
  createLoanProduct(@Body(new ZodPipe(loanProductSchema)) body: z.infer<typeof loanProductSchema>) {
    return this.svc.saveLoanProduct(null, body);
  }

  @Put('loan-products/:id')
  updateLoanProduct(@Param('id') pid: string, @Body(new ZodPipe(loanProductSchema)) body: z.infer<typeof loanProductSchema>) {
    return this.svc.saveLoanProduct(id(pid), body);
  }

  @Get('members')
  members(@Query('status') status?: string) {
    return this.svc.members(['ACTIVE', 'LEFT'].includes(status ?? '') ? status : undefined);
  }

  @Get('members/:id')
  member(@Param('id') mid: string) {
    return this.svc.member(id(mid));
  }

  @Post('members')
  createMember(@Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    return this.svc.saveMember(null, body);
  }

  @Put('members/:id')
  updateMember(@Param('id') mid: string, @Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>) {
    return this.svc.saveMember(id(mid), body);
  }

  @Post('members/:id/accounts')
  openAccount(@Param('id') mid: string, @Body(new ZodPipe(openSchema)) body: z.infer<typeof openSchema>) {
    return this.svc.openAccount(id(mid), body);
  }

  @Post('members/:id/leave')
  @HttpCode(200)
  leave(@Param('id') mid: string, @Body(new ZodPipe(leaveSchema)) body: z.infer<typeof leaveSchema>) {
    return this.svc.leave(id(mid), body);
  }

  @Post('accounts/:id/deposit')
  @HttpCode(200)
  deposit(@Param('id') aid: string, @Body(new ZodPipe(txnSchema)) body: z.infer<typeof txnSchema>) {
    return this.svc.deposit(id(aid), body);
  }

  @Post('accounts/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id') aid: string, @Body(new ZodPipe(txnSchema)) body: z.infer<typeof txnSchema>) {
    return this.svc.withdraw(id(aid), body);
  }

  @Get('interest')
  interest(@Query('period') period?: string) {
    return this.svc.interestPreview(PERIOD.test(period ?? '') ? period! : new Date().toISOString().slice(0, 7));
  }

  @Post('interest/:period')
  @HttpCode(200)
  creditInterest(@Param('period') period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Invalid period');
    return this.svc.creditInterest(period);
  }

  @Post('interest-runs/:id/cancel')
  @HttpCode(200)
  cancelInterest(@Param('id') rid: string) {
    return this.svc.cancelInterest(id(rid));
  }

  @Get('loans')
  loans(@Query('status') status?: string) {
    return this.svc.loans(['APPLIED', 'ACTIVE', 'PAID', 'WRITTEN_OFF', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('loans/:id')
  loan(@Param('id') lid: string) {
    return this.svc.loan(id(lid));
  }

  @Post('loans')
  apply(@Body(new ZodPipe(loanSchema)) body: z.infer<typeof loanSchema>) {
    return this.svc.applyLoan(body);
  }

  @Post('loans/:id/disburse')
  @HttpCode(200)
  disburse(@Param('id') lid: string, @Body(new ZodPipe(disburseSchema)) body: z.infer<typeof disburseSchema>) {
    return this.svc.disburse(id(lid), body);
  }

  @Post('loans/:id/cancel')
  @HttpCode(200)
  cancelLoan(@Param('id') lid: string) {
    return this.svc.cancelLoan(id(lid));
  }

  @Post('loans/:id/pay')
  @HttpCode(200)
  pay(@Param('id') lid: string, @Body(new ZodPipe(paySchema)) body: z.infer<typeof paySchema>) {
    return this.svc.pay(id(lid), body);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  cancelPayment(@Param('id') pid: string) {
    return this.svc.cancelPayment(id(pid));
  }

  @Post('loans/:id/write-off')
  @HttpCode(200)
  writeOff(@Param('id') lid: string, @Body(new ZodPipe(dateSchema)) body: z.infer<typeof dateSchema>) {
    return this.svc.writeOff(id(lid), body);
  }

  @Get('collectibility')
  collectibility() {
    return this.svc.collectibility();
  }

  @Post('provision')
  @HttpCode(200)
  provision(@Body(new ZodPipe(dateSchema)) body: z.infer<typeof dateSchema>) {
    return this.svc.postProvision(body);
  }

  @Get('shu')
  shu(@Query('year') year?: string, @Query('shu') shu?: string) {
    const v = Number(shu);
    return this.svc.shuPreview(yearOf(year), shu && Number.isFinite(v) && v > 0 ? v : undefined);
  }

  @Post('shu')
  @HttpCode(200)
  distribute(@Body(new ZodPipe(shuSchema)) body: z.infer<typeof shuSchema>) {
    return this.svc.distributeShu(body);
  }

  @Post('shu/:id/cancel')
  @HttpCode(200)
  cancelShu(@Param('id') rid: string) {
    return this.svc.cancelShu(id(rid));
  }
}
