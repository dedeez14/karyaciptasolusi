import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestCtx } from '../../common/context/request-context';
import { D } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { SubscriptionService } from './subscription.service';
import { dateOnly, todayIso } from './job-context';

export interface ReminderRunResult {
  enabled: boolean;
  mailConfigured: boolean;
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  details: {
    invoice: string;
    level?: number;
    to?: string;
    status: 'SENT' | 'SKIPPED' | 'FAILED';
    reason?: string;
  }[];
}

/** Overdue invoice reminders: one e-mail per configured step ("3,7,14" days after the due date). */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger('InvoiceReminders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly billing: SubscriptionService,
  ) {}

  async schedule(companyId: string) {
    const raw = await this.settings.str('sales.reminderDays', companyId, '3,7,14');
    return [
      ...new Set(
        raw
          .split(/[,;\s]+/)
          .map((x) => Number(x))
          .filter((x) => Number.isInteger(x) && x >= 0 && x <= 365),
      ),
    ].sort((a, b) => a - b);
  }

  /**
   * Sends the reminders that are due for the active company.
   * @param force run even when automatic reminders are disabled (manual "Send now")
   */
  async run(force = false): Promise<ReminderRunResult> {
    const companyId = RequestCtx.companyId();
    const enabled = await this.settings.bool('sales.reminderEnabled', companyId, false);
    const mailConfigured = await this.billing.mailConfigured();
    const out: ReminderRunResult = {
      enabled,
      mailConfigured,
      checked: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };
    if ((!enabled && !force) || !mailConfigured) return out;

    const steps = await this.schedule(companyId);
    if (!steps.length) return out;
    const message = await this.settings.str('sales.reminderMessage', companyId, 'This is a friendly reminder that the attached invoice is past its due date.');
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true },
    });
    const today = dateOnly(todayIso());
    const overdue = await this.prisma.tradeDocument.findMany({
      where: {
        companyId,
        docType: 'SI',
        deletedAt: null,
        status: { in: ['CONFIRMED', 'PARTIAL'] },
        dueDate: { lt: today },
      },
      select: {
        id: true,
        number: true,
        dueDate: true,
        grandTotal: true,
        paidAmount: true,
        currencyCode: true,
        customerId: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 1000,
    });
    const sentLevels = await this.prisma.invoiceReminder.groupBy({
      by: ['documentId'],
      where: { documentId: { in: overdue.map((d) => d.id) } },
      _max: { level: true },
    });
    const maxSent = new Map(sentLevels.map((r) => [r.documentId, r._max.level ?? 0]));
    const customers = await this.prisma.customer.findMany({
      where: {
        id: {
          in: overdue.map((d) => d.customerId).filter(Boolean) as string[],
        },
      },
      select: { id: true, name: true, email: true },
    });
    const cm = new Map(customers.map((c) => [c.id, c]));

    for (const d of overdue) {
      out.checked++;
      const balance = D(d.grandTotal).minus(D(d.paidAmount));
      if (balance.lte(0)) continue;
      const daysLate = Math.floor((today.getTime() - d.dueDate!.getTime()) / 86_400_000);
      // highest step reached; earlier steps that were missed are not sent separately
      const level = steps.filter((s) => daysLate >= s).length;
      if (!level || level <= (maxSent.get(d.id) ?? 0)) continue;
      const customer = d.customerId ? cm.get(d.customerId) : undefined;
      if (!customer?.email) {
        out.skipped++;
        out.details.push({
          invoice: d.number,
          level,
          status: 'SKIPPED',
          reason: 'Customer has no e-mail address',
        });
        continue;
      }
      try {
        // reserve the level first (unique documentId+level) so parallel runs never e-mail twice
        const reminder = await this.prisma.invoiceReminder.create({
          data: { companyId, documentId: d.id, level, sentTo: customer.email },
        });
        try {
          const text = `${message}\n\nInvoice: ${d.number}\nDue date: ${d.dueDate!.toISOString().slice(0, 10)} (${daysLate} day${daysLate === 1 ? '' : 's'} overdue)\nOutstanding: ${d.currencyCode} ${balance.toFixed(2)}\n\n${company.name}`;
          await this.billing.emailInvoice(d.id, customer.email, text, `Payment reminder: invoice ${d.number} is ${daysLate} days overdue`);
        } catch (e) {
          await this.prisma.invoiceReminder.delete({
            where: { id: reminder.id },
          });
          throw e;
        }
        await this.audit.record('Invoice Reminder', d.id, 'SEND', undefined, {
          invoice: d.number,
          level,
          to: customer.email,
        });
        out.sent++;
        out.details.push({
          invoice: d.number,
          level,
          to: customer.email,
          status: 'SENT',
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // sent by a parallel run
        out.failed++;
        out.details.push({
          invoice: d.number,
          level,
          to: customer.email,
          status: 'FAILED',
          reason: (e as Error).message,
        });
        this.logger.warn(`${d.number}: reminder failed - ${(e as Error).message}`);
      }
    }
    return out;
  }

  async runForUser() {
    RequestCtx.assert('sales.subscription.run');
    return this.run(true);
  }

  /** Reminder log (who was reminded about which invoice, when) */
  async list(q: { page: number; pageSize: number; search?: string }) {
    RequestCtx.assert('sales.invoice.read');
    const companyId = RequestCtx.companyId();
    const docWhere: Prisma.TradeDocumentWhereInput = {
      companyId,
      docType: 'SI',
      ...(q.search ? { number: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const docIds = q.search
      ? (
          await this.prisma.tradeDocument.findMany({
            where: docWhere,
            select: { id: true },
            take: 500,
          })
        ).map((d) => d.id)
      : undefined;
    const where: Prisma.InvoiceReminderWhereInput = {
      companyId,
      ...(docIds ? { documentId: { in: docIds } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoiceReminder.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.invoiceReminder.count({ where }),
    ]);
    const docs = await this.prisma.tradeDocument.findMany({
      where: { id: { in: rows.map((r) => r.documentId) } },
      select: {
        id: true,
        number: true,
        dueDate: true,
        grandTotal: true,
        paidAmount: true,
        status: true,
        customerId: true,
      },
    });
    const dm = new Map(docs.map((d) => [d.id, d]));
    const customers = await this.prisma.customer.findMany({
      where: {
        id: { in: docs.map((d) => d.customerId).filter(Boolean) as string[] },
      },
      select: { id: true, name: true },
    });
    const cm = new Map(customers.map((c) => [c.id, c.name]));
    const steps = await this.schedule(companyId);
    return {
      ...paged(
        rows.map((r) => {
          const d = dm.get(r.documentId);
          return {
            ...r,
            invoiceNumber: d?.number,
            dueDate: d?.dueDate,
            invoiceStatus: d?.status,
            balance: d ? D(d.grandTotal).minus(D(d.paidAmount)) : null,
            customerName: d?.customerId ? cm.get(d.customerId) : null,
            days: steps[r.level - 1] ?? null,
          };
        }),
        total,
        q,
      ),
      settings: {
        enabled: await this.settings.bool('sales.reminderEnabled', companyId, false),
        steps,
        mailConfigured: await this.billing.mailConfigured(),
      },
    };
  }
}
