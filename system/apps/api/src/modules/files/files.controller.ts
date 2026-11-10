import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Activity } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { env } from '../../config/env';
import { FilesService } from './files.service';
import { FileOutputService } from './file-output.service';

const uuidOrNull = z.preprocess((v) => (v === '' || v === 'root' ? null : v), z.uuid().nullable().optional());
const folderSchema = z.object({
  name: z.string().trim().min(1).max(150).regex(/^[^\\/<>:"|?*\u0000-\u001f]+$/, 'Invalid folder name'),
  parentId: uuidOrNull,
  color: z.string().max(20).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  folderId: uuidOrNull,
  categoryCode: z.string().max(50).nullable().optional(),
  tags: z.array(z.string().trim().max(50)).max(30).optional(),
  description: z.string().max(1000).nullable().optional(),
});
const bulkSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  action: z.enum(['move', 'delete', 'tag']),
  folderId: uuidOrNull,
  tags: z.array(z.string().trim().max(50)).max(30).optional(),
});
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
  search: z.string().max(100).optional(),
  folderId: z.string().max(40).optional(),
  type: z.string().max(20).optional(),
  categoryCode: z.string().max(50).optional(),
  tag: z.string().max(50).optional(),
  source: z.enum(['UPLOAD', 'GENERATED', 'EXPORT']).optional(),
  uploadedBy: z.uuid().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.uuid().optional(),
  sort: z.enum(['name', 'size', 'createdAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService, private readonly output: FileOutputService) {}

  @Get('folders')
  folders() {
    return this.files.folders();
  }

  @Post('folders')
  createFolder(@Body(new ZodPipe(folderSchema)) body: z.infer<typeof folderSchema>) {
    return this.files.createFolder(body);
  }

  @Patch('folders/:id')
  updateFolder(@Param('id') id: string, @Body(new ZodPipe(folderSchema.partial())) body: Partial<z.infer<typeof folderSchema>>) {
    return this.files.updateFolder(id, body);
  }

  @Delete('folders/:id')
  deleteFolder(@Param('id') id: string) {
    return this.files.deleteFolder(id);
  }

  @Get()
  list(@Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.files.list(q as any);
  }

  @Get('stats')
  stats() {
    return this.files.stats();
  }

  @Get('tags')
  tags() {
    return this.files.tags();
  }

  @Get('groups/:by')
  groups(@Param('by') by: string, @Query(new ZodPipe(listSchema.partial())) q: Partial<z.infer<typeof listSchema>>) {
    return this.files.groups(by, q as any);
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 20, fields: 20 } }))
  async upload(@UploadedFiles() uploads: Express.Multer.File[], @Body() body: Record<string, string>) {
    if (!uploads?.length) throw new BadRequestException('No file uploaded');
    const meta = z
      .object({ folderId: uuidOrNull, categoryCode: z.string().max(50).optional(), tags: z.string().max(500).optional(), description: z.string().max(1000).optional(), entityType: z.string().max(50).optional(), entityId: z.uuid().optional() })
      .parse(body);
    const out = [];
    for (const f of uploads) {
      out.push(
        await this.files.store({
          buffer: f.buffer,
          originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          mimeType: f.mimetype,
          folderId: meta.folderId,
          categoryCode: meta.categoryCode,
          tags: meta.tags?.split(','),
          description: meta.description,
          entityType: meta.entityType,
          entityId: meta.entityId,
        }),
      );
    }
    return out;
  }

  @Post('bulk')
  bulk(@Body(new ZodPipe(bulkSchema)) body: z.infer<typeof bulkSchema>) {
    return this.files.bulk(body.ids, body.action, { folderId: body.folderId, tags: body.tags });
  }

  @Activity('file.download')
  @Get(':id/download')
  async download(@Param('id') id: string, @Query('inline') inline: string, @Res() res: Response) {
    const { file, data } = await this.files.content(id);
    // only safe passive types may be shown inline (never HTML/SVG)
    const canInline = inline === '1' && (file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf' || file.mimeType === 'text/plain');
    if (!canInline) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    this.output.send(res, data, file.name, file.mimeType, canInline);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.files.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.files.remove(id);
  }
}
