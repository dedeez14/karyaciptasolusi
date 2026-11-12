import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators';
import { ZodPipe } from '../../common/pipes/zod.pipe';
import { RequestCtx } from '../../common/context/request-context';
import { AccessService } from '../../common/access/access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { MenuService } from '../system/menu.service';
import { SettingsService } from '../../common/settings/settings.service';
import { TicketService } from '../../common/access/ticket.service';
import { mfaRequiredFor } from '../../common/access/mfa-policy';

const COOKIE = 'kcs_rt';
const loginSchema = z.object({ username: z.string().trim().min(1).max(150), password: z.string().min(1).max(200) });
const mfaVerifySchema = z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) });
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });
const mfaDisableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly menus: MenuService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tickets: TicketService,
  ) {}

  private setCookie(req: Request, res: Response, token: string, expires: Date) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.hostname === 'localhost',
      path: '/api/v1/auth',
      expires,
    });
  }

  /** CSRF defence for cookie-authenticated endpoints: custom header + same-site cookie */
  private assertCsrf(req: Request) {
    if (req.headers['x-requested-with'] !== 'kcs-web') throw new ForbiddenException('Invalid request origin');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    this.assertCsrf(req);
    const t = await this.auth.login(body.username, body.password);
    // second factor needed: no session yet, only a 5 minute challenge for POST /auth/mfa/verify
    if ('mfaRequired' in t) return { mfaRequired: true, mfaToken: t.mfaToken };
    this.setCookie(req, res, t.refreshToken, t.refreshExpires);
    return { accessToken: t.accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>) {
    this.assertCsrf(req);
    const t = await this.auth.verifyMfa(body.mfaToken, body.code);
    this.setCookie(req, res, t.refreshToken, t.refreshExpires);
    return { accessToken: t.accessToken };
  }

  @Get('mfa')
  mfaStatus() {
    return this.auth.mfaStatus(RequestCtx.user().id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup() {
    return this.auth.mfaSetup(RequestCtx.user().id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    return this.auth.mfaEnable(RequestCtx.user().id, body.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@Body(new ZodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>) {
    return this.auth.mfaDisable(RequestCtx.user().id, body.password, body.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  mfaRecoveryCodes(@Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    return this.auth.mfaNewRecoveryCodes(RequestCtx.user().id, body.code);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrf(req);
    const company = String(req.headers['x-company-id'] ?? '') || undefined;
    try {
      const t = await this.auth.refresh(req.cookies?.[COOKIE], company);
      this.setCookie(req, res, t.refreshToken, t.refreshExpires);
      return { accessToken: t.accessToken };
    } catch (e) {
      res.clearCookie(COOKIE, { path: '/api/v1/auth' });
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrf(req);
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/api/v1/auth' });
    return { success: true };
  }

  /** Bootstrap payload for the SPA: profile, permissions, company/branch context and menu tree */
  @Get('me')
  async me() {
    const u = RequestCtx.user();
    const [user, companies, branches, menus, company] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: u.id }, select: { id: true, username: true, email: true, fullName: true, mustChangePassword: true, isSuperAdmin: true, lastLoginAt: true, mfaEnabledAt: true } }),
      this.access.companiesFor(u.id),
      this.access.branchesFor(u),
      this.menus.treeFor(u),
      this.prisma.company.findUnique({ where: { id: u.companyId }, select: { id: true, code: true, name: true, currencyCode: true, logoFileId: true } }),
    ]);
    const mfaRequired = await mfaRequiredFor(u, this.settings);
    return {
      user: user ? { ...user, mfaEnabledAt: undefined, mfaEnabled: !!user.mfaEnabledAt, mfaSetupRequired: mfaRequired && !user.mfaEnabledAt } : user,
      company,
      branchId: u.branchId,
      dataScope: u.dataScope,
      permissions: u.isSuperAdmin ? ['*'] : [...u.permissions].sort(),
      companies,
      branches,
      menus,
      prefs: {
        locale: await this.settings.str('general.locale', u.companyId, 'id-ID'),
        idleTimeoutMinutes: await this.settings.num('security.idleTimeoutMinutes', u.companyId, 30),
        appName: await this.settings.str('general.appName', u.companyId, 'KCS ERP'),
        vatPayer: await this.settings.bool('sales.vatPayer', u.companyId, true),
        // app theme follows the company's brand colours (also used on documents)
        brandColor: await this.settings.str('document.primaryColor', u.companyId, '#1d4f7a'),
        accentColor: await this.settings.str('document.secondaryColor', u.companyId, '#f8b810'),
        timezone: await this.settings.str('general.timezone', u.companyId, 'Asia/Jakarta'),
      },
      clock: {
        enabled: await this.settings.bool('clock.enabled', u.companyId, true),
        timezone: await this.settings.str('clock.timezone', u.companyId, await this.settings.str('general.timezone', u.companyId, 'Asia/Jakarta')),
        format24h: await this.settings.bool('clock.format24h', u.companyId, true),
        showSeconds: await this.settings.bool('clock.showSeconds', u.companyId, true),
        showDate: await this.settings.bool('clock.showDate', u.companyId, true),
        label: await this.settings.str('clock.label', u.companyId, ''),
      },
      employeeId: (await this.prisma.employee.findFirst({ where: { userId: u.id, companyId: u.companyId, deletedAt: null }, select: { id: true } }))?.id ?? null,
    };
  }

  /** Single-use 60s ticket to open a file natively (PDF preview, image) without exposing the access token */
  @Post('ticket')
  @HttpCode(200)
  ticket(@Body(new ZodPipe(z.object({ path: z.string().max(200) }))) body: { path: string }) {
    return { ticket: this.tickets.issue(RequestCtx.user(), body.path) };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(RequestCtx.user().id, body.currentPassword, body.newPassword);
    return { success: true };
  }
}
