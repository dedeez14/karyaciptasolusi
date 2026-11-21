import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { HrisService } from './hris.service';
import { FileOutputService } from '../files/file-output.service';

const paySchema = z.object({ bankAccountId: z.uuid('Choose a cash or bank account'), date: z.coerce.date() });
const runSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  payDate: z.coerce.date(),
  branchId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  notes: z.string().max(1000).nullable().optional(),
  /** REGULAR monthly payroll or THR (religious holiday allowance) */
  kind: z.enum(['REGULAR', 'THR']).default('REGULAR'),
  /** THR: date of the religious holiday (service is counted up to it; pay at least 7 days before) */
  holidayDate: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.date().optional()),
});

const severanceSchema = z.object({
  employeeId: z.uuid(),
  endDate: z.coerce.date(),
  reason: z.string().max(30).default('MUTUAL'),
  unusedLeaveDays: z.coerce.number().min(0).max(365).optional(),
  contract: z.boolean().optional(),
});

@Controller('hris')
export class HrisController {
  constructor(private readonly hris: HrisService, private readonly output: FileOutputService) {}

  @Post('leave-requests/:id/:decision')
  decide(@Param('id') id: string, @Param('decision') decision: string) {
    const map = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' } as const;
    const d = map[decision as keyof typeof map];
    if (!d) throw new Error('Invalid decision');
    return this.hris.decideLeave(id, d);
  }

  @Get('leave-balance/:employeeId')
  balance(@Param('employeeId') employeeId: string, @Query('year') year?: string) {
    return this.hris.leaveBalance(employeeId, Number(year) || new Date().getFullYear());
  }

  /** Self service: own attendance today (no extra permission - only the user's own linked employee) */
  @Get('my-attendance')
  myAttendance() {
    return this.hris.myAttendance();
  }

  @Post('my-attendance/check-in')
  checkIn() {
    return this.hris.checkIn();
  }

  @Post('my-attendance/check-out')
  checkOut() {
    return this.hris.checkOut();
  }

  @Get('payroll')
  runs(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.hris.listRuns({ page: Math.max(1, Number(page) || 1), pageSize: Math.min(100, Number(pageSize) || 20) });
  }

  @Get('payroll/:id')
  run(@Param('id') id: string) {
    return this.hris.getRun(id);
  }

  @Post('severance-estimate')
  severance(@Body(new ZodPipe(severanceSchema)) body: z.infer<typeof severanceSchema>) {
    return this.hris.severanceEstimate(body);
  }

  @Post('payroll')
  generate(@Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.hris.generate(body);
  }

  @Post('payroll/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.hris.confirmRun(id);
  }

  @Post('payroll/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.hris.cancelRun(id);
  }

  @Activity('payroll.pay')
  @Post('payroll/:id/pay')
  pay(@Param('id') id: string, @Body(new ZodPipe(paySchema)) body: z.infer<typeof paySchema>) {
    return this.hris.payRun(id, body);
  }

  @Activity('payroll.unpay')
  @Post('payroll/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.hris.unpayRun(id);
  }

  @Get('payroll/:id/transfer-file')
  async transferFile(@Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const f = format === 'csv' ? 'csv' : 'xlsx';
    await this.output.sendTable(res, await this.hris.transferFile(id, f), f);
  }

  @Activity('payslip.print')
  @Get('payroll/:id/payslips/:slipId/pdf')
  async payslip(@Param('id') id: string, @Param('slipId') slipId: string, @Query('save') save: string, @Query('inline') inline: string, @Res() res: Response) {
    const { doc, name } = await this.hris.payslipDoc(id, slipId);
    await this.output.sendPdf(res, doc, name, { save: save === '1', inline: inline === '1', entity: { type: 'PAYSLIP', id: slipId } });
  }
}
