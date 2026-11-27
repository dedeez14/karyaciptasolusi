import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationBus } from '../../common/events/notification-bus';
import { runAsSystem } from '../billing/job-context';
import { CampaignService } from './campaign.service';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** Mask "budi.santoso@example.com" as "bu***@example.com" - the page proves the token, never leaks the address */
const mask = (email: string) => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(3, local.length - 2))}@${domain}`;
};

/**
 * Endpoints reached from the e-mails themselves (no sign-in): unsubscribe and the optional open pixel.
 * A random per-recipient token is the only key; nothing else about the company or the campaign is exposed.
 */
@Injectable()
export class PublicEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly campaigns: CampaignService,
    private readonly bus: NotificationBus,
  ) {}

  private async recipient(token: string) {
    if (!TOKEN_RE.test(token)) throw new NotFoundException('This link is not valid.');
    const r = await this.prisma.emailRecipient.findUnique({ where: { token }, include: { campaign: { select: { id: true, code: true, companyId: true, trackOpens: true } } } });
    if (!r) throw new NotFoundException('This link is not valid or has expired.');
    return r;
  }

  async info(token: string) {
    const r = await this.recipient(token);
    const company = await this.prisma.company.findUnique({ where: { id: r.companyId }, select: { name: true, legalName: true } });
    const listed = await this.prisma.emailSuppression.findUnique({ where: { companyId_email: { companyId: r.companyId, email: r.email } }, select: { reasonCode: true } });
    return { company: company?.legalName || company?.name || '', email: mask(r.email), unsubscribed: !!listed };
  }

  /** Idempotent: a second click (or the mail client's one-click POST) changes nothing. */
  async unsubscribe(token: string) {
    const r = await this.recipient(token);
    return runAsSystem(r.companyId, 'email-unsubscribe', async () => {
      const existing = await this.prisma.emailSuppression.findUnique({ where: { companyId_email: { companyId: r.companyId, email: r.email } } });
      if (!existing) {
        await this.prisma.emailSuppression.create({ data: { companyId: r.companyId, email: r.email, reasonCode: 'UNSUBSCRIBED', note: `Unsubscribe link in ${r.campaign.code}`, campaignId: r.campaignId } });
        await this.audit.record('E-mail Suppression', null, 'UNSUBSCRIBE', undefined, { campaign: r.campaign.code });
      }
      if (r.statusCode === 'SENT' || r.statusCode === 'QUEUED') {
        await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { statusCode: r.sentAt ? 'UNSUBSCRIBED' : 'SKIPPED', error: r.sentAt ? null : 'Unsubscribed', nextSendAt: null } });
      }
      // the address leaves every other campaign that has not reached it yet
      await this.prisma.emailRecipient.updateMany({ where: { companyId: r.companyId, email: r.email, statusCode: 'QUEUED' }, data: { statusCode: 'SKIPPED', error: 'Unsubscribed' } });
      await this.prisma.emailRecipient.updateMany({ where: { companyId: r.companyId, email: r.email, nextSendAt: { not: null } }, data: { nextSendAt: null, error: 'Unsubscribed: follow-ups stopped' } });
      await this.campaigns.refreshCounters(r.campaignId);
      this.bus.emit(r.companyId);
      return { unsubscribed: true };
    });
  }

  /** Records the first open when the campaign tracks opens. Always answers so the image never breaks. */
  async open(token: string) {
    if (!TOKEN_RE.test(token)) return;
    const r = await this.prisma.emailRecipient.findUnique({ where: { token }, select: { id: true, openedAt: true, campaignId: true, campaign: { select: { trackOpens: true } } } });
    if (!r || r.openedAt || !r.campaign.trackOpens) return;
    await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { openedAt: new Date() } });
    await this.campaigns.refreshCounters(r.campaignId);
  }
}
