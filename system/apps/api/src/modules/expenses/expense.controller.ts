import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ExpenseService } from './expense.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().max(100).optional(),
  status: z.string().regex(/^[A-Z_,]+$/).max(80).optional(),
  employeeId: z.uuid().optional(),
  mine: z.string().max(1).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

@Controller('expenses')
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.expenses.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.expenses.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.expenses.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.expenses.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.expenses.remove(id);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string) {
    return this.expenses.submit(id);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string) {
    return this.expenses.withdraw(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.expenses.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(1, 'Please give a reason').max(1000) }))) b: { reason: string }) {
    return this.expenses.reject(id, b.reason);
  }

  @Post(':id/pay')
  pay(@Param('id') id: string, @Body() body: unknown) {
    return this.expenses.pay(id, body);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.expenses.cancel(id);
  }
}
