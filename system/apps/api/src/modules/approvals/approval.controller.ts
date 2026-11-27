import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { ApprovalService } from './approval.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  tab: z.enum(['waiting', 'mine', 'all']).default('waiting'),
  status: z.string().regex(/^[A-Z_]+$/).max(20).optional(),
  docType: z.string().regex(/^[A-Z_]+$/).max(20).optional(),
  search: z.string().max(100).optional(),
});

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get('requests')
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.approvals.list(q);
  }

  @Get('counts')
  counts() {
    return this.approvals.counts();
  }

  @Post('requests/:id/decide')
  decide(@Param('id') id: string, @Body() body: unknown) {
    return this.approvals.decide(id, body);
  }

  @Post('requests/:id/withdraw')
  withdraw(@Param('id') id: string) {
    return this.approvals.withdraw(id);
  }

  @Get('rules')
  rules() {
    return this.approvals.rules();
  }

  @Get('rules/roles')
  roles() {
    return this.approvals.roleOptions();
  }

  @Post('rules')
  createRule(@Body() body: unknown) {
    return this.approvals.createRule(body);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() body: unknown) {
    return this.approvals.updateRule(id, body);
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string) {
    return this.approvals.removeRule(id);
  }
}
