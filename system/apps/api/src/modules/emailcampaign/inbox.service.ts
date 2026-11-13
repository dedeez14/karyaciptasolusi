import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { NotificationBus } from '../../common/events/notification-bus';
import { paged } from '../../common/utils/query';
import { MailService } from '../integrations/mail.service';
import { CampaignService } from './campaign.service';

/** only the beginning of each message is downloaded (headers, the reply text, the delivery report) */
const SOURCE_LIMIT = 96 * 1024;
const MAX_PER_RUN = 300;
const FIRST_RUN_DAYS = 30;
/** a message from an address is a reply only when that address received a campaign e-mail this recently */
const MATCH_DAYS = 90;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export type ReplyKind = 'REPLY' | 'AUTO_REPLY' | 'BOUNCE';

export interface InboundMessage {
  uid: number;
  messageId: string;
  date: Date;
  from: string | null;
  fromName: string | null;
  subject: string;
  /** Message-IDs this message refers to (In-Reply-To + References) */
  refs: string[];
  headers: Record<string, string>;
  text: string;
  raw: string;
}

const AUTO_SUBJECT = /^\s*(auto(matic|matische)?[\s:-]*(reply|response|antwort)|out of (the )?office|ooo\b|away from|balasan otomatis|dibalas otomatis|sedang cuti|abwesenheit|r[ée]ponse automatique)/i;
const DAEMON = /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?)@/i;

/** Permanent delivery failure report: the addresses that bounced (empty for delays and other mail) */
export function bouncedAddresses(m: Pick<InboundMessage, 'from' | 'headers' | 'raw' | 'subject'>): string[] {
  const isReport = /multipart\/report/i.test(m.headers['content-type'] ?? '') || DAEMON.test(m.from ?? '') || /^(undeliver|delivery status notification \(failure\)|mail delivery failed|returned mail|failure notice)/i.test(m.subject);
  if (!isReport) return [];
  const raw = m.raw;
  const permanent = /^Status:\s*5\.\d{1,3}\.\d{1,3}/im.test(raw) || /^Action:\s*failed/im.test(raw) || /\b55[0-4][\s-]5\.\d/.test(raw);
  const onlyDelayed = /^Action:\s*delayed/im.test(raw) && !/^Action:\s*failed/im.test(raw);
  if (!permanent || onlyDelayed) return [];
  const found = new Set<string>();
  for (const x of raw.matchAll(/^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/gim)) found.add(x[1].toLowerCase());
  for (const x of (m.headers['x-failed-recipients'] ?? '').split(',')) if (x.includes('@')) found.add(x.trim().toLowerCase());
  return [...found];
}

/** Out-of-office and other automatic answers (they must not stop the follow-ups) */
export function isAutoReply(m: Pick<InboundMessage, 'headers' | 'subject'>) {
  const h = m.headers;
  const auto = (h['auto-submitted'] ?? '').toLowerCase();
  if (auto && auto !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-autoresponse']) return true;
  if (/^(auto_reply|auto-reply|bulk|junk|list)$/i.test((h['precedence'] ?? '').trim())) return true;
  return AUTO_SUBJECT.test(m.subject);
}

/** The new text of a reply, without the quoted original e-mail; at most 400 characters */
export function replySnippet(text: string) {
  const lines: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^(On|Pada|Le|Am|El)\s.+(wrote|menulis|a écrit|schrieb|escribió):?$/i.test(t)) break;
    if (/^-{2,}\s*(Original Message|Pesan Asli|Forwarded)/i.test(t) || /^_{5,}$/.test(t)) break;
    if (/^(From|Dari):\s/i.test(t) && lines.length) break;
    lines.push(t);
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function toInbound(uid: number, parsed: ParsedMail, raw: string): InboundMessage {
  const headers: Record<string, string> = {};
  for (const [k, v] of parsed.headers) {
    if (typeof v === 'string') headers[k] = v;
    else if (v && typeof v === 'object' && 'value' in (v as object)) headers[k] = String((v as { value: unknown }).value);
    else if (v != null) headers[k] = String(v);
  }
  const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])]
    .filter((x): x is string => !!x)
    .flatMap((x) => x.match(/<[^<>\s]+>/g) ?? []);
  const from = parsed.from?.value[0];
  return {
    uid,
    messageId: (parsed.messageId ?? '').slice(0, 250),
    date: parsed.date ?? new Date(),
    from: from?.address?.toLowerCase() ?? null,
    fromName: from?.name || null,
    subject: (parsed.subject ?? '').slice(0, 300),
    refs: [...new Set(refs)],
    headers,
    text: parsed.text ?? '',
    raw,
  };
}

/**
 * Finds replies, automatic replies and bounces of campaign e-mails in the company mailbox (IMAP, read only):
 * - a reply stops the follow-ups for that address and creates a CRM activity on the lead / customer
 * - a bounce marks the recipient and puts the address on the do-not-email list
 * Messages that do not belong to a campaign are never stored.
 */
@Injectable()
export class InboxService {
  private readonly log = new Logger('EmailInbox');
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly campaigns: CampaignService,
    private readonly bus: NotificationBus,
  ) {}

  // ------------------------------------------------------------------ mailbox check

  /** Reads new messages of one company. Never throws for mailbox problems: they are stored as the last error. */
  async check(companyId: string): Promise<{ checked: number; replies: number; bounces: number; autoReplies: number; error?: string }> {
    if (this.running.has(companyId)) return { checked: 0, replies: 0, bounces: 0, autoReplies: 0, error: 'A check is already running' };
    const cfg = await this.mail.imapConfig(companyId);
    if (!cfg) return { checked: 0, replies: 0, bounces: 0, autoReplies: 0, error: 'The mailbox is not configured' };
    this.running.add(companyId);
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port !== 143,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
      socketTimeout: 120_000,
      disableAutoIdle: true,
    });
    client.on('error', (e: Error) => this.log.warn(`IMAP ${companyId}: ${e.message}`));
    try {
      await client.connect();
      const box = await client.mailboxOpen('INBOX', { readOnly: true });
      const validity = String(box.uidValidity);
      const state = await this.prisma.emailInboxState.findUnique({ where: { companyId } });
      let uids: number[];
      if (state && state.uidValidity === validity) {
        uids = state.lastUid + 1 < box.uidNext ? ((await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || []) : [];
        uids = uids.filter((u) => u > state.lastUid);
      } else {
        // first check (or the mailbox was rebuilt): from the first campaign e-mail, at most 30 days back
        const first = await this.prisma.emailMessage.findFirst({ where: { companyId }, orderBy: { sentAt: 'asc' }, select: { sentAt: true } });
        const floor = Date.now() - FIRST_RUN_DAYS * 86_400_000;
        const since = new Date(Math.max(first?.sentAt.getTime() ?? Date.now(), floor) - 86_400_000);
        uids = (await client.search({ since }, { uid: true })) || [];
      }
      uids.sort((a, b) => a - b);
      const batch = uids.slice(0, MAX_PER_RUN);
      const fetched: { uid: number; source: Buffer }[] = [];
      if (batch.length) {
        for await (const m of client.fetch(batch.join(','), { uid: true, source: { maxLength: SOURCE_LIMIT } }, { uid: true })) {
          if (m.source) fetched.push({ uid: m.uid, source: m.source });
        }
      }
      await client.logout().catch(() => undefined);

      const result = { checked: fetched.length, replies: 0, bounces: 0, autoReplies: 0 };
      const own = (cfg.user ?? '').toLowerCase();
      for (const f of fetched) {
        try {
          const raw = f.source.toString('utf8');
          const parsed = await simpleParser(f.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
          const msg = toInbound(f.uid, parsed, raw);
          if (!msg.messageId) msg.messageId = `<uid-${validity}-${f.uid}@imap>`;
          if (msg.from === own && !bouncedAddresses(msg).length) continue; // our own e-mail copied to the inbox
          const kind = await this.handle(companyId, msg);
          if (kind === 'REPLY') result.replies++;
          else if (kind === 'BOUNCE') result.bounces++;
          else if (kind === 'AUTO_REPLY') result.autoReplies++;
        } catch (e) {
          this.log.warn(`message ${f.uid} skipped: ${(e as Error).message}`);
        }
      }
      const lastUid = batch.length ? batch[batch.length - 1] : (state?.uidValidity === validity ? state.lastUid : Math.max(0, box.uidNext - 1));
      await this.prisma.emailInboxState.upsert({
        where: { companyId },
        create: { companyId, uidValidity: validity, lastUid, lastCheckedAt: new Date(), lastError: null },
        update: { uidValidity: validity, lastUid, lastCheckedAt: new Date(), lastError: null },
      });
      if (result.replies || result.bounces || result.autoReplies) this.bus.emit(companyId);
      return result;
    } catch (e) {
      const err = e as { message?: string; authenticationFailed?: boolean; responseText?: string };
      const message = (err.authenticationFailed ? 'The mail server refused the login. Check the mailbox username and password in System > Settings > E-mail.' : (err.responseText || err.message || String(e))).slice(0, 480);
      await this.prisma.emailInboxState.upsert({
        where: { companyId },
        create: { companyId, lastError: message, lastErrorAt: new Date() },
        update: { lastError: message, lastErrorAt: new Date() },
      });
      client.close();
      return { checked: 0, replies: 0, bounces: 0, autoReplies: 0, error: message };
    } finally {
      this.running.delete(companyId);
    }
  }

  /** Classifies one message and applies its effect. Returns null when it does not belong to a campaign. */
  async handle(companyId: string, msg: InboundMessage): Promise<ReplyKind | null> {
    const bounced = bouncedAddresses(msg);
    if (bounced.length) return this.handleBounce(companyId, msg, bounced);

    const recipient = await this.matchRecipient(companyId, msg);
    if (!recipient) return null;
    const kind: ReplyKind = isAutoReply(msg) ? 'AUTO_REPLY' : 'REPLY';
    const snippet = replySnippet(msg.text) || null;
    const created = await this.prisma.emailReply.createMany({
      data: [{ companyId, campaignId: recipient.campaignId, recipientId: recipient.id, kindCode: kind, fromEmail: msg.from!, fromName: msg.fromName?.slice(0, 200) ?? null, subject: msg.subject || null, snippet, messageId: msg.messageId, receivedAt: msg.date }],
      skipDuplicates: true,
    });
    if (!created.count) return null; // seen in an earlier check
    if (kind === 'REPLY') await this.applyReply(companyId, recipient, msg.date, { subject: msg.subject, snippet });
    return kind;
  }

  private async matchRecipient(companyId: string, msg: InboundMessage) {
    if (msg.refs.length) {
      const sent = await this.prisma.emailMessage.findFirst({ where: { companyId, messageId: { in: msg.refs } }, orderBy: { sentAt: 'desc' }, select: { recipientId: true } });
      if (sent) {
        const r = await this.prisma.emailRecipient.findUnique({ where: { id: sent.recipientId } });
        if (r) return r;
      }
    }
    if (!msg.from) return null;
    // reply written as a new e-mail: the most recent campaign e-mail to that address before it arrived
    return this.prisma.emailRecipient.findFirst({
      where: { companyId, email: msg.from, lastSentAt: { gte: new Date(Date.now() - MATCH_DAYS * 86_400_000), lte: msg.date } },
      orderBy: { lastSentAt: 'desc' },
    });
  }

  /** Stops every follow-up to the address, marks the recipient as replied and creates a CRM activity */
  private async applyReply(companyId: string, r: Prisma.EmailRecipientGetPayload<object>, at: Date, info: { subject: string; snippet: string | null }) {
    const campaign = await this.prisma.emailCampaign.findUnique({ where: { id: r.campaignId }, select: { id: true, code: true, name: true } });
    await this.prisma.emailRecipient.update({
      where: { id: r.id },
      data: { repliedAt: r.repliedAt ?? at, nextSendAt: null, ...(r.statusCode === 'SENT' ? { statusCode: 'REPLIED', error: null } : {}) },
    });
    await this.prisma.emailRecipient.updateMany({
      where: { companyId, email: r.email, id: { not: r.id }, nextSendAt: { not: null } },
      data: { nextSendAt: null, error: `Replied to ${campaign?.code ?? 'another campaign'}: follow-ups stopped` },
    });
    await this.campaigns.refreshCounters(r.campaignId);
    // a to-do for the owner of the lead / customer: answer the reply
    const subject = `Reply to ${campaign?.code ?? 'campaign'}${info.subject ? `: ${info.subject}` : ''}`.slice(0, 200);
    const notes = [`${r.name ? `${r.name} <${r.email}>` : r.email} replied to the e-mail campaign ${campaign?.code ?? ''} ${campaign?.name ?? ''}.`.trim(), info.snippet ? `\n"${info.snippet}"` : ''].join('');
    if (r.entityType === 'LEAD' && r.entityId) {
      const lead = await this.prisma.lead.findFirst({ where: { id: r.entityId, companyId, deletedAt: null }, select: { id: true, ownerId: true, branchId: true } });
      if (lead) await this.prisma.crmActivity.create({ data: { companyId, branchId: lead.branchId, typeCode: 'EMAIL', subject, leadId: lead.id, ownerId: lead.ownerId, dueDate: new Date(), notes } });
    } else if (r.entityType === 'CUSTOMER' && r.entityId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: r.entityId, companyId, deletedAt: null }, select: { id: true } });
      if (customer) await this.prisma.crmActivity.create({ data: { companyId, typeCode: 'EMAIL', subject, customerId: customer.id, dueDate: new Date(), notes } });
    }
    await this.audit.record('E-mail Campaign', r.campaignId, 'REPLY_RECEIVED', undefined, { recipient: r.email });
  }

  private async handleBounce(companyId: string, msg: InboundMessage, addresses: string[]): Promise<ReplyKind | null> {
    // the bounced e-mail is ours when its Message-ID (quoted in the report) or the address matches a campaign e-mail
    const ids = [...new Set([...msg.raw.matchAll(/^Message-ID:\s*(<[^<>\s]+>)/gim)].map((x) => x[1]))];
    const viaId = ids.length ? await this.prisma.emailMessage.findMany({ where: { companyId, messageId: { in: ids } }, select: { recipientId: true } }) : [];
    const recipients = await this.prisma.emailRecipient.findMany({
      where: { companyId, OR: [{ id: { in: viaId.map((v) => v.recipientId) } }, { email: { in: addresses }, lastSentAt: { gte: new Date(Date.now() - MATCH_DAYS * 86_400_000) } }] },
      orderBy: { lastSentAt: 'desc' },
    });
    const hit = recipients.filter((r) => addresses.includes(r.email) || viaId.some((v) => v.recipientId === r.id));
    if (!hit.length) return null;
    const diagnostic = /^Diagnostic-Code:\s*(.+)$/im.exec(msg.raw)?.[1]?.trim() ?? /^Status:\s*(5\.\d+\.\d+)/im.exec(msg.raw)?.[1] ?? 'Delivery failed';
    const created = await this.prisma.emailReply.createMany({
      data: [{ companyId, campaignId: hit[0].campaignId, recipientId: hit[0].id, kindCode: 'BOUNCE', fromEmail: hit[0].email, fromName: null, subject: msg.subject || null, snippet: diagnostic.slice(0, 400), messageId: msg.messageId, receivedAt: msg.date }],
      skipDuplicates: true,
    });
    if (!created.count) return null;
    const campaignsTouched = new Set<string>();
    for (const r of hit) {
      await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { statusCode: 'BOUNCED', nextSendAt: null, error: `Bounced: ${diagnostic}`.slice(0, 480) } });
      campaignsTouched.add(r.campaignId);
    }
    for (const email of new Set(hit.map((r) => r.email))) {
      await this.prisma.emailSuppression.upsert({
        where: { companyId_email: { companyId, email } },
        create: { companyId, email, reasonCode: 'BOUNCED', note: diagnostic.slice(0, 300), campaignId: hit[0].campaignId },
        update: {},
      });
      await this.prisma.emailRecipient.updateMany({ where: { companyId, email, nextSendAt: { not: null } }, data: { nextSendAt: null, error: 'Address bounced: follow-ups stopped' } });
      await this.prisma.emailRecipient.updateMany({ where: { companyId, email, statusCode: 'QUEUED' }, data: { statusCode: 'SKIPPED', error: 'Address bounced' } });
    }
    for (const id of campaignsTouched) await this.campaigns.refreshCounters(id);
    await this.audit.record('E-mail Suppression', null, 'BOUNCE_RECEIVED', undefined, { addresses: hit.length });
    return 'BOUNCE';
  }

  // ------------------------------------------------------------------ user actions

  async checkNow() {
    RequestCtx.assert('crm.emailcampaign.update');
    const companyId = RequestCtx.companyId();
    if (!(await this.mail.imapConfig(companyId))) throw new BadRequestException('Set the IMAP host and the mailbox login in System > Settings > E-mail first.');
    const r = await this.check(companyId);
    if (r.error) throw new BadRequestException(r.error);
    return r;
  }

  async list(q: { page: number; pageSize: number; kind?: string; open?: boolean; search?: string; campaignId?: string }) {
    RequestCtx.assert('crm.emailcampaign.read');
    const companyId = RequestCtx.companyId();
    const where: Prisma.EmailReplyWhereInput = { companyId };
    if (q.kind) where.kindCode = q.kind;
    if (q.open) where.handledAt = null;
    if (q.campaignId) where.campaignId = q.campaignId;
    if (q.search) where.OR = [{ fromEmail: { contains: q.search.toLowerCase() } }, { fromName: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.emailReply.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.emailReply.count({ where }),
    ]);
    const campaigns = await this.prisma.emailCampaign.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.campaignId).filter((x): x is string => !!x))] } }, select: { id: true, code: true, name: true } });
    const recipients = await this.prisma.emailRecipient.findMany({ where: { id: { in: rows.map((r) => r.recipientId).filter((x): x is string => !!x) } }, select: { id: true, name: true, entityType: true, entityId: true, data: true } });
    const cm = new Map(campaigns.map((c) => [c.id, c]));
    const rm = new Map(recipients.map((r) => [r.id, r]));
    return paged(
      rows.map((r) => {
        const rec = r.recipientId ? rm.get(r.recipientId) : undefined;
        return { ...r, campaign: r.campaignId ? (cm.get(r.campaignId) ?? null) : null, contact: rec ? { name: rec.name, company: (rec.data as { company?: string } | null)?.company ?? null, entityType: rec.entityType, entityId: rec.entityId } : null };
      }),
      total,
      q,
    );
  }

  async setHandled(id: string, handled: boolean) {
    RequestCtx.assert('crm.emailcampaign.update');
    if (!isUuid(id)) throw new NotFoundException('Reply not found');
    const r = await this.prisma.emailReply.findFirst({ where: { id, companyId: RequestCtx.companyId() } });
    if (!r) throw new NotFoundException('Reply not found');
    const after = await this.prisma.emailReply.update({ where: { id }, data: handled ? { handledAt: new Date(), handledById: RequestCtx.user().id } : { handledAt: null, handledById: null } });
    await this.audit.record('E-mail Reply', id, handled ? 'HANDLED' : 'REOPEN', { handledAt: r.handledAt }, { handledAt: after.handledAt });
    this.bus.emit(r.companyId);
    return after;
  }

  /** Replied by phone / WhatsApp / another mailbox: stop the follow-ups by hand */
  async markReplied(campaignId: string, recipientId: string) {
    RequestCtx.assert('crm.emailcampaign.update');
    if (!isUuid(campaignId) || !isUuid(recipientId)) throw new NotFoundException('Recipient not found');
    const companyId = RequestCtx.companyId();
    const r = await this.prisma.emailRecipient.findFirst({ where: { id: recipientId, campaignId, companyId } });
    if (!r) throw new NotFoundException('Recipient not found');
    if (!r.sentAt) throw new ConflictException('This recipient has not received the e-mail yet');
    if (r.repliedAt) return { ok: true };
    await this.prisma.emailRecipient.update({ where: { id: r.id }, data: { repliedAt: new Date(), nextSendAt: null, ...(r.statusCode === 'SENT' ? { statusCode: 'REPLIED', error: null } : {}) } });
    await this.prisma.emailRecipient.updateMany({ where: { companyId, email: r.email, id: { not: r.id }, nextSendAt: { not: null } }, data: { nextSendAt: null, error: 'Marked as replied: follow-ups stopped' } });
    await this.campaigns.refreshCounters(campaignId);
    await this.audit.record('E-mail Campaign', campaignId, 'MARK_REPLIED', undefined, { recipient: r.email });
    this.bus.emit(companyId);
    return { ok: true };
  }
}
