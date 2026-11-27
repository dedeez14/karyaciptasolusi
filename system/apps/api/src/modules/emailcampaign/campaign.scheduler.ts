import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { forEachCompany } from '../billing/job-context';
import { SettingsService } from '../../common/settings/settings.service';
import { CampaignService } from './campaign.service';
import { InboxService } from './inbox.service';

/** Every minute: start due campaigns, top up automatic campaigns, send the next batch (as the audited system actor). */
@Injectable()
export class EmailCampaignScheduler {
  private readonly logger = new Logger('EmailCampaignScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly inbox: InboxService,
    private readonly settings: SettingsService,
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

  /** Every 5 minutes: read new replies and bounces of campaign e-mails (only companies that sent campaign mail recently). */
  @Cron('*/5 * * * *', { name: 'email-replies' })
  async replies() {
    const recent = await this.prisma.emailMessage.count({ where: { sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) } } });
    if (!recent) return;
    await forEachCompany(this.prisma, this.logger, 'email-replies', async (companyId) => {
      if (!(await this.settings.bool('marketing.replyTracking', companyId, true))) return null;
      const sent = await this.prisma.emailMessage.count({ where: { companyId, sentAt: { gte: new Date(Date.now() - 60 * 86_400_000) } } });
      if (!sent) return null;
      const r = await this.inbox.check(companyId);
      if (r.error) return `mailbox check failed: ${r.error}`;
      return r.replies || r.bounces || r.autoReplies ? `${r.replies} reply(ies), ${r.bounces} bounce(s), ${r.autoReplies} automatic reply(ies)` : null;
    });
  }
}
