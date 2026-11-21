import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PNG } from 'pngjs';
import { RequestCtx } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../files/storage.service';

const MAX_BYTES = 1024 * 1024;

/**
 * The signed-in user's own signature (My Profile). Stored encrypted, never listed in the File Manager, and only
 * placed on documents while the owner keeps "use on documents" switched on.
 */
@Controller('auth/me/signature')
export class SignatureController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get() {
    const u = await this.prisma.user.findUnique({ where: { id: RequestCtx.user().id }, select: { signatureKey: true, signatureEnabled: true, signatureUpdatedAt: true } });
    if (!u?.signatureKey) return { signature: null, enabled: false, updatedAt: null };
    const data = await this.storage.get(u.signatureKey, true).catch(() => null);
    return { signature: data ? `data:image/png;base64,${data.toString('base64')}` : null, enabled: u.signatureEnabled, updatedAt: u.signatureUpdatedAt };
  }

  /** PNG only (the page turns any photo into a transparent PNG first); decoded and re-encoded to drop metadata */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('enabled') enabled?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image of your signature');
    const b = file.buffer;
    if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) throw new BadRequestException('The signature must be a PNG image');
    let png: PNG;
    try {
      png = PNG.sync.read(b);
    } catch {
      throw new BadRequestException('The image could not be read');
    }
    if (png.width < 40 || png.height < 20 || png.width > 2400 || png.height > 1200) throw new BadRequestException('The signature image should be between 40×20 and 2400×1200 pixels');
    const clean = PNG.sync.write(png, { colorType: 6 });
    const u = RequestCtx.user();
    const before = await this.prisma.user.findUnique({ where: { id: u.id }, select: { signatureKey: true } });
    const key = await this.storage.put(u.companyId, clean, true);
    await this.prisma.user.update({ where: { id: u.id }, data: { signatureKey: key, signatureEnabled: enabled === undefined ? true : enabled === 'true', signatureUpdatedAt: new Date() } });
    if (before?.signatureKey) await this.storage.remove(before.signatureKey).catch(() => undefined);
    await this.audit.record('User', u.id, 'SIGNATURE_UPDATED', undefined, { width: png.width, height: png.height });
    return this.get();
  }

  @Patch()
  async toggle(@Body() body: { enabled?: boolean }) {
    const u = RequestCtx.user();
    const row = await this.prisma.user.findUnique({ where: { id: u.id }, select: { signatureKey: true } });
    if (!row?.signatureKey) throw new BadRequestException('Upload your signature first');
    await this.prisma.user.update({ where: { id: u.id }, data: { signatureEnabled: !!body?.enabled } });
    await this.audit.record('User', u.id, body?.enabled ? 'SIGNATURE_ENABLED' : 'SIGNATURE_DISABLED');
    return this.get();
  }

  @Delete()
  async remove() {
    const u = RequestCtx.user();
    const row = await this.prisma.user.findUnique({ where: { id: u.id }, select: { signatureKey: true } });
    if (row?.signatureKey) await this.storage.remove(row.signatureKey).catch(() => undefined);
    await this.prisma.user.update({ where: { id: u.id }, data: { signatureKey: null, signatureEnabled: false, signatureUpdatedAt: new Date() } });
    await this.audit.record('User', u.id, 'SIGNATURE_REMOVED');
    return { signature: null, enabled: false, updatedAt: null };
  }
}
