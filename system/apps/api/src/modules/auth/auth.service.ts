import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { env } from '../../config/env';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpires: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async login(username: string, password: string): Promise<IssuedTokens & { userId: string }> {
    const ident = username.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { deletedAt: null, OR: [{ username: ident }, { email: ident }] } });
    const generic = new UnauthorizedException('Invalid username or password');

    if (!user) {
      await this.crypto.hashPassword(password); // equalize timing to prevent user enumeration
      this.audit.activity('auth.login.failed', { username: ident, reason: 'unknown user' });
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.audit.activity('auth.login.locked', { username: ident }, { userId: user.id, username: user.username });
      throw new UnauthorizedException('Account is temporarily locked. Please try again later.');
    }
    const ok = await this.crypto.verifyPassword(user.passwordHash, password);
    if (!ok || !user.isActive) {
      const max = await this.settings.num('security.maxLoginAttempts', null, 5);
      const lockMinutes = await this.settings.num('security.lockoutMinutes', null, 15);
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failed >= max ? 0 : failed, lockedUntil: failed >= max ? new Date(Date.now() + lockMinutes * 60_000) : null },
      });
      this.audit.activity('auth.login.failed', { username: ident, attempts: failed }, { userId: user.id, username: user.username });
      throw generic;
    }

    const ctx = RequestCtx.get();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx?.ip, ...(this.crypto.needsRehash(user.passwordHash) ? { passwordHash: await this.crypto.hashPassword(password) } : {}) },
    });
    this.access.invalidateUser(user.id);
    const profile = await this.access.profile(user.id); // validates the account has company access
    this.audit.activity('auth.login', { companyId: profile.companyId }, { userId: user.id, username: user.username, companyId: profile.companyId });
    return { ...(await this.issue(user.id, profile.companyId, randomUUID())), userId: user.id };
  }

  private async issue(userId: string, companyId: string, familyId: string): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, cid: companyId, typ: 'access' }, { expiresIn: env.JWT_ACCESS_TTL as any });
    const refreshToken = this.crypto.randomToken(48);
    const refreshExpires = new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000);
    const ctx = RequestCtx.get();
    await this.prisma.session.create({
      data: { userId, familyId, tokenHash: this.crypto.sha256(refreshToken), expiresAt: refreshExpires, ip: ctx?.ip, userAgent: ctx?.userAgent?.slice(0, 255) },
    });
    return { accessToken, refreshToken, refreshExpires };
  }

  /** Rotating refresh tokens with reuse detection (stolen token => whole family revoked). */
  async refresh(refreshToken: string | undefined, companyId?: string): Promise<IssuedTokens & { userId: string }> {
    if (!refreshToken) throw new UnauthorizedException('Session expired');
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.crypto.sha256(refreshToken) } });
    if (!session) throw new UnauthorizedException('Session expired');
    if (session.revokedAt) {
      await this.prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      this.audit.activity('auth.refresh.reuse_detected', { familyId: session.familyId }, { userId: session.userId });
      throw new UnauthorizedException('Session expired');
    }
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Session expired');

    const profile = await this.access.profile(session.userId, companyId);
    const tokens = await this.issue(session.userId, profile.companyId, session.familyId);
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return { ...tokens, userId: session.userId };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: this.crypto.sha256(refreshToken) } });
    if (s) {
      await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      this.audit.activity('auth.logout', {}, { userId: s.userId });
    }
  }

  async validatePasswordPolicy(password: string) {
    const min = await this.settings.num('security.passwordMinLength', null, 10);
    const problems: string[] = [];
    if (password.length < min) problems.push(`at least ${min} characters`);
    if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
    if (!/[0-9]/.test(password)) problems.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
    if (problems.length) throw new BadRequestException(`Password must contain ${problems.join(', ')}`);
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.crypto.verifyPassword(user.passwordHash, current))) throw new BadRequestException('Current password is incorrect');
    if (current === next) throw new BadRequestException('New password must be different');
    await this.validatePasswordPolicy(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.crypto.hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record('User', userId, 'CHANGE_PASSWORD');
  }
}
