import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { FileOutputService } from '../files/file-output.service';
import { LeadFinderService, placeListSchema } from './leadfinder.service';

const jobListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']).optional()),
  search: z.string().trim().max(100).optional(),
});
const exportSchema = placeListSchema.extend({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

@Controller('leadfinder')
export class LeadFinderController {
  constructor(
    private readonly finder: LeadFinderService,
    private readonly output: FileOutputService,
  ) {}

  @Get('status')
  status() {
    return this.finder.status();
  }

  @Get('jobs')
  jobs(@Query(new ZodPipe(jobListSchema)) q: z.infer<typeof jobListSchema>) {
    return this.finder.listJobs(q);
  }

  @Activity('leadfinder.search')
  @Post('jobs')
  create(@Body() body: unknown) {
    return this.finder.createJob(body);
  }

  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.finder.getJob(id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.finder.cancelJob(id);
  }

  @Activity('leadfinder.search')
  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    return this.finder.retryJob(id);
  }

  @Delete('jobs/:id')
  remove(@Param('id') id: string) {
    return this.finder.deleteJob(id);
  }

  @Activity('leadfinder.import-file')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024, files: 1 } }))
  importFile(@UploadedFile() file: Express.Multer.File, @Body('name') name?: string) {
    return this.finder.importFile(file, name);
  }

  @Get('places')
  places(@Query(new ZodPipe(placeListSchema)) q: z.infer<typeof placeListSchema>) {
    return this.finder.places(q);
  }

  @Activity('leadfinder.export')
  @Get('places/export')
  async export(@Query(new ZodPipe(exportSchema)) q: z.infer<typeof exportSchema>, @Res() res: Response) {
    await this.output.sendTable(res, await this.finder.exportTable(q), q.format);
  }

  @Activity('leadfinder.add-to-leads')
  @Post('places/leads')
  addToLeads(@Body() body: unknown) {
    return this.finder.addToLeads(body);
  }

  @Post('places/ignore')
  ignore(@Body() body: unknown) {
    return this.finder.setStatus(body, 'IGNORED');
  }

  @Post('places/restore')
  restore(@Body() body: unknown) {
    return this.finder.setStatus(body, 'NEW');
  }

  @Post('places/delete')
  deletePlaces(@Body() body: unknown) {
    return this.finder.deletePlaces(body);
  }
}
