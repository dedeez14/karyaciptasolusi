import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EmailCampaign, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { NotificationBus } from '../../common/events/notification-bus';
import { paged } from '../../common/utils/query';
import { MailService } from '../integrations/mail.service';
import { Audience, audienceSchema, Contact, resolveAudience } from './audience';
import { normalizeEmail, renderEmail, sanitizeHtml, type MergeData } from './render';

const ENTITY = 'E-mail Campaign';
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().min(1, 'Write the e-mail text').max(200_000),
  fromName: optText(150),
  replyTo: z.preprocess((v) => (v === '' ? null : v), z.email('Not a valid e-mail address').max(150).nullable().optional()),
  campaignId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional()),
  audience: audienceSchema,
  automatic: z.boolean().default(false),
  ratePerMinute: z.coerce.number().int().min(1).max(500).default(20),
  trackOpens: z.boolean().default(false),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

/** Retries for temporary SMTP errors (4xx, network) before a recipient is marked FAILED */
const MAX_ATTEMPTS = 3;
/** Mailbox does not exist / rejected permanently -> the address is suppressed */
const BOUNCE_CODES = new Set([550, 551, 553]);

type Recipient = Prisma.EmailRecipientGetPayload<object>;

@Injectable()
export class CampaignService {
  private readonly log = new Logger('EmailCampaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequence: SequenceService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly bus: NotificationBus,
  ) {}

  // ------------------------------------------------------------------ helpers

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const r = schema.safeParse(body);
    if (!r.success) throw new BadRequestException({ message: 'Validation failed', errors: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message])) });
    return r.data;
  }

  private async owned(id: string) {
    if (!isUuid(id)) throw new NotFoundException('Campaign not found');
    const c = await this.prisma.emailCampaign.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  /** The audience source decides which data the author must be allowed to read */
  private assertAudienceAccess(a: Audience) {
    const need = { LEADS: 'crm.lead.read', CUSTOMERS: 'master.customer.read', MAP_PLACES: 'crm.leadfinder.read', MANUAL: null }[a.source];
    if (need) RequestCtx.assert(need);
  }

  private async senderInfo(companyId: string, c: Pick<EmailCampaign, 'fromName' | 'replyTo'>) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true, legalName: true } });
    const companyName = company?.legalName || company?.name || 'Our company';
    const sender = c.fromName || (await this.settings.str('marketing.emailFromName', companyId)) || companyName;
    const replyTo = c.replyTo || (await this.settings.str('marketing.emailReplyTo', companyId)) || undefined;
    const footerAddress = await this.settings.str('marketing.emailFooterAddress', companyId);
    const publicUrl = (await this.settings.str('general.publicUrl', companyId, 'http://localhost:3000')).replace(/\/+$/, '');
    return { sender, replyTo, footerAddress, publicUrl, companyName };
  }

  private links(publicUrl: string, token: string) {
    return {
      unsubscribe: `${publicUrl}/unsubscribe?t=${token}`,
      oneClick: `${publicUrl}/api/v1/public/email/unsubscribe/${token}`,
      pixel: `${publicUrl}/api/v1/public/email/open/${token}.gif`,
    };
  }

  private async startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async sentToday(companyId: string) {
    return this.prisma.emailRecipient.count({ where: { companyId, sentAt: { gte: await this.startOfToday() } } });
  }

  private async limits(companyId: string) {
    return {
      ratePerMinute: Math.max(1, await this.settings.num('marketing.emailRatePerMinute', companyId, 20)),
      dailyLimit: Math.max(0, await this.settings.num('marketing.emailDailyLimit', companyId, 300)),
    };
  }

  /** Counters are derived from the recipients (one source of truth) */
  async refreshCounters(campaignId: string) {
    const [total, sent, failed, opened, unsub] = await Promise.all([
      this.prisma.emailRecipient.count({ where: { campaignId } }),
      this.prisma.emailRecipient.count({ where: { campaignId, sentAt: { not: null } } }),
      this.prisma.emailRecipient.count({ where: { campaignId, statusCode: { in: ['FAILED', 'BOUNCED'] } } }),
      this.prisma.emailRecipient.count({ where: { campaignId, openedAt: { not: null } } }),
      this.prisma.emailRecipient.count({ where: { campaignId, statusCode: 'UNSUBSCRIBED' } }),
    ]);
    await this.prisma.emailCampaign.update({ where: { id: campaignId }, data: { totalCount: total, sentCount: sent, failedCount: failed, openCount: opened, unsubscribeCount: unsub } });
  }

  // ------------------------------------------------------------------ read

  async defaults() {
    RequestCtx.assert('crm.emailcampaign.read');
    const companyId = RequestCtx.companyId();
    const s = await this.senderInfo(companyId, { fromName: null, replyTo: null });
    const l = await this.limits(companyId);
    return {
      fromName: s.sender,
      replyTo: s.replyTo ?? '',
      footerAddress: s.footerAddress,
      trackOpens: await this.settings.bool('marketing.trackOpens', companyId, false),
      smtpReady: await this.mail.isConfigured(companyId),
      ratePerMinute: l.ratePerMinute,
      dailyLimit: l.dailyLimit,
      sentToday: await this.sentToday(companyId),
    };
  }

  async list(q: { page: number; pageSize: number; search?: string; status?: string }) {
    RequestCtx.assert('crm.emailcampaign.read');
    const where: Prisma.EmailCampaignWhereInput = { companyId: RequestCtx.companyId(), deletedAt: null };
    if (q.status) where.statusCode = q.status;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.emailCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, code: true, name: true, subject: true, statusCode: true, automatic: true, scheduledAt: true, startedAt: true, finishedAt: true, totalCount: true, sentCount: true, failedCount: true, openCount: true, unsubscribeCount: true, trackOpens: true, audience: true, createdAt: true },
      }),
      this.prisma.emailCampaign.count({ where }),
    ]);
    return paged(rows.map((r) => ({ ...r, audienceSource: (r.audience as { source?: string })?.source ?? null, audience: undefined })), total, q);
  }

  async summary() {
    RequestCtx.assert('crm.emailcampaign.read');
    const companyId = RequestCtx.companyId();
    const [active, scheduled, suppressed] = await Promise.all([
      this.prisma.emailCampaign.count({ where: { companyId, deletedAt: null, statusCode: 'SENDING' } }),
      this.prisma.emailCampaign.count({ where: { companyId, deletedAt: null, statusCode: 'SCHEDULED' } }),
      this.prisma.emailSuppression.count({ where: { companyId } }),
    ]);
    const l = await this.limits(companyId);
    return { active, scheduled, suppressed, sentToday: await this.sentToday(companyId), dailyLimit: l.dailyLimit, smtpReady: await this.mail.isConfigured(companyId) };
  }

  async get(id: string) {
    RequestCtx.assert('crm.emailcampaign.read');
    const c = await this.owned(id);
    const companyId = c.companyId;
    const byStatus = await this.prisma.emailRecipient.groupBy({ by: ['statusCode'], where: { campaignId: id }, _count: { _all: true } });
    const counts = Object.fromEntries(byStatus.map((b) => [b.statusCode, b._count._all]));
    const linked = c.campaignId ? await this.prisma.campaign.findFirst({ where: { id: c.campaignId, companyId }, select: { id: true, code: true, name: true } }) : null;
    const lastAuto = c.statusCode === 'PAUSED' ? await this.prisma.auditLog.findFirst({ where: { companyId, entity: ENTITY, entityId: id, action: 'AUTO_PAUSE' }, orderBy: { id: 'desc' }, select: { after: true, createdAt: true } }) : null;
    const lastPause = c.statusCode === 'PAUSED' ? await this.prisma.auditLog.findFirst({ where: { companyId, entity: ENTITY, entityId: id, action: { in: ['PAUSE', 'AUTO_PAUSE'] } }, orderBy: { id: 'desc' }, select: { action: true } }) : null;
    return {
      ...c,
      linkedCampaign: linked,
      counts,
      pausedReason: lastPause?.action === 'AUTO_PAUSE' ? ((lastAuto?.after as { reason?: string } | null)?.reason ?? null) : null,
      smtpReady: await this.mail.isConfigured(companyId),
      can: this.capabilities(c),
    };
  }

  private capabilities(c: EmailCampaign) {
    const s = c.statusCode;
    const send = RequestCtx.can('crm.emailcampaign.send');
    const update = RequestCtx.can('crm.emailcampaign.update');
    return {
      edit: update && ['DRAFT', 'SCHEDULED', 'PAUSED'].includes(s),
      editAudience: update && (['DRAFT', 'SCHEDULED'].includes(s) || (s === 'PAUSED' && c.automatic)),
      schedule: send && ['DRAFT', 'SCHEDULED'].includes(s),
      sendNow: send && ['DRAFT', 'SCHEDULED'].includes(s),
      pause: send && ['SENDING', 'SCHEDULED'].includes(s),
      resume: send && s === 'PAUSED',
      cancel: send && ['SCHEDULED', 'SENDING', 'PAUSED'].includes(s),
      test: send && s !== 'CANCELLED',
      delete: RequestCtx.can('crm.emailcampaign.delete') && ['DRAFT', 'SENT', 'CANCELLED'].includes(s),
    };
  }

  async recipients(id: string, q: { page: number; pageSize: number; status?: string; search?: string }) {
    RequestCtx.assert('crm.emailcampaign.read');
    await this.owned(id);
    const where: Prisma.EmailRecipientWhereInput = { campaignId: id };
    if (q.status) where.statusCode = q.status;
    if (q.search) where.OR = [{ email: { contains: q.search.toLowerCase() } }, { name: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.emailRecipient.findMany({
        where,
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, email: true, name: true, entityType: true, entityId: true, statusCode: true, error: true, sentAt: true, openedAt: true, createdAt: true, data: true },
      }),
      this.prisma.emailRecipient.count({ where }),
    ]);
    return paged(
      rows.map((r) => ({ ...r, company: (r.data as MergeData | null)?.company ?? null, attempts: (r.data as { _attempts?: number } | null)?._attempts ?? 0, data: undefined })),
      total,
      q,
    );
  }

  async recipientsTable(id: string, status?: string) {
    RequestCtx.assert('crm.emailcampaign.read');
    const c = await this.owned(id);
    const rows = await this.prisma.emailRecipient.findMany({ where: { campaignId: id, ...(status ? { statusCode: status } : {}) }, orderBy: { createdAt: 'asc' }, take: 50_000 });
    return {
      title: `${c.code} ${c.name} - recipients`,
      columns: [
        { key: 'email', label: 'E-mail' },
        { key: 'name', label: 'Name' },
        { key: 'company', label: 'Company' },
        { key: 'source', label: 'Source' },
        { key: 'status', label: 'Status' },
        { key: 'sentAt', label: 'Sent at', type: 'datetime' },
        { key: 'openedAt', label: 'Opened at', type: 'datetime' },
        { key: 'error', label: 'Error' },
      ],
      rows: rows.map((r) => ({ email: r.email, name: r.name ?? '', company: (r.data as MergeData | null)?.company ?? '', source: r.entityType ?? '', status: r.statusCode, sentAt: r.sentAt, openedAt: r.openedAt, error: r.error ?? '' })),
    };
  }

  /** Map-scraper searches available as an audience (read only) */
  async mapJobs() {
    RequestCtx.assert('crm.emailcampaign.read');
    const companyId = RequestCtx.companyId();
    const jobs = await this.prisma.scrapeJob.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, code: true, name: true, statusCode: true, resultCount: true, createdAt: true } });
    const withEmail = await this.prisma.mapPlace.groupBy({ by: ['jobId'], where: { companyId, emails: { not: null } }, _count: { _all: true } });
    const m = new Map(withEmail.map((w) => [w.jobId, w._count._all]));
    return jobs.map((j) => ({ ...j, withEmail: m.get(j.id) ?? 0 }));
  }

  async previewAudience(body: unknown) {
    RequestCtx.assert('crm.emailcampaign.read');
    const a = this.parse(audienceSchema, (body as { audience?: unknown })?.audience ?? body);
    this.assertAudienceAccess(a);
    const r = await resolveAudience(this.prisma, RequestCtx.companyId(), a);
    return { found: r.found, invalid: r.invalid, duplicates: r.duplicates, suppressed: r.suppressed, valid: r.contacts.length, sample: r.contacts.slice(0, 10) };
  }

  /** Renders the e-mail for one contact of the audience (or a sample contact) */
  async preview(id: string, email?: string) {
    RequestCtx.assert('crm.emailcampaign.read');
    const c = await this.owned(id);
    let data: MergeData | null = null;
    if (email) {
      const r = await this.prisma.emailRecipient.findFirst({ where: { campaignId: id, email: email.toLowerCase() } });
      if (r) data = { ...(r.data as MergeData), email: r.email };
    }
    if (!data) {
      const first = (await resolveAudience(this.prisma, c.companyId, audienceSchema.parse(c.audience))).contacts[0];
      data = first ?? { name: 'Budi Santoso', company: 'PT Contoh Usaha', email: 'budi@example.com', city: 'Jakarta' };
    }
    const s = await this.senderInfo(c.companyId, c);
    const r = renderEmail({ subject: c.subject, body: c.body, data, sender: s.sender, footerAddress: s.footerAddress, unsubscribeUrl: this.links(s.publicUrl, 'preview').unsubscribe });
    return { subject: r.subject, html: r.html, text: r.text, recipient: data };
  }

  // ------------------------------------------------------------------ write

  async create(body: unknown) {
    RequestCtx.assert('crm.emailcampaign.create');
    const input = this.parse(campaignSchema, body);
    this.assertAudienceAccess(input.audience);
    const u = RequestCtx.user();
    await this.assertLinkedCampaign(input.campaignId);
    const code = await this.sequence.next('EMAIL_CAMPAIGN', u.companyId);
    const row = await this.prisma.emailCampaign.create({
      data: {
        companyId: u.companyId,
        code,
        name: input.name,
        subject: input.subject,
        body: sanitizeHtml(input.body),
        fromName: input.fromName ?? null,
        replyTo: input.replyTo ?? null,
        campaignId: input.campaignId ?? null,
        audience: input.audience as Prisma.InputJsonValue,
        automatic: input.automatic,
        ratePerMinute: input.ratePerMinute,
        trackOpens: input.trackOpens,
        createdById: u.id,
      },
    });
    await this.audit.record(ENTITY, row.id, 'CREATE', undefined, { ...row, body: `${row.body.length} characters` });
    return row;
  }

  private async assertLinkedCampaign(id?: string | null) {
    if (!id) return;
    const c = await this.prisma.campaign.findFirst({ where: { id, companyId: RequestCtx.companyId(), deletedAt: null } });
    if (!c) throw new BadRequestException({ message: 'Validation failed', errors: { campaignId: 'Campaign not found' } });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('crm.emailcampaign.update');
    const before = await this.owned(id);
    const caps = this.capabilities(before);
    if (!caps.edit) throw new ConflictException(`A ${before.statusCode.toLowerCase()} campaign cannot be edited`);
    const input = this.parse(campaignSchema, body);
    const audienceChanged = JSON.stringify(input.audience) !== JSON.stringify(before.audience);
    if (audienceChanged && !caps.editAudience) throw new ConflictException('The audience cannot be changed after sending started. Pause an automatic campaign to change it, or duplicate this campaign.');
    if (audienceChanged) this.assertAudienceAccess(input.audience);
    await this.assertLinkedCampaign(input.campaignId);
    const after = await this.prisma.emailCampaign.update({
      where: { id },
      data: {
        name: input.name,
        subject: input.subject,
        body: sanitizeHtml(input.body),
        fromName: input.fromName ?? null,
        replyTo: input.replyTo ?? null,
        campaignId: input.campaignId ?? null,
        audience: input.audience as Prisma.InputJsonValue,
        automatic: before.startedAt ? before.automatic : input.automatic,
        ratePerMinute: input.ratePerMinute,
        trackOpens: input.trackOpens,
        updatedById: RequestCtx.user().id,
      },
    });
    await this.audit.record(ENTITY, id, 'UPDATE', { ...before, body: before.body.length }, { ...after, body: after.body.length });
    return after;
  }

  async remove(id: string) {
    RequestCtx.assert('crm.emailcampaign.delete');
    const c = await this.owned(id);
    if (!this.capabilities(c).delete) throw new ConflictException('Pause or cancel the campaign before deleting it');
    await this.prisma.emailCampaign.update({ where: { id }, data: { deletedAt: new Date(), updatedById: RequestCtx.user().id } });
    await this.audit.record(ENTITY, id, 'DELETE', { code: c.code, name: c.name, status: c.statusCode });
    return { ok: true };
  }

  async duplicate(id: string) {
    RequestCtx.assert('crm.emailcampaign.create');
    const c = await this.owned(id);
    return this.create({ name: `${c.name} (copy)`.slice(0, 200), subject: c.subject, body: c.body, fromName: c.fromName, replyTo: c.replyTo, campaignId: c.campaignId, audience: c.audience, automatic: c.automatic, ratePerMinute: c.ratePerMinute, trackOpens: c.trackOpens });
  }

  private async setStatus(c: EmailCampaign, status: string, action: string, extra: Prisma.EmailCampaignUpdateInput = {}, auditAfter?: Record<string, unknown>) {
    const after = await this.prisma.emailCampaign.update({ where: { id: c.id }, data: { statusCode: status, ...extra } });
    await this.audit.record(ENTITY, c.id, action, { status: c.statusCode }, { status, ...(auditAfter ?? {}) });
    this.bus.emit(c.companyId);
    return after;
  }

  async schedule(id: string, body: unknown) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    if (!this.capabilities(c).schedule) throw new ConflictException('Only draft or scheduled campaigns can be scheduled');
    const { scheduledAt } = this.parse(z.object({ scheduledAt: z.coerce.date() }), body);
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new BadRequestException({ message: 'Validation failed', errors: { scheduledAt: 'Choose a time in the future (or use Send now)' } });
    await this.assertSendable(c);
    return this.setStatus(c, 'SCHEDULED', 'SCHEDULE', { scheduledAt }, { scheduledAt: scheduledAt.toISOString() });
  }

  private async assertSendable(c: EmailCampaign) {
    if (!(await this.mail.isConfigured(c.companyId))) throw new BadRequestException('E-mail is not configured. Set the SMTP settings in System > Settings first.');
    const r = await resolveAudience(this.prisma, c.companyId, audienceSchema.parse(c.audience));
    if (!r.contacts.length && !c.automatic) throw new BadRequestException('The audience has no valid e-mail address to send to');
  }

  async sendNow(id: string) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    if (!this.capabilities(c).sendNow) throw new ConflictException('Only draft or scheduled campaigns can be sent');
    await this.assertSendable(c);
    const started = await this.setStatus(c, 'SENDING', 'SEND', { startedAt: new Date(), scheduledAt: c.scheduledAt ?? new Date() });
    await this.materialize(started);
    await this.processCampaign(started.id);
    return this.get(id);
  }

  async pause(id: string) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    if (!this.capabilities(c).pause) throw new ConflictException('Only sending or scheduled campaigns can be paused');
    // pausing a scheduled campaign simply takes it off the schedule
    return c.statusCode === 'SCHEDULED' ? this.setStatus(c, 'DRAFT', 'UNSCHEDULE', { scheduledAt: null }) : this.setStatus(c, 'PAUSED', 'PAUSE');
  }

  async resume(id: string) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    if (!this.capabilities(c).resume) throw new ConflictException('Only paused campaigns can be resumed');
    if (!(await this.mail.isConfigured(c.companyId))) throw new BadRequestException('E-mail is not configured. Set the SMTP settings in System > Settings first.');
    const after = await this.setStatus(c, 'SENDING', 'RESUME');
    if (c.automatic) await this.materialize(after);
    await this.processCampaign(after.id);
    return this.get(id);
  }

  async cancel(id: string) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    if (!this.capabilities(c).cancel) throw new ConflictException('This campaign cannot be cancelled');
    const skipped = await this.prisma.emailRecipient.updateMany({ where: { campaignId: id, statusCode: 'QUEUED' }, data: { statusCode: 'SKIPPED', error: 'Campaign cancelled' } });
    const after = await this.setStatus(c, 'CANCELLED', 'CANCEL', { finishedAt: new Date() }, { skipped: skipped.count });
    await this.refreshCounters(id);
    return after;
  }

  /** One test e-mail to the person editing the campaign; no recipient row is stored */
  async testSend(id: string, body: unknown) {
    RequestCtx.assert('crm.emailcampaign.send');
    const c = await this.owned(id);
    const { email } = this.parse(z.object({ email: z.email('Not a valid e-mail address').max(150) }), body);
    const p = await this.preview(id);
    const s = await this.senderInfo(c.companyId, c);
    const links = this.links(s.publicUrl, 'test');
    const r = renderEmail({ subject: c.subject, body: c.body, data: p.recipient, sender: s.sender, footerAddress: s.footerAddress, unsubscribeUrl: links.unsubscribe });
    await this.mail.send({ to: email, subject: `[Test] ${r.subject}`, text: r.text, html: r.html, fromName: s.sender, replyTo: s.replyTo, headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }, c.companyId);
    await this.audit.record(ENTITY, id, 'TEST_SEND', undefined, { to: email });
    return { sent: true, to: email };
  }

  // ------------------------------------------------------------------ sending engine

  /** Adds the audience contacts that are not recipients yet (once for normal campaigns, every tick for automatic ones). */
  async materialize(c: EmailCampaign) {
    const r = await resolveAudience(this.prisma, c.companyId, audienceSchema.parse(c.audience));
    if (!r.contacts.length) return 0;
    const existing = new Set((await this.prisma.emailRecipient.findMany({ where: { campaignId: c.id }, select: { email: true } })).map((x) => x.email));
    const fresh = r.contacts.filter((x: Contact) => !existing.has(x.email));
    if (!fresh.length) return 0;
    // createdAt keeps the audience order (oldest contacts first) so batches are predictable
    const base = Date.now();
    const res = await this.prisma.emailRecipient.createMany({
      data: fresh.map((x, i) => ({
        createdAt: new Date(base + i),
        campaignId: c.id,
        companyId: c.companyId,
        email: x.email,
        name: x.name,
        entityType: x.entityType,
        entityId: x.entityId,
        data: { name: x.name, company: x.company, city: x.city, email: x.email } as Prisma.InputJsonValue,
        token: randomBytes(24).toString('base64url'),
      })),
      skipDuplicates: true,
    });
    await this.refreshCounters(c.id);
    return res.count;
  }

  private async autoPause(c: EmailCampaign, reason: string) {
    await this.prisma.emailCampaign.update({ where: { id: c.id }, data: { statusCode: 'PAUSED' } });
    await this.audit.record(ENTITY, c.id, 'AUTO_PAUSE', { status: c.statusCode }, { status: 'PAUSED', reason });
    this.bus.emit(c.companyId);
    this.log.warn(`${c.code} paused: ${reason}`);
  }

  /**
   * One scheduler tick for a company (runs every minute as the system actor):
   * starts due scheduled campaigns, adds new contacts to automatic campaigns and sends the next batch
   * within the per-minute and daily limits.
   */
  async tick(companyId: string) {
    const now = new Date();
    const due = await this.prisma.emailCampaign.findMany({ where: { companyId, deletedAt: null, statusCode: 'SCHEDULED', scheduledAt: { lte: now } } });
    const smtp = await this.mail.isConfigured(companyId);
    for (const c of due) {
      if (!smtp) {
        await this.autoPause(c, 'E-mail is not configured. Set the SMTP settings in System > Settings, then resume.');
        continue;
      }
      const started = await this.prisma.emailCampaign.update({ where: { id: c.id }, data: { statusCode: 'SENDING', startedAt: now } });
      await this.audit.record(ENTITY, c.id, 'START', { status: 'SCHEDULED' }, { status: 'SENDING' });
      await this.materialize(started);
    }
    const sending = await this.prisma.emailCampaign.findMany({ where: { companyId, deletedAt: null, statusCode: 'SENDING' }, orderBy: { startedAt: 'asc' } });
    let sent = 0;
    for (const c of sending) {
      if (!smtp) {
        await this.autoPause(c, 'E-mail is not configured. Set the SMTP settings in System > Settings, then resume.');
        continue;
      }
      if (c.automatic) await this.materialize(c);
      sent += await this.processCampaign(c.id);
    }
    if (sending.length) this.mail.closeBulk(companyId);
    return { started: due.length, campaigns: sending.length, sent };
  }

  /** Sends the next batch of one SENDING campaign. Returns how many e-mails were sent. */
  async processCampaign(id: string): Promise<number> {
    const c = await this.prisma.emailCampaign.findUnique({ where: { id } });
    if (!c || c.statusCode !== 'SENDING' || c.deletedAt) return 0;
    const companyId = c.companyId;
    const limits = await this.limits(companyId);
    const dailyLeft = limits.dailyLimit - (await this.sentToday(companyId));
    const budget = Math.max(0, Math.min(c.ratePerMinute, limits.ratePerMinute, dailyLeft));
    let sentNow = 0;
    if (budget > 0) {
      // e-mails already sent in the last minute count against the per-minute rate (Send now + scheduler tick)
      const lastMinute = await this.prisma.emailRecipient.count({ where: { campaignId: id, sentAt: { gte: new Date(Date.now() - 60_000) } } });
      const take = Math.max(0, budget - lastMinute);
      const batch = take ? await this.prisma.emailRecipient.findMany({ where: { campaignId: id, statusCode: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take }) : [];
      if (batch.length) {
        const suppressed = new Set((await this.prisma.emailSuppression.findMany({ where: { companyId, email: { in: batch.map((b) => b.email) } }, select: { email: true } })).map((s) => s.email));
        const s = await this.senderInfo(companyId, c);
        for (const r of batch) {
          const outcome = await this.sendOne(c, r, s, suppressed.has(r.email));
          if (outcome === 'sent') sentNow++;
          if (outcome === 'stop') {
            await this.autoPause(c, 'The mail server refused the login or could not be reached. Check the SMTP settings, then resume.');
            break;
          }
        }
      }
    }
    await this.refreshCounters(id);
    if (!c.automatic) {
      const left = await this.prisma.emailRecipient.count({ where: { campaignId: id, statusCode: 'QUEUED' } });
      const current = await this.prisma.emailCampaign.findUnique({ where: { id }, select: { statusCode: true } });
      if (!left && current?.statusCode === 'SENDING') {
        await this.prisma.emailCampaign.update({ where: { id }, data: { statusCode: 'SENT', finishedAt: new Date() } });
        await this.audit.record(ENTITY, id, 'FINISH', { status: 'SENDING' }, { status: 'SENT' });
      }
    }
    if (sentNow) this.bus.emit(companyId);
    return sentNow;
  }

  private async sendOne(c: EmailCampaign, r: Recipient, s: Awaited<ReturnType<CampaignService['senderInfo']>>, suppressed: boolean): Promise<'sent' | 'skipped' | 'failed' | 'retry' | 'stop'> {
    if (suppressed) {
      await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { statusCode: 'SKIPPED', error: 'On the do-not-email list' } });
      return 'skipped';
    }
    const links = this.links(s.publicUrl, r.token);
    const rendered = renderEmail({ subject: c.subject, body: c.body, data: { ...(r.data as MergeData), email: r.email }, sender: s.sender, footerAddress: s.footerAddress, unsubscribeUrl: links.unsubscribe, openPixelUrl: c.trackOpens ? links.pixel : null });
    try {
      await this.mail.sendBulk(
        {
          to: r.name ? `"${r.name.replace(/["<>\r\n]/g, '')}" <${r.email}>` : r.email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          fromName: s.sender,
          replyTo: s.replyTo,
          headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Campaign-Id': c.code },
        },
        c.companyId,
      );
      await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { statusCode: 'SENT', sentAt: new Date(), error: null } });
      return 'sent';
    } catch (e) {
      const err = e as { responseCode?: number; code?: string; message?: string };
      const message = String(err.message ?? e).slice(0, 480);
      if (err.code === 'EAUTH' || (!err.responseCode && /ECONNREFUSED|EDNS|ENOTFOUND/.test(String(err.code ?? '')))) {
        // the server itself is unusable: do not burn the recipient's attempts
        return 'stop';
      }
      if (err.responseCode && err.responseCode >= 500) {
        const bounced = BOUNCE_CODES.has(err.responseCode);
        await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { statusCode: bounced ? 'BOUNCED' : 'FAILED', error: message } });
        if (bounced)
          await this.prisma.emailSuppression.upsert({
            where: { companyId_email: { companyId: c.companyId, email: r.email } },
            create: { companyId: c.companyId, email: r.email, reasonCode: 'BOUNCED', note: message.slice(0, 300), campaignId: c.id },
            update: {},
          });
        return 'failed';
      }
      // temporary (4xx / network): retry on a later tick, at most MAX_ATTEMPTS times
      const attempts = ((r.data as { _attempts?: number } | null)?._attempts ?? 0) + 1;
      await this.prisma.emailRecipient.update({
        where: { id: r.id },
        data: { statusCode: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'QUEUED', error: message, data: { ...((r.data as object) ?? {}), _attempts: attempts } as Prisma.InputJsonValue },
      });
      return attempts >= MAX_ATTEMPTS ? 'failed' : 'retry';
    }
  }

  // ------------------------------------------------------------------ do-not-email list

  async suppressions(q: { page: number; pageSize: number; search?: string; reason?: string }) {
    RequestCtx.assert('crm.emailcampaign.read');
    const where: Prisma.EmailSuppressionWhereInput = { companyId: RequestCtx.companyId() };
    if (q.reason) where.reasonCode = q.reason;
    if (q.search) where.email = { contains: q.search.toLowerCase() };
    const [rows, total] = await Promise.all([this.prisma.emailSuppression.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.prisma.emailSuppression.count({ where })]);
    return paged(rows, total, q);
  }

  async addSuppressions(body: unknown) {
    RequestCtx.assert('crm.suppression.manage');
    const input = this.parse(z.object({ emails: z.string().min(1, 'Enter at least one address').max(200_000), reasonCode: z.string().max(20).default('MANUAL'), note: optText(300) }), body);
    const valid = await this.prisma.lookupValue.findFirst({ where: { category: 'EMAIL_SUPPRESSION_REASON', code: input.reasonCode, isActive: true, deletedAt: null } });
    if (!valid) throw new BadRequestException({ message: 'Validation failed', errors: { reasonCode: 'Not a valid option' } });
    const companyId = RequestCtx.companyId();
    const tokens = input.emails.split(/[\s,;]+/).filter(Boolean);
    const normalized = tokens.map((e) => normalizeEmail(e));
    const invalid = normalized.filter((e) => !e).length;
    const emails = [...new Set(normalized.filter((e): e is string => !!e))];
    const res = await this.prisma.emailSuppression.createMany({ data: emails.map((email) => ({ companyId, email, reasonCode: input.reasonCode, note: input.note ?? null })), skipDuplicates: true });
    // queued recipients of running campaigns are skipped right away
    await this.prisma.emailRecipient.updateMany({ where: { companyId, email: { in: emails }, statusCode: 'QUEUED' }, data: { statusCode: 'SKIPPED', error: 'On the do-not-email list' } });
    await this.audit.record('E-mail Suppression', null, 'ADD', undefined, { added: res.count, reason: input.reasonCode });
    return { added: res.count, alreadyListed: emails.length - res.count, invalid };
  }

  async removeSuppression(id: string) {
    RequestCtx.assert('crm.suppression.manage');
    if (!isUuid(id)) throw new NotFoundException('Not found');
    const row = await this.prisma.emailSuppression.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!row) throw new NotFoundException('Not found');
    await this.prisma.emailSuppression.delete({ where: { id } });
    await this.audit.record('E-mail Suppression', id, 'DELETE', { email: row.email, reason: row.reasonCode });
    return { ok: true };
  }
}
