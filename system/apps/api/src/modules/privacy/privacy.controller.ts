import { Controller, Get, Injectable, Logger, Param, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { forEachCompany } from '../billing/job-context';
import { PrivacyService } from './privacy.service';

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** a copy of everything held about one person (UU PDP access / portability request) */
  @Get('export/:type/:id')
  export(@Param('type') type: string, @Param('id') id: string) {
    return this.privacy.export(type.toUpperCase(), id);
  }

  /** remove the personal details of a lead or customer contact (deletion request) */
  @Post('anonymize/:type/:id')
  anonymize(@Param('type') type: string, @Param('id') id: string) {
    return this.privacy.anonymize(type.toUpperCase(), id);
  }
}

/** Every night at 03:00: personal data of leads past the retention period is removed */
@Injectable()
export class PrivacyScheduler {
  private readonly logger = new Logger('PrivacyScheduler');
  constructor(private readonly prisma: PrismaService, private readonly privacy: PrivacyService) {}

  @Cron('0 3 * * *', { name: 'privacy-retention' })
  async nightly() {
    await forEachCompany(this.prisma, this.logger, 'privacy-retention', async (companyId) => {
      const n = await this.privacy.purgeInactiveLeads(companyId);
      return n ? `${n} inactive lead(s) anonymised` : null;
    });
  }
}
