import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AccessService } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { env } from '../../config/env';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from '../../common/crypto/totp';
import { mfaRequiredFor } from '../../common/access/mfa-policy';
import { devMfaSkipped } from '../../common/context/local-dev';

/** password accepted, second factor still needed */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

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

  /** mfa challenge tokens already exchanged for a session (single use, kept until they expire) */
  private readonly usedChallenges = new Map<string, number>();

  async login(username: string, password: string): Promise<(IssuedTokens & { userId: string }) | MfaChallenge> {
    const ident = username.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { deletedAt: null, OR: [{ username: ident }, { email: ident }] } });
    // one answer for unknown users, wrong passwords and locked accounts: nothing tells which usernames exist
    const generic = new UnauthorizedException('Invalid username or password. After several failed attempts, sign-in is paused for a few minutes.');

    if (!user) {
      await this.crypto.hashPassword(password); // equalize timing to prevent user enumeration
      this.audit.activity('auth.login.failed', { username: ident, reason: 'unknown user' });
      throw generic;
    }
    const ok = await this.crypto.verifyPassword(user.passwordHash, password); // always: same timing for every outcome
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.audit.activity('auth.login.locked', { username: ident }, { userId: user.id, username: user.username });
      throw generic;
    }
    if (!ok || !user.isActive) {
      const failed = await this.countFailure(user);
      this.audit.activity('auth.login.failed', { username: ident, attempts: failed }, { userId: user.id, username: user.username });
      throw generic;
    }
    return this.afterPassword(user, password);
  }

  /** local development: sign in as DEV_AUTO_LOGIN without a password (the controller checks it is really this computer) */
  async devLogin(username: string): Promise<IssuedTokens & { userId: string }> {
    const user = await this.prisma.user.findFirst({ where: { deletedAt: null, isActive: true, username: username.toLowerCase() } });
    if (!user) throw new UnauthorizedException(`DEV_AUTO_LOGIN user "${username}" does not exist or is inactive`);
    this.audit.activity('auth.login.dev', { local: true }, { userId: user.id, username: user.username });
    return this.completeLogin(user.id, user.username);
  }

  /** wrong password or wrong second factor: counts towards the temporary lock (not awaited, see timing note) */
  private async countFailure(user: { id: string; failedLoginCount: number }) {
    const max = await this.settings.num('security.maxLoginAttempts', null, 5);
    const lockMinutes = await this.settings.num('security.lockoutMinutes', null, 15);
    const failed = user.failedLoginCount + 1;
    // not awaited: the extra write would make existing usernames measurably slower than unknown ones
    void this.prisma.user
      .update({
        where: { id: user.id },
        data: { failedLoginCount: failed >= max ? 0 : failed, lockedUntil: failed >= max ? new Date(Date.now() + lockMinutes * 60_000) : null },
      })
      .catch(() => undefined);
    return failed;
  }

  private async afterPassword(user: { id: string; username: string; passwordHash: string; mfaEnabledAt: Date | null; mfaSecret: string | null }, password: string): Promise<(IssuedTokens & { userId: string }) | MfaChallenge> {
    if (this.crypto.needsRehash(user.passwordHash)) await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.crypto.hashPassword(password) } });
    // second factor: the session is only created after the code (failed codes count towards the lockout)
    if (user.mfaEnabledAt && user.mfaSecret && devMfaSkipped()) {
      // local development (DEV_SKIP_MFA, localhost only): recorded so it is never silent
      this.audit.activity('auth.login.mfa_skipped_local_dev', {}, { userId: user.id, username: user.username });
      return this.completeLogin(user.id, user.username);
    }
    if (user.mfaEnabledAt && user.mfaSecret) {
      await this.access.profile(user.id); // validates the account has company access before telling it a code is needed
      const mfaToken = await this.jwt.signAsync({ sub: user.id, typ: 'mfa', jti: randomUUID() }, { expiresIn: '5m' as any });
      this.audit.activity('auth.login.password_ok', { mfa: true }, { userId: user.id, username: user.username });
      return { mfaRequired: true, mfaToken };
    }
    return this.completeLogin(user.id, user.username);
  }

  private async completeLogin(userId: string, username: string, extra: Record<string, unknown> = {}) {
    const ctx = RequestCtx.get();
    await this.prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx?.ip, ...extra } });
    this.access.invalidateUser(userId);
    const profile = await this.access.profile(userId); // validates the account has company access
    const user = { id: userId, username };
    this.audit.activity('auth.login', { companyId: profile.companyId, ...(extra.mfaLastStep !== undefined || extra.mfaRecoveryCodes !== undefined ? { mfa: true } : {}) }, { userId: user.id, username: user.username, companyId: profile.companyId });
    return { ...(await this.issue(user.id, profile.companyId, randomUUID())), userId: user.id };
  }

  // ------------------------------------------------------------------ two-factor sign-in

  /** second step of the login: TOTP code or a recovery code */
  async verifyMfa(mfaToken: string, code: string): Promise<IssuedTokens & { userId: string }> {
    const invalid = new UnauthorizedException('Invalid or expired code');
    let payload: { sub: string; typ?: string; jti?: string; exp?: number };
    try {
      payload = await this.jwt.verifyAsync(mfaToken);
    } catch {
      throw new UnauthorizedException('The sign-in took too long. Enter your password again.');
    }
    if (payload.typ !== 'mfa' || !payload.jti) throw invalid;
    const now = Date.now();
    for (const [k, exp] of this.usedChallenges) if (exp < now) this.usedChallenges.delete(k);
    if (this.usedChallenges.has(payload.jti)) throw new UnauthorizedException('The sign-in took too long. Enter your password again.');
    // reserved while this attempt runs: two parallel requests with the same challenge cannot both succeed
    this.usedChallenges.set(payload.jti, (payload.exp ?? now / 1000 + 300) * 1000);
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub, deletedAt: null, isActive: true } });
    const locked = !!(user?.lockedUntil && user.lockedUntil > new Date());
    const result = user?.mfaSecret && user.mfaEnabledAt && !locked ? this.checkSecondFactor(user, code) : null;
    if (!user || !result) {
      this.usedChallenges.delete(payload.jti); // a typo can be corrected with the same challenge
      // while locked nothing is counted (counting again would overwrite the lock)
      if (user && !locked) {
        const failed = await this.countFailure(user);
        this.audit.activity('auth.mfa.failed', { attempts: failed }, { userId: user.id, username: user.username });
      }
      throw invalid;
    }
    if (result.recoveryUsed) this.audit.activity('auth.mfa.recovery_used', { left: result.recoveryLeft }, { userId: user.id, username: user.username });
    return this.completeLogin(user.id, user.username, result.update);
  }

  /** TOTP (each 30 s code once) or an unused recovery code; returns the user fields to store, or null */
  private checkSecondFactor(user: { mfaSecret: string | null; mfaLastStep: number | null; mfaRecoveryCodes: string | null }, code: string) {
    const secret = this.crypto.decrypt(user.mfaSecret);
    const clean = code.trim();
    if (secret && /^\d{3}\s?\d{3}$/.test(clean)) {
      const step = verifyTotp(secret, clean, user.mfaLastStep);
      return step === null ? null : { update: { mfaLastStep: step }, recoveryUsed: false, recoveryLeft: undefined as number | undefined };
    }
    const hashes: string[] = user.mfaRecoveryCodes ? JSON.parse(user.mfaRecoveryCodes) : [];
    const h = this.crypto.sha256(normalizeRecoveryCode(clean));
    if (!clean || !hashes.includes(h)) return null;
    const left = hashes.filter((x) => x !== h);
    return { update: { mfaRecoveryCodes: JSON.stringify(left) }, recoveryUsed: true, recoveryLeft: left.length };
  }

  async mfaStatus(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, mfaRecoveryCodes: true } });
    return {
      enabled: !!u.mfaEnabledAt,
      enabledAt: u.mfaEnabledAt,
      recoveryCodesLeft: u.mfaRecoveryCodes ? (JSON.parse(u.mfaRecoveryCodes) as string[]).length : 0,
      required: await mfaRequiredFor(RequestCtx.user(), this.settings),
    };
  }

  /** starts the set-up: a new secret waits until the first code proves the app was set up */
  async mfaSetup(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, mfaEnabledAt: true } });
    if (u.mfaEnabledAt) throw new BadRequestException('Two-factor sign-in is already on. Turn it off first to connect another app.');
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaPendingSecret: this.crypto.encrypt(secret) } });
    const issuer = await this.settings.str('general.appName', null, 'KCS ERP');
    const url = otpauthUrl(secret, u.username, issuer);
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
    return { secret: secret.match(/.{1,4}/g)!.join(' '), otpauthUrl: url, qr, issuer, account: u.username };
  }

  async mfaEnable(userId: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.mfaEnabledAt) throw new BadRequestException('Two-factor sign-in is already on');
    const secret = this.crypto.decrypt(u.mfaPendingSecret);
    if (!secret) throw new BadRequestException('Start the set-up again');
    const step = verifyTotp(secret, code, null);
    if (step === null) throw new BadRequestException('The code is not correct. Check that the time on your phone is set automatically, then try the newest code.');
    const codes = newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: this.crypto.encrypt(secret), mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryCodes: JSON.stringify(codes.map((c) => this.crypto.sha256(normalizeRecoveryCode(c)))) },
    });
    this.access.invalidateUser(userId);
    await this.audit.record('User', userId, 'MFA_ENABLED');
    return { enabled: true, recoveryCodes: codes };
  }

  /** password + a current code; not possible while the policy requires two-factor sign-in for this user */
  async mfaDisable(userId: string, password: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.mfaEnabledAt) return { enabled: false };
    if (await mfaRequiredFor(RequestCtx.user(), this.settings)) throw new BadRequestException('Your role requires two-factor sign-in, so it cannot be turned off.');
    if (!(await this.crypto.verifyPassword(u.passwordHash, password))) throw new BadRequestException('The password is not correct');
    const r = this.checkSecondFactor(u, code);
    if (!r) throw new BadRequestException('The code is not correct');
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: null } });
    this.access.invalidateUser(userId);
    await this.audit.record('User', userId, 'MFA_DISABLED');
    return { enabled: false };
  }

  async mfaNewRecoveryCodes(userId: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.mfaEnabledAt || !u.mfaSecret) throw new BadRequestException('Two-factor sign-in is not on');
    const secret = this.crypto.decrypt(u.mfaSecret)!;
    const step = verifyTotp(secret, code, u.mfaLastStep);
    if (step === null) throw new BadRequestException('The code is not correct (use the code from your authenticator app)');
    const codes = newRecoveryCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaLastStep: step, mfaRecoveryCodes: JSON.stringify(codes.map((c) => this.crypto.sha256(normalizeRecoveryCode(c)))) } });
    await this.audit.record('User', userId, 'MFA_RECOVERY_CODES');
    return { recoveryCodes: codes };
  }

  private async issue(userId: string, companyId: string, familyId: string): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, cid: companyId, typ: 'access', sid: familyId }, { expiresIn: env.JWT_ACCESS_TTL as any });
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
      this.access.invalidateSessions();
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
      this.access.invalidateSessions();
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
    this.access.invalidateUser(userId);
    this.access.invalidateSessions();
    await this.audit.record('User', userId, 'CHANGE_PASSWORD');
  }
}
