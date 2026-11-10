import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Permission } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { paged } from '../../common/utils/query';
import { MenuService } from './menu.service';

// ============================================================================ Roles & permissions
const roleSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(50).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  dataScope: z.enum(['ALL', 'COMPANY', 'BRANCH', 'OWN']).default('BRANCH'),
  isActive: z.boolean().default(true),
  permissions: z.array(z.string().max(100)).max(2000).default([]),
});

@Controller('system/roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private where(): Prisma.RoleWhereInput {
    return { deletedAt: null, OR: [{ companyId: null }, { companyId: RequestCtx.companyId() }] };
  }

  @Get()
  @Permission('system.role.read')
  async list() {
    const roles = await this.prisma.role.findMany({ where: this.where(), orderBy: { name: 'asc' }, include: { _count: { select: { permissions: true, assignments: true } } } });
    return roles;
  }

  @Get('permissions')
  @Permission('system.role.read')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }] });
  }

  @Get(':id')
  @Permission('system.role.read')
  async get(@Param('id') id: string) {
    const role = await this.prisma.role.findFirst({ where: { ...this.where(), id }, include: { permissions: { include: { permission: { select: { code: true } } } } } });
    if (!role) throw new NotFoundException('Role not found');
    return { ...role, permissions: role.permissions.map((p) => p.permission.code) };
  }

  private async permissionIds(codes: string[]) {
    const perms = await this.prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    // a non super-admin can never grant permissions they do not hold themselves (privilege escalation)
    const u = RequestCtx.user();
    if (!u.isSuperAdmin) {
      const missing = perms.filter((p) => !u.permissions.has(p.code));
      if (missing.length) throw new BadRequestException(`You cannot grant permissions you do not have: ${missing.slice(0, 5).map((m) => m.code).join(', ')}`);
    }
    return perms.map((p) => p.id);
  }

  @Post()
  @Permission('system.role.create')
  async create(@Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>) {
    const ids = await this.permissionIds(body.permissions);
    const { permissions, ...data } = body;
    const role = await this.prisma.role.create({ data: { ...data, companyId: RequestCtx.companyId(), createdById: RequestCtx.user().id, permissions: { create: ids.map((permissionId) => ({ permissionId })) } } });
    await this.audit.record('Role', role.id, 'CREATE', undefined, { ...role, permissions });
    return role;
  }

  @Patch(':id')
  @Permission('system.role.update')
  async update(@Param('id') id: string, @Body(new ZodPipe(roleSchema.partial())) body: Partial<z.infer<typeof roleSchema>>) {
    const before = await this.get(id);
    if (before.isSystem && !RequestCtx.user().isSuperAdmin) throw new ConflictException('System roles can only be changed by a super administrator');
    const { permissions, ...data } = body;
    const role = await this.prisma.$transaction(async (tx) => {
      if (permissions) {
        const ids = await this.permissionIds(permissions);
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
      }
      const r = await tx.role.update({ where: { id }, data: { ...data, updatedById: RequestCtx.user().id } });
      await this.audit.record('Role', id, 'UPDATE', before, { ...r, permissions: permissions ?? before.permissions }, tx);
      return r;
    });
    this.access.invalidateUser();
    return role;
  }

  @Delete(':id')
  @Permission('system.role.delete')
  async remove(@Param('id') id: string) {
    const before = await this.get(id);
    if (before.isSystem) throw new ConflictException('System roles cannot be deleted');
    if (await this.prisma.userAssignment.count({ where: { roleId: id } })) throw new ConflictException('Role is assigned to users');
    await this.prisma.role.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit.record('Role', id, 'DELETE', before);
    this.access.invalidateUser();
    return { success: true };
  }
}

// ============================================================================ Menu management
const menuSchema = z.object({
  parentId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  code: z.string().trim().min(2).max(80).regex(/^[a-z0-9._-]+$/),
  label: z.string().trim().min(1).max(100),
  icon: z.string().trim().max(50).regex(/^[a-z0-9-]*$/).nullable().optional(),
  path: z.string().trim().max(200).regex(/^\/[a-zA-Z0-9/_-]*$/, 'Path must start with / and contain only URL-safe characters').nullable().optional(),
  permissionCode: z.string().trim().max(100).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  isActive: z.boolean().default(true),
});

@Controller('system/menus')
export class MenusController {
  constructor(private readonly prisma: PrismaService, private readonly menus: MenuService, private readonly audit: AuditService) {}

  @Get()
  @Permission('system.menu.read')
  list() {
    return this.prisma.menu.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  }

  @Post()
  @Permission('system.menu.update')
  async create(@Body(new ZodPipe(menuSchema)) body: z.infer<typeof menuSchema>) {
    const m = await this.prisma.menu.create({ data: body });
    await this.audit.record('Menu', m.id, 'CREATE', undefined, m);
    this.menus.invalidate();
    return m;
  }

  @Patch(':id')
  @Permission('system.menu.update')
  async update(@Param('id') id: string, @Body(new ZodPipe(menuSchema.partial())) body: Partial<z.infer<typeof menuSchema>>) {
    const before = await this.prisma.menu.findUniqueOrThrow({ where: { id } });
    if (body.parentId === id) throw new BadRequestException('A menu cannot be its own parent');
    const m = await this.prisma.menu.update({ where: { id }, data: body });
    await this.audit.record('Menu', id, 'UPDATE', before, m);
    this.menus.invalidate();
    return m;
  }

  /** Bulk re-order (drag & drop) */
  @Put('order')
  @Permission('system.menu.update')
  async reorder(@Body(new ZodPipe(z.array(z.object({ id: z.uuid(), parentId: z.uuid().nullable(), sortOrder: z.number().int() })).max(1000))) items: { id: string; parentId: string | null; sortOrder: number }[]) {
    await this.prisma.$transaction(items.map((i) => this.prisma.menu.update({ where: { id: i.id }, data: { parentId: i.parentId, sortOrder: i.sortOrder } })));
    await this.audit.record('Menu', null, 'REORDER', undefined, { count: items.length });
    this.menus.invalidate();
    return { success: true };
  }

  @Delete(':id')
  @Permission('system.menu.update')
  async remove(@Param('id') id: string) {
    if (await this.prisma.menu.count({ where: { parentId: id } })) throw new ConflictException('Remove or move the child menus first');
    const before = await this.prisma.menu.delete({ where: { id } });
    await this.audit.record('Menu', id, 'DELETE', before);
    this.menus.invalidate();
    return { success: true };
  }
}

// ============================================================================ Settings
@Controller('system/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @Get()
  @Permission('system.setting.read')
  list() {
    return this.settings.list(RequestCtx.companyId());
  }

  @Put()
  @Permission('system.setting.update')
  async save(@Body(new ZodPipe(z.object({ values: z.array(z.object({ key: z.string().max(100), value: z.string().max(10000).nullable(), scope: z.enum(['company', 'global']).default('company') })).max(200) }))) body: { values: { key: string; value: string | null; scope: 'company' | 'global' }[] }) {
    const u = RequestCtx.user();
    for (const v of body.values) {
      if (v.scope === 'global' && !u.isSuperAdmin) throw new BadRequestException('Only a super administrator can change global settings');
      await this.settings.set(v.key, v.value, v.scope === 'global' ? null : u.companyId, u.id);
    }
    await this.audit.record('Setting', null, 'UPDATE', undefined, { keys: body.values.map((v) => v.key) });
    return this.settings.list(u.companyId);
  }
}

// ============================================================================ Audit, activity & sessions
const logQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(100).optional(),
  userId: z.uuid().optional(),
  entity: z.string().max(80).optional(),
  action: z.string().max(80).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

@Controller('system')
export class LogsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private range(q: z.infer<typeof logQuery>) {
    return q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to + 'T23:59:59.999Z') } : {}) } } : {};
  }

  @Get('audit-logs')
  @Permission('system.audit.read')
  async auditLogs(@Query(new ZodPipe(logQuery)) q: z.infer<typeof logQuery>) {
    const where: Prisma.AuditLogWhereInput = { companyId: RequestCtx.companyId(), ...this.range(q) };
    if (q.userId) where.userId = q.userId;
    if (q.entity) where.entity = q.entity;
    if (q.action) where.action = q.action;
    if (q.search) where.OR = [{ entityId: q.search }, { username: { contains: q.search, mode: 'insensitive' } }, { entity: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.prisma.auditLog.count({ where })]);
    return paged(rows, total, q);
  }

  @Get('audit-logs/entities')
  @Permission('system.audit.read')
  async entities() {
    const rows = await this.prisma.auditLog.groupBy({ by: ['entity'], where: { companyId: RequestCtx.companyId() }, orderBy: { entity: 'asc' } });
    return rows.map((r) => r.entity);
  }

  @Get('activity-logs')
  @Permission('system.activity.read')
  async activity(@Query(new ZodPipe(logQuery)) q: z.infer<typeof logQuery>) {
    const where: Prisma.ActivityLogWhereInput = { OR: [{ companyId: RequestCtx.companyId() }, { companyId: null }], ...this.range(q) };
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = { startsWith: q.action };
    if (q.search) where.AND = [{ OR: [{ username: { contains: q.search, mode: 'insensitive' } }, { path: { contains: q.search, mode: 'insensitive' } }, { ip: { contains: q.search } }, { action: { contains: q.search, mode: 'insensitive' } }] }];
    const [rows, total] = await Promise.all([this.prisma.activityLog.findMany({ where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.prisma.activityLog.count({ where })]);
    return paged(rows, total, q);
  }

  @Get('sessions')
  @Permission('system.session.read')
  async sessions() {
    const u = RequestCtx.user();
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() }, ...(u.isSuperAdmin ? {} : { user: { assignments: { some: { companyId: u.companyId } } } }) },
      include: { user: { select: { username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(({ tokenHash, ...r }) => r);
  }

  @Post('sessions/:id/revoke')
  @Permission('system.session.revoke')
  async revoke(@Param('id') id: string) {
    const s = await this.prisma.session.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Session not found');
    await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record('Session', id, 'REVOKE', undefined, { userId: s.userId });
    return { success: true };
  }
}
