import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Permission } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { parseListQuery, paged } from '../../common/utils/query';
import { AuthService } from '../auth/auth.service';

const assignment = z.object({ companyId: z.uuid(), branchId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()), roleId: z.uuid() });
const baseUser = {
  username: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore'),
  email: z.email().trim().toLowerCase().max(150),
  fullName: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().default(true),
  isSuperAdmin: z.boolean().default(false),
  mustChangePassword: z.boolean().default(true),
  defaultCompanyId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  defaultBranchId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  assignments: z.array(assignment).max(100).default([]),
};
const createSchema = z.object({ ...baseUser, password: z.string().min(1).max(200) });
const updateSchema = z.object(baseUser).partial();
const resetSchema = z.object({ password: z.string().min(1).max(200) });

const SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  phone: true,
  isActive: true,
  isSuperAdmin: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lastLoginIp: true,
  lockedUntil: true,
  defaultCompanyId: true,
  defaultBranchId: true,
  createdAt: true,
  assignments: { select: { id: true, companyId: true, branchId: true, roleId: true, company: { select: { name: true } }, branch: { select: { name: true } }, role: { select: { name: true } } } },
} satisfies Prisma.UserSelect;

@Controller('system/users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** Non super-admins only see / manage users of their current company */
  private scope(): Prisma.UserWhereInput {
    const u = RequestCtx.user();
    return { deletedAt: null, ...(u.isSuperAdmin ? {} : { assignments: { some: { companyId: u.companyId } } }) };
  }

  private async guardAssignments(assignments: z.infer<typeof assignment>[], wantsSuper?: boolean) {
    const u = RequestCtx.user();
    if (wantsSuper && !u.isSuperAdmin) throw new BadRequestException('Only a super administrator can grant super administrator rights');
    for (const a of assignments) {
      if (!u.isSuperAdmin && a.companyId !== u.companyId) throw new BadRequestException('You can only assign access to your current company');
      const role = await this.prisma.role.findFirst({ where: { id: a.roleId, deletedAt: null, OR: [{ companyId: null }, { companyId: a.companyId }] } });
      if (!role) throw new BadRequestException('Invalid role');
      if (a.branchId && !(await this.prisma.branch.findFirst({ where: { id: a.branchId, companyId: a.companyId } }))) throw new BadRequestException('Invalid branch');
    }
  }

  private present(user: any) {
    return { ...user, phone: this.crypto.decrypt(user.phone) };
  }

  @Get()
  @Permission('system.user.read')
  async list(@Query() query: Record<string, unknown>) {
    const q = parseListQuery(query);
    const where: Prisma.UserWhereInput = { ...this.scope() };
    if (q.search) where.OR = [{ username: { contains: q.search, mode: 'insensitive' } }, { fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }];
    if (q.filters.isActive) where.isActive = q.filters.isActive === 'true';
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: SELECT, orderBy: { fullName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return paged(rows.map((r) => this.present(r)), total, q);
  }

  @Get(':id')
  @Permission('system.user.read')
  async get(@Param('id') id: string) {
    const user = await this.prisma.user.findFirst({ where: { ...this.scope(), id }, select: SELECT });
    if (!user) throw new NotFoundException('User not found');
    return this.present(user);
  }

  @Post()
  @Permission('system.user.create')
  async create(@Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    await this.guardAssignments(body.assignments, body.isSuperAdmin);
    await this.auth.validatePasswordPolicy(body.password);
    const { assignments, password, ...data } = body;
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { ...data, phone: this.crypto.encrypt(data.phone), passwordHash: await this.crypto.hashPassword(password), passwordChangedAt: new Date(), createdById: RequestCtx.user().id, assignments: { create: assignments } },
        select: SELECT,
      });
      await this.audit.record('User', u.id, 'CREATE', undefined, u, tx);
      return u;
    });
    return this.present(user);
  }

  @Patch(':id')
  @Permission('system.user.update')
  async update(@Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const before = await this.get(id);
    const me = RequestCtx.user();
    if (body.isSuperAdmin !== undefined && body.isSuperAdmin !== before.isSuperAdmin && !me.isSuperAdmin) throw new BadRequestException('Only a super administrator can change super administrator rights');
    if (id === me.id && body.isActive === false) throw new ConflictException('You cannot deactivate your own account');
    if (body.assignments) await this.guardAssignments(body.assignments, body.isSuperAdmin);
    const { assignments, ...data } = body;
    const user = await this.prisma.$transaction(async (tx) => {
      if (assignments) {
        // non super-admins only replace assignments of their own company
        await tx.userAssignment.deleteMany({ where: { userId: id, ...(me.isSuperAdmin ? {} : { companyId: me.companyId }) } });
        await tx.userAssignment.createMany({ data: assignments.map((a) => ({ ...a, userId: id })) });
      }
      const u = await tx.user.update({ where: { id }, data: { ...data, ...(data.phone !== undefined ? { phone: this.crypto.encrypt(data.phone) } : {}), updatedById: me.id }, select: SELECT });
      await this.audit.record('User', id, 'UPDATE', before, u, tx);
      return u;
    });
    if (body.isActive === false) await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    this.access.invalidateUser(id);
    return this.present(user);
  }

  @Post(':id/reset-password')
  @Permission('system.user.reset-password')
  async resetPassword(@Param('id') id: string, @Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>) {
    const before = await this.get(id);
    if (before.isSuperAdmin && !RequestCtx.user().isSuperAdmin) throw new BadRequestException('Not allowed');
    await this.auth.validatePasswordPolicy(body.password);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await this.crypto.hashPassword(body.password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: new Date() } });
    await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record('User', id, 'RESET_PASSWORD');
    this.access.invalidateUser(id);
    return { success: true };
  }

  @Post(':id/unlock')
  @Permission('system.user.update')
  async unlock(@Param('id') id: string) {
    await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.audit.record('User', id, 'UNLOCK');
    this.access.invalidateUser(id);
    return { success: true };
  }

  @Delete(':id')
  @Permission('system.user.delete')
  async remove(@Param('id') id: string) {
    if (id === RequestCtx.user().id) throw new ConflictException('You cannot delete your own account');
    const before = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, username: `${before.username}#${Date.now().toString(36)}`.slice(0, 50), email: `deleted+${Date.now()}+${before.email}`.slice(0, 150) } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record('User', id, 'DELETE', before, undefined, tx);
    });
    this.access.invalidateUser(id);
    return { success: true };
  }
}
