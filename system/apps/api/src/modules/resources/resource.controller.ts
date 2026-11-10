import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Activity } from '../../common/decorators';
import { parseListQuery } from '../../common/utils/query';
import { ResourceService } from './resource.service';
import { FileOutputService } from '../files/file-output.service';
import { ResourceImportService } from './resource.import';

const KEY = /^[a-z0-9-]{2,40}$/;

@Controller()
export class ResourceController {
  constructor(private readonly svc: ResourceService, private readonly output: FileOutputService, private readonly importer: ResourceImportService) {}

  @Get('meta/resources')
  metaList() {
    return this.svc.metaList();
  }

  @Get('meta/resources/:key')
  meta(@Param('key') key: string) {
    return this.svc.meta(this.svc.def(key));
  }

  @Get('lookups')
  lookups(@Query('categories') categories = '') {
    return this.svc.lookups(categories.split(',').filter((c) => /^[A-Z0-9_]{1,50}$/.test(c)));
  }

  @Get('resources/:key')
  list(@Param('key') key: string, @Query() q: Record<string, unknown>) {
    return this.svc.list(key, parseListQuery(q));
  }

  @Get('resources/:key/options')
  options(@Param('key') key: string, @Query('search') search?: string, @Query('ids') ids?: string) {
    return this.svc.options(key, search?.slice(0, 100), ids ? ids.split(',') : undefined);
  }

  @Activity('resource.export')
  @Get('resources/:key/export')
  async export(@Param('key') key: string, @Query() q: Record<string, unknown>, @Res() res: Response) {
    const table = await this.svc.exportRows(key, parseListQuery(q));
    await this.output.sendTable(res, table, String(q.format ?? 'xlsx'), String(q.save ?? '') === '1');
  }

  @Activity('resource.import-template')
  @Get('resources/:key/import-template')
  async importTemplate(@Param('key') key: string, @Query('format') format: string, @Res() res: Response) {
    await this.output.sendTable(res, this.importer.template(key), format === 'csv' ? 'csv' : 'xlsx');
  }

  /** Bulk import from Excel / CSV (same validation, permissions and audit trail as the form) */
  @Post('resources/:key/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  importFile(@Param('key') key: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importer.import(key, file.buffer, file.originalname);
  }

  @Get('resources/:key/:id')
  get(@Param('key') key: string, @Param('id') id: string) {
    return this.svc.get(key, id);
  }

  @Post('resources/:key')
  create(@Param('key') key: string, @Body() body: unknown) {
    return this.svc.create(key, body);
  }

  @Patch('resources/:key/:id')
  update(@Param('key') key: string, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(key, id, body);
  }

  @Delete('resources/:key/:id')
  remove(@Param('key') key: string, @Param('id') id: string) {
    return this.svc.remove(key, id);
  }
}

export { KEY };
