import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { classSchema, configSchema, discountSchema, enrolSchema, feeSchema, itemSchema, leaveSchema, promoteSchema, runSchema, SchoolService, studentSchema } from './school.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}\/\d{4}$/;
const id = (v: string) => {
  if (!UUID.test(v)) throw new BadRequestException('Invalid id');
  return v;
};
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const moveSchema = z.object({ classId: z.uuid() });
const entrySchema = z.object({ date: z.coerce.date() });

@Controller('school')
export class SchoolController {
  constructor(private readonly svc: SchoolService) {}

  @Get('setup')
  setup() {
    return this.svc.setup();
  }

  @Put('config')
  config(@Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>) {
    return this.svc.saveConfig(body);
  }

  @Post('classes')
  createClass(@Body(new ZodPipe(classSchema)) body: z.infer<typeof classSchema>) {
    return this.svc.saveClass(null, body);
  }

  @Put('classes/:id')
  updateClass(@Param('id') cid: string, @Body(new ZodPipe(classSchema)) body: z.infer<typeof classSchema>) {
    return this.svc.saveClass(id(cid), body);
  }

  @Post('fees')
  createFee(@Body(new ZodPipe(feeSchema)) body: z.infer<typeof feeSchema>) {
    return this.svc.saveFee(null, body);
  }

  @Put('fees/:id')
  updateFee(@Param('id') fid: string, @Body(new ZodPipe(feeSchema)) body: z.infer<typeof feeSchema>) {
    return this.svc.saveFee(id(fid), body);
  }

  @Get('students')
  students(@Query('q') q?: string, @Query('status') status?: string, @Query('classId') classId?: string) {
    return this.svc.students({
      q: q?.trim().slice(0, 60) || undefined,
      status: ['APPLICANT', 'ACTIVE', 'GRADUATED', 'LEFT', 'REJECTED'].includes(status ?? '') ? status : undefined,
      classId: classId && UUID.test(classId) ? classId : undefined,
    });
  }

  @Get('students/:id')
  student(@Param('id') sid: string) {
    return this.svc.student(id(sid));
  }

  @Post('students')
  createStudent(@Body(new ZodPipe(studentSchema)) body: z.infer<typeof studentSchema>) {
    return this.svc.saveStudent(null, body);
  }

  @Put('students/:id')
  updateStudent(@Param('id') sid: string, @Body(new ZodPipe(studentSchema)) body: z.infer<typeof studentSchema>) {
    return this.svc.saveStudent(id(sid), body);
  }

  @Post('students/:id/reject')
  @HttpCode(200)
  reject(@Param('id') sid: string) {
    return this.svc.reject(id(sid));
  }

  @Post('students/:id/enrol')
  @HttpCode(200)
  enrol(@Param('id') sid: string, @Body(new ZodPipe(enrolSchema)) body: z.infer<typeof enrolSchema>) {
    return this.svc.enrol(id(sid), body);
  }

  @Post('students/:id/move')
  @HttpCode(200)
  move(@Param('id') sid: string, @Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>) {
    return this.svc.moveClass(id(sid), body.classId);
  }

  @Post('students/:id/leave')
  @HttpCode(200)
  leave(@Param('id') sid: string, @Body(new ZodPipe(leaveSchema)) body: z.infer<typeof leaveSchema>) {
    return this.svc.leave(id(sid), body);
  }

  @Post('students/:id/discounts')
  @HttpCode(200)
  discount(@Param('id') sid: string, @Body(new ZodPipe(discountSchema)) body: z.infer<typeof discountSchema>) {
    return this.svc.saveDiscount(id(sid), body);
  }

  @Post('students/:id/discounts/remove')
  @HttpCode(200)
  removeDiscount(@Param('id') sid: string, @Body(new ZodPipe(discountSchema)) body: z.infer<typeof discountSchema>) {
    return this.svc.saveDiscount(id(sid), body, true);
  }

  @Post('students/:id/entry-bill')
  @HttpCode(200)
  entry(@Param('id') sid: string, @Body(new ZodPipe(entrySchema)) body: z.infer<typeof entrySchema>) {
    return this.svc.billEntry(id(sid), body.date);
  }

  @Post('students/:id/items')
  @HttpCode(200)
  items(@Param('id') sid: string, @Body(new ZodPipe(itemSchema)) body: z.infer<typeof itemSchema>) {
    return this.svc.sellItems(id(sid), body);
  }

  @Post('bills/:id/cancel')
  @HttpCode(200)
  cancelBill(@Param('id') bid: string) {
    return this.svc.cancelBill(id(bid));
  }

  @Get('billing/preview')
  preview(@Query('period') period?: string) {
    return this.svc.preview(PERIOD.test(period ?? '') ? period! : todayIso().slice(0, 7));
  }

  @Post('billing/run')
  @HttpCode(200)
  run(@Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.svc.run(body);
  }

  @Get('arrears')
  arrears(@Query('asOf') asOf?: string) {
    return this.svc.arrears(new Date(DAY.test(asOf ?? '') ? asOf! : todayIso()));
  }

  @Get('summary')
  summary(@Query('year') year?: string) {
    if (!YEAR.test(year ?? '')) throw new BadRequestException('Give the academic year, e.g. 2026/2027');
    return this.svc.summary(year!);
  }

  @Post('promote')
  @HttpCode(200)
  promote(@Body(new ZodPipe(promoteSchema)) body: z.infer<typeof promoteSchema>) {
    return this.svc.promote(body);
  }
}
