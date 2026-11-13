import { Body, Controller, Get, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { FileOutputService } from '../files/file-output.service';
import { AttendanceService } from './attendance.service';

const uuidOpt = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional());
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), departmentId: uuidOpt, branchId: uuidOpt, search: z.string().max(100).optional() });
const time = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional());
const cellSchema = z.object({
  employeeId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statusCode: z.preprocess((v) => (v === '' ? null : v), z.string().max(50).nullable().optional()),
  checkIn: time,
  checkOut: time,
  notes: z.string().max(2000).nullable().optional(),
});
const bulkSchema = z.object({
  employeeIds: z.array(z.uuid()).min(1).max(1000),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(31),
  statusCode: z.string().min(1).max(50),
  overwrite: z.boolean().optional(),
});

@Controller('hris/attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly output: FileOutputService,
  ) {}

  @Get('month')
  month(@Query(new ZodPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.attendance.month(q);
  }

  @Get('month/export')
  async export(@Query(new ZodPipe(monthQuery.extend({ format: z.enum(['xlsx', 'csv']).optional() }))) q: z.infer<typeof monthQuery> & { format?: string }, @Res() res: Response) {
    await this.output.sendTable(res, await this.attendance.exportTable(q), q.format ?? 'xlsx');
  }

  @Put('cell')
  cell(@Body(new ZodPipe(cellSchema)) body: z.infer<typeof cellSchema>) {
    return this.attendance.setCell(body);
  }

  @Post('bulk')
  bulk(@Body(new ZodPipe(bulkSchema)) body: z.infer<typeof bulkSchema>) {
    return this.attendance.bulk(body);
  }
}
