import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { JournalService } from './journal.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().max(100).optional(),
  status: z.enum(['DRAFT', 'POSTED', 'VOID']).optional(),
  sourceType: z.string().max(30).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});
const createSchema = z.object({
  date: z.coerce.date(),
  description: z.string().trim().min(1).max(500),
  reference: z.string().trim().max(100).nullable().optional(),
  post: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        debit: z.coerce.number().min(0).default(0),
        credit: z.coerce.number().min(0).default(0),
        description: z.string().max(500).nullable().optional(),
        costCenterId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
        projectId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
      }),
    )
    .min(2)
    .max(200)
    .refine((ls) => ls.every((l) => (l.debit > 0) !== (l.credit > 0)), 'Each line needs either a debit or a credit'),
});

@Controller('journals')
export class JournalController {
  constructor(private readonly journals: JournalService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.journals.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.journals.get(id);
  }

  @Post()
  create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.journals.createManual(body);
  }

  @Post(':id/post')
  post(@Param('id') id: string) {
    return this.journals.postDraft(id);
  }

  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.journals.voidManual(id);
  }
}
