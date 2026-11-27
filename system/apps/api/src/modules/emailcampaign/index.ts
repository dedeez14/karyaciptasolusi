import { EmailCampaignController, PublicEmailController } from './campaign.controller';
import { EmailCampaignScheduler } from './campaign.scheduler';
import { CampaignService } from './campaign.service';
import { InboxService } from './inbox.service';
import { PublicEmailService } from './public-email.service';

/** Controllers and providers of the e-mail campaign module (registered in app.module.ts). */
export const EMAILCAMPAIGN_CONTROLLERS: any[] = [EmailCampaignController, PublicEmailController];
export const EMAILCAMPAIGN_PROVIDERS: any[] = [CampaignService, InboxService, PublicEmailService, EmailCampaignScheduler];
