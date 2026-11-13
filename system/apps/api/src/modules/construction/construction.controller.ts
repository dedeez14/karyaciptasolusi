import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { certificateSchema, claimSchema, ConstructionService, contractSchema, subcontractSchema } from './construction.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateSchema = z.object({ date: z.coerce.date() });
const releaseSchema = z.object({ date: z.coerce.date(), supplierRef: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(80).nullable().optional()) });
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};

@Controller('construction')
export class ConstructionController {
  constructor(private readonly svc: ConstructionService) {}

  @Get('contracts')
  contracts(@Query('status') status?: string) {
    return this.svc.contracts(['ACTIVE', 'PHO', 'FHO', 'CANCELLED'].includes(status ?? '') ? status : undefined);
  }

  @Get('contracts/:id')
  contract(@Param('id') cid: string) {
    return this.svc.contract(id(cid));
  }

  @Post('contracts')
  createContract(@Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(null, body);
  }

  @Put('contracts/:id')
  updateContract(@Param('id') cid: string, @Body(new ZodPipe(contractSchema)) body: z.infer<typeof contractSchema>) {
    return this.svc.saveContract(id(cid), body);
  }

  @Post('contracts/:id/advance')
  @HttpCode(200)
  advance(@Param('id') cid: string) {
    return this.svc.invoiceAdvance(id(cid));
  }

  @Post('contracts/:id/pho')
  @HttpCode(200)
  pho(@Param('id') cid: string, @Body(new ZodPipe(dateSchema)) body: z.infer<typeof dateSchema>) {
    return this.svc.handover(id(cid), body);
  }

  @Post('contracts/:id/pho/undo')
  @HttpCode(200)
  undoPho(@Param('id') cid: string) {
    return this.svc.undoHandover(id(cid));
  }

  @Post('contracts/:id/fho')
  @HttpCode(200)
  fho(@Param('id') cid: string, @Body(new ZodPipe(dateSchema)) body: z.infer<typeof dateSchema>) {
    return this.svc.finalHandover(id(cid), body);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancelContract(@Param('id') cid: string) {
    return this.svc.cancelContract(id(cid));
  }

  @Get('certificates')
  certificates(@Query('contractId') contractId?: string) {
    return this.svc.certificates(contractId && UUID.test(contractId) ? contractId : undefined);
  }

  @Get('certificates/:id')
  certificate(@Param('id') cid: string) {
    return this.svc.certificate(id(cid));
  }

  @Post('contracts/:id/certificates')
  createCertificate(@Param('id') cid: string, @Body(new ZodPipe(certificateSchema)) body: z.infer<typeof certificateSchema>) {
    return this.svc.saveCertificate(id(cid), null, body);
  }

  @Put('contracts/:id/certificates/:certId')
  updateCertificate(@Param('id') cid: string, @Param('certId') certId: string, @Body(new ZodPipe(certificateSchema)) body: z.infer<typeof certificateSchema>) {
    return this.svc.saveCertificate(id(cid), id(certId), body);
  }

  @Post('certificates/:id/approve')
  @HttpCode(200)
  approve(@Param('id') cid: string) {
    return this.svc.approveCertificate(id(cid));
  }

  @Post('certificates/:id/cancel')
  @HttpCode(200)
  cancelCertificate(@Param('id') cid: string) {
    return this.svc.cancelCertificate(id(cid));
  }

  @Get('subcontracts')
  subcontracts(@Query('contractId') contractId?: string) {
    return this.svc.subcontracts(contractId && UUID.test(contractId) ? contractId : undefined);
  }

  @Post('subcontracts')
  createSub(@Body(new ZodPipe(subcontractSchema)) body: z.infer<typeof subcontractSchema>) {
    return this.svc.saveSubcontract(null, body);
  }

  @Put('subcontracts/:id')
  updateSub(@Param('id') sid: string, @Body(new ZodPipe(subcontractSchema)) body: z.infer<typeof subcontractSchema>) {
    return this.svc.saveSubcontract(id(sid), body);
  }

  @Post('subcontracts/:id/claims')
  claim(@Param('id') sid: string, @Body(new ZodPipe(claimSchema)) body: z.infer<typeof claimSchema>) {
    return this.svc.claim(id(sid), body);
  }

  @Post('claims/:id/cancel')
  @HttpCode(200)
  cancelClaim(@Param('id') cid: string) {
    return this.svc.cancelClaim(id(cid));
  }

  @Post('subcontracts/:id/release')
  @HttpCode(200)
  release(@Param('id') sid: string, @Body(new ZodPipe(releaseSchema)) body: z.infer<typeof releaseSchema>) {
    return this.svc.releaseRetention(id(sid), body);
  }

  @Get('final-tax')
  finalTax(@Query('period') period?: string) {
    const p = PERIOD.test(period ?? '') ? period! : new Date().toISOString().slice(0, 7);
    return this.svc.finalTax(p);
  }

  @Post('final-tax/:period/book')
  @HttpCode(200)
  book(@Param('period') period: string) {
    if (!PERIOD.test(period)) throw new BadRequestException('Invalid period');
    return this.svc.bookSelfPay(period);
  }

  @Post('final-tax/self-pay/:id/cancel')
  @HttpCode(200)
  cancelBook(@Param('id') sid: string) {
    return this.svc.cancelSelfPay(id(sid));
  }
}
