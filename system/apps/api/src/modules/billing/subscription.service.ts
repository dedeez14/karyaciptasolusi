import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/access/access.service';
import { SettingsService } from '../../common/settings/settings.service';
import { RequestCtx } from '../../common/context/request-context';
import { D, round } from '../../common/utils/money';
import { paged } from '../../common/utils/query';
import { DocumentService } from '../documents/document.service';
import { DocumentPrintService } from '../print/document-print.service';
import { PdfService } from '../print/pdf.service';
import { MailService } from '../integrations/mail.service';
import { addMonths, assertLookup, assertOwned, dateOnly, isoOf, isUuid, todayIso } from './job-context';

const optUuid = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().optional());
const optText = (max: number) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional());

const lineSchema = z.object({
  productId: optUuid,
  description: optText(1000),
  qty: z.coerce.number().positive('Quantity must be positive').max(1e9),
  uomId: optUuid,
  unitPrice: z.coerce.number().min(0).max(1e14).default(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  taxId: optUuid,
});

export const subscriptionSchema = z
  .object({
    code: optText(30),
    name: z.string().trim().min(1, 'Name is required').max(200),
    customerId: z.uuid('Customer is required'),
    projectId: optUuid,
    intervalCode: z.string().trim().min(1, 'Billing interval is required').max(20),
    intervalCount: z.coerce.number().int().min(1).max(36).default(1),
    startDate: z.coerce.date(),
    endDate: optDate,
    nextRunDate: optDate,
    paymentTermId: optUuid,
    currencyCode: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().length(3).optional()),
    autoConfirm: z.coerce.boolean().default(true),
    autoEmail: z.coerce.boolean().default(false),
    emailTo: z.preprocess((v) => (v === '' ? null : v), z.email().max(150).nullable().optional()),
    notes: optText(4000),
    isActive: z.coerce.boolean().default(true),
    lines: z.array(lineSchema).min(1, 'Add at least one line').max(100),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be after the start date',
      });
    if (v.nextRunDate && v.nextRunDate < v.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['nextRunDate'],
        message: 'Next invoice date cannot be before the start date',
      });
  });

/** Months per BILLING_INTERVAL code (system lookup: codes are fixed, labels are editable). */
const INTERVAL_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

type Sub = Prisma.SubscriptionGetPayload<{ include: { lines: true } }>;

export interface RunResult {
  subscriptionId: string;
  code: string;
  invoiceId?: string;
  invoiceNumber?: string;
  confirmed?: boolean;
  emailed?: boolean;
  error?: string;
  warning?: string;
}

/**
 * Recurring billing: maintenance, hosting, retainer contracts.
 * Invoices are created through the document engine (same numbering, validation, posting and PDF as manual invoices).
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger('RecurringBilling');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly docs: DocumentService,
    private readonly printer: DocumentPrintService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
  ) {}

  private scope() {
    return this.access.scopeWhere({
      branchField: 'branchId',
    }) as Prisma.SubscriptionWhereInput;
  }

  months(intervalCode: string, count: number) {
    const m = INTERVAL_MONTHS[intervalCode];
    if (!m)
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { intervalCode: 'Unsupported billing interval' },
      });
    return m * Math.max(1, count);
  }

  /** next invoice date after `from`, anchored on the start date's day of month */
  nextDate(s: { intervalCode: string; intervalCount: number; startDate: Date }, from: Date) {
    return addMonths(from, this.months(s.intervalCode, s.intervalCount), s.startDate.getUTCDate());
  }

  private async lineAmounts(
    lines: {
      qty: Prisma.Decimal.Value;
      unitPrice: Prisma.Decimal.Value;
      discountPct: Prisma.Decimal.Value;
      taxId: string | null;
    }[],
  ) {
    const taxIds = [...new Set(lines.map((l) => l.taxId).filter(Boolean) as string[])];
    const taxes = taxIds.length
      ? await this.prisma.tax.findMany({
          where: { id: { in: taxIds } },
          select: { id: true, rate: true },
        })
      : [];
    const rate = new Map(taxes.map((t) => [t.id, D(t.rate)]));
    let net = D(0);
    let tax = D(0);
    for (const l of lines) {
      const sub = round(D(l.qty).times(D(l.unitPrice)));
      const n = sub.minus(round(sub.times(D(l.discountPct)).div(100)));
      net = net.plus(n);
      if (l.taxId) tax = tax.plus(round(n.times(rate.get(l.taxId) ?? 0).div(100)));
    }
    return { net, tax, total: net.plus(tax) };
  }

  // ------------------------------------------------------------------ queries
  async list(q: { page: number; pageSize: number; search?: string; status?: string; customerId?: string }) {
    RequestCtx.assert('sales.subscription.read');
    const today = dateOnly(todayIso());
    const where: Prisma.SubscriptionWhereInput = {
      ...this.scope(),
      deletedAt: null,
    };
    if (q.customerId) where.customerId = q.customerId;
    if (q.search) where.OR = [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }];
    if (q.status === 'ACTIVE') where.AND = [{ isActive: true }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }];
    if (q.status === 'DUE') where.AND = [{ isActive: true }, { nextRunDate: { lte: today } }, { OR: [{ endDate: null }, { endDate: { gte: today } }] }];
    if (q.status === 'PAUSED') where.isActive = false;
    if (q.status === 'ENDED') where.endDate = { lt: today };
    const [rows, total, activeCount, dueCount] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include: { lines: true },
        orderBy: [{ nextRunDate: 'asc' }, { code: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.count({
        where: {
          ...this.scope(),
          deletedAt: null,
          isActive: true,
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
      }),
      this.prisma.subscription.count({
        where: {
          ...this.scope(),
          deletedAt: null,
          isActive: true,
          nextRunDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
      }),
    ]);
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } },
      select: { id: true, name: true },
    });
    const cn = new Map(customers.map((c) => [c.id, c.name]));
    const data = await Promise.all(
      rows.map(async ({ lines, ...r }) => {
        const a = await this.lineAmounts(lines);
        return {
          ...r,
          customerName: cn.get(r.customerId) ?? null,
          amount: a.total,
          state: this.state(r, today),
        };
      }),
    );
    // recurring revenue normalised to one month (active subscriptions only)
    const activeRows = await this.prisma.subscription.findMany({
      where: {
        ...this.scope(),
        deletedAt: null,
        isActive: true,
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { lines: true },
    });
    let mrr = D(0);
    for (const s of activeRows) {
      const m = INTERVAL_MONTHS[s.intervalCode];
      if (!m) continue;
      mrr = mrr.plus((await this.lineAmounts(s.lines)).net.div(m * s.intervalCount));
    }
    return {
      ...paged(data, total, q),
      summary: {
        active: activeCount,
        due: dueCount,
        monthlyRecurring: round(mrr),
      },
    };
  }

  private state(s: { isActive: boolean; endDate: Date | null; nextRunDate: Date }, today: Date) {
    if (s.endDate && (s.endDate < today || s.nextRunDate > s.endDate)) return 'ENDED';
    if (!s.isActive) return 'PAUSED';
    return s.nextRunDate <= today ? 'DUE' : 'ACTIVE';
  }

  private async findOwned(id: string): Promise<Sub> {
    if (!isUuid(id)) throw new NotFoundException('Subscription not found');
    const s = await this.prisma.subscription.findFirst({
      where: { ...this.scope(), id, deletedAt: null },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!s) throw new NotFoundException('Subscription not found');
    return s;
  }

  async get(id: string) {
    RequestCtx.assert('sales.subscription.read');
    const s = await this.findOwned(id);
    const ids = (k: 'productId' | 'uomId' | 'taxId') => s.lines.map((l) => l[k]).filter(Boolean) as string[];
    const [customer, project, term, products, uoms, taxes, invoices, amounts] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: s.customerId },
        select: { id: true, code: true, name: true, email: true },
      }),
      s.projectId
        ? this.prisma.project.findUnique({
            where: { id: s.projectId },
            select: { name: true },
          })
        : null,
      s.paymentTermId
        ? this.prisma.paymentTerm.findUnique({
            where: { id: s.paymentTermId },
            select: { name: true },
          })
        : null,
      this.prisma.product.findMany({
        where: { id: { in: ids('productId') } },
        select: { id: true, code: true, name: true },
      }),
      this.prisma.uom.findMany({
        where: { id: { in: ids('uomId') } },
        select: { id: true, code: true },
      }),
      this.prisma.tax.findMany({
        where: { id: { in: ids('taxId') } },
        select: { id: true, name: true, rate: true },
      }),
      this.invoices(s),
      this.lineAmounts(s.lines),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const um = new Map(uoms.map((u) => [u.id, u.code]));
    const tm = new Map(taxes.map((t) => [t.id, t.name]));
    const upcoming: string[] = [];
    let d = s.nextRunDate;
    for (let i = 0; i < 6 && (!s.endDate || d <= s.endDate); i++) {
      upcoming.push(isoOf(d));
      d = this.nextDate(s, d);
    }
    return {
      ...s,
      customerName: customer?.name ?? null,
      customerEmail: customer?.email ?? null,
      projectName: project?.name ?? null,
      paymentTermName: term?.name ?? null,
      state: this.state(s, dateOnly(todayIso())),
      amounts,
      upcoming,
      lines: s.lines.map((l) => ({
        ...l,
        product: l.productId ? (pm.get(l.productId) ?? null) : null,
        uomCode: l.uomId ? (um.get(l.uomId) ?? null) : null,
        taxName: l.taxId ? (tm.get(l.taxId) ?? null) : null,
      })),
      invoices,
    };
  }

  /** Invoices generated from a subscription (linked by reference = subscription code) */
  private invoices(s: Sub) {
    return this.prisma.tradeDocument.findMany({
      where: {
        companyId: s.companyId,
        docType: 'SI',
        deletedAt: null,
        OR: [{ reference: s.code }, ...(s.lastInvoiceId ? [{ id: s.lastInvoiceId }] : [])],
      },
      select: {
        id: true,
        number: true,
        date: true,
        dueDate: true,
        status: true,
        grandTotal: true,
        paidAmount: true,
      },
      orderBy: { date: 'desc' },
      take: 60,
    });
  }

  // ------------------------------------------------------------------ write
  private async validate(input: z.infer<typeof subscriptionSchema>) {
    await assertOwned(this.prisma, 'customer', input.customerId, 'customerId', 'Customer');
    await assertOwned(this.prisma, 'project', input.projectId, 'projectId', 'Project');
    await assertOwned(this.prisma, 'paymentTerm', input.paymentTermId, 'paymentTermId', 'Payment term');
    await assertOwned(this.prisma, 'currency', input.currencyCode, 'currencyCode', 'Currency');
    await assertLookup(this.prisma, 'BILLING_INTERVAL', input.intervalCode, 'intervalCode');
    this.months(input.intervalCode, input.intervalCount);
    for (const [i, l] of input.lines.entries()) {
      if (!l.productId && !l.description)
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            [`lines.${i}.description`]: 'Choose a product or enter a description',
          },
        });
      await assertOwned(this.prisma, 'product', l.productId, `lines.${i}.productId`, 'Product');
      await assertOwned(this.prisma, 'uom', l.uomId, `lines.${i}.uomId`, 'Unit');
      await assertOwned(this.prisma, 'tax', l.taxId, `lines.${i}.taxId`, 'Tax');
    }
    return input.lines.map((l, i) => ({
      lineNo: i + 1,
      productId: l.productId ?? null,
      description: l.description ?? null,
      qty: D(l.qty),
      uomId: l.uomId ?? null,
      unitPrice: D(l.unitPrice),
      discountPct: D(l.discountPct),
      taxId: l.taxId ?? null,
    }));
  }

  private header(input: z.infer<typeof subscriptionSchema>, companyCurrency: string) {
    return {
      name: input.name,
      customerId: input.customerId,
      projectId: input.projectId ?? null,
      intervalCode: input.intervalCode,
      intervalCount: input.intervalCount,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextRunDate: input.nextRunDate ?? input.startDate,
      paymentTermId: input.paymentTermId ?? null,
      currencyCode: input.currencyCode ?? companyCurrency,
      autoConfirm: input.autoConfirm,
      autoEmail: input.autoEmail,
      emailTo: input.emailTo ?? null,
      notes: input.notes ?? null,
      isActive: input.isActive,
    };
  }

  async create(body: unknown) {
    RequestCtx.assert('sales.subscription.create');
    const input = subscriptionSchema.parse(body);
    const lines = await this.validate(input);
    const u = RequestCtx.user();
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: u.companyId },
      select: { currencyCode: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const code = input.code || (await this.sequence.next('SUBSCRIPTION', u.companyId, new Date(), tx));
      if (
        await tx.subscription.findFirst({
          where: { companyId: u.companyId, code },
        })
      )
        throw new BadRequestException({
          message: 'Validation failed',
          errors: { code: 'Code is already used' },
        });
      const s = await tx.subscription.create({
        data: {
          ...this.header(input, company.currencyCode),
          companyId: u.companyId,
          branchId: u.branchId,
          code,
          createdById: u.id,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.audit.record('Subscription', s.id, 'CREATE', undefined, s, tx);
      return s;
    });
  }

  async update(id: string, body: unknown) {
    RequestCtx.assert('sales.subscription.update');
    const before = await this.findOwned(id);
    const input = subscriptionSchema.parse(body);
    const lines = await this.validate(input);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: before.companyId },
      select: { currencyCode: true },
    });
    const code = input.code || before.code;
    if (
      code !== before.code &&
      (await this.prisma.subscription.findFirst({
        where: { companyId: before.companyId, code },
      }))
    )
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { code: 'Code is already used' },
      });
    return this.prisma.$transaction(async (tx) => {
      await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
      const s = await tx.subscription.update({
        where: { id },
        data: {
          ...this.header(input, company.currencyCode),
          code,
          updatedById: RequestCtx.user().id,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.audit.record('Subscription', id, 'UPDATE', before, s, tx);
      return s;
    });
  }

  async setActive(id: string, isActive: boolean) {
    RequestCtx.assert('sales.subscription.update');
    const before = await this.findOwned(id);
    const s = await this.prisma.subscription.update({
      where: { id },
      data: { isActive, updatedById: RequestCtx.user().id },
    });
    await this.audit.record('Subscription', id, 'UPDATE', before, s);
    return s;
  }

  async remove(id: string) {
    RequestCtx.assert('sales.subscription.delete');
    const before = await this.findOwned(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          updatedById: RequestCtx.user().id,
        },
      });
      await this.audit.record('Subscription', id, 'DELETE', before, undefined, tx);
    });
    return { success: true };
  }

  // ------------------------------------------------------------------ invoice generation

  /** "Run now" from the UI: bills the next period immediately (even if it is not due yet). */
  async runOne(id: string) {
    RequestCtx.assert('sales.subscription.run');
    const s = await this.findOwned(id);
    if (!s.isActive) throw new ConflictException('Subscription is paused. Activate it first.');
    if (s.endDate && s.nextRunDate > s.endDate) throw new ConflictException('Subscription has ended');
    const r = await this.generate(s);
    if (r.error) throw new BadRequestException(r.error);
    return r;
  }

  /** Bills every due subscription of the active company (scheduler and "Run due now"). */
  async runDue(opts: { maxPerSubscription?: number } = {}) {
    const today = dateOnly(todayIso());
    const due = await this.prisma.subscription.findMany({
      where: {
        companyId: RequestCtx.companyId(),
        deletedAt: null,
        isActive: true,
        nextRunDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
      orderBy: { nextRunDate: 'asc' },
      take: 500,
    });
    const results: RunResult[] = [];
    for (const s0 of due) {
      // catch up missed periods (server was off), bounded to avoid surprises
      let s: Sub | null = s0;
      for (let i = 0; s && i < (opts.maxPerSubscription ?? 12) && s.nextRunDate <= today && (!s.endDate || s.nextRunDate <= s.endDate); i++) {
        const r = await this.generate(s);
        results.push(r);
        if (r.error) break;
        s = await this.prisma.subscription.findUnique({
          where: { id: s.id },
          include: { lines: { orderBy: { lineNo: 'asc' } } },
        });
      }
    }
    return {
      processed: results.length,
      created: results.filter((r) => r.invoiceId).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
  }

  async runDueForUser() {
    RequestCtx.assert('sales.subscription.run');
    return this.runDue();
  }

  /**
   * Creates (and optionally confirms + e-mails) the invoice for the subscription's next period.
   * The period is claimed first with an optimistic update so two runs can never bill it twice.
   */
  private async generate(s: Sub): Promise<RunResult> {
    const base: RunResult = { subscriptionId: s.id, code: s.code };
    const periodStart = s.nextRunDate;
    const next = this.nextDate(s, periodStart);
    const claimed = await this.prisma.subscription.updateMany({
      where: { id: s.id, nextRunDate: periodStart, deletedAt: null },
      data: { nextRunDate: next },
    });
    if (!claimed.count) return { ...base, warning: 'Already billed by another run' };

    const today = dateOnly(todayIso());
    const invoiceDate = periodStart <= today ? periodStart : today;
    const periodEnd = new Date(next.getTime() - 86_400_000);
    const periodText = `Billing period ${isoOf(periodStart)} to ${isoOf(periodEnd)}`;
    let invoice: { id: string; number: string };
    try {
      invoice = await this.docs.create('SI', {
        date: isoOf(invoiceDate),
        customerId: s.customerId,
        projectId: s.projectId,
        paymentTermId: s.paymentTermId,
        currencyCode: s.currencyCode,
        reference: s.code,
        notes: [s.name, periodText, s.notes].filter(Boolean).join('\n'),
        lines: s.lines.map((l) => ({
          productId: l.productId,
          description: l.description,
          qty: Number(l.qty),
          uomId: l.uomId,
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          taxId: l.taxId,
        })),
      });
    } catch (e) {
      // release the claim so the period is billed on the next run
      await this.prisma.subscription.updateMany({
        where: { id: s.id, nextRunDate: next },
        data: { nextRunDate: periodStart },
      });
      this.logger.warn(`${s.code}: invoice not created - ${(e as Error).message}`);
      return {
        ...base,
        error: `Invoice could not be created: ${(e as Error).message}`,
      };
    }
    const after = await this.prisma.subscription.update({
      where: { id: s.id },
      data: { lastRunAt: new Date(), lastInvoiceId: invoice.id },
    });
    await this.audit.record('Subscription', s.id, 'GENERATE_INVOICE', { nextRunDate: isoOf(periodStart) }, { nextRunDate: isoOf(after.nextRunDate), invoice: invoice.number });
    const result: RunResult = {
      ...base,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      confirmed: false,
      emailed: false,
    };

    if (s.autoConfirm) {
      try {
        await this.docs.confirm('SI', invoice.id);
        result.confirmed = true;
      } catch (e) {
        result.warning = `Invoice ${invoice.number} was left as draft: ${(e as Error).message}`;
        this.logger.warn(`${s.code}: ${result.warning}`);
      }
    }
    if (s.autoEmail && result.confirmed) {
      try {
        const customer = await this.prisma.customer.findUnique({
          where: { id: s.customerId },
          select: { email: true, name: true },
        });
        const to = s.emailTo || customer?.email;
        if (!to) throw new Error('customer has no e-mail address');
        await this.emailInvoice(invoice.id, to, `Please find attached invoice ${invoice.number} for ${s.name} (${periodText.toLowerCase()}).`);
        result.emailed = true;
      } catch (e) {
        result.warning = `Invoice ${invoice.number} was not e-mailed: ${(e as Error).message}`;
        this.logger.warn(`${s.code}: ${result.warning}`);
      }
    }
    return result;
  }

  /** E-mails a sales invoice PDF with the uniform document layout (also used by overdue reminders). */
  async emailInvoice(invoiceId: string, to: string, message: string, subject?: string) {
    const def = this.docs.def('SI');
    const doc = await this.docs.get('SI', invoiceId);
    const printable = await this.printer.trade(def, doc);
    const pdf = await this.pdf.render(RequestCtx.companyId(), printable);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: RequestCtx.companyId() },
      select: { name: true },
    });
    await this.mail.send({
      to,
      subject: subject ?? `Invoice ${doc.number} from ${company.name}`,
      text: message,
      attachments: [
        {
          filename: `Invoice_${doc.number}.pdf`.replace(/[^\w.-]+/g, '_'),
          content: pdf,
        },
      ],
    });
  }

  /** SMTP configured for the active company? (jobs skip quietly when it is not) */
  async mailConfigured() {
    const c = RequestCtx.companyId();
    const [host, user, pass] = await Promise.all([this.settings.str('mail.host', c), this.settings.str('mail.username', c), this.settings.str('mail.password', c)]);
    return !!(host && user && pass);
  }
}
