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

const COOKIE = 'kcs_rt';
const loginSchema = z.object({ username: z.string().trim().min(1).max(150), password: z.string().min(1).max(200) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly menus: MenuService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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
    this.setCookie(req, res, t.refreshToken, t.refreshExpires);
    return { accessToken: t.accessToken };
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
      this.prisma.user.findUnique({ where: { id: u.id }, select: { id: true, username: true, email: true, fullName: true, mustChangePassword: true, isSuperAdmin: true, lastLoginAt: true } }),
      this.access.companiesFor(u.id),
      this.access.branchesFor(u),
      this.menus.treeFor(u),
      this.prisma.company.findUnique({ where: { id: u.companyId }, select: { id: true, code: true, name: true, currencyCode: true, logoFileId: true } }),
    ]);
    return {
      user,
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
      },
    };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(RequestCtx.user().id, body.currentPassword, body.newPassword);
    return { success: true };
  }
}
