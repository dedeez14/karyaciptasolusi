import { BadRequestException, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';

/** Outbound e-mail through the SMTP server configured in System > Settings (e.g. Hostinger mail). */
@Injectable()
export class MailService {
  constructor(private readonly settings: SettingsService) {}

  async send(msg: { to: string; cc?: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }) {
    const c = RequestCtx.companyId();
    const host = await this.settings.str('mail.host', c);
    const user = await this.settings.str('mail.username', c);
    const pass = await this.settings.str('mail.password', c);
    const from = await this.settings.str('mail.from', c, user);
    if (!host || !user || !pass) throw new BadRequestException('E-mail is not configured. Set the SMTP settings in System > Settings.');
    const port = await this.settings.num('mail.port', c, 465);
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, requireTLS: port !== 465, tls: { minVersion: 'TLSv1.2' } });
    // strip CR/LF from header values (header injection)
    const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
    await transport.sendMail({ from, to: clean(msg.to), cc: msg.cc ? clean(msg.cc) : undefined, subject: clean(msg.subject), text: msg.text, attachments: msg.attachments });
  }
}
