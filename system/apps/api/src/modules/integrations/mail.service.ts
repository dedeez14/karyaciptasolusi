import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';

export interface MailMessage {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  /** optional HTML alternative (already sanitised by the caller) */
  html?: string;
  /** display name in front of the configured sender address */
  fromName?: string;
  replyTo?: string;
  /** extra headers, e.g. List-Unsubscribe */
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer }[];
  /** own Message-ID ("<id@domain>"), so replies can be matched to this e-mail */
  messageId?: string;
  /** threading: the Message-ID this e-mail follows up on */
  inReplyTo?: string;
  references?: string[];
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** plain connection without TLS (only for a local relay / test sink on localhost) */
  insecureLocal: boolean;
}

/** strip CR/LF from header values (header injection) */
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const isLocalHost = (h: string) => /^(localhost|127\.0\.0\.1|::1)$/i.test(h);

/** Outbound e-mail through the SMTP server configured in System > Settings (e.g. Hostinger mail). */
@Injectable()
export class MailService implements OnModuleDestroy {
  /** pooled transporters for bulk sending, one per company + configuration */
  private pools = new Map<string, { key: string; transport: Transporter }>();

  constructor(private readonly settings: SettingsService) {}

  onModuleDestroy() {
    for (const p of this.pools.values()) p.transport.close();
    this.pools.clear();
  }

  private async config(companyId: string): Promise<SmtpConfig | null> {
    const host = await this.settings.str('mail.host', companyId);
    const user = await this.settings.str('mail.username', companyId);
    const pass = await this.settings.str('mail.password', companyId);
    if (!host || !user || !pass) return null;
    const port = await this.settings.num('mail.port', companyId, 465);
    const from = await this.settings.str('mail.from', companyId, user);
    return { host, port, user, pass, from, insecureLocal: isLocalHost(host) && port !== 465 && port !== 587 };
  }

  /** A new Message-ID on the domain of the sender address */
  async newMessageId(companyId: string) {
    const c = await this.config(companyId);
    const address = c ? (/<([^>]+)>/.exec(c.from)?.[1] ?? c.from) : '';
    const domain = (address.split('@')[1] ?? 'localhost').replace(/[^a-z0-9.-]/gi, '') || 'localhost';
    return `<${randomUUID()}@${domain}>`;
  }

  /** Incoming mail (IMAP over TLS) with the same mailbox login as SMTP; null when not configured */
  async imapConfig(companyId: string): Promise<ImapConfig | null> {
    const host = await this.settings.str('mail.imapHost', companyId);
    const user = await this.settings.str('mail.username', companyId);
    const pass = await this.settings.str('mail.password', companyId);
    if (!host || !user || !pass) return null;
    return { host, port: await this.settings.num('mail.imapPort', companyId, 993), user, pass };
  }

  /** true when SMTP host, user and password are set for the company */
  async isConfigured(companyId: string = RequestCtx.companyId()) {
    return (await this.config(companyId)) !== null;
  }

  private create(c: SmtpConfig, pool: boolean): Transporter {
    if (c.insecureLocal)
      return nodemailer.createTransport({ host: c.host, port: c.port, secure: false, ignoreTLS: true, auth: { user: c.user, pass: c.pass }, pool, maxConnections: 2 } as any);
    return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, requireTLS: c.port !== 465, tls: { minVersion: 'TLSv1.2' }, pool, maxConnections: 2, maxMessages: 100 } as any);
  }

  private envelope(c: SmtpConfig, msg: MailMessage) {
    const fromName = msg.fromName ? clean(msg.fromName).replace(/["<>]/g, '') : '';
    const address = /<([^>]+)>/.exec(c.from)?.[1] ?? c.from;
    return {
      from: fromName ? `"${fromName}" <${address}>` : c.from,
      to: clean(msg.to),
      cc: msg.cc ? clean(msg.cc) : undefined,
      replyTo: msg.replyTo ? clean(msg.replyTo) : undefined,
      subject: clean(msg.subject),
      text: msg.text,
      html: msg.html,
      headers: msg.headers ? Object.fromEntries(Object.entries(msg.headers).map(([k, v]) => [clean(k), clean(v)])) : undefined,
      attachments: msg.attachments,
      messageId: msg.messageId ? clean(msg.messageId) : undefined,
      inReplyTo: msg.inReplyTo ? clean(msg.inReplyTo) : undefined,
      references: msg.references?.length ? msg.references.map(clean) : undefined,
    };
  }

  /** Sends one message (transactional mail: documents, reminders, tickets). */
  async send(msg: MailMessage, companyId: string = RequestCtx.companyId()) {
    const c = await this.config(companyId);
    if (!c) throw new BadRequestException('E-mail is not configured. Set the SMTP settings in System > Settings.');
    const transport = this.create(c, false);
    try {
      await transport.sendMail(this.envelope(c, msg));
    } finally {
      transport.close();
    }
  }

  /**
   * Sends through a pooled connection that is reused between calls (bulk / campaign sending).
   * The pool is rebuilt automatically when the SMTP settings change.
   */
  async sendBulk(msg: MailMessage, companyId: string = RequestCtx.companyId()) {
    const c = await this.config(companyId);
    if (!c) throw new BadRequestException('E-mail is not configured. Set the SMTP settings in System > Settings.');
    const key = `${c.host}|${c.port}|${c.user}|${c.pass.length}|${c.from}`;
    let p = this.pools.get(companyId);
    if (!p || p.key !== key) {
      p?.transport.close();
      p = { key, transport: this.create(c, true) };
      this.pools.set(companyId, p);
    }
    return p.transport.sendMail(this.envelope(c, msg));
  }

  /** Closes the pooled connection of a company (after a campaign tick). */
  closeBulk(companyId: string) {
    const p = this.pools.get(companyId);
    if (p) {
      p.transport.close();
      this.pools.delete(companyId);
    }
  }
}
