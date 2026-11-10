import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { forEachCompany } from '../billing/job-context';
import { CampaignService } from './campaign.service';

/** Every minute: start due campaigns, top up automatic campaigns, send the next batch (as the audited system actor). */
@Injectable()
export class EmailCampaignScheduler {
  private readonly logger = new Logger('EmailCampaignScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
  ) {}

  @Cron('* * * * *', { name: 'email-campaigns' })
  async run() {
    // nothing to do for most companies most of the time: skip the per-company loop entirely
    const pending = await this.prisma.emailCampaign.count({ where: { deletedAt: null, statusCode: { in: ['SCHEDULED', 'SENDING'] } } });
    if (!pending) return;
    await forEachCompany(this.prisma, this.logger, 'email-campaigns', async (companyId) => {
      const r = await this.campaigns.tick(companyId);
      return r.sent || r.started ? `${r.sent} e-mail(s) sent, ${r.started} campaign(s) started` : null;
    });
  }
}
