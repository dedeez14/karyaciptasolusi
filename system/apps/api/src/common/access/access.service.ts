import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { DataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryCache } from '../cache/memory-cache';
import { AuthUser, RequestCtx } from '../context/request-context';

const SCOPE_RANK: Record<DataScope, number> = { OWN: 0, BRANCH: 1, COMPANY: 2, ALL: 3 };

/**
 * Resolves the effective access profile (RBAC + ACL) of a user for a company/branch.
 * Results are cached briefly and invalidated whenever users/roles/assignments change.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService, private readonly cache: MemoryCache) {}

  invalidateUser(userId?: string) {
    if (userId) {
      this.cache.invalidate(`user:${userId}`);
      this.cache.invalidate(`acl:${userId}`);
    } else {
      this.cache.invalidate('user:');
      this.cache.invalidate('acl:');
    }
    this.cache.invalidate('menu:');
  }

  private loadUser(userId: string) {
    return this.cache.wrap(`user:${userId}`, 60, () =>
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, fullName: true, isActive: true, isSuperAdmin: true, deletedAt: true, defaultCompanyId: true, defaultBranchId: true, lockedUntil: true, mustChangePassword: true, passwordChangedAt: true },
      }),
    );
  }

  private loadAssignments(userId: string) {
    return this.cache.wrap(`acl:${userId}`, 60, () =>
      this.prisma.userAssignment.findMany({
        where: { userId, role: { isActive: true, deletedAt: null }, company: { isActive: true, deletedAt: null } },
        select: {
          companyId: true,
          branchId: true,
          role: { select: { dataScope: true, permissions: { select: { permission: { select: { code: true } } } } } },
        },
      }),
    );
  }

  private allPermissionCodes() {
    return this.cache.wrap('perm:all', 300, async () => (await this.prisma.permission.findMany({ select: { code: true } })).map((p) => p.code));
  }

  /** Companies a user can switch to */
  async companiesFor(userId: string) {
    const user = await this.loadUser(userId);
    if (!user) return [];
    const where = user.isSuperAdmin ? {} : { id: { in: (await this.loadAssignments(userId)).map((a) => a.companyId) } };
    return this.prisma.company.findMany({ where: { ...where, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true, logoFileId: true }, orderBy: { name: 'asc' } });
  }

  async branchesFor(profile: AuthUser) {
    return this.prisma.branch.findMany({
      where: { companyId: profile.companyId, isActive: true, deletedAt: null, ...(profile.branchIds ? { id: { in: profile.branchIds } } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** password state used by the auth guard (same short cache as the profile) */
  async accountFlags(userId: string) {
    const u = await this.loadUser(userId);
    return { mustChangePassword: !!u?.mustChangePassword, passwordChangedAt: u?.passwordChangedAt ? new Date(u.passwordChangedAt) : null };
  }

  /** false once every refresh token of a login (session family) was revoked: logout, password change, reuse */
  async sessionAlive(familyId: string) {
    return this.cache.wrap(`sid:${familyId}`, 30, async () => !!(await this.prisma.session.findFirst({ where: { familyId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })));
  }

  invalidateSessions() {
    this.cache.invalidate('sid:');
  }

  async profile(userId: string, companyId?: string | null, branchId?: string | null): Promise<AuthUser> {
    const user = await this.loadUser(userId);
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedException('Account is inactive');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException('Account is locked');

    const assignments = await this.loadAssignments(userId);
    let permissions: Set<string>;
    let branchIds: string[] | null = null;
    let dataScope: DataScope = 'OWN';

    if (user.isSuperAdmin) {
      if (!companyId) companyId = user.defaultCompanyId ?? (await this.prisma.company.findFirst({ where: { isActive: true, deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id;
      if (!companyId) throw new ForbiddenException('No company configured');
      const company = await this.cache.wrap(`company:${companyId}`, 120, () => this.prisma.company.findFirst({ where: { id: companyId!, isActive: true, deletedAt: null }, select: { id: true } }));
      if (!company) throw new ForbiddenException('Company not found or inactive');
      permissions = new Set(await this.allPermissionCodes());
      dataScope = 'ALL';
    } else {
      companyId = companyId ?? user.defaultCompanyId ?? assignments[0]?.companyId;
      const mine = assignments.filter((a) => a.companyId === companyId);
      if (!companyId || mine.length === 0) throw new ForbiddenException('You have no access to this company');
      permissions = new Set(mine.flatMap((a) => a.role.permissions.map((p) => p.permission.code)));
      branchIds = mine.some((a) => a.branchId === null) ? null : [...new Set(mine.map((a) => a.branchId!))];
      dataScope = mine.reduce<DataScope>((best, a) => (SCOPE_RANK[a.role.dataScope] > SCOPE_RANK[best] ? a.role.dataScope : best), 'OWN');
    }

    if (branchId) {
      const branch = await this.cache.wrap(`branch:${branchId}`, 300, () => this.prisma.branch.findUnique({ where: { id: branchId! }, select: { companyId: true } }));
      if (!branch || branch.companyId !== companyId) throw new ForbiddenException('Branch does not belong to the company');
      if (branchIds && !branchIds.includes(branchId)) throw new ForbiddenException('You have no access to this branch');
    } else {
      branchId = user.defaultBranchId && (!branchIds || branchIds.includes(user.defaultBranchId)) ? user.defaultBranchId : (branchIds?.[0] ?? null);
    }

    return { id: user.id, username: user.username, fullName: user.fullName, isSuperAdmin: user.isSuperAdmin, companyId, branchId: branchId ?? null, branchIds, dataScope, permissions };
  }

  /**
   * Row level data scope filter (ACL) for company/branch scoped tables.
   * @param branchField column holding the branch, if the table is branch aware
   */
  scopeWhere(opts: { company?: boolean; branchField?: string | null; ownerField?: string | null } = {}): Record<string, unknown> {
    const u = RequestCtx.user();
    const where: Record<string, unknown> = {};
    if (opts.company !== false) where.companyId = u.companyId;
    if (u.isSuperAdmin || u.dataScope === 'ALL' || u.dataScope === 'COMPANY') return where;
    if (u.dataScope === 'OWN') {
      where[opts.ownerField ?? 'createdById'] = u.id;
      return where;
    }
    if (opts.branchField && u.branchIds) where.OR = [{ [opts.branchField]: { in: u.branchIds } }, { [opts.branchField]: null }];
    return where;
  }
}
