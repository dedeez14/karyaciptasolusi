import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Public, non-sensitive branding for the login screen */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('public/branding')
  async branding() {
    return {
      appName: await this.settings.str('general.appName', null, 'KCS ERP'),
      tagline: await this.settings.str('general.tagline', null, ''),
      idleTimeoutMinutes: await this.settings.num('security.idleTimeoutMinutes', null, 30),
    };
  }
}
