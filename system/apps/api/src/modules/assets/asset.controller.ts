import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { AssetService } from './asset.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(100).optional(),
  status: z
    .string()
    .regex(/^[A-Z_]+$/)
    .max(30)
    .optional(),
  category: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(50)
    .optional(),
  sort: z.string().max(30).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
const periodSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM'),
});
const runSchema = periodSchema.extend({
  assetIds: z.array(z.uuid()).max(1000).optional(),
});

@Controller('assets')
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.assets.list(q);
  }

  @Get('depreciation/preview')
  preview(@Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    return this.assets.preview(q.period);
  }

  @Activity('assets.depreciate')
  @Post('depreciation/run')
  run(@Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.assets.runForUser(body.period, body.assetIds);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.assets.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.assets.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.assets.remove(id);
  }

  @Activity('assets.dispose')
  @Post(':id/dispose')
  dispose(@Param('id') id: string, @Body() body: unknown) {
    return this.assets.dispose(id, body);
  }
}
