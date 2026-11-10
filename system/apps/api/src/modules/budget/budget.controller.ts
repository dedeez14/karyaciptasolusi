import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { BudgetService } from './budget.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z
    .string()
    .regex(/^[A-Z_]+$/)
    .max(30)
    .optional(),
});
const vsSchema = z.object({
  through: z.coerce.number().int().min(1).max(12).optional(),
});

@Controller('budgets')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.budgets.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.budgets.get(id);
  }

  @Get(':id/vs-actual')
  vsActual(@Param('id') id: string, @Query(new ZodPipe(vsSchema)) q: z.infer<typeof vsSchema>) {
    return this.budgets.vsActual(id, q.through);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.budgets.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.budgets.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.budgets.remove(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.budgets.approve(id);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) {
    return this.budgets.reopen(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.budgets.close(id);
  }

  @Post(':id/copy')
  copy(@Param('id') id: string, @Body() body: unknown) {
    return this.budgets.copy(id, body);
  }
}
