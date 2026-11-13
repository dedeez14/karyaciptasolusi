import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { TaskService } from './task.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().max(100).optional(),
  projectId: z.uuid().optional(),
  assigneeId: z.union([z.uuid(), z.literal('none')]).optional(),
  stageId: z.uuid().optional(),
  priorityCode: z.string().max(50).optional(),
  tag: z.string().max(40).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
  mine: z.string().max(1).optional(),
  status: z.enum(['open', 'done']).optional(),
  sort: z.string().max(20).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

@Controller('tasks')
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.tasks.list(q as any);
  }

  @Get('stages')
  stages() {
    return this.tasks.stages();
  }

  @Get('summary')
  summary() {
    return this.tasks.summary();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tasks.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.tasks.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.tasks.update(id, body);
  }

  @Post(':id/move')
  move(@Param('id') id: string, @Body(new ZodPipe(z.object({ stageId: z.uuid(), position: z.number().finite() }))) b: { stageId: string; position: number }) {
    return this.tasks.move(id, b.stageId, b.position);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tasks.remove(id);
  }

  @Post(':id/checklist')
  addChecklist(@Param('id') id: string, @Body(new ZodPipe(z.object({ title: z.string().trim().min(1).max(250) }))) b: { title: string }) {
    return this.tasks.addChecklist(id, b.title);
  }

  @Patch(':id/checklist/:itemId')
  updateChecklist(@Param('id') id: string, @Param('itemId') itemId: string, @Body(new ZodPipe(z.object({ title: z.string().trim().min(1).max(250).optional(), isDone: z.boolean().optional() }))) b: { title?: string; isDone?: boolean }) {
    return this.tasks.updateChecklist(id, itemId, b);
  }

  @Delete(':id/checklist/:itemId')
  removeChecklist(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.tasks.removeChecklist(id, itemId);
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body(new ZodPipe(z.object({ body: z.string().trim().min(1).max(5000) }))) b: { body: string }) {
    return this.tasks.addComment(id, b.body);
  }

  @Delete(':id/comments/:commentId')
  removeComment(@Param('id') id: string, @Param('commentId') commentId: string) {
    return this.tasks.removeComment(id, commentId);
  }

  @Post(':id/time')
  logTime(@Param('id') id: string, @Body(new ZodPipe(z.object({ date: z.coerce.date(), hours: z.coerce.number().positive().max(24), note: z.string().trim().max(500).nullable().optional() }))) b: { date: Date; hours: number; note?: string | null }) {
    return this.tasks.logTime(id, b);
  }

  @Delete(':id/time/:logId')
  removeTime(@Param('id') id: string, @Param('logId') logId: string) {
    return this.tasks.removeTime(id, logId);
  }
}
