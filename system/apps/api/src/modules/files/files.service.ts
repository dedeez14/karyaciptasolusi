import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { FileSource, Prisma } from '@prisma/client';
import { extname } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { RequestCtx } from '../../common/context/request-context';
import { paged } from '../../common/utils/query';
import { env } from '../../config/env';
import { StorageService } from './storage.service';
import { sniffMime } from './mime';

export interface FileListQuery {
  page: number;
  pageSize: number;
  search?: string;
  folderId?: string; // 'root' = no folder
  type?: string; // image | pdf | document | spreadsheet | presentation | archive | other
  categoryCode?: string;
  tag?: string;
  source?: FileSource;
  uploadedBy?: string;
  from?: string;
  to?: string;
  entityType?: string;
  entityId?: string;
  sort?: 'name' | 'size' | 'createdAt';
  order?: 'asc' | 'desc';
}

const TYPE_GROUPS: Record<string, string[]> = {
  image: ['image/'],
  pdf: ['application/pdf'],
  document: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml', 'application/vnd.oasis.opendocument.text', 'text/plain', 'application/rtf'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml', 'text/csv', 'application/vnd.oasis.opendocument.spreadsheet'],
  presentation: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml'],
  archive: ['application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed', 'application/gzip'],
};

export function fileTypeOf(mime: string): string {
  for (const [group, prefixes] of Object.entries(TYPE_GROUPS)) if (prefixes.some((p) => mime.startsWith(p))) return group;
  return 'other';
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  // ---------------------------------------------------------------- folders
  async folders() {
    RequestCtx.assert('files.file.read');
    const companyId = RequestCtx.companyId();
    const [folders, counts] = await Promise.all([
      this.prisma.fileFolder.findMany({ where: { companyId, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.storedFile.groupBy({ by: ['folderId'], where: { companyId, deletedAt: null }, _count: { _all: true }, _sum: { size: true } }),
    ]);
    const stat = new Map(counts.map((c) => [c.folderId ?? 'root', { files: c._count._all, size: c._sum.size ?? 0 }]));
    return {
      root: stat.get('root') ?? { files: 0, size: 0 },
      folders: folders.map((f) => ({ ...f, ...(stat.get(f.id) ?? { files: 0, size: 0 }) })),
    };
  }

  private async ownFolder(id: string | null | undefined) {
    if (!id) return null;
    const f = await this.prisma.fileFolder.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!f) throw new NotFoundException('Folder not found');
    return f;
  }

  async createFolder(data: { name: string; parentId?: string | null; color?: string | null; description?: string | null }) {
    RequestCtx.assert('files.folder.manage');
    await this.ownFolder(data.parentId);
    const u = RequestCtx.user();
    const row = await this.prisma.fileFolder.create({ data: { ...data, companyId: u.companyId, createdById: u.id } });
    await this.audit.record('FileFolder', row.id, 'CREATE', undefined, row);
    return row;
  }

  async updateFolder(id: string, data: { name?: string; parentId?: string | null; color?: string | null; description?: string | null }) {
    RequestCtx.assert('files.folder.manage');
    const before = await this.ownFolder(id);
    if (data.parentId) {
      // prevent cycles
      let cursor: string | null = data.parentId;
      while (cursor) {
        if (cursor === id) throw new BadRequestException('A folder cannot be moved into itself');
        cursor = (await this.ownFolder(cursor))?.parentId ?? null;
      }
    }
    const row = await this.prisma.fileFolder.update({ where: { id }, data: { ...data, updatedById: RequestCtx.user().id } });
    await this.audit.record('FileFolder', id, 'UPDATE', before, row);
    return row;
  }

  async deleteFolder(id: string) {
    RequestCtx.assert('files.folder.manage');
    const before = await this.ownFolder(id);
    const [files, children] = await Promise.all([
      this.prisma.storedFile.count({ where: { folderId: id, deletedAt: null } }),
      this.prisma.fileFolder.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (files || children) throw new ConflictException('Folder is not empty');
    await this.prisma.fileFolder.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record('FileFolder', id, 'DELETE', before);
    return { success: true };
  }

  // ---------------------------------------------------------------- files
  private where(q: Partial<FileListQuery>): Prisma.StoredFileWhereInput {
    const where: Prisma.StoredFileWhereInput = { ...(this.access.scopeWhere({ branchField: 'branchId' }) as Prisma.StoredFileWhereInput), deletedAt: null };
    const and: Prisma.StoredFileWhereInput[] = [];
    if (q.folderId === 'root') where.folderId = null;
    else if (q.folderId) where.folderId = q.folderId;
    if (q.search) and.push({ OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }, { tags: { has: q.search.toLowerCase() } }] });
    if (q.type) {
      if (q.type === 'other') and.push({ NOT: { OR: Object.values(TYPE_GROUPS).flat().map((p) => ({ mimeType: { startsWith: p } })) } });
      else if (TYPE_GROUPS[q.type]) and.push({ OR: TYPE_GROUPS[q.type].map((p) => ({ mimeType: { startsWith: p } })) });
    }
    if (q.categoryCode) where.categoryCode = q.categoryCode;
    if (q.tag) where.tags = { has: q.tag.toLowerCase() };
    if (q.source) where.source = q.source;
    if (q.uploadedBy) where.createdById = q.uploadedBy;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59') } : {}) };
    if (and.length) where.AND = and;
    return where;
  }

  async list(q: FileListQuery) {
    RequestCtx.assert('files.file.read');
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      this.prisma.storedFile.findMany({ where, orderBy: { [q.sort ?? 'createdAt']: q.order ?? 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.storedFile.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean) as string[])] } }, select: { id: true, fullName: true } });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return paged(
      rows.map(({ storageKey, checksum, ...r }) => ({ ...r, fileType: fileTypeOf(r.mimeType), uploadedBy: names.get(r.createdById ?? '') ?? null })),
      total,
      q,
    );
  }

  /** Grouped statistics (by type / month / category / folder / source) honouring active filters */
  async groups(by: string, q: Partial<FileListQuery>) {
    RequestCtx.assert('files.file.read');
    const where = this.where(q);
    if (by === 'type') {
      const rows = await this.prisma.storedFile.groupBy({ by: ['mimeType'], where, _count: { _all: true }, _sum: { size: true } });
      const agg = new Map<string, { key: string; files: number; size: number }>();
      for (const r of rows) {
        const k = fileTypeOf(r.mimeType);
        const a = agg.get(k) ?? { key: k, files: 0, size: 0 };
        a.files += r._count._all;
        a.size += r._sum.size ?? 0;
        agg.set(k, a);
      }
      return [...agg.values()].sort((a, b) => b.files - a.files);
    }
    if (by === 'month') {
      const rows = await this.prisma.storedFile.findMany({ where, select: { createdAt: true, size: true } });
      const agg = new Map<string, { key: string; files: number; size: number }>();
      for (const r of rows) {
        const k = r.createdAt.toISOString().slice(0, 7);
        const a = agg.get(k) ?? { key: k, files: 0, size: 0 };
        a.files++;
        a.size += r.size;
        agg.set(k, a);
      }
      return [...agg.values()].sort((a, b) => b.key.localeCompare(a.key));
    }
    const field = ({ category: 'categoryCode', folder: 'folderId', source: 'source', uploader: 'createdById' } as const)[by as 'category'];
    if (!field) throw new BadRequestException('Unsupported grouping');
    const rows = await this.prisma.storedFile.groupBy({ by: [field], where, _count: { _all: true }, _sum: { size: true } });
    return rows.map((r: any) => ({ key: r[field] ?? 'none', files: r._count._all, size: r._sum.size ?? 0 })).sort((a, b) => b.files - a.files);
  }

  async tags() {
    RequestCtx.assert('files.file.read');
    const rows = await this.prisma.$queryRaw<{ tag: string; n: bigint }[]>`
      SELECT unnest(tags) AS tag, count(*) AS n FROM stored_files
      WHERE "companyId" = ${RequestCtx.companyId()}::uuid AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 100`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
  }

  private async policy() {
    const companyId = RequestCtx.companyId();
    return {
      maxBytes: (await this.settings.num('files.maxUploadMb', companyId, env.MAX_UPLOAD_MB)) * 1024 * 1024,
      allowed: (await this.settings.str('files.allowedExtensions', companyId, 'pdf,png,jpg,jpeg,gif,webp,doc,docx,xls,xlsx,csv,ppt,pptx,txt,zip'))
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      encrypt: await this.settings.bool('files.encryptAtRest', companyId, true),
    };
  }

  /** Sanitises a client supplied file name (no paths, control chars or reserved characters) */
  private cleanName(name: string) {
    const base = name.split(/[\\/]/).pop() ?? 'file';
    return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'file';
  }

  async store(input: {
    buffer: Buffer;
    originalName: string;
    mimeType?: string;
    folderId?: string | null;
    categoryCode?: string | null;
    tags?: string[];
    description?: string | null;
    source?: FileSource;
    entityType?: string | null;
    entityId?: string | null;
    skipPolicy?: boolean;
  }) {
    const u = RequestCtx.user();
    await this.ownFolder(input.folderId);
    const originalName = this.cleanName(input.originalName);
    const ext = extname(originalName).slice(1).toLowerCase();
    const p = await this.policy();
    if (!input.skipPolicy) {
      if (!p.allowed.includes(ext)) throw new BadRequestException(`File type .${ext || '?'} is not allowed`);
      if (input.buffer.length > p.maxBytes) throw new PayloadTooLargeException(`File exceeds ${Math.round(p.maxBytes / 1048576)} MB`);
    }
    // trust the content, not the client: detect type from magic bytes
    const sniffed = sniffMime(input.buffer, ext);
    if (sniffed === 'blocked') throw new BadRequestException('Executable or script content is not allowed');
    const mimeType = sniffed ?? input.mimeType ?? 'application/octet-stream';
    const storageKey = await this.storage.put(u.companyId, input.buffer, p.encrypt);
    const row = await this.prisma.storedFile.create({
      data: {
        companyId: u.companyId,
        branchId: u.branchId,
        folderId: input.folderId ?? null,
        name: originalName,
        originalName,
        mimeType,
        extension: ext,
        size: input.buffer.length,
        checksum: this.crypto.sha256(input.buffer),
        storageKey,
        isEncrypted: p.encrypt,
        categoryCode: input.categoryCode ?? null,
        tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30),
        description: input.description ?? null,
        source: input.source ?? 'UPLOAD',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        createdById: u.id,
      },
    });
    await this.audit.record('File', row.id, input.source === 'UPLOAD' || !input.source ? 'UPLOAD' : input.source, undefined, { name: row.name, size: row.size, folderId: row.folderId });
    const { storageKey: _k, checksum: _c, ...safe } = row;
    return { ...safe, fileType: fileTypeOf(row.mimeType) };
  }

  private async own(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('File not found');
    const f = await this.prisma.storedFile.findFirst({ where: { ...this.where({}), id } });
    if (!f) throw new NotFoundException('File not found');
    return f;
  }

  async content(id: string) {
    RequestCtx.assert('files.file.download');
    const f = await this.own(id);
    const data = await this.storage.get(f.storageKey, f.isEncrypted);
    if (this.crypto.sha256(data) !== f.checksum) throw new ConflictException('File integrity check failed');
    this.audit.activity('file.download', { fileId: f.id, name: f.name });
    return { file: f, data };
  }

  async update(id: string, data: { name?: string; folderId?: string | null; categoryCode?: string | null; tags?: string[]; description?: string | null }) {
    RequestCtx.assert('files.file.update');
    const before = await this.own(id);
    if (data.folderId !== undefined) await this.ownFolder(data.folderId);
    if (data.name) {
      const ext = extname(before.name);
      data.name = this.cleanName(data.name);
      if (extname(data.name).toLowerCase() !== ext.toLowerCase()) data.name += ext; // keep the real extension
    }
    if (data.tags) data.tags = [...new Set(data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
    const row = await this.prisma.storedFile.update({ where: { id }, data: { ...data, updatedById: RequestCtx.user().id } });
    await this.audit.record('File', id, 'UPDATE', before, row);
    return row;
  }

  async bulk(ids: string[], action: 'move' | 'delete' | 'tag', payload: { folderId?: string | null; tags?: string[] }) {
    RequestCtx.assert(action === 'delete' ? 'files.file.delete' : 'files.file.update');
    const files = await this.prisma.storedFile.findMany({ where: { ...this.where({}), id: { in: ids.slice(0, 500) } } });
    if (action === 'move') {
      await this.ownFolder(payload.folderId);
      await this.prisma.storedFile.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { folderId: payload.folderId ?? null } });
    } else if (action === 'delete') {
      await this.prisma.storedFile.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { deletedAt: new Date() } });
    } else {
      for (const f of files) {
        await this.prisma.storedFile.update({ where: { id: f.id }, data: { tags: [...new Set([...f.tags, ...(payload.tags ?? []).map((t) => t.toLowerCase())])].slice(0, 30) } });
      }
    }
    await this.audit.record('File', null, `BULK_${action.toUpperCase()}`, undefined, { ids: files.map((f) => f.id), ...payload });
    return { affected: files.length };
  }

  async remove(id: string) {
    RequestCtx.assert('files.file.delete');
    const before = await this.own(id);
    await this.prisma.storedFile.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record('File', id, 'DELETE', before);
    return { success: true };
  }

  async stats() {
    RequestCtx.assert('files.file.read');
    const where = this.where({});
    const agg = await this.prisma.storedFile.aggregate({ where, _count: { _all: true }, _sum: { size: true } });
    return { files: agg._count._all, size: agg._sum.size ?? 0, byType: await this.groups('type', {}) };
  }
}
