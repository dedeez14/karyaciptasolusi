import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { TicketService } from './ticket.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().max(100).optional(),
  status: z.string().regex(/^[A-Z_,]+$/).max(120).optional(),
  priority: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  assignee: z.union([z.uuid(), z.enum(['me', 'none'])]).optional(),
  customerId: z.uuid().optional(),
  open: z.string().max(1).optional(),
  sla: z.enum(['breached']).optional(),
  sort: z.string().max(20).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

@Controller('helpdesk/tickets')
export class TicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.tickets.list(q);
  }

  @Get('summary')
  summary() {
    return this.tickets.summary();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tickets.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.tickets.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.tickets.update(id, body);
  }

  @Post(':id/move')
  move(@Param('id') id: string, @Body(new ZodPipe(z.object({ statusCode: z.string().trim().min(1).max(50) }))) b: { statusCode: string }) {
    return this.tickets.move(id, b.statusCode);
  }

  @Post(':id/rate')
  rate(@Param('id') id: string, @Body(new ZodPipe(z.object({ satisfaction: z.number().int().min(1).max(5) }))) b: { satisfaction: number }) {
    return this.tickets.rate(id, b.satisfaction);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tickets.remove(id);
  }

  @Post(':id/messages')
  addMessage(@Param('id') id: string, @Body() body: unknown) {
    return this.tickets.addMessage(id, body);
  }

  @Delete(':id/messages/:messageId')
  removeMessage(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.tickets.removeMessage(id, messageId);
  }
}
